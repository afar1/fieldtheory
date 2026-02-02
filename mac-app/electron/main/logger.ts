/**
 * Simple logging utility with levels and consistent formatting.
 *
 * Usage:
 *   const log = createLogger('Auth');
 *   log.info('Signed in:', email);
 *   log.warn('Token refresh failed');
 *   log.error('Session expired:', error);
 *
 * Output:
 *   14:32:06.234 → [Auth] Signed in: user@example.com
 *   14:32:10.567 ⚠️ [Auth] Token refresh failed
 *   14:32:15.890 ❌ [Auth] Session expired: Error: ...
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

const ICONS: Record<LogLevel, string> = {
  debug: '🔍',
  info: '→',
  warn: '⚠️',
  error: '❌'
};

let currentLevel: LogLevel = process.env.NODE_ENV === 'development' ? 'debug' : 'info';

/**
 * Set the minimum log level. Logs below this level are suppressed.
 */
export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

/**
 * Get the current log level.
 */
export function getLogLevel(): LogLevel {
  return currentLevel;
}

/**
 * Create a logger for a specific component.
 */
export function createLogger(component: string) {
  const shouldLog = (level: LogLevel) => LEVELS[level] >= LEVELS[currentLevel];

  const format = (level: LogLevel, msg: string) => {
    const timestamp = new Date().toISOString().slice(11, 23);
    return `${timestamp} ${ICONS[level]} [${component}] ${msg}`;
  };

  const safeLog = (fn: (...args: unknown[]) => void, ...args: unknown[]) => {
    try { fn(...args); } catch { /* EPIPE during shutdown */ }
  };

  return {
    debug: (msg: string, ...args: unknown[]) => {
      if (shouldLog('debug')) safeLog(console.debug, format('debug', msg), ...args);
    },
    info: (msg: string, ...args: unknown[]) => {
      if (shouldLog('info')) safeLog(console.log, format('info', msg), ...args);
    },
    warn: (msg: string, ...args: unknown[]) => {
      if (shouldLog('warn')) safeLog(console.warn, format('warn', msg), ...args);
    },
    error: (msg: string, ...args: unknown[]) => {
      if (shouldLog('error')) safeLog(console.error, format('error', msg), ...args);
    },
  };
}
