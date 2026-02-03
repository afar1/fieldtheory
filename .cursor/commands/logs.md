# Logging Conventions

When writing or reviewing log statements, follow these conventions for consistency.

## Format

All logs use this format:
```
HH:MM:SS.mmm PREFIX [Component] Message
```

Examples:
```
18:32:59.057 → [Main] App ready
18:32:59.422 → [Auth] Initialized with session storage: /path/to/storage
18:33:00.866 WARN [Auth] Token refresh failed, retrying...
18:33:01.234 ERR [Auth] Session expired: Invalid refresh token
```

## Log Levels

| Level | Prefix | When to use |
|-------|--------|-------------|
| debug | (4 spaces) | Internal state, verbose tracing. Hidden in production. |
| info  | → | Normal operations: startup, shutdown, user actions, config changes |
| warn  | WARN | Recoverable issues, degraded functionality, retrying operations |
| error | ERR | Failures requiring attention, unrecoverable errors |

## Guidelines

### DO

- **Be concise**: `Signed in: user@example.com` not `User has successfully signed in with email: user@example.com`
- **Include context**: `Failed to save: /path/to/file` not just `Failed to save`
- **Use present tense**: `Starting server` not `Server is starting`
- **Log state changes**: Login, logout, config changes, mode switches
- **Log failures with details**: Include error messages, file paths, IDs

### DON'T

- **Don't log expected states**: Remove `No session, skipping sync` - that's normal when logged out
- **Don't use [DEBUG] prefix**: Use `log.debug()` instead, the level handles visibility
- **Don't log duplicates**: If an event fires multiple times, dedupe or use debug level
- **Don't log sensitive data**: No tokens, passwords, full session objects
- **Don't use emojis**: Use text prefixes for grep-ability and terminal compatibility

### Level Selection

```typescript
// debug - verbose, development only
log.debug('Cache hit for key:', key);
log.debug('Parsed config:', JSON.stringify(config));

// info - notable events
log.info('App ready');
log.info('Signed in:', email);
log.info('Uploaded 5 new commands');

// warn - problems we can handle
log.warn('Refresh failed, retrying in 30s');
log.warn('Config missing, using defaults');

// error - problems we can't handle
log.error('Database connection failed:', err);
log.error('Unrecoverable auth error:', err.message);
```

### Silence Patterns

These patterns should NOT produce logs (use debug or remove entirely):

- Polling operations that find nothing changed
- "No session" checks when logged out (expected state)
- Successful routine syncs (use debug)
- Timer scheduling (use debug)
- Cache hits/misses (use debug)

### Component Names

Use short, consistent names:
- `Auth` - Authentication, session management
- `Main` - App lifecycle, window management
- `Clipboard` - Clipboard history
- `Commands` - Portable commands
- `CommandSync` - Command syncing to mobile
- `Quota` - Usage tracking and limits
- `Metrics` - User statistics
- `Transcribe` - Audio transcription
- `Audio` - Audio devices

## Implementation

```typescript
import { createLogger } from './logger';

const log = createLogger('MyComponent');

log.info('Started');
log.debug('Internal state:', state);
log.warn('Retrying after failure');
log.error('Fatal error:', err);
```
