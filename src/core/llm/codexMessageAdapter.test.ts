import {
  LLMRequestNonStreaming,
  LLMRequestStreaming,
} from '../../types/llm/request'

import { CodexMessageAdapter, CodexRequestError } from './codexMessageAdapter'

const MODELS = ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'] as const
const EFFORTS = ['none', 'low', 'medium', 'high', 'xhigh', 'max'] as const

type CapturedBody = Record<string, unknown> & {
  input?: unknown[]
  reasoning?: Record<string, unknown>
}

function makeCapturingFetch(
  onBody: (body: CapturedBody) => void,
): typeof fetch {
  return jest.fn(async (_url, init) => {
    onBody(JSON.parse(String(init?.body)) as CapturedBody)
    throw new Error('stop after capture')
  }) as unknown as typeof fetch
}

function makeSseFetch(
  events: unknown[],
  onBody?: (body: CapturedBody) => void,
): typeof fetch {
  return jest.fn(async (_url, init) => {
    onBody?.(JSON.parse(String(init?.body)) as CapturedBody)
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            events
              .map((event) => `data: ${JSON.stringify(event)}\n\n`)
              .join(''),
          ),
        )
        controller.close()
      },
    })
    return {
      ok: true,
      status: 200,
      body,
    } as Response
  }) as unknown as typeof fetch
}

function responsePayload({
  model = 'gpt-5.6-sol',
  output = [],
  outputText = '',
}: {
  model?: string
  output?: unknown[]
  outputText?: string
} = {}): Record<string, unknown> {
  return {
    id: 'resp_1',
    created_at: 123,
    object: 'response',
    status: 'completed',
    model,
    output,
    output_text: outputText,
    error: null,
    incomplete_details: null,
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      total_tokens: 15,
    },
  }
}

describe('CodexMessageAdapter', () => {
  it.each(
    MODELS.flatMap((model) =>
      EFFORTS.map((effort) => [model, effort] as const),
    ),
  )('serializes %s with %s effort', async (model, effort) => {
    let captured: CapturedBody | undefined
    const adapter = new CodexMessageAdapter({
      endpoint: 'https://example.com/codex/responses',
      fetchFn: makeCapturingFetch((body) => {
        captured = body
      }),
    })
    const request = {
      model,
      messages: [],
      reasoning_effort: effort,
      reasoning_summary: 'auto',
      max_tokens: 4096,
    } as LLMRequestNonStreaming

    await expect(adapter.generateResponse(request)).rejects.toThrow(
      'stop after capture',
    )

    expect(captured).toMatchObject({
      model,
      stream: true,
      store: false,
      include: ['reasoning.encrypted_content'],
      reasoning:
        effort === 'none' ? { effort: 'none' } : { effort, summary: 'auto' },
    })
    expect(captured).not.toHaveProperty('max_tokens')
    expect(captured).not.toHaveProperty('max_output_tokens')
  })

  it('captures and replays encrypted reasoning output in original order', async () => {
    const outputItems = [
      {
        id: 'reasoning_1',
        type: 'reasoning',
        status: 'completed',
        summary: [{ type: 'summary_text', text: 'Checked the inputs.' }],
        encrypted_content: 'encrypted-reasoning-payload',
      },
      {
        id: 'function_1',
        type: 'function_call',
        status: 'completed',
        call_id: 'call_1',
        name: 'lookup',
        arguments: '{"query":"obsidian"}',
      },
    ]
    const completed = responsePayload({ output: outputItems })
    const firstAdapter = new CodexMessageAdapter({
      fetchFn: makeSseFetch([
        { type: 'response.created', response: responsePayload() },
        { type: 'response.completed', response: completed },
      ]),
    })

    const firstResponse = await firstAdapter.generateResponse({
      model: 'gpt-5.6-sol',
      messages: [],
    })
    const metadata = firstResponse.choices[0].message.providerMetadata
    expect(metadata?.openaiCodex).toEqual({
      model: 'gpt-5.6-sol',
      outputItems,
    })

    let replayBody: CapturedBody | undefined
    const replayAdapter = new CodexMessageAdapter({
      fetchFn: makeCapturingFetch((body) => {
        replayBody = body
      }),
    })
    await expect(
      replayAdapter.generateResponse({
        model: 'gpt-5.6-sol',
        messages: [
          {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'call_1',
                name: 'lookup',
                arguments: '{"query":"obsidian"}',
              },
            ],
            providerMetadata: metadata,
          },
          {
            role: 'tool',
            tool_call: {
              id: 'call_1',
              name: 'lookup',
              arguments: '{"query":"obsidian"}',
            },
            content: '{"result":"ok"}',
          },
        ],
      }),
    ).rejects.toThrow('stop after capture')

    expect(replayBody?.input).toEqual([
      ...outputItems,
      {
        type: 'function_call_output',
        call_id: 'call_1',
        output: '{"result":"ok"}',
      },
    ])
  })

  it('replays two saved Codex tool turns in sequence', async () => {
    const firstOutput = [
      {
        id: 'reasoning-1',
        type: 'reasoning',
        summary: [],
        encrypted_content: 'encrypted-1',
      },
      {
        id: 'function-1',
        type: 'function_call',
        call_id: 'call-1',
        name: 'lookup',
        arguments: '{"step":1}',
      },
    ]
    const secondOutput = [
      {
        id: 'reasoning-2',
        type: 'reasoning',
        summary: [],
        encrypted_content: 'encrypted-2',
      },
      {
        id: 'function-2',
        type: 'function_call',
        call_id: 'call-2',
        name: 'lookup',
        arguments: '{"step":2}',
      },
    ]
    let captured: CapturedBody | undefined
    const adapter = new CodexMessageAdapter({
      fetchFn: makeCapturingFetch((body) => {
        captured = body
      }),
    })

    await expect(
      adapter.generateResponse({
        model: 'gpt-5.6-sol',
        messages: [
          {
            role: 'assistant',
            content: '',
            providerMetadata: {
              openaiCodex: {
                model: 'gpt-5.6-sol',
                outputItems: firstOutput,
              },
            },
          },
          {
            role: 'tool',
            tool_call: { id: 'call-1', name: 'lookup' },
            content: 'result-1',
          },
          {
            role: 'assistant',
            content: '',
            providerMetadata: {
              openaiCodex: {
                model: 'gpt-5.6-sol',
                outputItems: secondOutput,
              },
            },
          },
          {
            role: 'tool',
            tool_call: { id: 'call-2', name: 'lookup' },
            content: 'result-2',
          },
          { role: 'user', content: 'finish' },
        ],
      }),
    ).rejects.toThrow('stop after capture')

    expect(captured?.input).toEqual([
      ...firstOutput,
      {
        type: 'function_call_output',
        call_id: 'call-1',
        output: 'result-1',
      },
      ...secondOutput,
      {
        type: 'function_call_output',
        call_id: 'call-2',
        output: 'result-2',
      },
      {
        role: 'user',
        content: [{ type: 'input_text', text: 'finish' }],
      },
    ])
  })

  it('does not emit reasoning summary done text after deltas', async () => {
    const reasoningItem = {
      id: 'reasoning_1',
      type: 'reasoning',
      status: 'completed',
      summary: [{ type: 'summary_text', text: 'One summary' }],
      encrypted_content: 'encrypted',
    }
    const adapter = new CodexMessageAdapter({
      fetchFn: makeSseFetch([
        {
          type: 'response.created',
          response: responsePayload({ model: 'gpt-5.6-terra' }),
        },
        {
          type: 'response.reasoning_summary_text.delta',
          item_id: 'reasoning_1',
          output_index: 0,
          summary_index: 0,
          delta: 'One summary',
        },
        {
          type: 'response.reasoning_summary_text.done',
          item_id: 'reasoning_1',
          output_index: 0,
          summary_index: 0,
          text: 'One summary',
        },
        {
          type: 'response.completed',
          response: responsePayload({
            model: 'gpt-5.6-terra',
            output: [reasoningItem],
          }),
        },
      ]),
    })

    const stream = await adapter.streamResponse({
      stream: true,
      model: 'gpt-5.6-terra',
      messages: [],
    })
    const chunks = []
    for await (const chunk of stream) {
      chunks.push(chunk)
    }

    const reasoningChunks = chunks
      .map((chunk) => chunk.choices[0]?.delta.reasoning)
      .filter((value): value is string => typeof value === 'string')
    const finalChunk = chunks[chunks.length - 1]
    expect(reasoningChunks).toEqual(['One summary'])
    expect(finalChunk?.model).toBe('gpt-5.6-terra')
    expect(finalChunk?.choices[0]?.delta.providerMetadata?.openaiCodex).toEqual(
      {
        model: 'gpt-5.6-terra',
        outputItems: [reasoningItem],
      },
    )
  })

  it('fails when Codex silently substitutes a different GPT-5.6 tier', async () => {
    const adapter = new CodexMessageAdapter({
      fetchFn: makeSseFetch([
        {
          type: 'response.created',
          response: responsePayload({ model: 'gpt-5.6-sol' }),
        },
      ]),
    })

    await expect(
      adapter.generateResponse({
        model: 'gpt-5.6-terra',
        messages: [],
        reasoning_effort: 'low',
      }),
    ).rejects.toMatchObject({
      name: 'CodexRequestError',
      code: 'model_mismatch',
      model: 'gpt-5.6-terra',
    })
  })

  it('fails non-streaming and streaming calls when the SSE ends early', async () => {
    const events = [
      {
        type: 'response.created',
        response: responsePayload({ model: 'gpt-5.6-sol' }),
      },
    ]
    const adapter = new CodexMessageAdapter({ fetchFn: makeSseFetch(events) })

    await expect(
      adapter.generateResponse({
        model: 'gpt-5.6-sol',
        messages: [],
        reasoning_effort: 'medium',
      }),
    ).rejects.toThrow('Codex stream ended before a terminal response event')

    const stream = await adapter.streamResponse({
      stream: true,
      model: 'gpt-5.6-sol',
      messages: [],
      reasoning_effort: 'medium',
    })
    await expect(async () => {
      for await (const _chunk of stream) {
        // Consume the stream to surface terminal validation.
      }
    }).rejects.toThrow('Codex stream ended before a terminal response event')
  })

  it('refuses to replay reasoning without encrypted content', async () => {
    const adapter = new CodexMessageAdapter({
      fetchFn: makeCapturingFetch(() => {
        throw new Error('fetch should not be reached')
      }),
    })

    await expect(
      adapter.generateResponse({
        model: 'gpt-5.6-sol',
        messages: [
          {
            role: 'assistant',
            content: '',
            providerMetadata: {
              openaiCodex: {
                model: 'gpt-5.6-sol',
                outputItems: [
                  {
                    id: 'reasoning-1',
                    type: 'reasoning',
                    summary: [],
                    encrypted_content: null,
                  },
                ],
              },
            },
          },
        ],
      }),
    ).rejects.toThrow('missing encrypted reasoning')
  })

  it('adds structured model, effort, and HTTP status context', async () => {
    const fetchFn = jest.fn(async () => {
      return {
        ok: false,
        status: 429,
        headers: {
          get: (name: string) =>
            name === 'x-request-id' ? 'codex-request-id' : null,
        },
        text: async () => 'rate limited',
        body: null,
      } as Response
    }) as unknown as typeof fetch
    const adapter = new CodexMessageAdapter({ fetchFn })
    const request = {
      model: 'gpt-5.6-luna',
      messages: [],
      reasoning_effort: 'max',
      stream: true,
    } as unknown as LLMRequestStreaming

    let caught: unknown
    try {
      await adapter.streamResponse(request)
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(CodexRequestError)
    expect(caught).toMatchObject({
      model: 'gpt-5.6-luna',
      reasoningEffort: 'max',
      status: 429,
      responseBody: 'rate limited',
      requestId: 'codex-request-id',
    })
    expect((caught as Error).message).not.toContain('Bearer')
  })
})
