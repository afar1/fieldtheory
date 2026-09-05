import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BookmarkSyncController, type QuickBookmarkSync } from './bookmarkSyncController';
const MINUTE = 60_000;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function setup(quick = vi.fn(async (_signal: AbortSignal): Promise<QuickBookmarkSync> => ({ status: 'synced' }))) {
  const options = { quick, isOnline: vi.fn(() => true), onChanged: vi.fn(), onState: vi.fn() };
  return { controller: new BookmarkSyncController(options), ...options };
}
describe('BookmarkSyncController', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-05T12:00:00Z')); });
  afterEach(() => { vi.useRealTimers(); });
  it('delays startup and polls idle accounts only every 15 minutes', async () => {
    const { controller, quick } = setup(); controller.start();
    await vi.advanceTimersByTimeAsync(9999); expect(quick).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(quick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(15 * MINUTE - 1); expect(quick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(quick).toHaveBeenCalledTimes(2); controller.stop();
  });
  it('shares one in-flight check across 100 entry requests', async () => {
    const pending = deferred<QuickBookmarkSync>();
    const { controller, quick } = setup(vi.fn((_signal: AbortSignal) => pending.promise)); controller.start();
    const first = controller.request();
    expect(Array.from({ length: 100 }, () => controller.request()).every((request) => request === first)).toBe(true);
    await Promise.resolve(); expect(quick).toHaveBeenCalledTimes(1);
    pending.resolve({ status: 'synced' }); await first;
    expect((await controller.request()).status).toBe('too-recent'); expect(quick).toHaveBeenCalledTimes(1); controller.stop();
  });
  it('backs active polling down to 5 then 15 minutes without interaction', async () => {
    const { controller, quick } = setup(); controller.start(); await controller.request();
    await vi.advanceTimersByTimeAsync(5 * MINUTE); expect(quick).toHaveBeenCalledTimes(6);
    await vi.advanceTimersByTimeAsync(5 * MINUTE - 1); expect(quick).toHaveBeenCalledTimes(6);
    await vi.advanceTimersByTimeAsync(1); expect(quick).toHaveBeenCalledTimes(7);
    await vi.advanceTimersByTimeAsync(20 * MINUTE);
    expect(new Date(controller.getState().nextCheckAt!).getTime() - Date.now()).toBe(15 * MINUTE); controller.stop();
  });
  it('timestamps no-change success without broadcasting a data reload', async () => {
    const { controller, onChanged, onState } = setup(); controller.start();
    const result = await controller.request();
    expect(result).toEqual({ status: 'synced', lastCheckedAt: new Date().toISOString() });
    expect(onChanged).not.toHaveBeenCalled();
    expect(onState).toHaveBeenCalledWith(expect.objectContaining({ phase: 'idle', lastCheckedAt: result.lastCheckedAt })); controller.stop();
  });
  it('honors rate limits despite foreground entry and preserves the last successful check', async () => {
    const { controller, quick } = setup(); controller.start(); const success = await controller.request();
    quick.mockResolvedValue({ status: 'rate_limited', retryAfterSec: 1800 });
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(controller.getState().phase).toBe('backoff'); expect(controller.getState().lastCheckedAt).toBe(success.lastCheckedAt);
    for (let i = 0; i < 5; i++) await controller.request();
    expect(quick).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(29 * MINUTE); expect(quick).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(MINUTE); expect(quick).toHaveBeenCalledTimes(3); controller.stop();
  });
  it('backs failures off exponentially and unsupported CLI checks off for six hours', async () => {
    const { controller, quick } = setup(vi.fn(async (_signal: AbortSignal): Promise<QuickBookmarkSync> => ({ status: 'error' })));
    controller.start(); await controller.request();
    await vi.advanceTimersByTimeAsync(MINUTE); expect(quick).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(MINUTE); expect(quick).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(MINUTE); expect(quick).toHaveBeenCalledTimes(3);
    quick.mockResolvedValue({ status: 'unsupported' }); await vi.advanceTimersByTimeAsync(4 * MINUTE);
    expect(controller.getState().phase).toBe('unsupported');
    expect(new Date(controller.getState().nextCheckAt!).getTime() - Date.now()).toBe(6 * 60 * MINUTE); controller.stop();
  });
  it('does no process work offline and checks after connectivity returns', async () => {
    const { controller, quick, isOnline } = setup(); isOnline.mockReturnValue(false); controller.start();
    await vi.advanceTimersByTimeAsync(3 * MINUTE); expect(quick).not.toHaveBeenCalled(); expect(controller.getState().phase).toBe('offline');
    isOnline.mockReturnValue(true); await vi.advanceTimersByTimeAsync(MINUTE); expect(quick).toHaveBeenCalledTimes(1); controller.stop();
  });
  it('aborts on suspend and ignores canceled completion, then resumes after wake', async () => {
    const pending = deferred<QuickBookmarkSync>();
    const { controller, quick, onChanged } = setup(vi.fn((_signal: AbortSignal) => pending.promise)); controller.start();
    const request = controller.request(); await Promise.resolve(); const signal = quick.mock.calls[0][0];
    controller.suspend(); expect(signal.aborted).toBe(true);
    pending.resolve({ status: 'synced', added: 1 }); expect((await request).status).toBe('unavailable'); expect(onChanged).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60 * MINUTE); expect(quick).toHaveBeenCalledTimes(1);
    quick.mockResolvedValue({ status: 'synced' }); controller.resume(); await vi.advanceTimersByTimeAsync(3000); expect(quick).toHaveBeenCalledTimes(2);
    controller.stop(); await vi.advanceTimersByTimeAsync(60 * MINUTE); expect(quick).toHaveBeenCalledTimes(2);
  });
  it('defers bounded media work and never overlaps it with metadata checks', async () => {
    const pending = deferred<{ remaining?: boolean }>();
    const quick = vi.fn(async (): Promise<QuickBookmarkSync> => ({ status: 'synced', added: 1 }));
    const maintenance = vi.fn(() => pending.promise);
    const controller = new BookmarkSyncController({ quick, maintenance, isOnline: () => true, onChanged: vi.fn(), onState: vi.fn() });
    controller.start(); await controller.request();
    await vi.advanceTimersByTimeAsync(29_999); expect(maintenance).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(maintenance).toHaveBeenCalledTimes(1);
    expect((await controller.request()).status).toBe('too-recent');
    await vi.advanceTimersByTimeAsync(40_000); expect(quick).toHaveBeenCalledTimes(1);
    const duringMedia = controller.request();
    pending.resolve({ remaining: true }); await duringMedia; await vi.advanceTimersByTimeAsync(0);
    expect(quick).toHaveBeenCalledTimes(2); expect(maintenance).toHaveBeenCalledTimes(1); controller.stop();
  });
  it('preempts optional media for a due foreground check and publishes no no-op media change', async () => {
    let mediaSignal: AbortSignal | undefined;
    const pending = deferred<{ remaining?: boolean; changed?: boolean }>();
    const quick = vi.fn(async (): Promise<QuickBookmarkSync> => ({ status: 'synced', added: 1 }));
    const onChanged = vi.fn();
    const maintenance = vi.fn((signal: AbortSignal) => { mediaSignal = signal; return pending.promise; });
    const controller = new BookmarkSyncController({ quick, maintenance, isOnline: () => true, onChanged, onState: vi.fn() });
    controller.start(); await controller.request();
    await vi.advanceTimersByTimeAsync(MINUTE);
    const foreground = controller.request();
    expect(mediaSignal!.aborted).toBe(true);
    expect(quick).toHaveBeenCalledTimes(1);
    pending.resolve({ changed: false });
    expect((await foreground).status).toBe('synced');
    expect(quick).toHaveBeenCalledTimes(2);
    expect(onChanged).toHaveBeenCalledTimes(2);
    controller.stop();
  });

  it('restores pending maintenance and a truthful check timestamp after restart', async () => {
    let saved: unknown;
    const stateStore = { load: () => saved, save: (value: unknown) => { saved = value; } };
    const first = new BookmarkSyncController({ quick: async () => ({ status: 'synced', added: 1 }), maintenance: async () => ({}), isOnline: () => true, onChanged: vi.fn(), onState: vi.fn(), stateStore });
    first.start(); await first.request();
    const checked = first.getState().lastCheckedAt; first.stop();
    const maintenance = vi.fn(async () => ({}));
    const second = new BookmarkSyncController({ quick: async () => ({ status: 'synced' }), maintenance, isOnline: () => true, onChanged: vi.fn(), onState: vi.fn(), stateStore });
    expect(second.getState().lastCheckedAt).toBe(checked);
    second.start(); await vi.advanceTimersByTimeAsync(MINUTE + 1);
    expect(maintenance).toHaveBeenCalledExactlyOnceWith(expect.any(AbortSignal), { index: true });
    expect(saved).toMatchObject({ pendingMaintenance: false, needsIndex: false });
    second.stop();
  });

  it('retains rate-limit backoff across restart without repeatedly writing timer state', async () => {
    let saved: unknown;
    const save = vi.fn((value: unknown) => { saved = value; });
    const stateStore = { load: () => saved, save };
    const first = new BookmarkSyncController({ quick: async () => ({ status: 'rate_limited', retryAfterSec: 1800 }), isOnline: () => true, onChanged: vi.fn(), onState: vi.fn(), stateStore });
    first.start(); await first.request(); first.stop(); save.mockClear();
    const quick = vi.fn(async (): Promise<QuickBookmarkSync> => ({ status: 'synced' }));
    const second = new BookmarkSyncController({ quick, isOnline: () => true, onChanged: vi.fn(), onState: vi.fn(), stateStore });
    expect(second.getState().phase).toBe('backoff'); second.start();
    await vi.advanceTimersByTimeAsync(10_000);
    await second.request(); await second.request();
    expect(quick).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30 * MINUTE);
    expect(quick).toHaveBeenCalledTimes(1); second.stop();
  });
});
