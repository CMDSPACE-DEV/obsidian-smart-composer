import {
  Check,
  Clipboard,
  ExternalLink,
  LogIn,
  RefreshCw,
  ShieldAlert,
  Terminal,
} from 'lucide-react'
import { App, Notice } from 'obsidian'
import {
  KeyboardEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'

import type {
  NativeRuntimeProvider,
  NativeRuntimeSnapshot,
} from '../../../core/llm/native/nativeRuntime.types'
import {
  NativeRuntimeService,
  getNativeRuntimeInstallGuide,
} from '../../../core/llm/native/NativeRuntimeService'
import { ReactModal } from '../../common/ReactModal'

import {
  NativeRuntimeGuidePlatform,
  NativeRuntimeLoginSteps,
} from './NativeRuntimeLoginSteps'

type NativeRuntimeInstallModalProps = {
  provider: NativeRuntimeProvider
  title: string
  service: NativeRuntimeService
  onDiagnostics: (snapshot: NativeRuntimeSnapshot) => void | Promise<void>
  onClose: () => void
}

type NativeRuntimeInstallModalOptions = Omit<
  NativeRuntimeInstallModalProps,
  'onClose'
>

type AlternativeInstallMethod = {
  id: string
  label: string
  command: string
}

const GUIDE_PLATFORMS: {
  id: NativeRuntimeGuidePlatform
  label: string
}[] = [
  { id: 'win32', label: 'Windows' },
  { id: 'darwin', label: 'macOS' },
]

export class NativeRuntimeInstallModal extends ReactModal<NativeRuntimeInstallModalProps> {
  constructor(app: App, options: NativeRuntimeInstallModalOptions) {
    super({
      app,
      Component: NativeRuntimeInstallModalComponent,
      props: options,
      options: {
        title: `${options.title} 설치 안내`,
      },
    })
  }
}

export function NativeRuntimeInstallModalComponent({
  provider,
  title,
  service,
  onDiagnostics,
  onClose,
}: NativeRuntimeInstallModalProps) {
  const currentPlatform = getCurrentGuidePlatform()
  const [selectedPlatform, setSelectedPlatform] =
    useState<NativeRuntimeGuidePlatform>(currentPlatform ?? 'win32')
  const guide = useMemo(
    () => getNativeRuntimeInstallGuide(provider, selectedPlatform),
    [provider, selectedPlatform],
  )
  const alternatives = useMemo(
    () => getAlternativeInstallMethods(provider, selectedPlatform),
    [provider, selectedPlatform],
  )
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null)
  const [terminalOpened, setTerminalOpened] = useState(false)
  const [isCheckingRequest, setIsCheckingRequest] = useState(false)
  const [snapshot, setSnapshot] = useState(() => service.getSnapshot(provider))
  const [confirmedInstalled, setConfirmedInstalled] = useState(
    snapshot.installation === 'installed',
  )
  const [statusMessage, setStatusMessage] = useState(() =>
    initialStatusMessage(snapshot, title, provider),
  )
  const tabRefs = useRef<
    Partial<Record<NativeRuntimeGuidePlatform, HTMLButtonElement | null>>
  >({})
  const loginStepRef = useRef<HTMLElement | null>(null)
  const wasInstalledRef = useRef(snapshot.installation === 'installed')
  const previousSelectedPlatformRef = useRef(selectedPlatform)
  const idPrefix = useId().replace(/:/g, '')

  const isSelectedCurrentPlatform = currentPlatform === selectedPlatform
  const pasteModifier = selectedPlatform === 'darwin' ? '⌘' : 'Ctrl'
  const copyModifier = selectedPlatform === 'darwin' ? '⌘' : 'Ctrl'
  const isChecking = isCheckingRequest || snapshot.phase === 'checking'
  const isInstalled = isSelectedCurrentPlatform && confirmedInstalled
  const isReady = isInstalled && snapshot.status === 'ready'
  const isPolicyBlocked =
    isInstalled &&
    (snapshot.status === 'billing-blocked' ||
      snapshot.status === 'quota-unverified')
  const isAuthenticatedButBlocked =
    isPolicyBlocked && hasAuthenticatedPolicyBlock(snapshot)

  useEffect(
    () =>
      service.subscribe(provider, (nextSnapshot) => {
        setSnapshot(nextSnapshot)
        if (
          isSelectedCurrentPlatform &&
          nextSnapshot.phase === 'settled' &&
          (nextSnapshot.status === 'ready' ||
            nextSnapshot.status === 'billing-blocked' ||
            nextSnapshot.status === 'quota-unverified')
        ) {
          setStatusMessage(initialStatusMessage(nextSnapshot, title, provider))
        }
      }),
    [isSelectedCurrentPlatform, provider, service, title],
  )

  useEffect(() => {
    if (snapshot.phase === 'idle') {
      setConfirmedInstalled(false)
    } else if (snapshot.phase === 'settled') {
      setConfirmedInstalled(snapshot.installation === 'installed')
    }
  }, [snapshot.installation, snapshot.phase])

  useEffect(() => {
    if (previousSelectedPlatformRef.current === selectedPlatform) return
    previousSelectedPlatformRef.current = selectedPlatform
    setCopiedCommand(null)
    setTerminalOpened(false)
    setStatusMessage(
      isSelectedCurrentPlatform
        ? `${selectedPlatform === 'darwin' ? 'macOS' : 'Windows'} 설치 안내를 선택했습니다.`
        : '다른 컴퓨터용 명령은 복사할 수 있지만, 이 컴퓨터에서는 터미널 열기와 설치 확인을 실행할 수 없습니다.',
    )
  }, [isSelectedCurrentPlatform, selectedPlatform])

  useEffect(() => {
    if (isInstalled && !wasInstalledRef.current) {
      const target = loginStepRef.current
      target?.scrollIntoView({ block: 'nearest' })
      target?.focus({ preventScroll: true })
    }
    wasInstalledRef.current = isInstalled
  }, [isInstalled])

  const copyCommand = async (command: string, commandId: string) => {
    try {
      await navigator.clipboard.writeText(command)
      setCopiedCommand(commandId)
      setStatusMessage(
        commandId === 'login'
          ? '로그인 명령을 복사했습니다.'
          : '설치 명령을 복사했습니다. 이제 2번에서 터미널을 여세요.',
      )
      new Notice('명령을 복사했습니다.')
    } catch {
      setStatusMessage(
        `자동 복사에 실패했습니다. 명령 상자를 선택하고 ${copyModifier}+A, ${copyModifier}+C를 누르세요.`,
      )
    }
  }

  const openTerminal = () => {
    if (!isSelectedCurrentPlatform) return
    try {
      // Deliberately opens an empty terminal. The installer is never executed
      // by Smart Composer; the user pastes and runs the copied command.
      service.openSetupTerminal(guide.shell)
      setTerminalOpened(true)
      setStatusMessage(
        `${guide.shellLabel}을 열었습니다. 창 안을 클릭하고 ${pasteModifier}+V, Enter를 차례로 누르세요.`,
      )
    } catch (error) {
      setStatusMessage(
        `${guide.shellLabel}을 열지 못했습니다: ${toErrorMessage(error)}`,
      )
    }
  }

  const runDiagnostics = async (source: 'install' | 'login') => {
    if (isChecking || !isSelectedCurrentPlatform) return
    setIsCheckingRequest(true)
    setStatusMessage(
      source === 'login'
        ? provider === 'gemini'
          ? 'Antigravity 로그인과 사용 가능한 모델을 확인하고 있습니다...'
          : '로그인 상태와 구독 사용 가능 여부를 확인하고 있습니다...'
        : '이 컴퓨터의 설치 상태를 확인하고 있습니다...',
    )
    try {
      const result = await service.diagnose(provider)
      setSnapshot(result)
      await onDiagnostics(result)

      if (result.status === 'not-installed') {
        setStatusMessage(
          '아직 실행 파일을 찾지 못했습니다. 터미널에서 설치가 끝나 입력 커서가 다시 나타났는지 확인한 뒤 다시 시도하세요.',
        )
      } else if (result.status === 'ready') {
        setStatusMessage(
          provider === 'gemini'
            ? 'Antigravity 설치, 로그인, 사용 가능한 모델을 확인했습니다. 완료를 눌러 Gemini를 사용할 수 있습니다.'
            : `${title} 설치와 안전한 구독 로그인을 모두 확인했습니다. 완료를 눌러 바로 사용할 수 있습니다.`,
        )
      } else if (result.status === 'login-required') {
        setStatusMessage(
          '설치를 확인했습니다. 아래 4번 계정 로그인 단계가 활성화되었습니다.',
        )
      } else if (result.status === 'billing-blocked') {
        setStatusMessage(policyBlockMessage(provider, result))
      } else if (result.status === 'quota-unverified') {
        setStatusMessage(policyBlockMessage(provider, result))
      } else {
        setStatusMessage(
          result.error ??
            result.warning ??
            '설치는 확인했지만 추가 조치가 필요합니다. 아래 로그인 단계를 진행한 뒤 다시 확인하세요.',
        )
      }
    } catch (error) {
      setStatusMessage(`확인 중 오류가 발생했습니다: ${toErrorMessage(error)}`)
    } finally {
      setIsCheckingRequest(false)
    }
  }

  const openLogin = () => {
    if (!isInstalled) return
    try {
      service.openLoginTerminal(provider)
      setStatusMessage(loginInstructions(provider, selectedPlatform))
    } catch (error) {
      setStatusMessage(toErrorMessage(error))
    }
  }

  const selectPlatform = (platform: NativeRuntimeGuidePlatform) => {
    setSelectedPlatform(platform)
  }

  const handleTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    platform: NativeRuntimeGuidePlatform,
  ) => {
    const currentIndex = GUIDE_PLATFORMS.findIndex(
      (item) => item.id === platform,
    )
    let nextIndex: number | null = null
    if (event.key === 'ArrowRight')
      nextIndex = (currentIndex + 1) % GUIDE_PLATFORMS.length
    if (event.key === 'ArrowLeft') {
      nextIndex =
        (currentIndex - 1 + GUIDE_PLATFORMS.length) % GUIDE_PLATFORMS.length
    }
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = GUIDE_PLATFORMS.length - 1
    if (nextIndex === null) return

    event.preventDefault()
    const nextPlatform = GUIDE_PLATFORMS[nextIndex].id
    selectPlatform(nextPlatform)
    tabRefs.current[nextPlatform]?.focus()
  }

  const unavailableDescriptionId = `${idPrefix}-platform-unavailable`

  return (
    <div className="smtcmp-runtime-installer" data-runtime-installer={provider}>
      <div className="smtcmp-runtime-installer-intro">
        이 안내는 공식 설치 명령을 그대로 보여 줍니다. Smart Composer는 설치
        프로그램을 자동 실행하거나 보안 설정을 변경하지 않습니다.
      </div>

      <div
        className="smtcmp-runtime-platform-tabs"
        role="tablist"
        aria-label="설치할 운영체제"
      >
        {GUIDE_PLATFORMS.map((platform) => {
          const isSelected = selectedPlatform === platform.id
          return (
            <button
              key={platform.id}
              ref={(element) => {
                tabRefs.current[platform.id] = element
              }}
              id={`${idPrefix}-${platform.id}-tab`}
              className={isSelected ? 'is-active' : undefined}
              type="button"
              role="tab"
              data-runtime-platform={platform.id}
              aria-selected={isSelected}
              aria-controls={`${idPrefix}-${platform.id}-panel`}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => selectPlatform(platform.id)}
              onKeyDown={(event) => handleTabKeyDown(event, platform.id)}
            >
              {platform.label}
              {currentPlatform === platform.id && (
                <span className="smtcmp-runtime-platform-current">현재</span>
              )}
            </button>
          )
        })}
      </div>

      <div
        id={`${idPrefix}-${selectedPlatform}-panel`}
        role="tabpanel"
        aria-labelledby={`${idPrefix}-${selectedPlatform}-tab`}
      >
        {!isSelectedCurrentPlatform && (
          <div
            id={unavailableDescriptionId}
            className="smtcmp-runtime-platform-notice"
            role="note"
          >
            이 탭은 다른 컴퓨터의 설치 준비용입니다. 명령 복사는 가능하지만 현재
            컴퓨터에서 {guide.shellLabel} 열기와 설치 확인은 실행할 수 없습니다.
          </div>
        )}

        <section
          className={`smtcmp-runtime-install-step${copiedCommand === 'install' ? ' is-complete' : ''}`}
        >
          <StepHeading
            number="1"
            title="설치 명령 복사"
            complete={copiedCommand === 'install'}
            current={!copiedCommand}
          />
          <p>공식 설치 명령을 복사하세요. 버튼은 명령을 실행하지 않습니다.</p>
          <CommandBox command={guide.command} label="공식 설치 명령" />
          <button
            className="mod-cta"
            onClick={() => void copyCommand(guide.command, 'install')}
          >
            {copiedCommand === 'install' ? (
              <Check size={16} />
            ) : (
              <Clipboard size={16} />
            )}
            {copiedCommand === 'install' ? '복사됨' : '설치 명령 복사'}
          </button>

          {alternatives.length > 0 && (
            <details className="smtcmp-runtime-install-alternatives">
              <summary>대체 설치 방법</summary>
              {alternatives.map((method) => (
                <div
                  key={method.id}
                  className="smtcmp-runtime-install-alternative"
                >
                  <strong>{method.label}</strong>
                  <CommandBox
                    command={method.command}
                    label={`${method.label} 명령`}
                    compact
                  />
                  <button
                    onClick={() =>
                      void copyCommand(
                        method.command,
                        `alternative-${method.id}`,
                      )
                    }
                  >
                    {copiedCommand === `alternative-${method.id}` ? (
                      <Check size={16} />
                    ) : (
                      <Clipboard size={16} />
                    )}
                    {copiedCommand === `alternative-${method.id}`
                      ? '복사됨'
                      : '이 명령 복사'}
                  </button>
                </div>
              ))}
            </details>
          )}
        </section>

        <section
          className={`smtcmp-runtime-install-step${terminalOpened ? ' is-complete' : ''}`}
        >
          <StepHeading
            number="2"
            title={`${guide.shellLabel} 열기`}
            complete={terminalOpened}
            current={copiedCommand !== null && !terminalOpened}
          />
          <p>
            빈 {guide.shellLabel} 창을 연 뒤 창 안을 클릭하고{' '}
            <kbd>{pasteModifier}</kbd>+<kbd>V</kbd>, 이어서 <kbd>Enter</kbd>를
            누르세요.
          </p>
          <button
            disabled={!isSelectedCurrentPlatform}
            aria-describedby={
              isSelectedCurrentPlatform ? undefined : unavailableDescriptionId
            }
            onClick={openTerminal}
          >
            <Terminal size={16} />
            {guide.shellLabel} 열기
          </button>
          <div className="smtcmp-runtime-installer-hint">
            설치 완료 문구가 나타나고 입력 커서가 다시 표시될 때까지 창을 닫지
            마세요. 이 화면은 그대로 열어 두어도 됩니다.
          </div>
        </section>

        <section
          className={`smtcmp-runtime-install-step${isInstalled ? ' is-complete' : ''}`}
          aria-busy={isChecking}
        >
          <StepHeading
            number="3"
            title="설치 확인"
            complete={isInstalled}
            current={terminalOpened && !isInstalled}
          />
          <p>
            터미널에서 설치가 끝난 뒤 누르세요. 성공하면 아래 4번이 이 창에서
            바로 활성화됩니다.
          </p>
          <button
            data-runtime-action="check-installation"
            className={isInstalled ? undefined : 'mod-cta'}
            disabled={isChecking || !isSelectedCurrentPlatform}
            aria-describedby={
              isSelectedCurrentPlatform ? undefined : unavailableDescriptionId
            }
            onClick={() => void runDiagnostics('install')}
          >
            {isInstalled ? (
              <Check size={16} />
            ) : (
              <RefreshCw
                size={16}
                className={isChecking ? 'smtcmp-icon-spin' : undefined}
              />
            )}
            {isChecking ? '확인 중' : isInstalled ? '설치 확인됨' : '설치 확인'}
          </button>
        </section>

        <section
          ref={loginStepRef}
          data-runtime-step="login"
          className={`smtcmp-runtime-install-step${isInstalled ? '' : ' is-disabled'}${isReady ? ' is-complete' : ''}`}
          tabIndex={-1}
          aria-disabled={!isInstalled}
          aria-describedby={
            !isInstalled ? `${idPrefix}-login-disabled` : undefined
          }
        >
          <StepHeading
            number="4"
            title="계정 로그인"
            complete={isReady}
            current={isInstalled && !isReady && !isPolicyBlocked}
          />
          {!isInstalled && (
            <p id={`${idPrefix}-login-disabled`}>
              먼저 현재 운영체제 탭에서 3번 설치 확인을 완료하세요.
            </p>
          )}
          <p>{loginDescription(provider)}</p>
          {isPolicyBlocked && (
            <div className="smtcmp-plan-runtime-warning" role="status">
              <strong>
                {isAuthenticatedButBlocked
                  ? '로그인 확인됨'
                  : '요청 정책 확인됨'}
              </strong>
              {' · '}
              요청 차단. 로그인 반복보다 아래에 표시된 차단 사유를 먼저
              해결하세요.
            </div>
          )}
          <NativeRuntimeLoginSteps
            provider={provider}
            platform={selectedPlatform}
          />
          <CommandBox
            command={guide.loginCommand}
            label="공식 로그인 명령"
            compact
          />
          <div className="smtcmp-runtime-installer-actions">
            <button
              disabled={!isInstalled}
              onClick={() => void copyCommand(guide.loginCommand, 'login')}
            >
              {copiedCommand === 'login' ? (
                <Check size={16} />
              ) : (
                <Clipboard size={16} />
              )}
              {copiedCommand === 'login' ? '복사됨' : '로그인 명령 복사'}
            </button>
            <button
              className={
                isInstalled && !isReady && !isPolicyBlocked
                  ? 'mod-cta'
                  : undefined
              }
              disabled={!isInstalled}
              onClick={openLogin}
            >
              <LogIn size={16} />
              {isPolicyBlocked || isReady ? '로그인 관리' : '로그인 창 열기'}
            </button>
            <button
              disabled={!isInstalled || isChecking}
              onClick={() => void runDiagnostics('login')}
            >
              {isPolicyBlocked ? (
                <ShieldAlert size={16} />
              ) : (
                <RefreshCw
                  size={16}
                  className={isChecking ? 'smtcmp-icon-spin' : undefined}
                />
              )}
              {isChecking
                ? '확인 중'
                : isReady
                  ? '연결 확인됨'
                  : isPolicyBlocked
                    ? '차단 해제 확인'
                    : '연결 확인'}
            </button>
          </div>
        </section>
      </div>

      <div
        className={`smtcmp-runtime-installer-status${isReady ? ' is-success' : ''}`}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-busy={isChecking}
      >
        {isReady ? (
          <Check size={17} />
        ) : isPolicyBlocked ? (
          <ShieldAlert size={17} />
        ) : null}
        <span>{statusMessage}</span>
      </div>

      {selectedPlatform === 'win32' && (
        <div className="smtcmp-runtime-installer-warning">
          <ShieldAlert size={18} />
          <span>
            Windows 보안 경고가 나타나면 보호 기능을 끄거나 폴더를 예외 처리하지
            마세요. 설치를 중단하고 표시된 파일 경로와 게시자를 확인하세요.
          </span>
        </div>
      )}

      <div className="smtcmp-runtime-installer-footer">
        <button onClick={() => openOfficialDocumentation(guide.officialUrl)}>
          <ExternalLink size={15} />
          공식 설치 문서
        </button>
        <button className="mod-cta" onClick={onClose}>
          {isReady ? '완료' : '닫기'}
        </button>
      </div>
    </div>
  )
}

function StepHeading({
  number,
  title,
  complete = false,
  current = false,
}: {
  number: string
  title: string
  complete?: boolean
  current?: boolean
}) {
  return (
    <div
      className="smtcmp-runtime-install-step-heading"
      aria-current={current ? 'step' : undefined}
    >
      <span aria-hidden="true">{complete ? <Check size={14} /> : number}</span>
      <strong>{title}</strong>
      {complete && <span className="smtcmp-sr-only">완료</span>}
    </div>
  )
}

function CommandBox({
  command,
  label,
  compact = false,
}: {
  command: string
  label: string
  compact?: boolean
}) {
  return (
    <pre
      className={`smtcmp-runtime-installer-command${compact ? ' is-compact' : ''}`}
      aria-label={label}
      tabIndex={0}
    >
      <code>{command}</code>
    </pre>
  )
}

export function getAlternativeInstallMethods(
  provider: NativeRuntimeProvider,
  platform: NativeRuntimeGuidePlatform,
): AlternativeInstallMethod[] {
  return getNativeRuntimeInstallGuide(provider, platform).alternatives.map(
    (method) => ({
      id: method.label.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      label: method.label,
      command: method.command,
    }),
  )
}

function getCurrentGuidePlatform(): NativeRuntimeGuidePlatform | null {
  if (process.platform === 'win32' || process.platform === 'darwin') {
    return process.platform
  }
  return null
}

function loginDescription(provider: NativeRuntimeProvider): string {
  return provider === 'claude'
    ? '로그인 창 열기를 누르면 공식 Claude Code가 실행됩니다. Claude 구독 계정 연결을 마친 뒤 이 화면에서 연결을 확인하세요.'
    : '로그인 창 열기를 누르면 공식 Antigravity CLI가 실행됩니다. 로컬 브라우저 로그인을 먼저 진행하고, CLI가 요구할 때만 일회용 코드를 터미널에 입력하세요.'
}

function loginInstructions(
  provider: NativeRuntimeProvider,
  platform: NativeRuntimeGuidePlatform,
): string {
  if (provider === 'claude') {
    return 'Claude Code 로그인 창을 열었습니다. 브라우저 로그인을 마친 뒤 이 화면의 연결 확인을 누르세요.'
  }
  const pasteKey = platform === 'darwin' ? '⌘V' : 'Ctrl+V'
  return `Antigravity 로그인 창을 열었습니다. 브라우저 로그인을 먼저 완료하세요. CLI가 직접 코드를 요구할 때만 터미널에 ${pasteKey} 후 Enter를 누르세요.`
}

function initialStatusMessage(
  snapshot: NativeRuntimeSnapshot,
  title: string,
  provider: NativeRuntimeProvider,
): string {
  if (snapshot.status === 'ready') {
    return provider === 'gemini'
      ? 'Antigravity 설치, 로그인, 사용 가능한 모델을 확인했습니다. 지금 Gemini를 사용할 수 있습니다.'
      : `${title} 설치와 안전한 구독 로그인을 확인했습니다.`
  }
  if (
    snapshot.status === 'billing-blocked' ||
    snapshot.status === 'quota-unverified'
  ) {
    return policyBlockMessage(provider, snapshot)
  }
  return '아래 1번부터 차례대로 진행하세요.'
}

function policyBlockMessage(
  provider: NativeRuntimeProvider,
  snapshot: NativeRuntimeSnapshot,
): string {
  const detail = snapshot.error ?? snapshot.warning
  const loginState = hasAuthenticatedPolicyBlock(snapshot)
    ? `${provider === 'claude' ? 'Claude' : 'Antigravity'} 로그인은 확인했습니다. `
    : ''
  const boundary =
    snapshot.status === 'quota-unverified'
      ? '개인 Plan 할당량 출처를 확인할 수 없어 요청을 차단했습니다.'
      : 'API, Cloud 또는 다른 과금 정책이 우선할 수 있어 요청을 차단했습니다.'
  const resolution =
    ' 재로그인만으로 해제되는 상태가 아닙니다. 표시된 과금 경로나 환경 설정을 먼저 확인하세요.'
  return `${loginState}${boundary}${detail ? ` ${detail}` : ''}${resolution}`
}

function hasAuthenticatedPolicyBlock(snapshot: NativeRuntimeSnapshot): boolean {
  if (
    snapshot.status !== 'billing-blocked' &&
    snapshot.status !== 'quota-unverified'
  ) {
    return false
  }
  const evidence = snapshot.authDecision?.evidence ?? []
  if (snapshot.provider === 'gemini') {
    return snapshot.catalog === 'ready' && evidence.length > 0
  }
  return evidence.some(
    (item) =>
      item === 'auth metadata contains a non-subscription billing marker' ||
      item === 'subscription provenance is incomplete or unknown',
  )
}

function openOfficialDocumentation(url: string): void {
  const openedWindow = window.open(url, '_blank', 'noopener,noreferrer')
  if (openedWindow) openedWindow.opener = null
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
