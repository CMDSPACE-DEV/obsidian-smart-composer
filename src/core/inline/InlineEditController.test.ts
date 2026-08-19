import { ChangeSet } from '@codemirror/state'
import { App } from 'obsidian'

import {
  buildInlineInsertion,
  getChangedReferencePaths,
  getInlineEditSystemPrompt,
  getInlineSourceWithoutInsertions,
  isInlineSourceCurrent,
  isShortProseEdit,
  mapInlineEditRange,
  parseInlineResponse,
  rebaseInlineEditSessions,
  recordAcceptedInlineInsertion,
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

  it('keeps concurrent sessions that target the exact same source range', () => {
    const identityChanges = ChangeSet.empty(30)
    const first = { id: 'first', from: 5, to: 20, status: 'loading' }
    const second = { id: 'second', from: 5, to: 20, status: 'prompt' }

    const sessions = updateInlineEditSessionMap(
      new Map([['first', first]]),
      identityChanges,
      [second],
      [],
    )

    expect(sessions.size).toBe(2)
    expect(sessions.get('first')).toEqual(first)
    expect(sessions.get('second')).toEqual(second)
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

  it('moves an insert-below anchor after an accepted sibling insertion', () => {
    const original = 'AAAAABBBBBCCCCCDDDDD'
    const before = new Map([
      [
        'outer',
        {
          id: 'outer',
          from: 0,
          to: original.length,
          insertAt: original.length,
          ignoredInsertions: [],
        },
      ],
      [
        'inner',
        {
          id: 'inner',
          from: 5,
          to: 10,
          insertAt: 10,
          ignoredInsertions: [],
        },
      ],
    ])
    const inserted = '[inner]'
    const changes = ChangeSet.of(
      [{ from: 10, insert: inserted }],
      original.length,
    )
    const rebased = updateInlineEditSessionMap(before, changes, [], ['inner'])
    const tracked = recordAcceptedInlineInsertion(
      before,
      rebased,
      { sessionId: 'inner', at: 10 },
      changes,
    )
    const outer = tracked.get('outer')
    const documentText = `${original.slice(0, 10)}${inserted}${original.slice(10)}`
    if (!outer) throw new Error('Outer inline session was not preserved')

    expect(outer).toMatchObject({
      from: 0,
      to: original.length + inserted.length,
      insertAt: original.length + inserted.length,
      ignoredInsertions: [{ from: 10, to: 10 + inserted.length }],
    })
    expect(
      isInlineSourceCurrent(
        documentText,
        outer,
        original,
        outer.ignoredInsertions,
      ),
    ).toBe(true)
  })

  it('preserves acceptance order for exact-range insert-below sessions', () => {
    const original = 'Shared source'
    const before = new Map([
      [
        'first',
        {
          id: 'first',
          from: 0,
          to: original.length,
          insertAt: original.length,
          ignoredInsertions: [],
        },
      ],
      [
        'second',
        {
          id: 'second',
          from: 0,
          to: original.length,
          insertAt: original.length,
          ignoredInsertions: [],
        },
      ],
    ])
    const inserted = '\n\nFirst result'
    const changes = ChangeSet.of(
      [{ from: original.length, insert: inserted }],
      original.length,
    )
    const rebased = updateInlineEditSessionMap(before, changes, [], ['first'])
    const tracked = recordAcceptedInlineInsertion(
      before,
      rebased,
      { sessionId: 'first', at: original.length },
      changes,
    )
    const second = tracked.get('second')
    if (!second) throw new Error('Second inline session was not preserved')

    expect(second).toMatchObject({
      from: 0,
      to: original.length,
      insertAt: original.length + inserted.length,
      ignoredInsertions: [],
    })
    expect(
      isInlineSourceCurrent(
        `${original}${inserted}`,
        second,
        original,
        second.ignoredInsertions,
      ),
    ).toBe(true)
  })

  it('removes only tracked sibling insertions from source validation', () => {
    const documentText = 'alpha [summary]beta changed'
    const source = getInlineSourceWithoutInsertions(
      documentText,
      { from: 0, to: documentText.length },
      [{ from: 6, to: 15 }],
    )

    expect(source).toBe('alpha beta changed')
    expect(
      isInlineSourceCurrent(
        documentText,
        { from: 0, to: documentText.length },
        'alpha beta',
        [{ from: 6, to: 15 }],
      ),
    ).toBe(false)
  })

  it('detects stale source content before applying a concurrent result', () => {
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

  it('warns about changed reference snapshots without changing target safety', () => {
    const app = {
      vault: {
        getFileByPath: jest.fn((path: string) =>
          path === 'stable.md'
            ? { path, stat: { mtime: 1, size: 10 } }
            : path === 'changed.md'
              ? { path, stat: { mtime: 2, size: 10 } }
              : null,
        ),
      },
    } as unknown as App

    expect(
      getChangedReferencePaths(app, [
        { path: 'stable.md', mtime: 1, size: 10 },
        { path: 'changed.md', mtime: 1, size: 10 },
        { path: 'missing.md', mtime: 1, size: 10 },
      ]),
    ).toEqual(['changed.md', 'missing.md'])
  })
})
