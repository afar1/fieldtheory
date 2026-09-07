# Field Theory Voice local DMG preview

Candidate version: **0.3.47-voice.1**. This local preview is based on the released 0.3.46 source (`5101e545d`), isolated in `codex/voice-event-delivery`. It retains the released explicit bookmark sign-in fix. The currently installed 0.3.45 source was independently verified as `de07567a2`. Original checkout changes remain untouched.

## Approved release notes

- Preview Voice requests in Settings: connect Codex and choose the folder it may work in.
- Read the latest voice task result or clarification in Field Theory.
- Automatic requests require the new voice delivery service to be activated; this local preview does not enable it.

These exact notes are drafted in `mac-app/src/components/ReleaseNotesPopup.tsx`, together with the version/date entries. No public release, hosted SQL, or production activation is authorized.

The user confirmed these exact notes on September 7, 2026. The latest explicit instruction is **DMG file only: the user will install it themselves**. Earlier installation authority is revoked. Do not install, replace the installed app, mount the candidate DMG, or launch the candidate. No installation, app replacement, candidate mounting, or candidate launch has occurred.

Build through the normal package guards, native compilation, signing and notarization with `--publish never`, `--config.publish=null`, and the documented intentional local branch override. Build the app directory, then create the DMG from a staging folder with `hdiutil create -srcfolder`, avoiding an explicit image attach for authoring or verification. Sign/notarize/staple the DMG and verify it without mounting. Apple notarization is authorized; no GitHub pushes, PRs, releases, artifact uploads, updater publishing, or other public distribution are authorized. Do not launch development Electron, strip quarantine, disable Gatekeeper, or retry a macOS-blocked application.

## Scope of verification

Local source checks and a real installed-Codex arithmetic request have passed. The new hosted migration is prepared but unapplied. Until an authorized hosted canary verifies private WebSocket delivery from an actual synced phone transcript, automatic phone-to-Codex operation remains unverified. Lock state during the final runner smoke was false; locked-screen behavior remains pending.

Direct development Electron attempts were stopped after the user reported macOS malware-blocked notifications. Their cause has not been established. Any future runtime verification must use the approved packaged local installation and stop if macOS blocks it.

## Delivered artifact

The final local DMG is `mac-app/release/Field-Theory-0.3.47-voice.1-arm64-local.dmg` (Apple Silicon, 186,468,609 bytes). SHA-256: `d4fbeecb715e1dfedf6659da7d649701cd901786c9a04c7944dafcb1d572d424`.

App and DMG passed Developer ID signature verification, notarization-ticket validation, and Gatekeeper assessment as Notarized Developer ID. `hdiutil verify` passed without mounting. The archive passed 19,366 file hash checks and 170 JavaScript syntax checks; the packaged Voice modules exactly matched their compiled source. Following the rebase onto 0.3.46, 139 relevant Mac tests and type checks passed. The backend has 20 passing database tests.

The receipt is `mac-app/release/local-verification-0.3.47-voice.1.json`. No installation, replacement, mounting, candidate runtime launch, GitHub distribution, hosted migration, or automatic delivery activation occurred. The user will install and test the app. The stopped fixture-runtime harness was not rerun.
