import type { App } from 'obsidian'

import type { SmartComposerSettings } from '../../settings/schema/setting.types'

import {
  ResearchSecretStore,
  migrateLegacyResearchSecrets,
} from './ResearchSecretStore'

function createApp({
  failWrites = false,
  secrets = new Map<string, string>(),
}: {
  failWrites?: boolean
  secrets?: Map<string, string>
} = {}) {
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
          id: 'legacy-law',
          name: 'Korean Law MCP',
          enabled: true,
          transport: {
            type: 'streamable-http',
            url: 'https://mcp.gomdori.app/law?oc=private-value',
            legacySse: false,
          },
          auth: { mode: 'none' },
          toolOptions: {},
        },
      ],
    },
  } as unknown as SmartComposerSettings
}

describe('ResearchSecretStore persistence', () => {
  it('reads NAVER credentials after the plugin store is recreated', () => {
    const persistedSecrets = new Map<string, string>()
    const firstPluginLoad = createApp({ secrets: persistedSecrets })
    const firstStore = new ResearchSecretStore(firstPluginLoad.app)

    firstStore.set('naver', 'key-id', 'test-client-id')
    firstStore.set('naver', 'api-key', 'test-client-secret')

    const restartedPlugin = createApp({ secrets: persistedSecrets })
    const restartedStore = new ResearchSecretStore(restartedPlugin.app)

    expect(restartedStore.get('naver', 'key-id')).toBe('test-client-id')
    expect(restartedStore.get('naver', 'api-key')).toBe('test-client-secret')
  })
})

describe('ResearchSecretStore legacy migration', () => {
  it('moves Korean Law oc out of the synced connection URL', () => {
    const { app, secrets } = createApp()
    const result = migrateLegacyResearchSecrets(
      createSettings(),
      new ResearchSecretStore(app),
    )
    const connection = result.settings.mcp.connections[0]

    expect(result.changed).toBe(true)
    expect(connection.transport).toEqual(
      expect.objectContaining({
        url: 'https://mcp.gomdori.app/law',
        secretQueryParams: {
          oc: 'smart-composer-research-korean-law-oc',
        },
      }),
    )
    expect(secrets.get('smart-composer-research-korean-law-oc')).toBe(
      'private-value',
    )
    expect(JSON.stringify(result.settings)).not.toContain('private-value')
  })

  it('disables the connection without deleting the URL if migration fails', () => {
    const { app } = createApp({ failWrites: true })
    const result = migrateLegacyResearchSecrets(
      createSettings(),
      new ResearchSecretStore(app),
    )
    const connection = result.settings.mcp.connections[0]

    expect(connection.enabled).toBe(false)
    expect(connection.securityIssue).toBe('secret-migration-failed')
    expect(
      connection.transport.type === 'streamable-http'
        ? connection.transport.url
        : '',
    ).toContain('oc=private-value')
  })
})
