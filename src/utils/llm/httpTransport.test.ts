import { createServer } from 'http'
import { AddressInfo } from 'net'

import { LLMHttpError, postJson, postStream } from './httpTransport'

jest.mock('obsidian', () => ({
  Platform: { isDesktop: true },
}))

describe('HTTP transport errors', () => {
  it('preserves status, bounded response body, and request ID', async () => {
    const fetchFn = jest.fn(async () => {
      return {
        ok: false,
        status: 429,
        headers: {
          get: (name: string) =>
            name === 'x-request-id' ? 'request-123' : null,
        },
        text: async () => `rate limited ${'x'.repeat(5000)}`,
      } as unknown as Response
    }) as unknown as typeof fetch

    let error: unknown
    try {
      await postJson('https://example.com', {}, { fetchFn })
    } catch (caught) {
      error = caught
    }

    expect(error).toBeInstanceOf(LLMHttpError)
    expect(error).toMatchObject({
      status: 429,
      requestId: 'request-123',
    })
    expect((error as LLMHttpError).responseBody.length).toBe(4096)
  })

  it('never includes authorization headers in the error', async () => {
    const fetchFn = jest.fn(async () => {
      return {
        ok: false,
        status: 403,
        headers: { get: () => null },
        text: async () => 'model entitlement missing',
      } as unknown as Response
    }) as unknown as typeof fetch

    await expect(
      postJson(
        'https://example.com',
        {},
        {
          fetchFn,
          headers: { authorization: 'Bearer secret-token' },
        },
      ),
    ).rejects.not.toThrow(/secret-token/)
  })

  it('redacts echoed credentials and limits multibyte bodies to 4KB', async () => {
    const echoedSecrets = JSON.stringify({
      authorization: 'Bearer outbound-secret',
      access_token: 'access-secret',
      refresh_token: 'refresh-secret',
      api_key: 'sk-super-secret-key',
      detail: '\uac00'.repeat(2000),
    })
    const fetchFn = jest.fn(async () =>
      createErrorResponse(400, echoedSecrets, 'request-redaction'),
    ) as unknown as typeof fetch

    let caught: unknown
    try {
      await postJson('https://example.invalid', {}, { fetchFn })
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(LLMHttpError)
    const httpError = caught as LLMHttpError
    expect(httpError.responseBody).toContain('[REDACTED]')
    expect(httpError.message).not.toMatch(
      /outbound-secret|access-secret|refresh-secret|sk-super-secret-key/,
    )
    expect(
      Buffer.byteLength(httpError.responseBody, 'utf8'),
    ).toBeLessThanOrEqual(4096)
    expect(httpError.requestId).toBe('request-redaction')
  })

  it('preserves and sanitizes errors from the desktop Node stream path', async () => {
    const server = createServer((_request, response) => {
      response.statusCode = 403
      response.setHeader('x-request-id', 'node-request-id')
      response.end(
        JSON.stringify({
          error: 'forbidden',
          access_token: 'node-secret-token',
        }),
      )
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as AddressInfo

    try {
      await expect(
        postStream(`http://127.0.0.1:${address.port}/stream`, {}),
      ).rejects.toMatchObject({
        status: 403,
        requestId: 'node-request-id',
      })
      await expect(
        postStream(`http://127.0.0.1:${address.port}/stream`, {}),
      ).rejects.not.toThrow(/node-secret-token/)
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    }
  })
})

function createErrorResponse(
  status: number,
  body: string,
  requestId?: string,
): Response {
  return {
    ok: false,
    status,
    headers: {
      get: (name: string) =>
        name === 'x-request-id' ? (requestId ?? null) : null,
    },
    text: async () => body,
  } as unknown as Response
}
