import { migrateFrom21To22 } from './21_to_22'

describe('Migrate from version 21 to 22', () => {
  it('adds conservative document-editing defaults', () => {
    const result = migrateFrom21To22({
      version: 21,
      inlineEdit: {
        modelId: null,
        contextCharacters: 8000,
      },
    })

    expect(result).toMatchObject({
      version: 22,
      inlineEdit: {
        modelId: null,
        contextCharacters: 8000,
      },
      documentEditing: {
        largeEditRouting: 'auto-confirm',
        destinationFolder: 'Smart Composer/Document Drafts',
        preserveFrontmatter: true,
        concurrency: 1,
        retryLimit: 2,
      },
    })
  })
})
