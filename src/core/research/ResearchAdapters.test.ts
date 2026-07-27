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

  it('uses NAVER API HUB first and sends the current authentication headers', async () => {
    const requestJson = jest.fn().mockResolvedValue({ items: [] })
    const adapter = getResearchAdapter('naver')

    await adapter?.search(
      { query: 'AI education', limit: 1 },
      {
        http: { requestJson } as unknown as ResearchHttpClient,
        secrets: naverSecrets(),
        settings: naverSettings('api-hub'),
      },
    )

    expect(requestJson).toHaveBeenCalledTimes(1)
    const [, request] = requestJson.mock.calls[0] as [
      string,
      { url: string; headers: Record<string, string> },
    ]
    expect(request.url).toContain(
      'https://naverapihub.apigw.ntruss.com/search/v1/news?',
    )
    expect(request.headers).toEqual({
      'X-NCP-APIGW-API-KEY-ID': 'naver-id',
      'X-NCP-APIGW-API-KEY': 'naver-secret',
    })
  })

  it('supports an explicitly selected legacy NAVER Developers application', async () => {
    const requestJson = jest.fn().mockResolvedValue({ items: [] })
    const adapter = getResearchAdapter('naver')

    const result = await adapter?.search(
      { query: 'AI education', limit: 1 },
      {
        http: { requestJson } as unknown as ResearchHttpClient,
        secrets: naverSecrets(),
        settings: naverSettings('legacy-developers'),
      },
    )

    const [, request] = requestJson.mock.calls[0] as [
      string,
      { url: string; headers: Record<string, string> },
    ]
    expect(request.url).toContain(
      'https://openapi.naver.com/v1/search/news.json?',
    )
    expect(request.headers).toEqual({
      'X-Naver-Client-Id': 'naver-id',
      'X-Naver-Client-Secret': 'naver-secret',
    })
    expect(result?.warnings.join(' ')).toContain('legacy NAVER Developers')
  })

  it('auto-detects a legacy NAVER key pair after API HUB rejects it', async () => {
    const requestJson = jest
      .fn()
      .mockRejectedValueOnce(
        new Error(
          'naver: NAVER API HUB authentication failed. Provider errorCode 200 is an authentication error.',
        ),
      )
      .mockResolvedValueOnce({ items: [] })
    const adapter = getResearchAdapter('naver')

    const result = await adapter?.search(
      { query: 'AI education', limit: 1 },
      {
        http: { requestJson } as unknown as ResearchHttpClient,
        secrets: naverSecrets(),
        settings: naverSettings('auto'),
      },
    )

    expect(requestJson).toHaveBeenCalledTimes(2)
    const [, legacyRequest] = requestJson.mock.calls[1] as [
      string,
      { url: string },
    ]
    expect(legacyRequest.url).toContain('https://openapi.naver.com/')
    expect(result?.warnings.join(' ')).toContain('2027-06-30')
  })

  it('explains when both NAVER credential services reject the key pair', async () => {
    const requestJson = jest
      .fn()
      .mockRejectedValue(
        new Error(
          'naver: Authentication or entitlement was rejected. {"errorCode":"024"}',
        ),
      )
    const adapter = getResearchAdapter('naver')

    await expect(
      adapter?.search(
        { query: 'AI education', limit: 1 },
        {
          http: { requestJson } as unknown as ResearchHttpClient,
          secrets: naverSecrets(),
          settings: naverSettings('auto'),
        },
      ),
    ).rejects.toThrow('rejected by both API HUB and the legacy Developers API')
    expect(requestJson).toHaveBeenCalledTimes(2)
  })
})

function naverSecrets(): ResearchSecretStore {
  return {
    get: (_sourceId: string, fieldId: string) =>
      fieldId === 'key-id' ? 'naver-id' : 'naver-secret',
  } as unknown as ResearchSecretStore
}

function naverSettings(
  credentialService: 'auto' | 'api-hub' | 'legacy-developers',
): ResearchSourceSettings {
  return {
    enabled: true,
    autoPolicy: 'allow',
    options: {
      'credential-service': credentialService,
      vertical: 'news',
    },
  }
}
