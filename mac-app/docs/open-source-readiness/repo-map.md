# Repo Map

This map is written for open-source readiness. It names the areas a contributor needs first and calls out areas that should not be treated as polished public documentation yet.

## Repository root

- `README.md`: currently stale for an open-source launch. It still describes the project as closed or proprietary.
- `LICENSE`: currently proprietary. A public release needs an explicit license decision before this file can become public-facing truth.
- `arch.md`: useful context, but this pass still treats code as the source of truth.
- `mac-app/`: the active Electron/Vite/React Mac application.
- `scripts/`, `supabase/`, and other root-level directories: supporting project infrastructure. These need a separate public-readiness pass if they are included in the public repository.

## Mac app

- `mac-app/package.json`: main command map for development, build, test, packaging, release guards, and Electron Builder configuration. The package is marked `"private": true`, which is acceptable for an app that is not npm-published but should be explained in contributor docs.
- `mac-app/src/`: React renderer code. This is the UI layer and calls preload-exposed APIs rather than Node APIs directly.
- `mac-app/electron/preload.ts`: the main renderer capability surface. It exposes many globals through `contextBridge.exposeInMainWorld`, including `librarianAPI`, `commandsAPI`, `clipboardAPI`, `authAPI`, `sharedFilesAPI`, `teamAPI`, `metricsAPI`, `shellAPI`, and `codexTerminalAPI`.
- `mac-app/electron/main/`: privileged Electron main-process code. It owns local filesystem access, OS integration, child processes, auth/session handling, Supabase clients, sync services, and release/update behavior.
- `mac-app/electron/main/index.ts`: the largest integration file. It wires windows, IPC handlers, app lifecycle, permissions, auth, updater behavior, and many feature managers.
- `mac-app/electron/main/fieldTheoryPaths.ts`: canonical paths for `~/.fieldtheory`, the Library, Commands, Ideas, bookmarks, and River shared cache paths.
- `mac-app/electron/main/userDataManager.ts`: per-user app data paths under Electron `app.getPath("userData")`.
- `mac-app/electron/main/authManager.ts`: Supabase session persistence and CLI session mirror behavior.
- `mac-app/electron/main/sharedSyncService.ts`: River shared document sync.
- `mac-app/electron/main/librarySyncService.ts`: internally gated Library sync.
- `mac-app/electron/main/commandSyncService.ts`: internally gated command/mobile sync.
- `mac-app/electron/main/releaseSyncPolicy.ts`: internal sync gate controlled by preferences and environment variables.
- `mac-app/electron/main/*Manager.ts`: feature managers for clipboard, librarian, commands, metrics, quota, feedback, transcription, terminal, agents, and other app surfaces.
- `mac-app/electron/native/`: Swift native helper code used by full/native packaging and native dev flows.
- `mac-app/scripts/`: local development helpers, native/Whisper/Gemma setup, packaging guards, and notarization scripts.
- `mac-app/resources/`: bundled resources such as model metadata, chatterbox reference voice assets, and ignored model binaries.
- `mac-app/public/`: renderer public assets, including sounds, onboarding art, icons, and static files.
- `mac-app/build/`: macOS packaging entitlements and packaging support.

## Current documentation status

- `mac-app/README.md`: too thin and partly stale for public contributors. It tells users to copy `.env.example`, but no `mac-app/.env.example` exists in the current tree.
- `mac-app/PRIVACY_POLICY.md`: stale for current Mac behavior. It says Supabase is for iOS sync only, but current Mac code also uses Supabase for auth, metrics, quota/account checks, feedback, public sharing, River, and optional sync. It also says API keys are stored in Keychain, while Supabase session persistence is file-backed in `supabase-session.json`.
- `mac-app/docs/ARCHITECTURE.md`: useful historical context, but stale around shared clipboard, mobile sync, social sync, and the current River/shared sync shape.
- `mac-app/docs/RELEASE_WORKFLOW.md`: stale for open source. It describes private source and separate public release publishing.
- `mac-app/docs/RELEASE_CHECKLIST.md`: version-specific and stale relative to the current package version.
- `mac-app/CHANGELOG.md`: stops before the current app version.

## Public-readiness caution zones

- Release and updater docs still assume private maintainer infrastructure.
- Remaining audio/image/icon assets need provenance and license review. Reference voice audio was removed during readiness cleanup and should not be reintroduced without consent and redistribution notes.
- Native helper, Whisper, Gemma, and local model paths need clear contributor setup expectations.
- Account-backed Supabase behavior needs fresh privacy language.
- Internal or disabled sync surfaces need to be named so contributors do not treat them as broken default features.
- Large files such as `electron/main/index.ts`, `electron/preload.ts`, `src/components/LibrarianView.tsx`, `src/components/ClipboardHistory.tsx`, and `electron/main/librarianManager.ts` are functional but hard for a public contributor to navigate.
