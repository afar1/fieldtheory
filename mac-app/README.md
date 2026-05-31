# Field Theory Mac

Field Theory Mac is the active Electron + Vite + React macOS app in this repository. It is local-first: the core Library, editor, clipboard, command launcher, transcription, bookmark, and settings workflows can run without login. It is not local-only: account-backed features can use Supabase for auth, feedback, account state, quota or usage checks, public sharing, River shared documents, and internally gated sync.

This README is the contributor entry point for local development. Release packaging and publication are maintainer workflows, not required setup.

## Setup

```bash
cd mac-app
cp .env.example .env.local
npm ci
npm run dev
```

`npm run dev` starts Vite on port `5173` and launches Electron against the dev server.

Login is optional for local tools. Fill in Supabase values in `.env.local` only when testing authenticated or account-backed surfaces.

## Useful Commands

```bash
npm run dev
npm run dev:verbose
npm run dev:active
npm run dev:native
npm run dev:experimental
```

Verification:

```bash
npm run typecheck
npm test
npm run build
```

Package-safety checks that do not require release credentials:

```bash
npm run guard:package-safety
npm run guard:package-safety:experimental
npm run guard:electron-dist-requires
```

## App Structure

- `src`: React renderer UI.
- `electron/preload.ts`: capability bridge exposed to the renderer through Electron `contextBridge`.
- `electron/main`: privileged main-process code for filesystem access, IPC handlers, OS integration, child processes, auth, Supabase, sync, River, updater, and app lifecycle.
- `electron/native`: Swift native helper code.
- `scripts`: local setup, native/model/transcription setup, package guards, and maintainer release helpers.
- `resources`: bundled resources and model-related files.
- `public`: static renderer assets.
- `docs/open-source-readiness`: current public-readiness map and decision list.

## Local Data

Field Theory uses two broad local data locations:

- `~/.fieldtheory`: user-authored Library, Commands, Ideas, bookmarks, River shared cache, conflicts, and CLI-facing session metadata.
- Electron `app.getPath("userData")`: app-managed preferences, Supabase session file, clipboard database, metrics, indexes, command settings, tagged docs database, and per-user app state.

Development runs can touch real local data. Be careful when testing Library mutation, commands, clipboard, account, sync, or River behavior.

## Account-Backed Features

Supabase-backed features include auth, profile/session state, feedback, account status, quota or usage checks, metrics, public sharing, River shared documents, team membership/presence, and optional/internal sync surfaces.

The Supabase publishable key is public client configuration. It is not a service-role secret. Access control belongs in auth, row-level security, Edge Functions, and server-side checks.

## Internal, Disabled, and Experimental Surfaces

These surfaces exist in code but should not be treated as default public contributor features:

- full Library sync, gated by `fieldTheoryInternalSyncEnabled` or `FIELD_THEORY_INTERNAL_SYNC_ENABLED`;
- command mobile sync and todo setup, also tied to internal sync policy;
- shared clipboard, currently disabled in the public-facing preload shape;
- mobile transcript sync, currently inert in preload;
- experimental updater access, which depends on private maintainer GitHub access or `FIELD_THEORY_EXPERIMENTAL_UPDATE_TOKEN`.

## Packaging and Releases

Normal contributors should not need signing credentials, Apple notarization credentials, GitHub release tokens, private updater access, or release branches.

Maintainer packaging commands:

```bash
npm run package
npm run package:experimental
```

Those commands intentionally enforce release branch rules and can fail from feature worktrees. That is expected.

## URL Protocol

Packaged production builds register the `fieldtheory://` URL scheme for deep links from the CLI and other local tools.

Development and experimental builds do not register that scheme by default. To test protocol registration locally:

```bash
FT_REGISTER_FIELD_THEORY_PROTOCOL=true npm run dev
```

## More Documentation

- [Open-source readiness](docs/open-source-readiness/README.md)
- [Privacy policy draft](PRIVACY_POLICY.md)
- [Mac development setup](docs/open-source-readiness/mac-development-setup.md)
- [Architecture overview](docs/open-source-readiness/architecture-overview.md)
- [Contributor versus maintainer workflows](docs/open-source-readiness/contributor-maintainer-workflows.md)
