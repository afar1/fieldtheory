import { describe, expect, it, vi, beforeEach } from 'vitest';

// Hoist mock state so it's available before module imports
const mockWindow = vi.hoisted(() => ({
  isDestroyed: vi.fn(() => false),
  isVisible: vi.fn(() => true),
  hide: vi.fn(),
  show: vi.fn(),
  showInactive: vi.fn(),
  focus: vi.fn(),
  moveTop: vi.fn(),
  setBounds: vi.fn(),
  getBounds: vi.fn(() => ({ x: 0, y: 0, width: 425, height: 36 })),
  setAlwaysOnTop: vi.fn(),
  setVisibleOnAllWorkspaces: vi.fn(),
  loadURL: vi.fn(),
  loadFile: vi.fn(),
  destroy: vi.fn(),
  on: vi.fn(),
  webContents: { send: vi.fn(), on: vi.fn(), openDevTools: vi.fn() },
}));

const mockIpcMainHandlers = vi.hoisted(() => new Map<string, (...args: any[]) => void>());
const LAUNCHER_WIDTH = 366;
const LAUNCHER_COLLAPSED_HEIGHT = 43;

const mockApp = vi.hoisted(() => ({
  hide: vi.fn(),
  getName: vi.fn(() => 'Field Theory'),
  getAppPath: vi.fn(() => '/tmp'),
  dock: { hide: vi.fn() },
}));

vi.mock('electron', () => ({
  app: mockApp,
  BrowserWindow: vi.fn(function () {
    return mockWindow;
  }),
  screen: {
    getCursorScreenPoint: vi.fn(() => ({ x: 0, y: 0 })),
    getDisplayNearestPoint: vi.fn(() => ({ bounds: { x: 0, y: 0, width: 1920, height: 1080 } })),
  },
  ipcMain: {
    on: vi.fn((channel: string, handler: (...args: any[]) => void) => {
      mockIpcMainHandlers.set(channel, handler);
    }),
    handle: vi.fn(),
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

const mockExecFile = vi.hoisted(() => vi.fn((_cmd: string, _args: string[], cb: Function) => cb(null, '', '')));

vi.mock('child_process', () => ({
  default: { execFile: mockExecFile },
  execFile: mockExecFile,
}));

import { CommandLauncherWindow } from './commandLauncherWindow';
import { BrowserWindow } from 'electron';

describe('CommandLauncherWindow.show()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIpcMainHandlers.clear();
    mockWindow.isVisible.mockReturnValue(false);
    mockWindow.isDestroyed.mockReturnValue(false);
  });

  it('centers over explicit anchor bounds when provided', async () => {
    const nativeHelper = {
      getFrontmostApp: vi.fn(() => ({ bundleId: 'com.fieldtheory.app', name: 'Field Theory' })),
      getFrontmostWindowBounds: vi.fn(() => ({ x: 0, y: 0, width: 1920, height: 1080 })),
    };
    const launcher = new CommandLauncherWindow(nativeHelper as any);
    (launcher as any).window = mockWindow;

    await launcher.show({
      anchorBounds: { x: 100, y: 200, width: 900, height: 700 },
    });

    expect(nativeHelper.getFrontmostWindowBounds).not.toHaveBeenCalled();
    expect(mockWindow.setBounds).toHaveBeenCalledWith({
      x: Math.round(100 + (900 - LAUNCHER_WIDTH) / 2),
      y: 323,
      width: LAUNCHER_WIDTH,
      height: LAUNCHER_COLLAPSED_HEIGHT,
    });
  });

  it('uses cached frontmost window bounds without waiting for fresh bounds', async () => {
    const nativeHelper = {
      getFrontmostApp: vi.fn(() => ({
        bundleId: 'com.apple.Safari',
        name: 'Safari',
        windowBounds: { x: 50, y: 100, width: 1000, height: 800 },
      })),
      getFrontmostWindowBounds: vi.fn(() => {
        throw new Error('should not fetch fresh bounds before showing');
      }),
    };
    const launcher = new CommandLauncherWindow(nativeHelper as any);
    (launcher as any).window = mockWindow;

    await launcher.show();

    expect(nativeHelper.getFrontmostWindowBounds).not.toHaveBeenCalled();
    expect(mockWindow.setBounds).toHaveBeenCalledWith({
      x: Math.round(50 + (1000 - LAUNCHER_WIDTH) / 2),
      y: 273,
      width: LAUNCHER_WIDTH,
      height: LAUNCHER_COLLAPSED_HEIGHT,
    });
  });

  it('resets renderer state before showing and focusing the window', async () => {
    const nativeHelper = {
      getFrontmostApp: vi.fn(() => ({ bundleId: 'com.apple.Safari', name: 'Safari' })),
      getFrontmostWindowBounds: vi.fn(),
    };
    const launcher = new CommandLauncherWindow(nativeHelper as any);
    (launcher as any).window = mockWindow;

    await launcher.show();

    expect(mockWindow.webContents.send).toHaveBeenCalledWith('command-launcher:reset');
    expect(mockWindow.webContents.send.mock.invocationCallOrder[0]).toBeLessThan(mockWindow.show.mock.invocationCallOrder[0]);
    expect(mockWindow.show.mock.invocationCallOrder[0]).toBeLessThan(mockWindow.focus.mock.invocationCallOrder[0]);
  });

  it('does not replace an external previous app with Field Theory', async () => {
    const nativeHelper = {
      getFrontmostApp: vi.fn(() => ({ bundleId: 'com.fieldtheory.app', name: 'Field Theory' })),
      getFrontmostWindowBounds: vi.fn(() => ({ x: 0, y: 0, width: 1920, height: 1080 })),
    };
    const launcher = new CommandLauncherWindow(nativeHelper as any);
    (launcher as any).window = mockWindow;
    (launcher as any).previousApp = { bundleId: 'com.apple.Safari', name: 'Safari' };

    await launcher.show({
      anchorBounds: { x: 100, y: 200, width: 900, height: 700 },
    });

    expect(launcher.getPreviousApp()).toEqual({ bundleId: 'com.apple.Safari', name: 'Safari' });
    expect(launcher.wasFieldTheoryActiveOnShow()).toBe(true);
  });

  it('marks Field Theory inactive when shown over an external app', async () => {
    const nativeHelper = {
      getFrontmostApp: vi.fn(() => ({ bundleId: 'com.apple.Safari', name: 'Safari' })),
      getFrontmostWindowBounds: vi.fn(() => ({ x: 0, y: 0, width: 1920, height: 1080 })),
    };
    const launcher = new CommandLauncherWindow(nativeHelper as any);
    (launcher as any).window = mockWindow;

    await launcher.show({
      anchorBounds: { x: 100, y: 200, width: 900, height: 700 },
    });

    expect(launcher.getPreviousApp()).toEqual({ bundleId: 'com.apple.Safari', name: 'Safari' });
    expect(launcher.wasFieldTheoryActiveOnShow()).toBe(false);
  });
});

describe('CommandLauncherWindow.preload()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIpcMainHandlers.clear();
    mockWindow.isVisible.mockReturnValue(false);
    mockWindow.isDestroyed.mockReturnValue(false);
  });

  it('creates and loads the hidden launcher window before first show', () => {
    const launcher = new CommandLauncherWindow();

    launcher.preload();

    expect(BrowserWindow).toHaveBeenCalled();
    expect(mockWindow.loadFile).toHaveBeenCalled();
    expect(mockWindow.show).not.toHaveBeenCalled();
  });

  it('passes the current app theme to the launcher before renderer startup', () => {
    const launcher = new CommandLauncherWindow(undefined, {
      getInitialDarkMode: () => true,
    });

    launcher.preload();

    expect(BrowserWindow).toHaveBeenCalledWith(expect.objectContaining({
      webPreferences: expect.objectContaining({
        additionalArguments: ['--field-theory-dark-mode=true'],
      }),
    }));
  });
});

describe('CommandLauncherWindow.hide()', () => {
  let launcher: CommandLauncherWindow;

  beforeEach(() => {
    vi.clearAllMocks();
    mockIpcMainHandlers.clear();
    launcher = new CommandLauncherWindow();
    // Force-create the window via show() internals
    (launcher as any).window = mockWindow;
    (launcher as any).previousApp = { bundleId: 'com.apple.Safari', name: 'Safari' };
    mockWindow.isVisible.mockReturnValue(true);
    mockWindow.isDestroyed.mockReturnValue(false);
  });

  it('hides the window and activates previous app by default', () => {
    const activatePreviousApp = vi.spyOn(launcher as any, 'activatePreviousApp').mockResolvedValue(undefined);

    launcher.hide();

    expect(mockWindow.hide).toHaveBeenCalled();
    expect(activatePreviousApp).toHaveBeenCalledWith('com.apple.Safari');
    expect(mockApp.hide).not.toHaveBeenCalled();
  });

  it('hides the window without activating when skipActivation is true', () => {
    const activatePreviousApp = vi.spyOn(launcher as any, 'activatePreviousApp').mockResolvedValue(undefined);

    launcher.hide(true);

    expect(mockWindow.hide).toHaveBeenCalled();
    expect(activatePreviousApp).not.toHaveBeenCalled();
    expect(mockApp.hide).not.toHaveBeenCalled();
  });

  it('does not activate stale previous app when Field Theory was active on show', () => {
    const activatePreviousApp = vi.spyOn(launcher as any, 'activatePreviousApp').mockResolvedValue(undefined);
    (launcher as any).fieldTheoryActiveOnShow = true;

    launcher.hide();

    expect(mockWindow.hide).toHaveBeenCalled();
    expect(activatePreviousApp).not.toHaveBeenCalled();
    expect(mockApp.hide).not.toHaveBeenCalled();
  });

  it('does not hide on blur when Field Theory was active on show', () => {
    launcher.preload();
    (launcher as any).fieldTheoryActiveOnShow = true;
    const hide = vi.spyOn(launcher, 'hide');
    const blurHandler = mockWindow.on.mock.calls.find(([event]) => event === 'blur')?.[1];

    blurHandler?.();

    expect(hide).not.toHaveBeenCalled();
  });

  it('skips everything when window is already hidden (visibility guard)', () => {
    mockWindow.isVisible.mockReturnValue(false);

    launcher.hide();

    expect(mockWindow.hide).not.toHaveBeenCalled();
    expect(mockApp.hide).not.toHaveBeenCalled();
  });

  it('prevents blur re-entry after hide(true) was called', () => {
    // Simulate: invoke handler calls hide(true), then blur fires hide()
    launcher.hide(true);
    expect(mockWindow.hide).toHaveBeenCalledTimes(1);

    // After hide(true), window.isVisible() returns false
    mockWindow.isVisible.mockReturnValue(false);

    // Blur handler calls hide() (no skipActivation)
    launcher.hide();

    // Should be a no-op — window was already hidden
    expect(mockWindow.hide).toHaveBeenCalledTimes(1);
    expect(mockApp.hide).not.toHaveBeenCalled();
  });

  it('falls back to app.hide() when no previous app is known', () => {
    (launcher as any).previousApp = null;

    launcher.hide();

    expect(mockWindow.hide).toHaveBeenCalled();
    expect(mockApp.hide).toHaveBeenCalled();
  });

  it('handles destroyed window gracefully', () => {
    mockWindow.isDestroyed.mockReturnValue(true);

    // Should not throw
    launcher.hide();

    expect(mockWindow.hide).not.toHaveBeenCalled();
  });
});

describe('CommandLauncherWindow resize IPC', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIpcMainHandlers.clear();
    mockWindow.isVisible.mockReturnValue(true);
    mockWindow.isDestroyed.mockReturnValue(false);
    mockWindow.getBounds.mockReturnValue({ x: 10, y: 20, width: LAUNCHER_WIDTH, height: LAUNCHER_COLLAPSED_HEIGHT });
  });

  it('keeps renderer resize requests inside the normal launcher height', () => {
    const launcher = new CommandLauncherWindow();
    (launcher as any).window = mockWindow;

    mockIpcMainHandlers.get('command-launcher:resize')?.({}, 526);

    expect(mockWindow.setBounds).toHaveBeenCalledWith({
      x: 10,
      y: 20,
      width: LAUNCHER_WIDTH,
      height: 354,
    });
  });

  it('clamps oversized renderer resize requests', () => {
    const launcher = new CommandLauncherWindow();
    (launcher as any).window = mockWindow;

    mockIpcMainHandlers.get('command-launcher:resize')?.({}, 900);

    expect(mockWindow.setBounds).toHaveBeenCalledWith({
      x: 10,
      y: 20,
      width: LAUNCHER_WIDTH,
      height: 354,
    });
  });
});

describe('CommandLauncherWindow preview IPC', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIpcMainHandlers.clear();
    mockWindow.isVisible.mockReturnValue(false);
    mockWindow.isDestroyed.mockReturnValue(false);
  });

  it('shows the detached preview centered on the active display', () => {
    new CommandLauncherWindow();
    const preview = { kind: 'bookmark', bookmark: { id: 'bookmark-1', text: 'hello' } };

    mockIpcMainHandlers.get('command-launcher:preview-show')?.({}, preview);

    expect(BrowserWindow).toHaveBeenCalledWith(expect.objectContaining({
      hasShadow: false,
    }));
    expect(mockWindow.setBounds).toHaveBeenCalledWith({
      x: 700,
      y: 260,
      width: 520,
      height: 560,
    });
    expect(mockWindow.showInactive).toHaveBeenCalled();
    expect(mockWindow.webContents.send).toHaveBeenCalledWith('command-launcher-preview:payload', preview);
  });

  it('centers the detached preview over the launcher anchor bounds', async () => {
    const nativeHelper = {
      getFrontmostApp: vi.fn(() => ({ bundleId: 'com.fieldtheory.app', name: 'Field Theory' })),
      getFrontmostWindowBounds: vi.fn(() => ({ x: 0, y: 0, width: 1920, height: 1080 })),
    };
    const launcher = new CommandLauncherWindow(nativeHelper as any);
    (launcher as any).window = mockWindow;

    await launcher.show({
      anchorBounds: { x: 100, y: 200, width: 900, height: 700 },
    });

    mockWindow.setBounds.mockClear();
    const preview = { kind: 'markdown', title: 'refactor.md', filePath: '/tmp/refactor.md', content: '# Refactor' };

    mockIpcMainHandlers.get('command-launcher:preview-show')?.({}, preview);

    expect(mockWindow.setBounds).toHaveBeenCalledWith({
      x: 290,
      y: 270,
      width: 520,
      height: 560,
    });
  });

  it('resizes the detached preview around measured content height', async () => {
    const nativeHelper = {
      getFrontmostApp: vi.fn(() => ({ bundleId: 'com.fieldtheory.app', name: 'Field Theory' })),
      getFrontmostWindowBounds: vi.fn(() => ({ x: 0, y: 0, width: 1920, height: 1080 })),
    };
    const launcher = new CommandLauncherWindow(nativeHelper as any);
    (launcher as any).window = mockWindow;

    await launcher.show({
      anchorBounds: { x: 100, y: 200, width: 900, height: 700 },
    });

    const preview = { kind: 'bookmark', bookmark: { id: 'bookmark-1', text: 'short' } };
    mockIpcMainHandlers.get('command-launcher:preview-show')?.({}, preview);
    mockWindow.setBounds.mockClear();
    mockWindow.isVisible.mockReturnValue(true);

    mockIpcMainHandlers.get('command-launcher:preview-resize')?.({}, 360);

    expect(mockWindow.setBounds).toHaveBeenCalledWith({
      x: 290,
      y: 370,
      width: 520,
      height: 360,
    });
  });

  it('clamps detached preview resize requests to the maximum preview height', () => {
    new CommandLauncherWindow();
    const preview = { kind: 'bookmark', bookmark: { id: 'bookmark-1', text: 'hello' } };
    mockIpcMainHandlers.get('command-launcher:preview-show')?.({}, preview);
    mockWindow.setBounds.mockClear();
    mockWindow.isVisible.mockReturnValue(true);

    mockIpcMainHandlers.get('command-launcher:preview-resize')?.({}, 1200);

    expect(mockWindow.setBounds).toHaveBeenCalledWith({
      x: 700,
      y: 260,
      width: 520,
      height: 560,
    });
  });
});
