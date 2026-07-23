# R-003: Vault Operator Agent, Artifact, and Performance Report

> [!IMPORTANT]
> **Status: Verified / Mandatory planning input**
>
> This report records source-verified findings as of 2026-07-23 for upstream
> Vault Operator 3.2.5 and the user's local `vault-operator-ko` 3.3.0 custom
> build. It must be read before importing Canvas, Bases, Excalidraw, inline edit,
> or broad agent behavior into Smart Composer.

## 1. Executive Summary

Vault Operator is not simply a chat plugin with several file-writing tools. It
is a large ReAct-style agent runtime containing rules, skills, memory, recipes,
MCP, plugin discovery, model routing, checkpoints, semantic retrieval, Office
generation, and approximately 70 registered tools.

That architecture explains both sides of the user's experience:

- It can create and manipulate artifacts that Smart Composer currently cannot,
  including native Canvas, native Bases files, and Excalidraw documents.
- A normal-looking free-form prompt can feel heavy because sidebar chat and
  free-form inline chat use the same multi-step agent engine, including preflight
  context work and potentially many model/tool iterations.

The useful extraction target is therefore **not the complete Vault Operator
agent**. The strongest candidates are bounded artifact tools and the lightweight
single-call inline-edit lane:

1. Native Canvas generation first.
2. Native Bases creation/query/update after replacing fragile text manipulation
   with structural parsing and stronger validation.
3. Excalidraw as a capability-gated integration, preferably through the
   installed Excalidraw plugin API when available, with a deterministic fallback.
4. Lightweight rewrite/translate/summarize operations that bypass the full
   agent loop.

The user's custom subscription build is also informative. It adds OpenAI,
Claude, and Gemini Plan transports while leaving the core Canvas, Bases,
Excalidraw, chat controller, and inline caller behavior effectively unchanged
from upstream. This demonstrates that Plan transport and artifact tooling are
separable concerns. It does not prove that the custom build is fast, nor that
all upstream artifact behavior works identically through every Plan provider.

## 2. Scope and Evidence Labels

Evidence labels used in this report:

- **Verified - upstream source**: confirmed at the pinned upstream commit.
- **Verified - local source**: confirmed in the source snapshot bundled with the
  user's installed custom plugin.
- **Verified - local configuration shape**: only non-secret provider/type state
  was inspected.
- **User observation**: behavior reported from the user's earlier live use.
- **Inference**: source-supported explanation not established by timing data.
- **Open**: requires a future controlled live test.

### Verified in this investigation

- Upstream feature inventory, package footprint, and agent-loop architecture.
- The division between lightweight quick actions and full-agent free-form chat.
- Deferred tool loading and default tool-group behavior.
- Canvas, Bases, and Excalidraw file-generation implementations and limits.
- Approval and checkpoint flow for structured writes.
- Differences between upstream OAuth support and the user's custom Plan fork.
- Core feature-file equivalence between the custom snapshot and current
  upstream for the files compared.
- Public issue history describing startup/indexing performance work.

### Not verified in this investigation

- No new prompt was sent through the locally installed plugin.
- No controlled cold/warm latency benchmark was performed.
- No Canvas, Base, or Excalidraw artifact was generated in the user's live vault
  during this turn.
- Rich Excalidraw integration through the installed Excalidraw plugin was not
  exercised.
- Mobile behavior was not tested; Vault Operator declares itself desktop-only.
- The user's older upstream version at the time they found it API-only was not
  identified.

## 3. Repository and Version Baseline

Official project locations:

- Community page: <https://community.obsidian.md/plugins/vault-operator>
- Repository: <https://github.com/pssah4/vault-operator>
- Documentation: <https://pssah4.github.io/vault-operator/>

### 3.1 Upstream snapshot

| Field | Value |
| --- | --- |
| Repository commit | `97b77b7eb271cd48897476b699879a1fdb3dc76d` |
| Commit date | 2026-07-22 |
| Manifest version | `3.2.5` |
| Latest release inspected | `3.2.5` |
| Release date | 2026-07-15 |
| Minimum Obsidian in manifest | `1.8.7` |
| Latest README recommendation | Obsidian `1.13` |
| Desktop-only | Yes |
| License | Apache-2.0 |

The repository `package.json` still reports 3.0.3. Manifest and release metadata
are the authoritative packaged version for this report.

Approximate upstream size:

- 1,100 TypeScript/TSX source files.
- 244,507 TypeScript/TSX source lines.
- 477 test files.
- Release `main.js`: about 4.64 MB.
- Release `styles.css`: about 225 KB.

The dependency surface includes Anthropic, OpenAI, AWS SDK, Transformers, MCP,
DOCX, ExcelJS, JSZip, PDF.js, PptxGenJS, SQL.js, graph libraries, and Git-related
components. This is consistent with a full agent/workspace product rather than a
narrow chat client.

Permanent upstream source root:

<https://github.com/pssah4/vault-operator/tree/97b77b7eb271cd48897476b699879a1fdb3dc76d/src>

### 3.2 User's local custom build

Installed plugin directory:

```text
.obsidian/plugins/vault-operator-ko/
```

Sanitized manifest facts:

| Field | Value |
| --- | --- |
| Plugin ID | `vault-operator-ko` |
| Display name | `Vault Operator 한국어 Plan` |
| Version | `3.3.0` |
| Minimum Obsidian | `1.8.7` |
| Desktop-only | Yes |

Installed footprint:

- 21 files, approximately 30.1 MB total.
- Core `main.js`, `manifest.json`, and `styles.css`: approximately 6.46 MB.
- Optional Office/PDF/SQL/reranker bundles: approximately 5.34 MB.
- A large logo and bundled source snapshot account for substantial remaining
  disk use and should not automatically be interpreted as startup cost.

The bundled `plugin-source.json` contains a 623-file source snapshot. After
normalizing line endings and comparing it with the pinned upstream source:

- 556 files matched.
- 56 files differed.
- 11 files were added.

Plan-related additions include:

- `src/api/providers/claude-plan-oauth.ts`
- `src/api/providers/plan-cli.ts`
- `src/core/auth/ClaudePlanOAuthService.ts`
- CLI process/session/event components.
- A temporary MCP bridge used to expose host tools to CLI-backed sessions.

The compared implementations of these core feature paths matched current
upstream after normalization:

- `GenerateCanvasTool.ts`
- `CreateExcalidrawTool.ts`
- `CreateBaseTool.ts`
- `QueryBaseTool.ts`
- `UpdateBaseTool.ts`
- `PanelChatController.ts`
- `InlineLLMCaller.ts`

This is strong evidence that the custom fork modifies provider/auth transport
without replacing the core artifact and agent behavior examined below.

## 4. Current Subscription Support: Important Date Correction

The user's memory that upstream was API-only can accurately describe an older
version or earlier test. It is not accurate for upstream 3.2.5.

Current upstream source contains:

- ChatGPT OAuth subscription support.
- GitHub Copilot subscription support.
- Conventional API providers.

Current upstream does **not** contain native Claude subscription OAuth or Gemini
subscription support. Those are additions in the user's custom 3.3.0 snapshot.

The local custom provider layer uses more than one strategy:

- OpenAI Plan communicates directly with the ChatGPT Codex backend.
- Claude Plan includes a direct OAuth provider path.
- Claude/Gemini CLI paths can launch official CLIs for a single assistant turn,
  disable their built-in tools, and expose Vault Operator host tools through a
  temporary MCP bridge.

The CLI bridge has an input-size guard and process/session setup costs. It is a
valid compatibility technique but should not become Smart Composer's default
native architecture when direct Plan adapters already exist.

Only sanitized configuration shape was inspected. The local installation had an
OpenAI Plan provider configured; no credential value was recorded or printed in
this report.

## 5. The Full Agent Runtime

### 5.1 ReAct loop

`AgentTask` runs a model/tool loop with a default maximum of 25 iterations.
Subtasks can recurse to a bounded depth. The task constructs tool schemas,
executes calls through `ToolExecutionPipeline`, records results, compacts context
when necessary, and asks the model to continue until completion.

Primary sources:

- `src/core/AgentTask.ts`
- `src/core/agent/AgentTaskRunner.ts`
- `src/core/agent/AgentRuntimeContext.ts`
- `src/core/tool-execution/ToolExecutionPipeline.ts`
- `src/core/tools/ToolRegistry.ts`

### 5.2 Work before the first visible answer

The runtime can perform several preflight steps before or around the first model
turn:

- Load applicable rules.
- Discover user and plugin skills.
- Build plugin-skill context.
- Build memory context.
- When memory is ready, embed the first message and retrieve session context.
- Match procedural recipes.
- Select tool groups and build prompt/tool schemas.
- Resolve main/helper model routing.

Some discoveries are cached, but a cold or invalidated session still has more
work than a plain chat completion.

### 5.3 Broad default capability surface

Default chat makes seven broad tool groups available: read, vault, edit, web,
agent, MCP, and skill. The registry contains roughly 70 tools. Not every schema
is sent immediately, because specialized tools can be deferred, but the runtime
still performs capability assembly and agent planning.

### 5.4 Deferred specialized tools

Canvas, Bases, Excalidraw, Draw.io, checkpoints, and health-related tools are
among the specialized capabilities hidden by default. The model first calls
`find_tool`, which activates a matching tool for the rest of the task. The model
then calls the newly available tool.

This reduces initial prompt/schema weight, but an artifact request may require
an additional model/tool round trip:

```text
user request
  -> model calls find_tool
  -> tool becomes active
  -> model calls artifact tool
  -> approval/checkpoint/write
  -> model produces final response
```

Office creation tools for DOCX, XLSX, and PPTX are handled differently and are
kept loaded to avoid repeated cache invalidation costs. Presentation planning is
still deferred.

### 5.5 Write safety and checkpoints

Writes pass through a pipeline that can:

- Reject ignored or protected paths.
- Validate input against tool schemas.
- Ask the user for approval.
- Create a shadow-Git checkpoint.
- Execute and log the write.

Structured artifact creators use a card-style approval summary rather than a
meaningful line-by-line preview of the generated Canvas/Base/Excalidraw data.

## 6. Why Ordinary Chat Can Feel Heavy

The user reported that Vault Operator's agent chat felt slow or heavy, even
though its feature set was impressive. No benchmark was run in this turn, so the
following is a source-supported **inference**, not a timing claim.

### 6.1 Sidebar and free-form inline chat use the agent engine

The sidebar and free-form inline panel both run through `AgentTaskRunner` and
the shared runtime context. Free-form inline chat can retain history and use
skills, MCP, memory, recipes, attachments, steering, and checkpoints. It is not
a simple selection plus one completion request.

Relevant sources:

- `src/core/inline/chat/PanelChatController.ts`
- `src/core/inline/chat/InlineChatOrchestrator.ts`
- `src/core/inline/chat/InlineChatPanel.ts`
- `src/core/agent/AgentTaskRunner.ts`

The inline panel permits up to 20 turns, while a normal agent task defaults to a
maximum of 25 model/tool iterations.

### 6.2 Optimizations exist, but target long/repeated work

Vault Operator includes substantial optimization machinery:

- Deferred tool schemas.
- Helper/flagship model routing.
- Parallel execution for safe read tools and sequential write ordering.
- Tool-result externalization for results over about 2,000 characters.
- Microcompaction and rolling conversation condensation.
- Repetition detection.
- Learned recipe fast paths after repeated success.

These mechanisms reduce long-session cost and repeated workflows. They do not
remove all startup, preflight, first-turn, or extra agent-loop costs for a simple
one-off prompt.

### 6.3 Public performance history

Public issue #32 reported startup heaviness in version 2.9.2. The maintainer
described 3.2.1 fixes including eliminating repeated SQL WASM compilation,
moving database/index/MCP work to background initialization, using quick
integrity checks, and lazily loading heavy libraries:

<https://github.com/pssah4/vault-operator/issues/32>

The same discussion notes that SQL.js still holds its database in memory and
warns when the database grows beyond 300 MB.

Issue #35 reported semantic enrichment running serially with an intentional
pause. Version 3.2.1 parallelized that work up to six calls, though the reporter
still described lag and used delayed plugin startup:

<https://github.com/pssah4/vault-operator/issues/35>

These reports establish that optimization work occurred. They do not quantify
the user's current 3.3.0 latency or prove one remaining bottleneck.

## 7. Lightweight Inline Actions Are a Separate Path

Vault Operator has a second, much narrower inline path. Quick actions such as
Lookup, Rewrite, Translate, Summarize, and Find actions use `InlineLLMCaller` for
a single model request without tools. The source explicitly separates this from
the full agent loop.

For Rewrite and Translate:

1. The selected text is sent through the lightweight caller.
2. The result streams into an edit review surface.
3. The current and proposed versions are shown side by side.
4. The proposed text remains editable.
5. The user applies or discards it.
6. An optional checkpoint can precede editor replacement.

Relevant sources:

- `src/core/inline/InlineLLMCaller.ts`
- `src/ui/edit-review/EditReviewPanel.ts`
- `src/ui/edit-review/EditReviewModal.ts`

A separate CodeMirror inline-diff engine also exists with per-hunk operations
and keyboard controls. The important architectural lesson is the lane split:
routine editor transformations do not need the full memory/tool/skill agent.

## 8. Canvas Capability: Useful but Deterministic

`generate_canvas` writes a real Obsidian `.canvas` JSON file containing `nodes`
and `edges`.

Verified behavior:

- Input modes cover folder, tag, backlinks, or explicit file lists.
- Default maximum is 50 notes; hard maximum is 200.
- Nodes are file cards, not arbitrary text/image/group nodes.
- Layout is a fixed four-column grid.
- Each node is approximately 250 by 80 with fixed spacing.
- Edges are created only for existing wikilinks among included notes.
- Existing target files can be replaced after approval/checkpoint.

Primary source:

<https://github.com/pssah4/vault-operator/blob/97b77b7eb271cd48897476b699879a1fdb3dc76d/src/core/tools/vault/GenerateCanvasTool.ts>

This is a practical navigation-map generator, not an LLM-designed semantic
diagram engine. It is attractive for Smart Composer precisely because the file
format is native and the operation can be deterministic.

One source-level boundary deserves a regression test: folder matching uses a
prefix check, which may allow a folder named `Notes` to match `Notes2` unless a
path-separator boundary is enforced.

## 9. Excalidraw Capability: Two Different Paths

### 9.1 Built-in fallback generator

`create_excalidraw` writes a valid `.excalidraw.md` wrapper containing an
Excalidraw JSON scene.

Verified limits of the built-in generator:

- At most 12 labeled rectangle nodes.
- Grid or horizontal-row layout.
- Optional colors, descriptions, and title.
- Arrows can bind to rectangles and continue to follow moved boxes.
- The output is a deterministic diagram template, not an unrestricted drawing
  or auto-layout engine.

Primary source:

<https://github.com/pssah4/vault-operator/blob/97b77b7eb271cd48897476b699879a1fdb3dc76d/src/core/tools/vault/CreateExcalidrawTool.ts>

### 9.2 Installed-plugin integration

When the Obsidian Excalidraw plugin is enabled, Vault Operator shadows the
built-in generator and instructs the agent to use plugin commands/API through
its plugin-discovery and plugin-skill mechanisms. This can expose richer
behavior than the 12-box fallback.

Primary source:

<https://github.com/pssah4/vault-operator/blob/97b77b7eb271cd48897476b699879a1fdb3dc76d/src/core/tools/shadowedByPlugin.ts>

The design is clever but the actual richness and reliability depend on the
installed plugin's exposed commands/API and the generated plugin skill. It must
be tested in the user's vault before making a roadmap promise.

## 10. Bases Capability: Native Format, Partial Semantics

Vault Operator provides three distinct tools.

### 10.1 Create Base

`create_base` writes a native `.base` YAML file with:

- One table view.
- A `containsAny` file-path filter.
- Optional template-folder exclusion.
- Selected columns.
- One sort declaration.
- Refusal to overwrite an existing target.

Source:

<https://github.com/pssah4/vault-operator/blob/97b77b7eb271cd48897476b699879a1fdb3dc76d/src/core/tools/vault/CreateBaseTool.ts>

### 10.2 Update Base

`update_base` edits the text using line and regular-expression replacement or
appends a table view. It does not use a complete YAML AST or the Obsidian Bases
API. Complex comments, formatting, nested filters, or unsupported layouts can
therefore be fragile.

Source:

<https://github.com/pssah4/vault-operator/blob/97b77b7eb271cd48897476b699879a1fdb3dc76d/src/core/tools/vault/UpdateBaseTool.ts>

### 10.3 Query Base

`query_base` parses a selected view, scans Markdown metadata, and implements a
limited subset of filter behavior:

- `containsAny`
- `contains`
- equality
- `file.name.contains`
- negation of supported conditions

Unknown filters can pass through as true. Declared order fields are used for
display selection but do not provide a complete native Bases sorting engine.
This tool must not be described as a full execution engine for arbitrary Base
syntax.

Source:

<https://github.com/pssah4/vault-operator/blob/97b77b7eb271cd48897476b699879a1fdb3dc76d/src/core/tools/vault/QueryBaseTool.ts>

## 11. Other Capability Areas Worth Remembering

Vault Operator also includes:

- Shallow and deep provenance ingest commands.
- Three-layer memory covering stable identity, extracted facts, and history.
- Local semantic, keyword, graph, and cross-encoder retrieval.
- DOCX/XLSX generation and beta PPTX generation.
- Vault health and repair tooling.
- MCP client/server behavior.
- Obsidian plugin command/API discovery.
- Automatic approvals with configurable policy.
- Shadow-Git checkpoints and post-task review.
- Learned recipes, subtasks, and model-tier routing.

These features explain the product's scale. They are not automatically in scope
for Smart Composer. Importing them together would duplicate existing Smart
Composer RAG/provider concerns and substantially increase startup, state, test,
and security complexity.

## 12. Smart Composer Adaptation Findings

These are constrained findings for later planning, not an instruction to begin
implementation now.

### 12.1 Preferred extraction order

1. **Canvas generator**: native format, deterministic, bounded, and independent
   of another plugin.
2. **Lightweight inline transformations**: reuse Plan/API adapters and avoid the
   full chat agent, aligned with R-002.
3. **Bases creator**: generate a valid native file through a YAML parser or
   supported Obsidian API, with schema-aware preview.
4. **Bases update/query**: only after a fuller syntax/semantics layer replaces
   regex mutation and permissive unknown-filter behavior.
5. **Excalidraw integration**: capability-gated plugin API first; bounded native
   fallback second.

### 12.2 Tool-loading rule

Smart Composer should expose artifact capabilities only when intent or a
user-selected tool activates them. It should not attach the entire schema set,
memory system, skills directory, recipes, and MCP catalog to every ordinary chat
turn.

### 12.3 Structured preview rule

Raw JSON/YAML diff is insufficient for high-confidence artifact writes. A
preview should summarize semantics:

| Artifact | Minimum preview |
| --- | --- |
| Canvas | Target path, node count, exact included files, edge count, layout |
| Base | Target path, source folders, exclusions, columns, filters, sorts, views |
| Excalidraw | Target path, title, boxes/shapes, labels, arrows, plugin/fallback mode |

The generated file should be parsed and validated before approval. After write,
Smart Composer should open the artifact and provide an Obsidian undo or explicit
rollback/checkpoint path.

### 12.4 Provider rule

Artifact tools should consume a provider-neutral structured intent/result
contract. Smart Composer already owns Plan/API adapters, so there is no need to
port Vault Operator's temporary CLI/MCP bridge into the normal path. The local
fork proves transport can be swapped while tools remain stable; it does not make
CLI startup desirable.

### 12.5 Scope rule

Do not port the whole Vault Operator `AgentTask`, memory database, semantic
index, plugin discovery, recipe system, MCP runtime, and Office stack as one
feature. Each introduces its own lifecycle and security model. The target is a
fast composer with selectively activated artifact operations, not a second full
workspace agent hidden inside it.

## 13. Required Future Live Tests

### 13.1 Performance matrix

Measure each row cold and warm, recording preflight, first-token, model, tool,
approval, and write time separately:

| Scenario | Providers |
| --- | --- |
| Plain text answer, no tools | OpenAI/Claude/Gemini Plan where available |
| Rewrite one selection | Same providers |
| Read one note | Same providers |
| Read/search ten notes | Same providers |
| Create Canvas | Same providers |
| Create/query/update Base | Same providers |
| Create Excalidraw fallback | Same providers |
| Create Excalidraw through installed plugin | Same providers |

Also record model/tool round count, whether `find_tool` was required, memory
state, and whether a helper model was invoked. Without this breakdown, “the
plugin is slow” cannot identify a fixable layer.

### 13.2 Artifact correctness

- Canvas folder-boundary matching and 200-file cap.
- Wikilink edge correctness with aliases and relative paths.
- Base parsing with nested filters, comments, formulas, multiple views, and
  sort behavior.
- Safe Base update preserving unrelated YAML.
- Excalidraw plugin discovery, API/command availability, and undo behavior.
- Valid fallback `.excalidraw.md` output when the plugin is absent or disabled.
- Approval denial, cancellation, and rollback for every artifact type.

### 13.3 UX comparison

Compare these as separate operations rather than one universal agent panel:

- Fast editor transformation.
- Read-only vault analysis.
- Artifact creation with semantic preview.
- Open-ended autonomous multi-tool task.

Each should disclose whether it is making one model call or entering an agent
loop.

## 14. Open Questions Reserved for Planning

- Which Canvas node/edge types beyond file cards are genuinely needed?
- Should semantic diagram layout use a deterministic layout library, model
  coordinates, or both?
- Is Obsidian's current Bases API sufficient for structural create/update/query,
  or should Smart Composer own a typed YAML layer?
- Can the Excalidraw plugin provide a stable public API for full scene creation?
- Should artifact writes use normal Obsidian history only or an optional
  checkpoint service?
- How should Plan model structured-output failures be repaired without entering
  a long autonomous loop?
- Which Vault Operator capabilities, if any, belong in later reports rather than
  this custom Smart Composer release?

## 15. Mandatory Facts for the Final Roadmap

Any future combined Smart Composer plan must preserve these facts:

1. Upstream 3.2.5 is no longer API-only: it supports ChatGPT OAuth and GitHub
   Copilot subscriptions, but not native Claude/Gemini subscriptions.
2. The user's custom 3.3.0 build adds Plan transports while retaining the core
   upstream artifact and agent implementations examined here.
3. The user's “heavy chat” observation is architecturally plausible but has not
   been benchmarked in this investigation.
4. Sidebar chat and free-form inline chat use the full agent engine; quick inline
   actions use a separate single-call lane.
5. Canvas generation is a bounded file-card grid with wikilink edges, not a
   semantic free-layout diagram generator.
6. Built-in Excalidraw generation is a bounded rectangle/arrow template; richer
   behavior depends on a separately installed plugin integration that remains
   live-test pending.
7. Bases support handles a useful subset but does not implement the full native
   Bases language or safe structural mutation.
8. Specialized artifact tools are deferred and may add a `find_tool` round trip.
9. Structured artifacts require semantic preview, parsing/validation, and a
   rollback path, not only raw file approval.
10. Smart Composer should import bounded tools and lightweight lanes, not the
    complete Vault Operator runtime by default.

## 16. License and Secret Handling

Vault Operator is Apache-2.0 licensed. Direct code reuse requires preservation
of the license, applicable notices, and attribution. Reimplementation around
documented Obsidian file formats may be cleaner where the upstream implementation
is intentionally narrow or text-fragile.

The local custom build's configuration and source snapshot were inspected
read-only. No OAuth token, API key, credential value, private note content, or
full local filesystem path was copied into this report.

## 17. Source Index

- Official community page:
  <https://community.obsidian.md/plugins/vault-operator>
- Official repository: <https://github.com/pssah4/vault-operator>
- Official documentation: <https://pssah4.github.io/vault-operator/>
- Source snapshot:
  <https://github.com/pssah4/vault-operator/tree/97b77b7eb271cd48897476b699879a1fdb3dc76d>
- Main agent loop:
  <https://github.com/pssah4/vault-operator/blob/97b77b7eb271cd48897476b699879a1fdb3dc76d/src/core/AgentTask.ts>
- Agent runner:
  <https://github.com/pssah4/vault-operator/blob/97b77b7eb271cd48897476b699879a1fdb3dc76d/src/core/agent/AgentTaskRunner.ts>
- Inline controller:
  <https://github.com/pssah4/vault-operator/blob/97b77b7eb271cd48897476b699879a1fdb3dc76d/src/core/inline/chat/PanelChatController.ts>
- Lightweight inline caller:
  <https://github.com/pssah4/vault-operator/blob/97b77b7eb271cd48897476b699879a1fdb3dc76d/src/core/inline/InlineLLMCaller.ts>
- Canvas tool:
  <https://github.com/pssah4/vault-operator/blob/97b77b7eb271cd48897476b699879a1fdb3dc76d/src/core/tools/vault/GenerateCanvasTool.ts>
- Excalidraw tool:
  <https://github.com/pssah4/vault-operator/blob/97b77b7eb271cd48897476b699879a1fdb3dc76d/src/core/tools/vault/CreateExcalidrawTool.ts>
- Base create/query/update tools:
  <https://github.com/pssah4/vault-operator/tree/97b77b7eb271cd48897476b699879a1fdb3dc76d/src/core/tools/vault>
- Plugin shadowing rules:
  <https://github.com/pssah4/vault-operator/blob/97b77b7eb271cd48897476b699879a1fdb3dc76d/src/core/tools/shadowedByPlugin.ts>
- Startup performance issue:
  <https://github.com/pssah4/vault-operator/issues/32>
- Semantic enrichment performance issue:
  <https://github.com/pssah4/vault-operator/issues/35>
