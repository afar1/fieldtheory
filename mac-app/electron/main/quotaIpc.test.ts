import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QuotaIPCChannels, registerQuotaIpc } from './quotaIpc';
import type { QuotaManager } from './quotaManager';

describe('quotaIpc', () => {
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

  function register(getQuotaManager: () => QuotaManager | null, overrides: Partial<Parameters<typeof registerQuotaIpc>[0]> = {}) {
    registerQuotaIpc({
      ipcMain: ipcMain as any,
      getQuotaManager,
      ...overrides,
    });
  }

  function handler(channel: string) {
    const registered = handlers.get(channel);
    expect(registered).toBeDefined();
    return registered!;
  }

  it('registers the existing public quota channel names', () => {
    register(() => null);

    expect([...handlers.keys()]).toEqual([
      'quota:getQuotas',
      'quota:checkQuota',
      'quota:getFormattedUsage',
      'quota:getResetDate',
      'quota:getDaysUntilReset',
      'quota:getLimits',
      'quota:refreshTier',
    ]);
  });

  it('returns permissive defaults when the manager is unavailable', async () => {
    register(() => null);

    await expect(handler(QuotaIPCChannels.GET_QUOTAS)({ sender: {} })).resolves.toBeNull();
    await expect(handler(QuotaIPCChannels.CHECK_QUOTA)({ sender: {} }, 'priorityMic')).resolves.toMatchObject({
      allowed: true,
      limit: Infinity,
    });
    await expect(handler(QuotaIPCChannels.GET_FORMATTED_USAGE)({ sender: {} })).resolves.toMatchObject({
      priorityMic: 'Unlimited',
    });
    await expect(handler(QuotaIPCChannels.GET_DAYS_UNTIL_RESET)({ sender: {} })).resolves.toBe(0);
    await expect(handler(QuotaIPCChannels.GET_LIMITS)({ sender: {} })).resolves.toMatchObject({
      priorityMicMinutes: Infinity,
    });
    await expect(handler(QuotaIPCChannels.REFRESH_TIER)({ sender: {} })).resolves.toEqual({
      tier: 'free',
      error: 'Not initialized',
    });
  });

  it('maps renderer feature names to quota database feature names', async () => {
    const manager = {
      getFeatureStatus: vi.fn(() => ({ allowed: true, used: 10, limit: 20, remaining: 10, percentUsed: 50 })),
    } as unknown as QuotaManager;
    register(() => manager);

    await expect(handler(QuotaIPCChannels.CHECK_QUOTA)({ sender: {} }, 'portableCommands')).resolves.toMatchObject({
      used: 10,
      remaining: 10,
    });
    expect(manager.getFeatureStatus).toHaveBeenCalledWith('portable_commands');
  });

  it('returns formatted usage and converted limits from the manager', async () => {
    const manager = {
      formatPriorityMicUsage: vi.fn(() => '2 min'),
      formatAutoStackUsage: vi.fn(() => '1 session'),
      formatTextImproveUsage: vi.fn(() => '10 words'),
      formatPortableCommandsUsage: vi.fn(() => '3 commands'),
      getDaysUntilReset: vi.fn(() => 9),
      getLimits: vi.fn(() => ({
        priority_mic_seconds: 180,
        auto_stack_sessions: 5,
        text_improve_words: 100,
        portable_commands: 7,
      })),
    } as unknown as QuotaManager;
    register(() => manager);

    await expect(handler(QuotaIPCChannels.GET_FORMATTED_USAGE)({ sender: {} })).resolves.toMatchObject({
      priorityMic: '2 min',
      portableCommands: '3 commands',
    });
    await expect(handler(QuotaIPCChannels.GET_DAYS_UNTIL_RESET)({ sender: {} })).resolves.toBe(9);
    await expect(handler(QuotaIPCChannels.GET_LIMITS)({ sender: {} })).resolves.toMatchObject({
      priorityMicMinutes: 3,
      portableCommands: 7,
    });
  });

  it('refreshes tier and broadcasts changes', async () => {
    const broadcastTierChanged = vi.fn();
    const manager = {
      syncFromServer: vi.fn(async () => {}),
      getCachedTier: vi.fn(() => 'pro'),
    } as unknown as QuotaManager;
    register(() => manager, { broadcastTierChanged });

    await expect(handler(QuotaIPCChannels.REFRESH_TIER)({ sender: {} })).resolves.toEqual({
      tier: 'pro',
      error: null,
    });
    expect(broadcastTierChanged).toHaveBeenCalledWith('pro');
  });
});
