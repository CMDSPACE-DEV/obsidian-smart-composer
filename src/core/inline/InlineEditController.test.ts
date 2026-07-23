import {
  buildInlineInsertion,
  getInlineEditSystemPrompt,
  isShortProseEdit,
  parseInlineResponse,
  resolveInlineEditPlacement,
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

  it('parses replacement, insertion, and clarification JSON', () => {
    expect(
      parseInlineResponse(
        '```json\n{"type":"replacement","content":"Rewritten"}\n```',
      ),
    ).toEqual({ type: 'replacement', content: 'Rewritten' })
    expect(
      parseInlineResponse(
        '{"type":"insertion","content":"## New summary\\n\\nConcise."}',
      ),
    ).toEqual({
      type: 'insertion',
      content: '## New summary\n\nConcise.',
    })
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

  it('detects requests to add content below while preserving explicit modes', () => {
    expect(
      resolveInlineEditPlacement(
        '여태까지 선택된 내용을 요약해서 아래에 추가',
        'auto',
      ),
    ).toBe('insert-after')
    expect(
      resolveInlineEditPlacement('Append a concise summary below it', 'auto'),
    ).toBe('insert-after')
    expect(
      resolveInlineEditPlacement('아래 내용을 짧게 요약해줘', 'auto'),
    ).toBe('replace')
    expect(resolveInlineEditPlacement('아래에 추가해줘', 'replace')).toBe(
      'replace',
    )
    expect(resolveInlineEditPlacement('Rewrite this', 'insert-after')).toBe(
      'insert-after',
    )
  })

  it('inserts generated Markdown after the selection with stable spacing', () => {
    expect(buildInlineInsertion('Selected\n\n## Next', 8, '## Summary')).toBe(
      '\n\n## Summary',
    )
    expect(buildInlineInsertion('Selected\n## Next', 9, '## Summary')).toBe(
      '\n## Summary\n\n',
    )
    expect(buildInlineInsertion('Selected## Next', 8, '## Summary')).toBe(
      '\n\n## Summary\n\n',
    )
    expect(buildInlineInsertion('Selected', 8, '## Summary\n')).toBe(
      '\n\n## Summary',
    )
    const largeSelection = 'source '.repeat(1600).trim()
    const insertion = buildInlineInsertion(
      `${largeSelection}\n\n## Next`,
      largeSelection.length,
      '## Compact summary',
    )
    expect(insertion).toBe('\n\n## Compact summary')
    expect(insertion).not.toContain(largeSelection)
  })

  it('requires insertion mode to return only new Markdown', () => {
    const insertionPrompt = getInlineEditSystemPrompt('insert-after')
    expect(insertionPrompt).toContain('read-only source material')
    expect(insertionPrompt).toContain('only the new Markdown')
    expect(insertionPrompt).toContain('never repeat')
    expect(insertionPrompt).toContain('"type":"insertion"')
    expect(getInlineEditSystemPrompt('replace')).toContain(
      '"type":"replacement"',
    )
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
