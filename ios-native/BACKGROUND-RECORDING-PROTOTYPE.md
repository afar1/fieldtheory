# Field Theory Action button recording prototype — build 18

This build tests starting actual microphone capture without presenting Field Theory.
It adds a manually selected App Shortcut, AudioRecordingIntent + LiveActivityIntent,
and a WidgetKit Live Activity with timer and Stop controls. Installation does not
change the user's Action button assignment. The production opt-in setting is deferred
until device testing establishes that this works.

## Device test

1. Open Field Theory once. Confirm sign-in, microphone permission, and downloaded voice model.
2. In iPhone Settings → Action Button → Shortcut → Choose a Shortcut, select
   Field Theory's “Record in background” (the action is “Start recording in background”).
   If necessary, create a shortcut containing that single Field Theory action.
   Do not use an “Open App” action.
3. Switch to another app. Hold the Action button and speak a distinctive 10-second sentence.
   Confirm Field Theory does not appear, the microphone indicator appears, and the
   Dynamic Island timer advances.
4. Hold the Dynamic Island to expand it, then tap Stop. Open Field Theory and confirm
   that the saved transcript contains the spoken sentence.
5. Separately repeat while locked, then after terminating Field Theory. Report each
   case independently; success in a warm process does not establish cold-start success.

## Evidence and limits

Signed device build succeeded with Xcode 26.1.1. Simulator suite: 133 unit tests,
1 physical-only skipped, 0 failures; 2 Auto-send/layout UI tests passed. New tests
cover headless transcript persistence, recorder replacement/workspace rejection,
and rejecting disabled intent capture without touching the microphone.

Physical microphone capture, staying in the prior app, and locked/cold-start behavior
are pending user testing. Installation is not runtime proof. On-device diagnostics
are in Documents/VoiceDiagnostics/background-recording.json (event timestamps,
application state, elapsed time, pending count, errors; no audio/transcript content).
UIApplication state values: active 0, inactive 1, background 2.

Stopping in the background retains the existing finite transcription allowance;
if inference cannot finish, durable queued audio resumes when Field Theory opens.
This prototype does not establish unlimited background Parakeet processing.

AppModel owns persistence before any scene appears; the UI only installs toast
presentation. Existing Auto-send preferences and word substitutions are preserved.
The shared AppModel ensures foreground UI and intents use the same recorder.

## Build 19 follow-up

Build 18 device tests failed twice while UIApplication was background (state 2),
before microphone start: “Session activation failed.” No recording was captured.
The localized error alone did not preserve Apple's numeric reason code.
Build 19 changes only intent capture to a mixable playAndRecord session, testing
whether background nonmixable-session activation caused the refusal. Foreground
recording retains its original audio policy. Failed starts now preserve NSError
domain/code and deactivate the failed session. This is a hypothesis under device
test, not proof that iOS permits cold background microphone activation.

## Build 20: recording controls and foreground fallback

Build 19 user test passed session activation but AVAudioRecorder.record() returned
false ("The microphone did not start recording"). Background-only microphone start
remains unproven; do not describe the shortcut as reliable.

Settings → Start recording on open is persisted and defaults OFF. When enabled,
a foreground opening from launch/background starts capture after local storage is
ready, provided there is no active recording/transcription or queued audio. An
inactive/active transition for a permission dialog does not count as another open.
Configure the Action button to Open App → Field Theory to test this fallback.

Every foreground recording gets a Live Activity when allowed. The app has a separate
circular X during capture; the Live Activity has X with an inline confirmation.
Both use the question "Are you sure you want to discard this audio?". Discard targets
only the active capture and rejects stale confirmations; older queued recordings
remain intact. The completed Live Activity says "Transcribed" with a checkmark only
when a transcript was saved. Pending/no-speech outcomes do not get a success check.

Transcript persistence now awaits the sync attempt inside the completion callback,
keeping the existing execution allowance through upload. Durable dirty rows retain
retry behavior. Auto-send capture cutoff and No action behavior remain preserved.
Read-only device flags showed the newest saved transcript acknowledged and sent;
an older No action item predates the current Auto-send enable timestamp. No older
transcripts were released or modified.

Validation: full unit suite and Auto-send UI regressions passed; a dedicated UI test
started recording, kept it through cancellation confirmation, then discarded it
and confirmed no pending retry audio. Real phone Live Activity controls, start-on-open,
and end-to-end background delivery remain device acceptance checks.

## Build 21: authenticate on device before background start

The Start intent explicitly requiresLocalDeviceAuthentication. This delegates
unlock to iOS (Face ID/passcode when locked) without intentionally foregrounding
Field Theory. The compiled App Intents metadata confirms explicit authentication
policy 2 and openAppWhenRun false. This is an unlock requirement, not a guarantee
of microphone access or a forced Face ID scan on every unlocked invocation.

The expanded Island/Lock Screen layout now uses a compact title/timer header and
one horizontal control row: separate 44-point circular X and a wide Finish button.
Confirmation uses a separate multiline question above Keep recording / Discard.
Finish means stop and transcribe; it honors Auto-send. Finish carries the activity
identifier so a stale control cannot stop a newer capture. The compact Island's
standard iOS gestures remain: tap opens app, touch-and-hold expands controls.
Apple supplies no supported first-tap-expand override.

Diagnostics include build, protected-data availability and uptime; protected-data
availability is not an exact screen-lock or Face ID authentication signal.
Interactive simulator visual inspection was blocked by the locked Mac.

Acceptance: with Start recording on open OFF, keep the background recording shortcut
assigned. Try unlocked Home Screen first, then locked with Face ID unobstructed,
then cancel authentication while locked. The first two should record; the cancelled
authentication case should not. Finish or discard each recording using expanded
Island controls before the next trial. Repeat locked/unlocked once if successful.
Report whether authentication appeared, whether Field Theory opened, and whether
actual speech was captured. An unlocked success does not establish locked success.
