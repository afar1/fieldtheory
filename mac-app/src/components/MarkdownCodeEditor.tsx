/**
 * MarkdownCodeEditor — CodeMirror 6 based markdown source editor.
 *
 * CodeMirror 6 source editor used by LibrarianView. It exposes a minimal
 * value/onChange contract plus an imperative ref so callers can focus the editor
 * and read/write selection state without owning the CM instance.
 *
 * Scope is intentionally limited: advanced behaviors such as wiki completion,
 * paste handling, and undo stack persistence are owned by LibrarianView. The
 * optional rendered presentation keeps CodeMirror as the input owner while
 * decorating common Markdown as styled prose.
 */
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  EditorSelection,
  EditorState,
  Compartment,
  Facet,
  Prec,
  RangeSetBuilder,
  Text,
  Transaction,
  type ChangeDesc,
  type Range,
} from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  GutterMarker,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
  drawSelection,
  gutterLineClass,
  keymap,
  highlightActiveLine,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import {
  HighlightStyle,
  syntaxHighlighting,
  defaultHighlightStyle,
  bracketMatching,
} from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { useTheme } from '../contexts/ThemeContext';
import { useScrollFpsSampler } from '../hooks/useScrollFpsSampler';
import { useInteractionFpsSampler } from '../hooks/useInteractionFpsSampler';
import { isCheckedMarkdownTaskLine } from '../utils/markdownTasks';
import { normalizeMarkdownImageUrl } from '../utils/portableMarkdownImages';
import { getHtmlPreviewSrcDoc } from '../utils/htmlPreview';
import { DEFAULT_RENDERED_BLOCK_CURSOR_OPACITY, DEFAULT_RENDERED_TEXT_CURSOR_STYLE, type RenderedTextCursorStyle } from '../utils/editorShortcuts';
import { RENDERED_EDITOR_DEBUG_STORAGE_KEY } from '../utils/renderedMarkdownEditor';
import { onBookmarksChanged, peekBookmarks } from '../services/bookmarksCache';

export const MARKDOWN_CODE_EDITOR_CARET_BOTTOM_ROOM_PX = 59.2;
export const MARKDOWN_CODE_EDITOR_CURSOR_BLINK_RATE_MS = 1200;
export const MARKDOWN_CODE_EDITOR_BLOCK_CURSOR_HEIGHT = '1.18em';
export const MARKDOWN_CODE_EDITOR_BLOCK_CURSOR_WIDTH = '0.62em';
export const MARKDOWN_CODE_EDITOR_CHECKED_TASK_LINE_CLASS = 'cm-markdown-task-line-checked';
export const MARKDOWN_CODE_EDITOR_FILE_SWAP_USER_EVENT = 'swap.file';
export const RENDERED_MARKDOWN_EDITOR_HEADING_CLASS = 'cm-rendered-markdown-heading';
export const RENDERED_MARKDOWN_EDITOR_LINK_CLASS = 'cm-rendered-markdown-link';
export const RENDERED_MARKDOWN_EDITOR_WIKI_LINK_CLASS = 'cm-rendered-markdown-wiki-link';
export const RENDERED_MARKDOWN_EDITOR_WIKI_SYNTAX_CLASS = 'cm-rendered-markdown-wiki-syntax';
export const RENDERED_MARKDOWN_EDITOR_STRONG_CLASS = 'cm-rendered-markdown-strong';
export const RENDERED_MARKDOWN_EDITOR_EMPHASIS_CLASS = 'cm-rendered-markdown-emphasis';
export const RENDERED_MARKDOWN_EDITOR_UNDERLINE_CLASS = 'cm-rendered-markdown-underline';
export const RENDERED_MARKDOWN_EDITOR_STRIKE_CLASS = 'cm-rendered-markdown-strike';
export const RENDERED_MARKDOWN_EDITOR_CODE_CLASS = 'cm-rendered-markdown-code';
export const RENDERED_MARKDOWN_EDITOR_IMAGE_CLASS = 'cm-rendered-markdown-image';
export const RENDERED_MARKDOWN_EDITOR_DRAWING_IMAGE_CLASS = 'cm-rendered-markdown-drawing-image';
export const RENDERED_MARKDOWN_EDITOR_IMAGE_FRAME_CLASS = 'cm-rendered-markdown-image-frame';
export const RENDERED_MARKDOWN_EDITOR_IMAGE_CAPTION_CLASS = 'cm-rendered-markdown-image-caption';
export const RENDERED_MARKDOWN_EDITOR_IMAGE_CAPTION_TEXT_CLASS = 'cm-rendered-markdown-image-caption-text';
export const RENDERED_MARKDOWN_EDITOR_IMAGE_EDIT_CLASS = 'cm-rendered-markdown-image-edit';
export const RENDERED_MARKDOWN_EDITOR_IMAGE_SRC_ATTR = 'data-cm-rendered-markdown-image-src';
export const RENDERED_MARKDOWN_EDITOR_IMAGE_ALT_ATTR = 'data-cm-rendered-markdown-image-alt';
export const RENDERED_MARKDOWN_EDITOR_IMAGE_LINE_CLASS = 'cm-rendered-markdown-image-line';
export const RENDERED_MARKDOWN_EDITOR_LIST_IMAGE_CLASS = 'cm-rendered-markdown-list-image';
export const RENDERED_MARKDOWN_EDITOR_BOOKMARK_CLASS = 'cm-rendered-markdown-bookmark';
export const RENDERED_MARKDOWN_EDITOR_BOOKMARK_ID_ATTR = 'data-cm-rendered-markdown-bookmark-id';
export const RENDERED_MARKDOWN_EDITOR_CODE_BLOCK_CLASS = 'cm-rendered-markdown-code-block';
export const RENDERED_MARKDOWN_EDITOR_CODE_BLOCK_START_CLASS = 'cm-rendered-markdown-code-block-start';
export const RENDERED_MARKDOWN_EDITOR_CODE_BLOCK_END_CLASS = 'cm-rendered-markdown-code-block-end';
export const RENDERED_MARKDOWN_EDITOR_CODE_FENCE_CLASS = 'cm-rendered-markdown-code-fence';
export const RENDERED_MARKDOWN_EDITOR_CODE_FENCE_MARKER_CLASS = 'cm-rendered-markdown-code-fence-marker';
export const RENDERED_MARKDOWN_EDITOR_INLINE_HTML_CLASS = 'cm-rendered-markdown-inline-html';
export const RENDERED_MARKDOWN_EDITOR_INLINE_HTML_EXPANDED_CLASS = 'cm-rendered-markdown-inline-html-expanded';
export const RENDERED_MARKDOWN_EDITOR_LIST_LINE_CLASS = 'cm-rendered-markdown-list-line';
export const RENDERED_MARKDOWN_EDITOR_LIST_MARKER_CLASS = 'cm-rendered-markdown-list-marker';
export const RENDERED_MARKDOWN_EDITOR_LIST_BODY_CLASS = 'cm-rendered-markdown-list-body';
export const RENDERED_MARKDOWN_EDITOR_LIST_EMPTY_BODY_CLASS = 'cm-rendered-markdown-list-empty-body';
export const RENDERED_MARKDOWN_EDITOR_HEADING_MARKER_CLASS = 'cm-rendered-markdown-heading-marker';
export const RENDERED_MARKDOWN_EDITOR_QUOTE_LINE_CLASS = 'cm-rendered-markdown-quote-line';
export const RENDERED_MARKDOWN_EDITOR_QUOTE_MARKER_CLASS = 'cm-rendered-markdown-quote-marker';
export const RENDERED_MARKDOWN_EDITOR_TASK_MARKER_CLASS = 'cm-rendered-markdown-task-marker';
export const RENDERED_MARKDOWN_EDITOR_DONE_TASK_CLASS = 'cm-rendered-markdown-task-done';
export const RENDERED_MARKDOWN_EDITOR_SOURCE_FROM_ATTR = 'data-ft-source-from';
export const RENDERED_MARKDOWN_EDITOR_SOURCE_TO_ATTR = 'data-ft-source-to';
export const MARKDOWN_CODE_EDITOR_FIND_MATCH_CLASS = 'cm-ft-fileFindMatch';
export const MARKDOWN_CODE_EDITOR_SELECTED_LINE_NUMBER_CLASS = 'cm-ft-selectedLineNumber';
export const MARKDOWN_CODE_EDITOR_HAS_RANGE_SELECTION_CLASS = 'cm-ft-hasRangeSelection';
export const MARKDOWN_CODE_EDITOR_LINE_NUMBER_SELECTION_HIT_AREA_CLASS = 'cm-ft-lineNumberSelectionHitArea';
export const MARKDOWN_CODE_EDITOR_LINE_NUMBER_OVERLAY_WIDTH = '4.2em';
export const MARKDOWN_CODE_EDITOR_LINE_NUMBER_OVERLAY_GAP = '1.05em';
export const MARKDOWN_CODE_EDITOR_LINE_NUMBER_OVERLAY_RIGHT = '0.75em';
export const RENDERED_MARKDOWN_EDITOR_TIMING_EVENT = 'fieldtheory:rendered-editor-timing';
export const RENDERED_MARKDOWN_EDITOR_ROW_LINE_HEIGHT = 'var(--ft-line-number-row-height)';
const DRAWING_ALT_PREFIX = 'Drawing: ';

export type MarkdownCodeEditorPresentation = 'source' | 'rendered';

function renderedMarkdownEditorTimingEnabled(): boolean {
  try {
    return window.localStorage.getItem(RENDERED_EDITOR_DEBUG_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function emitRenderedMarkdownEditorTiming(stage: string, details: Record<string, unknown>): void {
  if (!renderedMarkdownEditorTimingEnabled()) return;
  window.dispatchEvent(new CustomEvent(RENDERED_MARKDOWN_EDITOR_TIMING_EVENT, {
    detail: {
      timestamp: Date.now(),
      stage,
      ...details,
    },
  }));
}

export interface MarkdownCodeEditorHandle {
  focus: (options?: { preventScroll?: boolean }) => void;
  blur: () => void;
  refreshLayout: () => void;
  startRenderedVisualRowSelection: (event: MouseEvent) => boolean;
  getValue: () => string;
  getSelectionRange: () => { start: number; end: number };
  getSelectionSnapshot: () => MarkdownCodeEditorSelectionSnapshot | null;
  getVisualLineMap: () => MarkdownCodeEditorVisualLine[];
  setSelectionRange: (start: number, end: number) => void;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

export interface MarkdownCodeEditorSourcePosition {
  offset: number;
  line: number;
  column: number;
  lineStart: number;
  lineEnd: number;
  lineLength: number;
  before: string;
  after: string;
}

export interface MarkdownCodeEditorVisualLine {
  visualLine: number;
  sourceLine: number;
  rowInSourceLine: number;
  rowsInSourceLine: number;
  sourceLineText: string;
}

export interface MarkdownCodeEditorSelectionSnapshot {
  value: string;
  selectionStart: number;
  selectionEnd: number;
  selectionAnchor: number;
  selectionHead: number;
  isCollapsed: boolean;
  selectionStartSource: MarkdownCodeEditorSourcePosition;
  selectionEndSource: MarkdownCodeEditorSourcePosition;
  selectionHeadSource: MarkdownCodeEditorSourcePosition;
  caretPosition: { top: number; left: number } | null;
  caretRect: {
    viewport: { left: number; top: number; width: number; height: number };
    editor: { left: number; top: number; width: number; height: number };
  } | null;
  selectionRect: {
    viewport: { left: number; top: number; width: number; height: number };
    editor: { left: number; top: number; width: number; height: number };
  } | null;
  scroll: { top: number; height: number; clientHeight: number };
  docChanged: boolean;
  inputType?: string;
  inputData?: string | null;
}

export interface MarkdownCodeEditorImagePreview {
  src: string;
  alt: string;
  sourceFrom: number | null;
  sourceTo: number | null;
}

export interface MarkdownCodeEditorSourceRange {
  from: number;
  to: number;
}

export function isRenderedMarkdownDrawingAlt(alt: string): boolean {
  return alt === 'Drawing' || alt.startsWith(DRAWING_ALT_PREFIX);
}

export function getRenderedMarkdownDrawingTitle(alt: string): string {
  return alt.startsWith(DRAWING_ALT_PREFIX) ? alt.slice(DRAWING_ALT_PREFIX.length) : alt || 'Drawing';
}

function formatRenderedMarkdownDrawingAlt(title: string): string {
  const trimmed = title.trim();
  if (!trimmed || trimmed === 'Drawing') return 'Drawing';
  return `${DRAWING_ALT_PREFIX}${trimmed}`;
}

function escapeMarkdownImageAlt(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\]/g, '\\]');
}

function getMarkdownImageAltEditAtSource(
  markdown: string,
  sourceFrom: number,
  sourceTo: number,
  nextAlt: string,
): { from: number; to: number; insert: string } | null {
  if (sourceFrom < 0 || sourceTo <= sourceFrom || sourceTo > markdown.length) return null;
  const source = markdown.slice(sourceFrom, sourceTo);
  const match = /^!\[((?:[^\]\\]|\\.)*)\]\(/.exec(source);
  if (!match) return null;
  const from = sourceFrom + 2;
  const to = from + match[1].length;
  return { from, to, insert: escapeMarkdownImageAlt(nextAlt) };
}

export function replaceMarkdownImageAltAtSource(markdown: string, sourceFrom: number, sourceTo: number, nextAlt: string): string | null {
  const edit = getMarkdownImageAltEditAtSource(markdown, sourceFrom, sourceTo, nextAlt);
  if (!edit) return null;
  return `${markdown.slice(0, edit.from)}${edit.insert}${markdown.slice(edit.to)}`;
}

function normalizeRenderedMarkdownImageDestination(destination: string): string {
  const trimmed = destination.trim();
  return trimmed.startsWith('<') && trimmed.endsWith('>')
    ? trimmed.slice(1, -1).trim()
    : trimmed;
}

export function getRenderedMarkdownBookmarkEmbedId(destination: string): string | null {
  const clean = normalizeRenderedMarkdownImageDestination(destination);
  if (!clean.toLowerCase().startsWith('bookmark://')) return null;
  const rawId = clean.slice('bookmark://'.length).split(/[?#]/, 1)[0] ?? '';
  try {
    const decoded = decodeURIComponent(rawId).trim();
    return decoded || null;
  } catch {
    const fallback = rawId.trim();
    return fallback || null;
  }
}

interface MarkdownCodeEditorProps {
  value: string;
  onChange: (next: string) => void;
  presentation?: MarkdownCodeEditorPresentation;
  findQuery?: string;
  fontFamily: string;
  fontSize: number | string;
  lineHeight: number | string;
  color: string;
  headingFontFamily?: string;
  h1Size?: string;
  h2Size?: string;
  h3Size?: string;
  linkColor?: string;
  mutedColor?: string;
  paragraphSpacing?: string;
  background?: string;
  caretColor?: string;
  selectionBackground?: string;
  lineNumbersMode?: 'hidden' | 'visible' | 'faded';
  blinkCursor?: boolean;
  cursorStyle?: RenderedTextCursorStyle;
  blockCursorOpacity?: number;
  placeholder?: string;
  readOnly?: boolean;
  spellCheck?: boolean;
  dataAttributes?: Record<string, string | undefined>;
  documentPath?: string | null;
  style?: React.CSSProperties;
  onKeyDown?: (event: KeyboardEvent) => boolean | void;
  onMouseDown?: (event: MouseEvent, offset: number) => boolean | void;
  onPaste?: (event: ClipboardEvent) => boolean | void;
  onImagePreview?: (preview: MarkdownCodeEditorImagePreview) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onSelectionChange?: (snapshot: MarkdownCodeEditorSelectionSnapshot) => void;
  onScroll?: (scrollTop: number) => void;
  bottomRoomPx?: number;
}

const buildHighlightStyle = (isDark: boolean) =>
  HighlightStyle.define([
    {
      tag: t.heading,
      color: isDark ? '#f5f5f5' : '#111',
    },
    { tag: t.strong, color: isDark ? '#f5f5f5' : '#111' },
    { tag: t.emphasis, color: isDark ? 'rgba(255,255,255,0.86)' : 'rgba(0,0,0,0.78)' },
    {
      tag: [t.processingInstruction, t.meta, t.contentSeparator],
      color: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)',
    },
    {
      tag: [t.url, t.link],
      color: isDark ? '#7aa7ff' : '#1d4ed8',
      textDecoration: 'underline',
    },
    {
      tag: [t.monospace, t.literal],
      color: isDark ? '#f0a36b' : '#b45309',
    },
    {
      tag: t.quote,
      color: isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)',
    },
    {
      tag: t.list,
      color: isDark ? '#f5f5f5' : '#111',
    },
  ]);

export function buildCheckedMarkdownTaskLineDecorations(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (let lineNumber = 1; lineNumber <= state.doc.lines; lineNumber += 1) {
    const line = state.doc.line(lineNumber);
    if (isCheckedMarkdownTaskLine(line.text)) {
      builder.add(line.from, line.from, Decoration.line({ class: MARKDOWN_CODE_EDITOR_CHECKED_TASK_LINE_CLASS }));
    }
  }
  return builder.finish();
}

export const checkedMarkdownTaskLineExtension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildCheckedMarkdownTaskLineDecorations(view.state);
    }

    update(update: { docChanged: boolean; state: EditorState }) {
      if (update.docChanged) {
        const startedAt = renderedMarkdownEditorTimingEnabled() ? performance.now() : 0;
        this.decorations = buildCheckedMarkdownTaskLineDecorations(update.state);
        if (startedAt > 0) {
          emitRenderedMarkdownEditorTiming('code-editor-checked-task-decorations', {
            durationMs: performance.now() - startedAt,
            lines: update.state.doc.lines,
            docLength: update.state.doc.length,
          });
        }
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
  },
);

const selectedLineNumberMarker = new class extends GutterMarker {
  elementClass = MARKDOWN_CODE_EDITOR_SELECTED_LINE_NUMBER_CLASS;
};

function parseCssPixels(value: string): number | null {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getMeasuredEditorLineHeight(view: EditorView): number {
  const scroller = view.dom.querySelector<HTMLElement>('.cm-scroller');
  const computed = getComputedStyle(scroller ?? view.scrollDOM);
  const lineHeight = parseCssPixels(computed.lineHeight);
  if (lineHeight !== null) return lineHeight;
  const fontSize = parseCssPixels(computed.fontSize);
  return fontSize !== null ? fontSize * 1.4 : 20;
}

export function countVisualLineRowsFromClientRects(
  rects: readonly Pick<DOMRect, 'top' | 'width' | 'height'>[],
  lineHeight: number,
): number {
  return getVisualLineRowTopsFromClientRects(rects, lineHeight).length;
}

function getVisualLineRowTopsFromClientRects(
  rects: readonly Pick<DOMRect, 'top' | 'width' | 'height'>[],
  lineHeight: number,
): number[] {
  const rowTops: number[] = [];
  const topTolerance = Math.max(1, lineHeight / 2);
  for (const rect of rects) {
    if (rect.width <= 0 || rect.height <= 0) continue;
    if (rowTops.some((top) => Math.abs(top - rect.top) < topTolerance)) continue;
    rowTops.push(rect.top);
  }
  return rowTops.sort((a, b) => a - b);
}

export function getVisualLineRowTopsFromLineBox(
  lineBoxTop: number,
  textRowTops: readonly number[],
  lineHeight: number,
): number[] {
  const rowCount = Math.max(1, textRowTops.length);
  return Array.from({ length: rowCount }, (_, rowIndex) => lineBoxTop + (rowIndex * lineHeight));
}

function getVisualLineRowTopsFromElement(element: HTMLElement, lineHeight: number): number[] {
  const lineBoxTop = element.getBoundingClientRect().top;
  const range = document.createRange();
  range.selectNodeContents(element);
  const textRowTops = getVisualLineRowTopsFromClientRects(Array.from(range.getClientRects()), lineHeight);
  range.detach();
  if (textRowTops.length === 0) return [];
  return getVisualLineRowTopsFromLineBox(lineBoxTop, textRowTops, lineHeight);
}

function getLineElementForBlock(
  view: EditorView,
  line: { from: number; to: number },
  fallback: HTMLElement | undefined,
): HTMLElement | undefined {
  const lookupPosition = line.from < line.to ? line.from + 1 : line.from;
  const domAtLine = view.domAtPos(lookupPosition);
  const element = domAtLine.node instanceof HTMLElement ? domAtLine.node : domAtLine.node.parentElement;
  return element?.closest<HTMLElement>('.cm-line') ?? fallback;
}

type VisualLineNumberOverlayRow = {
  number: string;
  top: number;
  selected: boolean;
};

function isSourceLineSelected(state: EditorState, line: { from: number; to: number }): boolean {
  return state.selection.ranges.some((range) => (
    range.from <= line.to && range.to >= line.from && !(range.empty && range.from !== line.from)
  ));
}

export function doesBrowserSelectionIntersectElement(selection: Selection | null, element: HTMLElement): boolean {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return false;
  for (let index = 0; index < selection.rangeCount; index += 1) {
    const range = selection.getRangeAt(index);
    try {
      if (range.intersectsNode(element)) return true;
    } catch {
      if (element.contains(range.commonAncestorContainer)) return true;
    }
  }
  return false;
}

export function isVisualLineNumberRowSelected(
  rowTop: number,
  selectedRowTops: readonly number[],
  lineHeight: number,
): boolean {
  const topTolerance = Math.max(1, lineHeight / 2);
  return selectedRowTops.some((top) => Math.abs(top - rowTop) < topTolerance);
}

function getBrowserSelectionVisualRowTops(selection: Selection | null, lineHeight: number): number[] {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return [];
  const rects: DOMRect[] = [];
  for (let index = 0; index < selection.rangeCount; index += 1) {
    rects.push(...Array.from(selection.getRangeAt(index).getClientRects()));
  }
  return getVisualLineRowTopsFromClientRects(rects, lineHeight);
}

function isLineElementSelected(view: EditorView, lineElement: HTMLElement | undefined): boolean {
  if (!lineElement) return false;
  return doesBrowserSelectionIntersectElement(view.dom.ownerDocument.getSelection(), lineElement);
}

function buildVisualLineNumberOverlayRows(view: EditorView): { rows: VisualLineNumberOverlayRow[]; signature: string } {
  const editorRect = view.dom.getBoundingClientRect();
  const lineHeight = getMeasuredEditorLineHeight(view);
  const blocks = view.viewportLineBlocks;
  const lineElements = Array.from(view.contentDOM.querySelectorAll<HTMLElement>('.cm-line'));
  const browserSelection = view.dom.ownerDocument.getSelection();
  const selectedRowTops = getBrowserSelectionVisualRowTops(browserSelection, lineHeight);
  let visualLineNumber = blocks.length > 0 ? view.state.doc.lineAt(blocks[0].from).number : 1;
  const signatureParts: string[] = [];
  const rows: VisualLineNumberOverlayRow[] = [];

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    const line = view.state.doc.lineAt(block.from);
    const lineElement = getLineElementForBlock(view, line, lineElements[index]);
    const rangeTops = lineElement ? getVisualLineRowTopsFromElement(lineElement, lineHeight) : [];
    const fallbackTop = view.documentTop + block.top;
    const rowTops = rangeTops.length > 0 ? rangeTops : (line.text.trim() === '' ? [fallbackTop] : []);
    if (rowTops.length === 0) {
      signatureParts.push(`${line.from}:hidden`);
      continue;
    }
    const isFallbackSelected = selectedRowTops.length === 0
      && (isSourceLineSelected(view.state, line) || isLineElementSelected(view, lineElement));
    const rowSelectionState = rowTops.map((top) => (
      selectedRowTops.length > 0
        ? isVisualLineNumberRowSelected(top, selectedRowTops, lineHeight)
        : isFallbackSelected
    ));
    for (let rowIndex = 0; rowIndex < rowTops.length; rowIndex += 1) {
      const top = rowTops[rowIndex];
      const selected = rowSelectionState[rowIndex] ?? false;
      rows.push({
        number: String(visualLineNumber),
        top: top - editorRect.top,
        selected,
      });
      visualLineNumber += 1;
    }
    signatureParts.push(`${line.from}:${rowTops.map((top, rowIndex) => (
      `${Math.round(top - editorRect.top)}:${rowSelectionState[rowIndex] ? 'selected' : 'plain'}`
    )).join(',')}`);
  }

  return {
    rows,
    signature: signatureParts.join('|'),
  };
}

export function getMarkdownCodeEditorVisualLineMap(view: EditorView): MarkdownCodeEditorVisualLine[] {
  const lineHeight = getMeasuredEditorLineHeight(view);
  const blocks = view.viewportLineBlocks;
  const lineElements = Array.from(view.contentDOM.querySelectorAll<HTMLElement>('.cm-line'));
  let visualLineNumber = blocks.length > 0 ? view.state.doc.lineAt(blocks[0].from).number : 1;
  const rows: MarkdownCodeEditorVisualLine[] = [];

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    const line = view.state.doc.lineAt(block.from);
    const lineElement = getLineElementForBlock(view, line, lineElements[index]);
    const rangeTops = lineElement ? getVisualLineRowTopsFromElement(lineElement, lineHeight) : [];
    const fallbackTop = view.documentTop + block.top;
    const rowTops = rangeTops.length > 0 ? rangeTops : (line.text.trim() === '' ? [fallbackTop] : []);
    if (rowTops.length === 0) continue;
    for (let rowIndex = 0; rowIndex < rowTops.length; rowIndex += 1) {
      rows.push({
        visualLine: visualLineNumber,
        sourceLine: line.number,
        rowInSourceLine: rowIndex + 1,
        rowsInSourceLine: rowTops.length,
        sourceLineText: line.text,
      });
      visualLineNumber += 1;
    }
  }

  return rows;
}

export const visualLineNumberOverlayExtension = ViewPlugin.fromClass(
  class {
    private readonly dom: HTMLElement;
    private readonly hitArea: HTMLElement;
    private readonly view: EditorView;
    private readonly handleSelectionChange: () => void;
    private pendingMeasure = false;
    private signature = '';

    constructor(view: EditorView) {
      this.view = view;
      this.hitArea = document.createElement('div');
      this.hitArea.className = MARKDOWN_CODE_EDITOR_LINE_NUMBER_SELECTION_HIT_AREA_CLASS;
      view.dom.appendChild(this.hitArea);
      this.dom = document.createElement('div');
      this.dom.className = 'cm-ft-lineNumberOverlay';
      view.dom.appendChild(this.dom);
      this.handleSelectionChange = () => this.scheduleMeasure(this.view);
      view.dom.ownerDocument.addEventListener('selectionchange', this.handleSelectionChange);
      this.scheduleMeasure(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || update.geometryChanged || update.selectionSet) {
        this.scheduleMeasure(update.view);
      }
    }

    docViewUpdate(view: EditorView) {
      this.scheduleMeasure(view);
    }

    destroy() {
      this.view.dom.ownerDocument.removeEventListener('selectionchange', this.handleSelectionChange);
      this.hitArea.remove();
      this.dom.remove();
    }

    private scheduleMeasure(view: EditorView): void {
      if (this.pendingMeasure) return;
      this.pendingMeasure = true;
      view.requestMeasure({
        read: (measuredView) => buildVisualLineNumberOverlayRows(measuredView),
        write: (result, measuredView) => {
          this.pendingMeasure = false;
          if (result.signature === this.signature) return;
          this.signature = result.signature;
          this.render(result.rows, measuredView);
        },
      });
    }

    private render(rows: VisualLineNumberOverlayRow[], view: EditorView): void {
      const fragment = view.dom.ownerDocument.createDocumentFragment();
      for (const row of rows) {
        const element = view.dom.ownerDocument.createElement('div');
        element.className = row.selected
          ? `cm-ft-lineNumberOverlayNumber ${MARKDOWN_CODE_EDITOR_SELECTED_LINE_NUMBER_CLASS}`
          : 'cm-ft-lineNumberOverlayNumber';
        element.textContent = row.number;
        element.style.top = `${row.top}px`;
        fragment.appendChild(element);
      }
      this.dom.replaceChildren(fragment);
    }
  },
);

export function hasMarkdownCodeEditorRangeSelection(state: EditorState): boolean {
  return state.selection.ranges.some((range) => !range.empty);
}

function getMarkdownCodeEditorOffsetBeforeTrailingParagraphWhitespace(doc: Text, offset: number): number {
  let nextOffset = offset;
  let sawLineBreak = false;
  while (nextOffset > 0) {
    const previousChar = doc.sliceString(nextOffset - 1, nextOffset);
    if (previousChar === '\n') {
      sawLineBreak = true;
      nextOffset -= 1;
      continue;
    }
    if (sawLineBreak && (previousChar === ' ' || previousChar === '\t')) {
      nextOffset -= 1;
      continue;
    }
    break;
  }
  return sawLineBreak ? nextOffset : offset;
}

function getMarkdownCodeEditorSelectionWithoutTrailingLineStartForDoc(
  doc: Text,
  selection: EditorSelection,
): EditorSelection | null {
  let changed = false;
  const ranges = selection.ranges.map((range) => {
    if (range.empty) return range;
    let anchor = range.anchor;
    let head = range.head;
    if (head > anchor) {
      head = getMarkdownCodeEditorOffsetBeforeTrailingParagraphWhitespace(doc, head);
    } else if (anchor > head) {
      anchor = getMarkdownCodeEditorOffsetBeforeTrailingParagraphWhitespace(doc, anchor);
    }
    if (anchor === range.anchor && head === range.head) return range;
    changed = true;
    return EditorSelection.range(anchor, head);
  });
  return changed ? EditorSelection.create(ranges, selection.mainIndex) : null;
}

export function getMarkdownCodeEditorSelectionWithoutTrailingLineStart(state: EditorState): EditorSelection | null {
  return getMarkdownCodeEditorSelectionWithoutTrailingLineStartForDoc(state.doc, state.selection);
}

export function getRenderedMarkdownSelectionInsideListBody(state: EditorState): EditorSelection | null {
  let changed = false;
  const value = state.doc.toString();
  const ranges = state.selection.ranges.map((range) => {
    const clampListOffset = (offset: number): number => {
      const bodyStart = getRenderedMarkdownListBodyStartAtOffset(value, offset);
      return bodyStart === null || offset >= bodyStart ? offset : bodyStart;
    };
    const anchor = clampListOffset(range.anchor);
    const head = clampListOffset(range.head);
    if (anchor === range.anchor && head === range.head) return range;
    changed = true;
    return anchor === head ? EditorSelection.cursor(anchor) : EditorSelection.range(anchor, head);
  });
  return changed ? EditorSelection.create(ranges, state.selection.mainIndex) : null;
}

export const renderedMarkdownListCaretBoundaryExtension = ViewPlugin.fromClass(
  class {
    update(update: ViewUpdate): void {
      if (!update.selectionSet) return;
      const selection = getRenderedMarkdownSelectionInsideListBody(update.state);
      if (selection) update.view.dispatch({ selection });
    }
  },
);

export const trailingLineStartSelectionExtension = [
  EditorState.transactionFilter.of((tr) => {
    if (!tr.selection || tr.docChanged || tr.effects.length > 0) return tr;
    const selection = getMarkdownCodeEditorSelectionWithoutTrailingLineStartForDoc(
      tr.newDoc,
      tr.newSelection,
    );
    return selection ? { selection, scrollIntoView: tr.scrollIntoView } : tr;
  }),
  ViewPlugin.fromClass(
    class {
      update(update: ViewUpdate): void {
        if (!update.selectionSet) return;
        const selection = getMarkdownCodeEditorSelectionWithoutTrailingLineStart(update.state);
        if (selection) update.view.dispatch({ selection });
      }
    },
  ),
];

export const rangeSelectionClassExtension = ViewPlugin.fromClass(
  class {
    constructor(view: EditorView) {
      this.updateClass(view);
    }

    update(update: ViewUpdate): void {
      if (update.selectionSet || update.docChanged) {
        this.updateClass(update.view);
      }
    }

    private updateClass(view: EditorView): void {
      view.dom.classList.toggle(
        MARKDOWN_CODE_EDITOR_HAS_RANGE_SELECTION_CLASS,
        hasMarkdownCodeEditorRangeSelection(view.state),
      );
    }
  },
);

export const selectedLineNumberGutterExtension = gutterLineClass.compute(['selection'], (state) => {
  const builder = new RangeSetBuilder<GutterMarker>();
  let lastLineFrom = -1;
  for (const range of state.selection.ranges) {
    const fromLine = state.doc.lineAt(range.from);
    const toLine = state.doc.lineAt(Math.max(range.from, range.to - (range.empty ? 0 : 1)));
    for (let lineNumber = fromLine.number; lineNumber <= toLine.number; lineNumber += 1) {
      const line = state.doc.line(lineNumber);
      if (line.from <= lastLineFrom) continue;
      lastLineFrom = line.from;
      builder.add(line.from, line.from, selectedLineNumberMarker);
    }
  }
  return builder.finish();
});

const markdownCodeEditorFindQueryFacet = Facet.define<string, string>({
  combine: (values) => values[0] ?? '',
});

export function getMarkdownCodeEditorFindMatchRanges(
  value: string,
  query: string,
): Array<{ from: number; to: number }> {
  const needle = query.trim();
  if (!needle) return [];
  const ranges: Array<{ from: number; to: number }> = [];
  const haystack = value.toLowerCase();
  const normalizedNeedle = needle.toLowerCase();
  let index = haystack.indexOf(normalizedNeedle);
  while (index >= 0) {
    ranges.push({ from: index, to: index + normalizedNeedle.length });
    index = haystack.indexOf(normalizedNeedle, index + normalizedNeedle.length);
  }
  return ranges;
}

export function buildMarkdownCodeEditorFindMatchDecorations(state: EditorState): DecorationSet {
  const query = state.facet(markdownCodeEditorFindQueryFacet).trim();
  const builder = new RangeSetBuilder<Decoration>();
  if (!query) return builder.finish();
  const decoration = Decoration.mark({ class: MARKDOWN_CODE_EDITOR_FIND_MATCH_CLASS });
  for (const range of getMarkdownCodeEditorFindMatchRanges(
    state.doc.toString(),
    query,
  )) {
    builder.add(range.from, range.to, decoration);
  }
  return builder.finish();
}

export const markdownCodeEditorFindMatchExtension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildMarkdownCodeEditorFindMatchDecorations(view.state);
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged
        || update.startState.facet(markdownCodeEditorFindQueryFacet) !== update.state.facet(markdownCodeEditorFindQueryFacet)
      ) {
        this.decorations = buildMarkdownCodeEditorFindMatchDecorations(update.state);
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
  },
);

function renderedMarkdownSourceAttributes(from: number, to: number): Record<string, string> {
  return {
    [RENDERED_MARKDOWN_EDITOR_SOURCE_FROM_ATTR]: String(from),
    [RENDERED_MARKDOWN_EDITOR_SOURCE_TO_ATTR]: String(to),
  };
}

function applyRenderedMarkdownSourceAttributes(element: HTMLElement, from: number, to: number): void {
  element.setAttribute('aria-hidden', 'true');
  element.setAttribute(RENDERED_MARKDOWN_EDITOR_SOURCE_FROM_ATTR, String(from));
  element.setAttribute(RENDERED_MARKDOWN_EDITOR_SOURCE_TO_ATTR, String(to));
}

class RenderedMarkdownMarkerWidget extends WidgetType {
  constructor(
    private readonly className: string,
    private readonly textContent: string,
    private readonly sourceFrom: number,
    private readonly sourceTo: number,
  ) {
    super();
  }

  eq(other: RenderedMarkdownMarkerWidget): boolean {
    return other.className === this.className
      && other.textContent === this.textContent
      && other.sourceFrom === this.sourceFrom
      && other.sourceTo === this.sourceTo;
  }

  toDOM(): HTMLElement {
    const marker = document.createElement('span');
    marker.className = this.className;
    marker.textContent = this.textContent;
    applyRenderedMarkdownSourceAttributes(marker, this.sourceFrom, this.sourceTo);
    return marker;
  }
}

class RenderedMarkdownEmptyListBodyWidget extends WidgetType {
  toDOM(): HTMLElement {
    const body = document.createElement('span');
    body.className = `${RENDERED_MARKDOWN_EDITOR_LIST_BODY_CLASS} ${RENDERED_MARKDOWN_EDITOR_LIST_EMPTY_BODY_CLASS}`;
    return body;
  }
}

function parseNullableMarkdownSourceOffset(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function getRenderedMarkdownImagePreviewFromEventTarget(target: EventTarget | null): MarkdownCodeEditorImagePreview | null {
  if (!(target instanceof Element)) return null;
  if (target.closest(`.${RENDERED_MARKDOWN_EDITOR_IMAGE_CAPTION_TEXT_CLASS}`)) return null;
  const image = target.closest(`.${RENDERED_MARKDOWN_EDITOR_IMAGE_CLASS}`);
  if (!(image instanceof HTMLElement)) return null;
  if (target === image) return null;
  const src = image.getAttribute(RENDERED_MARKDOWN_EDITOR_IMAGE_SRC_ATTR);
  if (!src) return null;
  return {
    src,
    alt: image.getAttribute(RENDERED_MARKDOWN_EDITOR_IMAGE_ALT_ATTR) || 'Image',
    sourceFrom: parseNullableMarkdownSourceOffset(image.getAttribute(RENDERED_MARKDOWN_EDITOR_SOURCE_FROM_ATTR)),
    sourceTo: parseNullableMarkdownSourceOffset(image.getAttribute(RENDERED_MARKDOWN_EDITOR_SOURCE_TO_ATTR)),
  };
}

export function getRenderedMarkdownImageSelectionFromEventTarget(target: EventTarget | null): { from: number; to: number } | null {
  if (!(target instanceof Element)) return null;
  if (target.closest(`.${RENDERED_MARKDOWN_EDITOR_IMAGE_CAPTION_CLASS}, .${RENDERED_MARKDOWN_EDITOR_IMAGE_EDIT_CLASS}`)) return null;
  const bookmark = target.closest(`.${RENDERED_MARKDOWN_EDITOR_BOOKMARK_CLASS}`);
  if (bookmark instanceof HTMLElement) {
    const sourceFrom = parseNullableMarkdownSourceOffset(bookmark.getAttribute(RENDERED_MARKDOWN_EDITOR_SOURCE_FROM_ATTR));
    const sourceTo = parseNullableMarkdownSourceOffset(bookmark.getAttribute(RENDERED_MARKDOWN_EDITOR_SOURCE_TO_ATTR));
    if (sourceFrom !== null && sourceTo !== null && sourceTo > sourceFrom) return { from: sourceFrom, to: sourceTo };
  }
  const image = target.closest(`.${RENDERED_MARKDOWN_EDITOR_IMAGE_CLASS}`);
  if (!(image instanceof HTMLElement) || target !== image) return null;
  const sourceFrom = parseNullableMarkdownSourceOffset(image.getAttribute(RENDERED_MARKDOWN_EDITOR_SOURCE_FROM_ATTR));
  const sourceTo = parseNullableMarkdownSourceOffset(image.getAttribute(RENDERED_MARKDOWN_EDITOR_SOURCE_TO_ATTR));
  if (sourceFrom === null || sourceTo === null || sourceTo <= sourceFrom) return null;
  return { from: sourceFrom, to: sourceTo };
}

export function getRenderedMarkdownInlineHtmlSelectionFromEventTarget(target: EventTarget | null): MarkdownCodeEditorSourceRange | null {
  if (!(target instanceof Element)) return null;
  const block = target.closest(`.${RENDERED_MARKDOWN_EDITOR_INLINE_HTML_CLASS}`);
  if (!(block instanceof HTMLElement)) return null;
  const sourceFrom = parseNullableMarkdownSourceOffset(block.getAttribute(RENDERED_MARKDOWN_EDITOR_SOURCE_FROM_ATTR));
  const sourceTo = parseNullableMarkdownSourceOffset(block.getAttribute(RENDERED_MARKDOWN_EDITOR_SOURCE_TO_ATTR));
  if (sourceFrom === null || sourceTo === null || sourceTo <= sourceFrom) return null;
  return { from: sourceFrom, to: sourceTo };
}

function commitRenderedMarkdownDrawingCaption(view: EditorView, target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const captionText = target.closest(`.${RENDERED_MARKDOWN_EDITOR_IMAGE_CAPTION_TEXT_CLASS}`);
  if (!(captionText instanceof HTMLElement)) return false;
  const image = captionText.closest(`.${RENDERED_MARKDOWN_EDITOR_IMAGE_CLASS}`);
  if (!(image instanceof HTMLElement)) return false;
  const sourceFrom = parseNullableMarkdownSourceOffset(image.getAttribute(RENDERED_MARKDOWN_EDITOR_SOURCE_FROM_ATTR));
  const sourceTo = parseNullableMarkdownSourceOffset(image.getAttribute(RENDERED_MARKDOWN_EDITOR_SOURCE_TO_ATTR));
  if (sourceFrom === null || sourceTo === null) return false;
  const currentAlt = image.getAttribute(RENDERED_MARKDOWN_EDITOR_IMAGE_ALT_ATTR) || 'Drawing';
  if (!isRenderedMarkdownDrawingAlt(currentAlt)) return false;
  const nextTitle = captionText.textContent?.trim() || 'Drawing';
  const nextAlt = formatRenderedMarkdownDrawingAlt(nextTitle);
  if (nextAlt === currentAlt) return false;
  const edit = getMarkdownImageAltEditAtSource(view.state.doc.toString(), sourceFrom, sourceTo, nextAlt);
  if (!edit) return false;
  view.dispatch({
    changes: edit,
    selection: { anchor: edit.from + edit.insert.length },
    annotations: Transaction.userEvent.of('input'),
  });
  return true;
}

function createRenderedMarkdownDrawingEditIcon(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  const paper = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  paper.setAttribute('d', 'M5 4h10l4 4v12H5z');
  paper.setAttribute('fill', 'none');
  paper.setAttribute('stroke', 'currentColor');
  paper.setAttribute('stroke-width', '1.8');
  paper.setAttribute('stroke-linejoin', 'round');

  const fold = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  fold.setAttribute('d', 'M15 4v4h4');
  fold.setAttribute('fill', 'none');
  fold.setAttribute('stroke', 'currentColor');
  fold.setAttribute('stroke-width', '1.8');
  fold.setAttribute('stroke-linejoin', 'round');

  const pen = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  pen.setAttribute('d', 'M8 16.5l.7-3.1 6.8-6.8 2.4 2.4-6.8 6.8z');
  pen.setAttribute('fill', 'none');
  pen.setAttribute('stroke', 'currentColor');
  pen.setAttribute('stroke-width', '1.8');
  pen.setAttribute('stroke-linecap', 'round');
  pen.setAttribute('stroke-linejoin', 'round');

  svg.appendChild(paper);
  svg.appendChild(fold);
  svg.appendChild(pen);
  return svg;
}

class RenderedMarkdownImageWidget extends WidgetType {
  constructor(
    private readonly alt: string,
    private readonly destination: string,
    private readonly documentPath: string | null | undefined,
    private readonly sourceFrom: number,
    private readonly sourceTo: number,
    private readonly className = '',
  ) {
    super();
  }

  eq(other: RenderedMarkdownImageWidget): boolean {
    return other.alt === this.alt
      && other.destination === this.destination
      && other.documentPath === this.documentPath
      && other.sourceFrom === this.sourceFrom
      && other.sourceTo === this.sourceTo
      && other.className === this.className;
  }

  ignoreEvent(event: Event): boolean {
    return !['click', 'mousedown', 'keydown', 'focusout'].includes(event.type);
  }

  toDOM(): HTMLElement {
    const image = document.createElement('span');
    image.className = [RENDERED_MARKDOWN_EDITOR_IMAGE_CLASS, this.className].filter(Boolean).join(' ');
    image.setAttribute(RENDERED_MARKDOWN_EDITOR_SOURCE_FROM_ATTR, String(this.sourceFrom));
    image.setAttribute(RENDERED_MARKDOWN_EDITOR_SOURCE_TO_ATTR, String(this.sourceTo));

    const src = normalizeMarkdownImageUrl(this.destination, this.documentPath);
    const alt = this.alt || 'Image';
    const isDrawing = isRenderedMarkdownDrawingAlt(alt);
    if (src) {
      if (isDrawing) image.classList.add(RENDERED_MARKDOWN_EDITOR_DRAWING_IMAGE_CLASS);
      image.setAttribute(RENDERED_MARKDOWN_EDITOR_IMAGE_SRC_ATTR, src);
      image.setAttribute(RENDERED_MARKDOWN_EDITOR_IMAGE_ALT_ATTR, alt);
      image.setAttribute('role', 'button');
      image.setAttribute('aria-label', isDrawing ? 'Edit drawing' : `Preview ${alt}`);
      const preview = document.createElement('img');
      preview.src = src;
      preview.alt = alt;
      if (isDrawing) {
        const frame = document.createElement('span');
        frame.className = RENDERED_MARKDOWN_EDITOR_IMAGE_FRAME_CLASS;
        frame.appendChild(preview);
        image.appendChild(frame);
      } else {
        image.appendChild(preview);
      }
    }

    const caption = document.createElement('span');
    caption.className = RENDERED_MARKDOWN_EDITOR_IMAGE_CAPTION_CLASS;
    const captionText = document.createElement('span');
    captionText.className = RENDERED_MARKDOWN_EDITOR_IMAGE_CAPTION_TEXT_CLASS;
    captionText.textContent = isDrawing ? getRenderedMarkdownDrawingTitle(alt) : alt;
    if (isDrawing) {
      captionText.contentEditable = 'true';
      captionText.spellcheck = false;
      captionText.setAttribute('role', 'textbox');
      captionText.setAttribute('aria-label', 'Drawing name');
      captionText.setAttribute('data-placeholder', 'Drawing');
      if (src) {
        const editButton = document.createElement('button');
        editButton.type = 'button';
        editButton.className = RENDERED_MARKDOWN_EDITOR_IMAGE_EDIT_CLASS;
        editButton.appendChild(createRenderedMarkdownDrawingEditIcon());
        editButton.setAttribute('aria-label', 'Edit drawing');
        caption.appendChild(captionText);
        caption.appendChild(editButton);
      } else {
        caption.appendChild(captionText);
      }
    } else {
      caption.appendChild(captionText);
    }
    image.appendChild(caption);

    return image;
  }
}

function renderedMarkdownBookmarkTitle(bookmark: Bookmark | null, fallbackAlt: string, bookmarkId: string): string {
  if (!bookmark) return fallbackAlt || `Bookmark ${bookmarkId}`;
  if (bookmark.sourceType === 'web') return bookmark.title || bookmark.domain || bookmark.url || fallbackAlt || 'Bookmark';
  return bookmark.authorName || (bookmark.authorHandle ? `@${bookmark.authorHandle}` : fallbackAlt || 'Bookmark');
}

function renderedMarkdownBookmarkBody(bookmark: Bookmark | null): string {
  if (!bookmark) return '';
  return bookmark.sourceType === 'web'
    ? bookmark.excerpt || bookmark.text
    : bookmark.text;
}

function renderedMarkdownBookmarkMeta(bookmark: Bookmark | null, bookmarkId: string): string {
  if (!bookmark) return bookmarkId;
  if (bookmark.sourceType === 'web') return bookmark.domain || bookmark.url;
  return bookmark.authorHandle ? `@${bookmark.authorHandle}` : bookmark.url;
}

class RenderedMarkdownBookmarkWidget extends WidgetType {
  constructor(
    private readonly bookmarkId: string,
    private readonly alt: string,
    private readonly bookmark: Bookmark | null,
    private readonly sourceFrom: number,
    private readonly sourceTo: number,
    private readonly className = '',
  ) {
    super();
  }

  eq(other: RenderedMarkdownBookmarkWidget): boolean {
    return other.bookmarkId === this.bookmarkId
      && other.alt === this.alt
      && other.bookmark === this.bookmark
      && other.sourceFrom === this.sourceFrom
      && other.sourceTo === this.sourceTo
      && other.className === this.className;
  }

  ignoreEvent(event: Event): boolean {
    return !['click', 'mousedown'].includes(event.type);
  }

  toDOM(): HTMLElement {
    const root = document.createElement('span');
    root.className = [RENDERED_MARKDOWN_EDITOR_BOOKMARK_CLASS, this.className].filter(Boolean).join(' ');
    root.setAttribute(RENDERED_MARKDOWN_EDITOR_SOURCE_FROM_ATTR, String(this.sourceFrom));
    root.setAttribute(RENDERED_MARKDOWN_EDITOR_SOURCE_TO_ATTR, String(this.sourceTo));
    root.setAttribute(RENDERED_MARKDOWN_EDITOR_BOOKMARK_ID_ATTR, this.bookmarkId);
    root.setAttribute('role', 'button');
    root.setAttribute('aria-label', `Bookmark ${renderedMarkdownBookmarkTitle(this.bookmark, this.alt, this.bookmarkId)}`);

    const title = document.createElement('span');
    title.className = `${RENDERED_MARKDOWN_EDITOR_BOOKMARK_CLASS}__title`;
    title.textContent = renderedMarkdownBookmarkTitle(this.bookmark, this.alt, this.bookmarkId);
    root.appendChild(title);

    const bodyText = renderedMarkdownBookmarkBody(this.bookmark);
    if (bodyText) {
      const body = document.createElement('span');
      body.className = `${RENDERED_MARKDOWN_EDITOR_BOOKMARK_CLASS}__body`;
      body.textContent = bodyText;
      root.appendChild(body);
    }

    const metaText = renderedMarkdownBookmarkMeta(this.bookmark, this.bookmarkId);
    if (metaText) {
      const meta = document.createElement('span');
      meta.className = `${RENDERED_MARKDOWN_EDITOR_BOOKMARK_CLASS}__meta`;
      meta.textContent = metaText;
      root.appendChild(meta);
    }

    return root;
  }
}

class RenderedMarkdownInlineHtmlWidget extends WidgetType {
  constructor(
    private readonly html: string,
    private readonly documentPath: string | null | undefined,
    private readonly sourceFrom: number,
    private readonly sourceTo: number,
  ) {
    super();
  }

  eq(other: RenderedMarkdownInlineHtmlWidget): boolean {
    return other.html === this.html
      && other.documentPath === this.documentPath
      && other.sourceFrom === this.sourceFrom
      && other.sourceTo === this.sourceTo;
  }

  ignoreEvent(event: Event): boolean {
    return !['click', 'mousedown'].includes(event.type);
  }

  toDOM(): HTMLElement {
    const block = document.createElement('figure');
    block.className = RENDERED_MARKDOWN_EDITOR_INLINE_HTML_CLASS;
    block.setAttribute(RENDERED_MARKDOWN_EDITOR_SOURCE_FROM_ATTR, String(this.sourceFrom));
    block.setAttribute(RENDERED_MARKDOWN_EDITOR_SOURCE_TO_ATTR, String(this.sourceTo));
    block.setAttribute('data-ft-inline-html-block', 'true');

    const toolbar = document.createElement('div');
    toolbar.className = `${RENDERED_MARKDOWN_EDITOR_INLINE_HTML_CLASS}__toolbar`;
    const caption = document.createElement('figcaption');
    caption.textContent = 'HTML';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.textContent = 'Expand';
    toggle.setAttribute('aria-label', 'Expand HTML block');
    toggle.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    toggle.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const expanded = block.classList.toggle(RENDERED_MARKDOWN_EDITOR_INLINE_HTML_EXPANDED_CLASS);
      toggle.textContent = expanded ? 'Collapse' : 'Expand';
      toggle.setAttribute('aria-label', expanded ? 'Collapse HTML block' : 'Expand HTML block');
    });
    toolbar.appendChild(caption);
    toolbar.appendChild(toggle);

    const frame = document.createElement('iframe');
    frame.title = 'Inline HTML block';
    frame.srcdoc = getHtmlPreviewSrcDoc(this.html, this.documentPath || '/');
    frame.setAttribute('sandbox', '');
    frame.setAttribute('data-ft-inline-html-preview', 'true');

    block.appendChild(toolbar);
    block.appendChild(frame);
    return block;
  }
}

class RenderedMarkdownTaskCheckboxWidget extends WidgetType {
  constructor(
    private readonly checked: boolean,
    private readonly sourceFrom: number,
    private readonly sourceTo: number,
    private readonly checkFrom: number,
    private readonly checkTo: number,
    private readonly contentFrom: number,
  ) {
    super();
  }

  eq(other: RenderedMarkdownTaskCheckboxWidget): boolean {
    return other.checked === this.checked
      && other.sourceFrom === this.sourceFrom
      && other.sourceTo === this.sourceTo
      && other.checkFrom === this.checkFrom
      && other.checkTo === this.checkTo
      && other.contentFrom === this.contentFrom;
  }

  toDOM(view: EditorView): HTMLElement {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = this.checked;
    checkbox.tabIndex = -1;
    checkbox.className = RENDERED_MARKDOWN_EDITOR_TASK_MARKER_CLASS;
    checkbox.setAttribute('aria-label', this.checked ? 'Mark task incomplete' : 'Mark task complete');
    checkbox.setAttribute(RENDERED_MARKDOWN_EDITOR_SOURCE_FROM_ATTR, String(this.sourceFrom));
    checkbox.setAttribute(RENDERED_MARKDOWN_EDITOR_SOURCE_TO_ATTR, String(this.sourceTo));
    checkbox.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    checkbox.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    checkbox.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const shouldRestoreFocus = view.hasFocus;
      view.dispatch({
        changes: {
          from: this.checkFrom,
          to: this.checkTo,
          insert: this.checked ? ' ' : 'x',
        },
      });
      if (shouldRestoreFocus) {
        window.setTimeout(() => view.focus(), 0);
      }
    });
    return checkbox;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

type RenderedMarkdownDecoration = Range<Decoration>;

const renderedMarkdownDocumentPathFacet = Facet.define<string | null, string | null>({
  combine: (values) => values[0] ?? null,
});
const renderedMarkdownBookmarksVersionFacet = Facet.define<number, number>({
  combine: (values) => values[0] ?? 0,
});
type RenderedMarkdownEditorRange = { from: number; to: number };
type RenderedMarkdownEditorLineRange = { fromLine: number; toLine: number };
export type RenderedMarkdownInlineHtmlBlock = {
  from: number;
  to: number;
  content: string;
  fromLine: number;
  toLine: number;
};

function rangesIntersect(
  first: { from: number; to: number },
  second: { from: number; to: number },
): boolean {
  return first.from < second.to && second.from < first.to;
}

export function getRenderedMarkdownInlineHtmlBlockRanges(value: string): RenderedMarkdownInlineHtmlBlock[] {
  const blocks: RenderedMarkdownInlineHtmlBlock[] = [];
  let active: {
    fence: string;
    from: number;
    contentFrom: number;
    fromLine: number;
  } | null = null;

  const lines = value.split('\n');
  let offset = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const text = lines[index];
    const lineNumber = index + 1;
    const lineFrom = offset;
    const lineTo = offset + text.length;
    if (!active) {
      const startMatch = /^(`{3,}|~{3,})\s*ft-html\s*$/.exec(text);
      if (startMatch) {
        active = {
          fence: startMatch[1],
          from: lineFrom,
          contentFrom: lineTo + 1,
          fromLine: lineNumber,
        };
      }
      offset = lineTo + 1;
      continue;
    }

    const closeMatch = new RegExp(`^${active.fence[0]}{${active.fence.length},}\\s*$`).exec(text);
    if (!closeMatch) {
      offset = lineTo + 1;
      continue;
    }
    const contentTo = Math.max(active.contentFrom, lineFrom - 1);
    blocks.push({
      from: active.from,
      to: lineTo,
      content: value.slice(active.contentFrom, contentTo),
      fromLine: active.fromLine,
      toLine: lineNumber,
    });
    active = null;
    offset = lineTo + 1;
  }

  return blocks;
}

export function getRenderedMarkdownInlineHtmlBlocks(state: EditorState): RenderedMarkdownInlineHtmlBlock[] {
  return getRenderedMarkdownInlineHtmlBlockRanges(state.doc.toString());
}

export function getRenderedMarkdownInlineHtmlBlockRangeAt(
  value: string,
  from: number,
  to = from,
): MarkdownCodeEditorSourceRange | null {
  const selectionStart = Math.max(0, Math.min(from, value.length));
  const selectionEnd = Math.max(selectionStart, Math.min(to, value.length));
  return getRenderedMarkdownInlineHtmlBlockRanges(value).find((block) => (
    selectionStart < block.to && selectionEnd > block.from
  )) ?? null;
}

export function isRenderedMarkdownSelectionInsideInlineHtmlBlock(
  value: string,
  from: number,
  to = from,
): boolean {
  const block = getRenderedMarkdownInlineHtmlBlockRangeAt(value, from, to);
  if (!block) return false;
  if (from !== to) return true;
  return from > block.from && to < block.to;
}

function getRenderedMarkdownInlineHtmlBoundaryTextEdit(
  value: string,
  offset: number,
  text: string,
): { from: number; insert: string; selection: number } | null {
  if (!text) return null;
  const block = getRenderedMarkdownInlineHtmlBlockRanges(value).find((candidate) => (
    offset === candidate.from || offset === candidate.to
  ));
  if (!block) return null;
  if (offset === block.from) {
    const separator = value.slice(Math.max(0, offset - 2), offset) === '\n\n' ? '\n\n' : '\n';
    return {
      from: offset,
      insert: `${text}${separator}`,
      selection: offset + text.length,
    };
  }
  if (value.slice(offset, offset + 2) === '\n\n') {
    return {
      from: offset + 2,
      insert: text,
      selection: offset + 2 + text.length,
    };
  }
  return {
    from: offset,
    insert: `\n\n${text}`,
    selection: offset + 2 + text.length,
  };
}

function pushRenderedSyntaxReplacement(
  decorations: RenderedMarkdownDecoration[],
  from: number,
  to: number,
  widget?: WidgetType,
): void {
  if (to > from) {
    decorations.push(Decoration.replace(widget ? { widget } : {}).range(from, to));
  }
}

function pushRenderedInlineMark(
  decorations: RenderedMarkdownDecoration[],
  from: number,
  to: number,
  className: string,
  attributes?: Record<string, string>,
): void {
  if (to > from && className) {
    decorations.push(Decoration.mark({ class: className, attributes }).range(from, to));
  }
}

export function getRenderedMarkdownListIndentStyle(leadingWhitespace: string): string {
  const indentCh = Array.from(leadingWhitespace).reduce((total, char) => total + (char === '\t' ? 2 : 1), 0);
  return `--ft-rendered-list-indent: ${indentCh}ch;`;
}

function pushRenderedListLineDecoration(
  decorations: RenderedMarkdownDecoration[],
  lineFrom: number,
  leadingWhitespace: string,
): void {
  decorations.push(Decoration.line({
    class: RENDERED_MARKDOWN_EDITOR_LIST_LINE_CLASS,
    attributes: { style: getRenderedMarkdownListIndentStyle(leadingWhitespace) },
  }).range(lineFrom));
}

function pushRenderedListBodyDecoration(
  decorations: RenderedMarkdownDecoration[],
  from: number,
  to: number,
  className = '',
): void {
  if (from === to) {
    decorations.push(Decoration.widget({
      widget: new RenderedMarkdownEmptyListBodyWidget(),
      side: 1,
    }).range(from));
    return;
  }
  pushRenderedInlineMark(
    decorations,
    from,
    to,
    [RENDERED_MARKDOWN_EDITOR_LIST_BODY_CLASS, className].filter(Boolean).join(' '),
  );
}

export function getRenderedMarkdownListLineLayoutStyle(): Record<string, string> {
  return {
    position: 'relative',
    paddingLeft: 'calc(var(--ft-rendered-list-indent, 0ch) + 2em) !important',
    textIndent: '0 !important',
  };
}

export function getRenderedMarkdownListMarkerLayoutStyle(): Record<string, string> {
  return {
    display: 'inline-block',
    position: 'absolute',
    left: 'var(--ft-rendered-list-indent, 0ch)',
    width: '1.55em',
    textAlign: 'right',
  };
}

export function getRenderedMarkdownTaskMarkerLayoutStyle(): Record<string, string> {
  return {
    display: 'inline-block',
    position: 'absolute',
    left: 'calc(var(--ft-rendered-list-indent, 0ch) + 0.5em)',
    top: 'calc((var(--ft-line-number-row-height) - 0.9em) / 2)',
    width: '0.9em',
    height: '0.9em',
    minWidth: '0.9em',
  };
}

function getMarkdownLineBounds(value: string, offset: number): { lineStart: number; lineEnd: number } {
  const clampedOffset = Math.max(0, Math.min(value.length, offset));
  const lineStart = clampedOffset === 0 ? 0 : value.lastIndexOf('\n', clampedOffset - 1) + 1;
  const lineEndIndex = value.indexOf('\n', lineStart);
  const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex;
  return { lineStart, lineEnd };
}

function getRenderedMarkdownListBodyOffsetInLine(text: string): number | null {
  const taskMatch = /^(\s*)((?:[-*+]\s+)?)\[([ xX]?)\](\s*)/.exec(text);
  if (taskMatch) return taskMatch[0].length;
  const listMatch = /^(\s*)((?:[-*+])|(?:\d+[.)]))\s+/.exec(text);
  return listMatch ? listMatch[0].length : null;
}

function getRenderedMarkdownBlockBodyOffsetInLine(text: string): number | null {
  const headingMatch = /^(#{1,3})\s+/.exec(text);
  if (headingMatch) return headingMatch[0].length;
  const quoteMatch = /^(\s*)>\s?/.exec(text);
  if (quoteMatch) return quoteMatch[0].length;
  return getRenderedMarkdownListBodyOffsetInLine(text);
}

export function getRenderedMarkdownListBodyStartForLine(value: string, lineStart: number): number | null {
  const safeLineStart = Math.max(0, Math.min(value.length, lineStart));
  const lineEndIndex = value.indexOf('\n', safeLineStart);
  const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex;
  const markerLength = getRenderedMarkdownListBodyOffsetInLine(value.slice(safeLineStart, lineEnd));
  return markerLength === null ? null : safeLineStart + markerLength;
}

function getRenderedMarkdownListBodyStartAtOffset(value: string, offset: number): number | null {
  return getRenderedMarkdownListBodyStartForLine(value, getMarkdownLineBounds(value, offset).lineStart);
}

export function getRenderedMarkdownBlockBodyStartForLine(value: string, lineStart: number): number | null {
  const safeLineStart = Math.max(0, Math.min(value.length, lineStart));
  const lineEndIndex = value.indexOf('\n', safeLineStart);
  const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex;
  const markerLength = getRenderedMarkdownBlockBodyOffsetInLine(value.slice(safeLineStart, lineEnd));
  return markerLength === null ? null : safeLineStart + markerLength;
}

function getRenderedMarkdownBlockBodyStartAtOffset(value: string, offset: number): number | null {
  return getRenderedMarkdownBlockBodyStartForLine(value, getMarkdownLineBounds(value, offset).lineStart);
}

export function getRenderedMarkdownEmptyTaskDeleteBackwardEdit(
  value: string,
  offset: number,
): { from: number; to: number; selection: number } | null {
  const caret = Math.max(0, Math.min(value.length, offset));
  const { lineStart, lineEnd } = getMarkdownLineBounds(value, caret);
  const lineText = value.slice(lineStart, lineEnd);
  const taskMatch = /^(\s*)((?:[-*+]\s+)?)\[([ xX]?)\](\s*)$/.exec(lineText);
  if (!taskMatch) return null;
  const bodyStart = lineStart + taskMatch[0].length;
  if (caret !== bodyStart) return null;
  if (lineStart === 0 && lineEnd === value.length) {
    return { from: 0, to: value.length, selection: 0 };
  }
  if (lineEnd < value.length) {
    return { from: lineStart, to: lineEnd + 1, selection: lineStart };
  }
  return { from: lineStart - 1, to: lineEnd, selection: lineStart - 1 };
}

export function getRenderedMarkdownListBodyStart(value: string, offset: number): number | null {
  const clampedOffset = Math.max(0, Math.min(value.length, offset));
  const { lineStart, lineEnd } = getMarkdownLineBounds(value, clampedOffset);
  const bodyStart = getRenderedMarkdownListBodyStartForLine(value, lineStart);
  if (bodyStart === null) return null;
  const isEmptyListBody = bodyStart === lineEnd;
  const isInsideHiddenMarker = clampedOffset >= lineStart && clampedOffset < bodyStart;
  const isEmptyBodyStart = isEmptyListBody && clampedOffset === bodyStart;
  return isInsideHiddenMarker || isEmptyBodyStart ? bodyStart : null;
}

export function getRenderedMarkdownBlockBodyStart(value: string, offset: number): number | null {
  const clampedOffset = Math.max(0, Math.min(value.length, offset));
  const { lineStart, lineEnd } = getMarkdownLineBounds(value, clampedOffset);
  const bodyStart = getRenderedMarkdownBlockBodyStartForLine(value, lineStart);
  if (bodyStart === null) return null;
  const isEmptyBlockBody = bodyStart === lineEnd;
  const isInsideHiddenMarker = clampedOffset >= lineStart && clampedOffset < bodyStart;
  const isEmptyBodyStart = isEmptyBlockBody && clampedOffset === bodyStart;
  return isInsideHiddenMarker || isEmptyBodyStart ? bodyStart : null;
}

export function getRenderedMarkdownListBodyClickPosition(
  value: string,
  offset: number,
  event: MouseEvent,
): number | null {
  if (event.button !== 0 || event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return null;
  return getRenderedMarkdownListBodyStart(value, offset);
}

export function getRenderedMarkdownBlockBodyClickPosition(
  value: string,
  offset: number,
  event: MouseEvent,
): number | null {
  if (event.button !== 0 || event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return null;
  return getRenderedMarkdownBlockBodyStart(value, offset);
}

export function handleRenderedMarkdownEditorBeforeInput(view: EditorView, input: InputEvent): boolean {
  const selection = view.state.selection.main;
  if (isRenderedMarkdownSelectionInsideInlineHtmlBlock(view.state.doc.toString(), selection.from, selection.to)) {
    return true;
  }
  if (!selection.empty) return false;

  if (input.inputType === 'deleteContentBackward' && !input.isComposing) {
    const value = view.state.doc.toString();
    const emptyTaskEdit = getRenderedMarkdownEmptyTaskDeleteBackwardEdit(value, selection.from);
    if (emptyTaskEdit) {
      view.dispatch({
        changes: { from: emptyTaskEdit.from, to: emptyTaskEdit.to },
        selection: { anchor: emptyTaskEdit.selection, head: emptyTaskEdit.selection },
      });
      return true;
    }
    const bodyStart = getRenderedMarkdownBlockBodyStartAtOffset(value, selection.from);
    if (bodyStart !== null && selection.from <= bodyStart) {
      if (selection.from !== bodyStart) {
        view.dispatch({ selection: { anchor: bodyStart, head: bodyStart } });
      }
      return true;
    }
  }

  if ((input.inputType === 'insertParagraph' || input.inputType === 'insertLineBreak') && !input.isComposing) {
    const value = view.state.doc.toString();
    const edit = getRenderedMarkdownFormattingBoundaryLineBreakEdit(value, selection.from)
      ?? getRenderedMarkdownAtomicBoundaryLineBreakEdit(value, selection.from);
    if (!edit) return false;
    view.dispatch({
      changes: { from: edit.insertAt, insert: '\n' },
      selection: { anchor: edit.selection },
    });
    return true;
  }

  if (input.inputType !== 'insertText' || !input.data || input.isComposing) return false;
  const inlineHtmlBoundaryEdit = getRenderedMarkdownInlineHtmlBoundaryTextEdit(
    view.state.doc.toString(),
    selection.from,
    input.data,
  );
  if (inlineHtmlBoundaryEdit) {
    view.dispatch({
      changes: { from: inlineHtmlBoundaryEdit.from, insert: inlineHtmlBoundaryEdit.insert },
      selection: { anchor: inlineHtmlBoundaryEdit.selection },
    });
    return true;
  }
  const bodyStart = getRenderedMarkdownBlockBodyStart(view.state.doc.toString(), selection.from);
  if (bodyStart === null || bodyStart === selection.from) return false;
  view.dispatch({
    changes: { from: bodyStart, insert: input.data },
    selection: { anchor: bodyStart + input.data.length },
  });
  return true;
}

export function getRenderedMarkdownFormattingBoundaryLineBreakEdit(
  value: string,
  offset: number,
): { insertAt: number; selection: number } | null {
  const caret = Math.max(0, Math.min(value.length, offset));
  const lineStart = caret === 0 ? 0 : value.lastIndexOf('\n', caret - 1) + 1;
  const lineEndIndex = value.indexOf('\n', caret);
  const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex;
  const line = value.slice(lineStart, lineEnd);
  const relativeCaret = caret - lineStart;
  const patterns = [
    /\*\*([^*\n]+)\*\*/g,
    /(?<!\*)\*([^*\n]+)\*(?!\*)/g,
    /~~([^~\n]+)~~/g,
    /<u>([^<\n]+)<\/u>/gi,
  ];

  for (const pattern of patterns) {
    for (const match of line.matchAll(pattern)) {
      if (match.index === undefined) continue;
      const contentStart = match.index + match[0].indexOf(match[1]);
      if (relativeCaret !== contentStart) continue;
      return {
        insertAt: lineStart + match.index,
        selection: lineStart + match.index,
      };
    }
  }

  return null;
}

type RenderedMarkdownInlineSourceRange = {
  from: number;
  to: number;
  contentFrom: number;
  contentTo: number;
  kind: 'formatting' | 'wiki' | 'atomic';
};

function collectRenderedMarkdownInlineSourceRanges(value: string, offset: number): RenderedMarkdownInlineSourceRange[] {
  const caret = Math.max(0, Math.min(value.length, offset));
  const lineStart = caret === 0 ? 0 : value.lastIndexOf('\n', caret - 1) + 1;
  const lineEndIndex = value.indexOf('\n', caret);
  const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex;
  const text = value.slice(lineStart, lineEnd);
  const ranges: RenderedMarkdownInlineSourceRange[] = [];
  const protectedRanges: Array<{ from: number; to: number }> = [];
  const protect = (from: number, to: number) => protectedRanges.push({ from, to });
  const isProtected = (from: number, to: number) => protectedRanges.some((range) => rangesIntersect(range, { from, to }));
  const pushRange = (
    from: number,
    to: number,
    contentFrom: number,
    contentTo: number,
    kind: RenderedMarkdownInlineSourceRange['kind'] = 'formatting',
  ) => {
    if (isProtected(from, to)) return;
    protect(from, to);
    ranges.push({ from, to, contentFrom, contentTo, kind });
  };

  for (const match of text.matchAll(/!\[([^\]\n]*)\]\((<[^>\n]+>|[^)\n]*)\)/g)) {
    if (match.index === undefined) continue;
    const from = lineStart + match.index;
    const to = from + match[0].length;
    pushRange(from, to, from, to, 'atomic');
  }

  for (const match of text.matchAll(/`([^`\n]+)`/g)) {
    if (match.index === undefined) continue;
    const from = lineStart + match.index;
    const to = from + match[0].length;
    pushRange(from, to, from + 1, to - 1);
  }

  for (const match of text.matchAll(/\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g)) {
    if (match.index === undefined) continue;
    const from = lineStart + match.index;
    const to = from + match[0].length;
    const targetFrom = from + 2;
    const targetTo = targetFrom + match[1].length;
    const aliasFrom = match[2] === undefined ? targetFrom : targetTo + 1;
    const aliasTo = match[2] === undefined ? targetTo : aliasFrom + match[2].length;
    pushRange(from, to, aliasFrom, aliasTo, 'wiki');
  }

  for (const match of text.matchAll(/\[([^\]\n]+)\]\(([^)\n]*)\)/g)) {
    if (match.index === undefined) continue;
    const from = lineStart + match.index;
    const labelFrom = from + 1;
    const labelTo = labelFrom + match[1].length;
    pushRange(from, from + match[0].length, labelFrom, labelTo);
  }

  for (const match of text.matchAll(/<u>([^<\n]+)<\/u>/gi)) {
    if (match.index === undefined) continue;
    const from = lineStart + match.index;
    const to = from + match[0].length;
    pushRange(from, to, from + 3, to - 4);
  }

  for (const match of text.matchAll(/~~([^~\n]+)~~/g)) {
    if (match.index === undefined) continue;
    const from = lineStart + match.index;
    const to = from + match[0].length;
    pushRange(from, to, from + 2, to - 2);
  }

  for (const match of text.matchAll(/\*\*([^*\n]+)\*\*/g)) {
    if (match.index === undefined) continue;
    const from = lineStart + match.index;
    const to = from + match[0].length;
    pushRange(from, to, from + 2, to - 2);
  }

  for (const match of text.matchAll(/(?<!\*)\*([^*\n]+)\*(?!\*)/g)) {
    if (match.index === undefined) continue;
    const from = lineStart + match.index;
    const to = from + match[0].length;
    pushRange(from, to, from + 1, to - 1);
  }

  return ranges;
}

export function getRenderedMarkdownAtomicBoundaryLineBreakEdit(
  value: string,
  offset: number,
): { insertAt: number; selection: number } | null {
  const caret = Math.max(0, Math.min(value.length, offset));
  for (const range of collectRenderedMarkdownInlineSourceRanges(value, caret)) {
    if (range.kind !== 'atomic') continue;
    if (caret === range.from) return { insertAt: range.from, selection: range.from };
    if (caret === range.to) return { insertAt: range.to, selection: range.to + 1 };
  }
  return null;
}

function getRenderedMarkdownSelectionOffsetOutsideHiddenSyntax(value: string, offset: number, previousOffset?: number): number {
  const caret = Math.max(0, Math.min(value.length, offset));
  const blockBodyStart = getRenderedMarkdownBlockBodyStartAtOffset(value, caret);
  if (blockBodyStart !== null && caret < blockBodyStart) return blockBodyStart;

  for (const range of collectRenderedMarkdownInlineSourceRanges(value, caret)) {
    if (range.kind === 'wiki') continue;
    if (range.kind === 'atomic' && caret > range.from && caret < range.to) {
      if (typeof previousOffset === 'number') {
        if (previousOffset <= range.from) return range.to;
        if (previousOffset >= range.to) return range.from;
      }
      return caret - range.from <= range.to - caret ? range.from : range.to;
    }
    if (caret > range.from && caret < range.contentFrom) return range.from;
    if (caret > range.contentTo && caret < range.to) return range.to;
  }

  return caret;
}

export function getRenderedMarkdownSelectionOutsideHiddenSyntax(state: EditorState, previousSelection?: EditorSelection): EditorSelection | null {
  const value = state.doc.toString();
  let changed = false;
  const ranges = state.selection.ranges.map((range, index) => {
    const previousRange = previousSelection?.ranges[index];
    const anchor = getRenderedMarkdownSelectionOffsetOutsideHiddenSyntax(value, range.anchor, previousRange?.anchor);
    const head = getRenderedMarkdownSelectionOffsetOutsideHiddenSyntax(value, range.head, previousRange?.head);
    if (anchor === range.anchor && head === range.head) return range;
    changed = true;
    return anchor === head ? EditorSelection.cursor(anchor) : EditorSelection.range(anchor, head);
  });
  return changed ? EditorSelection.create(ranges, state.selection.mainIndex) : null;
}

export const renderedMarkdownHiddenSyntaxSelectionExtension = [
  EditorState.transactionFilter.of((tr) => {
    if (!tr.selection || tr.docChanged || tr.effects.length > 0) return tr;
    const selection = getRenderedMarkdownSelectionOutsideHiddenSyntax(EditorState.create({
      doc: tr.newDoc,
      selection: tr.newSelection,
    }), tr.startState.selection);
    return selection ? { selection, scrollIntoView: tr.scrollIntoView } : tr;
  }),
  ViewPlugin.fromClass(
    class {
      update(update: ViewUpdate): void {
        if (!update.selectionSet) return;
        const selection = getRenderedMarkdownSelectionOutsideHiddenSyntax(update.state, update.startState.selection);
        if (selection) update.view.dispatch({ selection });
      }
    },
  ),
];

export function getRenderedMarkdownArrowRightEdit(value: string, offset: number): { selection: number } | null {
  const caret = Math.max(0, Math.min(value.length, offset));
  const { lineEnd } = getMarkdownLineBounds(value, caret);
  const blockBodyStart = getRenderedMarkdownBlockBodyStart(value, caret);
  if (blockBodyStart !== null) return { selection: blockBodyStart };
  const listBoundaryEdit = getMarkdownListArrowRightBoundaryEdit(value, caret);
  if (listBoundaryEdit) return listBoundaryEdit;
  if (caret === lineEnd && lineEnd < value.length) {
    const nextLineBlockBodyStart = getRenderedMarkdownBlockBodyStartForLine(value, lineEnd + 1);
    if (nextLineBlockBodyStart !== null && nextLineBlockBodyStart > lineEnd + 1) {
      return { selection: nextLineBlockBodyStart };
    }
  }
  for (const range of collectRenderedMarkdownInlineSourceRanges(value, caret)) {
    if (range.kind === 'wiki') continue;
    if (caret < range.contentTo || caret >= range.to) continue;
    const selection = range.to === lineEnd && lineEnd < value.length ? lineEnd + 1 : range.to;
    return selection === caret ? null : { selection };
  }
  return null;
}

export function getRenderedMarkdownArrowLeftEdit(value: string, offset: number): { selection: number } | null {
  const caret = Math.max(0, Math.min(value.length, offset));
  const { lineStart, lineEnd } = getMarkdownLineBounds(value, caret);
  const listBodyStart = getRenderedMarkdownListBodyStartAtOffset(value, caret);
  if (listBodyStart !== null && caret === listBodyStart && caret === lineEnd && lineStart > 0) {
    return { selection: lineStart - 1 };
  }
  const blockBodyStart = getRenderedMarkdownBlockBodyStartAtOffset(value, caret);
  if (blockBodyStart !== null && caret <= blockBodyStart && caret > lineStart) {
    return { selection: blockBodyStart };
  }
  for (const range of collectRenderedMarkdownInlineSourceRanges(value, caret)) {
    if (range.kind === 'wiki') continue;
    if (caret <= range.from || caret > range.contentFrom) continue;
    const selection = range.from === lineStart && lineStart > 0 ? lineStart - 1 : range.from;
    return selection === caret ? null : { selection };
  }
  return null;
}

export function getRenderedMarkdownOptionArrowEdit(
  value: string,
  offset: number,
  direction: 'left' | 'right',
): { selection: number } | null {
  const caret = Math.max(0, Math.min(value.length, offset));
  const ranges = collectRenderedMarkdownInlineSourceRanges(value, caret);
  if (direction === 'right') {
    for (const range of ranges) {
      if (caret < range.from || caret >= range.to) continue;
      return range.to === caret ? null : { selection: range.to };
    }
    return null;
  }
  for (const range of [...ranges].reverse()) {
    if (caret <= range.from || caret > range.to) continue;
    return range.from === caret ? null : { selection: range.from };
  }
  return null;
}

export function getRenderedMarkdownCommandArrowSelection(
  value: string,
  targetOffset: number,
  direction: 'left' | 'right',
): number {
  if (direction === 'right') return targetOffset;
  const bodyStart = getRenderedMarkdownBlockBodyStartAtOffset(value, targetOffset);
  return bodyStart !== null && targetOffset < bodyStart ? bodyStart : targetOffset;
}

export function getRenderedMarkdownVerticalNavigationEdit(
  value: string,
  targetOffset: number,
): { selection: number } | null {
  const bodyStart = getRenderedMarkdownBlockBodyStartAtOffset(value, targetOffset);
  return bodyStart !== null && targetOffset < bodyStart ? { selection: bodyStart } : null;
}

export function getMarkdownListMarkerProtectedDeleteBackwardEdit(
  value: string,
  offset: number,
): { from: number; to: number; selection: number } | null {
  const caret = Math.max(0, Math.min(value.length, offset));
  const bodyStart = getRenderedMarkdownListBodyStartAtOffset(value, caret);
  if (bodyStart === null) return null;
  return {
    from: bodyStart,
    to: Math.max(bodyStart, caret),
    selection: bodyStart,
  };
}

export function getMarkdownListArrowRightBoundaryEdit(value: string, offset: number): { selection: number } | null {
  const caret = Math.max(0, Math.min(value.length, offset));
  const { lineEnd } = getMarkdownLineBounds(value, caret);
  if (caret !== lineEnd || lineEnd >= value.length) return null;
  const nextLineBodyStart = getRenderedMarkdownListBodyStartForLine(value, lineEnd + 1);
  return nextLineBodyStart !== null && nextLineBodyStart > lineEnd + 1
    ? { selection: nextLineBodyStart }
    : null;
}

export function handleMarkdownCodeEditorListArrowRight(view: EditorView): boolean {
  const selection = view.state.selection.main;
  if (!selection.empty) return false;
  const edit = getMarkdownListArrowRightBoundaryEdit(view.state.doc.toString(), selection.from);
  if (!edit) return false;
  view.dispatch({ selection: { anchor: edit.selection, head: edit.selection } });
  return true;
}

export function handleMarkdownCodeEditorListArrowDown(view: EditorView): boolean {
  const selection = view.state.selection.main;
  if (!selection.empty) return false;
  const next = view.moveVertically(selection, true);
  const edit = getRenderedMarkdownVerticalNavigationEdit(view.state.doc.toString(), next.head);
  if (!edit) return false;
  view.dispatch({ selection: { anchor: edit.selection, head: edit.selection } });
  return true;
}

export function handleMarkdownCodeEditorListCommandArrowLeft(view: EditorView): boolean {
  const selection = view.state.selection.main;
  if (!selection.empty) return false;
  const next = view.moveToLineBoundary(selection, false, true);
  const nextHead = getRenderedMarkdownCommandArrowSelection(view.state.doc.toString(), next.head, 'left');
  if (nextHead === next.head) return false;
  if (nextHead === selection.head) return true;
  view.dispatch({ selection: { anchor: nextHead, head: nextHead } });
  return true;
}

export function handleRenderedMarkdownEditorArrowRight(view: EditorView): boolean {
  const selection = view.state.selection.main;
  if (!selection.empty) return false;
  const edit = getRenderedMarkdownArrowRightEdit(view.state.doc.toString(), selection.from);
  if (!edit) return false;
  view.dispatch({ selection: { anchor: edit.selection, head: edit.selection } });
  return true;
}

export function handleRenderedMarkdownEditorArrowLeft(view: EditorView): boolean {
  const selection = view.state.selection.main;
  if (!selection.empty) return false;
  const edit = getRenderedMarkdownArrowLeftEdit(view.state.doc.toString(), selection.from);
  if (!edit) return false;
  view.dispatch({ selection: { anchor: edit.selection, head: edit.selection } });
  return true;
}

export function handleRenderedMarkdownEditorOptionArrow(view: EditorView, direction: 'left' | 'right'): boolean {
  const selection = view.state.selection.main;
  if (!selection.empty) return false;
  const edit = getRenderedMarkdownOptionArrowEdit(view.state.doc.toString(), selection.from, direction);
  if (!edit) return false;
  view.dispatch({ selection: { anchor: edit.selection, head: edit.selection } });
  return true;
}

export function handleRenderedMarkdownEditorCommandArrow(view: EditorView, direction: 'left' | 'right'): boolean {
  const selection = view.state.selection.main;
  if (!selection.empty) return false;
  const next = view.moveToLineBoundary(selection, direction === 'right', true);
  const nextHead = getRenderedMarkdownCommandArrowSelection(view.state.doc.toString(), next.head, direction);
  if (nextHead === selection.head) return next.head !== selection.head;
  view.dispatch({ selection: { anchor: nextHead, head: nextHead } });
  return true;
}

export function handleRenderedMarkdownEditorArrowDown(view: EditorView): boolean {
  const selection = view.state.selection.main;
  if (!selection.empty) return false;
  const next = view.moveVertically(selection, true);
  const edit = getRenderedMarkdownVerticalNavigationEdit(view.state.doc.toString(), next.head);
  if (!edit) return false;
  view.dispatch({ selection: { anchor: edit.selection, head: edit.selection } });
  return true;
}

export function handleMarkdownCodeEditorCommandBackspace(view: EditorView): boolean {
  const selection = view.state.selection.main;
  if (!selection.empty) return false;
  const edit = getMarkdownListMarkerProtectedDeleteBackwardEdit(view.state.doc.toString(), selection.from);
  if (!edit) return false;
  const visualLineStart = view.moveToLineBoundary(selection, false, true).head;
  const from = Math.max(edit.from, Math.min(selection.from, visualLineStart));
  view.dispatch({
    changes: from === edit.to ? undefined : { from, to: edit.to },
    selection: { anchor: from, head: from },
  });
  return true;
}

export function handleRenderedMarkdownEditorKeyDown(view: EditorView, event: KeyboardEvent): boolean {
  if (event.metaKey || event.altKey || event.ctrlKey || event.shiftKey || event.isComposing) {
    return false;
  }
  if (event.key === 'ArrowRight') return handleRenderedMarkdownEditorArrowRight(view);
  if (event.key === 'ArrowLeft') return handleRenderedMarkdownEditorArrowLeft(view);
  if (event.key === 'ArrowDown') return handleRenderedMarkdownEditorArrowDown(view);
  return false;
}

function shouldRevealRenderedMarkdownSource(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((range) => {
    return range.empty && range.from >= from && range.from <= to;
  });
}

function hasRenderedMarkdownCursorAt(state: EditorState, offset: number): boolean {
  return state.selection.ranges.some((range) => range.empty && range.from === offset);
}

function pushRenderedEmptyInlineFormattingPlaceholders(
  state: EditorState,
  decorations: RenderedMarkdownDecoration[],
  lineFrom: number,
  text: string,
  isProtected: (from: number, to: number) => boolean,
  protect: (from: number, to: number) => void,
): void {
  const pushPlaceholder = (from: number, to: number, contentOffset: number): void => {
    if (isProtected(from, to) || !hasRenderedMarkdownCursorAt(state, contentOffset)) return;
    protect(from, to);
    pushRenderedSyntaxReplacement(decorations, from, contentOffset);
    pushRenderedSyntaxReplacement(decorations, contentOffset, to);
  };

  for (const match of text.matchAll(/\*\*\*\*/g)) {
    if (match.index === undefined) continue;
    const from = lineFrom + match.index;
    pushPlaceholder(from, from + match[0].length, from + 2);
  }

  for (const match of text.matchAll(/\*\*/g)) {
    if (match.index === undefined) continue;
    const from = lineFrom + match.index;
    pushPlaceholder(from, from + match[0].length, from + 1);
  }

  for (const match of text.matchAll(/<u><\/u>/g)) {
    if (match.index === undefined) continue;
    const from = lineFrom + match.index;
    pushPlaceholder(from, from + match[0].length, from + 3);
  }
}

function pushRenderedInlineDecorations(
  state: EditorState,
  decorations: RenderedMarkdownDecoration[],
  lineFrom: number,
  text: string,
  documentPath?: string | null,
  imageClassName = '',
  bookmarksById: ReadonlyMap<string, Bookmark> = new Map(),
): void {
	  const protectedRanges: Array<{ from: number; to: number }> = [];
	  const protect = (from: number, to: number) => protectedRanges.push({ from, to });
	  const isProtected = (from: number, to: number) => protectedRanges.some((range) => rangesIntersect(range, { from, to }));

	  pushRenderedEmptyInlineFormattingPlaceholders(state, decorations, lineFrom, text, isProtected, protect);

	  for (const match of text.matchAll(/!\[([^\]\n]*)\]\((<[^>\n]+>|[^)\n]*)\)/g)) {
	    if (match.index === undefined) continue;
    const from = lineFrom + match.index;
    const to = from + match[0].length;
    const bookmarkId = getRenderedMarkdownBookmarkEmbedId(match[2]);
    protect(from, to);
    pushRenderedSyntaxReplacement(
      decorations,
      from,
      to,
      bookmarkId
        ? new RenderedMarkdownBookmarkWidget(bookmarkId, match[1], bookmarksById.get(bookmarkId) ?? null, from, to, imageClassName)
        : new RenderedMarkdownImageWidget(match[1], match[2], documentPath, from, to, imageClassName),
    );
  }

  for (const match of text.matchAll(/`([^`\n]+)`/g)) {
    if (match.index === undefined) continue;
    const from = lineFrom + match.index;
    const to = from + match[0].length;
    if (isProtected(from, to)) continue;
    const contentFrom = from + 1;
    const contentTo = to - 1;
    protect(from, to);
    pushRenderedSyntaxReplacement(decorations, from, contentFrom);
    pushRenderedInlineMark(
      decorations,
      contentFrom,
      contentTo,
      RENDERED_MARKDOWN_EDITOR_CODE_CLASS,
      renderedMarkdownSourceAttributes(from, to),
    );
    pushRenderedSyntaxReplacement(decorations, contentTo, to);
  }

  for (const match of text.matchAll(/\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g)) {
    if (match.index === undefined) continue;
    const from = lineFrom + match.index;
    const to = from + match[0].length;
    if (isProtected(from, to)) continue;
    const targetFrom = from + 2;
    const targetTo = targetFrom + match[1].length;
    const aliasFrom = match[2] === undefined ? targetFrom : targetTo + 1;
    const aliasTo = match[2] === undefined ? targetTo : aliasFrom + match[2].length;
    const wikiLinkClass = `${RENDERED_MARKDOWN_EDITOR_LINK_CLASS} ${RENDERED_MARKDOWN_EDITOR_WIKI_LINK_CLASS}`;
    protect(from, to);
    if (shouldRevealRenderedMarkdownSource(state, from, to)) {
      pushRenderedInlineMark(decorations, from, aliasFrom, RENDERED_MARKDOWN_EDITOR_WIKI_SYNTAX_CLASS);
      pushRenderedInlineMark(
        decorations,
        aliasFrom,
        aliasTo,
        wikiLinkClass,
        renderedMarkdownSourceAttributes(from, to),
      );
      pushRenderedInlineMark(decorations, aliasTo, to, RENDERED_MARKDOWN_EDITOR_WIKI_SYNTAX_CLASS);
      continue;
    }
    pushRenderedSyntaxReplacement(decorations, from, aliasFrom);
    pushRenderedInlineMark(
      decorations,
      aliasFrom,
      aliasTo,
      wikiLinkClass,
      renderedMarkdownSourceAttributes(from, to),
    );
    pushRenderedSyntaxReplacement(decorations, aliasTo, to);
  }

  for (const match of text.matchAll(/\[([^\]\n]+)\]\(([^)\n]*)\)/g)) {
    if (match.index === undefined) continue;
    const from = lineFrom + match.index;
    const to = from + match[0].length;
    if (isProtected(from, to)) continue;
    const labelFrom = from + 1;
    const labelTo = labelFrom + match[1].length;
    protect(from, to);
    pushRenderedSyntaxReplacement(decorations, from, labelFrom);
    pushRenderedInlineMark(
      decorations,
      labelFrom,
      labelTo,
      RENDERED_MARKDOWN_EDITOR_LINK_CLASS,
      renderedMarkdownSourceAttributes(from, to),
    );
    pushRenderedSyntaxReplacement(decorations, labelTo, to);
  }

  for (const match of text.matchAll(/<u>([^<\n]+)<\/u>/g)) {
    if (match.index === undefined) continue;
    const from = lineFrom + match.index;
    const to = from + match[0].length;
    if (isProtected(from, to)) continue;
    const contentFrom = from + 3;
    const contentTo = to - 4;
    protect(from, to);
    pushRenderedSyntaxReplacement(decorations, from, contentFrom);
    pushRenderedInlineMark(
      decorations,
      contentFrom,
      contentTo,
      RENDERED_MARKDOWN_EDITOR_UNDERLINE_CLASS,
      renderedMarkdownSourceAttributes(from, to),
    );
    pushRenderedSyntaxReplacement(decorations, contentTo, to);
  }

  for (const match of text.matchAll(/~~([^~\n]+)~~/g)) {
    if (match.index === undefined) continue;
    const from = lineFrom + match.index;
    const to = from + match[0].length;
    if (isProtected(from, to)) continue;
    const contentFrom = from + 2;
    const contentTo = to - 2;
    protect(from, to);
    pushRenderedSyntaxReplacement(decorations, from, contentFrom);
    pushRenderedInlineMark(
      decorations,
      contentFrom,
      contentTo,
      RENDERED_MARKDOWN_EDITOR_STRIKE_CLASS,
      renderedMarkdownSourceAttributes(from, to),
    );
    pushRenderedSyntaxReplacement(decorations, contentTo, to);
  }

  for (const match of text.matchAll(/\*\*([^*\n]+)\*\*/g)) {
    if (match.index === undefined) continue;
    const from = lineFrom + match.index;
    const to = from + match[0].length;
    if (isProtected(from, to)) continue;
    const contentFrom = from + 2;
    const contentTo = to - 2;
    protect(from, to);
    pushRenderedSyntaxReplacement(decorations, from, contentFrom);
    pushRenderedInlineMark(
      decorations,
      contentFrom,
      contentTo,
      RENDERED_MARKDOWN_EDITOR_STRONG_CLASS,
      renderedMarkdownSourceAttributes(from, to),
    );
    pushRenderedSyntaxReplacement(decorations, contentTo, to);
  }

  for (const match of text.matchAll(/(?<!\*)\*([^*\n]+)\*(?!\*)/g)) {
    if (match.index === undefined) continue;
    const from = lineFrom + match.index;
    const to = from + match[0].length;
    if (isProtected(from, to)) continue;
    const contentFrom = from + 1;
    const contentTo = to - 1;
    protect(from, to);
    pushRenderedSyntaxReplacement(decorations, from, contentFrom);
    pushRenderedInlineMark(
      decorations,
      contentFrom,
      contentTo,
      RENDERED_MARKDOWN_EDITOR_EMPHASIS_CLASS,
      renderedMarkdownSourceAttributes(from, to),
    );
    pushRenderedSyntaxReplacement(decorations, contentTo, to);
  }
}

function getRenderedMarkdownCodeFenceMarkerBeforeLine(state: EditorState, lineNumber: number): string | null {
  let codeFenceMarker: string | null = null;
  for (let currentLineNumber = 1; currentLineNumber < lineNumber; currentLineNumber += 1) {
    const text = state.doc.line(currentLineNumber).text;
    const codeFenceMatch = /^(`{3,}|~{3,})/.exec(text);
    if (codeFenceMatch && (codeFenceMarker === null || codeFenceMatch[1][0] === codeFenceMarker)) {
      codeFenceMarker = codeFenceMarker === null ? codeFenceMatch[1][0] : null;
    }
  }
  return codeFenceMarker;
}

function normalizeRenderedMarkdownEditorLineRanges(
  state: EditorState,
  ranges: readonly RenderedMarkdownEditorRange[],
): RenderedMarkdownEditorLineRange[] {
  const lineRanges = ranges
    .map((range) => {
      const from = Math.max(0, Math.min(range.from, state.doc.length));
      const to = Math.max(from, Math.min(range.to, state.doc.length));
      return {
        fromLine: state.doc.lineAt(from).number,
        toLine: state.doc.lineAt(to).number,
      };
    })
    .sort((a, b) => a.fromLine - b.fromLine || a.toLine - b.toLine);

  const merged: RenderedMarkdownEditorLineRange[] = [];
  for (const range of lineRanges) {
    const previous = merged[merged.length - 1];
    if (previous && range.fromLine <= previous.toLine + 1) {
      previous.toLine = Math.max(previous.toLine, range.toLine);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

function pushRenderedMarkdownEditorLineDecorations(
  state: EditorState,
  decorations: RenderedMarkdownDecoration[],
  lineNumber: number,
  codeFenceMarker: string | null,
  documentPath?: string | null,
  bookmarksById: ReadonlyMap<string, Bookmark> = new Map(),
): string | null {
  const line = state.doc.line(lineNumber);
  const text = line.text;
  const codeFenceMatch = /^(`{3,}|~{3,})/.exec(text);
  const headingMatch = /^(#{1,3})\s+/.exec(text);
  const taskMatch = /^(\s*)((?:[-*+]\s+)?)\[([ xX]?)\](\s*)/.exec(text);
  const listMatch = /^(\s*)((?:[-*+])|(?:\d+[.)]))\s+/.exec(text);
  const quoteMatch = /^(\s*)>\s?/.exec(text);
  let inlineStart = 0;

  if (codeFenceMatch && (codeFenceMarker === null || codeFenceMatch[1][0] === codeFenceMarker)) {
    decorations.push(Decoration.line({ class: RENDERED_MARKDOWN_EDITOR_CODE_FENCE_CLASS }).range(line.from));
    pushRenderedSyntaxReplacement(
      decorations,
      line.from,
      line.to,
      new RenderedMarkdownMarkerWidget(RENDERED_MARKDOWN_EDITOR_CODE_FENCE_MARKER_CLASS, '', line.from, line.to),
    );
    return codeFenceMarker === null ? codeFenceMatch[1][0] : null;
  }

  if (codeFenceMarker !== null) {
    const previousText = lineNumber > 1 ? state.doc.line(lineNumber - 1).text : '';
    const nextText = lineNumber < state.doc.lines ? state.doc.line(lineNumber + 1).text : '';
    const isAdjacentFence = (value: string): boolean => {
      const adjacentFenceMatch = /^(`{3,}|~{3,})/.exec(value);
      return adjacentFenceMatch?.[1][0] === codeFenceMarker;
    };
    const classes = [
      RENDERED_MARKDOWN_EDITOR_CODE_BLOCK_CLASS,
      isAdjacentFence(previousText) ? RENDERED_MARKDOWN_EDITOR_CODE_BLOCK_START_CLASS : '',
      isAdjacentFence(nextText) ? RENDERED_MARKDOWN_EDITOR_CODE_BLOCK_END_CLASS : '',
    ].filter(Boolean).join(' ');
    decorations.push(Decoration.line({ class: classes }).range(line.from));
    return codeFenceMarker;
  }

  if (/^\s*!\[[^\]\n]*\]\((<[^>\n]+>|[^)\n]*)\)\s*$/.test(text)) {
    decorations.push(Decoration.line({ class: RENDERED_MARKDOWN_EDITOR_IMAGE_LINE_CLASS }).range(line.from));
  }

  if (headingMatch) {
    const level = headingMatch[1].length;
    const contentFrom = line.from + headingMatch[0].length;
    inlineStart = headingMatch[0].length;
    decorations.push(Decoration.line({ class: `${RENDERED_MARKDOWN_EDITOR_HEADING_CLASS}-line` }).range(line.from));
    pushRenderedSyntaxReplacement(
      decorations,
      line.from,
      contentFrom,
      new RenderedMarkdownMarkerWidget(RENDERED_MARKDOWN_EDITOR_HEADING_MARKER_CLASS, '', line.from, contentFrom),
    );
    pushRenderedInlineMark(
      decorations,
      contentFrom,
      line.to,
      `${RENDERED_MARKDOWN_EDITOR_HEADING_CLASS} ${RENDERED_MARKDOWN_EDITOR_HEADING_CLASS}-${level}`,
    );
  } else if (taskMatch) {
    const markerFrom = line.from + taskMatch[1].length;
    const checkFrom = markerFrom + taskMatch[2].length + 1;
    const markerTo = checkFrom + taskMatch[3].length + 1;
    const contentFrom = line.from + taskMatch[0].length;
    const checked = taskMatch[3].toLowerCase() === 'x';
    inlineStart = contentFrom - line.from;
    pushRenderedListLineDecoration(decorations, line.from, taskMatch[1]);
    pushRenderedSyntaxReplacement(decorations, line.from, markerFrom);
    decorations.push(
      Decoration.replace({
        widget: new RenderedMarkdownTaskCheckboxWidget(
          checked,
          markerFrom,
          markerTo,
          checkFrom,
          checkFrom + taskMatch[3].length,
          contentFrom,
        ),
      }).range(markerFrom, contentFrom),
    );
    pushRenderedListBodyDecoration(decorations, contentFrom, line.to, checked ? RENDERED_MARKDOWN_EDITOR_DONE_TASK_CLASS : '');
  } else if (quoteMatch) {
    const markerFrom = line.from + quoteMatch[1].length;
    const markerTo = line.from + quoteMatch[0].length;
    inlineStart = quoteMatch[0].length;
    decorations.push(Decoration.line({ class: RENDERED_MARKDOWN_EDITOR_QUOTE_LINE_CLASS }).range(line.from));
    decorations.push(
      Decoration.replace({
        widget: new RenderedMarkdownMarkerWidget(RENDERED_MARKDOWN_EDITOR_QUOTE_MARKER_CLASS, '', markerFrom, markerTo),
      }).range(markerFrom, markerTo),
    );
  } else if (listMatch) {
    const markerFrom = line.from + listMatch[1].length;
    const markerTo = line.from + listMatch[0].length;
    const markerText = /^\d/.test(listMatch[2]) ? listMatch[2].replace(/\)$/, '.') : '•';
    inlineStart = listMatch[0].length;
    pushRenderedListLineDecoration(decorations, line.from, listMatch[1]);
    pushRenderedSyntaxReplacement(decorations, line.from, markerFrom);
    decorations.push(
      Decoration.replace({
        widget: new RenderedMarkdownMarkerWidget(RENDERED_MARKDOWN_EDITOR_LIST_MARKER_CLASS, markerText, markerFrom, markerTo),
      }).range(markerFrom, markerTo),
    );
    pushRenderedListBodyDecoration(decorations, markerTo, line.to);
  }

  pushRenderedInlineDecorations(
    state,
    decorations,
    line.from + inlineStart,
    text.slice(inlineStart),
    documentPath,
    listMatch || taskMatch ? RENDERED_MARKDOWN_EDITOR_LIST_IMAGE_CLASS : '',
    bookmarksById,
  );
  return codeFenceMarker;
}

export function buildRenderedMarkdownEditorDecorationsForRanges(
  state: EditorState,
  ranges: readonly RenderedMarkdownEditorRange[],
  documentPath?: string | null,
  stableRanges: readonly RenderedMarkdownEditorRange[] = [],
  bookmarksSnapshot?: BookmarksSnapshot | null,
): DecorationSet {
  const decorations: RenderedMarkdownDecoration[] = [];
  const bookmarksById = new Map((bookmarksSnapshot?.bookmarks ?? []).map((bookmark) => [bookmark.id, bookmark] as const));
  const lineRanges = normalizeRenderedMarkdownEditorLineRanges(state, [...ranges, ...stableRanges]);
  const inlineHtmlBlocks = getRenderedMarkdownInlineHtmlBlocks(state);
  const visibleInlineHtmlBlocks = inlineHtmlBlocks.filter((block) => (
    ranges.some((range) => rangesIntersect(block, range))
  ));

  for (const block of visibleInlineHtmlBlocks) {
    const startLine = state.doc.line(block.fromLine);
    decorations.push(
      Decoration.replace({
        widget: new RenderedMarkdownInlineHtmlWidget(block.content, documentPath, block.from, block.to),
      }).range(startLine.from, startLine.to),
    );
    for (let lineNumber = block.fromLine + 1; lineNumber <= block.toLine; lineNumber += 1) {
      const line = state.doc.line(lineNumber);
      decorations.push(Decoration.line({ class: RENDERED_MARKDOWN_EDITOR_CODE_FENCE_CLASS }).range(line.from));
      pushRenderedSyntaxReplacement(decorations, line.from, line.to);
    }
  }

  for (const range of lineRanges) {
    let codeFenceMarker = getRenderedMarkdownCodeFenceMarkerBeforeLine(state, range.fromLine);
    for (let lineNumber = range.fromLine; lineNumber <= range.toLine; lineNumber += 1) {
      if (visibleInlineHtmlBlocks.some((block) => lineNumber >= block.fromLine && lineNumber <= block.toLine)) {
        continue;
      }
      codeFenceMarker = pushRenderedMarkdownEditorLineDecorations(state, decorations, lineNumber, codeFenceMarker, documentPath, bookmarksById);
    }
  }

  return Decoration.set(
    decorations
      .filter((entry) => entry.from <= entry.to)
      .sort((a, b) => a.from - b.from || a.to - b.to),
    true,
  );
}

export function buildRenderedMarkdownEditorDecorations(
  state: EditorState,
  documentPath?: string | null,
  bookmarksSnapshot?: BookmarksSnapshot | null,
): DecorationSet {
  return buildRenderedMarkdownEditorDecorationsForRanges(state, [{ from: 0, to: state.doc.length }], documentPath, [], bookmarksSnapshot);
}

export function getRenderedMarkdownImageLineRanges(state: EditorState): RenderedMarkdownEditorRange[] {
  const ranges: RenderedMarkdownEditorRange[] = [];
  for (let lineNumber = 1; lineNumber <= state.doc.lines; lineNumber += 1) {
    const line = state.doc.line(lineNumber);
    if (RENDERED_MARKDOWN_IMAGE_MARKDOWN_PATTERN.test(line.text)) {
      ranges.push({ from: line.from, to: line.to });
    }
  }
  return ranges;
}

const RENDERED_MARKDOWN_IMAGE_MARKDOWN_PATTERN = /!\[[^\]\n]*\]\((<[^>\n]+>|[^)\n]*)\)/;

function renderedMarkdownEditorRangeContainsImageLine(
  state: EditorState,
  from: number,
  to: number,
): boolean {
  const docLength = state.doc.length;
  const startLine = state.doc.lineAt(Math.max(0, Math.min(from, docLength)));
  const endLine = state.doc.lineAt(Math.max(0, Math.min(to, docLength)));
  for (let lineNumber = startLine.number; lineNumber <= endLine.number; lineNumber += 1) {
    if (RENDERED_MARKDOWN_IMAGE_MARKDOWN_PATTERN.test(state.doc.line(lineNumber).text)) {
      return true;
    }
  }
  return false;
}

function renderedMarkdownEditorChangesMayAffectImageRanges(update: ViewUpdate): boolean {
  let mayAffectImageRanges = false;
  update.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    if (mayAffectImageRanges) return;
    mayAffectImageRanges = (
      renderedMarkdownEditorRangeContainsImageLine(update.startState, fromA, toA)
      || renderedMarkdownEditorRangeContainsImageLine(update.state, fromB, toB)
    );
  });
  return mayAffectImageRanges;
}

function mapRenderedMarkdownEditorRanges(
  changes: ChangeDesc,
  ranges: readonly RenderedMarkdownEditorRange[],
): RenderedMarkdownEditorRange[] {
  return ranges
    .map((range) => ({
      from: changes.mapPos(range.from),
      to: changes.mapPos(range.to),
    }))
    .filter((range) => range.from <= range.to);
}

function countRenderedMarkdownEditorRangeLines(
  state: EditorState,
  ranges: readonly RenderedMarkdownEditorRange[],
): number {
  return normalizeRenderedMarkdownEditorLineRanges(state, ranges)
    .reduce((sum, range) => sum + Math.max(0, range.toLine - range.fromLine + 1), 0);
}

export function createRenderedMarkdownEditorPresentationExtension(documentPath?: string | null) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      stableImageRanges: RenderedMarkdownEditorRange[];

      constructor(view: EditorView) {
        const activeDocumentPath = documentPath ?? view.state.facet(renderedMarkdownDocumentPathFacet);
        const startedAt = renderedMarkdownEditorTimingEnabled() ? performance.now() : 0;
        this.stableImageRanges = getRenderedMarkdownImageLineRanges(view.state);
        this.decorations = buildRenderedMarkdownEditorDecorationsForRanges(
          view.state,
          view.visibleRanges,
          activeDocumentPath,
          this.stableImageRanges,
          peekBookmarks(),
        );
        if (startedAt > 0) {
          emitRenderedMarkdownEditorTiming('rendered-decorations-initial-build', {
            durationMs: performance.now() - startedAt,
            lines: countRenderedMarkdownEditorRangeLines(view.state, view.visibleRanges),
            visibleRanges: view.visibleRanges.length,
            docLength: view.state.doc.length,
          });
        }
      }

      update(update: ViewUpdate) {
        if (
          update.docChanged
          || update.viewportChanged
          || update.selectionSet
          || update.startState.facet(renderedMarkdownDocumentPathFacet) !== update.state.facet(renderedMarkdownDocumentPathFacet)
          || update.startState.facet(renderedMarkdownBookmarksVersionFacet) !== update.state.facet(renderedMarkdownBookmarksVersionFacet)
        ) {
          const activeDocumentPath = documentPath ?? update.state.facet(renderedMarkdownDocumentPathFacet);
          const startedAt = renderedMarkdownEditorTimingEnabled() ? performance.now() : 0;
          let imageRangesRecomputed = false;
          if (update.docChanged) {
            if (renderedMarkdownEditorChangesMayAffectImageRanges(update)) {
              this.stableImageRanges = getRenderedMarkdownImageLineRanges(update.state);
              imageRangesRecomputed = true;
            } else {
              this.stableImageRanges = mapRenderedMarkdownEditorRanges(update.changes, this.stableImageRanges);
            }
          }
          this.decorations = buildRenderedMarkdownEditorDecorationsForRanges(
            update.state,
            update.view.visibleRanges,
            activeDocumentPath,
            this.stableImageRanges,
            peekBookmarks(),
          );
          if (startedAt > 0) {
            emitRenderedMarkdownEditorTiming('rendered-decorations-update', {
              durationMs: performance.now() - startedAt,
              docChanged: update.docChanged,
              selectionSet: update.selectionSet,
              viewportChanged: update.viewportChanged,
              imageRangesRecomputed,
              lines: countRenderedMarkdownEditorRangeLines(update.state, update.view.visibleRanges),
              visibleRanges: update.view.visibleRanges.length,
              docLength: update.state.doc.length,
            });
          }
        }
      }
    },
    {
      decorations: (plugin) => plugin.decorations,
    },
  );
}

export const renderedMarkdownEditorPresentationExtension = createRenderedMarkdownEditorPresentationExtension();

export function isMarkdownCodeEditorFileSwapUpdate(update: { transactions: readonly Transaction[] }): boolean {
  return update.transactions.some((transaction) => transaction.isUserEvent(MARKDOWN_CODE_EDITOR_FILE_SWAP_USER_EVENT));
}

export function dispatchMarkdownCodeEditorFileSwap(
  view: EditorView,
  historyCompartment: Compartment,
  value: string,
): void {
  const current = view.state.doc.toString();
  if (current === value) return;

  view.dispatch({
    effects: historyCompartment.reconfigure([]),
  });
  view.dispatch({
    changes: { from: 0, to: current.length, insert: value },
    annotations: [
      Transaction.userEvent.of(MARKDOWN_CODE_EDITOR_FILE_SWAP_USER_EVENT),
      Transaction.addToHistory.of(false),
    ],
  });
  view.dispatch({
    effects: historyCompartment.reconfigure(history()),
  });
}

function getCodeEditorCaretPosition(
  view: EditorView,
  position: number,
): { top: number; left: number } | null {
  const caret = view.coordsAtPos(position);
  const container = view.dom.getBoundingClientRect();
  if (!caret) return null;
  return {
    top: caret.bottom - container.top + 6,
    left: Math.max(0, Math.min(caret.left - container.left, container.width - 260)),
  };
}

function getCodeEditorCaretRect(
  view: EditorView,
  position: number,
): MarkdownCodeEditorSelectionSnapshot['caretRect'] {
  const caret = view.coordsAtPos(position);
  if (!caret) return null;
  const container = view.dom.getBoundingClientRect();
  return {
    viewport: {
      left: Math.round(caret.left),
      top: Math.round(caret.top),
      width: Math.round(caret.right - caret.left),
      height: Math.round(caret.bottom - caret.top),
    },
    editor: {
      left: Math.round(caret.left - container.left),
      top: Math.round(caret.top - container.top),
      width: Math.round(caret.right - caret.left),
      height: Math.round(caret.bottom - caret.top),
    },
  };
}

function getCodeEditorSelectionRect(
  view: EditorView,
  from: number,
  to: number,
): MarkdownCodeEditorSelectionSnapshot['selectionRect'] {
  if (from === to) return null;
  const start = view.coordsAtPos(from);
  const end = view.coordsAtPos(to);
  if (!start || !end) return null;
  const container = view.dom.getBoundingClientRect();
  const left = Math.min(start.left, end.left);
  const right = Math.max(start.right, end.right);
  const top = Math.min(start.top, end.top);
  const bottom = Math.max(start.bottom, end.bottom);
  return {
    viewport: {
      left: Math.round(left),
      top: Math.round(top),
      width: Math.round(right - left),
      height: Math.round(bottom - top),
    },
    editor: {
      left: Math.round(left - container.left),
      top: Math.round(top - container.top),
      width: Math.round(right - left),
      height: Math.round(bottom - top),
    },
  };
}

export function getMarkdownCodeEditorSourcePosition(
  value: string,
  offset: number,
): MarkdownCodeEditorSourcePosition {
  return getMarkdownCodeEditorSourcePositionFromDoc(Text.of(value.split('\n')), offset);
}

function getMarkdownCodeEditorSourcePositionFromDoc(
  doc: Text,
  offset: number,
): MarkdownCodeEditorSourcePosition {
  const clampedOffset = Math.max(0, Math.min(doc.length, offset));
  const line = doc.lineAt(clampedOffset);
  const lineStart = line.from;
  const lineEnd = line.to;
  return {
    offset: clampedOffset,
    line: line.number,
    column: clampedOffset - lineStart + 1,
    lineStart,
    lineEnd,
    lineLength: lineEnd - lineStart,
    before: doc.sliceString(Math.max(lineStart, clampedOffset - 40), clampedOffset),
    after: doc.sliceString(clampedOffset, Math.min(lineEnd, clampedOffset + 40)),
  };
}

export function getMarkdownCodeEditorSelectionSnapshot(
  view: EditorView,
  input: { docChanged?: boolean; inputType?: string; inputData?: string | null; value?: string } = {},
): MarkdownCodeEditorSelectionSnapshot {
  const value = input.value ?? view.state.doc.toString();
  const selection = view.state.selection.main;
  return {
    value,
    selectionStart: selection.from,
    selectionEnd: selection.to,
    selectionAnchor: selection.anchor,
    selectionHead: selection.head,
    isCollapsed: selection.empty,
    selectionStartSource: getMarkdownCodeEditorSourcePositionFromDoc(view.state.doc, selection.from),
    selectionEndSource: getMarkdownCodeEditorSourcePositionFromDoc(view.state.doc, selection.to),
    selectionHeadSource: getMarkdownCodeEditorSourcePositionFromDoc(view.state.doc, selection.head),
    caretPosition: getCodeEditorCaretPosition(view, selection.head),
    caretRect: getCodeEditorCaretRect(view, selection.head),
    selectionRect: getCodeEditorSelectionRect(view, selection.from, selection.to),
    scroll: {
      top: view.scrollDOM.scrollTop,
      height: view.scrollDOM.scrollHeight,
      clientHeight: view.scrollDOM.clientHeight,
    },
    docChanged: input.docChanged ?? false,
    inputType: input.inputType,
    inputData: input.inputData,
  };
}

export function getMarkdownCodeEditorBottomRoom(bottomRoomPx?: number): number {
  return Math.max(0, bottomRoomPx ?? MARKDOWN_CODE_EDITOR_CARET_BOTTOM_ROOM_PX);
}

export function shouldMoveCaretToDocumentEndFromClick(
  view: EditorView,
  event: MouseEvent,
  bottomRoomPx = MARKDOWN_CODE_EDITOR_CARET_BOTTOM_ROOM_PX,
): boolean {
  if (event.button !== 0 || event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return false;
  const scroller = view.scrollDOM;
  const remainingScroll = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
  if (remainingScroll > bottomRoomPx + 2) return false;

  const lastLine = view.contentDOM.querySelector<HTMLElement>('.cm-line:last-child');
  if (!lastLine) return false;
  return event.clientY > lastLine.getBoundingClientRect().bottom;
}

export function startMarkdownCodeEditorBlankSpaceSelection(
  view: EditorView,
  event: MouseEvent,
  bottomRoomPx = MARKDOWN_CODE_EDITOR_CARET_BOTTOM_ROOM_PX,
): (() => void) | null {
  if (!shouldMoveCaretToDocumentEndFromClick(view, event, bottomRoomPx)) return null;
  event.preventDefault();
  view.focus();
  const anchor = view.state.doc.length;
  let head = anchor;
  view.dispatch({
    selection: { anchor, head },
    effects: EditorView.scrollIntoView(anchor, { yMargin: bottomRoomPx }),
  });

  const ownerDocument = view.dom.ownerDocument;
  const handleMouseMove = (moveEvent: MouseEvent): void => {
    if (moveEvent.buttons !== 1) {
      cleanup();
      return;
    }
    const nextHead = view.posAtCoords({ x: moveEvent.clientX, y: moveEvent.clientY });
    if (nextHead === null || nextHead === head) return;
    head = nextHead;
    view.dispatch({ selection: { anchor, head } });
  };
  const handleMouseUp = (): void => cleanup();
  const cleanup = (): void => {
    ownerDocument.removeEventListener('mousemove', handleMouseMove);
    ownerDocument.removeEventListener('mouseup', handleMouseUp);
  };
  ownerDocument.addEventListener('mousemove', handleMouseMove);
  ownerDocument.addEventListener('mouseup', handleMouseUp);
  return cleanup;
}

function getMarkdownCodeEditorVisualRowStartPosition(view: EditorView, event: MouseEvent): number | null {
  const contentRect = view.contentDOM.getBoundingClientRect();
  const clampedX = contentRect.left + 1;
  return view.posAtCoords({ x: clampedX, y: event.clientY });
}

function getMarkdownCodeEditorVisualRowDragPosition(view: EditorView, event: MouseEvent): number | null {
  const rawPosition = view.posAtCoords({ x: event.clientX, y: event.clientY });
  if (rawPosition !== null) return rawPosition;

  const contentRect = view.contentDOM.getBoundingClientRect();
  const left = contentRect.left + 1;
  const rectRight = Number.isFinite(contentRect.right) ? contentRect.right - 1 : left;
  const right = Math.max(left, rectRight);
  const clampedX = Math.max(left, Math.min(event.clientX, right));
  return view.posAtCoords({ x: clampedX, y: event.clientY });
}

export function startMarkdownCodeEditorVisualRowSelection(
  view: EditorView,
  event: MouseEvent,
): (() => void) | null {
  if (event.button !== 0 || event.metaKey || event.altKey || event.ctrlKey) return null;

  const anchor = getMarkdownCodeEditorVisualRowStartPosition(view, event);
  if (anchor === null) return null;

  event.preventDefault();
  view.focus();
  let head = anchor;
  view.dispatch({ selection: { anchor, head } });

  const ownerDocument = view.dom.ownerDocument;
  const handleMouseMove = (moveEvent: MouseEvent): void => {
    if (moveEvent.buttons !== 1) {
      cleanup();
      return;
    }
    const nextHead = getMarkdownCodeEditorVisualRowDragPosition(view, moveEvent);
    if (nextHead === null || nextHead === head) return;
    head = nextHead;
    view.dispatch({ selection: { anchor, head } });
  };
  const handleMouseUp = (): void => cleanup();
  const cleanup = (): void => {
    ownerDocument.removeEventListener('mousemove', handleMouseMove);
    ownerDocument.removeEventListener('mouseup', handleMouseUp);
  };
  ownerDocument.addEventListener('mousemove', handleMouseMove);
  ownerDocument.addEventListener('mouseup', handleMouseUp);
  return cleanup;
}

export function startMarkdownCodeEditorLineNumberSelection(
  view: EditorView,
  event: MouseEvent,
): (() => void) | null {
  if (!(event.target instanceof Element)) return null;
  if (!event.target.closest(`.${MARKDOWN_CODE_EDITOR_LINE_NUMBER_SELECTION_HIT_AREA_CLASS}`)) return null;
  return startMarkdownCodeEditorVisualRowSelection(view, event);
}

export function getMarkdownCodeEditorCursorAnimationStyle(blinkCursor: boolean): React.CSSProperties {
  return blinkCursor ? {} : { animation: 'none', animationName: 'none', animationDuration: '0s' };
}

export function getMarkdownCodeEditorSelectionDrawConfig(blinkCursor: boolean): { cursorBlinkRate: number } {
  return { cursorBlinkRate: blinkCursor ? MARKDOWN_CODE_EDITOR_CURSOR_BLINK_RATE_MS : 0 };
}

export function getMarkdownCodeEditorSelectionBackground(
  isDark: boolean,
  presentation: MarkdownCodeEditorPresentation,
  override?: string,
): string {
  if (override) return override;
  if (presentation === 'rendered') {
    return isDark ? 'rgba(120,170,255,0.16)' : 'rgba(80,140,255,0.18)';
  }
  return isDark ? 'rgba(120,170,255,0.25)' : 'rgba(80,140,255,0.25)';
}

export function getMarkdownCodeEditorCursorShapeStyle(
  cursorStyle: RenderedTextCursorStyle,
  caretColor: string | undefined,
  fallbackColor: string,
  blockCursorOpacity = DEFAULT_RENDERED_BLOCK_CURSOR_OPACITY,
): React.CSSProperties {
  if (cursorStyle !== 'block') {
    return {
      backgroundColor: 'transparent',
      borderLeft: `1.2px solid ${caretColor ?? fallbackColor}`,
      marginLeft: '-0.6px',
      minWidth: '0',
      width: '0',
    };
  }
  return {
    backgroundColor: caretColor ?? fallbackColor,
    borderLeft: 'none',
    height: `${MARKDOWN_CODE_EDITOR_BLOCK_CURSOR_HEIGHT} !important`,
    marginLeft: '0',
    minWidth: MARKDOWN_CODE_EDITOR_BLOCK_CURSOR_WIDTH,
    opacity: blockCursorOpacity,
    width: MARKDOWN_CODE_EDITOR_BLOCK_CURSOR_WIDTH,
  };
}

export function getMarkdownCodeEditorCursorScrollMargin(bottomRoomPx = MARKDOWN_CODE_EDITOR_CARET_BOTTOM_ROOM_PX): { x: number; y: number } {
  return { x: 5, y: bottomRoomPx };
}

export function handleMarkdownCodeEditorCapturedKeyDown(
  event: KeyboardEvent,
  onKeyDown?: (event: KeyboardEvent) => boolean | void,
): boolean {
  if (onKeyDown?.(event) !== true) return false;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  return true;
}

export function getMarkdownCodeEditorContentAttributes(input: {
  spellCheck: boolean;
  placeholder?: string;
  dataAttributes?: Record<string, string | undefined>;
}): Record<string, string> {
  const attributes: Record<string, string> = {
    spellcheck: input.spellCheck ? 'true' : 'false',
    autocorrect: input.spellCheck ? 'on' : 'off',
    autocapitalize: input.spellCheck ? 'sentences' : 'off',
  };
  if (input.placeholder) attributes['aria-label'] = input.placeholder;
  Object.entries(input.dataAttributes ?? {}).forEach(([key, value]) => {
    if (value !== undefined) attributes[key] = value;
  });
  return attributes;
}

const MarkdownCodeEditor = forwardRef<MarkdownCodeEditorHandle, MarkdownCodeEditorProps>(
  function MarkdownCodeEditor(props, ref) {
    const {
      value,
      onChange,
      presentation = 'source',
      findQuery = '',
      fontFamily,
      fontSize,
      lineHeight,
      color,
      headingFontFamily,
      h1Size,
      h2Size,
      h3Size,
      linkColor,
      mutedColor,
      paragraphSpacing,
      background,
      caretColor,
      selectionBackground,
      lineNumbersMode = 'hidden',
      blinkCursor = true,
      cursorStyle = DEFAULT_RENDERED_TEXT_CURSOR_STYLE,
      blockCursorOpacity = DEFAULT_RENDERED_BLOCK_CURSOR_OPACITY,
      placeholder,
      readOnly = false,
      spellCheck = true,
      dataAttributes,
      documentPath,
      style,
      onScroll,
      bottomRoomPx: bottomRoomPxProp,
    } = props;

    const { theme } = useTheme();
    const bottomRoomPx = getMarkdownCodeEditorBottomRoom(bottomRoomPxProp);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const viewRef = useRef<EditorView | null>(null);
    const bottomRoomPxRef = useRef(bottomRoomPx);
    const [bookmarksVersion, setBookmarksVersion] = useState(0);
    const onChangeRef = useRef(onChange);
    const onKeyDownRef = useRef(props.onKeyDown);
    const onMouseDownRef = useRef(props.onMouseDown);
    const onPasteRef = useRef(props.onPaste);
    const onImagePreviewRef = useRef(props.onImagePreview);
    const onFocusRef = useRef(props.onFocus);
    const onBlurRef = useRef(props.onBlur);
    const onSelectionChangeRef = useRef(props.onSelectionChange);
    const onScrollRef = useRef(onScroll);
    const blankSpaceSelectionCleanupRef = useRef<(() => void) | null>(null);
    const sampleMarkdownInputInteraction = useInteractionFpsSampler('markdown-editor-input');
    const lastBeforeInputRef = useRef<{ inputType: string; data: string | null } | null>(null);
    const lastAppliedValueRef = useRef(value);
    const themeCompartment = useRef(new Compartment()).current;
    const syntaxHighlightCompartment = useRef(new Compartment()).current;
    const historyCompartment = useRef(new Compartment()).current;
    const readOnlyCompartment = useRef(new Compartment()).current;
    const documentPathCompartment = useRef(new Compartment()).current;
    const bookmarksVersionCompartment = useRef(new Compartment()).current;
    const findQueryCompartment = useRef(new Compartment()).current;
    const selectionDrawCompartment = useRef(new Compartment()).current;
    const cursorScrollMarginCompartment = useRef(new Compartment()).current;
    const lineNumbersCompartment = useRef(new Compartment()).current;
    const contentAttributesCompartment = useRef(new Compartment()).current;
    const scrollFpsSamplerRef = useScrollFpsSampler('markdown');

    useEffect(() => {
      onChangeRef.current = onChange;
    }, [onChange]);

    useEffect(() => {
      onKeyDownRef.current = props.onKeyDown;
    }, [props.onKeyDown]);

    useEffect(() => {
      onMouseDownRef.current = props.onMouseDown;
    }, [props.onMouseDown]);

    useEffect(() => {
      onPasteRef.current = props.onPaste;
    }, [props.onPaste]);

    useEffect(() => {
      onImagePreviewRef.current = props.onImagePreview;
    }, [props.onImagePreview]);

    useEffect(() => {
      onFocusRef.current = props.onFocus;
    }, [props.onFocus]);

    useEffect(() => {
      onBlurRef.current = props.onBlur;
    }, [props.onBlur]);

    useEffect(() => {
      onSelectionChangeRef.current = props.onSelectionChange;
    }, [props.onSelectionChange]);

    useEffect(() => {
      onScrollRef.current = onScroll;
    }, [onScroll]);

    useEffect(() => () => {
      blankSpaceSelectionCleanupRef.current?.();
      blankSpaceSelectionCleanupRef.current = null;
    }, []);

    const editorTheme = useMemo(() => {
      const fontSizePx = typeof fontSize === 'number' ? `${fontSize}px` : String(fontSize);
      const lineHeightCss = typeof lineHeight === 'number' ? String(lineHeight) : String(lineHeight);
      const fontSizeNumber = typeof fontSize === 'number' ? fontSize : Number.parseFloat(String(fontSize));
      const lineHeightNumber = typeof lineHeight === 'number' ? lineHeight : Number.parseFloat(String(lineHeight));
      const lineNumberRowHeight = Number.isFinite(fontSizeNumber) && Number.isFinite(lineHeightNumber)
        ? `${fontSizeNumber * lineHeightNumber}px`
        : lineHeightCss;
      const isRenderedPresentation = presentation === 'rendered';
      const cursorAnimationStyle = getMarkdownCodeEditorCursorAnimationStyle(blinkCursor);
      const cursorShapeStyle = getMarkdownCodeEditorCursorShapeStyle(
        cursorStyle,
        caretColor,
        color,
        blockCursorOpacity,
      );
      return Prec.highest(EditorView.theme(
        {
          '&': {
            height: isRenderedPresentation ? 'auto' : '100%',
            color,
            backgroundColor: background ?? 'transparent',
            fontFamily,
            fontSize: fontSizePx,
            '--ft-line-number-row-height': lineNumberRowHeight,
          },
          '.cm-scroller': {
            fontFamily,
            lineHeight: lineHeightCss,
            overflow: isRenderedPresentation ? 'visible' : 'auto',
            cursor: 'text',
          },
          '.cm-content': {
            caretColor: caretColor ?? color,
            padding: '0',
            cursor: 'text',
            ...(isRenderedPresentation ? { minHeight: '160px' } : {}),
          },
          '.cm-content::after': {
            content: '""',
            display: 'block',
            height: `${bottomRoomPx}px`,
          },
          '.cm-line': {
            padding: '0',
            cursor: 'text',
            lineHeight: lineHeightCss,
            minHeight: 'var(--ft-line-number-row-height)',
          },
          [`.${MARKDOWN_CODE_EDITOR_CHECKED_TASK_LINE_CLASS}`]: {
            opacity: 0.78,
          },
          '&.cm-focused': {
            outline: 'none',
          },
          '.cm-cursor, .cm-dropCursor': {
            borderLeftColor: caretColor ?? color,
          },
          '.cm-cursorLayer': {
            zIndex: 3,
          },
          '&.cm-focused > .cm-scroller > .cm-cursorLayer, &.cm-focused .cm-cursorLayer': {
            ...cursorAnimationStyle,
          },
          '.cm-cursor': {
            ...cursorShapeStyle,
          },
          '&.cm-focused .cm-cursorLayer .cm-cursor, .cm-cursorLayer .cm-cursor, .cm-cursor-primary': {
            ...cursorShapeStyle,
          },
          [`&.${MARKDOWN_CODE_EDITOR_HAS_RANGE_SELECTION_CLASS} .cm-cursorLayer .cm-cursor`]: {
            display: 'none',
          },
          '.cm-selectionBackground, ::selection, .cm-content ::selection': {
            backgroundColor: getMarkdownCodeEditorSelectionBackground(theme.isDark, presentation, selectionBackground),
          },
          ...(isRenderedPresentation ? {
            '.cm-selectionBackground': {
              borderRadius: '2px',
            },
          } : {}),
          '.cm-content ::selection': {
            backgroundColor: getMarkdownCodeEditorSelectionBackground(theme.isDark, presentation, selectionBackground),
          },
          '.cm-activeLine': {
            backgroundColor: 'transparent',
          },
          '.cm-ft-lineNumberOverlay': {
            position: 'absolute',
            left: '0',
            top: '0',
            width: MARKDOWN_CODE_EDITOR_LINE_NUMBER_OVERLAY_WIDTH,
            transform: `translateX(calc(-100% - ${MARKDOWN_CODE_EDITOR_LINE_NUMBER_OVERLAY_GAP}))`,
            color: mutedColor ?? (theme.isDark ? 'rgba(255,255,255,0.4)' : 'rgba(17,17,17,0.36)'),
            opacity: lineNumbersMode === 'faded' ? 0.5 : 0.82,
            fontFamily: "'SF Mono', Menlo, Monaco, Consolas, monospace",
            fontSize: '0.78em',
            pointerEvents: 'none',
            zIndex: 2,
          },
          '.cm-ft-lineNumberSelectionHitArea': {
            position: 'absolute',
            left: '0',
            top: '0',
            bottom: '0',
            width: '16em',
            transform: `translateX(calc(-100% - ${MARKDOWN_CODE_EDITOR_LINE_NUMBER_OVERLAY_GAP}))`,
            cursor: 'text',
            pointerEvents: isRenderedPresentation && lineNumbersMode !== 'hidden' ? 'auto' : 'none',
            zIndex: 1,
          },
          '.cm-ft-lineNumberOverlayNumber': {
            position: 'absolute',
            right: MARKDOWN_CODE_EDITOR_LINE_NUMBER_OVERLAY_RIGHT,
            height: 'var(--ft-line-number-row-height)',
            lineHeight: 'var(--ft-line-number-row-height)',
            textAlign: 'right',
            fontVariantNumeric: 'tabular-nums',
          },
          '.cm-gutters': {
            display: 'none',
          },
          '.cm-activeLineGutter': {
            backgroundColor: 'transparent',
            color,
            opacity: lineNumbersMode === 'faded' ? 0.78 : 1,
          },
          [`.${MARKDOWN_CODE_EDITOR_SELECTED_LINE_NUMBER_CLASS}`]: {
            color: theme.isDark ? 'rgba(255,255,255,0.84)' : 'rgba(17,17,17,0.82)',
            opacity: 1,
            fontWeight: 600,
          },
          [`.${MARKDOWN_CODE_EDITOR_FIND_MATCH_CLASS}`]: {
            borderRadius: '2px',
            backgroundColor: theme.isDark ? 'rgba(250, 204, 21, 0.34)' : 'rgba(250, 204, 21, 0.42)',
            boxDecorationBreak: 'clone',
            WebkitBoxDecorationBreak: 'clone',
          },
          [`.${RENDERED_MARKDOWN_EDITOR_HEADING_CLASS}`]: {
            color,
            fontFamily: headingFontFamily ?? fontFamily,
            fontWeight: 620,
            letterSpacing: 0,
          },
          [`.${RENDERED_MARKDOWN_EDITOR_HEADING_CLASS}-1`]: {
            fontSize: h1Size ?? '1.55em',
            lineHeight: RENDERED_MARKDOWN_EDITOR_ROW_LINE_HEIGHT,
          },
          [`.${RENDERED_MARKDOWN_EDITOR_HEADING_CLASS}-2`]: {
            fontSize: h2Size ?? '1.18em',
            lineHeight: RENDERED_MARKDOWN_EDITOR_ROW_LINE_HEIGHT,
          },
          [`.${RENDERED_MARKDOWN_EDITOR_HEADING_CLASS}-3`]: {
            fontSize: h3Size ?? '1em',
            lineHeight: RENDERED_MARKDOWN_EDITOR_ROW_LINE_HEIGHT,
          },
          [`.${RENDERED_MARKDOWN_EDITOR_HEADING_MARKER_CLASS}, .${RENDERED_MARKDOWN_EDITOR_CODE_FENCE_MARKER_CLASS}`]: {
            display: 'inline-block',
            width: '0',
            overflow: 'hidden',
          },
          [`.${RENDERED_MARKDOWN_EDITOR_LIST_LINE_CLASS}`]: {
            ...getRenderedMarkdownListLineLayoutStyle(),
          },
          [`.${RENDERED_MARKDOWN_EDITOR_LIST_MARKER_CLASS}`]: {
            ...getRenderedMarkdownListMarkerLayoutStyle(),
            color: mutedColor ?? (theme.isDark ? 'rgba(255,255,255,0.58)' : 'rgba(17,17,17,0.58)'),
            fontVariantNumeric: 'tabular-nums',
          },
          [`.${RENDERED_MARKDOWN_EDITOR_LIST_BODY_CLASS}`]: {
            display: 'inline',
          },
          [`.${RENDERED_MARKDOWN_EDITOR_LIST_EMPTY_BODY_CLASS}`]: {
            display: 'inline-block',
            width: '0',
            height: MARKDOWN_CODE_EDITOR_BLOCK_CURSOR_HEIGHT,
            verticalAlign: 'text-bottom',
          },
          [`.${RENDERED_MARKDOWN_EDITOR_QUOTE_LINE_CLASS}`]: {
            borderLeft: `3px solid ${theme.isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.16)'}`,
            paddingLeft: '0.9em',
            color: mutedColor ?? (theme.isDark ? 'rgba(255,255,255,0.72)' : 'rgba(17,17,17,0.68)'),
          },
          [`.${RENDERED_MARKDOWN_EDITOR_QUOTE_MARKER_CLASS}`]: {
            display: 'inline-block',
            width: '0',
          },
          [`.${RENDERED_MARKDOWN_EDITOR_CODE_BLOCK_CLASS}`]: {
            borderRadius: '0',
            backgroundColor: theme.isDark ? 'rgba(255,255,255,0.065)' : 'rgba(0,0,0,0.045)',
            padding: '0 0.65em',
            paddingBottom: '0',
            fontFamily: "'SF Mono', Menlo, Monaco, Consolas, monospace",
            fontSize: '0.9em',
            lineHeight: 'var(--ft-line-number-row-height)',
            minHeight: 'var(--ft-line-number-row-height)',
            whiteSpace: 'pre-wrap',
          },
          [`.${RENDERED_MARKDOWN_EDITOR_CODE_BLOCK_START_CLASS}`]: {
            borderTopLeftRadius: '4px',
            borderTopRightRadius: '4px',
          },
          [`.${RENDERED_MARKDOWN_EDITOR_CODE_BLOCK_END_CLASS}`]: {
            borderBottomLeftRadius: '4px',
            borderBottomRightRadius: '4px',
          },
          [`.${RENDERED_MARKDOWN_EDITOR_IMAGE_LINE_CLASS}`]: {
            paddingTop: `calc(${paragraphSpacing ?? '0.78em'} * 0.18)`,
            paddingBottom: `calc(${paragraphSpacing ?? '0.78em'} * 0.34)`,
          },
          [`.${RENDERED_MARKDOWN_EDITOR_CODE_FENCE_CLASS}`]: {
            height: '0',
            lineHeight: '0',
            minHeight: '0',
            overflow: 'hidden',
          },
          [`.${RENDERED_MARKDOWN_EDITOR_STRONG_CLASS}`]: {
            color,
            fontWeight: 630,
          },
          [`.${RENDERED_MARKDOWN_EDITOR_EMPHASIS_CLASS}`]: {
            fontStyle: 'italic',
          },
          [`.${RENDERED_MARKDOWN_EDITOR_UNDERLINE_CLASS}`]: {
            textDecoration: 'underline',
            textUnderlineOffset: '2px',
          },
          [`.${RENDERED_MARKDOWN_EDITOR_STRIKE_CLASS}`]: {
            textDecoration: 'line-through',
            opacity: 0.72,
          },
          [`.${RENDERED_MARKDOWN_EDITOR_LINK_CLASS}`]: {
            color: linkColor ?? (theme.isDark ? '#7aa7ff' : '#1d4ed8'),
            cursor: 'pointer',
            textDecoration: 'underline',
            textUnderlineOffset: '2px',
            borderRadius: '3px',
            transition: 'color 120ms ease, background-color 120ms ease, text-decoration-color 120ms ease',
          },
          [`.${RENDERED_MARKDOWN_EDITOR_LINK_CLASS}:hover`]: {
            color: linkColor ?? (theme.isDark ? '#a9c7ff' : '#123a8c'),
            backgroundColor: theme.isDark ? 'rgba(122,167,255,0.16)' : 'rgba(15,118,110,0.12)',
            textDecorationColor: caretColor ?? linkColor ?? theme.accent,
            textDecorationThickness: '2px',
          },
          [`.${RENDERED_MARKDOWN_EDITOR_WIKI_LINK_CLASS}`]: {
            borderRadius: '4px',
            backgroundColor: theme.isDark ? 'rgba(122,167,255,0.12)' : 'rgba(29,78,216,0.08)',
            padding: '0 0.12em',
            color: linkColor ?? (theme.isDark ? '#8fb7ff' : '#1746a2'),
            textDecoration: 'none',
            borderBottom: `1px solid ${theme.isDark ? 'rgba(122,167,255,0.42)' : 'rgba(29,78,216,0.32)'}`,
            boxDecorationBreak: 'clone',
            WebkitBoxDecorationBreak: 'clone',
          },
          [`.${RENDERED_MARKDOWN_EDITOR_WIKI_LINK_CLASS}:hover`]: {
            backgroundColor: theme.isDark ? 'rgba(122,167,255,0.2)' : 'rgba(29,78,216,0.14)',
            borderBottomColor: theme.isDark ? 'rgba(122,167,255,0.7)' : 'rgba(29,78,216,0.55)',
          },
          [`.${RENDERED_MARKDOWN_EDITOR_WIKI_SYNTAX_CLASS}`]: {
            color: mutedColor ?? theme.textSecondary,
            opacity: 0.68,
            fontFamily: "'SF Mono', Menlo, Monaco, Consolas, monospace",
            fontSize: '0.92em',
          },
          [`.${RENDERED_MARKDOWN_EDITOR_CODE_CLASS}`]: {
            borderRadius: '4px',
            backgroundColor: theme.isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.055)',
            padding: '0.08em 0.28em',
            fontFamily: "'SF Mono', Menlo, Monaco, Consolas, monospace",
            fontSize: '0.88em',
          },
          [`.${RENDERED_MARKDOWN_EDITOR_IMAGE_CLASS}`]: {
            display: 'flex',
            position: 'relative',
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: '0.25em',
            width: '100%',
            maxWidth: '100%',
            margin: '0',
            verticalAlign: 'top',
            cursor: 'zoom-in',
            overflowAnchor: 'none',
          },
          [`.${RENDERED_MARKDOWN_EDITOR_IMAGE_CLASS}:has(.${RENDERED_MARKDOWN_EDITOR_IMAGE_EDIT_CLASS})`]: {
            cursor: 'default',
          },
          [`.${RENDERED_MARKDOWN_EDITOR_LIST_IMAGE_CLASS}`]: {
            display: 'inline-flex',
            width: 'auto',
          },
          [`.${RENDERED_MARKDOWN_EDITOR_BOOKMARK_CLASS}`]: {
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'stretch',
            boxSizing: 'border-box',
            gap: '5px',
            width: 'min(100%, 640px)',
            maxWidth: '100%',
            padding: '10px 12px',
            borderRadius: '8px',
            border: `1px solid ${theme.border}`,
            backgroundColor: theme.isDark ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.025)',
            color: theme.text,
            cursor: 'default',
            overflowAnchor: 'none',
          },
          [`.${RENDERED_MARKDOWN_EDITOR_LIST_IMAGE_CLASS}.${RENDERED_MARKDOWN_EDITOR_BOOKMARK_CLASS}`]: {
            width: 'min(100%, 560px)',
          },
          [`.${RENDERED_MARKDOWN_EDITOR_BOOKMARK_CLASS}__title`]: {
            display: 'block',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
            fontSize: '0.9em',
            lineHeight: 1.25,
            fontWeight: 650,
          },
          [`.${RENDERED_MARKDOWN_EDITOR_BOOKMARK_CLASS}__body`]: {
            display: '-webkit-box',
            WebkitLineClamp: '3',
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            fontSize: '0.88em',
            lineHeight: 1.35,
          },
          [`.${RENDERED_MARKDOWN_EDITOR_BOOKMARK_CLASS}__meta`]: {
            display: 'block',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: mutedColor ?? (theme.isDark ? 'rgba(255,255,255,0.62)' : 'rgba(17,17,17,0.62)'),
            fontSize: '0.78em',
            lineHeight: 1.25,
          },
          [`.${RENDERED_MARKDOWN_EDITOR_IMAGE_CLASS} img`]: {
            display: 'block',
            width: 'auto',
            maxWidth: '100%',
            height: 'auto',
            borderRadius: '8px',
            objectFit: 'contain',
            border: `1px solid ${theme.border}`,
          },
          [`.${RENDERED_MARKDOWN_EDITOR_DRAWING_IMAGE_CLASS} .${RENDERED_MARKDOWN_EDITOR_IMAGE_FRAME_CLASS}`]: {
            display: 'block',
            width: '100%',
            boxSizing: 'border-box',
            padding: '12px',
            borderRadius: '8px',
            border: `1px solid ${theme.border}`,
          },
          [`.${RENDERED_MARKDOWN_EDITOR_DRAWING_IMAGE_CLASS} img`]: {
            maxWidth: '100%',
            border: 0,
            borderRadius: '5px',
          },
          [`.${RENDERED_MARKDOWN_EDITOR_IMAGE_EDIT_CLASS}`]: {
            width: '22px',
            height: '22px',
            padding: 0,
            border: `1px solid ${theme.border}`,
            borderRadius: '5px',
            color: theme.text,
            backgroundColor: 'transparent',
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer',
          },
          [`.${RENDERED_MARKDOWN_EDITOR_IMAGE_EDIT_CLASS} svg`]: {
            display: 'block',
            width: '14px',
            height: '14px',
            margin: '0 auto',
          },
          [`.${RENDERED_MARKDOWN_EDITOR_IMAGE_CAPTION_CLASS}`]: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            color: mutedColor ?? (theme.isDark ? 'rgba(255,255,255,0.62)' : 'rgba(17,17,17,0.62)'),
            fontSize: '0.88em',
            lineHeight: 1.35,
          },
          [`.${RENDERED_MARKDOWN_EDITOR_IMAGE_CAPTION_TEXT_CLASS}`]: {
            minWidth: '1ch',
            outline: 'none',
            borderRadius: '4px',
            padding: '1px 3px',
            marginLeft: '-3px',
            cursor: 'text',
          },
          [`.${RENDERED_MARKDOWN_EDITOR_IMAGE_CAPTION_TEXT_CLASS}:focus`]: {
            backgroundColor: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.055)',
          },
          [`.${RENDERED_MARKDOWN_EDITOR_INLINE_HTML_CLASS}`]: {
            display: 'block',
            boxSizing: 'border-box',
            width: '100%',
            maxWidth: '100%',
            margin: `calc(${paragraphSpacing ?? '0.78em'} * 0.75) 0`,
            border: `1px solid ${theme.border}`,
            borderRadius: '6px',
            overflow: 'hidden',
            backgroundColor: theme.isDark ? 'rgba(255,255,255,0.025)' : 'rgba(255,255,255,0.78)',
          },
          [`.${RENDERED_MARKDOWN_EDITOR_INLINE_HTML_CLASS}__toolbar`]: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            minHeight: '30px',
            padding: '4px 6px 4px 9px',
            borderBottom: `1px solid ${theme.border}`,
            color: mutedColor ?? theme.textSecondary,
            backgroundColor: theme.isDark ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.03)',
            fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
            fontSize: '12px',
            lineHeight: '1',
          },
          [`.${RENDERED_MARKDOWN_EDITOR_INLINE_HTML_CLASS}__toolbar figcaption`]: {
            margin: '0',
            fontWeight: 620,
            letterSpacing: '0',
          },
          [`.${RENDERED_MARKDOWN_EDITOR_INLINE_HTML_CLASS}__toolbar button`]: {
            minWidth: '62px',
            height: '22px',
            padding: '0 8px',
            border: `1px solid ${theme.border}`,
            borderRadius: '5px',
            color,
            backgroundColor: theme.isDark ? 'rgba(255,255,255,0.055)' : 'rgba(0,0,0,0.035)',
            font: 'inherit',
            cursor: 'pointer',
          },
          [`.${RENDERED_MARKDOWN_EDITOR_INLINE_HTML_CLASS} iframe`]: {
            display: 'block',
            width: '100%',
            minHeight: '260px',
            height: '320px',
            border: '0',
            backgroundColor: '#fff',
          },
          [`.${RENDERED_MARKDOWN_EDITOR_INLINE_HTML_EXPANDED_CLASS}`]: {
            width: 'min(100vw - 48px, 1200px)',
            maxWidth: 'min(100vw - 48px, 1200px)',
            marginLeft: 'max(0px, calc((100% - min(100vw - 48px, 1200px)) / 2))',
          },
          [`.${RENDERED_MARKDOWN_EDITOR_INLINE_HTML_EXPANDED_CLASS} iframe`]: {
            minHeight: '520px',
            height: 'min(72vh, 820px)',
          },
          [`.${RENDERED_MARKDOWN_EDITOR_TASK_MARKER_CLASS}`]: {
            ...getRenderedMarkdownTaskMarkerLayoutStyle(),
            margin: '0',
            verticalAlign: '-0.1em',
            accentColor: linkColor ?? (theme.isDark ? '#8fb7ff' : '#2563eb'),
            cursor: 'pointer',
          },
          [`.${RENDERED_MARKDOWN_EDITOR_DONE_TASK_CLASS}`]: {
            opacity: 0.74,
          },
        },
        { dark: theme.isDark },
      ));
    }, [
      background,
      blinkCursor,
      blockCursorOpacity,
      caretColor,
      color,
      bottomRoomPx,
      cursorStyle,
      fontFamily,
      fontSize,
      h1Size,
      h2Size,
      h3Size,
      headingFontFamily,
      linkColor,
      lineNumbersMode,
      lineHeight,
      mutedColor,
      paragraphSpacing,
      presentation,
      selectionBackground,
      theme.isDark,
    ]);

    const lineNumbersExtension = useMemo(() => (
      lineNumbersMode === 'hidden'
        ? []
        : [visualLineNumberOverlayExtension]
    ), [lineNumbersMode]);

    const contentAttributes = useMemo(() => getMarkdownCodeEditorContentAttributes({
      spellCheck,
      placeholder,
      dataAttributes,
    }), [dataAttributes, placeholder, spellCheck]);

    // Mount once. Subsequent updates flow through compartments / dispatch.
    useLayoutEffect(() => {
      if (!containerRef.current) return;
      const startState = EditorState.create({
        doc: value,
        extensions: [
          historyCompartment.of(history()),
          keymap.of([
            {
              key: 'ArrowRight',
              run: (view) => (
                presentation === 'rendered'
                  ? handleRenderedMarkdownEditorArrowRight(view)
                  : handleMarkdownCodeEditorListArrowRight(view)
              ),
            },
            {
              key: 'ArrowDown',
              run: (view) => (
                presentation === 'rendered'
                  ? handleRenderedMarkdownEditorArrowDown(view)
                  : handleMarkdownCodeEditorListArrowDown(view)
              ),
            },
            {
              key: 'ArrowLeft',
              run: (view) => (presentation === 'rendered' ? handleRenderedMarkdownEditorArrowLeft(view) : false),
            },
            {
              mac: 'Mod-Backspace',
              run: handleMarkdownCodeEditorCommandBackspace,
            },
            {
              key: 'Alt-ArrowRight',
              run: (view) => (presentation === 'rendered' ? handleRenderedMarkdownEditorOptionArrow(view, 'right') : false),
            },
            {
              key: 'Alt-ArrowLeft',
              run: (view) => (presentation === 'rendered' ? handleRenderedMarkdownEditorOptionArrow(view, 'left') : false),
            },
            {
              mac: 'Mod-ArrowRight',
              run: (view) => (presentation === 'rendered' ? handleRenderedMarkdownEditorCommandArrow(view, 'right') : false),
            },
            {
              mac: 'Mod-ArrowLeft',
              run: (view) => (
                presentation === 'rendered'
                  ? handleRenderedMarkdownEditorCommandArrow(view, 'left')
                  : handleMarkdownCodeEditorListCommandArrowLeft(view)
              ),
            },
            ...defaultKeymap,
            ...historyKeymap,
            indentWithTab,
          ]),
          markdown(),
          documentPathCompartment.of(renderedMarkdownDocumentPathFacet.of(documentPath ?? null)),
          bookmarksVersionCompartment.of(renderedMarkdownBookmarksVersionFacet.of(bookmarksVersion)),
          findQueryCompartment.of(markdownCodeEditorFindQueryFacet.of(findQuery)),
          markdownCodeEditorFindMatchExtension,
          ...(presentation === 'rendered' ? [createRenderedMarkdownEditorPresentationExtension()] : []),
          syntaxHighlightCompartment.of(syntaxHighlighting(buildHighlightStyle(theme.isDark))),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          bracketMatching(),
          highlightActiveLine(),
          selectionDrawCompartment.of(drawSelection(getMarkdownCodeEditorSelectionDrawConfig(blinkCursor))),
          checkedMarkdownTaskLineExtension,
          trailingLineStartSelectionExtension,
          ...(presentation === 'rendered' ? [
            renderedMarkdownListCaretBoundaryExtension,
            renderedMarkdownHiddenSyntaxSelectionExtension,
          ] : []),
          rangeSelectionClassExtension,
          EditorView.lineWrapping,
          lineNumbersCompartment.of(lineNumbersExtension),
          contentAttributesCompartment.of(EditorView.contentAttributes.of(contentAttributes)),
          cursorScrollMarginCompartment.of(EditorView.cursorScrollMargin.of(getMarkdownCodeEditorCursorScrollMargin(bottomRoomPxRef.current))),
          themeCompartment.of(editorTheme),
          readOnlyCompartment.of(EditorState.readOnly.of(readOnly)),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !isMarkdownCodeEditorFileSwapUpdate(update)) {
              sampleMarkdownInputInteraction();
              const next = update.state.doc.toString();
              lastAppliedValueRef.current = next;
              const startedAt = renderedMarkdownEditorTimingEnabled() ? performance.now() : 0;
              onChangeRef.current?.(next);
              if (startedAt > 0) {
                emitRenderedMarkdownEditorTiming('code-editor-on-change-callback', {
                  durationMs: performance.now() - startedAt,
                  presentation,
                  docLength: next.length,
                });
              }
            }
            if (update.docChanged || update.selectionSet) {
              const input = update.docChanged ? lastBeforeInputRef.current : null;
              if (update.docChanged) lastBeforeInputRef.current = null;
              const startedAt = renderedMarkdownEditorTimingEnabled() ? performance.now() : 0;
              const snapshot = getMarkdownCodeEditorSelectionSnapshot(update.view, {
                docChanged: update.docChanged,
                inputType: input?.inputType,
                inputData: input?.data,
                value: lastAppliedValueRef.current,
              });
              onSelectionChangeRef.current?.(snapshot);
              if (startedAt > 0) {
                emitRenderedMarkdownEditorTiming('code-editor-selection-callback', {
                  durationMs: performance.now() - startedAt,
                  presentation,
                  docChanged: update.docChanged,
                  selectionSet: update.selectionSet,
                  inputType: input?.inputType ?? null,
                  docLength: snapshot.value.length,
                });
              }
            }
          }),
          EditorView.domEventHandlers({
            beforeinput: (event) => {
              const input = event as InputEvent;
              lastBeforeInputRef.current = {
                inputType: input.inputType,
                data: input.data,
              };
              if (presentation === 'rendered' && handleRenderedMarkdownEditorBeforeInput(view, input)) {
                event.preventDefault();
                return true;
              }
              return false;
            },
            mousedown: (event, view) => {
              if (presentation === 'rendered' && event.target instanceof Element && event.target.closest(`.${RENDERED_MARKDOWN_EDITOR_IMAGE_CAPTION_TEXT_CLASS}`)) {
                return false;
              }
              const lineNumberSelectionCleanup = presentation === 'rendered'
                ? startMarkdownCodeEditorLineNumberSelection(view, event)
                : null;
              if (lineNumberSelectionCleanup) {
                blankSpaceSelectionCleanupRef.current?.();
                blankSpaceSelectionCleanupRef.current = lineNumberSelectionCleanup;
                return true;
              }
              const blankSpaceSelectionCleanup = startMarkdownCodeEditorBlankSpaceSelection(
                view,
                event,
                bottomRoomPxRef.current,
              );
              if (blankSpaceSelectionCleanup) {
                blankSpaceSelectionCleanupRef.current?.();
                blankSpaceSelectionCleanupRef.current = blankSpaceSelectionCleanup;
                return true;
              }
              const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
              if (pos === null) return false;
              if (presentation === 'rendered') {
                const imageSelection = getRenderedMarkdownImageSelectionFromEventTarget(event.target);
                if (imageSelection !== null) {
                  event.preventDefault();
                  view.focus();
                  view.dispatch({ selection: { anchor: imageSelection.from, head: imageSelection.to } });
                  return true;
                }
                const inlineHtmlSelection = getRenderedMarkdownInlineHtmlSelectionFromEventTarget(event.target);
                if (inlineHtmlSelection !== null) {
                  event.preventDefault();
                  view.focus();
                  view.dispatch({ selection: { anchor: inlineHtmlSelection.from, head: inlineHtmlSelection.to } });
                  return true;
                }
                const blockBodyPos = getRenderedMarkdownBlockBodyClickPosition(
                  view.state.doc.toString(),
                  pos,
                  event,
                );
                if (blockBodyPos !== null) {
                  event.preventDefault();
                  view.focus();
                  view.dispatch({ selection: { anchor: blockBodyPos, head: blockBodyPos } });
                  return true;
                }
              }
              return onMouseDownRef.current?.(event, pos) === true;
            },
            click: (event) => {
              const preview = getRenderedMarkdownImagePreviewFromEventTarget(event.target);
              if (!preview || !onImagePreviewRef.current) return false;
              event.preventDefault();
              event.stopPropagation();
              onImagePreviewRef.current(preview);
              return true;
            },
            keydown: (event, view) => {
              if (presentation !== 'rendered' || !(event.target instanceof Element) || !event.target.closest(`.${RENDERED_MARKDOWN_EDITOR_IMAGE_CAPTION_TEXT_CLASS}`)) return false;
              if (event.key === 'Enter') {
                event.preventDefault();
                commitRenderedMarkdownDrawingCaption(view, event.target);
                (event.target as HTMLElement).blur();
                return true;
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                const image = event.target.closest(`.${RENDERED_MARKDOWN_EDITOR_IMAGE_CLASS}`);
                const alt = image?.getAttribute(RENDERED_MARKDOWN_EDITOR_IMAGE_ALT_ATTR) || 'Drawing';
                (event.target as HTMLElement).textContent = getRenderedMarkdownDrawingTitle(alt);
                (event.target as HTMLElement).blur();
                return true;
              }
              return false;
            },
            focusout: (event, view) => {
              if (presentation !== 'rendered') return false;
              return commitRenderedMarkdownDrawingCaption(view, event.target);
            },
            paste: (event) => onPasteRef.current?.(event as ClipboardEvent) === true,
            focus: () => {
              onFocusRef.current?.();
              return false;
            },
            blur: () => {
              onBlurRef.current?.();
              return false;
            },
            scroll: (event) => {
              const target = event.target as HTMLElement;
              if (target?.classList?.contains('cm-scroller')) {
                onScrollRef.current?.(target.scrollTop);
              }
              return false;
            },
          }),
        ],
      });

      const view = new EditorView({
        state: startState,
        parent: containerRef.current,
      });
      viewRef.current = view;
      view.scrollDOM.setAttribute('data-ft-quality-scroll', presentation === 'rendered' ? 'rendered-editor' : 'markdown');
      scrollFpsSamplerRef(view.scrollDOM);
      const handleKeyDownCapture = (event: KeyboardEvent) => {
        handleMarkdownCodeEditorCapturedKeyDown(event, onKeyDownRef.current);
      };
      view.contentDOM.addEventListener('keydown', handleKeyDownCapture, true);

      return () => {
        view.contentDOM.removeEventListener('keydown', handleKeyDownCapture, true);
        scrollFpsSamplerRef(null);
        view.destroy();
        viewRef.current = null;
      };
      // We deliberately mount once; reactive props are reconfigured below.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        effects: documentPathCompartment.reconfigure(renderedMarkdownDocumentPathFacet.of(documentPath ?? null)),
      });
    }, [documentPath, documentPathCompartment]);

    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        effects: findQueryCompartment.reconfigure(markdownCodeEditorFindQueryFacet.of(findQuery)),
      });
    }, [findQuery, findQueryCompartment]);

    // Sync external value into the editor before parent-scheduled cursor restores run.
    useLayoutEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      if (value === lastAppliedValueRef.current) return;
      lastAppliedValueRef.current = value;
      const current = view.state.doc.toString();
      if (current === value) return;
      dispatchMarkdownCodeEditorFileSwap(view, historyCompartment, value);
    }, [historyCompartment, value]);

    // Reconfigure theme when style props or color scheme change.
    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        effects: [
          themeCompartment.reconfigure(editorTheme),
          syntaxHighlightCompartment.reconfigure(syntaxHighlighting(buildHighlightStyle(theme.isDark))),
        ],
      });
    }, [editorTheme, syntaxHighlightCompartment, theme.isDark, themeCompartment]);

    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        effects: selectionDrawCompartment.reconfigure(
          drawSelection(getMarkdownCodeEditorSelectionDrawConfig(blinkCursor)),
        ),
      });
    }, [blinkCursor, selectionDrawCompartment]);

    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        effects: lineNumbersCompartment.reconfigure(lineNumbersExtension),
      });
    }, [lineNumbersCompartment, lineNumbersExtension]);

    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        effects: contentAttributesCompartment.reconfigure(
          EditorView.contentAttributes.of(contentAttributes),
        ),
      });
    }, [contentAttributes, contentAttributesCompartment]);

    useEffect(() => {
      bottomRoomPxRef.current = bottomRoomPx;
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        effects: cursorScrollMarginCompartment.reconfigure(
          EditorView.cursorScrollMargin.of(getMarkdownCodeEditorCursorScrollMargin(bottomRoomPx)),
        ),
      });
    }, [bottomRoomPx, cursorScrollMarginCompartment]);

    useEffect(() => {
      if (presentation !== 'rendered') return undefined;
      return onBookmarksChanged(() => setBookmarksVersion((version) => version + 1));
    }, [presentation]);

    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        effects: bookmarksVersionCompartment.reconfigure(renderedMarkdownBookmarksVersionFacet.of(bookmarksVersion)),
      });
    }, [bookmarksVersion, bookmarksVersionCompartment]);

    // Reconfigure read-only.
    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        effects: readOnlyCompartment.reconfigure(EditorState.readOnly.of(readOnly)),
      });
    }, [readOnly, readOnlyCompartment]);

    useImperativeHandle(
      ref,
      () => ({
        focus: (options) => {
          const view = viewRef.current;
          if (!view) return;
          view.focus();
          if (!options?.preventScroll) {
            view.dispatch({
              effects: EditorView.scrollIntoView(view.state.selection.main.head, {
                yMargin: bottomRoomPxRef.current,
              }),
            });
          }
        },
        blur: () => {
          viewRef.current?.contentDOM.blur();
        },
        refreshLayout: () => {
          viewRef.current?.requestMeasure();
        },
        startRenderedVisualRowSelection: (event) => {
          const view = viewRef.current;
          if (!view || presentation !== 'rendered') return false;
          const cleanup = startMarkdownCodeEditorVisualRowSelection(view, event);
          if (!cleanup) return false;
          blankSpaceSelectionCleanupRef.current?.();
          blankSpaceSelectionCleanupRef.current = cleanup;
          return true;
        },
        getValue: () => viewRef.current?.state.doc.toString() ?? '',
        getSelectionRange: () => {
          const range = viewRef.current?.state.selection.main;
          return {
            start: range?.from ?? 0,
            end: range?.to ?? 0,
          };
        },
        getSelectionSnapshot: () => {
          const view = viewRef.current;
          return view ? getMarkdownCodeEditorSelectionSnapshot(view) : null;
        },
        getVisualLineMap: () => {
          const view = viewRef.current;
          return view ? getMarkdownCodeEditorVisualLineMap(view) : [];
        },
        setSelectionRange: (start, end) => {
          const view = viewRef.current;
          if (!view) return;
          const length = view.state.doc.length;
          const safeStart = Math.max(0, Math.min(start, length));
          const safeEnd = Math.max(0, Math.min(end, length));
          view.dispatch({
            selection: { anchor: safeStart, head: safeEnd },
            effects: EditorView.scrollIntoView(safeEnd, { yMargin: bottomRoomPxRef.current }),
          });
        },
        get scrollTop() {
          const scroller = viewRef.current?.scrollDOM;
          return scroller ? scroller.scrollTop : 0;
        },
        set scrollTop(value: number) {
          const scroller = viewRef.current?.scrollDOM;
          if (scroller) scroller.scrollTop = value;
        },
        get scrollHeight() {
          return viewRef.current?.scrollDOM.scrollHeight ?? 0;
        },
        get clientHeight() {
          return viewRef.current?.scrollDOM.clientHeight ?? 0;
        },
      }),
      [presentation],
    );

    return (
      <div
        ref={containerRef}
        data-ft-quality-editor={presentation === 'rendered' ? 'rendered' : 'markdown'}
        style={{
          width: '100%',
          height: '100%',
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          ...style,
        }}
      />
    );
  },
);

export default MarkdownCodeEditor;
