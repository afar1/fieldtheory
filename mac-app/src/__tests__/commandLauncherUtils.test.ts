import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildBuiltInLauncherActions,
  DEFAULT_LAUNCHER_HOTKEYS,
  flattenBookmarkTaxonomyRootsForLauncher,
  flattenLibraryDirectoriesForLauncher,
  flattenLibraryPageDeltaForLauncher,
  formatHotkeyDisplay,
  formatTimeAgo,
  filterLauncherDirectoryNamespaceItems,
  filterLauncherMoveTargetDirectories,
  filterLauncherNamespaceItems,
  filterLauncherNormalModeItems,
  flattenLibraryRootsForLauncher,
  balanceLauncherNormalModeMatches,
  canPatchLibraryPageDeltaForLauncher,
  LAUNCHER_NORMAL_MODE_MAX_RESULTS,
  buildBookmarkAuthorLauncherItems,
  buildBookmarkPostLauncherItems,
  buildCommandDirectoriesForLauncher,
  buildLauncherFileItems,
  commandPathToLauncherLibraryOpenTarget,
  DEFAULT_LAUNCHER_ROOT_SEARCH_ENABLED_KINDS,
  getLauncherFileSearchQuery,
  getLauncherInvocationVisibilityPolicy,
  isLauncherRootSearchKindEnabled,
  LAUNCHER_ROOT_SEARCH_KIND_LABELS,
  normalizeLauncherRootSearchEnabledKinds,
  dedupeLauncherPersonItems,
  getLauncherFieldTheoryMarkdownTarget,
  getLauncherAreaActionIdForQuery,
  getLauncherClipboardSearchQuery,
  getLauncherClipboardSearchInputState,
  getLauncherDefaultBookmarkEnterAction,
  getLauncherDefaultPanelItems,
  getLauncherDefaultPanelSourceLabel,
  formatLauncherBookmarkEmbedMarkdown,
  getLauncherNativeIconPathForItem,
  getLauncherMoveDirectoryTarget,
  getLauncherMovedFilePath,
  getLauncherMoveUndoTargetDirRelPath,
  getLauncherUsageScore,
  getLauncherStatusText,
  areLauncherRootSearchEnabledKindsEqual,
  areLauncherVisibleItemsSameOrder,
  getGeneratedBookmarkTaxonomyPathInfo,
  handleFromLauncherLabel,
  isGeneratedBookmarkTaxonomyPath,
  isLauncherRiverItem,
  isLauncherPreviewToggleKey,
  nextLauncherArrowIndex,
  resolveHighlightedLauncherIndex,
  resolveLauncherAuthorNamespaceHandle,
  resolveLauncherBookmarkFacetNamespace,
  resolveLauncherCommandOpenTarget,
  resolveLauncherDirectoryNamespace,
  resolveLauncherFieldTheoryOpenTarget,
  shouldHandleLauncherPreviewShortcut,
  shouldIncludeLauncherLibraryMarkdownItem,
  shouldIncludeLauncherRecentFile,
  shouldExitLauncherClipboardSearch,
  shouldOfferLocalInstructionFallback,
  shouldPastePortableCommand,
  shouldReturnLauncherSelectionToInput,
  shouldSwitchLauncherDefaultPanelOnTab,
  shouldShowLauncherItemInTypedSearch,
  shouldTraceLauncherRendererEvent,
  scoreLauncherText,
  warmLauncherSearchableItemCache,
  SQUARES_ACTION_DEFS,
  SQUARES_ACTION_IDS,
  DEFAULT_SQUARES_HOTKEYS,
} from '../commandLauncherUtils';

describe('launcher visible result equality', () => {
  it('treats identical visible rows in the same order as unchanged', () => {
    const current = [
      { id: 'one', type: 'command', name: 'one', displayName: 'One' },
      { id: 'two', type: 'wiki-page', name: 'two', displayName: 'Two' },
    ];
    const next = [
      { id: 'one', type: 'command', name: 'one', displayName: 'One' },
      { id: 'two', type: 'wiki-page', name: 'two', displayName: 'Two' },
    ];

    expect(areLauncherVisibleItemsSameOrder(current, next)).toBe(true);
  });

  it('detects reordered, type-changed, or label-changed visible results', () => {
    const current = [
      { id: 'one', type: 'command', name: 'one', displayName: 'One', hotkeyDisplay: '⌘ 1' },
      { id: 'two', type: 'wiki-page', name: 'two', displayName: 'Two', timeAgo: '1m ago' },
    ];

    expect(areLauncherVisibleItemsSameOrder(current, [
      { id: 'two', type: 'wiki-page', name: 'two', displayName: 'Two' },
      { id: 'one', type: 'command', name: 'one', displayName: 'One' },
    ])).toBe(false);
    expect(areLauncherVisibleItemsSameOrder(current, [
      { id: 'one', type: 'action', name: 'one', displayName: 'One' },
      { id: 'two', type: 'wiki-page', name: 'two', displayName: 'Two' },
    ])).toBe(false);
    expect(areLauncherVisibleItemsSameOrder(current, [
      { id: 'one', type: 'command', name: 'one', displayName: 'One Updated' },
      { id: 'two', type: 'wiki-page', name: 'two', displayName: 'Two' },
    ])).toBe(false);
    expect(areLauncherVisibleItemsSameOrder(current, [
      { id: 'one', type: 'command', name: 'one', displayName: 'One', hotkeyDisplay: '⌘ 2' },
      { id: 'two', type: 'wiki-page', name: 'two', displayName: 'Two', timeAgo: '1m ago' },
    ])).toBe(false);
    expect(areLauncherVisibleItemsSameOrder(current, [
      { id: 'one', type: 'command', name: 'one', displayName: 'One', hotkeyDisplay: '⌘ 1' },
      { id: 'two', type: 'wiki-page', name: 'two', displayName: 'Two', timeAgo: '2m ago' },
    ])).toBe(false);
  });
});

describe('launcher default panel helpers', () => {
  it('shows only the first five rows from the selected idle panel source', () => {
    const recentItems = Array.from({ length: 7 }, (_, index) => ({ id: `recent-${index}` }));
    const clipboardItems = Array.from({ length: 7 }, (_, index) => ({ id: `clipboard-${index}` }));
    const bookmarkItems = Array.from({ length: 7 }, (_, index) => ({ id: `bookmark-${index}` }));

    expect(getLauncherDefaultPanelItems({
      expanded: true,
      isRootIdle: true,
      source: 'recents',
      recentItems,
      clipboardItems,
      bookmarkItems,
    }).map(item => item.id)).toEqual(['recent-0', 'recent-1', 'recent-2', 'recent-3', 'recent-4']);

    expect(getLauncherDefaultPanelItems({
      expanded: true,
      isRootIdle: true,
      source: 'clipboard',
      recentItems,
      clipboardItems,
      bookmarkItems,
    }).map(item => item.id)).toEqual(['clipboard-0', 'clipboard-1', 'clipboard-2', 'clipboard-3', 'clipboard-4']);

    expect(getLauncherDefaultPanelItems({
      expanded: true,
      isRootIdle: true,
      source: 'bookmarks',
      recentItems,
      clipboardItems,
      bookmarkItems,
    }).map(item => item.id)).toEqual(['bookmark-0', 'bookmark-1', 'bookmark-2', 'bookmark-3', 'bookmark-4']);
  });

  it('hides the default panel when collapsed or outside the root idle launcher', () => {
    const recentItems = [{ id: 'recent' }];

    expect(getLauncherDefaultPanelItems({
      expanded: false,
      isRootIdle: true,
      source: 'recents',
      recentItems,
      clipboardItems: [],
    })).toEqual([]);

    expect(getLauncherDefaultPanelItems({
      expanded: true,
      isRootIdle: false,
      source: 'recents',
      recentItems,
      clipboardItems: [],
    })).toEqual([]);
  });

  it('labels all default panel sources for the launcher controls', () => {
    expect(getLauncherDefaultPanelSourceLabel('recents')).toBe('Recents');
    expect(getLauncherDefaultPanelSourceLabel('clipboard')).toBe('Clipboard');
    expect(getLauncherDefaultPanelSourceLabel('bookmarks')).toBe('Bookmarks');
  });

  it('only lets Tab cycle idle panels when no launcher row is explicitly selected', () => {
    expect(shouldSwitchLauncherDefaultPanelOnTab({
      isRootIdleLauncher: true,
      hasExplicitSelection: false,
    })).toBe(true);
    expect(shouldSwitchLauncherDefaultPanelOnTab({
      isRootIdleLauncher: true,
      hasExplicitSelection: true,
    })).toBe(false);
    expect(shouldSwitchLauncherDefaultPanelOnTab({
      isRootIdleLauncher: false,
      hasExplicitSelection: false,
    })).toBe(false);
  });

  it('keeps synthetic recents out of typed search and identifies River rows', () => {
    expect(shouldShowLauncherItemInTypedSearch({ type: 'recent-file' })).toBe(false);
    expect(shouldShowLauncherItemInTypedSearch({ type: 'markdown-file' })).toBe(true);
    expect(isLauncherRiverItem({ source: 'shared' })).toBe(true);
    expect(isLauncherRiverItem({ sourceLabel: 'River (shared)' })).toBe(true);
    expect(isLauncherRiverItem({ source: 'private', sourceLabel: 'Library' })).toBe(false);
  });
});

describe('launcher renderer tracing', () => {
  it('skips fast filter result traces but keeps slow and non-filter traces', () => {
    expect(shouldTraceLauncherRendererEvent('filter-results', { elapsedMs: 2.5 })).toBe(false);
    expect(shouldTraceLauncherRendererEvent('filter-results', { elapsedMs: 2.5, queryLength: 1 })).toBe(true);
    expect(shouldTraceLauncherRendererEvent('filter-results', { elapsedMs: 2.5, queryLength: 2 })).toBe(true);
    expect(shouldTraceLauncherRendererEvent('filter-results', { elapsedMs: 2.5, queryLength: 3 })).toBe(false);
    expect(shouldTraceLauncherRendererEvent('filter-results', { elapsedMs: 8 })).toBe(true);
    expect(shouldTraceLauncherRendererEvent('filter-results')).toBe(true);
    expect(shouldTraceLauncherRendererEvent('invoke-item', { elapsedMs: 2.5 })).toBe(true);
  });
});

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

describe('shouldOfferLocalInstructionFallback', () => {
  it('offers the fallback only for no-result typing inside an active Field Theory document', () => {
    expect(shouldOfferLocalInstructionFallback({
      query: 'rewrite this more cleanly',
      resultCount: 0,
      fieldTheoryActive: true,
      hasActiveLibraryFileContext: true,
    })).toBe(true);

    expect(shouldOfferLocalInstructionFallback({
      query: 'rewrite this more cleanly',
      resultCount: 1,
      fieldTheoryActive: true,
      hasActiveLibraryFileContext: true,
    })).toBe(false);

    expect(shouldOfferLocalInstructionFallback({
      query: 'rewrite this more cleanly',
      resultCount: 0,
      fieldTheoryActive: false,
      hasActiveLibraryFileContext: true,
    })).toBe(false);

    expect(shouldOfferLocalInstructionFallback({
      query: 'rewrite this more cleanly',
      resultCount: 0,
      fieldTheoryActive: true,
      hasActiveLibraryFileContext: false,
    })).toBe(false);
  });

  it('does not offer the fallback while searching inside a launcher namespace', () => {
    expect(shouldOfferLocalInstructionFallback({
      query: 'misc',
      resultCount: 0,
      fieldTheoryActive: true,
      hasActiveLibraryFileContext: true,
      inScopedMode: true,
    })).toBe(false);
  });
});

describe('getLauncherStatusText', () => {
  it('stays hidden before the user searches or enters a namespace', () => {
    expect(getLauncherStatusText({
      hasQuery: false,
      namespaceLabel: null,
      resultCount: 0,
      loading: true,
      hasLoadedItems: false,
    })).toBeNull();
  });

  it('shows loading while a cold launcher is still fetching results', () => {
    expect(getLauncherStatusText({
      hasQuery: true,
      namespaceLabel: null,
      resultCount: 0,
      loading: true,
      hasLoadedItems: false,
    })).toBe('Loading results...');
  });

  it('shows no matches once loaded data has no results', () => {
    expect(getLauncherStatusText({
      hasQuery: true,
      namespaceLabel: null,
      resultCount: 0,
      loading: false,
      hasLoadedItems: true,
    })).toBe('No matches found');
  });

  it('stays hidden when there are visible results', () => {
    expect(getLauncherStatusText({
      hasQuery: true,
      namespaceLabel: null,
      resultCount: 1,
      loading: true,
      hasLoadedItems: false,
    })).toBeNull();
  });
});

describe('getLauncherClipboardSearchQuery', () => {
  it('enters clipboard search only after dot and space', () => {
    expect(getLauncherClipboardSearchQuery('. ')).toBe('');
    expect(getLauncherClipboardSearchQuery('. invoice')).toBe('invoice');
    expect(getLauncherClipboardSearchQuery('.  invoice')).toBe('invoice');
    expect(getLauncherClipboardSearchQuery('.')).toBeNull();
    expect(getLauncherClipboardSearchQuery('notes')).toBeNull();
  });
});

describe('getLauncherClipboardSearchInputState', () => {
  it('consumes the dot trigger when entering clipboard search', () => {
    expect(getLauncherClipboardSearchInputState({ active: false, query: '. ' })).toEqual({
      active: true,
      query: '',
    });
    expect(getLauncherClipboardSearchInputState({ active: false, query: '. invoice' })).toEqual({
      active: true,
      query: 'invoice',
    });
  });

  it('keeps clipboard mode query text after the trigger has been consumed', () => {
    expect(getLauncherClipboardSearchInputState({ active: true, query: 'invoice' })).toEqual({
      active: true,
      query: 'invoice',
    });
    expect(getLauncherClipboardSearchInputState({ active: true, query: '' })).toEqual({
      active: true,
      query: '',
    });
  });
});

describe('shouldExitLauncherClipboardSearch', () => {
  it('leaves clipboard search only when deleting from an empty clipboard query', () => {
    expect(shouldExitLauncherClipboardSearch({ active: true, query: '', key: 'Backspace' })).toBe(true);
    expect(shouldExitLauncherClipboardSearch({ active: true, query: 'invoice', key: 'Backspace' })).toBe(false);
    expect(shouldExitLauncherClipboardSearch({ active: false, query: '', key: 'Backspace' })).toBe(false);
  });
});

describe('shouldPastePortableCommand', () => {
  it('keeps Enter on portable commands on the paste path', () => {
    expect(shouldPastePortableCommand({
      itemType: 'command',
      openFieldTheoryTarget: false,
      insertWikiLink: false,
    })).toBe(true);
  });

  it('does not paste when Tab is opening the command markdown file', () => {
    expect(shouldPastePortableCommand({
      itemType: 'command',
      openFieldTheoryTarget: true,
      insertWikiLink: false,
    })).toBe(false);
  });

  it('does not paste non-command rows', () => {
    expect(shouldPastePortableCommand({
      itemType: 'wiki-page',
      openFieldTheoryTarget: false,
      insertWikiLink: false,
    })).toBe(false);
  });
});

describe('getLauncherInvocationVisibilityPolicy', () => {
  it('keeps external paste invocations hidden through blur', () => {
    expect(getLauncherInvocationVisibilityPolicy({
      itemType: 'command',
      openFieldTheoryTarget: false,
      insertWikiLink: false,
    })).toEqual({
      suppressRevealDuringBlur: true,
      revealWhenReadyAfterSuccess: false,
      closeFromRendererAfterSuccess: false,
    });

    expect(getLauncherInvocationVisibilityPolicy({
      itemType: 'clipboard-item',
    })).toEqual({
      suppressRevealDuringBlur: true,
      revealWhenReadyAfterSuccess: false,
      closeFromRendererAfterSuccess: true,
    });

    expect(getLauncherInvocationVisibilityPolicy({
      itemType: 'clipboard-stack',
    })).toEqual({
      suppressRevealDuringBlur: true,
      revealWhenReadyAfterSuccess: false,
      closeFromRendererAfterSuccess: true,
    });
  });

  it('does not suppress normal launcher navigation actions', () => {
    expect(getLauncherInvocationVisibilityPolicy({
      itemType: 'wiki-page',
    })).toEqual({
      suppressRevealDuringBlur: false,
      revealWhenReadyAfterSuccess: true,
      closeFromRendererAfterSuccess: false,
    });
  });
});

describe('balanceLauncherNormalModeMatches', () => {
  const item = (id: string, type: string, lastOpenedAt?: number, lastUpdated?: number, isPinned = false) => ({
    id,
    type,
    name: id,
    displayName: id,
    lastOpenedAt,
    lastUpdated,
    isPinned,
  });

  it('orders search results by most recent item across types', () => {
    const results = balanceLauncherNormalModeMatches([
      { item: item('bookmark-author', 'bookmark-author', undefined, 20), score: 990 },
      { item: item('bookmark-post', 'bookmark', undefined, 30), score: 980 },
      { item: item('library-page', 'wiki-page', undefined, 40), score: 970 },
      { item: item('recent-page', 'recent-file', 50), score: 960 },
      { item: item('action', 'action'), score: 950 },
      { item: item('command', 'command', undefined, 60), score: 940 },
    ]);

    expect(results.map(result => result.id)).toEqual([
      'command',
      'action',
      'recent-page',
      'library-page',
      'bookmark-post',
      'bookmark-author',
    ]);
  });

  it('keeps command matches ahead of newer recent files', () => {
    const results = balanceLauncherNormalModeMatches([
      { item: item('recent-command-twin', 'recent-file', 300), score: 1000 },
      { item: item('older-command', 'command', undefined, 100), score: 800 },
      { item: item('wiki-page', 'wiki-page', undefined, 200), score: 900 },
    ]);

    expect(results.map(result => result.id)).toEqual([
      'older-command',
      'recent-command-twin',
      'wiki-page',
    ]);
  });

  it('keeps command matches ahead of directory matches', () => {
    const results = balanceLauncherNormalModeMatches([
      { item: item('newer-folder', 'directory', undefined, 300), score: 1000 },
      { item: item('older-command', 'command', undefined, 100), score: 800 },
    ]);

    expect(results.map(result => result.id)).toEqual([
      'older-command',
      'newer-folder',
    ]);
  });

  it('keeps directory matches ahead of newer markdown files', () => {
    const results = balanceLauncherNormalModeMatches([
      { item: item('newer-page', 'wiki-page', undefined, 300), score: 1000 },
      { item: item('older-folder', 'directory', undefined, 100), score: 800 },
    ]);

    expect(results.map(result => result.id)).toEqual([
      'older-folder',
      'newer-page',
    ]);
  });

  it('keeps stronger directory text matches ahead of newer fuzzy directory matches', () => {
    const results = balanceLauncherNormalModeMatches([
      { item: item('commands-folder', 'directory', undefined, 300), score: 120 },
      { item: item('plans-folder', 'directory', undefined, 100), score: 1000 },
    ]);

    expect(results.map(result => result.id)).toEqual([
      'plans-folder',
      'commands-folder',
    ]);
  });

  it('uses score when matching rows do not have recency', () => {
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

  it('caps single-section searches to the normal launcher result budget', () => {
    const results = balanceLauncherNormalModeMatches(
      Array.from({ length: LAUNCHER_NORMAL_MODE_MAX_RESULTS + 5 }, (_, index) => ({
        item: item(`command-${index}`, 'command'),
        score: 1000 - index,
      })),
    );

    expect(results).toHaveLength(LAUNCHER_NORMAL_MODE_MAX_RESULTS);
    expect(results.map(result => result.id)).toEqual(
      Array.from({ length: LAUNCHER_NORMAL_MODE_MAX_RESULTS }, (_, index) => `command-${index}`),
    );
  });

  it('orders single-section command matches by strongest match first', () => {
    const results = balanceLauncherNormalModeMatches([
      { item: item('older-command', 'command', undefined, 100), score: 1000 },
      { item: item('newer-command', 'command', undefined, 200), score: 900 },
    ]);

    expect(results.map(result => result.id)).toEqual(['older-command', 'newer-command']);
  });

  it('keeps an exact typed command ahead of fuzzy command matches', () => {
    const results = filterLauncherNormalModeItems([
      {
        id: 'cmd-inspect',
        type: 'command' as const,
        name: 'inspect',
        displayName: 'Inspect',
        keywords: ['inspect'],
        lastUpdated: 100,
      },
      {
        id: 'cmd-inspection-brief',
        type: 'command' as const,
        name: 'inspection-brief',
        displayName: 'Inspection Brief',
        keywords: ['inspection', 'brief'],
        lastUpdated: 300,
      },
    ], 'inspect');

    expect(results.map(result => result.id)).toEqual(['cmd-inspect', 'cmd-inspection-brief']);
  });

  it('keeps pinned command matches ahead of newer unpinned command matches', () => {
    const results = balanceLauncherNormalModeMatches([
      { item: item('newer-command', 'command', undefined, 300), score: 1000 },
      { item: item('pinned-command', 'command', undefined, 100, true), score: 900 },
    ]);

    expect(results.map(result => result.id)).toEqual(['pinned-command', 'newer-command']);
  });

  it('does not let pinned markdown outrank a command match', () => {
    const results = balanceLauncherNormalModeMatches([
      { item: item('command-match', 'command', undefined, 100), score: 800 },
      { item: item('pinned-note', 'wiki-page', undefined, 300, true), score: 1000 },
    ]);

    expect(results.map(result => result.id)).toEqual(['command-match', 'pinned-note']);
  });

  it('caps recent-only searches while keeping latest-opened order', () => {
    const results = balanceLauncherNormalModeMatches(
      Array.from({ length: LAUNCHER_NORMAL_MODE_MAX_RESULTS + 5 }, (_, index) => ({
        item: item(`recent-${index}`, 'recent-file', index),
        score: index,
      })),
    );

    expect(results).toHaveLength(LAUNCHER_NORMAL_MODE_MAX_RESULTS);
    expect(results.map(result => result.id)).toEqual(
      Array.from({ length: LAUNCHER_NORMAL_MODE_MAX_RESULTS }, (_, index) => `recent-${LAUNCHER_NORMAL_MODE_MAX_RESULTS + 4 - index}`),
    );
  });
});

describe('scoreLauncherText', () => {
  it('scores token prefixes across launcher separators', () => {
    expect(scoreLauncherText('River Shared Brief', 'sha')).toBeGreaterThan(scoreLauncherText('River Shared Brief', 'rsb'));
    expect(scoreLauncherText('Library/River/shared brief.md', 'riv')).toBeGreaterThan(0);
    expect(scoreLauncherText('Library_River.shared-brief', 'sha')).toBeGreaterThan(0);
  });

  it('does not fuzzy-match two-character queries', () => {
    expect(scoreLauncherText('River Shared Brief', 'rs')).toBe(0);
    expect(scoreLauncherText('River Shared Brief', 'br')).toBeGreaterThan(0);
  });
});

describe('warmLauncherSearchableItemCache', () => {
  it('returns the next warm index for bounded chunks', () => {
    const items = Array.from({ length: 5 }, (_, index) => ({
      id: `item-${index}`,
      type: 'wiki-page',
      name: `Item ${index}`,
      displayName: `Item ${index}`,
      keywords: [`keyword-${index}`],
    }));

    expect(warmLauncherSearchableItemCache(items, 0, 2)).toBe(2);
    expect(warmLauncherSearchableItemCache(items, 2, 2)).toBe(4);
    expect(warmLauncherSearchableItemCache(items, 4, 2)).toBe(5);
  });
});

describe('filterLauncherNormalModeItems', () => {
  it('keeps fuzzy matching for commands but not bulk markdown rows', () => {
    const results = filterLauncherNormalModeItems([
      {
        id: 'command-alpha-beta',
        type: 'command',
        name: 'alpha beta',
        displayName: 'Alpha Beta',
        keywords: [],
      },
      {
        id: 'wiki-alpha-beta',
        type: 'wiki-page',
        name: 'alpha beta',
        displayName: 'Alpha Beta',
        keywords: [],
      },
    ], 'abt');

    expect(results.map(result => result.id)).toEqual(['command-alpha-beta']);
  });

  it('skips unpinned bulk markdown rows for one- and two-character queries', () => {
    const results = filterLauncherNormalModeItems([
      {
        id: 'command-brief',
        type: 'command',
        name: 'brief',
        displayName: 'Brief',
        keywords: [],
      },
      {
        id: 'wiki-brief',
        type: 'wiki-page',
        name: 'brief',
        displayName: 'Brief',
        keywords: [],
      },
      {
        id: 'pinned-wiki-brief',
        type: 'wiki-page',
        name: 'brief pinned',
        displayName: 'Brief Pinned',
        keywords: [],
        isPinned: true,
      },
    ], 'b');

    expect(results.map(result => result.id)).toEqual(['command-brief', 'pinned-wiki-brief']);

    expect(filterLauncherNormalModeItems([
      {
        id: 'command-brief',
        type: 'command',
        name: 'brief',
        displayName: 'Brief',
        keywords: [],
      },
      {
        id: 'wiki-brief',
        type: 'wiki-page',
        name: 'brief',
        displayName: 'Brief',
        keywords: [],
      },
    ], 'br').map(result => result.id)).toEqual(['command-brief']);
  });
});

describe('shouldIncludeLauncherRecentFile', () => {
  it('removes recent rows for portable command files', () => {
    expect(shouldIncludeLauncherRecentFile({
      filePath: '/Users/afar/.fieldtheory/library/Commands/write-goal.md',
      commandFilePaths: new Set(['/Users/afar/.fieldtheory/library/Commands/write-goal.md']),
    })).toBe(false);
  });

  it('keeps recent rows for non-command files', () => {
    expect(shouldIncludeLauncherRecentFile({
      filePath: '/Users/afar/.fieldtheory/library/Notes/today.md',
      commandFilePaths: new Set(['/Users/afar/.fieldtheory/library/Commands/write-goal.md']),
    })).toBe(true);
  });
});

describe('shouldIncludeLauncherLibraryMarkdownItem', () => {
  it('removes command files unless the Library row is explicitly openable', () => {
    expect(shouldIncludeLauncherLibraryMarkdownItem({
      filePath: '/Users/afar/.fieldtheory/library/Commands/write-goal.md',
      commandFilePaths: new Set(['/Users/afar/.fieldtheory/library/Commands/write-goal.md']),
    })).toBe(false);
    expect(shouldIncludeLauncherLibraryMarkdownItem({
      filePath: '/Users/afar/.fieldtheory/library/Commands/write-goal.md',
      commandFilePaths: new Set(['/Users/afar/.fieldtheory/library/Commands/write-goal.md']),
      allowCommandFile: true,
    })).toBe(true);
  });

  it('keeps wiki rows for non-command markdown files', () => {
    expect(shouldIncludeLauncherLibraryMarkdownItem({
      filePath: '/Users/afar/.fieldtheory/library/Plans/today.md',
      commandFilePaths: new Set(['/Users/afar/.fieldtheory/library/Commands/write-goal.md']),
    })).toBe(true);
  });
});

describe('flattenLibraryRootsForLauncher', () => {
  it('only patches launcher page deltas that do not require secondary indexes', () => {
    expect(canPatchLibraryPageDeltaForLauncher(
      { path: '/wiki', label: 'Wiki', builtin: true },
      { kind: 'file', relPath: 'entries/note', absPath: '/wiki/entries/note.md', name: 'note', title: 'Note', lastUpdated: 1 },
    )).toBe(true);
    expect(canPatchLibraryPageDeltaForLauncher(
      { path: '/external', label: 'External', builtin: false },
      { kind: 'file', relPath: 'bookmarks-from-x/categories/commerce', absPath: '/external/bookmarks-from-x/categories/commerce.md', name: 'commerce', title: 'Commerce', lastUpdated: 1 },
    )).toBe(true);
    expect(canPatchLibraryPageDeltaForLauncher(
      { path: '/wiki', label: 'Wiki', builtin: true },
      { kind: 'file', relPath: 'bookmarks-from-x/categories/commerce', absPath: '/wiki/bookmarks-from-x/categories/commerce.md', name: 'commerce', title: 'Commerce', lastUpdated: 1 },
    )).toBe(false);
  });

  it('builds launcher rows for a single wiki page delta', () => {
    const result = flattenLibraryPageDeltaForLauncher(
      { path: '/wiki', label: 'Wiki', builtin: true },
      { kind: 'file', relPath: 'entries/note', absPath: '/wiki/entries/note.md', name: 'note', title: 'Note', lastUpdated: 10 },
    );

    expect(result.markdownItems).toHaveLength(1);
    expect(result.markdownItems[0]).toMatchObject({
      id: 'wiki-page-/wiki-entries/note',
      type: 'wiki-page',
      displayName: 'Note',
      relPath: 'entries/note',
      filePath: '/wiki/entries/note.md',
    });
    expect(result.directoryItems.map((item) => item.directoryRelPath)).toEqual(['entries']);
  });

  it('builds launcher rows for a single external markdown delta', () => {
    const result = flattenLibraryPageDeltaForLauncher(
      { path: '/projects/docs', label: 'docs', builtin: false },
      { kind: 'file', relPath: 'plans/roadmap', absPath: '/projects/docs/plans/roadmap.md', name: 'roadmap', title: 'Roadmap', lastUpdated: 20 },
    );

    expect(result.markdownItems).toHaveLength(1);
    expect(result.markdownItems[0]).toMatchObject({
      id: 'markdown-file-/projects/docs-plans/roadmap',
      type: 'markdown-file',
      displayName: 'Roadmap — docs',
      filePath: '/projects/docs/plans/roadmap.md',
    });
    expect(result.directoryItems.map((item) => item.directoryRelPath)).toEqual(['', 'plans']);
  });

  it('indexes builtin wiki pages and external library markdown files', () => {
    const items = flattenLibraryRootsForLauncher([
      {
        path: '/wiki',
        label: 'Wiki',
        builtin: true,
        tree: [
          { kind: 'file', relPath: 'entries/note', absPath: '/wiki/entries/note.md', name: 'note', title: 'Note', lastUpdated: 1 },
          { kind: 'file', relPath: 'reports/summary.html', absPath: '/wiki/reports/summary.html', name: 'summary.html', title: 'summary.html', lastUpdated: 3, documentKind: 'html' },
          { kind: 'file', relPath: 'Commands/workflow', absPath: '/wiki/Commands/workflow.md', name: 'workflow', title: 'workflow', lastUpdated: 4 },
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

    expect(items.map((item) => item.type)).toEqual(['markdown-file', 'markdown-file', 'markdown-file', 'wiki-page']);
    expect(items[0]).toMatchObject({ displayName: 'workflow — Commands', filePath: '/wiki/Commands/workflow.md', relPath: undefined });
    expect(items[0].keywords).toContain('commands');
    expect(items[1]).toMatchObject({ displayName: 'summary.html — Wiki', filePath: '/wiki/reports/summary.html', relPath: undefined });
    expect(items[2]).toMatchObject({ displayName: 'Roadmap — docs', filePath: '/projects/docs/plans/roadmap.md' });
    expect(items[3]).toMatchObject({ displayName: 'Note', relPath: 'entries/note' });
    expect(items[2].keywords).toContain('docs');
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

  it('carries River shared callsigns into launcher markdown items', () => {
    const [item] = flattenLibraryRootsForLauncher([
      {
        path: '/Users/afar/.fieldtheory/library/River (shared)',
        label: 'River (shared)',
        builtin: false,
        tree: [
          {
            kind: 'file',
            relPath: 'brief AM',
            absPath: '/Users/afar/.fieldtheory/library/River (shared)/brief AM.md',
            name: 'brief AM',
            title: 'brief',
            lastUpdated: 2,
            sharedOriginalSourcePath: 'Commands/brief.md',
            sharedAuthorCallsign: 'AMB-MAC',
          },
        ],
      },
    ]);

    expect(item).toMatchObject({
      displayName: 'brief — River (shared)',
      source: 'shared',
      sourceLabel: 'River (shared)',
      sharedAuthorCallsign: 'AMB-MAC',
    });
    expect(item.keywords).toContain('AMB-MAC');
  });
});

describe('commandPathToLauncherLibraryOpenTarget', () => {
  it('opens reserved built-in command files as external Library documents', () => {
    expect(commandPathToLauncherLibraryOpenTarget(
      '/Users/afar/.fieldtheory/library/Commands/workflow.md',
      [{ path: '/Users/afar/.fieldtheory/library', builtin: true }],
    )).toEqual({
      kind: 'external',
      path: '/Users/afar/.fieldtheory/library/Commands/workflow.md',
    });
  });

  it('keeps normal built-in Library files as wiki targets', () => {
    expect(commandPathToLauncherLibraryOpenTarget(
      '/Users/afar/.fieldtheory/library/scratchpad/note.md',
      [{ path: '/Users/afar/.fieldtheory/library', builtin: true }],
    )).toEqual({ kind: 'wiki', path: 'scratchpad/note' });
  });
});

describe('launcher root search labels', () => {
  it('names the future root-search categories explicitly', () => {
    expect(Object.keys(LAUNCHER_ROOT_SEARCH_KIND_LABELS).sort()).toEqual([
      'calculator',
      'calendar',
      'contact',
      'currency',
      'dictionary',
      'file',
      'recent-document',
      'system-command',
      'system-setting',
      'terminal-command',
      'time-zone',
      'unit',
      'url',
      'web-search',
    ].sort());
  });
});

describe('getLauncherNativeIconPathForItem', () => {
  it('prefers file paths, then directory paths for native launcher icons', () => {
    expect(getLauncherNativeIconPathForItem({
      filePath: '/Users/tester/Notes.md',
      directoryPath: '/Users/tester',
    })).toBe('/Users/tester/Notes.md');
    expect(getLauncherNativeIconPathForItem({
      directoryPath: '/Users/tester',
    })).toBe('/Users/tester');
    expect(getLauncherNativeIconPathForItem({})).toBeNull();
  });
});

describe('launcher root search settings', () => {
  it('normalizes missing and partial root-search kind settings', () => {
    expect(normalizeLauncherRootSearchEnabledKinds(null)).toEqual(DEFAULT_LAUNCHER_ROOT_SEARCH_ENABLED_KINDS);
    expect(normalizeLauncherRootSearchEnabledKinds({ file: false, contact: true })).toEqual({
      ...DEFAULT_LAUNCHER_ROOT_SEARCH_ENABLED_KINDS,
      file: false,
      contact: true,
    });
    expect(isLauncherRootSearchKindEnabled({ file: false }, 'file')).toBe(false);
  });

  it('compares normalized root-search settings so reloads can avoid render loops', () => {
    expect(areLauncherRootSearchEnabledKindsEqual(
      DEFAULT_LAUNCHER_ROOT_SEARCH_ENABLED_KINDS,
      normalizeLauncherRootSearchEnabledKinds(null),
    )).toBe(true);
    expect(areLauncherRootSearchEnabledKindsEqual(
      { file: true },
      { file: true },
    )).toBe(true);
    expect(areLauncherRootSearchEnabledKindsEqual(
      { file: true },
      { file: false },
    )).toBe(false);
  });
});

describe('launcher file search helpers', () => {
  it('parses apostrophe-prefixed file searches only', () => {
    expect(getLauncherFileSearchQuery("'draft")).toBe('draft');
    expect(getLauncherFileSearchQuery("'  budget")).toBe('budget');
    expect(getLauncherFileSearchQuery('draft')).toBeNull();
  });

  it('builds file rows as root-search items with path keywords', () => {
    const [item] = buildLauncherFileItems([
      {
        name: 'Draft Notes.md',
        displayName: 'Draft Notes.md',
        filePath: '/Users/tester/Documents/Draft Notes.md',
        isDirectory: false,
        lastModified: 456,
      },
    ]);

    expect(item).toEqual(expect.objectContaining({
      id: 'file-/Users/tester/Documents/Draft Notes.md',
      type: 'file',
      rootSearchKind: 'file',
      rootSearchLabel: LAUNCHER_ROOT_SEARCH_KIND_LABELS.file,
      filePath: '/Users/tester/Documents/Draft Notes.md',
      hotkeyDisplay: 'Documents',
      lastUpdated: 456,
    }));
    expect(item.keywords).toEqual(expect.arrayContaining(['Draft Notes.md', '/Users/tester/Documents/Draft Notes.md', 'Documents']));
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

  it('includes external library roots as selectable root folders', () => {
    const items = flattenLibraryDirectoriesForLauncher([
      {
        path: '/Drive/Team Markdown',
        label: 'Team Markdown',
        builtin: false,
        tree: [],
      },
    ]);

    expect(items).toEqual([
      expect.objectContaining({
        type: 'directory',
        name: 'Team Markdown',
        displayName: 'Team Markdown',
        rootPath: '/Drive/Team Markdown',
        rootBuiltin: false,
        directoryPath: '/Drive/Team Markdown',
        directoryRelPath: '',
      }),
    ]);
  });
});

describe('buildCommandDirectoriesForLauncher', () => {
  it('builds searchable portable-command folder rows including empty folders from the command manager', () => {
    const items = buildCommandDirectoriesForLauncher([
      {
        name: 'Commands',
        displayName: 'Commands',
        rootPath: '/Users/tester/.fieldtheory/library/Commands',
        directoryPath: '/Users/tester/.fieldtheory/library/Commands',
        directoryRelPath: '',
        lastModified: 100,
      },
      {
        name: 'Writing',
        displayName: 'Writing',
        rootPath: '/Users/tester/.fieldtheory/library/Commands',
        directoryPath: '/Users/tester/.fieldtheory/library/Commands/Writing',
        directoryRelPath: 'Writing',
        lastModified: 200,
      },
    ]);

    expect(items).toEqual([
      expect.objectContaining({
        type: 'directory',
        name: 'Commands',
        displayName: 'Commands',
        directoryPath: '/Users/tester/.fieldtheory/library/Commands',
        directoryRelPath: '',
        hotkeyDisplay: 'folder',
      }),
      expect.objectContaining({
        type: 'directory',
        name: 'Writing',
        displayName: 'Writing',
        directoryPath: '/Users/tester/.fieldtheory/library/Commands/Writing',
        directoryRelPath: 'Writing',
        lastUpdated: 200,
      }),
    ]);
    expect(items[1].keywords).toEqual(expect.arrayContaining(['portable commands', 'folder', 'Writing']));
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
    rootBuiltin: false,
    directoryPath: '/Drive/Notes/Projects',
    directoryRelPath: 'Projects',
    hotkeyDisplay: 'folder',
  };

  it('resolves valid move targets inside the same library root', () => {
    expect(getLauncherMoveDirectoryTarget(source, directory)).toEqual({
      sourceRootPath: '/Drive/Notes',
      targetRootPath: '/Drive/Notes',
      targetDirRelPath: 'Projects',
      targetType: 'external',
    });
  });

  it('rejects moving into the current parent', () => {
    expect(getLauncherMoveDirectoryTarget(source, {
      ...directory,
      directoryPath: '/Drive/Notes/Inbox',
      directoryRelPath: 'Inbox',
    })).toBeNull();
  });

  it('allows moving into another visible library root', () => {
    expect(getLauncherMoveDirectoryTarget(source, {
      ...directory,
      rootPath: '/Other',
      rootBuiltin: true,
      directoryPath: '/Other/Projects',
    })).toEqual({
      sourceRootPath: '/Drive/Notes',
      targetRootPath: '/Other',
      targetDirRelPath: 'Projects',
      targetType: 'wiki',
    });
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
    expect(getLauncherMovedFilePath({ ...source, type: 'wiki' }, 'Projects/current', '/Other', 'external')).toBe('/Other/Projects/current.md');
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
    expect(isGeneratedBookmarkTaxonomyPath('/Users/a/.fieldtheory/library/Commands/categories/commerce.md')).toBe(false);
  });
});

describe('getGeneratedBookmarkTaxonomyPathInfo', () => {
  it('returns the taxonomy kind and value for generated bookmark taxonomy pages', () => {
    expect(getGeneratedBookmarkTaxonomyPathInfo('categories/commerce')).toEqual({ kind: 'category', value: 'commerce' });
    expect(getGeneratedBookmarkTaxonomyPathInfo('/Users/a/.fieldtheory/library/domains/commerce.md')).toEqual({ kind: 'domain', value: 'commerce' });
    expect(getGeneratedBookmarkTaxonomyPathInfo('bookmarks-from-x/entities/paulg')).toEqual({ kind: 'entity', value: 'paulg' });
  });
});

describe('bookmark embed launcher helpers', () => {
  it('formats bookmark launcher rows as rendered-editor bookmark embeds', () => {
    expect(formatLauncherBookmarkEmbedMarkdown({
      itemType: 'bookmark',
      bookmarkId: 'bookmark 1',
      displayName: 'Saved [thing]',
      name: 'fallback',
    })).toBe('![Saved \\[thing\\]](bookmark://bookmark%201)');
  });

  it('ignores non-bookmark rows and missing bookmark ids', () => {
    expect(formatLauncherBookmarkEmbedMarkdown({
      itemType: 'wiki-page',
      bookmarkId: 'bookmark-1',
      displayName: 'Page',
    })).toBeNull();
    expect(formatLauncherBookmarkEmbedMarkdown({
      itemType: 'bookmark',
      displayName: 'Bookmark',
    })).toBeNull();
  });

  it('uses Enter on default Bookmarks rows to insert embeds in Field Theory documents', () => {
    expect(getLauncherDefaultBookmarkEnterAction({
      itemType: 'bookmark',
      bookmarkId: 'bookmark 1',
      displayName: 'Saved [thing]',
      name: 'fallback',
      fieldTheoryActive: true,
      hasActiveLibraryFileContext: true,
      canInsertMarkdown: true,
      hasBookmarkPasteText: true,
      canPasteText: true,
      canCopyForAgent: true,
    })).toEqual({
      kind: 'insert-bookmark-embed',
      markdown: '![Saved \\[thing\\]](bookmark://bookmark%201)',
    });
  });

  it('falls back from Enter on default Bookmarks rows to paste, copy, then invoke outside Field Theory documents', () => {
    const base = {
      itemType: 'bookmark',
      bookmarkId: 'bookmark-1',
      displayName: 'Bookmark',
      name: 'bookmark',
      fieldTheoryActive: false,
      hasActiveLibraryFileContext: false,
      canInsertMarkdown: true,
    };

    expect(getLauncherDefaultBookmarkEnterAction({
      ...base,
      hasBookmarkPasteText: true,
      canPasteText: true,
      canCopyForAgent: true,
    })).toEqual({ kind: 'paste-bookmark-text' });
    expect(getLauncherDefaultBookmarkEnterAction({
      ...base,
      hasBookmarkPasteText: false,
      canPasteText: true,
      canCopyForAgent: true,
    })).toEqual({ kind: 'copy-bookmark-for-agent' });
    expect(getLauncherDefaultBookmarkEnterAction({
      ...base,
      hasBookmarkPasteText: false,
      canPasteText: false,
      canCopyForAgent: false,
    })).toEqual({ kind: 'invoke-bookmark' });
    expect(getLauncherDefaultBookmarkEnterAction({
      ...base,
      itemType: 'bookmark-author',
      hasBookmarkPasteText: true,
      canPasteText: true,
      canCopyForAgent: true,
    })).toBeNull();
  });
});

describe('filterLauncherNamespaceItems', () => {
  const items = [
    { name: 'daily-note', displayName: 'Daily Note', keywords: ['scratchpad', 'today'] },
    { name: 'roadmap', displayName: 'Product Roadmap', keywords: ['planning'] },
  ];

  it('returns all items for blank searches', () => {
    expect(filterLauncherNamespaceItems(items, '')).toEqual(items);
    expect(filterLauncherNamespaceItems(items, '   ')).toEqual(items);
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

  it('sorts bookmark author rows by latest post date', () => {
    const items = buildBookmarkAuthorLauncherItems([
      {
        handle: 'older',
        name: 'Older',
        count: 1,
        firstPostedAt: '2026-01-01T00:00:00Z',
        lastPostedAt: '2026-01-02T00:00:00Z',
      },
      {
        handle: 'newer',
        name: 'Newer',
        count: 1,
        firstPostedAt: '2026-01-01T00:00:00Z',
        lastPostedAt: '2026-01-03T00:00:00Z',
      },
    ]);

    expect(items.map(item => item.authorHandle)).toEqual(['newer', 'older']);
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

  it('sorts bookmark post rows by newest post first', () => {
    const items = buildBookmarkPostLauncherItems([
      {
        id: 'older',
        text: 'Older bookmark',
        url: '',
        authorHandle: 'alice',
        authorName: 'Alice',
        postedAt: '2026-01-01T00:00:00Z',
      },
      {
        id: 'newer',
        text: 'Newer bookmark',
        url: '',
        authorHandle: 'alice',
        authorName: 'Alice',
        postedAt: '2026-01-02T00:00:00Z',
      },
    ]);

    expect(items.map(item => item.bookmarkId)).toEqual(['newer', 'older']);
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

  it('captures space after a result is explicitly selected', () => {
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
  it('moves to the second row on the first ArrowDown because the first row is already soft-selected', () => {
    expect(nextLauncherArrowIndex(0, 3, 'down')).toBe(1);
  });

  it('moves down after a row has been explicitly selected', () => {
    expect(nextLauncherArrowIndex(0, 3, 'down')).toBe(1);
  });

  it('clamps arrow movement to available rows', () => {
    expect(nextLauncherArrowIndex(2, 3, 'down')).toBe(2);
    expect(nextLauncherArrowIndex(0, 3, 'up')).toBe(0);
  });
});

describe('shouldReturnLauncherSelectionToInput', () => {
  it('returns to input when ArrowUp is pressed from the first explicit row', () => {
    expect(shouldReturnLauncherSelectionToInput(0, 3, true)).toBe(true);
  });

  it('does not return to input when there is no explicit row selection', () => {
    expect(shouldReturnLauncherSelectionToInput(0, 3, false)).toBe(false);
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

  it('uses a selected portable-command folder row as a directory namespace', () => {
    const commandDirectory = {
      id: 'command-directory-/commands/Writing',
      type: 'directory',
      name: 'Writing',
      displayName: 'Writing',
      directoryPath: '/commands/Writing',
      directoryRelPath: 'Writing',
      keywords: ['Writing', 'portable commands'],
    };

    expect(resolveLauncherDirectoryNamespace([commandDirectory], directoryItems, 0, 'entry')).toBe(commandDirectory);
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
      filePath: '/Users/afar/.fieldtheory/library/Commands/assess.md',
      keywords: ['assess'],
    },
    {
      id: 'cmd-refactor',
      type: 'command',
      name: 'refactor',
      displayName: 'refactor.md',
      filePath: '/Users/afar/.fieldtheory/library/Commands/refactor.md',
      keywords: ['refactor'],
    },
  ];

  it('uses the typed command instead of stale row-zero selection', () => {
    expect(resolveLauncherCommandOpenTarget([commandItems[0]], commandItems, 0, 'refactor', false)).toBe(commandItems[1]);
  });

  it('matches a typed markdown filename', () => {
    expect(resolveLauncherCommandOpenTarget([commandItems[0]], commandItems, 0, 'refactor.md', false)).toBe(commandItems[1]);
  });

  it('uses the selected command row for a blank query', () => {
    expect(resolveLauncherCommandOpenTarget(commandItems, commandItems, 1, '', false)).toBe(commandItems[1]);
  });

  it('honors an explicit selected command row', () => {
    expect(resolveLauncherCommandOpenTarget(commandItems, commandItems, 0, 'refactor', true)).toBe(commandItems[0]);
  });

  it('does not resolve a typed command over an explicit selected file row', () => {
    expect(resolveLauncherCommandOpenTarget([
      {
        id: 'plan-entry',
        type: 'wiki-page',
        name: 'entry',
        displayName: 'Entry plan',
        filePath: '/Users/afar/.fieldtheory/library/Plans/entry.md',
        keywords: ['entry', 'Plans'],
      },
    ], commandItems, 0, 'refactor', true)).toBeNull();
  });

  it('ignores a non-command selected row when the typed command is clear', () => {
    expect(resolveLauncherCommandOpenTarget([
      {
        id: 'wiki-refactor',
        type: 'wiki-page',
        name: 'refactor',
        displayName: 'Refactor Notes',
        filePath: '/Users/afar/.fieldtheory/library/entries/refactor.md',
        keywords: ['refactor'],
      },
    ], commandItems, 0, 'refactor', false)).toBe(commandItems[1]);
  });

  it('does not open row zero for an unrelated query', () => {
    expect(resolveLauncherCommandOpenTarget([commandItems[0]], commandItems, 0, 'scratchpad', false)).toBeNull();
  });
});

describe('resolveLauncherFieldTheoryOpenTarget', () => {
  const fieldTheoryItems = [
    {
      id: 'recent-maxwell',
      type: 'recent-file',
      name: 'Maxwell stuff',
      displayName: 'Maxwell stuff',
      recentKind: 'wiki' as const,
      relPath: 'scratchpad/Maxwell stuff',
      keywords: ['Maxwell stuff'],
    },
    {
      id: 'wiki-field-theory-fn',
      type: 'wiki-page',
      name: 'field theory fn',
      displayName: 'field theory fn',
      relPath: 'scratchpad/field theory fn',
      filePath: '/Users/afar/.fieldtheory/library/scratchpad/field theory fn.md',
      keywords: ['field theory fn', 'scratchpad'],
    },
  ];

  it('uses the typed markdown file instead of stale row-zero soft selection', () => {
    expect(resolveLauncherFieldTheoryOpenTarget(
      [fieldTheoryItems[0]],
      fieldTheoryItems,
      0,
      'field theory fn',
      false,
    )).toBe(fieldTheoryItems[1]);
  });

  it('uses the selected markdown row for a blank query', () => {
    expect(resolveLauncherFieldTheoryOpenTarget(
      fieldTheoryItems,
      fieldTheoryItems,
      1,
      '',
      false,
    )).toBe(fieldTheoryItems[1]);
  });

  it('honors an explicit selected markdown row', () => {
    expect(resolveLauncherFieldTheoryOpenTarget(
      fieldTheoryItems,
      fieldTheoryItems,
      0,
      'field theory fn',
      true,
    )).toBe(fieldTheoryItems[0]);
  });

  it('honors an explicit selected plan row even when the query also matches a command', () => {
    const planItem = {
      id: 'wiki-plan-entry',
      type: 'wiki-page',
      name: 'entry',
      displayName: 'entry',
      relPath: 'Plans/entry',
      filePath: '/Users/afar/.fieldtheory/library/Plans/entry.md',
      keywords: ['entry', 'Plans'],
    };

    expect(resolveLauncherFieldTheoryOpenTarget(
      [planItem],
      [...fieldTheoryItems, planItem],
      0,
      'entry',
      true,
    )).toBe(planItem);
  });

  it('does not open row zero for an unrelated markdown query', () => {
    expect(resolveLauncherFieldTheoryOpenTarget(
      [fieldTheoryItems[0]],
      fieldTheoryItems,
      0,
      'daily planning',
      false,
    )).toBeNull();
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

  it('opens handoff markdown files and root file-search markdown files as external Field Theory files', () => {
    expect(getLauncherFieldTheoryMarkdownTarget({
      id: 'handoff-daily',
      type: 'handoff',
      name: 'daily',
      displayName: 'daily',
      filePath: '/Users/afar/.fieldtheory/handoffs/daily.md',
      keywords: ['daily'],
    })).toEqual({ kind: 'external', path: '/Users/afar/.fieldtheory/handoffs/daily.md' });
    expect(getLauncherFieldTheoryMarkdownTarget({
      id: 'file-note',
      type: 'file',
      name: 'note.md',
      displayName: 'note.md',
      filePath: '/Users/afar/Downloads/note.md',
      isDirectory: false,
      keywords: ['note.md'],
    })).toEqual({ kind: 'external', path: '/Users/afar/Downloads/note.md' });
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
      filePath: '/Users/afar/.fieldtheory/library/Commands/refactor.md',
      keywords: ['refactor'],
    })).toEqual({ kind: 'command', path: '/Users/afar/.fieldtheory/library/Commands/refactor.md' });
  });
});

describe('getLauncherAreaActionIdForQuery', () => {
  it('maps exact area queries to app-area actions', () => {
    expect(getLauncherAreaActionIdForQuery('clipboard')).toBe('open-history');
    expect(getLauncherAreaActionIdForQuery(' library ')).toBe('open-library');
    expect(getLauncherAreaActionIdForQuery('COMMANDS')).toBe('open-library');
    expect(getLauncherAreaActionIdForQuery('archive')).toBe('archive-current-library-file');
  });

  it('does not route partial area words', () => {
    expect(getLauncherAreaActionIdForQuery('command')).toBeNull();
    expect(getLauncherAreaActionIdForQuery('meeting')).toBeNull();
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
      'open-library', 'view-bookmarks', 'save-current-website', 'move-current-library-file',
      'archive-current-library-file', 'undo-library-move', 'toggle-theme',
      'toggle-line-numbers'];
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

  it('labels horizontal window spreading as a two-word action', () => {
    const actions = buildBuiltInLauncherActions(DEFAULT_LAUNCHER_HOTKEYS, true);

    expect(actions.find((action) => action.actionId === 'horizontalSpread')).toEqual(expect.objectContaining({
      name: 'spread horizontal',
      displayName: 'Spread Horizontal',
      keywords: expect.arrayContaining(['horizontal', 'spread horizontal']),
    }));
  });

  it('keeps Squares actions visible even when portable command visibility is disabled', () => {
    const actions = buildBuiltInLauncherActions(DEFAULT_LAUNCHER_HOTKEYS, true, DEFAULT_SQUARES_HOTKEYS, false);

    const actionIds = new Set(actions.map((action) => action.actionId));

    for (const def of SQUARES_ACTION_DEFS) {
      expect(actionIds.has(def.actionId)).toBe(true);
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

  it('includes commands keywords on the Library app-area action', () => {
    const actions = buildBuiltInLauncherActions(DEFAULT_LAUNCHER_HOTKEYS, true);

    expect(actions.find((action) => action.actionId === 'open-library')).toEqual(expect.objectContaining({
      name: 'library',
      displayName: 'Open Library',
      keywords: expect.arrayContaining(['commands', 'portable commands']),
    }));
    expect(actions.find((action) => action.actionId === 'open-commands')).toBeUndefined();
  });

  it('includes a line numbers action for the command launcher', () => {
    const actions = buildBuiltInLauncherActions(DEFAULT_LAUNCHER_HOTKEYS, true);

    expect(actions.find((action) => action.actionId === 'toggle-line-numbers')).toEqual(expect.objectContaining({
      name: 'line numbers',
      displayName: 'Toggle Line Numbers',
      hotkey: 'Shift+Command+K',
      keywords: expect.arrayContaining(['line numbers', 'markdown line numbers']),
    }));
  });

  it('includes move, archive, and undo move actions', () => {
    const actions = buildBuiltInLauncherActions(DEFAULT_LAUNCHER_HOTKEYS, true);

    expect(actions.find((action) => action.actionId === 'move-current-library-file')).toEqual(expect.objectContaining({
      name: 'move file',
      displayName: 'Move Current File',
    }));
    expect(actions.find((action) => action.actionId === 'archive-current-library-file')).toEqual(expect.objectContaining({
      name: 'archive',
      displayName: 'Archive Current File',
      keywords: expect.arrayContaining(['archive', 'e']),
      hotkeyDisplay: 'E',
    }));
    expect(actions.find((action) => action.actionId === 'undo-library-move')).toEqual(expect.objectContaining({
      name: 'undo move',
      displayName: 'Undo Last Move',
    }));
  });

  it('hides meeting actions from the command launcher', () => {
    const actions = buildBuiltInLauncherActions(DEFAULT_LAUNCHER_HOTKEYS, true);
    const actionIds = actions.map((action) => action.actionId);

    expect(actionIds).not.toContain('new-meeting-note');
    expect(actionIds).not.toContain('start-meeting-here');
    expect(actionIds).not.toContain('stop-meeting');
    expect(actionIds).not.toContain('summarize-meeting');
  });

  it('prioritizes action second words in normal launcher results', () => {
    const actions = buildBuiltInLauncherActions(DEFAULT_LAUNCHER_HOTKEYS, true);
    const results = filterLauncherNormalModeItems(actions, 'horizontal');

    expect(results[0]).toEqual(expect.objectContaining({
      actionId: 'horizontalSpread',
      displayName: 'Spread Horizontal',
    }));
  });

  it('gives actions command-adjacent relevance when rows have no recency', () => {
    const items = [
      {
        id: 'command-toggle-lines',
        type: 'command' as const,
        name: 'toggle lines',
        displayName: 'Toggle Lines',
        keywords: ['toggle lines'],
      },
      {
        id: 'action-toggle-theme',
        type: 'action' as const,
        name: 'toggle theme',
        displayName: 'Toggle Theme',
        keywords: ['toggle theme'],
        actionId: 'toggle-theme',
      },
      {
        id: 'wiki-toggle',
        type: 'wiki-page' as const,
        name: 'toggle note',
        displayName: 'Toggle Note',
        keywords: ['toggle note'],
      },
    ];

    const results = filterLauncherNormalModeItems(items, 'toggle');

    expect(results.map(item => item.id)).toEqual([
      'command-toggle-lines',
      'action-toggle-theme',
      'wiki-toggle',
    ]);
  });
});
