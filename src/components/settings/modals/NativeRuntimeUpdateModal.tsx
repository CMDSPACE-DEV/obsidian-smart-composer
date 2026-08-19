import { CheckCircle2, ExternalLink, RefreshCw, Rocket } from 'lucide-react'
import { App, Platform } from 'obsidian'
import { useEffect, useState } from 'react'

import type { NativeRuntimeSnapshot } from '../../../core/llm/native/nativeRuntime.types'
import { NativeRuntimeService } from '../../../core/llm/native/NativeRuntimeService'
import { ReactModal } from '../../common/ReactModal'

const ANTIGRAVITY_UPDATE_HELP_URL =
  'https://antigravity.google/docs/cli/troubleshooting'

type NativeRuntimeUpdateModalProps = {
  service: NativeRuntimeService
  onDiagnostics: (snapshot: NativeRuntimeSnapshot) => void | Promise<void>
  onClose: () => void
}

type NativeRuntimeUpdateModalOptions = Omit<
  NativeRuntimeUpdateModalProps,
  'onClose'
>

export class NativeRuntimeUpdateModal extends ReactModal<NativeRuntimeUpdateModalProps> {
  constructor(app: App, options: NativeRuntimeUpdateModalOptions) {
    super({
      app,
      Component: NativeRuntimeUpdateModalComponent,
      props: options,
      options: {
        title: 'Antigravity 자동 업데이트 확인',
      },
    })
  }
}

export function NativeRuntimeUpdateModalComponent({
  service,
  onDiagnostics,
  onClose,
}: NativeRuntimeUpdateModalProps) {
  const [snapshot, setSnapshot] = useState(() => service.getSnapshot('gemini'))
  const [isChecking, setIsChecking] = useState(false)
  const [status, setStatus] = useState(
    'Antigravity를 열어 내장 백그라운드 업데이터가 동작할 기회를 제공합니다.',
  )
  const [hasError, setHasError] = useState(false)
  const updateDecision = service.getUpdateDecision('gemini')
  const canOpen =
    Platform.isDesktop &&
    updateDecision.state === 'background' &&
    Boolean(updateDecision.command)
  const hasVerifiedInstall =
    canOpen &&
    snapshot.installation === 'installed' &&
    Boolean(snapshot.version)

  useEffect(() => service.subscribe('gemini', setSnapshot), [service])

  const openAntigravity = () => {
    try {
      service.openUpdateTerminal('gemini')
      setHasError(false)
      setStatus(
        'Antigravity를 열었습니다. 내장 업데이터는 일정과 잠금 상태에 따라 백그라운드에서 동작할 수 있습니다. 잠시 뒤 CLI를 종료하고 이 창에서 설치 버전을 다시 확인하세요.',
      )
    } catch {
      setHasError(true)
      setStatus(
        'Antigravity를 열지 못했습니다. 상태를 다시 확인한 뒤 재시도하세요.',
      )
    }
  }

  const diagnose = async () => {
    if (isChecking) return
    const previousVersion = snapshot.version
    setIsChecking(true)
    setHasError(false)
    setStatus('설치된 Antigravity 버전과 연결 상태를 다시 확인하고 있습니다...')
    try {
      const result = await service.diagnose('gemini')
      setSnapshot(result)
      await onDiagnostics(result)
      if (result.installation !== 'installed') {
        setHasError(true)
        setStatus(
          'Antigravity 설치를 찾지 못했습니다. 설치 안내를 다시 확인하세요.',
        )
      } else if (!result.version) {
        setHasError(true)
        setStatus(
          'Antigravity 실행 파일은 찾았지만 설치 버전을 확인하지 못했습니다. 상태를 다시 진단하거나 공식 문제 해결 문서를 확인하세요.',
        )
      } else if (previousVersion && result.version !== previousVersion) {
        setStatus(
          `설치 버전이 ${previousVersion}에서 ${result.version}(으)로 변경되었습니다.`,
        )
      } else if (!previousVersion) {
        setStatus(
          `현재 설치된 버전은 ${result.version}입니다. 비교할 이전 값이 없어 버전 변화 여부는 판단하지 않았습니다.`,
        )
      } else {
        setStatus(
          `현재 설치된 버전은 ${result.version}입니다. 이번 확인에서는 버전 변화가 관찰되지 않았습니다.`,
        )
      }
    } catch {
      setHasError(true)
      setStatus(
        'Antigravity 상태를 다시 확인하지 못했습니다. 잠시 뒤 재시도하세요.',
      )
    } finally {
      setIsChecking(false)
    }
  }

  const openHelp = () => {
    const openedWindow = window.open(
      ANTIGRAVITY_UPDATE_HELP_URL,
      '_blank',
      'noopener,noreferrer',
    )
    if (openedWindow) openedWindow.opener = null
  }

  return (
    <div className="smtcmp-runtime-update-modal" data-runtime-update="gemini">
      {hasVerifiedInstall && (
        <div className="smtcmp-plan-runtime-success">
          <CheckCircle2 size={17} aria-hidden="true" />
          <div>
            <strong>백그라운드 업데이터 포함</strong>
            <span>현재 설치 버전: {snapshot.version}</span>
          </div>
        </div>
      )}

      <p>
        현재 공식 CLI 문서에는 별도의 <code>agy update</code> 명령이 안내되어
        있지 않습니다. Antigravity는 자체 백그라운드 업데이터를 포함하므로, 아래
        버튼은 설치된 CLI를 평소처럼 열어 업데이터가 동작할 기회를 제공합니다.
      </p>
      <ol>
        <li>아래 버튼으로 Antigravity를 엽니다.</li>
        <li>잠시 기다린 뒤 CLI를 종료합니다.</li>
        <li>이 창으로 돌아와 설치 버전을 다시 확인합니다.</li>
      </ol>

      {!hasVerifiedInstall && (
        <div className="smtcmp-plan-runtime-warning">
          {updateDecision.state === 'ambiguous'
            ? 'Antigravity 설치본이 여러 개 발견되었습니다. 사용할 실행 파일을 하나로 지정한 뒤 다시 확인하세요.'
            : !canOpen
              ? '업데이트를 확인할 Antigravity 실행 파일을 안전하게 선택하지 못했습니다. 먼저 상태를 다시 진단하세요.'
              : '실행 파일은 찾았지만 설치 버전을 확인하지 못했습니다. 버전을 다시 확인하세요.'}
        </div>
      )}

      <div
        className={
          hasError
            ? 'smtcmp-plan-runtime-error'
            : 'smtcmp-runtime-update-status'
        }
        role={hasError ? 'alert' : 'status'}
        aria-live="polite"
      >
        {status}
      </div>

      <div className="modal-button-container smtcmp-runtime-update-actions">
        <button
          className="mod-cta"
          data-runtime-update-action="launch"
          autoFocus={canOpen}
          disabled={!canOpen}
          onClick={openAntigravity}
        >
          <Rocket size={15} aria-hidden="true" />
          Antigravity 열기
        </button>
        <button
          data-runtime-update-action="recheck"
          autoFocus={!canOpen}
          disabled={isChecking || !Platform.isDesktop}
          onClick={() => void diagnose()}
        >
          <RefreshCw
            size={15}
            aria-hidden="true"
            className={isChecking ? 'smtcmp-icon-spin' : undefined}
          />
          {isChecking ? '확인 중' : '버전 다시 확인'}
        </button>
        <button
          aria-label="공식 업데이트 문제 해결 문서 열기(새 창)"
          onClick={openHelp}
        >
          <ExternalLink size={15} aria-hidden="true" />
          문제 해결
        </button>
        <button className="mod-cancel" onClick={onClose}>
          닫기
        </button>
      </div>
    </div>
  )
}
