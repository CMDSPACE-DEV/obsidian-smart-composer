import { SettingMigration } from '../setting.types'

const CLAUDE_OPUS_LATEST_ID = 'claude-opus-latest (plan)'
const CLAUDE_DEFAULT_ID = 'claude-default (plan)'
const CLAUDE_HAIKU_LATEST_ID = 'claude-haiku-latest (plan)'

export const migrateFrom26To27: SettingMigration['migrate'] = (data) => {
  const providers = Array.isArray(data.providers)
    ? data.providers.map(removeLegacyPlanOAuth)
    : data.providers
  const chatModels = Array.isArray(data.chatModels)
    ? migrateChatModels(data.chatModels)
    : data.chatModels
  const chatModelId = mapSelectedModel(data.chatModelId)
  const inlineEdit = isRecord(data.inlineEdit)
    ? {
        ...data.inlineEdit,
        modelId: mapSelectedModel(data.inlineEdit.modelId),
      }
    : data.inlineEdit

  return {
    ...data,
    version: 27,
    providers,
    chatModels,
    chatModelId,
    inlineEdit,
    nativeRuntimes: {
      claude: { status: 'not-installed', models: [] },
      gemini: { status: 'not-installed', models: [] },
    },
  }
}

function removeLegacyPlanOAuth(value: unknown): unknown {
  if (!isRecord(value)) return value
  if (value.type !== 'anthropic-plan' && value.type !== 'gemini-plan') {
    return value
  }
  const { oauth: _oauth, ...provider } = value
  return provider
}

function migrateChatModels(values: unknown[]): unknown[] {
  const migrated = values.map((value) => {
    if (!isRecord(value) || value.providerType !== 'anthropic-plan') {
      return value
    }
    if (value.id === 'claude-opus-4.8 (plan)') {
      return { ...value, enable: false }
    }
    if (value.id === 'claude-sonnet-5 (plan)') {
      return { ...value, enable: false }
    }
    return value
  })

  return upsertById(
    upsertById(
      upsertById(migrated, {
        providerType: 'anthropic-plan',
        providerId: 'anthropic-plan',
        id: CLAUDE_OPUS_LATEST_ID,
        model: 'opus',
        enable: true,
        thinking: {
          enabled: true,
          mode: 'adaptive',
          effort: 'high',
          display: 'summarized',
        },
      }),
      {
        providerType: 'anthropic-plan',
        providerId: 'anthropic-plan',
        id: CLAUDE_DEFAULT_ID,
        model: 'default',
        enable: true,
        thinking: {
          enabled: true,
          mode: 'adaptive',
          effort: 'high',
          display: 'summarized',
        },
      },
    ),
    {
      providerType: 'anthropic-plan',
      providerId: 'anthropic-plan',
      id: CLAUDE_HAIKU_LATEST_ID,
      model: 'haiku',
      enable: true,
    },
  )
}

function upsertById(values: unknown[], replacement: Record<string, unknown>) {
  const index = values.findIndex(
    (value) => isRecord(value) && value.id === replacement.id,
  )
  if (index === -1) return [replacement, ...values]
  return values.map((value, valueIndex) =>
    valueIndex === index && isRecord(value)
      ? { ...value, ...replacement }
      : value,
  )
}

function mapSelectedModel(value: unknown): unknown {
  if (value === 'claude-opus-4.8 (plan)') return CLAUDE_OPUS_LATEST_ID
  if (value === 'claude-sonnet-5 (plan)') return CLAUDE_DEFAULT_ID
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
