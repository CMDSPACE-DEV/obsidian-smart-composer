import { SerializedChatMessage } from '../../../types/chat'

export const CHAT_SCHEMA_VERSION = 2

export type SerializedQueuedPrompt = {
  id: string
  message: Extract<SerializedChatMessage, { role: 'user' }>
  createdAt: number
  useVaultSearch?: boolean
}

export type ChatConversation = {
  id: string
  title: string
  messages: SerializedChatMessage[]
  queuedPrompts: SerializedQueuedPrompt[]
  createdAt: number
  updatedAt: number
  schemaVersion: number
}

export type ChatConversationMetadata = {
  id: string
  title: string
  updatedAt: number
  schemaVersion: number
}
