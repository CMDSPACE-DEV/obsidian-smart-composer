import type { App } from 'obsidian'
import { requestUrl } from 'obsidian'

import {
  type SmartComposerSettings,
  smartComposerSettingsSchema,
} from '../../settings/schema/setting.types'
import { DEFAULT_RESEARCH_SOURCES } from '../../types/research.types'

import { ResearchManager } from './ResearchManager'

const requestUrlMock = requestUrl as jest.MockedFunction<typeof requestUrl>

describe('ResearchManager NAVER usage tracking', () => {
  beforeEach(() => {
    requestUrlMock.mockReset()
  })

  it('counts real API HUB responses and does not count cache hits', async () => {
    requestUrlMock.mockResolvedValue({
      status: 200,
      headers: {},
      text: '{"items":[]}',
      json: { items: [] },
      arrayBuffer: new ArrayBuffer(0),
    })
    const secrets = new Map<string, string>([
      ['smart-composer-research-naver-key-id', 'naver-id'],
      ['smart-composer-research-naver-api-key', 'naver-secret'],
    ])
    const app = {
      secretStorage: {
        setSecret: (id: string, value: string) => secrets.set(id, value),
        getSecret: (id: string) => secrets.get(id) ?? null,
      },
    } as unknown as App
    let settings = smartComposerSettingsSchema.parse({})
    const naverSettings =
      settings.research.sources.naver ?? DEFAULT_RESEARCH_SOURCES.naver
    settings = {
      ...settings,
      research: {
        ...settings.research,
        sources: {
          ...settings.research.sources,
          naver: {
            ...naverSettings,
            enabled: true,
            options: {
              'credential-service': 'api-hub',
              vertical: 'news',
            },
          },
        },
      },
    }
    let settingsListener: ((next: SmartComposerSettings) => void) | undefined
    const manager = new ResearchManager({
      app,
      settings,
      setSettings: async (next) => {
        settings = next
        settingsListener?.(next)
      },
      registerSettingsListener: (listener) => {
        settingsListener = listener
        return () => {
          settingsListener = undefined
        }
      },
    })

    await manager.search('naver', { query: 'AI education', limit: 1 })
    await waitForQueuedUsageWrite()

    expect(
      Object.values(settings.research.sources.naver?.usage?.days ?? {}),
    ).toEqual([{ requests: 1, succeeded: 1, failed: 0 }])

    await manager.search('naver', { query: 'AI education', limit: 1 })
    await waitForQueuedUsageWrite()

    expect(requestUrlMock).toHaveBeenCalledTimes(1)
    expect(
      Object.values(settings.research.sources.naver?.usage?.days ?? {}).reduce(
        (sum, bucket) => sum + bucket.requests,
        0,
      ),
    ).toBe(1)
    manager.cleanup()
  })
})

async function waitForQueuedUsageWrite(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })
}
