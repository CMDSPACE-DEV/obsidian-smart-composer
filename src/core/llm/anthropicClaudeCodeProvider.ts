import {
  CLAUDE_CODE_DEFAULT_BETAS,
  CLAUDE_CODE_USER_AGENT,
} from '../../constants'
import { ChatModel } from '../../types/chat-model.types'
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
import { LLMHttpError } from '../../utils/llm/httpTransport'

import { BaseLLMProvider } from './base'
import { refreshClaudeCodeAccessToken } from './claudeCodeAuth'
import { ClaudeCodeMessageAdapter } from './claudeCodeMessageAdapter'
import {
  LLMAPIKeyInvalidException,
  LLMAPIKeyNotSetException,
} from './exception'

export class ClaudePlanRequestError extends Error {
  constructor(
    message: string,
    public readonly model: string,
    public readonly effort: string,
    public readonly status: number,
    public readonly responseBody: string,
    public readonly requestId: string | undefined,
    public readonly originalError: unknown,
  ) {
    super(`${message} (model=${model}, effort=${effort})`)
    this.name = 'ClaudePlanRequestError'
    Object.setPrototypeOf(this, ClaudePlanRequestError.prototype)
  }
}

export class AnthropicClaudeCodeProvider extends BaseLLMProvider<
  Extract<LLMProvider, { type: 'anthropic-plan' }>
> {
  private static readonly TOKEN_REFRESH_SKEW_MS = 60_000

  private adapter: ClaudeCodeMessageAdapter
  private onProviderUpdate?: (
    providerId: string,
    update: Partial<LLMProvider>,
  ) => void | Promise<void>

  constructor(
    provider: Extract<LLMProvider, { type: 'anthropic-plan' }>,
    onProviderUpdate?: (
      providerId: string,
      update: Partial<LLMProvider>,
    ) => void | Promise<void>,
  ) {
    super(provider)
    this.adapter = new ClaudeCodeMessageAdapter()
    this.onProviderUpdate = onProviderUpdate
  }

  async generateResponse(
    model: ChatModel,
    request: LLMRequestNonStreaming,
    options?: LLMOptions,
  ): Promise<LLMResponseNonStreaming> {
    if (model.providerType !== 'anthropic-plan') {
      throw new Error('Model is not a Claude Code model')
    }
    return this.withModelErrorContext(
      model,
      this.withAuthRetry((headers) =>
        this.adapter.generateResponse(
          { ...request, model: model.model },
          options,
          headers,
          model.thinking,
        ),
      ),
    )
  }

  async streamResponse(
    model: ChatModel,
    request: LLMRequestStreaming,
    options?: LLMOptions,
  ): Promise<AsyncIterable<LLMResponseStreaming>> {
    if (model.providerType !== 'anthropic-plan') {
      throw new Error('Model is not a Claude Code model')
    }
    return this.withModelErrorContext(
      model,
      this.withAuthRetry((headers) =>
        this.adapter.streamResponse(
          { ...request, model: model.model },
          options,
          headers,
          model.thinking,
        ),
      ),
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
    operation: (headers: Record<string, string>) => Promise<T>,
  ): Promise<T> {
    const headers = await this.getAuthHeaders()
    try {
      return await operation(headers)
    } catch (error) {
      if (!isUnauthorizedError(error)) {
        throw error
      }

      const refreshedHeaders = await this.getAuthHeaders(true)
      return operation(refreshedHeaders)
    }
  }

  private async withModelErrorContext<T>(
    model: Extract<ChatModel, { providerType: 'anthropic-plan' }>,
    operation: Promise<T>,
  ): Promise<T> {
    try {
      return await operation
    } catch (error) {
      if (!(error instanceof LLMHttpError)) {
        throw error
      }
      throw new ClaudePlanRequestError(
        error.message,
        model.model,
        getThinkingContext(model),
        error.status,
        error.responseBody,
        error.requestId,
        error,
      )
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
      this.provider.oauth.expiresAt <=
        Date.now() + AnthropicClaudeCodeProvider.TOKEN_REFRESH_SKEW_MS
    ) {
      try {
        const tokens = await refreshClaudeCodeAccessToken(
          this.provider.oauth.refreshToken,
        )
        const updatedOauth = {
          accessToken: tokens.access_token,
          refreshToken:
            tokens.refresh_token ?? this.provider.oauth.refreshToken,
          expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
        }
        this.provider.oauth = updatedOauth
        await this.onProviderUpdate?.(this.provider.id, {
          oauth: updatedOauth,
        })
      } catch (error) {
        throw new LLMAPIKeyInvalidException(
          'Claude Code OAuth token refresh failed. Please log in again.',
          error instanceof Error ? error : undefined,
        )
      }
    }

    return {
      authorization: `Bearer ${this.provider.oauth.accessToken}`,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': CLAUDE_CODE_DEFAULT_BETAS.join(','),
      'user-agent': CLAUDE_CODE_USER_AGENT,
    }
  }
}

function getThinkingContext(
  model: Extract<ChatModel, { providerType: 'anthropic-plan' }>,
): string {
  if (model.thinking?.enabled === false) {
    return 'disabled'
  }
  if (
    model.model === 'claude-sonnet-5' ||
    model.model.startsWith('claude-sonnet-5-')
  ) {
    return model.thinking?.mode === 'adaptive' ? model.thinking.effort : 'high'
  }
  if (model.thinking?.mode === 'adaptive') {
    return model.thinking.effort
  }
  if (model.thinking?.enabled) {
    return 'manual'
  }
  return 'default'
}

function isUnauthorizedError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }

  const status = (error as Error & { status?: number }).status
  return status === 401 || /Request failed:\s*401\b/.test(error.message)
}
