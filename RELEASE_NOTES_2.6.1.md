# Smart Composer Achmage 2.6.1

## Plan Runtime Stability Hotfix

This release promotes the local Plan runtime work from the unreleased 2.6.0
development build and fixes the two production failures found during real
Obsidian testing:

- Claude Plan no longer fails with `y2e is not a constructor`.
- Gemini Plan no longer finishes thinking without rendering an answer.

## What Changed

### Claude Plan

- Uses the installed official Claude Code executable directly instead of
  bundling the Claude Agent SDK inside Obsidian.
- Supports the stable `opus`, `sonnet`, and `haiku` aliases so future catalog
  revisions do not require hard-coded dated model IDs.
- Parses Claude Code text, thinking, usage, structured tool decisions, and
  errors from its headless stream.
- Keeps Smart Composer in control of tool permissions and uses a bounded local
  tool loop.
- Limits Claude Code's local file access to temporary image attachments created
  for the current request.

### Gemini Plan

- Correctly passes the prompt immediately after Antigravity CLI's `-p` flag.
- Supports the nested Antigravity 1.1.8 `stream-json` event format.
- Uses a verified root-object schema for structured tool decisions.
- Prefers Antigravity's returned `structured_output` and runs in read-only
  `plan` mode.
- Reports an explicit error when Antigravity exits without an answer.

### Runtime Onboarding

- Keeps Plan runtime diagnostics isolated so a failed CLI catalog refresh
  cannot blank the Obsidian settings page.
- Provides local Claude Code and Antigravity installation, sign-in, diagnosis,
  and model-catalog controls under Plan connections.
- Does not store Claude or Google subscription credentials in Smart Composer.

### Research Credential Persistence

- Research credentials such as the NAVER Client ID and Client Secret remain in
  Obsidian SecretStorage across plugin disable/enable, Obsidian restarts, BRAT
  updates, and manual `main.js`/`manifest.json`/`styles.css` updates on the same
  device and Obsidian profile.
- Secret input fields intentionally become blank after saving. The
  `Stored in SecretStorage` placeholder means the value is still stored.
- SecretStorage is device-local and is not copied through Dropbox vault sync.
  Each new computer or Obsidian profile therefore needs a one-time credential
  entry.
- Adds a regression test that recreates the plugin-side secret store and
  verifies that stored NAVER credentials are still readable.

## Verified On A Real Windows Vault

- GPT Plan: existing chat, image, inline-edit, and research workflows preserved.
- Claude Sonnet 5: direct response successful.
- Claude Opus 5: direct response and NAVER News tool call successful.
- Claude Haiku: direct response successful.
- Gemini 3.1 Pro High: direct response successful.
- Gemini 3.6/3.5 Flash family: direct response successful.
- TypeScript check, formatting, lint, production build, and all 491 automated
  tests passed.

## Known Limitations

- Gemini Plan can still make weaker tool-selection and final-synthesis
  decisions than Claude or GPT. In Auto routing, a requested research source
  may occasionally be omitted from the small tool catalog exposed to Gemini.
  Use Claude or GPT Plan for high-confidence MCP and research workflows until
  routing is tightened in a follow-up release.
- Claude Code and Antigravity are started as isolated local processes for each
  request. Consequently, Haiku and Flash can feel slower than their hosted web
  interfaces despite using faster models.
- Claude Plan and Gemini Plan are desktop-only and require their official local
  CLI runtime to be installed and signed in. GPT Plan retains its existing
  Smart Composer connection flow.

## BRAT Installation

The release contains the three files required by BRAT:

- `main.js`
- `manifest.json`
- `styles.css`

Minimum Obsidian version: `1.11.4`.
