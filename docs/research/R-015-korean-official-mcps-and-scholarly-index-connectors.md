# R-015: Korean Official MCPs and Scholarly Index Connectors

> [!IMPORTANT]
> **Status: Verified investigation**
>
> **Planning use: Mandatory**
>
> This report records the 2026-07-26 follow-up investigation into Korean
> official-data MCPs, Korean academic-data services, Web of Science/SSCI,
> Scopus, Google Scholar-like research products, and research-integrity
> sources. It extends R-014 and is authoritative for the quota and scholarly
> index details covered here.

## 1. Executive Decision

Smart Composer can become materially stronger for Korean factual writing and
academic research, but the useful sources fall into three different product
classes:

1. **Direct MCP connections available now**
   - KOSIS official MCP for Korean national statistics.
   - Consensus MCP for AI-assisted peer-reviewed paper discovery.
   - Asta Scientific Corpus MCP for broad open scholarly discovery.
   - Korean Law MCP for legal retrieval, with an explicit third-party operator
     trust label.
2. **Official APIs that need a Smart Composer native connector or a small MCP
   adapter**
   - Web of Science Starter, including an explicit `WOS+SSCI` edition filter.
   - Scopus APIs, subject to institutional entitlement.
   - KCI, ScienceON, RISS, NTIS, OpenDART, Crossref, OpenAlex, PubMed, and
     Europe PMC.
3. **Useful research products that must not be represented as APIs**
   - Google Scholar Labs and Google Literature Insights are excellent UX and
     workflow references, but no public official API or MCP was found.
   - Smart Composer must not scrape Google Scholar or depend on an unofficial
     scraper while presenting the result as an S-grade source.

The most important newly verified result is:

> The current Web of Science Starter API publishes a Free Trial Plan available
> to anyone, including non-subscribers, with 50 requests per day and one request
> per second. Its current official OpenAPI definition exposes an `edition`
> parameter and explicitly lists `WOS+SSCI`.

That makes the following Smart Composer request technically realistic:

```text
Find recent papers about AI literacy only from the SSCI edition.
```

The connector can translate it into a bounded Web of Science request similar
to:

```text
db=WOS
edition=WOS+SSCI
q=TS=("artificial intelligence literacy")
sortField=RS+D
limit=50
```

This is high-value, but it is not a full-text research engine:

- the free plan does not return times-cited counts;
- Starter returns basic bibliographic metadata and links, not the paper body;
- topic search can search abstracts, but the response schema does not expose
  the abstract itself;
- a second DOI/full-text/retraction-verification layer is still required for
  evidence-based synthesis;
- the current Smart Composer MCP form cannot send the required custom
  `X-ApiKey` header to a plain REST API.

Therefore, the strongest product direction is a curated **Research Sources**
connector layer rather than asking beginners to build local servers or paste
raw API JSON.

## 2. Relationship to Existing Reports

This report must be read with:

- **R-010** for beginner-safe MCP connection and OAuth UX;
- **R-011** for the implemented Smart Composer 2.3 MCP runtime;
- **R-012** for desktop HTTP transport and browser-CORS correction;
- **R-013** for long-output and document-scale writing boundaries;
- **R-014** for the general fact-checking shortlist, NAVER API HUB, and broader
  web-discovery providers.

R-015 narrows and corrects three parts of R-014:

1. Current Brave and Tavily free limits are date-stamped precisely.
2. Korean official MCP/API sources are separated from third-party MCP wrappers.
3. Web of Science, SSCI, Scopus, and Google Scholar-like workflows are treated
   as separate products with different authority and access boundaries.

## 3. Evidence Standard: What "S-Grade" Means

"S-grade" is not one score. A source can be excellent for discovery and weak
for verification, or authoritative but poor at natural-language discovery.

### 3.1 Discovery strength

A strong discovery service:

- understands natural-language or semantic queries;
- decomposes broad questions;
- ranks likely relevant records;
- exposes enough metadata to refine the query;
- supports year, document type, study type, journal, or corpus filters.

### 3.2 Authority and index provenance

A strong authority source:

- is operated by the government, index owner, publisher, or recognized
  bibliographic infrastructure;
- identifies the exact corpus or index used;
- returns durable identifiers such as DOI, PMID, KCI ID, WoS UID, or Scopus
  EID;
- permits the result to be traced back to the source record.

### 3.3 Research-integrity strength

A strong verification layer:

- detects retractions, corrections, and expressions of concern;
- distinguishes a search match from evidence supporting a claim;
- exposes citation context where available;
- records retrieval date and provenance;
- does not silently convert missing metadata into a positive claim.

No single investigated service is best on all three axes. The intended
workflow is:

```text
AI/semantic discovery
  -> curated-index confirmation
  -> DOI and metadata normalization
  -> retraction/editorial-status check
  -> abstract/full-text retrieval where licensed
  -> cited synthesis in Smart Composer
```

## 4. Brave and Tavily Free-Tier Correction

Quotas are temporally unstable. The following values were rechecked against
live official pages on 2026-07-26.

| Provider | Current published free boundary | Practical interpretation |
| --- | --- | --- |
| Brave Search API | USD 5 recurring monthly credit; Search costs USD 5 per 1,000 requests | Approximately 1,000 ordinary Search requests per month if the credit is used only for Search |
| Tavily | 1,000 API credits per month, no card required | 1,000 Basic searches or 500 Advanced searches; extract, map, and research operations consume different amounts |

The statement "Brave 1,000 and Tavily 2,000 free searches" is not the current
published pair:

- Brave has older official material that mentioned 2,000 monthly requests, but
  the live product pricing now maps the recurring credit to approximately
  1,000 Search requests.
- Tavily does not currently promise 2,000 fixed searches. It grants 1,000
  credits, and one request can consume more than one credit.

These services remain valuable general-web discovery layers. They do not prove
that a paper is in SSCI, that a Korean statistic is official, or that a claim
in a paper is correct.

Official sources:

- [Brave Search API product and pricing](https://brave.com/search/api/)
- [Tavily API credits](https://docs.tavily.com/documentation/api-credits)

## 5. Korean Sources That Can Connect as MCP Now

### 5.1 KOSIS official MCP

**Recommendation: S-grade Korean statistical source; install as On demand.**

Statistics Korea launched an AI-based KOSIS pilot in July 2026. The published
MCP endpoint is:

```text
https://kosismcp2026.vercel.app/api/mcp
```

Authentication:

```text
No authentication
```

A sanitized live protocol test performed during this investigation confirmed:

- MCP initialization returned HTTP 200;
- the negotiated protocol version was `2025-03-26`;
- `tools/list` exposed ten tools;
- a local search for Chuncheon population returned an official KOSIS table,
  table identifier, organization identifier, and KOSIS URL.

Observed tools:

```text
kosis_get_data
kosis_local_search
kosis_search
kosis_validate
kosis_region_code
kosis_table_info
kosis_item_search
kosis_meta
kosis_list
kosis_indicator
```

Product implications:

- Ten tools nearly consume Smart Composer Auto routing's twelve-tool budget.
- Configure the connection as **On demand**.
- The answer must show the table identifier, observation period, unit, and
  source URL.
- Material decisions should still open and verify the original KOSIS table.
- A model's interpretation is not an official government position.

Official sources:

- [KOSIS notices](https://kosis.kr/serviceInfo/noticeList.do)
- [Statistics Korea KOSIS MCP launch material](https://mods.go.kr/boardDownload.es?bid=246&list_no=445768&seq=3)
- [KOSIS MCP guide and endpoint](https://kosismcp2026.vercel.app/)

### 5.2 Seoul real-time city-data MCP

**Recommendation: official S-grade source, but watchlist rather than general
installation.**

The Seoul Metropolitan Government announced a public-data MCP pilot covering
real-time city data for 121 locations, including crowding, transportation,
weather, and events.

Current boundary:

- official source and official public-data project;
- launched as a limited pilot;
- initial access was described through Kakao PlayMCP for the first 100 users;
- no stable general-purpose endpoint was verified for arbitrary Smart Composer
  installation.

Do not put a guessed URL in a preset. Add it only after Seoul publishes a
stable endpoint and access contract.

Official sources:

- [Seoul Metropolitan Government Korean announcement](https://www.seoul.go.kr/news/news_report.do?nttNo=461449)
- [Seoul English announcement](https://english.seoul.go.kr/reducing-ai-hallucinations-seoul-launches-the-first-public-data-mcp-service/)

### 5.3 Korean Law MCP

**Recommendation: high-value current connection with a visible operator
warning.**

The user's Smart Composer 2.4 live test has already demonstrated the practical
value of Korean legal retrieval for fact checking and writing.

Trust boundary:

- the underlying legal material can be authoritative;
- the investigated MCP endpoint is operated by a third party, not by the
  Korean government;
- schema review proves the tool contract, not the operator's identity or the
  accuracy of every returned result;
- responses should preserve statute name, article, effective date, source URL,
  and retrieval date.

This distinction must remain visible in any curated preset:

```text
Data authority: official Korean legal source
MCP operator: third party
```

### 5.4 Korea Investment official MCP

Korea Investment & Securities publishes official developer repositories with
MCP-related functionality. It is valuable for market information but is not a
default writing/research source.

Safety boundary:

- market-data reads may be useful;
- account and order capabilities are high-risk write operations;
- any future preset must use a read-only allowlist by default;
- trading tools require explicit per-call approval and should not be exposed to
  ordinary Auto routing.

Official sources:

- [Korea Investment & Securities GitHub organization](https://github.com/koreainvestment)
- [Official Open Trading API repository](https://github.com/koreainvestment/open-trading-api)

## 6. Korean Official APIs That Need Native Connectors

These sources are valuable, but they are not remote MCP endpoints. Smart
Composer should not ask beginners to translate them into JSON manually.

### 6.1 KCI: Korean academic index and citation data

The National Research Foundation of Korea provides:

- KCI Open API search and metadata;
- article details and citation-index data;
- reference search;
- OAI-PMH data access;
- an official linkage API that exposes relationships to KCI, WoS, Scopus, and
  NDSL records for domestic papers.

Recommended role:

```text
Korean humanities/social-science discovery
  -> KCI record and citation metadata
  -> KCI/WoS/Scopus linkage identifiers
  -> original article or publisher record
```

The public-data linkage API currently describes development access as
automatically approved with a development traffic allowance of 5,000 calls.
Production use is reviewed and can request a larger allowance. This value must
be rechecked at implementation time.

Official sources:

- [KCI Open API list](https://www.kci.go.kr/kciportal/po/openapi/openApiList.kci)
- [KCI connection sample](https://www.kci.go.kr/kciportal/po/openapi/openApiConnSamp.kci)
- [KCI OAI-PMH guide](https://www.kci.go.kr/kciportal/po/openapi/openDataPackGuide.kci?datasetBean.dtstTyCd=00)
- [Public Data Portal KCI linkage API](https://www.data.go.kr/data/15085510/openapi.do)

### 6.2 ScienceON

KISTI's ScienceON provides an official Open API path for Korean
science-and-technology papers and related research information.

Recommended role:

- Korean science/engineering paper discovery;
- identifier and metadata normalization;
- complementary coverage to KCI and international indexes.

Official sources:

- [ScienceON Open API](https://scienceon.kisti.re.kr/por/oapi/openApi.do)
- [Public Data Portal ScienceON API transition notice](https://www.data.go.kr/bbs/ntc/selectNotice.do?atchFileId=&nttApiYn=Y&originId=NOTICE_0000000004277&pageIndex=1&searchCondition2=2&searchKeyword1=)

### 6.3 RISS Linked Data

KERIS publishes a RISS Linked Data SPARQL endpoint with examples for theses,
articles, and books.

Recommended role:

- Korean theses and dissertations;
- bibliographic relationships not covered cleanly by ordinary keyword search;
- source expansion after a KCI or ScienceON hit.

The official UI documents a one-minute query timeout. The connector must use
bounded templates and never let the model emit arbitrary unbounded SPARQL by
default.

Official source:

- [RISS Linked Data SPARQL endpoint](https://data.riss.kr/sparqlEndpoint.do)

### 6.4 NTIS

NTIS exposes official APIs for Korean national R&D information, including:

- projects;
- outputs such as papers and patents;
- facilities and reports;
- terminology, codes, issues, and recommendations.

Recommended role:

- validate claims about publicly funded Korean R&D;
- connect a paper to its project, funding program, or output;
- provide government-source context for technology-policy writing.

Official source:

- [NTIS Open API](https://www.ntis.go.kr/rndopen/api/mng/apiMain.do)

### 6.5 OpenDART

The Financial Supervisory Service's OpenDART is an S-grade Korean corporate
fact-checking source for:

- disclosures;
- company overview data;
- report originals;
- financial statements and statement accounts.

It requires an API key and is a normal REST API, not MCP. The official error
guide identifies error `020` as a request-limit condition and describes a
general 20,000-request boundary, but per-key policy must be checked in the
actual account.

Official sources:

- [OpenDART API guide](https://opendart.fss.or.kr/guide/main.do)
- [OpenDART endpoint and error guide](https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS001&apiId=2019001)

### 6.6 NAVER API HUB

R-014 remains authoritative for NAVER Search/API HUB details. It should be a
native Korean discovery connector, not disguised as MCP.

Recommended role:

- Korean news, blog, web, and local discovery;
- candidate-source collection;
- never the final authority merely because a result ranked highly.

## 7. Web of Science Starter: The SSCI Opportunity

### 7.1 Free access is real, with a naming caveat

Clarivate's current product page publishes:

| Plan | Eligibility | Requests/second | Requests/day | Times cited |
| --- | --- | ---: | ---: | --- |
| Free Trial | Anyone, including non-subscribers | 1 | 50 | No |
| Free Institutional Member | Members of subscribing organizations | 5 | 5,000 | Yes |
| Institutional Integration | Approved institutional administrators | 5 | 20,000 | Subject to plan |

The free tier is explicitly named **Free Trial Plan**. The public page does not
state a visible expiration period, but Smart Composer must not re-label it
"permanently free." Quota and continued eligibility must be rechecked before
each release.

Official source:

- [Web of Science Starter API plans](https://developer.clarivate.com/apis/wos-starter)

### 7.2 SSCI filtering is explicitly present in the current Swagger

The current official OpenAPI definition for `GET /documents` includes:

```text
db
q
limit
page
sortField
modifiedTimeSpan
publishTimeSpan
tcModifiedTimeSpan
detail
edition
```

The `edition` description explicitly lists these Web of Science Core
Collection editions:

```text
AHCI, CCR, IC, ISSHP, ISTP, SCI, SSCI, BHCI, BSCI, ESCI
```

It gives `WOS+SCI` as the syntax example. Therefore the corresponding SSCI
filter is:

```text
edition=WOS+SSCI
```

This is stronger evidence than inferring SSCI membership from a journal list.
The query is executed against the edition selected by the index owner.

Official source:

- [Web of Science Starter OpenAPI definition](https://developer.clarivate.com/apis/wos-starter/swagger)

### 7.3 Search capability

Starter supports a bounded subset of Web of Science field tags, including:

```text
TI    title
SO    source title
PY    publication year
AU    author
AI    author identifier
UT    accession number
DO    DOI
DT    document type
PMID  PubMed ID
OG    preferred organization
TS    topic
```

`TS` searches:

- title;
- abstract;
- author keywords;
- Keywords Plus.

This enables useful requests such as:

```text
SSCI only:
  TS=("AI literacy" OR "artificial intelligence literacy")
  AND PY=(2022-2026)
  AND DT=(Article OR Review)
```

The connector should generate the exact query rather than asking the model to
guess Clarivate syntax.

### 7.4 What one request returns

One search request can return between one and fifty records. Each additional
page is another request.

At the maximum page size, the mathematical upper bound is therefore 2,500
returned records per day under the 50-request plan. That is not a promise of
2,500 unique useful papers, and it assumes all requests are spent on full
pages. Normal interactive use should spend far less.

Returned basic metadata includes:

- WoS UID;
- title;
- document and source types;
- journal/source;
- publication date, issue, volume, and pages;
- authors and ResearcherID where available;
- DOI, ISSN, ISBN, and PMID where available;
- author keywords;
- Web of Science record/reference/related links.

Important limitation:

> The response schema does not expose the article abstract or full text even
> though `TS` can search abstract content.

### 7.5 Smart Composer cannot paste this into the existing MCP URL field

Web of Science Starter is a REST API, not an MCP server. Authentication is:

```text
Header: X-ApiKey
```

Smart Composer 2.4's generic remote MCP form supports MCP transport plus
automatic OAuth, no auth, bearer, and manual OAuth client settings. It does not
turn an arbitrary REST API into MCP and does not expose arbitrary custom
headers.

Two viable implementation paths:

#### Preferred: built-in Research Sources connector

```text
Settings
  -> Research Sources
  -> Web of Science Starter
  -> API key
  -> Test connection
  -> Enabled editions: SSCI, SCI, AHCI, ESCI
  -> Daily quota display
```

Advantages:

- easiest setup;
- secrets stay in Smart Composer SecretStorage;
- exact query templates can be validated;
- quota, edition, and source labels can be first-class UI;
- no child process or local server to manage.

#### Faster prototype: bundled local stdio MCP adapter

```text
Smart Composer local MCP
  -> bundled WoS adapter
  -> X-ApiKey header
  -> Clarivate Starter REST API
```

Advantages:

- reuses the current MCP tool, approval, and mention UX;
- only two or three tools are needed.

Disadvantages:

- desktop only;
- another adapter process and packaging path;
- less suitable for a future mobile implementation.

### 7.6 Recommended tool contract

Keep the model-facing surface small:

```ts
type WosEdition =
  | "SSCI"
  | "SCI"
  | "AHCI"
  | "ESCI"
  | "BHCI"
  | "BSCI";

interface WosSearchInput {
  topic: string;
  editions: WosEdition[];
  fromYear?: number;
  toYear?: number;
  documentTypes?: string[];
  page?: number;
  limit?: number; // 1..50
  sort?: "relevance" | "newest" | "oldest";
}
```

Suggested tools:

```text
wos_search_documents
wos_get_document
wos_get_journal
```

Do not expose arbitrary raw Web of Science query syntax in the beginner path.
An advanced mode can reveal the generated query and allow editing.

### 7.7 Required result labeling

Every result card and model context block should carry:

```text
Source: Web of Science Starter API
Collection: Web of Science Core Collection
Edition filter: SSCI
Search fields: Topic
Retrieved: 2026-07-26
Coverage: bibliographic metadata, not full text
Times cited: unavailable on Free Trial
```

This prevents three misleading statements:

- "I read all of these papers."
- "These papers prove the claim."
- "This is the complete SSCI literature."

## 8. Scopus: Strong, but Institution-Dependent

Elsevier publishes official Scopus APIs and allows users to request API keys.
The meaningful access boundary is not the key alone:

- full access depends on the corresponding institutional subscription;
- requests may need to originate from an entitled institutional network or use
  an institutional token;
- authentication commonly uses `X-ELS-APIKey`, with additional entitlement
  mechanisms where required;
- quota examples are published per API, but entitlement controls the content
  returned.

Published examples include:

- Scopus Search: 20,000 requests/week;
- Abstract Retrieval: 10,000 requests/week.

These numbers do not mean every personal key receives full Scopus content from
every network.

No official Elsevier Scopus MCP was found. Like WoS, Scopus needs a native
connector or adapter.

Recommended Hallym validation:

1. obtain an Elsevier API key;
2. test on campus network;
3. test off campus;
4. test through the university library's remote-access path;
5. inspect returned entitlement headers and metadata;
6. document whether an institutional token is available.

Official sources:

- [Elsevier Developer Portal](https://dev.elsevier.com/)
- [Scopus APIs](https://dev.elsevier.com/sc_apis.html)
- [Elsevier API authentication](https://dev.elsevier.com/tecdoc_api_authentication.html)
- [Elsevier API key settings and quotas](https://dev.elsevier.com/api_key_settings.html)

## 9. Google Scholar-Like AI Search

### 9.1 Scholar Labs

Google describes Scholar Labs as an experimental research experience that:

- breaks a research question into aspects;
- searches those aspects;
- identifies papers;
- explains why each paper is relevant.

This is a strong UX reference for Smart Composer's research mode.

Boundary:

- limited product access;
- no public official API found;
- no official MCP found.

Official source:

- [Google Scholar Labs announcement](https://blog.google/products-and-platforms/products/education/google-scholar-labs/)

### 9.2 Google Literature Insights

Google Labs' newer science experiments describe comprehensive literature
search, structured tables, extracted variables, and traceable reports.

It is another strong workflow reference, but no public integration API or MCP
was verified.

Official sources:

- [Google Labs Science](https://labs.google/science/)
- [Google AI for Science announcement](https://blog.google/innovation-and-ai/technology/research/gemini-for-science-io-2026/)

### 9.3 Do not scrape Google Scholar

Google Scholar's official help states that automated software must respect
robots.txt and that a query exposes at most 1,000 results. Google's terms also
prohibit automated access that violates machine-readable instructions.

Product decision:

- do not ship a Google Scholar scraper;
- do not recommend a third-party scraping MCP as an S-grade source;
- reproduce the useful workflow with licensed/open APIs instead.

Official sources:

- [Google Scholar help](https://scholar.google.com/intl/us/scholar/help.html)
- [Google Terms of Service](https://policies.google.com/terms)

## 10. Direct Scholarly MCPs

### 10.1 Consensus MCP

**Recommendation: best immediate Google Scholar-like MCP for ordinary users.**

Official endpoint:

```text
https://mcp.consensus.app/mcp
```

Consensus documents:

- peer-reviewed research search;
- natural-language questions;
- year, study type, SJR quartile, human-study, sample-size, and other filters;
- an option to exclude preprints;
- a focused `search` tool for non-ChatGPT MCP clients.

Current access tiers documented by Consensus include:

- guest/no paid account: three papers per search with unlimited monthly
  searches;
- Free account: ten papers per search and thirty monthly searches;
- paid tiers: larger per-search and monthly allowances.

A sanitized live connection probe returned an OAuth challenge and valid MCP
OAuth metadata with PKCE and dynamic client registration. This appears
protocol-compatible with Smart Composer 2.4 automatic OAuth, but the complete
Obsidian browser-login callback still requires a user smoke test.

Important nuance:

> "No account" in the product plan does not mean the MCP endpoint accepts an
> unauthenticated POST. The endpoint still initiates an OAuth/guest identity
> flow.

Official source:

- [Consensus MCP documentation](https://docs.consensus.app/docs/mcp)

### 10.2 Asta Scientific Corpus

**Recommendation: strong open scholarly graph; On demand; monitor latency.**

Official endpoint:

```text
https://asta-tools.allen.ai/mcp/v1
```

Allen Institute for AI describes a normalized scientific corpus of more than
200 million records. A sanitized anonymous MCP initialization and tool scan
succeeded during the investigation.

Boundary:

- an API key can provide higher limits through `x-api-key`;
- Smart Composer's generic MCP form does not currently expose arbitrary custom
  headers;
- anonymous relevance-search calls timed out twice during one test window;
- no stable anonymous quota was found in the public documentation.

Use Asta as an optional On-demand scholarly discovery source, not the only
academic backend.

Official sources:

- [Asta MCP resource](https://allenai.org/asta/resources/mcp)
- [Asta scientific research agents](https://allenai.org/blog/asta)

### 10.3 Elicit MCP

**Recommendation: premium systematic-review option.**

Official endpoint:

```text
https://elicit.com/api/mcp
```

Elicit documents:

- OAuth-based MCP access;
- semantic and keyword paper search;
- a corpus of more than 138 million papers;
- filters for study type, journal quartile, and retraction exclusion;
- larger result limits on higher plans.

MCP/API access currently requires Pro or above. This does not satisfy the
free-first requirement, but it belongs in an advanced research preset.

Official source:

- [Elicit API and MCP documentation](https://docs.elicit.com/)

### 10.4 scite MCP

**Recommendation: premium citation-context and research-integrity option.**

Official endpoint:

```text
https://api.scite.ai/mcp
```

scite adds a capability that ordinary citation counts do not:

- supporting citation context;
- contrasting citation context;
- mentioning citation context;
- editorial notices;
- reference checking.

Its official MCP uses OAuth 2.1 with PKCE/dynamic registration and requires a
premium subscription. It should be an optional verification layer, not a
default free connection.

Official sources:

- [scite API and MCP documentation](https://api.scite.ai/docs)
- [scite MCP product page](https://scite.ai/mcp)

## 11. Open Verification and Enrichment APIs

### 11.1 OpenAlex

OpenAlex provides a large open scholarly graph and a free daily budget.
Published examples map the free budget to approximately:

- 10,000 list/filter calls per day;
- 1,000 searches per day;
- 100 full-text downloads per day;
- effectively unrestricted singleton entity lookups within the documented
  model.

It is valuable for:

- DOI and entity normalization;
- citation graph expansion;
- author, institution, venue, and concept relationships;
- open-access and full-text location discovery.

OpenAlex should complement, not impersonate, a WoS or Scopus index filter.

Official source:

- [OpenAlex API authentication and budget](https://developers.openalex.org/api-reference/authentication)

### 11.2 Crossref and Retraction Watch

Crossref's public REST API requires no signup. The documented public and polite
pools publish bounded request rates, and the Retraction Watch dataset is
available through Crossref metadata and downloadable data.

This is a mandatory integrity layer for:

- DOI normalization;
- publisher and publication-date confirmation;
- retractions;
- corrections;
- expressions of concern;
- other editorial updates.

Official sources:

- [Crossref REST API access](https://crossref.org/documentation/retrieve-metadata/rest-api/access-and-authentication/)
- [Crossref Retraction Watch data](https://www.crossref.org/documentation/retrieve-metadata/retraction-watch/)

### 11.3 PubMed/NCBI

NCBI E-utilities publishes:

- three requests per second without an API key;
- ten requests per second with a free NCBI account key.

This is an authoritative biomedical index and metadata source, but inclusion in
an NLM database is not an endorsement of an article's conclusions.

Official source:

- [NCBI E-utilities usage guidelines](https://www.ncbi.nlm.nih.gov/books/NBK25497/)

### 11.4 Europe PMC

Europe PMC complements PubMed with:

- life-science literature search;
- grants and citation links;
- open-access full text where available;
- REST APIs suitable for a native connector.

Official source:

- [Europe PMC developer resources](https://europepmc.org/RestfulWebService)

## 12. Smart Composer 2.4 Compatibility Matrix

| Source | Operator status | Protocol/auth | Free boundary | Fits current generic MCP UI? | Recommended role |
| --- | --- | --- | --- | --- | --- |
| KOSIS MCP | Korean official | Remote MCP, no auth | Pilot/public endpoint | Yes | Korean statistics |
| Korean Law MCP | Third-party wrapper over official data | Remote MCP | Provider-specific | Yes | Korean law |
| Consensus MCP | Official provider | Remote MCP, OAuth | Guest/free tiers | Likely; browser callback smoke test required | AI paper discovery |
| Asta MCP | Official Ai2 | Remote MCP; optional `x-api-key` | Anonymous access observed | Anonymous yes; keyed access no custom-header UI | Open scholarly graph |
| Elicit MCP | Official provider | Remote MCP, OAuth | Paid | Likely; smoke test required | Systematic review |
| scite MCP | Official provider | Remote MCP, OAuth | Paid | Likely; smoke test required | Citation context/integrity |
| WoS Starter | Official Clarivate | REST, `X-ApiKey` | 50 requests/day Free Trial | No | WoS/SSCI index search |
| Scopus | Official Elsevier | REST, API key plus entitlement | Key available; full access institution-dependent | No | Scopus index search |
| KCI | Korean official | REST/XML/OAI-PMH | Public application | No | Korean academic index |
| ScienceON | Korean official | REST | Public application | No | Korean science/technology |
| RISS | Korean official | SPARQL | Public endpoint | No | Theses and linked data |
| NTIS | Korean official | REST | Application/approval | No | Korean national R&D |
| OpenDART | Korean official | REST, API key | High practical quota | No | Corporate disclosures |
| OpenAlex | Official open infrastructure | REST, API key | Published daily budget | No | Open graph/enrichment |
| Crossref | Official DOI infrastructure | REST | Public/polite pools | No | DOI and retraction status |
| PubMed | US government | REST, optional API key | 3 or 10 requests/second | No | Biomedical index |
| Google Scholar Labs | Google product | No public API/MCP | Limited product access | No | UX reference only |

## 13. Recommended User Profiles

### 13.1 Free Korean factual-writing profile

```text
KOSIS official MCP       On demand
Korean Law MCP           On demand
One web search provider  Auto
```

Add later as native connectors:

```text
OpenDART
NAVER API HUB
NTIS
```

### 13.2 Free academic-writing profile

```text
Consensus MCP            On demand
Asta Scientific Corpus   On demand
Crossref/OpenAlex        Built-in enrichment
```

This is the best immediately attainable Google Scholar-like profile without
scraping Scholar.

### 13.3 SSCI-focused profile

```text
Web of Science Starter   Built-in or bundled adapter
  edition: SSCI
  daily calls: 50
  max records/request: 50

Crossref                 DOI/editorial status
OpenAlex                 graph/open-access enrichment
Consensus or Asta        semantic query expansion
```

Example experience:

```text
User:
  SSCI 등재 논문 중 생성형 AI와 대학 글쓰기 평가 관련
  2023년 이후 연구를 찾아 핵심 쟁점별로 정리해줘.

Smart Composer:
  1. decomposes the question;
  2. generates a validated WoS topic query;
  3. calls WoS with edition=WOS+SSCI;
  4. normalizes DOI records;
  5. checks retractions/editorial updates;
  6. retrieves abstracts or open text where permitted;
  7. synthesizes with source and coverage labels.
```

### 13.4 Hallym institutional profile

Validate:

- WoS institutional member eligibility;
- Scopus campus and remote-access entitlement;
- library proxy/token requirements;
- whether institutional API use is permitted for this plugin workflow;
- whether credentials are individual, institutional, or administrator-issued.

If Hallym's Web of Science subscription qualifies the user for the Free
Institutional Member Plan, the published limit rises from 50 to 5,000 requests
per day and includes times-cited data. This must be confirmed through the
actual Clarivate application, not inferred solely from campus access to the
website.

## 14. Product Architecture Implications

### 14.1 Add a Research Sources settings section

Do not mix normal APIs into the MCP connection editor.

```text
Settings
  Connections
    MCP connections
    Research sources
      Web of Science
      Scopus
      KCI
      ScienceON
      RISS
      NTIS
      OpenDART
      Crossref
      OpenAlex
      PubMed
      NAVER API HUB
```

Each source should show:

- official operator;
- authority category;
- credential type;
- quota and reset period;
- corpus/edition;
- connection test;
- last successful request;
- source-specific warning;
- link to the official credential page.

### 14.2 Normalize research records

A shared record should preserve provenance rather than flattening all sources:

```ts
interface ResearchRecord {
  title: string;
  authors: string[];
  publicationYear?: number;
  venue?: string;
  documentType?: string;
  abstract?: string;
  identifiers: {
    doi?: string;
    pmid?: string;
    kciId?: string;
    wosUid?: string;
    scopusEid?: string;
  };
  indexCoverage: Array<{
    source: "WOS" | "SCOPUS" | "KCI" | "PUBMED" | "OPENALEX";
    edition?: string;
    verifiedAt: string;
  }>;
  editorialStatus?: {
    status: "clear" | "corrected" | "concern" | "retracted" | "unknown";
    source: string;
    checkedAt: string;
  };
  sourceLinks: string[];
}
```

Do not merge records only by title. Prefer DOI, PMID, WoS UID, Scopus EID, KCI
ID, and carefully normalized fallback matching.

### 14.3 Credentials must remain device-local

WoS, Scopus, OpenDART, NAVER, KCI, and similar keys must use Smart Composer's
secret store:

- never write keys into `data.json`;
- never put keys in chat history;
- never sync keys through the Dropbox vault;
- never include keys in logs, reports, or error screenshots;
- show only a masked fingerprint for connection diagnostics.

### 14.4 Quota-aware routing

The model must not spend a scarce indexed-source call on every prompt.

Recommended behavior:

```text
@Web of Science or explicit SSCI/WoS intent
  -> use WoS

ordinary prose request
  -> no WoS call

broad question
  -> one count/top-50 request first
  -> ask before deep pagination
```

The UI should display:

```text
WoS Starter: 43 of 50 requests remaining today
```

If Clarivate does not expose a quota endpoint, Smart Composer can maintain a
local conservative counter and reconcile it with response headers/errors.

### 14.5 Source-aware writing

The model prompt must distinguish:

```text
Indexed in SSCI
```

from:

```text
Peer reviewed
```

and from:

```text
The full paper supports this claim
```

An index match alone establishes only that the returned record matched the
specified corpus and query at retrieval time.

## 15. Implementation Priority

### Phase A: installable without new connector code

1. Publish a KOSIS MCP preset.
2. Publish a Consensus MCP preset after a real Obsidian OAuth smoke test.
3. Keep Korean Law MCP as a user-entered connection with operator labeling.
4. Keep Asta optional and On demand.

### Phase B: Web of Science proof of concept

1. User registers a Clarivate developer application.
2. User requests the Web of Science Starter Free Trial Plan.
3. Store the key in SecretStorage.
4. Test a normal WOS query.
5. Test `edition=WOS+SSCI`.
6. Confirm quota headers and free-plan response fields.
7. Compare results with the Web of Science web UI.
8. Record a sanitized test fixture.

### Phase C: Research Sources connector

1. Implement WoS Starter with SSCI/SCI/AHCI/ESCI filters.
2. Add Crossref and OpenAlex enrichment.
3. Add retraction/editorial-status checks.
4. Add KCI and ScienceON.
5. Add RISS and NTIS.
6. Add OpenDART and NAVER API HUB.
7. Add Scopus only after institutional entitlement testing.

### Phase D: research workspace

1. Query decomposition.
2. Parallel source searches.
3. Deduplication and identifier merge.
4. Evidence table with source and coverage labels.
5. Retraction/correction warnings.
6. Citation-ready Markdown insertion.
7. Long-running research tasks through the background-task architecture.

## 16. Validation Checklist

### Web of Science

- Free Trial credentials are actually issued to the user's account.
- `X-ApiKey` succeeds from Obsidian desktop.
- `edition=WOS+SSCI` returns records.
- The same query is compared against Web of Science UI results.
- One request returns at most fifty records.
- Pagination consumes one request per page.
- Free Trial omits times-cited values as documented.
- Search can match abstract terms while returned data omits abstract text.
- Invalid editions and exhausted quotas produce actionable errors.
- The key never appears in synced files or logs.

### Consensus

- Automatic OAuth completes in Obsidian.
- Reconnect and refresh work after restart.
- Guest and Free-account result limits match current provider behavior.
- Search tool output remains below Smart Composer's durable tool-output limit.

### KOSIS

- A saved preset initializes without authentication.
- Tool review shows all ten tools.
- On-demand mention activates the connection.
- Result cards show table, unit, period, and official URL.

### Korean APIs

- KCI, ScienceON, RISS, NTIS, OpenDART, and NAVER use official endpoints.
- Each connector displays quota and operator.
- XML/SPARQL responses are parsed structurally.
- Unknown or missing fields remain unknown.

## 17. Known Unknowns

- Whether Clarivate's Free Trial Plan has an unpublished account lifetime or
  renewal policy.
- Whether the user's free key is entitled to every edition listed in the
  Swagger, including SSCI, before a live key test.
- Whether Hallym's subscription qualifies the user for the 5,000-request
  Institutional Member Plan.
- Whether Hallym can provide a Scopus institutional token for off-campus use.
- Whether Consensus automatic OAuth completes inside every supported Obsidian
  desktop environment.
- The stable public-access date and endpoint for Seoul's city-data MCP.
- Current production quotas for each Korean public API at implementation time.
- Whether Asta publishes a stable anonymous quota and improves the observed
  latency.
- Whether Google releases a public Scholar Labs or Literature Insights API.

These must remain validation tasks, not product claims.

## 18. Rejected Approaches

### Treat every paper-search MCP as equally authoritative

Rejected. Discovery quality, index provenance, and claim verification are
different properties.

### Call WoS Starter a full-text SSCI reader

Rejected. Starter searches indexed metadata fields and returns basic metadata
and links. It does not return the paper body.

### Paste a WoS REST URL into the MCP settings dialog

Rejected. REST plus `X-ApiKey` is not MCP.

### Scrape Google Scholar

Rejected because of the lack of an official public API, robots/terms boundary,
fragility, and inability to present the result as an official S-grade
integration.

### Sync research API keys in the vault

Rejected. The user's vault is Dropbox-based, and credentials must remain
device-local.

### Enable financial trading MCP tools in Auto

Rejected. Read and write capabilities have materially different risk.

## 19. Sanitized Live Tests Performed

The investigation performed these non-secret probes:

1. Downloaded and inspected the official Web of Science Starter OpenAPI
   definition.
2. Confirmed the `edition` parameter and the explicit `SSCI` value.
3. Confirmed the `X-ApiKey` header scheme and one-to-fifty result page size.
4. Initialized the public KOSIS MCP and enumerated ten tools.
5. Ran a KOSIS local-search request and confirmed an official table result.
6. Probed Consensus MCP and confirmed OAuth protected-resource metadata, PKCE,
   and dynamic client registration.
7. Initialized Asta anonymously and enumerated tools; two later relevance
   searches timed out.

No private paper text, vault content, OAuth token, API key, bearer token,
client secret, R2 credential, or personal identifier was copied into this
report.

## 20. Free-User Master Shortlist

The free-user recommendation must cover ordinary web research, Korean official
facts, law, academic research, corporate disclosures, and technical writing.
It must also distinguish sources that work in Smart Composer 2.4 today from
free APIs that still need native connector code.

### 20.1 Best free connections available now

| Priority | Source | Free boundary verified | Best role | Routing |
| --- | --- | --- | --- | --- |
| S | KOSIS official MCP | No authentication on the published pilot endpoint | Korean national statistics | On demand |
| S | Korean Law MCP | Current user-tested access; operator policy can change | Korean statutes and legal verification | On demand |
| S | Consensus MCP | Guest and Free-account tiers | AI-assisted peer-reviewed paper discovery | On demand |
| A | Tavily | 1,000 credits/month, no card | General web discovery and extraction | Auto, as the only general search provider |
| A | Brave Search | Approximately 1,000 Search requests/month from recurring credit | Independent web/news search | Alternative to Tavily; do not enable both by default |
| A | Asta Scientific Corpus | Anonymous MCP access observed; quota undocumented | Broad scholarly graph and citation discovery | Optional, On demand |
| A | Microsoft Learn MCP | Public official documentation | Microsoft technical claims | On demand |
| A | Context7 | Free/public access observed; provider policy can change | Current software-library documentation | On demand |
| B | GitHub MCP read-only | Free account/public-repository access | Source, release, issue, and code verification | On demand |

KOSIS remains one of the strongest free connections in the entire shortlist,
not merely a Korean-language convenience:

- it is an official statistical source;
- it exposes table, indicator, metadata, region, and validation tools;
- it requires no authentication on the investigated endpoint;
- it can return traceable official KOSIS tables.

However, its ten tools nearly consume Smart Composer Auto routing's twelve-tool
budget. It belongs in **On demand**, activated through an explicit connection
mention or clear statistical intent.

### 20.2 Strongest free APIs requiring connector work

| Priority | Source | Free boundary verified | Best role |
| --- | --- | --- | --- |
| S | Web of Science Starter | 50 requests/day; one request/second; Free Trial available to anyone | Official WoS Core Collection and SSCI edition search |
| S | Crossref + Retraction Watch | Public API without signup | DOI, correction, expression-of-concern, and retraction verification |
| S | OpenAlex | Free API key and published daily budget | Scholarly graph, citations, institutions, and open-access enrichment |
| S | KCI | Official application plus public OAI-PMH paths | Korean academic index and citation/linkage data |
| S | ScienceON | Official Open API | Korean science-and-technology literature |
| S | RISS Linked Data | Public SPARQL endpoint | Korean theses, articles, books, and linked bibliographic data |
| S | NTIS | Official application/approval | Korean national R&D projects and outputs |
| S | OpenDART | Free key with a high practical request boundary | Korean corporate disclosures and financial statements |
| S | NAVER API HUB | High temporary free monthly allowance | Korean news, web, blog, and local discovery |
| A | PubMed/NCBI | Three requests/second without key; ten with free key | Biomedical literature and metadata |
| A | Europe PMC | Public developer APIs | Life-science literature and open full text |
| A | World Bank Data360 | Official public-data access; adapter required | International development statistics |
| B | Google Fact Check Tools | Project-specific quota | Discovery of published ClaimReview fact checks |

These are not weaker because they are not MCP. Several are stronger evidence
sources than general search MCPs. They simply require a native REST, XML,
SPARQL, or custom-header connector.

### 20.3 Recommended free default preset

For a non-technical user who wants the broadest practical coverage:

```text
Auto
  Tavily

On demand
  KOSIS official MCP
  Korean Law MCP
  Consensus MCP

Optional On demand
  Asta Scientific Corpus
  Context7
  Microsoft Learn
  GitHub read-only
```

Rules:

- Use only one general web search provider in Auto.
- Choose Brave instead of Tavily when an independent search/news index matters
  more than extraction and research workflows.
- Keep KOSIS, Korean Law, Consensus, and Asta On demand.
- Enable technical-documentation sources only for the work that needs them.
- Do not expose write-capable GitHub or financial tools in this preset.

### 20.4 Free preset after Research Sources connectors ship

The strongest all-purpose free stack becomes:

```text
General Korean/current discovery
  NAVER API HUB + Tavily or Brave

Korean official facts
  KOSIS + Korean Law + OpenDART + NTIS

Academic discovery
  Consensus + Asta

Curated index confirmation
  Web of Science Starter: WOS+SSCI
  KCI + ScienceON + RISS

Evidence integrity
  Crossref/Retraction Watch + OpenAlex

Biomedical specialization
  PubMed + Europe PMC
```

This is stronger than installing many generic search MCPs because each source
has a distinct role:

```text
Web search discovers.
Official databases verify.
Academic indexes establish corpus membership.
Integrity services detect corrections and retractions.
The chat model writes.
```

### 20.5 Free-user priority for implementation

1. KOSIS preset and Consensus OAuth smoke test.
2. Web of Science Starter connector with SSCI filtering.
3. Crossref/Retraction Watch and OpenAlex enrichment.
4. KCI, ScienceON, and RISS Korean Research preset.
5. OpenDART, NTIS, and NAVER Korean Facts preset.
6. PubMed and Europe PMC biomedical preset.

All quota statements in this section are a 2026-07-26 snapshot. "Free Trial,"
"temporary free," recurring credits, and anonymous MCP access must not be
marketed as permanently free.

## 21. Final Recommendation

The strongest realistic Smart Composer research stack is:

```text
Korean official facts
  KOSIS MCP + Korean Law MCP
  later: OpenDART + NAVER + NTIS

Korean academic research
  KCI + ScienceON + RISS

Global semantic discovery
  Consensus MCP + optional Asta

Curated index confirmation
  Web of Science Starter with WOS+SSCI
  later: Scopus after institutional validation

Evidence integrity
  Crossref/Retraction Watch + OpenAlex
  PubMed/Europe PMC for biomedical work
  optional premium scite
```

Web of Science Starter is the highest-priority new proof of concept because it
combines:

- official Clarivate operation;
- explicit SSCI edition filtering;
- a published personal free tier;
- a small, safe tool surface;
- high value for academic writing;
- manageable daily quota for interactive use.

The correct product claim is:

> Smart Composer can search Web of Science Starter within the SSCI edition,
> return traceable indexed records, enrich them through DOI and
> research-integrity sources, and help write a cited synthesis.

It must not claim:

> Smart Composer read every matching paper in full or proved the paper's
> conclusions merely because the record was indexed in SSCI.
