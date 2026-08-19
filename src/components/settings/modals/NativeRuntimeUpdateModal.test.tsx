/** @jest-environment jsdom */

jest.mock('obsidian', () => ({
  App: class {},
  Modal: class {},
  Platform: { isDesktop: true },
}))

import '@testing-library/jest-dom'

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import type {
  NativeRuntimeSnapshot,
  RuntimeDiscovery,
} from '../../../core/llm/native/nativeRuntime.types'
import type {
  NativeRuntimeService,
  NativeRuntimeUpdateDecision,
} from '../../../core/llm/native/NativeRuntimeService'

import { NativeRuntimeUpdateModalComponent } from './NativeRuntimeUpdateModal'

const readyDiscovery: RuntimeDiscovery = {
  provider: 'gemini',
  selectedPath: 'C:\\Users\\test\\AppData\\Local\\agy\\bin\\agy.exe',
  selectedMethod: 'native',
  candidates: [],
  ambiguous: false,
}

const readySnapshot: NativeRuntimeSnapshot = {
  provider: 'gemini',
  status: 'ready',
  phase: 'settled',
  installation: 'installed',
  authentication: 'subscription',
  catalog: 'ready',
  update: 'background',
  executablePath: 'C:\\Users\\test\\AppData\\Local\\agy\\bin\\agy.exe',
  version: '1.1.11',
  models: [{ id: 'gemini-test', label: 'Gemini Test' }],
  discovery: readyDiscovery,
}

function createService(
  snapshot: NativeRuntimeSnapshot = readySnapshot,
  diagnosis: NativeRuntimeSnapshot = snapshot,
) {
  const listeners = new Set<(value: NativeRuntimeSnapshot) => void>()
  const openUpdateTerminal = jest.fn()
  const diagnose = jest.fn(async () => {
    listeners.forEach((listener) => listener(diagnosis))
    return diagnosis
  })
  const getUpdateDecision = jest.fn<NativeRuntimeUpdateDecision, []>(() => ({
    provider: 'gemini',
    state: 'background',
    command: "& 'C:\\Users\\test\\AppData\\Local\\agy\\bin\\agy.exe'",
    shell: 'powershell',
    reason: 'background update check',
    discovery: snapshot.discovery ?? readyDiscovery,
  }))
  const service = {
    getSnapshot: jest.fn(() => snapshot),
    subscribe: jest.fn(
      (
        _provider: 'gemini',
        listener: (value: NativeRuntimeSnapshot) => void,
      ) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    ),
    getUpdateDecision,
    openUpdateTerminal,
    diagnose,
  } as unknown as NativeRuntimeService
  return { service, openUpdateTerminal, diagnose, getUpdateDecision }
}

describe('NativeRuntimeUpdateModalComponent', () => {
  it('opens the selected Antigravity runtime for its official background updater', () => {
    const { service, openUpdateTerminal } = createService()
    render(
      <NativeRuntimeUpdateModalComponent
        service={service}
        onDiagnostics={() => undefined}
        onClose={() => undefined}
      />,
    )

    expect(screen.getByText('현재 설치 버전: 1.1.11')).toBeInTheDocument()
    expect(screen.queryByText('Cancel')).not.toBeInTheDocument()
    expect(document.querySelector('.mod-warning')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '닫기' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Antigravity 열기' }))

    expect(openUpdateTerminal).toHaveBeenCalledWith('gemini')
    expect(screen.getByText(/Antigravity를 열었습니다/)).toBeInTheDocument()
  })

  it('re-diagnoses and reports an observed version change', async () => {
    const nextSnapshot = { ...readySnapshot, version: '1.1.12' }
    const { service, diagnose } = createService(readySnapshot, nextSnapshot)
    const onDiagnostics = jest.fn()
    render(
      <NativeRuntimeUpdateModalComponent
        service={service}
        onDiagnostics={onDiagnostics}
        onClose={() => undefined}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '버전 다시 확인' }))

    await waitFor(() => {
      expect(screen.getByText(/1\.1\.11에서 1\.1\.12/)).toBeInTheDocument()
    })
    expect(diagnose).toHaveBeenCalledWith('gemini')
    expect(onDiagnostics).toHaveBeenCalledWith(nextSnapshot)
  })

  it('does not launch a runtime when discovery is ambiguous', () => {
    const ambiguousSnapshot: NativeRuntimeSnapshot = {
      ...readySnapshot,
      update: 'ambiguous',
      discovery: { ...readyDiscovery, ambiguous: true },
    }
    const { service, getUpdateDecision } = createService(ambiguousSnapshot)
    getUpdateDecision.mockReturnValue({
      provider: 'gemini',
      state: 'ambiguous' as const,
      command: undefined,
      shell: 'powershell' as const,
      reason: 'ambiguous',
      discovery: ambiguousSnapshot.discovery ?? readyDiscovery,
    })

    render(
      <NativeRuntimeUpdateModalComponent
        service={service}
        onDiagnostics={() => undefined}
        onClose={() => undefined}
      />,
    )

    expect(
      screen.getByRole('button', { name: 'Antigravity 열기' }),
    ).toBeDisabled()
    expect(screen.getByText(/설치본이 여러 개/)).toBeInTheDocument()
    expect(
      document.querySelector('.smtcmp-plan-runtime-success'),
    ).not.toBeInTheDocument()
  })

  it('treats a missing installed version as a failed recheck', async () => {
    const unknownVersionSnapshot = { ...readySnapshot, version: undefined }
    const { service } = createService(readySnapshot, unknownVersionSnapshot)
    render(
      <NativeRuntimeUpdateModalComponent
        service={service}
        onDiagnostics={() => undefined}
        onClose={() => undefined}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '버전 다시 확인' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        '설치 버전을 확인하지 못했습니다',
      )
    })
  })

  it('does not claim a change when there was no previous version to compare', async () => {
    const initialSnapshot = { ...readySnapshot, version: undefined }
    const { service } = createService(initialSnapshot, readySnapshot)
    render(
      <NativeRuntimeUpdateModalComponent
        service={service}
        onDiagnostics={() => undefined}
        onClose={() => undefined}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '버전 다시 확인' }))

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        '비교할 이전 값이 없어 버전 변화 여부는 판단하지 않았습니다',
      )
    })
    expect(screen.queryByText(/변경되었습니다/)).not.toBeInTheDocument()
  })
})
