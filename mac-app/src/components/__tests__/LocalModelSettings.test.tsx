import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LocalModelSettings from '../LocalModelSettings';

vi.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => ({
    theme: {
      text: '#111111',
      textSecondary: '#666666',
      border: '#d1d5db',
      accent: '#0f766e',
      success: '#16a34a',
      warning: '#d97706',
      info: '#2563eb',
      selectedBg: '#f3f4f6',
      surface1: '#ffffff',
      surface2: '#f8fafc',
      isDark: false,
    },
  }),
}));

const modelId = 'gemma-4-E4B-it-Q4_K_M';
const defaultMeetingSummaryPrompt = 'Preserve Notes, Transcript, speaker labels if present, links, figures, and checkboxes.';

function makeModel() {
  return {
    name: 'Gemma 4 E4B Instruct Q4_K_M',
    filename: 'gemma-4-E4B-it-Q4_K_M.gguf',
    sizeBytes: 5_335_289_824,
    description: 'Offline local command model',
    license: 'Apache-2.0',
    sourceUrl: 'https://huggingface.co/ggml-org/gemma-4-E4B-it-GGUF',
    baseModelUrl: 'https://huggingface.co/google/gemma-4-E4B-it',
  };
}

function makeHealth(status: 'ready' | 'missing' | 'corrupt') {
  return {
    status,
    modelPath: status === 'ready'
      ? '/Users/afar/Library/Application Support/Atomic Chat/data/llamacpp/models/unsloth/gemma-4-E4B-it-Q4_K_M/model.gguf'
      : '/Users/afar/Library/Application Support/Field Theory/models/gemma-4-E4B-it-Q4_K_M.gguf',
    fileSizeBytes: status === 'ready' ? 4_977_164_416 : null,
    expectedSizeBytes: 5_335_289_824,
    minValidSizeBytes: 2_667_649_912,
  };
}

describe('LocalModelSettings', () => {
  const setLocalLLMSelected = vi.fn(async () => ({ success: true }));
  const setUseLocalLLM = vi.fn(async () => ({ success: true }));
  const downloadLocalLLM = vi.fn(async () => ({ success: true, reusedExisting: true }));
  const saveMeetingSummaryPrompt = vi.fn(async (prompt: string) => ({ success: true, prompt }));
  const resetMeetingSummaryPrompt = vi.fn(async () => ({ success: true, prompt: defaultMeetingSummaryPrompt }));

  beforeEach(() => {
    vi.clearAllMocks();
    (window as any).clipboardAPI = {
      getLocalLLMModels: vi.fn(async () => ({ [modelId]: makeModel() })),
      getLocalLLMSelected: vi.fn(async () => modelId),
      getLocalLLMHealth: vi.fn(async () => ({ [modelId]: makeHealth('ready') })),
      setLocalLLMSelected,
      setUseLocalLLM,
      downloadLocalLLM,
      getMeetingSummaryPrompt: vi.fn(async () => defaultMeetingSummaryPrompt),
      saveMeetingSummaryPrompt,
      resetMeetingSummaryPrompt,
    };
  });

  afterEach(() => {
    delete (window as any).clipboardAPI;
  });

  it('offers to use an already-present local model instead of downloading it', async () => {
    render(<LocalModelSettings />);

    const button = await screen.findByRole('button', { name: 'Use local model' });
    expect(screen.getByText('Ready')).toBeTruthy();
    expect(screen.getByText(/Atomic Chat/)).toBeTruthy();

    await act(async () => {
      button.click();
      await Promise.resolve();
    });

    expect(setLocalLLMSelected).toHaveBeenCalledWith(modelId);
    expect(setUseLocalLLM).toHaveBeenCalledWith(true);
    expect(downloadLocalLLM).not.toHaveBeenCalled();
    expect(await screen.findByText('Using the existing local model.')).toBeTruthy();
  });

  it('runs the install path when the model is missing', async () => {
    (window as any).clipboardAPI.getLocalLLMHealth.mockResolvedValue({ [modelId]: makeHealth('missing') });

    render(<LocalModelSettings />);

    const button = await screen.findByRole('button', { name: 'Find or download' });
    await act(async () => {
      button.click();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(downloadLocalLLM).toHaveBeenCalledWith(modelId);
    });
    expect(await screen.findByText('Found and linked the existing local model.')).toBeTruthy();
  });

  it('shows copyable Gemma 4 terminal commands that Maxwell can use', async () => {
    (window as any).clipboardAPI.getLocalLLMHealth.mockResolvedValue({ [modelId]: makeHealth('missing') });

    render(<LocalModelSettings />);

    expect(await screen.findByText('Terminal setup')).toBeTruthy();
    expect(screen.getByText(/Maxwell checks ~\/\.fieldtheory\/models\/gemma-4-E4B-it-Q4_K_M\.gguf automatically/i)).toBeTruthy();
    expect(screen.getByText(/curl -L --fail --continue-at - -o ~\/\.fieldtheory\/models\/gemma-4-E4B-it-Q4_K_M\.gguf/i)).toBeTruthy();
    expect(screen.getByText(/ln -sf "\/path\/to\/gemma-4-E4B-it-Q4_K_M\.gguf" ~\/\.fieldtheory\/models\/gemma-4-E4B-it-Q4_K_M\.gguf/i)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Copy' })).toHaveLength(2);
  });

  it('saves a customized meeting notes prompt', async () => {
    render(<LocalModelSettings />);

    const textarea = await screen.findByLabelText('Meeting notes prompt') as HTMLTextAreaElement;
    expect(textarea.value).toContain('speaker labels');

    fireEvent.change(textarea, { target: { value: 'Write brief meeting notes with strong action items.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save prompt' }));

    await waitFor(() => {
      expect(saveMeetingSummaryPrompt).toHaveBeenCalledWith('Write brief meeting notes with strong action items.');
    });
    expect(await screen.findByText('Meeting notes prompt saved.')).toBeTruthy();
  });

  it('resets the meeting notes prompt to the default', async () => {
    render(<LocalModelSettings />);

    const textarea = await screen.findByLabelText('Meeting notes prompt') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Custom style.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));

    await waitFor(() => {
      expect(resetMeetingSummaryPrompt).toHaveBeenCalled();
    });
    expect(textarea.value).toBe(defaultMeetingSummaryPrompt);
  });
});
