import type { ResearchSourceSettings } from '../../types/research.types'

import { getResearchAdapter } from './ResearchAdapters'
import type { ResearchHttpClient } from './ResearchHttpClient'
import type { ResearchSecretStore } from './ResearchSecretStore'

describe('research adapters', () => {
  it('sends a Web of Science Core Collection edition filter', async () => {
    const requestJson = jest.fn().mockResolvedValue({ documents: [] })
    const adapter = getResearchAdapter('wos')

    await adapter?.search(
      { query: 'AI literacy', limit: 20 },
      {
        http: { requestJson } as unknown as ResearchHttpClient,
        secrets: {
          get: (_sourceId: string, fieldId: string) =>
            fieldId === 'api-key' ? 'wos-key' : null,
        } as unknown as ResearchSecretStore,
        settings: {
          enabled: true,
          autoPolicy: 'explicit-only',
          options: { editions: 'WOS+SSCI' },
        } satisfies ResearchSourceSettings,
      },
    )

    expect(requestJson).toHaveBeenCalledTimes(1)
    const [, request] = requestJson.mock.calls[0] as [
      string,
      { url: string; headers: Record<string, string> },
    ]
    const url = new URL(request.url)
    expect(url.searchParams.get('db')).toBe('WOS')
    expect(url.searchParams.get('edition')).toBe('WOS+SSCI')
    expect(url.searchParams.get('q')).toBe('TS=("AI literacy")')
    expect(url.searchParams.get('sortField')).toBe('RS+D')
    expect(request.headers['X-ApiKey']).toBe('wos-key')
  })
})
