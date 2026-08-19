# Smart Composer Achmage 2.6.5

## Gemini Plan update and connected-state UX

This patch makes a working Antigravity connection look and behave like a
working connection. It also replaces the previous documentation-only update
dialog with a safe way to open the installed Antigravity CLI and recheck its
locally observed version.

## What changed

- Shows a healthy Gemini Plan connection as Korean success information instead
  of presenting the internal English legacy-catalog compatibility reason as a
  warning.
- Keeps catalog and authentication classification details internally for
  diagnosis and tests; normal connected users no longer see those implementation
  details as an error-like alert.
- Replaces the destructive-looking Antigravity update guide with a dedicated,
  non-destructive Korean `자동 업데이트 확인` dialog.
- Shows only the installed version observed on the current device. Smart
  Composer does not claim that this is the newest remote version.
- Opens only the exact, unambiguous Antigravity executable selected by the
  runtime resolver, with no arguments and from an operating-system temporary
  directory. This gives Antigravity's documented native background updater an
  opportunity to run during normal CLI startup.
- Adds `버전 다시 확인`, which repeats the sanitized local diagnosis and
  reports the version currently observed on the device. An unchanged version
  is not described as a failed or completed update.
- Keeps the official Antigravity updater troubleshooting page available as a
  secondary action.
- Disables CLI launch when the runtime is missing or multiple installations
  make selection ambiguous, instead of starting an arbitrary executable.
- Does not run an undocumented `agy update` command, re-run an installer, delete
  a binary, or depend on Antigravity's undocumented manifest service.

## Authentication and billing boundary

The Gemini compatibility behavior restored in 2.6.4 is preserved. A successful
official Antigravity model catalog can enable Gemini requests even though the
CLI does not expose a supported machine-readable personal-quota field. Concrete
API-key, Application Default Credentials, Google Cloud project, quota-project,
Vertex AI, enterprise, and consumption-billing evidence remains blocked before
inference.

The Claude Pro/Max behavior and concrete billing-source guards from 2.6.3 and
2.6.4 are unchanged. Smart Composer does not read, persist, or log OAuth tokens,
account identifiers, API-key values, or operating-system credential-store
contents.

## Verification

- Unit and component coverage checks the Korean ready state, absence of
  warning/error presentation for a usable catalog, exact executable launch,
  missing and ambiguous runtime handling, version re-diagnosis, Windows
  PowerShell behavior, and macOS Terminal argument and working-directory
  quoting.
- The Ubuntu gate runs type checking, lint, the full test suite, the production
  build, and the bundle budget. Windows Server 2025, macOS 15 Apple Silicon,
  and macOS 15 Intel repeat the full tests and production build.
- Separate macOS jobs verify reviewed official installer bytes and load the
  three-file plugin bundle in a pinned Obsidian desktop fixture using inert
  runtimes and an empty disposable vault.

## Verification and support boundary

GitHub Actions uses no personal OAuth credentials and does not test browser
sign-in, Apple Keychain or Windows Credential Manager persistence, personal
quota accounting, a billable model request, or background-update completion.
The hosted checks prove the plugin's local state transitions, launch boundaries,
and generated bundle; they do not prove which remote quota Google will use or
when Antigravity will download and replace a binary.

## BRAT installation

The release contains the three files required by BRAT:

- `main.js`
- `manifest.json`
- `styles.css`

Minimum Obsidian version: `1.11.4`.
