import {
  type Options,
  type SDKMessage,
  type SDKUserMessage,
  query as createClaudeQuery,
} from '@anthropic-ai/claude-agent-sdk'
import type {
  Base64ImageSource,
  ImageBlockParam,
  TextBlockParam,
} from '@anthropic-ai/sdk/resources/messages'
import { Platform } from 'obsidian'
import { v4 as uuidv4 } from 'uuid'

import { ChatModel } from '../../../types/chat-model.types'
import {
  LLMOptions,
  LLMRequestNonStreaming,
  LLMRequestStreaming,
} from '../../../types/llm/request'
import {
  LLMResponseNonStreaming,
  LLMResponseStreaming,
  ResponseUsage,
} from '../../../types/llm/response'
import { LLMProvider } from '../../../types/provider.types'
import { parseImageDataUrl } from '../../../utils/llm/image'
import { BaseLLMProvider } from '../base'
import { LLMAPIKeyNotSetException } from '../exception'

import { createClaudeMcpBridge } from './claudeMcpBridge'
import { createClaudeSpawnAdapter } from './ClaudeSpawnAdapter'
import { NativeCliResolver } from './NativeCliResolver'
import { buildNativePrompt } from './nativePrompt'
import { requireNode } from './nodeRuntime'

export class ClaudeAgentProvider extends BaseLLMProvider<
  Extract<LLMProvider, { type: 'anthropic-plan' }>
> {
  constructor(
    provider: Extract<LLMProvider, { type: 'anthropic-plan' }>,
    private readonly resolver = new NativeCliResolver(),
  ) {
    super(provider)
  }

  async generateResponse(
    model: ChatModel,
    request: LLMRequestNonStreaming,
    options?: LLMOptions,
  ): Promise<LLMResponseNonStreaming> {
    let content = ''
    let reasoning = ''
    let usage: ResponseUsage | undefined
    const stream = await this.streamResponse(
      model,
      { ...request, stream: true },
      options,
    )
    for await (const chunk of stream) {
      content += chunk.choices[0]?.delta.content ?? ''
      reasoning += chunk.choices[0]?.delta.reasoning ?? ''
      usage = chunk.usage ?? usage
    }
    return {
      id: uuidv4(),
      model: model.model,
      object: 'chat.completion',
      usage,
      choices: [
        {
          finish_reason: 'stop',
          message: {
            role: 'assistant',
            content,
            reasoning: reasoning || undefined,
          },
        },
      ],
    }
  }

  async streamResponse(
    model: ChatModel,
    request: LLMRequestStreaming,
    options?: LLMOptions,
  ): Promise<AsyncIterable<LLMResponseStreaming>> {
    if (!Platform.isDesktop) {
      throw new Error('Claude Plan is available on desktop only.')
    }
    if (model.providerType !== 'anthropic-plan') {
      throw new Error('Model is not a Claude Plan model.')
    }
    const executablePath = this.resolver.resolve('claude')
    if (!executablePath) {
      throw new LLMAPIKeyNotSetException(
        'Claude Code is not installed. Open Settings > Plan connections to install and sign in.',
      )
    }
    return this.run(executablePath, model, request, options)
  }

  async getEmbedding(): Promise<number[]> {
    throw new Error('Claude Plan does not support embeddings.')
  }

  private async *run(
    executablePath: string,
    model: Extract<ChatModel, { providerType: 'anthropic-plan' }>,
    request: LLMRequestStreaming,
    options?: LLMOptions,
  ): AsyncGenerator<LLMResponseStreaming> {
    const nativePrompt = buildNativePrompt(request.messages)
    const abortController = new AbortController()
    const abort = () => abortController.abort()
    if (options?.signal?.aborted) abort()
    options?.signal?.addEventListener('abort', abort, { once: true })

    const mcpBridge =
      request.tools?.length && options?.nativeToolExecutor
        ? await createClaudeMcpBridge({
            tools: request.tools,
            execute: options.nativeToolExecutor,
          })
        : undefined
    const cwd = createEphemeralRuntimeDirectory()
    const sdkOptions: Options = {
      pathToClaudeCodeExecutable: executablePath,
      spawnClaudeCodeProcess: createClaudeSpawnAdapter(),
      cwd,
      model: normalizeClaudeModel(model.model),
      systemPrompt: nativePrompt.systemPrompt,
      includePartialMessages: true,
      settingSources: [],
      strictMcpConfig: true,
      persistSession: false,
      tools: [],
      skills: [],
      plugins: [],
      settings: {
        autoMemoryEnabled: false,
        autoDreamEnabled: false,
      },
      mcpServers: mcpBridge ? { smart_composer: mcpBridge.server } : undefined,
      allowedTools: mcpBridge?.allowedTools,
      permissionMode: 'dontAsk',
      abortController,
      maxTurns: 24,
      env: {
        ...process.env,
        CLAUDE_AGENT_SDK_CLIENT_APP: 'smart-composer-achmage/2.6.0',
        CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
      },
      ...thinkingOptions(model),
    }
    let emittedText = ''
    let emittedReasoning = ''
    let finalUsage: ResponseUsage | undefined
    try {
      const query = createClaudeQuery({
        prompt: createClaudePromptInput(nativePrompt.prompt, request.messages),
        options: sdkOptions,
      })
      try {
        for await (const message of query) {
          const deltas = extractClaudeDeltas(
            message,
            emittedText,
            emittedReasoning,
          )
          emittedText += deltas.content
          emittedReasoning += deltas.reasoning
          finalUsage = extractUsage(message) ?? finalUsage
          if (deltas.content || deltas.reasoning || finalUsage) {
            yield createChunk(model.model, {
              content: deltas.content,
              reasoning: deltas.reasoning,
              usage: finalUsage,
            })
            finalUsage = undefined
          }
          throwIfClaudeResultError(message)
        }
        yield createChunk(model.model, {
          finishReason: 'stop',
        })
      } finally {
        query.close()
      }
    } finally {
      options?.signal?.removeEventListener('abort', abort)
      removeEphemeralRuntimeDirectory(cwd)
    }
  }
}

export function createClaudePromptInput(
  prompt: string,
  messages: LLMRequestStreaming['messages'],
): string | AsyncIterable<SDKUserMessage> {
  const imageBlocks = messages.flatMap((message) => {
    if (message.role !== 'user' || !Array.isArray(message.content)) {
      return []
    }
    return message.content.flatMap((part): ImageBlockParam[] =>
      part.type === 'image_url' ? [toClaudeImageBlock(part.image_url.url)] : [],
    )
  })
  if (imageBlocks.length === 0) return prompt

  return (async function* (): AsyncGenerator<SDKUserMessage> {
    const content: (TextBlockParam | ImageBlockParam)[] = [
      ...imageBlocks,
      { type: 'text', text: prompt },
    ]
    yield {
      type: 'user',
      message: { role: 'user', content },
      parent_tool_use_id: null,
    }
  })()
}

function toClaudeImageBlock(url: string): ImageBlockParam {
  if (/^https?:\/\//i.test(url)) {
    return {
      type: 'image',
      source: { type: 'url', url },
    }
  }
  const { mimeType, base64Data } = parseImageDataUrl(url)
  if (
    !['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mimeType)
  ) {
    throw new Error(`Claude Plan does not support image type ${mimeType}.`)
  }
  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type: mimeType as Base64ImageSource['media_type'],
      data: base64Data,
    },
  }
}

function normalizeClaudeModel(model: string): string {
  if (/opus/i.test(model)) return 'opus'
  if (/sonnet/i.test(model)) return 'sonnet'
  if (/haiku/i.test(model)) return 'haiku'
  return model
}

function thinkingOptions(
  model: Extract<ChatModel, { providerType: 'anthropic-plan' }>,
): Pick<Options, 'thinking' | 'effort'> {
  if (model.thinking?.enabled === false) {
    return { thinking: { type: 'disabled' } }
  }
  if (model.thinking?.mode === 'adaptive') {
    return {
      thinking: {
        type: 'adaptive',
        display: model.thinking.display,
      },
      effort: model.thinking.effort,
    }
  }
  if (model.thinking?.enabled) {
    return {
      thinking: {
        type: 'enabled',
        budgetTokens: model.thinking.budget_tokens,
      },
    }
  }
  return {
    thinking: { type: 'adaptive', display: 'summarized' },
    effort: 'high',
  }
}

function extractClaudeDeltas(
  message: SDKMessage,
  emittedText: string,
  emittedReasoning: string,
): { content: string; reasoning: string } {
  if (message.type === 'stream_event') {
    const event = message.event
    if (
      event.type === 'content_block_delta' &&
      event.delta.type === 'text_delta'
    ) {
      return { content: event.delta.text, reasoning: '' }
    }
    if (
      event.type === 'content_block_delta' &&
      event.delta.type === 'thinking_delta'
    ) {
      return { content: '', reasoning: event.delta.thinking }
    }
  }
  if (message.type !== 'assistant') {
    return { content: '', reasoning: '' }
  }
  const fullText = message.message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
  const fullReasoning = message.message.content
    .filter((block) => block.type === 'thinking')
    .map((block) => block.thinking)
    .join('')
  return {
    content: fullText.startsWith(emittedText)
      ? fullText.slice(emittedText.length)
      : '',
    reasoning: fullReasoning.startsWith(emittedReasoning)
      ? fullReasoning.slice(emittedReasoning.length)
      : '',
  }
}

function extractUsage(message: SDKMessage): ResponseUsage | undefined {
  if (message.type !== 'assistant') return undefined
  const usage = message.message.usage
  const promptTokens =
    usage.input_tokens +
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0)
  return {
    prompt_tokens: promptTokens,
    completion_tokens: usage.output_tokens,
    total_tokens: promptTokens + usage.output_tokens,
  }
}

function throwIfClaudeResultError(message: SDKMessage): void {
  if (message.type === 'assistant' && message.error) {
    throw new Error(`Claude Code request failed: ${message.error}`)
  }
  if (message.type === 'result' && message.subtype !== 'success') {
    const errors = 'errors' in message ? message.errors.join('\n') : ''
    throw new Error(errors || `Claude Code request failed: ${message.subtype}`)
  }
}

function createChunk(
  model: string,
  params: {
    content?: string
    reasoning?: string
    usage?: ResponseUsage
    finishReason?: string
  },
): LLMResponseStreaming {
  return {
    id: uuidv4(),
    model,
    object: 'chat.completion.chunk',
    usage: params.usage,
    choices: [
      {
        finish_reason: params.finishReason ?? null,
        delta: {
          content: params.content,
          reasoning: params.reasoning,
        },
      },
    ],
  }
}

function createEphemeralRuntimeDirectory(): string {
  const fs = requireNode<typeof import('fs')>('fs')
  const os = requireNode<typeof import('os')>('os')
  const path = requireNode<typeof import('path')>('path')
  return fs.mkdtempSync(path.join(os.tmpdir(), 'smart-composer-claude-'))
}

function removeEphemeralRuntimeDirectory(directory: string | undefined) {
  if (!directory) return
  const fs = requireNode<typeof import('fs')>('fs')
  try {
    fs.rmSync(directory, { recursive: true, force: true })
  } catch {
    // The operating system will eventually clear its temporary directory.
  }
}
