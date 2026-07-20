import { SettingMigration } from '../setting.types'

import { DEFAULT_CHAT_MODELS_V16, DEFAULT_PROVIDERS_V16 } from './15_to_16'
import { getMigratedChatModels, getMigratedProviders } from './migrationUtils'

const LEGACY_MODEL_ID_MAP: Record<string, string> = {
  'claude-opus-4.5 (plan)': 'claude-opus-4.8 (plan)',
  'claude-sonnet-4.5 (plan)': 'claude-sonnet-4.6 (plan)',
  'gpt-5.2 (plan)': 'gpt-5.5 (plan)',
  'claude-opus-4.5': 'claude-opus-4.8',
  'claude-sonnet-4.5': 'claude-sonnet-4.6',
  'gpt-5.2': 'gpt-5.5',
}

const LEGACY_MODEL_IDS = new Set(Object.keys(LEGACY_MODEL_ID_MAP))

export const DEFAULT_CHAT_MODELS_V17 = [
  {
    providerType: 'anthropic-plan',
    providerId: 'anthropic-plan',
    id: 'claude-opus-4.8 (plan)',
    model: 'claude-opus-4-8',
  },
  {
    providerType: 'anthropic-plan',
    providerId: 'anthropic-plan',
    id: 'claude-sonnet-4.6 (plan)',
    model: 'claude-sonnet-4-6',
    thinking: {
      enabled: true,
      budget_tokens: 8192,
    },
  },
  {
    providerType: 'openai-plan',
    providerId: 'openai-plan',
    id: 'gpt-5.5 (plan)',
    model: 'gpt-5.5',
  },
  ...DEFAULT_CHAT_MODELS_V16.slice(3).map((model) => {
    switch (model.id) {
      case 'claude-opus-4.5':
        return {
          providerType: 'anthropic',
          providerId: 'anthropic',
          id: 'claude-opus-4.8',
          model: 'claude-opus-4-8',
        }
      case 'claude-sonnet-4.5':
        return {
          providerType: 'anthropic',
          providerId: 'anthropic',
          id: 'claude-sonnet-4.6',
          model: 'claude-sonnet-4-6',
        }
      case 'gpt-5.2':
        return {
          providerType: 'openai',
          providerId: 'openai',
          id: 'gpt-5.5',
          model: 'gpt-5.5',
        }
      default:
        return model
    }
  }),
]

export const migrateFrom16To17: SettingMigration['migrate'] = (data) => {
  const newData = { ...data }
  newData.version = 17

  newData.providers = getMigratedProviders(newData, DEFAULT_PROVIDERS_V16)
  newData.chatModels = getMigratedChatModels(newData, DEFAULT_CHAT_MODELS_V17)

  if (typeof newData.chatModelId === 'string') {
    newData.chatModelId =
      LEGACY_MODEL_ID_MAP[newData.chatModelId] ?? newData.chatModelId
  }
  if (typeof newData.applyModelId === 'string') {
    newData.applyModelId =
      LEGACY_MODEL_ID_MAP[newData.applyModelId] ?? newData.applyModelId
  }

  if (Array.isArray(newData.chatModels)) {
    newData.chatModels = (newData.chatModels as unknown[]).map(
      (model: unknown) => {
        const modelId = (model as { id?: unknown }).id
        if (typeof modelId === 'string' && LEGACY_MODEL_IDS.has(modelId)) {
          return {
            ...(model as Record<string, unknown>),
            enable: false,
          }
        }
        return model
      },
    )
  }

  return newData
}
