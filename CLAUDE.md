# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

All commands run from `mac-app/` directory:

```bash
# Development
npm run dev              # Start Vite + Electron concurrently
npm run build            # Build both Electron and Vite
npm run typecheck        # TypeScript check (both configs)

# Testing
npm run test             # Run vitest once
npm run test:watch       # Watch mode

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
| `NarrationManager` | TTS orchestration (multiple engines) |
| `AuthManager` | Supabase authentication |
| `PreferencesManager` | JSON settings persistence |

Entry point: `index.ts` initializes all managers and sets up IPC handlers.

### IPC Communication

- **Preload bridge** (`preload.ts`) exposes typed APIs via `contextBridge`
- **Channel naming**: `domain:action` (e.g., `clipboard:queryItems`, `transcribe:toggle`)
- **Type definitions**: `window.d.ts` declares all `window.*API` interfaces

Example flow:
```
React → window.clipboardAPI.queryItems() → ipcRenderer.invoke('clipboard:queryItems')
     → ipcMain.handle() → ClipboardManager.queryItems() → SQLite → response
```

### React Renderer (`src/`)

- **`ClipboardHistory.tsx`** (~7000 lines): Main popup UI, search, multi-select, tabs
- **`SettingsPanel.tsx`**: Settings navigation and section rendering
- **`App.tsx`**: Settings window root (separate from clipboard popup)
- **Feature flags**: `featureFlags.ts` controls experimental features

### Data Storage

```
~/Library/Application Support/Field Theory/
├── clipboard.db          # SQLite: clipboard items
├── preferences.json      # User settings
└── .librarian-index.json # Cached reading metadata
```

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
**File**: `mac-app/src/components/ClipboardHistory.tsx` (~7000+ lines)

Key sections:
- **Lines 2988-3024**: Main component return, outer container (fills 100% of window)
- **Lines 5016-5065**: Individual item row rendering (`DraggableDroppableRow`)
- **Lines 5114-5171**: Content type icon grid (2x2 quad: transcript/image/path/text)
- **Lines 5173-5300**: Main content area with smart truncation
- **Lines 5579-5593**: Metadata display ("15 words transcribed in iTerm2 9 hrs ago")

Icon colors:
- Transcript (microphone): violet `#8b5cf6`
- Image: emerald `#10b981`
- Path/URL (folder): blue `#3b82f6`
- Plain text (T): amber `#f59e0b`
- Disabled: gray `#4b5563` (dark) / `#d1d5db` (light)

### Electron Window Management
**File**: `mac-app/electron/main/index.ts` - Main process, window creation
**File**: `mac-app/electron/main/librarianManager.ts` - Librarian window management

Window sizing is configured in main process when creating BrowserWindows.
