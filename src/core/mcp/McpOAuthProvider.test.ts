import { get } from 'http'

import type { App } from 'obsidian'

import type { McpConnectionConfig } from '../../types/mcp.types'

import {
  McpOAuthProvider,
  generateMcpOAuthState,
  startMcpOAuthCallbackSession,
} from './McpOAuthProvider'
import { McpSecretStore } from './McpSecretStore'

jest.mock('obsidian', () => ({
  Platform: { isDesktop: true },
}))

function request(url: URL): Promise<number> {
  return new Promise((resolve, reject) => {
    get(url, (response) => {
      response.resume()
      response.once('end', () => resolve(response.statusCode ?? 0))
    }).once('error', reject)
  })
}

function createProvider({
  connectionAuth = { mode: 'automatic' as const },
  redirectUrl = 'http://127.0.0.1:12345/mcp-oauth/callback',
  interactive = false,
}: {
  connectionAuth?: McpConnectionConfig['auth']
  redirectUrl?: string
  interactive?: boolean
} = {}) {
  const secrets = new Map<string, string>()
  const app = {
    secretStorage: {
      setSecret: (id: string, value: string) => secrets.set(id, value),
      getSecret: (id: string) => secrets.get(id) ?? null,
    },
  } as unknown as App
  let connection: McpConnectionConfig = {
    id: 'oauth-connection',
    name: 'OAuth',
    enabled: true,
    transport: {
      type: 'streamable-http',
      url: 'https://example.com/mcp',
      legacySse: false,
    },
    auth: connectionAuth,
    toolOptions: {},
  }
  const provider = new McpOAuthProvider(
    connection,
    new McpSecretStore(app),
    new URL(redirectUrl),
    'expected-state',
    interactive,
    async (updater) => {
      connection = updater(connection)
    },
  )
  return { provider, secrets, getConnection: () => connection }
}

describe('McpOAuthProvider', () => {
  it('stores tokens and registered client secrets only in SecretStorage', async () => {
    const { provider, secrets, getConnection } = createProvider()

    await provider.saveClientInformation({
      client_id: 'client-id',
      client_secret: 'client-secret',
    })
    await provider.saveTokens({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      token_type: 'Bearer',
      expires_in: 3600,
    })

    const auth = getConnection().auth
    expect(auth.clientId).toBe('client-id')
    expect(auth.clientSecretId).toBeDefined()
    expect(auth.registeredRedirectUrl).toBe(
      'http://127.0.0.1:12345/mcp-oauth/callback',
    )
    expect(auth.accessTokenSecretId).toBeDefined()
    expect(auth.refreshTokenSecretId).toBeDefined()
    expect(Object.values(auth)).not.toContain('access-token')
    expect(Object.values(auth)).not.toContain('client-secret')
    if (!auth.clientSecretId || !auth.accessTokenSecretId) {
      throw new Error('Expected OAuth secret references to be persisted.')
    }
    expect(secrets.get(auth.clientSecretId)).toBe('client-secret')
    expect(secrets.get(auth.accessTokenSecretId)).toBe('access-token')
    expect(provider.tokens()?.refresh_token).toBe('refresh-token')
  })

  it('keeps the PKCE verifier in memory only', () => {
    const { provider, getConnection } = createProvider()
    provider.saveCodeVerifier('temporary-verifier')

    expect(provider.codeVerifier()).toBe('temporary-verifier')
    expect(JSON.stringify(getConnection())).not.toContain('temporary-verifier')
  })

  it('re-registers an automatic client when an interactive callback port changes', () => {
    const { provider } = createProvider({
      connectionAuth: {
        mode: 'automatic',
        clientId: 'registered-client',
        registeredRedirectUrl: 'http://127.0.0.1:11111/mcp-oauth/callback',
      },
      redirectUrl: 'http://127.0.0.1:22222/mcp-oauth/callback',
      interactive: true,
    })

    expect(provider.clientInformation()).toBeUndefined()
  })

  it('keeps a manually registered OAuth client across callback ports', () => {
    const { provider } = createProvider({
      connectionAuth: {
        mode: 'oauth-client',
        clientId: 'manual-client',
      },
      redirectUrl: 'http://127.0.0.1:22222/mcp-oauth/callback',
      interactive: true,
    })

    expect(provider.clientInformation()?.client_id).toBe('manual-client')
  })

  it('accepts a loopback callback only with the matching OAuth state', async () => {
    const state = generateMcpOAuthState()
    const session = await startMcpOAuthCallbackSession(state)
    const callback = new URL(session.redirectUrl)
    callback.searchParams.set('state', state)
    callback.searchParams.set('code', 'authorization-code')

    await expect(request(callback)).resolves.toBe(200)
    await expect(session.waitForCode).resolves.toBe('authorization-code')
    await session.close()
  })

  it('rejects a callback with a mismatched OAuth state', async () => {
    const session = await startMcpOAuthCallbackSession('expected-state')
    const rejection = expect(session.waitForCode).rejects.toThrow(
      'Invalid OAuth state.',
    )
    const callback = new URL(session.redirectUrl)
    callback.searchParams.set('state', 'wrong-state')
    callback.searchParams.set('code', 'authorization-code')

    await expect(request(callback)).resolves.toBe(400)
    await rejection
    await session.close()
  })
})
