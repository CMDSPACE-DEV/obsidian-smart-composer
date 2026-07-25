import type { App } from 'obsidian'
import { Platform } from 'obsidian'

import type { SmartComposerSettings } from '../../settings/schema/setting.types'
import type {
  McpClient,
  McpConnectionConfig,
  McpRoutingMode,
  McpServerState,
  McpTool,
  McpToolCallResult,
  McpToolRisk,
  McpToolSnapshot,
} from '../../types/mcp.types'
import { McpServerStatus } from '../../types/mcp.types'
import {
  type ToolCallResponse,
  ToolCallResponseStatus,
} from '../../types/tool-call.types'

import { InvalidToolNameException, McpNotAvailableException } from './exception'
import {
  McpOAuthProvider,
  generateMcpOAuthState,
  startMcpOAuthCallbackSession,
} from './McpOAuthProvider'
import {
  McpSecretStore,
  clearUnusedMcpConnectionSecrets,
} from './McpSecretStore'
import {
  MCP_TOOL_NAME_DELIMITER,
  getToolName,
  parseToolName,
} from './tool-name-utils'

type SettingsUpdater = (settings: SmartComposerSettings) => Promise<void>

export type McpToolListOptions = {
  mode?: McpRoutingMode
  query?: string
  connectionIds?: string[]
}

export type McpToolInfo = {
  connection: McpConnectionConfig
  tool: McpTool
  risk: McpToolRisk
  supportsServerTask: boolean
}

export type McpBackgroundToolResult = {
  text: string
  structuredContent?: Record<string, unknown>
  externalTaskId?: string
  resumable: boolean
}

type ConnectedMcpServerState = Extract<McpServerState, { client: unknown }> & {
  status: McpServerStatus.Connected
}

export class McpManager {
  static readonly TOOL_NAME_DELIMITER = MCP_TOOL_NAME_DELIMITER

  public readonly disabled = !Platform.isDesktop

  private settings: SmartComposerSettings
  private readonly app: App
  private readonly setSettings: SettingsUpdater
  private readonly secretStore: McpSecretStore
  private readonly unsubscribeFromSettings: () => void
  private defaultEnv: Record<string, string> | null = null
  private servers: McpServerState[] = []
  private activeToolCalls = new Map<string, AbortController>()
  private connectionPromises = new Map<string, Promise<McpServerState>>()
  private allowedToolsByConversation = new Map<string, Set<string>>()
  private subscribers = new Set<(servers: McpServerState[]) => void>()

  constructor({
    app,
    settings,
    setSettings,
    registerSettingsListener,
  }: {
    app: App
    settings: SmartComposerSettings
    setSettings: SettingsUpdater
    registerSettingsListener: (
      listener: (settings: SmartComposerSettings) => void,
    ) => () => void
  }) {
    this.app = app
    this.settings = settings
    this.setSettings = setSettings
    this.secretStore = new McpSecretStore(app)
    this.unsubscribeFromSettings = registerSettingsListener((newSettings) => {
      void this.handleSettingsUpdate(newSettings)
    })
  }

  public async initialize(): Promise<void> {
    if (this.disabled) return
    this.servers = this.settings.mcp.connections.map((config) =>
      this.disconnectedState(config),
    )
    this.notifySubscribers()
  }

  public cleanup(): void {
    for (const controller of this.activeToolCalls.values()) {
      controller.abort()
    }
    void Promise.all(
      this.servers
        .filter(
          (
            server,
          ): server is Extract<
            McpServerState,
            {
              status: McpServerStatus.Connected | McpServerStatus.ReviewRequired
            }
          > =>
            server.status === McpServerStatus.Connected ||
            server.status === McpServerStatus.ReviewRequired,
        )
        .map((server) => server.client.close()),
    )
    this.unsubscribeFromSettings()
    this.servers = []
    this.subscribers.clear()
    this.activeToolCalls.clear()
    this.connectionPromises.clear()
  }

  public getServers(): McpServerState[] {
    return this.servers
  }

  public subscribeServersChange(
    callback: (servers: McpServerState[]) => void,
  ): () => void {
    this.subscribers.add(callback)
    return () => this.subscribers.delete(callback)
  }

  public async handleSettingsUpdate(
    settings: SmartComposerSettings,
  ): Promise<void> {
    const previousServers = this.servers
    this.settings = settings
    const nextServers = settings.mcp.connections.map((config) => {
      const existing = previousServers.find(
        (server) => server.config.id === config.id,
      )
      if (
        existing &&
        stableStringify(existing.config.transport) ===
          stableStringify(config.transport) &&
        stableStringify(existing.config.auth) ===
          stableStringify(config.auth) &&
        existing.config.enabled === config.enabled
      ) {
        return { ...existing, config }
      }
      return this.disconnectedState(config)
    })
    this.updateServers(nextServers)
  }

  public async scanConnection(
    connectionId: string,
    interactive = false,
  ): Promise<McpServerState> {
    const config = this.getConnection(connectionId)
    if (!config) throw new Error('MCP connection not found.')
    const state = await this.connectConnection(config, interactive, true)
    this.replaceServer(state)
    return state
  }

  public async connectAndAuthorize(
    connectionId: string,
  ): Promise<McpServerState> {
    return this.scanConnection(connectionId, true)
  }

  public async disconnectConnection(
    connectionId: string,
    { clearCredentials = false }: { clearCredentials?: boolean } = {},
  ): Promise<void> {
    const previous = this.getConnection(connectionId)
    if (!previous) throw new Error('MCP connection not found.')

    let next = previous
    if (clearCredentials) {
      next = {
        ...previous,
        securityIssue: undefined,
        auth: {
          ...previous.auth,
          bearerSecretId: undefined,
          accessTokenSecretId: undefined,
          refreshTokenSecretId: undefined,
          tokenExpiresAt: undefined,
        },
      }
      await this.updateConnection(connectionId, () => next)
      clearUnusedMcpConnectionSecrets(this.secretStore, previous, next)
    }
    this.replaceServer(this.disconnectedState(next))
  }

  public async approveToolSnapshot(
    connectionId: string,
    overrides: Record<
      string,
      {
        disabled?: boolean
        allowAutoExecution?: boolean
        risk?: McpToolRisk
      }
    > = {},
  ): Promise<void> {
    const connection = this.getConnection(connectionId)
    if (!connection?.toolSnapshot) {
      throw new Error('Scan the connection before reviewing its tools.')
    }
    const toolOptions = { ...connection.toolOptions }
    for (const tool of connection.toolSnapshot.tools) {
      const existing = toolOptions[tool.name] ?? {}
      const override = overrides[tool.name] ?? {}
      toolOptions[tool.name] = {
        ...existing,
        ...override,
        risk:
          override.risk ??
          existing.risk ??
          inferToolRisk(tool.annotations, tool.name),
        reviewedSchemaHash: tool.schemaHash,
      }
    }
    await this.updateConnection(connectionId, (current) => ({
      ...current,
      toolOptions,
      toolSnapshot: current.toolSnapshot
        ? {
            ...current.toolSnapshot,
            reviewRequired: false,
          }
        : undefined,
    }))
    this.updateServers((servers) =>
      servers.map((server) =>
        server.config.id === connectionId &&
        server.status === McpServerStatus.ReviewRequired
          ? {
              ...server,
              status: McpServerStatus.Connected,
              config: this.getConnection(connectionId) ?? server.config,
            }
          : server,
      ),
    )
  }

  public async listAvailableTools(
    options: McpToolListOptions = {},
  ): Promise<McpTool[]> {
    if (this.disabled) return []
    const mode = options.mode ?? this.settings.mcp.routingMode
    if (mode === 'off') return []

    const selected = this.selectConnections({
      mode,
      query: options.query ?? '',
      connectionIds: options.connectionIds ?? [],
    })
    const connected = await Promise.all(
      selected.map((connection) => this.ensureConnected(connection.id)),
    )
    const maxTools = mode === 'auto' && !options.connectionIds?.length ? 12 : 80
    const tools = connected.flatMap((server) => {
      if (server.status !== McpServerStatus.Connected) return []
      return server.tools
        .filter((tool) => !server.config.toolOptions[tool.name]?.disabled)
        .filter(
          (tool) =>
            server.config.toolOptions[tool.name]?.reviewedSchemaHash ===
            snapshotTool(server.config, tool.name)?.schemaHash,
        )
        .map((tool) => ({
          ...tool,
          name: getRequestToolName(server.name, tool.name),
        }))
    })
    return rankTools(tools, options.query ?? '').slice(0, maxTools)
  }

  public searchToolCatalog(
    query: string,
    limit = 12,
  ): {
    connectionId: string
    connectionName: string
    toolName: string
    description?: string
  }[] {
    const normalized = query.toLowerCase()
    return this.settings.mcp.connections
      .filter((connection) => connection.enabled)
      .flatMap((connection) =>
        getReviewedToolSnapshots(connection).map((tool) => ({
          connectionId: connection.id,
          connectionName: connection.name,
          toolName: tool.name,
          description: tool.description,
          score: lexicalScore(
            normalized,
            `${connection.name} ${tool.name} ${tool.description ?? ''}`,
          ),
        })),
      )
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ score: _score, ...result }) => result)
  }

  public allowToolForConversation(
    requestToolName: string,
    conversationId: string,
  ): boolean {
    if (!this.getToolInfo(requestToolName)) return false
    const allowed =
      this.allowedToolsByConversation.get(conversationId) ?? new Set<string>()
    allowed.add(requestToolName)
    this.allowedToolsByConversation.set(conversationId, allowed)
    return true
  }

  public isToolExecutionAllowed({
    requestToolName,
    conversationId,
  }: {
    requestToolName: string
    conversationId?: string
  }): boolean {
    if (
      conversationId &&
      this.allowedToolsByConversation.get(conversationId)?.has(requestToolName)
    ) {
      return true
    }
    const info = this.getToolInfo(requestToolName)
    if (!info) return false
    return (
      info.risk !== 'delete' &&
      (info.connection.toolOptions[info.tool.name]?.allowAutoExecution ?? false)
    )
  }

  public getToolInfo(requestToolName: string): McpToolInfo | null {
    try {
      const { serverName, toolName } = parseToolName(requestToolName)
      const server = this.findServer(serverName)
      if (!server || !isConnectedServer(server)) return null
      const tool = findRequestedTool(server.tools, server.name, toolName)
      if (!tool) return null
      const snapshot = snapshotTool(server.config, tool.name)
      const options = server.config.toolOptions[tool.name]
      if (
        options?.disabled ||
        options?.reviewedSchemaHash !== snapshot?.schemaHash
      ) {
        return null
      }
      return {
        connection: server.config,
        tool,
        risk:
          server.config.toolOptions[tool.name]?.risk ??
          inferToolRisk(snapshot?.annotations, tool.name),
        supportsServerTask:
          snapshot?.execution?.taskSupport === 'optional' ||
          snapshot?.execution?.taskSupport === 'required' ||
          Boolean(
            (
              server.serverCapabilities as {
                tasks?: { requests?: { tools?: { call?: object } } }
              }
            )?.tasks?.requests?.tools?.call,
          ),
      }
    } catch (error) {
      if (error instanceof InvalidToolNameException) return null
      throw error
    }
  }

  public async runBackgroundTool({
    connectionId,
    toolName,
    args,
    externalTaskId,
    signal,
    onTaskCreated,
    onProgress,
  }: {
    connectionId: string
    toolName: string
    args?: Record<string, unknown>
    externalTaskId?: string
    signal: AbortSignal
    onTaskCreated?: (taskId: string) => Promise<void>
    onProgress?: (message: string) => Promise<void>
  }): Promise<McpBackgroundToolResult> {
    const server = await this.ensureConnected(connectionId)
    if (server.status === McpServerStatus.ReviewRequired) {
      throw new Error('Review changed MCP tools before using them.')
    }
    if (!isConnectedServer(server)) {
      throw new Error(
        server.status === McpServerStatus.AuthenticationRequired
          ? 'MCP authentication is required.'
          : 'MCP connection is unavailable.',
      )
    }
    const tool = findRequestedTool(server.tools, server.name, toolName)
    if (!tool) throw new Error(`MCP tool ${toolName} is unavailable.`)
    const snapshot = snapshotTool(server.config, tool.name)
    if (server.config.toolOptions[tool.name]?.disabled) {
      throw new Error('This MCP tool is disabled.')
    }
    if (
      server.config.toolOptions[tool.name]?.reviewedSchemaHash !==
      snapshot?.schemaHash
    ) {
      throw new Error('This MCP tool schema has not been reviewed.')
    }

    if (externalTaskId) {
      return this.resumeServerTask({
        server,
        taskId: externalTaskId,
        signal,
        onProgress,
      })
    }

    const supportsServerTask =
      snapshot?.execution?.taskSupport === 'optional' ||
      snapshot?.execution?.taskSupport === 'required' ||
      Boolean(
        (
          server.serverCapabilities as {
            tasks?: { requests?: { tools?: { call?: object } } }
          }
        )?.tasks?.requests?.tools?.call,
      )
    if (!supportsServerTask) {
      const result = (await server.client.callTool(
        { name: tool.name, arguments: args },
        undefined,
        { signal },
      )) as McpToolCallResult
      if (result.isError) throw new Error(serializeToolResult(result))
      return {
        text: serializeToolResult(result),
        structuredContent: result.structuredContent,
        resumable: false,
      }
    }

    const { CallToolResultSchema } = await import(
      '@modelcontextprotocol/sdk/types.js'
    )
    let taskId: string | undefined
    let finalResult: McpToolCallResult | undefined
    const cancelOnAbort = () => {
      if (taskId) {
        void server.client.experimental.tasks
          .cancelTask(taskId)
          .catch(() => undefined)
      }
    }
    signal.addEventListener('abort', cancelOnAbort, { once: true })
    try {
      const stream = server.client.experimental.tasks.callToolStream(
        { name: tool.name, arguments: args },
        CallToolResultSchema,
        {
          signal,
          task: {
            ttl: 24 * 60 * 60 * 1000,
          },
        },
      )
      for await (const message of stream) {
        if (message.type === 'taskCreated') {
          taskId = message.task.taskId
          await onTaskCreated?.(taskId)
          await onProgress?.(
            message.task.statusMessage ?? 'Remote MCP task started',
          )
        } else if (message.type === 'taskStatus') {
          await onProgress?.(
            message.task.statusMessage ??
              `Remote MCP task: ${message.task.status}`,
          )
        } else if (message.type === 'result') {
          finalResult = message.result as McpToolCallResult
        } else if (message.type === 'error') {
          throw new Error(message.error.message)
        }
      }
    } finally {
      signal.removeEventListener('abort', cancelOnAbort)
    }
    if (!finalResult) {
      throw new Error('Remote MCP task ended without a result.')
    }
    if (finalResult.isError) {
      throw new Error(serializeToolResult(finalResult))
    }
    return {
      text: serializeToolResult(finalResult),
      structuredContent: finalResult.structuredContent,
      externalTaskId: taskId,
      resumable: Boolean(taskId),
    }
  }

  public async callTool({
    name,
    args,
    id,
    signal,
  }: {
    name: string
    args?: Record<string, unknown> | string
    id?: string
    signal?: AbortSignal
  }): Promise<
    Extract<
      ToolCallResponse,
      {
        status:
          | ToolCallResponseStatus.Success
          | ToolCallResponseStatus.Error
          | ToolCallResponseStatus.Aborted
      }
    >
  > {
    if (this.disabled) throw new McpNotAvailableException()
    const controller = new AbortController()
    if (id) {
      this.activeToolCalls.get(id)?.abort()
      this.activeToolCalls.set(id, controller)
    }
    const abortFromSignal = () => controller.abort()
    signal?.addEventListener('abort', abortFromSignal, {
      once: true,
    })

    try {
      const { serverName, toolName } = parseToolName(name)
      const existing = this.findServer(serverName)
      if (!existing) throw new Error('MCP connection not found.')
      const server = await this.ensureConnected(existing.config.id)
      if (server.status === McpServerStatus.ReviewRequired) {
        throw new Error('Review changed MCP tools before using them.')
      }
      if (!isConnectedServer(server)) {
        throw new Error(
          server.status === McpServerStatus.AuthenticationRequired
            ? 'This MCP connection requires authentication.'
            : 'MCP connection is not available.',
        )
      }
      const tool = findRequestedTool(server.tools, server.name, toolName)
      if (!tool) throw new Error(`MCP tool ${toolName} is unavailable.`)
      const snapshot = snapshotTool(server.config, tool.name)
      if (server.config.toolOptions[tool.name]?.disabled) {
        throw new Error('This MCP tool is disabled.')
      }
      if (
        server.config.toolOptions[tool.name]?.reviewedSchemaHash !==
        snapshot?.schemaHash
      ) {
        throw new Error('This MCP tool schema has not been reviewed.')
      }
      const parsedArgs =
        typeof args === 'string'
          ? args
            ? (JSON.parse(args) as Record<string, unknown>)
            : {}
          : args
      const result = (await server.client.callTool(
        { name: tool.name, arguments: parsedArgs },
        undefined,
        { signal: controller.signal },
      )) as McpToolCallResult
      const text = serializeToolResult(result)
      if (result.isError) {
        return { status: ToolCallResponseStatus.Error, error: text }
      }
      return {
        status: ToolCallResponseStatus.Success,
        data: {
          type: 'text',
          text,
          structuredContent: result.structuredContent,
        },
      }
    } catch (error) {
      if (
        controller.signal.aborted ||
        (error instanceof Error && error.name === 'AbortError')
      ) {
        return { status: ToolCallResponseStatus.Aborted }
      }
      return {
        status: ToolCallResponseStatus.Error,
        error: error instanceof Error ? error.message : String(error),
      }
    } finally {
      signal?.removeEventListener('abort', abortFromSignal)
      if (id) this.activeToolCalls.delete(id)
    }
  }

  public abortToolCall(id: string): boolean {
    const controller = this.activeToolCalls.get(id)
    if (!controller) return false
    controller.abort()
    this.activeToolCalls.delete(id)
    return true
  }

  private async ensureConnected(connectionId: string): Promise<McpServerState> {
    const existing = this.servers.find(
      (server) => server.config.id === connectionId,
    )
    if (
      existing &&
      (existing.status === McpServerStatus.Connected ||
        existing.status === McpServerStatus.ReviewRequired)
    ) {
      return existing
    }
    const config = this.getConnection(connectionId)
    if (!config) throw new Error('MCP connection not found.')
    const pending = this.connectionPromises.get(connectionId)
    if (pending) return pending
    const connectionPromise = this.connectConnection(config, false, true).then(
      (connected) => {
        this.replaceServer(connected)
        return connected
      },
    )
    this.connectionPromises.set(connectionId, connectionPromise)
    try {
      return await connectionPromise
    } finally {
      if (this.connectionPromises.get(connectionId) === connectionPromise) {
        this.connectionPromises.delete(connectionId)
      }
    }
  }

  private async resumeServerTask({
    server,
    taskId,
    signal,
    onProgress,
  }: {
    server: ConnectedMcpServerState
    taskId: string
    signal: AbortSignal
    onProgress?: (message: string) => Promise<void>
  }): Promise<McpBackgroundToolResult> {
    const { CallToolResultSchema } = await import(
      '@modelcontextprotocol/sdk/types.js'
    )
    const cancelOnAbort = () => {
      void server.client.experimental.tasks
        .cancelTask(taskId)
        .catch(() => undefined)
    }
    signal.addEventListener('abort', cancelOnAbort, { once: true })
    try {
      while (!signal.aborted) {
        const task = await server.client.experimental.tasks.getTask(taskId, {
          signal,
        })
        await onProgress?.(
          task.statusMessage ?? `Remote MCP task: ${task.status}`,
        )
        if (task.status === 'completed') {
          const result = (await server.client.experimental.tasks.getTaskResult(
            taskId,
            CallToolResultSchema,
            { signal },
          )) as McpToolCallResult
          if (result.isError) throw new Error(serializeToolResult(result))
          return {
            text: serializeToolResult(result),
            structuredContent: result.structuredContent,
            externalTaskId: taskId,
            resumable: true,
          }
        }
        if (task.status === 'failed' || task.status === 'cancelled') {
          throw new Error(
            task.statusMessage ?? `Remote MCP task ${task.status}.`,
          )
        }
        if (task.status === 'input_required') {
          throw new Error(
            task.statusMessage ??
              'Remote MCP task requires input that this client cannot provide yet.',
          )
        }
        await delay(Math.max(500, task.pollInterval ?? 1000), signal)
      }
      throw new DOMException('Aborted', 'AbortError')
    } finally {
      signal.removeEventListener('abort', cancelOnAbort)
    }
  }

  private async connectConnection(
    config: McpConnectionConfig,
    interactive: boolean,
    scanTools: boolean,
  ): Promise<McpServerState> {
    if (this.disabled) throw new McpNotAvailableException()
    if (!config.enabled) return this.disconnectedState(config)
    if (config.securityIssue === 'secret-migration-failed') {
      return {
        name: connectionToolPrefix(config),
        config,
        status: McpServerStatus.Error,
        error: new Error(
          'A legacy MCP secret could not be moved to SecretStorage.',
        ),
      }
    }

    this.replaceServer({
      name: connectionToolPrefix(config),
      config,
      status: McpServerStatus.Connecting,
    })
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const client = new Client(
      { name: 'smart-composer-achmage', version: '2.3.0' },
      { capabilities: { tasks: { list: {}, cancel: {} } } },
    )

    try {
      if (config.transport.type === 'stdio') {
        const { StdioClientTransport } = await import(
          '@modelcontextprotocol/sdk/client/stdio.js'
        )
        const secretEnv = Object.fromEntries(
          Object.entries(config.transport.secretEnv).flatMap(
            ([name, secretId]) => {
              const value = this.secretStore.get(secretId)
              return value ? [[name, value]] : []
            },
          ),
        )
        await client.connect(
          new StdioClientTransport({
            command: config.transport.command,
            args: config.transport.args,
            env: {
              ...(await this.getDefaultEnv()),
              ...config.transport.env,
              ...secretEnv,
            },
          }),
        )
      } else {
        validateRemoteUrl(config.transport.url)
        if (
          config.auth.mode === 'bearer' &&
          !this.secretStore.has(config.auth.bearerSecretId)
        ) {
          return {
            name: connectionToolPrefix(config),
            config,
            status: McpServerStatus.AuthenticationRequired,
          }
        }
        const url = new URL(config.transport.url)
        const requestInit = this.getRemoteRequestInit(config)
        const usesOAuth =
          config.auth.mode === 'automatic' ||
          config.auth.mode === 'oauth-client'
        const state = generateMcpOAuthState()
        const callback =
          interactive && usesOAuth
            ? await startMcpOAuthCallbackSession(state)
            : null
        const provider = usesOAuth
          ? new McpOAuthProvider(
              config,
              this.secretStore,
              callback?.redirectUrl ??
                new URL('http://127.0.0.1/mcp-oauth/callback'),
              state,
              interactive,
              async (updater) => {
                await this.updateConnection(config.id, updater)
              },
            )
          : undefined
        const createTransport = async () =>
          config.transport.type === 'streamable-http' &&
          config.transport.legacySse
            ? new (
                await import('@modelcontextprotocol/sdk/client/sse.js')
              ).SSEClientTransport(url, {
                authProvider: provider,
                requestInit,
                fetch: requestInit.headers
                  ? createHeaderFetch(requestInit.headers)
                  : undefined,
              })
            : new (
                await import(
                  '@modelcontextprotocol/sdk/client/streamableHttp.js'
                )
              ).StreamableHTTPClientTransport(url, {
                authProvider: provider,
                requestInit,
              })
        let transport = await createTransport()
        try {
          await client.connect(transport)
        } catch (error) {
          const { UnauthorizedError } = await import(
            '@modelcontextprotocol/sdk/client/auth.js'
          )
          if (!(error instanceof UnauthorizedError)) throw error
          if (!provider || !interactive || !callback) {
            await callback?.close()
            return {
              name: connectionToolPrefix(config),
              config,
              status: McpServerStatus.AuthenticationRequired,
            }
          }
          const code = await callback.waitForCode
          await transport.finishAuth(code)
          await transport.close().catch(() => undefined)
          transport = await createTransport()
          await client.connect(transport)
        } finally {
          await callback?.close()
        }
      }

      const tools = scanTools ? await listAllMcpTools(client) : []
      const serverCapabilities = client.getServerCapabilities() as
        | Record<string, unknown>
        | undefined
      const latestConfig = this.getConnection(config.id) ?? config
      const scannedConfig = scanTools
        ? await this.persistToolSnapshot(latestConfig, tools)
        : latestConfig
      return {
        name: connectionToolPrefix(scannedConfig),
        config: scannedConfig,
        status: scannedConfig.toolSnapshot?.reviewRequired
          ? McpServerStatus.ReviewRequired
          : McpServerStatus.Connected,
        client,
        tools,
        serverCapabilities,
      }
    } catch (error) {
      await client.close().catch(() => undefined)
      return {
        name: connectionToolPrefix(config),
        config: this.getConnection(config.id) ?? config,
        status: McpServerStatus.Error,
        error: new Error(
          `Failed to connect to ${config.name}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ),
      }
    }
  }

  private getRemoteRequestInit(connection: McpConnectionConfig): RequestInit {
    if (
      connection.transport.type !== 'streamable-http' ||
      connection.auth.mode !== 'bearer'
    ) {
      return {}
    }
    const token = this.secretStore.get(connection.auth.bearerSecretId)
    if (!token) {
      throw new Error('Bearer token is missing.')
    }
    return {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  }

  private async persistToolSnapshot(
    connection: McpConnectionConfig,
    tools: McpTool[],
  ): Promise<McpConnectionConfig> {
    const snapshots = await Promise.all(tools.map(toToolSnapshot))
    const hash = await secureStableHash(snapshots)
    const previous = connection.toolSnapshot
    const reviewRequired =
      previous?.hash !== hash ||
      snapshots.some(
        (tool) =>
          connection.toolOptions[tool.name]?.reviewedSchemaHash !==
          tool.schemaHash,
      )
    const updated = {
      ...connection,
      securityIssue: undefined,
      toolSnapshot: {
        scannedAt: Date.now(),
        hash,
        tools: snapshots,
        reviewRequired,
      },
    }
    await this.updateConnection(connection.id, () => updated)
    return this.getConnection(connection.id) ?? updated
  }

  private selectConnections({
    mode,
    query,
    connectionIds,
  }: {
    mode: McpRoutingMode
    query: string
    connectionIds: string[]
  }): McpConnectionConfig[] {
    const enabled = this.settings.mcp.connections.filter(
      (connection) => connection.enabled,
    )
    if (connectionIds.length) {
      const requested = new Set(connectionIds)
      return enabled.filter((connection) => requested.has(connection.id))
    }
    if (mode === 'on-demand') return []
    if (mode === 'always') return enabled
    return enabled
      .map((connection) => ({
        connection,
        score: lexicalScore(
          query,
          [
            connection.name,
            ...getReviewedToolSnapshots(connection).flatMap((tool) => [
              tool.name,
              tool.description ?? '',
            ]),
          ].join(' '),
        ),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(({ connection }) => connection)
  }

  private async getDefaultEnv(): Promise<Record<string, string>> {
    if (this.defaultEnv) return this.defaultEnv
    const { shellEnvSync } = await import('shell-env')
    this.defaultEnv = shellEnvSync()
    return this.defaultEnv
  }

  private getConnection(connectionId: string): McpConnectionConfig | undefined {
    return this.settings.mcp.connections.find(
      (connection) => connection.id === connectionId,
    )
  }

  private findServer(name: string): McpServerState | undefined {
    return this.servers.find(
      (server) =>
        server.name === name ||
        server.config.id === name ||
        server.config.name === name,
    )
  }

  private async updateConnection(
    connectionId: string,
    updater: (connection: McpConnectionConfig) => McpConnectionConfig,
  ): Promise<void> {
    const nextSettings = {
      ...this.settings,
      mcp: {
        ...this.settings.mcp,
        connections: this.settings.mcp.connections.map((connection) =>
          connection.id === connectionId ? updater(connection) : connection,
        ),
      },
    }
    this.settings = nextSettings
    await this.setSettings(nextSettings)
  }

  private disconnectedState(config: McpConnectionConfig): McpServerState {
    return {
      name: connectionToolPrefix(config),
      config,
      status: McpServerStatus.Disconnected,
    }
  }

  private replaceServer(server: McpServerState): void {
    this.updateServers((servers) => {
      const found = servers.some(
        (candidate) => candidate.config.id === server.config.id,
      )
      return found
        ? servers.map((candidate) =>
            candidate.config.id === server.config.id ? server : candidate,
          )
        : [...servers, server]
    })
  }

  private updateServers(
    next: McpServerState[] | ((servers: McpServerState[]) => McpServerState[]),
  ): void {
    const previous = this.servers
    const resolved = typeof next === 'function' ? next(previous) : next
    const retainedClients = new Set(
      resolved.flatMap((server) =>
        server.status === McpServerStatus.Connected ||
        server.status === McpServerStatus.ReviewRequired
          ? [server.client]
          : [],
      ),
    )
    for (const server of previous) {
      if (
        (server.status === McpServerStatus.Connected ||
          server.status === McpServerStatus.ReviewRequired) &&
        !retainedClients.has(server.client)
      ) {
        void server.client.close()
      }
    }
    this.servers = resolved
    this.notifySubscribers()
  }

  private notifySubscribers(): void {
    for (const subscriber of this.subscribers) {
      subscriber(this.servers)
    }
  }
}

function isConnectedServer(
  server: McpServerState,
): server is ConnectedMcpServerState {
  return server.status === McpServerStatus.Connected
}

function connectionToolPrefix(connection: McpConnectionConfig): string {
  const stableId =
    connection.id.replace(/[^a-zA-Z0-9]+/g, '').slice(0, 16) ||
    stableHash(connection.id)
  return `mcp_${stableId}`
}

function getRequestToolName(serverName: string, rawToolName: string): string {
  return getToolName(
    serverName,
    getRequestToolComponent(serverName, rawToolName),
  )
}

function getRequestToolComponent(
  serverName: string,
  rawToolName: string,
): string {
  const availableLength =
    64 - serverName.length - McpManager.TOOL_NAME_DELIMITER.length
  if (
    /^[a-zA-Z0-9_-]+$/.test(rawToolName) &&
    rawToolName.length <= availableLength
  ) {
    return rawToolName
  }

  const suffix = `_${stableHash(rawToolName).slice(0, 8)}`
  const readable =
    rawToolName.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') ||
    'tool'
  return `${readable.slice(
    0,
    Math.max(1, availableLength - suffix.length),
  )}${suffix}`
}

function findRequestedTool(
  tools: McpTool[],
  serverName: string,
  requestToolName: string,
): McpTool | undefined {
  return (
    tools.find((tool) => tool.name === requestToolName) ??
    tools.find(
      (tool) =>
        getRequestToolComponent(serverName, tool.name) === requestToolName,
    )
  )
}

function validateRemoteUrl(value: string): void {
  const url = new URL(value)
  const local =
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === '[::1]'
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error(
      'Remote MCP URLs must use HTTPS. HTTP is allowed only for localhost.',
    )
  }
}

function createHeaderFetch(baseHeaders: HeadersInit): typeof fetch {
  return (input, init) => {
    const headers = new Headers(init?.headers)
    new Headers(baseHeaders).forEach((value, key) => {
      if (!headers.has(key)) headers.set(key, value)
    })
    return fetch(input, { ...init, headers })
  }
}

async function toToolSnapshot(tool: McpTool): Promise<McpToolSnapshot> {
  const raw = tool as McpTool & {
    outputSchema?: Record<string, unknown>
    annotations?: Record<string, unknown>
    execution?: { taskSupport?: 'optional' | 'required' | 'forbidden' }
  }
  const comparable = {
    name: raw.name,
    title: raw.title,
    description: raw.description,
    inputSchema: raw.inputSchema as Record<string, unknown>,
    outputSchema: raw.outputSchema,
    annotations: raw.annotations,
    execution: raw.execution,
  }
  return {
    ...comparable,
    schemaHash: await secureStableHash(comparable),
  }
}

function snapshotTool(
  connection: McpConnectionConfig,
  name: string,
): McpToolSnapshot | undefined {
  return connection.toolSnapshot?.tools.find((tool) => tool.name === name)
}

function getReviewedToolSnapshots(
  connection: McpConnectionConfig,
): McpToolSnapshot[] {
  return (connection.toolSnapshot?.tools ?? []).filter(
    (tool) =>
      !connection.toolOptions[tool.name]?.disabled &&
      connection.toolOptions[tool.name]?.reviewedSchemaHash === tool.schemaHash,
  )
}

export async function listAllMcpTools(client: McpClient): Promise<McpTool[]> {
  const tools: McpTool[] = []
  const seenCursors = new Set<string>()
  let cursor: string | undefined

  for (let page = 0; page < 100; page += 1) {
    const result = await client.listTools(cursor ? { cursor } : undefined)
    tools.push(...result.tools)
    if (tools.length > 5000) {
      throw new Error('MCP connection exposes more than 5000 tools.')
    }
    if (!result.nextCursor) return tools
    if (seenCursors.has(result.nextCursor)) {
      throw new Error('MCP tool pagination returned a repeated cursor.')
    }
    seenCursors.add(result.nextCursor)
    cursor = result.nextCursor
  }

  throw new Error('MCP tool pagination exceeded 100 pages.')
}

function inferToolRisk(
  annotations: Record<string, unknown> | undefined,
  name: string,
): McpToolRisk {
  if (annotations?.destructiveHint === true) return 'delete'
  if (annotations?.readOnlyHint === true) return 'read'
  if (annotations?.destructiveHint === false) return 'write'
  if (/(delete|remove|destroy|drop|purge|revoke)/i.test(name)) {
    return 'delete'
  }
  if (/(get|list|read|search|find|query|fetch|view)/i.test(name)) {
    return 'read'
  }
  return 'unknown'
}

function serializeToolResult(result: McpToolCallResult): string {
  const parts = result.content.map((block) => {
    if (block.type === 'text') return block.text
    if (block.type === 'resource') {
      return JSON.stringify(block.resource, null, 2)
    }
    if (block.type === 'resource_link') {
      return JSON.stringify(block, null, 2)
    }
    if (block.type === 'image') {
      return `[Image result: ${block.mimeType}, ${block.data.length} base64 characters]`
    }
    if (block.type === 'audio') {
      return `[Audio result: ${block.mimeType}, ${block.data.length} base64 characters]`
    }
    return JSON.stringify(block, null, 2)
  })
  if (result.structuredContent) {
    parts.push(
      `Structured content:\n${JSON.stringify(result.structuredContent, null, 2)}`,
    )
  }
  return parts.filter(Boolean).join('\n\n') || 'Tool completed without content.'
}

function rankTools(tools: McpTool[], query: string): McpTool[] {
  if (!query.trim()) return tools
  return tools
    .map((tool) => ({
      tool,
      score: lexicalScore(query, `${tool.name} ${tool.description ?? ''}`),
    }))
    .sort((a, b) => b.score - a.score)
    .map(({ tool }) => tool)
}

function lexicalScore(query: string, candidate: string): number {
  const terms = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .filter((term) => term.length > 1)
  const haystack = candidate.toLowerCase()
  if (!terms.length) return 0
  return terms.reduce(
    (score, term) => score + (haystack.includes(term) ? 1 : 0),
    0,
  )
}

function stableHash(value: unknown): string {
  const source = stableStringify(value)
  let hash = 2166136261
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

async function secureStableHash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(stableStringify(value))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'undefined'
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const onAbort = () => {
      clearTimeout(timeout)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, milliseconds)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
