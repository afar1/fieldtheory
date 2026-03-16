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

import { SquaresManager, resolveHeight } from './squaresManager';

function createManager(configOverrides: Record<string, any> = {}): SquaresManager {
  const preferences = {
    getPreference: vi.fn((key: string) => {
      if (key === 'squaresConfig') return configOverrides;
      return undefined;
    }),
    save: vi.fn(async () => undefined),
  };
  return new SquaresManager(preferences as any, {} as any);
}

describe('SquaresManager keyboard shortcuts', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('keeps keyboard shortcut registration disabled and only clears stale registrations', () => {
    const manager = createManager();

    (manager as any).registeredHotkeys.set('leftHalf', 'Alt+Left');

    manager.registerHotkeys();

    expect(testState.unregister).toHaveBeenCalledWith('Alt+Left');
    expect(testState.register).not.toHaveBeenCalled();
    expect((manager as any).registeredHotkeys.size).toBe(0);
  });
});

describe('resolveHeight', () => {
  it('returns percentage of screen height when keepHeight is false', () => {
    expect(resolveHeight(400, 1000, false, 80)).toBe(800);
    expect(resolveHeight(400, 1000, false, 50)).toBe(500);
    expect(resolveHeight(400, 1080, false, 100)).toBe(1080);
  });

  it('returns current window height when keepHeight is true', () => {
    expect(resolveHeight(400, 1000, true, 80)).toBe(400);
    expect(resolveHeight(600, 1000, true, 50)).toBe(600);
  });

  it('floors fractional pixel values', () => {
    expect(resolveHeight(400, 1080, false, 80)).toBe(864);
    expect(resolveHeight(400, 1080, false, 30)).toBe(324);
    // 999 * 0.33 = 329.67 → 329
    expect(resolveHeight(400, 999, false, 33)).toBe(329);
  });

  it('clamps percentage to minimum 10% to prevent degenerate windows', () => {
    // 0% would give zero height — clamped to 10%
    expect(resolveHeight(400, 1000, false, 0)).toBe(100);
    // Negative values also clamped
    expect(resolveHeight(400, 1000, false, -50)).toBe(100);
    // 5% below minimum — clamped to 10%
    expect(resolveHeight(400, 1000, false, 5)).toBe(100);
    // 10% is exactly the minimum — no clamp
    expect(resolveHeight(400, 1000, false, 10)).toBe(100);
    // 11% above minimum — no clamp
    expect(resolveHeight(400, 1000, false, 11)).toBe(110);
  });

  it('ignores percentage entirely when keepHeight is true', () => {
    // Even degenerate percentages don't matter when keeping height
    expect(resolveHeight(400, 1000, true, 0)).toBe(400);
    expect(resolveHeight(400, 1000, true, -999)).toBe(400);
  });
});

describe('SquaresManager config-driven layout heights', () => {
  const screen = { x: 0, y: 0, width: 1920, height: 1080 };

  function makeWindow(id: number, height: number) {
    return {
      windowId: id,
      ownerName: 'TestApp',
      ownerPID: 100,
      ownerBundleId: 'com.test',
      title: `Window ${id}`,
      frame: { x: 100, y: 100, width: 800, height },
      isOnScreen: true,
      layer: 0,
    };
  }

  it('horizontal spread preserves window height by default (horizontalKeepHeight: true)', () => {
    const manager = createManager({ horizontalKeepHeight: true });
    const windows = [makeWindow(1, 500), makeWindow(2, 700)];
    const screenInfo = { id: 1, frame: screen, visibleFrame: screen, isPrimary: true };

    const frames = (manager as any).calculateHorizontalSpread(windows, screenInfo);

    expect(frames[0].height).toBe(500);
    expect(frames[1].height).toBe(700);
  });

  it('horizontal spread uses percentage height when keepHeight is false', () => {
    const manager = createManager({ horizontalKeepHeight: false, horizontalHeightPercent: 60 });
    const windows = [makeWindow(1, 500), makeWindow(2, 700)];
    const screenInfo = { id: 1, frame: screen, visibleFrame: screen, isPrimary: true };

    const frames = (manager as any).calculateHorizontalSpread(windows, screenInfo);

    const expected = Math.floor(1080 * 0.6); // 648
    expect(frames[0].height).toBe(expected);
    expect(frames[1].height).toBe(expected);
  });

  it('horizontal spread centers windows vertically regardless of height mode', () => {
    const manager = createManager({ horizontalKeepHeight: false, horizontalHeightPercent: 50 });
    const windows = [makeWindow(1, 500)];
    const screenInfo = { id: 1, frame: screen, visibleFrame: screen, isPrimary: true };

    const frames = (manager as any).calculateHorizontalSpread(windows, screenInfo);

    const expectedH = Math.floor(1080 * 0.5); // 540
    expect(frames[0].height).toBe(expectedH);
    expect(frames[0].y).toBe(Math.round((1080 - expectedH) / 2));
  });

  it('focus config defaults produce 80% height (backwards compatible)', () => {
    const manager = createManager(); // no overrides — defaults apply
    const config = manager.getConfig();
    expect(config.focusHeightPercent).toBe(80);
    expect(config.focusKeepHeight).toBe(false);
    expect(config.horizontalKeepHeight).toBe(true);
  });
});

describe('SquaresManager command launcher execution', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('allows launcher-triggered window actions when window management is off but launcher visibility is enabled', async () => {
    const manager = createManager({ enabled: false, showInCommandLauncher: true });
    const executeGridAction = vi.spyOn(manager as any, 'executeGridAction').mockResolvedValue(true);

    const result = await manager.executeAction('grid', { source: 'command-launcher' });

    expect(result).toBe(true);
    expect(executeGridAction).toHaveBeenCalledOnce();
  });

  it('blocks launcher-triggered window actions when portable command visibility is disabled', async () => {
    const manager = createManager({ enabled: false, showInCommandLauncher: false });
    const executeGridAction = vi.spyOn(manager as any, 'executeGridAction').mockResolvedValue(true);

    const result = await manager.executeAction('grid', { source: 'command-launcher' });

    expect(result).toBe(false);
    expect(executeGridAction).not.toHaveBeenCalled();
  });

  it('still blocks non-launcher execution when window management is off', async () => {
    const manager = createManager({ enabled: false, showInCommandLauncher: true });
    const executeGridAction = vi.spyOn(manager as any, 'executeGridAction').mockResolvedValue(true);

    const result = await manager.executeAction('grid');

    expect(result).toBe(false);
    expect(executeGridAction).not.toHaveBeenCalled();
  });
});
