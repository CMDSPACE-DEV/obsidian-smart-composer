import { migrateFrom27To28 } from './27_to_28'

describe('migrateFrom27To28', () => {
  it('adds the stable Sonnet runtime alias and preserves custom models', () => {
    const result = migrateFrom27To28({
      version: 27,
      chatModels: [
        {
          providerType: 'openai-compatible',
          providerId: 'custom',
          id: 'custom-model',
          model: 'custom-model',
        },
      ],
    })

    expect(result.version).toBe(28)
    expect(result.chatModels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'claude-sonnet-latest (plan)',
          model: 'sonnet',
          enable: true,
        }),
        expect.objectContaining({
          id: 'custom-model',
          model: 'custom-model',
        }),
      ]),
    )
  })

  it('maps a selected fixed Sonnet model to the stable runtime alias', () => {
    const result = migrateFrom27To28({
      version: 27,
      chatModelId: 'claude-sonnet-5 (plan)',
      inlineEdit: {
        modelId: 'claude-sonnet-5 (plan)',
        contextCharacters: 4000,
      },
      chatModels: [],
    })

    expect(result.chatModelId).toBe('claude-sonnet-latest (plan)')
    expect(result.inlineEdit).toMatchObject({
      modelId: 'claude-sonnet-latest (plan)',
      contextCharacters: 4000,
    })
  })

  it('clears only the stale ready-state Claude catalog error', () => {
    const result = migrateFrom27To28({
      version: 27,
      nativeRuntimes: {
        claude: {
          status: 'ready',
          models: [],
          error:
            "Using stable model aliases because catalog refresh failed: Cannot read properties of undefined (reading 'propagation')",
        },
        gemini: {
          status: 'error',
          models: [],
          error: 'Keep this real runtime error',
        },
      },
    })

    expect(result.nativeRuntimes).toEqual({
      claude: {
        status: 'ready',
        models: [],
      },
      gemini: {
        status: 'error',
        models: [],
        error: 'Keep this real runtime error',
      },
    })
  })
})
