import { afterEach, describe, expect, it, vi } from 'vitest';
import { CoalescedRefresh } from './coalescedRefresh';

afterEach(() => vi.useRealTimers());

describe('coalesced refresh', () => {
  it('combines a burst of notifications into one refresh', async () => {
    vi.useFakeTimers();
    const refresh = vi.fn().mockResolvedValue(undefined);
    const queue = new CoalescedRefresh(refresh, vi.fn());
    for (let i = 0; i < 100; i++) queue.schedule();
    await vi.advanceTimersByTimeAsync(99);
    expect(refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('does not postpone refresh indefinitely when notifications keep arriving', async () => {
    vi.useFakeTimers();
    const refresh = vi.fn().mockResolvedValue(undefined);
    const queue = new CoalescedRefresh(refresh, vi.fn());
    queue.schedule();
    await vi.advanceTimersByTimeAsync(80);
    queue.schedule();
    await vi.advanceTimersByTimeAsync(20);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('shares immediate requests and performs one follow-up for in-flight changes', async () => {
    const resolvers: Array<() => void> = [];
    let active = 0;
    let maximum = 0;
    const refresh = vi.fn(async () => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise<void>(resolve => resolvers.push(resolve));
      active--;
    });
    const queue = new CoalescedRefresh(refresh, vi.fn());
    const running = queue.run();
    expect(queue.run()).toBe(running);
    await Promise.resolve();
    for (let i = 0; i < 100; i++) queue.schedule();
    resolvers.shift()!();
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
    resolvers.shift()!();
    await running;
    expect(maximum).toBe(1);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('recovers after an error and cancels queued work on cleanup', async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const refresh = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const queue = new CoalescedRefresh(refresh, onError);
    await queue.run();
    expect(onError).toHaveBeenCalledTimes(1);
    await queue.run();
    queue.schedule();
    queue.cancelPending();
    await vi.runAllTimersAsync();
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
