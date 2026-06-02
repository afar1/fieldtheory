import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { browserHelperStatePath, clearBrowserHelperState, writeBrowserHelperState } from './browserHelperState';

const originalStatePath = process.env.FT_BROWSER_HELPER_STATE_PATH;

afterEach(() => {
  if (originalStatePath === undefined) delete process.env.FT_BROWSER_HELPER_STATE_PATH;
  else process.env.FT_BROWSER_HELPER_STATE_PATH = originalStatePath;
});

describe('browserHelperState', () => {
  it('writes and clears the browser helper address for CLI panel links', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-browser-helper-state-'));
    const statePath = path.join(tmpDir, 'browser-helper.json');
    process.env.FT_BROWSER_HELPER_STATE_PATH = statePath;

    writeBrowserHelperState({
      address: {
        host: '127.0.0.1',
        port: 59971,
        token: 'test-token',
        url: 'http://127.0.0.1:59971/?token=test-token',
      },
      browserUrl: 'http://127.0.0.1:59971/browser-library.html?api=http%3A%2F%2F127.0.0.1%3A59971&token=test-token',
      now: new Date('2026-06-02T12:00:00.000Z'),
    });

    expect(browserHelperStatePath()).toBe(statePath);
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    expect(state).toMatchObject({
      version: 1,
      host: '127.0.0.1',
      port: 59971,
      token: 'test-token',
      startedAt: '2026-06-02T12:00:00.000Z',
    });
    expect(state.browserUrl).toContain('/browser-library.html');
    expect(fs.statSync(statePath).mode & 0o777).toBe(0o600);

    clearBrowserHelperState();
    expect(fs.existsSync(statePath)).toBe(false);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
