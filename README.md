# Field Theory

Field Theory is a local-first macOS application for writing, voice, clipboard, Library, command, and local AI workflows.

## Project Status

This is the Field Theory app source repository, seeded from the cleaned Field Theory/Oscar development history.

Field Theory-owned app/source code in this repository is licensed under AGPL-3.0-or-later unless a file or directory says otherwise.

## Repository Family

Field Theory is split across sibling repositories:

- `afar1/oscar`: private historical/source repo during the transition.
- `afar1/fieldtheory`: app source repository.
- `afar1/fieldtheory-labs`: private full-history archive and sensitive experiments repo.
- `afar1/fieldtheory-cli`: public CLI repo.
- `afar1/fieldtheory-plugin`: plugin ecosystem repo.
- `afar1/field-releases`: public binary release feed.

This repo is the public-facing app source repository. It is not the full private history archive.

## History And Attribution

This public-facing history preserves the Field Theory/Oscar development arc while collapsing the inherited upstream `whisper.cpp` history into one credited import commit.

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

People can read, run, fork, modify, and self-host Field Theory under the AGPL terms.

This source release does not include the production Field Theory Cloud backend, Supabase production internals, billing infrastructure, deployment configuration, or service secrets.

## Where to Start

- [Mac app README](mac-app/README.md): local development setup for the active Mac app.
- [Open-source readiness docs](mac-app/docs/open-source-readiness/README.md): current code-derived map of the app, data flows, release boundaries, and pre-publication cleanup.
- [Privacy policy](mac-app/PRIVACY_POLICY.md): current Mac data-flow policy.
- [Security policy](SECURITY.md): security reporting and sensitive-surface guidance.
- [Third-party notices](THIRD_PARTY_NOTICES.md): dependency, model, and asset notice tracking.
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

Field Theory-owned app/source code in this repository is licensed under [AGPL-3.0-or-later](LICENSE).

That means people can use, run, fork, modify, and redistribute the code, including commercially, under the license terms. If someone modifies Field Theory and offers it as a network service, the AGPL requires them to provide the corresponding source for those modifications to users of that service.

The repo family uses a split-license model:

- `afar1/fieldtheory`: AGPL-3.0-or-later for Field Theory-owned app/source code.
- `afar1/fieldtheory-cli`: MIT.
- `afar1/fieldtheory-plugin`: MIT.
- Examples and protocol docs: MIT unless they are tightly app-coupled.
- Brand assets: trademark protected.

Preserving the upstream MIT notice for `whisper.cpp` / `ggml` does not require all Field Theory-owned code to be MIT. It means those upstream portions keep their original license notice.

The code license does not grant rights to the Field Theory name, logo, icon, brand, official Cloud service identity, or other trademarks. See [TRADEMARKS.md](TRADEMARKS.md).
