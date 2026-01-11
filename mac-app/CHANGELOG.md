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
