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
  getCommands: vi.fn(async () => []), getCommandDirectories: vi.fn(async () => []),
  getHandoffs: vi.fn(async () => []), getLauncherSettings: vi.fn(async () => ({})),
  getLauncherContext: vi.fn(async () => ({ fieldTheoryActive: true, hasActiveLibraryFileContext: true })),
  getActiveLibraryFileContext: vi.fn(async () => ({ filePath: '/library/active.md' })),
  warmLauncherFileIndex: vi.fn(async () => ({ started: false })),
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
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
afterAll(() => vi.unstubAllGlobals());

async function mount(source: string) {
  localStorage.setItem('fieldTheory.launcher.defaultPanelSource.v1', source);
  const result = render(<CommandLauncher />);
  await act(async () => reset({ generation: 1 }));
  await waitFor(() => expect(result.container.querySelectorAll('[data-item-index]')).toHaveLength(20), { timeout: 4000 });
  return { ...result, input: screen.getByRole('textbox') };
}

describe('launcher source navigation', () => {
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
