import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AmbientSettings from '../AmbientSettings';

vi.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => ({
    theme: {
      text: '#111111',
      textSecondary: '#666666',
      error: '#ef4444',
      info: '#2563eb',
      success: '#16a34a',
      isDark: false,
    },
  }),
}));

describe('AmbientSettings', () => {
  const initial = {
    instructions: 'Investigate uncertainty before responding.',
    accessMode: 'codex-defaults' as const,
  };

  beforeEach(() => {
    (window as any).commandsAPI = {
      getAmbientSettings: vi.fn(async () => initial),
      saveAmbientSettings: vi.fn(async (settings: AmbientSettingsValue) => ({
        success: true,
        settings,
        appliedToActiveTask: true,
      })),
      resetAmbientSettings: vi.fn(async () => ({
        success: true,
        settings: initial,
        appliedToActiveTask: false,
      })),
    };
  });

  afterEach(() => {
    delete (window as any).commandsAPI;
    vi.clearAllMocks();
  });

  it('shows the exact prompt and applies edits to an active Ambient task', async () => {
    render(<AmbientSettings />);

    const prompt = await screen.findByLabelText('Staffer instructions sent to Codex');
    expect((prompt as HTMLTextAreaElement).value).toBe(initial.instructions);
    fireEvent.change(prompt, { target: { value: 'Research one useful answer.\nDo not summarize.' } });
    expect(screen.getByText('Controlled in Codex')).toBeTruthy();

    await act(async () => {
      screen.getByRole('button', { name: 'Save and apply' }).click();
    });

    expect(window.commandsAPI?.saveAmbientSettings).toHaveBeenCalledWith({
      instructions: 'Research one useful answer.\nDo not summarize.',
      accessMode: 'codex-defaults',
    });
    expect(await screen.findByText('Saved and applied to the active Ambient task.')).toBeTruthy();
  });

  it('resets through the backend and reports that the default applies next meeting', async () => {
    render(<AmbientSettings />);
    await screen.findByDisplayValue(initial.instructions);

    await act(async () => {
      screen.getByRole('button', { name: 'Reset to Field Theory default' }).click();
    });

    await waitFor(() => expect(window.commandsAPI?.resetAmbientSettings).toHaveBeenCalledOnce());
    expect(screen.getByText('Saved for the next Ambient meeting.')).toBeTruthy();
  });
});
