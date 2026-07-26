import type {
  ResearchAutoPolicy,
  ResearchPackId,
  ResearchSourceId,
  ResearchSourceRole,
} from '../../types/research.types'

export type ResearchProtocol = 'native' | 'mcp'
export type ResearchSecretField = {
  id: string
  label: string
  required: boolean
  placeholder?: string
}
export type ResearchOptionField = {
  id: string
  label: string
  required: boolean
  placeholder?: string
  defaultValue?: string
}
export type ResearchSourceDefinition = {
  id: ResearchSourceId
  name: string
  shortName: string
  operator: string
  role: ResearchSourceRole
  protocol: ResearchProtocol
  description: string
  docsUrl: string
  endpoint?: string
  lastVerifiedAt: string
  freeBoundary: string
  defaultAutoPolicy: ResearchAutoPolicy
  desktopOnly?: boolean
  thirdPartyOperator?: boolean
  secretFields: ResearchSecretField[]
  optionFields: ResearchOptionField[]
  mcpPreset?: {
    connectionId: string
    url: string
    legacySse: boolean
    secretQueryParam?: {
      name: string
      secretFieldId: string
    }
  }
}

export type ResearchPackDefinition = {
  id: ResearchPackId
  name: string
  description: string
  sourceIds: ResearchSourceId[]
}

export const RESEARCH_SOURCES: Record<
  ResearchSourceId,
  ResearchSourceDefinition
> = {
  'korean-law': {
    id: 'korean-law',
    name: 'Korean Law MCP',
    shortName: 'Korean Law',
    operator: 'Third-party MCP over official Korean legal data',
    role: 'official',
    protocol: 'mcp',
    description:
      'Retrieve Korean statutes and provisions with a visible third-party operator boundary.',
    docsUrl: 'https://mcp.gomdori.app/',
    lastVerifiedAt: '2026-07-27',
    freeBoundary: 'Provider-specific access',
    defaultAutoPolicy: 'explicit-only',
    desktopOnly: true,
    thirdPartyOperator: true,
    secretFields: [
      {
        id: 'oc',
        label: 'OC credential',
        required: true,
        placeholder: 'Stored only in Obsidian SecretStorage',
      },
    ],
    optionFields: [],
    mcpPreset: {
      connectionId: 'research-korean-law',
      url: 'https://mcp.gomdori.app/law',
      legacySse: false,
      secretQueryParam: { name: 'oc', secretFieldId: 'oc' },
    },
  },
  wos: {
    id: 'wos',
    name: 'Web of Science Starter',
    shortName: 'WoS',
    operator: 'Clarivate',
    role: 'index',
    protocol: 'native',
    description:
      'Search Web of Science Core Collection editions, including SSCI.',
    docsUrl: 'https://developer.clarivate.com/apis/wos-starter',
    endpoint: 'https://api.clarivate.com/apis/wos-starter/v1/documents',
    lastVerifiedAt: '2026-07-27',
    freeBoundary: 'Free Trial: 50 requests/day, 1 request/second',
    defaultAutoPolicy: 'explicit-only',
    secretFields: [{ id: 'api-key', label: 'API key', required: true }],
    optionFields: [
      {
        id: 'editions',
        label: 'Default editions',
        required: true,
        defaultValue: 'WOS+SSCI',
        placeholder: 'WOS+SSCI, WOS+SCI, WOS+AHCI, WOS+ESCI',
      },
    ],
  },
  crossref: {
    id: 'crossref',
    name: 'Crossref + Retraction Watch',
    shortName: 'Crossref',
    operator: 'Crossref',
    role: 'verify',
    protocol: 'native',
    description:
      'Verify DOI metadata, corrections, retractions, and editorial updates.',
    docsUrl:
      'https://www.crossref.org/documentation/retrieve-metadata/retraction-watch/',
    endpoint: 'https://api.crossref.org/works',
    lastVerifiedAt: '2026-07-27',
    freeBoundary: 'Public REST; polite pool available',
    defaultAutoPolicy: 'allow',
    secretFields: [],
    optionFields: [
      {
        id: 'mailto',
        label: 'Contact email for polite pool',
        required: false,
        placeholder: 'name@example.com',
      },
    ],
  },
  openalex: {
    id: 'openalex',
    name: 'OpenAlex',
    shortName: 'OpenAlex',
    operator: 'OurResearch',
    role: 'discover',
    protocol: 'native',
    description:
      'Discover papers, authors, institutions, citation links, and open-access locations.',
    docsUrl: 'https://developers.openalex.org/guides/authentication',
    endpoint: 'https://api.openalex.org/works',
    lastVerifiedAt: '2026-07-27',
    freeBoundary: 'Free API key with a daily free usage budget',
    defaultAutoPolicy: 'allow',
    secretFields: [{ id: 'api-key', label: 'API key', required: true }],
    optionFields: [],
  },
  kci: {
    id: 'kci',
    name: 'KCI',
    shortName: 'KCI',
    operator: 'National Research Foundation of Korea',
    role: 'index',
    protocol: 'native',
    description: 'Search Korean Citation Index article metadata.',
    docsUrl: 'https://www.kci.go.kr/kciportal/po/openapi/openApiList.kci',
    endpoint: 'https://open.kci.go.kr/po/openapi/openApiSearch.kci',
    lastVerifiedAt: '2026-07-27',
    freeBoundary: 'Public application; allowance depends on approval',
    defaultAutoPolicy: 'explicit-only',
    secretFields: [{ id: 'api-key', label: 'KCI API key', required: true }],
    optionFields: [],
  },
  scienceon: {
    id: 'scienceon',
    name: 'ScienceON',
    shortName: 'ScienceON',
    operator: 'KISTI',
    role: 'index',
    protocol: 'native',
    description: 'Search Korean science and technology literature metadata.',
    docsUrl: 'https://scienceon.kisti.re.kr/por/oapi/openApi.do',
    lastVerifiedAt: '2026-07-27',
    freeBoundary: 'Public application',
    defaultAutoPolicy: 'explicit-only',
    secretFields: [
      { id: 'api-key', label: 'ScienceON API key', required: true },
    ],
    optionFields: [
      {
        id: 'endpoint',
        label: 'Approved request URL',
        required: true,
        placeholder: 'Paste the request URL shown after approval',
      },
      {
        id: 'query-param',
        label: 'Query parameter',
        required: true,
        defaultValue: 'query',
      },
      {
        id: 'key-param',
        label: 'Key parameter',
        required: true,
        defaultValue: 'key',
      },
    ],
  },
  riss: {
    id: 'riss',
    name: 'RISS Linked Data',
    shortName: 'RISS',
    operator: 'KERIS',
    role: 'discover',
    protocol: 'native',
    description:
      'Run bounded SPARQL templates over Korean theses and bibliographic linked data.',
    docsUrl: 'https://data.riss.kr/sparqlEndpoint.do',
    endpoint: 'https://data.riss.kr/sparql',
    lastVerifiedAt: '2026-07-27',
    freeBoundary: 'Public endpoint; one-minute server timeout',
    defaultAutoPolicy: 'allow',
    secretFields: [],
    optionFields: [],
  },
  opendart: {
    id: 'opendart',
    name: 'OpenDART',
    shortName: 'OpenDART',
    operator: 'Financial Supervisory Service',
    role: 'official',
    protocol: 'native',
    description: 'Search official Korean corporate disclosures.',
    docsUrl: 'https://opendart.fss.or.kr/guide/main.do',
    endpoint: 'https://opendart.fss.or.kr/api/list.json',
    lastVerifiedAt: '2026-07-27',
    freeBoundary: 'Free key; account-specific practical limit',
    defaultAutoPolicy: 'explicit-only',
    secretFields: [
      { id: 'api-key', label: 'OpenDART API key', required: true },
    ],
    optionFields: [],
  },
  ntis: {
    id: 'ntis',
    name: 'NTIS',
    shortName: 'NTIS',
    operator: 'KISTI / Ministry of Science and ICT',
    role: 'official',
    protocol: 'native',
    description: 'Search approved Korean national R&D project metadata.',
    docsUrl: 'https://www.ntis.go.kr/rndopen/api/mng/apiMain.do',
    lastVerifiedAt: '2026-07-27',
    freeBoundary: 'Free application with institutional approval',
    defaultAutoPolicy: 'explicit-only',
    secretFields: [{ id: 'api-key', label: 'NTIS API key', required: true }],
    optionFields: [
      {
        id: 'endpoint',
        label: 'Approved request URL',
        required: true,
        placeholder: 'Paste the request URL shown after approval',
      },
      {
        id: 'query-param',
        label: 'Query parameter',
        required: true,
        defaultValue: 'searchWord',
      },
      {
        id: 'key-param',
        label: 'Key parameter',
        required: true,
        defaultValue: 'apprvKey',
      },
    ],
  },
  kosis: {
    id: 'kosis',
    name: 'KOSIS MCP',
    shortName: 'KOSIS',
    operator: 'Statistics Korea pilot',
    role: 'official',
    protocol: 'mcp',
    description: 'Retrieve official Korean statistical tables and metadata.',
    docsUrl: 'https://kosismcp2026.vercel.app/',
    lastVerifiedAt: '2026-07-27',
    freeBoundary: 'Public pilot endpoint; no authentication',
    defaultAutoPolicy: 'explicit-only',
    desktopOnly: true,
    secretFields: [],
    optionFields: [],
    mcpPreset: {
      connectionId: 'research-kosis',
      url: 'https://kosismcp2026.vercel.app/api/mcp',
      legacySse: false,
    },
  },
  naver: {
    id: 'naver',
    name: 'NAVER API HUB Search',
    shortName: 'NAVER',
    operator: 'NAVER Cloud',
    role: 'discover',
    protocol: 'native',
    description:
      'Discover current Korean news, web, and blog results. Results are snippets, not article bodies.',
    docsUrl: 'https://api.ncloud-docs.com/docs/naver-api-hub-overview',
    endpoint: 'https://naverapihub.apigw.ntruss.com/search/v1',
    lastVerifiedAt: '2026-07-27',
    freeBoundary: 'Current temporary free trial with a high monthly quota',
    defaultAutoPolicy: 'allow',
    secretFields: [
      { id: 'key-id', label: 'API key ID', required: true },
      { id: 'api-key', label: 'API key', required: true },
    ],
    optionFields: [
      {
        id: 'vertical',
        label: 'Default search vertical',
        required: true,
        defaultValue: 'news',
        placeholder: 'news, webkr, blog',
      },
    ],
  },
  pubmed: {
    id: 'pubmed',
    name: 'PubMed',
    shortName: 'PubMed',
    operator: 'NCBI / U.S. National Library of Medicine',
    role: 'index',
    protocol: 'native',
    description: 'Search authoritative biomedical publication metadata.',
    docsUrl: 'https://www.ncbi.nlm.nih.gov/books/NBK25497/',
    endpoint: 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi',
    lastVerifiedAt: '2026-07-27',
    freeBoundary: '3 requests/second without key; 10 with a free key',
    defaultAutoPolicy: 'allow',
    secretFields: [
      { id: 'api-key', label: 'Optional NCBI API key', required: false },
    ],
    optionFields: [
      {
        id: 'email',
        label: 'Contact email',
        required: false,
        placeholder: 'name@example.com',
      },
    ],
  },
  'europe-pmc': {
    id: 'europe-pmc',
    name: 'Europe PMC',
    shortName: 'Europe PMC',
    operator: 'Europe PMC / EMBL-EBI',
    role: 'discover',
    protocol: 'native',
    description:
      'Search life-science literature, citations, grants, and open-access locations.',
    docsUrl: 'https://europepmc.org/RestfulWebService',
    endpoint: 'https://www.ebi.ac.uk/europepmc/webservices/rest/search',
    lastVerifiedAt: '2026-07-27',
    freeBoundary: 'Public REST API',
    defaultAutoPolicy: 'allow',
    secretFields: [],
    optionFields: [],
  },
}

export const RESEARCH_PACKS: ResearchPackDefinition[] = [
  {
    id: 'wos',
    name: 'WoS Starter',
    description: 'Official Web of Science and SSCI index search.',
    sourceIds: ['wos'],
  },
  {
    id: 'doi-integrity',
    name: 'DOI Integrity',
    description: 'DOI, correction, and retraction verification.',
    sourceIds: ['crossref'],
  },
  {
    id: 'openalex',
    name: 'OpenAlex',
    description: 'Open citation graph and author/institution enrichment.',
    sourceIds: ['openalex'],
  },
  {
    id: 'korean-academic',
    name: 'Korean Academic',
    description: 'Korean journal, science, and thesis discovery.',
    sourceIds: ['kci', 'scienceon', 'riss'],
  },
  {
    id: 'korean-facts',
    name: 'Korean Facts',
    description:
      'Corporate disclosures, national R&D, and official statistics.',
    sourceIds: ['opendart', 'ntis', 'kosis'],
  },
  {
    id: 'naver',
    name: 'NAVER API HUB',
    description: 'Korean news, web, and blog discovery.',
    sourceIds: ['naver'],
  },
  {
    id: 'biomedical',
    name: 'Biomedical',
    description: 'PubMed indexing with Europe PMC enrichment.',
    sourceIds: ['pubmed', 'europe-pmc'],
  },
]

export function getResearchSource(
  sourceId: ResearchSourceId,
): ResearchSourceDefinition {
  return RESEARCH_SOURCES[sourceId]
}

export function getResearchPack(
  packId: ResearchPackId,
): ResearchPackDefinition | undefined {
  return RESEARCH_PACKS.find((pack) => pack.id === packId)
}
