# R-027: Claude Pro/Max Authentication Hotfix

## Status

- Evidence status: **Partially verified**
- Planning use: **Mandatory**
- Investigation date: 2026-08-10
- Repository baseline: annotated tag `2.6.2`, commit
  `f85e6ea00baec3e86897aa81d3d5146963b32dff`, branch
  `codex/2.6.3-claude-pro-max-auth-hotfix`
- Runtime inspected: Claude Code `2.1.226` on Windows
- Target release: Smart Composer Achmage `2.6.3`
- Completed evidence: 2.6.2 source inspection, current Anthropic documentation,
  a sanitized local authentication probe, the user-observed 2.6.2 UI error,
  implemented unit/component and full local tests, production build, and one
  authorized minimal live protocol validation
- Pending evidence: a fixed real-Obsidian diagnosis, complete exact-SHA CI, and
  publication

> [!IMPORTANT]
> This report supersedes the 2.6.2 implementation choice that blocks an exact,
> otherwise clean personal Pro/Max authentication result solely because remote
> server-managed settings are not machine-readable. It does not weaken the
> concrete environment, endpoint-managed-settings, API, gateway, helper, cloud,
> Team/Enterprise, or unknown-schema blocks required by R-025. It also does not
> supersede R-023's legal and product-distribution boundary.

## Executive Summary

Smart Composer 2.6.2 contains a P0 regression: it recognizes the exact supported
personal-subscription tuple `claude.ai` + `firstParty` + `pro|max`, then returns
`billing-blocked` unconditionally. The error shown to the user is therefore not
a failed Claude login. It is a Smart Composer policy rejection after successful
authentication.

A sanitized local probe of Claude Code 2.1.226 established:

```text
loggedIn=true
authMethod=claude.ai
apiProvider=firstParty
subscriptionType=max
```

No blocked Claude billing environment-variable name or local endpoint-managed
source was detected in that probe. No email, organization, token, credential
value, account identifier, raw auth JSON, or executable path was retained.

Anthropic's current documentation resolves the remote-settings premise. Remote
server-managed settings are available only to Claude for Teams and Claude for
Enterprise. A personal Pro or Max account is not eligible for that remote
delivery path. Endpoint-managed files, registry policy, MDM preferences, and
credential-precedence overrides remain real risks and must continue to block.

The 2.6.3 decision is therefore:

- allow a clean, exact personal Pro/Max auth tuple after concrete local and
  environment override checks pass;
- block Team, Enterprise, Console, cloud-provider, gateway, helper, long-lived
  token, endpoint-managed, malformed, and unknown provenance;
- apply the same guard again immediately before every Claude request;
- keep Gemini's independent quota-provenance policy unchanged.

This changes technical classification, not Anthropic's terms. Current Anthropic
legal documentation still says third-party developers must not offer Claude.ai
login or route Free, Pro, or Max credentials on users' behalf. The existing
Claude Plan path therefore remains experimental and personal-use compatibility,
not an official public integration or an Anthropic authorization.

## Research Question

Why does Smart Composer 2.6.2 reject a successfully logged-in personal Claude
Max account, and what is the narrowest 2.6.3 correction that restores personal
Pro/Max use without reopening API, cloud, enterprise-policy, or unknown-billing
paths?

### In scope

- Claude `auth status` classification.
- Effective non-interactive credential precedence.
- Local endpoint-managed and remote server-managed settings boundaries.
- Settings-card/login-modal status and request-time enforcement.
- Regression tests and 2.6.3 release gates.
- The independent legal/product-distribution boundary.

### Out of scope

- Weakening Gemini Plan's current unknown-provenance block.
- Reading credential values, keychains, OAuth stores, emails, or organization
  identifiers.
- Reimplementing Claude OAuth or storing Claude credentials in the plugin.
- Claiming that a technical classifier change grants contractual permission.
- Changing the native installer, resolver, updater, model catalog, or message
  protocol established by R-024 through R-026.

## Baseline And Reproducibility

### Repository baseline

- Repository: `laguna821/obsidian_smart_composer_Achmage`
- Source tag: annotated `2.6.2`
- Source/tag commit: `f85e6ea00baec3e86897aa81d3d5146963b32dff`
- Hotfix branch at investigation start:
  `codex/2.6.3-claude-pro-max-auth-hotfix`
- Working tree at investigation start: clean
- Relevant implementation version: `2.6.2`

### Sanitized Windows reproduction

1. Use the official native Claude Code executable without printing its absolute
   user path.
2. Read `--version` and parse `claude auth status` in memory.
3. Emit only the five allowlisted, non-identifier fields shown below.
4. Enumerate only the names of non-empty billing-precedence environment
   variables; never emit their values.
5. Check only the existence of endpoint-managed files, drop-ins, and documented
   Windows policy keys; never read or serialize their contents.

Sanitized observed result:

| Field | Result |
| --- | --- |
| Claude Code version | `2.1.226` |
| `loggedIn` | `true` |
| `authMethod` | `claude.ai` |
| `apiProvider` | `firstParty` |
| `subscriptionType` | `max` |
| Blocked environment-variable names present | none |
| Endpoint-managed file/drop-in present | no |
| Windows machine/user ClaudeCode policy key present | no |

The reported 2.6.2 dialog rendered the exact message returned by
`classifyClaudeAuthStatus()` for this tuple. No billable model request was made
during this research pass.

## Sources Inspected

All external sources were accessed on 2026-08-10.

### Repository source

- `src/core/llm/native/NativeRuntimeAuth.ts:25-38`
- `src/core/llm/native/NativeRuntimeAuth.ts:89-152`
- `src/core/llm/native/NativeRuntimeAuth.ts:155-223`
- `src/core/llm/native/NativeRuntimeAuth.ts:274-341`
- `src/core/llm/native/NativeRuntimeAuth.ts:377-414`
- `src/core/llm/native/ClaudeAgentProvider.ts:118-128`
- `src/core/llm/native/ClaudeAgentProvider.ts:249-255`
- `src/core/llm/native/NativeRuntimeService.ts:204-245`
- `src/core/llm/native/NativeRuntimeAuth.test.ts`
- `src/core/llm/native/ClaudeAgentProvider.auth.test.ts`
- `src/core/llm/native/NativeRuntimeService.diagnose.test.ts`
- `src/components/settings/modals/NativeRuntimeLoginModal.tsx`
- `src/components/settings/sections/PlanConnectionsSection.tsx`
- `RELEASE_NOTES_2.6.2.md`

### First-party external sources

- [Anthropic: Server-managed settings](https://code.claude.com/docs/en/server-managed-settings)
  - states that this remote delivery feature is available to Teams and
    Enterprise customers and is fetched for organization authentication;
  - describes remote and endpoint-managed precedence separately.
- [Anthropic: Authentication and credential precedence](https://code.claude.com/docs/en/authentication)
  - identifies subscription OAuth as the default for Pro, Max, Team, and
    Enterprise;
  - documents higher-priority gateway, cloud, bearer-token, API-key,
    `apiKeyHelper`, and long-lived-token routes.
- [Anthropic: Claude Code settings](https://code.claude.com/docs/en/settings)
  - documents endpoint-managed file, registry, MDM, and policy scopes and their
    precedence over command-line settings.
- [Anthropic: Installation and login troubleshooting](https://code.claude.com/docs/en/troubleshoot-install)
  - confirms that an approved `ANTHROPIC_API_KEY` can override subscription
    OAuth and that `/status` is the interactive inspection surface.
- [Anthropic: Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)
  - requires products and services to use API-key authentication and says
    third-party developers may not offer Claude.ai login or route Free, Pro, or
    Max credentials on users' behalf.
- [Anthropic Help Center: Use the Claude Agent SDK with your Claude plan](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)
  - currently says the announced June 2026 credit change is paused and that
    Agent SDK, `claude -p`, and third-party-app usage still draw from
    subscription limits; this operational statement does not override the legal
    authentication restriction above.

## Evidence Ledger

| ID | Claim | Class | Evidence | Confidence |
| --- | --- | --- | --- | --- |
| E-01 | 2.6.2 deliberately blocks exact personal Pro/Max tuples | Verified: source | `NativeRuntimeAuth.ts:315-333` returns `billing-blocked` with `allowed: false` after recognizing the tuple | High |
| E-02 | The user is logged in through a first-party personal Max account | Verified: sanitized live probe | Claude Code 2.1.226 allowlisted fields: `true`, `claude.ai`, `firstParty`, `max` | High |
| E-03 | The probe environment had no concrete local override evidence | Verified: sanitized live probe | No blocked variable names; no documented endpoint-managed file, drop-in, HKLM, or HKCU policy key | High for the probed process and instant |
| E-04 | Remote server-managed settings can apply to personal Pro/Max | Contradicted: current first-party documentation | Server-managed-settings requirements name Teams and Enterprise only | High |
| E-05 | Endpoint-managed settings can still outrank a personal login | Verified: first-party documentation and source | Settings hierarchy plus local inspector | High |
| E-06 | API, token, helper, gateway, and cloud credentials can override subscription OAuth | Verified: first-party documentation and source | Authentication precedence; sanitized environment filtering and marker classifier | High |
| E-07 | 2.6.2 has any successful Claude classification path | Contradicted: source | Every return after parsing is `allowed: false`; no `allowed: true` branch exists | High |
| E-08 | The sanitized CLI contract used by the fix reaches a live subscription request | Partially verified | Claude Code 2.1.226 exited successfully in 3,586 ms with `system`, `assistant`, `rate_limit_event`, and successful `result` event types; the prompt and response were not recorded; built-plugin execution remains pending | High for the direct CLI contract |
| E-09 | Public third-party Pro/Max routing is permitted | Contradicted: current first-party legal documentation | Legal-and-compliance authentication restriction | High |
| E-10 | The help-center statement is a contractual permission grant | Not verified | It describes current usage accounting while the legal page separately forbids third-party credential routing | Not applicable |

## Verified Findings

### 1. The observed message proves policy rejection, not login failure

`verifyClaudePlanAuth()` runs `claude auth status` only after the sanitized
environment and local endpoint-managed checks pass. It then delegates to
`classifyClaudeAuthStatus()`. The classifier explicitly constructs
`looksLikePersonalSubscription` from:

```text
authMethod=claude.ai
apiProvider=firstParty
subscriptionType=pro|max
```

The true branch nevertheless returns `status: billing-blocked` and
`allowed: false`, with the exact sentence shown in the user's dialog. Retrying
login cannot change this branch while the same valid account is selected.

The provider repeats this decision immediately before inference and
`assertRuntimeAuthAllowed()` throws before the Claude request starts. This is
why settings diagnosis and real chat are both unusable in 2.6.2.

### 2. The 2.6.2 classifier has no allowed Claude outcome

The classifier returns false for explicit logout, malformed output, recognized
API/cloud markers, exact personal Pro/Max, and all remaining schemas. The test
suite encoded that over-block as expected behavior, including a provider test
whose success condition is that inference never runs for a clean Pro fixture.

This is a release regression introduced by the 2.6.2 safety implementation,
not a Claude Code 2.1.226 authentication defect.

### 3. Remote and endpoint-managed settings are different risks

Anthropic documents two managed-setting families:

- server-managed settings delivered remotely to eligible organization
  authentication; and
- endpoint-managed settings delivered through system files, drop-ins, MDM
  preferences, or Windows registry policy.

The remote feature requires Teams or Enterprise. That eliminates the stated
remote-managed uncertainty for an exact personal Pro/Max tuple. It does not
eliminate endpoint-managed policy on the device. The existing local inspector
must remain fail-closed, including inspection errors.

Team and Enterprise tuples remain blocked because those plans are eligible for
remote settings and the supported non-interactive auth metadata does not prove
which effective remote keys apply to the pending request.

### 4. Concrete billing overrides must remain blocked

The 2.6.2 environment filter removes and records names, never values, for API
keys, bearer tokens, base URLs, custom headers, cloud-provider selection, a
long-lived OAuth token, and Foundry/Vertex/Bedrock routes. Inference uses
`--setting-sources ""` to exclude user, project, and local settings. The local
inspector blocks endpoint-managed sources that command-line settings cannot
override. Auth metadata markers provide a final fail-closed check for Console,
API key, helper, gateway, cloud, and future non-subscription routes.

These protections are independent of the false remote-settings premise and
must not be deleted to make Pro/Max pass.

### 5. Authentication readiness and legal permission are independent

The classifier can accurately establish that a local request will use the
personal subscription route without thereby establishing that a distributed
third-party product is permitted to route it. Anthropic's current legal page
forbids that product behavior, while a separate current help article discusses
how third-party usage is counted. The latter is not an authorization and the
former remains the controlling product-release warning recorded in R-023.

## Inferences Requiring Validation

1. A corrected `allowed: true` classification will make the user's settings
   card ready. Validate in the real 2.6.3 bundle; source logic alone does not
   prove the complete React transition.
2. The same sanitized environment will remain effective from preflight through
   the spawned inference process. Validate with a fake runner first and a
   user-authorized minimal live request second, without logging content or
   account data.
3. Future Claude versions may rename auth-status fields. Keep exact allowlisting
   and fail unknown schemas closed; do not add fuzzy personal-plan matching.
4. A personal user could be on a device managed by an employer. The endpoint
   inspector covers documented locations, but future policy mechanisms require
   a first-party documentation recheck before each release.

## Decision And Implementation Contract

### Classification matrix

| Evidence | Authentication result | Request |
| --- | --- | --- |
| Explicit `loggedIn=false` | `login-required` | Block |
| Exact clean `claude.ai` + `firstParty` + `pro` | `ready` | Allow |
| Exact clean `claude.ai` + `firstParty` + `max` | `ready` | Allow |
| `team` or `enterprise` | `billing-blocked` with organization-policy explanation | Block |
| Console/API key/helper/gateway/cloud marker | `billing-blocked` | Block |
| Non-empty blocked environment-variable name | `billing-blocked` before auth probe | Block |
| Endpoint-managed source or inspection failure | `billing-blocked` before auth probe | Block |
| Long-lived OAuth token or unknown auth method | `billing-blocked` | Block |
| Missing, malformed, or future JSON schema | `billing-blocked` | Block |

### Required behavior

1. Change only the exact clean Pro/Max branch to
   `{ status: 'subscription', allowed: true }` with non-sensitive evidence;
   the runtime service derives the final `ready` snapshot from that decision.
2. Preserve environment filtering, case-insensitive Windows classification,
   endpoint-managed inspection, and all blocked-marker checks.
3. Preserve Team/Enterprise and unknown fail-closed behavior.
4. Continue using the same sanitized environment for auth preflight and the
   actual inference process.
5. Re-run the guard immediately before every provider request; never trust only
   a settings-page snapshot.
6. Change the settings/modal copy so successful login is not described as a
   failure. For a genuine block, distinguish login state from billing-source or
   organization-policy state.
7. Do not modify Gemini classification in this hotfix.
8. Do not read or persist raw auth JSON, emails, organization identifiers,
   tokens, credential-store data, environment values, or managed-setting
   contents.

## Expected Change Surface

- `src/core/llm/native/NativeRuntimeAuth.ts`
  - exact personal Pro/Max allow result and corrected reason/evidence;
  - no relaxation of any other branch.
- `src/core/llm/native/NativeRuntimeAuth.test.ts`
  - positive clean Pro/Max fixtures and retained negative matrix.
- `src/core/llm/native/ClaudeAgentProvider.auth.test.ts`
  - prove a clean fixture reaches fake inference with the same sanitized
    environment; prove every concrete override still stops before inference.
- `src/core/llm/native/NativeRuntimeService.diagnose.test.ts`
  - change exact clean Pro/Max diagnosis from `billing-blocked` to `ready`.
- Settings/modal tests and copy only where the status message is asserted.
- `RELEASE_NOTES_2.6.3.md` and version metadata after the functional patch is
  independently verified.

No settings-schema, runtime-protocol, resolver, installer, updater, model, or
external plugin API change is required.

## Test And Release Gates

### Unit and provider tests

- Exact lowercase/normalization fixtures for clean `pro` and `max` return
  `ready`, `allowed: true`.
- `team`, `enterprise`, Console, Bedrock, Vertex, Foundry, gateway,
  `apiKeyHelper`, long-lived token, missing fields, malformed JSON, and unknown
  future schemas remain blocked.
- Non-empty blocked variables, including mixed-case Windows names, block before
  `auth status`; their values never appear in snapshots or errors.
- Endpoint-managed file, drop-in, HKLM, HKCU, MDM-preference evidence, and
  inspection failure remain blocked before `auth status`.
- Clean Pro/Max calls the fake inference runner after one auth preflight; both
  calls receive the same sanitized environment object contents.
- A request-time override introduced after settings diagnosis is caught by the
  new request preflight.
- No test makes a network or billable model request.

### Component and real-application tests

- A clean Pro/Max diagnosis changes the card and modal to Ready without another
  login or modal restart.
- A blocked Team/Enterprise or concrete override displays a billing/policy
  explanation, not a false signed-out message.
- The exact 2.6.2 remote-managed warning is absent for clean personal Pro/Max.
- Existing installation Step 3 to Step 4 behavior remains unchanged.
- The built `main.js`, not only source tests, is loaded in Obsidian with no
  JavaScript or settings-render error.

### Live and repository gates

1. On the user's Windows environment, the sanitized Claude Code 2.1.226 tuple
   must diagnose as Ready in the built plugin without another login.
2. With the account owner's explicit authorization, make one minimal live
   request and record only success/failure, runtime version, duration, and
   non-sensitive protocol shape. Do not record the prompt, response, account,
   token, quota balance, or credential data.
3. Run the full existing provider, chat, inline, RAG, MCP/research,
   cancellation, and native-runtime regression suites.
4. Run `npm run type:check`, `npm test`, `npm run lint:check`, `npm run build`,
   and the repository bundle-budget check on Node.js 20.
5. Pass Ubuntu, Windows 2025, macOS arm64, and macOS x64 Actions gates. CI uses
   fixtures only and stores no OAuth or Keychain secret.
6. Preserve the three-asset Obsidian release contract and verify downloaded
   hashes, version parity, annotated tag, branch HEAD, Draft PR, and stable
   release state for 2.6.3.

### Local implementation evidence on 2026-08-10

- The focused authentication, provider, service, and UI suites passed 75/75
  tests after the compact-key provenance fail-closed review fix.
- The full local suite passed 95/95 suites and 582/582 tests.
- Type checking and repository lint completed with zero errors; ten pre-existing
  warnings remained in unrelated Research modules.
- The production build passed at 5,275,362 of 6,815,744 bytes.
- A one-request Windows validation used the same empty setting-source, safe-mode,
  no-tool, no-session-persistence shape as the provider. Claude Code 2.1.226
  confirmed only the allowlisted `claude.ai`, `firstParty`, and `max`
  classifications, exited successfully in 3,586 ms, and emitted `system`,
  `assistant`, `rate_limit_event`, and successful `result` event types. The
  prompt, response, email, organization, token, quota, and credential values
  were neither printed nor stored.

The report remains **Partially verified** until the fixed real-Obsidian
diagnosis, exact-SHA CI, and release evidence exist.

## Known Unknowns And Deferred Decisions

1. Claude Code exposes interactive `/status` setting sources, but this research
   did not find a supported non-interactive field that proves effective remote
   managed settings per request. Team/Enterprise therefore remains blocked.
2. Future Anthropic auth-status fields or managed-delivery eligibility can
   change. Recheck first-party docs and fixtures rather than widening fuzzy
   matching.
3. Anthropic's help article and legal page describe current accounting and
   permitted authentication from different angles. The hotfix does not resolve
   that product/legal tension or substitute for Anthropic approval.
4. No OAuth, browser callback, Keychain persistence, or managed enterprise
   account can be validated in public GitHub Actions without introducing
   prohibited secrets.

## Security, Privacy, And Legal Boundary

No access token, API key, OAuth code, account email, account identifier,
organization identifier, environment-variable value, managed-setting value,
credential-store item, private vault content, prompt, or model response was
recorded. The local executable path was classified but not retained.

The plugin must continue to delegate credential storage and browser login to
the official Claude Code runtime. It may inspect only allowlisted auth-status
classifications, blocked environment-variable names, and documented
endpoint-managed-source existence. It must never read secret values or copy
credentials into Obsidian settings, logs, tests, screenshots, Actions secrets,
or artifacts.

Technical readiness is not legal authorization. Anthropic's current
legal-and-compliance documentation states that products and services should use
API-key authentication and that third-party developers may not offer
Claude.ai login or route personal-plan credentials for users. Consequently:

- retain R-023's experimental/personal-use labeling;
- do not describe this path as an official Anthropic integration;
- do not infer permission from the help-center usage-accounting article;
- use API-key authentication as the distributable-product default unless
  Anthropic grants a different contract;
- treat public release of enabled personal-plan routing as an explicit owner
  risk decision, not a conclusion established by this report.

## Change Log

- 2026-08-10: Initial report. Verified the 2.6.2 unconditional personal Pro/Max
  block, captured only allowlisted Claude Code 2.1.226 Max fields, rechecked
  current first-party remote-settings and credential-precedence contracts, and
  defined the narrow 2.6.3 hotfix and release gates.
- 2026-08-10: Implemented and locally verified the narrow allow path, added
  fail-closed future-provenance coverage, passed 582 local tests and the bundle
  budget, and recorded only the non-sensitive shape of one authorized live
  request. Real-Obsidian, exact-SHA CI, and publication evidence remain pending.
