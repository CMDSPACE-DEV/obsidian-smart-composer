import { ChatModel } from '../../types/chat-model.types'
import { LLMResponseNonStreaming } from '../../types/llm/response'
import { LLMHttpError } from '../../utils/llm/httpTransport'

import {
  AnthropicClaudeCodeProvider,
  ClaudePlanRequestError,
} from './anthropicClaudeCodeProvider'
import { refreshClaudeCodeAccessToken } from './claudeCodeAuth'
import { ClaudeCodeMessageAdapter } from './claudeCodeMessageAdapter'

jest.mock('./claudeCodeAuth', () => ({
  refreshClaudeCodeAccessToken: jest.fn(),
}))

const mockedRefreshAccessToken = jest.mocked(refreshClaudeCodeAccessToken)

describe('AnthropicClaudeCodeProvider OAuth', () => {
  beforeEach(() => {
    mockedRefreshAccessToken.mockReset()
  })

  it('refreshes tokens that expire within the 60 second skew window', async () => {
    mockedRefreshAccessToken.mockResolvedValue({
      access_token: 'fresh-access',
      refresh_token: 'fresh-refresh',
      expires_in: 3600,
    })
    const onProviderUpdate = jest.fn()
    const adapter = createAdapterMock()
    const provider = new AnthropicClaudeCodeProvider(
      {
        id: 'anthropic-plan',
        type: 'anthropic-plan',
        oauth: {
          accessToken: 'expiring-access',
          refreshToken: 'refresh-token',
          expiresAt: Date.now() + 30_000,
        },
      },
      onProviderUpdate,
    )
    setAdapter(provider, adapter)

    await provider.generateResponse(sonnet5Model(), {
      model: 'caller-supplied-model',
      messages: [],
    })

    expect(mockedRefreshAccessToken).toHaveBeenCalledWith('refresh-token')
    expect(adapter.generateResponse).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-sonnet-5' }),
      undefined,
      expect.objectContaining({ authorization: 'Bearer fresh-access' }),
      expect.objectContaining({ mode: 'adaptive' }),
    )
    expect(onProviderUpdate).toHaveBeenCalledWith(
      'anthropic-plan',
      expect.objectContaining({
        oauth: expect.objectContaining({
          accessToken: 'fresh-access',
          refreshToken: 'fresh-refresh',
        }),
      }),
    )
  })

  it('forces one token refresh and retries once after a 401', async () => {
    mockedRefreshAccessToken.mockResolvedValue({
      access_token: 'retried-access',
      refresh_token: 'refresh-token',
      expires_in: 3600,
    })
    const adapter = createAdapterMock()
    adapter.generateResponse
      .mockRejectedValueOnce(new Error('Request failed: 401'))
      .mockResolvedValueOnce(emptyResponse())
    const provider = new AnthropicClaudeCodeProvider({
      id: 'anthropic-plan',
      type: 'anthropic-plan',
      oauth: {
        accessToken: 'current-access',
        refreshToken: 'refresh-token',
        expiresAt: Date.now() + 3_600_000,
      },
    })
    setAdapter(provider, adapter)

    await expect(
      provider.generateResponse(sonnet5Model(), {
        model: 'claude-sonnet-5',
        messages: [],
      }),
    ).resolves.toEqual(emptyResponse())

    expect(mockedRefreshAccessToken).toHaveBeenCalledTimes(1)
    expect(adapter.generateResponse).toHaveBeenCalledTimes(2)
    expect(adapter.generateResponse.mock.calls[1][2]).toEqual(
      expect.objectContaining({ authorization: 'Bearer retried-access' }),
    )
  })

  it('adds model and effort context to non-retryable HTTP errors', async () => {
    const adapter = createAdapterMock()
    adapter.generateResponse.mockRejectedValueOnce(
      new LLMHttpError(403, 'model entitlement missing', 'request-403'),
    )
    const provider = new AnthropicClaudeCodeProvider({
      id: 'anthropic-plan',
      type: 'anthropic-plan',
      oauth: {
        accessToken: 'current-access',
        refreshToken: 'refresh-token',
        expiresAt: Date.now() + 3_600_000,
      },
    })
    setAdapter(provider, adapter)

    let caught: unknown
    try {
      await provider.generateResponse(sonnet5Model(), {
        model: 'caller-model',
        messages: [],
      })
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(ClaudePlanRequestError)
    expect(caught).toMatchObject({
      model: 'claude-sonnet-5',
      effort: 'high',
      status: 403,
      requestId: 'request-403',
    })
    expect((caught as Error).message).toContain(
      'model=claude-sonnet-5, effort=high',
    )
    expect(mockedRefreshAccessToken).not.toHaveBeenCalled()
    expect(adapter.generateResponse).toHaveBeenCalledTimes(1)
  })
})

function sonnet5Model(): ChatModel {
  return {
    id: 'claude-sonnet-5 (plan)',
    model: 'claude-sonnet-5',
    providerId: 'anthropic-plan',
    providerType: 'anthropic-plan',
    thinking: {
      enabled: true,
      mode: 'adaptive',
      effort: 'high',
      display: 'summarized',
    },
  }
}

function emptyResponse(): LLMResponseNonStreaming {
  return {
    id: 'response',
    choices: [],
    model: 'claude-sonnet-5',
    object: 'chat.completion',
  }
}

function createAdapterMock() {
  return {
    generateResponse: jest.fn<
      ReturnType<ClaudeCodeMessageAdapter['generateResponse']>,
      Parameters<ClaudeCodeMessageAdapter['generateResponse']>
    >(() => Promise.resolve(emptyResponse())),
  }
}

function setAdapter(
  provider: AnthropicClaudeCodeProvider,
  adapter: ReturnType<typeof createAdapterMock>,
) {
  ;(
    provider as unknown as {
      adapter: Pick<ClaudeCodeMessageAdapter, 'generateResponse'>
    }
  ).adapter = adapter
}
