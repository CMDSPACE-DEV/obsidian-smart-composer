import { migrateFrom28To29 } from './28_to_29'

describe('migrateFrom28To29', () => {
  it('removes synced machine health and preserves portable user choices', () => {
    const input = {
      version: 28,
      providers: [{ type: 'anthropic-plan', id: 'anthropic-plan' }],
      chatModelId: 'claude-sonnet-latest (plan)',
      inlineEdit: { modelId: 'custom-model', contextCharacters: 1234 },
      customPortableValue: { keep: true },
      nativeRuntimes: {
        claude: {
          status: 'ready',
          version: '2.1.220',
          models: [{ id: 'sonnet', label: 'Sonnet' }],
        },
        gemini: {
          status: 'ready',
          version: '1.1.8',
          models: [{ id: 'gemini-pro', label: 'Gemini Pro' }],
        },
      },
    }

    const result = migrateFrom28To29(input)

    expect(result).toEqual({
      version: 29,
      providers: input.providers,
      chatModelId: input.chatModelId,
      inlineEdit: input.inlineEdit,
      customPortableValue: input.customPortableValue,
    })
    expect(input.nativeRuntimes.claude.status).toBe('ready')
  })
})
