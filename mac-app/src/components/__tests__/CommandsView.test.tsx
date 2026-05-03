import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CommandsView from '../CommandsView';

vi.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => ({
    theme: {
      accent: '#0f766e',
      border: '#d1d5db',
      text: '#111111',
      textSecondary: '#666666',
      surface1: '#ffffff',
      surface2: '#f9fafb',
      isDark: false,
    },
  }),
}));

vi.mock('../../supabaseClient', () => ({
  supabase: null,
}));

describe('CommandsView command naming', () => {
  let insertMarkdownTextHandler: ((text: string) => void) | null = null;

  beforeEach(() => {
    insertMarkdownTextHandler = null;
    const existingCommand = {
      name: 'existing',
      displayName: 'existing',
      filePath: '/tmp/commands/existing.md',
    };

    Object.defineProperty(window, 'commandsAPI', {
      configurable: true,
      value: {
        initialize: vi.fn(async () => {}),
        getWatchedDirs: vi.fn(async () => [{ path: '/tmp/commands', enabled: true }]),
        createDefaultDirectory: vi.fn(async () => '/tmp/commands'),
        browseDirectory: vi.fn(async () => '/tmp/more-commands'),
        addWatchedDir: vi.fn(async (dirPath: string) => ({ path: dirPath, enabled: true, mobileSyncEnabled: false })),
        getCommands: vi.fn(async () => [existingCommand]),
        getCommandByPath: vi.fn(async () => ({
          ...existingCommand,
          lastModified: 0,
          content: '# existing\n\nRendered selection text\n',
        })),
        saveCommand: vi.fn(async () => true),
        createCommand: vi.fn(async () => null),
        onCommandsChanged: vi.fn(() => () => {}),
        openFieldTheoryMarkdown: vi.fn(async () => ({ success: true })),
      },
    });
    Object.defineProperty(window, 'librarianAPI', {
      configurable: true,
      value: {
        getReadings: vi.fn(async () => []),
        getReading: vi.fn(async () => null),
        onInsertMarkdownText: vi.fn((callback: (text: string) => void) => {
          insertMarkdownTextHandler = callback;
          return () => {
            insertMarkdownTextHandler = null;
          };
        }),
      },
    });
    Object.defineProperty(window, 'wikiAPI', {
      configurable: true,
      value: {
        getTree: vi.fn(async () => []),
        getPage: vi.fn(async () => null),
        createFile: vi.fn(async () => null),
        onPageChanged: vi.fn(() => () => {}),
      },
    });
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
      },
    });
    Object.defineProperty(window, 'alert', {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the create-name input editable when the command name already exists', async () => {
    render(<CommandsView onSwitchToClipboard={vi.fn()} />);

    await screen.findAllByText('existing');
    fireEvent.click(screen.getByTitle('Create new command'));

    const input = await screen.findByPlaceholderText('command name...') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'existing' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(window.commandsAPI?.createCommand).toHaveBeenCalledWith(
        '/tmp/commands',
        'existing',
        '# existing\n\n'
      );
    });

    expect(window.alert).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('A command with that name already exists.');
    expect(input.value).toBe('existing');

    fireEvent.change(input, { target: { value: 'existing-two' } });

    expect(screen.queryByRole('alert')).toBeNull();
    expect(input.value).toBe('existing-two');
  });

  it('adds a watched directory from the sidebar context menu', async () => {
    render(<CommandsView onSwitchToClipboard={vi.fn()} />);

    await screen.findAllByText('existing');
    fireEvent.contextMenu(screen.getByTitle('/tmp/commands'), { clientX: 10, clientY: 20 });
    fireEvent.click(await screen.findByText('Add Commands Folder...'));

    await waitFor(() => {
      expect(window.commandsAPI?.browseDirectory).toHaveBeenCalled();
      expect(window.commandsAPI?.addWatchedDir).toHaveBeenCalledWith('/tmp/more-commands');
    });
  });

  it('keeps the launcher-provided command selected after async command loading', async () => {
    const commands = [
      {
        name: 'assess',
        displayName: 'assess',
        filePath: '/tmp/commands/assess.md',
      },
      {
        name: 'refactor',
        displayName: 'refactor',
        filePath: '/tmp/commands/refactor.md',
      },
    ];
    window.commandsAPI!.getCommands = vi.fn(async () => commands);
    window.commandsAPI!.getCommandByPath = vi.fn(async (filePath: string) => ({
      name: filePath.endsWith('refactor.md') ? 'refactor' : 'assess',
      displayName: filePath.endsWith('refactor.md') ? 'refactor' : 'assess',
      filePath,
      lastModified: 0,
      documentVersion: { mtimeMs: 0, size: 0, sha256: 'test-version' },
      content: filePath.endsWith('refactor.md')
        ? '# refactor\n\nOpened from launcher\n'
        : '# assess\n\nWrong first command\n',
    }));

    render(
      <CommandsView
        onSwitchToClipboard={vi.fn()}
        initialCommandPath="/tmp/commands/refactor.md"
      />
    );

    expect(await screen.findByText('Opened from launcher')).toBeTruthy();
    expect(screen.queryByText('Wrong first command')).toBeNull();
  });

  it('inserts launcher wiki links into the selected command', async () => {
    render(<CommandsView onSwitchToClipboard={vi.fn()} />);

    await screen.findByText('Rendered selection text');

    act(() => {
      insertMarkdownTextHandler?.('[[refactor]]');
    });

    const editor = await screen.findByPlaceholderText('Write your command markdown here...') as HTMLTextAreaElement;
    expect(editor.value).toContain('Rendered selection text\n[[refactor]]');
  });

  it('uses shared history navigation from the commands toolbar and bracket shortcuts', async () => {
    const onNavigateBack = vi.fn();
    const onNavigateForward = vi.fn();
    render(
      <CommandsView
        onSwitchToClipboard={vi.fn()}
        canNavigateBack
        canNavigateForward
        onNavigateBack={onNavigateBack}
        onNavigateForward={onNavigateForward}
      />
    );

    await screen.findByText('Rendered selection text');
    fireEvent.click(screen.getByTitle('Back'));
    fireEvent.keyDown(window, { key: '[', metaKey: true });
    fireEvent.click(screen.getByTitle('Forward'));
    fireEvent.keyDown(window, { key: ']', metaKey: true });

    expect(onNavigateBack).toHaveBeenCalledTimes(2);
    expect(onNavigateForward).toHaveBeenCalledTimes(2);
  });

  it('uses a rendered/source toggle for internal commands', async () => {
    render(<CommandsView onSwitchToClipboard={vi.fn()} />);

    await screen.findByText('Rendered selection text');
    expect(screen.queryByText('Edit')).toBeNull();

    fireEvent.click(screen.getByLabelText('Markdown source'));

    expect(await screen.findByPlaceholderText('Write your command markdown here...')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Rendered'));

    await waitFor(() => {
      expect(screen.queryByPlaceholderText('Write your command markdown here...')).toBeNull();
    });
  });

  it('shows the shared linked-documents footer for command files', async () => {
    const existingCommand = {
      name: 'existing',
      displayName: 'existing',
      filePath: '/tmp/commands/existing.md',
    };
    const reviewCommand = {
      name: 'review',
      displayName: 'review',
      filePath: '/tmp/commands/review.md',
    };
    window.commandsAPI!.getCommands = vi.fn(async () => [existingCommand, reviewCommand]);
    window.commandsAPI!.getCommandByPath = vi.fn(async (filePath: string) => ({
      ...(filePath.endsWith('review.md') ? reviewCommand : existingCommand),
      lastModified: 0,
      documentVersion: { mtimeMs: 0, size: 0, sha256: 'test-version' },
      content: filePath.endsWith('review.md')
        ? '# review\n\nSee [[existing]].\n'
        : '# existing\n\nRendered selection text\n',
    }));

    render(<CommandsView onSwitchToClipboard={vi.fn()} />);

    await screen.findByText('Rendered selection text');

    expect(await screen.findByText('Linked')).toBeTruthy();
    expect(await screen.findByTitle('Links back to this document')).toBeTruthy();
    expect(screen.getAllByText('Command').length).toBeGreaterThan(0);
  });

  it('autosaves markdown edits without toolbar save controls', async () => {
    render(<CommandsView onSwitchToClipboard={vi.fn()} />);

    await screen.findByText('Rendered selection text');
    fireEvent.click(screen.getByLabelText('Markdown source'));

    const editor = await screen.findByPlaceholderText('Write your command markdown here...');
    expect(screen.queryByText('Save')).toBeNull();
    expect(screen.queryByText('Cancel')).toBeNull();

    vi.useFakeTimers();
    try {
      fireEvent.change(editor, { target: { value: '# existing\n\nChanged content\n' } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(450);
      });
    } finally {
      vi.useRealTimers();
    }

    await waitFor(() => {
      expect(window.commandsAPI?.saveCommand).toHaveBeenCalledWith(
        '/tmp/commands/existing.md',
        '# existing\n\nChanged content\n'
      );
    });
  });

  it('copies selected rendered command text before falling back to the file path', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    render(<CommandsView onSwitchToClipboard={vi.fn()} />);

    const selectedText = await screen.findByText('Rendered selection text');
    expect(screen.queryByText('Copy content')).toBeNull();
    const range = document.createRange();
    range.selectNodeContents(selectedText);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    fireEvent.keyDown(window, { key: 'c', metaKey: true });

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('Rendered selection text');
      expect(screen.getByLabelText('Copied')).toBeTruthy();
    });
    expect(writeText).not.toHaveBeenCalledWith('/tmp/commands/existing.md');

    selection?.removeAllRanges();
  });

  it('uses the focus chrome collapse path for the focus button and shortcut', async () => {
    const onFocusChromeShortcut = vi.fn();
    const onFocusChromeActiveChange = vi.fn();
    const { rerender } = render(
      <CommandsView
        onSwitchToClipboard={vi.fn()}
        onFocusChromeShortcut={onFocusChromeShortcut}
        onFocusChromeActiveChange={onFocusChromeActiveChange}
        sidebarCollapsed
      />
    );

    await screen.findByText('Rendered selection text');
    expect(screen.getByText('commands / existing.md')).toBeTruthy();
    onFocusChromeActiveChange.mockClear();

    fireEvent.click(screen.getByLabelText('Enter immersive view'));

    expect(onFocusChromeShortcut).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(onFocusChromeActiveChange).toHaveBeenLastCalledWith(true);
    });
    expect(onFocusChromeActiveChange.mock.calls.map(([active]) => active)).toEqual([true]);
    expect(screen.queryByText('commands / existing.md')).toBeNull();

    rerender(
      <CommandsView
        onSwitchToClipboard={vi.fn()}
        onFocusChromeShortcut={onFocusChromeShortcut}
        onFocusChromeActiveChange={onFocusChromeActiveChange}
        sidebarCollapsed={false}
      />
    );
    await waitFor(() => {
      expect(onFocusChromeActiveChange).toHaveBeenLastCalledWith(false);
    });
    expect(screen.getByText('commands / existing.md')).toBeTruthy();

    rerender(
      <CommandsView
        onSwitchToClipboard={vi.fn()}
        onFocusChromeShortcut={onFocusChromeShortcut}
        onFocusChromeActiveChange={onFocusChromeActiveChange}
        sidebarCollapsed
      />
    );
    await waitFor(() => {
      expect(onFocusChromeActiveChange).toHaveBeenLastCalledWith(true);
    });
    expect(screen.queryByText('commands / existing.md')).toBeNull();

    fireEvent.click(screen.getByLabelText('Exit immersive view'));

    await waitFor(() => {
      expect(onFocusChromeActiveChange).toHaveBeenLastCalledWith(false);
    });
    expect(screen.getByText('commands / existing.md')).toBeTruthy();

    fireEvent.keyDown(window, { key: '/', code: 'Slash', metaKey: true });

    expect(onFocusChromeShortcut).toHaveBeenCalledTimes(2);
    await waitFor(() => {
      expect(onFocusChromeActiveChange).toHaveBeenLastCalledWith(true);
    });
    expect(screen.queryByText('commands / existing.md')).toBeNull();
  });
});
