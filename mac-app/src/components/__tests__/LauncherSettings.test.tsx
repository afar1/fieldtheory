import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import LauncherSettings from '../LauncherSettings';
import { normalizeLauncherSections, nextLauncherSection } from '../../../electron/shared/launcherSections';

vi.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: { text: '#111', success: '#080', error: '#f00' } }) }));
afterEach(() => { cleanup(); delete window.commandsAPI; });

it('normalizes saved sections and cycles in the configured order', () => {
  expect(normalizeLauncherSections(undefined)).toEqual(['recents', 'clipboard', 'bookmarks', 'river']);
  expect(normalizeLauncherSections(['river', 'invalid', 'river', 'bookmarks'])).toEqual(['river', 'bookmarks']);
  expect(normalizeLauncherSections([])).toEqual(['recents']);
  expect(nextLauncherSection('bookmarks', ['river', 'bookmarks'])).toBe('river');
  expect(nextLauncherSection('river', ['river'])).toBe('river');
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
