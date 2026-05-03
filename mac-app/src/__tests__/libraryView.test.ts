import { afterEach, describe, expect, it } from 'vitest';
import {
  cycleMarkdownTodoState,
  deletedLibraryItemMatchesSelection,
  editorSessionMatchesSelection,
  findNextMarkdownMatch,
  getCarrotListEnterEdit,
  getCarrotListTabEdit,
  getMarkdownListEnterEdit,
  getMarkdownBodySelectionRange,
  getMarkdownListToggleEdit,
  getRenderedMarkdownClickBehavior,
  getRenderedMarkdownNodeStartLine,
  getRenderedTaskListItemChecked,
  getRenderedMarkdownSelectionToolbarState,
  getRenderedMarkdownSelectionFormatEdit,
  getFocusChromeHintOpacity,
  getFocusChromeSurfaceOpacity,
  getMarkdownWikiLinkCompletionState,
  getNewlyCheckedMarkdownTasks,
  getLibrarianContentTopPadding,
  highlightFileFindMatches,
  formatBreadcrumb,
  getMarkdownEditorEdgeFades,
  getGroupedFocusChromeProximityOpacity,
  getMarkdownTaskLines,
  getMarkdownRenderedBodyStartLineIndex,
  getRenderedTaskLinesByRenderedLine,
  getScrollRatio,
  getScrollTopForRatio,
  isBookmarksCanvasChromeActive,
  isLibrarianDocumentFocusChromeActive,
  isRenderedTaskListItem,
  moveLibrarianNavigationHistory,
  normalizeMarkdownCarrotLists,
  normalizeMarkdownTodoLines,
  persistLibrarianTodoMarker,
  persistLibrarianUnorderedListMarker,
  persistLibrarianEditorSession,
  persistLibrarianSelection,
  preserveMarkdownBlankLines,
  pushLibrarianNavigationEntry,
  rankMarkdownWikiLinkSuggestions,
  rebaseMarkdownTodoStateChange,
  removeEmptyMarkdownCommentPlaceholders,
  replaceLibrarianNavigationEntry,
  resolveMarkdownCaretOffsetFromRenderedText,
  resolveMarkdownSelectionRangeFromRenderedText,
  restoreLibrarianEditorSession,
  restoreLibrarianTodoMarker,
  restoreLibrarianUnorderedListMarker,
  resolveWikiCreateFolder,
  restoreLibrarianSelection,
  shouldRevealFocusChrome,
  shouldRevealGroupedFocusChrome,
  shouldHandleMarkdownTodoTabShortcut,
  shouldOpenMarkdownEditorLinkFromMouseDown,
  shouldOpenMarkdownLinkFromMouseDown,
  shouldInsertClipboardImagePathForPaste,
  isTextEntryInputType,
  splitFrontmatter,
  setMarkdownTodoState,
  toggleMarkdownTaskLine,
  toggleMarkdownTaskLineAtIndex,
} from '../components/LibrarianView';
import {
  addPageToLibraryRoot,
  addWikiPageToLibraryRoots,
  addWikiPageToTree,
  applyPinnedSidebarOrder,
  applyTodoStateOverrideToItem,
  ensureScratchpadNodePresent,
  ensureScratchpadPinned,
  filterHiddenDefaultSidebarNodes,
  flattenBuiltinSidebarRoots,
  collectSidebarSiblingItems,
  clearLibraryDragData,
  canDropLibraryItem,
  filterStaleRecent,
  filterUnifiedFolders,
  getLibraryDragData,
  getPrimaryArtifactsFinderPath,
  getSidebarFolderFinderPath,
  getSelectedWikiAutoExpandKey,
  getWikiSidebarExpansionIds,
  hasLibraryDragData,
  hideReadmeOnlyLibraryArtifactsFolder,
  libraryRootsHaveBuiltinRelPath,
  orderTopLevelSidebarNodes,
  removeWikiRelPathFromLibraryRoots,
  removeWikiRelPathFromTree,
  renamePinnedSidebarIds,
  renameLibraryRootRelPath,
  shouldCapScratchpadSidebarNode,
  shouldShowPinnedSidebarDividerBefore,
  splitRecent,
  sortSidebarNodes,
  setLibraryDragData,
  virtualizeBookmarksGroup,
  wikiTreeHasRelPath,
  type LibrarySidebarNode,
} from '../components/WikiSidebar';

afterEach(() => {
  clearLibraryDragData();
  window.getSelection()?.removeAllRanges();
});

describe('rankMarkdownWikiLinkSuggestions', () => {
  it('keeps username-like matches searchable but ranks local content first', () => {
    const results = rankMarkdownWikiLinkSuggestions([
      { title: '@paulg', detail: 'bookmarks/people/@paulg', kind: 'wiki' },
      { title: 'Paul Graham notes', detail: 'entries/paul-graham-notes', kind: 'wiki' },
      { title: 'Paul Graham interview', detail: '/artifacts/paul-graham-interview.md', kind: 'artifact' },
    ], 'paul');

    expect(results.map((item) => item.title)).toEqual([
      'Paul Graham interview',
      'Paul Graham notes',
      '@paulg',
    ]);
  });

  it('returns username-like matches when they are the only match', () => {
    const results = rankMarkdownWikiLinkSuggestions([
      { title: '@paulg', detail: 'bookmarks/people/@paulg', kind: 'wiki' },
    ], 'paul');

    expect(results).toEqual([
      { title: '@paulg', detail: 'bookmarks/people/@paulg', kind: 'wiki' },
    ]);
  });
});

describe('getMarkdownWikiLinkCompletionState', () => {
  it('returns an active wikilink completion with editor-relative coordinates', () => {
    expect(getMarkdownWikiLinkCompletionState('See [[Con', 9, 9, { top: 24, left: 12 })).toEqual({
      openStart: 4,
      queryStart: 6,
      queryEnd: 9,
      replaceEnd: 9,
      query: 'Con',
      top: 24,
      left: 12,
    });
  });

  it('returns null when there is no caret position', () => {
    expect(getMarkdownWikiLinkCompletionState('See [[Con', 9, 9, null)).toBeNull();
  });
});

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

  it('extracts open and done todo state from frontmatter', () => {
    expect(splitFrontmatter('---\ntodo: true\ntodo_state: open\n---\n# Task').todoState).toBe('open');
    expect(splitFrontmatter('---\ntask: done\n---\n# Task').todoState).toBe('done');
    expect(splitFrontmatter('---\ntodo: false\n---\n# Note').todoState).toBeNull();
  });

  it('sets and removes todo state while preserving other frontmatter', () => {
    const content = '---\ntags: [work]\n---\n# Task\n';
    expect(setMarkdownTodoState(content, 'open')).toBe('---\ntags: [work]\n\ntodo: true\ntodo_state: open\n---\n\n# Task\n');
    expect(setMarkdownTodoState('---\ntags: [work]\ntodo: true\ntodo_state: done\n---\n# Task\n', null)).toBe('---\ntags: [work]\n---\n\n# Task\n');
  });

  it('cycles todo state from none to open to done to none', () => {
    const open = cycleMarkdownTodoState('# Task\n');
    expect(open.state).toBe('open');
    expect(splitFrontmatter(open.content).todoState).toBe('open');

    const done = cycleMarkdownTodoState(open.content);
    expect(done.state).toBe('done');
    expect(splitFrontmatter(done.content).todoState).toBe('done');

    const none = cycleMarkdownTodoState(done.content);
    expect(none.state).toBeNull();
    expect(none.content).toBe('# Task\n');
  });

  it('cycles todo state backward from none to done to open to none', () => {
    const done = cycleMarkdownTodoState('# Task\n', 'backward');
    expect(done.state).toBe('done');

    const open = cycleMarkdownTodoState(done.content, 'backward');
    expect(open.state).toBe('open');

    const none = cycleMarkdownTodoState(open.content, 'backward');
    expect(none.state).toBeNull();
    expect(none.content).toBe('# Task\n');
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

  it('returns the source line where rendered body content starts', () => {
    expect(getMarkdownRenderedBodyStartLineIndex('# Task')).toBe(0);
    expect(getMarkdownRenderedBodyStartLineIndex('---\ntags: [test]\n---\n# Task')).toBe(3);
    expect(getMarkdownRenderedBodyStartLineIndex('---\ntags: [test]\n---\n\n\n# Task')).toBe(5);
  });

  it('ignores malformed frontmatter lines', () => {
    const content = '---\ntags: [test]\nno-colon-here\nlast_updated: 2026-04-15\n---\n\nBody.';
    const result = splitFrontmatter(content);
    expect(result.meta.tags).toBe('[test]');
    expect(result.meta.last_updated).toBe('2026-04-15');
    expect(Object.keys(result.meta)).toHaveLength(2);
  });
});

describe('shouldHandleMarkdownTodoTabShortcut', () => {
  it('uses Tab and Shift+Tab for wiki and external markdown files', () => {
    expect(shouldHandleMarkdownTodoTabShortcut({
      key: 'Tab',
      shiftKey: false,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      selectedItemType: 'wiki',
    })).toBe(true);
    expect(shouldHandleMarkdownTodoTabShortcut({
      key: 'Tab',
      shiftKey: false,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      selectedItemType: 'external',
    })).toBe(true);
    expect(shouldHandleMarkdownTodoTabShortcut({
      key: 'Tab',
      shiftKey: true,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      selectedItemType: 'wiki',
    })).toBe(true);
  });

  it('ignores command-modified Tab and non-markdown selections', () => {
    expect(shouldHandleMarkdownTodoTabShortcut({
      key: 'Tab',
      shiftKey: true,
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      selectedItemType: 'wiki',
    })).toBe(false);
    expect(shouldHandleMarkdownTodoTabShortcut({
      key: 'Tab',
      shiftKey: false,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      selectedItemType: 'artifact',
    })).toBe(false);
  });
});

describe('shouldOpenMarkdownLinkFromMouseDown', () => {
  it('opens rendered links on an ordinary primary click', () => {
    expect(shouldOpenMarkdownLinkFromMouseDown({
      button: 0,
      altKey: false,
      ctrlKey: false,
    })).toBe(true);
  });

  it('keeps modified and non-primary clicks available for browser/editor behavior', () => {
    expect(shouldOpenMarkdownLinkFromMouseDown({
      button: 0,
      altKey: true,
      ctrlKey: false,
    })).toBe(false);
    expect(shouldOpenMarkdownLinkFromMouseDown({
      button: 0,
      altKey: false,
      ctrlKey: true,
    })).toBe(false);
    expect(shouldOpenMarkdownLinkFromMouseDown({
      button: 1,
      altKey: false,
      ctrlKey: false,
    })).toBe(false);
  });
});

describe('shouldOpenMarkdownEditorLinkFromMouseDown', () => {
  it('opens editor links only on Command-primary click', () => {
    expect(shouldOpenMarkdownEditorLinkFromMouseDown({
      button: 0,
      metaKey: true,
      altKey: false,
      ctrlKey: false,
    })).toBe(true);
    expect(shouldOpenMarkdownEditorLinkFromMouseDown({
      button: 0,
      metaKey: false,
      altKey: false,
      ctrlKey: false,
    })).toBe(false);
  });

  it('keeps modified and non-primary editor clicks available for editing', () => {
    expect(shouldOpenMarkdownEditorLinkFromMouseDown({
      button: 0,
      metaKey: true,
      altKey: true,
      ctrlKey: false,
    })).toBe(false);
    expect(shouldOpenMarkdownEditorLinkFromMouseDown({
      button: 0,
      metaKey: true,
      altKey: false,
      ctrlKey: true,
    })).toBe(false);
    expect(shouldOpenMarkdownEditorLinkFromMouseDown({
      button: 1,
      metaKey: true,
      altKey: false,
      ctrlKey: false,
    })).toBe(false);
  });
});

describe('isTextEntryInputType', () => {
  it('treats text-like inputs as text entry', () => {
    expect(isTextEntryInputType('text')).toBe(true);
    expect(isTextEntryInputType('search')).toBe(true);
    expect(isTextEntryInputType(undefined)).toBe(true);
  });

  it('does not treat checkboxes as text entry', () => {
    expect(isTextEntryInputType('checkbox')).toBe(false);
  });
});

describe('shouldInsertClipboardImagePathForPaste', () => {
  it('only inserts a clipboard image path when the paste event has an image', () => {
    expect(shouldInsertClipboardImagePathForPaste({ pastedText: '', hasImage: false })).toBe(false);
    expect(shouldInsertClipboardImagePathForPaste({ pastedText: 'hello', hasImage: false })).toBe(false);
    expect(shouldInsertClipboardImagePathForPaste({ pastedText: '', hasImage: true })).toBe(true);
  });
});

describe('preserveMarkdownBlankLines', () => {
  it('turns empty source lines into rendered blank-line markers', () => {
    expect(preserveMarkdownBlankLines('First\n\nSecond')).toBe('First\n\n\u00A0\n\nSecond');
  });

  it('leaves fenced code block spacing alone', () => {
    expect(preserveMarkdownBlankLines('Before\n\n```\na\n\nb\n```\n\nAfter')).toBe(
      'Before\n\n\u00A0\n\n```\na\n\nb\n```\n\n\u00A0\n\nAfter',
    );
  });

  it('does not add visible blank-line markers between carrot list groups', () => {
    const normalized = normalizeMarkdownCarrotLists('› first\n›› child\n\n› second');
    expect(preserveMarkdownBlankLines(normalized)).toBe('- \u2060first\n  - \u2060child\n\n- \u2060second');
  });
});

describe('removeEmptyMarkdownCommentPlaceholders', () => {
  it('removes only empty standalone HTML comments', () => {
    expect(removeEmptyMarkdownCommentPlaceholders('First\n<!--  -->\nSecond')).toBe('First\n\nSecond');
    expect(removeEmptyMarkdownCommentPlaceholders('First\n<!---->\nSecond')).toBe('First\n\nSecond');
    expect(removeEmptyMarkdownCommentPlaceholders('First <!-- keep --> Second')).toBe('First <!-- keep --> Second');
    expect(removeEmptyMarkdownCommentPlaceholders('<!-- keep me -->')).toBe('<!-- keep me -->');
  });

  it('leaves empty comments inside fenced code blocks alone', () => {
    expect(removeEmptyMarkdownCommentPlaceholders('Before\n\n```html\n<!--  -->\n```\n\nAfter')).toBe(
      'Before\n\n```html\n<!--  -->\n```\n\nAfter',
    );
  });
});

describe('normalizeMarkdownTodoLines', () => {
  it('turns scratchpad [] lines into markdown task lines', () => {
    expect(normalizeMarkdownTodoLines('[] first\n  [] nested')).toBe('- [ ] first\n  - [ ] nested');
  });

  it('turns bare bracket task lines into markdown task lines', () => {
    expect(normalizeMarkdownTodoLines('[ ] first\n[x] second')).toBe('- [ ] first\n- [x] second');
  });

  it('leaves fenced code examples alone', () => {
    expect(normalizeMarkdownTodoLines('```\n[] literal\n[x] literal\n```\n[x] task')).toBe('```\n[] literal\n[x] literal\n```\n- [x] task');
  });
});

describe('normalizeMarkdownCarrotLists', () => {
  it('turns carrot stack lines into nested unordered markdown with a render sentinel', () => {
    expect(normalizeMarkdownCarrotLists('› first\n›› second\n››')).toBe('- \u2060first\n  - \u2060second\n  - \u2060');
  });

  it('leaves fenced carrot examples alone', () => {
    expect(normalizeMarkdownCarrotLists('```\n› literal\n```\n› real')).toBe('```\n› literal\n```\n- \u2060real');
  });
});

describe('carrot list editor helpers', () => {
  it('continues a carrot list on Enter', () => {
    expect(getCarrotListEnterEdit('› first', 7, 7)).toEqual({
      nextValue: '› first\n› ',
      selectionStart: 10,
      selectionEnd: 10,
    });
  });

  it('exits an empty carrot item on Enter', () => {
    expect(getCarrotListEnterEdit('› first\n›› ', 11, 11)).toEqual({
      nextValue: '› first\n',
      selectionStart: 8,
      selectionEnd: 8,
    });
  });

  it('indents and outdents carrot stacks with Tab and Shift+Tab', () => {
    expect(getCarrotListTabEdit('› item', 6, 6, 'in')).toEqual({
      nextValue: '›› item',
      selectionStart: 7,
      selectionEnd: 7,
    });
    expect(getCarrotListTabEdit('›› item', 7, 7, 'out')).toEqual({
      nextValue: '› item',
      selectionStart: 6,
      selectionEnd: 6,
    });
  });

  it('handles Shift+Tab at one carrot without deleting it', () => {
    expect(getCarrotListTabEdit('› item', 6, 6, 'out')).toEqual({
      nextValue: '› item',
      selectionStart: 6,
      selectionEnd: 6,
    });
  });
});

describe('markdown list editor helpers', () => {
  it('continues a dash list on Enter', () => {
    expect(getMarkdownListEnterEdit('- first', 7, 7)).toEqual({
      nextValue: '- first\n- ',
      selectionStart: 10,
      selectionEnd: 10,
    });
  });

  it('continues a task list on Enter with a fresh unchecked task', () => {
    expect(getMarkdownListEnterEdit('- [x] first', 11, 11)).toEqual({
      nextValue: '- [x] first\n- [ ] ',
      selectionStart: 18,
      selectionEnd: 18,
    });
  });

  it('continues a bare [] task on Enter without turning it into a bullet task', () => {
    expect(getMarkdownListEnterEdit('[] first', 8, 8)).toEqual({
      nextValue: '[] first\n[] ',
      selectionStart: 12,
      selectionEnd: 12,
    });
  });

  it('continues a bare [ ] task on Enter without turning it into a bullet task', () => {
    expect(getMarkdownListEnterEdit('[ ] first', 9, 9)).toEqual({
      nextValue: '[ ] first\n[ ] ',
      selectionStart: 14,
      selectionEnd: 14,
    });
  });

  it('exits an empty dash list item on Enter', () => {
    expect(getMarkdownListEnterEdit('- first\n- ', 10, 10)).toEqual({
      nextValue: '- first\n',
      selectionStart: 8,
      selectionEnd: 8,
    });
  });

  it('exits an empty task item on Enter', () => {
    expect(getMarkdownListEnterEdit('- first\n- [ ] ', 14, 14)).toEqual({
      nextValue: '- first\n',
      selectionStart: 8,
      selectionEnd: 8,
    });
  });

  it('exits an empty bare task item on Enter', () => {
    expect(getMarkdownListEnterEdit('[] first\n[] ', 12, 12)).toEqual({
      nextValue: '[] first\n',
      selectionStart: 9,
      selectionEnd: 9,
    });
  });

  it('toggles selected lines into ordered lists', () => {
    expect(getMarkdownListToggleEdit('first\nsecond', 0, 12, 'ordered')).toEqual({
      nextValue: '1. first\n2. second',
      selectionStart: 0,
      selectionEnd: 18,
    });
  });

  it('toggles selected lines into carrot unordered lists', () => {
    expect(getMarkdownListToggleEdit('first\nsecond', 0, 12, 'unordered', 'carrot')).toEqual({
      nextValue: '› first\n› second',
      selectionStart: 0,
      selectionEnd: 16,
    });
  });

  it('removes existing list markers when the selection is already marked', () => {
    expect(getMarkdownListToggleEdit('1. first\n2. second', 0, 18, 'ordered')).toEqual({
      nextValue: 'first\nsecond',
      selectionStart: 0,
      selectionEnd: 12,
    });
  });
});

describe('markdown body selection', () => {
  it('selects the body after a leading H1 and blank line', () => {
    expect(getMarkdownBodySelectionRange('# Title\n\nBody')).toEqual({ start: 9, end: 13 });
  });

  it('does not override select-all when there is no leading H1', () => {
    expect(getMarkdownBodySelectionRange('Body only')).toBeNull();
  });
});

describe('librarian unordered list marker preference', () => {
  it('round-trips the saved unordered marker', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };

    expect(restoreLibrarianUnorderedListMarker(storage)).toBe('dash');
    persistLibrarianUnorderedListMarker(storage, 'carrot');
    expect(restoreLibrarianUnorderedListMarker(storage)).toBe('carrot');
  });
});

describe('librarian todo marker preference', () => {
  it('round-trips the saved todo marker', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };

    expect(restoreLibrarianTodoMarker(storage)).toBe('circle');
    persistLibrarianTodoMarker(storage, 'square');
    expect(restoreLibrarianTodoMarker(storage)).toBe('square');
  });
});

describe('toggleMarkdownTaskLine', () => {
  it('checks and unchecks markdown task lines', () => {
    const checked = toggleMarkdownTaskLine('- [ ] first\n- [x] second', 'first', true);
    expect(checked).toBe('- [x] first\n- [x] second');
    expect(toggleMarkdownTaskLine(checked, 'first', false)).toBe('- [ ] first\n- [x] second');
  });

  it('preserves scratchpad bracket-only task syntax', () => {
    expect(toggleMarkdownTaskLine('[] first', 'first', true)).toBe('[x] first');
  });
});

describe('markdown task line indexing', () => {
  it('finds markdown task lines by source line index', () => {
    expect(getMarkdownTaskLines('- [ ] first\ntext\n  - [x] nested')).toEqual([
      { lineIndex: 0, text: 'first', checked: false },
      { lineIndex: 2, text: 'nested', checked: true },
    ]);
  });

  it('ignores task-looking lines inside fenced code', () => {
    expect(getMarkdownTaskLines('```\n- [ ] literal\n```\n- [x] real')).toEqual([
      { lineIndex: 3, text: 'real', checked: true },
    ]);
  });

  it('toggles a task by source line index instead of duplicate text', () => {
    expect(toggleMarkdownTaskLineAtIndex('- [ ] same\n- [ ] same', 1, true)).toBe('- [ ] same\n- [x] same');
    expect(toggleMarkdownTaskLineAtIndex('- [x] same\n- [x] same', 1, false)).toBe('- [x] same\n- [ ] same');
  });

  it('maps rendered task lines back through preserved blank-line spacing', () => {
    const content = [
      'Intro',
      '',
      '- [ ] first',
      '- [ ] second',
      '',
      '![figure](file:///tmp/figure.png)',
      '',
      '- [ ] third',
      '- [ ] fourth',
    ].join('\n');
    const renderedLines = getRenderedTaskLinesByRenderedLine(content);

    expect(renderedLines.get(5)).toMatchObject({ lineIndex: 2, text: 'first' });
    expect(renderedLines.get(6)).toMatchObject({ lineIndex: 3, text: 'second' });
    expect(renderedLines.get(14)).toMatchObject({ lineIndex: 7, text: 'third' });
    expect(renderedLines.get(15)).toMatchObject({ lineIndex: 8, text: 'fourth' });
  });

  it('maps bare rendered tasks back to bare source task lines', () => {
    const content = [
      '[] bare open',
      '[ ] bracket open',
      '[x] bare done',
      '- [x] dash done',
    ].join('\n');
    const renderedLines = getRenderedTaskLinesByRenderedLine(content);

    expect(renderedLines.get(1)).toMatchObject({ lineIndex: 0, text: 'bare open', checked: false });
    expect(renderedLines.get(2)).toMatchObject({ lineIndex: 1, text: 'bracket open', checked: false });
    expect(renderedLines.get(3)).toMatchObject({ lineIndex: 2, text: 'bare done', checked: true });
    expect(renderedLines.get(4)).toMatchObject({ lineIndex: 3, text: 'dash done', checked: true });
  });

  it('maps rendered task lines after frontmatter using real source indexes', () => {
    const content = [
      '---',
      'tags: [test]',
      '---',
      '',
      '# Plan',
      '',
      '- [ ] first',
      '- [x] second',
    ].join('\n');
    const renderedLines = getRenderedTaskLinesByRenderedLine(content);

    expect(renderedLines.get(5)).toMatchObject({ lineIndex: 6, text: 'first' });
    expect(renderedLines.get(6)).toMatchObject({ lineIndex: 7, text: 'second', checked: true });
  });
});

describe('rendered markdown task list detection', () => {
  it('recognizes task list items by checkbox child when the class is missing', () => {
    const node = {
      type: 'element',
      tagName: 'li',
      position: { start: { line: 4 } },
      children: [
        {
          type: 'element',
          tagName: 'input',
          properties: { type: 'checkbox', checked: true },
        },
        { type: 'text', value: 'Done item' },
      ],
    };

    expect(isRenderedTaskListItem(node)).toBe(true);
    expect(getRenderedTaskListItemChecked(node)).toBe(true);
    expect(getRenderedMarkdownNodeStartLine(node)).toBe(4);
  });

  it('reads unchecked rendered checkbox state', () => {
    const node = {
      type: 'element',
      tagName: 'li',
      children: [
        {
          type: 'element',
          tagName: 'input',
          properties: { type: 'checkbox', checked: false },
        },
        { type: 'text', value: 'Open item' },
      ],
    };

    expect(isRenderedTaskListItem(node)).toBe(true);
    expect(getRenderedTaskListItemChecked(node)).toBe(false);
  });
});

describe('rendered markdown task list detection', () => {
  it('recognizes task list items by checkbox child when the class is missing', () => {
    const node = {
      type: 'element',
      tagName: 'li',
      position: { start: { line: 4 } },
      children: [
        {
          type: 'element',
          tagName: 'input',
          properties: { type: 'checkbox', checked: true },
        },
        { type: 'text', value: 'Done item' },
      ],
    };

    expect(isRenderedTaskListItem(node)).toBe(true);
    expect(getRenderedTaskListItemChecked(node)).toBe(true);
    expect(getRenderedMarkdownNodeStartLine(node)).toBe(4);
  });

  it('reads unchecked rendered checkbox state', () => {
    const node = {
      type: 'element',
      tagName: 'li',
      children: [
        {
          type: 'element',
          tagName: 'input',
          properties: { type: 'checkbox', checked: false },
        },
        { type: 'text', value: 'Open item' },
      ],
    };

    expect(isRenderedTaskListItem(node)).toBe(true);
    expect(getRenderedTaskListItemChecked(node)).toBe(false);
  });
});

describe('rebaseMarkdownTodoStateChange', () => {
  it('reapplies a note todo-state change onto newer disk content', () => {
    const previous = '---\ntodo: true\ntodo_state: open\n---\n\n# Note\n\nOld body';
    const target = '---\ntodo: true\ntodo_state: done\n---\n\n# Note\n\nOld body';
    const disk = '---\ntodo: true\ntodo_state: open\n---\n\n# Note\n\nNew body';

    expect(rebaseMarkdownTodoStateChange(previous, target, disk)).toEqual({
      content: '---\ntodo: true\ntodo_state: done\n---\n\n# Note\n\nNew body',
      state: 'done',
    });
  });

  it('does not rebase when the target changed document body content too', () => {
    const previous = '---\ntodo_state: open\n---\n\nOld body';
    const target = '---\ntodo_state: done\n---\n\nEdited body';
    const disk = '---\ntodo_state: open\n---\n\nDisk body';

    expect(rebaseMarkdownTodoStateChange(previous, target, disk)).toBeNull();
  });
});

describe('getNewlyCheckedMarkdownTasks', () => {
  it('detects tasks checked between two markdown versions', () => {
    expect(getNewlyCheckedMarkdownTasks(
      '- [ ] first\n- [x] already\n[] scratch',
      '- [x] first\n- [x] already\n[x] scratch',
    )).toEqual(['first', 'scratch']);
  });

  it('ignores newly added tasks that are already checked', () => {
    expect(getNewlyCheckedMarkdownTasks('', '- [x] new task')).toEqual([]);
  });
});

describe('findNextMarkdownMatch', () => {
  it('finds from the requested offset and wraps to the top', () => {
    expect(findNextMarkdownMatch('Alpha beta alpha', 'alpha', 1)).toEqual({ start: 11, end: 16 });
    expect(findNextMarkdownMatch('Alpha beta alpha', 'alpha', 16)).toEqual({ start: 0, end: 5 });
  });

  it('returns null for empty or missing queries', () => {
    expect(findNextMarkdownMatch('Alpha', '')).toBeNull();
    expect(findNextMarkdownMatch('Alpha', 'beta')).toBeNull();
  });
});

describe('highlightFileFindMatches', () => {
  it('highlights rendered text without changing the text content', () => {
    const root = document.createElement('div');
    root.textContent = 'Alpha beta alpha';

    highlightFileFindMatches(root, 'alpha');

    expect(root.textContent).toBe('Alpha beta alpha');
    expect(root.querySelectorAll('mark[data-ft-file-find-mark]')).toHaveLength(2);
  });
});

describe('resolveMarkdownCaretOffsetFromRenderedText', () => {
  it('maps a rendered text-node offset back into the markdown source', () => {
    expect(resolveMarkdownCaretOffsetFromRenderedText('# Friday Notes\n', 'Friday Notes', 6)).toBe(8);
  });

  it('falls back to the rendered prefix when the full rendered text is not contiguous in source', () => {
    expect(resolveMarkdownCaretOffsetFromRenderedText('hello **world** today', 'hello world today', 11)).toBe(13);
  });

  it('maps rendered body text after frontmatter', () => {
    const markdown = '---\ntags: [Friday Notes]\n---\n\n# Friday Notes\n';
    expect(resolveMarkdownCaretOffsetFromRenderedText(markdown, 'Friday Notes', 6)).toBe(markdown.indexOf('# Friday Notes') + 8);
  });
});

describe('rendered markdown edit helpers', () => {
  it('wraps selected text with inline formatting markers', () => {
    expect(getRenderedMarkdownSelectionFormatEdit('hello world', 6, 11, 'bold')).toEqual({
      nextValue: 'hello **world**',
      selectionStart: 8,
      selectionEnd: 13,
    });
    expect(getRenderedMarkdownSelectionFormatEdit('hello world', 6, 11, 'italic')?.nextValue).toBe('hello *world*');
    expect(getRenderedMarkdownSelectionFormatEdit('hello world', 6, 11, 'code')?.nextValue).toBe('hello `world`');
    expect(getRenderedMarkdownSelectionFormatEdit('hello world', 6, 11, 'link')).toEqual({
      nextValue: 'hello [world]()',
      selectionStart: 14,
      selectionEnd: 14,
    });
  });

  it('toggles inline formatting markers off when selected text is already wrapped', () => {
    expect(getRenderedMarkdownSelectionFormatEdit('hello **world**', 8, 13, 'bold')).toEqual({
      nextValue: 'hello world',
      selectionStart: 6,
      selectionEnd: 11,
    });
    expect(getRenderedMarkdownSelectionFormatEdit('hello *world*', 7, 12, 'italic')?.nextValue).toBe('hello world');
    expect(getRenderedMarkdownSelectionFormatEdit('hello `world`', 7, 12, 'code')?.nextValue).toBe('hello world');
  });

  it('toggles inline formatting off when the selected source includes the markers', () => {
    expect(getRenderedMarkdownSelectionFormatEdit('hello **world**', 6, 15, 'bold')).toEqual({
      nextValue: 'hello world',
      selectionStart: 6,
      selectionEnd: 11,
    });
  });

  it('does not treat bold markers as italic when adding italic to bold text', () => {
    expect(getRenderedMarkdownSelectionFormatEdit('hello **world**', 8, 13, 'italic')).toEqual({
      nextValue: 'hello ***world***',
      selectionStart: 9,
      selectionEnd: 14,
    });
  });

  it('can toggle italic back off from combined bold and italic text', () => {
    expect(getRenderedMarkdownSelectionFormatEdit('hello ***world***', 9, 14, 'italic')).toEqual({
      nextValue: 'hello **world**',
      selectionStart: 8,
      selectionEnd: 13,
    });
  });

  it('toggles links off when the selected label is already linked', () => {
    expect(getRenderedMarkdownSelectionFormatEdit('hello [world](https://example.com)', 7, 12, 'link')).toEqual({
      nextValue: 'hello world',
      selectionStart: 6,
      selectionEnd: 11,
    });
    expect(getRenderedMarkdownSelectionFormatEdit('hello [world](https://example.com)', 6, 34, 'link')).toEqual({
      nextValue: 'hello world',
      selectionStart: 6,
      selectionEnd: 11,
    });
  });

  it('wraps selected source lines as an unordered list', () => {
    expect(getRenderedMarkdownSelectionFormatEdit('first\nsecond', 0, 12, 'unordered-list')).toEqual({
      nextValue: '- first\n- second',
      selectionStart: 0,
      selectionEnd: 16,
    });
  });

  it('toggles unordered list markers off selected source lines', () => {
    expect(getRenderedMarkdownSelectionFormatEdit('- first\n- second', 0, 16, 'unordered-list')).toEqual({
      nextValue: 'first\nsecond',
      selectionStart: 0,
      selectionEnd: 12,
    });
  });

  it('maps rendered selections only when the text is unambiguous', () => {
    expect(resolveMarkdownSelectionRangeFromRenderedText('hello **world**', 'world')).toEqual({
      start: 8,
      end: 13,
    });
    expect(resolveMarkdownSelectionRangeFromRenderedText('same same', 'same')).toBeNull();
  });

  it('shows the rendered toolbar only for valid selection mappings', () => {
    expect(getRenderedMarkdownSelectionToolbarState('hello **world**', 'world', { top: 50, left: 20, width: 40 })).toEqual({
      start: 8,
      end: 13,
      top: 14,
      left: 40,
    });
    expect(getRenderedMarkdownSelectionToolbarState('same same', 'same', { top: 50, left: 20, width: 40 })).toBeNull();
  });
});

describe('rendered markdown click behavior', () => {
  it('opens source mode for a plain rendered click by default', () => {
    const p = document.createElement('p');
    p.textContent = 'hi';
    document.body.appendChild(p);
    expect(getRenderedMarkdownClickBehavior({ target: p })).toBe('source');
    p.remove();
  });

  it('opens source mode for Command-click by default', () => {
    const p = document.createElement('p');
    p.textContent = 'hi';
    document.body.appendChild(p);
    expect(getRenderedMarkdownClickBehavior({ target: p, metaKey: true })).toBe('source');
    p.remove();
  });

  it('requires Command-click when Command-click mode is enabled', () => {
    const p = document.createElement('p');
    p.textContent = 'hi';
    document.body.appendChild(p);
    expect(getRenderedMarkdownClickBehavior({ target: p }, 'command-click')).toBeNull();
    expect(getRenderedMarkdownClickBehavior({ target: p, metaKey: true }, 'command-click')).toBe('source');
    p.remove();
  });

  it('leaves double-click selection to the browser instead of placing a rendered caret', () => {
    const p = document.createElement('p');
    p.textContent = 'hi';
    document.body.appendChild(p);
    expect(getRenderedMarkdownClickBehavior({ target: p, detail: 2 })).toBeNull();
    p.remove();
  });

  it('keeps the rendered toolbar hidden for ambiguous selected text', () => {
    expect(resolveMarkdownSelectionRangeFromRenderedText('repeat repeat', 'repeat')).toBeNull();
  });
});

describe('library drag data helpers', () => {
  it('writes a plain text fallback and reads it back', () => {
    const values = new Map<string, string>();
    const types: string[] = [];
    const dataTransfer = {
      types,
      setData(type: string, value: string) {
        if (!types.includes(type)) types.push(type);
        values.set(type, value);
      },
      getData(type: string) {
        return values.get(type) ?? '';
      },
      effectAllowed: 'none',
    } as unknown as DataTransfer;

    setLibraryDragData(dataTransfer, {
      rootPath: '/wiki',
      kind: 'file',
      relPath: 'scratchpad/today',
    });

    expect(hasLibraryDragData(dataTransfer)).toBe(true);
    expect(getLibraryDragData(dataTransfer)).toEqual({
      rootPath: '/wiki',
      kind: 'file',
      relPath: 'scratchpad/today',
    });
    expect(values.get('text/plain')).toContain('fieldtheory-library-item:');
  });

  it('keeps same-window drag data when dragover hides DataTransfer types', () => {
    const dragItem = {
      rootPath: '/wiki',
      kind: 'file' as const,
      relPath: 'entries/note',
    };
    const dataTransfer = {
      types: [] as string[],
      setData() {},
      getData() {
        return '';
      },
      effectAllowed: 'none',
    } as unknown as DataTransfer;

    setLibraryDragData(dataTransfer, dragItem);

    expect(hasLibraryDragData(dataTransfer)).toBe(true);
    expect(getLibraryDragData(dataTransfer)).toEqual(dragItem);

    clearLibraryDragData();

    expect(hasLibraryDragData(dataTransfer)).toBe(false);
    expect(getLibraryDragData(dataTransfer)).toBeNull();
  });

  it('does not treat arbitrary plain text as library drag data', () => {
    const dataTransfer = {
      types: ['text/plain'] as string[],
      setData() {},
      getData(type: string) {
        return type === 'text/plain' ? 'not a library drag' : '';
      },
      effectAllowed: 'none',
    } as unknown as DataTransfer;

    expect(hasLibraryDragData(dataTransfer)).toBe(false);
    expect(getLibraryDragData(dataTransfer)).toBeNull();
  });

  it('rejects invalid library drop targets before drop', () => {
    expect(canDropLibraryItem(
      { rootPath: '/wiki', kind: 'file', relPath: 'entries/note' },
      { rootPath: '/wiki', relPath: 'scratchpad', builtin: true },
    )).toBe(true);

    expect(canDropLibraryItem(
      { rootPath: '/wiki', kind: 'file', relPath: 'entries/note' },
      { rootPath: '/external', relPath: 'scratchpad', builtin: false },
    )).toBe(false);

    expect(canDropLibraryItem(
      { rootPath: '/wiki', kind: 'dir', relPath: 'entries' },
      { rootPath: '/wiki', relPath: 'entries/child', builtin: true },
    )).toBe(false);

    expect(canDropLibraryItem(
      { rootPath: '/wiki', kind: 'file', relPath: 'entries/note' },
      { rootPath: '/wiki', relPath: 'entries', builtin: true },
    )).toBe(false);
  });
});

describe('librarian editor session helpers', () => {
  it('round-trips markdown editor session state', () => {
    const storage = new Map<string, string>();
    const fakeStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    };

    persistLibrarianEditorSession(fakeStorage, {
      itemType: 'wiki',
      itemPath: 'entries/note',
      contentMode: 'markdown',
      selectionStart: 12,
      selectionEnd: 18,
      scrollTop: 220,
    });

    expect(restoreLibrarianEditorSession(fakeStorage)).toEqual({
      itemType: 'wiki',
      itemPath: 'entries/note',
      contentMode: 'markdown',
      selectionStart: 12,
      selectionEnd: 18,
      scrollTop: 220,
    });
  });

  it('matches restored editor session to the selected wiki page', () => {
    expect(editorSessionMatchesSelection(
      {
        itemType: 'wiki',
        itemPath: 'entries/note',
        contentMode: 'markdown',
        selectionStart: 0,
        selectionEnd: 0,
        scrollTop: 0,
      },
      { type: 'wiki', relPath: 'entries/note' },
    )).toBe(true);
  });
});

describe('librarian navigation history helpers', () => {
  it('pushes file navigation entries and ignores consecutive duplicates', () => {
    let history = pushLibrarianNavigationEntry({ entries: [], index: -1 }, { itemType: 'wiki', itemPath: 'entries/a' });
    history = pushLibrarianNavigationEntry(history, { itemType: 'wiki', itemPath: 'entries/a' });

    expect(history).toEqual({
      entries: [{ itemType: 'wiki', itemPath: 'entries/a' }],
      index: 0,
    });
  });

  it('clears forward history when a new file is opened after going back', () => {
    let history = pushLibrarianNavigationEntry({ entries: [], index: -1 }, { itemType: 'wiki', itemPath: 'entries/a' });
    history = pushLibrarianNavigationEntry(history, { itemType: 'artifact', itemPath: '/tmp/b.md' });
    const back = moveLibrarianNavigationHistory(history, -1);
    expect(back?.entry).toEqual({ itemType: 'wiki', itemPath: 'entries/a' });

    const next = pushLibrarianNavigationEntry(back!.history, { itemType: 'external', itemPath: '/tmp/c.md' });
    expect(next).toEqual({
      entries: [
        { itemType: 'wiki', itemPath: 'entries/a' },
        { itemType: 'external', itemPath: '/tmp/c.md' },
      ],
      index: 1,
    });
  });

  it('moves back and forward without changing the entry list', () => {
    let history = pushLibrarianNavigationEntry({ entries: [], index: -1 }, { itemType: 'wiki', itemPath: 'entries/a' });
    history = pushLibrarianNavigationEntry(history, { itemType: 'wiki', itemPath: 'entries/b' });

    const back = moveLibrarianNavigationHistory(history, -1);
    const forward = moveLibrarianNavigationHistory(back!.history, 1);

    expect(back?.entry).toEqual({ itemType: 'wiki', itemPath: 'entries/a' });
    expect(forward?.entry).toEqual({ itemType: 'wiki', itemPath: 'entries/b' });
    expect(forward?.history.entries).toBe(history.entries);
  });

  it('caps history to the requested limit', () => {
    let history = pushLibrarianNavigationEntry({ entries: [], index: -1 }, { itemType: 'wiki', itemPath: 'entries/a' }, 2);
    history = pushLibrarianNavigationEntry(history, { itemType: 'wiki', itemPath: 'entries/b' }, 2);
    history = pushLibrarianNavigationEntry(history, { itemType: 'wiki', itemPath: 'entries/c' }, 2);

    expect(history).toEqual({
      entries: [
        { itemType: 'wiki', itemPath: 'entries/b' },
        { itemType: 'wiki', itemPath: 'entries/c' },
      ],
      index: 1,
    });
  });

  it('replaces a renamed wiki entry without adding a new history item', () => {
    const history = {
      entries: [
        { itemType: 'wiki' as const, itemPath: 'entries/old-title' },
        { itemType: 'artifact' as const, itemPath: '/tmp/artifact.md' },
      ],
      index: 0,
    };

    expect(replaceLibrarianNavigationEntry(
      history,
      { itemType: 'wiki', itemPath: 'entries/old-title' },
      { itemType: 'wiki', itemPath: 'entries/new-title' },
    )).toEqual({
      entries: [
        { itemType: 'wiki', itemPath: 'entries/new-title' },
        { itemType: 'artifact', itemPath: '/tmp/artifact.md' },
      ],
      index: 0,
    });
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

describe('markdown editor edge fades', () => {
  it('hides both fades when the editor does not overflow', () => {
    expect(getMarkdownEditorEdgeFades(0, 400, 500)).toEqual({ top: false, bottom: false });
  });

  it('does not show the bottom fade at the top of overflowing content', () => {
    expect(getMarkdownEditorEdgeFades(0, 1000, 500)).toEqual({ top: false, bottom: false });
  });

  it('keeps only the top fade in the middle of overflowing content', () => {
    expect(getMarkdownEditorEdgeFades(250, 1000, 500)).toEqual({ top: true, bottom: false });
  });

  it('shows only the top fade at the bottom of overflowing content', () => {
    expect(getMarkdownEditorEdgeFades(500, 1000, 500)).toEqual({ top: true, bottom: false });
  });
});

describe('focus chrome proximity', () => {
  it('reveals controls when the cursor is near the top of the reader pane', () => {
    expect(shouldRevealFocusChrome(80, 20, 96)).toBe(true);
  });

  it('keeps controls faded when the cursor is away from the top controls', () => {
    expect(shouldRevealFocusChrome(140, 20, 96)).toBe(false);
  });

  it('does not reveal controls above the reader pane', () => {
    expect(shouldRevealFocusChrome(12, 20, 96)).toBe(false);
  });

  it('reveals the chrome group near either the top toolbar or footer', () => {
    expect(shouldRevealGroupedFocusChrome({
      cursorClientY: 42,
      paneClientTop: 0,
      viewportHeight: 800,
      revealDistancePx: 96,
    })).toBe(true);
    expect(shouldRevealGroupedFocusChrome({
      cursorClientY: 760,
      paneClientTop: 0,
      viewportHeight: 800,
      revealDistancePx: 96,
    })).toBe(true);
  });

  it('ramps grouped chrome opacity from the edge toward the middle', () => {
    const edge = getGroupedFocusChromeProximityOpacity({
      cursorClientY: 10,
      paneClientTop: 0,
      viewportHeight: 800,
      revealDistancePx: 128,
      fullOpacityDistancePx: 28,
    });
    const middle = getGroupedFocusChromeProximityOpacity({
      cursorClientY: 78,
      paneClientTop: 0,
      viewportHeight: 800,
      revealDistancePx: 128,
      fullOpacityDistancePx: 28,
    });
    const away = getGroupedFocusChromeProximityOpacity({
      cursorClientY: 200,
      paneClientTop: 0,
      viewportHeight: 800,
      revealDistancePx: 128,
      fullOpacityDistancePx: 28,
    });

    expect(edge).toBe(1);
    expect(middle).toBeGreaterThan(0);
    expect(middle).toBeLessThan(1);
    expect(away).toBe(0);
  });

  it('can treat the whole top chrome stack as the full-opacity zone', () => {
    expect(getGroupedFocusChromeProximityOpacity({
      cursorClientY: 96,
      paneClientTop: 0,
      viewportHeight: 800,
      revealDistancePx: 180,
      fullOpacityDistancePx: 128,
    })).toBe(1);
  });

  it('keeps the top nav on the same opacity ramp as the chrome group', () => {
    expect(getFocusChromeSurfaceOpacity({
      isFocusChromeSurface: true,
      focusChromeActive: true,
      groupOpacity: 0.42,
      childOpacity: 0.42,
    })).toBe(0.42);
  });

  it('uses pinned child chrome without making proximity fades snap to full opacity', () => {
    expect(getFocusChromeSurfaceOpacity({
      isFocusChromeSurface: true,
      focusChromeActive: true,
      groupOpacity: 0.25,
      childOpacity: 1,
    })).toBe(1);
  });

  it('fades the focus logo out as the chrome surface fades in', () => {
    expect(getFocusChromeHintOpacity({
      isFocusChromeSurface: true,
      focusChromeActive: true,
      surfaceOpacity: 0,
    })).toBe(0.62);
    expect(getFocusChromeHintOpacity({
      isFocusChromeSurface: true,
      focusChromeActive: true,
      surfaceOpacity: 1,
    })).toBe(0);
  });
});

describe('document focus chrome activation', () => {
  const focusedDocument = {
    canUseFocusImmersive: true,
    isFullScreen: false,
    sidebarCollapsed: true,
    focusImmersive: true,
    isFocusedWritingMode: false,
    writingChromeHidden: false,
  };

  it('requires the sidebar to be collapsed for explicit focus chrome', () => {
    expect(isLibrarianDocumentFocusChromeActive(focusedDocument)).toBe(true);
    expect(isLibrarianDocumentFocusChromeActive({ ...focusedDocument, sidebarCollapsed: false })).toBe(false);
  });

  it('restores focused writing chrome when the sidebar collapses again', () => {
    const focusedWriting = {
      ...focusedDocument,
      focusImmersive: false,
      isFocusedWritingMode: true,
      writingChromeHidden: true,
    };

    expect(isLibrarianDocumentFocusChromeActive({ ...focusedWriting, sidebarCollapsed: false })).toBe(false);
    expect(isLibrarianDocumentFocusChromeActive(focusedWriting)).toBe(true);
  });
});

describe('bookmarks canvas chrome activation', () => {
  it('only hides the shared footer when bookmarks canvas is fullscreen', () => {
    expect(isBookmarksCanvasChromeActive({
      active: true,
      selectedItemType: 'bookmarks',
      isFullScreen: true,
      bookmarksCanvasActive: true,
    })).toBe(true);

    expect(isBookmarksCanvasChromeActive({
      active: true,
      selectedItemType: 'bookmarks',
      isFullScreen: false,
      bookmarksCanvasActive: true,
    })).toBe(false);
  });
});

describe('librarian content top padding', () => {
  it('keeps rendered document content in place when focus chrome removes the toolbar row from layout', () => {
    const normalPadding = getLibrarianContentTopPadding({
      contentMode: 'rendered',
      focusChromeActive: false,
      isFullScreen: false,
    });
    const focusPadding = getLibrarianContentTopPadding({
      contentMode: 'rendered',
      focusChromeActive: true,
      isFullScreen: false,
    });

    expect(focusPadding - normalPadding).toBe(42);
  });

  it('keeps markdown document content in place when focus chrome removes the toolbar row from layout', () => {
    const normalPadding = getLibrarianContentTopPadding({
      contentMode: 'markdown',
      focusChromeActive: false,
      isFullScreen: false,
    });
    const focusPadding = getLibrarianContentTopPadding({
      contentMode: 'markdown',
      focusChromeActive: true,
      isFullScreen: false,
    });

    expect(focusPadding - normalPadding).toBe(42);
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

describe('deletedLibraryItemMatchesSelection', () => {
  it('matches the selected wiki page by id or relPath', () => {
    const item = {
      id: 'wiki:scratchpad/meeting-notes',
      type: 'wiki' as const,
      absPath: '/wiki/scratchpad/meeting-notes.md',
      relPath: 'scratchpad/meeting-notes',
    };

    expect(deletedLibraryItemMatchesSelection(item, {
      selectedItemId: 'wiki:scratchpad/meeting-notes',
      selectedItemType: 'wiki',
      wikiSelectedRelPath: null,
      selectedPath: null,
    })).toBe(true);
    expect(deletedLibraryItemMatchesSelection(item, {
      selectedItemId: null,
      selectedItemType: 'wiki',
      wikiSelectedRelPath: 'scratchpad/meeting-notes',
      selectedPath: null,
    })).toBe(true);
  });

  it('does not match an unrelated selected wiki page', () => {
    expect(deletedLibraryItemMatchesSelection({
      id: 'wiki:scratchpad/old',
      type: 'wiki',
      absPath: '/wiki/scratchpad/old.md',
      relPath: 'scratchpad/old',
    }, {
      selectedItemId: 'wiki:scratchpad/current',
      selectedItemType: 'wiki',
      wikiSelectedRelPath: 'scratchpad/current',
      selectedPath: null,
    })).toBe(false);
  });

  it('matches the selected artifact by path', () => {
    expect(deletedLibraryItemMatchesSelection({
      id: 'artifact:/tmp/report.md',
      type: 'artifact',
      absPath: '/tmp/report.md',
    }, {
      selectedItemId: null,
      selectedItemType: 'artifact',
      wikiSelectedRelPath: null,
      selectedPath: '/tmp/report.md',
    })).toBe(true);
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

describe('applyTodoStateOverrideToItem', () => {
  const item = {
    id: 'wiki:scratchpad/task',
    title: 'Task',
    type: 'wiki' as const,
    absPath: '/wiki/scratchpad/task.md',
    relPath: 'scratchpad/task',
    timestamp: 1,
    todoState: 'open' as const,
  };

  it('applies a realtime sidebar todo state override', () => {
    expect(applyTodoStateOverrideToItem(item, { [item.id]: 'done' }).todoState).toBe('done');
  });

  it('removes the sidebar todo state when the override is null', () => {
    expect(applyTodoStateOverrideToItem(item, { [item.id]: null }).todoState).toBeUndefined();
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
  const file = (title: string, timestamp: number): LibrarySidebarNode => ({
    kind: 'file',
    id: `wiki:${title}`,
    item: {
      id: `wiki:${title}`,
      title,
      type: 'wiki',
      absPath: `/wiki/${title}.md`,
      relPath: title,
      timestamp,
    },
  });
  const bookmarksAction = (): LibrarySidebarNode => ({
    kind: 'file',
    id: 'bookmarks:root',
    item: {
      id: 'bookmarks:root',
      title: 'View bookmarks',
      type: 'bookmarks',
      absPath: '',
      timestamp: 0,
    },
  });

  it('sorts date mode with newest file timestamps first', () => {
    const result = sortSidebarNodes([
      file('Old', 10),
      file('Newest', 30),
      file('Middle', 20),
    ], 'time');

    expect(result.map((node) => node.kind === 'file' ? node.item.title : node.label)).toEqual([
      'Newest',
      'Middle',
      'Old',
    ]);
  });

  it('keeps pinned files before unpinned files while preserving sort inside each group', () => {
    const result = sortSidebarNodes([
      file('Old', 10),
      file('Newest', 30),
      file('Middle', 20),
    ], 'time', new Set(['wiki:Middle']));

    expect(result.map((node) => node.kind === 'file' ? node.item.title : node.label)).toEqual([
      'Middle',
      'Newest',
      'Old',
    ]);
  });

  it('marks the first unpinned item after pinned sidebar items for a divider', () => {
    const pinned = new Set(['wiki:Middle']);
    const result = sortSidebarNodes([
      file('Old', 10),
      file('Newest', 30),
      file('Middle', 20),
    ], 'time', pinned);

    expect(result.map((node, index) => shouldShowPinnedSidebarDividerBefore(result, index, pinned))).toEqual([
      false,
      true,
      false,
    ]);
  });

  it('alphabetizes combined top-level sidebar nodes in alpha mode', () => {
    const artifactRoot: LibrarySidebarNode = {
      kind: 'dir',
      id: 'artifacts',
      name: 'artifacts',
      label: 'Artifacts',
      relPath: 'artifacts',
      rootPath: 'artifacts',
      builtin: false,
      canCreateFile: false,
      children: [],
    };
    const result = orderTopLevelSidebarNodes([
      dir('scratchpad'),
      dir('plans'),
      dir('debates'),
      dir('entries'),
      {
        kind: 'dir',
        id: 'root:/team',
        name: 'Team Markdown',
        label: 'Team Markdown',
        relPath: '',
        rootPath: '/team',
        builtin: false,
        canCreateFile: true,
        children: [],
      },
      artifactRoot,
    ], 'alpha');

    expect(result.map((node) => node.kind === 'dir' ? node.label : node.item.title)).toEqual([
      'Artifacts',
      'Debates',
      'Entries',
      'Plans',
      'Scratchpad',
      'Team Markdown',
    ]);
  });

  it('keeps combined top-level sidebar nodes alphabetical in date mode', () => {
    const result = orderTopLevelSidebarNodes([
      dir('scratchpad'),
      dir('plans'),
      dir('debates'),
      dir('entries'),
    ], 'time');

    expect(result.map((node) => node.kind === 'dir' ? node.label : node.item.title)).toEqual([
      'Debates',
      'Entries',
      'Plans',
      'Scratchpad',
    ]);
  });

  it('applies pinned ordering recursively to folders and docs', () => {
    const result = applyPinnedSidebarOrder([
      dir('entries', [
        file('Beta', 2),
        file('Alpha', 1),
      ]),
      dir('scratchpad'),
    ], 'alpha', new Set(['wiki:Beta', '/wiki::scratchpad']));

    expect(result.map((node) => node.kind === 'dir' ? node.label : node.item.title)).toEqual([
      'Scratchpad',
      'Entries',
    ]);
    const entries = result.find((node) => node.kind === 'dir' && node.name === 'entries');
    expect(entries?.kind === 'dir' ? entries.children.map((node) => node.kind === 'file' ? node.item.title : node.label) : []).toEqual([
      'Beta',
      'Alpha',
    ]);
  });

  it('keeps pinned descendants inside their directory without promoting the parent directory', () => {
    const pinned = new Set(['wiki:Artifact']);
    const result = applyPinnedSidebarOrder([
      dir('scratchpad'),
      dir('z-artifacts', [
        file('Artifact', 5),
        file('Other', 1),
      ]),
    ], 'alpha', pinned);

    expect(result.map((node) => node.kind === 'dir' ? node.label : node.item.title)).toEqual([
      'Scratchpad',
      'Z-artifacts',
    ]);
    const artifacts = result.find((node) => node.kind === 'dir' && node.name === 'z-artifacts');
    expect(artifacts?.kind === 'dir' ? artifacts.children.map((node) => node.kind === 'file' ? node.item.title : node.label) : []).toEqual([
      'Artifact',
      'Other',
    ]);
    expect(result.map((node, index) => shouldShowPinnedSidebarDividerBefore(result, index, pinned))).toEqual([
      false,
      false,
    ]);
    expect(artifacts?.kind === 'dir' ? artifacts.children.map((_node, index) => shouldShowPinnedSidebarDividerBefore(artifacts.children, index, pinned)) : []).toEqual([
      false,
      true,
    ]);
  });

  it('still promotes pinned directories above unpinned directories', () => {
    const pinned = new Set(['/wiki::z-artifacts']);
    const result = applyPinnedSidebarOrder([
      dir('scratchpad'),
      dir('z-artifacts', [
        file('Artifact', 5),
      ]),
    ], 'alpha', pinned);

    expect(result.map((node) => node.kind === 'dir' ? node.label : node.item.title)).toEqual([
      'Z-artifacts',
      'Scratchpad',
    ]);
    expect(result.map((node, index) => shouldShowPinnedSidebarDividerBefore(result, index, pinned))).toEqual([
      false,
      true,
    ]);
  });

  it('keeps pinned wiki docs and folders pinned after rename', () => {
    const pinned = new Set(['wiki:scratchpad/Old', '/wiki::scratchpad/Old Folder']);

    const result = renamePinnedSidebarIds(pinned, {
      rootPath: '/display/wiki',
      oldRelPath: 'scratchpad/Old',
      newRelPath: 'scratchpad/New',
      oldAbsPath: '/display/wiki/scratchpad/Old.md',
      newAbsPath: '/display/wiki/scratchpad/New.md',
      builtin: true,
    });
    const folderResult = renamePinnedSidebarIds(result, {
      rootPath: '/display/wiki',
      oldRelPath: 'scratchpad/Old Folder',
      newRelPath: 'scratchpad/New Folder',
      oldAbsPath: '/display/wiki/scratchpad/Old Folder',
      newAbsPath: '/display/wiki/scratchpad/New Folder',
      builtin: true,
    });

    expect([...folderResult]).toEqual([
      'wiki:scratchpad/New',
      '/wiki::scratchpad/New Folder',
    ]);
  });

  it('collects only the selected file siblings inside its directory', () => {
    const tree = [
      dir('entries', [
        file('One', 1),
        file('Two', 2),
        dir('nested', [
          file('Nested One', 3),
          file('Nested Two', 4),
        ]),
      ]),
      dir('scratchpad', [
        file('Scratch', 5),
      ]),
    ];

    expect(collectSidebarSiblingItems(tree, 'wiki:Nested One').map((item) => item.title)).toEqual([
      'Nested One',
      'Nested Two',
    ]);
  });

  it('replaces bookmark taxonomy folders with a single bookmarks action', () => {
    const nodes = [dir('entries'), dir('domains'), dir('categories')];
    const result = virtualizeBookmarksGroup(nodes, root);
    expect(result.map((node) => node.kind === 'dir' ? node.name : node.id)).toEqual([
      'entries',
      'bookmarks:root',
    ]);
    expect(result.some((node) => node.kind === 'dir' && node.label === 'Bookmarks from x.com')).toBe(false);
    const bookmarksNode = result.find((node) => node.id === 'bookmarks:root');
    expect(bookmarksNode?.kind).toBe('file');
    if (bookmarksNode?.kind !== 'file') return;
    expect(bookmarksNode.item).toMatchObject({ title: 'View bookmarks', type: 'bookmarks' });
    expect(result.some((node) => node.kind === 'dir' && node.name === 'categories')).toBe(false);
  });

  it('renders the raw bookmarks-from-x folder as the bookmarks action', () => {
    const nodes = [dir('entries'), dir('bookmarks-from-x'), dir('domains')];
    const result = virtualizeBookmarksGroup(nodes, root);
    expect(result.map((node) => node.kind === 'dir' ? node.name : node.id)).toEqual([
      'entries',
      'bookmarks:root',
    ]);
    expect(result.some((node) => node.kind === 'dir' && node.name === 'bookmarks-from-x')).toBe(false);
  });

  it('renders a real bookmarks data folder as the bookmarks action', () => {
    const nodes = [dir('entries'), dir('bookmarks', [file('Saved bookmark', 1)])];
    const result = virtualizeBookmarksGroup(nodes, root);
    expect(result.map((node) => node.kind === 'dir' ? node.name : node.id)).toEqual([
      'entries',
      'bookmarks:root',
    ]);
    expect(result.some((node) => node.kind === 'dir' && node.name === 'bookmarks')).toBe(false);
  });

  it('leaves the tree reference alone when no bookmark folders exist', () => {
    const nodes = [dir('entries')];
    expect(virtualizeBookmarksGroup(nodes, root)).toBe(nodes);
  });

  it('filters hidden Library folders without touching external roots', () => {
    const artifactRoot: LibrarySidebarNode = {
      kind: 'dir',
      id: 'artifacts',
      name: 'artifacts',
      label: 'Artifacts',
      relPath: 'artifacts',
      rootPath: 'artifacts',
      builtin: false,
      canCreateFile: false,
      finderPath: '/Users/afar/.fieldtheory/librarian/artifacts',
      children: [file('Artifact One', 1)],
    };
    const builtinRoot: LibrarySidebarNode = {
      kind: 'dir',
      id: 'root:/wiki',
      name: 'Wiki',
      label: 'Wiki',
      relPath: '',
      rootPath: '/wiki',
      builtin: true,
      canCreateFile: true,
      children: [
        dir('scratchpad'),
        dir('Shared Markdown'),
        dir('bookmarks-from-x', [dir('categories')]),
        dir('entries'),
        dir('Client Notes'),
        dir('custom'),
      ],
    };
    const externalEntries: LibrarySidebarNode = {
      kind: 'dir',
      id: 'root:/external',
      name: 'entries',
      label: 'Entries',
      relPath: '',
      rootPath: '/external',
      builtin: false,
      canCreateFile: true,
      children: [],
    };

    const result = filterHiddenDefaultSidebarNodes(
      [artifactRoot, builtinRoot, externalEntries],
      ['artifacts', 'scratchpad', 'Shared Markdown', 'bookmarks-from-x', 'entries', 'Client Notes']
    );

    expect(result.map((node) => node.kind === 'dir' ? node.id : node.id)).toEqual([
      'artifacts',
      'root:/wiki',
      'root:/external',
    ]);
    const filteredBuiltin = result[1];
    expect(filteredBuiltin.kind).toBe('dir');
    if (filteredBuiltin.kind !== 'dir') return;
    expect(filteredBuiltin.children.map((node) => node.kind === 'dir' ? node.name : node.id)).toEqual(['custom']);
    expect(result[2]).toMatchObject({ rootPath: '/external', name: 'entries' });
  });

  it('keeps sidebar node references stable when no defaults are hidden', () => {
    const nodes = [dir('entries')];
    expect(filterHiddenDefaultSidebarNodes(nodes, [])).toBe(nodes);
  });

  it('hides the seeded Library artifacts folder when it only contains its README', () => {
    const artifactReadme: LibrarySidebarNode = {
      kind: 'file',
      id: 'wiki:artifacts/README',
      item: {
        id: 'wiki:artifacts/README',
        title: 'README: Artifacts',
        type: 'wiki',
        absPath: '/wiki/artifacts/README.md',
        relPath: 'artifacts/README',
        rootPath: '/wiki',
        timestamp: 1,
      },
    };
    const artifactFolder: LibrarySidebarNode = {
      kind: 'dir',
      id: '/wiki::artifacts',
      name: 'artifacts',
      label: 'Artifacts',
      relPath: 'artifacts',
      rootPath: '/wiki',
      builtin: true,
      canCreateFile: false,
      children: [artifactReadme],
    };
    const entries = dir('entries');

    expect(hideReadmeOnlyLibraryArtifactsFolder([artifactFolder, entries])).toEqual([entries]);
  });

  it('keeps Library artifacts visible when it contains user content', () => {
    const userDoc: LibrarySidebarNode = {
      kind: 'file',
      id: 'wiki:artifacts/notes',
      item: {
        id: 'wiki:artifacts/notes',
        title: 'notes',
        type: 'wiki',
        absPath: '/wiki/artifacts/notes.md',
        relPath: 'artifacts/notes',
        rootPath: '/wiki',
        timestamp: 1,
      },
    };
    const artifactFolder: LibrarySidebarNode = {
      kind: 'dir',
      id: '/wiki::artifacts',
      name: 'artifacts',
      label: 'Artifacts',
      relPath: 'artifacts',
      rootPath: '/wiki',
      builtin: true,
      canCreateFile: false,
      children: [userDoc],
    };

    expect(hideReadmeOnlyLibraryArtifactsFolder([artifactFolder])).toEqual([artifactFolder]);
  });

  it('hides the legacy builtin concepts folder without touching external concepts roots', () => {
    const builtinConcepts = dir('concepts');
    const externalConcepts: LibrarySidebarNode = {
      kind: 'dir',
      id: 'root:/external-concepts',
      name: 'concepts',
      label: 'Concepts',
      relPath: '',
      rootPath: '/external-concepts',
      builtin: false,
      canCreateFile: true,
      children: [file('Concept note', 1)],
    };

    const result = filterHiddenDefaultSidebarNodes([builtinConcepts, externalConcepts], []);

    expect(result).toEqual([externalConcepts]);
  });

  it('promotes the builtin wiki children without flattening external roots', () => {
    const builtinRoot: LibrarySidebarNode = {
      kind: 'dir',
      id: 'root:/wiki',
      name: 'Wiki',
      label: 'Wiki',
      relPath: '',
      rootPath: '/wiki',
      builtin: true,
      canCreateFile: true,
      children: [dir('scratchpad'), dir('entries')],
    };
    const externalRoot: LibrarySidebarNode = {
      kind: 'dir',
      id: 'root:/external',
      name: 'external',
      label: 'external',
      relPath: '',
      rootPath: '/external',
      builtin: false,
      canCreateFile: true,
      children: [dir('notes')],
    };

    const result = flattenBuiltinSidebarRoots([builtinRoot, externalRoot]);

    expect(result.map((node) => node.kind === 'dir' ? node.id : node.id)).toEqual([
      '/wiki::scratchpad',
      '/wiki::entries',
      'root:/external',
    ]);
    expect(result).not.toContain(builtinRoot);
    expect(result).toContain(externalRoot);
  });

  it('promotes the bookmarks action out of a wrapper root', () => {
    const bookmarkRoot: LibrarySidebarNode = {
      kind: 'dir',
      id: 'root:/bookmarks',
      name: 'Bookmarks',
      label: 'Bookmarks',
      relPath: '',
      rootPath: '/bookmarks',
      builtin: false,
      canCreateFile: false,
      children: [
        bookmarksAction(),
      ],
    };

    expect(flattenBuiltinSidebarRoots([bookmarkRoot]).map((node) => node.id)).toEqual(['bookmarks:root']);
  });

  it('resolves Finder paths for real folders and keeps virtual bookmarks honest', () => {
    expect(getSidebarFolderFinderPath(dir('entries'))).toBe('/wiki/entries');
    expect(getSidebarFolderFinderPath({
      kind: 'dir',
      id: '/wiki::bookmarks-from-x',
      name: 'bookmarks-from-x',
      label: 'Bookmarks from x.com',
      relPath: 'bookmarks-from-x',
      rootPath: '/wiki',
      builtin: true,
      canCreateFile: false,
      children: [],
    })).toBe('/wiki');
    expect(getSidebarFolderFinderPath({
      kind: 'dir',
      id: 'artifacts',
      name: 'artifacts',
      label: 'Artifacts',
      relPath: 'artifacts',
      rootPath: 'artifacts',
      builtin: false,
      canCreateFile: false,
      finderPath: '/Users/afar/.fieldtheory/librarian/artifacts',
      children: [],
    })).toBe('/Users/afar/.fieldtheory/librarian/artifacts');
  });

  it('prefers the global artifacts folder for the virtual artifacts Finder path', () => {
    expect(getPrimaryArtifactsFinderPath([
      { path: '/Users/afar/.fieldtheory/users/user/librarian/artifacts/old.md' },
      { path: '/Users/afar/.fieldtheory/librarian/artifacts/new.md' },
    ])).toBe('/Users/afar/.fieldtheory/librarian/artifacts');
  });

  it('leaves an existing scratchpad directory in normal folder order', () => {
    const entries = dir('entries');
    const scratchpad = dir('scratchpad');
    const result = ensureScratchpadNodePresent([entries, scratchpad], root);
    expect(result[0]).toBe(entries);
    expect(result[1]).toBe(scratchpad);
  });

  it('expands scratchpad ancestors for a newly selected wiki file', () => {
    expect(getWikiSidebarExpansionIds('/wiki', 'scratchpad/meetings/team-notes')).toEqual([
      'root:/wiki',
      '/wiki::scratchpad',
      '/wiki::scratchpad/meetings',
    ]);
  });

  it('keys selected wiki auto-expansion by root and selected item', () => {
    const key = getSelectedWikiAutoExpandKey('wiki:scratchpad/team-notes', '/wiki');

    expect(key).toBe('/wiki::wiki:scratchpad/team-notes');
    expect(getSelectedWikiAutoExpandKey('wiki:scratchpad/team-notes', '/wiki')).toBe(key);
    expect(getSelectedWikiAutoExpandKey('wiki:scratchpad/other-note', '/wiki')).not.toBe(key);
    expect(getSelectedWikiAutoExpandKey('artifact:/tmp/team-notes.md', '/wiki')).toBeNull();
    expect(getSelectedWikiAutoExpandKey('wiki:scratchpad/team-notes', null)).toBeNull();
  });

  it('caps scratchpad until the user explicitly expands it', () => {
    const scratchpadChildren = Array.from({ length: 21 }, (_, index) => file(`scratchpad/note-${index}`, index));
    const scratchpad = dir('scratchpad', scratchpadChildren);

    expect(shouldCapScratchpadSidebarNode(scratchpad, false, false)).toBe(true);
    expect(shouldCapScratchpadSidebarNode(scratchpad, false, true)).toBe(false);
    expect(shouldCapScratchpadSidebarNode(scratchpad, true, false)).toBe(false);
    expect(shouldCapScratchpadSidebarNode(dir('entries', scratchpadChildren), false, false)).toBe(false);
  });

  it('patches builtin wiki roots by relPath even when root paths differ', () => {
    const roots: LibraryRoot[] = [{
      path: '/canonical/wiki',
      label: 'Wiki',
      builtin: true,
      tree: [{
        kind: 'dir',
        name: 'scratchpad',
        relPath: 'scratchpad',
        children: [{
          kind: 'file',
          relPath: 'scratchpad/old-title',
          absPath: '/canonical/wiki/scratchpad/old-title.md',
          name: 'old-title',
          title: 'old-title',
          lastUpdated: 1,
        }],
      }],
    }];

    const result = renameLibraryRootRelPath(roots, {
      rootPath: '/display/wiki',
      oldRelPath: 'scratchpad/old-title',
      newRelPath: 'scratchpad/new-title',
      oldAbsPath: '/display/wiki/scratchpad/old-title.md',
      newAbsPath: '/display/wiki/scratchpad/new-title.md',
      builtin: true,
    });

    expect(result).not.toBe(roots);
    const scratchpad = result[0].tree[0];
    expect(scratchpad.kind).toBe('dir');
    if (scratchpad.kind !== 'dir') return;
    const renamed = scratchpad.children[0];
    expect(renamed.kind).toBe('file');
    if (renamed.kind !== 'file') return;
    expect(renamed.relPath).toBe('scratchpad/new-title');
  });

  it('adds a locally-created wiki page to the builtin root immediately', () => {
    const roots: LibraryRoot[] = [{
      path: '/wiki',
      label: 'Wiki',
      builtin: true,
      tree: [{
        kind: 'dir',
        name: 'scratchpad',
        relPath: 'scratchpad',
        children: [],
      }],
    }];

    const result = addWikiPageToLibraryRoots(roots, {
      relPath: 'scratchpad/new-page',
      absPath: '/wiki/scratchpad/new-page.md',
      name: 'new-page',
      title: 'new-page',
      lastUpdated: 1,
    });

    expect(result).not.toBe(roots);
    const scratchpad = result[0].tree[0];
    expect(scratchpad.kind).toBe('dir');
    if (scratchpad.kind !== 'dir') return;
    expect(scratchpad.children).toHaveLength(1);
    const page = scratchpad.children[0];
    expect(page.kind).toBe('file');
    if (page.kind !== 'file') return;
    expect(page.relPath).toBe('scratchpad/new-page');
  });

  it('adds a locally-created wiki page outside scratchpad immediately', () => {
    const roots: LibraryRoot[] = [{
      path: '/wiki',
      label: 'Wiki',
      builtin: true,
      tree: [{
        kind: 'dir',
        name: 'entries',
        relPath: 'entries',
        children: [],
      }],
    }];

    const result = addWikiPageToLibraryRoots(roots, {
      relPath: 'entries/new-page',
      absPath: '/wiki/entries/new-page.md',
      name: 'new-page',
      title: 'new-page',
      lastUpdated: 1,
    });

    const entries = result[0].tree[0];
    expect(entries.kind).toBe('dir');
    if (entries.kind !== 'dir') return;
    expect(entries.children).toHaveLength(1);
    const page = entries.children[0];
    expect(page.kind).toBe('file');
    if (page.kind !== 'file') return;
    expect(page.relPath).toBe('entries/new-page');
  });

  it('adds a locally-created file to the matching external library root immediately', () => {
    const roots: LibraryRoot[] = [
      {
        path: '/wiki',
        label: 'Wiki',
        builtin: true,
        tree: [],
      },
      {
        path: '/notes',
        label: 'Notes',
        builtin: false,
        tree: [],
      },
    ];

    const result = addPageToLibraryRoot(roots, '/notes', {
      relPath: 'projects/new-page',
      absPath: '/notes/projects/new-page.md',
      name: 'new-page',
      title: 'new-page',
      lastUpdated: 1,
    });

    expect(result[0]).toBe(roots[0]);
    expect(result[1]).not.toBe(roots[1]);
    const projects = result[1].tree[0];
    expect(projects.kind).toBe('dir');
    if (projects.kind !== 'dir') return;
    const page = projects.children[0];
    expect(page.kind).toBe('file');
    if (page.kind !== 'file') return;
    expect(page.relPath).toBe('projects/new-page');
  });

  it('adds a locally-created wiki page to the legacy wiki tree immediately', () => {
    const result = addWikiPageToTree([], {
      relPath: 'scratchpad/new-page',
      absPath: '/wiki/scratchpad/new-page.md',
      name: 'new-page',
      title: 'new-page',
      lastUpdated: 1,
    });

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('scratchpad');
    expect(result[0].files.map((page) => page.relPath)).toEqual(['scratchpad/new-page']);
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

  it('keeps one recent list in input order', () => {
    const entries = [make('wiki', 'a'), make('external', 'x'), make('wiki', 'b')];
    const out = splitRecent(entries, false);
    expect(out.entries.map((e) => e.path)).toEqual(['a', 'x', 'b']);
    expect(out.total).toBe(3);
  });

  it('caps the combined list when collapsed and shows every remaining item when expanded', () => {
    const entries = Array.from({ length: 14 }, (_, i) => make(i % 2 === 0 ? 'wiki' : 'external', `r${i}`));
    const collapsed = splitRecent(entries, false);
    expect(collapsed.entries).toHaveLength(6);
    expect(collapsed.total).toBe(14);

    const expanded = splitRecent(entries, true);
    expect(expanded.entries).toHaveLength(14);
    expect(expanded.entries.map((e) => e.path).at(-1)).toBe('r13');
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

describe('deleted wiki page sidebar pruning', () => {
  it('removes a deleted relPath from the flat wiki tree', () => {
    const tree = [
      {
        name: 'scratchpad',
        files: [
          { relPath: 'scratchpad/a', absPath: '/wiki/scratchpad/a.md', name: 'a', title: 'A', lastUpdated: 1 },
          { relPath: 'scratchpad/b', absPath: '/wiki/scratchpad/b.md', name: 'b', title: 'B', lastUpdated: 2 },
        ],
      },
    ];

    const out = removeWikiRelPathFromTree(tree, 'scratchpad/a');

    expect(out[0].files.map((page) => page.relPath)).toEqual(['scratchpad/b']);
    expect(wikiTreeHasRelPath(out, 'scratchpad/a')).toBe(false);
    expect(wikiTreeHasRelPath(out, 'scratchpad/b')).toBe(true);
  });

  it('removes descendants when a wiki folder relPath is deleted', () => {
    const tree = [
      {
        name: 'scratchpad',
        files: [
          { relPath: 'scratchpad/project/a', absPath: '/wiki/scratchpad/project/a.md', name: 'a', title: 'A', lastUpdated: 1 },
          { relPath: 'scratchpad/project/nested/b', absPath: '/wiki/scratchpad/project/nested/b.md', name: 'b', title: 'B', lastUpdated: 2 },
          { relPath: 'scratchpad/projectile', absPath: '/wiki/scratchpad/projectile.md', name: 'projectile', title: 'Projectile', lastUpdated: 3 },
        ],
      },
    ];

    const out = removeWikiRelPathFromTree(tree, 'scratchpad/project');

    expect(out[0].files.map((page) => page.relPath)).toEqual(['scratchpad/projectile']);
  });

  it('prunes only builtin library roots for a wiki relPath', () => {
    const roots: LibraryRoot[] = [
      {
        path: '/wiki',
        label: 'Library',
        builtin: true,
        tree: [
          {
            kind: 'dir',
            name: 'scratchpad',
            relPath: 'scratchpad',
            children: [
              { kind: 'file', relPath: 'scratchpad/a', absPath: '/wiki/scratchpad/a.md', name: 'a', title: 'A', lastUpdated: 1 },
            ],
          },
        ],
      },
      {
        path: '/external',
        label: 'External',
        builtin: false,
        tree: [
          { kind: 'file', relPath: 'scratchpad/a', absPath: '/external/scratchpad/a.md', name: 'a', title: 'A', lastUpdated: 1 },
        ],
      },
    ];

    const out = removeWikiRelPathFromLibraryRoots(roots, 'scratchpad/a');

    expect(libraryRootsHaveBuiltinRelPath(out, 'scratchpad/a')).toBe(false);
    expect((out[0].tree[0] as Extract<WikiNode, { kind: 'dir' }>).children).toEqual([]);
    expect(out[1].tree).toEqual(roots[1].tree);
  });

  it('removes a deleted folder node from builtin library roots', () => {
    const roots: LibraryRoot[] = [
      {
        path: '/wiki',
        label: 'Library',
        builtin: true,
        tree: [
          {
            kind: 'dir',
            name: 'scratchpad',
            relPath: 'scratchpad',
            children: [
              {
                kind: 'dir',
                name: 'project',
                relPath: 'scratchpad/project',
                children: [
                  { kind: 'file', relPath: 'scratchpad/project/a', absPath: '/wiki/scratchpad/project/a.md', name: 'a', title: 'A', lastUpdated: 1 },
                ],
              },
              { kind: 'file', relPath: 'scratchpad/projectile', absPath: '/wiki/scratchpad/projectile.md', name: 'projectile', title: 'Projectile', lastUpdated: 2 },
            ],
          },
        ],
      },
    ];

    const out = removeWikiRelPathFromLibraryRoots(roots, 'scratchpad/project');
    const scratchpad = out[0].tree[0] as Extract<WikiNode, { kind: 'dir' }>;

    expect(scratchpad.children).toEqual([
      { kind: 'file', relPath: 'scratchpad/projectile', absPath: '/wiki/scratchpad/projectile.md', name: 'projectile', title: 'Projectile', lastUpdated: 2 },
    ]);
  });
});

describe('formatBreadcrumb', () => {
  const reading = { path: '/Users/me/notes/journal.md', title: 'My Journal' };

  it('returns an empty string when no reading is provided', () => {
    expect(formatBreadcrumb('wiki', null)).toBe('');
    expect(formatBreadcrumb('external', null)).toBe('');
  });

  it('wiki: returns the parent folder path from the relPath', () => {
    expect(formatBreadcrumb('wiki', reading, 'entries/release-notes/my-journal')).toBe('entries / release-notes');
  });

  it('wiki: falls back to Library for top-level files', () => {
    expect(formatBreadcrumb('wiki', reading, 'my-journal')).toBe('Library');
  });

  it('external: returns the parent directory from the absolute path', () => {
    expect(formatBreadcrumb('external', reading)).toBe('notes');
  });

  it('external: falls back to External when the path is just a filename', () => {
    expect(formatBreadcrumb('external', { path: 'loose.md', title: 'Loose' })).toBe('External');
  });
});
