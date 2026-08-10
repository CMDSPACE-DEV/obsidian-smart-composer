# Smart Composer Custom Research Register

> [!IMPORTANT]
> This register is a mandatory planning input. Before creating a large combined
> update plan, read every report marked **Verified** and **Mandatory** below.

The repository-root `AGENTS.md` also requires Codex to open this register before
any non-trivial implementation work and to read the reports relevant to the
affected feature. For Plan runtime onboarding work, R-023 through R-025 are an
explicit mandatory set. R-026 is additionally mandatory when qualifying or
publishing the 2.6.2 release. R-027 is mandatory for Claude Plan authentication
classification and the 2.6.3 Pro/Max hotfix or release. R-028 is mandatory for
Gemini Plan authentication and the 2.6.4 compatibility hotfix or release.

## Purpose

The custom Smart Composer roadmap will be assembled only after several features
and external plugins have been investigated across separate sessions. This
register prevents verified context from being replaced by memory, guesses, or
premature synthesis.

## Status Definitions

- **Verified**: Source inspection and/or a live test has produced reproducible
  findings.
- **Planned**: The topic is known, but no findings may be assumed yet.
- **Superseded**: A newer report replaces the older report.
- **Mandatory**: The report must be read before broad planning or implementation.
- **Partially verified**: Source or official-document evidence exists, but a
  required live environment or clean-machine reproduction is still pending.

## Research Reports

| ID | Topic | Status | Planning use | Report |
| --- | --- | --- | --- | --- |
| R-001 | GPT Plan native image generation and CMDS Eagle Cloudflare R2 workflow | **Verified** | **Mandatory** | [R-001 report](R-001-gpt-plan-native-image-cmds-eagle-r2.md) |
| R-002 | Claudian inline edit and provider architecture | **Verified** | **Mandatory** | [R-002 report](R-002-claudian-inline-edit-and-provider-architecture.md) |
| R-003 | Vault Operator agent, artifact, and performance architecture | **Verified** | **Mandatory** | [R-003 report](R-003-vault-operator-agent-artifacts-and-performance.md) |
| R-004 | Smart Composer folder/note mention and Gemini Plan regressions | **Verified** | **Mandatory** | [R-004 report](R-004-folder-note-mention-and-gemini-plan-regressions.md) |
| R-005 | Chat and inline UX/UI, motion, perceived performance, theme isolation, and the approved Hallym Conversation Studio × CMDS AI Operator Console dual skin | **Verified** | **Mandatory** | [R-005 report](R-005-chat-inline-uxui-motion-and-theme-isolation.md) |
| R-006 | Foreground chat, legacy Apply removal, background image/MCP tasks, scoped cancellation, and delayed-result anchoring | **Verified** | **Mandatory** | [R-006 report](R-006-foreground-chat-background-tasks-and-delayed-results.md) |
| R-007 | Smart Composer 2.0 reference-source cross-check and implementation boundaries | **Verified** | **Mandatory** | [R-007 report](R-007-smart-composer-2-reference-source-cross-check.md) |
| R-008 | Smart Composer 2.1 performance-refactor baseline, bundle budget, and compatibility gates | **Verified** | **Mandatory** | [R-008 report](R-008-performance-refactor-baseline-and-gates.md) |
| R-009 | Parallel inline-edit note/folder reference mentions (`@vault` deferred) | **Verified + Implemented in 2.2.0; visual parity enhanced in 2.3.3** | **Mandatory** | [R-009 report](R-009-inline-edit-vault-references.md) |
| R-010 | Beginner-safe MCP connection, authentication, tool discovery, and chat invocation UX | **Verified** | **Mandatory** | [R-010 report](R-010-mcp-connection-authentication-and-invocation-ux.md) |
| R-011 | Smart Composer 2.3 MCP implementation and automated verification | **Verified + Implemented in 2.3.0** | **Mandatory** | [R-011 report](R-011-mcp-2.3-implementation-verification.md) |
| R-012 | Remote MCP browser-CORS failure and desktop transport correction | **Verified + Implemented in 2.3.2** | **Mandatory** | [R-012 report](R-012-remote-mcp-cors-transport.md) |
| R-013 | Provider-aware long output budgets, truncation recovery, HanMark imports, and document-scale editing jobs | **Verified; document-scale inline jobs implemented in 2.4.0** | **Mandatory** | [R-013 report](R-013-long-output-and-document-scale-editing.md) |
| R-014 | High-value fact-checking/research MCP shortlist and NAVER Search/API HUB integration boundary | **Verified** | **Mandatory** | [R-014 report](R-014-high-value-fact-checking-research-mcps-and-naver-search.md) |
| R-015 | Korean official MCPs, Korean academic sources, Web of Science/SSCI, Scopus, and scholarly verification connectors | **Verified** | **Mandatory** | [R-015 report](R-015-korean-official-mcps-and-scholarly-index-connectors.md) |
| R-016 | Plan-first settings information architecture and seven-pack Research Connections implementation contract | **Verified plan + Implementation baseline** | **Mandatory** | [R-016 report](R-016-plan-first-settings-and-research-connections.md) |
| R-017 | Power 7 and Korean Law credential issuance, connection, invocation, troubleshooting, and source-boundary user guide | **Verified guide for 2.5.1** | **Mandatory** | [R-017 guide](R-017-power-7-research-connections-setup-and-usage-guide.md) |
| R-018 | NAVER API HUB provider errorCode 200, legacy Developers credential compatibility, and automatic contract detection | **Verified + Implemented in 2.5.1** | **Mandatory** | [R-018 report](R-018-naver-api-hub-legacy-credential-compatibility.md) |
| R-019 | NAVER API HUB local call metering, official-console boundary, and IAM credential security decision | **Verified + Implemented in 2.5.2** | **Mandatory** | [R-019 report](R-019-naver-api-hub-usage-meter.md) |
| R-020 | RISS Linked Data SPARQL 1.0 search, XML parsing, uppercase bindings, and bibliographic mapping compatibility | **Verified + Implemented in 2.5.3** | **Mandatory** | [R-020 report](R-020-riss-linked-data-search-compatibility.md) |
| R-021 | Full-auto MCP schema trust, all-risk tool execution, bounded automatic continuation, and fallback approval modes | **Verified + Implemented in 2.5.4** | **Mandatory** | [R-021 report](R-021-full-auto-mcp-tool-execution.md) |
| R-022 | RISS chat-tool exposure, `@` mention recovery, typed source-name routing, and legacy Auto-policy migration | **Verified + Implemented in 2.5.5** | **Mandatory** | [R-022 report](R-022-riss-chat-tool-routing-and-mention-recovery.md) |
| R-023 | Official Claude Agent SDK and Antigravity CLI Plan runtime architecture, model discovery, tool isolation, and credential migration | **Verified; SDK execution decision superseded by R-024** | **Mandatory** | [R-023 report](R-023-official-plan-runtime-architecture.md) |
| R-024 | Claude Code and Antigravity live headless protocol capture, bundled SDK failure, and direct CLI correction | **Verified + Implemented in 2.6.0 hotfix** | **Mandatory** | [R-024 report](R-024-native-plan-cli-live-protocol-and-runtime-fix.md) |
| R-025 | Native Plan onboarding state flow, Windows/macOS installation and authentication, and the 2.6.2 implementation contract | **Partially verified; source and official-document analysis complete, clean-machine validation pending** | **Mandatory** | [R-025 report](R-025-native-plan-onboarding-cross-platform.md) |
| R-026 | GitHub Actions macOS qualification and safe 2.6.2 branch/tag/release contract | **Partially verified; dual-architecture Settings and Claude transition verified, complete two-provider exact-SHA qualification and publication pending** | **Mandatory for 2.6.2 release** | [R-026 report](R-026-github-actions-macos-and-2.6.2-release.md) |
| R-027 | Claude personal Pro/Max authentication false block and 2.6.3 billing-safe hotfix contract | **Partially verified; source, current first-party documentation, local tests/build, sanitized Max authentication, and one live protocol request verified; real-Obsidian CI and release pending** | **Mandatory for Claude Plan auth and 2.6.3 release** | [R-027 report](R-027-claude-pro-max-auth-hotfix.md) |
| R-028 | Gemini Plan compatibility rollback after the 2.6.2/2.6.3 blanket quota-provenance block | **Partially verified; tagged source, R-024 live path, and current first-party documentation verified; 2.6.4 implementation and current-runtime qualification pending** | **Mandatory for Gemini Plan auth and 2.6.4 release** | [R-028 report](R-028-gemini-plan-compatibility-unblock.md) |

## Mandatory Synthesis Rule

Do not create the final large-scale roadmap until the user explicitly asks for
the synthesis. At that point:

1. Re-open this register.
2. Read all reports currently marked **Verified** and **Mandatory**.
3. Separate verified behavior from architectural proposals.
4. Resolve contradictions between reports explicitly.
5. Preserve untested questions as validation tasks instead of silently assuming
   answers.

## Adding Future Reports

Use the next unused zero-padded ID and keep the established descriptive naming
form: `R-###-topic-slug.md`. Start from
[`REPORT_TEMPLATE.md`](REPORT_TEMPLATE.md). A materially different question
gets a new report; an older verified report is never silently repurposed or
renumbered.

Update this register in the same change that adds the report. If new evidence
contradicts an older report, identify the exact superseded claim in both the new
row/report and the older report instead of deleting history.

Each investigation should produce one report with:

- exact plugin/repository version and commit where possible;
- source paths inspected;
- live tests performed and their sanitized results;
- observed failures and boundary conditions;
- UX and architecture implications;
- known unknowns and deferred decisions;
- artifacts or reproducible examples;
- an explicit statement that no secrets were recorded.
