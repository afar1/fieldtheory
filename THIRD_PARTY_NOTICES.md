# Third-Party Notices

This file records third-party notices and provenance boundaries for the current Field Theory Mac open-source candidate. The root `LICENSE` covers Field Theory-owned app/source code unless a file or directory says otherwise. Third-party components keep their own license terms and notices.

## NPM Dependencies

The Mac app uses npm dependencies listed in `mac-app/package.json` and locked in `mac-app/package-lock.json`.

Generate the current dependency license summary with:

```bash
cd mac-app
npm run license:summary
```

Current summary:

- total lockfile package entries: 1204;
- runtime/dev/optional scope is reported per package;
- no package entries are missing license metadata after documented overrides.

Documented overrides:

- `agentmail@0.4.9`: npm metadata reports MIT. Confirmed with `npm view agentmail@0.4.9 license`.
- `spawn-command@0.0.2`: npm metadata reports MIT. Confirmed with `npm view spawn-command@0.0.2 license`.

The package lock omits license fields for those two entries, so `mac-app/scripts/generate-license-summary.mjs` records explicit overrides instead of leaving the report ambiguous.

## WebRTC VAD

Field Theory's native helper includes a WebRTC VAD target under `mac-app/electron/native/Sources/WebRTCVad`. The local notice file is `mac-app/electron/native/Sources/WebRTCVad/LICENSE`.

Copyright notice:

```text
Copyright (c) 2011, The WebRTC project authors. All rights reserved.
Copyright (c) 2016 Daniel Pirch
```

License terms in the bundled notice permit redistribution and use in source and binary forms, with or without modification, provided the notice and conditions are retained for source distributions and reproduced in documentation or other materials for binary distributions. The notice also prohibits using Google or contributor names to endorse derived products without prior written permission and includes the standard warranty/liability disclaimer.

Before publication, verify whether the full text from `mac-app/electron/native/Sources/WebRTCVad/LICENSE` should be copied into release documentation, app acknowledgements, or packaged notices.

## Native Helper

The native helper source lives under `mac-app/electron/native`. It builds:

- `FieldTheoryHelper`;
- `FieldTheoryLauncher`;
- `WebRTCVad`.

`FieldTheoryHelper` links Apple frameworks such as AVFoundation, CoreAudio, AudioToolbox, CoreMedia, and ScreenCaptureKit. Those Apple frameworks are platform SDK dependencies, not repository source code.

## Whisper Models And whisper.cpp Artifacts

The app can download Whisper model files through `mac-app/electron/main/modelManager.ts`.

Current model URLs:

- `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin`
- `https://huggingface.co/akashmjn/tinydiarize-whisper.cpp/resolve/main/ggml-small.en-tdrz.bin`

Packaging can include Whisper binaries built by `mac-app/scripts/build-whisper.sh`, such as `whisper-cli` and `whisper-server`, when present in the expected build output.

Model files are not tracked in the repository. Public docs should treat them as externally downloaded model artifacts governed by their upstream model terms.

## Gemma And Local LLM Resources

The local command model metadata is in `mac-app/electron/main/localLlmManager.ts`.

Current local model metadata:

- model id: `gemma-4-E4B-it-Q4_K_M`;
- file: `gemma-4-E4B-it-Q4_K_M.gguf`;
- declared model license metadata in code: `Apache-2.0`;
- GGUF source: `https://huggingface.co/ggml-org/gemma-4-E4B-it-GGUF`;
- base model page: `https://huggingface.co/google/gemma-4-E4B-it`.

`mac-app/scripts/setup-gemma.sh` downloads or links the model. Model binaries are ignored by `mac-app/resources/models/.gitignore` and should not be committed.

Before publication, verify the model provider terms and decide whether the setup script, not the repository, is the correct distribution boundary.

## MLX Whisper

`mac-app/scripts/setup-mlx-whisper.sh` creates a local Python environment, installs `mlx-whisper`, installs MLX wheels, and downloads model weights from:

```text
mlx-community/whisper-large-v3-turbo
```

These artifacts are downloaded at setup/runtime and are not tracked source files. Public docs should state that users are responsible for any external model/runtime terms associated with those downloads.

## Parakeet

`mac-app/scripts/setup-parakeet.sh` creates a Python environment and installs `onnx-asr[cpu,hub]`.

`mac-app/scripts/parakeet-transcribe.py` uses this default model name:

```text
nemo-parakeet-tdt-0.6b-v2
```

The model is downloaded automatically on first use and cached locally. It is not tracked in the repository.

## Generated Sounds

The remaining files under `mac-app/public/sounds` are generated WAV tones created during the open-source readiness pass. They are project-generated assets and should be covered by the eventual asset license decision.

See `mac-app/docs/open-source-readiness/asset-provenance-inventory.md` for file hashes.

## Brand And Icon Assets

The following files still require project ownership confirmation, replacement, or removal before publication:

- `mac-app/electron/assets/fieldtheory-iconTemplate.png`
- `mac-app/electron/assets/fieldtheory-iconTemplate@2x.png`
- `mac-app/electron/assets/icon.icns`
- `mac-app/public/field-theory-icon-black.png`
- `mac-app/public/fieldtheory-icon.png`
- `mac-app/public/fieldtheory-logo-black.png`
- `mac-app/public/fieldtheory-logo-white.png`

## Removed Unknown-Provenance Assets

Unknown-provenance onboarding images, legacy tray icons, legacy sound files, and reference voice audio files were removed during open-source readiness cleanup. If any are reintroduced, they need explicit source, consent, attribution, license, and redistribution notes before publication.

## Release Artifacts

Production and experimental packages can include generated binaries, static assets, scripts, model setup scripts, and updater metadata. Before publication, verify the notices against the actual packaged contents, not only the source tree.
