# Terminal-Aware Auto-Paste Implementation

## Goal
Make Field Theory's auto-paste feature work in terminal/CLI environments by detecting terminals and pasting image file paths instead of trying to paste image buffers directly.

## Current State
- Images stored as BLOBs in SQLite (`clipboard.db`)
- Auto-paste uses clipboard buffer + Cmd+V automation
- Works great for multimodal fields (Claude, ChatGPT, Google Docs)
- Fails in terminals where images can't be pasted as buffers

## Implementation Strategy

### 1. Terminal Detection
Detect when frontmost app is a terminal/CLI environment by checking bundle IDs:
- `com.apple.Terminal`
- `com.googlecode.iterm2`
- `com.microsoft.VSCode`
- `dev.warp.Warp-Stable`
- Others as needed

### 2. Lazy File Export with Cache
When pasting to terminal:
- Export image from DB BLOB to `~/Library/Caches/FieldTheory/figures/`
- Filename format: `figure-{label}-{figureId}.png`
- Cache check: only export if file doesn't exist
- Performance: 2-10ms per image (imperceptible)

### 3. Context-Aware Paste Behavior

**Terminal/CLI (new behavior):**
```
[Figure A - /Users/username/Library/Caches/FieldTheory/figures/figure-a-k7xm2.png]
```

**Multimodal fields (existing behavior preserved):**
```
[Figure A]
```
Plus clipboard image buffer paste

### 4. Edge Cases
- Old screenshots: works fine (export on-demand from DB)
- Multi-image stacks: export all referenced images
- Cache cleanup: macOS can auto-clean ~/Library/Caches/
- Missing figure labels: fallback to generic naming

## Files to Modify
1. `clipboardManager.ts` - Add export method
2. `transcriberManager.ts` - Modify paste logic
3. `clipboardHistoryWindow.ts` - Add terminal detection

## Success Criteria
- ✅ Works with old screenshots from GUI
- ✅ Zero latency impact (sub-100ms)
- ✅ Preserves existing multimodal behavior
- ✅ File paths work in Claude Code and all terminals
