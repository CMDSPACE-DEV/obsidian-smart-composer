import { migrateFrom19To20 } from './19_to_20'

describe('Migration from v19 to v20', () => {
  it('moves a custom apply model to inline edit and disables Gemini Plan', () => {
    const result = migrateFrom19To20({
      version: 19,
      chatModelId: 'gemini-3-pro-preview (plan)',
      applyModelId: 'custom-fast-model',
      chatModels: [
        {
          providerType: 'gemini-plan',
          id: 'gemini-3-pro-preview (plan)',
          enable: true,
        },
        { providerType: 'openai', id: 'custom-fast-model' },
      ],
    })

    expect(result.version).toBe(20)
    expect(result.chatModelId).toBe('gpt-5.6-sol (plan)')
    expect(result.applyModelId).toBeUndefined()
    expect(result.inlineEdit).toEqual({
      modelId: 'custom-fast-model',
      contextCharacters: 4000,
    })
    expect(result.chatModels).toEqual([
      expect.objectContaining({ enable: false }),
      expect.objectContaining({ id: 'custom-fast-model' }),
    ])
  })

  it('inherits chat model for the legacy default apply model', () => {
    const result = migrateFrom19To20({
      version: 19,
      applyModelId: 'gpt-4.1-mini',
    })

    expect(result.inlineEdit).toEqual({
      modelId: null,
      contextCharacters: 4000,
    })
  })
})
