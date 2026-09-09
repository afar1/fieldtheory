# Voice delivery visibility

This feature extends the 0.3.58 runner on `codex/voice-delivery-timeline`. The latest native iOS baseline was preserved separately before timeline implementation. The database migration is prepared for review and is not applied to the hosted service by this work.

## User-visible contract

A recording distinguishes saved locally, uploaded, received by the Mac, accepted into the Codex queue, confirmed working, and terminal outcomes. A dispatch attempt alone does not establish that Codex started. A queued request is not completed work. Old clients or a server without the migration must remain usable without inventing unavailable events.

The recording's details show event times. Runner observations cover lock/unlock, sleep/wake, network state, connection state, and heartbeat freshness. Lock and network state may initially be unknown. Recorded-at (server receipt) and occurred-at (observed event) are distinct: delayed reporting cannot establish that the current Mac state matches an old observation. These diagnostics explain ordering, not causality by themselves.

## Rollout boundary

1. Review the additive migration `supabase/migrations/20260910001000_voice_delivery_timeline.sql` and its local database tests.
2. After explicit approval, apply the migration through the normal authenticated deployment path.
3. Install the prepared Mac and iOS builds.
4. Submit one disposable phone recording while the Mac stays locked. Confirm upload, pickup, queue/start as applicable, and completion against durable events. Repeat with a connection interruption and app foreground refresh. Do not resend an existing real request to test telemetry.

No hosted migration, app installation, or live user request replay is authorized by the preparation step alone. Physical phone acceptance cannot be claimed until the coordinated rollout test runs.

## Verification

- Mac: 263 tests across 15 focused suites passed; renderer and Electron TypeScript checks passed.
- Database: 30 PostgreSQL/PGlite tests passed, including ownership, lease fencing, exact event identity, timestamp provenance, delayed observations, and missing-start safeguards. Auth and hosted Realtime are local fixtures, not production delivery proof.
- iOS: 21 native sync, delivery-state, and simulator UI tests passed.
- iOS device candidate: version 1.0 build 14, bundle `com.afar1.fieldtheory`, signed with the existing Apple Development identity. Fresh output: `ios-native/build-timeline/Build/Products/Debug-iphoneos/FieldTheory.app`. Not installed.
- Reviewed simulator screenshot: `ios-native/verification/delivery-timeline-final/88C20B5C-799A-4B48-AB6F-4236675B18FE.png`. This uses synthetic records.

## Compatibility and recovery

Optional progress reporting does not block request execution when tables/RPCs are missing. The Mac persists queue/start observations and retries while the job lease remains valid. Completion can backfill explicit timestamps; it never fabricates a start from dispatch authorization. Runner reports use a bounded account-specific local outbox and an expected-owner server check. Timestamp source distinguishes actual Codex start from observation fallback.

The phone keeps legacy receipt support before migration, refreshes on foreground, and subscribes to content-free owner-private update hints. A bounded timer recovers missed updates; opening an older recording fetches that recording directly. Terminal state does not regress because a partial event query omitted later stages. Unknown initial lock state stays unknown. Network availability is not represented as proof that the worker is connected.

## Activation and rollback review

Applying the additive migration creates three owner-readable telemetry tables, two helper functions, two authenticated reporting RPCs, and one job trigger. Existing job dispatch rules remain unchanged. No historical request is executed or replayed. Diagnostic runner history is retained for 30 days; delivery history follows its job lifetime.

If rollout must be paused, keep or reinstall the previous clients; missing telemetry does not stop their existing delivery path. Remove the new trigger/functions/tables only after reviewing any diagnostic data that would be lost. Do not delete or reset `voice_jobs` or transcripts as a rollback step.

Local Mac signing/notarization receipt pending.
