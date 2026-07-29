import { Platform } from 'obsidian'
import { v4 as uuidv4 } from 'uuid'

import { ChatModel } from '../../../types/chat-model.types'
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
import { BaseLLMProvider } from '../base'
import { LLMAPIKeyNotSetException } from '../exception'

import { NativeCliResolver } from './NativeCliResolver'
import { runNativeProcess } from './NativeProcess'
import { buildNativePrompt } from './nativePrompt'
import { nativeToolResultToText } from './nativeToolResult'
import { requireNode } from './nodeRuntime'

type AntigravityFinal =
  | {
      type: 'final'
      text: string
    }
  | {
      type: 'tool_call'
      tool: string
      arguments: Record<string, unknown>
    }

export class AntigravityProvider extends BaseLLMProvider<
  Extract<LLMProvider, { type: 'gemini-plan' }>
> {
  constructor(
    provider: Extract<LLMProvider, { type: 'gemini-plan' }>,
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
    let usage: ResponseUsage | undefined
    const stream = await this.streamResponse(
      model,
      { ...request, stream: true },
      options,
    )
    for await (const chunk of stream) {
      content += chunk.choices[0]?.delta.content ?? ''
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
      throw new Error('Gemini Plan is available on desktop only.')
    }
    if (model.providerType !== 'gemini-plan') {
      throw new Error('Model is not a Gemini Plan model.')
    }
    const executablePath = this.resolver.resolve('gemini')
    if (!executablePath) {
      throw new LLMAPIKeyNotSetException(
        'Antigravity CLI is not installed. Open Settings > Plan connections to install and sign in.',
      )
    }
    return this.run(executablePath, model, request, options)
  }

  async getEmbedding(): Promise<number[]> {
    throw new Error('Gemini Plan does not support embeddings.')
  }

  private async *run(
    executablePath: string,
    model: Extract<ChatModel, { providerType: 'gemini-plan' }>,
    request: LLMRequestStreaming,
    options?: LLMOptions,
  ): AsyncGenerator<LLMResponseStreaming> {
    const nativePrompt = buildNativePrompt(request.messages)
    const tools =
      request.tools?.length && options?.nativeToolExecutor ? request.tools : []
    const toolTranscript: string[] = []
    const cwd = createEphemeralRuntimeDirectory()

    try {
      for (let iteration = 0; iteration < 12; iteration++) {
        if (options?.signal?.aborted) {
          const error = new Error('Gemini Plan request was canceled.')
          error.name = 'AbortError'
          throw error
        }

        const prompt = buildAntigravityIterationPrompt({
          systemPrompt: nativePrompt.systemPrompt,
          prompt: nativePrompt.prompt,
          tools,
          toolTranscript,
        })
        const parsed = await runAntigravityIteration({
          executablePath,
          model: model.model,
          prompt,
          structured: tools.length > 0,
          cwd,
          signal: options?.signal,
        })

        if (tools.length === 0) {
          for (const text of parsed.textDeltas) {
            yield createChunk(model.model, { content: text })
          }
          if (
            parsed.textDeltas.length === 0 &&
            typeof parsed.finalValue === 'string' &&
            parsed.finalValue
          ) {
            yield createChunk(model.model, { content: parsed.finalValue })
          }
          if (parsed.usage) {
            yield createChunk(model.model, { usage: parsed.usage })
          }
          yield createChunk(model.model, { finishReason: 'stop' })
          return
        }

        const decision = parseStructuredDecision(parsed.finalValue)
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
            `Antigravity requested an unavailable Smart Composer tool: ${decision.tool}`,
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
      "Antigravity reached Smart Composer's 12-step tool safety limit.",
    )
  }
}

async function runAntigravityIteration(params: {
  executablePath: string
  model: string
  prompt: string
  structured: boolean
  cwd: string
  signal?: AbortSignal
}): Promise<{
  textDeltas: string[]
  finalValue: unknown
  usage?: ResponseUsage
}> {
  const args = buildAntigravityCliArgs({
    prompt: params.prompt,
    model: params.model,
    structured: params.structured,
  })
  const textDeltas: string[] = []
  let finalValue: unknown
  let usage: ResponseUsage | undefined
  let requestError: string | undefined
  const result = await runNativeProcess({
    executable: params.executablePath,
    args,
    cwd: params.cwd,
    signal: params.signal,
    onStdoutLine: (line) => {
      const event = parseJsonLine(line)
      if (!event) return
      const text = extractAntigravityTextDelta(event)
      if (text) {
        textDeltas.push(text)
      }
      const resultEvent = extractAntigravityResultEvent(event)
      if (resultEvent) {
        finalValue =
          resultEvent.structured_output ??
          resultEvent.response ??
          resultEvent.result ??
          resultEvent.output ??
          resultEvent.content ??
          resultEvent.text
        usage = parseUsage(resultEvent.usage) ?? usage
        if (
          typeof resultEvent.status === 'string' &&
          resultEvent.status !== 'SUCCESS'
        ) {
          requestError =
            firstString(resultEvent.error, resultEvent.response) ||
            `Antigravity request failed: ${resultEvent.status}`
        }
      }
    },
  })
  if (result.exitCode !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim()
    throw new Error(
      detail ||
        'Antigravity CLI failed. Open Settings > Plan connections and sign in again.',
    )
  }
  if (requestError) {
    throw new Error(requestError)
  }

  if (finalValue === undefined) {
    finalValue = textDeltas.join('')
  }
  if (
    (finalValue === undefined || finalValue === '') &&
    textDeltas.length === 0
  ) {
    throw new Error('Antigravity completed without returning an answer.')
  }
  return { textDeltas, finalValue, usage }
}

export function buildAntigravityCliArgs(params: {
  prompt: string
  model: string
  structured: boolean
}): string[] {
  const args = [
    '-p',
    params.prompt,
    '--output-format',
    'stream-json',
    '--model',
    params.model,
    '--mode',
    'plan',
  ]
  if (params.structured) {
    args.push('--json-schema', JSON.stringify(ANTIGRAVITY_TOOL_SCHEMA))
  }
  return args
}

function createEphemeralRuntimeDirectory(): string {
  const fs = requireNode<typeof import('fs')>('fs')
  const os = requireNode<typeof import('os')>('os')
  const path = requireNode<typeof import('path')>('path')
  return fs.mkdtempSync(path.join(os.tmpdir(), 'smart-composer-antigravity-'))
}

function removeEphemeralRuntimeDirectory(directory: string) {
  const fs = requireNode<typeof import('fs')>('fs')
  try {
    fs.rmSync(directory, { recursive: true, force: true })
  } catch {
    // The operating system will eventually clear its temporary directory.
  }
}

function buildAntigravityIterationPrompt(params: {
  systemPrompt: string
  prompt: string
  tools: RequestTool[]
  toolTranscript: string[]
}): string {
  if (params.tools.length === 0) {
    return [params.systemPrompt, params.prompt].join('\n\n')
  }
  const catalog = params.tools.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters,
  }))
  return [
    params.systemPrompt,
    'You may use only the Smart Composer tools in the catalog below. Return a JSON object matching the required schema. Use type "tool_call" for exactly one required tool call, or type "final" when ready to answer. Never claim a tool result that is not present in the transcript.',
    `[SMART COMPOSER TOOL CATALOG]\n${JSON.stringify(catalog)}`,
    params.prompt,
    ...params.toolTranscript,
  ].join('\n\n')
}

function parseStructuredDecision(value: unknown): AntigravityFinal {
  const parsed =
    typeof value === 'string' ? (parseJsonLine(value) ?? value) : value
  const record =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  if (
    record &&
    record.type === 'tool_call' &&
    typeof record.tool === 'string'
  ) {
    return {
      type: 'tool_call',
      tool: record.tool,
      arguments:
        record.arguments &&
        typeof record.arguments === 'object' &&
        !Array.isArray(record.arguments)
          ? (record.arguments as Record<string, unknown>)
          : {},
    }
  }
  if (record && record.type === 'final' && typeof record.text === 'string') {
    return { type: 'final', text: record.text }
  }
  if (typeof parsed === 'string') {
    return { type: 'final', text: parsed }
  }
  throw new Error('Antigravity returned an invalid structured result.')
}

function parseJsonLine(line: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(line) as unknown
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

export function extractAntigravityTextDelta(
  event: Record<string, unknown>,
): string {
  if (event.type !== 'step_update' && event.event !== 'step_update') return ''
  for (const key of ['delta', 'text', 'content', 'output']) {
    if (typeof event[key] === 'string') return event[key]
  }
  const step = event.step_update ?? event.step
  if (step && typeof step === 'object' && !Array.isArray(step)) {
    for (const key of ['delta', 'text', 'content', 'output']) {
      const value = (step as Record<string, unknown>)[key]
      if (typeof value === 'string') return value
    }
    const textDelta = (step as Record<string, unknown>).text_delta
    if (typeof textDelta === 'string') return textDelta
  }
  return ''
}

export function extractAntigravityResultEvent(
  event: Record<string, unknown>,
): Record<string, unknown> | null {
  if (event.type !== 'result' && event.event !== 'result') return null
  const nested = event.result
  return nested && typeof nested === 'object' && !Array.isArray(nested)
    ? (nested as Record<string, unknown>)
    : event
}

function parseUsage(value: unknown): ResponseUsage | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  const usage = value as Record<string, unknown>
  const promptTokens = numberValue(usage.input_tokens ?? usage.prompt_tokens)
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

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function firstString(...values: unknown[]): string {
  return (
    values.find((value): value is string => typeof value === 'string') ?? ''
  )
}

function createChunk(
  model: string,
  params: {
    content?: string
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
        },
      },
    ],
  }
}

const ANTIGRAVITY_TOOL_SCHEMA = {
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
