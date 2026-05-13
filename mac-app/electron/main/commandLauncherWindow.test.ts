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
const LAUNCHER_WIDTH = 520;
const LAUNCHER_COLLAPSED_HEIGHT = 52;
const LAUNCHER_RESULTS_HEIGHT = 430;

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

type CommandLauncherResetPayload = {
  isDarkMode: boolean;
  generation: number;
};

function getLastResetPayload(): CommandLauncherResetPayload {
  const resetCall = [...mockWindow.webContents.send.mock.calls]
    .reverse()
    .find(([channel]) => channel === 'command-launcher:reset');
  expect(resetCall).toBeTruthy();
  return resetCall?.[1] as CommandLauncherResetPayload;
}

describe('CommandLauncherWindow.show()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIpcMainHandlers.clear();
    vi.useRealTimers();
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
      y: Math.round(200 + (700 - LAUNCHER_RESULTS_HEIGHT) / 2 - 50),
      width: LAUNCHER_WIDTH,
      height: LAUNCHER_COLLAPSED_HEIGHT,
    });
  });

  it('prefers fresh frontmost window bounds over cached bounds', async () => {
    const nativeHelper = {
      getFrontmostApp: vi.fn(() => ({
        bundleId: 'com.apple.Safari',
        name: 'Safari',
        windowBounds: { x: 50, y: 100, width: 1000, height: 800 },
      })),
      getFrontmostWindowBounds: vi.fn(() => ({ x: 1400, y: 120, width: 1100, height: 900 })),
    };
    const launcher = new CommandLauncherWindow(nativeHelper as any);
    (launcher as any).window = mockWindow;

    await launcher.show();

    expect(nativeHelper.getFrontmostWindowBounds).toHaveBeenCalled();
    expect(mockWindow.setBounds).toHaveBeenCalledWith({
      x: Math.round(1400 + (1100 - LAUNCHER_WIDTH) / 2),
      y: Math.round(120 + (900 - LAUNCHER_RESULTS_HEIGHT) / 2 - 50),
      width: LAUNCHER_WIDTH,
      height: LAUNCHER_COLLAPSED_HEIGHT,
    });
  });

  it('falls back to cached frontmost window bounds when fresh bounds are unavailable', async () => {
    const nativeHelper = {
      getFrontmostApp: vi.fn(() => ({
        bundleId: 'com.apple.Safari',
        name: 'Safari',
        windowBounds: { x: 50, y: 100, width: 1000, height: 800 },
      })),
      getFrontmostWindowBounds: vi.fn(() => null),
    };
    const launcher = new CommandLauncherWindow(nativeHelper as any);
    (launcher as any).window = mockWindow;

    await launcher.show();

    expect(nativeHelper.getFrontmostWindowBounds).toHaveBeenCalled();
    expect(mockWindow.setBounds).toHaveBeenCalledWith({
      x: Math.round(50 + (1000 - LAUNCHER_WIDTH) / 2),
      y: Math.round(100 + (800 - LAUNCHER_RESULTS_HEIGHT) / 2 - 50),
      width: LAUNCHER_WIDTH,
      height: LAUNCHER_COLLAPSED_HEIGHT,
    });
  });

  it('keeps fresh bounds lookup inside the open latency budget', async () => {
    vi.useFakeTimers();
    const nativeHelper = {
      getFrontmostApp: vi.fn(() => ({
        bundleId: 'com.apple.Safari',
        name: 'Safari',
        windowBounds: { x: 50, y: 100, width: 1000, height: 800 },
      })),
      getFrontmostWindowBounds: vi.fn((timeoutMs: number) => new Promise(resolve => {
        setTimeout(() => resolve(null), timeoutMs);
      })),
    };
    const launcher = new CommandLauncherWindow(nativeHelper as any);
    (launcher as any).window = mockWindow;

    const showPromise = launcher.show();
    await Promise.resolve();

    const boundsTimeoutMs = nativeHelper.getFrontmostWindowBounds.mock.calls[0]?.[0];
    expect(boundsTimeoutMs).toBeLessThan(50);
    expect(mockWindow.show).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(boundsTimeoutMs);
    await showPromise;

    expect(mockWindow.show).toHaveBeenCalled();
    expect(mockWindow.focus).toHaveBeenCalled();
  });

  it('resets renderer state before showing and focusing the window', async () => {
    const nativeHelper = {
      getFrontmostApp: vi.fn(() => ({ bundleId: 'com.apple.Safari', name: 'Safari' })),
      getFrontmostWindowBounds: vi.fn(),
    };
    const launcher = new CommandLauncherWindow(nativeHelper as any);
    (launcher as any).window = mockWindow;

    await launcher.show();

    expect(mockWindow.webContents.send).toHaveBeenCalledWith('command-launcher:reset', { isDarkMode: false, generation: 1 });
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

  it('treats other Electron-based apps as external command targets', async () => {
    const nativeHelper = {
      getFrontmostApp: vi.fn(() => ({ bundleId: 'com.superhuman.electron', name: 'Superhuman' })),
      getFrontmostWindowBounds: vi.fn(() => ({ x: 0, y: 0, width: 1920, height: 1080 })),
    };
    const launcher = new CommandLauncherWindow(nativeHelper as any);
    (launcher as any).window = mockWindow;

    await launcher.show({
      anchorBounds: { x: 100, y: 200, width: 900, height: 700 },
    });

    expect(launcher.getPreviousApp()).toEqual({ bundleId: 'com.superhuman.electron', name: 'Superhuman' });
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
      backgroundColor: '#00000000',
    }));
  });

  it('passes the current app theme to reset before show', async () => {
    const launcher = new CommandLauncherWindow(undefined, {
      getInitialDarkMode: () => true,
    });
    (launcher as any).window = mockWindow;

    await launcher.show();

    expect(mockWindow.webContents.send).toHaveBeenCalledWith('command-launcher:reset', { isDarkMode: true, generation: 1 });
  });

  it('uses a transparent launcher background so rounded corners stay clean', () => {
    const launcher = new CommandLauncherWindow(undefined, {
      getInitialDarkMode: () => false,
    });

    launcher.preload();

    expect(BrowserWindow).toHaveBeenCalledWith(expect.objectContaining({
      backgroundColor: '#00000000',
      webPreferences: expect.objectContaining({
        additionalArguments: ['--field-theory-dark-mode=false'],
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

  it('honors renderer close requests that skip activation', () => {
    const activatePreviousApp = vi.spyOn(launcher as any, 'activatePreviousApp').mockResolvedValue(undefined);

    mockIpcMainHandlers.get('command-launcher:close')?.({}, { skipActivation: true });

    expect(mockWindow.hide).toHaveBeenCalled();
    expect(activatePreviousApp).not.toHaveBeenCalled();
    expect(mockApp.hide).not.toHaveBeenCalled();
  });

  it('ignores renderer close requests from an older launcher generation', async () => {
    const activatePreviousApp = vi.spyOn(launcher as any, 'activatePreviousApp').mockResolvedValue(undefined);
    await launcher.show();
    const staleGeneration = getLastResetPayload().generation;
    await launcher.show();
    expect(getLastResetPayload().generation).toBe(staleGeneration + 1);
    mockWindow.hide.mockClear();

    mockIpcMainHandlers.get('command-launcher:close')?.({}, { skipActivation: true, generation: staleGeneration });

    expect(mockWindow.hide).not.toHaveBeenCalled();
    expect(activatePreviousApp).not.toHaveBeenCalled();
    expect(mockApp.hide).not.toHaveBeenCalled();
  });

  it('honors renderer close requests for the current launcher generation', async () => {
    const activatePreviousApp = vi.spyOn(launcher as any, 'activatePreviousApp').mockResolvedValue(undefined);
    await launcher.show();
    const currentGeneration = getLastResetPayload().generation;
    mockWindow.hide.mockClear();

    mockIpcMainHandlers.get('command-launcher:close')?.({}, { skipActivation: true, generation: currentGeneration });

    expect(mockWindow.hide).toHaveBeenCalled();
    expect(activatePreviousApp).not.toHaveBeenCalled();
    expect(mockApp.hide).not.toHaveBeenCalled();
  });

  it('activates the previous app for default renderer close requests', () => {
    const activatePreviousApp = vi.spyOn(launcher as any, 'activatePreviousApp').mockResolvedValue(undefined);

    mockIpcMainHandlers.get('command-launcher:close')?.({});

    expect(mockWindow.hide).toHaveBeenCalled();
    expect(activatePreviousApp).toHaveBeenCalledWith('com.apple.Safari');
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

  it('hides on blur without activating stale previous app when Field Theory was active on show', () => {
    (launcher as any).window = null;
    launcher.preload();
    (launcher as any).fieldTheoryActiveOnShow = true;
    (launcher as any).previousApp = { bundleId: 'com.apple.Safari', name: 'Safari' };
    const hide = vi.spyOn(launcher, 'hide');
    const activatePreviousApp = vi.spyOn(launcher as any, 'activatePreviousApp').mockResolvedValue(undefined);
    const blurHandler = mockWindow.on.mock.calls.find(([event]) => event === 'blur')?.[1];

    blurHandler?.();

    expect(hide).toHaveBeenCalled();
    expect(mockWindow.hide).toHaveBeenCalled();
    expect(activatePreviousApp).not.toHaveBeenCalled();
    expect(mockApp.hide).not.toHaveBeenCalled();
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

  it('lets external command invocation blur hide without re-activating previous app', () => {
    (launcher as any).window = null;
    launcher.preload();
    (launcher as any).previousApp = { bundleId: 'com.apple.Safari', name: 'Safari' };
    const activatePreviousApp = vi.spyOn(launcher as any, 'activatePreviousApp').mockResolvedValue(undefined);
    const blurHandler = mockWindow.on.mock.calls.find(([event]) => event === 'blur')?.[1];

    launcher.beginExternalInvocationSuppression();
    blurHandler?.();

    expect(mockWindow.hide).toHaveBeenCalled();
    expect(activatePreviousApp).not.toHaveBeenCalled();
    expect(mockApp.hide).not.toHaveBeenCalled();
  });

  it('does not bring the previous app forward when target activation blurs the launcher first', () => {
    const nativeHelper = {
      getFrontmostApp: vi.fn(() => ({ bundleId: 'com.mitchellh.ghostty', name: 'Ghostty' })),
    };
    const targetActivationLauncher = new CommandLauncherWindow(nativeHelper as any);
    (targetActivationLauncher as any).window = null;
    targetActivationLauncher.preload();
    (targetActivationLauncher as any).previousApp = { bundleId: 'com.apple.Safari', name: 'Safari' };
    const activatePreviousApp = vi.spyOn(targetActivationLauncher as any, 'activatePreviousApp').mockResolvedValue(undefined);
    const blurHandler = mockWindow.on.mock.calls.find(([event]) => event === 'blur')?.[1];

    targetActivationLauncher.beginExternalInvocationSuppression();
    blurHandler?.();

    expect(mockWindow.hide).toHaveBeenCalled();
    expect(activatePreviousApp).not.toHaveBeenCalled();
    expect(mockApp.hide).not.toHaveBeenCalled();
  });

  it('keeps external invocation suppression active until the token ends', () => {
    const activatePreviousApp = vi.spyOn(launcher as any, 'activatePreviousApp').mockResolvedValue(undefined);

    const token = launcher.beginExternalInvocationSuppression();
    expect(launcher.isExternalInvocationActivationSuppressed()).toBe(true);
    launcher.hide(true);
    expect(activatePreviousApp).not.toHaveBeenCalled();
    expect(launcher.isExternalInvocationActivationSuppressed()).toBe(true);

    mockWindow.hide.mockClear();
    mockWindow.isVisible.mockReturnValue(true);
    launcher.hide();

    expect(mockWindow.hide).toHaveBeenCalled();
    expect(activatePreviousApp).not.toHaveBeenCalled();
    expect(mockApp.hide).not.toHaveBeenCalled();

    launcher.endExternalInvocationSuppression(token);
    expect(launcher.isExternalInvocationActivationSuppressed()).toBe(false);
  });

  it('keeps overlapping external invocation suppression until every token ends', () => {
    const activatePreviousApp = vi.spyOn(launcher as any, 'activatePreviousApp').mockResolvedValue(undefined);

    const firstToken = launcher.beginExternalInvocationSuppression();
    const secondToken = launcher.beginExternalInvocationSuppression();
    launcher.endExternalInvocationSuppression(firstToken);
    expect(launcher.isExternalInvocationActivationSuppressed()).toBe(true);

    launcher.hide();
    expect(activatePreviousApp).not.toHaveBeenCalled();

    mockWindow.hide.mockClear();
    mockWindow.isVisible.mockReturnValue(true);
    launcher.endExternalInvocationSuppression(secondToken);
    expect(launcher.isExternalInvocationActivationSuppressed()).toBe(false);

    launcher.hide();

    expect(mockWindow.hide).toHaveBeenCalled();
    expect(activatePreviousApp).toHaveBeenCalledWith('com.apple.Safari');
  });

  it('does not keep ended external invocation suppression before a fresh show', async () => {
    const nativeHelper = {
      getFrontmostApp: vi.fn(() => ({ bundleId: 'com.apple.Safari', name: 'Safari' })),
      getFrontmostWindowBounds: vi.fn(() => ({ x: 0, y: 0, width: 1920, height: 1080 })),
    };
    const freshLauncher = new CommandLauncherWindow(nativeHelper as any);
    (freshLauncher as any).window = mockWindow;
    const activatePreviousApp = vi.spyOn(freshLauncher as any, 'activatePreviousApp').mockResolvedValue(undefined);

    const token = freshLauncher.beginExternalInvocationSuppression();
    freshLauncher.endExternalInvocationSuppression(token);
    await freshLauncher.show({
      anchorBounds: { x: 100, y: 200, width: 900, height: 700 },
    });
    freshLauncher.hide();

    expect(activatePreviousApp).toHaveBeenCalledWith('com.apple.Safari');
    expect(nativeHelper.getFrontmostWindowBounds).not.toHaveBeenCalled();
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

    mockIpcMainHandlers.get('command-launcher:resize')?.({}, 390);

    expect(mockWindow.setBounds).toHaveBeenCalledWith({
      x: 10,
      y: 20,
      width: LAUNCHER_WIDTH,
      height: 390,
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
      height: LAUNCHER_RESULTS_HEIGHT,
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
      backgroundColor: '#00000000',
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
