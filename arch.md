# Field Theory Repo Map

Start in `mac-app/` unless the task clearly says `ios/`, `md/`, `townsquare/`, `www/`, or the repo-root Expo app.

The product intent is a local-first personal operating surface: capture, think, write, organize, and trigger agents from macOS using markdown and local files as durable artifacts. The author keeps pushing toward non-destructive behavior, editable command files, and filesystem truth over opaque app state. Auth, sync, and cloud features exist, but they are layered on top and often gated; do not treat the server as the default source of truth for core behavior.

## Fast Orientation

- The real product is the mac app in `mac-app/`.
- The main durable user surface is `~/.fieldtheory/library/`.
- Portable commands live in `~/.fieldtheory/library/Commands/` and are normal markdown files, not hardcoded config.
- Librarian artifacts and command-job side effects live under `~/.fieldtheory/librarian/`.
- This repo also contains adjacent apps and large upstream/runtime code. Do not start at the repo root unless the task points there.

## Trust Order

1. `mac-app/electron/main/index.ts`
   The real app spine: windows, IPC, hotkeys, persistence, updater flow, path policy wiring, auth/session restore, and manager startup.
2. `mac-app/src/components/ClipboardHistory.tsx`
   The main desktop shell. It owns the top-level view switching between clipboard, Library, Possible, settings, and adjacent flows.
3. `mac-app/src/command-launcher.tsx`
   Separate renderer entry for the command launcher. Use this for launcher search, command execution UI, recents, file/app search, and preview behavior.
4. `mac-app/electron/main/fieldTheoryPaths.ts`
   Canonical local path policy. Data lives under `~/.fieldtheory/`; Library is `~/.fieldtheory/library`; commands are `~/.fieldtheory/library/Commands`; `~/.ft-bookmarks` is legacy compatibility.

## Main Renderer Surfaces

- `mac-app/src/components/LibrarianView.tsx`
  Library reader/editor for wiki pages, artifacts, bookmarks, and external markdown.
- `mac-app/src/components/MarkdownCodeEditor.tsx`
  Start here for actual Library editing behavior. This is the active editor seam.
- `mac-app/src/components/CommandsView.tsx`
  Command management inside the main shell. Command files are first-class markdown documents.
- `mac-app/src/command-launcher.tsx`
  Fast launcher surface for built-in actions, commands, bookmarks, files, apps, clipboard items, and move/open actions.
- `mac-app/src/components/FieldTheoryProse.tsx`
  Shared markdown renderer. Important, but not the main editing owner.
- `mac-app/src/main.tsx` and `mac-app/src/App.tsx`
  Renderer entry for the settings/onboarding window, not the main desktop shell.

## Main-Process Systems

- `ClipboardManager`, `ClipboardHistoryWindow`, `HotMicManager`, `AudioManager`, `TranscriberManager`
  Core capture, dictation, transcription, and popup-window behavior.
- `LibrarianManager`, `DocumentSaveGuard`, `pathSafety`, `libraryMigration`
  The real local-document control plane: watched Library folders, safe writes, rename/move rules, and legacy-to-canonical path migration.
- `CommandsManager`, `CommandLauncherWindow`, `CommandSyncService`, `LibrarySyncService`
  Portable commands, launcher plumbing, and the gated sync layer.
- `AgentKickoffManager`, `AgentHookInstaller`, `LocalLlmManager`, `MaxwellRunManager`
  Agent kickoff, local-model execution, and long-running command/automation flows.
- `AccountStatusManager`, `releaseSyncPolicy`, `useAuthSessionBridge`
  Account state exists, but it wraps local capability instead of defining the whole product.
- `SquaresManager`, `DynamicIslandManager`, `MeetingManager`, `TaggedDocsManager`, `RecentManager`
  Window actions, floating recording UI, meeting flows, tagged-doc scanning, and recents.
- `possibleIdeasManager`
  Loads Possible idea batches.
- `gaze/`
  Eye-tracking and overlay work already wired into the Electron main process.

## Other Trees In This Repo

- `App.tsx` at the repo root and `ios/`
  Separate Expo/mobile client plus native iOS work. Real product code, but not the default surface for macOS tasks.
- `mac-native/`
  Swift rewrite scaffold. Directionally important, but not feature-parity truth.
- `md/`
  Separate Atomic knowledge-base app/codebase inside this repo. Do not confuse its architecture or editor stack with Field Theory's.
- `townsquare/`, `www/`, `og-service/`
  Adjacent web properties and support services, not the main desktop app.
- `src/`, `ggml/`, `include/`, `examples/`, `bindings/`, `models/`, `tests/`
  Upstream/runtime-heavy code and build artifacts that support local model work. Important when touching transcription/runtime plumbing, but usually not where product behavior changes start.

## Working Model

The author is building a personal tool that stays close to the filesystem. Favor local data safety, visible user control, markdown as the durable format, commands as editable documents, and opt-in cloud features instead of cloud replacement.

If a task touches local storage, path migration, or where artifacts belong, trust `fieldTheoryPaths.ts` before older docs.
If a task touches Library editing, start in `LibrarianView.tsx`, `MarkdownCodeEditor.tsx`, and the save/path helpers behind them, not just the renderer.
If a task touches commands or automations, assume markdown command files plus `LibrarianManager` are part of the product surface, not just tooling.
If a task touches auth or sync, check whether it is release-gated before assuming it is part of the default user path.
If docs and code disagree, trust the live code.
