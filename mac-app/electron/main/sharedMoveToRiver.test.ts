import { describe, expect, it, vi } from 'vitest';
import { isMoveIntoRiver, moveLibraryFileIntoRiver, type RiverMoveLibrarian } from './sharedMoveToRiver';
import type { SharedSyncService } from './sharedSyncService';

function librarian(overrides: Partial<RiverMoveLibrarian> = {}): RiverMoveLibrarian {
  return {
    getWikiPage: vi.fn(() => ({
      absPath: '/library/scratchpad/Note.md',
      title: 'Note',
      content: 'Body\n',
    })),
    deleteWikiPage: vi.fn(async () => true),
    emit: vi.fn(),
    ...overrides,
  };
}

function sharedSync(overrides: Partial<Pick<SharedSyncService, 'shareFile' | 'emit'>> = {}): Pick<SharedSyncService, 'shareFile' | 'emit'> {
  return {
    shareFile: vi.fn(async () => ({
      shared: true,
      sharedId: 'shared-1',
      cachePath: '/library/River (shared)/Note AF.md',
    })),
    emit: vi.fn(),
    ...overrides,
  };
}

describe('moveLibraryFileIntoRiver', () => {
  it('detects only file moves from outside River into the River root', () => {
    expect(isMoveIntoRiver('file', 'scratchpad/Note', 'River (shared)')).toBe(true);
    expect(isMoveIntoRiver('dir', 'scratchpad', 'River (shared)')).toBe(false);
    expect(isMoveIntoRiver('file', 'River (shared)/Note', 'River (shared)')).toBe(false);
    expect(isMoveIntoRiver('file', 'scratchpad/Note', 'scratchpad')).toBe(false);
  });

  it('shares the file before deleting the source', async () => {
    const calls: string[] = [];
    const manager = librarian({
      deleteWikiPage: vi.fn(async () => {
        calls.push('delete');
        return true;
      }),
    });
    const sync = sharedSync({
      shareFile: vi.fn(async () => {
        calls.push('share');
        return { shared: true, sharedId: 'shared-1', cachePath: '/library/River (shared)/Note AF.md' };
      }),
    });

    await expect(moveLibraryFileIntoRiver({
      librarianManager: manager,
      sharedSyncService: sync,
      rootPath: '/library',
      sourceRelPath: 'scratchpad/Note',
    })).resolves.toBe('River (shared)/Note AF');
    expect(calls).toEqual(['share', 'delete']);
    expect(manager.emit).toHaveBeenCalledWith('library:changed');
    expect(sync.emit).toHaveBeenCalledWith('pinsChanged');
  });

  it('leaves the source in place when sharing fails', async () => {
    const manager = librarian();
    const sync = sharedSync({
      shareFile: vi.fn(async () => ({ shared: false })),
    });

    await expect(moveLibraryFileIntoRiver({
      librarianManager: manager,
      sharedSyncService: sync,
      rootPath: '/library',
      sourceRelPath: 'scratchpad/Note',
    })).resolves.toBeNull();
    expect(manager.deleteWikiPage).not.toHaveBeenCalled();
    expect(manager.emit).not.toHaveBeenCalled();
  });

  it('reports failure when source deletion fails after sharing', async () => {
    const manager = librarian({
      deleteWikiPage: vi.fn(async () => false),
    });
    const sync = sharedSync();

    await expect(moveLibraryFileIntoRiver({
      librarianManager: manager,
      sharedSyncService: sync,
      rootPath: '/library',
      sourceRelPath: 'scratchpad/Note',
    })).resolves.toBeNull();
    expect(manager.deleteWikiPage).toHaveBeenCalledWith('scratchpad/Note');
    expect(manager.emit).not.toHaveBeenCalled();
    expect(sync.emit).not.toHaveBeenCalled();
  });
});
