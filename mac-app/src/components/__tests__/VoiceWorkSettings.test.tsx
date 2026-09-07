import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VoiceWorkAPI, VoiceWorkState } from '../../../electron/shared/voiceWork';
import SettingsPanel from '../SettingsPanel';
import VoiceWorkSettings from '../VoiceWorkSettings';

vi.mock('../../supabaseClient', () => ({ supabase: null }));
vi.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => ({
    theme: {
      text: '#111111', textSecondary: '#666666', border: '#d1d5db', accent: '#0f766e',
      success: '#16a34a', warning: '#d97706', error: '#ef4444', info: '#2563eb',
      selectedBg: '#f3f4f6', surface1: '#ffffff', surface2: '#f8fafc', isDark: false,
    },
  }),
}));

const projectFolder = '/Users/andrew/Projects/Field Theory';
function readyState(): VoiceWorkState {
  return {
    settings: { enabled: false, workspacePath: projectFolder },
    status: 'disabled',
    codex: { available: true, signedIn: true },
  };
}

describe('VoiceWorkSettings', () => {
  let current: VoiceWorkState;
  let api: VoiceWorkAPI;
  let publish: (state: VoiceWorkState) => void;
  const unsubscribe = vi.fn();

  beforeEach(() => {
    current = readyState();
    const stored = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
      removeItem: (key: string) => stored.delete(key),
    });
    api = {
      getState: vi.fn(async () => current),
      refreshStatus: vi.fn(async () => current),
      updateSettings: vi.fn(async (settings) => {
        current = { ...current, settings: { ...current.settings, ...settings } };
        return current;
      }),
      chooseWorkspace: vi.fn(async () => projectFolder),
      openTask: vi.fn(async () => ({ opened: true })),
      onStateChanged: vi.fn((listener) => { publish = listener; return unsubscribe; }),
    };
    window.voiceWorkAPI = api;
  });

  afterEach(() => {
    cleanup();
    delete window.voiceWorkAPI;
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  async function waitForReadiness() {
    await waitFor(() => expect((screen.getByRole('button', { name: 'Check again' }) as HTMLButtonElement).disabled).toBe(false));
  }

  it('opens from Settings and enables only after an explicit toggle', async () => {
    render(<SettingsPanel initialSection="account" />);
    fireEvent.click(screen.getByRole('button', { name: /Voice requests/ }));
    await waitForReadiness();
    expect(screen.getByText(projectFolder)).toBeTruthy();
    expect(api.updateSettings).not.toHaveBeenCalled();
    const toggle = screen.getByRole('switch', { name: 'Enable voice requests' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));
    expect(api.updateSettings).toHaveBeenCalledWith({ enabled: true });
  });

  it.each([
    ['missing Codex', { codex: { available: false, signedIn: null } }],
    ['Codex signed out', { codex: { available: true, signedIn: false } }],
    ['Codex sign-in unknown', { codex: { available: true, signedIn: null } }],
    ['Field Theory signed out', { status: 'signed_out' }],
    ['missing folder', { settings: { enabled: false, workspacePath: null } }],
  ] satisfies Array<[string, Partial<VoiceWorkState>]>)('cannot enable with %s', async (_name, overrides) => {
    current = { ...current, ...overrides };
    render(<VoiceWorkSettings />);
    await waitForReadiness();
    const toggle = screen.getByRole('switch', { name: 'Enable voice requests' });
    expect((toggle as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(toggle);
    expect(api.updateSettings).not.toHaveBeenCalled();
  });

  it('canceling folder selection changes nothing, and selecting a folder does not enable work', async () => {
    current.settings.workspacePath = null;
    vi.mocked(api.chooseWorkspace).mockResolvedValueOnce(null);
    render(<VoiceWorkSettings />);
    await waitForReadiness();

    fireEvent.click(screen.getByRole('button', { name: 'Choose folder…' }));
    await screen.findByRole('button', { name: 'Choose folder…' });
    expect(api.updateSettings).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Choose folder…' }));
    await screen.findByText(projectFolder);
    expect(api.updateSettings).toHaveBeenCalledWith({ workspacePath: projectFolder });
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false');
    expect((screen.getByRole('switch') as HTMLButtonElement).disabled).toBe(false);
  });

  it('keeps the switch off when saving fails and makes the retry actionable', async () => {
    vi.mocked(api.updateSettings).mockRejectedValueOnce(new Error('internal failure must not be displayed'));
    render(<VoiceWorkSettings />);
    await waitForReadiness();
    fireEvent.click(screen.getByRole('switch'));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Could not turn on Voice requests. Check again and try once more.');
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false');
    expect(screen.queryByText(/internal failure/)).toBeNull();
    expect((screen.getByRole('button', { name: 'Check again' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('allows pausing despite lost sign-in, while locking the selected folder until paused', async () => {
    current = { ...current, settings: { ...current.settings, enabled: true }, status: 'signed_out', codex: { available: true, signedIn: false } };
    render(<VoiceWorkSettings />);
    await waitForReadiness();
    expect((screen.getByRole('button', { name: 'Change folder…' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Pause Voice requests to change this folder.')).toBeTruthy();
    expect((screen.getByRole('switch') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('switch'));
    await waitFor(() => expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false'));
    expect(api.updateSettings).toHaveBeenCalledWith({ enabled: false });
  });

  it('updates the task outcome from events and offers Open task only when supported', async () => {
    current.lastTask = { threadId: 'thread-123', title: 'Field Theory - Investigate delay', status: 'running' };
    render(<VoiceWorkSettings />);
    await waitForReadiness();
    expect(screen.queryByRole('button', { name: 'Open task' })).toBeNull();

    act(() => publish({
      ...current,
      lastTask: { ...current.lastTask!, status: 'completed', summary: 'The delay occurs while loading the model.', canOpen: true },
    }));
    expect(screen.getByText('Latest voice task · Done')).toBeTruthy();
    expect(screen.getByText('The delay occurs while loading the model.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open task' }));
    await waitFor(() => expect(api.openTask).toHaveBeenCalledWith('thread-123'));
  });

  it('preserves newer live state over a late initial snapshot and removes the listener on close', async () => {
    let resolveInitial!: (state: VoiceWorkState) => void;
    vi.mocked(api.getState).mockReturnValue(new Promise((resolve) => { resolveInitial = resolve; }));
    const { unmount } = render(<VoiceWorkSettings />);
    act(() => publish({
      ...current, status: 'working', settings: { ...current.settings, enabled: true },
      lastTask: { threadId: 'live-task', status: 'working', title: 'Field Theory - Active request' },
    }));
    await act(async () => resolveInitial(readyState()));
    expect(screen.getByText('Field Theory - Active request')).toBeTruthy();
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
    unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('makes the full result readable even when the native task cannot be opened', async () => {
    const finalResponse = 'The first run loads the model.\n\nKeep the model loaded between recordings to reduce the delay.';
    current.lastTask = {
      threadId: 'completed-task', status: 'completed', summary: 'The investigation is complete.',
      finalResponse, canOpen: false,
    };
    render(<VoiceWorkSettings />);
    await waitForReadiness();
    expect(screen.queryByRole('button', { name: 'Open task' })).toBeNull();
    const summary = screen.getByText('Read full response');
    const details = summary.closest('details') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    fireEvent.click(summary);
    expect(details.open).toBe(true);
    expect(details.textContent).toContain(finalResponse);
  });

  it('shows the actual clarification when a task needs the user', async () => {
    current.lastTask = { threadId: 'question-task', status: 'needs_user', summary: 'An answer is needed.', question: 'Which folder should contain the report?', finalResponse: '', canOpen: false };
    render(<VoiceWorkSettings />);
    await waitForReadiness();
    expect(screen.getByText('Which folder should contain the report?')).toBeTruthy();
  });

  it('drops a folder choice if the signed-in state changes while the picker is open', async () => {
    let resolvePicker!: (path: string) => void;
    vi.mocked(api.chooseWorkspace).mockReturnValue(new Promise((resolve) => { resolvePicker = resolve; }));
    render(<VoiceWorkSettings />);
    await waitForReadiness();
    fireEvent.click(screen.getByRole('button', { name: 'Change folder…' }));
    act(() => publish({ ...readyState(), status: 'signed_out' }));
    await act(async () => resolvePicker('/Users/andrew/Projects/Another project'));
    expect(api.updateSettings).not.toHaveBeenCalled();
    expect(screen.queryByText('/Users/andrew/Projects/Another project')).toBeNull();
    expect(screen.getByRole('alert').textContent).toBe('Voice requests changed while the folder picker was open. Check again, then choose the folder.');
  });
});
