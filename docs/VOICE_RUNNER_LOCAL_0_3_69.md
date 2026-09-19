# Field Theory 0.3.69 — Voice delivery recovery

Local notarized Mac installation. No source push, public release, or website update.

## Release notes

- Voice requests can keep starting when inbox delivery updates stall.
- Improved recovery when the Voice inbox is busy or stops responding.
- Requests that cannot be routed now show that they need attention instead of staying at Received by Mac.

Release date: September 19, 2026.

## Source and behavior

Based on the exact installed 0.3.68 source, `2c0124bc3`, preserving its realtime connection cleanup fix and clipboard UI. Runner recovery was cherry-picked as `3b6950795` from the reviewed local change `59862ce7d`.

Optional inbox receipts no longer delay claims, routing, dispatch, or publishing durable outcomes. Receipt retries have a separate timer and deduplicate in-flight attempts. Uncertain receipts remain saved without duplicate replay; repeated optional failures cannot indefinitely hold up later receipts.

A busy inbox or persistent decision that exceeds 15 seconds falls back once to a fresh tool-disabled private decision with bounded history. Destination validation, account boundaries, job leases, and existing concurrency controls remain intact. Exhausted routing timeouts publish a needs-attention outcome before any task is dispatched.

## Validation and installation boundary

The original runner change passed 178 focused tests, Electron TypeScript compilation, and independent review. This release source needs its own verification, normal packaging, signing, Apple notarization, stapling, and Gatekeeper checks before installation. The local-install command also requires healthy Secure Keyboard Entry, a clean application quit with no remaining child processes, a recoverable backup, and installed-app launch/quit/hotkey verification.

Record final package and runtime evidence after those steps. Preparing this file does not establish installation or successful end-to-end delivery.

## Local release validation

The exact installed 0.3.68 source was recovered at 2c0124bc3 and used as this release base. All 240 test files passed (3,614 tests passed, three skipped), both TypeScript checks passed, production audit reported zero vulnerabilities, package/source/channel guards passed, and Electron require verification passed.

The strict quality summary remains nonzero on pre-existing installed-app traces: launcher load 298.2 ms, hotkey-to-hidden 21,726 ms, first-input-to-close 20,458 ms, invoke-to-success 2,841 ms, filter 100.9 ms, clipboard results 658.9 ms, and recording paste 640 ms exceed their budgets. This candidate had not been launched when those historical samples were read. No thresholds or evidence were altered. The authorized local runner recovery proceeds with these existing performance limitations explicitly retained; this is not a public release or performance qualification.

Verification log: /tmp/fieldtheory-0369-verify.log. Native helper and diarizer release builds also passed.

## Installed result

0.3.69 was installed and reopened from /Applications/Field Theory.app on September 19. The app and exported DMG passed Developer ID signatures, Apple notarization/stapling, and Gatekeeper. DMG notarization: 9da2008f-8653-4f77-8e7f-71c8c000cb46. Mounted DMG and ZIP payloads matched the notarized app. One normal menu quit stopped the main process and all child processes; LaunchServices also reported it stopped. Relaunch and the visible 0.3.69 version were confirmed.

Artifact: /Users/afar/dev/fieldtheory-runner-local-evidence/local-release-0.3.69/Field.Theory-0.3.69-arm64.dmg
Evidence: /Users/afar/dev/fieldtheory-runner-local-evidence/local-release-0.3.69/installation.json
Backup retained: /Applications/.FieldTheory-backup-0.3.68-20260919T204702Z.app

Runtime routing proof at 20:51:44 UTC: job 9c5ac43d-839e-4e83-82e1-786edbabe10d cleared its routing error, started Codex turn 01a0bb6e-a2fd-7243-9d0d-c6815ff957ce at 20:49:45, asked for clarification, and published needs_user. Job b67c5316-2891-4f39-9381-5e7c7254608e was accepted into this active task's queue, but restart reconciliation was uncertain; it published needs_user without replay. Both now have published outcomes. The first needs task reconciliation; these observations do not mean both requests' substantive work finished.

Global launcher and recording shortcut attempts did not produce Field Theory events while Secure Keyboard Entry remained active in ChatGPT (live PID 33839). Keyboard protection was not disabled; recording-hotkey runtime acceptance remains unverified. Backup retained. No public release, source push, or artifact publication occurred.
