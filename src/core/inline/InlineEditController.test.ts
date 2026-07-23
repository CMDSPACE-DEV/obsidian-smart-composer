import {
  isShortProseEdit,
  parseInlineResponse,
  resolveInlineSkin,
} from './InlineEditController'

describe('inline edit response helpers', () => {
  it('uses an inline word diff for short prose only', () => {
    expect(
      isShortProseEdit(
        'This sentence is clear.',
        'This sentence is much clearer.',
      ),
    ).toBe(true)
    expect(
      isShortProseEdit(
        '# Heading\n\n- first',
        '# Better heading\n\n- first\n- second',
      ),
    ).toBe(false)
    expect(
      isShortProseEdit('Use [[Current note]].', 'Use [[Target note]].'),
    ).toBe(false)
  })

  it('parses replacement and clarification JSON', () => {
    expect(
      parseInlineResponse(
        '```json\n{"type":"replacement","content":"Rewritten"}\n```',
      ),
    ).toEqual({ type: 'replacement', content: 'Rewritten' })
    expect(
      parseInlineResponse(
        '{"type":"clarification","content":"Which audience?"}',
      ),
    ).toEqual({ type: 'clarification', content: 'Which audience?' })
  })

  it('accepts direct text from older or custom models', () => {
    expect(parseInlineResponse('Direct replacement')).toEqual({
      type: 'replacement',
      content: 'Direct replacement',
    })
  })

  it('maps the owning Obsidian document theme to the matching inline skin', () => {
    expect(
      resolveInlineSkin({
        contains: (className) => className === 'theme-dark',
      }),
    ).toBe('cmds-dark')
    expect(resolveInlineSkin({ contains: () => false })).toBe('hallym-light')
  })
})
