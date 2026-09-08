## 0.3.47-preview.1 — local combined preview

- Keep synced Voice transcripts in Library with direct links to their Codex tasks, preserving folder choices, user edits and folder renames.
- Cycle through enabled Launcher sections in saved order with Tab and Shift-Tab.
- Use readable Codex conversations and bounded project/task routing, with safer reconnect, interruption and account-change handling.
- Replace the default drawing surface with Benji Taylor’s Drawesome freehand tools; preserve PNG annotations and explicit recovery of older Excalidraw drafts.

This is a local user-test candidate. Native UI, physical phone, locked-screen and sleep acceptance remain pending installation. See `docs/VOICE_COMBINED_PREVIEW_SCOPE.md` and `docs/DRAWESOME_PREVIEW.md` for exact scope and evidence limits.

# Changelog

All notable changes to Field Theory will be documented in this file.

## [0.1.33] - 2026-01-10

### Added
- Renamed "Commands" to "Popular Commands" for better clarity
- Admin delete controls for Popular Commands (visible to admin users)
- Release notes popup now shows release date in "MMM DD YYYY" format
- Version number displays "Check for updates" on hover
- 3-second hover delay before showing release notes popup for better UX

### Fixed
- Settings page blank screen issue resolved
- TypeScript errors for missing type definitions (fullScreen, activeWindow, getHideStatusLabels)
- Release notes popup now properly dismisses on mouse leave
- PopularCommands component state management issues

### Changed
- Release notes popup moved to bottom-right corner, positioned above version number
- Popup animations improved with 300ms fade transitions
- Version number check for updates now works in development mode
- Removed deprecated Cmd+Shift+M keyboard shortcut for release notes

## [0.1.32] - 2026-01-10

### Fixed
- Fixed auto-logout issue where users were being signed out after periods of inactivity
- Added graceful session recovery with automatic token refresh
- Tokens now refresh proactively when app becomes active to prevent expiration
- Sessions persist properly across app restarts and periods of inactivity

### Changed
- Improved session management for better user experience on local machines
- Enhanced logging for session refresh and authentication debugging

## [0.1.31] - Previous Release
