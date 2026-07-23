import { ChatModel } from '../../types/chat-model.types'

import { getProviderCapabilities } from './providerCapabilities'

function model(
  providerType: ChatModel['providerType'],
  modelName: string,
): ChatModel {
  return {
    id: `${modelName} test`,
    model: modelName,
    providerId: providerType,
    providerType,
  } as ChatModel
}

describe('getProviderCapabilities', () => {
  it.each(['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'])(
    'enables native image generation only for supported GPT Plan model %s',
    (modelName) => {
      expect(
        getProviderCapabilities(model('openai-plan', modelName)),
      ).toMatchObject({
        plan: true,
        imageGeneration: true,
        outputTokenLimit: false,
      })
      expect(
        getProviderCapabilities(model('openai', modelName)).imageGeneration,
      ).toBe(false)
    },
  )

  it('keeps Claude Plan tools and reasoning while disabling images', () => {
    expect(
      getProviderCapabilities(model('anthropic-plan', 'claude-sonnet-5-0')),
    ).toEqual({
      plan: true,
      tools: true,
      reasoningEffort: true,
      imageGeneration: false,
      outputTokenLimit: true,
    })
  })

  it('marks legacy Gemini Plan as non-tooling metadata', () => {
    expect(
      getProviderCapabilities(model('gemini-plan', 'gemini-3-pro-preview')),
    ).toMatchObject({
      plan: true,
      tools: false,
      imageGeneration: false,
    })
  })
})
