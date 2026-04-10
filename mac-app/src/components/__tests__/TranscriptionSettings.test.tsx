import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParakeetSetupProgress, ParakeetStatus } from '../../types/window';
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
        lastErrorDetail: null,
        lastErrorAt: null,
      },
      {
        engine: 'parakeet-multilingual',
        label: 'Parakeet Multilingual',
        verified: false,
        needsReinstall: false,
        lastError: null,
        lastErrorDetail: null,
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
    onParakeetSetupProgress: vi.fn(() => () => {}),
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
    delete (window as any).diagnosticsAPI;
    delete (window as any).socialAPI;
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
              lastErrorDetail: null,
              lastErrorAt: null,
            },
            {
              engine: 'parakeet-multilingual',
              label: 'Parakeet Multilingual',
              verified: true,
              needsReinstall: false,
              lastError: null,
              lastErrorDetail: null,
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

  it('shows retry guidance for timeout failures instead of a reinstall-only message', async () => {
    (window as any).transcribeAPI = makeTranscribeApi({
      getParakeetStatus: vi.fn(async () =>
        makeParakeetStatus({
          engines: [
            {
              engine: 'parakeet',
              label: 'Parakeet English',
              verified: false,
              needsReinstall: true,
              lastError: 'Parakeet English server startup timed out (60s)',
              lastErrorDetail: 'Traceback: startup timed out',
              lastErrorAt: '2026-04-09T00:00:00.000Z',
            },
            {
              engine: 'parakeet-multilingual',
              label: 'Parakeet Multilingual',
              verified: false,
              needsReinstall: false,
              lastError: null,
              lastErrorDetail: null,
              lastErrorAt: null,
            },
          ],
        })
      ),
      getTranscriptionEngine: vi.fn(async (): Promise<'parakeet'> => 'parakeet'),
    });
    (window as any).hotMicAPI = makeHotMicApi();

    render(<TranscriptionSettings />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
      expect(screen.getByText(/needs attention/i)).toBeTruthy();
      expect(screen.getByText(/model did not finish downloading or loading in time/i)).toBeTruthy();
    });
  });

  it('shows Parakeet setup progress updates from the backend', async () => {
    let onParakeetSetupProgress: ((progress: ParakeetSetupProgress) => void) | null = null;

    (window as any).transcribeAPI = makeTranscribeApi({
      onParakeetSetupProgress: vi.fn((callback: (progress: ParakeetSetupProgress) => void) => {
        onParakeetSetupProgress = callback;
        return () => {};
      }),
    });
    (window as any).hotMicAPI = makeHotMicApi();

    render(<TranscriptionSettings />);

    await act(async () => {
      onParakeetSetupProgress?.({
        engine: 'parakeet',
        stage: 'downloading-model',
        message: 'Downloading the Parakeet model…',
        percent: 42,
        detail: 'Fetching 4 files: 42%',
      });
    });

    expect(screen.getByText(/Downloading the Parakeet model/i)).toBeTruthy();
    expect(screen.getByText('42%')).toBeTruthy();
    expect(screen.getByText(/Fetching 4 files: 42%/i)).toBeTruthy();
  });

  it('shows raw error details and lets the user open diagnostics or send them directly', async () => {
    const getDiagnosticsMarkdown = vi.fn(async () => '## Field Theory Diagnostics\n- ok');
    const submitTextFeedback = vi.fn(async () => ({ id: 'feedback-1' }));

    (window as any).diagnosticsAPI = { getDiagnosticsMarkdown };
    (window as any).socialAPI = { submitTextFeedback };
    (window as any).transcribeAPI = makeTranscribeApi({
      getParakeetStatus: vi.fn(async () =>
        makeParakeetStatus({
          engines: [
            {
              engine: 'parakeet',
              label: 'Parakeet English',
              verified: false,
              needsReinstall: true,
              lastError: 'Parakeet English server startup timed out (60s)',
              lastErrorDetail: 'Traceback: model verification timed out\nstderr line 2',
              lastErrorAt: '2026-04-09T00:00:00.000Z',
            },
            {
              engine: 'parakeet-multilingual',
              label: 'Parakeet Multilingual',
              verified: false,
              needsReinstall: false,
              lastError: null,
              lastErrorDetail: null,
              lastErrorAt: null,
            },
          ],
        })
      ),
      getTranscriptionEngine: vi.fn(async (): Promise<'parakeet'> => 'parakeet'),
    });
    (window as any).hotMicAPI = makeHotMicApi();

    render(<TranscriptionSettings />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Show details' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Open diagnostics' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Send diagnostics' })).toBeTruthy();
    });

    await act(async () => {
      screen.getByRole('button', { name: 'Show details' }).click();
    });

    expect(screen.getByText(/stderr line 2/i)).toBeTruthy();

    await act(async () => {
      screen.getByRole('button', { name: 'Open diagnostics' }).click();
    });

    expect(screen.getByText('Diagnostics')).toBeTruthy();

    await act(async () => {
      screen.getByRole('button', { name: 'Send diagnostics' }).click();
    });

    await waitFor(() => {
      expect(getDiagnosticsMarkdown).toHaveBeenCalled();
      expect(submitTextFeedback).toHaveBeenCalledWith('## Field Theory Diagnostics\n- ok');
      expect(screen.getByRole('button', { name: 'Sent diagnostics' })).toBeTruthy();
    });
  });
});
