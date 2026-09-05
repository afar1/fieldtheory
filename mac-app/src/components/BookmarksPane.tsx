import { memo, useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import BookmarksList from './BookmarksList';
import BookmarksCanvas from './BookmarksCanvas';
import ImmersiveToggle from './ImmersiveToggle';
import { getBookmarks, peekBookmarks, onBookmarksChanged } from '../services/bookmarksCache';

type BookmarksViewMode = 'list' | 'canvas';
type BookmarkSyncStatus = 'idle' | 'syncing' | 'checked' | 'offline' | 'failed';
const STORAGE_KEY = 'bookmarks-view-mode';
const SHOW_TEXT_KEY = 'bookmarks-show-text';
const RENDERER_STORAGE_CHANGED_EVENT = 'fieldtheory:renderer-storage-changed';
const FIELD_THEORY_CLI_INSTALL_COMMAND = 'npm install -g fieldtheory';
const FIELD_THEORY_CLI_URL = 'https://fieldtheory.dev/cli/';

function loadMode(): BookmarksViewMode {
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved === 'list' ? 'list' : 'canvas';
}

function loadShowText(): boolean {
  const saved = localStorage.getItem(SHOW_TEXT_KEY);
  return saved === null ? true : saved === '1';
}

function isBookmarksStorageKey(key: string | null | undefined): boolean {
  return key === STORAGE_KEY || key === SHOW_TEXT_KEY;
}

function countNewBookmarks(current: BookmarksSnapshot | null, next: BookmarksSnapshot | null): number {
  if (!current || !next) return 0;
  const currentIds = new Set(current.bookmarks.map((bookmark) => bookmark.id));
  return next.bookmarks.reduce((count, bookmark) => count + (currentIds.has(bookmark.id) ? 0 : 1), 0);
}

function pluralizeBookmark(count: number): string {
  return count === 1 ? 'bookmark' : 'bookmarks';
}

function isOfflineSyncError(error: string | undefined): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const message = (error ?? '').toLowerCase();
  return [
    'eai_again',
    'econnreset',
    'enetwork',
    'enotfound',
    'etimedout',
    'fetch failed',
    'network',
    'offline',
    'timed out',
  ].some((token) => message.includes(token));
}

interface BookmarksPaneProps {
  active?: boolean;
  isFullScreen?: boolean;
  canNavigateBack?: boolean;
  canNavigateForward?: boolean;
  onNavigateBack?: () => void;
  onNavigateForward?: () => void;
  onToggleFullScreen?: () => void;
  onCanvasModeActiveChange?: (active: boolean) => void;
  onCanvasToolbarTopChange?: (top: number | null) => void;
  onActionFeedback?: (message: string) => void;
}

// memo so parent re-renders (e.g. textarea keystrokes in the librarian
// editor) don't reconcile the bookmarks canvas while it's hidden.
function BookmarksPane({
  active = true,
  isFullScreen,
  canNavigateBack = false,
  canNavigateForward = false,
  onNavigateBack,
  onNavigateForward,
  onToggleFullScreen,
  onCanvasModeActiveChange,
  onCanvasToolbarTopChange,
  onActionFeedback,
}: BookmarksPaneProps) {
  const { theme } = useTheme();
  const [mode, setMode] = useState<BookmarksViewMode>(loadMode);
  // Lazy keep-alive: mount each view on first visit, then toggle via display
  // so switching list↔canvas doesn't rebuild the 500-pool or lose scroll state.
  const [listEverShown, setListEverShown] = useState<boolean>(() => loadMode() === 'list');
  const [canvasEverShown, setCanvasEverShown] = useState<boolean>(() => loadMode() === 'canvas');
  const [snapshot, setSnapshot] = useState<BookmarksSnapshot | null>(() => peekBookmarks());
  const [pendingSnapshot, setPendingSnapshot] = useState<BookmarksSnapshot | null>(null);
  const [syncStatus, setSyncStatus] = useState<BookmarkSyncStatus>('idle');
  const [syncRetryCount, setSyncRetryCount] = useState(0);
  const [revealRevision, setRevealRevision] = useState(0);
  const [folder, setFolder] = useState<string>('All');
  const [folderMenuOpen, setFolderMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [showText, setShowText] = useState<boolean>(loadShowText);
  const [installCopied, setInstallCopied] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const installCopyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const displayedSnapshotRef = useRef<BookmarksSnapshot | null>(snapshot);
  const pendingSnapshotRef = useRef<BookmarksSnapshot | null>(null);
  const browsingRef = useRef(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);
  const onBrowsingChange = useCallback((browsing: boolean) => {
    browsingRef.current = browsing;
    if (!browsing && pendingSnapshotRef.current) {
      displayedSnapshotRef.current = pendingSnapshotRef.current;
      setSnapshot(pendingSnapshotRef.current);
      pendingSnapshotRef.current = null;
      setPendingSnapshot(null);
    }
  }, []);
  const loading = snapshot === null;
  const pendingNewCount = useMemo(() => countNewBookmarks(snapshot, pendingSnapshot), [snapshot, pendingSnapshot]);

  const holdPendingSnapshot = (nextSnapshot: BookmarksSnapshot | null) => {
    pendingSnapshotRef.current = nextSnapshot;
    setPendingSnapshot(nextSnapshot);
  };

  useEffect(() => {
    return () => {
      if (installCopyTimerRef.current) clearTimeout(installCopyTimerRef.current);
    };
  }, []);

  useEffect(() => {
    displayedSnapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, mode);
    if (mode === 'list' && !listEverShown) setListEverShown(true);
    if (mode === 'canvas' && !canvasEverShown) setCanvasEverShown(true);
  }, [mode, listEverShown, canvasEverShown]);

  useEffect(() => {
    onCanvasModeActiveChange?.(active && mode === 'canvas');
    return () => onCanvasModeActiveChange?.(false);
  }, [active, mode, onCanvasModeActiveChange]);

  useEffect(() => {
    if (!active || mode !== 'canvas') {
      onCanvasToolbarTopChange?.(null);
      return;
    }
    const toolbar = toolbarRef.current;
    if (!toolbar) return;
    const updateTop = () => onCanvasToolbarTopChange?.(toolbar.getBoundingClientRect().top);
    updateTop();
    const resizeObserver = new ResizeObserver(updateTop);
    resizeObserver.observe(toolbar);
    window.addEventListener('resize', updateTop);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateTop);
      onCanvasToolbarTopChange?.(null);
    };
  }, [active, mode, onCanvasToolbarTopChange]);

  useEffect(() => {
    localStorage.setItem(SHOW_TEXT_KEY, showText ? '1' : '0');
  }, [showText]);

  useEffect(() => {
    const applyStoredBookmarkPreferences = () => {
      const nextMode = loadMode();
      setMode((current) => (current === nextMode ? current : nextMode));
      setListEverShown((current) => current || nextMode === 'list');
      setCanvasEverShown((current) => current || nextMode === 'canvas');
      setShowText((current) => {
        const nextShowText = loadShowText();
        return current === nextShowText ? current : nextShowText;
      });
    };
    const handleRendererStorageChanged = (event: Event) => {
      const key = (event as CustomEvent<{ key?: string | null }>).detail?.key;
      if (isBookmarksStorageKey(key)) applyStoredBookmarkPreferences();
    };
    const handleStorage = (event: Event) => {
      const key = (event as StorageEvent).key;
      if (key === undefined || key === null || isBookmarksStorageKey(key)) applyStoredBookmarkPreferences();
    };
    window.addEventListener(RENDERER_STORAGE_CHANGED_EVENT, handleRendererStorageChanged);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(RENDERER_STORAGE_CHANGED_EVENT, handleRendererStorageChanged);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    browsingRef.current = false;
    const applySnapshot = (next: BookmarksSnapshot) => {
      if (cancelled) return;
      if (browsingRef.current && countNewBookmarks(displayedSnapshotRef.current, next) > 0) {
        holdPendingSnapshot(next);
        return;
      }
      holdPendingSnapshot(null);
      displayedSnapshotRef.current = next;
      setSnapshot(next);
    };
    const unsub = onBookmarksChanged(applySnapshot);
    void getBookmarks().then(applySnapshot).catch(() => {
      if (!cancelled) setSyncStatus('failed');
    });
    let statusEvents = 0;
    const applySyncState = (state: BookmarkSyncState) => {
      if (cancelled) return;
      setLastCheckedAt(state.lastCheckedAt);
      setSyncStatus(state.phase === 'syncing' ? 'syncing'
        : state.phase === 'offline' ? 'offline'
        : state.phase === 'backoff' || state.phase === 'unsupported' ? 'failed'
        : state.lastCheckedAt ? 'checked' : 'idle');
    };
    const unsubStatus = window.bookmarksAPI?.onSyncStateChanged?.((state) => {
      statusEvents++;
      applySyncState(state);
    });
    // Subscribe first; don't let an older state read overwrite a newer event.
    void window.bookmarksAPI?.getSyncState?.().then((state) => {
      if (statusEvents === 0) applySyncState(state);
    }).catch(() => {});
    const syncBookmarks = async () => {
      const syncIfStale = window.bookmarksAPI?.syncIfStale;
      if (!syncIfStale) return;
      setSyncStatus('syncing');
      try {
        const result = await syncIfStale();
        if (cancelled) return;
        statusEvents++;
        // Native data notifications update the cache; a successful no-change
        // check must not pay for another full-library IPC transfer.
        if (result.status === 'failed') setSyncStatus(isOfflineSyncError(result.error) ? 'offline' : 'failed');
        else if (result.status === 'offline') setSyncStatus('offline');
        else if (['missing-cli', 'unavailable', 'unsupported'].includes(result.status)) setSyncStatus('failed');
        else if (result.status === 'already-running') setSyncStatus('syncing');
        else {
          setLastCheckedAt(result.lastCheckedAt ?? null);
          setSyncStatus(result.lastCheckedAt ? 'checked' : 'idle');
        }
      } catch {
        if (!cancelled) setSyncStatus(typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'failed');
      }
    };
    void syncBookmarks();
    return () => {
      cancelled = true;
      unsub();
      unsubStatus?.();
    };
  }, [active, syncRetryCount]);

  // Debounce search input; 7k substring scans is fast but avoid churn while typing.
  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedQuery(searchQuery.trim().toLowerCase()), 80);
    return () => window.clearTimeout(id);
  }, [searchQuery]);

  const filtered = useMemo(() => {
    if (!snapshot) return [];
    let list = snapshot.bookmarks;
    if (!showText) list = list.filter((b) => b.images && b.images.length > 0);
    if (folder !== 'All') list = list.filter((b) => b.folders.includes(folder));
    if (debouncedQuery) {
      const q = debouncedQuery;
      list = list.filter((b) =>
        b.text.toLowerCase().includes(q) ||
        (b.title ?? '').toLowerCase().includes(q) ||
        (b.domain ?? '').toLowerCase().includes(q) ||
        b.url.toLowerCase().includes(q) ||
        b.authorHandle.toLowerCase().includes(q) ||
        b.authorName.toLowerCase().includes(q)
      );
    }
    return list;
  }, [snapshot, folder, debouncedQuery, showText]);

  const folders = snapshot?.folders ?? [];

  const showPendingBookmarks = () => {
    if (!pendingSnapshot) return;
    displayedSnapshotRef.current = pendingSnapshot;
    setSnapshot(pendingSnapshot);
    holdPendingSnapshot(null);
    browsingRef.current = false;
    setRevealRevision((revision) => revision + 1);
  };

  const retryBookmarkSync = () => {
    if (syncStatus === 'syncing') return;
    setSyncRetryCount((count) => count + 1);
  };

  const syncStatusView = pendingNewCount > 0 ? null : (() => {
    if (syncStatus === 'syncing') return { label: 'Checking for new bookmarks…', color: theme.textSecondary, retry: false };
    if (syncStatus === 'checked' && lastCheckedAt) return { label: `Last checked ${new Date(lastCheckedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`, color: theme.textSecondary, retry: false };
    if (syncStatus === 'offline') return { label: 'Network offline', color: theme.textSecondary, retry: true };
    if (syncStatus === 'failed') return { label: 'Sync failed', color: theme.textSecondary, retry: true };
    return null;
  })();

  const copyInstallCommand = async () => {
    await navigator.clipboard?.writeText(FIELD_THEORY_CLI_INSTALL_COMMAND);
    setInstallCopied(true);
    if (installCopyTimerRef.current) clearTimeout(installCopyTimerRef.current);
    installCopyTimerRef.current = setTimeout(() => setInstallCopied(false), 1600);
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0, backgroundColor: theme.bg }}>
      {/* Toolbar */}
      <div
        ref={toolbarRef}
        data-fieldtheory-bookmarks-toolbar="true"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '10px 30px 10px 44px',
          borderBottom: `1px solid ${theme.border}`,
          flexShrink: 0,
        }}
      >
        <div
          aria-label="Bookmarks location"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            minWidth: 0,
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '1px', flexShrink: 0 }}>
            <button
              type="button"
              onClick={onNavigateBack}
              disabled={!canNavigateBack}
              title="Back"
              aria-label="Back"
              style={{
                width: '22px',
                height: '24px',
                padding: 0,
                color: theme.textSecondary,
                backgroundColor: 'transparent',
                border: 'none',
                borderRadius: '4px',
                cursor: canNavigateBack ? 'pointer' : 'default',
                opacity: canNavigateBack ? 1 : 0.32,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
                <path d="M10.354 3.146a.5.5 0 0 1 0 .708L6.207 8l4.147 4.146a.5.5 0 0 1-.708.708l-4.5-4.5a.5.5 0 0 1 0-.708l4.5-4.5a.5.5 0 0 1 .708 0z" />
              </svg>
            </button>
            <button
              type="button"
              onClick={onNavigateForward}
              disabled={!canNavigateForward}
              title="Forward"
              aria-label="Forward"
              style={{
                width: '22px',
                height: '24px',
                padding: 0,
                color: theme.textSecondary,
                backgroundColor: 'transparent',
                border: 'none',
                borderRadius: '4px',
                cursor: canNavigateForward ? 'pointer' : 'default',
                opacity: canNavigateForward ? 1 : 0.32,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
                <path d="M5.646 3.146a.5.5 0 0 0 0 .708L9.793 8l-4.147 4.146a.5.5 0 0 0 .708.708l4.5-4.5a.5.5 0 0 0 0-.708l-4.5-4.5a.5.5 0 0 0-.708 0z" />
              </svg>
            </button>
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              minWidth: 0,
              fontSize: '11px',
              color: theme.textSecondary,
              whiteSpace: 'nowrap',
            }}
          >
            <span style={{ color: theme.text, fontWeight: 600 }}>Bookmarks</span>
          </div>
        </div>

        {/* List / Canvas segmented toggle */}
        <div
          style={{
            display: 'inline-flex',
            border: `1px solid ${theme.border}`,
            borderRadius: '6px',
            overflow: 'hidden',
          }}
        >
          {(['list', 'canvas'] as const).map((m) => {
            const active = mode === m;
            return (
              <button
                key={m}
                onClick={() => setMode(m)}
                style={{
                  padding: '4px 10px',
                  fontSize: '11px',
                  fontWeight: 500,
                  color: active ? theme.text : theme.textSecondary,
                  backgroundColor: active
                    ? (theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)')
                    : 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  textTransform: 'capitalize',
                }}
              >
                {m}
              </button>
            );
          })}
        </div>

        {/* Search */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search bookmarks"
            style={{
              flex: 1,
              maxWidth: '360px',
              padding: '5px 10px',
              fontSize: '11px',
              color: theme.text,
              backgroundColor: theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
              border: `1px solid ${theme.border}`,
              borderRadius: '6px',
              outline: 'none',
            }}
          />
        </div>

        {pendingNewCount > 0 && (
          <button
            type="button"
            onClick={showPendingBookmarks}
            style={{
              padding: '4px 10px',
              fontSize: '11px',
              color: theme.isDark ? '#8ecbff' : '#0a7bdc',
              backgroundColor: theme.isDark ? 'rgba(29,155,240,0.12)' : 'rgba(10,123,220,0.08)',
              border: `1px solid ${theme.isDark ? 'rgba(142,203,255,0.28)' : 'rgba(10,123,220,0.18)'}`,
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: 600,
              whiteSpace: 'nowrap',
            }}
          >
            Show {pendingNewCount} new {pluralizeBookmark(pendingNewCount)}
          </button>
        )}

        {syncStatusView && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '10px',
              color: theme.textSecondary,
              whiteSpace: 'nowrap',
            }}
          >
            <span
              aria-hidden="true"
              className={syncStatus === 'syncing' ? 'bookmarks-sync-dot bookmarks-sync-dot--syncing' : 'bookmarks-sync-dot'}
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                backgroundColor: theme.isDark ? '#8ecbff' : '#0a7bdc',
              }}
            />
            <span>{syncStatusView.label}</span>
            {syncStatusView.retry && (
              <button
                type="button"
                onClick={retryBookmarkSync}
                title="Retry bookmark sync"
                aria-label="Retry bookmark sync"
                style={{
                  width: '20px',
                  height: '20px',
                  padding: 0,
                  color: syncStatusView.color,
                  backgroundColor: 'transparent',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M13.2 5.4A5.8 5.8 0 1 0 14 8" />
                  <path d="M13.2 2.4v3h-3" />
                </svg>
              </button>
            )}
          </div>
        )}

        {/* Show text toggle */}
        <button
          onClick={() => setShowText((v) => !v)}
          title={showText ? 'Hide text-only bookmarks' : 'Show text-only bookmarks'}
          style={{
            padding: '4px 10px',
            fontSize: '11px',
            color: showText ? theme.text : theme.textSecondary,
            backgroundColor: showText
              ? (theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)')
              : 'transparent',
            border: `1px solid ${theme.border}`,
            borderRadius: '6px',
            cursor: 'pointer',
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
          }}
        >
          <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
            <path d="M2 4h12v1.5H2V4zm0 3h12v1.5H2V7zm0 3h8v1.5H2V10z" />
          </svg>
          <span>Text</span>
        </button>

        {/* Folder filter */}
        {folders.length > 0 && (
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setFolderMenuOpen((v) => !v)}
              style={{
                padding: '4px 10px',
                fontSize: '11px',
                color: theme.text,
                backgroundColor: theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
                border: `1px solid ${theme.border}`,
                borderRadius: '6px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <span>{folder}</span>
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <polyline points="3,4.5 6,7.5 9,4.5" />
              </svg>
            </button>
            {folderMenuOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  marginTop: '4px',
                  minWidth: '160px',
                  maxHeight: '300px',
                  overflowY: 'auto',
                  padding: '4px',
                  backgroundColor: theme.surface1 ?? theme.bg,
                  border: `1px solid ${theme.border}`,
                  borderRadius: '8px',
                  boxShadow: theme.isDark
                    ? '0 6px 20px rgba(0,0,0,0.5)'
                    : '0 6px 20px rgba(0,0,0,0.12)',
                  zIndex: 10,
                }}
                onMouseLeave={() => setFolderMenuOpen(false)}
              >
                {['All', ...folders.map((f) => f.name)].map((name) => (
                  <button
                    key={name}
                    onClick={() => { setFolder(name); setFolderMenuOpen(false); }}
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      padding: '6px 10px',
                      fontSize: '11px',
                      color: name === folder ? theme.text : theme.textSecondary,
                      fontWeight: name === folder ? 600 : 400,
                      backgroundColor: 'transparent',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = theme.hoverBg)}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    {name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div style={{ fontSize: '10px', color: theme.textSecondary, opacity: 0.7 }}>
          {loading ? 'Loading…' : `${filtered.length} bookmarks`}
        </div>

        {onToggleFullScreen && (
          <ImmersiveToggle
            isFullScreen={!!isFullScreen}
            onToggle={onToggleFullScreen}
            title={isFullScreen ? 'Exit immersive view (⌘,)' : 'Enter immersive view (⌘,)'}
          />
        )}
      </div>

      {/* Content */}
      <div
        onPointerDownCapture={() => { browsingRef.current = true; }}
        onScrollCapture={(event) => { if (mode === 'list') onBrowsingChange((event.target as HTMLElement).scrollTop > 8); }}
        style={{ flex: 1, minHeight: 0, overflow: 'hidden', position: 'relative' }}>
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: theme.textSecondary, fontSize: '12px' }}>
            Loading bookmarks…
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: theme.textSecondary, fontSize: '12px', textAlign: 'center', padding: '24px' }}>
            {snapshot && snapshot.bookmarks.length === 0 ? (
              <div style={{ width: 'min(420px, 100%)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                <div style={{ fontSize: '14px', fontWeight: 600, color: theme.text }}>Sync your bookmarks locally</div>
                <div style={{ lineHeight: 1.5 }}>
                  Field Theory CLI gives you a free local copy of all your X bookmarks, then Field Theory can show them here.
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    maxWidth: '100%',
                    border: `1px solid ${theme.border}`,
                    borderRadius: '6px',
                    overflow: 'hidden',
                    backgroundColor: theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
                  }}
                >
                  <code style={{ padding: '8px 10px', fontSize: '12px', color: theme.text, whiteSpace: 'nowrap', overflowX: 'auto' }}>
                    {FIELD_THEORY_CLI_INSTALL_COMMAND}
                  </code>
                  <button
                    type="button"
                    onClick={copyInstallCommand}
                    style={{
                      alignSelf: 'stretch',
                      padding: '0 10px',
                      fontSize: '11px',
                      fontWeight: 600,
                      color: theme.text,
                      backgroundColor: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
                      border: 'none',
                      borderLeft: `1px solid ${theme.border}`,
                      cursor: 'pointer',
                    }}
                  >
                    {installCopied ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => window.shellAPI?.openExternal(FIELD_THEORY_CLI_URL)}
                  style={{
                    padding: 0,
                    fontSize: '11px',
                    color: theme.textSecondary,
                    backgroundColor: 'transparent',
                    border: 'none',
                    textDecoration: 'underline',
                    cursor: 'pointer',
                  }}
                >
                  Learn more about Field Theory CLI
                </button>
              </div>
            ) : 'No bookmarks in this folder.'}
          </div>
        ) : (
          <>
            {listEverShown && (
              <div style={{ position: 'absolute', inset: 0, display: mode === 'list' ? 'flex' : 'none', flexDirection: 'column', minHeight: 0 }}>
                <BookmarksList bookmarks={filtered} onActionFeedback={onActionFeedback} />
              </div>
            )}
            {canvasEverShown && (
              <div style={{ position: 'absolute', inset: 0, display: mode === 'canvas' ? 'flex' : 'none', flexDirection: 'column', minHeight: 0 }}>
                <BookmarksCanvas bookmarks={filtered} active={active && mode === 'canvas'} viewKey={JSON.stringify([folder, debouncedQuery, showText, revealRevision])} onBrowsingChange={onBrowsingChange} onActionFeedback={onActionFeedback} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default memo(BookmarksPane);
