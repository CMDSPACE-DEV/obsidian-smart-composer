# Smart Composer Achmage 2.6.2

## Cross-platform Plan runtime onboarding

This release makes Claude Plan and Gemini Plan onboarding explicit and
device-local. The installation guide now works as one continuous four-step
flow on Windows and macOS, without requiring users to close and reopen the
settings window after installation.

## What changed

### Installation and sign-in

- Adds separate Windows and macOS guide tabs with the current platform selected
  automatically.
- Uses the official native Claude Code and Google Antigravity installer
  commands as the recommended path.
- Opens a visible PowerShell or Terminal.app window but never executes a remote
  installer automatically; users remain in control of pasting and running the
  copied command.
- Rechecks installation in place and unlocks the account sign-in step
  immediately when the executable is found.
- Uses platform-correct paste guidance (`Ctrl+V` on Windows and `Command+V` on
  macOS) and accessible tab, focus, and status semantics.

### Device-local runtime state

- Stops persisting runtime health, version, and discovered model catalogs in
  vault settings, preventing a ready state from one computer appearing on a
  different computer.
- Rechecks both local runtimes when Plan settings open and shares one live
  snapshot between the connection card and installation dialog.
- Discovers official native, WinGet, Homebrew, legacy, PATH, and custom
  installations and warns when multiple candidates make updating ambiguous.

### Updates and billing safety

- Uses the update mechanism that matches the detected Claude installation.
- Removes the undocumented `agy update` command and provides Antigravity's
  documented background-update/reinstall guidance instead.
- Blocks Claude or Gemini Plan requests when Smart Composer cannot positively
  establish an eligible subscription/quota source, or when API-key, cloud,
  gateway, or enterprise billing indicators could take precedence.
- Disables user/project/local Claude setting sources for requests and blocks
  all Claude Plan inference in 2.6.2 because the current CLI cannot prove that
  remote managed credentials will not override an apparent Pro/Max login.
- Blocks all Gemini Plan inference in 2.6.2 because the current Antigravity CLI
  exposes no machine-readable proof of personal Plan quota provenance.
- Never stores or logs CLI tokens, account identifiers, browser sessions, or
  Keychain/Credential Manager contents.

## Automated platform qualification

- Linux quality checks cover dependency installation, type checking, linting,
  all tests, production build, and the 6.5 MiB bundle budget.
- Windows Server 2025 covers PowerShell, WinGet-path, resolver, and UI logic.
- GitHub-hosted macOS 15 Apple Silicon and Intel runners verify the reviewed
  official installer scripts, canonical executable paths, binary architecture,
  and `--version` output without signing in or making model requests.
- A pinned Obsidian desktop smoke test loads the three-file plugin bundle in an
  isolated vault and records plugin errors, DOM checks, and screenshots.

## Verification boundary

No personal Claude or Google credentials are uploaded to GitHub Actions.
Browser OAuth callbacks, Apple Keychain persistence, and the human-visible
Terminal paste experience are therefore not claimed as authenticated
end-to-end CI coverage. Authentication classifiers are exercised with redacted
fixtures and fail closed when provenance is unknown.

## BRAT installation

The release contains the three files required by BRAT:

- `main.js`
- `manifest.json`
- `styles.css`

Minimum Obsidian version: `1.11.4`.
