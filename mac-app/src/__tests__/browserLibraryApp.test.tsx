import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BROWSER_HELPER_EVENT_STREAM_OPEN_EVENT,
  BrowserLibraryApp,
  applyRendererStorageChangeFromNative,
  browserArchiveActiveLibraryFile,
  createBrowserHelperClient,
  installBrowserLibraryHost,
  browserCreateCommand,
  browserShellOpenExternal,
  browserShellSetRepresentedFilename,
  browserShellShowItemInFolder,
  getBrowserLibraryInitialOpenTarget,
  browserToggleActiveLibraryLineNumbers,
  isBrowserLibraryIncludedOpenTarget,
  normalizeBrowserCreatedCommand,
  setBrowserActiveLibraryFileContext,
  startRendererStorageForegroundRefresh,
  syncRendererStorage,
} from '../browser-library';
import {
  LINE_NUMBERS_STORAGE_KEY,
  RENDERED_BLOCK_CURSOR_OPACITY_CHANGED_EVENT,
  RENDERED_BLOCK_CURSOR_OPACITY_STORAGE_KEY,
  RENDERED_EDIT_CLICK_MODE_CHANGED_EVENT,
  RENDERED_EDIT_CLICK_MODE_STORAGE_KEY,
  RENDERED_TEXT_CURSOR_STYLE_CHANGED_EVENT,
  RENDERED_TEXT_CURSOR_STYLE_STORAGE_KEY,
  SHARED_FILE_TOGGLE_HOTKEY_STORAGE_KEY,
  TEXT_CURSOR_BLINK_CHANGED_EVENT,
  TEXT_CURSOR_BLINK_STORAGE_KEY,
} from '../utils/editorShortcuts';

const themeContextMock = vi.hoisted(() => ({
  toggleDarkMode: vi.fn(),
}));

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
    toggleDarkMode: themeContextMock.toggleDarkMode,
  }),
}));

vi.mock('../supabaseClient', () => ({
  supabase: null,
}));

describe('BrowserLibraryApp', () => {
  let openMarkdownListener: ((target: unknown) => void) | null = null;
  let newReadingListener: ((readingPath: string) => void) | null = null;
  let showNewReadingListener: ((readingPath: string) => void) | null = null;
  let showReadingListener: ((readingPath: string) => void) | null = null;
  let setFullscreenListener: ((fullscreen: boolean) => void) | null = null;
  let openWikiPageListener: ((relPath: string) => void) | null = null;
  let openExternalListener: ((absPath: string) => void) | null = null;
  let toggleLineNumbersListener: (() => void) | null = null;
  let localCommandStatusListener: ((status: unknown) => void) | null = null;
  let pollStatus: ReturnType<typeof vi.fn>;
  let checkForUpdates: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    openMarkdownListener = null;
    newReadingListener = null;
    showNewReadingListener = null;
    showReadingListener = null;
    setFullscreenListener = null;
    openWikiPageListener = null;
    openExternalListener = null;
    toggleLineNumbersListener = null;
    localCommandStatusListener = null;
    themeContextMock.toggleDarkMode.mockClear();
    checkForUpdates = vi.fn(async () => undefined);
    pollStatus = vi.fn(async () => ({
      pendingPath: null,
      edits: 0,
      threshold: 5,
      didReset: false,
    }));
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
        onLocalCommandStatus: vi.fn((callback: (status: unknown) => void) => {
          localCommandStatusListener = callback;
          return () => {
            localCommandStatusListener = null;
          };
        }),
        onToggleLineNumbersFromLauncher: vi.fn((callback: () => void) => {
          toggleLineNumbersListener = callback;
          return () => {
            toggleLineNumbersListener = null;
          };
        }),
        listMaxwellRuns: vi.fn(async () => []),
        getMaxwellMemory: vi.fn(async () => ({
          enabled: false,
          content: '',
          path: '',
          updatedAt: 0,
          maxChars: 12_000,
        })),
        cancelMaxwellRun: vi.fn(async () => ({ success: true })),
        setActiveLibraryFileContext: vi.fn(async () => true),
      },
    });
    Object.defineProperty(window, 'librarianAPI', {
      configurable: true,
      value: {
        pollStatus,
        onNewReadingAvailable: vi.fn((callback: (readingPath: string) => void) => {
          newReadingListener = callback;
          return () => {
            newReadingListener = null;
          };
        }),
        onShowNewReading: vi.fn((callback: (readingPath: string) => void) => {
          showNewReadingListener = callback;
          return () => {
            showNewReadingListener = null;
          };
        }),
        onShowReading: vi.fn((callback: (readingPath: string) => void) => {
          showReadingListener = callback;
          return () => {
            showReadingListener = null;
          };
        }),
        onSetFullscreen: vi.fn((callback: (fullscreen: boolean) => void) => {
          setFullscreenListener = callback;
          return () => {
            setFullscreenListener = null;
          };
        }),
      },
    });
    Object.defineProperty(window, 'hotkeyAPI', {
      configurable: true,
      value: {
        getHotkey: vi.fn(async () => null),
      },
    });
    Object.defineProperty(window, 'libraryAPI', {
      configurable: true,
      value: {
        getRoots: vi.fn(async () => []),
      },
    });
    Object.defineProperty(window, 'wikiAPI', {
      configurable: true,
      writable: true,
      value: {
        onOpenWikiPage: vi.fn((callback: (relPath: string) => void) => {
          openWikiPageListener = callback;
          return () => {
            openWikiPageListener = null;
          };
        }),
        onOpenScratchpad: vi.fn(() => vi.fn()),
      },
    });
    Object.defineProperty(window, 'externalAPI', {
      configurable: true,
      value: {
        onOpenExternal: vi.fn((callback: (absPath: string) => void) => {
          openExternalListener = callback;
          return () => {
            openExternalListener = null;
          };
        }),
      },
    });
    Object.defineProperty(window, 'updaterAPI', {
      configurable: true,
      value: {
        getVersion: vi.fn(() => '25.6.1'),
        isEnabled: vi.fn(() => true),
        getStatus: vi.fn(async () => null),
        checkForUpdates,
        downloadUpdate: vi.fn(async () => undefined),
        installUpdate: vi.fn(async () => undefined),
        dismissUpdate: vi.fn(async () => undefined),
        onCheckingForUpdate: vi.fn(() => vi.fn()),
        onUpdateAvailable: vi.fn(() => vi.fn()),
        onUpdateNotAvailable: vi.fn(() => vi.fn()),
        onDownloadProgress: vi.fn(() => vi.fn()),
        onUpdateDownloaded: vi.fn(() => vi.fn()),
        onInstalling: vi.fn(() => vi.fn()),
        onError: vi.fn(() => vi.fn()),
      },
    });
    Object.defineProperty(window, 'authAPI', {
      configurable: true,
      value: {
        getSession: vi.fn(async () => null),
        getCallsign: vi.fn(async () => null),
        onSessionChanged: vi.fn(() => vi.fn()),
      },
    });
    Object.defineProperty(window, 'metricsAPI', {
      configurable: true,
      value: {
        getMetrics: vi.fn(async () => ({
          transcriptions: 0,
          words_transcribed: 0,
          words_improved: 0,
          priority_mic_minutes: 0,
          verbal_commands: 0,
          command_launcher_uses: 0,
          clipboard_items: 0,
          pastes_used: 0,
          stacks_created: 0,
          autostacks_created: 0,
          stacks_pasted: 0,
          items_added_to_context: 0,
          sketches_created: 0,
          screenshots_taken: 0,
          librarian_artifacts_created: 0,
          librarian_artifacts_shared: 0,
          commands_executed: 0,
          commands_contributed: 0,
          feedback_given: 0,
        })),
        fetchFromSupabase: vi.fn(async () => true),
      },
    });
    Object.defineProperty(window, 'quotaAPI', {
      configurable: true,
      value: {
        getQuotas: vi.fn(async () => null),
        onTierChanged: vi.fn(() => vi.fn()),
        onQuotaChanged: vi.fn(() => vi.fn()),
      },
    });
    window.__fieldTheoryBrowserReportActiveSurface = vi.fn();
  });

  afterEach(() => {
    delete (window as any).commandsAPI;
    delete (window as any).librarianAPI;
    delete (window as any).hotkeyAPI;
    delete (window as any).libraryAPI;
    delete (window as any).wikiAPI;
    delete (window as any).externalAPI;
    delete (window as any).updaterAPI;
    delete (window as any).authAPI;
    delete (window as any).metricsAPI;
    delete (window as any).quotaAPI;
    delete (window as any).bookmarksAPI;
    delete (window as any).recentAPI;
    delete (window as any).taggedDocsAPI;
    delete (window as any).sharedFilesAPI;
    delete (window as any).librarianStorageAPI;
    delete (window as any).shellAPI;
    delete window.__fieldTheoryBrowserReportActiveSurface;
    vi.restoreAllMocks();
  });

  it('keeps the Browser Library target boundary explicit', () => {
    expect(isBrowserLibraryIncludedOpenTarget({ kind: 'wiki', path: 'scratchpad/note' })).toBe(true);
    expect(isBrowserLibraryIncludedOpenTarget({ kind: 'external', path: '/tmp/note.md' })).toBe(true);
    expect(isBrowserLibraryIncludedOpenTarget({ kind: 'command', path: '/tmp/Commands/plan.md' })).toBe(true);
    expect(isBrowserLibraryIncludedOpenTarget({ kind: 'commands', path: 'commands' })).toBe(true);
    expect(isBrowserLibraryIncludedOpenTarget({ kind: 'library', path: 'library' })).toBe(true);
    expect(isBrowserLibraryIncludedOpenTarget({ kind: 'bookmarks', path: 'bookmarks' })).toBe(true);
    expect(isBrowserLibraryIncludedOpenTarget({ kind: 'ember', path: 'ember' })).toBe(true);
    expect(isBrowserLibraryIncludedOpenTarget({ kind: 'commands' })).toBe(true);
    expect(isBrowserLibraryIncludedOpenTarget({ kind: 'library' })).toBe(true);
    expect(isBrowserLibraryIncludedOpenTarget({ kind: 'bookmarks' })).toBe(true);
    expect(isBrowserLibraryIncludedOpenTarget({ kind: 'ember' })).toBe(true);

    expect(isBrowserLibraryIncludedOpenTarget({ kind: 'clipboard', path: 'clipboard' })).toBe(false);
    expect(isBrowserLibraryIncludedOpenTarget({ kind: 'settings', path: 'settings' })).toBe(false);
    expect(isBrowserLibraryIncludedOpenTarget({ kind: 'feedback', path: 'feedback' })).toBe(false);
    expect(isBrowserLibraryIncludedOpenTarget({ kind: 'terminal', path: 'terminal' })).toBe(false);
  });

  it('resolves native-shaped conflict results instead of throwing from guarded saves', async () => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 409,
      json: async () => ({
        ok: false,
        result: {
          ok: false,
          reason: 'conflict',
          currentContent: '# Native write\n',
        },
      }),
    })) as unknown as typeof fetch;

    try {
      const request = createBrowserHelperClient({
        api: 'http://127.0.0.1:59971',
        token: 'runtime-token',
        clientId: 'client-one',
      });

      await expect(request<{ result: unknown }>('/native/wiki/page', {
        method: 'PUT',
        json: { relPath: 'Plan', content: '# Browser write\n' },
        allowErrorResult: true,
      })).resolves.toEqual({
        ok: false,
        result: {
          ok: false,
          reason: 'conflict',
          currentContent: '# Native write\n',
        },
      });
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it('installs native auth session reads during Browser Library host startup', async () => {
    const previousFetch = globalThis.fetch;
    const previousEventSource = window.EventSource;
    const previousSetItem = window.localStorage.setItem;
    const previousRemoveItem = window.localStorage.removeItem;
    const session = { user: { id: 'user-1', email: 'river@example.com' } };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const pathname = new URL(url).pathname;
      const responses: Record<string, unknown> = {
        '/native/renderer-storage': { ok: true, available: true, values: {} },
        '/native/app/version': { ok: true, version: '25.6.1' },
        '/native/updater/enabled': { ok: true, enabled: true },
        '/native/auth/session': { ok: true, session },
        '/native/auth/callsign': { ok: true, callsign: 'river' },
        '/native/metrics': { ok: true, metrics: { words_transcribed: 1234 } },
        '/native/metrics/fetch-from-supabase': { ok: true, success: true },
        '/native/quota/quotas': { ok: true, quotas: { tier: 'pro' } },
        '/native/shell/open-field-theory-markdown': { ok: true, result: { success: true } },
      };
      return {
        ok: true,
        status: 200,
        json: async () => responses[pathname] ?? { ok: true },
      };
    }) as unknown as typeof fetch;
    class TestEventSource {
      addEventListener = vi.fn();
      close = vi.fn();
    }
    globalThis.fetch = fetchMock;
    Object.defineProperty(window, 'EventSource', {
      configurable: true,
      value: TestEventSource,
    });
    Object.defineProperty(globalThis, 'EventSource', {
      configurable: true,
      value: TestEventSource,
    });

    try {
      delete (window as any).commandsAPI;
      delete (window as any).hotkeyAPI;
      delete (window as any).librarianAPI;
      delete (window as any).libraryAPI;
      delete (window as any).wikiAPI;
      delete (window as any).externalAPI;
      delete (window as any).authAPI;
      delete (window as any).metricsAPI;
      delete (window as any).quotaAPI;
      delete (window as any).updaterAPI;
      delete (window as any).shellAPI;
      await installBrowserLibraryHost({
        api: 'http://127.0.0.1:59971',
        token: 'runtime-token',
        clientId: 'client-one',
      });

      await expect(window.authAPI?.getSession?.()).resolves.toEqual(session);
      await expect(window.authAPI?.getCallsign?.()).resolves.toBe('river');
      await expect(window.metricsAPI?.getMetrics?.()).resolves.toEqual({ words_transcribed: 1234 });
      await expect(window.metricsAPI?.fetchFromSupabase?.()).resolves.toBe(true);
      await expect(window.quotaAPI?.getQuotas?.()).resolves.toEqual({ tier: 'pro' });
      await expect(window.shellAPI?.openFieldTheoryMarkdown?.({ kind: 'wiki', path: 'Plan.md' })).resolves.toEqual({ success: true });
      expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:59971/native/auth/session', expect.objectContaining({
        headers: expect.objectContaining({
          'X-FieldTheory-Browser-Token': 'runtime-token',
          'X-FieldTheory-Browser-Client': 'client-one',
        }),
      }));
      expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:59971/native/metrics', expect.objectContaining({
        headers: expect.objectContaining({
          'X-FieldTheory-Browser-Token': 'runtime-token',
          'X-FieldTheory-Browser-Client': 'client-one',
        }),
      }));
      expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:59971/native/quota/quotas', expect.objectContaining({
        headers: expect.objectContaining({
          'X-FieldTheory-Browser-Token': 'runtime-token',
          'X-FieldTheory-Browser-Client': 'client-one',
        }),
      }));
      expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:59971/native/shell/open-field-theory-markdown', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ target: { kind: 'wiki', path: 'Plan.md' } }),
        headers: expect.objectContaining({
          'X-FieldTheory-Browser-Token': 'runtime-token',
          'X-FieldTheory-Browser-Client': 'client-one',
        }),
      }));
      expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:59971/native/auth/callsign', expect.objectContaining({
        headers: expect.objectContaining({
          'X-FieldTheory-Browser-Token': 'runtime-token',
          'X-FieldTheory-Browser-Client': 'client-one',
        }),
      }));
    } finally {
      window.dispatchEvent(new Event('beforeunload'));
      window.localStorage.setItem = previousSetItem;
      window.localStorage.removeItem = previousRemoveItem;
      globalThis.fetch = previousFetch;
      Object.defineProperty(window, 'EventSource', {
        configurable: true,
        value: previousEventSource,
      });
      Object.defineProperty(globalThis, 'EventSource', {
        configurable: true,
        value: previousEventSource,
      });
    }
  });

  it('clears Browser-owned Library context and navigation when the Browser tab becomes hidden', async () => {
    const previousFetch = globalThis.fetch;
    const previousEventSource = window.EventSource;
    const previousVisibilityState = document.visibilityState;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const pathname = new URL(String(input)).pathname;
      const responses: Record<string, unknown> = {
        '/native/renderer-storage': { ok: true, available: true, values: {} },
        '/native/app/version': { ok: true, version: '25.6.1' },
        '/native/updater/enabled': { ok: true, enabled: true },
      };
      return {
        ok: true,
        status: 200,
        json: async () => responses[pathname] ?? { ok: true },
      };
    }) as unknown as typeof fetch;
    class TestEventSource {
      addEventListener = vi.fn();
      close = vi.fn();
    }
    const setVisibilityState = (state: DocumentVisibilityState) => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        value: state,
      });
    };

    globalThis.fetch = fetchMock;
    Object.defineProperty(window, 'EventSource', {
      configurable: true,
      value: TestEventSource,
    });
    Object.defineProperty(globalThis, 'EventSource', {
      configurable: true,
      value: TestEventSource,
    });
    setVisibilityState('visible');

    try {
      delete (window as any).commandsAPI;
      delete (window as any).hotkeyAPI;
      delete (window as any).librarianAPI;
      delete (window as any).libraryAPI;
      delete (window as any).wikiAPI;
      delete (window as any).externalAPI;
      delete (window as any).authAPI;
      delete (window as any).updaterAPI;
      delete (window as any).shellAPI;
      await installBrowserLibraryHost({
        api: 'http://127.0.0.1:59971',
        token: 'runtime-token',
        clientId: 'client-one',
      });

      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:59971/native/client-active',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'X-FieldTheory-Browser-Client': 'client-one',
          }),
        }),
      ));

      setVisibilityState('hidden');
      document.dispatchEvent(new Event('visibilitychange'));

      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:59971/native/client-active',
        expect.objectContaining({
          method: 'DELETE',
          headers: expect.objectContaining({
            'X-FieldTheory-Browser-Client': 'client-one',
          }),
        }),
      ));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:59971/native/current',
        expect.objectContaining({
          method: 'DELETE',
          headers: expect.objectContaining({
            'X-FieldTheory-Browser-Client': 'client-one',
          }),
        }),
      ));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:59971/native/librarian/editor-focused',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ focused: false }),
          headers: expect.objectContaining({
            'X-FieldTheory-Browser-Client': 'client-one',
          }),
        }),
      ));
    } finally {
      window.dispatchEvent(new Event('beforeunload'));
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        value: previousVisibilityState,
      });
      globalThis.fetch = previousFetch;
      Object.defineProperty(window, 'EventSource', {
        configurable: true,
        value: previousEventSource,
      });
      Object.defineProperty(globalThis, 'EventSource', {
        configurable: true,
        value: previousEventSource,
      });
    }
  });

  it('refreshes snapshot surfaces when the helper event stream reconnects', async () => {
    const previousFetch = globalThis.fetch;
    const previousEventSource = window.EventSource;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const pathname = new URL(String(input)).pathname;
      const responses: Record<string, unknown> = {
        '/native/renderer-storage': { ok: true, available: true, values: {} },
        '/native/app/version': { ok: true, version: '25.6.1' },
        '/native/updater/enabled': { ok: true, enabled: true },
      };
      return {
        ok: true,
        status: 200,
        json: async () => responses[pathname] ?? { ok: true },
      };
    }) as unknown as typeof fetch;
    let eventSourceInstance: TestEventSource | null = null;
    class TestEventSource {
      onopen: (() => void) | null = null;
      addEventListener = vi.fn();
      close = vi.fn();

      constructor() {
        eventSourceInstance = this;
      }
    }
    globalThis.fetch = fetchMock;
    Object.defineProperty(window, 'EventSource', {
      configurable: true,
      value: TestEventSource,
    });
    Object.defineProperty(globalThis, 'EventSource', {
      configurable: true,
      value: TestEventSource,
    });

    try {
      delete (window as any).commandsAPI;
      delete (window as any).hotkeyAPI;
      delete (window as any).librarianAPI;
      delete (window as any).libraryAPI;
      delete (window as any).wikiAPI;
      delete (window as any).externalAPI;
      delete (window as any).authAPI;
      delete (window as any).updaterAPI;
      delete (window as any).shellAPI;
      await installBrowserLibraryHost({
        api: 'http://127.0.0.1:59971',
        token: 'runtime-token',
        clientId: 'client-one',
      });

      const libraryChanged = vi.fn();
      const wikiChanged = vi.fn();
      const recentChanged = vi.fn();
      const bookmarksChanged = vi.fn();
      const commandsChanged = vi.fn();
      const unsubscribeLibrary = window.libraryAPI?.onRootsChanged?.(libraryChanged);
      const unsubscribeWiki = window.wikiAPI?.onPageChanged?.(wikiChanged);
      const unsubscribeRecent = window.recentAPI?.onChanged?.(recentChanged);
      const unsubscribeBookmarks = window.bookmarksAPI?.onChanged?.(bookmarksChanged);
      const unsubscribeCommands = window.commandsAPI?.onCommandsChanged?.(commandsChanged);

      act(() => {
        eventSourceInstance?.onopen?.();
      });

      expect(libraryChanged).toHaveBeenCalledTimes(1);
      expect(wikiChanged).toHaveBeenCalledTimes(1);
      expect(recentChanged).toHaveBeenCalledTimes(1);
      expect(bookmarksChanged).toHaveBeenCalledTimes(1);
      expect(commandsChanged).not.toHaveBeenCalled();

      unsubscribeLibrary?.();
      unsubscribeWiki?.();
      unsubscribeRecent?.();
      unsubscribeBookmarks?.();
      unsubscribeCommands?.();
    } finally {
      window.dispatchEvent(new Event('beforeunload'));
      globalThis.fetch = previousFetch;
      Object.defineProperty(window, 'EventSource', {
        configurable: true,
        value: previousEventSource,
      });
      Object.defineProperty(globalThis, 'EventSource', {
        configurable: true,
        value: previousEventSource,
      });
    }
  });

  it('parses included Browser Library cold-start targets from URL parameters', () => {
    expect(getBrowserLibraryInitialOpenTarget({
      search: '?api=http%3A%2F%2F127.0.0.1%3A59971&kind=bookmarks',
    } as Location)).toEqual({ kind: 'bookmarks', path: 'bookmarks' });

    expect(getBrowserLibraryInitialOpenTarget({
      search: '?kind=wiki&path=scratchpad%2FJune%202.md&contentMode=markdown&sidebarCollapsed=1&focusChrome=true&selectionStart=10&selectionEnd=20',
    } as Location)).toEqual({
      kind: 'wiki',
      path: 'scratchpad/June 2.md',
      contentMode: 'markdown',
      sidebarCollapsed: true,
      focusChrome: true,
      selectionStart: 10,
      selectionEnd: 20,
    });

    expect(getBrowserLibraryInitialOpenTarget({
      search: `?target=${encodeURIComponent(JSON.stringify({ kind: 'command', path: '/tmp/Commands/ship.md' }))}`,
    } as Location)).toEqual({ kind: 'command', path: '/tmp/Commands/ship.md' });

    expect(getBrowserLibraryInitialOpenTarget({
      search: '?kind=clipboard',
    } as Location)).toBeNull();

    expect(getBrowserLibraryInitialOpenTarget({
      search: '?kind=wiki&path=scratchpad%2FJune%202.md&contentMode=source',
    } as Location)).toEqual({
      kind: 'wiki',
      path: 'scratchpad/June 2.md',
    });
  });

  it('mounts the real Browser shell footer and switches between Library and Commands surfaces', async () => {
    window.authAPI!.getCallsign = vi.fn(async () => 'river');
    const ThemeProvider = ({ children }: { children: React.ReactNode }) => <>{children}</>;
    const LibrarianView = (props: {
      browserLibrarySurface?: boolean;
      initialOpenTarget?: { kind?: string } | null;
      initialReadingPath?: string | null;
      onOpenCommandPath?: (path: string) => void;
      onSelectedItemTypeChange?: (type: 'wiki' | 'artifact' | 'bookmarks' | 'ember' | 'external' | null) => void;
      onActionFeedback?: (message: string) => void;
    }) => (
      <div data-testid="library-view">
        <span>{props.browserLibrarySurface ? 'browser-library' : 'native-library'}</span>
        <span>{props.initialOpenTarget?.kind ?? 'no-open-target'}</span>
        <span>{(props.initialOpenTarget as { path?: string } | null | undefined)?.path ?? 'no-open-path'}</span>
        <span>{props.initialReadingPath ?? 'no-pending-reading'}</span>
        <button type="button" onClick={() => props.onSelectedItemTypeChange?.('bookmarks')}>
          Select bookmarks
        </button>
        <button type="button" onClick={() => props.onSelectedItemTypeChange?.('ember')}>
          Select ember
        </button>
        <button type="button" onClick={() => props.onOpenCommandPath?.('/tmp/Commands/plan.md')}>
          Open command
        </button>
        <button type="button" onClick={() => props.onActionFeedback?.('Selection sent to Codex')}>
          Send feedback
        </button>
      </div>
    );
    const CommandsView = (props: {
      initialCommandPath?: string | null;
      onSwitchToClipboard?: () => void;
      onSelectedCommandPathChange?: (path: string | null) => void;
    }) => (
      <div data-testid="commands-view">
        <span>{props.initialCommandPath ?? 'no-command'}</span>
        <button type="button" onClick={() => props.onSelectedCommandPathChange?.('/tmp/Commands/review.md')}>
          Select command
        </button>
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
    expect(document.querySelector('[data-top-nav-mode="library"]')).toBeFalsy();
    expect(document.querySelector('[data-top-nav-mode="commands"]')).toBeFalsy();
    expect(document.querySelector('[data-fieldtheory-browser-library-footer="true"]')).toBeTruthy();
    expect(document.querySelector('[data-fieldtheory-browser-library-footer="true"] img[aria-label="Field Theory"]')?.getAttribute('src')).toBe('/field-theory-icon-black.png');
    expect(screen.getByText('v25.6.1')).toBeTruthy();
    expect(await screen.findByText('river')).toBeTruthy();
    fireEvent.mouseEnter(screen.getByText('v25.6.1').parentElement as HTMLElement);
    fireEvent.click(screen.getByText('Check for updates'));
    expect(checkForUpdates).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText('Switch to Dark Mode'));
    expect(themeContextMock.toggleDarkMode).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('Select bookmarks'));
    expect(window.__fieldTheoryBrowserReportActiveSurface).toHaveBeenCalledWith('bookmarks');

    fireEvent.click(screen.getByText('Send feedback'));
    expect(document.querySelector('[data-fieldtheory-top-chrome-action-feedback="true"]')?.textContent).toBe('Selection sent to Codex');

    act(() => {
      newReadingListener?.('/tmp/bookmarks-reading.md');
    });
    expect(screen.getByTestId('library-view')).toBeTruthy();
    expect(screen.getByText('no-pending-reading')).toBeTruthy();
    expect(document.querySelector('[data-top-nav-indicator="library"]')).toBeFalsy();

    fireEvent.click(screen.getByText('Select ember'));
    expect(window.__fieldTheoryBrowserReportActiveSurface).toHaveBeenCalledWith('ember');

    act(() => {
      openMarkdownListener?.({ kind: 'commands', path: 'commands' });
    });
    expect(await screen.findByTestId('commands-view')).toBeTruthy();
    expect(screen.getByText('no-command')).toBeTruthy();
    expect(window.__fieldTheoryBrowserReportActiveSurface).toHaveBeenCalledWith('commands');

    act(() => {
      newReadingListener?.('/tmp/new-reading.md');
    });
    expect(document.querySelector('[data-top-nav-indicator="library"]')).toBeFalsy();

    act(() => {
      showNewReadingListener?.('/tmp/show-now.md');
    });
    expect(await screen.findByTestId('library-view')).toBeTruthy();
    expect(screen.getByText('/tmp/show-now.md')).toBeTruthy();
    expect(document.querySelector('[data-top-nav-indicator="library"]')).toBeFalsy();

    vi.mocked(window.localStorage.setItem).mockClear();
    fireEvent.click(screen.getByLabelText('Toggle sidebar'));
    expect(await screen.findByTestId('library-view')).toBeTruthy();
    expect(document.querySelector('[data-top-nav-indicator="library"]')).toBeFalsy();
    expect(window.localStorage.setItem).toHaveBeenCalledWith('librarian-sidebar-collapsed', '1');

    vi.mocked(window.localStorage.setItem).mockClear();
    fireEvent.click(screen.getByLabelText('Toggle sidebar'));
    expect(window.localStorage.setItem).toHaveBeenCalledWith('librarian-sidebar-collapsed', '0');

    fireEvent.click(screen.getByText('Open command'));
    expect(await screen.findByTestId('library-view')).toBeTruthy();
    expect(await screen.findByText('external')).toBeTruthy();
    expect(screen.getByText('/tmp/Commands/plan.md')).toBeTruthy();

    act(() => {
      openMarkdownListener?.({ kind: 'commands', path: 'commands' });
    });
    expect(await screen.findByTestId('commands-view')).toBeTruthy();
    fireEvent.click(screen.getByText('Select command'));
    expect(window.commandsAPI?.setActiveLibraryFileContext).toHaveBeenCalledWith(null);

    fireEvent.keyDown(window, { key: '[', code: 'BracketLeft', metaKey: true });
    expect(await screen.findByTestId('library-view')).toBeTruthy();

    fireEvent.keyDown(window, { key: ']', code: 'BracketRight', metaKey: true });
    expect(await screen.findByTestId('commands-view')).toBeTruthy();

    act(() => {
      openMarkdownListener?.({ kind: 'commands', path: 'commands' });
    });
    expect(await screen.findByTestId('commands-view')).toBeTruthy();

    act(() => {
      openMarkdownListener?.({ kind: 'commands', path: 'commands' });
    });
    expect(await screen.findByTestId('commands-view')).toBeTruthy();

    act(() => {
      openMarkdownListener?.({ kind: 'command', path: '/tmp/Commands/from-launcher.md' });
    });
    expect(await screen.findByTestId('library-view')).toBeTruthy();
    expect(screen.queryByTestId('commands-view')).toBeNull();
    expect(await screen.findByText('external')).toBeTruthy();
    expect(screen.getByText('/tmp/Commands/from-launcher.md')).toBeTruthy();

    act(() => {
      openMarkdownListener?.({ kind: 'settings', path: 'settings' });
    });
    expect(screen.getByTestId('library-view')).toBeTruthy();

    act(() => {
      openMarkdownListener?.({ kind: 'library', path: 'library' });
    });
    await waitFor(() => expect(screen.getByTestId('library-view')).toBeTruthy());

    act(() => {
      openMarkdownListener?.({ kind: 'bookmarks' });
    });
    await waitFor(() => expect(screen.getAllByText('bookmarks').length).toBeGreaterThan(0));

    act(() => {
      openMarkdownListener?.({ kind: 'ember' });
    });
    await waitFor(() => expect(screen.getAllByText('ember').length).toBeGreaterThan(0));
  });

  it('shows native plan and metrics readout in the Browser Library footer', async () => {
    window.authAPI!.getSession = vi.fn(async () => ({ user: { id: 'user-one' } }));
    window.metricsAPI!.getMetrics = vi.fn(async () => ({
      transcriptions: 2,
      words_transcribed: 1234,
      words_improved: 56,
      priority_mic_minutes: 0,
      verbal_commands: 7,
      command_launcher_uses: 8,
      clipboard_items: 0,
      pastes_used: 0,
      stacks_created: 0,
      autostacks_created: 9,
      stacks_pasted: 0,
      items_added_to_context: 0,
      sketches_created: 0,
      screenshots_taken: 0,
      librarian_artifacts_created: 0,
      librarian_artifacts_shared: 0,
      commands_executed: 0,
      commands_contributed: 0,
      feedback_given: 0,
    }));
    window.quotaAPI!.getQuotas = vi.fn(async () => ({
      textImprove: { used: 0, limit: Infinity, remaining: Infinity, allowed: true, percentUsed: 0 },
      priorityMic: { used: 0, limit: Infinity, remaining: Infinity, allowed: true, percentUsed: 0 },
      autoStack: { used: 0, limit: Infinity, remaining: Infinity, allowed: true, percentUsed: 0 },
      portableCommands: { used: 0, limit: Infinity, remaining: Infinity, allowed: true, percentUsed: 0 },
      tier: 'pro',
      state: 'pro',
      trialEndsAt: null,
      nextTrialResetAt: null,
    }));
    const ThemeProvider = ({ children }: { children: React.ReactNode }) => <>{children}</>;
    const LibrarianView = () => <div data-testid="library-view">Library</div>;
    const CommandsView = () => <div data-testid="commands-view">Commands</div>;

    render(
      <BrowserLibraryApp
        LibrarianView={LibrarianView}
        CommandsView={CommandsView}
        ThemeProvider={ThemeProvider}
      />,
    );

    expect(await screen.findByText('Pro')).toBeTruthy();
    expect(screen.queryByText('1,234 words transcribed')).toBeNull();
  });

  it('shows native local command status in the Browser Library footer and can cancel a run', async () => {
    const ThemeProvider = ({ children }: { children: React.ReactNode }) => <>{children}</>;
    const LibrarianView = () => <div data-testid="library-view">Library</div>;
    const CommandsView = () => <div data-testid="commands-view">Commands</div>;

    render(
      <BrowserLibraryApp
        LibrarianView={LibrarianView}
        CommandsView={CommandsView}
        ThemeProvider={ThemeProvider}
      />,
    );

    act(() => {
      localCommandStatusListener?.({
        status: 'running',
        message: 'Running /ship',
        detail: 'Preparing Field Theory workflow',
        runId: 'run-ship-1',
      });
    });

    await waitFor(() => expect(screen.getByText(/Running \/ship/)).toBeTruthy());
    expect(screen.getByText(/Preparing Field Theory workflow/)).toBeTruthy();

    fireEvent.click(screen.getByTitle('Cancel Maxwell run'));

    await waitFor(() => {
      expect(window.commandsAPI?.cancelMaxwellRun).toHaveBeenCalledWith('run-ship-1');
    });
  });

  it('opens the current Browser Library page in the native Field Theory app from the floating button', async () => {
    const openFieldTheoryMarkdown = vi.fn(async () => ({ success: true }));
    window.commandsAPI!.getActiveLibraryFileContext = vi.fn(async () => ({
      type: 'wiki',
      rootPath: '/Users/afar/.fieldtheory/library',
      relPath: 'briefs/Claude Pro Token Use Audit Prompt Brief.md',
      filePath: '/Users/afar/.fieldtheory/library/briefs/Claude Pro Token Use Audit Prompt Brief.md',
      title: 'Claude Pro Token Use Audit Prompt Brief',
    }));
    Object.defineProperty(window, 'shellAPI', {
      configurable: true,
      value: {
        openFieldTheoryMarkdown,
      },
    });
    const ThemeProvider = ({ children }: { children: React.ReactNode }) => <>{children}</>;
    const LibrarianView = (props: {
      onActiveFileUpdatedChange?: (file: { path: string; title: string; mtime: number } | null) => void;
    }) => {
      React.useEffect(() => {
        props.onActiveFileUpdatedChange?.({
          path: '/Users/afar/.fieldtheory/library/briefs/Claude Pro Token Use Audit Prompt Brief.md',
          title: 'Claude Pro Token Use Audit Prompt Brief',
          mtime: 1,
        });
      }, [props.onActiveFileUpdatedChange]);
      return <div data-testid="library-view">Library</div>;
    };
    const CommandsView = () => <div data-testid="commands-view">Commands</div>;

    render(
      <BrowserLibraryApp
        LibrarianView={LibrarianView}
        CommandsView={CommandsView}
        ThemeProvider={ThemeProvider}
      />,
    );

    const button = await screen.findByLabelText('Open in Field Theory');
    fireEvent.click(button);

    await waitFor(() => expect(openFieldTheoryMarkdown).toHaveBeenCalledWith({
      kind: 'wiki',
      path: 'briefs/Claude Pro Token Use Audit Prompt Brief.md',
      contentMode: 'rendered',
    }));
    expect(await screen.findByText('Opened in Field Theory')).toBeTruthy();
  });

  it('hides the native Field Theory escape hatch while Library immersive reading is active', async () => {
    const ThemeProvider = ({ children }: { children: React.ReactNode }) => <>{children}</>;
    const LibrarianView = (props: {
      onActiveFileUpdatedChange?: (file: { path: string; title: string; mtime: number } | null) => void;
      onFullScreenChange?: (fullscreen: boolean) => void;
    }) => {
      React.useEffect(() => {
        props.onActiveFileUpdatedChange?.({ path: '/tmp/note.md', title: 'Note', mtime: 1 });
      }, [props.onActiveFileUpdatedChange]);
      return <button type="button" onClick={() => props.onFullScreenChange?.(true)}>Enter immersive</button>;
    };
    const CommandsView = () => <div data-testid="commands-view">Commands</div>;

    render(
      <BrowserLibraryApp
        LibrarianView={LibrarianView}
        CommandsView={CommandsView}
        ThemeProvider={ThemeProvider}
      />,
    );

    expect(await screen.findByLabelText('Open in Field Theory')).toBeTruthy();
    fireEvent.click(screen.getByText('Enter immersive'));

    await waitFor(() => expect(screen.queryByLabelText('Open in Field Theory')).toBeNull());
  });

  it('opens included Browser Library targets during cold start', async () => {
    const ThemeProvider = ({ children }: { children: React.ReactNode }) => <>{children}</>;
    const LibrarianView = (props: {
      initialOpenTarget?: { kind?: string; path?: string } | null;
    }) => (
      <div data-testid="library-view">
        <span>{props.initialOpenTarget?.kind ?? 'no-open-kind'}</span>
        <span>{props.initialOpenTarget?.path ?? 'no-open-path'}</span>
      </div>
    );
    const CommandsView = (props: {
      initialCommandPath?: string | null;
    }) => (
      <div data-testid="commands-view">
        <span>{props.initialCommandPath ?? 'no-command'}</span>
      </div>
    );

    const { unmount } = render(
      <BrowserLibraryApp
        LibrarianView={LibrarianView}
        CommandsView={CommandsView}
        ThemeProvider={ThemeProvider}
        initialOpenTarget={{ kind: 'bookmarks' }}
      />,
    );

    expect(await screen.findByTestId('library-view')).toBeTruthy();
    expect(screen.getAllByText('bookmarks')).toHaveLength(2);
    unmount();

    render(
      <BrowserLibraryApp
        LibrarianView={LibrarianView}
        CommandsView={CommandsView}
        ThemeProvider={ThemeProvider}
        initialOpenTarget={{ kind: 'command', path: '/tmp/Commands/ship.md' }}
      />,
    );

    expect(await screen.findByTestId('library-view')).toBeTruthy();
    expect(screen.queryByTestId('commands-view')).toBeNull();
    expect(await screen.findByText('external')).toBeTruthy();
    expect(screen.getByText('/tmp/Commands/ship.md')).toBeTruthy();
  });

  it('renders real Library Bookmarks in Browser mode using native bookmark data and preferences', async () => {
    window.localStorage.setItem('bookmarks-view-mode', 'list');
    window.localStorage.setItem('bookmarks-show-text', '0');
    Object.defineProperty(window, 'bookmarksAPI', {
      configurable: true,
      value: {
        getAll: vi.fn(async () => ({
          bookmarks: [
            {
              id: 'bookmark-with-media',
              sourceType: 'x',
              text: 'Saved visual bookmark',
              url: 'https://x.com/example/status/1',
              authorHandle: 'example',
              authorName: 'Example',
              authorAvatar: '',
              postedAt: '2025-01-17T00:00:00.000Z',
              images: [{ url: 'https://example.com/image.jpg', width: 640, height: 480, type: 'photo' }],
              mediaCount: 1,
              likeCount: 0,
              repostCount: 0,
              bookmarkCount: 0,
              folders: [],
            },
            {
              id: 'text-only-bookmark',
              sourceType: 'x',
              text: 'Hidden text-only bookmark',
              url: 'https://x.com/example/status/2',
              authorHandle: 'example',
              authorName: 'Example',
              authorAvatar: '',
              postedAt: '2025-01-18T00:00:00.000Z',
              images: [],
              mediaCount: 0,
              likeCount: 0,
              repostCount: 0,
              bookmarkCount: 0,
              folders: [],
            },
          ],
          folders: [],
          xLastSyncedAt: null,
        })),
        syncIfStale: vi.fn(async () => ({ status: 'fresh' })),
        getAuthors: vi.fn(async () => []),
        getAuthorBookmarks: vi.fn(async () => []),
        getTaxonomyBookmarks: vi.fn(async () => []),
        search: vi.fn(async () => []),
        saveWebUrl: vi.fn(async () => ({ success: true })),
        getActiveWebPage: vi.fn(async () => ({ success: false })),
        saveActiveWebPage: vi.fn(async () => ({ success: false })),
        invokeBookmark: vi.fn(async () => ({ success: true })),
        copyForAgent: vi.fn(async () => ({ success: true })),
        invokeAuthorTimeline: vi.fn(async () => ({ success: true })),
        onChanged: vi.fn(() => vi.fn()),
      },
    });
    Object.assign(window.librarianAPI!, {
      isMutedForToday: vi.fn(async () => false),
      setImmersiveDismissable: vi.fn(),
      setSizeKey: vi.fn(),
      discoverLibrarianDirs: vi.fn(async () => []),
      isSetupComplete: vi.fn(async () => true),
      getReadings: vi.fn(async () => []),
      getReading: vi.fn(async () => null),
      getShareStatus: vi.fn(async () => null),
      onInsertMarkdownText: vi.fn(() => vi.fn()),
      onInsertPlainMarkdownText: vi.fn(() => vi.fn()),
      onReadingAdded: vi.fn(() => vi.fn()),
      onReadingUpdated: vi.fn(() => vi.fn()),
      onReadingRenamed: vi.fn(() => vi.fn()),
      onReadingRemoved: vi.fn(() => vi.fn()),
      setMarkdownEditorFocused: vi.fn(),
    });
    Object.assign(window.commandsAPI!, {
      getCommands: vi.fn(async () => []),
      getCommandByPath: vi.fn(async () => null),
      onCommandsChanged: vi.fn(() => vi.fn()),
      runLocalCommand: vi.fn(async () => ({ success: true })),
      startMeetingHere: vi.fn(async () => ({ success: true, session: null })),
      stopMeeting: vi.fn(async () => ({ success: true, session: null })),
      getActiveMeeting: vi.fn(async () => null),
      onMeetingStatus: vi.fn(() => vi.fn()),
    });
    Object.assign(window.libraryAPI!, {
      getHiddenFolders: vi.fn(async () => []),
      openDocumentWindow: vi.fn(async () => ({ success: true })),
      onRootsChanged: vi.fn(() => vi.fn()),
      onItemRenamed: vi.fn(() => vi.fn()),
    });
    Object.assign(window.wikiAPI!, {
      getTree: vi.fn(async () => []),
      getPage: vi.fn(async () => null),
      save: vi.fn(async () => null),
      createFile: vi.fn(async () => null),
      createFileWithDefaultTitle: vi.fn(async () => null),
      deletePage: vi.fn(async () => false),
      onPageChanged: vi.fn(() => vi.fn()),
      onPageDeleted: vi.fn(() => vi.fn()),
      onPageRenamed: vi.fn(() => vi.fn()),
    });
    Object.defineProperty(window, 'recentAPI', {
      configurable: true,
      value: {
        list: vi.fn(async () => []),
        visit: vi.fn(async () => {}),
        remove: vi.fn(async () => []),
        onChanged: vi.fn(() => vi.fn()),
      },
    });
    Object.defineProperty(window, 'taggedDocsAPI', {
      configurable: true,
      value: {
        list: vi.fn(async () => []),
        onUpdated: vi.fn(() => vi.fn()),
      },
    });
    Object.defineProperty(window, 'sharedFilesAPI', {
      configurable: true,
      value: {
        getAvailability: vi.fn(async () => ({ available: false, hasTeamMembers: false })),
        getStatus: vi.fn(async () => ({ shared: false })),
        getPinnedItemIds: vi.fn(async () => []),
        setActivePresence: vi.fn(async () => []),
        onPresenceChanged: vi.fn(() => vi.fn()),
        onPinsChanged: vi.fn(() => vi.fn()),
      },
    });
    Object.defineProperty(window, 'librarianStorageAPI', {
      configurable: true,
      value: {
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => undefined),
        removeItem: vi.fn(async () => undefined),
      },
    });
    Object.defineProperty(window, 'shellAPI', {
      configurable: true,
      value: {
        setRepresentedFilename: vi.fn(),
        openExternal: vi.fn(async () => true),
      },
    });
    const ThemeProvider = ({ children }: { children: React.ReactNode }) => <>{children}</>;
    const { default: LibrarianView } = await import('../components/LibrarianView');
    const CommandsView = () => <div data-testid="commands-view">Commands</div>;

    render(
      <BrowserLibraryApp
        LibrarianView={LibrarianView}
        CommandsView={CommandsView}
        ThemeProvider={ThemeProvider}
        initialOpenTarget={{ kind: 'bookmarks' }}
      />,
    );

    expect(await screen.findByText('Saved visual bookmark')).toBeTruthy();
    expect(screen.queryByText('Hidden text-only bookmark')).toBeNull();
    expect(await screen.findByText('1 bookmarks')).toBeTruthy();
    expect(window.bookmarksAPI!.getAll).toHaveBeenCalled();
    expect(window.bookmarksAPI!.syncIfStale).toHaveBeenCalled();
    expect(window.__fieldTheoryBrowserReportActiveSurface).toHaveBeenCalledWith('bookmarks');
  });

  it('routes native show-reading events into Library even when cold-started on Commands', async () => {
    const ThemeProvider = ({ children }: { children: React.ReactNode }) => <>{children}</>;
    const LibrarianView = (props: {
      initialReadingPath?: string | null;
      onInitialReadingConsumed?: () => void;
    }) => (
      <div data-testid="library-view">
        <span>{props.initialReadingPath ?? 'no-reading'}</span>
        <button type="button" onClick={() => props.onInitialReadingConsumed?.()}>Consume reading</button>
      </div>
    );
    const CommandsView = () => <div data-testid="commands-view">Commands</div>;

    render(
      <BrowserLibraryApp
        LibrarianView={LibrarianView}
        CommandsView={CommandsView}
        ThemeProvider={ThemeProvider}
        initialOpenTarget={{ kind: 'commands' }}
      />,
    );

    expect(await screen.findByTestId('commands-view')).toBeTruthy();
    expect(screen.queryByTestId('library-view')).toBeNull();

    act(() => {
      showReadingListener?.('/tmp/readings/native-show.md');
    });

    expect(await screen.findByTestId('library-view')).toBeTruthy();
    expect(screen.getByText('/tmp/readings/native-show.md')).toBeTruthy();
    expect(screen.queryByTestId('commands-view')).toBeNull();

    fireEvent.click(screen.getByText('Consume reading'));
    expect(screen.getByText('no-reading')).toBeTruthy();
  });

  it('routes native external-open events into Library even when cold-started on Commands', async () => {
    const ThemeProvider = ({ children }: { children: React.ReactNode }) => <>{children}</>;
    const LibrarianView = (props: {
      initialOpenTarget?: { kind?: string; path?: string } | null;
    }) => (
      <div data-testid="library-view">
        <span>{props.initialOpenTarget?.kind ?? 'no-open-kind'}</span>
        <span>{props.initialOpenTarget?.path ?? 'no-open-path'}</span>
      </div>
    );
    const CommandsView = () => <div data-testid="commands-view">Commands</div>;

    render(
      <BrowserLibraryApp
        LibrarianView={LibrarianView}
        CommandsView={CommandsView}
        ThemeProvider={ThemeProvider}
        initialOpenTarget={{ kind: 'commands' }}
      />,
    );

    expect(await screen.findByTestId('commands-view')).toBeTruthy();
    expect(screen.queryByTestId('library-view')).toBeNull();

    act(() => {
      openExternalListener?.('/tmp/native-open.md');
    });

    expect(await screen.findByTestId('library-view')).toBeTruthy();
    expect(screen.getByText('external')).toBeTruthy();
    expect(screen.getByText('/tmp/native-open.md')).toBeTruthy();
    expect(screen.queryByTestId('commands-view')).toBeNull();
  });

  it('lets a fresh launcher Library target replace a stale pending reading', async () => {
    const ThemeProvider = ({ children }: { children: React.ReactNode }) => <>{children}</>;
    const LibrarianView = (props: {
      initialReadingPath?: string | null;
      initialOpenTarget?: { kind?: string; path?: string } | null;
    }) => (
      <div data-testid="library-view">
        <span>{props.initialReadingPath ?? 'no-pending-reading'}</span>
        <span>{props.initialOpenTarget?.kind ?? 'no-open-kind'}</span>
        <span>{props.initialOpenTarget?.path ?? 'no-open-path'}</span>
      </div>
    );
    const CommandsView = () => <div data-testid="commands-view">Commands</div>;

    render(
      <BrowserLibraryApp
        LibrarianView={LibrarianView}
        CommandsView={CommandsView}
        ThemeProvider={ThemeProvider}
      />,
    );

    act(() => {
      showReadingListener?.('/tmp/Stale.md');
    });
    expect(await screen.findByText('/tmp/Stale.md')).toBeTruthy();

    act(() => {
      openMarkdownListener?.({ kind: 'wiki', path: 'scratchpad/Fresh.md' });
    });

    expect(await screen.findByText('scratchpad/Fresh.md')).toBeTruthy();
    expect(screen.getByText('wiki')).toBeTruthy();
    expect(screen.getByText('no-pending-reading')).toBeTruthy();
    expect(screen.queryByText('/tmp/Stale.md')).toBeNull();
  });

  it('preserves native fullscreen requests when Library has not mounted yet', async () => {
    const ThemeProvider = ({ children }: { children: React.ReactNode }) => <>{children}</>;
    const LibrarianView = (props: { initialFullScreen?: boolean }) => (
      <div data-testid="library-view">
        <span>{props.initialFullScreen ? 'initial-fullscreen' : 'initial-standard'}</span>
      </div>
    );
    const CommandsView = () => <div data-testid="commands-view">Commands</div>;

    render(
      <BrowserLibraryApp
        LibrarianView={LibrarianView}
        CommandsView={CommandsView}
        ThemeProvider={ThemeProvider}
        initialOpenTarget={{ kind: 'commands' }}
      />,
    );

    expect(await screen.findByTestId('commands-view')).toBeTruthy();
    expect(screen.queryByTestId('library-view')).toBeNull();

    act(() => {
      setFullscreenListener?.(true);
    });

    expect(await screen.findByTestId('library-view')).toBeTruthy();
    expect(screen.getByText('initial-fullscreen')).toBeTruthy();
    expect(screen.queryByTestId('commands-view')).toBeNull();
  });

  it('routes native wiki-open events into Library even when cold-started on Commands', async () => {
    const ThemeProvider = ({ children }: { children: React.ReactNode }) => <>{children}</>;
    const LibrarianView = (props: {
      initialOpenTarget?: { kind?: string; path?: string } | null;
      onInitialOpenTargetConsumed?: () => void;
    }) => (
      <div data-testid="library-view">
        <span>{props.initialOpenTarget?.kind ?? 'no-open-kind'}</span>
        <span>{props.initialOpenTarget?.path ?? 'no-open-path'}</span>
        <button type="button" onClick={() => props.onInitialOpenTargetConsumed?.()}>Consume target</button>
      </div>
    );
    const CommandsView = () => <div data-testid="commands-view">Commands</div>;

    render(
      <BrowserLibraryApp
        LibrarianView={LibrarianView}
        CommandsView={CommandsView}
        ThemeProvider={ThemeProvider}
        initialOpenTarget={{ kind: 'commands' }}
      />,
    );

    expect(await screen.findByTestId('commands-view')).toBeTruthy();
    expect(screen.queryByTestId('library-view')).toBeNull();

    act(() => {
      openWikiPageListener?.('scratchpad/native-open.md');
    });

    expect(await screen.findByTestId('library-view')).toBeTruthy();
    expect(screen.getByText('wiki')).toBeTruthy();
    expect(screen.getByText('scratchpad/native-open.md')).toBeTruthy();
    expect(screen.queryByTestId('commands-view')).toBeNull();

    fireEvent.click(screen.getByText('Consume target'));
    expect(screen.getByText('no-open-kind')).toBeTruthy();
  });

  it('routes native wiki-open events into the kept-alive Library view after switching to Commands', async () => {
    const ThemeProvider = ({ children }: { children: React.ReactNode }) => <>{children}</>;
    const LibrarianView = (props: {
      initialOpenTarget?: { kind?: string; path?: string } | null;
      onInitialOpenTargetConsumed?: () => void;
    }) => (
      <div data-testid="library-view">
        <span>{props.initialOpenTarget?.kind ?? 'no-open-kind'}</span>
        <span>{props.initialOpenTarget?.path ?? 'no-open-path'}</span>
        <button type="button" onClick={() => props.onInitialOpenTargetConsumed?.()}>Consume target</button>
      </div>
    );
    const CommandsView = () => <div data-testid="commands-view">Commands</div>;

    render(
      <BrowserLibraryApp
        LibrarianView={LibrarianView}
        CommandsView={CommandsView}
        ThemeProvider={ThemeProvider}
      />,
    );

    expect(await screen.findByTestId('library-view')).toBeTruthy();
    act(() => {
      openMarkdownListener?.({ kind: 'commands', path: 'commands' });
    });
    expect(await screen.findByTestId('commands-view')).toBeTruthy();

    act(() => {
      openWikiPageListener?.('scratchpad/native-open-kept-alive.md');
    });

    expect(await screen.findByTestId('library-view')).toBeTruthy();
    expect(screen.getByText('wiki')).toBeTruthy();
    expect(screen.getByText('scratchpad/native-open-kept-alive.md')).toBeTruthy();
    expect(screen.queryByTestId('commands-view')).toBeNull();

    fireEvent.click(screen.getByText('Consume target'));
    expect(screen.getByText('no-open-kind')).toBeTruthy();
  });

  it('shows Library when launcher toggles active Library line numbers while Commands is visible', async () => {
    const ThemeProvider = ({ children }: { children: React.ReactNode }) => <>{children}</>;
    const LibrarianView = (props: {
      active?: boolean;
    }) => (
      <div data-testid="library-view" data-active={props.active ? 'true' : 'false'}>
        Library
      </div>
    );
    const CommandsView = () => <div data-testid="commands-view">Commands</div>;

    render(
      <BrowserLibraryApp
        LibrarianView={LibrarianView}
        CommandsView={CommandsView}
        ThemeProvider={ThemeProvider}
      />,
    );

    expect((await screen.findByTestId('library-view')).getAttribute('data-active')).toBe('true');
    act(() => {
      openMarkdownListener?.({ kind: 'commands', path: 'commands' });
    });
    expect(await screen.findByTestId('commands-view')).toBeTruthy();
    expect(screen.getByTestId('library-view').getAttribute('data-active')).toBe('false');

    act(() => {
      toggleLineNumbersListener?.();
    });

    expect((await screen.findByTestId('library-view')).getAttribute('data-active')).toBe('true');
    expect(screen.queryByTestId('commands-view')).toBeNull();
  });

  it('keeps the Library mounted while Commands is visible', async () => {
    const ThemeProvider = ({ children }: { children: React.ReactNode }) => <>{children}</>;
    let mountCount = 0;
    const LibrarianView = (props: {
      active?: boolean;
    }) => {
      const [draft, setDraft] = React.useState('');
      React.useEffect(() => {
        mountCount += 1;
      }, []);
      return (
        <div data-testid="library-view" data-active={props.active ? 'true' : 'false'}>
          <input
            aria-label="Library draft"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </div>
      );
    };
    const CommandsView = (props: { onSwitchToClipboard?: () => void }) => (
      <div data-testid="commands-view">
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

    const draftInput = await screen.findByLabelText('Library draft');
    fireEvent.change(draftInput, { target: { value: 'still here' } });
    expect(mountCount).toBe(1);

    act(() => {
      openMarkdownListener?.({ kind: 'commands', path: 'commands' });
    });
    expect(await screen.findByTestId('commands-view')).toBeTruthy();
    expect(screen.getByTestId('library-view').getAttribute('data-active')).toBe('false');
    expect((document.querySelector('[data-fieldtheory-browser-library-keepalive="library"]') as HTMLElement | null)?.style.display).toBe('none');

    fireEvent.click(screen.getByText('Back to Library'));
    expect(await screen.findByTestId('library-view')).toBeTruthy();
    expect((screen.getByLabelText('Library draft') as HTMLInputElement).value).toBe('still here');
    expect(screen.getByTestId('library-view').getAttribute('data-active')).toBe('true');
    expect(mountCount).toBe(1);
  });

  it('uses native root-aware command-link conversion inside Library', async () => {
    Object.defineProperty(window, 'libraryAPI', {
      configurable: true,
      value: {
        getRoots: vi.fn(async () => [
          { path: '/Users/afar/.fieldtheory/library', builtin: true },
        ]),
      },
    });
    const ThemeProvider = ({ children }: { children: React.ReactNode }) => <>{children}</>;
    const LibrarianView = (props: {
      initialOpenTarget?: { kind?: string; path?: string } | null;
      onOpenCommandPath?: (path: string) => void;
    }) => (
      <div data-testid="library-view">
        <span>{props.initialOpenTarget?.kind ?? 'no-open-kind'}</span>
        <span>{props.initialOpenTarget?.path ?? 'no-open-path'}</span>
        <button type="button" onClick={() => props.onOpenCommandPath?.('/Users/afar/.fieldtheory/library/scratchpad/note.md')}>
          Open built-in command link
        </button>
      </div>
    );
    const CommandsView = () => <div data-testid="commands-view">Commands</div>;

    render(
      <BrowserLibraryApp
        LibrarianView={LibrarianView}
        CommandsView={CommandsView}
        ThemeProvider={ThemeProvider}
      />,
    );

    fireEvent.click(screen.getByText('Open built-in command link'));

    expect(await screen.findByTestId('library-view')).toBeTruthy();
    expect(screen.queryByTestId('commands-view')).toBeNull();
    expect(await screen.findByText('wiki')).toBeTruthy();
    expect(screen.getByText('scratchpad/note')).toBeTruthy();
  });

  it('mirrors native Library fullscreen state in the Browser shell chrome', async () => {
    const ThemeProvider = ({ children }: { children: React.ReactNode }) => <>{children}</>;
    const LibrarianView = (props: {
      initialFullScreen?: boolean;
      onFullScreenChange?: (fullscreen: boolean) => void;
    }) => (
      <div data-testid="library-view">
        <span>{props.initialFullScreen ? 'initial-fullscreen' : 'initial-standard'}</span>
        <button type="button" onClick={() => props.onFullScreenChange?.(true)}>Enter fullscreen</button>
        <button type="button" onClick={() => props.onFullScreenChange?.(false)}>Exit fullscreen</button>
      </div>
    );
    const CommandsView = () => <div data-testid="commands-view">Commands</div>;

    render(
      <BrowserLibraryApp
        LibrarianView={LibrarianView}
        CommandsView={CommandsView}
        ThemeProvider={ThemeProvider}
      />,
    );

    const footer = document.querySelector('[data-fieldtheory-browser-library-footer="true"]') as HTMLElement;
    expect(screen.getByText('initial-standard')).toBeTruthy();
    expect(footer.style.display).toBe('flex');

    fireEvent.click(screen.getByText('Enter fullscreen'));
    expect(window.localStorage.setItem).toHaveBeenCalledWith('librarian-immersive', 'true');
    expect(footer.style.display).toBe('none');

    fireEvent.click(screen.getByText('Exit fullscreen'));
    expect(window.localStorage.setItem).toHaveBeenCalledWith('librarian-immersive', 'false');
    expect(footer.style.display).toBe('flex');
  });

  it('sizes the immersive focus mark to the Browser panel instead of the native window default', async () => {
    const ThemeProvider = ({ children }: { children: React.ReactNode }) => <>{children}</>;
    const LibrarianView = (props: {
      initialFullScreen?: boolean;
      onFullScreenChange?: (fullscreen: boolean) => void;
      onFocusChromeActiveChange?: (active: boolean) => void;
    }) => {
      React.useEffect(() => {
        props.onFocusChromeActiveChange?.(Boolean(props.initialFullScreen));
      }, [props.initialFullScreen, props.onFocusChromeActiveChange]);
      return (
        <div data-testid="library-view">
          <button type="button" onClick={() => props.onFullScreenChange?.(true)}>Enter fullscreen</button>
        </div>
      );
    };
    const CommandsView = () => <div data-testid="commands-view">Commands</div>;
    window.localStorage.setItem('librarian-immersive', 'true');

    render(
      <BrowserLibraryApp
        LibrarianView={LibrarianView}
        CommandsView={CommandsView}
        ThemeProvider={ThemeProvider}
      />,
    );

    const focusIcon = document.querySelector('[data-fieldtheory-focus-chrome-icon="true"]') as HTMLElement;
    const focusIconImage = focusIcon.querySelector('img') as HTMLImageElement;
    expect(focusIcon.style.height).toBe('20px');
    expect(focusIconImage.style.height).toBe('20px');
    expect(focusIconImage.getAttribute('src')).toBe('/field-theory-icon-black.png');
    expect(focusIcon.style.height).not.toBe('32px');
  });

  it('starts with the native Library immersive preference in Browser mode', async () => {
    const ThemeProvider = ({ children }: { children: React.ReactNode }) => <>{children}</>;
    const LibrarianView = (props: { initialFullScreen?: boolean }) => (
      <div data-testid="library-view">
        <span>{props.initialFullScreen ? 'initial-fullscreen' : 'initial-standard'}</span>
      </div>
    );
    const CommandsView = () => <div data-testid="commands-view">Commands</div>;
    window.localStorage.setItem('librarian-immersive', 'true');

    render(
      <BrowserLibraryApp
        LibrarianView={LibrarianView}
        CommandsView={CommandsView}
        ThemeProvider={ThemeProvider}
      />,
    );

    expect(await screen.findByText('initial-fullscreen')).toBeTruthy();
    expect((document.querySelector('[data-fieldtheory-browser-library-footer="true"]') as HTMLElement).style.display).toBe('none');
  });

  it('does not clear the native Library immersive preference while cold-started on Commands', async () => {
    const ThemeProvider = ({ children }: { children: React.ReactNode }) => <>{children}</>;
    const LibrarianView = (props: { initialFullScreen?: boolean }) => (
      <div data-testid="library-view">
        <span>{props.initialFullScreen ? 'initial-fullscreen' : 'initial-standard'}</span>
      </div>
    );
    const CommandsView = () => <div data-testid="commands-view">Commands</div>;
    window.localStorage.setItem('librarian-immersive', 'true');
    vi.mocked(window.localStorage.setItem).mockClear();

    render(
      <BrowserLibraryApp
        LibrarianView={LibrarianView}
        CommandsView={CommandsView}
        ThemeProvider={ThemeProvider}
        initialOpenTarget={{ kind: 'commands' }}
      />,
    );

    expect(await screen.findByTestId('commands-view')).toBeTruthy();
    expect(window.localStorage.setItem).not.toHaveBeenCalledWith('librarian-immersive', 'false');
  });

  it('starts bookmark targets in native legacy fullscreen when requested', async () => {
    const ThemeProvider = ({ children }: { children: React.ReactNode }) => <>{children}</>;
    const LibrarianView = (props: {
      initialFullScreen?: boolean;
      initialOpenTarget?: { kind?: string } | null;
    }) => (
      <div data-testid="library-view">
        <span>{props.initialOpenTarget?.kind ?? 'no-target'}</span>
        <span>{props.initialFullScreen ? 'initial-fullscreen' : 'initial-standard'}</span>
      </div>
    );
    const CommandsView = () => <div data-testid="commands-view">Commands</div>;

    render(
      <BrowserLibraryApp
        LibrarianView={LibrarianView}
        CommandsView={CommandsView}
        ThemeProvider={ThemeProvider}
        initialOpenTarget={{ kind: 'bookmarks', focusChrome: true }}
      />,
    );

    expect(await screen.findByText('bookmarks')).toBeTruthy();
    expect(screen.getByText('initial-fullscreen')).toBeTruthy();
    expect((document.querySelector('[data-fieldtheory-browser-library-footer="true"]') as HTMLElement).style.display).toBe('none');
  });

  it('reports direct Commands, Bookmarks, and Ember launches as their active surfaces before child selection callbacks', async () => {
    const ThemeProvider = ({ children }: { children: React.ReactNode }) => <>{children}</>;
    const LibrarianView = (props: { initialOpenTarget?: { kind?: string } | null }) => (
      <div data-testid="library-view">
        <span>{props.initialOpenTarget?.kind ?? 'no-target'}</span>
      </div>
    );
    const CommandsView = () => <div data-testid="commands-view">Commands</div>;

    const { unmount } = render(
      <BrowserLibraryApp
        LibrarianView={LibrarianView}
        CommandsView={CommandsView}
        ThemeProvider={ThemeProvider}
        initialOpenTarget={{ kind: 'commands' }}
      />,
    );

    await waitFor(() => {
      expect(window.__fieldTheoryBrowserReportActiveSurface).toHaveBeenCalledWith('commands');
    });

    unmount();
    vi.mocked(window.__fieldTheoryBrowserReportActiveSurface).mockClear();

    const bookmarksRender = render(
      <BrowserLibraryApp
        LibrarianView={LibrarianView}
        CommandsView={CommandsView}
        ThemeProvider={ThemeProvider}
        initialOpenTarget={{ kind: 'bookmarks' }}
      />,
    );

    await waitFor(() => {
      expect(window.__fieldTheoryBrowserReportActiveSurface).toHaveBeenCalledWith('bookmarks');
    });

    bookmarksRender.unmount();
    vi.mocked(window.__fieldTheoryBrowserReportActiveSurface).mockClear();

    render(
      <BrowserLibraryApp
        LibrarianView={LibrarianView}
        CommandsView={CommandsView}
        ThemeProvider={ThemeProvider}
        initialOpenTarget={{ kind: 'ember' }}
      />,
    );

    await waitFor(() => {
      expect(window.__fieldTheoryBrowserReportActiveSurface).toHaveBeenCalledWith('ember');
    });

    vi.mocked(window.__fieldTheoryBrowserReportActiveSurface).mockClear();
    act(() => {
      window.dispatchEvent(new Event(BROWSER_HELPER_EVENT_STREAM_OPEN_EVENT));
    });
    expect(window.__fieldTheoryBrowserReportActiveSurface).toHaveBeenCalledWith('ember');
  });

  it('seeds launch-time focus chrome and sidebar collapse before the first Library render', async () => {
    window.localStorage.setItem('librarian-sidebar-collapsed', '0');
    vi.mocked(window.localStorage.setItem).mockClear();
    const ThemeProvider = ({ children }: { children: React.ReactNode }) => <>{children}</>;
    const LibrarianView = (props: {
      focusChromeEnabled?: boolean;
      focusChromeGroupOpacity?: number;
      sidebarCollapsed?: boolean;
      initialOpenTarget?: { kind?: string; path?: string } | null;
    }) => (
      <div data-testid="library-view">
        <span>{props.initialOpenTarget?.path ?? 'no-path'}</span>
        <span>{props.focusChromeEnabled ? 'focus-on' : 'focus-off'}</span>
        <span>{`focus-opacity:${props.focusChromeGroupOpacity ?? 0}`}</span>
        <span>{props.sidebarCollapsed ? 'sidebar-collapsed' : 'sidebar-open'}</span>
      </div>
    );
    const CommandsView = () => <div data-testid="commands-view">Commands</div>;

    render(
      <BrowserLibraryApp
        LibrarianView={LibrarianView}
        CommandsView={CommandsView}
        ThemeProvider={ThemeProvider}
        initialOpenTarget={{
          kind: 'wiki',
          path: 'scratchpad/Launch.md',
          focusChrome: true,
        }}
      />,
    );

    expect(await screen.findByTestId('library-view')).toBeTruthy();
    expect(screen.getByText('scratchpad/Launch.md')).toBeTruthy();
    expect(screen.getByText('focus-on')).toBeTruthy();
    expect(screen.getByText('focus-opacity:0')).toBeTruthy();
    expect(screen.getByText('sidebar-collapsed')).toBeTruthy();
    expect(window.localStorage.setItem).not.toHaveBeenCalledWith('librarian-sidebar-collapsed', '1');

    fireEvent.mouseMove(window, { clientX: 20, clientY: 10 });
    await waitFor(() => expect(screen.getByText('focus-opacity:1')).toBeTruthy());

    fireEvent.mouseLeave(window, { clientX: -1, clientY: 10 });
    await waitFor(() => expect(screen.getByText('focus-opacity:0')).toBeTruthy());
  });

  it('checks pending native auto-open readings without continuous polling', async () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    pollStatus
      .mockResolvedValueOnce({
        pendingPath: '/tmp/Auto.md',
        edits: 1,
        threshold: 5,
        didReset: false,
      })
      .mockResolvedValue({
        pendingPath: null,
        edits: 1,
        threshold: 5,
        didReset: false,
      });

    const ThemeProvider = ({ children }: { children: React.ReactNode }) => <>{children}</>;
    const LibrarianView = (props: {
      initialReadingPath?: string | null;
      onInitialReadingConsumed?: () => void;
    }) => (
      <div data-testid="library-view">
        <span>{props.initialReadingPath ?? 'no-pending-reading'}</span>
        <button type="button" onClick={props.onInitialReadingConsumed}>Consume reading</button>
      </div>
    );
    const CommandsView = () => <div data-testid="commands-view" />;

    render(
      <BrowserLibraryApp
        LibrarianView={LibrarianView}
        CommandsView={CommandsView}
        ThemeProvider={ThemeProvider}
      />,
    );

    expect(await screen.findByText('/tmp/Auto.md')).toBeTruthy();

    fireEvent.click(screen.getByText('Consume reading'));
    await waitFor(() => expect(screen.getByText('no-pending-reading')).toBeTruthy());
    expect(setIntervalSpy).not.toHaveBeenCalledWith(expect.any(Function), 500);

    window.dispatchEvent(new Event('focus'));
    await waitFor(() => expect(pollStatus).toHaveBeenCalledTimes(2));
    expect(setIntervalSpy).not.toHaveBeenCalledWith(expect.any(Function), 500);
  });

  it('opens the native scratchpad flow from the configured focused hotkey', async () => {
    Object.defineProperty(window, 'hotkeyAPI', {
      configurable: true,
      value: {
        getHotkey: vi.fn(async () => 'Control+Option+Command+Space'),
      },
    });
    window.wikiAPI = {
      openScratchpadDefault: vi.fn(async () => ({ relPath: 'scratchpad/June 2.md', title: 'June 2' })),
      onOpenScratchpad: vi.fn(() => vi.fn()),
    } as any;
    const ThemeProvider = ({ children }: { children: React.ReactNode }) => <>{children}</>;
    const LibrarianView = (props: { initialOpenTarget?: { kind?: string; path?: string } | null }) => (
      <div data-testid="library-view">
        <span>{props.initialOpenTarget?.path ?? 'no-open-target'}</span>
      </div>
    );
    const CommandsView = () => <div data-testid="commands-view">Commands</div>;

    render(
      <BrowserLibraryApp
        LibrarianView={LibrarianView}
        CommandsView={CommandsView}
        ThemeProvider={ThemeProvider}
      />,
    );

    act(() => {
      openMarkdownListener?.({ kind: 'commands', path: 'commands' });
    });
    expect(await screen.findByTestId('commands-view')).toBeTruthy();

    await act(async () => {
      fireEvent.keyDown(document, {
        key: ' ',
        code: 'Space',
        metaKey: true,
        ctrlKey: true,
        altKey: true,
      });
    });

    expect(window.wikiAPI.openScratchpadDefault).toHaveBeenCalled();
    expect(await screen.findByTestId('library-view')).toBeTruthy();
    expect(screen.getByText('scratchpad/June 2.md')).toBeTruthy();
  });

  it('syncs Library editor preference changes into the Browser Library view', async () => {
    const sharedHotkeyChanged = vi.fn();
    const cursorBlinkChanged = vi.fn();
    const renderedClickModeChanged = vi.fn();
    const cursorStyleChanged = vi.fn();
    const cursorOpacityChanged = vi.fn();
    window.addEventListener('fieldtheory:shared-file-toggle-hotkey-changed', sharedHotkeyChanged);
    window.addEventListener(TEXT_CURSOR_BLINK_CHANGED_EVENT, cursorBlinkChanged);
    window.addEventListener(RENDERED_EDIT_CLICK_MODE_CHANGED_EVENT, renderedClickModeChanged);
    window.addEventListener(RENDERED_TEXT_CURSOR_STYLE_CHANGED_EVENT, cursorStyleChanged);
    window.addEventListener(RENDERED_BLOCK_CURSOR_OPACITY_CHANGED_EVENT, cursorOpacityChanged);

    await syncRendererStorage(async () => ({
      available: true,
      values: {
        [SHARED_FILE_TOGGLE_HOTKEY_STORAGE_KEY]: 'Command+Shift+R',
        [LINE_NUMBERS_STORAGE_KEY]: 'faded',
        [RENDERED_EDIT_CLICK_MODE_STORAGE_KEY]: 'click',
        [TEXT_CURSOR_BLINK_STORAGE_KEY]: 'false',
        [RENDERED_TEXT_CURSOR_STYLE_STORAGE_KEY]: 'bar',
        [RENDERED_BLOCK_CURSOR_OPACITY_STORAGE_KEY]: '0.8',
        'bookmarks-shortcut': 'hidden',
        'bookmarks-view-mode': 'list',
        'bookmarks-show-text': '1',
      },
    }) as any);

    expect(window.localStorage.setItem).toHaveBeenCalledWith(
      SHARED_FILE_TOGGLE_HOTKEY_STORAGE_KEY,
      'Command+Shift+R',
    );
    expect(window.localStorage.setItem).toHaveBeenCalledWith(LINE_NUMBERS_STORAGE_KEY, 'faded');
    expect(window.localStorage.setItem).toHaveBeenCalledWith(RENDERED_EDIT_CLICK_MODE_STORAGE_KEY, 'click');
    expect(window.localStorage.setItem).toHaveBeenCalledWith(TEXT_CURSOR_BLINK_STORAGE_KEY, 'false');
    expect(window.localStorage.setItem).toHaveBeenCalledWith(RENDERED_TEXT_CURSOR_STYLE_STORAGE_KEY, 'bar');
    expect(window.localStorage.setItem).toHaveBeenCalledWith(RENDERED_BLOCK_CURSOR_OPACITY_STORAGE_KEY, '0.8');
    expect(window.localStorage.setItem).not.toHaveBeenCalledWith('bookmarks-shortcut', 'hidden');
    expect(window.localStorage.setItem).toHaveBeenCalledWith('bookmarks-view-mode', 'list');
    expect(window.localStorage.setItem).toHaveBeenCalledWith('bookmarks-show-text', '1');
    expect(sharedHotkeyChanged).toHaveBeenCalledTimes(1);
    expect(cursorBlinkChanged).toHaveBeenCalledTimes(1);
    expect(renderedClickModeChanged).toHaveBeenCalledTimes(1);
    expect(cursorStyleChanged).toHaveBeenCalledTimes(1);
    expect(cursorOpacityChanged).toHaveBeenCalledTimes(1);

    window.removeEventListener('fieldtheory:shared-file-toggle-hotkey-changed', sharedHotkeyChanged);
    window.removeEventListener(TEXT_CURSOR_BLINK_CHANGED_EVENT, cursorBlinkChanged);
    window.removeEventListener(RENDERED_EDIT_CLICK_MODE_CHANGED_EVENT, renderedClickModeChanged);
    window.removeEventListener(RENDERED_TEXT_CURSOR_STYLE_CHANGED_EVENT, cursorStyleChanged);
    window.removeEventListener(RENDERED_BLOCK_CURSOR_OPACITY_CHANGED_EVENT, cursorOpacityChanged);
  });

  it('treats native renderer storage as authoritative on startup sync', async () => {
    window.localStorage.setItem('bookmarks-view-mode', 'canvas');
    window.localStorage.setItem('library-pinned-item-ids', '["stale"]');
    window.localStorage.setItem(LINE_NUMBERS_STORAGE_KEY, 'visible');
    window.localStorage.setItem('librarian-last-selection', '{"type":"wiki","relPath":"scratchpad/Browser"}');
    window.localStorage.setItem('librarian-immersive', 'true');
    window.localStorage.setItem('librarian-editor-session', '{"path":"scratchpad/Browser"}');

    await syncRendererStorage(async () => ({
      available: true,
      values: {
        'bookmarks-view-mode': 'list',
        'library-pinned-item-ids': '["native"]',
        [LINE_NUMBERS_STORAGE_KEY]: null,
        'librarian-last-selection': '{"type":"wiki","relPath":"scratchpad/Native"}',
        'librarian-immersive': 'false',
        'librarian-editor-session': '{"path":"scratchpad/Native"}',
      },
    }) as any);

    expect(window.localStorage.setItem).toHaveBeenCalledWith('bookmarks-view-mode', 'list');
    expect(window.localStorage.setItem).toHaveBeenCalledWith('library-pinned-item-ids', '["native"]');
    expect(window.localStorage.removeItem).toHaveBeenCalledWith(LINE_NUMBERS_STORAGE_KEY);
    expect(window.localStorage.setItem).toHaveBeenCalledWith('librarian-last-selection', '{"type":"wiki","relPath":"scratchpad/Native"}');
    expect(window.localStorage.setItem).toHaveBeenCalledWith('librarian-immersive', 'false');
    expect(window.localStorage.setItem).toHaveBeenCalledWith('librarian-editor-session', '{"path":"scratchpad/Native"}');
  });

  it('preserves existing renderer storage when the shared native store has not been created yet', async () => {
    window.localStorage.setItem('bookmarks-view-mode', 'canvas');
    window.localStorage.setItem('library-pinned-item-ids', '["existing"]');
    window.localStorage.setItem(LINE_NUMBERS_STORAGE_KEY, 'visible');
    vi.mocked(window.localStorage.setItem).mockClear();
    vi.mocked(window.localStorage.removeItem).mockClear();

    await syncRendererStorage(async () => ({
      available: false,
      values: {
        'bookmarks-view-mode': null,
        'library-pinned-item-ids': null,
        [LINE_NUMBERS_STORAGE_KEY]: null,
      },
    }) as any);

    expect(window.localStorage.setItem).not.toHaveBeenCalled();
    expect(window.localStorage.removeItem).not.toHaveBeenCalled();
  });

  it('applies native renderer-storage events immediately for synced preferences', () => {
    const cursorBlinkChanged = vi.fn();
    window.addEventListener(TEXT_CURSOR_BLINK_CHANGED_EVENT, cursorBlinkChanged);

    applyRendererStorageChangeFromNative(
      { key: TEXT_CURSOR_BLINK_STORAGE_KEY, value: 'false' },
      {
        setItem: window.localStorage.setItem.bind(window.localStorage),
        removeItem: window.localStorage.removeItem.bind(window.localStorage),
      },
    );

    expect(window.localStorage.setItem).toHaveBeenCalledWith(TEXT_CURSOR_BLINK_STORAGE_KEY, 'false');
    expect(cursorBlinkChanged).toHaveBeenCalledTimes(1);

    applyRendererStorageChangeFromNative(
      { key: TEXT_CURSOR_BLINK_STORAGE_KEY, value: null },
      {
        setItem: window.localStorage.setItem.bind(window.localStorage),
        removeItem: window.localStorage.removeItem.bind(window.localStorage),
      },
    );

    expect(window.localStorage.removeItem).toHaveBeenCalledWith(TEXT_CURSOR_BLINK_STORAGE_KEY);
    expect(cursorBlinkChanged).toHaveBeenCalledTimes(2);

    applyRendererStorageChangeFromNative(
      { key: 'fieldtheory.codexTerminal.visible', value: '1' },
      {
        setItem: window.localStorage.setItem.bind(window.localStorage),
        removeItem: window.localStorage.removeItem.bind(window.localStorage),
      },
    );

    expect(window.localStorage.setItem).not.toHaveBeenCalledWith('fieldtheory.codexTerminal.visible', '1');
    applyRendererStorageChangeFromNative(
      { key: 'librarian-last-selection', value: '{"type":"wiki","relPath":"scratchpad/Native"}' },
      {
        setItem: window.localStorage.setItem.bind(window.localStorage),
        removeItem: window.localStorage.removeItem.bind(window.localStorage),
      },
    );

    applyRendererStorageChangeFromNative(
      { key: 'librarian-immersive', value: 'true' },
      {
        setItem: window.localStorage.setItem.bind(window.localStorage),
        removeItem: window.localStorage.removeItem.bind(window.localStorage),
      },
    );

    applyRendererStorageChangeFromNative(
      { key: 'librarian-editor-session', value: '{"path":"scratchpad/Native"}' },
      {
        setItem: window.localStorage.setItem.bind(window.localStorage),
        removeItem: window.localStorage.removeItem.bind(window.localStorage),
      },
    );

    expect(window.localStorage.setItem).toHaveBeenCalledWith('librarian-last-selection', '{"type":"wiki","relPath":"scratchpad/Native"}');
    expect(window.localStorage.setItem).toHaveBeenCalledWith('librarian-immersive', 'true');
    expect(window.localStorage.setItem).toHaveBeenCalledWith('librarian-editor-session', '{"path":"scratchpad/Native"}');
    window.removeEventListener(TEXT_CURSOR_BLINK_CHANGED_EVENT, cursorBlinkChanged);
  });

  it('matches the native active Library file context success contract', async () => {
    const context = {
      type: 'wiki',
      rootPath: '/wiki',
      relPath: 'Plan',
      filePath: '/wiki/Plan.md',
      title: 'Plan',
    };
    const request = vi.fn(async () => ({ ok: true }));

    await expect(setBrowserActiveLibraryFileContext(request as any, context)).resolves.toBe(true);
    expect(request).toHaveBeenLastCalledWith('/native/current', {
      method: 'POST',
      json: context,
    });

    await expect(setBrowserActiveLibraryFileContext(request as any, null)).resolves.toBe(true);
    expect(request).toHaveBeenLastCalledWith('/native/current', {
      method: 'DELETE',
    });

    const failingRequest = vi.fn(async () => {
      throw new Error('offline');
    });
    await expect(setBrowserActiveLibraryFileContext(failingRequest as any, context)).resolves.toBe(false);
  });

  it('normalizes Browser-created commands to the native preload result shape', async () => {
    expect(normalizeBrowserCreatedCommand({ path: '/tmp/Commands/plan.md', name: 'plan' })).toEqual({
      path: '/tmp/Commands/plan.md',
      name: 'plan',
    });
    expect(normalizeBrowserCreatedCommand({ filePath: '/tmp/Commands/brief.md', displayName: 'brief' })).toEqual({
      path: '/tmp/Commands/brief.md',
      name: 'brief',
    });
    expect(normalizeBrowserCreatedCommand({ filePath: '/tmp/Commands/missing-name.md' })).toBeNull();
  });

  it('posts Browser command creation through the helper and returns the native result shape', async () => {
    const request = vi.fn(async () => ({
      command: {
        filePath: '/tmp/Commands/goal.md',
        displayName: 'goal',
        content: '# goal',
      },
    }));

    await expect(browserCreateCommand(request as any, '/tmp/Commands', 'goal', '# goal')).resolves.toEqual({
      path: '/tmp/Commands/goal.md',
      name: 'goal',
    });
    expect(request).toHaveBeenCalledWith('/native/commands/by-path', {
      method: 'POST',
      json: {
        directoryPath: '/tmp/Commands',
        name: 'goal',
        content: '# goal',
      },
    });
  });

  it('matches native launcher action methods in the Browser commands shim', async () => {
    const request = vi.fn(async (route: string) => ({
      result: route.includes('archive')
        ? { success: true }
        : { success: false, error: 'No active document' },
    }));

    await expect(browserArchiveActiveLibraryFile(request as any)).resolves.toEqual({ success: true });
    expect(request).toHaveBeenLastCalledWith('/native/commands/archive-active-library-file', {
      method: 'POST',
    });

    await expect(browserToggleActiveLibraryLineNumbers(request as any)).resolves.toEqual({
      success: false,
      error: 'No active document',
    });
    expect(request).toHaveBeenLastCalledWith('/native/commands/toggle-active-line-numbers', {
      method: 'POST',
    });
  });

  it('matches the native shell API promise contract in the Browser shim', async () => {
    const request = vi.fn(async () => ({ ok: true }));

    await expect(browserShellOpenExternal(request as any, 'https://fieldtheory.dev')).resolves.toBeUndefined();
    expect(request).toHaveBeenLastCalledWith('/native/shell/open-external', {
      method: 'POST',
      json: { href: 'https://fieldtheory.dev' },
    });

    await expect(browserShellShowItemInFolder(request as any, '/tmp/Plan.md')).resolves.toBeUndefined();
    expect(request).toHaveBeenLastCalledWith('/native/shell/show-item-in-folder', {
      method: 'POST',
      json: { filePath: '/tmp/Plan.md' },
    });

    await expect(browserShellSetRepresentedFilename(request as any, '/tmp/Plan.md', 'client-one')).resolves.toBeUndefined();
    expect(request).toHaveBeenLastCalledWith('/native/shell/represented-filename', {
      method: 'POST',
      json: { filePath: '/tmp/Plan.md', clientId: 'client-one' },
    });
  });

  it('keeps Browser shell fallbacks awaitable when the helper is unavailable', async () => {
    const failingRequest = vi.fn(async () => {
      throw new Error('offline');
    });
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);

    await expect(browserShellOpenExternal(failingRequest as any, 'https://fieldtheory.dev')).resolves.toBeUndefined();
    expect(openSpy).toHaveBeenCalledWith('https://fieldtheory.dev', '_blank', 'noopener,noreferrer');

    await expect(browserShellShowItemInFolder(failingRequest as any, '/tmp/Plan.md')).resolves.toBeUndefined();
  });

  it('refreshes native renderer storage on foreground events without polling', async () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    const request = vi.fn(async () => ({
      available: true,
      values: {
        [TEXT_CURSOR_BLINK_STORAGE_KEY]: 'false',
      },
    }));
    const setVisibilityState = (state: DocumentVisibilityState) => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        value: state,
      });
    };

    setVisibilityState('visible');
    const cleanup = startRendererStorageForegroundRefresh(request as any, {
      setItem: window.localStorage.setItem.bind(window.localStorage),
      removeItem: window.localStorage.removeItem.bind(window.localStorage),
    });

    expect(setIntervalSpy).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('focus'));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));

    setVisibilityState('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(1);

    setVisibilityState('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));

    cleanup();
  });
});
