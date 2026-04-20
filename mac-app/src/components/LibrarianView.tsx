// =============================================================================
// LibrarianView - iA Writer-style reading experience for collected readings.
// Named after the AI assistant in Snow Crash that provides contextual intel.
// =============================================================================

import { useEffect, useState, useRef, useCallback, useMemo, Fragment } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import ReactMarkdown from 'react-markdown';
import { fonts } from '../design/tokens';
import ContentToolbar from './ContentToolbar';
import LibrarianSetupWizard from './LibrarianSetupWizard';
import WikiSidebar, { BOOKMARKS_ITEM_ID, type UnifiedItem, type WikiCreationController } from './WikiSidebar';
import BookmarksPane from './BookmarksPane';
import { prefetchBookmarks } from '../services/bookmarksCache';
import { FEATURE_NARRATION_ENABLED } from '../featureFlags';

/** Strip YAML frontmatter from wiki page content for display.
 *  Returns the body (everything after the closing ---) and parsed
 *  metadata key-values for a small tag bar. */
export function splitFrontmatter(content: string): { body: string; meta: Record<string, string> } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { body: content, meta: {} };
  const meta: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const m = line.match(/^([a-z_]+):\s*(.*)$/);
    if (m) meta[m[1]] = m[2];
  }
  return { body: match[2].replace(/^\n+/, ''), meta };
}

export const LIBRARIAN_SELECTION_STORAGE_KEY = 'librarian-last-selection';
export const LIBRARIAN_IMMERSIVE_STORAGE_KEY = 'librarian-immersive';

export type LibrarianStoredSelection =
  | { type: 'wiki'; relPath: string }
  | { type: 'artifact'; path: string }
  | { type: 'bookmarks' };

export function restoreLibrarianSelection(storage: Pick<Storage, 'getItem'>): LibrarianStoredSelection | null {
  const raw = storage.getItem(LIBRARIAN_SELECTION_STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (parsed?.type === 'wiki' && typeof parsed.relPath === 'string' && parsed.relPath.trim()) {
      return {
        type: 'wiki',
        relPath: parsed.relPath.trim().replace(/^\/+/, '').replace(/\.md$/i, ''),
      };
    }
    if (parsed?.type === 'artifact' && typeof parsed.path === 'string' && parsed.path.trim()) {
      return {
        type: 'artifact',
        path: parsed.path.trim(),
      };
    }
    if (parsed?.type === 'bookmarks') {
      return { type: 'bookmarks' };
    }
  } catch {
    return null;
  }

  return null;
}

export function persistLibrarianSelection(
  storage: Pick<Storage, 'setItem' | 'removeItem'>,
  selection: LibrarianStoredSelection | null
): void {
  if (!selection) {
    storage.removeItem(LIBRARIAN_SELECTION_STORAGE_KEY);
    return;
  }

  storage.setItem(LIBRARIAN_SELECTION_STORAGE_KEY, JSON.stringify(selection));
}

export function resolveWikiCreateFolder(
  requestedFolderName: string,
  selectedItemType: 'wiki' | 'artifact' | 'bookmarks' | null,
  wikiSelectedRelPath: string | null
): string {
  if (requestedFolderName && requestedFolderName !== 'artifacts') {
    return requestedFolderName;
  }

  if (selectedItemType === 'wiki' && wikiSelectedRelPath?.includes('/')) {
    return wikiSelectedRelPath.split('/')[0];
  }

  return 'entries';
}

interface LibrarianViewProps {
  onSwitchToClipboard: () => void;
  onSwitchToSettings?: () => void;
  onFullScreenChange?: (isFullScreen: boolean) => void;
  externalHeaderHover?: boolean; // Passed from parent when top edge is hovered
  initialReadingPath?: string | null; // Auto-select this reading on mount (for auto-open)
  initialFullScreen?: boolean; // Start in fullscreen/immersive mode (for auto-open)
  onInitialReadingConsumed?: () => void; // Called after initial reading is consumed
  // Path of an artifact the librarian just auto-popped. While the user is
  // still on this artifact, Escape closes the window instead of merely
  // exiting immersive. Call onAutoPopArtifactSuperseded when the user
  // navigates away from it.
  autoPopArtifactPath?: string | null;
  onAutoPopArtifactSuperseded?: () => void;
}

function isArtifactModelSignatureText(text: string): boolean {
  return /^(Model|Signed by):\s+.+$/i.test(text.trim());
}

export default function LibrarianView({ onSwitchToClipboard, onSwitchToSettings, onFullScreenChange, externalHeaderHover, initialReadingPath, initialFullScreen, onInitialReadingConsumed, autoPopArtifactPath, onAutoPopArtifactSuperseded }: LibrarianViewProps) {
  const { theme } = useTheme();
  const restoredSelection = useMemo(() => restoreLibrarianSelection(localStorage), []);

  // State
  // Path is now the identity - no numeric IDs
  const [readings, setReadings] = useState<ReadingMeta[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(() => restoredSelection?.type === 'artifact' ? restoredSelection.path : null);
  const [selectedReading, setSelectedReading] = useState<Reading | null>(null);
  const [loading, setLoading] = useState(true);
  const [setupComplete, setSetupComplete] = useState<boolean | null>(null); // null = loading

  // Edit state
  const [editContent, setEditContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [textSize, setTextSize] = useState<'small' | 'normal' | 'large'>(() => {
    const saved = localStorage.getItem('librarian-text-size');
    return (saved === 'small' || saved === 'normal' || saved === 'large') ? saved : 'normal';
  });
  // Start in fullscreen if initialFullScreen prop is true (auto-open flow)
  const [isFullScreen, setIsFullScreen] = useState(initialFullScreen ?? false);
  // Fire the IPC synchronously so the window animation starts on the click
  // frame instead of after two React-state / useEffect hops.
  const toggleImmersive = () => {
    const next = !isFullScreen;
    window.librarianAPI?.setImmersiveMode?.(next);
    setIsFullScreen(next);
  };
  const [headerHovered, setHeaderHovered] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('librarian-sidebar-width');
    return saved ? parseInt(saved, 10) : 180;
  });
  const [isResizing, setIsResizing] = useState(false);
  const [discoveredDirs, setDiscoveredDirs] = useState<string[]>([]);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [addingDir, setAddingDir] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const flatItemsRef = useRef<import('./WikiSidebar').UnifiedItem[]>([]);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const wikiCreationRef = useRef<WikiCreationController | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    return localStorage.getItem('librarian-sidebar-collapsed') === '1';
  });
  useEffect(() => {
    localStorage.setItem('librarian-sidebar-collapsed', sidebarCollapsed ? '1' : '0');
  }, [sidebarCollapsed]);

  // Sharing state
  const [shareStatus, setShareStatus] = useState<{ shared: boolean; slug?: string; url?: string } | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  // Narration state
  const [narrationStatus, setNarrationStatus] = useState<{
    playbackStatus: 'idle' | 'generating' | 'playing' | 'paused' | 'stopped';
    currentReadingPath: string | null;
  }>({ playbackStatus: 'idle', currentReadingPath: null });
  const [narrationPrefs, setNarrationPrefs] = useState<{
    speakOnOpen: boolean;
    blockedDevices: string[];
  } | null>(null);

  // Mute for today state
  const [isMutedForToday, setIsMutedForToday] = useState(false);
  const [isMuting, setIsMuting] = useState(false);

  // Content mode: 'rendered' shows ReactMarkdown, 'markdown' shows editable raw source
  const [contentMode, setContentMode] = useState<'rendered' | 'markdown'>('rendered');

  const [selectedItemId, setSelectedItemId] = useState<string | null>(() => {
    if (!restoredSelection) return null;
    if (restoredSelection.type === 'wiki') return `wiki:${restoredSelection.relPath}`;
    if (restoredSelection.type === 'artifact') return `artifact:${restoredSelection.path}`;
    return BOOKMARKS_ITEM_ID;
  });
  const [selectedItemType, setSelectedItemType] = useState<'wiki' | 'artifact' | 'bookmarks' | null>(() => restoredSelection?.type ?? null);
  // Lazy keep-alive: once the user has visited Bookmarks, the pane stays mounted
  // (hidden via CSS) so its DOM pool, snapshot cache, scroll/camera state, and
  // search input persist across sidebar switches.
  const [bookmarksEverShown, setBookmarksEverShown] = useState<boolean>(() => restoredSelection?.type === 'bookmarks');
  const [wikiSelectedRelPath, setWikiSelectedRelPath] = useState<string | null>(() => restoredSelection?.type === 'wiki' ? restoredSelection.relPath : null);
  const [wikiSelectedPage, setWikiSelectedPage] = useState<Reading | null>(null);

  const selectArtifactPath = useCallback((artifactPath: string) => {
    setSelectedItemId(`artifact:${artifactPath}`);
    setSelectedItemType('artifact');
    setSelectedPath(artifactPath);
    setWikiSelectedRelPath(null);
  }, []);

  const openWikiPage = useCallback((relPath: string) => {
    const normalized = relPath
      .trim()
      .replace(/^\/+/, '')
      .replace(/\.md$/i, '');
    if (!normalized) return;
    setSelectedItemId(`wiki:${normalized}`);
    setSelectedItemType('wiki');
    setWikiSelectedRelPath(normalized);
    setSelectedPath(null);
  }, []);

  const openWikiHref = useCallback((href: string) => {
    const match = href.match(/^wiki:\/\/(.+)$/i);
    if (!match) return;
    const relPath = decodeURIComponent(match[1].split(/[?#]/, 1)[0] ?? '');
    openWikiPage(relPath);
  }, [openWikiPage]);

  // Handle initial reading path and fullscreen from parent (auto-open flow)
  useEffect(() => {
    if (initialReadingPath) {
      selectArtifactPath(initialReadingPath);
      if (initialFullScreen) {
        setIsFullScreen(true);
      }
      onInitialReadingConsumed?.();
    }
  }, [initialReadingPath, initialFullScreen, onInitialReadingConsumed, selectArtifactPath]);

  // Persist text size preference
  useEffect(() => {
    localStorage.setItem('librarian-text-size', textSize);
  }, [textSize]);

  // Check mute status on mount
  useEffect(() => {
    window.librarianAPI?.isMutedForToday().then((muted) => {
      setIsMutedForToday(muted ?? false);
    });
  }, []);

  // Prefetch bookmarks snapshot in the background so the first click is instant
  useEffect(() => { prefetchBookmarks(); }, []);

  // Persist sidebar width
  useEffect(() => {
    localStorage.setItem('librarian-sidebar-width', String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    if (selectedItemType === 'bookmarks' && !bookmarksEverShown) {
      setBookmarksEverShown(true);
    }
  }, [selectedItemType, bookmarksEverShown]);

  useEffect(() => {
    if (selectedItemType === 'wiki' && wikiSelectedRelPath) {
      persistLibrarianSelection(localStorage, { type: 'wiki', relPath: wikiSelectedRelPath });
      return;
    }
    if (selectedItemType === 'artifact' && selectedPath) {
      persistLibrarianSelection(localStorage, { type: 'artifact', path: selectedPath });
      return;
    }
    if (selectedItemType === 'bookmarks') {
      persistLibrarianSelection(localStorage, { type: 'bookmarks' });
      return;
    }
    if (selectedPath) {
      persistLibrarianSelection(localStorage, { type: 'artifact', path: selectedPath });
      return;
    }
    persistLibrarianSelection(localStorage, null);
  }, [selectedItemType, selectedPath, wikiSelectedRelPath]);

  // Handle resize drag
  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const containerRect = containerRef.current?.getBoundingClientRect();
      if (!containerRect) return;

      const newWidth = e.clientX - containerRect.left;
      // Clamp between 120px and 400px
      setSidebarWidth(Math.max(120, Math.min(400, newWidth)));
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  // Notify parent of full-screen state (including initial state on mount)
  useEffect(() => {
    onFullScreenChange?.(isFullScreen);
  }, [isFullScreen, onFullScreenChange]);

  // Bookmarks immersive dismisses on blur (panel-like); artifact/wiki immersive
  // stays put so users can reference other apps while reading.
  useEffect(() => {
    const dismissable = isFullScreen && selectedItemType === 'bookmarks';
    window.librarianAPI?.setImmersiveDismissable?.(dismissable);
    return () => window.librarianAPI?.setImmersiveDismissable?.(false);
  }, [isFullScreen, selectedItemType]);

  // Push 'library' size-key for every librarian section (wikis, artifacts,
  // bookmarks). Bookmarks list/canvas modes share this size so toggling
  // between them no longer triggers a 150ms window animation + repaint.
  useEffect(() => {
    window.librarianAPI?.setSizeKey?.('library');
  }, [selectedItemType]);

  // Initialize narration state and subscribe to events (feature flagged)
  useEffect(() => {
    if (!FEATURE_NARRATION_ENABLED) return;

    // Load initial narration status
    window.narrationAPI?.getStatus().then((status) => {
      if (status) {
        setNarrationStatus({
          playbackStatus: status.playbackStatus,
          currentReadingPath: status.currentReadingPath,
        });
      }
    });

    // Load narration preferences
    window.narrationAPI?.getPrefs().then((prefs) => {
      if (prefs) {
        setNarrationPrefs({
          speakOnOpen: prefs.speakOnOpen,
          blockedDevices: prefs.blockedDevices,
        });
      }
    });

    // Subscribe to playback events
    const unsubGenerating = window.narrationAPI?.onGenerationStarted?.((readingPath) => {
      setNarrationStatus({ playbackStatus: 'generating', currentReadingPath: readingPath });
    });

    const unsubStarted = window.narrationAPI?.onPlaybackStarted((readingPath) => {
      setNarrationStatus({ playbackStatus: 'playing', currentReadingPath: readingPath });
    });

    const unsubStopped = window.narrationAPI?.onPlaybackStopped(() => {
      setNarrationStatus({ playbackStatus: 'idle', currentReadingPath: null });
    });

    const unsubError = window.narrationAPI?.onPlaybackError(() => {
      setNarrationStatus({ playbackStatus: 'idle', currentReadingPath: null });
    });

    return () => {
      unsubGenerating?.();
      unsubStarted?.();
      unsubStopped?.();
      unsubError?.();
    };
  }, []);

  // Text size values
  const textSizes = {
    small: { base: '14px', h1: '24px', h2: '18px', h3: '15px' },
    normal: { base: '16px', h1: '28px', h2: '20px', h3: '17px' },
    large: { base: '18px', h1: '32px', h2: '24px', h3: '20px' },
  };

  
  const activeReading: Reading | null = selectedItemType === 'wiki' ? wikiSelectedPage : selectedReading;

  const wikiDisplay = useMemo(() => {
    if (selectedItemType !== 'wiki' || !activeReading) return null;
    return splitFrontmatter(activeReading.content);
  }, [selectedItemType, activeReading]);

  const displayContent = wikiDisplay ? wikiDisplay.body : (activeReading?.content ?? '');

  // isDirty: in markdown mode, check if editContent differs from source
  const isDirty = contentMode === 'markdown' && editContent !== (activeReading?.content ?? '');

  // Enter markdown edit mode
  const enterEditMode = useCallback(() => {
    if (activeReading) {
      setEditContent(activeReading.content);
      setContentMode('markdown');
    }
  }, [activeReading]);

  // Exit edit mode (switch back to rendered)
  const exitEditMode = useCallback(() => {
    setContentMode('rendered');
    setEditContent('');
  }, []);

  // Save changes
  const saveChanges = useCallback(async () => {
    if (!activeReading || !isDirty) return;

    setIsSaving(true);
    try {
      let success = false;
      if (selectedItemType === 'wiki' && wikiSelectedRelPath) {
        success = (await window.wikiAPI?.save(wikiSelectedRelPath, editContent)) ?? false;
        if (success) {
          const page = await window.wikiAPI?.getPage(wikiSelectedRelPath);
          if (page) {
            setWikiSelectedPage({ path: page.absPath, title: page.title, content: page.content, context: null, readingTime: null, modelSignature: null, createdAt: page.lastUpdated, mtime: page.lastUpdated });
          }
        }
      } else {
        success = (await window.librarianAPI?.saveReading(activeReading.path, editContent)) ?? false;
        if (success && selectedReading) {
          const updated = await window.librarianAPI?.getReading(selectedReading.path);
          if (updated) {
            setSelectedReading(updated);
            if (shareStatus?.shared) {
              await window.librarianAPI?.updateSharedReading(selectedReading.path, editContent, updated.title);
            }
          }
        }
      }
      if (success) {
        setEditContent(editContent);
      }
    } finally {
      setIsSaving(false);
    }
  }, [activeReading, editContent, isDirty, selectedItemType, wikiSelectedRelPath, selectedReading, shareStatus?.shared]);

  // Create new wiki file. Name comes from the sidebar's inline input because
  // Electron silently disables window.prompt().
  const handleCreateFile = useCallback(async (folderName: string, fileName: string) => {
    if (!fileName.trim()) return;
    const realFolder = resolveWikiCreateFolder(folderName, selectedItemType, wikiSelectedRelPath);
    const page = await window.wikiAPI?.createFile(realFolder, fileName.trim());
    if (page) {
      openWikiPage(page.relPath);
      setContentMode('markdown');
    }
  }, [openWikiPage, selectedItemType, wikiSelectedRelPath]);

  // Create new wiki directory
  const handleCreateDir = useCallback(async (dirName: string) => {
    if (!dirName.trim()) return;
    await window.wikiAPI?.createDir(dirName.trim());
  }, []);

  // Unified item selection handler
  // True while the currently-selected item is the artifact the librarian
  // just auto-popped. Escape should close the window in that case.
  const isOnAutoPopArtifact =
    !!autoPopArtifactPath &&
    selectedItemType === 'artifact' &&
    selectedPath === autoPopArtifactPath;

  const handleSelectItem = useCallback((item: UnifiedItem) => {
    if (isDirty) {
      const confirmed = window.confirm('You have unsaved changes. Discard them?');
      if (!confirmed) return;
      exitEditMode();
    }
    if (item.type === 'wiki' && item.relPath) {
      openWikiPage(item.relPath);
    } else if (item.type === 'artifact') {
      selectArtifactPath(item.absPath);
    } else if (item.type === 'bookmarks') {
      setSelectedItemId(BOOKMARKS_ITEM_ID);
      setSelectedItemType('bookmarks');
      setSelectedPath(null);
      setWikiSelectedRelPath(null);
    }
    setContentMode('rendered');
    // Any navigation other than reselecting the same auto-popped artifact
    // dismisses the auto-pop exception.
    const stayingOnAutoPop = item.type === 'artifact' && item.absPath === autoPopArtifactPath;
    if (autoPopArtifactPath && !stayingOnAutoPop) {
      onAutoPopArtifactSuperseded?.();
    }
  }, [isDirty, exitEditMode, openWikiPage, selectArtifactPath, autoPopArtifactPath, onAutoPopArtifactSuperseded]);

  // Sync editContent when entering markdown mode
  useEffect(() => {
    if (contentMode === 'markdown' && activeReading) {
      setEditContent(activeReading.content);
    }
  }, [contentMode, activeReading]);

  // Handle share/unshare
  const handleShare = useCallback(async () => {
    if (!selectedPath || !selectedReading) return;

    setIsSharing(true);
    try {
      if (shareStatus?.shared) {
        // Unshare
        const success = await Promise.race([
          window.librarianAPI?.unshareReading(selectedPath),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 15000)),
        ]);
        if (success) {
          setShareStatus({ shared: false });
        }
      } else {
        // Share
        const result = await Promise.race([
          window.librarianAPI?.shareReading(selectedPath),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 15000)),
        ]);
        if (result) {
          setShareStatus({ shared: true, slug: result.slug, url: result.url });
        } else {
          console.warn('[Librarian] Share failed or timed out');
        }
      }
    } catch (err) {
      console.error('[Librarian] Share error:', err);
    } finally {
      setIsSharing(false);
    }
  }, [selectedPath, selectedReading, shareStatus?.shared]);

  // Copy share link
  const copyShareLink = useCallback(async () => {
    if (!shareStatus?.url) return;
    await navigator.clipboard.writeText(shareStatus.url);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  }, [shareStatus?.url]);

  // Delete current artifact
  const handleDelete = useCallback(async () => {
    if (!selectedPath || !selectedReading) return;

    const confirmed = window.confirm(`Delete "${selectedReading.title}"? This cannot be undone.`);
    if (!confirmed) return;

    // If shared, unshare first
    if (shareStatus?.shared) {
      await window.librarianAPI?.unshareReading(selectedPath);
    }

    // Delete the file
    const success = await window.librarianAPI?.deleteReading(selectedPath);
    if (success) {
      // The onReadingRemoved listener will handle updating state and selecting next item
    }
  }, [selectedPath, selectedReading, shareStatus?.shared]);

  // Play narration for current reading
  const handlePlayNarration = useCallback(async () => {
    if (!selectedPath) return;
    await window.narrationAPI?.playReading(selectedPath);
  }, [selectedPath]);

  // Stop narration
  const handleStopNarration = useCallback(async () => {
    await window.narrationAPI?.stop();
  }, []);

  // Check if current reading is being narrated
  const isNarrating = !!(selectedPath && narrationStatus.currentReadingPath === selectedPath);
  const isGenerating = narrationStatus.playbackStatus === 'generating' && isNarrating;
  const isPlaying = narrationStatus.playbackStatus === 'playing' && isNarrating;


  useEffect(() => {
    if (!wikiSelectedRelPath) { setWikiSelectedPage(null); return; }
    (async () => {
      const page = await window.wikiAPI?.getPage(wikiSelectedRelPath);
      if (page) {
        setWikiSelectedPage({ path: page.absPath, title: page.title, content: page.content, context: null, readingTime: null, modelSignature: null, createdAt: page.lastUpdated, mtime: page.lastUpdated });
      }
    })();
  }, [wikiSelectedRelPath]);

  // Load readings on mount and check setup completion
  useEffect(() => {
    async function loadReadings() {
      // Check if setup wizard is complete
      const isComplete = await window.librarianAPI?.isSetupComplete();
      setSetupComplete(isComplete ?? true); // Default to true for backwards compatibility

      // Load readings
      const result = await window.librarianAPI?.getReadings();
      if (result) {
        setReadings(result);
        const preferredArtifactPath =
          initialReadingPath ??
          (restoredSelection?.type === 'artifact' ? restoredSelection.path : null);

        if (preferredArtifactPath && result.some((reading) => reading.path === preferredArtifactPath)) {
          selectArtifactPath(preferredArtifactPath);
        } else if (result.length > 0 && !restoredSelection) {
          // Only default to the first artifact on a fresh session. Any
          // restoredSelection (wiki, bookmarks, or an artifact that's since
          // been deleted) takes precedence and should not be clobbered.
          selectArtifactPath(result[0].path);
        }
      }
      setLoading(false);
    }
    loadReadings();
  }, [initialReadingPath, restoredSelection, selectArtifactPath]);

  // Handle setup wizard completion
  const handleSetupComplete = useCallback(async () => {
    setSetupComplete(true);
    // Reload readings to show the new welcome artifact
    const result = await window.librarianAPI?.getReadings();
    if (result) {
      setReadings(result);
      if (result.length > 0) {
        selectArtifactPath(result[0].path);
      }
    }
  }, [selectArtifactPath]);

  // Load selected reading content
  useEffect(() => {
    async function loadReading() {
      if (selectedPath === null) {
        setSelectedReading(null);
        return;
      }
      const result = await window.librarianAPI?.getReading(selectedPath);
      setSelectedReading(result || null);
    }
    loadReading();
  }, [selectedPath]);

  // Load share status when reading changes
  useEffect(() => {
    async function loadShareStatus() {
      if (!selectedPath) {
        setShareStatus(null);
        return;
      }
      const status = await window.librarianAPI?.getShareStatus(selectedPath);
      setShareStatus(status || null);
    }
    loadShareStatus();
  }, [selectedPath]);

  // Listen for new readings
  useEffect(() => {
    const unsubscribe = window.librarianAPI?.onReadingAdded((reading) => {
      setReadings((prev) => [
        {
          path: reading.path,
          title: reading.title,
          context: reading.context,
          readingTime: reading.readingTime,
          modelSignature: reading.modelSignature,
          createdAt: reading.createdAt,
          mtime: reading.mtime,
        },
        ...prev,
      ]);
      // Auto-select the new reading
      selectArtifactPath(reading.path);
    });

    return () => unsubscribe?.();
  }, [selectArtifactPath]);

  // Listen for reading updates (file content changed)
  useEffect(() => {
    const unsubscribe = window.librarianAPI?.onReadingUpdated((reading) => {
      setReadings((prev) =>
        prev.map((r) => (r.path === reading.path ? reading : r))
      );
      // Reload content if this is the selected reading
      if (selectedPath === reading.path) {
        window.librarianAPI?.getReading(reading.path).then((result) => {
          setSelectedReading(result || null);
        });
      }
    });

    return () => unsubscribe?.();
  }, [selectedPath]);

  // Listen for reading removals (file deleted)
  useEffect(() => {
    const unsubscribe = window.librarianAPI?.onReadingRemoved((filePath) => {
      setReadings((prev) => {
        const newReadings = prev.filter((r) => r.path !== filePath);
        // If removed reading was selected, select next one
        if (selectedPath === filePath && newReadings.length > 0) {
          const currentIndex = prev.findIndex((r) => r.path === filePath);
          const newIndex = Math.min(currentIndex, newReadings.length - 1);
          selectArtifactPath(newReadings[newIndex].path);
        } else if (selectedPath === filePath) {
          setSelectedPath(null);
          setSelectedItemId(null);
          setSelectedItemType(null);
        }
        return newReadings;
      });
    });

    return () => unsubscribe?.();
  }, [selectedPath, selectArtifactPath]);

  // Listen for fullscreen requests from URL scheme
  useEffect(() => {
    const unsubscribe = window.librarianAPI?.onSetFullscreen((fullscreen) => {
      setIsFullScreen(fullscreen);
    });

    return () => unsubscribe?.();
  }, []);

  // Keyboard navigation
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Cmd+E - toggle between rendered and markdown
      if (e.key === 'e' && e.metaKey && !e.shiftKey) {
        e.preventDefault();
        if (contentMode === 'markdown') {
          if (isDirty) {
            const confirmed = window.confirm('You have unsaved changes. Discard them?');
            if (!confirmed) return;
          }
          exitEditMode();
        } else if (activeReading) {
          enterEditMode();
        }
        return;
      }

      // Cmd+S - save while in markdown mode
      if (e.key === 's' && e.metaKey && contentMode === 'markdown') {
        e.preventDefault();
        saveChanges();
        return;
      }

      // Cmd+F - focus library search
      if (e.key === 'f' && e.metaKey && contentMode !== 'markdown') {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }

      // Cmd+C - copy file path (when not in textarea)
      if (e.key === 'c' && e.metaKey && !e.shiftKey && contentMode !== 'markdown') {
        if (activeReading?.path) {
          e.preventDefault();
          navigator.clipboard.writeText(activeReading.path);
          return;
        }
      }

      // Cmd+N - create new file (inline input in sidebar)
      if (e.key === 'n' && e.metaKey && !e.shiftKey) {
        e.preventDefault();
        const folder = selectedItemType === 'wiki'
          ? resolveWikiCreateFolder('', selectedItemType, wikiSelectedRelPath)
          : undefined;
        wikiCreationRef.current?.beginCreateFile(folder);
        return;
      }

      // Cmd+Shift+N - create new directory (inline input in sidebar)
      if (e.key === 'n' && e.metaKey && e.shiftKey) {
        e.preventDefault();
        wikiCreationRef.current?.beginCreateDir();
        return;
      }

      // Cmd/Ctrl + = (plus) - increase text size
      if ((e.key === '=' || e.key === '+') && e.metaKey) {
        e.preventDefault();
        setTextSize((prev) => {
          if (prev === 'small') return 'normal';
          if (prev === 'normal') return 'large';
          return 'large'; // Already at max
        });
        return;
      }

      // Cmd/Ctrl + - (minus) - decrease text size
      if (e.key === '-' && e.metaKey) {
        e.preventDefault();
        setTextSize((prev) => {
          if (prev === 'large') return 'normal';
          if (prev === 'normal') return 'small';
          return 'small'; // Already at min
        });
        return;
      }

      // Toggle immersive/fullscreen mode with 'f' (not in markdown mode)
      if (e.key === 'f' && !e.metaKey && !e.ctrlKey && contentMode !== 'markdown') {
        e.preventDefault();
        setIsFullScreen((prev) => !prev);
        return;
      }

      // Cmd+W - close window (same as red close button)
      if (e.key === 'w' && e.metaKey) {
        e.preventDefault();
        if (contentMode === 'markdown' && isDirty) {
          const confirmed = window.confirm('You have unsaved changes. Discard them?');
          if (!confirmed) return;
        }
        window.clipboardAPI?.closeWindow();
        return;
      }

      // Escape hierarchy: edit-mode → auto-popped artifact → immersive-exit → close window.
      // The auto-pop exception preserves the "dismiss window to go back to what
      // you were doing" feel when the librarian interrupts you with a new artifact.
      if (e.key === 'Escape') {
        if (contentMode === 'markdown') {
          if (isDirty) {
            const confirmed = window.confirm('You have unsaved changes. Discard them?');
            if (!confirmed) return;
          }
          exitEditMode();
        } else if (isFullScreen && isOnAutoPopArtifact) {
          window.clipboardAPI?.closeWindow();
        } else if (isFullScreen) {
          setIsFullScreen(false);
        } else {
          window.clipboardAPI?.closeWindow();
        }
        return;
      }

      if (document.activeElement === searchInputRef.current) {
        if (e.key === 'Escape') {
          e.preventDefault();
          searchInputRef.current?.blur();
        }
        return;
      }

      // Don't handle navigation keys in markdown mode (textarea needs them)
      if (contentMode === 'markdown') return;

      // Arrow key / j/k navigation through flat item list
      const items = flatItemsRef.current;
      if (items.length > 0) {
        const currentIdx = items.findIndex((i) => i.id === selectedItemId);
        if (e.key === 'ArrowUp' || e.key === 'k') {
          e.preventDefault();
          const newIdx = Math.max(0, currentIdx - 1);
          handleSelectItem(items[newIdx]);
        } else if (e.key === 'ArrowDown' || e.key === 'j') {
          e.preventDefault();
          const newIdx = Math.min(items.length - 1, currentIdx + 1);
          handleSelectItem(items[newIdx]);
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [readings, selectedPath, isFullScreen, contentMode, isDirty, activeReading, onSwitchToClipboard, enterEditMode, exitEditMode, saveChanges, handleCreateFile, handleCreateDir, selectedItemId, handleSelectItem, isOnAutoPopArtifact]);

  // Focus container on mount
  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  // Listen for show reading requests (auto-show on new reading)
  // Note: fullscreen state is controlled separately by onSetFullscreen, not here
  useEffect(() => {
    const unsubscribe = window.librarianAPI?.onShowReading((readingPath) => {
      selectArtifactPath(readingPath);
    });

    return () => unsubscribe?.();
  }, [selectArtifactPath]);

  // Listen for wiki:openPage requests from fieldtheory://wiki/open URL scheme
  useEffect(() => {
    const unsubscribe = window.wikiAPI?.onOpenWikiPage((relPath) => {
      openWikiPage(relPath);
    });

    return () => unsubscribe?.();
  }, [openWikiPage]);

  // Discover existing .librarian directories on empty state
  useEffect(() => {
    if (!loading && readings.length === 0 && discoveredDirs.length === 0 && !isDiscovering) {
      setIsDiscovering(true);
      window.librarianAPI?.discoverLibrarianDirs().then((dirs) => {
        setDiscoveredDirs(dirs);
        setIsDiscovering(false);
      });
    }
  }, [loading, readings.length, discoveredDirs.length, isDiscovering]);

  // Helper to format path for display (show project name from path)
  const formatDirPath = (dirPath: string): { projectName: string; location: string } => {
    // Remove .librarian suffix and get parent (project) directory
    const projectPath = dirPath.replace(/\/.librarian$/, '');
    const parts = projectPath.split('/');
    const projectName = parts[parts.length - 1];
    // Show abbreviated parent path
    const parentPath = parts.slice(0, -1).join('/').replace(/^\/Users\/[^/]+/, '~');
    return { projectName, location: parentPath };
  };

  // Add a discovered directory
  const handleAddDiscoveredDir = async (dirPath: string) => {
    setAddingDir(dirPath);
    try {
      const result = await window.librarianAPI?.addWatchedDir(dirPath);
      if (result) {
        // Remove from discovered list and reload readings
        setDiscoveredDirs((prev) => prev.filter((d) => d !== dirPath));
        const newReadings = await window.librarianAPI?.getReadings();
        if (newReadings) {
          setReadings(newReadings);
          if (newReadings.length > 0) {
            selectArtifactPath(newReadings[0].path);
          }
        }
      }
    } finally {
      setAddingDir(null);
    }
  };

  // Add all discovered directories
  const handleAddAllDiscoveredDirs = async () => {
    for (const dirPath of discoveredDirs) {
      await window.librarianAPI?.addWatchedDir(dirPath);
    }
    setDiscoveredDirs([]);
    const newReadings = await window.librarianAPI?.getReadings();
    if (newReadings) {
      setReadings(newReadings);
      if (newReadings.length > 0) {
        selectArtifactPath(newReadings[0].path);
      }
    }
  };

  // Setup wizard - shown on first visit
  if (!loading && setupComplete === false) {
    return <LibrarianSetupWizard onComplete={handleSetupComplete} />;
  }

  // Empty state
  if (!loading && readings.length === 0) {
    return (
      <div
        ref={containerRef}
        tabIndex={0}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          padding: '32px',
          color: theme.textSecondary,
          textAlign: 'center',
          outline: 'none',
        }}
      >
        <div style={{ fontSize: '32px', marginBottom: '16px' }}>
          {theme.isDark ? '📚' : '📖'}
        </div>
        <div style={{ fontSize: '16px', fontWeight: 500, marginBottom: '8px', color: theme.text }}>
          No artifacts yet
        </div>

        {/* Show discovered directories if any */}
        {discoveredDirs.length > 0 ? (
          <>
            <div style={{ fontSize: '13px', marginBottom: '16px', maxWidth: '320px' }}>
              Found {discoveredDirs.length} existing reading{discoveredDirs.length === 1 ? '' : 's'} collection{discoveredDirs.length === 1 ? '' : 's'}:
            </div>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                marginBottom: '16px',
                maxWidth: '400px',
                width: '100%',
              }}
            >
              {discoveredDirs.map((dirPath) => {
                const { projectName, location } = formatDirPath(dirPath);
                const isAdding = addingDir === dirPath;
                return (
                  <div
                    key={dirPath}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      padding: '10px 14px',
                      backgroundColor: theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
                      borderRadius: '8px',
                      textAlign: 'left',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 500, color: theme.text, fontSize: '13px' }}>
                        {projectName}
                      </div>
                      <div
                        style={{
                          fontSize: '11px',
                          color: theme.textSecondary,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {location}
                      </div>
                    </div>
                    <button
                      onClick={() => handleAddDiscoveredDir(dirPath)}
                      disabled={isAdding}
                      style={{
                        padding: '4px 12px',
                        fontSize: '12px',
                        fontWeight: 500,
                        color: 'white',
                        backgroundColor: theme.accent,
                        border: 'none',
                        borderRadius: '4px',
                        cursor: isAdding ? 'default' : 'pointer',
                        opacity: isAdding ? 0.6 : 1,
                        flexShrink: 0,
                      }}
                    >
                      {isAdding ? 'Adding...' : 'Add'}
                    </button>
                  </div>
                );
              })}
            </div>
            {discoveredDirs.length > 1 && (
              <button
                onClick={handleAddAllDiscoveredDirs}
                style={{
                  padding: '8px 16px',
                  fontSize: '13px',
                  fontWeight: 500,
                  color: 'white',
                  backgroundColor: theme.accent,
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  marginBottom: '16px',
                }}
              >
                Add All
              </button>
            )}
            <div
              style={{
                fontSize: '11px',
                color: theme.textSecondary,
                marginTop: '8px',
              }}
            >
              Or{' '}
              <button
                onClick={onSwitchToSettings}
                style={{
                  background: 'none',
                  border: 'none',
                  color: theme.accent,
                  cursor: 'pointer',
                  fontSize: '11px',
                  textDecoration: 'underline',
                  padding: 0,
                }}
              >
                open Settings
              </button>{' '}
              to add a new directory
            </div>
          </>
        ) : isDiscovering ? (
          <div style={{ fontSize: '13px', marginBottom: '24px', color: theme.textSecondary }}>
            Searching for existing artifacts...
          </div>
        ) : (
          <>
          <div style={{ fontSize: '13px', marginBottom: '24px', maxWidth: '280px' }}>
              Add a watched directory in Settings to start collecting artifacts from your coding sessions.
            </div>
            {onSwitchToSettings && (
              <button
                onClick={onSwitchToSettings}
                style={{
                  padding: '8px 16px',
                  fontSize: '13px',
                  fontWeight: 500,
                  color: 'white',
                  backgroundColor: theme.accent,
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                }}
              >
                Open Settings
              </button>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      style={{
        display: 'flex',
        flex: 1,
        minHeight: 0,
        outline: 'none',
        position: 'relative',
        backgroundColor: theme.bg,
      }}
    >
      {/* Sidebar - hidden in full-screen mode but kept in DOM for instant collapse */}
      <div
        style={{
          width: sidebarCollapsed ? '0px' : `${sidebarWidth}px`,
          minWidth: sidebarCollapsed ? '0px' : `${sidebarWidth}px`,
          display: isFullScreen ? 'none' : 'flex',
          flexDirection: 'column',
          padding: sidebarCollapsed ? '0' : '12px 0',
          overflow: 'hidden',
          userSelect: isResizing ? 'none' : 'auto',
          transition: 'width 0.18s ease, min-width 0.18s ease, padding 0.18s ease',
        }}
      >
        <WikiSidebar
          selectedId={selectedItemId}
          onSelectItem={handleSelectItem}
          onCreateFile={handleCreateFile}
          onCreateDir={handleCreateDir}
          flatItemsRef={flatItemsRef}
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          searchInputRef={searchInputRef}
          creationControllerRef={wikiCreationRef}
        />
      </div>
      {/* Sidebar toggle — floats at the sidebar/reader boundary. */}
      {!isFullScreen && (
        <button
          onClick={() => setSidebarCollapsed((v) => !v)}
          title={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
          aria-label={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
          style={{
            position: 'absolute',
            top: '12px',
            left: sidebarCollapsed ? '8px' : `${sidebarWidth - 12}px`,
            zIndex: 3,
            width: '22px',
            height: '22px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
            background: theme.bg,
            color: theme.textSecondary,
            border: `1px solid ${theme.border}`,
            borderRadius: '4px',
            cursor: 'pointer',
            transition: 'left 0.18s ease, background 0.15s ease',
          }}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ transform: sidebarCollapsed ? 'rotate(180deg)' : 'none' }}
          >
            <path d="M10 4L6 8l4 4" />
          </svg>
        </button>
      )}
      {/* Resize handle - hidden in full-screen mode but kept in DOM */}
      <div
        onMouseDown={handleResizeMouseDown}
        style={{
          width: '4px',
          cursor: 'col-resize',
          backgroundColor: isResizing ? theme.accent : 'transparent',
          borderRight: `1px solid ${theme.border}`,
          transition: 'background-color 0.15s ease',
          flexShrink: 0,
          display: isFullScreen || sidebarCollapsed ? 'none' : 'block',
        }}
        onMouseEnter={(e) => {
          if (!isResizing) {
            e.currentTarget.style.backgroundColor = theme.isDark
              ? 'rgba(255,255,255,0.1)'
              : 'rgba(0,0,0,0.05)';
          }
        }}
        onMouseLeave={(e) => {
          if (!isResizing) {
            e.currentTarget.style.backgroundColor = 'transparent';
          }
        }}
      />

      {/* Reader pane */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          minHeight: 0, // Required for flex child to shrink below content size
        }}
      >
        {bookmarksEverShown && (
          <div
            style={{
              flex: 1,
              display: selectedItemType === 'bookmarks' ? 'flex' : 'none',
              flexDirection: 'column',
              minHeight: 0,
            }}
          >
            <BookmarksPane
              isFullScreen={isFullScreen}
              onToggleFullScreen={toggleImmersive}
            />
          </div>
        )}
        {selectedItemType !== 'bookmarks' && (<Fragment>
        {/* Top draggable region - captures clicks at very top of frameless window */}
        <div
          onMouseEnter={() => isFullScreen && setHeaderHovered(true)}
          onMouseLeave={() => isFullScreen && setHeaderHovered(false)}
          style={{
            height: isFullScreen ? '20px' : '0px',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
            // @ts-ignore - webkit vendor prefix for Electron draggable region
            WebkitAppRegion: 'drag',
            cursor: 'grab',
          }}
        >
          {/* Drag handle indicator - only visible in immersive mode */}
          {isFullScreen && (
            <div
              style={{
                width: '36px',
                height: '4px',
                borderRadius: '2px',
                backgroundColor: theme.isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)',
              }}
            />
          )}
        </div>

        {/* Toolbar - includes draggable region for window movement */}
        {activeReading && (
          <div
            onMouseEnter={() => isFullScreen && setHeaderHovered(true)}
            onMouseLeave={() => isFullScreen && setHeaderHovered(false)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: isFullScreen ? '8px 16px 4px 16px' : '8px 20px',
              backgroundColor: theme.bg,
              flexShrink: 0,
            }}
          >
            {/* Inner container - always matches reading content width (600px centered) */}
            <div
              style={{
                maxWidth: '600px',
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              {/* Nav: back (fullscreen), copy path */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '2px', marginRight: '8px' }}>
                {isFullScreen && (
                  <button
                    onClick={() => setIsFullScreen(false)}
                    style={{ padding: '3px 6px', fontSize: '11px', color: theme.textSecondary, backgroundColor: 'transparent', border: 'none', cursor: 'pointer', borderRadius: '4px' }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = theme.hoverBg)}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                    title="Back to standard view"
                  >←</button>
                )}
                <button
                  onClick={() => {
                    if (activeReading?.path) {
                      navigator.clipboard.writeText(activeReading.path);
                    }
                  }}
                  style={{ padding: '3px 6px', fontSize: '10px', color: theme.textSecondary, backgroundColor: 'transparent', border: 'none', cursor: 'pointer', borderRadius: '4px', fontFamily: 'system-ui, sans-serif' }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = theme.hoverBg)}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  title="Copy file path (⌘C)"
                >⌘C</button>
              </div>
              <ContentToolbar
                filePath={activeReading?.path || undefined}
                isFullScreen={isFullScreen}
                onToggleFullScreen={toggleImmersive}
                textSize={textSize}
                onTextSizeChange={setTextSize}
                showTextSize={true}
                isEditing={contentMode === 'markdown'}
                isDirty={isDirty}
                isSaving={isSaving}
                onEdit={enterEditMode}
                onSave={saveChanges}
                onCancel={() => {
                  if (isDirty) {
                    const confirmed = window.confirm('Discard changes?');
                    if (!confirmed) return;
                  }
                  exitEditMode();
                }}
                onDelete={handleDelete}
                showDelete={true}
                onShowInFolder={() => activeReading?.path && window.shellAPI?.showItemInFolder(activeReading.path)}
                showFolder={true}
                onCopy={shareStatus?.shared ? copyShareLink : undefined}
                showCopy={!!shareStatus?.shared}
                shareStatus={shareStatus}
                isSharing={isSharing}
                onToggleShare={handleShare}
                showShare={true}
                headerHovered={headerHovered}
              />

              {/* Narration Play/Stop button (feature flagged) */}
              {FEATURE_NARRATION_ENABLED && selectedReading && contentMode !== 'markdown' && (
                <button
                  onClick={isPlaying || isGenerating ? handleStopNarration : handlePlayNarration}
                  disabled={isGenerating}
                  style={{
                    padding: '4px 8px',
                    fontSize: '13px',
                    color: isPlaying ? '#8b5cf6' : theme.textSecondary,
                    backgroundColor: isPlaying
                      ? (theme.isDark ? 'rgba(139, 92, 246, 0.15)' : 'rgba(139, 92, 246, 0.1)')
                      : 'transparent',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: isGenerating ? 'wait' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    transition: 'background-color 0.15s ease, color 0.15s ease',
                    opacity: isFullScreen && !headerHovered ? 0 : 1,
                  }}
                  onMouseEnter={(e) => {
                    if (!isPlaying && !isGenerating) {
                      e.currentTarget.style.backgroundColor = theme.isDark
                        ? 'rgba(255,255,255,0.08)'
                        : 'rgba(0,0,0,0.05)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isPlaying) {
                      e.currentTarget.style.backgroundColor = 'transparent';
                    }
                  }}
                  title={isPlaying ? 'Stop narration' : isGenerating ? 'Generating...' : 'Listen to reading'}
                >
                  {/* Speaker icon or stop icon */}
                  {isPlaying ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                      <rect x="6" y="6" width="12" height="12" rx="1" />
                    </svg>
                  ) : isGenerating ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ animation: 'pulse 1s infinite' }}>
                      <circle cx="12" cy="12" r="3" />
                      <circle cx="12" cy="12" r="8" fillOpacity="0.3" />
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
                    </svg>
                  )}
                  <span style={{ fontSize: '12px' }}>
                    {isPlaying ? 'Stop' : isGenerating ? '...' : 'Listen'}
                  </span>
                </button>
              )}

              {/* Spacer */}
              <div style={{ flex: 1 }} />

              {/* Content mode toggle - Rendered / Markdown */}
              <div
                style={{
                  display: 'flex',
                  gap: '2px',
                  backgroundColor: theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
                  borderRadius: '6px',
                  padding: '2px',
                  opacity: isFullScreen && !headerHovered ? 0 : 1,
                  transition: 'opacity 0.15s ease',
                }}
              >
                <button
                  onClick={() => setContentMode('rendered')}
                  style={{
                    padding: '4px 10px',
                    fontSize: '11px',
                    fontWeight: 500,
                    color: contentMode === 'rendered' ? (theme.isDark ? '#fff' : '#000') : theme.textSecondary,
                    backgroundColor: contentMode === 'rendered'
                      ? (theme.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)')
                      : 'transparent',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  Rendered
                </button>
                <button
                  onClick={() => setContentMode('markdown')}
                  style={{
                    padding: '4px 10px',
                    fontSize: '11px',
                    fontWeight: 500,
                    color: contentMode === 'markdown' ? (theme.isDark ? '#fff' : '#000') : theme.textSecondary,
                    backgroundColor: contentMode === 'markdown'
                      ? (theme.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)')
                      : 'transparent',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  Markdown
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Scrollable content area */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            padding: isFullScreen ? '8px 32px 16px 32px' : '24px 32px',
            display: 'flex',
            justifyContent: 'center',
          }}
        >
        {activeReading ? (
          <div
            style={{
              maxWidth: '600px',
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              flex: contentMode === 'markdown' ? 1 : 'none',
              minHeight: contentMode === 'markdown' ? 0 : 'auto',
            }}
          >
            {contentMode === 'markdown' ? (
              /* Markdown edit mode - textarea */
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                style={{
                  flex: 1,
                  minHeight: '400px',
                  padding: '16px',
                  fontSize: '14px',
                  lineHeight: 1.6,
                  fontFamily: "'SF Mono', Monaco, 'Cascadia Code', monospace",
                  backgroundColor: theme.isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
                  border: `1px solid ${theme.border}`,
                  borderRadius: '8px',
                  color: theme.text,
                  resize: 'none',
                  outline: 'none',
                }}
                placeholder="Write your markdown here..."
                autoFocus
              />
            ) : (
              /* View mode - markdown renderer */
              <>
            {/* Field Theory icon - only in immersive mode */}
            {isFullScreen && (
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
                <img
                  src={theme.isDark ? 'fieldtheory-icon.png' : 'field-theory-icon-black.png'}
                  alt="Field Theory"
                  style={{ height: '32px', width: 'auto', opacity: 0.6 }}
                />
              </div>
            )}
            {/* Divider - only in immersive mode */}
            {isFullScreen && (
              <hr style={{ border: 'none', height: '1px', backgroundColor: theme.border, margin: '0 0 20px 0' }} />
            )}
            {/* Wiki metadata tags — small pill badges above content */}
            {wikiDisplay && wikiDisplay.meta.tags && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '12px' }}>
                {wikiDisplay.meta.tags
                  .replace(/^\[|\]$/g, '')
                  .split(',')
                  .map((t) => t.trim())
                  .filter(Boolean)
                  .map((tag) => (
                    <span
                      key={tag}
                      style={{
                        fontSize: '10px',
                        padding: '1px 6px',
                        borderRadius: '8px',
                        backgroundColor: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
                        color: theme.textSecondary,
                        fontFamily: 'system-ui, sans-serif',
                      }}
                    >
                      {tag}
                    </span>
                  ))}
                {wikiDisplay.meta.source_type && (
                  <span style={{
                    fontSize: '10px',
                    padding: '1px 6px',
                    borderRadius: '8px',
                    backgroundColor: theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
                    color: theme.textSecondary,
                    fontFamily: 'system-ui, sans-serif',
                    opacity: 0.7,
                  }}>
                    {wikiDisplay.meta.source_type}
                  </span>
                )}
              </div>
            )}
            {/* Content - markdown renders the title */}
            <div
              className="librarian-content"
              style={{
                fontSize: textSizes[textSize].base,
                lineHeight: 1.5,
                color: theme.text,
                fontFamily: fonts.serif,
                userSelect: 'text',
              }}
            >
              <ReactMarkdown
                components={{
                  h1: ({ children }) => (
                    <h1
                      style={{
                        fontSize: textSizes[textSize].h1,
                        fontWeight: 600,
                        marginTop: 0,
                        marginBottom: '10px',
                        lineHeight: 1.2,
                        color: theme.text,
                        fontFamily: fonts.serif,
                      }}
                    >
                      {children}
                    </h1>
                  ),
                  h2: ({ children }) => (
                    <h2
                      style={{
                        fontSize: textSizes[textSize].h2,
                        fontWeight: 600,
                        marginTop: '16px',
                        marginBottom: '6px',
                        color: theme.text,
                      }}
                    >
                      {children}
                    </h2>
                  ),
                  h3: ({ children }) => (
                    <h3
                      style={{
                        fontSize: textSizes[textSize].h3,
                        fontWeight: 600,
                        marginTop: '14px',
                        marginBottom: '4px',
                        color: theme.text,
                      }}
                    >
                      {children}
                    </h3>
                  ),
                  p: ({ children, node }) => {
                    // Check if this paragraph contains braille art (U+2800-U+28FF)
                    // Extract text from the AST node for reliable detection
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const extractText = (n: any): string => {
                      if (!n) return '';
                      if (n.type === 'text' && 'value' in n) return n.value as string;
                      if ('children' in n && Array.isArray(n.children)) {
                        return n.children.map(extractText).join('');
                      }
                      return '';
                    };
                    const textContent = extractText(node);
                    const normalizedText = textContent.trim();
                    const hasBraille = /[\u2800-\u28FF]/.test(textContent);
                    const isModelSignatureLine = isArtifactModelSignatureText(normalizedText);

                    if (hasBraille) {
                      return (
                        <p
                          style={{
                            marginBottom: '16px',
                            marginTop: '8px',
                            textAlign: 'center',
                            fontFamily: fonts.mono,
                            fontSize: '14px',
                            lineHeight: 1.15,
                            whiteSpace: 'pre',
                            letterSpacing: 0,
                          }}
                        >
                          {children}
                        </p>
                      );
                    }

                    if (isModelSignatureLine) {
                      return null;
                    }

                    return (
                      <p
                        style={{
                          marginBottom: '8px',
                        }}
                      >
                        {children}
                      </p>
                    );
                  },
                  strong: ({ children }) => (
                    <strong
                      style={{
                        fontWeight: 600,
                        color: theme.text,
                      }}
                    >
                      {children}
                    </strong>
                  ),
                  em: ({ children }) => (
                    <em style={{ fontStyle: 'italic' }}>{children}</em>
                  ),
                  blockquote: ({ children }) => (
                    <blockquote
                      style={{
                        borderLeft: `3px solid ${theme.accent}`,
                        paddingLeft: '12px',
                        marginLeft: 0,
                        marginRight: 0,
                        marginBottom: '8px',
                        color: theme.textSecondary,
                        fontStyle: 'italic',
                      }}
                    >
                      {children}
                    </blockquote>
                  ),
                  code: ({ children, className }) => {
                    const isInline = !className;
                    if (isInline) {
                      return (
                        <code
                          style={{
                            backgroundColor: theme.isDark
                              ? 'rgba(255,255,255,0.1)'
                              : 'rgba(0,0,0,0.05)',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            fontSize: '0.875em', // Slightly smaller than body text since monospace appears larger
                            fontFamily: fonts.mono,
                          }}
                        >
                          {children}
                        </code>
                      );
                    }
                    return (
                      <code
                        style={{
                          display: 'block',
                          backgroundColor: theme.isDark
                            ? 'rgba(255,255,255,0.05)'
                            : 'rgba(0,0,0,0.03)',
                          padding: '12px 16px',
                          borderRadius: '6px',
                          fontSize: '13px',
                          fontFamily: "'SF Mono', Monaco, 'Cascadia Code', monospace",
                          overflowX: 'auto',
                          marginBottom: '16px',
                        }}
                      >
                        {children}
                      </code>
                    );
                  },
                  pre: ({ children }) => (
                    <pre
                      style={{
                        backgroundColor: theme.isDark
                          ? 'rgba(255,255,255,0.05)'
                          : 'rgba(0,0,0,0.03)',
                        padding: '12px 16px',
                        borderRadius: '6px',
                        overflowX: 'auto',
                        marginBottom: '16px',
                      }}
                    >
                      {children}
                    </pre>
                  ),
                  ul: ({ children }) => (
                    <ul
                      style={{
                        marginBottom: '16px',
                        paddingLeft: '24px',
                      }}
                    >
                      {children}
                    </ul>
                  ),
                  ol: ({ children }) => (
                    <ol
                      style={{
                        marginBottom: '16px',
                        paddingLeft: '24px',
                      }}
                    >
                      {children}
                    </ol>
                  ),
                  li: ({ children }) => (
                    <li
                      style={{
                        marginBottom: '4px',
                      }}
                    >
                      {children}
                    </li>
                  ),
                  a: ({ href, children }) => (
                    <a
                      href={href}
                      style={{
                        color: theme.accent,
                        textDecoration: 'none',
                      }}
                      onClick={(e) => {
                        e.preventDefault();
                        if (!href) return;
                        if (href.startsWith('wiki://')) {
                          openWikiHref(href);
                          return;
                        }
                        window.shellAPI?.openExternal(href);
                      }}
                    >
                      {children}
                    </a>
                  ),
                  hr: () => (
                    <hr
                      style={{
                        border: 'none',
                        height: '1px',
                        backgroundColor: theme.border,
                        margin: '24px 0',
                      }}
                    />
                  ),
                }}
              >
                {displayContent}
              </ReactMarkdown>
            </div>
            {/* Footer - only in immersive mode */}
            {isFullScreen && (
              <>
                <hr style={{ border: 'none', height: '1px', backgroundColor: theme.border, margin: '32px 0 24px 0' }} />
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    paddingBottom: '24px',
                  }}
                >
                  <div style={{ color: theme.textSecondary }}>
                    <div style={{ fontSize: '13px' }}>Artifact made by the Librarian</div>
                    <div style={{ fontSize: '12px', marginTop: '2px', fontStyle: 'italic' }}>
                      Inspired by <span title={shareStatus?.slug || ''} style={{ cursor: shareStatus?.slug ? 'help' : 'default' }}>your work</span>
                    </div>
                    {selectedReading?.modelSignature && (
                      <div style={{ fontSize: '12px', marginTop: '6px' }}>
                        Signed by {selectedReading?.modelSignature}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '8px' }}>
                    {/* Mute button */}
                    <button
                      onClick={async () => {
                        setIsMuting(true);
                        try {
                          if (isMutedForToday) {
                            await window.librarianAPI?.unmute();
                            setIsMutedForToday(false);
                          } else {
                            await window.librarianAPI?.muteForToday();
                            setIsMutedForToday(true);
                          }
                        } finally {
                          setIsMuting(false);
                        }
                      }}
                      disabled={isMuting}
                      title={isMutedForToday ? 'Muted until tomorrow - click to unmute' : 'Mute for today'}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '4px 8px',
                        fontSize: '11px',
                        fontWeight: 500,
                        color: isMutedForToday ? '#f59e0b' : theme.textSecondary,
                        backgroundColor: isMutedForToday
                          ? (theme.isDark ? 'rgba(245, 158, 11, 0.1)' : 'rgba(245, 158, 11, 0.08)')
                          : 'transparent',
                        border: `1px solid ${isMutedForToday ? 'rgba(245, 158, 11, 0.4)' : theme.border}`,
                        borderRadius: '5px',
                        cursor: isMuting ? 'wait' : 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      {isMutedForToday ? (
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                          <path d="M1.414 1.414a.5.5 0 0 1 .707 0l12.728 12.728a.5.5 0 0 1-.707.707L11.34 12.05A3.994 3.994 0 0 1 8 14a3.994 3.994 0 0 1-3.34-1.95l-.47-.47-.293-.293L1.414 8.804A3.962 3.962 0 0 1 1 6.5c0-.932.32-1.79.854-2.467L1.414 3.594a.5.5 0 0 1 0-.707zM4 6.5c0-.553.132-1.074.366-1.535l7.17 7.17A2.989 2.989 0 0 1 8 13a2.99 2.99 0 0 1-2.536-1.406.5.5 0 0 0-.428-.229H4.5A.5.5 0 0 1 4 10.865V6.5z"/>
                          <path d="M8 2a4 4 0 0 1 4 4v2.335c0 .38.1.745.287 1.065l.603.905-8.535-8.536A3.988 3.988 0 0 1 8 2zm3.5 8.865V6.5a3.5 3.5 0 0 0-7-0v1.865l7 0z"/>
                        </svg>
                      ) : (
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                          <path d="M8 16a2 2 0 0 0 2-2H6a2 2 0 0 0 2 2zM8 1.918l-.797.161A4.002 4.002 0 0 0 4 6c0 .628-.134 2.197-.459 3.742-.16.767-.376 1.566-.663 2.258h10.244c-.287-.692-.502-1.49-.663-2.258C12.134 8.197 12 6.628 12 6a4.002 4.002 0 0 0-3.203-3.92L8 1.917zM14.22 12c.223.447.481.801.78 1H1c.299-.199.557-.553.78-1C2.68 10.2 3 6.88 3 6c0-2.42 1.72-4.44 4.005-4.901a1 1 0 1 1 1.99 0A5.002 5.002 0 0 1 13 6c0 .88.32 4.2 1.22 6z"/>
                        </svg>
                      )}
                    </button>
                    {/* Share button */}
                    <button
                      onClick={async () => {
                        if (shareStatus?.shared) {
                          // Already shared - unshare
                          await handleShare();
                        } else {
                          // Share and copy link
                          setIsSharing(true);
                          try {
                            const result = await Promise.race([
                              window.librarianAPI?.shareReading(selectedPath!),
                              new Promise<null>((resolve) => setTimeout(() => resolve(null), 15000)),
                            ]);
                            if (result) {
                              setShareStatus({ shared: true, slug: result.slug, url: result.url });
                              // Copy link to clipboard
                              await navigator.clipboard.writeText(result.url);
                              setLinkCopied(true);
                              setTimeout(() => setLinkCopied(false), 2000);
                            } else {
                              console.warn('[Librarian] Share failed or timed out');
                            }
                          } catch (err) {
                            console.error('[Librarian] Share error:', err);
                          } finally {
                            setIsSharing(false);
                          }
                        }
                      }}
                      disabled={isSharing}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '5px',
                        padding: '4px 10px',
                        fontSize: '11px',
                        fontWeight: 500,
                        color: shareStatus?.shared ? '#22c55e' : theme.textSecondary,
                        backgroundColor: shareStatus?.shared
                          ? (theme.isDark ? 'rgba(34, 197, 94, 0.1)' : 'rgba(34, 197, 94, 0.08)')
                          : 'transparent',
                        border: `1px solid ${shareStatus?.shared ? 'rgba(34, 197, 94, 0.4)' : theme.border}`,
                        borderRadius: '5px',
                        cursor: isSharing ? 'wait' : 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M4.715 6.542 3.343 7.914a3 3 0 1 0 4.243 4.243l1.828-1.829A3 3 0 0 0 8.586 5.5L8 6.086a1.002 1.002 0 0 0-.154.199 2 2 0 0 1 .861 3.337L6.88 11.45a2 2 0 1 1-2.83-2.83l.793-.792a4.018 4.018 0 0 1-.128-1.287z"/>
                        <path d="M6.586 4.672A3 3 0 0 0 7.414 9.5l.775-.776a2 2 0 0 1-.896-3.346L9.12 3.55a2 2 0 1 1 2.83 2.83l-.793.792c.112.42.155.855.128 1.287l1.372-1.372a3 3 0 1 0-4.243-4.243L6.586 4.672z"/>
                      </svg>
                      {isSharing ? '...' : shareStatus?.shared ? 'Shareable' : 'Not shared'}
                    </button>
                    <span style={{ fontSize: '9px', color: '#22c55e', marginTop: '-3px', height: '12px', visibility: linkCopied ? 'visible' : 'hidden' }}>Copied!</span>
                  </div>
                </div>
              </>
            )}
              </>
            )}
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: theme.textSecondary,
            }}
          >
            {loading ? 'Loading...' : 'Select a page'}
          </div>
        )}
        </div>
        </Fragment>
        )}
      </div>

    </div>
  );
}
