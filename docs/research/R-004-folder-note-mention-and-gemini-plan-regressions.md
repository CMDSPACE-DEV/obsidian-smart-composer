# R-004: Folder/Note Mention and Gemini Plan Regression Report

> [!IMPORTANT]
> **Status: Verified / Mandatory planning input**
>
> This report records source comparison and sanitized live tests performed on
> 2026-07-23. Any fix or larger Smart Composer roadmap involving folder
> mentions, note mentions, Plan RAG, or Gemini subscription access must read
> this report first.

## 1. Executive Summary

Smart Composer 1.4.0 contains one confirmed GPT-5.6 folder-retrieval regression,
one broader reliability regression that can affect Sonnet 5, and a separate
Gemini Plan feature that is currently nonfunctional by construction.

### Confirmed GPT-5.6 regression

The 1.4.0 Codex adapter maps the generic internal RAG budget
`max_tokens: 512` to `max_output_tokens: 512` on the private OpenAI Plan
Responses request. The live Plan backend rejects that field:

```text
HTTP 400
{"detail":"Unsupported parameter: max_output_tokens"}
```

Removing only `max_output_tokens` from the same request produces HTTP 200 and a
valid GPT-5.6 response. This breaks:

- focused folder/note retrieval that reaches Plan rerank;
- Vault Search through GPT Plan rerank;
- exhaustive batch reading when the folder exceeds the direct token limit.

Small directly included notes and folders do not use this internal helper call,
so they can still work. Normal GPT chat can also work because its request often
leaves `max_tokens` undefined, causing the unsupported property to disappear
during JSON serialization.

### Sonnet 5 finding

A fresh Sonnet 5 Plan rerank was successfully executed against the user's real
DIKM folder:

- 27 Markdown files;
- 169 LangChain Markdown chunks;
- 40 locally ranked candidates;
- 10 model-selected chunk indexes;
- HTTP 200 from `claude-sonnet-5`.

Therefore, the claim that Sonnet 5 inherently cannot process folder mentions is
not supported. However, 1.4.0 changed internal RAG error handling so that HTTP
400, 403, 404, and 429 errors are thrown to the user instead of falling back to
the local candidate ranking. A rate limit, entitlement response, malformed
request, or temporary model error that was previously recoverable can now make
the entire folder request fail. This is a real reliability regression and is a
plausible explanation for intermittent Sonnet reports.

### Gemini Plan finding

Gemini Plan cannot start or refresh OAuth in either the compared 1.3.1 or 1.4.0
custom build because both bundled OAuth constants are empty. The UI still
advertises a Connect action and Gemini Plan models.

There is also a newer external constraint. Google states that, starting
2026-06-18, Gemini Code Assist and Gemini CLI stopped serving consumer-account
requests for Gemini Code Assist for individuals, Google AI Pro, and Google AI
Ultra, including Login with Google. The current Smart Composer Gemini Plan
provider targets that Code Assist private backend. Restoring old OAuth
credentials would therefore not restore the intended consumer subscription
path. A future integration needs a separately investigated, currently supported
Antigravity or enterprise route.

## 2. Scope and Evidence Labels

Evidence labels used in this report:

- **Verified - source**: confirmed in the pinned 1.3.1 and/or 1.4.0 source.
- **Verified - live**: reproduced with an existing Plan session without
  recording credentials.
- **Verified - official documentation**: confirmed by current Google
  documentation.
- **User observation**: behavior shown or reported by the user, without a
  controlled reproduction of that exact UI event.
- **Inference**: a source-supported explanation that has not been reproduced
  for every model, folder, and history combination.

### Verified in this investigation

- The 1.3.1-to-1.4.0 commit and source differences relevant to mentions and Plan
  transports.
- The exact GPT-5.6 request property that causes the internal RAG failure.
- Successful GPT-5.6 execution after removing only that property.
- Successful Sonnet 5 Plan reranking of a representative real folder.
- The active folder retrieval settings and non-secret provider state.
- The exact DIKM folder file, chunk, and token counts used for boundary checks.
- Gemini OAuth configuration is empty in both compared releases.
- Gemini Connect and refresh call the configuration assertion before they can
  complete.
- The provider uses the Gemini Code Assist `cloudcode-pa.googleapis.com`
  `v1internal` endpoints.
- Google's official consumer-account deprecation effective 2026-06-18.
- The targeted 1.4.0 Jest suites pass despite the live GPT failure, identifying
  a contract-test gap.

### Not verified in this investigation

- The exact screen, model, folder, and saved conversation used by every other
  user's failure report.
- Sonnet 5 exhaustive batch behavior across all folder sizes and rate-limit
  conditions.
- Whether a reported Sonnet failure occurred in a fresh chat or a chat with
  incomplete historical tool calls.
- Gemini Code Assist Standard or Enterprise accounts.
- A supported Antigravity authentication or invocation contract suitable for an
  Obsidian plugin.
- Mobile Obsidian behavior.

## 3. Repository and Version Baseline

Repository:

```text
https://github.com/laguna821/obsidian_smart_composer_Achmage
```

Compared refs:

| Ref | Commit | Purpose |
| --- | --- | --- |
| Remote 1.3.1 baseline | `8d6531e` | Last release before the 1.4 model update |
| 1.4.0 release/tag | `e844009` | GPT-5.6, Sonnet 5, RAG hardening, effort selector |

Relevant 1.4.0 commits:

| Commit | Change |
| --- | --- |
| `47b6c85` | GPT-5.6 Plan tiers and Codex adapter rewrite |
| `2758a27` | Sonnet 5 adaptive Plan support |
| `2a96cf1` | Plan settings migration and RAG hardening |
| `b27abc6` | 1.4.0 release metadata |
| `e844009` | GPT-5.6 effort selector |

The local main checkout remained on the 1.3.1-era source while investigation
used a detached 1.4.0 worktree. No production source fix was made during this
research turn.

## 4. Current Mention Pipeline

The 1.4.0 pipeline in `src/utils/chat/promptGenerator.ts` behaves as follows:

```text
mentioned files/folders
  -> expand folders into Markdown files
  -> read local file contents
  -> determine exhaustive intent/mode
  -> count cl100k_base tokens
  -> choose direct inclusion or a RAG helper path
  -> append actual context-mode metadata
  -> send the final chat request
```

### Direct inclusion

When content remains below `ragOptions.thresholdTokens` and exhaustive mode is
not required, each file is inserted directly into the final prompt. This path
does not call Plan rerank.

Consequences:

- a normal single-note mention usually remains unaffected;
- a small folder can still work;
- a large note or large group of notes can cross the threshold and enter RAG.

### Focused Plan rerank

When the mention exceeds the normal threshold, Vault Search is used, or
embedding retrieval is unavailable in Auto mode, Plan rerank:

1. reads every scoped Markdown file locally;
2. splits content with `RecursiveCharacterTextSplitter`;
3. locally scores chunks by path/query terms;
4. keeps up to the configured candidate limit;
5. asks the selected chat Plan model for JSON indexes;
6. supplies approximately the configured result limit to the final answer.

The current defaults/settings observed were 40 candidates and 10 selected
chunks.

### Exhaustive direct

Exhaustive mode reads every file and inserts all file contents directly when
the total is at or below `exhaustiveDirectTokenLimit`.

The current DIKM folder measured:

```text
files: 27
characters: 109,814
cl100k_base tokens: 56,147
direct limit: 60,000
```

With the currently observed `folderReadMode: exhaustive`, that folder uses
`exhaustive-direct` and does not call the internal reranker. Earlier screenshots
showing ten scored references are consistent with a focused Plan-rerank request
made under a different folder-scope setting.

### Exhaustive batch

When exhaustive content exceeds the direct limit:

1. every file is split into Markdown chunks;
2. chunks are sorted locally;
3. all chunks are divided into approximately 12,000-character batches;
4. each batch is summarized by the selected Plan model;
5. all batch summaries plus representative chunks are sent to the final model.

This path sets `max_tokens: 1200` on every internal summary request and therefore
hits the same GPT-5.6 adapter defect as Plan rerank.

## 5. Confirmed GPT-5.6 Root Cause

### 5.1 Source path

`src/core/rag/planRerank.ts` sends:

```ts
max_tokens: 512
```

`src/core/rag/exhaustiveFolderRead.ts` sends:

```ts
max_tokens: 1200
```

The 1.4.0 `src/core/llm/codexMessageAdapter.ts` then builds the private Codex
request with:

```ts
max_output_tokens: request.max_tokens
```

This mapping was introduced with the GPT-5.6 adapter rewrite.

### 5.2 Sanitized live A/B probe

The live test used the existing Smart Composer OpenAI Plan session, not an
OpenAI Platform API key. No token value was logged.

Common request properties:

```text
model: gpt-5.6-luna
stream: true
store: false
reasoning.effort: none
small text-only input
```

Results:

| Variant | Result | Elapsed |
| --- | --- | ---: |
| 1.4.0 internal RAG payload with `max_output_tokens: 512` | HTTP 400, unsupported parameter | about 453 ms |
| Identical payload without `max_output_tokens` | HTTP 200, `response.completed`, output `OK` | about 1,542 ms |

The successful response reported model `gpt-5.6-luna`.

This also corroborates R-001's independent finding that the same private
Responses endpoint rejected `max_output_tokens` during the image capability
probe.

### 5.3 Why ordinary GPT chat can still work

The final chat request usually has no explicit `max_tokens`. The adapter still
creates the JavaScript property, but `JSON.stringify` omits an `undefined`
value. Internal RAG calls explicitly provide a number, so the unsupported field
is serialized and rejected.

This difference makes the regression appear folder-specific even though the
defect is in the provider adapter.

## 6. GPT-5.6 Impact Matrix

| User action | Internal helper call | Expected 1.4.0 result |
| --- | --- | --- |
| Small note mention below threshold | None | Can work |
| Small focused folder below threshold | None | Can work |
| Large focused folder/note set | Plan rerank, 512-token budget | Confirmed HTTP 400 |
| `@vault` with Plan rerank | Plan rerank, 512-token budget | Confirmed defect applies |
| Exhaustive folder under 60,000 tokens | None before final request | Can work |
| Exhaustive folder over 60,000 tokens | Batch summaries, 1,200-token budget | Confirmed defect applies |
| Normal GPT chat without explicit output budget | None | Can work |

## 7. Sonnet 5 Verification and Remaining Risk

### 7.1 Live token refresh

The stored Claude access token was expired. The plugin's normal refresh flow was
used, and rotated credentials were persisted atomically back to the local
plugin settings. Sanitized result:

```text
refreshed: true
expiresIn: 28,800 seconds
refreshTokenRotated: true
```

No access token or refresh token was printed or recorded.

### 7.2 Direct request probes

The 1.4.0 internal Sonnet model disables adaptive thinking for low-token RAG
calls. The following request shapes succeeded:

- `claude-sonnet-5`, `max_tokens: 512`, thinking disabled;
- the same request without a thinking field;
- the normalized consecutive-user-message pattern produced by the adapter.

Each returned HTTP 200.

### 7.3 Representative folder rerank

The real `00. DIKM 이란` folder was read and split with the same LangChain
Markdown splitter used by Smart Composer:

```text
Markdown files: 27
chunks built: 169
local candidates sent: 40
request text: 33,730 characters
elapsed: about 1,977 ms
response model: claude-sonnet-5
selected indexes: [3, 4, 5, 0, 6, 1, 2, 7, 16, 17]
```

The request completed with HTTP 200. The splitter output and candidate set were
also checked for lone UTF-16 surrogate code units; none were present.

### 7.4 The 1.4.0 reliability regression

`src/core/rag/internalModel.ts` classifies these internal Plan errors as fatal:

```text
HTTP 400, 403, 404, 429
code: model_mismatch
```

`planRerank.ts` and `exhaustiveFolderRead.ts` rethrow those errors. In 1.3.1,
internal rerank and batch-summary failures fell back to locally ranked
candidates or a local batch excerpt.

This means a Sonnet 5 request can work in a fresh controlled test yet still feel
less reliable than 1.3.1 in ordinary use. In particular, a temporary 429 now
aborts the entire folder operation even though locally ranked context is already
available.

## 8. Saved Tool-History Compatibility Regression

The Sonnet 5 update also replaced tolerant cleanup of incomplete saved tool
history with strict validation in `src/utils/chat/promptGenerator.ts`.

1.3.1 removed tool calls without results and orphan tool results before sending
the next request. 1.4.0 throws for:

- missing tool results;
- orphan tool results;
- duplicate call/result IDs;
- results preceding their calls;
- non-adjacent result sets.

The 1.4.0 test suite explicitly expects
`Missing tool result for tool call tool-2`.

This is not a folder-specific bug. However, a user who mentions a folder in an
older or interrupted tools-enabled chat can fail before the new folder prompt is
sent. Failure reports should therefore record whether a fresh chat succeeds.

## 9. Gemini Plan Has Two Independent Blockers

### 9.1 The custom build cannot initialize OAuth

Both compared refs contain:

```ts
export const GEMINI_OAUTH_CLIENT_ID = ''
export const GEMINI_OAUTH_CLIENT_SECRET = ''
```

`src/core/llm/geminiAuth.ts` rejects authorization URL creation, token exchange,
and token refresh when either value is empty:

```text
Gemini Plan OAuth credentials are not bundled in this custom build.
```

The automatic Connect handler calls authorization-context creation before its
error-handling `try` block. As a result, clicking Connect can fail before a
Google login page opens and without the intended friendly fallback message.

An old stored access token cannot solve this permanently. Once expired, refresh
calls the same configuration assertion.

This blocker predates 1.4.0 and is therefore not caused by the GPT-5.6/Sonnet 5
model migration.

### 9.2 The consumer Code Assist route was retired

The provider targets:

```text
https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist
https://cloudcode-pa.googleapis.com/v1internal:onboardUser
https://cloudcode-pa.googleapis.com/v1internal:generateContent
https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent
```

Google's official deprecation page states that, starting 2026-06-18, Gemini Code
Assist IDE extensions and Gemini CLI stopped serving requests for Gemini Code
Assist for individuals, Google AI Pro, and Google AI Ultra. Login with Google is
no longer available for those consumer products. Standard and Enterprise
subscriptions are explicitly excluded from that deprecation.

Therefore, adding an old OAuth client ID/secret is not an adequate fix for the
custom plugin's intended consumer Plan feature.

Official references:

- [Gemini Code Assist consumer accounts deprecation](https://developers.google.com/gemini-code-assist/docs/deprecations/code-assist-individuals)
- [Gemini Code Assist Standard and Enterprise overview](https://docs.cloud.google.com/gemini/docs/codeassist/overview)
- [Gemini CLI model selection documentation](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/model.md)

## 10. Test-Suite Finding

After a clean `npm ci`, these 1.4.0 suites were run:

```text
src/core/rag/planRerank.test.ts
src/core/rag/exhaustiveFolderRead.test.ts
src/core/rag/internalModel.test.ts
src/core/llm/codexMessageAdapter.test.ts
src/core/llm/claudeCodeMessageAdapter.test.ts
src/utils/chat/promptGenerator.test.ts
```

Result:

```text
Test suites: 6 passed, 6 total
Tests: 55 passed, 55 total
```

Passing tests do not contradict the live GPT failure. The Codex adapter test
currently asserts that `max_tokens: 4096` becomes
`max_output_tokens: 4096`; its mocked transport accepts the field. No test
models the real private backend's rejection. The test suite therefore enshrines
the incorrect wire-contract assumption.

No Gemini OAuth test was found.

## 11. Required Fix Boundaries

This investigation did not implement the fixes, but it establishes the minimum
boundaries a future implementation must satisfy.

### 11.1 OpenAI Plan adapter

- Do not send `max_output_tokens` to the current private Codex Plan endpoint.
- Do not assume the public OpenAI Responses schema is accepted unchanged by the
  private Plan backend.
- Keep output-budget behavior provider-specific and capability-tested.
- Add a regression fixture where the transport rejects
  `max_output_tokens`, matching the live backend.

### 11.2 Internal RAG fallback

- An internal context-selection helper must not normally make an otherwise
  answerable chat fail.
- Preserve local candidate fallback for rerank errors, including 400, 429, and
  transient failures.
- Preserve local batch excerpts when exhaustive summarization fails.
- Surface fallback status in retrieval metadata/UI instead of silently
  pretending model rerank succeeded.
- Authentication or final-model entitlement failures may still require a clear
  blocking error, but helper-call failure and final-chat failure must not be
  conflated.

### 11.3 Saved chat history

- Repair or trim incomplete historical tool-call tails when safely possible.
- If repair is unsafe, show a precise recovery action such as starting a fresh
  chat instead of reporting a generic folder failure.
- Test folder mentions in both fresh chats and interrupted tools-enabled chats.

### 11.4 Gemini Plan

- Immediately stop presenting consumer Gemini Plan as a working Connect option
  in this build.
- Preserve old model/provider metadata for chat-history compatibility, but mark
  the models unavailable or disabled.
- Explain both the local configuration limitation and Google's consumer-service
  deprecation in the UI.
- Investigate Antigravity as a new, separate provider project. Do not assume the
  old Code Assist OAuth or private endpoint contract transfers to Antigravity.
- Treat Standard/Enterprise Code Assist as a separate account and licensing
  path if support is ever considered.

## 12. Required Regression Tests

### Provider contract

- GPT Plan internal text request omits `max_output_tokens`.
- GPT-5.6 Sol, Terra, and Luna preserve the selected model and reasoning effort.
- A secret-gated opt-in live smoke test verifies one short internal RAG request
  per Plan provider before release.

### Mention routing

- small note -> direct prompt;
- small focused folder -> direct prompt;
- large focused folder -> Plan rerank;
- Vault Search -> Plan rerank when embedding is unavailable;
- exhaustive folder below direct limit -> all files direct;
- exhaustive folder above direct limit -> every chunk enters one batch;
- direct and batch metadata match what the final model actually received.

### Failure recovery

- malformed rerank JSON -> local candidate fallback;
- HTTP 400/429/5xx during rerank -> local candidate fallback plus warning
  metadata;
- batch summary failure -> local batch excerpt plus warning metadata;
- final model authentication failure -> clear blocking error;
- interrupted tool history -> repair or explicit fresh-chat recovery.

### Gemini state

- an unconfigured/deprecated Gemini provider cannot be selected as an active
  chat model;
- Connect is disabled with an accurate explanation;
- old Gemini chat metadata still renders;
- no refresh attempt is made through a knowingly unavailable consumer route.

## 13. Mandatory Facts for Future Synthesis

1. GPT-5.6 normal chat working does not prove GPT-5.6 Plan rerank works.
2. The live private Codex endpoint rejected `max_output_tokens`; removing that
   field fixed the same request.
3. GPT focused RAG and GPT exhaustive-batch are broken in 1.4.0 for the same
   reason.
4. A fresh representative Sonnet 5 folder rerank succeeded; do not label Sonnet
   5 itself universally broken.
5. 1.4.0 converted several recoverable internal RAG errors, including 429, into
   complete request failures.
6. Strict saved tool-history validation can masquerade as a folder regression.
7. Single-note and small direct-inclusion paths can work while large mention
   paths fail.
8. Gemini Plan OAuth credentials are empty in both 1.3.1 and 1.4.0 custom
   builds.
9. Google ended consumer Gemini Code Assist/Gemini CLI serving and Login with
   Google on 2026-06-18 for individual, AI Pro, and AI Ultra tiers.
10. Restoring old Gemini OAuth constants is not a valid consumer Plan solution.
11. The 1.4.0 targeted tests all pass because they mock the provider contract;
    passing unit tests did not protect this release from the live GPT failure.

## 14. Open Questions Reserved for the Later Plan

- What exact error text and history state accompanied each external Sonnet 5
  report?
- Should internal RAG warnings appear inline in the reference panel, a compact
  status row, or both?
- Should the exhaustive direct limit be derived from each model's usable context
  budget rather than a single static setting?
- Should Plan rerank use a provider-independent local-only fallback by default,
  with model rerank as an enhancement?
- Can Antigravity provide a documented authentication and invocation boundary
  appropriate for third-party desktop plugins?
- Is enterprise Gemini support useful enough to justify a separate provider?
- Should note and folder mentions share one reliability dashboard and
  diagnostics export?

## 15. Source Index

Primary 1.4.0 source paths:

```text
src/constants.ts
src/core/llm/codexMessageAdapter.ts
src/core/llm/codexMessageAdapter.test.ts
src/core/llm/claudeCodeMessageAdapter.ts
src/core/llm/geminiAuth.ts
src/core/llm/geminiPlanProvider.ts
src/core/llm/geminiCodeAssistAdapter.ts
src/core/llm/geminiProject.ts
src/core/rag/internalModel.ts
src/core/rag/planRerank.ts
src/core/rag/exhaustiveFolderRead.ts
src/utils/chat/promptGenerator.ts
src/components/settings/modals/ConnectGeminiPlanModal.tsx
src/components/settings/sections/PlanConnectionsSection.tsx
```

Related mandatory report:

```text
R-001: GPT Plan Native Image and CMDS Eagle R2 Verification Report
```

R-001 independently records the same private Codex backend's rejection of
`max_output_tokens`, strengthening the adapter-contract conclusion.

## 16. Secret-Handling Statement

No OAuth access token, refresh token, API key, Cloudflare credential, cookie, or
other secret value is included in this report. Live tests used existing local
sessions, printed only sanitized status/model/timing data, and persisted the
rotated Claude session through the plugin's existing settings path.
