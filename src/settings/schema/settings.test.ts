import {
  DEFAULT_CHAT_MODELS,
  DEFAULT_CHAT_MODEL_ID,
  DEFAULT_EMBEDDING_MODELS,
  DEFAULT_PROVIDERS,
} from '../../constants'
import { DEFAULT_RESEARCH_SOURCES } from '../../types/research.types'

import { SETTINGS_SCHEMA_VERSION } from './migrations'
import { parseSmartComposerSettings } from './settings'

describe('parseSmartComposerSettings', () => {
  it('should return default values for empty input', () => {
    const result = parseSmartComposerSettings({})
    expect(result).toEqual({
      version: SETTINGS_SCHEMA_VERSION,

      providers: [...DEFAULT_PROVIDERS],

      chatModels: [...DEFAULT_CHAT_MODELS],
      embeddingModels: [...DEFAULT_EMBEDDING_MODELS],

      chatModelId: DEFAULT_CHAT_MODEL_ID,
      embeddingModelId: 'openai/text-embedding-3-small',
      inlineEdit: {
        modelId: null,
        contextCharacters: 4000,
      },
      documentEditing: {
        largeEditRouting: 'auto-confirm',
        destinationFolder: 'Smart Composer/Document Drafts',
        preserveFrontmatter: true,
        concurrency: 1,
        retryLimit: 2,
      },
      imageGeneration: {
        modelId: 'gpt-5.6-sol (plan)',
        outputFolder: 'Smart Composer/Generated Images',
        quality: 'high',
        concurrency: 1,
      },
      appearance: {
        skinMode: 'follow-obsidian',
      },

      systemPrompt: '',

      ragOptions: {
        retrievalMode: 'auto',
        folderReadMode: 'auto',
        chunkSize: 1000,
        thresholdTokens: 8192,
        exhaustiveDirectTokenLimit: 60000,
        minSimilarity: 0.0,
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
        maxAutoIterations: 12,
      },
    })
  })

  it('drops v28 runtime health without changing provider or model choices', () => {
    const result = parseSmartComposerSettings({
      version: 28,
      providers: [...DEFAULT_PROVIDERS],
      chatModels: [...DEFAULT_CHAT_MODELS],
      chatModelId: DEFAULT_CHAT_MODEL_ID,
      nativeRuntimes: {
        claude: {
          status: 'ready',
          models: [{ id: 'sonnet', label: 'Sonnet' }],
        },
        gemini: {
          status: 'ready',
          models: [{ id: 'gemini-pro', label: 'Gemini Pro' }],
        },
      },
    })

    expect(result.version).toBe(29)
    expect(result.providers).toEqual(DEFAULT_PROVIDERS)
    expect(result.chatModels).toEqual(DEFAULT_CHAT_MODELS)
    expect(result.chatModelId).toBe(DEFAULT_CHAT_MODEL_ID)
    expect(result).not.toHaveProperty('nativeRuntimes')
  })

  it('upgrades v18 while preserving OpenAI OAuth and custom models', () => {
    const input = {
      version: 18,
      providers: [
        {
          type: 'openai-plan',
          id: 'openai-plan',
          oauth: {
            accessToken: 'openai-access',
            refreshToken: 'openai-refresh',
            expiresAt: 1_900_000_000_000,
            accountId: 'account-id',
          },
        },
        {
          type: 'anthropic-plan',
          id: 'anthropic-plan',
          oauth: {
            accessToken: 'claude-access',
            refreshToken: 'claude-refresh',
            expiresAt: 1_900_000_000_000,
          },
        },
        {
          type: 'openai-compatible',
          id: 'custom-provider',
          baseUrl: 'https://example.invalid/v1',
          apiKey: 'custom-key',
        },
      ],
      chatModels: [
        {
          providerType: 'openai-plan',
          providerId: 'openai-plan',
          id: 'gpt-5.5 (plan)',
          model: 'gpt-5.5',
          reasoning: { reasoning_effort: 'minimal' },
        },
        {
          providerType: 'anthropic-plan',
          providerId: 'anthropic-plan',
          id: 'claude-sonnet-4.6 (plan)',
          model: 'claude-sonnet-4-6',
          thinking: { enabled: true, budget_tokens: 4096 },
        },
        {
          providerType: 'openai-compatible',
          providerId: 'custom-provider',
          id: 'custom-model',
          model: 'custom-model',
        },
      ],
      chatModelId: 'gpt-5.5 (plan)',
      applyModelId: 'claude-sonnet-4.6 (plan)',
    }
    const before = JSON.parse(JSON.stringify(input)) as typeof input

    const result = parseSmartComposerSettings(input)

    expect(input).toEqual(before)
    expect(result.version).toBe(SETTINGS_SCHEMA_VERSION)
    expect(result.chatModelId).toBe('gpt-5.6-sol (plan)')
    expect(result.inlineEdit.modelId).toBe('claude-default (plan)')
    expect(result.providers).toEqual([
      expect.objectContaining({
        type: 'openai-plan',
        oauth: expect.objectContaining({ accessToken: 'openai-access' }),
      }),
      { type: 'anthropic-plan', id: 'anthropic-plan' },
      expect.objectContaining({
        type: 'openai-compatible',
        id: 'custom-provider',
      }),
    ])
    expect(result.chatModels).toContainEqual(
      expect.objectContaining({
        providerType: 'openai-compatible',
        providerId: 'custom-provider',
        id: 'custom-model',
        model: 'custom-model',
      }),
    )
    expect(
      result.chatModels.some((model) => model.id === 'gpt-5.5 (plan)'),
    ).toBe(false)
    expect(
      result.chatModels.some(
        (model) => model.id === 'claude-sonnet-4.6 (plan)',
      ),
    ).toBe(false)
  })
})
