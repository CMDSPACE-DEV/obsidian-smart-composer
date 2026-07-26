import type { App } from 'obsidian'

import type { SmartComposerSettings } from '../../settings/schema/setting.types'
import type { McpConnectionConfig } from '../../types/mcp.types'
import {
  type ResearchConnectionTest,
  type ResearchEvidence,
  type ResearchPackId,
  type ResearchSearchRequest,
  type ResearchSearchResult,
  type ResearchSourceId,
} from '../../types/research.types'
import { ToolCallResponseStatus } from '../../types/tool-call.types'
import type { LocalResponseTool } from '../../utils/chat/responseGenerator'

import { getResearchAdapter } from './ResearchAdapters'
import { ResearchHttpClient } from './ResearchHttpClient'
import { ResearchSecretStore, getResearchSecretId } from './ResearchSecretStore'
import {
  RESEARCH_PACKS,
  RESEARCH_SOURCES,
  getResearchPack,
  getResearchSource,
} from './ResearchSourceRegistry'

type SettingsUpdater = (settings: SmartComposerSettings) => Promise<void>

const CACHE_TTL_MS = 5 * 60 * 1000
const MAX_CACHE_ENTRIES = 50

export class ResearchManager {
  private settings: SmartComposerSettings
  private readonly setSettings: SettingsUpdater
  private readonly secrets: ResearchSecretStore
  private readonly http = new ResearchHttpClient()
  private readonly unsubscribe: () => void
  private readonly cache = new Map<
    string,
    { expiresAt: number; result: ResearchSearchResult }
  >()

  constructor({
    app,
    settings,
    setSettings,
    registerSettingsListener,
  }: {
    app: App
    settings: SmartComposerSettings
    setSettings: SettingsUpdater
    registerSettingsListener: (
      listener: (settings: SmartComposerSettings) => void,
    ) => () => void
  }) {
    this.settings = settings
    this.setSettings = setSettings
    this.secrets = new ResearchSecretStore(app)
    this.unsubscribe = registerSettingsListener((next) => {
      this.settings = next
      this.pruneCache()
    })
  }

  cleanup(): void {
    this.unsubscribe()
    this.cache.clear()
  }

  getSecretStore(): ResearchSecretStore {
    return this.secrets
  }

  getEnabledSourceIds(): ResearchSourceId[] {
    return (Object.keys(RESEARCH_SOURCES) as ResearchSourceId[]).filter(
      (sourceId) => this.settings.research.sources[sourceId]?.enabled,
    )
  }

  getEnabledPackIds(): ResearchPackId[] {
    return RESEARCH_PACKS.filter((pack) =>
      pack.sourceIds.some(
        (sourceId) => this.settings.research.sources[sourceId]?.enabled,
      ),
    ).map((pack) => pack.id)
  }

  resolvePackIds(packIds: readonly ResearchPackId[]): ResearchSourceId[] {
    return unique(
      packIds.flatMap((packId) => getResearchPack(packId)?.sourceIds ?? []),
    )
  }

  selectSourceIds(
    query: string,
    explicitSourceIds: readonly ResearchSourceId[] = [],
  ): ResearchSourceId[] {
    const enabled = new Set(this.getEnabledSourceIds())
    const explicit = unique(explicitSourceIds).filter((sourceId) =>
      enabled.has(sourceId),
    )
    if (explicit.length > 0) return explicit
    if (this.settings.research.routingMode !== 'auto') return []

    const candidates = [...enabled].filter((sourceId) => {
      const sourceSettings = this.settings.research.sources[sourceId]
      return (
        sourceSettings?.autoPolicy === 'allow' && this.isConfigured(sourceId)
      )
    })
    const scored = candidates
      .map((sourceId) => ({
        sourceId,
        score: scoreSource(sourceId, query),
      }))
      .sort(
        (a, b) =>
          b.score - a.score ||
          getResearchSource(a.sourceId).name.localeCompare(
            getResearchSource(b.sourceId).name,
          ),
      )
    const positive = scored.filter((item) => item.score > 0)
    const fallback = scored.filter((item) =>
      ['crossref', 'openalex', 'naver'].includes(item.sourceId),
    )
    const selected =
      positive.length > 0 ? positive : hasResearchIntent(query) ? fallback : []
    return selected
      .slice(0, this.settings.research.maxAutoSources)
      .map((item) => item.sourceId)
  }

  getMcpConnectionIds(sourceIds: readonly ResearchSourceId[]): string[] {
    return unique(
      sourceIds.flatMap((sourceId) => {
        const source = getResearchSource(sourceId)
        if (source.protocol !== 'mcp' || !source.mcpPreset) return []
        const connection = this.findMcpConnection(sourceId)
        return connection?.enabled ? [connection.id] : []
      }),
    )
  }

  isMcpPresetInstalled(sourceId: ResearchSourceId): boolean {
    return Boolean(this.findMcpConnection(sourceId))
  }

  getLocalTools({
    query,
    explicitSourceIds = [],
  }: {
    query: string
    explicitSourceIds?: readonly ResearchSourceId[]
  }): LocalResponseTool[] {
    const selected = this.selectSourceIds(query, explicitSourceIds)
    return selected.flatMap((sourceId) => {
      const source = getResearchSource(sourceId)
      if (source.protocol !== 'native' || !getResearchAdapter(sourceId)) {
        return []
      }
      return [this.createSearchTool(sourceId)]
    })
  }

  async searchSources({
    query,
    explicitSourceIds = [],
    limit = 8,
    signal,
  }: {
    query: string
    explicitSourceIds?: readonly ResearchSourceId[]
    limit?: number
    signal?: AbortSignal
  }): Promise<{
    sourceIds: ResearchSourceId[]
    records: ResearchEvidence[]
    warnings: string[]
  }> {
    const sourceIds = this.selectSourceIds(query, explicitSourceIds).filter(
      (sourceId) => getResearchSource(sourceId).protocol === 'native',
    )
    const settled = await Promise.allSettled(
      sourceIds.map((sourceId) =>
        this.search(sourceId, { query, limit }, signal),
      ),
    )
    const records: ResearchEvidence[] = []
    const warnings: string[] = []
    settled.forEach((entry, index) => {
      const sourceId = sourceIds[index]
      if (entry.status === 'fulfilled') {
        records.push(...entry.value.records)
        warnings.push(...entry.value.warnings)
      } else {
        warnings.push(
          `${getResearchSource(sourceId).name}: ${toErrorMessage(entry.reason)}`,
        )
      }
    })
    return {
      sourceIds,
      records: dedupeEvidence(records),
      warnings: unique(warnings),
    }
  }

  async search(
    sourceId: ResearchSourceId,
    request: ResearchSearchRequest,
    signal?: AbortSignal,
  ): Promise<ResearchSearchResult> {
    const adapter = getResearchAdapter(sourceId)
    if (!adapter) {
      throw new Error(
        `${getResearchSource(sourceId).name} is an MCP connection, not a native research API.`,
      )
    }
    if (!this.settings.research.sources[sourceId]?.enabled) {
      throw new Error(`${getResearchSource(sourceId).name} is disabled.`)
    }
    if (!this.isConfigured(sourceId)) {
      throw new Error(
        `${getResearchSource(sourceId).name} is missing required connection settings.`,
      )
    }
    const cacheKey = JSON.stringify([sourceId, request])
    const cached = this.cache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) return cached.result
    const result = await adapter.search(
      request,
      {
        http: this.http,
        secrets: this.secrets,
        settings: this.settings.research.sources[sourceId],
      },
      signal,
    )
    this.cache.set(cacheKey, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      result,
    })
    this.pruneCache()
    return result
  }

  async testConnection(
    sourceId: ResearchSourceId,
    signal?: AbortSignal,
  ): Promise<ResearchConnectionTest> {
    const source = getResearchSource(sourceId)
    const checkedAt = Date.now()
    if (!this.isConfigured(sourceId)) {
      return {
        ok: false,
        message: 'Required credentials or options are missing.',
        checkedAt,
      }
    }
    if (source.protocol === 'mcp') {
      const installed = Boolean(this.findMcpConnection(sourceId))
      return {
        ok: installed,
        message: installed
          ? 'MCP preset is installed. Use Connect and scan tools in the MCP tab to verify the live endpoint.'
          : 'Install the curated MCP preset first.',
        checkedAt,
      }
    }
    try {
      const result = await this.search(
        sourceId,
        { query: connectionTestQuery(sourceId), limit: 1 },
        signal,
      )
      await this.markTested(sourceId, checkedAt)
      return {
        ok: true,
        message: `Connected. ${result.records.length} test result(s) returned. This test used one provider request.`,
        checkedAt,
      }
    } catch (error) {
      return {
        ok: false,
        message: toErrorMessage(error),
        checkedAt,
      }
    }
  }

  async installMcpPreset(sourceId: ResearchSourceId): Promise<void> {
    const source = getResearchSource(sourceId)
    const preset = source.mcpPreset
    if (!preset) {
      throw new Error(`${source.name} does not have an MCP preset.`)
    }
    const transport: McpConnectionConfig['transport'] = {
      type: 'streamable-http',
      url: preset.url,
      legacySse: preset.legacySse,
      secretQueryParams: preset.secretQueryParam
        ? {
            [preset.secretQueryParam.name]: getResearchSecretId(
              sourceId,
              preset.secretQueryParam.secretFieldId,
            ),
          }
        : {},
    }
    const existing = this.findMcpConnection(sourceId)
    const connection: McpConnectionConfig = existing
      ? {
          ...existing,
          name: source.name,
          enabled: true,
          transport,
        }
      : {
          id: preset.connectionId,
          name: source.name,
          enabled: true,
          transport,
          auth: { mode: 'none' },
          toolOptions: {},
        }
    await this.setSettings({
      ...this.settings,
      mcp: {
        ...this.settings.mcp,
        connections: existing
          ? this.settings.mcp.connections.map((candidate) =>
              candidate.id === connection.id ? connection : candidate,
            )
          : [...this.settings.mcp.connections, connection],
      },
    })
  }

  private createSearchTool(sourceId: ResearchSourceId): LocalResponseTool {
    const source = getResearchSource(sourceId)
    return {
      definition: {
        type: 'function',
        function: {
          name: `research_${sourceId.replace(/-/g, '_')}_search`,
          description: [
            `Search ${source.name} (${source.operator}).`,
            source.description,
            'Return normalized evidence records with source URLs and caveats. Cite those URLs and distinguish discovery metadata from verified full text.',
          ].join(' '),
          parameters: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'A concise source-specific search query.',
              },
              limit: {
                type: 'number',
                description: 'Maximum records to return, normally 5-10.',
              },
            },
            required: ['query'],
            additionalProperties: false,
          },
        },
      },
      call: async (args, signal) => {
        const query = typeof args.query === 'string' ? args.query.trim() : ''
        if (!query) {
          return {
            status: ToolCallResponseStatus.Error,
            error: 'A non-empty research query is required.',
          }
        }
        try {
          const response = await this.search(
            sourceId,
            {
              query,
              limit:
                typeof args.limit === 'number'
                  ? Math.max(1, Math.min(20, Math.floor(args.limit)))
                  : 8,
            },
            signal,
          )
          const payload = {
            source: {
              id: source.id,
              name: source.name,
              operator: source.operator,
              role: source.role,
              retrievedAt: new Date().toISOString(),
            },
            records: response.records,
            warnings: response.warnings,
          }
          return {
            status: ToolCallResponseStatus.Success,
            data: {
              type: 'text',
              text: JSON.stringify(payload, null, 2),
              structuredContent: payload,
            },
          }
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') {
            return { status: ToolCallResponseStatus.Aborted }
          }
          return {
            status: ToolCallResponseStatus.Error,
            error: toErrorMessage(error),
          }
        }
      },
    }
  }

  private isConfigured(sourceId: ResearchSourceId): boolean {
    const definition = getResearchSource(sourceId)
    const settings = this.settings.research.sources[sourceId]
    if (!settings?.enabled) return false
    const hasSecrets = definition.secretFields
      .filter((field) => field.required)
      .every((field) => this.secrets.has(sourceId, field.id))
    const hasOptions = definition.optionFields
      .filter((field) => field.required)
      .every((field) => {
        const value = settings.options[field.id] ?? field.defaultValue
        return typeof value === 'string' && Boolean(value.trim())
      })
    return hasSecrets && hasOptions
  }

  private findMcpConnection(
    sourceId: ResearchSourceId,
  ): McpConnectionConfig | undefined {
    const preset = getResearchSource(sourceId).mcpPreset
    if (!preset) return undefined
    return this.settings.mcp.connections.find(
      (connection) =>
        connection.id === preset.connectionId ||
        (connection.transport.type === 'streamable-http' &&
          sameRemoteEndpoint(connection.transport.url, preset.url)),
    )
  }

  private async markTested(
    sourceId: ResearchSourceId,
    checkedAt: number,
  ): Promise<void> {
    const source = this.settings.research.sources[sourceId]
    await this.setSettings({
      ...this.settings,
      research: {
        ...this.settings.research,
        sources: {
          ...this.settings.research.sources,
          [sourceId]: { ...source, lastTestedAt: checkedAt },
        },
      },
    })
  }

  private pruneCache(): void {
    const now = Date.now()
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt <= now) this.cache.delete(key)
    }
    while (this.cache.size > MAX_CACHE_ENTRIES) {
      const first = this.cache.keys().next().value as string | undefined
      if (!first) break
      this.cache.delete(first)
    }
  }
}

function scoreSource(sourceId: ResearchSourceId, query: string): number {
  const normalized = query.toLocaleLowerCase()
  const terms: Partial<Record<ResearchSourceId, string[]>> = {
    wos: ['wos', 'web of science', 'ssci', 'sci', 'ahci', 'indexed'],
    crossref: [
      'doi',
      'retract',
      '철회',
      '정정',
      'correction',
      'metadata',
      '논문',
      '학술',
      'paper',
      'research',
    ],
    openalex: [
      'citation',
      '인용',
      'author',
      '저자',
      'institution',
      '연구자',
      '논문',
      '학술',
      'paper',
      'research',
    ],
    kci: ['kci', '한국학술', '국내 논문', '등재지'],
    scienceon: ['scienceon', '과학기술', 'kisti'],
    riss: ['riss', '학위논문', '석사논문', '박사논문', '국내 논문'],
    opendart: ['dart', '공시', '사업보고서', '기업', '상장사'],
    ntis: ['ntis', '국가 r&d', '국가연구개발', '연구과제'],
    kosis: ['kosis', '통계', '인구', '지표', 'statistics'],
    naver: ['뉴스', '최신', '오늘', 'recent', 'news', '국내 웹'],
    pubmed: ['pubmed', '의학', '임상', 'biomedical', 'medicine', '질환'],
    'europe-pmc': ['europe pmc', '생명과학', '오픈액세스', 'life science'],
  }
  return (terms[sourceId] ?? []).reduce(
    (score, term) => score + (normalized.includes(term) ? 2 : 0),
    0,
  )
}

function hasResearchIntent(query: string): boolean {
  return /(?:팩트\s*체크|사실\s*확인|검증|근거|출처|인용|논문|학술|연구|문헌|통계|공시|뉴스|검색|찾아|조사|verify|fact[\s-]*check|evidence|source|citation|paper|academic|research|literature|statistics?|filing|news|search|find)/i.test(
    query,
  )
}

function connectionTestQuery(sourceId: ResearchSourceId): string {
  const queries: Partial<Record<ResearchSourceId, string>> = {
    wos: 'artificial intelligence',
    kci: '인공지능',
    scienceon: '인공지능',
    riss: '인공지능',
    opendart: '삼성전자',
    ntis: '인공지능',
    naver: '인공지능',
    pubmed: 'artificial intelligence',
    'europe-pmc': 'artificial intelligence',
  }
  return queries[sourceId] ?? 'artificial intelligence'
}

function dedupeEvidence(records: ResearchEvidence[]): ResearchEvidence[] {
  const seen = new Set<string>()
  return records.filter((record) => {
    const key = [
      record.identifiers.doi?.toLocaleLowerCase(),
      record.identifiers.pmid,
      record.url,
      record.title.toLocaleLowerCase(),
    ]
      .filter(Boolean)
      .join('|')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function unique<T>(items: readonly T[]): T[] {
  return Array.from(new Set(items))
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function sameRemoteEndpoint(left: string, right: string): boolean {
  try {
    const normalize = (value: string) => {
      const url = new URL(value)
      url.search = ''
      url.hash = ''
      url.pathname = url.pathname.replace(/\/+$/, '') || '/'
      return url.toString()
    }
    return normalize(left) === normalize(right)
  } catch {
    return false
  }
}
