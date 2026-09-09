import { launcherFolderSection } from '../../electron/shared/launcherSections';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../components/ScrollDiagnosticsHUD', () => ({ default: () => null }));
vi.mock('../components/RiverShareLauncher', () => ({ default: () => null }));
vi.mock('../utils/scrollDiagnostics.bootstrap', () => ({}));
vi.mock('../hooks/useInteractionFpsSampler', () => ({ useInteractionFpsSampler: () => () => {} }));

const files = Array.from({ length: 45 }, (_, i) => ({ kind: 'file', relPath: `note-${i}`, absPath: `/library/note-${i}.md`, name: `note-${i}`, title: `Markdown note ${i}`, lastUpdated: 1000 - i }));
const bookmarks = Array.from({ length: 45 }, (_, i) => ({ id: String(i), text: `Bookmark example ${i}`, authorHandle: 'writer', authorName: 'Writer', url: `https://x.com/writer/status/${i}`, postedAt: new Date(1700000000000 - i * 1000).toISOString() }));
const clips = Array.from({ length: 75 }, (_, i) => ({ id: i, type: 'text', content: `Clipboard example ${i}`, createdAt: 1000 - i, stackId: null, useImprovedVersion: false }));
let reset: (payload?: unknown) => void;
const commands = {
  getCommands: vi.fn(async (): Promise<Array<{ name: string; displayName: string; filePath: string; lastModified: number }>> => []), getCommandDirectories: vi.fn(async () => []),
  getHandoffs: vi.fn(async () => []), getLauncherSettings: vi.fn(async () => ({})),
  getLauncherContext: vi.fn(async () => ({ fieldTheoryActive: true, hasActiveLibraryFileContext: true })),
  getActiveLibraryFileContext: vi.fn(async () => ({ filePath: '/library/active.md' })),
  warmLauncherFileIndex: vi.fn(async () => ({ started: false })),
  searchLauncherFiles: vi.fn(async () => ({ files: [{ name: 'Library', displayName: 'Library folder', filePath: '/library', isDirectory: true, lastModified: 1 }], indexing: false, indexedAt: 1 })),
  openLauncherFile: vi.fn(async () => ({ success: true })),
  launcherResize: vi.fn(), launcherClose: vi.fn(),
  onLauncherReset: vi.fn((callback) => { reset = callback; return () => {}; }),
  getLauncherFileIcon: vi.fn(async () => ({ success: false })),
  openFieldTheoryMarkdown: vi.fn(async () => ({ success: true })),
  insertClipboardItemsAsMarkdown: vi.fn(async () => ({ success: true })),
  insertMarkdownText: vi.fn(async () => ({ success: true })),
  getMarkdownPreview: vi.fn(async (filePath: string) => ({ filePath, title: 'Note', content: 'Markdown preview content' })),
  launcherPreviewShow: vi.fn(), launcherPreviewHide: vi.fn(),
};
const clipboard = { queryItems: vi.fn(async (options: { search?: string; offset: number; limit: number }) => clips.filter(item => !options.search || item.content.toLowerCase().includes(options.search.toLowerCase())).slice(options.offset, options.offset + options.limit)), getUniqueStacks: vi.fn(async () => []), getHotkeys: vi.fn(async () => ({})) };
let CommandLauncher: typeof import('../command-launcher').CommandLauncher;

beforeAll(async () => {
  Object.assign(window, {
    commandsAPI: commands, clipboardAPI: clipboard,
    themeAPI: { initialTheme: false, getTheme: async () => false },
    transcribeAPI: {}, squaresAPI: {},
    libraryAPI: { getRoots: vi.fn(async () => [{ path: '/library', label: 'Library', builtin: true, tree: files }]) },
    bookmarksAPI: { getAll: vi.fn(async () => ({ bookmarks })), getAuthors: async () => [] },
    recentAPI: { list: async () => files.map((file, i) => ({ kind: 'wiki', path: file.relPath, title: file.title, lastOpenedAt: 1000 - i })) },
  });
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key), clear: () => storage.clear() });
  ({ CommandLauncher } = await import('../command-launcher'));
});
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); commands.getLauncherSettings.mockResolvedValue({}); commands.getCommands.mockResolvedValue([]); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
afterAll(() => vi.unstubAllGlobals());

async function mount(source: string) {
  const settings = await commands.getLauncherSettings() as { sections?: string[] };
  commands.getLauncherSettings.mockResolvedValue({ ...settings, sections: settings.sections ?? [source] });
  localStorage.setItem('fieldTheory.launcher.defaultPanelSource.v1', source);
  const result = render(<CommandLauncher />);
  await act(async () => reset({ generation: 1 }));
  await waitFor(() => expect(result.container.querySelectorAll('[data-item-index]')).toHaveLength(20), { timeout: 4000 });
  return { ...result, input: screen.getByRole('textbox') };
}

describe('launcher source navigation', () => {
  it('opens on the first enabled folder, wraps both ways, and ignores the highlighted row and a disabled saved section', async () => {
    const inbox = launcherFolderSection({ path: '/library', label: 'Inbox' });
    commands.getLauncherSettings.mockResolvedValue({ sections: [inbox, 'recents', 'clipboard', 'river'] });
    const { input } = await mount('bookmarks');
    expect(screen.getByRole('button', { name: 'Collapse Inbox' })).toBeTruthy();
    for (const label of ['Recents', 'Clipboard', 'River', 'Inbox']) {
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      fireEvent.keyDown(input, { key: 'Tab' });
      await screen.findByRole('button', { name: `Collapse ${label}` });
    }
    for (const label of ['River', 'Clipboard', 'Recents', 'Inbox']) {
      fireEvent.keyDown(input, { key: 'Tab', shiftKey: true });
      await screen.findByRole('button', { name: `Collapse ${label}` });
    }
    expect(screen.queryByRole('button', { name: /Bookmarks/ })).toBeNull();
    expect(commands.openFieldTheoryMarkdown).not.toHaveBeenCalled();
    expect(commands.insertMarkdownText).not.toHaveBeenCalled();
  });

  it('restores the last section and falls back when it is disabled', async () => {
    commands.getLauncherSettings.mockResolvedValue({ sections: ['clipboard', 'recents', 'river'] });
    const { input } = await mount('clipboard');
    expect(screen.getByRole('button', { name: 'Collapse Clipboard' })).toBeTruthy();
    fireEvent.keyDown(input, { key: 'Tab' });
    await screen.findByRole('button', { name: 'Collapse Recents' });
    await act(async () => reset({ generation: 2 }));
    await screen.findByRole('button', { name: 'Collapse Recents' });
    expect(localStorage.getItem('fieldTheory.launcher.defaultPanelSource.v1')).toBe('recents');
    commands.getLauncherSettings.mockResolvedValue({ sections: ['river', 'clipboard'] });
    await act(async () => reset({ generation: 3 }));
    await screen.findByRole('button', { name: 'Collapse River' });
  });

  it('ignores settings from an older open after the current open has loaded its order', async () => {
    const pending: Array<(settings: { sections: string[] }) => void> = [];
    commands.getLauncherSettings.mockImplementation(() => new Promise(resolve => { pending.push(resolve); }));
    render(<CommandLauncher />);
    await waitFor(() => expect(pending.length).toBe(1));
    await act(async () => reset({ generation: 2 }));
    await waitFor(() => expect(pending.length).toBe(2));
    await act(async () => pending[1]({ sections: ['clipboard', 'recents'] }));
    await screen.findByRole('button', { name: 'Collapse Clipboard' });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Tab' });
    await screen.findByRole('button', { name: 'Collapse Recents' });
    await act(async () => pending[0]({ sections: ['bookmarks', 'river'] }));
    expect(screen.getByRole('button', { name: 'Collapse Recents' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Switch to Clipboard' })).toBeTruthy();
  });

  it.each([
    ['Markdown note 12', false, 'Clipboard'],
    ['Markdown note 12', true, 'River'],
    ['Clipboard example', false, 'Clipboard'],
    ['Clipboard example', true, 'River'],
    ['. Clipboard example', false, 'Clipboard'],
    ['. Clipboard example', true, 'River'],
  ])('cycles from search %s with reverse=%s', async (query, shiftKey, expected) => {
    commands.getLauncherSettings.mockResolvedValue({ sections: ['recents', 'clipboard', 'river'] });
    const { container, input } = await mount('recents');
    fireEvent.change(input, { target: { value: query } });
    await waitFor(() => expect(container.querySelector('[data-item-index="0"]')?.textContent).toContain(String(query).replace(/^\. /, '')));
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Tab', shiftKey });
    await screen.findByRole('button', { name: `Collapse ${expected}` });
    expect((input as HTMLInputElement).value).toBe('');
    expect(input.getAttribute('aria-label')).toBe('Command search');
  });

  it.each([false, true])('cycles from a selected filesystem directory without entering it, reverse=%s', async shiftKey => {
    commands.getLauncherSettings.mockResolvedValue({ sections: ['recents', 'clipboard', 'river'] });
    const { container, input } = await mount('recents');
    fireEvent.change(input, { target: { value: "'Library" } });
    await waitFor(() => expect(container.querySelector('[data-item-index="0"]')?.textContent).toContain('Library folder'));
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Tab', shiftKey });
    await screen.findByRole('button', { name: `Collapse ${shiftKey ? 'River' : 'Clipboard'}` });
    expect(commands.openLauncherFile).not.toHaveBeenCalled();
    expect(input.getAttribute('aria-label')).toBe('Command search');
  });

  it('enters a filesystem directory with Enter', async () => {
    const { container, input } = await mount('recents');
    fireEvent.change(input, { target: { value: "'Library" } });
    await waitFor(() => expect(container.querySelector('[data-item-index="0"]')?.textContent).toContain('Library folder'));
    fireEvent.keyDown(input, { key: 'Enter' });
    await screen.findByRole('textbox', { name: 'Library folder search' });
    await waitFor(() => expect(container.querySelector('[data-item-index="0"]')?.textContent).toContain('Markdown note'));
    expect(commands.openLauncherFile).not.toHaveBeenCalled();
    expect(commands.launcherClose).not.toHaveBeenCalled();
  });

  it('lets Enter enter a Library folder, then Tab leaves its nested search for the next section', async () => {
    commands.getLauncherSettings.mockResolvedValue({ sections: ['recents', 'clipboard', 'river'] });
    const originalRoots = window.libraryAPI!.getRoots;
    window.libraryAPI!.getRoots = vi.fn(async () => [{
      path: '/library', label: 'Library', builtin: true,
      tree: [...files, { kind: 'dir', name: 'Projects', relPath: 'Projects', absPath: '/library/Projects', children: [
        { kind: 'file', name: 'nested', relPath: 'Projects/nested', absPath: '/library/Projects/nested.md', title: 'Nested project note', lastUpdated: 2000 },
      ] }],
    }]) as typeof originalRoots;
    try {
      const { container, input } = await mount('recents');
      fireEvent.change(input, { target: { value: 'Projects' } });
      await waitFor(() => expect(container.querySelector('[data-item-index="0"]')?.textContent).toContain('Projects'));
      fireEvent.keyDown(input, { key: 'Enter' });
      await screen.findByRole('textbox', { name: 'Projects search' });
      await waitFor(() => expect(container.querySelector('[data-item-index="0"]')?.textContent).toContain('Nested project note'));
      fireEvent.change(input, { target: { value: 'Nested' } });
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      fireEvent.keyDown(input, { key: 'Tab' });
      await screen.findByRole('button', { name: 'Collapse Clipboard' });
      expect(input.getAttribute('aria-label')).toBe('Command search');
      expect(commands.launcherClose).not.toHaveBeenCalled();
    } finally { window.libraryAPI!.getRoots = originalRoots; }
  });

  it('lets Enter enter a source and Shift-Tab leave it for the previous configured section', async () => {
    commands.getLauncherSettings.mockResolvedValue({ sections: ['recents', 'clipboard', 'river'] });
    const { container, input } = await mount('recents');
    fireEvent.change(input, { target: { value: 'wiki' } });
    await waitFor(() => expect(container.querySelector('[data-item-index="0"]')?.textContent).toContain('Wiki'));
    fireEvent.keyDown(input, { key: 'Enter' });
    await screen.findByRole('textbox', { name: 'wiki search' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Tab', shiftKey: true });
    await screen.findByRole('button', { name: 'Collapse River' });
    expect(input.getAttribute('aria-label')).toBe('Command search');
    expect(commands.launcherClose).not.toHaveBeenCalled();
  });

  it('keeps a single enabled section populated when Tab wraps to itself', async () => {
    const { container, input } = await mount('clipboard');
    for (const shiftKey of [false, true]) {
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      fireEvent.keyDown(input, { key: 'Tab', shiftKey });
      await waitFor(() => expect(container.querySelectorAll('[data-item-index]')).toHaveLength(20));
      expect(screen.getByRole('button', { name: 'Collapse Clipboard' })).toBeTruthy();
    }
  });

  it('cycles configured sections including River and keeps the full panel size', async () => {
    commands.getLauncherSettings.mockResolvedValue({ sections: ['recents', 'river'] });
    const originalRoots = window.libraryAPI!.getRoots;
    window.libraryAPI!.getRoots = vi.fn(async () => [
      { path: '/library', label: 'Library', builtin: true, tree: files },
      { path: '/river', label: 'River (shared)', builtin: false, tree: files.map(file => ({ ...file, absPath: `/river/${file.name}.md`, title: `Shared ${file.title}` })) },
    ]) as typeof originalRoots;
    try {
      const { container, input } = await mount('recents');
      expect(input.getAttribute('placeholder')).toBe('Search');
      fireEvent.keyDown(input, { key: 'Tab' });
      await waitFor(() => expect(container.querySelector('[data-item-index="0"]')?.textContent).toContain('Shared Markdown note'));
      expect(screen.getByRole('button', { name: 'Switch to Recents' })).toBeTruthy();
      fireEvent.keyDown(input, { key: 'Tab' });
      await waitFor(() => expect(screen.getByRole('button', { name: 'Switch to River' })).toBeTruthy());
      expect(commands.launcherResize.mock.calls.every(([height]) => height === 430)).toBe(true);
    } finally { window.libraryAPI!.getRoots = originalRoots; commands.getLauncherSettings.mockResolvedValue({}); }
  });

  it('browses a configured folder but searches all Field Theory content when typing', async () => {
    const folder = launcherFolderSection({ path: '/library', label: 'My notes' });
    commands.getLauncherSettings.mockResolvedValue({ sections: ['recents', folder] });
    const originalRoots = window.libraryAPI!.getRoots;
    window.libraryAPI!.getRoots = vi.fn(async () => [
      { path: '/library', label: 'Library', builtin: true, tree: files },
      { path: '/other', label: 'Other', builtin: false, tree: files.map(file => ({ ...file, absPath: `/other/${file.name}.md`, title: `Outside ${file.title}` })) },
    ]) as typeof originalRoots;
    try {
      const { container, input } = await mount('recents');
      fireEvent.keyDown(input, { key: 'Tab' });
      await waitFor(() => expect(container.querySelector('[data-item-index="0"]')?.textContent).toContain('Markdown note'));
      expect(container.textContent).not.toContain('Outside Markdown');
      fireEvent.change(input, { target: { value: 'Clipboard example' } });
      await waitFor(() => expect(container.textContent).toContain('Clipboard example'));
      fireEvent.change(input, { target: { value: 'Outside Markdown note 12' } });
      await waitFor(() => expect(container.querySelector('[data-item-index="0"]')?.textContent).toContain('Outside Markdown note 12'));
    } finally { window.libraryAPI!.getRoots = originalRoots; commands.getLauncherSettings.mockResolvedValue({}); }
  });

  it.each(['recents', 'clipboard', 'bookmarks'])('arrows through multiple pages of %s and invokes the chosen row', async source => {
    const { container, input } = await mount(source);
    for (let i = 0; i < 23; i++) fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(container.querySelector('[data-item-index="23"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-item-index]')).toHaveLength(40);
    fireEvent.keyDown(input, { key: ' ', code: 'Space' });
    await waitFor(() => expect(commands.launcherPreviewShow).toHaveBeenCalledWith(expect.objectContaining({ kind: source === 'recents' ? 'markdown' : source === 'clipboard' ? 'clipboard' : 'bookmark' })));
    fireEvent.keyDown(input, { key: ' ', code: 'Space' });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => {
      if (source === 'recents') expect(commands.insertMarkdownText).toHaveBeenCalledWith('[[Markdown note 23]]');
      if (source === 'clipboard') expect(commands.insertClipboardItemsAsMarkdown).toHaveBeenCalledWith([23]);
      if (source === 'bookmarks') expect(commands.insertMarkdownText).toHaveBeenCalledWith(expect.stringContaining('23'));
    });
  });

  it.each(['Bookmark example', 'Clipboard example'])('finds %s through ordinary search', async query => {
    const { container, input } = await mount('recents');
    fireEvent.change(input, { target: { value: query } });
    await waitFor(() => expect(container.querySelector('[data-item-index="0"]')?.textContent).toContain(query));
    expect(container.querySelectorAll('[data-item-index]')).toHaveLength(20);
  });

  it('fetches older clipboard items on demand and completes the pending Arrow Down', async () => {
    const { container, input } = await mount('clipboard');
    expect(clipboard.queryItems).toHaveBeenLastCalledWith({ limit: 50, offset: 0 });
    for (let i = 0; i < 50; i++) fireEvent.keyDown(input, { key: 'ArrowDown' });
    await waitFor(() => expect(clipboard.queryItems).toHaveBeenCalledWith({ limit: 50, offset: 50 }));
    await waitFor(() => expect(container.querySelector('[data-item-index="50"]')).not.toBeNull());
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(commands.insertClipboardItemsAsMarkdown).toHaveBeenCalledWith([50]));
  });

  it('allows x, s, and u to be typed in clipboard search without triggering stack actions', async () => {
    const { input } = await mount('clipboard');
    expect(fireEvent.keyDown(input, { key: 's' })).toBe(true);
    fireEvent.change(input, { target: { value: '. Clipboard' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    for (const key of ['x', 's', 'u']) expect(fireEvent.keyDown(input, { key })).toBe(true);
  });

  it('scrolls the selected row using list-relative geometry', async () => {
    const { container, input } = await mount('recents');
    const list = container.querySelector('ul')!;
    Object.defineProperty(list, 'clientHeight', { value: 100 });
    vi.spyOn(list, 'getBoundingClientRect').mockReturnValue({ top: 100 } as DOMRect);
    for (const row of list.querySelectorAll<HTMLElement>('[data-item-index]')) {
      Object.defineProperty(row, 'offsetHeight', { value: 30 });
      vi.spyOn(row, 'getBoundingClientRect').mockImplementation(() => ({ top: 100 + Number(row.dataset.itemIndex) * 30 - list.scrollTop, height: 30 } as DOMRect));
    }
    for (let i = 0; i < 5; i++) fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(list.scrollTop).toBe(80);
  });

  it('ignores a late clipboard response after the search changes', async () => {
    const { container, input } = await mount('recents');
    let resolveOld!: (items: typeof clips) => void;
    clipboard.queryItems.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
    fireEvent.change(input, { target: { value: 'Old clipboard query' } });
    await waitFor(() => expect(resolveOld).toBeDefined());
    fireEvent.change(input, { target: { value: 'Clipboard example 1' } });
    await waitFor(() => expect(container.querySelector('[data-item-index="0"]')?.textContent).toContain('Clipboard example 1'));
    await act(async () => resolveOld([clips[0]]));
    expect(container.querySelector('[data-item-index="0"]')?.textContent).toContain('Clipboard example 1');
    expect(container.textContent).not.toContain('Clipboard example 0');
  });

  it('searches Markdown files and reveals additional results with Show more', async () => {
    const { container, input } = await mount('recents');
    fireEvent.change(input, { target: { value: 'Markdown note' } });
    await waitFor(() => expect(container.querySelectorAll('[data-item-index]')).toHaveLength(20));
    fireEvent.click(screen.getByRole('button', { name: /Show more/ }));
    expect(container.querySelectorAll('[data-item-index]')).toHaveLength(40);
    for (let i = 0; i < 44; i++) fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter', metaKey: true });
    await waitFor(() => expect(commands.openFieldTheoryMarkdown).toHaveBeenCalledWith(expect.objectContaining({ path: 'note-44' })));
  });
});


describe('launcher global search and saved section', () => {
  it('finds portable commands by name and by commands while Inbox is selected', async () => {
    const folder = launcherFolderSection({ path: '/library', label: 'Inbox' });
    commands.getLauncherSettings.mockResolvedValue({ sections: [folder] });
    commands.getCommands.mockResolvedValue([{ name: 'local-install', displayName: 'Local install', filePath: '/commands/local-install.md', lastModified: 10 }]);
    const { container, input } = await mount(folder);
    fireEvent.change(input, { target: { value: 'local-install' } });
    await waitFor(() => expect(container.textContent).toContain('Local install'));
    fireEvent.change(input, { target: { value: 'commands' } });
    await waitFor(() => expect(container.textContent).toContain('Local install'));
    expect(container.querySelector('[data-item-index="0"]')?.textContent).toContain('Local install');
  });
  it.each(['recents', 'clipboard', 'river', launcherFolderSection({ path: '/library', label: 'Inbox' })])('restores %s after the renderer is recreated', async source => {
    commands.getLauncherSettings.mockResolvedValue({ sections: ['bookmarks', source] });
    localStorage.setItem('fieldTheory.launcher.defaultPanelSource.v1', source);
    const { unmount } = render(<CommandLauncher />);
    await act(async () => reset({ generation: 1 }));
    const label = source.startsWith('folder:') ? 'Inbox' : source === 'recents' ? 'Recents' : source === 'river' ? 'River' : 'Clipboard';
    await screen.findByRole('button', { name: `Collapse ${label}` });
    unmount();
    render(<CommandLauncher />);
    await act(async () => reset({ generation: 4 }));
    await screen.findByRole('button', { name: `Collapse ${label}` });
  });
});
