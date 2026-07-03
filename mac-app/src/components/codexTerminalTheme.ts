export const CODEX_TERMINAL_DARK_MODE_STORAGE_KEY = 'fieldtheory.codexTerminal.darkMode';
export const CODEX_TERMINAL_DARK_MODE_SYNC_EVENT = 'fieldtheory:codex-terminal-dark-mode-sync';

type CodexTerminalDarkModeSyncDetail = {
  darkMode: boolean;
};

export type CodexTerminalDarkModeSyncEvent = CustomEvent<CodexTerminalDarkModeSyncDetail>;

export function readStoredCodexTerminalDarkMode(fallback: boolean, storage: Pick<Storage, 'getItem'> = localStorage): boolean {
  const stored = storage.getItem(CODEX_TERMINAL_DARK_MODE_STORAGE_KEY);
  return stored === null ? fallback : stored === 'true';
}

export function writeStoredCodexTerminalDarkMode(darkMode: boolean, storage: Pick<Storage, 'setItem'> = localStorage): void {
  storage.setItem(CODEX_TERMINAL_DARK_MODE_STORAGE_KEY, String(darkMode));
}

export function getLinkedCodexTerminalDarkModeUpdate(libraryDarkMode: boolean, terminalDarkMode: boolean): boolean | null {
  return terminalDarkMode === libraryDarkMode ? !libraryDarkMode : null;
}

export function dispatchCodexTerminalDarkModeSync(darkMode: boolean, target: Pick<Window, 'dispatchEvent'> = window): void {
  target.dispatchEvent(new CustomEvent<CodexTerminalDarkModeSyncDetail>(
    CODEX_TERMINAL_DARK_MODE_SYNC_EVENT,
    { detail: { darkMode } },
  ));
}
