# Field Theory 0.3.54 — local production DMG

Source: `34440bb1da351d074cacec47d2c9dc7a49563fbd` on `codex/voice-inbox-launcher-local`, in the regular checkout `/Users/afar/dev/fieldtheory-local-preview`.

The Library Inbox sidebar previously labeled recordings from their transcript openings, while the launcher used Library metadata. Both now use the same available, confirmed task title from the current account's recorded routing results. Recordings without saved task titles retain transcript previews. This is display metadata only: original note contents, paths, and routing behavior are unchanged. Includes the earlier 0.3.53 Voice Inbox instruction editor and launcher fixes.

## Verification

- 139 targeted tests and renderer/Electron typechecks passed.
- Tests cover owner isolation, confirmed dispatch, fallback titles, unchanged transcript bytes, immutable Library tree overlay, and launcher display/search.
- Read-only check of existing local data found 14 of 213 recordings matched available task titles. No live recording or agent work was started.
- 8,848 packed file hashes verified; 437 compiled files matched the build.
- Packaged Electron 31.7.7 / ABI 125 / arm64 directly exercised SQLite and PTY with development fallback rejected.
- App and DMG signatures, Apple notarization, stapling, Gatekeeper, and disk-image integrity passed.
- Installed app remains 0.3.53. No installation or GitHub publication performed.

## Artifact

`/Users/afar/dev/fieldtheory-local-preview/mac-app/release/Field-Theory-0.3.54-arm64-local.dmg`

SHA-256: `d20600e105857f452986f7b42a49812db942862b516872f0c317f001bca49b60`

DMG notarization: `e61e9e7a-f9be-47d5-a40d-dfa955b5de48` — Accepted.

Detailed receipt: `mac-app/release/local-verification-0.3.54.json`.

Built using the existing local production packaging command with `--publish never` and the local feature-branch override. The DMG was separately signed, notarized, and stapled. Prior 0.3.53 artifact preserved.
