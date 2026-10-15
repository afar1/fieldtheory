# Field Theory Mac 0.3.71 public release

Published October 14, 2026: https://github.com/afar1/field-releases/releases/tag/v0.3.71
Website: https://fieldtheory.dev
Fix PR: https://github.com/afar1/fieldtheory-labs/pull/1

Mac release source: `505f339ad`, based on the published 0.3.70 source with the Parakeet fix cherry-picked and the version bumped. Source branch: `afar1/fieldtheory-labs:codex/release-0.3.71`. Website source: `5dbae9fbc`, deployment `dpl_BD5nuFGsNQ16ip5j7wAQ86cutqs1` (https://fieldtheory-ge0gv7tkh-afar1.vercel.app).

The loader prepares the selected Hugging Face snapshot before both setup verification and normal dictation. Existing cached models are reused offline. Snapshot symlinks are replaced atomically with regular files without modifying shared downloaded blobs; concurrent preparation is locked. Subsequent starts reuse prepared files. Startup errors keep a bounded stderr tail, and model-load failures retain their actual cause and cache-specific recovery guidance.

## Verification

- Reproduced the linked external-weight error on ONNX Runtime 1.24.1 using a disposable snapshot of the actual English model. Automatic repair ran with HF_HUB_OFFLINE=1; transcription returned the synthetic spoken phrase “Field Theory repairs model files automatically.” A subsequent startup with the installed ONNX Runtime 1.24.3 emitted ready without copying again. The working user cache was not modified for this experiment.
- All 16 Python cache/audio tests passed with both the installed and isolated newer onnx-asr runtimes. Both Mac TypeScript checks passed on release source. The final full-suite rerun passed all 240 files: 3,619 tests passed and three skipped. The first full run had an unrelated launcher-index timing/result failure; its isolated rerun and full rerun passed. No test thresholds were changed.
- Production dependency audit: zero vulnerabilities. Package, source/channel/auth, archive/native-payload, and packaged SQLite/terminal checks passed. Vulnerable dependency chains removed in 0.3.70 remain absent from the archive.
- App and outer DMG signatures, notarization, stapling, Gatekeeper, disk-image integrity, identical ZIP/DMG app payloads, and packaged Python script equality were verified. All five uploaded assets match GitHub SHA-256 digests and sizes.
- Both live website buttons point to 0.3.71; deployed HTML matches staged source. The public latest updater manifest matches final metadata. DMG/ZIP range downloads returned HTTP 206.

## Limits

Labs-main PR CI remains blocked by existing missing navigation exports and shared-service root dependencies; these failures are outside the Parakeet change and are documented in the PR. The separately built release source passes typechecking. Historical launcher/paste performance budget overruns from 0.3.70 remain; this is not a fresh performance qualification. Native microphone/hotkey UI acceptance and an installed updater transition were not exercised. Existing app installation was not replaced as part of publication.

DMG notarization: `bf6105ed-de61-440a-adc4-d387bd02f528` — Accepted.

## SHA-256

```text
6ddbc05d764d009c0610d6f1c39b1b231414a731570e7338a24bc6133beabe50  Field.Theory-0.3.71-arm64-mac.zip
86c16b798740861168d680e1ec214d318805b3e6b3ccfe4b8563f16be58e35d7  Field.Theory-0.3.71-arm64-mac.zip.blockmap
50d8e5d40143e812fefe2bcef16ae942602f53a29eec6e34716268e3b51fb918  Field.Theory-0.3.71-arm64.dmg
c6cd4a259fce5d49894ceedb627c161a47b26d203ea917bdf1ab24783f294f48  latest-mac.yml
```
