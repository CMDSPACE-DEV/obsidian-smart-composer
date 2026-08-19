# R-006: Foreground Chat, Background Tasks, and Delayed Results

> [!IMPORTANT]
> **Status: Verified / Mandatory planning input**
>
> Any roadmap that removes the legacy Apply flow, adds GPT Plan image
> generation, introduces background MCP work, changes Stop behavior, or permits
> chat continuation during long-running work must read this report together
> with R-001, R-002, R-003, and R-005.

## 1. Executive Summary

The user's proposed product split is technically sound:

```text
Right sidebar chat
  -> conversation, explanation, analysis, full-length output, copy,
     references, and completed artifacts

Inline edit
  -> selection/cursor-targeted rewrite, preview, accept, and reject

Background task lane
  -> image generation, long MCP research, uploads, and other delayed work
```

The existing Cursor-style Apply action in Smart Composer is not merely a button
that feels slow. Source inspection confirms that it starts a second model call,
sends the current full file plus chat context and the selected assistant block,
rewrites the whole file, opens a separate `ApplyView`, and then asks the user to
review the result. R-002 already established that an editor-anchored,
selection-scoped inline lane has much lower interaction cost.

The user's report that the Copy action is used roughly 99% of the time is a
valuable product observation, but it is not instrumented telemetry. It should be
recorded as a user-approved custom-build direction, not presented as a measured
population statistic.

For this custom build, the recommended separation is:

1. Remove the LLM-powered Apply action from the redesigned right chat.
2. Keep Copy and other deterministic export actions.
3. Put AI-assisted document mutation in the R-002 inline-edit lane.
4. Represent long work as first-class background tasks rather than as one
   globally blocking chat stream.

The central concurrency question has a clear answer:

> A single visible chat can handle an older delayed result and newer ongoing
> conversation, but the delayed work must not be represented as an ordinary
> assistant message appended whenever it finishes.

Instead:

- create a task with a stable `taskId`;
- bind it to the user message that created it through `originMessageId`;
- render a task anchor immediately below that originating message;
- let the foreground text conversation continue independently;
- update the anchor in place when the task changes state;
- show a compact global task shelf for all active work;
- notify the user when attention is needed or the artifact is ready;
- offer `Continue from result` to create a new current-end turn that explicitly
  references the completed task.

This preserves causality. It avoids the false appearance that later chat turns
had access to an image or legal-research result that did not exist yet.

Current Smart Composer cannot support this by enabling concurrent
`useMutation()` calls alone:

- every new foreground submit calls `abortActiveStreams()`;
- the mutation function calls it again before starting;
- one global `isPending` controls the Stop button;
- one global `QueryProgressState` describes only one operation;
- the response subscriber rewrites the message suffix after its source user
  message;
- MCP auto-continuation assumes its tool message is the final message;
- chat persistence stores only a linear `ChatMessage[]`;
- no task, artifact, attempt, anchor, or per-operation cancellation model
  exists.

The recommended architecture therefore has two lifecycles:

```text
ForegroundConversationController
  one active text response per conversation
  linear conversational context
  Stop Response affects only this response

BackgroundTaskManager
  multiple named tasks with independent IDs, state, attempts, cancellation,
  persistence, artifacts, and concurrency limits
```

GPT Plan image generation should initially be an **in-app background task**:
the network stream continues while Obsidian remains open, but the user can keep
chatting. R-001 did not verify a durable server-side Plan job API. OpenAI's
documented public Responses `background` mode is useful architectural evidence,
but it is an API-key feature and must not be assumed to work on the internal
ChatGPT/Codex Plan endpoint.

MCP requires an additional distinction:

- normal MCP calls are request-bound and may block the answer that needs them;
- the experimental MCP Tasks protocol supports durable task IDs, deferred
  result retrieval, `input_required`, progress, and cancellation;
- Smart Composer's installed MCP SDK contains experimental task types, but the
  current `McpManager` does not negotiate or use them;
- a generic MCP tool cannot be treated as durable background work unless the
  server advertises task support, or Smart Composer knowingly wraps it as a
  client-owned in-app task with weaker restart guarantees.

The lightweight product rule is:

> Keep one fast foreground conversation, detach only operations whose result is
> independently useful, and make every detached result return to its original
> context without blocking writing.

## 2. Scope and Evidence Labels

This investigation covers:

- current Smart Composer Apply and Copy behavior;
- current foreground stream, Stop, tool, and persistence architecture;
- GPT Plan image generation as a long-running task;
- delayed result placement in a continuing conversation;
- background MCP and future Korean-law research workflows;
- task state, cancellation, persistence, and UI;
- the relationship between R-002 inline editing and the right sidebar;
- official background-task and MCP task specifications.

Evidence labels:

- **Verified - source**: confirmed in the current workspace source.
- **Verified - live report**: reproduced in a prior mandatory report.
- **Verified - official documentation**: confirmed by first-party
  documentation.
- **User observation**: reported from real use but not measured through product
  telemetry in this investigation.
- **User-approved direction**: explicitly selected for the custom product.
- **Inference**: architecture or UX conclusion derived from verified evidence.
- **Proposal**: recommended design pending implementation and live validation.

### Verified in this investigation

- The current workspace version, commit, and relevant dependency versions.
- The current global foreground abort and Stop behavior.
- The current message-suffix replacement behavior during streaming.
- The current single `QueryProgressState` and mutation status.
- The current MCP request cancellation and auto-resume assumptions.
- The current chat-history data model.
- The current Apply pipeline and Copy action locations.
- OpenAI's documented public background-response lifecycle.
- OpenAI Codex's separate-thread approach to parallel long-running tasks.
- MCP cancellation and progress behavior.
- The experimental MCP Tasks state and capability model.
- TanStack Query's parallel mutation and scope behavior.
- VS Code's first-party guidance to keep progress contextual and notifications
  limited.

### Not verified in this investigation

- Whether the internal GPT Plan endpoint accepts `background: true`.
- Whether the Plan endpoint allows a stream to reconnect using a public
  Responses-style cursor.
- Whether concurrent Plan image and text requests trigger practical quota,
  account, or rate-limit conflicts.
- Whether the user's intended Korean Law MCP server advertises MCP Tasks.
- Whether all relevant MCP servers honor cancellation promptly.
- Whether mobile Obsidian keeps an in-app network task alive after suspension.
- Final task-shelf dimensions and interaction on the user's desktop/mobile
  layouts.
- Population-level usage statistics for Copy versus Apply.
- Whether any user still depends on the legacy Apply flow in the custom build.

These remain implementation probes or acceptance tests.

## 3. Repository and Version Baseline

Workspace baseline:

```text
branch: main
commit: 6f6413737c5ece801904b89884ec5ab8c1e4f207
commit title: Release Smart Composer Achmage 1.3.1
package version: 1.3.1
```

Relevant declared dependencies:

```text
@modelcontextprotocol/sdk: ^1.9.0
@tanstack/react-query: ^5.56.2
```

Installed MCP SDK inspected:

```text
@modelcontextprotocol/sdk: 1.25.2
```

The installed SDK includes experimental MCP Task schemas and client support,
including:

```text
CreateTaskResult
tasks/get
tasks/list
tasks/cancel
notifications/tasks/status
Tool.execution.taskSupport
```

The application code does not currently use that task surface.

Primary source paths inspected:

```text
src/components/chat-view/Chat.tsx
src/components/chat-view/useChatStreamManager.ts
src/components/chat-view/AssistantMessageContent.tsx
src/components/chat-view/AssistantToolMessageGroupActions.tsx
src/components/chat-view/MarkdownCodeComponent.tsx
src/components/chat-view/ToolMessage.tsx
src/utils/chat/responseGenerator.ts
src/utils/chat/apply.ts
src/hooks/useChatHistory.ts
src/types/chat.ts
src/core/mcp/mcpManager.ts
src/core/llm/openaiCodexProvider.ts
src/core/llm/codexMessageAdapter.ts
src/database/json/chat/ChatManager.ts
package.json
package-lock.json
```

## 4. Right-Chat Apply and Copy Findings

### 4.1 Current Apply is a second generation workflow

The code-block Apply control calls:

```text
MarkdownCodeComponent
  -> onApply(block text)
  -> Chat.applyMutation
  -> read the active full file
  -> resolve settings.applyModelId
  -> applyChangesToFile()
  -> send full file + recent chat + selected block to another model call
  -> receive rewritten full-file content
  -> open a separate ApplyView
```

This is not deterministic insertion. It is a second broad rewrite.

Consequences:

- additional model latency;
- another Plan/API request;
- a full-document context payload;
- a context switch from chat to `ApplyView`;
- a larger stale-document risk;
- a review model oriented around the whole file rather than the exact source
  range;
- a global `applyMutation.isPending` shared by all assistant blocks.

`AssistantToolMessageGroupItem` even contains a source TODO noting that
`isApplying` should be per assistant message. The current global flag is another
sign that this path was not designed for multiple concurrent operations.

### 4.2 Current Copy is already lightweight

Smart Composer exposes Copy in two places:

- a group-level Copy action for assistant and tool content;
- code-block Copy actions at the block header and footer.

Copy performs a direct clipboard write and does not call a model.

### 4.3 Product interpretation

**User observation:** in the user's actual workflow, the Copy control above
Apply is used in approximately 99% of relevant cases. The user also observes
that people moved toward Claudian because its editor-local edit flow feels more
direct.

**Verified related finding from R-002:** Claudian's advantage is lower
interaction cost, not a proven faster model. It targets a source selection or
cursor, keeps the workflow at the editor location, previews the local change,
and applies through `replaceRange`.

**Recommended custom-build decision:**

```text
Remove:
  LLM-powered code-block Apply from the redesigned sidebar

Preserve:
  Copy message
  Copy code block
  View formatted/raw
  references and response metadata

Optional deterministic exports:
  Insert exact text at current cursor
  Append exact text to active note
  Create note from response
```

An exact Insert action, if added, must not be named Apply and must not perform a
hidden second model rewrite.

### 4.4 Right chat versus inline edit

Right chat should optimize for maximum useful output:

- answer the complete question;
- show long Markdown naturally;
- preserve references and retrieval metadata;
- show generated artifacts;
- provide Copy/export actions;
- avoid forcing every answer into an edit proposal.

Inline edit should own:

- selection replacement;
- cursor insertion requests;
- style-preserving rewrites;
- clarification near the source;
- local diff;
- Apply/Reject;
- stale-range protection.

This removes one duplicated mental model:

```text
Old:
  chat answer -> Apply -> second model -> whole-file review

New:
  chat answer -> read/copy/export
  editor selection -> inline request -> local preview -> accept/reject
```

## 5. Current Foreground Stream Architecture

### 5.1 Every new submit aborts current foreground work

`Chat.handleUserMessageSubmit()` calls:

```ts
abortActiveStreams()
```

Then `useChatStreamManager.submitChatMutation.mutationFn()` calls the same
function again before creating a new `AbortController`.

The composer remains visually available, but submitting another prompt does not
create a second independent response. It terminates the previous stream.

### 5.2 Stop is global

`useChatStreamManager` stores:

```ts
activeStreamAbortControllersRef: AbortController[]
```

`abortActiveStreams()` aborts every controller in the array.

`Chat.tsx` displays one Stop Generation button whenever:

```ts
submitChatMutation.isPending
```

There is no operation ID, response ID, task ID, or per-item Stop target in the
UI state.

### 5.3 Streaming updates assume a linear message suffix

The stream subscriber finds the source user message and returns:

```text
all messages up to and including source user message
  + current response generator messages
```

This behavior is safe only while one response owns the conversation suffix.

If multiple foreground responses were allowed without redesign:

- one stream could remove messages appended by another;
- completion order could rewrite visual order;
- a late chunk could overwrite a newer suffix;
- persistence could record whichever stream emitted last;
- auto-scroll would fire for unrelated work.

Therefore, merely removing `abortActiveStreams()` would create data corruption
risk.

### 5.4 ResponseGenerator owns one snapshot

Each `ResponseGenerator` receives:

```text
receivedMessages: ChatMessage[]
responseMessages: ChatMessage[]
one abortSignal
```

It appends assistant/tool messages to its local response suffix. It has no
parent-turn identifier beyond the source message used by the outer subscriber.

### 5.5 Tool continuation assumes the tool result is last

Current MCP behavior:

1. model emits a function call;
2. `ResponseGenerator` creates a tool message;
3. the tool runs under the conversation response's abort signal;
4. the model resumes when all tool calls finish;
5. manual tool completion resumes only when that tool message is still the last
   message.

This is correct for a blocking tool inside one response. It is not a background
job model.

### 5.6 Query progress is singular

`Chat.tsx` owns one:

```ts
QueryProgressState
```

It can describe one retrieval compilation path. Parallel background tasks need
their own phase/progress state and must not overwrite the current foreground
retrieval status.

### 5.7 Persistence is message-only

Chat history serializes:

```text
user
assistant
tool
```

There is no first-class:

```text
task
task anchor
artifact
attempt
progress
provider job ID
resume cursor
input-required request
completion acknowledgement
```

### 5.8 Test gap

No source tests were found for:

- `useChatStreamManager`;
- foreground cancellation races;
- concurrent responses;
- Stop scoping;
- background tasks;
- task persistence;
- delayed task result projection.

## 6. Why a Naive Queue Is Not Enough

The word "queue" can describe several different behaviors:

### A. Serial chat queue

```text
image request runs
new text prompt waits behind it
```

This preserves order but fails the user's goal. Writing remains blocked.

### B. Parallel network calls with one transcript

```text
image and text both run
whichever finishes appends next
```

This keeps the network busy but breaks conversational causality.

### C. Separate full chats for every task

```text
image has its own chat/thread
text remains in current chat
```

This resembles Codex and is appropriate for large agent work, but is too heavy
as the only interaction for a lightweight Obsidian image generation request.

### D. Foreground chat plus anchored task sidecars

```text
text remains linear
long operation becomes a task attached to its origin
task updates independently
```

This best fits the stated Smart Composer product.

The recommendation is D, with an optional task drawer for supervision.

## 7. Recommended Three-Lane Product Model

### 7.1 Foreground conversation lane

Purpose:

- ordinary questions;
- explanations;
- vault/folder analysis;
- text generation;
- follow-up conversation;
- blocking tools required to form the current answer.

Constraint:

- one active foreground text response per conversation;
- a new foreground prompt may stop/replace the prior foreground response after
  a clear policy decision;
- background tasks continue unaffected.

### 7.2 Inline edit lane

Purpose:

- source selection rewrite;
- cursor insertion;
- compact local transformation;
- Apply/Reject at the document location.

Constraint:

- one active inline edit at a time, consistent with R-002;
- independent from sidebar chat;
- its Stop/Cancel affects only the inline request;
- it does not consume the background task shelf unless explicitly promoted to
  a long task.

### 7.3 Background task lane

Purpose:

- GPT Plan image generation;
- R2 upload and post-processing;
- long MCP research;
- future deterministic artifact generation;
- operations whose result is independently useful after the current chat turn.

Constraint:

- each task has a stable ID and owner;
- each task has independent cancellation;
- completion order does not change conversation order;
- results are artifacts or task results, not retroactive normal messages;
- concurrency is bounded by task class and provider capability.

## 8. The Delayed-Result Causality Model

### 8.1 Origin binding

Every background task records:

```text
conversationId
originMessageId
originPromptSnapshot
contextSnapshot or contextMessageIds
createdAt
```

This answers:

- who requested the work;
- which conversation owns it;
- what the request meant at dispatch time;
- where its UI anchor belongs;
- which context may be replayed on retry.

### 8.2 Insert a placeholder immediately

When the user requests an image:

```text
User: "Create a 1920x1080 diagram of this workflow."

[Task anchor appears immediately]
Generating image...
```

The composer becomes available again as soon as task creation succeeds locally.
The network task continues separately.

### 8.3 Continue foreground chat normally

The user can then ask:

```text
User: "While that runs, summarize this note in five bullets."
Assistant: ...
```

This foreground response does not wait for the image.

### 8.4 Update the old anchor in place

When the image finishes, do not append:

```text
Assistant: "Here is the image..."
```

at the bottom after unrelated later turns.

Instead update the original task anchor:

```text
[Image ready]
preview
Open full size
Insert
Upload to R2
Copy Markdown
```

The completion time changes, but the task's semantic origin does not.

### 8.5 Notify without hijacking scroll

If the user is reading or writing elsewhere:

- do not force-scroll to the old anchor;
- increment a task-ready badge;
- show one compact completion notification;
- provide `View result`;
- focus/scroll to the anchor only on user action.

This follows the general first-party UX principle that progress should remain
contextual and global notifications should be limited.

### 8.6 Do not rewrite conversational history

Later foreground responses generated while a task was pending did not see its
result. The plugin must not later reconstruct provider history as though they
did.

Therefore:

- a task result is not automatically inserted into the historical provider
  message sequence before already-generated turns;
- pending task metadata may be represented locally, but not as completed
  content;
- completed task results become available to future turns after completion;
- large image bytes are never replayed automatically;
- a compact artifact summary or explicit attachment can enter a future prompt.

### 8.7 Continue from result

The result card should offer:

```text
Continue from result
```

This creates a new turn at the current end of the conversation:

```text
User:
  "Using the completed image task <taskId>, revise the caption..."
```

The UI can render a friendly task chip instead of exposing the raw ID.

This is the clean bridge between the old task origin and the current
conversation head.

## 9. Data Model Recommendation

### 9.1 Do not overload ordinary ChatMessage

Current `ChatMessage[]` serves three roles:

1. provider input;
2. transcript rendering;
3. persisted conversation history.

Background tasks make those roles diverge.

A completed task may appear visually near an old user message while becoming
available to the provider only in future turns. One array cannot represent both
orders honestly without extra semantics.

### 9.2 Separate conversation and task records

Illustrative model:

```ts
type BackgroundTaskKind =
  | 'openai-plan-image'
  | 'mcp-tool'
  | 'artifact'
  | 'upload'

type BackgroundTaskStatus =
  | 'queued'
  | 'preparing'
  | 'running'
  | 'input-required'
  | 'waiting-approval'
  | 'post-processing'
  | 'ready'
  | 'failed'
  | 'cancel-requested'
  | 'cancelled'
  | 'interrupted'

type BackgroundTask = {
  id: string
  conversationId: string
  originMessageId: string
  kind: BackgroundTaskKind
  status: BackgroundTaskStatus
  phase: string
  promptSnapshot: string
  contextMessageIds: string[]
  providerType: string
  modelId?: string
  providerTaskId?: string
  providerCursor?: number | string
  mcpServerId?: string
  mcpToolName?: string
  taskCapability: 'client-owned' | 'mcp-task' | 'provider-background'
  attempt: number
  progress?: {
    value?: number
    total?: number
    message?: string
  }
  artifactIds: string[]
  error?: {
    code?: string
    message: string
    phase?: string
  }
  createdAt: number
  updatedAt: number
  completedAt?: number
}
```

This is a design context, not a finalized interface.

### 9.3 Task anchors are projections

Preferred:

```text
Conversation messages remain linear provider/history records.
Background tasks remain separate records.
The transcript renderer projects tasks beneath originMessageId.
```

This avoids introducing a fake provider role such as `role: 'task'`.

If persisted timeline entries are needed, use a UI-specific type that the prompt
generator cannot accidentally send to a model:

```ts
type ConversationTimelineEntry =
  | { kind: 'message'; messageId: string }
  | { kind: 'task-anchor'; taskId: string; originMessageId: string }
```

### 9.4 Artifacts remain separate

Following R-001:

- save images to vault storage or a controlled temporary location;
- persist paths, URLs, dimensions, MIME, byte size, and provenance;
- do not persist multi-megabyte base64 in chat history;
- do not delete vault/R2 assets merely because chat history is deleted;
- keep generation, local save, R2 upload, and note insertion statuses distinct.

## 10. Background Task State Machine

Recommended generic lifecycle:

| State | Meaning | User actions |
| --- | --- | --- |
| Queued | Waiting for a class/provider slot | Cancel, reprioritize later |
| Preparing | Validating capability/context/auth | Cancel |
| Running | Provider/server operation active | Cancel, view details |
| Input required | Task cannot continue without user input | Answer, cancel |
| Waiting approval | Side effect requires consent | Approve, reject |
| Post-processing | Decode/save/upload/index result | Cancel current phase where safe |
| Ready | Result/artifact is available | View, insert, attach, continue |
| Failed | Terminal error with retained inputs/results | Retry appropriate phase |
| Cancel requested | Cancellation sent but completion race remains possible | Wait, force-hide only |
| Cancelled | Terminal cancellation | Retry |
| Interrupted | App/plugin stopped without durable resume | Retry or reconnect where supported |

Transitions:

```text
queued
  -> preparing
  -> running
  -> input-required -> running
  -> waiting-approval -> running/post-processing
  -> post-processing
  -> ready

any nonterminal state
  -> cancel-requested
  -> cancelled

preparing/running/post-processing
  -> failed

client-owned active state on plugin shutdown
  -> interrupted
```

Terminal statuses must not later flip because a late result arrives. A late
provider result after cancellation may be logged as discarded or retained as a
recoverable orphan artifact according to policy, but the cancelled task remains
cancelled.

## 11. Scheduler and Cancellation Architecture

### 11.1 Foreground controller

Responsibilities:

- compile the current prompt;
- own one foreground response per conversation;
- maintain the linear text-message head;
- expose `stopForegroundResponse(conversationId)`;
- never cancel background tasks on ordinary submit;
- never allow a late foreground stream to replace a newer message suffix.

Even with one active response, updates should be keyed by:

```text
conversationId
originMessageId
responseId
attempt
```

not by "whatever is currently last."

### 11.2 BackgroundTaskManager

Responsibilities:

- create and persist tasks;
- assign task and attempt IDs;
- enforce concurrency limits;
- start task adapters;
- own per-task `AbortController`;
- subscribe UI surfaces to task events;
- preserve task state when the chat view unmounts;
- handle completion notifications;
- mark nonresumable tasks interrupted on plugin shutdown;
- recover provider/MCP durable tasks when supported.

The manager should be plugin-scoped, not React-component-scoped. Closing or
switching a chat leaf must not automatically terminate a long image generation.

### 11.3 Task adapters

Candidate adapter contract:

```ts
interface BackgroundTaskAdapter<Input, Result> {
  kind: BackgroundTaskKind
  validate(input: Input): Promise<void>
  start(context: TaskRunContext, input: Input): Promise<Result>
  cancel?(context: TaskRunContext): Promise<void>
  resume?(context: TaskRunContext): Promise<Result>
}
```

Initial adapters:

```text
OpenAIPlanImageTaskAdapter
R2UploadTaskAdapter
McpClientOwnedTaskAdapter
McpProtocolTaskAdapter
```

### 11.4 Concurrency pools

Do not expose unlimited parallelism.

Candidate defaults for prototype testing:

| Class | Initial limit | Reason |
| --- | ---: | --- |
| Foreground text per conversation | 1 | Preserve linear dialogue |
| GPT Plan image | 1 | Quota/rate behavior unverified |
| R2 upload | 2 | Network-bound and independently retryable |
| Generic client-owned MCP | 1 per server | Server capacity unknown |
| MCP protocol tasks | Respect server guidance, local cap 2 | Durable but still resource-bound |
| Deterministic local artifact | 1-2 | Avoid vault write races |

These are test defaults, not final product limits.

### 11.5 Cancel scope

Replace one global Stop model with:

```text
Stop Response
  -> current foreground text response only

Cancel on task card
  -> that task/attempt only

Cancel all background tasks
  -> explicit task-shelf command with confirmation when side effects exist

Cancel inline edit
  -> current inline request only
```

Loading another conversation or starting a new chat should not silently cancel
plugin-scoped background tasks.

## 12. GPT Plan Image Task Workflow

### 12.1 Dispatch

R-001 recommends an explicit image-generation entry point because image work
can consume Plan quota and take minutes.

Recommended dispatch:

```text
Generate image action
  -> image prompt/mode confirmed
  -> local task created
  -> task anchor inserted
  -> Plan request starts
  -> composer immediately returns to foreground-chat readiness
```

Natural-language routing may supplement the explicit action, but should not be
the only entry point.

### 12.2 Phases

Preserve R-001 phases:

```text
Preparing request
Generating image
Receiving image
Decoding image
Saving to vault
Uploading to Cloudflare R2
Ready to insert / Inserted
```

The task card can show the R-005 orbital activity primitive while the foreground
chat uses its own indicator.

### 12.3 Plan background limitation

The successful R-001 Plan request used:

```text
internal ChatGPT/Codex endpoint
store: false
stream: true
hosted image_generation tool
```

It did not verify:

```text
background: true
retrieve by response ID after app restart
cancel endpoint by response ID
resume stream with starting_after
```

OpenAI's public API documents these capabilities for public Responses
background mode, but that evidence must not be transferred to the internal Plan
endpoint without a dedicated probe.

Initial implementation should therefore say:

```text
Runs in the background while Obsidian remains open.
```

It must not promise:

```text
Continues after Obsidian or the device is closed.
```

### 12.4 Partial images

R-001 observed partial-image events. A prototype may update the anchored preview
progressively, but should not:

- persist every partial image;
- cause layout shifts;
- treat a partial as a finished artifact;
- let a partial overwrite a later accepted final result.

### 12.5 Destination staleness

Background generation changes insertion semantics. During a two-minute render,
the user may:

- move the cursor;
- switch notes;
- edit the target range;
- close or rename the file.

Therefore, "insert at current cursor when finished" is unsafe as a silent
default.

Safer policy:

1. Always save the completed artifact first.
2. Keep the task bound to its originating note/path where applicable.
3. Require an explicit Insert action after completion, or validate a stored
   target anchor/revision before automatic insertion.
4. If the target is stale, preserve the image and ask for a new destination.
5. Keep R2 upload retry independent from generation retry.

## 13. MCP: Blocking Calls Versus Background Tasks

### 13.1 Blocking MCP tool

Use a normal request-bound MCP call when:

- the foreground answer cannot be correct without the result;
- the result should immediately return to the same model response;
- latency is expected to be short;
- the user expects one answer, not a later artifact.

Example:

```text
"What does this statute currently say?"
  -> Korean Law lookup
  -> model answers after receiving the lookup
```

Detaching this lookup while letting the model answer immediately would risk an
unsupported answer.

### 13.2 Detached MCP research task

Use a background task when:

- the user explicitly asks for a dossier, comparison, or broad research job;
- the result is independently useful;
- the foreground chat can continue without pretending the result exists;
- the tool/server supports deferred work, or the user accepts an in-app-only
  client-owned task.

Example:

```text
"Start a background survey of all relevant precedents and notify me."
  -> task anchor
  -> foreground chat remains available
  -> result later appears as a research artifact
```

### 13.3 MCP Tasks official capability

The MCP 2025-11-25 Tasks specification is experimental but directly relevant.
It defines:

- receiver-generated task IDs;
- capability negotiation;
- tool-level `execution.taskSupport` as `required`, `optional`, or `forbidden`;
- states `working`, `input_required`, `completed`, `failed`, and `cancelled`;
- `tasks/get`, `tasks/result`, `tasks/list`, and `tasks/cancel`;
- related-task metadata;
- progress notifications;
- a provisional immediate model response so the model can regain control while
  the task continues.

The host must not request task execution unless the peer advertises it.

### 13.4 Current Smart Composer gap

The installed MCP SDK can represent experimental tasks, but current
`McpManager`:

- lists ordinary tools;
- invokes `client.callTool()`;
- supports per-request `AbortController`;
- returns the first text content result;
- does not inspect `execution.taskSupport`;
- does not negotiate task capabilities in application logic;
- does not call task get/result/list/cancel;
- does not persist MCP task IDs;
- does not support `input_required`;
- does not subscribe a task shelf to progress/status notifications.

### 13.5 Client-owned background wrapper

For servers without MCP Tasks, Smart Composer may still run an ordinary
`callTool()` under a plugin-owned background task.

This provides:

- nonblocking UI;
- local task ID;
- local cancellation request;
- local progress only if the server sends usable progress;
- result anchoring.

It does not provide:

- server-side durability;
- guaranteed resume after app close;
- reliable cancellation if the server ignores cancellation;
- polling after the original connection disappears.

The UI must distinguish:

```text
Background while Obsidian is open
```

from:

```text
Durable server task
```

### 13.6 Approval and side effects

Read-only research may be eligible for detachment. Side-effecting MCP tools
require stricter handling:

- retain per-tool approval policy;
- show `waiting-approval`;
- never let a hidden background task write to the vault or external service
  without the configured authorization;
- surface input requests in the task shelf;
- expire or pause tasks that wait too long for input;
- make retry idempotency explicit.

## 14. Single-Panel UX Recommendation

### 14.1 Keep the composer usable

When only background tasks are active:

- the Send button remains available;
- no global Stop Response button appears;
- a compact task count remains visible;
- the foreground query indicator stays idle.

When foreground text is active:

- Send changes to Stop Response according to the final composer interaction;
- background task count remains separate;
- stopping text does not cancel images or MCP research.

### 14.2 Anchored task card

Collapsed running state:

```text
[orbital indicator] Generating image
1m 12s  |  Cancel  |  Details
```

Ready image state:

```text
[stable preview]
1920 × 1080  PNG  1.2 MB
Open full size  Insert  Upload to R2  Copy Markdown  Continue from result
```

Ready MCP state:

```text
Legal research ready
12 authorities  4 warnings
Open result  Attach to next prompt  Continue from result
```

### 14.3 Task shelf

Place a compact task control near, but not inside, the text content area:

```text
Tasks 2
```

Expanded shelf:

- running first;
- input-required/failed next;
- recently completed below;
- grouped by conversation or current conversation filter;
- individual Cancel/Retry/View;
- no second full chat transcript.

This is lighter than Codex's separate thread for every operation while retaining
supervision.

### 14.4 Notification policy

Notify only when:

- a task completes while its anchor is offscreen or its conversation is not
  active;
- input or approval is required;
- a task fails;
- a long-running task is interrupted.

Do not notify on every phase transition.

### 14.5 Light and dark treatment

Preserve R-005:

Hallym Conversation Studio:

- calm anchored artifact card;
- blue/teal progress;
- progressive disclosure;
- completion returns to a document-like surface.

CMDS AI Operator Console:

- task shelf resembles an operation queue;
- neon active rail;
- monospace task ID/model/phase metadata;
- more telemetry visible by default;
- neutral prose and artifact content.

The task architecture and control positions remain identical.

## 15. Provider Context Rules

### 15.1 Foreground snapshot

Each foreground request should compile an immutable snapshot of:

- completed conversational messages available at submit time;
- selected mentions and retrieval context;
- explicitly attached completed task results;
- pending-task summaries only when useful.

### 15.2 Pending tasks

A pending task may be represented to the model as:

```text
An image generation task is still running; no result is available.
```

Do not send partial image bytes or imply completion.

### 15.3 Completed tasks

Do not automatically inject every completed background result into every future
prompt. Use:

- explicit `Continue from result`;
- an `Attach result` action;
- a task/result mention;
- a small artifact summary when the current user prompt clearly references it.

This limits token cost and accidental cross-topic context.

### 15.4 Parallel text responses

R-006 does not recommend multiple simultaneous foreground text responses inside
one conversation.

If that capability is desired later, it requires explicit branches:

```text
parentMessageId
branchId
responseId
```

Without branches, two concurrent assistant responses do not have a stable
shared "next" turn.

The current requirement is simpler:

```text
one foreground text head
many background sidecar tasks
```

## 16. TanStack Query Boundary

Official TanStack Query documentation confirms:

- mutations run in parallel by default;
- mutations sharing a `scope.id` run serially;
- `useMutationState` can observe multiple mutation-cache entries;
- consecutive mutate callbacks have lifecycle caveats;
- persisted mutation state does not serialize executable functions.

These features can support UI integration, but they do not replace a domain
task manager.

Reasons:

- task records must outlive a React component;
- artifacts and provider IDs need explicit durable storage;
- cancellation is domain-specific;
- provider resume capability varies;
- a task may require user input;
- chat anchors need stable origin binding;
- task state must survive view switches;
- late results require attempt and terminal-state guards.

Recommended use:

```text
BackgroundTaskManager owns truth.
React Query may expose/observe commands and cache projections.
```

Do not make one `useMutation().isPending` the source of truth for the entire
queue.

## 17. Persistence and Restart Semantics

### 17.1 Persist before network dispatch

Write the task record before starting external work so a crash does not leave an
unexplained placeholder.

### 17.2 Client-owned Plan and MCP tasks

On plugin unload or app close:

- abort local requests where possible;
- mark nonterminal nonresumable tasks `interrupted`;
- retain prompt and safe retry metadata;
- do not claim they are still running;
- do not retry automatically if that could consume quota or duplicate a side
  effect.

### 17.3 Provider-background task

If a future provider returns a durable task/response ID:

- persist the provider ID and auth/provider identity;
- resume polling only under the same account context;
- respect provider retention/TTL;
- mark expired results accurately;
- avoid storing credentials in the task record.

### 17.4 MCP protocol task

Persist:

- task ID;
- server identity;
- auth context identifier without credentials;
- TTL and poll interval;
- last known state;
- related artifact references.

On reconnect:

- verify capability and authorization context;
- poll `tasks/get`;
- retrieve only if still available;
- handle expired/not-found as a terminal recovery state.

### 17.5 Mobile limitation

An Obsidian mobile app can be suspended by the operating system. Client-owned
background execution cannot be described as reliable after the app leaves the
foreground without a live test and platform-specific support.

## 18. Race Conditions and Recovery Requirements

### 18.1 Cancel versus completion

Cancellation can race with completion.

Required:

- task status keyed by attempt;
- terminal state guard;
- cancellation state shown immediately;
- late completion cannot silently flip cancelled to ready;
- a fully received artifact may be retained separately if policy allows.

### 18.2 Retry versus old attempt

Every retry increments:

```text
attempt
```

Events from attempt 1 must not update attempt 2.

### 18.3 Conversation deletion

Deleting a conversation:

- removes or archives its task anchors;
- asks how to handle active tasks;
- does not silently delete completed vault/R2 artifacts.

### 18.4 Note change or deletion

If the intended insertion note changed:

- preserve the artifact;
- mark destination stale;
- request a new insertion target;
- never write to stale coordinates.

### 18.5 Upload duplication

R2 retry must use an idempotency/collision policy so repeated clicks do not
create unexplained duplicate URLs.

### 18.6 Provider/account change

A task dispatched under one Plan account must not resume under another account
without explicit handling.

### 18.7 View unmount

Closing the Smart Composer leaf must not destroy plugin-owned task state. UI
subscriptions may detach; execution ownership remains in the manager.

## 19. Options Rejected for the Initial Design

### One global Stop button for everything

Rejected because the user cannot tell whether it cancels text, image, upload,
MCP, or all operations.

### Append results in completion order

Rejected because a two-minute-old request can appear as if it answered the
newest turn.

### Retroactively insert completed task results into provider history

Rejected because later responses did not actually have that context.

### Separate full chat thread for every image

Rejected as the default because it adds too much navigation for a lightweight
Obsidian workflow. A task drawer is sufficient.

### Treat every MCP call as detachable

Rejected because some answers depend on the tool result and many servers do not
support durable tasks.

### Use public OpenAI background API assumptions for Plan

Rejected because R-001 used an internal endpoint with Plan OAuth, not the public
API-key Responses endpoint.

### Persist base64 in chat history

Rejected by R-001 due size and replay cost.

### Keep legacy Apply beside inline edit indefinitely

Not recommended for the custom build because it preserves two competing edit
models and the slower whole-file rewrite path. A short compatibility setting is
possible only if an actual remaining use case is identified.

## 20. Prototype and Test Matrix

### 20.1 Foreground/background independence

- Start a high-quality Plan image.
- Submit three normal text questions while it runs.
- Verify the image is not cancelled.
- Verify each text response remains ordered.
- Stop one text response.
- Verify the image continues.
- Cancel the image.
- Verify later text remains unaffected.

### 20.2 Delayed anchoring

- Start task from message A.
- Produce messages B/C/D.
- Complete task A after D.
- Verify A's card updates in place.
- Verify no forced scroll.
- Use View Result and Continue from Result.
- Verify the new turn appears after D and explicitly references A.

### 20.3 Message integrity

- Emit late chunks from an aborted foreground attempt.
- Start a new foreground attempt.
- Verify old chunks cannot replace the new suffix.
- Reload chat history during/after completion.
- Verify message and task records remain consistent.

### 20.4 Image phases

- low and high quality;
- partial image events;
- actual dimensions differ from requested;
- decode failure;
- local save failure;
- R2 failure after local success;
- insertion target becomes stale;
- retry upload without regeneration;
- cancel during generation and during upload.

### 20.5 MCP modes

- short blocking read-only tool;
- client-owned detached tool;
- MCP task-capable tool;
- task-required tool;
- task-forbidden tool;
- progress with and without total;
- input-required;
- approval required;
- server ignores cancellation;
- task expires before retrieval;
- reconnect under wrong auth context.

### 20.6 Persistence

- close chat leaf while task runs;
- switch conversation;
- create new chat;
- disable plugin;
- restart Obsidian;
- simulate mobile suspension;
- delete owning conversation;
- rename/delete target note.

### 20.7 UX

- narrow mobile/sidebar;
- wide leaf;
- Hallym Light;
- CMDS Dark;
- reduced motion;
- keyboard-only;
- screen-reader status;
- multiple task completion notification coalescing;
- user scrolled away from task anchor.

### 20.8 Apply removal

- confirm Copy remains available at message and code-block level;
- confirm inline edit handles selection and cursor workflows;
- confirm deterministic Insert/Create Note naming is unambiguous if added;
- verify no remaining Apply model setting is accidentally required at runtime;
- plan settings migration or legacy-setting removal separately.

## 21. Suggested Prototype Order

This is a research handoff, not the final combined release roadmap.

Lowest-risk order:

1. Remove global assumptions from foreground response updates by keying them to
   conversation/origin/attempt.
2. Create a plugin-scoped in-memory `BackgroundTaskManager`.
3. Add a mock delayed task and anchored placeholder.
4. Prove foreground chat continues while the mock task runs.
5. Add per-task cancel and task shelf.
6. Add task persistence and interrupted-state recovery.
7. Integrate R-001 Plan image generation without R2.
8. Add local artifact persistence and full-size preview.
9. Add R2 as a separately retryable phase.
10. Add MCP client-owned background wrapper.
11. Add experimental MCP Tasks only after capability negotiation tests.
12. Remove legacy Apply after the R-002 inline lane is available.

Do not begin by simply deleting `abortActiveStreams()` or allowing multiple
`submitChatMutation.mutate()` calls.

## 22. Mandatory Facts for Future Synthesis

1. Current Smart Composer is a single linear foreground stream despite keeping
   an array of abort controllers.
2. New message submission aborts active streams in both `Chat.tsx` and the
   stream-manager mutation.
3. One global mutation `isPending` controls the Stop Generation button.
4. The current stream subscriber owns and replaces the conversation suffix
   after its source user message; it is unsafe for naive concurrent responses.
5. Current MCP auto-continuation assumes the tool message is still last.
6. Current chat persistence stores only user, assistant, and tool messages.
7. Legacy Apply performs a second model call, rewrites the full active file, and
   opens a separate Apply view.
8. Copy is already deterministic and available at message and code-block
   levels.
9. The user's approximately 99% Copy-use figure is an important observation,
   not measured telemetry.
10. R-002 inline edit is the recommended home for AI-assisted source mutation.
11. Right chat should prioritize full answer output, reading, references, Copy,
    and artifact actions.
12. A delayed background result must remain bound to its originating user
    message and update an anchored task card rather than append in completion
    order.
13. Later chat turns must not be retroactively represented as having seen a
    result that completed afterward.
14. `Continue from result` should create a new current-end turn that explicitly
    references the completed task.
15. The initial concurrency model is one foreground text head plus multiple
    bounded background tasks, not multiple foreground branches.
16. Foreground Stop, inline Cancel, and per-task Cancel require separate
    scopes.
17. Background task ownership must be plugin-scoped so changing/closing a chat
    view does not kill work.
18. Plan image generation is verified only as a live client stream while
    Obsidian is open; durable Plan background/resume is not verified.
19. Public OpenAI Responses background mode is architectural evidence, not proof
    that the internal Plan endpoint supports the same fields/endpoints.
20. MCP Tasks are experimental and require capability negotiation plus
    tool-level task support.
21. The installed MCP SDK includes task types, but current Smart Composer does
    not use them.
22. An ordinary MCP call can be wrapped as a client-owned in-app task, but it is
    not durable after app shutdown and cancellation may be best-effort.
23. Blocking MCP calls remain necessary when the current answer depends on the
    tool result.
24. Background image insertion must account for stale cursor/file targets.
25. Task and artifact persistence must not store Plan credentials, MCP secrets,
    R2 keys, or large base64 payloads.
26. TanStack Query may support task UI projections, but one React mutation must
    not be the durable source of truth for the queue.
27. R-005 task indicators and dual skins must represent truthful per-task states
    without blocking the composer.

## 23. Open Questions Reserved for the Combined Plan

- Should foreground submit stop the previous foreground answer immediately, or
  require an explicit Stop before sending?
- Should active background tasks appear across every Smart Composer
  conversation or default to the current conversation filter?
- What is the final Plan image concurrency limit after quota/rate testing?
- Does the internal Plan endpoint support `background`, retrieval, cancellation,
  or stream resume by response ID?
- Should partial images be shown live or only as phase progress?
- Should exact-text `Insert at cursor` remain in the right chat after legacy
  Apply removal?
- Is a one-release legacy Apply setting useful for this private custom build?
- What durable task storage schema/version belongs beside chat history?
- How long should completed task records remain in the task shelf?
- Should deleted conversations cancel active tasks, detach them, or ask?
- Which MCP protocol version should Smart Composer negotiate for Tasks?
- Does the intended Korean Law MCP advertise task support, progress, or
  cancellation?
- Which MCP tools are safe for client-owned detachment when protocol Tasks are
  unavailable?
- How should a background task request clarification without stealing focus
  from the editor?
- Should `Continue from result` attach the full result, a summary, or a
  user-selected subset?
- How should multiple completed artifacts be referenced in a later prompt?
- What mobile behavior is acceptable when the operating system suspends
  Obsidian?
- Should the task shelf be a popover, drawer, or collapsible transcript band at
  narrow widths?
- What telemetry, if any, should be added locally to validate Copy/Apply/inline
  usage without collecting private note contents?

## 24. Official Reference Findings

### OpenAI Background mode

OpenAI documents public Responses API background execution with:

- asynchronous creation;
- queued/in-progress polling;
- response-ID cancellation;
- optional background streaming;
- sequence-number cursor resume;
- temporary response storage requirements.

This establishes a useful job lifecycle, but the documented endpoint uses the
public API and must not be assumed for Plan OAuth.

Source:
[OpenAI API: Background mode](https://developers.openai.com/api/docs/guides/background)

### OpenAI conversation state

OpenAI documents durable conversation objects and `previous_response_id`
threading. This supports the general distinction between stable conversation
state and individual response objects.

Source:
[OpenAI API: Conversation state](https://developers.openai.com/api/docs/guides/conversation-state)

### Codex parallel tasks

OpenAI describes Codex as running long tasks in separate threads so users can
switch without losing context. That is strong evidence for separating task
identity from one global spinner. Smart Composer should adapt the principle in
a lighter anchored-task form rather than copying the full multi-thread product.

Source:
[Introducing the Codex app](https://openai.com/index/introducing-the-codex-app/)

### MCP Tasks, progress, and cancellation

MCP's experimental Tasks specification directly defines deferred result
retrieval and related-task identity. MCP also defines optional progress and
best-effort cancellation with race handling.

Sources:

- [MCP Tasks](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks)
- [MCP Progress](https://modelcontextprotocol.io/specification/2025-03-26/basic/utilities/progress)
- [MCP Cancellation](https://modelcontextprotocol.io/specification/2024-11-05/basic/utilities/cancellation)

### TanStack Query

TanStack documents parallel mutations by default, serial mutation scopes, and
multi-mutation observation. These are implementation tools, not a complete task
domain model.

Sources:

- [TanStack Query mutations](https://tanstack.com/query/latest/docs/framework/react/guides/mutations)
- [TanStack useMutationState](https://tanstack.com/query/latest/docs/framework/react/reference/useMutationState)

### Contextual progress

VS Code's extension UX guidance recommends contextual progress over global
notifications, cancellation where applicable, and restrained background status
indicators. This supports anchored task cards plus a compact task shelf.

Sources:

- [VS Code notifications guidance](https://code.visualstudio.com/api/ux-guidelines/notifications)
- [VS Code status bar guidance](https://code.visualstudio.com/api/ux-guidelines/status-bar)

## 25. Related Mandatory Reports

```text
R-001: GPT Plan native image generation and CMDS Eagle R2
R-002: Claudian inline edit and provider architecture
R-003: Vault Operator agent, artifacts, and performance
R-005: Chat/inline UX, motion, dual skins, and theme isolation
```

R-004 remains mandatory for any combined roadmap because retrieval and folder
work can also become long-running phases, although it was not the primary source
for this task-lane investigation.

## 26. Secret and Privacy Statement

No OAuth token, API key, account ID, MCP credential, Cloudflare R2 secret,
private legal query, note content, or generated artifact bytes were read,
recorded, or transmitted during this investigation.

Only source code, existing sanitized research reports, user-supplied product
observations, installed dependency metadata, and public official documentation
were inspected.
