import type { App } from 'obsidian'

import type { SmartComposerSettings } from '../../settings/schema/setting.types'
import type {
  McpConnectionConfig,
  McpExecutionMode,
  McpServerState,
  McpTool,
} from '../../types/mcp.types'
import { McpServerStatus } from '../../types/mcp.types'
import { ToolCallResponseStatus } from '../../types/tool-call.types'

import { McpManager, listAllMcpTools } from './mcpManager'

jest.mock('obsidian', () => ({
  Platform: { isDesktop: true },
}))

const CONNECTION_ID = '11111111-2222-4333-8444-555555555555'

function createTool(name: string, description = ''): McpTool {
  return {
    name,
    description,
    inputSchema: { type: 'object', properties: {} },
  }
}

function createConnection({
  id = CONNECTION_ID,
  name = 'Research',
  tools = [createTool('search_notes', 'Search notes')],
  reviewed = true,
}: {
  id?: string
  name?: string
  tools?: McpTool[]
  reviewed?: boolean
} = {}): McpConnectionConfig {
  return {
    id,
    name,
    enabled: true,
    transport: {
      type: 'streamable-http',
      url: 'https://example.com/mcp',
      legacySse: false,
    },
    auth: { mode: 'none' },
    toolOptions: Object.fromEntries(
      tools.map((tool) => [
        tool.name,
        {
          reviewedSchemaHash: reviewed ? `hash-${tool.name}` : undefined,
        },
      ]),
    ),
    toolSnapshot: {
      scannedAt: 1,
      hash: 'connection-hash',
      reviewRequired: !reviewed,
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema as Record<string, unknown>,
        schemaHash: `hash-${tool.name}`,
      })),
    },
  }
}

function getRuntimeTools(connection: McpConnectionConfig): McpTool[] {
  return (connection.toolSnapshot?.tools ?? []).map((tool) => ({
    ...tool,
    inputSchema: tool.inputSchema,
  })) as unknown as McpTool[]
}

function createManager(
  connections: McpConnectionConfig[],
  executionMode: McpExecutionMode = 'per-tool',
) {
  let settings = {
    mcp: { routingMode: 'auto', executionMode, connections },
  } as SmartComposerSettings
  const secrets = new Map<string, string>()
  const app = {
    secretStorage: {
      getSecret: (id: string) => secrets.get(id) ?? null,
      setSecret: (id: string, value: string) => {
        secrets.set(id, value)
      },
    },
  } as unknown as App
  const manager = new McpManager({
    app,
    settings,
    setSettings: async (next) => {
      settings = next
    },
    registerSettingsListener: () => () => undefined,
  })
  return { manager, secrets, getSettings: () => settings }
}

function connectWithClient(
  manager: McpManager,
  connection: McpConnectionConfig,
  tools: McpTool[],
  callTool = jest.fn(),
): jest.Mock {
  const disconnected = manager
    .getServers()
    .find((server) => server.config.id === connection.id)
  if (!disconnected) throw new Error('Test connection was not initialized.')
  const state: McpServerState = {
    ...disconnected,
    status: connection.toolSnapshot?.reviewRequired
      ? McpServerStatus.ReviewRequired
      : McpServerStatus.Connected,
    client: {
      callTool,
      close: jest.fn(),
    } as never,
    tools,
  }
  ;(manager as unknown as { servers: McpServerState[] }).servers = manager
    .getServers()
    .map((server) => (server.config.id === connection.id ? state : server))
  return callTool
}

describe('McpManager routing and tool contracts', () => {
  it('collects every paginated MCP tool page', async () => {
    const first = createTool('first')
    const second = createTool('second')
    const listTools = jest
      .fn()
      .mockResolvedValueOnce({ tools: [first], nextCursor: 'page-2' })
      .mockResolvedValueOnce({ tools: [second] })

    await expect(listAllMcpTools({ listTools } as never)).resolves.toEqual([
      first,
      second,
    ])
    expect(listTools).toHaveBeenNthCalledWith(1, undefined)
    expect(listTools).toHaveBeenNthCalledWith(2, { cursor: 'page-2' })
  })

  it('rejects a repeated MCP pagination cursor', async () => {
    const listTools = jest
      .fn()
      .mockResolvedValueOnce({ tools: [], nextCursor: 'same' })
      .mockResolvedValueOnce({ tools: [], nextCursor: 'same' })

    await expect(listAllMcpTools({ listTools } as never)).rejects.toThrow(
      'repeated cursor',
    )
  })

  it('uses a rename-stable connection prefix', async () => {
    const connection = createConnection()
    const { manager } = createManager([connection])
    await manager.initialize()
    const before = manager.getServers()[0].name

    await manager.handleSettingsUpdate({
      mcp: {
        routingMode: 'auto',
        connections: [{ ...connection, name: 'Renamed connection' }],
      },
    } as SmartComposerSettings)

    expect(manager.getServers()[0].name).toBe(before)
    expect(before).toBe('mcp_1111111122224333')
  })

  it('keeps on-demand tools hidden unless a connection is explicit', async () => {
    const connection = createConnection()
    const { manager } = createManager([connection])
    await manager.initialize()
    connectWithClient(manager, connection, getRuntimeTools(connection))

    await expect(
      manager.listAvailableTools({ mode: 'on-demand', query: 'search' }),
    ).resolves.toEqual([])
    await expect(
      manager.listAvailableTools({
        mode: 'on-demand',
        query: 'search',
        connectionIds: [connection.id],
      }),
    ).resolves.toHaveLength(1)
  })

  it('limits automatic routing to three connections and twelve tools', async () => {
    const connections = Array.from({ length: 4 }, (_, index) =>
      createConnection({
        id: `00000000-0000-4000-8000-00000000000${index}`,
        name: index === 3 ? 'Calendar priority' : `Connection ${index}`,
        tools: Array.from({ length: 5 }, (__, toolIndex) =>
          createTool(`tool_${index}_${toolIndex}`, `Calendar ${index}`),
        ),
      }),
    )
    const { manager } = createManager(connections)
    await manager.initialize()
    for (const connection of connections) {
      connectWithClient(manager, connection, getRuntimeTools(connection))
    }

    const tools = await manager.listAvailableTools({
      mode: 'auto',
      query: 'calendar',
    })

    expect(tools).toHaveLength(12)
    expect(
      new Set(tools.map((tool) => tool.name.split('__')[0])).size,
    ).toBeLessThanOrEqual(3)
  })

  it('maps long unsafe request names back to the original server tool', async () => {
    const rawName = `search notes with spaces ${'x'.repeat(80)}`
    const tool = createTool(rawName)
    const connection = createConnection({ tools: [tool] })
    const { manager } = createManager([connection])
    await manager.initialize()
    const callTool = connectWithClient(
      manager,
      connection,
      [tool],
      jest.fn().mockResolvedValue({
        content: [
          { type: 'text', text: 'done' },
          {
            type: 'resource_link',
            uri: 'https://example.com/result',
            name: 'result',
          },
        ],
        structuredContent: { count: 1 },
      }),
    )
    const [listed] = await manager.listAvailableTools({
      mode: 'always',
    })

    expect(listed.name).toMatch(/^[a-zA-Z0-9_-]+$/)
    expect(listed.name.length).toBeLessThanOrEqual(64)
    const response = await manager.callTool({
      name: listed.name,
      args: { query: 'test' },
    })

    expect(callTool).toHaveBeenCalledWith(
      { name: rawName, arguments: { query: 'test' } },
      undefined,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(response.status).toBe(ToolCallResponseStatus.Success)
    if (response.status === ToolCallResponseStatus.Success) {
      expect(response.data.text).toContain('done')
      expect(response.data.text).toContain('Structured content')
      expect(response.data.structuredContent).toEqual({ count: 1 })
    }
  })

  it('blocks unreviewed schemas and never auto-runs delete tools', async () => {
    const deleteTool = createTool('delete_everything')
    const connection = createConnection({ tools: [deleteTool] })
    connection.toolOptions[deleteTool.name] = {
      reviewedSchemaHash: `hash-${deleteTool.name}`,
      allowAutoExecution: true,
      risk: 'delete',
    }
    const { manager } = createManager([connection])
    await manager.initialize()
    connectWithClient(manager, connection, [deleteTool])
    const [listed] = await manager.listAvailableTools({ mode: 'always' })

    expect(
      manager.isToolExecutionAllowed({ requestToolName: listed.name }),
    ).toBe(false)

    connection.toolOptions[deleteTool.name] = {}
    const response = await manager.callTool({ name: listed.name })
    expect(response).toEqual(
      expect.objectContaining({
        status: ToolCallResponseStatus.Error,
        error: 'This MCP tool schema has not been reviewed.',
      }),
    )
  })

  it('allows every reviewed enabled tool in full-auto mode', async () => {
    const deleteTool = createTool('delete_everything')
    const connection = createConnection({ tools: [deleteTool] })
    connection.toolOptions[deleteTool.name] = {
      reviewedSchemaHash: `hash-${deleteTool.name}`,
      risk: 'delete',
    }
    const { manager } = createManager([connection], 'full-auto')
    await manager.initialize()
    connectWithClient(manager, connection, [deleteTool])
    const [listed] = await manager.listAvailableTools({ mode: 'always' })

    expect(
      manager.isToolExecutionAllowed({ requestToolName: listed.name }),
    ).toBe(true)
  })

  it('limits safe-auto mode to read-only tools', async () => {
    const readTool = createTool('search_notes')
    const writeTool = createTool('create_note')
    const connection = createConnection({ tools: [readTool, writeTool] })
    connection.toolOptions[readTool.name] = {
      reviewedSchemaHash: `hash-${readTool.name}`,
      risk: 'read',
    }
    connection.toolOptions[writeTool.name] = {
      reviewedSchemaHash: `hash-${writeTool.name}`,
      risk: 'write',
    }
    const { manager } = createManager([connection], 'safe-auto')
    await manager.initialize()
    connectWithClient(manager, connection, [readTool, writeTool])
    const listed = await manager.listAvailableTools({ mode: 'always' })
    const readRequest = listed.find((tool) =>
      tool.name.endsWith('search_notes'),
    )
    const writeRequest = listed.find((tool) =>
      tool.name.endsWith('create_note'),
    )

    expect(
      manager.isToolExecutionAllowed({
        requestToolName: readRequest?.name ?? '',
      }),
    ).toBe(true)
    expect(
      manager.isToolExecutionAllowed({
        requestToolName: writeRequest?.name ?? '',
      }),
    ).toBe(false)
  })

  it('automatically reviews the current scan snapshot in full-auto mode', async () => {
    const tool = createTool('delete_note')
    const connection = createConnection({ tools: [tool], reviewed: false })
    const { manager, getSettings } = createManager([connection], 'full-auto')
    const persistToolSnapshot = (
      manager as unknown as {
        persistToolSnapshot: (
          connection: McpConnectionConfig,
          tools: McpTool[],
        ) => Promise<McpConnectionConfig>
      }
    ).persistToolSnapshot.bind(manager)

    const updated = await persistToolSnapshot(connection, [tool])
    const snapshot = updated.toolSnapshot?.tools[0]

    expect(updated.toolSnapshot?.reviewRequired).toBe(false)
    expect(updated.toolOptions[tool.name]).toEqual(
      expect.objectContaining({
        reviewedSchemaHash: snapshot?.schemaHash,
        risk: 'delete',
      }),
    )
    expect(getSettings().mcp.connections[0].toolSnapshot?.reviewRequired).toBe(
      false,
    )
  })

  it('rejects a disabled tool even when an old request replays its name', async () => {
    const tool = createTool('search_notes')
    const connection = createConnection({ tools: [tool] })
    const { manager } = createManager([connection])
    await manager.initialize()
    const callTool = connectWithClient(manager, connection, [tool])
    const [listed] = await manager.listAvailableTools({ mode: 'always' })

    connection.toolOptions[tool.name] = {
      ...connection.toolOptions[tool.name],
      disabled: true,
    }
    const response = await manager.callTool({ name: listed.name })

    expect(response).toEqual(
      expect.objectContaining({
        status: ToolCallResponseStatus.Error,
        error: 'This MCP tool is disabled.',
      }),
    )
    expect(callTool).not.toHaveBeenCalled()
  })

  it('disconnects and clears only stored session credentials', async () => {
    const connection = createConnection()
    connection.auth = {
      mode: 'oauth-client',
      clientId: 'client-id',
      clientSecretId: 'client-secret-id',
      accessTokenSecretId: 'access-token-id',
      refreshTokenSecretId: 'refresh-token-id',
      tokenExpiresAt: Date.now() + 60_000,
    }
    const { manager, secrets, getSettings } = createManager([connection])
    secrets.set('client-secret-id', 'keep-client-secret')
    secrets.set('access-token-id', 'remove-access-token')
    secrets.set('refresh-token-id', 'remove-refresh-token')
    await manager.initialize()
    const close = jest.fn()
    connectWithClient(manager, connection, [], jest.fn())
    const connected = manager.getServers()[0]
    if (
      connected.status === McpServerStatus.Connected ||
      connected.status === McpServerStatus.ReviewRequired
    ) {
      ;(connected.client as unknown as { close: jest.Mock }).close = close
    }

    await manager.disconnectConnection(connection.id, {
      clearCredentials: true,
    })

    expect(manager.getServers()[0].status).toBe(McpServerStatus.Disconnected)
    expect(close).toHaveBeenCalled()
    expect(getSettings().mcp.connections[0].auth).toEqual(
      expect.objectContaining({
        clientId: 'client-id',
        clientSecretId: 'client-secret-id',
        accessTokenSecretId: undefined,
        refreshTokenSecretId: undefined,
      }),
    )
    expect(secrets.get('client-secret-id')).toBe('keep-client-secret')
    expect(secrets.get('access-token-id')).toBe('')
    expect(secrets.get('refresh-token-id')).toBe('')
  })
})
