# Field Theory Mac 0.3.72 release verification

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
- DMG notarization, uploaded assets, and live website receipts will be recorded after publication.
