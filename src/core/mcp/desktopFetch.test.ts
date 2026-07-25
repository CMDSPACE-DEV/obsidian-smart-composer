import { type Server, createServer } from 'http'
import type { AddressInfo } from 'net'

import { createDesktopMcpFetch } from './desktopFetch'

describe('createDesktopMcpFetch', () => {
  let server: Server
  let baseUrl = ''
  const receivedMethods: string[] = []
  const receivedProtocolVersions: string[] = []
  const receivedBodies: string[] = []

  beforeAll(async () => {
    server = createServer((request, response) => {
      receivedMethods.push(request.method ?? '')

      if (request.url === '/sse') {
        response.writeHead(200, {
          'Content-Type': 'text/event-stream',
        })
        response.end(
          'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{}}\n\n',
        )
        return
      }

      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => chunks.push(chunk))
      request.on('end', () => {
        receivedProtocolVersions.push(
          String(request.headers['mcp-protocol-version'] ?? ''),
        )
        receivedBodies.push(Buffer.concat(chunks).toString('utf8'))
        response.writeHead(200, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Content-Type': 'application/json',
        })
        response.end('{"ok":true}')
      })
    })

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address() as AddressInfo
    baseUrl = `http://127.0.0.1:${address.port}`
  })

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  })

  beforeEach(() => {
    receivedMethods.length = 0
    receivedProtocolVersions.length = 0
    receivedBodies.length = 0
  })

  it('sends MCP headers without a browser CORS preflight', async () => {
    const desktopFetch = createDesktopMcpFetch()
    const response = await desktopFetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'mcp-protocol-version': '2025-03-26',
      },
      body: '{"jsonrpc":"2.0","method":"notifications/initialized"}',
    })

    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(receivedMethods).toEqual(['POST'])
    expect(receivedProtocolVersions).toEqual(['2025-03-26'])
    expect(receivedBodies).toEqual([
      '{"jsonrpc":"2.0","method":"notifications/initialized"}',
    ])
  })

  it('converts Node response bodies into Web streams for SSE', async () => {
    const desktopFetch = createDesktopMcpFetch()
    const response = await desktopFetch(`${baseUrl}/sse`, {
      headers: {
        Accept: 'text/event-stream',
      },
    })

    const reader = response.body
      ?.pipeThrough(new TextDecoderStream())
      .getReader()
    const result = await reader?.read()

    expect(response.headers.get('content-type')).toBe('text/event-stream')
    expect(result?.value).toContain('event: message')
  })
})
