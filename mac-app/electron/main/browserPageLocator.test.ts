import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  browserAutomationKindForApp,
  buildActiveBrowserPageScript,
  extractLastHttpUrlFromChromiumSession,
  findAtlasSessionPage,
  getActiveBrowserPage,
  parseActiveBrowserPageOutput,
} from './browserPageLocator';

describe('browserPageLocator', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('uses Safari document automation for Safari', () => {
    const script = buildActiveBrowserPageScript({ bundleId: 'com.apple.Safari', name: 'Safari' });

    expect(script).toContain('URL of front document');
    expect(script).toContain('name of front document');
  });

  it('uses active-tab automation for Chromium browsers and Arc', () => {
    const chromeScript = buildActiveBrowserPageScript({ bundleId: 'com.google.Chrome', name: 'Google Chrome' });
    const arcScript = buildActiveBrowserPageScript({ bundleId: 'company.thebrowser.Browser', name: 'Arc' });

    expect(chromeScript).toContain('active tab of front window');
    expect(arcScript).toContain('active tab of front window');
  });

  it('does not use the Chromium AppleScript dictionary for Atlas', () => {
    expect(browserAutomationKindForApp({ bundleId: 'com.openai.atlas', name: 'ChatGPT Atlas' })).toBeNull();
    expect(buildActiveBrowserPageScript({ bundleId: 'com.openai.atlas', name: 'ChatGPT Atlas' })).toBeNull();
  });

  it('rejects unsupported apps', () => {
    expect(browserAutomationKindForApp({ bundleId: 'com.apple.TextEdit', name: 'TextEdit' })).toBeNull();
    expect(buildActiveBrowserPageScript({ bundleId: 'com.apple.TextEdit', name: 'TextEdit' })).toBeNull();
  });

  it('rejects unsafe bundle ids before building AppleScript', () => {
    expect(buildActiveBrowserPageScript({ bundleId: 'com.bad"app', name: 'Google Chrome' })).toBeNull();
  });

  it('parses active browser page output', () => {
    const page = parseActiveBrowserPageOutput(
      'https://example.com/read\nExample title\n',
      { bundleId: 'com.apple.Safari', name: 'Safari' },
    );

    expect(page).toEqual({
      url: 'https://example.com/read',
      title: 'Example title',
      bundleId: 'com.apple.Safari',
      appName: 'Safari',
    });
  });

  it('extracts the last URL from a Chromium session file', () => {
    const data = Buffer.from('old https://example.com/old\0new https://example.com/current<\0', 'latin1');

    expect(extractLastHttpUrlFromChromiumSession(data)).toBe('https://example.com/current');
  });

  it('finds the latest Atlas session URL without AppleScript', async () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-session-'));
    tempDirs.push(homeDir);
    const sessionsDir = path.join(
      homeDir,
      'Library',
      'Application Support',
      'com.openai.atlas',
      'browser-data',
      'host',
      'Default',
      'Sessions',
    );
    fs.mkdirSync(sessionsDir, { recursive: true });
    const oldFile = path.join(sessionsDir, 'Session_1');
    const newFile = path.join(sessionsDir, 'Session_2');
    fs.writeFileSync(oldFile, Buffer.from('https://example.com/old', 'latin1'));
    fs.writeFileSync(newFile, Buffer.from('https://example.com/new\0https://example.com/current<', 'latin1'));
    fs.utimesSync(oldFile, new Date('2026-01-01T00:00:00Z'), new Date('2026-01-01T00:00:00Z'));
    fs.utimesSync(newFile, new Date('2026-01-02T00:00:00Z'), new Date('2026-01-02T00:00:00Z'));

    const page = findAtlasSessionPage({ bundleId: 'com.openai.atlas', name: 'ChatGPT Atlas' }, homeDir);

    expect(page?.url).toBe('https://example.com/current');
  });

  it('runs osascript and returns the current browser page', async () => {
    const execFile = vi.fn((_file, _args, _options, callback) => {
      callback(null, 'https://example.com/current\nCurrent page\n', '');
    });

    const page = await getActiveBrowserPage(
      { bundleId: 'com.google.Chrome', name: 'Google Chrome' },
      execFile,
    );

    expect(execFile).toHaveBeenCalledWith(
      'osascript',
      ['-e', expect.stringContaining('com.google.Chrome')],
      { timeout: 3000 },
      expect.any(Function),
    );
    expect(page?.url).toBe('https://example.com/current');
    expect(page?.title).toBe('Current page');
  });
});
