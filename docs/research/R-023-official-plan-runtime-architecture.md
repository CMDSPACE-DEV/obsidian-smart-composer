# R-023: Official Claude And Gemini Plan Runtime Architecture

## Status

- **Verified**
- **Mandatory**
- Investigation date: 2026-07-29
- Target release: Smart Composer Achmage 2.6.0

## Question

How can Smart Composer keep subscription-backed Claude and Gemini Plan access
working without storing third-party OAuth tokens or depending on private web
endpoints, while preserving the existing chat, inline edit, RAG, MCP, research,
and background-task workflows?

## Sources Inspected

### Smart Composer

- Repository: `laguna821/obsidian_smart_composer_Achmage`
- Baseline branch: `codex/2.5.5-riss-routing`
- Baseline commit: `6aecff6`
- Baseline version: `2.5.5`
- Relevant source:
  - `src/core/llm/anthropicClaudeCodeProvider.ts`
  - `src/core/llm/claudeCodeAuth.ts`
  - `src/core/llm/claudeCodeMessageAdapter.ts`
  - `src/core/llm/geminiPlanProvider.ts`
  - `src/core/llm/geminiAuth.ts`
  - `src/core/llm/geminiCodeAssistAdapter.ts`
  - `src/core/llm/geminiProject.ts`
  - `src/core/llm/manager.ts`
  - `src/utils/chat/responseGenerator.ts`
  - `src/components/settings/sections/PlanConnectionsSection.tsx`

### Claudian

- Repository: `YishenTu/claudian`
- Commit: `5138592e59f28cfcc9782d23f662c93c1ac0f590`
- Version: `2.0.41`
- License: MIT
- Relevant source:
  - `src/providers/claude/cli/findClaudeCLIPath.ts`
  - `src/providers/claude/runtime/ClaudeCliResolver.ts`
  - `src/providers/claude/runtime/customSpawn.ts`
  - `src/providers/claude/runtime/claudeColdStartQuery.ts`
  - `src/providers/claude/runtime/ClaudeQueryOptionsBuilder.ts`
  - `src/providers/claude/stream/transformClaudeMessage.ts`
  - `src/providers/claude/loadClaudeAgentSdk.ts`
  - `src/core/runtime/ChatRuntime.ts`
  - `src/core/providers/ProviderRegistry.ts`

### Claude Agent SDK

- Package: `@anthropic-ai/claude-agent-sdk`
- Version inspected: `0.3.220`
- License file states that use is subject to Anthropic legal agreements.
- Relevant API:
  - `query()`
  - `createSdkMcpServer()`
  - `supportedModels()`
  - `accountInfo()`
  - `pathToClaudeCodeExecutable`
  - `spawnClaudeCodeProcess`
  - `settingSources`
  - `strictMcpConfig`
  - `persistSession`
  - `canUseTool`

### Antigravity CLI

- Repository inspected: `google-antigravity/antigravity`
- Commit: `03e095a`
- Changelog version: `1.1.8`
- The public repository contains documentation and release notes, not the CLI
  implementation.
- Relevant documented CLI behavior:
  - headless prompt mode with `-p`
  - structured `stream-json` output
  - model discovery
  - model and effort selection
  - MCP configuration
  - browser-based Google authentication
  - Windows, macOS, and Linux installers

## Verified Findings

### 1. The Existing Claude Plan Path Is No Longer A Stable Third-Party Contract

Smart Composer 2.5.5 stores Claude access and refresh tokens, refreshes them
itself, and calls Anthropic's Messages API with Claude Code-specific headers.
Anthropic now rejects this third-party usage path for plan quota and may route it
to extra paid usage. The observed error is therefore an architecture failure,
not merely an outdated model ID.

The replacement must delegate authentication and plan entitlement to an
installed, logged-in official Claude Code runtime.

### 2. The Existing Gemini Plan Path Uses A Private Code Assist Contract

Smart Composer 2.5.5 stores Google OAuth tokens and calls private
`cloudcode-pa.googleapis.com/v1internal:*` endpoints. This path already failed
in R-004 and is not a suitable long-term consumer Plan integration.

The replacement must delegate authentication and model entitlement to an
installed, logged-in official Antigravity CLI runtime.

### 3. Claudian Does Not Solve Claude By Reimplementing OAuth

Claudian 2.0.41 uses the official Claude Agent SDK plus an external Claude Code
executable. It does not provide a direct third-party Claude subscription OAuth
implementation.

Its provider list includes Claude, Codex, Grok, OpenCode, Pi, and ACP. It does
not contain a Gemini Plan provider. Claudian is therefore a strong Claude
runtime reference, not a source for Gemini login code.

### 4. The Most Valuable Claudian Code Is Narrow And Reusable

The following implementation patterns are suitable for a selective MIT-licensed
port:

- robust Claude CLI discovery across native installers, npm entrypoints,
  Windows Program Files, Homebrew, NVM, Volta, asdf, and PATH;

### 5. Claude Plan Delegation Is Not A Public Third-Party Product Contract

Anthropic's legal and compliance documentation, rechecked on 2026-07-29,
states that developers building products or services with Claude should use API
key authentication. It also states that third-party developers may not offer
Claude.ai login or route Free, Pro, or Max Plan credentials on behalf of users.

Anthropic separately announced an Agent SDK monthly-credit change and then
paused it on 2026-06-15. The current help article says Agent SDK, `claude -p`,
and third-party app usage still draw from subscription limits while Anthropic
revises that plan. This does not override the third-party authentication
restriction above.

Therefore the local Claude runtime implemented here is an experimental,
personal-use compatibility path. It must not be described as an official or
stable public Claude Plan integration. A distributable product must default to
Claude API-key authentication unless Anthropic grants a different contract.

Primary sources:

- https://code.claude.com/docs/en/legal-and-compliance
- https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan
- device-specific executable overrides;
- a custom spawn adapter for Electron's cross-realm `AbortSignal`;
- hidden Windows child processes and process-tree termination;
- provider-native stream normalization;
- runtime model discovery and alias-based model selection.

The full Claudian Claude provider should not be copied. It owns persistent
sessions, transcript replay, permissions, skills, agents, plugins, browser
tools, filesystem tools, and an agent workspace model that Smart Composer does
not need.

### 5. The Claude Agent SDK Can Be Constrained To Smart Composer's Tool Boundary

The SDK supports in-process MCP servers through `createSdkMcpServer()`. Smart
Composer can expose only its own local tool bridge while disabling Claude Code
built-in filesystem, shell, browser, task, and edit tools.

Required runtime options:

- `settingSources: []`
- `strictMcpConfig: true`
- `persistSession: false`
- plugin-created in-process MCP server only
- no provider-owned vault path as the working directory
- no built-in filesystem, shell, browser, edit, task, or subagent tools

This preserves the R-010 through R-022 trust, approval, routing, and source
boundaries. Smart Composer remains the only component allowed to read or modify
the vault.

### 6. Antigravity Needs A Smart Composer-Owned Tool Boundary

Antigravity's public CLI contract supports MCP but does not expose an in-process
JavaScript SDK equivalent to Claude's `createSdkMcpServer()`. A localhost MCP
gateway was considered, but its exact headless flags and cleanup contract could
not be verified from the docs-only public repository.

The 2.6 implementation therefore uses a safer one-shot structured outer loop:

- run `agy -p` in an isolated temporary directory;
- request structured tool calls in the model output;
- execute only tool names supplied by Smart Composer's existing executor;
- append bounded tool results to the next one-shot turn;
- never expose the vault path, shell, or filesystem tools to Antigravity;
- stop after a bounded number of tool rounds.

This preserves the same trust boundary without depending on an unverified
localhost MCP configuration. Native Antigravity MCP remains a future option
only after its runtime flags and persistence behavior are captured in fixtures.

### 7. Provider Sessions Must Not Become A Second Chat Database

Smart Composer chat history is the product's canonical history. Native provider
sessions are disabled by default:

- Claude: `persistSession: false`
- Gemini: use a new one-shot headless invocation and remove any plugin-created
  conversation record after completion

If Antigravity cannot prove deterministic non-persistence or cleanup in a live
test, Gemini Plan release is blocked rather than silently retaining a second
history containing vault context.

### 8. Model Catalogs Must Be Runtime-Owned

Hardcoded Plan model IDs create recurring breakage. Claude should use stable
aliases such as `opus`, `sonnet`, and `haiku`, and then display the runtime's
resolved model catalog. Gemini should populate its Plan models from
Antigravity's model-listing command.

Legacy model IDs remain readable for old chat metadata, but new Plan selection
must use runtime-discovered models and aliases.

### 9. The Official SDK Has A Real Bundle And Licensing Cost

The inspected Claude Agent SDK module is approximately 1.25 MB before bundling.
Smart Composer's production bundle budget must rise from the 2.1 refactor
baseline while preserving the three-file BRAT release contract.

The SDK is not MIT licensed. Before release, the project must verify its current
redistribution terms and include any required notice. Selectively ported
Claudian source must preserve the Claudian MIT copyright and permission notice.

## Architecture Decision

Smart Composer 2.6.0 will keep the existing completion-provider path for
OpenAI Plan and API-key providers, and add a native runtime path for:

- Claude Plan via Claude Agent SDK plus official Claude Code executable;
- Gemini Plan via official Antigravity CLI.

Both runtimes normalize their output into Smart Composer's existing streaming
message and tool-call contracts. The plugin's chat, inline edit, RAG,
document-edit, image, MCP, and research layers remain provider-neutral.

## UX Decision

The Plan settings page will replace Claude/Gemini OAuth forms with runtime
cards:

- Not installed
- Installed, login required
- Ready
- Update available
- Runtime error

Each card provides:

- detect and diagnose;
- a Korean beginner installation wizard with separate copy, terminal-open,
  install-check, and sign-in steps;
- install or update with explicit user action;
- open a visible login terminal;
- refresh model catalog;
- advanced device-local executable path.

On Windows, Claude installation uses Anthropic's official WinGet package.
Smart Composer never pipes downloaded PowerShell into `Invoke-Expression` and
never bypasses the user's execution policy. The plugin displays the official
command, copies it only after the user clicks, and opens a separate visible
PowerShell window; the user pastes and runs the command themselves.

For Antigravity on Windows, the wizard displays Google's documented CMD
installer flow, opens Command Prompt, and gives exact `Ctrl+V` and `Enter`
instructions. Google's installer validates the downloaded `agy.exe` checksum.
Smart Composer does not auto-run the downloaded installer, disable Defender, or
add antivirus exclusions. It recognizes the official
`%LOCALAPPDATA%\agy\bin\agy.exe` install path. Official documentation remains a
secondary source link rather than the primary installation experience.

OpenAI Plan keeps its existing connection flow unchanged.

## Migration Decision

- Settings schema: `26 -> 27`
- Chat schema: `3 -> 4`
- Remove persisted Claude and Gemini direct OAuth credentials.
- Preserve provider records, custom models, and legacy chat metadata.
- Preserve OpenAI Plan OAuth.
- Store only runtime status and discovered model metadata in vault settings.
  Device-local executable overrides live outside synced settings. Never store
  Claude or Google login tokens.

## Implementation Verification Update

The first 2.6 implementation pass verified the installed Claude Code runtime
through the Agent SDK without recording an account identifier. The runtime
catalog returned stable values owned by Claude Code, including:

- `default`, described by the runtime as its current Sonnet choice;
- `opus`, described by the runtime as its current Opus choice;
- `haiku`;
- an additional time-limited runtime model.

This confirms that labels such as “Opus 5” must not be hardcoded from release
rumors or UI assumptions. Smart Composer now stores `default`, `opus`, and
`haiku` aliases for new Claude Plan selections and displays the runtime catalog
for inspection.
Legacy model IDs remain disabled but readable for old conversations.

Antigravity was not installed on the verification machine. Gemini Plan remains
explicitly experimental: diagnostics must parse a non-empty `agy models`
catalog before the provider is marked ready, and a live release test is still
required.

The final 2.6.0 smoke test found that the installed Claude CLI could read its
local authentication record and model catalog, but a real `claude -p` request
returned repeated `401 OAuth access token has been revoked` diagnostics. The
request was stopped after a bounded timeout. This is an account reauthentication
condition, not a successful live provider verification. The user must run
Claude Code sign-in again before the Claude runtime can be considered live on
this device.

## Validation Requirements

- fake Claude SDK and fake Antigravity CLI protocol tests;
- Windows and macOS executable discovery tests;
- cancellation and process-tree cleanup tests;
- model discovery and alias migration tests;
- Claude/Gemini chat, inline edit, focused RAG, exhaustive RAG, document edit,
  MCP, Power 7, and full-auto tool regression tests;
- proof that provider sessions and secrets are not persisted by the plugin;
- GPT Plan chat and native image regression tests;
- `npm run type:check`, full tests, lint, production build, and bundle budget;
- live tests on logged-in official Claude Code and Antigravity installations.

## Open Questions And Release Blocks

1. Obtain or verify an Anthropic contract that permits consumer Plan
   authentication before publishing Claude Plan as a public product feature.
2. Capture and fixture Antigravity 1.1.8 `stream-json` event shapes.
3. Prove deterministic Antigravity conversation cleanup or non-persistence.
4. Verify the exact Antigravity flags that disable built-in filesystem and
   shell tools in headless mode.
5. Verify Claude runtime availability of Opus 5 and Sonnet 5 through
   `supportedModels()` for the user's actual subscription.

Until items 2 through 4 are verified, Gemini Plan is implementation-complete
only behind an experimental runtime flag and must not be labeled stable.
Until item 1 is resolved, Claude Plan must remain visibly experimental and
personal-use only; API-key Claude remains the publishable provider path.

## Security And Privacy

No access token, refresh token, API key, bearer token, account identifier, or
vault content was recorded in this report.
