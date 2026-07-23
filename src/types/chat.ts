import { SerializedEditorState } from 'lexical'

import { SelectEmbedding } from '../database/schema'

import { ChatModel } from './chat-model.types'
import { ContentPart, RequestProviderMetadata } from './llm/request'
import { Annotation, ResponseUsage } from './llm/response'
import { Mentionable, SerializedMentionable } from './mentionable'
import { ToolCallRequest, ToolCallResponse } from './tool-call.types'

export type RetrievalMetadata = {
  retrievalMode:
    | 'embedding'
    | 'plan-rerank'
    | 'exhaustive-direct'
    | 'exhaustive-batch'
  scopeType: 'files' | 'folders' | 'vault'
  totalFilesRead: number
  totalChunksBuilt: number
  candidateChunks: number
  selectedChunks: number
  exhaustive: boolean
  fallbackUsed?: boolean
  warnings?: string[]
}

export type ChatUserMessage = {
  role: 'user'
  content: SerializedEditorState | null
  promptContent: string | ContentPart[] | null
  id: string
  mentionables: Mentionable[]
  similaritySearchResults?: (Omit<SelectEmbedding, 'embedding'> & {
    similarity: number
  })[]
  retrievalMetadata?: RetrievalMetadata
}
export type ChatAssistantMessage = {
  role: 'assistant'
  content: string
  reasoning?: string
  annotations?: Annotation[]
  toolCallRequests?: ToolCallRequest[]
  id: string
  metadata?: {
    usage?: ResponseUsage
    model?: ChatModel // TODO: migrate legacy data to new model type
  }
  providerMetadata?: RequestProviderMetadata
}
export type ChatToolMessage = {
  role: 'tool'
  id: string
  toolCalls: {
    request: ToolCallRequest
    response: ToolCallResponse
  }[]
}

export type ChatMessage =
  | ChatUserMessage
  | ChatAssistantMessage
  | ChatToolMessage

export type AssistantToolMessageGroup = (
  | ChatAssistantMessage
  | ChatToolMessage
)[]

export type SerializedChatUserMessage = {
  role: 'user'
  content: SerializedEditorState | null
  promptContent: string | ContentPart[] | null
  id: string
  mentionables: SerializedMentionable[]
  similaritySearchResults?: (Omit<SelectEmbedding, 'embedding'> & {
    similarity: number
  })[]
  retrievalMetadata?: RetrievalMetadata
}
export type SerializedChatAssistantMessage = {
  role: 'assistant'
  content: string
  reasoning?: string
  annotations?: Annotation[]
  toolCallRequests?: ToolCallRequest[]
  id: string
  metadata?: {
    usage?: ResponseUsage
    model?: ChatModel // TODO: migrate legacy data to new model type
  }
  providerMetadata?: RequestProviderMetadata
}
export type SerializedChatToolMessage = {
  role: 'tool'
  toolCalls: {
    request: ToolCallRequest
    response: ToolCallResponse
  }[]
  id: string
}
export type SerializedChatMessage =
  | SerializedChatUserMessage
  | SerializedChatAssistantMessage
  | SerializedChatToolMessage

export type ChatConversation = {
  schemaVersion: number
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: SerializedChatMessage[]
}
export type ChatConversationMeta = {
  schemaVersion: number
  id: string
  title: string
  createdAt: number
  updatedAt: number
}
