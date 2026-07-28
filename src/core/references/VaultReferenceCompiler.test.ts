import { App, TFile, TFolder } from 'obsidian'

import { DEFAULT_CHAT_MODELS, DEFAULT_PROVIDERS } from '../../constants'
import { SmartComposerSettings } from '../../settings/schema/setting.types'
import { DEFAULT_RESEARCH_SOURCES } from '../../types/research.types'
import { processQueryWithExhaustiveFolderRead } from '../rag/exhaustiveFolderRead'
import { processQueryWithPlanRerank } from '../rag/planRerank'

import {
  compileVaultReferences,
  isExhaustiveReadIntent,
} from './VaultReferenceCompiler'

jest.mock('../rag/planRerank', () => ({
  processQueryWithPlanRerank: jest.fn(),
}))
jest.mock('../rag/exhaustiveFolderRead', () => ({
  processQueryWithExhaustiveFolderRead: jest.fn(),
}))

const mockedPlanRerank =
  processQueryWithPlanRerank as jest.MockedFunction<
    typeof processQueryWithPlanRerank
  >
const mockedExhaustive =
  processQueryWithExhaustiveFolderRead as jest.MockedFunction<
    typeof processQueryWithExhaustiveFolderRead
  >

class MockFile extends (TFile as unknown as new () => TFile) {
  path: string
  name: string
  extension = 'md'
  stat: { ctime: number; mtime: number; size: number }

  constructor(path: string, mtime = 1) {
    super()
    this.path = path
    this.name = path.split('/').at(-1) ?? path
    this.stat = { ctime: mtime, mtime, size: 10 }
  }
}

class MockFolder extends (TFolder as unknown as new () => TFolder) {
  path: string
  name: string
  children: Array<TFile | TFolder>

  constructor(path: string, children: Array<TFile | TFolder>) {
    super()
    this.path = path
    this.name = path.split('/').at(-1) ?? path
    this.children = children
  }
}

function createSettings(
  overrides: Partial<SmartComposerSettings> = {},
): SmartComposerSettings {
  return {
    version: 27,
    nativeRuntimes: {
      claude: { status: 'not-installed', models: [] },
      gemini: { status: 'not-installed', models: [] },
    },
    providers: [...DEFAULT_PROVIDERS],
    chatModels: [...DEFAULT_CHAT_MODELS],
    embeddingModels: [],
    chatModelId: 'gpt-5.6-sol (plan)',
    inlineEdit: { modelId: null, contextCharacters: 4000 },
    imageGeneration: {
      modelId: 'gpt-5.6-sol (plan)',
      outputFolder: 'Smart Composer/Generated Images',
      quality: 'high',
      concurrency: 1,
    },
    documentEditing: {
      largeEditRouting: 'auto-confirm',
      destinationFolder: 'Smart Composer/Document Drafts',
      preserveFrontmatter: true,
      concurrency: 1,
      retryLimit: 2,
    },
    appearance: { skinMode: 'follow-obsidian' },
    embeddingModelId: 'openai/text-embedding-3-small',
    systemPrompt: '',
    ragOptions: {
      retrievalMode: 'plan-rerank',
      folderReadMode: 'auto',
      chunkSize: 1000,
      thresholdTokens: 8192,
      exhaustiveDirectTokenLimit: 60000,
      minSimilarity: 0,
      limit: 10,
      planRerankCandidateLimit: 40,
      excludePatterns: [],
      includePatterns: [],
    },
    mcp: {
      routingMode: 'auto',
      executionMode: 'full-auto',
      connections: [],
    },
    research: {
      routingMode: 'auto',
      maxAutoSources: 2,
      sources: DEFAULT_RESEARCH_SOURCES,
    },
    chatOptions: {
      includeCurrentFileContent: true,
      enableTools: true,
      maxAutoIterations: 1,
    },
    ...overrides,
  }
}

function createApp(
  files: MockFile[],
  folders: MockFolder[],
  contents: Record<string, string>,
): App {
  return {
    vault: {
      getFileByPath: jest.fn(
        (path: string) => files.find((file) => file.path === path) ?? null,
      ),
      getFolderByPath: jest.fn(
        (path: string) =>
          folders.find((folder) => folder.path === path) ?? null,
      ),
      getMarkdownFiles: jest.fn(() => files),
      cachedRead: jest.fn(async (file: TFile) => contents[file.path] ?? ''),
    },
  } as unknown as App
}

describe('compileVaultReferences', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('includes an explicitly mentioned note directly', async () => {
    const prompt = new MockFile('prompts/editor.md')
    const app = createApp([prompt], [], {
      [prompt.path]: 'Use concise headings and preserve links.',
    })

    const result = await compileVaultReferences({
      app,
      settings: createSettings(),
      query: 'Use this as a style guide',
      references: [{ type: 'file', path: prompt.path }],
      targetFilePath: 'draft.md',
      modelId: 'gpt-5.6-sol (plan)',
      scope: 'auto',
    })

    expect(result.shouldUseRAG).toBe(false)
    expect(result.promptText).toContain(prompt.path)
    expect(result.promptText).toContain('preserve links')
    expect(result.sourceFiles).toEqual([
      { path: prompt.path, mtime: 1, size: 10 },
    ])
  })

  it('deduplicates overlaps and excludes an implicit target note', async () => {
    const target = new MockFile('notes/target.md')
    const source = new MockFile('notes/source.md')
    const folder = new MockFolder('notes', [target, source])
    const app = createApp([target, source], [folder], {
      [target.path]: 'target body',
      [source.path]: 'source body',
    })

    const result = await compileVaultReferences({
      app,
      settings: createSettings(),
      query: 'summarize',
      references: [
        { type: 'folder', path: folder.path },
        { type: 'file', path: source.path },
      ],
      targetFilePath: target.path,
      modelId: 'gpt-5.6-sol (plan)',
      scope: 'auto',
    })

    expect(result.sourceFiles.map((file) => file.path)).toEqual([source.path])
    expect(result.promptText).not.toContain('target body')
    expect(result.promptText.match(/source body/g)).toHaveLength(1)
  })

  it('uses the inline model for a forced focused folder read', async () => {
    const file = new MockFile('notes/source.md')
    const folder = new MockFolder('notes', [file])
    const app = createApp([file], [folder], { [file.path]: 'source body' })
    mockedPlanRerank.mockResolvedValue({
      results: [
        {
          id: 1,
          path: file.path,
          mtime: 1,
          content: 'selected source',
          model: 'plan-rerank',
          dimension: 0,
          metadata: { startLine: 1, endLine: 1 },
          similarity: 1,
        },
      ],
      retrievalMetadata: {
        retrievalMode: 'plan-rerank',
        scopeType: 'folders',
        totalFilesRead: 1,
        totalChunksBuilt: 1,
        candidateChunks: 1,
        selectedChunks: 1,
        exhaustive: false,
      },
    })

    const result = await compileVaultReferences({
      app,
      settings: createSettings(),
      query: 'find source',
      references: [{ type: 'folder', path: folder.path }],
      modelId: 'claude-sonnet-5 (plan)',
      scope: 'focused',
    })

    expect(mockedPlanRerank).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: 'claude-sonnet-5 (plan)',
        files: [file],
        scopeType: 'folders',
      }),
    )
    expect(result.promptText).toContain('selected source')
  })

  it('routes Auto exhaustive intent and Entire overrides through all files', async () => {
    const file = new MockFile('notes/source.md')
    const folder = new MockFolder('notes', [file])
    const app = createApp([file], [folder], { [file.path]: 'source body' })
    mockedExhaustive.mockResolvedValue({
      promptText: 'Context mode: exhaustive folder read',
      similaritySearchResults: [],
      retrievalMetadata: {
        retrievalMode: 'exhaustive-direct',
        scopeType: 'folders',
        totalFilesRead: 1,
        totalChunksBuilt: 1,
        candidateChunks: 1,
        selectedChunks: 1,
        exhaustive: true,
      },
    })

    await compileVaultReferences({
      app,
      settings: createSettings(),
      query: '모든 노트를 전부 정독해',
      references: [{ type: 'folder', path: folder.path }],
      modelId: 'gpt-5.6-sol (plan)',
      scope: 'auto',
    })
    await compileVaultReferences({
      app,
      settings: createSettings(),
      query: 'find one idea',
      references: [{ type: 'folder', path: folder.path }],
      modelId: 'gpt-5.6-sol (plan)',
      scope: 'entire',
    })

    expect(mockedExhaustive).toHaveBeenCalledTimes(2)
    expect(mockedExhaustive).toHaveBeenLastCalledWith(
      expect.objectContaining({ files: [file], modelId: 'gpt-5.6-sol (plan)' }),
    )
  })

  it('reports a renamed reference instead of silently dropping it', async () => {
    const app = createApp([], [], {})
    await expect(
      compileVaultReferences({
        app,
        settings: createSettings(),
        query: 'rewrite',
        references: [{ type: 'file', path: 'missing.md' }],
        modelId: 'gpt-5.6-sol (plan)',
        scope: 'auto',
      }),
    ).rejects.toThrow('missing or was renamed')
  })
})

describe('isExhaustiveReadIntent', () => {
  it('recognizes Korean and English whole-scope requests', () => {
    expect(isExhaustiveReadIntent('폴더를 전부 정독해')).toBe(true)
    expect(isExhaustiveReadIntent('read the entire folder')).toBe(true)
    expect(isExhaustiveReadIntent('find the relevant note')).toBe(false)
  })
})
