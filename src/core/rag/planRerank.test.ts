import { App, TFile } from 'obsidian'

import { getChatModelClient } from '../llm/manager'

import { processQueryWithPlanRerank } from './planRerank'

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

describe('processQueryWithPlanRerank', () => {
  let consoleWarnSpy: jest.SpyInstance

  beforeEach(() => {
    jest.clearAllMocks()
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation()
  })

  afterEach(() => {
    consoleWarnSpy.mockRestore()
  })

  it('falls back to local ranking when the rerank model returns invalid JSON', async () => {
    const appleFile = createFile('notes/apple.md', 1)
    const bananaFile = createFile('notes/banana.md', 2)
    const app = {
      vault: {
        cachedRead: jest.fn(async (file: TFile) =>
          file.path.includes('banana')
            ? 'banana banana project note'
            : 'apple project note',
        ),
      },
    } as unknown as App
    const generateResponse = jest.fn().mockResolvedValue({
      id: 'response-id',
      model: 'claude-sonnet-5',
      object: 'chat.completion',
      choices: [
        {
          finish_reason: 'stop',
          message: {
            role: 'assistant',
            content: 'not json',
          },
        },
      ],
    })
    mockedGetChatModelClient.mockReturnValue({
      model: {
        providerType: 'anthropic-plan',
        providerId: 'anthropic-plan',
        id: 'claude-sonnet-5 (plan)',
        model: 'claude-sonnet-5',
        thinking: {
          enabled: true,
          mode: 'adaptive',
          effort: 'high',
          display: 'summarized',
        },
      },
      providerClient: {
        generateResponse,
      },
    } as unknown as ReturnType<typeof getChatModelClient>)

    const { results, retrievalMetadata } = await processQueryWithPlanRerank({
      app,
      settings: {
        version: 20,
        providers: [],
        chatModels: [],
        embeddingModels: [],
        chatModelId: 'claude-sonnet-5 (plan)',
        inlineEdit: { modelId: null, contextCharacters: 4000 },
        imageGeneration: {
          modelId: 'gpt-5.6-sol (plan)',
          outputFolder: 'Smart Composer/Generated Images',
          quality: 'high',
          concurrency: 1,
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
          limit: 1,
          planRerankCandidateLimit: 2,
          excludePatterns: [],
          includePatterns: [],
        },
        mcp: { servers: [] },
        chatOptions: {
          includeCurrentFileContent: true,
          enableTools: true,
          maxAutoIterations: 1,
        },
      },
      query: 'banana',
      files: [appleFile, bananaFile],
      scopeType: 'folders',
    })

    expect(results).toHaveLength(1)
    expect(results[0].path).toBe('notes/banana.md')
    expect(results[0].model).toBe('plan-rerank')
    expect(retrievalMetadata).toMatchObject({
      retrievalMode: 'plan-rerank',
      scopeType: 'folders',
      totalFilesRead: 2,
      exhaustive: false,
    })
    expect(generateResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-sonnet-5',
        thinking: {
          enabled: false,
          mode: 'adaptive',
          effort: 'high',
          display: 'summarized',
        },
      }),
      expect.objectContaining({
        max_tokens: 512,
        temperature: 0,
      }),
    )
  })

  it('falls back locally for Plan entitlement errors', async () => {
    const file = createFile('notes/secure.md', 1)
    const app = {
      vault: {
        cachedRead: jest.fn().mockResolvedValue('restricted content'),
      },
    } as unknown as App
    const entitlementError = Object.assign(new Error('entitlement missing'), {
      status: 403,
    })
    mockedGetChatModelClient.mockReturnValue({
      model: {
        providerType: 'openai-plan',
        providerId: 'openai-plan',
        id: 'gpt-5.6-terra (plan)',
        model: 'gpt-5.6-terra',
        reasoning: { reasoning_effort: 'low' },
      },
      providerClient: {
        generateResponse: jest.fn().mockRejectedValue(entitlementError),
      },
    } as unknown as ReturnType<typeof getChatModelClient>)

    const result = await processQueryWithPlanRerank({
      app,
      settings: {
        version: 20,
        providers: [],
        chatModels: [],
        embeddingModels: [],
        chatModelId: 'gpt-5.6-terra (plan)',
        inlineEdit: { modelId: null, contextCharacters: 4000 },
        imageGeneration: {
          modelId: 'gpt-5.6-sol (plan)',
          outputFolder: 'Smart Composer/Generated Images',
          quality: 'high',
          concurrency: 1,
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
          limit: 1,
          planRerankCandidateLimit: 2,
          excludePatterns: [],
          includePatterns: [],
        },
        mcp: { servers: [] },
        chatOptions: {
          includeCurrentFileContent: true,
          enableTools: true,
          maxAutoIterations: 1,
        },
      },
      query: 'secure',
      files: [file],
      scopeType: 'folders',
    })
    expect(result.retrievalMetadata).toMatchObject({
      fallbackUsed: true,
      warnings: [expect.stringContaining('HTTP 403')],
    })
    expect(result.results).toHaveLength(1)
    expect(consoleWarnSpy).toHaveBeenCalled()
  })
})
