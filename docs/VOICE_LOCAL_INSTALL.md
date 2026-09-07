# Field Theory Voice local preview

Candidate version: **0.3.47-voice.1**. This local preview is based on the released 0.3.46 source (`5101e545d`), isolated in `codex/voice-event-delivery`. It retains the released explicit bookmark sign-in fix. The currently installed 0.3.45 source was independently verified as `de07567a2`. Original checkout changes remain untouched.

## Approved release notes

- Preview Voice requests in Settings: connect Codex and choose the folder it may work in.
- Read the latest voice task result or clarification in Field Theory.
- Automatic requests require the new voice delivery service to be activated; this local preview does not enable it.

These exact notes are drafted in `mac-app/src/components/ReleaseNotesPopup.tsx`, together with the version/date entries. No public release, hosted SQL, or production activation is authorized.

The user confirmed these exact notes on September 7, 2026 and authorized the local build/install. Use the normal signed/notarized DMG packaging path with `--publish never` and the documented intentional local branch override. Do not launch development Electron, strip quarantine, disable Gatekeeper, or retry a macOS-blocked application.

Before replacement, verify signatures, stapling, Gatekeeper and Secure Keyboard Entry; request a normal quit and confirm all installed app processes exited. Stage the replacement on the Applications volume, preserve the existing app as a timestamped backup, and only then rename the candidate into place. The command requires an observed installed launch, clean quit, relaunch, real global shortcut, and recording start/stop before local installation is accepted.

## Scope of verification

Local source checks and a real installed-Codex arithmetic request have passed. The new hosted migration is prepared but unapplied. Until an authorized hosted canary verifies private WebSocket delivery from an actual synced phone transcript, automatic phone-to-Codex operation remains unverified. Lock state during the final runner smoke was false; locked-screen behavior remains pending.

Direct development Electron attempts were stopped after the user reported macOS malware-blocked notifications. Their cause has not been established. Any future runtime verification must use the approved packaged local installation and stop if macOS blocks it.
