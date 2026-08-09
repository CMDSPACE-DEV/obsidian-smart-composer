jest.mock('obsidian', () => ({
  Platform: { isDesktop: true },
}))

import { NativeCliResolver } from './NativeCliResolver'
import type { NativeProcessOptions } from './NativeProcess'
import type { RuntimeDiscovery } from './nativeRuntime.types'
import { NativeRuntimeService } from './NativeRuntimeService'
import { NativeRuntimeStore } from './NativeRuntimeStore'

describe('NativeRuntimeService structured diagnosis', () => {
  it('confirms WinGet updater evidence while keeping Claude billing blocked', async () => {
    const resolver = resolverWith(claudeDiscovery('winget'))
    const runner = jest.fn(async (options: NativeProcessOptions) => {
      if (options.executable === 'winget.exe') {
        expect(options.args).toEqual([
          'list',
          '--id',
          'Anthropic.ClaudeCode',
          '--exact',
        ])
        return { stdout: 'Anthropic.ClaudeCode', stderr: '', exitCode: 0 }
      }
      if (options.args[0] === '--version') {
        return { stdout: 'Claude Code 2.1.220', stderr: '', exitCode: 0 }
      }
      return {
        stdout: JSON.stringify({
          loggedIn: true,
          authMethod: 'claude.ai',
          apiProvider: 'firstParty',
          subscriptionType: 'pro',
        }),
        stderr: '',
        exitCode: 0,
      }
    })
    const service = new NativeRuntimeService(
      resolver,
      new NativeRuntimeStore(),
      runner,
      { PATH: '/safe' },
    )

    const snapshot = await service.diagnose('claude')

    expect(snapshot).toMatchObject({
      status: 'billing-blocked',
      installation: 'installed',
      authentication: 'billing-blocked',
      catalog: 'ready',
      update: 'winget',
      discovery: {
        candidates: [
          expect.objectContaining({
            method: 'winget',
            managerVerified: true,
          }),
        ],
      },
    })
    expect(service.getUpdateDecision('claude').command).toContain(
      'winget upgrade',
    )
  })

  it('keeps a successful Gemini catalog quota-unverified and non-ready', async () => {
    const resolver = resolverWith(geminiDiscovery())
    const runner = jest.fn(async (options: NativeProcessOptions) => {
      if (options.args[0] === '--version') {
        return { stdout: 'agy 1.1.11', stderr: '', exitCode: 0 }
      }
      return {
        stdout: JSON.stringify({
          models: [{ slug: 'gemini-pro', displayName: 'Gemini Pro' }],
        }),
        stderr: '',
        exitCode: 0,
      }
    })
    const service = new NativeRuntimeService(
      resolver,
      new NativeRuntimeStore(),
      runner,
      { PATH: '/safe' },
    )

    const snapshot = await service.diagnose('gemini')

    expect(snapshot).toMatchObject({
      status: 'quota-unverified',
      installation: 'installed',
      authentication: 'quota-unverified',
      catalog: 'ready',
      update: 'background',
      models: [{ id: 'gemini-pro', label: 'Gemini Pro' }],
    })
    expect(service.getUpdateDecision('gemini').command).toBeUndefined()
  })
})

function resolverWith(discovery: RuntimeDiscovery): NativeCliResolver {
  return {
    discover: () => discovery,
    resolve: () => discovery.selectedPath ?? null,
    setCustomPath: jest.fn(),
    getCustomPath: () => '',
  } as unknown as NativeCliResolver
}

function claudeDiscovery(method: 'native' | 'winget'): RuntimeDiscovery {
  return {
    provider: 'claude',
    selectedPath: 'C:\\runtime\\claude.exe',
    selectedMethod: method,
    ambiguous: false,
    candidates: [
      {
        path: 'C:\\runtime\\claude.exe',
        canonicalPath: 'C:\\runtime\\claude.exe',
        method,
        evidence: ['fixture path'],
      },
    ],
  }
}

function geminiDiscovery(): RuntimeDiscovery {
  return {
    provider: 'gemini',
    selectedPath: '/runtime/agy',
    selectedMethod: 'native',
    ambiguous: false,
    candidates: [
      {
        path: '/runtime/agy',
        canonicalPath: '/runtime/agy',
        method: 'native',
        evidence: ['fixture path'],
      },
    ],
  }
}
