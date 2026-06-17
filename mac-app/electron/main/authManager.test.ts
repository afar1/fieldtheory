import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '@supabase/supabase-js';
import fs from 'fs';
import os from 'os';
import path from 'path';

const electronMock = vi.hoisted(() => ({
  app: {
    getPath: vi.fn(() => '/tmp'),
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((value: string) => Buffer.from(value, 'utf-8')),
    decryptString: vi.fn((value: Buffer) => value.toString('utf-8')),
  },
}));

vi.mock('electron', () => electronMock);

import { AuthManager, FileStorage } from './authManager';

describe('AuthManager renderer session state', () => {
  beforeEach(() => {
    electronMock.safeStorage.isEncryptionAvailable.mockReturnValue(true);
    electronMock.safeStorage.encryptString.mockImplementation((value: string) => Buffer.from(value, 'utf-8'));
    electronMock.safeStorage.decryptString.mockImplementation((value: Buffer) => value.toString('utf-8'));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('stays unauthenticated when Supabase public config is unavailable', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('FIELD_THEORY_SUPABASE_PUBLISHABLE_KEY', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');

    const manager = new AuthManager();

    await expect(manager.init()).resolves.toBeUndefined();
    expect(manager.getSessionState()).toBeNull();
    expect(manager.getSupabaseClient()).toBeNull();
  });

  it('omits access and refresh tokens from the public session state', () => {
    const manager = new AuthManager();
    const session = {
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      expires_in: 3600,
      expires_at: 4102444800,
      token_type: 'bearer',
      user: {
        id: 'user-1',
        email: 'river@example.com',
        aud: 'authenticated',
        created_at: '2024-01-01T00:00:00.000Z',
        user_metadata: { callsign: 'river', full_name: 'River User' },
        app_metadata: { provider: 'email' },
      },
    } as Session;

    (manager as unknown as { session: Session }).session = session;

    const state = manager.getSessionState();

    expect(state).toEqual({
      authenticated: true,
      expires_at: 4102444800,
      expiresAt: 4102444800,
      tier: 'free',
      callsign: 'river',
      displayName: 'River User',
      user: {
        id: 'user-1',
        email: 'river@example.com',
        user_metadata: { callsign: 'river', full_name: 'River User' },
        app_metadata: { provider: 'email' },
      },
    });
    expect(JSON.stringify(state)).not.toContain('access-token');
    expect(JSON.stringify(state)).not.toContain('refresh-token');
  });
});

describe('FileStorage session persistence', () => {
  beforeEach(() => {
    electronMock.safeStorage.isEncryptionAvailable.mockReturnValue(true);
    electronMock.safeStorage.encryptString.mockImplementation((value: string) => Buffer.from(value, 'utf-8'));
    electronMock.safeStorage.decryptString.mockImplementation((value: Buffer) => value.toString('utf-8'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('persists to a user-only session file without using safeStorage', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fieldtheory-auth-'));
    const storage = new FileStorage(tempDir);

    await storage.setItem('auth-token', JSON.stringify({ refresh_token: 'refresh-token' }));

    const sessionPath = path.join(tempDir, 'supabase-session.json');
    const protectedSessionPath = path.join(tempDir, 'supabase-session.enc');
    expect(fs.existsSync(protectedSessionPath)).toBe(false);
    expect(JSON.parse(fs.readFileSync(sessionPath, 'utf-8'))).toEqual({
      'auth-token': JSON.stringify({ refresh_token: 'refresh-token' }),
    });
    expect(fs.statSync(sessionPath).mode & 0o777).toBe(0o600);
    expect(electronMock.safeStorage.encryptString).not.toHaveBeenCalled();

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('loads the session file before any stale protected session', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fieldtheory-auth-'));
    fs.writeFileSync(path.join(tempDir, 'supabase-session.enc'), Buffer.from(JSON.stringify({
      'auth-token': JSON.stringify({ refresh_token: 'stale-token' }),
    })));
    fs.writeFileSync(path.join(tempDir, 'supabase-session.json'), JSON.stringify({
      'auth-token': JSON.stringify({ refresh_token: 'refresh-token' }),
    }));

    const storage = new FileStorage(tempDir);

    await expect(storage.getItem('auth-token')).resolves.toBe(JSON.stringify({ refresh_token: 'refresh-token' }));
    expect(electronMock.safeStorage.decryptString).not.toHaveBeenCalled();

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('does not decrypt a legacy protected session when the session file is empty', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fieldtheory-auth-'));
    fs.writeFileSync(path.join(tempDir, 'supabase-session.json'), JSON.stringify({}));
    fs.chmodSync(path.join(tempDir, 'supabase-session.json'), 0o644);
    fs.writeFileSync(path.join(tempDir, 'supabase-session.enc'), Buffer.from(JSON.stringify({
      'auth-token': JSON.stringify({ refresh_token: 'legacy-token' }),
    })));

    const storage = new FileStorage(tempDir);

    await expect(storage.getItem('auth-token')).resolves.toBeNull();
    expect(fs.existsSync(path.join(tempDir, 'supabase-session.enc'))).toBe(false);
    expect(fs.statSync(path.join(tempDir, 'supabase-session.json')).mode & 0o777).toBe(0o600);
    expect(electronMock.safeStorage.decryptString).not.toHaveBeenCalled();

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('removes a legacy protected session without decrypting it', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fieldtheory-auth-'));
    fs.writeFileSync(path.join(tempDir, 'supabase-session.enc'), Buffer.from(JSON.stringify({
      'auth-token': JSON.stringify({ refresh_token: 'legacy-token' }),
    })));

    const storage = new FileStorage(tempDir);

    await expect(storage.getItem('auth-token')).resolves.toBeNull();
    expect(fs.existsSync(path.join(tempDir, 'supabase-session.enc'))).toBe(false);
    expect(electronMock.safeStorage.decryptString).not.toHaveBeenCalled();

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('clears a corrupt session file without decrypting a legacy protected session', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fieldtheory-auth-'));
    fs.writeFileSync(path.join(tempDir, 'supabase-session.json'), '{');
    fs.writeFileSync(path.join(tempDir, 'supabase-session.enc'), Buffer.from(JSON.stringify({
      'auth-token': JSON.stringify({ refresh_token: 'legacy-token' }),
    })));

    const storage = new FileStorage(tempDir);

    await expect(storage.getItem('auth-token')).resolves.toBeNull();
    expect(JSON.parse(fs.readFileSync(path.join(tempDir, 'supabase-session.json'), 'utf-8'))).toEqual({});
    expect(fs.existsSync(path.join(tempDir, 'supabase-session.enc'))).toBe(false);
    expect(electronMock.safeStorage.decryptString).not.toHaveBeenCalled();

    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
