import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountIPCChannels, registerAccountIpc } from './accountIpc';
import type { AccountStatusManager } from './accountStatusManager';

describe('accountIpc', () => {
  let handlers: Map<string, (event: any, ...args: any[]) => unknown>;
  let ipcMain: { handle: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    handlers = new Map();
    ipcMain = {
      handle: vi.fn((channel: string, handler: (event: any, ...args: any[]) => unknown) => {
        handlers.set(channel, handler);
      }),
    };
  });

  function register(getAccountStatusManager: () => AccountStatusManager | null) {
    registerAccountIpc({
      ipcMain: ipcMain as any,
      getAccountStatusManager,
    });
  }

  function handler(channel: string) {
    const registered = handlers.get(channel);
    expect(registered).toBeDefined();
    return registered!;
  }

  it('registers the existing public account channel names', () => {
    register(() => null);

    expect([...handlers.keys()]).toEqual([
      'account:getStatus',
      'account:checkNow',
    ]);
  });

  it('returns the default checking status when the manager is unavailable', async () => {
    register(() => null);

    await expect(handler(AccountIPCChannels.GET_STATUS)({ sender: {} })).resolves.toEqual({
      state: 'checking',
      capabilityMode: 'writable',
    });
    await expect(handler(AccountIPCChannels.CHECK_NOW)({ sender: {} })).resolves.toEqual({
      state: 'checking',
      capabilityMode: 'writable',
    });
  });

  it('returns the current manager status', async () => {
    const manager = {
      getStatus: vi.fn(() => ({
        state: 'active',
        capabilityMode: 'writable',
        tier: 'pro',
        checkedAt: '2026-05-31T00:00:00.000Z',
      })),
      checkNow: vi.fn(),
    } as unknown as AccountStatusManager;
    register(() => manager);

    await expect(handler(AccountIPCChannels.GET_STATUS)({ sender: {} })).resolves.toMatchObject({
      state: 'active',
      tier: 'pro',
    });
  });

  it('runs an explicit account check through the manager', async () => {
    const manager = {
      getStatus: vi.fn(),
      checkNow: vi.fn(async () => ({
        state: 'needs_login',
        capabilityMode: 'writable',
        email: 'user@example.com',
      })),
    } as unknown as AccountStatusManager;
    register(() => manager);

    await expect(handler(AccountIPCChannels.CHECK_NOW)({ sender: {} })).resolves.toMatchObject({
      state: 'needs_login',
      email: 'user@example.com',
    });
    expect(manager.checkNow).toHaveBeenCalledTimes(1);
  });
});
