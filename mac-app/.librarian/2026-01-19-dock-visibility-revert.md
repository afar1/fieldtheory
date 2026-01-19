# Dock Visibility Changes - Revert Guide

## Goal
Revert all dock/Cmd+Tab visibility changes back to the working state (hidden from dock, accessory mode).

## Changes Made This Session

### 1. `electron/main/index.ts` - Startup (lines 5107-5114)

**Original (working):**
```typescript
    // Apply Dock visibility setting.
    // Default is panel mode (hidden from Dock). This is a WIP feature.
    if (process.platform === 'darwin') {
      const showInDock = preferencesManager?.getPreference('showInDock') ?? false;
      if (showInDock) {
        await app.dock.show();
      } else {
        app.dock.hide();
      }
    }
```

**Current (broken):**
```typescript
    // Always show in dock and Cmd+Tab. Window hides on blur (panel behavior).
    if (process.platform === 'darwin') {
      await app.dock.show();
      app.setActivationPolicy('regular');
    }
```

**To revert:** Replace the current block with the original block above.

### 2. `electron/main/clipboardHistoryWindow.ts` - setImmersiveMode

**Original (working) - no dock toggling:**
```typescript
  setImmersiveMode(immersive: boolean): void {
    this.isImmersiveMode = immersive;
    console.log(`[ClipboardHistoryWindow] Immersive mode: ${immersive}`);

    // Only adjust alwaysOnTop in panel mode (not showInDock mode)
    const showInDock = this.preferencesManager.getPreference('showInDock') ?? false;
    if (!showInDock && this.window && !this.window.isDestroyed()) {
      if (immersive) {
        // In immersive mode, disable alwaysOnTop so window behaves normally
        this.window.setAlwaysOnTop(false);
        this.window.setVisibleOnAllWorkspaces(false);
      }
      // Don't restore alwaysOnTop when exiting - let window stay normal until hidden
    }
  }
```

**Status:** Currently at original state (no changes needed).

---

## All Dock/Activation Policy Control Points

### Explicit dock.show/hide calls:
| File | Line | When Called | What it does |
|------|------|-------------|--------------|
| index.ts | 5112 | Startup | `app.dock.show()` (our change) |
| index.ts | 3132 | setShowInDock(true) | `app.dock.show()` |
| index.ts | 3134 | setShowInDock(false) | `app.dock.hide()` |
| index.ts | 4128 | transcriber recording-started | `app.dock.show()` if showInDock |
| index.ts | 4523,4532 | Librarian reminder | `app.dock.bounce()` |

### app.setActivationPolicy calls:
| File | Line | When Called | What it does |
|------|------|-------------|--------------|
| index.ts | 5113 | Startup | `setActivationPolicy('regular')` (our change) |

### app.show() calls (can affect visibility):
| File | Line | When Called | What it does |
|------|------|-------------|--------------|
| clipboardHistoryWindow.ts | 228 | show() with existing window | `app.show()` |
| clipboardHistoryWindow.ts | 248 | show() creating new window | `app.show()` |

### app.hide() calls (can affect visibility):
| File | Line | When Called | What it does |
|------|------|-------------|--------------|
| clipboardHistoryWindow.ts | 474 | hide() when showInDock=false | `app.hide()` |
| commandLauncherWindow.ts | 153 | dismiss() | `app.hide()` |
| index.ts | 5027 | Menu: Hide Field Theory | `app.hide()` |

### Browser window blur handler (index.ts lines 4300-4322):
- Checks `showInDock` preference (false) → continues
- Checks immersive mode → if false, continues
- Calls `clipboardHistoryWindow.hide()` → which calls `app.hide()`

---

## The Bug

When Cmd+Tab to Field Theory:
1. `activate` event fires
2. `showClipboardHistoryOnActivate()` is called
3. Inside `clipboardHistoryWindow.show()`: `app.show()` is called
4. Window shows briefly
5. Something triggers blur → `app.hide()` is called
6. App disappears from dock and Cmd+Tab

**Hypothesis:** The `app.show()` call might be interfering with the explicit `dock.show()` + `setActivationPolicy('regular')` we set at startup. On macOS, `app.show()` might reset or affect the activation policy.

---

## Quick Revert Command

```bash
git checkout HEAD -- electron/main/index.ts
npm run build
```

This will restore index.ts to its last committed state (before our dock changes).
