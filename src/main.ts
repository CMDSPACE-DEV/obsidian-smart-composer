import { Editor, MarkdownView, Notice, Plugin } from 'obsidian'

import { ChatView } from './ChatView'
import type { ChatProps } from './components/chat-view/Chat'
import { InstallerUpdateRequiredModal } from './components/modals/InstallerUpdateRequiredModal'
import { CHAT_VIEW_TYPE } from './constants'
import { ConversationRunManager } from './core/conversation/ConversationRunManager'
import type { InlineEditController } from './core/inline/InlineEditController'
import type { McpManager } from './core/mcp/mcpManager'
import type { RAGEngine } from './core/rag/ragEngine'
import { BackgroundTaskManager } from './core/tasks/BackgroundTaskManager'
import { LazyBackgroundTaskAdapter } from './core/tasks/LazyBackgroundTaskAdapter'
import type { DatabaseManager } from './database/DatabaseManager'
import { PGLiteAbortedException } from './database/exception'
import {
  SmartComposerSettings,
  smartComposerSettingsSchema,
} from './settings/schema/setting.types'
import { parseSmartComposerSettings } from './settings/schema/settings'
import { SmartComposerSettingTab } from './settings/SettingTab'
import { getMentionableBlockData } from './utils/obsidian'
import { SettingsSaveQueue } from './utils/settingsSaveQueue'

export default class SmartComposerPlugin extends Plugin {
  settings: SmartComposerSettings
  initialChatProps?: ChatProps
  settingsChangeListeners: ((newSettings: SmartComposerSettings) => void)[] = []
  mcpManager: McpManager | null = null
  dbManager: DatabaseManager | null = null
  ragEngine: RAGEngine | null = null
  backgroundTaskManager: BackgroundTaskManager | null = null
  inlineEditController: InlineEditController | null = null
  conversationRunManager: ConversationRunManager | null = null
  private dbManagerInitPromise: Promise<DatabaseManager> | null = null
  private ragEngineInitPromise: Promise<RAGEngine> | null = null
  private mcpManagerInitPromise: Promise<McpManager> | null = null
  private inlineEditControllerInitPromise: Promise<InlineEditController> | null =
    null
  private settingsSaveQueue: SettingsSaveQueue<SmartComposerSettings> | null =
    null
  private timeoutIds: ReturnType<typeof setTimeout>[] = [] // Use ReturnType instead of number
  private unloading = false

  async onload() {
    markPerformance('smart-composer:onload:start')
    this.unloading = false
    await this.loadSettings()
    const taskManager = new BackgroundTaskManager(this.app)
    this.backgroundTaskManager = taskManager
    await taskManager.initialize()
    this.register(
      taskManager.registerAdapter(
        new LazyBackgroundTaskAdapter('image-generation', async () => {
          const { PlanImageTaskAdapter } = await import(
            './core/image/PlanImageTaskAdapter'
          )
          return new PlanImageTaskAdapter(
            this.app,
            taskManager,
            () => this.settings,
            (settings) => this.setSettings(settings),
          )
        }),
      ),
    )
    this.register(
      taskManager.registerAdapter(
        new LazyBackgroundTaskAdapter('artifact-draft', async () => {
          const { ArtifactTaskAdapter } = await import(
            './core/artifacts/ArtifactTaskAdapter'
          )
          return new ArtifactTaskAdapter(this)
        }),
      ),
    )
    this.conversationRunManager = new ConversationRunManager(this.app)

    this.registerView(CHAT_VIEW_TYPE, (leaf) => new ChatView(leaf, this))

    // This creates an icon in the left ribbon.
    this.addRibbonIcon('wand-sparkles', 'Open smart composer', () =>
      this.openChatView(),
    )

    // This adds a simple command that can be triggered anywhere
    this.addCommand({
      id: 'open-new-chat',
      name: 'Open chat',
      callback: () => this.openChatView(true),
    })

    this.addCommand({
      id: 'add-selection-to-chat',
      name: 'Add selection to chat',
      editorCallback: (editor: Editor, view: MarkdownView) => {
        this.addSelectionToChat(editor, view)
      },
    })

    this.addCommand({
      id: 'inline-edit',
      name: 'Inline edit selection',
      hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'k' }],
      editorCallback: (editor: Editor, view: MarkdownView) => {
        void this.openInlineEdit(editor, view)
      },
    })

    this.registerEvent(
      this.app.workspace.on('editor-menu', (menu, editor, info) => {
        if (!(info instanceof MarkdownView)) return
        menu.addItem((item) => {
          item
            .setTitle('Smart Composer: Inline edit')
            .setIcon('wand-sparkles')
            .setSection('action')
            .onClick(() => {
              void this.openInlineEdit(editor, info)
            })
        })
      }),
    )

    this.addCommand({
      id: 'rebuild-vault-index',
      name: 'Rebuild entire vault index',
      callback: async () => {
        const notice = new Notice('Rebuilding vault index...', 0)
        try {
          const ragEngine = await this.getRAGEngine()
          await ragEngine.updateVaultIndex(
            { reindexAll: true },
            (queryProgress) => {
              if (queryProgress.type === 'indexing') {
                const { completedChunks, totalChunks } =
                  queryProgress.indexProgress
                notice.setMessage(
                  `Indexing chunks: ${completedChunks} / ${totalChunks}${
                    queryProgress.indexProgress.waitingForRateLimit
                      ? '\n(waiting for rate limit to reset)'
                      : ''
                  }`,
                )
              }
            },
          )
          notice.setMessage('Rebuilding vault index complete')
        } catch (error) {
          console.error(error)
          notice.setMessage('Rebuilding vault index failed')
        } finally {
          this.registerTimeout(() => {
            notice.hide()
          }, 1000)
        }
      },
    })

    this.addCommand({
      id: 'update-vault-index',
      name: 'Update index for modified files',
      callback: async () => {
        const notice = new Notice('Updating vault index...', 0)
        try {
          const ragEngine = await this.getRAGEngine()
          await ragEngine.updateVaultIndex(
            { reindexAll: false },
            (queryProgress) => {
              if (queryProgress.type === 'indexing') {
                const { completedChunks, totalChunks } =
                  queryProgress.indexProgress
                notice.setMessage(
                  `Indexing chunks: ${completedChunks} / ${totalChunks}${
                    queryProgress.indexProgress.waitingForRateLimit
                      ? '\n(waiting for rate limit to reset)'
                      : ''
                  }`,
                )
              }
            },
          )
          notice.setMessage('Vault index updated')
        } catch (error) {
          console.error(error)
          notice.setMessage('Vault index update failed')
        } finally {
          this.registerTimeout(() => {
            notice.hide()
          }, 1000)
        }
      },
    })

    // This adds a settings tab so the user can configure various aspects of the plugin
    this.addSettingTab(new SmartComposerSettingTab(this.app, this))

    void this.migrateToJsonStorage()
    markPerformance('smart-composer:onload:end')
    measurePerformance(
      'smart-composer:onload',
      'smart-composer:onload:start',
      'smart-composer:onload:end',
    )
  }

  onunload() {
    this.unloading = true
    void this.backgroundTaskManager?.cleanup()
    this.backgroundTaskManager = null
    this.inlineEditController?.cleanup()
    this.inlineEditController = null
    this.conversationRunManager = null
    // clear all timers
    this.timeoutIds.forEach((id) => clearTimeout(id))
    this.timeoutIds = []

    // RagEngine cleanup
    this.ragEngine?.cleanup()
    this.ragEngine = null

    // Promise cleanup
    this.dbManagerInitPromise = null
    this.ragEngineInitPromise = null
    this.mcpManagerInitPromise = null
    this.inlineEditControllerInitPromise = null

    // DatabaseManager cleanup
    this.dbManager?.cleanup()
    this.dbManager = null

    // McpManager cleanup
    this.mcpManager?.cleanup()
    this.mcpManager = null
  }

  async loadSettings() {
    this.settings = parseSmartComposerSettings(await this.loadData())
    await this.saveData(this.settings) // Save updated settings
    this.settingsSaveQueue = new SettingsSaveQueue(this.settings)
  }

  async setSettings(newSettings: SmartComposerSettings) {
    const validationResult = smartComposerSettingsSchema.safeParse(newSettings)

    if (!validationResult.success) {
      new Notice(`Invalid settings:
${validationResult.error.issues.map((v) => v.message).join('\n')}`)
      return
    }

    const previousSettings = this.settings
    this.settings = newSettings
    this.ragEngine?.setSettings(newSettings)
    this.settingsChangeListeners.forEach((listener) => listener(newSettings))

    const settingsSaveQueue =
      this.settingsSaveQueue ?? new SettingsSaveQueue(previousSettings)
    this.settingsSaveQueue = settingsSaveQueue
    const saveOperation = settingsSaveQueue.enqueue(newSettings, (settings) =>
      this.saveData(settings),
    )

    try {
      await saveOperation
    } catch (error) {
      if (this.settings === newSettings) {
        const persistedSettings = settingsSaveQueue.persistedValue
        this.settings = persistedSettings
        this.ragEngine?.setSettings(persistedSettings)
        this.settingsChangeListeners.forEach((listener) =>
          listener(persistedSettings),
        )
      }
      throw error
    }
  }

  addSettingsChangeListener(
    listener: (newSettings: SmartComposerSettings) => void,
  ) {
    this.settingsChangeListeners.push(listener)
    return () => {
      this.settingsChangeListeners = this.settingsChangeListeners.filter(
        (l) => l !== listener,
      )
    }
  }

  async openChatView(openNewChat = false) {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView)
    const editor = view?.editor
    if (!view || !editor) {
      this.activateChatView(undefined, openNewChat)
      return
    }
    const selectedBlockData = await getMentionableBlockData(editor, view)
    this.activateChatView(
      {
        selectedBlock: selectedBlockData ?? undefined,
      },
      openNewChat,
    )
  }

  async activateChatView(chatProps?: ChatProps, openNewChat = false) {
    // chatProps is consumed in ChatView.tsx
    this.initialChatProps = chatProps

    const leaf = this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE)[0]

    await (leaf ?? this.app.workspace.getRightLeaf(false))?.setViewState({
      type: CHAT_VIEW_TYPE,
      active: true,
    })

    if (openNewChat && leaf && leaf.view instanceof ChatView) {
      leaf.view.openNewChat(chatProps?.selectedBlock)
    }

    this.app.workspace.revealLeaf(
      this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE)[0],
    )
  }

  async addSelectionToChat(editor: Editor, view: MarkdownView) {
    const data = await getMentionableBlockData(editor, view)
    if (!data) return

    const leaves = this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE)
    if (leaves.length === 0 || !(leaves[0].view instanceof ChatView)) {
      await this.activateChatView({
        selectedBlock: data,
      })
      return
    }

    // bring leaf to foreground (uncollapse sidebar if it's collapsed)
    await this.app.workspace.revealLeaf(leaves[0])

    const chatView = leaves[0].view
    chatView.addSelectionToChat(data)
    chatView.focusMessage()
  }

  async getDbManager(): Promise<DatabaseManager> {
    if (this.dbManager) {
      return this.dbManager
    }

    if (!this.dbManagerInitPromise) {
      this.dbManagerInitPromise = (async () => {
        try {
          const { DatabaseManager } = await import('./database/DatabaseManager')
          this.dbManager = await DatabaseManager.create(this.app)
          return this.dbManager
        } catch (error) {
          this.dbManagerInitPromise = null
          if (error instanceof PGLiteAbortedException) {
            new InstallerUpdateRequiredModal(this.app).open()
          }
          throw error
        }
      })()
    }

    // if initialization is running, wait for it to complete instead of creating a new initialization promise
    return this.dbManagerInitPromise
  }

  async getRAGEngine(): Promise<RAGEngine> {
    if (this.ragEngine) {
      return this.ragEngine
    }

    if (!this.ragEngineInitPromise) {
      this.ragEngineInitPromise = (async () => {
        try {
          const { RAGEngine } = await import('./core/rag/ragEngine')
          const dbManager = await this.getDbManager()
          this.ragEngine = new RAGEngine(
            this.app,
            this.settings,
            dbManager.getVectorManager(),
          )
          return this.ragEngine
        } catch (error) {
          this.ragEngineInitPromise = null
          throw error
        }
      })()
    }

    return this.ragEngineInitPromise
  }

  async getMcpManager(): Promise<McpManager> {
    if (this.mcpManager) {
      return this.mcpManager
    }

    if (!this.mcpManagerInitPromise) {
      this.mcpManagerInitPromise = (async () => {
        const { McpManager } = await import('./core/mcp/mcpManager')
        const manager = new McpManager({
          settings: this.settings,
          registerSettingsListener: (
            listener: (settings: SmartComposerSettings) => void,
          ) => this.addSettingsChangeListener(listener),
        })
        await manager.initialize()
        if (this.unloading) {
          manager.cleanup()
          throw new Error('Smart Composer unloaded during MCP initialization.')
        }
        this.mcpManager = manager
        return manager
      })().catch((error) => {
        this.mcpManagerInitPromise = null
        this.mcpManager = null
        throw error
      })
    }

    return this.mcpManagerInitPromise
  }

  private registerTimeout(callback: () => void, timeout: number): void {
    const timeoutId = setTimeout(callback, timeout)
    this.timeoutIds.push(timeoutId)
  }

  private async migrateToJsonStorage() {
    try {
      const { migrateToJsonDatabaseIfNeeded } = await import(
        './database/json/migrateToJsonDatabase'
      )
      await migrateToJsonDatabaseIfNeeded(
        this.app,
        () => this.getDbManager(),
        async () => {
          await this.reloadChatView()
          console.log('Migration to JSON storage completed successfully')
        },
      )
    } catch (error) {
      console.error('Failed to migrate to JSON storage:', error)
      new Notice(
        'Failed to migrate to JSON storage. Please check the console for details.',
      )
    }
  }

  private async reloadChatView() {
    const leaves = this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE)
    if (leaves.length === 0 || !(leaves[0].view instanceof ChatView)) {
      return
    }
    new Notice('Reloading "smart-composer" due to migration', 1000)
    leaves[0].detach()
    await this.activateChatView()
  }

  private async openInlineEdit(
    editor: Editor,
    view: MarkdownView,
  ): Promise<void> {
    try {
      const controller = await this.getInlineEditController()
      if (!this.unloading) {
        controller.open(editor, view)
      }
    } catch (error) {
      if (this.unloading) return
      console.error('Failed to initialize inline edit:', error)
      new Notice('Smart Composer inline edit could not be initialized.')
    }
  }

  private getInlineEditController(): Promise<InlineEditController> {
    if (this.inlineEditController) {
      return Promise.resolve(this.inlineEditController)
    }
    if (!this.inlineEditControllerInitPromise) {
      this.inlineEditControllerInitPromise = import(
        './core/inline/InlineEditController'
      )
        .then(({ InlineEditController }) => {
          const controller = new InlineEditController(this)
          if (this.unloading) {
            controller.cleanup()
            throw new Error(
              'Smart Composer unloaded during inline edit initialization.',
            )
          }
          this.inlineEditController = controller
          return controller
        })
        .catch((error) => {
          this.inlineEditControllerInitPromise = null
          throw error
        })
    }
    return this.inlineEditControllerInitPromise
  }
}

function markPerformance(name: string): void {
  try {
    globalThis.performance?.mark(name)
  } catch {
    // Performance Timeline instrumentation must never affect plugin behavior.
  }
}

function measurePerformance(
  name: string,
  startMark: string,
  endMark: string,
): void {
  try {
    globalThis.performance?.measure(name, startMark, endMark)
  } catch {
    // Performance Timeline instrumentation must never affect plugin behavior.
  }
}
