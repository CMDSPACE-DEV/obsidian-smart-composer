import { ChatModel } from '../../types/chat-model.types'

export type ProviderCapabilities = {
  plan: boolean
  tools: boolean
  reasoningEffort: boolean
  imageGeneration: boolean
  outputTokenLimit: boolean
}

export function getProviderCapabilities(
  model: ChatModel,
): ProviderCapabilities {
  const plan = model.providerType.endsWith('-plan')
  const openAIPlan = model.providerType === 'openai-plan'

  return {
    plan,
    tools: true,
    reasoningEffort:
      model.providerType === 'openai-plan' ||
      model.providerType === 'openai' ||
      model.providerType === 'anthropic-plan' ||
      model.providerType === 'anthropic',
    imageGeneration:
      openAIPlan &&
      ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'].includes(model.model),
    // The private Codex endpoint currently rejects max_output_tokens.
    outputTokenLimit: !openAIPlan,
  }
}
