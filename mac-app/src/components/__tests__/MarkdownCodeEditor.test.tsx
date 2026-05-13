import { describe, expect, it, vi } from 'vitest';
import { Compartment, EditorSelection, EditorState, Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { history, undo } from '@codemirror/commands';
import {
  MARKDOWN_CODE_EDITOR_CHECKED_TASK_LINE_CLASS,
  MARKDOWN_CODE_EDITOR_CARET_BOTTOM_ROOM_PX,
  MARKDOWN_CODE_EDITOR_FILE_SWAP_USER_EVENT,
  RENDERED_MARKDOWN_EDITOR_CODE_CLASS,
  RENDERED_MARKDOWN_EDITOR_CODE_BLOCK_CLASS,
  RENDERED_MARKDOWN_EDITOR_CODE_FENCE_CLASS,
  RENDERED_MARKDOWN_EDITOR_CODE_FENCE_MARKER_CLASS,
  RENDERED_MARKDOWN_EDITOR_EMPHASIS_CLASS,
  RENDERED_MARKDOWN_EDITOR_IMAGE_ALT_ATTR,
  RENDERED_MARKDOWN_EDITOR_HEADING_CLASS,
  RENDERED_MARKDOWN_EDITOR_HEADING_MARKER_CLASS,
  RENDERED_MARKDOWN_EDITOR_IMAGE_CLASS,
  RENDERED_MARKDOWN_EDITOR_IMAGE_CAPTION_CLASS,
  RENDERED_MARKDOWN_EDITOR_IMAGE_SRC_ATTR,
  RENDERED_MARKDOWN_EDITOR_STRIKE_CLASS,
  RENDERED_MARKDOWN_EDITOR_LINK_CLASS,
  RENDERED_MARKDOWN_EDITOR_LIST_LINE_CLASS,
  RENDERED_MARKDOWN_EDITOR_LIST_MARKER_CLASS,
  RENDERED_MARKDOWN_EDITOR_QUOTE_LINE_CLASS,
  RENDERED_MARKDOWN_EDITOR_QUOTE_MARKER_CLASS,
  RENDERED_MARKDOWN_EDITOR_SOURCE_FROM_ATTR,
  RENDERED_MARKDOWN_EDITOR_SOURCE_TO_ATTR,
  RENDERED_MARKDOWN_EDITOR_STRONG_CLASS,
  RENDERED_MARKDOWN_EDITOR_TASK_MARKER_CLASS,
  RENDERED_MARKDOWN_EDITOR_UNDERLINE_CLASS,
  buildRenderedMarkdownEditorDecorations,
  buildRenderedMarkdownEditorDecorationsForRanges,
  checkedMarkdownTaskLineExtension,
  renderedMarkdownEditorPresentationExtension,
  dispatchMarkdownCodeEditorFileSwap,
  getMarkdownCodeEditorBottomRoom,
  getMarkdownCodeEditorCursorAnimationStyle,
  getMarkdownCodeEditorCursorScrollMargin,
  getMarkdownCodeEditorSelectionSnapshot,
  getMarkdownCodeEditorSourcePosition,
  getRenderedMarkdownImagePreviewFromEventTarget,
  handleMarkdownCodeEditorCapturedKeyDown,
  isMarkdownCodeEditorFileSwapUpdate,
  shouldMoveCaretToDocumentEndFromClick,
} from '../MarkdownCodeEditor';

describe('MarkdownCodeEditor cursor blink', () => {
  it('leaves cursor animation enabled by default', () => {
    expect(getMarkdownCodeEditorCursorAnimationStyle(true)).toEqual({});
  });

  it('removes cursor animation when blinking is disabled', () => {
    expect(getMarkdownCodeEditorCursorAnimationStyle(false)).toEqual({ animation: 'none' });
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

describe('MarkdownCodeEditor rendered presentation', () => {
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
    expect((parent.querySelector(`.${RENDERED_MARKDOWN_EDITOR_TASK_MARKER_CLASS}`) as HTMLInputElement | null)?.checked).toBe(true);

    view.destroy();
    parent.remove();
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
    expect(parent.querySelector(`.${RENDERED_MARKDOWN_EDITOR_QUOTE_LINE_CLASS}`)?.textContent).toContain('quoted thought');
    expect(parent.querySelector(`.${RENDERED_MARKDOWN_EDITOR_QUOTE_MARKER_CLASS}`)?.getAttribute(RENDERED_MARKDOWN_EDITOR_SOURCE_FROM_ATTR)).toBe('28');

    const listMarkers = Array.from(parent.querySelectorAll(`.${RENDERED_MARKDOWN_EDITOR_LIST_MARKER_CLASS}`));
    expect(listMarkers.map((marker) => marker.textContent)).toEqual(['•', '2.']);
    expect(listMarkers[0].getAttribute(RENDERED_MARKDOWN_EDITOR_SOURCE_FROM_ATTR)).toBe('0');
    expect(listMarkers[0].getAttribute(RENDERED_MARKDOWN_EDITOR_SOURCE_TO_ATTR)).toBe('2');

    view.destroy();
    parent.remove();
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

    expect(classes).toContain(RENDERED_MARKDOWN_EDITOR_CODE_BLOCK_CLASS);
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
