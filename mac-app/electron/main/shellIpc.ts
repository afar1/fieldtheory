import { BrowserWindow, ipcMain, shell } from 'electron';
import fs from 'fs';
import { createLogger } from './logger';

const log = createLogger('ShellIPC');

export const ShellIPCChannels = {
  OPEN_EXTERNAL: 'shell:openExternal',
  SHOW_ITEM_IN_FOLDER: 'shell:showItemInFolder',
  SET_REPRESENTED_FILENAME: 'shell:setRepresentedFilename',
} as const;

export function isAllowedExternalShellUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:'
      || parsed.protocol === 'http:'
      || parsed.protocol === 'mailto:'
      || parsed.protocol === 'x-apple.systempreferences:';
  } catch {
    return false;
  }
}

type ShellIpcDependencies = {
  ipcMain?: Pick<typeof ipcMain, 'handle'>;
  shell?: Pick<typeof shell, 'openExternal' | 'openPath' | 'showItemInFolder'>;
  browserWindow?: Pick<typeof BrowserWindow, 'fromWebContents'>;
  fileSystem?: Pick<typeof fs, 'existsSync' | 'statSync'>;
  logger?: Pick<typeof log, 'warn'>;
};

export function registerShellIpc(dependencies: ShellIpcDependencies = {}): void {
  const targetIpcMain = dependencies.ipcMain ?? ipcMain;
  const targetShell = dependencies.shell ?? shell;
  const targetBrowserWindow = dependencies.browserWindow ?? BrowserWindow;
  const targetFileSystem = dependencies.fileSystem ?? fs;
  const targetLogger = dependencies.logger ?? log;

  targetIpcMain.handle(ShellIPCChannels.OPEN_EXTERNAL, async (_event, url: string) => {
    if (!isAllowedExternalShellUrl(url)) {
      targetLogger.warn('shell:openExternal blocked URL: %s', url);
      return;
    }
    await targetShell.openExternal(url);
  });

  targetIpcMain.handle(ShellIPCChannels.SHOW_ITEM_IN_FOLDER, async (_event, fullPath: string) => {
    try {
      if (targetFileSystem.existsSync(fullPath) && targetFileSystem.statSync(fullPath).isDirectory()) {
        await targetShell.openPath(fullPath);
        return;
      }
    } catch {
      // Fall through to the existing reveal behavior.
    }
    targetShell.showItemInFolder(fullPath);
  });

  targetIpcMain.handle(ShellIPCChannels.SET_REPRESENTED_FILENAME, (event, fullPath: string) => {
    const win = targetBrowserWindow.fromWebContents(event.sender);
    win?.setRepresentedFilename(fullPath || '');
  });
}
