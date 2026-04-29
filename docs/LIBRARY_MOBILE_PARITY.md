# Library Parity Translation: mac-app → Little AI iOS

This document translates the mac-app Library/Librarian architecture into a mobile-first shape for the Little AI iOS app, using an FSNotes-style information architecture as the implementation base (markdown notes, pinned-first ordering, tag-driven filtering, and fast full-text query).

## Core decisions imported from mac-app

1. **File-first mental model (`.librarian` shape) with markdown-native content.**
   - iOS Library notes should remain markdown-first and copy-safe.
   - Mobile currently emits a copyable pseudo file path (`.librarian/<slug>.md`) to support launcher handoff.

2. **Fast search as a first-class interaction, not a secondary modal.**
   - Library tab keeps always-visible search.
   - Query is normalized for accent/case-insensitive matches.
   - Search also includes tag text for FSNotes-like discoverability.

3. **Reading + writing quality modes.**
   - Base mode supports balanced read/write.
   - Focus mode increases line height and narrows visual noise for immersive drafting (IA Writer style intent).

4. **Launcher bridge via copy actions (phase 1).**
   - `Copy Content` for immediate paste into Codex/other apps.
   - `Copy File` for path-level handoff until full launcher protocol arrives.

5. **Single source of truth persisted locally first.**
   - Mobile Library persists in AsyncStorage under `@littleai/library-documents`.
   - Supports offline read/write and aligns with mac-app local-first behavior.

6. **FSNotes-style note affordances.**
   - Pinned notes sort to the top.
   - Inline `#tags` are extracted and become filters.
   - Library keeps markdown editing as the primary writing mode.

## Mobile implementation boundaries in this commit

- Added bottom nav `Library` tab.
- Added a Library surface with:
  - create/delete notes
  - fast search
  - title + body editing
  - focus mode toggle
  - copy content
  - copy pseudo file path
- Added settings toggle to show/hide Library tab.

## Next parity steps

- Replace pseudo paths with real files in app sandbox and iCloud Drive export/import.
- Add folder roots + watched directories parity.
- Add indexing engine (SQLite FTS) for very large libraries.
- Add share/sync contracts mirroring mac-app `libraryAPI`/`librarianAPI` behavior.
