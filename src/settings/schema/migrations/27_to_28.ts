import { SettingMigration } from '../setting.types'

const CLAUDE_SONNET_LATEST_ID = 'claude-sonnet-latest (plan)'
const LEGACY_CLAUDE_SONNET_ID = 'claude-sonnet-5 (plan)'

export const migrateFrom27To28: SettingMigration['migrate'] = (data) => {
  const chatModels = Array.isArray(data.chatModels)
    ? upsertSonnetAlias(data.chatModels)
    : data.chatModels
  const inlineEdit = isRecord(data.inlineEdit)
    ? {
        ...data.inlineEdit,
        modelId: mapSelectedModel(data.inlineEdit.modelId),
      }
    : data.inlineEdit

  return {
    ...data,
    version: 28,
    chatModels,
    chatModelId: mapSelectedModel(data.chatModelId),
    inlineEdit,
    nativeRuntimes: clearStaleClaudeCatalogError(data.nativeRuntimes),
  }
}

function upsertSonnetAlias(values: unknown[]): unknown[] {
  const replacement = {
    providerType: 'anthropic-plan',
    providerId: 'anthropic-plan',
    id: CLAUDE_SONNET_LATEST_ID,
    model: 'sonnet',
    enable: true,
    thinking: {
      enabled: true,
      mode: 'adaptive',
      effort: 'high',
      display: 'summarized',
    },
  }
  const existingIndex = values.findIndex(
    (value) => isRecord(value) && value.id === CLAUDE_SONNET_LATEST_ID,
  )
  if (existingIndex === -1) return [replacement, ...values]
  return values.map((value, index) =>
    index === existingIndex && isRecord(value)
      ? { ...value, ...replacement }
      : value,
  )
}

function mapSelectedModel(value: unknown): unknown {
  return value === LEGACY_CLAUDE_SONNET_ID ? CLAUDE_SONNET_LATEST_ID : value
}

function clearStaleClaudeCatalogError(value: unknown): unknown {
  if (!isRecord(value) || !isRecord(value.claude)) return value
  const claude = value.claude
  if (
    claude.status !== 'ready' ||
    typeof claude.error !== 'string' ||
    !/stable model aliases because catalog refresh failed/i.test(claude.error)
  ) {
    return value
  }
  const { error: _staleError, ...nextClaude } = claude
  return {
    ...value,
    claude: nextClaude,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
