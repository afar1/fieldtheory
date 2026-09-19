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
