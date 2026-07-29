import { Platform, requestUrl } from 'obsidian'
import { v4 as uuidv4 } from 'uuid'

import { ChatModel, ClaudeEffort } from '../../../types/chat-model.types'
import {
  LLMOptions,
  LLMRequestNonStreaming,
  LLMRequestStreaming,
  RequestTool,
} from '../../../types/llm/request'
import {
  LLMResponseNonStreaming,
  LLMResponseStreaming,
  ResponseUsage,
} from '../../../types/llm/response'
import { LLMProvider } from '../../../types/provider.types'
import { parseImageDataUrl } from '../../../utils/llm/image'
import { BaseLLMProvider } from '../base'
import { LLMAPIKeyNotSetException } from '../exception'

import { NativeCliResolver } from './NativeCliResolver'
import { runNativeProcess } from './NativeProcess'
import { buildNativePrompt } from './nativePrompt'
import { nativeToolResultToText } from './nativeToolResult'
import { requireNode } from './nodeRuntime'

type ClaudeFinal =
  | {
      type: 'final'
      text: string
    }
  | {
      type: 'tool_call'
      tool: string
      arguments: Record<string, unknown>
    }

type ClaudeStreamDelta = {
  content?: string
  reasoning?: string
}

type ClaudeIterationResult = {
  finalValue: unknown
  emittedText: string
  usage?: ResponseUsage
}

export class ClaudeAgentProvider extends BaseLLMProvider<
  Extract<LLMProvider, { type: 'anthropic-plan' }>
> {
  constructor(
    provider: Extract<LLMProvider, { type: 'anthropic-plan' }>,
    private readonly resolver = new NativeCliResolver(),
  ) {
    super(provider)
  }

  async generateResponse(
    model: ChatModel,
    request: LLMRequestNonStreaming,
    options?: LLMOptions,
  ): Promise<LLMResponseNonStreaming> {
    let content = ''
    let reasoning = ''
    let usage: ResponseUsage | undefined
    const stream = await this.streamResponse(
      model,
      { ...request, stream: true },
      options,
    )
    for await (const chunk of stream) {
      content += chunk.choices[0]?.delta.content ?? ''
      reasoning += chunk.choices[0]?.delta.reasoning ?? ''
      usage = chunk.usage ?? usage
    }
    return {
      id: uuidv4(),
      model: model.model,
      object: 'chat.completion',
      usage,
      choices: [
        {
          finish_reason: 'stop',
          message: {
            role: 'assistant',
            content,
            reasoning: reasoning || undefined,
          },
        },
      ],
    }
  }

  async streamResponse(
    model: ChatModel,
    request: LLMRequestStreaming,
    options?: LLMOptions,
  ): Promise<AsyncIterable<LLMResponseStreaming>> {
    if (!Platform.isDesktop) {
      throw new Error('Claude Plan is available on desktop only.')
    }
    if (model.providerType !== 'anthropic-plan') {
      throw new Error('Model is not a Claude Plan model.')
    }
    const executablePath = this.resolver.resolve('claude')
    if (!executablePath) {
      throw new LLMAPIKeyNotSetException(
        'Claude Code is not installed. Open Settings > Plan connections to install and sign in.',
      )
    }
    return this.run(executablePath, model, request, options)
  }

  async getEmbedding(): Promise<number[]> {
    throw new Error('Claude Plan does not support embeddings.')
  }

  private async *run(
    executablePath: string,
    model: Extract<ChatModel, { providerType: 'anthropic-plan' }>,
    request: LLMRequestStreaming,
    options?: LLMOptions,
  ): AsyncGenerator<LLMResponseStreaming> {
    const nativePrompt = buildNativePrompt(request.messages)
    const tools =
      request.tools?.length && options?.nativeToolExecutor ? request.tools : []
    const toolTranscript: string[] = []
    const cwd = createEphemeralRuntimeDirectory()

    try {
      const attachments = await materializeClaudeImages(request.messages, cwd)
      const promptWithAttachments = appendClaudeAttachments(
        nativePrompt.prompt,
        attachments,
      )

      if (tools.length === 0) {
        const iteration = startClaudeIteration({
          executablePath,
          model,
          systemPrompt: nativePrompt.systemPrompt,
          prompt: promptWithAttachments,
          structured: false,
          allowImageRead: attachments.length > 0,
          cwd,
          signal: options?.signal,
        })
        for await (const delta of iteration.deltas) {
          yield createChunk(model.model, delta)
        }
        const result = await iteration.result
        if (!result.emittedText && typeof result.finalValue === 'string') {
          yield createChunk(model.model, { content: result.finalValue })
        }
        if (result.usage) {
          yield createChunk(model.model, { usage: result.usage })
        }
        yield createChunk(model.model, { finishReason: 'stop' })
        return
      }

      for (let iterationIndex = 0; iterationIndex < 24; iterationIndex++) {
        throwIfAborted(options?.signal)
        const prompt = buildClaudeToolIterationPrompt({
          prompt: promptWithAttachments,
          tools,
          toolTranscript,
        })
        const iteration = startClaudeIteration({
          executablePath,
          model,
          systemPrompt: nativePrompt.systemPrompt,
          prompt,
          structured: true,
          allowImageRead: attachments.length > 0,
          cwd,
          signal: options?.signal,
        })
        const parsed = await iteration.result
        const decision = parseClaudeDecision(parsed.finalValue)

        if (decision.type === 'final') {
          yield createChunk(model.model, { content: decision.text })
          if (parsed.usage) {
            yield createChunk(model.model, { usage: parsed.usage })
          }
          yield createChunk(model.model, { finishReason: 'stop' })
          return
        }

        const definition = tools.find(
          (tool) => tool.function.name === decision.tool,
        )
        if (!definition || !options?.nativeToolExecutor) {
          throw new Error(
            `Claude requested an unavailable Smart Composer tool: ${decision.tool}`,
          )
        }
        const response = await options.nativeToolExecutor({
          id: uuidv4(),
          name: definition.function.name,
          arguments: JSON.stringify(decision.arguments),
        })
        const result = nativeToolResultToText(response)
        toolTranscript.push(
          [
            `[TOOL CALL ${definition.function.name}]`,
            JSON.stringify(decision.arguments),
            `[TOOL RESULT${result.isError ? ' ERROR' : ''}]`,
            result.text,
          ].join('\n'),
        )
      }
    } finally {
      removeEphemeralRuntimeDirectory(cwd)
    }

    throw new Error(
      "Claude reached Smart Composer's 24-step tool safety limit.",
    )
  }
}

export function buildClaudeCliArgs(params: {
  model: Extract<ChatModel, { providerType: 'anthropic-plan' }>
  systemPrompt: string
  structured: boolean
  allowImageRead: boolean
}): string[] {
  const args = [
    '-p',
    '--verbose',
    '--output-format',
    'stream-json',
    '--include-partial-messages',
    '--no-session-persistence',
    '--safe-mode',
    '--permission-mode',
    'dontAsk',
    '--no-chrome',
    '--disable-slash-commands',
    '--model',
    normalizeClaudeModel(params.model.model),
    '--system-prompt',
    params.systemPrompt,
    `--tools=${params.allowImageRead ? 'Read' : ''}`,
    '--effort',
    claudeEffort(params.model),
  ]
  if (params.structured) {
    args.push('--json-schema', JSON.stringify(CLAUDE_TOOL_SCHEMA))
  }
  return args
}

function startClaudeIteration(params: {
  executablePath: string
  model: Extract<ChatModel, { providerType: 'anthropic-plan' }>
  systemPrompt: string
  prompt: string
  structured: boolean
  allowImageRead: boolean
  cwd: string
  signal?: AbortSignal
}): {
  deltas: AsyncIterable<ClaudeStreamDelta>
  result: Promise<ClaudeIterationResult>
} {
  const queue = new AsyncEventQueue<ClaudeStreamDelta>()
  let finalValue: unknown
  let emittedText = ''
  let usage: ResponseUsage | undefined
  let requestError: Error | undefined

  const result = runNativeProcess({
    executable: params.executablePath,
    args: buildClaudeCliArgs(params),
    cwd: params.cwd,
    stdin: params.prompt,
    signal: params.signal,
    env: {
      ...process.env,
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
    },
    onStdoutLine: (line) => {
      const event = parseJsonLine(line)
      if (!event) return
      const parsed = parseClaudeStreamEvent(event)
      if (parsed.content) {
        emittedText += parsed.content
      }
      if (!params.structured && (parsed.content || parsed.reasoning)) {
        queue.push({
          content: parsed.content,
          reasoning: parsed.reasoning,
        })
      }
      finalValue = parsed.finalValue ?? finalValue
      usage = parsed.usage ?? usage
      requestError = parsed.error ?? requestError
    },
  })
    .then((processResult) => {
      if (processResult.exitCode !== 0) {
        const detail =
          processResult.stderr.trim() || processResult.stdout.trim()
        throw new Error(
          detail ||
            'Claude Code failed. Open Settings > Plan connections and sign in again.',
        )
      }
      if (requestError) throw requestError
      if (finalValue === undefined) finalValue = emittedText
      if (
        (finalValue === undefined || finalValue === '') &&
        emittedText.length === 0
      ) {
        throw new Error('Claude Code completed without returning an answer.')
      }
      return { finalValue, emittedText, usage }
    })
    .finally(() => queue.close())

  return { deltas: queue, result }
}

export function parseClaudeStreamEvent(event: Record<string, unknown>): {
  content?: string
  reasoning?: string
  finalValue?: unknown
  usage?: ResponseUsage
  error?: Error
} {
  if (event.type === 'stream_event') {
    const streamEvent = asRecord(event.event)
    if (streamEvent?.type === 'content_block_delta') {
      const delta = asRecord(streamEvent.delta)
      if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
        return { content: delta.text }
      }
      if (
        delta?.type === 'thinking_delta' &&
        typeof delta.thinking === 'string'
      ) {
        return { reasoning: delta.thinking }
      }
    }
    if (streamEvent?.type === 'message_delta') {
      return { usage: parseClaudeUsage(streamEvent.usage) }
    }
  }

  if (event.type === 'assistant') {
    const message = asRecord(event.message)
    return {
      usage: parseClaudeUsage(message?.usage),
      error:
        typeof event.error === 'string'
          ? new Error(`Claude Code request failed: ${event.error}`)
          : undefined,
    }
  }

  if (event.type === 'result') {
    const failed =
      event.is_error === true ||
      (typeof event.subtype === 'string' && event.subtype !== 'success')
    const detail = firstString(event.error, event.result)
    return {
      finalValue:
        event.structured_output ??
        event.result ??
        event.output ??
        event.content ??
        event.text,
      usage: parseClaudeUsage(event.usage),
      error: failed
        ? new Error(detail || 'Claude Code request failed.')
        : undefined,
    }
  }

  return {}
}

function buildClaudeToolIterationPrompt(params: {
  prompt: string
  tools: RequestTool[]
  toolTranscript: string[]
}): string {
  const catalog = params.tools.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters,
  }))
  return [
    'Use only the Smart Composer tool catalog below. Return a JSON object matching the required schema. Use type "tool_call" for exactly one required tool call, or type "final" when ready to answer. Never claim a tool result that is not present in the transcript.',
    `[SMART COMPOSER TOOL CATALOG]\n${JSON.stringify(catalog)}`,
    params.prompt,
    ...params.toolTranscript,
  ].join('\n\n')
}

export function parseClaudeDecision(value: unknown): ClaudeFinal {
  const parsed = parseStructuredValue(value)
  const record = asRecord(parsed)
  if (record?.type === 'tool_call' && typeof record.tool === 'string') {
    return {
      type: 'tool_call',
      tool: record.tool,
      arguments: asRecord(record.arguments) ?? {},
    }
  }
  if (record?.type === 'final' && typeof record.text === 'string') {
    return { type: 'final', text: record.text }
  }
  if (typeof parsed === 'string' && parsed.trim()) {
    return { type: 'final', text: parsed }
  }
  throw new Error('Claude returned an invalid structured tool result.')
}

function parseStructuredValue(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  const direct = parseJsonValue(trimmed)
  if (direct !== undefined) return direct
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  if (fenced) {
    const parsed = parseJsonValue(fenced.trim())
    if (parsed !== undefined) return parsed
  }
  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const parsed = parseJsonValue(trimmed.slice(firstBrace, lastBrace + 1))
    if (parsed !== undefined) return parsed
  }
  return value
}

function parseJsonValue(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return undefined
  }
}

function parseJsonLine(line: string): Record<string, unknown> | null {
  const value = parseJsonValue(line)
  return asRecord(value)
}

function parseClaudeUsage(value: unknown): ResponseUsage | undefined {
  const usage = asRecord(value)
  if (!usage) return undefined
  const promptTokens =
    numberValue(usage.input_tokens ?? usage.prompt_tokens) +
    numberValue(usage.cache_creation_input_tokens) +
    numberValue(usage.cache_read_input_tokens)
  const completionTokens = numberValue(
    usage.output_tokens ?? usage.completion_tokens,
  )
  if (!promptTokens && !completionTokens) return undefined
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
  }
}

function normalizeClaudeModel(model: string): string {
  if (/opus/i.test(model)) return 'opus'
  if (/sonnet/i.test(model)) return 'sonnet'
  if (/haiku/i.test(model)) return 'haiku'
  return model
}

function claudeEffort(
  model: Extract<ChatModel, { providerType: 'anthropic-plan' }>,
): ClaudeEffort {
  if (model.thinking?.mode === 'adaptive') {
    return model.thinking.effort
  }
  if (model.thinking?.enabled === false) return 'low'
  return 'high'
}

async function materializeClaudeImages(
  messages: LLMRequestStreaming['messages'],
  directory: string,
): Promise<string[]> {
  const urls = messages.flatMap((message) => {
    if (message.role !== 'user' || !Array.isArray(message.content)) return []
    return message.content.flatMap((part) =>
      part.type === 'image_url' ? [part.image_url.url] : [],
    )
  })
  if (urls.length === 0) return []

  const fs = requireNode<typeof import('fs')>('fs')
  const path = requireNode<typeof import('path')>('path')
  const { Buffer } = requireNode<typeof import('buffer')>('buffer')
  const files: string[] = []

  for (const [index, url] of urls.entries()) {
    let mimeType: string
    let bytes: Uint8Array
    if (/^https?:\/\//i.test(url)) {
      const response = await requestUrl({ url, method: 'GET' })
      mimeType =
        response.headers['content-type']?.split(';')[0]?.trim() ?? 'image/png'
      bytes = new Uint8Array(response.arrayBuffer)
    } else {
      const parsed = parseImageDataUrl(url)
      mimeType = parsed.mimeType
      bytes = Buffer.from(parsed.base64Data, 'base64')
    }
    const extension = imageExtension(mimeType)
    const filePath = path.join(
      directory,
      `smart-composer-image-${index + 1}.${extension}`,
    )
    fs.writeFileSync(filePath, bytes)
    files.push(filePath)
  }
  return files
}

function appendClaudeAttachments(prompt: string, files: string[]): string {
  if (files.length === 0) return prompt
  return [
    prompt,
    '[SMART COMPOSER IMAGE ATTACHMENTS]',
    'Use the Read tool only on the exact temporary image paths listed below. Do not read any other file.',
    ...files.map((file, index) => `${index + 1}. ${file}`),
  ].join('\n\n')
}

function imageExtension(mimeType: string): string {
  switch (mimeType.toLowerCase()) {
    case 'image/jpeg':
      return 'jpg'
    case 'image/gif':
      return 'gif'
    case 'image/webp':
      return 'webp'
    case 'image/png':
      return 'png'
    default:
      throw new Error(`Claude Plan does not support image type ${mimeType}.`)
  }
}

function createChunk(
  model: string,
  params: {
    content?: string
    reasoning?: string
    usage?: ResponseUsage
    finishReason?: string
  },
): LLMResponseStreaming {
  return {
    id: uuidv4(),
    model,
    object: 'chat.completion.chunk',
    usage: params.usage,
    choices: [
      {
        finish_reason: params.finishReason ?? null,
        delta: {
          content: params.content,
          reasoning: params.reasoning,
        },
      },
    ],
  }
}

function createEphemeralRuntimeDirectory(): string {
  const fs = requireNode<typeof import('fs')>('fs')
  const os = requireNode<typeof import('os')>('os')
  const path = requireNode<typeof import('path')>('path')
  return fs.mkdtempSync(path.join(os.tmpdir(), 'smart-composer-claude-'))
}

function removeEphemeralRuntimeDirectory(directory: string | undefined) {
  if (!directory) return
  const fs = requireNode<typeof import('fs')>('fs')
  try {
    fs.rmSync(directory, { recursive: true, force: true })
  } catch {
    // The operating system will eventually clear its temporary directory.
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  const error = new Error('Claude Plan request was canceled.')
  error.name = 'AbortError'
  throw error
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function firstString(...values: unknown[]): string {
  return (
    values.find((value): value is string => typeof value === 'string') ?? ''
  )
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

class AsyncEventQueue<T> implements AsyncIterable<T> {
  private readonly items: T[] = []
  private readonly waiters: ((result: IteratorResult<T>) => void)[] = []
  private closed = false

  push(item: T): void {
    const waiter = this.waiters.shift()
    if (waiter) {
      waiter({ value: item, done: false })
      return
    }
    this.items.push(item)
  }

  close(): void {
    this.closed = true
    for (const waiter of this.waiters.splice(0)) {
      waiter({ value: undefined, done: true })
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const item = this.items.shift()
        if (item !== undefined) {
          return Promise.resolve({ value: item, done: false })
        }
        if (this.closed) {
          return Promise.resolve({ value: undefined, done: true })
        }
        return new Promise<IteratorResult<T>>((resolve) => {
          this.waiters.push(resolve)
        })
      },
    }
  }
}

const CLAUDE_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['final', 'tool_call'] },
    text: { type: 'string' },
    tool: { type: 'string' },
    arguments: { type: 'object' },
  },
  required: ['type'],
  additionalProperties: false,
}
