import { SettingMigration } from '../setting.types'

const DEFAULT_APPLY_MODEL_ID = 'gpt-4.1-mini'
const DEFAULT_IMAGE_MODEL_ID = 'gpt-5.6-sol (plan)'

type ModelData = Record<string, unknown> & {
  providerType?: string
}

export const migrateFrom19To20: SettingMigration['migrate'] = (data) => {
  const legacyApplyModelId =
    typeof data.applyModelId === 'string' ? data.applyModelId : undefined
  const chatModels = Array.isArray(data.chatModels)
    ? (data.chatModels as ModelData[]).map((model) =>
        model.providerType === 'gemini-plan'
          ? { ...model, enable: false }
          : { ...model },
      )
    : data.chatModels
  const chatModelId =
    typeof data.chatModelId === 'string' &&
    data.chatModelId.includes('gemini') &&
    data.chatModelId.endsWith('(plan)')
      ? DEFAULT_IMAGE_MODEL_ID
      : data.chatModelId

  const migrated: Record<string, unknown> = {
    ...data,
    version: 20,
    chatModels,
    chatModelId,
    inlineEdit: {
      modelId:
        legacyApplyModelId && legacyApplyModelId !== DEFAULT_APPLY_MODEL_ID
          ? legacyApplyModelId
          : null,
      contextCharacters: 4000,
    },
    imageGeneration: {
      modelId: DEFAULT_IMAGE_MODEL_ID,
      outputFolder: 'Smart Composer/Generated Images',
      quality: 'high',
      concurrency: 1,
    },
    appearance: {
      skinMode: 'follow-obsidian',
    },
  }

  delete migrated.applyModelId
  return migrated
}
