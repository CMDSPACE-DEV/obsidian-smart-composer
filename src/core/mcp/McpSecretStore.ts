import type { App } from 'obsidian'

import type { SmartComposerSettings } from '../../settings/schema/setting.types'
import type { McpConnectionConfig } from '../../types/mcp.types'

const SENSITIVE_ENV_NAME = /(token|key|secret|password|auth|credential)/i

export class McpSecretStore {
  constructor(private readonly app: App) {}

  set(id: string, value: string): void {
    this.app.secretStorage.setSecret(normalizeSecretId(id), value)
  }

  get(id?: string): string | null {
    if (!id) return null
    return this.app.secretStorage.getSecret(normalizeSecretId(id))
  }

  clear(id?: string): void {
    if (!id) return
    // Obsidian 1.11.4 does not expose deleteSecret. An empty value is treated
    // as absent by Smart Composer and avoids retaining the previous credential.
    this.app.secretStorage.setSecret(normalizeSecretId(id), '')
  }

  has(id?: string): boolean {
    return Boolean(this.get(id))
  }
}

export function getMcpSecretId(connectionId: string, kind: string): string {
  return normalizeSecretId(`smart-composer-mcp-${connectionId}-${kind}`)
}

export function clearUnusedMcpConnectionSecrets(
  secretStore: McpSecretStore,
  previous: McpConnectionConfig,
  next?: McpConnectionConfig,
): void {
  const retained = new Set(next ? getConnectionSecretIds(next) : [])
  for (const id of getConnectionSecretIds(previous)) {
    if (!retained.has(id)) secretStore.clear(id)
  }
}

export function migrateLegacyMcpSecrets(
  settings: SmartComposerSettings,
  secretStore: McpSecretStore,
): {
  settings: SmartComposerSettings
  changed: boolean
} {
  let changed = false
  const connections = settings.mcp.connections.map((connection) => {
    if (connection.transport.type !== 'stdio') return connection

    const env = { ...connection.transport.env }
    const secretEnv = { ...connection.transport.secretEnv }
    let connectionChanged = false
    let migrationFailed = false

    for (const [name, value] of Object.entries(env)) {
      if (!SENSITIVE_ENV_NAME.test(name) || !value) continue
      const secretId = getMcpSecretId(
        connection.id,
        `env-${name.toLowerCase()}`,
      )
      try {
        secretStore.set(secretId, value)
        if (secretStore.get(secretId) !== value) {
          throw new Error('Secret verification failed')
        }
        secretEnv[name] = secretId
        Reflect.deleteProperty(env, name)
        connectionChanged = true
      } catch {
        migrationFailed = true
      }
    }

    if (!connectionChanged && !migrationFailed) return connection
    changed = true
    return {
      ...connection,
      enabled: migrationFailed ? false : connection.enabled,
      securityIssue: migrationFailed
        ? ('secret-migration-failed' as const)
        : undefined,
      transport: {
        ...connection.transport,
        env,
        secretEnv,
      },
    }
  })

  return changed
    ? {
        settings: {
          ...settings,
          mcp: {
            ...settings.mcp,
            connections,
          },
        },
        changed: true,
      }
    : { settings, changed: false }
}

function getConnectionSecretIds(connection: McpConnectionConfig): string[] {
  const authIds = [
    connection.auth.bearerSecretId,
    connection.auth.clientSecretId,
    connection.auth.accessTokenSecretId,
    connection.auth.refreshTokenSecretId,
  ]
  const environmentIds =
    connection.transport.type === 'stdio'
      ? Object.values(connection.transport.secretEnv)
      : []
  const queryIds =
    connection.transport.type === 'streamable-http'
      ? Object.values(connection.transport.secretQueryParams ?? {})
      : []
  return [...authIds, ...environmentIds, ...queryIds].filter(
    (id): id is string => Boolean(id),
  )
}

function normalizeSecretId(id: string): string {
  return id
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
