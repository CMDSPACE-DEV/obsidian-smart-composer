import type {
  Message,
  MessageCreateParams,
  MessageStreamEvent,
} from '@anthropic-ai/sdk/resources/messages'

import {
  CLAUDE_CODE_MESSAGES_ENDPOINT,
  CLAUDE_CODE_SYSTEM_MESSAGE,
} from '../../constants'
import {
  AnthropicPlanThinking,
  ClaudeEffort,
} from '../../types/chat-model.types'
import {
  LLMOptions,
  LLMRequest,
  LLMRequestNonStreaming,
  LLMRequestStreaming,
  RequestMessage,
} from '../../types/llm/request'
import {
  LLMResponseNonStreaming,
  LLMResponseStreaming,
} from '../../types/llm/response'
import { postJson, postStream } from '../../utils/llm/httpTransport'
import { parseJsonSseStream } from '../../utils/llm/sse'

import { AnthropicProvider } from './anthropic'

const DEFAULT_MAX_TOKENS = 8192
const SONNET_5_DEFAULT_MAX_TOKENS = 32768

export type ClaudeCodeThinkingConfig = AnthropicPlanThinking

type ClaudeCodeRequestBody = Omit<
  MessageCreateParams,
  'thinking' | 'temperature' | 'top_p'
> & {
  thinking?:
    | { type: 'enabled'; budget_tokens: number }
    | { type: 'adaptive'; display: 'summarized' | 'omitted' }
    | { type: 'disabled' }
  output_config?: { effort: ClaudeEffort }
  temperature?: number
  top_p?: number
}

type ClaudeCodeAdapterConfig = {
  endpoint?: string
  fetchFn?: typeof fetch
}

export class ClaudeCodeMessageAdapter {
  private endpoint: string
  private fetchFn?: typeof fetch

  constructor(config: ClaudeCodeAdapterConfig = {}) {
    this.endpoint = config.endpoint ?? CLAUDE_CODE_MESSAGES_ENDPOINT
    this.fetchFn = config.fetchFn
  }

  async generateResponse(
    request: LLMRequestNonStreaming,
    options: LLMOptions | undefined,
    headers: Record<string, string>,
    thinking?: ClaudeCodeThinkingConfig,
  ): Promise<LLMResponseNonStreaming> {
    const normalizedRequest = normalizeRequest(request)
    const body = this.buildRequestBody({
      request: normalizedRequest,
      stream: false,
      thinking,
    })
    const payload = await postJson<Message>(
      ensureBetaQuery(this.endpoint),
      body,
      {
        headers: headers,
        signal: options?.signal,
        fetchFn: this.fetchFn,
      },
    )
    return AnthropicProvider.parseNonStreamingResponse(payload)
  }

  async streamResponse(
    request: LLMRequestStreaming,
    options: LLMOptions | undefined,
    headers: Record<string, string>,
    thinking?: ClaudeCodeThinkingConfig,
  ): Promise<AsyncIterable<LLMResponseStreaming>> {
    const normalizedRequest = normalizeRequest(request)
    const body = this.buildRequestBody({
      request: normalizedRequest,
      stream: true,
      thinking,
    })
    const stream = await postStream(ensureBetaQuery(this.endpoint), body, {
      headers: headers,
      signal: options?.signal,
      fetchFn: this.fetchFn,
    })
    return AnthropicProvider.streamResponseGenerator(
      parseJsonSseStream<MessageStreamEvent>(stream),
    )
  }

  private buildRequestBody({
    request,
    stream,
    thinking,
  }: {
    request: LLMRequest
    stream: boolean
    thinking?: ClaudeCodeThinkingConfig
  }): ClaudeCodeRequestBody {
    const system = AnthropicProvider.validateSystemMessages(request.messages)
    const messages = request.messages
      .map((m) => AnthropicProvider.parseRequestMessage(m))
      .filter((m) => m !== null)
    const tools = request.tools?.map((t) =>
      AnthropicProvider.parseRequestTool(t),
    )
    const toolChoice = request.tool_choice
      ? AnthropicProvider.parseRequestToolChoice(request.tool_choice)
      : undefined

    const isSonnet5 = isClaudeSonnet5(request.model)
    const adaptiveThinking =
      isSonnet5 && thinking?.enabled !== false
        ? thinking?.mode === 'adaptive'
          ? thinking
          : {
              enabled: true as const,
              mode: 'adaptive' as const,
              effort: 'high' as const,
              display: 'summarized' as const,
            }
        : undefined
    const manualThinking =
      !isSonnet5 && thinking?.enabled && thinking.mode !== 'adaptive'
        ? thinking
        : undefined

    const body: ClaudeCodeRequestBody = {
      model: request.model,
      messages,
      system,
      thinking: isSonnet5
        ? thinking?.enabled === false
          ? { type: 'disabled' }
          : adaptiveThinking
            ? {
                type: 'adaptive',
                display: adaptiveThinking.display,
              }
            : undefined
        : manualThinking
          ? {
              type: 'enabled',
              budget_tokens: manualThinking.budget_tokens,
            }
          : undefined,
      output_config: adaptiveThinking
        ? { effort: adaptiveThinking.effort }
        : undefined,
      tools,
      tool_choice: toolChoice,
      max_tokens:
        request.max_tokens ??
        (isSonnet5
          ? SONNET_5_DEFAULT_MAX_TOKENS
          : manualThinking
            ? manualThinking.budget_tokens + DEFAULT_MAX_TOKENS
            : DEFAULT_MAX_TOKENS),
      temperature: isSonnet5 ? undefined : request.temperature,
      top_p: isSonnet5 ? undefined : request.top_p,
      stream,
    }

    return body
  }
}

function isClaudeSonnet5(model: string): boolean {
  return model === 'claude-sonnet-5' || model.startsWith('claude-sonnet-5-')
}

function normalizeRequest<T extends LLMRequest>(request: T): T {
  // Claude Code OAuth tokens require this exact system message.
  const systemMessages = request.messages.filter(
    (message) => message.role === 'system',
  )
  const nonSystemMessages = request.messages.filter(
    (message) => message.role !== 'system',
  )
  const concatenatedSystemMessage =
    systemMessages.length > 0
      ? systemMessages.map((message) => message.content).join('\n\n')
      : ''

  const normalizedMessages: RequestMessage[] = [
    {
      role: 'system' as const,
      content: CLAUDE_CODE_SYSTEM_MESSAGE,
    },
    ...(concatenatedSystemMessage
      ? [
          {
            role: 'user' as const,
            content: concatenatedSystemMessage,
          },
        ]
      : []),
    ...nonSystemMessages,
  ]

  return {
    ...request,
    messages: normalizedMessages,
  }
}

// NOTE: The API works without `beta=true`, but we keep it to match Opencode.
function ensureBetaQuery(endpoint: string): string {
  const url = new URL(endpoint)
  if (!url.searchParams.has('beta')) {
    url.searchParams.set('beta', 'true')
  }
  return url.toString()
}
