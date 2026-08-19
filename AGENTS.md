# Repository Instructions

## Mandatory research gate

Before planning or implementing any non-trivial change in this repository:

1. Open `docs/research/00-research-register.md`.
2. Read every report marked **Mandatory** that applies to the affected feature.
   For broad, cross-cutting roadmap, multi-subsystem migration, or architecture
   work, read all reports currently marked **Verified** and **Mandatory**. A
   scoped patch release requires the affected reports plus any explicit set
   named below, not every unrelated historical report.
3. For Plan settings, Claude Code, Gemini Plan, Antigravity CLI, native runtime
   installation, login, diagnosis, or updater work, always read R-023, R-024,
   and R-025 in full before editing code.
4. Treat labels precisely:
   - **Verified** means supported by inspected source, a reproducible test, or a
     current primary source.
   - **Partially verified** means source or current first-party evidence exists,
     but a required target-environment or clean-machine check is still pending.
   - **Inference** is not a verified runtime fact.
   - **Proposal** is not an implemented decision.
5. Re-check time-sensitive external facts against current first-party sources.
   Do not copy commands, model names, version claims, login behavior, or policy
   statements from memory.

## Recording new research

- Give each materially different investigation the next unused, zero-padded ID
  and a descriptive file name: `docs/research/R-###-topic-slug.md`.
- Start from `docs/research/REPORT_TEMPLATE.md`.
- Update `docs/research/00-research-register.md` in the same change.
- Never renumber old reports or silently rewrite history. Mark supersession and
  contradictions explicitly.
- Keep verified findings, inferences, proposals, implementation state, and
  untested release gates separate.
- Record the exact repository tag/commit and source paths whenever available.
- Never record credentials, tokens, account identifiers, private vault text, or
  other secrets in research artifacts, fixtures, logs, or screenshots.

## 2.6.2 Plan onboarding constraint

R-025 is the implementation contract for the 2.6.2 native Plan onboarding
work. Do not reduce the reported issue to a copy-only change: preserve the
state-transition, platform, executable-discovery, updater, authentication,
accessibility, and clean-machine test requirements recorded there.
