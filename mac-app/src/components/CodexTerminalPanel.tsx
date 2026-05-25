import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
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
  onDockSideChange?: (dockSide: CodexTerminalDockSide) => void;
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
const TERMINAL_SCROLLBAR_LANE = 14;
const LIVE_CONTEXT_UPDATE_DELAY_MS = 700;

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
  }
  if (event.altKey && !event.metaKey) {
    if (event.key === 'ArrowLeft') return '\x1bb';
    if (event.key === 'ArrowRight') return '\x1bf';
  }
  return null;
}

function pathBasename(input: string): string {
  const parts = input.split('/').filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : input;
}

function terminalTheme(isDark: boolean): ITerminalOptions['theme'] {
  return {
    background: isDark ? '#101113' : '#fbf9f4',
    foreground: isDark ? '#e8e3d8' : '#1f2328',
    cursor: '#10b981',
    selectionBackground: isDark ? '#2f4a43' : '#cfe9df',
    black: '#111315',
    red: '#ef4444',
    green: '#10b981',
    yellow: '#f59e0b',
    blue: '#60a5fa',
    magenta: '#a78bfa',
    cyan: '#22d3ee',
    white: '#e8e3d8',
    brightBlack: '#6b7280',
    brightWhite: '#ffffff',
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

export default function CodexTerminalPanel({ visible, pageContext, onDockSideChange, onVisibleChange }: CodexTerminalPanelProps) {
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
  const [editingTitle, setEditingTitle] = useState('');
  const [terminalStatus, setTerminalStatus] = useState<string | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const terminalHandlesRef = useRef(new Map<string, TerminalHandle>());
  const pendingDataRef = useRef(new Map<string, string[]>());
  const autoAttachedContextRef = useRef(new Set<string>());
  const liveContextUpdateRef = useRef<number | null>(null);

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

  const fitActiveTerminal = useCallback(() => {
    if (!activeSessionId) return;
    const handle = terminalHandlesRef.current.get(activeSessionId);
    if (!handle) return;
    try {
      handle.fit.fit();
      void window.codexTerminalAPI?.resize(activeSessionId, handle.term.cols, handle.term.rows);
    } catch {
      // Resize can race while the panel is hidden or changing dock sides.
    }
  }, [activeSessionId]);

  const focusActiveTerminal = useCallback(() => {
    if (!activeSessionId) return;
    const handle = terminalHandlesRef.current.get(activeSessionId);
    handle?.term.focus();
  }, [activeSessionId]);

  const createSession = useCallback(async (input?: { cwd?: string; title?: string; auto?: boolean }) => {
    const session = await window.codexTerminalAPI?.create({
      title: input?.title ?? `Codex ${sessions.length + 1}`,
      cwd: input?.cwd,
      auto: input?.auto,
    });
    if (!session) return;
    setSessions((current) => mergeCodexTerminalSessions(current, [session]));
    setActiveSessionId(session.id);
    window.setTimeout(() => terminalHandlesRef.current.get(session.id)?.term.focus(), 80);
  }, [sessions.length]);

  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

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

  useEffect(() => {
    setEditingTitle(activeSession?.title ?? '');
  }, [activeSession?.id, activeSession?.title]);

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
    for (const handle of terminalHandlesRef.current.values()) {
      handle.term.options.theme = terminalTheme(theme.isDark);
    }
  }, [theme.isDark]);

  useEffect(() => {
    const timer = window.setTimeout(fitActiveTerminal, 60);
    return () => window.clearTimeout(timer);
  }, [dockSide, fitActiveTerminal, visible]);

  useEffect(() => {
    if (!visible) return;
    const timer = window.setTimeout(() => {
      fitActiveTerminal();
      focusActiveTerminal();
    }, 80);
    return () => window.clearTimeout(timer);
  }, [activeSessionId, fitActiveTerminal, focusActiveTerminal, visible]);

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
      theme: terminalTheme(theme.isDark),
    });
    term.loadAddon(fit);
    term.loadAddon(webLinks);
    term.open(element);
    terminalHandlesRef.current.set(sessionId, { term, fit });
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true;
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
      void window.codexTerminalAPI?.resize(sessionId, term.cols, term.rows);
      if (sessionId === activeSessionId) term.focus();
    }, 30);
  }, [activeSessionId, theme.isDark]);

  const closeSession = useCallback(async (sessionId: string) => {
    const remainingSessions = sessions.filter((session) => session.id !== sessionId);
    await window.codexTerminalAPI?.kill(sessionId);
    const handle = terminalHandlesRef.current.get(sessionId);
    handle?.term.dispose();
    terminalHandlesRef.current.delete(sessionId);
    pendingDataRef.current.delete(sessionId);
    if (remainingSessions.length === 0) {
      setActiveSessionId(null);
      onVisibleChange(false);
    } else if (activeSessionId === sessionId) {
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

  const renameActiveSession = useCallback(async () => {
    if (!activeSession) return;
    const nextTitle = editingTitle.trim();
    if (!nextTitle || nextTitle === activeSession.title) return;
    const didRename = await window.codexTerminalAPI?.rename(activeSession.id, nextTitle);
    if (didRename) await refreshSessions();
  }, [activeSession, editingTitle, refreshSessions]);

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
    : { height: '100%', width: `${rightWidth}px`, minWidth: `${MIN_RIGHT_WIDTH}px` };
  const activeCwd = activeSession?.cwd ?? '';
  const terminalBackground = theme.isDark ? '#101113' : '#fbf9f4';
  const terminalChrome = theme.isDark ? '#15181e' : '#f5f4f2';
  const terminalBorder = theme.isDark ? '#2a2d35' : '#e3e0db';
  const terminalSoftBorder = theme.isDark ? '#242832' : '#e3e0db';
  const terminalMutedText = theme.isDark ? '#8a8f99' : '#6b6b6b';

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
      style={{
        ...panelSize,
        position: 'relative',
        display: visible ? 'flex' : 'none',
        flexDirection: 'column',
        flexShrink: 0,
        minWidth: 0,
        minHeight: 0,
        backgroundColor: terminalBackground,
        borderTop: dockSide === 'bottom' ? `1px solid ${terminalBorder}` : undefined,
        borderLeft: dockSide === 'right' ? `1px solid ${terminalBorder}` : undefined,
        boxShadow: theme.isDark ? '0 -12px 32px rgba(0,0,0,0.26)' : '0 -12px 28px rgba(0,0,0,0.08)',
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
          width: dockSide === 'right' ? '1px' : '100%',
          height: dockSide === 'bottom' ? '1px' : '100%',
          backgroundColor: isResizing ? '#10b981' : terminalSoftBorder,
          pointerEvents: 'none',
          zIndex: 3,
        }}
      />
      <div
        style={{
          height: '36px',
          display: 'flex',
          alignItems: 'center',
          gap: '7px',
          padding: '0 10px',
          borderBottom: `1px solid ${terminalSoftBorder}`,
          backgroundColor: terminalChrome,
          flexShrink: 0,
          overflowX: 'auto',
          overflowY: 'hidden',
        }}
      >
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
                title="Close session"
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
        <button type="button" onClick={() => void createSession()} title="New Codex terminal (⌘T)" style={{ ...toolbarButtonStyle(theme), flexShrink: 0 }}>
          +
        </button>
        {activeSession && (
          <input
            value={editingTitle}
            onChange={(event) => setEditingTitle(event.target.value)}
            onBlur={() => void renameActiveSession()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
              if (event.key === 'Escape') setEditingTitle(activeSession.title);
            }}
            title="Rename active Codex terminal"
            style={{
              width: dockSide === 'right' ? '92px' : '140px',
              height: '24px',
              flexShrink: 0,
              border: `1px solid ${terminalSoftBorder}`,
              borderRadius: '6px',
              backgroundColor: theme.isDark ? '#171b22' : 'rgba(0,0,0,0.035)',
              color: theme.text,
              fontSize: '11px',
              fontWeight: 600,
              padding: '0 7px',
              outline: 'none',
            }}
          />
        )}
        <div style={{ flex: 1, minWidth: '12px' }} />
        {terminalStatus && <span style={{ color: theme.textSecondary, fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{terminalStatus}</span>}
        {activeSession && (activeSession.exitedAt || activeSession.restored) && (
          <button type="button" onClick={() => void restartSession(activeSession)} title="Restart active Codex terminal" style={toolbarButtonStyle(theme)}>
            Restart
          </button>
        )}
        <button
          type="button"
          aria-label={dockSide === 'bottom' ? 'Dock terminal right' : 'Dock terminal bottom'}
          onClick={() => updateDockSide(dockSide === 'bottom' ? 'right' : 'bottom')}
          title={dockSide === 'bottom' ? 'Dock terminal right' : 'Dock terminal bottom'}
          style={toolbarButtonStyle(theme)}
        >
          {dockSide === 'bottom' ? '▐' : '▁'}
        </button>
        <button type="button" onClick={() => onVisibleChange(false)} title="Hide terminal panel" style={toolbarButtonStyle(theme)}>
          Hide
        </button>
      </div>
      <div
        style={{
          height: '32px',
          display: 'flex',
          alignItems: 'center',
          gap: '9px',
          padding: '0 12px',
          borderBottom: `1px solid ${terminalSoftBorder}`,
          backgroundColor: terminalChrome,
          color: terminalMutedText,
          flexShrink: 0,
          overflow: 'hidden',
          fontSize: '11px',
          fontWeight: 600,
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
          {activeCwd || '~/dev/fieldtheory'}
        </span>
        <div style={{ flex: 1, minWidth: '8px' }} />
      </div>
      <div style={{ position: 'relative', flex: 1, minHeight: 0, minWidth: 0, backgroundColor: terminalBackground }}>
        <style>
          {`.codex-terminal-host .xterm .xterm-viewport { right: -${TERMINAL_SCROLLBAR_LANE}px; scrollbar-gutter: stable; }`}
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

function toolbarButtonStyle(theme: Theme): CSSProperties {
  return {
    height: '24px',
    padding: '0 8px',
    border: `1px solid ${theme.border}`,
    borderRadius: '5px',
    backgroundColor: 'transparent',
    color: theme.textSecondary,
    cursor: 'pointer',
    fontSize: '11px',
    fontWeight: 600,
    letterSpacing: 0,
  };
}
