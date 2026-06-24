import { afterEach, describe, expect, it } from 'vitest';
import {
  cycleMarkdownTodoState,
  deletedLibraryItemMatchesSelection,
  documentVersionsEqual,
  editorSessionMatchesSelection,
  findNextMarkdownMatch,
  getCarrotListEnterEdit,
  getCarrotListTabEdit,
  getMarkdownListEnterEdit,
  getMarkdownBodySelectionRange,
  getMarkdownListIndentEdit,
  getMarkdownListToggleEdit,
  getMarkdownWordDeleteBackwardPreservingListMarkerEdit,
  getSingleCharacterRenderedListBodyDeleteEdit,
  getRenderedMarkdownNodeStartLine,
  getRenderedMarkdownDeleteShortcutEdit,
  getRenderedMarkdownEnterEdit,
  getRenderedMarkdownPasteTextEdit,
  getRenderedDisplayReadingContent,
  buildSourceLineMapping,
  getRenderedMarkdownShortcutEdit,
  getRenderedTaskListItemChecked,
  getRenderedMarkdownSelectionToolbarState,
  getRenderedMarkdownSelectionFormatEdit,
  shouldLetRenderedCodeMirrorHandleLineBoundaryDelete,
  getFocusChromeScopedItemOpacity,
  getFocusChromeSurfaceOpacity,
  getMarkdownWikiLinkCompletionState,
  getNewlyCheckedMarkdownTasks,
  getReadingUpdatedByline,
  getReadingUpdatedTitle,
  getLibrarianBracketNavigationDirection,
  getLibrarianContentBottomScrollSpace,
  getLibrarianContentTopPadding,
  highlightFileFindMatches,
  formatBreadcrumb,
  getMarkdownEditorEdgeFades,
  getGroupedFocusChromeProximityOpacity,
  getLibrarianTitleFontSize,
  getMarkdownTaskLines,
  getMarkdownRenderedBodyStartLineIndex,
  getMarkdownImageReferenceSnapshot,
  markdownContentMayNeedPortableImages,
  markdownPortableImagesChanged,
  getRenderedCaretEnsureSourceOffset,
  getRenderedMarkdownDisplayContent,
  getVerifiedMarkdownSelectionReplacement,
  isTerminalEditorFocusToggleShortcut,
  isTerminalPanelVisibilityToggleShortcut,
  shouldRestoreEditorWhenTogglingTerminalFocus,
  getRenderedTaskLinesByRenderedLine,
  getScrollRatio,
  getScrollTopForRatio,
  isCodexTerminalEventTarget,
  isPasteSelectionToTerminalShortcut,
  getTerminalPastePopoverPosition,
  getNativeTerminalPastePopoverPosition,
  getTerminalImagePastePath,
  getTerminalPasteTextFromSelection,
  isBookmarksCanvasChromeActive,
  isLibrarianDocumentFocusChromeActive,
  isLibrarianSidebarHidden,
  isRenderedTaskListItem,
  moveLibrarianNavigationHistory,
  normalizeMarkdownCarrotLists,
  normalizeMarkdownTodoLines,
  persistLibrarianTodoMarker,
  persistLibrarianUnorderedListMarker,
  persistLibrarianEditorSession,
  persistNativeLibrarianSelection,
  persistLibrarianSelection,
  preserveMarkdownBlankLines,
  pushLibrarianNavigationEntry,
  rankMarkdownWikiLinkSuggestions,
  rebaseMarkdownTodoStateChange,
  removeEmptyMarkdownCommentPlaceholders,
  replaceLibrarianNavigationEntry,
  resolveMarkdownSelectionRangeFromRenderedText,
  restoreLibrarianEditorSession,
  restoreLibrarianTodoMarker,
  restoreLibrarianUnorderedListMarker,
  resolveLibrarianInitialSelection,
  resolveWikiCreateFolder,
  restoreLibrarianSelection,
  shouldRevealFocusChrome,
  shouldRevealGroupedFocusChrome,
  shouldShowFocusToolbarControls,
  shouldHandleMarkdownTodoTabShortcut,
  shouldRestoreEditorWhenTogglingTerminalPanel,
  shouldSuppressRenderedMarkdownBoundaryDelete,
  shouldOpenMarkdownEditorLinkFromMouseDown,
  shouldOpenMarkdownLinkFromMouseDown,
  isRenderedMarkdownLinkEventTarget,
  shouldInsertClipboardImagePathForPaste,
  isTextEntryInputType,
  splitFrontmatter,
  setMarkdownTodoState,
  shouldApplyLiveMarkdownFileUpdate,
  toggleMarkdownTaskLine,
  toggleMarkdownTaskLineAtIndex,
} from '../components/LibrarianView';
import {
  addPageToLibraryRoot,
  addWikiPageToLibraryRoots,
  addWikiPageToTree,
  annotateRiverSharedItems,
  applyPinnedSidebarOrder,
  applyTodoStateOverrideToItem,
  collectRiverSharedSourceCallsigns,
  ensureScratchpadNodePresent,
  ensureScratchpadPinned,
  filterHiddenDefaultSidebarNodes,
  flattenBuiltinSidebarRoots,
  collectSidebarSiblingItems,
  clearLibraryDragData,
  canDropLibraryItem,
  EMBER_ITEM_ID,
  filterStaleRecent,
  filterUnifiedFolders,
  getLibraryDragData,
  getLibrarySidebarIconColor,
  getBuiltinLibraryDocumentType,
  getRecentEntrySidebarId,
  getRecentEntryParentLabel,
  getRecentEntryParentPath,
  getRecentRowMoveKeyframes,
  getSidebarIconColorDragTargetIndex,
  getPrimaryArtifactsFinderPath,
  getSidebarDividerStyle,
  getSidebarFolderFinderPath,
  getSidebarFolderHeaderPositionStyle,
  isSidebarFolderHeaderPinned,
  getWikiSidebarExpansionIds,
  hasLibraryDragData,
  hideReadmeOnlyLibraryArtifactsFolder,
  libraryRootsHaveBuiltinRelPath,
  normalizeLibrarySidebarIconColorOrder,
  normalizeRiverSharedSourcePath,
  orderTopLevelSidebarNodes,
  reorderLibrarySidebarIconColorOrder,
  removeWikiRelPathFromLibraryRoots,
  removeWikiRelPathFromTree,
  renamePinnedSidebarIds,
  renameLibraryRootRelPath,
  shouldShowSidebarPinnedFolderFade,
  shouldShowSidebarTodoStateBadge,
  splitArchivedSidebarNodes,
  splitPinnedRecentEntries,
  splitRiverShortcutNode,
  splitRecent,
  sortSidebarNodes,
  setLibraryDragData,
  toggleSidebarPinnedItemIds,
  virtualizeBookmarksGroup,
  wikiTreeHasRelPath,
  type LibrarySidebarNode,
} from '../components/WikiSidebar';
import {
  parseMarkdownContentEditedAt,
  stampMarkdownContentEditIfBodyChanged,
} from '../../electron/shared/markdownFrontmatter';

const REAL_DATE_NOW = Date.now;

afterEach(() => {
  Date.now = REAL_DATE_NOW;
  clearLibraryDragData();
  window.getSelection()?.removeAllRanges();
});

function mkKey(overrides: Partial<KeyboardEvent>): KeyboardEvent {
  return new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...overrides });
}

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

describe('getBuiltinLibraryDocumentType', () => {
  it('opens Commands markdown as Library documents instead of wiki pages', () => {
    expect(getBuiltinLibraryDocumentType({
      builtin: true,
      relPath: 'Commands/workflow',
      documentKind: 'markdown',
    })).toBe('external');
    expect(getBuiltinLibraryDocumentType({
      builtin: true,
      relPath: 'entries/note',
      documentKind: 'markdown',
    })).toBe('wiki');
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

  it('stamps content edit time only when markdown body changes', () => {
    const previous = '---\ntodo: true\n---\n# Task\n';
    const frontmatterOnly = '---\ntodo: false\n---\n# Task\n';
    const bodyEdit = '---\ntodo: true\n---\n# Task\n\nBody\n';

    expect(stampMarkdownContentEditIfBodyChanged(previous, frontmatterOnly, 1234)).toBe(frontmatterOnly);
    const stamped = stampMarkdownContentEditIfBodyChanged(previous, bodyEdit, 1234);
    expect(parseMarkdownContentEditedAt(stamped)).toBe(1234);
    expect(splitFrontmatter(stamped).body).toBe('# Task\n\nBody\n');
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
  it('uses Option+Tab and Shift+Option+Tab for wiki and external markdown files', () => {
    expect(shouldHandleMarkdownTodoTabShortcut({
      key: 'Tab',
      shiftKey: false,
      metaKey: false,
      ctrlKey: false,
      altKey: true,
      selectedItemType: 'wiki',
    })).toBe(true);
    expect(shouldHandleMarkdownTodoTabShortcut({
      key: 'Tab',
      shiftKey: false,
      metaKey: false,
      ctrlKey: false,
      altKey: true,
      selectedItemType: 'external',
    })).toBe(true);
    expect(shouldHandleMarkdownTodoTabShortcut({
      key: 'Tab',
      shiftKey: true,
      metaKey: false,
      ctrlKey: false,
      altKey: true,
      selectedItemType: 'wiki',
    })).toBe(true);
  });

  it('ignores plain Tab, command-modified Option+Tab, and non-markdown selections', () => {
    expect(shouldHandleMarkdownTodoTabShortcut({
      key: 'Tab',
      shiftKey: false,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      selectedItemType: 'wiki',
    })).toBe(false);
    expect(shouldHandleMarkdownTodoTabShortcut({
      key: 'Tab',
      shiftKey: true,
      metaKey: true,
      ctrlKey: false,
      altKey: true,
      selectedItemType: 'wiki',
    })).toBe(false);
    expect(shouldHandleMarkdownTodoTabShortcut({
      key: 'Tab',
      shiftKey: false,
      metaKey: false,
      ctrlKey: false,
      altKey: true,
      selectedItemType: 'artifact',
    })).toBe(false);
  });
});

describe('shouldOpenMarkdownLinkFromMouseDown', () => {
  it('opens rendered links on an ordinary primary click before editing starts', () => {
    expect(shouldOpenMarkdownLinkFromMouseDown({
      button: 0,
      metaKey: false,
      altKey: false,
      ctrlKey: false,
    })).toBe(true);
  });

  it('opens rendered wiki links on ordinary primary click while editing is active', () => {
    expect(shouldOpenMarkdownLinkFromMouseDown({
      button: 0,
      metaKey: false,
      altKey: false,
      ctrlKey: false,
      renderedEditingActive: true,
      actionKind: 'wiki',
    })).toBe(true);
    expect(shouldOpenMarkdownLinkFromMouseDown({
      button: 0,
      metaKey: false,
      altKey: false,
      ctrlKey: false,
      renderedEditingActive: true,
      actionKind: 'create',
    })).toBe(true);
  });

  it('requires Command-click for non-wiki rendered links while editing is active', () => {
    expect(shouldOpenMarkdownLinkFromMouseDown({
      button: 0,
      metaKey: false,
      altKey: false,
      ctrlKey: false,
      renderedEditingActive: true,
      actionKind: 'external',
    })).toBe(false);
    expect(shouldOpenMarkdownLinkFromMouseDown({
      button: 0,
      metaKey: true,
      altKey: false,
      ctrlKey: false,
      renderedEditingActive: true,
      actionKind: 'external',
    })).toBe(true);
  });

  it('keeps modified and non-primary clicks available for browser/editor behavior', () => {
    expect(shouldOpenMarkdownLinkFromMouseDown({
      button: 0,
      metaKey: false,
      altKey: true,
      ctrlKey: false,
    })).toBe(false);
    expect(shouldOpenMarkdownLinkFromMouseDown({
      button: 0,
      metaKey: false,
      altKey: false,
      ctrlKey: true,
    })).toBe(false);
    expect(shouldOpenMarkdownLinkFromMouseDown({
      button: 1,
      metaKey: false,
      altKey: false,
      ctrlKey: false,
    })).toBe(false);
  });
});

describe('shouldOpenMarkdownEditorLinkFromMouseDown', () => {
  it('opens editor links on primary clicks without extra modifiers', () => {
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
    })).toBe(true);
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

describe('getRenderedMarkdownDisplayContent', () => {
  const emptyWikiIndex = { byTitle: new Map(), byRelPath: new Set<string>() };

  it('turns empty source lines into rendered blank-line markers', () => {
    expect(getRenderedMarkdownDisplayContent('', emptyWikiIndex)).toBe('\n\u00A0\n');
    expect(getRenderedMarkdownDisplayContent('  ', emptyWikiIndex)).toBe('\n\u00A0\u00A0\n');
    expect(preserveMarkdownBlankLines('First\n\nSecond')).toBe('First\n\n\u00A0\n\nSecond');
    expect(getRenderedMarkdownDisplayContent('First\n\nSecond', emptyWikiIndex)).toBe('First\n\n\u00A0\n\nSecond');
  });

  it('leaves fenced code block spacing alone', () => {
    expect(preserveMarkdownBlankLines('Before\n\n```\na\n\nb\n```\n\nAfter')).toBe(
      'Before\n\n\u00A0\n\n```\na\n\nb\n```\n\n\u00A0\n\nAfter',
    );
  });

  it('still normalizes scratchpad task shorthand before rendering', () => {
    expect(getRenderedMarkdownDisplayContent('[ ] first\n[x] second', emptyWikiIndex)).toBe('- [ ] first\n- [x] second');
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

  it('continues an ordered list on Enter', () => {
    expect(getMarkdownListEnterEdit('2) second', 9, 9)).toEqual({
      nextValue: '2) second\n3) ',
      selectionStart: 13,
      selectionEnd: 13,
    });
  });

  it('continues a quote on Enter', () => {
    expect(getMarkdownListEnterEdit('> quoted', 8, 8)).toEqual({
      nextValue: '> quoted\n> ',
      selectionStart: 11,
      selectionEnd: 11,
    });
  });

  it('continues a task list on Enter with a fresh unchecked task', () => {
    expect(getMarkdownListEnterEdit('- [x] first', 11, 11)).toEqual({
      nextValue: '- [x] first\n- [ ] ',
      selectionStart: 18,
      selectionEnd: 18,
    });
  });

  it('continues a task list without duplicating the marker when the caret is inside the marker prefix', () => {
    expect(getMarkdownListEnterEdit('- [ ] first', 2, 2)).toEqual({
      nextValue: '- [ ] \n- [ ] first',
      selectionStart: 13,
      selectionEnd: 13,
    });
  });

  it('continues a bare [] task on Enter without turning it into a bullet task', () => {
    expect(getMarkdownListEnterEdit('[] first', 8, 8)).toEqual({
      nextValue: '[] first\n[] ',
      selectionStart: 12,
      selectionEnd: 12,
    });
  });

  it('continues a bare [] task without duplicating the marker when the caret is inside the marker prefix', () => {
    expect(getMarkdownListEnterEdit('[] first', 1, 1)).toEqual({
      nextValue: '[] \n[] first',
      selectionStart: 7,
      selectionEnd: 7,
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

  it('exits empty ordered and quote lines on Enter', () => {
    expect(getMarkdownListEnterEdit('1. first\n2. ', 12, 12)).toEqual({
      nextValue: '1. first\n',
      selectionStart: 9,
      selectionEnd: 9,
    });

    expect(getMarkdownListEnterEdit('> quoted\n> ', 11, 11)).toEqual({
      nextValue: '> quoted\n',
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

  it('starts a list on an empty line and leaves the caret ready for typing', () => {
    expect(getMarkdownListToggleEdit('', 0, 0, 'ordered')).toEqual({
      nextValue: '1. ',
      selectionStart: 3,
      selectionEnd: 3,
    });

    expect(getMarkdownListToggleEdit('  ', 2, 2, 'unordered')).toEqual({
      nextValue: '  - ',
      selectionStart: 4,
      selectionEnd: 4,
    });
  });

  it('indents and outdents markdown lists while preserving the caret', () => {
    expect(getMarkdownListIndentEdit('- first', 7, 7, 'in')).toEqual({
      nextValue: '  - first',
      selectionStart: 9,
      selectionEnd: 9,
    });

    expect(getMarkdownListIndentEdit('  - first', 9, 9, 'out')).toEqual({
      nextValue: '- first',
      selectionStart: 7,
      selectionEnd: 7,
    });

    expect(getMarkdownListIndentEdit('1. first\n- [ ] task', 0, 19, 'in')).toEqual({
      nextValue: '  1. first\n  - [ ] task',
      selectionStart: 0,
      selectionEnd: 23,
    });
  });

  it('does not indent normal prose as a list', () => {
    expect(getMarkdownListIndentEdit('first', 5, 5, 'in')).toBeNull();
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

describe('shouldApplyLiveMarkdownFileUpdate', () => {
  it('applies disk updates while rendered markdown has no local edit', () => {
    expect(shouldApplyLiveMarkdownFileUpdate({
      contentMode: 'rendered',
      editContent: 'same content',
      lastSavedContent: 'same content',
    })).toBe(true);

    expect(shouldApplyLiveMarkdownFileUpdate({
      contentMode: 'rendered',
      editContent: 'local draft',
      lastSavedContent: 'old disk',
    })).toBe(false);
  });

  it('does not apply disk updates while the rendered editor is active', () => {
    expect(shouldApplyLiveMarkdownFileUpdate({
      contentMode: 'rendered',
      editContent: 'same content',
      lastSavedContent: 'same content',
      renderedEditingActive: true,
    })).toBe(false);
  });

  it('applies disk updates in markdown mode only when there is no local edit', () => {
    expect(shouldApplyLiveMarkdownFileUpdate({
      contentMode: 'markdown',
      editContent: 'same content',
      lastSavedContent: 'same content',
    })).toBe(true);

    expect(shouldApplyLiveMarkdownFileUpdate({
      contentMode: 'markdown',
      editContent: 'local edit',
      lastSavedContent: 'old disk',
    })).toBe(false);
  });

  it('does not apply disk updates over unknown markdown state or pending rendered saves', () => {
    expect(shouldApplyLiveMarkdownFileUpdate({
      contentMode: 'markdown',
      editContent: 'content',
      lastSavedContent: null,
    })).toBe(false);

    expect(shouldApplyLiveMarkdownFileUpdate({
      contentMode: 'rendered',
      editContent: 'content',
      lastSavedContent: 'content',
      hasPendingRenderedSave: true,
    })).toBe(false);

    expect(shouldApplyLiveMarkdownFileUpdate({
      contentMode: 'rendered',
      editContent: 'content',
      lastSavedContent: 'content',
      hasRenderedSaveInFlight: true,
    })).toBe(false);
  });
});

describe('getRenderedDisplayReadingContent', () => {
  it('uses the active rendered display content while rendered editing is active', () => {
    expect(getRenderedDisplayReadingContent({
      contentMode: 'rendered',
      renderedEditingActive: true,
      activeReadingPath: '/notes/a.md',
      renderedDisplayContent: { path: '/notes/a.md', content: 'disk update' },
      activeReadingContent: 'old display',
    })).toBe('disk update');
  });

  it('falls back to active content when the frozen rendered content belongs to another file', () => {
    expect(getRenderedDisplayReadingContent({
      contentMode: 'rendered',
      renderedEditingActive: true,
      activeReadingPath: '/notes/a.md',
      renderedDisplayContent: { path: '/notes/b.md', content: 'other file' },
      activeReadingContent: 'current file',
    })).toBe('current file');
  });
});

describe('buildSourceLineMapping', () => {
  it('maps visible lines directly to source lines in markdown mode', () => {
    expect(buildSourceLineMapping('one\ntwo', { contentMode: 'markdown' })).toEqual({
      activeLineKind: 'source',
      contentMode: 'markdown',
      visibleRowsOnly: false,
      lines: [
        { visibleLine: 1, sourceLine: 1, text: 'one' },
        { visibleLine: 2, sourceLine: 2, text: 'two' },
      ],
    });
  });

  it('can offset body lines back to their source document lines', () => {
    expect(buildSourceLineMapping('body', { contentMode: 'rendered', sourceLineOffset: 14 }).lines[0]).toEqual({
      visibleLine: 1,
      sourceLine: 15,
      text: 'body',
    });
  });
});

describe('getReadingUpdatedByline', () => {
  it('keeps ordinary documents as an updated timestamp', () => {
    Date.now = () => 3 * 60 * 60 * 1000;

    expect(getReadingUpdatedByline({ mtime: 0 })).toBe('Updated 3 hours ago');
  });

  it('adds the River author callsign when present', () => {
    Date.now = () => 3 * 60 * 60 * 1000;

    expect(getReadingUpdatedByline({ mtime: 0, sharedAuthorCallsign: 'AMB-MAC' })).toBe('Updated 3 hours ago by AMB-MAC');
  });

  it('prefers model edit actor metadata over shared callsign', () => {
    Date.now = () => 3 * 60 * 60 * 1000;

    expect(getReadingUpdatedByline({
      mtime: 0,
      sharedAuthorCallsign: 'AMB-MAC',
      editActor: { type: 'model', name: 'GPT-5.5', detail: 'high reasoning' },
    })).toBe('Updated 3 hours ago by GPT-5.5 (high reasoning)');
  });

  it('uses the same edit actor text in the timestamp tooltip', () => {
    expect(getReadingUpdatedTitle({
      mtime: 0,
      editActor: { type: 'model', name: 'GPT-5.5', detail: 'high reasoning' },
    })).toContain(' by GPT-5.5 (high reasoning)');
  });
});

describe('isTerminalEditorFocusToggleShortcut', () => {
  it('does not use Command+Period for terminal/editor focus', () => {
    expect(isTerminalEditorFocusToggleShortcut({
      key: '.',
      code: 'Period',
      ctrlKey: false,
      altKey: false,
      metaKey: true,
      shiftKey: false,
    })).toBe(false);
    expect(isTerminalEditorFocusToggleShortcut({
      key: '.',
      code: 'Period',
      ctrlKey: false,
      altKey: false,
      metaKey: true,
      shiftKey: true,
    })).toBe(false);
  });

  it('uses Control+Tab for terminal/editor focus instead of Option+Tab', () => {
    expect(isTerminalEditorFocusToggleShortcut({
      key: 'Tab',
      ctrlKey: true,
      altKey: false,
      metaKey: false,
      shiftKey: false,
    })).toBe(true);
    expect(isTerminalEditorFocusToggleShortcut({
      key: 'Tab',
      ctrlKey: false,
      altKey: true,
      metaKey: false,
      shiftKey: false,
    })).toBe(false);
  });
});

describe('isTerminalPanelVisibilityToggleShortcut', () => {
  it('uses Command+Period for terminal panel visibility', () => {
    expect(isTerminalPanelVisibilityToggleShortcut({
      key: '.',
      code: 'Period',
      ctrlKey: false,
      altKey: false,
      metaKey: true,
      shiftKey: false,
    })).toBe(true);
    expect(isTerminalPanelVisibilityToggleShortcut({
      key: '.',
      code: 'Period',
      ctrlKey: false,
      altKey: false,
      metaKey: true,
      shiftKey: true,
    })).toBe(false);
  });
});

describe('shouldRestoreEditorWhenTogglingTerminalPanel', () => {
  it('restores editor focus only when the visible terminal owns focus', () => {
    expect(shouldRestoreEditorWhenTogglingTerminalPanel({
      terminalVisible: true,
      terminalFocused: true,
    })).toBe(true);
    expect(shouldRestoreEditorWhenTogglingTerminalPanel({
      terminalVisible: true,
      terminalFocused: false,
    })).toBe(false);
    expect(shouldRestoreEditorWhenTogglingTerminalPanel({
      terminalVisible: false,
      terminalFocused: true,
    })).toBe(false);
    expect(shouldRestoreEditorWhenTogglingTerminalPanel({
      terminalVisible: true,
      terminalFocused: false,
      restoreEditorFocus: true,
    })).toBe(true);
  });
});

describe('shouldRestoreEditorWhenTogglingTerminalFocus', () => {
  it('restores editor focus for focused or terminal-origin focus toggles', () => {
    expect(shouldRestoreEditorWhenTogglingTerminalFocus({
      terminalVisible: true,
      terminalFocused: true,
    })).toBe(true);
    expect(shouldRestoreEditorWhenTogglingTerminalFocus({
      terminalVisible: true,
      terminalFocused: false,
    })).toBe(false);
    expect(shouldRestoreEditorWhenTogglingTerminalFocus({
      terminalVisible: true,
      terminalFocused: false,
      restoreEditorFocus: true,
    })).toBe(true);
    expect(shouldRestoreEditorWhenTogglingTerminalFocus({
      terminalVisible: false,
      terminalFocused: true,
      restoreEditorFocus: true,
    })).toBe(false);
  });
});

describe('isCodexTerminalEventTarget', () => {
  it('detects keyboard events that originate inside the integrated terminal panel', () => {
    const terminal = document.createElement('div');
    terminal.dataset.ftCodexTerminalPanel = 'true';
    const child = document.createElement('textarea');
    terminal.appendChild(child);
    const outside = document.createElement('button');

    expect(isCodexTerminalEventTarget(child)).toBe(true);
    expect(isCodexTerminalEventTarget(terminal)).toBe(true);
    expect(isCodexTerminalEventTarget(outside)).toBe(false);
    expect(isCodexTerminalEventTarget(null)).toBe(false);
  });
});

describe('markdownContentMayNeedPortableImages', () => {
  it('detects markdown image syntax before running portable image repair', () => {
    expect(markdownContentMayNeedPortableImages('plain text\n[link](https://example.com)')).toBe(false);
    expect(markdownContentMayNeedPortableImages('plain text with literal ![ marker')).toBe(false);
    expect(markdownContentMayNeedPortableImages('![Image](</tmp/a.png>)')).toBe(true);
    expect(markdownContentMayNeedPortableImages('![Image](/Users/afar/Library/Application Support/fieldtheory-mac/users/u/figures/Screenshot 1.png)')).toBe(true);
  });
});

describe('markdownPortableImagesChanged', () => {
  it('skips portable image repair when prose changes but image references do not', () => {
    const previous = '![Image](</tmp/a.png>)\n\nold prose';
    const next = '![Image](</tmp/a.png>)\n\nnew prose';
    expect(getMarkdownImageReferenceSnapshot(next)).toEqual(['![Image](</tmp/a.png>)']);
    expect(markdownPortableImagesChanged(previous, next)).toBe(false);
  });

  it('runs portable image repair when image references change', () => {
    expect(markdownPortableImagesChanged(
      'old prose',
      'old prose\n![Image](</tmp/a.png>)',
    )).toBe(true);
    expect(markdownPortableImagesChanged(
      '![Image](</tmp/a.png>)',
      '![Image](</tmp/b.png>)',
    )).toBe(true);
  });
});

describe('isRenderedMarkdownLinkEventTarget', () => {
  it('accepts visible rendered link text but rejects nearby source syntax', () => {
    const link = document.createElement('span');
    link.className = 'cm-rendered-markdown-link cm-rendered-markdown-wiki-link';
    link.textContent = 'Field Theory';
    const syntax = document.createElement('span');
    syntax.className = 'cm-rendered-markdown-wiki-syntax';
    syntax.textContent = '[[';
    const text = document.createTextNode('Field');
    link.append(text);

    expect(isRenderedMarkdownLinkEventTarget(link)).toBe(true);
    expect(isRenderedMarkdownLinkEventTarget(text)).toBe(true);
    expect(isRenderedMarkdownLinkEventTarget(syntax)).toBe(false);
    expect(isRenderedMarkdownLinkEventTarget(document.createElement('span'))).toBe(false);
  });
});

describe('getVerifiedMarkdownSelectionReplacement', () => {
  it('replaces only when the active editor selection matches the improved source text', () => {
    expect(getVerifiedMarkdownSelectionReplacement(
      'First\n\nSelected paragraph\n\nLast',
      7,
      25,
      'Selected paragraph',
      'Improved paragraph',
    )).toEqual({
      nextValue: 'First\n\nImproved paragraph\n\nLast',
      selectionStart: 7,
      selectionEnd: 25,
    });

    expect(getVerifiedMarkdownSelectionReplacement(
      'First\n\nSelected paragraph\n\nLast',
      7,
      25,
      'Different paragraph',
      'Improved paragraph',
    )).toBeNull();
  });

  it('preserves selection edge whitespace when matching trimmed copied text', () => {
    expect(getVerifiedMarkdownSelectionReplacement(
      'First\n\n Selected paragraph \n\nLast',
      7,
      27,
      'Selected paragraph',
      'Improved paragraph',
    )).toEqual({
      nextValue: 'First\n\n Improved paragraph \n\nLast',
      selectionStart: 7,
      selectionEnd: 27,
    });
  });
});

describe('getRenderedCaretEnsureSourceOffset', () => {
  it('preserves a trusted active caret before using the browser selection', () => {
    expect(getRenderedCaretEnsureSourceOffset({
      activeSourceOffset: 9,
      selectionRange: { start: 2, end: 2 },
      contentLength: 20,
    })).toBe(9);
  });

  it('uses a collapsed mapped selection before falling back to the document end', () => {
    expect(getRenderedCaretEnsureSourceOffset({
      activeSourceOffset: null,
      selectionRange: { start: 7, end: 7 },
      contentLength: 20,
    })).toBe(7);
  });

  it('uses the document end only when there is no trusted caret or collapsed mapped selection', () => {
    expect(getRenderedCaretEnsureSourceOffset({
      activeSourceOffset: null,
      selectionRange: { start: 4, end: 9 },
      contentLength: 20,
    })).toBe(20);
  });
});

describe('documentVersionsEqual', () => {
  it('treats matching size and content hash as the same document version', () => {
    expect(documentVersionsEqual(
      { mtimeMs: 1, size: 12, sha256: 'abc' },
      { mtimeMs: 2, size: 12, sha256: 'abc' },
    )).toBe(true);
  });

  it('treats missing versions or changed content hashes as different', () => {
    expect(documentVersionsEqual(null, { mtimeMs: 1, size: 12, sha256: 'abc' })).toBe(false);
    expect(documentVersionsEqual(
      { mtimeMs: 1, size: 12, sha256: 'abc' },
      { mtimeMs: 2, size: 12, sha256: 'def' },
    )).toBe(false);
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

describe('rendered markdown edit helpers', () => {
  it('inserts rendered Enter after hidden inline markdown wrappers', () => {
    expect(getRenderedMarkdownEnterEdit('**Done**', 6, 6)).toEqual({
      nextValue: '**Done**\n',
      selectionStart: 9,
      selectionEnd: 9,
    });

    expect(getRenderedMarkdownEnterEdit('**Done**', 2, 2)).toEqual({
      nextValue: '\n**Done**',
      selectionStart: 0,
      selectionEnd: 0,
    });

    expect(getRenderedMarkdownEnterEdit('[[Target Page|Alias]]', 19, 19)).toEqual({
      nextValue: '[[Target Page|Alias]]\n',
      selectionStart: 22,
      selectionEnd: 22,
    });
  });

  it('does not skip visible literal punctuation when inserting rendered Enter', () => {
    expect(getRenderedMarkdownEnterEdit('Use * literally', 4, 4)).toEqual({
      nextValue: 'Use \n* literally',
      selectionStart: 5,
      selectionEnd: 5,
    });
  });

  it('inserts rendered Enter before hidden block markdown at the visible line start', () => {
    expect(getRenderedMarkdownEnterEdit('# Resolved', 2, 2)).toEqual({
      nextValue: '\n# Resolved',
      selectionStart: 0,
      selectionEnd: 0,
    });

    expect(getRenderedMarkdownEnterEdit('> Resolved', 2, 2)).toEqual({
      nextValue: '\n> Resolved',
      selectionStart: 0,
      selectionEnd: 0,
    });

    expect(getRenderedMarkdownEnterEdit('Resolved', 0, 0)).toEqual({
      nextValue: '\nResolved',
      selectionStart: 0,
      selectionEnd: 0,
    });
  });

  it('moves the rendered caret forward when Enter creates another blank line', () => {
    expect(getRenderedMarkdownEnterEdit('hello\n', 6, 6)).toEqual({
      nextValue: 'hello\n\n',
      selectionStart: 7,
      selectionEnd: 7,
    });

    expect(getRenderedMarkdownEnterEdit('', 0, 0)).toEqual({
      nextValue: '\n',
      selectionStart: 1,
      selectionEnd: 1,
    });
  });

  it('continues markdown list structures from rendered Enter', () => {
    expect(getRenderedMarkdownEnterEdit('- first', 7, 7)).toEqual({
      nextValue: '- first\n- ',
      selectionStart: 10,
      selectionEnd: 10,
    });

    expect(getRenderedMarkdownEnterEdit('1. first', 8, 8)).toEqual({
      nextValue: '1. first\n2. ',
      selectionStart: 12,
      selectionEnd: 12,
    });

    expect(getRenderedMarkdownEnterEdit('- [x] first', 11, 11)).toEqual({
      nextValue: '- [x] first\n- [ ] ',
      selectionStart: 18,
      selectionEnd: 18,
    });
  });

  it('exits empty markdown list structures from rendered Enter', () => {
    expect(getRenderedMarkdownEnterEdit('- first\n- ', 10, 10)).toEqual({
      nextValue: '- first\n',
      selectionStart: 8,
      selectionEnd: 8,
    });
  });

  it('deletes adjacent rendered image markdown as a single block', () => {
    const value = 'before\n![Image](<file:///tmp/Figure.png>)\nafter';
    const imageStart = value.indexOf('![');
    const imageEnd = value.indexOf('\nafter');
    const imageMarkdown = '![Image](<file:///tmp/Figure.png>)';

    expect(getRenderedMarkdownDeleteShortcutEdit({
      event: mkKey({ key: 'Backspace' }),
      value,
      selectionStart: imageEnd,
      selectionEnd: imageEnd,
    })).toEqual({
      nextValue: 'before\nafter',
      selectionStart: imageStart,
      selectionEnd: imageStart,
      deletedMarkdownImages: [imageMarkdown],
    });

    expect(getRenderedMarkdownDeleteShortcutEdit({
      event: mkKey({ key: 'Delete' }),
      value,
      selectionStart: imageStart,
      selectionEnd: imageStart,
    })).toEqual({
      nextValue: 'before\nafter',
      selectionStart: imageStart,
      selectionEnd: imageStart,
      deletedMarkdownImages: [imageMarkdown],
    });
  });

  it('deletes selected rendered image markdown fragments as a single block', () => {
    const value = 'before\n![Image](<./Doc.assets/Screenshot%201.png>)\nafter';
    const imageStart = value.indexOf('![');
    const selectedStart = value.indexOf('Image');
    const selectedEnd = selectedStart + 'Image'.length;

    expect(getRenderedMarkdownDeleteShortcutEdit({
      event: mkKey({ key: 'Backspace' }),
      value,
      selectionStart: selectedStart,
      selectionEnd: selectedEnd,
    })).toEqual({
      nextValue: 'before\nafter',
      selectionStart: imageStart,
      selectionEnd: imageStart,
      deletedMarkdownImages: ['![Image](<./Doc.assets/Screenshot%201.png>)'],
    });
  });

  it('deletes rendered image markdown when the source offset is inside its destination', () => {
    const value = 'before\n![Image](<./Doc.assets/Screenshot%201.png>)\nafter';
    const imageStart = value.indexOf('![');
    const destinationOffset = value.indexOf('Screenshot');

    expect(getRenderedMarkdownDeleteShortcutEdit({
      event: mkKey({ key: 'Backspace' }),
      value,
      selectionStart: destinationOffset,
      selectionEnd: destinationOffset,
    })).toEqual({
      nextValue: 'before\nafter',
      selectionStart: imageStart,
      selectionEnd: imageStart,
      deletedMarkdownImages: ['![Image](<./Doc.assets/Screenshot%201.png>)'],
    });
  });

  it('turns empty rendered list marker lines back into blank lines on delete', () => {
    expect(getRenderedMarkdownDeleteShortcutEdit({
      event: mkKey({ key: 'Backspace' }),
      value: '- first\n- \nafter',
      selectionStart: 10,
      selectionEnd: 10,
    })).toEqual({
      nextValue: '- first\n\nafter',
      selectionStart: 8,
      selectionEnd: 8,
    });

    expect(getRenderedMarkdownDeleteShortcutEdit({
      event: mkKey({ key: 'Delete' }),
      value: '- [ ] ',
      selectionStart: 6,
      selectionEnd: 6,
    })).toEqual({
      nextValue: '',
      selectionStart: 0,
      selectionEnd: 0,
    });

    expect(getRenderedMarkdownDeleteShortcutEdit({
      event: mkKey({ key: 'Backspace' }),
      value: '1. ',
      selectionStart: 3,
      selectionEnd: 3,
    })).toEqual({
      nextValue: '',
      selectionStart: 0,
      selectionEnd: 0,
    });
  });

  it('returns rendered list items to a clean empty body after deleting their only character', () => {
    expect(getSingleCharacterRenderedListBodyDeleteEdit('- a', 3, 3, 'Backspace')).toEqual({
      nextValue: '- ',
      selectionStart: 2,
      selectionEnd: 2,
    });
    expect(getSingleCharacterRenderedListBodyDeleteEdit('- a', 2, 2, 'Delete')).toEqual({
      nextValue: '- ',
      selectionStart: 2,
      selectionEnd: 2,
    });
    expect(getSingleCharacterRenderedListBodyDeleteEdit('- [ ] a', 7, 7, 'Backspace')).toEqual({
      nextValue: '- [ ] ',
      selectionStart: 6,
      selectionEnd: 6,
    });

    expect(getRenderedMarkdownDeleteShortcutEdit({
      event: mkKey({ key: 'Backspace' }),
      value: '- a',
      selectionStart: 3,
      selectionEnd: 3,
    })).toEqual({
      nextValue: '- ',
      selectionStart: 2,
      selectionEnd: 2,
    });
  });

  it('fills an empty rendered todo line when pasting todo text', () => {
    expect(getRenderedMarkdownPasteTextEdit('- [ ] ', 6, 6, '- [ ] follow up')).toEqual({
      nextValue: '- [ ] follow up',
      selectionStart: 15,
      selectionEnd: 15,
    });

    expect(getRenderedMarkdownPasteTextEdit('- [ ] existing', 6, 6, '- [ ] follow up')).toBeNull();
  });

  it('suppresses plain deletes that would expose hidden rendered markdown syntax', () => {
    expect(shouldSuppressRenderedMarkdownBoundaryDelete('**Done**', 2, 2, 'Backspace')).toBe(true);
    expect(shouldSuppressRenderedMarkdownBoundaryDelete('**Done**', 6, 6, 'Delete')).toBe(true);
    expect(shouldSuppressRenderedMarkdownBoundaryDelete('[Guide](wiki://guide)', 1, 1, 'Backspace')).toBe(true);
    expect(shouldSuppressRenderedMarkdownBoundaryDelete('[Guide](wiki://guide)', 6, 6, 'Delete')).toBe(true);
    expect(shouldSuppressRenderedMarkdownBoundaryDelete('- first', 2, 2, 'Backspace')).toBe(true);
    expect(shouldSuppressRenderedMarkdownBoundaryDelete('- [ ] first', 6, 6, 'Backspace')).toBe(true);
  });

  it('allows plain deletes of visible rendered text', () => {
    expect(shouldSuppressRenderedMarkdownBoundaryDelete('**Done**', 6, 6, 'Backspace')).toBe(false);
    expect(shouldSuppressRenderedMarkdownBoundaryDelete('**Done**', 2, 2, 'Delete')).toBe(false);
    expect(shouldSuppressRenderedMarkdownBoundaryDelete('Use * literally', 4, 4, 'Delete')).toBe(false);
  });

  it('handles macOS rendered line delete chords from the source offset', () => {
    expect(getRenderedMarkdownDeleteShortcutEdit({
      event: mkKey({ key: 'Backspace', metaKey: true }),
      value: 'alpha beta\ngamma',
      selectionStart: 5,
      selectionEnd: 5,
    })).toEqual({
      nextValue: ' beta\ngamma',
      selectionStart: 0,
      selectionEnd: 0,
    });

    expect(getRenderedMarkdownDeleteShortcutEdit({
      event: mkKey({ key: 'Delete', metaKey: true }),
      value: 'alpha beta\ngamma',
      selectionStart: 5,
      selectionEnd: 5,
    })).toEqual({
      nextValue: 'alpha\ngamma',
      selectionStart: 5,
      selectionEnd: 5,
    });
  });

  it('lets CodeMirror handle collapsed rendered macOS line-boundary deletes', () => {
    expect(shouldLetRenderedCodeMirrorHandleLineBoundaryDelete({
      event: mkKey({ key: 'Backspace', metaKey: true }),
      selectionStart: 5,
      selectionEnd: 5,
    })).toBe(true);
    expect(shouldLetRenderedCodeMirrorHandleLineBoundaryDelete({
      event: mkKey({ key: 'Delete', metaKey: true }),
      selectionStart: 5,
      selectionEnd: 5,
    })).toBe(true);
    expect(shouldLetRenderedCodeMirrorHandleLineBoundaryDelete({
      event: mkKey({ key: 'Backspace', metaKey: true }),
      selectionStart: 2,
      selectionEnd: 5,
    })).toBe(false);
    expect(shouldLetRenderedCodeMirrorHandleLineBoundaryDelete({
      event: mkKey({ key: 'Backspace' }),
      selectionStart: 5,
      selectionEnd: 5,
    })).toBe(false);
  });

  it('applies task and list shortcuts from rendered edit mode', () => {
    expect(getRenderedMarkdownShortcutEdit({
      event: mkKey({ key: ')', code: 'Digit0', metaKey: true, shiftKey: true }),
      value: 'alpha\nbeta',
      selectionStart: 0,
      selectionEnd: 10,
    })).toEqual({
      nextValue: '- [ ] alpha\n- [ ] beta',
      selectionStart: 0,
      selectionEnd: 22,
    });

    expect(getRenderedMarkdownShortcutEdit({
      event: mkKey({ key: '&', code: 'Digit7', metaKey: true, shiftKey: true }),
      value: 'first\nsecond',
      selectionStart: 0,
      selectionEnd: 12,
    })).toEqual({
      nextValue: '1. first\n2. second',
      selectionStart: 0,
      selectionEnd: 18,
    });

    expect(getRenderedMarkdownShortcutEdit({
      event: mkKey({ key: '*', code: 'Digit8', metaKey: true, shiftKey: true }),
      value: 'first\nsecond',
      selectionStart: 0,
      selectionEnd: 12,
      unorderedListMarker: 'carrot',
    })).toEqual({
      nextValue: '› first\n› second',
      selectionStart: 0,
      selectionEnd: 16,
    });
  });

	  it('applies list shortcuts to an empty rendered line and leaves the caret after the marker', () => {
	    expect(getRenderedMarkdownShortcutEdit({
	      event: mkKey({ key: '&', code: 'Digit7', metaKey: true, shiftKey: true }),
	      value: '',
      selectionStart: 0,
      selectionEnd: 0,
    })).toEqual({
      nextValue: '1. ',
      selectionStart: 3,
      selectionEnd: 3,
    });

    expect(getRenderedMarkdownShortcutEdit({
      event: mkKey({ key: '*', code: 'Digit8', metaKey: true, shiftKey: true }),
      value: '',
      selectionStart: 0,
      selectionEnd: 0,
      unorderedListMarker: 'carrot',
    })).toEqual({
      nextValue: '› ',
      selectionStart: 2,
	      selectionEnd: 2,
	    });
	  });

	  it('creates inline formatting placeholders for empty rendered shortcuts', () => {
	    expect(getRenderedMarkdownShortcutEdit({
	      event: mkKey({ key: 'b', metaKey: true }),
	      value: 'hello ',
	      selectionStart: 6,
	      selectionEnd: 6,
	    })).toEqual({
	      nextValue: 'hello ****',
	      selectionStart: 8,
	      selectionEnd: 8,
	    });
	    expect(getRenderedMarkdownShortcutEdit({
	      event: mkKey({ key: 'i', metaKey: true }),
	      value: 'hello ',
	      selectionStart: 6,
	      selectionEnd: 6,
	    })).toEqual({
	      nextValue: 'hello **',
	      selectionStart: 7,
	      selectionEnd: 7,
	    });
	    expect(getRenderedMarkdownShortcutEdit({
	      event: mkKey({ key: 'u', metaKey: true }),
	      value: 'hello ',
	      selectionStart: 6,
	      selectionEnd: 6,
	    })).toEqual({
	      nextValue: 'hello <u></u>',
	      selectionStart: 9,
	      selectionEnd: 9,
	    });
	  });

	  it('toggles empty rendered inline formatting placeholders off', () => {
	    expect(getRenderedMarkdownShortcutEdit({
	      event: mkKey({ key: 'b', metaKey: true }),
	      value: 'hello ****',
	      selectionStart: 8,
	      selectionEnd: 8,
	    })).toEqual({
	      nextValue: 'hello ',
	      selectionStart: 6,
	      selectionEnd: 6,
	    });
	    expect(getRenderedMarkdownShortcutEdit({
	      event: mkKey({ key: 'i', metaKey: true }),
	      value: 'hello **',
	      selectionStart: 7,
	      selectionEnd: 7,
	    })).toEqual({
	      nextValue: 'hello ',
	      selectionStart: 6,
	      selectionEnd: 6,
	    });
	    expect(getRenderedMarkdownShortcutEdit({
	      event: mkKey({ key: 'u', metaKey: true }),
	      value: 'hello <u></u>',
	      selectionStart: 9,
	      selectionEnd: 9,
	    })).toEqual({
	      nextValue: 'hello ',
	      selectionStart: 6,
	      selectionEnd: 6,
	    });
	  });

  it('recognizes the paste selection to terminal hotkey', () => {
    expect(isPasteSelectionToTerminalShortcut(mkKey({ key: 't', metaKey: true, altKey: true }))).toBe(true);
    expect(isPasteSelectionToTerminalShortcut(mkKey({ key: 't', metaKey: true }))).toBe(false);
    expect(isPasteSelectionToTerminalShortcut(mkKey({ key: 't', metaKey: true, altKey: true, shiftKey: true }))).toBe(false);
  });

  it('positions the terminal paste button to the right of the selected text', () => {
    expect(getTerminalPastePopoverPosition(
      { top: 100, left: 180, right: 240, height: 24 },
      { width: 800, height: 600 },
    )).toEqual({
      top: 97,
      left: 254,
    });
  });

  it('keeps the terminal paste button inside the viewport', () => {
    expect(getTerminalPastePopoverPosition(
      { top: 590, left: 720, right: 790, height: 24 },
      { width: 800, height: 600 },
    )).toEqual({
      top: 562,
      left: 758,
    });
  });

  it('anchors the native terminal paste button outside the document body', () => {
    const viewport = { width: 1200, height: 800 };
    const contentRect = { right: 820 };

    expect(getNativeTerminalPastePopoverPosition(
      { top: 100, left: 180, right: 240, height: 24 },
      viewport,
      contentRect,
    )).toEqual({
      top: 97,
      left: 834,
    });
    expect(getNativeTerminalPastePopoverPosition(
      { top: 100, left: 180, right: 760, height: 24 },
      viewport,
      contentRect,
    )).toEqual({
      top: 97,
      left: 834,
    });
  });

  it('converts local rendered image urls to terminal file paths', () => {
    expect(getTerminalImagePastePath('ftlocalfile:///Users/afar/Library/Application%20Support/fieldtheory/image.png')).toBe(
      '/Users/afar/Library/Application Support/fieldtheory/image.png',
    );
    expect(getTerminalImagePastePath('file:///Users/afar/Desktop/shot.png')).toBe('/Users/afar/Desktop/shot.png');
    expect(getTerminalImagePastePath('https://example.com/image.png')).toBeNull();
  });

  it('replaces rendered images with file paths in terminal paste selections', () => {
    const root = document.createElement('div');
    root.innerHTML = [
      '<span>before </span>',
      '<span class="cm-rendered-markdown-image" data-cm-rendered-markdown-image-src="ftlocalfile:///Users/afar/Notes/figures/shot.png">',
      '<img src="ftlocalfile:///Users/afar/Notes/figures/shot.png" alt="Shot">',
      '<span>Shot</span>',
      '</span>',
      '<span> after</span>',
    ].join('');
    document.body.appendChild(root);
    const range = document.createRange();
    range.selectNodeContents(root);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    expect(getTerminalPasteTextFromSelection(selection)).toBe('before /Users/afar/Notes/figures/shot.png after');

    root.remove();
  });

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

  it('toggles split rendered bold markers off after a bad rendered newline split', () => {
    expect(getRenderedMarkdownSelectionFormatEdit('**What are Delights?\n**', 2, 20, 'bold')).toEqual({
      nextValue: 'What are Delights?\n',
      selectionStart: 0,
      selectionEnd: 18,
    });
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
    )).toBe(true);

    expect(canDropLibraryItem(
      { rootPath: '/wiki', kind: 'dir', relPath: 'entries' },
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

  it('restores persisted Typedown editor sessions as a known content mode', () => {
    const session = restoreLibrarianEditorSession({
      getItem: (key) => key === 'librarian-editor-session'
        ? JSON.stringify({
          itemType: 'wiki',
          itemPath: 'Notes/Typedown',
          contentMode: 'typedown',
          selectionStart: 3,
          selectionEnd: 8,
          scrollTop: 13,
        })
        : null,
    });

    expect(session).toMatchObject({
      itemType: 'wiki',
      itemPath: 'Notes/Typedown',
      contentMode: 'typedown',
      selectionStart: 3,
      selectionEnd: 8,
      scrollTop: 13,
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

  it('uses restored editor session instead of stale selection on startup', () => {
    expect(resolveLibrarianInitialSelection(
      { type: 'bookmarks' },
      {
        itemType: 'wiki',
        itemPath: 'scratchpad/Progress',
        contentMode: 'rendered',
        selectionStart: 0,
        selectionEnd: 0,
        scrollTop: 0,
      },
      false,
    )).toEqual({ type: 'wiki', relPath: 'scratchpad/Progress' });
  });

  it('uses restored external editor session instead of stale wiki selection on startup', () => {
    expect(resolveLibrarianInitialSelection(
      { type: 'wiki', relPath: 'scratchpad/FT feedback for (in codex panel and mac app)' },
      {
        itemType: 'external',
        itemPath: '/Users/afar/notes/current.md',
        contentMode: 'markdown',
        selectionStart: 0,
        selectionEnd: 0,
        scrollTop: 0,
      },
      false,
    )).toEqual({ type: 'external', path: '/Users/afar/notes/current.md' });
  });

  it('falls back to stored editor session when no restored selection exists', () => {
    expect(resolveLibrarianInitialSelection(
      null,
      {
        itemType: 'external',
        itemPath: '/Users/afar/notes/current.md',
        contentMode: 'markdown',
        selectionStart: 0,
        selectionEnd: 0,
        scrollTop: 0,
      },
      false,
    )).toEqual({ type: 'external', path: '/Users/afar/notes/current.md' });
  });

  it('keeps explicit launch targets ahead of stored editor sessions', () => {
    expect(resolveLibrarianInitialSelection(
      { type: 'bookmarks' },
      {
        itemType: 'wiki',
        itemPath: 'scratchpad/Progress',
        contentMode: 'rendered',
        selectionStart: 0,
        selectionEnd: 0,
        scrollTop: 0,
      },
      true,
    )).toBeNull();
  });
});

describe('librarian navigation history helpers', () => {
  it('maps Cmd+[ and Cmd+] to navigation even when no history move is available', () => {
    expect(getLibrarianBracketNavigationDirection(mkKey({ key: '[', metaKey: true }), {
      canNavigateBack: true,
      canNavigateForward: true,
    })).toBe(-1);
    expect(getLibrarianBracketNavigationDirection(mkKey({ key: ']', metaKey: true }), {
      canNavigateBack: true,
      canNavigateForward: true,
    })).toBe(1);
    expect(getLibrarianBracketNavigationDirection(mkKey({ key: '[', metaKey: true }), {
      canNavigateBack: false,
      canNavigateForward: true,
    })).toBe(0);
  });

  it('does not treat shifted or non-bracket shortcuts as navigation', () => {
    expect(getLibrarianBracketNavigationDirection(mkKey({ key: '[', metaKey: true, shiftKey: true }), {
      canNavigateBack: true,
      canNavigateForward: true,
    })).toBeNull();
    expect(getLibrarianBracketNavigationDirection(mkKey({ key: 'a', metaKey: true }), {
      canNavigateBack: true,
      canNavigateForward: true,
    })).toBeNull();
  });

  it('pushes file navigation entries and ignores consecutive duplicates', () => {
    let history = pushLibrarianNavigationEntry({ entries: [], index: -1 }, { itemType: 'wiki', itemPath: 'entries/a' });
    history = pushLibrarianNavigationEntry(history, { itemType: 'wiki', itemPath: 'entries/a' });

    expect(history).toEqual({
      entries: [{ itemType: 'wiki', itemPath: 'entries/a' }],
      index: 0,
    });
  });

  it('keeps Ember as a navigable history entry between files', () => {
    let history = pushLibrarianNavigationEntry({ entries: [], index: -1 }, { itemType: 'wiki', itemPath: 'entries/a' });
    history = pushLibrarianNavigationEntry(history, { itemType: 'ember', itemPath: EMBER_ITEM_ID });
    history = pushLibrarianNavigationEntry(history, { itemType: 'wiki', itemPath: 'Ember/Mom' });

    const back = moveLibrarianNavigationHistory(history, -1);

    expect(back?.entry).toEqual({ itemType: 'ember', itemPath: EMBER_ITEM_ID });
    expect(back?.history.entries).toEqual([
      { itemType: 'wiki', itemPath: 'entries/a' },
      { itemType: 'ember', itemPath: EMBER_ITEM_ID },
      { itemType: 'wiki', itemPath: 'Ember/Mom' },
    ]);
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

  it('keeps the grouped top chrome stack fully visible across a taller top band', () => {
    expect(getGroupedFocusChromeProximityOpacity({
      cursorClientY: 150,
      paneClientTop: 0,
      viewportHeight: 800,
      revealDistancePx: 220,
      fullOpacityDistancePx: 128,
      topFullOpacityDistancePx: 160,
    })).toBe(1);
    expect(getGroupedFocusChromeProximityOpacity({
      cursorClientY: 190,
      paneClientTop: 0,
      viewportHeight: 800,
      revealDistancePx: 220,
      fullOpacityDistancePx: 128,
      topFullOpacityDistancePx: 160,
    })).toBeGreaterThan(0);
  });

  it('keeps the parent top nav hidden while document focus chrome is active', () => {
    expect(getFocusChromeSurfaceOpacity({
      isFocusChromeSurface: true,
      focusChromeActive: true,
    })).toBe(0);
  });

  it('keeps the parent top nav visible outside document focus chrome', () => {
    expect(getFocusChromeSurfaceOpacity({
      isFocusChromeSurface: false,
      focusChromeActive: true,
    })).toBe(1);
  });

  it('uses proximity opacity for the scoped focus controls', () => {
    expect(getFocusChromeScopedItemOpacity({
      focusChromeActive: true,
      visualOpacity: 0.42,
    })).toBe(0.42);
    expect(getFocusChromeScopedItemOpacity({
      focusChromeActive: false,
      visualOpacity: 0,
    })).toBe(1);
  });

  it('keeps the rest of the toolbar out of proximity reveal unless pinned', () => {
    expect(shouldShowFocusToolbarControls({
      focusChromeActive: true,
      focusChromePinnedVisible: false,
    })).toBe(false);
    expect(shouldShowFocusToolbarControls({
      focusChromeActive: true,
      focusChromePinnedVisible: true,
    })).toBe(true);
    expect(shouldShowFocusToolbarControls({
      focusChromeActive: false,
      focusChromePinnedVisible: false,
    })).toBe(true);
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

describe('librarian sidebar visibility', () => {
  it('hides the sidebar for fullscreen Bookmarks like other Library surfaces', () => {
    expect(isLibrarianSidebarHidden({
      isFullScreen: true,
      selectedItemType: 'bookmarks',
    })).toBe(true);

    expect(isLibrarianSidebarHidden({
      isFullScreen: true,
      selectedItemType: 'wiki',
    })).toBe(true);
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

    expect(focusPadding - normalPadding).toBe(40);
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

    expect(focusPadding - normalPadding).toBe(40);
  });

  it('keeps bottom room as rendered scroll space while focus chrome overlays the footer', () => {
    expect(getLibrarianContentBottomScrollSpace({
      contentMode: 'rendered',
      focusChromeActive: false,
    })).toBe(59.2);
    expect(getLibrarianContentBottomScrollSpace({
      contentMode: 'rendered',
      focusChromeActive: true,
    })).toBe(59.2);
    expect(getLibrarianContentBottomScrollSpace({
      contentMode: 'markdown',
      focusChromeActive: true,
    })).toBe(0);
  });
});

describe('markdown word delete around list markers', () => {
  it('deletes the previous word without deleting an unordered list marker', () => {
    expect(getMarkdownWordDeleteBackwardPreservingListMarkerEdit(
      '- hello',
      '- hello'.length,
      '- hello'.length,
    )).toEqual({
      nextValue: '- ',
      selectionStart: 2,
      selectionEnd: 2,
    });
  });

  it('deletes the previous word without deleting a todo marker', () => {
    expect(getMarkdownWordDeleteBackwardPreservingListMarkerEdit(
      '- [ ] hello',
      '- [ ] hello'.length,
      '- [ ] hello'.length,
    )).toEqual({
      nextValue: '- [ ] ',
      selectionStart: 6,
      selectionEnd: 6,
    });
  });

  it('deletes the previous word without deleting an ordered list marker', () => {
    expect(getMarkdownWordDeleteBackwardPreservingListMarkerEdit(
      '12. hello',
      '12. hello'.length,
      '12. hello'.length,
    )).toEqual({
      nextValue: '12. ',
      selectionStart: 4,
      selectionEnd: 4,
    });
  });

  it('deletes the previous word without deleting a carrot list marker', () => {
    expect(getMarkdownWordDeleteBackwardPreservingListMarkerEdit(
      '›› hello',
      '›› hello'.length,
      '›› hello'.length,
    )).toEqual({
      nextValue: '›› ',
      selectionStart: 3,
      selectionEnd: 3,
    });
  });

  it('does not handle non-list word deletion', () => {
    expect(getMarkdownWordDeleteBackwardPreservingListMarkerEdit(
      'plain hello',
      'plain hello'.length,
      'plain hello'.length,
    )).toBeNull();
  });
});

describe('getLibrarianTitleFontSize', () => {
  it('shrinks very long markdown titles while keeping normal titles at full size', () => {
    expect(getLibrarianTitleFontSize('Short note', 'rendered')).toBe(30);
    expect(getLibrarianTitleFontSize('A very long markdown title that needs to fit inside the available document width', 'rendered')).toBeLessThan(30);
    expect(getLibrarianTitleFontSize('A very long markdown title that needs to fit inside the available document width', 'markdown')).toBeLessThan(26);
    expect(getLibrarianTitleFontSize('x'.repeat(96), 'rendered')).toBeGreaterThan(18);
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

    persistLibrarianSelection(storage, { type: 'external', path: '/tmp/external.md' });
    expect(JSON.parse(state['librarian-last-selection'])).toEqual({
      type: 'external',
      path: '/tmp/external.md',
    });

    persistLibrarianSelection(storage, null);
    expect(state['librarian-last-selection']).toBeUndefined();
  });

  it('persists native startup selection from browser library surfaces', () => {
    const state: Record<string, string> = {
      'librarian-last-selection': JSON.stringify({ type: 'wiki', relPath: 'scratchpad/Native' }),
    };
    const storage = {
      setItem(key: string, value: string) {
        state[key] = value;
      },
      removeItem(key: string) {
        delete state[key];
      },
    };

    expect(persistNativeLibrarianSelection(
      storage,
      { type: 'wiki', relPath: 'scratchpad/Codex Panel' },
    )).toBe(true);

    expect(JSON.parse(state['librarian-last-selection'])).toEqual({
      type: 'wiki',
      relPath: 'scratchpad/Codex Panel',
    });
  });

  it('persists native startup selection from the app surface', () => {
    const state: Record<string, string> = {};
    const storage = {
      setItem(key: string, value: string) {
        state[key] = value;
      },
      removeItem(key: string) {
        delete state[key];
      },
    };

    expect(persistNativeLibrarianSelection(
      storage,
      { type: 'wiki', relPath: 'scratchpad/Mac App' },
    )).toBe(true);

    expect(JSON.parse(state['librarian-last-selection'])).toEqual({
      type: 'wiki',
      relPath: 'scratchpad/Mac App',
    });
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

describe('shouldShowSidebarTodoStateBadge', () => {
  it('hides the task badge while an archived file row collapses', () => {
    expect(shouldShowSidebarTodoStateBadge({ todoState: 'done' }, false)).toBe(true);
    expect(shouldShowSidebarTodoStateBadge({ todoState: 'done' }, true)).toBe(false);
  });

  it('does not show a badge for files without a task state', () => {
    expect(shouldShowSidebarTodoStateBadge({}, false)).toBe(false);
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
  const archivedFile = (title: string, timestamp: number): LibrarySidebarNode => {
    const node = file(title, timestamp);
    return node.kind === 'file'
      ? { ...node, item: { ...node.item, archived: true } }
      : node;
  };
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

  it('sorts archived files below normal sibling files unless they are pinned', () => {
    const pinned = new Set(['wiki:Archived pinned']);
    const result = sortSidebarNodes([
      archivedFile('Archived late', 30),
      file('Normal old', 10),
      archivedFile('Archived pinned', 5),
      file('Normal new', 20),
    ], 'time', pinned);

    expect(result.map((node) => node.kind === 'file' ? node.item.title : node.label)).toEqual([
      'Archived pinned',
      'Normal new',
      'Normal old',
      'Archived late',
    ]);
  });

  it('splits unpinned archived files so scratchpad can render them below show more', () => {
    const pinned = new Set(['wiki:Archived pinned']);
    const archived = archivedFile('Archived late', 30);
    const archivedPinned = archivedFile('Archived pinned', 5);

    const result = splitArchivedSidebarNodes([
      file('Normal', 10),
      archived,
      archivedPinned,
    ], pinned);

    expect(result.normalNodes.map((node) => node.kind === 'file' ? node.item.title : node.label)).toEqual([
      'Normal',
      'Archived pinned',
    ]);
    expect(result.archivedNodes.map((node) => node.kind === 'file' ? node.item.title : node.label)).toEqual([
      'Archived late',
    ]);
  });

  it('promotes pinned sidebar items without changing the unpinned order', () => {
    const pinned = new Set(['wiki:Middle']);
    const result = sortSidebarNodes([
      file('Old', 10),
      file('Newest', 30),
      file('Middle', 20),
    ], 'time', pinned);

    expect(result.map((node) => node.kind === 'file' ? node.item.title : node.label)).toEqual([
      'Middle',
      'Newest',
      'Old',
    ]);
  });

  it('groups sidebar items by icon color before sorting within each group', () => {
    const result = sortSidebarNodes([
      file('Zulu', 10),
      file('Alpha', 30),
      file('Beta', 20),
    ], 'time', new Set(), {
      'wiki:Alpha': 1,
      'wiki:Beta': 1,
    });

    expect(result.map((node) => node.kind === 'file' ? node.item.title : node.label)).toEqual([
      'Zulu',
      'Alpha',
      'Beta',
    ]);
  });

  it('treats uncolored items as the grey color group when color order changes', () => {
    const result = sortSidebarNodes([
      file('Grey', 10),
      file('Blue', 20),
    ], 'alpha', new Set(), {
      'wiki:Blue': 4,
    }, [4, 0, 1, 2, 3, 5, 6]);

    expect(result.map((node) => node.kind === 'file' ? node.item.title : node.label)).toEqual([
      'Blue',
      'Grey',
    ]);
  });

  it('uses the dragged icon color order when grouping sidebar items', () => {
    const result = sortSidebarNodes([
      file('Warm', 10),
      file('Cool', 20),
    ], 'alpha', new Set(), {
      'wiki:Warm': 0,
      'wiki:Cool': 1,
    }, [1, 0, 2, 3, 4, 5, 6]);

    expect(result.map((node) => node.kind === 'file' ? node.item.title : node.label)).toEqual([
      'Cool',
      'Warm',
    ]);
  });

  it('splits archived files from normal siblings for the collapsed archive section', () => {
    const result = splitArchivedSidebarNodes([
      archivedFile('Archived', 30),
      file('Normal', 10),
      dir('Nested'),
    ]);

    expect(result.normalNodes.map((node) => node.kind === 'file' ? node.item.title : node.label)).toEqual([
      'Normal',
      'Nested',
    ]);
    expect(result.archivedNodes.map((node) => node.kind === 'file' ? node.item.title : node.label)).toEqual([
      'Archived',
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

  it('sorts combined top-level sidebar nodes by contained timestamps in date mode', () => {
    const result = orderTopLevelSidebarNodes([
      dir('scratchpad', [file('scratchpad-note', 40)]),
      dir('plans', [file('plans-note', 10)]),
      dir('debates', [file('debates-note', 30)]),
      dir('entries', [file('entries-note', 20)]),
    ], 'time');

    expect(result.map((node) => node.kind === 'dir' ? node.label : node.item.title)).toEqual([
      'Scratchpad',
      'Debates',
      'Entries',
      'Plans',
    ]);
  });

  it('lets top-level date sort override pins and icon colors', () => {
    const result = orderTopLevelSidebarNodes([
      dir('old-pinned', [file('old-pinned-note', 10)]),
      dir('new-unpinned', [file('new-unpinned-note', 30)]),
      dir('middle-colored', [file('middle-colored-note', 20)]),
    ], 'time', new Set(['/wiki::old-pinned']), {
      '/wiki::middle-colored': 4,
    }, [4, 0, 1, 2, 3, 5, 6]);

    expect(result.map((node) => node.kind === 'dir' ? node.label : node.item.title)).toEqual([
      'New-unpinned',
      'Middle-colored',
      'Old-pinned',
    ]);
  });

  it('keeps pinned folders ahead of unpinned top-level folders', () => {
    const result = orderTopLevelSidebarNodes([
      dir('scratchpad'),
      dir('Plans'),
    ], 'alpha', new Set(['/wiki::Plans']));

    expect(result.map((node) => node.kind === 'dir' ? node.label : node.item.title)).toEqual([
      'Plans',
      'Scratchpad',
    ]);
  });

  it('separates River from visible top-level roots for shortcut rendering', () => {
    const river = dir('River (shared)', [file('Shared note', 10)]);
    const result = splitRiverShortcutNode([
      dir('scratchpad'),
      river,
      dir('Plans'),
    ]);

    expect(result.riverShortcutNode?.id).toBe('/wiki::River (shared)');
    expect(result.riverShortcutNode?.label).toBe('River (shared)');
    expect(result.visibleRoots.map((node) => node.kind === 'dir' ? node.label : node.item.title)).toEqual([
      'Scratchpad',
      'Plans',
    ]);
  });

  it('uses the populated River folder when duplicate River roots are present', () => {
    const emptyRiver = { ...dir('River (shared)', []), id: '/external::River (shared)' };
    const populatedRiver = dir('River (shared)', [file('Shared note', 10)]);
    const result = splitRiverShortcutNode([
      emptyRiver,
      dir('scratchpad'),
      populatedRiver,
    ]);

    expect(result.riverShortcutNode?.id).toBe('/wiki::River (shared)');
    expect(result.riverShortcutNode?.children).toHaveLength(1);
    expect(result.visibleRoots.map((node) => node.kind === 'dir' ? node.label : node.item.title)).toEqual([
      'Scratchpad',
    ]);
  });

  it('normalizes River shared source paths without changing document titles', () => {
    expect(normalizeRiverSharedSourcePath('Commands/brief.md')).toBe('commands/brief');
    const localBrief = file('brief', 10);
    const sharedBrief = file('brief AM', 20);
    if (localBrief.kind !== 'file' || sharedBrief.kind !== 'file') throw new Error('expected file nodes');
    localBrief.item.relPath = 'Commands/brief';
    sharedBrief.item.sharedOriginalSourcePath = 'Commands/brief.md';
    sharedBrief.item.sharedAuthorCallsign = 'afar';

    const annotated = annotateRiverSharedItems([
      dir('Commands', [localBrief]),
      dir('River (shared)', [sharedBrief]),
    ], collectRiverSharedSourceCallsigns([
      dir('River (shared)', [sharedBrief]),
    ]));
    const commands = annotated[0];
    if (commands.kind !== 'dir') throw new Error('expected commands dir');
    const item = commands.children[0];
    if (item.kind !== 'file') throw new Error('expected local brief file');

    expect(item.item.title).toBe('brief');
    expect(item.item.sharedRiverCallsign).toBe('afar');
  });

  it('does not mark local River shares from initials-only cache metadata', () => {
    const localBrief = file('brief', 10);
    const sharedBrief = file('brief AM', 20);
    if (localBrief.kind !== 'file' || sharedBrief.kind !== 'file') throw new Error('expected file nodes');
    localBrief.item.relPath = 'Commands/brief';
    sharedBrief.item.sharedOriginalSourcePath = 'Commands/brief.md';

    const callsigns = collectRiverSharedSourceCallsigns([dir('River (shared)', [sharedBrief])]);
    const annotated = annotateRiverSharedItems([dir('Commands', [localBrief])], callsigns);
    const commands = annotated[0];
    if (commands.kind !== 'dir') throw new Error('expected commands dir');
    const item = commands.children[0];
    if (item.kind !== 'file') throw new Error('expected local brief file');

    expect(item.item.sharedRiverCallsign).toBeUndefined();
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
  });

  it('keeps pinned nested folders inside their parent directory', () => {
    const pinned = new Set(['/wiki::z-parent/z-pinned']);
    const result = applyPinnedSidebarOrder([
      dir('a-root'),
      dir('z-parent', [
        dir('z-parent/z-pinned', [
          file('Nested file', 5),
        ]),
        dir('z-parent/a-notes'),
      ]),
    ], 'alpha', pinned);

    expect(result.map((node) => node.kind === 'dir' ? node.label : node.item.title)).toEqual([
      'A-root',
      'Z-parent',
    ]);

    const parent = result.find((node) => node.kind === 'dir' && node.name === 'z-parent');
    expect(parent?.kind === 'dir' ? parent.children.map((node) => node.kind === 'dir' ? node.label : node.item.title) : []).toEqual([
      'Z-parent/z-pinned',
      'Z-parent/a-notes',
    ]);
  });

  it('only makes top-level folder headers sticky in the left nav', () => {
    expect(getSidebarFolderHeaderPositionStyle(0)).toEqual({ position: 'sticky', top: 0, zIndex: 3 });
    expect(getSidebarFolderHeaderPositionStyle(1)).toEqual({});
  });

  it('only shows the folder fade after a top-level folder header is pinned', () => {
    expect(isSidebarFolderHeaderPinned(0, 0, 0)).toBe(false);
    expect(isSidebarFolderHeaderPinned(0, 24, 24)).toBe(false);
    expect(isSidebarFolderHeaderPinned(0, 0, -24)).toBe(true);
    expect(isSidebarFolderHeaderPinned(0, 18, -24)).toBe(false);

    expect(shouldShowSidebarPinnedFolderFade(0, true, false)).toBe(false);
    expect(shouldShowSidebarPinnedFolderFade(0, true, true)).toBe(true);
    expect(shouldShowSidebarPinnedFolderFade(0, false, true)).toBe(false);
    expect(shouldShowSidebarPinnedFolderFade(1, true, true)).toBe(false);
  });

  it('keeps sidebar dividers from shrinking away when the nav overflows', () => {
    expect(getSidebarDividerStyle(false)).toMatchObject({
      height: '1px',
      flexShrink: 0,
    });
  });

  it('allows the Librarian Artifacts root to be unpinned', () => {
    const unpinned = toggleSidebarPinnedItemIds(new Set(['artifacts']), 'artifacts');

    expect(unpinned.has('artifacts')).toBe(false);
    expect(toggleSidebarPinnedItemIds(unpinned, 'artifacts').has('artifacts')).toBe(true);
  });

  it('allows Ember to be pinned and unpinned like other sidebar shortcuts', () => {
    const pinned = toggleSidebarPinnedItemIds(new Set(), EMBER_ITEM_ID);

    expect(pinned.has(EMBER_ITEM_ID)).toBe(true);
    expect(toggleSidebarPinnedItemIds(pinned, EMBER_ITEM_ID).has(EMBER_ITEM_ID)).toBe(false);
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
      'bookmarks:root',
      'entries',
    ]);
    expect(result.some((node) => node.kind === 'dir' && node.label === 'Bookmarks from x.com')).toBe(false);
    const bookmarksNode = result.find((node) => node.id === 'bookmarks:root');
    expect(bookmarksNode?.kind).toBe('file');
    if (bookmarksNode?.kind !== 'file') return;
    expect(bookmarksNode.item).toMatchObject({ title: 'Bookmarks', type: 'bookmarks' });
    expect(result.some((node) => node.kind === 'dir' && node.name === 'categories')).toBe(false);
  });

  it('renders the raw bookmarks-from-x folder as the bookmarks action', () => {
    const nodes = [dir('entries'), dir('bookmarks-from-x'), dir('domains')];
    const result = virtualizeBookmarksGroup(nodes, root);
    expect(result.map((node) => node.kind === 'dir' ? node.name : node.id)).toEqual([
      'bookmarks:root',
      'entries',
    ]);
    expect(result.some((node) => node.kind === 'dir' && node.name === 'bookmarks-from-x')).toBe(false);
  });

  it('renders a real bookmarks data folder as the bookmarks action', () => {
    const nodes = [dir('entries'), dir('bookmarks', [file('Saved bookmark', 1)])];
    const result = virtualizeBookmarksGroup(nodes, root);
    expect(result.map((node) => node.kind === 'dir' ? node.name : node.id)).toEqual([
      'bookmarks:root',
      'entries',
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

  it('builds ancestor ids for explicit sidebar reveal actions', () => {
    expect(getWikiSidebarExpansionIds('/wiki', 'scratchpad/meetings/team-notes')).toEqual([
      'root:/wiki',
      '/wiki::scratchpad',
      '/wiki::scratchpad/meetings',
    ]);
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
    const out = splitRecent(entries);
    expect(out.entries.map((e) => e.path)).toEqual(['a', 'x', 'b']);
    expect(out.total).toBe(3);
  });

  it('shows a compact parent label for recent entries', () => {
    expect(getRecentEntryParentLabel({
      kind: 'wiki',
      path: 'scratchpad/meetings/team-notes',
    })).toBe('scratchpad / meetings');
    expect(getRecentEntryParentLabel({
      kind: 'external',
      path: '/Users/afar/.fieldtheory/library/Plans/Plan.md',
    })).toBe('Plans');
  });

  it('formats recent parent paths with spaced slash separators', () => {
    expect(getRecentEntryParentPath({
      kind: 'wiki',
      path: 'scratchpad/meetings/team-notes',
    })).toBe('/ scratchpad / meetings');
    expect(getRecentEntryParentPath({
      kind: 'external',
      path: '/Users/afar/.fieldtheory/library/Plans/Plan.md',
    })).toBe('/ Plans');
  });

  it('caps the combined list to seven sidebar items', () => {
    const entries = Array.from({ length: 14 }, (_, i) => make(i % 2 === 0 ? 'wiki' : 'external', `r${i}`));
    const out = splitRecent(entries);
    expect(out.entries).toHaveLength(7);
    expect(out.total).toBe(14);
    expect(out.entries.map((e) => e.path).at(-1)).toBe('r6');
  });

  it('splits pinned recents without changing their relative order', () => {
    const entries = [make('wiki', 'a'), make('external', '/tmp/x.md'), make('wiki', 'b')];
    expect(getRecentEntrySidebarId(entries[1])).toBe('external:/tmp/x.md');
    const result = splitPinnedRecentEntries(entries, new Set(['external:/tmp/x.md', 'wiki:b']));
    expect(result.pinned.map((entry) => entry.path)).toEqual(['/tmp/x.md', 'b']);
    expect(result.unpinned.map((entry) => entry.path)).toEqual(['a']);
  });

  it('builds inverse transform keyframes when recent rows move', () => {
    expect(getRecentRowMoveKeyframes(120, 92)).toEqual([
      { transform: 'translateY(28px)' },
      { transform: 'translateY(0)' },
    ]);
    expect(getRecentRowMoveKeyframes(92, 120)).toEqual([
      { transform: 'translateY(-28px)' },
      { transform: 'translateY(0)' },
    ]);
  });

  it('skips recent row animation for stationary rows', () => {
    expect(getRecentRowMoveKeyframes(120, 120.5)).toBeNull();
  });
});

describe('sidebar icon colors', () => {
  it('uses the fallback before a color is chosen and resolves selected colors', () => {
    expect(getLibrarySidebarIconColor(undefined, '#8a8a8a')).toBe('#8a8a8a');
    expect(getLibrarySidebarIconColor(0, '#111111')).toBe('#8a8a8a');
    expect(getLibrarySidebarIconColor(7, '#8a8a8a')).toBe(getLibrarySidebarIconColor(0, '#8a8a8a'));
  });

  it('normalizes and reorders the icon color order', () => {
    expect(normalizeLibrarySidebarIconColorOrder([2, 2, 99, 1]).slice(0, 3)).toEqual([2, 1, 0]);
    expect(reorderLibrarySidebarIconColorOrder([0, 1, 2, 3], 0, 2)).toEqual([1, 2, 0, 3]);
  });

  it('keeps color drag target changes thresholded by row height', () => {
    expect(getSidebarIconColorDragTargetIndex(2, 100, 112, 28, 7)).toBe(2);
    expect(getSidebarIconColorDragTargetIndex(2, 100, 115, 28, 7)).toBe(3);
    expect(getSidebarIconColorDragTargetIndex(2, 100, 61, 28, 7)).toBe(1);
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
