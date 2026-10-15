# Field Theory Mac 0.3.72 release verification

Published October 14, 2026: https://github.com/afar1/field-releases/releases/tag/v0.3.72
Website: https://fieldtheory.dev
Source branch: `afar1/fieldtheory-labs:codex/release-0.3.72`.

Release source: `f0ce28c00`, based on published 0.3.71. Website source: `d88bc0c01`.

Bookmark, Library, reading, wiki, and tagged-document watchers use native directory events via @parcel/watcher instead of Chokidar's per-file descriptors. The shared adapter preserves filtering, depth, write stability, ready reconciliation, and awaited shutdown. Native subscription startup/shutdown is serialized so disappearing roots cannot interfere with another subscription's backend. The existing screenshot handler can launch screencapture again without descriptor exhaustion. Chokidar and its vulnerable legacy dependency chain are absent from production dependencies.

## Runtime evidence

- Reproduced the original macOS failure independently: spawning a process succeeds, fails with EBADF after opening 35,000 descriptors, and succeeds again after closing them.
- Read-only probe of the actual bookmark, Library, and Librarian caches: 46,446 files. Final packaged Electron watcher added zero numeric file descriptors; process launch succeeded. Startup took 695ms in this probe.
- Running full app dropped from approximately 35,000 descriptors to 82-86. Andrew confirmed Command-4 opens the selection crosshair on the first verification build and menu-bar Take Screenshot opens it on the final build.
- Packaged native runtime checks exercise SQLite, terminal spawning, and delivery of an actual native filesystem event from the packaged watcher binary.

## Release gates

- Both Mac TypeScript checks passed. The final full run passed 3,620 tests and skipped three, with one failure in the existing warmed-launcher latency budget under concurrent load. All five launcher-file tests passed on isolated rerun. The new watcher tests and all watcher-manager checks passed in the full run. No test limits were changed.
- Production npm audit: zero vulnerabilities. Release channel, tracked-source, package safety, public auth configuration, and compiled require guards passed.
- Signed app and ZIP app passed signature/staple/Gatekeeper and native-runtime checks. ZIP and DMG app payload manifests match the signed staging app (919 entries, including file hashes, modes, and symlink targets). DMG disk-image integrity passed.
- Historical launcher/paste performance budget overruns remain in quality-baseline evidence; this release verifies watcher resource usage and screenshot startup, not a fresh overall performance qualification.
- Signed outer DMG notarization `071f1e93-db72-421b-802e-34ad160cabbf`: Accepted. App and DMG staples validate; Gatekeeper accepts both as Notarized Developer ID.
- All five GitHub assets have identical local/remote sizes and SHA-256 digests. Public latest updater YAML equals final staged metadata; both binary range downloads returned HTTP 206 and bytes matching local assets.
- Production website deployment `dpl_Byo6FVYXLDtSLt1Kr4YAjgE9JwXF` (https://fieldtheory-2tklsxf5w-afar1.vercel.app) promoted after publication. Live HTML equals staged source and both download buttons target 0.3.72.
- The final running verification build recorded zero native watcher errors, EBADF errors, or screenshot launch failures. The /Applications installation was not replaced; verification used the signed staging app with the existing cache. An installed updater transition was not tested.

## SHA-256

```text
0fd11c8bd0e4332fdf566536520382fb782a3a3959a3f312234d22178080ff96  Field.Theory-0.3.72-arm64-mac.zip
02ae1ed22c49f05675fa1db143ef0b2b4cfc4dc87e0186a4060eeae5232e8432  Field.Theory-0.3.72-arm64-mac.zip.blockmap
c94f5943c05c551af1d5a852680a232e24e0f82c329d22d03ccacd1916a5553e  Field.Theory-0.3.72-arm64.dmg
8b8f5fd5a3314b062090a581ad6b282b05552c7b81759005ac31f5dd0b79ab97  latest-mac.yml
```
