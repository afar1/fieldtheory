# Electron -> Native Parity Matrix

| Domain | Current implementation | Native target | Phase |
| --- | --- | --- | --- |
| App lifecycle + orchestration | `mac-app/electron/main/index.ts` | `AppModel` + scene coordinators | 1 |
| Global hotkeys | `hotkeyManager.ts` + manager-specific registration | `HotkeyService` | 1 |
| Transcription state machine | `transcriberManager.ts` | `TranscriptionService` | 1 |
| Native recording + levels | `electron/native/.../main.swift` | Helper bridge wired (`start/stop/snapshot/cancel` + fallback recorder); auto-chunk transcription on stop + manual snapshot/cancel controls | 1 |
| Clipboard timeline persistence | `clipboardManager.ts` (`clipboard.db`) | SQLite store + FTS in Swift | 1 |
| Clipboard history UI | `src/components/ClipboardHistory.tsx` | `ClipboardHistoryView` | 1 |
| Screenshot capture flows | `clipboardManager.ts` capture methods | AppKit capture service | 2 |
| Command launcher | `commandLauncherWindow.ts` + `src/command-launcher.tsx` | `CommandLauncherView` | 2 |
| Portable commands | `commandsManager.ts` + `commandSyncService.ts` | `CommandService` + sync adapters | 2 |
| Settings | `src/components/SettingsPanel.tsx` | `SettingsRootView` + feature forms | 1/2 |
| Auth/session persistence | `authManager.ts` | Supabase auth service in Swift | 2 |
| Todo realtime sync | `todoStore.ts` | Realtime todo service in Swift | 2 |
| Social/feedback | `socialSync.ts` + `feedbackManager.ts` | Native social service | 3 |
| Librarian | `librarianManager.ts` + `LibrarianView.tsx` | Native librarian module | 3 |
| Hot Mic | `hotMicManager.ts` | Native hot mic engine | 3 |
| Squares window manager | `squaresManager.ts` | Native window action engine | 3 |
| Dynamic Island + cursor status | `dynamicIslandManager.ts` + `cursorStatusManager.ts` | Native overlay windows | 3 |
| Updater/notarization flow | `electron-updater` + builder config | Sparkle or custom updater | 4 |
| Diagnostics + metrics | `diagnosticsCollector.ts` + `metricsManager.ts` | Native diagnostics/telemetry | 4 |

## Scaffold status

- Added in this repo under `mac-native`.
- Runs as a native menu bar Swift app.
- Includes starter windows for clipboard history, command launcher, and settings.
- Strict safety mode is enforced (legacy backups + read-only legacy access + cloud writes blocked).
- Global key monitoring is wired from user-configurable shortcuts.
- Clipboard history and command launcher hotkeys now route to native open/focus actions.
- Local transcription flow is wired with interchangeable engines (`whisper` + `qwen`), with automatic fallback to available engines.
- Qwen engine now runs through a persistent server process with restart retry (matching Electron design direction).
- Recording backend auto-selects helper binary when present, otherwise falls back to `AVAudioRecorder`.
- Engine diagnostics now report Whisper/Qwen readiness and Qwen dependency guidance.
