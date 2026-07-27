import { z } from 'zod'

import {
  DEFAULT_CHAT_MODELS,
  DEFAULT_CHAT_MODEL_ID,
  DEFAULT_EMBEDDING_MODELS,
  DEFAULT_PROVIDERS,
} from '../../constants'
import { chatModelSchema } from '../../types/chat-model.types'
import { embeddingModelSchema } from '../../types/embedding-model.types'
import {
  MCP_EXECUTION_MODES,
  MCP_ROUTING_MODES,
  mcpConnectionConfigSchema,
} from '../../types/mcp.types'
import { llmProviderSchema } from '../../types/provider.types'
import {
  DEFAULT_RESEARCH_SOURCES,
  researchSettingsSchema,
} from '../../types/research.types'

import { SETTINGS_SCHEMA_VERSION } from './migrations'

const ragOptionsSchema = z.object({
  retrievalMode: z.enum(['auto', 'embedding', 'plan-rerank']).catch('auto'),
  folderReadMode: z.enum(['auto', 'focused', 'exhaustive']).catch('auto'),
  chunkSize: z.number().catch(1000),
  thresholdTokens: z.number().catch(8192),
  exhaustiveDirectTokenLimit: z.number().catch(60000),
  minSimilarity: z.number().catch(0.0),
  limit: z.number().catch(10),
  planRerankCandidateLimit: z.number().catch(40),
  excludePatterns: z.array(z.string()).catch([]),
  includePatterns: z.array(z.string()).catch([]),
})

/**
 * Settings
 */

export const smartComposerSettingsSchema = z.object({
  // Version
  version: z.literal(SETTINGS_SCHEMA_VERSION).catch(SETTINGS_SCHEMA_VERSION),

  providers: z.array(llmProviderSchema).catch([...DEFAULT_PROVIDERS]),

  chatModels: z.array(chatModelSchema).catch([...DEFAULT_CHAT_MODELS]),

  embeddingModels: z
    .array(embeddingModelSchema)
    .catch([...DEFAULT_EMBEDDING_MODELS]),

  chatModelId: z
    .string()
    .catch(
      DEFAULT_CHAT_MODELS.find((v) => v.id === DEFAULT_CHAT_MODEL_ID)?.id ??
        DEFAULT_CHAT_MODELS[0].id,
    ), // model for default chat feature
  embeddingModelId: z.string().catch(DEFAULT_EMBEDDING_MODELS[0].id), // model for embedding

  inlineEdit: z
    .object({
      modelId: z.string().nullable(),
      contextCharacters: z.number().int().positive(),
    })
    .catch({
      modelId: null,
      contextCharacters: 4000,
    }),

  documentEditing: z
    .object({
      largeEditRouting: z.enum([
        'auto-confirm',
        'always-job',
        'single-response',
      ]),
      destinationFolder: z.string(),
      preserveFrontmatter: z.boolean(),
      concurrency: z.union([z.literal(1), z.literal(2)]),
      retryLimit: z.number().int().min(0).max(5),
    })
    .catch({
      largeEditRouting: 'auto-confirm',
      destinationFolder: 'Smart Composer/Document Drafts',
      preserveFrontmatter: true,
      concurrency: 1,
      retryLimit: 2,
    }),

  imageGeneration: z
    .object({
      modelId: z.string(),
      outputFolder: z.string(),
      quality: z.enum(['low', 'medium', 'high']),
      concurrency: z.literal(1),
    })
    .catch({
      modelId: 'gpt-5.6-sol (plan)',
      outputFolder: 'Smart Composer/Generated Images',
      quality: 'high',
      concurrency: 1,
    }),

  appearance: z
    .object({
      skinMode: z.literal('follow-obsidian'),
    })
    .catch({
      skinMode: 'follow-obsidian',
    }),

  // System Prompt
  systemPrompt: z.string().catch(''),

  // RAG Options
  ragOptions: ragOptionsSchema.catch({
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
  }),

  // MCP configuration
  mcp: z
    .object({
      routingMode: z.enum(MCP_ROUTING_MODES).catch('auto'),
      executionMode: z.enum(MCP_EXECUTION_MODES).catch('full-auto'),
      connections: z.array(mcpConnectionConfigSchema).catch([]),
    })
    .catch({
      routingMode: 'auto',
      executionMode: 'full-auto',
      connections: [],
    }),

  research: researchSettingsSchema.catch({
    routingMode: 'auto',
    maxAutoSources: 2,
    sources: DEFAULT_RESEARCH_SOURCES,
  }),

  // Chat options
  chatOptions: z
    .object({
      includeCurrentFileContent: z.boolean(),
      enableTools: z.boolean(),
      maxAutoIterations: z.number(),
    })
    .catch({
      includeCurrentFileContent: true,
      enableTools: true,
      maxAutoIterations: 12,
    }),
})
export type SmartComposerSettings = z.infer<typeof smartComposerSettingsSchema>

export type SettingMigration = {
  fromVersion: number
  toVersion: number
  migrate: (data: Record<string, unknown>) => Record<string, unknown>
}
