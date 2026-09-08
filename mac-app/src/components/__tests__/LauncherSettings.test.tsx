import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import LauncherSettings from '../LauncherSettings';
import { launcherFolderSection, parseLauncherFolder, normalizeLauncherSections, nextLauncherSection } from '../../../electron/shared/launcherSections';

vi.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: { text: '#111', success: '#080', error: '#f00' } }) }));
afterEach(() => { cleanup(); delete window.commandsAPI; delete window.libraryAPI; delete window.librarianAPI; });

it('normalizes saved sections and cycles in the configured order', () => {
  expect(normalizeLauncherSections(undefined)).toEqual(['recents', 'clipboard', 'bookmarks', 'river']);
  expect(normalizeLauncherSections(['river', 'invalid', 'river', 'bookmarks'])).toEqual(['river', 'bookmarks']);
  expect(normalizeLauncherSections([])).toEqual(['recents']);
  expect(nextLauncherSection('bookmarks', ['river', 'bookmarks'])).toBe('river');
  expect(nextLauncherSection('river', ['river'])).toBe('river');
  expect(nextLauncherSection('river', ['river'], -1)).toBe('river');
});

it('wraps in both directions through the enabled folder order and skips disabled sections', () => {
  const inbox = launcherFolderSection({ path: '/library/Inbox', label: 'Inbox' });
  const sections = [inbox, 'recents', 'clipboard', 'river'] as const;
  for (let index = 0; index < sections.length; index++) {
    expect(nextLauncherSection(sections[index], [...sections])).toBe(sections[(index + 1) % sections.length]);
    expect(nextLauncherSection(sections[index], [...sections], -1)).toBe(sections[(index + sections.length - 1) % sections.length]);
  }
  expect(nextLauncherSection('bookmarks', [...sections])).toBe(inbox);
  expect(nextLauncherSection('bookmarks', [...sections], -1)).toBe('river');
});

it('persists enabling, disabling and reordering sections while keeping one enabled', async () => {
  const save = vi.fn(async (settings: { rootSearchEnabledKinds: Record<string, boolean>; sections?: string[] }) => settings);
  window.commandsAPI = {
    getLauncherSettings: vi.fn(async () => ({ rootSearchEnabledKinds: { file: true }, sections: ['bookmarks', 'river'] })),
    setLauncherSettings: save,
  } as unknown as NonNullable<Window['commandsAPI']>;
  render(<LauncherSettings />);
  await waitFor(() => expect((screen.getByRole('checkbox', { name: 'River' }) as HTMLInputElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'Move River up' }));
  await waitFor(() => expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ sections: ['river', 'bookmarks'] })));
  await waitFor(() => expect((screen.getByRole('checkbox', { name: 'Bookmarks' }) as HTMLInputElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Bookmarks' }));
  await waitFor(() => expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ sections: ['river'] })));
  await waitFor(() => expect((screen.getByRole('checkbox', { name: 'Clipboard' }) as HTMLInputElement).disabled).toBe(false));
  expect((screen.getByRole('checkbox', { name: 'River' }) as HTMLInputElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Clipboard' }));
  await waitFor(() => expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ sections: ['river', 'clipboard'] })));
});

it('adds a sidebar folder and retains it through settings normalization', async () => {
  window.libraryAPI = {
    getRoots: vi.fn(async () => [{ path: '/library', label: 'Library', builtin: true, tree: [
      { kind: 'dir', name: 'Notes', relPath: 'Notes', children: [] },
      { kind: 'dir', name: 'Plans', relPath: 'Plans', children: [] },
    ] }]),
    getHiddenFolders: vi.fn(async () => ['Plans']),
  } as unknown as NonNullable<Window['libraryAPI']>;
  const save = vi.fn(async settings => settings);
  window.commandsAPI = {
    getLauncherSettings: vi.fn(async () => ({ sections: ['recents'] })), setLauncherSettings: save,
  } as unknown as NonNullable<Window['commandsAPI']>;
  render(<LauncherSettings />);
  await screen.findByRole('option', { name: 'Notes' });
  expect(screen.queryByRole('option', { name: 'Plans' })).toBeNull();
  fireEvent.change(screen.getByRole('combobox', { name: 'Library folder' }), { target: { value: '/library/Notes' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add folder' }));
  await waitFor(() => expect(save).toHaveBeenCalled());
  const section = save.mock.calls[0][0].sections[1];
  expect(parseLauncherFolder(section)).toEqual({ path: '/library/Notes', label: 'Notes' });
  expect(normalizeLauncherSections([section])).toEqual([section]);
  expect(nextLauncherSection('recents', ['recents', section])).toBe(section);
  expect(parseLauncherFolder(launcherFolderSection({ path: '/library/../private', label: 'Invalid' }))).toBeNull();
});
