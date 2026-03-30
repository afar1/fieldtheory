import { describe, expect, it, vi, beforeEach } from 'vitest';

// Hoist mock state so it's available before module imports
const mockWindow = vi.hoisted(() => ({
  isDestroyed: vi.fn(() => false),
  isVisible: vi.fn(() => true),
  hide: vi.fn(),
  show: vi.fn(),
  focus: vi.fn(),
  moveTop: vi.fn(),
  setBounds: vi.fn(),
  getBounds: vi.fn(() => ({ x: 0, y: 0, width: 320, height: 36 })),
  setAlwaysOnTop: vi.fn(),
  setVisibleOnAllWorkspaces: vi.fn(),
  loadURL: vi.fn(),
  loadFile: vi.fn(),
  destroy: vi.fn(),
  on: vi.fn(),
  webContents: { send: vi.fn(), openDevTools: vi.fn() },
}));

const mockApp = vi.hoisted(() => ({
  hide: vi.fn(),
  getName: vi.fn(() => 'Field Theory'),
  getAppPath: vi.fn(() => '/tmp'),
  dock: { hide: vi.fn() },
}));

vi.mock('electron', () => ({
  app: mockApp,
  BrowserWindow: vi.fn(() => mockWindow),
  screen: {
    getCursorScreenPoint: vi.fn(() => ({ x: 0, y: 0 })),
    getDisplayNearestPoint: vi.fn(() => ({ bounds: { x: 0, y: 0, width: 1920, height: 1080 } })),
  },
  ipcMain: {
    on: vi.fn(),
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

describe('CommandLauncherWindow.hide()', () => {
  let launcher: CommandLauncherWindow;

  beforeEach(() => {
    vi.clearAllMocks();
    launcher = new CommandLauncherWindow();
    // Force-create the window via show() internals
    (launcher as any).window = mockWindow;
    (launcher as any).previousApp = { bundleId: 'com.apple.Safari', name: 'Safari' };
    mockWindow.isVisible.mockReturnValue(true);
    mockWindow.isDestroyed.mockReturnValue(false);
  });

  it('hides the window and activates previous app by default', () => {
    launcher.hide();

    expect(mockWindow.hide).toHaveBeenCalled();
    // activatePreviousApp is async and uses execFile internally,
    // but we can verify it wasn't skipped by checking app.hide wasn't called as fallback
    expect(mockApp.hide).not.toHaveBeenCalled();
  });

  it('hides the window without activating when skipActivation is true', () => {
    launcher.hide(true);

    expect(mockWindow.hide).toHaveBeenCalled();
    // No activation should happen
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
