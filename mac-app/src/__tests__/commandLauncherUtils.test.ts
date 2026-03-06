import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  formatHotkeyDisplay,
  formatTimeAgo,
  SQUARES_ACTION_DEFS,
  SQUARES_ACTION_IDS,
  DEFAULT_SQUARES_HOTKEYS,
} from '../commandLauncherUtils';

describe('formatHotkeyDisplay', () => {
  it('converts modifier names to symbols', () => {
    expect(formatHotkeyDisplay('Command+C')).toBe('⌘ C');
    expect(formatHotkeyDisplay('Cmd+V')).toBe('⌘ V');
    expect(formatHotkeyDisplay('Shift+A')).toBe('⇧ A');
    expect(formatHotkeyDisplay('Option+Space')).toBe('⌥ Space');
    expect(formatHotkeyDisplay('Alt+4')).toBe('⌥ 4');
    expect(formatHotkeyDisplay('Control+X')).toBe('⌃ X');
    expect(formatHotkeyDisplay('Ctrl+Z')).toBe('⌃ Z');
  });

  it('handles compound modifiers', () => {
    expect(formatHotkeyDisplay('Control+Alt+Shift+G')).toBe('⌃ ⌥ ⇧ G');
    expect(formatHotkeyDisplay('Shift+Command+V')).toBe('⇧ ⌘ V');
    expect(formatHotkeyDisplay('Control+Alt+Left')).toBe('⌃ ⌥ Left');
    expect(formatHotkeyDisplay('Control+Alt+Return')).toBe('⌃ ⌥ Return');
  });

  it('returns empty string for empty input', () => {
    expect(formatHotkeyDisplay('')).toBe('');
  });
});

describe('formatTimeAgo', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-05T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "just now" for less than a minute', () => {
    expect(formatTimeAgo(Date.now() - 30_000)).toBe('just now');
  });

  it('returns minutes ago', () => {
    expect(formatTimeAgo(Date.now() - 5 * 60_000)).toBe('5m ago');
    expect(formatTimeAgo(Date.now() - 59 * 60_000)).toBe('59m ago');
  });

  it('returns hours ago', () => {
    expect(formatTimeAgo(Date.now() - 3 * 3_600_000)).toBe('3h ago');
    expect(formatTimeAgo(Date.now() - 23 * 3_600_000)).toBe('23h ago');
  });

  it('returns "yesterday" for 1 day ago', () => {
    expect(formatTimeAgo(Date.now() - 86_400_000)).toBe('yesterday');
  });

  it('returns days ago for 2-6 days', () => {
    expect(formatTimeAgo(Date.now() - 3 * 86_400_000)).toBe('3d ago');
  });

  it('returns formatted date for 7+ days', () => {
    const result = formatTimeAgo(Date.now() - 10 * 86_400_000);
    expect(result).toMatch(/^[A-Z][a-z]+ \d+$/); // e.g. "Feb 23"
  });
});

describe('SQUARES_ACTION_DEFS', () => {
  it('has 10 window management actions', () => {
    expect(SQUARES_ACTION_DEFS).toHaveLength(10);
  });

  it('each action has a matching default hotkey', () => {
    for (const def of SQUARES_ACTION_DEFS) {
      expect(DEFAULT_SQUARES_HOTKEYS[def.actionId]).toBeDefined();
      expect(DEFAULT_SQUARES_HOTKEYS[def.actionId]).not.toBe('');
    }
  });

  it('each action has required fields', () => {
    for (const def of SQUARES_ACTION_DEFS) {
      expect(def.actionId).toBeTruthy();
      expect(def.name).toBeTruthy();
      expect(def.displayName).toBeTruthy();
      expect(def.keywords.length).toBeGreaterThan(0);
    }
  });

  it('has no duplicate actionIds', () => {
    const ids = SQUARES_ACTION_DEFS.map(d => d.actionId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('SQUARES_ACTION_IDS matches SQUARES_ACTION_DEFS', () => {
    expect(SQUARES_ACTION_IDS.size).toBe(SQUARES_ACTION_DEFS.length);
    for (const def of SQUARES_ACTION_DEFS) {
      expect(SQUARES_ACTION_IDS.has(def.actionId)).toBe(true);
    }
  });

  it('SQUARES_ACTION_IDS does not contain non-squares actions', () => {
    // These are built-in action IDs that should NOT be routed to squaresAPI
    const builtInActionIds = ['settings', 'take-screenshot', 'full-screen-screenshot',
      'active-window-screenshot', 'start-recording', 'super-paste', 'open-history', 'toggle-theme'];
    for (const id of builtInActionIds) {
      expect(SQUARES_ACTION_IDS.has(id)).toBe(false);
    }
  });
});
