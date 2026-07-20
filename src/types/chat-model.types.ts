import { z } from 'zod'

import { PromptLevel } from './prompt-level.types'

export const GPT_5_6_EFFORTS = [
  'none',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const
export type Gpt56Effort = (typeof GPT_5_6_EFFORTS)[number]

export const CLAUDE_ADAPTIVE_EFFORTS = [
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const
export type ClaudeEffort = (typeof CLAUDE_ADAPTIVE_EFFORTS)[number]

const anthropicManualThinkingSchema = z.object({
  enabled: z.boolean(),
  mode: z.literal('manual').optional(),
  budget_tokens: z.number(),
})

const anthropicAdaptiveThinkingSchema = z.object({
  enabled: z.boolean(),
  mode: z.literal('adaptive'),
  effort: z.enum(CLAUDE_ADAPTIVE_EFFORTS),
  display: z.enum(['summarized', 'omitted']),
})

export type AnthropicPlanThinking =
  | z.infer<typeof anthropicManualThinkingSchema>
  | z.infer<typeof anthropicAdaptiveThinkingSchema>

const baseChatModelSchema = z.object({
  providerId: z
    .string({
      required_error: 'provider ID is required',
    })
    .min(1, 'provider ID is required'),
  id: z
    .string({
      required_error: 'id is required',
    })
    .min(1, 'id is required'),
  model: z
    .string({
      required_error: 'model is required',
    })
    .min(1, 'model is required'),
  promptLevel: z
    .nativeEnum(PromptLevel)
    .default(PromptLevel.Default)
    .optional(),
  enable: z.boolean().default(true).optional(),
})

export const chatModelSchema = z.discriminatedUnion('providerType', [
  z.object({
    providerType: z.literal('anthropic-plan'),
    ...baseChatModelSchema.shape,
    thinking: z
      .union([anthropicManualThinkingSchema, anthropicAdaptiveThinkingSchema])
      .optional(),
  }),
  z.object({
    providerType: z.literal('openai-plan'),
    ...baseChatModelSchema.shape,
    reasoning: z
      .object({
        reasoning_effort: z
          .enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
          .optional(),
        reasoning_summary: z.enum(['auto', 'concise', 'detailed']).optional(),
      })
      .optional(),
  }),
  z.object({
    providerType: z.literal('gemini-plan'),
    ...baseChatModelSchema.shape,
    thinking: z
      .object({
        enabled: z.boolean(),
        // 'level' for Gemini 3 models, 'budget' for Gemini 2.5 models
        control_mode: z.enum(['level', 'budget']).optional(),
        // For Gemini 3 models
        thinking_level: z.enum(['minimal', 'low', 'medium', 'high']).optional(),
        // For Gemini 2.5 models: -1 for dynamic, 0 to disable, or specific token count
        thinking_budget: z.number().optional(),
        // Return thought summaries in response
        include_thoughts: z.boolean().optional(),
      })
      .optional(),
  }),
  z.object({
    providerType: z.literal('anthropic'),
    ...baseChatModelSchema.shape,
    thinking: z
      .object({
        enabled: z.boolean(),
        budget_tokens: z.number(),
      })
      .optional(),
  }),
  z.object({
    providerType: z.literal('openai'),
    ...baseChatModelSchema.shape,
    reasoning: z
      .object({
        enabled: z.boolean(),
        reasoning_effort: z.string().optional(),
      })
      .optional(),
  }),
  z.object({
    providerType: z.literal('gemini'),
    ...baseChatModelSchema.shape,
    thinking: z
      .object({
        enabled: z.boolean(),
        // 'level' for Gemini 3 models, 'budget' for Gemini 2.5 models
        control_mode: z.enum(['level', 'budget']).optional(),
        // For Gemini 3 models
        thinking_level: z.enum(['minimal', 'low', 'medium', 'high']).optional(),
        // For Gemini 2.5 models: -1 for dynamic, 0 to disable, or specific token count
        thinking_budget: z.number().optional(),
        // Return thought summaries in response
        include_thoughts: z.boolean().optional(),
      })
      .optional(),
  }),
  z.object({
    providerType: z.literal('xai'),
    ...baseChatModelSchema.shape,
  }),
  z.object({
    providerType: z.literal('deepseek'),
    ...baseChatModelSchema.shape,
  }),
  z.object({
    providerType: z.literal('mistral'),
    ...baseChatModelSchema.shape,
  }),
  z.object({
    providerType: z.literal('perplexity'),
    ...baseChatModelSchema.shape,
    web_search_options: z
      .object({
        search_context_size: z.string(),
      })
      .optional(),
  }),
  z.object({
    providerType: z.literal('openrouter'),
    ...baseChatModelSchema.shape,
  }),
  z.object({
    providerType: z.literal('ollama'),
    ...baseChatModelSchema.shape,
  }),
  z.object({
    providerType: z.literal('lm-studio'),
    ...baseChatModelSchema.shape,
  }),
  z.object({
    providerType: z.literal('azure-openai'),
    ...baseChatModelSchema.shape,
  }),
  z.object({
    providerType: z.literal('openai-compatible'),
    ...baseChatModelSchema.shape,
  }),
])

export type ChatModel = z.infer<typeof chatModelSchema>
