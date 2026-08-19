import { preserveTransformBoundaries } from './DocumentEditTaskAdapter'

describe('DocumentEditTaskAdapter helpers', () => {
  it('preserves source chunk separators for deterministic assembly', () => {
    expect(
      preserveTransformBoundaries(
        '\n\nOriginal paragraph.\n\n',
        'Edited paragraph.',
        'transform',
      ),
    ).toBe('\n\nEdited paragraph.\n\n')
    expect(
      preserveTransformBoundaries(
        'Original paragraph.\n',
        '\nEdited summary.\n',
        'map-reduce',
      ),
    ).toBe('Edited summary.')
  })

  it('keeps whitespace-only transform units unchanged', () => {
    expect(preserveTransformBoundaries('\n\n', 'ignored', 'transform')).toBe(
      '\n\n',
    )
  })
})
