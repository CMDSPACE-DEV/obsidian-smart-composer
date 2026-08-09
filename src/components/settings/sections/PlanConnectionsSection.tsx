import {
  Check,
  CircleAlert,
  CircleMinus,
  Download,
  LogIn,
  RefreshCw,
  ShieldAlert,
  Terminal,
  Wrench,
} from 'lucide-react'
import { App, Notice, Platform } from 'obsidian'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { PROVIDER_TYPES_INFO } from '../../../constants'
import { useSettings } from '../../../contexts/settings-context'
import type {
  NativeRuntimeProvider,
  NativeRuntimeSnapshot,
  NativeRuntimeStatus,
} from '../../../core/llm/native/nativeRuntime.types'
import { NativeRuntimeService } from '../../../core/llm/native/NativeRuntimeService'
import type SmartComposerPlugin from '../../../main'
import type { ChatModel } from '../../../types/chat-model.types'
import type { LLMProvider } from '../../../types/provider.types'
import { ConfirmModal } from '../../modals/ConfirmModal'
import { ConnectOpenAIPlanModal } from '../modals/ConnectOpenAIPlanModal'
import { NativeRuntimeInstallModal } from '../modals/NativeRuntimeInstallModal'
import { NativeRuntimeLoginModal } from '../modals/NativeRuntimeLoginModal'

type PlanConnectionsSectionProps = {
  app: App
  plugin: SmartComposerPlugin
}

const OPENAI_PLAN_PROVIDER_ID = PROVIDER_TYPES_INFO['openai-plan']
  .defaultProviderId as string
const CLAUDE_INSTALL_URL = 'https://code.claude.com/docs/en/installation'
const ANTIGRAVITY_INSTALL_URL = 'https://antigravity.google/docs/cli/install'

export function PlanConnectionsSection({
  app,
  plugin,
}: PlanConnectionsSectionProps) {
  const { settings } = useSettings()
  const runtimeService = useMemo(() => new NativeRuntimeService(), [])
  const settingsUpdateQueue = useRef<Promise<void>>(Promise.resolve())

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
      onConfirm: () => {
        const currentSettings = plugin.settings
        void plugin.setSettings({
          ...currentSettings,
          providers: currentSettings.providers.map((provider) => {
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

  const applyDiagnostics = useCallback(
    (snapshot: NativeRuntimeSnapshot): Promise<void> => {
      settingsUpdateQueue.current = settingsUpdateQueue.current
        .catch(() => undefined)
        .then(async () => {
          if (snapshot.status !== 'ready') return
          const currentSettings = plugin.settings
          const nextModels = syncRuntimeModels(
            currentSettings.chatModels,
            snapshot,
          )
          if (nextModels === currentSettings.chatModels) return
          await plugin.setSettings({
            ...currentSettings,
            chatModels: nextModels,
          })
        })
      return settingsUpdateQueue.current
    },
    [plugin],
  )

  useEffect(() => {
    let mounted = true
    const diagnose = async (provider: NativeRuntimeProvider) => {
      const snapshot = await runtimeService.diagnose(provider)
      if (mounted) await applyDiagnostics(snapshot)
    }

    void Promise.allSettled([diagnose('claude'), diagnose('gemini')])
    return () => {
      mounted = false
    }
  }, [applyDiagnostics, runtimeService])

  return (
    <div className="smtcmp-settings-section">
      <div className="smtcmp-settings-header">Plan runtimes</div>

      <div className="smtcmp-settings-desc">
        Claude와 Gemini 연결은 이 컴퓨터에 설치된 공식 CLI에 인증을 위임합니다.
        Smart Composer는 로그인 토큰을 저장하지 않으며, vault 접근은 Smart
        Composer가 검토한 도구로만 제한됩니다.
        <div className="smtcmp-settings-desc-warning">
          Claude Plan은 개인용 실험 기능입니다. Anthropic은 타사 제품에 API key
          인증 사용을 안내하며, 소비자 Plan 자격 증명 중계를 허용하지 않습니다.{' '}
          <a
            href="https://code.claude.com/docs/en/legal-and-compliance"
            target="_blank"
            rel="noopener noreferrer"
          >
            현재 정책 확인
          </a>
        </div>
        {!Platform.isDesktop && (
          <div className="smtcmp-settings-desc-warning">
            Plan runtime은 데스크톱에서만 사용할 수 있습니다. 기존 대화는
            모바일에서도 읽을 수 있습니다.
          </div>
        )}
      </div>

      <div className="smtcmp-plan-connection-grid">
        <NativeRuntimeCard
          app={app}
          provider="claude"
          title="Claude Plan"
          description="설치된 공식 Claude Code CLI를 직접 사용합니다. 모델 선택은 안정적인 Opus, Sonnet, Haiku alias를 따릅니다."
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
            ChatGPT Plan의 Codex를 사용합니다. 기존 연결과 GPT Plan 이미지
            workflow는 변경되지 않습니다.
            <br />
            <a
              href="https://chatgpt.com/codex/settings/usage"
              target="_blank"
              rel="noopener noreferrer"
            >
              Codex 사용량과 한도 확인
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
          description="설치된 공식 Antigravity CLI를 사용합니다. 로그인 후 모델 목록과 개인 Plan 할당량 출처를 각각 확인합니다."
          service={runtimeService}
          onDiagnostics={applyDiagnostics}
          experimental
        />
      </div>
    </div>
  )
}

export function NativeRuntimeCard({
  app,
  provider,
  title,
  description,
  service,
  onDiagnostics,
  experimental = false,
}: {
  app: App
  provider: NativeRuntimeProvider
  title: string
  description: string
  service: NativeRuntimeService
  onDiagnostics: (snapshot: NativeRuntimeSnapshot) => void | Promise<void>
  experimental?: boolean
}) {
  const snapshot = useNativeRuntimeSnapshot(service, provider)
  const [customPath, setCustomPath] = useState(() =>
    service.getCustomPath(provider),
  )
  const isDiagnosing = snapshot.phase === 'checking'
  const isInstalled = snapshot.installation === 'installed'

  const diagnose = async () => {
    if (isDiagnosing) return
    try {
      const result = await service.diagnose(provider)
      await onDiagnostics(result)
      new Notice(runtimeNotice(title, result.status))
    } catch (error) {
      new Notice(`${title} 진단 실패: ${toErrorMessage(error)}`)
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

  const openUpdateGuide = () => {
    const updateDecision = service.getUpdateDecision(provider)
    if (provider === 'gemini') {
      new ConfirmModal(app, {
        title: 'Antigravity 업데이트 안내',
        message:
          'Antigravity는 공식 문서에서 백그라운드 native updater를 안내합니다. Smart Composer는 문서화되지 않은 `agy update`를 실행하지 않습니다. CLI를 다시 시작해 백그라운드 업데이트를 확인하거나 공식 문서를 열어 복구 방법을 확인하세요.',
        ctaText: '공식 문서 열기',
        onConfirm: () => openExternal(ANTIGRAVITY_INSTALL_URL),
      }).open()
      return
    }

    if (!updateDecision.command) {
      new ConfirmModal(app, {
        title: 'Claude Code 업데이트 방법 확인',
        message: `${updateDecision.reason}\n\n${claudeUpdateHelp(snapshot)}\n\nSmart Composer는 설치 방법이 불명확할 때 임의의 updater를 실행하지 않습니다.`,
        ctaText: '공식 문서 열기',
        onConfirm: () => openExternal(CLAUDE_INSTALL_URL),
      }).open()
      return
    }

    new ConfirmModal(app, {
      title: 'Claude Code 업데이트',
      message: `${updateDecision.command} 명령을 실행하는 보이는 터미널을 엽니다. 완료 후 이 화면에서 다시 진단하세요.`,
      ctaText: '업데이트 터미널 열기',
      onConfirm: () => service.openUpdateTerminal(provider),
    }).open()
  }

  const openLogin = () => {
    new NativeRuntimeLoginModal(app, {
      provider,
      title,
      service,
      onDiagnostics,
    }).open()
  }

  const saveCustomPath = async () => {
    service.setCustomPath(provider, customPath)
    new Notice(
      customPath.trim()
        ? `${title} 실행 파일 경로를 이 컴퓨터에 저장했습니다.`
        : `${title} 실행 파일 경로 override를 지웠습니다.`,
    )
    await diagnose()
  }

  return (
    <div
      className="smtcmp-plan-connection-card"
      data-runtime-provider={provider}
      aria-busy={isDiagnosing}
    >
      <div className="smtcmp-plan-connection-card-header">
        <div className="smtcmp-plan-connection-card-title">
          {title}
          {experimental && (
            <span className="smtcmp-plan-runtime-experimental">
              Experimental
            </span>
          )}
        </div>
        <PlanConnectionStatusBadge status={snapshot.status} />
      </div>

      <div className="smtcmp-plan-connection-card-desc">{description}</div>

      <div className="smtcmp-plan-runtime-meta" aria-live="polite">
        {snapshot.version && <span>Version {snapshot.version}</span>}
        {snapshot.models.length > 0 && (
          <span>{snapshot.models.length} models detected</span>
        )}
        {snapshot.discovery?.candidates.length ? (
          <span>
            {snapshot.discovery.candidates.length} installations found
          </span>
        ) : null}
      </div>

      {snapshot.error && (
        <div
          className="smtcmp-plan-runtime-error"
          role="alert"
          title={snapshot.error}
        >
          {snapshot.error}
        </div>
      )}

      {snapshot.warning && (
        <div
          className="smtcmp-plan-runtime-warning"
          role="status"
          title={snapshot.warning}
        >
          {snapshot.warning}
        </div>
      )}

      {snapshot.models.length > 0 && (
        <details className="smtcmp-plan-runtime-models">
          <summary>Runtime model catalog</summary>
          <div className="smtcmp-plan-runtime-model-list">
            {snapshot.models.map((model) => (
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
          className={snapshot.status === 'ready' ? undefined : 'mod-cta'}
          disabled={isDiagnosing || !Platform.isDesktop}
          onClick={() => void diagnose()}
        >
          <RefreshCw
            size={15}
            className={isDiagnosing ? 'smtcmp-icon-spin' : undefined}
          />
          {isDiagnosing ? 'Checking' : 'Diagnose'}
        </button>

        {snapshot.status === 'not-installed' && (
          <button
            data-runtime-action="install"
            disabled={!Platform.isDesktop}
            onClick={openInstallWizard}
          >
            <Download size={15} />
            설치 안내
          </button>
        )}

        {isInstalled && (
          <button disabled={!Platform.isDesktop} onClick={openLogin}>
            <Terminal size={15} />
            Sign in
          </button>
        )}

        {isInstalled && (
          <button disabled={!Platform.isDesktop} onClick={openUpdateGuide}>
            <Wrench size={15} />
            {provider === 'gemini' || !isSafeClaudeUpdate(snapshot.update)
              ? '업데이트 안내'
              : 'Update'}
          </button>
        )}
      </div>

      <details className="smtcmp-plan-runtime-advanced">
        <summary>Advanced executable path</summary>
        <div className="smtcmp-plan-runtime-path-row">
          <input
            type="text"
            value={customPath}
            aria-label={`${title} 실행 파일 경로`}
            placeholder={
              provider === 'claude'
                ? 'Path to claude executable'
                : 'Path to agy executable'
            }
            onChange={(event) => setCustomPath(event.currentTarget.value)}
          />
          <button onClick={() => void saveCustomPath()}>Apply</button>
        </div>
        {snapshot.executablePath && (
          <div className="smtcmp-plan-runtime-detected-path">
            Detected: <code>{snapshot.executablePath}</code>
          </div>
        )}
        {snapshot.discovery?.ambiguous && (
          <div className="smtcmp-plan-runtime-warning" role="status">
            실행 파일이 여러 개 발견되었습니다. 채팅에 사용할 경로를 직접
            지정하기 전에는 updater를 자동 실행하지 않습니다.
          </div>
        )}
        <div className="smtcmp-plan-runtime-path-help">
          이 override는 동기화되는 vault 설정 밖에서 이 컴퓨터에만 저장됩니다.
        </div>
      </details>
    </div>
  )
}

function useNativeRuntimeSnapshot(
  service: NativeRuntimeService,
  provider: NativeRuntimeProvider,
): NativeRuntimeSnapshot {
  const [snapshot, setSnapshot] = useState(() => service.getSnapshot(provider))
  useEffect(() => service.subscribe(provider, setSnapshot), [provider, service])
  return snapshot
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
    <div
      className={`smtcmp-mcp-server-status-badge ${config.statusClass}`}
      role="status"
      aria-live="polite"
    >
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
    case 'checking':
      return {
        icon: <RefreshCw size={14} className="smtcmp-icon-spin" />,
        label: 'Checking',
        statusClass: 'smtcmp-mcp-server-status-badge--warning',
      }
    case 'ready':
      return {
        icon: <Check size={16} />,
        label: connectedLabel,
        statusClass: 'smtcmp-mcp-server-status-badge--connected',
      }
    case 'billing-blocked':
      return {
        icon: <ShieldAlert size={14} />,
        label: 'Billing blocked',
        statusClass: 'smtcmp-mcp-server-status-badge--error',
      }
    case 'quota-unverified':
      return {
        icon: <ShieldAlert size={14} />,
        label: 'Quota unverified',
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

function syncRuntimeModels(
  chatModels: ChatModel[],
  snapshot: NativeRuntimeSnapshot,
): ChatModel[] {
  const providerType =
    snapshot.provider === 'claude'
      ? ('anthropic-plan' as const)
      : ('gemini-plan' as const)
  const providerId = providerType
  const next = [...chatModels]
  let changed = false

  for (const runtimeModel of snapshot.models) {
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
    changed = true
  }
  return changed ? next : chatModels
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
    case 'checking':
      return `${title} 확인을 시작했습니다.`
    case 'ready':
      return `${title} runtime을 사용할 수 있습니다.`
    case 'login-required':
      return `${title}이 설치되었습니다. 로그인 후 다시 확인하세요.`
    case 'billing-blocked':
      return `${title}에서 API 또는 Cloud 과금 경로가 감지되어 차단했습니다.`
    case 'quota-unverified':
      return `${title}의 개인 Plan 할당량 출처를 확인할 수 없어 차단했습니다.`
    case 'not-installed':
      return `${title} runtime을 찾지 못했습니다.`
    case 'error':
      return `${title} runtime 진단에서 오류를 발견했습니다.`
  }
}

function isSafeClaudeUpdate(update: NativeRuntimeSnapshot['update']): boolean {
  return update === 'native' || update === 'winget' || update === 'homebrew'
}

function claudeUpdateHelp(snapshot: NativeRuntimeSnapshot): string {
  const path = snapshot.executablePath
    ? `선택된 실행 파일: ${snapshot.executablePath}`
    : '선택된 실행 파일 경로가 없습니다.'
  if (snapshot.update === 'ambiguous') {
    return `Claude Code 설치본이 여러 개이거나 package manager 근거가 충돌합니다. ${path}`
  }
  return `Claude Code 설치 방법을 안전하게 판별하지 못했습니다. ${path}`
}

function openExternal(url: string): void {
  const openedWindow = window.open(url, '_blank', 'noopener,noreferrer')
  if (openedWindow) openedWindow.opener = null
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
