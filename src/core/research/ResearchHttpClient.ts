import { requestUrl } from 'obsidian'

import type { ResearchSourceId } from '../../types/research.types'

export type ResearchHttpRequest = {
  url: string
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: string
}

const MIN_INTERVAL_MS: Partial<Record<ResearchSourceId, number>> = {
  wos: 1000,
  crossref: 200,
  openalex: 100,
  pubmed: 350,
  'europe-pmc': 100,
}

export class ResearchHttpClient {
  private readonly lastRequestAt = new Map<ResearchSourceId, number>()

  async request(
    sourceId: ResearchSourceId,
    request: ResearchHttpRequest,
    signal?: AbortSignal,
  ): Promise<{
    status: number
    headers: Record<string, string>
    text: string
  }> {
    throwIfAborted(signal)
    await this.waitForRateLimit(sourceId, signal)
    throwIfAborted(signal)

    let response: Awaited<ReturnType<typeof requestUrl>>
    try {
      response = await requestUrl({
        url: request.url,
        method: request.method ?? 'GET',
        headers: request.headers,
        body: request.body,
        throw: false,
      })
    } catch {
      throw new Error(
        `${sourceId}: Network request failed before a response was received.`,
      )
    }
    this.lastRequestAt.set(sourceId, Date.now())
    throwIfAborted(signal)

    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        sanitizeHttpError(
          sourceId,
          response.status,
          response.text.slice(0, 500),
        ),
      )
    }
    return {
      status: response.status,
      headers: response.headers,
      text: response.text,
    }
  }

  async requestJson<T>(
    sourceId: ResearchSourceId,
    request: ResearchHttpRequest,
    signal?: AbortSignal,
  ): Promise<T> {
    const response = await this.request(sourceId, request, signal)
    try {
      return JSON.parse(response.text) as T
    } catch {
      throw new Error(`${sourceId} returned invalid JSON.`)
    }
  }

  private async waitForRateLimit(
    sourceId: ResearchSourceId,
    signal?: AbortSignal,
  ): Promise<void> {
    const interval = MIN_INTERVAL_MS[sourceId] ?? 0
    const lastRequest = this.lastRequestAt.get(sourceId) ?? 0
    const waitMs = interval - (Date.now() - lastRequest)
    if (waitMs <= 0) return
    await abortableDelay(waitMs, signal)
  }
}

export function appendQuery(
  baseUrl: string,
  params: Record<string, string | number | boolean | undefined>,
): string {
  const url = new URL(baseUrl)
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      url.searchParams.set(name, String(value))
    }
  }
  return url.toString()
}

function sanitizeHttpError(
  sourceId: ResearchSourceId,
  status: number,
  text: string,
): string {
  if (
    sourceId === 'naver' &&
    /"errorCode"\s*:\s*"200"/i.test(text) &&
    /Authentication Failed/i.test(text)
  ) {
    return (
      'naver: NAVER API HUB authentication failed. Provider errorCode 200 ' +
      'is an authentication error, not HTTP 200 success.'
    )
  }
  const generic =
    status === 401 || status === 403
      ? 'Authentication or entitlement was rejected.'
      : status === 429
        ? 'The source quota or rate limit was reached.'
        : `Request failed with HTTP ${status}.`
  const safeText = text
    .replace(
      /([?&][^=&\s"]*(?:key|token|secret|password|credential|oc)[^=&\s"]*=)[^&\s"]+/gi,
      '$1[redacted]',
    )
    .replace(
      /("[^"]*(?:key|token|secret|password|credential|oc)[^"]*"\s*:\s*")[^"]+/gi,
      '$1[redacted]',
    )
  return `${sourceId}: ${generic}${safeText ? ` ${safeText}` : ''}`
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timeout)
        reject(new DOMException('Aborted', 'AbortError'))
      },
      { once: true },
    )
  })
}
