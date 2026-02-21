# Native Architecture Notes

## Current shape

- App shell: `SwiftUI` scenes (`MenuBarExtra`, `Clipboard History`, `Command Launcher`, `Settings`).
- State coordinator: `AppModel` (`@MainActor` observable object).
- Services:
  - `DefaultGlobalHotkeyService`: global/local key monitoring and action dispatch.
  - `WindowRoutingService`: open/focus clipboard and launcher windows from hotkey/menu actions.
  - `DefaultTranscriptionService`: orchestrates recording + interchangeable transcription engines + diagnostics.
  - Transcription components:
    - `RecordingController` backends:
      - `HelperRecordingController` (JSON bridge to existing `FieldTheoryHelper`)
      - `AVAudioRecordingController` fallback
    - `FieldTheoryHelperBridge` supports start/stop/snapshot/cancel commands and listens for `audioLevel`/`recordingChunkReady`
    - `TranscriptionEngine` implementations (`WhisperCLITranscriptionEngine`, `QwenScriptTranscriptionEngine`)
      - Qwen engine runs through persistent `qwen-transcribe.py --server` IPC with automatic restart retry
    - `ModelLocator` (`DefaultModelLocator`) for binary/model/script discovery
    - `TranscriptionDiagnosticsProvider` for per-engine readiness reporting (includes Qwen `mlx_audio` import probe)
      - diagnostics refresh runs off the main actor and updates UI state asynchronously
  - `DefaultPermissionService`: mic/accessibility/screen capture state.
  - `NoopSyncService`: cloud writes blocked in strict safety mode.
  - `SafetyAuditor`: validates strict-mode guarantees at runtime.
- Persistence:
  - `SQLiteClipboardStore` (native DB path only).
  - `DataSafetyManager` enforces backup/read-only behavior for legacy roots.

## Safety model (non-negotiable)

- Legacy data is treated as read-only.
- Native writes go to:
  - `~/Library/Application Support/Field Theory Native/clipboard-native.db`
  - `~/Library/Application Support/Field Theory Native/recordings/`
- Cloud writes are blocked by default.
- Delete operations are blocked by default.
- First-run backup copies legacy files to:
  - `~/Library/Application Support/Field Theory Native/legacy-backups/<timestamp>/...`

## Known limitations

- Screenshot and continuous-context hotkey actions are not fully implemented yet.
- Manual snapshot/cancel controls are wired, but live UI feedback for auto-harvest chunk events is still minimal.
- Qwen diagnostics currently verify script/python + `mlx_audio` import; richer model lifecycle management UI is still pending.

## Refactor queue

1. Define a stricter persistence boundary:
   - Move SQL + mapping into dedicated repository types.
   - Add migration versioning table for native schema evolution.

2. Extend `SafetyAuditor` checks:
   - Add checks for accidental feature regressions (delete endpoints, sync write toggles).
   - Emit diagnostics in UI and tests.

3. Prepare sync service contracts for staged enablement:
   - Read-only phase first.
   - Explicit config switch required before any write path exists.
