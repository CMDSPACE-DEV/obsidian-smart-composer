import { migrateFrom26To27 } from './26_to_27'

describe('migrateFrom26To27', () => {
  it('removes only legacy Claude and Gemini Plan OAuth credentials', () => {
    const result = migrateFrom26To27({
      version: 26,
      providers: [
        {
          type: 'anthropic-plan',
          id: 'anthropic-plan',
          oauth: {
            accessToken: 'claude-access',
            refreshToken: 'claude-refresh',
            expiresAt: 1,
          },
        },
        {
          type: 'gemini-plan',
          id: 'gemini-plan',
          oauth: {
            accessToken: 'gemini-access',
            refreshToken: 'gemini-refresh',
            expiresAt: 2,
          },
        },
        {
          type: 'openai-plan',
          id: 'openai-plan',
          oauth: {
            accessToken: 'openai-access',
            refreshToken: 'openai-refresh',
            expiresAt: 3,
          },
        },
      ],
    })

    expect(result.version).toBe(27)
    expect(result.providers).toEqual([
      { type: 'anthropic-plan', id: 'anthropic-plan' },
      { type: 'gemini-plan', id: 'gemini-plan' },
      expect.objectContaining({
        type: 'openai-plan',
        oauth: expect.objectContaining({ accessToken: 'openai-access' }),
      }),
    ])
  })

  it('maps selected Opus to the latest runtime alias and preserves old metadata', () => {
    const result = migrateFrom26To27({
      version: 26,
      chatModelId: 'claude-opus-4.8 (plan)',
      inlineEdit: {
        modelId: 'claude-opus-4.8 (plan)',
        contextCharacters: 4000,
      },
      chatModels: [
        {
          providerType: 'anthropic-plan',
          providerId: 'anthropic-plan',
          id: 'claude-opus-4.8 (plan)',
          model: 'claude-opus-4-8',
        },
        {
          providerType: 'anthropic-plan',
          providerId: 'anthropic-plan',
          id: 'claude-sonnet-5 (plan)',
          model: 'claude-sonnet-5',
        },
        {
          providerType: 'openai-compatible',
          providerId: 'custom',
          id: 'custom-model',
          model: 'custom-model',
        },
      ],
    })

    expect(result.chatModelId).toBe('claude-opus-latest (plan)')
    expect(result.inlineEdit).toMatchObject({
      modelId: 'claude-opus-latest (plan)',
      contextCharacters: 4000,
    })
    expect(result.chatModels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'claude-opus-latest (plan)',
          model: 'opus',
          enable: true,
        }),
        expect.objectContaining({
          id: 'claude-default (plan)',
          model: 'default',
          enable: true,
        }),
        expect.objectContaining({
          id: 'claude-haiku-latest (plan)',
          model: 'haiku',
          enable: true,
        }),
        expect.objectContaining({
          id: 'claude-opus-4.8 (plan)',
          model: 'claude-opus-4-8',
          enable: false,
        }),
        expect.objectContaining({
          id: 'claude-sonnet-5 (plan)',
          model: 'claude-sonnet-5',
          enable: false,
        }),
        expect.objectContaining({
          id: 'custom-model',
          model: 'custom-model',
        }),
      ]),
    )
  })

  it('initializes runtime diagnostics without persisting an executable path', () => {
    const result = migrateFrom26To27({ version: 26 })

    expect(result.nativeRuntimes).toEqual({
      claude: { status: 'not-installed', models: [] },
      gemini: { status: 'not-installed', models: [] },
    })
    expect(JSON.stringify(result)).not.toContain('executablePath')
  })
})
