# Field Theory Native (Scaffold)

Initial native macOS scaffold for a full Swift rewrite of the current Electron app.

## Run

```bash
cd mac-native
swift run FieldTheoryNativeApp
```

## Test

```bash
cd mac-native
swift test
```

## Current scope

- Native `SwiftUI` app shell with menu bar entry.
- Clipboard History window scaffold.
- Command Launcher window scaffold.
- Settings window scaffold.
- Service protocols for hotkeys, permissions, transcription, sync, and persistence.
- Global key monitoring wired for configured shortcuts (transcription + placeholders for other actions).
- Native transcription path with interchangeable engines:
  - records 16kHz mono WAV files under `~/Library/Application Support/Field Theory Native/recordings`
  - transcribes locally via selectable engines (`whisper` or `qwen`)
  - `whisper` uses `build-whisper/bin/whisper-cli` when available
  - `qwen` uses `mac-app/scripts/qwen-transcribe.py` + local python environment when available
  - Qwen transcriptions use a persistent Python server process (`--server`) with automatic one-retry restart
  - auto-detects existing Whisper models from legacy Field Theory app data directories
  - auto-selects recording backend:
    - `FieldTheoryHelper` bridge (preferred when helper binary is available)
    - `AVAudioRecorder` fallback
  - preserves helper-produced temp recordings by copying them into native recordings storage (no destructive move/delete)
  - exposes engine diagnostics (including Qwen dependency checks for `mlx-audio`)
  - supports manual recording snapshot/cancel controls in menu bar, clipboard history, and settings
- Strict data safety mode:
  - Legacy app data is backed up on first launch.
  - Legacy path is treated as read-only.
  - Native app writes to `~/Library/Application Support/Field Theory Native/clipboard-native.db`.
  - Cloud writes are blocked by default.
- SQLite-backed native clipboard store with legacy read-only seeding.

## Not wired yet

- Real CoreAudio device enumeration and priority mic enforcement.
- Live UI surfacing of helper chunk events (`recordingChunkReady`) while recording.
- Qwen environment setup/health checks and model management UX.
- Supabase auth/realtime sync.
- Window-management ("Squares"), Dynamic Island, and Hot Mic features.

Use `MIGRATION_PLAN.md` and `PARITY_MATRIX.md` for the implementation roadmap.
See `docs/ARCHITECTURE.md` and `docs/TESTING.md` for living technical notes.
