import {
  ToolCallRequest,
  ToolCallResponseStatus,
} from '../../types/tool-call.types'

import { LocalResponseTool, ResponseGenerator } from './responseGenerator'

describe('ResponseGenerator local tools', () => {
  const localTool: LocalResponseTool = {
    definition: {
      type: 'function',
      function: {
        name: 'enqueue_image_generation',
        description: 'Queue an image.',
        parameters: {
          type: 'object',
          properties: { prompt: { type: 'string' } },
          required: ['prompt'],
          additionalProperties: false,
        },
      },
    },
    call: jest.fn(async (args) => ({
      status: ToolCallResponseStatus.Success as const,
      data: { type: 'text' as const, text: String(args.prompt) },
    })),
  }

  function createGenerator() {
    const mcpManager = {
      callTool: jest.fn(),
    }
    const generator = new ResponseGenerator({
      providerClient: {} as never,
      model: {
        id: 'gpt-5.6-sol (plan)',
        model: 'gpt-5.6-sol',
        providerId: 'openai-plan',
        providerType: 'openai-plan',
      },
      messages: [],
      conversationId: 'conversation',
      enableTools: false,
      maxAutoIterations: 2,
      promptGenerator: {} as never,
      mcpManager: mcpManager as never,
      localTools: [localTool],
    })
    return { generator, mcpManager }
  }

  it('executes a plugin-local tool without routing through MCP', async () => {
    const { generator, mcpManager } = createGenerator()
    const callTool = (
      generator as unknown as {
        callTool: (request: ToolCallRequest) => Promise<unknown>
      }
    ).callTool.bind(generator)

    await expect(
      callTool({
        id: 'tool-call',
        name: 'enqueue_image_generation',
        arguments: '{"prompt":"Draw a research map"}',
      }),
    ).resolves.toEqual({
      status: ToolCallResponseStatus.Success,
      data: { type: 'text', text: 'Draw a research map' },
    })
    expect(localTool.call).toHaveBeenCalledWith(
      { prompt: 'Draw a research map' },
      undefined,
    )
    expect(mcpManager.callTool).not.toHaveBeenCalled()
  })

  it('returns a terminal error for malformed local-tool JSON', async () => {
    const { generator } = createGenerator()
    const callTool = (
      generator as unknown as {
        callTool: (request: ToolCallRequest) => Promise<unknown>
      }
    ).callTool.bind(generator)

    const result = await callTool({
      id: 'tool-call',
      name: 'enqueue_image_generation',
      arguments: '{',
    })
    expect(result).toMatchObject({
      status: ToolCallResponseStatus.Error,
    })
  })

  it('discovers on-demand MCP connections locally before exposing tools', async () => {
    const listAvailableTools = jest.fn().mockResolvedValue([])
    const searchToolCatalog = jest.fn().mockReturnValue([
      {
        connectionId: 'law-connection',
        connectionName: 'Korean Law',
        toolName: 'search_statutes',
      },
    ])
    const providerClient = {
      streamResponse: jest.fn().mockResolvedValue(
        (async function* () {
          yield { choices: [{ delta: { content: '' } }] }
        })(),
      ),
    }
    const promptGenerator = {
      generateRequestMessages: jest.fn().mockResolvedValue([]),
    }
    const generator = new ResponseGenerator({
      providerClient: providerClient as never,
      model: {
        id: 'gpt-5.6-sol (plan)',
        model: 'gpt-5.6-sol',
        providerId: 'openai-plan',
        providerType: 'openai-plan',
      },
      messages: [],
      conversationId: 'conversation',
      enableTools: true,
      maxAutoIterations: 1,
      promptGenerator: promptGenerator as never,
      mcpManager: {
        listAvailableTools,
        searchToolCatalog,
        callTool: jest.fn(),
      } as never,
      mcpRoutingMode: 'on-demand',
      mcpQuery: 'Find the relevant statute',
    })
    const callTool = (
      generator as unknown as {
        callTool: (request: ToolCallRequest) => Promise<unknown>
        streamSingleResponse: () => Promise<unknown>
      }
    ).callTool.bind(generator)
    const streamSingleResponse = (
      generator as unknown as {
        streamSingleResponse: () => Promise<unknown>
      }
    ).streamSingleResponse.bind(generator)

    await callTool({
      id: 'search-call',
      name: 'search_mcp_tools',
      arguments: '{"query":"Korean statute search"}',
    })
    await streamSingleResponse()

    expect(searchToolCatalog).toHaveBeenCalledWith('Korean statute search', 12)
    expect(listAvailableTools).toHaveBeenCalledWith({
      mode: 'on-demand',
      query: 'Find the relevant statute',
      connectionIds: ['law-connection'],
    })
  })
})
