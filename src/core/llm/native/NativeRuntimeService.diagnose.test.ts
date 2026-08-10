jest.mock('obsidian', () => ({
  Platform: { isDesktop: true },
}))

import { NativeCliResolver } from './NativeCliResolver'
import type { NativeProcessOptions } from './NativeProcess'
import type { RuntimeDiscovery } from './nativeRuntime.types'
import { NativeRuntimeService } from './NativeRuntimeService'
import { NativeRuntimeStore } from './NativeRuntimeStore'

describe('NativeRuntimeService structured diagnosis', () => {
  it('confirms WinGet updater evidence and a clean Claude Pro subscription', async () => {
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
      status: 'ready',
      installation: 'installed',
      authentication: 'subscription',
      catalog: 'ready',
      update: 'winget',
      authDecision: {
        status: 'subscription',
        allowed: true,
      },
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

  it('marks a successful Gemini catalog ready in compatibility mode', async () => {
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
      status: 'ready',
      installation: 'installed',
      authentication: 'subscription',
      catalog: 'ready',
      update: 'background',
      models: [{ id: 'gemini-pro', label: 'Gemini Pro' }],
      authDecision: {
        status: 'subscription',
        allowed: true,
      },
    })
    expect(snapshot.warning).toContain('compatibility mode')
    expect(snapshot.error).toBeUndefined()
    expect(service.getUpdateDecision('gemini').command).toBeUndefined()
  })

  it('keeps explicit Cloud metadata billing-blocked even with a model catalog', async () => {
    const resolver = resolverWith(geminiDiscovery())
    const runner = jest.fn(async (options: NativeProcessOptions) => {
      if (options.args[0] === '--version') {
        return { stdout: 'agy 1.1.11', stderr: '', exitCode: 0 }
      }
      return {
        stdout: JSON.stringify({
          models: [{ slug: 'gemini-pro', displayName: 'Gemini Pro' }],
          account: { authMethod: 'service_account' },
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
      status: 'billing-blocked',
      authentication: 'billing-blocked',
      catalog: 'ready',
      authDecision: {
        status: 'billing-blocked',
        allowed: false,
      },
    })
    expect(runner).toHaveBeenCalledTimes(2)
  })

  it('does not fallback around nonzero Cloud diagnostics', async () => {
    const resolver = resolverWith(geminiDiscovery())
    const runner = jest.fn(async (options: NativeProcessOptions) => {
      if (options.args[0] === '--version') {
        return { stdout: 'agy 1.1.11', stderr: '', exitCode: 0 }
      }
      return {
        stdout: '',
        stderr: JSON.stringify({
          error: 'Google Cloud project private-project is active',
        }),
        exitCode: 2,
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
      status: 'billing-blocked',
      authentication: 'billing-blocked',
      catalog: 'error',
      authDecision: { allowed: false },
    })
    expect(JSON.stringify(snapshot)).not.toContain('private-project')
    expect(runner).toHaveBeenCalledTimes(2)
  })

  it('prioritizes signed-out metadata over a readable model catalog', async () => {
    const resolver = resolverWith(geminiDiscovery())
    const runner = jest.fn(async (options: NativeProcessOptions) => {
      if (options.args[0] === '--version') {
        return { stdout: 'agy 1.1.11', stderr: '', exitCode: 0 }
      }
      return {
        stdout: JSON.stringify({
          loggedIn: false,
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
      status: 'login-required',
      authentication: 'login-required',
      catalog: 'ready',
      authDecision: {
        status: 'login-required',
        allowed: false,
      },
    })
    expect(runner).toHaveBeenCalledTimes(2)
  })

  it('uses a parsed legacy text catalog for diagnosis only', async () => {
    const resolver = resolverWith(geminiDiscovery())
    const runner = jest.fn(async (options: NativeProcessOptions) => {
      if (options.args[0] === '--version') {
        return { stdout: 'agy 1.1.11', stderr: '', exitCode: 0 }
      }
      if (options.args.includes('--json')) {
        return { stdout: '', stderr: 'unknown option', exitCode: 2 }
      }
      return {
        stdout: 'Gemini Pro  gemini-pro',
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
      status: 'ready',
      authentication: 'subscription',
      catalog: 'ready',
      authDecision: { allowed: true },
    })
    expect(snapshot.warning).toContain('compatibility mode')
  })

  it('retries exit-zero non-JSON output with the text catalog command', async () => {
    const resolver = resolverWith(geminiDiscovery())
    const runner = jest.fn(async (options: NativeProcessOptions) => {
      if (options.args[0] === '--version') {
        return { stdout: 'agy 1.1.11', stderr: '', exitCode: 0 }
      }
      return {
        stdout: 'Gemini Pro  gemini-pro',
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
      status: 'ready',
      authentication: 'subscription',
      catalog: 'ready',
      authDecision: { allowed: true },
    })
    expect(runner).toHaveBeenCalledTimes(3)
    expect(runner.mock.calls[2]?.[0].args).toEqual(['models'])
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
