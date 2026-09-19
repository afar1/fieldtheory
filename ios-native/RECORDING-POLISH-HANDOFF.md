# Field Theory — iOS recording polish handoff

Prepared September 19, 2026 for a later authorized phone build/install.

## Local source

- Standalone repository: `/Users/afar/dev/fieldtheory-ios-local` (its own `.git` directory, not a linked worktree).
- Branch: `codex/ios-recording-polish`.
- Starting point: build 45, commit `506260299`.
- The main `/Users/afar/dev/fieldtheory` checkout and its unrelated dirty Mac files were preserved.
- Generated Xcode project retains the build-45 checkout's `Package.resolved`, including FluidAudio 0.15.6. No dependency upgrade was intended.

## Changes

- Restored the compact red recording pill, elapsed time, measured waveform, and white stop square. VoiceOver announces “Stop recording”.
- Startup remains a compact pill with “Starting…” until the microphone actually starts. The layout no longer expands to a 68-point status card before recording.
- Reworked the initial 150 ms transition into a continuous 320 ms spring morph after phone feedback: the Record pill keeps its center and height, widens from 124 to 168 points, and changes to red. Label fades are staged to avoid overlapping text; the cancel control fades in separately after the morph. Reduce Motion skips animation and the reveal delay.
- Recording Live Activities end with immediate dismissal when processing returns, instead of remaining interactive for five minutes or leaving an ended Lock Screen card for 30 seconds. A finite background allowance covers the asynchronous end call.
- Completed activities left by older builds are dismissed when the app becomes active. Starting, recording, and transcribing activities are excluded from this cleanup.
- Removed the duplicate “Saved to Field Theory” success toast. The existing brief in-control transcription confirmation still expires after 1.2 seconds.
- Removed the persistent completed-activity Copy/Send surface. Saved transcripts remain available for those actions in Voice; recording-time Stop/Send actions remain unchanged.
- Audio-session configuration, microphone retries, Action Button intent startup, transcription runtime, privacy and delivery logic are unchanged.

## Verification

- 25 focused unit tests passed: BackgroundRecordingTests, RecorderControllerTests, VoiceContinuedProcessingTests.
- UI test passed: compact stop control, cancel/keep/discard flow, VoiceOver label, and target geometry.
- UI test passed: recording -> fixture transcript saved -> Record restored, without a duplicate success banner.
- UI tests use the existing simulator recording-controls fixture. They do not prove real Parakeet inference or phone background behavior.
- Simulator build and unsigned generic iOS compilation passed. No device installation, TestFlight upload, publication, or deployment was performed.
- `git diff --check` passed.
- Unit/completion result: `/Users/afar/dev/fieldtheory-ios-local-build/Logs/Test/Test-FieldTheory-2026.09.19_09-54-33--0700.xcresult`.
- Stop-control result: `/Users/afar/dev/fieldtheory-ios-local-build/Logs/Test/Test-FieldTheory-2026.09.19_09-51-22--0700.xcresult`.
- Screenshot: `/Users/afar/dev/fieldtheory-ios-local-evidence/82A07AA0-D32E-4E6E-A353-5CFB2DF29686.png`.
- Build log: `/tmp/fieldtheory-ios-local-device-compile-final.log`.

## Remaining limitation and phone acceptance

There are two different system surfaces. Our `RecordingActivityAttributes` activity is now dismissed immediately. iOS also creates its own Live Activity for `BGContinuedProcessingTask`. The existing runner reports full progress and calls `setTaskCompleted(success:)` when work finishes, but the installed iOS 26.1 SDK exposes no dismissal policy for that system-owned surface. No unsupported cancellation trick or background-runtime removal was introduced. Its post-completion presentation is not claimed fixed.

Apple reference: https://developer.apple.com/documentation/backgroundtasks/bgcontinuedprocessingtask

When Andrew requests installation at the office:

1. Use this standalone checkout, preserve local changes, regenerate with `xcodegen generate` inside `ios-native`, and build/sign for the confirmed phone. Use a new local build number rather than confusing the candidate with installed build 45. Do not change the TestFlight bundle/version for this local install.
2. Install and launch only after that request; preserve the existing application data/model.
3. Check foreground Record -> Starting -> red Stop timing on the phone. This change removes the UI expansion delay, not the underlying physical microphone-start delay.
4. Stop a normal recording with auto-send off/on. Confirm real transcription, local persistence, cloud delivery where enabled, and that the app-owned Dynamic Island/Lock Screen card disappears.
5. Repeat while backgrounded/locked and inspect the separate Apple-owned continued-processing completion indicator. If it persists, this remains a platform/architecture decision; do not sacrifice reliable background transcription silently.
6. Leave Action Button/hotkey diagnosis for the separately requested project. The previous build-45 investigation found AVAudioRecorder startup failures needing correlated device/OS logs; this patch does not attempt to fix them.

## TestFlight check (read-only)

Apple has approved external beta version 1.0.2 build 8. Live App Store Connect states: `VALID`, `APP_STORE_ELIGIBLE`, beta review `APPROVED`, external build `BETA_APPROVED`. The Field Theory Friends group includes build 8; its public link is enabled with a 50-tester limit. It expires December 12, 2026.

Public invitation: https://testflight.apple.com/join/wNAvHVu2

There were zero external testers at inspection. A real external install and runtime acceptance are still needed. The website continues to say it awaits Apple review and its live `invitation.json` has `acceptingTesters: false`. Updating that flag/site requires a separately authorized deployment. No new Apple submission is needed for build 8; these local polish changes are not part of that approved build.

## Animation follow-up after build 46

Build 46 was installed and launched on Focus on September 19. Andrew reported that the transition still felt abrupt and asked for Record to morph into the red pill before the cancel control appears.

The revision preserves the same Button and compact label layers across idle/start/recording, removes the transient “Starting…” layout replacement, and positions cancel as a separate sibling that cannot shift the primary pill. Startup still shows an inline spinner and announces “Starting recording” to VoiceOver; actual microphone startup is unchanged. Cancel appears after 320 ms with a 120 ms opacity fade and is removed completely once recording ends.

Both relevant UI tests passed (stop/keep/discard and completion returning to Record). Geometry assertions confirm identical horizontal and vertical pill center before/after recording and a wider stop pill. A final UI run also passed after staging the outgoing/incoming label fades: `/Users/afar/dev/fieldtheory-ios-local-build/Logs/Test/Test-FieldTheory-2026.09.19_10-06-45--0700.xcresult`.

Simulator frame inspection: `/Users/afar/dev/fieldtheory-ios-local-evidence/morph-preview/transition-frames.jpg` (before the final label-fade adjustment). The final screenshot is in `/Users/afar/dev/fieldtheory-ios-local-evidence/morph-final/`. Physical animation feel still requires Andrew's feedback; simulator geometry and screenshots alone do not establish device frame pacing.
