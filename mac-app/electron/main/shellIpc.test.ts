import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: vi.fn(),
  },
  ipcMain: {
    handle: vi.fn(),
  },
  shell: {
    openExternal: vi.fn(),
    openPath: vi.fn(),
    showItemInFolder: vi.fn(),
  },
}));

vi.mock('./logger', () => ({
  createLogger: () => ({
    warn: vi.fn(),
  }),
}));

import { ShellIPCChannels, isAllowedExternalShellUrl, registerShellIpc } from './shellIpc';

describe('shellIpc', () => {
  let handlers: Map<string, (event: any, ...args: any[]) => unknown>;
  let ipcMain: { handle: ReturnType<typeof vi.fn> };
  let shell: {
    openExternal: ReturnType<typeof vi.fn>;
    openPath: ReturnType<typeof vi.fn>;
    showItemInFolder: ReturnType<typeof vi.fn>;
  };
  let fileSystem: {
    existsSync: ReturnType<typeof vi.fn>;
    statSync: ReturnType<typeof vi.fn>;
  };
  let browserWindow: {
    fromWebContents: ReturnType<typeof vi.fn>;
  };
  let logger: {
    warn: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    handlers = new Map();
    ipcMain = {
      handle: vi.fn((channel: string, handler: (event: any, ...args: any[]) => unknown) => {
        handlers.set(channel, handler);
      }),
    };
    shell = {
      openExternal: vi.fn().mockResolvedValue(undefined),
      openPath: vi.fn().mockResolvedValue(''),
      showItemInFolder: vi.fn(),
    };
    fileSystem = {
      existsSync: vi.fn(),
      statSync: vi.fn(),
    };
    browserWindow = {
      fromWebContents: vi.fn(),
    };
    logger = {
      warn: vi.fn(),
    };
  });

  function register() {
    registerShellIpc({
      ipcMain: ipcMain as any,
      shell: shell as any,
      fileSystem: fileSystem as any,
      browserWindow: browserWindow as any,
      logger: logger as any,
    });
  }

  function handler(channel: string) {
    const registered = handlers.get(channel);
    expect(registered).toBeDefined();
    return registered!;
  }

  it('registers the existing public shell channel names', () => {
    register();

    expect([...handlers.keys()]).toEqual([
      'shell:openExternal',
      'shell:showItemInFolder',
      'shell:setRepresentedFilename',
    ]);
  });

  it('keeps the current external URL allowlist explicit', () => {
    expect(isAllowedExternalShellUrl('https://fieldtheory.dev')).toBe(true);
    expect(isAllowedExternalShellUrl('http://localhost:5173')).toBe(true);
    expect(isAllowedExternalShellUrl('mailto:support@fieldtheory.dev')).toBe(true);
    expect(isAllowedExternalShellUrl('x-apple.systempreferences:com.apple.preference.security')).toBe(true);

    expect(isAllowedExternalShellUrl('file:///tmp/test.md')).toBe(false);
    expect(isAllowedExternalShellUrl('fieldtheory://wiki/open?path=Plan')).toBe(false);
    expect(isAllowedExternalShellUrl('javascript:alert(1)')).toBe(false);
    expect(isAllowedExternalShellUrl('not a url')).toBe(false);
  });

  it('opens allowed external URLs', async () => {
    register();

    await handler(ShellIPCChannels.OPEN_EXTERNAL)({ sender: {} }, 'https://fieldtheory.dev');

    expect(shell.openExternal).toHaveBeenCalledWith('https://fieldtheory.dev');
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('blocks disallowed external URLs', async () => {
    register();

    await handler(ShellIPCChannels.OPEN_EXTERNAL)({ sender: {} }, 'file:///tmp/private.md');

    expect(shell.openExternal).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('shell:openExternal blocked URL: %s', 'file:///tmp/private.md');
  });

  it('opens directories directly instead of revealing them in Finder', async () => {
    fileSystem.existsSync.mockReturnValue(true);
    fileSystem.statSync.mockReturnValue({ isDirectory: () => true });
    register();

    await handler(ShellIPCChannels.SHOW_ITEM_IN_FOLDER)({ sender: {} }, '/Users/afar/Documents');

    expect(shell.openPath).toHaveBeenCalledWith('/Users/afar/Documents');
    expect(shell.showItemInFolder).not.toHaveBeenCalled();
  });

  it('reveals files in Finder', async () => {
    fileSystem.existsSync.mockReturnValue(true);
    fileSystem.statSync.mockReturnValue({ isDirectory: () => false });
    register();

    await handler(ShellIPCChannels.SHOW_ITEM_IN_FOLDER)({ sender: {} }, '/Users/afar/Documents/note.md');

    expect(shell.openPath).not.toHaveBeenCalled();
    expect(shell.showItemInFolder).toHaveBeenCalledWith('/Users/afar/Documents/note.md');
  });

  it('sets the represented filename on the sender window', () => {
    const win = { setRepresentedFilename: vi.fn() };
    const sender = {};
    browserWindow.fromWebContents.mockReturnValue(win);
    register();

    handler(ShellIPCChannels.SET_REPRESENTED_FILENAME)({ sender }, '/Users/afar/Documents/note.md');

    expect(browserWindow.fromWebContents).toHaveBeenCalledWith(sender);
    expect(win.setRepresentedFilename).toHaveBeenCalledWith('/Users/afar/Documents/note.md');
  });

  it('clears the represented filename when given an empty path', () => {
    const win = { setRepresentedFilename: vi.fn() };
    browserWindow.fromWebContents.mockReturnValue(win);
    register();

    handler(ShellIPCChannels.SET_REPRESENTED_FILENAME)({ sender: {} }, '');

    expect(win.setRepresentedFilename).toHaveBeenCalledWith('');
  });
});
