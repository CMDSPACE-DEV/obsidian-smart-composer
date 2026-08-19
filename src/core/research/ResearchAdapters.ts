import type {
  ResearchEvidence,
  ResearchSearchRequest,
  ResearchSearchResult,
  ResearchSourceId,
  ResearchSourceSettings,
} from '../../types/research.types'

import { ResearchHttpClient, appendQuery } from './ResearchHttpClient'
import { ResearchSecretStore } from './ResearchSecretStore'
import { getResearchSource } from './ResearchSourceRegistry'

export type ResearchAdapterContext = {
  http: ResearchHttpClient
  secrets: ResearchSecretStore
  settings: ResearchSourceSettings
}

export type ResearchAdapter = {
  search(
    request: ResearchSearchRequest,
    context: ResearchAdapterContext,
    signal?: AbortSignal,
  ): Promise<ResearchSearchResult>
}

const adapters: Partial<Record<ResearchSourceId, ResearchAdapter>> = {
  wos: { search: searchWos },
  crossref: { search: searchCrossref },
  openalex: { search: searchOpenAlex },
  kci: { search: searchKci },
  scienceon: {
    search: (request, context, signal) =>
      searchConfigurableSource('scienceon', request, context, signal),
  },
  riss: { search: searchRiss },
  opendart: { search: searchOpenDart },
  ntis: {
    search: (request, context, signal) =>
      searchConfigurableSource('ntis', request, context, signal),
  },
  naver: { search: searchNaver },
  pubmed: { search: searchPubMed },
  'europe-pmc': { search: searchEuropePmc },
}

export function getResearchAdapter(
  sourceId: ResearchSourceId,
): ResearchAdapter | null {
  return adapters[sourceId] ?? null
}

async function searchWos(
  request: ResearchSearchRequest,
  context: ResearchAdapterContext,
  signal?: AbortSignal,
): Promise<ResearchSearchResult> {
  const endpoint = requireEndpoint('wos')
  const apiKey = requireSecret(context, 'wos', 'api-key', 'WoS API key')
  const editions = readOption(context.settings, 'editions', 'WOS+SSCI')
  const query = `TS=("${escapeWosQuery(request.query)}")`
  const data = await context.http.requestJson<Record<string, unknown>>(
    'wos',
    {
      url: appendQuery(endpoint, {
        db: 'WOS',
        edition: editions,
        q: query,
        limit: clampLimit(request.limit, 10, 50),
        page: cursorToPage(request.cursor),
        sortField: 'RS+D',
      }),
      headers: { 'X-ApiKey': apiKey },
    },
    signal,
  )
  const records = collectRecords(data).map((record) =>
    evidence('wos', {
      title: readText(record, ['title', 'source.title', 'document.title']),
      url:
        readText(record, ['links.record', 'url']) ||
        wosRecordUrl(readText(record, ['uid', 'UT', 'id'])),
      publishedAt: readText(record, [
        'source.publishYear',
        'publishYear',
        'year',
      ]),
      authors: readStringList(record, ['names.authors', 'authors', 'author']),
      publicationName: readText(record, [
        'source.sourceTitle',
        'sourceTitle',
        'journal',
      ]),
      snippet: readText(record, ['abstract', 'keywords.authorKeywords']),
      wosUid: readText(record, ['uid', 'UT', 'id']),
      indexCoverage: editions.split(',').map((value) => value.trim()),
      caveats: [
        `Index coverage requested: ${editions}. Verify the returned edition metadata before claiming SSCI coverage.`,
      ],
    }),
  )
  return result(records, data)
}

async function searchCrossref(
  request: ResearchSearchRequest,
  context: ResearchAdapterContext,
  signal?: AbortSignal,
): Promise<ResearchSearchResult> {
  const source = getResearchSource('crossref')
  const endpoint = requireEndpoint('crossref')
  const doi = extractDoi(request.query)
  const mailto = readOption(context.settings, 'mailto')
  const data = await context.http.requestJson<Record<string, unknown>>(
    'crossref',
    {
      url: doi
        ? appendQuery(`${endpoint}/${encodeURIComponent(doi)}`, {
            mailto,
          })
        : appendQuery(endpoint, {
            'query.bibliographic': request.query,
            rows: clampLimit(request.limit, 10, 50),
            mailto,
          }),
      headers: {
        'User-Agent': `SmartComposer-Achmage/2.5 (mailto:${mailto || 'not-provided'})`,
      },
    },
    signal,
  )
  const message = asRecord(data.message) ?? {}
  const items = Array.isArray(message.items)
    ? message.items.map(asRecord).filter(isRecord)
    : [message]
  const records = items.map((item) => {
    const itemDoi = readText(item, ['DOI', 'doi'])
    const relation = asRecord(item.relation)
    const relationKeys = relation ? Object.keys(relation) : []
    const updateType = readText(item, ['update-to.0.type', 'type'])
    const isRetraction =
      updateType.toLocaleLowerCase().includes('retract') ||
      relationKeys.some((key) => key.toLocaleLowerCase().includes('retract'))
    const isCorrection =
      updateType.toLocaleLowerCase().includes('correct') ||
      relationKeys.some((key) => key.toLocaleLowerCase().includes('update'))
    return evidence('crossref', {
      title: readText(item, ['title.0', 'title', 'short-title.0']),
      url:
        readText(item, ['URL', 'resource.primary.URL']) ||
        (itemDoi ? `https://doi.org/${itemDoi}` : source.docsUrl),
      publishedAt: readDateParts(item),
      authors: formatCrossrefAuthors(item.author),
      publicationName: readText(item, ['container-title.0', 'publisher']),
      snippet: readText(item, ['abstract', 'subtitle.0']),
      doi: itemDoi,
      editorialStatus: isRetraction
        ? 'retracted'
        : isCorrection
          ? 'corrected'
          : relationKeys.length > 0
            ? 'unknown'
            : 'current',
      caveats:
        relationKeys.length > 0
          ? [`Crossref relation metadata: ${relationKeys.join(', ')}`]
          : [],
    })
  })
  return result(records, data)
}

async function searchOpenAlex(
  request: ResearchSearchRequest,
  context: ResearchAdapterContext,
  signal?: AbortSignal,
): Promise<ResearchSearchResult> {
  const endpoint = requireEndpoint('openalex')
  const apiKey = requireSecret(
    context,
    'openalex',
    'api-key',
    'OpenAlex API key',
  )
  const data = await context.http.requestJson<Record<string, unknown>>(
    'openalex',
    {
      url: appendQuery(endpoint, {
        search: request.query,
        'per-page': clampLimit(request.limit, 10, 50),
        cursor: request.cursor?.trim() ? request.cursor : '*',
        api_key: apiKey,
      }),
    },
    signal,
  )
  const items = readRecordArray(data, 'results')
  const records = items.map((item) => {
    const doi = normalizeDoi(readText(item, ['doi']))
    const openAccess = asRecord(item.open_access)
    const primary = asRecord(item.primary_location)
    const sourceRecord = primary ? asRecord(primary.source) : null
    return evidence('openalex', {
      title: readText(item, ['display_name', 'title']),
      url:
        readText(primary ?? {}, ['landing_page_url', 'pdf_url']) ||
        (doi ? `https://doi.org/${doi}` : readText(item, ['id'])),
      publishedAt: readText(item, ['publication_date', 'publication_year']),
      authors: readRecordArray(item, 'authorships').map((authorship) =>
        readText(asRecord(authorship.author) ?? {}, ['display_name']),
      ),
      publicationName: readText(sourceRecord ?? {}, ['display_name']),
      snippet: reconstructOpenAlexAbstract(item.abstract_inverted_index),
      doi,
      sourceId: readText(item, ['id']),
      citationCount: readNumber(item, ['cited_by_count']),
      isOpenAccess: Boolean(openAccess?.is_oa),
      caveats: [
        'OpenAlex is a discovery and enrichment graph, not a subscription index entitlement check.',
      ],
    })
  })
  return {
    ...result(records, data),
    nextCursor:
      readText(asRecord(data.meta) ?? {}, ['next_cursor']) || undefined,
  }
}

async function searchKci(
  request: ResearchSearchRequest,
  context: ResearchAdapterContext,
  signal?: AbortSignal,
): Promise<ResearchSearchResult> {
  const source = getResearchSource('kci')
  const endpoint = requireEndpoint('kci')
  const key = requireSecret(context, 'kci', 'api-key', 'KCI API key')
  const response = await context.http.request(
    'kci',
    {
      url: appendQuery(endpoint, {
        apiCode: 'articleSearch',
        key,
        title: request.query,
        displayCount: clampLimit(request.limit, 10, 100),
      }),
    },
    signal,
  )
  return parseXmlSearchResult('kci', response.text, (node) => {
    const articleId = xmlText(node, [
      'article-id',
      'articleId',
      'arti_id',
      'id',
    ])
    const doi = normalizeDoi(xmlText(node, ['doi', 'DOI']))
    return evidence('kci', {
      title: xmlText(node, ['article-title', 'title', 'articleTitle']),
      url:
        xmlText(node, ['url', 'link']) ||
        (doi
          ? `https://doi.org/${doi}`
          : articleId
            ? `https://www.kci.go.kr/kciportal/landing/article.kci?arti_id=${encodeURIComponent(articleId)}`
            : source.docsUrl),
      publishedAt: xmlText(node, [
        'pub-year',
        'pubYear',
        'publication-year',
        'year',
      ]),
      authors: xmlTexts(node, ['author-name', 'authorName', 'author']),
      publicationName: xmlText(node, [
        'journal-name',
        'journalName',
        'journal',
      ]),
      snippet: xmlText(node, ['abstract', 'abstract-text', 'summary']),
      doi,
      kciId: articleId,
      indexCoverage: ['KCI'],
    })
  })
}

async function searchConfigurableSource(
  sourceId: 'scienceon' | 'ntis',
  request: ResearchSearchRequest,
  context: ResearchAdapterContext,
  signal?: AbortSignal,
): Promise<ResearchSearchResult> {
  const endpoint = readOption(context.settings, 'endpoint')
  if (!endpoint) {
    throw new Error(
      `${getResearchSource(sourceId).name} needs the approved request URL from its provider console.`,
    )
  }
  const apiKey = requireSecret(
    context,
    sourceId,
    'api-key',
    `${getResearchSource(sourceId).name} API key`,
  )
  const queryParam = readOption(context.settings, 'query-param', 'query')
  const keyParam = readOption(context.settings, 'key-param', 'key')
  const response = await context.http.request(
    sourceId,
    {
      url: appendQuery(endpoint, {
        [queryParam]: request.query,
        [keyParam]: apiKey,
        displayCount: clampLimit(request.limit, 10, 50),
      }),
    },
    signal,
  )
  if (looksLikeJson(response.text)) {
    const data = JSON.parse(response.text) as Record<string, unknown>
    return result(
      collectRecords(data).map((record) => genericEvidence(sourceId, record)),
      data,
    )
  }
  return parseXmlSearchResult(sourceId, response.text, (node) =>
    evidence(sourceId, {
      title: xmlText(node, ['title', 'projectNm', 'articleTitle', 'name']),
      url:
        xmlText(node, ['url', 'link', 'detailUrl']) ||
        getResearchSource(sourceId).docsUrl,
      publishedAt: xmlText(node, ['date', 'year', 'pubYear', 'startDate']),
      authors: xmlTexts(node, ['author', 'researcher', 'managerName']),
      publicationName: xmlText(node, ['journal', 'institution', 'agency']),
      snippet: xmlText(node, ['abstract', 'summary', 'description']),
      sourceId: xmlText(node, ['id', 'projectId', 'articleId']),
    }),
  )
}

async function searchRiss(
  request: ResearchSearchRequest,
  context: ResearchAdapterContext,
  signal?: AbortSignal,
): Promise<ResearchSearchResult> {
  const endpoint = requireEndpoint('riss')
  const searchTerms = rissSearchTerms(request.query)
  if (searchTerms.length === 0) {
    throw new Error('RISS search requires at least one letter or number.')
  }
  const filter = searchTerms
    .map((term) => `regex(?title, "${rissRegex(term)}")`)
    .join(' || ')
  const requestedLimit = clampLimit(request.limit, 10, 20)

  // RISS runs an older SPARQL implementation. SPARQL 1.1 CONTAINS/LCASE and
  // regex flags silently return an empty result, so keep this query 1.0-safe.
  const sparql = `
SELECT ?work ?title ?creator ?published ?locator WHERE {
  ?work <http://purl.org/dc/elements/1.1/title> ?title .
  ?work <http://schema.org/author> ?creator .
  ?work <http://purl.org/dc/terms/date> ?published .
  ?work <http://purl.org/ontology/bibo/locator> ?locator .
  FILTER (${filter}) .
}
LIMIT ${Math.min(40, requestedLimit * 2)}`.trim()
  const response = await context.http.request(
    'riss',
    {
      url: appendQuery(endpoint, {
        query: sparql,
        type: 'Xml',
        flag: 'none',
      }),
    },
    signal,
  )
  return parseRissSparqlResult(response.text, requestedLimit)
}

function parseRissSparqlResult(
  xml: string,
  limit: number,
): ResearchSearchResult {
  if (/조회\s*결과가\s*없습니다/u.test(xml)) {
    return { records: [], warnings: [] }
  }
  const document = new DOMParser().parseFromString(xml, 'application/xml')
  if (document.getElementsByTagName('parsererror').length > 0) {
    throw new Error('RISS returned invalid SPARQL XML.')
  }

  const merged = new Map<
    string,
    {
      work: string
      title: string
      locator: string
      publishedAt: string
      authors: Set<string>
    }
  >()
  for (const node of Array.from(document.getElementsByTagName('result'))) {
    const work = readRissBinding(node, 'work')
    const title = readRissBinding(node, 'title')
    if (!title) continue
    const key = work || `${title}\u0000${readRissBinding(node, 'published')}`
    const existing = merged.get(key) ?? {
      work,
      title,
      locator: readRissBinding(node, 'locator'),
      publishedAt: readRissBinding(node, 'published'),
      authors: new Set<string>(),
    }
    splitNames(readRissBinding(node, 'creator')).forEach((author) =>
      existing.authors.add(author),
    )
    merged.set(key, existing)
  }

  return {
    records: Array.from(merged.values())
      .slice(0, limit)
      .map((entry) =>
        evidence('riss', {
          title: entry.title,
          url: normalizeRissUrl(entry.locator || entry.work),
          authors: Array.from(entry.authors),
          publishedAt: entry.publishedAt,
          sourceId: entry.work,
          caveats: [
            'RISS Linked Data results are discovery metadata; verify access and bibliographic details on the RISS record page.',
          ],
        }),
      ),
    warnings: [],
  }
}

function readRissBinding(node: Element, key: string): string {
  const normalizedKey = key.toUpperCase()
  const binding = Array.from(node.getElementsByTagName('binding')).find(
    (candidate) =>
      candidate.getAttribute('name')?.toUpperCase() === normalizedKey,
  )
  return binding?.textContent?.trim() ?? ''
}

function rissSearchTerms(query: string): string[] {
  const tokens: string[] = Array.from(
    query.normalize('NFKC').match(/[\p{L}\p{N}]+/gu) ?? [],
  )
  const stopWords = new Set([
    '관련',
    '논문',
    '연구',
    '자료',
    '검색',
    '찾아줘',
    '대한',
    '관한',
    '국내',
    '학술',
  ])
  const eligible = tokens.filter((token) => token.length >= 2)
  const meaningful = eligible.filter(
    (token) =>
      !stopWords.has(token) &&
      !/^(?:and|or|the|paper|papers|research)$/i.test(token),
  )
  return Array.from(
    new Set(meaningful.length > 0 ? meaningful : eligible),
  ).slice(0, 6)
}

function rissRegex(term: string): string {
  let pattern = ''
  for (const character of term) {
    if (/[a-z]/i.test(character)) {
      pattern += `[${character.toLowerCase()}${character.toUpperCase()}]`
    } else if (/[\\^$.*+?()[\]{}|]/.test(character)) {
      pattern += `\\${character}`
    } else {
      pattern += character
    }
  }
  return escapeSparqlString(pattern)
}

function normalizeRissUrl(value: string): string {
  return value.replace(/^http:\/\/www\.riss\.kr\//i, 'https://www.riss.kr/')
}

async function searchOpenDart(
  request: ResearchSearchRequest,
  context: ResearchAdapterContext,
  signal?: AbortSignal,
): Promise<ResearchSearchResult> {
  const source = getResearchSource('opendart')
  const endpoint = requireEndpoint('opendart')
  const apiKey = requireSecret(
    context,
    'opendart',
    'api-key',
    'OpenDART API key',
  )
  const corpCode = /^\d{8}$/.test(request.query.trim())
    ? request.query.trim()
    : undefined
  const data = await context.http.requestJson<Record<string, unknown>>(
    'opendart',
    {
      url: appendQuery(endpoint, {
        crtfc_key: apiKey,
        corp_code: corpCode,
        bgn_de: dateDaysAgo(365),
        end_de: compactDate(new Date()),
        page_count: Math.max(20, clampLimit(request.limit, 20, 100)),
      }),
    },
    signal,
  )
  const status = readText(data, ['status'])
  if (status && status !== '000') {
    throw new Error(
      `OpenDART returned ${status}: ${readText(data, ['message']) || 'request failed'}`,
    )
  }
  const normalizedQuery = request.query.trim().toLocaleLowerCase()
  const items = readRecordArray(data, 'list').filter((item) => {
    if (corpCode) return true
    return [readText(item, ['corp_name']), readText(item, ['report_nm'])]
      .join(' ')
      .toLocaleLowerCase()
      .includes(normalizedQuery)
  })
  return result(
    items.slice(0, clampLimit(request.limit, 10, 50)).map((item) => {
      const receipt = readText(item, ['rcept_no'])
      return evidence('opendart', {
        title: [readText(item, ['corp_name']), readText(item, ['report_nm'])]
          .filter(Boolean)
          .join(' - '),
        url: receipt
          ? `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${encodeURIComponent(receipt)}`
          : source.docsUrl,
        publishedAt: readText(item, ['rcept_dt']),
        publicationName: readText(item, ['flr_nm']),
        sourceId: receipt,
        caveats: ['Official filing metadata from OpenDART.'],
      })
    }),
    data,
  )
}

async function searchNaver(
  request: ResearchSearchRequest,
  context: ResearchAdapterContext,
  signal?: AbortSignal,
): Promise<ResearchSearchResult> {
  const source = getResearchSource('naver')
  const keyId = requireSecret(context, 'naver', 'key-id', 'NAVER API key ID')
  const apiKey = requireSecret(context, 'naver', 'api-key', 'NAVER API key')
  const credentialService = readOption(
    context.settings,
    'credential-service',
    'auto',
  )
  const requestedVertical =
    typeof request.filters?.vertical === 'string'
      ? request.filters.vertical
      : readOption(context.settings, 'vertical', 'news')
  const vertical = ['news', 'webkr', 'blog'].includes(requestedVertical)
    ? requestedVertical
    : 'news'
  const services: NaverCredentialService[] =
    credentialService === 'legacy-developers'
      ? ['legacy-developers']
      : credentialService === 'api-hub'
        ? ['api-hub']
        : ['api-hub', 'legacy-developers']
  let selectedService: NaverCredentialService | null = null
  let data: Record<string, unknown> | null = null
  let apiHubAuthenticationError: unknown

  for (const service of services) {
    try {
      data = await requestNaver(
        service,
        request,
        vertical,
        keyId,
        apiKey,
        context,
        signal,
      )
      selectedService = service
      break
    } catch (error) {
      if (
        service === 'api-hub' &&
        credentialService === 'auto' &&
        isNaverAuthenticationError(error)
      ) {
        apiHubAuthenticationError = error
        continue
      }
      if (
        service === 'legacy-developers' &&
        credentialService === 'auto' &&
        apiHubAuthenticationError &&
        isNaverAuthenticationError(error)
      ) {
        throw decorateNaverAutoDetectionError()
      }
      throw decorateNaverConnectionError(service, error)
    }
  }

  if (!data || !selectedService) {
    throw decorateNaverAutoDetectionError()
  }

  const searchResult = result(
    readRecordArray(data, 'items').map((item) =>
      evidence('naver', {
        title: plainText(readText(item, ['title'])),
        url: readText(item, ['originallink', 'link']) || source.docsUrl,
        publishedAt: readText(item, ['pubDate', 'postdate']),
        snippet: plainText(readText(item, ['description'])),
        sourceId: readText(item, ['link']),
        caveats: [
          `NAVER ${vertical} results are discovery snippets, not full article verification.`,
        ],
      }),
    ),
    data,
  )
  if (selectedService === 'legacy-developers') {
    searchResult.warnings.push(
      'Connected through the legacy NAVER Developers Search API. Existing applications are supported only until 2027-06-30; migrate these credentials to NAVER API HUB.',
    )
  }
  return searchResult
}

type NaverCredentialService = 'api-hub' | 'legacy-developers'

async function requestNaver(
  service: NaverCredentialService,
  request: ResearchSearchRequest,
  vertical: string,
  keyId: string,
  apiKey: string,
  context: ResearchAdapterContext,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const apiHub = service === 'api-hub'
  const endpoint = apiHub
    ? requireEndpoint('naver')
    : 'https://openapi.naver.com/v1/search'
  return context.http.requestJson<Record<string, unknown>>(
    'naver',
    {
      url: appendQuery(`${endpoint}/${vertical}${apiHub ? '' : '.json'}`, {
        query: request.query,
        display: clampLimit(request.limit, 10, 100),
        start: cursorToOffset(request.cursor),
        sort: vertical === 'news' ? 'date' : 'sim',
        ...(apiHub ? { format: 'json' } : {}),
      }),
      headers: apiHub
        ? {
            'X-NCP-APIGW-API-KEY-ID': keyId,
            'X-NCP-APIGW-API-KEY': apiKey,
          }
        : {
            'X-Naver-Client-Id': keyId,
            'X-Naver-Client-Secret': apiKey,
          },
    },
    signal,
  )
}

function isNaverAuthenticationError(error: unknown): boolean {
  const message = toErrorText(error)
  return (
    /authentication (?:failed|or entitlement was rejected)/i.test(message) ||
    /"errorCode"\s*:\s*"(?:200|024|025)"/i.test(message)
  )
}

function decorateNaverConnectionError(
  service: NaverCredentialService,
  error: unknown,
): Error {
  if (!isNaverAuthenticationError(error)) {
    return error instanceof Error ? error : new Error(toErrorText(error))
  }
  return new Error(
    service === 'api-hub'
      ? 'NAVER API HUB authentication failed. Provider errorCode 200 means authentication failure, not HTTP success. Use the Client ID and Client Secret issued in NAVER Cloud Platform > NAVER API HUB; legacy Developers Center keys are not interchangeable.'
      : 'NAVER Developers authentication failed. Confirm the Client ID and Client Secret belong to an existing Search API application in developers.naver.com.',
  )
}

function decorateNaverAutoDetectionError(): Error {
  return new Error(
    'NAVER credentials were rejected by both API HUB and the legacy Developers API. Confirm that Client ID and Client Secret were copied as one matching pair.',
  )
}

function toErrorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function searchPubMed(
  request: ResearchSearchRequest,
  context: ResearchAdapterContext,
  signal?: AbortSignal,
): Promise<ResearchSearchResult> {
  const endpoint = requireEndpoint('pubmed')
  const apiKey = context.secrets.get('pubmed', 'api-key') ?? undefined
  const email = readOption(context.settings, 'email')
  const search = await context.http.requestJson<Record<string, unknown>>(
    'pubmed',
    {
      url: appendQuery(endpoint, {
        db: 'pubmed',
        term: request.query,
        retmode: 'json',
        retmax: clampLimit(request.limit, 10, 50),
        api_key: apiKey,
        email,
        tool: 'smart-composer-achmage',
      }),
    },
    signal,
  )
  const ids = readStringList(asRecord(search.esearchresult) ?? {}, ['idlist'])
  if (ids.length === 0) return result([], search)
  const summary = await context.http.requestJson<Record<string, unknown>>(
    'pubmed',
    {
      url: appendQuery(
        'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi',
        {
          db: 'pubmed',
          id: ids.join(','),
          retmode: 'json',
          api_key: apiKey,
          email,
          tool: 'smart-composer-achmage',
        },
      ),
    },
    signal,
  )
  const summaryResult = asRecord(summary.result) ?? {}
  const records = ids.flatMap((id) => {
    const item = asRecord(summaryResult[id])
    if (!item) return []
    const doi = findArticleId(item, 'doi')
    return [
      evidence('pubmed', {
        title: readText(item, ['title']),
        url: `https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(id)}/`,
        publishedAt: readText(item, ['pubdate', 'sortpubdate']),
        authors: readRecordArray(item, 'authors').map((author) =>
          readText(author, ['name']),
        ),
        publicationName: readText(item, ['fulljournalname', 'source']),
        doi,
        pmid: id,
        indexCoverage: ['PubMed'],
      }),
    ]
  })
  return result(records, summary)
}

async function searchEuropePmc(
  request: ResearchSearchRequest,
  context: ResearchAdapterContext,
  signal?: AbortSignal,
): Promise<ResearchSearchResult> {
  const source = getResearchSource('europe-pmc')
  const endpoint = requireEndpoint('europe-pmc')
  const data = await context.http.requestJson<Record<string, unknown>>(
    'europe-pmc',
    {
      url: appendQuery(endpoint, {
        query: request.query,
        format: 'json',
        pageSize: clampLimit(request.limit, 10, 50),
        cursorMark: request.cursor,
      }),
    },
    signal,
  )
  const resultList = asRecord(data.resultList) ?? {}
  const records = readRecordArray(resultList, 'result').map((item) => {
    const pmid = readText(item, ['pmid'])
    const doi = normalizeDoi(readText(item, ['doi']))
    return evidence('europe-pmc', {
      title: readText(item, ['title']),
      url: pmid
        ? `https://europepmc.org/article/MED/${encodeURIComponent(pmid)}`
        : doi
          ? `https://doi.org/${doi}`
          : source.docsUrl,
      publishedAt: readText(item, [
        'firstPublicationDate',
        'journalInfo.printPublicationDate',
        'pubYear',
      ]),
      authors: splitNames(readText(item, ['authorString'])),
      publicationName: readText(item, ['journalTitle']),
      snippet: readText(item, ['abstractText']),
      doi,
      pmid,
      citationCount: readNumber(item, ['citedByCount']),
      isOpenAccess: readText(item, ['isOpenAccess']) === 'Y',
      caveats: [
        'Europe PMC coverage is strongest for life sciences and biomedical literature.',
      ],
    })
  })
  return {
    ...result(records, data),
    nextCursor: readText(data, ['nextCursorMark']) || undefined,
  }
}

function genericEvidence(
  sourceId: ResearchSourceId,
  record: Record<string, unknown>,
): ResearchEvidence {
  return evidence(sourceId, {
    title: readText(record, ['title', 'name', 'articleTitle', 'projectName']),
    url:
      readText(record, ['url', 'link', 'detailUrl']) ||
      getResearchSource(sourceId).docsUrl,
    publishedAt: readText(record, ['date', 'publishedAt', 'year', 'pubYear']),
    authors: readStringList(record, ['authors', 'author', 'researchers']),
    publicationName: readText(record, ['journal', 'institution', 'publisher']),
    snippet: readText(record, ['abstract', 'summary', 'description']),
    sourceId: readText(record, ['id', 'uid', 'projectId']),
  })
}

function evidence(
  sourceId: ResearchSourceId,
  input: {
    title?: string
    url?: string
    publishedAt?: string
    authors?: string[]
    publicationName?: string
    snippet?: string
    doi?: string
    pmid?: string
    wosUid?: string
    kciId?: string
    sourceId?: string
    citationCount?: number
    isOpenAccess?: boolean
    editorialStatus?: ResearchEvidence['editorialStatus']
    indexCoverage?: string[]
    caveats?: string[]
  },
): ResearchEvidence {
  const source = getResearchSource(sourceId)
  return {
    sourceId,
    sourceName: source.name,
    operator: source.operator,
    role: source.role,
    title: input.title?.trim() || 'Untitled result',
    url: input.url?.trim() || source.docsUrl,
    publishedAt: input.publishedAt || undefined,
    retrievedAt: new Date().toISOString(),
    identifiers: {
      doi: input.doi || undefined,
      pmid: input.pmid || undefined,
      wosUid: input.wosUid || undefined,
      kciId: input.kciId || undefined,
      sourceId: input.sourceId || undefined,
    },
    snippet: input.snippet
      ? plainText(input.snippet).slice(0, 1200)
      : undefined,
    authors: input.authors?.filter(Boolean).slice(0, 30),
    publicationName: input.publicationName || undefined,
    citationCount: input.citationCount,
    isOpenAccess: input.isOpenAccess,
    editorialStatus: input.editorialStatus,
    indexCoverage: input.indexCoverage,
    caveats: input.caveats?.filter(Boolean),
  }
}

function result(
  records: ResearchEvidence[],
  raw?: Record<string, unknown>,
): ResearchSearchResult {
  const warnings: string[] = []
  const message = raw ? readText(raw, ['message', 'warning']) : ''
  if (message) warnings.push(message)
  return { records: records.filter((record) => record.title), warnings }
}

function parseXmlSearchResult(
  sourceId: ResearchSourceId,
  xml: string,
  map: (node: Element) => ResearchEvidence,
): ResearchSearchResult {
  const document = new DOMParser().parseFromString(xml, 'application/xml')
  if (document.querySelector('parsererror')) {
    throw new Error(`${sourceId} returned invalid XML.`)
  }
  const nodes = firstNonEmptyNodeList(document, [
    'record',
    'item',
    'articleInfo',
    'result',
    'document',
  ])
  return {
    records: nodes.map(map),
    warnings: xmlText(document.documentElement, ['message', 'error'])
      ? [xmlText(document.documentElement, ['message', 'error'])]
      : [],
  }
}

function firstNonEmptyNodeList(
  root: ParentNode,
  selectors: string[],
): Element[] {
  for (const selector of selectors) {
    const nodes = Array.from(root.querySelectorAll(selector))
    if (nodes.length > 0) return nodes
  }
  return []
}

function collectRecords(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    const records = value.map(asRecord).filter(isRecord)
    if (records.length > 0) return records
  }
  const record = asRecord(value)
  if (!record) return []
  for (const key of [
    'hits',
    'documents',
    'records',
    'results',
    'items',
    'data',
  ]) {
    const nested = record[key]
    if (Array.isArray(nested)) {
      const records = nested.map(asRecord).filter(isRecord)
      if (records.length > 0) return records
    }
    const nestedRecord = asRecord(nested)
    if (nestedRecord) {
      const records = collectRecords(nestedRecord)
      if (records.length > 0) return records
    }
  }
  return []
}

function readOption(
  settings: ResearchSourceSettings,
  key: string,
  fallback = '',
): string {
  const value = settings.options[key]
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function requireEndpoint(sourceId: ResearchSourceId): string {
  const endpoint = getResearchSource(sourceId).endpoint
  if (!endpoint) {
    throw new Error(`${getResearchSource(sourceId).name} has no endpoint.`)
  }
  return endpoint
}

function requireSecret(
  context: ResearchAdapterContext,
  sourceId: ResearchSourceId,
  fieldId: string,
  label: string,
): string {
  const value = context.secrets.get(sourceId, fieldId)
  if (!value) throw new Error(`${label} is not configured.`)
  return value
}

function readRecordArray(
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown>[] {
  const array = value[key]
  return Array.isArray(array) ? array.map(asRecord).filter(isRecord) : []
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function isRecord(
  value: Record<string, unknown> | null,
): value is Record<string, unknown> {
  return value !== null
}

function getPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (Array.isArray(current)) {
      const index = Number(segment)
      return Number.isInteger(index) ? current[index] : undefined
    }
    const record = asRecord(current)
    return record?.[segment]
  }, value)
}

function readText(value: unknown, paths: string[]): string {
  for (const path of paths) {
    const candidate = getPath(value, path)
    if (typeof candidate === 'string' || typeof candidate === 'number') {
      const text = String(candidate).trim()
      if (text) return text
    }
    if (Array.isArray(candidate)) {
      const text = candidate
        .filter(
          (item): item is string | number =>
            typeof item === 'string' || typeof item === 'number',
        )
        .join('; ')
        .trim()
      if (text) return text
    }
  }
  return ''
}

function readNumber(value: unknown, paths: string[]): number | undefined {
  const text = readText(value, paths)
  if (!text) return undefined
  const parsed = Number(text)
  return Number.isFinite(parsed) ? parsed : undefined
}

function readStringList(value: unknown, paths: string[]): string[] {
  for (const path of paths) {
    const candidate = getPath(value, path)
    if (Array.isArray(candidate)) {
      return candidate.flatMap((item) => {
        if (typeof item === 'string') return [item]
        const record = asRecord(item)
        return record
          ? [readText(record, ['display_name', 'name', 'full_name'])].filter(
              Boolean,
            )
          : []
      })
    }
    if (typeof candidate === 'string') return splitNames(candidate)
  }
  return []
}

function xmlText(node: ParentNode, selectors: string[]): string {
  for (const selector of selectors) {
    const value = node.querySelector(selector)?.textContent?.trim()
    if (value) return value
  }
  return ''
}

function xmlTexts(node: ParentNode, selectors: string[]): string[] {
  for (const selector of selectors) {
    const values = Array.from(node.querySelectorAll(selector))
      .map((entry) => entry.textContent?.trim() ?? '')
      .filter(Boolean)
    if (values.length > 0) return values
  }
  return []
}

function plainText(value: string): string {
  if (!value) return ''
  try {
    const document = new DOMParser().parseFromString(value, 'text/html')
    return (document.body.textContent ?? '').replace(/\s+/g, ' ').trim()
  } catch {
    return value.replace(/\s+/g, ' ').trim()
  }
}

function looksLikeJson(value: string): boolean {
  const trimmed = value.trim()
  return trimmed.startsWith('{') || trimmed.startsWith('[')
}

function clampLimit(
  value: number | undefined,
  fallback: number,
  maximum: number,
): number {
  if (!value || !Number.isFinite(value)) return fallback
  return Math.max(1, Math.min(maximum, Math.floor(value)))
}

function cursorToPage(cursor?: string): number {
  const value = Number(cursor)
  return Number.isInteger(value) && value > 0 ? value : 1
}

function cursorToOffset(cursor?: string): number {
  const value = Number(cursor)
  return Number.isInteger(value) && value > 0 ? value : 1
}

function escapeWosQuery(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').slice(0, 500)
}

function escapeSparqlString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, ' ')
    .slice(0, 500)
}

function normalizeDoi(value: string): string {
  return value
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .trim()
}

function extractDoi(value: string): string | null {
  const normalized = normalizeDoi(value)
  const match = normalized.match(/\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b/i)
  return match?.[0] ?? null
}

function wosRecordUrl(uid: string): string {
  return uid
    ? `https://www.webofscience.com/wos/woscc/full-record/${encodeURIComponent(uid)}`
    : getResearchSource('wos').docsUrl
}

function splitNames(value: string): string[] {
  return value
    .split(/\s*(?:;|\band\b)\s*/i)
    .map((item) => item.trim())
    .filter(Boolean)
}

function formatCrossrefAuthors(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    const author = asRecord(entry)
    if (!author) return []
    const name = [
      readText(author, ['given']),
      readText(author, ['family', 'name']),
    ]
      .filter(Boolean)
      .join(' ')
    return name ? [name] : []
  })
}

function readDateParts(item: Record<string, unknown>): string | undefined {
  for (const path of [
    'published-print.date-parts.0',
    'published-online.date-parts.0',
    'issued.date-parts.0',
  ]) {
    const parts = getPath(item, path)
    if (Array.isArray(parts)) {
      return parts
        .filter(
          (part): part is string | number =>
            typeof part === 'string' || typeof part === 'number',
        )
        .join('-')
    }
  }
  return undefined
}

function reconstructOpenAlexAbstract(value: unknown): string {
  const index = asRecord(value)
  if (!index) return ''
  const positioned: { word: string; position: number }[] = []
  for (const [word, positions] of Object.entries(index)) {
    if (!Array.isArray(positions)) continue
    for (const position of positions) {
      if (typeof position === 'number') positioned.push({ word, position })
    }
  }
  return positioned
    .sort((a, b) => a.position - b.position)
    .map((item) => item.word)
    .join(' ')
    .slice(0, 4000)
}

function findArticleId(item: Record<string, unknown>, type: string): string {
  return (
    (readRecordArray(item, 'articleids').find(
      (entry) => readText(entry, ['idtype']) === type,
    )?.value as string | undefined) ?? ''
  )
}

function compactDate(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('')
}

function dateDaysAgo(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return compactDate(date)
}
