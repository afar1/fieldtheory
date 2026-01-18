# Hotkey Architecture Documentation

> **Status**: Pre-refactor documentation
> **Date**: 2026-01-15
> **Purpose**: Document current state before consolidation refactor

---

## Overview

The app currently manages hotkeys across multiple systems with no centralized management. This document captures the current architecture, known issues, and serves as a reference for the upcoming refactor.

---

## Current Hotkey Inventory

### Customizable Hotkeys (stored in preferences)

| Hotkey | Default | Preference Key | Manager |
|--------|---------|----------------|---------|
| Take Screenshot | `Alt+4` | `clipboardScreenshotHotkey` | ClipboardManager |
| Full Screen Screenshot | `Alt+3` | `clipboardDesktopScreenshotHotkey` | ClipboardManager |
| Active Window Screenshot | `Shift+Alt+3` | (not in prefs) | ClipboardManager |
| Clipboard History | `Alt+Space` | `clipboardHistoryHotkey` | ClipboardManager |
| Continuous Context | `Shift+Alt+4` | `continuousContextHotkey` | ClipboardManager |
| Transcription | `Cmd+\` | `transcriptionHotkey` | TranscriberManager |
| Secondary Transcription | (none) | `transcriptionSecondaryHotkey` | TranscriberManager |
| Abandon Recording | `Escape` | `abandonRecordingHotkey` | TranscriberManager |
| TODO List | `Cmd+Shift+T` | `todoHotkey` | Direct registration |

### Hardcoded Hotkeys (not customizable)

| Hotkey | Combination | Location | Purpose |
|--------|-------------|----------|---------|
| Tasks Toggle | `Cmd+Shift+T` | index.ts:279 | Toggle tasks view |
| Super Paste | `Cmd+Shift+V` | index.ts:308 | Smart paste |
| Auto-Improve | `Cmd+Shift+\` | index.ts:459 | Toggle auto-improve |
| Command Launcher | `Cmd+Shift+K` | index.ts:494 | Open command launcher |
| Improve Text | `Cmd+Shift+I` | index.ts:529 | Improve selected text |
| Reset Onboarding | `Cmd+Shift+O` | index.ts:4721 | Dev mode only |

---

## State Storage Locations

### 1. Preferences File (persistent)
**Location**: `~/Library/Application Support/littleai-mac/preferences.json`

```typescript
interface Preferences {
  transcriptionHotkey?: string;
  transcriptionSecondaryHotkey?: string;
  abandonRecordingHotkey?: string;
  clipboardScreenshotHotkey?: string;
  clipboardDesktopScreenshotHotkey?: string;
  clipboardHistoryHotkey?: string;
  continuousContextHotkey?: string;
  todoHotkey?: string;
  // ... other non-hotkey preferences
}
```

### 2. PreferencesManager (in-memory)
**Location**: `electron/main/preferences.ts`

- Loads from disk on startup
- Merges with DEFAULT_PREFERENCES
- Exposes `get()` and `save()` methods

### 3. ClipboardManager.config (in-memory)
**Location**: `electron/main/clipboardManager.ts`

```typescript
const DEFAULT_CONFIG: ClipboardConfig = {
  screenshotHotkey: 'Alt+4',
  fullScreenHotkey: 'Alt+3',
  activeWindowHotkey: 'Shift+Alt+3',
  historyHotkey: 'Alt+Space',
  // ...
};
```

### 4. TranscriberManager private fields (in-memory)
**Location**: `electron/main/transcriberManager.ts`

```typescript
private hotkey: string = '';
private registeredHotkey: string | null = null;
private secondaryHotkey: string | null = null;
private abandonHotkey: string = 'Escape';
```

### 5. globalShortcut (OS-level)
**Location**: Electron's global shortcut system

- Actual OS registration
- Can conflict with other apps
- Returns boolean on register attempt

---

## Startup Flow

```
1. app.whenReady()
   │
2. preferencesManager.load()
   │  - Load preferences.json from disk
   │  - Merge with DEFAULT_PREFERENCES
   │
3. clipboardManager = new ClipboardManager()
   │  - Uses DEFAULT_CONFIG internally
   │
4. clipboardManager.loadHotkeysFromPreferences(prefs)
   │  - Updates clipboardManager.config (in-memory only)
   │  - Does NOT register with globalShortcut yet
   │
5. clipboardManager.loadContinuousContextFromPreferences(prefs)
   │  - Updates continuous context state (in-memory only)
   │
6. transcriberManager = new TranscriberManager()
   │
7. transcriberManager.init()
   │  - Loads transcriptionHotkey from preferences
   │  - REGISTERS with globalShortcut immediately
   │
8. Check onboarding status
   │
   ├─ If NOT complete: hotkeys remain unregistered
   │
   └─ If complete: registerHotkeysAfterOnboarding()
      │
      ├─ clipboardManager.registerScreenshotHotkey()
      ├─ clipboardManager.registerFullScreenHotkey()
      ├─ clipboardManager.registerActiveWindowHotkey()
      ├─ clipboardManager.registerHistoryHotkey()
      ├─ Register hardcoded hotkeys (TODO, SuperPaste, etc.)
      └─ If continuous context enabled: register its hotkey
```

---

## Hotkey Change Flow

### User changes hotkey in Settings UI

```
1. SettingsPanel.tsx: handleSet*Hotkey(newHotkey)
   │
2. Validate: isModifierOnly(newHotkey) check
   │
3. IPC call: window.clipboardAPI.setHotkeys({ screenshot: newHotkey })
   │
4. Main process handler: ClipboardIPCChannels.SET_HOTKEYS
   │
5. clipboardManager.setScreenshotHotkey(newHotkey)
   │  ├─ globalShortcut.unregister(oldHotkey)
   │  ├─ Update config.screenshotHotkey = newHotkey
   │  └─ globalShortcut.register(newHotkey, callback)
   │       └─ Returns true/false
   │
6. If success: preferencesManager.save({ clipboardScreenshotHotkey: newHotkey })
   │
7. Update tray menu display
   │
8. Return success/failure to renderer
```

---

## Known Issues

### Issue #1: TODO Hotkey Dual Registration (BUG)

**Severity**: High

**Problem**:
- TODO hotkey is hardcoded at startup (line 279): `Cmd+Shift+T`
- User can change it via settings (IPC handler at line 2768)
- But the IPC handler only saves to preferences, doesn't unregister old hotkey
- Result: Both hotkeys registered, old one never unregistered

**Code**:
```typescript
// Line 279 - hardcoded, registered at startup
const todoHotkey = 'Command+Shift+T';
globalShortcut.register(todoHotkey, () => { ... });

// Line 2768 - IPC handler only saves, doesn't re-register
ipcMain.handle(TodoIPCChannels.SET_TODO_HOTKEY, async (_event, hotkey: string) => {
  await preferencesManager.save({ todoHotkey: hotkey });
  return { success: true };
  // Missing: globalShortcut.unregister(old) and register(new)
});
```

### Issue #2: Multiple Sources of Truth

**Severity**: Medium

**Problem**: Same hotkey stored in multiple places that can desync:
1. preferences.json (disk)
2. preferencesManager.preferences (memory)
3. clipboardManager.config (memory)
4. globalShortcut registration (OS)

**Scenario**: App crashes after `globalShortcut.register()` but before `preferencesManager.save()`:
- OS has new hotkey registered
- preferences.json has old hotkey
- On restart, loads old hotkey, tries to register, may conflict

### Issue #3: No Conflict Detection

**Severity**: Medium

**Problem**: No check if hotkey is already registered before attempting registration.

**Current behavior**:
```typescript
const success = globalShortcut.register(hotkey, callback);
if (!success) {
  // Log error, return false
  // But no specific handling for conflicts vs other failures
}
```

**Should check**:
```typescript
if (globalShortcut.isRegistered(hotkey)) {
  // Handle conflict specifically
}
```

### Issue #4: Preferences Saved on Partial Failure

**Severity**: Medium

**Problem**: In SET_HOTKEYS handler, preferences saved even when some registrations fail.

**Code** (index.ts:1493-1564):
```typescript
if (hotkeys.screenshot !== undefined) {
  const result = clipboardManager.setScreenshotHotkey(hotkeys.screenshot);
  if (!result) {
    success = false;  // Flag set, but continues
  } else {
    prefsToSave.clipboardScreenshotHotkey = hotkeys.screenshot;
  }
}

// Later...
if (Object.keys(prefsToSave).length > 0) {
  await preferencesManager.save(prefsToSave);  // Saves partial success
}
```

### Issue #5: Stale In-Memory State

**Severity**: Low

**Problem**: TranscriberManager sets `this.registeredHotkey` even when registration fails.

**Code** (transcriberManager.ts:341-356):
```typescript
this.hotkey = hotkey;
this.registeredHotkey = normalizedHotkey;  // Set regardless of success
```

### Issue #6: No Mutex for Concurrent Changes

**Severity**: Low

**Problem**: No locking prevents concurrent hotkey operations.

**Scenario**: Two rapid hotkey changes could interleave unregister/register calls.

### Issue #7: Continuous Context Escape Key

**Severity**: Low

**Problem**: Escape key registered dynamically without checking if already registered.

**Code** (clipboardManager.ts:1725):
```typescript
const registered = globalShortcut.register('Escape', () => { ... });
// registered value not checked
```

### Issue #8: Hardcoded Hotkeys Not Customizable

**Severity**: UX issue

**Problem**: These hotkeys cannot be changed by users:
- `Cmd+Shift+V` (Super Paste)
- `Cmd+Shift+K` (Command Launcher)
- `Cmd+Shift+I` (Improve Text)
- `Cmd+Shift+\` (Auto-Improve)

---

## File Reference

| File | Hotkey-related code |
|------|---------------------|
| `electron/main/index.ts` | IPC handlers, hardcoded registrations, startup flow |
| `electron/main/clipboardManager.ts` | Screenshot, history, continuous context hotkeys |
| `electron/main/transcriberManager.ts` | Transcription hotkeys |
| `electron/main/preferences.ts` | Hotkey storage, defaults |
| `src/components/SettingsPanel.tsx` | UI for changing hotkeys |
| `src/utils/hotkeys.ts` | Hotkey string formatting utilities |

---

## Refactor Goals

1. **Single source of truth**: One HotkeyManager owns all hotkey state
2. **Atomic operations**: Register succeeds before preferences saved
3. **Conflict detection**: Check before register, provide clear errors
4. **All hotkeys customizable**: Move hardcoded hotkeys to preferences
5. **Clear API**: `register()`, `unregister()`, `change()`, `getAll()`
6. **Proper cleanup**: Unregister all on quit, handle crashes gracefully

---

## Appendix: Default Hotkey Values

From `electron/main/preferences.ts`:

```typescript
const DEFAULT_PREFERENCES: Preferences = {
  transcriptionHotkey: 'Command+\\',
  clipboardScreenshotHotkey: 'Alt+4',
  clipboardDesktopScreenshotHotkey: 'Alt+3',
  clipboardHistoryHotkey: 'Alt+Space',
  continuousContextHotkey: 'Shift+Alt+4',
  abandonRecordingHotkey: 'Escape',
  todoHotkey: 'Command+Shift+T',
  // ...
};
```

From `electron/main/clipboardManager.ts`:

```typescript
const DEFAULT_CONFIG: ClipboardConfig = {
  screenshotHotkey: 'Alt+4',
  fullScreenHotkey: 'Alt+3',
  activeWindowHotkey: 'Shift+Alt+3',
  historyHotkey: 'Alt+Space',
  // ...
};
```

From `src/command-launcher.tsx`:

```typescript
const DEFAULT_HOTKEYS = {
  screenshot: 'Alt+4',
  fullScreen: 'Alt+3',
  activeWindow: 'Shift+Alt+3',
  history: 'Option+Space',
  transcription: 'Command+\\',
  tasks: 'Shift+Command+T',
  superPaste: 'Shift+Command+V',
};
```
