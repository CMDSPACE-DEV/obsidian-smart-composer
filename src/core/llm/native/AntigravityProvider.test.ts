jest.mock('obsidian', () => ({
  Platform: { isDesktop: true },
}))

jest.mock('./NativeProcess', () => ({
  runNativeProcess: jest.fn(),
}))

import type { ChatModel } from '../../../types/chat-model.types'

import {
  AntigravityProvider,
  buildAntigravityCliArgs,
  extractAntigravityResultEvent,
  extractAntigravityTextDelta,
} from './AntigravityProvider'
import type { NativeCliResolver } from './NativeCliResolver'
import { runNativeProcess } from './NativeProcess'

const mockedRunNativeProcess = jest.mocked(runNativeProcess)

describe('AntigravityProvider official CLI protocol', () => {
  beforeEach(() => {
    mockedRunNativeProcess.mockReset()
  })

  it('passes the prompt as the value immediately following -p', () => {
    expect(
      buildAntigravityCliArgs({
        prompt: 'Reply with exactly GEMINI_OK',
        model: 'gemini-3.6-flash-medium',
        structured: false,
      }),
    ).toEqual([
      '-p',
      'Reply with exactly GEMINI_OK',
      '--output-format',
      'stream-json',
      '--model',
      'gemini-3.6-flash-medium',
      '--mode',
      'plan',
    ])
  })

  it('adds the structured schema after the prompt and model flags', () => {
    const args = buildAntigravityCliArgs({
      prompt: 'Use a tool',
      model: 'gemini-3.1-pro-high',
      structured: true,
    })

    expect(args.slice(0, 2)).toEqual(['-p', 'Use a tool'])
    expect(args).toContain('--json-schema')
    expect(args).toContain('plan')
  })

  it('parses Antigravity 1.1.8 nested stream events', () => {
    expect(
      extractAntigravityTextDelta({
        event: 'step_update',
        step_update: {
          step_type: 'agent_response',
          text_delta: 'GEMINI_OK\n',
        },
      }),
    ).toBe('GEMINI_OK\n')

    expect(
      extractAntigravityResultEvent({
        event: 'result',
        result: {
          status: 'SUCCESS',
          response: 'GEMINI_OK\n',
          usage: { input_tokens: 10, output_tokens: 2 },
        },
      }),
    ).toEqual({
      status: 'SUCCESS',
      response: 'GEMINI_OK\n',
      usage: { input_tokens: 10, output_tokens: 2 },
    })
  })

  it('preserves structured output returned by Antigravity 1.1.8', () => {
    expect(
      extractAntigravityResultEvent({
        event: 'result',
        result: {
          status: 'SUCCESS',
          response: '{"type":"final","text":"Done"}\n',
          structured_output: { type: 'final', text: 'Done' },
        },
      }),
    ).toEqual({
      status: 'SUCCESS',
      response: '{"type":"final","text":"Done"}\n',
      structured_output: { type: 'final', text: 'Done' },
    })
  })

  it('runs a Gemini request after a non-empty JSON catalog preflight', async () => {
    mockedRunNativeProcess.mockImplementation(async (options) => {
      if (options.args.join(' ') === 'models --json') {
        return {
          stdout: JSON.stringify({ models: [{ id: 'gemini-pro' }] }),
          stderr: '',
          exitCode: 0,
        }
      }
      options.onStdoutLine?.(
        JSON.stringify({
          event: 'step_update',
          step_update: { text_delta: 'GEMINI_OK' },
        }),
      )
      options.onStdoutLine?.(
        JSON.stringify({
          event: 'result',
          result: { status: 'SUCCESS', response: 'GEMINI_OK' },
        }),
      )
      return { stdout: '', stderr: '', exitCode: 0 }
    })
    const provider = createProvider({ PATH: '/safe/bin' })

    const stream = await provider.streamResponse(geminiModel, {
      model: geminiModel.model,
      stream: true,
      messages: [{ role: 'user', content: 'Return a test marker.' }],
    })
    let content = ''
    for await (const chunk of stream) {
      content += chunk.choices[0]?.delta.content ?? ''
    }

    expect(content).toBe('GEMINI_OK')
    expect(mockedRunNativeProcess).toHaveBeenCalledTimes(2)
    expect(mockedRunNativeProcess.mock.calls[0]?.[0]).toMatchObject({
      args: ['models', '--json'],
      env: { PATH: '/safe/bin' },
    })
    expect(mockedRunNativeProcess.mock.calls[1]?.[0].args.slice(0, 2)).toEqual([
      '-p',
      expect.any(String),
    ])
  })

  it('blocks an API-key override before any request-time CLI call', async () => {
    const secret = 'must-never-reach-antigravity'
    const provider = createProvider({
      PATH: '/safe/bin',
      GEMINI_API_KEY: secret,
    })

    let failure: unknown
    try {
      await provider.streamResponse(geminiModel, {
        model: geminiModel.model,
        stream: true,
        messages: [{ role: 'user', content: 'Do not run.' }],
      })
    } catch (error) {
      failure = error
    }

    expect(failure).toBeInstanceOf(Error)
    expect(String(failure)).toContain('Gemini Plan request blocked')
    expect(JSON.stringify(failure)).not.toContain(secret)
    expect(String(failure)).not.toContain(secret)
    expect(mockedRunNativeProcess).not.toHaveBeenCalled()
  })

  it('revalidates a legacy text catalog before running a request', async () => {
    mockedRunNativeProcess.mockImplementation(async (options) => {
      if (options.args.includes('--json')) {
        return {
          stdout: 'Gemini Pro  gemini-pro',
          stderr: '',
          exitCode: 0,
        }
      }
      if (options.args.join(' ') === 'models') {
        return {
          stdout: 'Gemini Pro  gemini-pro',
          stderr: '',
          exitCode: 0,
        }
      }
      options.onStdoutLine?.(
        JSON.stringify({
          event: 'result',
          result: { status: 'SUCCESS', response: 'FALLBACK_OK' },
        }),
      )
      return { stdout: '', stderr: '', exitCode: 0 }
    })
    const provider = createProvider({ PATH: '/safe/bin' })

    const stream = await provider.streamResponse(geminiModel, {
      model: geminiModel.model,
      stream: true,
      messages: [{ role: 'user', content: 'Return a fallback marker.' }],
    })
    let content = ''
    for await (const chunk of stream) {
      content += chunk.choices[0]?.delta.content ?? ''
    }

    expect(content).toBe('FALLBACK_OK')
    expect(
      mockedRunNativeProcess.mock.calls.map(([call]) => call.args),
    ).toEqual(expect.arrayContaining([['models', '--json'], ['models']]))
  })

  it('redacts nonzero request stdout and stderr from the thrown error', async () => {
    const secret =
      'private-account private-project C:\\Users\\private\\vault.md'
    mockedRunNativeProcess.mockImplementation(async (options) => {
      if (options.args.includes('models')) {
        return {
          stdout: JSON.stringify({ models: [{ id: 'gemini-pro' }] }),
          stderr: '',
          exitCode: 0,
        }
      }
      return { stdout: secret, stderr: secret, exitCode: 2 }
    })
    const provider = createProvider({ PATH: '/safe/bin' })

    const failure = await captureStreamFailure(provider)

    expect(String(failure)).toContain('Antigravity CLI request failed')
    expect(String(failure)).not.toContain(secret)
    expect(JSON.stringify(failure)).not.toContain('private-')
    expect(String(failure)).not.toContain('vault.md')
  })

  it('redacts remote result error and response while retaining an allowed status', async () => {
    const secret =
      'private-account private-project C:\\Users\\private\\vault.md'
    mockedRunNativeProcess.mockImplementation(async (options) => {
      if (options.args.includes('models')) {
        return {
          stdout: JSON.stringify({ models: [{ id: 'gemini-pro' }] }),
          stderr: '',
          exitCode: 0,
        }
      }
      options.onStdoutLine?.(
        JSON.stringify({
          event: 'result',
          result: {
            status: 'FAILED',
            error: secret,
            response: secret,
          },
        }),
      )
      return { stdout: '', stderr: '', exitCode: 0 }
    })
    const provider = createProvider({ PATH: '/safe/bin' })

    const failure = await captureStreamFailure(provider)

    expect(String(failure)).toContain('(FAILED)')
    expect(String(failure)).not.toContain(secret)
    expect(JSON.stringify(failure)).not.toContain('private-')
  })

  it('does not echo an unrecognized remote status string', async () => {
    const secret = 'FAILED-private-account-private-project'
    mockedRunNativeProcess.mockImplementation(async (options) => {
      if (options.args.includes('models')) {
        return {
          stdout: JSON.stringify({ models: [{ id: 'gemini-pro' }] }),
          stderr: '',
          exitCode: 0,
        }
      }
      options.onStdoutLine?.(
        JSON.stringify({
          event: 'result',
          result: { status: secret, error: secret },
        }),
      )
      return { stdout: '', stderr: '', exitCode: 0 }
    })
    const provider = createProvider({ PATH: '/safe/bin' })

    const failure = await captureStreamFailure(provider)

    expect(String(failure)).toContain('Antigravity CLI request failed')
    expect(String(failure)).not.toContain(secret)
  })
})

const geminiModel: Extract<ChatModel, { providerType: 'gemini-plan' }> = {
  providerType: 'gemini-plan',
  providerId: 'gemini-plan',
  id: 'gemini-pro',
  model: 'gemini-pro',
  enable: true,
}

function createProvider(environment: NodeJS.ProcessEnv): AntigravityProvider {
  const resolver = {
    resolve: () => '/runtime/agy',
  } as unknown as NativeCliResolver
  return new AntigravityProvider(
    { type: 'gemini-plan', id: 'gemini-plan' },
    resolver,
    environment,
  )
}

async function captureStreamFailure(
  provider: AntigravityProvider,
): Promise<unknown> {
  const stream = await provider.streamResponse(geminiModel, {
    model: geminiModel.model,
    stream: true,
    messages: [{ role: 'user', content: 'Return a test marker.' }],
  })
  try {
    for await (const _chunk of stream) {
      // Consume the async generator so the request process runs.
    }
  } catch (error) {
    return error instanceof Error
      ? error
      : new Error('Antigravity request failed with a non-Error value.')
  }
  throw new Error('Expected the Antigravity request to fail.')
}
