import { z } from 'zod'

export const RESEARCH_SOURCE_IDS = [
  'korean-law',
  'wos',
  'crossref',
  'openalex',
  'kci',
  'scienceon',
  'riss',
  'opendart',
  'ntis',
  'kosis',
  'naver',
  'pubmed',
  'europe-pmc',
] as const
export type ResearchSourceId = (typeof RESEARCH_SOURCE_IDS)[number]

export const RESEARCH_PACK_IDS = [
  'wos',
  'doi-integrity',
  'openalex',
  'korean-academic',
  'korean-facts',
  'naver',
  'biomedical',
] as const
export type ResearchPackId = (typeof RESEARCH_PACK_IDS)[number]

export const RESEARCH_ROUTING_MODES = ['auto', 'explicit', 'off'] as const
export type ResearchRoutingMode = (typeof RESEARCH_ROUTING_MODES)[number]

export const RESEARCH_AUTO_POLICIES = ['allow', 'explicit-only', 'off'] as const
export type ResearchAutoPolicy = (typeof RESEARCH_AUTO_POLICIES)[number]

export const RESEARCH_SOURCE_ROLES = [
  'discover',
  'verify',
  'index',
  'official',
] as const
export type ResearchSourceRole = (typeof RESEARCH_SOURCE_ROLES)[number]

export const researchSourceSettingsSchema = z.object({
  enabled: z.boolean().catch(false),
  autoPolicy: z.enum(RESEARCH_AUTO_POLICIES).catch('explicit-only'),
  options: z.record(z.string(), z.unknown()).catch({}),
  lastTestedAt: z.number().optional(),
})
export type ResearchSourceSettings = z.infer<
  typeof researchSourceSettingsSchema
>

const DEFAULT_AUTO_SOURCES = new Set<ResearchSourceId>([
  'crossref',
  'openalex',
  'riss',
  'naver',
  'pubmed',
  'europe-pmc',
])

export const DEFAULT_RESEARCH_SOURCES = Object.fromEntries(
  RESEARCH_SOURCE_IDS.map((sourceId) => [
    sourceId,
    {
      enabled: false,
      autoPolicy: DEFAULT_AUTO_SOURCES.has(sourceId)
        ? ('allow' as const)
        : ('explicit-only' as const),
      options: {},
    },
  ]),
) as Record<ResearchSourceId, ResearchSourceSettings>

export const researchSettingsSchema = z.object({
  routingMode: z.enum(RESEARCH_ROUTING_MODES).catch('auto'),
  maxAutoSources: z.number().int().min(1).max(4).catch(2),
  sources: z
    .record(z.enum(RESEARCH_SOURCE_IDS), researchSourceSettingsSchema)
    .catch(DEFAULT_RESEARCH_SOURCES),
})
export type ResearchSettings = z.infer<typeof researchSettingsSchema>

export type ResearchEvidence = {
  sourceId: ResearchSourceId
  sourceName: string
  operator: string
  role: ResearchSourceRole
  title: string
  url: string
  publishedAt?: string
  retrievedAt: string
  identifiers: {
    doi?: string
    pmid?: string
    wosUid?: string
    kciId?: string
    sourceId?: string
  }
  snippet?: string
  authors?: string[]
  publicationName?: string
  citationCount?: number
  isOpenAccess?: boolean
  editorialStatus?: 'current' | 'corrected' | 'retracted' | 'unknown'
  indexCoverage?: string[]
  caveats?: string[]
  raw?: unknown
}

export type ResearchSearchRequest = {
  query: string
  limit?: number
  cursor?: string
  filters?: Record<string, string | number | boolean>
}

export type ResearchSearchResult = {
  records: ResearchEvidence[]
  nextCursor?: string
  warnings: string[]
}

export type ResearchConnectionTest = {
  ok: boolean
  message: string
  checkedAt: number
}
