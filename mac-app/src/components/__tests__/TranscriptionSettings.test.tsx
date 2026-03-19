import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParakeetStatus } from '../../types/window';
import TranscriptionSettings from '../TranscriptionSettings';

vi.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => ({
    theme: {
      text: '#111111',
      textSecondary: '#666666',
      error: '#ef4444',
      errorBg: '#fef2f2',
      border: '#d1d5db',
      accent: '#0f766e',
      info: '#2563eb',
      warning: '#d97706',
      success: '#16a34a',
      selectedBg: '#f3f4f6',
      isDark: false,
      surface1: '#f3f4f6',
    },
  }),
}));

function makeParakeetStatus(overrides?: Partial<ParakeetStatus>): ParakeetStatus {
  return {
    runtimeInstalled: true,
    pythonPath: '/tmp/parakeet/python',
    scriptPath: '/tmp/parakeet/script.py',
    cacheDir: '/tmp/parakeet/cache',
    cacheExists: true,
    serverState: 'idle',
    activeEngine: null,
    engines: [
      {
        engine: 'parakeet',
        label: 'Parakeet English',
        verified: false,
        needsReinstall: false,
        lastError: null,
        lastErrorAt: null,
      },
      {
        engine: 'parakeet-multilingual',
        label: 'Parakeet Multilingual',
        verified: false,
        needsReinstall: false,
        lastError: null,
        lastErrorAt: null,
      },
    ],
    ...overrides,
  };
}

function makeTranscribeApi(overrides: Partial<Window['transcribeAPI']> = {}) {
  return {
    getStatus: vi.fn(async () => 'idle'),
    getModelStatus: vi.fn(async () => 'downloaded'),
    getHotkey: vi.fn(async () => 'Option+/'),
    getAvailableModels: vi.fn(async () => ({})),
    getSelectedModel: vi.fn(async () => 'small'),
    getModelDownloadStatus: vi.fn(async () => ({ small: true })),
    getDownloadingModels: vi.fn(async () => []),
    getAbandonHotkey: vi.fn(async () => 'Escape'),
    getTranscriptionEngine: vi.fn(async () => 'parakeet'),
    getParakeetStatus: vi.fn(async () => makeParakeetStatus()),
    setupParakeet: vi.fn(async () => ({ success: true })),
    uninstallParakeet: vi.fn(async () => ({ success: true })),
    onStatusChanged: vi.fn(() => () => {}),
    onResult: vi.fn(() => () => {}),
    onError: vi.fn(() => () => {}),
    onModelDownloadProgress: vi.fn(() => () => {}),
    onHotkeyChanged: vi.fn(() => () => {}),
    ...overrides,
  };
}

function makeHotMicApi() {
  return {
    getHotkey: vi.fn(async () => null),
    setHotkey: vi.fn(async () => true),
  };
}

describe('TranscriptionSettings Parakeet labels', () => {
  beforeEach(() => {
    (window as any).platform = { isMacOS: true };
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete (window as any).platform;
    delete (window as any).transcribeAPI;
    delete (window as any).hotMicAPI;
  });

  it('shows Verifying while a verify action is in flight', async () => {
    let resolveSetup!: (value: { success: boolean }) => void;
    const setupParakeet = vi.fn(
      () =>
        new Promise<{ success: boolean }>((resolve) => {
          resolveSetup = resolve;
        })
    );

    (window as any).transcribeAPI = makeTranscribeApi({ setupParakeet });
    (window as any).hotMicAPI = makeHotMicApi();

    render(<TranscriptionSettings />);

    const verifyButtons = await screen.findAllByRole('button', { name: 'Verify' });

    await act(async () => {
      verifyButtons[0].click();
    });

    expect(screen.getByText('Verifying...')).toBeTruthy();

    await act(async () => {
      resolveSetup({ success: true });
      await Promise.resolve();
    });
  });

  it('uses Selected and Installed badges for healthy engines', async () => {
    (window as any).transcribeAPI = makeTranscribeApi({
      getParakeetStatus: vi.fn(async () =>
        makeParakeetStatus({
          activeEngine: 'parakeet',
          engines: [
            {
              engine: 'parakeet',
              label: 'Parakeet English',
              verified: true,
              needsReinstall: false,
              lastError: null,
              lastErrorAt: null,
            },
            {
              engine: 'parakeet-multilingual',
              label: 'Parakeet Multilingual',
              verified: true,
              needsReinstall: false,
              lastError: null,
              lastErrorAt: null,
            },
          ],
        })
      ),
    });
    (window as any).hotMicAPI = makeHotMicApi();

    render(<TranscriptionSettings />);

    await waitFor(() => {
      expect(screen.getByText('Selected')).toBeTruthy();
      expect(screen.getByText('Installed')).toBeTruthy();
    });
  });
});
