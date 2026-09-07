import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { EventEmitter } from 'events';
const mocks = vi.hoisted(() => ({ fromPartition: vi.fn(), windows: [] as any[] }));
vi.mock('electron', () => ({
  session: { fromPartition: mocks.fromPartition },
  BrowserWindow: class extends EventEmitter {
    destroyed = false;
    webContents = Object.assign(new EventEmitter(), { setWindowOpenHandler: vi.fn() });
    constructor(public options: unknown) { super(); mocks.windows.push(this); }
    loadURL = vi.fn(async () => {});
    focus = vi.fn();
    isDestroyed() { return this.destroyed; }
    close() { this.destroyed = true; this.emit('closed'); }
  },
}));
import { BookmarkAuth, credentialsFromCookies } from './bookmarkAuth';
const dirs: string[] = [];
const cookies = [{ name: 'ct0', value: 'csrf123', domain: '.x.com' }, { name: 'auth_token', value: 'auth456', domain: '.x.com' }];
function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-bookmark-auth-')); dirs.push(dir);
  const file = path.join(dir, 'connection.json');
  const jar = Object.assign(new EventEmitter(), { get: vi.fn(async () => cookies) });
  const browserSession = { cookies: jar, clearStorageData: vi.fn(async () => {}), setPermissionRequestHandler: vi.fn() };
  mocks.fromPartition.mockReturnValue(browserSession);
  return { file, jar, browserSession, auth: new BookmarkAuth(file) };
}
afterEach(() => { dirs.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true })); mocks.fromPartition.mockReset(); mocks.windows.length = 0; });
describe('BookmarkAuth', () => {
  it('does not access any browser session on fresh install or disconnected restart', async () => {
    const { auth, file } = setup();
    expect(await auth.credentials()).toBeNull(); auth.requireConnection();
    expect(await new BookmarkAuth(file).credentials()).toBeNull();
    expect(mocks.fromPartition).not.toHaveBeenCalled(); expect(mocks.windows).toHaveLength(0);
  });
  it('only accepts the two X session cookies and rejects spoofed domains or header injection', () => {
    expect(credentialsFromCookies(cookies)).toEqual({ csrfToken: 'csrf123', cookieHeader: 'ct0=csrf123; auth_token=auth456' });
    expect(credentialsFromCookies(cookies.map(cookie => ({ ...cookie, domain: 'evil.x.com' })))).toBeNull();
    expect(credentialsFromCookies([cookies[0], { ...cookies[1], value: 'abc; injected=yes' }])).toBeNull();
  });
  it('opens only on explicit connect, shares repeated requests, and persists consent without secrets', async () => {
    const { auth, jar, file } = setup();
    const first = auth.connect(), second = auth.connect(); expect(first).toBe(second);
    await Promise.resolve(); expect(mocks.windows).toHaveLength(1);
    expect(mocks.windows[0].options.webPreferences).toMatchObject({ nodeIntegration: false, contextIsolation: true, sandbox: true });
    jar.emit('changed'); await first;
    expect(auth.isConnected()).toBe(true); expect(mocks.windows[0].destroyed).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toBe('{"connected":true}');
    expect(await new BookmarkAuth(file).credentials()).toEqual({ csrfToken: 'csrf123', cookieHeader: 'ct0=csrf123; auth_token=auth456' });
  });
  it('closing connect leaves background reads disabled, including after restarting', async () => {
    const { auth, file } = setup(); const connection = auth.connect(); await Promise.resolve();
    mocks.windows[0].close(); expect(await connection).toBe(false);
    mocks.fromPartition.mockClear();
    expect(await new BookmarkAuth(file).credentials()).toBeNull(); expect(mocks.fromPartition).not.toHaveBeenCalled();
  });
});
