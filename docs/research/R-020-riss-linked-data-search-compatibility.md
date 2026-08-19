# R-020: RISS Linked Data Search Compatibility

## Status

- Verified: 2026-07-27
- Implemented target: Smart Composer 2.5.3
- Mandatory for future RISS, Korean Academic, and Research Connections changes

## Trigger

RISS connected successfully and `research_riss_search` completed without a
transport error, but repeated searches for common terms such as `청년`,
`고용`, and `청년 실업` returned no records. The same terms visibly have
matching theses in RISS, so a green tool-call check mark was misleading.

## Root Cause

The connection and public endpoint were healthy. The original adapter assumed
modern SPARQL and conventional JSON behavior that this legacy endpoint does not
provide:

1. The adapter used SPARQL 1.1 `CONTAINS(LCASE(...))`. The RISS endpoint
   silently returned `조회 결과가 없습니다.` instead of a syntax or
   compatibility error.
2. A three-argument, case-insensitive `regex(..., "i")` probe produced the same
   false empty result.
3. SPARQL 1.0 `FILTER regex(?title, "청년")` returned current records.
4. RISS uppercases selected variable names in its response (`WORK`, `TITLE`,
   `CREATOR`, and so on), while the original parser read lowercase keys only.
5. Non-empty JSON output was observed with adjacent binding objects that were
   not valid JSON. The XML result format was well-formed and preserved URI and
   typed-literal values.
6. The original result mapping used `dc:creator` and `dc:date`. RISS's current
   resource pages and Property documentation expose the useful display values
   through `schema:author`, `dcterms:date`, and `bibo:locator`.

## Live Verification

All probes used the public endpoint `https://data.riss.kr/sparql`, no
credentials, and a bounded `LIMIT`.

1. An exact typed-title query returned the known thesis resource
   `Thesis/000000816406`.
2. `regex(?title, "암각화")` returned five matching books and theses.
3. `regex(?title, "청년")` returned current theses, including
   `청년의 다차원적 고용불안정성이 우울에 미치는 영향`.
4. The 2.5.3 query for `청년 OR 실업`, joined to author, date, and locator,
   returned 10 records. The response included title, author, year, and a
   canonical `riss.kr/link?id=...` link.
5. The official RISS help describes SELECT, WHERE, DISTINCT, LIMIT, and OFFSET,
   and states that the endpoint terminates queries that exceed one minute.

## 2.5.3 Product Decision

1. Generate bounded SPARQL 1.0 title searches with two-argument `regex`.
2. Split a natural-language query into up to six meaningful letter/number
   tokens and OR the tokens. Remove only generic request words such as `논문`,
   `검색`, and `관련`.
3. Emulate ASCII case-insensitive matching with character classes instead of
   the unsupported regex flag.
4. Request `type=Xml` and parse SPARQL XML structurally.
5. Read binding names case-insensitively because RISS uppercases them.
6. Join `schema:author`, `dcterms:date`, and `bibo:locator`, then merge duplicate
   rows for the same work and aggregate authors.
7. Upgrade `http://www.riss.kr/...` locators to HTTPS before showing them.
8. Treat the Korean no-result sentence as a valid empty search, while malformed
   XML remains a visible provider error.

## Scope Boundary

- This connector searches RISS Linked Data titles. It is not a full-text search
  of every RISS document and does not imply access to a thesis PDF.
- RISS Linked Data is discovery metadata. Bibliographic details and access must
  be verified on the linked RISS record.
- Requiring author, date, and locator favors usable scholarly records. Resources
  without those core fields may be omitted.
- The public endpoint is comparatively old and may be slow. Queries remain
  bounded, and the official one-minute cutoff still applies.

## Regression Coverage

- The adapter test rejects `CONTAINS`, `LCASE`, and regex flags in generated
  RISS queries.
- Multi-term Korean/English queries are encoded as SPARQL 1.0 regex OR clauses.
- A real-shape uppercase SPARQL XML fixture maps title, authors, year, source
  URI, and HTTPS RISS locator.
- Duplicate author bindings merge into one evidence record.
- `조회 결과가 없습니다.` maps to an empty result without a false parser error.

## Official Sources

- [RISS SPARQL Endpoint](https://data.riss.kr/sparqlEndpoint.do)
- [RISS SPARQL help and one-minute boundary](https://data.riss.kr/userguide.do)
- [RISS Property descriptions](https://data.riss.kr/explanProperty.do)
- [RISS Linked Data thesis example](https://data.riss.kr/resource/Thesis/000000816406)

## Secret Handling

RISS Linked Data is a public endpoint. No API key, token, personal query
history, or private document content was recorded in this report.
