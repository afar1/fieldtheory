# Voice delivery timeline — native build 14

Native baseline preserved from the latest `worktrees/ios-background-sync/ios-native` source, retaining Ambition branding, Parakeet, privacy controls, and account safeguards. App identity remains `com.afar1.fieldtheory`; marketing version 1.0, build 14.

Voice cards show confirmed delivery stages. Tapping opens timestamps, delays, timestamp origin, terminal failure/needs-user summaries, Mac observations, and separate heartbeat/state freshness. A cloud `running` row without a confirmed turn is never called Working. Current text revisions are isolated. Terminal evidence dominates partial older data and clock ordering cannot regress the stage.

Private `voice_delivery_changed` broadcasts invalidate foreground receipt reads. Foreground catch-up runs every 30 seconds and on reopening. Failed subscriptions retry on that bounded interval. Sign-out/background cancels the subscription; account fences reject stale responses. Queries cover the most recent 200 notes; opening any older note fetches its own bounded history without discarding other timelines. New tables are optional until the reviewed migration is activated; existing agent receipts continue to work independently.

## Verified locally, September 9, 2026

- 6 delivery contract tests, 14 existing Voice sync tests, and 1 simulator UI test passed (21 total).
- Final stage-order change was rechecked with all 6 delivery tests.
- iPhone 17 Pro Max simulator screenshot inspected; synthetic data only.
- Fresh device build succeeded and passed `codesign --verify --deep --strict`.
- Device app: `build-timeline/Build/Products/Debug-iphoneos/FieldTheory.app`.
- Signature: Apple Development, team `3244UJ94D8`; build 14, standard bundle identity.
- UI image: `verification/delivery-timeline-final/88C20B5C-799A-4B48-AB6F-4236675B18FE.png`.
- Test result: `build-timeline/Logs/Test/Test-FieldTheory-2026.09.09_16-53-56--0700.xcresult`.

The database migration is not applied. No app was installed on a physical device and no real account was used in UI tests. Realtime production delivery and phone-to-locked-Mac verification require the coordinated rollout; simulator evidence does not establish them.
