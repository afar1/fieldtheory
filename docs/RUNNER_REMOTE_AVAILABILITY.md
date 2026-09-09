# Runner availability while away from the Mac

Research date: September 8, 2026. This change targets the same host availability conditions as ChatGPT Remote: the Mac is running, online, and able to execute local work while its display is off or locked.

## What ChatGPT does

The [official Remote connections guide](https://learn.chatgpt.com/docs/remote-connections) says remote access stops when the host sleeps, loses its network connection, or closes the app. It recommends keeping the host plugged in and enabling its keep-awake setting. A Mac laptop can remain reachable with its lid open and power connected; closed-lid use requires an external display. Choosing Sleep still stops remote access. Its secure relay supplies connectivity without exposing the host directly to the public internet.

Read-only inspection of the installed `/Applications/ChatGPT.app/Contents/Resources/app.asar`, version **26.901.51231**, build **8109**, corroborated this. Its power policy selects Electron's `prevent-app-suspension` assertion when remote keep-awake is requested and `powerMonitor.isOnBatteryPower()` is false. Its UI describes preventing sleep while plugged in and remote access is enabled. The implementation tracks screen locking separately from system suspension. These are observations of this installed version, not a stable integration API.

[Electron's powerSaveBlocker documentation](https://www.electronjs.org/docs/latest/api/power-save-blocker) specifies that `prevent-app-suspension` keeps the system active while permitting the display to sleep. The stronger `prevent-display-sleep` assertion is unnecessary for note delivery.

There is an open-source precedent: [Happy's daemon](https://slopus-happy-9.mintlify.app/cli/daemon) provides background remote session management, and its [caffeinate implementation](https://github.com/slopus/happy/blob/main/packages/happy-cli/src/utils/caffeinate.ts) starts the macOS `caffeinate` utility. Its broader process cleanup is not a pattern to copy; Electron can own and release our assertion directly.

Apple documents [sleep settings and wake for network access](https://support.apple.com/en-euro/guide/mac-help/mchlp2995/mac), but network wake for shared resources is not evidence of a general internet wake mechanism. Neither wake-on-LAN nor a private ChatGPT relay integration is needed for this improvement.

## Existing Field Theory path

The phone syncs eligible recordings into the existing hosted delivery system. `mac-app/electron/main/voiceWorkManager.ts` runs in the Electron main process, subscribes to delivery events, claims leased jobs, persists dispatch information, and recovers earlier attempts before reporting outcomes. `voiceCodexRunner.ts` discovers the installed Codex executable and runs or observes the requested work. `voiceInboxSync.ts` separately materializes transcripts and task links in the Library.

The main process already stops delivery on system suspension and reconnects on resume. Screen locking is a different event: the inspected code does not stop the Voice worker merely because the screen locks. The missing power assertion allows idle system sleep to interrupt an otherwise available runner. Network readiness after waking must also trigger recovery, rather than requiring a visible window or manual refresh.

This identifies an availability gap; it does not establish that every previously missed recording was caused by sleep. Transport, account, eligibility, and task-state failures remain separate causes.

## Selected minimal solution

- Hold an AC-only `prevent-app-suspension` assertion while Voice delivery is enabled and the user is signed in. Tie it to the runner lifecycle, and release it when disabled, signed out, on battery, or shutting down.
- Allow normal display sleep and screen locking. Keep delivery in the main process, independent of window focus and visibility.
- Reconcile on resume and recovered network connectivity through the existing delivery and receipt machinery. Preserve capture eligibility, leased ownership, and uncertain-dispatch recovery; waking must not create duplicate work or execute an older ineligible backlog.
- Explain the availability behavior in the runner interface. Use the existing authenticated transport and installed Codex runtime, without privileged helpers, global power-setting changes, public listeners, or private ChatGPT APIs.

## Limits

This prevents automatic idle sleep under the stated conditions; it cannot run local work while the computer is shut down, explicitly asleep, offline, or before a usable signed-in session exists. It does not promise closed-lid operation without supported external-display conditions. Work received during actual unavailability remains pending until recovery. Continuous availability beyond these limits requires an always-on host.

Background note pickup and command execution do not require an unlocked desktop. Tasks that need desktop interaction still depend on the underlying tool's permissions and locked-screen capabilities; this change does not add a lock-screen bypass.

## Verification

The feature branch `codex/runner-remote-availability` starts at the latest local 0.3.55 source, `8e1d08b7e`. Older uncommitted main-checkout work was preserved separately in `ab3fbd256`, without overwriting the newer release lineage. This candidate is version 0.3.56 with the normal production application identity.

### Actual locked-host execution

On September 8 at 22:50–22:51 Pacific, the latest compiled `runVoiceRequest` executed a synthetic request to calculate 17 + 25 without tools in an isolated temporary workspace. The I/O Registry reported `IOConsoleLocked=true` before and after. The runner recorded thread creation, a durable pre-dispatch callback, actual turn start, and a completed response of `42`.

- Thread: `01a084b8-3344-7c10-9fca-bfbef49e4ce2`
- Turn: `01a084b8-35ac-7de0-ad7a-eab5022e489e`
- Receipt: `mac-app/release/locked-runner-evidence-0.3.56.json`

This proves that the current installed Codex runtime can execute this runner's background request while the Mac is locked. It did not insert a recording into the user's Voice inbox and is not a physical phone-to-final-installed-app acceptance test. The machine was already on AC power with ChatGPT holding an idle-sleep assertion.

### Source checks

Power policy tests cover a single app-suspension assertion, screen lock, battery transitions, disable/sign-out, temporary network unavailability, true suspend/resume, and disposal. Delivery regression tests cover multi-minute subscription and RPC outages, catch-up without another event, replay avoidance, and no scans after recovery. Library sync recovery has independent regression coverage.

A development Electron power fixture was stopped before it could execute because the host moved its dependency application to Trash. The dependency was restored. No actual OS assertion from the new module is claimed from that attempted fixture; its lifecycle is covered by source tests, with the API choice corroborated by the installed ChatGPT implementation and Electron documentation.

All 212 relevant tests across 11 suites passed, as did renderer and Electron TypeScript checks and whitespace checks. The feature diff was reviewed for lifecycle races and unnecessary code. Package integrity, signing, notarization, and artifact receipt will be recorded after packaging. No hosted changes, app installation, or GitHub publication are part of this delivery.
