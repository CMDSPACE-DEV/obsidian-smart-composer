# R-021: Full-Auto MCP And Tool Execution

## Status

- **Verified + implemented for 2.5.4**
- Date: 2026-07-27
- Related reports: R-006, R-010, R-011

## User Problem

MCP-heavy research and fact-checking interrupted the chat repeatedly:

1. every newly requested remote tool could show an `Allow` card;
2. a successful tool result could still end on `Continue Response`;
3. the original one-round default made multi-step research especially tedious.

The owner of this custom build explicitly chose uninterrupted execution as the
default, including write and delete permission for trusted MCP connections.

## Implemented Policy

`MCP connections > Tool execution` now exposes three modes:

| Mode | Schema scan | Automatic execution |
| --- | --- | --- |
| Full auto (default) | Trusts the current snapshot when the user connects or rescans | Every reviewed, enabled tool, including write/delete/unknown |
| Safe auto | Explicit review remains | Read-only tools |
| Per-tool approvals | Explicit review remains | Only non-delete tools explicitly marked Auto |

Full auto does **not** bypass:

- MCP authentication or OAuth;
- a disabled connection;
- an individually disabled tool;
- transport and network failures;
- separate artifact preview/approval contracts.

Changing or adding a remote tool schema is trusted automatically only when the
connection is scanned while Full auto is active. The settings UI displays a
persistent warning to use only trusted MCP servers.

## Automatic Continuation

- The default automatic tool-round budget changed from `1` to `12`.
- Existing values greater than one are preserved by migration.
- The setting accepts 1 through 50 rounds.
- When Full auto reaches the configured round limit, the next model request
  hides all tools and asks the model to produce the final answer from the tool
  results already collected. This avoids ending a normal run on a manual
  `Continue Response` button while retaining a finite loop boundary.
- Safe auto and per-tool modes retain the existing approval cards and resume
  automatically after an approved tool finishes.

## Data Migration

- Settings schema: 24 to 25.
- Existing installations migrate to `executionMode: full-auto`.
- An old `maxAutoIterations` value of 1 migrates to 12.
- Higher user-defined limits are preserved.

## Verification

Automated coverage verifies:

- Full auto permits a reviewed delete-risk tool.
- Safe auto permits read and blocks write.
- Full-auto scans store reviewed schema hashes and inferred risk without a
  second approval step.
- The final request after the automatic round limit contains no tools.
- Settings migration preserves connections and higher custom round limits.

## Security Boundary

This behavior intentionally relaxes the beginner-safe approval contract
documented in R-010 and R-011 for this owner-controlled custom build. Anyone
distributing the build should make the warning visible and should not describe
Full auto as safe for untrusted MCP servers.

No credentials, tokens, secrets, or user data are recorded in this report.
