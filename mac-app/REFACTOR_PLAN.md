# Mac App Refactoring Plan

**Status:** Phase 1-5 Complete
**Created:** 2026-01-31
**Updated:** 2026-01-31
**Net Target:** ~9,000 lines removed

---

## Overview

Simplify the Field Theory Mac app by removing unused features, cleaning up logging, and simplifying auth.

---

## Phase 0: Logging Infrastructure
**Status:** ✅ Complete

Created logger utility for clean, consistent logging.

### Tasks
- [x] Create `electron/main/logger.ts` (~40 lines)
- [x] Simple levels: debug, info, warn, error
- [x] Format: `14:32:06.234 → [Component] Message`
- [x] Production default: info level (hides debug)

### Logger Utility
```typescript
// electron/main/logger.ts
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const ICONS: Record<LogLevel, string> = { debug: '🔍', info: '→', warn: '⚠️', error: '❌' };

let currentLevel: LogLevel = process.env.NODE_ENV === 'development' ? 'debug' : 'info';

export function setLogLevel(level: LogLevel) { currentLevel = level; }

export function createLogger(component: string) {
  const shouldLog = (level: LogLevel) => LEVELS[level] >= LEVELS[currentLevel];
  const format = (level: LogLevel, msg: string) =>
    `${new Date().toISOString().slice(11, 23)} ${ICONS[level]} [${component}] ${msg}`;

  return {
    debug: (msg: string, ...args: unknown[]) => shouldLog('debug') && console.debug(format('debug', msg), ...args),
    info: (msg: string, ...args: unknown[]) => shouldLog('info') && console.log(format('info', msg), ...args),
    warn: (msg: string, ...args: unknown[]) => shouldLog('warn') && console.warn(format('warn', msg), ...args),
    error: (msg: string, ...args: unknown[]) => shouldLog('error') && console.error(format('error', msg), ...args),
  };
}
```

### Logging Rules
- **Keep:** Auth events, Errors
- **Remove:** Everything else (initialization, success confirmations, method entry/exit, file watcher chatter)

---

## Phase 1: Feature Removals
**Status:** ✅ Complete
**Lines Removed:** ~8,304

### Features to Remove
| Feature | Files | Lines |
|---------|-------|-------|
| DMs + Hot Mic | `HotMicView.tsx`, socialSync DM code, handlers | ~2,000 |
| Team/Shared Clipboard | `TeamView.tsx`, `sharedClipboardSync.ts` | ~4,250 |
| Scenario Testing | `scenario-testing.tsx`, devOverrides | ~600 |
| Local LLM | `localLLMManager.ts`, handlers, prefs | ~484 |
| MobileSync | `mobileSync.ts` (entire file) | ~880 |
| Sound file customization | 7 sound prefs (keep on/off only) | ~50 |
| Progressive label hiding | 3 prefs, counting logic | ~40 |

### Tasks
- [x] Extract Feedback code from `socialSync.ts` → `feedbackManager.ts`
- [x] Extract Feedback UI from `DMsView.tsx` → `FeedbackView.tsx`
- [x] Delete `HotMicView.tsx`
- [x] Delete `sharedClipboardSync.ts`
- [x] Delete `TeamView.tsx`
- [x] Delete `mobileSync.ts`
- [x] Delete `localLLMManager.ts`
- [x] Delete `scenario-testing.tsx` and `scenarioTestingWindow.ts`
- [x] Remove Hot Mic tab from `ClipboardHistory.tsx`
- [x] Remove Team tab from `ClipboardHistory.tsx`
- [x] Clean up handlers in `index.ts`
- [x] Remove sound file preferences (keep `soundsEnabled`, `librarianSoundEnabled`)
- [x] Remove progressive label preferences (keep `hideStatusLabels`)
- [x] Update imports throughout codebase
- [x] Migrate affected files to new logger

---

## Phase 2: Todo Rewrite
**Status:** ✅ Complete
**Lines:** +319 (todoStore.ts created)

### Tasks
- [x] Create `electron/main/todoStore.ts`
- [x] Simple Supabase realtime subscription on `todos` table
- [x] CRUD operations: create, update, toggle, delete
- [x] Single event: `todosChanged`
- [x] Offline support (local state, sync when online)
- [x] Update `TodoView.tsx` to use new store
- [x] Remove todo code from deleted `mobileSync.ts`
- [x] Migrate to new logger

---

## Phase 3: Auth Simplification
**Status:** ✅ Complete
**Lines Removed:** ~160

### Remove
- [x] Auth simulator (~100 lines) - scenario testing gone
- [x] Manual 10s/15s timeouts - use Supabase SDK defaults
- [x] `attemptSessionRecovery()` - over-engineered workaround
- [x] `coordinatedRefresh()` complexity - SDK handles this

### Add
- [x] Tier fetching in AuthManager (+40 lines)
- [x] `getTier()` method
- [x] Emit `tierChanged` event

### Keep
- Session persistence to disk (FileStorage)
- `onAuthStateChange` listener
- Basic `isAuthenticated()` check

### Test Case
Fresh upgrade → app launches → user sees logged-in state immediately (no spinner, no delay)

### Migrate to new logger
- [x] Replace all console.log with logger
- [x] Keep: auth events, errors
- [x] Remove: routine operations

---

## Phase 4: Quota Simplification
**Status:** ✅ Complete
**Lines Removed:** ~130

### Tasks
- [x] Remove `devOverrides` property and methods (~100 lines)
- [x] Remove `setDevOverrides()`, `clearDevOverrides()`, `hasDevOverrides()`
- [x] Remove percentage override logic from status methods (~30 lines)
- [x] Simplify `getEffectiveTier()` - remove override checks
- [x] Use `authManager.isAuthenticated()` instead of session checker injection
- [x] Use `authManager.getTier()` instead of cached tier
- [x] Migrate to new logger

---

## Phase 5: Settings Cleanup
**Status:** ✅ Complete
**Lines Removed:** ~54

### Preferences Removed
```
useLocalLLM
selectedLocalLLM
devOverrides
scenarioTestingBounds
tasksTabEnabled
recordingStartSound
recordingStopSound
recordingCancelSound
windowOpenSound
windowCloseSound
pasteSound
transcribingSound
artifactDiscoverySound
transcribingLabelShownCount
sayAnythingLabelShownCount
labelsExplicitlyEnabled
```

### Preferences Kept
```
soundsEnabled (on/off for all sounds)
librarianSoundEnabled (separate toggle)
hideStatusLabels (simple on/off)
[all hotkeys]
[all other functional prefs]
```

### Tasks
- [x] Remove unused preferences from interface
- [x] Remove from DEFAULT_PREFERENCES
- [x] Update SettingsPanel UI to remove dead options
- [x] Migrate to new logger

---

## Phase 6: Logging Cleanup
**Status:** Pending
**Lines Removed:** ~700

By this phase, logger utility exists and major refactoring is done.

### Tasks
- [ ] Audit remaining files for console.log statements
- [ ] Remove all non-essential logs
- [ ] Ensure all remaining logs use new logger
- [ ] Verify clean output during normal operation

### Target Output
```
14:32:06.234 → [Auth] Signed in: user@example.com
14:32:10.567 ⚠️ [Auth] Token refresh failed
14:32:15.890 ❌ [Transcriber] Model not found
```

---

## Skipped (Future)

### Mega-file Decomposition
Not doing now, but documented for future:

| File | Current Lines | Target |
|------|---------------|--------|
| `ClipboardHistory.tsx` | ~7,600 | Split into 5 components |
| `index.ts` | ~6,500 | Split handlers by domain |
| `librarianManager.ts` | ~4,600 | Split into 4 modules |
| `SettingsPanel.tsx` | ~3,000 | Split into section components |

---

## File Renames

| Current | After |
|---------|-------|
| `socialSync.ts` | `feedbackManager.ts` |
| `DMsView.tsx` | `FeedbackView.tsx` |
| `types/social.ts` | `types/feedback.ts` |

---

## Summary

| Category | Lines Removed | Lines Added | Net |
|----------|---------------|-------------|-----|
| Feature removals | -8,304 | | -8,304 |
| Todo rewrite | -300 | +80 | -220 |
| Auth simplification | -200 | +40 | -160 |
| Quota simplification | -130 | | -130 |
| Settings cleanup | -54 | | -54 |
| Logging overhaul | -700 | +40 | -660 |
| **Total** | | | **~-9,528** |

---

## Remaining Core Product

| Feature | Status |
|---------|--------|
| Clipboard History | Core |
| Transcription (Whisper) | Core |
| Screenshots + Figures | Core |
| Todos | Keep (rewritten) |
| Feedback | Keep (extracted from DMs) |
| Librarian | Keep |
| Commands | Keep |
| Cursor Status | Keep |
| Settings/Auth/Quota | Keep (simplified) |

---

## Notes

- iOS app will no longer sync to Mac after MobileSync removal (revisit later)
- IPC channel names stay as `social:*` for now (renaming is low priority)
- Test auth on fresh upgrade to ensure snappy experience
