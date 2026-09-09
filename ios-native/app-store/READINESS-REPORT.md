# Voice-only iOS readiness — September 6, 2026

The launch scope is **Voice and Settings only**. Library, River and Goals have
no public routes. The earlier 1.0 (2) candidate is superseded by **1.0 (3)**.

## Implemented and verified

- Native recordings save locally and immediately schedule authenticated uploads.
  Library/River work no longer delays Voice. The phone never imports remote
  clipboard or transcript history.
- Uploads carry native-phone provenance, ordered stack segments, monotonic edit
  clocks and soft deletions. Concurrent edits remain queued until acknowledged.
  Offline retries, finite background execution and account-switch fencing are
  covered by native tests.
- The Mac receiver adds native-phone recordings to existing clipboard history
  and reconstructs stacks. New incoming batches put the newest item on the
  system clipboard once. Initial history backfill preserves the current
  pasteboard. Realtime notifications have a 10-second polling fallback, with
  missed-update catch-up independent of realtime arrival order.
- The existing clipboard picker and portable-command clipboard input consume
  the same history and stacks. The registered Mac shortcut is Command-Shift-K.
- Stack edits preserve segment boundaries and update merged text consistently.
  Save/stack success feedback waits for persistence. A reproducible lazy-list
  crash when stacking was fixed and the UI regression passed.
- Voice-only reviewer demo, Settings, privacy metadata and iPhone/iPad listing
  screenshots are updated. Existing ambiguous notes from earlier bidirectional
  builds are preserved; see the acceptance document for the provenance limit.

## Evidence

| Check | Result |
| --- | --- |
| Native unit suite | 57 passed |
| Phone submission/stack UI suite | 3 passed |
| iPad submission/stack/layout UI suite | 5 passed |
| Final Mac receiver/materializer suite | 12 passed, including Swift-generated payload |
| Existing Mac launcher/clipboard suites | Passed during receiver integration |
| Mac Electron compilation and renderer bundle | Passed |
| App Store metadata and live URL validation | 2 files valid, no errors/warnings |
| Voice-only screenshots | JPEG, 1320x2868 iPhone and 2064x2752 iPad |
| Signed iOS Release archive | Passed archive and strict signature verification |
| Signed Mac local test package | Passed strict signature verification; not notarized |

Native unit evidence is in `/tmp/fieldtheory-voice-only-integrated-tests.log`.
That first combined run exposed UI issues; the corrected UI evidence is in
`/tmp/fieldtheory-voice-only-phone-ui-final.log` and
`/tmp/fieldtheory-voice-only-ipad-ui.log`, both successful.

## Candidates

- iOS: `/Users/afar/dev/fieldtheory-ios-candidates/1.0-3-voice-only/candidate.json`.
  Source `a7af2fabe38b625a0bc1f71af5699b6218bb6b68`, embedded `a7af2fabe38b`.
  Development-signed 1.0 (3), not an App Store export.
- Mac: `/Users/afar/dev/fieldtheory-mac-ios-voice-clipboard/mac-app/release/Field Theory-0.3.45-arm64.dmg`.
  Runtime source `79e949dcd95d110d328f3b16ce16d39ea46d1252`.
  DMG SHA-256 `fdcd5f4a60fd0e155593a55d28f88317b6f042a24fa47f4d761d465bea83a164`.
  Later commit `a65eb0850` adds only the Swift fixture and its test.

Neither candidate was installed. The running Mac 0.3.33 does not include this
receiver. Neither branch was merged or deployed. App Store upload/submission
was not performed. Later readiness-document updates do not alter these binaries.

## Remaining release gates

1. When the user returns home, install both test candidates and run
   [phone-to-Mac acceptance](../../docs/IOS_VOICE_DELIVERY_ACCEPTANCE.md), including
   recording, stack/edit/unstack, pasteboard, Command-Shift-K, offline recovery
   and account isolation. Physical microphone and actual delivery latency have
   not been verified by simulator or transport tests.
2. Obtain approval to deploy the prepared `delete-account` backend fixes and
   verify them with a disposable account. Those earlier fixes remain local.
   River moderation deployment is no longer needed for this Voice-only release.
3. Configure App Store Connect authentication, app record, distribution signing,
   agreements, privacy answers, age rating, listing and reviewer access.
4. Obtain explicit approval before any upload or submission. The Mac local test
   installer also needs normal release notarization before public distribution.
