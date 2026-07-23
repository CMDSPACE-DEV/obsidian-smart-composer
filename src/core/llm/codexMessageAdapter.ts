import type {
  FunctionTool,
  ResponseUsage as OpenAIResponseUsage,
  Response,
  ResponseCreateParamsBase,
  ResponseInput,
  ResponseInputItem,
  ResponseInputMessageContentList,
  ResponseOutputItem,
  ResponseReasoningItem,
  ResponseStreamEvent,
} from 'openai/resources/responses/responses'

import { CODEX_RESPONSES_ENDPOINT } from '../../constants'
import {
  LLMOptions,
  LLMRequest,
  LLMRequestNonStreaming,
  LLMRequestStreaming,
  RequestMessage,
} from '../../types/llm/request'
import {
  LLMResponseNonStreaming,
  LLMResponseStreaming,
  ResponseProviderMetadata,
  ResponseUsage,
  ToolCall,
  ToolCallDelta,
} from '../../types/llm/response'
import {
  LLMHttpError,
  StreamSource,
  postStream,
} from '../../utils/llm/httpTransport'
import { parseJsonSseStream } from '../../utils/llm/sse'

type CodexAdapterConfig = {
  endpoint?: string
  fetchFn?: typeof fetch
}

type CodexReasoningEffort =
  | 'none'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max'

type CodexRequest = LLMRequest & {
  reasoning_effort?: CodexReasoningEffort
}

type CodexResponseCreateParams = Omit<ResponseCreateParamsBase, 'reasoning'> & {
  reasoning?: {
    effort?: CodexReasoningEffort
    summary?: LLMRequest['reasoning_summary']
  }
}

type CodexProviderMetadata = {
  openaiCodex: {
    outputItems: unknown[]
    model: string
  }
}

export class CodexRequestError extends Error {
  readonly model: string
  readonly reasoningEffort?: string
  readonly status?: number
  readonly responseBody?: string
  readonly requestId?: string
  readonly code?: string | null
  readonly param?: string | null
  readonly originalError?: unknown

  constructor({
    message,
    model,
    reasoningEffort,
    status,
    responseBody,
    requestId,
    code,
    param,
    originalError,
  }: {
    message: string
    model: string
    reasoningEffort?: string
    status?: number
    responseBody?: string
    requestId?: string
    code?: string | null
    param?: string | null
    originalError?: unknown
  }) {
    const effortContext = reasoningEffort ? `, effort=${reasoningEffort}` : ''
    super(`${message} (model=${model}${effortContext})`)
    this.name = 'CodexRequestError'
    this.model = model
    this.reasoningEffort = reasoningEffort
    this.status = status
    this.responseBody = responseBody
    this.requestId = requestId
    this.code = code
    this.param = param
    this.originalError = originalError
    Object.setPrototypeOf(this, CodexRequestError.prototype)
  }
}

export class CodexMessageAdapter {
  private endpoint: string
  private fetchFn?: typeof fetch

  constructor(config: CodexAdapterConfig = {}) {
    this.endpoint = config.endpoint ?? CODEX_RESPONSES_ENDPOINT
    this.fetchFn = config.fetchFn
  }

  async generateResponse(
    request: LLMRequestNonStreaming,
    options?: LLMOptions,
    headers?: Record<string, string>,
  ): Promise<LLMResponseNonStreaming> {
    // Codex Responses require stream: true; build a snapshot from the stream.
    const body = this.buildRequestBody({ request, stream: true })
    let stream: StreamSource
    try {
      stream = await postStream(this.endpoint, body, {
        headers,
        signal: options?.signal,
        fetchFn: this.fetchFn,
      })
    } catch (error) {
      throw toCodexRequestError(error, request)
    }

    const summaryTextByPart = new Map<string, string>()
    let responsePayload: Response | undefined
    let receivedTerminalEvent = false
    for await (const chunk of parseJsonSseStream<ResponseStreamEvent>(stream)) {
      if (chunk.type === 'response.created') {
        assertRequestedCodexModel(request, chunk.response.model)
        responsePayload = chunk.response
        continue
      }

      if (chunk.type === 'error') {
        throw new CodexRequestError({
          message: chunk.message,
          model: request.model,
          reasoningEffort: getCodexReasoningEffort(request),
          code: chunk.code,
          param: chunk.param,
        })
      }

      if (chunk.type === 'response.failed') {
        throw responseFailureToError(chunk.response, request)
      }

      if (
        chunk.type === 'response.completed' ||
        chunk.type === 'response.incomplete'
      ) {
        receivedTerminalEvent = true
      }

      if (!responsePayload) {
        throw new Error(
          `Stream event received before response.created: ${chunk.type}`,
        )
      }

      if (chunk.type === 'response.reasoning_summary_text.delta') {
        const key = reasoningSummaryPartKey(chunk)
        summaryTextByPart.set(
          key,
          (summaryTextByPart.get(key) ?? '') + chunk.delta,
        )
        continue
      }

      if (chunk.type === 'response.reasoning_summary_text.done') {
        const key = reasoningSummaryPartKey(chunk)
        if (!summaryTextByPart.has(key)) {
          summaryTextByPart.set(key, chunk.text)
        }
        continue
      }

      responsePayload = accumulateResponseSnapshot(responsePayload, chunk)
    }

    if (!responsePayload) {
      throw new Error('Stream ended without receiving a response payload')
    }
    if (!receivedTerminalEvent) {
      throw new CodexRequestError({
        message: 'Codex stream ended before a terminal response event',
        model: request.model,
        reasoningEffort: getCodexReasoningEffort(request),
      })
    }
    assertRequestedCodexModel(request, responsePayload.model)

    const content = extractResponseText(responsePayload)
    const toolCalls = extractToolCalls(responsePayload)
    const reasoningSummary =
      extractReasoningSummary(responsePayload) ??
      joinReasoningSummaryParts(summaryTextByPart)

    return {
      id: responsePayload.id,
      created: responsePayload.created_at,
      model: responsePayload.model,
      object: 'chat.completion',
      choices: [
        {
          finish_reason: null,
          message: {
            role: 'assistant',
            content,
            ...(reasoningSummary ? { reasoning: reasoningSummary } : {}),
            ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
            providerMetadata: buildCodexProviderMetadata(responsePayload),
          },
        },
      ],
      system_fingerprint: getSystemFingerprint(responsePayload),
      usage: mapUsage(responsePayload.usage),
    }
  }

  async streamResponse(
    request: LLMRequestStreaming,
    options?: LLMOptions,
    headers?: Record<string, string>,
  ): Promise<AsyncIterable<LLMResponseStreaming>> {
    const body = this.buildRequestBody({ request, stream: true })
    let stream: StreamSource
    try {
      stream = await postStream(this.endpoint, body, {
        headers,
        signal: options?.signal,
        fetchFn: this.fetchFn,
      })
    } catch (error) {
      throw toCodexRequestError(error, request)
    }
    return this.streamResponseGenerator(stream, request)
  }

  private async *streamResponseGenerator(
    body: StreamSource,
    request: LLMRequestStreaming,
  ): AsyncIterable<LLMResponseStreaming> {
    let responseId = ''
    let created = Math.floor(Date.now() / 1000)
    let resolvedModel = request.model
    let systemFingerprint: string | undefined
    let sentRole = false
    const toolCallInfoByIndex = new Map<
      number,
      { id?: string; name?: string }
    >()
    const toolCallHasDelta = new Set<number>()
    const reasoningSummaryHasDelta = new Set<string>()
    let receivedTerminalEvent = false

    const getChunkId = (itemId?: string) =>
      responseId.length > 0 ? responseId : (itemId ?? 'codex-response')
    for await (const chunk of parseJsonSseStream<ResponseStreamEvent>(body)) {
      if (chunk.type === 'response.created') {
        assertRequestedCodexModel(request, chunk.response.model)
        responseId = chunk.response.id
        created = chunk.response.created_at
        resolvedModel = chunk.response.model
        systemFingerprint = getSystemFingerprint(chunk.response)
        continue
      }

      if (chunk.type === 'response.output_item.added') {
        if (chunk.item.type === 'message' && !sentRole) {
          sentRole = true
          yield {
            id: getChunkId(),
            created,
            model: resolvedModel,
            object: 'chat.completion.chunk',
            system_fingerprint: systemFingerprint,
            choices: [
              {
                finish_reason: null,
                delta: {
                  role: chunk.item.role,
                },
              },
            ],
          }
        }
        if (chunk.item.type === 'function_call') {
          const toolCallIndex = chunk.output_index
          const toolCallDelta: ToolCallDelta = {
            index: toolCallIndex,
            id: chunk.item.call_id,
            type: 'function',
            function: {
              name: chunk.item.name,
              ...(chunk.item.arguments?.length
                ? { arguments: chunk.item.arguments }
                : {}),
            },
          }
          toolCallInfoByIndex.set(toolCallIndex, {
            id: chunk.item.call_id,
            name: chunk.item.name,
          })
          yield {
            id: getChunkId(),
            created,
            model: resolvedModel,
            object: 'chat.completion.chunk',
            system_fingerprint: systemFingerprint,
            choices: [
              {
                finish_reason: null,
                delta: {
                  tool_calls: [toolCallDelta],
                },
              },
            ],
          }
        }
        continue
      }

      if (chunk.type === 'response.output_text.delta') {
        const deltaRole = sentRole ? undefined : 'assistant'
        sentRole = true
        yield {
          id: getChunkId(chunk.item_id),
          created,
          model: resolvedModel,
          object: 'chat.completion.chunk',
          system_fingerprint: systemFingerprint,
          choices: [
            {
              finish_reason: null,
              delta: {
                content: chunk.delta,
                ...(deltaRole ? { role: deltaRole } : {}),
              },
            },
          ],
        }
        continue
      }

      if (chunk.type === 'response.reasoning_summary_text.delta') {
        reasoningSummaryHasDelta.add(reasoningSummaryPartKey(chunk))
        yield {
          id: getChunkId(chunk.item_id),
          created,
          model: resolvedModel,
          object: 'chat.completion.chunk',
          system_fingerprint: systemFingerprint,
          choices: [
            {
              finish_reason: null,
              delta: {
                reasoning: chunk.delta,
              },
            },
          ],
        }
        continue
      }

      if (chunk.type === 'response.reasoning_summary_text.done') {
        if (reasoningSummaryHasDelta.has(reasoningSummaryPartKey(chunk))) {
          continue
        }
        yield {
          id: getChunkId(chunk.item_id),
          created,
          model: resolvedModel,
          object: 'chat.completion.chunk',
          system_fingerprint: systemFingerprint,
          choices: [
            {
              finish_reason: null,
              delta: {
                reasoning: chunk.text,
              },
            },
          ],
        }
        continue
      }

      if (chunk.type === 'response.function_call_arguments.delta') {
        const toolCallIndex = chunk.output_index
        const toolCallInfo = toolCallInfoByIndex.get(toolCallIndex)
        toolCallHasDelta.add(chunk.output_index)
        yield {
          id: getChunkId(chunk.item_id),
          created,
          model: resolvedModel,
          object: 'chat.completion.chunk',
          system_fingerprint: systemFingerprint,
          choices: [
            {
              finish_reason: null,
              delta: {
                tool_calls: [
                  {
                    index: toolCallIndex,
                    id: toolCallInfo?.id,
                    type: 'function',
                    function: {
                      ...(toolCallInfo?.name
                        ? { name: toolCallInfo.name }
                        : {}),
                      arguments: chunk.delta,
                    },
                  },
                ],
              },
            },
          ],
        }
        continue
      }

      if (chunk.type === 'response.function_call_arguments.done') {
        if (!toolCallHasDelta.has(chunk.output_index)) {
          const toolCallIndex = chunk.output_index
          const toolCallInfo = toolCallInfoByIndex.get(toolCallIndex)
          yield {
            id: getChunkId(chunk.item_id),
            created,
            model: resolvedModel,
            object: 'chat.completion.chunk',
            system_fingerprint: systemFingerprint,
            choices: [
              {
                finish_reason: null,
                delta: {
                  tool_calls: [
                    {
                      index: toolCallIndex,
                      id: toolCallInfo?.id,
                      type: 'function',
                      function: {
                        ...(toolCallInfo?.name
                          ? { name: toolCallInfo.name }
                          : {}),
                        arguments: chunk.arguments,
                      },
                    },
                  ],
                },
              },
            ],
          }
        }
        continue
      }

      if (chunk.type === 'response.completed') {
        receivedTerminalEvent = true
        assertRequestedCodexModel(request, chunk.response.model)
        resolvedModel = chunk.response.model
        yield {
          id: getChunkId(),
          created,
          model: resolvedModel,
          object: 'chat.completion.chunk',
          system_fingerprint: systemFingerprint,
          choices: [
            {
              finish_reason: 'stop',
              delta: {
                providerMetadata: buildCodexProviderMetadata(chunk.response),
              },
            },
          ],
          usage: mapUsage(chunk.response.usage),
        }
        continue
      }

      if (chunk.type === 'response.incomplete') {
        receivedTerminalEvent = true
        assertRequestedCodexModel(request, chunk.response.model)
        resolvedModel = chunk.response.model
        yield {
          id: getChunkId(),
          created,
          model: resolvedModel,
          object: 'chat.completion.chunk',
          system_fingerprint: systemFingerprint,
          choices: [
            {
              finish_reason: 'length',
              delta: {
                providerMetadata: buildCodexProviderMetadata(chunk.response),
              },
            },
          ],
          usage: mapUsage(chunk.response.usage),
        }
        continue
      }

      if (chunk.type === 'response.failed') {
        throw responseFailureToError(chunk.response, request)
      }

      if (chunk.type === 'error') {
        throw new CodexRequestError({
          message: chunk.message,
          model: request.model,
          reasoningEffort: getCodexReasoningEffort(request),
          code: chunk.code,
          param: chunk.param,
        })
      }
    }

    if (!receivedTerminalEvent) {
      throw new CodexRequestError({
        message: 'Codex stream ended before a terminal response event',
        model: request.model,
        reasoningEffort: getCodexReasoningEffort(request),
      })
    }
  }

  private buildRequestBody({
    request,
    stream,
  }: {
    request: LLMRequest
    stream: boolean
  }): CodexResponseCreateParams {
    const { input, instructions } = buildResponsesInput(request.messages)
    const tools = request.tools
      ? request.tools.map(
          (tool): FunctionTool => ({
            type: 'function',
            name: tool.function.name,
            description: tool.function.description ?? null,
            parameters: tool.function.parameters,
            strict: false,
          }),
        )
      : undefined
    const reasoningEffort = getCodexReasoningEffort(request)
    const reasoningSummary =
      reasoningEffort === 'none' ? undefined : request.reasoning_summary
    const reasoning =
      reasoningEffort || reasoningSummary
        ? {
            ...(reasoningEffort && {
              effort: reasoningEffort,
            }),
            ...(reasoningSummary && {
              summary: reasoningSummary,
            }),
          }
        : undefined

    const body: CodexResponseCreateParams = {
      model: request.model,
      input,
      instructions,
      store: false,
      stream,
      include: ['reasoning.encrypted_content'],
      tools,
      tool_choice: normalizeToolChoice(request.tool_choice),
      ...(reasoning && {
        reasoning,
      }),
    }
    return body
  }
}

function buildResponsesInput(messages: RequestMessage[]): {
  input: ResponseInput
  instructions?: string
} {
  const systemMessages = messages.filter((msg) => msg.role === 'system')
  const instructions = systemMessages
    .map((msg) => (typeof msg.content === 'string' ? msg.content : ''))
    .filter((content) => content.trim().length > 0)
    .join('\n\n')

  const input: ResponseInputItem[] = []

  for (const message of messages) {
    if (message.role === 'system') {
      continue
    }

    if (message.role === 'user') {
      input.push({
        role: 'user',
        content: normalizeUserContent(message.content),
      })
      continue
    }

    if (message.role === 'assistant') {
      const replayableOutputItems = getReplayableCodexOutputItems(message)
      if (replayableOutputItems) {
        input.push(...replayableOutputItems)
        continue
      }

      input.push({
        role: 'assistant',
        content: message.content,
      })
      if (message.tool_calls?.length) {
        for (const toolCall of message.tool_calls) {
          input.push({
            type: 'function_call',
            call_id: toolCall.id,
            name: toolCall.name,
            arguments: toolCall.arguments ?? '{}',
          })
        }
      }
      continue
    }

    if (message.role === 'tool') {
      input.push({
        type: 'function_call_output',
        call_id: message.tool_call.id,
        output: message.content,
      })
      continue
    }
  }

  return {
    input,
    instructions: instructions.length > 0 ? instructions : undefined,
  }
}

type AssistantRequestMessage = Extract<RequestMessage, { role: 'assistant' }>

type ReplayableCodexOutputItem = Extract<
  ResponseOutputItem,
  { type: 'message' | 'reasoning' | 'function_call' }
>

function getReplayableCodexOutputItems(
  message: AssistantRequestMessage,
): ReplayableCodexOutputItem[] | undefined {
  const providerMetadata = message.providerMetadata as
    | (typeof message.providerMetadata & Partial<CodexProviderMetadata>)
    | undefined
  const outputItems = providerMetadata?.openaiCodex?.outputItems
  if (!providerMetadata?.openaiCodex) {
    return undefined
  }
  if (!Array.isArray(outputItems) || outputItems.length === 0) {
    throw new Error(
      'Codex continuation metadata has no replayable output items',
    )
  }

  // Persisted chat history is an untrusted JSON boundary. Replaying an opaque
  // value directly would let malformed data alter a Responses request, so reject
  // the complete metadata set unless every item has a known wire shape.
  if (!outputItems.every(isReplayableCodexOutputItem)) {
    throw new Error(
      'Codex continuation metadata is incomplete or missing encrypted reasoning',
    )
  }
  return outputItems
}

function isReplayableCodexOutputItem(
  value: unknown,
): value is ReplayableCodexOutputItem {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return false
  }

  if (value.type === 'reasoning') {
    return (
      typeof value.id === 'string' &&
      Array.isArray(value.summary) &&
      value.summary.every(
        (part) =>
          isRecord(part) &&
          part.type === 'summary_text' &&
          typeof part.text === 'string',
      ) &&
      (value.content === undefined ||
        (Array.isArray(value.content) &&
          value.content.every(
            (part) =>
              isRecord(part) &&
              part.type === 'reasoning_text' &&
              typeof part.text === 'string',
          ))) &&
      typeof value.encrypted_content === 'string' &&
      value.encrypted_content.length > 0
    )
  }

  if (value.type === 'function_call') {
    return (
      typeof value.call_id === 'string' &&
      typeof value.name === 'string' &&
      typeof value.arguments === 'string'
    )
  }

  if (value.type === 'message') {
    return (
      typeof value.id === 'string' &&
      value.role === 'assistant' &&
      Array.isArray(value.content) &&
      value.content.every(isReplayableAssistantContent)
    )
  }

  return false
}

function isReplayableAssistantContent(value: unknown): boolean {
  if (!isRecord(value)) {
    return false
  }
  if (value.type === 'output_text') {
    return typeof value.text === 'string' && Array.isArray(value.annotations)
  }
  if (value.type === 'refusal') {
    return typeof value.refusal === 'string'
  }
  return false
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeToolChoice(
  choice: LLMRequest['tool_choice'],
): ResponseCreateParamsBase['tool_choice'] {
  if (!choice) {
    return undefined
  }
  if (typeof choice === 'string') {
    return choice
  }
  return {
    type: 'function',
    name: choice.function.name,
  }
}

function normalizeUserContent(
  content: RequestMessage['content'],
): ResponseInputMessageContentList {
  if (typeof content === 'string') {
    return [{ type: 'input_text', text: content }]
  }

  return content.map((part) => {
    if (part.type === 'text') {
      return { type: 'input_text', text: part.text }
    }
    if (part.type === 'image_url') {
      return {
        type: 'input_image',
        image_url: part.image_url.url,
        detail: 'auto',
      }
    }
    return { type: 'input_text', text: '' }
  })
}

function extractResponseText(payload: Response): string {
  if (payload.output_text) {
    return payload.output_text
  }
  const message = payload.output.find((item) => item.type === 'message')
  if (!message) return ''
  return message.content
    .filter((part) => part.type === 'output_text')
    .map((part) => part.text)
    .join('')
}

function extractToolCalls(payload: Response): ToolCall[] {
  const toolCalls: ToolCall[] = []
  for (const output of payload.output) {
    if (output.type === 'function_call') {
      toolCalls.push({
        id: output.call_id,
        type: 'function',
        function: {
          name: output.name,
          ...(output.arguments?.length ? { arguments: output.arguments } : {}),
        },
      })
    }
  }
  return toolCalls
}

function extractReasoningSummary(payload: Response): string | undefined {
  const reasoningItem = payload.output.find(
    (item): item is ResponseReasoningItem => item.type === 'reasoning',
  )
  if (!reasoningItem?.summary?.length) return undefined
  const summaryText = reasoningItem.summary
    .filter((part) => part.type === 'summary_text')
    .map((part) => part.text)
    .join('')
  return summaryText.length > 0 ? summaryText : undefined
}

function getSystemFingerprint(payload: Response): string | undefined {
  return (payload as { system_fingerprint?: string }).system_fingerprint
}

function buildCodexProviderMetadata(
  payload: Response,
): ResponseProviderMetadata {
  const metadata: CodexProviderMetadata = {
    openaiCodex: {
      // Preserve the response ordering: reasoning items must precede their
      // corresponding function calls when stateless tool conversations continue.
      outputItems: payload.output,
      model: payload.model,
    },
  }
  // Shared metadata intentionally treats provider wire data as opaque. The
  // request boundary validates each item before replaying it.
  return metadata as unknown as ResponseProviderMetadata
}

function getCodexReasoningEffort(
  request: LLMRequest,
): CodexReasoningEffort | undefined {
  const effort = (request as CodexRequest).reasoning_effort
  if (!effort) {
    return undefined
  }
  if (
    effort !== 'none' &&
    effort !== 'minimal' &&
    effort !== 'low' &&
    effort !== 'medium' &&
    effort !== 'high' &&
    effort !== 'xhigh' &&
    effort !== 'max'
  ) {
    throw new CodexRequestError({
      message: `Unsupported GPT-5.6 reasoning effort: ${String(effort)}`,
      model: request.model,
      reasoningEffort: String(effort),
    })
  }
  return effort
}

function reasoningSummaryPartKey(event: {
  item_id: string
  summary_index: number
}): string {
  return `${event.item_id}:${event.summary_index}`
}

function joinReasoningSummaryParts(
  parts: Map<string, string>,
): string | undefined {
  const summary = Array.from(parts.values()).join('')
  return summary.length > 0 ? summary : undefined
}

function responseFailureToError(
  response: Response,
  request: LLMRequest,
): CodexRequestError {
  return new CodexRequestError({
    message: response.error?.message ?? 'Codex response failed',
    model: request.model,
    reasoningEffort: getCodexReasoningEffort(request),
    code: response.error?.code,
  })
}

function assertRequestedCodexModel(request: LLMRequest, actualModel: string) {
  if (
    /^gpt-5\.6-(?:sol|terra|luna)$/.test(request.model) &&
    actualModel !== request.model
  ) {
    throw new CodexRequestError({
      message: `Codex returned ${actualModel} instead of requested ${request.model}`,
      model: request.model,
      reasoningEffort: getCodexReasoningEffort(request),
      code: 'model_mismatch',
    })
  }
}

function toCodexRequestError(
  error: unknown,
  request: LLMRequest,
): CodexRequestError {
  if (error instanceof CodexRequestError) {
    return error
  }
  const message = error instanceof Error ? error.message : String(error)
  const statusMatch = /Request failed:\s*(\d{3})\b/.exec(message)
  return new CodexRequestError({
    message,
    model: request.model,
    reasoningEffort: getCodexReasoningEffort(request),
    status:
      error instanceof LLMHttpError
        ? error.status
        : statusMatch
          ? Number(statusMatch[1])
          : undefined,
    responseBody:
      error instanceof LLMHttpError ? error.responseBody : undefined,
    requestId: error instanceof LLMHttpError ? error.requestId : undefined,
    originalError: error,
  })
}

function accumulateResponseSnapshot(
  snapshot: Response,
  event: ResponseStreamEvent,
): Response {
  switch (event.type) {
    case 'response.output_item.added': {
      snapshot.output[event.output_index] = event.item
      return snapshot
    }
    case 'response.output_item.done': {
      snapshot.output[event.output_index] = event.item
      return snapshot
    }
    case 'response.content_part.added': {
      const output = snapshot.output[event.output_index]
      if (!output) {
        throw new Error(`missing output at index ${event.output_index}`)
      }
      const part = event.part
      if (output.type === 'message' && part.type !== 'reasoning_text') {
        output.content.push(part)
      } else if (
        output.type === 'reasoning' &&
        part.type === 'reasoning_text'
      ) {
        if (!output.content) {
          output.content = []
        }
        output.content.push(part)
      }
      return snapshot
    }
    case 'response.output_text.delta': {
      const output = snapshot.output[event.output_index]
      if (!output) {
        throw new Error(`missing output at index ${event.output_index}`)
      }
      if (output.type === 'message') {
        const content = output.content[event.content_index]
        if (!content) {
          throw new Error(`missing content at index ${event.content_index}`)
        }
        if (content.type !== 'output_text') {
          throw new Error(
            `expected content to be 'output_text', got ${content.type}`,
          )
        }
        content.text += event.delta
      }
      return snapshot
    }
    case 'response.function_call_arguments.delta': {
      const output = snapshot.output[event.output_index]
      if (!output) {
        throw new Error(`missing output at index ${event.output_index}`)
      }
      if (output.type === 'function_call') {
        output.arguments += event.delta
      }
      return snapshot
    }
    case 'response.function_call_arguments.done': {
      const output = snapshot.output[event.output_index]
      if (!output) {
        throw new Error(`missing output at index ${event.output_index}`)
      }
      if (output.type === 'function_call' && !output.arguments?.length) {
        output.arguments = event.arguments
      }
      return snapshot
    }
    case 'response.reasoning_text.delta': {
      const output = snapshot.output[event.output_index]
      if (!output) {
        throw new Error(`missing output at index ${event.output_index}`)
      }
      if (output.type === 'reasoning') {
        const content = output.content?.[event.content_index]
        if (!content) {
          throw new Error(`missing content at index ${event.content_index}`)
        }
        if (content.type !== 'reasoning_text') {
          const contentType = (content as { type: string }).type
          throw new Error(
            `expected content to be 'reasoning_text', got ${contentType}`,
          )
        }
        content.text += event.delta
      }
      return snapshot
    }
    case 'response.completed':
      return event.response
    case 'response.incomplete':
      return event.response
    case 'error':
      return snapshot
  }
  return snapshot
}

function mapUsage(usage?: OpenAIResponseUsage): ResponseUsage | undefined {
  if (!usage) {
    return undefined
  }
  return {
    prompt_tokens: usage.input_tokens,
    completion_tokens: usage.output_tokens,
    total_tokens: usage.total_tokens,
  }
}
