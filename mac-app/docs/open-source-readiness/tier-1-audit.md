# Tier 1 Audit

Date: May 31, 2026

This note records the current Tier 1 release-readiness state after the documentation and dependency-audit pass.

## Completed in this pass

### Public entry docs rewritten

The root `README.md` and `mac-app/README.md` describe the repository, explain the AGPL app-source license decision, point readers to the current readiness docs, and separate local development from maintainer packaging.

### Environment example added

`mac-app/.env.example` now exists. It includes non-secret placeholders for optional Supabase/account-backed development and explicitly excludes maintainer-only release credentials.

### Privacy/security docs rewritten from current data flow

`mac-app/PRIVACY_POLICY.md` is now a current privacy draft. It documents local data, Electron `userData`, file-backed Supabase sessions, clipboard history, Supabase-backed features, River, internal sync gates, metrics, account deletion scope, and privileged Electron capabilities.

`SECURITY.md` documents sensitive areas, private vulnerability reporting expectations, local data cautions, secret rules, and release security gates.

### Contributor guide added

`mac-app/CONTRIBUTING.md` now gives a contributor setup path and verification expectations without requiring signing credentials, release tokens, production Supabase access, or private updater access.

### Third-party notice work started

`THIRD_PARTY_NOTICES.md` records the notice categories that must be resolved for release review: npm dependencies, native/transcription components, local models, public assets, icons, sounds, reference voice assets, and packaged release artifacts.

`mac-app/docs/open-source-readiness/asset-provenance-inventory.md` records the current bundled media/icon files with SHA-256 hashes and release status.

Unused legacy tray icons, unused onboarding images, unused or unknown sound files, and tracked reference voice audio files were removed from the source tree. The remaining sound files are generated WAV tones created during this readiness pass. `resources/chatterbox` was also removed from Electron Builder `extraResources`, so the reference voice path is no longer packaged by default.

`npm run license:summary` now generates a lockfile-derived dependency license summary for repeatable notice review.

The current summary reports 1204 package entries and zero missing-license entries after documented overrides.

The package lock omitted license fields for `agentmail@0.4.9` and `spawn-command@0.0.2`. Both versions publish MIT metadata on npm, and `mac-app/scripts/generate-license-summary.mjs` records explicit override sources.

### Production dependency audit cleaned

`npm audit --omit=dev --audit-level=high` now reports zero vulnerabilities after:

- applying `npm audit fix`;
- moving `@excalidraw/excalidraw` to `^0.17.6`;
- removing the `@excalidraw/excalidraw/index.css` import that is not present in `0.17.6`.

`npm run build` passes after that change.

## Still Open

### License terms

The repository is now governed by the AGPL-3.0-or-later root `LICENSE` for Field Theory-owned app/source code unless a file or directory says otherwise.

Terms to keep explicit:

- app/source license: AGPL-3.0-or-later;
- CLI/plugin repo license: MIT;
- examples and protocol docs: MIT unless app-coupled;
- asset/media terms;
- bundled third-party notices;
- downloaded model terms;
- trademark and brand terms.

### Full third-party notices

The notice file and asset inventory are drafts. They need source/provenance review for:

- icons and logos;
- `mac-app/electron/assets/*`;
- native/transcription artifacts;
- model downloads and model terms.

The dependency license summary resolves the missing lockfile license metadata for `agentmail` and `spawn-command` through documented overrides. Future dependency changes should rerun `npm run license:summary` and review any new missing metadata during release review.

### Dev/build toolchain audit

Production audit is clean, but full `npm audit --audit-level=high` still reports dev/build toolchain issues requiring breaking upgrades:

- Electron;
- Vite/esbuild;
- electron-builder;
- electron-rebuild/node-gyp/tar.

Those should be handled as a separate compatibility pass because they affect runtime, build, native rebuild, and packaging behavior.

### Secret/history audit

A tracked-file grep pass found no obvious committed private key material, but it did find expected placeholder and code references to secret names in docs, scripts, tests, and Supabase Edge Function code.

This is not a full release-grade audit. Run a history-aware secret scan and rotate anything that has ever been committed accidentally.

### Supabase policy review

The docs correctly say Supabase publishable keys are public client config. Supabase RLS policies, Edge Functions, account deletion behavior, and production/dev project split need dedicated review.

### Account deletion wording

The privacy draft does not claim local data is deleted on account deletion. The actual local/remote deletion behavior should be product-reviewed.

## Verification run

Commands run in `mac-app`:

```bash
npm run typecheck
npm test
npm audit --omit=dev --audit-level=high
npm run build
npm run guard:package-safety
npm run guard:package-safety:experimental
npm run guard:electron-dist-requires
npm run license:summary
```

Command run at the repository root:

```bash
npm run test:library-text
```

Results:

- Mac typecheck passed;
- full Mac Vitest run passed: 151 test files, 2364 tests passed, 1 skipped;
- production audit passed with zero vulnerabilities;
- app build passed;
- package safety guards passed for production and experimental configs;
- Electron dist require check passed;
- dependency license summary command passed and reports 1204 package entries with zero missing-license entries after documented overrides;
- root Library text/hash/sync tests passed: 57 tests.

Known verification limitation:

`npm run guard:release-channel` intentionally fails from `experimental` unless `FIELD_THEORY_RELEASE_BRANCH_OVERRIDE=true` is set, because production packaging is guarded for `main`. Experimental release-channel, package-safety, and electron-dist checks passed on `experimental`.
