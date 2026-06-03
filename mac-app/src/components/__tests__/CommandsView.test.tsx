import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CommandsView, { getCommandsContentBottomScrollSpace, getCommandsContentTopPadding } from '../CommandsView';

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

describe('CommandsView layout helpers', () => {
  it('clears the focus toolbar row when the toolbar overlays command content', () => {
    expect(getCommandsContentTopPadding({
      isEditing: false,
      focusChromeActive: false,
    })).toBe(28);
    expect(getCommandsContentTopPadding({
      isEditing: false,
      focusChromeActive: true,
    })).toBe(70);
  });

  it('keeps bottom room as rendered scroll space while focus chrome overlays the footer', () => {
    expect(getCommandsContentBottomScrollSpace({
      isEditing: false,
      focusChromeActive: false,
    })).toBe(44.4);
    expect(getCommandsContentBottomScrollSpace({
      isEditing: true,
      focusChromeActive: false,
    })).toBe(0);
    expect(getCommandsContentBottomScrollSpace({
      isEditing: false,
      focusChromeActive: true,
    })).toBe(44.4);
    expect(getCommandsContentBottomScrollSpace({
      isEditing: true,
      focusChromeActive: true,
    })).toBe(0);
  });
});

describe('CommandsView command naming', () => {
  let insertMarkdownTextHandler: ((text: string) => void) | null = null;
  let storage: Map<string, string>;

  beforeEach(() => {
    insertMarkdownTextHandler = null;
    storage = new Map();
    const existingCommand = {
      name: 'existing',
      displayName: 'existing',
      filePath: '/tmp/commands/existing.md',
      lastModified: 0,
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
        deleteCommand: vi.fn(async () => true),
        onCommandsChanged: vi.fn(() => () => {}),
        openFieldTheoryMarkdown: vi.fn(async () => ({ success: true })),
      },
    });
    Object.defineProperty(window, 'librarianAPI', {
      configurable: true,
      value: {
        getReadings: vi.fn(async () => []),
        getReading: vi.fn(async () => null),
        setMarkdownEditorFocused: vi.fn(),
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
    Object.defineProperty(window, 'fieldTheorySyncAPI', {
      configurable: true,
      value: {
        getStatus: vi.fn(async () => ({ enabled: false })),
        setLocalEnabled: vi.fn(async (enabled: boolean) => ({ enabled })),
      },
    });
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: vi.fn((key: string) => storage.get(key) ?? null),
        setItem: vi.fn((key: string, value: string) => {
          storage.set(key, value);
        }),
        removeItem: vi.fn((key: string) => {
          storage.delete(key);
        }),
      },
    });
    Object.defineProperty(window, 'alert', {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
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

  it('does not show fake shared commands when the real shared source is unavailable', async () => {
    window.fieldTheorySyncAPI!.getStatus = vi.fn(async () => ({ enabled: true }));
    window.commandsAPI!.getCommands = vi.fn(async () => []);

    render(<CommandsView onSwitchToClipboard={vi.fn()} />);

    fireEvent.click(await screen.findByText('Shared'));

    await waitFor(() => {
      expect(screen.queryByText('learn')).toBeNull();
      expect(screen.queryByText('refactor')).toBeNull();
      expect(screen.queryByText('review')).toBeNull();
    });
    expect(screen.getByText('Select a command')).toBeTruthy();
  });

  it('does not hydrate linked document bodies before a command is selected', async () => {
    window.commandsAPI!.getCommands = vi.fn(async () => []);
    window.commandsAPI!.getCommandByPath = vi.fn(async () => null);
    window.wikiAPI!.getTree = vi.fn(async () => [{
      name: 'scratchpad',
      files: [{
        relPath: 'scratchpad/linked-note',
        absPath: '/tmp/wiki/linked-note.md',
        name: 'linked-note',
        title: 'Linked Note',
        lastUpdated: 1,
      }],
    }]);
    window.wikiAPI!.getPage = vi.fn(async () => ({
      relPath: 'scratchpad/linked-note',
      absPath: '/tmp/wiki/linked-note.md',
      name: 'linked-note',
      title: 'Linked Note',
      lastUpdated: 1,
      content: 'Linked body',
      documentVersion: { mtimeMs: 1, size: 11, sha256: 'linked-note' },
    }));
    window.librarianAPI!.getReadings = vi.fn(async () => [{
      path: '/tmp/library/artifact.md',
      title: 'artifact.md',
      context: null,
      readingTime: null,
      modelSignature: null,
      createdAt: 1,
      mtime: 1,
    }]);
    window.librarianAPI!.getReading = vi.fn(async () => ({
      path: '/tmp/library/artifact.md',
      title: 'artifact.md',
      context: null,
      readingTime: null,
      modelSignature: null,
      createdAt: 1,
      mtime: 1,
      content: 'Artifact body',
      documentVersion: { mtimeMs: 1, size: 13, sha256: 'artifact' },
    }));

    render(<CommandsView onSwitchToClipboard={vi.fn()} />);

    await screen.findByText('Select a command');
    await waitFor(() => {
      expect(window.wikiAPI!.getTree).toHaveBeenCalled();
      expect(window.librarianAPI!.getReadings).toHaveBeenCalled();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(window.wikiAPI!.getPage).not.toHaveBeenCalled();
    expect(window.librarianAPI!.getReading).not.toHaveBeenCalled();
    expect(window.commandsAPI!.getCommandByPath).not.toHaveBeenCalled();
  });

  it('keeps the launcher-provided command selected after async command loading', async () => {
    const commands = [
      {
        name: 'assess',
        displayName: 'assess',
        filePath: '/tmp/commands/assess.md',
        lastModified: 0,
      },
      {
        name: 'refactor',
        displayName: 'refactor',
        filePath: '/tmp/commands/refactor.md',
        lastModified: 0,
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

  it('re-reports focused command editor state when the Browser helper reconnects', async () => {
    render(<CommandsView onSwitchToClipboard={vi.fn()} />);

    await screen.findByText('Rendered selection text');
    fireEvent.click(screen.getByLabelText('Switch to Markdown source'));
    const editor = await screen.findByPlaceholderText('Write your command markdown here...') as HTMLTextAreaElement;
    fireEvent.focus(editor);
    await waitFor(() => {
      expect(window.librarianAPI!.setMarkdownEditorFocused).toHaveBeenCalledWith(true);
    });

    vi.mocked(window.librarianAPI!.setMarkdownEditorFocused).mockClear();
    act(() => {
      window.dispatchEvent(new Event('fieldtheory:browser-helper-event-stream-open'));
    });

    expect(window.librarianAPI!.setMarkdownEditorFocused).toHaveBeenCalledWith(true);
  });

  it('keeps active command source edits when the command list refreshes', async () => {
    let commandsChanged: ((commands: Array<{
      name: string;
      displayName: string;
      filePath: string;
      lastModified: number;
    }>) => void) | null = null;
    window.commandsAPI!.onCommandsChanged = vi.fn((callback) => {
      commandsChanged = callback;
      return () => {};
    });

    render(<CommandsView onSwitchToClipboard={vi.fn()} />);

    await screen.findByText('Rendered selection text');
    fireEvent.click(screen.getByLabelText('Switch to Markdown source'));
    const editor = await screen.findByPlaceholderText('Write your command markdown here...') as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: '# existing\n\nlocal draft' } });

    act(() => {
      commandsChanged?.([{
        name: 'existing',
        displayName: 'existing',
        filePath: '/tmp/commands/existing.md',
        lastModified: 2,
      }]);
    });

    expect(editor.value).toBe('# existing\n\nlocal draft');
  });

  it('updates mounted command display preferences when native renderer storage changes', async () => {
    render(<CommandsView onSwitchToClipboard={vi.fn()} />);

    await screen.findByText('Rendered selection text');
    const sidebar = document.querySelector('[data-fieldtheory-collapsed-sidebar-pane="true"]') as HTMLElement;
    expect(sidebar.style.width).toBe('180px');

    act(() => {
      storage.set('commands-sidebar-width', '260');
      window.dispatchEvent(new CustomEvent('fieldtheory:renderer-storage-changed', {
        detail: { key: 'commands-sidebar-width', value: '260' },
      }));
    });

    await waitFor(() => {
      expect(sidebar.style.width).toBe('260px');
      expect(sidebar.style.minWidth).toBe('260px');
    });

    fireEvent.click(screen.getByTitle('Switch to Markdown source'));
    const editor = await screen.findByPlaceholderText('Write your command markdown here...') as HTMLTextAreaElement;
    expect(editor.style.fontSize).toBe('14px');

    act(() => {
      storage.set('commands-text-size', 'large');
      window.dispatchEvent(new CustomEvent('fieldtheory:renderer-storage-changed', {
        detail: { key: 'commands-text-size', value: 'large' },
      }));
    });

    await waitFor(() => {
      expect(editor.style.fontSize).toBe('16px');
    });
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

  it('places Show in Finder before the command breadcrumb', async () => {
    render(<CommandsView onSwitchToClipboard={vi.fn()} />);

    const breadcrumb = await screen.findByText('commands / existing.md');
    const folderButton = screen.getByLabelText('Show in Finder');

    expect(screen.getAllByLabelText('Show in Finder')).toHaveLength(1);
    expect(Boolean(folderButton.compareDocumentPosition(breadcrumb) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });

  it('uses a rendered/source toggle for internal commands', async () => {
    render(<CommandsView onSwitchToClipboard={vi.fn()} />);

    await screen.findByText('Rendered selection text');
    expect(screen.queryByText('Edit')).toBeNull();
    expect(screen.getByLabelText('Switch to Markdown source')).toBeTruthy();
    expect(screen.queryByLabelText('Switch to rendered view')).toBeNull();

    fireEvent.click(screen.getByLabelText('Switch to Markdown source'));

    const editor = await screen.findByPlaceholderText('Write your command markdown here...') as HTMLTextAreaElement;
    expect(editor.style.paddingBottom).toBe('0px');
    expect(editor.style.scrollPaddingBottom).toBe('22.2px');
    expect(screen.queryByLabelText('Switch to Markdown source')).toBeNull();
    expect(screen.getByLabelText('Switch to rendered view')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Switch to rendered view'));

    await waitFor(() => {
      expect(screen.queryByPlaceholderText('Write your command markdown here...')).toBeNull();
      expect(screen.getByLabelText('Switch to Markdown source')).toBeTruthy();
      expect(screen.queryByLabelText('Switch to rendered view')).toBeNull();
    });
  });

  it('requires Command-click before rendered commands open source by default', async () => {
    render(<CommandsView onSwitchToClipboard={vi.fn()} />);

    const renderedText = await screen.findByText('Rendered selection text');
    fireEvent.click(renderedText);

    expect(screen.queryByPlaceholderText('Write your command markdown here...')).toBeNull();

    fireEvent.click(renderedText, { metaKey: true });

    expect(await screen.findByPlaceholderText('Write your command markdown here...')).toBeTruthy();
  });

  it('applies common markdown formatting shortcuts in source mode', async () => {
    render(<CommandsView onSwitchToClipboard={vi.fn()} />);

    await screen.findByText('Rendered selection text');
    fireEvent.click(screen.getByLabelText('Switch to Markdown source'));

    const editor = await screen.findByPlaceholderText('Write your command markdown here...') as HTMLTextAreaElement;
    const selectionStart = editor.value.indexOf('Rendered selection text');
    const selectionEnd = selectionStart + 'Rendered selection text'.length;
    editor.setSelectionRange(selectionStart, selectionEnd);
    fireEvent.keyDown(editor, { key: 'b', metaKey: true });

    await waitFor(() => {
      expect((screen.getByPlaceholderText('Write your command markdown here...') as HTMLTextAreaElement).value)
        .toContain('**Rendered selection text**');
    });
  });

  it('shows the shared linked-documents footer for command files', async () => {
    const existingCommand = {
      name: 'existing',
      displayName: 'existing',
      filePath: '/tmp/commands/existing.md',
      lastModified: 0,
    };
    const reviewCommand = {
      name: 'review',
      displayName: 'review',
      filePath: '/tmp/commands/review.md',
      lastModified: 0,
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
    const linkedSection = await screen.findByLabelText('Linked');
    const bottomScrollSpace = screen.getByTestId('command-rendered-bottom-scroll-space');
    expect(bottomScrollSpace.style.height).toBe('44.4px');
    expect(Boolean(linkedSection.compareDocumentPosition(bottomScrollSpace) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(await screen.findByTitle('Links back to this document')).toBeTruthy();
    expect(screen.getAllByText('Command').length).toBeGreaterThan(0);
  });

  it('does not rebuild every linked command document when selection changes', async () => {
    const existingCommand = {
      name: 'existing',
      displayName: 'existing',
      filePath: '/tmp/commands/existing.md',
      lastModified: 0,
    };
    const reviewCommand = {
      name: 'review',
      displayName: 'review',
      filePath: '/tmp/commands/review.md',
      lastModified: 0,
    };
    const getCommandByPath = vi.fn(async (filePath: string) => ({
      ...(filePath.endsWith('review.md') ? reviewCommand : existingCommand),
      lastModified: 0,
      documentVersion: { mtimeMs: 0, size: 0, sha256: 'test-version' },
      content: filePath.endsWith('review.md')
        ? '# review\n\nReview body\n'
        : '# existing\n\nRendered selection text\n',
    }));
    window.commandsAPI!.getCommands = vi.fn(async () => [existingCommand, reviewCommand]);
    window.commandsAPI!.getCommandByPath = getCommandByPath;

    render(<CommandsView onSwitchToClipboard={vi.fn()} />);

    await screen.findByText('Rendered selection text');
    await waitFor(() => {
      expect(getCommandByPath.mock.calls.some(([path]) => path === reviewCommand.filePath)).toBe(true);
    });
    getCommandByPath.mockClear();

    fireEvent.click(screen.getAllByText('review')[0]);

    expect(await screen.findByText('Review body')).toBeTruthy();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(getCommandByPath.mock.calls.map(([path]) => path)).toEqual([reviewCommand.filePath]);
  });

  it('does not rebuild linked command documents for mtime-only command refreshes', async () => {
    const existingCommand = {
      name: 'existing',
      displayName: 'existing',
      filePath: '/tmp/commands/existing.md',
      lastModified: 0,
    };
    const reviewCommand = {
      name: 'review',
      displayName: 'review',
      filePath: '/tmp/commands/review.md',
      lastModified: 0,
    };
    let commandsChangedHandler: ((commands: typeof existingCommand[]) => void) | null = null;
    const getCommandByPath = vi.fn(async (filePath: string) => ({
      ...(filePath.endsWith('review.md') ? reviewCommand : existingCommand),
      filePath,
      lastModified: 0,
      documentVersion: { mtimeMs: 0, size: 0, sha256: 'test-version' },
      content: filePath.endsWith('review.md')
        ? '# review\n\nSee [[existing]].\n'
        : '# existing\n\nRendered selection text\n',
    }));
    window.commandsAPI!.getCommands = vi.fn(async () => [existingCommand, reviewCommand]);
    window.commandsAPI!.getCommandByPath = getCommandByPath;
    window.commandsAPI!.onCommandsChanged = vi.fn((callback) => {
      commandsChangedHandler = callback;
      return () => {};
    });

    render(<CommandsView onSwitchToClipboard={vi.fn()} />);

    await screen.findByText('Rendered selection text');
    await waitFor(() => {
      expect(getCommandByPath.mock.calls.some(([path]) => path === reviewCommand.filePath)).toBe(true);
    });
    getCommandByPath.mockClear();

    act(() => {
      commandsChangedHandler?.([
        { ...existingCommand, lastModified: 1 },
        { ...reviewCommand, lastModified: 1 },
      ]);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getCommandByPath).not.toHaveBeenCalled();
  });

  it('reloads commands when the Browser helper event stream reconnects', async () => {
    const existingCommand = {
      name: 'existing',
      displayName: 'existing',
      filePath: '/tmp/commands/existing.md',
      lastModified: 0,
    };
    const reviewCommand = {
      name: 'review',
      displayName: 'review',
      filePath: '/tmp/commands/review.md',
      lastModified: 1,
    };
    const getCommands = vi.fn()
      .mockResolvedValueOnce([existingCommand])
      .mockResolvedValueOnce([existingCommand, reviewCommand]);
    window.commandsAPI!.getCommands = getCommands;
    window.commandsAPI!.getCommandByPath = vi.fn(async (filePath: string) => ({
      ...(filePath.endsWith('review.md') ? reviewCommand : existingCommand),
      filePath,
      lastModified: filePath.endsWith('review.md') ? 1 : 0,
      documentVersion: { mtimeMs: 0, size: 0, sha256: filePath },
      content: filePath.endsWith('review.md')
        ? '# review\n\nReview content\n'
        : '# existing\n\nExisting content\n',
    }));

    render(<CommandsView onSwitchToClipboard={vi.fn()} />);

    await screen.findByText('Existing content');
    expect(screen.queryByText('review')).toBeNull();

    act(() => {
      window.dispatchEvent(new Event('fieldtheory:browser-helper-event-stream-open'));
    });

    await screen.findByText('review');
    expect(getCommands).toHaveBeenCalledTimes(2);
  });

  it('reloads artifact link sources when the Browser helper event stream reconnects', async () => {
    const getReadings = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        path: '/tmp/library/reconnect-artifact.md',
        title: 'Reconnect Artifact',
        context: null,
        readingTime: null,
        modelSignature: null,
        createdAt: 0,
        mtime: 0,
      }]);
    window.librarianAPI!.getReadings = getReadings;

    render(<CommandsView onSwitchToClipboard={vi.fn()} />);

    await screen.findByText('Rendered selection text');
    expect(getReadings).toHaveBeenCalledTimes(1);

    act(() => {
      window.dispatchEvent(new Event('fieldtheory:browser-helper-event-stream-open'));
    });

    await waitFor(() => {
      expect(getReadings).toHaveBeenCalledTimes(2);
    });
  });

  it('reloads wiki link sources when the Browser helper event stream reconnects', async () => {
    const getTree = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        name: 'scratchpad',
        files: [{
          relPath: 'scratchpad/reconnect-wiki',
          title: 'Reconnect Wiki',
        }],
      }]);
    window.wikiAPI!.getTree = getTree;

    render(<CommandsView onSwitchToClipboard={vi.fn()} />);

    await screen.findByText('Rendered selection text');
    expect(getTree).toHaveBeenCalledTimes(1);

    act(() => {
      window.dispatchEvent(new Event('fieldtheory:browser-helper-event-stream-open'));
    });

    await waitFor(() => {
      expect(getTree).toHaveBeenCalledTimes(2);
    });
  });

  it('autosaves markdown edits without toolbar save controls', async () => {
    render(<CommandsView onSwitchToClipboard={vi.fn()} />);

    await screen.findByText('Rendered selection text');
    fireEvent.click(screen.getByLabelText('Switch to Markdown source'));

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

  it('restores the last deleted command with Command+Z', async () => {
    window.commandsAPI!.createCommand = vi.fn(async () => ({ path: '/tmp/commands/existing.md', name: 'existing' }));
    render(<CommandsView onSwitchToClipboard={vi.fn()} />);

    const commandRows = await screen.findAllByText('existing');
    fireEvent.contextMenu(commandRows[0], { clientX: 10, clientY: 20 });
    fireEvent.click(await screen.findByText('Delete'));
    const dialog = await screen.findByRole('dialog', { name: 'Delete command?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(window.commandsAPI?.deleteCommand).toHaveBeenCalledWith('/tmp/commands/existing.md');
    });

    const editorLikeElement = document.createElement('div');
    editorLikeElement.contentEditable = 'true';
    document.body.appendChild(editorLikeElement);
    editorLikeElement.focus();
    fireEvent.keyDown(window, { key: 'z', metaKey: true });
    expect(window.commandsAPI?.createCommand).not.toHaveBeenCalled();
    editorLikeElement.remove();

    fireEvent.keyDown(window, { key: 'z', metaKey: true });

    await waitFor(() => {
      expect(window.commandsAPI?.createCommand).toHaveBeenCalledWith(
        '/tmp/commands',
        'existing.md',
        '# existing\n\nRendered selection text\n'
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
      expect(onFocusChromeActiveChange.mock.calls.at(-1)?.[0]).toBe(true);
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
      expect(onFocusChromeActiveChange.mock.calls.at(-1)?.[0]).toBe(false);
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
      expect(onFocusChromeActiveChange.mock.calls.at(-1)?.[0]).toBe(true);
    });
    expect(screen.queryByText('commands / existing.md')).toBeNull();

    fireEvent.click(screen.getByLabelText('Exit immersive view'));

    await waitFor(() => {
      expect(onFocusChromeActiveChange.mock.calls.at(-1)?.[0]).toBe(false);
    });
    expect(screen.getByText('commands / existing.md')).toBeTruthy();

    fireEvent.keyDown(window, { key: '/', code: 'Slash', metaKey: true });

    expect(onFocusChromeShortcut).toHaveBeenCalledTimes(2);
    await waitFor(() => {
      expect(onFocusChromeActiveChange.mock.calls.at(-1)?.[0]).toBe(true);
    });
    expect(screen.queryByText('commands / existing.md')).toBeNull();
  });

  it('uses the parent focus chrome state when switching into Commands', async () => {
    const onFocusChromeActiveChange = vi.fn();
    const onFocusChromeEnabledChange = vi.fn();
    const { rerender } = render(
      <CommandsView
        onSwitchToClipboard={vi.fn()}
        sidebarCollapsed
        focusChromeEnabled
        focusChromeGroupOpacity={0}
        onFocusChromeActiveChange={onFocusChromeActiveChange}
        onFocusChromeEnabledChange={onFocusChromeEnabledChange}
      />
    );

    await screen.findByText('Rendered selection text');

    await waitFor(() => {
      expect(onFocusChromeActiveChange.mock.calls.at(-1)).toEqual([true, false, 0]);
    });
    expect(screen.queryByText('commands / existing.md')).toBeNull();

    rerender(
      <CommandsView
        onSwitchToClipboard={vi.fn()}
        sidebarCollapsed
        focusChromeEnabled
        focusChromeGroupOpacity={0.5}
        onFocusChromeActiveChange={onFocusChromeActiveChange}
        onFocusChromeEnabledChange={onFocusChromeEnabledChange}
      />
    );

    await waitFor(() => {
      expect(onFocusChromeActiveChange.mock.calls.at(-1)).toEqual([true, true, 0.5]);
    });
    expect(screen.getByText('commands / existing.md')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Exit immersive view'));
    expect(onFocusChromeEnabledChange).toHaveBeenCalledWith(false);
  });

  it('temporarily reveals the collapsed sidebar only when the edge strip is clicked', async () => {
    const { container } = render(<CommandsView onSwitchToClipboard={vi.fn()} sidebarCollapsed />);

    await screen.findByText('Rendered selection text');

    const root = container.firstElementChild as HTMLElement;
    const getHoverStrip = () => root.querySelector(
      '[data-fieldtheory-collapsed-sidebar-hover-strip="true"]'
    ) as HTMLDivElement | null;
    const getSidebarPane = () => root.querySelector(
      '[data-fieldtheory-collapsed-sidebar-pane="true"]'
    ) as HTMLDivElement | null;
    expect(getHoverStrip()).toBeTruthy();
    expect(getHoverStrip()?.style.width).toBe('30px');
    const sidebarPane = getSidebarPane();
    expect(sidebarPane?.style.width).toBe('0px');

    fireEvent.mouseMove(root, { clientX: 80 });
    expect(Number(getHoverStrip()?.style.opacity)).toBeCloseTo(0.24);

    fireEvent.mouseOver(getHoverStrip()!, { clientX: 12 });
    expect(sidebarPane?.style.width).toBe('0px');

    fireEvent.mouseMove(root, { clientX: 20 });
    expect(sidebarPane?.style.width).toBe('0px');

    fireEvent.click(getHoverStrip()!);
    expect(sidebarPane?.style.width).toBe('180px');

    fireEvent.mouseLeave(getSidebarPane()!);
    expect(sidebarPane?.style.width).toBe('180px');

    fireEvent.mouseLeave(root);
    expect(sidebarPane?.style.width).toBe('180px');

    fireEvent.mouseDown(getSidebarPane()!);
    expect(sidebarPane?.style.width).toBe('180px');

    fireEvent.mouseDown(root);
    expect(sidebarPane?.style.width).toBe('0px');

    fireEvent.mouseMove(root, { clientX: 20 });
    fireEvent.mouseMove(root, { clientX: 22 });
    expect(sidebarPane?.style.width).toBe('0px');
  });
});
