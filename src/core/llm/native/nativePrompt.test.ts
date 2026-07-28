import { LLMRequestStreaming } from '../../../types/llm/request'

import { createClaudePromptInput } from './ClaudeAgentProvider'
import { buildNativePrompt } from './nativePrompt'

describe('native runtime prompts', () => {
  const imageDataUrl = 'data:image/png;base64,aGVsbG8='
  const messages: LLMRequestStreaming['messages'] = [
    {
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: imageDataUrl } },
        { type: 'text', text: 'Describe this image.' },
      ],
    },
  ]

  it('does not duplicate base64 image data in the text transcript', () => {
    const prompt = buildNativePrompt(messages)

    expect(prompt.prompt).toContain('Describe this image.')
    expect(prompt.prompt).toContain('included separately')
    expect(prompt.prompt).not.toContain('aGVsbG8=')
  })

  it('passes Claude images as native multimodal blocks', async () => {
    const input = createClaudePromptInput('Describe this image.', messages)
    expect(typeof input).not.toBe('string')

    const chunks = []
    for await (const chunk of input as AsyncIterable<unknown>) {
      chunks.push(chunk)
    }

    expect(chunks).toEqual([
      expect.objectContaining({
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: 'aGVsbG8=',
              },
            },
            { type: 'text', text: 'Describe this image.' },
          ],
        },
      }),
    ])
  })
})
