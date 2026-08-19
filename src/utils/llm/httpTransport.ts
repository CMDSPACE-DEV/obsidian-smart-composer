/*
 * Codex endpoints block direct fetch with CORS, so we use Node's http/https on
 * desktop. Obsidian's requestUrl can bypass CORS but does not support streaming
 * today; Codex requires stream: true, so a non-streaming fallback needs more
 * work and is not worth it for now. Mobile has no Node APIs, so Node modules are
 * loaded at runtime only when running on desktop.
 */
import type { IncomingMessage } from 'http'

import { Platform } from 'obsidian'

export type StreamSource = ReadableStream<Uint8Array> | NodeJS.ReadableStream

type PostOptions = {
  headers?: Record<string, string>
  signal?: AbortSignal
  fetchFn?: typeof fetch
}

const MAX_ERROR_BODY_BYTES = 4096

export class LLMHttpError extends Error {
  public readonly status: number
  public readonly responseBody: string
  public readonly requestId?: string

  constructor(status: number, responseBody: string, requestId?: string) {
    const safeResponseBody = prepareErrorBody(responseBody)
    const details = safeResponseBody ? ` ${safeResponseBody}` : ''
    const request = requestId ? ` (request ID: ${requestId})` : ''
    super(`Request failed: ${status}${details}${request}`)
    this.name = 'LLMHttpError'
    this.status = status
    this.responseBody = safeResponseBody
    this.requestId = requestId
  }
}

export async function postJson<T>(
  endpoint: string,
  body: unknown,
  options: PostOptions = {},
): Promise<T> {
  const { headers, signal, fetchFn } = options
  const payload = JSON.stringify(body)

  if (fetchFn) {
    const response = await fetchFn(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(headers ?? {}),
      },
      body: payload,
      signal,
    })

    if (!response.ok) {
      throw await getFetchError(response)
    }

    return (await response.json()) as T
  }

  const response = await nodePost(endpoint, payload, headers, signal)
  const status = response.statusCode ?? 0
  const responseBody = await readStreamToString(response)
  if (status < 200 || status >= 300) {
    throw getNodeError(response, status, responseBody)
  }

  return JSON.parse(responseBody) as T
}

export async function postFormUrlEncoded<T>(
  endpoint: string,
  body: Record<string, string>,
  options: PostOptions = {},
): Promise<T> {
  const { headers, signal, fetchFn } = options
  const payload = new URLSearchParams(body).toString()
  const formHeaders = {
    'Content-Type': 'application/x-www-form-urlencoded',
    ...(headers ?? {}),
  }

  if (fetchFn) {
    const response = await fetchFn(endpoint, {
      method: 'POST',
      headers: formHeaders,
      body: payload,
      signal,
    })

    if (!response.ok) {
      throw await getFetchError(response)
    }

    return (await response.json()) as T
  }

  const response = await nodePost(
    endpoint,
    payload,
    formHeaders,
    signal,
    'application/x-www-form-urlencoded',
  )
  const status = response.statusCode ?? 0
  const responseBody = await readStreamToString(response)
  if (status < 200 || status >= 300) {
    throw getNodeError(response, status, responseBody)
  }

  return JSON.parse(responseBody) as T
}

export async function postStream(
  endpoint: string,
  body: unknown,
  options: PostOptions = {},
): Promise<StreamSource> {
  const { headers, signal, fetchFn } = options
  const payload = JSON.stringify(body)

  if (fetchFn) {
    const response = await fetchFn(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(headers ?? {}),
      },
      body: payload,
      signal,
    })

    if (!response.ok) {
      throw await getFetchError(response)
    }
    if (!response.body) {
      throw new LLMHttpError(
        response.status,
        'Response did not include a readable body.',
        getFetchRequestId(response),
      )
    }

    return response.body
  }

  const response = await nodePost(endpoint, payload, headers, signal)
  const status = response.statusCode ?? 0
  if (status < 200 || status >= 300) {
    const responseBody = await readStreamToString(response)
    throw getNodeError(response, status, responseBody)
  }

  return response
}

async function nodePost(
  endpoint: string,
  body: string,
  headers?: Record<string, string>,
  signal?: AbortSignal,
  contentType = 'application/json',
): Promise<IncomingMessage> {
  if (!Platform.isDesktop) {
    throw new Error('HTTP transport is not available on mobile')
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const http = require('http') as typeof import('http')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const https = require('https') as typeof import('https')
  const url = new URL(endpoint)
  const client = url.protocol === 'https:' ? https : http
  const payloadLength = Buffer.byteLength(body)
  const requestHeaders: Record<string, string> = {
    'Content-Type': contentType,
    'Content-Length': payloadLength.toString(),
    ...(headers ?? {}),
  }

  return new Promise((resolve, reject) => {
    const request = client.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port ? Number(url.port) : undefined,
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        headers: requestHeaders,
      },
      (response) => {
        resolve(response)
      },
    )

    let settled = false
    const rejectOnce = (error: Error) => {
      if (settled) {
        return
      }
      settled = true
      reject(error)
    }

    request.on('error', (error) => {
      rejectOnce(error)
    })

    if (signal) {
      const abortError = new Error('Request aborted')
      if (signal.aborted) {
        rejectOnce(abortError)
        request.destroy(abortError)
        return
      }
      const abortHandler = () => {
        rejectOnce(abortError)
        request.destroy(abortError)
      }
      signal.addEventListener('abort', abortHandler, { once: true })
      request.on('close', () => {
        signal.removeEventListener('abort', abortHandler)
      })
    }

    request.write(body)
    request.end()
  })
}

async function readStreamToString(
  stream: NodeJS.ReadableStream,
): Promise<string> {
  const chunks: Uint8Array[] = []
  for await (const chunk of stream) {
    if (typeof chunk === 'string') {
      chunks.push(Buffer.from(chunk))
    } else {
      chunks.push(chunk as Uint8Array)
    }
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function getFetchError(response: Response): Promise<LLMHttpError> {
  let responseBody = ''
  try {
    responseBody = await response.text()
  } catch {
    // Some mocked or already-consumed responses cannot expose their body.
  }
  return new LLMHttpError(
    response.status,
    responseBody,
    getFetchRequestId(response),
  )
}

function getFetchRequestId(response: Response): string | undefined {
  return (
    response.headers?.get('x-request-id') ??
    response.headers?.get('request-id') ??
    undefined
  )
}

function getNodeError(
  response: IncomingMessage,
  status: number,
  responseBody: string,
): LLMHttpError {
  const header =
    response.headers['x-request-id'] ?? response.headers['request-id']
  const requestId = Array.isArray(header) ? header[0] : header
  return new LLMHttpError(status, responseBody, requestId)
}

function prepareErrorBody(body: string): string {
  const sanitized = body
    .replace(
      /(["'](?:authorization|access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|apikey|token)["']\s*:\s*["'])(.*?)(["'])/gi,
      '$1[REDACTED]$3',
    )
    .replace(
      /\b((?:access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|apikey|token)\s*=\s*)[^&\s]+/gi,
      '$1[REDACTED]',
    )
    .replace(
      /\b((?:authorization|api[_-]?key|apikey)\s*:\s*)[^\r\n,;}]+/gi,
      '$1[REDACTED]',
    )
    .replace(/\b(Bearer|Basic)\s+[-A-Za-z0-9._~+/]+=*/gi, '$1 [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]')

  let byteLength = 0
  let truncated = ''
  const encoder = new TextEncoder()
  for (const character of sanitized) {
    const characterBytes = encoder.encode(character).byteLength
    if (byteLength + characterBytes > MAX_ERROR_BODY_BYTES) {
      break
    }
    truncated += character
    byteLength += characterBytes
  }
  return truncated
}
