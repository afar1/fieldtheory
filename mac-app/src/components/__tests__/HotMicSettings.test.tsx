import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HotMicSettings from '../HotMicSettings';

vi.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => ({
    theme: {
      text: '#111111',
      textSecondary: '#666666',
      border: '#d1d5db',
      success: '#16a34a',
      surface0: '#ffffff',
      surface1: '#f3f4f6',
      surface2: '#e5e7eb',
      isDark: false,
    },
  }),
}));

function makeHotMicApi({
  enabled = true,
  runtimeStatus,
}: {
  enabled?: boolean;
  runtimeStatus?: Partial<Awaited<ReturnType<NonNullable<Window['hotMicAPI']>['getRuntimeStatus']>>>;
} = {}) {
  return {
    getEnabled: vi.fn(async () => enabled),
    setEnabled: vi.fn(async () => undefined),
    getStatus: vi.fn(async () => ({ state: 'idle', muted: false })),
    getBackgroundFilterEnabled: vi.fn(async () => false),
    setBackgroundFilterEnabled: vi.fn(async () => undefined),
    getBackgroundFilterStrength: vi.fn(async () => 4),
    setBackgroundFilterStrength: vi.fn(async (value: number) => value),
    isHookInstalled: vi.fn(async () => false),
    getSubmitWord: vi.fn(async () => 'submit'),
    getPasteWords: vi.fn(async () => 'paste'),
    getCancelWords: vi.fn(async () => 'cancel'),
    getScrapWords: vi.fn(async () => 'scrap'),
    getHotkey: vi.fn(async () => ''),
    getSwitchWords: vi.fn(async () => 'switch'),
    getOpenAppPrefixes: vi.fn(async () => 'open'),
    getQuitAppPrefixes: vi.fn(async () => 'quit'),
    getPrevWindowWords: vi.fn(async () => 'previous'),
    getNewWindowWords: vi.fn(async () => 'new'),
    getCloseWindowWords: vi.fn(async () => 'close'),
    getMinimizePhrases: vi.fn(async () => 'minimize'),
    getHidePhrases: vi.fn(async () => 'hide'),
    getQuitPhrases: vi.fn(async () => 'quit'),
    getRunClaudeWords: vi.fn(async () => 'run claude'),
    getRunCodexWords: vi.fn(async () => 'run codex'),
    getFocusPhrases: vi.fn(async () => 'focus'),
    getCascadePhrases: vi.fn(async () => 'cascade'),
    getRestartServerWords: vi.fn(async () => 'restart server'),
    getRestartServerCommand: vi.fn(async () => ''),
    getShowWordCount: vi.fn(async () => false),
    getSystemCommands: vi.fn(async () => ({})),
    getRectangleCommands: vi.fn(async () => ({})),
    getRuntimeStatus: vi.fn(async () => ({
      state: 'idle',
      engineReady: true,
      engine: {
        selectedEngine: 'parakeet',
        readiness: 'ready',
        detail: 'Parakeet English server is ready',
        source: 'global',
        whisperModel: null,
        fallbackAvailable: false,
      },
      condition: 'idle',
      queueDepth: 0,
      lastChunkAgeMs: null,
      chunksReceived: 0,
      whisperFallbackActive: false,
      micHealthy: true,
      ...runtimeStatus,
    })),
    onStateChanged: vi.fn(() => () => {}),
    onStatusChanged: vi.fn(() => () => {}),
    onInputModeChanged: vi.fn(() => () => {}),
    onHotkeyChanged: vi.fn(() => () => {}),
    onRuntimeStatusChanged: vi.fn(() => () => {}),
  };
}

describe('HotMicSettings runtime engine display', () => {
  beforeEach(() => {
    (window as any).hotMicAPI = makeHotMicApi();
    (window as any).transcribeAPI = {
      getSelectedModel: vi.fn(async () => 'small'),
      getModelDownloadStatus: vi.fn(async () => ({ small: false })),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete (window as any).hotMicAPI;
    delete (window as any).transcribeAPI;
  });

  it('does not show or query a Whisper model for Hot Mic readiness', async () => {
    render(<HotMicSettings />);

    await waitFor(() => {
      expect((window as any).hotMicAPI.getRuntimeStatus).toHaveBeenCalled();
    });

    expect(screen.queryByText('Whisper Model')).toBeNull();
    expect(screen.queryByText(/Whisper fallback model/i)).toBeNull();
    expect((window as any).transcribeAPI.getSelectedModel).not.toHaveBeenCalled();
    expect((window as any).transcribeAPI.getModelDownloadStatus).not.toHaveBeenCalled();
  });

  it('allows enabling Hot Mic while the engine is warming', async () => {
    (window as any).hotMicAPI = makeHotMicApi({
      enabled: false,
      runtimeStatus: {
        engineReady: false,
        engine: {
          selectedEngine: 'parakeet',
          readiness: 'warming',
          detail: 'Parakeet English server is warming',
          source: 'global',
          whisperModel: null,
          fallbackAvailable: false,
        },
      },
    });

    render(<HotMicSettings />);

    const enableToggle = await screen.findByTitle('Hot Mic disabled');
    expect(enableToggle.hasAttribute('disabled')).toBe(false);

    fireEvent.click(enableToggle);

    await waitFor(() => {
      expect((window as any).hotMicAPI.setEnabled).toHaveBeenCalledWith(true);
    });
  });

  it('blocks enabling Hot Mic when the engine is not installed', async () => {
    (window as any).hotMicAPI = makeHotMicApi({
      enabled: false,
      runtimeStatus: {
        engineReady: false,
        engine: {
          selectedEngine: 'parakeet',
          readiness: 'not-installed',
          detail: 'Parakeet is not installed',
          source: 'global',
          whisperModel: null,
          fallbackAvailable: false,
        },
      },
    });

    render(<HotMicSettings />);

    const enableToggle = await screen.findByTitle('Hot Mic disabled');
    await waitFor(() => {
      expect(enableToggle.hasAttribute('disabled')).toBe(true);
    });
  });

  it('keeps Background Voice Filter configurable when Hot Mic is off', async () => {
    (window as any).hotMicAPI = makeHotMicApi({ enabled: false });

    render(<HotMicSettings />);

    const filterRow = await screen.findByText('Background Voice Filter');
    const filterToggle = filterRow.closest('div')?.querySelector('button');
    expect(filterToggle).toBeTruthy();
    expect(filterToggle!.hasAttribute('disabled')).toBe(false);

    fireEvent.click(filterToggle!);

    await waitFor(() => {
      expect((window as any).hotMicAPI.setBackgroundFilterEnabled).toHaveBeenCalledWith(true);
    });
  });

  it('updates the displayed mode toggle hotkey when another settings surface changes it', async () => {
    const hotkeyListeners: Array<(hotkey: string | null) => void> = [];
    (window as any).hotMicAPI = {
      ...makeHotMicApi(),
      getHotkey: vi.fn(async () => 'F13'),
      onHotkeyChanged: vi.fn((callback: (hotkey: string | null) => void) => {
        hotkeyListeners.push(callback);
        return () => {};
      }),
    };

    render(<HotMicSettings />);

    expect(await screen.findByText('F13')).toBeTruthy();

    await act(async () => {
      hotkeyListeners.forEach((callback) => callback('Shift+Command+H'));
    });

    expect(await screen.findByText('Shift+Command+H')).toBeTruthy();
  });
});
