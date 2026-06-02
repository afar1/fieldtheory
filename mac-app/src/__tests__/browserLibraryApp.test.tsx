import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserLibraryApp, syncRendererStorage } from '../browser-library';
import {
  LINE_NUMBERS_STORAGE_KEY,
  RENDERED_BLOCK_CURSOR_OPACITY_CHANGED_EVENT,
  RENDERED_BLOCK_CURSOR_OPACITY_STORAGE_KEY,
  RENDERED_TEXT_CURSOR_STYLE_CHANGED_EVENT,
  RENDERED_TEXT_CURSOR_STYLE_STORAGE_KEY,
  SHARED_FILE_TOGGLE_HOTKEY_STORAGE_KEY,
  TEXT_CURSOR_BLINK_CHANGED_EVENT,
  TEXT_CURSOR_BLINK_STORAGE_KEY,
} from '../utils/editorShortcuts';

vi.mock('../contexts/ThemeContext', () => ({
  useTheme: () => ({
    theme: {
      accent: '#0f766e',
      bg: '#ffffff',
      bgSecondary: '#f9fafb',
      border: '#d1d5db',
      error: '#dc2626',
      text: '#111111',
      textSecondary: '#666666',
      isDark: false,
    },
  }),
}));

describe('BrowserLibraryApp', () => {
  let openMarkdownListener: ((target: unknown) => void) | null = null;

  beforeEach(() => {
    openMarkdownListener = null;
    const storage = new Map<string, string>();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: vi.fn((key: string) => storage.get(key) ?? null),
        setItem: vi.fn((key: string, value: string) => {
          storage.set(key, value);
        }),
        removeItem: vi.fn((key: string) => {
          storage.delete(key);
        }),
      },
    });
    Object.defineProperty(window, 'commandsAPI', {
      configurable: true,
      value: {
        onOpenMarkdownFromLauncher: vi.fn((callback: (target: unknown) => void) => {
          openMarkdownListener = callback;
          return () => {
            openMarkdownListener = null;
          };
        }),
        onLocalCommandStatus: vi.fn(() => vi.fn()),
        listMaxwellRuns: vi.fn(async () => []),
        getMaxwellMemory: vi.fn(async () => ({
          enabled: false,
          content: '',
          path: '',
          updatedAt: 0,
          maxChars: 12_000,
        })),
      },
    });
  });

  afterEach(() => {
    delete (window as any).commandsAPI;
    vi.restoreAllMocks();
  });

  it('mounts the real Browser shell footer and switches between Library and Commands surfaces', async () => {
    const ThemeProvider = ({ children }: { children: React.ReactNode }) => <>{children}</>;
    const LibrarianView = (props: {
      browserLibrarySurface?: boolean;
      onOpenCommandPath?: (path: string) => void;
    }) => (
      <div data-testid="library-view">
        <span>{props.browserLibrarySurface ? 'browser-library' : 'native-library'}</span>
        <button type="button" onClick={() => props.onOpenCommandPath?.('/tmp/Commands/plan.md')}>
          Open command
        </button>
      </div>
    );
    const CommandsView = (props: {
      initialCommandPath?: string | null;
      onSwitchToClipboard?: () => void;
    }) => (
      <div data-testid="commands-view">
        <span>{props.initialCommandPath ?? 'no-command'}</span>
        <button type="button" onClick={props.onSwitchToClipboard}>Back to Library</button>
      </div>
    );

    render(
      <BrowserLibraryApp
        LibrarianView={LibrarianView}
        CommandsView={CommandsView}
        ThemeProvider={ThemeProvider}
      />,
    );

    expect(screen.getByTestId('library-view')).toBeTruthy();
    expect(screen.getByText('browser-library')).toBeTruthy();
    expect(document.querySelector('[data-fieldtheory-browser-library-footer="true"]')).toBeTruthy();

    fireEvent.click(screen.getByText('Open command'));
    expect(await screen.findByTestId('commands-view')).toBeTruthy();
    expect(screen.getByText('/tmp/Commands/plan.md')).toBeTruthy();

    fireEvent.click(screen.getByText('Back to Library'));
    expect(await screen.findByTestId('library-view')).toBeTruthy();

    act(() => {
      openMarkdownListener?.({ kind: 'commands', path: 'commands' });
    });
    expect(await screen.findByTestId('commands-view')).toBeTruthy();

    act(() => {
      openMarkdownListener?.({ kind: 'library', path: 'library' });
    });
    await waitFor(() => expect(screen.getByTestId('library-view')).toBeTruthy());
  });

  it('syncs Library editor preference changes into the Browser Library view', async () => {
    const sharedHotkeyChanged = vi.fn();
    const cursorBlinkChanged = vi.fn();
    const cursorStyleChanged = vi.fn();
    const cursorOpacityChanged = vi.fn();
    window.addEventListener('fieldtheory:shared-file-toggle-hotkey-changed', sharedHotkeyChanged);
    window.addEventListener(TEXT_CURSOR_BLINK_CHANGED_EVENT, cursorBlinkChanged);
    window.addEventListener(RENDERED_TEXT_CURSOR_STYLE_CHANGED_EVENT, cursorStyleChanged);
    window.addEventListener(RENDERED_BLOCK_CURSOR_OPACITY_CHANGED_EVENT, cursorOpacityChanged);

    await syncRendererStorage(async () => ({
      available: true,
      values: {
        [SHARED_FILE_TOGGLE_HOTKEY_STORAGE_KEY]: 'Command+Shift+R',
        [LINE_NUMBERS_STORAGE_KEY]: 'faded',
        [TEXT_CURSOR_BLINK_STORAGE_KEY]: 'false',
        [RENDERED_TEXT_CURSOR_STYLE_STORAGE_KEY]: 'bar',
        [RENDERED_BLOCK_CURSOR_OPACITY_STORAGE_KEY]: '0.8',
      },
    }) as any);

    expect(window.localStorage.setItem).toHaveBeenCalledWith(
      SHARED_FILE_TOGGLE_HOTKEY_STORAGE_KEY,
      'Command+Shift+R',
    );
    expect(window.localStorage.setItem).toHaveBeenCalledWith(LINE_NUMBERS_STORAGE_KEY, 'faded');
    expect(window.localStorage.setItem).toHaveBeenCalledWith(TEXT_CURSOR_BLINK_STORAGE_KEY, 'false');
    expect(window.localStorage.setItem).toHaveBeenCalledWith(RENDERED_TEXT_CURSOR_STYLE_STORAGE_KEY, 'bar');
    expect(window.localStorage.setItem).toHaveBeenCalledWith(RENDERED_BLOCK_CURSOR_OPACITY_STORAGE_KEY, '0.8');
    expect(sharedHotkeyChanged).toHaveBeenCalledTimes(1);
    expect(cursorBlinkChanged).toHaveBeenCalledTimes(1);
    expect(cursorStyleChanged).toHaveBeenCalledTimes(1);
    expect(cursorOpacityChanged).toHaveBeenCalledTimes(1);

    window.removeEventListener('fieldtheory:shared-file-toggle-hotkey-changed', sharedHotkeyChanged);
    window.removeEventListener(TEXT_CURSOR_BLINK_CHANGED_EVENT, cursorBlinkChanged);
    window.removeEventListener(RENDERED_TEXT_CURSOR_STYLE_CHANGED_EVENT, cursorStyleChanged);
    window.removeEventListener(RENDERED_BLOCK_CURSOR_OPACITY_CHANGED_EVENT, cursorOpacityChanged);
  });
});
