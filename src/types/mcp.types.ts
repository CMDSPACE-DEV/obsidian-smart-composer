import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types'
import { z } from 'zod'

export type McpTool = Tool
export type McpToolCallResult = CallToolResult
export type McpClient = Client

export const MCP_ROUTING_MODES = ['auto', 'always', 'on-demand', 'off'] as const
export type McpRoutingMode = (typeof MCP_ROUTING_MODES)[number]

export const MCP_TOOL_RISKS = ['read', 'write', 'delete', 'unknown'] as const
export type McpToolRisk = (typeof MCP_TOOL_RISKS)[number]

const mcpToolSnapshotSchema = z.object({
  name: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  inputSchema: z.record(z.string(), z.unknown()),
  outputSchema: z.record(z.string(), z.unknown()).optional(),
  annotations: z.record(z.string(), z.unknown()).optional(),
  execution: z
    .object({
      taskSupport: z.enum(['optional', 'required', 'forbidden']).optional(),
    })
    .optional(),
  schemaHash: z.string(),
})
export type McpToolSnapshot = z.infer<typeof mcpToolSnapshotSchema>

export const mcpConnectionToolOptionsSchema = z.record(
  z.string(),
  z.object({
    disabled: z.boolean().optional(),
    allowAutoExecution: z.boolean().optional(),
    risk: z.enum(MCP_TOOL_RISKS).optional(),
    reviewedSchemaHash: z.string().optional(),
  }),
)
export type McpConnectionToolOptions = z.infer<
  typeof mcpConnectionToolOptionsSchema
>

export const mcpStdioTransportSchema = z.object({
  type: z.literal('stdio'),
  command: z.string(),
  args: z.array(z.string()).catch([]),
  env: z.record(z.string(), z.string()).catch({}),
  secretEnv: z.record(z.string(), z.string()).catch({}),
})
export type McpStdioTransport = z.infer<typeof mcpStdioTransportSchema>

export const mcpRemoteTransportSchema = z.object({
  type: z.literal('streamable-http'),
  url: z.string(),
  legacySse: z.boolean().catch(false),
  secretQueryParams: z.record(z.string(), z.string()).optional().catch({}),
})
export type McpRemoteTransport = z.infer<typeof mcpRemoteTransportSchema>

export const mcpConnectionAuthSchema = z.object({
  mode: z.enum(['automatic', 'none', 'bearer', 'oauth-client']),
  bearerSecretId: z.string().optional(),
  clientId: z.string().optional(),
  clientSecretId: z.string().optional(),
  accessTokenSecretId: z.string().optional(),
  refreshTokenSecretId: z.string().optional(),
  tokenExpiresAt: z.number().optional(),
  authorizationServerUrl: z.string().optional(),
  registeredRedirectUrl: z.string().optional(),
  scope: z.string().optional(),
})
export type McpConnectionAuth = z.infer<typeof mcpConnectionAuthSchema>

export const mcpConnectionConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  transport: z.discriminatedUnion('type', [
    mcpStdioTransportSchema,
    mcpRemoteTransportSchema,
  ]),
  auth: mcpConnectionAuthSchema,
  toolOptions: mcpConnectionToolOptionsSchema.catch({}),
  toolSnapshot: z
    .object({
      scannedAt: z.number(),
      hash: z.string(),
      tools: z.array(mcpToolSnapshotSchema),
      reviewRequired: z.boolean(),
    })
    .optional(),
  securityIssue: z
    .enum(['secret-migration-failed', 'authentication-required'])
    .optional(),
})
export type McpConnectionConfig = z.infer<typeof mcpConnectionConfigSchema>

// Legacy aliases remain exported while downstream UI and history are migrated.
export type McpServerConfig = McpConnectionConfig

export enum McpServerStatus {
  Disconnected = 'disconnected',
  Connecting = 'connecting',
  Connected = 'connected',
  AuthenticationRequired = 'authentication-required',
  ReviewRequired = 'review-required',
  Error = 'error',
}

export type McpServerState = {
  name: string
  config: McpConnectionConfig
} & (
  | {
      status:
        | McpServerStatus.Connecting
        | McpServerStatus.Disconnected
        | McpServerStatus.AuthenticationRequired
    }
  | {
      status: McpServerStatus.Connected | McpServerStatus.ReviewRequired
      client: McpClient
      tools: McpTool[]
      serverCapabilities?: Record<string, unknown>
    }
  | {
      status: McpServerStatus.Error
      error: Error
    }
)
