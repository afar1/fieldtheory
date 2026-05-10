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

const authMock = vi.hoisted(() => ({
  getSession: vi.fn(),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: asyncStorageMock.getItem,
    setItem: asyncStorageMock.setItem,
    removeItem: asyncStorageMock.removeItem,
  },
}));

vi.mock('../../../services/auth', () => ({
  getSession: authMock.getSession,
}));

vi.mock('../../../services/supabase', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

import { CommandsService } from '../../../services/commands';
import type { Command } from '../../../types';

const session = (userId: string) => ({ user: { id: userId } });

const command = (id: string): Command => ({
  id,
  name: id,
  displayName: id.toUpperCase(),
  content: `# ${id}`,
  updatedAt: 1000,
});

describe('mobile CommandsService cache scoping', () => {
  beforeEach(() => {
    asyncStorageMock.store.clear();
    asyncStorageMock.getItem.mockClear();
    asyncStorageMock.setItem.mockClear();
    asyncStorageMock.removeItem.mockClear();
    authMock.getSession.mockReset();
  });

  it('caches commands under the explicit user id', async () => {
    await CommandsService.cacheCommands([command('review')], 'user-a');

    expect(JSON.parse(asyncStorageMock.store.get('@littleai/commands/user-a') ?? '[]')).toEqual([
      command('review'),
    ]);
    expect(asyncStorageMock.store.has('@littleai/commands')).toBe(false);
  });

  it('reads only the current user scoped cache', async () => {
    asyncStorageMock.store.set('@littleai/commands/user-a', JSON.stringify([command('a')]));
    asyncStorageMock.store.set('@littleai/commands/user-b', JSON.stringify([command('b')]));

    authMock.getSession.mockResolvedValue(session('user-b'));

    expect(await CommandsService.getCachedCommands()).toEqual([command('b')]);
  });

  it('returns no cached commands when signed out', async () => {
    asyncStorageMock.store.set('@littleai/commands/user-a', JSON.stringify([command('a')]));
    authMock.getSession.mockResolvedValue(null);

    expect(await CommandsService.getCachedCommands()).toEqual([]);
  });

  it('clears the legacy key and only the requested user cache', async () => {
    asyncStorageMock.store.set('@littleai/commands', JSON.stringify([command('legacy')]));
    asyncStorageMock.store.set('@littleai/commands/user-a', JSON.stringify([command('a')]));
    asyncStorageMock.store.set('@littleai/commands/user-b', JSON.stringify([command('b')]));

    await CommandsService.clearCache('user-a');

    expect(asyncStorageMock.store.has('@littleai/commands')).toBe(false);
    expect(asyncStorageMock.store.has('@littleai/commands/user-a')).toBe(false);
    expect(JSON.parse(asyncStorageMock.store.get('@littleai/commands/user-b') ?? '[]')).toEqual([
      command('b'),
    ]);
  });

  it('clears the active signed-in user cache when no user id is passed', async () => {
    asyncStorageMock.store.set('@littleai/commands/user-a', JSON.stringify([command('a')]));
    authMock.getSession.mockResolvedValue(session('user-a'));

    await CommandsService.clearCache();

    expect(asyncStorageMock.store.has('@littleai/commands/user-a')).toBe(false);
  });
});
