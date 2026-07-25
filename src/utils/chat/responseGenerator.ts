import { v4 as uuidv4 } from 'uuid'

import type { BaseLLMProvider } from '../../core/llm/base'
import type { McpManager } from '../../core/mcp/mcpManager'
import { ChatMessage, ChatToolMessage } from '../../types/chat'
import { ChatModel } from '../../types/chat-model.types'
import { RequestProviderMetadata, RequestTool } from '../../types/llm/request'
import {
  Annotation,
  LLMResponseStreaming,
  ToolCallDelta,
} from '../../types/llm/response'
import type { McpRoutingMode } from '../../types/mcp.types'
import { LLMProvider } from '../../types/provider.types'
import {
  ToolCallRequest,
  ToolCallResponse,
  ToolCallResponseStatus,
} from '../../types/tool-call.types'

import { fetchAnnotationTitles } from './fetch-annotation-titles'
import { PromptGenerator } from './promptGenerator'

export type ResponseGeneratorParams = {
  providerClient: BaseLLMProvider<LLMProvider>
  model: ChatModel
  messages: ChatMessage[]
  conversationId: string
  enableTools: boolean
  maxAutoIterations: number
  promptGenerator: PromptGenerator
  mcpManager: McpManager | null
  mcpRoutingMode?: McpRoutingMode
  mcpQuery?: string
  mcpConnectionIds?: string[]
  abortSignal?: AbortSignal
  localTools?: LocalResponseTool[]
}

export type LocalResponseTool = {
  definition: RequestTool
  call: (
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<
    Extract<
      ToolCallResponse,
      {
        status:
          | ToolCallResponseStatus.Success
          | ToolCallResponseStatus.Error
          | ToolCallResponseStatus.Aborted
      }
    >
  >
}

export class ResponseGenerator {
  private readonly providerClient: BaseLLMProvider<LLMProvider>
  private readonly model: ChatModel
  private readonly conversationId: string
  private readonly enableTools: boolean
  private readonly promptGenerator: PromptGenerator
  private readonly mcpManager: McpManager | null
  private readonly mcpRoutingMode: McpRoutingMode
  private readonly mcpQuery: string
  private readonly mcpConnectionIds: Set<string>
  private readonly abortSignal?: AbortSignal
  private readonly receivedMessages: ChatMessage[]
  private readonly maxAutoIterations: number
  private readonly localTools: Map<string, LocalResponseTool>

  private responseMessages: ChatMessage[] = [] // Response messages that are generated after the initial messages
  private subscribers: ((messages: ChatMessage[]) => void)[] = []

  constructor(params: ResponseGeneratorParams) {
    this.providerClient = params.providerClient
    this.model = params.model
    this.conversationId = params.conversationId
    this.enableTools = params.enableTools
    this.mcpRoutingMode = params.mcpRoutingMode ?? 'auto'
    this.mcpQuery = params.mcpQuery ?? ''
    this.mcpConnectionIds = new Set(params.mcpConnectionIds ?? [])
    this.maxAutoIterations =
      this.mcpRoutingMode === 'on-demand'
        ? Math.max(3, params.maxAutoIterations)
        : Math.max(1, params.maxAutoIterations)
    this.receivedMessages = params.messages
    this.promptGenerator = params.promptGenerator
    this.mcpManager = params.mcpManager
    this.abortSignal = params.abortSignal
    this.localTools = new Map(
      (params.localTools ?? []).map((tool) => [
        tool.definition.function.name,
        tool,
      ]),
    )
    if (
      this.enableTools &&
      this.mcpManager &&
      this.mcpRoutingMode === 'on-demand'
    ) {
      this.localTools.set('search_mcp_tools', this.createMcpToolSearchTool())
    }
  }

  public subscribe(callback: (messages: ChatMessage[]) => void) {
    this.subscribers.push(callback)

    return () => {
      this.subscribers = this.subscribers.filter((cb) => cb !== callback)
    }
  }

  public async run() {
    for (let i = 0; i < this.maxAutoIterations; i++) {
      const { toolCallRequests } = await this.streamSingleResponse()
      if (toolCallRequests.length === 0) {
        return
      }

      const toolMessage: ChatToolMessage = {
        role: 'tool' as const,
        id: uuidv4(),
        toolCalls: toolCallRequests.map((toolCall) => ({
          request: toolCall,
          response: {
            status:
              this.localTools.has(toolCall.name) ||
              (this.mcpManager?.isToolExecutionAllowed({
                requestToolName: toolCall.name,
                conversationId: this.conversationId,
              }) ??
                false)
                ? ToolCallResponseStatus.Running
                : ToolCallResponseStatus.PendingApproval,
          },
        })),
      }

      this.updateResponseMessages((messages) => [...messages, toolMessage])

      await Promise.all(
        toolMessage.toolCalls
          .filter(
            (toolCall) =>
              toolCall.response.status === ToolCallResponseStatus.Running,
          )
          .map(async (toolCall) => {
            const response = await this.callTool(toolCall.request)
            this.updateResponseMessages((messages) =>
              messages.map((message) =>
                message.id === toolMessage.id && message.role === 'tool'
                  ? {
                      ...message,
                      toolCalls: message.toolCalls?.map((tc) =>
                        tc.request.id === toolCall.request.id
                          ? {
                              ...tc,
                              response,
                            }
                          : tc,
                      ),
                    }
                  : message,
              ),
            )
          }),
      )

      const updatedToolMessage = this.responseMessages.find(
        (message) => message.id === toolMessage.id && message.role === 'tool',
      ) as ChatToolMessage | undefined
      if (
        !updatedToolMessage?.toolCalls?.every((toolCall) =>
          [
            ToolCallResponseStatus.Success,
            ToolCallResponseStatus.Error,
          ].includes(toolCall.response.status),
        )
      ) {
        // Exit the auto-iteration loop if any tool call hasn't completed
        // Only 'success' or 'error' states are considered complete
        return
      }
    }
  }

  private async streamSingleResponse(): Promise<{
    toolCallRequests: ToolCallRequest[]
  }> {
    const requestMessages = await this.promptGenerator.generateRequestMessages({
      messages: [...this.receivedMessages, ...this.responseMessages],
    })

    const availableMcpTools =
      this.enableTools && this.mcpManager
        ? await this.mcpManager.listAvailableTools({
            mode: this.mcpRoutingMode,
            query: this.mcpQuery,
            connectionIds: [...this.mcpConnectionIds],
          })
        : []

    // Set tools to undefined when no tools are available since some providers
    // reject empty tools arrays.
    const availableTools: RequestTool[] = [...this.localTools.values()].map(
      (tool) => tool.definition,
    )
    availableTools.push(
      ...availableMcpTools.map((tool) => ({
        type: 'function' as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: {
            ...tool.inputSchema,
            properties: tool.inputSchema.properties ?? {},
          },
        },
      })),
    )
    const tools: RequestTool[] | undefined =
      availableTools.length > 0 ? availableTools : undefined

    const stream = await this.providerClient.streamResponse(
      this.model,
      {
        model: this.model.model,
        messages: requestMessages,
        tools,
        stream: true,
      },
      {
        signal: this.abortSignal,
      },
    )

    // Create a new assistant message for the response if it doesn't exist
    if (this.responseMessages.at(-1)?.role !== 'assistant') {
      this.responseMessages.push({
        role: 'assistant',
        content: '',
        id: uuidv4(),
        metadata: {
          model: this.model,
        },
      })
    }
    const lastMessage = this.responseMessages.at(-1)
    if (lastMessage?.role !== 'assistant') {
      throw new Error('Last message is not an assistant message')
    }
    const responseMessageId = lastMessage.id
    let responseToolCalls: Record<number, ToolCallDelta> = {}
    for await (const chunk of stream) {
      const { updatedToolCalls } = this.processChunk(
        chunk,
        responseMessageId,
        responseToolCalls,
      )
      responseToolCalls = updatedToolCalls
    }
    const toolCallRequests: ToolCallRequest[] = Object.values(responseToolCalls)
      .map((toolCall) => {
        // filter out invalid tool calls without a name
        if (!toolCall.function?.name) {
          return null
        }
        return {
          id: toolCall.id ?? uuidv4(),
          name: toolCall.function.name,
          arguments: toolCall.function.arguments,
        }
      })
      .filter((toolCall) => toolCall !== null)

    this.updateResponseMessages((messages) =>
      messages.map((message) =>
        message.id === responseMessageId && message.role === 'assistant'
          ? {
              ...message,
              toolCallRequests:
                toolCallRequests.length > 0 ? toolCallRequests : undefined,
            }
          : message,
      ),
    )
    return {
      toolCallRequests: toolCallRequests,
    }
  }

  private processChunk(
    chunk: LLMResponseStreaming,
    responseMessageId: string,
    responseToolCalls: Record<number, ToolCallDelta>,
  ): {
    updatedToolCalls: Record<number, ToolCallDelta>
  } {
    const content = chunk.choices[0]?.delta?.content ?? ''
    const reasoning = chunk.choices[0]?.delta?.reasoning
    const toolCalls = chunk.choices[0]?.delta?.tool_calls
    const annotations = chunk.choices[0]?.delta?.annotations

    const updatedToolCalls = toolCalls
      ? this.mergeToolCallDeltas(toolCalls, responseToolCalls)
      : responseToolCalls

    if (annotations) {
      // For annotations with empty titles, fetch the title of the URL and update the chat messages
      fetchAnnotationTitles(annotations, (url, title) => {
        this.updateResponseMessages((messages) =>
          messages.map((message) =>
            message.id === responseMessageId && message.role === 'assistant'
              ? {
                  ...message,
                  annotations: message.annotations?.map((a) =>
                    a.type === 'url_citation' && a.url_citation.url === url
                      ? {
                          ...a,
                          url_citation: {
                            ...a.url_citation,
                            title: title ?? undefined,
                          },
                        }
                      : a,
                  ),
                }
              : message,
          ),
        )
      })
    }

    const providerMetadata = chunk.choices[0]?.delta?.providerMetadata

    this.updateResponseMessages((messages) =>
      messages.map((message) =>
        message.id === responseMessageId && message.role === 'assistant'
          ? {
              ...message,
              content: message.content + content,
              reasoning: reasoning
                ? (message.reasoning ?? '') + reasoning
                : message.reasoning,
              annotations: this.mergeAnnotations(
                message.annotations,
                annotations,
              ),
              metadata: {
                ...message.metadata,
                usage: chunk.usage ?? message.metadata?.usage,
              },
              providerMetadata: mergeProviderMetadata(
                message.providerMetadata,
                providerMetadata,
              ),
            }
          : message,
      ),
    )

    return {
      updatedToolCalls,
    }
  }

  private async callTool(request: ToolCallRequest) {
    const localTool = this.localTools.get(request.name)
    if (!localTool) {
      if (!this.mcpManager) {
        return {
          status: ToolCallResponseStatus.Error,
          error: 'MCP is not available for this response.',
        } as const
      }
      return this.mcpManager.callTool({
        name: request.name,
        args: request.arguments,
        id: request.id,
        signal: this.abortSignal,
      })
    }
    try {
      const args = request.arguments
        ? (JSON.parse(request.arguments) as Record<string, unknown>)
        : {}
      return await localTool.call(args, this.abortSignal)
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return { status: ToolCallResponseStatus.Aborted } as const
      }
      return {
        status: ToolCallResponseStatus.Error,
        error: error instanceof Error ? error.message : String(error),
      } as const
    }
  }

  private createMcpToolSearchTool(): LocalResponseTool {
    return {
      definition: {
        type: 'function',
        function: {
          name: 'search_mcp_tools',
          description:
            'Search the locally cached MCP tool catalog. Use this before calling an MCP tool when tool routing is on demand.',
          parameters: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description:
                  'A concise description of the external capability needed.',
              },
            },
            required: ['query'],
          },
        },
      },
      call: async (args) => {
        const query =
          typeof args.query === 'string' ? args.query : this.mcpQuery
        const matches = this.mcpManager?.searchToolCatalog(query, 12) ?? []
        for (const match of matches) {
          this.mcpConnectionIds.add(match.connectionId)
        }
        return {
          status: ToolCallResponseStatus.Success,
          data: {
            type: 'text',
            text: matches.length
              ? JSON.stringify(matches, null, 2)
              : 'No reviewed MCP tools matched this query.',
          },
        }
      },
    }
  }

  private updateResponseMessages(
    updaterFunction: (messages: ChatMessage[]) => ChatMessage[],
  ) {
    this.responseMessages = updaterFunction(this.responseMessages)
    this.notifySubscribers(this.responseMessages)
  }

  private notifySubscribers(messages: ChatMessage[]) {
    this.subscribers.forEach((callback) => callback(messages))
  }

  private mergeToolCallDeltas(
    toolCalls: ToolCallDelta[],
    existingToolCalls: Record<number, ToolCallDelta>,
  ): Record<number, ToolCallDelta> {
    const merged = { ...existingToolCalls }

    for (const toolCall of toolCalls) {
      const { index } = toolCall

      if (!merged[index]) {
        merged[index] = toolCall
        continue
      }

      const mergedToolCall: ToolCallDelta = {
        index,
        id: merged[index].id ?? toolCall.id,
        type: merged[index].type ?? toolCall.type,
      }

      if (merged[index].function || toolCall.function) {
        const existingArgs = merged[index].function?.arguments
        const newArgs = toolCall.function?.arguments

        mergedToolCall.function = {
          name: merged[index].function?.name ?? toolCall.function?.name,
          arguments:
            existingArgs || newArgs
              ? [existingArgs ?? '', newArgs ?? ''].join('')
              : undefined,
        }
      }

      merged[index] = mergedToolCall
    }

    return merged
  }

  private mergeAnnotations(
    prevAnnotations?: Annotation[],
    newAnnotations?: Annotation[],
  ): Annotation[] | undefined {
    if (!prevAnnotations) return newAnnotations
    if (!newAnnotations) return prevAnnotations

    const mergedAnnotations = [...prevAnnotations]
    for (const newAnnotation of newAnnotations) {
      if (
        !mergedAnnotations.find(
          (annotation) =>
            annotation.url_citation.url === newAnnotation.url_citation.url,
        )
      ) {
        mergedAnnotations.push(newAnnotation)
      }
    }
    return mergedAnnotations
  }
}

export function mergeProviderMetadata(
  existing?: RequestProviderMetadata,
  incoming?: RequestProviderMetadata,
): RequestProviderMetadata | undefined {
  if (!existing) return incoming
  if (!incoming) return existing

  const deepseekReasoning = [
    existing.deepseek?.reasoningContent,
    incoming.deepseek?.reasoningContent,
  ]
    .filter((value): value is string => Boolean(value))
    .join('')

  return {
    ...existing,
    ...incoming,
    anthropic:
      incoming.anthropic?.thinkingBlocks !== undefined
        ? incoming.anthropic
        : existing.anthropic,
    openaiCodex:
      existing.openaiCodex || incoming.openaiCodex
        ? {
            ...existing.openaiCodex,
            ...incoming.openaiCodex,
          }
        : undefined,
    gemini:
      existing.gemini || incoming.gemini
        ? {
            thoughtSignature:
              existing.gemini?.thoughtSignature ??
              incoming.gemini?.thoughtSignature,
          }
        : undefined,
    deepseek: deepseekReasoning
      ? { reasoningContent: deepseekReasoning }
      : undefined,
  }
}
