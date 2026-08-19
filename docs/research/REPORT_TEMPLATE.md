# R-###: Research title

## Status

- Evidence status: **Planned | Partially verified | Verified | Superseded**
- Planning use: **Optional | Mandatory**
- Investigation date: YYYY-MM-DD
- Repository baseline: tag / branch / commit / version
- Target release, if any: X.Y.Z

## Executive Summary

State the outcome first. Keep verified facts distinct from inferences and
proposals.

## Research Question

What exact question does this report answer?

### In scope

- ...

### Out of scope

- ...

## Baseline And Reproducibility

- Exact repository path, tag, branch, and commit.
- File inventory or comparison method.
- Operating systems, application versions, and runtime versions.
- Reproduction steps and sanitized observed results.

## Sources Inspected

### Repository source

- `path/to/file.ts:line`

### First-party external sources

- [Source title](https://example.com) — accessed YYYY-MM-DD

Use primary sources for current commands, policies, versions, and product
behavior. Record conflicts between current sources instead of silently choosing
one.

## Evidence Ledger

| ID | Claim | Class | Evidence | Confidence |
| --- | --- | --- | --- | --- |
| E-01 | ... | Verified: source / live / hash; Partially verified; Inference; Proposal; Contradicted; Not verified | ... | High / Medium-high / Medium / Low / Not applicable |

For a source conflict, name each source, its date/version, the precedence rule
used for any recommendation, and the live validation still required. Confidence
describes confidence in the stated evidence classification, not a license to
upgrade an untested claim to `Verified`.

## Verified Findings

### 1. Finding

Explain the source path, state transition, command output, or official contract
that establishes the finding.

## Inferences Requiring Validation

List every plausible explanation that has not been reproduced in its target
environment. Include the exact validation needed.

## Decision And Implementation Contract

Specify the intended behavior without presenting it as already implemented.

## Expected Change Surface

- Source files likely to change.
- Schema, migration, bundle, platform, security, and compatibility boundaries.

## Test And Release Gates

- Unit and component tests.
- Clean-machine tests.
- Real-application smoke tests.
- Type, lint, build, bundle, and rollback checks.

## Known Unknowns And Deferred Decisions

1. ...

## Security And Privacy

State explicitly that no credentials, tokens, account identifiers, private
vault content, or other secrets were recorded. Document any exception as a
release blocker.

## Change Log

- YYYY-MM-DD: Initial report.
