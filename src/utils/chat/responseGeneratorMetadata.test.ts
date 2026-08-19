import { mergeProviderMetadata } from './responseGenerator'

describe('mergeProviderMetadata', () => {
  it('replaces Anthropic snapshots and preserves other namespaces', () => {
    expect(
      mergeProviderMetadata(
        {
          anthropic: {
            thinkingBlocks: [
              { type: 'thinking', thinking: 'old', signature: 'old-signature' },
            ],
          },
          gemini: { thoughtSignature: 'gemini-signature' },
        },
        {
          anthropic: {
            thinkingBlocks: [
              { type: 'redacted_thinking', data: 'opaque-data' },
            ],
          },
        },
      ),
    ).toEqual({
      anthropic: {
        thinkingBlocks: [{ type: 'redacted_thinking', data: 'opaque-data' }],
      },
      gemini: { thoughtSignature: 'gemini-signature' },
      openaiCodex: undefined,
      deepseek: undefined,
    })
  })

  it('keeps the first Gemini signature and appends DeepSeek deltas', () => {
    expect(
      mergeProviderMetadata(
        {
          gemini: { thoughtSignature: 'first' },
          deepseek: { reasoningContent: 'one' },
        },
        {
          gemini: { thoughtSignature: 'second' },
          deepseek: { reasoningContent: 'two' },
        },
      ),
    ).toMatchObject({
      gemini: { thoughtSignature: 'first' },
      deepseek: { reasoningContent: 'onetwo' },
    })
  })

  it('merges Codex model and output snapshots', () => {
    expect(
      mergeProviderMetadata(
        { openaiCodex: { model: 'gpt-5.6-sol' } },
        { openaiCodex: { outputItems: [{ type: 'reasoning' }] } },
      ),
    ).toMatchObject({
      openaiCodex: {
        model: 'gpt-5.6-sol',
        outputItems: [{ type: 'reasoning' }],
      },
    })
  })
})
