import { beforeEach, describe, expect, it, vi } from 'vitest';

const asyncStorageMock = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    store,
    getItem: vi.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
      return Promise.resolve();
    }),
  };
});

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: asyncStorageMock.getItem,
    setItem: asyncStorageMock.setItem,
    removeItem: asyncStorageMock.removeItem,
  },
}));

import { StorageService } from '../../../services/storage';

const todo = (id: string, text = id) => ({
  id,
  text,
  completed: false,
  createdAt: 1000,
  updatedAt: 1000,
});

describe('mobile StorageService scoping', () => {
  beforeEach(() => {
    asyncStorageMock.store.clear();
    asyncStorageMock.getItem.mockClear();
    asyncStorageMock.setItem.mockClear();
    asyncStorageMock.removeItem.mockClear();
    StorageService.setUserScope(null);
  });

  it('stores signed-out data in the local-only scope', async () => {
    await StorageService.saveTodos([todo('local')]);

    expect(asyncStorageMock.store.has('@littleai/todos')).toBe(false);
    expect(JSON.parse(asyncStorageMock.store.get('@littleai/todos:local') ?? '[]')).toEqual([todo('local')]);
  });

  it('keeps user-scoped data isolated between accounts', async () => {
    StorageService.setUserScope('user-a');
    await StorageService.saveTodos([todo('a')]);

    StorageService.setUserScope('user-b');
    await StorageService.saveTodos([todo('b')]);

    StorageService.setUserScope('user-a');
    expect(await StorageService.getTodos()).toEqual([todo('a')]);

    StorageService.setUserScope('user-b');
    expect(await StorageService.getTodos()).toEqual([todo('b')]);
  });

  it('migrates legacy signed-out data to local scope with a backup and no overwrite', async () => {
    asyncStorageMock.store.set('@littleai/todos', JSON.stringify([todo('legacy')]));
    asyncStorageMock.store.set('@littleai/todos:local', JSON.stringify([todo('existing')]));

    await StorageService.migrateLegacyDataToLocalScope();

    expect(asyncStorageMock.store.has('@littleai/todos')).toBe(false);
    expect(JSON.parse(asyncStorageMock.store.get('@littleai/todos:local') ?? '[]')).toEqual([todo('existing')]);

    const backupKeys = Array.from(asyncStorageMock.store.keys()).filter((key) =>
      key.startsWith('@littleai/todos:legacy-local-backup:'),
    );
    expect(backupKeys).toHaveLength(1);
    expect(JSON.parse(asyncStorageMock.store.get(backupKeys[0]) ?? '[]')).toEqual([todo('legacy')]);
  });

  it('migrates legacy signed-in data to the user scope with a backup and no overwrite', async () => {
    asyncStorageMock.store.set('@littleai/todos', JSON.stringify([todo('legacy')]));
    asyncStorageMock.store.set('@littleai/todos:user-a', JSON.stringify([todo('existing')]));

    await StorageService.migrateLegacyDataToUserScope('user-a');

    expect(asyncStorageMock.store.has('@littleai/todos')).toBe(false);
    expect(JSON.parse(asyncStorageMock.store.get('@littleai/todos:user-a') ?? '[]')).toEqual([todo('existing')]);

    const backupKeys = Array.from(asyncStorageMock.store.keys()).filter((key) =>
      key.startsWith('@littleai/todos:legacy-backup:user-a:'),
    );
    expect(backupKeys).toHaveLength(1);
    expect(JSON.parse(asyncStorageMock.store.get(backupKeys[0]) ?? '[]')).toEqual([todo('legacy')]);
  });

  it('keeps the newest row tombstone per collection and id', async () => {
    await StorageService.addSyncTombstones([
      { collection: 'todos', id: 'same', deletedAt: 2000 },
      { collection: 'todos', id: 'same', deletedAt: 1000 },
      { collection: 'transcripts', id: 'same', deletedAt: 3000 },
    ]);

    expect(await StorageService.getSyncTombstones()).toEqual([
      { collection: 'todos', id: 'same', deletedAt: 2000 },
      { collection: 'transcripts', id: 'same', deletedAt: 3000 },
    ]);
  });
});
