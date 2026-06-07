# Field Theory

Field Theory is a local-first macOS application for writing, voice, clipboard, Library, command, and local AI workflows.

This repository is being prepared for open source. The current codebase is the source of truth for the public documentation work; older README, privacy, architecture, and release notes may be stale and should be verified against code before being treated as product truth.

## Project Status

Open-source preparation is in progress.

The repository is not yet under a final open-source license. Until the license decision is made and the root [LICENSE](LICENSE) file is replaced, the existing proprietary license remains the governing license.

## History And Attribution

This public-candidate history preserves the Field Theory/Oscar development arc while collapsing the inherited upstream `whisper.cpp` history into one credited import commit.

That shape keeps the project history honest: Field Theory's commits remain visible, and upstream `whisper.cpp` work is attributed without presenting thousands of upstream commits as Field Theory-authored history.

See [NOTICE.md](NOTICE.md) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for attribution and third-party notice tracking.

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

## License

License decision pending.

The current [LICENSE](LICENSE) is proprietary and remains in effect until it is intentionally replaced.
