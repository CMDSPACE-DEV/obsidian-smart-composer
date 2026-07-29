import { App, TFile } from 'obsidian'

import { DEFAULT_CHAT_MODELS, DEFAULT_PROVIDERS } from '../../constants'
import { SmartComposerSettings } from '../../settings/schema/setting.types'
import { DEFAULT_RESEARCH_SOURCES } from '../../types/research.types'
import { getChatModelClient } from '../llm/manager'

import { processQueryWithExhaustiveFolderRead } from './exhaustiveFolderRead'

jest.mock('../llm/manager', () => ({
  getChatModelClient: jest.fn(),
}))

const mockedGetChatModelClient = getChatModelClient as jest.MockedFunction<
  typeof getChatModelClient
>

function createFile(path: string, mtime: number): TFile {
  return {
    path,
    name: path.split('/').at(-1) ?? path,
    extension: 'md',
    stat: {
      ctime: mtime,
      mtime,
      size: 1,
    },
  } as TFile
}

function createSettings(
  overrides: Partial<SmartComposerSettings> = {},
): SmartComposerSettings {
  return {
    version: 28,
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
      thresholdTokens: 1,
      exhaustiveDirectTokenLimit: 60000,
      minSimilarity: 0,
      limit: 2,
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

describe('processQueryWithExhaustiveFolderRead', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('includes every file directly when the folder fits the token limit', async () => {
    const firstFile = createFile('notes/first.md', 1)
    const secondFile = createFile('notes/second.md', 2)
    const app = {
      vault: {
        cachedRead: jest.fn(async (file: TFile) =>
          file.path.includes('first') ? 'first content' : 'second content',
        ),
      },
    } as unknown as App

    const result = await processQueryWithExhaustiveFolderRead({
      app,
      settings: createSettings(),
      query: '전부 정독해줘',
      files: [firstFile, secondFile],
      scopeType: 'folders',
    })

    expect(result.promptText).toContain('Context mode: exhaustive folder read')
    expect(result.promptText).toContain('first content')
    expect(result.promptText).toContain('second content')
    expect(result.retrievalMetadata).toMatchObject({
      retrievalMode: 'exhaustive-direct',
      totalFilesRead: 2,
      exhaustive: true,
    })
    expect(result.similaritySearchResults).toHaveLength(2)
    expect(mockedGetChatModelClient).not.toHaveBeenCalled()
  })

  it('summarizes all chunks in batches when the folder exceeds the direct token limit', async () => {
    const firstFile = createFile('notes/first.md', 1)
    const secondFile = createFile('notes/second.md', 2)
    const generateResponse = jest.fn().mockResolvedValue({
      id: 'summary',
      model: 'gpt-5.6-sol',
      object: 'chat.completion',
      choices: [
        {
          finish_reason: 'stop',
          message: {
            role: 'assistant',
            content: 'batch summary covering both notes',
          },
        },
      ],
    })
    mockedGetChatModelClient.mockReturnValue({
      model: {
        providerType: 'openai-plan',
        providerId: 'openai-plan',
        id: 'gpt-5.6-sol (plan)',
        model: 'gpt-5.6-sol',
        reasoning: {
          reasoning_effort: 'max',
          reasoning_summary: 'auto',
        },
      },
      providerClient: {
        generateResponse,
      },
    } as unknown as ReturnType<typeof getChatModelClient>)
    const app = {
      vault: {
        cachedRead: jest.fn(async (file: TFile) =>
          file.path.includes('first')
            ? 'first long content'
            : 'second long content',
        ),
      },
    } as unknown as App

    const controller = new AbortController()
    const result = await processQueryWithExhaustiveFolderRead({
      app,
      settings: createSettings({
        ragOptions: {
          ...createSettings().ragOptions,
          exhaustiveDirectTokenLimit: 1,
        },
      }),
      query: '전부 정독해줘',
      files: [firstFile, secondFile],
      scopeType: 'folders',
      modelId: 'inline-summary-model',
      signal: controller.signal,
    })

    expect(mockedGetChatModelClient).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: 'inline-summary-model' }),
    )
    expect(generateResponse).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(generateResponse.mock.calls[0])).toContain(
      'notes/first.md',
    )
    expect(JSON.stringify(generateResponse.mock.calls[0])).toContain(
      'notes/second.md',
    )
    expect(generateResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-5.6-sol',
        reasoning: { reasoning_effort: 'none' },
      }),
      expect.objectContaining({
        max_tokens: 1200,
        temperature: 0,
      }),
      { signal: controller.signal },
    )
    expect(result.promptText).toContain('batch summary covering both notes')
    expect(result.retrievalMetadata).toMatchObject({
      retrievalMode: 'exhaustive-batch',
      totalFilesRead: 2,
      exhaustive: true,
    })
  })
})
