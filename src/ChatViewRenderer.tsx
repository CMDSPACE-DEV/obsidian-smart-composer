import * as Tooltip from '@radix-ui/react-tooltip'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { App } from 'obsidian'
import React from 'react'
import { Root, createRoot } from 'react-dom/client'

import type { ChatView } from './ChatView'
import Chat, { type ChatProps, type ChatRef } from './components/chat-view/Chat'
import { AppProvider } from './contexts/app-context'
import { BackgroundTasksProvider } from './contexts/background-tasks-context'
import { ChatViewProvider } from './contexts/chat-view-context'
import { DarkModeProvider } from './contexts/dark-mode-context'
import { DatabaseProvider } from './contexts/database-context'
import { DialogContainerProvider } from './contexts/dialog-container-context'
import { McpProvider } from './contexts/mcp-context'
import { PluginProvider } from './contexts/plugin-context'
import { RAGProvider } from './contexts/rag-context'
import { SettingsProvider } from './contexts/settings-context'
import type SmartComposerPlugin from './main'
import type { MentionableBlockData } from './types/mentionable'

export type ChatViewRenderer = {
  render(initialChatProps?: ChatProps): void
  close(): void
  openNewChat(selectedBlock?: MentionableBlockData): void
  addSelectionToChat(selectedBlock: MentionableBlockData): void
  focusMessage(): void
}

export function createChatViewRenderer({
  app,
  chatView,
  mountEl,
  plugin,
  onInputReady,
}: {
  app: App
  chatView: ChatView
  mountEl: HTMLDivElement
  plugin: SmartComposerPlugin
  onInputReady: () => void
}): ChatViewRenderer {
  const root: Root = createRoot(mountEl)
  const chatRef = React.createRef<ChatRef>()
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: 0,
      },
      mutations: {
        gcTime: 0,
      },
    },
  })
  let inputReadyObserver: MutationObserver | null = null
  let inputReadyMarked = false

  const markInputReady = () => {
    if (
      inputReadyMarked ||
      !mountEl.querySelector<HTMLElement>('[contenteditable="true"]')
    ) {
      return
    }
    inputReadyMarked = true
    inputReadyObserver?.disconnect()
    inputReadyObserver = null
    onInputReady()
  }

  const observeInputReady = () => {
    markInputReady()
    if (inputReadyMarked || inputReadyObserver) return
    const Observer = mountEl.ownerDocument.defaultView?.MutationObserver
    if (!Observer) return
    inputReadyObserver = new Observer(markInputReady)
    inputReadyObserver.observe(mountEl, { childList: true, subtree: true })
  }

  return {
    render(initialChatProps) {
      root.render(
        <ChatViewProvider chatView={chatView}>
          <PluginProvider plugin={plugin}>
            <AppProvider app={app}>
              <SettingsProvider
                settings={plugin.settings}
                setSettings={(newSettings) => plugin.setSettings(newSettings)}
                addSettingsChangeListener={(listener) =>
                  plugin.addSettingsChangeListener(listener)
                }
              >
                <DarkModeProvider>
                  <DatabaseProvider
                    getDatabaseManager={() => plugin.getDbManager()}
                  >
                    <RAGProvider getRAGEngine={() => plugin.getRAGEngine()}>
                      <McpProvider getMcpManager={() => plugin.getMcpManager()}>
                        <QueryClientProvider client={queryClient}>
                          <React.StrictMode>
                            <BackgroundTasksProvider
                              manager={plugin.backgroundTaskManager}
                            >
                              <DialogContainerProvider container={mountEl}>
                                <Tooltip.Provider
                                  delayDuration={350}
                                  skipDelayDuration={100}
                                >
                                  <Chat ref={chatRef} {...initialChatProps} />
                                </Tooltip.Provider>
                              </DialogContainerProvider>
                            </BackgroundTasksProvider>
                          </React.StrictMode>
                        </QueryClientProvider>
                      </McpProvider>
                    </RAGProvider>
                  </DatabaseProvider>
                </DarkModeProvider>
              </SettingsProvider>
            </AppProvider>
          </PluginProvider>
        </ChatViewProvider>,
      )
      observeInputReady()
    },
    close() {
      inputReadyObserver?.disconnect()
      inputReadyObserver = null
      root.unmount()
      queryClient.clear()
    },
    openNewChat(selectedBlock) {
      chatRef.current?.openNewChat(selectedBlock)
    },
    addSelectionToChat(selectedBlock) {
      chatRef.current?.addSelectionToChat(selectedBlock)
    },
    focusMessage() {
      chatRef.current?.focusMessage()
    },
  }
}
