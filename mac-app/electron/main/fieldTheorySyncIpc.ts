import { ipcMain } from 'electron';
import type { FieldTheorySyncStatus } from './releaseSyncPolicy';

export const FieldTheorySyncIPCChannels = {
  GET_STATUS: 'fieldTheorySync:getStatus',
  SET_LOCAL_ENABLED: 'fieldTheorySync:setLocalEnabled',
} as const;

type FieldTheorySyncIpcDependencies = {
  ipcMain?: Pick<typeof ipcMain, 'handle'>;
  getStatus: () => FieldTheorySyncStatus;
  setLocalEnabled: (enabled: boolean) => Promise<void> | void;
};

export function registerFieldTheorySyncIpc({
  ipcMain: targetIpcMain = ipcMain,
  getStatus,
  setLocalEnabled,
}: FieldTheorySyncIpcDependencies): void {
  targetIpcMain.handle(FieldTheorySyncIPCChannels.GET_STATUS, async () => {
    return getStatus();
  });

  targetIpcMain.handle(FieldTheorySyncIPCChannels.SET_LOCAL_ENABLED, async (_event, enabled: boolean) => {
    await setLocalEnabled(enabled === true);
    return getStatus();
  });
}
