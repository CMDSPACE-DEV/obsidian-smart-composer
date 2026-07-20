import type {
  Message,
  MessageStreamEvent,
} from '@anthropic-ai/sdk/resources/messages'

import { AnthropicProvider } from './anthropic'

describe('Anthropic thinking block handling', () => {
  it('captures and exactly replays non-streaming thinking blocks', () => {
    const response = AnthropicProvider.parseNonStreamingResponse({
      id: 'message-1',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-5',
      content: [
        {
          type: 'thinking',
          thinking: 'private summary',
          signature: 'signed-thinking',
        },
        {
          type: 'redacted_thinking',
          data: 'encrypted-redaction',
        },
        { type: 'text', text: 'answer', citations: null },
      ],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: {
        input_tokens: 10,
        output_tokens: 4,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    } satisfies Message)

    const providerMetadata = response.choices[0].message.providerMetadata
    expect(providerMetadata?.anthropic?.thinkingBlocks).toEqual([
      {
        type: 'thinking',
        thinking: 'private summary',
        signature: 'signed-thinking',
      },
      {
        type: 'redacted_thinking',
        data: 'encrypted-redaction',
      },
    ])

    expect(
      AnthropicProvider.parseRequestMessage({
        role: 'assistant',
        content: 'answer',
        providerMetadata,
        tool_calls: [
          {
            id: 'tool-1',
            name: 'lookup',
            arguments: '{"query":"test"}',
          },
        ],
      }),
    ).toEqual({
      role: 'assistant',
      content: [
        {
          type: 'thinking',
          thinking: 'private summary',
          signature: 'signed-thinking',
        },
        {
          type: 'redacted_thinking',
          data: 'encrypted-redaction',
        },
        { type: 'text', text: 'answer' },
        {
          type: 'tool_use',
          id: 'tool-1',
          name: 'lookup',
          input: { query: 'test' },
        },
      ],
    })
  })

  it('captures streamed signatures and treats message usage as cumulative', async () => {
    const chunks = await collect(
      AnthropicProvider.streamResponseGenerator(
        eventStream([
          messageStartEvent(),
          {
            type: 'content_block_start',
            index: 0,
            content_block: {
              type: 'thinking',
              thinking: '',
              signature: '',
            },
          },
          {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'thinking_delta', thinking: 'streamed thought' },
          },
          {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'signature_delta', signature: 'stream-signature' },
          },
          { type: 'content_block_stop', index: 0 },
          {
            type: 'content_block_start',
            index: 1,
            content_block: {
              type: 'redacted_thinking',
              data: 'stream-redaction',
            },
          },
          { type: 'content_block_stop', index: 1 },
          messageDeltaEvent(5),
          messageDeltaEvent(7),
          { type: 'message_stop' },
        ]),
      ),
    )

    const metadata = chunks
      .flatMap((chunk) => chunk.choices)
      .find((choice) => choice.delta.providerMetadata)?.delta.providerMetadata
    expect(metadata?.anthropic?.thinkingBlocks).toEqual([
      {
        type: 'thinking',
        thinking: 'streamed thought',
        signature: 'stream-signature',
      },
      {
        type: 'redacted_thinking',
        data: 'stream-redaction',
      },
    ])
    expect(chunks[chunks.length - 1].usage).toEqual({
      prompt_tokens: 11,
      completion_tokens: 7,
      total_tokens: 18,
    })
  })

  it('rejects replay when a thinking signature is incomplete', () => {
    expect(() =>
      AnthropicProvider.parseRequestMessage({
        role: 'assistant',
        content: 'answer',
        providerMetadata: {
          anthropic: {
            thinkingBlocks: [
              { type: 'thinking', thinking: 'thought', signature: '' },
            ],
          },
        },
      }),
    ).toThrow('missing its required signature')
  })

  it('rejects a stream that ends before message_stop', async () => {
    await expect(
      collect(
        AnthropicProvider.streamResponseGenerator(
          eventStream([
            messageStartEvent(),
            {
              type: 'content_block_start',
              index: 0,
              content_block: {
                type: 'thinking',
                thinking: 'partial thought',
                signature: 'partial-signature',
              },
            },
          ]),
        ),
      ),
    ).rejects.toThrow('ended before message_stop')
  })

  it('rejects a stopped stream with a missing thinking signature', async () => {
    await expect(
      collect(
        AnthropicProvider.streamResponseGenerator(
          eventStream([
            messageStartEvent(),
            {
              type: 'content_block_start',
              index: 0,
              content_block: {
                type: 'thinking',
                thinking: 'unsigned thought',
                signature: '',
              },
            },
            { type: 'message_stop' },
          ]),
        ),
      ),
    ).rejects.toThrow('missing its required signature')
  })
})

function messageStartEvent(): MessageStreamEvent {
  return {
    type: 'message_start',
    message: {
      id: 'message-1',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-5',
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: 11,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
  }
}

function messageDeltaEvent(outputTokens: number): MessageStreamEvent {
  return {
    type: 'message_delta',
    delta: { stop_reason: null, stop_sequence: null },
    usage: { output_tokens: outputTokens },
  }
}

async function* eventStream(
  events: MessageStreamEvent[],
): AsyncIterable<MessageStreamEvent> {
  yield* events
}

async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = []
  for await (const value of stream) {
    values.push(value)
  }
  return values
}
