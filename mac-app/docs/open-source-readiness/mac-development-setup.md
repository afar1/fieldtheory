# Mac Development Setup

This is the contributor setup path for the current Mac app. It is intentionally separate from packaging and release. Local development should not require Apple signing credentials, GitHub release tokens, private updater access, or production release branches.

## Requirements

- macOS, because this is an Electron Mac app with macOS-specific permissions and native helpers.
- Node.js and npm compatible with the current lockfile.
- Python available for native module rebuilds; the package scripts default to `python3.11` through `PYTHON=${PYTHON:-python3.11}` for `electron-rebuild`.
- Xcode command line tools for native helper builds.
- CMake and Apple/Metal build tooling if building Whisper locally.

## Install

From the repository root:

```bash
cd mac-app
npm ci
```

The package is marked `"private": true` because this is an application package, not an npm library intended for publication.

## Run the app locally

```bash
npm run dev
```

`npm run dev` starts Vite and Electron together. The renderer dev server uses port `5173`, and Electron starts against `ELECTRON_START_URL=http://localhost:5173`.

Useful variants:

```bash
npm run dev:verbose
npm run dev:active
npm run dev:native
npm run dev:experimental
```

Use the default `dev` command first. Reach for the variants only when debugging noisy logs, active-component tracing, native launcher behavior, or experimental-channel behavior.

## Verify changes

For normal code changes:

```bash
npm run typecheck
npm test
npm run build
```

For package safety and release-readiness checks that do not require signing:

```bash
npm run guard:package-safety
npm run guard:package-safety:experimental
npm run guard:electron-dist-requires
```

The release-channel guards intentionally fail unless run from the correct release branches. Production packaging is guarded for `main`; experimental packaging is guarded for `experimental`.

## Environment variables

The current README references `.env.example`, but the file does not exist yet. A public-ready repo should add one with non-secret placeholders and comments.

Expected public guidance:

- Core local functionality should work without login.
- Supabase URL and publishable key are public client configuration, not private secrets. Access control must come from auth, database policy, and server-side checks.
- Optional account-backed features may require Supabase configuration and an account.
- Maintainer release variables should not be required for local development.

## Local data created during development

The app uses two broad local data locations:

- `~/.fieldtheory`: user-authored Field Theory content and CLI-facing state.
- Electron `app.getPath("userData")`: app-managed settings, session files, metrics, local databases, indexes, and per-user app state.

Development runs can mutate real local Field Theory data unless pointed at test paths. Be careful when testing Library, command launcher, sync, River, clipboard, and account features.

## Native and model-related setup

`npm run build` builds Electron TypeScript and Vite output. It does not do the full native packaging build.

`npm run build:all` does more:

```bash
npm run build:native
npm run build:whisper
npm run build
```

That path builds the Swift native helper and Whisper binaries before the normal app build. It is closer to packaging preparation than everyday contributor development.

Gemma/local model setup is separate:

```bash
npm run build:gemma
```

Model binaries are not tracked in the repository. Public docs should distinguish the source code license from model licenses and provider terms.

## Known setup gaps before public release

- Add `mac-app/.env.example`.
- Rewrite `mac-app/README.md` from the current code path.
- Decide whether public contributors should use real Supabase development infrastructure, local Supabase, or local-only mode by default.
- Document how to avoid mutating a maintainer's real `~/.fieldtheory` Library during tests and experiments.
- Publish a third-party notices or dependency license document.
