# R-029: Antigravity Update And Ready-State UX

## Status

- Evidence status: **Partially verified**
- Planning use: **Mandatory for Antigravity updater and connected-state UX or
  the 2.6.5 patch/release**
- Investigation date: 2026-08-10
- Repository baseline: annotated tag `2.6.4` (tag object
  `f6a164962798d3e47ff44558b8b3eac883cd4593`, peeled commit
  `bb00a1afbc36d5561e79649ab373fdc3b9e77940`)
- Working branch: `codex/2.6.5-antigravity-update-ux`
- Target release: Smart Composer Achmage `2.6.5`

## Executive Summary

Two user-supplied 2.6.4 screenshots exposed separate UX defects in a working
Antigravity installation.

1. `업데이트 안내` opened a red confirmation dialog whose only productive
   action was opening installation documentation. It did not start the official
   background update check or re-read the installed version. The screenshot's
   installed Antigravity CLI `1.1.11` was already the current official version,
   but the product gave the user no way to understand that unchanged version as
   a successful outcome.
2. A successful legacy text catalog fallback produced a `ready` snapshot with
   11 models, but the internal English compatibility reason was copied into
   `snapshot.warning` and rendered with warning colors. The user reasonably
   interpreted a normal, usable connection as an error.

The 2.6.5 correction must preserve R-028's compatibility and Cloud/API guards
while fixing presentation and action semantics. Smart Composer will open the
exact resolved `agy` executable in a visible terminal so its documented native
background updater has an opportunity to run, then let the user re-diagnose the observed local
version. It will not execute the undocumented `agy update` command, re-run an
installer that currently exits on an existing binary, scrape account quota
panels, or claim that an unchanged version proves a remote update occurred.

A healthy Gemini path will display a Korean success treatment. The technical
catalog/provenance reason remains available internally in `authDecision` for
tests and diagnostics but is not a default warning or alert.

## Research Question

How should Smart Composer provide a real, beginner-safe Antigravity update
action and display a healthy compatibility connection without making success
look like an error or inventing an unsupported updater command?

### In scope

- The Antigravity update button, modal, terminal launch, and local version
  re-diagnosis.
- The severity, language, and accessibility of a successful JSON or legacy
  text catalog result.
- Windows and macOS visible-terminal behavior.
- Current first-party updater documentation, installer behavior, and version
  evidence.
- Unit, component, full-regression, and hosted release gates for 2.6.5.

### Out of scope

- Replacing the R-024 headless request protocol.
- Relaxing R-028's explicit API, ADC, Google Cloud, Enterprise, Vertex, or
  consumption-billing blocks.
- Reading keyring, account, project, `/usage`, `/quota`, or `/credits` data.
- Automatic deletion or replacement of an installed binary.
- Treating the installer's mutable manifest endpoint as a stable public API.

## Baseline And Reproducibility

The investigation started from clean annotated tag `2.6.4`, commit
`bb00a1afbc36d5561e79649ab373fdc3b9e77940`, and created only the new branch
`codex/2.6.5-antigravity-update-ux` before implementation.

The supplied screenshots show these sanitized facts:

- installed version `1.1.11`;
- 11 detected models;
- one detected installation;
- a `ready` connection that still displays the English legacy-catalog
  compatibility reason in warning styling;
- an `Antigravity 업데이트 안내` dialog with a destructive-looking primary
  button and English `Cancel` whose primary action opens documentation.

No screenshot content was copied into fixtures or research assets. No account,
token, keyring, project, vault, or executable-path identifier was recorded.

## Sources Inspected

### Repository source

- `src/components/settings/sections/PlanConnectionsSection.tsx`
- `src/components/settings/modals/ConfirmModal.tsx`
- `src/components/settings/modals/NativeRuntimeInstallModal.tsx`
- `src/components/settings/modals/NativeRuntimeLoginModal.tsx`
- `src/components/settings/modals/NativeRuntimeUpdateModal.tsx`
- `src/components/settings/modals/NativeRuntimeUpdateModal.test.tsx`
- `src/core/llm/native/NativeRuntimeAuth.ts`
- `src/core/llm/native/NativeRuntimeService.ts`
- `src/core/llm/native/NativeProcess.ts`
- `src/core/llm/native/NativeProcess.test.ts`
- `src/core/llm/native/NativeRuntimeService.test.ts`
- `src/core/llm/native/NativeRuntimeService.diagnose.test.ts`
- `src/components/settings/modals/NativeRuntimeOnboarding.interaction.test.tsx`
- `.github/scripts/obsidian-smoke-macos.sh`
- `.github/workflows/release.yml`
- `RELEASE_NOTES_2.6.5.md`
- `styles.css`
- R-023, R-024, R-025, and R-028 in full

### First-party external sources

All sources were accessed on 2026-08-10.

- [Antigravity Installation and auth](https://antigravity.google/docs/cli/install)
- [Antigravity CLI reference](https://antigravity.google/docs/cli/reference)
- [Antigravity updater troubleshooting](https://antigravity.google/docs/cli/troubleshooting)
- [Antigravity official download page](https://antigravity.google/download)
- Current official installer endpoints:
  - `https://antigravity.google/cli/install.ps1`
  - `https://antigravity.google/cli/install.sh`
  - `https://antigravity.google/cli/install.cmd`

The current installer hashes remain identical to the R-025 observations:

| Endpoint | Bytes | SHA-256 |
| --- | ---: | --- |
| `install.sh` | 7,354 | `ee1ea43ce4e9e56356c4ab6dad907ef357ae4bdfcaadb682735909fb57c9c640` |
| `install.ps1` | 7,165 | `51c2cb4fada22ce0228da71b9506370383d6544bfebcec85fe7616a52b805344` |
| `install.cmd` | 6,006 | `15aa0bd50ea4d4f53df35b96a6347567cf95231d327f69eae74ece23fde52509` |

The installers currently read platform manifests from an internal Cloud Run
service. Windows x64/ARM64 and macOS Intel/ARM64 manifests all returned
`version: 1.1.11`, matching the official download page and the user's installed
version. The manifest URL and `{version,url,sha512}` schema are installer
implementation details, not a documented public compatibility contract, and
are not introduced as a runtime dependency in this patch.

## Evidence Ledger

| ID | Claim | Class | Evidence | Confidence |
| --- | --- | --- | --- | --- |
| E-01 | The 2.6.4 Gemini update button performs no update check | Verified: source + screenshot | provider branch opens docs-only `ConfirmModal` | High |
| E-02 | The docs-only CTA looks destructive and cancel is English | Verified: source + screenshot | `ConfirmModal` forces `mod-warning` and `Cancel` | High |
| E-03 | The screenshot's `1.1.11` is the current official release | Verified: first-party point-in-time | official download page and four installer manifests | High for 2026-08-10 |
| E-04 | A documented `agy update` or `/update` command exists | Contradicted: current first-party reference | complete CLI reference omits both | High |
| E-05 | Antigravity contains a native background updater and normal use provides its execution context | Verified: first-party docs | updater troubleshooting describes the statically linked background updater | High |
| E-06 | Re-running the current installer upgrades an existing default-path binary | Contradicted: hashed installer source | all three installers exit successfully after detecting the existing binary | High for reviewed bytes |
| E-07 | The English compatibility paragraph represents a failed login | Contradicted: source + user report/screenshot | snapshot is `ready`, catalog has 11 models, and the user reports successful requests | High |
| E-08 | Allowed legacy fallback reason is rendered as a warning | Verified: source | classifier reason -> `snapshot.warning` -> warning CSS | High |
| E-09 | An unchanged version after opening the CLI proves update failure | Contradicted for supplied case | installed version already equals current official 1.1.11 | High for supplied evidence |
| E-10 | Every normal CLI launch immediately completes or waits for an update | Not verified | docs establish background behavior, not completion timing | Not applicable |

## Verified Findings

### 1. The update action is a deliberate docs-only dead end

`PlanConnectionsSection.tsx` calculates a Gemini `updateDecision` and then
ignores it. It opens a generic destructive-style confirmation modal whose CTA
opens the install page. `getUpdateDecision()` returns `background` without a
command, and `openUpdateTerminal('gemini')` would throw. Tests explicitly fixed
that behavior in place for 2.6.2 through 2.6.4.

This was a defensible removal of the undocumented `agy update`, but it did not
replace that command with the documented updater trigger or an observable
version recheck. The result does not meet the button label's user expectation.

### 2. The installer page and current installer bytes conflict

The current installation page calls the scripts install-or-upgrade paths. The
reviewed PowerShell, shell, and CMD scripts detect an existing default-path
binary, state that it self-updates in the background, and return without
replacement. Re-running the displayed install command is therefore not a
working update action for today's bytes.

This conflict must remain explicit. Smart Composer may link to the official
page but must not promise that re-running the current installer upgrades an
existing binary.

### 3. Normal execution is the only current documented updater trigger

The current troubleshooting page describes a native background updater, a
15-minute debounce marker, and an advisory lock. No public command contract
forces an immediate synchronous update. The safe supported action is therefore
to open the exact selected `agy` executable visibly and explain that updater
activity is background and may leave the observed version unchanged.

Multiple or unresolved installations must not launch an arbitrary candidate.
The runtime resolver's selected path and ambiguity decision remain authoritative.

### 4. A success reason was incorrectly promoted to warning UI

R-028 intentionally keeps the absence of machine-proven quota type distinct
from request compatibility. In 2.6.4, both JSON and legacy text catalogs can be
allowed. The service nevertheless places the allowed decision reason in
`snapshot.warning`, and the card renders it with warning colors. The legacy
reason includes implementation terms that ordinary users do not need:
`legacy text model catalog`, `compatibility mode`, and `quota source`.

The technical decision belongs in `authDecision`. The normal card needs only
to state that login and usable models were confirmed and that Gemini is usable.
It may state neutrally that Antigravity owns the quota type; it must not claim
that Pro, Ultra, Free, or personal quota was identified.

## Inferences Requiring Validation

1. A visible normal `agy` launch provides the updater an opportunity to run on
   the schedule documented by Google. Hosted tests cannot authenticate a
   personal runtime, so the UI contract must remain “gives the documented
   background updater an opportunity to run,” not “update completed.”
2. The next official installer may reconcile its install-or-upgrade wording
   with its existing-binary behavior. Recheck bytes and docs before every
   future updater change.

## Decision And Implementation Contract

1. Replace the Gemini `업데이트 안내` action with `자동 업데이트 확인`.
2. Open a dedicated non-destructive Korean modal, not the destructive generic
   `ConfirmModal`.
3. Show the locally installed version without asserting a remote latest version.
4. Enable `Antigravity 열기` only for one safely selected installed runtime.
5. Launch only that exact executable with no `update` argument from an OS
   temporary working directory. Never launch an installer or delete a binary.
6. Keep the modal open and provide `버전 다시 확인`, which runs the existing
   sanitized local diagnosis and reports an observed version change or the
   unchanged installed version.
7. Provide the official updater troubleshooting page as a secondary link.
8. Keep ambiguity and missing-runtime states non-executable and actionable.
9. Remove allowed Gemini reasons from `snapshot.warning`; retain them only in
   `authDecision` and evidence.
10. Render healthy Gemini readiness as Korean success information with
    `role=status`. Reserve warning/alert styling for an actual non-ready state.
11. Do not use `latest`, `업데이트 완료`, or equivalent claims unless a future
    documented comparison/update contract proves them.

## Expected Change Surface

- `src/core/llm/native/NativeRuntimeService.ts`
- `src/core/llm/native/NativeProcess.ts`
- `src/components/settings/sections/PlanConnectionsSection.tsx`
- new `src/components/settings/modals/NativeRuntimeUpdateModal.tsx`
- install/login status copy and relevant tests
- `styles.css`
- research register, R-025/R-028 cross-links, release notes, version metadata,
  release workflow, and generated three-file bundle

No settings or chat schema migration and no external plugin API change are
required.

## Release Publication Contract

R-026's fail-closed publication procedure is inherited for 2.6.5:

1. Work only on `codex/2.6.5-antigravity-update-ux`; do not change or merge the
   2.6.4 branch, older draft PRs, or the repository default branch.
2. Open a Draft PR whose base is `codex/2.6.4-gemini-unblock` so the review
   contains only the 2.6.5 delta. Keep it Draft and unmerged.
3. Require a successful push CI attempt 1 on the final branch SHA, then rerun
   that exact run and require attempt 2 to succeed on the same event, branch,
   and SHA.
4. Create annotated tag `2.6.5` only at that qualified branch HEAD.
5. The tag workflow must rerun all Linux, Windows, Apple Silicon, Intel,
   official-installer, and pinned-Obsidian gates before creating a draft
   release.
6. Download and byte-verify exactly `main.js`, `manifest.json`, and
   `styles.css`; publish stable/latest only after tag, branch, version, asset,
   and hash invariants pass.
7. Record the qualification attempts, release run, tag SHA, artifact boundary,
   and three asset hashes in the generated GitHub Release provenance notes.

## Test And Release Gates

- JSON and legacy text catalog diagnosis both remain `ready`, with no
  `snapshot.error` or user-visible `snapshot.warning`.
- Technical compatibility evidence remains in `authDecision`.
- Ready card uses Korean success UI and contains none of the internal English
  legacy/compatibility paragraph or warning/error classes.
- The update CTA opens the exact selected binary with no args in an OS
  temporary working directory.
- `agy update` and installer commands never execute from the update flow.
- Missing and ambiguous runtimes cannot launch an arbitrary process.
- Version recheck updates the shared card/modal snapshot and reports only the
  observed installed version.
- Windows PowerShell and macOS Terminal AppleScript arguments, working
  directory quoting, and detached behavior pass tests.
- Typecheck, lint, full Jest suite, production build, bundle budget, Linux,
  Windows, Apple Silicon, Intel, official-installer, and pinned-Obsidian smoke
  gates pass on the exact release SHA.
- CI remains secret-free; personal OAuth, Keychain/Credential Manager, quota,
  and billable inference are not hosted-test claims.

## Local Implementation Verification

The final local 2.6.5 candidate passed on 2026-08-10:

- `npm run type:check`;
- targeted ESLint for every changed TypeScript/TSX source and test file;
- Jest: 96 suites, 652 tests, zero failures;
- production build and bundle budget: `5,290,418 / 6,815,744` bytes;
- `bash -n .github/scripts/obsidian-smoke-macos.sh`;
- `git diff --check`;
- generated `meta.json` inspection found no workspace absolute path.

These are local results, not exact-SHA hosted qualification. The two push-CI
attempts, dual-architecture Obsidian update-modal smoke, tag workflow, and
published asset hashes remain pending until GitHub publication.

## Known Unknowns And Deferred Decisions

1. No documented synchronous Antigravity update command exists today.
2. Background update start, download, replacement, and restart timing are not a
   documented machine-readable contract.
3. `AGY_CLI_DISABLE_AUTO_UPDATE=true`, the documented 15-minute debounce, and
   updater locking can prevent one launch from scheduling or completing an
   update check. Smart Composer neither bypasses nor inspects those controls.
4. The updater's manifest service is not adopted as a hard dependency because
   its URL and schema are not a published API contract.
5. Automatic binary deletion/reinstallation is intentionally excluded. If a
   future recovery wizard offers it, it requires a separate destructive-action
   design and explicit user confirmation.

## Security And Privacy

No credential, token, authorization code, account identifier, project
identifier, keyring content, private vault content, prompt, response, raw model
catalog, or personal executable path was recorded. The supplied screenshots
were inspected only for the visible sanitized state facts listed above and were
not copied into the repository.

The official CLI remains the sole credential owner. The update flow executes
only the resolver-selected binary and does not inspect its keyring or account
state beyond the existing sanitized model-catalog diagnosis.

## Change Log

- 2026-08-10: Initial report; recorded the docs-only update dead end, current
  official updater/installer conflict, supplied `1.1.11` current-version
  evidence, successful legacy-catalog warning misclassification, and the 2.6.5
  implementation/test contract.
- 2026-08-10: Implemented the dedicated updater modal, exact-path isolated
  terminal launch, truthful version comparison, healthy Korean ready state,
  platform quoting hardening, hosted Obsidian smoke expansion, version 2.6.5
  metadata, and the local verification results above. Exact-SHA hosted
  qualification and publication remain pending.
