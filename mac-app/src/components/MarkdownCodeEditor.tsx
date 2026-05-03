/**
 * MarkdownCodeEditor — CodeMirror 6 based markdown source editor.
 *
 * CodeMirror 6 source editor used by LibrarianView. It exposes a minimal
 * value/onChange contract plus an imperative ref so callers can focus the editor
 * and read/write selection state without owning the CM instance.
 *
 * Scope is intentionally limited: this is the source-mode editor, not a
 * WYSIWYG/live-preview surface. Advanced behaviors such as wiki completion,
 * paste handling, and undo stack persistence are owned by LibrarianView.
 */
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react';
import { EditorState, Compartment, RangeSetBuilder } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
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

export const MARKDOWN_CODE_EDITOR_CARET_BOTTOM_ROOM_PX = 32;
export const MARKDOWN_CODE_EDITOR_CHECKED_TASK_LINE_CLASS = 'cm-markdown-task-line-checked';

export interface MarkdownCodeEditorHandle {
  focus: (options?: { preventScroll?: boolean }) => void;
  blur: () => void;
  getValue: () => string;
  getSelectionRange: () => { start: number; end: number };
  setSelectionRange: (start: number, end: number) => void;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

export interface MarkdownCodeEditorSelectionSnapshot {
  value: string;
  selectionStart: number;
  selectionEnd: number;
  caretPosition: { top: number; left: number } | null;
  docChanged: boolean;
  inputType?: string;
  inputData?: string | null;
}

interface MarkdownCodeEditorProps {
  value: string;
  onChange: (next: string) => void;
  fontFamily: string;
  fontSize: number | string;
  lineHeight: number | string;
  color: string;
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
  onFocus?: () => void;
  onBlur?: () => void;
  onSelectionChange?: (snapshot: MarkdownCodeEditorSelectionSnapshot) => void;
  onScroll?: (scrollTop: number) => void;
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

export function shouldMoveCaretToDocumentEndFromClick(view: EditorView, event: MouseEvent): boolean {
  if (event.button !== 0 || event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return false;
  const scroller = view.scrollDOM;
  const remainingScroll = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
  if (remainingScroll > MARKDOWN_CODE_EDITOR_CARET_BOTTOM_ROOM_PX + 2) return false;

  const lastLine = view.contentDOM.querySelector<HTMLElement>('.cm-line:last-child');
  if (!lastLine) return false;
  return event.clientY > lastLine.getBoundingClientRect().bottom;
}

export function getMarkdownCodeEditorCursorAnimationStyle(blinkCursor: boolean): React.CSSProperties {
  return blinkCursor ? {} : { animation: 'none' };
}

export function getMarkdownCodeEditorCursorScrollMargin(): { x: number; y: number } {
  return { x: 5, y: MARKDOWN_CODE_EDITOR_CARET_BOTTOM_ROOM_PX };
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
      fontFamily,
      fontSize,
      lineHeight,
      color,
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
    } = props;

    const { theme } = useTheme();
    const containerRef = useRef<HTMLDivElement | null>(null);
    const viewRef = useRef<EditorView | null>(null);
    const onChangeRef = useRef(onChange);
    const onKeyDownRef = useRef(props.onKeyDown);
    const onMouseDownRef = useRef(props.onMouseDown);
    const onPasteRef = useRef(props.onPaste);
    const onFocusRef = useRef(props.onFocus);
    const onBlurRef = useRef(props.onBlur);
    const onSelectionChangeRef = useRef(props.onSelectionChange);
    const onScrollRef = useRef(onScroll);
    const lastBeforeInputRef = useRef<{ inputType: string; data: string | null } | null>(null);
    const lastAppliedValueRef = useRef(value);
    const themeCompartment = useRef(new Compartment()).current;
    const syntaxHighlightCompartment = useRef(new Compartment()).current;
    const readOnlyCompartment = useRef(new Compartment()).current;
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
      return EditorView.theme(
        {
          '&': {
            height: '100%',
            color,
            backgroundColor: background ?? 'transparent',
            fontFamily,
            fontSize: fontSizePx,
          },
          '.cm-scroller': {
            fontFamily,
            lineHeight: lineHeightCss,
            overflow: 'auto',
            cursor: 'text',
          },
          '.cm-content': {
            caretColor: caretColor ?? color,
            padding: '0',
            paddingBottom: `${MARKDOWN_CODE_EDITOR_CARET_BOTTOM_ROOM_PX}px`,
            cursor: 'text',
          },
          '.cm-line': {
            padding: '0',
            cursor: 'text',
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
        },
        { dark: theme.isDark },
      );
    }, [
      background,
      blinkCursor,
      caretColor,
      color,
      fontFamily,
      fontSize,
      lineHeight,
      selectionBackground,
      theme.isDark,
    ]);

    // Mount once. Subsequent updates flow through compartments / dispatch.
    useLayoutEffect(() => {
      if (!containerRef.current) return;
      const startState = EditorState.create({
        doc: value,
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          markdown(),
          syntaxHighlightCompartment.of(syntaxHighlighting(buildHighlightStyle(theme.isDark))),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          bracketMatching(),
          highlightActiveLine(),
          checkedMarkdownTaskLineExtension,
          EditorView.lineWrapping,
          EditorView.cursorScrollMargin.of(getMarkdownCodeEditorCursorScrollMargin()),
          themeCompartment.of(editorTheme),
          readOnlyCompartment.of(EditorState.readOnly.of(readOnly)),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              const next = update.state.doc.toString();
              onChangeRef.current?.(next);
            }
            if (update.docChanged || update.selectionSet) {
              const selection = update.state.selection.main;
              const input = update.docChanged ? lastBeforeInputRef.current : null;
              if (update.docChanged) lastBeforeInputRef.current = null;
              onSelectionChangeRef.current?.({
                value: update.state.doc.toString(),
                selectionStart: selection.from,
                selectionEnd: selection.to,
                caretPosition: getCodeEditorCaretPosition(update.view, selection.head),
                docChanged: update.docChanged,
                inputType: input?.inputType,
                inputData: input?.data,
              });
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
              if (shouldMoveCaretToDocumentEndFromClick(view, event)) {
                event.preventDefault();
                view.focus();
                const end = view.state.doc.length;
                view.dispatch({
                  selection: { anchor: end, head: end },
                  effects: EditorView.scrollIntoView(end, { yMargin: MARKDOWN_CODE_EDITOR_CARET_BOTTOM_ROOM_PX }),
                });
                return true;
              }
              const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
              if (pos === null) return false;
              return onMouseDownRef.current?.(event, pos) === true;
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
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    }, [value]);

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
                yMargin: MARKDOWN_CODE_EDITOR_CARET_BOTTOM_ROOM_PX,
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
        setSelectionRange: (start, end) => {
          const view = viewRef.current;
          if (!view) return;
          const length = view.state.doc.length;
          const safeStart = Math.max(0, Math.min(start, length));
          const safeEnd = Math.max(0, Math.min(end, length));
          view.dispatch({
            selection: { anchor: safeStart, head: safeEnd },
            effects: EditorView.scrollIntoView(safeEnd, { yMargin: MARKDOWN_CODE_EDITOR_CARET_BOTTOM_ROOM_PX }),
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
