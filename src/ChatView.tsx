import { ItemView, WorkspaceLeaf } from 'obsidian'

import type { ChatViewRenderer } from './ChatViewRenderer'
import type { ChatProps } from './components/chat-view/Chat'
import { CHAT_VIEW_TYPE } from './constants'
import type SmartComposerPlugin from './main'
import type { MentionableBlockData } from './types/mentionable'
import { prepareChatMountSurface } from './utils/chat/chatMountSurface'

export class ChatView extends ItemView {
  private initialChatProps?: ChatProps
  private mountEl: HTMLDivElement | null = null
  private renderer: ChatViewRenderer | null = null
  private rendererInitPromise: Promise<ChatViewRenderer> | null = null
  private pendingActions: ((renderer: ChatViewRenderer) => void)[] = []
  private closed = false

  constructor(
    leaf: WorkspaceLeaf,
    private plugin: SmartComposerPlugin,
  ) {
    super(leaf)
    this.initialChatProps = plugin.initialChatProps
  }

  getViewType() {
    return CHAT_VIEW_TYPE
  }

  getIcon() {
    return 'wand-sparkles'
  }

  getDisplayText() {
    return 'Smart composer chat'
  }

  async onOpen() {
    this.closed = false
    markPerformance('smart-composer:chat-open:start')
    await this.render()
    this.initialChatProps = undefined
  }

  async onClose() {
    this.closed = true
    this.renderer?.close()
    this.renderer = null
    this.rendererInitPromise = null
    this.pendingActions = []
    this.mountEl = null
  }

  async render() {
    const mountEl = this.ensureMountSurface()
    const renderer = await this.getRenderer(mountEl)
    if (this.closed) {
      renderer.close()
      return
    }
    renderer.render(this.initialChatProps)
    for (const action of this.pendingActions.splice(0)) {
      action(renderer)
    }
  }

  openNewChat(selectedBlock?: MentionableBlockData) {
    this.runOrQueue((renderer) => renderer.openNewChat(selectedBlock))
  }

  addSelectionToChat(selectedBlock: MentionableBlockData) {
    this.runOrQueue((renderer) => renderer.addSelectionToChat(selectedBlock))
  }

  focusMessage() {
    this.runOrQueue((renderer) => renderer.focusMessage())
  }

  private ensureMountSurface(): HTMLDivElement {
    if (this.mountEl) return this.mountEl
    const host = this.containerEl.children[1] as HTMLElement
    this.mountEl = prepareChatMountSurface(host)
    const applyTheme = () => {
      this.mountEl?.setAttribute(
        'data-skin',
        host.ownerDocument.body.classList.contains('theme-dark')
          ? 'cmds-dark'
          : 'hallym-light',
      )
    }
    applyTheme()
    this.registerEvent(this.app.workspace.on('css-change', applyTheme))
    return this.mountEl
  }

  private getRenderer(mountEl: HTMLDivElement): Promise<ChatViewRenderer> {
    if (this.renderer) return Promise.resolve(this.renderer)
    if (!this.rendererInitPromise) {
      this.rendererInitPromise = import('./ChatViewRenderer')
        .then(({ createChatViewRenderer }) => {
          const renderer = createChatViewRenderer({
            app: this.app,
            chatView: this,
            mountEl,
            plugin: this.plugin,
            onInputReady: () => {
              markPerformance('smart-composer:chat-input-ready')
              measurePerformance(
                'smart-composer:chat-input-ready-duration',
                'smart-composer:chat-open:start',
                'smart-composer:chat-input-ready',
              )
            },
          })
          this.renderer = renderer
          return renderer
        })
        .catch((error) => {
          this.rendererInitPromise = null
          throw error
        })
    }
    return this.rendererInitPromise
  }

  private runOrQueue(action: (renderer: ChatViewRenderer) => void): void {
    if (this.renderer) {
      action(this.renderer)
      return
    }
    this.pendingActions.push(action)
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
