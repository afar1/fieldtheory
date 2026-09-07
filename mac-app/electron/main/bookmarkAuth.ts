import { BrowserWindow, session } from 'electron';
import fs from 'fs';
import path from 'path';

export type BookmarkCredentials = { csrfToken: string; cookieHeader: string };
export function credentialsFromCookies(cookies: Array<{ name: string; value: string; domain?: string }>): BookmarkCredentials | null {
  const trusted = cookies.filter(cookie => ['x.com', '.x.com'].includes(cookie.domain ?? ''));
  const token = (name: string) => trusted.find(cookie => cookie.name === name)?.value;
  const csrfToken = token('ct0'), authToken = token('auth_token');
  if (!csrfToken || !authToken || !/^[a-zA-Z0-9]+$/.test(csrfToken) || !/^[a-zA-Z0-9]+$/.test(authToken)) return null;
  return { csrfToken, cookieHeader: `ct0=${csrfToken}; auth_token=${authToken}` };
}

/** A dedicated X session. Never reads another browser's cookies or Keychain. */
export class BookmarkAuth {
  private connecting: Promise<boolean> | null = null;
  private window: BrowserWindow | null = null;
  private connected: boolean;
  constructor(private readonly statePath: string) {
    try { this.connected = JSON.parse(fs.readFileSync(statePath, 'utf8')).connected === true; }
    catch { this.connected = false; }
  }
  isConnected = (): boolean => this.connected;
  private persist(connected: boolean): void {
    this.connected = connected;
    fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
    fs.writeFileSync(this.statePath, JSON.stringify({ connected }), { mode: 0o600 });
  }
  requireConnection = (): void => { this.persist(false); };
  async credentials(): Promise<BookmarkCredentials | null> {
    if (!this.connected) return null;
    return credentialsFromCookies(await session.fromPartition('persist:fieldtheory-x-bookmarks').cookies.get({ url: 'https://x.com' }));
  }
  connect(): Promise<boolean> {
    if (this.connecting) { this.window?.focus(); return this.connecting; }
    this.connecting = this.openConnection().finally(() => { this.connecting = null; });
    return this.connecting;
  }
  private async openConnection(): Promise<boolean> {
    this.persist(false);
    const xSession = session.fromPartition('persist:fieldtheory-x-bookmarks');
    xSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    // Explicit reconnect discards the expired dedicated login, never browser data.
    await xSession.clearStorageData({ storages: ['cookies'] });
    const login = new BrowserWindow({ width: 620, height: 760, title: 'Connect X bookmarks — Field Theory',
      webPreferences: { session: xSession, nodeIntegration: false, contextIsolation: true, sandbox: true } });
    this.window = login;
    login.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const restrictNavigation = (event: { preventDefault: () => void }, url: string) => {
      try { const parsed = new URL(url); if (parsed.protocol !== 'https:' || !['x.com', 'twitter.com'].includes(parsed.hostname)) event.preventDefault(); }
      catch { event.preventDefault(); }
    };
    login.webContents.on('will-navigate', restrictNavigation);
    login.webContents.on('will-redirect', restrictNavigation);
    return new Promise<boolean>((resolve) => {
      let complete = false;
      const finish = (ok: boolean) => {
        if (complete) return; complete = true;
        xSession.cookies.removeListener('changed', changed);
        this.window = null;
        if (ok) { try { this.persist(true); } catch { this.connected = false; ok = false; } }
        if (!login.isDestroyed()) login.close();
        resolve(ok);
      };
      const changed = () => { void xSession.cookies.get({ url: 'https://x.com' }).then(cookies => {
        if (credentialsFromCookies(cookies)) finish(true);
      }).catch(() => {}); };
      xSession.cookies.on('changed', changed);
      login.on('closed', () => finish(false));
      void login.loadURL('https://x.com/i/flow/login').catch(() => finish(false));
    });
  }
}
