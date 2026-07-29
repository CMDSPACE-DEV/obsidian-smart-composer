import { App, PluginSettingTab } from 'obsidian'

import type SmartComposerPlugin from '../main'

import type { SettingTabRenderer } from './SettingTabRenderer'

export class SmartComposerSettingTab extends PluginSettingTab {
  plugin: SmartComposerPlugin
  private renderer: SettingTabRenderer | null = null
  private rendererInitPromise: Promise<SettingTabRenderer> | null = null
  private displayGeneration = 0
  private visible = false

  constructor(app: App, plugin: SmartComposerPlugin) {
    super(app, plugin)
    this.plugin = plugin
  }

  display(): void {
    this.visible = true
    const generation = ++this.displayGeneration
    this.containerEl.empty()
    void this.getRenderer()
      .then((renderer) => {
        if (!this.visible || generation !== this.displayGeneration) return
        renderer.render()
      })
      .catch((error) => {
        console.error('Failed to render Smart Composer settings:', error)
        if (!this.visible || generation !== this.displayGeneration) return
        this.renderLoadFailure(error)
      })
  }

  hide(): void {
    this.visible = false
    this.displayGeneration += 1
    this.renderer?.hide()
  }

  private getRenderer(): Promise<SettingTabRenderer> {
    if (this.renderer) return Promise.resolve(this.renderer)
    if (!this.rendererInitPromise) {
      this.rendererInitPromise = import('./SettingTabRenderer')
        .then(({ createSettingTabRenderer }) => {
          const renderer = createSettingTabRenderer({
            app: this.app,
            containerEl: this.containerEl,
            plugin: this.plugin,
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

  private renderLoadFailure(error: unknown): void {
    this.containerEl.empty()
    const wrapper = this.containerEl.createDiv({
      cls: 'smtcmp-settings-load-error',
    })
    wrapper.createEl('h2', { text: 'Smart Composer settings could not load' })
    wrapper.createEl('p', {
      text: 'Disable and re-enable Smart Composer, then open Settings again. Your saved settings have not been deleted.',
    })
    const details = wrapper.createEl('details')
    details.createEl('summary', { text: 'Technical details' })
    details.createEl('pre', {
      text:
        error instanceof Error ? (error.stack ?? error.message) : String(error),
    })
  }
}
