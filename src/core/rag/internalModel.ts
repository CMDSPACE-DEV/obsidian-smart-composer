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

  if (
    model.providerType === 'anthropic-plan' &&
    model.model === 'claude-sonnet-5'
  ) {
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

/** Plan entitlement/rate/model errors must reach the user instead of a quiet RAG fallback. */
export function shouldSurfacePlanRequestError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }
  const status = 'status' in error ? error.status : undefined
  const code = 'code' in error ? error.code : undefined
  return (
    status === 400 ||
    status === 403 ||
    status === 404 ||
    status === 429 ||
    code === 'model_mismatch'
  )
}
