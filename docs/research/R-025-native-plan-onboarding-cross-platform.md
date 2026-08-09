# R-025: Native Plan Onboarding And Cross-Platform Installation

## Status

- Evidence status: **Partially verified**
- Planning use: **Mandatory**
- Investigation date: 2026-08-10
- Repository baseline: tag `2.6.1`, commit
  `bb6f24821c5e4e8c567b0600598b2b66437511ae`
- Target release: Smart Composer Achmage `2.6.2`
- Completed evidence: repository source, release bundle, GitHub baseline, and
  current first-party-document analysis
- Pending evidence: clean Windows and macOS runtime reproduction

> [!IMPORTANT]
> This is the mandatory 2.6.2 implementation contract, but its clean-machine
> claims remain release gates rather than verified runtime facts.

## 1. Executive Summary

The reported onboarding problem is real, but it is broader than one missing
sentence.

1. The installation modal and the Plan card use two different state sources.
   Step 4 is controlled by modal-local diagnostics, while the card behind the
   modal is controlled by persisted settings. Closing the modal does not run a
   diagnosis. If the card is different after closing, another update occurred
   before or independently of that close action.
2. In the checked-in logic, one diagnostic result cannot normally produce
   both a locked Step 4 and a card that has already switched to `Sign in` and
   `Update`. If that exact combination occurs in Obsidian, it is a render or
   timing regression that needs a real-runtime reproduction. There is no
   component test covering it.
3. Telling users to perform only Steps 1 and 2 and then close the guide would be
   inaccurate. Those steps only copy a command and open a terminal. At least
   one diagnosis must run, or closing must be changed to run diagnosis
   automatically.
4. macOS support is not completely absent. The source already selects a Mac
   command, opens Apple Terminal, and searches common Mac executable paths.
   The actual defect is that the guide exposes only the current operating
   system, has no selectable Windows/macOS tabs, assumes Homebrew for Claude,
   contains Windows-only keyboard wording in shared login steps, and lacks Mac
   tests.
5. Claude's current first-party recommendation is the native installer on both
   Windows and macOS. The 2.6.1 guide instead uses WinGet on Windows and
   Homebrew on Mac. Those are supported alternatives, but their update
   commands differ from the button's unconditional `claude update` behavior.
6. Smart Composer's Gemini Plan path correctly uses Google Antigravity CLI
   (`agy`), not the older open-source Gemini CLI (`gemini`). Google stopped
   serving individual Free, Google AI Pro, and Google AI Ultra accounts through
   Gemini CLI on 2026-06-18 and directed those users to Antigravity CLI.
7. Google's current formal Antigravity authentication page says `agy` checks
   the OS keyring and opens the default browser when needed, reserving the
   manual URL/code loop for SSH. An older first-party Codelab still shows a code
   loop for an ordinary local login. The current formal page takes precedence
   for 2.6.2 copy, but the discrepancy must be retained and tested on both
   platforms instead of being silently discarded.
8. Claude `ready` currently means only that `claude auth status` exited zero.
   The plugin then passes the complete Obsidian environment to `claude -p`.
   Cloud-provider credentials, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_API_KEY`, and
   other configured key sources can therefore override subscription OAuth and
   create API or cloud-provider charges while the UI still calls the connection
   “Claude Plan.” This is a release-blocking billing-safety gap.
9. Runtime status, version, and model cache live in persisted plugin settings,
   while only an executable override is device-local. A copied or synced vault
   can therefore import another computer's stale `ready` card into a fresh
   Windows or Mac installation unless local diagnosis invalidates it.

The 2.6.2 fix should therefore be a coherent onboarding, device-state, and
billing-safety correction, not a copy-only patch.

## 2. Research Question And Scope

This report answers:

1. Why does the beginner installation path appear to require closing the guide
   before `Sign in` and `Update` become available?
2. What installation and authentication behavior is actually present in the
   2.6.1 source and bundle?
3. What are the current first-party Windows and macOS commands for Claude Code
   and the Gemini Plan runtime that this plugin really invokes?
4. What implementation and release contract should 2.6.2 follow?

### In scope

- Plan settings cards and native runtime installation/login modals.
- Claude Code and Google Antigravity CLI discovery, diagnosis, login, and
  update entry points.
- Windows and macOS beginner instructions.
- Future Codex research-register enforcement.
- Unit, component, bundle, and clean-machine validation requirements.

### Out of scope

- Implementing the 2.6.2 code changes in this research pass.
- Changing the Claude/Gemini headless message protocols proven in R-024.
- Changing Plan model routing, tool permissions, vault isolation, or chat
  history ownership.
- Claiming successful Mac behavior without access to a clean Mac test device.
- Resolving the legal suitability of consumer Plan delegation for a public
  third-party product. R-023 remains authoritative for that boundary.

## 3. Reproducible Repository Baseline

The supplied folder does not contain `.git`, so `git status` cannot describe
its provenance. The baseline was instead verified against GitHub's recursive
tree for the `2.6.1` tag.

The resolved commit has tree SHA
`13856270672b9732c744b5b71aee30f2af626c1f`. The comparison procedure was:

1. fetch that recursive Git tree from
   `GET /repos/laguna821/obsidian_smart_composer_Achmage/git/trees/13856270672b9732c744b5b71aee30f2af626c1f?recursive=1`;
2. enumerate the supplied workspace with `rg --files -uu`, excluding only
   `.git/**` and `node_modules/**`;
3. compute each local file's Git blob ID with
   `git hash-object --no-filters -- <path>` (equivalently SHA-1 over
   `blob <byte-length>\0<raw-bytes>`);
4. compare the complete normalized path-to-blob-ID maps, not timestamps or
   text-normalized contents.

The counts below are the pre-documentation snapshot. Re-running the comparison
after this report is added will intentionally show the new research files and
the modified register as differences.

| Check | Result |
| --- | --- |
| Local non-dependency files | 446 |
| Remote `2.6.1` tag blobs | 446 |
| Exact Git blob hash matches | 446 |
| Local-only files before this report | 0 |
| Remote-only files before this report | 0 |
| Mismatched files before this report | 0 |
| Package version | `2.6.1` |
| Manifest version | `2.6.1` |
| Settings schema | `28` |
| Test files | 87 |

This establishes that the investigated source, generated `main.js`, styles,
research reports, images, configuration, migrations, and release metadata were
an exact copy of commit `bb6f248…` before documentation was added.

The GitHub repository's default branch is now
`codex/2.6.1-plan-runtime-hotfix`, and that branch plus the annotated `2.6.1`
tag resolve to `bb6f24821c5e4e8c567b0600598b2b66437511ae`. The branch named
`main` still points to the older 1.3.1 baseline. The published 2.6.1 release's
`targetCommitish` metadata is also stale (`codex/2.5.5-riss-routing`) even
though its annotated tag resolves to the correct 2.6.1 commit. Future research
and release checks must therefore compare the exact tag object, tag commit,
and intended branch head instead of treating `main` or `targetCommitish` as
current-release truth.

Repository: [laguna821/obsidian_smart_composer_Achmage](https://github.com/laguna821/obsidian_smart_composer_Achmage)  
Release tag: [2.6.1](https://github.com/laguna821/obsidian_smart_composer_Achmage/tree/2.6.1)

## Sources Inspected

All external sources below were accessed on 2026-08-10.

### Repository source

- `src/settings/schema/setting.types.ts`
- `src/settings/schema/migrations/26_to_27.ts`
- `src/core/llm/native/NativeRuntimeService.ts`
- `src/core/llm/native/NativeCliResolver.ts`
- `src/core/llm/native/NativeProcess.ts`
- `src/core/llm/native/NativeRuntimePathStore.ts`
- `src/core/llm/native/ClaudeAgentProvider.ts`
- `src/components/settings/sections/PlanConnectionsSection.tsx`
- `src/components/settings/modals/NativeRuntimeInstallModal.tsx`
- `src/components/settings/modals/NativeRuntimeLoginModal.tsx`
- `src/components/settings/modals/NativeRuntimeLoginSteps.tsx`
- `src/components/common/ReactModal.tsx`
- related native-runtime tests, `src/main.ts`, `main.js`, `styles.css`, release
  notes, package metadata, and R-001 through R-024

### First-party external sources

- [OpenAI: Custom instructions with AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
- [Anthropic: Installation](https://code.claude.com/docs/en/installation)
- [Anthropic: Authentication and credential precedence](https://code.claude.com/docs/en/authentication)
- [Anthropic: CLI reference](https://code.claude.com/docs/en/cli-usage)
- [Anthropic: Installation/login troubleshooting](https://code.claude.com/docs/en/troubleshoot-install)
- [Anthropic: Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)
- [Google Antigravity: Installation and auth](https://antigravity.google/docs/cli/install)
- [Google Antigravity: Getting started](https://antigravity.google/docs/cli/getting-started)
- [Google Antigravity: CLI reference](https://antigravity.google/docs/cli/reference)
- [Google Antigravity: Troubleshooting](https://antigravity.google/docs/cli/troubleshooting)
- [Google: Gemini Code Assist for individuals deprecation](https://developers.google.com/gemini-code-assist/docs/deprecations/code-assist-individuals)
- [Google Antigravity: Gemini CLI migration](https://antigravity.google/docs/cli/gcli-migration)
- [Google Codelab: Hands-on with Antigravity CLI](https://codelabs.developers.google.com/antigravity-cli-hands-on)
- [Microsoft WinGet package manifest for Claude Code](https://github.com/microsoft/winget-pkgs/tree/master/manifests/a/Anthropic/ClaudeCode)

The three current Antigravity installer endpoints were also downloaded as raw
bytes for source comparison. This report does not archive executable scripts;
the hashes make the time-sensitive observation auditable:

| Endpoint | Bytes | SHA-256 on 2026-08-10 |
| --- | ---: | --- |
| [`install.sh`](https://antigravity.google/cli/install.sh) | 7,354 | `ee1ea43ce4e9e56356c4ab6dad907ef357ae4bdfcaadb682735909fb57c9c640` |
| [`install.ps1`](https://antigravity.google/cli/install.ps1) | 7,165 | `51c2cb4fada22ce0228da71b9506370383d6544bfebcec85fe7616a52b805344` |
| [`install.cmd`](https://antigravity.google/cli/install.cmd) | 6,006 | `15aa0bd50ea4d4f53df35b96a6347567cf95231d327f69eae74ece23fde52509` |

## 4. Existing Research System And The Missing Enforcement Link

The repository already had a strong research system:

- `docs/research/00-research-register.md`;
- R-001 through R-024;
- status definitions and mandatory synthesis rules;
- source, live-test, unknown, artifact, and secret-recording requirements.

It did not have a root `AGENTS.md`. That meant the register described itself as
mandatory, but a new Codex run had no repository-root instruction that forced
the register to be opened before work.

OpenAI's official AGENTS.md documentation states that Codex reads project
`AGENTS.md` files before work and discovers them from the project root down to
the current directory. This research pass therefore adds:

- root `AGENTS.md` as the mandatory entry gate;
- `docs/research/REPORT_TEMPLATE.md` as the standard evidence structure;
- this report as the next monotonic ID, R-025;
- an R-025 row and naming rules in the existing register.

Source: [OpenAI Docs: Custom instructions with AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md)

## 5. Verified Findings: Current 2.6.1 State Flow

### 5.1 Fresh-install state and card actions

Claude and Gemini both start with:

```ts
{ status: 'not-installed', models: [] }
```

Relevant source:

- `src/settings/schema/setting.types.ts:30-45`
- `src/settings/schema/setting.types.ts:70-78`
- `src/settings/schema/migrations/26_to_27.ts:22-33`

The Plan card has no mount-time automatic diagnosis. Its buttons depend on the
persisted state:

| Persisted status | Visible actions |
| --- | --- |
| `not-installed` | `Diagnose`, `설치 안내` |
| Any other status | `Diagnose`, `Sign in`, `Update` |

Source: `src/components/settings/sections/PlanConnectionsSection.tsx:318-350`.

The `update-available` state exists in the type and status badge, but no native
diagnostic path currently emits it.

### 5.2 The installation modal owns a separate local state

The modal starts with `diagnostics = null`. Copying the command and opening the
terminal only change local messages; neither operation diagnoses the runtime or
updates settings.

The Step 3 handler performs:

```ts
const result = await service.diagnose(provider)
setDiagnostics(result)
await onDiagnostics(result)
```

Source: `src/components/settings/modals/NativeRuntimeInstallModal.tsx:103-139`.

Step 4 is enabled only when:

```ts
diagnostics !== null && diagnostics.status !== 'not-installed'
```

Source: `NativeRuntimeInstallModal.tsx:150-152`, `222-250`.

The grey appearance comes from `styles.css:1945-1952`; both login buttons also
receive a real HTML `disabled` attribute.

### 5.3 Exact state truth table

| Most recent diagnostic result | Modal Step 4 | Card after settings update |
| --- | --- | --- |
| No result | Locked | Existing persisted state |
| `not-installed` | Locked | `설치 안내` remains |
| `login-required` | Enabled | `Sign in` and `Update` |
| `ready` | Enabled | `Sign in` and `Update` |
| `error` | Enabled | `Sign in` and `Update` |
| `update-available` | Enabled | `Sign in` and `Update` |

For one completed handler call, the checked-in code does not contain a state in
which Step 4 stays locked while the same result changes the card. The generated
`main.js` has the same local-update-then-parent-callback order, and the complete
bundle hash matches the 2.6.1 release.

### 5.4 Closing the modal is not a state transition

The close button calls only `onClose`. `ReactModal.onClose()` unmounts the
React root and empties the content element. It does not diagnose or persist a
runtime.

Relevant source:

- `NativeRuntimeInstallModal.tsx:279-286`
- `src/components/common/ReactModal.tsx:25-39`

When diagnostics have already changed persisted settings, the card behind the
modal can re-render before it becomes visible. Closing can then reveal that
card, but this is only one timing explanation and does not reproduce the exact
locked-Step-4/switched-card report. The verified conclusion is narrower:
closing itself does not diagnose or persist anything, so a changed card must
come from an earlier or independent update whose React commit timing still
needs real-Obsidian reproduction.

### 5.5 Why the current flow is confusing even when it works

The product exposes two competing successful paths:

```text
installation modal: 1 -> 2 -> 3 -> 4 login -> 3 again

or

installation modal: 1 -> 2 -> 3 -> close -> card Sign in
                    -> separate login modal
```

Specific defects:

- Step 4 tells the user to go backward to Step 3 after login.
- Shared login text says to click `연결 확인`, but that button does not exist in
  the installation modal; it exists only in the separate login modal.
- A successful installation changes only a status message. There is no
  auto-scroll, focus move, completed-step icon, or primary `로그인 계속하기`
  handoff.
- A long modal can therefore leave the newly enabled lower section outside the
  user's attention.
- The card and modal mix English and Korean without an i18n layer.
- The card still says Claude uses “Agent SDK isolation,” although R-024 and the
  2.6.1 release changed execution to the direct installed Claude CLI.

### 5.6 Persisted runtime state is not device truth

`nativeRuntimes.{claude,gemini}` status, version, models, and errors are part of
`SmartComposerSettings` and are written through Obsidian plugin `saveData()`.
Only the custom executable override uses the device-local
`NativeRuntimePathStore`/`localStorage` path.

If plugin data is copied to a new computer, restored from backup, or synchronized
with the vault's `.obsidian` configuration, a `ready` status produced on another
computer can appear before any local diagnosis. The card has no mount-time
diagnosis, so a fresh Mac could show `Sign in` and `Update` for a Windows-only
installation, or vice versa. Persisted status must therefore be treated as an
untrusted cache, not proof about the current device.

## 6. The Reported Locked-Step Symptom And Inferences Requiring Validation

### Verified facts

- The exact `locked Step 4 + switched card` combination is not produced by the
  same diagnosis result in source.
- Closing performs no diagnosis.
- No component test mounts this modal, clicks diagnosis, and checks the class
  and disabled attributes.
- The release notes document real Windows runtime tests, not Mac tests.

### Strong code-based inference for fresh Windows Claude installs

The 2.6.1 Claude guide installs through WinGet. Claude Code's WinGet manifest
uses a portable executable, and WinGet exposes portable commands through its
Links directories. The current resolver does not directly inspect either:

```text
%LOCALAPPDATA%\Microsoft\WinGet\Links
C:\Program Files\WinGet\Links
```

It searches several Claude directories and then scans the `PATH` inherited by
the already-running Obsidian process. If the relevant WinGet Links directory
was not in that inherited `PATH`, a newly installed `claude.exe` can remain
invisible until the process environment changes. The official native
installer's `%USERPROFILE%\.local\bin\claude.exe` is already a direct resolver
candidate.

This is a high-confidence explanation for a fresh Windows Claude detection
failure, not a live reproduction. It does not by itself explain an identical
Antigravity failure because the resolver already directly checks Google's
documented `%LOCALAPPDATA%\agy\bin\agy.exe` path.

Primary evidence:

- [Microsoft WinGet Claude Code portable manifest](https://github.com/microsoft/winget-pkgs/tree/master/manifests/a/Anthropic/ClaudeCode)
- [Anthropic installation troubleshooting](https://code.claude.com/docs/en/troubleshoot-install)

### Other validation candidates

1. The detached installer may not have finished when Step 3 is clicked.
2. The actual `diagnose()` result may still be `not-installed` even though the
   user sees terminal success.
3. React schedules the local setter before the awaited parent callback in source,
   but source-call order does not prove the order of visible commits. A real
   Obsidian render could expose the settings-driven card update without making
   the modal transition visible first.
4. The modal callback captures the `settings` object from the render in which
   it was opened. A later diagnosis can merge against stale settings and risk
   overwriting unrelated concurrent changes. This is not the direct grey-step
   cause, but it should be corrected with the same state ownership work.

Required reproduction telemetry is local and temporary only:

- provider and platform;
- sanitized `diagnose().status`;
- resolved executable path without user-name disclosure in the report;
- Step 4 class and button `disabled` values after React commits;
- whether the modal remounted;
- elapsed time from installer exit to diagnosis.

No OAuth token, account identifier, or command output containing user data may
be logged.

## 7. Current Cross-Platform Implementation

| Area | Windows 2.6.1 | macOS 2.6.1 |
| --- | --- | --- |
| Claude install | WinGet in PowerShell | Homebrew cask in Terminal |
| Antigravity install | Official endpoint through a staged CMD wrapper | Official endpoint through a staged shell wrapper |
| Claude native path search | Present | Present |
| Antigravity official path search | Present | Present |
| Visible terminal | PowerShell or CMD | Apple Terminal through `osascript` |
| User-selectable OS tabs | Missing | Missing |
| Login keyboard wording | Windows-oriented | Partly wrong |
| Terminal-launch tests | PowerShell/CMD only | Missing |
| Install-guide tests | Claude + Antigravity | Claude only |

The guide is created with:

```ts
getNativeRuntimeInstallGuide(provider)
```

so `process.platform` silently chooses one platform. The user cannot inspect or
copy the other platform's instructions.

Executable resolution also returns the first matching candidate rather than an
inventory. A custom path wins; on Windows, legacy
`~/.claude/local/claude.exe` currently wins before the recommended native
`~/.local/bin/claude.exe`; hard-coded candidates win before inherited `PATH`.
With multiple installations, the selected executable and its package manager
can therefore be ambiguous. An updater cannot safely be chosen from the
onboarding tab or a single path string alone.

Confirmed Mac-specific copy defects:

- the general paste modifier becomes `Command`, but copy-failure text remains
  `Ctrl+A, Ctrl+C`;
- Antigravity login remains `Ctrl+V`;
- Antigravity status text remains `Ctrl+V`;
- “black or blue window” describes Windows rather than Terminal.app;
- Homebrew is assumed without a prerequisite check or native alternative.

## 8. Current First-Party Installation And Authentication Contracts

All commands and behaviors in this section were rechecked on 2026-08-10. They
must be rechecked again at implementation and release time.

### 8.1 Claude Code

Anthropic currently supports macOS 13+, Windows 10 1809+ or Server 2019+, x64
and ARM64, 4 GB or more of RAM, and an internet connection. Git for Windows is
recommended for native Windows but is not required merely to install or log in.

| Operation | Windows | macOS |
| --- | --- | --- |
| Recommended native install | `irm https://claude.ai/install.ps1 | iex` | `curl -fsSL https://claude.ai/install.sh | bash` |
| Native expected path | `%USERPROFILE%\.local\bin\claude.exe` | `~/.local/bin/claude` |
| Verify | `claude --version` | `claude --version` |
| Detailed check | `claude doctor` | `claude doctor` |
| Explicit login | `claude auth login` | `claude auth login` |
| Auth check | `claude auth status` | `claude auth status` |
| Native update | automatic; manual `claude update` | automatic; manual `claude update` |

For a beginner Mac flow, the terminal application is macOS's built-in
`Terminal.app`, normally running the default `zsh` shell. PowerShell and
Homebrew are not prerequisites for the recommended native installer.

WinGet and Homebrew remain officially supported alternatives:

- WinGet install: `winget install Anthropic.ClaudeCode`
- WinGet update: `winget upgrade Anthropic.ClaudeCode`
- Homebrew stable install: `brew install --cask claude-code`
- Homebrew stable update: `brew upgrade claude-code`
- Homebrew latest uses `claude-code@latest` for both install and upgrade.

They do not auto-update by default. This matters because the 2.6.1 guide
installs with package managers but the card always launches `claude update`.
The displayed login command is also `claude`, while the button actually runs
`claude auth login`. The UI and executed command must agree.

The current `diagnoseClaude()` treats any zero exit from `claude auth status` as
`ready` and discards its JSON. The request path then passes all of
`process.env` into non-interactive `claude -p`. Anthropic documents the relevant
credential precedence as cloud-provider credentials, `ANTHROPIC_AUTH_TOKEN`,
`ANTHROPIC_API_KEY`, `apiKeyHelper`, long-lived OAuth token, then subscription
OAuth. In non-interactive mode an approved `ANTHROPIC_API_KEY` is used whenever
present. Console login is also explicitly available for API-usage billing.

Consequently, “authenticated” is not equivalent to “using the Claude
subscription the Plan card promises.” A Console key, gateway token, Bedrock,
Vertex, Foundry, or helper can be selected and billed even after a subscription
login. This finding is source-verified; the exact current `auth status` JSON
fields for each method still require sanitized live fixtures before code relies
on a schema.

Claude Code access requires an eligible Pro, Max, Team, Enterprise, or Console
account; the free Claude.ai plan does not include Claude Code.

Sources:

- [Anthropic: Advanced setup and installation](https://code.claude.com/docs/en/installation)
- [Anthropic: Terminal guide for new users](https://code.claude.com/docs/en/terminal-guide)
- [Anthropic: Authentication](https://code.claude.com/docs/en/authentication)
- [Anthropic: CLI reference](https://code.claude.com/docs/en/cli-usage)
- [Anthropic: Troubleshoot installation and login](https://code.claude.com/docs/en/troubleshoot-install)

### 8.2 Gemini Plan means Antigravity CLI here

Smart Composer's `gemini-plan` runtime invokes `agy`. It does not invoke the
older `gemini` executable. This is the correct consumer-subscription direction
after Google's 2026 transition:

- individual Free, Google AI Pro, and Google AI Ultra Gemini CLI access ended
  on 2026-06-18;
- Gemini CLI remains relevant to Enterprise, Google Cloud, and API-key paths;
- Antigravity CLI is the current individual-account terminal path.

Sources:

- [Google: Gemini Code Assist for individuals deprecation](https://developers.google.com/gemini-code-assist/docs/deprecations/code-assist-individuals)
- [Google Antigravity: Gemini CLI migration](https://antigravity.google/docs/cli/gcli-migration)
- [Google Gemini CLI announcement: transition to Antigravity](https://github.com/google-gemini/gemini-cli/discussions/27274)
- [Google Gemini CLI announcement: individual-account cutoff](https://github.com/google-gemini/gemini-cli/discussions/28017)

Current Antigravity install contract:

| Operation | Windows | macOS |
| --- | --- | --- |
| PowerShell install | `irm https://antigravity.google/cli/install.ps1 | iex` | — |
| CMD alternative | `curl -fsSL https://antigravity.google/cli/install.cmd -o install.cmd && install.cmd && del install.cmd` | — |
| Terminal install | — | `curl -fsSL https://antigravity.google/cli/install.sh | bash` |
| Expected path | `%LOCALAPPDATA%\agy\bin\agy.exe` | `~/.local/bin/agy` |
| Launch/login | `agy` | `agy` |
| Verify | `agy --version` | `agy --version` |
| Update | Background self-updater is documented; the plugin's `agy update` command still needs current live verification | same |

The formal page currently advertises `--skip-aliases` and `--skip-path`, but
none of the three installer bytes fetched on 2026-08-10 contains either flag
name. The reviewed shell installer implements only `-d`/`--dir` and help. This
is a first-party documentation/script conflict, not a supported option the
2.6.2 guide may copy. The default commands above take no optional flags; any
future flag must be rechecked in the downloaded script before it is shown to
users.

Antigravity is a native binary; its current install path does not require
Node.js, npm, npx, or Homebrew. On Mac, use the built-in Terminal.app and
`Command+V`.

For a normal local session, current Google documentation says `agy` first
checks Windows Credential Manager or Apple Keychain. If no valid session is
found, it launches the default browser for sign-in. Copying a URL and then an
alphanumeric authorization code back into the terminal is documented for
remote SSH, not as the mandatory local path.

There is a first-party conflict: the current formal Installation & auth page
(shown as CLI v1.1.11 during investigation) limits that code loop to SSH, while
Google's older Codelab example (showing v1.0.7) tells an ordinary local user to
copy a code back into the terminal. The formal current page is the stronger
2.6.2 copy source, but Windows and Mac live tests must determine what the shipped
binary actually presents. The 2.6.1 shared text is still too absolute: describe
automatic local browser login first and offer the code step only if the CLI
actually displays it.

The Codelab also exposes `Use a Google Cloud project` as a login choice, and
Google positions Antigravity for both individual subscriptions and Cloud use.
`diagnoseAntigravity()` treats a successful `agy models` result as `ready`
without identifying quota or billing provenance. No current first-party
machine-readable auth-status contract was found. Until a sanitized live fixture
establishes one, the UI must not promise that every successful `agy` session is
using personal Gemini Plan quota; Cloud-project selection needs an explicit
billing warning or must be rejected for the Plan-labeled path.

Sources:

- [Google Antigravity: Installation and auth](https://antigravity.google/docs/cli/install)
- [Google Antigravity: Getting started](https://antigravity.google/docs/cli/getting-started)
- [Google Antigravity: CLI reference](https://antigravity.google/docs/cli/reference)
- [Google Antigravity: Troubleshooting](https://antigravity.google/docs/cli/troubleshooting)
- [Google Codelab: Hands-on with Antigravity CLI](https://codelabs.developers.google.com/antigravity-cli-hands-on)

The current formal install, getting-started, and CLI-reference pages do not
establish `agy update` as a supported command. Google's troubleshooting page
documents a background native self-updater. The 2.6.1 `Update` button must not
be described as an official updater until the exact command is verified on the
release runtime. Google's page calls the script an install-or-upgrade path,
while the raw installer scripts downloaded and hashed in `Sources Inspected`
exit when the target binary already exists and direct the user to the background
self-updater. That first-party documentation/script disagreement is a release
test, not something to resolve by assumption. Future work must re-download and
re-hash the script because the endpoint is mutable.

### 8.3 Source-to-official mismatch matrix

| Topic | 2.6.1 behavior | Current first-party contract | 2.6.2 consequence |
| --- | --- | --- | --- |
| OS choice | Current OS only | Both platforms documented | Add Windows/macOS tabs |
| Claude Windows install | WinGet | Native recommended; WinGet alternative | Native default, WinGet advanced |
| Claude Mac install | Homebrew | Native recommended; Homebrew alternative | Remove Homebrew prerequisite from default |
| Claude login display | `claude` | Explicit `claude auth login` supported | Display and execute one command |
| Claude update | Always `claude update` | Depends on native vs package manager | Track/detect method or use native default |
| Antigravity Windows install | Staged wrapper around official CMD endpoint | PowerShell and CMD commands documented | Label accurately; expose one default plus the alternative |
| Antigravity Mac install | Staged wrapper around official shell endpoint | Pipe-to-bash command documented | Label accurately; add Mac-specific wording/tests |
| Antigravity local login | Mandatory manual code copy | Current formal page: local browser, SSH code; older Codelab: local code | Prefer current formal copy, keep conditional prompt and live-test conflict |
| Claude auth source | Any successful auth status becomes “Plan ready” | Non-interactive credential precedence can select API/cloud billing | Parse verified auth metadata; warn/block non-subscription sources |
| Antigravity auth source | Any successful model list becomes “Gemini Plan ready” | Personal and Google Cloud paths both exist; machine-readable status is unverified | Do not promise Plan quota until provenance can be checked |
| Device status | Durable plugin setting is rendered as current truth | Install/login state belongs to the local machine | Re-diagnose locally or move runtime state to device-local storage |
| Paste key | Several hard-coded `Ctrl` strings | `Command` on Mac | Derive from selected platform |
| Claude card description | Agent SDK | Direct CLI since R-024 | Correct stale copy |

## 9. 2.6.2 Decision And Implementation Contract

### 9.1 One primary onboarding owner

The installation modal should own installation only and hand off explicitly to
login. The recommended flow is:

```text
Open installation guide
  -> choose Windows or macOS
  -> copy official install command
  -> open the matching local terminal
  -> user runs command and waits for completion
  -> Check installation
       not found: stay and show platform-specific recovery
       found + login needed: primary Continue to sign in
       found + already ready: Finish
  -> login modal
  -> Check connection
  -> Ready
```

This removes the current `1 -> 2 -> 3 -> 4 -> 3` loop and the duplicate choice
between embedded Step 4 and the separate `Sign in` modal.

If the embedded Step 4 is retained, then the separate modal must be a secondary
re-entry path and the same diagnostic state must drive both card and modal.

### 9.2 Accurate Step 3 copy

At minimum, the copy must say:

> 설치 터미널에 완료 문구와 입력 커서가 다시 나타나면 터미널을 닫고 이
> 화면으로 돌아와 **설치 확인**을 누르세요. 로그인이 필요하면 **로그인
> 계속하기**가 표시되고, 이미 로그인되어 있으면 **완료**가 표시됩니다.

It must not say to complete only Steps 1 and 2 and close the installation guide,
unless closing is changed to execute and await a diagnosis.

### 9.3 Platform tabs

- Render `Windows` and `macOS` tabs in every installation guide.
- Default to the current platform.
- Derive command, shell name, keyboard modifier, expected path, troubleshooting,
  login copy, and update method from the selected tab.
- Copying another platform's command is allowed for preparing another computer.
- Opening a terminal must always open the current computer's terminal; when the
  non-current OS tab is selected, disable that button with a clear explanation.
- Linux behavior remains supported internally but is not silently mislabeled as
  macOS.

### 9.4 Installer choices

- Claude: use the first-party native installer as the beginner default on
  Windows and Mac.
- Keep WinGet and Homebrew in an `Alternative installation methods` disclosure
  for existing users and restricted environments.
- Preserve R-023's safety rule that Smart Composer never runs an installer
  without explicit user action. Clearly distinguish a verbatim first-party
  command from any Smart Composer download-then-run wrapper.
- Antigravity: keep the current first-party native scripts. Windows may show one
  beginner default plus the official alternate shell command.

### 9.5 Executable discovery

- Keep direct checks for both native expected paths.
- Add WinGet user and machine Links candidates for existing Claude users.
- Keep Homebrew Intel and Apple Silicon paths.
- Do not rely only on the Obsidian process's startup `PATH` after installation.
- Return structured detection detail suitable for a sanitized troubleshooting
  message, not a raw environment dump.

### 9.6 Login and connection checks

- Display and execute `claude auth login` consistently.
- Keep `claude auth status` as the connection check.
- Parse `claude auth status` JSON only against sanitized fixtures captured from
  the supported release version. Exit code zero alone is not Plan readiness.
- Positively distinguish eligible subscription/OAuth operation from Console API
  keys, bearer tokens/gateways, `apiKeyHelper`, Bedrock, Vertex, and Foundry.
  Non-subscription sources must be blocked from a Plan-only card or shown with
  an explicit provider/billing warning before any request.
- Test the effective non-interactive environment, not only the interactive login
  result. Never display or log credential values while checking variable names
  or auth classifications.
- Describe Antigravity local keyring/browser login first.
- Show the one-time-code step only conditionally when `agy` asks for it.
- Do not label a successful `agy models` result as personal Gemini Plan quota
  until Google exposes a verified provenance signal or release fixtures prove a
  safe method. A Google Cloud project path needs a clear billing warning or a
  Plan-path rejection.
- Never ask users to paste an OAuth code into Smart Composer.
- Never store Claude, Google, or Antigravity credentials in plugin settings.

### 9.7 Updater behavior

- Native Claude: `claude update`.
- WinGet Claude: `winget upgrade Anthropic.ClaudeCode`.
- Homebrew Claude: update the installed cask name.
- Determine the Claude installation method at update time, without trusting the
  tab that happened to be selected during onboarding. Use canonical executable
  resolution plus package-manager evidence (`winget list` or the installed
  Homebrew cask); record all detected candidates when multiple installations
  exist.
- Prefer the executable already selected for actual chat, but do not infer a
  manager solely from a symlink-looking path. If native, WinGet, and Homebrew
  evidence conflict or a custom executable cannot be classified, do not run a
  guessed updater. Replace the action with method-selection/help and show the
  resolved path plus non-secret detection summary.
- Antigravity: live-verify the current runtime's update command. Until then,
  `업데이트 확인` may explain the documented background self-updater and
  relaunch the CLI only after that behavior is tested; it must not silently run
  the mutable install script or claim that `agy update` is official.
- Do not show `Update available` until a real version comparison produces that
  state.

### 9.8 State and settings ownership

- Use one diagnostic result as the source of truth for modal progress and card
  status.
- Do not merge against a stale settings object captured when the modal opened.
- Treat persisted `nativeRuntimes` status/version/models as an untrusted cache.
  On Plan-settings entry, show `확인 중` and run local diagnosis before exposing
  `Sign in`, `Update`, or `Ready`; never import another device's `ready` as local
  truth.
- Preferred design: keep executable path and runtime health in a device-local
  store and persist only user intent that is portable. Minimum 2.6.2 fallback:
  invalidate persisted health at process start and atomically replace it after
  local diagnosis. Decide the storage/migration path before implementation.
- Make each transition explicit: `not detected`, `detected`, `login required`,
  `checking login`, `auth source unverified`, `ready`, `error`.
- Keep install detection separate from account readiness and model-catalog
  readiness.
- Focus or scroll to the next actionable control after a successful transition.
- Keep status announcements in `aria-live`; add semantic step completion and a
  programmatic explanation for disabled controls.

## 10. Expected Change Surface

| File | Expected responsibility |
| --- | --- |
| `src/core/llm/native/NativeRuntimeService.ts` | Platform guide metadata, native commands, auth-source checks, update-method evidence, structured diagnosis |
| `src/core/llm/native/NativeCliResolver.ts` | WinGet Links and robust native-path discovery |
| `src/core/llm/native/NativeProcess.ts` | Platform/shell-safe visible terminal behavior |
| `src/core/llm/native/ClaudeAgentProvider.ts` | Effective non-interactive credential-source guard and billing-safe environment policy |
| Device-local runtime state or settings migration | Prevent another device's persisted health from becoming local truth |
| `src/components/settings/modals/NativeRuntimeInstallModal.tsx` | OS tabs, linear install handoff, selected-platform copy and accessibility |
| `src/components/settings/modals/NativeRuntimeLoginModal.tsx` | One connection-check owner and current local auth copy |
| `src/components/settings/modals/NativeRuntimeLoginSteps.tsx` | Platform-aware conditional instructions |
| `src/components/settings/sections/PlanConnectionsSection.tsx` | Non-stale settings updates, corrected runtime descriptions and actions |
| `styles.css` | Tabs, completed/current steps, focus, narrow widths, themes |
| `src/core/llm/native/NativeRuntimeService.test.ts` | Full platform/installer/update matrix |
| `src/core/llm/native/NativeProcess.test.ts` | macOS Terminal and current Windows shells |
| New component tests | Modal/card transition and accessibility behavior |
| `RELEASE_NOTES_2.6.2.md` | Truthful user-facing change and validation scope |

The selected onboarding tab and copied installer choice can remain ephemeral and
need no migration. Installation method should normally be detected again at
update time; any remembered manual classification belongs in device-local state,
not synced vault settings.

Runtime health is different: the existing schema persists status, version, and
models even though they describe one machine. Moving that health to a
device-local store, removing it from durable settings, or resetting it to an
`unverified` state on load can require a schema migration or load-normalization
change. The 2.6.2 implementation must make and test that decision; this report
does not claim that the current settings schema can remain untouched.

## 11. Test And Release Gates

### 11.1 Unit tests

- Windows and Mac native commands for Claude and Antigravity.
- Alternative WinGet and Homebrew commands.
- Platform-specific shell labels, paste keys, expected paths, login commands,
  and updater commands.
- Claude native, WinGet Links, Homebrew, and custom-path discovery.
- Multiple simultaneous Claude installations, manager evidence conflicts, and
  the rule that an ambiguous/custom path never triggers a guessed updater.
- Antigravity official Windows and Mac path discovery.
- Sanitized `claude auth status` JSON fixtures for subscription OAuth, Console,
  API key/token/helper, and Bedrock/Vertex/Foundry; malformed and future schemas
  fail closed rather than becoming Plan-ready.
- Non-interactive Claude credential precedence with environment-variable names
  present but values redacted. No test may make a billable request.
- Antigravity personal versus Google Cloud provenance remains `unverified` when
  no supported machine-readable signal exists.
- Persisted `ready` from another platform/process is invalidated before local
  actions are enabled.
- `update-available` is either produced by a tested comparator or removed from
  active UI claims.

### 11.2 Component tests

- Initial `not-installed` state locks the next action and explains why.
- `not-installed -> login-required` enables or hands off to login before the
  modal closes.
- `not-installed -> ready` shows Finish.
- Diagnosis failure preserves a usable retry path.
- Pure copy/open-terminal actions do not falsely change status.
- Closing without diagnosis does not change the card.
- Windows/macOS tab switching updates all copy consistently.
- Selecting a non-current OS disables local terminal launch but keeps copy.
- Mac uses `Command`, Windows uses `Ctrl`.
- Local Antigravity flow does not require a code unless prompted.
- Modal and card never disagree after the same result.
- Settings changes made while a modal is open are not overwritten.
- A persisted `ready` card first renders `확인 중`, then reflects local diagnosis.
- Claude non-subscription and unknown-auth states cannot silently present as
  “Claude Plan”; Antigravity unknown/Cloud provenance cannot silently promise
  personal Plan quota.
- Keyboard-only and screen-reader status flow.

### 11.3 Clean Windows tests

Run on a Windows account that has never installed either CLI:

1. Claude native install, immediate detection without restarting Obsidian.
2. Claude subscription login, auth-source classification, and readiness.
3. Existing WinGet Claude detection and correct WinGet update.
4. Native plus WinGet collision shows a non-destructive choice instead of
   updating an arbitrary installation.
5. Antigravity install into `%LOCALAPPDATA%\agy\bin` and immediate detection.
6. Local browser login, plus conditional code prompt if the runtime presents it.
7. A redacted non-subscription Claude auth fixture is warned/blocked before any
   request, including when `ANTHROPIC_API_KEY` is present.
8. Copied plugin data with another machine's `ready` state is locally invalidated.
9. Cancel, denial, network failure, delayed installer completion, and retry.
10. Real `main.js` bundle, not only source-level React tests.

### 11.4 Clean Mac tests

Run on both Apple Silicon and Intel when available:

1. Claude native install without Homebrew.
2. Antigravity install to `~/.local/bin/agy`.
3. Terminal.app launch and `Command+V` instructions.
4. Detection when Obsidian was launched from Finder.
5. Apple Keychain/browser login and connection check.
6. Alternative Homebrew Claude detection/update.
7. Copied Windows `ready` state is invalidated and replaced by Mac diagnosis.
8. Local Antigravity auth behavior is recorded against the current formal-doc
   versus Codelab discrepancy, without recording account data or codes.
9. Narrow settings width, Hallym Light, CMDS Dark, reduced motion, and
   keyboard-only use.

### 11.5 Repository gates

```text
npm run type:check
npm test
npm run lint:check
npm run build
main.js <= repository bundle budget
three-file BRAT release contract preserved
```

Claude chat, Gemini chat, inline edit, RAG, document edit, MCP/research tools,
cancellation, and model discovery smoke tests from R-023 and R-024 remain
mandatory because onboarding changes must not alter the runtime protocol.

## 12. 2.6.2 Acceptance Criteria

1. A first-time Windows user can install either runtime without knowing what a
   shell, PATH, WinGet, Homebrew, or executable override is.
2. A first-time Mac user sees a real Mac guide with Terminal and Command-key
   instructions.
3. Windows and macOS instructions are selectable from the same guide.
4. Installation confirmation visibly advances to the next action without
   requiring the user to discover that closing reveals a changed card.
5. Closing the guide is never presented as the action that detects software.
6. Claude and Antigravity displayed commands match what the buttons execute.
7. A confidently classified package-manager installation receives its matching
   updater and a native installation receives the native updater; ambiguity or
   multiple conflicting installations never executes a guessed command.
8. Local Antigravity login does not falsely require the SSH code flow.
9. Modal and card state cannot disagree after one diagnostic result.
10. Credentials remain owned by the official CLI and its documented protected
    credential store, never Smart Composer.
11. Clean Windows and clean Mac bundle tests are recorded before stable release.
12. Claude Plan cannot become ready solely because some API, gateway, helper, or
    cloud-provider credential authenticated; effective non-interactive billing
    provenance is verified or the request is blocked with a clear warning.
13. Gemini Plan does not promise personal quota when Antigravity auth provenance
    is unknown or a Google Cloud project was selected.
14. Persisted status from another computer is never treated as current-device
    installation, authentication, or update truth before local diagnosis.

## 13. Known Unknowns And Release Blocks

1. The exact reported locked-Step-4 combination still needs reproduction in
   real Obsidian on the user's original fresh Windows scenario.
2. No Mac device was available in this research pass.
3. The product must choose whether to display first-party pipe-to-shell commands
   verbatim or retain R-023's staged-download safety presentation. Any wrapper
   must be labeled honestly and tested separately.
4. Installer-output localization and future command changes can invalidate text
   matching. Progress must not depend on an English success sentence alone.
5. Google documentation surfaces showed version-number drift between pages
   during investigation. Commands and auth behavior, not a hard-coded runtime
   version, should be the release contract.
6. Anthropic and Google policy/terms may constrain third-party use of consumer
   Plan credentials. Preserve experimental labels and recheck R-023 plus
   first-party policies before publication.
7. The supported Claude release's exact `auth status` JSON schema across
   subscription, Console, environment, helper, and cloud-provider methods needs
   sanitized live fixtures. Unknown schema must fail closed.
8. No current first-party machine-readable Antigravity contract was found for
   distinguishing personal quota from Google Cloud billing; release UX must
   preserve that uncertainty unless live/current evidence resolves it.
9. The implementation must choose device-local runtime health versus
   load-time invalidation/migration of persisted health. Both require copied- or
   synced-vault tests on a second OS.
10. Mutable Antigravity installer bytes and behavior must be re-hashed and
    rechecked at implementation and release time; the hashes in this report are
    evidence for 2026-08-10 only.

## 14. Evidence Ledger

| ID | Claim | Class | Evidence | Confidence |
| --- | --- | --- | --- | --- |
| E-01 | Local baseline was exact 2.6.1 | Verified: hash | 446/446 Git blob matches | High |
| E-02 | Card actions use persisted status | Verified: source | `PlanConnectionsSection.tsx:318-350` | High |
| E-03 | Step 4 uses modal-local diagnostics | Verified: source | `NativeRuntimeInstallModal.tsx:150-250` | High |
| E-04 | Closing does not diagnose | Verified: source | modal footer + `ReactModal.onClose()` | High |
| E-05 | The handler calls the local state setter before awaiting the parent callback; visible React commit order is not proven | Verified: source | `setDiagnostics`, then `onDiagnostics`; no mounted runtime test | High for call order, low for visible order |
| E-06 | Exact locked-modal/switched-card symptom is reproduced | Not verified | No live reproduction or component test | Not applicable |
| E-07 | WinGet discovery can fail with stale PATH | Inference | portable Links paths absent from direct candidates | Medium-high |
| E-08 | Mac platform logic already exists | Verified: source | service, resolver, `osascript` branches | High |
| E-09 | Selectable OS tabs do not exist | Verified: source | guide defaults to `process.platform` | High |
| E-10 | Mac shared login copy contains Ctrl-only text | Verified: source | login steps and status strings | High |
| E-11 | Claude native installer is currently recommended | Verified: official docs | Anthropic installation guide | High |
| E-12 | Current Claude defaults use package managers | Verified: source | WinGet/Homebrew guide branches | High |
| E-13 | Claude update behavior is installation-method-dependent | Verified: official docs | Anthropic update sections | High |
| E-14 | Gemini Plan invokes Antigravity, not Gemini CLI | Verified: source | `agy` resolver/provider/service | High |
| E-15 | Individual Gemini CLI access moved to Antigravity | Verified: official announcement | Google deprecation page, migration guide, and discussions 27274/28017 | High |
| E-16 | Antigravity supports Windows and macOS native scripts | Verified: official docs | Google installation guide | High |
| E-17 | Local Antigravity auth opens a browser when needed | Verified: official docs | Google installation/auth guide | High |
| E-18 | One-time code is mandatory for all local users | Partially verified: source conflict | Current formal docs scope it to SSH; older Google Codelab requires it locally | Medium pending live Windows/Mac test |
| E-19 | `update-available` is reachable | Not verified | Type/UI only; no producer found | High |
| E-20 | Clean Mac onboarding works | Not verified | No Mac device test | Not applicable |
| E-21 | `agy update` is a current documented updater | Not verified | Current formal docs omit it; background updater is documented | Not applicable |
| E-22 | Any successful Claude auth status proves subscription Plan billing | Contradicted: official docs + source | Exit code only in service; documented non-interactive credential precedence | High |
| E-23 | The effective Claude auth source can be parsed safely with the current code | Not verified | JSON is discarded; per-method live fixtures not captured | Not applicable |
| E-24 | Any successful `agy models` proves personal Gemini Plan quota | Not verified | Personal and Cloud login paths exist; no machine-readable provenance contract found | Not applicable |
| E-25 | Persisted runtime health is current-device truth | Contradicted: source | Health is in `saveData()` settings; executable override alone is device-local | High |
| E-26 | Inspected Antigravity scripts defer an existing binary to self-update | Verified: hash + source | Three endpoint hashes in `Sources Inspected`; shell script existing-binary branch | High for 2026-08-10 bytes only |

## 15. Security And Privacy

No OAuth token, API key, authorization code, account email, account identifier,
OS keyring item, private vault content, prompt, model response, or personal file
path was recorded.

The investigation used repository source, the public 2.6.1 Git tree, sanitized
file hashes and counts, and first-party public documentation. Local probing only
checked whether public executable paths existed; neither Claude Code nor
Antigravity was installed on the research machine.

Smart Composer must continue to delegate authentication and credential storage
to the official runtimes and their documented protected stores. Antigravity
uses OS keyrings; Claude Code's storage differs by operating system. No 2.6.2
onboarding convenience justifies copying an OAuth code into the plugin, reading
a token file, or serializing subscription credentials into the vault.

Billing-source checks may inspect documented auth-status classifications and
the presence of credential-related environment-variable names, but never their
values. Unknown or malformed auth metadata must fail closed before the first
non-interactive Plan request. A diagnostic warning must not echo tokens, keys,
cloud account identifiers, project IDs, organization IDs, or raw environment
dumps.

## 16. Change Log

- 2026-08-10: Initial source, bundle, repository-provenance, and first-party
  Windows/macOS investigation; 2.6.2 implementation contract established.
- 2026-08-10: Independent review normalized the report to **Partially
  verified**, recorded the Google auth-source conflict, added reproducibility
  hashes, and added billing-source, cross-device state, multi-install updater,
  and fail-closed release requirements.
- 2026-08-10: Corrected the GitHub default-branch and stale release
  `targetCommitish` statements, recorded the documented Antigravity installer
  flags that are absent from the reviewed scripts, and linked the macOS/2.6.2
  publication evidence to R-026.
