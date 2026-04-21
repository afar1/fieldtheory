// =============================================================================
// LibrarianView - reading and writing experience for collected readings.
// Named after the AI assistant in Snow Crash that provides contextual intel.
// =============================================================================

import { useEffect, useState, useRef, useCallback, useMemo, Fragment } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import { fonts } from '../design/tokens';
import ContentToolbar from './ContentToolbar';
import ImmersiveToggle from './ImmersiveToggle';
import LibrarianSetupWizard from './LibrarianSetupWizard';
import WikiSidebar, { BOOKMARKS_ITEM_ID, type UnifiedItem, type WikiCreationController } from './WikiSidebar';
import BookmarksPane from './BookmarksPane';
import { prefetchBookmarks } from '../services/bookmarksCache';
import { FEATURE_NARRATION_ENABLED } from '../featureFlags';
import { isSearchFocusShortcut, shouldEnterEditOnClick } from '../utils/editorShortcuts';
import {
  buildWikiIndex,
  classifyLinkHref,
  isUnresolvedWikiHref,
  normalizeWikiRelPath,
  transformWikiLinks,
  type WikiIndexInput,
} from '../utils/wikiLinks';

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
        relPath: normalizeWikiRelPath(parsed.relPath),
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
  selectedItemType: 'wiki' | 'artifact' | 'bookmarks' | 'external' | null,
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

export function formatBreadcrumb(
  itemType: 'wiki' | 'external',
  reading: { path: string; title: string } | null,
): string {
  if (!reading) return '';
  if (itemType === 'wiki') return reading.title;
  const parts = reading.path.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? reading.title;
}

function clampScrollRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0;
  return Math.min(1, Math.max(0, ratio));
}

export function getScrollRatio(scrollTop: number, scrollHeight: number, clientHeight: number): number {
  const maxScrollTop = scrollHeight - clientHeight;
  if (maxScrollTop <= 0) return 0;
  return clampScrollRatio(scrollTop / maxScrollTop);
}

export function getScrollTopForRatio(scrollHeight: number, clientHeight: number, ratio: number): number {
  const maxScrollTop = scrollHeight - clientHeight;
  if (maxScrollTop <= 0) return 0;
  return maxScrollTop * clampScrollRatio(ratio);
}

const READING_CONTENT_MAX_WIDTH = 'min(720px, 70ch)';
const READING_LINE_HEIGHT = 1.62;

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
  // Sidebar collapse state is owned by ClipboardHistory so the footer
  // toggle can drive it regardless of which view is active.
  sidebarCollapsed: boolean;
}

function isArtifactModelSignatureText(text: string): boolean {
  return /^(Model|Signed by):\s+.+$/i.test(text.trim());
}

type MarkdownRenderNode = {
  type?: string;
  value?: unknown;
  children?: unknown;
};

function extractMarkdownText(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const renderNode = node as MarkdownRenderNode;
  if (renderNode.type === 'text' && typeof renderNode.value === 'string') return renderNode.value;
  if (Array.isArray(renderNode.children)) return renderNode.children.map(extractMarkdownText).join('');
  return '';
}

export default function LibrarianView({ onSwitchToClipboard, onSwitchToSettings, onFullScreenChange, externalHeaderHover, initialReadingPath, initialFullScreen, onInitialReadingConsumed, autoPopArtifactPath, onAutoPopArtifactSuperseded, sidebarCollapsed }: LibrarianViewProps) {
  const { theme } = useTheme();
  const restoredSelection = useMemo(() => restoreLibrarianSelection(localStorage), []);

  const [readings, setReadings] = useState<ReadingMeta[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(() => restoredSelection?.type === 'artifact' ? restoredSelection.path : null);
  const [selectedReading, setSelectedReading] = useState<Reading | null>(null);
  const [loading, setLoading] = useState(true);
  const [setupComplete, setSetupComplete] = useState<boolean | null>(null); // null = loading

  // Edit state. Auto-save keeps disk in sync; `saveStatus` drives the tiny
  // inline indicator that replaced the Save button.
  const [editContent, setEditContent] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  // Populated when there's unsaved content pending — call to flush the
  // pending debounced save synchronously (Esc, Cmd+S, switching files).
  const flushSaveRef = useRef<(() => Promise<void>) | null>(null);
  // Tracks what's actually on disk. activeReading.content goes stale after
  // the first save (we intentionally don't re-fetch to preserve the
  // textarea's native undo stack), so comparing against it would miss the
  // "typed a char then deleted it" case.
  const lastSavedContentRef = useRef<string | null>(null);
  const [textSize, setTextSize] = useState<'small' | 'normal' | 'large'>(() => {
    const saved = localStorage.getItem('librarian-text-size');
    return (saved === 'small' || saved === 'normal' || saved === 'large') ? saved : 'normal';
  });
  const [isFullScreen, setIsFullScreen] = useState(initialFullScreen ?? false);
  const toggleImmersive = useCallback(() => {
    setIsFullScreen((prev) => {
      const next = !prev;
      window.librarianAPI?.setImmersiveMode?.(next);
      return next;
    });
  }, []);
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
  const readerPaneRef = useRef<HTMLDivElement | null>(null);
  const contentScrollRef = useRef<HTMLDivElement | null>(null);
  const markdownEditorRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingScrollRatioRef = useRef<number | null>(null);

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
  const [selectedItemType, setSelectedItemType] = useState<'wiki' | 'artifact' | 'bookmarks' | 'external' | null>(() => restoredSelection?.type ?? null);
  // Lazy keep-alive: once the user has visited Bookmarks, the pane stays mounted
  // (hidden via CSS) so its DOM pool, snapshot cache, scroll/camera state, and
  // search input persist across sidebar switches.
  const [bookmarksEverShown, setBookmarksEverShown] = useState<boolean>(() => restoredSelection?.type === 'bookmarks');
  const [wikiSelectedRelPath, setWikiSelectedRelPath] = useState<string | null>(() => restoredSelection?.type === 'wiki' ? restoredSelection.relPath : null);
  const [wikiSelectedPage, setWikiSelectedPage] = useState<Reading | null>(null);
  // External markdown files opened via macOS file-association (`open-file`)
  // whose canonical path falls outside the wiki root. Stored in Reading shape
  // so activeReading can unify over it; save branches on selectedItemType.
  const [externalOpenFile, setExternalOpenFile] = useState<Reading | null>(null);
  // Flat list of every wiki page for resolving [[wikilinks]] by title or
  // relPath. Refreshed from getTree() on mount and on `onPageChanged`.
  const [wikiIndexPages, setWikiIndexPages] = useState<WikiIndexInput[]>([]);

  const selectArtifactPath = useCallback((artifactPath: string) => {
    setSelectedItemId(`artifact:${artifactPath}`);
    setSelectedItemType('artifact');
    setSelectedPath(artifactPath);
    setWikiSelectedRelPath(null);
    setExternalOpenFile(null);
  }, []);

  // Load an external markdown file (outside wiki root) into the editor.
  // Deduped against the current external selection so re-opening the same
  // file is a no-op — preserves the native textarea undo stack.
  const selectExternalFile = useCallback(async (absPath: string): Promise<void> => {
    if (externalOpenFile?.path === absPath && selectedItemType === 'external') {
      return;
    }
    await flushSaveRef.current?.();
    const file = await window.externalAPI?.open(absPath);
    if (!file) return;
    const title = file.name.replace(/\.(md|markdown|mdx)$/i, '');
    setExternalOpenFile({
      path: file.path,
      title,
      content: file.content,
      context: null,
      readingTime: null,
      modelSignature: null,
      createdAt: file.mtime,
      mtime: file.mtime,
    });
    setSelectedItemId(`external:${file.path}`);
    setSelectedItemType('external');
    setSelectedPath(null);
    setWikiSelectedRelPath(null);
    setContentMode('rendered');
    void window.recentAPI?.visit({
      kind: 'external',
      path: file.path,
      title,
      lastOpenedAt: Date.now(),
    });
  }, [externalOpenFile?.path, selectedItemType]);

  const openWikiPage = useCallback((relPath: string) => {
    const normalized = normalizeWikiRelPath(relPath);
    if (!normalized) return;
    setSelectedItemId(`wiki:${normalized}`);
    setSelectedItemType('wiki');
    setWikiSelectedRelPath(normalized);
    setSelectedPath(null);
    setExternalOpenFile(null);
  }, []);

  // Click on an unresolved [[wikilink]] — create the page in scratchpad using
  // the target text as the filename / heading, then open it.
  const createUnresolvedWikiLink = useCallback(async (title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    const page = await window.wikiAPI?.createFile('scratchpad', trimmed);
    if (page?.relPath) openWikiPage(page.relPath);
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
    if (selectedItemType === 'external') {
      // External files are transient — don't overwrite the stored wiki/
      // artifact/bookmarks selection, so closing and reopening the library
      // restores the durable view.
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

  const textSizes = {
    small: { base: '14px', h1: '24px', h2: '18px', h3: '15px' },
    normal: { base: '16px', h1: '28px', h2: '20px', h3: '17px' },
    large: { base: '18px', h1: '32px', h2: '24px', h3: '20px' },
  };

  const activeReading: Reading | null =
    selectedItemType === 'wiki' ? wikiSelectedPage :
    selectedItemType === 'external' ? externalOpenFile :
    selectedReading;
  const documentTextStyle = {
    fontSize: textSizes[textSize].base,
    lineHeight: READING_LINE_HEIGHT,
    fontFamily: fonts.serif,
    color: theme.text,
  };

  const wikiDisplay = useMemo(() => {
    if (selectedItemType !== 'wiki' || !activeReading) return null;
    return splitFrontmatter(activeReading.content);
  }, [selectedItemType, activeReading]);

  const wikiIndex = useMemo(() => buildWikiIndex(wikiIndexPages), [wikiIndexPages]);

  const displayContent = useMemo(() => {
    const raw = wikiDisplay ? wikiDisplay.body : (activeReading?.content ?? '');
    if (!wikiDisplay) return raw;
    return transformWikiLinks(raw, wikiIndex);
  }, [wikiDisplay, activeReading?.content, wikiIndex]);

  const captureContentScrollRatio = useCallback(() => {
    const scrollEl = contentScrollRef.current;
    if (!scrollEl) return;
    pendingScrollRatioRef.current = getScrollRatio(
      scrollEl.scrollTop,
      scrollEl.scrollHeight,
      scrollEl.clientHeight,
    );
  }, []);

  useEffect(() => {
    const ratio = pendingScrollRatioRef.current;
    if (ratio === null) return;
    pendingScrollRatioRef.current = null;

    const frame = requestAnimationFrame(() => {
      const scrollEl = contentScrollRef.current;
      if (!scrollEl) return;
      scrollEl.scrollTop = getScrollTopForRatio(
        scrollEl.scrollHeight,
        scrollEl.clientHeight,
        ratio,
      );
    });

    return () => cancelAnimationFrame(frame);
  }, [contentMode, activeReading?.path]);

  useEffect(() => {
    if (contentMode !== 'markdown') return;
    const editor = markdownEditorRef.current;
    if (!editor) return;

    const frame = requestAnimationFrame(() => {
      editor.style.height = 'auto';
      editor.style.height = `${editor.scrollHeight}px`;
    });

    return () => cancelAnimationFrame(frame);
  }, [contentMode, editContent, textSize, isFullScreen]);

  const enterEditMode = useCallback(() => {
    captureContentScrollRatio();
    setContentMode('markdown');
  }, [captureContentScrollRatio]);

  const exitEditMode = useCallback(async () => {
    captureContentScrollRatio();
    await flushSaveRef.current?.();
    setContentMode('rendered');
  }, [captureContentScrollRatio]);

  // Debounced auto-save. Fires ~400ms after the last keystroke and doesn't
  // round-trip the saved content back into React state, so the textarea's
  // native undo stack stays intact for Cmd+Z within the session.
  useEffect(() => {
    // Nothing pending unless/until a matching save is scheduled below.
    flushSaveRef.current = null;
    if (contentMode !== 'markdown' || !activeReading) return;
    // Compare against what's actually on disk, not activeReading.content —
    // the latter is frozen at load time. Otherwise "type a char, delete it"
    // would leave the typed char persisted.
    if (editContent === lastSavedContentRef.current) return;
    // Capture target ids so a mid-debounce file switch still writes pending
    // content to the correct path.
    const targetType = selectedItemType;
    const targetWikiPath = wikiSelectedRelPath;
    const targetReadingPath = activeReading.path;
    const targetContent = editContent;
    let done = false;
    const doSave = async () => {
      if (done) return;
      done = true;
      setSaveStatus('saving');
      try {
        if (targetType === 'wiki' && targetWikiPath) {
          await window.wikiAPI?.save(targetWikiPath, targetContent);
          // Update activeReading so the rendered view reflects the fresh
          // content as soon as the user clicks away. The sync effect below
          // is guarded by path so this won't clobber editContent.
          setWikiSelectedPage((prev) => (prev ? { ...prev, content: targetContent } : prev));
        } else if (targetType === 'external' && targetReadingPath) {
          await window.externalAPI?.save(targetReadingPath, targetContent);
          setExternalOpenFile((prev) => (prev ? { ...prev, content: targetContent } : prev));
        } else if (targetReadingPath) {
          await window.librarianAPI?.saveReading(targetReadingPath, targetContent);
          setSelectedReading((prev) => (prev ? { ...prev, content: targetContent } : prev));
        }
        lastSavedContentRef.current = targetContent;
        setSaveStatus('saved');
      } catch {
        setSaveStatus('idle');
      } finally {
        // Only clear the ref if it still points at this save — a newer
        // effect run may have replaced it while we were awaiting disk.
        if (flushSaveRef.current === doSave) flushSaveRef.current = null;
      }
    };
    flushSaveRef.current = doSave;
    const timer = setTimeout(() => { void doSave(); }, 400);
    return () => clearTimeout(timer);
  }, [editContent, contentMode, activeReading, selectedItemType, wikiSelectedRelPath]);

  // Fade the "Saved" chip back to idle after a moment so the toolbar settles.
  // 2.5s is long enough to notice when clicking away to another file without
  // being obtrusive.
  useEffect(() => {
    if (saveStatus !== 'saved') return;
    const t = setTimeout(() => setSaveStatus('idle'), 2500);
    return () => clearTimeout(t);
  }, [saveStatus]);

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

  const handleCreateDir = useCallback(async (dirName: string) => {
    if (!dirName.trim()) return;
    await window.wikiAPI?.createDir(dirName.trim());
  }, []);

  // Scratchpad default create — used by the sidebar "+" button and Cmd+N
  // from anywhere. Same backend as the Ctrl+Opt+Cmd+Space hotkey.
  const handleCreateScratchpadDefault = useCallback(async () => {
    const page = await window.wikiAPI?.createScratchpadDefault();
    if (page) {
      openWikiPage(page.relPath);
      setContentMode('markdown');
    }
  }, [openWikiPage]);

  // True while the currently-selected item is the artifact the librarian
  // just auto-popped. Escape should close the window in that case.
  const isOnAutoPopArtifact =
    !!autoPopArtifactPath &&
    selectedItemType === 'artifact' &&
    selectedPath === autoPopArtifactPath;

  const handleSelectItem = useCallback(async (item: UnifiedItem) => {
    // Flush any pending auto-save against the current file before we
    // redirect editContent to the new one.
    await flushSaveRef.current?.();
    if (item.type === 'wiki' && item.relPath) {
      openWikiPage(item.relPath);
    } else if (item.type === 'artifact') {
      selectArtifactPath(item.absPath);
    } else if (item.type === 'external') {
      await selectExternalFile(item.absPath);
    } else if (item.type === 'bookmarks') {
      setSelectedItemId(BOOKMARKS_ITEM_ID);
      setSelectedItemType('bookmarks');
      setSelectedPath(null);
      setWikiSelectedRelPath(null);
      setExternalOpenFile(null);
    }
    setContentMode('rendered');
    // Any navigation other than reselecting the same auto-popped artifact
    // dismisses the auto-pop exception.
    const stayingOnAutoPop = item.type === 'artifact' && item.absPath === autoPopArtifactPath;
    if (autoPopArtifactPath && !stayingOnAutoPop) {
      onAutoPopArtifactSuperseded?.();
    }
  }, [openWikiPage, selectArtifactPath, selectExternalFile, autoPopArtifactPath, onAutoPopArtifactSuperseded]);

  // Seed editContent when the user enters markdown mode on a file, or when
  // they switch to a different file while editing. Guarded by path so that
  // activeReading updates caused by our own save don't clobber in-progress
  // edits (setWikiSelectedPage after a write produces a new object but the
  // path is unchanged).
  const lastSeededPathRef = useRef<string | null>(null);
  useEffect(() => {
    if (contentMode !== 'markdown' || !activeReading) {
      lastSeededPathRef.current = null;
      return;
    }
    if (lastSeededPathRef.current === activeReading.path) return;
    setEditContent(activeReading.content);
    lastSavedContentRef.current = activeReading.content;
    lastSeededPathRef.current = activeReading.path;
  }, [contentMode, activeReading]);

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

  const copyShareLink = useCallback(async () => {
    if (!shareStatus?.url) return;
    await navigator.clipboard.writeText(shareStatus.url);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  }, [shareStatus?.url]);

  // Delete current item — branches on selectedItemType. Wiki pages go to
  // macOS Trash via shell.trashItem (recoverable) and the main process
  // auto-prunes any matching Recent entry; artifacts use the existing
  // librarian delete flow.
  const handleDelete = useCallback(async () => {
    if (selectedItemType === 'wiki') {
      if (!wikiSelectedRelPath || !activeReading) return;
      const confirmed = window.confirm(`Move "${activeReading.title}" to Trash?`);
      if (!confirmed) return;
      const success = await window.wikiAPI?.deletePage(wikiSelectedRelPath);
      if (success) {
        setWikiSelectedRelPath(null);
        setWikiSelectedPage(null);
      }
      return;
    }

    if (selectedItemType === 'artifact') {
      if (!selectedPath || !selectedReading) return;
      const confirmed = window.confirm(`Delete "${selectedReading.title}"? This cannot be undone.`);
      if (!confirmed) return;
      if (shareStatus?.shared) {
        await window.librarianAPI?.unshareReading(selectedPath);
      }
      await window.librarianAPI?.deleteReading(selectedPath);
      // The onReadingRemoved listener will handle updating state and selecting next item
    }
  }, [selectedItemType, selectedPath, selectedReading, wikiSelectedRelPath, activeReading, shareStatus?.shared]);

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
        void window.recentAPI?.visit({
          kind: 'wiki',
          path: wikiSelectedRelPath,
          title: page.title,
          lastOpenedAt: Date.now(),
        });
      } else {
        // Target relPath disappeared between index refresh and navigation —
        // clear the stale render so the reader sees empty state instead of
        // the previous page, which would look like "the link did nothing".
        setWikiSelectedPage(null);
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
          void exitEditMode();
        } else if (activeReading) {
          enterEditMode();
        }
        return;
      }

      // Cmd+S - flush the pending auto-save and drop back to rendered.
      if (e.key === 's' && e.metaKey && contentMode === 'markdown') {
        e.preventDefault();
        void exitEditMode();
        return;
      }

      // Cmd+F or / — focus library search. Firing is gated on the active
      // element (not the view mode), so `/` still works while the editor
      // textarea is on screen, just not when it's focused.
      if (isSearchFocusShortcut(e)) {
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

      // Cmd+W - close window (same as red close button). Flush pending save
      // first so an in-flight debounce doesn't lose the last keystrokes.
      if (e.key === 'w' && e.metaKey) {
        e.preventDefault();
        const pending = flushSaveRef.current?.() ?? Promise.resolve();
        void pending.then(() => window.clipboardAPI?.closeWindow());
        return;
      }

      // Escape hierarchy: edit-mode → auto-popped artifact → immersive-exit → close window.
      // In markdown mode, Esc just drops back to rendered without closing the
      // window — auto-save already persisted the content.
      if (e.key === 'Escape') {
        if (contentMode === 'markdown') {
          void exitEditMode();
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
  }, [readings, selectedPath, isFullScreen, contentMode, activeReading, onSwitchToClipboard, enterEditMode, exitEditMode, handleCreateFile, handleCreateDir, selectedItemId, handleSelectItem, isOnAutoPopArtifact]);

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

  // Keep a flat list of all wiki pages for resolving [[wikilinks]]. Reloaded
  // on mount and whenever the wiki tree changes so links to newly created
  // pages resolve without a reopen.
  useEffect(() => {
    const load = async () => {
      const folders = await window.wikiAPI?.getTree();
      if (!folders) return;
      setWikiIndexPages(
        folders.flatMap((f) => f.files.map((p) => ({ relPath: p.relPath, title: p.title }))),
      );
    };
    void load();
    const unsubscribe = window.wikiAPI?.onPageChanged(() => { void load(); });
    return () => unsubscribe?.();
  }, []);

  // macOS `open-file` for paths outside the wiki root.
  useEffect(() => {
    const unsubscribe = window.externalAPI?.onOpenExternal((absPath) => {
      void selectExternalFile(absPath);
    });
    return () => unsubscribe?.();
  }, [selectExternalFile]);

  // Mirror the current file into the native macOS title bar (proxy icon +
  // Cmd-click menu showing the full path). Only external files get this —
  // wiki/artifacts live under our private data dir so the proxy icon would
  // point users to an opaque internal path.
  useEffect(() => {
    const path = selectedItemType === 'external' ? activeReading?.path ?? '' : '';
    void window.shellAPI?.setRepresentedFilename(path);
  }, [selectedItemType, activeReading?.path]);

  // Hotkey-driven scratchpad flow: main creates the file, we land on it in
  // edit mode so the user can start typing immediately.
  useEffect(() => {
    const unsubscribe = window.wikiAPI?.onOpenScratchpad((relPath) => {
      openWikiPage(relPath);
      setContentMode('markdown');
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
          onCreateScratchpadDefault={handleCreateScratchpadDefault}
          flatItemsRef={flatItemsRef}
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          searchInputRef={searchInputRef}
          creationControllerRef={wikiCreationRef}
        />
      </div>
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
        ref={readerPaneRef}
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
            {/* Inner container - always matches the centered document width. */}
            <div
              style={{
                maxWidth: READING_CONTENT_MAX_WIDTH,
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              {/* Nav: back (only visible in fullscreen). Copy-path moved to
                  the right of the immersive toggle inside ContentToolbar. */}
              {isFullScreen && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '2px', marginRight: '8px' }}>
                  <button
                    onClick={() => setIsFullScreen(false)}
                    style={{ padding: '3px 6px', fontSize: '11px', color: theme.textSecondary, backgroundColor: 'transparent', border: 'none', cursor: 'pointer', borderRadius: '4px' }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = theme.hoverBg)}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                    title="Back to standard view"
                  >←</button>
                </div>
              )}
              {/* Breadcrumb — "folder / filename" for wiki, "parent / filename"
                  + External chip for external. Artifacts skip this (title
                  already renders prominently in the content area). */}
              {(selectedItemType === 'wiki' || selectedItemType === 'external') && activeReading && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    minWidth: 0,
                    flexShrink: 1,
                    // @ts-ignore - opt the breadcrumb out of the drag region so
                    // clicks on the External chip's title tooltip land.
                    WebkitAppRegion: 'no-drag',
                  }}
                  title={activeReading.path}
                >
                  <span
                    style={{
                      fontSize: '11px',
                      color: theme.textSecondary,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      fontFamily: 'system-ui, sans-serif',
                    }}
                  >
                    {formatBreadcrumb(selectedItemType, activeReading)}
                  </span>
                  {selectedItemType === 'external' && (
                    <span
                      style={{
                        fontSize: '9px',
                        fontWeight: 600,
                        letterSpacing: '0.4px',
                        textTransform: 'uppercase',
                        color: theme.isDark ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.65)',
                        backgroundColor: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
                        padding: '2px 6px',
                        borderRadius: '10px',
                        flexShrink: 0,
                      }}
                    >
                      External
                    </span>
                  )}
                </div>
              )}
              <ContentToolbar
                filePath={activeReading?.path || undefined}
                isFullScreen={isFullScreen}
                textSize={textSize}
                onTextSizeChange={setTextSize}
                showTextSize={true}
                isEditing={contentMode === 'markdown'}
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
                onCopyPath={activeReading?.path ? () => navigator.clipboard.writeText(activeReading.path) : undefined}
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

              {/* Auto-save status: only surface the in-flight "Saving…"
                  state. The "Saved ✓" dwell was visual noise. */}
              {saveStatus === 'saving' && (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: '11px',
                    fontWeight: 500,
                    color: theme.textSecondary,
                    opacity: isFullScreen && !headerHovered ? 0 : 1,
                    transition: 'opacity 0.2s ease',
                    marginRight: '8px',
                    userSelect: 'none',
                  }}
                >
                  Saving…
                </span>
              )}

              {/* Content mode toggle - rendered view / raw markdown */}
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
                  onClick={() => {
                    if (contentMode === 'markdown') void exitEditMode();
                  }}
                  title="Rendered"
                  aria-label="Rendered"
                  style={{
                    width: '26px',
                    height: '22px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 0,
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
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <path d="M2 4h12M2 8h12M2 12h8" />
                  </svg>
                </button>
                <button
                  onClick={() => {
                    if (contentMode !== 'markdown' && activeReading) enterEditMode();
                  }}
                  title="Markdown source"
                  aria-label="Markdown source"
                  style={{
                    width: '26px',
                    height: '22px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 0,
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
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="5 4 2 8 5 12" />
                    <polyline points="11 4 14 8 11 12" />
                  </svg>
                </button>
              </div>

              {/* Immersive/fullscreen toggle sits to the right of the mode
                  toggle so the editor controls stay grouped together. */}
              <ImmersiveToggle isFullScreen={isFullScreen} onToggle={toggleImmersive} />
            </div>
          </div>
        )}

        {/* Scrollable content area */}
        <div
          ref={contentScrollRef}
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            padding: isFullScreen ? '16px 32px 28px 32px' : '28px 32px',
            display: 'flex',
            justifyContent: 'center',
          }}
        >
        {activeReading ? (
          <div
            style={{
              maxWidth: READING_CONTENT_MAX_WIDTH,
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              flex: contentMode === 'markdown' ? '1 1 auto' : '0 1 auto',
              minHeight: contentMode === 'markdown' ? '100%' : 'auto',
            }}
          >
            {contentMode === 'markdown' ? (
              /* Markdown edit mode - textarea */
              <textarea
                ref={markdownEditorRef}
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                onBlur={(e) => {
                  // Clicking away flips back to rendered. Ignore focus moves
                  // that stay inside the reader pane (toolbar buttons, mode
                  // toggle) — those have their own handlers and would cause
                  // mode bouncing if we flipped here.
                  const next = e.relatedTarget as Node | null;
                  if (next && readerPaneRef.current?.contains(next)) return;
                  void exitEditMode();
                }}
                spellCheck={true}
                style={{
                  display: 'block',
                  width: '100%',
                  minHeight: '400px',
                  padding: 0,
                  // Match the rendered view's base size so toggling between
                  // edit and rendered doesn't visually jump. The A/A/A
                  // controls feed textSize, so the editor scales with them.
                  ...documentTextStyle,
                  backgroundColor: 'transparent',
                  border: 'none',
                  borderRadius: 0,
                  resize: 'none',
                  outline: 'none',
                  boxShadow: 'none',
                  caretColor: theme.accent,
                  overflow: 'hidden',
                  overflowWrap: 'break-word',
                  tabSize: 2,
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
            {/* Content - markdown renders the title. Clicking anywhere that
                isn't a link / selection enters edit mode so markdown pages
                feel like editable docs instead of read-only previews. */}
            <div
              className="librarian-content"
              onClick={(e) => {
                if (!activeReading) return;
                if (!shouldEnterEditOnClick(e)) return;
                enterEditMode();
              }}
              style={{
                ...documentTextStyle,
                userSelect: 'text',
                cursor: activeReading ? 'text' : 'default',
              }}
            >
              <ReactMarkdown
                // remarkBreaks turns single newlines into <br> so the
                // rendered view matches what the user typed, iA-Writer style
                // — standard CommonMark would collapse them into spaces.
                remarkPlugins={[remarkBreaks]}
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
                    const textContent = extractMarkdownText(node);
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
                          marginTop: 0,
                          marginBottom: '0.75em',
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
                  a: ({ href, children }) => {
                    const unresolved = isUnresolvedWikiHref(href);
                    return (
                      <a
                        href={href}
                        style={{
                          color: unresolved ? '#ef4444' : theme.accent,
                          textDecoration: unresolved ? 'underline dashed' : 'none',
                          textUnderlineOffset: unresolved ? '2px' : undefined,
                          cursor: 'pointer',
                        }}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          // Markdown like `[categories/tool]()` renders an
                          // <a> with an empty href — fall back to the link
                          // text so these still resolve through the index.
                          const effectiveHref = href && href.trim()
                            ? href
                            : (e.currentTarget.textContent?.trim() ?? '');
                          const action = classifyLinkHref(effectiveHref, wikiIndex);
                          switch (action.kind) {
                            case 'create':
                              void createUnresolvedWikiLink(action.title);
                              return;
                            case 'wiki':
                              openWikiPage(action.relPath);
                              return;
                            case 'external':
                              window.shellAPI?.openExternal(action.href);
                              return;
                            case 'noop':
                              return;
                          }
                        }}
                      >
                        {children}
                      </a>
                    );
                  },
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
