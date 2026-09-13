# Native iOS source preservation — 2026-09-13

Two divergent source versions were preserved and reconciled for build 17.
A newer directory timestamp did not establish feature completeness.

## Current development branch

`codex/word-substitution-sync-current` contains shared word replacements plus the
new continued background transcription implementation, its 43 passing targeted
tests, and the corrected Field Theory / Preparing voice model UI copy.
The signed iPhone build passes. Background inference on the phone remains unverified.

The branch now includes the prior Auto-send control, capture-time eligibility,
selection/stack layout, processing dots, and agent result/status display. The
initial background-transcription candidate installed on Focus omitted those
features; build 17 reconciles them while retaining word replacements and continued
background processing. Explicit Retry still enters the new continued-task path.

## Preserved prior phone source

`codex/ios-autosend-preserved-20260913`, commit
`77e30b2f7973e83cfcdba200f0a544d56be861d4`, preserves 110 files byte-for-byte from
`worktrees/ios-background-sync/ios-native`, excluding generated projects, build
products and device verification logs. That folder no longer has its own `.git`
worktree metadata; relying only on `git worktree list` would miss it.

The source contains:

- Compact Auto-send control beside the first date heading, with persisted setting
  and capture-time eligibility, replacing the countdown-based delivery choice.
- Stack count beside the expand control and selection affordance changes.
- Animated processing indicators, revision-scoped agent status, final response
  display, and Complete status for terminal receipts containing usable results.

Local `verification/device16-final.log`, `device-install16.log`, and
`device-apps16.log` in that surviving folder establish a build-16 source build and
successful phone installation. They do not establish which version was on the
phone immediately before this thread's install, or prove physical UI behavior.

The preservation branch also predates shared word-replacement synchronization.
Do not replace the current source wholesale with it. Reconciliation used
200d94856 as the shared source baseline, retaining subsequent word replacements
and background processing while restoring the earlier Voice feature changes.
The legacy privacy acceptance fixtures now explicitly mark pre-action-protocol
records; modern send/no_action cloud behavior remains covered independently.
Physical background inference remains an outstanding device acceptance check.
