import fs from 'fs';
import os from 'os';
import path from 'path';

const TRACE_FILE_NAME = 'visibility.log';
const ENABLED_VALUES = new Set(['1', 'true', 'yes', 'on']);

export function isVisibilityTraceEnabled(): boolean {
  return ENABLED_VALUES.has((process.env.FIELD_THEORY_VISIBILITY_TRACE ?? '').toLowerCase());
}

function getVisibilityTracePath(): string {
  return path.join(os.homedir(), '.fieldtheory', 'debug', TRACE_FILE_NAME);
}

function normalizeTraceValue(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }
  if (typeof value === 'bigint') return value.toString();
  return value;
}

export function appendVisibilityTrace(
  event: string,
  data: Record<string, unknown> = {},
): void {
  if (process.env.NODE_ENV === 'test') return;
  if (!isVisibilityTraceEnabled()) return;

  try {
    const tracePath = getVisibilityTracePath();
    fs.mkdirSync(path.dirname(tracePath), { recursive: true });
    const suffix = Object.keys(data).length > 0
      ? ` ${JSON.stringify(data, (_key, value) => normalizeTraceValue(value))}`
      : '';
    fs.appendFileSync(tracePath, `${new Date().toISOString()} ${event}${suffix}\n`, 'utf-8');
  } catch {
    // best effort only
  }
}

export function captureVisibilityCaller(limit: number = 6): string[] {
  if (!isVisibilityTraceEnabled()) return [];
  const stack = new Error().stack ?? '';
  return stack
    .split('\n')
    .slice(2, 2 + limit)
    .map((line) => line.trim());
}
