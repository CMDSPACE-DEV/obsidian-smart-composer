import { ChatMessage } from '../../types/chat'

import { hasVisibleResponseOutput } from './responseState'

describe('response state', () => {
  it('keeps waiting for an empty assistant placeholder', () => {
    const messages: ChatMessage[] = [
      { role: 'assistant', id: 'assistant', content: '   ' },
    ]

    expect(hasVisibleResponseOutput(messages)).toBe(false)
  })

  it('detects the first visible response event', () => {
    const cases: ChatMessage[][] = [
      [{ role: 'assistant', id: 'text', content: 'Hello' }],
      [
        {
          role: 'assistant',
          id: 'reasoning',
          content: '',
          reasoning: 'Thinking',
        },
      ],
      [
        {
          role: 'assistant',
          id: 'annotation',
          content: '',
          annotations: [
            {
              type: 'url_citation',
              url_citation: {
                url: 'https://example.com',
                title: 'Example',
                start_index: 0,
                end_index: 1,
              },
            },
          ],
        },
      ],
      [{ role: 'tool', id: 'tool', toolCalls: [] }],
    ]

    for (const messages of cases) {
      expect(hasVisibleResponseOutput(messages)).toBe(true)
    }
  })
})
