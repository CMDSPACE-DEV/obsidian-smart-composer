import { Check, LogIn, RefreshCw } from 'lucide-react'
import { App } from 'obsidian'
import { useEffect, useState } from 'react'

import type {
  NativeRuntimeProvider,
  NativeRuntimeSnapshot,
} from '../../../core/llm/native/nativeRuntime.types'
import { NativeRuntimeService } from '../../../core/llm/native/NativeRuntimeService'
import { ReactModal } from '../../common/ReactModal'

import { NativeRuntimeLoginSteps } from './NativeRuntimeLoginSteps'

type NativeRuntimeLoginModalProps = {
  provider: NativeRuntimeProvider
  title: string
  service: NativeRuntimeService
  onDiagnostics: (snapshot: NativeRuntimeSnapshot) => void | Promise<void>
  onClose: () => void
}

type NativeRuntimeLoginModalOptions = Omit<
  NativeRuntimeLoginModalProps,
  'onClose'
>

export class NativeRuntimeLoginModal extends ReactModal<NativeRuntimeLoginModalProps> {
  constructor(app: App, options: NativeRuntimeLoginModalOptions) {
    super({
      app,
      Component: NativeRuntimeLoginModalComponent,
      props: options,
      options: {
        title: `${options.title} 로그인`,
      },
    })
  }
}

export function NativeRuntimeLoginModalComponent({
  provider,
  title,
  service,
  onDiagnostics,
  onClose,
}: NativeRuntimeLoginModalProps) {
  const [isCheckingRequest, setIsCheckingRequest] = useState(false)
  const [snapshot, setSnapshot] = useState(() => service.getSnapshot(provider))
  const [statusMessage, setStatusMessage] = useState(
    '아래 순서대로 진행하세요. 로그인 창은 Smart Composer와 별도로 열립니다.',
  )
  const platform = process.platform === 'darwin' ? 'darwin' : 'win32'
  const isReady = snapshot.status === 'ready'
  const isChecking = isCheckingRequest || snapshot.phase === 'checking'

  useEffect(() => service.subscribe(provider, setSnapshot), [provider, service])

  const openLogin = () => {
    try {
      service.openLoginTerminal(provider)
      setStatusMessage(
        provider === 'claude'
          ? 'Claude Code 로그인 창을 열었습니다. 브라우저 로그인을 마친 뒤 연결 확인을 누르세요.'
          : 'Antigravity 로그인 창을 열었습니다. 브라우저 로그인을 먼저 완료하고, CLI가 직접 요구할 때만 일회용 코드를 터미널에 입력하세요.',
      )
    } catch (error) {
      setStatusMessage(toErrorMessage(error))
    }
  }

  const diagnose = async () => {
    if (isChecking) return
    setIsCheckingRequest(true)
    setStatusMessage(
      '로그인 상태와 안전한 Plan 사용 가능 여부를 확인하고 있습니다...',
    )
    try {
      const result = await service.diagnose(provider)
      setSnapshot(result)
      await onDiagnostics(result)

      if (result.status === 'ready') {
        setStatusMessage(
          `${title} 로그인을 확인했습니다. 완료를 눌러 모델을 사용할 수 있습니다.`,
        )
      } else if (result.status === 'login-required') {
        setStatusMessage(
          provider === 'gemini'
            ? '아직 로그인이 끝나지 않았습니다. 브라우저 로그인을 완료하고, CLI가 직접 코드를 요구한 경우에만 터미널 입력을 마치세요.'
            : '아직 로그인이 끝나지 않았습니다. 브라우저에서 Claude 로그인을 완료하세요.',
        )
      } else if (result.status === 'billing-blocked') {
        setStatusMessage(
          result.error ??
            'API 또는 Cloud 과금 경로가 감지되어 Plan 요청을 차단했습니다.',
        )
      } else if (result.status === 'quota-unverified') {
        setStatusMessage(
          result.warning ??
            '개인 Plan 할당량 사용 여부를 확인할 수 없어 요청을 차단했습니다.',
        )
      } else {
        setStatusMessage(
          result.error ??
            result.warning ??
            '연결을 확인하지 못했습니다. 로그인 창의 마지막 안내를 확인하세요.',
        )
      }
    } catch (error) {
      setStatusMessage(
        `연결 확인 중 오류가 발생했습니다: ${toErrorMessage(error)}`,
      )
    } finally {
      setIsCheckingRequest(false)
    }
  }

  return (
    <div className="smtcmp-runtime-installer">
      <div className="smtcmp-runtime-installer-intro">
        Smart Composer는 로그인 토큰이나 일회용 코드를 저장하지 않습니다. 공식
        CLI 창에서 인증을 마친 뒤 안전한 연결 상태만 확인합니다.
      </div>

      <section className="smtcmp-runtime-install-step">
        <StepHeading number="1" title="로그인 창 열기" current={!isReady} />
        <p>
          아래 버튼을 한 번 누르세요. 이미 열린 로그인 창이 있다면 그 창에서
          계속 진행해도 됩니다.
        </p>
        <button className="mod-cta" onClick={openLogin}>
          <LogIn size={16} />
          로그인 창 열기
        </button>
      </section>

      <section className="smtcmp-runtime-install-step">
        <StepHeading number="2" title="화면 안내 따라가기" />
        <NativeRuntimeLoginSteps provider={provider} platform={platform} />
      </section>

      <section
        className={`smtcmp-runtime-install-step${isReady ? ' is-complete' : ''}`}
        aria-busy={isChecking}
      >
        <StepHeading
          number="3"
          title="연결 확인"
          complete={isReady}
          current={!isReady}
        />
        <p>
          터미널에 로그인 완료 문구가 나타난 뒤 누르세요. 로그인 창을 다시 열
          필요는 없습니다.
        </p>
        <button
          className={isReady ? undefined : 'mod-cta'}
          disabled={isChecking}
          onClick={() => void diagnose()}
        >
          {isReady ? (
            <Check size={16} />
          ) : (
            <RefreshCw
              size={16}
              className={isChecking ? 'smtcmp-icon-spin' : undefined}
            />
          )}
          {isChecking ? '확인 중' : isReady ? '연결 확인됨' : '연결 확인'}
        </button>
      </section>

      <div
        className={`smtcmp-runtime-installer-status${isReady ? ' is-success' : ''}`}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-busy={isChecking}
      >
        {isReady && <Check size={17} />}
        <span>{statusMessage}</span>
      </div>

      <div className="smtcmp-runtime-installer-footer">
        <span />
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

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
