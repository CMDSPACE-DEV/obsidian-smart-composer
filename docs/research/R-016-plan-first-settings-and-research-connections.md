# R-016: Plan-First Settings and Research Connections

## Status

- Verified plan and implementation baseline
- Branch baseline: `codex/2.4-bulk-inline-edit`
- Baseline commit: `888489a`
- Target release: `2.5.0`
- Date: 2026-07-27

## Decision

Smart Composer 2.5.0 reorganizes settings around Plan subscriptions and adds a
single Research Connections experience over native REST/XML/SPARQL adapters and
curated MCP presets. The underlying protocol remains visible so a native API is
never misrepresented as MCP.

The release contains:

1. Korean Law MCP as a featured legal connection;
2. Web of Science Starter;
3. Crossref with Retraction Watch relations;
4. OpenAlex;
5. KCI, ScienceON, and RISS;
6. OpenDART, NTIS, and KOSIS;
7. NAVER API HUB Search;
8. PubMed and Europe PMC.

The seven numbered research packs in the UI combine related sources, while
Korean Law remains a separate featured connection.

## Settings Information Architecture

The settings root uses five top-level tabs:

- Plan: subscription connections and primary chat/inline models;
- Research: featured connection and seven source packs;
- Writing: chat, inline, document, image, RAG, and templates;
- MCP: existing generic MCP connection and tool review UI;
- Advanced: usage-billed APIs, compatibility models, embeddings, diagnostics,
  and reset.

No existing provider, model ID, MCP connection, RAG option, or chat history is
deleted. Existing selections win over new defaults.

## Routing Contract

- Research routing defaults to hybrid Auto plus explicit `@Source` mentions.
- Auto exposes at most two sources and four tools.
- Public or high-budget sources may participate in Auto.
- WoS, approval-gated sources, and other low-quota sources default to explicit
  use only.
- Explicit source mentions override Auto selection.
- Explicit pack mentions enable every configured source in that pack.
- Chat and parallel inline edits use the same source and pack vocabulary.
- Native research sources can run in chat and parallel inline edits. Remote MCP
  sources run in side chat in 2.5.0; an inline mention shows an explicit warning
  instead of pretending the MCP was queried.
- Every inline generation and clarification turn reuses its compiled native
  evidence snapshot. Document-scale retries reuse the persisted reference
  snapshot; starting a new inline run performs a new retrieval.

## Security Contract

- API keys, tokens, custom authentication headers, and Korean Law `oc` values
  are stored only in Obsidian SecretStorage.
- Secrets are never written to `data.json`, chat history, task/artifact stores,
  logs, reports, or Git.
- Existing Korean Law URLs containing `?oc=` are sanitized by a one-time
  runtime migration. A failed migration disables the connection without
  deleting the original value.
- NAVER API HUB stores key ID and API key as separate secrets.
- Registry metadata may contain public endpoints and documentation URLs only.

No credentials were recorded while producing this report.

## Evidence Contract

Every native connector returns a normalized evidence record with:

- source and operator;
- source role (`discover`, `verify`, `index`, or `official`);
- title, URL, publication date, and retrieval date;
- stable identifiers where available;
- index coverage, editorial status, and limitations.

Deduplication prioritizes DOI, PMID, WoS UID, and KCI ID. Title-only matching
must not silently merge records. Search snippets and index metadata must not be
described as full-text reading.

## Performance and Compatibility Gates

- Adapters load lazily and avoid large source SDKs.
- The production bundle remains at or below the R-008 5.2 MiB budget.
- Native connectors use Obsidian request facilities for desktop/mobile
  compatibility.
- MCP presets retain the R-010 through R-012 connection, review, and desktop
  transport contracts.
- R-004 RAG, R-006 foreground/background work, R-009 parallel inline
  references, and R-013 document-scale editing remain regression gates.

## Release Gate

All seven packs must have functional adapters, fixtures, setup UI, connection
tests, error handling, and source-role labels before the single 2.5.0 public
release. Credentialed live tests are performed when credentials are available;
otherwise the adapter contract and sanitized fixture tests remain mandatory.
