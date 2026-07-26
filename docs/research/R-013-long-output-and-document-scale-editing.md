# R-013: Long Output Budgets and Document-Scale Editing

> [!IMPORTANT]
> **Status: Verified source/documentation investigation with architectural recommendations**
>
> **Planning use: Mandatory**
>
> This report records the 2026-07-26 investigation of long Smart Composer
> responses and 100-200 page document workflows produced by HanMark. It
> separates verified current behavior from proposed implementation. No
> document-scale edit feature was implemented during this investigation.

## 1. Executive Summary

Adding a user-facing long-output setting is useful, but it is not sufficient
for editing a 100-200 page imported document.

Two separate capabilities are required:

1. **Provider-aware output budgets**
   - Let the user choose `Auto`, `Long`, or `Maximum` for ordinary chat and
     bounded inline edits.
   - Detect and report token-limited responses.
   - Offer a real continuation action for prose responses.
   - Never label a setting `Unlimited`; every model and transport has a cap.
2. **Document edit jobs**
   - Treat whole-document summarization, rewriting, translation, cleanup, and
     restructuring as checkpointed background jobs.
   - Read an immutable source snapshot, process every structural unit, and
     assemble a separate Markdown draft.
   - Keep the foreground chat and parallel inline editor usable while the job
     runs.

The second capability is the actual solution to the reported HanMark workflow.
A single very large model response is vulnerable to output truncation,
incomplete JSON, duplicated continuation text, browser/Obsidian rendering
costs, stale-source conflicts, provider rate limits, and an unreviewable
all-or-nothing diff.

Recommended product boundary:

```text
Ordinary answer or bounded edit
  -> output budget preset
  -> stream result
  -> detect truncation
  -> optionally continue

Whole-document task
  -> Document edit job
  -> classify task shape
  -> structure-aware batches
  -> checkpoint every unit
  -> assemble a new draft
  -> section-by-section review
  -> optionally export with HanMark
```

## 2. Baselines and Evidence

### 2.1 Smart Composer baseline

Repository worktree:

```text
branch: codex/2.3-mcp-connections
version: 2.3.3
commit: 2ea77da7cc8aebeef0272701c412a18dbcc8dc58
```

Relevant prior reports:

- **R-004**: file/folder context compilation, focused retrieval, exhaustive
  direct reading, exhaustive batch summaries, and private Plan transport
  constraints.
- **R-006**: foreground chat versus checkpointed background work, scoped
  cancellation, origin anchoring, and delayed results.
- **R-008**: startup and bundle-size gates.
- **R-009**: parallel inline sessions, per-session references, immutable
  reference snapshots, and strict target-document validation.

### 2.2 HanMark baseline

Repository:

```text
https://github.com/laguna821/hanmark
tag: 2.4.2
annotated tag object: 1fed60e2a576aacad2b3424d47da503dfafbefc0
tag commit: aba617136f5dcc3e2c17666363fb2e08a29db880
```

Verified from HanMark 2.4.2 source:

- HWP, HWPX, HWPML, DOCX, PDF, XLSX, and XLS can be imported.
- One selected source document is parsed into one Markdown note.
- A multi-file import creates one Markdown note per source document.
- Imported images are persisted through Obsidian's attachment policy.
- The created note records source path, format, SHA-256, byte size, import
  time, and Kordoc version in `hwp-source-*` frontmatter.
- The imported note is created in the active note's folder when possible.
- HanMark's source-preserving HWP/HWPX operation creates a separate output
  file and does not overwrite the original.
- HanMark 2.4.2 is desktop-only.

This confirms the user's practical boundary: a 100-200 page monolithic HWP or
HWPX remains a single large Markdown note after import. HanMark does not
advertise automatic page- or chapter-splitting as part of this import route.

Sources:

- [HanMark 2.4.2 repository](https://github.com/laguna821/hanmark/tree/2.4.2)
- [HanMark 2.4.2 import implementation](https://github.com/laguna821/hanmark/blob/2.4.2/src/io/kordocImport.ts)

### 2.3 Verification boundary

This investigation used:

- Smart Composer source inspection;
- HanMark 2.4.2 source inspection;
- current primary OpenAI and Anthropic documentation;
- existing sanitized findings in R-004, R-006, R-008, and R-009.

It did not:

- send a 100-200 page private document to any provider;
- consume a live 128k output allowance;
- probe private Plan endpoints with intentionally expensive output;
- modify HanMark;
- implement a Smart Composer setting or document job.

## 3. Current Smart Composer Output Behavior

### 3.1 Chat does not set an output budget

`src/utils/chat/responseGenerator.ts` sends the normal streaming request with:

```ts
{
  model,
  messages,
  tools,
  stream: true,
}
```

It does not pass `max_tokens`. The effective output behavior is therefore
decided by the provider adapter and backend defaults.

### 3.2 Inline edit does not set an output budget

`src/core/inline/InlineEditController.ts` sends a non-streaming request with:

```ts
{
  model,
  messages: [systemMessage, userMessage],
}
```

It also omits `max_tokens`.

The setting named `Inline edit surrounding context` only limits the characters
read before and after the selected range. The complete selected range is always
included. The settings UI correctly states that this value does not increase
generated output length.

Consequences:

- changing `contextCharacters` to `99999` cannot increase output length;
- a whole-note selection can still make the input enormous;
- the requested replacement can independently exceed the output allowance.

### 3.3 Provider defaults are materially different

Current adapter behavior:

| Path | Current effective behavior when the caller omits `max_tokens` |
| --- | --- |
| GPT Plan / private Codex | Sends no explicit output-limit property |
| Claude Sonnet 5 Plan | Smart Composer sends `max_tokens: 32768` |
| Other Claude Plan models | Smart Composer normally sends `max_tokens: 8192` |
| Anthropic API-key models | Smart Composer normally sends `max_tokens: 8192` |
| OpenAI API-key adapter | Leaves its legacy `max_tokens` field undefined |
| Gemini API-key adapter | Leaves `maxOutputTokens` undefined |

The existing `ProviderCapabilities.outputTokenLimit` already records one
important distinction: GPT Plan does not support explicit output-token
configuration through the current private transport.

### 3.4 GPT Plan cannot use the public field blindly

R-004 live testing established that the private Codex Plan endpoint rejects
`max_output_tokens`. The current adapter therefore intentionally removes both
`max_tokens` and `max_output_tokens`.

Official OpenAI documentation lists GPT-5.6 Sol, Terra, and Luna with:

- 1.05M context windows;
- 128k maximum output.

That public model capability does not prove that the private subscription
transport accepts public Responses API request fields or gives every plugin
request the full public maximum. Smart Composer must show GPT Plan as
`Provider managed` until the private transport contract is separately verified.

OpenAI also defines `max_output_tokens` as an upper bound that includes visible
output and reasoning tokens. A 128k limit therefore does not guarantee 128k of
visible rewritten Markdown.

Sources:

- [OpenAI model catalog](https://developers.openai.com/api/docs/models)
- [OpenAI Responses streaming and incomplete events](https://platform.openai.com/docs/api-reference/responses-streaming/response/incomplete)

### 3.5 Claude supports more than Smart Composer currently requests

Current Anthropic documentation lists Claude Sonnet 5 with:

- a 1M context window;
- 128k maximum synchronous output;
- adaptive thinking;
- a new tokenizer.

The same documentation warns that `max_tokens` is a hard limit shared by
thinking and visible response text. Smart Composer currently requests 32,768
for Sonnet 5 Plan and 8,192 for Anthropic API-key requests unless a caller
overrides it.

Therefore, a provider-aware setting could immediately improve some Claude
workflows. However, the private Claude Plan endpoint must be tested before
assuming that all public API maxima are accepted there.

Anthropic also exposes a model-aware token-counting endpoint for API users.
Smart Composer's local `cl100k_base` count is useful for routing but is not an
authoritative Claude Sonnet 5 count. Anthropic states that Sonnet 5's tokenizer
produces approximately 30 percent more tokens than Sonnet 4.6 for the same
text, with workload-dependent variation.

Sources:

- [Claude Sonnet 5 changes and limits](https://platform.claude.com/docs/en/about-claude/models/whats-new-sonnet-5)
- [Claude models overview](https://platform.claude.com/docs/en/about-claude/models/overview)
- [Claude token counting](https://platform.claude.com/docs/en/build-with-claude/token-counting)

## 4. Current Truncation and Continuation Gaps

### 4.1 Finish reasons are discarded by chat

The common response type carries `finish_reason`, including `length`.
`codexMessageAdapter.ts` maps a private `response.incomplete` terminal event to:

```ts
finish_reason: 'length'
```

`ResponseGenerator.processChunk()` currently appends content, reasoning,
annotations, usage, and provider metadata but does not retain the finish
reason. `ChatAssistantMessage.metadata` has no completion-status field.

The UI therefore cannot distinguish:

- a normal stop;
- an output-limit stop;
- a provider refusal;
- a content-filter stop;
- an interrupted stream that happened to leave partial text.

### 4.2 `Continue Response` is not a length continuation

The existing button is shown only when:

1. no generation is running;
2. the latest chat message is a tool message;
3. all tool calls have reached terminal states.

It resubmits tool history so the model can continue after tools. It is not
shown when a long prose answer reaches `finish_reason: length`.

### 4.3 Inline truncation is more dangerous

Inline edit asks the model for JSON:

```json
{"type":"replacement","content":"..."}
```

or:

```json
{"type":"insertion","content":"..."}
```

If the response is cut before valid JSON is complete, `parseInlineResponse()`
falls back to treating the raw response as replacement text for compatibility
with older/custom models. The current controller does not inspect the
non-streaming response's finish reason before presenting a preview.

For a large replacement this can turn a truncated fragment into an apparently
reviewable result. Strict target-snapshot checks prevent stale document writes,
but they do not prove that the model produced the complete requested document.

## 5. Why `Maximum Output` Alone Does Not Solve 100-200 Pages

### 5.1 An upper bound is not a target

`max_tokens` or `max_output_tokens` only allows the model to generate up to a
limit. The model may stop earlier. Prompt wording, output format, verbosity,
reasoning effort, safety behavior, and backend policy still affect length.

### 5.2 Input capacity and output capacity are different problems

A whole-note edit requires room for:

- system instructions;
- the editing prompt note;
- the complete source document;
- surrounding conversation and tool definitions;
- internal reasoning;
- the complete rewritten result.

Even when a document fits the input context, its rewritten copy may exceed the
output cap. A model with a 1M input context and 128k maximum output can read a
document that it cannot reproduce in one answer.

### 5.3 Reasoning consumes output budget

For the current frontier OpenAI and Anthropic models, reasoning/thinking shares
the requested output allowance with visible text. High or maximum reasoning
can leave substantially less room for the final Markdown.

### 5.4 Auto-continuation is not lossless document assembly

A generic `Continue from where you stopped` loop can:

- repeat the last paragraph;
- skip a boundary;
- change headings or list numbering;
- reopen or fail to close a Markdown fence;
- lose table rows;
- reinterpret an earlier instruction;
- create an answer whose pieces are difficult to validate.

It is acceptable for an essay-like chat answer with visible segment markers.
It is not a reliable editing protocol for an exact whole-document transform.

### 5.5 One enormous chat message is poor Obsidian UX

Even if a provider returns the entire document:

- incremental Markdown rendering becomes expensive;
- the conversation becomes difficult to navigate;
- copying and reviewing a 100-page assistant bubble is awkward;
- retrying one failed section requires regenerating too much;
- applying the result lacks an auditable per-section boundary;
- a long-running foreground response blocks the conversational flow.

R-006's foreground/background separation applies directly: the chat should
start and report a document job rather than become the document's storage
surface.

## 6. Recommended Capability A: Provider-Aware Output Budgets

### 6.1 User-facing presets

Add separate defaults for:

- `Chat output length`;
- `Inline edit output length`.

Recommended choices:

| Preset | Meaning |
| --- | --- |
| `Auto` | Current provider/model default; recommended |
| `Long` | A tested larger allowance suitable for long articles and sections |
| `Maximum` | Highest verified allowance for this exact transport/model |

Do not expose an arbitrary number as the primary UI. An optional advanced
numeric override can exist only for custom/API providers and must be clamped to
known capabilities.

The composer and inline prompt should also provide a one-request override. A
global settings change should not be necessary just to produce one long result.

### 6.2 Capability contract

Replace the current boolean with a policy:

```ts
type OutputBudgetCapability =
  | {
      mode: 'explicit'
      presets: {
        auto?: number
        long: number
        maximum: number
      }
      parameter: 'max_tokens' | 'max_output_tokens' | 'maxOutputTokens'
    }
  | {
      mode: 'provider-managed'
      reason: string
    }
  | {
      mode: 'unknown'
      reason: string
    }
```

This policy must be keyed by transport and tested model capability, not merely
by a model-name substring.

Expected starting behavior:

| Transport | UI behavior |
| --- | --- |
| GPT Plan private Codex | `Provider managed`; no fake numeric maximum |
| Claude Plan | Explicit presets only after live transport validation |
| Anthropic API | Explicit model-aware presets |
| OpenAI API | Explicit only after correcting and testing the adapter contract |
| Gemini API | Explicit model-aware presets |
| Custom OpenAI-compatible | Advanced/unknown with a clear compatibility warning |

### 6.3 Completion status

Persist an assistant completion status:

```ts
type AssistantCompletionStatus =
  | 'complete'
  | 'length'
  | 'content-filter'
  | 'refusal'
  | 'interrupted'
  | 'unknown'
```

The provider adapter may also retain a sanitized provider reason. The UI must
show `Output limit reached` only when supported by the actual terminal event.

### 6.4 Prose continuation

For side-chat prose, add:

- `Continue answer` on `length`;
- optional `Continue automatically`, off by default;
- a bounded segment count;
- segment labels such as `Part 2 of continued response`;
- overlap detection against the previous tail;
- cancellation between segments;
- a visible accumulated token/segment estimate.

Do not overload the tool-history `Continue Response` button. The two actions
have different causes and should have different labels and state.

### 6.5 Inline safety

For inline responses:

- reject or warn on `finish_reason: length`;
- never present token-truncated JSON as a complete replacement;
- preserve the partial text only in an expandable diagnostic/recovery area;
- offer `Retry with Long`, `Retry with Maximum`, or `Run as document job`;
- require a structurally complete response before enabling Accept/Insert.

## 7. Recommended Capability B: Document Edit Jobs

### 7.1 Entry points

Offer the document workflow from:

- a large whole-note inline selection;
- a side-chat request targeting the current note;
- a mentioned HanMark-imported note;
- a command such as `Smart Composer: Edit whole document`;
- a slash command such as `/document-edit`.

Suggested large-selection prompt:

```text
This edit is too large for a reliable single inline response.

Estimated source: 142k tokens
Requested result: full-document rewrite

[Start document edit job] [Run inline anyway] [Cancel]
```

`Run inline anyway` should remain available after warning when the model and
transport can plausibly fit the request. It must not be the default for a
full-document rewrite.

### 7.2 Task-shape classifier

The job must choose a processing strategy based on the requested outcome:

| Task shape | Strategy |
| --- | --- |
| Summary, outline, findings, extraction | Hierarchical map/reduce |
| Proofread, rewrite, translate, reformat | Structure-preserving chunk transform |
| Question answering | Existing focused or exhaustive context path |
| Insert a short synthesis below a huge selection | Read-all/map-reduce, then one bounded insertion |

The user's explicit mode should override automatic classification. The UI must
show the selected strategy before starting.

Existing R-004 exhaustive batch summaries are suitable evidence for
question-answering and synthesis, but not for lossless rewriting. A summary
cannot substitute for source text when every sentence must be edited.

### 7.3 Immutable source and edit specification

At job start, store:

- source vault path;
- source checksum and modification time;
- source length and estimated tokens;
- editing instruction;
- resolved prompt-note/reference snapshots;
- selected model and provider;
- output-budget policy;
- task strategy.

Run one bounded planning pass that converts the user's instruction and
referenced prompt note into a stable edit specification:

```ts
type DocumentEditSpecification = {
  goal: string
  preserve: string[]
  transform: string[]
  outputLanguage?: string
  formattingRules: string[]
  forbiddenChanges: string[]
}
```

Every chunk receives the same immutable specification.

### 7.4 Structure-aware segmentation

Split Markdown deterministically:

1. frontmatter;
2. heading sections;
3. paragraphs and lists;
4. complete tables;
5. complete code fences and callouts;
6. character-budget fallback only when one atomic block is itself too large.

Each unit needs:

- a stable source ID;
- source offsets;
- heading ancestry;
- previous/next read-only overlap;
- checksum;
- expected output order.

Overlap is context only and must never be emitted twice.

Frontmatter is protected by default. Editing it requires an explicit user
instruction and separate structured validation.

### 7.5 Checkpointed processing

Use a document task record:

```ts
type DocumentEditTask = {
  id: string
  sourcePath: string
  sourceChecksum: string
  destinationPath?: string
  strategy: 'map-reduce' | 'transform' | 'question'
  status:
    | 'queued'
    | 'planning'
    | 'running'
    | 'paused'
    | 'assembling'
    | 'review'
    | 'succeeded'
    | 'failed'
    | 'canceled'
    | 'interrupted'
  chunks: DocumentChunkCheckpoint[]
}
```

Every completed chunk is checkpointed. On Obsidian shutdown, a running task
becomes `interrupted`; the user explicitly resumes it. Completed chunks are
not regenerated unless their inputs or specification changed.

Use bounded concurrency rather than launching every section at once. The
initial recommendation is one active provider request, with an opt-in maximum
of two only after real Plan rate-limit testing.

### 7.6 Deterministic assembly and validation

Before presenting a draft:

- verify that every source unit has exactly one terminal result;
- reject duplicate or missing unit IDs;
- validate Markdown fence balance;
- validate table and frontmatter boundaries;
- assemble strictly by source order;
- record chunk-level warnings;
- compare heading coverage against the source outline;
- write atomically to a separate Markdown draft.

A global coherence pass may review an outline and report issues. It must not
silently rewrite the complete assembled document in one final request, because
that would recreate the original output-limit problem.

### 7.7 Review and destination

Default destination:

```text
<source name> - Smart Composer draft.md
```

Do not overwrite the imported note by default.

The review UI should provide:

- overall progress and token estimate;
- current/failed section counts;
- pause, resume, cancel, and retry-failed;
- source and draft links;
- section-by-section before/after diff;
- accept one section, reject one section, or accept all reviewed sections;
- stale-source warning if the original changed after the snapshot.

The sidebar should show a compact task card, not the complete rewritten
document as one assistant bubble.

## 8. HanMark Integration Boundary

Smart Composer should remain useful for every Markdown note. HanMark is an
optional source/export companion, not a hard dependency.

Recommended loose integration:

1. Detect `hwp-source-*` frontmatter.
2. Label the task `Imported HWP/HWPX/DOCX/PDF document`.
3. Preserve the frontmatter contract in the draft unless explicitly changed.
4. After approval, offer `Open draft` and, when HanMark is installed,
   `Export with HanMark`.
5. Let HanMark own HWPX/DOCX generation, templates, source-preserving output,
   and format validation.

Do not copy HanMark parsers into Smart Composer and do not make Smart Composer
responsible for HWPX serialization.

The resulting workflow is:

```text
HWP/HWPX/PDF/DOCX
  -> HanMark import
  -> one source-tracked Markdown note
  -> Smart Composer document edit job
  -> reviewed Markdown draft
  -> HanMark HWPX/DOCX/HTML export
```

## 9. UX Recommendation

### 9.1 Side chat

For an ordinary long answer:

```text
Long output · Provider managed
```

or:

```text
Maximum output · 128k verified API limit
```

When truncated:

```text
Output limit reached
[Continue answer] [Save partial as note]
```

For a whole-document request:

```text
Document edit job
Planning -> 18/74 sections -> Assembling -> Review

[Open task] [Pause] [Cancel]
```

The job card remains origin-anchored as required by R-006. A compact global
task accordion may also expose active document jobs without moving their
canonical result.

### 9.2 Inline edit

Keep ordinary parallel inline panels unchanged for bounded edits.

For a large selection, change the primary action:

```text
Large selection · 136k estimated input tokens

[Start document job]
[Generate one response]
```

Prompt-note and folder mentions from R-009 remain per-session and become
immutable job references when promoted to a document task.

### 9.3 Settings

Proposed settings group:

```ts
generation: {
  chatOutputBudget: 'auto' | 'long' | 'maximum'
  inlineOutputBudget: 'auto' | 'long' | 'maximum'
  chatContinuation: 'ask' | 'automatic' | 'off'
  maxContinuationSegments: number
}

documentEditing: {
  largeEditRouting: 'ask' | 'automatic' | 'off'
  destinationFolder: string | null
  preserveFrontmatter: true
  concurrency: 1 | 2
}
```

Exact token numbers should be supplied by provider capability data and shown
in the UI. They should not be persisted as universal assumptions.

## 10. Token Estimation

Current Smart Composer lazily loads `cl100k_base` and uses it for retrieval
routing. That remains a reasonable OpenAI-oriented local estimate but is not a
universal tokenizer.

Recommended estimator contract:

```ts
type TokenEstimate = {
  tokens: number
  confidence: 'exact-provider' | 'model-local' | 'approximate'
  modelId: string
  includes: string[]
}
```

Priority:

1. provider token-count endpoint when supported and authorized;
2. verified local tokenizer for the model family;
3. conservative local estimate with a visible `approximate` label.

The estimate shown before a document job should include:

- source;
- prompt-note references;
- system/task specification;
- expected output ratio;
- planned chunk count;
- estimated total provider input and output across all calls.

It should warn about subscription/rate-limit usage even for Plan accounts.
`No API key` does not mean unlimited requests or unlimited tokens.

## 11. Failure and Recovery Rules

- A single failed section does not discard completed sections.
- Authentication failure pauses the job and exposes `Resume`.
- Rate limits use bounded backoff and keep checkpoints.
- Content refusal marks only the affected unit and asks the user whether to
  retry with a revised instruction, keep the source unit, or cancel.
- Token truncation retries that unit with a smaller structural split or larger
  verified budget.
- Network interruption never enables final approval for an incomplete unit.
- Source changes do not silently merge into the snapshot.
- Destination writes are atomic.
- No raw OAuth token, API key, prompt-note secret, or complete document body is
  stored in diagnostic logs.

## 12. Implementation Phases

### Phase 1: truthful long-output controls

- retain finish reasons in chat/inline result metadata;
- show token-limit/refusal/interruption states;
- add provider-aware `Auto / Long / Maximum`;
- add real prose continuation;
- block acceptance of truncated inline JSON;
- add unit/provider contract tests.

This phase improves long articles and bounded edits but must not be marketed as
whole-document editing.

### Phase 2: document edit jobs

- task-shape classifier and explicit strategy control;
- immutable source/reference snapshot;
- structure-aware chunks;
- checkpointed transform and map/reduce;
- deterministic assembly;
- separate draft and section review;
- background task card while chat remains usable.

### Phase 3: HanMark workflow affordances

- detect source frontmatter;
- preserve HanMark provenance;
- optional `Export with HanMark` handoff;
- end-to-end HWPX -> Markdown -> edited draft -> HWPX smoke test.

## 13. Test Plan

### Provider/output contracts

- GPT Plan never sends unsupported `max_output_tokens`.
- GPT Plan UI says `Provider managed`.
- Claude Plan/API presets map only to verified accepted values.
- OpenAI API uses the correct parameter for its endpoint/model.
- Gemini API maps explicit budgets to `maxOutputTokens`.
- custom providers cannot claim an unverified maximum.

### Completion handling

- `stop`, `length`, refusal, filter, abort, and network loss remain distinct.
- a Codex `response.incomplete` creates `length`.
- chat exposes prose continuation only for the appropriate states.
- tool continuation remains separate.
- truncated inline JSON cannot be accepted as complete.

### Synthetic long documents

Generate private synthetic fixtures rather than using personal documents:

- 100-page-equivalent Korean prose;
- 200-page-equivalent Korean prose;
- headings nested to six levels;
- long Markdown tables;
- lists, callouts, code fences, footnotes, and images;
- one huge headingless section;
- source frontmatter matching HanMark's public contract.

Verify:

- every unit is processed exactly once;
- output order is stable;
- overlaps are not duplicated;
- fences/frontmatter remain valid;
- pause/reload/retry resumes from checkpoints;
- a failed unit prevents final success;
- source mutation produces a stale warning;
- the original is never overwritten without explicit approval.

### UX and performance

- chat remains usable while a document job runs;
- multiple inline sessions remain independent;
- 320, 400, and 800 px sidebar widths;
- Hallym Light and CMDS Dark;
- large job history does not mount every diff eagerly;
- no new eager tokenizer/provider load at startup;
- production bundle remains within R-008's 5.2 MiB gate.

### Live release gates

- one bounded GPT Plan long answer;
- one bounded Claude Plan long answer;
- one deliberately truncated test with non-sensitive synthetic text;
- one HanMark synthetic HWPX import and round-trip export;
- one interrupted/restarted document job.

A live 128k-output test is not required for every release and should never run
without an explicit cost/usage decision.

## 14. Known Unknowns

- The effective maximum visible output of the private GPT Plan transport.
- Whether the private Claude Plan transport accepts Sonnet 5's public 128k
  maximum or a lower subscription-specific cap.
- The best conservative token multiplier for Korean text across Plan models.
- Whether HanMark/Kordoc emits useful page-break markers for every source
  format; document jobs must not depend on this.
- The optimal chunk size and concurrency under real Plan rate limits.
- Whether accepted section patches should eventually merge into the original
  note or always remain a separate reviewed draft.
- Whether a future provider-native asynchronous Batch API is appropriate for
  API-key users. It is not assumed available to Plan accounts.

These are validation tasks, not established capabilities.

## 15. Decision

The proposed output option should be added, but its product promise must be:

> Let ordinary chat and bounded inline edits use the longest verified output
> budget available on the selected provider, and clearly recover from
> truncation.

The promise for 100-200 page editing must be different:

> Process the complete document as a resumable, auditable job and produce a
> separate reviewed Markdown draft without requiring the user to manually ask
> for parts 1-20.

This pairing preserves Smart Composer's lightweight inline/chat strengths while
adding the document-scale workflow that HanMark imports make practically
necessary.

## 16. Privacy Statement

No personal vault note, imported HWP/HWPX/PDF/DOCX content, OAuth token, API
key, or provider secret was read or recorded. Source inspection used public
repositories, local Smart Composer code, public documentation, and prior
sanitized reports.

