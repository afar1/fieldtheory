import { beforeEach, describe, expect, it, vi } from 'vitest';

const { globalShortcut } = vi.hoisted(() => ({
  globalShortcut: {
    register: vi.fn(() => true),
    unregister: vi.fn(),
    unregisterAll: vi.fn(),
    isRegistered: vi.fn(() => false),
  },
}));

vi.mock('electron', () => ({
  globalShortcut,
}));

vi.mock('./logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { HOTKEY_CONFIGS, HotkeyManager } from './hotkeyManager';

beforeEach(() => {
  vi.clearAllMocks();
  globalShortcut.register.mockReturnValue(true);
});

describe('HotkeyManager config', () => {
  it('does not expose the removed improveText hotkey', () => {
    expect(Object.prototype.hasOwnProperty.call(HOTKEY_CONFIGS, 'improveText')).toBe(false);
  });
});

describe('HotkeyManager policy', () => {
  it('rejects reserved standard shortcuts', () => {
    const manager = new HotkeyManager();

    const result = manager.register('superPaste', 'Command+C', vi.fn());

    expect(result).toEqual({
      success: false,
      error: 'Shortcut is reserved by standard macOS behavior.',
    });
    expect(globalShortcut.register).not.toHaveBeenCalled();
  });

  it('rejects modifier-less shortcuts for non-exempt hotkeys', () => {
    const manager = new HotkeyManager();

    const result = manager.register('superPaste', '\\', vi.fn());

    expect(result).toEqual({
      success: false,
      error: 'Global shortcuts must include Command, Control, or Alt. Shift alone is not enough.',
    });
    expect(globalShortcut.register).not.toHaveBeenCalled();
  });

  it('allows modifier-less shortcuts for transcription hotkeys', () => {
    const manager = new HotkeyManager();

    const result = manager.register('transcription', '\\', vi.fn());

    expect(result).toEqual({ success: true });
    expect(globalShortcut.register).toHaveBeenCalledWith('\\', expect.any(Function));
  });

  it('allows non-reserved shortcuts with a real modifier', () => {
    const manager = new HotkeyManager();

    const result = manager.register('superPaste', 'Command+Shift+V', vi.fn());

    expect(result).toEqual({ success: true });
    expect(globalShortcut.register).toHaveBeenCalledWith('Command+Shift+V', expect.any(Function));
  });

  it('validates shortcut policy even before a callback exists', () => {
    const manager = new HotkeyManager();

    const result = manager.change('superPaste', 'Command+V');

    expect(result).toEqual({
      success: false,
      error: 'Shortcut is reserved by standard macOS behavior.',
    });
  });

  it('allows modifier-less shortcuts for secondary transcription and hotMic', () => {
    const manager = new HotkeyManager();

    expect(manager.register('transcriptionSecondary', '`', vi.fn())).toEqual({ success: true });
    expect(manager.register('hotMic', 'F13', vi.fn())).toEqual({ success: true });
  });

  it('rejects modifier-less shortcuts for screenshot and clipboard hotkeys', () => {
    const manager = new HotkeyManager();

    expect(manager.register('screenshot', 'A', vi.fn()).success).toBe(false);
    expect(manager.register('clipboardHistory', 'Space', vi.fn()).success).toBe(false);
  });
});

describe('HotkeyManager clearing', () => {
  it('unregisters hotkey when changed to empty string', () => {
    const manager = new HotkeyManager();
    const cb = vi.fn();
    manager.register('transcription', 'Alt+K', cb);

    const result = manager.change('transcription', '');

    expect(result).toEqual({ success: true });
    expect(globalShortcut.unregister).toHaveBeenCalledWith('Alt+K');
    expect(manager.isRegistered('transcription')).toBe(false);
  });

  it('returns success for empty key registration (intentionally disabled)', () => {
    const manager = new HotkeyManager();

    const result = manager.register('transcription', '', vi.fn());

    expect(result).toEqual({ success: true });
    expect(globalShortcut.register).not.toHaveBeenCalled();
  });
});
