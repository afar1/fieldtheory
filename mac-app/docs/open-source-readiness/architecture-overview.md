# Architecture Overview

Field Theory Mac is an Electron app with a React/Vite renderer, a privileged Electron main process, and a large preload bridge. The simplest accurate mental model is:

Renderer code draws the interface and requests capabilities. Electron main owns the filesystem, OS APIs, child processes, auth clients, cloud clients, and release/update behavior. The preload layer exposes typed capability objects that let the renderer ask main to perform those privileged actions.

## Runtime layers

- React renderer: `mac-app/src`.
- Preload bridge: `mac-app/electron/preload.ts`.
- Electron main process: `mac-app/electron/main`.
- Native helper: `mac-app/electron/native`.
- Static and bundled resources: `mac-app/public`, `mac-app/resources`, and `mac-app/electron/assets`.
- Build and packaging scripts: `mac-app/scripts`, `mac-app/package.json`, `mac-app/electron-builder.experimental.json`, and `mac-app/build`.

The app uses Electron security basics in its main BrowserWindow surfaces: the renderer does not get direct Node access, and the preload bridge is the intended boundary.

## Main application surfaces

- Library and markdown editor: local markdown reading, editing, creation, rename, delete, search, images, sketches, and rendered/editor modes.
- Command launcher: local command discovery and execution against active documents, including local model-backed replacement flows.
- Clipboard history: local clipboard capture, local SQLite persistence, screenshot/sketch/paste handling, and paste automation into other apps.
- Transcription and voice: microphone permission, local transcription engines, Whisper/MLX/Parakeet setup, and audio device behavior.
- Bookmarks and Possible/ideas: local bookmark and idea surfaces under Field Theory paths.
- Auth/account: Supabase sign-in/out, session persistence, account status, quota/usage checks, and account deletion requests.
- River: account-backed shared markdown documents stored remotely and cached locally under the Library.
- Sync: internal-gated Library sync, internal-gated command/mobile sync, and River shared document sync.
- Agent and terminal surfaces: launching agent workflows, Terminal integration, local PTY sessions, and transcript/context files.
- Release/update: production and experimental build channels, GitHub release feeds, signing, packaging, and updater behavior.

## Local Field Theory paths

Canonical user-authored Field Theory state lives under `~/.fieldtheory`:

- `~/.fieldtheory/library`: the Library.
- `~/.fieldtheory/library/Commands`: portable commands.
- `~/.fieldtheory/ideas`: ideas and Possible-related local data.
- `~/.fieldtheory/bookmarks`: bookmark state, with a legacy fallback to `~/.ft-bookmarks`.
- `~/.fieldtheory/library/River (shared)`: local managed cache for River shared files.
- `~/.fieldtheory/library/Conflicts`: conflict output for shared/sync flows.
- `~/.fieldtheory/session.json`: CLI-facing account mirror with user metadata and expiry, not Supabase access or refresh tokens.

The canonical code for these paths is `mac-app/electron/main/fieldTheoryPaths.ts`.

## Electron user data paths

Electron app data lives under `app.getPath("userData")`. Per-account data is stored under `users/{userId}`.

Examples include:

- `supabase-session.json`
- `preferences.json`
- `clipboard.db`
- `user-metrics.json`
- `librarian-settings.json`
- `librarian-index.json`
- `commands-settings.json`
- `tagged.db`
- `figures/`

The relevant code starts in `mac-app/electron/main/userDataManager.ts`, with feature-specific files owned by managers such as `clipboardManager.ts`, `librarianManager.ts`, and `commandsManager.ts`.

## IPC and preload boundary

`mac-app/electron/preload.ts` exposes many globals through `contextBridge.exposeInMainWorld`. Public contributor docs should treat these as capability objects, not as ordinary UI helpers.

The detailed inventory is in [IPC capability map](./ipc-capability-map.md). The short version is that renderer code can request local file reads/writes, macOS integrations, account/cloud operations, update checks, command execution, and local agent/terminal behavior, but those requests are supposed to cross through preload and main-owned handlers.

Important exposed APIs include:

- `librarianAPI`, `libraryAPI`, `wikiAPI`, `externalAPI`, `markdownImagesAPI`: local markdown and Library reads/writes, including user-opened external markdown files.
- `commandsAPI`: local command listing, command settings, and `runLocalCommand` document mutation flows.
- `clipboardAPI`: clipboard history, screenshots, images, sketches, and paste automation.
- `authAPI`, `accountAPI`, `quotaAPI`: Supabase auth/session/account/quota behavior.
- `sharedFilesAPI`, `teamAPI`: River shared documents and team-related state.
- `fieldTheorySyncAPI`, `todoAPI`: internal or gated sync-related behavior.
- `metricsAPI`: local and remote usage metrics.
- `shellAPI`: external URL, system settings, and file/folder reveal behavior.
- `agentImproveAPI`, `agentKickoffAPI`, `codexTerminalAPI`: process and terminal integration.
- `permissionsAPI`, `onboardingAPI`, `hotkeyAPI`, `transcribeAPI`, `audioAPI`, `gazeAPI`, `updaterAPI`: OS permissions and feature-specific controls.

High-risk or confusing IPC categories:

- Session material: auth/session IPC can return token-bearing session data to the renderer.
- Absolute file editing: `externalAPI` can operate on user-opened absolute markdown paths after checks.
- Local process execution: agent, terminal, setup, and command APIs can spawn local processes or open Terminal.
- Local document mutation: `commandsAPI.runLocalCommand` reads active files, generates replacements, and writes back through a version-guarded flow.
- OS automation: clipboard/paste/screenshot and system settings paths touch macOS privacy-sensitive capabilities.

Many local write paths check `canWriteFieldTheoryContent()` before mutating user content. Public docs and refactors should preserve that concept as a clear write gate.

## Supabase and account-backed behavior

Supabase is not only an iOS sync dependency. Current Mac code uses Supabase for:

- auth and profile/session state;
- quota and usage/account status checks;
- metrics sync;
- feedback and social feedback;
- public shared readings;
- River shared documents, team document pins, contacts/team membership, and presence;
- optional Library sync;
- optional command/mobile sync;
- gated todos.

The production Supabase URL and publishable key have fallback values in code. That key is public client configuration. The security boundary should be auth, row-level security, Edge Functions, and server-side checks.

## River

River is the current shared markdown feature.

Remote data uses Supabase tables such as:

- `team_documents`
- `team_document_pins`
- `contacts`

Local managed cache files live under:

- `~/.fieldtheory/library/River (shared)`

Conflict files live under:

- `~/.fieldtheory/library/Conflicts`

River is account-backed and team-aware. It should not be documented as the same thing as full private Library sync.

## Internal, disabled, or experimental surfaces

Some surfaces exist in code but should not be presented as default public features yet:

- Full Library sync is gated by `fieldTheoryInternalSyncEnabled` or `FIELD_THEORY_INTERNAL_SYNC_ENABLED`.
- Command mobile sync and todo setup are also tied to the internal sync gate.
- Shared clipboard is hard-disabled in the current public-facing preload shape.
- Mobile transcript sync returns inert values in preload.
- Experimental updates require private maintainer access to `afar1/oscar` assets through `FIELD_THEORY_EXPERIMENTAL_UPDATE_TOKEN` or GitHub auth.
- Gaze, local model, transcription engine, and agent surfaces may need separate feature-readiness notes before inviting broad contribution.

## Release and packaging shape

Local development is not the same as packaging.

`npm run dev`, `npm run typecheck`, `npm test`, and `npm run build` are contributor-facing commands.

`npm run package` and `npm run package:experimental` are maintainer-oriented. They enforce release branches, build native and Whisper artifacts, run package safety checks, invoke Electron Builder, and depend on signing/notarization/release configuration.
