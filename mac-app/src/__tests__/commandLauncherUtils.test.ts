import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildBuiltInLauncherActions,
  DEFAULT_LAUNCHER_HOTKEYS,
  flattenBookmarkTaxonomyRootsForLauncher,
  flattenLibraryDirectoriesForLauncher,
  formatHotkeyDisplay,
  formatTimeAgo,
  filterLauncherDirectoryNamespaceItems,
  filterLauncherMoveTargetDirectories,
  filterLauncherNamespaceItems,
  flattenLibraryRootsForLauncher,
  balanceLauncherNormalModeMatches,
  buildBookmarkAuthorLauncherItems,
  buildBookmarkPostLauncherItems,
  dedupeLauncherPersonItems,
  getLauncherFieldTheoryMarkdownTarget,
  getLauncherAreaActionIdForQuery,
  getLauncherMoveDirectoryTarget,
  getLauncherMovedFilePath,
  getLauncherMoveUndoTargetDirRelPath,
  getLauncherUsageScore,
  getGeneratedBookmarkTaxonomyPathInfo,
  handleFromLauncherLabel,
  isGeneratedBookmarkTaxonomyPath,
  isLauncherPreviewToggleKey,
  nextLauncherArrowIndex,
  resolveHighlightedLauncherIndex,
  resolveLauncherAuthorNamespaceHandle,
  resolveLauncherBookmarkFacetNamespace,
  resolveLauncherCommandOpenTarget,
  resolveLauncherDirectoryNamespace,
  shouldHandleLauncherPreviewShortcut,
  SQUARES_ACTION_DEFS,
  SQUARES_ACTION_IDS,
  DEFAULT_SQUARES_HOTKEYS,
} from '../commandLauncherUtils';

describe('formatHotkeyDisplay', () => {
  it('converts modifier names to symbols', () => {
    expect(formatHotkeyDisplay('Command+C')).toBe('⌘ C');
    expect(formatHotkeyDisplay('Cmd+V')).toBe('⌘ V');
    expect(formatHotkeyDisplay('Shift+A')).toBe('⇧ A');
    expect(formatHotkeyDisplay('Option+Space')).toBe('⌥ Space');
    expect(formatHotkeyDisplay('Alt+4')).toBe('⌥ 4');
    expect(formatHotkeyDisplay('Control+X')).toBe('⌃ X');
    expect(formatHotkeyDisplay('Ctrl+Z')).toBe('⌃ Z');
  });

  it('handles compound modifiers', () => {
    expect(formatHotkeyDisplay('Control+Alt+Shift+G')).toBe('⌃ ⌥ ⇧ G');
    expect(formatHotkeyDisplay('Shift+Command+V')).toBe('⇧ ⌘ V');
    expect(formatHotkeyDisplay('Control+Alt+Left')).toBe('⌃ ⌥ Left');
    expect(formatHotkeyDisplay('Control+Alt+Return')).toBe('⌃ ⌥ Return');
  });

  it('returns empty string for empty input', () => {
    expect(formatHotkeyDisplay('')).toBe('');
  });
});

describe('formatTimeAgo', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-05T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "just now" for less than a minute', () => {
    expect(formatTimeAgo(Date.now() - 30_000)).toBe('just now');
  });

  it('returns minutes ago', () => {
    expect(formatTimeAgo(Date.now() - 5 * 60_000)).toBe('5m ago');
    expect(formatTimeAgo(Date.now() - 59 * 60_000)).toBe('59m ago');
  });

  it('returns hours ago', () => {
    expect(formatTimeAgo(Date.now() - 3 * 3_600_000)).toBe('3h ago');
    expect(formatTimeAgo(Date.now() - 23 * 3_600_000)).toBe('23h ago');
  });

  it('returns "yesterday" for 1 day ago', () => {
    expect(formatTimeAgo(Date.now() - 86_400_000)).toBe('yesterday');
  });

  it('returns days ago for 2-6 days', () => {
    expect(formatTimeAgo(Date.now() - 3 * 86_400_000)).toBe('3d ago');
  });

  it('returns formatted date for 7+ days', () => {
    const result = formatTimeAgo(Date.now() - 10 * 86_400_000);
    expect(result).toMatch(/^[A-Z][a-z]+ \d+$/); // e.g. "Feb 23"
  });
});

describe('balanceLauncherNormalModeMatches', () => {
  const item = (id: string, type: string, lastOpenedAt?: number) => ({
    id,
    type,
    name: id,
    displayName: id,
    lastOpenedAt,
  });

  it('orders search results by commands, recent markdown, actions, library, then bookmarks', () => {
    const results = balanceLauncherNormalModeMatches([
      { item: item('bookmark-author', 'bookmark-author'), score: 990 },
      { item: item('bookmark-post', 'bookmark'), score: 980 },
      { item: item('library-page', 'wiki-page'), score: 970 },
      { item: item('recent-page', 'recent-file'), score: 960 },
      { item: item('action', 'action'), score: 950 },
      { item: item('command', 'command'), score: 940 },
    ]);

    expect(results.map(result => result.id)).toEqual([
      'command',
      'recent-page',
      'action',
      'library-page',
      'bookmark-author',
      'bookmark-post',
    ]);
  });

  it('keeps launcher actions above matching wiki and artifact rows', () => {
    const results = balanceLauncherNormalModeMatches([
      { item: item('wiki-clipboard', 'wiki-page'), score: 1000 },
      { item: item('artifact-clipboard', 'artifact'), score: 990 },
      { item: item('open-clipboard-history', 'action'), score: 900 },
    ]);

    expect(results.map(result => result.id)).toEqual([
      'open-clipboard-history',
      'wiki-clipboard',
      'artifact-clipboard',
    ]);
  });

  it('keeps recent-only searches sorted by latest open time', () => {
    const results = balanceLauncherNormalModeMatches([
      { item: item('older', 'recent-file', 10), score: 1000 },
      { item: item('newer', 'recent-file', 30), score: 900 },
      { item: item('middle', 'recent-file', 20), score: 800 },
    ]);

    expect(results.map(result => result.id)).toEqual(['newer', 'middle', 'older']);
  });
});

describe('flattenLibraryRootsForLauncher', () => {
  it('indexes builtin wiki pages and external library markdown files', () => {
    const items = flattenLibraryRootsForLauncher([
      {
        path: '/wiki',
        label: 'Wiki',
        builtin: true,
        tree: [
          { kind: 'file', relPath: 'entries/note', absPath: '/wiki/entries/note.md', name: 'note', title: 'Note', lastUpdated: 1 },
        ],
      },
      {
        path: '/projects/docs',
        label: 'docs',
        builtin: false,
        tree: [
          {
            kind: 'dir',
            name: 'plans',
            relPath: 'plans',
            children: [
              { kind: 'file', relPath: 'plans/roadmap', absPath: '/projects/docs/plans/roadmap.md', name: 'roadmap', title: 'Roadmap', lastUpdated: 2 },
            ],
          },
        ],
      },
    ]);

    expect(items.map((item) => item.type)).toEqual(['wiki-page', 'markdown-file']);
    expect(items[0]).toMatchObject({ displayName: 'Note', relPath: 'entries/note' });
    expect(items[1]).toMatchObject({ displayName: 'Roadmap — docs', filePath: '/projects/docs/plans/roadmap.md' });
    expect(items[1].keywords).toContain('docs');
  });

  it('indexes a readable form of slugged wiki filenames', () => {
    const [item] = flattenLibraryRootsForLauncher([
      {
        path: '/wiki',
        label: 'Wiki',
        builtin: true,
        tree: [
          { kind: 'file', relPath: 'entries/new-title', absPath: '/wiki/entries/new-title.md', name: 'new-title', title: 'Untitled', lastUpdated: 1 },
        ],
      },
    ]);

    expect(item.keywords).toContain('new title');
  });

  it('carries todo state metadata into launcher search items', () => {
    const [item] = flattenLibraryRootsForLauncher([
      {
        path: '/wiki',
        label: 'Wiki',
        builtin: true,
        tree: [
          { kind: 'file', relPath: 'scratchpad/task', absPath: '/wiki/scratchpad/task.md', name: 'task', title: 'Task', lastUpdated: 1, todoState: 'open' },
        ],
      },
    ]);

    expect(item.todoState).toBe('open');
    expect(item.keywords).toEqual(expect.arrayContaining(['todo', 'task', 'open']));
  });

  it('omits generated bookmark taxonomy pages from launcher results', () => {
    const items = flattenLibraryRootsForLauncher([
      {
        path: '/wiki',
        label: 'Wiki',
        builtin: true,
        tree: [
          { kind: 'file', relPath: 'bookmarks-from-x/categories/commerce', absPath: '/wiki/bookmarks-from-x/categories/commerce.md', name: 'commerce', title: 'Commerce', lastUpdated: 1 },
          { kind: 'file', relPath: 'bookmarks-from-x/domains/example.com', absPath: '/wiki/bookmarks-from-x/domains/example.com.md', name: 'example.com', title: 'example.com', lastUpdated: 1 },
          { kind: 'file', relPath: 'bookmarks-from-x/entities/commerce', absPath: '/wiki/bookmarks-from-x/entities/commerce.md', name: 'commerce', title: 'Commerce', lastUpdated: 1 },
          { kind: 'file', relPath: 'entries/commerce', absPath: '/wiki/entries/commerce.md', name: 'commerce', title: 'Commerce', lastUpdated: 1 },
        ],
      },
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ relPath: 'entries/commerce', displayName: 'Commerce' });
  });

  it('omits root bookmark taxonomy pages from launcher wiki results', () => {
    const items = flattenLibraryRootsForLauncher([
      {
        path: '/wiki',
        label: 'Wiki',
        builtin: true,
        tree: [
          { kind: 'file', relPath: 'categories/commerce', absPath: '/wiki/categories/commerce.md', name: 'commerce', title: 'Commerce', lastUpdated: 1 },
          { kind: 'file', relPath: 'domains/commerce', absPath: '/wiki/domains/commerce.md', name: 'commerce', title: 'Commerce', lastUpdated: 1 },
          { kind: 'file', relPath: 'entities/paulg', absPath: '/wiki/entities/paulg.md', name: 'paulg', title: '@paulg', lastUpdated: 1 },
          { kind: 'file', relPath: 'entries/commerce', absPath: '/wiki/entries/commerce.md', name: 'commerce', title: 'Commerce', lastUpdated: 1 },
        ],
      },
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ relPath: 'entries/commerce', displayName: 'Commerce' });
  });
});

describe('flattenLibraryDirectoriesForLauncher', () => {
  it('builds namespace rows for parent and nested library directories', () => {
    const items = flattenLibraryDirectoriesForLauncher([
      {
        path: '/wiki',
        label: 'Wiki',
        builtin: true,
        tree: [
          {
            kind: 'dir',
            name: 'scratchpad',
            relPath: 'scratchpad',
            children: [
              {
                kind: 'dir',
                name: 'projects',
                relPath: 'scratchpad/projects',
                children: [
                  { kind: 'file', relPath: 'scratchpad/projects/plan', absPath: '/wiki/scratchpad/projects/plan.md', name: 'plan', title: 'Plan', lastUpdated: 1 },
                ],
              },
            ],
          },
        ],
      },
    ]);

    expect(items).toEqual([
      expect.objectContaining({
        type: 'directory',
        name: 'scratchpad',
        displayName: 'scratchpad',
        directoryPath: '/wiki/scratchpad',
        directoryRelPath: 'scratchpad',
      }),
      expect.objectContaining({
        type: 'directory',
        name: 'projects',
        displayName: 'scratchpad/projects',
        directoryPath: '/wiki/scratchpad/projects',
        directoryRelPath: 'scratchpad/projects',
      }),
    ]);
  });

  it('infers directory rows from file paths when the tree is flat', () => {
    const items = flattenLibraryDirectoriesForLauncher([
      {
        path: '/wiki',
        label: 'Wiki',
        builtin: true,
        tree: [
          { kind: 'file', relPath: 'scratchpad/projects/plan', absPath: '/wiki/scratchpad/projects/plan.md', name: 'plan', title: 'Plan', lastUpdated: 1 },
        ],
      },
    ]);

    expect(items).toEqual([
      expect.objectContaining({
        type: 'directory',
        name: 'scratchpad',
        displayName: 'scratchpad',
        directoryPath: '/wiki/scratchpad',
        directoryRelPath: 'scratchpad',
      }),
      expect.objectContaining({
        type: 'directory',
        name: 'projects',
        displayName: 'scratchpad/projects',
        directoryPath: '/wiki/scratchpad/projects',
        directoryRelPath: 'scratchpad/projects',
      }),
    ]);
  });
});

describe('launcher library move helpers', () => {
  const source = {
    type: 'external' as const,
    rootPath: '/Drive/Notes',
    relPath: 'Inbox/current',
    filePath: '/Drive/Notes/Inbox/current.md',
    title: 'current',
  };
  const directory = {
    id: 'directory-/Drive/Notes-Projects',
    type: 'directory' as const,
    name: 'Projects',
    displayName: 'Projects — Shared',
    keywords: ['projects'],
    rootPath: '/Drive/Notes',
    directoryPath: '/Drive/Notes/Projects',
    directoryRelPath: 'Projects',
    hotkeyDisplay: 'folder',
  };

  it('resolves valid move targets inside the same library root', () => {
    expect(getLauncherMoveDirectoryTarget(source, directory)).toEqual({
      rootPath: '/Drive/Notes',
      targetDirRelPath: 'Projects',
    });
  });

  it('rejects moving into the current parent or another library root', () => {
    expect(getLauncherMoveDirectoryTarget(source, {
      ...directory,
      directoryPath: '/Drive/Notes/Inbox',
      directoryRelPath: 'Inbox',
    })).toBeNull();
    expect(getLauncherMoveDirectoryTarget(source, {
      ...directory,
      rootPath: '/Other',
      directoryPath: '/Other/Projects',
    })).toBeNull();
  });

  it('filters move targets by query after removing invalid folders', () => {
    const results = filterLauncherMoveTargetDirectories([
      directory,
      { ...directory, id: 'directory-inbox', name: 'Inbox', displayName: 'Inbox', directoryPath: '/Drive/Notes/Inbox', directoryRelPath: 'Inbox' },
      { ...directory, id: 'directory-archive', name: 'Archive', displayName: 'Archive', keywords: ['archive'], directoryPath: '/Drive/Notes/Archive', directoryRelPath: 'Archive' },
    ], source, 'pro');

    expect(results.map((item) => item.name)).toEqual(['Projects']);
  });

  it('builds undo targets and moved file paths', () => {
    expect(getLauncherMoveUndoTargetDirRelPath('Inbox/current')).toBe('Inbox');
    expect(getLauncherMovedFilePath(source, 'Projects/current')).toBe('/Drive/Notes/Projects/current.md');
    expect(getLauncherMovedFilePath({ ...source, type: 'wiki' }, 'Projects/current')).toBe('Projects/current');
  });
});

describe('flattenBookmarkTaxonomyRootsForLauncher', () => {
  it('builds merged bookmark facet rows for duplicate category and domain labels', () => {
    const items = flattenBookmarkTaxonomyRootsForLauncher([
      {
        path: '/wiki',
        label: 'Wiki',
        builtin: true,
        tree: [
          { kind: 'file', relPath: 'categories/commerce', absPath: '/wiki/categories/commerce.md', name: 'commerce', title: 'Commerce', lastUpdated: 1 },
          { kind: 'file', relPath: 'domains/commerce', absPath: '/wiki/domains/commerce.md', name: 'commerce', title: 'Commerce', lastUpdated: 1 },
          { kind: 'file', relPath: 'entities/paulg', absPath: '/wiki/entities/paulg.md', name: 'paulg', title: '@paulg', lastUpdated: 1 },
        ],
      },
    ]);

    const commerce = items.find((item) => item.displayName === 'Commerce');
    expect(commerce).toMatchObject({
      type: 'bookmark-facet',
      facetPaths: ['/wiki/categories/commerce.md', '/wiki/domains/commerce.md'],
      hotkeyDisplay: 'category/domain',
    });
    expect(items.find((item) => item.displayName === '@paulg')).toMatchObject({
      facetPaths: ['/wiki/entities/paulg.md'],
      hotkeyDisplay: 'entity',
    });
  });
});

describe('isGeneratedBookmarkTaxonomyPath', () => {
  it('matches generated bookmark category, domain, and entity paths from relative or absolute paths', () => {
    expect(isGeneratedBookmarkTaxonomyPath('bookmarks-from-x/categories/commerce')).toBe(true);
    expect(isGeneratedBookmarkTaxonomyPath('/Users/a/.fieldtheory/library/bookmarks-from-x/domains/example.com.md')).toBe(true);
    expect(isGeneratedBookmarkTaxonomyPath('/Users/a/.fieldtheory/library/bookmarks-from-x/entities/commerce.md')).toBe(true);
    expect(isGeneratedBookmarkTaxonomyPath('categories/commerce')).toBe(true);
    expect(isGeneratedBookmarkTaxonomyPath('/Users/a/.fieldtheory/library/domains/commerce.md')).toBe(true);
    expect(isGeneratedBookmarkTaxonomyPath('/Users/a/.fieldtheory/library/entries/commerce.md')).toBe(false);
    expect(isGeneratedBookmarkTaxonomyPath('/Users/a/.fieldtheory/commands/categories/commerce.md')).toBe(false);
  });
});

describe('getGeneratedBookmarkTaxonomyPathInfo', () => {
  it('returns the taxonomy kind and value for generated bookmark taxonomy pages', () => {
    expect(getGeneratedBookmarkTaxonomyPathInfo('categories/commerce')).toEqual({ kind: 'category', value: 'commerce' });
    expect(getGeneratedBookmarkTaxonomyPathInfo('/Users/a/.fieldtheory/library/domains/commerce.md')).toEqual({ kind: 'domain', value: 'commerce' });
    expect(getGeneratedBookmarkTaxonomyPathInfo('bookmarks-from-x/entities/paulg')).toEqual({ kind: 'entity', value: 'paulg' });
  });
});

describe('filterLauncherNamespaceItems', () => {
  const items = [
    { name: 'daily-note', displayName: 'Daily Note', keywords: ['scratchpad', 'today'] },
    { name: 'roadmap', displayName: 'Product Roadmap', keywords: ['planning'] },
  ];

  it('returns all items for blank searches', () => {
    expect(filterLauncherNamespaceItems(items, '')).toBe(items);
    expect(filterLauncherNamespaceItems(items, '   ')).toBe(items);
  });

  it('matches name, display name, and keywords case-insensitively', () => {
    expect(filterLauncherNamespaceItems(items, 'DAILY')).toEqual([items[0]]);
    expect(filterLauncherNamespaceItems(items, 'product')).toEqual([items[1]]);
    expect(filterLauncherNamespaceItems(items, 'scratch')).toEqual([items[0]]);
  });
});

describe('filterLauncherDirectoryNamespaceItems', () => {
  const items = [
    {
      name: 'plan',
      displayName: 'Project Plan',
      keywords: ['plan'],
      relPath: 'scratchpad/projects/plan',
      filePath: '/wiki/scratchpad/projects/plan.md',
    },
    {
      name: 'other',
      displayName: 'Other Note',
      keywords: ['other'],
      relPath: 'scratchpad-other/other',
      filePath: '/wiki/scratchpad-other/other.md',
    },
    {
      name: 'root',
      displayName: 'Root Note',
      keywords: ['root'],
      relPath: 'scratchpad/root',
      filePath: '/wiki/scratchpad/root.md',
    },
  ];

  it('filters recursively within the selected directory only', () => {
    const results = filterLauncherDirectoryNamespaceItems(items, {
      label: 'scratchpad',
      directoryPath: '/wiki/scratchpad',
      directoryRelPath: 'scratchpad',
    }, '');

    expect(results.map((item) => item.name)).toEqual(['plan', 'root']);
  });

  it('applies the typed search after directory filtering', () => {
    const results = filterLauncherDirectoryNamespaceItems(items, {
      label: 'scratchpad',
      directoryPath: '/wiki/scratchpad',
      directoryRelPath: 'scratchpad',
    }, 'root');

    expect(results.map((item) => item.name)).toEqual(['root']);
  });

  it('sorts directory results by recency before name', () => {
    const results = filterLauncherDirectoryNamespaceItems([
      {
        name: 'older',
        displayName: 'Older',
        keywords: ['older'],
        relPath: 'scratchpad/older',
        filePath: '/wiki/scratchpad/older.md',
        lastUpdated: 100,
      },
      {
        name: 'newer',
        displayName: 'Newer',
        keywords: ['newer'],
        relPath: 'scratchpad/newer',
        filePath: '/wiki/scratchpad/newer.md',
        lastUpdated: 200,
      },
    ], {
      label: 'scratchpad',
      directoryPath: '/wiki/scratchpad',
      directoryRelPath: 'scratchpad',
    }, '');

    expect(results.map((item) => item.name)).toEqual(['newer', 'older']);
  });
});

describe('getLauncherUsageScore', () => {
  const now = new Date('2026-03-05T12:00:00Z').getTime();

  it('boosts matching commands by usage, recency, and prefix', () => {
    expect(getLauncherUsageScore(
      { id: 'command-commit', type: 'command', name: 'commit' },
      'comm',
      { 'command-commit': { count: 3, lastUsedAt: now - 2 * 86_400_000 } },
      500,
      now,
    )).toBe(103);
  });

  it('does not make a nonmatching item match through usage alone', () => {
    expect(getLauncherUsageScore(
      { id: 'command-commit', type: 'command', name: 'commit' },
      'zzzz',
      { 'command-commit': { count: 20, lastUsedAt: now } },
      0,
      now,
    )).toBe(0);
  });
});

describe('buildBookmarkAuthorLauncherItems', () => {
  it('builds one launcher row per bookmark author', () => {
    const items = buildBookmarkAuthorLauncherItems([
      {
        handle: 'CJHandmer',
        name: 'CJ Handmer',
        count: 3,
        firstPostedAt: '2026-01-01T00:00:00Z',
        lastPostedAt: '2026-01-03T00:00:00Z',
      },
    ]);

    expect(items).toEqual([
      expect.objectContaining({
        id: 'bookmark-author-cjhandmer',
        type: 'bookmark-author',
        name: '@CJHandmer',
        displayName: '@CJHandmer',
        authorHandle: 'CJHandmer',
        bookmarkCount: 3,
        hotkeyDisplay: '3 bookmarks',
      }),
    ]);
    expect(items[0].keywords).toEqual(expect.arrayContaining(['CJHandmer', '@CJHandmer', 'CJ Handmer', 'person']));
  });
});

describe('buildBookmarkPostLauncherItems', () => {
  it('builds searchable bookmark post rows for an author namespace', () => {
    const items = buildBookmarkPostLauncherItems([
      {
        id: '123',
        text: 'A useful note about rockets and manufacturing.',
        url: 'https://x.com/elonmusk/status/123',
        authorHandle: 'elonmusk',
        authorName: 'Elon Musk',
        postedAt: '2026-01-01T12:00:00Z',
      },
    ]);

    expect(items).toEqual([
      expect.objectContaining({
        id: 'bookmark-123',
        type: 'bookmark',
        bookmarkId: '123',
        displayName: 'A useful note about rockets and manufacturing.',
        authorHandle: 'elonmusk',
        hotkeyDisplay: '2026-01-01',
      }),
    ]);
    expect(items[0].keywords).toEqual(expect.arrayContaining(['Elon Musk', 'elonmusk', '@elonmusk', '2026-01-01']));
  });

  it('truncates long bookmark text for launcher display', () => {
    const longText = 'a'.repeat(130);
    const [item] = buildBookmarkPostLauncherItems([
      {
        id: 'long',
        text: longText,
        url: '',
        authorHandle: 'alice',
        authorName: 'Alice',
        postedAt: '',
      },
    ]);

    expect(item.displayName).toHaveLength(120);
    expect(item.displayName.endsWith('...')).toBe(true);
  });

  it('builds searchable web bookmark rows from title and excerpt', () => {
    const [item] = buildBookmarkPostLauncherItems([
      {
        id: 'web:abc',
        sourceType: 'web',
        text: 'Fallback text',
        title: 'Readable Article',
        domain: 'example.com',
        excerpt: 'A useful article about durable notes.',
        url: 'https://example.com/readable',
        authorHandle: '',
        authorName: '',
        postedAt: '2026-04-25T12:00:00Z',
      },
    ]);

    expect(item.displayName).toBe('Readable Article');
    expect(item.keywords).toEqual(expect.arrayContaining([
      'Readable Article',
      'example.com',
      'A useful article about durable notes.',
      'https://example.com/readable',
    ]));
  });
});

describe('dedupeLauncherPersonItems', () => {
  it('collapses duplicate exact handle rows and prefers bookmark-author rows', () => {
    const items = [
      { id: 'wiki', type: 'wiki-page', name: '@CJHandmer', displayName: '@CJHandmer' },
      { id: 'author', type: 'bookmark-author', name: '@CJHandmer', displayName: '@CJHandmer' },
      { id: 'other', type: 'wiki-page', name: '@jh3yy', displayName: '@jh3yy' },
    ];

    expect(dedupeLauncherPersonItems(items).map((item) => item.id)).toEqual(['author', 'other']);
  });

  it('does not collapse non-handle rows with the same title', () => {
    const items = [
      { id: 'a', type: 'wiki-page', name: 'Roadmap', displayName: 'Roadmap' },
      { id: 'b', type: 'markdown-file', name: 'Roadmap', displayName: 'Roadmap' },
    ];

    expect(dedupeLauncherPersonItems(items)).toEqual(items);
  });
});

describe('handleFromLauncherLabel', () => {
  it('extracts x-style handle labels', () => {
    expect(handleFromLauncherLabel('@elonmusk')).toBe('elonmusk');
    expect(handleFromLauncherLabel(' @CJHandmer ')).toBe('CJHandmer');
    expect(handleFromLauncherLabel('Elon Musk')).toBeNull();
  });
});

describe('isLauncherPreviewToggleKey', () => {
  it('accepts space key variants emitted by browsers and Electron', () => {
    expect(isLauncherPreviewToggleKey({ key: ' ' })).toBe(true);
    expect(isLauncherPreviewToggleKey({ key: 'Space' })).toBe(true);
    expect(isLauncherPreviewToggleKey({ key: 'Spacebar' })).toBe(true);
    expect(isLauncherPreviewToggleKey({ key: '', code: 'Space' })).toBe(true);
  });

  it('rejects non-space keys', () => {
    expect(isLauncherPreviewToggleKey({ key: 'Enter', code: 'Enter' })).toBe(false);
  });
});

describe('shouldHandleLauncherPreviewShortcut', () => {
  it('does not capture space before a result is explicitly selected', () => {
    expect(shouldHandleLauncherPreviewShortcut({ key: ' ' }, false, false)).toBe(false);
  });

  it('captures space after arrow or mouse selection', () => {
    expect(shouldHandleLauncherPreviewShortcut({ key: ' ' }, true, false)).toBe(true);
  });

  it('captures space while preview is open so it can close', () => {
    expect(shouldHandleLauncherPreviewShortcut({ key: ' ' }, false, true)).toBe(true);
  });

  it('ignores non-space keys even after selection', () => {
    expect(shouldHandleLauncherPreviewShortcut({ key: 'Enter' }, true, true)).toBe(false);
  });
});

describe('nextLauncherArrowIndex', () => {
  it('keeps the implicit first row selected on the first ArrowDown', () => {
    expect(nextLauncherArrowIndex(0, 3, 'down', false)).toBe(0);
  });

  it('moves down after a row has been explicitly selected', () => {
    expect(nextLauncherArrowIndex(0, 3, 'down', true)).toBe(1);
  });

  it('clamps arrow movement to available rows', () => {
    expect(nextLauncherArrowIndex(2, 3, 'down', true)).toBe(2);
    expect(nextLauncherArrowIndex(0, 3, 'up', true)).toBe(0);
  });
});

describe('resolveHighlightedLauncherIndex', () => {
  it('uses the highlighted row for Enter', () => {
    expect(resolveHighlightedLauncherIndex(2, 4)).toBe(2);
  });

  it('clamps the highlighted row to available results', () => {
    expect(resolveHighlightedLauncherIndex(9, 4)).toBe(3);
    expect(resolveHighlightedLauncherIndex(-2, 4)).toBe(0);
    expect(resolveHighlightedLauncherIndex(0, 0)).toBe(0);
  });
});

describe('resolveLauncherAuthorNamespaceHandle', () => {
  const authorItems = [
    {
      id: 'bookmark-author-elonmusk',
      type: 'bookmark-author',
      name: '@elonmusk',
      displayName: '@elonmusk',
      authorHandle: 'elonmusk',
      keywords: ['elonmusk', '@elonmusk', 'Elon Musk'],
    },
  ];

  it('promotes a selected markdown handle row to an author namespace', () => {
    const filtered = [
      { id: 'entity-elonmusk', type: 'markdown-file', name: 'elonmusk', displayName: '@elonmusk', keywords: ['elonmusk'] },
    ];

    expect(resolveLauncherAuthorNamespaceHandle(filtered, authorItems, 0, 'elon')).toBe('elonmusk');
  });

  it('does not promote an unselected matching author row', () => {
    const filtered = [
      { id: 'unrelated', type: 'markdown-file', name: 'Elon notes', displayName: 'Elon notes', keywords: ['elon'] },
      authorItems[0],
    ];

    expect(resolveLauncherAuthorNamespaceHandle(filtered, authorItems, 0, 'elon')).toBeNull();
  });

  it('promotes an exact typed handle even before it is selected', () => {
    expect(resolveLauncherAuthorNamespaceHandle([], authorItems, 0, '@elonmusk')).toBe('elonmusk');
  });

  it('prefers an exact typed handle over a stale selected handle row', () => {
    const filtered = [
      { id: 'entity-old', type: 'markdown-file', name: 'oldhandle', displayName: '@oldhandle', keywords: ['oldhandle'] },
    ];
    const authors = [
      ...authorItems,
      {
        id: 'bookmark-author-newhandle',
        type: 'bookmark-author',
        name: '@newhandle',
        displayName: '@newhandle',
        authorHandle: 'newhandle',
        keywords: ['newhandle', '@newhandle'],
      },
    ];

    expect(resolveLauncherAuthorNamespaceHandle(filtered, authors, 0, '@newhandle')).toBe('newhandle');
  });
});

describe('resolveLauncherDirectoryNamespace', () => {
  const directoryItems = [
    {
      id: 'directory-/wiki-scratchpad',
      type: 'directory',
      name: 'scratchpad',
      displayName: 'scratchpad',
      directoryPath: '/wiki/scratchpad',
      directoryRelPath: 'scratchpad',
      keywords: ['scratchpad'],
    },
  ];

  it('uses the selected directory row', () => {
    expect(resolveLauncherDirectoryNamespace(directoryItems, directoryItems, 0, 'scratch')).toBe(directoryItems[0]);
  });

  it('finds an exact typed directory name', () => {
    expect(resolveLauncherDirectoryNamespace([], directoryItems, 0, 'scratchpad')).toBe(directoryItems[0]);
  });

  it('does not use a fuzzy directory match without selecting that row', () => {
    expect(resolveLauncherDirectoryNamespace([], directoryItems, 0, 'scr')).toBeNull();
  });
});

describe('resolveLauncherBookmarkFacetNamespace', () => {
  const facetItems = [
    {
      id: 'bookmark-facet-commerce',
      type: 'bookmark-facet',
      name: 'Commerce',
      displayName: 'Commerce',
      facetPaths: ['/wiki/categories/commerce.md', '/wiki/domains/commerce.md'],
      keywords: ['commerce', 'category', 'domain'],
    },
  ];

  it('uses the selected bookmark facet row', () => {
    expect(resolveLauncherBookmarkFacetNamespace(facetItems, facetItems, 0, 'commerce')).toBe(facetItems[0]);
  });

  it('finds a matching bookmark facet row from the raw query', () => {
    expect(resolveLauncherBookmarkFacetNamespace([], facetItems, 0, 'comm')).toBe(facetItems[0]);
  });
});

describe('resolveLauncherCommandOpenTarget', () => {
  const commandItems = [
    {
      id: 'cmd-assess',
      type: 'command',
      name: 'assess',
      displayName: 'assess.md',
      filePath: '/Users/afar/.fieldtheory/commands/assess.md',
      keywords: ['assess'],
    },
    {
      id: 'cmd-refactor',
      type: 'command',
      name: 'refactor',
      displayName: 'refactor.md',
      filePath: '/Users/afar/.fieldtheory/commands/refactor.md',
      keywords: ['refactor'],
    },
  ];

  it('uses the typed command instead of stale row-zero selection', () => {
    expect(resolveLauncherCommandOpenTarget([commandItems[0]], commandItems, 0, 'refactor', false)).toBe(commandItems[1]);
  });

  it('matches a typed markdown filename', () => {
    expect(resolveLauncherCommandOpenTarget([commandItems[0]], commandItems, 0, 'refactor.md', false)).toBe(commandItems[1]);
  });

  it('honors an explicit selected command row', () => {
    expect(resolveLauncherCommandOpenTarget(commandItems, commandItems, 0, 'refactor', true)).toBe(commandItems[0]);
  });

  it('does not open row zero for an unrelated query', () => {
    expect(resolveLauncherCommandOpenTarget([commandItems[0]], commandItems, 0, 'scratchpad', false)).toBeNull();
  });
});

describe('getLauncherFieldTheoryMarkdownTarget', () => {
  it('opens watched directory markdown files as external Field Theory files', () => {
    expect(getLauncherFieldTheoryMarkdownTarget({
      id: 'file-roadmap',
      type: 'markdown-file',
      name: 'Roadmap',
      displayName: 'Roadmap',
      filePath: '/Users/afar/Notes/Roadmap.md',
      keywords: ['Roadmap'],
    })).toEqual({ kind: 'external', path: '/Users/afar/Notes/Roadmap.md' });
  });

  it('opens recent external markdown files as external Field Theory files', () => {
    expect(getLauncherFieldTheoryMarkdownTarget({
      id: 'recent-roadmap',
      type: 'recent-file',
      name: 'Roadmap',
      displayName: 'Roadmap',
      recentKind: 'external',
      filePath: '/Users/afar/Notes/Roadmap.md',
      keywords: ['Roadmap'],
    })).toEqual({ kind: 'external', path: '/Users/afar/Notes/Roadmap.md' });
  });

  it('keeps wiki pages, artifacts, and commands on their existing target kinds', () => {
    expect(getLauncherFieldTheoryMarkdownTarget({
      id: 'wiki-plan',
      type: 'wiki-page',
      name: 'Plan',
      displayName: 'Plan',
      relPath: 'Plans/Plan',
      keywords: ['Plan'],
    })).toEqual({ kind: 'wiki', path: 'Plans/Plan' });
    expect(getLauncherFieldTheoryMarkdownTarget({
      id: 'artifact-plan',
      type: 'artifact',
      name: 'Artifact',
      displayName: 'Artifact',
      filePath: '/tmp/artifact.md',
      keywords: ['Artifact'],
    })).toEqual({ kind: 'artifact', path: '/tmp/artifact.md' });
    expect(getLauncherFieldTheoryMarkdownTarget({
      id: 'cmd-refactor',
      type: 'command',
      name: 'refactor',
      displayName: 'refactor.md',
      filePath: '/Users/afar/.fieldtheory/commands/refactor.md',
      keywords: ['refactor'],
    })).toEqual({ kind: 'command', path: '/Users/afar/.fieldtheory/commands/refactor.md' });
  });
});

describe('getLauncherAreaActionIdForQuery', () => {
  it('maps exact area queries to app-area actions', () => {
    expect(getLauncherAreaActionIdForQuery('clipboard')).toBe('open-history');
    expect(getLauncherAreaActionIdForQuery(' library ')).toBe('open-library');
    expect(getLauncherAreaActionIdForQuery('COMMANDS')).toBe('open-commands');
  });

  it('does not route partial area words', () => {
    expect(getLauncherAreaActionIdForQuery('command')).toBeNull();
    expect(getLauncherAreaActionIdForQuery('library notes')).toBeNull();
  });
});

describe('SQUARES_ACTION_DEFS', () => {
  it('has 10 window management actions', () => {
    expect(SQUARES_ACTION_DEFS).toHaveLength(10);
  });

  it('each action has a matching default hotkey', () => {
    for (const def of SQUARES_ACTION_DEFS) {
      expect(DEFAULT_SQUARES_HOTKEYS[def.actionId]).toBeDefined();
      expect(DEFAULT_SQUARES_HOTKEYS[def.actionId]).not.toBe('');
    }
  });

  it('each action has required fields', () => {
    for (const def of SQUARES_ACTION_DEFS) {
      expect(def.actionId).toBeTruthy();
      expect(def.name).toBeTruthy();
      expect(def.displayName).toBeTruthy();
      expect(def.keywords.length).toBeGreaterThan(0);
    }
  });

  it('has no duplicate actionIds', () => {
    const ids = SQUARES_ACTION_DEFS.map(d => d.actionId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('SQUARES_ACTION_IDS matches SQUARES_ACTION_DEFS', () => {
    expect(SQUARES_ACTION_IDS.size).toBe(SQUARES_ACTION_DEFS.length);
    for (const def of SQUARES_ACTION_DEFS) {
      expect(SQUARES_ACTION_IDS.has(def.actionId)).toBe(true);
    }
  });

  it('SQUARES_ACTION_IDS does not contain non-squares actions', () => {
    // These are built-in action IDs that should NOT be routed to squaresAPI
    const builtInActionIds = ['settings', 'take-screenshot', 'full-screen-screenshot',
      'active-window-screenshot', 'start-recording', 'super-paste', 'open-history',
      'open-library', 'open-commands', 'view-bookmarks', 'save-current-website', 'move-current-library-file',
      'undo-library-move', 'toggle-theme'];
    for (const id of builtInActionIds) {
      expect(SQUARES_ACTION_IDS.has(id)).toBe(false);
    }
  });
});

describe('buildBuiltInLauncherActions', () => {
  it('includes Squares actions when portable command visibility is enabled', () => {
    const actions = buildBuiltInLauncherActions(DEFAULT_LAUNCHER_HOTKEYS, true, DEFAULT_SQUARES_HOTKEYS, true);

    const actionIds = new Set(actions.map((action) => action.actionId));

    for (const def of SQUARES_ACTION_DEFS) {
      expect(actionIds.has(def.actionId)).toBe(true);
    }
  });

  it('omits Squares actions when portable command visibility is disabled', () => {
    const actions = buildBuiltInLauncherActions(DEFAULT_LAUNCHER_HOTKEYS, true, DEFAULT_SQUARES_HOTKEYS, false);

    const actionIds = new Set(actions.map((action) => action.actionId));

    for (const def of SQUARES_ACTION_DEFS) {
      expect(actionIds.has(def.actionId)).toBe(false);
    }
    expect(actionIds.has('settings')).toBe(true);
    expect(actionIds.has('take-screenshot')).toBe(true);
  });

  it('uses theme-sensitive labeling for the theme toggle action', () => {
    const darkActions = buildBuiltInLauncherActions(DEFAULT_LAUNCHER_HOTKEYS, true);
    const lightActions = buildBuiltInLauncherActions(DEFAULT_LAUNCHER_HOTKEYS, false);

    expect(darkActions.find((action) => action.actionId === 'toggle-theme')?.displayName)
      .toBe('Toggle Light Mode (Field Theory)');
    expect(lightActions.find((action) => action.actionId === 'toggle-theme')?.displayName)
      .toBe('Toggle Dark Mode (Field Theory)');
  });

  it('includes a Save Website action searchable by the expected phrase', () => {
    const actions = buildBuiltInLauncherActions(DEFAULT_LAUNCHER_HOTKEYS, true);
    const saveAction = actions.find((action) => action.actionId === 'save-current-website');

    expect(saveAction).toEqual(expect.objectContaining({
      name: 'save website',
      displayName: 'Save Website',
    }));
    expect(saveAction?.keywords).toEqual(expect.arrayContaining(['save website', 'current tab', 'markdown']));
  });

  it('includes a bookmarks canvas action searchable by bookmarks', () => {
    const actions = buildBuiltInLauncherActions(DEFAULT_LAUNCHER_HOTKEYS, true);
    const bookmarksAction = actions.find((action) => action.actionId === 'view-bookmarks');

    expect(bookmarksAction).toEqual(expect.objectContaining({
      name: 'bookmarks',
      displayName: 'View Bookmarks',
    }));
    expect(bookmarksAction?.keywords).toEqual(expect.arrayContaining(['bookmarks', 'view bookmarks']));
  });

  it('includes app-area actions for library and commands queries', () => {
    const actions = buildBuiltInLauncherActions(DEFAULT_LAUNCHER_HOTKEYS, true);

    expect(actions.find((action) => action.actionId === 'open-library')).toEqual(expect.objectContaining({
      name: 'library',
      displayName: 'Open Library',
    }));
    expect(actions.find((action) => action.actionId === 'open-commands')).toEqual(expect.objectContaining({
      name: 'commands',
      displayName: 'Open Commands',
    }));
  });

  it('includes move and undo move actions', () => {
    const actions = buildBuiltInLauncherActions(DEFAULT_LAUNCHER_HOTKEYS, true);

    expect(actions.find((action) => action.actionId === 'move-current-library-file')).toEqual(expect.objectContaining({
      name: 'move file',
      displayName: 'Move Current File',
    }));
    expect(actions.find((action) => action.actionId === 'undo-library-move')).toEqual(expect.objectContaining({
      name: 'undo move',
      displayName: 'Undo Last Move',
    }));
  });
});
