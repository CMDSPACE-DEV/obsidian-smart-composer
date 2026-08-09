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

function createSharedService(initial: NativeRuntimeSnapshot) {
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
      publish(installedSnapshot)
      return installedSnapshot
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
})
