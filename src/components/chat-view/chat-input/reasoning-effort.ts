import {
  CLAUDE_ADAPTIVE_EFFORTS,
  ChatModel,
  ClaudeEffort,
  GPT_5_6_EFFORTS,
  Gpt56Effort,
} from '../../../types/chat-model.types'

export type QuickReasoningEffort = Gpt56Effort | ClaudeEffort | 'off'

export type QuickReasoningOption = {
  value: QuickReasoningEffort
  label: string
  description: string
}

export type QuickReasoningControl = {
  kind: 'gpt' | 'claude'
  label: string
  value: QuickReasoningEffort
  options: readonly QuickReasoningOption[]
}

const GPT_5_6_DEFAULT_EFFORTS: Record<string, Gpt56Effort> = {
  'gpt-5.6-sol': 'medium',
  'gpt-5.6-terra': 'low',
  'gpt-5.6-luna': 'none',
}

export const GPT_QUICK_REASONING_OPTIONS: readonly QuickReasoningOption[] = [
  { value: 'none', label: 'none', description: 'Fastest response' },
  { value: 'low', label: 'low', description: 'Light reasoning' },
  { value: 'medium', label: 'medium', description: 'Balanced reasoning' },
  { value: 'high', label: 'high', description: 'Deeper reasoning' },
  { value: 'xhigh', label: 'xhigh', description: 'Very deep reasoning' },
  { value: 'max', label: 'max', description: 'Deepest reasoning' },
]

export const CLAUDE_QUICK_REASONING_OPTIONS: readonly QuickReasoningOption[] = [
  { value: 'off', label: 'off', description: 'Adaptive thinking disabled' },
  { value: 'low', label: 'low', description: 'Light reasoning' },
  { value: 'medium', label: 'medium', description: 'Balanced reasoning' },
  { value: 'high', label: 'high', description: 'Deeper reasoning' },
  { value: 'xhigh', label: 'xhigh', description: 'Very deep reasoning' },
  { value: 'max', label: 'max', description: 'Deepest reasoning' },
]

function isGpt56PlanModel(
  model: ChatModel,
): model is Extract<ChatModel, { providerType: 'openai-plan' }> {
  return (
    model.providerType === 'openai-plan' &&
    (model.model === 'gpt-5.6-sol' ||
      model.model === 'gpt-5.6-terra' ||
      model.model === 'gpt-5.6-luna')
  )
}

function isClaudeAdaptivePlanModel(
  model: ChatModel,
): model is Extract<ChatModel, { providerType: 'anthropic-plan' }> {
  return (
    model.providerType === 'anthropic-plan' &&
    (model.thinking?.mode === 'adaptive' ||
      ['default', 'opus', 'sonnet'].includes(model.model) ||
      /^claude-(opus|sonnet)-/i.test(model.model))
  )
}

function isGpt56Effort(value: string | undefined): value is Gpt56Effort {
  return GPT_5_6_EFFORTS.includes(value as Gpt56Effort)
}

function isClaudeEffort(value: string): value is ClaudeEffort {
  return CLAUDE_ADAPTIVE_EFFORTS.includes(value as ClaudeEffort)
}

export function getQuickReasoningControl(
  model: ChatModel | undefined,
): QuickReasoningControl | null {
  if (!model) {
    return null
  }

  if (isGpt56PlanModel(model)) {
    const configuredEffort = model.reasoning?.reasoning_effort
    return {
      kind: 'gpt',
      label: 'GPT reasoning effort',
      value: isGpt56Effort(configuredEffort)
        ? configuredEffort
        : GPT_5_6_DEFAULT_EFFORTS[model.model],
      options: GPT_QUICK_REASONING_OPTIONS,
    }
  }

  if (isClaudeAdaptivePlanModel(model)) {
    const adaptiveThinking =
      model.thinking?.mode === 'adaptive' ? model.thinking : undefined
    return {
      kind: 'claude',
      label: 'Claude adaptive thinking',
      value:
        model.thinking?.enabled === false
          ? 'off'
          : (adaptiveThinking?.effort ?? 'high'),
      options: CLAUDE_QUICK_REASONING_OPTIONS,
    }
  }

  return null
}

export function updateQuickReasoningEffort(
  model: ChatModel,
  value: string,
): ChatModel {
  if (isGpt56PlanModel(model)) {
    if (!isGpt56Effort(value)) {
      throw new Error(`Unsupported GPT-5.6 reasoning effort: ${value}`)
    }

    const reasoning = {
      ...model.reasoning,
      reasoning_effort: value,
    }
    if (value === 'none') {
      delete reasoning.reasoning_summary
    }

    return {
      ...model,
      reasoning,
    }
  }

  if (isClaudeAdaptivePlanModel(model)) {
    if (value !== 'off' && !isClaudeEffort(value)) {
      throw new Error(`Unsupported Claude reasoning effort: ${value}`)
    }

    const adaptiveThinking =
      model.thinking?.mode === 'adaptive' ? model.thinking : undefined

    return {
      ...model,
      thinking: {
        enabled: value !== 'off',
        mode: 'adaptive',
        effort: value === 'off' ? (adaptiveThinking?.effort ?? 'high') : value,
        display: adaptiveThinking?.display ?? 'summarized',
      },
    }
  }

  throw new Error(`Quick reasoning control is not supported for ${model.model}`)
}
