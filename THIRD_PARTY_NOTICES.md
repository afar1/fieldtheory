# Third-Party Notices Draft

This draft records the notice work needed before Field Theory is published as open source. It is not yet a complete legal notice file.

## Source Dependencies

The Mac app uses npm dependencies listed in `mac-app/package.json` and locked in `mac-app/package-lock.json`.

Generate the current dependency license summary with:

```bash
cd mac-app
npm run license:summary
```

Before public release:

- generate a dependency license report from the lockfile;
- review dependencies with missing or ambiguous license metadata;
- record any required notices;
- keep development-only and runtime dependencies separate where useful.

The current helper reports package names, versions, lockfile license metadata, and whether each entry is runtime, dev, or optional.

Current missing lockfile license metadata:

- `agentmail@0.4.9` in runtime dependencies;
- `spawn-command@0.0.2` in dev dependencies.

## Native and Transcription Components

The app can build or bundle native and transcription-related components, including:

- Swift native helper code under `mac-app/electron/native`;
- Whisper build artifacts produced by `mac-app/scripts/build-whisper.sh`;
- MLX/Parakeet-related setup scripts;
- WebRTC VAD-related code and notices where used.

Before public release, each bundled native or transcription component needs source, license, and redistribution notes.

## Local Models

Model binaries are intentionally not tracked in the repository. `mac-app/resources/models/.gitignore` ignores `*.gguf`.

Gemma/local model setup downloads from external model hosts. Public docs must distinguish:

- the repository source license;
- the model license;
- the model provider terms;
- whether a model is downloaded by a script, bundled in a release artifact, or supplied by the user.

## Bundled Assets

Assets needing provenance and license review include:

- generated sound files under `mac-app/public/sounds/*`, which should be covered by the chosen project asset license;
- removed onboarding images if they are ever reintroduced;
- icons, logos, and tray assets;
- `mac-app/electron/assets/*`;
- removed reference voice assets if they are ever reintroduced.

Reference voice assets were removed during open-source readiness cleanup. If they are ever reintroduced, they need explicit source, consent, and redistribution notes before public release.

Legacy sound files with unknown provenance were removed during open-source readiness cleanup. The remaining sound files are generated WAV tones recorded in `mac-app/docs/open-source-readiness/asset-provenance-inventory.md`.

See `mac-app/docs/open-source-readiness/asset-provenance-inventory.md` for the current file-by-file asset inventory and hashes.

## Release Artifacts

Production and experimental app packages can include generated binaries, static assets, scripts, and model/transcription support files.

Before publication, verify that the notices cover the actual packaged contents, not just the source tree.
