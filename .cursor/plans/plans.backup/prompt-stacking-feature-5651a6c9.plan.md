<!-- 5651a6c9-a6b3-4b43-8687-9830d48ef433 4b07d196-76f2-4c4f-a73d-d8750497c3ae -->
# Prompt Stacking Feature

## Summary

Add a "stacking mode" where users accumulate multiple transcriptions and screenshots. Each item auto-pastes to the original target app as it's captured. Toggle on/off with Cmd + transcription hotkey. Shows "stacking" label in the overlay. Old stacks can be reused via drag-and-drop from clipboard history.

## Core Workflow

1. User is in Claude.ai (example app could be any multimodal input field), presses command+ transcription hotkey (start stacking)
2. We record Claude as the "target app"
3. Overlay appears showing "stacking" label
4. User takes screenshot → auto-pastes to Claude, stays focused on Claude
5. User does transcription → auto-pastes to Claude
6. User can navigate elsewhere, keep adding items (each pastes back to Claude)
7. User presses **Cmd + Alt+Space** again → stacking mode ends
8. All items are saved in clipboard history as a grouped "prompt stack" for later reuse

note: if an input field doesn't accept a certain type of file (screenshot as an example, error elegantly by showing what happened, screenshot will still be available in clipboard history window and user should be allowed to keep going.)

## Key Changes

### 1. TranscriberManager - Stacking Mode Logic

**File**: [`electron/main/transcriberManager.ts`](mac-app/electron/main/transcriberManager.ts)

- Add `isStackingMode: boolean` and `targetAppBundleId: string | null` state
- Modify hotkey handler to detect Cmd modifier:
- **Cmd + hotkey**: Toggle stacking mode on/off
- **Plain hotkey**: Normal record/stop behavior
- When stacking mode starts: capture frontmost app as target, generate `stackId`
- After each transcription/screenshot: activate target app, paste item, leave focused
- When stacking mode ends: clear state (items already pasted, saved in history)
- Emit `stackingModeChanged(active: boolean)` event

### 2. ClipboardManager - Stack Grouping

**File**: [`electron/main/clipboardManager.ts`](mac-app/electron/main/clipboardManager.ts)

- Add `stack_id` column to database schema (nullable TEXT)
- Update `storeText()` and `storeImage()` to accept optional `stackId` parameter
- Add `queryItemsByStackId(stackId: string)` method
- Add `getUniqueStacks()` method to get distinct stacks with item counts

### 3. Recording Overlay - Stacking Indicator

**File**: [`src/components/RecordingOverlay.tsx`](mac-app/src/components/RecordingOverlay.tsx)

- Add `isStackingMode` state from IPC event
- Show "stacking" text in white (left of waveform bars) when active
- Keep overlay visible between recordings while stacking mode is on

**File**: [`electron/main/recordingOverlay.ts`](mac-app/electron/main/recordingOverlay.ts)

- Add `showStackingIdle()` method - shows overlay with just "stacking" label (no waveform)
- Don't dismiss overlay between transcriptions when stacking mode is active

### 4. Clipboard History - Drag-and-Drop Stacks

**File**: [`src/components/ClipboardHistory.tsx`](mac-app/src/components/ClipboardHistory.tsx)

- Group items by `stackId` in the list view
- Render prompt stack rows with:
- Visual stack indicator (stacked rectangles icon per mockup)
- Count badges for screenshots (image icon + count) and transcripts (waveform icon + count)
- "expand" link to show individual items inline
- Summary: first transcript preview + "lipsum lipsum..." style text
- **"drag to paste" helper text** on stack rows
- **Drag-and-drop support**: User can drag a stack row to any input field
- On drag start: write images to temp files, prepare text content
- Drag data includes both text and file references for multimodal paste
- Expand reveals individual items for viewing/selective action

### 5. Drag-and-Drop Implementation

**File**: [`electron/main/clipboardHistoryWindow.ts`](mac-app/electron/main/clipboardHistoryWindow.ts) (new IPC handlers)

- Add `clipboard:startDrag` IPC handler
- Use Electron's `webContents.startDrag()` with temp files for images
- Include combined text as plain text drag data

**File**: [`electron/preload.ts`](mac-app/electron/preload.ts)

- Add `startDrag(stackId: string)` method to clipboardAPI

### 6. IPC and Type Updates

**Files**: [`electron/preload.ts`](mac-app/electron/preload.ts), [`electron/main/types/transcribe.ts`](mac-app/electron/main/types/transcribe.ts), [`electron/main/types/clipboard.ts`](mac-app/electron/main/types/clipboard.ts)

- Add `onStackingModeChanged(callback)` event listener
- Add `getStackingMode()` API method
- Add `stackId: string | null` field to ClipboardItem type

7. Combining items within the clipboard history window.

- Any individual item can be dragged onto another individual item to create a new stack
- Any stack can be dragged onto any individual item to absorb that item into the stack
- Any stack can be dragged onto any other stack to create a larger stack 
- Any stack in expanded view "unstack screenshots" "unstack text and transcripts" "unstack all" which returns them to individual items in the clipboard history.

## What We Won't Do

- No separate "prompt_stack" database table - just add grouping field to existing table
- No complex multi-file drag (single combined approach is sufficient)

## Database Migration

Simple ALTER TABLE to add `stack_id TEXT` column - SQLite handles this gracefully (existing rows get NULL).

### To-dos

- [ ] Add stacking mode state and Cmd+hotkey detection in TranscriberManager
- [ ] Add stack_id column to clipboard_items table
- [ ] Update ClipboardManager to store and query items by stackId
- [ ] Update RecordingOverlay to show 'stacking' label and persist between recordings
- [ ] Update ClipboardHistory to group and display stacked items with expand/collapse