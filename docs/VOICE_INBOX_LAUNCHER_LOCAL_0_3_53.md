# Field Theory 0.3.53 — local production DMG

Source build: `bea63897ba9405e2364f1f134490606ebb6735f6` on `codex/voice-inbox-launcher-local`, based on the latest local production 0.3.52 source. Current upstream main `1e1d1afc3` is an ancestor. This is a regular checkout at `/Users/afar/dev/fieldtheory-local-preview`; the feature branch is also available in the original local repository. Unrelated root changes were preserved.

## Changes

- Voice inbox instructions show the original routing prompt verbatim and support editing, saving, and resetting to defaults. Saved text applies to subsequent routing decisions. Execution permissions and the default prompt are unchanged.
- Ordinary launcher typing searches across Field Theory regardless of the current section. Explicit folder navigation remains scoped. Commands are discoverable by name and by typing “commands”.
- The launcher restores its last selected section across reopening and renderer recreation. If that section is no longer enabled, it uses the first enabled section.
- Version and in-app release notes updated to 0.3.53.

## Verification

- Renderer/Electron typechecks and 256 targeted tests passed.
- Six browser-fixture checks passed using the actual React components: default visibility, save persistence, reset, command search from Inbox, outside-folder search, and Recents restoration. These used fixture APIs, not the installed app or live recording delivery.
- 9,352 archive file hashes and 180 JavaScript syntax checks passed before signing.
- 8,846 packed files and 435 compiled files matched after signing.
- Packaged Electron 31.7.7 / ABI 125 / arm64 directly loaded and exercised SQLite and terminal support; development fallback was rejected.
- Production identity `com.fieldtheory.app`, app and DMG signatures, Apple notarization, stapling and Gatekeeper passed. Disk-image checksum verification passed without mounting.

## Artifact

`/Users/afar/dev/fieldtheory-local-preview/mac-app/release/Field-Theory-0.3.53-arm64-local.dmg`

SHA-256: `781009f7eb89201844e7153254ee0b9f48527f3c8c76b90b4d7a2ed2a8fdc356`

DMG notarization: `e9faa1b6-3afd-48e6-88e7-c7f29cc2a297` — Accepted.

Detailed receipt: `mac-app/release/local-verification-0.3.53.json`.
UI fixtures/screenshots: `/Users/afar/dev/fieldtheory-local-preview-verification/`.

## Build notes

Used the Field Theory `local-install` command's production packaging process, with the user's explicit local-DMG-only boundary and authorization to write release notes. No installation or GitHub publication was performed. The installed app remains 0.3.52; the user will test this DMG.

The checkout has its own `npm ci --ignore-scripts` dependency installation. Electron was installed explicitly; electron-builder rebuilt native dependencies for its ABI. The npm node-pty prebuilt spawn-helper needed executable mode restored before packaging, and the native payload guard caught this before signing. Build used Node 24, `FIELD_THEORY_RELEASE_BRANCH_OVERRIDE=true`, and `npm run package -- --publish never`. GitHub token variables were removed from the build environment. Apple credentials were loaded without printing from the existing Oscar release checkout because the current Field Theory env files contained no Apple credentials. The DMG was separately signed, submitted, and stapled after the app package completed.
