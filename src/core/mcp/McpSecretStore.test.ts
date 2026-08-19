import type { App } from 'obsidian'

import type { SmartComposerSettings } from '../../settings/schema/setting.types'

import {
  McpSecretStore,
  clearUnusedMcpConnectionSecrets,
  migrateLegacyMcpSecrets,
} from './McpSecretStore'

function createApp({ failWrites = false }: { failWrites?: boolean } = {}) {
  const secrets = new Map<string, string>()
  return {
    app: {
      secretStorage: {
        setSecret: (id: string, value: string) => {
          if (failWrites) throw new Error('SecretStorage unavailable')
          secrets.set(id, value)
        },
        getSecret: (id: string) => secrets.get(id) ?? null,
      },
    } as unknown as App,
    secrets,
  }
}

function createSettings(): SmartComposerSettings {
  return {
    mcp: {
      routingMode: 'auto',
      connections: [
        {
          id: 'connection-1',
          name: 'Legacy',
          enabled: true,
          transport: {
            type: 'stdio',
            command: 'node',
            args: ['server.js'],
            env: {
              API_TOKEN: 'secret-value',
              LOG_LEVEL: 'debug',
            },
            secretEnv: {},
          },
          auth: { mode: 'none' },
          toolOptions: {},
        },
      ],
    },
  } as unknown as SmartComposerSettings
}

describe('McpSecretStore legacy migration', () => {
  it('moves sensitive environment values out of JSON settings', () => {
    const { app, secrets } = createApp()
    const result = migrateLegacyMcpSecrets(
      createSettings(),
      new McpSecretStore(app),
    )
    const connection = result.settings.mcp.connections[0]

    expect(result.changed).toBe(true)
    expect(connection.transport).toEqual(
      expect.objectContaining({
        env: { LOG_LEVEL: 'debug' },
        secretEnv: {
          API_TOKEN: 'smart-composer-mcp-connection-1-env-api-token',
        },
      }),
    )
    expect(
      secrets.get(
        connection.transport.type === 'stdio'
          ? connection.transport.secretEnv.API_TOKEN
          : '',
      ),
    ).toBe('secret-value')
  })

  it('disables the connection instead of silently losing a secret', () => {
    const { app } = createApp({ failWrites: true })
    const result = migrateLegacyMcpSecrets(
      createSettings(),
      new McpSecretStore(app),
    )
    const connection = result.settings.mcp.connections[0]

    expect(connection.enabled).toBe(false)
    expect(connection.securityIssue).toBe('secret-migration-failed')
    expect(
      connection.transport.type === 'stdio'
        ? connection.transport.env.API_TOKEN
        : undefined,
    ).toBe('secret-value')
  })

  it('clears credentials that are no longer referenced by a connection', () => {
    const { app, secrets } = createApp()
    const store = new McpSecretStore(app)
    const previous = {
      ...createSettings().mcp.connections[0],
      auth: {
        mode: 'automatic' as const,
        accessTokenSecretId: 'access-token-id',
        refreshTokenSecretId: 'refresh-token-id',
      },
      transport: {
        type: 'stdio' as const,
        command: 'node',
        args: [],
        env: {},
        secretEnv: {
          API_TOKEN: 'environment-token-id',
        },
      },
    }
    const next = {
      ...previous,
      auth: {
        ...previous.auth,
        refreshTokenSecretId: undefined,
      },
      transport: {
        ...previous.transport,
        secretEnv: {},
      },
    }
    store.set('access-token-id', 'keep')
    store.set('refresh-token-id', 'remove')
    store.set('environment-token-id', 'remove')

    clearUnusedMcpConnectionSecrets(store, previous, next)

    expect(secrets.get('access-token-id')).toBe('keep')
    expect(secrets.get('refresh-token-id')).toBe('')
    expect(secrets.get('environment-token-id')).toBe('')
  })
})
