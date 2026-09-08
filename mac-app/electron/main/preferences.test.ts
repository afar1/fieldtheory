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

import {
  DEFAULT_LAUNCHER_ROOT_SEARCH_ENABLED_KINDS,
  DEFAULT_MEETING_SUMMARY_PROMPT,
  PreferencesManager,
  normalizeClipboardHistorySizeKey,
  normalizeLauncherRootSearchEnabledKinds,
  pickSavedBoundsByKey,
  resolveFieldTheoryWindowMode,
  type ClipboardHistoryBounds,
} from './preferences';

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

describe('normalizeLauncherRootSearchEnabledKinds', () => {
  it('keeps launcher root search settings explicit and defaulted', () => {
    expect(normalizeLauncherRootSearchEnabledKinds(undefined)).toEqual(DEFAULT_LAUNCHER_ROOT_SEARCH_ENABLED_KINDS);
    expect(normalizeLauncherRootSearchEnabledKinds({ file: false, contact: true })).toEqual({
      ...DEFAULT_LAUNCHER_ROOT_SEARCH_ENABLED_KINDS,
      file: false,
      contact: true,
    });
  });
});

describe('PreferencesManager', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fieldtheory-preferences-'));
    mockElectronState.userDataPath = tempDir;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  function accountPreferences(initialOwner = 'user-a') {
    let owner: string | null = initialOwner;
    const userPath = (id: string) => path.join(tempDir, 'users', id, 'preferences.json');
    const manager = new PreferencesManager();
    manager.setUserDataManager({
      isLoggedIn: () => owner !== null,
      getCurrentCallsign: () => owner,
      getUserDataPath: (subpath?: string) => path.join(tempDir, 'users', owner!, subpath ?? ''),
    } as any);
    return { manager, userPath, setOwner: (next: string | null) => { owner = next; } };
  }

  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
  }

  async function writeUserPreferences(filePath: string, value: Record<string, unknown>) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(value), 'utf-8');
  }

  it('initializes missing launcher sections for the current account without enabling other sections', async () => {
    const { manager, userPath } = accountPreferences();
    await manager.load();
    const sections = ['folder:Inbox', 'recents', 'clipboard', 'river'];
    expect(await manager.updateLauncherSectionsForUser('user-a', (current) => current ?? sections)).toBe(true);
    expect(JSON.parse(await fs.readFile(userPath('user-a'), 'utf-8'))).toEqual({ launcherSections: sections });
    expect(manager.getPreference('launcherSections')).toEqual(sections);
  });

  it.each([
    ['folder:Inbox', 'recents', 'clipboard', 'river'],
    [],
  ])('preserves explicitly configured launcher sections %j during initialization', async (...configured) => {
    const { manager, userPath } = accountPreferences();
    const saved = { launcherSections: configured, liveTypingEnabled: true };
    await writeUserPreferences(userPath('user-a'), saved);
    await manager.load();
    const before = await fs.readFile(userPath('user-a'), 'utf-8');
    const transform = vi.fn((current: readonly string[] | undefined) => current ?? ['folder:Inbox', 'recents']);
    expect(await manager.updateLauncherSectionsForUser('user-a', transform)).toBe(false);
    expect(transform).toHaveBeenCalledWith(configured);
    expect(await fs.readFile(userPath('user-a'), 'utf-8')).toBe(before);
  });

  it('renames a section against the latest file while preserving order and every unrelated saved value', async () => {
    const { manager, userPath } = accountPreferences();
    await writeUserPreferences(userPath('user-a'), { launcherSections: ['recents'] });
    await manager.load();
    const latest = {
      launcherSections: ['clipboard', 'folder:Inbox', 'river', 'recents'],
      liveTypingEnabled: true,
      unknownFuturePreference: { nested: ['keep', 42] },
    };
    await writeUserPreferences(userPath('user-a'), latest);
    expect(await manager.updateLauncherSectionsForUser('user-a', (sections) => sections?.map((section) =>
      section === 'folder:Inbox' ? 'folder:Renamed Inbox' : section))).toBe(true);
    const expectedSections = ['clipboard', 'folder:Renamed Inbox', 'river', 'recents'];
    expect(JSON.parse(await fs.readFile(userPath('user-a'), 'utf-8'))).toEqual({ ...latest, launcherSections: expectedSections });
    expect(manager.getPreference('launcherSections')).toEqual(expectedSections);
  });

  it('lets a rename leave missing sections unchanged without creating preferences', async () => {
    const { manager, userPath } = accountPreferences();
    expect(await manager.updateLauncherSectionsForUser('user-a', (sections) => sections?.map((section) => section))).toBe(false);
    await expect(fs.readFile(userPath('user-a'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('shares the ordinary save queue so a later save retains the launcher update', async () => {
    const { manager, userPath } = accountPreferences();
    await writeUserPreferences(userPath('user-a'), { launcherSections: ['recents'], liveTypingEnabled: false });
    await manager.load();
    const writing = deferred<void>();
    const release = deferred<void>();
    const originalWrite = fs.writeFile.bind(fs);
    vi.spyOn(fs, 'writeFile').mockImplementation(async (...args) => {
      await originalWrite(...args);
      if (String(args[0]).endsWith('.tmp')) { writing.resolve(); await release.promise; }
    });
    const update = manager.updateLauncherSectionsForUser('user-a', () => ['folder:Inbox', 'recents']);
    await writing.promise;
    const save = manager.save({ liveTypingEnabled: true });
    release.resolve();
    expect(await update).toBe(true);
    await save;
    const saved = JSON.parse(await fs.readFile(userPath('user-a'), 'utf-8'));
    expect(saved.launcherSections).toEqual(['folder:Inbox', 'recents']);
    expect(saved.liveTypingEnabled).toBe(true);
  });

  it('drops old-account updates both before commit and while waiting in the save queue', async () => {
    const { manager, userPath, setOwner } = accountPreferences();
    const first = { launcherSections: ['recents'] };
    const second = { launcherSections: ['river'] };
    await writeUserPreferences(userPath('user-a'), first);
    await writeUserPreferences(userPath('user-b'), second);
    await manager.load();
    const writing = deferred<void>();
    const release = deferred<void>();
    const originalWrite = fs.writeFile.bind(fs);
    vi.spyOn(fs, 'writeFile').mockImplementation(async (...args) => {
      await originalWrite(...args);
      if (String(args[0]).endsWith('.tmp')) { writing.resolve(); await release.promise; }
    });
    const active = manager.updateLauncherSectionsForUser('user-a', () => ['folder:Inbox']);
    await writing.promise;
    const queuedTransform = vi.fn(() => ['clipboard']);
    const queued = manager.updateLauncherSectionsForUser('user-a', queuedTransform);
    setOwner('user-b');
    await manager.load();
    release.resolve();
    expect(await active).toBe(false);
    expect(await queued).toBe(false);
    expect(queuedTransform).not.toHaveBeenCalled();
    expect(JSON.parse(await fs.readFile(userPath('user-a'), 'utf-8'))).toEqual(first);
    expect(JSON.parse(await fs.readFile(userPath('user-b'), 'utf-8'))).toEqual(second);
    expect(manager.getPreference('launcherSections')).toEqual(second.launcherSections);
    expect(await fs.readdir(path.dirname(userPath('user-a')))).toEqual(['preferences.json']);
  });

  it('drops an old-account update after a delayed read without changing the new account in memory', async () => {
    const { manager, userPath, setOwner } = accountPreferences();
    const first = { launcherSections: ['recents'] };
    const second = { launcherSections: ['clipboard'] };
    await writeUserPreferences(userPath('user-a'), first);
    await writeUserPreferences(userPath('user-b'), second);
    await manager.load();
    const reading = deferred<void>();
    const release = deferred<void>();
    const originalRead = fs.readFile.bind(fs);
    vi.spyOn(fs, 'readFile').mockImplementation(async (...args) => {
      const value = await originalRead(...args);
      if (String(args[0]) === userPath('user-a')) { reading.resolve(); await release.promise; }
      return value;
    });
    const transform = vi.fn(() => ['folder:Inbox']);
    const update = manager.updateLauncherSectionsForUser('user-a', transform);
    await reading.promise;
    setOwner('user-b');
    await manager.load();
    release.resolve();
    expect(await update).toBe(false);
    expect(transform).not.toHaveBeenCalled();
    expect(manager.getPreference('launcherSections')).toEqual(second.launcherSections);
    expect(JSON.parse(await fs.readFile(userPath('user-a'), 'utf-8'))).toEqual(first);
    expect(JSON.parse(await fs.readFile(userPath('user-b'), 'utf-8'))).toEqual(second);
  });

  it('rejects stale or signed-out owners before calling the transform', async () => {
    const { manager, setOwner } = accountPreferences();
    const transform = vi.fn(() => ['folder:Inbox']);
    expect(await manager.updateLauncherSectionsForUser('user-b', transform)).toBe(false);
    setOwner(null);
    expect(await manager.updateLauncherSectionsForUser('user-a', transform)).toBe(false);
    expect(transform).not.toHaveBeenCalled();
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
    expect(saved.fieldTheoryWindowMode).toBe('app');
  });

  it('defaults the local command model to Gemma 4 12B', async () => {
    const manager = new PreferencesManager();
    await manager.load();

    expect(manager.getPreference('localLlmSelectedModel')).toBe('gemma-4-12B-it-Q4_K_M');
  });

  it('defaults live typing off and persists opt-in changes', async () => {
    const manager = new PreferencesManager();
    await manager.load();

    expect(manager.getPreference('liveTypingEnabled')).toBe(false);

    await manager.save({ liveTypingEnabled: true });
    expect(manager.getPreference('liveTypingEnabled')).toBe(true);
  });

  it('migrates legacy normal-window prefs into Field Theory app mode', async () => {
    const prefsPath = path.join(tempDir, 'preferences.json');
    await fs.writeFile(
      prefsPath,
      JSON.stringify(
        {
          clickAwayToDismiss: false,
        },
        null,
        2,
      ),
      'utf-8',
    );

    const preferences = new PreferencesManager();
    const loaded = await preferences.load();

    expect(loaded.fieldTheoryWindowMode).toBe('app');
    expect(loaded.showInDock).toBe(true);
    expect(loaded.clickAwayToDismiss).toBe(false);
    expect(loaded.recordingIndicatorMode).toBe('floating');
  });

  it('migrates legacy click-away prefs into Field Theory app mode on load', async () => {
    const prefsPath = path.join(tempDir, 'preferences.json');
    await fs.writeFile(
      prefsPath,
      JSON.stringify(
        {
          clickAwayToDismiss: true,
        },
        null,
        2,
      ),
      'utf-8',
    );

    const preferences = new PreferencesManager();
    const loaded = await preferences.load();

    expect(loaded.fieldTheoryWindowMode).toBe('app');
    expect(loaded.showInDock).toBe(true);
    expect(loaded.clickAwayToDismiss).toBe(false);
  });

  it('does not let a click-away-only save override explicit Field Theory app mode', async () => {
    const prefsPath = path.join(tempDir, 'preferences.json');
    await fs.writeFile(
      prefsPath,
      JSON.stringify(
        {
          fieldTheoryWindowMode: 'app',
        },
        null,
        2,
      ),
      'utf-8',
    );

    const preferences = new PreferencesManager();
    await preferences.load();
    await preferences.save({ clickAwayToDismiss: true });

    const saved = JSON.parse(await fs.readFile(prefsPath, 'utf-8')) as Record<string, unknown>;
    expect(saved.fieldTheoryWindowMode).toBe('app');
    expect(saved.showInDock).toBe(true);
    expect(saved.clickAwayToDismiss).toBe(true);
  });

  it('uses app mode as the default Field Theory window mode', async () => {
    const preferences = new PreferencesManager();
    const loaded = await preferences.load();

    expect(loaded.fieldTheoryWindowMode).toBe('app');
    expect(loaded.showInDock).toBe(true);
    expect(loaded.clickAwayToDismiss).toBe(false);
  });

  it('loads the default meeting summary prompt', async () => {
    const preferences = new PreferencesManager();
    const loaded = await preferences.load();

    expect(loaded.meetingSummaryPrompt).toBe(DEFAULT_MEETING_SUMMARY_PROMPT);
    expect(loaded.meetingSummaryPrompt).toContain('stable speaker IDs if present');
    expect(loaded.meetingSummaryPrompt).toContain('Do not renumber speakers');
    expect(loaded.meetingSummaryPrompt).toContain('links, figures, and checkboxes');
  });

  it('resolves missing window-mode preferences to app mode even with legacy panel settings', () => {
    expect(resolveFieldTheoryWindowMode({})).toBe('app');
    expect(resolveFieldTheoryWindowMode({ showInDock: false })).toBe('app');
    expect(resolveFieldTheoryWindowMode({ clickAwayToDismiss: true })).toBe('app');
    expect(resolveFieldTheoryWindowMode({ fieldTheoryWindowMode: 'panel', showInDock: true })).toBe('panel');
  });

  it('mirrors shared device prefs and preserves them when signed out', async () => {
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
    expect(sharedPrefs.fieldTheoryWindowMode).toBe('app');
    expect(sharedPrefs.showInDock).toBe(true);
    expect(sharedPrefs.clickAwayToDismiss).toBe(false);

    loggedIn = false;
    await preferences.resetForSignedOutState();

    const signedOutPrefs = preferences.get();
    expect(signedOutPrefs.clipboardHistoryHotkey).toBe('Command+Option+Space');
    expect(signedOutPrefs.commandLauncherHotkey).toBe('Command+Shift+L');
    expect(signedOutPrefs.transcriptionHotkey).toBe('Control+Space');
    expect(signedOutPrefs.showInDock).toBe(true);

    const reloadedSignedOutPrefs = await preferences.load();
    expect(reloadedSignedOutPrefs.commandLauncherHotkey).toBe('Command+Shift+L');
    expect(reloadedSignedOutPrefs.showInDock).toBe(true);
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
