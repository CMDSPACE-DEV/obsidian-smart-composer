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

  it('rechecks a clean Pro login immediately before inference', async () => {
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
        options.onStdoutLine?.(
          JSON.stringify({
            type: 'result',
            subtype: 'success',
            result: 'subscription response',
          }),
        )
        return { stdout: '', stderr: '', exitCode: 0 }
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
    const stream = await provider.streamResponse(model(), request())
    let content = ''
    for await (const chunk of stream) {
      content += chunk.choices[0]?.delta.content ?? ''
    }

    expect(content).toBe('subscription response')
    expect(mockRunNativeProcess).toHaveBeenCalledTimes(2)
    const authEnvironment = mockRunNativeProcess.mock.calls[0]?.[0].env
    expect(authEnvironment.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBe('1')
    const inferenceEnvironment = mockRunNativeProcess.mock.calls[1]?.[0].env
    expect(inferenceEnvironment).toBe(authEnvironment)
  })

  it.each([
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_AUTH_TOKEN',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'ANTHROPIC_BASE_URL',
    'ANTHROPIC_CUSTOM_HEADERS',
    'ANTHROPIC_FOUNDRY_AUTH_TOKEN',
    'CLAUDE_CODE_USE_FOUNDRY',
    'ANTHROPIC_VERTEX_PROJECT_ID',
    'CLAUDE_CODE_USE_VERTEX',
  ])(
    'blocks a request-time %s override before invoking Claude',
    async (name) => {
      const environmentSource: NodeJS.ProcessEnv = { PATH: '/safe/bin' }
      const resolver = {
        resolve: () => '/runtime/claude',
      } as unknown as NativeCliResolver
      const provider = new ClaudeAgentProvider(
        { type: 'anthropic-plan', id: 'anthropic-plan' },
        resolver,
        environmentSource,
      )
      const secretValue = 'must-never-reach-claude'

      environmentSource[name] = secretValue

      let failure: unknown
      try {
        await provider.streamResponse(model(), request())
      } catch (error) {
        failure = error
      }

      expect(failure).toBeInstanceOf(Error)
      expect(String(failure)).toMatch(/request blocked/i)
      expect(String(failure)).not.toContain(secretValue)
      expect(mockRunNativeProcess).not.toHaveBeenCalled()
    },
  )
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
