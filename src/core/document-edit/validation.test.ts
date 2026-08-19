import type { DocumentEditJobManifest } from './types'
import { validateDocumentAssembly } from './validation'

function manifest(): DocumentEditJobManifest {
  return {
    schemaVersion: 1,
    jobId: 'job',
    sourcePath: 'source.md',
    sourceMtime: 1,
    sourceChecksum: 'full',
    sourceSelectionChecksum: 'selection',
    sourceFrom: 0,
    sourceTo: 20,
    placement: 'replace',
    instruction: 'Rewrite',
    modelId: 'model',
    strategy: 'transform',
    phase: 'assembling',
    referenceSnapshots: [],
    sourceSnapshotPath: 'source.md',
    units: [
      {
        id: 'one',
        index: 0,
        from: 0,
        to: 10,
        headingPath: ['Heading'],
        checksum: 'one',
        protected: false,
        status: 'succeeded',
        attempt: 1,
        outputPath: 'one.md',
        reviewChoice: 'edited',
      },
      {
        id: 'two',
        index: 1,
        from: 10,
        to: 20,
        headingPath: [],
        checksum: 'two',
        protected: false,
        status: 'succeeded',
        attempt: 1,
        reviewChoice: 'source',
      },
    ],
    reductions: [],
    reductionLevel: 0,
    warnings: [],
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('validateDocumentAssembly', () => {
  it('accepts a reviewed source fallback without an output file', () => {
    const result = validateDocumentAssembly(
      manifest(),
      '# Heading\n\nEdited.\n\nSource fallback.',
    )
    expect(result.valid).toBe(true)
  })

  it('rejects incomplete sections, missing outputs, and broken fences', () => {
    const input = manifest()
    input.units[0] = {
      ...input.units[0],
      status: 'failed',
      outputPath: undefined,
    }
    const result = validateDocumentAssembly(input, '```ts\nconst value = 1')

    expect(result.valid).toBe(false)
    expect(result.errors).toEqual(
      expect.arrayContaining([
        'Unit 1 is not complete.',
        'Unit 1 has no output checkpoint.',
        'The assembled draft has an unbalanced backtick fence.',
      ]),
    )
  })
})
