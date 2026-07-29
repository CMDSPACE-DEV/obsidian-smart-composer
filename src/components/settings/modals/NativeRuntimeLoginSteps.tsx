import type { NativeRuntimeProvider } from '../../../core/llm/native/nativeRuntime.types'

export function NativeRuntimeLoginSteps({
  provider,
}: {
  provider: NativeRuntimeProvider
}) {
  if (provider === 'claude') {
    return (
      <ol className="smtcmp-runtime-login-steps">
        <li>
          열린 Claude Code 창에서 브라우저 로그인 안내가 나오면{' '}
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
          검은 창에 <strong>Select login method</strong>가 나오면{' '}
          <strong>1. Google OAuth</strong> 앞에 <code>&gt;</code>가 있는지
          확인하고 <kbd>Enter</kbd>를 누르세요. 다른 줄이 선택되어 있으면
          방향키로 1번으로 이동하세요.
        </li>
        <li>
          브라우저가 열리면 사용할 Google 계정으로 로그인하고 접근을 허용하세요.
          일반 사용자는 <strong>2. Google Cloud project</strong>를 선택할 필요가
          없습니다.
        </li>
        <li>
          브라우저에 <strong>Paste this code into your application</strong>이
          보이면, 페이지의 <strong>복사</strong> 버튼으로 일회용 코드를
          복사하세요.
        </li>
        <li>
          다시 검은 터미널 창을 한 번 클릭하고 <kbd>Ctrl</kbd>+<kbd>V</kbd>를
          누른 뒤 <kbd>Enter</kbd>를 누르세요. 붙여넣기가 보이지 않아도 코드가
          숨김 입력된 것일 수 있으므로 Enter를 한 번 누르세요.
        </li>
        <li>
          로그인 완료 문구가 나타나면 이 화면으로 돌아와{' '}
          <strong>연결 확인</strong>을 누르세요.
        </li>
      </ol>
      <div className="smtcmp-runtime-login-secret">
        브라우저에 표시된 코드는 일회용 로그인 비밀값입니다. Smart Composer
        채팅, 노트, 다른 사람에게 보내지 말고 Antigravity 터미널에만
        붙여넣으세요.
      </div>
    </>
  )
}
