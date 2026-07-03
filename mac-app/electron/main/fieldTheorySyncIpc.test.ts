import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FieldTheorySyncIPCChannels, registerFieldTheorySyncIpc } from './fieldTheorySyncIpc';
import type { FieldTheorySyncStatus } from './releaseSyncPolicy';

describe('fieldTheorySyncIpc', () => {
  let handlers: Map<string, (event: any, ...args: any[]) => unknown>;
  let ipcMain: { handle: ReturnType<typeof vi.fn> };
  let status: FieldTheorySyncStatus;
  let setLocalEnabled: ReturnType<typeof vi.fn>;

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
  });

  function register() {
    registerFieldTheorySyncIpc({
      ipcMain: ipcMain as any,
      getStatus: () => status,
      setLocalEnabled: setLocalEnabled as any,
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
});
