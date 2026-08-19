# R-002: Claudian Inline Edit and Provider Architecture Report

> [!IMPORTANT]
> **Status: Verified / Mandatory planning input**
>
> This report records source-verified behavior as of 2026-07-23. It must be
> read before designing or implementing a Smart Composer inline-edit feature.
> The user's KakaoTalk video was not available in this investigation, so the
> report distinguishes the user's observation from behavior verified in the
> current Claudian source.

## 1. Executive Summary

Claudian's most valuable idea for Smart Composer is not its Claude branding or
its CLI integration. It is the interaction shape of its dedicated inline-edit
command:

```text
select text, or place the cursor
  -> invoke one command/hotkey
  -> type in an editor-anchored prompt
  -> preview the result at the source location
  -> Enter to accept or Esc to reject
```

This is materially more direct than the current Smart Composer Apply path,
which starts from an assistant Markdown block, makes a second whole-file LLM
request, and opens a separate Apply view before writing the result.

The current Claudian implementation also contains several details worth
preserving: cursor insertion as well as selection replacement, IME-safe keyboard
handling, a clarification loop in the same widget, a spinner and cancellation,
a stale-document guard, one active edit at a time, and explicit preview before
write.

There is one important correction to the public description. Claudian's current
production code no longer renders a true word-level in-place diff. Since release
2.0.22, it computes a line-based diff and renders the old and new Markdown as
separate red/green blocks. Older code used word-level spans with compact
check/cross controls. Therefore, a video showing the older presentation can be
authentic while still differing from the latest release.

The right Smart Composer adaptation is a native, lightweight inline-edit lane
using Smart Composer's existing Plan/API providers. It should not copy
Claudian's provider subprocess architecture merely to reproduce the UX.

## 2. Scope and Evidence Labels

This investigation used four evidence labels:

- **Verified - source**: confirmed in the checked-out source or release data.
- **Verified - target source**: confirmed in this Smart Composer checkout.
- **User observation**: reported by the user or the user's acquaintance, but the
  original video or live interaction was not available to this investigation.
- **Inference**: an architectural conclusion supported by source, but not a
  measured performance result.

### Verified in this investigation

- Current Claudian feature surface and provider architecture.
- Current inline-edit lifecycle from command invocation through apply/reject.
- Current line-based Markdown preview implementation.
- The historical change from word-level spans to Markdown-rendered blocks.
- Safety behavior when the document changes while generation is in progress.
- The current Smart Composer whole-file Apply flow used as the comparison
  baseline.

### Not verified in this investigation

- The exact Claudian version shown in the user's KakaoTalk video.
- Perceived latency on the user's machine or the acquaintance's machine.
- Mobile behavior; Claudian declares itself desktop-only.
- A live side-by-side usability test between Claudian and Smart Composer.
- Whether the latest line-based preview is preferred over the older word-level
  preview by the user.

## 3. Repository and Version Baseline

Official project locations:

- Community page: <https://community.obsidian.md/plugins/realclaudian>
- Repository: <https://github.com/YishenTu/claudian>
- README: <https://github.com/YishenTu/claudian/blob/main/README.md>

Source snapshot inspected:

| Field | Value |
| --- | --- |
| Repository commit | `795c711ae6736ee3e6afb1f1c4a3367d3b4063ef` |
| Commit date | 2026-07-22 |
| Manifest version | `2.0.40` |
| Latest release inspected | `2.0.40` |
| Release date | 2026-07-22 |
| Minimum Obsidian version | `1.7.2` |
| Desktop-only | Yes |
| License | MIT |

Approximate project size at that commit:

- 501 TypeScript/TSX source files.
- 92,295 TypeScript/TSX source lines.
- 336 test files.
- Release `main.js`: about 2.96 MB.
- Release `styles.css`: about 138 KB.

Target Smart Composer baseline used for comparison:

| Field | Value |
| --- | --- |
| Local commit | `6f6413737c5ece801904b89884ec5ab8c1e4f207` |
| Apply request | `src/utils/chat/apply.ts` |
| Apply UI | `src/components/apply-view/ApplyViewRoot.tsx` |

## 4. Claudian's Actual Product Shape

Despite its name, current Claudian is a provider-neutral local-agent shell. Its
registry includes Claude, Codex, Grok, OpenCode, and Pi integrations. The vault
acts as the agent workspace rather than merely as pasted chat context.

Source and official documentation expose the following broad capabilities:

- Agentic reading, writing, searching, and shell work inside the vault.
- Multiple chat tabs, persisted history, resume, fork, and compact workflows.
- File, subagent, MCP, and external-directory mentions.
- Slash commands and skills.
- Instruction mode and Plan mode.
- MCP over stdio, SSE, and HTTP.
- Images and provider-specific model/reasoning controls where supported.
- A separate inline-edit command available from an editor selection or cursor.
- Local transcript storage and no advertised telemetry.

Provider capabilities are declared independently. Claude has the broadest
feature set, while Codex also supports core chat/session behavior, Plan mode,
images, inline edit, instruction/skill commands, and subagents. This means the
inline-edit interaction is not inherently Claude-only.

Relevant architecture files:

- `src/core/providers/ProviderRegistry.ts`
- `src/core/providers/ProviderWorkspaceRegistry.ts`
- `src/core/providers/types.ts`
- `src/providers/claude/registration.ts`
- `src/providers/codex/registration.ts`
- `src/providers/claude/capabilities.ts`
- `src/providers/codex/capabilities.ts`

Permanent source root for this snapshot:

<https://github.com/YishenTu/claudian/tree/795c711ae6736ee3e6afb1f1c4a3367d3b4063ef/src>

## 5. Current Inline-Edit Lifecycle

### 5.1 Invocation and source targeting

The `inline-edit` command requires an active Markdown view. It supports two
source modes:

1. **Selection replacement**: the selected source becomes the old value.
2. **Cursor insertion**: an empty source range is used and generated Markdown is
   inserted at the cursor.

Only one inline-edit controller may be active. Starting another edit rejects and
cleans up the existing one.

### 5.2 Editor-anchored prompt

Claudian uses a CodeMirror 6 state field and decorations to mount a prompt widget
on the line associated with the selection or cursor. The user does not have to
move to a side panel or separate document-level review surface.

The prompt supports:

- Enter to submit.
- Esc to reject/close.
- IME composition safeguards, important for Korean input.
- Slash-command and mention dropdowns.
- Streaming status/spinner and cancellation.

Primary source:

<https://github.com/YishenTu/claudian/blob/795c711ae6736ee3e6afb1f1c4a3367d3b4063ef/src/features/inline-edit/ui/InlineEditModal.ts>

### 5.3 Dedicated request lane

Inline edit does not route through the visible sidebar conversation. It creates
an auxiliary provider service using the active provider/model:

- Claude performs a cold-start, read-only Agent SDK query.
- Codex uses an ephemeral `codex app-server` thread with read-only sandboxing and
  approvals disabled for this request.
- The Codex process can be reused during the active inline session, then is
  reset during cleanup.
- Other providers implement the same auxiliary-service contract.

Relevant sources:

- `src/core/auxiliary/QueryBackedInlineEditService.ts`
- `src/providers/claude/auxiliary/ClaudeInlineEditService.ts`
- `src/providers/codex/auxiliary/CodexInlineEditService.ts`
- `src/providers/codex/runtime/CodexAuxQueryRunner.ts`

The system prompt supplies file and source context, asks the model to match the
surrounding style, restricts the task to read behavior, and requires an exact XML
result representing either replacement or insertion. Narration outside the
structured result is rejected or interpreted as clarification.

### 5.4 Clarification without leaving the editor

If the model asks a question instead of returning an edit, Claudian renders the
clarification above the same prompt and lets the user answer in place. The
provider conversation can resume within that inline session. This is an
important part of the UX: ambiguity does not force a jump to the main chat.

### 5.5 Preview and apply

After a valid result arrives:

- The original source range is hidden with a CodeMirror replacement decoration.
- Old and new content are shown at that same location.
- Enter accepts and Esc rejects.
- Accept uses `editor.replaceRange` against the original source range.

The preview renderer constructs complete old/new Markdown fragments and uses
Obsidian Markdown rendering for each changed block. This improves readability
for headings, lists, callouts, and other formatted Markdown compared with a raw
text-only preview.

Primary sources:

- `src/features/inline-edit/ui/InlineEditModal.ts`
- `src/features/inline-edit/ui/inlineEditMarkdownPreview.ts`
- `src/style/features/inline-edit.css`

### 5.6 Concurrent-edit safety

At request start, Claudian snapshots both the complete CodeMirror `Text` object
and the target range. Before showing or applying the result, it verifies that
the document and relevant source have not changed. If they have, the generated
edit is rejected instead of being applied to stale coordinates.

This safeguard is not decorative. Any editor-anchored asynchronous rewrite in
Smart Composer needs an equivalent source revision check.

## 6. The Word-Level Diff Claim Requires Version Context

The public README/community description still refers to a word-level diff, but
the current production implementation is line-based.

### Before 2026-06-08

The older implementation displayed changed words inline using red/green spans
and compact accept/reject symbols. This is likely the interaction many users
remember as particularly immediate.

### Since commit `9fecae1`

Commit `9fecae1201a45e0dcaafa343d6b0879a15222b0b`, first included in release
2.0.22, changed the preview to rendered Markdown blocks:

<https://github.com/YishenTu/claudian/commit/9fecae1201a45e0dcaafa343d6b0879a15222b0b>

Current behavior:

- Uses a line-oriented LCS while preserving newline structure.
- Renders the deleted Markdown block in red.
- Renders the inserted Markdown block in green.
- Uses text buttons labeled Reject and Accept.

This trades fine-grained character/word inspection for valid Markdown
presentation. It can be clearer for structural edits but visually heavier for a
one-word correction.

### Test coverage discrepancy

`InlineEditModal.test.ts` still contains and tests a copied word-level algorithm
rather than importing the production `computeMarkdownDiff` implementation. The
test therefore does not prove that the current renderer is word-level. A future
port should test the production diff function directly.

### Interpretation of the user's video observation

The following remains a **user observation**, not a reproduced result:

- The user and an acquaintance found Claudian inline edit faster and more
  intuitive than Smart Composer Apply.
- The acquaintance reportedly uses it frequently.

If the video showed per-word red/green spans and compact check/cross controls,
it was probably recorded before 2.0.22 or from an older installed build. If it
showed a prompt and old/new blocks anchored in the editor, the core flow still
exists in 2.0.40.

## 7. Why It Feels Faster Than Smart Composer Apply

The source supports an interaction-cost explanation, not a latency benchmark.

| Stage | Current Smart Composer Apply | Claudian inline edit |
| --- | --- | --- |
| Start | Generate/find an assistant Markdown block, then click Apply | Select/cursor and invoke a hotkey |
| Request | Second LLM call rewrites the entire current file | Dedicated request targets one source range |
| Review location | Separate `ApplyView` | At the original editor location |
| Granularity | Full-file diff with per-block choices | Selection/insertion preview |
| Clarification | Main chat flow | Same inline widget |
| Commit | Rebuild and write whole file | `editor.replaceRange` |
| Keyboard path | Primarily button/navigation based | Enter accept, Esc reject |

Smart Composer's current Apply pipeline is source-verified as follows:

```text
assistant Markdown block
  -> Apply button
  -> send current full file + recent chat + chosen block to Apply model
  -> model rewrites entire file
  -> open separate ApplyView
  -> review diff blocks
  -> write complete file
```

This explains why Claudian can feel immediate even if its provider process is
not faster. Fewer context switches and a smaller editing target are separate
from model response time.

## 8. Performance and Reliability Boundaries

The inline interaction is lightweight from the user's perspective, but its
provider implementation is not guaranteed to be low latency:

- Claude may cold-start an Agent SDK query.
- Codex may need an app-server process and thread setup.
- Provider authentication and CLI startup remain outside the editor UX.
- A reported issue described inline requests taking more than 40 seconds with
  certain providers; this is anecdotal, not a controlled benchmark:
  <https://github.com/YishenTu/claudian/issues/566>

Another issue shows that users specifically value shortcut-driven inline work
and wanted a richer multi-turn inline conversation:

<https://github.com/YishenTu/claudian/issues/445>

A separate report about broad agent Write/Edit approval behavior must not be
used as evidence against the dedicated inline-edit command. These are different
paths:

<https://github.com/YishenTu/claudian/issues/944>

## 9. Smart Composer Adaptation Findings

These are bounded design implications, not the final implementation roadmap.

### Preserve

1. Selection replacement and cursor insertion.
2. A CodeMirror-anchored input and preview.
3. One command/hotkey from the editor.
4. Enter submit/accept and Esc cancel/reject, with Korean IME protection.
5. Streaming progress and true cancellation.
6. Clarification replies inside the same transient session.
7. One active inline edit at a time.
8. A full-document revision and target-range stale check.
9. Explicit preview before any vault write.
10. Focus restoration to the editor after completion.

### Adapt rather than copy unchanged

- Use Smart Composer's native Plan/API provider adapters and selected model.
- Give inline edit a single-purpose request contract rather than running the
  complete RAG/chat/tool stack.
- Prefer a hybrid diff: word-level emphasis inside changed lines, with a
  Markdown-rendered block fallback for structurally complex edits.
- Keep a compact icon-first accept/reject surface with tooltips; full text
  buttons can appear where ambiguity requires them.
- Make provider/model and request state visible without turning the inline
  widget into another chat panel.

### Do not import as a package of assumptions

- Do not copy the Claude Agent SDK or Codex subprocess layer solely for inline
  editing.
- Do not assume the current Claudian preview is word-level.
- Do not remove preview/approval in the name of speed.
- Do not apply an edit if the document has changed while the model was working.
- Do not route a one-selection rewrite through folder RAG, memory retrieval, or
  a broad autonomous-agent loop by default.

## 10. Recommended Future Live Test Matrix

Before choosing the final UX, test these variants inside the user's vault:

| Case | What to measure |
| --- | --- |
| One-word Korean correction | Prompt-to-first-token, diff readability, IME |
| Multi-paragraph rewrite | Scroll stability and accept confidence |
| Cursor insertion | Placement and surrounding-newline behavior |
| Heading/list/callout/table | Markdown-rendered fallback quality |
| Model asks a question | Clarification continuity and cancellation |
| User edits while waiting | Stale-result rejection |
| OpenAI Plan / Claude Plan / Gemini Plan | Warm and cold latency by provider |
| Escape during streaming | Process/request cleanup and editor restoration |

The preferred comparison should include three prototypes:

1. Current Smart Composer Apply view.
2. Claudian-style line block preview.
3. Hybrid word-within-line plus Markdown structural preview.

## 11. Open Questions Reserved for Planning

- Should inline edit use the selected chat model or a separate fast-edit model?
- Should clarification persist if the user closes and reopens the note?
- What source-size limit should switch from range-only context to surrounding
  section or whole-note context?
- Can one result offer both replace-selection and insert-after variants?
- Should accepted edits create an Obsidian undo transaction only, or also an
  optional checkpoint/history record?
- How should inline edit interact with Live Preview embeds, properties, and
  non-Markdown editor modes?
- Which appearance from the user's video is the desired target? A screenshot or
  recording should be reviewed before freezing visual behavior.

## 12. Mandatory Facts for the Final Roadmap

Any future combined Smart Composer plan must preserve these facts:

1. Claudian 2.0.40 is provider-neutral; the interaction is not Claude-only.
2. The current production preview is line-based rendered Markdown, not the
   still-advertised word-level diff.
3. The older word-level UI and current Markdown-rendered UI have different
   tradeoffs; neither should be silently treated as the user's chosen design.
4. Claudian's speed advantage is verified as lower interaction cost, not as a
   measured lower model latency.
5. Smart Composer currently performs a second whole-file rewrite and opens a
   separate Apply view.
6. A future native inline edit should reuse Smart Composer's Plan/API adapters,
   not inherit Claudian's CLI process architecture by default.
7. Stale-document protection and preview-before-write are required safety
   properties.
8. The KakaoTalk video remains an uninspected artifact and must not be described
   as source-verified behavior.

## 13. License and Secret Handling

Claudian is MIT licensed. Reusing source requires preservation of the relevant
copyright and license notice. A clean adaptation of the interaction pattern is
preferable where it avoids importing provider-specific architecture.

No credentials, OAuth tokens, vault note contents, or private video content were
recorded in this report.

## 14. Source Index

- Official community page:
  <https://community.obsidian.md/plugins/realclaudian>
- Official repository: <https://github.com/YishenTu/claudian>
- Official README: <https://github.com/YishenTu/claudian/blob/main/README.md>
- Source snapshot:
  <https://github.com/YishenTu/claudian/tree/795c711ae6736ee3e6afb1f1c4a3367d3b4063ef>
- Inline controller:
  <https://github.com/YishenTu/claudian/blob/795c711ae6736ee3e6afb1f1c4a3367d3b4063ef/src/features/inline-edit/ui/InlineEditModal.ts>
- Markdown preview helper:
  <https://github.com/YishenTu/claudian/blob/795c711ae6736ee3e6afb1f1c4a3367d3b4063ef/src/features/inline-edit/ui/inlineEditMarkdownPreview.ts>
- Claude inline service:
  <https://github.com/YishenTu/claudian/blob/795c711ae6736ee3e6afb1f1c4a3367d3b4063ef/src/providers/claude/auxiliary/ClaudeInlineEditService.ts>
- Codex inline service:
  <https://github.com/YishenTu/claudian/blob/795c711ae6736ee3e6afb1f1c4a3367d3b4063ef/src/providers/codex/auxiliary/CodexInlineEditService.ts>
- Markdown-diff change:
  <https://github.com/YishenTu/claudian/commit/9fecae1201a45e0dcaafa343d6b0879a15222b0b>
