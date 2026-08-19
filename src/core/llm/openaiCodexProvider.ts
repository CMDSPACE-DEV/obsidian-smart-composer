import { Reasoning } from 'openai/resources/shared'

import {
  ChatModel,
  GPT_5_6_EFFORTS,
  Gpt56Effort,
} from '../../types/chat-model.types'
import {
  LLMOptions,
  LLMRequestNonStreaming,
  LLMRequestStreaming,
} from '../../types/llm/request'
import {
  LLMResponseNonStreaming,
  LLMResponseStreaming,
} from '../../types/llm/response'
import { LLMProvider } from '../../types/provider.types'
import { postStream } from '../../utils/llm/httpTransport'
import { parseJsonSseStream } from '../../utils/llm/sse'

import { BaseLLMProvider } from './base'
import { extractCodexAccountId, refreshCodexAccessToken } from './codexAuth'
import { CodexMessageAdapter, CodexRequestError } from './codexMessageAdapter'
import {
  LLMAPIKeyInvalidException,
  LLMAPIKeyNotSetException,
} from './exception'

export type { Gpt56Effort } from '../../types/chat-model.types'

const GPT_5_6_EFFORT_SET = new Set<Gpt56Effort>(GPT_5_6_EFFORTS)
const GPT_5_6_DEFAULT_EFFORTS: Record<string, Gpt56Effort> = {
  'gpt-5.6-sol': 'medium',
  'gpt-5.6-terra': 'low',
  'gpt-5.6-luna': 'none',
}
const OAUTH_REFRESH_SKEW_MS = 60_000
const CODEX_RESPONSES_ENDPOINT =
  'https://chatgpt.com/backend-api/codex/responses'

type CodexImageStreamEvent = {
  type: string
  partial_image_index?: number
  item?: {
    type?: string
    result?: string
  }
  response?: {
    output?: {
      type?: string
      result?: string
    }[]
  }
}

export type PlanImageResult = {
  base64: string
  mimeType: 'image/png'
}

function isGpt56Model(model: string): boolean {
  return /^gpt-5\.6-(?:sol|terra|luna)$/.test(model)
}

function normalizeGpt56Effort(
  model: string,
  effort: string | undefined,
): Gpt56Effort | undefined {
  if (!effort) {
    return GPT_5_6_DEFAULT_EFFORTS[model]
  }
  if (!isGpt56Model(model)) {
    return effort as Gpt56Effort
  }
  if (!GPT_5_6_EFFORT_SET.has(effort as Gpt56Effort)) {
    throw new Error(
      `Unsupported reasoning effort "${effort}" for ${model}. Expected one of: ${GPT_5_6_EFFORTS.join(', ')}.`,
    )
  }
  return effort as Gpt56Effort
}

export class OpenAICodexProvider extends BaseLLMProvider<
  Extract<LLMProvider, { type: 'openai-plan' }>
> {
  private adapter: CodexMessageAdapter
  private onProviderUpdate?: (
    providerId: string,
    update: Partial<LLMProvider>,
  ) => void | Promise<void>
  private imageEndpoint: string
  private fetchFn?: typeof fetch

  constructor(
    provider: Extract<LLMProvider, { type: 'openai-plan' }>,
    onProviderUpdate?: (
      providerId: string,
      update: Partial<LLMProvider>,
    ) => void | Promise<void>,
    transport: {
      endpoint?: string
      fetchFn?: typeof fetch
    } = {},
  ) {
    super(provider)
    this.imageEndpoint = transport.endpoint ?? CODEX_RESPONSES_ENDPOINT
    this.fetchFn = transport.fetchFn
    this.adapter = new CodexMessageAdapter({
      endpoint: this.imageEndpoint,
      fetchFn: this.fetchFn,
    })
    this.onProviderUpdate = onProviderUpdate
  }

  async generateResponse(
    model: ChatModel,
    request: LLMRequestNonStreaming,
    options?: LLMOptions,
  ): Promise<LLMResponseNonStreaming> {
    if (model.providerType !== 'openai-plan') {
      throw new Error('Model is not an OpenAI Codex model')
    }

    const normalizedRequest = this.normalizeRequest(model, request)
    return this.withAuthRetry((authHeaders) =>
      this.adapter.generateResponse(normalizedRequest, options, authHeaders),
    )
  }

  async streamResponse(
    model: ChatModel,
    request: LLMRequestStreaming,
    options?: LLMOptions,
  ): Promise<AsyncIterable<LLMResponseStreaming>> {
    if (model.providerType !== 'openai-plan') {
      throw new Error('Model is not an OpenAI Codex model')
    }

    const normalizedRequest = this.normalizeRequest(model, request)
    return this.withAuthRetry((authHeaders) =>
      this.adapter.streamResponse(normalizedRequest, options, authHeaders),
    )
  }

  async getEmbedding(
    _model: string,
    _text: string,
    _options?: { dimensions?: number },
  ): Promise<number[]> {
    throw new Error(
      `Provider ${this.provider.id} does not support embeddings. Please use a different provider.`,
    )
  }

  async generateImage(
    model: Extract<ChatModel, { providerType: 'openai-plan' }>,
    prompt: string,
    options: {
      quality: 'low' | 'medium' | 'high'
      signal?: AbortSignal
      onProgress?: (phase: string, partialImageIndex?: number) => void
    },
  ): Promise<PlanImageResult> {
    return this.withAuthRetry(async (authHeaders) => {
      const stream = await postStream(
        this.imageEndpoint,
        {
          model: model.model,
          input: [
            {
              role: 'user',
              content: [{ type: 'input_text', text: prompt }],
            },
          ],
          instructions: 'Use the image generation tool exactly once.',
          store: false,
          stream: true,
          include: ['reasoning.encrypted_content'],
          reasoning: {
            effort: normalizeGpt56Effort(
              model.model,
              model.reasoning?.reasoning_effort,
            ),
          },
          tools: [
            {
              type: 'image_generation',
              quality: options.quality,
              size: '1536x1024',
              output_format: 'png',
            },
          ],
          tool_choice: { type: 'image_generation' },
        },
        {
          headers: authHeaders,
          signal: options.signal,
          fetchFn: this.fetchFn,
        },
      )

      let result: string | undefined
      for await (const event of parseJsonSseStream<CodexImageStreamEvent>(
        stream,
      )) {
        if (event.type === 'response.image_generation_call.in_progress') {
          options.onProgress?.('generating')
        } else if (event.type === 'response.image_generation_call.generating') {
          options.onProgress?.('rendering')
        } else if (
          event.type === 'response.image_generation_call.partial_image'
        ) {
          options.onProgress?.('receiving', event.partial_image_index)
        }
        if (event.item?.type === 'image_generation_call' && event.item.result) {
          result = event.item.result
        }
        if (event.type === 'response.completed') {
          result =
            event.response?.output?.find(
              (item) => item.type === 'image_generation_call' && item.result,
            )?.result ?? result
        }
      }
      if (!result) {
        throw new Error('Plan image generation completed without an image.')
      }
      return { base64: result, mimeType: 'image/png' }
    })
  }

  private async withAuthRetry<T>(
    request: (headers: Record<string, string>) => Promise<T>,
  ): Promise<T> {
    const authHeaders = await this.getAuthHeaders()
    try {
      return await request(authHeaders)
    } catch (error) {
      const status =
        error instanceof CodexRequestError
          ? error.status
          : typeof error === 'object' &&
              error !== null &&
              'status' in error &&
              typeof error.status === 'number'
            ? error.status
            : undefined
      if (status !== 401) {
        throw error
      }

      // A request can race token expiry even with the proactive skew. Refresh
      // once and only once; other statuses must surface without a fallback.
      const refreshedHeaders = await this.getAuthHeaders(true)
      return request(refreshedHeaders)
    }
  }

  private async getAuthHeaders(
    forceRefresh = false,
  ): Promise<Record<string, string>> {
    if (!this.provider.oauth?.refreshToken) {
      throw new LLMAPIKeyNotSetException(
        `Provider ${this.provider.id} OAuth credentials are missing. Please log in.`,
      )
    }

    if (
      forceRefresh ||
      !this.provider.oauth.accessToken ||
      this.provider.oauth.expiresAt <= Date.now() + OAUTH_REFRESH_SKEW_MS
    ) {
      try {
        const tokens = await refreshCodexAccessToken(
          this.provider.oauth.refreshToken,
        )
        const accountId = extractCodexAccountId(tokens)
        const updatedOauth = {
          accessToken: tokens.access_token,
          refreshToken:
            tokens.refresh_token ?? this.provider.oauth.refreshToken,
          expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
          accountId: accountId ?? this.provider.oauth.accountId,
        }
        this.provider.oauth = updatedOauth
        await this.onProviderUpdate?.(this.provider.id, {
          oauth: updatedOauth,
        })
      } catch (error) {
        throw new LLMAPIKeyInvalidException(
          'OpenAI Codex OAuth token refresh failed. Please log in again.',
          error instanceof Error ? error : undefined,
        )
      }
    }

    const headers: Record<string, string> = {
      authorization: `Bearer ${this.provider.oauth.accessToken}`,
    }

    if (this.provider.oauth.accountId) {
      headers['ChatGPT-Account-Id'] = this.provider.oauth.accountId
    }

    return headers
  }

  private normalizeRequest<
    T extends LLMRequestNonStreaming | LLMRequestStreaming,
  >(model: Extract<ChatModel, { providerType: 'openai-plan' }>, request: T): T {
    const reasoningEffort = normalizeGpt56Effort(
      model.model,
      model.reasoning?.reasoning_effort,
    )
    const reasoningSummary = model.reasoning?.reasoning_summary
    return {
      ...request,
      // The selected ChatModel is authoritative. Callers often reuse a request
      // object across providers, so accepting request.model here can silently send
      // a Plan request to the wrong Codex tier.
      model: model.model,
      reasoning_effort: reasoningEffort,
      reasoning_summary:
        reasoningEffort !== 'none' && reasoningSummary
          ? (reasoningSummary as Reasoning['summary'])
          : undefined,
      // The installed SDK type predates GPT-5.6's `max` effort. The adapter
      // narrows a local wire type without requiring a broad SDK upgrade.
    } as T
  }
}
