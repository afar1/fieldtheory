import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';

import {
  BROWSER_LIBRARY_RENDERER_STORAGE_KEYS,
  type BrowserLibraryRendererStorageKey,
} from '../shared/browserLibraryRendererStorage';

export type BrowserLibraryRendererStorageSnapshot = {
  available: boolean;
  values: Record<string, string | null>;
};

type BrowserLibraryRendererStorageFile = {
  version: 1;
  values: Partial<Record<BrowserLibraryRendererStorageKey, string | null>>;
};

const STORAGE_VERSION = 1;
const STORAGE_FILE_NAME = 'browser-library-renderer-storage.json';
const KEY_SET = new Set<string>(BROWSER_LIBRARY_RENDERER_STORAGE_KEYS);

function emptyValues(): Record<string, string | null> {
  return Object.fromEntries(BROWSER_LIBRARY_RENDERER_STORAGE_KEYS.map((key) => [key, null]));
}

function normalizeValues(values: unknown): Record<string, string | null> {
  const normalized = emptyValues();
  if (!values || typeof values !== 'object') return normalized;
  for (const key of BROWSER_LIBRARY_RENDERER_STORAGE_KEYS) {
    const value = (values as Record<string, unknown>)[key];
    normalized[key] = typeof value === 'string' ? value : null;
  }
  return normalized;
}

export class BrowserLibraryRendererStorageStore {
  private loaded = false;
  private available = false;
  private values: Record<string, string | null> = emptyValues();

  constructor(private readonly filePath: string) {}

  static defaultPath(userDataPath: string): string {
    return path.join(userDataPath, STORAGE_FILE_NAME);
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const text = await fs.readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(text) as Partial<BrowserLibraryRendererStorageFile>;
      this.values = normalizeValues(parsed.values);
      this.available = true;
    } catch {
      this.values = emptyValues();
      this.available = false;
    }
  }

  loadSync(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const text = fsSync.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(text) as Partial<BrowserLibraryRendererStorageFile>;
      this.values = normalizeValues(parsed.values);
      this.available = true;
    } catch {
      this.values = emptyValues();
      this.available = false;
    }
  }

  async snapshot(): Promise<BrowserLibraryRendererStorageSnapshot> {
    await this.load();
    return { available: this.available, values: { ...this.values } };
  }

  snapshotSync(): BrowserLibraryRendererStorageSnapshot {
    this.loadSync();
    return { available: this.available, values: { ...this.values } };
  }

  async set(key: string, value: string | null): Promise<boolean> {
    await this.load();
    if (!KEY_SET.has(key)) return false;
    if (this.values[key] === value) return false;
    this.values[key] = value;
    this.available = true;
    await this.flush();
    return true;
  }

  async merge(values: Record<string, string | null>): Promise<void> {
    await this.load();
    let changed = false;
    for (const key of BROWSER_LIBRARY_RENDERER_STORAGE_KEYS) {
      const value = typeof values[key] === 'string' ? values[key] : null;
      if (this.values[key] === value) continue;
      this.values[key] = value;
      changed = true;
    }
    if (changed || !this.available) {
      this.available = true;
      await this.flush();
    }
  }

  private async flush(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const payload: BrowserLibraryRendererStorageFile = {
      version: STORAGE_VERSION,
      values: { ...this.values },
    };
    await fs.writeFile(this.filePath, JSON.stringify(payload, null, 2), 'utf-8');
  }
}
