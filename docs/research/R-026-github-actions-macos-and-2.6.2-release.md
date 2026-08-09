# R-026: GitHub Actions macOS Qualification And 2.6.2 Release

## Status

- Evidence status: **Partially verified**
- Planning use: **Mandatory for the 2.6.2 release**
- Investigation date: 2026-08-10
- Repository baseline: tag `2.6.1`, branch
  `codex/2.6.2-native-plan-onboarding`, commit
  `bb6f24821c5e4e8c567b0600598b2b66437511ae`
- Target release: `2.6.2`

## Executive Summary

GitHub Actions can supply clean Apple Silicon and Intel macOS virtual machines
for source tests, official installer smoke tests, and a pinned Obsidian desktop
smoke without putting a personal account or credential into CI. It cannot
verify human paste behavior, browser OAuth, Apple Keychain persistence, or
personal-plan billing provenance. Those boundaries must not be described as
tested.

The repository's original CI and release workflows were not reusable for this
release: CI listened only to `release/**` pushes and PRs into `main`, while the
release workflow was hard-coded to tag `2.6.1`, the 2.6.1 branch, and the 2.6.1
notes. The 2.6.2 workflow contract is a new `codex/**`/all-PR CI, two current
macOS runner architectures, reviewed installer-byte allowlists, a secret-free
Obsidian CLI fixture smoke, and a tag workflow that creates a draft, verifies
downloaded assets, and only then publishes.

No workflow run has occurred on the new branch at the time of this report.
Consequently the runner-label, installer execution, and GUI/CLI behavior remain
release gates rather than verified live results.

## Research Question

How can Smart Composer 2.6.2 obtain reproducible Windows and dual-architecture
macOS evidence and publish a release from a new branch without silently using
personal credentials, mutable unreviewed installers, a lightweight tag, stale
branch metadata, or unverified release assets?

### In scope

- Repository/default-branch, tag, release, and workflow baseline.
- GitHub-hosted Windows and macOS runner availability.
- Current official Claude Code and Antigravity installer bytes.
- Pinned Obsidian macOS release and official CLI capabilities.
- Pull-request CI and safe annotated-tag release automation.

### Out of scope

- Implementing runtime, settings, React, or release-note code.
- Logging into Claude, Google, or Obsidian in CI.
- Billable model inference or updater execution.
- Claiming a human visual/keyboard UX test from DOM assertions.
- Changing the repository default branch or merging the draft PR.

## Baseline And Reproducibility

Repository API and local Git checks on 2026-08-10 established:

- repository: `laguna821/obsidian_smart_composer_Achmage`;
- default branch: `codex/2.6.1-plan-runtime-hotfix`;
- 2.6.1/default-branch commit:
  `bb6f24821c5e4e8c567b0600598b2b66437511ae`;
- new local branch: `codex/2.6.2-native-plan-onboarding`, created from that
  exact commit and not yet present on the remote during this investigation;
- `main` remains an older baseline and is not the 2.6.2 PR base;
- the 2.6.1 annotated tag resolves to the same commit;
- the published 2.6.1 release is stable and has exactly `main.js`,
  `manifest.json`, and `styles.css`, but its `targetCommitish` field is stale;
- no branch protection or ruleset currently supplies required checks.

The old workflow source was inspected at the same commit. The new workflow and
allowlist source paths are recorded below. CI results, URLs, and generated
artifact hashes are intentionally left pending until the remote workflow runs.

Local static validation completed on 2026-08-10:

- both workflows parsed as YAML with the expected job graph;
- the first-party action release feeds were rechecked and the workflows use
  current major lines `actions/checkout@v7`, `actions/setup-node@v7`, and
  `actions/upload-artifact@v7`;
- `actionlint` 1.7.12 reported no errors (official Windows amd64 archive,
  SHA-256 `6e7241b51e6817ea6a047693d8e6fed13b31819c9a0dd6c5a726e1592d22f6e9`);
- both macOS shell scripts passed `bash -n`;
- the artifact verifier passed `node --check`, accepted the exact reviewed
  Claude installer, and rejected a one-line mutation;
- Prettier accepted every changed workflow, script, JSON, and research file.

The corresponding latest first-party releases at inspection time were
`checkout` v7.0.1 (2026-07-20), `setup-node` v7.0.0 (2026-07-14), and
`upload-artifact` v7.0.1 (2026-04-10). The workflows use their maintained major
tags so compatible patch fixes remain available.

## Sources Inspected

### Repository source

- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`
- `.github/runtime-smoke-allowlist.json`
- `.github/scripts/native-runtime-smoke-macos.sh`
- `.github/scripts/obsidian-smoke-macos.sh`
- `.github/scripts/verify-pinned-artifact.mjs`
- `package.json`, `package-lock.json`, `manifest.json`, `versions.json`
- `RELEASE_NOTES_2.6.1.md`
- R-023, R-024, and R-025

### First-party external sources

All sources were accessed on 2026-08-10.

- [GitHub-hosted runners reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
- [GitHub Actions billing and usage](https://docs.github.com/en/actions/concepts/billing-and-usage)
- [Anthropic Claude Code installation](https://code.claude.com/docs/en/installation)
- [Google Antigravity installation and auth](https://antigravity.google/docs/cli/install)
- [Obsidian CLI](https://obsidian.md/help/cli)
- [Obsidian 1.13.4 release](https://github.com/obsidianmd/obsidian-releases/releases/tag/v1.13.4)
- GitHub repository, Git tag, release, workflow, and asset API responses for the
  Smart Composer and `obsidianmd/obsidian-releases` repositories

### Reviewed mutable artifacts

| Artifact | Bytes | SHA-256 on 2026-08-10 |
| --- | ---: | --- |
| `https://claude.ai/install.sh` | 7,984 | `cde4f1702d3b1695f92b73d26888364e17bca476e17f0fd676484c951d36c125` |
| `https://claude.ai/install.ps1` | 3,189 | `cd17c6b555f761d60373659824bf805e1510538226e4c7028e19d7494937a333` |
| `https://antigravity.google/cli/install.sh` | 7,354 | `ee1ea43ce4e9e56356c4ab6dad907ef357ae4bdfcaadb682735909fb57c9c640` |
| `https://antigravity.google/cli/install.ps1` | 7,165 | `51c2cb4fada22ce0228da71b9506370383d6544bfebcec85fe7616a52b805344` |
| `https://antigravity.google/cli/install.cmd` | 6,006 | `15aa0bd50ea4d4f53df35b96a6347567cf95231d327f69eae74ece23fde52509` |
| Obsidian 1.13.4 universal DMG | 228,041,400 | `e84b9595aba5e50221c97e43d3e3f437416edfbf4c4a84c379461e70f854d78f` |

The Obsidian digest is also published in the official GitHub release asset
metadata. Installer endpoints are mutable; equality with this table is a
pre-execution gate, not permanent trust in a URL.

## Evidence Ledger

| ID | Claim | Class | Evidence | Confidence |
| --- | --- | --- | --- | --- |
| E-01 | The current default branch is the 2.6.1 hotfix branch | Verified: GitHub API | `defaultBranchRef.name` and exact branch SHA | High |
| E-02 | The original CI misses the intended new branch and PR base | Verified: source | `release/**` push and `main` PR filters | High |
| E-03 | The original release workflow is 2.6.1-specific | Verified: source | tag, branch, and notes constants | High |
| E-04 | `macos-15` is arm64 M1 and `macos-15-intel` is Intel | Verified: first-party docs | GitHub-hosted runner table | High |
| E-05 | Both current official runtimes publish macOS shell installers | Verified: first-party docs and hash | Commands plus downloaded bytes | High |
| E-06 | The current Google page advertises two flags absent from all three reviewed scripts | Contradicted: first-party source conflict | Docs list `--skip-path`/`--skip-aliases`; byte search finds neither, while shell implements `-d`/`--dir` | High for reviewed bytes |
| E-07 | Obsidian CLI can reload plugins, query DOM, inspect errors, evaluate code, and capture screenshots | Verified: first-party docs | Official CLI developer-command reference | High |
| E-08 | Obsidian CLI needs installer 1.12.7+ and a running app | Verified: first-party docs | Official CLI prerequisites | High |
| E-09 | Obsidian 1.13.4 DMG is universal and usable on both selected CI runners | Partially verified | Official asset and digest; CI execution pending | Medium-high |
| E-10 | The secret-free Obsidian CLI smoke passes twice on both architectures | Not verified | No new-branch run yet | Not applicable |
| E-11 | OAuth, Keychain persistence, and Plan billing provenance are tested by CI | Contradicted | CI intentionally supplies no account or secret | High |
| E-12 | The release workflow publishes only bytes rebuilt from the annotated branch-head tag | Proposal/implementation contract | Workflow source; remote execution pending | High for design, not runtime |
| E-13 | New workflow/script source passes local static validation | Verified: local static | YAML parse, actionlint 1.7.12, `bash -n`, `node --check`, verifier positive/negative checks, Prettier | High |

## Verified Findings

### 1. Standard public macOS runners cover both required architectures

GitHub documents `macos-15` as an arm64 M1 runner and
`macos-15-intel` as Intel. Official GitHub actions support arm64. These runners
are clean virtual machines suitable for file, architecture, unit, build, and
non-interactive desktop smoke checks. They are not physical end-user Macs and
do not replace human observation of Terminal.app or an OAuth browser.

### 2. Mutable installer execution requires a reviewed-byte gate

Piping the latest response from a mutable URL directly into a shell would allow
the upstream bytes to change between review and CI. The macOS smoke therefore
downloads each script, checks the URL, byte length, and SHA-256 against a
repository allowlist, and executes only on an exact match. A mismatch fails
before execution and requires a new source review plus an R-026 change-log
entry.

The installer job verifies only the expected path, executable bit, Mach-O
architecture, and `--version`. It does not run login, auth status, model list,
model inference, or update commands.

### 3. Google's installer documentation and bytes conflict

The formal Google page describes the scripts as install-or-upgrade paths and
advertises `--skip-aliases` and `--skip-path`. The reviewed shell, PowerShell,
and CMD scripts contain neither flag name; the reviewed shell script implements
only `-d`/`--dir` and help. The shell script also defers an existing install to
its background updater. The 2.6.2 guide must show the no-flag official command
and must not claim those documented-but-absent flags or `agy update` work.

### 4. Obsidian CLI supports a useful but bounded desktop smoke

Obsidian's official CLI exposes plugin enable/reload, DOM query, JavaScript
error, screenshot, and evaluation commands. The pinned 1.13.4 application
bundle also stores CLI enablement in its application configuration; the smoke
uses a disposable application profile and vault with `cli: true`, never a user
profile. This config-file preparation is release-binary evidence, not a
documented stable public setup API, so every pinned Obsidian upgrade must
revalidate it.

The smoke uses inert local fixture executables to reproduce
`not-installed -> login-required` without contacting an auth service. The
separate official-installer job never opens the settings screen, preventing an
automatic diagnosis from accidentally invoking auth or model discovery.
It also requires `osascript` and Terminal.app to exist, while unit tests assert
the exact AppleScript argv and escaping without triggering an Apple Event in a
headless runner. JavaScript errors are checked by comparing `dev:errors` with a
post-clear empty baseline rather than matching an incomplete list of error
strings.

### 5. Release publication must fail closed

The tag workflow first runs the complete reusable CI. It then proves the tag
object is annotated and points to the exact new-branch head, validates all
version files, rebuilds the bundle, creates or updates only a draft release,
downloads the three assets, byte-compares them with the local build, and then
re-fetches the release branch immediately before publication to prove it still
equals the tagged commit. It then publishes. An existing public release,
unexpected draft asset, or concurrently moved branch causes failure instead of
being overwritten or published with a stale qualification.

## Inferences Requiring Validation

1. A GitHub-hosted macOS Aqua session will launch the pinned Obsidian Electron
   app and expose its CLI socket. Run both matrix jobs to validate this.
2. Pre-seeding `cli: true` remains accepted by Obsidian 1.13.4 on both runner
   architectures. Confirm through `obsidian version` and plugin commands.
3. The community plugin loads from the disposable vault without an interactive
   restricted-mode dialog. Confirm the Plan cards appear and no settings-load
   error is captured.
4. DOM hooks and fake executables reliably drive the installation-check to
   login-step transition. Confirm the two provider screenshots and DOM summary.
5. The official runtime installers may change at any time. If a hash mismatch
   occurs, download and inspect the new source; never update only the digest.

## Decision And Implementation Contract

- CI triggers on `codex/**` pushes, every PR, optional manual
  `workflow_dispatch`, and reusable `workflow_call`. Release qualification does
  not depend on dispatch because a workflow that exists only on an unmerged
  branch may not receive a `workflow_dispatch` event until it is present on the
  default branch.
- All jobs use Node.js 20 and workflow-level `contents: read`; only the tag
  release workflow receives `contents: write`.
- Ubuntu runs type, lint, all tests, production build, and bundle budget.
- Windows 2025 and both macOS architectures run all tests and build.
- Separate dual-architecture jobs cover reviewed official installers and the
  pinned Obsidian fixture smoke.
- Screenshots and diagnostic summaries contain only a fresh empty vault and
  fake unauthenticated runtimes. They are retained for 14 days.
- The Draft PR remains unmerged. The repository default branch is unchanged.
- Stable publication is permitted only after two consecutive successful
  dual-architecture qualifications of the same push run. After the branch push
  succeeds, rerun that exact run with `gh run rerun <run-id>` so GitHub records
  `run_attempt: 2` without changing the SHA. The release preflight requires
  exactly two attempts, fetches the attempt-1 and attempt-2 API records, proves
  both are successful push attempts for the tagged SHA, prints both attempt
  URLs, and then runs the complete reusable CI again before creating a draft.
- The release tag is annotated `2.6.2` and must equal the new branch head.
- The branch/tag equality check is repeated immediately before changing the
  verified draft to stable/latest.
- The release contains exactly `main.js`, `manifest.json`, and `styles.css`.

## Expected Change Surface

- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`
- `.github/runtime-smoke-allowlist.json`
- `.github/scripts/*-macos.sh` and the pinned-artifact verifier
- this report, R-025's explicit corrections, and the research register

## Test And Release Gates

### Local/static gates

- Parse both workflow files as YAML.
- Run an Actions-aware static validator.
- Parse the allowlist and verify all required IDs and lowercase SHA-256 values.
- Shell syntax-check both macOS scripts.
- Exercise the artifact verifier with a known mismatch and an exact local copy.

### Remote gates

- Ubuntu, Windows 2025, macOS arm64, and macOS Intel jobs all succeed.
- Both official installer jobs resolve expected native paths and architectures.
- Both Obsidian jobs create two provider screenshots and a sanitized summary.
- No auth, model, update, account, Keychain, or private-vault data appears in
  logs or artifacts.
- The complete macOS workflow succeeds twice consecutively before tagging.
- Draft release asset names, sizes, and SHA-256 values match the tag build.
- After publication, record the PR, run, release, tag, and asset evidence below.

### Publication evidence ledger

| Evidence | Status |
| --- | --- |
| Draft PR URL | Pending branch push |
| Push CI run attempt 1 | Pending |
| Same run/SHA rerun attempt 2 | Pending |
| Annotated `2.6.2` tag object and commit | Pending |
| Stable release URL | Pending |
| `main.js` size/SHA-256 | Pending |
| `manifest.json` size/SHA-256 | Pending |
| `styles.css` size/SHA-256 | Pending |

## Known Unknowns And Deferred Decisions

1. GitHub Actions cannot verify how a beginner perceives the modal or terminal.
2. Browser OAuth, Apple Keychain, Windows Credential Manager, and account-plan
   provenance remain deliberately untested without a user-owned machine.
3. A future Obsidian release may change the application config or CLI socket;
   keep 1.13.4 pinned until a new version is separately reviewed.
4. Upstream installer hash drift is expected and is a review event, not a
   reason to weaken or bypass the check.
5. No branch-protection rule currently enforces these jobs outside the release
   workflow. The release workflow's reusable-CI dependency is therefore the
   publication enforcement mechanism for 2.6.2.

## Security And Privacy

No credentials, tokens, OAuth codes, account identifiers, Keychain records,
private vault content, model prompts, or model responses were recorded. The
desktop smoke creates a disposable empty vault and uses inert fake executables.
The official installer smoke runs only `--version` after installation. Workflow
logs and uploaded artifacts must remain secret-free.

## Change Log

- 2026-08-10: Initial repository/API, runner, first-party-document, installer
  hash, Obsidian release, CI, and release-pipeline investigation. Remote run and
  publication evidence remains pending.
