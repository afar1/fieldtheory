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
} from 'react';
import { EditorState, Compartment, RangeSetBuilder, Transaction, type Range } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
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
import { isCheckedMarkdownTaskLine } from '../utils/markdownTasks';

export const MARKDOWN_CODE_EDITOR_CARET_BOTTOM_ROOM_PX = 59.2;
export const MARKDOWN_CODE_EDITOR_CHECKED_TASK_LINE_CLASS = 'cm-markdown-task-line-checked';
export const MARKDOWN_CODE_EDITOR_FILE_SWAP_USER_EVENT = 'swap.file';
export const RENDERED_MARKDOWN_EDITOR_HEADING_CLASS = 'cm-rendered-markdown-heading';
export const RENDERED_MARKDOWN_EDITOR_LINK_CLASS = 'cm-rendered-markdown-link';
export const RENDERED_MARKDOWN_EDITOR_STRONG_CLASS = 'cm-rendered-markdown-strong';
export const RENDERED_MARKDOWN_EDITOR_EMPHASIS_CLASS = 'cm-rendered-markdown-emphasis';
export const RENDERED_MARKDOWN_EDITOR_UNDERLINE_CLASS = 'cm-rendered-markdown-underline';
export const RENDERED_MARKDOWN_EDITOR_STRIKE_CLASS = 'cm-rendered-markdown-strike';
export const RENDERED_MARKDOWN_EDITOR_CODE_CLASS = 'cm-rendered-markdown-code';
export const RENDERED_MARKDOWN_EDITOR_IMAGE_CLASS = 'cm-rendered-markdown-image';
export const RENDERED_MARKDOWN_EDITOR_IMAGE_CAPTION_CLASS = 'cm-rendered-markdown-image-caption';
export const RENDERED_MARKDOWN_EDITOR_IMAGE_SRC_ATTR = 'data-cm-rendered-markdown-image-src';
export const RENDERED_MARKDOWN_EDITOR_IMAGE_ALT_ATTR = 'data-cm-rendered-markdown-image-alt';
export const RENDERED_MARKDOWN_EDITOR_CODE_BLOCK_CLASS = 'cm-rendered-markdown-code-block';
export const RENDERED_MARKDOWN_EDITOR_CODE_FENCE_CLASS = 'cm-rendered-markdown-code-fence';
export const RENDERED_MARKDOWN_EDITOR_CODE_FENCE_MARKER_CLASS = 'cm-rendered-markdown-code-fence-marker';
export const RENDERED_MARKDOWN_EDITOR_LIST_LINE_CLASS = 'cm-rendered-markdown-list-line';
export const RENDERED_MARKDOWN_EDITOR_LIST_MARKER_CLASS = 'cm-rendered-markdown-list-marker';
export const RENDERED_MARKDOWN_EDITOR_HEADING_MARKER_CLASS = 'cm-rendered-markdown-heading-marker';
export const RENDERED_MARKDOWN_EDITOR_QUOTE_LINE_CLASS = 'cm-rendered-markdown-quote-line';
export const RENDERED_MARKDOWN_EDITOR_QUOTE_MARKER_CLASS = 'cm-rendered-markdown-quote-marker';
export const RENDERED_MARKDOWN_EDITOR_TASK_MARKER_CLASS = 'cm-rendered-markdown-task-marker';
export const RENDERED_MARKDOWN_EDITOR_DONE_TASK_CLASS = 'cm-rendered-markdown-task-done';
export const RENDERED_MARKDOWN_EDITOR_SOURCE_FROM_ATTR = 'data-ft-source-from';
export const RENDERED_MARKDOWN_EDITOR_SOURCE_TO_ATTR = 'data-ft-source-to';

export interface MarkdownCodeEditorHandle {
  focus: (options?: { preventScroll?: boolean }) => void;
  blur: () => void;
  getValue: () => string;
  getSelectionRange: () => { start: number; end: number };
  getSelectionSnapshot: () => MarkdownCodeEditorSelectionSnapshot | null;
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

interface MarkdownCodeEditorProps {
  value: string;
  onChange: (next: string) => void;
  presentation?: 'source' | 'rendered';
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
  blinkCursor?: boolean;
  placeholder?: string;
  readOnly?: boolean;
  spellCheck?: boolean;
  dataAttributes?: Record<string, string | undefined>;
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
        this.decorations = buildCheckedMarkdownTaskLineDecorations(update.state);
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

function normalizeRenderedMarkdownImageSource(destination: string): string | null {
  const raw = destination.trim().replace(/^<(.+)>$/, '$1');
  if (/^file:/i.test(raw)) return raw.replace(/^file:/i, 'ftlocalfile:');
  if (/^(https?|ftlocalfile|ftmedia):/i.test(raw)) return raw;
  if (/^data:image\//i.test(raw)) return raw;
  return null;
}

function parseNullableMarkdownSourceOffset(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function getRenderedMarkdownImagePreviewFromEventTarget(target: EventTarget | null): MarkdownCodeEditorImagePreview | null {
  if (!(target instanceof Element)) return null;
  const image = target.closest(`.${RENDERED_MARKDOWN_EDITOR_IMAGE_CLASS}`);
  if (!(image instanceof HTMLElement)) return null;
  const src = image.getAttribute(RENDERED_MARKDOWN_EDITOR_IMAGE_SRC_ATTR);
  if (!src) return null;
  return {
    src,
    alt: image.getAttribute(RENDERED_MARKDOWN_EDITOR_IMAGE_ALT_ATTR) || 'Image',
    sourceFrom: parseNullableMarkdownSourceOffset(image.getAttribute(RENDERED_MARKDOWN_EDITOR_SOURCE_FROM_ATTR)),
    sourceTo: parseNullableMarkdownSourceOffset(image.getAttribute(RENDERED_MARKDOWN_EDITOR_SOURCE_TO_ATTR)),
  };
}

class RenderedMarkdownImageWidget extends WidgetType {
  constructor(
    private readonly alt: string,
    private readonly destination: string,
    private readonly sourceFrom: number,
    private readonly sourceTo: number,
  ) {
    super();
  }

  eq(other: RenderedMarkdownImageWidget): boolean {
    return other.alt === this.alt
      && other.destination === this.destination
      && other.sourceFrom === this.sourceFrom
      && other.sourceTo === this.sourceTo;
  }

  ignoreEvent(event: Event): boolean {
    return event.type !== 'click';
  }

  toDOM(): HTMLElement {
    const image = document.createElement('span');
    image.className = RENDERED_MARKDOWN_EDITOR_IMAGE_CLASS;
    image.setAttribute(RENDERED_MARKDOWN_EDITOR_SOURCE_FROM_ATTR, String(this.sourceFrom));
    image.setAttribute(RENDERED_MARKDOWN_EDITOR_SOURCE_TO_ATTR, String(this.sourceTo));

    const src = normalizeRenderedMarkdownImageSource(this.destination);
    const alt = this.alt || 'Image';
    if (src) {
      image.setAttribute(RENDERED_MARKDOWN_EDITOR_IMAGE_SRC_ATTR, src);
      image.setAttribute(RENDERED_MARKDOWN_EDITOR_IMAGE_ALT_ATTR, alt);
      image.setAttribute('role', 'button');
      image.setAttribute('aria-label', `Preview ${alt}`);
      const preview = document.createElement('img');
      preview.src = src;
      preview.alt = alt;
      image.appendChild(preview);
    }

    const caption = document.createElement('span');
    caption.className = RENDERED_MARKDOWN_EDITOR_IMAGE_CAPTION_CLASS;
    caption.textContent = alt;
    image.appendChild(caption);

    return image;
  }
}

class RenderedMarkdownTaskCheckboxWidget extends WidgetType {
  constructor(
    private readonly checked: boolean,
    private readonly sourceFrom: number,
    private readonly sourceTo: number,
    private readonly checkFrom: number,
    private readonly checkTo: number,
  ) {
    super();
  }

  eq(other: RenderedMarkdownTaskCheckboxWidget): boolean {
    return other.checked === this.checked
      && other.sourceFrom === this.sourceFrom
      && other.sourceTo === this.sourceTo
      && other.checkFrom === this.checkFrom
      && other.checkTo === this.checkTo;
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
    checkbox.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    checkbox.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      view.dispatch({
        changes: {
          from: this.checkFrom,
          to: this.checkTo,
          insert: this.checked ? ' ' : 'x',
        },
        selection: { anchor: this.checkTo },
      });
      window.setTimeout(() => view.focus(), 0);
    });
    return checkbox;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

type RenderedMarkdownDecoration = Range<Decoration>;
type RenderedMarkdownEditorRange = { from: number; to: number };
type RenderedMarkdownEditorLineRange = { fromLine: number; toLine: number };

function rangesIntersect(
  first: { from: number; to: number },
  second: { from: number; to: number },
): boolean {
  return first.from < second.to && second.from < first.to;
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

function pushRenderedInlineDecorations(
  decorations: RenderedMarkdownDecoration[],
  lineFrom: number,
  text: string,
): void {
  const protectedRanges: Array<{ from: number; to: number }> = [];
  const protect = (from: number, to: number) => protectedRanges.push({ from, to });
  const isProtected = (from: number, to: number) => protectedRanges.some((range) => rangesIntersect(range, { from, to }));

  for (const match of text.matchAll(/!\[([^\]\n]*)\]\((<[^>\n]+>|[^)\n]*)\)/g)) {
    if (match.index === undefined) continue;
    const from = lineFrom + match.index;
    const to = from + match[0].length;
    protect(from, to);
    pushRenderedSyntaxReplacement(
      decorations,
      from,
      to,
      new RenderedMarkdownImageWidget(match[1], match[2], from, to),
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
    protect(from, to);
    pushRenderedSyntaxReplacement(decorations, from, aliasFrom);
    pushRenderedInlineMark(
      decorations,
      aliasFrom,
      aliasTo,
      RENDERED_MARKDOWN_EDITOR_LINK_CLASS,
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
    decorations.push(Decoration.line({ class: RENDERED_MARKDOWN_EDITOR_CODE_BLOCK_CLASS }).range(line.from));
    return codeFenceMarker;
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
    const markerTo = line.from + taskMatch[0].length;
    const checkFrom = markerFrom + taskMatch[2].length + 1;
    const checked = taskMatch[3].toLowerCase() === 'x';
    inlineStart = taskMatch[0].length;
    decorations.push(
      Decoration.replace({
        widget: new RenderedMarkdownTaskCheckboxWidget(
          checked,
          markerFrom,
          markerTo,
          checkFrom,
          checkFrom + taskMatch[3].length,
        ),
      }).range(markerFrom, markerTo),
    );
    pushRenderedInlineMark(
      decorations,
      markerTo,
      line.to,
      checked ? RENDERED_MARKDOWN_EDITOR_DONE_TASK_CLASS : '',
    );
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
    decorations.push(Decoration.line({ class: RENDERED_MARKDOWN_EDITOR_LIST_LINE_CLASS }).range(line.from));
    decorations.push(
      Decoration.replace({
        widget: new RenderedMarkdownMarkerWidget(RENDERED_MARKDOWN_EDITOR_LIST_MARKER_CLASS, markerText, markerFrom, markerTo),
      }).range(markerFrom, markerTo),
    );
  }

  pushRenderedInlineDecorations(decorations, line.from + inlineStart, text.slice(inlineStart));
  return codeFenceMarker;
}

export function buildRenderedMarkdownEditorDecorationsForRanges(
  state: EditorState,
  ranges: readonly RenderedMarkdownEditorRange[],
): DecorationSet {
  const decorations: RenderedMarkdownDecoration[] = [];
  const lineRanges = normalizeRenderedMarkdownEditorLineRanges(state, ranges);

  for (const range of lineRanges) {
    let codeFenceMarker = getRenderedMarkdownCodeFenceMarkerBeforeLine(state, range.fromLine);
    for (let lineNumber = range.fromLine; lineNumber <= range.toLine; lineNumber += 1) {
      codeFenceMarker = pushRenderedMarkdownEditorLineDecorations(state, decorations, lineNumber, codeFenceMarker);
    }
  }

  return Decoration.set(
    decorations
      .filter((entry) => entry.from <= entry.to)
      .sort((a, b) => a.from - b.from || a.to - b.to),
    true,
  );
}

export function buildRenderedMarkdownEditorDecorations(state: EditorState): DecorationSet {
  return buildRenderedMarkdownEditorDecorationsForRanges(state, [{ from: 0, to: state.doc.length }]);
}

export const renderedMarkdownEditorPresentationExtension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildRenderedMarkdownEditorDecorationsForRanges(view.state, view.visibleRanges);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildRenderedMarkdownEditorDecorationsForRanges(update.state, update.view.visibleRanges);
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
  },
);

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

export function getMarkdownCodeEditorSourcePosition(
  value: string,
  offset: number,
): MarkdownCodeEditorSourcePosition {
  const clampedOffset = Math.max(0, Math.min(value.length, offset));
  const line = value.slice(0, clampedOffset).split('\n').length;
  const previousLineBreak = clampedOffset === 0 ? -1 : value.lastIndexOf('\n', clampedOffset - 1);
  const lineStart = previousLineBreak + 1;
  const lineEndIndex = value.indexOf('\n', clampedOffset);
  const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex;
  return {
    offset: clampedOffset,
    line,
    column: clampedOffset - lineStart + 1,
    lineStart,
    lineEnd,
    lineLength: lineEnd - lineStart,
    before: value.slice(Math.max(lineStart, clampedOffset - 40), clampedOffset),
    after: value.slice(clampedOffset, Math.min(lineEnd, clampedOffset + 40)),
  };
}

export function getMarkdownCodeEditorSelectionSnapshot(
  view: EditorView,
  input: { docChanged?: boolean; inputType?: string; inputData?: string | null } = {},
): MarkdownCodeEditorSelectionSnapshot {
  const value = view.state.doc.toString();
  const selection = view.state.selection.main;
  return {
    value,
    selectionStart: selection.from,
    selectionEnd: selection.to,
    selectionAnchor: selection.anchor,
    selectionHead: selection.head,
    isCollapsed: selection.empty,
    selectionStartSource: getMarkdownCodeEditorSourcePosition(value, selection.from),
    selectionEndSource: getMarkdownCodeEditorSourcePosition(value, selection.to),
    selectionHeadSource: getMarkdownCodeEditorSourcePosition(value, selection.head),
    caretPosition: getCodeEditorCaretPosition(view, selection.head),
    caretRect: getCodeEditorCaretRect(view, selection.head),
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

export function getMarkdownCodeEditorCursorAnimationStyle(blinkCursor: boolean): React.CSSProperties {
  return blinkCursor ? {} : { animation: 'none' };
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

const MarkdownCodeEditor = forwardRef<MarkdownCodeEditorHandle, MarkdownCodeEditorProps>(
  function MarkdownCodeEditor(props, ref) {
    const {
      value,
      onChange,
      presentation = 'source',
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
      blinkCursor = true,
      placeholder,
      readOnly = false,
      spellCheck = true,
      dataAttributes,
      style,
      onScroll,
      bottomRoomPx: bottomRoomPxProp,
    } = props;

    const { theme } = useTheme();
    const bottomRoomPx = getMarkdownCodeEditorBottomRoom(bottomRoomPxProp);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const viewRef = useRef<EditorView | null>(null);
    const bottomRoomPxRef = useRef(bottomRoomPx);
    const onChangeRef = useRef(onChange);
    const onKeyDownRef = useRef(props.onKeyDown);
    const onMouseDownRef = useRef(props.onMouseDown);
    const onPasteRef = useRef(props.onPaste);
    const onImagePreviewRef = useRef(props.onImagePreview);
    const onFocusRef = useRef(props.onFocus);
    const onBlurRef = useRef(props.onBlur);
    const onSelectionChangeRef = useRef(props.onSelectionChange);
    const onScrollRef = useRef(onScroll);
    const lastBeforeInputRef = useRef<{ inputType: string; data: string | null } | null>(null);
    const lastAppliedValueRef = useRef(value);
    const themeCompartment = useRef(new Compartment()).current;
    const syntaxHighlightCompartment = useRef(new Compartment()).current;
    const historyCompartment = useRef(new Compartment()).current;
    const readOnlyCompartment = useRef(new Compartment()).current;
    const cursorScrollMarginCompartment = useRef(new Compartment()).current;
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

    const editorTheme = useMemo(() => {
      const fontSizePx = typeof fontSize === 'number' ? `${fontSize}px` : String(fontSize);
      const lineHeightCss = typeof lineHeight === 'number' ? String(lineHeight) : String(lineHeight);
      const isRenderedPresentation = presentation === 'rendered';
      return EditorView.theme(
        {
          '&': {
            height: isRenderedPresentation ? 'auto' : '100%',
            color,
            backgroundColor: background ?? 'transparent',
            fontFamily,
            fontSize: fontSizePx,
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
            ...(isRenderedPresentation ? { paddingBottom: `calc(${paragraphSpacing ?? '0.78em'} * 0.12)` } : {}),
          },
          [`.${MARKDOWN_CODE_EDITOR_CHECKED_TASK_LINE_CLASS}`]: {
            opacity: 0.68,
          },
          '&.cm-focused': {
            outline: 'none',
          },
          '.cm-cursor, .cm-dropCursor': {
            borderLeftColor: caretColor ?? color,
          },
          '.cm-cursor': {
            ...getMarkdownCodeEditorCursorAnimationStyle(blinkCursor),
          },
          '.cm-selectionBackground, ::selection, .cm-content ::selection': {
            backgroundColor: selectionBackground ?? (theme.isDark ? 'rgba(120,170,255,0.25)' : 'rgba(80,140,255,0.25)'),
          },
          '.cm-activeLine': {
            backgroundColor: 'transparent',
          },
          '.cm-gutters': {
            display: 'none',
          },
          [`.${RENDERED_MARKDOWN_EDITOR_HEADING_CLASS}`]: {
            color,
            fontFamily: headingFontFamily ?? fontFamily,
            fontWeight: 620,
            letterSpacing: 0,
          },
          [`.${RENDERED_MARKDOWN_EDITOR_HEADING_CLASS}-1`]: {
            fontSize: h1Size ?? '1.55em',
            lineHeight: 1.2,
          },
          [`.${RENDERED_MARKDOWN_EDITOR_HEADING_CLASS}-2`]: {
            fontSize: h2Size ?? '1.18em',
            lineHeight: 1.28,
          },
          [`.${RENDERED_MARKDOWN_EDITOR_HEADING_CLASS}-3`]: {
            fontSize: h3Size ?? '1em',
            lineHeight: 1.35,
          },
          [`.${RENDERED_MARKDOWN_EDITOR_HEADING_MARKER_CLASS}, .${RENDERED_MARKDOWN_EDITOR_CODE_FENCE_MARKER_CLASS}`]: {
            display: 'inline-block',
            width: '0',
            overflow: 'hidden',
          },
          [`.${RENDERED_MARKDOWN_EDITOR_LIST_LINE_CLASS}`]: {
            paddingLeft: '0.1em',
          },
          [`.${RENDERED_MARKDOWN_EDITOR_LIST_MARKER_CLASS}`]: {
            display: 'inline-block',
            width: '1.55em',
            color: mutedColor ?? (theme.isDark ? 'rgba(255,255,255,0.58)' : 'rgba(17,17,17,0.58)'),
            fontVariantNumeric: 'tabular-nums',
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
            borderRadius: '4px',
            backgroundColor: theme.isDark ? 'rgba(255,255,255,0.065)' : 'rgba(0,0,0,0.045)',
            padding: '0.24em 0.65em',
            fontFamily: "'SF Mono', Menlo, Monaco, Consolas, monospace",
            fontSize: '0.9em',
            lineHeight: 1.55,
            whiteSpace: 'pre-wrap',
          },
          [`.${RENDERED_MARKDOWN_EDITOR_CODE_FENCE_CLASS}`]: {
            height: '0',
            lineHeight: '0',
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
            textDecoration: 'underline',
            textUnderlineOffset: '2px',
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
            flexDirection: 'column',
            alignItems: 'stretch',
            gap: '0.45em',
            width: '100%',
            maxWidth: '100%',
            margin: '0.8em 0 1em',
            verticalAlign: 'top',
            cursor: 'zoom-in',
          },
          [`.${RENDERED_MARKDOWN_EDITOR_IMAGE_CLASS} img`]: {
            display: 'block',
            width: '100%',
            maxWidth: '100%',
            height: 'auto',
            borderRadius: '8px',
            objectFit: 'contain',
            boxShadow: theme.isDark ? '0 8px 28px rgba(0, 0, 0, 0.26)' : '0 8px 28px rgba(15, 23, 42, 0.12)',
          },
          [`.${RENDERED_MARKDOWN_EDITOR_IMAGE_CAPTION_CLASS}`]: {
            display: 'block',
            color: mutedColor ?? (theme.isDark ? 'rgba(255,255,255,0.62)' : 'rgba(17,17,17,0.62)'),
            fontSize: '0.88em',
            lineHeight: 1.35,
          },
          [`.${RENDERED_MARKDOWN_EDITOR_TASK_MARKER_CLASS}`]: {
            display: 'inline-block',
            width: '1.05em',
            height: '1.05em',
            minWidth: '1.05em',
            marginRight: '0.6em',
            verticalAlign: '-0.14em',
            accentColor: linkColor ?? (theme.isDark ? '#7aa7ff' : '#1d4ed8'),
            cursor: 'pointer',
          },
          [`.${RENDERED_MARKDOWN_EDITOR_DONE_TASK_CLASS}`]: {
            opacity: 0.68,
          },
        },
        { dark: theme.isDark },
      );
    }, [
      background,
      blinkCursor,
      caretColor,
      color,
      bottomRoomPx,
      fontFamily,
      fontSize,
      h1Size,
      h2Size,
      h3Size,
      headingFontFamily,
      linkColor,
      lineHeight,
      mutedColor,
      paragraphSpacing,
      presentation,
      selectionBackground,
      theme.isDark,
    ]);

    // Mount once. Subsequent updates flow through compartments / dispatch.
    useLayoutEffect(() => {
      if (!containerRef.current) return;
      const startState = EditorState.create({
        doc: value,
        extensions: [
          historyCompartment.of(history()),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          markdown(),
          ...(presentation === 'rendered' ? [renderedMarkdownEditorPresentationExtension] : []),
          syntaxHighlightCompartment.of(syntaxHighlighting(buildHighlightStyle(theme.isDark))),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          bracketMatching(),
          highlightActiveLine(),
          checkedMarkdownTaskLineExtension,
          EditorView.lineWrapping,
          cursorScrollMarginCompartment.of(EditorView.cursorScrollMargin.of(getMarkdownCodeEditorCursorScrollMargin(bottomRoomPxRef.current))),
          themeCompartment.of(editorTheme),
          readOnlyCompartment.of(EditorState.readOnly.of(readOnly)),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !isMarkdownCodeEditorFileSwapUpdate(update)) {
              const next = update.state.doc.toString();
              onChangeRef.current?.(next);
            }
            if (update.docChanged || update.selectionSet) {
              const input = update.docChanged ? lastBeforeInputRef.current : null;
              if (update.docChanged) lastBeforeInputRef.current = null;
              onSelectionChangeRef.current?.(getMarkdownCodeEditorSelectionSnapshot(update.view, {
                docChanged: update.docChanged,
                inputType: input?.inputType,
                inputData: input?.data,
              }));
            }
          }),
          EditorView.domEventHandlers({
            beforeinput: (event) => {
              const input = event as InputEvent;
              lastBeforeInputRef.current = {
                inputType: input.inputType,
                data: input.data,
              };
              return false;
            },
            mousedown: (event, view) => {
              if (shouldMoveCaretToDocumentEndFromClick(view, event, bottomRoomPxRef.current)) {
                event.preventDefault();
                view.focus();
                const end = view.state.doc.length;
                view.dispatch({
                  selection: { anchor: end, head: end },
                  effects: EditorView.scrollIntoView(end, { yMargin: bottomRoomPxRef.current }),
                });
                return true;
              }
              const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
              if (pos === null) return false;
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
      scrollFpsSamplerRef(view.scrollDOM);
      const handleKeyDownCapture = (event: KeyboardEvent) => {
        handleMarkdownCodeEditorCapturedKeyDown(event, onKeyDownRef.current);
      };
      view.contentDOM.addEventListener('keydown', handleKeyDownCapture, true);

      // Apply data-* attributes on the content node so existing agent-context
      // selectors (data-ft-agent-context="markdown" etc.) still resolve.
      if (dataAttributes) {
        const contentEl = view.contentDOM;
        Object.entries(dataAttributes).forEach(([key, val]) => {
          if (val === undefined) return;
          contentEl.setAttribute(key, val);
        });
      }
      view.contentDOM.spellcheck = spellCheck;
      if (placeholder) view.contentDOM.setAttribute('aria-label', placeholder);

      return () => {
        view.contentDOM.removeEventListener('keydown', handleKeyDownCapture, true);
        scrollFpsSamplerRef(null);
        view.destroy();
        viewRef.current = null;
      };
      // We deliberately mount once; reactive props are reconfigured below.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Sync external value into the editor when it diverges.
    useEffect(() => {
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
      bottomRoomPxRef.current = bottomRoomPx;
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        effects: cursorScrollMarginCompartment.reconfigure(
          EditorView.cursorScrollMargin.of(getMarkdownCodeEditorCursorScrollMargin(bottomRoomPx)),
        ),
      });
    }, [bottomRoomPx, cursorScrollMarginCompartment]);

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
      [],
    );

    return (
      <div
        ref={containerRef}
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
