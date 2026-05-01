/**
 * MarkdownCodeEditor — CodeMirror 6 based markdown source editor.
 *
 * Drop-in alternative to the native <textarea> used in LibrarianView. It exposes
 * a minimal value/onChange contract plus an imperative ref so callers can focus
 * the editor and read/write selection state without owning the CM instance.
 *
 * Scope is intentionally limited: this is the source-mode editor, not a
 * WYSIWYG/live-preview surface. All advanced behaviors (wiki completion,
 * paste handlers, undo stack persistence, etc.) live in the parent textarea
 * path and stay there for now — switching renderers should be reversible.
 */
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react';
import { EditorState, Compartment } from '@codemirror/state';
import {
  EditorView,
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

export interface MarkdownCodeEditorHandle {
  focus: (options?: { preventScroll?: boolean }) => void;
  blur: () => void;
  getValue: () => string;
  getSelectionRange: () => { start: number; end: number };
  setSelectionRange: (start: number, end: number) => void;
  scrollTop: number;
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
  placeholder?: string;
  readOnly?: boolean;
  spellCheck?: boolean;
  dataAttributes?: Record<string, string | undefined>;
  style?: React.CSSProperties;
  onKeyDown?: (event: KeyboardEvent) => boolean | void;
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
      color: isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.55)',
    },
  ]);

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
    const onScrollRef = useRef(onScroll);
    const themeCompartment = useRef(new Compartment()).current;
    const readOnlyCompartment = useRef(new Compartment()).current;

    useEffect(() => {
      onChangeRef.current = onChange;
    }, [onChange]);

    useEffect(() => {
      onKeyDownRef.current = props.onKeyDown;
    }, [props.onKeyDown]);

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
          },
          '.cm-content': {
            caretColor: caretColor ?? color,
            padding: '0',
          },
          '.cm-line': {
            padding: '0',
          },
          '&.cm-focused': {
            outline: 'none',
          },
          '.cm-cursor, .cm-dropCursor': {
            borderLeftColor: caretColor ?? color,
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
          syntaxHighlighting(buildHighlightStyle(theme.isDark)),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          bracketMatching(),
          highlightActiveLine(),
          EditorView.lineWrapping,
          themeCompartment.of(editorTheme),
          readOnlyCompartment.of(EditorState.readOnly.of(readOnly)),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              const next = update.state.doc.toString();
              onChangeRef.current?.(next);
            }
          }),
          EditorView.domEventHandlers({
            keydown: (event) => onKeyDownRef.current?.(event) === true,
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
      view.dispatch({ effects: themeCompartment.reconfigure(editorTheme) });
    }, [editorTheme, themeCompartment]);

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
            view.dispatch({ effects: EditorView.scrollIntoView(view.state.selection.main.head) });
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
          view.dispatch({ selection: { anchor: safeStart, head: safeEnd } });
        },
        get scrollTop() {
          const scroller = viewRef.current?.scrollDOM;
          return scroller ? scroller.scrollTop : 0;
        },
        set scrollTop(value: number) {
          const scroller = viewRef.current?.scrollDOM;
          if (scroller) scroller.scrollTop = value;
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
