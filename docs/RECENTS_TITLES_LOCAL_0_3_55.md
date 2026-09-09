# Field Theory 0.3.55 — local production DMG

Source `13d088a1f71bc23c9b39562abbfaf7dbb13618e3` on `codex/voice-inbox-launcher-local`, regular checkout `/Users/afar/dev/fieldtheory-local-preview`.

## Fix

Recents resolved the current Library item but still rendered `entry.title` from saved history. It now prefers the current Library display title, falling back to saved history when no Library metadata exists. Search keywords include the current title. Existing Voice recent entries update without reopening recordings; file paths and routing behavior are unchanged. Includes all 0.3.54 changes.

## Verification

- 199 launcher tests and both renderer/Electron typechecks passed.
- Regression test covers a stale history title and current Library title, plus the selected row action.
- Actual React browser fixture confirmed current title in Recents and after renderer reload. Screenshot: `/Users/afar/dev/fieldtheory-local-preview-verification-0.3.55/recents-current-title.png`. No installed-app UI test was performed.
- 8,848 packed file hashes verified and 437 compiled files matched.
- Packaged Electron 31.7.7 / ABI 125 / arm64 directly exercised SQLite and PTY; development fallback rejected.
- App and DMG signatures, notarization, stapling, Gatekeeper, and disk-image integrity passed.

## Artifact

`/Users/afar/dev/fieldtheory-local-preview/mac-app/release/Field-Theory-0.3.55-arm64-local.dmg`

SHA-256: `0e43c5c3c94e7e4730431401c7ae6790b6f991eb9c9ad74366616e9e610ccba3`

DMG notarization: `c7ade041-92fe-4c19-a487-5adefe422952` — Accepted.

Receipt: `mac-app/release/local-verification-0.3.55.json`.

Built with the existing local production packaging process and `--publish never`. Nothing installed or pushed to GitHub. Installed app remains 0.3.54. Prior local DMGs preserved.
