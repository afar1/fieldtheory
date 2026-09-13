# Background Parakeet transcription

Stop recording and explicit Retry now request an iOS 26 continued-processing
 task. The scheduler's launch handler owns preparation and transcription, reports
FluidAudio inference progress through system UI, and marks completion after local
transcript delivery. A pending launch reserves the queue so foreground activation
cannot start the same work concurrently.

Automatic queue recovery does not create another user-visible task. If iOS
refuses the request, the existing foreground/finite-background-time path runs.
Granted continued tasks do not also start a finite UIKit background allowance.
Expiration cancels the worker and preparation waiter; existing queued audio is
retained. Core ML calls already executing may take time to observe cancellation.
This change adds no durable partial-transcript checkpoints.

The implementation uses the existing CPU/Neural Engine Parakeet configuration,
without requesting background GPU access. Device acceptance is required; a
simulator build and mocked scheduler tests do not establish background inference.
The installed SDK is iOS 26.1. Supporting future background inference entitlement
requirements is a separate compatibility check.

## Local validation

Generate the project with `xcodegen generate` in `ios-native`. Run the
`VoiceContinuedProcessingTests`, `RecorderControllerTests`, `RecordingSignOutTests`,
and `ParakeetModelTests` test suites. Build the iPhone target as well as simulator.

## Physical-device acceptance (pending)

Use the intended phone with the candidate installed and Parakeet downloaded.
Use synthetic speech, with cloud processing disabled for the acceptance recording.

1. Stop a long recording and switch to another app immediately. Observe system
   transcription progress and completion before returning. Verify one saved transcript.
2. Repeat with the phone locked, and with a cold model runtime.
3. Transcribe a short recording followed by a long recording; confirm the latter
   still reports intermediate progress.
4. Cancel through system UI; confirm audio stays available for explicit retry.

`VoiceBackground` logs record scheduler refusal, task start, and whether task
completion happened while the app was backgrounded, without transcript content.
Do not count completion after returning to the foreground as background proof.
