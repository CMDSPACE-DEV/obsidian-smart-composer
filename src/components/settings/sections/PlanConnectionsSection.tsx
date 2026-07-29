import {
  Check,
  CircleAlert,
  CircleMinus,
  Download,
  LogIn,
  RefreshCw,
  Terminal,
  Wrench,
} from 'lucide-react'
import { App, Notice, Platform } from 'obsidian'
import { useMemo, useState } from 'react'

import { PROVIDER_TYPES_INFO } from '../../../constants'
import { useSettings } from '../../../contexts/settings-context'
import {
  NativeRuntimeDiagnostics,
  NativeRuntimeProvider,
  NativeRuntimeStatus,
} from '../../../core/llm/native/nativeRuntime.types'
import { NativeRuntimeService } from '../../../core/llm/native/NativeRuntimeService'
import SmartComposerPlugin from '../../../main'
import { SmartComposerSettings } from '../../../settings/schema/setting.types'
import { ChatModel } from '../../../types/chat-model.types'
import { LLMProvider } from '../../../types/provider.types'
import { ConfirmModal } from '../../modals/ConfirmModal'
import { ConnectOpenAIPlanModal } from '../modals/ConnectOpenAIPlanModal'
import { NativeRuntimeInstallModal } from '../modals/NativeRuntimeInstallModal'

type PlanConnectionsSectionProps = {
  app: App
  plugin: SmartComposerPlugin
}

const OPENAI_PLAN_PROVIDER_ID = PROVIDER_TYPES_INFO['openai-plan']
  .defaultProviderId as string

export function PlanConnectionsSection({
  app,
  plugin,
}: PlanConnectionsSectionProps) {
  const { settings, setSettings } = useSettings()
  const runtimeService = useMemo(() => new NativeRuntimeService(), [])

  const openAIPlanProvider = settings.providers.find(
    (provider): provider is Extract<LLMProvider, { type: 'openai-plan' }> =>
      provider.id === OPENAI_PLAN_PROVIDER_ID &&
      provider.type === 'openai-plan',
  )
  const isOpenAIConnected = !!openAIPlanProvider?.oauth?.accessToken

  const disconnectOpenAI = () => {
    new ConfirmModal(app, {
      title: 'Disconnect subscription',
      message: 'Disconnect OpenAI from Smart Composer?',
      ctaText: 'Disconnect',
      onConfirm: async () => {
        await setSettings({
          ...settings,
          providers: settings.providers.map((provider) => {
            if (
              provider.id !== OPENAI_PLAN_PROVIDER_ID ||
              provider.type !== 'openai-plan'
            ) {
              return provider
            }
            return { ...provider, oauth: undefined }
          }),
        })
      },
    }).open()
  }

  const applyDiagnostics = async (diagnostics: NativeRuntimeDiagnostics) => {
    const nextSettings = mergeRuntimeDiagnostics(settings, diagnostics)
    await setSettings(nextSettings)
  }

  return (
    <div className="smtcmp-settings-section">
      <div className="smtcmp-settings-header">Plan runtimes</div>

      <div className="smtcmp-settings-desc">
        Claude and Gemini connections delegate authentication to locally
        installed desktop runtimes. Smart Composer never stores their login
        tokens, and vault access remains restricted to Smart Composer&apos;s
        reviewed tools.
        <div className="smtcmp-settings-desc-warning">
          Claude Plan is an experimental personal-use connection. Anthropic
          currently directs third-party products to API-key authentication and
          does not permit routing consumer Plan credentials on behalf of users.{' '}
          <a
            href="https://code.claude.com/docs/en/legal-and-compliance"
            target="_blank"
            rel="noopener noreferrer"
          >
            Review Anthropic&apos;s current policy
          </a>
          .
        </div>
        {!Platform.isDesktop && (
          <div className="smtcmp-settings-desc-warning">
            Plan runtimes are available on desktop only. Existing conversations
            remain readable on mobile.
          </div>
        )}
      </div>

      <div className="smtcmp-plan-connection-grid">
        <NativeRuntimeCard
          app={app}
          provider="claude"
          title="Claude Plan"
          description="Official Claude Code runtime with Agent SDK isolation. Uses stable Opus, Sonnet, and Haiku aliases."
          state={settings.nativeRuntimes.claude}
          service={runtimeService}
          onDiagnostics={applyDiagnostics}
          experimental
        />

        <div className="smtcmp-plan-connection-card">
          <div className="smtcmp-plan-connection-card-header">
            <div className="smtcmp-plan-connection-card-title">OpenAI Plan</div>
            <PlanConnectionStatusBadge
              status={isOpenAIConnected ? 'ready' : 'login-required'}
              connectedLabel="Connected"
              disconnectedLabel="Disconnected"
            />
          </div>

          <div className="smtcmp-plan-connection-card-desc">
            Uses Codex from your ChatGPT plan. This existing connection and GPT
            Plan image workflow are unchanged.
            <br />
            <a
              href="https://chatgpt.com/codex/settings/usage"
              target="_blank"
              rel="noopener noreferrer"
            >
              Check Codex usage and limits
            </a>
          </div>

          <div className="smtcmp-plan-connection-card-actions">
            {!isOpenAIConnected ? (
              <button
                className="mod-cta"
                onClick={() => new ConnectOpenAIPlanModal(app, plugin).open()}
              >
                <LogIn size={15} />
                Connect
              </button>
            ) : (
              <button onClick={disconnectOpenAI}>Disconnect</button>
            )}
          </div>
        </div>

        <NativeRuntimeCard
          app={app}
          provider="gemini"
          title="Gemini Plan"
          description="Official Antigravity CLI runtime. Available models are read from `agy models` after Google sign-in."
          state={settings.nativeRuntimes.gemini}
          service={runtimeService}
          onDiagnostics={applyDiagnostics}
          experimental
        />
      </div>
    </div>
  )
}

type PersistedRuntimeState =
  SmartComposerSettings['nativeRuntimes'][NativeRuntimeProvider]

function NativeRuntimeCard({
  app,
  provider,
  title,
  description,
  state,
  service,
  onDiagnostics,
  experimental = false,
}: {
  app: App
  provider: NativeRuntimeProvider
  title: string
  description: string
  state: PersistedRuntimeState
  service: NativeRuntimeService
  onDiagnostics: (diagnostics: NativeRuntimeDiagnostics) => void | Promise<void>
  experimental?: boolean
}) {
  const [isDiagnosing, setIsDiagnosing] = useState(false)
  const [customPath, setCustomPath] = useState(() =>
    service.getCustomPath(provider),
  )
  const [detectedPath, setDetectedPath] = useState('')

  const diagnose = async () => {
    if (isDiagnosing) return
    setIsDiagnosing(true)
    try {
      const diagnostics = await service.diagnose(provider)
      setDetectedPath(diagnostics.executablePath ?? '')
      await onDiagnostics(diagnostics)
      new Notice(runtimeNotice(title, diagnostics.status))
    } catch (error) {
      new Notice(
        `${title} diagnostics failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    } finally {
      setIsDiagnosing(false)
    }
  }

  const openInstallWizard = () => {
    new NativeRuntimeInstallModal(app, {
      provider,
      title,
      service,
      onDiagnostics,
    }).open()
  }

  const confirmUpdate = () => {
    new ConfirmModal(app, {
      title: `Update ${title} runtime`,
      message:
        'A visible terminal will open and run the official runtime updater. Return here and click Diagnose when it finishes.',
      ctaText: 'Open updater',
      onConfirm: () => service.openUpdateTerminal(provider),
    }).open()
  }

  const openLogin = () => {
    try {
      service.openLoginTerminal(provider)
      new Notice(
        `Complete ${title} sign-in in the terminal, then click Diagnose.`,
      )
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error))
    }
  }

  const saveCustomPath = async () => {
    service.setCustomPath(provider, customPath)
    new Notice(
      customPath.trim()
        ? `${title} executable path saved on this device.`
        : `${title} executable override cleared.`,
    )
    await diagnose()
  }

  return (
    <div className="smtcmp-plan-connection-card">
      <div className="smtcmp-plan-connection-card-header">
        <div className="smtcmp-plan-connection-card-title">
          {title}
          {experimental && (
            <span className="smtcmp-plan-runtime-experimental">
              Experimental
            </span>
          )}
        </div>
        <PlanConnectionStatusBadge status={state.status} />
      </div>

      <div className="smtcmp-plan-connection-card-desc">{description}</div>

      <div className="smtcmp-plan-runtime-meta">
        {state.version && <span>Version {state.version}</span>}
        {state.models.length > 0 && (
          <span>{state.models.length} models detected</span>
        )}
      </div>

      {state.error && (
        <div
          className="smtcmp-plan-runtime-error"
          role="status"
          title={state.error}
        >
          {state.error}
        </div>
      )}

      {state.models.length > 0 && (
        <details className="smtcmp-plan-runtime-models">
          <summary>Runtime model catalog</summary>
          <div className="smtcmp-plan-runtime-model-list">
            {state.models.map((model) => (
              <div key={model.id}>
                <code>{model.id}</code>
                <span>{model.label}</span>
                {model.description && <small>{model.description}</small>}
              </div>
            ))}
          </div>
        </details>
      )}

      <div className="smtcmp-plan-connection-card-actions">
        <button
          className={state.status === 'ready' ? undefined : 'mod-cta'}
          disabled={isDiagnosing || !Platform.isDesktop}
          onClick={() => void diagnose()}
        >
          <RefreshCw
            size={15}
            className={isDiagnosing ? 'smtcmp-icon-spin' : undefined}
          />
          {isDiagnosing ? 'Checking' : 'Diagnose'}
        </button>

        {state.status === 'not-installed' && (
          <button disabled={!Platform.isDesktop} onClick={openInstallWizard}>
            <Download size={15} />
            설치 안내
          </button>
        )}

        {state.status !== 'not-installed' && (
          <button disabled={!Platform.isDesktop} onClick={openLogin}>
            <Terminal size={15} />
            Sign in
          </button>
        )}

        {state.status !== 'not-installed' && (
          <button disabled={!Platform.isDesktop} onClick={confirmUpdate}>
            <Wrench size={15} />
            Update
          </button>
        )}
      </div>

      <details className="smtcmp-plan-runtime-advanced">
        <summary>Advanced executable path</summary>
        <div className="smtcmp-plan-runtime-path-row">
          <input
            type="text"
            value={customPath}
            placeholder={
              provider === 'claude'
                ? 'Path to claude executable'
                : 'Path to agy executable'
            }
            onChange={(event) => setCustomPath(event.currentTarget.value)}
          />
          <button onClick={() => void saveCustomPath()}>Apply</button>
        </div>
        {detectedPath && (
          <div className="smtcmp-plan-runtime-detected-path">
            Detected: <code>{detectedPath}</code>
          </div>
        )}
        <div className="smtcmp-plan-runtime-path-help">
          This override is stored only on this computer, outside the synced
          vault settings.
        </div>
      </details>
    </div>
  )
}

function PlanConnectionStatusBadge({
  status,
  connectedLabel,
  disconnectedLabel,
}: {
  status: NativeRuntimeStatus
  connectedLabel?: string
  disconnectedLabel?: string
}) {
  const config = statusConfig(status, connectedLabel, disconnectedLabel)

  return (
    <div className={`smtcmp-mcp-server-status-badge ${config.statusClass}`}>
      {config.icon}
      <div className="smtcmp-mcp-server-status-badge-label">{config.label}</div>
    </div>
  )
}

function statusConfig(
  status: NativeRuntimeStatus,
  connectedLabel = 'Ready',
  disconnectedLabel = 'Login required',
) {
  switch (status) {
    case 'ready':
      return {
        icon: <Check size={16} />,
        label: connectedLabel,
        statusClass: 'smtcmp-mcp-server-status-badge--connected',
      }
    case 'update-available':
      return {
        icon: <Download size={14} />,
        label: 'Update available',
        statusClass: 'smtcmp-mcp-server-status-badge--warning',
      }
    case 'error':
      return {
        icon: <CircleAlert size={14} />,
        label: 'Runtime error',
        statusClass: 'smtcmp-mcp-server-status-badge--error',
      }
    case 'not-installed':
      return {
        icon: <CircleMinus size={14} />,
        label: 'Not installed',
        statusClass: 'smtcmp-mcp-server-status-badge--disconnected',
      }
    case 'login-required':
      return {
        icon: <LogIn size={14} />,
        label: disconnectedLabel,
        statusClass: 'smtcmp-mcp-server-status-badge--disconnected',
      }
  }
}

function mergeRuntimeDiagnostics(
  settings: SmartComposerSettings,
  diagnostics: NativeRuntimeDiagnostics,
): SmartComposerSettings {
  const runtimeState: PersistedRuntimeState = {
    status: diagnostics.status,
    version: diagnostics.version,
    models: diagnostics.models,
    error: diagnostics.error,
    lastCheckedAt: Date.now(),
  }

  return {
    ...settings,
    nativeRuntimes: {
      ...settings.nativeRuntimes,
      [diagnostics.provider]: runtimeState,
    },
    chatModels:
      diagnostics.status === 'ready'
        ? syncRuntimeModels(settings.chatModels, diagnostics)
        : settings.chatModels,
  }
}

function syncRuntimeModels(
  chatModels: ChatModel[],
  diagnostics: NativeRuntimeDiagnostics,
): ChatModel[] {
  const providerType =
    diagnostics.provider === 'claude'
      ? ('anthropic-plan' as const)
      : ('gemini-plan' as const)
  const providerId = providerType
  const next = [...chatModels]

  for (const runtimeModel of diagnostics.models) {
    const existingIndex = next.findIndex(
      (model) =>
        model.providerType === providerType && model.model === runtimeModel.id,
    )
    if (existingIndex !== -1) continue

    const stableAlias = runtimeModel.id.toLowerCase()
    if (
      providerType === 'anthropic-plan' &&
      ['default', 'opus', 'sonnet', 'haiku'].includes(stableAlias)
    ) {
      continue
    }

    const id = uniqueModelId(
      next,
      `${runtimeModel.label || runtimeModel.id} (plan)`,
    )
    next.push({
      providerType,
      providerId,
      id,
      model: runtimeModel.id,
      enable: true,
    })
  }
  return next
}

function uniqueModelId(models: ChatModel[], candidate: string): string {
  if (!models.some((model) => model.id === candidate)) return candidate
  let suffix = 2
  while (models.some((model) => model.id === `${candidate} ${suffix}`)) {
    suffix += 1
  }
  return `${candidate} ${suffix}`
}

function runtimeNotice(title: string, status: NativeRuntimeStatus): string {
  switch (status) {
    case 'ready':
      return `${title} runtime is ready.`
    case 'login-required':
      return `${title} is installed. Sign in, then diagnose again.`
    case 'not-installed':
      return `${title} runtime was not found.`
    case 'update-available':
      return `${title} has an update available.`
    case 'error':
      return `${title} runtime diagnostics found an error.`
  }
}
