import { LLMRequestStreaming } from '../../../types/llm/request'

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
})
