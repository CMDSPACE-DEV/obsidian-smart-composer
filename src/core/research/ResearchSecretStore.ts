import type { App } from 'obsidian'

import type { SmartComposerSettings } from '../../settings/schema/setting.types'
import type { ResearchSourceId } from '../../types/research.types'

export class ResearchSecretStore {
  constructor(private readonly app: App) {}

  set(sourceId: ResearchSourceId, fieldId: string, value: string): void {
    this.app.secretStorage.setSecret(
      getResearchSecretId(sourceId, fieldId),
      value,
    )
  }

  get(sourceId: ResearchSourceId, fieldId: string): string | null {
    return (
      this.app.secretStorage.getSecret(
        getResearchSecretId(sourceId, fieldId),
      ) || null
    )
  }

  has(sourceId: ResearchSourceId, fieldId: string): boolean {
    return Boolean(this.get(sourceId, fieldId))
  }

  clear(sourceId: ResearchSourceId, fieldId: string): void {
    this.app.secretStorage.setSecret(getResearchSecretId(sourceId, fieldId), '')
  }
}

export function getResearchSecretId(
  sourceId: ResearchSourceId,
  fieldId: string,
): string {
  return normalizeSecretId(`smart-composer-research-${sourceId}-${fieldId}`)
}

export function migrateLegacyResearchSecrets(
  settings: SmartComposerSettings,
  secretStore: ResearchSecretStore,
): {
  settings: SmartComposerSettings
  changed: boolean
} {
  let changed = false
  const connections = settings.mcp.connections.map((connection) => {
    if (connection.transport.type !== 'streamable-http') return connection

    let url: URL
    try {
      url = new URL(connection.transport.url)
    } catch {
      return connection
    }
    if (
      url.hostname.toLocaleLowerCase() !== 'mcp.gomdori.app' ||
      !url.pathname.startsWith('/law') ||
      !url.searchParams.has('oc')
    ) {
      return connection
    }

    const credential = url.searchParams.get('oc')?.trim()
    if (!credential) return connection
    const secretId = getResearchSecretId('korean-law', 'oc')
    try {
      secretStore.set('korean-law', 'oc', credential)
      if (secretStore.get('korean-law', 'oc') !== credential) {
        throw new Error('Secret verification failed')
      }
      url.searchParams.delete('oc')
      changed = true
      return {
        ...connection,
        securityIssue: undefined,
        transport: {
          ...connection.transport,
          url: url.toString(),
          secretQueryParams: {
            ...(connection.transport.secretQueryParams ?? {}),
            oc: secretId,
          },
        },
      }
    } catch {
      changed = true
      return {
        ...connection,
        enabled: false,
        securityIssue: 'secret-migration-failed' as const,
      }
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

function normalizeSecretId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
