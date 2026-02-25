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
 *   14:32:10.567 WARN [Auth] Token refresh failed
 *   14:32:15.890 ERR [Auth] Session expired: Error: ...
 *
 * Guidelines:
 * - debug: Verbose internal state, not shown in production
 * - info: Normal operations worth noting (startup, config, user actions)
 * - warn: Recoverable issues, degraded functionality
 * - error: Failures that need attention
 *
 * See: .cursor/commands/logs.md for full conventions
 */

import fs from 'fs';
import path from 'path';
import { format as utilFormat } from 'util';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

const PREFIXES: Record<LogLevel, string> = {
  debug: '    ',  // 4 spaces (aligns with → and WARN)
  info: '→',
  warn: 'WARN',
  error: 'ERR'
};

function parseLogLevel(value: string | undefined): LogLevel | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'debug' || normalized === 'info' || normalized === 'warn' || normalized === 'error') {
    return normalized;
  }
  return null;
}

const envLevel = parseLogLevel(process.env.LOG_LEVEL);
const isDevelopment = process.env.NODE_ENV === 'development';
const quietProductionByDefault = process.env.LOG_QUIET_PROD !== 'false';
const defaultLevel: LogLevel = isDevelopment ? 'debug' : (quietProductionByDefault ? 'warn' : 'info');
let currentLevel: LogLevel = envLevel ?? defaultLevel;

function parseActiveComponents(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((entry) => entry.split('#')[0].trim())
    .filter((entry) => entry.length > 0);
}

function readActiveComponentsFromFile(filePath: string | undefined): Set<string> {
  if (!filePath) return new Set();
  try {
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
    if (!fs.existsSync(absolutePath)) return new Set();
    const content = fs.readFileSync(absolutePath, 'utf-8');
    return new Set(parseActiveComponents(content));
  } catch {
    return new Set();
  }
}

const activeFromEnv = process.env.LOG_ACTIVE ?? '';
const activeFromFile = readActiveComponentsFromFile(process.env.LOG_ACTIVE_COMPONENTS_FILE);
const activeComponents = new Set<string>([
  ...parseActiveComponents(activeFromEnv),
  ...activeFromFile,
]);
const activeAllComponents = activeComponents.has('*');

const activeLogFileRaw = process.env.LOG_ACTIVE_FILE?.trim();
const activeLogFile = activeLogFileRaw
  ? (path.isAbsolute(activeLogFileRaw) ? activeLogFileRaw : path.join(process.cwd(), activeLogFileRaw))
  : null;
let activeLogFileInitialized = false;

function initActiveLogFile(): void {
  if (!activeLogFile || activeLogFileInitialized) return;
  try {
    fs.mkdirSync(path.dirname(activeLogFile), { recursive: true });
    if (process.env.LOG_ACTIVE_RESET === 'true') {
      fs.writeFileSync(activeLogFile, '');
    }
    activeLogFileInitialized = true;
  } catch {
    activeLogFileInitialized = false;
  }
}

function writeActiveLog(line: string): void {
  if (!activeLogFile) return;
  initActiveLogFile();
  if (!activeLogFileInitialized) return;
  try {
    fs.appendFileSync(activeLogFile, `${line}\n`, 'utf-8');
  } catch {
    // Ignore file write issues during development.
  }
}

initActiveLogFile();

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
  const isActiveComponent = activeAllComponents || activeComponents.has(component);

  const formatMessage = (level: LogLevel, msg: string) => {
    const timestamp = new Date().toISOString().slice(11, 23);
    return `${timestamp} ${PREFIXES[level]} [${component}] ${msg}`;
  };

  const safeLog = (fn: (...args: unknown[]) => void, ...args: unknown[]) => {
    try { fn(...args); } catch { /* EPIPE during shutdown */ }
  };

  const emit = (level: LogLevel, fn: (...args: unknown[]) => void, msg: string, ...args: unknown[]) => {
    if (!isActiveComponent && !shouldLog(level)) return;
    const formattedMessage = formatMessage(level, msg);
    safeLog(fn, formattedMessage, ...args);
    if (isActiveComponent) {
      writeActiveLog(utilFormat(formattedMessage, ...args));
    }
  };

  return {
    debug: (msg: string, ...args: unknown[]) => {
      emit('debug', console.debug, msg, ...args);
    },
    info: (msg: string, ...args: unknown[]) => {
      emit('info', console.log, msg, ...args);
    },
    warn: (msg: string, ...args: unknown[]) => {
      emit('warn', console.warn, msg, ...args);
    },
    error: (msg: string, ...args: unknown[]) => {
      emit('error', console.error, msg, ...args);
    },
  };
}
