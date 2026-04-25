import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

import { PreferencesManager, normalizeClipboardHistorySizeKey, pickSavedBoundsByKey, type ClipboardHistoryBounds } from './preferences';

const sampleBounds = (w: number): ClipboardHistoryBounds => ({
  width: w,
  height: 600,
  displayConfig: 'dummy',
});

describe('pickSavedBoundsByKey', () => {
  it('returns the per-view entry when present', () => {
    const prefs = {
      clipboardHistoryBoundsByView: {
        library: sampleBounds(720),
        draw: sampleBounds(1180),
      },
    };
    expect(pickSavedBoundsByKey(prefs, 'library')?.width).toBe(720);
    expect(pickSavedBoundsByKey(prefs, 'canvas')?.width).toBe(1180);
  });

  it('normalizes canvas to draw', () => {
    expect(normalizeClipboardHistorySizeKey('canvas')).toBe('draw');
  });

  it('falls back to legacy clipboardHistoryBounds only for "fields"', () => {
    const prefs = { clipboardHistoryBounds: sampleBounds(900) };
    expect(pickSavedBoundsByKey(prefs, 'fields')?.width).toBe(900);
    // Non-fields keys must NOT inherit the legacy bounds.
    expect(pickSavedBoundsByKey(prefs, 'library')).toBeUndefined();
    expect(pickSavedBoundsByKey(prefs, 'canvas')).toBeUndefined();
    expect(pickSavedBoundsByKey(prefs, 'draw')).toBeUndefined();
  });

  it('per-view "fields" entry wins over the legacy field', () => {
    const prefs = {
      clipboardHistoryBounds: sampleBounds(900),
      clipboardHistoryBoundsByView: { fields: sampleBounds(950) },
    };
    expect(pickSavedBoundsByKey(prefs, 'fields')?.width).toBe(950);
  });

  it('returns undefined when nothing is saved', () => {
    expect(pickSavedBoundsByKey(null, 'library')).toBeUndefined();
    expect(pickSavedBoundsByKey({}, 'canvas')).toBeUndefined();
    expect(pickSavedBoundsByKey(undefined, 'fields')).toBeUndefined();
  });
});

describe('PreferencesManager', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fieldtheory-preferences-'));
    mockElectronState.userDataPath = tempDir;
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('preserves stored hotkeys when saving unrelated preference changes', async () => {
    const prefsPath = path.join(tempDir, 'preferences.json');
    await fs.writeFile(
      prefsPath,
      JSON.stringify(
        {
          clipboardHistoryHotkey: 'Command+Option+Space',
          commandLauncherHotkey: 'Command+Shift+L',
          transcriptionHotkey: 'Control+Space',
        },
        null,
        2,
      ),
      'utf-8',
    );

    const preferences = new PreferencesManager();
    const loaded = await preferences.load();

    expect(loaded.clipboardHistoryHotkey).toBe('Command+Option+Space');
    expect(loaded.commandLauncherHotkey).toBe('Command+Shift+L');
    expect(loaded.transcriptionHotkey).toBe('Control+Space');

    await preferences.save({ showInDock: true });

    const saved = JSON.parse(await fs.readFile(prefsPath, 'utf-8')) as Record<string, unknown>;
    expect(saved.clipboardHistoryHotkey).toBe('Command+Option+Space');
    expect(saved.commandLauncherHotkey).toBe('Command+Shift+L');
    expect(saved.transcriptionHotkey).toBe('Control+Space');
    expect(saved.showInDock).toBe(true);
  });

  it('mirrors hotkeys to shared prefs and preserves them when signed out', async () => {
    const sharedPrefsPath = path.join(tempDir, 'preferences.json');
    const userPrefsPath = path.join(tempDir, 'users', 'user-123', 'preferences.json');
    await fs.mkdir(path.dirname(userPrefsPath), { recursive: true });
    await fs.writeFile(
      userPrefsPath,
      JSON.stringify(
        {
          clipboardHistoryHotkey: 'Command+Option+Space',
          commandLauncherHotkey: 'Command+Shift+L',
          transcriptionHotkey: 'Control+Space',
          showInDock: true,
        },
        null,
        2,
      ),
      'utf-8',
    );

    let loggedIn = true;
    const userDataManager = {
      isLoggedIn: () => loggedIn,
      getUserDataPath: (subpath?: string) => {
        const userDir = path.join(tempDir, 'users', 'user-123');
        return subpath ? path.join(userDir, subpath) : userDir;
      },
    };

    const preferences = new PreferencesManager();
    preferences.setUserDataManager(userDataManager as any);

    const loggedInPrefs = await preferences.load();
    expect(loggedInPrefs.commandLauncherHotkey).toBe('Command+Shift+L');
    expect(loggedInPrefs.showInDock).toBe(true);

    const sharedPrefs = JSON.parse(await fs.readFile(sharedPrefsPath, 'utf-8')) as Record<string, unknown>;
    expect(sharedPrefs.clipboardHistoryHotkey).toBe('Command+Option+Space');
    expect(sharedPrefs.commandLauncherHotkey).toBe('Command+Shift+L');
    expect(sharedPrefs.transcriptionHotkey).toBe('Control+Space');
    expect(sharedPrefs.showInDock).toBeUndefined();

    loggedIn = false;
    await preferences.resetForSignedOutState();

    const signedOutPrefs = preferences.get();
    expect(signedOutPrefs.clipboardHistoryHotkey).toBe('Command+Option+Space');
    expect(signedOutPrefs.commandLauncherHotkey).toBe('Command+Shift+L');
    expect(signedOutPrefs.transcriptionHotkey).toBe('Control+Space');
    expect(signedOutPrefs.showInDock).toBe(false);

    const reloadedSignedOutPrefs = await preferences.load();
    expect(reloadedSignedOutPrefs.commandLauncherHotkey).toBe('Command+Shift+L');
    expect(reloadedSignedOutPrefs.showInDock).toBe(false);
  });

  it('mirrors null hotkey tombstones to shared prefs', async () => {
    const sharedPrefsPath = path.join(tempDir, 'preferences.json');
    const userPrefsPath = path.join(tempDir, 'users', 'user-123', 'preferences.json');
    await fs.mkdir(path.dirname(userPrefsPath), { recursive: true });
    await fs.writeFile(
      sharedPrefsPath,
      JSON.stringify(
        {
          hotMicHotkey: 'F13',
          transcriptionSecondaryHotkey: 'F14',
        },
        null,
        2,
      ),
      'utf-8',
    );
    await fs.writeFile(
      userPrefsPath,
      JSON.stringify(
        {
          hotMicHotkey: null,
          transcriptionSecondaryHotkey: null,
        },
        null,
        2,
      ),
      'utf-8',
    );

    const userDataManager = {
      isLoggedIn: () => true,
      getUserDataPath: (subpath?: string) => {
        const userDir = path.join(tempDir, 'users', 'user-123');
        return subpath ? path.join(userDir, subpath) : userDir;
      },
    };

    const preferences = new PreferencesManager();
    preferences.setUserDataManager(userDataManager as any);

    const loaded = await preferences.load();
    expect(loaded.hotMicHotkey).toBeNull();
    expect(loaded.transcriptionSecondaryHotkey).toBeNull();

    const sharedPrefs = JSON.parse(await fs.readFile(sharedPrefsPath, 'utf-8')) as Record<string, unknown>;
    expect(sharedPrefs.hotMicHotkey).toBeNull();
    expect(sharedPrefs.transcriptionSecondaryHotkey).toBeNull();
  });
});
