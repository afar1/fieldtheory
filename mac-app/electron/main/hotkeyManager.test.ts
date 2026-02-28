import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  globalShortcut: {
    register: vi.fn(() => true),
    unregister: vi.fn(),
    unregisterAll: vi.fn(),
    isRegistered: vi.fn(() => false),
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

import { HOTKEY_CONFIGS } from './hotkeyManager';

describe('HotkeyManager config', () => {
  it('does not expose the removed improveText hotkey', () => {
    expect(Object.prototype.hasOwnProperty.call(HOTKEY_CONFIGS, 'improveText')).toBe(false);
  });
});
