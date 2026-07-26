import type { App } from 'obsidian'

import type { SmartComposerSettings } from '../../settings/schema/setting.types'
import {
  DEFAULT_RESEARCH_SOURCES,
  type ResearchSourceId,
} from '../../types/research.types'

import { ResearchManager } from './ResearchManager'

function createSettings(
  enabledSourceIds: readonly ResearchSourceId[],
): SmartComposerSettings {
  const enabled = new Set(enabledSourceIds)
  return {
    research: {
      routingMode: 'auto',
      maxAutoSources: 2,
      sources: Object.fromEntries(
        Object.entries(DEFAULT_RESEARCH_SOURCES).map(([sourceId, source]) => [
          sourceId,
          {
            ...source,
            options: { ...source.options },
            enabled: enabled.has(sourceId as ResearchSourceId),
          },
        ]),
      ),
    },
    mcp: { routingMode: 'auto', connections: [] },
  } as unknown as SmartComposerSettings
}

function createManager(
  enabledSourceIds: readonly ResearchSourceId[],
): ResearchManager {
  const secrets = new Map<string, string>([
    ['smart-composer-research-openalex-api-key', 'openalex-key'],
    ['smart-composer-research-naver-key-id', 'naver-id'],
    ['smart-composer-research-naver-api-key', 'naver-key'],
  ])
  const app = {
    secretStorage: {
      setSecret: (id: string, value: string) => secrets.set(id, value),
      getSecret: (id: string) => secrets.get(id) ?? null,
    },
  } as unknown as App
  return new ResearchManager({
    app,
    settings: createSettings(enabledSourceIds),
    setSettings: async () => undefined,
    registerSettingsListener: () => () => undefined,
  })
}

describe('ResearchManager source routing', () => {
  it('does not attach research tools to ordinary writing requests', () => {
    const manager = createManager(['crossref', 'openalex', 'naver'])

    expect(
      manager.selectSourceIds('이 문장을 더 자연스럽고 간결하게 다듬어줘'),
    ).toEqual([])

    manager.cleanup()
  })

  it('uses bounded fallback sources for an explicit research intent', () => {
    const manager = createManager(['crossref', 'openalex', 'naver'])

    expect(manager.selectSourceIds('관련 논문과 근거 자료를 찾아줘')).toEqual([
      'crossref',
      'openalex',
    ])

    manager.cleanup()
  })

  it('routes source-specific intent and preserves explicit selections', () => {
    const manager = createManager(['crossref', 'openalex', 'naver', 'wos'])

    expect(manager.selectSourceIds('오늘 국내 최신 뉴스 검색')).toEqual([
      'naver',
    ])
    expect(
      manager.selectSourceIds('문장을 다듬어줘', ['wos', 'crossref']),
    ).toEqual(['wos', 'crossref'])

    manager.cleanup()
  })
})
