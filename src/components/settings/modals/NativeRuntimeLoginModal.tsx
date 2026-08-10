import { Check, LogIn, RefreshCw, ShieldAlert } from 'lucide-react'
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
  const [statusMessage, setStatusMessage] = useState(() =>
    initialStatusMessage(snapshot, title, provider),
  )
  const platform = process.platform === 'darwin' ? 'darwin' : 'win32'
  const isReady = snapshot.status === 'ready'
  const isPolicyBlocked =
    snapshot.status === 'billing-blocked' ||
    snapshot.status === 'quota-unverified'
  const isAuthenticatedButBlocked =
    isPolicyBlocked && hasAuthenticatedPolicyBlock(snapshot)
  const isChecking = isCheckingRequest || snapshot.phase === 'checking'

  useEffect(
    () =>
      service.subscribe(provider, (nextSnapshot) => {
        setSnapshot(nextSnapshot)
        if (
          nextSnapshot.phase === 'settled' &&
          (nextSnapshot.status === 'ready' ||
            nextSnapshot.status === 'billing-blocked' ||
            nextSnapshot.status === 'quota-unverified')
        ) {
          setStatusMessage(initialStatusMessage(nextSnapshot, title, provider))
        }
      }),
    [provider, service, title],
  )

  const openLogin = () => {
    try {
      service.openLoginTerminal(provider)
      setStatusMessage(
        isPolicyBlocked
          ? `${provider === 'claude' ? 'Claude Code' : 'Antigravity'} 로그인 관리 창을 열었습니다. 계정 변경이 필요할 때만 안내를 진행하세요. 기존 요청 차단은 재로그인만으로 해제되지 않을 수 있습니다.`
          : provider === 'claude'
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
      provider === 'gemini'
        ? 'Antigravity 로그인과 사용 가능한 모델을 확인하고 있습니다...'
        : '로그인 상태와 안전한 Plan 사용 가능 여부를 확인하고 있습니다...',
    )
    try {
      const result = await service.diagnose(provider)
      setSnapshot(result)
      await onDiagnostics(result)

      if (result.status === 'ready') {
        setStatusMessage(
          provider === 'gemini'
            ? 'Antigravity 로그인과 사용 가능한 모델을 확인했습니다. 완료를 눌러 Gemini를 사용할 수 있습니다.'
            : `${title} 로그인을 확인했습니다. 완료를 눌러 모델을 사용할 수 있습니다.`,
        )
      } else if (result.status === 'login-required') {
        setStatusMessage(
          provider === 'gemini'
            ? '아직 로그인이 끝나지 않았습니다. 브라우저 로그인을 완료하고, CLI가 직접 코드를 요구한 경우에만 터미널 입력을 마치세요.'
            : '아직 로그인이 끝나지 않았습니다. 브라우저에서 Claude 로그인을 완료하세요.',
        )
      } else if (result.status === 'billing-blocked') {
        setStatusMessage(policyBlockMessage(provider, result))
      } else if (result.status === 'quota-unverified') {
        setStatusMessage(policyBlockMessage(provider, result))
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
        <StepHeading
          number="1"
          title={isReady || isPolicyBlocked ? '로그인 관리' : '로그인 창 열기'}
          current={!isReady && !isPolicyBlocked}
        />
        <p>
          {isReady || isPolicyBlocked
            ? '계정을 바꾸거나 공식 CLI의 로그인 상태를 관리할 때만 아래 버튼을 누르세요.'
            : '아래 버튼을 한 번 누르세요. 이미 열린 로그인 창이 있다면 그 창에서 계속 진행해도 됩니다.'}
        </p>
        <button className="mod-cta" onClick={openLogin}>
          <LogIn size={16} />
          {isReady || isPolicyBlocked ? '로그인 관리' : '로그인 창 열기'}
        </button>
      </section>

      <section className="smtcmp-runtime-install-step">
        <StepHeading
          number="2"
          title={isPolicyBlocked ? '계정 변경 시 안내' : '화면 안내 따라가기'}
        />
        <NativeRuntimeLoginSteps provider={provider} platform={platform} />
      </section>

      <section
        className={`smtcmp-runtime-install-step${isReady ? ' is-complete' : ''}`}
        aria-busy={isChecking}
      >
        <StepHeading
          number="3"
          title="로그인 및 요청 정책 확인"
          complete={isReady}
          current={!isReady && !isPolicyBlocked}
        />
        <p>
          {isPolicyBlocked
            ? '로그인 반복 대신 표시된 차단 사유를 해결한 뒤 다시 확인하세요.'
            : '터미널에 로그인 완료 문구가 나타난 뒤 누르세요. 로그인 창을 다시 열 필요는 없습니다.'}
        </p>
        {isPolicyBlocked && (
          <div className="smtcmp-plan-runtime-warning" role="status">
            <strong>
              {isAuthenticatedButBlocked ? '로그인 확인됨' : '요청 정책 확인됨'}
            </strong>
            {' · '}요청 차단
          </div>
        )}
        <button
          className={isReady || isPolicyBlocked ? undefined : 'mod-cta'}
          disabled={isChecking}
          onClick={() => void diagnose()}
        >
          {isReady ? (
            <Check size={16} />
          ) : isPolicyBlocked ? (
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
      </section>

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

function initialStatusMessage(
  snapshot: NativeRuntimeSnapshot,
  title: string,
  provider: NativeRuntimeProvider,
): string {
  if (snapshot.status === 'ready') {
    return provider === 'gemini'
      ? 'Antigravity 로그인과 사용 가능한 모델을 확인했습니다. 지금 Gemini를 사용할 수 있습니다.'
      : `${title} 로그인이 확인되어 요청할 수 있습니다.`
  }
  if (
    snapshot.status === 'billing-blocked' ||
    snapshot.status === 'quota-unverified'
  ) {
    return policyBlockMessage(provider, snapshot)
  }
  return '아래 순서대로 진행하세요. 로그인 창은 Smart Composer와 별도로 열립니다.'
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
  return `${loginState}${boundary}${detail ? ` ${detail}` : ''} 재로그인만으로 해제되는 상태가 아닙니다. 표시된 과금 경로나 환경 설정을 먼저 확인하세요.`
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
