import { migrateFrom17To18 } from './17_to_18'

describe('Migration from v17 to v18', () => {
  it('should increment version to 18', () => {
    const result = migrateFrom17To18({
      version: 17,
    })

    expect(result.version).toBe(18)
  })

  it('should add folder read defaults to rag options', () => {
    const result = migrateFrom17To18({
      version: 17,
      ragOptions: {
        retrievalMode: 'plan-rerank',
        planRerankCandidateLimit: 40,
      },
    })

    expect(result.ragOptions).toMatchObject({
      retrievalMode: 'plan-rerank',
      planRerankCandidateLimit: 40,
      folderReadMode: 'auto',
      exhaustiveDirectTokenLimit: 60000,
    })
  })

  it('should preserve existing folder read options', () => {
    const result = migrateFrom17To18({
      version: 17,
      ragOptions: {
        folderReadMode: 'focused',
        exhaustiveDirectTokenLimit: 12000,
      },
    })

    expect(result.ragOptions).toMatchObject({
      folderReadMode: 'focused',
      exhaustiveDirectTokenLimit: 12000,
    })
  })
})
