# Field Theory Mac Native Rewrite Plan

## Goal

Rebuild Field Theory macOS app as a first-class native Swift app (`SwiftUI + AppKit`), with behavior parity to the current Electron app in `mac-app`.

## What we have today (audit summary)

- Current app architecture: Electron main process + React renderer + Swift helper binary.
- Core module surface in `mac-app/electron/main`:
  - `index.ts` (~6.7k LOC) orchestrates app lifecycle and IPC.
  - Major domains: transcription, clipboard history, hotkeys, commands, auth/sync, hot mic, Squares window management, librarian, social/feedback, updater.
- Native helper in `mac-app/electron/native/Sources/FieldTheoryHelper/main.swift` already owns:
  - CoreAudio integration.
  - Recording and level metering.
  - Accessibility-driven typing/window actions.
- Persistence patterns:
  - SQLite (`clipboard.db`) for clipboard timeline/history.
  - JSON prefs (`preferences.json`).
  - Supabase session storage (`supabase-session.json`).
- Cloud integration:
  - Supabase auth + realtime for todos/messages/sync.
  - Edge functions for usage + text improve.

## Rewrite strategy

1. Keep behavior parity as default.
2. Reuse existing native helper logic where possible, then fold into app target incrementally.
3. Replace Electron IPC contracts with strongly typed in-process Swift services.
4. Preserve data continuity by reading existing on-disk data formats first, then migrating in place.
5. Ship behind a feature flag/beta channel before replacing production app.

## Target native architecture

- `Application`:
  - `AppModel` (state coordinator, scene state, feature orchestration).
  - `AppDelegate` (launch policy, lifecycle hooks).
- `Features`:
  - Clipboard History.
  - Command Launcher.
  - Transcription/Overlay.
  - Settings/Onboarding.
- `Infrastructure`:
  - `HotkeyService` (Carbon/EventTap based registration).
  - `PermissionService` (microphone/accessibility/screen recording checks).
  - `AudioDeviceService` (CoreAudio graph + priority mic enforcement).
  - `TranscriptionService` (Whisper/Qwen abstraction).
  - `Persistence` (SQLite + JSON stores).
  - `SyncService` (Supabase auth + realtime channels).

## Delivery phases

### Phase 0: Foundation

- Native shell, scenes, settings shell, core service protocols.
- Done in this commit as initial scaffold.

### Phase 1: P0 parity slice

- Global hotkeys:
  - transcription, screenshot, clipboard history, command launcher.
- Transcription pipeline:
  - record start/stop/cancel, overlay states, whisper execution.
- Clipboard timeline:
  - SQLite schema compatibility, search, paste/copy/delete.
- Basic settings:
  - hotkeys, permissions, startup policy.

### Phase 2: Core productivity parity

- Stack workflows (stack id, batch paste, improved content toggles).
- Screenshot capture variants:
  - region/full-screen/active-window.
- Commands:
  - watched directories, invoke, handoff support.
- Supabase auth + mobile transcript/todo sync.

### Phase 3: Advanced features parity

- Hot Mic.
- Squares window management.
- Librarian.
- Dynamic Island and cursor status surfaces.
- Team/social/feedback features.

### Phase 4: Migration + hardening

- Read/convert existing user data.
- Performance and memory pass.
- Release gating, telemetry parity, crash resiliency.

## Data migration plan

- Reuse existing paths under `~/Library/Application Support/Field Theory`.
- Preserve/parse:
  - `clipboard.db`
  - `preferences.json`
  - `supabase-session.json`
- Add one-time native migration marker (same pattern as current Electron app).
- Add reversible schema migrations for any SQLite table/index evolution.

## Risks and mitigations

- Risk: feature sprawl from 30k+ LOC app.
  - Mitigation: strict phased parity with P0/P1/P2 gates.
- Risk: permission regressions (Accessibility/Screen Recording/Mic).
  - Mitigation: explicit permission state machine + onboarding checks.
- Risk: sync behavior drift.
  - Mitigation: mirror existing Supabase table contracts and conflict resolution rules.
- Risk: hotkey conflicts and OS-level registration edge cases.
  - Mitigation: keep existing conflict-detection semantics from current hotkey manager.

## Immediate next steps

1. Replace placeholder hotkey actions with native window focus/open behavior (clipboard history + launcher + screenshot flows).
2. Extend transcription diagnostics UX (surface helper/Qwen setup remediation and one-click setup actions).
3. Add richer live recording UI for helper chunk events (audio levels + harvested chunk timeline).
4. Add Supabase auth session restore and realtime todo sync (read-only first, writes behind explicit opt-in).
