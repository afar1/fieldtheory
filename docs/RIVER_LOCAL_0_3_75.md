# Field Theory 0.3.75 local River candidate

Local-only build based on the installed 0.3.74 source baseline (`812aa7f1b`), with River changes at `58d74189`. No GitHub release or website change.

River's open timeline now listens for incoming changes. Document, audience, and target events fetch only affected document IDs through the signed-in user's permissions; overlapping events are coalesced and events arriving during a read receive another pass. Cache indexing, writes, and stale-file removal use asynchronous filesystem operations. Unchanged cache files are not rewritten. A library-change notification no longer schedules another full River inventory download. Startup/reconnection and membership changes still reconcile the inventory. No polling was added.

Timeline content renders independently of account/destination metadata. Existing account-change invalidation remains in place, and incoming shares preserve expanded cards.

## Automated verification

- Full suite: 242 files passed; 3,628 tests passed and 3 skipped.
- Final River checks after asynchronous stale-cache cleanup: 58 tests passed.
- TypeScript checks, renderer/Electron builds, native helper builds, release/channel/source/package/auth configuration guards, and compiled-module checks passed.
- Production dependency audit: zero vulnerabilities.
- The strict quality summary fails on pre-existing diagnostics for launcher load/filter/hide, clipboard results, and recording paste latency. Those logs are not measurements of this River build. Overall application performance is not qualified by this result.
- Diff reviewed for unnecessary scaffolding and duplicate work; refactor complete.

## Runtime acceptance still required

The under-two-second sender-to-recipient target has not been measured in the notarized candidate. Automated DOM tests establish refresh behavior, not actual two-Mac delivery latency or absence of UI stalls.

Quit the existing app before opening the candidate. With two signed-in users who already have an accepted River destination, leave River open on the recipient and share from the sender. Measure from the sender's Share action to the recipient's visible card across repeated shares, including a realistically populated River. Verify typing, scrolling, expanded cards, and navigation remain responsive during delivery. Confirm catch-up after reconnecting and removal when access is revoked.

## Artifact receipts

- App and DMG: Developer ID signed, Apple notarization accepted, staples validate, Gatekeeper accepted as Notarized Developer ID.
- DMG notarization request: `8c9add38-cc8c-418b-972d-ae762d68620c`.
- Packaged archive: 8,065 file hashes and 189 JavaScript syntax checks passed. Packaged SQLite, terminal, and native-watcher runtime checks passed.
- ZIP: signature/staple/Gatekeeper passed; all 703 payload files and symlinks match the signed staging app, including hashes and modes.
- DMG: disk-image checksum verified; mounted app signature/staple/Gatekeeper passed; mounted application archive matches the signed staging app.
- Updater metadata and blockmaps were regenerated against final local artifacts. No upload occurred.
- DMG SHA-256: `789cde65034b5382f3b681a93295690c38dab31609f6c124ea5881e9533a9e5a`.
- ZIP SHA-256: `8dcb546114d62ac4c5479a5225651ac10ab3dc13c4bb609463fbd10c72537cdf`.

Artifacts are in `mac-app/release/`: `Field.Theory-0.3.75-arm64.dmg` and `Field.Theory-0.3.75-arm64-mac.zip`, with `SHA256SUMS.txt`. No local installation or app-UI runtime acceptance is claimed.
