/** @jest-environment jsdom */

jest.mock('obsidian', () => ({
  App: class {},
  Modal: class {},
  Notice: class {},
  Platform: { isDesktop: true },
  normalizePath: (value: string) => value,
}))

jest.mock('./ConnectOpenAIPlanModal', () => ({
  ConnectOpenAIPlanModal: class {},
}))

jest.mock('../../../contexts/settings-context', () => ({
  useSettings: jest.fn(),
}))

import '@testing-library/jest-dom'

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { App } from 'obsidian'

import type {
  NativeRuntimeProvider,
  NativeRuntimeSnapshot,
} from '../../../core/llm/native/nativeRuntime.types'
import type { NativeRuntimeService } from '../../../core/llm/native/NativeRuntimeService'
import { NativeRuntimeCard } from '../sections/PlanConnectionsSection'

import { NativeRuntimeInstallModalComponent } from './NativeRuntimeInstallModal'
import { NativeRuntimeLoginModalComponent } from './NativeRuntimeLoginModal'

const notInstalledSnapshot: NativeRuntimeSnapshot = {
  provider: 'claude',
  status: 'not-installed',
  phase: 'settled',
  installation: 'not-installed',
  authentication: 'not-checked',
  catalog: 'not-checked',
  update: 'unknown',
  models: [],
}

const installedSnapshot: NativeRuntimeSnapshot = {
  provider: 'claude',
  status: 'login-required',
  phase: 'settled',
  installation: 'installed',
  authentication: 'login-required',
  catalog: 'ready',
  update: 'native',
  executablePath: 'C:\\Users\\test\\.local\\bin\\claude.exe',
  models: [{ id: 'sonnet', label: 'Claude Sonnet' }],
}

const readySnapshot: NativeRuntimeSnapshot = {
  ...installedSnapshot,
  status: 'ready',
  authentication: 'subscription',
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

const blockedSnapshot: NativeRuntimeSnapshot = {
  ...installedSnapshot,
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

const preflightBlockedSnapshot: NativeRuntimeSnapshot = {
  ...blockedSnapshot,
  catalog: 'ready',
  authDecision: {
    status: 'billing-blocked',
    allowed: false,
    reason: 'An environment credential takes precedence.',
    evidence: ['environment variable present: ANTHROPIC_API_KEY'],
  },
  error: 'An environment credential takes precedence.',
}

const unverifiedGeminiSnapshot: NativeRuntimeSnapshot = {
  ...installedSnapshot,
  provider: 'gemini',
  status: 'quota-unverified',
  authentication: 'quota-unverified',
  update: 'background',
  executablePath: 'C:\\Users\\test\\AppData\\Local\\agy\\bin\\agy.exe',
  models: [{ id: 'gemini-test', label: 'Gemini test' }],
  authDecision: {
    status: 'quota-unverified',
    allowed: false,
    reason: 'Personal Gemini Plan quota provenance is not available.',
    evidence: ['no supported personal-plan quota provenance field'],
  },
  error: 'Personal Gemini Plan quota provenance is not available.',
}

const readyGeminiSnapshot: NativeRuntimeSnapshot = {
  ...installedSnapshot,
  provider: 'gemini',
  status: 'ready',
  authentication: 'subscription',
  catalog: 'ready',
  update: 'background',
  executablePath: 'C:\\Users\\test\\AppData\\Local\\agy\\bin\\agy.exe',
  models: [{ id: 'gemini-test', label: 'Gemini test' }],
  authDecision: {
    status: 'subscription',
    allowed: true,
    reason:
      'Antigravity is signed in and returned a usable model catalog. Gemini requests are enabled in compatibility mode; the CLI does not expose the account quota source to Smart Composer.',
    evidence: ['agy models --json returned a non-empty catalog'],
  },
}

function createSharedService(
  initial: NativeRuntimeSnapshot,
  diagnosisResult: NativeRuntimeSnapshot = installedSnapshot,
) {
  let snapshot = initial
  const listeners = new Set<(value: NativeRuntimeSnapshot) => void>()
  const publish = (value: NativeRuntimeSnapshot) => {
    snapshot = value
    listeners.forEach((listener) => listener(value))
  }

  const service = {
    getSnapshot: (provider: NativeRuntimeProvider) => ({
      ...snapshot,
      provider,
    }),
    subscribe: (
      _provider: NativeRuntimeProvider,
      listener: (value: NativeRuntimeSnapshot) => void,
    ) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    diagnose: jest.fn(async () => {
      publish({
        ...snapshot,
        status: 'checking',
        phase: 'checking',
        installation: 'not-checked',
        authentication: 'not-checked',
        catalog: 'not-checked',
        update: 'not-checked',
        models: [],
      })
      await Promise.resolve()
      publish(diagnosisResult)
      return diagnosisResult
    }),
    getCustomPath: () => '',
    setCustomPath: jest.fn(),
    openSetupTerminal: jest.fn(),
    openLoginTerminal: jest.fn(),
    openUpdateTerminal: jest.fn(),
    getUpdateDecision: jest.fn(() => ({
      provider: 'claude',
      state: 'native',
      command: 'claude update',
      shell: 'powershell',
      reason: 'native',
      discovery: {
        provider: 'claude',
        selectedMethod: 'native',
        candidates: [],
        ambiguous: false,
      },
    })),
  } as unknown as NativeRuntimeService

  return { service, publish }
}

const scrollIntoViewMock = jest.fn()
const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(
  process,
  'platform',
)

beforeAll(() => {
  Object.defineProperty(process, 'platform', {
    ...originalPlatformDescriptor,
    configurable: true,
    value: 'win32',
  })
})

afterAll(() => {
  if (originalPlatformDescriptor) {
    Object.defineProperty(process, 'platform', originalPlatformDescriptor)
  }
})

beforeEach(() => {
  scrollIntoViewMock.mockClear()
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: scrollIntoViewMock,
  })
})

describe('native runtime onboarding interaction', () => {
  it('unlocks, scrolls to, and focuses Step 4 after installation succeeds', async () => {
    const { service } = createSharedService(notInstalledSnapshot)
    const onDiagnostics = jest.fn()
    const { container } = render(
      <NativeRuntimeInstallModalComponent
        provider="claude"
        title="Claude Plan"
        service={service}
        onDiagnostics={onDiagnostics}
        onClose={() => undefined}
      />,
    )
    const loginStep = container.querySelector<HTMLElement>(
      '[data-runtime-step="login"]',
    )

    expect(loginStep).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(screen.getByRole('button', { name: '설치 확인' }))

    await waitFor(() => {
      expect(loginStep).toHaveAttribute('aria-disabled', 'false')
      expect(loginStep).toHaveFocus()
    })
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ block: 'nearest' })
    expect(onDiagnostics).toHaveBeenCalledWith(installedSnapshot)
  })

  it('updates the card and modal from the same published diagnosis', async () => {
    const { service } = createSharedService(notInstalledSnapshot)
    const onDiagnostics = jest.fn()
    const { container } = render(
      <>
        <NativeRuntimeCard
          app={{} as App}
          provider="claude"
          title="Claude Plan"
          description="Test runtime"
          service={service}
          onDiagnostics={onDiagnostics}
        />
        <NativeRuntimeInstallModalComponent
          provider="claude"
          title="Claude Plan"
          service={service}
          onDiagnostics={onDiagnostics}
          onClose={() => undefined}
        />
      </>,
    )

    expect(
      container.querySelector('[data-runtime-provider="claude"]'),
    ).toHaveTextContent('Not installed')
    fireEvent.click(screen.getByRole('button', { name: '설치 확인' }))

    await waitFor(() => {
      expect(
        container.querySelector('[data-runtime-provider="claude"]'),
      ).toHaveTextContent('Login required')
      expect(
        container.querySelector('[data-runtime-step="login"]'),
      ).toHaveAttribute('aria-disabled', 'false')
    })
    expect(
      container.querySelector(
        '[data-runtime-provider="claude"] [data-runtime-action="install"]',
      ),
    ).not.toBeInTheDocument()
  })

  it('shows Ready and completes Step 4 for an allowed Pro or Max subscription', async () => {
    const { service } = createSharedService(notInstalledSnapshot, readySnapshot)
    const onDiagnostics = jest.fn()
    const { container } = render(
      <>
        <NativeRuntimeCard
          app={{} as App}
          provider="claude"
          title="Claude Plan"
          description="Test runtime"
          service={service}
          onDiagnostics={onDiagnostics}
        />
        <NativeRuntimeInstallModalComponent
          provider="claude"
          title="Claude Plan"
          service={service}
          onDiagnostics={onDiagnostics}
          onClose={() => undefined}
        />
      </>,
    )

    fireEvent.click(screen.getByRole('button', { name: '설치 확인' }))

    await waitFor(() => {
      expect(
        container.querySelector('[data-runtime-provider="claude"]'),
      ).toHaveTextContent('Ready')
      expect(
        container.querySelector('[data-runtime-step="login"]'),
      ).toHaveClass('is-complete')
      expect(screen.getByRole('button', { name: '연결 확인됨' })).toBeEnabled()
    })
    expect(
      screen.getAllByRole('button', { name: '로그인 관리' }),
    ).not.toHaveLength(0)
  })

  it('separates confirmed login from a policy-blocked request', () => {
    const { service } = createSharedService(blockedSnapshot)
    const { container } = render(
      <>
        <NativeRuntimeCard
          app={{} as App}
          provider="claude"
          title="Claude Plan"
          description="Test runtime"
          service={service}
          onDiagnostics={() => undefined}
        />
        <NativeRuntimeLoginModalComponent
          provider="claude"
          title="Claude Plan"
          service={service}
          onDiagnostics={() => undefined}
          onClose={() => undefined}
        />
      </>,
    )

    expect(
      container.querySelector('[data-runtime-provider="claude"]'),
    ).toHaveTextContent('로그인 확인됨 · 요청 차단')
    expect(screen.getAllByRole('button', { name: '로그인 관리' })).toHaveLength(
      2,
    )
    expect(
      screen.getByText(/재로그인만으로 해제되는 상태가 아닙니다/),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Sign in' }),
    ).not.toBeInTheDocument()
  })

  it('keeps Gemini login confirmation separate from unverified Plan quota', () => {
    const { service } = createSharedService(unverifiedGeminiSnapshot)
    const { container } = render(
      <NativeRuntimeCard
        app={{} as App}
        provider="gemini"
        title="Gemini Plan"
        description="Test runtime"
        service={service}
        onDiagnostics={() => undefined}
      />,
    )

    const card = container.querySelector('[data-runtime-provider="gemini"]')
    expect(card).toHaveTextContent('로그인 확인됨 · 요청 차단')
    expect(card).toHaveTextContent(
      'Personal Gemini Plan quota provenance is not available.',
    )
    expect(card).not.toHaveTextContent('Ready')
    expect(screen.getByRole('button', { name: '로그인 관리' })).toBeEnabled()
  })

  it('shows Gemini as Ready and completes Step 4 after a successful catalog diagnosis', async () => {
    const { service } = createSharedService(
      { ...notInstalledSnapshot, provider: 'gemini' },
      readyGeminiSnapshot,
    )
    const onDiagnostics = jest.fn()
    const { container } = render(
      <>
        <NativeRuntimeCard
          app={{} as App}
          provider="gemini"
          title="Gemini Plan"
          description="Test runtime"
          service={service}
          onDiagnostics={onDiagnostics}
        />
        <NativeRuntimeInstallModalComponent
          provider="gemini"
          title="Gemini Plan"
          service={service}
          onDiagnostics={onDiagnostics}
          onClose={() => undefined}
        />
      </>,
    )

    const installationCheck = container.querySelector<HTMLButtonElement>(
      '[data-runtime-action="check-installation"]',
    )
    expect(installationCheck).not.toBeNull()
    if (!installationCheck) {
      throw new Error('Gemini installation check button was not rendered')
    }
    fireEvent.click(installationCheck)

    await waitFor(() => {
      const card = container.querySelector('[data-runtime-provider="gemini"]')
      const loginStep = container.querySelector<HTMLElement>(
        '[data-runtime-step="login"]',
      )

      expect(card).toHaveTextContent('Ready')
      expect(card).toHaveTextContent('1 models detected')
      expect(card).toHaveTextContent('연결 완료 · Gemini 사용 가능')
      expect(card).toHaveTextContent(
        'Antigravity 로그인과 사용 가능한 모델 목록을 확인했습니다.',
      )
      expect(card).not.toHaveTextContent(
        'Personal Gemini Plan quota provenance is not available.',
      )
      expect(card).not.toHaveTextContent('legacy text model catalog')
      expect(card).not.toHaveTextContent('compatibility mode')
      expect(
        card?.querySelector('.smtcmp-plan-runtime-warning'),
      ).not.toBeInTheDocument()
      expect(
        card?.querySelector('.smtcmp-plan-runtime-error'),
      ).not.toBeInTheDocument()
      expect(
        card?.querySelector('.smtcmp-plan-runtime-success'),
      ).toBeInTheDocument()
      expect(container).toHaveTextContent(
        'Antigravity 설치, 로그인, 사용 가능한 모델을 확인했습니다.',
      )
      expect(container).not.toHaveTextContent('안전한 구독 로그인')
      expect(loginStep).toHaveClass('is-complete')
      expect(loginStep).toHaveAttribute('aria-disabled', 'false')
      expect(loginStep?.querySelectorAll('button')).not.toHaveLength(0)
      loginStep
        ?.querySelectorAll('button')
        .forEach((button) => expect(button).toBeEnabled())
    })
    expect(onDiagnostics).toHaveBeenCalledWith(readyGeminiSnapshot)
  })

  it.each([
    'environment variable present: ANTHROPIC_API_KEY',
    'managed settings file present',
    'unknown auth status schema',
  ])(
    'does not claim login was confirmed when auth was not positively verified: %s',
    (evidence) => {
      const snapshot = {
        ...preflightBlockedSnapshot,
        authDecision: {
          status: 'billing-blocked' as const,
          allowed: false,
          reason: 'Authentication was not positively verified.',
          evidence: [evidence],
        },
      }
      const { service } = createSharedService(snapshot)
      const { container } = render(
        <NativeRuntimeCard
          app={{} as App}
          provider="claude"
          title="Claude Plan"
          description="Test runtime"
          service={service}
          onDiagnostics={() => undefined}
        />,
      )

      const card = container.querySelector('[data-runtime-provider="claude"]')
      expect(card).toHaveTextContent('요청 차단')
      expect(card).not.toHaveTextContent('로그인 확인됨')
      expect(screen.getByRole('button', { name: '로그인 관리' })).toBeEnabled()
    },
  )
})
