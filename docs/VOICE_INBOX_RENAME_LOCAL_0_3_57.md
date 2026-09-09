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

Source commit: `5319415397bdf282d26676f2ad6918872601f59f` on `codex/runner-remote-availability`.

Artifact: `/Users/afar/dev/fieldtheory-runner-remote-availability/mac-app/release/Field-Theory-0.3.57-arm64-local.dmg`

SHA-256: `f27b6c65e6a51da8fb4adb4e194adf1be9d4cce94d737211826a076874671bcb`

Outer DMG notarization: `65e05868-708f-41b9-bc88-c756360fb2a8` — Accepted.

App and DMG signatures, Apple notarization, stapling, Gatekeeper, and disk-image integrity passed. Production identity is `com.fieldtheory.app`, version `0.3.57`, with updater configuration included. Verified 8,850 post-sign packed hashes and 439 compiled files against the source build. Before signing, 9,356 file hashes and 182 JavaScript files passed archive checks. Packaged Electron 31.7.7 / ABI 125 / arm64 directly exercised SQLite and PTY with development fallback rejected.

Receipt: `mac-app/release/local-verification-0.3.57.json`.

Built with the standard local production package process and `--publish never`, then independently signed/notarized/stapled the outer DMG. No Field Theory installation, GUI launch, user-request dispatch, push, or public publication occurred during packaging. Prior 0.3.56 local DMG retained.
