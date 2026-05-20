import { render, screen, waitFor } from '@testing-library/react';
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

function makeHotMicApi() {
  return {
    getEnabled: vi.fn(async () => true),
    setEnabled: vi.fn(async () => undefined),
    getStatus: vi.fn(async () => ({ state: 'idle', muted: false })),
    getBackgroundFilterEnabled: vi.fn(async () => false),
    getBackgroundFilterStrength: vi.fn(async () => 4),
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
      engineReady: true,
      engine: {
        selectedEngine: 'parakeet',
        readiness: 'ready',
        detail: 'Parakeet English server is ready',
      },
      condition: 'idle',
      queueDepth: 0,
      chunksReceived: 0,
      whisperFallbackActive: false,
      micHealthy: true,
    })),
    onStateChanged: vi.fn(() => () => {}),
    onStatusChanged: vi.fn(() => () => {}),
    onInputModeChanged: vi.fn(() => () => {}),
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
});
