# R-024: Native Plan CLI Live Protocol And Runtime Fix

## Status

- **Verified**
- **Mandatory**
- Investigation date: 2026-07-29
- Target: Smart Composer Achmage 2.6.0 hotfix

## Trigger

After successful local sign-in, two real chat failures remained:

1. Claude Plan Opus and Sonnet ended with the minified runtime error
   `y2e is not a constructor`.
2. Gemini Plan entered its thinking state and then completed without rendering
   an answer.

These failures occurred after authentication, so login state and model catalog
discovery were not sufficient release tests.

## Runtime Versions And Live Probes

The following installed official runtimes were tested directly:

- Claude Code `2.1.220`
- Antigravity CLI `1.1.8`

The probes used isolated temporary working directories, a minimal prompt, no
vault path, and no recorded account identifier.

### Claude Code

`claude -p` with verbose `stream-json`, a stable `sonnet` alias, disabled
built-in tools, safe mode, and no session persistence returned a valid stream.
The alias resolved at runtime to Claude Sonnet 5 and emitted:

- `system/init`
- `stream_event/content_block_delta/text_delta`
- `assistant`
- `stream_event/message_delta`
- `result` with subtype `success`

The exact requested marker was returned successfully. This proves that the
installed CLI, subscription authentication, stable alias, and headless stream
were healthy on the test device.

A second live probe verified that the stable `opus` alias resolved to
Claude Opus 5 and returned the exact requested marker.

### Antigravity CLI

Antigravity's `-p` flag consumes the next command-line argument as the prompt.
It does not read a missing prompt from stdin.

The previous plugin invocation was equivalent to:

```text
agy -p --output-format stream-json --model ...
```

Consequently, Antigravity treated `--output-format` as the user's prompt,
returned ordinary explanatory text, and never parsed the later flags as
intended. Smart Composer then discarded that plain text while waiting for JSON
events.

The corrected invocation places the prompt immediately after `-p`. Antigravity
then emitted NDJSON with this verified shape:

- top-level discriminator: `event`, not `type`
- step payload: `step_update`
- answer delta: `step_update.text_delta`
- final payload: nested `result`
- final answer: `result.response`
- token counts: `result.usage`

The exact requested marker was returned successfully with
`gemini-3.6-flash-medium`.

A second live probe also returned the exact requested marker with
`gemini-3.1-pro-high`.

A structured-output probe found that Antigravity 1.1.8 handles a single root
object schema reliably, while a root `oneOf` schema can trigger repeated
internal retries. The production adapter therefore uses a root object with a
`type` discriminator, prefers the returned `structured_output`, and runs the
CLI in read-only `plan` mode.

## Claude Agent SDK Bundle Failure

The Claude Agent SDK worked as source-level reference code but was not stable
after being bundled and minified into Obsidian's single `main.js`.

The observed `y2e` identifier maps to the bundled MCP server constructor used
by the SDK's in-process MCP bridge. Earlier settings diagnostics had also
encountered SDK initialization failure around telemetry propagation. Keeping
the SDK lazy prevented the settings page from going blank, but it did not make
the real chat path reliable.

The production decision is therefore:

- do not bundle or initialize `@anthropic-ai/claude-agent-sdk`;
- invoke the installed official `claude` executable directly;
- parse its documented headless stream;
- keep Smart Composer as the owner of chat history and tool permissions;
- use a bounded structured outer loop for Smart Composer tool calls;
- disable Claude Code filesystem, shell, browser, plugin, and session
  persistence features;
- allow Claude Code's `Read` tool only for temporary image files explicitly
  materialized by Smart Composer.

This mirrors the already approved Antigravity trust boundary and removes the
unstable in-process MCP constructor from the plugin bundle.

## Implemented Corrections

### Claude

- Replaced Agent SDK `query()` with direct official CLI execution.
- Added real-time parsing for text and thinking deltas.
- Added result, usage, and error parsing.
- Kept stable `opus`, `sonnet`, and `haiku` aliases.
- Kept cancellation and process-tree termination.
- Added a 24-step bounded local tool loop through the existing
  `nativeToolExecutor`.
- Materialized image inputs into the isolated temporary directory and exposed
  only those paths to Claude Code's `Read` tool.
- Removed the Agent SDK package and its in-process MCP bridge from the bundle.

### Gemini

- Passed the prompt as the value immediately following `-p`.
- Stopped sending an ignored stdin prompt.
- Added support for the verified `event`, `step_update.text_delta`, nested
  `result.response`, and nested usage fields.
- Added final-response fallback when no deltas were emitted.
- Changed a successful empty response into an explicit diagnostic instead of a
  silent blank assistant message.

## Remaining Boundary

Antigravity accepts its headless prompt as a command-line value. Windows has a
finite process command-line length, so very large Gemini Plan prompts require a
future verified file/stdin transport or a bounded preflight error. This does
not affect the reproduced short-chat failure, but it remains a document-scale
Gemini Plan release test.

Claude Code accepts the prompt over stdin and does not share that command-line
length limitation.

## Security And Privacy

No OAuth token, API key, account email, organization identifier, session
content, or vault text was recorded in this report.
