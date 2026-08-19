import { findMentionTrigger, removeMentionTrigger } from './mentionTrigger'

describe('inline mention trigger', () => {
  it('finds Korean and spaced reference queries at the cursor', () => {
    expect(findMentionTrigger('Rewrite with @편집 정리', 19)).toEqual({
      from: 13,
      to: 19,
      query: '편집 정리',
    })
    expect(findMentionTrigger('@Project Notes', 14)).toEqual({
      from: 0,
      to: 14,
      query: 'Project Notes',
    })
  })

  it('does not treat email addresses or a previous line as a mention', () => {
    expect(findMentionTrigger('mail@example.com', 16)).toBeNull()
    expect(findMentionTrigger('@old\nnew line', 13)).toBeNull()
  })

  it('removes only the active trigger after a reference is selected', () => {
    expect(
      removeMentionTrigger('Use @Prompt Note to revise', {
        from: 4,
        to: 16,
        query: 'Prompt Note',
      }),
    ).toEqual({
      value: 'Use to revise',
      cursor: 4,
    })
  })
})
