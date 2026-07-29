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
import { useMemo, useState } from 'react'

import type {
  NativeRuntimeDiagnostics,
  NativeRuntimeProvider,
} from '../../../core/llm/native/nativeRuntime.types'
import {
  NativeRuntimeService,
  getNativeRuntimeInstallGuide,
} from '../../../core/llm/native/NativeRuntimeService'
import { ReactModal } from '../../common/ReactModal'

type NativeRuntimeInstallModalProps = {
  provider: NativeRuntimeProvider
  title: string
  service: NativeRuntimeService
  onDiagnostics: (diagnostics: NativeRuntimeDiagnostics) => void | Promise<void>
  onClose: () => void
}

type NativeRuntimeInstallModalOptions = Omit<
  NativeRuntimeInstallModalProps,
  'onClose'
>

export class NativeRuntimeInstallModal extends ReactModal<NativeRuntimeInstallModalProps> {
  constructor(app: App, options: NativeRuntimeInstallModalOptions) {
    super({
      app,
      Component: NativeRuntimeInstallModalComponent,
      props: options,
      options: {
        title: `${options.title} 설치 도우미`,
      },
    })
  }
}

function NativeRuntimeInstallModalComponent({
  provider,
  title,
  service,
  onDiagnostics,
  onClose,
}: NativeRuntimeInstallModalProps) {
  const guide = useMemo(
    () => getNativeRuntimeInstallGuide(provider),
    [provider],
  )
  const [copiedCommand, setCopiedCommand] = useState<
    'install' | 'login' | null
  >(null)
  const [isChecking, setIsChecking] = useState(false)
  const [diagnostics, setDiagnostics] =
    useState<NativeRuntimeDiagnostics | null>(null)
  const [statusMessage, setStatusMessage] = useState(
    '아래 1번부터 차례대로 진행하세요.',
  )
  const isWindows = process.platform === 'win32'
  const pasteModifier = process.platform === 'darwin' ? 'Command' : 'Ctrl'

  const copyCommand = async (command: string, kind: 'install' | 'login') => {
    try {
      await navigator.clipboard.writeText(command)
      setCopiedCommand(kind)
      setStatusMessage(
        kind === 'install'
          ? '설치 명령을 복사했습니다. 이제 2번 버튼으로 터미널을 여세요.'
          : '로그인 명령을 복사했습니다.',
      )
      new Notice('명령을 복사했습니다.')
    } catch {
      setStatusMessage(
        '자동 복사에 실패했습니다. 아래 명령 상자를 클릭한 뒤 Ctrl+A, Ctrl+C를 누르세요.',
      )
    }
  }

  const openTerminal = () => {
    try {
      service.openSetupTerminal(guide.shell)
      setStatusMessage(
        `${guide.shellLabel} 창을 열었습니다. 창 안을 한 번 클릭하고 ${pasteModifier}+V, Enter를 차례대로 누르세요.`,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setStatusMessage(`${guide.shellLabel}을 열지 못했습니다: ${message}`)
    }
  }

  const runDiagnostics = async () => {
    if (isChecking) return
    setIsChecking(true)
    setStatusMessage('설치 상태를 확인하고 있습니다...')
    try {
      const result = await service.diagnose(provider)
      setDiagnostics(result)
      await onDiagnostics(result)

      if (result.status === 'not-installed') {
        setStatusMessage(
          '아직 설치 파일을 찾지 못했습니다. 터미널에서 설치가 끝났는지 확인한 뒤 다시 눌러보세요.',
        )
      } else if (result.status === 'ready') {
        setStatusMessage(
          `${title} 설치와 로그인이 모두 확인되었습니다. 이 창을 닫고 바로 사용할 수 있습니다.`,
        )
      } else if (result.status === 'login-required') {
        setStatusMessage(
          '설치는 확인되었습니다. 이제 아래 로그인 단계를 진행하세요.',
        )
      } else {
        setStatusMessage(
          result.error ??
            '설치는 확인했지만 추가 조치가 필요합니다. 아래 로그인 단계를 진행하세요.',
        )
      }
    } catch (error) {
      setStatusMessage(
        `확인 중 오류가 발생했습니다: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    } finally {
      setIsChecking(false)
    }
  }

  const openLogin = () => {
    try {
      service.openLoginTerminal(provider)
      setStatusMessage(loginInstructions(provider))
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error))
    }
  }

  const isInstalled =
    diagnostics !== null && diagnostics.status !== 'not-installed'
  const isReady = diagnostics?.status === 'ready'

  return (
    <div className="smtcmp-runtime-installer">
      <div className="smtcmp-runtime-installer-intro">
        이 도우미는 공식 설치 명령을 직접 보여줍니다. Smart Composer가 다운로드
        파일을 몰래 실행하거나 백신 보호를 끄지 않습니다.
      </div>

      <section className="smtcmp-runtime-install-step">
        <StepHeading number="1" title="설치 명령 복사" />
        <p>아래 버튼을 한 번 누르세요.</p>
        <CommandBox command={guide.command} />
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
      </section>

      <section className="smtcmp-runtime-install-step">
        <StepHeading number="2" title={`${guide.shellLabel} 열기`} />
        <p>
          아래 버튼을 누르면 검은색 또는 파란색 창이 새로 열립니다. 열린 창 안을
          한 번 클릭한 뒤 <kbd>{pasteModifier}</kbd>+<kbd>V</kbd>, 이어서{' '}
          <kbd>Enter</kbd>를 누르세요.
        </p>
        <button onClick={openTerminal}>
          <Terminal size={16} />
          {guide.shellLabel} 열기
        </button>
        <div className="smtcmp-runtime-installer-hint">
          설치 문구가 멈추고 입력 커서가 다시 나타날 때까지 창을 닫지 마세요.
          {isWindows && provider === 'claude' && (
            <>
              {' '}
              <code>winget</code>을 찾을 수 없다는 문구가 나오면 Microsoft
              Store에서 <strong>앱 설치 관리자</strong>를 먼저 업데이트해야
              합니다.
            </>
          )}
        </div>
      </section>

      <section className="smtcmp-runtime-install-step">
        <StepHeading number="3" title="설치 확인" />
        <p>터미널에서 설치가 끝난 뒤 아래 버튼을 누르세요.</p>
        <button
          className={isInstalled ? undefined : 'mod-cta'}
          disabled={isChecking}
          onClick={() => void runDiagnostics()}
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
        className={`smtcmp-runtime-install-step${
          isInstalled ? '' : ' is-disabled'
        }`}
      >
        <StepHeading number="4" title="계정 로그인" />
        <p>{loginDescription(provider)}</p>
        <CommandBox command={guide.loginCommand} compact />
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
            명령 복사
          </button>
          <button
            className={isInstalled && !isReady ? 'mod-cta' : undefined}
            disabled={!isInstalled}
            onClick={openLogin}
          >
            <LogIn size={16} />
            로그인 창 열기
          </button>
        </div>
        <div className="smtcmp-runtime-installer-hint">
          로그인이 끝나면 3번의 <strong>설치 확인</strong>을 다시 눌러 Connected
          상태인지 확인하세요.
        </div>
      </section>

      <div
        className={`smtcmp-runtime-installer-status${
          isReady ? ' is-success' : ''
        }`}
        role="status"
        aria-live="polite"
      >
        {isReady && <Check size={17} />}
        <span>{statusMessage}</span>
      </div>

      {isWindows && (
        <div className="smtcmp-runtime-installer-warning">
          <ShieldAlert size={18} />
          <span>
            Windows 보안 경고가 나오면 보호 기능을 끄거나 폴더를 예외 처리하지
            마세요. 설치를 중단하고 경고에 표시된 파일 경로를 확인해 주세요.
          </span>
        </div>
      )}

      <div className="smtcmp-runtime-installer-footer">
        <button onClick={() => window.open(guide.officialUrl, '_blank')}>
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

function StepHeading({ number, title }: { number: string; title: string }) {
  return (
    <div className="smtcmp-runtime-install-step-heading">
      <span aria-hidden="true">{number}</span>
      <strong>{title}</strong>
    </div>
  )
}

function CommandBox({
  command,
  compact = false,
}: {
  command: string
  compact?: boolean
}) {
  return (
    <pre
      className={`smtcmp-runtime-installer-command${
        compact ? ' is-compact' : ''
      }`}
      tabIndex={0}
    >
      <code>{command}</code>
    </pre>
  )
}

function loginDescription(provider: NativeRuntimeProvider): string {
  return provider === 'claude'
    ? '로그인 창 열기를 누르면 Claude Code가 실행됩니다. 브라우저가 열리면 사용 중인 Claude 계정으로 로그인하고 허용하세요.'
    : '로그인 창 열기를 누르면 Antigravity가 실행됩니다. 화면에서 Google OAuth를 선택하고, 브라우저 로그인 후 안내되는 인증을 완료하세요.'
}

function loginInstructions(provider: NativeRuntimeProvider): string {
  return provider === 'claude'
    ? 'Claude 로그인 창을 열었습니다. 브라우저에서 로그인과 허용을 마친 뒤 설치 확인을 다시 누르세요.'
    : 'Antigravity 로그인 창을 열었습니다. Google OAuth를 선택하고 브라우저 로그인을 마친 뒤 설치 확인을 다시 누르세요.'
}
