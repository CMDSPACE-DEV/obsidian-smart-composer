import { Book, CircleStop, Plus } from 'lucide-react'
import { App, Notice } from 'obsidian'
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { v4 as uuidv4 } from 'uuid'

import { useApp } from '../../contexts/app-context'
import { useMcp } from '../../contexts/mcp-context'
import { usePlugin } from '../../contexts/plugin-context'
import { useRAG } from '../../contexts/rag-context'
import { useSettings } from '../../contexts/settings-context'
import { QueuedPrompt } from '../../core/conversation/ConversationRunManager'
import { getProviderCapabilities } from '../../core/llm/providerCapabilities'
import { useChatHistory } from '../../hooks/useChatHistory'
import type { BackgroundTaskRecord } from '../../types/background-task'
import {
  AssistantToolMessageGroup,
  ChatMessage,
  ChatToolMessage,
  ChatUserMessage,
} from '../../types/chat'
import {
  MentionableBlock,
  MentionableBlockData,
  MentionableCurrentFile,
} from '../../types/mentionable'
import { ToolCallResponseStatus } from '../../types/tool-call.types'
import { enqueueImageGenerationBatch } from '../../utils/chat/imageBatch'
import {
  MAX_IMAGE_BATCH_COUNT,
  getImageGenerationPrompt,
  isImageGenerationContinuation,
  parseImageGenerationRequest,
} from '../../utils/chat/imageIntent'
import {
  getMentionableKey,
  serializeMentionable,
} from '../../utils/chat/mentionable'
import { groupAssistantAndToolMessages } from '../../utils/chat/message-groups'
import { PromptGenerator } from '../../utils/chat/promptGenerator'
import { TemplateSectionModal } from '../modals/TemplateSectionModal'

import AssistantToolMessageGroupItem from './AssistantToolMessageGroupItem'
import { BackgroundTaskCards } from './BackgroundTaskCards'
import ChatUserInput, { ChatUserInputRef } from './chat-input/ChatUserInput'
import { editorStateToPlainText } from './chat-input/utils/editor-state-to-plain-text'
import { plainTextEditorState } from './chat-input/utils/plain-text-editor-state'
import { ChatIconButton } from './ChatIconButton'
import { ChatListDropdown } from './ChatListDropdown'
import { ImageQueuePanel } from './ImageQueuePanel'
import QueryProgress, { QueryProgressState } from './QueryProgress'
import { QueuedPrompts } from './QueuedPrompts'
import { ResponsePendingIndicator } from './ResponsePendingIndicator'
import { useAutoScroll } from './useAutoScroll'
import { useChatStreamManager } from './useChatStreamManager'
import UserMessageItem from './UserMessageItem'

// Add an empty line here
const getNewInputMessage = (app: App): ChatUserMessage => {
  return {
    role: 'user',
    content: null,
    promptContent: null,
    id: uuidv4(),
    mentionables: [
      {
        type: 'current-file',
        file: app.workspace.getActiveFile(),
      },
    ],
  }
}

export type ChatRef = {
  openNewChat: (selectedBlock?: MentionableBlockData) => void
  addSelectionToChat: (selectedBlock: MentionableBlockData) => void
  focusMessage: () => void
}

export type ChatProps = {
  selectedBlock?: MentionableBlockData
}

type ArtifactRequest = {
  kind: 'canvas' | 'base' | 'excalidraw'
  prompt: string
}

function matchArtifactRequest(text: string): ArtifactRequest | null {
  const command = text.match(/^\/(canvas|base|excalidraw)\b\s*/i)
  if (command) {
    return {
      kind: command[1].toLowerCase() as ArtifactRequest['kind'],
      prompt: text.slice(command[0].length).trim(),
    }
  }
  const verb = '(?:만들|생성|그려|작성|정리|create|build|make|draw|generate)'
  const patterns: [ArtifactRequest['kind'], RegExp][] = [
    ['excalidraw', new RegExp(`(?:excalidraw|엑스칼리드로).*(?:${verb})`, 'i')],
    [
      'canvas',
      new RegExp(`(?:obsidian\\s+)?(?:canvas|캔버스).*(?:${verb})`, 'i'),
    ],
    ['base', new RegExp(`(?:obsidian\\s+bases?|베이스).*(?:${verb})`, 'i')],
  ]
  const matched = patterns.find(([, pattern]) => pattern.test(text))
  return matched ? { kind: matched[0], prompt: text } : null
}

const Chat = forwardRef<ChatRef, ChatProps>((props, ref) => {
  const app = useApp()
  const plugin = usePlugin()
  const { settings, setSettings } = useSettings()
  const { getRAGEngine } = useRAG()
  const { getMcpManager } = useMcp()

  const {
    createOrUpdateConversation,
    deleteConversation,
    getChatMessagesById,
    updateConversationTitle,
    chatList,
  } = useChatHistory()
  const promptGenerator = useMemo(() => {
    return new PromptGenerator(getRAGEngine, app, settings, setSettings)
  }, [getRAGEngine, app, settings, setSettings])

  const [inputMessage, setInputMessage] = useState<ChatUserMessage>(() => {
    const newMessage = getNewInputMessage(app)
    if (props.selectedBlock) {
      newMessage.mentionables = [
        ...newMessage.mentionables,
        {
          type: 'block',
          ...props.selectedBlock,
        },
      ]
    }
    return newMessage
  })
  const [addedBlockKey, setAddedBlockKey] = useState<string | null>(
    props.selectedBlock
      ? getMentionableKey(
          serializeMentionable({
            type: 'block',
            ...props.selectedBlock,
          }),
        )
      : null,
  )
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [focusedMessageId, setFocusedMessageId] = useState<string | null>(null)
  const [currentConversationId, setCurrentConversationId] =
    useState<string>(uuidv4())
  const [queryProgress, setQueryProgress] = useState<QueryProgressState>({
    type: 'idle',
  })
  const [queuedPrompts, setQueuedPrompts] = useState<QueuedPrompt[]>([])

  const groupedChatMessages: (ChatUserMessage | AssistantToolMessageGroup)[] =
    useMemo(() => {
      return groupAssistantAndToolMessages(chatMessages)
    }, [chatMessages])

  const chatUserInputRefs = useRef<Map<string, ChatUserInputRef>>(new Map())
  const chatMessagesRef = useRef<HTMLDivElement>(null)
  const queueDispatchingRef = useRef(false)

  const { autoScrollToBottom, forceScrollToBottom } = useAutoScroll({
    scrollContainerRef: chatMessagesRef,
  })

  const { abortActiveStreams, responsePhase, submitChatMutation } =
    useChatStreamManager({
      setChatMessages,
      autoScrollToBottom,
      promptGenerator,
    })

  const handleUseBackgroundResult = useCallback(
    (task: BackgroundTaskRecord, result: string) => {
      if (submitChatMutation.isPending) {
        new Notice(
          'Wait for the current response to finish before using this result.',
        )
        return false
      }
      const displayName =
        typeof task.input.displayName === 'string'
          ? task.input.displayName
          : 'MCP tool'
      const visibleText = `Use background result: ${displayName}`
      const userMessage: ChatUserMessage = {
        role: 'user',
        id: uuidv4(),
        content: plainTextEditorState(visibleText),
        promptContent: [
          `A background MCP task (${displayName}) completed after its originating response.`,
          'Use the result below only in this new turn. Explain how it affects the ongoing work.',
          '',
          '<background_mcp_result>',
          result,
          '</background_mcp_result>',
        ].join('\n'),
        mentionables: [],
      }
      const updatedMessages = [...chatMessages, userMessage]
      setChatMessages(updatedMessages)
      submitChatMutation.mutate({
        chatMessages: updatedMessages,
        conversationId: currentConversationId,
      })
      requestAnimationFrame(forceScrollToBottom)
      return true
    },
    [
      chatMessages,
      currentConversationId,
      forceScrollToBottom,
      submitChatMutation,
    ],
  )

  const locateMessage = useCallback((messageId: string) => {
    const container = chatMessagesRef.current
    if (!container) return
    const element = Array.from(
      container.querySelectorAll<HTMLElement>('[data-message-id]'),
    ).find((candidate) => candidate.dataset.messageId === messageId)
    if (!element) return
    const reducedMotion =
      element.ownerDocument.defaultView?.matchMedia(
        '(prefers-reduced-motion: reduce)',
      ).matches ?? false
    element.scrollIntoView({
      behavior: reducedMotion ? 'auto' : 'smooth',
      block: 'center',
    })
    element.classList.add('smtcmp-message-anchor--highlighted')
    element.ownerDocument.defaultView?.setTimeout(() => {
      element.classList.remove('smtcmp-message-anchor--highlighted')
    }, 1400)
  }, [])

  useEffect(() => {
    const manager = plugin.conversationRunManager
    if (!manager) return
    setQueuedPrompts(manager.getQueue(currentConversationId))
    return manager.subscribe((conversationId, queue) => {
      if (conversationId === currentConversationId) setQueuedPrompts(queue)
    })
  }, [currentConversationId, plugin.conversationRunManager])

  useEffect(() => {
    void plugin.conversationRunManager?.hydrate(currentConversationId)
  }, [currentConversationId, plugin.conversationRunManager])

  const registerChatUserInputRef = (
    id: string,
    ref: ChatUserInputRef | null,
  ) => {
    if (ref) {
      chatUserInputRefs.current.set(id, ref)
    } else {
      chatUserInputRefs.current.delete(id)
    }
  }

  const handleLoadConversation = async (conversationId: string) => {
    try {
      abortActiveStreams()
      const conversation = await getChatMessagesById(conversationId)
      if (!conversation) {
        throw new Error('Conversation not found')
      }
      setCurrentConversationId(conversationId)
      setChatMessages(conversation)
      const newInputMessage = getNewInputMessage(app)
      setInputMessage(newInputMessage)
      setFocusedMessageId(newInputMessage.id)
      setQueryProgress({
        type: 'idle',
      })
    } catch (error) {
      new Notice('Failed to load conversation')
      console.error('Failed to load conversation', error)
    }
  }

  const handleNewChat = (selectedBlock?: MentionableBlockData) => {
    setCurrentConversationId(uuidv4())
    setChatMessages([])
    const newInputMessage = getNewInputMessage(app)
    if (selectedBlock) {
      const mentionableBlock: MentionableBlock = {
        type: 'block',
        ...selectedBlock,
      }
      newInputMessage.mentionables = [
        ...newInputMessage.mentionables,
        mentionableBlock,
      ]
      setAddedBlockKey(
        getMentionableKey(serializeMentionable(mentionableBlock)),
      )
    }
    setInputMessage(newInputMessage)
    setFocusedMessageId(newInputMessage.id)
    setQueryProgress({
      type: 'idle',
    })
    abortActiveStreams()
  }

  const handleUserMessageSubmit = useCallback(
    async ({
      inputChatMessages,
      useVaultSearch,
    }: {
      inputChatMessages: ChatMessage[]
      useVaultSearch?: boolean
    }) => {
      abortActiveStreams()
      setQueryProgress({
        type: 'idle',
      })

      // Update the chat history to show the new user message
      setChatMessages(inputChatMessages)
      requestAnimationFrame(() => {
        forceScrollToBottom()
      })

      const lastMessage = inputChatMessages.at(-1)
      if (lastMessage?.role !== 'user') {
        throw new Error('Last message is not a user message')
      }

      const compiledMessages = await Promise.all(
        inputChatMessages.map(async (message) => {
          if (message.role === 'user' && message.id === lastMessage.id) {
            const {
              promptContent,
              similaritySearchResults,
              retrievalMetadata,
            } = await promptGenerator.compileUserMessagePrompt({
              message,
              useVaultSearch,
              onQueryProgressChange: setQueryProgress,
            })
            return {
              ...message,
              promptContent,
              similaritySearchResults,
              retrievalMetadata,
            }
          } else if (message.role === 'user' && !message.promptContent) {
            // Ensure all user messages have prompt content
            // This is a fallback for cases where compilation was missed earlier in the process
            const {
              promptContent,
              similaritySearchResults,
              retrievalMetadata,
            } = await promptGenerator.compileUserMessagePrompt({
              message,
            })
            return {
              ...message,
              promptContent,
              similaritySearchResults,
              retrievalMetadata,
            }
          }
          return message
        }),
      )

      setChatMessages(compiledMessages)
      submitChatMutation.mutate({
        chatMessages: compiledMessages,
        conversationId: currentConversationId,
      })
    },
    [
      submitChatMutation,
      currentConversationId,
      promptGenerator,
      abortActiveStreams,
      forceScrollToBottom,
    ],
  )

  useEffect(() => {
    if (
      submitChatMutation.isPending ||
      submitChatMutation.isError ||
      queuedPrompts.length === 0 ||
      queueDispatchingRef.current
    ) {
      return
    }
    queueDispatchingRef.current = true
    void plugin.conversationRunManager
      ?.shift(currentConversationId)
      .then(async (next) => {
        if (!next) return
        await handleUserMessageSubmit({
          inputChatMessages: [...chatMessages, next.message],
          useVaultSearch: next.useVaultSearch,
        })
      })
      .finally(() => {
        queueDispatchingRef.current = false
      })
  }, [
    chatMessages,
    currentConversationId,
    handleUserMessageSubmit,
    plugin.conversationRunManager,
    queuedPrompts.length,
    submitChatMutation.isPending,
    submitChatMutation.isError,
  ])

  const handleToolMessageUpdate = useCallback(
    async (toolMessage: ChatToolMessage) => {
      const toolMessageIndex = chatMessages.findIndex(
        (message) => message.id === toolMessage.id,
      )
      if (toolMessageIndex === -1) {
        // The tool message no longer exists in the chat history.
        // This likely means a new message was submitted while this stream was running.
        // Abort the tool calls and keep the current chat history.
        void (async () => {
          const mcpManager = await getMcpManager()
          toolMessage.toolCalls.forEach((toolCall) => {
            mcpManager.abortToolCall(toolCall.request.id)
          })
        })()
        return
      }

      const updatedMessages = chatMessages.map((message) =>
        message.id === toolMessage.id ? toolMessage : message,
      )
      setChatMessages(updatedMessages)

      // Resume the chat automatically if this tool message is the last message
      // and all tool calls have completed.
      if (
        toolMessageIndex === chatMessages.length - 1 &&
        toolMessage.toolCalls.every((toolCall) =>
          [
            ToolCallResponseStatus.Success,
            ToolCallResponseStatus.Error,
          ].includes(toolCall.response.status),
        )
      ) {
        // Using updated toolMessage directly because chatMessages state
        // still contains the old values
        submitChatMutation.mutate({
          chatMessages: updatedMessages,
          conversationId: currentConversationId,
        })
        requestAnimationFrame(() => {
          forceScrollToBottom()
        })
      }
    },
    [
      chatMessages,
      currentConversationId,
      submitChatMutation,
      setChatMessages,
      getMcpManager,
      forceScrollToBottom,
    ],
  )

  const showContinueResponseButton = useMemo(() => {
    /**
     * Display the button to continue response when:
     * 1. There is no ongoing generation
     * 2. The most recent message is a tool message
     * 3. All tool calls within that message have completed
     */

    if (submitChatMutation.isPending) return false

    const lastMessage = chatMessages.at(-1)
    if (lastMessage?.role !== 'tool') return false

    return lastMessage.toolCalls.every((toolCall) =>
      [
        ToolCallResponseStatus.Aborted,
        ToolCallResponseStatus.Rejected,
        ToolCallResponseStatus.Error,
        ToolCallResponseStatus.Success,
      ].includes(toolCall.response.status),
    )
  }, [submitChatMutation.isPending, chatMessages])

  const handleContinueResponse = useCallback(() => {
    submitChatMutation.mutate({
      chatMessages: chatMessages,
      conversationId: currentConversationId,
    })
  }, [submitChatMutation, chatMessages, currentConversationId])

  useEffect(() => {
    setFocusedMessageId(inputMessage.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const updateConversationAsync = async () => {
      try {
        if (chatMessages.length > 0) {
          createOrUpdateConversation(currentConversationId, chatMessages)
        }
      } catch (error) {
        new Notice('Failed to save chat history')
        console.error('Failed to save chat history', error)
      }
    }
    updateConversationAsync()
  }, [currentConversationId, chatMessages, createOrUpdateConversation])

  // Updates the currentFile of the focused message (input or chat history)
  // This happens when active file changes or focused message changes
  const handleActiveLeafChange = useCallback(() => {
    const activeFile = app.workspace.getActiveFile()
    if (!activeFile) return

    const mentionable: Omit<MentionableCurrentFile, 'id'> = {
      type: 'current-file',
      file: activeFile,
    }

    if (!focusedMessageId) return
    if (inputMessage.id === focusedMessageId) {
      setInputMessage((prevInputMessage) => ({
        ...prevInputMessage,
        mentionables: [
          mentionable,
          ...prevInputMessage.mentionables.filter(
            (mentionable) => mentionable.type !== 'current-file',
          ),
        ],
      }))
    } else {
      setChatMessages((prevChatHistory) =>
        prevChatHistory.map((message) =>
          message.id === focusedMessageId && message.role === 'user'
            ? {
                ...message,
                mentionables: [
                  mentionable,
                  ...message.mentionables.filter(
                    (mentionable) => mentionable.type !== 'current-file',
                  ),
                ],
              }
            : message,
        ),
      )
    }
  }, [app.workspace, focusedMessageId, inputMessage.id])

  useEffect(() => {
    app.workspace.on('active-leaf-change', handleActiveLeafChange)
    return () => {
      app.workspace.off('active-leaf-change', handleActiveLeafChange)
    }
  }, [app.workspace, handleActiveLeafChange])

  useImperativeHandle(ref, () => ({
    openNewChat: (selectedBlock?: MentionableBlockData) =>
      handleNewChat(selectedBlock),
    addSelectionToChat: (selectedBlock: MentionableBlockData) => {
      const mentionable: Omit<MentionableBlock, 'id'> = {
        type: 'block',
        ...selectedBlock,
      }

      setAddedBlockKey(getMentionableKey(serializeMentionable(mentionable)))

      if (focusedMessageId === inputMessage.id) {
        setInputMessage((prevInputMessage) => {
          const mentionableKey = getMentionableKey(
            serializeMentionable(mentionable),
          )
          // Check if mentionable already exists
          if (
            prevInputMessage.mentionables.some(
              (m) =>
                getMentionableKey(serializeMentionable(m)) === mentionableKey,
            )
          ) {
            return prevInputMessage
          }
          return {
            ...prevInputMessage,
            mentionables: [...prevInputMessage.mentionables, mentionable],
          }
        })
      } else {
        setChatMessages((prevChatHistory) =>
          prevChatHistory.map((message) => {
            if (message.id === focusedMessageId && message.role === 'user') {
              const mentionableKey = getMentionableKey(
                serializeMentionable(mentionable),
              )
              // Check if mentionable already exists
              if (
                message.mentionables.some(
                  (m) =>
                    getMentionableKey(serializeMentionable(m)) ===
                    mentionableKey,
                )
              ) {
                return message
              }
              return {
                ...message,
                mentionables: [...message.mentionables, mentionable],
              }
            }
            return message
          }),
        )
      }
    },
    focusMessage: () => {
      if (!focusedMessageId) return
      chatUserInputRefs.current.get(focusedMessageId)?.focus()
    },
  }))

  return (
    <div
      className="smtcmp-chat-container"
      data-response-phase={
        submitChatMutation.isPending ? responsePhase : 'idle'
      }
    >
      <div className="smtcmp-chat-header">
        <h1 className="smtcmp-chat-header-title">
          <span>Chat</span>
          <span className="smtcmp-chat-header-title__role smtcmp-chat-header-title__role--cowork">
            {' '}
            / COWORK
          </span>
          <span className="smtcmp-chat-header-title__role smtcmp-chat-header-title__role--operator">
            {' '}
            / OPERATOR
          </span>
        </h1>
        <div className="smtcmp-chat-header-buttons">
          <ChatIconButton
            icon={Plus}
            label="New chat"
            tooltip="Start a new chat"
            onClick={() => handleNewChat()}
            className="smtcmp-chat-header__action"
          />
          <ChatListDropdown
            chatList={chatList}
            currentConversationId={currentConversationId}
            onSelect={async (conversationId) => {
              if (conversationId === currentConversationId) return
              await handleLoadConversation(conversationId)
            }}
            onDelete={async (conversationId) => {
              await deleteConversation(conversationId)
              if (conversationId === currentConversationId) {
                const nextConversation = chatList.find(
                  (chat) => chat.id !== conversationId,
                )
                if (nextConversation) {
                  void handleLoadConversation(nextConversation.id)
                } else {
                  handleNewChat()
                }
              }
            }}
            onUpdateTitle={async (conversationId, newTitle) => {
              await updateConversationTitle(conversationId, newTitle)
            }}
          />
          <ChatIconButton
            icon={Book}
            label="Prompt templates"
            tooltip="Open prompt templates"
            onClick={() => {
              new TemplateSectionModal(app).open()
            }}
            className="smtcmp-chat-header__action"
          />
        </div>
      </div>
      <ImageQueuePanel
        conversationId={currentConversationId}
        onLocateOrigin={locateMessage}
      />
      <div className="smtcmp-chat-messages" ref={chatMessagesRef}>
        {groupedChatMessages.map((messageOrGroup, index) =>
          !Array.isArray(messageOrGroup) ? (
            <div
              className="smtcmp-message-anchor"
              data-message-id={messageOrGroup.id}
              key={messageOrGroup.id}
            >
              <UserMessageItem
                message={messageOrGroup}
                chatUserInputRef={(ref) =>
                  registerChatUserInputRef(messageOrGroup.id, ref)
                }
                onSubmit={(content, useVaultSearch, mentionables) => {
                  if (editorStateToPlainText(content).trim() === '') return
                  handleUserMessageSubmit({
                    inputChatMessages: [
                      ...groupedChatMessages
                        .slice(0, index)
                        .flatMap((messageOrGroup): ChatMessage[] =>
                          !Array.isArray(messageOrGroup)
                            ? [messageOrGroup]
                            : messageOrGroup,
                        ),
                      {
                        role: 'user',
                        content: content,
                        promptContent: null,
                        id: messageOrGroup.id,
                        mentionables,
                      },
                    ],
                    useVaultSearch,
                  })
                  chatUserInputRefs.current.get(inputMessage.id)?.focus()
                }}
                onFocus={() => {
                  setFocusedMessageId(messageOrGroup.id)
                }}
              />
              <BackgroundTaskCards
                conversationId={currentConversationId}
                originMessageId={messageOrGroup.id}
                onUseResult={handleUseBackgroundResult}
              />
            </div>
          ) : (
            <AssistantToolMessageGroupItem
              key={messageOrGroup.at(0)?.id}
              messages={messageOrGroup}
              contextMessages={groupedChatMessages
                .slice(0, index + 1)
                .flatMap((messageOrGroup): ChatMessage[] =>
                  !Array.isArray(messageOrGroup)
                    ? [messageOrGroup]
                    : messageOrGroup,
                )}
              conversationId={currentConversationId}
              isStreaming={
                submitChatMutation.isPending &&
                index === groupedChatMessages.length - 1
              }
              onToolMessageUpdate={handleToolMessageUpdate}
            />
          ),
        )}
        <QueryProgress state={queryProgress} />
        {submitChatMutation.isPending &&
          responsePhase === 'waiting' &&
          queryProgress.type === 'idle' && <ResponsePendingIndicator />}
        {showContinueResponseButton && (
          <div className="smtcmp-continue-response-button-container">
            <button
              className="smtcmp-continue-response-button"
              onClick={handleContinueResponse}
            >
              <div>Continue Response</div>
            </button>
          </div>
        )}
        {submitChatMutation.isPending && (
          <button onClick={abortActiveStreams} className="smtcmp-stop-gen-btn">
            <CircleStop size={16} />
            <div>Stop Generation</div>
          </button>
        )}
      </div>
      <QueuedPrompts
        prompts={queuedPrompts}
        paused={submitChatMutation.isError}
        onResume={() => submitChatMutation.reset()}
        onCancel={(prompt) => {
          void plugin.conversationRunManager?.cancel(
            currentConversationId,
            prompt.id,
          )
        }}
        onEdit={(prompt) => {
          void plugin.conversationRunManager?.cancel(
            currentConversationId,
            prompt.id,
          )
          setInputMessage(prompt.message)
        }}
        onSendNow={(prompt) => {
          abortActiveStreams()
          void plugin.conversationRunManager
            ?.cancel(currentConversationId, prompt.id)
            .then(() =>
              plugin.conversationRunManager?.enqueue(
                currentConversationId,
                prompt,
                true,
              ),
            )
        }}
      />
      <ChatUserInput
        key={inputMessage.id} // this is needed to clear the editor when the user submits a new message
        ref={(ref) => registerChatUserInputRef(inputMessage.id, ref)}
        initialSerializedEditorState={inputMessage.content}
        onChange={(content) => {
          setInputMessage((prevInputMessage) => ({
            ...prevInputMessage,
            content,
          }))
        }}
        onSubmit={(content, useVaultSearch, mode = 'chat') => {
          const plainText = editorStateToPlainText(content).trim()
          if (plainText === '') return
          const selectedModel = settings.chatModels.find(
            (model) => model.id === settings.chatModelId,
          )
          const canGenerateImages =
            !!selectedModel &&
            getProviderCapabilities(selectedModel).imageGeneration
          const taskManager = plugin.backgroundTaskManager
          const conversationImageTasks =
            taskManager
              ?.getTasks(currentConversationId)
              .filter((task) => task.kind === 'image-generation') ?? []
          let previousImagePrompt: string | undefined
          for (
            let index = conversationImageTasks.length - 1;
            index >= 0;
            index--
          ) {
            const task = conversationImageTasks[index]
            if (typeof task.input.batchBasePrompt === 'string') {
              previousImagePrompt = task.input.batchBasePrompt
              break
            }
            if (
              typeof task.input.prompt === 'string' &&
              !isImageGenerationContinuation(task.input.prompt)
            ) {
              previousImagePrompt = task.input.prompt
              break
            }
          }
          const imageRequest = parseImageGenerationRequest(plainText, {
            force: mode === 'image',
            previousPrompt: previousImagePrompt,
          })
          const artifactMatch = matchArtifactRequest(plainText)
          if (artifactMatch && taskManager) {
            const artifactKind = artifactMatch.kind
            const userMessage = { ...inputMessage, content }
            setChatMessages((messages) => [...messages, userMessage])
            void taskManager.enqueue({
              conversationId: currentConversationId,
              originMessageId: inputMessage.id,
              kind: 'artifact-draft',
              payload: {
                prompt: artifactMatch.prompt,
                artifactKind,
              },
            })
            setInputMessage(getNewInputMessage(app))
            return
          }
          if (canGenerateImages && imageRequest && taskManager) {
            const userMessage = { ...inputMessage, content }
            setChatMessages((messages) => [...messages, userMessage])
            if (imageRequest.requestedCount > MAX_IMAGE_BATCH_COUNT) {
              new Notice(
                `A maximum of ${MAX_IMAGE_BATCH_COUNT} images can be queued at once. Queuing ${MAX_IMAGE_BATCH_COUNT}.`,
              )
            }
            const targetFilePath = app.workspace.getActiveFile()?.path
            void (async () => {
              const result = await enqueueImageGenerationBatch(
                taskManager,
                imageRequest,
                {
                  conversationId: currentConversationId,
                  originMessageId: inputMessage.id,
                  sourcePrompt:
                    getImageGenerationPrompt(plainText) || plainText,
                  modelId: settings.chatModelId,
                  targetFilePath,
                },
              )
              if (result.error) {
                new Notice(
                  `Queued ${result.queuedCount} of ${result.total} images. ${
                    result.error instanceof Error
                      ? result.error.message
                      : String(result.error)
                  }`,
                )
              }
            })()
            setInputMessage(getNewInputMessage(app))
            return
          }
          const userMessage = { ...inputMessage, content }
          if (submitChatMutation.isPending) {
            void plugin.conversationRunManager?.enqueue(currentConversationId, {
              id: userMessage.id,
              message: userMessage,
              createdAt: Date.now(),
              useVaultSearch,
            })
            setInputMessage(getNewInputMessage(app))
            return
          }
          handleUserMessageSubmit({
            inputChatMessages: [...chatMessages, userMessage],
            useVaultSearch,
          })
          setInputMessage(getNewInputMessage(app))
        }}
        onFocus={() => {
          setFocusedMessageId(inputMessage.id)
        }}
        mentionables={inputMessage.mentionables}
        setMentionables={(mentionables) => {
          setInputMessage((prevInputMessage) => ({
            ...prevInputMessage,
            mentionables,
          }))
        }}
        autoFocus
        addedBlockKey={addedBlockKey}
        isForegroundPending={submitChatMutation.isPending}
      />
    </div>
  )
})

Chat.displayName = 'Chat'

export default Chat
