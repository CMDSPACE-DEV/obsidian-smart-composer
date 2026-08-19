# R-001: GPT Plan Native Image and CMDS Eagle R2 Verification Report

> [!IMPORTANT]
> **Status: Verified / Mandatory planning input**
>
> Any plan for native image generation in the custom Smart Composer must read
> this report first. It records live behavior that was verified on 2026-07-23,
> not a hypothetical design.

## 1. Executive Summary

An end-to-end experiment proved that Smart Composer's existing OpenAI Plan OAuth
session can invoke the Codex Responses `image_generation` tool without an OpenAI
Platform API key. A generated image was then converted to an exact 1920 x 1080
PNG, uploaded through the same Cloudflare R2 protocol used by CMDS Eagle 1.7.0,
verified through its unauthenticated public URL, and embedded in a new Obsidian
note using CMDS Eagle's Markdown format.

Verified path:

```text
Smart Composer OpenAI Plan OAuth
  -> gpt-5.6 Plan chat model
  -> image_generation hosted tool
  -> base64 PNG result
  -> 1920 x 1080 export
  -> CMDS Eagle R2 Worker /upload
  -> public HTTPS URL
  -> ![filename](url) in an Obsidian note
```

This establishes technical feasibility. It does **not** mean that the current
Smart Composer 1.4.0 UI or adapter already supports images. They do not. It also
does not settle the final UX or the long-term integration contract with CMDS
Eagle.

## 2. Scope and Evidence Boundary

### Verified in this investigation

- The latest custom release branch contains GPT-5.6 Plan tiers and Sonnet 5
  Plan support.
- A Smart Composer OpenAI Plan OAuth token can make a successful hosted image
  tool request through the existing Codex backend endpoint.
- The response stream contains image-generation lifecycle events and a base64
  image result.
- No `OPENAI_API_KEY` was used for either successful Plan image test.
- A high-quality, text-heavy landscape image can be generated and exported as
  a valid 1920 x 1080 PNG.
- CMDS Eagle's configured R2 Worker accepts that PNG using its real upload
  protocol.
- The returned R2 object is publicly accessible and can be embedded in an
  Obsidian note with standard Markdown.

### Not verified in this investigation

- The CMDS Eagle clipboard choice modal was not clicked because Obsidian was not
  running during the remote test.
- A stable, documented public API between Smart Composer and CMDS Eagle was not
  found or tested.
- GPT-5.6 Terra image generation was not tested.
- Image editing, reference-image generation, multiple images, and conversation
  continuation with image artifacts were not tested.
- Mobile Obsidian behavior was not tested. CMDS Eagle declares itself desktop
  only.
- The image tool response did not expose the underlying image model ID. The
  test proves Plan-hosted image generation; attribution to GPT Image 2 follows
  current OpenAI product documentation rather than response metadata.

## 3. Repository and Version Context

Repository:

```text
https://github.com/laguna821/obsidian_smart_composer_Achmage
```

Remote state inspected on 2026-07-23:

| Ref | Commit | Meaning |
| --- | --- | --- |
| Local `main` | `6f6413737c5ece801904b89884ec5ab8c1e4f207` | Local working checkout at test time |
| `origin/main` | `8d6531e12c9c69ac9332eb871198ad2b0bd01092` | Remote main at test time |
| `origin/release/1.4.0-plan-models` | `e844009fa136b94ac8f496fe28f92d43c89dc365` | Latest feature release branch inspected |
| Tag `1.4.0` | `e844009fa136b94ac8f496fe28f92d43c89dc365` | Release tag |

Relevant release commits:

```text
e844009 feat: add chat effort quick control
b27abc6 chore: prepare 1.4.0 release
2a96cf1 feat: migrate Plan settings and harden RAG
2758a27 feat: add Sonnet 5 adaptive Plan support
47b6c85 feat: support GPT-5.6 Plan tiers
```

Verified Plan model IDs in the release branch:

- `gpt-5.6-sol`
- `gpt-5.6-terra`
- `gpt-5.6-luna`
- `claude-sonnet-5`

The image capability tested here is specifically an **OpenAI Plan** capability.
Sonnet Plan support does not imply access to OpenAI's hosted image tool.

## 4. Current Smart Composer Implementation Gap

Inspected release-branch files:

```text
src/core/llm/openaiCodexProvider.ts
src/core/llm/codexMessageAdapter.ts
src/core/llm/codexAuth.ts
src/constants.ts
```

Current Codex endpoint:

```text
https://chatgpt.com/backend-api/codex/responses
```

The current adapter is text/function-tool oriented:

1. `buildRequestBody()` converts every Smart Composer request tool into a
   Responses `FunctionTool` with `type: "function"`.
2. It has no discriminated representation for hosted tools such as
   `type: "image_generation"`.
3. Streaming handles text, reasoning summaries, and function-call argument
   events, but not image lifecycle or partial-image events.
4. `extractResponseText()` extracts only assistant text.
5. `extractToolCalls()` extracts only `function_call` items.
6. `ReplayableCodexOutputItem` accepts only `message`, `reasoning`, and
   `function_call`. Persisting an image output item without changing this
   validation could break later conversation replay.
7. Shared response types do not currently expose a generated-image artifact.

Therefore native image support requires changes across request types, adapter
stream parsing, response/artifact types, persistence, chat rendering, and
insertion actions. Merely adding `gpt-image-2` to the model list is not enough.

## 5. Authentication Boundary

The successful requests used OAuth credentials already stored by Smart
Composer's `openai-plan` provider. The request headers were equivalent to:

```http
Authorization: Bearer <Smart Composer Plan access token>
ChatGPT-Account-Id: <configured account id>
Content-Type: application/json
```

Important distinctions:

- The successful test did not use the Codex CLI token as a bridge.
- The successful test did not use an OpenAI Platform API key.
- The successful test did not call the public Images API.
- The Plan access token, refresh token, account ID, and CMDS Eagle R2 API key
  are intentionally excluded from this report.
- Future implementation must never log these credentials or include them in
  chat history, diagnostics, generated notes, or test snapshots.

The endpoint is an internal ChatGPT/Codex backend rather than a documented
general-purpose public API. A production-quality custom plugin should treat the
feature as Plan-specific and potentially subject to backend change.

## 6. Sanitized Request Shape That Worked

The successful request used a GPT-5.6 Plan chat model and forced the hosted image
tool. The essential shape was:

```json
{
  "model": "gpt-5.6-sol",
  "input": [
    {
      "role": "user",
      "content": [
        {
          "type": "input_text",
          "text": "<image brief>"
        }
      ]
    }
  ],
  "instructions": "Use the image generation tool exactly once.",
  "store": false,
  "stream": true,
  "include": ["reasoning.encrypted_content"],
  "reasoning": { "effort": "medium" },
  "tools": [
    {
      "type": "image_generation",
      "quality": "high",
      "size": "1536x1024",
      "output_format": "png"
    }
  ],
  "tool_choice": { "type": "image_generation" }
}
```

Do not copy this request blindly into the existing generic adapter. It needs a
typed hosted-tool path and model/provider gating.

### Important negative finding

A first probe included:

```json
{ "max_output_tokens": 1024 }
```

The internal endpoint returned HTTP `400`:

```text
Unsupported parameter: max_output_tokens
```

Removing that field allowed image generation to proceed. The dedicated image
path must omit unsupported optional text-generation fields rather than sending
arbitrary defaults.

## 7. Live Plan Image Results

### Probe A: Small capability test

| Item | Result |
| --- | --- |
| Plan model | `gpt-5.6-luna` |
| Tool | `image_generation` |
| Requested quality | `low` |
| HTTP result | `200` |
| Terminal event | `response.completed` |
| Image result | Present |
| Estimated decoded image size | 692,385 bytes |
| Approximate elapsed time | 23 seconds |

This was the decisive capability proof: the Plan endpoint accepted the hosted
tool and returned image bytes without an API key.

### Probe B: Text-heavy high-quality infographic

| Item | Result |
| --- | --- |
| Plan model | `gpt-5.6-sol` |
| Requested quality | `high` |
| Requested size | `1536x1024` |
| Returned source dimensions | `1672 x 941` |
| Returned source bytes | 1,312,150 bytes on the accepted second render |
| Terminal event | `response.completed` |
| Approximate elapsed time | 144 seconds |

The backend did not return the exact requested dimensions. Future code must read
the actual image header instead of trusting request metadata.

The accepted render contained:

- a large title and subtitle;
- a Korean tagline;
- six labeled workflow stages;
- an example Markdown image URL;
- four status labels;
- a compact pipeline footer.

The first high-quality attempt exposed a test-harness encoding issue: non-ASCII
prompt characters passed through a PowerShell pipe became question marks. A
second request encoded the Korean text safely and rendered it correctly. Normal
TypeScript strings inside Obsidian should remain UTF-8, but automated shell-based
tests must avoid platform-default encoding assumptions.

### Export normalization

The accepted source was resized to an exact 1920 x 1080 PNG while preserving the
composition. Final properties:

```text
Dimensions: 1920 x 1080
MIME type: image/png
File size: 1,222,690 bytes
Filename: smart-composer-plan-r2-pipeline-1920x1080-20260723.png
```

Dimension normalization was part of this test harness, not a claim that every
generated image should always be resized. A future UI should distinguish the
actual generated dimensions from an optional export preset.

## 8. Response Events That Must Be Supported

The live stream included image-specific events absent from the current adapter:

```text
response.image_generation_call.in_progress
response.image_generation_call.generating
response.image_generation_call.partial_image
```

It also included normal lifecycle events such as:

```text
response.created
response.in_progress
response.output_item.added
response.output_item.done
response.content_part.added
response.output_text.done
response.content_part.done
response.completed
```

The completed output contained an item with:

```text
type: image_generation_call
result: <base64 image payload>
```

The streaming UI should treat generation, image decoding, local saving, R2
uploading, and Markdown insertion as separate phases. An upload failure must not
discard a successfully generated image or force the user to pay for regeneration.

## 9. CMDS Eagle Context

The vault contains several Eagle-related plugins. The plugin tested here was
specifically:

```json
{
  "id": "cmds-eagle",
  "name": "CMDS Eagle",
  "version": "1.7.0",
  "isDesktopOnly": true
}
```

Relevant installed files:

```text
.obsidian/plugins/cmds-eagle/main.js
.obsidian/plugins/cmds-eagle/manifest.json
.obsidian/plugins/cmds-eagle/data.json
.obsidian/plugins/cmds-eagle/styles.css
```

Non-secret settings observed at test time:

```text
activeCloudProvider: r2
imagePasteBehavior: ask
imageDisplayMode: cloud
insertAsEmbed: true
R2 provider enabled: true
```

The configured Worker URL, public R2 base URL, and API key remain owned by CMDS
Eagle. The API key is not reproduced here.

## 10. Exact CMDS Eagle R2 Upload Contract

Source inspection showed that `R2Provider.upload()` performs the following:

1. Read the local image bytes.
2. Create a `Blob` using the image MIME type.
3. Create `FormData` with:
   - `file`: image Blob and filename;
   - `filename`: original filename;
   - `content_type`: MIME type.
4. POST to `<workerUrl>/upload`.
5. Set `Authorization: Bearer <CMDS Eagle R2 API key>`.
6. Read JSON containing at least `key`.
7. Build the public URL as `<publicUrl>/<key>`.
8. Insert:

```markdown
![filename](https://public-r2-host/key)
```

CMDS Eagle's paste workflow first inserts a temporary uploading placeholder and
then replaces it with the final Markdown image when upload succeeds.

### Worker health behavior

The configured Worker's `/health` endpoint returned HTTP `404` during this test.
The real `/upload` endpoint nevertheless returned HTTP `200` and worked normally.

Planning implication: do not make `/health` success a mandatory precondition for
upload unless the Worker contract is updated. The upload itself is the meaningful
operation, and a missing optional health route should not disable the feature.

## 11. End-to-End R2 Result

The exact CMDS Eagle upload protocol was executed with the final PNG.

| Check | Result |
| --- | --- |
| Worker upload | HTTP `200` |
| Returned object key | Present |
| Public request without R2 credentials | HTTP `206` for a range request |
| Public content type | `image/png` |
| Parsed public PNG dimensions | `1920 x 1080` |
| Public image bytes | Same uploaded 1,222,690-byte asset |

Public test artifact:

```text
https://pub-acf6ad93f2ec4a5e8fa12e94d0c9b151.r2.dev/1784734336667-b05573e7-cbb7-478a-b74c-092d231fc3c9.png
```

Vault test note:

```text
01. Inbox/Smart Composer Plan Image x CMDS Eagle R2 실전 워크플로우 테스트 (7-23-2026).md
```

Markdown embedded in that note:

```markdown
![smart-composer-plan-r2-pipeline-1920x1080-20260723.png](https://pub-acf6ad93f2ec4a5e8fa12e94d0c9b151.r2.dev/1784734336667-b05573e7-cbb7-478a-b74c-092d231fc3c9.png)
```

The image was then fetched through the public URL and its PNG header was parsed,
so the result was not accepted solely on the Worker's success response.

## 12. What the R2 Test Does and Does Not Prove

It proves that Smart Composer can eventually implement this real workflow:

```text
generate image -> receive bytes -> send CMDS-compatible upload -> insert URL
```

It does not prove that invoking CMDS Eagle's private runtime methods is a stable
integration strategy. During the test, Obsidian and CMDS Eagle were not running;
the test reproduced the plugin's exact provider protocol using its configured
settings.

The final architecture must choose deliberately among:

1. A documented CMDS Eagle public API, if one is added or discovered.
2. An explicit optional runtime bridge to the installed plugin.
3. A shared upload-contract module coordinated with CMDS Eagle.
4. Separate R2 configuration in Smart Composer as a fallback.

Silently scraping another plugin's `data.json` at runtime would be fragile and
would cross a credential-ownership boundary. The live test used it only under the
user's explicit request to verify feasibility. It should not become the default
production design without an explicit security and compatibility decision.

## 13. UX Context That Future Planning Must Preserve

This section records requirements and design constraints revealed by the test.
It is not the final implementation plan.

### 13.1 Entry point must distinguish attach from generate

Smart Composer already exposes image attachment behavior. Native generation must
not make the existing `Image` control ambiguous. Future planning should evaluate
one of these explicit patterns:

- a dedicated image-generation icon with a tooltip;
- an `Attach image / Generate image` menu;
- a compact image mode selector near the composer.

Natural-language detection alone is not enough because image generation can use
substantial Plan quota and take minutes at high quality.

### 13.2 Generation state must remain visible

High-quality Plan generation took about 144 seconds in two live attempts. The UI
needs stable, phase-specific status rather than a generic chat spinner:

```text
Preparing request
Generating image
Receiving image
Saving to vault
Uploading to Cloudflare R2
Inserted into note
```

The user should be able to cancel while the network request is active. Once the
image has been received, canceling or retrying R2 should not regenerate it.

### 13.3 Preview and full-size inspection

The chat should show a stable-aspect-ratio preview that does not resize the
conversation layout when bytes arrive. The preview should support:

- click or keyboard activation to open a full-screen lightbox;
- original-pixel inspection with zoom and pan;
- visible actual dimensions, format, and file size;
- open-in-note or reveal-file actions;
- retry/regenerate and upload retry as separate actions.

"Full size" has two meanings and the UI should distinguish them:

1. Preserve the original full-resolution asset.
2. Render responsively inside the Obsidian note or chat viewport.

Do not stretch the image merely to fill the chat width. Store actual dimensions
and preserve aspect ratio.

### 13.4 Insertion actions

At minimum, future planning should account for:

- insert at the current editor cursor;
- append to the active note;
- save to a configured local attachment folder;
- upload to CMDS Eagle R2 and insert the public URL;
- copy Markdown;
- copy the public URL;
- open the full image.

The insertion action should use the already generated artifact. It must not issue
a second image-generation request.

### 13.5 Destination policy

A likely settings decision is required among:

- ask after each generation;
- save locally by default;
- upload to R2 by default;
- local save plus optional R2 upload.

The test does not choose the default. It does show that generation success and
storage destination must be represented independently.

### 13.6 CMDS Eagle compatibility

CMDS Eagle is desktop-only. A future design should not let its absence block core
Plan image generation. The UI should degrade cleanly:

```text
Plan image generation available
CMDS Eagle unavailable or unconfigured
-> save locally / copy image / configure integration
```

If direct Worker upload is intentionally supported on mobile later, that should
be a separate capability with its own credential and security design rather than
being described as CMDS Eagle mobile support.

### 13.7 Failure recovery

Failures should be scoped to their phase:

- Plan authentication failure: reconnect Plan account.
- Image tool unsupported: explain that this Plan backend no longer exposes it.
- Generation rejection: retain prompt and allow editing/retry.
- Base64 decode or file-write failure: retain response metadata for diagnostics.
- R2 upload failure: keep local image and provide `Retry upload`.
- Markdown insertion failure: keep local/remote artifact and provide `Copy link`.

## 14. Data and Persistence Implications

A generated image should become a first-class artifact rather than a very large
text message. A future data design will likely need fields equivalent to:

```ts
type GeneratedImageArtifact = {
  id: string
  providerType: 'openai-plan'
  chatModel: string
  prompt: string
  mimeType: string
  width: number
  height: number
  byteLength: number
  localPath?: string
  remoteUrl?: string
  remoteProvider?: 'cmds-eagle-r2'
  status: 'generating' | 'ready' | 'uploading' | 'inserted' | 'failed'
}
```

This is an illustrative context model, not a finalized interface.

Persistence constraints:

- Do not persist multi-megabyte base64 strings inside normal chat history after
  a file or URL has been created.
- Persist artifact references and dimensions so history can render after reload.
- Decide how a generated image output item participates in later Responses
  conversation replay.
- Existing history without image metadata must continue to load.
- Deleting chat history must not unexpectedly delete vault or R2 assets.
- Temporary file cleanup needs a deliberate policy. CMDS Eagle currently uses
  `.eagle-temp`; intermediate files remained after this remote test because the
  cleanup command was blocked by the remote command policy.

## 15. Security and Privacy Constraints

The later plan must explicitly preserve these boundaries:

- Never expose OAuth access tokens, refresh tokens, ChatGPT account IDs, or R2
  API keys in logs or UI diagnostics.
- Do not include credentials in generated Markdown or persisted chat messages.
- Warn that an R2 public URL is publicly retrievable by design.
- Sanitize filenames and prevent path traversal before local writes.
- Use collision-safe filenames.
- Require explicit user intent before automatic public upload unless the user
  has deliberately selected an auto-upload setting.
- Do not silently inherit another plugin's secrets without a documented consent
  and ownership model.
- Treat the internal Plan endpoint as an unstable integration boundary and show
  actionable errors rather than silently falling back to paid API usage.

## 16. Testing Context for the Future Implementation

The eventual implementation plan should include at least these categories.

### Adapter tests

- Hosted `image_generation` tool is passed without conversion to `function`.
- Image requests omit `max_output_tokens` on the internal Plan endpoint.
- `gpt-5.6-sol` and `gpt-5.6-luna` remain unchanged in the wire request.
- Image lifecycle events update progress correctly.
- Final `image_generation_call.result` is decoded.
- Text plus image output in one response does not lose either artifact.
- Unknown events do not crash the stream.
- Abort signals stop generation cleanly.

### Persistence tests

- Chat reload renders an image from a local vault path.
- Chat reload renders an image from an R2 URL.
- Base64 payload is not retained unnecessarily.
- Existing text-only history remains compatible.
- Follow-up messages do not fail replay validation because of image output items.

### Vault tests

- Binary save uses a safe, collision-free path.
- Active-note insertion occurs at the intended cursor.
- No active note produces an explicit destination choice.
- Full-resolution dimensions are preserved.
- Failed insert does not delete the generated image.

### R2 integration tests

- Multipart field names match CMDS Eagle exactly.
- Authorization secrets are redacted from errors.
- A 404 `/health` result does not preempt a valid `/upload` operation.
- Upload success produces `![filename](publicUrl)`.
- Upload failure retains the local artifact and enables retry.
- CMDS Eagle absent/disabled falls back without breaking generation.

### UX tests

- Long generation does not shift the composer layout.
- Preview works at narrow and wide desktop widths.
- Full-screen view preserves aspect ratio and supports keyboard dismissal.
- Long filenames and URLs do not overflow controls.
- Generation, upload, and insertion states are visually distinct.
- Screen-reader labels and alt text are available.

### Live opt-in smoke test

Automated tests should mock the Plan and R2 endpoints. A separately invoked live
test may consume Plan quota and create a public R2 object, so it must be opt-in
and clearly labeled.

## 17. Open Questions Reserved for the Later Plan

The following decisions remain intentionally unresolved:

1. Exact composer entry point and whether image generation is a mode, command,
   or dedicated tool button.
2. Default quality, size, and export behavior.
3. Whether the first release supports generation only or also image editing.
4. Whether to use a CMDS Eagle public API, runtime bridge, shared module, or
   duplicate R2 settings.
5. Whether R2 upload is automatic, per-image confirmation, or disabled by
   default.
6. Whether the original generated dimensions and a normalized export are both
   retained.
7. How image artifacts are represented in persisted chat history and replayed
   to the Plan endpoint.
8. Whether any part of the feature should work in mobile Obsidian.
9. How remote R2 deletion or replacement should work, if at all.
10. How Plan quota usage and internal-endpoint instability are communicated.

These are planning questions, not reasons to discard the verified feasibility
result.

## 18. Non-Negotiable Facts for Future Synthesis

Any later roadmap must preserve the following facts:

1. Plan-only image generation succeeded without an OpenAI API key.
2. It succeeded using Smart Composer's own OpenAI Plan OAuth credentials.
3. The current 1.4.0 adapter does not yet understand hosted image tools or image
   response events.
4. `max_output_tokens` caused a live 400 on the image request and was omitted in
   successful requests.
5. High-quality generation took roughly 2.4 minutes, so progress UX matters.
6. Returned dimensions differed from requested dimensions, so actual image
   metadata must be inspected.
7. CMDS Eagle 1.7.0 uploads to R2 using multipart fields `file`, `filename`, and
   `content_type`, with Bearer authentication.
8. `/health` returned 404 while `/upload` succeeded; health is not a reliable
   gate in the current deployment.
9. The public R2 asset and Markdown embed were verified end to end.
10. The clipboard modal itself was not exercised, and CMDS Eagle has no verified
    stable public integration API yet.
11. The response did not expose the underlying image model ID, so the report must
    not misrepresent that as directly observed metadata.
12. Secrets must remain outside logs, reports, chat history, and notes.

## 19. Related Future Investigations

The user intends to investigate these separately over multiple sessions:

- Claudian features that may be adapted into Smart Composer.
- Vault Operator features that may be adapted into Smart Composer.
- Folder mention and note mention reliability/bugs in Smart Composer.

No findings about those topics are claimed in this report. Each must receive its
own evidence report and registry entry before the final combined roadmap is
created.

## 20. External References

- OpenAI image generation guide:
  <https://developers.openai.com/api/docs/guides/image-generation>
- GPT Image 2 model page:
  <https://developers.openai.com/api/docs/models/gpt-image-2>
- Custom Smart Composer repository:
  <https://github.com/laguna821/obsidian_smart_composer_Achmage>
- Release branch inspected:
  <https://github.com/laguna821/obsidian_smart_composer_Achmage/tree/release/1.4.0-plan-models>

## 21. Secret-Handling Statement

No OAuth token, refresh token, ChatGPT account ID, CMDS Eagle R2 API key, or
other private credential is recorded in this report. The only full remote URL
included is the intentionally public R2 test artifact used to verify rendering.
