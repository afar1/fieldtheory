import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  beforeEach(() => {
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
        createCommand: vi.fn(async () => null),
        onCommandsChanged: vi.fn(() => () => {}),
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
    render(
      <CommandsView
        onSwitchToClipboard={vi.fn()}
        onFocusChromeShortcut={onFocusChromeShortcut}
        onFocusChromeActiveChange={onFocusChromeActiveChange}
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
