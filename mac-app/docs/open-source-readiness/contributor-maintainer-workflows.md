# Contributor Versus Maintainer Workflows

This document separates ordinary local development from maintainer-only packaging and release infrastructure.

## Contributor workflows

These commands are appropriate for normal local development:

```bash
cd mac-app
npm ci
npm run dev
npm run typecheck
npm test
npm run build
```

Useful development variants:

```bash
npm run dev:verbose
npm run dev:active
npm run dev:native
npm run dev:experimental
```

Safe non-release guards:

```bash
npm run guard:package-safety
npm run guard:package-safety:experimental
npm run guard:electron-dist-requires
```

The contributor promise should be: a developer can run and test the app without signing certificates, Apple notarization credentials, GitHub release tokens, or private update feed access.

## Maintainer-only workflows

These commands are maintainer-oriented:

```bash
npm run package
npm run package:experimental
```

They are maintainer-oriented because they:

- enforce release branch rules;
- run tracked-source and package-safety guards;
- build native helper artifacts;
- build Whisper artifacts;
- build Electron and Vite output;
- run Electron Builder;
- use signing, hardened runtime, entitlements, notarization, or release publishing configuration;
- publish or prepare artifacts for updater feeds.

## Release branch rules

Production packaging is guarded for the production branch. Experimental packaging is guarded for the experimental branch. Running those package commands from a feature worktree should fail.

This is expected and should be documented so contributors do not treat release-guard failures as local setup failures.

## Credentials and private infrastructure

Maintainer-only release flows can require:

- `GH_TOKEN` with release repository write access;
- Apple Developer credentials such as `APPLE_ID`, `APPLE_ID_PASSWORD`, and `APPLE_TEAM_ID`;
- signing identities and entitlements;
- notarization access;
- private experimental updater access through `FIELD_THEORY_EXPERIMENTAL_UPDATE_TOKEN` or GitHub auth;
- access to production or experimental release repositories.

None of those should be required for normal local development.

## Production and experimental releases

Current code configures production publishing to GitHub `afar1/field-releases`.

Experimental release configuration points at maintainer-only updater infrastructure. That makes sense for maintainers, but it must be marked private/internal in contributor docs.

The current release workflow docs have been rewritten as maintainer packaging docs. Keep that boundary intact: release feeds can be visible infrastructure, but credentials and release publication are not contributor setup.

## Asset and dependency notices

Release review needs a clear notices path for:

- npm dependencies and any dependencies with missing license metadata;
- WebRTC VAD notices;
- local model metadata and model provider terms;
- Gemma download terms and Apache-2.0 source/model distinctions;
- bundled sounds;
- onboarding images;
- icons and logos;
- any reintroduced reference voice assets, with explicit source consent and redistribution license;
- native helper and Whisper artifacts.

This is not optional polish. It affects whether the repo can be responsibly published.

## Contributor Policy Decisions

- Should contributors use production Supabase, a separate dev Supabase project, local Supabase, or local-only mode?
- Which account-backed features should be expected to work in local development?
- Should experimental updater code remain in the source tree as maintainer-only code, or be more clearly separated?
- Should release docs document artifact publishing in this repo, a release-only repo, or both?
- Which license will govern app code, docs, assets, and bundled resources?
