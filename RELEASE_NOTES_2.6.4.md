# Smart Composer Achmage 2.6.4

## Gemini Plan compatibility restoration

This hotfix restores Gemini Plan requests through the official Antigravity CLI.
Versions 2.6.2 and 2.6.3 treated every otherwise healthy Antigravity login as
blocked when the CLI could not prove which quota source would be used. That
policy prevented existing Gemini Plan users from using a connection that had
worked in 2.6.1.

## What changed

- Treats a successful Antigravity model-catalog check with at least one usable
  model as a connected Gemini runtime and permits the request path.
- Repeats the Gemini guard immediately before every request instead of trusting
  only the status previously shown in Settings.
- Continues to block concrete API or Google Cloud overrides, including API-key,
  Application Default Credentials, Cloud project, quota-project, and Vertex AI
  environment signals.
- Continues to block machine-readable Antigravity output that explicitly
  identifies Google Cloud, ADC, enterprise, or consumption-billing provenance.
- Keeps credentials in the official Antigravity runtime and operating-system
  credential store. Smart Composer does not read, persist, or log OAuth tokens,
  account identifiers, API-key values, or credential-store contents.
- Leaves the Claude Pro/Max correction from 2.6.3 and its concrete billing-source
  protections unchanged.

## Compatibility and billing boundary

Antigravity currently does not expose a supported machine-readable field that
proves an otherwise healthy login will consume an individual Google AI Plan
quota. Smart Composer therefore describes this as a compatibility path, not as
verified quota or billing provenance. Users should confirm the account and plan
selected by Antigravity. If Smart Composer detects a concrete Cloud/API override,
the request remains blocked before inference starts.

## Verification

- Unit and provider coverage checks the restored connected path, request-time
  revalidation, model-catalog requirements, and retained API/Cloud blocks.
- Linux, Windows Server 2025, macOS 15 Apple Silicon, and macOS 15 Intel jobs
  repeat the source tests and production build.
- The macOS jobs verify reviewed official installer scripts and load the
  three-file plugin bundle in a pinned Obsidian desktop fixture without using
  personal OAuth credentials.

## Verification and support boundary

GitHub Actions contains no personal OAuth credentials and does not test browser
sign-in, Keychain or Credential Manager persistence, personal quota accounting,
or a billable model request. Fixture tests prove the plugin's state transitions
and blocking rules; they do not prove which remote quota Google will charge.

## BRAT installation

The release contains the three files required by BRAT:

- `main.js`
- `manifest.json`
- `styles.css`

Minimum Obsidian version: `1.11.4`.
