import { migrateFrom16To17 } from './16_to_17'

describe('Migration from v16 to v17', () => {
  it('should increment version to 17', () => {
    const oldSettings = {
      version: 16,
    }
    const result = migrateFrom16To17(oldSettings)
    expect(result.version).toBe(17)
  })

  it('should add latest plan and API chat models', () => {
    const oldSettings = {
      version: 16,
      providers: [],
      chatModels: [
        {
          id: 'custom-model',
          providerType: 'custom',
          providerId: 'custom',
          model: 'custom-model',
        },
      ],
    }

    const result = migrateFrom16To17(oldSettings)
    const chatModels = result.chatModels as {
      id: string
      providerType: string
      providerId: string
      model: string
      thinking?: { enabled?: boolean; budget_tokens?: number }
    }[]

    expect(
      chatModels.find((m) => m.id === 'claude-opus-4.8 (plan)'),
    ).toMatchObject({
      providerType: 'anthropic-plan',
      providerId: 'anthropic-plan',
      model: 'claude-opus-4-8',
    })
    expect(
      chatModels.find((m) => m.id === 'claude-sonnet-4.6 (plan)'),
    ).toMatchObject({
      providerType: 'anthropic-plan',
      providerId: 'anthropic-plan',
      model: 'claude-sonnet-4-6',
      thinking: { enabled: true, budget_tokens: 8192 },
    })
    expect(chatModels.find((m) => m.id === 'gpt-5.5 (plan)')).toMatchObject({
      providerType: 'openai-plan',
      providerId: 'openai-plan',
      model: 'gpt-5.5',
    })
    expect(chatModels.find((m) => m.id === 'claude-opus-4.8')).toMatchObject({
      providerType: 'anthropic',
      providerId: 'anthropic',
      model: 'claude-opus-4-8',
    })
    expect(chatModels.find((m) => m.id === 'claude-sonnet-4.6')).toMatchObject({
      providerType: 'anthropic',
      providerId: 'anthropic',
      model: 'claude-sonnet-4-6',
    })
    expect(chatModels.find((m) => m.id === 'gpt-5.5')).toMatchObject({
      providerType: 'openai',
      providerId: 'openai',
      model: 'gpt-5.5',
    })
    expect(chatModels.find((m) => m.id === 'custom-model')).toBeDefined()
  })

  it('should remap selected legacy models to latest models', () => {
    const result = migrateFrom16To17({
      version: 16,
      chatModelId: 'claude-sonnet-4.5 (plan)',
      applyModelId: 'gpt-5.2',
    })

    expect(result.chatModelId).toBe('claude-sonnet-4.6 (plan)')
    expect(result.applyModelId).toBe('gpt-5.5')
  })

  it('should keep but disable legacy default models', () => {
    const result = migrateFrom16To17({
      version: 16,
      chatModels: [
        {
          providerType: 'anthropic-plan',
          providerId: 'anthropic-plan',
          id: 'claude-opus-4.5 (plan)',
          model: 'claude-opus-4-5',
        },
        {
          providerType: 'anthropic',
          providerId: 'anthropic',
          id: 'claude-sonnet-4.5',
          model: 'claude-sonnet-4-5',
        },
        {
          providerType: 'openai',
          providerId: 'openai',
          id: 'gpt-5.2',
          model: 'gpt-5.2',
        },
      ],
    })
    const chatModels = result.chatModels as {
      id: string
      enable?: boolean
    }[]

    expect(
      chatModels.find((m) => m.id === 'claude-opus-4.5 (plan)'),
    ).toMatchObject({
      enable: false,
    })
    expect(chatModels.find((m) => m.id === 'claude-sonnet-4.5')).toMatchObject({
      enable: false,
    })
    expect(chatModels.find((m) => m.id === 'gpt-5.2')).toMatchObject({
      enable: false,
    })
  })
})
