import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppShutdown } from './appShutdown';

afterEach(() => vi.useRealTimers());

describe('AppShutdown', () => {
  it('shares one cleanup pass across repeated quit requests and waits for completion', async () => {
    let finish!: () => void;
    const stop = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const shutdown = new AppShutdown([{ name: 'speech', run: stop }], vi.fn());
    const first = shutdown.run();
    expect(shutdown.run()).toBe(first);
    await Promise.resolve();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(shutdown.complete).toBe(false);
    finish();
    await first;
    expect(shutdown.complete).toBe(true);
    await shutdown.run();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('starts independent cleanup in order even when an earlier task throws or hangs', async () => {
    vi.useFakeTimers();
    const order: string[] = [];
    const report = vi.fn();
    const shutdown = new AppShutdown([
      { name: 'hot-mic', run: () => { order.push('hot-mic'); throw new Error('cleanup failed'); } },
      { name: 'watchers', run: () => { order.push('watchers'); return new Promise(() => {}); } },
      { name: 'native-helper', run: () => { order.push('native-helper'); } },
      { name: 'http', run: () => Promise.reject(new Error('close failed')) },
    ], report, 100);
    const pending = shutdown.run();
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(['hot-mic', 'watchers', 'native-helper']);
    expect(shutdown.complete).toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    await pending;
    expect(shutdown.complete).toBe(true);
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ name: 'hot-mic', status: 'failed' }));
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ name: 'http', status: 'failed' }));
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ name: 'watchers', status: 'timed-out' }));
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ name: 'native-helper', status: 'completed' }));
  });

  it('does not report a timed-out flush as completed if it settles late', async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const report = vi.fn();
    const shutdown = new AppShutdown([
      { name: 'flush', run: () => new Promise<void>(resolve => { finish = resolve; }) },
    ], report, 100);
    const pending = shutdown.run();
    await vi.advanceTimersByTimeAsync(100);
    await pending;
    finish();
    await Promise.resolve();
    expect(report.mock.calls.map(([event]) => event.status)).toEqual(['started', 'timed-out']);
  });

  it('still cleans up if writing the shutdown log fails', async () => {
    const stop = vi.fn();
    const shutdown = new AppShutdown([{ name: 'speech', run: stop }], () => { throw new Error('disk full'); });
    await shutdown.run();
    expect(stop).toHaveBeenCalledOnce();
    expect(shutdown.complete).toBe(true);
  });
});
