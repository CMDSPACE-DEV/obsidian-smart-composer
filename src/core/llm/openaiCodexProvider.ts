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

  constructor(
    provider: Extract<LLMProvider, { type: 'openai-plan' }>,
    onProviderUpdate?: (
      providerId: string,
      update: Partial<LLMProvider>,
    ) => void | Promise<void>,
  ) {
    super(provider)
    this.adapter = new CodexMessageAdapter()
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

  private async withAuthRetry<T>(
    request: (headers: Record<string, string>) => Promise<T>,
  ): Promise<T> {
    const authHeaders = await this.getAuthHeaders()
    try {
      return await request(authHeaders)
    } catch (error) {
      if (!(error instanceof CodexRequestError) || error.status !== 401) {
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
