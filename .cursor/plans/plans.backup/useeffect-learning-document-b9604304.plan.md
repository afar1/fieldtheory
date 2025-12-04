<!-- b9604304-ea50-4a99-849e-633ef5038112 d4bd881b-27da-46e5-ac66-20c20f9bc597 -->
# Clipboard History & Hotkey System Improvements

## Overview

This plan documents the improvements made to the clipboard history window and hotkey system, organized for future re-implementation.

---

## Part 1: Clipboard History Window Features

### 1.1 Search Input Reset on Close/Reopen

**File**: `mac-app/src/components/ClipboardHistory.tsx`

- Add state to track search query
- Reset search query when window closes or component unmounts
- Ensure search input clears on window dismiss

### 1.2 Full Multi-Display Dismiss Overlay

**File**: `mac-app/electron/main/clipboardHistoryWindow.ts`

- Calculate bounds of all connected displays
- Create overlay window that spans all displays (covers entire virtual desktop)
- Set overlay window size to: `width: allDisplaysWidth, height: allDisplaysHeight`
- Position overlay at `x: minX, y: minY` to cover all displays
- Ensure clicking anywhere on overlay dismisses the window

### 1.3 Dialog Positioning (Top-Aligned, Centered)

**File**: `mac-app/electron/main/clipboardHistoryWindow.ts`

- Get current display using `screen.getDisplayNearestPoint(screen.getCursorScreenPoint())`
- Calculate dialog position:
  - `dialogLeft = (displayBounds.x + displayBounds.width / 2 - WIDTH / 2) - minX`
  - `dialogTop = 80 - minY + displayBounds.y` (80px from top)
- Clamp position to ensure it's within overlay bounds:
  - `dialogLeft = Math.max(0, Math.min(dialogLeft, allDisplaysWidth - WIDTH))`
  - `dialogTop = Math.max(0, Math.min(dialogTop, allDisplaysHeight - HEIGHT))`
- Pass position to React via `window.dialogPosition` and custom event

**File**: `mac-app/src/components/ClipboardHistory.tsx`

- Add `dialogPosition` state
- Listen for `dialog-position` custom event from Electron
- Apply position to dialog div style: `left: ${dialogPosition.left}px, top: ${dialogPosition.top}px`
- Fallback to centered (`50%`, `80px`) if position not received

---

## Part 2: Hotkey System Implementation

### 2.1 Default Hotkey Values

**File**: `mac-app/electron/main/clipboardManager.ts`

- Add to `DEFAULT_CONFIG`:
  - `screenshotHotkey: 'Alt+1'`
  - `historyHotkey: 'Control+Alt+Space'`

**File**: `mac-app/electron/main/preferences.ts`

- Add to `DEFAULT_PREFERENCES`:
  - `clipboardScreenshotHotkey: 'Alt+1'`
  - `clipboardHistoryHotkey: 'Control+Alt+Space'`

### 2.2 Load Hotkeys from Preferences

**File**: `mac-app/electron/main/clipboardManager.ts`

- Add `loadHotkeysFromPreferences(screenshotHotkey?: string, historyHotkey?: string)` method
- Update `this.config.screenshotHotkey` and `this.config.historyHotkey` if provided

**File**: `mac-app/electron/main/index.ts`

- In `initTranscriberSystem()`, after creating `clipboardManager`:
  - Load preferences: `const prefs = preferencesManager.get()`
  - Call `clipboardManager.loadHotkeysFromPreferences(prefs.clipboardScreenshotHotkey, prefs.clipboardHistoryHotkey)`

### 2.3 Hotkey Registration Methods

**File**: `mac-app/electron/main/clipboardManager.ts`

- Add `registerScreenshotHotkey(callback)` method:
  - Store callback in `this.screenshotCallback`
  - Unregister old hotkey if registered
  - Register with `globalShortcut.register()` wrapped in error handler
  - Set `this.screenshotHotkeyRegistered` flag

- Add `registerHistoryHotkey(callback)` method:
  - Store callback in `this.historyCallback`
  - Unregister old hotkey if registered
  - Register with `globalShortcut.register()` (add error handling wrapper)
  - Set `this.historyHotkeyRegistered` flag

- Add `setScreenshotHotkey(hotkey)` method:
  - Unregister old hotkey
  - Update config
  - Re-register if callback exists

- Add `setHistoryHotkey(hotkey)` method:
  - Unregister old hotkey
  - Update config
  - Re-register if callback exists

- Add `getHotkeys()` method returning `{ screenshot, history }`

### 2.4 IPC Handlers for Hotkeys

**File**: `mac-app/electron/main/index.ts`

- Add `GET_HOTKEYS` handler:
  - Return `clipboardManager.getHotkeys()` or defaults if manager not initialized

- Add `SET_HOTKEYS` handler:
  - Validate hotkey strings
  - Call `clipboardManager.setScreenshotHotkey()` or `setHistoryHotkey()`
  - Save to preferences via `preferencesManager.save()`
  - Return success/failure

**File**: `mac-app/electron/preload.ts`

- Expose `getHotkeys()` and `setHotkeys()` to renderer

**File**: `mac-app/src/types/window.d.ts`

- Add `getHotkeys()` and `setHotkeys()` to `ClipboardAPI` interface

### 2.5 Hotkey Settings UI

**File**: `mac-app/src/App.tsx`

- Add state: `clipboardHotkeys`, `isCapturingScreenshotHotkey`, `isCapturingHistoryHotkey`, `hotkeyError`
- Load hotkeys on mount via `useEffect` calling `window.clipboardAPI.getHotkeys()`
- Add `handleSetScreenshotHotkey()` and `handleSetHistoryHotkey()` callbacks
- Add `useEffect` hooks to capture keyboard events when capturing hotkeys
- Add UI buttons in settings to change hotkeys
- Display current hotkeys and allow editing

### 2.6 Register Hotkeys on Startup

**File**: `mac-app/electron/main/index.ts`

- In `initTranscriberSystem()`, after loading preferences:
  - Call `clipboardManager.registerScreenshotHotkey()` with callback
  - Call `clipboardManager.registerHistoryHotkey()` with callback
  - Callbacks should handle screenshot capture and clipboard history window toggle

---

## Part 3: Bug Fixes

### 3.1 Fix TranscriberManager Hotkey Unregistration

**File**: `mac-app/electron/main/transcriberManager.ts`

- In `registerHotkey()` method, change:
  - FROM: `globalShortcut.unregisterAll()`
  - TO: `if (this.hotkey) { globalShortcut.unregister(this.hotkey); }`
- Prevents accidentally unregistering clipboard hotkeys

### 3.2 Fix ClipboardHistory useEffect Dependencies

**File**: `mac-app/src/components/ClipboardHistory.tsx`

- In mount `useEffect`:
  - Remove `isVisible` from dependency array
  - Effect should only run once on mount
  - Remove `if (isVisible)` guard from `onItemAdded` callback
  - Always call `loadItems(true)` in standalone window mode

### 3.3 Add Error Handling to History Hotkey

**File**: `mac-app/electron/main/clipboardManager.ts`

- In `registerHistoryHotkey()`, wrap callback with error handler:
  ```typescript
  const registered = globalShortcut.register(this.config.historyHotkey, () => {
    const result = callback();
    if (result instanceof Promise) {
      result.catch(err => console.error('[ClipboardManager] History callback error:', err));
    }
  });
  ```


---

## Part 4: Code Cleanup

### 4.1 Remove Debug Logging

- Remove all `console.log` statements added for debugging
- Keep only essential error logging
- Remove verbose comments explaining obvious code

### 4.2 Remove Type Casts

- Remove `(window as any)` casts
- Use proper TypeScript types

---

## Testing Checklist

- [ ] Clipboard history window opens with hotkey
- [ ] Search input resets on close/reopen
- [ ] Overlay covers all displays
- [ ] Dialog is top-aligned and centered on active display
- [ ] Default hotkeys work on startup
- [ ] Can change hotkeys in settings
- [ ] Hotkeys persist across app restarts
- [ ] Screenshot hotkey works
- [ ] History hotkey works
- [ ] No conflicts with transcription hotkey
- [ ] No console errors or warnings

---

## Key Files Modified

- `mac-app/electron/main/clipboardHistoryWindow.ts`
- `mac-app/electron/main/clipboardManager.ts`
- `mac-app/electron/main/index.ts`
- `mac-app/electron/main/transcriberManager.ts`
- `mac-app/electron/main/preferences.ts`
- `mac-app/electron/main/types/clipboard.ts`
- `mac-app/electron/preload.ts`
- `mac-app/src/components/ClipboardHistory.tsx`
- `mac-app/src/App.tsx`
- `mac-app/src/types/window.d.ts`