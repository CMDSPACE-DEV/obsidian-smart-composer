import type { Readable } from 'stream'

import type {
  RequestInit as NodeFetchRequestInit,
  Response as NodeFetchResponse,
} from 'node-fetch'

const NULL_BODY_STATUSES = new Set([101, 204, 205, 304])
type NodeFetch = typeof import('node-fetch').default
type ResponseBody =
  | NodeFetchResponse['body']
  | ReadableStream<Uint8Array>
  | null

type FetchResponseLike = {
  body: ResponseBody
  headers: {
    forEach(callback: (value: string, key: string) => void): void
  }
  status: number
  statusText: string
}

let nodeFetchPromise: Promise<NodeFetch> | null = null

/**
 * Uses Node's HTTP stack so desktop MCP connections are not blocked by
 * browser CORS, while preserving the Web Response streams expected by the
 * MCP SDK.
 */
export function createDesktopMcpFetch(): typeof fetch {
  return async (input, init) => {
    const nodeFetch = await getNodeFetch()
    const request = new Request(input, init)
    const headers: Record<string, string> = {}
    request.headers.forEach((value, key) => {
      headers[key] = value
    })

    const body =
      request.method === 'GET' || request.method === 'HEAD'
        ? undefined
        : Buffer.from(await request.arrayBuffer())
    const response = await nodeFetch(request.url, {
      method: request.method,
      headers,
      body,
      redirect: request.redirect,
      signal: request.signal as unknown as NonNullable<
        NodeFetchRequestInit['signal']
      >,
    })

    return toWebResponse(response)
  }
}

function getNodeFetch(): Promise<NodeFetch> {
  // Import the Node entry explicitly. The plugin's browser-targeted esbuild
  // configuration otherwise resolves the package root to node-fetch/browser.js
  // and silently reintroduces Chromium CORS enforcement.
  nodeFetchPromise ??= import('node-fetch/lib/index.js').then(
    (module) => module.default,
  )
  return nodeFetchPromise
}

export function toWebResponse(response: FetchResponseLike): Response {
  const headers = new Headers()
  response.headers.forEach((value, key) => {
    headers.append(key, value)
  })

  const body = toCompatibleWebBody(response.body, response.status)

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function toCompatibleWebBody(
  body: ResponseBody,
  status: number,
): ReadableStream<Uint8Array> | null {
  if (!body || NULL_BODY_STATUSES.has(status)) return null
  if (isWebReadableStream(body)) return body
  if (isNodeReadableStream(body)) return toWebReadableStream(body)

  throw new TypeError('Unsupported MCP response body stream.')
}

function isWebReadableStream(
  body: ResponseBody,
): body is ReadableStream<Uint8Array> {
  const candidate = body as Partial<ReadableStream<Uint8Array>>
  return (
    typeof candidate.getReader === 'function' &&
    typeof candidate.pipeThrough === 'function'
  )
}

function isNodeReadableStream(body: ResponseBody): body is Readable {
  const candidate = body as Partial<Readable>
  return (
    typeof candidate.on === 'function' &&
    typeof candidate.once === 'function' &&
    typeof candidate.pause === 'function' &&
    typeof candidate.resume === 'function'
  )
}

function toWebReadableStream(stream: Readable): ReadableStream<Uint8Array> {
  let ended = false

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const cleanup = () => {
        stream.off('data', onData)
        stream.off('end', onEnd)
        stream.off('error', onError)
      }
      const onData = (chunk: Buffer | Uint8Array | string) => {
        const bytes =
          typeof chunk === 'string'
            ? new TextEncoder().encode(chunk)
            : new Uint8Array(chunk)
        controller.enqueue(bytes)
        if ((controller.desiredSize ?? 1) <= 0) stream.pause()
      }
      const onEnd = () => {
        if (ended) return
        ended = true
        cleanup()
        controller.close()
      }
      const onError = (error: Error) => {
        if (ended) return
        ended = true
        cleanup()
        controller.error(error)
      }

      stream.on('data', onData)
      stream.once('end', onEnd)
      stream.once('error', onError)
    },
    pull() {
      stream.resume()
    },
    cancel(reason) {
      ended = true
      stream.destroy(reason instanceof Error ? reason : undefined)
    },
  })
}
