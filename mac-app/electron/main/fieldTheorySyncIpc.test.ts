import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FieldTheorySyncIPCChannels, registerFieldTheorySyncIpc } from './fieldTheorySyncIpc';
import type { FieldTheorySyncStatus } from './releaseSyncPolicy';
import type { LibraryDocumentPublishResult, LibrarySyncStatusDetails } from './librarySyncService';

describe('fieldTheorySyncIpc', () => {
  let handlers: Map<string, (event: any, ...args: any[]) => unknown>;
  let ipcMain: { handle: ReturnType<typeof vi.fn> };
  let status: FieldTheorySyncStatus;
  let setLocalEnabled: ReturnType<typeof vi.fn>;
  let libraryStatus: LibrarySyncStatusDetails;
  let publishLibraryDocument: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    handlers = new Map();
    ipcMain = {
      handle: vi.fn((channel: string, handler: (event: any, ...args: any[]) => unknown) => {
        handlers.set(channel, handler);
      }),
    };
    status = {
      localEnabled: false,
      authenticated: true,
      serverEnforced: false,
      enabled: false,
      reason: 'local_disabled',
    };
    setLocalEnabled = vi.fn(async (enabled: boolean) => {
      status = {
        localEnabled: enabled,
        authenticated: true,
        serverEnforced: false,
        enabled,
        reason: enabled ? 'enabled' : 'local_disabled',
      };
    });
    libraryStatus = {
      ready: true,
      reason: 'enabled',
      lastSyncAt: 100,
      lastPushAt: 100,
      lastError: null,
      pendingLocalDocumentCount: 1,
    };
    publishLibraryDocument = vi.fn((filePath: string): LibraryDocumentPublishResult => ({
      success: true,
      reason: 'published',
      uploaded: 1,
      updated: 0,
      skipped: 0,
      sourcePath: 'briefs/New.md',
      clientId: 'library-client',
      title: 'New',
      contentHash: 'hash',
      errors: [],
      lastSyncAt: 200,
      lastPushAt: 200,
    }));
  });

  function register() {
    registerFieldTheorySyncIpc({
      ipcMain: ipcMain as any,
      getStatus: () => status,
      setLocalEnabled: setLocalEnabled as any,
      getLibraryStatus: () => libraryStatus,
      publishLibraryDocument: publishLibraryDocument as any,
    });
  }

  function handler(channel: string) {
    const registered = handlers.get(channel);
    expect(registered).toBeDefined();
    return registered!;
  }

  it('registers the existing public sync channel names', () => {
    register();

    expect([...handlers.keys()]).toEqual([
      'fieldTheorySync:getStatus',
      'fieldTheorySync:setLocalEnabled',
      'fieldTheorySync:getLibraryStatus',
      'fieldTheorySync:publishLibraryDocument',
    ]);
  });

  it('returns the current sync status', async () => {
    register();

    await expect(handler(FieldTheorySyncIPCChannels.GET_STATUS)({ sender: {} })).resolves.toEqual(status);
  });

  it('persists true local enablement and returns the updated status', async () => {
    register();

    await expect(handler(FieldTheorySyncIPCChannels.SET_LOCAL_ENABLED)({ sender: {} }, true)).resolves.toMatchObject({
      localEnabled: true,
      enabled: true,
      reason: 'enabled',
    });
    expect(setLocalEnabled).toHaveBeenCalledWith(true);
  });

  it('normalizes non-true values to disabled', async () => {
    register();

    await handler(FieldTheorySyncIPCChannels.SET_LOCAL_ENABLED)({ sender: {} }, 'yes');

    expect(setLocalEnabled).toHaveBeenCalledWith(false);
  });

  it('returns Library sync status with pending local document count', async () => {
    register();

    await expect(handler(FieldTheorySyncIPCChannels.GET_LIBRARY_STATUS)({ sender: {} })).resolves.toEqual(libraryStatus);
  });

  it('publishes a selected Library document by path', async () => {
    register();

    await expect(
      handler(FieldTheorySyncIPCChannels.PUBLISH_LIBRARY_DOCUMENT)({ sender: {} }, '/tmp/New.md'),
    ).resolves.toMatchObject({
      success: true,
      reason: 'published',
      uploaded: 1,
      sourcePath: 'briefs/New.md',
    });
    expect(publishLibraryDocument).toHaveBeenCalledWith('/tmp/New.md');
  });

  it('rejects selected Library publish requests without a path', async () => {
    register();

    await expect(
      handler(FieldTheorySyncIPCChannels.PUBLISH_LIBRARY_DOCUMENT)({ sender: {} }, ''),
    ).resolves.toMatchObject({
      success: false,
      reason: 'invalid_path',
      error: 'Missing Library document path',
    });
    expect(publishLibraryDocument).not.toHaveBeenCalled();
  });
});
