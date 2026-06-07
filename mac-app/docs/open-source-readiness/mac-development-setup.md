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

`mac-app/.env.example` exists and contains non-secret placeholders for optional account-backed development. Copy it only when you need environment-backed features:

```bash
cp .env.example .env.local
```

Public guidance:

- Core local functionality should work without login.
- Supabase URL and publishable key are public client configuration, not private secrets. Access control must come from auth, database policy, and server-side checks.
- Optional account-backed features may require Supabase configuration and an account.
- Maintainer release variables should not be required for local development.

## Local data created during development

The app uses two broad local data locations:

- `~/.fieldtheory`: user-authored Field Theory content and CLI-facing state.
- Electron `app.getPath("userData")`: app-managed settings, session files, metrics, local databases, indexes, and per-user app state.

Development runs can mutate real local Field Theory data unless pointed at test paths. Be careful when testing Library, command launcher, sync, River, clipboard, and account features.

There is not one supported environment variable that redirects every `~/.fieldtheory` path for the whole app. For destructive or sync-adjacent testing, use a separate macOS user, disposable machine profile, backed-up `~/.fieldtheory` directory, dedicated test account, or small test Library root. See [Local data paths](./local-data-paths.md).

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

This also creates `~/.codex/gemma.config.toml`, a thin Codex profile for local Gemma runs that keeps Field Theory available but disables unrelated plugin skill catalogs. Use it with `codex -p gemma` or a local Gemma wrapper that passes `-p gemma`.

Model binaries are not tracked in the repository. Docs should distinguish the source code license from model licenses and provider terms.

## Known Setup Gaps

- Decide whether contributors should use real Supabase development infrastructure, local Supabase, or local-only mode by default.
- Add a first-class contributor-safe dev profile that redirects both Electron `userData` and Field Theory home paths.
- Finalize third-party notices after the license and asset terms are chosen.
