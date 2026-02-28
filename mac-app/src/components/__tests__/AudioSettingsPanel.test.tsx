import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import AudioSettingsPanel from '../AudioSettingsPanel';

vi.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => ({
    theme: {
      text: '#111111',
      textSecondary: '#666666',
      error: '#ef4444',
      border: '#d1d5db',
      accent: '#0f766e',
      isDark: false,
      surface1: '#f3f4f6',
    },
  }),
}));

type InputMode = 'hot-mic' | 'standard';

function renderPanel() {
  return render(<AudioSettingsPanel />);
}

function isModeButtonActive(button: HTMLButtonElement): boolean {
  return button.style.backgroundColor !== 'transparent';
}

describe('AudioSettingsPanel input mode controls', () => {
  let inputModeListener: ((mode: InputMode) => void) | null = null;
  const setInputMode = vi.fn(async (mode: InputMode) => mode);
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  beforeEach(() => {
    inputModeListener = null;
    setInputMode.mockReset();
    setInputMode.mockImplementation(async (mode: InputMode) => mode);

    (window as any).platform = { isMacOS: true };
    (window as any).audioAPI = {
      getState: vi.fn(async () => ({
        devices: [
          { id: 'mic-1', name: 'Built-in Mic', isInput: true, isOutput: false },
        ],
        defaultInputId: 'mic-1',
        priorityMode: false,
        priorityDeviceId: null,
        userOverrideId: null,
      })),
      getFavoriteDeviceName: vi.fn(async () => null),
      onStateChanged: vi.fn(() => () => {}),
      setPriorityMode: vi.fn(async () => {}),
      setPriorityDevice: vi.fn(async () => {}),
      resetOverride: vi.fn(async () => {}),
      clearFavoriteDevice: vi.fn(async () => {}),
      setFavoriteDevice: vi.fn(async () => true),
    };
    (window as any).hotMicAPI = {
      getInputMode: vi.fn(async () => 'hot-mic'),
      getEnabled: vi.fn(async () => true),
      setInputMode,
      onInputModeChanged: vi.fn((cb: (mode: InputMode) => void) => {
        inputModeListener = cb;
        return () => {
          inputModeListener = null;
        };
      }),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete (window as any).platform;
    delete (window as any).audioAPI;
    delete (window as any).hotMicAPI;
  });

  afterAll(() => {
    consoleErrorSpy.mockRestore();
  });

  it('reverts selection if setting input mode fails', async () => {
    setInputMode.mockRejectedValueOnce(new Error('failed'));
    renderPanel();

    const hotMicButton = (await screen.findByRole('button', { name: 'Hot Mic' })) as HTMLButtonElement;
    const standardButton = screen.getByRole('button', { name: 'Standard' }) as HTMLButtonElement;

    await waitFor(() => {
      expect(isModeButtonActive(hotMicButton)).toBe(true);
      expect(isModeButtonActive(standardButton)).toBe(false);
    });

    await act(async () => {
      standardButton.click();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(setInputMode).toHaveBeenCalledWith('standard');
      expect(isModeButtonActive(hotMicButton)).toBe(true);
      expect(isModeButtonActive(standardButton)).toBe(false);
    });
  });

  it('updates mode selection from shared input mode change events', async () => {
    renderPanel();

    const hotMicButton = (await screen.findByRole('button', { name: 'Hot Mic' })) as HTMLButtonElement;
    const standardButton = screen.getByRole('button', { name: 'Standard' }) as HTMLButtonElement;

    await waitFor(() => {
      expect(isModeButtonActive(hotMicButton)).toBe(true);
      expect(isModeButtonActive(standardButton)).toBe(false);
    });

    act(() => {
      inputModeListener?.('standard');
    });

    await waitFor(() => {
      expect(isModeButtonActive(hotMicButton)).toBe(false);
      expect(isModeButtonActive(standardButton)).toBe(true);
    });
  });
});
