import fs from 'fs';
import os from 'os';
import path from 'path';
import type { BrowserHelperServerAddress } from './browserHelperServer';

export type BrowserHelperState = {
  version: 1;
  host: string;
  port: number;
  token: string;
  browserUrl: string;
  panelUrl?: string;
  pid: number;
  startedAt: string;
};

export function browserHelperStatePath(): string {
  return process.env.FT_BROWSER_HELPER_STATE_PATH
    ?? path.join(os.homedir(), '.fieldtheory', 'browser-helper.json');
}

export function writeBrowserHelperState(input: {
  address: BrowserHelperServerAddress;
  browserUrl: string;
  panelUrl?: string;
  now?: Date;
}): void {
  const filePath = browserHelperStatePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const state: BrowserHelperState = {
    version: 1,
    host: input.address.host,
    port: input.address.port,
    token: input.address.token,
    browserUrl: input.browserUrl,
    ...(input.panelUrl ? { panelUrl: input.panelUrl } : {}),
    pid: process.pid,
    startedAt: (input.now ?? new Date()).toISOString(),
  };
  fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Best effort on platforms that do not support chmod.
  }
}

export function clearBrowserHelperState(): void {
  fs.rmSync(browserHelperStatePath(), { force: true });
}
