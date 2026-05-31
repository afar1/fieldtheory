# IPC Capability Map

This map describes what the renderer can ask the Electron main process to do through `mac-app/electron/preload.ts`. Treat each exposed global as a capability object. The renderer owns UI state. Main owns files, OS APIs, child processes, auth clients, cloud clients, and updater behavior.

This is a documentation map, not yet a generated contract. The next useful refactor is to move this information into typed channel definitions that can generate the public map automatically.

## How to read this map

Capability classes:

- `local-read`: reads local app state, Library files, preferences, diagnostics, or cached data.
- `local-write`: writes local files, preferences, databases, generated artifacts, or app state.
- `os-integration`: touches macOS APIs such as clipboard, windows, hotkeys, permissions, shell, microphone, screen capture, or app launch behavior.
- `process-execution`: starts, controls, or integrates with local command-line tools, terminals, agents, model setup, or helper processes.
- `auth-session`: signs in, signs out, persists account state, or returns session material.
- `cloud`: talks to Supabase or another remote account-backed service.
- `updater-release`: reads update status or drives signed app update flows.
- `disabled`: exposed for UI compatibility but intentionally inert.
- `dev-internal`: development, diagnostics, internal, or maintainer-oriented surface.

## Main renderer globals

| Global | Current state | Capability classes | Main owner or channel family | Contributor notes |
| --- | --- | --- | --- | --- |
| `electronAPI` | public app surface | local-read, local-write, os-integration | mixed app/window/clipboard channels in `main/index.ts` | Large legacy aggregate. It should remain treated as privileged, even when individual methods feel like UI helpers. |
| `themeAPI` | public app surface | local-read, local-write | preferences/theme handlers | Theme preference access. Low risk by itself, but still crosses the preload boundary. |
| `librarianAPI` | public app surface | local-read, local-write, cloud, process-execution | Library, Librarian, transcription, local model, and diagnostic handlers | Broad surface for Library and Librarian behavior. Important owner candidate if `main/index.ts` is split. |
| `libraryAPI` | public app surface | local-read, local-write | Library file/window handlers | Reads, writes, creates, renames, deletes, and opens Library markdown through main-owned file access. |
| `wikiAPI` | public app surface | local-read, local-write | wiki page handlers | Opens and edits wiki/library pages by logical target rather than direct renderer filesystem access. |
| `externalAPI` | public app surface with extra care | local-read, local-write | `external:*` handlers in `main/index.ts` | Opens, saves, renames, and deletes user-opened absolute markdown paths after main-process checks. This is one of the clearest privileged file-edit surfaces. |
| `markdownImagesAPI` | public app surface | local-read, local-write | markdown image handlers | Imports and serves image assets referenced from markdown. Needs path checks to stay main-owned. |
| `recentAPI` | public app surface | local-read, local-write | recent file handlers | Maintains recent document state. Low risk, but can reveal local document paths. |
| `bookmarksAPI` | public app surface | local-read, local-write, cloud | bookmark/Possible handlers | Uses local Field Theory bookmark state and related import/sync behavior. Document local paths carefully. |
| `possibleAPI` | public app surface | local-read, local-write, process-execution | Possible/ideas handlers | Local idea-generation and bookmark-derived surfaces. Contributor docs should make clear which pieces require local data. |
| `clipboardAPI` | public app surface | local-read, local-write, os-integration, process-execution, disabled | `ClipboardIPCChannels` plus direct `clipboard:*` handlers | Owns clipboard history, screenshots, paste behavior, transcription setup, local model controls, and many app preferences. Mobile transcript sync methods are exposed but inert. |
| `sharedClipboardAPI` | disabled | disabled | preload-only inert object | Team clipboard item sync is hard-disabled. Methods return empty or null values and do not sync local clipboard items. |
| `sharedFilesAPI` | account-backed public surface | local-read, local-write, cloud | `sharedFiles:*` handlers, `sharedSyncService.ts` | River shared markdown documents. Remote data lives in Supabase and local cache lives under `River (shared)`. |
| `teamAPI` | account-backed public surface | cloud | `team:*` handlers, `sharedTeamService.ts` | Team membership, contacts, invites, and shared document state. Requires auth. |
| `authAPI` | account-backed public surface | auth-session, cloud, dev-internal | `auth:*` handlers, `authManager` | `auth:getSession` returns the current Supabase session to the renderer. Simulator/debug methods are development-oriented and should not be presented as product setup. |
| `accountAPI` | account-backed public surface | local-read, cloud | `accountIpc.ts`, `account:*` handlers | Account status and manual refresh. Safer public account metadata path than full session access. |
| `quotaAPI` | account-backed public surface | local-read, cloud | `quota:*` handlers | Usage/quota checks for gated features. |
| `metricsAPI` | account-backed public surface | local-read, local-write, cloud | `metricsIpc.ts`, `metrics:*` handlers | Reads local usage metrics and can sync or fetch Supabase-backed metrics. |
| `socialAPI` | account-backed public surface | cloud | social/feedback handlers | Feedback and social feedback behavior. Requires accurate public privacy language. |
| `fieldTheorySyncAPI` | internal-gated surface | local-read, local-write, cloud | `fieldTheorySyncIpc.ts`, `releaseSyncPolicy.ts` | Full Library sync is controlled by local preference and internal environment gating. Do not document it as a default contributor feature. |
| `todoAPI` | internal or experimental surface | cloud, dev-internal | `todo:*` handlers | Tied to auth and internal/task surfaces. The visible Tasks tab is marked experimental in preload and preferences. |
| `commandsAPI` | public app surface with extra care | local-read, local-write, os-integration, process-execution, cloud | `commands:*` handlers and command launcher services | Lists and runs local commands, opens Field Theory markdown targets, inserts markdown, shares/unshares commands, and can mutate active documents through guarded flows. |
| `agentKickoffAPI` | experimental/dev surface | process-execution | `agent:*` handlers | Starts or cancels local agent kickoff flows. Useful for power users, but should be documented as advanced/local process behavior. |
| `agentImproveAPI` | public or advanced app surface | process-execution, local-read, local-write | `agent-improve:*` handler | Launches local agent-assisted improvement flows against selected context. Needs careful process and file-boundary documentation. |
| `agentHooksAPI` | advanced/dev surface | local-write, process-execution | `agent-hooks:*` handlers | Installs/uninstalls Claude/Codex hooks. Contributor docs should treat this as an advanced integration, not required setup. |
| `codexTerminalAPI` | advanced/dev surface | process-execution, os-integration, local-read, local-write | `codexTerminal:*`, `codexTerminalManager.ts` | Creates PTY sessions, sends input, reads buffers/history previews, attaches page context, and reads/writes clipboard text. High-comprehension value before public release. |
| `claudeAPI` | advanced/dev surface | process-execution | Claude integration handlers | Local agent/tooling integration. Should remain outside basic setup docs. |
| `cursorAPI` | advanced/dev surface | process-execution, os-integration | Cursor integration handlers | Local editor/agent integration. Should remain outside basic setup docs. |
| `codexReadPermissionAPI` | advanced/dev surface | local-read, local-write | Codex permission handlers | Controls read permission state for Codex-related workflows. |
| `shellAPI` | public app surface with checks | os-integration | `shellIpc.ts`, `shell:*` handlers | `shell:openExternal` permits `http:`, `https:`, `mailto:`, and `x-apple.systempreferences:` URLs. Other shell methods should remain explicit about what they open or reveal. |
| `diagnosticsAPI` | dev-internal surface | local-read, local-write | diagnostics handlers | Reads diagnostics and writes rendered-editor debug logs. Good for contributors, but privacy-sensitive if copied into issues. |
| `audioAPI` | public app surface | os-integration, local-read, local-write | audio manager channels | Audio device state and priority device behavior. |
| `gazeAPI` | experimental surface | os-integration, local-read, local-write | gaze handlers and gaze overlay preload files | Gaze windows and overlays are present but should be described as experimental until there is a public readiness note. |
| `hotkeyAPI` | public app surface | os-integration, local-read, local-write | hotkey handlers | Global hotkey state and registration. |
| `transcribeAPI` | public app surface | os-integration, process-execution, local-read, local-write | transcription handlers | Microphone, local transcription engines, setup checks, and model installation paths. |
| `permissionsAPI` | public app surface | os-integration | permission handlers | Accessibility, microphone, and screen recording permission state/events. |
| `onboardingAPI` | public app surface | local-read, local-write, os-integration | onboarding handlers/windows | First-run setup and permission flows. |
| `updaterAPI` | maintainer/release surface in packaged builds | updater-release, os-integration | `updater:*`, `buildChannel.ts` | Contributor dev does not require this. Experimental updater needs maintainer GitHub auth or `FIELD_THEORY_EXPERIMENTAL_UPDATE_TOKEN`. |
| `taggedDocsAPI` | public app surface | local-read, local-write | tagged docs database/index handlers | Local tagging and scan progress. |
| `squaresAPI` | experimental surface | local-read, local-write | Squares handlers | Present in preload; should be marked experimental until product state is clearer. |
| `hotMicAPI` | advanced/experimental surface | os-integration, process-execution | `hotmic:*` handlers | Continuous voice input for Codex terminals. Treat as advanced local automation. |
| `scenarioAPI` | dev-internal surface | local-read, local-write | scenario handlers | Scenario/testing surface. Keep out of normal contributor setup unless documenting tests. |
| `platform` | public app surface | local-read | preload-only | Exposes platform booleans. No IPC. |
| `stripeConfig` | account-backed public surface | cloud | preload-only public links | Exposes live Stripe payment and portal links. This is public configuration, not a secret. |

## Secondary preload globals

The app also has specialized preload files for auxiliary windows:

| Global | File | State | Notes |
| --- | --- | --- | --- |
| `dynamicIslandAPI` | `mac-app/electron/dynamic-island-preload.ts` | public app surface | Small window/control bridge for the dynamic island UI. |
| `toastAPI` | `mac-app/electron/toast-preload.ts` | public app surface | Toast window bridge. |
| `overlayAPI` | `mac-app/electron/overlay-preload.ts` | public app surface | Overlay window bridge. |
| `cursorStatusAPI` | `mac-app/electron/cursor-status-preload.ts` | public app surface | Cursor status overlay bridge. |
| `gazeDebugOverlayAPI` | `mac-app/electron/gaze-debug-overlay-preload.ts` | experimental/dev surface | Debug overlay for gaze behavior. |
| `gazeScreenOverlayAPI` | `mac-app/electron/gaze-screen-overlay-preload.ts` | experimental/dev surface | Screen overlay for gaze behavior. |

## High-risk or high-confusion boundaries

**Session material**

`authAPI.getSession` calls `auth:getSession` and returns the current Supabase session from main. That is a token-bearing boundary. It may be needed for existing renderer code, but the public architecture docs should call it out explicitly. A future refactor should prefer smaller account metadata APIs where full access and refresh tokens are not required.

**Absolute file mutation**

`externalAPI` can open, save, rename, and delete user-opened markdown files by absolute path. The handlers are main-owned and include safety checks. Public contributors should understand that this is intentionally not direct renderer filesystem access.

**Command-driven document mutation**

`commandsAPI.runLocalCommand` and related command launcher handlers can read current document context, generate replacement text, and write back to a document. This is core product behavior. It should stay guarded by document versions and explicit write gates.

**Local process execution**

`agentKickoffAPI`, `agentImproveAPI`, `agentHooksAPI`, `claudeAPI`, `cursorAPI`, `codexTerminalAPI`, local model setup, and transcription setup can all touch local tools or processes. They are not basic setup requirements.

**macOS privacy-sensitive APIs**

`clipboardAPI`, `transcribeAPI`, `permissionsAPI`, `audioAPI`, `hotkeyAPI`, `shellAPI`, gaze overlays, screenshot capture, paste automation, microphone capture, screen capture, and accessibility checks all touch macOS privacy surfaces. Setup docs should tell contributors which permissions are optional and which features need them.

**Cloud-backed collaboration**

`sharedFilesAPI`, `teamAPI`, `metricsAPI`, `socialAPI`, `quotaAPI`, `accountAPI`, and `authAPI` use Supabase-backed account behavior. River is the public shared document feature. Full Library sync and command/mobile sync are separate and internally gated.

## Refactor recommendation

The public codebase does not need a full IPC rewrite before release. It does need a stable owner map.

The smallest useful next code step is to create feature-owned IPC registration modules while leaving existing handler behavior intact:

- `registerLibraryIpc`
- `registerExternalMarkdownIpc`
- `registerCommandLauncherIpc`
- `registerClipboardIpc`
- `registerAuthIpc`
- `registerRiverIpc`
- `registerSyncIpc`
- `registerAgentIpc`
- `registerUpdaterIpc`
- `registerShellIpc`

The first extracted modules are `registerShellIpc` in `mac-app/electron/main/shellIpc.ts`, `registerAccountIpc` in `mac-app/electron/main/accountIpc.ts`, `registerFieldTheorySyncIpc` in `mac-app/electron/main/fieldTheorySyncIpc.ts`, and `registerMetricsIpc` in `mac-app/electron/main/metricsIpc.ts`. Each future move should keep the public channel names unchanged and should have either existing test coverage or a focused test for the moved handler. The goal is findability, not redesign.
