# Hotkey Recording Live Preview Plan (Deferred)

## Status

Deferred by product decision for now.  
Current behavior remains unchanged:

- Push-to-talk recording (red dot) transcribes on stop.
- Dynamic Island shows final transcript after transcription completes.
- No live/interim transcript stream during active push-to-talk recording.

## Goal

Add live/interim transcript text to Dynamic Island while push-to-talk recording is active, without changing final transcription correctness or paste/history behavior.

## Non-Goals

- Do not merge Hot Mic and push-to-talk recording architectures.
- Do not replace final transcript with preview transcript.
- Do not auto-paste or save preview text.

## Current Architecture Notes

- Push-to-talk path: `TranscriberManager.stopRecordingAndTranscribe()` performs one final transcription at stop.
- Hot Mic path: chunked continuous harvest + buffering in `HotMicManager`.
- Both can use the same configured transcription engine (`qwen` or `whisper`) via `TranscriberManager`.

## Risk Profile

Overall risk: **Medium** (higher if trying to unify full mechanics with Hot Mic).

Primary risks:

- Qwen queue contention between preview requests and final stop-recording request.
- Snapshot/stop timing races around recording lifecycle.
- UI churn from unstable interim text.
- Accidental leakage of preview text into paste/history/final output.
- Increased CPU/GPU/battery usage from frequent preview transcriptions.

## Proposed Implementation (Phased)

### Phase 1: Safe Preview Channel

1. Add a preview-only event path from main process to Dynamic Island (no clipboard/history/paste integration).
2. During `recording`, run a throttled preview loop (target 700-1200ms cadence).
3. Use rolling snapshots (`snapshotRecording`) for preview transcription only.
4. Keep final `stopRecordingAndTranscribe()` unchanged and authoritative.
5. Immediately stop preview loop on recording stop/cancel.
6. Clear preview text when leaving `recording`.

### Phase 2: Guardrails

1. Add session IDs so stale preview results are dropped after stop/cancel.
2. Apply backpressure so at most one preview request is in flight.
3. Prioritize final transcription over preview when recording ends.
4. Add feature toggle (default configurable) for controlled rollout.

### Phase 3: UX Polish

1. Smooth preview updates (debounce minor oscillations).
2. Distinguish preview visually from final transcript.
3. Add settings copy explaining preview latency and power tradeoff.

## Acceptance Criteria

1. While holding push-to-talk hotkey, Dynamic Island shows live/interim text updates.
2. Releasing hotkey still produces the normal final transcript/paste behavior.
3. Preview text is never stored in history and never auto-pasted.
4. Final transcription is not slower than acceptable thresholds under normal load.
5. No increase in recording lifecycle errors (start/stop/snapshot races).

## Test Plan

### Unit Tests

1. Preview loop starts on `recording`, stops on `transcribing`/`idle`.
2. Stale preview responses are ignored after session change.
3. Preview path never writes to clipboard history or paste pipeline.
4. Final transcription still fires exactly once per recording stop.

### Integration/Manual

1. Push-to-talk with short and long utterances.
2. Rapid start/stop sequences.
3. Qwen and Whisper engine variants.
4. Concurrent scenarios with Hot Mic enabled/disabled.
5. CPU/battery sanity checks with preview enabled for extended sessions.

## Rollout Recommendation

1. Implement behind a feature flag.
2. Enable internally first.
3. Collect latency/error telemetry before default-on.
