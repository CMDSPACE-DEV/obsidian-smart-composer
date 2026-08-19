import { App } from 'obsidian'

import { DocumentJobRepository } from './DocumentJobRepository'
import {
  splitMarkdownForDocumentEdit,
  stableTextHash,
} from './markdownSplitter'

function createApp(): {
  app: App
  files: Map<string, string>
} {
  const files = new Map<string, string>()
  const directories = new Set<string>()
  const adapter = {
    exists: jest.fn(
      async (path: string) => files.has(path) || directories.has(path),
    ),
    mkdir: jest.fn(async (path: string) => {
      directories.add(path)
    }),
    write: jest.fn(async (path: string, content: string) => {
      files.set(path, content)
    }),
    read: jest.fn(async (path: string) => {
      const value = files.get(path)
      if (value === undefined) throw new Error(`Missing ${path}`)
      return value
    }),
    remove: jest.fn(async (path: string) => {
      files.delete(path)
    }),
    rename: jest.fn(async (from: string, to: string) => {
      const value = files.get(from)
      if (value === undefined) throw new Error(`Missing ${from}`)
      files.delete(from)
      files.set(to, value)
    }),
    list: jest.fn(async (path: string) => {
      const prefix = `${path}/`
      const childFolders = Array.from(directories)
        .filter((candidate) => candidate.startsWith(prefix))
        .filter((candidate) => !candidate.slice(prefix.length).includes('/'))
      return {
        files: Array.from(files.keys()).filter(
          (candidate) =>
            candidate.startsWith(prefix) &&
            !candidate.slice(prefix.length).includes('/'),
        ),
        folders: childFolders,
      }
    }),
    rmdir: jest.fn(async (path: string) => {
      for (const file of files.keys()) {
        if (file === path || file.startsWith(`${path}/`)) files.delete(file)
      }
      for (const directory of directories) {
        if (directory === path || directory.startsWith(`${path}/`)) {
          directories.delete(directory)
        }
      }
    }),
  }
  return {
    app: { vault: { adapter } } as unknown as App,
    files,
  }
}

describe('DocumentJobRepository', () => {
  it('persists immutable snapshots and rebuilds a draft from review choices', async () => {
    const { app, files } = createApp()
    const repository = new DocumentJobRepository(app)
    const source =
      '# First\n\nOriginal first.\n\n# Second\n\nOriginal second.\n'
    const units = splitMarkdownForDocumentEdit(source, {
      preserveFrontmatter: false,
      targetCharacters: 2_000,
    })
    let manifest = await repository.createJob(
      {
        jobId: 'job',
        sourcePath: 'Imported.md',
        sourceMtime: 10,
        sourceDocumentChecksum: stableTextHash(source),
        sourceFrom: 0,
        sourceTo: source.length,
        source,
        placement: 'replace',
        instruction: 'Rewrite clearly',
        modelId: 'model',
        strategy: 'transform',
        referenceText: 'Reference snapshot',
        referenceSnapshots: [{ path: 'Prompt.md', mtime: 2, size: 30 }],
        preserveFrontmatter: true,
      },
      units,
    )
    const outputPaths = await Promise.all(
      units.map((unit) =>
        repository.writeUnitOutput(
          manifest.jobId,
          unit.id,
          source.slice(unit.from, unit.to).replace(/Original/g, 'Edited'),
        ),
      ),
    )
    manifest = await repository.saveManifest({
      ...manifest,
      phase: 'review',
      units: manifest.units.map((unit, index) => ({
        ...unit,
        status: 'succeeded',
        outputPath: outputPaths[index],
        reviewChoice: index === 0 ? 'source' : 'edited',
      })),
    })

    manifest = await repository.rebuildTransformDraft(
      manifest.jobId,
      'Smart Composer/Document Drafts',
    )

    expect(await repository.readSource(manifest)).toBe(source)
    expect(await repository.readReferences(manifest)).toBe('Reference snapshot')
    expect(manifest.draftPath).toBe(
      'Smart Composer/Document Drafts/Imported - Smart Composer draft.md',
    )
    const draftPath = manifest.draftPath
    if (!draftPath) throw new Error('Expected a visible draft path')
    expect(files.get(draftPath)).toContain('Original first.')
    expect(files.get(draftPath)).toContain('Edited second.')
  })

  it('lists jobs and creates collision-safe visible drafts', async () => {
    const { app } = createApp()
    const repository = new DocumentJobRepository(app)
    const source = 'Document'
    await repository.createJob(
      {
        jobId: 'job',
        sourcePath: 'Document.md',
        sourceMtime: 1,
        sourceDocumentChecksum: stableTextHash(source),
        sourceFrom: 0,
        sourceTo: source.length,
        source,
        placement: 'replace',
        instruction: 'Rewrite',
        modelId: 'model',
        strategy: 'transform',
        referenceText: '',
        referenceSnapshots: [],
        preserveFrontmatter: false,
      },
      splitMarkdownForDocumentEdit(source, {
        preserveFrontmatter: false,
      }),
    )
    const first = await repository.writeVisibleDraft({
      sourcePath: 'Document.md',
      destinationFolder: 'Drafts',
      content: 'First',
    })
    const second = await repository.writeVisibleDraft({
      sourcePath: 'Document.md',
      destinationFolder: 'Drafts',
      content: 'Second',
    })

    expect(first).toBe('Drafts/Document - Smart Composer draft.md')
    expect(second).toBe('Drafts/Document - Smart Composer draft 2.md')
    expect(await repository.listJobs()).toHaveLength(1)
  })
})
