# Field Theory

Field Theory is a local-first macOS application for writing, voice, clipboard, Library, command, and local AI workflows.

This repository is being prepared as the clean public-source staging repo for Field Theory.

It is private until the final release checks, license decision, and public visibility approval are complete.

## Project Status

Open-source preparation is in progress. This repo is the private `afar1/fieldtheory` staging repo, seeded from a cleaned Oscar history.

The repository is not yet under a final open-source license. Until the license decision is made and the root [LICENSE](LICENSE) file is replaced, the existing proprietary license remains the governing license.

No repository visibility change is implied by this README.

## Repository Family

Field Theory is split across sibling repositories:

- `afar1/oscar`: private historical/source repo during the transition.
- `afar1/fieldtheory`: private clean app-source staging repo; intended to become public after approval.
- `afar1/fieldtheory-labs`: private full-history archive and sensitive experiments repo.
- `afar1/fieldtheory-cli`: public CLI repo.
- `afar1/fieldtheory-plugin`: private plugin ecosystem repo for now.
- `afar1/field-releases`: public binary release feed.

This repo is the public-source candidate. It is not the full private history archive.

## History And Attribution

This public-candidate history preserves the Field Theory/Oscar development arc while collapsing the inherited upstream `whisper.cpp` history into one credited import commit.

That shape keeps the project history honest: Field Theory's commits remain visible, and upstream `whisper.cpp` work is attributed without presenting thousands of upstream commits as Field Theory-authored history.

See [NOTICE.md](NOTICE.md) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for attribution and third-party notice tracking.

## Public Source Boundary

This repo is intended to contain app source, local development docs, public governance docs, and public-facing architecture material.

It intentionally excludes production backend internals:

- production Supabase schema;
- Supabase migrations;
- Supabase edge functions;
- billing and service internals;
- production Cloud configuration;
- private operational runbooks;
- hosted website/API route internals.

Field Theory Cloud remains the official hosted service operated by Field Theory.

This source release is not a self-hostable Field Theory Cloud backend.

## Where to Start

- [Mac app README](mac-app/README.md): local development setup for the active Mac app.
- [Open-source readiness docs](mac-app/docs/open-source-readiness/README.md): current code-derived map of the app, data flows, release boundaries, and pre-publication cleanup.
- [Privacy policy draft](mac-app/PRIVACY_POLICY.md): current Mac data-flow policy draft.
- [Security policy draft](SECURITY.md): current security reporting and sensitive-surface guidance.
- [Third-party notices draft](THIRD_PARTY_NOTICES.md): dependency, model, and asset notice work needed before publication.
- [Architecture sketch](arch.md): useful historical map, but verify against code when accuracy matters.

## Repository Shape

The active product center is `mac-app/`, an Electron + Vite + React macOS app.

Important Mac app areas:

- `mac-app/src`: renderer UI.
- `mac-app/electron/preload.ts`: renderer capability bridge.
- `mac-app/electron/main`: privileged main-process code, IPC handlers, local data access, auth, sync, River, updater, and OS integration.
- `mac-app/scripts`: development, build, native setup, packaging, and release helper scripts.
- `mac-app/resources` and `mac-app/public`: packaged resources and static assets.
- `mac-app/docs/open-source-readiness`: fresh public-readiness documentation written from code inspection.

Other top-level trees may contain mobile work, adjacent apps, runtime code, or project infrastructure. Start there only when the task clearly points there.

## Local Development

For the Mac app:

```bash
cd mac-app
npm ci
npm run dev
```

Local verification:

```bash
npm run typecheck
npm test
npm run build
```

See [mac-app/README.md](mac-app/README.md) for details.

## Local-First, Not Local-Only

Core Mac app workflows can run without login. The app also has account-backed surfaces, including auth, feedback, account/quota checks, metrics, public sharing, River shared documents, and internally gated sync features.

Do not describe Field Theory as cloud-only or as purely local. The accurate public story is: local-first core, optional account-backed features, and explicit internal/experimental gates.

Source and development builds should not silently connect to production Field Theory Cloud. Official Cloud-backed features require explicit official configuration and account/session behavior.

## License

License decision pending.

The current [LICENSE](LICENSE) is proprietary and remains in effect until it is intentionally replaced.

The final license decision should clearly separate:

- Field Theory-owned source code;
- docs;
- app assets and generated sounds;
- bundled third-party source such as `whisper.cpp` / `ggml`;
- downloaded model artifacts and provider terms.

Preserving the upstream MIT notice for `whisper.cpp` / `ggml` does not require all Field Theory-owned code to be MIT. It means those upstream portions keep their original license notice.
