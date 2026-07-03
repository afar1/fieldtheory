import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MaxwellHistoryPopover from '../MaxwellHistoryPopover';
import type { MaxwellMemorySaveRequest, MaxwellRunSummary } from '../../../electron/main/types/commands';

vi.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => ({
    theme: {
      bg: '#ffffff',
      border: '#d1d5db',
      text: '#111111',
      textSecondary: '#666666',
      accent: '#0f766e',
      error: '#dc2626',
      isDark: false,
    },
  }),
}));

function makeRun(overrides: Partial<MaxwellRunSummary> = {}): MaxwellRunSummary {
  return {
    runId: 'maxwell-run-1',
    createdAt: 1_000,
    updatedAt: 4_420,
    status: 'success',
    commandName: 'tidy',
    targetPath: '/Users/afar/.fieldtheory/library/scratchpad/Today.md',
    targetRelPath: 'scratchpad/Today',
    targetType: 'wiki',
    mode: 'selection',
    summary: 'Changed 3 lines',
    errorMessage: null,
    model: 'gemma-4-E4B-it-Q4_K_M',
    harness: 'codex',
    memoryUsed: true,
    canUndo: true,
    canRedo: false,
    ...overrides,
  };
}

describe('MaxwellHistoryPopover', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'commandsAPI', {
      configurable: true,
      value: {
        listMaxwellRuns: vi.fn(async () => [makeRun()]),
        getMaxwellMemory: vi.fn(async () => ({
          enabled: true,
          content: 'Prefer terse notes.',
          path: '/Users/afar/Library/Application Support/Field Theory/maxwell/memory.md',
          updatedAt: 1_000,
          maxChars: 12_000,
        })),
        saveMaxwellMemory: vi.fn(async (request: MaxwellMemorySaveRequest) => ({
          success: true,
          memory: {
            enabled: request.enabled,
            content: request.content,
            path: '/Users/afar/Library/Application Support/Field Theory/maxwell/memory.md',
            updatedAt: 2_000,
            maxChars: 12_000,
          },
        })),
        undoMaxwellRun: vi.fn(),
        redoMaxwellRun: vi.fn(),
        onLocalCommandStatus: vi.fn(() => vi.fn()),
      },
    });
  });

  afterEach(() => {
    delete (window as any).commandsAPI;
    vi.clearAllMocks();
  });

  it('shows harness, model, mode, and elapsed time for a Maxwell run', async () => {
    render(<MaxwellHistoryPopover open onClose={vi.fn()} />);

    expect(await screen.findByText('tidy')).toBeTruthy();
    expect(screen.getByText('Codex harness / Memory / gemma-4-E4B-it-Q4_K_M / Selection / 3.4s')).toBeTruthy();
    expect(screen.getByText('Changed 3 lines')).toBeTruthy();
  });

  it('falls back to direct Gemma metadata when the run used the direct harness', async () => {
    window.commandsAPI!.listMaxwellRuns = vi.fn(async () => [
      makeRun({
        runId: 'maxwell-run-2',
        harness: 'direct',
        memoryUsed: false,
        model: null,
        mode: 'document',
        updatedAt: 1_420,
      }),
    ]);

    render(<MaxwellHistoryPopover open onClose={vi.fn()} />);

    expect(await screen.findByText('Direct Gemma / Document / 420ms')).toBeTruthy();
  });

  it('loads and saves explicit Maxwell memory', async () => {
    render(<MaxwellHistoryPopover open onClose={vi.fn()} />);

    fireEvent.click(screen.getByLabelText('Open Maxwell memory'));

    const editor = await screen.findByLabelText('Maxwell memory content') as HTMLTextAreaElement;
    expect(editor.value).toBe('Prefer terse notes.');

    fireEvent.change(editor, { target: { value: 'Prefer concise notes.' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(window.commandsAPI!.saveMaxwellMemory).toHaveBeenCalledWith({
        enabled: true,
        content: 'Prefer concise notes.',
      });
    });
  });
});
