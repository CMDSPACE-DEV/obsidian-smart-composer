import { SettingMigration } from '../setting.types'

const LEGACY_GPT_PLAN_ID = 'gpt-5.5 (plan)'
const LEGACY_CLAUDE_PLAN_ID = 'claude-sonnet-4.6 (plan)'
const GPT_SOL_PLAN_ID = 'gpt-5.6-sol (plan)'
const CLAUDE_SONNET_5_PLAN_ID = 'claude-sonnet-5 (plan)'

type ModelData = Record<string, unknown> & {
  id?: string
  reasoning?: Record<string, unknown>
  thinking?: Record<string, unknown>
}

const GPT_5_6_DEFAULTS: ModelData[] = [
  {
    providerType: 'openai-plan',
    providerId: 'openai-plan',
    id: GPT_SOL_PLAN_ID,
    model: 'gpt-5.6-sol',
    reasoning: { reasoning_effort: 'medium' },
  },
  {
    providerType: 'openai-plan',
    providerId: 'openai-plan',
    id: 'gpt-5.6-terra (plan)',
    model: 'gpt-5.6-terra',
    reasoning: { reasoning_effort: 'low' },
  },
  {
    providerType: 'openai-plan',
    providerId: 'openai-plan',
    id: 'gpt-5.6-luna (plan)',
    model: 'gpt-5.6-luna',
    reasoning: { reasoning_effort: 'none' },
  },
]

const CLAUDE_SONNET_5_DEFAULT: ModelData = {
  providerType: 'anthropic-plan',
  providerId: 'anthropic-plan',
  id: CLAUDE_SONNET_5_PLAN_ID,
  model: 'claude-sonnet-5',
  thinking: {
    enabled: true,
    mode: 'adaptive',
    effort: 'high',
    display: 'summarized',
  },
}

const NEW_PLAN_DEFAULTS = [CLAUDE_SONNET_5_DEFAULT, ...GPT_5_6_DEFAULTS]
const NEW_PLAN_IDS = new Set(NEW_PLAN_DEFAULTS.map((model) => model.id))
const LEGACY_PLAN_IDS = new Set([LEGACY_GPT_PLAN_ID, LEGACY_CLAUDE_PLAN_ID])

export const migrateFrom18To19: SettingMigration['migrate'] = (data) => {
  const oldModels = Array.isArray(data.chatModels)
    ? (data.chatModels as ModelData[])
    : []
  const legacyGpt = oldModels.find((model) => model.id === LEGACY_GPT_PLAN_ID)
  const legacyClaude = oldModels.find(
    (model) => model.id === LEGACY_CLAUDE_PLAN_ID,
  )
  const insertionIndex = findInsertionIndex(oldModels)
  const remainingModels = oldModels
    .filter(
      (model) =>
        !LEGACY_PLAN_IDS.has(model.id ?? '') &&
        !NEW_PLAN_IDS.has(model.id ?? ''),
    )
    .map(cloneModel)

  const newModels = NEW_PLAN_DEFAULTS.map((defaultModel) => {
    const existing = oldModels.find((model) => model.id === defaultModel.id)
    const migratedLegacy =
      defaultModel.id === GPT_SOL_PLAN_ID
        ? getMigratedGptSettings(legacyGpt)
        : defaultModel.id === CLAUDE_SONNET_5_PLAN_ID
          ? getMigratedClaudeSettings(legacyClaude)
          : undefined
    return mergeModel(defaultModel, migratedLegacy, existing)
  })

  const boundedInsertionIndex = Math.min(insertionIndex, remainingModels.length)
  const chatModels = [
    ...remainingModels.slice(0, boundedInsertionIndex),
    ...newModels,
    ...remainingModels.slice(boundedInsertionIndex),
  ]

  return {
    ...data,
    version: 19,
    chatModels,
    chatModelId: remapSelectedModel(data.chatModelId),
    applyModelId: remapSelectedModel(data.applyModelId),
  }
}

function findInsertionIndex(models: ModelData[]): number {
  const legacyIndex = models.findIndex((model) =>
    LEGACY_PLAN_IDS.has(model.id ?? ''),
  )
  if (legacyIndex >= 0) return legacyIndex

  const opusIndex = models.findIndex(
    (model) => model.id === 'claude-opus-4.8 (plan)',
  )
  return opusIndex >= 0 ? opusIndex + 1 : 0
}

function remapSelectedModel(value: unknown): unknown {
  if (value === LEGACY_GPT_PLAN_ID) return GPT_SOL_PLAN_ID
  if (value === LEGACY_CLAUDE_PLAN_ID) return CLAUDE_SONNET_5_PLAN_ID
  return value
}

function getMigratedGptSettings(model?: ModelData): ModelData | undefined {
  if (!model) return undefined

  return {
    reasoning: normalizeGptReasoning(model.reasoning, 'medium'),
  }
}

function normalizeGptReasoning(
  reasoning: Record<string, unknown> | undefined,
  fallbackEffort: string,
): Record<string, unknown> {
  const rawEffort = reasoning?.reasoning_effort
  const effort =
    rawEffort === 'minimal'
      ? 'low'
      : ['none', 'low', 'medium', 'high', 'xhigh', 'max'].includes(
            String(rawEffort),
          )
        ? rawEffort
        : fallbackEffort
  const rawSummary = reasoning?.reasoning_summary
  const summary =
    effort !== 'none' &&
    ['auto', 'concise', 'detailed'].includes(String(rawSummary))
      ? rawSummary
      : undefined

  return {
    reasoning_effort: effort,
    ...(summary ? { reasoning_summary: summary } : {}),
  }
}

function getMigratedClaudeSettings(model?: ModelData): ModelData | undefined {
  if (!model) return undefined

  return {
    thinking: normalizeClaudeThinking(model.thinking),
  }
}

function normalizeClaudeThinking(
  thinking: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const isAdaptive = thinking?.mode === 'adaptive'
  const effort =
    isAdaptive &&
    ['low', 'medium', 'high', 'xhigh', 'max'].includes(String(thinking.effort))
      ? thinking.effort
      : 'high'
  const display =
    isAdaptive && ['summarized', 'omitted'].includes(String(thinking.display))
      ? thinking.display
      : 'summarized'

  return {
    enabled: thinking?.enabled !== false,
    mode: 'adaptive',
    effort,
    display,
  }
}

function mergeModel(
  defaultModel: ModelData,
  migratedLegacy?: ModelData,
  existing?: ModelData,
): ModelData {
  const merged = {
    ...cloneModel(defaultModel),
    ...(migratedLegacy ? cloneModel(migratedLegacy) : {}),
    ...(existing ? cloneModel(existing) : {}),
    providerType: defaultModel.providerType,
    providerId: defaultModel.providerId,
    id: defaultModel.id,
    model: defaultModel.model,
  }

  if (defaultModel.reasoning) {
    merged.reasoning = normalizeGptReasoning(
      existing?.reasoning ?? migratedLegacy?.reasoning,
      String(defaultModel.reasoning.reasoning_effort ?? 'medium'),
    )
  }
  if (defaultModel.thinking) {
    merged.thinking = normalizeClaudeThinking(
      existing?.thinking ?? migratedLegacy?.thinking,
    )
  }

  return merged
}

function cloneModel(model: ModelData): ModelData {
  return {
    ...model,
    ...(model.reasoning ? { reasoning: { ...model.reasoning } } : {}),
    ...(model.thinking ? { thinking: { ...model.thinking } } : {}),
  }
}
