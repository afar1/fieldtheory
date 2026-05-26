import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mockElectronState = vi.hoisted(() => ({
  userDataPath: '',
}));

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

import { UserDataManager } from './userDataManager';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.removeSync(dir);
  }
});

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fieldtheory-user-data-'));
  tempDirs.push(dir);
  return dir;
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
});
