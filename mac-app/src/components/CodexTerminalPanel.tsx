import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
import { Terminal, type ITerminalOptions } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useTheme, type Theme } from '../contexts/ThemeContext';

type CodexTerminalSessionSummary = Awaited<ReturnType<NonNullable<Window['codexTerminalAPI']>['create']>>;
type CodexTerminalPageContext = Parameters<NonNullable<Window['codexTerminalAPI']>['attachPageContext']>[1];

interface CodexTerminalPanelProps {
  visible: boolean;
  pageContext: CodexTerminalPageContext | null;
  onVisibleChange: (visible: boolean) => void;
}

type DockSide = 'bottom' | 'right';
const CODEX_TERMINAL_DOCK_STORAGE_KEY = 'fieldtheory.codexTerminal.dockSide';
const CODEX_TERMINAL_ACTIVE_SESSION_STORAGE_KEY = 'fieldtheory.codexTerminal.activeSessionId';
const CODEX_TERMINAL_BOTTOM_SIZE_STORAGE_KEY = 'fieldtheory.codexTerminal.bottomHeight';
const CODEX_TERMINAL_RIGHT_SIZE_STORAGE_KEY = 'fieldtheory.codexTerminal.rightWidth';
const CODEX_TERMINAL_VISIBLE_STORAGE_KEY = 'fieldtheory.codexTerminal.visible';
const CODEX_TERMINAL_NEW_CWD_STORAGE_KEY = 'fieldtheory.codexTerminal.newSessionCwd';
const CODEX_TERMINAL_CWD_HISTORY_STORAGE_KEY = 'fieldtheory.codexTerminal.cwdHistory';
const MIN_BOTTOM_HEIGHT = 220;
const MIN_RIGHT_WIDTH = 360;
const MAX_BOTTOM_HEIGHT_RATIO = 0.72;
const MAX_RIGHT_WIDTH_RATIO = 0.68;
const MAX_CWD_HISTORY = 12;

interface TerminalHandle {
  term: Terminal;
  fit: FitAddon;
}

interface NativeGhosttyFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

type NativeGhosttyMode = 'checking' | 'available' | 'unavailable';
type NativeGhosttyKeyInput = Parameters<NonNullable<Window['codexTerminalAPI']>['nativeGhosttySendKey']>[0];

const MAC_KEY_CODES: Record<string, number> = {
  KeyA: 0x00,
  KeyS: 0x01,
  KeyD: 0x02,
  KeyF: 0x03,
  KeyH: 0x04,
  KeyG: 0x05,
  KeyZ: 0x06,
  KeyX: 0x07,
  KeyC: 0x08,
  KeyV: 0x09,
  KeyB: 0x0B,
  KeyQ: 0x0C,
  KeyW: 0x0D,
  KeyE: 0x0E,
  KeyR: 0x0F,
  KeyY: 0x10,
  KeyT: 0x11,
  Digit1: 0x12,
  Digit2: 0x13,
  Digit3: 0x14,
  Digit4: 0x15,
  Digit6: 0x16,
  Digit5: 0x17,
  Equal: 0x18,
  Digit9: 0x19,
  Digit7: 0x1A,
  Minus: 0x1B,
  Digit8: 0x1C,
  Digit0: 0x1D,
  BracketRight: 0x1E,
  KeyO: 0x1F,
  KeyU: 0x20,
  BracketLeft: 0x21,
  KeyI: 0x22,
  KeyP: 0x23,
  Enter: 0x24,
  KeyL: 0x25,
  KeyJ: 0x26,
  Quote: 0x27,
  KeyK: 0x28,
  Semicolon: 0x29,
  Backslash: 0x2A,
  Comma: 0x2B,
  Slash: 0x2C,
  KeyN: 0x2D,
  KeyM: 0x2E,
  Period: 0x2F,
  Tab: 0x30,
  Space: 0x31,
  Backquote: 0x32,
  Backspace: 0x33,
  Escape: 0x35,
  NumpadDecimal: 0x41,
  NumpadMultiply: 0x43,
  NumpadAdd: 0x45,
  NumLock: 0x47,
  NumpadDivide: 0x4B,
  NumpadEnter: 0x4C,
  NumpadSubtract: 0x4E,
  NumpadEqual: 0x51,
  Numpad0: 0x52,
  Numpad1: 0x53,
  Numpad2: 0x54,
  Numpad3: 0x55,
  Numpad4: 0x56,
  Numpad5: 0x57,
  Numpad6: 0x58,
  Numpad7: 0x59,
  Numpad8: 0x5B,
  Numpad9: 0x5C,
  F5: 0x60,
  F6: 0x61,
  F7: 0x62,
  F3: 0x63,
  F8: 0x64,
  F9: 0x65,
  F11: 0x67,
  F13: 0x69,
  F16: 0x6A,
  F14: 0x6B,
  F10: 0x6D,
  F12: 0x6F,
  F15: 0x71,
  Help: 0x72,
  Home: 0x73,
  PageUp: 0x74,
  Delete: 0x75,
  F4: 0x76,
  End: 0x77,
  F2: 0x78,
  PageDown: 0x79,
  F1: 0x7A,
  ArrowLeft: 0x7B,
  ArrowRight: 0x7C,
  ArrowDown: 0x7D,
  ArrowUp: 0x7E,
};

export function mergeCodexTerminalSessions(
  current: CodexTerminalSessionSummary[],
  incoming: CodexTerminalSessionSummary[],
): CodexTerminalSessionSummary[] {
  const byId = new Map(current.map((session) => [session.id, session]));
  for (const session of incoming) byId.set(session.id, session);
  return Array.from(byId.values());
}

export function mergeCodexTerminalCwdHistory(current: string[], incoming: string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const cwd of [...incoming, ...current]) {
    const trimmed = cwd.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    merged.push(trimmed);
    if (merged.length >= MAX_CWD_HISTORY) break;
  }
  return merged;
}

export function rectToNativeGhosttyFrame(
  rect: Pick<DOMRect, 'left' | 'bottom' | 'width' | 'height'>,
  viewportHeight: number,
): NativeGhosttyFrame {
  return {
    x: Math.round(rect.left),
    y: Math.round(viewportHeight - rect.bottom),
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height)),
  };
}

export function nativeGhosttyKeyInputForEvent(
  id: string,
  event: Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'altKey' | 'ctrlKey' | 'shiftKey' | 'repeat' | 'getModifierState'>,
  action: 'press' | 'release' = 'press',
): NativeGhosttyKeyInput | null {
  if (event.metaKey) return null;
  const keyCode = MAC_KEY_CODES[event.code];
  if (keyCode === undefined && event.key.length !== 1) return null;
  const text = event.key.length === 1 ? event.key : '';
  const unshifted = text.length === 1 ? text.toLowerCase().codePointAt(0) ?? 0 : 0;
  return {
    id,
    action: action === 'press' && event.repeat ? 'repeat' : action,
    keyCode: keyCode ?? 0,
    text,
    unshiftedCodepoint: unshifted,
    shift: event.shiftKey,
    ctrl: event.ctrlKey,
    alt: event.altKey,
    meta: event.metaKey,
    caps: event.getModifierState('CapsLock'),
  };
}

function readStoredStringList(key: string): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function pathBasename(input: string): string {
  const parts = input.split('/').filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : input;
}

function terminalTheme(isDark: boolean): ITerminalOptions['theme'] {
  return {
    background: isDark ? '#101113' : '#f7f5f0',
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

export default function CodexTerminalPanel({ visible, pageContext, onVisibleChange }: CodexTerminalPanelProps) {
  const { theme } = useTheme();
  const [dockSide, setDockSide] = useState<DockSide>(() => (
    localStorage.getItem(CODEX_TERMINAL_DOCK_STORAGE_KEY) === 'right' ? 'right' : 'bottom'
  ));
  const [sessions, setSessions] = useState<CodexTerminalSessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(() => (
    localStorage.getItem(CODEX_TERMINAL_ACTIVE_SESSION_STORAGE_KEY) || null
  ));
  const [bottomHeight, setBottomHeight] = useState(() => readStoredNumber(CODEX_TERMINAL_BOTTOM_SIZE_STORAGE_KEY, 300));
  const [rightWidth, setRightWidth] = useState(() => readStoredNumber(CODEX_TERMINAL_RIGHT_SIZE_STORAGE_KEY, 460));
  const [newSessionCwd, setNewSessionCwd] = useState(() => localStorage.getItem(CODEX_TERMINAL_NEW_CWD_STORAGE_KEY) ?? '');
  const [cwdHistory, setCwdHistory] = useState(() => readStoredStringList(CODEX_TERMINAL_CWD_HISTORY_STORAGE_KEY));
  const [editingTitle, setEditingTitle] = useState('');
  const [attachStatus, setAttachStatus] = useState<string | null>(null);
  const [nativeGhosttyMode, setNativeGhosttyMode] = useState<NativeGhosttyMode>('checking');
  const [nativeGhosttyError, setNativeGhosttyError] = useState<string | null>(null);
  const [nativeSessions, setNativeSessions] = useState<CodexTerminalSessionSummary[]>([]);
  const [nativeReplayText, setNativeReplayText] = useState('');
  const panelRef = useRef<HTMLDivElement | null>(null);
  const terminalViewportRef = useRef<HTMLDivElement | null>(null);
  const nativeInputRef = useRef<HTMLDivElement | null>(null);
  const terminalHandlesRef = useRef(new Map<string, TerminalHandle>());
  const pendingDataRef = useRef(new Map<string, string[]>());
  const nativeGhosttyAttachedRef = useRef(new Set<string>());

  const usingNativeGhostty = nativeGhosttyMode === 'available';
  const activeSession = useMemo(
    () => {
      const list = usingNativeGhostty ? nativeSessions : sessions;
      return list.find((session) => session.id === activeSessionId) ?? list[0] ?? null;
    },
    [activeSessionId, nativeSessions, sessions, usingNativeGhostty],
  );
  const visibleSessions = usingNativeGhostty ? nativeSessions : sessions;

  const refreshSessions = useCallback(async () => {
    const next = await window.codexTerminalAPI?.list();
    if (!next) return;
    const nextPtySessions = next.filter((session) => session.engine !== 'nativeGhostty');
    const nextNativeSessions = next.filter((session) => session.engine === 'nativeGhostty');
    const preferredSessions = nativeGhosttyMode === 'available' ? nextNativeSessions : nextPtySessions;
    setSessions(nextPtySessions);
    setNativeSessions(nextNativeSessions);
    setCwdHistory((current) => mergeCodexTerminalCwdHistory(current, next.map((session) => session.cwd)));
    setActiveSessionId((current) => current && preferredSessions.some((session) => session.id === current)
      ? current
      : preferredSessions[0]?.id ?? null);
  }, [nativeGhosttyMode]);

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

  const createSession = useCallback(async (input?: { cwd?: string; title?: string }) => {
    const cwd = input?.cwd ?? (newSessionCwd.trim() || undefined);
    if (nativeGhosttyMode === 'available') {
      const session = await window.codexTerminalAPI?.create({
        title: input?.title ?? `Codex ${nativeSessions.length + 1}`,
        cwd: cwd ?? activeSession?.cwd,
        nativeGhostty: true,
      });
      if (!session) return;
      setNativeSessions((current) => mergeCodexTerminalSessions(current, [session]));
      setCwdHistory((current) => mergeCodexTerminalCwdHistory(current, [session.cwd]));
      setActiveSessionId(session.id);
      return;
    }
    const session = await window.codexTerminalAPI?.create({
      title: input?.title ?? `Codex ${sessions.length + 1}`,
      cwd,
    });
    if (!session) return;
    setSessions((current) => mergeCodexTerminalSessions(current, [session]));
    setCwdHistory((current) => mergeCodexTerminalCwdHistory(current, [session.cwd]));
    setActiveSessionId(session.id);
  }, [activeSession?.cwd, nativeGhosttyMode, nativeSessions.length, newSessionCwd, sessions.length]);

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
    localStorage.setItem(CODEX_TERMINAL_NEW_CWD_STORAGE_KEY, newSessionCwd);
  }, [newSessionCwd]);

  useEffect(() => {
    localStorage.setItem(CODEX_TERMINAL_CWD_HISTORY_STORAGE_KEY, JSON.stringify(cwdHistory));
  }, [cwdHistory]);

  useEffect(() => {
    setEditingTitle(activeSession?.title ?? '');
  }, [activeSession?.id, activeSession?.title]);

  useEffect(() => {
    if (!usingNativeGhostty || !activeSession?.restored) {
      setNativeReplayText('');
      return;
    }
    let cancelled = false;
    void window.codexTerminalAPI?.getBuffer(activeSession.id).then((buffer) => {
      if (!cancelled) setNativeReplayText(buffer ?? '');
    });
    return () => {
      cancelled = true;
    };
  }, [activeSession?.id, activeSession?.restored, usingNativeGhostty]);

  useEffect(() => {
    if (visible && nativeGhosttyMode === 'available' && nativeSessions.length === 0) {
      void createSession();
      return;
    }
    if (visible && nativeGhosttyMode === 'unavailable' && sessions.length === 0) {
      void createSession();
    }
  }, [createSession, nativeGhosttyMode, nativeSessions.length, sessions.length, visible]);

  useEffect(() => {
    let cancelled = false;
    void window.codexTerminalAPI?.nativeGhosttyHostStatus().then((status) => {
      if (cancelled) return;
      setNativeGhosttyMode(status?.ok ? 'available' : 'unavailable');
      setNativeGhosttyError(status?.ok ? null : status?.error ?? 'Ghostty native host bridge is unavailable.');
    });
    return () => {
      cancelled = true;
    };
  }, []);

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
      const nextPtySessions = nextSessions.filter((session) => session.engine !== 'nativeGhostty');
      const nextNativeSessions = nextSessions.filter((session) => session.engine === 'nativeGhostty');
      const preferredSessions = nativeGhosttyMode === 'available' ? nextNativeSessions : nextPtySessions;
      setSessions(nextPtySessions);
      setNativeSessions(nextNativeSessions);
      setCwdHistory((current) => mergeCodexTerminalCwdHistory(current, nextSessions.map((session) => session.cwd)));
      setActiveSessionId((current) => current && preferredSessions.some((session) => session.id === current)
        ? current
        : preferredSessions[0]?.id ?? null);
    });
    return () => {
      offData?.();
      offExit?.();
      offSessionsChanged?.();
    };
  }, [nativeGhosttyMode]);

  useEffect(() => {
    const handleResize = () => fitActiveTerminal();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [fitActiveTerminal]);

  useEffect(() => {
    const timer = window.setTimeout(fitActiveTerminal, 60);
    return () => window.clearTimeout(timer);
  }, [dockSide, fitActiveTerminal, visible]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!visible || !event.metaKey || event.key.toLowerCase() !== 't') return;
      event.preventDefault();
      void createSession();
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [createSession, usingNativeGhostty, visible]);

  const setTerminalHost = useCallback((sessionId: string, element: HTMLDivElement | null) => {
    if (nativeGhosttyMode === 'available' || !element || terminalHandlesRef.current.has(sessionId)) return;
    const fit = new FitAddon();
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
    term.open(element);
    terminalHandlesRef.current.set(sessionId, { term, fit });
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
    }, 30);
  }, [nativeGhosttyMode, theme.isDark]);

  const currentNativeGhosttyFrame = useCallback((): NativeGhosttyFrame | null => {
    const element = terminalViewportRef.current;
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 20) return null;
    return rectToNativeGhosttyFrame(rect, window.innerHeight);
  }, []);

  const updateNativeGhosttyFrame = useCallback(async () => {
    if (!activeSessionId || !nativeGhosttyAttachedRef.current.has(activeSessionId)) return;
    const frame = currentNativeGhosttyFrame();
    if (!frame) return;
    await window.codexTerminalAPI?.nativeGhosttyUpdateFrame({ id: activeSessionId, ...frame });
  }, [activeSessionId, currentNativeGhosttyFrame]);

  const snapshotNativeGhostty = useCallback((sessionId: string) => {
    if (!nativeGhosttyAttachedRef.current.has(sessionId)) return;
    void window.codexTerminalAPI?.nativeGhosttySnapshot(sessionId);
  }, []);

  useEffect(() => {
    if (nativeGhosttyMode !== 'available') return;
    const handleResize = () => void updateNativeGhosttyFrame();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [nativeGhosttyMode, updateNativeGhosttyFrame]);

  useEffect(() => {
    if (!visible || nativeGhosttyMode !== 'available') {
      for (const id of nativeGhosttyAttachedRef.current) void window.codexTerminalAPI?.nativeGhosttyDetach(id);
      nativeGhosttyAttachedRef.current.clear();
      return;
    }
    if (!activeSession) return;
    if (activeSession.restored || activeSession.exitedAt) return;

    let cancelled = false;
    const attach = () => {
      const frame = currentNativeGhosttyFrame();
      if (!frame) return;
      const cwd = activeSession?.cwd ?? (newSessionCwd.trim() || undefined);
      void window.codexTerminalAPI?.nativeGhosttyAttach({ id: activeSession.id, ...frame, cwd, command: 'codex' }).then((result) => {
        if (cancelled) return;
        if (result?.ok) {
          nativeGhosttyAttachedRef.current.add(activeSession.id);
          nativeInputRef.current?.focus();
        }
        if (!result?.ok) {
          setNativeGhosttyMode('unavailable');
          setNativeGhosttyError(result?.error ?? 'Ghostty native surface did not attach.');
        }
      });
    };

    const frame = window.requestAnimationFrame(attach);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [activeSession, currentNativeGhosttyFrame, nativeGhosttyMode, newSessionCwd, visible]);

  useEffect(() => {
    const timer = window.setTimeout(() => void updateNativeGhosttyFrame(), 30);
    return () => window.clearTimeout(timer);
  }, [bottomHeight, dockSide, rightWidth, updateNativeGhosttyFrame]);

  useEffect(() => () => {
    for (const id of nativeGhosttyAttachedRef.current) void window.codexTerminalAPI?.nativeGhosttyDetach(id);
    nativeGhosttyAttachedRef.current.clear();
  }, []);

  const closeSession = useCallback(async (sessionId: string) => {
    if (usingNativeGhostty) {
      await window.codexTerminalAPI?.nativeGhosttySnapshot(sessionId);
      await window.codexTerminalAPI?.nativeGhosttyDetach(sessionId);
      nativeGhosttyAttachedRef.current.delete(sessionId);
      await window.codexTerminalAPI?.kill(sessionId);
      await refreshSessions();
      return;
    }
    await window.codexTerminalAPI?.kill(sessionId);
    const handle = terminalHandlesRef.current.get(sessionId);
    handle?.term.dispose();
    terminalHandlesRef.current.delete(sessionId);
    pendingDataRef.current.delete(sessionId);
    await refreshSessions();
  }, [refreshSessions, usingNativeGhostty]);

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

  const attachCurrentPage = useCallback(async () => {
    if (!pageContext) return;
    if (!activeSession) return;
    if (activeSession.restored || activeSession.exitedAt) return;
    const result = await window.codexTerminalAPI?.attachPageContext(activeSession.id, pageContext);
    if (!result?.ok) {
      setAttachStatus(result?.error ?? 'Could not attach page context.');
      return;
    }
    if (usingNativeGhostty && result.prompt) {
      const sent = await window.codexTerminalAPI?.nativeGhosttySendText(activeSession.id, result.prompt);
      if (!sent?.ok) {
        setAttachStatus(sent?.error ?? 'Attached page, but could not send context prompt to Ghostty.');
        return;
      }
      window.setTimeout(() => snapshotNativeGhostty(activeSession.id), 1200);
    }
    setAttachStatus(`Attached ${result.filePath}`);
    await refreshSessions();
    window.setTimeout(() => setAttachStatus(null), 3600);
  }, [activeSession, pageContext, refreshSessions, snapshotNativeGhostty, usingNativeGhostty]);

  const handleNativeGhosttyKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!activeSession) return;
    if (activeSession.restored || activeSession.exitedAt) return;
    const input = nativeGhosttyKeyInputForEvent(activeSession.id, event.nativeEvent, 'press');
    if (!input) return;
    event.preventDefault();
    void window.codexTerminalAPI?.nativeGhosttySendKey(input);
    window.setTimeout(() => snapshotNativeGhostty(activeSession.id), 300);
  }, [activeSession, snapshotNativeGhostty]);

  const handleNativeGhosttyKeyUp = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!activeSession) return;
    if (activeSession.restored || activeSession.exitedAt) return;
    const input = nativeGhosttyKeyInputForEvent(activeSession.id, event.nativeEvent, 'release');
    if (!input) return;
    event.preventDefault();
    void window.codexTerminalAPI?.nativeGhosttySendKey(input);
  }, [activeSession]);

  const panelSize: CSSProperties = dockSide === 'bottom'
    ? { height: `${bottomHeight}px`, minHeight: `${MIN_BOTTOM_HEIGHT}px`, width: '100%' }
    : { position: 'absolute', top: 0, right: 0, bottom: 0, width: `${rightWidth}px`, minWidth: `${MIN_RIGHT_WIDTH}px`, zIndex: 18 };
  const attachedContexts = activeSession?.attachedContexts ?? [];
  const activeStatus = usingNativeGhostty
    ? activeSession?.restored ? 'Replaying' : activeSession?.exitedAt ? 'Exited' : activeSession ? 'Ghostty' : 'Idle'
    : activeSession?.restored ? 'Replaying' : activeSession?.exitedAt ? 'Exited' : activeSession ? 'Running' : 'Idle';

  const startResize = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const startBottomHeight = bottomHeight;
    const startRightWidth = rightWidth;
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
      window.setTimeout(fitActiveTerminal, 20);
      window.setTimeout(() => void updateNativeGhosttyFrame(), 20);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [bottomHeight, dockSide, fitActiveTerminal, rightWidth, updateNativeGhosttyFrame]);

  return (
    <div
      ref={panelRef}
      style={{
        ...panelSize,
        display: visible ? 'flex' : 'none',
        flexDirection: 'column',
        flexShrink: 0,
        minWidth: 0,
        minHeight: 0,
        backgroundColor: theme.isDark ? '#101113' : '#f7f5f0',
        borderTop: dockSide === 'bottom' ? `1px solid ${theme.border}` : undefined,
        borderLeft: dockSide === 'right' ? `1px solid ${theme.border}` : undefined,
        boxShadow: theme.isDark ? '0 -12px 28px rgba(0,0,0,0.22)' : '0 -12px 28px rgba(0,0,0,0.08)',
      }}
    >
      <div
        onMouseDown={startResize}
        style={{
          position: 'absolute',
          top: dockSide === 'bottom' ? '-4px' : 0,
          left: dockSide === 'right' ? '-4px' : 0,
          width: dockSide === 'right' ? '7px' : '100%',
          height: dockSide === 'bottom' ? '7px' : '100%',
          cursor: dockSide === 'bottom' ? 'row-resize' : 'col-resize',
          zIndex: 2,
        }}
      />
      <div
        style={{
          height: '34px',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '0 8px',
          borderBottom: `1px solid ${theme.border}`,
          flexShrink: 0,
          overflowX: 'auto',
          overflowY: 'hidden',
        }}
      >
        {visibleSessions.map((session) => {
          const active = session.id === activeSession?.id;
          return (
            <button
              key={session.id}
              type="button"
              onClick={() => setActiveSessionId(session.id)}
              style={{
                height: '24px',
                maxWidth: '150px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '0 8px',
                borderRadius: '5px',
                border: `1px solid ${active ? 'rgba(16,185,129,0.42)' : 'transparent'}`,
                backgroundColor: active
                  ? (theme.isDark ? 'rgba(16,185,129,0.16)' : 'rgba(16,185,129,0.12)')
                  : 'transparent',
                color: active ? theme.text : theme.textSecondary,
                cursor: 'pointer',
                fontSize: '11px',
                fontWeight: 600,
                flexShrink: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={`${session.title} — ${session.cwd}`}
            >
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: session.exitedAt ? '#6b7280' : '#10b981', flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{session.title}</span>
              <span style={{ color: theme.textSecondary, overflow: 'hidden', textOverflow: 'ellipsis' }}>{pathBasename(session.cwd)}</span>
            </button>
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
              border: `1px solid ${theme.border}`,
              borderRadius: '5px',
              backgroundColor: theme.isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.035)',
              color: theme.text,
              fontSize: '11px',
              fontWeight: 600,
              padding: '0 7px',
              outline: 'none',
            }}
          />
        )}
        <span
          title={activeSession?.transcriptPath}
          style={{
            color: activeSession?.exitedAt ? theme.textSecondary : '#10b981',
            fontSize: '11px',
            fontWeight: 600,
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          {activeStatus}
        </span>
        <div style={{ flex: 1, minWidth: '12px' }} />
        {attachStatus && <span style={{ color: theme.textSecondary, fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{attachStatus}</span>}
        {attachedContexts.length > 0 && (
          <span
            title={attachedContexts.map((context) => `${context.title} — ${context.sourcePath}`).join('\n')}
            style={{
              color: theme.textSecondary,
              fontSize: '11px',
              whiteSpace: 'nowrap',
            }}
          >
            {attachedContexts.length} page{attachedContexts.length === 1 ? '' : 's'}
          </span>
        )}
        <input
          list="codex-terminal-cwd-history"
          value={newSessionCwd}
          onChange={(event) => setNewSessionCwd(event.target.value)}
          placeholder={activeSession?.cwd ?? 'Working directory'}
          title={activeSession ? `Active cwd: ${activeSession.cwd}` : 'Working directory for new Codex terminals'}
          style={{
            width: dockSide === 'right' ? '132px' : '220px',
            height: '24px',
            minWidth: 0,
            border: `1px solid ${theme.border}`,
            borderRadius: '5px',
            backgroundColor: theme.isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.035)',
            color: theme.textSecondary,
            fontSize: '11px',
            padding: '0 7px',
            outline: 'none',
            flexShrink: 0,
          }}
        />
        <datalist id="codex-terminal-cwd-history">
          {cwdHistory.map((cwd) => <option key={cwd} value={cwd}>{cwd}</option>)}
        </datalist>
        {activeSession && (
          <button type="button" onClick={() => setNewSessionCwd(activeSession.cwd)} title="Use active session cwd for new terminals" style={toolbarButtonStyle(theme)}>
            Cwd
          </button>
        )}
        <button type="button" onClick={() => void attachCurrentPage()} disabled={!pageContext || !activeSession || Boolean(activeSession.exitedAt) || Boolean(activeSession.restored)} title="Include current Field Theory page" style={toolbarButtonStyle(theme)}>
          Include Page
        </button>
        {activeSession && (activeSession.exitedAt || activeSession.restored) && (
          <button type="button" onClick={() => void restartSession(activeSession)} title="Restart active Codex terminal" style={toolbarButtonStyle(theme)}>
            Restart
          </button>
        )}
        <button type="button" onClick={() => setDockSide(dockSide === 'bottom' ? 'right' : 'bottom')} title="Move terminal panel" style={toolbarButtonStyle(theme)}>
          {dockSide === 'bottom' ? 'Right' : 'Bottom'}
        </button>
        {activeSession && (
          <button type="button" onClick={() => void closeSession(activeSession.id)} title="Close active Codex terminal" style={toolbarButtonStyle(theme)}>
            Close
          </button>
        )}
        <button type="button" onClick={() => onVisibleChange(false)} title="Hide terminal panel" style={toolbarButtonStyle(theme)}>
          Hide
        </button>
      </div>
      {attachedContexts.length > 0 && (
        <div
          style={{
            display: 'flex',
            gap: '6px',
            alignItems: 'center',
            padding: '6px 8px',
            borderBottom: `1px solid ${theme.border}`,
            overflowX: 'auto',
            flexShrink: 0,
          }}
        >
          {attachedContexts.slice(-8).map((context) => (
            <span
              key={`${context.filePath}:${context.attachedAt}`}
              title={`${context.title}\n${context.sourcePath}\n${context.filePath}`}
              style={{
                maxWidth: '220px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                border: `1px solid ${theme.border}`,
                borderRadius: '5px',
                padding: '2px 7px',
                color: theme.textSecondary,
                backgroundColor: theme.isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.035)',
                fontSize: '11px',
                flexShrink: 0,
              }}
            >
              {context.title}
            </span>
          ))}
        </div>
      )}
      <div ref={terminalViewportRef} style={{ position: 'relative', flex: 1, minHeight: 0, minWidth: 0 }}>
        {nativeGhosttyMode === 'checking' && (
          <div style={{ color: theme.textSecondary, fontSize: '12px', padding: '12px' }}>
            Checking Ghostty...
          </div>
        )}
        {usingNativeGhostty && (
          <div
            ref={nativeInputRef}
            tabIndex={0}
            title="Native Ghostty terminal surface"
            onClick={() => nativeInputRef.current?.focus()}
            onKeyDown={handleNativeGhosttyKeyDown}
            onKeyUp={handleNativeGhosttyKeyUp}
            style={{
              position: 'absolute',
              inset: 0,
              backgroundColor: theme.isDark ? '#101113' : '#f7f5f0',
              outline: 'none',
            }}
          />
        )}
        {usingNativeGhostty && activeSession?.restored && (
          <pre
            style={{
              position: 'absolute',
              inset: 0,
              margin: 0,
              padding: '10px 12px',
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              color: theme.text,
              backgroundColor: theme.isDark ? '#101113' : '#f7f5f0',
              fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              fontSize: '12px',
              lineHeight: 1.35,
            }}
          >
            {nativeReplayText || 'No saved Ghostty snapshot for this session.'}
          </pre>
        )}
        {nativeGhosttyMode === 'unavailable' && nativeGhosttyError && sessions.length === 0 && (
          <div style={{ color: theme.textSecondary, fontSize: '12px', padding: '12px' }}>
            {nativeGhosttyError}
          </div>
        )}
        {nativeGhosttyMode === 'unavailable' && sessions.map((session) => (
          <div
            key={session.id}
            ref={(element) => setTerminalHost(session.id, element)}
            style={{
              position: 'absolute',
              inset: 0,
              display: session.id === activeSession?.id ? 'block' : 'none',
              padding: '8px',
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
