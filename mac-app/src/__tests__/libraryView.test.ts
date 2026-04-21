import { describe, expect, it } from 'vitest';
import {
  formatBreadcrumb,
  getScrollRatio,
  getScrollTopForRatio,
  persistLibrarianSelection,
  resolveWikiCreateFolder,
  restoreLibrarianSelection,
  splitFrontmatter,
} from '../components/LibrarianView';
import {
  ensureScratchpadNodePinned,
  ensureScratchpadPinned,
  filterStaleRecent,
  filterUnifiedFolders,
  splitRecent,
  virtualizeBookmarksGroup,
  type LibrarySidebarNode,
} from '../components/WikiSidebar';

describe('splitFrontmatter', () => {
  it('strips YAML frontmatter and returns body + metadata', () => {
    const content = `---
tags: [ft/entry, ai]
source_type: authored
---

# My Entry

Body text here.`;
    const result = splitFrontmatter(content);
    expect(result.body).toBe('# My Entry\n\nBody text here.');
    expect(result.meta.tags).toBe('[ft/entry, ai]');
    expect(result.meta.source_type).toBe('authored');
  });

  it('returns raw content when no frontmatter present', () => {
    const content = '# Just a heading\n\nNo frontmatter.';
    const result = splitFrontmatter(content);
    expect(result.body).toBe(content);
    expect(result.meta).toEqual({});
  });

  it('passes through content with empty frontmatter delimiters', () => {
    const content = '---\n---\n\nBody only.';
    const result = splitFrontmatter(content);
    // Empty frontmatter doesn't match the regex (needs at least one line)
    expect(result.body).toBe(content);
    expect(result.meta).toEqual({});
  });

  it('strips leading newlines from body', () => {
    const content = '---\ntags: [test]\n---\n\n\n\nContent after gaps.';
    const result = splitFrontmatter(content);
    expect(result.body).toBe('Content after gaps.');
  });

  it('ignores malformed frontmatter lines', () => {
    const content = '---\ntags: [test]\nno-colon-here\nlast_updated: 2026-04-15\n---\n\nBody.';
    const result = splitFrontmatter(content);
    expect(result.meta.tags).toBe('[test]');
    expect(result.meta.last_updated).toBe('2026-04-15');
    expect(Object.keys(result.meta)).toHaveLength(2);
  });
});

describe('document scroll helpers', () => {
  it('captures the current scroll as a stable ratio', () => {
    expect(getScrollRatio(150, 1000, 500)).toBe(0.3);
  });

  it('restores the equivalent scroll position when content height changes', () => {
    expect(getScrollTopForRatio(1600, 600, 0.3)).toBe(300);
  });

  it('clamps invalid scroll values to the document range', () => {
    expect(getScrollRatio(1200, 1000, 500)).toBe(1);
    expect(getScrollTopForRatio(1000, 500, -1)).toBe(0);
    expect(getScrollTopForRatio(1000, 500, Number.NaN)).toBe(0);
  });

  it('returns the top when the document does not overflow', () => {
    expect(getScrollRatio(30, 400, 500)).toBe(0);
    expect(getScrollTopForRatio(400, 500, 0.5)).toBe(0);
  });
});

describe('filterUnifiedFolders', () => {
  const folders = [
    {
      name: 'debates',
      label: 'Debates',
      items: [
        {
          id: 'wiki:debates/2026-04-15-wiki-entries-karpathy-refinement',
          title: 'Wiki entries — Karpathy refinement',
          type: 'wiki' as const,
          absPath: '/tmp/debates/2026-04-15-wiki-entries-karpathy-refinement.md',
          relPath: 'debates/2026-04-15-wiki-entries-karpathy-refinement',
          timestamp: 1,
        },
      ],
    },
    {
      name: 'artifacts',
      label: 'Artifacts',
      items: [
        {
          id: 'artifact:/tmp/2026-04-16-consensus-first-debate-artifacts.md',
          title: 'Debate outputs should be consensus-first',
          type: 'artifact' as const,
          absPath: '/tmp/2026-04-16-consensus-first-debate-artifacts.md',
          timestamp: 2,
        },
      ],
    },
  ];

  it('matches by title and keeps only folders with visible results', () => {
    const result = filterUnifiedFolders(folders, 'karpathy');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('debates');
    expect(result[0].items).toHaveLength(1);
  });

  it('matches by path metadata for wiki pages and artifacts', () => {
    const debateResult = filterUnifiedFolders(folders, 'debates/2026-04-15');
    expect(debateResult).toHaveLength(1);
    expect(debateResult[0].name).toBe('debates');

    const artifactResult = filterUnifiedFolders(folders, 'consensus-first-debate-artifacts');
    expect(artifactResult).toHaveLength(1);
    expect(artifactResult[0].name).toBe('artifacts');
  });
});

describe('librarian selection persistence', () => {
  it('restores a stored wiki page selection', () => {
    const storage = {
      getItem: () => JSON.stringify({ type: 'wiki', relPath: '/debates/test-case.md' }),
    };

    expect(restoreLibrarianSelection(storage)).toEqual({
      type: 'wiki',
      relPath: 'debates/test-case',
    });
  });

  it('restores a stored artifact selection', () => {
    const storage = {
      getItem: () => JSON.stringify({ type: 'artifact', path: '/tmp/example.md' }),
    };

    expect(restoreLibrarianSelection(storage)).toEqual({
      type: 'artifact',
      path: '/tmp/example.md',
    });
  });

  it('ignores malformed stored selection payloads', () => {
    const storage = {
      getItem: () => '{"type":"wiki"}',
    };

    expect(restoreLibrarianSelection(storage)).toBeNull();
  });

  it('persists and clears a selection payload', () => {
    const state: Record<string, string> = {};
    const storage = {
      setItem(key: string, value: string) {
        state[key] = value;
      },
      removeItem(key: string) {
        delete state[key];
      },
    };

    persistLibrarianSelection(storage, { type: 'artifact', path: '/tmp/example.md' });
    expect(JSON.parse(state['librarian-last-selection'])).toEqual({
      type: 'artifact',
      path: '/tmp/example.md',
    });

    persistLibrarianSelection(storage, null);
    expect(state['librarian-last-selection']).toBeUndefined();
  });
});

describe('ensureScratchpadPinned', () => {
  it('prepends a scratchpad folder when the tree lacks one', () => {
    const result = ensureScratchpadPinned([
      { name: 'debates', label: 'Debates', items: [], canCreateFile: true },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ name: 'scratchpad', label: 'Scratchpad', canCreateFile: true });
    expect(result[0].items).toEqual([]);
    expect(result[1].name).toBe('debates');
  });

  it('leaves an existing scratchpad folder untouched so persisted pages are preserved', () => {
    const existing = {
      name: 'scratchpad',
      label: 'Scratchpad',
      canCreateFile: true,
      items: [
        {
          id: 'wiki:scratchpad/idea',
          title: 'idea',
          type: 'wiki' as const,
          absPath: '/tmp/scratchpad/idea.md',
          relPath: 'scratchpad/idea',
          timestamp: 1,
        },
      ],
    };
    const result = ensureScratchpadPinned([existing]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(existing);
  });
});

describe('recursive sidebar tree helpers', () => {
  const root: LibraryRoot = { path: '/wiki', label: 'Wiki', builtin: true, tree: [] };

  const dir = (name: string, children: LibrarySidebarNode[] = []): LibrarySidebarNode => ({
    kind: 'dir',
    id: `/wiki::${name}`,
    name,
    label: name.charAt(0).toUpperCase() + name.slice(1),
    relPath: name,
    rootPath: '/wiki',
    builtin: true,
    canCreateFile: true,
    children,
  });

  it('groups bookmark folders under a synthetic bookmarks directory', () => {
    const nodes = [dir('entries'), dir('domains'), dir('categories')];
    const result = virtualizeBookmarksGroup(nodes, root);
    const group = result.find((node) => node.kind === 'dir' && node.name === 'bookmarks-from-x');
    expect(group?.kind).toBe('dir');
    if (group?.kind !== 'dir') return;
    expect(group.children.map((node) => node.kind === 'dir' ? node.name : node.id)).toEqual([
      'bookmarks:root',
      'categories',
      'domains',
    ]);
    expect(result.some((node) => node.kind === 'dir' && node.name === 'categories')).toBe(false);
  });

  it('leaves the tree reference alone when no bookmark folders exist', () => {
    const nodes = [dir('entries')];
    expect(virtualizeBookmarksGroup(nodes, root)).toBe(nodes);
  });

  it('pins an existing scratchpad directory before other built-in nodes', () => {
    const entries = dir('entries');
    const scratchpad = dir('scratchpad');
    const result = ensureScratchpadNodePinned([entries, scratchpad], root);
    expect(result[0]).toBe(scratchpad);
    expect(result[1]).toBe(entries);
  });
});

describe('resolveWikiCreateFolder', () => {
  it('keeps explicit wiki folders unchanged', () => {
    expect(resolveWikiCreateFolder('debates', 'wiki', 'debates/example')).toBe('debates');
  });

  it('routes artifact-folder create requests to the selected wiki folder', () => {
    expect(resolveWikiCreateFolder('artifacts', 'wiki', 'debates/example')).toBe('debates');
  });

  it('falls back to entries when no wiki folder is selected', () => {
    expect(resolveWikiCreateFolder('artifacts', 'artifact', '/tmp/example.md')).toBe('entries');
    expect(resolveWikiCreateFolder('', null, null)).toBe('entries');
  });
});

describe('splitRecent', () => {
  const make = (kind: 'wiki' | 'external', p: string) => ({ kind, path: p, title: p, lastOpenedAt: 1 });

  it('splits by kind and preserves input order inside each group', () => {
    const entries = [make('wiki', 'a'), make('external', 'x'), make('wiki', 'b')];
    const out = splitRecent(entries, null);
    expect(out.wiki.map((e) => e.path)).toEqual(['a', 'b']);
    expect(out.external.map((e) => e.path)).toEqual(['x']);
    expect(out.wikiTotal).toBe(2);
    expect(out.externalTotal).toBe(1);
  });

  it('caps each side at 3 when collapsed, at 10 when the corresponding side is expanded', () => {
    const wikiEntries = Array.from({ length: 8 }, (_, i) => make('wiki', `w${i}`));
    const externalEntries = Array.from({ length: 8 }, (_, i) => make('external', `e${i}`));
    const collapsed = splitRecent([...wikiEntries, ...externalEntries], null);
    expect(collapsed.wiki).toHaveLength(3);
    expect(collapsed.external).toHaveLength(3);

    const wikiExpanded = splitRecent([...wikiEntries, ...externalEntries], 'wiki');
    expect(wikiExpanded.wiki).toHaveLength(8); // all 8 fit under the 10 cap
    expect(wikiExpanded.external).toHaveLength(3);
  });
});

describe('filterStaleRecent', () => {
  const tree = [
    {
      name: 'scratchpad',
      files: [
        { relPath: 'scratchpad/monday-apr-20th', absPath: '/x/scratchpad/monday-apr-20th.md', name: 'monday-apr-20th', title: 'Monday Apr 20th', lastUpdated: 1 },
      ],
    },
  ];

  it('keeps wiki entries whose relPath is present in the tree', () => {
    const recent = [
      { kind: 'wiki' as const, path: 'scratchpad/monday-apr-20th', title: 'Monday Apr 20th', lastOpenedAt: 2 },
    ];
    expect(filterStaleRecent(recent, tree)).toEqual(recent);
  });

  it('drops wiki entries whose relPath is no longer in the tree (trashed or renamed externally)', () => {
    const recent = [
      { kind: 'wiki' as const, path: 'scratchpad/monday-apr-20th-at-3-03pm', title: 'Monday Apr 20th at 3:03pm', lastOpenedAt: 3 },
      { kind: 'wiki' as const, path: 'scratchpad/monday-apr-20th', title: 'Monday Apr 20th', lastOpenedAt: 2 },
    ];
    const out = filterStaleRecent(recent, tree);
    expect(out.map((e) => e.path)).toEqual(['scratchpad/monday-apr-20th']);
  });

  it('leaves external entries alone since they live outside the wiki tree', () => {
    const recent = [
      { kind: 'external' as const, path: '/Users/me/notes/thing.md', title: 'thing', lastOpenedAt: 4 },
    ];
    expect(filterStaleRecent(recent, tree)).toEqual(recent);
  });
});

describe('formatBreadcrumb', () => {
  const reading = { path: '/Users/me/notes/journal.md', title: 'My Journal' };

  it('returns an empty string when no reading is provided', () => {
    expect(formatBreadcrumb('wiki', null)).toBe('');
    expect(formatBreadcrumb('external', null)).toBe('');
  });

  it('wiki: returns the title alone, no folder prefix', () => {
    expect(formatBreadcrumb('wiki', reading)).toBe('My Journal');
  });

  it('external: returns the basename from the absolute path', () => {
    expect(formatBreadcrumb('external', reading)).toBe('journal.md');
  });

  it('external: falls back to the title when the path is just a filename', () => {
    expect(formatBreadcrumb('external', { path: 'loose.md', title: 'Loose' })).toBe('loose.md');
  });
});
