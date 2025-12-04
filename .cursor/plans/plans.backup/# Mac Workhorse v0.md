# Mac Workhorse v0

## Core Concept

The Mac Workhorse stores everything in **local clipboard history** (like Alfred). Transcriptions go to clipboard, get saved locally, and can be searched/re-pasted anytime.

**Local vs Cloud distinction:**

- **Local clipboard history**: All workhorse transcriptions, screenshots, copied text - LOCAL ONLY, never synced (passwords, sensitive data)
- **Supabase**: Only receives a transcript when user explicitly clicks "Separate into Tasks & Observations"

This keeps the fast copy-paste workflow while still having full local history for lookup.

---

## Three Modalities (Reference)

| Modality | Purpose | Task Extraction | Storage |

|----------|---------|-----------------|---------|

| **Workhorse** (invisible) | Fast transcription + clipboard + screenshots | Only on explicit action | Local clipboard history |

| **iOS App** | Voice to structured data | Auto (Claude) | Full sync |

| **Mac Tasks App** (visible) | View/edit synced data | Manual button | Full CRUD |

---

## Anti-Patterns (What We're NOT Doing)

- Do NOT sync clipboard history to cloud - strictly local (passwords, secrets)
- Do NOT copy `llm.ts` to Electron - import from `../../services/llm.ts`
- Do NOT create a profile/mode system - boolean or explicit action
- Do NOT add E2E encryption in v0 - deferred to Phase 1+

---

## Phase 0: Core Workhorse UX (~12h)

### M1: Clipboard History + Prompt Stacking (7h)

**Goal**: Replace Alfred clipboard history with integrated local-only solution. This is the PRIMARY place to view transcripts and build multi-item prompts.

**New file**: `mac-app/electron/main/clipboardManager.ts`

Implementation approach (following Alfred):

- **Polling**: Use Electron's `clipboard` module, poll every 500ms
- **Change detection**: Compare content hash to detect changes (lightweight)
- **Storage**: SQLite database at `~/Library/Application Support/LittleOne/clipboard.db`
- **Images**: Store as blob in SQLite (like Alfred's `.data` file - all in one place)

Core functionality:

- Clipboard watcher using `clipboard.readText()`, `clipboard.readImage()`, `clipboard.readHTML()`
- SQLite with FTS5 for fuzzy search on text content
- Configurable retention (item count and/or time-based)
- Ignore list (password managers, etc.)
- Store metadata: source app, timestamp, dimensions (images), word/char count (text)
- Track item type: `transcript` | `screenshot` | `copied` (for filtering)

Schema:

```sql
CREATE TABLE clipboard_items (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL,           -- 'text' | 'image' | 'transcript' | 'screenshot'
  content TEXT,                  -- text content (for FTS)
  image_data BLOB,               -- image as blob
  image_width INTEGER,
  image_height INTEGER,
  image_size INTEGER,            -- bytes
  source_app TEXT,               -- bundle ID of source app
  source_app_name TEXT,          -- display name
  word_count INTEGER,
  char_count INTEGER,
  created_at INTEGER NOT NULL,   -- unix timestamp ms
  content_hash TEXT              -- for deduplication
);
CREATE VIRTUAL TABLE clipboard_fts USING fts5(content, content='clipboard_items', content_rowid='id');
```

**New file**: `mac-app/src/components/ClipboardHistory.tsx`

UI requirements:

- Configurable hotkey to open (e.g., Cmd+Shift+V)
- Small, snappy popup (Alfred-like)
- Cursor immediately ready for fuzzy search on open
- **Filter tabs**: All / Transcripts / Screenshots
- List shows:
  - Text items: preview text, word count, char count, timestamp, source app icon
  - Image items: thumbnail icon, dimensions (WxH), file size, timestamp, source app icon
- Arrow keys to navigate
- Enter to paste single selected item
- "Load More" pagination at bottom
- Configurable retention settings in preferences

**Multi-select / Prompt Stacking**:

- Ability to select multiple items (Shift+click, Cmd+click, or toggle mode)
- Selected items form a "stack"
- Visual indicator showing stack count
- "Paste Stack" action (or Enter when multiple selected) pastes all items
- Stack order: oldest first (or let user reorder?)

### M2: Screenshot Capture (2h)

**Goal**: Integrated screenshot hotkey that captures to clipboard history.

**File**: `mac-app/electron/main/clipboardManager.ts`

- Configurable screenshot hotkey (e.g., Cmd+Ctrl+Shift+4)
- Uses macOS `screencapture` CLI
- Region selection vs full screen option
- Captured image automatically added to clipboard history with metadata

### M3: Prompt Stacking / Multi-Item Paste (3h)

**Goal**: Stack multiple items (screenshots + transcription) and paste all at once.

**Concept**: As you work, you might take 3 screenshots and record 1 transcription. Instead of pasting each separately, the overlay shows your "stack" and you can paste everything into a multimodal input field at once.

**File**: `mac-app/electron/main/transcriberManager.ts`

- Track "current stack" of items (transcriptions + screenshots since last paste)
- "Paste All" action that combines stack

**File**: `mac-app/src/components/RecordingOverlay.tsx`

- Show thumbnails of stacked screenshots
- Show transcription text preview
- "Paste All" button
- Stack clears after paste (or manual clear)

**Behavior**:

- If target field is multimodal: paste images + text
- If target field is text-only: paste only text (or warn user)

### M4: "Separate into Tasks" Action (1h)

**Goal**: Explicit bridge from workhorse to structured data.

**File**: `mac-app/electron/main/transcriberManager.ts`

- Add `separateIntoTasks(text: string)` function
- Import `processTranscription` from `../../services/llm.ts`
- Save transcript to Supabase, call LLM, apply diff

**File**: `mac-app/src/components/RecordingOverlay.tsx`

- "Separate into Tasks" button after transcription
- Or accessible from clipboard history on any text item

---

## Phase 1: Hardening (4h) - Deferred

### M5: Audio Priority Hardening (2h)

- Harden priority lock in Swift helper
- Ensure priority survives Bluetooth headphone connects
- Tray icon reflects current priority device status

### M6: Sleep/Wake Recovery (2h)

- Add wake notification observer in Swift helper
- Re-enumerate devices on wake
- Re-enforce priority lock after 2s polling window

---

## Files to Touch

**Phase 0:**

- New `mac-app/electron/main/clipboardManager.ts` - clipboard watcher, SQLite storage, screenshot capture
- New `mac-app/src/components/ClipboardHistory.tsx` - Alfred-style UI
- `mac-app/electron/main/transcriberManager.ts` - prompt stacking, "Separate into Tasks"
- `mac-app/src/components/RecordingOverlay.tsx` - stack display, action buttons
- `mac-app/electron/main/index.ts` - register new IPC handlers and hotkeys

**Shared services** (import, don't copy):

- `services/llm.ts` - task extraction logic

**Phase 1:**

- `mac-app/electron/native/Sources/LittleOneHelper/main.swift` - sleep/wake, priority

---

## Security Posture (v0)

- **Clipboard history**: LOCAL ONLY, never synced, SQLite on disk
- **Passwords/secrets**: Ignore list for known password managers, configurable retention limits
- **Transcripts (workhorse)**: Local clipboard history only
- **Transcripts (when "Separate into Tasks")**: Sent to Supabase + Claude
- **E2E encryption**: Deferred to Phase 1+ (for cloud-synced transcripts)

---

## Risk Analysis

| Risk | Mitigation |

|------|------------|

| Clipboard history leaks secrets | Local-only, ignore list, retention limits, never cloud |

| Large images fill disk | Configurable retention, size limits |

| Multimodal paste to non-multimodal field | Detect and warn, or paste text-only |

| LLM call fails | Show error toast, transcript still in local history |