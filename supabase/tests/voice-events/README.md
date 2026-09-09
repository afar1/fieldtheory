# Voice delivery backend tests

Run `npm ci && npm test` here. The suite loads the delivery and timeline migrations into PGlite (PostgreSQL in WASM), with local auth and Realtime fixtures. It tests SQL execution, lease fencing, owner isolation, idempotence, and explicit start evidence. It does not contact Supabase or verify hosted WebSocket delivery.

## Timeline migration review

`20260910001000_voice_delivery_timeline.sql` is additive and must be reviewed before hosted application. It does not enable delivery, execute backlog, change existing dispatch RPCs, or backfill historical events from ambiguous timestamps.

- `voice_delivery_events`: owner-readable events keyed by job and stage, with transcript ID and text revision. Upload, first claim, and terminal outcomes come from authoritative job changes. `dispatch_started_at` remains authorization to try dispatch; it never produces a `started` event.
- `voice_jobs_record_progress`: accepts `queued` and `started` against a current owner/generation/lease and the recorded thread. Actual start requires a turn ID. `time_source` distinguishes server timestamps, Codex-reported start times, and locally observed fallback times. Replays of an already recorded identical stage/thread/turn are safe after the lease ends. Conflicting or unrecorded stale-lease observations return `ok: false`.
- Completion can recover `queuedAt` and `startedAt` observations from the result if progress reporting failed. Only explicit ISO timestamps within the recording's plausible time window are used, and start also requires `turn_id`. Malformed optional observations do not discard the final result.
- `voice_runner_report`: owner-authenticated structured Mac observations. `p_expected_owner` fences a token/account change between capture and transport. Nullable booleans represent unknown state. History retains event time and server receipt time; delayed observations cannot overwrite newer presence state. Runner history is pruned after 30 days on the owner's next report. The latest presence remains and its timestamp must be interpreted as freshness, never continuous proof of availability.
- All client table writes are denied. New RPCs grant execution only to authenticated users. Timeline notifications use the existing private owner topic `voice-jobs:<user-id>`, event `voice_delivery_changed`, with no transcript, output, folder, or error details. Notification failure does not roll back observability records or execution.

A deployment smoke test must check owner-only private channel delivery and a real phone/Mac flow, including lock/sleep correlation. Until deployment, clients must tolerate missing tables/RPCs. A local passing test is not evidence that the hosted migration or phone update is active.
