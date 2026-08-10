# R-028: Gemini Plan Compatibility Unblock

## Status

- Evidence status: **Partially verified**
- Planning use: **Mandatory for Gemini Plan authentication and the 2.6.4
  hotfix/release**
- Investigation date: 2026-08-10
- Repository baseline: annotated tag `2.6.3` (tag object
  `e790100f979c5fdcd6f8ca0c137f399d79cf8054`, peeled commit
  `466a5c51437d0d724e5bec9d954431d98116e3f9`), branch
  `codex/2.6.4-gemini-unblock`
- Comparison baseline: annotated tag `2.6.1` (tag object
  `e42ed66d2ba73cc78a57e558e0d7487c3b5008ed`, peeled commit
  `bb6f24821c5e4e8c567b0600598b2b66437511ae`)
- Target release: Smart Composer Achmage `2.6.4`
- Completed evidence: tagged-source comparison, R-023 through R-025 review,
  R-024's sanitized live Antigravity protocol evidence, and current
  first-party-document refresh
- Pending evidence: implementation, current-runtime live compatibility probe,
  real-Obsidian smoke test, exact-SHA CI, and release qualification

> [!IMPORTANT]
> This report supersedes only the **unknown-provenance means every Gemini
> request is blocked** interpretation introduced for 2.6.2 and retained in
> 2.6.3. It does not convert a successful model catalog into proof of personal
> Google AI quota, and it does not relax rejection of concrete API or Google
> Cloud billing overrides.

## Executive Summary

Gemini Plan worked through the official Antigravity CLI in 2.6.1 and in the
sanitized live probes recorded by R-024. Version 2.6.2 then deliberately made
every otherwise healthy Antigravity session non-runnable because the CLI did
not expose a machine-readable field proving that the next request would use a
personal Google AI quota. Version 2.6.3 left that rule unchanged. The result is
an availability regression: a successful installation, sign-in, and non-empty
model catalog are displayed as `quota-unverified`, and the provider repeats the
same check before every request and throws before starting Antigravity.

The user has explicitly rejected that blanket block and selected a
compatibility policy for 2.6.4. A successful Antigravity model-catalog probe,
with no concrete API/Cloud override in the sanitized process environment or
machine-readable output, may become `ready` and may run a request. The same
guard must still run immediately before inference. A detected Google API key,
ADC/project environment, service account, enterprise/Cloud marker, or
consumption-billing marker remains `billing-blocked`.

This is an intentional product-policy change, not new proof of billing
provenance. The UI and release notes may say that Antigravity is connected and
compatible; they must not say that Smart Composer proved a personal Pro/Ultra
quota or guaranteed that a request is free. Current Google documentation
confirms that Antigravity supports individual accounts and Google AI plan
quotas, but also supports teams under Google Cloud terms and exposes quota and
credit details through interactive TUI panels rather than a documented
non-interactive provenance contract.

## Research Question

How should 2.6.4 restore the previously working Gemini/Antigravity request path
without falsely claiming machine-proven personal quota and without removing
the concrete API/Cloud override guard?

### In scope

- The 2.6.1, 2.6.2, and 2.6.3 Gemini diagnosis and request gates.
- Antigravity installation/authentication, model-catalog, one-shot request,
  quota, credit, and plan documentation relevant to the compatibility decision.
- The 2.6.4 runtime snapshot, request preflight, UI truthfulness, tests, and
  release boundary.
- Explicitly recording the contradiction and partial supersession of R-025.

### Out of scope

- Weakening Claude's separate 2.6.3 Pro/Max authentication classifier.
- Reading or storing Antigravity keyring records, account data, tokens, raw
  quota panels, or private model responses.
- Claiming that a non-empty catalog identifies Pro, Ultra, Free, Team, or
  Enterprise quota.
- Replacing the R-024 Antigravity headless protocol or Smart Composer's tool,
  temporary-directory, cancellation, and vault-isolation boundaries.
- Resolving the legal suitability of consumer Plan delegation for a public
  third-party product; R-023 remains authoritative for that boundary.

## Baseline And Reproducibility

The 2.6.4 branch starts from the peeled `2.6.3` commit
`466a5c51437d0d724e5bec9d954431d98116e3f9`. The inspected package version is
`2.6.3` before the hotfix version bump.

The tagged-source comparison establishes the regression boundary:

1. In `2.6.1`, `diagnoseAntigravity()` runs `agy models --json`, falls back to
   `agy models`, parses the catalog, and returns `ready` when at least one model
   is present.
2. In `2.6.1`, `AntigravityProvider.streamResponse()` resolves `agy` and starts
   the provider request without a separate quota-provenance preflight.
3. In `2.6.2` and `2.6.3`,
   `classifyAntigravityQuotaProvenance()` returns
   `quota-unverified`/`allowed: false` for every clean result that lacks a
   concrete Cloud marker.
4. In `2.6.3`, `diagnoseAntigravity()` consequently maps a successful non-empty
   catalog to a non-ready `quota-unverified` snapshot, while
   `AntigravityProvider.streamResponse()` calls
   `verifyAntigravityPlanAuth()` and `assertRuntimeAuthAllowed()` before
   inference. No clean Antigravity session can pass that combination.

R-024 independently records a sanitized live test on official Antigravity CLI
`1.1.8`: the corrected `agy -p` argument order returned the requested marker
for both tested Gemini models using the verified NDJSON event shapes. That
proves a real working runtime path existed; it does not prove the billing source
of every future request.

The current first-party pages inspected on 2026-08-10 identify their
documentation set as Antigravity CLI `1.1.11`. Version drift from R-024 is a
reason to repeat the live probe, not a reason to erase R-024's verified result.

## Sources Inspected

### Repository source

- `src/core/llm/native/NativeRuntimeAuth.ts`
  - `prepareNativePlanEnvironment()`
  - `verifyAntigravityPlanAuth()`
  - `classifyAntigravityQuotaProvenance()`
  - `assertRuntimeAuthAllowed()`
- `src/core/llm/native/NativeRuntimeService.ts`
  - `diagnoseAntigravity()`
  - `parseAntigravityModels()`
- `src/core/llm/native/AntigravityProvider.ts`
  - request-time verification and one-shot execution
- `src/core/llm/native/nativeRuntime.types.ts`
- `src/core/llm/native/NativeRuntimeAuth.test.ts`
- `src/core/llm/native/NativeRuntimeService.diagnose.test.ts`
- `src/components/settings/modals/NativeRuntimeOnboarding.interaction.test.tsx`
- `RELEASE_NOTES_2.6.2.md`
- `RELEASE_NOTES_2.6.3.md`
- Tagged versions of the same files at `2.6.1`, `2.6.2`, and `2.6.3`
- R-023, R-024, and R-025 in full

### First-party external sources

All sources below were accessed on 2026-08-10.

- [Google Antigravity: Installation and authentication](https://antigravity.google/docs/cli/install)
- [Google Antigravity: Getting started](https://antigravity.google/docs/cli/getting-started)
- [Google Antigravity: CLI reference](https://antigravity.google/docs/cli/reference)
- [Google Antigravity: Best practices and non-interactive `-p`](https://antigravity.google/docs/cli/best-practices)
- [Google Antigravity: Model quotas (`/usage`)](https://antigravity.google/docs/cli/commands/usage)
- [Google Antigravity: AI credits and quota settings](https://antigravity.google/docs/cli/credits)
- [Google Antigravity: Plans](https://antigravity.google/docs/plans)

The inspected current pages document keyring/browser authentication,
interactive `/usage`, interactive `/credits`, the `useG1Credits` setting, and
one-shot `agy -p`. They do not document a non-interactive auth-status or quota
provenance field that distinguishes an individual Google AI account from a
team/Cloud account for a third-party caller. This is a finding about the pages
inspected on this date, not proof that no private or future runtime field can
exist.

## Evidence Ledger

| ID | Claim | Class | Evidence | Confidence |
| --- | --- | --- | --- | --- |
| E-01 | 2.6.1 marks a non-empty Antigravity catalog ready | Verified: tagged source | `2.6.1:NativeRuntimeService.ts` | High |
| E-02 | 2.6.1 starts Gemini requests without the 2.6.2 provenance guard | Verified: tagged source | `2.6.1:AntigravityProvider.ts` | High |
| E-03 | Antigravity 1.1.8 returned real one-shot answers through the corrected protocol | Verified: sanitized live | R-024, two model probes | High for the tested runtime/device |
| E-04 | 2.6.2/2.6.3 reject every clean catalog lacking a Cloud marker | Verified: tagged source | classifier always returns `allowed: false` in the clean branch | High |
| E-05 | The request path repeats the block immediately before inference | Verified: source | provider calls verification then assertion | High |
| E-06 | Antigravity supports individual accounts and differentiated Google AI plan quotas | Verified: current official docs | Plans page | High |
| E-07 | Antigravity also has a teams path under Google Cloud terms | Verified: current official docs | Plans page | High |
| E-08 | Local Antigravity auth uses the OS keyring and browser when needed | Verified: current official docs | Installation/auth page | High |
| E-09 | Current quota and credit inspection is documented as interactive TUI panels | Verified: current official docs | `/usage` and `/credits` pages | High |
| E-10 | `useG1Credits` controls personal-credit overage behavior and is documented as `false` by default | Verified: current official docs | CLI reference and credits page | High for the documented setting |
| E-11 | A successful catalog proves which quota will fund the next request | Not verified | No such field in the inspected current contract | Not applicable |
| E-12 | Blanket blocking is required to keep Antigravity credentials secure | Contradicted: source/live | Official CLI still owns keyring credentials; R-024 request required no plugin token storage | High |
| E-13 | Restoring compatibility while retaining concrete override blocks is the 2.6.4 policy | Decision: user-approved | Explicit 2026-08-10 hotfix direction | Not applicable |
| E-14 | The 2.6.4 implementation and current-runtime probe pass | Not verified | Work not complete when this report was created | Not applicable |

## Verified Findings

### 1. The Gemini block is an intentional 2.6.2 regression, not a failed login

The 2.6.2 release notes explicitly say all Gemini Plan inference is blocked
because Antigravity exposes no machine-readable proof of personal Plan quota.
The 2.6.3 notes explicitly retain that behavior. Source matches the notes:
successful model discovery can establish installation, authentication, and a
catalog, but the final classifier still returns `allowed: false`.

That rule is stronger than the original problem statement. R-025 AC13 required
truthfulness when provenance is unknown and required a Cloud selection not to
silently appear as personal quota. It did not establish that a healthy
unknown-provenance consumer session was technically unable to run. The
subsequent fail-closed implementation converted uncertainty into a universal
availability block.

### 2. R-024 proves the underlying request adapter worked

R-024 is not a mock-only result. It records real official Antigravity CLI
`1.1.8` requests from isolated temporary directories, including the corrected
placement of the prompt immediately after `-p`, the actual NDJSON event shape,
and exact-marker success on two model selections. The 2.6.2/2.6.3 guard runs
before that adapter, so removing the blanket guard restores a previously
verified path rather than inventing a new transport.

### 3. Current Google docs support both the compatibility case and the warning

The current Plans page states that Antigravity is available to individual
accounts and that Google AI Pro and Ultra receive differentiated baseline
quota. This supports the user's expectation that a normal first-party
Antigravity sign-in can be useful without a plugin-managed API key.

The same page also distinguishes a teams path under Google Cloud terms.
Therefore the docs do not support changing the UI message to "personal quota
verified." The correct claim is narrower: the official runtime is installed,
authenticated enough to return a model catalog, and accepted under the user's
compatibility policy.

### 4. Interactive quota panels are not a request-time provenance API

Google documents `/usage`/`/quota` and `/credits` as interactive TUI panels.
The pages do not publish a stable JSON schema suitable for a request-time
third-party preflight. Smart Composer must not scrape those panels, store their
contents, or treat display text as a durable API contract.

The documented `useG1Credits` setting controls optional personal-credit
overages. Smart Composer must not silently enable it or claim that it inspected
the user's actual setting unless a separate safe, documented contract is
implemented and tested. The 2.6.4 unblock does not change that setting.

### 5. Existing concrete override checks remain useful

The 2.6.3 process preparation removes and records only the **names** of explicit
Google API, ADC, project, quota-project, and Vertex environment variables. It
never needs their values. The JSON classifier also rejects recognized project,
service-account, enterprise, Cloud, ADC, and consumption markers.

Those checks do not prove the clean path is personal, but they can prevent
known override signals from being silently labeled as Gemini Plan. Keeping
them is compatible with restoring ordinary Antigravity use.

## Decision And Implementation Contract

### 1. Compatibility acceptance rule

For Gemini only, 2.6.4 adopts the following rule:

```text
official agy executable found
  + sanitized environment has no concrete API/Cloud override name
  + model-catalog command succeeds
  + parsed model catalog is non-empty
  + machine-readable output has no concrete Cloud/enterprise/ADC/
    service-account/consumption marker
  => snapshot ready and request allowed
```

The resulting decision reason must be truthful, for example:

> Antigravity is signed in and returned a usable model catalog. The exact
> quota source is not exposed through the current machine-readable check.

If the existing internal `subscription` enum is retained for a minimal patch,
it is only an accepted-auth compatibility state. It must not be rendered or
documented as forensic proof of Pro/Ultra quota. A future internal
`authenticated`/`compatible` state name may improve semantics, but is not a
release requirement if it would expand the hotfix unnecessarily.

### 2. Retained block conditions

The hotfix must still reject the request when any of the following is present:

- non-empty `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_API_KEY`,
  `GEMINI_API_KEY`, `GOOGLE_CLOUD_PROJECT`, `GCLOUD_PROJECT`,
  `CLOUDSDK_CORE_PROJECT`, `GOOGLE_CLOUD_QUOTA_PROJECT`,
  `VERTEX_AI_PROJECT`, or `VERTEX_AI_LOCATION`, matched case-insensitively;
- a recognized project ID, billing/quota project, service account, Cloud,
  enterprise, ADC, or consumption-billing marker in machine-readable output;
- a signed-out response, failed catalog command, empty/unparseable catalog, or
  canceled/timed-out preflight.

Only variable names and non-secret classifications may appear in evidence or
logs. Values and raw authentication/catalog payloads remain private.

### 3. Diagnosis and request-time behavior must agree

- A clean successful catalog produces `status: ready`,
  `installation: installed`, `catalog: ready`, the discovered models, and an
  allowed auth decision.
- The snapshot uses a non-error warning or explanatory detail for the
  unverified quota source; it must not keep the old blocking error.
- A concrete override produces `billing-blocked` and no request.
- Signed out produces `login-required`; catalog failure produces `error`.
- Every provider request repeats the same sanitized-environment and catalog
  guard immediately before inference. A diagnostic result is never permanent
  authorization.
- The diagnostic and provider paths should share behavior for the tested
  `models --json`/plain-text fallback so a card cannot say ready while the same
  runtime is categorically rejected by a mismatched preflight.

### 4. UI and release truthfulness

The connected state may say that the official Antigravity CLI is ready. It may
also state that exact quota provenance is not machine-verified. It must not:

- claim that Google AI Pro/Ultra was detected when it was not;
- guarantee no charges, credits, enterprise consumption, or future policy
  changes;
- expose account, project, quota, model-catalog, or keyring payloads;
- direct the user to paste credentials into Smart Composer.

The 2.6.4 release notes must identify this as a rollback of the 2.6.2/2.6.3
blanket Gemini block and distinguish it from the retained concrete override
guard.

### 5. Exact R-025 partial supersession

R-025 remains mandatory for onboarding, platform tabs, device-local state,
resolver/updater behavior, accessibility, and credential ownership. This
report changes only the following interpretation:

- **Superseded for 2.6.4:** R-025 section 9.6 and AC13 as implemented in 2.6.2
  to mean that unknown personal-quota provenance must block every otherwise
  healthy Antigravity request.
- **Retained:** do not promise personal quota when provenance is unknown; reject
  a concrete Google Cloud/API/enterprise/consumption signal; keep the official
  CLI/keyring as credential owner; revalidate before each request.

This is a partial supersession, not a rewrite of R-025's historical evidence.

## Expected Change Surface

- `src/core/llm/native/NativeRuntimeAuth.ts`: allow the clean successful
  catalog decision; retain environment and machine-readable Cloud markers.
- `src/core/llm/native/NativeRuntimeService.ts`: map that allowed decision to a
  ready snapshot and non-blocking truthful detail.
- `src/core/llm/native/AntigravityProvider.ts`: keep request-time verification
  and let the allowed decision reach the existing R-024 adapter.
- `src/core/llm/native/nativeRuntime.types.ts`: only if an internal
  authenticated/compatible state is introduced.
- Native auth, diagnosis, provider, and onboarding interaction tests.
- `RELEASE_NOTES_2.6.4.md`, version metadata, generated bundle, and release
  workflow configuration.

No external plugin API or credential migration is required. The settings
schema need not change solely for this policy rollback because runtime health
remains process-local under the 2.6.2 architecture.

## Test And Release Gates

### Automated tests

1. A successful non-empty `agy models --json` fixture with no override marker
   returns `allowed: true` and a ready snapshot.
2. The plain-text model-list fallback, if retained for the release runtime,
   reaches the same ready decision after a non-empty parse.
3. Each blocked environment-variable name, including mixed-case Windows
   spelling, still prevents diagnosis and request execution without retaining
   its value.
4. Nested project, service-account, Cloud, enterprise, ADC, and consumption
   markers still produce `billing-blocked`.
5. Signed-out, command-failure, empty-catalog, cancellation, and timeout paths
   remain non-ready.
6. A provider integration test proves a clean preflight reaches the inference
   runner.
7. A second integration test changes the environment after a ready diagnosis
   and proves the request-time guard blocks inference.
8. Card and modal display ready simultaneously and do not present the quota
   uncertainty as an error or a new sign-in loop.
9. Existing R-024 prompt ordering, stream parsing, temporary-directory,
   bounded-tool, cancellation, and no-vault-access tests remain unchanged and
   passing.
10. Full type check, lint, tests, production build, bundle budget, Windows,
    Linux, Apple Silicon macOS, Intel macOS, and pinned-Obsidian smoke jobs pass
    on the exact release SHA.

### Sanitized live compatibility probe

Before a stable release, use an already installed official runtime without
reading its keyring or raw account data:

1. record only the `agy --version` version string;
2. run model discovery in a sanitized environment and record only exit status,
   whether parsing succeeded, and model count;
3. run one minimal `agy -p` request from an isolated temporary directory and
   record only success/failure, expected-marker match, event kinds, and elapsed
   time;
4. never record the prompt, model response, account/project identifier, raw
   catalog, quota panel, token, or keyring data.

GitHub Actions must continue to use fixtures only for authentication. Personal
OAuth, browser callbacks, Keychain/Credential Manager persistence, and live
quota provenance are not CI claims.

## Inferences Requiring Validation

1. A current Antigravity `1.1.11`-series binary preserves the exact model-list
   and headless event contracts observed on `1.1.8`. Validate with the sanitized
   live probe; current docs confirm `-p` but do not publish the complete
   `models --json` schema used by Smart Composer.
2. Every team/Cloud session exposes one of the retained environment or JSON
   markers. This is not proven; absence of a marker is compatibility acceptance,
   not positive personal-account classification.
3. The real user's Antigravity account and overage configuration will use the
   intended quota. Smart Composer must leave those account-owned choices to
   Google and the user.

## Known Unknowns And Deferred Decisions

1. No inspected current first-party page defines a non-interactive field that
   proves the next request's personal quota source.
2. `/usage`, `/credits`, and the actual `useG1Credits` value are intentionally
   not scraped in this hotfix.
3. The compatibility policy cannot guarantee that Google will not change
   routing, quota, credits, or terms after release.
4. A future official auth/quota JSON contract should replace compatibility
   inference when it becomes available and is captured in sanitized fixtures.
5. Public-product legal/policy suitability remains governed by R-023 and needs
   separate review; this hotfix addresses the user's local personal-use
   regression.

## Security And Privacy

No credentials, tokens, authorization codes, account identifiers, project
identifiers, organization details, raw environment values, keyring contents,
private vault content, prompts, model responses, or raw quota/catalog payloads
were recorded.

The investigation used tagged repository source, sanitized prior research, and
public first-party documentation. The implementation must continue to delegate
credential ownership to the official Antigravity CLI and the operating
system's protected keyring. Compatibility acceptance does not authorize Smart
Composer to read or persist those credentials.

## Change Log

- 2026-08-10: Initial report; documented the 2.6.2/2.6.3 blanket Gemini block,
  the R-024 working path, current first-party account/quota boundaries, the
  user-approved 2.6.4 compatibility rollback, and the retained concrete
  Cloud/API guard.
