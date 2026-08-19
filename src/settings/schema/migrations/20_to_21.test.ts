import { validate as validateUuid } from 'uuid'

import type { McpConnectionConfig } from '../../../types/mcp.types'

import { migrateFrom20To21 } from './20_to_21'

type MigratedSettings = {
  version: number
  mcp: {
    routingMode: string
    connections: McpConnectionConfig[]
  }
}

describe('Migration from v20 to v21', () => {
  it('converts legacy stdio servers without changing behavior', () => {
    const result = migrateFrom20To21({
      version: 20,
      mcp: {
        servers: [
          {
            id: 'github',
            enabled: true,
            parameters: {
              command: 'npx',
              args: ['-y', '@example/mcp'],
              env: {
                GITHUB_TOKEN: 'secret-value',
                LOG_LEVEL: 'debug',
              },
            },
            toolOptions: {
              search: {
                disabled: false,
                allowAutoExecution: true,
              },
            },
          },
        ],
      },
    }) as MigratedSettings

    expect(result.version).toBe(21)
    expect(result.mcp.routingMode).toBe('auto')
    expect(result.mcp.connections).toHaveLength(1)
    expect(validateUuid(result.mcp.connections[0].id)).toBe(true)
    expect(result.mcp.connections[0]).toEqual(
      expect.objectContaining({
        name: 'github',
        enabled: true,
        transport: {
          type: 'stdio',
          command: 'npx',
          args: ['-y', '@example/mcp'],
          env: {
            GITHUB_TOKEN: 'secret-value',
            LOG_LEVEL: 'debug',
          },
          secretEnv: {},
        },
        auth: { mode: 'none' },
        toolOptions: {
          search: {
            disabled: false,
            allowAutoExecution: true,
          },
        },
      }),
    )
  })

  it('creates deterministic IDs for repeated migrations', () => {
    const input = {
      version: 20,
      mcp: {
        servers: [
          {
            id: 'local',
            parameters: { command: 'node', args: ['server.js'] },
          },
        ],
      },
    }
    const first = migrateFrom20To21(input) as MigratedSettings
    const second = migrateFrom20To21(input) as MigratedSettings
    expect(first.mcp.connections[0].id).toBe(second.mcp.connections[0].id)
  })
})
