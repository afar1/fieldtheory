import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DocumentPresenceManager, type DocumentPresenceState } from './documentPresence';

describe('DocumentPresenceManager', () => {
  let dir: string;
  let stateFilePath: string;
  let nowMs: number;
  let manager: DocumentPresenceManager;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'document-presence-test-'));
    stateFilePath = join(dir, '.app-state', 'document-presence.json');
    nowMs = Date.parse('2026-06-01T12:00:00.000Z');
    manager = new DocumentPresenceManager({
      stateFilePath,
      writeDelayMs: 1,
      now: () => new Date(nowMs),
    });
  });

  afterEach(() => {
    manager.destroy();
    rmSync(dir, { recursive: true, force: true });
  });

  it('tracks multiple open documents with exactly one focused document', () => {
    manager.setWindowDocument('1', makeContext('/library/a.md', 'A'), true);
    nowMs += 1000;
    manager.setWindowDocument('2', makeContext('/library/b.md', 'B'), true);

    const state = manager.getState();
    expect(state.focusedPath).toBe('/library/b.md');
    expect(state.documents.filter(document => document.isOpen).map(document => document.path)).toEqual([
      '/library/b.md',
      '/library/a.md',
    ]);
    expect(state.documents.filter(document => document.isFocused)).toHaveLength(1);
  });

  it('keeps a document open until all windows showing it close', () => {
    manager.setWindowDocument('1', makeContext('/library/a.md', 'A'), true);
    manager.setWindowDocument('2', makeContext('/library/a.md', 'A'), false);

    manager.closeWindow('1');
    expect(manager.getState().documents[0]).toMatchObject({
      path: '/library/a.md',
      isOpen: true,
      isFocused: false,
      windowIds: ['2'],
    });

    manager.closeWindow('2');
    expect(manager.getState().documents[0]).toMatchObject({
      path: '/library/a.md',
      isOpen: false,
      isFocused: false,
      windowIds: [],
    });
  });

  it('bounds closed recents while preserving open documents', () => {
    manager = new DocumentPresenceManager({
      stateFilePath,
      writeDelayMs: 1,
      now: () => new Date(nowMs),
      recentLimit: 2,
      recentMaxAgeMs: 10_000,
    });

    manager.setWindowDocument('old', makeContext('/library/old.md', 'Old'), true);
    manager.closeWindow('old');
    nowMs += 11_000;
    manager.setWindowDocument('recent-1', makeContext('/library/recent-1.md', 'Recent 1'), true);
    manager.closeWindow('recent-1');
    nowMs += 1000;
    manager.setWindowDocument('recent-2', makeContext('/library/recent-2.md', 'Recent 2'), true);
    manager.closeWindow('recent-2');
    nowMs += 1000;
    manager.setWindowDocument('recent-3', makeContext('/library/recent-3.md', 'Recent 3'), true);
    manager.closeWindow('recent-3');
    manager.setWindowDocument('open', makeContext('/library/open.md', 'Open'), false);

    const paths = manager.getState().documents.map(document => document.path);
    expect(paths).toEqual(['/library/open.md', '/library/recent-3.md', '/library/recent-2.md']);
  });

  it('writes the central state file atomically after a debounce', async () => {
    manager.setWindowDocument('1', makeContext('/library/a.md', 'A'), true);

    await manager.flush();

    const state = JSON.parse(readFileSync(stateFilePath, 'utf8')) as DocumentPresenceState;
    expect(state).toMatchObject({
      version: 1,
      focusedPath: '/library/a.md',
      documents: [
        {
          path: '/library/a.md',
          title: 'A',
          isOpen: true,
          isFocused: true,
          windowIds: ['1'],
        },
      ],
    });
  });
});

function makeContext(filePath: string, title: string) {
  return {
    type: 'wiki' as const,
    rootPath: '/library',
    relPath: filePath.replace('/library/', ''),
    filePath,
    title,
  };
}
