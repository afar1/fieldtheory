import { useEffect, useState, useMemo } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import BookmarksList from './BookmarksList';
import BookmarksCanvas from './BookmarksCanvas';

type BookmarksViewMode = 'list' | 'canvas';
const STORAGE_KEY = 'bookmarks-view-mode';

function loadMode(): BookmarksViewMode {
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved === 'list' ? 'list' : 'canvas';
}

export default function BookmarksPane() {
  const { theme } = useTheme();
  const [mode, setMode] = useState<BookmarksViewMode>(loadMode);
  const [snapshot, setSnapshot] = useState<BookmarksSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [folder, setFolder] = useState<string>('All');
  const [folderMenuOpen, setFolderMenuOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, mode);
  }, [mode]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const data = await window.bookmarksAPI?.getAll();
      if (cancelled) return;
      setSnapshot(data ?? { bookmarks: [], folders: [] });
      setLoading(false);
    };
    load();
    const unsub = window.bookmarksAPI?.onChanged(() => load());
    return () => { cancelled = true; unsub?.(); };
  }, []);

  const filtered = useMemo(() => {
    if (!snapshot) return [];
    if (folder === 'All') return snapshot.bookmarks;
    return snapshot.bookmarks.filter((b) => b.folders.includes(folder));
  }, [snapshot, folder]);

  const folders = snapshot?.folders ?? [];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0, backgroundColor: theme.bg }}>
      {/* Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '10px 16px',
          borderBottom: `1px solid ${theme.border}`,
          flexShrink: 0,
        }}
      >
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

        <div style={{ flex: 1 }} />

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
      </div>

      {/* Content */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', position: 'relative' }}>
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: theme.textSecondary, fontSize: '12px' }}>
            Loading bookmarks…
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: theme.textSecondary, fontSize: '12px', textAlign: 'center', padding: '24px' }}>
            {snapshot && snapshot.bookmarks.length === 0
              ? <>No bookmarks synced yet. Run <code style={{ fontSize: '10px', background: theme.hoverBg, padding: '1px 4px', borderRadius: '3px' }}>ft sync</code> in your terminal.</>
              : 'No bookmarks in this folder.'}
          </div>
        ) : mode === 'list' ? (
          <BookmarksList bookmarks={filtered} />
        ) : (
          <BookmarksCanvas bookmarks={filtered} />
        )}
      </div>
    </div>
  );
}
