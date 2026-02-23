# Hot Mic / Transcriber Coordination

## Why This Exists

Both Hot Mic (orange dot) and push-to-talk recording (red dot) share the same native recording engine.
Without explicit coordination, they can race each other and cause:

- `Recording already in progress` errors
- missed resumes after handoff
- overlapping Qwen server requests

## Recorder Ownership Rules

### 1. Hot Mic is the default owner while active

- Hot Mic runs in `listening` mode and keeps native recording alive for chunk harvesting.
- It only resumes after manual transcription if it previously yielded ownership.

### 2. Push-to-talk explicitly asks Hot Mic to yield

- `TranscriberManager.startRecording()` calls `hotMicDelegate.yieldToTranscriber()` before recording.
- Hot Mic:
  - stops local listeners/timers
  - cancels native recording
  - marks `yieldedToTranscriber = true` only after successful cancel

### 3. Idle transition only triggers meaningful resume

- `TranscriberManager` still calls `resumeAfterTranscriber()` on transition to `idle`.
- Hot Mic now no-ops unless `yieldedToTranscriber` is true.
- This prevents false resume attempts for flows that never took recorder ownership (for example silent stacking transitions).

### 4. Native helper tracks recording truth

`NativeHelper` now tracks `recordingActive` from helper messages and exposes:

- `isRecordingActive(): boolean`

Hot Mic uses this to avoid duplicate `startRecording()` calls and recover if recording is already active.

## Qwen Concurrency Rule

Qwen server communication is line-based with a single pending response resolver.
To prevent response collisions, `TranscriberManager` now serializes commands:

- `sendQwenCommand()` enqueues into `qwenCommandChain`
- only one command is in flight at a time
- queue continues even if one command fails

This applies to all callers, including shared use by Hot Mic via `transcribeAudio()`.

## Background Voice Filtering (User-Tunable)

Hot Mic now supports an optional chunk-level background voice filter before transcription:

- `hotMicBackgroundFilterEnabled` (default `false`)
- `hotMicBackgroundFilterStrength` (0-100, default `4`)

Behavior:

- Audio levels are tracked per harvested chunk.
- When filtering is enabled, weak/far-field chunks can be suppressed before they hit Qwen/Whisper.
- Strong sustained near-field speech still passes through.

User controls:

- **Settings → Hot Mic**: toggle + strictness slider.
- **Dynamic Island history panel**: "voice tuning" drawer with:
  - same toggle + slider
  - live incoming vs accepted level meters
  - threshold and speech-ratio readout

## Primary Validation Signals

### Healthy handoff

- one yield log
- one resume log
- no repeated `Recording already in progress`

### Healthy Qwen queueing

- concurrent transcription requests do not clobber each other
- second request starts only after first resolves/rejects

## Relevant Tests

- `electron/main/hotMicManager.test.ts`
  - handoff resume only after yield
  - skip restart if helper is already recording
- `electron/main/transcriberManager.test.ts`
  - serialized concurrent Qwen commands
  - queue progression after write failure
