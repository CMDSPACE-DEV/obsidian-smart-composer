import { App } from 'obsidian'
import { useState } from 'react'

import SmartComposerPlugin from '../../main'
import { ObsidianButton } from '../common/ObsidianButton'
import { ObsidianSetting } from '../common/ObsidianSetting'

import { ChatSection } from './sections/ChatSection'
import { EtcSection } from './sections/EtcSection'
import { McpSection } from './sections/McpSection'
import { ModelsSection } from './sections/ModelsSection'
import { PlanConnectionsSection } from './sections/PlanConnectionsSection'
import { ProvidersSection } from './sections/ProvidersSection'
import { RAGSection } from './sections/RAGSection'
import { ResearchSection } from './sections/ResearchSection'
import { TemplateSection } from './sections/TemplateSection'

type SettingsTabRootProps = {
  app: App
  plugin: SmartComposerPlugin
}

export function SettingsTabRoot({ app, plugin }: SettingsTabRootProps) {
  const [activeTab, setActiveTab] = useState<SettingsPage>('plan')

  return (
    <div className="smtcmp-settings-root">
      <nav
        className="smtcmp-settings-tabs"
        role="tablist"
        aria-label="Smart Composer settings"
      >
        {SETTINGS_PAGES.map((page) => (
          <button
            key={page.id}
            type="button"
            role="tab"
            aria-selected={activeTab === page.id}
            className="smtcmp-settings-tab"
            data-active={activeTab === page.id}
            onClick={() => setActiveTab(page.id)}
          >
            {page.label}
          </button>
        ))}
      </nav>

      <div
        className="smtcmp-settings-page"
        role="tabpanel"
        aria-label={SETTINGS_PAGES.find((page) => page.id === activeTab)?.label}
      >
        {activeTab === 'plan' && (
          <>
            <PlanConnectionsSection app={app} plugin={plugin} />
            <ChatSection mode="models" />
          </>
        )}
        {activeTab === 'research' && <ResearchSection plugin={plugin} />}
        {activeTab === 'writing' && (
          <>
            <ChatSection mode="writing" />
            <RAGSection app={app} plugin={plugin} />
            <TemplateSection app={app} />
          </>
        )}
        {activeTab === 'mcp' && <McpSection app={app} plugin={plugin} />}
        {activeTab === 'advanced' && (
          <>
            <ProvidersSection app={app} plugin={plugin} />
            <ModelsSection app={app} plugin={plugin} />
            <EtcSection app={app} plugin={plugin} />
            <ObsidianSetting
              name="Support Smart Composer"
              desc="If you find Smart Composer valuable, consider supporting its development!"
              heading
              className="smtcmp-settings-support-smart-composer"
            >
              <ObsidianButton
                text="Buy Me a Coffee"
                onClick={() =>
                  window.open('https://www.buymeacoffee.com/kevin.on', '_blank')
                }
                cta
              />
            </ObsidianSetting>
          </>
        )}
      </div>
    </div>
  )
}

type SettingsPage = 'plan' | 'research' | 'writing' | 'mcp' | 'advanced'

const SETTINGS_PAGES: { id: SettingsPage; label: string }[] = [
  { id: 'plan', label: 'Plan' },
  { id: 'research', label: 'Research' },
  { id: 'writing', label: 'Writing' },
  { id: 'mcp', label: 'MCP' },
  { id: 'advanced', label: 'Advanced' },
]
