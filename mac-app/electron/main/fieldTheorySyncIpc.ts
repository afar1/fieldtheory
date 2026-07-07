import { ipcMain } from 'electron';
import type { FieldTheorySyncStatus } from './releaseSyncPolicy';
import type { LibraryDocumentPublishResult, LibrarySyncStatusDetails } from './librarySyncService';

export const FieldTheorySyncIPCChannels = {
  GET_STATUS: 'fieldTheorySync:getStatus',
  SET_LOCAL_ENABLED: 'fieldTheorySync:setLocalEnabled',
  GET_LIBRARY_STATUS: 'fieldTheorySync:getLibraryStatus',
  PUBLISH_LIBRARY_DOCUMENT: 'fieldTheorySync:publishLibraryDocument',
} as const;

type FieldTheorySyncIpcDependencies = {
  ipcMain?: Pick<typeof ipcMain, 'handle'>;
  getStatus: () => FieldTheorySyncStatus;
  setLocalEnabled: (enabled: boolean) => Promise<void> | void;
  getLibraryStatus: () => Promise<LibrarySyncStatusDetails> | LibrarySyncStatusDetails;
  publishLibraryDocument: (filePath: string) => Promise<LibraryDocumentPublishResult> | LibraryDocumentPublishResult;
};

export function registerFieldTheorySyncIpc({
  ipcMain: targetIpcMain = ipcMain,
  getStatus,
  setLocalEnabled,
  getLibraryStatus,
  publishLibraryDocument,
}: FieldTheorySyncIpcDependencies): void {
  targetIpcMain.handle(FieldTheorySyncIPCChannels.GET_STATUS, async () => {
    return getStatus();
  });

  targetIpcMain.handle(FieldTheorySyncIPCChannels.SET_LOCAL_ENABLED, async (_event, enabled: boolean) => {
    await setLocalEnabled(enabled === true);
    return getStatus();
  });

  targetIpcMain.handle(FieldTheorySyncIPCChannels.GET_LIBRARY_STATUS, async () => {
    return getLibraryStatus();
  });

  targetIpcMain.handle(FieldTheorySyncIPCChannels.PUBLISH_LIBRARY_DOCUMENT, async (_event, filePath: unknown) => {
    if (typeof filePath !== 'string' || filePath.trim().length === 0) {
      return {
        success: false,
        reason: 'invalid_path',
        uploaded: 0,
        updated: 0,
        skipped: 0,
        error: 'Missing Library document path',
        errors: ['Missing Library document path'],
        lastSyncAt: null,
        lastPushAt: null,
      } satisfies LibraryDocumentPublishResult;
    }
    return publishLibraryDocument(filePath);
  });
}
