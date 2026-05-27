import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
import { Terminal, type ITerminalOptions } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { useTheme, type Theme } from '../contexts/ThemeContext';

type CodexTerminalSessionSummary = Awaited<ReturnType<NonNullable<Window['codexTerminalAPI']>['create']>>;
type CodexTerminalPageContext = Parameters<NonNullable<Window['codexTerminalAPI']>['attachPageContext']>[1];

interface CodexTerminalPanelProps {
  visible: boolean;
  pageContext: CodexTerminalPageContext | null;
  extendToViewportTop?: boolean;
  focusRequestKey?: number;
  onDockSideChange?: (dockSide: CodexTerminalDockSide) => void;
  onFocusToggleShortcut?: (options?: { restoreEditorFocus?: boolean }) => void;
  onTerminalFocusChange?: (focused: boolean) => void;
  onVisibilityToggleShortcut?: (options?: { restoreEditorFocus?: boolean }) => void;
  onVisibleChange: (visible: boolean) => void;
}

export type CodexTerminalDockSide = 'bottom' | 'right';
const CODEX_TERMINAL_DOCK_STORAGE_KEY = 'fieldtheory.codexTerminal.dockSide';
const CODEX_TERMINAL_ACTIVE_SESSION_STORAGE_KEY = 'fieldtheory.codexTerminal.activeSessionId';
const CODEX_TERMINAL_BOTTOM_SIZE_STORAGE_KEY = 'fieldtheory.codexTerminal.bottomHeight';
const CODEX_TERMINAL_RIGHT_SIZE_STORAGE_KEY = 'fieldtheory.codexTerminal.rightWidth';
const CODEX_TERMINAL_VISIBLE_STORAGE_KEY = 'fieldtheory.codexTerminal.visible';
const DEFAULT_BOTTOM_HEIGHT = 320;
const DEFAULT_RIGHT_WIDTH = 520;
const MIN_BOTTOM_HEIGHT = 220;
const MIN_RIGHT_WIDTH = 360;
const MAX_BOTTOM_HEIGHT_RATIO = 0.72;
const MAX_RIGHT_WIDTH_RATIO = 0.68;
const TERMINAL_GUTTER_TOP = 12;
const TERMINAL_GUTTER_RIGHT = 28;
const TERMINAL_GUTTER_BOTTOM = 40;
const TERMINAL_GUTTER_LEFT = 14;
const TERMINAL_BOTTOM_RESERVED_ROWS = 1;
const TERMINAL_VIEWPORT_TOP_PADDING = 8;
const TERMINAL_DOCK_DIVIDER_SIZE = 2;
const LIVE_CONTEXT_UPDATE_DELAY_MS = 700;
const HISTORY_OVERLAY_WIDTH = 420;

interface TerminalHandle {
  term: Terminal;
  fit: FitAddon;
}

export function mergeCodexTerminalSessions(
  current: CodexTerminalSessionSummary[],
  incoming: CodexTerminalSessionSummary[],
): CodexTerminalSessionSummary[] {
  const byId = new Map(current.map((session) => [session.id, session]));
  for (const session of incoming) byId.set(session.id, session);
  return Array.from(byId.values());
}

export function nativeTerminalNavigationSequence(event: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'>): string | null {
  if (event.ctrlKey || event.shiftKey) return null;
  if (event.metaKey && !event.altKey) {
    if (event.key === 'ArrowLeft') return '\x01';
    if (event.key === 'ArrowRight') return '\x05';
    if (event.key === 'Backspace' || event.key === 'Delete') return '\x15';
  }
  if (event.altKey && !event.metaKey) {
    if (event.key === 'ArrowLeft') return '\x1bb';
    if (event.key === 'ArrowRight') return '\x1bf';
  }
  return null;
}

export function isTerminalFocusToggleSequence(event: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'>): boolean {
  return event.key === 'Tab'
    && event.ctrlKey
    && !event.altKey
    && !event.metaKey
    && !event.shiftKey;
}

export function isTerminalPanelVisibilityToggleSequence(event: Pick<KeyboardEvent, 'altKey' | 'code' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'>): boolean {
  return event.metaKey
    && !event.altKey
    && !event.ctrlKey
    && !event.shiftKey
    && (event.key === '.' || event.code === 'Period');
}

export function shouldFocusTerminalForRequest(input: { visible: boolean; focusRequestKey: number }): boolean {
  return input.visible && input.focusRequestKey > 0;
}

export function terminalViewportStyleCss(terminalBackground: string): string {
  return `.codex-terminal-host .xterm,
.codex-terminal-host .xterm .xterm-screen,
.codex-terminal-host .xterm .xterm-viewport {
  background-color: ${terminalBackground} !important;
}
.codex-terminal-host .xterm .xterm-viewport {
  scrollbar-width: none !important;
  scrollbar-color: transparent transparent !important;
  scrollbar-gutter: auto !important;
}
.codex-terminal-host .xterm .xterm-viewport::-webkit-scrollbar {
  width: 0 !important;
  height: 0 !important;
  display: none !important;
}`;
}

function pathBasename(input: string): string {
  const parts = input.split('/').filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : input;
}

export function formatTerminalCwdLabel(input: string): string {
  return input.replace(/^\/Users\/[^/]+(?=\/|$)/, '~');
}

export function terminalTheme(isDark: boolean): ITerminalOptions['theme'] {
  return {
    background: isDark ? '#101113' : '#f7f2e8',
    foreground: isDark ? '#e8e3d8' : '#111827',
    cursor: isDark ? '#10b981' : '#047857',
    selectionBackground: isDark ? '#2f4a43' : '#b7d9cb',
    black: isDark ? '#111315' : '#111827',
    red: isDark ? '#ef4444' : '#991b1b',
    green: isDark ? '#10b981' : '#047857',
    yellow: isDark ? '#f59e0b' : '#92400e',
    blue: isDark ? '#60a5fa' : '#1d4ed8',
    magenta: isDark ? '#a78bfa' : '#6d28d9',
    cyan: isDark ? '#22d3ee' : '#0e7490',
    white: isDark ? '#e8e3d8' : '#374151',
    brightBlack: isDark ? '#6b7280' : '#4b5563',
    brightRed: isDark ? '#f87171' : '#b91c1c',
    brightGreen: isDark ? '#34d399' : '#047857',
    brightYellow: isDark ? '#fbbf24' : '#a16207',
    brightBlue: isDark ? '#93c5fd' : '#1d4ed8',
    brightMagenta: isDark ? '#c4b5fd' : '#6d28d9',
    brightCyan: isDark ? '#67e8f9' : '#0f766e',
    brightWhite: isDark ? '#ffffff' : '#111827',
  };
}

export function terminalContrastRatio(isDark: boolean): number {
  return isDark ? 1 : 4.5;
}

export function terminalAppearanceOptions(isDark: boolean): Pick<ITerminalOptions, 'minimumContrastRatio' | 'theme'> {
  return {
    minimumContrastRatio: terminalContrastRatio(isDark),
    theme: terminalTheme(isDark),
  };
}

function readStoredNumber(key: string, fallback: number): number {
  const value = Number.parseInt(localStorage.getItem(key) ?? '', 10);
  return Number.isFinite(value) ? value : fallback;
}

function isEditableEventTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

function clampBottomHeight(value: number): number {
  const max = Math.floor(window.innerHeight * MAX_BOTTOM_HEIGHT_RATIO);
  return Math.max(MIN_BOTTOM_HEIGHT, Math.min(max, value));
}

function clampRightWidth(value: number): number {
  const max = Math.floor(window.innerWidth * MAX_RIGHT_WIDTH_RATIO);
  return Math.max(MIN_RIGHT_WIDTH, Math.min(max, value));
}

export default function CodexTerminalPanel({ visible, pageContext, extendToViewportTop = false, focusRequestKey = 0, onDockSideChange, onFocusToggleShortcut, onTerminalFocusChange, onVisibilityToggleShortcut, onVisibleChange }: CodexTerminalPanelProps) {
  const { theme } = useTheme();
  const [dockSide, setDockSide] = useState<CodexTerminalDockSide>(() => (
    localStorage.getItem(CODEX_TERMINAL_DOCK_STORAGE_KEY) === 'right' ? 'right' : 'bottom'
  ));
  const [sessions, setSessions] = useState<CodexTerminalSessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(() => (
    localStorage.getItem(CODEX_TERMINAL_ACTIVE_SESSION_STORAGE_KEY) || null
  ));
  const [bottomHeight, setBottomHeight] = useState(() => clampBottomHeight(readStoredNumber(CODEX_TERMINAL_BOTTOM_SIZE_STORAGE_KEY, DEFAULT_BOTTOM_HEIGHT)));
  const [rightWidth, setRightWidth] = useState(() => clampRightWidth(readStoredNumber(CODEX_TERMINAL_RIGHT_SIZE_STORAGE_KEY, DEFAULT_RIGHT_WIDTH)));
  const [terminalStatus, setTerminalStatus] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyQuery, setHistoryQuery] = useState('');
  const [debouncedHistoryQuery, setDebouncedHistoryQuery] = useState('');
  const [historyEntries, setHistoryEntries] = useState<CodexTerminalHistoryEntry[]>([]);
  const [historyPreview, setHistoryPreview] = useState<CodexTerminalHistoryPreview | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyOverlayRect, setHistoryOverlayRect] = useState<CSSProperties | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const [topExtension, setTopExtension] = useState(0);
  const topExtensionRef = useRef(0);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const terminalHandlesRef = useRef(new Map<string, TerminalHandle>());
  const pendingDataRef = useRef(new Map<string, string[]>());
  const autoAttachedContextRef = useRef(new Set<string>());
  const liveContextUpdateRef = useRef<number | null>(null);
  const onFocusToggleShortcutRef = useRef(onFocusToggleShortcut);
  const onVisibilityToggleShortcutRef = useRef<CodexTerminalPanelProps['onVisibilityToggleShortcut']>(undefined);
  const terminalFocusRequestedRef = useRef(false);

  useEffect(() => {
    onFocusToggleShortcutRef.current = onFocusToggleShortcut;
  }, [onFocusToggleShortcut]);

  useEffect(() => {
    onVisibilityToggleShortcutRef.current = onVisibilityToggleShortcut;
  }, [onVisibilityToggleShortcut]);

  const updateDockSide = useCallback((nextDockSide: CodexTerminalDockSide) => {
    setDockSide(nextDockSide);
    onDockSideChange?.(nextDockSide);
  }, [onDockSideChange]);
  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? sessions[0] ?? null,
    [activeSessionId, sessions],
  );
  const visibleSessions = sessions;

  const refreshSessions = useCallback(async () => {
    const next = await window.codexTerminalAPI?.list();
    if (!next) return;
    setSessions(next);
    setActiveSessionId((current) => current && next.some((session) => session.id === current)
      ? current
      : next[0]?.id ?? null);
  }, []);

  const updateHistoryOverlayRect = useCallback(() => {
    const panel = panelRef.current;
    if (!panel || dockSide !== 'right') {
      setHistoryOverlayRect(null);
      return;
    }
    const rect = panel.getBoundingClientRect();
    const availableWidth = Math.max(260, rect.left - 12);
    const width = Math.min(HISTORY_OVERLAY_WIDTH, availableWidth);
    setHistoryOverlayRect({
      position: 'fixed',
      top: `${rect.top}px`,
      left: `${Math.max(8, rect.left - width)}px`,
      width: `${width}px`,
      height: `${rect.height}px`,
    });
  }, [dockSide]);

  const refreshHistory = useCallback(async (query: string) => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      if (!window.codexTerminalAPI?.listHistory) {
        setHistoryError('Restart Field Theory to load Codex history.');
        setHistoryEntries([]);
        return;
      }
      const next = await window.codexTerminalAPI.listHistory({ query, limit: 60 });
      setHistoryEntries(next ?? []);
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : 'Could not load Codex history.');
      setHistoryEntries([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const readHistoryPreview = useCallback(async (entry: CodexTerminalHistoryEntry) => {
    setHistoryError(null);
    try {
      if (!window.codexTerminalAPI?.readHistoryPreview) {
        setHistoryError('Restart Field Theory to load Codex history.');
        setHistoryPreview(null);
        return;
      }
      const preview = await window.codexTerminalAPI.readHistoryPreview(entry.filePath);
      setHistoryPreview(preview ?? null);
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : 'Could not load Codex thread preview.');
      setHistoryPreview(null);
    }
  }, []);

  const fitActiveTerminal = useCallback(() => {
    if (!activeSessionId) return;
    const handle = terminalHandlesRef.current.get(activeSessionId);
    if (!handle) return;
    try {
      handle.fit.fit();
      if (handle.term.rows > TERMINAL_BOTTOM_RESERVED_ROWS) {
        handle.term.resize(handle.term.cols, handle.term.rows - TERMINAL_BOTTOM_RESERVED_ROWS);
      }
      void window.codexTerminalAPI?.resize(activeSessionId, handle.term.cols, handle.term.rows);
    } catch {
      // Resize can race while the panel is hidden or changing dock sides.
    }
  }, [activeSessionId]);

  const focusActiveTerminal = useCallback(() => {
    if (!activeSessionId) return false;
    const handle = terminalHandlesRef.current.get(activeSessionId);
    if (!handle) return false;
    handle.term.focus();
    return true;
  }, [activeSessionId]);

  const createSession = useCallback(async (input?: { cwd?: string; title?: string; auto?: boolean; launchCommand?: string }) => {
    const session = await window.codexTerminalAPI?.create({
      title: input?.title ?? `Codex ${sessions.length + 1}`,
      cwd: input?.cwd,
      auto: input?.auto,
      launchCommand: input?.launchCommand,
    });
    if (!session) return;
    setSessions((current) => mergeCodexTerminalSessions(current, [session]));
    setActiveSessionId(session.id);
    window.setTimeout(() => terminalHandlesRef.current.get(session.id)?.term.focus(), 80);
  }, [sessions.length]);

  const resumeHistoryEntry = useCallback(async (entry: CodexTerminalHistoryEntry) => {
    if (!entry.threadId) {
      setHistoryError('This Codex thread is missing a resume id.');
      return;
    }
    setHistoryOpen(false);
    await createSession({
      cwd: entry.cwd ?? undefined,
      title: `Resume ${entry.title || entry.threadId}`,
      launchCommand: `codex resume ${entry.threadId}`,
    });
  }, [createSession]);

  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  useEffect(() => {
    if (!historyOpen) return;
    const timer = window.setTimeout(() => setDebouncedHistoryQuery(historyQuery), 140);
    return () => window.clearTimeout(timer);
  }, [historyOpen, historyQuery]);

  useEffect(() => {
    if (!historyOpen) return;
    updateHistoryOverlayRect();
    void refreshHistory(debouncedHistoryQuery);
  }, [debouncedHistoryQuery, historyOpen, refreshHistory, updateHistoryOverlayRect]);

  useEffect(() => {
    if (!historyOpen) return;
    updateHistoryOverlayRect();
    window.addEventListener('resize', updateHistoryOverlayRect);
    window.addEventListener('scroll', updateHistoryOverlayRect, true);
    return () => {
      window.removeEventListener('resize', updateHistoryOverlayRect);
      window.removeEventListener('scroll', updateHistoryOverlayRect, true);
    };
  }, [historyOpen, updateHistoryOverlayRect]);

  useEffect(() => {
    if (!historyOpen) {
      setHistoryPreview(null);
      return;
    }
    if (!historyEntries.some((entry) => entry.filePath === historyPreview?.filePath)) {
      const first = historyEntries[0];
      if (first) {
        void readHistoryPreview(first);
      } else {
        setHistoryPreview(null);
      }
    }
  }, [historyEntries, historyOpen, historyPreview?.filePath, readHistoryPreview]);

  useEffect(() => {
    if (!historyOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setHistoryOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [historyOpen]);

  useEffect(() => {
    localStorage.setItem(CODEX_TERMINAL_DOCK_STORAGE_KEY, dockSide);
  }, [dockSide]);

  useEffect(() => {
    localStorage.setItem(CODEX_TERMINAL_VISIBLE_STORAGE_KEY, String(visible));
  }, [visible]);

  useEffect(() => {
    if (activeSessionId) {
      localStorage.setItem(CODEX_TERMINAL_ACTIVE_SESSION_STORAGE_KEY, activeSessionId);
    } else {
      localStorage.removeItem(CODEX_TERMINAL_ACTIVE_SESSION_STORAGE_KEY);
    }
  }, [activeSessionId]);

  useEffect(() => {
    localStorage.setItem(CODEX_TERMINAL_BOTTOM_SIZE_STORAGE_KEY, String(bottomHeight));
  }, [bottomHeight]);

  useEffect(() => {
    localStorage.setItem(CODEX_TERMINAL_RIGHT_SIZE_STORAGE_KEY, String(rightWidth));
  }, [rightWidth]);

  useLayoutEffect(() => {
    if (!visible || dockSide !== 'right' || !extendToViewportTop) {
      topExtensionRef.current = 0;
      setTopExtension(0);
      return;
    }
    const panel = panelRef.current;
    if (!panel) return;
    const updateTopExtension = () => {
      const { top } = panel.getBoundingClientRect();
      const next = Math.max(0, Math.round(top + topExtensionRef.current));
      topExtensionRef.current = next;
      setTopExtension(next);
    };
    updateTopExtension();
    const frame = window.requestAnimationFrame(updateTopExtension);
    window.addEventListener('resize', updateTopExtension);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', updateTopExtension);
    };
  }, [dockSide, extendToViewportTop, visible]);

  useEffect(() => {
    if (visible && sessions.length === 0) {
      void createSession({ auto: true });
    }
  }, [createSession, sessions.length, visible]);

  useEffect(() => {
    const offData = window.codexTerminalAPI?.onData(({ id, data }) => {
      const handle = terminalHandlesRef.current.get(id);
      if (handle) {
        handle.term.write(data);
        return;
      }
      const pending = pendingDataRef.current.get(id) ?? [];
      pending.push(data);
      pendingDataRef.current.set(id, pending);
    });
    const offExit = window.codexTerminalAPI?.onExit((session) => {
      setSessions((current) => current.map((item) => item.id === session.id ? session : item));
    });
    const offSessionsChanged = window.codexTerminalAPI?.onSessionsChanged((nextSessions) => {
      setSessions(nextSessions);
      setActiveSessionId((current) => current && nextSessions.some((session) => session.id === current)
        ? current
        : nextSessions[0]?.id ?? null);
    });
    return () => {
      offData?.();
      offExit?.();
      offSessionsChanged?.();
    };
  }, []);

  useEffect(() => {
    const handleResize = () => {
      setBottomHeight((current) => clampBottomHeight(current));
      setRightWidth((current) => clampRightWidth(current));
      fitActiveTerminal();
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [fitActiveTerminal]);

  useEffect(() => {
    const appearance = terminalAppearanceOptions(theme.isDark);
    for (const handle of terminalHandlesRef.current.values()) {
      handle.term.options.theme = appearance.theme;
      handle.term.options.minimumContrastRatio = appearance.minimumContrastRatio;
      handle.term.refresh(0, Math.max(0, handle.term.rows - 1));
    }
  }, [theme.isDark]);

  useEffect(() => {
    const timer = window.setTimeout(fitActiveTerminal, 60);
    return () => window.clearTimeout(timer);
  }, [dockSide, fitActiveTerminal, visible]);

  useEffect(() => {
    if (!shouldFocusTerminalForRequest({ visible, focusRequestKey })) return;
    terminalFocusRequestedRef.current = true;
    const timer = window.setTimeout(() => {
      fitActiveTerminal();
      if (focusActiveTerminal()) terminalFocusRequestedRef.current = false;
    }, 30);
    return () => window.clearTimeout(timer);
  }, [fitActiveTerminal, focusActiveTerminal, focusRequestKey, visible]);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel || !onTerminalFocusChange) return;
    const handleFocusIn = () => onTerminalFocusChange(true);
    const handleFocusOut = () => {
      window.setTimeout(() => {
        onTerminalFocusChange(panel.contains(document.activeElement));
      }, 0);
    };
    panel.addEventListener('focusin', handleFocusIn);
    panel.addEventListener('focusout', handleFocusOut);
    return () => {
      panel.removeEventListener('focusin', handleFocusIn);
      panel.removeEventListener('focusout', handleFocusOut);
    };
  }, [onTerminalFocusChange, visible]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!visible || !event.metaKey) return;
      if (event.key.toLowerCase() === 'c' && activeSessionId) {
        const selection = terminalHandlesRef.current.get(activeSessionId)?.term.getSelection() ?? '';
        if (selection) {
          event.preventDefault();
          event.stopPropagation();
          void window.codexTerminalAPI?.writeClipboardText(selection);
          return;
        }
      }
      if (event.key.toLowerCase() === 'v' && activeSessionId && !isEditableEventTarget(event.target)) {
        event.preventDefault();
        event.stopPropagation();
        void window.codexTerminalAPI?.readClipboardText().then((text) => {
          if (text) void window.codexTerminalAPI?.input(activeSessionId, text);
        });
        return;
      }
      if (event.key.toLowerCase() === 't') {
        event.preventDefault();
        void createSession();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [activeSessionId, createSession, visible]);

  const setTerminalHost = useCallback((sessionId: string, element: HTMLDivElement | null) => {
    if (!element || terminalHandlesRef.current.has(sessionId)) return;
    const fit = new FitAddon();
    const webLinks = new WebLinksAddon();
    const term = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: 12,
      lineHeight: 1.18,
      scrollback: 8000,
      ...terminalAppearanceOptions(theme.isDark),
    });
    term.loadAddon(fit);
    term.loadAddon(webLinks);
    term.open(element);
    terminalHandlesRef.current.set(sessionId, { term, fit });
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true;
      if (isTerminalPanelVisibilityToggleSequence(event)) {
        event.preventDefault();
        onTerminalFocusChange?.(false);
        if (onVisibilityToggleShortcutRef.current) {
          onVisibilityToggleShortcutRef.current({ restoreEditorFocus: true });
        } else {
          onVisibleChange(false);
        }
        return false;
      }
      if (isTerminalFocusToggleSequence(event)) {
        event.preventDefault();
        onFocusToggleShortcutRef.current?.({ restoreEditorFocus: true });
        return false;
      }
      const sequence = nativeTerminalNavigationSequence(event);
      if (!sequence) return true;
      event.preventDefault();
      void window.codexTerminalAPI?.input(sessionId, sequence);
      return false;
    });
    void window.codexTerminalAPI?.getBuffer(sessionId).then((buffer) => {
      if (buffer && terminalHandlesRef.current.get(sessionId)?.term === term) {
        term.write(buffer);
      }
    });
    term.onData((data) => {
      void window.codexTerminalAPI?.input(sessionId, data);
    });
    const pending = pendingDataRef.current.get(sessionId);
    if (pending?.length) {
      for (const chunk of pending) term.write(chunk);
      pendingDataRef.current.delete(sessionId);
    }
    window.setTimeout(() => {
      fit.fit();
      if (term.rows > TERMINAL_BOTTOM_RESERVED_ROWS) {
        term.resize(term.cols, term.rows - TERMINAL_BOTTOM_RESERVED_ROWS);
      }
      void window.codexTerminalAPI?.resize(sessionId, term.cols, term.rows);
      if (terminalFocusRequestedRef.current && sessionId === activeSessionId) {
        term.focus();
        terminalFocusRequestedRef.current = false;
      }
    }, 30);
  }, [activeSessionId, onTerminalFocusChange, onVisibleChange, theme.isDark]);

  const closeSession = useCallback(async (sessionId: string) => {
    const remainingSessions = sessions.filter((session) => session.id !== sessionId);
    if (remainingSessions.length === 0) {
      setActiveSessionId(sessionId);
      onVisibleChange(false);
      return;
    }
    await window.codexTerminalAPI?.kill(sessionId);
    const handle = terminalHandlesRef.current.get(sessionId);
    handle?.term.dispose();
    terminalHandlesRef.current.delete(sessionId);
    pendingDataRef.current.delete(sessionId);
    if (activeSessionId === sessionId) {
      setActiveSessionId(remainingSessions[0].id);
    }
    await refreshSessions();
  }, [activeSessionId, onVisibleChange, refreshSessions, sessions]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!visible || !event.metaKey || event.key.toLowerCase() !== 'w' || !activeSession) return;
      event.preventDefault();
      event.stopPropagation();
      void closeSession(activeSession.id);
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [activeSession, closeSession, visible]);

  const restartSession = useCallback(async (session: CodexTerminalSessionSummary) => {
    await createSession({ cwd: session.cwd, title: session.title });
  }, [createSession]);

  useEffect(() => {
    if (!visible || !pageContext || !activeSession) return;
    if (activeSession.restored || activeSession.exitedAt) return;
    const sourcePath = pageContext.path || 'unknown';
    const hasLiveAttachment = activeSession.attachedContexts.some((context) => context.sourcePath === sourcePath);
    if (hasLiveAttachment) return;
    const autoAttachKey = `${activeSession.id}:${sourcePath}`;
    if (autoAttachedContextRef.current.has(autoAttachKey)) return;
    autoAttachedContextRef.current.add(autoAttachKey);

    let cancelled = false;
    void window.codexTerminalAPI?.attachPageContext(activeSession.id, pageContext, { notifyTerminal: false }).then(async (result) => {
      if (cancelled) return;
      if (!result?.ok) {
        autoAttachedContextRef.current.delete(autoAttachKey);
        setTerminalStatus(result?.error ?? 'Could not update current document context.');
        return;
      }
      await refreshSessions();
    });

    return () => {
      cancelled = true;
    };
  }, [activeSession, pageContext, refreshSessions, visible]);

  useEffect(() => {
    if (liveContextUpdateRef.current !== null) {
      window.clearTimeout(liveContextUpdateRef.current);
      liveContextUpdateRef.current = null;
    }
    if (!pageContext || !activeSession || activeSession.restored || activeSession.exitedAt) return;
    const hasLiveAttachment = activeSession.attachedContexts.some((context) => context.sourcePath === pageContext.path);
    if (!hasLiveAttachment) return;

    liveContextUpdateRef.current = window.setTimeout(() => {
      liveContextUpdateRef.current = null;
      void window.codexTerminalAPI?.attachPageContext(activeSession.id, pageContext, { notifyTerminal: false }).then((result) => {
        if (!result?.ok) {
          setTerminalStatus(result?.error ?? 'Could not refresh current document context.');
        }
      });
    }, LIVE_CONTEXT_UPDATE_DELAY_MS);

    return () => {
      if (liveContextUpdateRef.current !== null) {
        window.clearTimeout(liveContextUpdateRef.current);
        liveContextUpdateRef.current = null;
      }
    };
  }, [activeSession, pageContext]);

  const panelSize: CSSProperties = dockSide === 'bottom'
    ? { height: `${bottomHeight}px`, minHeight: `${MIN_BOTTOM_HEIGHT}px`, width: '100%' }
    : {
      height: topExtension > 0 ? `calc(100% + ${topExtension}px)` : '100%',
      marginTop: topExtension > 0 ? `-${topExtension}px` : undefined,
      width: `${rightWidth}px`,
      minWidth: `${MIN_RIGHT_WIDTH}px`,
    };
  const activeCwd = activeSession?.cwd ?? '';
  const activeCwdLabel = formatTerminalCwdLabel(activeCwd);
  const terminalBackground = theme.isDark ? '#101113' : '#f0eadf';
  const terminalChrome = theme.isDark ? '#15181e' : '#ebe3d6';
  const terminalSoftBorder = theme.isDark ? '#242832' : '#ded3c2';
  const terminalMutedText = theme.isDark ? '#8a8f99' : '#635f58';
  const toolbarTopInset = dockSide === 'right' && extendToViewportTop ? TERMINAL_VIEWPORT_TOP_PADDING : 0;
  const toolbarItemOffset: CSSProperties | undefined = toolbarTopInset > 0 ? { marginTop: `${toolbarTopInset}px` } : undefined;

  const startResize = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsResizing(true);
    const startX = event.clientX;
    const startY = event.clientY;
    const startBottomHeight = bottomHeight;
    const startRightWidth = rightWidth;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = dockSide === 'bottom' ? 'row-resize' : 'col-resize';
    document.body.style.userSelect = 'none';
    const onMove = (moveEvent: MouseEvent) => {
      if (dockSide === 'bottom') {
        const max = Math.floor(window.innerHeight * MAX_BOTTOM_HEIGHT_RATIO);
        setBottomHeight(Math.max(MIN_BOTTOM_HEIGHT, Math.min(max, startBottomHeight + startY - moveEvent.clientY)));
      } else {
        const max = Math.floor(window.innerWidth * MAX_RIGHT_WIDTH_RATIO);
        setRightWidth(Math.max(MIN_RIGHT_WIDTH, Math.min(max, startRightWidth + startX - moveEvent.clientX)));
      }
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      setIsResizing(false);
      window.setTimeout(fitActiveTerminal, 20);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [bottomHeight, dockSide, fitActiveTerminal, rightWidth]);

  return (
    <div
      ref={panelRef}
      data-ft-codex-terminal-panel="true"
      style={{
        ...panelSize,
        position: 'relative',
        display: visible ? 'flex' : 'none',
        flexDirection: 'column',
        flexShrink: 0,
        minWidth: 0,
        minHeight: 0,
        zIndex: extendToViewportTop ? 25 : undefined,
        backgroundColor: terminalBackground,
        boxShadow: theme.isDark ? '0 -12px 32px rgba(0,0,0,0.26)' : '0 -12px 28px rgba(0,0,0,0.08)',
        ...(extendToViewportTop ? ({ WebkitAppRegion: 'no-drag' } as CSSProperties) : {}),
      }}
    >
      <div
        onMouseDown={startResize}
        title={dockSide === 'bottom' ? 'Resize terminal height' : 'Resize terminal width'}
        style={{
          position: 'absolute',
          top: dockSide === 'bottom' ? '-5px' : 0,
          left: dockSide === 'right' ? '-5px' : 0,
          width: dockSide === 'right' ? '9px' : '100%',
          height: dockSide === 'bottom' ? '9px' : '100%',
          cursor: dockSide === 'bottom' ? 'row-resize' : 'col-resize',
          zIndex: 4,
          background: isResizing
            ? (theme.isDark ? 'rgba(16,185,129,0.18)' : 'rgba(16,185,129,0.14)')
            : 'transparent',
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: dockSide === 'bottom' ? 0 : undefined,
          left: dockSide === 'right' ? 0 : undefined,
          width: dockSide === 'right' ? `${TERMINAL_DOCK_DIVIDER_SIZE}px` : '100%',
          height: dockSide === 'bottom' ? `${TERMINAL_DOCK_DIVIDER_SIZE}px` : '100%',
          backgroundColor: isResizing ? '#10b981' : terminalSoftBorder,
          pointerEvents: 'none',
          zIndex: 6,
        }}
      />
      <div
        style={{
          height: `${36 + toolbarTopInset}px`,
          display: 'flex',
          alignItems: 'center',
          gap: '7px',
          padding: '0 10px',
          borderBottom: `1px solid ${terminalSoftBorder}`,
          backgroundColor: terminalChrome,
          flexShrink: 0,
          overflowX: 'auto',
          overflowY: 'hidden',
          position: 'relative',
          zIndex: 5,
          ...(extendToViewportTop ? ({ WebkitAppRegion: 'no-drag' } as CSSProperties) : {}),
        }}
      >
        <button
          type="button"
          aria-label={historyOpen ? 'Close Codex history' : 'Open Codex history'}
          onClick={() => {
            setHistoryOpen((current) => !current);
            window.setTimeout(updateHistoryOverlayRect, 0);
          }}
          title={historyOpen ? 'Close Codex history' : 'Open Codex history'}
          style={{
            ...toolbarButtonStyle(theme),
            width: '26px',
            padding: 0,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: historyOpen ? theme.text : theme.textSecondary,
            backgroundColor: historyOpen ? (theme.isDark ? '#202833' : 'rgba(16,185,129,0.12)') : 'transparent',
            flexShrink: 0,
            ...(toolbarItemOffset ?? {}),
          }}
        >
          <ClockIcon size={13} />
        </button>
        {visibleSessions.map((session) => {
          const active = session.id === activeSession?.id;
          return (
            <div
              key={session.id}
              style={{
                height: '24px',
                maxWidth: '168px',
                display: 'inline-flex',
                alignItems: 'center',
                overflow: 'hidden',
                borderRadius: '6px',
                border: `1px solid ${active ? (theme.isDark ? '#2f5f4b' : 'rgba(16,185,129,0.42)') : terminalSoftBorder}`,
                backgroundColor: active
                  ? (theme.isDark ? '#202833' : 'rgba(16,185,129,0.12)')
                  : (theme.isDark ? '#171b22' : 'transparent'),
                color: active ? theme.text : theme.textSecondary,
                flexShrink: 0,
                ...(toolbarItemOffset ?? {}),
              }}
              title={`${session.title} — ${session.cwd}`}
            >
              <button
                type="button"
                onClick={() => {
                  setActiveSessionId(session.id);
                  window.setTimeout(() => terminalHandlesRef.current.get(session.id)?.term.focus(), 30);
                }}
                style={{
                  height: '100%',
                  minWidth: 0,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '0 7px',
                  border: 0,
                  backgroundColor: 'transparent',
                  color: 'inherit',
                  cursor: 'pointer',
                  fontSize: '11px',
                  fontWeight: 600,
                  overflow: 'hidden',
                }}
              >
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: session.exitedAt ? '#6b7280' : '#10b981', flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{session.title}</span>
                <span style={{ color: theme.textSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pathBasename(session.cwd)}</span>
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  void closeSession(session.id);
                }}
                title={visibleSessions.length === 1 ? 'Close terminal' : 'Close session'}
                style={{
                  width: '14px',
                  height: '14px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginRight: '5px',
                  padding: 0,
                  border: 0,
                  borderRadius: '4px',
                  backgroundColor: 'transparent',
                  color: terminalMutedText,
                  cursor: 'pointer',
                  fontSize: '12px',
                  lineHeight: 1,
                  flexShrink: 0,
                }}
              >
                ×
              </button>
            </div>
          );
        })}
        <button type="button" onClick={() => void createSession()} title="New Codex terminal (⌘T)" style={{ ...toolbarButtonStyle(theme), flexShrink: 0, ...(toolbarItemOffset ?? {}) }}>
          +
        </button>
        {activeCwd && (
          <span
            title={activeCwd}
            style={{
              minWidth: dockSide === 'right' ? '64px' : '120px',
              maxWidth: dockSide === 'right' ? '180px' : '360px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: terminalMutedText,
              fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              fontSize: '11px',
              fontWeight: 400,
              flexShrink: 1,
              ...(toolbarItemOffset ?? {}),
            }}
          >
            {activeCwdLabel}
          </span>
        )}
        <div style={{ flex: 1, minWidth: '12px' }} />
        {terminalStatus && <span style={{ color: theme.textSecondary, fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', ...(toolbarItemOffset ?? {}) }}>{terminalStatus}</span>}
        {activeSession && (activeSession.exitedAt || activeSession.restored) && (
          <button type="button" onClick={() => void restartSession(activeSession)} title="Restart active Codex terminal" style={{ ...toolbarButtonStyle(theme), ...(toolbarItemOffset ?? {}) }}>
            Restart
          </button>
        )}
        <button
          type="button"
          aria-label={dockSide === 'bottom' ? 'Dock terminal right' : 'Dock terminal bottom'}
          onClick={() => updateDockSide(dockSide === 'bottom' ? 'right' : 'bottom')}
          title={dockSide === 'bottom' ? 'Dock terminal right' : 'Dock terminal bottom'}
          style={{ ...toolbarButtonStyle(theme), width: '34px', padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', ...(toolbarItemOffset ?? {}) }}
        >
          <DockSideIcon side={dockSide === 'bottom' ? 'right' : 'bottom'} />
        </button>
        <button type="button" onClick={() => onVisibleChange(false)} title="Close terminal panel" style={{ ...toolbarButtonStyle(theme), ...(toolbarItemOffset ?? {}) }}>
          Close
        </button>
      </div>
      {historyOpen && historyOverlayRect && (
        <div
          data-ft-codex-history-overlay="true"
          style={{
            ...historyOverlayRect,
            zIndex: 30,
            display: 'flex',
            flexDirection: 'column',
            borderLeft: `1px solid ${terminalSoftBorder}`,
            borderTop: `1px solid ${terminalSoftBorder}`,
            borderBottom: `1px solid ${terminalSoftBorder}`,
            backgroundColor: terminalChrome,
            boxShadow: theme.isDark ? '-18px 0 38px rgba(0,0,0,0.34)' : '-18px 0 34px rgba(0,0,0,0.12)',
            ...(extendToViewportTop ? ({ WebkitAppRegion: 'no-drag' } as CSSProperties) : {}),
          }}
        >
          <div style={{ height: `${36 + toolbarTopInset}px`, display: 'flex', alignItems: 'center', gap: '8px', padding: '0 10px', borderBottom: `1px solid ${terminalSoftBorder}`, flexShrink: 0 }}>
            <ClockIcon />
            <input
              value={historyQuery}
              onChange={(event) => setHistoryQuery(event.currentTarget.value)}
              placeholder="Search Codex history"
              style={{
                minWidth: 0,
                flex: 1,
                height: '24px',
                border: `1px solid ${terminalSoftBorder}`,
                borderRadius: '5px',
                padding: '0 8px',
                backgroundColor: terminalBackground,
                color: theme.text,
                fontSize: '11px',
                outline: 'none',
              }}
            />
            <button type="button" onClick={() => setHistoryOpen(false)} title="Close Codex history" style={{ ...toolbarButtonStyle(theme), width: '24px', padding: 0 }}>
              ×
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '160px minmax(0, 1fr)', minHeight: 0, flex: 1 }}>
            <div style={{ minHeight: 0, overflowY: 'auto', borderRight: `1px solid ${terminalSoftBorder}`, backgroundColor: theme.isDark ? '#12151a' : '#e8dfd1' }}>
              {historyLoading && <div style={{ padding: '10px', color: terminalMutedText, fontSize: '11px' }}>Loading...</div>}
              {!historyLoading && historyEntries.length === 0 && <div style={{ padding: '10px', color: terminalMutedText, fontSize: '11px' }}>No threads found</div>}
              {historyEntries.map((entry) => {
                const active = historyPreview?.filePath === entry.filePath;
                return (
                  <div
                    key={entry.filePath}
                    title={entry.filePath}
                    style={{
                      width: '100%',
                      display: 'grid',
                      gridTemplateColumns: 'minmax(0, 1fr) 24px',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '7px 7px 7px 9px',
                      borderBottom: `1px solid ${terminalSoftBorder}`,
                      backgroundColor: active ? (theme.isDark ? '#202833' : 'rgba(16,185,129,0.12)') : 'transparent',
                      color: active ? theme.text : theme.textSecondary,
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => void readHistoryPreview(entry)}
                      style={{
                        minWidth: 0,
                        padding: 0,
                        border: 0,
                        backgroundColor: 'transparent',
                        color: 'inherit',
                        textAlign: 'left',
                        cursor: 'pointer',
                      }}
                    >
                      <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '11px', fontWeight: 600 }}>{entry.title || entry.fileName}</span>
                      <span style={{ display: 'block', marginTop: '3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: terminalMutedText, fontSize: '10px' }}>{formatHistoryDate(entry.startedAt ?? entry.updatedAt)}</span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Resume ${entry.title || entry.fileName}`}
                      onClick={() => void resumeHistoryEntry(entry)}
                      title="Resume thread"
                      style={{
                        width: '22px',
                        height: '22px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: 0,
                        border: `1px solid ${terminalSoftBorder}`,
                        borderRadius: '5px',
                        backgroundColor: theme.isDark ? '#171b22' : '#f0eadf',
                        color: theme.textSecondary,
                        cursor: 'pointer',
                      }}
                    >
                      <PlayIcon />
                    </button>
                  </div>
                );
              })}
            </div>
            <div style={{ minHeight: 0, overflowY: 'auto', padding: '12px', backgroundColor: terminalBackground, color: theme.text }}>
              {historyError && <div style={{ color: '#ef4444', fontSize: '11px' }}>{historyError}</div>}
              {!historyError && historyPreview && (
                <>
                  <div style={{ marginBottom: '8px', color: theme.text, fontSize: '12px', fontWeight: 700 }}>{historyPreview.title || 'Codex thread'}</div>
                  <div style={{ marginBottom: '10px', color: terminalMutedText, fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: '10px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{formatTerminalCwdLabel(historyPreview.cwd ?? '')}</div>
                  <pre style={{ margin: 0, whiteSpace: 'pre-wrap', color: theme.text, fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: '11px', lineHeight: 1.45 }}>{historyPreview.preview || 'No readable preview available.'}</pre>
                </>
              )}
            </div>
          </div>
        </div>
      )}
      <div style={{ position: 'relative', flex: 1, minHeight: 0, minWidth: 0, backgroundColor: terminalBackground }}>
        <style>
          {terminalViewportStyleCss(terminalBackground)}
        </style>
        {sessions.map((session) => (
          <div
            key={session.id}
            className="codex-terminal-host"
            ref={(element) => setTerminalHost(session.id, element)}
            style={{
              position: 'absolute',
              top: `${TERMINAL_GUTTER_TOP}px`,
              right: `${TERMINAL_GUTTER_RIGHT}px`,
              bottom: `${TERMINAL_GUTTER_BOTTOM}px`,
              left: `${TERMINAL_GUTTER_LEFT}px`,
              display: session.id === activeSession?.id ? 'block' : 'none',
            }}
          />
        ))}
      </div>
    </div>
  );
}

function formatHistoryDate(input: string): string {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return input;
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function ClockIcon({ size = 15 }: { size?: number }) {
  const handScale = size / 15;
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-flex',
        width: `${size}px`,
        height: `${size}px`,
        alignItems: 'center',
        justifyContent: 'center',
        border: '1.5px solid currentColor',
        borderRadius: '50%',
        position: 'relative',
        flexShrink: 0,
      }}
    >
      <span style={{ position: 'absolute', width: `${1.5 * handScale}px`, height: `${4.5 * handScale}px`, top: `${3 * handScale}px`, backgroundColor: 'currentColor', borderRadius: '999px' }} />
      <span style={{ position: 'absolute', width: `${4.5 * handScale}px`, height: `${1.5 * handScale}px`, left: `${7 * handScale}px`, top: `${7 * handScale}px`, backgroundColor: 'currentColor', borderRadius: '999px' }} />
    </span>
  );
}

function PlayIcon() {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-block',
        width: 0,
        height: 0,
        borderTop: '5px solid transparent',
        borderBottom: '5px solid transparent',
        borderLeft: '8px solid currentColor',
        marginLeft: '2px',
      }}
    />
  );
}

function DockSideIcon({ side }: { side: CodexTerminalDockSide }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-block',
        width: '16px',
        color: 'currentColor',
        fontFamily: 'SF Pro Text, -apple-system, BlinkMacSystemFont, sans-serif',
        fontSize: side === 'bottom' ? '19px' : '18px',
        fontWeight: 400,
        lineHeight: 1,
        textAlign: 'center',
      }}
    >
      {side === 'bottom' ? '▁' : '▌'}
    </span>
  );
}

function toolbarButtonStyle(theme: Theme): CSSProperties {
  const borderColor = theme.isDark ? theme.border : '#cbbfad';
  return {
    height: '24px',
    padding: '0 8px',
    border: `1px solid ${borderColor}`,
    borderRadius: '5px',
    backgroundColor: 'transparent',
    color: theme.textSecondary,
    cursor: 'pointer',
    fontSize: '11px',
    fontWeight: 400,
    letterSpacing: 0,
  };
}
