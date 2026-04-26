import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';

vi.mock('./logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { AudioManager } from './audioManager';

function createManagerHarness() {
  const helper = new EventEmitter() as EventEmitter & {
    getDevices: ReturnType<typeof vi.fn>;
    getDefaultInput: ReturnType<typeof vi.fn>;
    setDefaultInput: ReturnType<typeof vi.fn>;
    removeListener: EventEmitter['removeListener'];
  };
  let manager: any;
  helper.getDevices = vi.fn(async () => manager.devices);
  helper.getDefaultInput = vi.fn(async () => manager.defaultInputId);
  helper.setDefaultInput = vi.fn();

  manager = new AudioManager(helper as any) as any;
  manager.devices = [
    { id: 'priority-mic', name: 'Priority Mic', isInput: true },
    { id: 'other-mic', name: 'Other Mic', isInput: true },
  ];
  manager.priorityMode = true;
  manager.priorityDeviceId = 'priority-mic';
  manager.defaultInputId = 'other-mic';

  return { manager, helper };
}

async function flushAsyncWork() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('AudioManager priority enforcement', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('waits for the default input change event before emitting deviceEnforced', async () => {
    vi.useFakeTimers();
    const { manager, helper } = createManagerHarness();
    const deviceEnforced = vi.fn();
    manager.on('deviceEnforced', deviceEnforced);

    const enforcePromise = manager.ensurePriorityEnforced();
    await flushAsyncWork();

    expect(helper.setDefaultInput).toHaveBeenCalledWith('priority-mic');
    expect(deviceEnforced).not.toHaveBeenCalled();

    helper.emit('defaultInputChanged', 'priority-mic');

    await vi.advanceTimersByTimeAsync(249);
    expect(deviceEnforced).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await expect(enforcePromise).resolves.toBeUndefined();
    expect(deviceEnforced).toHaveBeenCalledTimes(1);
  });

  it('does not mark a timed out switch as enforced unless the default input changed', async () => {
    vi.useFakeTimers();
    const { manager, helper } = createManagerHarness();
    const deviceEnforced = vi.fn();
    manager.on('deviceEnforced', deviceEnforced);

    const enforcePromise = manager.ensurePriorityEnforced();
    await flushAsyncWork();

    expect(helper.setDefaultInput).toHaveBeenCalledWith('priority-mic');

    await vi.advanceTimersByTimeAsync(1499);
    expect(deviceEnforced).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await expect(enforcePromise).resolves.toBeUndefined();
    expect(deviceEnforced).not.toHaveBeenCalled();
    expect(manager.getState().defaultInputId).toBe('other-mic');
  });

  it('accepts a timed out switch when refresh confirms the default input changed', async () => {
    vi.useFakeTimers();
    const { manager, helper } = createManagerHarness();
    const deviceEnforced = vi.fn();
    manager.on('deviceEnforced', deviceEnforced);
    helper.getDefaultInput.mockResolvedValue('priority-mic');

    const enforcePromise = manager.ensurePriorityEnforced();
    await flushAsyncWork();

    expect(helper.setDefaultInput).toHaveBeenCalledWith('priority-mic');

    await vi.advanceTimersByTimeAsync(1500);
    await expect(enforcePromise).resolves.toBeUndefined();
    expect(deviceEnforced).toHaveBeenCalledTimes(1);
    expect(manager.getState().defaultInputId).toBe('priority-mic');
  });

  it('clears a missing priority device before enforcing it', async () => {
    const { manager, helper } = createManagerHarness();
    const onPriorityChanged = vi.fn();
    const priorityDeviceUnavailable = vi.fn();
    manager.setOnPriorityChanged(onPriorityChanged);
    manager.on('priorityDeviceUnavailable', priorityDeviceUnavailable);
    helper.getDevices.mockResolvedValue([{ id: 'other-mic', name: 'Other Mic', isInput: true }]);

    await manager.ensurePriorityEnforced();

    expect(helper.setDefaultInput).not.toHaveBeenCalled();
    expect(onPriorityChanged).toHaveBeenCalledWith(null);
    expect(priorityDeviceUnavailable).toHaveBeenCalledWith('priority-mic');
    expect(manager.getState().priorityDeviceId).toBeNull();
    expect(manager.getState().priorityMode).toBe(false);
  });

  it('clears priority if the device disappears while waiting for the switch', async () => {
    vi.useFakeTimers();
    const { manager, helper } = createManagerHarness();
    const onPriorityChanged = vi.fn();
    const deviceEnforced = vi.fn();
    const priorityDeviceUnavailable = vi.fn();
    manager.setOnPriorityChanged(onPriorityChanged);
    manager.on('deviceEnforced', deviceEnforced);
    manager.on('priorityDeviceUnavailable', priorityDeviceUnavailable);
    helper.getDevices
      .mockResolvedValueOnce(manager.devices)
      .mockResolvedValueOnce([{ id: 'other-mic', name: 'Other Mic', isInput: true }]);

    const enforcePromise = manager.ensurePriorityEnforced();
    await flushAsyncWork();

    expect(helper.setDefaultInput).toHaveBeenCalledWith('priority-mic');

    await vi.advanceTimersByTimeAsync(1500);
    await expect(enforcePromise).resolves.toBeUndefined();
    expect(deviceEnforced).not.toHaveBeenCalled();
    expect(onPriorityChanged).toHaveBeenCalledWith(null);
    expect(priorityDeviceUnavailable).toHaveBeenCalledWith('priority-mic');
    expect(manager.getState().priorityDeviceId).toBeNull();
    expect(manager.getState().priorityMode).toBe(false);
  });
});
