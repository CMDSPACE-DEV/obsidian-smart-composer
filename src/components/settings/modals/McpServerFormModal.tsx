import { App, Notice } from 'obsidian'
import { useMemo, useState } from 'react'
import TextareaAutosize from 'react-textarea-autosize'
import { v4 as uuidv4 } from 'uuid'

import {
  McpSecretStore,
  clearUnusedMcpConnectionSecrets,
  getMcpSecretId,
} from '../../../core/mcp/McpSecretStore'
import SmartComposerPlugin from '../../../main'
import type {
  McpConnectionAuth,
  McpConnectionConfig,
} from '../../../types/mcp.types'
import { ObsidianButton } from '../../common/ObsidianButton'
import { ObsidianDropdown } from '../../common/ObsidianDropdown'
import { ObsidianSetting } from '../../common/ObsidianSetting'
import { ObsidianTextInput } from '../../common/ObsidianTextInput'
import { ReactModal } from '../../common/ReactModal'

type McpServerFormComponentProps = {
  app: App
  plugin: SmartComposerPlugin
  onClose: () => void
  serverId?: string
}

export class AddMcpServerModal extends ReactModal<McpServerFormComponentProps> {
  constructor(app: App, plugin: SmartComposerPlugin) {
    super({
      app,
      Component: McpServerFormComponent,
      props: { app, plugin },
      options: { title: 'Add MCP connection' },
    })
  }
}

export class EditMcpServerModal extends ReactModal<McpServerFormComponentProps> {
  constructor(app: App, plugin: SmartComposerPlugin, serverId: string) {
    super({
      app,
      Component: McpServerFormComponent,
      props: { app, plugin, serverId },
      options: { title: 'Edit MCP connection' },
    })
  }
}

function McpServerFormComponent({
  app,
  plugin,
  onClose,
  serverId,
}: McpServerFormComponentProps) {
  const existing = serverId
    ? plugin.settings.mcp.connections.find(
        (connection) => connection.id === serverId,
      )
    : undefined
  const [name, setName] = useState(existing?.name ?? '')
  const [transportType, setTransportType] = useState<
    'streamable-http' | 'stdio'
  >(existing?.transport.type ?? 'streamable-http')
  const [url, setUrl] = useState(
    existing?.transport.type === 'streamable-http'
      ? existing.transport.url
      : '',
  )
  const [legacySse, setLegacySse] = useState(
    existing?.transport.type === 'streamable-http'
      ? existing.transport.legacySse
      : false,
  )
  const [command, setCommand] = useState(
    existing?.transport.type === 'stdio' ? existing.transport.command : '',
  )
  const [args, setArgs] = useState(
    existing?.transport.type === 'stdio'
      ? existing.transport.args.join('\n')
      : '',
  )
  const [env, setEnv] = useState(() => {
    if (existing?.transport.type !== 'stdio') return ''
    return [
      ...Object.entries(existing.transport.env).map(
        ([key, value]) => `${key}=${value}`,
      ),
      ...Object.keys(existing.transport.secretEnv).map(
        (key) => `${key}=<stored>`,
      ),
    ].join('\n')
  })
  const [authMode, setAuthMode] = useState<McpConnectionAuth['mode']>(
    existing?.auth.mode ?? 'automatic',
  )
  const [bearerToken, setBearerToken] = useState('')
  const [clientId, setClientId] = useState(existing?.auth.clientId ?? '')
  const [clientSecret, setClientSecret] = useState('')
  const [scope, setScope] = useState(existing?.auth.scope ?? '')
  const [saving, setSaving] = useState(false)

  const id = useMemo(() => existing?.id ?? uuidv4(), [existing?.id])

  const handleSubmit = async () => {
    setSaving(true)
    try {
      const trimmedName = name.trim()
      if (!trimmedName) throw new Error('Connection name is required.')
      if (
        plugin.settings.mcp.connections.some(
          (connection) =>
            connection.name.toLowerCase() === trimmedName.toLowerCase() &&
            connection.id !== id,
        )
      ) {
        throw new Error('A connection with this name already exists.')
      }

      const secretStore = new McpSecretStore(app)
      const transport =
        transportType === 'streamable-http'
          ? buildRemoteTransport(url, legacySse)
          : buildStdioTransport({
              id,
              command,
              args,
              env,
              existing,
              secretStore,
            })
      const preserveCredentials =
        existing?.auth.mode === authMode &&
        !transportChanged(existing, transport)
      const auth = buildAuth({
        id,
        transportType,
        authMode,
        bearerToken,
        clientId,
        clientSecret,
        scope,
        existing: preserveCredentials ? existing : undefined,
        secretStore,
      })
      const connection: McpConnectionConfig = {
        id,
        name: trimmedName,
        enabled: existing?.enabled ?? true,
        transport,
        auth,
        toolOptions: existing?.toolOptions ?? {},
        toolSnapshot: transportChanged(existing, transport)
          ? undefined
          : existing?.toolSnapshot,
      }

      await plugin.setSettings({
        ...plugin.settings,
        mcp: {
          ...plugin.settings.mcp,
          connections: existing
            ? plugin.settings.mcp.connections.map((candidate) =>
                candidate.id === id ? connection : candidate,
              )
            : [...plugin.settings.mcp.connections, connection],
        },
      })
      if (existing) {
        clearUnusedMcpConnectionSecrets(secretStore, existing, connection)
      }
      onClose()
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <ObsidianSetting
        name="Connection name"
        desc="Shown in @ mentions and tool approval cards."
        required
      >
        <ObsidianTextInput
          value={name}
          onChange={setName}
          placeholder="e.g. Korean Law"
        />
      </ObsidianSetting>

      <ObsidianSetting
        name="Connection type"
        desc="Remote URL is recommended. Local command is an advanced desktop option."
      >
        <ObsidianDropdown
          value={transportType}
          options={{
            'streamable-http': 'Remote URL',
            stdio: 'Local command (advanced)',
          }}
          onChange={(value) =>
            setTransportType(value as 'streamable-http' | 'stdio')
          }
        />
      </ObsidianSetting>

      {transportType === 'streamable-http' ? (
        <>
          <ObsidianSetting
            name="MCP URL"
            desc="Use an HTTPS Streamable HTTP endpoint."
            required
          >
            <ObsidianTextInput
              value={url}
              onChange={setUrl}
              placeholder="https://mcp.example.com/mcp"
            />
          </ObsidianSetting>
          <ObsidianSetting
            name="Protocol"
            desc="Use legacy SSE only when the provider explicitly requires it."
          >
            <ObsidianDropdown
              value={legacySse ? 'sse' : 'streamable-http'}
              options={{
                'streamable-http': 'Streamable HTTP',
                sse: 'Legacy SSE',
              }}
              onChange={(value) => setLegacySse(value === 'sse')}
            />
          </ObsidianSetting>
          <ObsidianSetting
            name="Authentication"
            desc="Automatic discovers OAuth when the server requests it."
          >
            <ObsidianDropdown
              value={authMode}
              options={{
                automatic: 'Automatic / OAuth',
                none: 'No authentication',
                bearer: 'Bearer token',
                'oauth-client': 'OAuth client credentials',
              }}
              onChange={(value) =>
                setAuthMode(value as McpConnectionAuth['mode'])
              }
            />
          </ObsidianSetting>
          {authMode === 'bearer' && (
            <ObsidianSetting
              name="Bearer token"
              desc={
                existing?.auth.bearerSecretId
                  ? 'Leave blank to keep the stored token.'
                  : 'Stored securely in Obsidian SecretStorage.'
              }
              required={!existing?.auth.bearerSecretId}
            >
              <ObsidianTextInput
                value={bearerToken}
                onChange={setBearerToken}
                type="password"
                placeholder={
                  existing?.auth.bearerSecretId
                    ? 'Stored securely'
                    : 'Paste token'
                }
              />
            </ObsidianSetting>
          )}
          {authMode === 'oauth-client' && (
            <>
              <ObsidianSetting name="OAuth client ID" required>
                <ObsidianTextInput value={clientId} onChange={setClientId} />
              </ObsidianSetting>
              <ObsidianSetting
                name="OAuth client secret"
                desc={
                  existing?.auth.clientSecretId
                    ? 'Leave blank to keep the stored secret.'
                    : 'Stored securely in Obsidian SecretStorage.'
                }
              >
                <ObsidianTextInput
                  value={clientSecret}
                  onChange={setClientSecret}
                  type="password"
                  placeholder={
                    existing?.auth.clientSecretId
                      ? 'Stored securely'
                      : 'Optional'
                  }
                />
              </ObsidianSetting>
              <ObsidianSetting name="OAuth scopes">
                <ObsidianTextInput
                  value={scope}
                  onChange={setScope}
                  placeholder="Optional, space separated"
                />
              </ObsidianSetting>
            </>
          )}
        </>
      ) : (
        <>
          <ObsidianSetting name="Command" required>
            <ObsidianTextInput
              value={command}
              onChange={setCommand}
              placeholder="npx"
            />
          </ObsidianSetting>
          <ObsidianSetting
            name="Arguments"
            desc="One command argument per line."
            className="smtcmp-settings-textarea-header"
          />
          <TextareaAutosize
            value={args}
            onChange={(event) => setArgs(event.target.value)}
            className="smtcmp-mcp-server-modal-textarea"
            minRows={3}
            maxRows={10}
            placeholder={'-y\n@example/mcp-server'}
          />
          <ObsidianSetting
            name="Environment"
            desc="One KEY=value pair per line. Token, key, secret, password and credential values are moved to SecretStorage."
            className="smtcmp-settings-textarea-header"
          />
          <TextareaAutosize
            value={env}
            onChange={(event) => setEnv(event.target.value)}
            className="smtcmp-mcp-server-modal-textarea"
            minRows={3}
            maxRows={10}
            placeholder={'API_TOKEN=paste-here\nLOG_LEVEL=info'}
          />
        </>
      )}

      <ObsidianSetting>
        <ObsidianButton
          text={saving ? 'Saving...' : 'Save connection'}
          onClick={() => void handleSubmit()}
          disabled={saving}
          cta
        />
        <ObsidianButton text="Cancel" onClick={onClose} />
      </ObsidianSetting>
    </>
  )
}

function buildAuth({
  id,
  transportType,
  authMode,
  bearerToken,
  clientId,
  clientSecret,
  scope,
  existing,
  secretStore,
}: {
  id: string
  transportType: 'streamable-http' | 'stdio'
  authMode: McpConnectionAuth['mode']
  bearerToken: string
  clientId: string
  clientSecret: string
  scope: string
  existing?: McpConnectionConfig
  secretStore: McpSecretStore
}): McpConnectionAuth {
  if (transportType === 'stdio' || authMode === 'none') {
    return { mode: 'none' }
  }

  if (authMode === 'bearer') {
    const token = bearerToken.trim()
    const bearerSecretId =
      existing?.auth.bearerSecretId ??
      (token ? getMcpSecretId(id, 'bearer-token') : undefined)
    if (!bearerSecretId) {
      throw new Error('Bearer token is required.')
    }
    if (token) secretStore.set(bearerSecretId, token)
    return { mode: 'bearer', bearerSecretId }
  }

  const storedOAuth = existing?.auth
  if (authMode === 'automatic') {
    return {
      mode: 'automatic',
      clientId: storedOAuth?.clientId,
      clientSecretId: storedOAuth?.clientSecretId,
      accessTokenSecretId: storedOAuth?.accessTokenSecretId,
      refreshTokenSecretId: storedOAuth?.refreshTokenSecretId,
      tokenExpiresAt: storedOAuth?.tokenExpiresAt,
      authorizationServerUrl: storedOAuth?.authorizationServerUrl,
      registeredRedirectUrl: storedOAuth?.registeredRedirectUrl,
      scope: storedOAuth?.scope,
    }
  }

  const trimmedClientId = clientId.trim()
  if (!trimmedClientId) throw new Error('OAuth client ID is required.')
  const trimmedClientSecret = clientSecret.trim()
  const nextScope = scope.trim() || undefined
  const oauthCredentialsChanged =
    storedOAuth?.clientId !== trimmedClientId ||
    storedOAuth?.scope !== nextScope ||
    Boolean(trimmedClientSecret)
  const clientSecretId =
    trimmedClientSecret || storedOAuth?.clientId === trimmedClientId
      ? (storedOAuth?.clientSecretId ??
        (trimmedClientSecret
          ? getMcpSecretId(id, 'oauth-client-secret')
          : undefined))
      : undefined
  if (trimmedClientSecret && clientSecretId) {
    secretStore.set(clientSecretId, trimmedClientSecret)
  }
  return {
    mode: 'oauth-client',
    clientId: trimmedClientId,
    clientSecretId,
    accessTokenSecretId: oauthCredentialsChanged
      ? undefined
      : storedOAuth?.accessTokenSecretId,
    refreshTokenSecretId: oauthCredentialsChanged
      ? undefined
      : storedOAuth?.refreshTokenSecretId,
    tokenExpiresAt: oauthCredentialsChanged
      ? undefined
      : storedOAuth?.tokenExpiresAt,
    authorizationServerUrl: storedOAuth?.authorizationServerUrl,
    registeredRedirectUrl: storedOAuth?.registeredRedirectUrl,
    scope: nextScope,
  }
}

function buildRemoteTransport(urlValue: string, legacySse: boolean) {
  const url = new URL(urlValue.trim())
  const isLocal =
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === '[::1]'
  if (url.protocol !== 'https:' && !(isLocal && url.protocol === 'http:')) {
    throw new Error(
      'Remote MCP URLs must use HTTPS. HTTP is allowed only for localhost.',
    )
  }
  return {
    type: 'streamable-http' as const,
    url: url.toString(),
    legacySse,
  }
}

function buildStdioTransport({
  id,
  command,
  args,
  env,
  existing,
  secretStore,
}: {
  id: string
  command: string
  args: string
  env: string
  existing?: McpConnectionConfig
  secretStore: McpSecretStore
}) {
  if (!command.trim()) throw new Error('Command is required.')
  const publicEnv: Record<string, string> = {}
  const secretEnv: Record<string, string> =
    existing?.transport.type === 'stdio'
      ? { ...existing.transport.secretEnv }
      : {}
  const seenKeys = new Set<string>()
  for (const line of env.split(/\r?\n/)) {
    if (!line.trim()) continue
    const separator = line.indexOf('=')
    if (separator <= 0) {
      throw new Error(`Invalid environment row: ${line}`)
    }
    const key = line.slice(0, separator).trim()
    const value = line.slice(separator + 1).trim()
    seenKeys.add(key)
    if (/(token|key|secret|password|auth|credential)/i.test(key)) {
      if (value === '<stored>' && secretEnv[key]) continue
      if (value === '<stored>') {
        throw new Error(`No stored secret exists for ${key}.`)
      }
      if (!value) {
        Reflect.deleteProperty(secretEnv, key)
        continue
      }
      const secretId =
        secretEnv[key] ?? getMcpSecretId(id, `env-${key.toLowerCase()}`)
      secretStore.set(secretId, value)
      secretEnv[key] = secretId
    } else {
      publicEnv[key] = value
      Reflect.deleteProperty(secretEnv, key)
    }
  }
  for (const key of Object.keys(secretEnv)) {
    if (!seenKeys.has(key)) Reflect.deleteProperty(secretEnv, key)
  }
  return {
    type: 'stdio' as const,
    command: command.trim(),
    args: args
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean),
    env: publicEnv,
    secretEnv,
  }
}

function transportChanged(
  existing: McpConnectionConfig | undefined,
  transport: McpConnectionConfig['transport'],
): boolean {
  return (
    !existing ||
    JSON.stringify(existing.transport) !== JSON.stringify(transport)
  )
}
