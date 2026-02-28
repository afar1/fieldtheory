import { afterEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({
  register: vi.fn(),
  unregister: vi.fn(),
}));

vi.mock('electron', () => ({
  screen: {},
  globalShortcut: {
    register: testState.register,
    unregister: testState.unregister,
  },
}));

vi.mock('./logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { SquaresManager } from './squaresManager';

describe('SquaresManager keyboard shortcuts', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('keeps keyboard shortcut registration disabled and only clears stale registrations', () => {
    const preferences = {
      getPreference: vi.fn(() => undefined),
      save: vi.fn(async () => undefined),
    };
    const nativeHelper = {};
    const manager = new SquaresManager(preferences as any, nativeHelper as any);

    (manager as any).registeredHotkeys.set('leftHalf', 'Alt+Left');

    manager.registerHotkeys();

    expect(testState.unregister).toHaveBeenCalledWith('Alt+Left');
    expect(testState.register).not.toHaveBeenCalled();
    expect((manager as any).registeredHotkeys.size).toBe(0);
  });
});
