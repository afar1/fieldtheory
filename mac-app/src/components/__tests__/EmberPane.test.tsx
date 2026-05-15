import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EmberPane from '../EmberPane';

vi.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => ({
    theme: {
      accent: '#0f766e',
      border: '#d1d5db',
      text: '#111111',
      textSecondary: '#666666',
      bg: '#ffffff',
      hoverBg: '#f3f4f6',
      inputBg: '#ffffff',
      isDark: false,
    },
  }),
}));

const version = { mtimeMs: 1, size: 1, sha256: 'v1' };

function page(title: string, nextAt: string, lastResetAt = '2026-04-24'): WikiPage {
  const content = `---\nember: true\nember_kind: person\nember_frequency: 1w\nember_last_reset_at: ${lastResetAt}\nember_next_at: ${nextAt}\n---\n\n# ${title}\n`;
  return {
    relPath: `Ember/${title}`,
    absPath: `/tmp/Ember/${title}.md`,
    name: title,
    title,
    lastUpdated: 1,
    content,
    documentVersion: version,
  };
}

describe('EmberPane', () => {
  const pages = [
    page('Due Person', '2026-05-01'),
    page('Soon Person', '2026-05-20'),
    page('Later Person', '2026-06-01'),
    page('Four', '2026-06-04'),
    page('Five', '2026-06-05'),
    page('Six', '2026-06-06'),
    page('Seven', '2026-06-07'),
    page('Eight', '2026-06-08'),
  ];

  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-05-15T12:00:00Z'));
    Object.defineProperty(window, 'libraryAPI', {
      configurable: true,
      value: {
        getRoots: vi.fn(async () => [{
          path: '/tmp/library',
          label: 'Library',
          builtin: true,
          tree: [{
            kind: 'dir',
            name: 'Ember',
            relPath: 'Ember',
            children: pages.map((entry) => ({
              kind: 'file',
              relPath: entry.relPath,
              absPath: entry.absPath,
              name: entry.name,
              title: entry.title,
              lastUpdated: entry.lastUpdated,
            })),
          }],
        }]),
        onRootsChanged: vi.fn(() => () => {}),
      },
    });
    Object.defineProperty(window, 'wikiAPI', {
      configurable: true,
      value: {
        getPage: vi.fn(async (relPath: string) => pages.find((entry) => entry.relPath === relPath) ?? null),
        save: vi.fn(async () => ({ ok: true, version })),
        createFile: vi.fn(async () => null),
        onPageChanged: vi.fn(() => () => {}),
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shows the top seven people ordered by reach-out timing', async () => {
    render(<EmberPane onOpenPerson={vi.fn()} />);

    expect(await screen.findByText('Due Person')).toBeTruthy();
    expect(screen.getByText('Need to reach out')).toBeTruthy();
    expect(screen.getByText('Upcoming')).toBeTruthy();
    expect(screen.queryByText('Eight')).toBeNull();
  });

  it('updates timing frontmatter and opens a person file from the card', async () => {
    const onOpenPerson = vi.fn();
    render(<EmberPane onOpenPerson={onOpenPerson} />);

    const dueCard = await screen.findByText('Due Person');
    fireEvent.click(dueCard);
    expect(onOpenPerson).toHaveBeenCalledWith('Ember/Due Person');

    const card = dueCard.closest('[role="button"]');
    if (!card) throw new Error('Expected Ember card');
    fireEvent.click(within(card as HTMLElement).getByText('60 days'));

    await waitFor(() => {
      expect(window.wikiAPI?.save).toHaveBeenCalled();
    });
    const [_relPath, savedContent] = vi.mocked(window.wikiAPI!.save).mock.calls[0];
    expect(_relPath).toBe('Ember/Due Person');
    expect(savedContent).toContain('ember_frequency: 60d');
    expect(savedContent).toContain('# Due Person');
    expect(window.libraryAPI?.getRoots).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Loading Ember...')).toBeNull();
    expect((card as HTMLElement).style.transition).toContain('transform');
  });

  it('demos the card rearrange animation without writing person files', async () => {
    render(<EmberPane onOpenPerson={vi.fn()} />);

    await screen.findByText('Due Person');
    expect(Boolean(screen.getByText('Soon Person').compareDocumentPosition(screen.getByText('Five')) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);

    fireEvent.click(screen.getByText('Demo animation'));

    await waitFor(() => {
      expect(Boolean(screen.getByText('Five').compareDocumentPosition(screen.getByText('Soon Person')) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    });
    expect(window.wikiAPI?.save).not.toHaveBeenCalled();
    expect(window.wikiAPI?.createFile).not.toHaveBeenCalled();
  });

  it('resets the saved cadence when a conversation happened', async () => {
    render(<EmberPane onOpenPerson={vi.fn()} />);

    const soonCard = await screen.findByText('Soon Person');
    const card = soonCard.closest('[role="button"]');
    if (!card) throw new Error('Expected Ember card');
    fireEvent.click(within(card as HTMLElement).getByText('Talked'));

    await waitFor(() => {
      expect(window.wikiAPI?.save).toHaveBeenCalled();
    });
    const [relPath, savedContent] = vi.mocked(window.wikiAPI!.save).mock.calls[0];
    expect(relPath).toBe('Ember/Soon Person');
    expect(savedContent).toContain('ember_frequency: 1w');
    expect(savedContent).toContain('ember_last_reset_at: 2026-05-15');
    expect(savedContent).toContain('ember_next_at: 2026-05-22');
  });

  it('keeps the user on Ember after creating a person so timing can be set there', async () => {
    const onOpenPerson = vi.fn();
    const created = page('New Person', '2026-05-15');
    vi.mocked(window.wikiAPI!.createFile).mockResolvedValueOnce({
      ...created,
      content: '',
      documentVersion: { mtimeMs: 2, size: 0, sha256: 'empty' },
    });

    render(<EmberPane onOpenPerson={onOpenPerson} />);

    await screen.findByText('Due Person');
    fireEvent.change(screen.getByPlaceholderText('Person name'), { target: { value: 'New Person' } });
    fireEvent.click(screen.getByText('New person'));

    expect(await screen.findByText('New Person')).toBeTruthy();
    expect(onOpenPerson).not.toHaveBeenCalled();
    expect(window.wikiAPI?.save).toHaveBeenCalledWith(
      'Ember/New Person',
      expect.stringContaining('ember_next_at: 2026-05-15'),
      { mtimeMs: 2, size: 0, sha256: 'empty' },
    );
  });
});
