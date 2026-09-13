# Native iOS source preservation — 2026-09-13

Two divergent source versions must be reconciled before the next full-featured
phone build. A newer directory timestamp did not establish feature completeness.

## Current development branch

`codex/word-substitution-sync-current` contains shared word replacements plus the
new continued background transcription implementation, its 43 passing targeted
tests, and the corrected Field Theory / Preparing voice model UI copy.
The signed iPhone build passes. Background inference on the phone remains unverified.

This branch currently lacks the prior Auto-send feature and related Voice UI.
The earlier background-transcription candidate installed on Focus was built from
this branch before the name/copy correction; it omitted those prior features.

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
Do not replace the current source wholesale with it. Reconcile its feature changes
with the current background transcription and word replacements, then run the
combined behavior tests and physical-device checks. Saving both branches is not
itself that reconciliation.
