import { UseMutationResult, useMutation } from '@tanstack/react-query'
import { Notice } from 'obsidian'
import { useCallback, useRef, useState } from 'react'

import { useApp } from '../../contexts/app-context'
import { useMcp } from '../../contexts/mcp-context'
import { useSettings } from '../../contexts/settings-context'
import {
  LLMAPIKeyInvalidException,
  LLMAPIKeyNotSetException,
  LLMBaseUrlNotSetException,
  LLMModelNotFoundException,
} from '../../core/llm/exception'
import { ChatMessage, ChatUserMessage } from '../../types/chat'
import { PromptGenerator } from '../../utils/chat/promptGenerator'
import { ResponseGenerator } from '../../utils/chat/responseGenerator'
import { hasVisibleResponseOutput } from '../../utils/chat/responseState'
import { ErrorModal } from '../modals/ErrorModal'

type UseChatStreamManagerParams = {
  setChatMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>
  autoScrollToBottom: () => void
  promptGenerator: PromptGenerator
}

export type UseChatStreamManager = {
  abortActiveStreams: () => void
  responsePhase: 'idle' | 'waiting' | 'streaming'
  submitChatMutation: UseMutationResult<
    void,
    Error,
    { chatMessages: ChatMessage[]; conversationId: string }
  >
}

export function useChatStreamManager({
  setChatMessages,
  autoScrollToBottom,
  promptGenerator,
}: UseChatStreamManagerParams): UseChatStreamManager {
  const app = useApp()
  const { settings, setSettings } = useSettings()
  const { getMcpManager } = useMcp()

  const activeStreamAbortControllersRef = useRef<AbortController[]>([])
  const [responsePhase, setResponsePhase] = useState<
    'idle' | 'waiting' | 'streaming'
  >('idle')

  const abortActiveStreams = useCallback(() => {
    for (const abortController of activeStreamAbortControllersRef.current) {
      abortController.abort()
    }
    activeStreamAbortControllersRef.current = []
  }, [])

  const submitChatMutation = useMutation({
    mutationFn: async ({
      chatMessages,
      conversationId,
    }: {
      chatMessages: ChatMessage[]
      conversationId: string
    }) => {
      const lastMessage = chatMessages.at(-1)
      if (!lastMessage) {
        // chatMessages is empty
        return
      }

      setResponsePhase('waiting')
      abortActiveStreams()
      const abortController = new AbortController()
      activeStreamAbortControllersRef.current.push(abortController)

      let unsubscribeResponseGenerator: (() => void) | undefined

      try {
        const { getChatModelClient } = await import('../../core/llm/manager')
        let chatModelClient: ReturnType<typeof getChatModelClient>
        try {
          chatModelClient = getChatModelClient({
            modelId: settings.chatModelId,
            settings,
            setSettings,
          })
        } catch (error) {
          if (
            !(error instanceof LLMModelNotFoundException) ||
            settings.chatModels.length === 0
          ) {
            throw error
          }
          const firstChatModel = settings.chatModels[0]
          setSettings({
            ...settings,
            chatModelId: firstChatModel.id,
            chatModels: settings.chatModels.map((model) =>
              model.id === firstChatModel.id
                ? {
                    ...model,
                    enable: true,
                  }
                : model,
            ),
          })
          chatModelClient = getChatModelClient({
            modelId: firstChatModel.id,
            settings,
            setSettings,
          })
        }
        const mcpManager =
          settings.chatOptions.enableTools &&
          settings.mcp.routingMode !== 'off' &&
          settings.mcp.connections.some((connection) => connection.enabled)
            ? await getMcpManager()
            : null
        const latestUserMessage = [...chatMessages]
          .reverse()
          .find((message) => message.role === 'user')
        const mcpConnectionIds =
          latestUserMessage?.role === 'user'
            ? latestUserMessage.mentionables.flatMap((mentionable) =>
                mentionable.type === 'connection'
                  ? [mentionable.connectionId]
                  : [],
              )
            : []
        const mcpQuery =
          latestUserMessage?.role === 'user'
            ? getUserPromptText(latestUserMessage.promptContent)
            : ''
        const responseGenerator = new ResponseGenerator({
          providerClient: chatModelClient.providerClient,
          model: chatModelClient.model,
          messages: chatMessages,
          conversationId,
          enableTools: settings.chatOptions.enableTools,
          maxAutoIterations: settings.chatOptions.maxAutoIterations,
          promptGenerator,
          mcpManager,
          mcpRoutingMode: settings.mcp.routingMode,
          mcpQuery,
          mcpConnectionIds,
          abortSignal: abortController.signal,
        })

        unsubscribeResponseGenerator = responseGenerator.subscribe(
          (responseMessages) => {
            if (hasVisibleResponseOutput(responseMessages)) {
              setResponsePhase('streaming')
            }
            setChatMessages((prevChatMessages) => {
              const lastMessageIndex = prevChatMessages.findIndex(
                (message) => message.id === lastMessage.id,
              )
              if (lastMessageIndex === -1) {
                // The last message no longer exists in the chat history.
                // This likely means a new message was submitted while this stream was running.
                // Abort this stream and keep the current chat history.
                abortController.abort()
                return prevChatMessages
              }
              return [
                ...prevChatMessages.slice(0, lastMessageIndex + 1),
                ...responseMessages,
              ]
            })
            autoScrollToBottom()
          },
        )

        await responseGenerator.run()
      } catch (error) {
        // Ignore AbortError
        if (error instanceof Error && error.name === 'AbortError') {
          return
        }
        throw error
      } finally {
        if (unsubscribeResponseGenerator) {
          unsubscribeResponseGenerator()
        }
        activeStreamAbortControllersRef.current =
          activeStreamAbortControllersRef.current.filter(
            (controller) => controller !== abortController,
          )
      }
    },
    onError: (error) => {
      if (
        error instanceof LLMAPIKeyNotSetException ||
        error instanceof LLMAPIKeyInvalidException ||
        error instanceof LLMBaseUrlNotSetException
      ) {
        new ErrorModal(app, 'Error', error.message, error.rawError?.message, {
          showSettingsButton: true,
        }).open()
      } else {
        new Notice(error.message)
        console.error('Failed to generate response', error)
      }
    },
    onSettled: () => {
      setResponsePhase('idle')
    },
  })

  return {
    abortActiveStreams,
    responsePhase,
    submitChatMutation,
  }
}

function getUserPromptText(content: ChatUserMessage['promptContent']): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .flatMap((part) =>
      part &&
      typeof part === 'object' &&
      'type' in part &&
      part.type === 'text' &&
      'text' in part &&
      typeof part.text === 'string'
        ? [part.text]
        : [],
    )
    .join('\n')
}
