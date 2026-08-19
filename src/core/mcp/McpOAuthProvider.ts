import type { Server } from 'http'

import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js'
import { Platform } from 'obsidian'

import type { McpConnectionConfig } from '../../types/mcp.types'

import { McpSecretStore, getMcpSecretId } from './McpSecretStore'

const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000

export type McpOAuthConfigUpdater = (
  updater: (connection: McpConnectionConfig) => McpConnectionConfig,
) => Promise<void>

export class McpOAuthProvider implements OAuthClientProvider {
  private verifier = ''
  private pendingAuthorizationUrl: URL | null = null

  constructor(
    private connection: McpConnectionConfig,
    private readonly secretStore: McpSecretStore,
    private readonly redirect: URL,
    private readonly oauthState: string,
    private readonly interactive: boolean,
    private readonly updateConnection: McpOAuthConfigUpdater,
  ) {}

  get redirectUrl(): URL {
    return this.redirect
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      redirect_uris: [this.redirect.toString()],
      client_name: 'Smart Composer Achmage',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: this.connection.auth.clientSecretId
        ? 'client_secret_basic'
        : 'none',
      scope: this.connection.auth.scope,
    }
  }

  state(): string {
    return this.oauthState
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    const clientId = this.connection.auth.clientId
    if (!clientId) return undefined
    if (
      this.interactive &&
      this.connection.auth.mode === 'automatic' &&
      this.connection.auth.registeredRedirectUrl &&
      this.connection.auth.registeredRedirectUrl !== this.redirect.toString()
    ) {
      return undefined
    }
    const clientSecret = this.secretStore.get(
      this.connection.auth.clientSecretId,
    )
    return {
      client_id: clientId,
      ...(clientSecret ? { client_secret: clientSecret } : {}),
    }
  }

  async saveClientInformation(
    clientInformation: OAuthClientInformationMixed,
  ): Promise<void> {
    let clientSecretId = this.connection.auth.clientSecretId
    if (clientInformation.client_secret) {
      clientSecretId ??= getMcpSecretId(
        this.connection.id,
        'oauth-client-secret',
      )
      this.secretStore.set(clientSecretId, clientInformation.client_secret)
    }
    await this.persistAuth({
      clientId: clientInformation.client_id,
      clientSecretId,
      registeredRedirectUrl:
        this.connection.auth.mode === 'automatic'
          ? this.redirect.toString()
          : undefined,
    })
  }

  tokens(): OAuthTokens | undefined {
    const accessToken = this.secretStore.get(
      this.connection.auth.accessTokenSecretId,
    )
    if (!accessToken) return undefined
    const refreshToken = this.secretStore.get(
      this.connection.auth.refreshTokenSecretId,
    )
    const expiresIn = this.connection.auth.tokenExpiresAt
      ? Math.max(
          0,
          Math.floor((this.connection.auth.tokenExpiresAt - Date.now()) / 1000),
        )
      : undefined
    return {
      access_token: accessToken,
      token_type: 'Bearer',
      ...(refreshToken ? { refresh_token: refreshToken } : {}),
      ...(expiresIn !== undefined ? { expires_in: expiresIn } : {}),
      ...(this.connection.auth.scope
        ? { scope: this.connection.auth.scope }
        : {}),
    }
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    const accessTokenSecretId =
      this.connection.auth.accessTokenSecretId ??
      getMcpSecretId(this.connection.id, 'oauth-access-token')
    this.secretStore.set(accessTokenSecretId, tokens.access_token)

    let refreshTokenSecretId = this.connection.auth.refreshTokenSecretId
    if (tokens.refresh_token) {
      refreshTokenSecretId ??= getMcpSecretId(
        this.connection.id,
        'oauth-refresh-token',
      )
      this.secretStore.set(refreshTokenSecretId, tokens.refresh_token)
    }

    await this.persistAuth({
      accessTokenSecretId,
      refreshTokenSecretId,
      tokenExpiresAt: tokens.expires_in
        ? Date.now() + tokens.expires_in * 1000
        : undefined,
      scope: tokens.scope ?? this.connection.auth.scope,
    })
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    this.pendingAuthorizationUrl = authorizationUrl
    if (this.interactive) {
      window.open(authorizationUrl.toString(), '_blank')
    }
  }

  saveCodeVerifier(codeVerifier: string): void {
    this.verifier = codeVerifier
  }

  codeVerifier(): string {
    if (!this.verifier) {
      throw new Error('OAuth PKCE verifier is unavailable.')
    }
    return this.verifier
  }

  async invalidateCredentials(
    scope: 'all' | 'client' | 'tokens' | 'verifier',
  ): Promise<void> {
    if (scope === 'all' || scope === 'tokens') {
      this.secretStore.clear(this.connection.auth.accessTokenSecretId)
      this.secretStore.clear(this.connection.auth.refreshTokenSecretId)
      await this.persistAuth({
        accessTokenSecretId: undefined,
        refreshTokenSecretId: undefined,
        tokenExpiresAt: undefined,
      })
    }
    if (scope === 'all' || scope === 'client') {
      this.secretStore.clear(this.connection.auth.clientSecretId)
      await this.persistAuth({
        clientId: undefined,
        clientSecretId: undefined,
        registeredRedirectUrl: undefined,
      })
    }
    if (scope === 'all' || scope === 'verifier') {
      this.verifier = ''
    }
  }

  get authorizationUrl(): URL | null {
    return this.pendingAuthorizationUrl
  }

  private async persistAuth(
    values: Partial<McpConnectionConfig['auth']>,
  ): Promise<void> {
    await this.updateConnection((connection) => {
      const updated = {
        ...connection,
        auth: {
          ...connection.auth,
          ...values,
        },
        securityIssue: undefined,
      }
      this.connection = updated
      return updated
    })
  }
}

export type McpOAuthCallbackSession = {
  redirectUrl: URL
  waitForCode: Promise<string>
  close: () => Promise<void>
}

export async function startMcpOAuthCallbackSession(
  state: string,
): Promise<McpOAuthCallbackSession> {
  if (!Platform.isDesktop) {
    throw new Error('MCP OAuth is not supported on mobile.')
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const http = require('http') as typeof import('http')
  const path = '/mcp-oauth/callback'
  let server: Server | null = null
  let closing: Promise<void> | null = null
  let settled = false
  let resolveCode: (code: string) => void = () => undefined
  let rejectCode: (error: Error) => void = () => undefined

  const waitForCode = new Promise<string>((resolve, reject) => {
    resolveCode = resolve
    rejectCode = reject
  })

  const timeout = setTimeout(() => {
    if (settled) return
    settled = true
    rejectCode(new Error('MCP OAuth authorization timed out.'))
    void close()
  }, CALLBACK_TIMEOUT_MS)

  server = http.createServer((request, response) => {
    const address = server?.address()
    const port =
      address && typeof address !== 'string' ? address.port : undefined
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${port ?? 0}`)
    if (url.pathname !== path) {
      response.statusCode = 404
      response.end('Not found')
      return
    }

    const incomingState = url.searchParams.get('state')
    const code = url.searchParams.get('code')
    const oauthError =
      url.searchParams.get('error_description') ?? url.searchParams.get('error')
    if (incomingState !== state) {
      response.statusCode = 400
      response.end('Invalid OAuth state')
      finish(new Error('Invalid OAuth state.'))
      return
    }
    if (oauthError) {
      response.statusCode = 400
      response.end('Authorization failed')
      finish(new Error(oauthError))
      return
    }
    if (!code) {
      response.statusCode = 400
      response.end('Missing authorization code')
      finish(new Error('Missing OAuth authorization code.'))
      return
    }

    response.statusCode = 200
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    response.end(
      '<!doctype html><html><body><p>Connection authorized. You can close this window.</p><script>setTimeout(()=>window.close(),1200)</script></body></html>',
    )
    finish(undefined, code)
  })

  await new Promise<void>((resolve, reject) => {
    server?.once('error', reject)
    server?.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    await close()
    throw new Error('Could not allocate an OAuth callback port.')
  }

  return {
    redirectUrl: new URL(`http://127.0.0.1:${address.port}${path}`),
    waitForCode,
    close,
  }

  function finish(error?: Error, code?: string): void {
    if (settled) return
    settled = true
    clearTimeout(timeout)
    if (error) rejectCode(error)
    else if (code) resolveCode(code)
    void close()
  }

  async function close(): Promise<void> {
    clearTimeout(timeout)
    if (closing) return closing
    const current = server
    server = null
    if (!current) return
    closing = new Promise<void>((resolve) => current.close(() => resolve()))
    await closing
  }
}

export function generateMcpOAuthState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  )
}
