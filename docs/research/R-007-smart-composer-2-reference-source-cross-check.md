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
