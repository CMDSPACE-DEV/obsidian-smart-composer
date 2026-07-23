# R-007: Smart Composer 2.0 Reference-Source Cross-Check

> [!IMPORTANT]
> **Status: Verified / Mandatory planning and implementation input**
>
> This report records the source-level cross-check performed before the Smart
> Composer Achmage 2.0 implementation. It separates reusable behavior from
> unverified runtime integrations.

## 1. Versions and Baseline

The implementation baseline is:

```text
Smart Composer Achmage release/1.4.0-plan-models
commit e844009fa136b94ac8f496fe28f92d43c89dc365
```

Reference source trees inspected:

```text
REFERENCES/claudian-main/claudian-main
  manifest version: 2.0.40
  license: MIT

REFERENCES/vault-operator-main/vault-operator-main
  manifest version: 3.2.5
  package version: 3.0.3
  license: Apache-2.0
```

The reference repositories are research inputs. They are not runtime
dependencies and must not be bundled into `main.js`.

## 2. Claudian Findings

Source inspection confirmed that Claudian's inline workflow is based on a
CodeMirror state field, state effects, replacement decorations, and an active
session controller. Its useful behavior is:

```text
selection or cursor
  -> anchored prompt widget
  -> auxiliary model request
  -> optional clarification in the same widget
  -> in-place preview
  -> Enter accept / Escape reject
```

Important implementation details:

- only one inline session is active at a time;
- the original CodeMirror document and selected text are snapshotted;
- applying is rejected if the document or target range changed;
- selection changes reposition the prompt before submission;
- the widget accounts for `ownerDocument` in Obsidian popout windows;
- IME composition is guarded;
- accepted output is applied with a deterministic editor replacement;
- provider selection is independent from the inline UI.

Claudian 2.0.40 currently renders line-oriented old/new Markdown blocks for the
main diff path. Earlier word-level behavior still provides a useful design
reference, but should not be described as the current implementation.

Smart Composer will implement these behaviors against its own Plan/API provider
manager. Claudian's CLI process architecture and provider implementations will
not be copied.

## 3. Vault Operator Findings

Vault Operator's main sidebar agent uses a comparatively heavy ReAct loop with
up to 25 model/tool iterations plus rules, memory, retrieval, and tool
orchestration. This is not appropriate for Smart Composer's lightweight writing
lane.

Reusable boundaries found in source:

- quick inline actions use a separate single-call LLM path;
- background work has explicit cancellation and resource concepts;
- Canvas, Bases, and Excalidraw writes are isolated behind tools;
- artifact-producing operations can validate output before writing.

Important limitations:

- built-in Canvas output is a deterministic four-column file-card layout;
- the Canvas folder-prefix check can include unintended sibling paths;
- built-in Excalidraw output is limited to a small deterministic box/arrow
  diagram;
- Base creation is hand-built YAML;
- Base updates use fragile text/regular-expression rewriting;
- unknown Base filters can evaluate as true.

Smart Composer will reuse the idea of bounded artifact adapters, previews,
validation, and rollback. It will not port the ReAct agent, regex Base editor,
or permissive unknown-filter behavior.

## 4. Current Smart Composer Boundaries

The 1.4 baseline still has:

- one linear foreground stream;
- global abort behavior on new submission;
- one mutation-level pending state and Stop button;
- message-only chat persistence;
- a second LLM call and whole-file rewrite for Apply;
- full Markdown subtree replacement while streaming;
- ordinary light-DOM React and Radix portal mounting;
- Plan rerank and exhaustive folder modes;
- Gemini Plan connection UI even though consumer Code Assist OAuth is no
  longer usable.

The Codex adapter maps `max_tokens` to the internal endpoint's
`max_output_tokens`. R-004 proved that this breaks helper RAG requests, and
R-001 proved that the hosted image path also rejects the field.

## 5. Obsidian and Optional Plugin Contracts

Official Obsidian API types expose `BasesConfigFile`, Bases view types, and
query-result objects beginning with Obsidian 1.10.0. They do not expose a public
method for arbitrary headless Base-query execution. Smart Composer therefore
must use structural `.base` editing and a documented strict query subset rather
than pretending to execute every native formula.

Official Excalidraw Automate documentation exposes `reset`, shape/text
creation, object connection, `create`, view selection, and
`addElementsToView`. The installed plugin exposes compatible runtime symbols,
but the cross-plugin contract still requires a live version/capability test.

CMDS Eagle 1.7.0 exposes runtime methods that can reach the active cloud
provider. No stable documented cross-plugin API was found. An integration must:

- check plugin version and method shape;
- call the active provider without reading `data.json`;
- never copy or log Cloudflare credentials;
- keep a locally generated image when upload is unavailable or fails.

### 5.1 Installed-vault metadata check (2026-07-23)

A read-only check of the running Achmage vault confirmed:

```text
Obsidian desktop: 1.13.3
Smart Composer installed slot: 1.4.0
CMDS Eagle: 1.7.0
Excalidraw: 2.25.2
```

The running vault therefore matches the versions targeted by the CMDS and
Excalidraw capability guards. No plugin secret or `data.json` content was read.
The active `smart-composer` directory was not overwritten while Obsidian was
open.

## 6. Deterministic Fallback Decisions

The 2.0 implementation uses these fixed fallbacks:

- Shadow DOM compatibility failure blocks release rather than silently claiming
  complete theme isolation.
- Missing or incompatible CMDS Eagle disables R2 actions but preserves local
  image save and insertion.
- Missing or incompatible Excalidraw Automate permits deterministic creation of
  a new drawing but rejects mutation of an existing drawing.
- Unsupported Base formulas are reported as unsupported and are never treated
  as true.
- Background Plan image work is considered active only while Obsidian remains
  open; interrupted work requires explicit retry.

## 7. Licensing Boundary

The intended implementation is a clean adaptation of observed architecture and
behavior. If a later patch copies a substantial source fragment from Claudian
or Vault Operator, the release must include the corresponding MIT or Apache-2.0
copyright and license notice.

## 8. Runtime Validation Still Required

A Chromium UI harness rendered both isolated skins at 320, 400, and 800 px.
The harness covered a long code line, Queue controls, image and artifact task
cards, the orbital loader, and the fixed composer. All six combinations had
zero document-width overflow and no button left the viewport. Reduced-motion
emulation disabled the orbital animation as intended.

### 8.1 Shadow DOM input failure and 2.0.1 fallback (2026-07-23)

The first 2.0.0 vault smoke test found a release-blocking regression before any
provider request was attempted: the Lexical chat composer accepted neither
keyboard input nor `Ctrl+V`.

The failure was caused by mounting Lexical 0.17.1 inside the chat ShadowRoot.
That Lexical line uses document-level focus and selection checks, including
`document.activeElement === editor.getRootElement()`. Chromium retargets the
active element to the shadow host, so Lexical cannot reliably synchronize its
selection, keyboard, or clipboard state.

Version 2.0.1 therefore keeps the Hallym/CMDS visual system strongly scoped
under `.smtcmp-shell`, but mounts the interactive chat tree in light DOM. When
upgrading an already-open 2.0.0 view, the existing ShadowRoot is converted to a
transparent default slot and the real editable tree remains a light-DOM child.
This preserves the visible surface while restoring document-level editor
semantics.

A system-Chrome regression check bundled the repository's actual React and
Lexical 0.17.1 dependencies in the 2.0.1 mount topology and confirmed:

- Korean keyboard input and `Ctrl+V` produced
  `한글 Lexical 입력 + 붙여넣기`;
- the rendered DOM and Lexical editor state contained the same text;
- one paste event fired and Lexical reported no runtime error;
- `document.activeElement` was the actual contenteditable element;
- the contenteditable remained a light-DOM descendant even when projected
  through the previous 2.0.0 shadow host.

Future full Shadow DOM isolation is blocked until the selected editor stack is
proven with real Obsidian keyboard, IME, clipboard, selection, mention, and
portal tests. Static visual screenshots are not sufficient evidence.

### 8.2 Image dispatch and message-density failure (2026-07-23)

The next live 2.0.1 smoke test used a Korean natural-language request for a
high-quality infographic. No image task was created: the task repository
contained zero records after the failure. The visible error was:

```text
Codex continuation metadata has no replayable output items
```

Two independent defects were involved:

1. the composer dispatched only the explicit Image button and `/image`
   command directly to the background image queue, so an obvious Korean
   natural-language image request still entered foreground chat;
2. Codex streaming stored `response.completed.output` verbatim. The live
   terminal event can contain an empty output array even after earlier
   `response.output_item.added` and `response.output_item.done` events carried
   the function call. A later turn then rejected the empty continuation
   metadata before making a provider request.

Version 2.0.2 adds tested Korean and English image-intent detection for direct
background dispatch, accumulates Codex output items across the whole SSE
stream, and falls back to normalized assistant history for already-persisted
2.0.0-2.0.1 messages with empty output metadata. A mock hosted-image SSE test
also confirms that the dedicated request still sends `store: false`,
`stream: true`, the hosted `image_generation` tool and no
`max_output_tokens`, then decodes the final image result.

The same smoke test showed that every submitted user message remained a full
Lexical composer with model, reasoning, attachment, image and submit controls.
This made short conversations visually much taller than their content.
Version 2.0.2 renders submitted messages as compact right-aligned bubbles and
mounts the full editor only after the user activates the edit button. A
system-Chrome check at 400 px measured 90 px for a long message with an
attachment summary and 56 px for a short message, with zero horizontal
overflow in both Hallym light and CMDS dark skins.

### 8.3 Background image continuation, destination, and density failures (2026-07-23)

The first successful live image-generation test exposed three follow-on
defects. Sanitized task and artifact records established the actual boundary:

- both generated images existed as recoverable vault files under
  `Smart Composer/Generated Images/`;
- the first image also had a Cloudflare R2 public URL, proving that CMDS Eagle
  upload succeeded;
- the first task incorrectly said `Uploaded and inserted` even though Obsidian
  displayed `Open a Markdown note before inserting the image`;
- the second task correctly retained only a local artifact, but the task card
  did not reveal its vault-relative path.

The insertion failure was caused by resolving only
`workspace.getActiveViewOfType(MarkdownView)`. Clicking a destination button
activates the Smart Composer side pane, so a visible Markdown note can remain
open without being the active view. The corrected resolver checks the active
Markdown view, the active file among all open Markdown leaves, the request
origin note captured when image generation was queued, and finally a single
unambiguous open Markdown view.

R2 upload and Markdown insertion are now separate state transitions. Uploading
stores the returned URL immediately. A failed insertion keeps the local file
and R2 URL, leaves the task awaiting a destination, and offers `Insert R2 link`
without uploading the same image again. Legacy 2.0.2 tasks whose phase is only
`uploaded` are shown as `insertion not verified` and receive the same recovery
action. The success phase is now `uploaded-inserted` and is written only after
`editor.replaceSelection` succeeds.

The apparent first-turn image queue blockage had a separate cause. Every GPT
Plan foreground request exposed a plugin-local `enqueue_image_generation`
tool, so a normal Korean question about whether an existing image queue blocked
chat could be misclassified as a new image request. The foreground generator
then stopped after the tool call and exposed `Continue Response`. Version 2.0.3
removes that local tool from ordinary foreground chat. Explicit Image mode,
`/image`, and tested natural-language generation requests still dispatch
directly to `BackgroundTaskManager`, allowing subsequent text chat to run
without sharing the image task lifecycle.

The task card now displays the exact vault-relative local path and final R2 URL.
Assistant replies use a compact left-aligned message surface, while task cards,
tool cards, and continuation controls use the same 11-13 px visual hierarchy as
the submitted user bubble. `Stop Generation` is returned to normal document
flow instead of being absolutely positioned above the composer. A
system-Chrome layout check at both 400 px and 320 px found zero horizontal
overflow and no intersection between the stop/continue controls and the
composer in either Hallym light or CMDS dark.

### 8.4 Pre-response motion and centralized image queue (2026-07-23)

The 2.0.3 live review confirmed that the streaming tail appeared only after
text arrived, but there was no distinct visual state while the provider was
thinking. Version 2.0.4 introduces an explicit foreground response phase:

- `waiting` starts when the provider request begins;
- an empty assistant placeholder does not end the waiting phase;
- the first non-empty content, reasoning, annotation, or tool event changes the
  phase to `streaming`;
- completion, error, or cancellation returns the phase to `idle`.

During `waiting`, a compact assistant-side surface shows three pulsing dots
inside a luminous conic-gradient orbit. The ring and dots are separate DOM
layers so the radial mask that hollows out the ring cannot also hide the center
dots. Once visible output begins, the waiting surface unmounts and the existing
streaming tail becomes the only motion cue. Reduced-motion and forced-colors
rules cover both layers.

Image tasks are no longer rendered as large cards beneath each originating
message. A compact `Image queue` notice sits below the chat header and reports
generating, queued, destination-ready, failed, and completed counts. It is
collapsed by default. Expanding it opens an overlay with the prompt, progress,
preview, exact local/R2 destination, cancel/retry controls, destination actions,
and a locate-origin command. Current-conversation history remains available;
running, queued, destination-ready, failed, and interrupted tasks remain
portable when the user changes conversations.

The queue overlay subscribes to the existing plugin-lifetime task manager and
does not create a second execution queue. Image concurrency therefore remains
one while foreground chat continues independently. Non-image artifact cards
remain anchored to their originating messages.

A system-Chrome visual check covered collapsed and expanded queue states plus
the waiting and streaming visuals at 400 px and 320 px in both skins. Each
loader contained three visible dots with the `smtcmp-orbit` animation active;
the expanded overlay remained inside the chat shell; horizontal overflow and
stop-button/composer intersections were zero.

### 8.5 Inline entry, focus ownership, and skin mismatch (2026-07-23)

The first live inline-edit review after 2.0.4 exposed three related defects:

- the command existed in the command palette and at `Mod+Shift+K`, but Smart
  Composer never registered an Obsidian `editor-menu` item, so right-clicking a
  Markdown selection offered no visible inline-edit entry;
- `InlineEditWidget.ignoreEvent()` returned `false`. CodeMirror therefore
  reinterpreted events originating in the Shadow DOM textarea. Backspace was
  the clearest failure case because focus and selection could escape from the
  prompt into the underlying document;
- the inline surface used one hard-coded dark green palette in both Obsidian
  modes and did not share the Hallym Light or CMDS Dark hierarchy used by the
  sidebar.

Version 2.0.5 registers `Smart Composer: Inline edit` in the native Markdown
editor context menu and routes it to the same controller as the command and
hotkey. The widget now owns all of its DOM events through
`ignoreEvent() === true`; textarea keyboard, input, composition, and clipboard
events also stop at the widget boundary. Escape and unmodified Enter remain
explicit cancel and submit shortcuts, while Shift+Enter and IME composition
remain available for prompt text.

The inline ShadowRoot now resolves its skin from its own `ownerDocument`, not
the main application document, and observes that document's theme class for
live changes and popout compatibility. It uses the same Hallym and CMDS color
values, 11-13 px hierarchy, focus rings, button semantics, orbital loading
state, reduced-motion rule, and forced-colors fallback as the sidebar. Review
diffs use restrained before/after surfaces instead of the previous large fixed
terminal panels and collapse from two columns to one below 620 px.

A system-Chrome visual harness checked the real injected inline stylesheet in
Hallym prompt, CMDS review, and 400 px review states. The narrow state had zero
horizontal overflow and a single-column diff. The native Obsidian context-menu
entry and Backspace/IME focus behavior still require the next running-vault
smoke test; static browser checks do not replace CodeMirror integration
testing.

### 8.6 Composer and inline-perimeter waiting motion (2026-07-23)

The 2.0.5 live visual review clarified that the initial response motion still
did not match the intended Google AI Mode interaction. The luminous orbit was
drawn as a small ring around the three dots inside the assistant waiting
bubble. The intended hierarchy is different:

- the assistant bubble contains only a quiet three-dot status;
- while the foreground response phase is `waiting`, a short luminous trail
  moves around the perimeter of the main composer;
- while an inline edit is generating, the same motion language belongs to the
  whole inline panel perimeter rather than a small ring around its dots;
- when the first visible output changes the phase to `streaming`, the composer
  trail disappears and the existing streaming text tail becomes the only
  active response cue.

Version 2.0.6 exposes the foreground response phase as a data attribute on the
chat container. The composer draws its animated perimeter with a masked
conic-gradient pseudo-element, so no overlay covers Lexical, mentions, buttons,
or clipboard targets. Hallym Light uses the existing blue-to-teal motion
language; CMDS Dark uses neon green-to-teal with a restrained terminal glow.
The three waiting dots remain static, with only the center dot receiving a
slightly stronger opacity.

The inline ShadowRoot uses the same colors and timing but rotates a physical
conic-gradient layer behind an inset panel surface. This avoids relying on a
registered custom-angle property inside Shadow DOM, which the visual harness
showed did not interpolate. Prompt and preview states remain still; only the
`loading` panel receives the perimeter layer.

A system-Chrome harness rendered the actual stylesheet in both skins. Computed
border angles changed from `70deg` to `180deg` in Hallym Light and from `174deg`
to `267deg` in CMDS Dark, confirming that the perimeter rather than an inner
icon was moving. The inline harness reported three dots, zero ring elements,
different transform matrices at two timestamps, and zero horizontal overflow
in both skins. Reduced-motion replaces each moving trail with a low-opacity
static perimeter, and forced colors uses `CanvasText`.

### 8.7 Assistant waiting-bubble perimeter correction (2026-07-23)

The 2.0.6 live review exposed an interpretation mismatch in the sidebar. The
main composer perimeter and inline panel perimeter both animated correctly,
but the compact assistant waiting bubble still had a static border. The
intended interaction uses the same perimeter motion in all three waiting
surfaces: the main composer, the inline panel, and the assistant-side
three-dot bubble.

Version 2.0.7 keeps the three dots completely still and moves a restrained
blue-to-teal or neon-green-to-teal trail around the full perimeter of the
assistant waiting bubble. It uses the same physical conic-gradient layer
behind an inset surface that was verified for the inline ShadowRoot, avoiding
an inner circular loader and preventing the animated layer from covering the
dots. The CMDS bubble no longer carries a permanently bright left inset line
while waiting, so the moving perimeter remains the single active cue.

The composer perimeter remains active during the same `waiting` phase. The
assistant bubble therefore communicates response location while the composer
communicates global foreground activity; both disappear when visible
streaming output begins. Reduced-motion freezes the bubble perimeter at low
opacity, and forced-colors replaces it with `CanvasText`.

### 8.8 Skin-role header labels (2026-07-23)

The 2.0.7 live review found a small but conceptually important asymmetry in the
chat header. CMDS Dark displayed `Chat / OPERATOR`, while Hallym Light displayed
only `Chat`. This weakened the intended distinction between a serious
terminal-like operator workspace and a polished collaborative web-AI
workspace.

Version 2.0.8 gives both skins the same header grammar and secondary-label
typography. Hallym Light now displays `Chat / COWORK` in deep navy with a
restrained muted suffix, while CMDS Dark retains `Chat / OPERATOR`. The
position, slash, size, spacing, and hierarchy are shared; only the role label
and skin palette differ.

### 8.9 Active image-queue perimeter language (2026-07-23)

The 2.0.8 live review found that the background image queue still used static
box borders while foreground chat and inline editing used animated perimeters
to communicate active work. This made the queue accordion feel visually
detached from the shared waiting-state language.

Version 2.0.9 exposes aggregate queue activity and each task status as DOM data
attributes. While an image is `running` or `queued`, the queue header receives
the same restrained 1.8-second perimeter trail whether the accordion is
collapsed or expanded. When expanded, only the corresponding active task cards
receive the second perimeter. Completed, failed, interrupted, canceled, and
destination-ready cards stay static to prevent motion from spreading across
historical results.

Hallym Light uses blue-to-teal motion, and CMDS Dark uses neon-green-to-teal.
The permanent CMDS left inset line is suppressed on the active queue header so
the moving perimeter remains the single state cue. Both surfaces use
pointer-transparent masked pseudo-elements, preserving the accordion, cancel,
locate, and task action hit targets. Reduced-motion freezes the borders at low
opacity, and forced-colors uses `CanvasText`.

A system-Chrome harness checked collapsed and expanded queue states in both
skins. The collapsed Hallym header angle changed from `16deg` to `116deg`; the
expanded header and running card both changed by more than `100deg` between
samples. The completed card reported no pseudo-element content, all action
buttons remained present, the perimeter layer reported `pointer-events: none`,
and horizontal overflow was zero.

### 8.10 Natural-language image batches and completed-task cleanup (2026-07-23)

The 2.0.9 running-vault review exposed two functional gaps in the image queue.
Natural-language requests ending in forms such as `그려보자` could bypass image
dispatch and receive an ordinary text reply. Even when a request such as
`2장 연속으로 더 그려보자` reached image dispatch, the submit path called
`enqueue()` exactly once. Completed image cards also had no dismissal action,
so a productive session made the queue overlay grow indefinitely.

Version 2.0.10 broadens the deterministic image-intent parser for Korean and
English request forms and parses Arabic, Korean-word, and English-word image
counts. A request for N images creates N independently persisted tasks with
`batchIndex`, `batchTotal`, and a compact `1/N` display label. Each task asks
the image endpoint for exactly one variation. The existing global image
concurrency of one remains unchanged, so the tasks run sequentially while
foreground chat remains available. Ambiguous continuation requests such as
`3장 더 그려보자` reuse the most recent usable image brief in the current
conversation. A single submission is capped at eight tasks to avoid accidental
quota bursts.

Succeeded image cards now have an individual dismiss control, and the expanded
queue has a `Clear completed` command scoped to the current conversation.
Dismissal deletes only the persisted task record under
`.smtcmp_json_db/tasks/`; generated local files, artifact records, checksums,
R2 URLs, and Markdown insertions remain intact. Running, queued,
destination-ready, failed, canceled, interrupted, and other-conversation tasks
cannot be removed by this cleanup path.

Targeted tests verify Korean and English intent forms, count parsing, the
eight-task cap, continuation prompt reuse, three requests producing three
distinct enqueue calls, partial enqueue failure reporting, reload-stable
dismissal, conversation-scoped bulk cleanup, and refusal to dismiss active
tasks. The existing 300 px and 380 px system-Chrome queue harness was reused to
confirm that the compact toolbar and per-card dismiss control do not introduce
horizontal overflow or cover active perimeter hit targets.

### 8.11 Large-selection inline insertion contract (2026-07-23)

The 2.0.10 running-vault review used a 16,714-byte, 11,090-character Markdown
note and selected most of the body before asking the inline editor to summarize
the selection and add the result below it. The request remained in the loading
state. Increasing `Inline edit context` to 99,999 did not help because that
setting controls surrounding characters read outside the selection; it is not
an output-token allowance.

Source inspection confirmed that inline edit had only one operation contract:
the model always had to return a complete replacement for the selected range.
An instruction to append a short summary therefore still required the model to
repeat roughly 11,000 source characters plus the summary inside JSON. This
created unnecessary latency and could exceed a provider's practical output
limit even though the input fitted comfortably in context.

Version 2.0.11 separates source scope from result placement. The prompt surface
offers `Auto`, `Replace`, and `Insert below`. Auto deterministically recognizes
Korean and English append-after wording. Insert mode sends the selected
Markdown as read-only source material and explicitly requires only the new
Markdown in an `insertion` response; the source must not be repeated, rewritten,
or quoted. Acceptance inserts at the captured selection end with stable
Markdown blank-line spacing. The existing document snapshot and file-path
checks still reject stale edits.

Insertion preview does not render the large source twice. It reports that the
selection remains unchanged, shows its character count, and renders only the
new Markdown under `Insert below`. Loading identifies the active operation and
now provides a working `Cancel generation` button plus Escape handling. The
settings label was clarified to state that surrounding context does not
increase generated output length.

Unit coverage verifies exact Korean and English intent resolution, explicit
mode overrides, insertion JSON, large-source non-repetition, Markdown spacing,
and the insertion-only system contract. A system-Chrome Shadow DOM harness
rendered Hallym Light at 400 px and CMDS Dark at 320 px. Prompt and preview
surfaces had zero document, panel-content, and segmented-control horizontal
overflow; the three placement controls and all actions remained visible.

### 8.12 Parallel inline-edit sessions and range rebasing (2026-07-23)

The 2.0.11 running-vault review found that opening a second inline edit removed
or silently replaced the first. Source inspection confirmed two independent
single-session constraints: the CodeMirror field stored one
`DecorationSet` replaced by `StateEffect<InlineSession | null>`, and the
controller stored one `AbortController`. Starting another generation therefore
replaced the widget and aborted the earlier request.

Version 2.0.12 stores inline sessions in a per-editor map keyed by session ID
and keeps one abort controller per running session. Separate selections can now
remain in prompt, loading, clarification, preview, or error states
simultaneously. Each session has independent Generate, Cancel, Reject, Accept,
and Insert actions. Plugin unload aborts every remaining request.

CodeMirror transaction changes rebase every active source range instead of
invalidating the whole note snapshot. Mapping uses after-insertion association
at the source start and before-insertion association at the source end, so an
accepted edit before another target moves the later target without absorbing
boundary text. Acceptance compares only the rebased source slice with that
session's original selection. Unrelated accepted edits therefore remain valid,
while a direct modification inside the source is rejected as stale. A new
request that overlaps an active source range is refused without disturbing the
existing session.

Async loading and preview transitions no longer move keyboard focus. This is
required for a user to keep typing a second inline prompt while the first
finishes in the background. Prompt creation still focuses its own textarea;
completed panels retain keyboard handlers when deliberately focused.

Unit coverage verifies two-session preservation, one-session removal without
sibling loss, position rebasing after a preceding replacement, exact-boundary
insertions, overlap detection, and source-local stale checks. A system-Chrome
Shadow DOM harness stacked loading, prompt, and preview panels at 320 px in the
CMDS skin. All panels remained 304 px wide, had ten-pixel vertical separation,
and produced zero document-level horizontal overflow.

### 8.13 Overlapping inline-edit generation policy correction (2026-07-23)

The first 2.0.12 running-vault test exposed a policy mismatch rather than a
transport concurrency failure. The controller had independent requests and
sessions, but `open()` still refused a second session whose source overlapped
an active range. This also blocked an exact-range second request with the
notice `An inline edit is already active for this text.`

Version 2.0.13 permits separate session IDs to generate concurrently even when
their source ranges overlap or match exactly. Conflict safety moves to the
acceptance boundary: disjoint edits continue to rebase and apply independently;
multiple insert-below results can retain the unchanged source; and after one
replacement changes shared source text, another replacement is not applied.
Its generated preview remains visible and a notice reports the conflict, so a
late result is never silently discarded or allowed to overwrite changed text.

Regression coverage now retains two simultaneous session records with the same
`from` and `to` coordinates in addition to the prior range-rebasing and
source-local stale tests.

### 8.14 Order-independent nested Insert below sessions (2026-07-23)

The 2.0.13 running-vault test confirmed that overlapping sessions could
generate concurrently, but found an acceptance-order defect. When a partial
selection inserted its result inside a larger active selection, the larger
session's contiguous source slice included the new result and was rejected as
changed. This made the primary whole-document plus local-summary workflow
depend on which result the user accepted first.

Version 2.0.14 gives every session a separately rebased insertion anchor and
tracks ranges created by accepted inline insertions. Source validation removes
only those known sibling-result ranges before comparing against the original
selection. Manual edits and replacements remain visible to conflict detection.
Consequently a whole-document Insert below and a nested paragraph Insert below
can both apply in either order. Exact-range insertion sessions also move their
anchors after earlier accepted results, preserving acceptance order instead of
placing later results before earlier ones.

Replacement remains intentionally stricter. If another inline result was
inserted inside a replacement target, the replacement preview is preserved but
cannot be accepted until retried, because replacing the contiguous range would
delete the sibling result.

Regression coverage verifies nested partial-first insertion, exact-range
anchor ordering, safe-insertion source reconstruction, and detection of manual
changes outside tracked insertion ranges.

The following items remain implementation gates rather than verified product
behavior:

- Obsidian Markdown, Radix portals, embeds, and popouts inside the scoped
  light-DOM chat surface;
- CMDS Eagle runtime upload through a running Obsidian instance;
- ExcalidrawAutomate create and existing-view mutation against the installed
  plugin;
- Obsidian 1.10 native Bases rendering of generated and updated `.base` files;
- mobile Plan image generation and local insertion;
- actual image concurrency and quota behavior beyond the R-001 single-request
  tests.

## 9. Secret and Privacy Statement

No OAuth token, API key, account ID, Cloudflare credential, private note
content, or generated image bytes were copied into this report. Only source
code, public documentation, sanitized prior reports, and plugin metadata were
used.
