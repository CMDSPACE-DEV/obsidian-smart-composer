import {
  buildAntigravityCliArgs,
  extractAntigravityResultEvent,
  extractAntigravityTextDelta,
} from './AntigravityProvider'

describe('AntigravityProvider official CLI protocol', () => {
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
})
