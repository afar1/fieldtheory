import fs from 'fs';
import path from 'path';
import { fieldTheoryDir } from './fieldTheoryPaths';

export type DocumentPresenceKind = 'wiki' | 'external';

export interface DocumentPresenceContext {
  type: DocumentPresenceKind;
  rootPath: string;
  relPath: string;
  filePath: string;
  title: string;
}

export interface DocumentPresenceRecord {
  type: DocumentPresenceKind;
  path: string;
  title: string;
  rootPath: string;
  relPath: string;
  windowIds: string[];
  isOpen: boolean;
  isFocused: boolean;
  focusedWindowId: string | null;
  openedAt: string;
  focusedAt: string | null;
  closedAt: string | null;
}

export interface DocumentPresenceState {
  version: 1;
  updatedAt: string;
  focusedPath: string | null;
  documents: DocumentPresenceRecord[];
}

export interface DocumentPresenceManagerOptions {
  stateFilePath?: string;
  writeDelayMs?: number;
  now?: () => Date;
  recentLimit?: number;
  recentMaxAgeMs?: number;
}

const DEFAULT_WRITE_DELAY_MS = 150;
const DEFAULT_RECENT_LIMIT = 100;
const DEFAULT_RECENT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export function defaultDocumentPresencePath(): string {
  return path.join(fieldTheoryDir(), '.app-state', 'document-presence.json');
}

export class DocumentPresenceManager {
  private readonly stateFilePath: string;
  private readonly writeDelayMs: number;
  private readonly now: () => Date;
  private readonly recentLimit: number;
  private readonly recentMaxAgeMs: number;
  private readonly documents = new Map<string, DocumentPresenceRecord>();
  private readonly windowPaths = new Map<string, string>();
  private writeTimer: ReturnType<typeof setTimeout> | null = null;
  private writePromise: Promise<void> | null = null;

  constructor(options: DocumentPresenceManagerOptions = {}) {
    this.stateFilePath = options.stateFilePath ?? defaultDocumentPresencePath();
    this.writeDelayMs = options.writeDelayMs ?? DEFAULT_WRITE_DELAY_MS;
    this.now = options.now ?? (() => new Date());
    this.recentLimit = options.recentLimit ?? DEFAULT_RECENT_LIMIT;
    this.recentMaxAgeMs = options.recentMaxAgeMs ?? DEFAULT_RECENT_MAX_AGE_MS;
  }

  setWindowDocument(windowId: string, context: DocumentPresenceContext, focused = false): void {
    const pathKey = context.filePath;
    const previousPath = this.windowPaths.get(windowId);
    if (previousPath && previousPath !== pathKey) {
      this.detachWindow(windowId, previousPath);
    }

    const timestamp = this.nowIso();
    const existing = this.documents.get(pathKey);
    const record: DocumentPresenceRecord = existing ?? {
      type: context.type,
      path: pathKey,
      title: context.title,
      rootPath: context.rootPath,
      relPath: context.relPath,
      windowIds: [],
      isOpen: false,
      isFocused: false,
      focusedWindowId: null,
      openedAt: timestamp,
      focusedAt: null,
      closedAt: null,
    };

    record.type = context.type;
    record.title = context.title;
    record.rootPath = context.rootPath;
    record.relPath = context.relPath;
    if (!record.windowIds.includes(windowId)) record.windowIds.push(windowId);
    if (!record.isOpen) record.openedAt = timestamp;
    record.isOpen = true;
    record.closedAt = null;

    this.documents.set(pathKey, record);
    this.windowPaths.set(windowId, pathKey);
    if (focused) this.focusWindow(windowId, false);
    this.pruneClosedRecents();
    this.scheduleWrite();
  }

  clearWindow(windowId: string): void {
    const pathKey = this.windowPaths.get(windowId);
    if (!pathKey) return;
    this.detachWindow(windowId, pathKey);
    this.windowPaths.delete(windowId);
    this.pruneClosedRecents();
    this.scheduleWrite();
  }

  focusWindow(windowId: string, schedule = true): void {
    const pathKey = this.windowPaths.get(windowId);
    if (!pathKey) return;

    const timestamp = this.nowIso();
    for (const record of this.documents.values()) {
      record.isFocused = false;
      record.focusedWindowId = null;
    }

    const focused = this.documents.get(pathKey);
    if (!focused || !focused.isOpen) return;
    focused.isFocused = true;
    focused.focusedWindowId = windowId;
    focused.focusedAt = timestamp;
    if (schedule) this.scheduleWrite();
  }

  closeWindow(windowId: string): void {
    this.clearWindow(windowId);
  }

  getState(): DocumentPresenceState {
    this.pruneClosedRecents();
    const documents = Array.from(this.documents.values())
      .map(record => ({ ...record, windowIds: [...record.windowIds].sort() }))
      .sort(comparePresenceRecords);
    const focusedPath = documents.find(record => record.isFocused)?.path ?? null;
    return {
      version: 1,
      updatedAt: this.nowIso(),
      focusedPath,
      documents,
    };
  }

  async flush(): Promise<void> {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
      this.writePromise = this.writeState();
    }
    await this.writePromise;
  }

  destroy(): void {
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = null;
    this.writePromise = null;
  }

  private detachWindow(windowId: string, pathKey: string): void {
    const record = this.documents.get(pathKey);
    if (!record) return;

    record.windowIds = record.windowIds.filter(id => id !== windowId);
    if (record.focusedWindowId === windowId) {
      record.isFocused = false;
      record.focusedWindowId = null;
    }
    if (record.windowIds.length === 0) {
      record.isOpen = false;
      record.closedAt = this.nowIso();
    }
  }

  private pruneClosedRecents(): void {
    const openRecords = Array.from(this.documents.values()).filter(record => record.isOpen);
    const closedRecords = Array.from(this.documents.values())
      .filter(record => !record.isOpen)
      .sort((a, b) => timestampMs(b.closedAt ?? b.focusedAt ?? b.openedAt) - timestampMs(a.closedAt ?? a.focusedAt ?? a.openedAt));
    const cutoff = this.now().getTime() - this.recentMaxAgeMs;
    const retainedClosed = new Set(
      closedRecords
        .filter(record => timestampMs(record.closedAt ?? record.focusedAt ?? record.openedAt) >= cutoff)
        .slice(0, this.recentLimit)
        .map(record => record.path),
    );

    for (const record of closedRecords) {
      if (!retainedClosed.has(record.path)) this.documents.delete(record.path);
    }
    for (const record of openRecords) {
      this.documents.set(record.path, record);
    }
  }

  private scheduleWrite(): void {
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      this.writePromise = this.writeState();
    }, this.writeDelayMs);
  }

  private async writeState(): Promise<void> {
    const state = this.getState();
    const dir = path.dirname(this.stateFilePath);
    const tmpPath = `${this.stateFilePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(tmpPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    await fs.promises.rename(tmpPath, this.stateFilePath);
  }

  private nowIso(): string {
    return this.now().toISOString();
  }
}

function comparePresenceRecords(a: DocumentPresenceRecord, b: DocumentPresenceRecord): number {
  if (a.isFocused !== b.isFocused) return a.isFocused ? -1 : 1;
  if (a.isOpen !== b.isOpen) return a.isOpen ? -1 : 1;
  return timestampMs(b.focusedAt ?? b.closedAt ?? b.openedAt) - timestampMs(a.focusedAt ?? a.closedAt ?? a.openedAt);
}

function timestampMs(value: string | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
