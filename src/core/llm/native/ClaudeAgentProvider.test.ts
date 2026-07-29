import {
  buildClaudeCliArgs,
  parseClaudeDecision,
  parseClaudeStreamEvent,
} from './ClaudeAgentProvider'

describe('ClaudeAgentProvider official CLI protocol', () => {
  it('uses print-mode stream JSON without loading built-in tools', () => {
    const args = buildClaudeCliArgs({
      model: {
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
      },
      systemPrompt: 'System prompt',
      structured: false,
      allowImageRead: false,
    })

    expect(args[0]).toBe('-p')
    expect(args).toContain('--verbose')
    expect(args).toContain('stream-json')
    expect(args).toContain('--tools=')
    expect(args).toContain('sonnet')
  })

  it('parses Claude Code text and thinking deltas', () => {
    expect(
      parseClaudeStreamEvent({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'Hello' },
        },
      }),
    ).toEqual({ content: 'Hello' })

    expect(
      parseClaudeStreamEvent({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'thinking_delta', thinking: 'Checking' },
        },
      }),
    ).toEqual({ reasoning: 'Checking' })
  })

  it('parses the final structured output and usage', () => {
    expect(
      parseClaudeStreamEvent({
        type: 'result',
        subtype: 'success',
        is_error: false,
        structured_output: { type: 'final', text: 'Done' },
        usage: {
          input_tokens: 5,
          cache_read_input_tokens: 7,
          output_tokens: 3,
        },
      }),
    ).toEqual({
      finalValue: { type: 'final', text: 'Done' },
      usage: {
        prompt_tokens: 12,
        completion_tokens: 3,
        total_tokens: 15,
      },
      error: undefined,
    })
  })

  it('accepts fenced structured tool decisions as a compatibility fallback', () => {
    expect(
      parseClaudeDecision(
        '```json\n{"type":"tool_call","tool":"search","arguments":{"q":"AI"}}\n```',
      ),
    ).toEqual({
      type: 'tool_call',
      tool: 'search',
      arguments: { q: 'AI' },
    })
  })
})
