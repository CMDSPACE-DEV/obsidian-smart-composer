import { SerializedEditorState, SerializedElementNode } from 'lexical'
import { App, TFile, TFolder } from 'obsidian'

import { DEFAULT_CHAT_MODELS, DEFAULT_PROVIDERS } from '../../constants'
import { AnthropicProvider } from '../../core/llm/anthropic'
import { processQueryWithExhaustiveFolderRead } from '../../core/rag/exhaustiveFolderRead'
import { processQueryWithPlanRerank } from '../../core/rag/planRerank'
import { RAGEngine } from '../../core/rag/ragEngine'
import { SmartComposerSettings } from '../../settings/schema/setting.types'
import { ChatMessage, ChatUserMessage } from '../../types/chat'
import { ToolCallResponseStatus } from '../../types/tool-call.types'

import { PromptGenerator } from './promptGenerator'

jest.mock('../../core/rag/planRerank', () => ({
  processQueryWithPlanRerank: jest.fn(),
}))
jest.mock('../../core/rag/exhaustiveFolderRead', () => ({
  processQueryWithExhaustiveFolderRead: jest.fn(),
}))

const mockedProcessQueryWithPlanRerank =
  processQueryWithPlanRerank as jest.MockedFunction<
    typeof processQueryWithPlanRerank
  >
const mockedProcessQueryWithExhaustiveFolderRead =
  processQueryWithExhaustiveFolderRead as jest.MockedFunction<
    typeof processQueryWithExhaustiveFolderRead
  >

class MockTFile extends (TFile as unknown as new () => TFile) {
  path: string
  name: string
  extension: string
  stat: { ctime: number; mtime: number; size: number }

  constructor(path: string, contentMtime = 1) {
    super()
    this.path = path
    this.name = path.split('/').at(-1) ?? path
    this.extension = this.name.split('.').at(-1) ?? ''
    this.stat = { ctime: contentMtime, mtime: contentMtime, size: 0 }
  }
}

class MockTFolder extends (TFolder as unknown as new () => TFolder) {
  path: string
  name: string
  children: TFile[]

  constructor(path: string, children: TFile[]) {
    super()
    this.path = path
    this.name = path.split('/').at(-1) ?? path
    this.children = children
  }
}

function createEditorState(text: string): SerializedEditorState {
  return {
    root: {
      children: [
        {
          children: [
            {
              detail: 0,
              format: 0,
              mode: 'normal',
              style: '',
              text,
              type: 'text',
              version: 1,
            },
          ],
          direction: 'ltr',
          format: '',
          indent: 0,
          type: 'paragraph',
          version: 1,
          textFormat: 0,
          textStyle: '',
        } as unknown as SerializedElementNode,
      ],
      direction: 'ltr',
      format: '',
      indent: 0,
      type: 'root',
      version: 1,
    },
  }
}

function createSettings(
  overrides: Partial<SmartComposerSettings> = {},
): SmartComposerSettings {
  return {
    version: 21,
    providers: [...DEFAULT_PROVIDERS],
    chatModels: [...DEFAULT_CHAT_MODELS],
    embeddingModels: [
      {
        providerType: 'openai',
        providerId: 'openai',
        id: 'openai/text-embedding-3-small',
        model: 'text-embedding-3-small',
        dimension: 1536,
      },
    ],
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
      retrievalMode: 'auto',
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
    mcp: { routingMode: 'auto', connections: [] },
    chatOptions: {
      includeCurrentFileContent: true,
      enableTools: true,
      maxAutoIterations: 1,
    },
    ...overrides,
  }
}

describe('PromptGenerator RAG retrieval', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('uses plan rerank instead of embedding when auto mode has no OpenAI API key', async () => {
    const file = new MockTFile('notes/project.md')
    const folder = new MockTFolder('notes', [file])
    const app = {
      vault: {
        cachedRead: jest
          .fn()
          .mockResolvedValue('alpha beta gamma delta epsilon zeta'),
      },
    } as unknown as App
    const getRagEngine = jest.fn<Promise<RAGEngine>, []>()
    mockedProcessQueryWithPlanRerank.mockResolvedValue({
      results: [
        {
          id: 1,
          path: file.path,
          mtime: file.stat.mtime,
          content: 'alpha beta',
          model: 'plan-rerank',
          dimension: 0,
          metadata: {
            startLine: 1,
            endLine: 1,
          },
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

    const generator = new PromptGenerator(
      getRagEngine,
      app,
      createSettings(),
      jest.fn(),
    )
    const message: ChatUserMessage = {
      id: 'user-1',
      role: 'user',
      content: createEditorState('find alpha'),
      promptContent: null,
      mentionables: [
        {
          type: 'folder',
          folder,
        },
      ],
    }

    const result = await generator.compileUserMessagePrompt({ message })

    expect(getRagEngine).not.toHaveBeenCalled()
    expect(mockedProcessQueryWithPlanRerank).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'find alpha',
        files: [file],
        scopeType: 'folders',
      }),
    )
    expect(result.shouldUseRAG).toBe(true)
    expect(result.retrievalMetadata?.retrievalMode).toBe('plan-rerank')
    expect(JSON.stringify(result.promptContent)).toContain('alpha beta')
  })

  it('keeps small folder mentions inline without RAG', async () => {
    const file = new MockTFile('notes/small.md')
    const folder = new MockTFolder('notes', [file])
    const app = {
      vault: {
        cachedRead: jest.fn().mockResolvedValue('short note'),
      },
    } as unknown as App
    const getRagEngine = jest.fn<Promise<RAGEngine>, []>()

    const generator = new PromptGenerator(
      getRagEngine,
      app,
      createSettings({
        ragOptions: {
          ...createSettings().ragOptions,
          thresholdTokens: 1000,
        },
      }),
    )
    const message: ChatUserMessage = {
      id: 'user-1',
      role: 'user',
      content: createEditorState('summarize'),
      promptContent: null,
      mentionables: [
        {
          type: 'folder',
          folder,
        },
      ],
    }

    const result = await generator.compileUserMessagePrompt({ message })

    expect(getRagEngine).not.toHaveBeenCalled()
    expect(mockedProcessQueryWithPlanRerank).not.toHaveBeenCalled()
    expect(result.shouldUseRAG).toBe(false)
    expect(JSON.stringify(result.promptContent)).toContain('short note')
  })

  it('uses exhaustive folder read when the query asks to read everything', async () => {
    const file = new MockTFile('notes/full.md')
    const folder = new MockTFolder('notes', [file])
    const app = {
      vault: {
        cachedRead: jest.fn().mockResolvedValue('full note content'),
      },
    } as unknown as App
    const getRagEngine = jest.fn<Promise<RAGEngine>, []>()
    mockedProcessQueryWithExhaustiveFolderRead.mockResolvedValue({
      promptText:
        'Context mode: exhaustive folder read\n```notes/full.md\nfull note content\n```',
      similaritySearchResults: [
        {
          id: 1,
          path: file.path,
          mtime: file.stat.mtime,
          content: 'full note content',
          model: 'exhaustive-direct',
          dimension: 0,
          metadata: {
            startLine: 1,
            endLine: 1,
          },
          similarity: 1,
        },
      ],
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

    const generator = new PromptGenerator(
      getRagEngine,
      app,
      createSettings({
        ragOptions: {
          ...createSettings().ragOptions,
          thresholdTokens: 1000,
        },
      }),
      jest.fn(),
    )
    const message: ChatUserMessage = {
      id: 'user-1',
      role: 'user',
      content: createEditorState('이 폴더를 전부 정독하고 정리해줘'),
      promptContent: null,
      mentionables: [
        {
          type: 'folder',
          folder,
        },
      ],
    }

    const result = await generator.compileUserMessagePrompt({ message })

    expect(mockedProcessQueryWithExhaustiveFolderRead).toHaveBeenCalledWith(
      expect.objectContaining({
        query: '이 폴더를 전부 정독하고 정리해줘',
        files: [file],
        scopeType: 'folders',
      }),
    )
    expect(mockedProcessQueryWithPlanRerank).not.toHaveBeenCalled()
    expect(result.shouldUseRAG).toBe(true)
    expect(result.retrievalMetadata?.retrievalMode).toBe('exhaustive-direct')
    expect(JSON.stringify(result.promptContent)).toContain(
      'exhaustive folder read',
    )
  })
})

describe('PromptGenerator tool-call history', () => {
  const createGenerator = () =>
    new PromptGenerator(
      jest.fn<Promise<RAGEngine>, []>(),
      {} as App,
      createSettings(),
    )

  it('repairs a multi-tool assistant turn with an aborted result', async () => {
    const messages: ChatMessage[] = [
      createUserMessage('user-1', 'run both tools'),
      {
        id: 'assistant-1',
        role: 'assistant',
        content: '',
        toolCallRequests: [
          { id: 'tool-1', name: 'first', arguments: '{}' },
          { id: 'tool-2', name: 'second', arguments: '{}' },
        ],
      },
      {
        id: 'tool-result-1',
        role: 'tool',
        toolCalls: [
          {
            request: { id: 'tool-1', name: 'first', arguments: '{}' },
            response: {
              status: ToolCallResponseStatus.Success,
              data: { type: 'text', text: 'first result' },
            },
          },
        ],
      },
      createUserMessage('user-2', 'continue'),
    ]

    const requestMessages = await createGenerator().generateRequestMessages({
      messages,
    })
    expect(requestMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'tool',
          tool_call: expect.objectContaining({ id: 'tool-2' }),
          content: expect.stringContaining('aborted'),
        }),
      ]),
    )
  })

  it('preserves two consecutive saved tool turns and Anthropic metadata', async () => {
    const thinkingBlocks = [
      {
        type: 'thinking' as const,
        thinking: 'summary',
        signature: 'signed-summary',
      },
    ]
    const messages: ChatMessage[] = [
      createUserMessage('user-1', 'start'),
      {
        id: 'assistant-1',
        role: 'assistant',
        content: '',
        providerMetadata: { anthropic: { thinkingBlocks } },
        toolCallRequests: [
          { id: 'tool-1', name: 'lookup', arguments: '{"step":1}' },
        ],
      },
      createToolMessage('tool-result-1', 'tool-1', 'lookup', 'step one'),
      {
        id: 'assistant-2',
        role: 'assistant',
        content: '',
        providerMetadata: { anthropic: { thinkingBlocks } },
        toolCallRequests: [
          { id: 'tool-2', name: 'lookup', arguments: '{"step":2}' },
        ],
      },
      createToolMessage('tool-result-2', 'tool-2', 'lookup', 'step two'),
      createUserMessage('user-2', 'finish'),
    ]

    const requestMessages = await createGenerator().generateRequestMessages({
      messages,
    })
    const history = requestMessages.filter(
      (message) => message.role !== 'system',
    )

    expect(history.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'assistant',
      'tool',
      'user',
    ])
    const assistants = history.filter((message) => message.role === 'assistant')
    expect(assistants).toHaveLength(2)
    for (const assistant of assistants) {
      expect(assistant.providerMetadata?.anthropic?.thinkingBlocks).toEqual(
        thinkingBlocks,
      )
      expect(AnthropicProvider.parseRequestMessage(assistant)).toMatchObject({
        role: 'assistant',
        content: [
          expect.objectContaining({
            type: 'thinking',
            signature: 'signed-summary',
          }),
          expect.objectContaining({ type: 'tool_use' }),
        ],
      })
    }
  })
})

function createUserMessage(id: string, promptContent: string): ChatUserMessage {
  return {
    id,
    role: 'user',
    content: null,
    promptContent,
    mentionables: [],
  }
}

function createToolMessage(
  id: string,
  toolId: string,
  name: string,
  text: string,
): Extract<ChatMessage, { role: 'tool' }> {
  return {
    id,
    role: 'tool',
    toolCalls: [
      {
        request: { id: toolId, name, arguments: '{}' },
        response: {
          status: ToolCallResponseStatus.Success,
          data: { type: 'text', text },
        },
      },
    ],
  }
}
