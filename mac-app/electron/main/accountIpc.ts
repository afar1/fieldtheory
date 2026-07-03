import { ipcMain } from 'electron';
import type { AccountStatus, AccountStatusManager } from './accountStatusManager';

export const AccountIPCChannels = {
  GET_STATUS: 'account:getStatus',
  CHECK_NOW: 'account:checkNow',
} as const;

const defaultAccountStatus: AccountStatus = { state: 'checking', capabilityMode: 'writable' };

type AccountIpcDependencies = {
  ipcMain?: Pick<typeof ipcMain, 'handle'>;
  getAccountStatusManager: () => AccountStatusManager | null;
};

export function registerAccountIpc({
  ipcMain: targetIpcMain = ipcMain,
  getAccountStatusManager,
}: AccountIpcDependencies): void {
  targetIpcMain.handle(AccountIPCChannels.GET_STATUS, async () => {
    return getAccountStatusManager()?.getStatus() ?? defaultAccountStatus;
  });

  targetIpcMain.handle(AccountIPCChannels.CHECK_NOW, async () => {
    return getAccountStatusManager()?.checkNow() ?? defaultAccountStatus;
  });
}
