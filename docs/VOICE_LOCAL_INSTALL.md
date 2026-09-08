# Field Theory Voice local DMG previews

## Current status and next combined candidate

The user installed `0.3.47-voice.2`, then separately authorized backend activation. The installed app's push and real phone execution evidence is in [VOICE_PRODUCTION_ACTIVATION.md](VOICE_PRODUCTION_ACTIVATION.md). That later activation supersedes the deployment-pending status recorded at the time of the deliveries below.

The newly approved combined Inbox/routing/readable-conversation iteration is implemented in source. Its final integration SHA and a new signed/notarized artifact remain pending; neither earlier DMG contains those changes. See [VOICE_COMBINED_PREVIEW_SCOPE.md](VOICE_COMBINED_PREVIEW_SCOPE.md). No new package, installation, candidate launch, or device acceptance is claimed by this documentation update. The user will install an approved delivered preview themselves; do not infer app replacement authority from source implementation authority.

For the next authorized package, follow `~/.fieldtheory/library/Commands/local-install.md`, preserve its release-note and signing/notarization workflow, and record the exact integrated source and artifact hashes. Verify the new Inbox/router modules and task-link wiring in the archive. Do not launch development Electron or bypass macOS security. New installed Settings/Library, canonical task-link navigation, locked-screen, and sleep/reconnect acceptance remain separate observations.

## Historical preview delivery records

**Replacement delivered at that stage:** `0.3.47-voice.2` fixes the Library Settings readiness regression in the original preview. Use `mac-app/release/Field-Theory-0.3.47-voice.2-arm64-local.dmg`; see [repair and artifact verification](VOICE_SETTINGS_REPAIR.md). No agent installation or backend activation occurred during that delivery.

Candidate version: **0.3.47-voice.1**. This local preview is based on the released 0.3.46 source (`5101e545d`), isolated in `codex/voice-event-delivery`. It retains the released explicit bookmark sign-in fix. The then-installed 0.3.45 source was independently verified as `de07567a2`. Original checkout changes remain untouched.

## Approved release notes

- Preview Voice requests in Settings: connect Codex and choose the folder it may work in.
- Read the latest voice task result or clarification in Field Theory.
- Automatic requests require the new voice delivery service to be activated; this local preview does not enable it.

These exact notes are drafted in `mac-app/src/components/ReleaseNotesPopup.tsx`, together with the version/date entries. At that delivery stage, no public release, hosted SQL, or production activation was authorized.

The user confirmed these exact notes on September 7, 2026. The final delivery instruction for that stage was **DMG file only: the user will install it themselves**. Earlier installation authority is revoked. Do not install, replace the installed app, mount the candidate DMG, or launch the candidate. No agent installation, app replacement, candidate mounting, or candidate launch occurred during that delivery.

Build through the normal package guards, native compilation, signing and notarization with `--publish never`, `--config.publish=null`, and the documented intentional local branch override. Build the app directory, then create the DMG from a staging folder with `hdiutil create -srcfolder`, avoiding an explicit image attach for authoring or verification. Sign/notarize/staple the DMG and verify it without mounting. Apple notarization is authorized; no GitHub pushes, PRs, releases, artifact uploads, updater publishing, or other public distribution are authorized. Do not launch development Electron, strip quarantine, disable Gatekeeper, or retry a macOS-blocked application.

## Scope of verification

Local source checks and a real installed-Codex arithmetic request have passed. At that delivery stage, the hosted migration was prepared but unapplied. Automatic phone-to-Codex operation remained unverified until the later authorized hosted and phone observations recorded in the activation receipt. Lock state during the final runner smoke was false; locked-screen behavior remains pending.

Direct development Electron attempts were stopped after the user reported macOS malware-blocked notifications. Their cause has not been established. Any future runtime verification must use the approved packaged local installation and stop if macOS blocks it.

## Delivered artifact

The final local DMG is `mac-app/release/Field-Theory-0.3.47-voice.1-arm64-local.dmg` (Apple Silicon, 186,468,609 bytes). SHA-256: `d4fbeecb715e1dfedf6659da7d649701cd901786c9a04c7944dafcb1d572d424`.

App and DMG passed Developer ID signature verification, notarization-ticket validation, and Gatekeeper assessment as Notarized Developer ID. `hdiutil verify` passed without mounting. The archive passed 19,366 file hash checks and 170 JavaScript syntax checks; the packaged Voice modules exactly matched their compiled source. Following the rebase onto 0.3.46, 139 relevant Mac tests and type checks passed. The backend has 20 passing database tests.

The receipt is `mac-app/release/local-verification-0.3.47-voice.1.json`. No installation, replacement, mounting, candidate runtime launch, GitHub distribution, hosted migration, or automatic delivery activation occurred. The user will install and test the app. The stopped fixture-runtime harness was not rerun.
