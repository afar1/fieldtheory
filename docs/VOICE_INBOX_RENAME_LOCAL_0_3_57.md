# Field Theory 0.3.57 — Voice Inbox folder renames

September 9, 2026. Local production app for manual installation; no public release.

## Fix

Renaming the Library Inbox left existing Codex Voice tasks pointing to the old directory. The router omitted those tasks because their working directory no longer existed, then rejected the correct task selected from conversation history. A saved request could therefore remain pending despite Codex being available.

Confirmed projectless tasks created by the signed-in account's Voice worker can now follow the current Inbox. Recorded task and path lineage supports subsequent renames, and cached routes are checked before dispatch or recovery. Project tasks, unrelated tasks, account mismatches, and unrecognized origins do not gain this fallback. Existing sandbox, approval, dispatch ownership, and reconciliation rules remain unchanged. Folder rename remains supported user behavior.

Routing failures now retain an allowlisted local stage/code while showing a plain status message. Exception messages and arbitrary error codes are not copied into diagnostics.

## Evidence

- All 14 Voice suites passed: 234 tests, plus renderer/Electron typechecks. Coverage includes repeated renames during pre-dispatch and recovery retries, immutable path history, clarification-task provenance, account isolation, and refusal to reassign missing project folders.
- `mac-app/release/voice-inbox-rename-live-evidence.json`: a synthetic installed-Codex task answered `42`, its temporary Inbox directory was renamed, and continuation on the same task answered `43`. This exercised the real Codex runner using disposable fixture content; it was not a phone-to-installed-Field-Theory test.
- `mac-app/release/navier-routing-recovery.json`: route-only inspection of the actual previously blocked conversation selected its existing task and current Inbox directory. No substantive user request was dispatched and the live Inbox was not modified.
- Physical phone delivery and installed Field Theory UI acceptance remain unverified for this build.

## Local artifact

Packaging and notarization verification pending.
