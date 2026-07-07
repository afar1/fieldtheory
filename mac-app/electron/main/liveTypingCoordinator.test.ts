import { describe, expect, it, vi } from 'vitest';

import { LiveTypingCoordinator } from './liveTypingCoordinator';

async function flushMicrotasks(rounds = 4): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await Promise.resolve();
  }
}

describe('LiveTypingCoordinator', () => {
  it('types queued segments in FIFO order with a trailing space', async () => {
    const insertTextSegment = vi.fn(async () => ({ success: true }));
    const coordinator = new LiveTypingCoordinator({ insertTextSegment });

    coordinator.start('com.apple.TextEdit');
    coordinator.enqueueSegment('hello');
    coordinator.enqueueSegment('world');

    await expect(coordinator.finish()).resolves.toEqual({ typedSegmentCount: 2 });
    expect(insertTextSegment.mock.calls.map((call) => call.slice(0, 2))).toEqual([
      ['com.apple.TextEdit', 'hello '],
      ['com.apple.TextEdit', 'world '],
    ]);
  });

  it('buffers soft failures and flushes them when the target app returns frontmost', async () => {
    const insertTextSegment = vi
      .fn()
      .mockResolvedValueOnce({ success: false, reason: 'not-frontmost' })
      .mockResolvedValue({ success: true });
    const coordinator = new LiveTypingCoordinator({ insertTextSegment });

    coordinator.start('com.apple.TextEdit');
    coordinator.enqueueSegment('buffer me');
    await flushMicrotasks();

    expect(insertTextSegment).toHaveBeenCalledTimes(1);

    coordinator.notifyFrontmostChanged('com.apple.TextEdit');
    await expect(coordinator.finish()).resolves.toEqual({ typedSegmentCount: 1 });
    expect(insertTextSegment).toHaveBeenCalledTimes(2);
    expect(insertTextSegment).toHaveBeenLastCalledWith('com.apple.TextEdit', 'buffer me ');
  });

  it('does not call the helper while the target app is not frontmost', async () => {
    const insertTextSegment = vi.fn(async () => ({ success: true }));
    const coordinator = new LiveTypingCoordinator({ insertTextSegment });

    coordinator.start('com.apple.TextEdit');
    coordinator.notifyFrontmostChanged('com.apple.finder');
    coordinator.enqueueSegment('later');
    await flushMicrotasks();

    expect(insertTextSegment).not.toHaveBeenCalled();

    coordinator.notifyFrontmostChanged('com.apple.TextEdit');
    await expect(coordinator.finish()).resolves.toEqual({ typedSegmentCount: 1 });
    expect(insertTextSegment).toHaveBeenCalledWith('com.apple.TextEdit', 'later ');
  });

  it('degrades after three consecutive hard failures', async () => {
    const insertTextSegment = vi.fn(async () => ({ success: false, reason: 'post-failed' as const }));
    const traces: Array<{ event: string; data?: Record<string, unknown> }> = [];
    const coordinator = new LiveTypingCoordinator({
      insertTextSegment,
      onTrace: (event, data) => traces.push({ event, data }),
    });

    coordinator.start('com.apple.TextEdit');
    coordinator.enqueueSegment('first');
    coordinator.enqueueSegment('second');
    await flushMicrotasks();

    await expect(coordinator.finish()).resolves.toEqual({ typedSegmentCount: 0 });
    coordinator.enqueueSegment('ignored');

    expect(insertTextSegment).toHaveBeenCalledTimes(3);
    expect(traces.some((trace) => trace.event === 'liveTyping.degraded')).toBe(true);
  });

  it('ignores enqueue calls after finish starts', async () => {
    const insertTextSegment = vi.fn(async () => ({ success: true }));
    const coordinator = new LiveTypingCoordinator({ insertTextSegment });

    coordinator.start('com.apple.TextEdit');
    const finish = coordinator.finish();
    coordinator.enqueueSegment('too late');

    await expect(finish).resolves.toEqual({ typedSegmentCount: 0 });
    expect(insertTextSegment).not.toHaveBeenCalled();
  });

  it('drains queued segments without ending the session', async () => {
    const insertTextSegment = vi.fn(async () => ({ success: true }));
    const coordinator = new LiveTypingCoordinator({ insertTextSegment });

    coordinator.start('com.apple.TextEdit');
    coordinator.enqueueSegment('before submit');

    await expect(coordinator.drain()).resolves.toEqual({ typedSegmentCount: 1, bufferedSegmentCount: 0 });
    coordinator.enqueueSegment('after submit');

    await expect(coordinator.finish()).resolves.toEqual({ typedSegmentCount: 2 });
    expect(insertTextSegment.mock.calls.map((call) => call.slice(0, 2))).toEqual([
      ['com.apple.TextEdit', 'before submit '],
      ['com.apple.TextEdit', 'after submit '],
    ]);
  });

  it('leaves buffered text queued when drain runs while the target is away', async () => {
    const insertTextSegment = vi.fn(async () => ({ success: true }));
    const coordinator = new LiveTypingCoordinator({ insertTextSegment });

    coordinator.start('com.apple.TextEdit');
    coordinator.notifyFrontmostChanged('com.apple.finder');
    coordinator.enqueueSegment('wait');

    await expect(coordinator.drain()).resolves.toEqual({ typedSegmentCount: 0, bufferedSegmentCount: 1 });
    expect(insertTextSegment).not.toHaveBeenCalled();

    coordinator.notifyFrontmostChanged('com.apple.TextEdit');
    await expect(coordinator.finish()).resolves.toEqual({ typedSegmentCount: 1 });
    expect(insertTextSegment).toHaveBeenCalledWith('com.apple.TextEdit', 'wait ');
  });

  it('drops buffered text on cancel without untyping completed segments', async () => {
    const insertTextSegment = vi.fn(async () => ({ success: true }));
    const coordinator = new LiveTypingCoordinator({ insertTextSegment });

    coordinator.start('com.apple.TextEdit');
    coordinator.notifyFrontmostChanged('com.apple.finder');
    coordinator.enqueueSegment('drop me');
    coordinator.cancel();
    coordinator.notifyFrontmostChanged('com.apple.TextEdit');

    await expect(coordinator.finish()).resolves.toEqual({ typedSegmentCount: 0 });
    expect(insertTextSegment).not.toHaveBeenCalled();
  });
});
