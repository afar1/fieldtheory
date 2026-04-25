import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildBuiltInLauncherActions,
  DEFAULT_LAUNCHER_HOTKEYS,
  formatHotkeyDisplay,
  formatTimeAgo,
  filterLauncherNamespaceItems,
  flattenLibraryRootsForLauncher,
  buildBookmarkAuthorLauncherItems,
  buildBookmarkPostLauncherItems,
  dedupeLauncherPersonItems,
  handleFromLauncherLabel,
  isLauncherPreviewToggleKey,
  resolveLauncherAuthorNamespaceHandle,
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

  it('promotes the first matching author row when selected item is not a handle', () => {
    const filtered = [
      { id: 'unrelated', type: 'markdown-file', name: 'Elon notes', displayName: 'Elon notes', keywords: ['elon'] },
      authorItems[0],
    ];

    expect(resolveLauncherAuthorNamespaceHandle(filtered, authorItems, 0, 'elon')).toBe('elonmusk');
  });

  it('promotes an exact typed handle even before it is selected', () => {
    expect(resolveLauncherAuthorNamespaceHandle([], authorItems, 0, '@elonmusk')).toBe('elonmusk');
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
      'active-window-screenshot', 'start-recording', 'super-paste', 'open-history', 'toggle-theme'];
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
});
