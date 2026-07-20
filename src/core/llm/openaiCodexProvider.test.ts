import { ChatModel } from '../../types/chat-model.types'
import { LLMRequestNonStreaming } from '../../types/llm/request'

import { refreshCodexAccessToken } from './codexAuth'
import { CodexRequestError } from './codexMessageAdapter'
import { Gpt56Effort, OpenAICodexProvider } from './openaiCodexProvider'

jest.mock('./codexAuth', () => ({
  extractCodexAccountId: jest.fn(() => 'refreshed-account'),
  refreshCodexAccessToken: jest.fn(),
}))

const MODELS = ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'] as const
const EFFORTS: Gpt56Effort[] = ['none', 'low', 'medium', 'high', 'xhigh', 'max']

type Normalizer = (
  model: Extract<ChatModel, { providerType: 'openai-plan' }>,
  request: LLMRequestNonStreaming,
) => LLMRequestNonStreaming

type AuthRetry = <T>(
  request: (headers: Record<string, string>) => Promise<T>,
) => Promise<T>

type GetAuthHeaders = (
  forceRefresh?: boolean,
) => Promise<Record<string, string>>

describe('OpenAICodexProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  const provider = new OpenAICodexProvider({
    id: 'openai-plan',
    type: 'openai-plan',
    oauth: {
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() + 60_000,
    },
  })
  const normalizeRequest = (
    provider as unknown as { normalizeRequest: Normalizer }
  ).normalizeRequest.bind(provider)

  it.each(
    MODELS.flatMap((model) =>
      EFFORTS.map((effort) => [model, effort] as const),
    ),
  )('enforces %s with %s effort', (modelName, effort) => {
    const model: Extract<ChatModel, { providerType: 'openai-plan' }> = {
      id: `${modelName} (plan)`,
      model: modelName,
      providerId: 'openai-plan',
      providerType: 'openai-plan',
      reasoning: {
        reasoning_effort: effort,
        reasoning_summary: 'auto',
      },
    }

    const normalized = normalizeRequest(model, {
      model: 'caller-supplied-model-must-not-win',
      messages: [],
    })

    expect(normalized.model).toBe(modelName)
    expect(normalized.reasoning_effort).toBe(effort)
    expect(normalized.reasoning_summary).toBe(
      effort === 'none' ? undefined : 'auto',
    )
  })

  it('rejects legacy minimal effort for GPT-5.6', () => {
    const model: Extract<ChatModel, { providerType: 'openai-plan' }> = {
      id: 'gpt-5.6-sol (plan)',
      model: 'gpt-5.6-sol',
      providerId: 'openai-plan',
      providerType: 'openai-plan',
      reasoning: {
        reasoning_effort: 'minimal',
      },
    }

    expect(() => {
      normalizeRequest(model, {
        model: 'gpt-5.5',
        messages: [],
      })
    }).toThrow('Unsupported reasoning effort "minimal" for gpt-5.6-sol')
  })

  it.each([
    ['gpt-5.6-sol', 'medium'],
    ['gpt-5.6-terra', 'low'],
    ['gpt-5.6-luna', 'none'],
  ] as const)(
    'applies the %s default effort when omitted',
    (modelName, effort) => {
      const model: Extract<ChatModel, { providerType: 'openai-plan' }> = {
        id: `${modelName} (plan)`,
        model: modelName,
        providerId: 'openai-plan',
        providerType: 'openai-plan',
      }

      expect(
        normalizeRequest(model, {
          model: 'caller-supplied-model-must-not-win',
          messages: [],
        }),
      ).toMatchObject({
        model: modelName,
        reasoning_effort: effort,
      })
    },
  )

  it('refreshes once and retries a 401 with the new token', async () => {
    const refreshMock = refreshCodexAccessToken as jest.MockedFunction<
      typeof refreshCodexAccessToken
    >
    refreshMock.mockResolvedValue({
      id_token: '',
      access_token: 'refreshed-access-token',
      refresh_token: 'refreshed-refresh-token',
      expires_in: 3600,
    })
    const retryProvider = new OpenAICodexProvider({
      id: 'openai-plan',
      type: 'openai-plan',
      oauth: {
        accessToken: 'stale-access-token',
        refreshToken: 'refresh-token',
        expiresAt: Date.now() + 3_600_000,
        accountId: 'original-account',
      },
    })
    const withAuthRetry = (
      retryProvider as unknown as { withAuthRetry: AuthRetry }
    ).withAuthRetry.bind(retryProvider)
    const headersSeen: Record<string, string>[] = []
    let attempt = 0

    const result = await withAuthRetry(
      async (headers: Record<string, string>) => {
        headersSeen.push(headers)
        attempt += 1
        if (attempt === 1) {
          throw new CodexRequestError({
            message: 'Request failed: 401',
            model: 'gpt-5.6-sol',
            reasoningEffort: 'medium',
            status: 401,
          })
        }
        return 'success'
      },
    )

    expect(result).toBe('success')
    expect(refreshMock).toHaveBeenCalledTimes(1)
    expect(headersSeen).toEqual([
      {
        authorization: 'Bearer stale-access-token',
        'ChatGPT-Account-Id': 'original-account',
      },
      {
        authorization: 'Bearer refreshed-access-token',
        'ChatGPT-Account-Id': 'refreshed-account',
      },
    ])
  })

  it('proactively refreshes a token that expires within 60 seconds', async () => {
    const refreshMock = refreshCodexAccessToken as jest.MockedFunction<
      typeof refreshCodexAccessToken
    >
    refreshMock.mockResolvedValue({
      id_token: '',
      access_token: 'proactive-access-token',
      refresh_token: 'proactive-refresh-token',
      expires_in: 3600,
    })
    const expiringProvider = new OpenAICodexProvider({
      id: 'openai-plan',
      type: 'openai-plan',
      oauth: {
        accessToken: 'almost-expired-token',
        refreshToken: 'refresh-token',
        expiresAt: Date.now() + 30_000,
      },
    })
    const getAuthHeaders = (
      expiringProvider as unknown as { getAuthHeaders: GetAuthHeaders }
    ).getAuthHeaders.bind(expiringProvider)

    await expect(getAuthHeaders()).resolves.toMatchObject({
      authorization: 'Bearer proactive-access-token',
    })
    expect(refreshMock).toHaveBeenCalledTimes(1)
  })
})
