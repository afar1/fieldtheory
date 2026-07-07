import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mockElectronState = vi.hoisted(() => ({
  userDataPath: '',
}));

const mockSqliteCounts = vi.hoisted(() => new Map<string, number>());

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name !== 'userData') {
        throw new Error(`Unexpected getPath request: ${name}`);
      }
      return mockElectronState.userDataPath;
    }),
  },
}));

vi.mock('./logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('better-sqlite3', () => ({
  default: class MockDatabase {
    constructor(private dbPath: string) {}

    prepare(sql: string): { get: () => unknown } {
      if (sql.includes('sqlite_master')) {
        return { get: () => ({ name: 'clipboard_items' }) };
      }
      return { get: () => ({ count: mockSqliteCounts.get(this.dbPath) ?? 0 }) };
    }

    close(): void {}
  },
}));

import { UserDataManager } from './userDataManager';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.removeSync(dir);
  }
  mockSqliteCounts.clear();
});

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fieldtheory-user-data-'));
  tempDirs.push(dir);
  return dir;
}

function createClipboardDb(dbPath: string, rows: string[]): void {
  fs.writeFileSync(dbPath, rows.join('\n'));
  mockSqliteCounts.set(dbPath, rows.length);
}

describe('UserDataManager', () => {
  it('restores the current user from current-user.json first', async () => {
    mockElectronState.userDataPath = makeTempDir();
    await fs.writeJson(path.join(mockElectronState.userDataPath, 'current-user.json'), {
      callsign: 'saved-user',
    });
    await fs.writeJson(path.join(mockElectronState.userDataPath, 'supabase-session.json'), {
      'sb-test-auth-token': JSON.stringify({ user: { id: 'session-user' } }),
    });

    const manager = new UserDataManager();

    await expect(manager.restoreCurrentUser()).resolves.toBe('saved-user');
    expect(manager.getCurrentCallsign()).toBe('saved-user');
  });

  it('restores the current user from the stored auth session when current-user.json is missing', async () => {
    mockElectronState.userDataPath = makeTempDir();
    await fs.writeJson(path.join(mockElectronState.userDataPath, 'supabase-session.json'), {
      'sb-test-auth-token': JSON.stringify({ user: { id: 'session-user' } }),
    });

    const manager = new UserDataManager();

    await expect(manager.restoreCurrentUser()).resolves.toBe('session-user');
    expect(manager.getCurrentCallsign()).toBe('session-user');
    await expect(fs.readJson(path.join(mockElectronState.userDataPath, 'current-user.json'))).resolves.toEqual({
      callsign: 'session-user',
    });
  });

  it('migrates legacy clipboard history after setCurrentUser creates the user directory', async () => {
    mockElectronState.userDataPath = makeTempDir();
    const manager = new UserDataManager();
    const legacyDb = path.join(mockElectronState.userDataPath, 'clipboard.db');
    const legacyWal = path.join(mockElectronState.userDataPath, 'clipboard.db-wal');
    await fs.writeFile(legacyDb, 'legacy clipboard rows');
    await fs.writeFile(legacyWal, 'legacy wal rows');

    await manager.setCurrentUser('session-user');
    await manager.migrateExistingData('session-user');

    await expect(fs.readFile(path.join(
      mockElectronState.userDataPath,
      'users',
      'session-user',
      'clipboard.db'
    ), 'utf8')).resolves.toBe('legacy clipboard rows');
    await expect(fs.readFile(path.join(
      mockElectronState.userDataPath,
      'users',
      'session-user',
      'clipboard.db-wal'
    ), 'utf8')).resolves.toBe('legacy wal rows');
    await expect(fs.pathExists(legacyDb)).resolves.toBe(false);
  });

  it('migrates small app state files into the restored user directory', async () => {
    mockElectronState.userDataPath = makeTempDir();
    const manager = new UserDataManager();
    await fs.writeJson(path.join(mockElectronState.userDataPath, 'recent.json'), [{ path: 'Commands/release' }]);
    await fs.writeJson(path.join(mockElectronState.userDataPath, 'browser-library-renderer-storage.json'), { view: 'library' });
    await fs.writeFile(path.join(mockElectronState.userDataPath, 'library-index.db'), 'index rows');

    await manager.setCurrentUser('session-user');
    await manager.migrateExistingData('session-user');

    const userDir = path.join(mockElectronState.userDataPath, 'users', 'session-user');
    await expect(fs.readJson(path.join(userDir, 'recent.json'))).resolves.toEqual([{ path: 'Commands/release' }]);
    await expect(fs.readJson(path.join(userDir, 'browser-library-renderer-storage.json'))).resolves.toEqual({ view: 'library' });
    await expect(fs.readFile(path.join(userDir, 'library-index.db'), 'utf8')).resolves.toBe('index rows');
    await expect(fs.pathExists(path.join(mockElectronState.userDataPath, 'recent.json'))).resolves.toBe(false);
  });

  it('replaces an empty per-user clipboard database with legacy history', async () => {
    mockElectronState.userDataPath = makeTempDir();
    const manager = new UserDataManager();
    const legacyDb = path.join(mockElectronState.userDataPath, 'clipboard.db');
    createClipboardDb(legacyDb, ['legacy row']);

    await manager.setCurrentUser('session-user');
    const targetDb = path.join(mockElectronState.userDataPath, 'users', 'session-user', 'clipboard.db');
    createClipboardDb(targetDb, []);

    await manager.migrateExistingData('session-user');

    await expect(fs.readFile(targetDb, 'utf8')).resolves.toBe('legacy row');
    await expect(fs.pathExists(legacyDb)).resolves.toBe(false);
  });
});
