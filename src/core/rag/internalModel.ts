import { ChatModel } from '../../types/chat-model.types'

const GPT_5_6_PLAN_MODELS = new Set([
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
])

/** Returns a copy suitable for deterministic, low-token internal RAG calls. */
export function getInternalRagModel(model: ChatModel): ChatModel {
  if (
    model.providerType === 'openai-plan' &&
    GPT_5_6_PLAN_MODELS.has(model.model)
  ) {
    return {
      ...model,
      reasoning: {
        reasoning_effort: 'none',
      },
    }
  }

  if (model.providerType === 'anthropic-plan') {
    const adaptive =
      model.thinking?.mode === 'adaptive' ? model.thinking : undefined
    return {
      ...model,
      thinking: {
        enabled: false,
        mode: 'adaptive',
        effort: adaptive?.effort ?? 'high',
        display: adaptive?.display ?? 'summarized',
      },
    }
  }

  if ('thinking' in model) {
    return { ...model, thinking: undefined } as ChatModel
  }
  if ('reasoning' in model) {
    return { ...model, reasoning: undefined } as ChatModel
  }
  return model
}

/** Only authentication failure prevents a useful local retrieval fallback. */
export function shouldSurfacePlanRequestError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }
  const status = 'status' in error ? error.status : undefined
  return status === 401
}

export function describePlanRequestError(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return 'Plan retrieval failed; local ranking was used.'
  }
  const status = 'status' in error ? String(error.status) : ''
  const suffix = status ? ` (HTTP ${status})` : ''
  return `Plan retrieval failed${suffix}; local ranking was used.`
}
