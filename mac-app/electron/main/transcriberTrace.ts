import { app } from 'electron';
import fs from 'fs';
import path from 'path';

const TRACE_FILE_NAME = 'recording-trace.log';
const MAX_TRACE_FILE_BYTES = 1024 * 1024;

let preparedTracePath: string | null = null;

function resolveTracePath(): string | null {
  try {
    return path.join(app.getPath('userData'), TRACE_FILE_NAME);
  } catch {
    return null;
  }
}

function ensureTraceFile(tracePath: string): boolean {
  try {
    fs.mkdirSync(path.dirname(tracePath), { recursive: true });

    if (preparedTracePath !== tracePath) {
      if (fs.existsSync(tracePath) && fs.statSync(tracePath).size > MAX_TRACE_FILE_BYTES) {
        fs.writeFileSync(tracePath, '', 'utf-8');
      }
      preparedTracePath = tracePath;
    }

    return true;
  } catch {
    return false;
  }
}

function normalizeValue(value: unknown, depth = 0): unknown {
  if (depth > 3) return '[MaxDepth]';
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack?.split('\n').slice(0, 4).join(' | ') ?? null,
    };
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeValue(item, depth + 1));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        normalizeValue(entry, depth + 1),
      ])
    );
  }
  return value;
}

export function getTranscriberTracePath(): string | null {
  return resolveTracePath();
}

export function appendTranscriberTrace(
  event: string,
  details: Record<string, unknown> = {}
): void {
  const tracePath = resolveTracePath();
  if (!tracePath || !ensureTraceFile(tracePath)) return;

  const normalized = normalizeValue(details) as Record<string, unknown>;
  const suffix = Object.keys(normalized).length > 0 ? ` ${JSON.stringify(normalized)}` : '';

  try {
    fs.appendFileSync(tracePath, `${new Date().toISOString()} ${event}${suffix}\n`, 'utf-8');
  } catch {
    // Ignore trace write failures. These logs are diagnostic-only.
  }
}
