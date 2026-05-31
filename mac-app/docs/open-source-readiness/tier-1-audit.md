# Tier 1 Audit

Date: May 31, 2026

This note records the current Tier 1 open-source readiness state after the public documentation and dependency-audit pass.

## Completed in this pass

### Public entry docs rewritten

The root `README.md` and `mac-app/README.md` now describe the repository as an open-source candidate, explain that the current proprietary license remains active until replaced, point readers to the current readiness docs, and separate local development from maintainer packaging.

### Environment example added

`mac-app/.env.example` now exists. It includes non-secret placeholders for optional Supabase/account-backed development and explicitly excludes maintainer-only release credentials.

### Privacy/security docs rewritten from current data flow

`mac-app/PRIVACY_POLICY.md` is now a current privacy draft. It documents local data, Electron `userData`, file-backed Supabase sessions, clipboard history, Supabase-backed features, River, internal sync gates, metrics, account deletion scope, and privileged Electron capabilities.

`SECURITY.md` now documents sensitive areas, private vulnerability reporting expectations, local data cautions, secret rules, and pre-publication security gates.

### Contributor guide added

`mac-app/CONTRIBUTING.md` now gives a contributor setup path and verification expectations without requiring signing credentials, release tokens, production Supabase access, or private updater access.

### Third-party notice work started

`THIRD_PARTY_NOTICES.md` now records the notice categories that must be resolved before publication: npm dependencies, native/transcription components, local models, public assets, icons, sounds, reference voice assets, and packaged release artifacts.

`mac-app/docs/open-source-readiness/asset-provenance-inventory.md` records the current bundled media/icon files with SHA-256 hashes and release status.

Unused legacy tray icons, unused onboarding images, unused or unknown sound files, and tracked reference voice audio files were removed from the source tree. The remaining sound files are generated WAV tones created during this readiness pass. `resources/chatterbox` was also removed from Electron Builder `extraResources`, so the reference voice path is no longer packaged by default.

`npm run license:summary` now generates a lockfile-derived dependency license summary for repeatable notice review.

The current summary reports 1204 lockfile package entries and two entries with missing license metadata:

- `agentmail@0.4.9` in runtime dependencies;
- `spawn-command@0.0.2` in dev dependencies.

### Production dependency audit cleaned

`npm audit --omit=dev --audit-level=high` now reports zero vulnerabilities after:

- applying `npm audit fix`;
- moving `@excalidraw/excalidraw` to `^0.17.6`;
- removing the `@excalidraw/excalidraw/index.css` import that is not present in `0.17.6`.

`npm run build` passes after that change.

## Still open before public release

### License decision

The repository is still governed by the proprietary root `LICENSE`. This pass did not choose a license. A human project decision is required before the repo can honestly be called open source.

Required decision:

- source license;
- docs license;
- asset/media license;
- whether bundled resources, reference voice assets, generated binaries, and model-related files use separate terms.

### Full third-party notices

The notice file and asset inventory are drafts. They still need source/provenance review for:

- icons and logos;
- `mac-app/electron/assets/*`;
- native/transcription artifacts;
- model downloads and model terms.

The dependency license summary also needs follow-up for `agentmail` and `spawn-command`, because their lockfile entries do not include license metadata.

### Dev/build toolchain audit

Production audit is clean, but full `npm audit --audit-level=high` still reports dev/build toolchain issues requiring breaking upgrades:

- Electron;
- Vite/esbuild;
- electron-builder;
- electron-rebuild/node-gyp/tar.

Those should be handled as a separate compatibility pass because they affect runtime, build, native rebuild, and packaging behavior.

### Secret/history audit

A tracked-file grep pass found no obvious committed private key material, but it did find expected placeholder and code references to secret names in docs, scripts, tests, and Supabase Edge Function code.

This is not a full publication-grade audit. Before public release, run a history-aware secret scan and rotate anything that has ever been committed accidentally.

### Supabase policy review

The docs now correctly say Supabase publishable keys are public client config. Before public release, the Supabase RLS policies, Edge Functions, account deletion behavior, and production/dev project split still need a dedicated review.

### Account deletion wording

The privacy draft does not claim local data is deleted on account deletion. The actual local/remote deletion behavior should be product-reviewed before publication.

## Verification run

Commands run in `mac-app`:

```bash
npm audit --omit=dev --audit-level=high
npm run build
npm run guard:package-safety
npm run guard:package-safety:experimental
npm run license:summary
npm test
```

Results:

- production audit passed with zero vulnerabilities;
- app build passed;
- package safety guards passed for production and experimental configs.
- dependency license summary command passed and identified two missing-license lockfile entries.
- full Vitest run did not pass, but most Mac app tests ran successfully: 139 test files passed, 2274 tests passed, and 1 test was skipped.

Known verification limitation:

`npm run typecheck` still fails because the root TypeScript config reaches sibling mobile/service files that are missing React Native/Supabase dependencies in this worktree. The Electron TypeScript build path did pass as part of `npm run build`.

`npm test` still fails on the same root Expo tsconfig issue for mobile/service test files:

- `src/__tests__/mobileCommands.test.ts`
- `src/__tests__/mobileLibraryState.test.ts`
- `src/__tests__/mobileStorage.test.ts`
- `src/__tests__/mobileTranscriptCapture.test.ts`
- `src/__tests__/syncUtils.test.ts`

It also had one Mac test timeout in `src/components/__tests__/LibrarianView.test.tsx`: `uses x and j to build a multi-selection before archiving selected files`.
