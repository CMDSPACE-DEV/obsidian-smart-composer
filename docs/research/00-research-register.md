# Smart Composer Custom Research Register

> [!IMPORTANT]
> This register is a mandatory planning input. Before creating a large combined
> update plan, read every report marked **Verified** and **Mandatory** below.

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

Each investigation should produce one report with:

- exact plugin/repository version and commit where possible;
- source paths inspected;
- live tests performed and their sanitized results;
- observed failures and boundary conditions;
- UX and architecture implications;
- known unknowns and deferred decisions;
- artifacts or reproducible examples;
- an explicit statement that no secrets were recorded.
