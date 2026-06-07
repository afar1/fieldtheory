# Dependency And Asset Follow-Up

Date: May 31, 2026

This note records dependency and asset provenance work that remains after the first release-readiness cleanup. License choice is deferred, so this document does not choose license terms.

## Current state

High-risk unknown-provenance media was removed earlier in this readiness pass:

- unused legacy tray icons;
- unused onboarding images;
- unknown sound files;
- tracked reference voice audio files.

The remaining generated sound files are project-generated WAV tones. They should be covered by the eventual asset license decision.

## Remaining provenance blockers

**Brand and icon assets**

The asset inventory marks app icons, tray icons, and logo PNGs as unknown provenance. These files are packaged or served by the app. Confirm project ownership, replace them, or remove them:

- `mac-app/electron/assets/fieldtheory-iconTemplate.png`
- `mac-app/electron/assets/fieldtheory-iconTemplate@2x.png`
- `mac-app/electron/assets/icon.icns`
- `mac-app/public/field-theory-icon-black.png`
- `mac-app/public/fieldtheory-icon.png`
- `mac-app/public/fieldtheory-logo-black.png`
- `mac-app/public/fieldtheory-logo-white.png`

**Native helper and WebRTC VAD**

`FieldTheoryHelper` depends on WebRTC VAD through `mac-app/electron/native/Package.swift`. The BSD-style notice is present at `mac-app/electron/native/Sources/WebRTCVad/LICENSE`; top-level notices should include or reference it.

**Transcription and model resources**

The app references or downloads model/runtime resources for:

- Whisper models from Hugging Face URLs in `modelManager.ts`;
- Gemma metadata and GGUF/base model pages in `localLlmManager.ts` and `setup-gemma.sh`;
- MLX Whisper setup in `setup-mlx-whisper.sh`;
- Parakeet setup/runtime dependencies in `setup-parakeet.sh` and `parakeet-transcribe.py`.

These downloads are not all bundled in the repository, but public docs should state where they come from, who owns the model terms, and whether contributors must download them separately.

**Reference voice benchmark path**

The removed default `resources/chatterbox/reference-voice.wav` path was still referenced by the recording ASR benchmark. That code now requires an explicit `FIELD_THEORY_RECORDING_ASR_BENCHMARK_AUDIO` path so the repository does not imply a bundled voice fixture exists.

**NPM license metadata**

`npm run license:summary` reports 1204 package entries and no missing license metadata after documented overrides.

The package lock omits license fields for:

- `agentmail@0.4.9` in runtime dependencies;
- `spawn-command@0.0.2` in dev dependencies.

Both package versions publish MIT license metadata on npm. The summary helper records explicit overrides with the exact `npm view` commands used as evidence.

## Audit status

`npm audit --omit=dev --audit-level=high` returns zero vulnerabilities.

Full `npm audit` still reports dev/build toolchain advisories involving Electron, electron-builder, electron-rebuild/node-gyp/tar, and Vite/esbuild. Track these separately from license readiness because several fixes may require breaking build or packaging upgrades.

## Commands used

```bash
npm run license:summary
npm audit --omit=dev --audit-level=high --json
npm audit --json
find mac-app/electron/assets mac-app/public mac-app/resources -type f | sort
find mac-app/electron/native -type f | sort
```
