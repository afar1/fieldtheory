import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BrowserLibraryRendererStorageStore } from './browserLibraryRendererStorageStore';

describe('BrowserLibraryRendererStorageStore', () => {
  let tempDir: string;
  let storePath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fieldtheory-browser-renderer-storage-'));
    storePath = path.join(tempDir, 'browser-library-renderer-storage.json');
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('returns an unavailable complete snapshot before a native renderer exists', async () => {
    const store = new BrowserLibraryRendererStorageStore(storePath);

    const snapshot = await store.snapshot();

    expect(snapshot.available).toBe(false);
    expect(snapshot.values['fieldtheory-line-numbers']).toBeNull();
    expect(snapshot.values['bookmarks-shortcut']).toBeUndefined();
    expect(snapshot.values['bookmarks-view-mode']).toBeNull();
    expect(snapshot.values['librarian-last-selection']).toBeNull();
    expect(snapshot.values['librarian-immersive']).toBeNull();
    expect(snapshot.values['librarian-editor-session']).toBeNull();
    expect(Object.keys(snapshot.values).length).toBeGreaterThan(10);
  });

  it('persists allowed values and ignores unknown keys', async () => {
    const store = new BrowserLibraryRendererStorageStore(storePath);

    await expect(store.set('fieldtheory-line-numbers', 'visible')).resolves.toBe(true);
    await expect(store.set('fieldtheory-line-numbers', 'visible')).resolves.toBe(false);
    await expect(store.set('fieldtheory.codexTerminal.visible', '1')).resolves.toBe(false);
    await expect(store.set('librarian-last-selection', '{"type":"wiki","relPath":"scratchpad/Local"}')).resolves.toBe(true);
    await expect(store.set('librarian-immersive', 'true')).resolves.toBe(true);
    await expect(store.set('librarian-editor-session', '{"path":"scratchpad/Local"}')).resolves.toBe(true);

    const reloaded = new BrowserLibraryRendererStorageStore(storePath);
    const snapshot = await reloaded.snapshot();

    expect(snapshot.available).toBe(true);
    expect(snapshot.values['fieldtheory-line-numbers']).toBe('visible');
    expect(snapshot.values['fieldtheory.codexTerminal.visible']).toBeUndefined();
    expect(snapshot.values['librarian-last-selection']).toBe('{"type":"wiki","relPath":"scratchpad/Local"}');
    expect(snapshot.values['librarian-immersive']).toBe('true');
    expect(snapshot.values['librarian-editor-session']).toBe('{"path":"scratchpad/Local"}');
  });

  it('reads a complete snapshot synchronously for preload hydration', async () => {
    const store = new BrowserLibraryRendererStorageStore(storePath);
    await store.set('bookmarks-view-mode', 'list');

    const reloaded = new BrowserLibraryRendererStorageStore(storePath);
    const snapshot = reloaded.snapshotSync();

    expect(snapshot.available).toBe(true);
    expect(snapshot.values['bookmarks-view-mode']).toBe('list');
    expect(snapshot.values['fieldtheory-line-numbers']).toBeNull();
  });

  it('merges native renderer values and clears reset preferences', async () => {
    const store = new BrowserLibraryRendererStorageStore(storePath);
    await store.set('fieldtheory-line-numbers', 'visible');

    await store.merge({
      'fieldtheory-line-numbers': null,
      'bookmarks-shortcut': 'hidden',
      'bookmarks-view-mode': 'list',
      'fieldtheory.codexTerminal.visible': '1',
      'librarian-last-selection': '{"type":"wiki","relPath":"scratchpad/Native"}',
      'librarian-immersive': 'false',
      'librarian-editor-session': '{"path":"scratchpad/Native"}',
    });

    const snapshot = await store.snapshot();
    expect(snapshot.values['fieldtheory-line-numbers']).toBeNull();
    expect(snapshot.values['bookmarks-shortcut']).toBeUndefined();
    expect(snapshot.values['bookmarks-view-mode']).toBe('list');
    expect(snapshot.values['fieldtheory.codexTerminal.visible']).toBeUndefined();
    expect(snapshot.values['librarian-last-selection']).toBe('{"type":"wiki","relPath":"scratchpad/Native"}');
    expect(snapshot.values['librarian-immersive']).toBe('false');
    expect(snapshot.values['librarian-editor-session']).toBe('{"path":"scratchpad/Native"}');
  });
});
