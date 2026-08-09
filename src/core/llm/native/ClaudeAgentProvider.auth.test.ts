const mockRunNativeProcess = jest.fn()

jest.mock('obsidian', () => ({
  Platform: { isDesktop: true },
  requestUrl: jest.fn(),
}))

jest.mock('./NativeProcess', () => ({
  runNativeProcess: (options: unknown): Promise<unknown> =>
    mockRunNativeProcess(options) as Promise<unknown>,
}))

import type { ChatModel } from '../../../types/chat-model.types'
import type { LLMRequestStreaming } from '../../../types/llm/request'

import { ClaudeAgentProvider } from './ClaudeAgentProvider'
import { NativeCliResolver } from './NativeCliResolver'

describe('ClaudeAgentProvider billing-safe environment', () => {
  beforeEach(() => {
    mockRunNativeProcess.mockReset()
  })

  it('blocks an apparent Pro login before inference without effective provenance', async () => {
    mockRunNativeProcess.mockImplementation(
      async (options: {
        args: string[]
        env?: NodeJS.ProcessEnv
        onStdoutLine?: (line: string) => void
      }) => {
        if (options.args[0] === 'auth') {
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
        }
        throw new Error('Inference must not run')
      },
    )
    const resolver = {
      resolve: () => '/runtime/claude',
    } as unknown as NativeCliResolver
    const provider = new ClaudeAgentProvider(
      { type: 'anthropic-plan', id: 'anthropic-plan' },
      resolver,
      { PATH: '/safe/bin' },
    )
    await expect(provider.streamResponse(model(), request())).rejects.toThrow(
      /request blocked/i,
    )

    expect(mockRunNativeProcess).toHaveBeenCalledTimes(1)
    const authEnvironment = mockRunNativeProcess.mock.calls[0]?.[0].env
    expect(authEnvironment.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBe('1')
  })
})

function model(): Extract<ChatModel, { providerType: 'anthropic-plan' }> {
  return {
    providerType: 'anthropic-plan',
    providerId: 'anthropic-plan',
    id: 'claude-sonnet-latest (plan)',
    model: 'sonnet',
    thinking: {
      enabled: true,
      mode: 'adaptive',
      effort: 'high',
      display: 'summarized',
    },
  }
}

function request(): LLMRequestStreaming {
  return {
    model: 'sonnet',
    messages: [{ role: 'user', content: 'Reply safely.' }],
    stream: true,
  }
}
