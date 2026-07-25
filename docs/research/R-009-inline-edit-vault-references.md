# R-009: Inline Edit Vault Reference Mentions

> [!IMPORTANT]
> **Status: Verified source investigation / Mandatory planning input**
>
> This report records the current 2.1.2 candidate behavior and a bounded
> architecture proposal for file, folder, and vault references inside parallel
> inline-edit sessions. The feature described here is not implemented yet.

## 1. Executive Summary

Adding vault references to inline editing is feasible and has unusually high
workflow leverage:

```text
select target text
  -> open inline edit
  -> mention @editing-prompt.md or @style-guides/
  -> start several independent inline generations
  -> review and apply each result at its source location
```

The current code already has the difficult mutation and concurrency layer:

- multiple inline sessions can remain active in one editor;
- exact and overlapping selections can generate concurrently;
- each request has its own abort controller;
- ranges rebase across accepted sibling edits;
- nested and exact-range `Insert below` results can apply in either order;
- direct target changes still trigger a stale-source rejection.

The missing layer is reference acquisition and compilation. Sidebar chat has a
complete mention pipeline, but it cannot be copied into the inline widget
unchanged:

1. Chat uses Lexical `MentionNode` objects and React portals.
2. Inline edit deliberately uses a native textarea inside a Shadow Root.
3. The earlier 2.0.0 attempt to put Lexical in a Shadow Root broke typing,
   selection, and paste.
4. Chat's `PromptGenerator` expects a persisted `ChatUserMessage` with a
   Lexical editor state and chat retrieval metadata.
5. Inline edit uses a small ephemeral JSON request and must remain independent
   from chat history.

The recommended implementation is therefore:

```text
native inline textarea
  + inline-owned @ suggestion menu
  + selected reference chips
  + shared vault-reference compiler
  + immutable per-session reference snapshot
```

This should be treated as a 2.2.0 feature rather than a small visual patch. It
does not require a new provider architecture, chat schema, task-store schema,
or external dependency.

## 2. Scope and Evidence

### Verified in source

- Current sidebar mention types, search, Lexical node, message storage, and
  prompt compilation.
- Current direct, Plan-rerank, exhaustive-direct, and exhaustive-batch context
  paths.
- Current inline prompt, request, preview, cancellation, and apply lifecycle.
- Current parallel session map and per-session abort controllers.
- Current overlapping/nested insertion acceptance rules.
- The earlier Shadow DOM and Lexical input failure documented in R-007.
- Current 2.1 bundle and lazy-loading boundaries documented in R-008.

### Not live-tested in this investigation

- Typing `@` inside a prototype inline widget.
- Parallel inline requests with separate prompt-note references.
- Folder reference latency in the user's full vault.
- Concurrent OAuth refresh while several inline retrieval requests run.
- Popout and mobile reference menus.

These remain implementation and smoke-test gates rather than verified product
behavior.

## 3. Baseline

| Field | Value |
| --- | --- |
| Repository | `laguna821/obsidian_smart_composer_Achmage` |
| Branch baseline | `codex/2.1.2-image-task-dismiss` |
| Commit | `74bf91fd99a47e8603f8a4555cbbf7a19d0f9cbc` |
| Manifest candidate | `2.1.2` |
| Settings schema | `20` |
| Chat schema | `2` |
| Task/artifact schema | `1` |
| Minimum Obsidian | `1.10.0` |

Relevant mandatory reports:

- **R-002**: inline interaction and stale-target safety.
- **R-004**: mention routing, Plan rerank, exhaustive reading, and fallback
  truthfulness.
- **R-005**: inline keyboard, skin, motion, and owner-document requirements.
- **R-006**: lifecycle separation and scoped cancellation.
- **R-007**: implemented parallel inline sessions and Shadow DOM constraints.
- **R-008**: lazy initialization, bundle budget, and compatibility gates.

## 4. Current Sidebar Mention Pipeline

### 4.1 Search and selection

`src/utils/fuzzy-search.ts` builds searchable entries for:

- Markdown files;
- vault folders;
- the complete vault.

It scores paths and names with boosts for open, recent, and nearby files.
`MentionPlugin.tsx` opens the menu after `@`, converts the selected result into
a Lexical `MentionNode`, and stores a serialized mention object in that node.

Supported persisted mention types currently include:

```text
file
folder
vault
current-file
block
url
image
```

The inline feature discussed here only needs `file`, `folder`, and optionally
`vault`. The selected editor source already serves the role of `block` or
`current-file`; URL and image references are separate future scopes.

### 4.2 Message ownership

`ChatUserInput` maintains a `Mentionable[]` beside the Lexical editor state.
`ChatUserMessage` stores those objects, and chat persistence serializes paths
through `SerializedMentionable`.

This object identity is important. Parsing a plain string such as
`@Editing prompt` only when the request is submitted would be ambiguous when:

- duplicate file names exist;
- a folder and note share a name;
- aliases differ from paths;
- a file is renamed or deleted;
- Korean names contain spaces or punctuation.

Inline editing should also select a concrete path when the menu item is chosen,
not guess from raw prompt text later.

### 4.3 Context compilation

`PromptGenerator.compileUserMessagePrompt()` currently:

1. reads explicitly mentioned files;
2. expands mentioned folders into Markdown files;
3. detects focused versus exhaustive intent;
4. includes small scopes directly;
5. uses embedding or Plan rerank for focused large scopes;
6. uses direct or batched exhaustive reading for exhaustive scopes;
7. records retrieval metadata that matches the final context;
8. appends block, URL, image, and user-query content.

This is the correct behavioral reference for inline vault context, but the
class itself is not a suitable inline API. It requires a Lexical-backed
`ChatUserMessage`, chat progress types, and chat-history metadata.

## 5. Current Inline Pipeline

`src/core/inline/InlineEditController.ts` currently uses:

```text
native textarea in an editor-anchored Shadow Root
  -> instruction + selection + surrounding context
  -> selected inline/chat model
  -> replacement, insertion, or clarification JSON
  -> in-place preview
  -> deterministic accept/reject
```

The request body contains:

```json
{
  "instruction": "...",
  "selection": "...",
  "contextBefore": "...",
  "contextAfter": "...",
  "placement": "replace | insert-after"
}
```

There is no mention state, `@` query handler, reference picker, vault read, or
retrieval metadata in this path. Typing `@name` therefore remains ordinary
textarea text and cannot identify or read a vault item.

## 6. Parallel Inline State Is Already Suitable

R-002 and R-006 recorded the older one-session constraint. That specific fact
is superseded by the implementation history in R-007 sections 8.12 through
8.14.

The current controller has:

```ts
ReadonlyMap<sessionId, InlineSession>
Map<sessionId, AbortController>
```

That is the right foundation for referenced parallel edits. Every session can
own:

```text
its selected target
its edit instruction
its selected reference identities
its compiled reference snapshot
its retrieval metadata and warnings
its model request
its cancellation state
its result and apply decision
```

References must never live in one controller-global array. A global reference
list would allow one inline panel to change the context of another request and
would destroy the meaning of parallel editing.

## 7. Rejected Approaches

### 7.1 Put the sidebar Lexical editor inside the inline Shadow Root

Reject.

R-007 verified that Lexical 0.17.1 depends on document-level active-element and
selection behavior that failed when the chat composer was mounted inside a
Shadow Root. Reusing it would risk reintroducing the exact keyboard, IME, and
paste regression that blocked 2.0.0.

### 7.2 Resolve raw `@name` strings only at submission

Reject.

This cannot reliably distinguish duplicate names or renamed items. It also
provides no removable reference UI and makes request meaning depend on a
late fuzzy guess.

### 7.3 Send a synthetic chat message through `PromptGenerator`

Reject as the long-term design.

It would require fabricating a Lexical editor state and chat message solely to
reach private context logic. It would also mix transient inline work with chat
types, progress, and history assumptions.

### 7.4 Copy the complete mention and RAG implementation into the controller

Reject.

`InlineEditController.ts` is already responsible for CodeMirror sessions,
range mapping, preview, keyboard behavior, and styling. Duplicating retrieval
logic there would create two mention contracts and make R-004 fixes diverge.

## 8. Recommended Architecture

### 8.1 Native inline reference picker

Keep the existing textarea and add a small controller owned by the inline
widget:

```text
text before caret contains an active @ query
  -> search existing file/folder/vault index
  -> render listbox inside the same Shadow Root
  -> choose concrete item
  -> remove the typed @ query
  -> add a reference chip above the textarea
```

Reference chips, not residual prompt text, are the source of truth. A chip
contains the type, visible label, stable vault path, and remove control.

Keyboard contract:

- Up/Down changes the highlighted result while the menu is open.
- Enter selects the highlighted reference; it must not submit the edit.
- Escape closes the menu first; a second Escape closes the inline panel.
- Backspace remains ordinary textarea editing and never leaks to CodeMirror.
- IME composition suppresses selection and submission handling.
- Mouse selection uses the owning `ownerDocument` and remains inside the
  Shadow Root.

The `@` trigger matcher should be extracted into a pure shared utility so chat
and inline menus recognize the same Korean, English, space, and punctuation
patterns. The React/Lexical rendering remains chat-specific.

### 8.2 Per-session reference identity

A transient reference can use existing serialized mention shapes:

```ts
type InlineVaultReference =
  | SerializedMentionableFile
  | SerializedMentionableFolder
  | SerializedMentionableVault
```

The prompt widget passes the selected references into that session's submit
callback. The session then retains them through loading, clarification,
preview, and error states.

Inline sessions are transient, so this does not require a chat-history or
settings migration.

### 8.3 Shared vault-reference compiler

Extract the file/folder/vault portion of `PromptGenerator` into a core service
that has no React, Lexical, or chat-history dependency:

```ts
compileVaultReferences({
  query,
  references,
  targetFilePath,
  modelId,
  settings,
  signal,
  onProgress,
}): Promise<CompiledVaultReferences>
```

Suggested output:

```ts
type CompiledVaultReferences = {
  promptText: string
  retrievalMetadata?: RetrievalMetadata
  warnings: string[]
  sourceFiles: Array<{
    path: string
    mtime: number
    size: number
  }>
}
```

Chat should delegate to the same service after extraction, with compatibility
tests proving that existing direct, focused, exhaustive, and fallback output
does not change.

### 8.4 Retrieval semantics

Recommended defaults:

- An explicitly mentioned note is included directly while the explicit-note
  context fits the existing direct threshold.
- Large explicit note sets and ordinary folder/vault requests use focused
  Plan rerank with local-ranking fallback.
- `all`, `every`, `entire`, `전부`, `전체`, and `정독` intent may use the same
  exhaustive direct/batch path verified in R-004.
- A target file reached only through a mentioned folder is excluded from the
  reference set to avoid silently duplicating the selection and surrounding
  target context.
- An explicitly selected target note may remain allowed, but the UI should
  label it as duplicate current-note context.
- Missing, renamed, or empty references produce a precise per-session error;
  they are not silently discarded.

Folder and vault compilation must report what actually reached the edit model:

```text
2 references
27 files read
40 candidates
10 snippets selected
local fallback used
```

The compact inline panel need not reproduce the full sidebar reference table.
A summary row or tooltip is sufficient, provided it remains truthful.

### 8.5 Model selection

The final edit already uses:

```ts
settings.inlineEdit.modelId ?? settings.chatModelId
```

Current Plan-rerank and exhaustive helper functions instead read
`settings.chatModelId` internally. Reusing them unchanged would create a hidden
model mismatch when the user configured a separate fast inline model.

The shared compiler and RAG helpers should therefore accept an explicit
`modelId`, defaulting to the chat model for current chat callers and receiving
the inline model for inline callers.

### 8.6 Cancellation

Each inline session already owns an `AbortController`, but the current RAG
helpers do not accept its signal. Reference compilation must be part of the
same cancellable lifecycle as final edit generation.

Required additions:

- optional `AbortSignal` on reference compilation;
- abort checks between vault reads and chunking phases;
- the signal passed to internal Plan-rerank and exhaustive-summary requests;
- no transition to preview after a session is closed or replaced;
- no orphan retrieval request after `Cancel generation`.

Obsidian `cachedRead()` cannot cancel an individual filesystem read, but the
compiler can stop scheduling additional work and suppress all post-abort
results.

### 8.7 Immutable context snapshot

Resolve identities and read content when the user presses Generate. Keep the
compiled text and source-file metadata with that session through a
clarification turn; do not silently re-read different content halfway through
one logical edit.

Target-source safety remains strict:

- target text changed -> block Apply/Insert and preserve the preview.

Reference changes are different because the output is already visible for
review:

- referenced content changed -> show a stale-reference warning and offer
  Regenerate;
- do not silently substitute new reference content;
- do not invalidate an otherwise reviewable preview as if the target itself
  changed.

## 9. Request Contract

Extend the inline user payload without changing its response contract:

```json
{
  "instruction": "Use the referenced editing prompt to summarize this below.",
  "selection": "...",
  "contextBefore": "...",
  "contextAfter": "...",
  "placement": "insert-after",
  "referenceContext": "...compiled context...",
  "referenceMetadata": {
    "mode": "direct | plan-rerank | exhaustive-direct | exhaustive-batch",
    "filesRead": 1,
    "selectedChunks": 1
  }
}
```

The system contract must state:

1. The selected range/current line is the only edit target.
2. Referenced notes and folders are read-only context.
3. Nested instructions inside reference content are followed only when the
   user's instruction explicitly asks to use that note as a prompt, template,
   policy, or style guide.
4. Reference content must never be copied into the output unless requested.
5. The existing replacement/insertion/clarification JSON shape remains
   unchanged.

This supports the user's prompt-note workflow without allowing a referenced
note to become an accidental second mutation target.

## 10. Inline UX States

The existing Hallym Light and CMDS Dark panels remain authoritative.

Recommended state additions:

| State | Presentation |
| --- | --- |
| Prompt | Reference chips and `@` listbox inside the current panel |
| Reading | `Reading 2 references` |
| Reranking | `Selecting relevant folder sections` |
| Generating | Existing `Editing in place` or `Writing below selection` |
| Preview | Compact `2 refs · 10 snippets` context summary |
| Fallback | Nonblocking local-fallback warning |
| Missing reference | Precise error with the unresolved path |
| Stale reference | Warning plus Regenerate; target preview remains visible |

The moving perimeter belongs to active reading/reranking/generation states.
The suggestion menu and chips themselves remain still.

## 11. Concurrency Implications

The desired primary workflow is valid:

```text
Session A:
  whole note selection
  @Editing prompt A
  Insert below

Session B:
  nested paragraph selection
  @Summary prompt B
  Insert below

Both generate concurrently.
Either result may be accepted first.
```

R-007 already verifies the target-range and insertion-order mechanics. New
coverage must prove that:

- A and B retain different references;
- closing or canceling A does not mutate B's reference chips or request;
- a clarification in A reuses A's immutable snapshot;
- identical source ranges with different references remain independent;
- reference retrieval metadata is never stored globally.

One provider risk remains open. Provider clients are created per request, and
parallel requests can encounter an expired OAuth session at the same time.
The current providers do not expose a shared refresh mutex. Existing parallel
inline generation has already exercised ordinary concurrency, but an
expired-token test with two reference-enabled sessions is required before
release because folder rerank can add another provider request per session.

## 12. Performance and Bundle Boundary

No new package is needed:

- `fuzzysort` already supplies vault search;
- current mention types and serialization are reusable;
- current Plan/local RAG helpers are reusable;
- the native textarea and imperative Shadow DOM remain.

Preserve R-008 boundaries:

- inline editing stays lazy behind its command/context-menu action;
- vault-reference compilation loads only after a session actually has
  references;
- file-only references do not initialize PGlite or the embedding database;
- folder Plan rerank does not require an OpenAI embedding API key;
- no new eager provider or RAG initialization occurs at plugin startup;
- production `main.js` remains at or below 5.2 MiB.

The current `fuzzySearch()` rebuilds file and folder metadata on every query.
That behavior is acceptable as a compatibility starting point but should be
measured with the user's vault. If it causes prompt typing latency, add a
plugin-lifetime path index invalidated by vault create/delete/rename events
rather than an unrelated search dependency.

## 13. Proposed Source Boundaries

Likely modules:

```text
src/core/inline/InlineEditController.ts
  session ownership, request, preview, target safety

src/core/inline/InlineReferencePicker.ts
  textarea @ query, listbox, chips, keyboard/IME behavior

src/core/references/VaultReferenceCompiler.ts
  file expansion, direct context, focused/exhaustive routing, metadata

src/utils/chat/mentionTrigger.ts
  shared pure @ trigger recognition

src/utils/chat/promptGenerator.ts
  delegates existing chat file/folder/vault context to the shared compiler

src/core/rag/planRerank.ts
src/core/rag/exhaustiveFolderRead.ts
  optional modelId and AbortSignal
```

Avoid putting retrieval, menu state, and CodeMirror range logic into one larger
`InlineEditController.ts`.

## 14. Test Plan

### Mention picker

- Empty `@` query lists recent/nearby files, folders, and Vault.
- Korean and English names with spaces resolve correctly.
- Duplicate names retain distinct path labels.
- Enter selects a menu item rather than submitting.
- Escape closes menu before closing the inline panel.
- Korean IME composition cannot select or submit prematurely.
- Backspace, paste, and clipboard events remain inside the widget.
- Removing a chip removes only that session's reference.

### Context compilation

- One prompt note is included directly with its exact path.
- Duplicate file/folder overlap is deduplicated.
- Folder inclusion excludes the implicit target file.
- Large focused folder uses the chosen inline model for Plan rerank.
- No embedding API key is required for Plan-rerank fallback.
- Malformed JSON, HTTP 429, and non-auth failures use local candidates and
  surface a warning.
- HTTP 401 remains a precise blocking authentication error.
- Exhaustive intent processes every scoped file.
- Missing or renamed references are not silently ignored.
- Cancellation stops scheduling and suppresses late results.

### Parallel inline behavior

- Same selection plus reference A/B produces two independent sessions.
- Nested selection plus different references preserves both sessions.
- Both `Insert below` results apply in either order.
- Canceling one reference compilation leaves its sibling running.
- Clarification retains the original reference snapshot.
- Target stale detection remains strict.
- Reference changes produce a warning without corrupting target mapping.

### Providers and runtime

- GPT Plan and Claude Plan single-file reference.
- GPT Plan and Claude Plan focused folder reference.
- API-key provider reference path.
- Two simultaneous requests with an expired/near-expiry Plan token.
- Popout `ownerDocument`, context menu, keyboard, and focus behavior.
- Hallym Light and CMDS Dark at 320, 400, and 800 px.
- Reduced motion and forced colors.
- Type check, complete tests, lint, production build, and 5.2 MiB budget.

## 15. Recommended Release Boundary

Treat this as **Smart Composer Achmage 2.2.0: Inline Vault References**.

Minimum feature-complete scope:

1. `@file`, `@folder`, and `@vault` selection in the inline prompt.
2. Removable per-session reference chips.
3. Direct explicit-note context.
4. Focused folder/vault Plan rerank with local fallback.
5. Intent-aware exhaustive path, or an explicit truthful deferral if it misses
   the release gate.
6. Per-session phases, metadata summary, cancellation, and errors.
7. Parallel exact/nested sessions with isolated snapshots.
8. No regression to target stale checks, IME, paste, popout, skins, startup,
   or bundle size.

A file-only prototype is a useful first implementation milestone, but it should
not be presented as full sidebar mention parity.

## 16. Open Decisions

The following should be settled during implementation, not guessed after the
UI is built:

- Exact direct-token cap for multiple explicitly mentioned notes.
- Whether `@vault` ships in 2.2.0 or remains a folder-only follow-up.
- Whether stale reference warnings leave Accept enabled or require an explicit
  `Apply snapshot` confirmation.
- Whether an inline chip gets a per-reference `Focused / Entire` menu or uses
  global intent detection only.
- Whether repeated identical prompt-note references share an mtime-keyed read
  cache across parallel sessions.

Recommended defaults are:

- reuse the existing 8,192-token direct threshold;
- support `@vault` through focused retrieval;
- warn, but do not silently invalidate, when only reference content changed;
- use current intent-aware focused/exhaustive rules;
- add caching only after profiling proves it useful.

## 17. Secret and Privacy Statement

No vault note content, prompt text, OAuth token, API key, account ID, or other
secret was read or recorded during this source investigation. The report uses
repository source, existing sanitized research reports, and public type
contracts only.

## 18. Source Index

```text
src/types/mentionable.ts
src/types/chat.ts
src/utils/fuzzy-search.ts
src/utils/chat/mentionable.ts
src/utils/chat/promptGenerator.ts
src/components/chat-view/chat-input/ChatUserInput.tsx
src/components/chat-view/chat-input/plugins/mention/MentionPlugin.tsx
src/components/chat-view/chat-input/plugins/mention/MentionNode.ts
src/core/inline/InlineEditController.ts
src/core/inline/InlineEditController.test.ts
src/core/rag/planRerank.ts
src/core/rag/exhaustiveFolderRead.ts
src/core/rag/internalModel.ts
src/core/rag/ragEngine.ts
src/main.ts
```
