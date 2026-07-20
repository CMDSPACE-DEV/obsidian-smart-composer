import { RequestMessage } from '../../types/llm/request'

import { ClaudeCodeMessageAdapter } from './claudeCodeMessageAdapter'

describe('ClaudeCodeMessageAdapter', () => {
  it('does not send thinking for Opus 4.8 when model settings omit it', async () => {
    const requestBody = await captureRequestBody({
      model: 'claude-opus-4-8',
    })

    expect(requestBody.model).toBe('claude-opus-4-8')
    expect(requestBody.thinking).toBeUndefined()
    expect(requestBody.max_tokens).toBe(8192)
  })

  it('sends thinking for Sonnet 4.6 when model settings enable it', async () => {
    const requestBody = await captureRequestBody({
      model: 'claude-sonnet-4-6',
      thinking: {
        enabled: true,
        budget_tokens: 8192,
      },
    })

    expect(requestBody.model).toBe('claude-sonnet-4-6')
    expect(requestBody.thinking).toEqual({
      type: 'enabled',
      budget_tokens: 8192,
    })
    expect(requestBody.max_tokens).toBe(16384)
  })

  it.each(['low', 'medium', 'high', 'xhigh', 'max'] as const)(
    'sends Sonnet 5 adaptive thinking with %s effort',
    async (effort) => {
      const requestBody = await captureRequestBody({
        model: 'claude-sonnet-5',
        temperature: 0,
        topP: 0.5,
        thinking: {
          enabled: true,
          mode: 'adaptive',
          effort,
          display: 'summarized',
        },
      })

      expect(requestBody.thinking).toEqual({
        type: 'adaptive',
        display: 'summarized',
      })
      expect(requestBody.output_config).toEqual({ effort })
      expect(requestBody.max_tokens).toBe(32768)
      expect(requestBody.temperature).toBeUndefined()
      expect(requestBody.top_p).toBeUndefined()
    },
  )

  it('uses safe adaptive defaults when Sonnet 5 settings are absent', async () => {
    const requestBody = await captureRequestBody({
      model: 'claude-sonnet-5',
    })

    expect(requestBody.thinking).toEqual({
      type: 'adaptive',
      display: 'summarized',
    })
    expect(requestBody.output_config).toEqual({ effort: 'high' })
  })

  it('supports omitted summaries and explicit max tokens for Sonnet 5', async () => {
    const requestBody = await captureRequestBody({
      model: 'claude-sonnet-5',
      maxTokens: 512,
      thinking: {
        enabled: true,
        mode: 'adaptive',
        effort: 'low',
        display: 'omitted',
      },
    })

    expect(requestBody.thinking).toEqual({
      type: 'adaptive',
      display: 'omitted',
    })
    expect(requestBody.max_tokens).toBe(512)
  })

  it('explicitly disables Sonnet 5 thinking without sending effort', async () => {
    const requestBody = await captureRequestBody({
      model: 'claude-sonnet-5',
      thinking: {
        enabled: false,
        mode: 'adaptive',
        effort: 'high',
        display: 'summarized',
      },
    })

    expect(requestBody.thinking).toEqual({ type: 'disabled' })
    expect(requestBody.output_config).toBeUndefined()
  })

  it('replays two saved thinking and tool-result turns in order', async () => {
    const thinkingBlocks = [
      {
        type: 'thinking' as const,
        thinking: 'summary',
        signature: 'signed-summary',
      },
    ]
    const messages: RequestMessage[] = [
      {
        role: 'assistant',
        content: '',
        providerMetadata: { anthropic: { thinkingBlocks } },
        tool_calls: [{ id: 'tool-1', name: 'lookup', arguments: '{}' }],
      },
      {
        role: 'tool',
        tool_call: { id: 'tool-1', name: 'lookup' },
        content: 'result-1',
      },
      {
        role: 'assistant',
        content: '',
        providerMetadata: { anthropic: { thinkingBlocks } },
        tool_calls: [{ id: 'tool-2', name: 'lookup', arguments: '{}' }],
      },
      {
        role: 'tool',
        tool_call: { id: 'tool-2', name: 'lookup' },
        content: 'result-2',
      },
    ]

    const requestBody = await captureRequestBody({
      model: 'claude-sonnet-5',
      messages,
      thinking: {
        enabled: true,
        mode: 'adaptive',
        effort: 'high',
        display: 'summarized',
      },
    })

    expect(requestBody.messages).toEqual([
      {
        role: 'assistant',
        content: [
          ...thinkingBlocks,
          { type: 'tool_use', id: 'tool-1', name: 'lookup', input: {} },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'tool-1', content: 'result-1' },
        ],
      },
      {
        role: 'assistant',
        content: [
          ...thinkingBlocks,
          { type: 'tool_use', id: 'tool-2', name: 'lookup', input: {} },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'tool-2', content: 'result-2' },
        ],
      },
    ])
  })
})

type CaptureRequestBodyOptions = {
  model: string
  messages?: RequestMessage[]
  maxTokens?: number
  temperature?: number
  topP?: number
  thinking?: Parameters<ClaudeCodeMessageAdapter['generateResponse']>[3]
}

async function captureRequestBody({
  model,
  messages = [],
  maxTokens,
  temperature,
  topP,
  thinking,
}: CaptureRequestBodyOptions): Promise<Record<string, unknown>> {
  let requestBody: Record<string, unknown> | undefined
  const fetchFn = jest.fn(async (_url, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
    throw new Error('stop')
  }) as unknown as typeof fetch

  const adapter = new ClaudeCodeMessageAdapter({
    endpoint: 'https://example.com/v1/messages',
    fetchFn,
  })

  await expect(
    adapter.generateResponse(
      {
        model,
        messages,
        max_tokens: maxTokens,
        temperature,
        top_p: topP,
      },
      undefined,
      {},
      thinking,
    ),
  ).rejects.toThrow('stop')

  if (!requestBody) {
    throw new Error('Request body was not captured')
  }
  return requestBody
}
