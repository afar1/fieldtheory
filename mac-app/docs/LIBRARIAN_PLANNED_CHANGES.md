# Librarian Planned Changes

Summary of changes discussed on 2026-02-03 for future reference.

---

## Completed

### Per-Project Settings Fix
**Status**: Done (committed to main)

**Problem**: When starting Claude Code in a new project, it would prompt to create a per-project `.claude/settings.json` file with `Write(.librarian/*)` permission.

**Fix**: Updated `librarianManager.ts` to:
1. Change storage path from `.librarian/` to `~/.fieldtheory/librarian/artifacts/` (global)
2. Remove the "Project setup" section from the CLAUDE.md instruction template

**File**: `electron/main/librarianManager.ts` (lines 1775-1778)

---

## Not Yet Implemented

### Dead Code Removal
**Status**: Identified, not removed

The following methods in `librarianManager.ts` are never called and can be safely deleted:

| Method | Lines | Size | Notes |
|--------|-------|------|-------|
| `generateInstructionText()` | 1532-1603 | ~70 lines | Old frequency-based templates (always/frequently/regularly/occasionally) |
| `generateLibrarianSection()` | 1869-1873 | ~4 lines | Wrapper that calls dead method above, marked `@deprecated` |
| `updateClaudeMd()` | 1878-1913 | ~35 lines | Old CLAUDE.md writer, never invoked |

**Total**: ~109 lines of dead code

**NOT safe to remove** (still has references):
- `getThresholdRange()` (lines 1964-1972) — used as fallback in `pickNextThreshold()` line 2058
- `AutoRunFrequency` type — still exposed in IPC API
- Legacy settings fields — needed for migration from old installs

---

### Project Metadata in Concepts Index
**Status**: Planned, not implemented

**Goal**: Track which project each artifact came from so UI can filter/group by project.

**Approach**: Parse project name from artifact filename (pattern: `{project}-{timestamp}-artifact.md`)

**File to modify**: `~/.fieldtheory/librarian/hook.py`

```python
# Extract project from filename:
# e.g., "fieldtheory-2026-01-21-171237-artifact.md" → "fieldtheory"
filename = artifact_path.name
project = filename.split("-")[0]

# Add to concepts_index.json:
"artifacts": {
  "fieldtheory-2026-01-21-...": {
    "title": "...",
    "stories": [...],
    "lessons": [...],
    "project": "fieldtheory"  # NEW
  }
}
```

**Privacy note**: Project name is already visible in filename, so this doesn't leak new info. Full project path is NOT stored.

---

### Optional: Expose Project in UI
**Status**: Future enhancement

Add `project` field to `ReadingMeta` type so LibrarianView can filter/group readings by project.

**Files**:
- `electron/main/librarianManager.ts` — parse project from filename when building ReadingMeta
- `src/types/window.d.ts` — add `project?: string` to ReadingMeta interface

---

## Discovery Frequency Setting

**Status**: Active, NOT vestigial

The "Discovery frequency" selector (Often/Sometimes/Rarely) controls the hook threshold:

| Frequency | Prompts before reading |
|-----------|----------------------|
| Often | 3-7 |
| Sometimes | 10-18 |
| Rarely | 25-40 |

This is actively used by the hook system. Do NOT remove.

---

## Code Architecture Notes

### Active Code Path
```
syncClaudeMd()
  → writeLibrarianSection()
    → generateLibrarianSectionV2()  ← CURRENT
    → writeLibrarianCommandFile()
```

### Dead Code Path (never executed)
```
updateClaudeMd()  ← DEAD, never called
  → generateLibrarianSection()  ← DEAD
    → generateInstructionText()  ← DEAD
```

### Key Files
- `electron/main/librarianManager.ts` — Main librarian logic (~4500 lines)
- `~/.fieldtheory/librarian/hook.py` — Claude Code hook (counter + job creation)
- `~/.fieldtheory/librarian/config.json` — User settings synced from app
- `~/.fieldtheory/librarian/state.json` — Counter state (count/threshold)
- `~/.fieldtheory/librarian/concepts_index.json` — Story/lesson deduplication index
