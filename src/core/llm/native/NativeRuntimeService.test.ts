jest.mock('obsidian', () => ({
  Platform: { isDesktop: true },
}))

jest.mock('@anthropic-ai/claude-agent-sdk', () => {
  throw new Error(
    'NativeRuntimeService must not initialize the Claude SDK while settings load.',
  )
})

import {
  getNativeRuntimeInstallGuide,
  parseAntigravityModels,
} from './NativeRuntimeService'

describe('getNativeRuntimeInstallGuide', () => {
  it('gives Windows beginners the official WinGet Claude command', () => {
    const guide = getNativeRuntimeInstallGuide('claude', 'win32')

    expect(guide).toMatchObject({
      shell: 'powershell',
      loginCommand: 'claude',
      officialUrl: 'https://code.claude.com/docs/en/installation',
    })
    expect(guide.command).toContain('winget install')
    expect(guide.command).toContain('Anthropic.ClaudeCode')
  })

  it('uses the official downloaded CMD installer without PowerShell eval', () => {
    const guide = getNativeRuntimeInstallGuide('gemini', 'win32')

    expect(guide).toMatchObject({
      shell: 'cmd',
      loginCommand: 'agy',
      officialUrl:
        'https://codelabs.developers.google.com/antigravity-cli-hands-on#1',
    })
    expect(guide.command).toContain(
      'https://antigravity.google/cli/install.cmd',
    )
    expect(guide.command).not.toMatch(/\biex\b|Invoke-Expression/i)
  })

  it('uses Homebrew for Claude on macOS', () => {
    expect(getNativeRuntimeInstallGuide('claude', 'darwin')).toEqual({
      command: 'brew install --cask claude-code',
      loginCommand: 'claude',
      shell: 'terminal',
      shellLabel: 'Terminal',
      officialUrl: 'https://code.claude.com/docs/en/installation',
    })
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
