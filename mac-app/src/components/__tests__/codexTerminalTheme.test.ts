import { describe, expect, it, vi } from 'vitest';
import {
  CODEX_TERMINAL_DARK_MODE_STORAGE_KEY,
  CODEX_TERMINAL_DARK_MODE_SYNC_EVENT,
  dispatchCodexTerminalDarkModeSync,
  getLinkedCodexTerminalDarkModeUpdate,
  readStoredCodexTerminalDarkMode,
  writeStoredCodexTerminalDarkMode,
} from '../codexTerminalTheme';

describe('codex terminal theme sync', () => {
  it('toggles the terminal with the library when their modes match', () => {
    expect(getLinkedCodexTerminalDarkModeUpdate(false, false)).toBe(true);
    expect(getLinkedCodexTerminalDarkModeUpdate(true, true)).toBe(false);
  });

  it('leaves the terminal alone when it differs from the library', () => {
    expect(getLinkedCodexTerminalDarkModeUpdate(false, true)).toBeNull();
    expect(getLinkedCodexTerminalDarkModeUpdate(true, false)).toBeNull();
  });

  it('reads and writes the persisted terminal mode', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        values.set(key, value);
      }),
    };

    expect(readStoredCodexTerminalDarkMode(true, storage)).toBe(true);
    writeStoredCodexTerminalDarkMode(false, storage);

    expect(storage.setItem).toHaveBeenCalledWith(CODEX_TERMINAL_DARK_MODE_STORAGE_KEY, 'false');
    expect(readStoredCodexTerminalDarkMode(true, storage)).toBe(false);
  });

  it('dispatches terminal theme sync events with the requested mode', () => {
    const target = { dispatchEvent: vi.fn() };

    dispatchCodexTerminalDarkModeSync(true, target);

    const event = target.dispatchEvent.mock.calls[0][0] as CustomEvent<{ darkMode: boolean }>;
    expect(event.type).toBe(CODEX_TERMINAL_DARK_MODE_SYNC_EVENT);
    expect(event.detail.darkMode).toBe(true);
  });
});
