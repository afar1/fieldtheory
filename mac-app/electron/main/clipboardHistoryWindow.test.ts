import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserWindow } from 'electron';

const mockApp = vi.hoisted(() => ({
  hide: vi.fn(),
  show: vi.fn(),
  focus: vi.fn(),
  getName: vi.fn(() => 'Field Theory'),
  getAppPath: vi.fn(() => '/tmp'),
  dock: { hide: vi.fn() },
}));

vi.mock('electron', () => ({
  app: mockApp,
  BrowserWindow: Object.assign(vi.fn(), {
    getFocusedWindow: vi.fn(() => null),
  }),
  screen: {
    getAllDisplays: vi.fn(() => [{ bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1080 } }]),
    getPrimaryDisplay: vi.fn(() => ({ bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1080 } })),
    getCursorScreenPoint: vi.fn(() => ({ x: 0, y: 0 })),
    getDisplayNearestPoint: vi.fn(() => ({ bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1080 } })),
  },
  Menu: {
    buildFromTemplate: vi.fn(() => ({ popup: vi.fn() })),
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

vi.mock('./soundManager', () => ({
  SoundManager: class MockSoundManager {
    isEnabled(): boolean { return false; }
    play(): void {}
  },
}));

vi.mock('./clipboardManager', () => ({
  isFinder: vi.fn(() => false),
}));

import { buildClipboardContextMenuTemplate, ClipboardHistoryWindow } from './clipboardHistoryWindow';

function attachExistingWindow(window: ClipboardHistoryWindow, send: ReturnType<typeof vi.fn>) {
  (window as any).window = {
    isDestroyed: vi.fn(() => false),
    isVisible: vi.fn(() => true),
    setFocusable: vi.fn(),
    setAlwaysOnTop: vi.fn(),
    setVisibleOnAllWorkspaces: vi.fn(),
    show: vi.fn(),
    moveTop: vi.fn(),
    focus: vi.fn(),
    webContents: {
      send,
    },
  };

  vi.spyOn(window as any, 'sendTargetAppInfo').mockImplementation(() => {});
  vi.spyOn(window as any, 'refreshAppDataInBackground').mockResolvedValue(undefined);
  return (window as any).window;
}

function attachWindowWithBounds(window: ClipboardHistoryWindow, bounds: Electron.Rectangle) {
  const getBounds = vi.fn(() => bounds);
  const setBounds = vi.fn((nextBounds: Electron.Rectangle) => {
    bounds = nextBounds;
  });

  (window as any).window = {
    isDestroyed: vi.fn(() => false),
    isVisible: vi.fn(() => true),
    getBounds,
    setBounds,
    setFocusable: vi.fn(),
    setAlwaysOnTop: vi.fn(),
    setVisibleOnAllWorkspaces: vi.fn(),
    webContents: {
      send: vi.fn(),
    },
  };

  return { getBounds, setBounds, windowRef: (window as any).window };
}

describe('ClipboardHistoryWindow helper methods', () => {
  let window: ClipboardHistoryWindow;

  beforeEach(() => {
    vi.clearAllMocks();
    window = new ClipboardHistoryWindow({
      get: vi.fn(() => ({})),
      getPreference: vi.fn((key: string) => {
        if (key === 'clickAwayToDismiss') return true;
        return false;
      }),
    } as any);
  });

  it('uses cached native frontmost app on open when available', () => {
    const bounds = { x: 10, y: 20, width: 900, height: 600 };
    window.setNativeHelper({
      getFrontmostApp: vi.fn(() => ({
        bundleId: 'com.apple.Safari',
        name: 'Safari',
        windowBounds: null,
      })),
    } as any);

    vi.spyOn(window, 'show').mockImplementation(() => {});
    const captureSpy = vi.spyOn(window, 'capturePreviousAppBeforeShow');

    window.capturePreviousAppAndShow(bounds, false, true, true, false);

    expect(captureSpy).not.toHaveBeenCalled();
    expect(window.getPreviousApp()).toEqual({
      bundleId: 'com.apple.Safari',
      name: 'Safari',
    });
    expect(window.show).toHaveBeenCalledWith(bounds, false, true, true, false);
  });

  it('shows immediately while previous-app capture continues in background when cache is unavailable', async () => {
    const callOrder: string[] = [];
    const bounds = { x: 10, y: 20, width: 900, height: 600 };
    let resolveCapture!: () => void;

    vi.spyOn(window, 'capturePreviousAppBeforeShow').mockImplementation(async () => {
      callOrder.push('capture-start');
      await new Promise<void>((resolve) => {
        resolveCapture = () => {
          callOrder.push('capture-end');
          resolve();
        };
      });
    });
    vi.spyOn(window, 'show').mockImplementation(() => {
      callOrder.push('show');
    });

    window.capturePreviousAppAndShow(bounds, false, true, true, false);

    expect(callOrder).toEqual(['capture-start', 'show']);
    expect(window.show).toHaveBeenCalledWith(bounds, false, true, true, false);

    resolveCapture();
    await Promise.resolve();
  });

  it('uses one shared blur-dismiss rule for panel mode', () => {
    expect(window.shouldAutoHideOnBlur()).toBe(true);

    window.setRecordingActive(true);
    expect(window.shouldAutoHideOnBlur()).toBe(false);
    window.setRecordingActive(false);

    (window as any).preferencesManager.getPreference.mockImplementation((key: string) => {
      if (key === 'clickAwayToDismiss') return false;
      return false;
    });
    expect(window.shouldAutoHideOnBlur()).toBe(false);
    (window as any).preferencesManager.getPreference.mockImplementation((key: string) => {
      if (key === 'clickAwayToDismiss') return true;
      return false;
    });

    window.setImmersiveMode(true);
    expect(window.shouldAutoHideOnBlur()).toBe(false);
    window.setImmersiveDismissableOnBlur(true);
    expect(window.shouldAutoHideOnBlur()).toBe(true);
    window.setImmersiveDismissableOnBlur(false);
    window.setImmersiveMode(false);

    window.setScenarioTestingActive(true);
    expect(window.shouldAutoHideOnBlur()).toBe(false);
    window.setScenarioTestingActive(false);

    window.setSketchModeActive(true);
    expect(window.shouldAutoHideOnBlur()).toBe(false);
  });

  it('uses explicit Field Theory window mode before legacy show-in-dock settings', () => {
    (window as any).preferencesManager.get.mockReturnValue({
      fieldTheoryWindowMode: 'app',
      clickAwayToDismiss: true,
    });
    (window as any).preferencesManager.getPreference.mockImplementation((key: string) => {
      if (key === 'clickAwayToDismiss') return true;
      return false;
    });
    expect(window.shouldAutoHideOnBlur()).toBe(false);

    (window as any).preferencesManager.get.mockReturnValue({
      fieldTheoryWindowMode: 'panel',
      showInDock: true,
      clickAwayToDismiss: true,
    });
    (window as any).preferencesManager.getPreference.mockImplementation((key: string) => {
      if (key === 'showInDock') return true;
      if (key === 'clickAwayToDismiss') return true;
      return false;
    });
    expect(window.shouldAutoHideOnBlur()).toBe(true);
  });

  it('keeps legacy click-away-off users in app-window mode before migration is saved', () => {
    (window as any).preferencesManager.get.mockReturnValue({ clickAwayToDismiss: false });
    (window as any).preferencesManager.getPreference.mockImplementation((key: string) => {
      if (key === 'clickAwayToDismiss') return false;
      return false;
    });

    expect(window.shouldAutoHideOnBlur()).toBe(false);
  });

  it('expands vertically in immersive mode and restores the original bounds on exit', () => {
    const { windowRef } = attachWindowWithBounds(window, { x: 100, y: 100, width: 900, height: 600 });
    const animateBounds = vi.spyOn(window as any, 'animateBounds').mockImplementation(() => {});
    (window as any).currentSizeKey = 'library';
    (window as any).preferencesManager.get.mockReturnValue({
      clipboardHistoryBoundsByView: {
        library: { x: 100, y: 100, width: 900, height: 600 },
      },
    });

    window.setImmersiveMode(true);

    expect(animateBounds).toHaveBeenNthCalledWith(1, {
      x: 64,
      y: 0,
      width: 972,
      height: 918,
    });
    expect(windowRef.setAlwaysOnTop).toHaveBeenCalledWith(false);
    expect(windowRef.setVisibleOnAllWorkspaces).toHaveBeenCalledWith(false);

    window.setImmersiveMode(false);

    expect(animateBounds).toHaveBeenNthCalledWith(2, {
      x: 100,
      y: 100,
      width: 900,
      height: 600,
    });
    expect(windowRef.setAlwaysOnTop).toHaveBeenCalledWith(true, 'screen-saver', 1);
    expect(windowRef.setVisibleOnAllWorkspaces).toHaveBeenCalledWith(true, { visibleOnFullScreen: true });
  });

  it('uses the configured immersive height percentage when expanding the library view', () => {
    const { setBounds } = attachWindowWithBounds(window, { x: 100, y: 100, width: 900, height: 600 });
    const animateBounds = vi.spyOn(window as any, 'animateBounds').mockImplementation(() => {});

    window.setImmersiveHeightPercentGetter(() => 90);
    window.setImmersiveMode(true);

    expect(animateBounds).toHaveBeenCalledWith({
      x: 64,
      y: 0,
      width: 972,
      height: 972,
    });
  });

  it('persists the active size key when switching view sizes', () => {
    const save = vi.fn().mockResolvedValue(undefined);
    window = new ClipboardHistoryWindow({
      get: vi.fn(() => ({})),
      getPreference: vi.fn(() => false),
      save,
    } as any);
    const { setBounds } = attachWindowWithBounds(window, { x: 100, y: 100, width: 900, height: 600 });
    const animateBounds = vi.spyOn(window as any, 'animateBounds').mockImplementation(() => {});

    window.setSizeKey('library');

    expect(window.getCurrentSizeKey()).toBe('library');
    expect(save).toHaveBeenCalledWith({ clipboardHistoryLastSizeKey: 'library' });
    expect(animateBounds).not.toHaveBeenCalled();
    expect(setBounds).toHaveBeenCalledWith({
      x: 100,
      y: 100,
      width: 720,
      height: 820,
    });
  });

  it('uses draw mechanics for the canvas size key', () => {
    const save = vi.fn().mockResolvedValue(undefined);
    window = new ClipboardHistoryWindow({
      get: vi.fn(() => ({})),
      getPreference: vi.fn(() => false),
      save,
    } as any);
    const { setBounds } = attachWindowWithBounds(window, { x: 100, y: 100, width: 900, height: 600 });
    const animateBounds = vi.spyOn(window as any, 'animateBounds').mockImplementation(() => {});

    window.setSizeKey('canvas');

    expect(window.getCurrentSizeKey()).toBe('draw');
    expect(save).toHaveBeenCalledWith({ clipboardHistoryLastSizeKey: 'draw' });
    expect(animateBounds).not.toHaveBeenCalled();
    expect(setBounds).toHaveBeenCalledWith({
      x: 100,
      y: 100,
      width: 1180,
      height: 760,
    });
  });

  it('hides the window and restores the previous app when one is known', async () => {
    const callOrder: string[] = [];

    vi.spyOn(window, 'getPreviousApp').mockReturnValue({
      bundleId: 'com.apple.Safari',
      name: 'Safari',
    });
    vi.spyOn(window, 'hide').mockImplementation((_hideApp?: boolean, _reason?: string) => {
      callOrder.push('hide');
    });
    vi.spyOn(window, 'activateApp').mockImplementation(async () => {
      callOrder.push('activate');
      return true;
    });

    await window.hideAndRestorePreviousApp('hotkey-toggle-hide');

    expect(callOrder).toEqual(['hide', 'activate']);
    expect(window.hide).toHaveBeenCalledWith(false, 'hotkey-toggle-hide');
    expect(window.activateApp).toHaveBeenCalledWith('com.apple.Safari');
  });

  it('does not restore the previous app when hiding the app-mode window', async () => {
    (window as any).preferencesManager.get.mockReturnValue({ fieldTheoryWindowMode: 'app' });
    const activateApp = vi.spyOn(window, 'activateApp').mockResolvedValue(true);
    vi.spyOn(window, 'getPreviousApp').mockReturnValue({
      bundleId: 'com.apple.Safari',
      name: 'Safari',
    });
    vi.spyOn(window, 'hide').mockImplementation(() => {});

    await window.hideAndRestorePreviousApp('hotkey-toggle-hide');

    expect(window.hide).toHaveBeenCalledWith(false, 'hotkey-toggle-hide');
    expect(activateApp).not.toHaveBeenCalled();
  });

  it('skips activation when no previous app is known', async () => {
    vi.spyOn(window, 'getPreviousApp').mockReturnValue(null);
    vi.spyOn(window, 'hide').mockImplementation(() => {});
    vi.spyOn(window, 'activateApp').mockImplementation(async () => true);

    await window.hideAndRestorePreviousApp('ipc-close-window');

    expect(window.hide).toHaveBeenCalledWith(false, 'ipc-close-window');
    expect(window.activateApp).not.toHaveBeenCalled();
  });

  it('waits for an in-flight previous-app capture only after hiding on explicit close', async () => {
    const callOrder: string[] = [];
    let resolveCapture!: () => void;

    vi.spyOn(window, 'capturePreviousAppBeforeShow').mockImplementation(async () => {
      await new Promise<void>((resolve) => {
        resolveCapture = () => {
          (window as any).previousApp = { bundleId: 'com.apple.Safari', name: 'Safari' };
          resolve();
        };
      });
    });
    vi.spyOn(window, 'show').mockImplementation(() => {});
    vi.spyOn(window, 'hide').mockImplementation((_hideApp?: boolean, _reason?: string) => {
      callOrder.push('hide');
    });
    vi.spyOn(window, 'activateApp').mockImplementation(async () => {
      callOrder.push('activate');
      return true;
    });

    window.capturePreviousAppAndShow();
    const restorePromise = window.hideAndRestorePreviousApp('ipc-close-window');

    expect(callOrder).toEqual(['hide']);

    resolveCapture();
    await restorePromise;

    expect(callOrder).toEqual(['hide', 'activate']);
  });

  it('dismisses only the window on external blur once focus has left Field Theory', async () => {
    vi.spyOn(window, 'isVisible').mockReturnValue(true);
    vi.spyOn(window, 'hide').mockImplementation(() => {});
    vi.mocked(BrowserWindow.getFocusedWindow).mockReturnValue(null as any);

    await window.dismissForExternalBlur('window-blur-handler', 0);

    expect(window.hide).toHaveBeenCalledWith(false, 'window-blur-handler');
  });

  it('skips blur dismissal when another Field Theory window has focus', async () => {
    vi.spyOn(window, 'isVisible').mockReturnValue(true);
    vi.spyOn(window, 'hide').mockImplementation(() => {});
    vi.mocked(BrowserWindow.getFocusedWindow).mockReturnValue({} as any);

    await window.dismissForExternalBlur('window-blur-handler', 0);

    expect(window.hide).not.toHaveBeenCalled();
  });

  it('sends showHistory before showSettings when reusing an existing window', () => {
    const send = vi.fn();
    attachExistingWindow(window, send);

    window.show(undefined, true, true);

    expect(send.mock.calls.map(([channel]) => channel)).toEqual([
      'clipboard:showHistory',
      'clipboard:showSettings',
    ]);
  });

  it('activates panel mode with app.focus instead of app.show', () => {
    attachExistingWindow(window, vi.fn());

    window.show(undefined, false, true);

    expect(mockApp.focus).toHaveBeenCalledWith({ steal: true });
    expect(mockApp.show).not.toHaveBeenCalled();
  });

  it('focuses a visible app-mode window without resetting renderer state', () => {
    (window as any).preferencesManager.get.mockReturnValue({ fieldTheoryWindowMode: 'app' });
    const send = vi.fn();
    const windowRef = attachExistingWindow(window, send);

    expect(window.focusExistingWindow()).toBe(true);

    expect(windowRef.show).toHaveBeenCalled();
    expect(windowRef.moveTop).toHaveBeenCalled();
    expect(windowRef.focus).toHaveBeenCalled();
    expect(mockApp.show).toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('sends showHistory before showTranscriptHistory when reusing an existing window', () => {
    const send = vi.fn();
    attachExistingWindow(window, send);

    window.show(undefined, false, true, true);

    expect(send.mock.calls.map(([channel]) => channel)).toEqual([
      'clipboard:showHistory',
      'clipboard:showTranscriptHistory',
    ]);
  });

  it('dedupes blur dismissal when both blur handlers fire', async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(window, 'isVisible').mockReturnValue(true);
      const hideSpy = vi.spyOn(window, 'hide').mockImplementation(() => {});
      vi.mocked(BrowserWindow.getFocusedWindow).mockReturnValue(null as any);

      const first = window.dismissForExternalBlur('window-blur-handler', 10);
      const second = window.dismissForExternalBlur('app-browser-window-blur', 10);

      expect(hideSpy).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(10);
      await Promise.all([first, second]);

      expect(hideSpy).toHaveBeenCalledTimes(1);
      expect(hideSpy).toHaveBeenCalledWith(false, 'window-blur-handler');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('buildClipboardContextMenuTemplate', () => {
  const editFlags = {
    canUndo: false,
    canRedo: false,
    canCut: true,
    canCopy: true,
    canPaste: true,
    canDelete: false,
    canSelectAll: true,
    canEditRichly: false,
  };

  it('adds spelling suggestions and add-to-dictionary for editable misspellings', () => {
    const replaceMisspelling = vi.fn();
    const addWordToDictionary = vi.fn();
    const menu = buildClipboardContextMenuTemplate({
      selectionText: '',
      isEditable: true,
      editFlags,
      misspelledWord: 'somehting',
      dictionarySuggestions: ['something', 'smoothing'],
    }, {
      lookUpSelection: vi.fn(),
      replaceMisspelling,
      addWordToDictionary,
    });

    expect(menu.map((item) => item.label ?? item.type)).toEqual([
      'something',
      'smoothing',
      'separator',
      'Add "somehting" to Dictionary',
      'separator',
      'Cut',
      'Copy',
      'Paste',
      'separator',
      'Select All',
    ]);

    (menu[0].click as () => void)();
    (menu[3].click as () => void)();

    expect(replaceMisspelling).toHaveBeenCalledWith('something');
    expect(addWordToDictionary).toHaveBeenCalledWith('somehting');
  });

  it('keeps add-to-dictionary available when there are no suggestions', () => {
    const addWordToDictionary = vi.fn();
    const menu = buildClipboardContextMenuTemplate({
      selectionText: '',
      isEditable: true,
      editFlags,
      misspelledWord: 'fieldtheory',
      dictionarySuggestions: [],
    }, {
      lookUpSelection: vi.fn(),
      replaceMisspelling: vi.fn(),
      addWordToDictionary,
    });

    expect(menu[0].label).toBe('Add "fieldtheory" to Dictionary');
    (menu[0].click as () => void)();
    expect(addWordToDictionary).toHaveBeenCalledWith('fieldtheory');
  });
});
