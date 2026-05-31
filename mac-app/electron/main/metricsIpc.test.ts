import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MetricsIPCChannels, registerMetricsIpc } from './metricsIpc';
import type { MetricsManager, UserMetrics } from './metricsManager';

describe('metricsIpc', () => {
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

  function register(getMetricsManager: () => MetricsManager | null) {
    registerMetricsIpc({
      ipcMain: ipcMain as any,
      getMetricsManager,
    });
  }

  function handler(channel: string) {
    const registered = handlers.get(channel);
    expect(registered).toBeDefined();
    return registered!;
  }

  function metrics(overrides: Partial<UserMetrics> = {}): UserMetrics {
    return {
      transcriptions: 0,
      words_transcribed: 0,
      words_improved: 0,
      priority_mic_minutes: 0,
      verbal_commands: 0,
      command_launcher_uses: 0,
      clipboard_items: 0,
      pastes_used: 0,
      stacks_created: 0,
      autostacks_created: 0,
      stacks_pasted: 0,
      items_added_to_context: 0,
      sketches_created: 0,
      screenshots_taken: 0,
      librarian_artifacts_created: 0,
      librarian_artifacts_shared: 0,
      commands_executed: 0,
      commands_contributed: 0,
      feedback_given: 0,
      ...overrides,
    };
  }

  it('registers the existing public metrics channel names', () => {
    register(() => null);

    expect([...handlers.keys()]).toEqual([
      'metrics:getMetrics',
      'metrics:getMetricsWithStatus',
      'metrics:syncToSupabase',
      'metrics:fetchFromSupabase',
    ]);
  });

  it('returns default local metrics when the manager is unavailable', async () => {
    register(() => null);

    expect(handler(MetricsIPCChannels.GET_METRICS)({ sender: {} })).toMatchObject({
      transcriptions: 0,
      feedback_given: 0,
    });
    expect(handler(MetricsIPCChannels.GET_METRICS_WITH_STATUS)({ sender: {} })).toMatchObject({
      metrics: {
        transcriptions: 0,
      },
      lastSyncedAt: null,
      pendingSync: false,
    });
    await expect(handler(MetricsIPCChannels.SYNC_TO_SUPABASE)({ sender: {} })).resolves.toBe(false);
    await expect(handler(MetricsIPCChannels.FETCH_FROM_SUPABASE)({ sender: {} })).resolves.toBe(false);
  });

  it('delegates metrics reads to the manager', () => {
    const manager = {
      getMetrics: vi.fn(() => metrics({ transcriptions: 4, words_transcribed: 120 })),
      getMetricsWithStatus: vi.fn(() => ({
        metrics: metrics({ feedback_given: 2 }),
        lastSyncedAt: '2026-05-31T00:00:00.000Z',
        pendingSync: true,
      })),
      syncToSupabase: vi.fn(),
      fetchFromSupabase: vi.fn(),
    } as unknown as MetricsManager;
    register(() => manager);

    expect(handler(MetricsIPCChannels.GET_METRICS)({ sender: {} })).toMatchObject({
      transcriptions: 4,
      words_transcribed: 120,
    });
    expect(handler(MetricsIPCChannels.GET_METRICS_WITH_STATUS)({ sender: {} })).toMatchObject({
      metrics: {
        feedback_given: 2,
      },
      pendingSync: true,
    });
  });

  it('delegates Supabase sync operations to the manager', async () => {
    const manager = {
      getMetrics: vi.fn(),
      getMetricsWithStatus: vi.fn(),
      syncToSupabase: vi.fn(async () => true),
      fetchFromSupabase: vi.fn(async () => true),
    } as unknown as MetricsManager;
    register(() => manager);

    await expect(handler(MetricsIPCChannels.SYNC_TO_SUPABASE)({ sender: {} })).resolves.toBe(true);
    await expect(handler(MetricsIPCChannels.FETCH_FROM_SUPABASE)({ sender: {} })).resolves.toBe(true);
    expect(manager.syncToSupabase).toHaveBeenCalledTimes(1);
    expect(manager.fetchFromSupabase).toHaveBeenCalledTimes(1);
  });
});
