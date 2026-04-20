import { memo, useState, useEffect, useCallback, useMemo, useRef, type MutableRefObject } from 'react';
import { useTheme } from '../contexts/ThemeContext';

type SortMode = 'alpha' | 'time';

interface UnifiedItem {
  id: string;
  title: string;
  type: 'wiki' | 'artifact' | 'bookmarks' | 'external';
  absPath: string;
  relPath?: string;
  timestamp: number;
}

export const BOOKMARKS_ITEM_ID = 'bookmarks:root';
export const SCRATCHPAD_FOLDER_NAME = 'scratchpad';

interface UnifiedFolder {
  name: string;
  label: string;
  items: UnifiedItem[];
  canCreateFile?: boolean;
}

// Lets callers (keyboard shortcuts) drive the inline-create UI since
// Electron silently returns null from window.prompt().
export interface WikiCreationController {
  beginCreateFile: (folder?: string) => void;
  beginCreateDir: () => void;
}

interface WikiSidebarProps {
  onSelectItem: (item: UnifiedItem) => void;
  selectedId: string | null;
  onCreateFile: (folderName: string, fileName: string) => void | Promise<void>;
  onCreateDir: (dirName: string) => void | Promise<void>;
  // Scratchpad's "+" creates an entry titled with the current date (e.g.
  // "Monday Apr 20th") so the user doesn't have to name quick captures.
  onCreateScratchpadDefault?: () => void | Promise<void>;
  flatItemsRef?: MutableRefObject<UnifiedItem[]>;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  searchInputRef?: MutableRefObject<HTMLInputElement | null>;
  creationControllerRef?: MutableRefObject<WikiCreationController | null>;
}

function formatDateGroup(timestamp: number): string {
  const date = new Date(timestamp);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const itemDate = new Date(date);
  itemDate.setHours(0, 0, 0, 0);

  if (itemDate.getTime() === today.getTime()) return 'Today';
  if (itemDate.getTime() === yesterday.getTime()) return 'Yesterday';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function groupItemsByDate(items: UnifiedItem[]): Map<string, UnifiedItem[]> {
  const sorted = [...items].sort((a, b) => b.timestamp - a.timestamp);
  const groups = new Map<string, UnifiedItem[]>();
  for (const item of sorted) {
    const group = formatDateGroup(item.timestamp);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(item);
  }
  return groups;
}

export type { UnifiedItem, UnifiedFolder, SortMode };

function matchesLibrarySearch(item: UnifiedItem, normalizedQuery: string): boolean {
  if (!normalizedQuery) return true;

  return [
    item.title,
    item.relPath,
    item.absPath,
  ]
    .filter(Boolean)
    .some((value) => value!.toLowerCase().includes(normalizedQuery));
}

export function filterUnifiedFolders(folders: UnifiedFolder[], searchQuery: string): UnifiedFolder[] {
  const normalizedQuery = searchQuery.trim().toLowerCase();
  if (!normalizedQuery) return folders;

  return folders
    .map((folder) => ({
      ...folder,
      items: folder.items.filter((item) => matchesLibrarySearch(item, normalizedQuery)),
    }))
    .filter((folder) => folder.items.length > 0);
}

/** Split the recent list into wiki/external groups and clip each to a
 *  visible count that expands when the caller passes a non-null `expanded`
 *  kind. Returns stable shapes so the sidebar render can map() blindly. */
export function splitRecent(
  entries: RecentEntry[],
  expanded: 'wiki' | 'external' | null,
  collapsed: number = 3,
  expandedMax: number = 10,
): {
  wiki: RecentEntry[];
  wikiTotal: number;
  external: RecentEntry[];
  externalTotal: number;
} {
  const wikiAll = entries.filter((e) => e.kind === 'wiki');
  const externalAll = entries.filter((e) => e.kind === 'external');
  const wikiLimit = expanded === 'wiki' ? expandedMax : collapsed;
  const externalLimit = expanded === 'external' ? expandedMax : collapsed;
  return {
    wiki: wikiAll.slice(0, wikiLimit),
    wikiTotal: wikiAll.length,
    external: externalAll.slice(0, externalLimit),
    externalTotal: externalAll.length,
  };
}

/** Pin Scratchpad at the top when the wiki tree doesn't already expose it, so
 * the user can create ad-hoc docs without running a backfill first. */
export function ensureScratchpadPinned(folders: UnifiedFolder[]): UnifiedFolder[] {
  if (folders.some((f) => f.name === SCRATCHPAD_FOLDER_NAME)) return folders;
  return [
    { name: SCRATCHPAD_FOLDER_NAME, label: 'Scratchpad', items: [], canCreateFile: true },
    ...folders,
  ];
}

// memo so textarea keystrokes in the librarian editor don't re-render the
// entire sidebar tree on every character.
function WikiSidebar({
  onSelectItem,
  selectedId,
  onCreateFile,
  onCreateDir,
  onCreateScratchpadDefault,
  flatItemsRef,
  searchQuery,
  onSearchQueryChange,
  searchInputRef,
  creationControllerRef,
}: WikiSidebarProps) {
  const { theme } = useTheme();
  const [wikiTree, setWikiTree] = useState<WikiFolder[]>([]);
  const [artifacts, setArtifacts] = useState<ReadingMeta[]>([]);
  const [sortMode, setSortMode] = useState<SortMode>(() => {
    const saved = localStorage.getItem('library-sort-mode');
    return saved === 'time' ? 'time' : 'alpha';
  });
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('wiki-expanded-folders');
      return saved ? new Set(JSON.parse(saved)) : new Set(['artifacts']);
    } catch {
      return new Set(['artifacts']);
    }
  });
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [creating, setCreating] = useState<
    | { kind: 'file'; folder: string }
    | { kind: 'dir' }
    | null
  >(null);
  const [newName, setNewName] = useState('');
  const createInputRef = useRef<HTMLInputElement | null>(null);
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const [recentExpanded, setRecentExpanded] = useState<'wiki' | 'external' | null>(null);
  const selectedItemRef = useRef<HTMLDivElement | null>(null);

  // Auto-expand the parent folder of the selected wiki item so programmatic
  // opens (open-file, wiki:// links, Recent clicks) reveal the entry instead
  // of leaving it hidden under a collapsed folder.
  useEffect(() => {
    if (!selectedId?.startsWith('wiki:')) return;
    const relPath = selectedId.slice('wiki:'.length);
    const folder = relPath.includes('/') ? relPath.split('/')[0] : null;
    if (!folder) return;
    setExpandedFolders((prev) => {
      if (prev.has(folder)) return prev;
      const next = new Set(prev);
      next.add(folder);
      return next;
    });
  }, [selectedId]);

  // Scroll the selected item into view when the selection changes programmatically.
  useEffect(() => {
    if (!selectedId) return;
    // Defer to next frame so the newly-expanded folder has rendered its items.
    const id = requestAnimationFrame(() => {
      selectedItemRef.current?.scrollIntoView({ block: 'nearest' });
    });
    return () => cancelAnimationFrame(id);
  }, [selectedId]);

  const loadTree = useCallback(async () => {
    const result = await window.wikiAPI?.getTree();
    if (result) setWikiTree(result);
  }, []);

  const loadArtifacts = useCallback(async () => {
    const result = await window.librarianAPI?.getReadings();
    if (result) setArtifacts(result);
  }, []);

  const loadRecent = useCallback(async () => {
    const result = await window.recentAPI?.list();
    if (result) setRecent(result);
  }, []);

  useEffect(() => {
    loadTree();
    loadArtifacts();
    loadRecent();
    const unsubWiki = window.wikiAPI?.onPageChanged(() => loadTree());
    const unsubAdded = window.librarianAPI?.onReadingAdded(() => loadArtifacts());
    const unsubRemoved = window.librarianAPI?.onReadingRemoved(() => loadArtifacts());
    const unsubUpdated = window.librarianAPI?.onReadingUpdated(() => loadArtifacts());
    // Backstop for missed FSEvents (sleep/wake, bg writes): reload on focus.
    const onFocus = () => {
      loadTree();
      loadArtifacts();
      loadRecent();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      unsubWiki?.();
      unsubAdded?.();
      unsubRemoved?.();
      unsubUpdated?.();
      window.removeEventListener('focus', onFocus);
    };
  }, [loadTree, loadArtifacts, loadRecent]);

  useEffect(() => {
    localStorage.setItem('wiki-expanded-folders', JSON.stringify([...expandedFolders]));
  }, [expandedFolders]);

  useEffect(() => {
    localStorage.setItem('library-sort-mode', sortMode);
  }, [sortMode]);

  const toggleFolder = (name: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const beginCreateFile = useCallback((folder?: string) => {
    const target = folder ?? SCRATCHPAD_FOLDER_NAME;
    // Scratchpad has a default-name flow (today's date) — skip the naming
    // input so quick captures stay one click / shortcut away.
    if (target === SCRATCHPAD_FOLDER_NAME && onCreateScratchpadDefault) {
      void onCreateScratchpadDefault();
      return;
    }
    setExpandedFolders((prev) => {
      if (prev.has(target)) return prev;
      const next = new Set(prev);
      next.add(target);
      return next;
    });
    setCreating({ kind: 'file', folder: target });
    setNewName('');
  }, [onCreateScratchpadDefault]);

  const beginCreateDir = useCallback(() => {
    setCreating({ kind: 'dir' });
    setNewName('');
  }, []);

  useEffect(() => {
    if (!creationControllerRef) return;
    creationControllerRef.current = { beginCreateFile, beginCreateDir };
    return () => { creationControllerRef.current = null; };
  }, [creationControllerRef, beginCreateFile, beginCreateDir]);

  useEffect(() => {
    if (creating) createInputRef.current?.focus();
  }, [creating]);

  const cancelCreate = useCallback(() => {
    setCreating(null);
    setNewName('');
  }, []);

  const submitCreate = useCallback(async () => {
    const name = newName.trim();
    if (!name || !creating) { cancelCreate(); return; }
    if (creating.kind === 'file') await onCreateFile(creating.folder, name);
    else await onCreateDir(name);
    setCreating(null);
    setNewName('');
  }, [newName, creating, onCreateFile, onCreateDir, cancelCreate]);

  const unifiedFolders: UnifiedFolder[] = useMemo(() => {
    const folders: UnifiedFolder[] = [];

    // Artifacts as a virtual folder
    if (artifacts.length > 0) {
      const items: UnifiedItem[] = artifacts.map((r) => ({
        id: `artifact:${r.path}`,
        title: r.title,
        type: 'artifact' as const,
        absPath: r.path,
        timestamp: r.createdAt,
      }));
      if (sortMode === 'alpha') {
        items.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
      }
      folders.push({ name: 'artifacts', label: 'Artifacts', items, canCreateFile: false });
    }

    // Wiki folders
    for (const wf of wikiTree) {
      const items: UnifiedItem[] = wf.files.map((p) => ({
        id: `wiki:${p.relPath}`,
        title: p.title,
        type: 'wiki' as const,
        absPath: p.absPath,
        relPath: p.relPath,
        timestamp: p.lastUpdated,
      }));
      if (sortMode === 'alpha') {
        items.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
      }
      const label = wf.name.charAt(0).toUpperCase() + wf.name.slice(1);
      folders.push({ name: wf.name, label, items, canCreateFile: true });
    }

    folders.sort((a, b) => a.label.localeCompare(b.label));
    return ensureScratchpadPinned(folders);
  }, [wikiTree, artifacts, sortMode]);

  const filteredFolders = useMemo(
    () => filterUnifiedFolders(unifiedFolders, searchQuery),
    [unifiedFolders, searchQuery]
  );

  const flatItems = useMemo(() => filteredFolders.flatMap((f) => f.items), [filteredFolders]);
  if (flatItemsRef) flatItemsRef.current = flatItems;

  const totalPages = unifiedFolders.flatMap((f) => f.items).length;
  const visiblePages = flatItems.length;
  const isSearching = searchQuery.trim().length > 0;

  const emptyWiki = unifiedFolders.length === 0;

  return (
    <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
      <style>{`
        .bm-folder-header:hover .bm-new-file-btn { opacity: 0.7; }
        .bm-new-file-btn:hover { opacity: 1 !important; }
      `}</style>
      {/* Header */}
      <div style={{ padding: '0 12px 4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span style={{ fontSize: '11px', fontWeight: 600, color: theme.textSecondary, letterSpacing: '0.3px' }}>
          Personal wiki
        </span>
        <div style={{ flex: 1 }} />
        {/* Sort toggle */}
        <button
          onClick={() => setSortMode(sortMode === 'alpha' ? 'time' : 'alpha')}
          style={{
            padding: '2px 4px',
            fontSize: '10px',
            color: theme.textSecondary,
            backgroundColor: 'transparent',
            border: 'none',
            cursor: 'pointer',
            borderRadius: '3px',
            display: 'flex',
            alignItems: 'center',
            gap: '3px',
            opacity: 0.7,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.backgroundColor = theme.hoverBg; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.7'; e.currentTarget.style.backgroundColor = 'transparent'; }}
          title={sortMode === 'alpha' ? 'Sort by date' : 'Sort A-Z'}
        >
          {sortMode === 'alpha' ? (
            <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
              <path d="M10.082 5.629 9.664 7H8.598l1.789-5.332h1.234L13.402 7h-1.12l-.419-1.371h-1.781zm1.57-.785L11 2.687h-.047l-.652 2.157h1.351z"/>
              <path d="M12.96 14H9.028v-.691l2.579-3.72v-.054H9.098v-.867h3.785v.691l-2.567 3.72v.054h2.645V14zM4.5 2.5a.5.5 0 0 0-1 0v9.793l-1.146-1.147a.5.5 0 0 0-.708.708l2 2a.5.5 0 0 0 .708 0l2-2a.5.5 0 0 0-.708-.708L4.5 12.293V2.5z"/>
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
              <path d="M3 0a.5.5 0 0 1 .5.5V2h5a.5.5 0 0 1 0 1h-5v1.5a.5.5 0 0 1-1 0v-4A.5.5 0 0 1 3 0z"/>
              <path d="M7.823 2.823l-2.396 2.396A.25.25 0 0 0 5.604 5.5h4.792a.25.25 0 0 0 .177-.427L8.177 2.823a.25.25 0 0 0-.354 0z"/>
              <path d="M4.5 2.5a.5.5 0 0 0-1 0v9.793l-1.146-1.147a.5.5 0 0 0-.708.708l2 2a.5.5 0 0 0 .708 0l2-2a.5.5 0 0 0-.708-.708L4.5 12.293V2.5z"/>
            </svg>
          )}
          <span>{sortMode === 'alpha' ? 'A-Z' : 'Date'}</span>
        </button>
      </div>

      <div style={{ padding: '0 12px 8px' }}>
        <input
          ref={searchInputRef}
          value={searchQuery}
          onChange={(e) => onSearchQueryChange(e.target.value)}
          placeholder="Search library (⌘F)"
          style={{
            width: '100%',
            padding: '7px 10px',
            fontSize: '11px',
            color: theme.text,
            backgroundColor: theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
            border: `1px solid ${theme.border}`,
            borderRadius: '6px',
            outline: 'none',
          }}
        />
      </div>

      {/* Page count */}
      <div style={{ padding: '0 12px 8px', fontSize: '10px', color: theme.textSecondary, opacity: 0.6 }}>
        {isSearching ? `${visiblePages} of ${totalPages} pages` : `${totalPages} pages`}
      </div>

      {/* Bookmarks — pinned leaf above folders */}
      {(!isSearching || 'bookmarks'.includes(searchQuery.trim().toLowerCase())) && (
        <div
          onClick={() =>
            onSelectItem({
              id: BOOKMARKS_ITEM_ID,
              title: 'Bookmarks',
              type: 'bookmarks',
              absPath: '',
              timestamp: 0,
            })
          }
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '6px 12px',
            margin: '0 0 4px',
            cursor: 'pointer',
            fontSize: '12px',
            fontWeight: 500,
            color: theme.text,
            backgroundColor: selectedId === BOOKMARKS_ITEM_ID
              ? (theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)')
              : 'transparent',
            borderLeft: selectedId === BOOKMARKS_ITEM_ID ? `2px solid ${theme.accent}` : '2px solid transparent',
            userSelect: 'none',
          }}
          onMouseEnter={(e) => {
            if (selectedId !== BOOKMARKS_ITEM_ID) e.currentTarget.style.backgroundColor = theme.hoverBg;
          }}
          onMouseLeave={(e) => {
            if (selectedId !== BOOKMARKS_ITEM_ID) e.currentTarget.style.backgroundColor = 'transparent';
          }}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style={{ color: theme.textSecondary, flexShrink: 0 }}>
            <path d="M2 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v13.5a.5.5 0 0 1-.777.416L8 13.101l-5.223 2.815A.5.5 0 0 1 2 15.5V2z" />
          </svg>
          <span>Bookmarks</span>
        </div>
      )}

      {/* Recent block — wiki + external, each with show more/less */}
      {!isSearching && recent.length > 0 && (
        <RecentBlock
          recent={recent}
          expanded={recentExpanded}
          onExpand={setRecentExpanded}
          selectedId={selectedId}
          theme={theme}
          onOpenWiki={(relPath, title, path) =>
            onSelectItem({
              id: `wiki:${relPath}`,
              title,
              type: 'wiki',
              absPath: path,
              relPath,
              timestamp: 0,
            })
          }
          onOpenExternal={(absPath, title) =>
            onSelectItem({
              id: `external:${absPath}`,
              title,
              type: 'external',
              absPath,
              timestamp: 0,
            })
          }
        />
      )}

      {/* Folder tree */}
      {emptyWiki ? (
        <div style={{ padding: '8px 12px', fontSize: '11px', color: theme.textSecondary }}>
          No pages yet. Run <code style={{ fontSize: '10px', background: theme.hoverBg, padding: '1px 4px', borderRadius: '3px' }}>ft sync && ft wiki</code> to generate.
        </div>
      ) : filteredFolders.length === 0 ? (
        <div style={{ padding: '8px 12px', fontSize: '11px', color: theme.textSecondary }}>
          No pages match that search.
        </div>
      ) : filteredFolders.map((folder) => {
        const isExpanded = isSearching || expandedFolders.has(folder.name);
        const dateGroups = sortMode === 'time' ? groupItemsByDate(folder.items) : null;
        return (
          <div key={folder.name}>
            {/* Folder header */}
            <div
              className="bm-folder-header"
              onClick={() => toggleFolder(folder.name)}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = theme.hoverBg)}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 12px',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: 500,
                color: theme.text,
                userSelect: 'none',
              }}
            >
              <svg
                width="8"
                height="8"
                viewBox="0 0 8 8"
                fill="currentColor"
                style={{
                  transition: 'transform 0.15s ease',
                  transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                  flexShrink: 0,
                  color: theme.textSecondary,
                }}
              >
                <path d="M2 1l4 3-4 3V1z" />
              </svg>
              <span>{folder.label}</span>
              <span style={{ color: theme.textSecondary, fontWeight: 400, fontSize: '11px', opacity: 0.5 }}>
                {folder.items.length}
              </span>
              {folder.canCreateFile !== false && (
                <button
                  className="bm-new-file-btn"
                  onClick={(e) => { e.stopPropagation(); beginCreateFile(folder.name); }}
                  title={folder.name === SCRATCHPAD_FOLDER_NAME ? "New scratchpad entry" : "New file"}
                  aria-label={`New file in ${folder.label}`}
                  style={{
                    marginLeft: 'auto',
                    width: '18px',
                    height: '18px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 0,
                    background: 'transparent',
                    border: 'none',
                    borderRadius: '3px',
                    color: theme.textSecondary,
                    cursor: 'pointer',
                    opacity: 0,
                    transition: 'opacity 0.12s ease, background 0.12s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                >
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
                    <path d="M8 3v10M3 8h10" />
                  </svg>
                </button>
              )}
            </div>

            {/* Inline create input — appears just below the folder header so
                the user sees it even before the folder finishes expanding. */}
            {folder.canCreateFile !== false && creating?.kind === 'file' && creating.folder === folder.name && (
              <div style={{ padding: '4px 12px 4px 28px' }}>
                <input
                  ref={createInputRef}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); void submitCreate(); }
                    else if (e.key === 'Escape') { e.preventDefault(); cancelCreate(); }
                  }}
                  onBlur={cancelCreate}
                  placeholder="Untitled"
                  style={{
                    width: '100%',
                    padding: '4px 6px',
                    fontSize: '11px',
                    color: theme.text,
                    backgroundColor: theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                    border: `1px solid ${theme.border}`,
                    borderRadius: '4px',
                    outline: 'none',
                  }}
                />
              </div>
            )}

            {/* Expanded file list */}
            {isExpanded && (
              <div>
                {sortMode === 'time' && dateGroups ? (
                  Array.from(dateGroups.entries()).map(([dateLabel, items]) => (
                    <div key={dateLabel}>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '8px 12px 4px 28px',
                      }}>
                        <span style={{ fontSize: '10px', fontWeight: 600, color: theme.textSecondary, flexShrink: 0, opacity: 0.6 }}>
                          {dateLabel}
                        </span>
                        <div style={{
                          flex: 1,
                          height: '1px',
                          backgroundColor: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
                        }} />
                      </div>
                      {items.map((item) => {
                        const isSel = item.id === selectedId;
                        return (
                          <FileItem
                            key={item.id}
                            item={item}
                            isSelected={isSel}
                            isHovered={item.id === hoveredId}
                            theme={theme}
                            onSelect={() => onSelectItem(item)}
                            onHover={setHoveredId}
                            refProp={isSel ? selectedItemRef : undefined}
                          />
                        );
                      })}
                    </div>
                  ))
                ) : (
                  folder.items.map((item) => {
                    const isSel = item.id === selectedId;
                    return (
                      <FileItem
                        key={item.id}
                        item={item}
                        isSelected={isSel}
                        isHovered={item.id === hoveredId}
                        theme={theme}
                        onSelect={() => onSelectItem(item)}
                        onHover={setHoveredId}
                        refProp={isSel ? selectedItemRef : undefined}
                      />
                    );
                  })
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default memo(WikiSidebar);

function FileItem({ item, isSelected, isHovered, theme, onSelect, onHover, refProp }: {
  item: UnifiedItem;
  isSelected: boolean;
  isHovered: boolean;
  theme: ReturnType<typeof useTheme>['theme'];
  onSelect: () => void;
  onHover: (id: string | null) => void;
  refProp?: MutableRefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      ref={refProp}
      onClick={onSelect}
      onMouseEnter={() => onHover(item.id)}
      onMouseLeave={() => onHover(null)}
      style={{
        padding: '6px 8px 6px 28px',
        cursor: 'pointer',
        backgroundColor: isSelected
          ? (theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)')
          : 'transparent',
        borderLeft: isSelected ? `2px solid ${theme.accent}` : '2px solid transparent',
        transition: 'background-color 0.1s ease',
      }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '4px',
      }}>
        <div style={{
          fontSize: '12px',
          fontWeight: 500,
          color: theme.text,
          lineHeight: 1.3,
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {item.title}
        </div>
        {isHovered && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              window.shellAPI?.showItemInFolder(item.absPath);
            }}
            style={{
              padding: '0',
              width: '16px',
              height: '16px',
              color: theme.textSecondary,
              backgroundColor: 'transparent',
              border: 'none',
              cursor: 'pointer',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '3px',
              opacity: 0.7,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.opacity = '1';
              e.currentTarget.style.backgroundColor = theme.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.opacity = '0.7';
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
            title="Show in Finder"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
              <path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h2.764c.958 0 1.76.56 2.311 1.184C7.985 3.648 8.48 4 9 4h4.5A1.5 1.5 0 0 1 15 5.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12.5v-9zM2.5 3a.5.5 0 0 0-.5.5V6h12v-.5a.5.5 0 0 0-.5-.5H9c-.964 0-1.71-.629-2.174-1.154C6.374 3.334 5.82 3 5.264 3H2.5zM14 7H2v5.5a.5.5 0 0 0 .5.5h11a.5.5 0 0 0 .5-.5V7z" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

interface RecentBlockProps {
  recent: RecentEntry[];
  expanded: 'wiki' | 'external' | null;
  onExpand: (kind: 'wiki' | 'external' | null) => void;
  selectedId: string | null;
  theme: ReturnType<typeof useTheme>['theme'];
  onOpenWiki: (relPath: string, title: string, absPath: string) => void;
  onOpenExternal: (absPath: string, title: string) => void;
}

function RecentBlock({ recent, expanded, onExpand, selectedId, theme, onOpenWiki, onOpenExternal }: RecentBlockProps) {
  const { wiki, wikiTotal, external, externalTotal } = splitRecent(recent, expanded);
  if (wikiTotal === 0 && externalTotal === 0) return null;
  const headerStyle: React.CSSProperties = {
    padding: '6px 12px 2px',
    fontSize: '10px',
    fontWeight: 600,
    color: theme.textSecondary,
    letterSpacing: '0.3px',
    textTransform: 'uppercase',
    opacity: 0.7,
  };
  const itemStyle = (isSelected: boolean): React.CSSProperties => ({
    padding: '5px 12px 5px 20px',
    fontSize: '11.5px',
    cursor: 'pointer',
    color: theme.text,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    userSelect: 'none',
    backgroundColor: isSelected ? (theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)') : 'transparent',
    borderLeft: isSelected ? `2px solid ${theme.accent}` : '2px solid transparent',
  });
  const showMoreStyle: React.CSSProperties = {
    padding: '3px 12px 5px 20px',
    fontSize: '10px',
    color: theme.textSecondary,
    cursor: 'pointer',
    opacity: 0.6,
  };
  return (
    <div style={{ marginBottom: '4px' }}>
      {wikiTotal > 0 && (
        <>
          <div style={headerStyle}>Recent</div>
          {wiki.map((e) => {
            const id = `wiki:${e.path}`;
            return (
              <div
                key={id}
                onClick={() => onOpenWiki(e.path, e.title, e.path)}
                style={itemStyle(selectedId === id)}
                title={e.title}
                onMouseEnter={(el) => { if (selectedId !== id) el.currentTarget.style.backgroundColor = theme.hoverBg; }}
                onMouseLeave={(el) => { if (selectedId !== id) el.currentTarget.style.backgroundColor = 'transparent'; }}
              >
                {e.title}
              </div>
            );
          })}
          {wikiTotal > wiki.length && (
            <div onClick={() => onExpand('wiki')} style={showMoreStyle}>Show more ({wikiTotal - wiki.length})</div>
          )}
          {expanded === 'wiki' && (
            <div onClick={() => onExpand(null)} style={showMoreStyle}>Show less</div>
          )}
        </>
      )}
      {externalTotal > 0 && (
        <>
          <div style={headerStyle}>External</div>
          {external.map((e) => {
            const id = `external:${e.path}`;
            return (
              <div
                key={id}
                onClick={() => onOpenExternal(e.path, e.title)}
                style={itemStyle(selectedId === id)}
                title={e.path}
                onMouseEnter={(el) => { if (selectedId !== id) el.currentTarget.style.backgroundColor = theme.hoverBg; }}
                onMouseLeave={(el) => { if (selectedId !== id) el.currentTarget.style.backgroundColor = 'transparent'; }}
              >
                {e.title}
              </div>
            );
          })}
          {externalTotal > external.length && (
            <div onClick={() => onExpand('external')} style={showMoreStyle}>Show more ({externalTotal - external.length})</div>
          )}
          {expanded === 'external' && (
            <div onClick={() => onExpand(null)} style={showMoreStyle}>Show less</div>
          )}
        </>
      )}
    </div>
  );
}
