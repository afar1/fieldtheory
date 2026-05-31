import { describe, expect, it, vi } from 'vitest';
import { Compartment, EditorSelection, EditorState, Transaction } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import { history, undo } from '@codemirror/commands';
import {
  MARKDOWN_CODE_EDITOR_CHECKED_TASK_LINE_CLASS,
  MARKDOWN_CODE_EDITOR_CARET_BOTTOM_ROOM_PX,
  MARKDOWN_CODE_EDITOR_FIND_MATCH_CLASS,
  MARKDOWN_CODE_EDITOR_FILE_SWAP_USER_EVENT,
  MARKDOWN_CODE_EDITOR_SELECTED_LINE_NUMBER_CLASS,
  RENDERED_MARKDOWN_EDITOR_TIMING_EVENT,
  RENDERED_MARKDOWN_EDITOR_CODE_CLASS,
  RENDERED_MARKDOWN_EDITOR_CODE_BLOCK_CLASS,
  RENDERED_MARKDOWN_EDITOR_CODE_BLOCK_END_CLASS,
  RENDERED_MARKDOWN_EDITOR_CODE_BLOCK_START_CLASS,
  RENDERED_MARKDOWN_EDITOR_CODE_FENCE_CLASS,
  RENDERED_MARKDOWN_EDITOR_CODE_FENCE_MARKER_CLASS,
  RENDERED_MARKDOWN_EDITOR_EMPHASIS_CLASS,
  RENDERED_MARKDOWN_EDITOR_DRAWING_IMAGE_CLASS,
  RENDERED_MARKDOWN_EDITOR_IMAGE_ALT_ATTR,
  RENDERED_MARKDOWN_EDITOR_HEADING_CLASS,
  RENDERED_MARKDOWN_EDITOR_HEADING_MARKER_CLASS,
  RENDERED_MARKDOWN_EDITOR_IMAGE_CLASS,
  RENDERED_MARKDOWN_EDITOR_IMAGE_CAPTION_CLASS,
  RENDERED_MARKDOWN_EDITOR_IMAGE_CAPTION_TEXT_CLASS,
  RENDERED_MARKDOWN_EDITOR_IMAGE_EDIT_CLASS,
  RENDERED_MARKDOWN_EDITOR_IMAGE_FRAME_CLASS,
  RENDERED_MARKDOWN_EDITOR_IMAGE_LINE_CLASS,
  RENDERED_MARKDOWN_EDITOR_IMAGE_SRC_ATTR,
  RENDERED_MARKDOWN_EDITOR_INLINE_HTML_CLASS,
  RENDERED_MARKDOWN_EDITOR_INLINE_HTML_EXPANDED_CLASS,
  RENDERED_MARKDOWN_EDITOR_STRIKE_CLASS,
  RENDERED_MARKDOWN_EDITOR_LINK_CLASS,
  RENDERED_MARKDOWN_EDITOR_LIST_BODY_CLASS,
  RENDERED_MARKDOWN_EDITOR_LIST_EMPTY_BODY_CLASS,
  RENDERED_MARKDOWN_EDITOR_LIST_LINE_CLASS,
  RENDERED_MARKDOWN_EDITOR_LIST_MARKER_CLASS,
  RENDERED_MARKDOWN_EDITOR_QUOTE_LINE_CLASS,
  RENDERED_MARKDOWN_EDITOR_QUOTE_MARKER_CLASS,
  RENDERED_MARKDOWN_EDITOR_SOURCE_FROM_ATTR,
  RENDERED_MARKDOWN_EDITOR_SOURCE_TO_ATTR,
  RENDERED_MARKDOWN_EDITOR_STRONG_CLASS,
  RENDERED_MARKDOWN_EDITOR_TASK_MARKER_CLASS,
  RENDERED_MARKDOWN_EDITOR_UNDERLINE_CLASS,
  RENDERED_MARKDOWN_EDITOR_WIKI_LINK_CLASS,
  RENDERED_MARKDOWN_EDITOR_WIKI_SYNTAX_CLASS,
  buildRenderedMarkdownEditorDecorations,
  buildRenderedMarkdownEditorDecorationsForRanges,
  checkedMarkdownTaskLineExtension,
  countVisualLineRowsFromClientRects,
  createRenderedMarkdownEditorPresentationExtension,
  doesBrowserSelectionIntersectElement,
  renderedMarkdownEditorPresentationExtension,
  selectedLineNumberGutterExtension,
  dispatchMarkdownCodeEditorFileSwap,
  getMarkdownCodeEditorBottomRoom,
  getMarkdownCodeEditorContentAttributes,
  getMarkdownCodeEditorCursorAnimationStyle,
  getMarkdownCodeEditorFindMatchRanges,
  getMarkdownCodeEditorSelectionBackground,
  getMarkdownCodeEditorSelectionDrawConfig,
  getMarkdownCodeEditorCursorShapeStyle,
  getMarkdownCodeEditorCursorScrollMargin,
  getMarkdownCodeEditorSelectionSnapshot,
  getMarkdownCodeEditorSelectionWithoutTrailingLineStart,
  getMarkdownCodeEditorSourcePosition,
  getVisualLineRowTopsFromLineBox,
  getMarkdownListArrowRightBoundaryEdit,
  getMarkdownListMarkerProtectedDeleteBackwardEdit,
  hasMarkdownCodeEditorRangeSelection,
  getRenderedMarkdownImageSelectionFromEventTarget,
  getRenderedMarkdownImagePreviewFromEventTarget,
  getRenderedMarkdownInlineHtmlBlocks,
  getRenderedMarkdownInlineHtmlSelectionFromEventTarget,
  isRenderedMarkdownSelectionInsideInlineHtmlBlock,
  getRenderedMarkdownDrawingTitle,
  isRenderedMarkdownDrawingAlt,
  replaceMarkdownImageAltAtSource,
  getRenderedMarkdownArrowLeftEdit,
  getRenderedMarkdownOptionArrowEdit,
  getRenderedMarkdownArrowRightEdit,
  getRenderedMarkdownSelectionInsideListBody,
  getRenderedMarkdownFormattingBoundaryLineBreakEdit,
  getRenderedMarkdownBlockBodyClickPosition,
  getRenderedMarkdownBlockBodyStart,
  getRenderedMarkdownBlockBodyStartForLine,
  getRenderedMarkdownListBodyClickPosition,
  getRenderedMarkdownListBodyStart,
  getRenderedMarkdownListBodyStartForLine,
  getRenderedMarkdownListIndentStyle,
  getRenderedMarkdownListLineLayoutStyle,
  getRenderedMarkdownListMarkerLayoutStyle,
  getRenderedMarkdownTaskMarkerLayoutStyle,
  getRenderedMarkdownCommandArrowSelection,
  getRenderedMarkdownVerticalNavigationEdit,
  handleRenderedMarkdownEditorBeforeInput,
  handleRenderedMarkdownEditorArrowLeft,
  handleMarkdownCodeEditorListArrowRight,
  handleMarkdownCodeEditorListCommandArrowLeft,
  handleMarkdownCodeEditorCommandBackspace,
  handleRenderedMarkdownEditorCommandArrow,
  handleRenderedMarkdownEditorKeyDown,
  handleMarkdownCodeEditorCapturedKeyDown,
  isMarkdownCodeEditorFileSwapUpdate,
  isVisualLineNumberRowSelected,
  shouldMoveCaretToDocumentEndFromClick,
  startMarkdownCodeEditorBlankSpaceSelection,
  trailingLineStartSelectionExtension,
} from '../MarkdownCodeEditor';

describe('MarkdownCodeEditor cursor blink', () => {
  it('leaves cursor animation enabled by default', () => {
    expect(getMarkdownCodeEditorCursorAnimationStyle(true)).toEqual({});
  });

  it('removes cursor animation when blinking is disabled', () => {
    expect(getMarkdownCodeEditorCursorAnimationStyle(false)).toEqual({
      animation: 'none',
      animationName: 'none',
      animationDuration: '0s',
    });
  });

  it('sets CodeMirror cursor blink rate through the drawn selection layer', () => {
    expect(getMarkdownCodeEditorSelectionDrawConfig(true)).toEqual({ cursorBlinkRate: 1200 });
    expect(getMarkdownCodeEditorSelectionDrawConfig(false)).toEqual({ cursorBlinkRate: 0 });
  });

  it('uses a softer selection background for rendered prose', () => {
    expect(getMarkdownCodeEditorSelectionBackground(true, 'rendered')).toBe('rgba(120,170,255,0.16)');
    expect(getMarkdownCodeEditorSelectionBackground(true, 'source')).toBe('rgba(120,170,255,0.25)');
    expect(getMarkdownCodeEditorSelectionBackground(false, 'rendered', 'custom')).toBe('custom');
  });

  it('detects range selections so the drawn cursor can hide while text is selected', () => {
    const cursorState = EditorState.create({
      doc: 'selected text',
      selection: EditorSelection.cursor(0),
    });
    const rangeState = EditorState.create({
      doc: 'selected text',
      selection: EditorSelection.range(0, 8),
    });

    expect(hasMarkdownCodeEditorRangeSelection(cursorState)).toBe(false);
    expect(hasMarkdownCodeEditorRangeSelection(rangeState)).toBe(true);
  });

  it('keeps full-line selections from including the next line start', () => {
    const state = EditorState.create({
      doc: 'my name is andrew\n- ',
      selection: EditorSelection.range(0, 'my name is andrew\n'.length),
    });
    const selection = getMarkdownCodeEditorSelectionWithoutTrailingLineStart(state);

    expect(selection?.main.from).toBe(0);
    expect(selection?.main.to).toBe('my name is andrew'.length);
  });

  it('keeps paragraph selections from placing the head on the following blank line', () => {
    const paragraph = 'The manifest presents it as Field Theory,\nLibrary notes, portable commands, active document context, and saved run records.';
    const state = EditorState.create({
      doc: `${paragraph}\n\nWhat The Plugin Can Do`,
      selection: EditorSelection.range(0, `${paragraph}\n\n`.length),
    });
    const selection = getMarkdownCodeEditorSelectionWithoutTrailingLineStart(state);

    expect(selection?.main.from).toBe(0);
    expect(selection?.main.to).toBe(paragraph.length);
  });

  it('keeps paragraph selections from including trailing whitespace before the blank line', () => {
    const paragraph = 'The manifest presents it as Field Theory,\nLibrary notes, portable commands, active document context, and saved run records.';
    const state = EditorState.create({
      doc: `${paragraph}  \n\nWhat The Plugin Can Do`,
      selection: EditorSelection.range(0, `${paragraph}  \n\n`.length),
    });
    const selection = getMarkdownCodeEditorSelectionWithoutTrailingLineStart(state);

    expect(selection?.main.from).toBe(0);
    expect(selection?.main.to).toBe(paragraph.length);
  });

  it('clamps paragraph selection transactions before they render', () => {
    const paragraph = 'The manifest presents it as Field Theory,\nLibrary notes, portable commands, active document context, and saved run records.';
    const parent = document.createElement('div');
    const view = new EditorView({
      state: EditorState.create({
        doc: `${paragraph}\n\nWhat The Plugin Can Do`,
        extensions: [trailingLineStartSelectionExtension],
      }),
      parent,
    });

    view.dispatch({ selection: EditorSelection.range(0, `${paragraph}\n\n`.length) });

    expect(view.state.selection.main.from).toBe(0);
    expect(view.state.selection.main.to).toBe(paragraph.length);
    view.destroy();
  });

  it('keeps reversed full-line selections from including the next line start', () => {
    const state = EditorState.create({
      doc: 'my name is andrew\n- ',
      selection: EditorSelection.range('my name is andrew\n'.length, 0),
    });
    const selection = getMarkdownCodeEditorSelectionWithoutTrailingLineStart(state);

    expect(selection?.main.anchor).toBe('my name is andrew'.length);
    expect(selection?.main.head).toBe(0);
  });

  it('keeps reversed paragraph selections from placing the anchor on the following blank line', () => {
    const paragraph = 'The manifest presents it as Field Theory,\nLibrary notes, portable commands, active document context, and saved run records.';
    const state = EditorState.create({
      doc: `${paragraph}\n\nWhat The Plugin Can Do`,
      selection: EditorSelection.range(`${paragraph}\n\n`.length, 0),
    });
    const selection = getMarkdownCodeEditorSelectionWithoutTrailingLineStart(state);

    expect(selection?.main.anchor).toBe(paragraph.length);
    expect(selection?.main.head).toBe(0);
  });
});

describe('MarkdownCodeEditor find matches', () => {
  it('finds all case-insensitive matches for editor-owned highlighting', () => {
    expect(MARKDOWN_CODE_EDITOR_FIND_MATCH_CLASS).toBe('cm-ft-fileFindMatch');
    expect(getMarkdownCodeEditorFindMatchRanges('Alpha beta alpha', 'alpha')).toEqual([
      { from: 0, to: 5 },
      { from: 11, to: 16 },
    ]);
    expect(getMarkdownCodeEditorFindMatchRanges('Alpha', '')).toEqual([]);
  });
});

describe('MarkdownCodeEditor spellcheck attributes', () => {
  it('enables native editing spellcheck attributes when requested', () => {
    expect(getMarkdownCodeEditorContentAttributes({
      spellCheck: true,
      placeholder: 'Write here',
      dataAttributes: {
        'data-ft-agent-context': 'markdown',
        ignored: undefined,
      },
    })).toEqual({
      spellcheck: 'true',
      autocorrect: 'on',
      autocapitalize: 'sentences',
      'aria-label': 'Write here',
      'data-ft-agent-context': 'markdown',
    });
  });

  it('can explicitly disable native spellcheck attributes', () => {
    expect(getMarkdownCodeEditorContentAttributes({ spellCheck: false })).toEqual({
      spellcheck: 'false',
      autocorrect: 'off',
      autocapitalize: 'off',
    });
  });
});

describe('MarkdownCodeEditor cursor shape', () => {
  it('uses an explicit bar cursor style when requested', () => {
    expect(getMarkdownCodeEditorCursorShapeStyle('bar', '#10b981', '#111')).toEqual({
      backgroundColor: 'transparent',
      borderLeft: '1.2px solid #10b981',
      marginLeft: '-0.6px',
      minWidth: '0',
      width: '0',
    });
  });

  it('uses a translucent overlay block cursor that does not replace text', () => {
    expect(getMarkdownCodeEditorCursorShapeStyle('block', '#10b981', '#111')).toEqual({
      backgroundColor: '#10b981',
      borderLeft: 'none',
      height: '1.18em !important',
      marginLeft: '0',
      minWidth: '0.62em',
      opacity: 0.5,
      width: '0.62em',
    });
  });

  it('uses the configured block cursor opacity', () => {
    expect(getMarkdownCodeEditorCursorShapeStyle('block', '#10b981', '#111', 0.75).opacity).toBe(0.75);
  });
});

describe('MarkdownCodeEditor cursor scroll margin', () => {
  it('keeps a small bottom margin for caret movement', () => {
    expect(MARKDOWN_CODE_EDITOR_CARET_BOTTOM_ROOM_PX).toBeGreaterThan(0);
    expect(getMarkdownCodeEditorCursorScrollMargin()).toEqual({
      x: 5,
      y: MARKDOWN_CODE_EDITOR_CARET_BOTTOM_ROOM_PX,
    });
  });

  it('can remove bottom room when a caller explicitly opts out', () => {
    expect(getMarkdownCodeEditorBottomRoom(0)).toBe(0);
    expect(getMarkdownCodeEditorCursorScrollMargin(0)).toEqual({ x: 5, y: 0 });
  });
});

describe('MarkdownCodeEditor cursor telemetry', () => {
  it('reports exact source line and column for a markdown offset', () => {
    expect(getMarkdownCodeEditorSourcePosition('alpha\nbeta\ncharlie', 8)).toMatchObject({
      offset: 8,
      line: 2,
      column: 3,
      lineStart: 6,
      lineEnd: 10,
      lineLength: 4,
      before: 'be',
      after: 'ta',
    });

    expect(getMarkdownCodeEditorSourcePosition('\nfirst', 0)).toMatchObject({
      offset: 0,
      line: 1,
      column: 1,
      lineStart: 0,
    });
  });

  it('captures selection head, source position, and scroll in snapshots', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({
        doc: 'alpha\nbeta',
        selection: EditorSelection.cursor(8),
      }),
      parent,
    });

    const snapshot = getMarkdownCodeEditorSelectionSnapshot(view, {
      docChanged: true,
      inputType: 'insertText',
      inputData: 'x',
    });

    expect(snapshot).toMatchObject({
      selectionStart: 8,
      selectionEnd: 8,
      selectionHead: 8,
      selectionAnchor: 8,
      isCollapsed: true,
      docChanged: true,
      inputType: 'insertText',
      inputData: 'x',
      selectionHeadSource: {
        line: 2,
        column: 3,
        before: 'be',
        after: 'ta',
      },
      scroll: {
        top: 0,
      },
    });

    view.destroy();
    parent.remove();
  });
});

describe('MarkdownCodeEditor blank-space clicks', () => {
  const buildView = ({
    scrollTop = 0,
    clientHeight = 400,
    scrollHeight = 400,
    lastLineBottom = 120,
  }: {
    scrollTop?: number;
    clientHeight?: number;
    scrollHeight?: number;
    lastLineBottom?: number;
  } = {}) => ({
    scrollDOM: {
      scrollTop,
      clientHeight,
      scrollHeight,
    },
    contentDOM: {
      querySelector: () => ({
        getBoundingClientRect: () => ({ bottom: lastLineBottom }),
      }),
    },
  }) as unknown as EditorView;

  it('moves the caret to the document end when clicking blank space below the last line', () => {
    const event = new MouseEvent('mousedown', {
      button: 0,
      clientY: 180,
    });

    expect(shouldMoveCaretToDocumentEndFromClick(buildView(), event)).toBe(true);
  });

  it('still treats the configured bottom room as end-of-document space', () => {
    const event = new MouseEvent('mousedown', {
      button: 0,
      clientY: 180,
    });

    expect(shouldMoveCaretToDocumentEndFromClick(buildView({
      scrollHeight: 400 + MARKDOWN_CODE_EDITOR_CARET_BOTTOM_ROOM_PX,
    }), event)).toBe(true);
  });

  it('leaves normal line clicks alone', () => {
    const event = new MouseEvent('mousedown', {
      button: 0,
      clientY: 80,
    });

    expect(shouldMoveCaretToDocumentEndFromClick(buildView(), event)).toBe(false);
  });

  it('leaves blank-space clicks alone while there is more content below the viewport', () => {
    const event = new MouseEvent('mousedown', {
      button: 0,
      clientY: 180,
    });

    expect(shouldMoveCaretToDocumentEndFromClick(buildView({ scrollHeight: 800 }), event)).toBe(false);
  });

  it('extends selection from end-of-document blank space during drag', () => {
    const listeners: Partial<Record<string, (event: MouseEvent) => void>> = {};
    const dispatches: unknown[] = [];
    const ownerDocument = {
      addEventListener: (type: string, listener: EventListener) => {
        listeners[type] = listener as (event: MouseEvent) => void;
      },
      removeEventListener: (type: string) => {
        delete listeners[type];
      },
    };
    const view = {
      ...buildView(),
      state: EditorState.create({ doc: 'alpha\nlast line' }),
      dom: { ownerDocument },
      focus: vi.fn(),
      posAtCoords: vi.fn(() => 'alpha\n'.length),
      dispatch: vi.fn((spec) => dispatches.push(spec)),
    } as unknown as EditorView;

    const cleanup = startMarkdownCodeEditorBlankSpaceSelection(view, new MouseEvent('mousedown', {
      button: 0,
      clientY: 180,
    }));
    listeners.mousemove?.(new MouseEvent('mousemove', {
      clientY: 90,
      buttons: 1,
    }));
    cleanup?.();

    expect(cleanup).not.toBeNull();
    expect(dispatches).toEqual([
      expect.objectContaining({ selection: { anchor: 'alpha\nlast line'.length, head: 'alpha\nlast line'.length } }),
      { selection: { anchor: 'alpha\nlast line'.length, head: 'alpha\n'.length } },
    ]);
    expect(listeners.mousemove).toBeUndefined();
  });
});

describe('MarkdownCodeEditor checked task decorations', () => {
  it('adds the checked task class to checked source lines only', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({
        doc: '- [x] done\n- [ ] todo\n[x] bare done\n[] bare todo',
        extensions: [checkedMarkdownTaskLineExtension],
      }),
      parent,
    });

    const lines = Array.from(parent.querySelectorAll('.cm-line'));
    expect(lines).toHaveLength(4);
    expect(lines[0].classList.contains(MARKDOWN_CODE_EDITOR_CHECKED_TASK_LINE_CLASS)).toBe(true);
    expect(lines[1].classList.contains(MARKDOWN_CODE_EDITOR_CHECKED_TASK_LINE_CLASS)).toBe(false);
    expect(lines[2].classList.contains(MARKDOWN_CODE_EDITOR_CHECKED_TASK_LINE_CLASS)).toBe(true);
    expect(lines[3].classList.contains(MARKDOWN_CODE_EDITOR_CHECKED_TASK_LINE_CLASS)).toBe(false);

    view.destroy();
    parent.remove();
  });
});

describe('MarkdownCodeEditor line numbers', () => {
  it('counts distinct wrapped visual rows from line client rects', () => {
    expect(countVisualLineRowsFromClientRects([
      { top: 10, width: 120, height: 20 },
      { top: 10.4, width: 80, height: 20 },
      { top: 31, width: 100, height: 20 },
      { top: 52, width: 40, height: 20 },
    ], 20)).toBe(3);
  });

  it('only marks wrapped visual line numbers whose rows intersect selection rects', () => {
    expect(isVisualLineNumberRowSelected(10, [31], 20)).toBe(false);
    expect(isVisualLineNumberRowSelected(31.4, [31], 20)).toBe(true);
    expect(isVisualLineNumberRowSelected(52, [31], 20)).toBe(false);
  });

  it('anchors rendered line number rows to the line box top', () => {
    expect(getVisualLineRowTopsFromLineBox(100, [104, 125], 20)).toEqual([100, 120]);
    expect(getVisualLineRowTopsFromLineBox(160, [], 20)).toEqual([160]);
  });

  it('marks selected line numbers distinctly', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({
        doc: 'alpha\nbeta\ngamma',
        selection: EditorSelection.range(1, 10),
        extensions: [lineNumbers(), selectedLineNumberGutterExtension],
      }),
      parent,
    });

    const selectedLineNumbers = parent.querySelectorAll(`.${MARKDOWN_CODE_EDITOR_SELECTED_LINE_NUMBER_CLASS}`);
    expect(selectedLineNumbers.length).toBeGreaterThanOrEqual(2);

    view.destroy();
    parent.remove();
  });

  it('matches browser text selection for rendered line numbers', () => {
    const parent = document.createElement('div');
    const line = document.createElement('div');
    line.textContent = 'Rendered line';
    parent.appendChild(line);
    document.body.appendChild(parent);

    const selection = document.getSelection();
    const range = document.createRange();
    range.selectNodeContents(line);
    selection?.removeAllRanges();
    selection?.addRange(range);

    expect(doesBrowserSelectionIntersectElement(selection, line)).toBe(true);

    selection?.removeAllRanges();
    parent.remove();
  });
});

describe('MarkdownCodeEditor rendered presentation', () => {
  it('finds closed ft-html fenced blocks with stable source ranges', () => {
    const doc = 'Prose above\n\n```ft-html\n<section>Widget</section>\n```\n\nProse below';
    const state = EditorState.create({ doc });
    const [block] = getRenderedMarkdownInlineHtmlBlocks(state);

    expect(block).toMatchObject({
      from: doc.indexOf('```ft-html'),
      to: doc.indexOf('```\n\nProse below') + 3,
      content: '<section>Widget</section>',
      fromLine: 3,
      toLine: 5,
    });
  });

  it('renders ft-html fences as sandboxed inline HTML widgets in rendered mode', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const doc = 'Prose above\n\n```ft-html\n<section>Widget</section>\n```\n\nProse below';
    const view = new EditorView({
      state: EditorState.create({
        doc,
        extensions: [createRenderedMarkdownEditorPresentationExtension('/tmp/Field Theory/report.md')],
      }),
      parent,
    });

    const block = parent.querySelector(`.${RENDERED_MARKDOWN_EDITOR_INLINE_HTML_CLASS}`) as HTMLElement | null;
    const iframe = block?.querySelector('iframe[data-ft-inline-html-preview="true"]') as HTMLIFrameElement | null;
    expect(block).toBeTruthy();
    expect(block?.getAttribute(RENDERED_MARKDOWN_EDITOR_SOURCE_FROM_ATTR)).toBe(String(doc.indexOf('```ft-html')));
    expect(block?.getAttribute(RENDERED_MARKDOWN_EDITOR_SOURCE_TO_ATTR)).toBe(String(doc.indexOf('```\n\nProse below') + 3));
    expect(iframe?.getAttribute('sandbox')).toBe('');
    expect(iframe?.getAttribute('srcdoc')).toContain('<base href="file:///tmp/Field%20Theory/">');
    expect(iframe?.getAttribute('srcdoc')).toContain('<section>Widget</section>');

    const toggle = block?.querySelector('button') as HTMLButtonElement | null;
    toggle?.click();
    expect(block?.classList.contains(RENDERED_MARKDOWN_EDITOR_INLINE_HTML_EXPANDED_CLASS)).toBe(true);
    expect(toggle?.textContent).toBe('Collapse');
    toggle?.click();
    expect(block?.classList.contains(RENDERED_MARKDOWN_EDITOR_INLINE_HTML_EXPANDED_CLASS)).toBe(false);
    expect(toggle?.textContent).toBe('Expand');

    view.destroy();
    parent.remove();
  });

  it('treats rendered ft-html widgets as atomic editor selections', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const doc = 'Prose above\n\n```ft-html\n<section>Widget</section>\n```\n\nProse below';
    const view = new EditorView({
      state: EditorState.create({
        doc,
        extensions: [createRenderedMarkdownEditorPresentationExtension('/tmp/Field Theory/report.md')],
      }),
      parent,
    });

    const block = parent.querySelector(`.${RENDERED_MARKDOWN_EDITOR_INLINE_HTML_CLASS}`) as HTMLElement | null;
    const selection = getRenderedMarkdownInlineHtmlSelectionFromEventTarget(block?.querySelector('iframe') ?? null);
    expect(selection).toEqual({
      from: doc.indexOf('```ft-html'),
      to: doc.indexOf('```\n\nProse below') + 3,
    });
    expect(isRenderedMarkdownSelectionInsideInlineHtmlBlock(doc, selection!.from + 12, selection!.from + 12)).toBe(true);
    expect(isRenderedMarkdownSelectionInsideInlineHtmlBlock(doc, selection!.from, selection!.to)).toBe(true);
    expect(isRenderedMarkdownSelectionInsideInlineHtmlBlock(doc, selection!.from, selection!.from)).toBe(false);
    expect(isRenderedMarkdownSelectionInsideInlineHtmlBlock(doc, selection!.to, selection!.to)).toBe(false);

    view.destroy();
    parent.remove();
  });

  it('allows typing immediately before and after rendered ft-html widgets, but not into the widget', () => {
    const doc = 'Prose above\n\n```ft-html\n<section>Widget</section>\n```\n\nProse below';
    const blockFrom = doc.indexOf('```ft-html');
    const blockTo = doc.indexOf('```\n\nProse below') + 3;
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({
        doc,
        extensions: [createRenderedMarkdownEditorPresentationExtension('/tmp/Field Theory/report.md')],
      }),
      parent,
    });

    view.dispatch({ selection: EditorSelection.cursor(blockFrom) });
    expect(handleRenderedMarkdownEditorBeforeInput(view, new InputEvent('beforeinput', {
      inputType: 'insertText',
      data: 'before ',
    }))).toBe(true);
    expect(view.state.doc.toString()).toContain('Prose above\n\nbefore \n\n```ft-html');

    const nextBlockFrom = view.state.doc.toString().indexOf('```ft-html');
    const nextBlockTo = view.state.doc.toString().indexOf('```\n\nProse below') + 3;
    view.dispatch({ selection: EditorSelection.range(nextBlockFrom, nextBlockTo) });
    expect(handleRenderedMarkdownEditorBeforeInput(view, new InputEvent('beforeinput', {
      inputType: 'insertText',
      data: 'x',
    }))).toBe(true);
    expect(view.state.doc.toString()).toContain('before \n\n```ft-html\n<section>Widget</section>');

    view.dispatch({ selection: EditorSelection.cursor(nextBlockTo) });
    expect(handleRenderedMarkdownEditorBeforeInput(view, new InputEvent('beforeinput', {
      inputType: 'insertText',
      data: 'after ',
    }))).toBe(true);
    expect(view.state.doc.toString()).toContain('```\n\nafter Prose below');

    view.destroy();
    parent.remove();
  });

  it('emits debug-gated timing entries for rendered decoration work', () => {
    const originalLocalStorage = window.localStorage;
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: vi.fn((key: string) => (
          key === 'fieldtheory-rendered-editor-debug' ? 'true' : null
        )),
      },
    });
    const timings: Array<Record<string, unknown>> = [];
    const handleTiming = (event: Event) => {
      if (event instanceof CustomEvent) timings.push(event.detail);
    };
    window.addEventListener(RENDERED_MARKDOWN_EDITOR_TIMING_EVENT, handleTiming);

    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({
        doc: Array.from({ length: 200 }, (_, index) => (
          index % 5 === 0
            ? `- [ ] task ${index} with **bold** and [[Wiki Target ${index}]]`
            : `Paragraph ${index} with [a link](https://example.com/${index}) and *emphasis*.`
        )).join('\n'),
        extensions: [
          checkedMarkdownTaskLineExtension,
          createRenderedMarkdownEditorPresentationExtension(),
        ],
      }),
      parent,
    });

    view.dispatch({
      changes: { from: view.state.doc.length, insert: '\nnew paragraph' },
      selection: { anchor: view.state.doc.length + '\nnew paragraph'.length },
      annotations: Transaction.userEvent.of('input.type'),
    });

    expect(timings.some((entry) => entry.stage === 'rendered-decorations-update')).toBe(true);
    expect(timings.some((entry) => entry.stage === 'code-editor-checked-task-decorations')).toBe(true);
    expect(timings.every((entry) => typeof entry.durationMs === 'number')).toBe(true);

    view.destroy();
    parent.remove();
    window.removeEventListener(RENDERED_MARKDOWN_EDITOR_TIMING_EVENT, handleTiming);
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: originalLocalStorage,
    });
  });

  it('inserts Enter before a rendered bold span so the word keeps its styling markers', () => {
    expect(getRenderedMarkdownFormattingBoundaryLineBreakEdit('**bold**', 2)).toEqual({
      insertAt: 0,
      selection: 0,
    });
  });

  it('skips hidden rendered inline syntax when arrowing right', () => {
    const boldLine = '**Software commission**\n- Total';
    const boldContentEnd = 2 + 'Software commission'.length;
    expect(getRenderedMarkdownArrowRightEdit(boldLine, boldContentEnd)).toEqual({
      selection: '**Software commission**\n'.length,
    });
    expect(getRenderedMarkdownArrowRightEdit(boldLine, boldContentEnd + 1)).toEqual({
      selection: '**Software commission**\n'.length,
    });
    expect(getRenderedMarkdownArrowRightEdit('**bold** tail', 6)).toEqual({
      selection: 8,
    });
    expect(getRenderedMarkdownArrowRightEdit('See [Guide](wiki://guide) next', 10)).toEqual({
      selection: 25,
    });
    expect(getRenderedMarkdownArrowRightEdit('[[Target|Alias]] next', 15)).toBeNull();
  });

  it('moves ArrowRight from rendered bold line end to the next line', () => {
    const doc = '**Software commission**\n- Total';
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const contentEnd = 2 + 'Software commission'.length;
    const view = new EditorView({
      state: EditorState.create({
        doc,
        selection: EditorSelection.cursor(contentEnd),
        extensions: [renderedMarkdownEditorPresentationExtension],
      }),
      parent,
    });

    const handled = handleRenderedMarkdownEditorKeyDown(view, new KeyboardEvent('keydown', { key: 'ArrowRight' }));

    expect(handled).toBe(true);
    expect(view.state.selection.main.from).toBe('**Software commission**\n'.length);
    expect(parent.querySelector('.cm-content')?.textContent).not.toContain('**');

    view.destroy();
    parent.remove();
  });

  it('skips hidden rendered inline opening syntax when arrowing left', () => {
    expect(getRenderedMarkdownArrowLeftEdit('**Deal value**', 2)).toEqual({
      selection: 0,
    });
    expect(getRenderedMarkdownArrowLeftEdit('**Deal value**', 1)).toEqual({
      selection: 0,
    });
    expect(getRenderedMarkdownArrowLeftEdit('See **Deal value**', 6)).toEqual({
      selection: 4,
    });
    expect(getRenderedMarkdownArrowLeftEdit('See [Guide](wiki://guide)', 5)).toEqual({
      selection: 4,
    });
    expect(getRenderedMarkdownArrowLeftEdit('See [[Target|Alias]]', 13)).toBeNull();
  });

  it('uses Option+Arrow to jump rendered inline units without entering syntax', () => {
    expect(getRenderedMarkdownOptionArrowEdit('See [[Target|Alias]] today', 4, 'right')).toEqual({
      selection: 20,
    });
    expect(getRenderedMarkdownOptionArrowEdit('See [[Target|Alias]] today', 20, 'left')).toEqual({
      selection: 4,
    });
    expect(getRenderedMarkdownOptionArrowEdit('See **Deal value** today', 4, 'right')).toEqual({
      selection: 18,
    });
    expect(getRenderedMarkdownOptionArrowEdit('See **Deal value** today', 18, 'left')).toEqual({
      selection: 4,
    });
  });

  it('keeps ArrowLeft from rendered bold text out of source syntax', () => {
    const doc = '**Deal value**';
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({
        doc,
        selection: EditorSelection.cursor(2),
        extensions: [renderedMarkdownEditorPresentationExtension],
      }),
      parent,
    });

    const handled = handleRenderedMarkdownEditorArrowLeft(view);

    expect(handled).toBe(true);
    expect(view.state.selection.main.from).toBe(0);
    expect(parent.querySelector('.cm-content')?.textContent).not.toContain('**');

    view.destroy();
    parent.remove();
  });

  it('does not reveal wiki syntax for non-collapsed rendered selections', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const doc = 'See [[First Page|first]] today';
    const view = new EditorView({
      state: EditorState.create({
        doc,
        selection: EditorSelection.range(4, doc.indexOf('today') - 1),
        extensions: [renderedMarkdownEditorPresentationExtension],
      }),
      parent,
    });

    expect(parent.querySelector('.cm-content')?.textContent).toContain('first');
    expect(parent.querySelector('.cm-content')?.textContent).not.toContain('[[First Page');

    view.destroy();
    parent.remove();
  });

  it('moves rendered Command+Arrow to visual line boundaries', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({
        doc: 'alpha beta',
        selection: EditorSelection.cursor(5),
        extensions: [renderedMarkdownEditorPresentationExtension],
      }),
      parent,
    });

    expect(handleRenderedMarkdownEditorCommandArrow(view, 'left')).toBe(true);
    expect(view.state.selection.main.from).toBe(0);
    view.dispatch({ selection: EditorSelection.cursor(5) });
    expect(handleRenderedMarkdownEditorCommandArrow(view, 'right')).toBe(true);
    expect(view.state.selection.main.from).toBe('alpha beta'.length);

    view.destroy();
    parent.remove();
  });

  it('keeps rendered list line starts at the first editable character', () => {
    const doc = '- first\n- second\n- ';
    expect(getRenderedMarkdownListBodyStartForLine(doc, 0)).toBe(2);
    expect(getRenderedMarkdownListBodyStartForLine(doc, '- first\n'.length)).toBe('- first\n- '.length);
    const markerState = EditorState.create({
      doc,
      selection: EditorSelection.cursor('- first\n'.length),
    });
    const bodySelection = getRenderedMarkdownSelectionInsideListBody(markerState);
    expect(bodySelection?.main.from).toBe('- first\n- '.length);
    expect(getRenderedMarkdownCommandArrowSelection(doc, 0, 'left')).toBe(2);
    expect(getRenderedMarkdownVerticalNavigationEdit(doc, '- first\n'.length)).toEqual({
      selection: '- first\n- '.length,
    });
    expect(getRenderedMarkdownVerticalNavigationEdit(doc, doc.length - 2)).toEqual({
      selection: doc.length,
    });
    expect(getRenderedMarkdownArrowRightEdit(doc, '- first'.length)).toEqual({
      selection: '- first\n- '.length,
    });
  });

  it('moves rendered Command+Left to the list body instead of the hidden marker', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({
        doc: '- first item',
        selection: EditorSelection.cursor('- first'.length),
        extensions: [renderedMarkdownEditorPresentationExtension],
      }),
      parent,
    });

    expect(handleRenderedMarkdownEditorCommandArrow(view, 'left')).toBe(true);
    expect(view.state.selection.main.from).toBe(2);
    expect(handleRenderedMarkdownEditorCommandArrow(view, 'left')).toBe(true);
    expect(view.state.selection.main.from).toBe(2);

    view.destroy();
    parent.remove();
  });

  it('keeps rendered heading and quote prefixes out of the editing caret path', () => {
    const doc = '# Resolved\n> Quoted';
    const quoteLineStart = '# Resolved\n'.length;

    expect(getRenderedMarkdownBlockBodyStartForLine(doc, 0)).toBe(2);
    expect(getRenderedMarkdownBlockBodyStartForLine(doc, quoteLineStart)).toBe(quoteLineStart + 2);
    expect(getRenderedMarkdownBlockBodyStart(doc, 0)).toBe(2);
    expect(getRenderedMarkdownBlockBodyStart(doc, quoteLineStart)).toBe(quoteLineStart + 2);
    expect(getRenderedMarkdownArrowRightEdit(doc, 0)).toEqual({ selection: 2 });
    expect(getRenderedMarkdownArrowRightEdit(doc, '# Resolved'.length)).toEqual({
      selection: quoteLineStart + 2,
    });
    expect(getRenderedMarkdownArrowLeftEdit(doc, 2)).toEqual({ selection: 2 });
    expect(getRenderedMarkdownCommandArrowSelection(doc, 0, 'left')).toBe(2);
    expect(getRenderedMarkdownVerticalNavigationEdit(doc, quoteLineStart)).toEqual({
      selection: quoteLineStart + 2,
    });
  });

  it('preserves list markers on Command+Backspace', () => {
    expect(getMarkdownListMarkerProtectedDeleteBackwardEdit('- first item', '- first item'.length)).toEqual({
      from: 2,
      to: '- first item'.length,
      selection: 2,
    });

    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({
        doc: '- first item',
        selection: EditorSelection.cursor('- first item'.length),
      }),
      parent,
    });

    expect(handleMarkdownCodeEditorCommandBackspace(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('- ');
    expect(view.state.selection.main.from).toBe(2);

    view.destroy();
    parent.remove();
  });

  it('applies list body navigation in source mode too', () => {
    const doc = '- first\n- second';
    expect(getMarkdownListArrowRightBoundaryEdit(doc, '- first'.length)).toEqual({
      selection: '- first\n- '.length,
    });

    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({
        doc,
        selection: EditorSelection.cursor('- first'.length),
      }),
      parent,
    });

    expect(handleMarkdownCodeEditorListArrowRight(view)).toBe(true);
    expect(view.state.selection.main.from).toBe('- first\n- '.length);
    expect(handleMarkdownCodeEditorListCommandArrowLeft(view)).toBe(true);
    expect(view.state.selection.main.from).toBe('- first\n- '.length);

    view.destroy();
    parent.remove();
  });

	  it('hides common markdown syntax behind styled editable text', () => {
	    const parent = document.createElement('div');
	    document.body.appendChild(parent);
    const doc = '# Title\n\nHello **bold** *em* `code` [Link](wiki://target) [[Wiki Page|wiki link]] [[Other]] <u>under</u> ~~gone~~ ![Figure](<file:///tmp/Figure%201.png>)\n- [x] done';
    const view = new EditorView({
      state: EditorState.create({
        doc,
        extensions: [renderedMarkdownEditorPresentationExtension],
      }),
      parent,
    });

    const content = parent.querySelector('.cm-content');
    expect(content?.textContent).toContain('Title');
    expect(content?.textContent).toContain('Hello bold em code Link wiki link Other under gone');
    expect(content?.textContent).not.toContain('#');
    expect(content?.textContent).not.toContain('**');
    expect(content?.textContent).not.toContain('wiki://target');
    expect(content?.textContent).not.toContain('[[Wiki Page');
    expect(content?.textContent).not.toContain('<u>');
    expect(content?.textContent).not.toContain('~~');
    expect(content?.textContent).not.toContain('file:///tmp/Figure');
    expect(parent.querySelector(`.${RENDERED_MARKDOWN_EDITOR_HEADING_CLASS}-1`)?.textContent).toBe('Title');
    expect(parent.querySelector(`.${RENDERED_MARKDOWN_EDITOR_HEADING_MARKER_CLASS}`)?.getAttribute(RENDERED_MARKDOWN_EDITOR_SOURCE_FROM_ATTR)).toBe('0');
    expect(parent.querySelector(`.${RENDERED_MARKDOWN_EDITOR_HEADING_MARKER_CLASS}`)?.getAttribute(RENDERED_MARKDOWN_EDITOR_SOURCE_TO_ATTR)).toBe('2');
    expect(parent.querySelector(`.${RENDERED_MARKDOWN_EDITOR_STRONG_CLASS}`)?.textContent).toBe('bold');
    expect(parent.querySelector(`.${RENDERED_MARKDOWN_EDITOR_EMPHASIS_CLASS}`)?.textContent).toBe('em');
    expect(parent.querySelector(`.${RENDERED_MARKDOWN_EDITOR_CODE_CLASS}`)?.textContent).toBe('code');
    const links = Array.from(parent.querySelectorAll(`.${RENDERED_MARKDOWN_EDITOR_LINK_CLASS}`));
    expect(links.map((link) => link.textContent)).toEqual(['Link', 'wiki link', 'Other']);
    const wikiLinkStart = doc.indexOf('[[Wiki Page');
    expect(links[1].getAttribute(RENDERED_MARKDOWN_EDITOR_SOURCE_FROM_ATTR)).toBe(String(wikiLinkStart));
    expect(links[1].getAttribute(RENDERED_MARKDOWN_EDITOR_SOURCE_TO_ATTR)).toBe(String(wikiLinkStart + '[[Wiki Page|wiki link]]'.length));
    expect(parent.querySelector(`.${RENDERED_MARKDOWN_EDITOR_UNDERLINE_CLASS}`)?.textContent).toBe('under');
    expect(parent.querySelector(`.${RENDERED_MARKDOWN_EDITOR_STRIKE_CLASS}`)?.textContent).toBe('gone');
    const renderedImage = parent.querySelector(`.${RENDERED_MARKDOWN_EDITOR_IMAGE_CLASS}`) as HTMLElement | null;
    const renderedImageImg = renderedImage?.querySelector('img') ?? null;
    const renderedImageCaption = renderedImage?.querySelector(`.${RENDERED_MARKDOWN_EDITOR_IMAGE_CAPTION_CLASS}`) ?? null;
    expect(renderedImage?.getAttribute(RENDERED_MARKDOWN_EDITOR_IMAGE_SRC_ATTR)).toBe('ftlocalfile:///tmp/Figure%201.png');
    expect(renderedImage?.getAttribute(RENDERED_MARKDOWN_EDITOR_IMAGE_ALT_ATTR)).toBe('Figure');
    expect(renderedImage?.getAttribute('role')).toBe('button');
    expect(renderedImageImg?.getAttribute('src')).toBe('ftlocalfile:///tmp/Figure%201.png');
    expect(renderedImageCaption?.textContent).toBe('Figure');
    expect(renderedImageImg?.nextElementSibling).toBe(renderedImageCaption);
    expect(getRenderedMarkdownImagePreviewFromEventTarget(renderedImageImg)).toMatchObject({
      src: 'ftlocalfile:///tmp/Figure%201.png',
      alt: 'Figure',
      sourceFrom: doc.indexOf('![Figure]'),
      sourceTo: doc.indexOf('![Figure]') + '![Figure](<file:///tmp/Figure%201.png>)'.length,
    });
    expect(getRenderedMarkdownImagePreviewFromEventTarget(renderedImage)).toBeNull();
    expect(getRenderedMarkdownImageSelectionFromEventTarget(renderedImage)).toEqual({
      from: doc.indexOf('![Figure]'),
      to: doc.indexOf('![Figure]') + '![Figure](<file:///tmp/Figure%201.png>)'.length,
    });
    expect((parent.querySelector(`.${RENDERED_MARKDOWN_EDITOR_TASK_MARKER_CLASS}`) as HTMLInputElement | null)?.checked).toBe(true);

	    view.destroy();
	    parent.remove();
	  });

  it('renders relative image links from the markdown document path', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({
        doc: '![Reference](<./Team%20Notes.assets/Screenshot%201.png>)',
        extensions: [createRenderedMarkdownEditorPresentationExtension('/Users/afar/Google Drive/Team Notes.md')],
      }),
      parent,
    });

    const renderedImage = parent.querySelector(`.${RENDERED_MARKDOWN_EDITOR_IMAGE_CLASS}`) as HTMLElement | null;
    const renderedImageImg = renderedImage?.querySelector('img') ?? null;
    expect(renderedImage?.getAttribute(RENDERED_MARKDOWN_EDITOR_IMAGE_SRC_ATTR))
      .toBe('ftlocalfile:///Users/afar/Google%20Drive/Team%20Notes.assets/Screenshot%201.png');
    expect(renderedImageImg?.getAttribute('src'))
      .toBe('ftlocalfile:///Users/afar/Google%20Drive/Team%20Notes.assets/Screenshot%201.png');

    view.destroy();
    parent.remove();
  });

  it('renders drawing images with padded frames, editable names, and caption edit buttons', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const doc = '![Drawing: Architecture](<file:///tmp/Drawing.png>)';
    const view = new EditorView({
      state: EditorState.create({
        doc,
        extensions: [createRenderedMarkdownEditorPresentationExtension('/tmp/Note.md')],
      }),
      parent,
    });

    const renderedImage = parent.querySelector(`.${RENDERED_MARKDOWN_EDITOR_IMAGE_CLASS}`) as HTMLElement | null;
    const frame = renderedImage?.querySelector(`.${RENDERED_MARKDOWN_EDITOR_IMAGE_FRAME_CLASS}`) ?? null;
    const captionText = renderedImage?.querySelector(`.${RENDERED_MARKDOWN_EDITOR_IMAGE_CAPTION_TEXT_CLASS}`) as HTMLElement | null;
    const editButton = renderedImage?.querySelector(`.${RENDERED_MARKDOWN_EDITOR_IMAGE_EDIT_CLASS}`) as HTMLButtonElement | null;

    expect(renderedImage?.classList.contains(RENDERED_MARKDOWN_EDITOR_DRAWING_IMAGE_CLASS)).toBe(true);
    expect(frame?.querySelector('img')?.getAttribute('src')).toBe('ftlocalfile:///tmp/Drawing.png');
    expect(captionText?.textContent).toBe('Architecture');
    expect(captionText?.contentEditable).toBe('true');
    expect(editButton?.getAttribute('aria-label')).toBe('Edit drawing');
    expect(editButton?.querySelector('svg')).not.toBeNull();
    expect(getRenderedMarkdownImagePreviewFromEventTarget(editButton)).toMatchObject({
      src: 'ftlocalfile:///tmp/Drawing.png',
      alt: 'Drawing: Architecture',
    });
    expect(getRenderedMarkdownImagePreviewFromEventTarget(captionText)).toBeNull();

    view.destroy();
    parent.remove();
  });

  it('formats and renames drawing image alt text while preserving the drawing marker', () => {
    expect(isRenderedMarkdownDrawingAlt('Drawing')).toBe(true);
    expect(isRenderedMarkdownDrawingAlt('Drawing: Architecture')).toBe(true);
    expect(isRenderedMarkdownDrawingAlt('Image')).toBe(false);
    expect(getRenderedMarkdownDrawingTitle('Drawing: Architecture')).toBe('Architecture');
    expect(replaceMarkdownImageAltAtSource(
      'before\n![Drawing](<./.assets/drawing.png>)\nafter',
      7,
      42,
      'Drawing: Architecture',
    )).toBe('before\n![Drawing: Architecture](<./.assets/drawing.png>)\nafter');
  });

	  it('hides empty inline formatting placeholders while keeping the typing position', () => {
	    const render = (doc: string, cursor: number) => {
	      const parent = document.createElement('div');
	      document.body.appendChild(parent);
	      const view = new EditorView({
	        state: EditorState.create({
	          doc,
	          selection: EditorSelection.cursor(cursor),
	          extensions: [renderedMarkdownEditorPresentationExtension],
	        }),
	        parent,
	      });
	      return { parent, view };
	    };

	    const bold = render('****', 2);
	    expect(bold.parent.querySelector('.cm-content')?.textContent).not.toContain('*');
	    bold.view.dispatch({
	      changes: { from: 2, insert: 'typed' },
	      selection: { anchor: 7 },
	    });
	    expect(bold.view.state.doc.toString()).toBe('**typed**');
	    expect(bold.parent.querySelector(`.${RENDERED_MARKDOWN_EDITOR_STRONG_CLASS}`)?.textContent).toBe('typed');
	    bold.view.destroy();
	    bold.parent.remove();

	    const italic = render('**', 1);
	    expect(italic.parent.querySelector('.cm-content')?.textContent).not.toContain('*');
	    italic.view.dispatch({
	      changes: { from: 1, insert: 'typed' },
	      selection: { anchor: 6 },
	    });
	    expect(italic.view.state.doc.toString()).toBe('*typed*');
	    expect(italic.parent.querySelector(`.${RENDERED_MARKDOWN_EDITOR_EMPHASIS_CLASS}`)?.textContent).toBe('typed');
	    italic.view.destroy();
	    italic.parent.remove();

	    const underline = render('<u></u>', 3);
	    expect(underline.parent.querySelector('.cm-content')?.textContent).not.toContain('<u>');
	    expect(underline.parent.querySelector('.cm-content')?.textContent).not.toContain('</u>');
	    underline.view.dispatch({
	      changes: { from: 3, insert: 'typed' },
	      selection: { anchor: 8 },
	    });
	    expect(underline.view.state.doc.toString()).toBe('<u>typed</u>');
	    expect(underline.parent.querySelector(`.${RENDERED_MARKDOWN_EDITOR_UNDERLINE_CLASS}`)?.textContent).toBe('typed');
	    underline.view.destroy();
	    underline.parent.remove();
	  });

	  it('toggles rendered task checkboxes through the markdown source', () => {
	    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({
        doc: '- [ ]\n- [ ] open\n- [x] done\n[] bare',
        extensions: [renderedMarkdownEditorPresentationExtension],
      }),
      parent,
    });

    const checkboxes = Array.from(parent.querySelectorAll<HTMLInputElement>(`.${RENDERED_MARKDOWN_EDITOR_TASK_MARKER_CLASS}`));
    expect(checkboxes).toHaveLength(4);

    checkboxes[0].click();
    expect(view.state.doc.toString()).toBe('- [x]\n- [ ] open\n- [x] done\n[] bare');

    const nextCheckboxes = Array.from(parent.querySelectorAll<HTMLInputElement>(`.${RENDERED_MARKDOWN_EDITOR_TASK_MARKER_CLASS}`));
    nextCheckboxes[1].click();
    expect(view.state.doc.toString()).toBe('- [x]\n- [x] open\n- [x] done\n[] bare');

    const finalCheckboxes = Array.from(parent.querySelectorAll<HTMLInputElement>(`.${RENDERED_MARKDOWN_EDITOR_TASK_MARKER_CLASS}`));
    finalCheckboxes[3].click();
    expect(view.state.doc.toString()).toBe('- [x]\n- [x] open\n- [x] done\n[x] bare');

    view.destroy();
    parent.remove();
  });

  it('hides task marker spacing inside the rendered marker column', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({
        doc: '[] bare\n[ ] spaced\n- [ ] bullet',
        extensions: [renderedMarkdownEditorPresentationExtension],
      }),
      parent,
    });

    const lines = Array.from(parent.querySelectorAll('.cm-line'));
    expect(lines.map((line) => line.textContent)).toEqual(['bare', 'spaced', 'bullet']);
    expect(Array.from(parent.querySelectorAll(`.${RENDERED_MARKDOWN_EDITOR_LIST_BODY_CLASS}`)).map((body) => body.textContent)).toEqual([
      'bare',
      'spaced',
      'bullet',
    ]);

    view.destroy();
    parent.remove();
  });

  it('renders list, quote, and fenced code blocks as source-aware editor decorations', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const doc = [
      '- first item',
      '2) second item',
      '> quoted **thought**',
      '```ts',
      'const value = `literal`;',
      '~~~ is source text here',
      '```',
    ].join('\n');
    const view = new EditorView({
      state: EditorState.create({
        doc,
        extensions: [renderedMarkdownEditorPresentationExtension],
      }),
      parent,
    });

    const content = parent.querySelector('.cm-content');
    expect(content?.textContent).toContain('•first item');
    expect(content?.textContent).toContain('2.second item');
    expect(content?.textContent).toContain('quoted thought');
    expect(content?.textContent).toContain('const value = `literal`;');
    expect(content?.textContent).toContain('~~~ is source text here');
    expect(content?.textContent).not.toContain('```');
    expect(parent.querySelectorAll(`.${RENDERED_MARKDOWN_EDITOR_LIST_LINE_CLASS}`)).toHaveLength(2);
    expect(parent.querySelectorAll(`.${RENDERED_MARKDOWN_EDITOR_CODE_FENCE_CLASS}`)).toHaveLength(2);
    expect(parent.querySelectorAll(`.${RENDERED_MARKDOWN_EDITOR_CODE_FENCE_MARKER_CLASS}`)).toHaveLength(2);
    expect(parent.querySelector(`.${RENDERED_MARKDOWN_EDITOR_CODE_BLOCK_CLASS}`)?.textContent).toBe('const value = `literal`;');
    expect(parent.querySelector(`.${RENDERED_MARKDOWN_EDITOR_CODE_BLOCK_CLASS}`)?.classList.contains(RENDERED_MARKDOWN_EDITOR_CODE_BLOCK_START_CLASS)).toBe(true);
    expect(parent.querySelector(`.${RENDERED_MARKDOWN_EDITOR_QUOTE_LINE_CLASS}`)?.textContent).toContain('quoted thought');
    expect(parent.querySelector(`.${RENDERED_MARKDOWN_EDITOR_QUOTE_MARKER_CLASS}`)?.getAttribute(RENDERED_MARKDOWN_EDITOR_SOURCE_FROM_ATTR)).toBe('28');

    const listMarkers = Array.from(parent.querySelectorAll(`.${RENDERED_MARKDOWN_EDITOR_LIST_MARKER_CLASS}`));
    expect(listMarkers.map((marker) => marker.textContent)).toEqual(['•', '2.']);
    expect(listMarkers[0].getAttribute(RENDERED_MARKDOWN_EDITOR_SOURCE_FROM_ATTR)).toBe('0');
    expect(listMarkers[0].getAttribute(RENDERED_MARKDOWN_EDITOR_SOURCE_TO_ATTR)).toBe('2');

    view.destroy();
    parent.remove();
  });

  it('marks rendered code block edges and standalone image lines as block rows', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({
        doc: [
          'Paragraph before',
          '',
          '![Diagram](<file:///tmp/diagram.png>)',
          '',
          '```',
          'first line',
          'second line',
          '```',
          '',
          'Paragraph after',
        ].join('\n'),
        extensions: [renderedMarkdownEditorPresentationExtension],
      }),
      parent,
    });

    const imageLine = parent.querySelector(`.${RENDERED_MARKDOWN_EDITOR_IMAGE_LINE_CLASS}`);
    const codeLines = Array.from(parent.querySelectorAll(`.${RENDERED_MARKDOWN_EDITOR_CODE_BLOCK_CLASS}`));
    expect(imageLine?.textContent).toBe('Diagram');
    expect(imageLine?.querySelector(`.${RENDERED_MARKDOWN_EDITOR_IMAGE_CLASS}`)).not.toBeNull();
    expect(codeLines).toHaveLength(2);
    expect(codeLines[0].classList.contains(RENDERED_MARKDOWN_EDITOR_CODE_BLOCK_START_CLASS)).toBe(true);
    expect(codeLines[0].classList.contains(RENDERED_MARKDOWN_EDITOR_CODE_BLOCK_END_CLASS)).toBe(false);
    expect(codeLines[1].classList.contains(RENDERED_MARKDOWN_EDITOR_CODE_BLOCK_START_CLASS)).toBe(false);
    expect(codeLines[1].classList.contains(RENDERED_MARKDOWN_EDITOR_CODE_BLOCK_END_CLASS)).toBe(true);

    view.destroy();
    parent.remove();
  });

  it('adds source indentation to rendered list column layout', () => {
    expect(getRenderedMarkdownListIndentStyle('  ')).toBe('--ft-rendered-list-indent: 2ch;');
    expect(getRenderedMarkdownListIndentStyle('\t')).toBe('--ft-rendered-list-indent: 2ch;');

    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({
        doc: '- top item\n  - nested item\n  [ ] nested todo',
        extensions: [renderedMarkdownEditorPresentationExtension],
      }),
      parent,
    });

    const lines = Array.from(parent.querySelectorAll(`.${RENDERED_MARKDOWN_EDITOR_LIST_LINE_CLASS}`)) as HTMLElement[];
    expect(lines).toHaveLength(3);
    expect(lines[0].getAttribute('style')).toContain('--ft-rendered-list-indent: 0ch;');
    expect(lines[1].getAttribute('style')).toContain('--ft-rendered-list-indent: 2ch;');
    expect(lines[2].getAttribute('style')).toContain('--ft-rendered-list-indent: 2ch;');
    expect(lines.map((line) => line.textContent)).toEqual(['•top item', '•nested item', 'nested todo']);
    expect(Array.from(parent.querySelectorAll(`.${RENDERED_MARKDOWN_EDITOR_LIST_BODY_CLASS}`)).map((body) => body.textContent)).toEqual([
      'top item',
      'nested item',
      'nested todo',
    ]);

    view.destroy();
    parent.remove();
  });

  it('renders bullet, ordered, nested, and task list text in a separate body column', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({
        doc: '- top item\n10) ordered item\n  - nested item\n  - [ ] nested task',
        extensions: [renderedMarkdownEditorPresentationExtension],
      }),
      parent,
    });

    const lines = Array.from(parent.querySelectorAll(`.${RENDERED_MARKDOWN_EDITOR_LIST_LINE_CLASS}`)) as HTMLElement[];
    const lineStructure = lines.map((line) => ({
      marker: line.querySelector(`.${RENDERED_MARKDOWN_EDITOR_LIST_MARKER_CLASS}`)?.textContent ?? null,
      checkbox: line.querySelector(`.${RENDERED_MARKDOWN_EDITOR_TASK_MARKER_CLASS}`) instanceof HTMLInputElement,
      body: line.querySelector(`.${RENDERED_MARKDOWN_EDITOR_LIST_BODY_CLASS}`)?.textContent ?? null,
      indent: line.getAttribute('style'),
    }));

    expect(lineStructure).toEqual([
      { marker: '•', checkbox: false, body: 'top item', indent: '--ft-rendered-list-indent: 0ch;' },
      { marker: '10.', checkbox: false, body: 'ordered item', indent: '--ft-rendered-list-indent: 0ch;' },
      { marker: '•', checkbox: false, body: 'nested item', indent: '--ft-rendered-list-indent: 2ch;' },
      { marker: null, checkbox: true, body: 'nested task', indent: '--ft-rendered-list-indent: 2ch;' },
    ]);
    const firstMarker = lines[0].querySelector(`.${RENDERED_MARKDOWN_EDITOR_LIST_MARKER_CLASS}`);
    const firstBody = lines[0].querySelector(`.${RENDERED_MARKDOWN_EDITOR_LIST_BODY_CLASS}`);
    const taskMarker = lines[3].querySelector(`.${RENDERED_MARKDOWN_EDITOR_TASK_MARKER_CLASS}`);
    const taskBody = lines[3].querySelector(`.${RENDERED_MARKDOWN_EDITOR_LIST_BODY_CLASS}`);
    const appearsBefore = (before: Element | null, after: Element | null): boolean => (
      !!before && !!after && Boolean(before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING)
    );
    expect(appearsBefore(firstMarker, firstBody)).toBe(true);
    expect(appearsBefore(taskMarker, taskBody)).toBe(true);

    view.destroy();
    parent.remove();
  });

  it('anchors empty rendered list items in the body column', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({
        doc: '- asdfadsf\n- ',
        extensions: [renderedMarkdownEditorPresentationExtension],
      }),
      parent,
    });

    const lines = Array.from(parent.querySelectorAll(`.${RENDERED_MARKDOWN_EDITOR_LIST_LINE_CLASS}`)) as HTMLElement[];
    const emptyBody = lines[1].querySelector(`.${RENDERED_MARKDOWN_EDITOR_LIST_EMPTY_BODY_CLASS}`) as HTMLElement | null;

    expect(lines).toHaveLength(2);
    expect(emptyBody).not.toBeNull();
    expect(emptyBody?.classList.contains(RENDERED_MARKDOWN_EDITOR_LIST_BODY_CLASS)).toBe(true);
    expect(lines[1].textContent).toBe('•');

    view.destroy();
    parent.remove();
  });

  it('redirects typing from hidden block markers into the rendered body', () => {
    expect(getRenderedMarkdownListBodyStart('- make', 0)).toBe(2);
    expect(getRenderedMarkdownListBodyStart('10. make', 0)).toBe(4);
    expect(getRenderedMarkdownListBodyStart('  - [ ] make', 1)).toBe(8);
    expect(getRenderedMarkdownListBodyStart('- ', 2)).toBe(2);
    expect(getRenderedMarkdownListBodyStart('- make', 2)).toBeNull();
    expect(getRenderedMarkdownListBodyStart('> quote', 0)).toBeNull();
    expect(getRenderedMarkdownBlockBodyStart('# Heading', 0)).toBe(2);
    expect(getRenderedMarkdownBlockBodyStart('> quote', 0)).toBe(2);

    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({
        doc: '- make\n1. ordered\n- [ ] task\n# Heading\n> quote',
        selection: EditorSelection.cursor(0),
        extensions: [renderedMarkdownEditorPresentationExtension],
      }),
      parent,
    });

    expect(handleRenderedMarkdownEditorBeforeInput(view, new InputEvent('beforeinput', {
      inputType: 'insertText',
      data: '"',
    }))).toBe(true);
    expect(view.state.doc.toString()).toBe('- "make\n1. ordered\n- [ ] task\n# Heading\n> quote');

    view.dispatch({ selection: EditorSelection.cursor('- "make\n'.length) });
    expect(handleRenderedMarkdownEditorBeforeInput(view, new InputEvent('beforeinput', {
      inputType: 'insertText',
      data: '"',
    }))).toBe(true);
    expect(view.state.doc.toString()).toBe('- "make\n1. "ordered\n- [ ] task\n# Heading\n> quote');

    view.dispatch({ selection: EditorSelection.cursor('- "make\n1. "ordered\n'.length) });
    expect(handleRenderedMarkdownEditorBeforeInput(view, new InputEvent('beforeinput', {
      inputType: 'insertText',
      data: '"',
    }))).toBe(true);
    expect(view.state.doc.toString()).toBe('- "make\n1. "ordered\n- [ ] "task\n# Heading\n> quote');

    view.dispatch({ selection: EditorSelection.cursor('- "make\n1. "ordered\n- [ ] "task\n'.length) });
    expect(handleRenderedMarkdownEditorBeforeInput(view, new InputEvent('beforeinput', {
      inputType: 'insertText',
      data: '"',
    }))).toBe(true);
    expect(view.state.doc.toString()).toBe('- "make\n1. "ordered\n- [ ] "task\n# "Heading\n> quote');

    view.dispatch({ selection: EditorSelection.cursor('- "make\n1. "ordered\n- [ ] "task\n# "Heading\n'.length) });
    expect(handleRenderedMarkdownEditorBeforeInput(view, new InputEvent('beforeinput', {
      inputType: 'insertText',
      data: '"',
    }))).toBe(true);
    expect(view.state.doc.toString()).toBe('- "make\n1. "ordered\n- [ ] "task\n# "Heading\n> "quote');

    view.destroy();
    parent.remove();
  });

  it('moves rendered list marker clicks to the first text position', () => {
    const event = new MouseEvent('mousedown', { button: 0 });

    expect(getRenderedMarkdownListBodyClickPosition('- make', 0, event)).toBe(2);
    expect(getRenderedMarkdownListBodyClickPosition('10. make', 1, event)).toBe(4);
    expect(getRenderedMarkdownListBodyClickPosition('  - [ ] make', 3, event)).toBe(8);
    expect(getRenderedMarkdownListBodyClickPosition('- ', 2, event)).toBe(2);
    expect(getRenderedMarkdownListBodyClickPosition('1. ', 3, event)).toBe(3);
    expect(getRenderedMarkdownListBodyClickPosition('- [ ] ', 6, event)).toBe(6);
    expect(getRenderedMarkdownListBodyClickPosition('- make', 2, event)).toBeNull();
    expect(getRenderedMarkdownBlockBodyClickPosition('# Heading', 0, event)).toBe(2);
    expect(getRenderedMarkdownBlockBodyClickPosition('> quote', 0, event)).toBe(2);
    expect(getRenderedMarkdownListBodyClickPosition('- make', 0, new MouseEvent('mousedown', {
      button: 0,
      metaKey: true,
    }))).toBeNull();
  });

  it('keeps inline rendered formatting inside the list body column', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({
        doc: '- first **bold** tail',
        extensions: [renderedMarkdownEditorPresentationExtension],
      }),
      parent,
    });

    const body = parent.querySelector(`.${RENDERED_MARKDOWN_EDITOR_LIST_BODY_CLASS}`) as HTMLElement | null;
    // jsdom cannot prove wrapped-line pixels; the live check needs to verify that this body column wraps under "first".
    expect(body?.textContent).toBe('first bold tail');
    expect(body?.querySelector(`.${RENDERED_MARKDOWN_EDITOR_STRONG_CLASS}`)?.textContent).toBe('bold');

    view.destroy();
    parent.remove();
  });

  it('keeps rendered list layout out of grid so CodeMirror widget buffers cannot become columns', () => {
    expect(getRenderedMarkdownListLineLayoutStyle()).toMatchObject({
      position: 'relative',
      paddingLeft: 'calc(var(--ft-rendered-list-indent, 0ch) + 2em) !important',
      textIndent: '0 !important',
    });
    expect(getRenderedMarkdownListLineLayoutStyle()).not.toHaveProperty('display', 'grid');
    expect(getRenderedMarkdownListLineLayoutStyle()).not.toHaveProperty('gridTemplateColumns');
    expect(getRenderedMarkdownListMarkerLayoutStyle()).toMatchObject({
      display: 'inline-block',
      position: 'absolute',
      left: 'var(--ft-rendered-list-indent, 0ch)',
    });
    expect(getRenderedMarkdownTaskMarkerLayoutStyle()).toMatchObject({
      display: 'inline-block',
      position: 'absolute',
      left: 'calc(var(--ft-rendered-list-indent, 0ch) + 0.5em)',
    });
  });

  it('keeps rendered links mapped to their source markdown range', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({
        doc: 'See [Guide](wiki://guide) today',
        extensions: [renderedMarkdownEditorPresentationExtension],
      }),
      parent,
    });

    const link = parent.querySelector(`.${RENDERED_MARKDOWN_EDITOR_LINK_CLASS}`) as HTMLElement | null;
    expect(link?.textContent).toBe('Guide');
    expect(link?.getAttribute(RENDERED_MARKDOWN_EDITOR_SOURCE_FROM_ATTR)).toBe('4');
    expect(link?.getAttribute(RENDERED_MARKDOWN_EDITOR_SOURCE_TO_ATTR)).toBe('25');

    view.destroy();
    parent.remove();
  });

  it('reveals wiki link source syntax only for the active rendered wiki link', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const doc = 'See [[First Page|first]] and [[Second Page|second]] today';
    const view = new EditorView({
      state: EditorState.create({
        doc,
        selection: EditorSelection.cursor(doc.indexOf('first') + 2),
        extensions: [renderedMarkdownEditorPresentationExtension],
      }),
      parent,
    });

    const content = parent.querySelector('.cm-content');
    expect(content?.textContent).toContain('[[First Page|first]]');
    expect(content?.textContent).toContain('second');
    expect(content?.textContent).not.toContain('[[Second Page');
    expect(parent.querySelector(`.${RENDERED_MARKDOWN_EDITOR_WIKI_LINK_CLASS}`)?.textContent).toBe('first');
    expect(Array.from(parent.querySelectorAll(`.${RENDERED_MARKDOWN_EDITOR_WIKI_SYNTAX_CLASS}`)).map((syntax) => syntax.textContent)).toEqual([
      '[[First Page|',
      ']]',
    ]);

    view.destroy();
    parent.remove();
  });

  it('edits rendered wiki link labels without changing the hidden target', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const doc = 'See [[Field Theory|field theory]] today';
    const view = new EditorView({
      state: EditorState.create({
        doc,
        extensions: [renderedMarkdownEditorPresentationExtension],
      }),
      parent,
    });

    const insertAt = doc.indexOf('field theory') + 'field'.length;
    view.dispatch({
      changes: { from: insertAt, insert: ' notes' },
      selection: EditorSelection.cursor(insertAt + ' notes'.length),
    });

    expect(view.state.doc.toString()).toBe('See [[Field Theory|field notes theory]] today');
    const link = parent.querySelector(`.${RENDERED_MARKDOWN_EDITOR_LINK_CLASS}`) as HTMLElement | null;
    expect(link?.textContent).toBe('field notes theory');
    expect(link?.getAttribute(RENDERED_MARKDOWN_EDITOR_SOURCE_FROM_ATTR)).toBe('4');

    view.destroy();
    parent.remove();
  });

  it('keeps cursor telemetry in markdown source coordinates while rendered', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({
        doc: '# Title\nSee [Guide](wiki://guide)',
        selection: EditorSelection.cursor(13),
        extensions: [renderedMarkdownEditorPresentationExtension],
      }),
      parent,
    });

    expect(getMarkdownCodeEditorSelectionSnapshot(view)).toMatchObject({
      selectionHead: 13,
      selectionHeadSource: {
        line: 2,
        column: 6,
        before: 'See [',
        after: 'Guide](wiki://guide)',
      },
    });

    view.destroy();
    parent.remove();
  });

  it('reports source coordinates after cursor movement through rendered markup', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({
        doc: '# Title\n- first\n[Guide](wiki://guide)',
        selection: EditorSelection.cursor(2),
        extensions: [renderedMarkdownEditorPresentationExtension],
      }),
      parent,
    });

    expect(getMarkdownCodeEditorSelectionSnapshot(view).selectionHeadSource).toMatchObject({
      line: 1,
      column: 3,
    });

    view.dispatch({ selection: EditorSelection.cursor(16) });
    expect(getMarkdownCodeEditorSelectionSnapshot(view).selectionHeadSource).toMatchObject({
      line: 3,
      column: 1,
      after: '[Guide](wiki://guide)',
    });

    view.destroy();
    parent.remove();
  });

  it('updates rendered decorations through CodeMirror typing, paste-style insertion, and undo', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({
        doc: '# Title',
        extensions: [history(), renderedMarkdownEditorPresentationExtension],
      }),
      parent,
    });

    view.dispatch({
      changes: { from: view.state.doc.length, insert: '!' },
      annotations: Transaction.userEvent.of('input.type'),
    });
    expect(view.state.doc.toString()).toBe('# Title!');
    expect(parent.querySelector(`.${RENDERED_MARKDOWN_EDITOR_HEADING_CLASS}-1`)?.textContent).toBe('Title!');

    view.dispatch({
      changes: { from: view.state.doc.length, insert: '\n> pasted' },
      annotations: Transaction.userEvent.of('input.paste'),
    });
    expect(view.state.doc.toString()).toBe('# Title!\n> pasted');
    expect(parent.querySelector(`.${RENDERED_MARKDOWN_EDITOR_QUOTE_LINE_CLASS}`)?.textContent).toContain('pasted');

    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('# Title!');
    expect(parent.querySelector(`.${RENDERED_MARKDOWN_EDITOR_QUOTE_LINE_CLASS}`)).toBeNull();

    view.destroy();
    parent.remove();
  });

  it('keeps rendered decoration rebuilds inside the typing latency budget', () => {
    const doc = Array.from({ length: 300 }, (_, index) => {
      if (index % 10 === 0) return `## Section ${index}`;
      if (index % 5 === 0) return `- [ ] follow up ${index}`;
      if (index % 3 === 0) return `> quoted **line ${index}**`;
      return `Paragraph ${index} with **bold** text, [link](wiki://page-${index}), and \`code\`.`;
    }).join('\n');
    const state = EditorState.create({ doc });
    const typedState = state.update({
      changes: { from: state.doc.length, insert: '!' },
      annotations: Transaction.userEvent.of('input.type'),
    }).state;

    buildRenderedMarkdownEditorDecorations(state);
    const startedAt = performance.now();
    const decorations = buildRenderedMarkdownEditorDecorations(typedState);
    const elapsedMs = performance.now() - startedAt;

    expect(decorations.size).toBeGreaterThan(0);
    expect(elapsedMs).toBeLessThan(50);
  });

  it('keeps visible rendered decoration rebuilds inside a single-frame typing budget', () => {
    const doc = Array.from({ length: 5000 }, (_, index) => {
      if (index % 20 === 0) return `## Section ${index}`;
      if (index % 7 === 0) return `- [ ] follow up ${index}`;
      if (index % 5 === 0) return `> quoted **line ${index}**`;
      return `Paragraph ${index} with **bold** text, [link](wiki://page-${index}), and \`code\`.`;
    }).join('\n');
    const state = EditorState.create({ doc });
    const typedState = state.update({
      changes: { from: state.doc.length, insert: '!' },
      annotations: Transaction.userEvent.of('input.type'),
    }).state;
    const visibleStart = typedState.doc.line(4940).from;
    const visibleRange = [{ from: visibleStart, to: typedState.doc.length }];

    buildRenderedMarkdownEditorDecorationsForRanges(typedState, visibleRange);
    const startedAt = performance.now();
    const decorations = buildRenderedMarkdownEditorDecorationsForRanges(typedState, visibleRange);
    const elapsedMs = performance.now() - startedAt;

    expect(decorations.size).toBeGreaterThan(0);
    expect(decorations.size).toBeLessThan(500);
    expect(elapsedMs).toBeLessThan(16);
  });

  it('keeps code block styling when a visible range starts inside a fenced block', () => {
    const doc = [
      'before',
      '```ts',
      'const first = 1;',
      'const second = 2;',
      '```',
      'after',
    ].join('\n');
    const state = EditorState.create({ doc });
    const visibleLine = state.doc.line(4);
    const decorations = buildRenderedMarkdownEditorDecorationsForRanges(state, [{
      from: visibleLine.from,
      to: visibleLine.to,
    }]);
    const classes: string[] = [];

    decorations.between(0, state.doc.length, (_from, _to, value) => {
      if (typeof value.spec.class === 'string') classes.push(value.spec.class);
    });

    expect(classes.some((className) => className.split(' ').includes(RENDERED_MARKDOWN_EDITOR_CODE_BLOCK_CLASS))).toBe(true);
  });
});

describe('MarkdownCodeEditor file swaps', () => {
  it('does not report swap transactions as user edits', () => {
    const state = EditorState.create({ doc: 'File A' });
    const swap = state.update({
      changes: { from: 0, to: state.doc.length, insert: 'File B' },
      annotations: Transaction.userEvent.of(MARKDOWN_CODE_EDITOR_FILE_SWAP_USER_EVENT),
    });
    const input = state.update({
      changes: { from: state.doc.length, insert: ' typed' },
      annotations: Transaction.userEvent.of('input.type'),
    });

    expect(isMarkdownCodeEditorFileSwapUpdate({ transactions: [swap] })).toBe(true);
    expect(isMarkdownCodeEditorFileSwapUpdate({ transactions: [input] })).toBe(false);
  });

  it('drops the previous file history when swapping documents', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const historyCompartment = new Compartment();
    const view = new EditorView({
      state: EditorState.create({
        doc: 'File A',
        extensions: [historyCompartment.of(history())],
      }),
      parent,
    });

    view.dispatch({ changes: { from: view.state.doc.length, insert: ' typed' } });
    expect(view.state.doc.toString()).toBe('File A typed');

    dispatchMarkdownCodeEditorFileSwap(view, historyCompartment, 'File B');
    expect(view.state.doc.toString()).toBe('File B');
    expect(undo(view)).toBe(false);
    expect(view.state.doc.toString()).toBe('File B');

    view.destroy();
    parent.remove();
  });

  it('keeps file swaps out of the parent onChange path', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const historyCompartment = new Compartment();
    const onChange = vi.fn();
    const view = new EditorView({
      state: EditorState.create({
        doc: 'File A',
        extensions: [
          historyCompartment.of(history()),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !isMarkdownCodeEditorFileSwapUpdate(update)) {
              onChange(update.state.doc.toString());
            }
          }),
        ],
      }),
      parent,
    });

    dispatchMarkdownCodeEditorFileSwap(view, historyCompartment, 'File B');
    expect(onChange).not.toHaveBeenCalled();

    view.dispatch({ changes: { from: view.state.doc.length, insert: ' typed' } });
    expect(onChange).toHaveBeenCalledWith('File B typed');

    view.destroy();
    parent.remove();
  });
});

describe('MarkdownCodeEditor captured keydown', () => {
  it('stops CodeMirror keymaps when the app handles a shortcut', () => {
    const event = new KeyboardEvent('keydown', {
      key: '/',
      code: 'Slash',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    const stopImmediatePropagation = vi.spyOn(event, 'stopImmediatePropagation');

    expect(handleMarkdownCodeEditorCapturedKeyDown(event, () => true)).toBe(true);

    expect(event.defaultPrevented).toBe(true);
    expect(stopImmediatePropagation).toHaveBeenCalledTimes(1);
  });

  it('lets the app capture Escape before it can bubble into window close handling', () => {
    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    const stopImmediatePropagation = vi.spyOn(event, 'stopImmediatePropagation');

    expect(handleMarkdownCodeEditorCapturedKeyDown(event, () => true)).toBe(true);

    expect(event.defaultPrevented).toBe(true);
    expect(stopImmediatePropagation).toHaveBeenCalledTimes(1);
  });

  it('leaves unhandled keys available to CodeMirror', () => {
    const event = new KeyboardEvent('keydown', {
      key: 'a',
      bubbles: true,
      cancelable: true,
    });
    const stopImmediatePropagation = vi.spyOn(event, 'stopImmediatePropagation');

    expect(handleMarkdownCodeEditorCapturedKeyDown(event, () => false)).toBe(false);

    expect(event.defaultPrevented).toBe(false);
    expect(stopImmediatePropagation).not.toHaveBeenCalled();
  });
});
