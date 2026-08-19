jest.mock('obsidian', () => ({
  App: class {},
  Modal: class {},
  Notice: class {},
  Platform: { isDesktop: true },
  normalizePath: (value: string) => value,
}))

import { renderToStaticMarkup } from 'react-dom/server'

import type { NativeRuntimeSnapshot } from '../../../core/llm/native/nativeRuntime.types'
import type { NativeRuntimeService } from '../../../core/llm/native/NativeRuntimeService'

import {
  NativeRuntimeInstallModalComponent,
  getAlternativeInstallMethods,
} from './NativeRuntimeInstallModal'
import { NativeRuntimeLoginModalComponent } from './NativeRuntimeLoginModal'
import { NativeRuntimeLoginSteps } from './NativeRuntimeLoginSteps'

const initialSnapshot: NativeRuntimeSnapshot = {
  provider: 'claude',
  status: 'checking',
  phase: 'idle',
  installation: 'not-checked',
  authentication: 'not-checked',
  catalog: 'not-checked',
  update: 'not-checked',
  models: [],
}

const readyClaudeSnapshot: NativeRuntimeSnapshot = {
  ...initialSnapshot,
  status: 'ready',
  phase: 'settled',
  installation: 'installed',
  authentication: 'subscription',
  catalog: 'ready',
  update: 'native',
  authDecision: {
    status: 'subscription',
    allowed: true,
    reason: 'Eligible first-party Claude subscription.',
    evidence: [
      'authMethod=claude.ai',
      'apiProvider=firstParty',
      'subscriptionType=max',
    ],
  },
}

const blockedClaudeSnapshot: NativeRuntimeSnapshot = {
  ...readyClaudeSnapshot,
  status: 'billing-blocked',
  authentication: 'billing-blocked',
  authDecision: {
    status: 'billing-blocked',
    allowed: false,
    reason: 'A non-subscription billing path takes precedence.',
    evidence: ['auth metadata contains a non-subscription billing marker'],
  },
  error: 'A non-subscription billing path takes precedence.',
}

function createService(snapshot = initialSnapshot): NativeRuntimeService {
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => undefined,
    diagnose: async () => snapshot,
  } as unknown as NativeRuntimeService
}

function withPlatform<T>(platform: NodeJS.Platform, run: () => T): T {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { value: platform })
  try {
    return run()
  } finally {
    if (descriptor) Object.defineProperty(process, 'platform', descriptor)
  }
}

describe('NativeRuntimeInstallModalComponent', () => {
  it('renders always-visible accessible OS tabs and the exact Windows native command', () => {
    const html = withPlatform('win32', () =>
      renderToStaticMarkup(
        <NativeRuntimeInstallModalComponent
          provider="claude"
          title="Claude Plan"
          service={createService()}
          onDiagnostics={() => undefined}
          onClose={() => undefined}
        />,
      ),
    )

    expect(html).toContain('role="tablist"')
    expect(html).toContain('data-runtime-platform="win32"')
    expect(html).toContain('data-runtime-platform="darwin"')
    expect(html).toContain('aria-selected="true"')
    expect(html).toContain('irm https://claude.ai/install.ps1 | iex')
    expect(html).toContain('<kbd>Ctrl</kbd>+<kbd>V</kbd>')
    expect(html).toContain('data-runtime-action="check-installation"')
    expect(html).toContain('data-runtime-step="login"')
    expect(html).toContain('aria-disabled="true"')
  })

  it('defaults to macOS on Mac and uses Terminal.app with Command paste copy', () => {
    const html = withPlatform('darwin', () =>
      renderToStaticMarkup(
        <NativeRuntimeInstallModalComponent
          provider="gemini"
          title="Gemini Plan"
          service={createService({
            ...initialSnapshot,
            provider: 'gemini',
          })}
          onDiagnostics={() => undefined}
          onClose={() => undefined}
        />,
      ),
    )

    expect(html).toContain(
      'curl -fsSL https://antigravity.google/cli/install.sh | bash',
    )
    expect(html).toContain('Terminal.app')
    expect(html).toContain('<kbd>⌘</kbd>+<kbd>V</kbd>')
  })

  it('unlocks the embedded login step from the shared installed snapshot', () => {
    const html = withPlatform('win32', () =>
      renderToStaticMarkup(
        <NativeRuntimeInstallModalComponent
          provider="claude"
          title="Claude Plan"
          service={createService({
            ...initialSnapshot,
            status: 'login-required',
            phase: 'settled',
            installation: 'installed',
            authentication: 'login-required',
          })}
          onDiagnostics={() => undefined}
          onClose={() => undefined}
        />,
      ),
    )

    expect(html).toContain('data-runtime-step="login"')
    expect(html).toContain('aria-disabled="false"')
    expect(html).toContain('로그인 창 열기')
    expect(html).toContain('연결 확인')
  })

  it('renders an allowed first-party subscription as Ready and completed', () => {
    const html = withPlatform('win32', () =>
      renderToStaticMarkup(
        <NativeRuntimeInstallModalComponent
          provider="claude"
          title="Claude Plan"
          service={createService(readyClaudeSnapshot)}
          onDiagnostics={() => undefined}
          onClose={() => undefined}
        />,
      ),
    )

    expect(html).toMatch(
      /data-runtime-step="login" class="[^"]*is-complete[^"]*"/,
    )
    expect(html).toContain('연결 확인됨')
    expect(html).toContain('안전한 구독 로그인을 확인했습니다')
    expect(html).toContain('로그인 관리')
    expect(html).toContain('완료')
    expect(html).not.toContain('요청 차단')
  })

  it('labels an authenticated policy block without prescribing another login', () => {
    const service = createService(blockedClaudeSnapshot)
    const installer = withPlatform('win32', () =>
      renderToStaticMarkup(
        <NativeRuntimeInstallModalComponent
          provider="claude"
          title="Claude Plan"
          service={service}
          onDiagnostics={() => undefined}
          onClose={() => undefined}
        />,
      ),
    )
    const login = withPlatform('win32', () =>
      renderToStaticMarkup(
        <NativeRuntimeLoginModalComponent
          provider="claude"
          title="Claude Plan"
          service={service}
          onDiagnostics={() => undefined}
          onClose={() => undefined}
        />,
      ),
    )

    for (const html of [installer, login]) {
      expect(html).toContain('로그인 확인됨')
      expect(html).toContain('요청 차단')
      expect(html).toContain('로그인 관리')
      expect(html).toContain('재로그인만으로 해제되는 상태가 아닙니다')
      expect(html).not.toContain('공식 구독 계정으로 다시 로그인하세요')
    }
  })

  it('keeps official package-manager and CMD alternatives copy-only', () => {
    expect(getAlternativeInstallMethods('claude', 'win32')).toEqual([
      {
        id: 'winget',
        label: 'WinGet',
        command: 'winget install Anthropic.ClaudeCode',
      },
    ])
    expect(getAlternativeInstallMethods('claude', 'darwin')).toEqual([
      {
        id: 'homebrew',
        label: 'Homebrew',
        command: 'brew install --cask claude-code',
      },
    ])
    expect(getAlternativeInstallMethods('gemini', 'win32')[0].command).toBe(
      'curl -fsSL https://antigravity.google/cli/install.cmd -o install.cmd && install.cmd && del install.cmd',
    )
  })
})

describe('NativeRuntimeLoginSteps', () => {
  it('uses the selected platform paste key and makes the code flow conditional', () => {
    const mac = renderToStaticMarkup(
      <NativeRuntimeLoginSteps provider="gemini" platform="darwin" />,
    )
    const windows = renderToStaticMarkup(
      <NativeRuntimeLoginSteps provider="gemini" platform="win32" />,
    )

    expect(mac).toContain('<kbd>⌘V</kbd>')
    expect(windows).toContain('<kbd>Ctrl+V</kbd>')
    expect(mac).toContain('CLI가 직접 일회용 코드를 요구할 때만')
    expect(mac).toContain('Google Cloud project')
  })
})
