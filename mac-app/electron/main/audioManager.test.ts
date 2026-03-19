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
    setDefaultInput: ReturnType<typeof vi.fn>;
    removeListener: EventEmitter['removeListener'];
  };
  helper.setDefaultInput = vi.fn();

  const manager = new AudioManager(helper as any) as any;
  manager.devices = [
    { id: 'priority-mic', name: 'Priority Mic', isInput: true },
    { id: 'other-mic', name: 'Other Mic', isInput: true },
  ];
  manager.priorityMode = true;
  manager.priorityDeviceId = 'priority-mic';
  manager.defaultInputId = 'other-mic';

  return { manager, helper };
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
    await Promise.resolve();

    expect(helper.setDefaultInput).toHaveBeenCalledWith('priority-mic');
    expect(deviceEnforced).not.toHaveBeenCalled();

    helper.emit('defaultInputChanged', 'priority-mic');

    await vi.advanceTimersByTimeAsync(249);
    expect(deviceEnforced).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await expect(enforcePromise).resolves.toBeUndefined();
    expect(deviceEnforced).toHaveBeenCalledTimes(1);
  });

  it('falls back after a timeout if CoreAudio never reports the new default input', async () => {
    vi.useFakeTimers();
    const { manager, helper } = createManagerHarness();
    const deviceEnforced = vi.fn();
    manager.on('deviceEnforced', deviceEnforced);

    const enforcePromise = manager.ensurePriorityEnforced();
    await Promise.resolve();

    expect(helper.setDefaultInput).toHaveBeenCalledWith('priority-mic');

    await vi.advanceTimersByTimeAsync(1499);
    expect(deviceEnforced).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await expect(enforcePromise).resolves.toBeUndefined();
    expect(deviceEnforced).toHaveBeenCalledTimes(1);
  });
});
