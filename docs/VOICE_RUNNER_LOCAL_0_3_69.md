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
