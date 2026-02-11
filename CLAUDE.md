# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

All commands run from `mac-app/` directory:

```bash
# Development
npm run dev              # Start Vite + Electron concurrently
npm run dev:experimental # Dev with experimental features enabled
npm run build            # Build both Electron and Vite
npm run typecheck        # TypeScript check (both configs)

# Testing
npm run test             # Run vitest once
npm run test:watch       # Watch mode
npm run test -- src/__tests__/syncUtils.test.ts  # Run specific test file

# Native builds (required for full functionality)
npm run build:native     # Build Swift helper (audio/permissions)
npm run build:whisper    # Build whisper-cli for transcription
npm run build:all        # Build everything (native + whisper + app)

# Packaging
npm run package          # Full build + electron-builder → release/
```

## Architecture

### Electron Main Process (`electron/main/`)

Manager pattern with EventEmitter for inter-component communication:

| Manager | Purpose |
|---------|---------|
| `ClipboardManager` | SQLite clipboard history, screenshot capture |
| `TranscriberManager` | Whisper transcription, audio recording |
| `AudioManager` | Audio devices, priority mic enforcement |
| `LibrarianManager` | `.librarian/` file watching, reading metadata |
| `AuthManager` | Supabase authentication |
| `PreferencesManager` | JSON settings persistence (serialized saves) |
| `QuotaManager` | Usage tracking and tier limits |
| `CommandsManager` | Portable commands (markdown files) |
| `MetricsManager` | User-visible usage statistics |
| `UserDataManager` | Per-user data isolation (paths by user ID) |

Entry point: `index.ts` initializes all managers and sets up IPC handlers.

### IPC Communication

- **Preload bridge** (`preload.ts`) exposes typed APIs via `contextBridge`
- **Channel naming**: `domain:action` (e.g., `clipboard:queryItems`, `transcribe:toggle`)
- **Type definitions**: `src/types/window.d.ts` declares all `window.*API` interfaces (authoritative reference)

Example flow:
```
React → window.clipboardAPI.queryItems() → ipcRenderer.invoke('clipboard:queryItems')
     → ipcMain.handle() → ClipboardManager.queryItems() → SQLite → response
```

### Authentication Architecture (CRITICAL)

**AuthManager is the single source of truth for authentication.** This design prevents random logout bugs caused by multiple auth states conflicting.

```
┌─────────────────────────────────────────────────────────────────────┐
│                         MAIN PROCESS                                │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  AuthManager (single source of truth)                        │   │
│  │  - Owns Supabase client with auth session                    │   │
│  │  - Handles login, logout, token refresh                      │   │
│  │  - Exposes getSupabaseClient() for other managers            │   │
│  └─────────────────────────────────────────────────────────────┘   │
│         │                                                           │
│         │ getSupabaseClient()                                       │
│         ▼                                                           │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Other Managers (feedbackManager, todoStore, etc.)           │   │
│  │  - Use authManager.getSupabaseClient() for DB operations     │   │
│  │  - Never manage auth state themselves                        │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
         │
         │ IPC (ipcMain.handle / ipcRenderer.invoke)
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         RENDERER PROCESS                            │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Supabase Client (supabaseClient.ts)                         │   │
│  │  - persistSession: false (NO auth state)                     │   │
│  │  - ONLY used for realtime subscriptions                      │   │
│  │  - NEVER call setSession() or manipulate auth                │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  For authenticated DB operations:                                   │
│  window.someAPI.doThing() → IPC → main process → Supabase          │
└─────────────────────────────────────────────────────────────────────┘
```

**DO NOT:**
- Call `supabase.auth.setSession()` in the renderer
- Create additional Supabase clients with auth
- Bypass IPC for authenticated database operations

**DO:**
- Route authenticated operations through IPC to main process
- Use `authManager.getSupabaseClient()` in main process managers
- Keep renderer Supabase client for realtime subscriptions only

Example of correct pattern (from commandSyncService.ts):
```typescript
const supabase = this.authManager.getSupabaseClient();
await supabase.from('user_commands').insert({...});
```

### Multi-Window Architecture

The app has multiple separate React entry points (each a separate HTML file):

| Window | Entry Point | Purpose |
|--------|-------------|---------|
| Clipboard History | `clipboard-history.tsx` | Main popup (Control+Alt+Space) |
| Settings | `App.tsx` | Settings panel |
| Onboarding | `onboarding.tsx` | First-run wizard |
| Recording Overlay | `overlay.tsx` | Transcription UI overlay |
| Cursor Status | `cursor-status.tsx` | Status indicator |
| Command Launcher | `command-launcher.tsx` | Cmd+Shift+K launcher |
| Scenario Testing | `scenario-testing.tsx` | Dev/superadmin testing |

### React Renderer (`src/`)

- **`ClipboardHistory.tsx`** (~8000 lines): Main popup UI, search, multi-select, tabs
- **`SettingsPanel.tsx`**: Settings navigation and section rendering
- **`App.tsx`**: Settings window root (separate from clipboard popup)
- **Feature flags**: `featureFlags.ts` controls experimental features

### Native Swift Helper (`electron/native/`)

`FieldTheoryHelper` provides macOS-specific functionality:
- CoreAudio device enumeration and default input management
- System permission checks (Accessibility, Input Monitoring, Microphone)
- Low-latency audio recording to WAV files (16kHz mono)
- Real-time audio level metering

Build: `npm run build:native`

### Data Storage

```
~/Library/Application Support/Field Theory/
├── clipboard.db              # SQLite: clipboard items (shared)
├── preferences.json          # Legacy prefs (pre-login)
└── users/<user-id>/          # Per-user data (when logged in)
    ├── preferences.json      # User settings
    └── .librarian-index.json # Cached reading metadata
```

Logged-in users get isolated data via `UserDataManager`. Legacy paths used when logged out.

### Supabase Edge Functions (`supabase/functions/`)

| Function | Purpose |
|----------|---------|
| `delete-account` | Account deletion API |
| `get-usage` | Quota/usage tracking |
| `improve-text` | Claude API proxy for text improvements |
| `stripe-webhook` | Payment webhook handler |

Deploy: `supabase functions deploy <function-name>`

## iOS App (React Native + Expo)

The iOS companion app lives in the repo root (`App.tsx`, `hooks/`, `services/`). It provides:
- Voice recording with on-device Whisper transcription
- Sync to Supabase for Mac retrieval
- Cursor browser integration

See `PRODUCT_OVERVIEW.md` for detailed iOS architecture.

## Releases

**IMPORTANT**: The mac-app auto-updater checks `afar1/field-releases` (not `afar1/oscar`).

When releasing:
1. Build and package: `npm run package`
2. Notarize: use credentials from `/Users/afar/dev/fieldtheory/.env.local`
3. Staple: `xcrun stapler staple <dmg>`
4. Upload to **field-releases**: `gh release create vX.X.X --repo afar1/field-releases ...`
5. Rename files to use periods not spaces: `Field.Theory-X.X.X-arm64.dmg`

## Key Files Reference

### ClipboardHistory Component
**File**: `mac-app/src/components/ClipboardHistory.tsx` (~8000 lines)

This is the main UI component. Key areas:
- Main component return and outer container
- Individual item row rendering (`DraggableDroppableRow`)
- Content type icon grid (2x2 quad: transcript/image/path/text)
- Main content area with smart truncation
- Metadata display ("15 words transcribed in iTerm2 9 hrs ago")

Icon colors:
- Transcript (microphone): violet `#8b5cf6`
- Image: emerald `#10b981`
- Path/URL (folder): blue `#3b82f6`
- Plain text (T): amber `#f59e0b`
- Disabled: gray `#4b5563` (dark) / `#d1d5db` (light)

### Type Definitions
- **`src/types/window.d.ts`**: All `window.*API` interfaces for IPC - the authoritative reference for renderer-to-main communication
- **`electron/main/types/`**: Domain-specific types (audio, clipboard, commands, etc.)

### Electron Window Management
**File**: `mac-app/electron/main/index.ts` - Main process, window creation
**File**: `mac-app/electron/main/librarianManager.ts` - Librarian window management

Window sizing is configured in main process when creating BrowserWindows.

## Claude Code Hook System (Librarian Artifacts)

The Librarian hook system creates reflective artifacts based on conversation activity. **DO NOT MODIFY** without understanding this architecture.

### How It Works

```
User sends prompt
       ↓
┌─────────────────────────────────────────────────────────┐
│  UserPromptSubmit Hook (hook.py)                        │
│  1. Increment global counter in state.json              │
│  2. If count >= threshold: create job, output context   │
└─────────────────────────────────────────────────────────┘
       ↓
Claude sees additionalContext: "[STATE-ENFORCED] Before responding, write this artifact..."
       ↓
Claude writes artifact to ~/.fieldtheory/librarian/artifacts/
       ↓
┌─────────────────────────────────────────────────────────┐
│  PreToolUse Hook (pretool.py)                           │
│  Auto-approves Write/Edit to ~/.fieldtheory/librarian/  │
└─────────────────────────────────────────────────────────┘
       ↓
Claude updates job status to "done"
```

### Files

| File | Purpose |
|------|---------|
| `~/.claude/settings.json` | Hook registration |
| `~/.fieldtheory/librarian/hook.py` | Counter + job creation + context injection |
| `~/.fieldtheory/librarian/pretool.py` | Auto-approve file ops to librarian dir |
| `~/.fieldtheory/librarian/config.json` | Enable/disable, rule content |
| `~/.fieldtheory/librarian/state.json` | Global count + threshold (game mechanics) |
| `~/.fieldtheory/librarian/jobs/` | Job files (pending/done status) |
| `~/.fieldtheory/librarian/artifacts/` | Generated artifact markdown files |

### Key Mechanisms

**1. Counter + Threshold (Game Mechanics)**
- `state.json` stores `{"count": N, "threshold": M}`
- Field Theory app can adjust threshold dynamically
- Hook just increments and checks, doesn't set threshold

**2. Context Injection via `additionalContext`**
```python
print(json.dumps({
    "hookSpecificOutput": {
        "hookEventName": "UserPromptSubmit",
        "additionalContext": "[STATE-ENFORCED] Before responding, write this artifact..."
    }
}))
```
This injects instructions into Claude's context so it knows to create the artifact.

**3. Auto-Approval via PreToolUse**
```python
print(json.dumps({
    "hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "allow"
    }
}))
```
This lets Claude write to `~/.fieldtheory/librarian/` without permission prompts.

### DO NOT

- Remove or modify `additionalContext` output - this is how Claude knows to create artifacts
- Change the `hookSpecificOutput` JSON structure - Claude Code expects this exact format
- Move counting logic to PreToolUse - that hook fires per-tool, not per-prompt
- Create "auto-generate" static artifacts - defeats the purpose of AI-written reflections

### Developer Setup

To enable auto-approval for Field Theory paths (figures, commands, librarian), run:

```bash
.claude/hooks/setup.sh
```

This installs a PreToolUse hook that auto-approves Read/Write/Edit for:
- `~/.fieldtheory/librarian/*` - Librarian artifacts and jobs
- `~/Library/Application Support/fieldtheory-mac/figures/*` - Screenshot figures
- `.cursor/commands/*` - Portable commands

The hook runs independently of whether the Librarian is enabled. Source: `.claude/hooks/pretool.py`
