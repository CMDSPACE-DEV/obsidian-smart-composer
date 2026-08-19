import type { NativeRuntimeProvider } from '../../../core/llm/native/nativeRuntime.types'

export type NativeRuntimeGuidePlatform = 'win32' | 'darwin'

export function NativeRuntimeLoginSteps({
  provider,
  platform = currentGuidePlatform(),
}: {
  provider: NativeRuntimeProvider
  platform?: NativeRuntimeGuidePlatform
}) {
  const pasteKey = platform === 'darwin' ? '⌘V' : 'Ctrl+V'

  if (provider === 'claude') {
    return (
      <ol className="smtcmp-runtime-login-steps">
        <li>
          열린 Claude Code 창에서 브라우저 로그인 안내가 나타나면{' '}
          <strong>Enter</strong>를 누르세요.
        </li>
        <li>
          브라우저에서 사용 중인 Claude 구독 계정으로 로그인하고 연결을
          허용하세요.
        </li>
        <li>
          터미널에 로그인 완료 문구가 나타나면 이 화면으로 돌아와{' '}
          <strong>연결 확인</strong>을 누르세요.
        </li>
      </ol>
    )
  }

  return (
    <>
      <ol className="smtcmp-runtime-login-steps">
        <li>
          Antigravity가 운영체제의 보안 저장소를 확인한 뒤 기본 브라우저를
          엽니다. 브라우저가 열리면 개인 Google 계정으로 로그인하세요.
        </li>
        <li>
          일반 사용자는 <strong>Google Cloud project</strong>를 선택하지 마세요.
          해당 경로는 별도 Cloud 과금으로 이어질 수 있습니다.
        </li>
        <li>
          로컬 로그인은 보통 브라우저에서 완료됩니다. CLI가 직접 일회용 코드를
          요구할 때만 코드를 복사하여 터미널에 <kbd>{pasteKey}</kbd> 후{' '}
          <kbd>Enter</kbd>를 누르세요.
        </li>
        <li>
          터미널에 로그인 완료 문구가 나타나면 이 화면으로 돌아와{' '}
          <strong>연결 확인</strong>을 누르세요.
        </li>
      </ol>
      <div className="smtcmp-runtime-login-secret">
        OAuth 코드나 계정 정보는 Smart Composer에 붙여넣지 마세요. 인증은 공식
        Antigravity CLI와 운영체제의 보안 저장소에서만 처리됩니다.
      </div>
    </>
  )
}

function currentGuidePlatform(): NativeRuntimeGuidePlatform {
  return process.platform === 'darwin' ? 'darwin' : 'win32'
}
