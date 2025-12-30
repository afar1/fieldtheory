# UI/UX Improvements Plan

## ✅ Completed

### 1. Transcription Filtering
**Files:** `mac-app/electron/main/transcriberManager.ts`
- Filter out `[BLANK_AUDIO]`, `[MUSIC]`, `[SILENCE]` and similar bracketed content
- If entire audio is blank, gracefully close without pasting
- Show status messages in recording overlay: "No audio found", "Cancelled"

### 2. Recording Indicator Relocation
**Files:** `mac-app/src/components/ClipboardHistory.tsx`
- Moved recording indicator from footer to center-top of header area
- Added to Draw mode header (left of save buttons)

### 3. Draw Tool Improvements (Partial)
**Files:** `mac-app/src/components/SketchView.tsx`
- ✅ Removed diamond shape tool (CSS selectors)
- ✅ Changed "save & paste" to "save & copy"
- ⏳ Bundle drawings with transcription when recording (similar to screenshots)
- ⏳ Show completed transcription in floating panel (see #11)

### 4. Escape Key Priority
**Files:** 
- `mac-app/electron/main/transcriberManager.ts` (pauseAbandonHotkey/resumeAbandonHotkey)
- `mac-app/electron/main/clipboardManager.ts` (screenshotStart/screenshotEnd events)
- `mac-app/electron/main/index.ts` (event listeners)
- Priority order:
  1. Escape during screenshot selection: cancels screenshot, recording continues
  2. Field Theory window open: closes window, recording continues
  3. Neither of above: existing abandon recording behavior

### 5. Naming & Label Changes
**Files:** `mac-app/src/components/ClipboardHistory.tsx`
- Renamed "Clipboard" → "Context"
- Renamed "Shared Clipboard" → "Shared Context"
- Fixed "Improve" shortcut display (lowercase `i` instead of capital `I`)

### 6. Keyboard Shortcut Visibility
**Files:** `mac-app/src/components/ClipboardHistory.tsx`
- Added "delete ⌫" and "message m" buttons to item hover states
- Shows shortcuts for delete and DM actions

### 7. "New Since Paste" Explanation
**Files:** `mac-app/src/components/ClipboardHistory.tsx`
- Added text: "↑ context collected since last paste" to separator

### 8. Paste Failure Feedback
**Files:**
- `mac-app/electron/main/toastWindow.ts` (new file - iOS-style toast)
- `mac-app/electron/main/index.ts` (toast initialization)
- `mac-app/src/components/ClipboardHistory.tsx` (handleItemClick - checks pasteBundleId)
- Shows centered toast: "No target input field. Copied to clipboard."
- Hint: "Click to open -or- ⌘V to paste"
- Hover pauses auto-dismiss

### 9. Menu Bar Icon
**Files:**
- `mac-app/electron/main/trayManager.ts` (updated icon path)
- `mac-app/electron/assets/fieldtheory-iconTemplate.png` (new assets)
- Updated to use Field Theory hexagonal mark

### 10. Auto-Stack Paste
**Files:** `mac-app/electron/main/transcriberManager.ts`
- Completed `pasteStack()` to handle images sequentially
- Replaced manual text paste with `pasteStack()` call after recording
- Now pastes entire stack (text + screenshots) into input field

---

## ⏳ Pending

### 11. Transcription Floating Panel in Draw Canvas
**Files:** `mac-app/src/components/SketchView.tsx`
- Show completed transcription in floating, collapsible panel (top-right of draw canvas)
- Design: same as "Popular Commands" hover state
- Display: "Transcript attached to this drawing:" with scrollable text
- Collapse into small icon
- Allow unstacking/disassociating
- Multiple transcripts = multiple floating icons
- Reduce hover delay to ~500ms (also for Popular Commands)

### 12. Dev vs Prod Recording Indicator Debug
**Files:** 
- `mac-app/src/components/RecordingOverlay.tsx`
- `mac-app/electron/main/recordingOverlay.ts`
- Root cause: indicator shows in production but not in dev environment
- Need to investigate overlay window creation/visibility logic

---

## Notes

- All "quick wins" completed ✅
- Remaining items are more complex features
- Test each section before moving to next
- Follow engineering principles: simplicity, preserve working code, avoid over-engineering
