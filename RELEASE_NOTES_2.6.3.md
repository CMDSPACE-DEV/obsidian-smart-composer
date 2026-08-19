# Smart Composer Achmage 2.6.3

## Claude Pro/Max authentication hotfix

This hotfix fixes a 2.6.2 regression that treated every clean first-party
Claude Pro or Max login as billing-blocked. Users who were already signed in
were shown an error and could not reach Claude inference even though Claude
Code reported an eligible personal subscription.

## What changed

- Accepts only the exact clean personal Claude Pro/Max authentication shape:
  signed in through `claude.ai`, using the first-party provider, with no
  concrete billing override detected.
- Restores the normal connected/ready state and lets verified personal Pro/Max
  requests reach the Claude Code process.
- Keeps the request-time billing guard. Every request is checked again before
  inference starts, so a billing override introduced after setup is still
  blocked.
- Continues to reject API keys, auth tokens, gateways, helper credentials,
  Bedrock, Vertex, Foundry, Anthropic-on-AWS/Mantle paths, endpoint-managed
  settings, malformed or unknown authentication responses, and other concrete
  non-subscription sources.
- Keeps Team and Enterprise authentication blocked until the effective remote
  managed configuration can be proven safely for the individual request.
- Separates “signed in” from “request permitted” in Plan settings. A signed-in
  account with a billing guard failure is shown as signed in with requests
  blocked, rather than being sent through an endless sign-in loop.
- Leaves Gemini Plan behavior unchanged: inference remains blocked while the
  Antigravity CLI cannot provide machine-readable proof of personal Plan quota
  provenance.
- Does not persist or log authentication JSON, emails, organization details,
  tokens, Keychain/Credential Manager contents, or secret environment values.

## Verification

- Unit and integration coverage includes clean Pro and Max fixtures, every
  retained block condition, case-insensitive Windows environment variables,
  endpoint-managed settings, diagnosis-to-request revalidation, and a fake
  runner proving that an allowed request reaches inference.
- Linux, Windows Server 2025, macOS 15 Apple Silicon, and macOS 15 Intel jobs
  repeat the source tests and production build.
- The macOS jobs verify reviewed official installer scripts and load the
  three-file plugin bundle in a pinned Obsidian desktop fixture without using
  personal OAuth credentials.

## Verification and support boundary

GitHub Actions does not contain personal OAuth credentials and does not test a
browser callback, Keychain persistence, or a real subscription request. The
local classifier validation records only non-sensitive result fields.

Anthropic's current legal documentation restricts third-party products from
offering Claude.ai Free, Pro, or Max login or rate limits. The native Plan
integration remains an experimental, personal-use feature; users should review
Anthropic's current terms before enabling it.

## BRAT installation

The release contains the three files required by BRAT:

- `main.js`
- `manifest.json`
- `styles.css`

Minimum Obsidian version: `1.11.4`.
