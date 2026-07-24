# R-008: Smart Composer 2.1 Performance Refactor Baseline and Gates

> [!IMPORTANT]
> **Status: Verified / Mandatory implementation input**
>
> This report records the immutable Smart Composer Achmage 2.0.14 baseline and
> the release gates for the isolated 2.1.0 performance-refactor branch.

## 1. Baseline

The refactor starts from:

```text
tag: 2.0.14
commit: 5a0ea54
branch: codex/2.1.0-performance-refactor
```

The branch lives in a sibling Git worktree. The existing 2.0 worktree and its
user-owned `README.md`, `AGENTS.md`, and `REFERENCES/` changes are not modified.

Clean-install verification on 2026-07-24 produced:

```text
test suites: 51 passed
tests: 363 passed
production main.js: 9,182,051 bytes
styles.css: 77,212 bytes
manifest.json: 377 bytes
```

The production esbuild metafile attributes 5,598,896 output bytes to the root
`js-tiktoken` bundle. The next largest individual input is PGlite Postgres at
395,330 output bytes. This makes tokenizer rank selection the only low-risk
change capable of reaching the 5.2 MiB release budget by itself.

## 2. Exact Tokenizer Boundary

Smart Composer uses only `cl100k_base`. The installed `js-tiktoken` package
publishes a supported exact lite path:

```text
js-tiktoken/lite
js-tiktoken/ranks/cl100k_base
```

The refactor may replace the root package import with those exports and cache
one encoder instance. It may not replace tokenization with a character,
word-count, or heuristic approximation.

The release test corpus must compare token IDs, not only counts, across Korean,
English, Markdown, code, emoji, mixed Unicode, and long text.

## 3. Runtime Initialization Findings

Source inspection identified these avoidable eager paths:

- plugin load starts legacy migration through `getDbManager()` before checking
  the completed-migration marker;
- Database, RAG, and MCP React providers initialize their managers on mount;
- `main.ts` statically imports PGlite, RAG, MCP, inline editing, and task
  adapters;
- `ChatView.tsx` statically initializes React, Lexical, Radix, Markdown, and the
  provider manager before the chat is opened;
- `SettingTab.tsx` statically initializes the React settings tree;
- `core/llm/manager.ts` statically initializes every provider SDK even though a
  request uses one provider;
- each background-task card subscribes independently and rereads artifact
  records after task updates.

The allowed optimization is delayed initialization behind the existing user
action or capability boundary. The feature, provider, setting, history format,
and output contract must remain unchanged.

## 4. Mandatory Compatibility Gates

This refactor inherits all mandatory findings from R-001 through R-007.
In particular:

- **R-004:** token counts, focused/exhaustive routing, fallback metadata, and
  the actual context supplied to the model must remain equivalent.
- **R-005:** stable Markdown blocks, streaming-tail behavior, dual skins,
  keyboard/IME behavior, and truthful activity states must remain intact.
- **R-006:** one foreground response, plugin-owned background tasks, scoped
  cancellation, origin anchoring, and artifact persistence must not regress.
- **R-007:** the complete 2.0.14 inline, image queue, R2, artifact, history, and
  runtime compatibility boundary remains authoritative.

Full syntax highlighting, every configured Plan/API provider, PGlite embedding
retrieval, MCP, Canvas, Bases, Excalidraw, image generation, CMDS R2, and
parallel inline editing remain in scope. No language list or provider may be
removed to meet the budget.

## 5. Release Gates

The 2.1.0 release requires:

```text
main.js <= 5.2 MiB
all type checks pass
all existing and new tests pass
lint check passes
production build passes
```

On the same PC and vault, after one warm-up and seven measured runs:

```text
median plugin onload improvement >= 30%
median first chat input-ready improvement >= 20%
idle and long-session heap regression < 5%
```

Provider network response time is excluded from those local startup metrics.
Instrumentation uses the local Performance Timeline only. It does not persist
note content, prompts, credentials, or telemetry.

Any optimization that changes behavior or misses a compatibility gate is
reverted independently. Missing the runtime target does not justify removing a
feature.

## 6. Release and Rollback Boundary

- Settings schema remains 20.
- Chat schema remains 2.
- Task and artifact schema remain 1.
- Minimum Obsidian remains 1.10.0.
- The plugin ID remains unchanged.
- No data migration is added.
- The performance-refactor baseline version is 2.1.0; the polished release
  candidate is 2.1.1 as recorded in section 9.
- BRAT release assets remain `main.js`, `manifest.json`, and `styles.css`.
- Rolling back the plugin files to 2.0.14 must remain possible.

## 7. Secret and Privacy Statement

No OAuth token, API key, account ID, Cloudflare credential, private note
content, prompt content, or generated artifact bytes were read or recorded for
this baseline.

## 8. Implementation Verification

The isolated 2.1.0 branch implements the approved low-risk refactor:

- the exact `cl100k_base` lite encoder replaces the root `js-tiktoken` bundle;
- Chat, Settings, Database, RAG, MCP, inline editing, provider construction,
  image generation, and artifact drafting initialize behind their existing
  user-action boundaries;
- completed legacy migration markers are checked before PGlite is imported;
- background task adapters load on first execution;
- one ChatView-level task subscription supplies all task cards and the image
  queue;
- artifact records are cached and concurrent reads are deduplicated;
- local Performance Timeline marks cover plugin onload and first chat
  input-ready without persistence or telemetry.

Automated verification on 2026-07-24 produced:

```text
test suites: 54 passed
tests: 374 passed
type check: passed
repository-wide Prettier and ESLint: passed
production main.js: 4,720,681 bytes
bundle reduction from 2.0.14: 4,461,370 bytes (48.59%)
bundle budget: passed (<= 5.2 MiB)
```

The exact-token regression corpus compares token IDs with the former root
encoder for Korean, English, Markdown, code, emoji, mixed Unicode, and long
text. The production budget check also rejects the root tokenizer bundle and
every rank other than `cl100k_base`.

Seven-run Obsidian startup/input-ready measurements, heap comparison, Plan/API
account smoke tests, CMDS R2, Canvas/Bases/Excalidraw, popout/mobile checks, and
the three-day soak remain real-runtime release gates. They are not inferred
from unit tests or bundle size.

## 9. 2.1.1 Chat Chrome Addendum

The 2.1.1 candidate keeps the 2.1.0 runtime, schemas, provider routing,
background task behavior, and bundle boundary intact while polishing the chat
chrome:

- the header is one compact row with identical icon controls and explicit
  `Chat / COWORK` or `Chat / OPERATOR` labeling;
- image attachment, vault search, image generation, MCP tools, and send use
  accessible icon buttons with tooltips;
- vault search and image generation are mutually exclusive one-shot composer
  modes and reset to ordinary chat after submission;
- sending during a foreground response retains the R-006 FIFO prompt queue,
  while image generation continues to use the independent background queue;
- the MCP manager and available-tool count initialize only when the tools
  popover is opened, preserving the lazy-loading boundary established here;
- Radix menus and tooltips portal into the existing light-DOM chat mount. This
  preserves the R-007 keyboard, IME, paste, and popout constraint and does not
  reintroduce a chat Shadow Root;
- the existing R-005 Hallym Light and CMDS Dark skins, reduced-motion behavior,
  forced-colors behavior, and fixed control geometry remain release gates.

The release is intentionally staged in two phases. Automated verification and
installation into the Dropbox-backed vault may be completed first. The
`2.1.1` tag and GitHub release are published only after a clean launch and
smoke test on the synced target PC. The longer three-day soak remains a
post-publication observation gate and cannot be inferred from automated tests.

Automated verification of the 2.1.1 candidate on 2026-07-24 produced:

```text
test suites: 55 passed
tests: 377 passed
type check: passed
repository-wide Prettier and ESLint: passed
production build: passed
production main.js: 4,724,233 bytes
styles.css: 85,401 bytes
manifest.json: 365 bytes
bundle budget: passed (<= 5.2 MiB)
```

The target-PC launch, 320/400/800 px visual inspection, popout behavior,
tooltip/popover positioning, Korean IME and paste, one-shot Vault/Image modes,
foreground prompt Queue, background Image Queue, and light/dark skin checks
remain live smoke-test items.

## 10. Target-PC Visual Smoke And Release Decision

On 2026-07-24, the user tested the Dropbox-synced 2.1.1 candidate on another
desktop PC and reported that inline editing and sidebar chat remained
functional after the refactor. Five user-provided screenshots were inspected
at their original resolution without copying private note content into this
repository.

The screenshots verify:

- CMDS Dark and Hallym Light both retain their intended visual identity and
  shared control positions;
- compact and wider sidebars keep the model, reasoning, attachment, Vault,
  image, tools, and send controls on one coherent row without visible overlap;
- the foreground-active send state changes to the Queue action while image
  generation continues independently;
- collapsed and expanded Image Queue states show multiple queued/running tasks,
  readable status controls, and the active border treatment;
- the three-dot waiting state, streaming response, stop control, and composer
  activity border are visible in the same live conversation;
- dark and light inline `Insert below` review surfaces render correctly and do
  not replace the selected source;
- exhaustive folder metadata and referenced-document results remain visible in
  the light chat, supporting the R-004 retrieval regression boundary.

No release-blocking clipping, theme leakage, or foreground/background task
collision is visible in the supplied evidence. This satisfies the agreed
target-PC visual smoke gate for publishing 2.1.1. Mobile, popout, hover-tooltip
positioning, and the longer three-day soak remain follow-up observations rather
than claims made from these screenshots.
