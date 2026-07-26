import {
  CheckCircle2,
  ExternalLink,
  KeyRound,
  Link2,
  Loader2,
  TestTube2,
} from 'lucide-react'
import { Notice } from 'obsidian'
import { useEffect, useState } from 'react'

import { useSettings } from '../../../contexts/settings-context'
import type { ResearchManager } from '../../../core/research/ResearchManager'
import {
  RESEARCH_PACKS,
  getResearchSource,
} from '../../../core/research/ResearchSourceRegistry'
import SmartComposerPlugin from '../../../main'
import type {
  ResearchAutoPolicy,
  ResearchConnectionTest,
  ResearchRoutingMode,
  ResearchSourceId,
} from '../../../types/research.types'
import { DEFAULT_RESEARCH_SOURCES } from '../../../types/research.types'
import { ObsidianDropdown } from '../../common/ObsidianDropdown'
import { ObsidianSetting } from '../../common/ObsidianSetting'
import { ObsidianTextInput } from '../../common/ObsidianTextInput'
import { ObsidianToggle } from '../../common/ObsidianToggle'

export function ResearchSection({ plugin }: { plugin: SmartComposerPlugin }) {
  const { settings, setSettings } = useSettings()
  const [manager, setManager] = useState<ResearchManager | null>(null)

  useEffect(() => {
    let active = true
    void plugin.getResearchManager().then((loaded) => {
      if (active) setManager(loaded)
    })
    return () => {
      active = false
    }
  }, [plugin])

  return (
    <div className="smtcmp-settings-section smtcmp-research-section">
      <div className="smtcmp-settings-header">Research connections</div>
      <div className="smtcmp-settings-desc smtcmp-settings-callout">
        Add verified research and official-data sources without editing JSON.
        Native APIs stay separate from MCP connections. Secrets are stored only
        in Obsidian SecretStorage on this device.
      </div>

      <ObsidianSetting
        name="Source routing"
        desc="Auto selects a small relevant set. Explicit uses only @Source mentions. Off disables native research tools."
      >
        <ObsidianDropdown
          value={settings.research.routingMode}
          options={{
            auto: 'Auto + explicit @Source (Recommended)',
            explicit: 'Explicit @Source only',
            off: 'Off',
          }}
          onChange={(value) =>
            void setSettings({
              ...settings,
              research: {
                ...settings.research,
                routingMode: value as ResearchRoutingMode,
              },
            })
          }
        />
      </ObsidianSetting>

      <ObsidianSetting
        name="Maximum Auto sources"
        desc="Limits source fan-out for one chat or inline request. Explicit mentions are not reduced."
      >
        <ObsidianTextInput
          value={settings.research.maxAutoSources.toString()}
          onChange={(value) => {
            const parsed = Number.parseInt(value, 10)
            if (!Number.isFinite(parsed) || parsed < 1 || parsed > 4) return
            void setSettings({
              ...settings,
              research: {
                ...settings.research,
                maxAutoSources: parsed,
              },
            })
          }}
        />
      </ObsidianSetting>

      <div className="smtcmp-research-featured">
        <div>
          <strong>Korean Law MCP</strong>
          <span>
            Featured legal fact-checking connection. The third-party operator
            boundary remains visible.
          </span>
        </div>
        <ResearchSourceCard manager={manager} sourceId="korean-law" />
      </div>

      <div className="smtcmp-research-pack-list">
        {RESEARCH_PACKS.map((pack, index) => (
          <section className="smtcmp-research-pack" key={pack.id}>
            <header>
              <span className="smtcmp-research-pack-index">{index + 1}</span>
              <span>
                <strong>{pack.name}</strong>
                <small>{pack.description}</small>
              </span>
            </header>
            <div className="smtcmp-research-source-list">
              {pack.sourceIds.map((sourceId) => (
                <ResearchSourceCard
                  key={sourceId}
                  manager={manager}
                  sourceId={sourceId}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

function ResearchSourceCard({
  manager,
  sourceId,
}: {
  manager: ResearchManager | null
  sourceId: ResearchSourceId
}) {
  const { settings, setSettings } = useSettings()
  const definition = getResearchSource(sourceId)
  const sourceSettings =
    settings.research.sources[sourceId] ?? DEFAULT_RESEARCH_SOURCES[sourceId]
  const [expanded, setExpanded] = useState(false)
  const [secretDrafts, setSecretDrafts] = useState<Record<string, string>>({})
  const [optionDrafts, setOptionDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<'save' | 'test' | 'install' | null>(null)
  const [testResult, setTestResult] = useState<ResearchConnectionTest | null>(
    null,
  )

  const storedSecrets = Object.fromEntries(
    definition.secretFields.map((field) => [
      field.id,
      manager?.getSecretStore().has(sourceId, field.id) ?? false,
    ]),
  )

  useEffect(() => {
    setOptionDrafts(
      Object.fromEntries(
        definition.optionFields.map((field) => [
          field.id,
          readSettingOption(
            sourceSettings.options[field.id],
            field.defaultValue ?? '',
          ),
        ]),
      ),
    )
  }, [definition.optionFields, sourceSettings.options])

  const updateSource = async (
    patch: Partial<typeof sourceSettings>,
  ): Promise<void> => {
    await setSettings({
      ...settings,
      research: {
        ...settings.research,
        sources: {
          ...settings.research.sources,
          [sourceId]: { ...sourceSettings, ...patch },
        },
      },
    })
  }

  const persistDrafts = async (
    patch: Partial<typeof sourceSettings> = {},
  ): Promise<void> => {
    if (!manager) return
    for (const [fieldId, value] of Object.entries(secretDrafts)) {
      if (value.trim()) {
        manager.getSecretStore().set(sourceId, fieldId, value.trim())
      }
    }
    await updateSource({
      ...patch,
      options: {
        ...sourceSettings.options,
        ...Object.fromEntries(
          Object.entries(optionDrafts).map(([key, value]) => [
            key,
            value.trim(),
          ]),
        ),
      },
    })
    setSecretDrafts({})
  }

  const save = async () => {
    if (!manager) return
    setBusy('save')
    try {
      await persistDrafts()
      new Notice(`${definition.name} settings saved.`)
    } catch (error) {
      new Notice(toErrorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  const test = async () => {
    if (!manager) return
    setBusy('test')
    try {
      await persistDrafts()
      const result = await manager.testConnection(sourceId)
      setTestResult(result)
      new Notice(result.message)
    } catch (error) {
      new Notice(toErrorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  const installPreset = async () => {
    if (!manager) return
    setBusy('install')
    try {
      await persistDrafts({ enabled: true })
      await manager.installMcpPreset(sourceId)
      new Notice(
        `${definition.name} added. Open the MCP tab to connect, scan, and review its tools.`,
      )
    } catch (error) {
      new Notice(toErrorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  const installed =
    definition.mcpPreset && manager?.isMcpPresetInstalled(sourceId)

  return (
    <article
      className="smtcmp-research-source"
      data-enabled={sourceSettings.enabled}
    >
      <div className="smtcmp-research-source-summary">
        <button
          type="button"
          className="smtcmp-research-source-main"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
        >
          <span className="smtcmp-research-source-title">
            <strong>{definition.shortName}</strong>
            <small>
              {definition.protocol === 'mcp' ? 'MCP' : 'Native API'} ·{' '}
              {definition.role}
            </small>
          </span>
          <span className="smtcmp-research-source-description">
            {definition.description}
          </span>
        </button>
        <ObsidianToggle
          value={sourceSettings.enabled}
          onChange={(enabled) => void updateSource({ enabled })}
        />
      </div>

      {expanded && (
        <div className="smtcmp-research-source-details">
          <div className="smtcmp-research-source-meta">
            <span>{definition.operator}</span>
            <span>{definition.freeBoundary}</span>
            <a
              href={definition.docsUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Documentation <ExternalLink size={13} aria-hidden="true" />
            </a>
          </div>

          <label className="smtcmp-research-field">
            <span>Auto routing</span>
            <select
              value={sourceSettings.autoPolicy}
              onChange={(event) =>
                void updateSource({
                  autoPolicy: event.target.value as ResearchAutoPolicy,
                })
              }
            >
              <option value="allow">Allow in Auto</option>
              <option value="explicit-only">Explicit @Source only</option>
              <option value="off">Off</option>
            </select>
          </label>

          {definition.secretFields.map((field) => (
            <label className="smtcmp-research-field" key={field.id}>
              <span>
                <KeyRound size={13} aria-hidden="true" /> {field.label}
                {field.required ? ' *' : ''}
              </span>
              <input
                type="password"
                value={secretDrafts[field.id] ?? ''}
                placeholder={
                  storedSecrets[field.id]
                    ? 'Stored in SecretStorage'
                    : (field.placeholder ?? 'Enter credential')
                }
                onChange={(event) =>
                  setSecretDrafts((current) => ({
                    ...current,
                    [field.id]: event.target.value,
                  }))
                }
                autoComplete="new-password"
              />
            </label>
          ))}

          {definition.optionFields.map((field) => (
            <label className="smtcmp-research-field" key={field.id}>
              <span>
                {field.label}
                {field.required ? ' *' : ''}
              </span>
              <input
                type="text"
                value={optionDrafts[field.id] ?? ''}
                placeholder={field.placeholder}
                onChange={(event) =>
                  setOptionDrafts((current) => ({
                    ...current,
                    [field.id]: event.target.value,
                  }))
                }
              />
            </label>
          ))}

          <div className="smtcmp-research-source-actions">
            <button
              type="button"
              onClick={() => void save()}
              disabled={!manager || busy !== null}
            >
              {busy === 'save' ? (
                <Loader2 className="smtcmp-spin" size={14} />
              ) : (
                <KeyRound size={14} />
              )}
              Save
            </button>
            {definition.protocol === 'native' ? (
              <button
                type="button"
                onClick={() => void test()}
                disabled={!manager || !sourceSettings.enabled || busy !== null}
                title="Runs one live provider request and may consume quota"
              >
                {busy === 'test' ? (
                  <Loader2 className="smtcmp-spin" size={14} />
                ) : (
                  <TestTube2 size={14} />
                )}
                Test connection
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void installPreset()}
                disabled={!manager || busy !== null}
              >
                {busy === 'install' ? (
                  <Loader2 className="smtcmp-spin" size={14} />
                ) : installed ? (
                  <CheckCircle2 size={14} />
                ) : (
                  <Link2 size={14} />
                )}
                {installed ? 'Update MCP preset' : 'Install MCP preset'}
              </button>
            )}
          </div>

          {testResult && (
            <div
              className="smtcmp-research-test-result"
              data-ok={testResult.ok}
            >
              {testResult.message}
            </div>
          )}
        </div>
      )}
    </article>
  )
}

function readSettingOption(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
