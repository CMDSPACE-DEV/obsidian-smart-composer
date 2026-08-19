export type AnthropicThinkingBlock =
  | {
      type: 'thinking'
      thinking: string
      signature: string
    }
  | {
      type: 'redacted_thinking'
      data: string
    }

/**
 * Provider-specific, opaque data that must survive conversation persistence.
 * Secrets in these fields are protocol continuations, not user-visible content.
 */
export type LLMProviderMetadata = {
  anthropic?: {
    thinkingBlocks?: AnthropicThinkingBlock[]
  }
  openaiCodex?: {
    outputItems?: unknown[]
    model?: string
  }
  gemini?: {
    thoughtSignature?: string
  }
  deepseek?: {
    reasoningContent?: string
  }
}
