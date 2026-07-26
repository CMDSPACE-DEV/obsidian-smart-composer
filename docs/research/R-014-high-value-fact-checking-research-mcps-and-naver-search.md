# R-014: High-Value Fact-Checking and Research MCPs, plus NAVER Search

> [!IMPORTANT]
> **Status: Verified investigation**
>
> **Planning use: Mandatory**
>
> This report records the 2026-07-26 investigation of research and
> fact-checking sources that can strengthen Smart Composer 2.4.0. It separates
> MCP connections that work with the current product from official data
> services that require a future native connector. It also records NAVER's
> ongoing Search API migration so a future release does not implement an
> already-retiring contract.

> [!NOTE]
> **2026-07-26 follow-up:** R-015 extends this report with Korean official MCPs,
> Korean academic APIs, Web of Science/SSCI, Scopus, and Google Scholar-like
> research workflows. It also confirms the current free boundaries as
> approximately 1,000 Brave Search requests per month and 1,000 Tavily credits
> per month, not 2,000 fixed Tavily searches. For those specific topics, use
> [R-015](R-015-korean-official-mcps-and-scholarly-index-connectors.md).

## 1. Executive Decision

Smart Composer should not enable a large undifferentiated collection of search
MCPs. The strongest writing and fact-checking workflow uses two layers:

1. **Discovery**
   - Find potentially relevant pages, papers, and current reporting with one
     general search provider.
   - Recommended starting choices: **Exa** or **Tavily**.
   - **Brave Search** is a strong advanced/local alternative, especially for
     an independent web and news index.
2. **Verification against an authoritative source**
   - Verify the discovered claim against an official legal, academic,
     technical, statistical, or publisher source.
   - Recommended current MCPs: **Korean Law MCP**, **Asta Scientific Corpus**,
     **Microsoft Learn MCP**, **Context7**, and read-only **GitHub MCP** for
     software claims.
   - Recommended future native connectors: **NAVER API HUB Search**,
     **Crossref + OpenAlex + NCBI/PubMed**, **Google Fact Check Tools**, and
     **World Bank Data360**.

The practical starter profile is:

```text
Korean factual writing:
  Korean Law MCP        -> On demand
  Exa                    -> Auto
  Asta Scientific Corpus -> On demand

Technical writing:
  Exa or Tavily          -> Auto
  Microsoft Learn or Context7 -> On demand
  GitHub read-only       -> On demand
```

This arrangement respects Smart Composer 2.4.0's automatic routing budget of
three connections and twelve tools. It avoids sending every prompt to every
external service and makes the source role visible:

```text
Search result -> candidate evidence
Official source -> verification evidence
Model synthesis -> prose, not a new source
```

### Immediate recommendations

| Priority | Connection | Role | Current 2.4.0 fit |
| --- | --- | --- | --- |
| A | Exa | General web discovery and page retrieval | Direct remote, no authentication |
| A | Asta Scientific Corpus | Paper discovery, metadata, citations, snippets | Direct remote, no authentication |
| A | Microsoft Learn | Official Microsoft product documentation | Direct remote, no authentication |
| A | Tavily | Web search, extraction, mapping, and research | Direct remote with OAuth or bearer token |
| A | Context7 | Current software-library documentation | Direct remote with OAuth |
| B | Brave Search | Independent web, news, image, video, and local search | Local stdio with API key |
| B | GitHub MCP read-only | Repository source, releases, issues, and pull requests | Direct remote with minimum-scope PAT |
| C | World Bank Data360 | Official development indicators and metadata | Official server, but manual local sidecar |
| C | NAVER API HUB Search | Korean news/web/blog/local discovery | Native connector required |
| C | Research Sources connector | DOI, citation, retraction, and biomedical verification | Native connector required |
| C | Google Fact Check Tools | Find published ClaimReview fact checks | Native connector required |

`A`, `B`, and `C` are this report's product-priority classes. They are not
ratings assigned by the providers.

## 2. Scope and Evidence

### 2.1 Smart Composer baseline

Repository worktree:

```text
branch: codex/2.4-bulk-inline-edit
version: 2.4.0
commit: 888489a80472f11ad9474008a1476e2c853a66f3
minimum Obsidian: 1.11.4
```

Relevant mandatory reports:

- **R-010**: beginner-safe connection, authentication, discovery, and
  invocation UX;
- **R-011**: implemented MCP manager, security review, routing, task, and
  history contracts;
- **R-012**: desktop Node transport required for remote MCP servers that do
  not expose browser CORS headers;
- **R-013**: long tool results and document-scale writing workflows must be
  bounded, checkpointed, and truthful about provider limits.

Local source inspected:

- `src/types/mcp.types.ts`
- `src/core/mcp/mcpManager.ts`
- `src/core/mcp/McpToolTaskAdapter.ts`
- `src/core/mcp/desktopFetch.ts`
- `src/components/settings/modals/McpServerFormModal.tsx`
- related MCP settings, connection, routing, task, approval, and history tests

### 2.2 External-source standard

This report relies on:

- the provider's official product documentation;
- an official organization repository;
- an official government, intergovernmental, academic, or publisher API;
- sanitized live protocol tests against public endpoints.

Community MCP wrappers were not promoted merely because they appear in a
registry. The official Model Context Protocol server repository explicitly
distinguishes its small reference set from third-party/community servers, and
registry listing is not equivalent to a security or source-quality audit.

### 2.3 Meaning of source quality

This report uses the following internal rubric:

| Class | Meaning |
| --- | --- |
| S | The tool can return an institution's own primary or authoritative material for the claim domain |
| A | A reputable discovery/index layer whose individual result sources still require evaluation |
| B | Useful specialized evidence, but incomplete or dependent on repository/community quality |
| Deferred | Valuable service with no current beginner-safe Smart Composer connection |

Important boundaries:

- A search engine is never automatically an S-grade source.
- A scientific paper is evidence, not proof that its claims are true.
- A citation count is not a reliability score.
- A ClaimReview result is a published fact-checker's assessment, not an
  infallible truth oracle.
- An MCP tool schema describes an interface; it does not certify the server
  operator, returned content, or absence of prompt injection.

## 3. Verified Smart Composer 2.4.0 MCP Contract

### 3.1 Supported connection types

Smart Composer 2.4.0 supports:

- remote Streamable HTTP;
- remote legacy SSE compatibility;
- local stdio as an advanced desktop option;
- HTTPS for non-loopback remote endpoints;
- HTTP only for local loopback endpoints.

MCP execution is desktop-only even though the wider plugin is not declared
desktop-only.

### 3.2 Supported authentication

The connection form supports:

- automatic discovery/OAuth;
- no authentication;
- bearer token;
- OAuth client ID, client secret, and scope.

Bearer tokens, OAuth material, and sensitive local environment variables are
stored through Obsidian SecretStorage. Sensitive local variable names include
token, key, secret, password, authentication, and credential patterns.

### 3.3 Unsupported authentication shape

Remote connections do **not** currently expose arbitrary custom request
headers.

Consequences:

- an ordinary `Authorization: Bearer ...` service is supported;
- a service with OAuth discovery is supported;
- a service requiring `x-api-key` cannot use that higher-limit route directly;
- a service requiring two custom headers, such as NAVER API HUB, cannot be
  represented by the current generic remote form;
- putting a secret in a URL query string is technically possible for some
  providers but is not recommended because the URL is ordinary synchronized
  settings data rather than SecretStorage data.

### 3.4 Routing and context limits

Current routing modes:

- `Auto`
- `Always`
- `On demand`
- `Off`

`Auto` selects at most:

- three connections;
- twelve tools in total.

Explicit mention/on-demand selection can expose up to eighty tools. This is a
hard reason to keep large specialized servers such as Asta and GitHub on
demand instead of enabling every tool globally.

Invocation surfaces include:

- `@Connection`
- `/tools`
- `/connections`

### 3.5 Safety behavior

Before tools are exposed:

- the user scans/discovers the tool schema;
- the user reviews the schema and accepts its hash;
- changed schemas require review again;
- tools are classified as read, write, delete, or unknown;
- delete tools cannot be configured for automatic execution.

MCP results may contain text, resources, resource links, structured content,
images, and audio. The durable tool-result limit is 120,000 characters.

This is a strong host safety baseline, but schema review is not publisher
verification. A read-only search tool can still return malicious or false web
content.

## 4. Recommended MCPs That Work Now

### 4.1 Exa

#### Role

General web discovery and fetching. Exa is especially useful when a writing
prompt needs relevant pages rather than a manually chosen URL.

#### Official connection

```text
Name: Exa
Type: Remote URL
URL: https://mcp.exa.ai/mcp
Protocol: Streamable HTTP
Authentication: No authentication
Routing: Auto
```

Default public tools verified on 2026-07-26:

- `web_search_exa`
- `web_fetch_exa`

#### Free allowance and authentication

Exa's documented hosted MCP has a default remote route that does not require
an API key. Exa's API pricing also advertises signup credit and a recurring
free monthly credit allowance. At the price published during this
investigation, the recurring allowance was approximately sufficient for
1,428 base searches if used only for base search and not content retrieval.

Higher-limit MCP use accepts `x-api-key`. Smart Composer cannot currently
store and send that arbitrary header through the remote connection UI.
Advanced users can instead use Exa's local stdio package with
`EXA_API_KEY` stored as a secret environment variable.

#### Evidence quality

**A discovery layer.** The returned domain determines authority. Search
results should be followed to the original source before a factual statement
is finalized.

#### Live test

Sanitized public test:

```text
initialize: HTTP 200
server: exa-search-server 3.2.1
tools/list: web_search_exa, web_fetch_exa
unauthenticated web search: succeeded
```

No personal query, vault content, or secret was sent.

#### Verdict

**Best first general-search MCP for ease of setup.** Two tools fit comfortably
inside Auto routing, and the public endpoint requires no secret.

Official sources:

- [Exa MCP documentation](https://exa.ai/docs/reference/exa-mcp)
- [Exa API pricing](https://exa.ai/pricing?tab=api)

### 4.2 Tavily

#### Role

General web search, extraction, crawling/mapping, and research-oriented
retrieval.

#### Official connection

Preferred OAuth configuration:

```text
Name: Tavily
Type: Remote URL
URL: https://mcp.tavily.com/mcp/
Protocol: Streamable HTTP
Authentication: Automatic
Routing: Auto
```

Alternative:

```text
Authentication: Bearer token
Secret: Tavily API key
```

Do not place the key in the URL query string.

#### Free allowance

The official free plan documents 1,000 API credits per month without a credit
card. Current credit consumption depends on operation:

- basic search: one credit;
- advanced search: two credits;
- extraction: based on successfully extracted URLs and mode;
- research: materially more credits than a simple search.

The hosted MCP now requires an API key or OAuth. Older keyless setup examples
must not be treated as current.

#### Evidence quality

**A discovery and extraction layer.** Tavily can make source retrieval
convenient, but the authority remains with each returned publisher or primary
document.

#### Verdict

**Best alternative to Exa when extraction/research workflow matters.** Start
with either Exa or Tavily in Auto, not both, unless real usage demonstrates
that both indexes are needed for the same workflow.

Official sources:

- [Tavily MCP documentation](https://docs.tavily.com/documentation/mcp)
- [Tavily quickstart and free credits](https://docs.tavily.com/documentation/quickstart)
- [Tavily API credit accounting](https://docs.tavily.com/documentation/api-credits)

### 4.3 Asta Scientific Corpus

#### Role

Academic paper discovery, metadata lookup, citation traversal, author lookup,
and full-text snippet search over Ai2's scientific corpus.

#### Official connection

```text
Name: Asta Scientific Corpus
Type: Remote URL
URL: https://asta-tools.allen.ai/mcp/v1
Protocol: Streamable HTTP
Authentication: No authentication
Routing: On demand
```

Invoke explicitly:

```text
@Asta Scientific Corpus
```

#### Verified tools

Eight tools were exposed during the live test:

- `get_paper`
- `get_paper_batch`
- `get_citations`
- `search_authors_by_name`
- `get_author_papers`
- `search_papers_by_relevance`
- `search_paper_by_title`
- `snippet_search`

#### Free allowance and authentication

The public endpoint worked without a key. Ai2 documents an `x-api-key` route
for higher limits, but Smart Composer cannot currently configure this custom
remote header.

Ai2 describes the underlying corpus as more than 200 million normalized
papers with sparse/dense full-text search and graph discovery.

#### Evidence quality

**A-to-S bridge.** Ai2 is a reputable academic index and the tool can locate
primary papers, but the quality of each paper varies. Final verification
should check:

- DOI and publisher metadata;
- retractions, corrections, and expressions of concern;
- study design and sample;
- whether the cited text supports the exact claim;
- whether a newer systematic review supersedes the paper.

Ai2's own Asta publication acknowledges that retracted citations are not
eliminated completely. This is a useful reason to preserve Crossref and
publisher-status checks in a future workflow.

#### Live test

Sanitized public test:

```text
initialize: HTTP 200
server: Asta Scientific Corpus Tools 1.12.3
tools/list: eight tools
get_paper for DOI 10.1038/s41586-020-2649-2: succeeded
relevance search: exceeded a 30-second client test timeout twice
```

The successful DOI lookup returned the expected Nature paper metadata. The
search timeout is an operational caveat, not evidence that every search
fails.

#### Verdict

**Highest-value academic MCP that directly fits Smart Composer today.** Keep
it On demand because it consumes eight of Auto's twelve tool slots and search
latency can be variable.

Official sources:

- [Ai2 Asta MCP resource](https://allenai.org/asta/resources/mcp)
- [Ai2 Asta scientific corpus overview](https://allenai.org/blog/asta)
- [Ai2 Asta citation-quality discussion](https://allenai.org/blog/asta-citations)

### 4.4 Microsoft Learn MCP

#### Role

Official Microsoft, Azure, .NET, Power Platform, Windows, and related product
documentation and code samples.

#### Official connection

```text
Name: Microsoft Learn
Type: Remote URL
URL: https://learn.microsoft.com/api/mcp
Protocol: Streamable HTTP
Authentication: No authentication
Routing: On demand
```

Verified tools:

- `microsoft_docs_search`
- `microsoft_code_sample_search`
- `microsoft_docs_fetch`

#### Free allowance

Microsoft describes the endpoint as public and does not require
authentication. The documentation specifies fair-use behavior rather than a
fixed consumer quota.

#### Evidence quality

**S for Microsoft product behavior and current official documentation.**
It should not be used as a general web search or as an authority outside
Microsoft's product domain.

#### Live test

```text
initialize: HTTP 200
tools/list: three tools
microsoft_docs_search: succeeded
```

#### Verdict

**Install for Microsoft-heavy technical writing.** It is small, official,
keyless, and source-specific.

Official source:

- [Microsoft Learn MCP developer reference](https://learn.microsoft.com/en-us/training/support/mcp-developer-reference)

### 4.5 Context7

#### Role

Version-aware software-library documentation and code examples.

#### Official connection

Use the OAuth endpoint, not the custom-header endpoint:

```text
Name: Context7
Type: Remote URL
URL: https://mcp.context7.com/mcp/oauth
Protocol: Streamable HTTP
Authentication: Automatic
Routing: On demand
```

#### Free allowance

The investigated free plan included 1,000 API calls and OAuth/public
repository access. Pricing and quotas can change and must be rechecked before
shipping a preset.

The standard API-key endpoint requires a custom `CONTEXT7_API_KEY` header, so
it does not fit Smart Composer's current generic remote form. OAuth avoids
that mismatch.

#### Evidence quality

**A for current library documentation.** Context7 documents trust scores,
source versioning, prompt-injection scanning, and constrained tool inputs.
Those are useful safeguards, but developers should still verify a critical
claim against the library's own release notes or repository.

#### Verdict

**High value for coding and technical documentation; low relevance to general
news or academic fact-checking.**

Official sources:

- [Context7 client and OAuth configuration](https://context7.com/docs/resources/all-clients)
- [Context7 plans](https://context7.com/plans)
- [Context7 quality and safety design](https://upstash.com/blog/context7-quality-and-safety)

### 4.6 Brave Search MCP

#### Role

Independent web, local, place, image, video, news, summarization, and
LLM-context search.

#### Official local connection

The official Brave server is currently most straightforward as local stdio:

```text
Name: Brave Search
Type: Local command
Command: npx
Arguments:
  - -y
  - @brave/brave-search-mcp-server
  - --transport
  - stdio
Secret environment:
  BRAVE_API_KEY=<stored in Obsidian SecretStorage>
Routing: On demand
```

The first launch can take longer while `npx` downloads the package.

#### Free allowance

At the investigated price:

- Search: USD 5 per 1,000 requests;
- recurring free credit: USD 5 per month;
- approximately 1,000 search requests per month if used only for that search
  product;
- published rate limit: 50 requests per second.

#### Evidence quality

**A discovery layer.** Brave's own index can diversify results relative to
other search providers, including current news, but returned publishers still
determine authority.

#### Verdict

**Strong advanced alternative for users willing to issue a key and run local
stdio.** It is not the easiest first-time setup and its broad tool surface
should remain On demand.

Official sources:

- [Official Brave Search MCP server](https://github.com/brave/brave-search-mcp-server)
- [Brave Search API pricing](https://api-dashboard.search.brave.com/documentation/pricing)

### 4.7 GitHub MCP Server in Read-Only Mode

#### Role

Primary repository evidence:

- source files;
- tags and releases;
- issues and pull requests;
- commit history;
- repository metadata.

#### Official remote connection

Use GitHub's URL-level read-only mode because Smart Composer cannot send
`X-MCP-Readonly`:

```text
Name: GitHub Read Only
Type: Remote URL
URL: https://api.githubcopilot.com/mcp/x/all/readonly
Protocol: Streamable HTTP
Authentication: Bearer token
Secret: a minimum-scope fine-grained GitHub PAT
Routing: On demand
```

GitHub documents that `/readonly` disables write tools even if a selected
toolset contains them. The default full server otherwise exposes several
toolsets and can consume significant context.

#### Free allowance

The remote service is available through GitHub accounts under GitHub's
current product policy. Individual tools can still depend on repository
access, token permissions, API limits, or paid GitHub features. This report
does not label the service unlimited.

#### Evidence quality

**S for the contents and history of the repository being examined.**
Repository prose, issues, and user comments are not automatically authoritative
about facts outside that repository.

#### Verdict

**Install only for software-source verification.** Read-only mode and a
fine-grained minimum-scope PAT are mandatory recommendations.

Official sources:

- [Official GitHub MCP server](https://github.com/github/github-mcp-server)
- [GitHub MCP server configuration and read-only URL](https://github.com/github/github-mcp-server/blob/main/docs/server-configuration.md)

## 5. Official Sources That Need Product Work

### 5.1 World Bank Data360 MCP

#### Role

Official indicators, time series, code lists, disaggregation dimensions,
metadata, methodology, and limitations from the World Bank.

Official tools include:

- `data360_search_indicators`
- `data360_get_data`
- `data360_get_metadata`
- `data360_get_disaggregation`
- `data360_find_codelist_value`
- `data360_list_indicators`

#### Source quality

**S for World Bank-published indicators and their metadata.** The user must
still read methodology, coverage, revisions, and limitations before comparing
countries or years.

#### Current deployment problem

The official `worldbank/data360-mcp` repository requires a developer-style
local setup:

- Python 3.11 or later;
- `uv` or Python dependency installation;
- clone the repository;
- start an HTTP server;
- connect Smart Composer to `http://localhost:8000/mcp`.

The underlying World Bank Indicators API requires no API key and exposes
nearly 16,000 time series, but no beginner-ready hosted MCP endpoint or
one-click package was verified.

#### Decision

Do not present this as an easy connection yet. Future options:

1. a plugin-managed, pinned local sidecar with integrity checks;
2. a small native read-only World Bank connector;
3. a future official hosted endpoint, if the World Bank publishes one.

Official sources:

- [World Bank Data360 MCP repository](https://github.com/worldbank/data360-mcp)
- [World Bank Indicators API authentication](https://datahelpdesk.worldbank.org/knowledgebase/articles/889392)
- [World Bank API basic call structure](https://datahelpdesk.worldbank.org/knowledgebase/articles/898581-api-basic-call-structures)

### 5.2 Research Sources Native Connector

No publisher-operated Crossref, OpenAlex, or NCBI MCP suitable for direct
recommendation was verified. Random community wrappers would add a supply-chain
dependency without improving the authority of the underlying API.

A future plugin-local, read-only `Research Sources` connector should combine
the official APIs directly.

#### Recommended roles

| Service | Role | Current free boundary verified |
| --- | --- | --- |
| Crossref | DOI, publication metadata, corrections, retractions, relations | Public REST without signup; public/polite rate policies |
| OpenAlex | Paper/author/institution discovery and citation graph | API key required; free daily budget and published request limits |
| Semantic Scholar | Paper, author, citation, and recommendation discovery | Most endpoints can use a shared unauthenticated pool; individual keys have published starting limits |
| NCBI E-utilities/PubMed | Biomedical literature and indexed metadata | Three requests/second without key, ten with free key |

#### Verified limits at investigation time

- Crossref public pool: five requests/second and concurrency one.
- Crossref polite pool: ten requests/second and concurrency three.
- OpenAlex: API key required, free USD 1/day budget, approximately 1,000
  searches/day under its documented search pricing, and free singleton DOI
  lookups.
- Semantic Scholar: shared unauthenticated traffic can reach a published
  shared ceiling; individual introductory keys begin at one request/second.
- NCBI: three requests/second without a key and ten requests/second with a
  free API key, with batching and identification guidance.

These numbers are service policies, not a promise that every query will
succeed or that they will remain unchanged.

#### Fact-check sequence

```text
Asta/OpenAlex/Semantic Scholar -> discover candidate papers
Crossref -> verify DOI, publisher metadata, updates, and relations
NCBI/PubMed -> verify biomedical indexing and publication type
Publisher page/full paper -> read the actual methods and claim
Retraction/correction check -> confirm current status
Smart Composer -> write a cited synthesis
```

#### Decision

Implement provider-specific read-only adapters with:

- SecretStorage for keys;
- service-specific rate limiting and backoff;
- DOI normalization and deduplication;
- retraction/correction badges;
- primary source links;
- explicit metadata-versus-full-text labels;
- no bulk paper-body retention by default.

Official sources:

- [Crossref REST API access and authentication](https://crossref.org/documentation/retrieve-metadata/rest-api/access-and-authentication/)
- [OpenAlex API authentication and free budget](https://developers.openalex.org/api-reference/authentication)
- [Semantic Scholar Academic Graph API](https://www.semanticscholar.org/product/api)
- [NCBI E-utilities usage guidelines](https://www.ncbi.nlm.nih.gov/books/NBK25497/)

### 5.3 Google Fact Check Tools Connector

#### Role

Search fact-checks published using ClaimReview markup. Returned material can
include:

- reviewed claim text;
- claimant;
- ClaimReview publisher;
- review URL and title;
- review date;
- textual rating;
- language.

#### Current deployment problem

The official REST API requires a Google API key. No official Google-operated
MCP endpoint was verified, and the public documentation does not promise one
fixed universal free quota. Quotas are project-specific and visible in Google
Cloud.

#### Decision

Implement a future native read-only connector:

```text
search_fact_checked_claims(query, language?, pageSize?)
```

The UI must say `Published fact-checks`, not `Verified truth`. It should expose
the publisher, review date, original URL, and rating verbatim enough for the
user to assess the source.

Official sources:

- [Google Fact Check Tools API](https://developers.google.com/fact-check/tools/api)
- [Google Fact Check Tools REST reference](https://developers.google.com/fact-check/tools/api/reference/rest/)
- [Claims search method](https://developers.google.com/fact-check/tools/api/reference/rest/v1alpha1/claims/search)

## 6. NAVER Search: Current Migration and Product Boundary

### 6.1 The old 25,000/day statement is no longer the whole contract

The legacy NAVER Developers Search API documented:

- 25,000 calls per day, shared by one client ID;
- news endpoint:
  `https://openapi.naver.com/v1/search/news.json`;
- `display` up to 100 results;
- `start` up to 1,000;
- `sort=sim` or `sort=date`;
- result metadata including title, original link, NAVER link, description,
  and publication date.

For one person's ordinary Smart Composer use, 25,000 calls/day is effectively
far beyond realistic manual writing traffic. However, NAVER announced a
migration that changes the correct product target.

### 6.2 2026 transition dates

NAVER's official notice published on 2026-07-20 states:

- new Search API applications in the legacy NAVER Developers Center stop
  after **2026-07-30 24:00 KST**;
- existing legacy Search API users can continue until
  **2027-06-30 24:00 KST**;
- legacy shopping, book, and academic search endpoints terminate for all users
  on **2026-07-31**.

A new Smart Composer integration must therefore target **NAVER API HUB**, not
build its main architecture around the retiring Developers Center contract.

Official sources:

- [NAVER Developers migration notice](https://developers.naver.com/notice/article/32973)
- [Legacy NAVER News Search API](https://developers.naver.com/docs/serviceapi/search/news/news.md)

### 6.3 NAVER API HUB contract verified on 2026-07-26

The current API HUB documentation publishes:

- base domain:
  `https://naverapihub.apigw.ntruss.com`;
- news path:
  `/search/v1/news`;
- authentication headers:
  `X-NCP-APIGW-API-KEY-ID` and
  `X-NCP-APIGW-API-KEY`;
- combined Search API monthly quota: **775,000 calls per API key**;
- per-key rate limit: **50 requests/second**;
- Data Lab Search Trend: **50,000 calls/month**;
- Data Lab Shopping Insight: **50,000 calls/month**.

The 775,000 monthly pool averages roughly 25,000 calls per day, but it is a
monthly shared quota rather than a reset-every-day promise.

The API HUB documentation describes the current period as a temporary free
trial and says a future paid transition will be announced separately. The
product must therefore say:

```text
Current free trial with a high monthly quota
```

It must not say:

```text
Permanently free or unlimited
```

Official sources:

- [NAVER API HUB overview](https://guide.ncloud-docs.com/docs/apihub-overview)
- [NAVER API HUB migration guide](https://guide.ncloud-docs.com/docs/apihub-migration)
- [NAVER API HUB API overview](https://api.ncloud-docs.com/docs/naver-api-hub-overview)

### 6.4 Why the current MCP form cannot connect it

NAVER API HUB requires two named custom headers. Smart Composer's generic
remote MCP form supports bearer/OAuth but not arbitrary custom headers.
Moreover, NAVER Search is REST, not MCP.

Therefore:

- do not paste keys into a URL;
- do not create a fake MCP URL field;
- do not store the keys in synchronized plugin settings;
- do not rely on an unverified third-party NAVER wrapper.

### 6.5 Recommended native connector

Add a first-class `NAVER Search` integration, separate from MCP connections.

Suggested tools:

```ts
search_naver_news({
  query,
  sort?: 'relevance' | 'date',
  display?: number,
  start?: number
})

search_naver_web({
  query,
  display?: number,
  start?: number
})

search_naver_encyclopedia({
  query,
  display?: number,
  start?: number
})

get_naver_search_trends({
  groups,
  startDate,
  endDate,
  timeUnit,
  demographics?
})
```

Initial scope should exclude retiring book and academic endpoints.

#### Storage

- store API key ID and API key separately in Obsidian SecretStorage;
- store only secret references in settings;
- never include either value in logs, chat history, error messages, or synced
  JSON;
- provide `Test connection` and masked key replacement.

#### Retrieval behavior

- default to one call per explicit search;
- permit at most one to three automatic calls per user prompt;
- clamp `display` to 100 and `start` to 1,000;
- deduplicate by canonical/original URL;
- retain publisher/source label, original link, NAVER link, snippet, and date;
- prefer the original publisher URL for citations;
- show `Search snippet, article body not read` unless a second extraction step
  actually fetched the article;
- perform full-page extraction only for selected results and subject to the
  publisher's terms and technical access controls.

#### Quota UX

- monthly and optional daily user cap;
- local call counter with reset period;
- warnings at configurable thresholds such as 70, 90, and 100 percent;
- per-tool and per-conversation usage details;
- no automatic crawl merely because the quota is large.

#### Terms boundary

The legacy NAVER API terms restrict unauthorized storage, alteration,
redistribution, and rights-infringing use of results. Search results also do
not provide full news article bodies. The integration should:

- store only what is required for the active result/history contract;
- cite the original source;
- avoid building a permanent article corpus by default;
- avoid representing snippets as complete article evidence;
- avoid scraping or redistributing full text without a lawful basis.

Official source:

- [NAVER API terms](https://developers.naver.com/products/terms/)

## 7. Recommended Source Profiles

### 7.1 Korean law and policy writing

```text
Korean Law MCP       On demand   Primary statute/legal source
Exa                  Auto        Find official notices and current pages
Asta                 On demand   Find supporting research when relevant
NAVER News           Future      Discover Korean current reporting
```

Workflow:

1. use NAVER/Exa to identify the current issue and original reporting;
2. use Korean Law MCP to retrieve the exact statute or legal provision;
3. use the responsible ministry, court, assembly, or official announcement for
   policy and procedural claims;
4. use Asta only when a scientific or scholarly claim is material;
5. write with separate citations for law, policy, evidence, and reporting.

### 7.2 Academic and research writing

```text
Exa or Tavily        Auto        Discover papers and official pages
Asta                 On demand   Scientific corpus and citation graph
Research Sources     Future      Crossref/OpenAlex/NCBI validation
```

Do not enable Asta, a future OpenAlex connector, Semantic Scholar, and several
community paper-search wrappers as parallel automatic searches. They overlap,
consume context, and can create a false impression of independent
corroboration when they index the same paper.

### 7.3 Technical documentation

```text
Exa or Tavily        Auto        General discovery
Microsoft Learn      On demand   Official Microsoft docs
Context7             On demand   Version-aware library docs
GitHub read-only     On demand   Primary source/release/issue evidence
```

For a software claim, prefer:

```text
official product docs
-> release notes
-> source/tag
-> issue or pull request
-> third-party article
```

### 7.4 Statistics and development data

```text
World Bank Data360   Future/elevated setup
Official national statistics APIs or portals
Exa/Tavily only for discovery
```

Every numeric answer should preserve:

- indicator definition;
- unit;
- geography;
- date/period;
- revision or update date;
- methodology/limitations;
- source URL.

## 8. Product Recommendations for the Next MCP Update

### 8.1 P0: publish connection recipes

No architecture change is required to document and test:

- Exa;
- Tavily OAuth;
- Asta;
- Microsoft Learn;
- Context7 OAuth;
- Brave local stdio;
- GitHub read-only.

Each recipe should contain:

- official publisher;
- exact endpoint;
- authentication selection;
- recommended routing;
- source role;
- privacy warning;
- last verified date.

### 8.2 P1: curated verified connection catalog

Add a beginner-facing catalog above `Add connection`:

```ts
type VerifiedConnectionPreset = {
  id: string
  publisher: string
  officialDomains: string[]
  endpoint: string
  transport: 'streamable-http' | 'stdio'
  auth: 'none' | 'automatic' | 'bearer' | 'local-secret-env'
  recommendedRouting: 'auto' | 'on-demand'
  sourceRole: 'discovery' | 'primary' | 'specialist'
  lastVerifiedAt: string
  documentationUrl: string
  warnings: string[]
}
```

Requirements:

- endpoint domains are locked for presets;
- redirect destinations are validated;
- the user still reviews discovered tools;
- a publisher preset is versioned separately from the server's tool-schema
  review hash;
- presets never contain secrets;
- a changed endpoint or authentication contract disables one-click setup until
  reverified;
- registry inclusion alone cannot create a `Verified` badge.

### 8.3 P2: source-aware answer metadata

Tool results and the final answer should distinguish:

- discovery result;
- official primary source;
- academic paper;
- metadata/index record;
- published fact check;
- model inference.

Recommended source card fields:

```ts
type ResearchEvidence = {
  title: string
  url: string
  publisher?: string
  sourceClass:
    | 'official-primary'
    | 'academic-primary'
    | 'index-metadata'
    | 'news-report'
    | 'fact-check-review'
    | 'general-web'
  publishedAt?: string
  updatedAt?: string
  retrievedAt: string
  supportsClaim?: string
  caveats?: string[]
}
```

This should not automatically assign truth. It makes the evidence chain
inspectable.

### 8.4 P3: native read-only source connectors

Priority:

1. NAVER API HUB Search;
2. Crossref/OpenAlex/NCBI `Research Sources`;
3. Google Fact Check Tools;
4. World Bank Data360.

Provider-specific connectors are preferable to a beginner-facing generic
arbitrary-header form because:

- secrets receive correct labels and storage;
- rate limits can be enforced;
- result schemas can be normalized;
- official domains can be pinned;
- legal/terms warnings can be provider-specific;
- write-capable or unsafe headers are not exposed as a universal escape hatch.

An advanced generic custom-header feature may still be considered later, but
every sensitive header value must be a SecretStorage reference. It must never
permit plaintext secrets in synchronized connection JSON.

### 8.5 P4: source-verification workflow

Add a user-invoked mode such as:

```text
/fact-check
```

or:

```text
Verify claims
```

Suggested behavior:

1. extract atomic claims from selected text;
2. classify each claim as legal, current event, academic, technical,
   statistical, or general;
3. route only to appropriate sources;
4. preserve query and source history;
5. show supported, contradicted, mixed, outdated, or insufficient evidence;
6. require the final prose to cite the evidence rather than hide tool results;
7. never rewrite `insufficient evidence` into confident prose.

This workflow should remain read-only by default.

## 9. Safety and Privacy Rules

### 9.1 External disclosure

Every MCP query can disclose the query text and selected context to:

- the MCP server operator;
- the final chat-model provider;
- linked web publishers when pages are fetched.

Do not send an entire private note merely to search for one fact. Extract the
minimum query needed.

### 9.2 Prompt injection

Web pages, papers, repository issues, and MCP resource text are untrusted
content. They may contain instructions aimed at the model.

Rules:

- tool content is evidence, not instruction;
- external text cannot change approval or tool-routing policy;
- external text cannot request secrets;
- links and resources remain data;
- write/delete tools are never selected solely because fetched content says
  to use them.

### 9.3 Least privilege

- prefer no-auth public endpoints for public read-only data;
- use OAuth when it avoids storing broad long-lived keys;
- use fine-grained minimum-scope tokens;
- use read-only GitHub URL mode;
- keep specialist tools On demand;
- disable connections not used in a workflow;
- re-review schemas after a provider change.

### 9.4 Source freshness

Every curated preset and quota statement needs:

- `lastVerifiedAt`;
- a documentation link;
- a revalidation interval;
- visible degradation when verification expires.

Free tiers, quotas, endpoints, and OAuth contracts are temporally unstable.

## 10. Rejected or Deferred Candidates

The investigation deliberately does not recommend:

- arbitrary community MCP search wrappers with no official operator or
  reproducible release;
- registry entries as proof of safety;
- multiple overlapping general-search MCPs enabled in Auto;
- paper indexes as automatic proof of claim validity;
- a third-party NAVER wrapper that receives the user's API keys;
- retiring NAVER Book or Academic search endpoints;
- a beginner-facing arbitrary-header editor that saves secrets in plain JSON;
- bulk news crawling because the quota appears large;
- services whose only verified setup requires exposing a key in a URL;
- write-capable GitHub tools for ordinary fact-checking;
- an official-source label for content merely discovered by Exa, Tavily, or
  Brave.

## 11. Verification Performed

### Smart Composer

- inspected the 2.4.0 MCP types, settings modal, manager, desktop transport,
  task adapter, routing, review, and SecretStorage contracts;
- confirmed remote custom headers are not represented;
- confirmed Auto's three-connection/twelve-tool budget;
- confirmed explicit exposure limit and durable tool-result limit;
- re-read R-010, R-011, R-012, and R-013.

### Public MCP protocol tests

Without authentication or private input:

- Exa initialize, tool discovery, and web search succeeded;
- Microsoft Learn initialize, tool discovery, and documentation search
  succeeded;
- Asta initialize, eight-tool discovery, and DOI metadata lookup succeeded;
- Asta relevance search exceeded the bounded client timeout during two test
  attempts.

### Documentation verification

Official provider documentation was used for:

- endpoint and authentication contracts;
- current free-tier or public-access statements;
- source scope;
- rate limits and quotas where publicly specified;
- NAVER migration dates;
- read-only GitHub URL configuration.

## 12. Known Unknowns

- Whether Exa's no-key hosted MCP free policy will remain unchanged.
- Whether Tavily OAuth completes successfully in every Obsidian desktop
  environment and account region.
- Asta's practical unauthenticated search latency and rate limits under normal
  Korean-language research workloads.
- Whether the World Bank will publish a managed Data360 MCP endpoint.
- NAVER API HUB's future paid pricing after the temporary free trial.
- The exact product/legal retention policy appropriate for NAVER snippets in
  chat history.
- Whether Google Fact Check's project quota is sufficient for a default
  connector without user-configured limits.
- Which retraction/correction service should complement Crossref for the
  strongest research-status workflow.
- Whether future mobile Obsidian MCP support can safely reproduce desktop
  transport, OAuth, and secret contracts.

These are validation tasks, not established capabilities.

## 13. Release Gate for Any Future Preset or Connector

Before a provider appears as `Verified` in Smart Composer:

1. confirm operator identity and official domain;
2. confirm endpoint and transport;
3. confirm authentication and secret storage;
4. run sanitized initialize and tool-discovery tests;
5. run one representative read-only call;
6. inspect every tool's schema and risk classification;
7. test timeout, rate limit, authentication failure, and schema change;
8. document source role and non-authoritative boundaries;
9. record quota/pricing date;
10. verify no secret appears in settings, logs, history, or error text;
11. test Auto versus On-demand tool budgets;
12. update this report or add a superseding report.

## 14. Final Recommendation

The next update should not market Smart Composer as having “many MCPs.” It
should market a small, explainable research stack:

```text
Find broadly.
Verify narrowly.
Show where every claim came from.
```

Recommended default progression:

1. keep Korean Law MCP as the verified legal baseline;
2. add Exa as the easiest general discovery connection;
3. add Asta for paper research, explicitly invoked;
4. add Microsoft Learn or Context7 only when the writing domain requires it;
5. add Tavily or Brave as an alternative general-search provider, not an
   automatic duplicate;
6. build NAVER API HUB as a first-class secret-safe Korean search connector;
7. build a read-only Research Sources connector for Crossref, OpenAlex, and
   NCBI;
8. add source-class metadata and a transparent fact-check workflow.

This combination is materially more useful than a long MCP marketplace list:
it covers Korean law, current web discovery, papers, official technical
documentation, primary code, Korean news discovery, and official statistics
without pretending that one search index can verify every kind of fact.

## 15. Privacy Statement

No personal vault note, Korean Law MCP secret, OAuth token, API key, NAVER
credential, or private query was read, transmitted, or recorded during this
investigation. Live tests used public endpoints and non-sensitive technical
queries. The report contains endpoint URLs and secret variable names only,
never secret values.
