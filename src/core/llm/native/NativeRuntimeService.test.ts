jest.mock('obsidian', () => ({
  Platform: { isDesktop: true },
}))

import { NativeCliResolver } from './NativeCliResolver'
import {
  NativeRuntimeService,
  getNativeRuntimeInstallGuide,
  getUpdateDecision,
  parseAntigravityModels,
} from './NativeRuntimeService'
import { NativeRuntimeStore } from './NativeRuntimeStore'

describe('getNativeRuntimeInstallGuide', () => {
  it('gives Windows beginners the official native Claude command', () => {
    const guide = getNativeRuntimeInstallGuide('claude', 'win32')

    expect(guide).toMatchObject({
      shell: 'powershell',
      loginCommand: 'claude auth login',
      pasteModifier: 'Ctrl',
      expectedPath: '%USERPROFILE%\\.local\\bin\\claude.exe',
      officialUrl: 'https://code.claude.com/docs/en/installation',
    })
    expect(guide.command).toBe('irm https://claude.ai/install.ps1 | iex')
    expect(guide.alternatives[0]?.command).toContain('winget install')
  })

  it('uses the official Antigravity PowerShell installer and current docs', () => {
    const guide = getNativeRuntimeInstallGuide('gemini', 'win32')

    expect(guide).toMatchObject({
      shell: 'powershell',
      loginCommand: 'agy',
      officialUrl: 'https://antigravity.google/docs/cli/install',
    })
    expect(guide.command).toBe(
      'irm https://antigravity.google/cli/install.ps1 | iex',
    )
    expect(guide.alternatives[0]?.command).toContain('install.cmd')
    expect(guide.command).not.toMatch(/--skip-path|--skip-aliases/)
  })

  it('uses the native installer and Command key on macOS', () => {
    expect(getNativeRuntimeInstallGuide('claude', 'darwin')).toMatchObject({
      command: 'curl -fsSL https://claude.ai/install.sh | bash',
      loginCommand: 'claude auth login',
      shell: 'terminal',
      shellLabel: 'Terminal.app',
      pasteModifier: 'Command',
      expectedPath: '~/.local/bin/claude',
      officialUrl: 'https://code.claude.com/docs/en/installation',
    })
  })
})

describe('getUpdateDecision', () => {
  const discovery = (
    method: 'native' | 'winget' | 'homebrew' | 'custom',
    ambiguous = false,
  ) => ({
    provider: 'claude' as const,
    selectedPath: '/runtime/claude',
    selectedMethod: method,
    ambiguous,
    candidates: [
      {
        path: '/runtime/claude',
        canonicalPath: '/runtime/claude',
        method,
        evidence: ['fixture'],
        managerVerified: method === 'winget' || method === 'homebrew',
      },
    ],
  })

  it.each([
    ['native', 'native', 'update'],
    ['winget', 'winget', 'winget upgrade'],
    ['homebrew', 'homebrew', 'brew upgrade --cask claude-code'],
  ] as const)('uses the verified %s updater', (method, state, command) => {
    expect(getUpdateDecision('claude', discovery(method))).toMatchObject({
      state,
      command: expect.stringContaining(command),
    })
  })

  it('never guesses an updater for custom or multiple installations', () => {
    const custom = getUpdateDecision('claude', discovery('custom'))
    expect(custom.state).toBe('unknown')
    expect(custom.command).toBeUndefined()
    const ambiguous = getUpdateDecision('claude', discovery('native', true))
    expect(ambiguous.state).toBe('ambiguous')
    expect(ambiguous.command).toBeUndefined()
  })

  it('does not infer a package manager from a link-looking path alone', () => {
    const unverified = discovery('winget')
    const candidate = unverified.candidates[0]
    if (!candidate) throw new Error('Test fixture candidate is missing.')
    candidate.managerVerified = false

    const decision = getUpdateDecision('claude', unverified)

    expect(decision.state).toBe('unknown')
    expect(decision.command).toBeUndefined()
  })

  it('opens the selected Antigravity binary without inventing an update command', () => {
    const geminiDiscovery = {
      ...discovery('native'),
      provider: 'gemini' as const,
      selectedPath: '/runtime/agy',
      candidates: [
        {
          path: '/runtime/agy',
          canonicalPath: '/runtime/agy',
          method: 'native' as const,
          evidence: ['fixture'],
          managerVerified: false,
        },
      ],
    }
    const decision = getUpdateDecision('gemini', geminiDiscovery)
    expect(decision.state).toBe('background')
    expect(decision.command).toContain('/runtime/agy')
    expect(decision.command).not.toMatch(
      /agy\s+update|install\.(?:ps1|sh|cmd)/i,
    )
    expect(decision.reason).toContain('opportunity to run')
  })

  it('launches Antigravity from a fresh Smart Composer-owned temp directory', () => {
    const geminiDiscovery = {
      ...discovery('native'),
      provider: 'gemini' as const,
      selectedPath: '/runtime/agy',
      candidates: [],
    }
    const resolver = {
      discover: jest.fn(() => geminiDiscovery),
    } as unknown as NativeCliResolver
    const terminalLauncher = jest.fn()
    const workingDirectoryFactory = jest.fn(
      () => '/tmp/smart-composer-antigravity-update-fixture',
    )
    const service = new NativeRuntimeService(
      resolver,
      new NativeRuntimeStore(),
      jest.fn(),
      {},
      terminalLauncher,
      workingDirectoryFactory,
    )
    const decision = service.getUpdateDecision('gemini')

    service.openUpdateTerminal('gemini')

    expect(workingDirectoryFactory).toHaveBeenCalledTimes(1)
    expect(terminalLauncher).toHaveBeenCalledWith(
      decision.command,
      decision.shell,
      '/tmp/smart-composer-antigravity-update-fixture',
    )
    expect(decision.command).not.toMatch(/\supdate(?:\s|$)/i)
  })

  it('does not create a temp directory or launch when Gemini discovery is ambiguous', () => {
    const resolver = {
      discover: jest.fn(() => ({
        ...discovery('native', true),
        provider: 'gemini' as const,
        selectedPath: '/runtime/agy',
      })),
    } as unknown as NativeCliResolver
    const terminalLauncher = jest.fn()
    const workingDirectoryFactory = jest.fn(
      () => '/tmp/smart-composer-antigravity-update-fixture',
    )
    const service = new NativeRuntimeService(
      resolver,
      new NativeRuntimeStore(),
      jest.fn(),
      {},
      terminalLauncher,
      workingDirectoryFactory,
    )

    expect(() => service.openUpdateTerminal('gemini')).toThrow(
      /Multiple runtime installations/,
    )
    expect(workingDirectoryFactory).not.toHaveBeenCalled()
    expect(terminalLauncher).not.toHaveBeenCalled()
  })
})

describe('parseAntigravityModels', () => {
  it('parses a JSON model catalog with stable slugs', () => {
    expect(
      parseAntigravityModels(
        JSON.stringify({
          models: [
            {
              slug: 'gemini-3.5-flash',
              displayName: 'Gemini 3.5 Flash',
              description: 'Fast model',
            },
            {
              slug: 'gemini-3.1-pro',
              displayName: 'Gemini 3.1 Pro',
            },
          ],
        }),
      ),
    ).toEqual([
      {
        id: 'gemini-3.5-flash',
        label: 'Gemini 3.5 Flash',
        description: 'Fast model',
      },
      {
        id: 'gemini-3.1-pro',
        label: 'Gemini 3.1 Pro',
        description: undefined,
      },
    ])
  })

  it('parses the human-readable models command without headings', () => {
    expect(
      parseAntigravityModels(`
Available models
  Gemini 3.5 Flash (High)   gemini-3.5-flash
  Gemini 3.1 Pro (High)     gemini-3.1-pro
      `),
    ).toEqual([
      {
        id: 'gemini-3.5-flash',
        label: 'Gemini 3.5 Flash (High)',
      },
      {
        id: 'gemini-3.1-pro',
        label: 'Gemini 3.1 Pro (High)',
      },
    ])
  })

  it('deduplicates repeated catalog rows', () => {
    expect(
      parseAntigravityModels(
        JSON.stringify([
          { id: 'gemini-pro', name: 'Gemini Pro' },
          { id: 'gemini-pro', name: 'Gemini Pro duplicate' },
        ]),
      ),
    ).toHaveLength(1)
  })
})
