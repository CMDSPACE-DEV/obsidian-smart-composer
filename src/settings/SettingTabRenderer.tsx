import type { App } from 'obsidian'
import { Root, createRoot } from 'react-dom/client'

import { SettingsTabRoot } from '../components/settings/SettingsTabRoot'
import { SettingsProvider } from '../contexts/settings-context'
import type SmartComposerPlugin from '../main'

export type SettingTabRenderer = {
  render(): void
  hide(): void
}

export function createSettingTabRenderer({
  app,
  containerEl,
  plugin,
}: {
  app: App
  containerEl: HTMLElement
  plugin: SmartComposerPlugin
}): SettingTabRenderer {
  let root: Root | null = null

  return {
    render() {
      root ??= createRoot(containerEl)
      root.render(
        <SettingsProvider
          settings={plugin.settings}
          setSettings={(newSettings) => plugin.setSettings(newSettings)}
          addSettingsChangeListener={(listener) =>
            plugin.addSettingsChangeListener(listener)
          }
        >
          <SettingsTabRoot app={app} plugin={plugin} />
        </SettingsProvider>,
      )
    },
    hide() {
      root?.unmount()
      root = null
    },
  }
}
