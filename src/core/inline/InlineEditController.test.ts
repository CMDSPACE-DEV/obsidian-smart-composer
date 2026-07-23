import { ChangeSet } from '@codemirror/state'

import {
  buildInlineInsertion,
  getInlineEditSystemPrompt,
  inlineEditRangesOverlap,
  isInlineSourceCurrent,
  isShortProseEdit,
  mapInlineEditRange,
  parseInlineResponse,
  rebaseInlineEditSessions,
  resolveInlineEditPlacement,
  resolveInlineSkin,
  updateInlineEditSessionMap,
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

  it('rebases independent inline ranges across preceding edits', () => {
    const originalDocument = 'alpha beta gamma'
    const secondRange = { from: 6, to: 10 }
    const firstEdit = ChangeSet.of(
      [{ from: 0, to: 5, insert: 'A' }],
      originalDocument.length,
    )
    const mapped = mapInlineEditRange(secondRange, firstEdit)

    expect(mapped).toEqual({ from: 2, to: 6 })
    expect(isInlineSourceCurrent('A beta gamma', mapped, 'beta')).toBe(true)
  })

  it('preserves every active session while rebasing their positions', () => {
    const sessions = new Map([
      ['first', { from: 0, to: 5, label: 'first' }],
      ['second', { from: 6, to: 10, label: 'second' }],
    ])
    const rebased = rebaseInlineEditSessions(
      sessions,
      ChangeSet.of([{ from: 0, to: 5, insert: 'A' }], 16),
    )

    expect(rebased.size).toBe(2)
    expect(rebased.get('first')).toEqual({
      from: 0,
      to: 1,
      label: 'first',
    })
    expect(rebased.get('second')).toEqual({
      from: 2,
      to: 6,
      label: 'second',
    })
  })

  it('adds and removes one inline session without replacing its siblings', () => {
    const identityChanges = ChangeSet.empty(30)
    const first = { id: 'first', from: 0, to: 5 }
    const second = { id: 'second', from: 10, to: 15 }
    const third = { id: 'third', from: 20, to: 25 }
    const withTwo = updateInlineEditSessionMap(
      new Map([['first', first]]),
      identityChanges,
      [second],
      [],
    )
    const replacedOne = updateInlineEditSessionMap(
      withTwo,
      identityChanges,
      [third],
      ['first'],
    )

    expect(withTwo.size).toBe(2)
    expect(withTwo.get('first')).toEqual(first)
    expect(withTwo.get('second')).toEqual(second)
    expect(replacedOne.size).toBe(2)
    expect(replacedOne.has('first')).toBe(false)
    expect(replacedOne.get('second')).toEqual(second)
    expect(replacedOne.get('third')).toEqual(third)
  })

  it('keeps boundary insertions outside an existing source range', () => {
    const range = { from: 10, to: 20 }
    expect(
      mapInlineEditRange(
        range,
        ChangeSet.of([{ from: 10, insert: 'abc' }], 30),
      ),
    ).toEqual({ from: 13, to: 23 })
    expect(
      mapInlineEditRange(
        range,
        ChangeSet.of([{ from: 20, insert: 'abc' }], 30),
      ),
    ).toEqual(range)
  })

  it('detects overlapping targets and stale source content', () => {
    expect(
      inlineEditRangesOverlap({ from: 0, to: 6 }, { from: 5, to: 10 }),
    ).toBe(true)
    expect(
      inlineEditRangesOverlap({ from: 0, to: 5 }, { from: 5, to: 10 }),
    ).toBe(false)
    expect(
      inlineEditRangesOverlap({ from: 5, to: 5 }, { from: 5, to: 5 }),
    ).toBe(true)
    expect(
      isInlineSourceCurrent('A changed gamma', { from: 2, to: 9 }, 'beta'),
    ).toBe(false)
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
