import { migrateFrom18To19 } from './18_to_19'

describe('Migration from v18 to v19', () => {
  it('replaces legacy Plan defaults and remaps selections', () => {
    const result = migrateFrom18To19({
      version: 18,
      chatModelId: 'gpt-5.5 (plan)',
      applyModelId: 'claude-sonnet-4.6 (plan)',
      chatModels: [
        {
          providerType: 'anthropic-plan',
          providerId: 'anthropic-plan',
          id: 'claude-sonnet-4.6 (plan)',
          model: 'claude-sonnet-4-6',
          thinking: { enabled: true, budget_tokens: 8192 },
        },
        {
          providerType: 'openai-plan',
          providerId: 'openai-plan',
          id: 'gpt-5.5 (plan)',
          model: 'gpt-5.5',
        },
      ],
    })
    const models = result.chatModels as Record<string, unknown>[]

    expect(result.version).toBe(19)
    expect(result.chatModelId).toBe('gpt-5.6-sol (plan)')
    expect(result.applyModelId).toBe('claude-sonnet-5 (plan)')
    expect(models.some((model) => model.id === 'gpt-5.5 (plan)')).toBe(false)
    expect(
      models.some((model) => model.id === 'claude-sonnet-4.6 (plan)'),
    ).toBe(false)
    expect(models.map((model) => model.id)).toEqual([
      'claude-sonnet-5 (plan)',
      'gpt-5.6-sol (plan)',
      'gpt-5.6-terra (plan)',
      'gpt-5.6-luna (plan)',
    ])
  })

  it('migrates legacy reasoning and disabled thinking', () => {
    const result = migrateFrom18To19({
      version: 18,
      chatModels: [
        {
          providerType: 'openai-plan',
          providerId: 'openai-plan',
          id: 'gpt-5.5 (plan)',
          model: 'gpt-5.5',
          reasoning: {
            reasoning_effort: 'minimal',
            reasoning_summary: 'concise',
          },
        },
        {
          providerType: 'anthropic-plan',
          providerId: 'anthropic-plan',
          id: 'claude-sonnet-4.6 (plan)',
          model: 'claude-sonnet-4-6',
          thinking: { enabled: false, budget_tokens: 4096 },
        },
      ],
    })
    const models = result.chatModels as Model[]

    expect(findModel(models, 'gpt-5.6-sol (plan)').reasoning).toEqual({
      reasoning_effort: 'low',
      reasoning_summary: 'concise',
    })
    expect(findModel(models, 'claude-sonnet-5 (plan)').thinking).toEqual({
      enabled: false,
      mode: 'adaptive',
      effort: 'high',
      display: 'summarized',
    })
  })

  it('drops a summary migrated with none effort', () => {
    const result = migrateFrom18To19({
      version: 18,
      chatModels: [
        {
          providerType: 'openai-plan',
          providerId: 'openai-plan',
          id: 'gpt-5.5 (plan)',
          model: 'gpt-5.5',
          reasoning: {
            reasoning_effort: 'none',
            reasoning_summary: 'detailed',
          },
        },
      ],
    })
    const models = result.chatModels as Model[]

    expect(findModel(models, 'gpt-5.6-sol (plan)').reasoning).toEqual({
      reasoning_effort: 'none',
    })
  })

  it('preserves providers, API models, custom models, and existing new settings', () => {
    const providers = [
      {
        type: 'openai-plan',
        id: 'openai-plan',
        oauth: { accessToken: 'secret', refreshToken: 'refresh' },
      },
    ]
    const result = migrateFrom18To19({
      version: 18,
      providers,
      chatModels: [
        {
          providerType: 'openai',
          providerId: 'openai',
          id: 'gpt-5.5',
          model: 'gpt-5.5',
        },
        {
          providerType: 'openai-compatible',
          providerId: 'custom-provider',
          id: 'custom-model',
          model: 'custom-model',
        },
        {
          providerType: 'openai-plan',
          providerId: 'wrong-provider',
          id: 'gpt-5.6-sol (plan)',
          model: 'wrong-model',
          enable: false,
          promptLevel: 2,
          reasoning: { reasoning_effort: 'xhigh' },
        },
      ],
    })
    const models = result.chatModels as Model[]

    expect(result.providers).toBe(providers)
    expect(findModel(models, 'gpt-5.5').model).toBe('gpt-5.5')
    expect(findModel(models, 'custom-model').model).toBe('custom-model')
    expect(findModel(models, 'gpt-5.6-sol (plan)')).toMatchObject({
      providerId: 'openai-plan',
      model: 'gpt-5.6-sol',
      enable: false,
      promptLevel: 2,
      reasoning: { reasoning_effort: 'xhigh' },
    })
    expect(
      models.filter((model) => model.id === 'gpt-5.6-sol (plan)'),
    ).toHaveLength(1)
  })

  it('normalizes pre-existing reserved GPT and Sonnet 5 rows', () => {
    const result = migrateFrom18To19({
      version: 18,
      chatModels: [
        {
          providerType: 'openai-plan',
          providerId: 'openai-plan',
          id: 'gpt-5.6-sol (plan)',
          model: 'gpt-5.6-sol',
          reasoning: {
            reasoning_effort: 'minimal',
            reasoning_summary: 'concise',
          },
        },
        {
          providerType: 'openai-plan',
          providerId: 'openai-plan',
          id: 'gpt-5.6-luna (plan)',
          model: 'gpt-5.6-luna',
          reasoning: {
            reasoning_effort: 'invalid',
            reasoning_summary: 'detailed',
          },
        },
        {
          providerType: 'anthropic-plan',
          providerId: 'anthropic-plan',
          id: 'claude-sonnet-5 (plan)',
          model: 'claude-sonnet-5',
          thinking: {
            enabled: false,
            mode: 'manual',
            budget_tokens: 8192,
          },
        },
      ],
    })
    const models = result.chatModels as Model[]

    expect(findModel(models, 'gpt-5.6-sol (plan)').reasoning).toEqual({
      reasoning_effort: 'low',
      reasoning_summary: 'concise',
    })
    expect(findModel(models, 'gpt-5.6-luna (plan)').reasoning).toEqual({
      reasoning_effort: 'none',
    })
    expect(findModel(models, 'claude-sonnet-5 (plan)').thinking).toEqual({
      enabled: false,
      mode: 'adaptive',
      effort: 'high',
      display: 'summarized',
    })
  })
})

type Model = {
  id: string
  model?: string
  reasoning?: Record<string, unknown>
  thinking?: Record<string, unknown>
  [key: string]: unknown
}

function findModel(models: Model[], id: string): Model {
  const model = models.find((candidate) => candidate.id === id)
  if (!model) throw new Error(`Missing model ${id}`)
  return model
}
