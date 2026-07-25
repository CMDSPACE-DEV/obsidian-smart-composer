import type { Readable } from 'stream'

import type {
  RequestInit as NodeFetchRequestInit,
  Response as NodeFetchResponse,
} from 'node-fetch'

const NULL_BODY_STATUSES = new Set([101, 204, 205, 304])
let nodeFetchPromise: Promise<typeof import('node-fetch').default> | null = null

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

function getNodeFetch(): Promise<typeof import('node-fetch').default> {
  nodeFetchPromise ??= import('node-fetch').then((module) => module.default)
  return nodeFetchPromise
}

function toWebResponse(response: NodeFetchResponse): Response {
  const headers = new Headers()
  response.headers.forEach((value, key) => {
    headers.append(key, value)
  })

  const body =
    response.body && !NULL_BODY_STATUSES.has(response.status)
      ? toWebReadableStream(response.body as Readable)
      : null

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
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
