import { v5 as uuidv5 } from 'uuid'

import { SettingMigration } from '../setting.types'

const LEGACY_MCP_NAMESPACE = '8f3a1f1b-7a5f-4cc9-a4cc-3c179d3c9a0e'

type LegacyServer = {
  id?: unknown
  enabled?: unknown
  parameters?: {
    command?: unknown
    args?: unknown
    env?: unknown
  }
  toolOptions?: unknown
}

export const migrateFrom20To21: SettingMigration['migrate'] = (data) => {
  const legacyMcp =
    data.mcp && typeof data.mcp === 'object'
      ? (data.mcp as { servers?: unknown })
      : undefined
  const legacyServers = Array.isArray(legacyMcp?.servers)
    ? (legacyMcp.servers as LegacyServer[])
    : []

  return {
    ...data,
    version: 21,
    mcp: {
      routingMode: 'auto',
      connections: legacyServers.map((server, index) => {
        const legacyName =
          typeof server.id === 'string' && server.id.trim()
            ? server.id.trim()
            : `Legacy MCP ${index + 1}`
        const parameters =
          server.parameters && typeof server.parameters === 'object'
            ? server.parameters
            : {}
        return {
          id: uuidv5(
            `${legacyName}:${JSON.stringify(parameters)}`,
            LEGACY_MCP_NAMESPACE,
          ),
          name: legacyName,
          enabled: server.enabled !== false,
          transport: {
            type: 'stdio',
            command:
              typeof parameters.command === 'string' ? parameters.command : '',
            args: Array.isArray(parameters.args)
              ? parameters.args.filter(
                  (value): value is string => typeof value === 'string',
                )
              : [],
            env:
              parameters.env &&
              typeof parameters.env === 'object' &&
              !Array.isArray(parameters.env)
                ? parameters.env
                : {},
            secretEnv: {},
          },
          auth: {
            mode: 'none',
          },
          toolOptions:
            server.toolOptions &&
            typeof server.toolOptions === 'object' &&
            !Array.isArray(server.toolOptions)
              ? server.toolOptions
              : {},
        }
      }),
    },
  }
}
