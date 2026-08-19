import { App } from 'obsidian'

import { ChatManager } from '../../database/json/chat/ChatManager'
import { SerializedQueuedPrompt } from '../../database/json/chat/types'
import { ChatUserMessage } from '../../types/chat'
import { Mentionable } from '../../types/mentionable'
import {
  deserializeMentionable,
  serializeMentionable,
} from '../../utils/chat/mentionable'

export type QueuedPrompt = {
  id: string
  message: ChatUserMessage
  createdAt: number
  useVaultSearch?: boolean
}

export class ConversationRunManager {
  private readonly queues = new Map<string, QueuedPrompt[]>()
  private readonly subscribers = new Set<
    (conversationId: string, queue: QueuedPrompt[]) => void
  >()
  private readonly chatManager: ChatManager

  constructor(private readonly app: App) {
    this.chatManager = new ChatManager(app)
  }

  subscribe(
    callback: (conversationId: string, queue: QueuedPrompt[]) => void,
  ): () => void {
    this.subscribers.add(callback)
    return () => this.subscribers.delete(callback)
  }

  getQueue(conversationId: string): QueuedPrompt[] {
    return [...(this.queues.get(conversationId) ?? [])]
  }

  async hydrate(conversationId: string): Promise<void> {
    const conversation = await this.chatManager.findById(conversationId)
    if (!conversation) return
    this.queues.set(
      conversationId,
      conversation.queuedPrompts.map((prompt) => this.deserialize(prompt)),
    )
    this.emit(conversationId)
  }

  async enqueue(
    conversationId: string,
    prompt: QueuedPrompt,
    priority = false,
  ): Promise<void> {
    const queue = this.getQueue(conversationId)
    priority ? queue.unshift(prompt) : queue.push(prompt)
    this.queues.set(conversationId, queue)
    this.emit(conversationId)
    await this.persist(conversationId)
  }

  async cancel(conversationId: string, id: string): Promise<void> {
    this.queues.set(
      conversationId,
      this.getQueue(conversationId).filter((item) => item.id !== id),
    )
    this.emit(conversationId)
    await this.persist(conversationId)
  }

  async shift(conversationId: string): Promise<QueuedPrompt | null> {
    const queue = this.getQueue(conversationId)
    const next = queue.shift() ?? null
    this.queues.set(conversationId, queue)
    this.emit(conversationId)
    await this.persist(conversationId)
    return next
  }

  clear(conversationId: string): void {
    this.queues.delete(conversationId)
    this.emit(conversationId)
  }

  private emit(conversationId: string): void {
    const queue = this.getQueue(conversationId)
    this.subscribers.forEach((subscriber) => subscriber(conversationId, queue))
  }

  private async persist(conversationId: string): Promise<void> {
    const conversation = await this.chatManager.findById(conversationId)
    if (!conversation) return
    await this.chatManager.updateChat(conversationId, {
      queuedPrompts: this.getQueue(conversationId).map((item) =>
        this.serialize(item),
      ),
    })
  }

  private serialize(prompt: QueuedPrompt): SerializedQueuedPrompt {
    return {
      id: prompt.id,
      createdAt: prompt.createdAt,
      useVaultSearch: prompt.useVaultSearch,
      message: {
        ...prompt.message,
        mentionables: prompt.message.mentionables.map(serializeMentionable),
      },
    }
  }

  private deserialize(prompt: SerializedQueuedPrompt): QueuedPrompt {
    return {
      id: prompt.id,
      createdAt: prompt.createdAt,
      useVaultSearch: prompt.useVaultSearch,
      message: {
        ...prompt.message,
        mentionables: prompt.message.mentionables
          .map((mentionable) => deserializeMentionable(mentionable, this.app))
          .filter((mentionable): mentionable is Mentionable => !!mentionable),
      },
    }
  }
}
