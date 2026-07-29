import { Check, LogIn, RefreshCw } from 'lucide-react'
import { App } from 'obsidian'
import { useState } from 'react'

import type {
  NativeRuntimeDiagnostics,
  NativeRuntimeProvider,
} from '../../../core/llm/native/nativeRuntime.types'
import { NativeRuntimeService } from '../../../core/llm/native/NativeRuntimeService'
import { ReactModal } from '../../common/ReactModal'

import { NativeRuntimeLoginSteps } from './NativeRuntimeLoginSteps'

type NativeRuntimeLoginModalProps = {
  provider: NativeRuntimeProvider
  title: string
  service: NativeRuntimeService
  onDiagnostics: (diagnostics: NativeRuntimeDiagnostics) => void | Promise<void>
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

function NativeRuntimeLoginModalComponent({
  provider,
  title,
  service,
  onDiagnostics,
  onClose,
}: NativeRuntimeLoginModalProps) {
  const [isChecking, setIsChecking] = useState(false)
  const [isReady, setIsReady] = useState(false)
  const [statusMessage, setStatusMessage] = useState(
    '아래 순서대로 진행하세요. 로그인 창은 Smart Composer와 별도로 열립니다.',
  )

  const openLogin = () => {
    try {
      service.openLoginTerminal(provider)
      setStatusMessage(
        provider === 'claude'
          ? 'Claude Code 로그인 창을 열었습니다. 브라우저 로그인을 마친 뒤 연결 확인을 누르세요.'
          : 'Antigravity 로그인 창을 열었습니다. 1번 Google OAuth를 선택하고 브라우저 코드를 터미널에 붙여넣으세요.',
      )
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error))
    }
  }

  const diagnose = async () => {
    if (isChecking) return
    setIsChecking(true)
    setStatusMessage('로그인 상태와 사용 가능한 모델을 확인하고 있습니다...')
    try {
      const diagnostics = await service.diagnose(provider)
      await onDiagnostics(diagnostics)
      setIsReady(diagnostics.status === 'ready')
      if (diagnostics.status === 'ready') {
        setStatusMessage(
          `${title} 로그인이 확인되었습니다. 이 창을 닫고 모델을 사용할 수 있습니다.`,
        )
      } else if (diagnostics.status === 'login-required') {
        setStatusMessage(
          provider === 'gemini'
            ? '아직 로그인이 끝나지 않았습니다. 브라우저의 일회용 코드를 터미널에 붙여넣고 Enter를 누르세요.'
            : '아직 로그인이 끝나지 않았습니다. 브라우저에서 Claude 로그인을 완료하세요.',
        )
      } else {
        setStatusMessage(
          diagnostics.error ??
            diagnostics.warning ??
            '런타임 연결을 확인하지 못했습니다. 로그인 창의 마지막 문구를 확인하세요.',
        )
      }
    } catch (error) {
      setStatusMessage(
        `연결 확인 중 오류가 발생했습니다: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    } finally {
      setIsChecking(false)
    }
  }

  return (
    <div className="smtcmp-runtime-installer">
      <div className="smtcmp-runtime-installer-intro">
        Smart Composer는 로그인 토큰이나 일회용 코드를 저장하지 않습니다. 공식
        CLI 창에서 로그인을 끝낸 뒤 연결 상태만 확인합니다.
      </div>

      <section className="smtcmp-runtime-install-step">
        <StepHeading number="1" title="로그인 창 열기" />
        <p>
          아래 버튼을 한 번 누르세요. 이미 열린 로그인 창이 있다면 새로 열지
          않고 그 창에서 계속 진행해도 됩니다.
        </p>
        <button className="mod-cta" onClick={openLogin}>
          <LogIn size={16} />
          로그인 창 열기
        </button>
      </section>

      <section className="smtcmp-runtime-install-step">
        <StepHeading number="2" title="화면 안내 따라가기" />
        <NativeRuntimeLoginSteps provider={provider} />
      </section>

      <section className="smtcmp-runtime-install-step">
        <StepHeading number="3" title="연결 확인" />
        <p>
          터미널에 로그인 완료 문구가 나온 뒤 아래 버튼을 누르세요. 창을 다시 열
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
        className={`smtcmp-runtime-installer-status${
          isReady ? ' is-success' : ''
        }`}
        role="status"
        aria-live="polite"
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

function StepHeading({ number, title }: { number: string; title: string }) {
  return (
    <div className="smtcmp-runtime-install-step-heading">
      <span aria-hidden="true">{number}</span>
      <strong>{title}</strong>
    </div>
  )
}
