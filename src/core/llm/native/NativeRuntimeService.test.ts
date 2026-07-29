jest.mock('obsidian', () => ({
  Platform: { isDesktop: true },
}))

import {
  getNativeRuntimeInstallAction,
  parseAntigravityModels,
} from './NativeRuntimeService'

describe('getNativeRuntimeInstallAction', () => {
  it('uses the official WinGet package for Claude on Windows', () => {
    expect(getNativeRuntimeInstallAction('claude', 'win32')).toEqual({
      type: 'terminal',
      command:
        'winget install --id Anthropic.ClaudeCode --exact --source winget',
    })
  })

  it('never executes the remote Antigravity installer script', () => {
    expect(getNativeRuntimeInstallAction('gemini', 'win32')).toEqual({
      type: 'guide',
      url: 'https://codelabs.developers.google.com/antigravity-cli-hands-on#1',
    })
  })

  it('opens the Claude install guide when WinGet is unavailable by platform', () => {
    expect(getNativeRuntimeInstallAction('claude', 'darwin')).toEqual({
      type: 'guide',
      url: 'https://code.claude.com/docs/en/installation',
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
