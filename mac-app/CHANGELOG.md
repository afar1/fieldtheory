# Changelog

All notable changes to Field Theory will be documented in this file.

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
