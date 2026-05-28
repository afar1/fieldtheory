// =============================================================================
// ClipboardHistory - Alfred-style clipboard history popup.
// Shows local clipboard history with fuzzy search and multi-select.
// Also supports todo view mode (switched via Cmd+Shift+T hotkey).
// =============================================================================

import React, { useEffect, useState, useRef, useCallback, useMemo, useLayoutEffect, Suspense } from 'react';
import SettingsPanel from './SettingsPanel';
import TodoView from './TodoView';
import DMsView from './DMsView';
import PossibleGraphView from './PossibleGraphView';
import ReleaseNotesPopup, { hasReleaseNotes } from './ReleaseNotesPopup';
import LibrarianView, { LIBRARIAN_IMMERSIVE_STORAGE_KEY, getFocusChromeSurfaceOpacity, getGroupedFocusChromeProximityOpacity, restoreLibrarianSelection } from './LibrarianView';
import { dispatchLocalWikiAdded } from './WikiSidebar';
import DebugConsole from './DebugConsole';
import PerformanceHud from './PerformanceHud';
import MaxwellHistoryPopover from './MaxwellHistoryPopover';
import { ImagePreviewFrame } from './ImagePreviewOverlay';
import type { SketchViewHandle } from './SketchView';
import { FEATURE_MESSAGE_SHORTCUT_ENABLED, FEATURE_NARRATION_ENABLED } from '../featureFlags';
import { rendererSoundManager } from '../utils/rendererSoundManager';
import { buildHotkeyString, hasNonShiftModifierHotkey, isTextEntryElement, normalizeHotkeyForComparison } from '../utils/hotkeys';
import { isDocumentSaveOk } from '../utils/documentSaveConflicts';
import { getAgentKickoffFooterStatus } from '../utils/agentKickoffStatus';

// Lazy load SketchView (Excalidraw) to reduce initial bundle size
const SketchView = React.lazy(() => import('./SketchView'));
import { useTheme } from '../contexts/ThemeContext';
import { supabase } from '../supabaseClient';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragOverEvent,
  DragEndEvent,
  useDraggable,
  useDroppable,
} from '@dnd-kit/core';
import {
  ViewMode,
  ClipboardItem,
  ClipboardItemType,
  ClipboardSource,
  StackInfo,
  ListRow,
  UndoAction,
  FilterType,
  SourceFilterType,
  ClipboardQueryOptions,
  RunningApp,
  TAB_LABELS,
  MAX_UNDO,
} from '../types/clipboard';
import { formatCompactTime, formatCompactTimeReadable, formatTimeAgo, formatCompactWords, formatFileSize } from '../utils/formatUtils';
import { shouldDeferCopyShortcutToNative } from '../utils/hotkeys';
import { isNavSidebarToggleEnabled, isSidebarToggleShortcut, isThemeToggleShortcut } from '../utils/editorShortcuts';
import { getAgentImproveContext, type AgentImproveContext } from '../utils/agentImproveContext';
import {
  buildClipboardListRows,
  getStackHydrationIds,
  getStackItemsSignature,
} from '../utils/clipboardStacks';
import { smartTruncateText, detectColor } from '../utils/textUtils';
import {
  FIELD_THEORY_VIEW_STORAGE_KEY,
  SHOULD_SHOW_FIELDS_ON_OPEN_STORAGE_KEY,
  getAppBracketNavigationDirection,
  getAppNavigationSurface,
  getAppNumberTabSurface,
  isLibrarianSurfaceVisible,
  popAppBackHistory,
  popAppForwardHistory,
  persistClipboardSurface,
  pushAppNavigationHistory,
  resolveClipboardRestoreState,
  shouldKeepLibrarianMounted,
  type AppNavigationSurface,
} from '../utils/clipboardHistoryRestore';
import {
  buildClipboardItemsMarkdown,
  getClipboardItemsMarkdownTitle,
} from '../utils/clipboardMarkdown';
import { KeyCap } from './KeyCap';
import { DraggableDroppableRow } from './DraggableDroppableRow';
import { useAuthSessionBridge } from '../hooks/useAuthSessionBridge';
import { getSettingsDividerColor } from './settings/SettingsPrimitives';

const WINDOW_STYLE_TRANSITION_IN_KEY = 'ftWindowStyleTransitionIn';

type FieldTheoryMarkdownTarget = {
  kind: 'wiki' | 'artifact' | 'command' | 'external' | 'bookmarks' | 'library' | 'commands' | 'clipboard';
  path: string;
  contentMode?: 'rendered' | 'markdown' | 'typedown';
  sidebarCollapsed?: boolean;
  focusChrome?: boolean;
  selectionStart?: number;
  selectionEnd?: number;
  clipboardItemId?: number;
  clipboardStackId?: string;
  clipboardSearch?: string;
};

function getDocumentWindowInitialTarget(location: Pick<Location, 'search'>): FieldTheoryMarkdownTarget | null {
  const params = new URLSearchParams(location.search);
  if (params.get('documentWindow') !== '1') return null;
  const kind = params.get('kind');
  const path = params.get('path');
  if (!path || (kind !== 'wiki' && kind !== 'artifact' && kind !== 'external')) return null;
  const contentModeParam = params.get('contentMode');
  const contentMode = contentModeParam === 'markdown' || contentModeParam === 'typedown' || contentModeParam === 'rendered'
    ? contentModeParam
    : 'rendered';
  return {
    kind,
    path,
    contentMode,
    sidebarCollapsed: params.get('sidebarCollapsed') === '1',
    focusChrome: params.get('focusChrome') === '1',
  };
}

type TopNavMode = 'clipboard' | 'librarian' | 'possible';

type FooterLocalCommandStatus = {
  status: 'running' | 'success' | 'error' | 'notice';
  message: string;
  detail?: string;
  eventKind?: 'status' | 'model_output' | 'tool_call' | 'file_change' | 'error';
  commandName?: string;
  filePath?: string;
  mode?: 'document' | 'selection';
  runId?: string;
  phase?: string;
  changedLines?: number;
  changedBytes?: number;
  error?: string;
  updatedAt: number;
};

const LOCAL_COMMAND_ACTIVITY_FRAMES = ['|', '/', '-', '\\'] as const;

function FooterFpsCounter({ active, color }: { active: boolean; color: string }) {
  const [fps, setFps] = useState<number | null>(null);

  useEffect(() => {
    if (!active) {
      setFps(null);
      return;
    }

    let rafId = 0;
    let frameCount = 0;
    let sampleStart = performance.now();

    const sample = (now: number) => {
      frameCount += 1;
      if (now - sampleStart >= 500) {
        const nextFps = Math.round((frameCount * 1000) / (now - sampleStart));
        setFps((previous) => previous === nextFps ? previous : nextFps);
        frameCount = 0;
        sampleStart = now;
      }
      rafId = requestAnimationFrame(sample);
    };

    rafId = requestAnimationFrame(sample);
    return () => cancelAnimationFrame(rafId);
  }, [active]);

  if (fps === null) return null;

  return (
    <span
      title="Renderer frames per second"
      style={{ color, fontSize: '9px', fontFamily: 'ui-monospace, SFMono-Regular, monospace', opacity: 0.72 }}
    >
      {fps}fps
    </span>
  );
}

function formatFooterLocalCommandStatus(status: FooterLocalCommandStatus, activityFrame?: string): string {
  const detail = compactFooterStatusDetail(status.detail);
  const message = status.status === 'running' && activityFrame
    ? `[${activityFrame}] ${status.message}`
    : status.message;
  return detail ? `${message} - ${detail}` : message;
}

function compactFooterStatusDetail(value: string | undefined, maxLength = 96): string | undefined {
  const compacted = value?.replace(/\s+/g, ' ').trim();
  if (!compacted) return undefined;
  return compacted.length > maxLength
    ? `${compacted.slice(0, maxLength - 3)}...`
    : compacted;
}

type TopNavPaintTrace = {
  from: ViewMode;
  to: TopNavMode;
  source: 'tab-click';
  startedAt: number;
  highlightAppliedAt?: number;
};

function isTopNavMode(mode: ViewMode): mode is TopNavMode {
  return mode === 'clipboard' || mode === 'librarian' || mode === 'possible';
}

function traceTopNav(event: string, details: Record<string, unknown> = {}) {
  window.commandsAPI?.launcherTrace?.(event, details);
}

function shouldRestoreLibrarianImmersive(storage: Pick<Storage, 'getItem'>): boolean {
  return storage.getItem(LIBRARIAN_IMMERSIVE_STORAGE_KEY) === 'true'
    && restoreLibrarianSelection(storage)?.type === 'bookmarks';
}

function normalizeFsPathForMatch(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '');
}

function commandPathToLibraryOpenTarget(
  commandPath: string,
  libraryRoots: Array<{ path: string; builtin: boolean }> | undefined,
): FieldTheoryMarkdownTarget {
  const normalizedCommandPath = normalizeFsPathForMatch(commandPath);
  const builtinRoot = libraryRoots?.find((root) => {
    if (!root.builtin) return false;
    const normalizedRoot = normalizeFsPathForMatch(root.path);
    return normalizedCommandPath === normalizedRoot || normalizedCommandPath.startsWith(`${normalizedRoot}/`);
  });

  if (builtinRoot) {
    const normalizedRoot = normalizeFsPathForMatch(builtinRoot.path);
    const relPath = normalizedCommandPath.slice(normalizedRoot.length + 1).replace(/\.md$/i, '');
    if (relPath) return { kind: 'wiki', path: relPath };
  }

  return { kind: 'external', path: commandPath };
}

function cssTimeToMs(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  if (trimmed.endsWith('ms')) return Number.parseFloat(trimmed) || 0;
  if (trimmed.endsWith('s')) return (Number.parseFloat(trimmed) || 0) * 1000;
  return Number.parseFloat(trimmed) || 0;
}

const stableClipboardTextStyle = {
  fontVariantLigatures: 'none',
  fontKerning: 'none',
  fontFeatureSettings: '"liga" 0, "clig" 0, "kern" 0',
} as const;

function maxTransitionMs(style: CSSStyleDeclaration): number {
  const durations = style.transitionDuration.split(',').map(cssTimeToMs);
  const delays = style.transitionDelay.split(',').map(cssTimeToMs);
  return durations.reduce((max, duration, index) => {
    const delay = delays[index] ?? delays[0] ?? 0;
    return Math.max(max, duration + delay);
  }, 0);
}

const FOCUS_CHROME_ICON_SIZE_PX = 32;
const FOCUS_CHROME_ICON_TOP_PX = 48;
const FOCUS_CHROME_ICON_OPACITY = 0.62;
const FOCUS_CHROME_GROUP_REVEAL_DISTANCE_PX = 220;
const FOCUS_CHROME_TOP_FULL_OPACITY_DISTANCE_PX = 160;
const FOCUS_CHROME_EDGE_FULL_OPACITY_DISTANCE_PX = 128;
const FIELD_THEORY_APP_TITLEBAR_HEIGHT_PX = 28;
const FIELD_THEORY_CHROME_TABS_TOP_PX = 60;
const FIELD_THEORY_CHROME_TABS_BOTTOM_PX = 12;
const FIELD_THEORY_CHROME_OVERLAY_TOP_PX = 10;
const FIELD_THEORY_TOP_CHROME_DRAG_STYLE = {
  WebkitAppRegion: 'drag',
} as React.CSSProperties;
const FIELD_THEORY_TOP_CHROME_NO_DRAG_STYLE = {
  WebkitAppRegion: 'no-drag',
} as React.CSSProperties;
type ClientBounds = Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom'>;
const isClientPointOutsideBounds = (clientX: number, clientY: number, bounds: ClientBounds) => (
  clientX < bounds.left
  || clientX > bounds.right
  || clientY < bounds.top
  || clientY > bounds.bottom
);

/**
 * Check if any items in a stack have improved content.
 */
function stackHasImprovedContent(items: ClipboardItem[]): boolean {
  return items.some(item =>
    (item.type === 'text' || item.type === 'transcript') &&
    item.improvedContent
  );
}

/**
 * Combine text content from stack items into a single paragraph.
 * Items are sorted chronologically (oldest first, newest last) so reading
 * flows naturally like a paragraph being spoken over time.
 * @param useImproved - if true, uses improvedContent where available
 */
function combineStackText(items: ClipboardItem[], useImproved: boolean = false): string {
  return items
    .filter(item => (item.type === 'text' || item.type === 'transcript') && item.content)
    .sort((a, b) => a.createdAt - b.createdAt) // Oldest first, newest last
    .map(item => {
      // Use improved content if available and useImproved is true
      const text = (useImproved && item.improvedContent) ? item.improvedContent : item.content;
      return text!.trim();
    })
    .join('\n\n');
}

/**
 * DraggableDroppableRow - wrapper that makes a row both draggable and a drop target.
 * Uses dnd-kit's useDraggable and useDroppable hooks.
 */
// Memoized thumbnail component. Uses thumbnailData for list display, fetches full image on-demand.
const StackImageThumbnail = React.memo(function StackImageThumbnail({
  item,
  onHover,
  onPreview,
}: {
  item: ClipboardItem;
  onHover: (id: number | null) => void;
  onPreview: (preview: { type: 'image'; data: string; width: number; height: number; itemId: number; stackId: string | null; figureLabel?: string } | null) => void;
}) {
  const { theme } = useTheme();
  const [loadedFullImageData, setLoadedFullImageData] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // For display: prefer thumbnail, then fall back to imageData (for small images or legacy).
  const thumbnailForDisplay = item.thumbnailData || item.imageData;
  
  // For preview: use loaded full data, or fall back to imageData if available.
  const fullImageData = loadedFullImageData || item.imageData;

  // Memoize the thumbnail data URL for list display (~10KB, very fast).
  const thumbnailUrl = useMemo(
    () => thumbnailForDisplay ? `data:image/png;base64,${thumbnailForDisplay}` : null,
    [thumbnailForDisplay]
  );

  // Fetch full image data on demand for preview modal.
  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    
    // If we don't have full imageData, fetch it.
    if (!fullImageData && !isLoading) {
      setIsLoading(true);
      try {
        const fullItem = await window.clipboardAPI?.getItem?.(item.id);
        if (fullItem?.imageData) {
          setLoadedFullImageData(fullItem.imageData);
          onPreview({
            type: 'image',
            data: fullItem.imageData,
            width: fullItem.imageWidth || 0,
            height: fullItem.imageHeight || 0,
            itemId: fullItem.id,
            stackId: fullItem.stackId,
            figureLabel: fullItem.figureLabel ?? undefined,
          });
        }
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // We have full imageData, show preview directly.
    if (fullImageData) {
      onPreview({
        type: 'image',
        data: fullImageData,
        width: item.imageWidth || 0,
        height: item.imageHeight || 0,
        itemId: item.id,
        stackId: item.stackId,
        figureLabel: item.figureLabel ?? undefined,
      });
    }
  };

  return (
    <div
      onMouseEnter={() => onHover(item.id)}
      onMouseLeave={() => onHover(null)}
      style={{ position: 'relative' }}
      onClick={handleClick}
    >
      {thumbnailUrl ? (
        <img
          src={thumbnailUrl}
          alt="Screenshot preview"
          style={{
            height: '50px',
            width: 'auto',
            borderRadius: '4px',
            border: `1px solid ${theme.border}`,
            cursor: 'pointer',
          }}
        />
      ) : (
        // Placeholder for images without thumbnails (legacy items before migration).
        <div
          style={{
            height: '50px',
            width: item.imageWidth && item.imageHeight 
              ? `${Math.round(50 * (item.imageWidth / item.imageHeight))}px`
              : '66px',
            borderRadius: '4px',
            border: `1px solid ${theme.border}`,
            backgroundColor: theme.isDark ? theme.surface2 : (isLoading ? '#e8e8e8' : '#f0f0f0'),
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            fontSize: '9px',
            color: theme.textSecondary,
          }}
        >
          {isLoading ? '...' : '📷'}
        </div>
      )}
      {/* Figure label badge */}
      {item.figureLabel && (
        <div style={{
          position: 'absolute',
          bottom: '2px',
          left: '2px',
          backgroundColor: 'rgba(0, 0, 0, 0.7)',
          color: '#fff',
          fontSize: '9px',
          fontWeight: 600,
          padding: '1px 4px',
          borderRadius: '3px',
          letterSpacing: '0.5px',
        }}>
          {item.figureLabel}
        </div>
      )}
    </div>
  );
});

/**
 * ClipboardHistory component - Alfred-style popup for clipboard history.
 */
export default function ClipboardHistory() {
  const documentWindowInitialTarget = getDocumentWindowInitialTarget(window.location);
  return <ClipboardHistoryApp initialLibraryOpenTarget={documentWindowInitialTarget} />;
}

function ClipboardHistoryApp({ initialLibraryOpenTarget = null }: { initialLibraryOpenTarget?: FieldTheoryMarkdownTarget | null }) {
  const { theme, toggleDarkMode } = useTheme();
  const scratchpadHotkeyRef = useRef('');
  const [isVisible, setIsVisible] = useState(false);
  const [isWindowVisible, setIsWindowVisible] = useState(document.visibilityState === 'visible');
  const [windowStyleTransition, setWindowStyleTransition] = useState<'idle' | 'out' | 'in'>(() => {
    if (localStorage.getItem(WINDOW_STYLE_TRANSITION_IN_KEY) === 'true') return 'in';
    return 'idle';
  });

  // When the window hides, the auto-popped-artifact exception expires: next
  // open is a fresh session and Escape should follow the normal hierarchy.
  useEffect(() => {
    if (!isWindowVisible) setAutoPopArtifactPath(null);
  }, [isWindowVisible]);
  useEffect(() => {
    const handler = () => setIsWindowVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, []);
  useEffect(() => {
    let cancelled = false;
    const setScratchpadHotkey = (hotkey: string | null | undefined) => {
      scratchpadHotkeyRef.current = normalizeHotkeyForComparison(hotkey);
    };
    void window.hotkeyAPI?.getHotkey('scratchpad').then((hotkey) => {
      if (!cancelled) setScratchpadHotkey(hotkey);
    });

    const hotkeyChangedHandler = (event: Event) => {
      setScratchpadHotkey((event as CustomEvent<string>).detail);
    };
    const handler = (event: KeyboardEvent) => {
      if (event.repeat) return;
      const configuredHotkey = scratchpadHotkeyRef.current;
      if (!configuredHotkey) return;
      if (!hasNonShiftModifierHotkey(configuredHotkey)) return;
      if (normalizeHotkeyForComparison(buildHotkeyString(event)) !== configuredHotkey) return;
      event.preventDefault();
      event.stopPropagation();
      void (async () => {
        const page = await window.wikiAPI?.openScratchpadDefault();
        if (page) dispatchLocalWikiAdded(page);
      })();
    };

    window.addEventListener('fieldtheory:scratchpad-hotkey-changed', hotkeyChangedHandler);
    document.addEventListener('keydown', handler, true);
    return () => {
      cancelled = true;
      window.removeEventListener('fieldtheory:scratchpad-hotkey-changed', hotkeyChangedHandler);
      document.removeEventListener('keydown', handler, true);
    };
  }, []);
  useEffect(() => {
    if (windowStyleTransition !== 'in') return;
    localStorage.removeItem(WINDOW_STYLE_TRANSITION_IN_KEY);
    const frame = requestAnimationFrame(() => {
      setWindowStyleTransition('idle');
    });
    return () => cancelAnimationFrame(frame);
  }, [windowStyleTransition]);
  useEffect(() => {
    const unsubscribe = window.clipboardAPI?.onWindowStyleTransitionOut?.(() => {
      setWindowStyleTransition('out');
      window.setTimeout(() => {
        window.clipboardAPI?.windowStyleTransitionReady?.();
      }, 140);
    });
    return () => unsubscribe?.();
  }, []);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsSection, setSettingsSection] = useState<string | undefined>(undefined);

  const [viewMode, setViewMode] = useState<ViewMode>(() => initialLibraryOpenTarget ? 'librarian' : resolveClipboardRestoreState(localStorage).viewMode);
  const [librarianEverRendered, setLibrarianEverRendered] = useState(() => viewMode === 'librarian');

  const [editingSketchItem, setEditingSketchItem] = useState<ClipboardItem | null>(null);
  const [sketchBackgroundImage, setSketchBackgroundImage] = useState<{
    dataUrl: string;
    width: number;
    height: number;
  } | null>(null);
  const [sketchAssociatedTranscripts, setSketchAssociatedTranscripts] = useState<ClipboardItem[]>([]);
  const [items, setItems] = useState<ClipboardItem[]>([]);
  const [stacks, setStacks] = useState<StackInfo[]>([]);
  const [hydratedStackItemsById, setHydratedStackItemsById] = useState<Record<string, ClipboardItem[]>>({});
  const [expandedStacks, setExpandedStacks] = useState<Set<string>>(new Set());
  const [expandedItems, setExpandedItems] = useState<Set<number>>(new Set());
  const [overflowingTexts, setOverflowingTexts] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');
  const [sourceFilter, setSourceFilter] = useState<SourceFilterType>('all');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [isMultiSelect, setIsMultiSelect] = useState(false);
  const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null);
  const [undoStack, setUndoStack] = useState<UndoAction[]>([]);
  const [redoStack, setRedoStack] = useState<UndoAction[]>([]);

  // Librarian legacy immersive mode. Kept for Bookmarks; normal Library docs use focus chrome.
  const [librarianImmersive, setLibrarianImmersive] = useState(
    () => initialLibraryOpenTarget ? false : shouldRestoreLibrarianImmersive(localStorage)
  );
  // Sidebar collapse state lives here so the footer toggle can drive it
  // regardless of which view is currently active. Shared between Library and
  // Commands views so the toggle has consistent behavior.
  const [navSidebarCollapsed, setNavSidebarCollapsed] = useState<boolean>(
    () => initialLibraryOpenTarget?.focusChrome === true
      || initialLibraryOpenTarget?.sidebarCollapsed === true
      || localStorage.getItem('librarian-sidebar-collapsed') === '1'
  );
  const skipInitialSidebarCollapsedPersistRef = useRef(
    initialLibraryOpenTarget?.focusChrome === true || initialLibraryOpenTarget?.sidebarCollapsed === true
  );
  useEffect(() => {
    if (skipInitialSidebarCollapsedPersistRef.current) {
      skipInitialSidebarCollapsedPersistRef.current = false;
      return;
    }
    localStorage.setItem('librarian-sidebar-collapsed', navSidebarCollapsed ? '1' : '0');
  }, [navSidebarCollapsed]);
  const [librarySidebarToggleRequestKey, setLibrarySidebarToggleRequestKey] = useState(0);
  const librarianSurfaceVisible = isLibrarianSurfaceVisible({ viewMode, showSettings });
  const keepLibrarianMounted = shouldKeepLibrarianMounted({ viewMode, librarianEverRendered });
  const navSidebarToggleEnabled = isNavSidebarToggleEnabled({
    viewMode,
    showSettings,
    librarianImmersive,
  });
  const [librarianEnabled, setLibrarianEnabled] = useState(() => {
    const saved = localStorage.getItem('librarianEnabled');
    return saved !== 'false'; // Default to true
  });
  const topNavPaintTraceRef = useRef<TopNavPaintTrace | null>(null);
  const viewModeRef = useRef(viewMode);
  const appNavigationSurfaceRef = useRef<AppNavigationSurface>(getAppNavigationSurface({ viewMode, showSettings }));
  const appBackHistoryRef = useRef<AppNavigationSurface[]>([]);
  const appForwardHistoryRef = useRef<AppNavigationSurface[]>([]);
  const appHistoryNavigationRef = useRef(false);
  const previousSizeViewModeRef = useRef(viewMode);
  const [libraryKeepsCurrentSizeKey, setLibraryKeepsCurrentSizeKey] = useState(false);
  useEffect(() => {
    viewModeRef.current = viewMode;
  }, [viewMode]);
  useEffect(() => {
    const nextSurface = getAppNavigationSurface({ viewMode, showSettings });
    const previousSurface = appNavigationSurfaceRef.current;
    if (appHistoryNavigationRef.current) {
      appHistoryNavigationRef.current = false;
      appNavigationSurfaceRef.current = nextSurface;
      return;
    }

    appBackHistoryRef.current = pushAppNavigationHistory(
      appBackHistoryRef.current,
      previousSurface,
      nextSurface,
    );
    if (previousSurface !== nextSurface) {
      appForwardHistoryRef.current = [];
    }
    appNavigationSurfaceRef.current = nextSurface;
  }, [showSettings, viewMode]);
  const applyAppNavigationSurface = useCallback((surface: AppNavigationSurface) => {
    appHistoryNavigationRef.current = true;
    if (surface === 'settings') {
      setShowSettings(true);
      return;
    }

    setShowSettings(false);
    setViewMode(surface);
  }, []);
  const navigateAppHistory = useCallback((direction: -1 | 1): boolean => {
    const current = appNavigationSurfaceRef.current;
    const result = direction < 0
      ? popAppBackHistory({
        backHistory: appBackHistoryRef.current,
        forwardHistory: appForwardHistoryRef.current,
        current,
      })
      : popAppForwardHistory({
        backHistory: appBackHistoryRef.current,
        forwardHistory: appForwardHistoryRef.current,
        current,
      });

    if (!result.target) return false;
    appBackHistoryRef.current = result.backHistory;
    appForwardHistoryRef.current = result.forwardHistory;
    applyAppNavigationSurface(result.target);
    return true;
  }, [applyAppNavigationSurface]);
  const applyTopNavVisualMode = useCallback((mode: TopNavMode): number => {
    const appliedAt = performance.now();
    document.querySelectorAll<HTMLElement>('[data-top-nav-mode]').forEach((button) => {
      const selected = button.dataset.topNavMode === mode;
      button.style.backgroundColor = selected ? theme.accent : 'transparent';
      button.style.color = selected ? '#fff' : theme.textSecondary;
    });
    return appliedAt;
  }, [theme.accent, theme.textSecondary]);
  // Track if a new reading is available (shows blue dot indicator on Librarian tab)
  const [hasNewReading, setHasNewReading] = useState(false);
  const [pendingReadingPath, setPendingReadingPath] = useState<string | null>(null);
  const [pendingLibraryOpenTarget, setPendingLibraryOpenTarget] = useState<FieldTheoryMarkdownTarget | null>(initialLibraryOpenTarget);
  // Path of an artifact the librarian auto-popped that the user hasn't navigated
  // away from yet. While this is set, Escape can dismiss the popup-style window.
  const [autoPopArtifactPath, setAutoPopArtifactPath] = useState<string | null>(null);
  const [focusChromeChildActive, setFocusChromeChildActive] = useState(false);
  const [focusChromeGlobalEnabled, setFocusChromeGlobalEnabledState] = useState(
    () => initialLibraryOpenTarget?.focusChrome === true
  );
  const [focusChromeGroupOpacity, setFocusChromeGroupOpacity] = useState(0);
  const [focusChromeContentCenterX, setFocusChromeContentCenterX] = useState<number | null>(null);
  const [themeToggleProximityVisible, setThemeToggleProximityVisible] = useState(false);
  const [bookmarksCanvasChromeActive, setBookmarksCanvasChromeActive] = useState(false);
  const [bookmarksCanvasToolbarTop, setBookmarksCanvasToolbarTop] = useState<number | null>(null);
  const focusChromeGlobalEnabledRef = useRef(initialLibraryOpenTarget?.focusChrome === true);
  const focusChromePreviousSidebarCollapsedRef = useRef<boolean | null>(null);
  const setFocusChromeGlobalEnabled = useCallback((enabled: boolean) => {
    focusChromeGlobalEnabledRef.current = enabled;
    setFocusChromeGlobalEnabledState(enabled);
  }, []);
  const isFocusChromeSurface = viewMode === 'librarian' && !showSettings;
  const focusChromeSurfaceEnabled = focusChromeChildActive || focusChromeGlobalEnabled;
  const focusChromeOverlayActive = isFocusChromeSurface && focusChromeSurfaceEnabled;
  const appChromeOpacity = getFocusChromeSurfaceOpacity({
    isFocusChromeSurface,
    focusChromeActive: focusChromeSurfaceEnabled,
  });
  const footerChromeOpacity = focusChromeOverlayActive ? 0 : 1;
  const appChromeInteractive = appChromeOpacity > 0.05;
  const footerChromeInteractive = footerChromeOpacity > 0.05;
  const appChromeHidden = focusChromeOverlayActive && !appChromeInteractive;
  const focusChromeIconOpacity = focusChromeOverlayActive ? FOCUS_CHROME_ICON_OPACITY : 0;
  const showFocusChromeIcon = focusChromeOverlayActive;
  const footerChromeHidden = bookmarksCanvasChromeActive || (focusChromeOverlayActive && !footerChromeInteractive);
  const enableGlobalFocusChrome = useCallback(() => {
    if (focusChromePreviousSidebarCollapsedRef.current === null) {
      focusChromePreviousSidebarCollapsedRef.current = navSidebarCollapsed;
    }
    setFocusChromeGlobalEnabled(true);
    setNavSidebarCollapsed(true);
  }, [navSidebarCollapsed]);
  const disableGlobalFocusChrome = useCallback(() => {
    setFocusChromeGlobalEnabled(false);
    setFocusChromeGroupOpacity(0);

    const previous = focusChromePreviousSidebarCollapsedRef.current;
    if (previous === null) return;
    focusChromePreviousSidebarCollapsedRef.current = null;
    setNavSidebarCollapsed(previous);
  }, []);
  const handleGlobalFocusChromeChange = useCallback((enabled: boolean) => {
    if (enabled) {
      enableGlobalFocusChrome();
    } else {
      disableGlobalFocusChrome();
    }
  }, [disableGlobalFocusChrome, enableGlobalFocusChrome]);
  const toggleNavSidebarCollapsed = useCallback(() => {
    if (!navSidebarToggleEnabled) return;
    setNavSidebarCollapsed((collapsed) => {
      if (focusChromeSurfaceEnabled && collapsed) {
        setFocusChromeGlobalEnabled(false);
        focusChromePreviousSidebarCollapsedRef.current = null;
        setFocusChromeGroupOpacity(0);
      }
      return !collapsed;
    });
  }, [focusChromeSurfaceEnabled, navSidebarToggleEnabled]);
  const handleFocusChromeActiveChange = useCallback((active: boolean) => {
    setFocusChromeChildActive(active);
    if (!active && !focusChromeGlobalEnabledRef.current) {
      setFocusChromeGroupOpacity(0);

      const previous = focusChromePreviousSidebarCollapsedRef.current;
      if (previous === null) return;
      focusChromePreviousSidebarCollapsedRef.current = null;
      setNavSidebarCollapsed(previous);
    }
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!navSidebarToggleEnabled || !isSidebarToggleShortcut(event)) return;
      event.preventDefault();
      toggleNavSidebarCollapsed();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navSidebarToggleEnabled, toggleNavSidebarCollapsed]);

  useEffect(() => {
    if (!focusChromeOverlayActive) {
      setFocusChromeGroupOpacity(0);
      return;
    }

    const updateProximity = (event: MouseEvent) => {
      const opacity = getGroupedFocusChromeProximityOpacity({
        cursorClientY: event.clientY,
        paneClientTop: 0,
        viewportHeight: window.innerHeight,
        revealDistancePx: FOCUS_CHROME_GROUP_REVEAL_DISTANCE_PX,
        fullOpacityDistancePx: FOCUS_CHROME_EDGE_FULL_OPACITY_DISTANCE_PX,
        topFullOpacityDistancePx: FOCUS_CHROME_TOP_FULL_OPACITY_DISTANCE_PX,
      });
      setFocusChromeGroupOpacity(opacity);
    };
    const hideProximityChrome = (event: MouseEvent) => {
      if (!isClientPointOutsideBounds(event.clientX, event.clientY, {
        left: 0,
        top: 0,
        right: window.innerWidth,
        bottom: window.innerHeight,
      })) return;
      setFocusChromeGroupOpacity(0);
    };

    window.addEventListener('mousemove', updateProximity);
    window.addEventListener('mouseleave', hideProximityChrome);
    return () => {
      window.removeEventListener('mousemove', updateProximity);
      window.removeEventListener('mouseleave', hideProximityChrome);
    };
  }, [focusChromeOverlayActive]);
  useEffect(() => {
    if (!appChromeHidden) setThemeToggleProximityVisible(false);
  }, [appChromeHidden]);
  const handleLibrarianSwitchToClipboard = useCallback(() => {
    setLibraryKeepsCurrentSizeKey(false);
    setViewMode('clipboard');
  }, []);
  const handleLibrarianSwitchToSettings = useCallback(() => setShowSettings(true), []);
  const handleLibrarianReadingConsumed = useCallback(() => setPendingReadingPath(null), []);
  const handleLibrarianOpenTargetConsumed = useCallback(() => setPendingLibraryOpenTarget(null), []);
  const handleAutoPopArtifactSuperseded = useCallback(() => setAutoPopArtifactPath(null), []);
  const openCommandPathInLibrary = useCallback((path: string) => {
    setShowSettings(false);
    setLibraryKeepsCurrentSizeKey(false);
    setViewMode('librarian');
    void (async () => {
      const roots = await window.libraryAPI?.getRoots?.().catch(() => undefined);
      setPendingLibraryOpenTarget(commandPathToLibraryOpenTarget(path, roots));
    })();
  }, []);
  const handleLibrarianOpenCommandPath = useCallback((path: string) => {
    openCommandPathInLibrary(path);
  }, [openCommandPathInLibrary]);
  const selectTopNavView = useCallback((mode: TopNavMode) => {
    const previous = viewModeRef.current;
    if (mode === 'librarian' && previous === 'librarian' && !showSettings) {
      if (navSidebarCollapsed) {
        setLibrarySidebarToggleRequestKey((key) => key + 1);
      } else {
        setNavSidebarCollapsed(true);
      }
    }
    if (previous !== mode || showSettings) {
      const startedAt = performance.now();
      const highlightAppliedAt = applyTopNavVisualMode(mode);
      viewModeRef.current = mode;
      traceTopNav('top-nav-switch-start', {
        source: 'tab-click',
        from: previous,
        to: mode,
        activeTag: document.activeElement?.tagName ?? null,
        activeTopNavMode: (document.activeElement as HTMLElement | null)?.dataset?.topNavMode ?? null,
      });
      topNavPaintTraceRef.current = {
        from: previous,
        to: mode,
        source: 'tab-click',
        startedAt,
        highlightAppliedAt,
      };
    }
    setLibraryKeepsCurrentSizeKey(mode === 'librarian' && previous === 'clipboard');
    setViewMode(mode);
    setShowSettings(false);
  }, [applyTopNavVisualMode, navSidebarCollapsed, showSettings]);

  // Tasks tab visibility - hidden by default, toggled with Shift+Cmd+T
  const [tasksTabEnabled, setTasksTabEnabled] = useState(false);
  const [fieldTheorySyncEnabled, setFieldTheorySyncEnabled] = useState(false);

  // Layout variant - B8 is the official layout
  const layoutVariant = 'B8' as const;

  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const clipboardSurfaceActive = isVisible && isWindowVisible && !showSettings && viewMode === 'clipboard';
  const clipboardSurfaceActiveRef = useRef(clipboardSurfaceActive);

  useEffect(() => {
    clipboardSurfaceActiveRef.current = clipboardSurfaceActive;
  }, [clipboardSurfaceActive]);

  useEffect(() => {
    if (!showSettings && viewMode === 'librarian') {
      setLibrarianEverRendered(true);
    }
  }, [showSettings, viewMode]);

  // Shared clipboard state (sharing to shared clipboard from clipboard view).
  const [sharingToTeam, setSharingToTeam] = useState<number | null>(null);
  const [sharedToTeamId, setSharedToTeamId] = useState<string | null>(null); // For success flash.
  const [copiedItemId, setCopiedItemId] = useState<string | null>(null); // For "copied" flash.
  
  // Sign-in prompt modal - shown when user tries to share without being logged in.
  const [showSignInPrompt, setShowSignInPrompt] = useState(false);
  
  const handleRendererSignedOut = useCallback(() => {
    setHasUnreadFeedback(false);
    setViewMode('clipboard');
  }, []);

  const {
    session: authSession,
    initialized: sessionInitialized,
  } = useAuthSessionBridge({
    supabase,
    onSignedOut: handleRendererSignedOut,
  });

  // User's callsign from profile
  const [userCallsign, setUserCallsign] = useState<string | null>(null);
  
  // Screen recording permission banner state.
  // Shows a banner when permission is missing, unless user has dismissed it.
  const [screenRecordingGranted, setScreenRecordingGranted] = useState(true);
  const [hideScreenRecordingBanner, setHideScreenRecordingBanner] = useState(true);
  
  // Track which items/stacks the user wants to view as original (toggle from improved).
  // Items in this set show original content even if improved content is available.
  const [viewOriginalIds, setViewOriginalIds] = useState<Set<string>>(new Set());
  
  // Hover states for UI interactions
  const [hoveredImageId, setHoveredImageId] = useState<number | null>(null);
  
  type PreviewContent =
    | { type: 'image'; data: string; width: number; height: number; itemId: number; stackId: string | null; figureLabel?: string }
    | { type: 'text'; content: string };
  const [preview, setPreview] = useState<PreviewContent | null>(null);
  const [previewClosing, setPreviewClosing] = useState(false);
  
  // Stack preview navigation - tracks position within a stack's preview items.
  // For stacks: images are shown individually, text is combined into one item at the end.
  const [stackPreviewIndex, setStackPreviewIndex] = useState(0);
  const [stackPreviewItems, setStackPreviewItems] = useState<PreviewContent[]>([]);
  
  // Cache for prefetched full image data (for instant preview navigation).
  const imageCache = useRef<Map<number, string>>(new Map());
  
  // Fetch full image data for an item, using cache if available.
  const getFullImageData = useCallback(async (itemId: number, existingImageData?: string | null): Promise<string | null> => {
    // If we already have the full image data, return it.
    if (existingImageData) return existingImageData;
    
    // Check cache first.
    const cached = imageCache.current.get(itemId);
    if (cached) return cached;
    
    // Fetch from backend.
    const fullItem = await window.clipboardAPI?.getItem?.(itemId);
    if (fullItem?.imageData) {
      imageCache.current.set(itemId, fullItem.imageData);
      return fullItem.imageData;
    }
    return null;
  }, []);
  
  // Prefetch full images for items (for smooth preview navigation).
  const prefetchImages = useCallback(async (itemIds: number[]) => {
    const idsToFetch = itemIds.filter(id => !imageCache.current.has(id));
    if (idsToFetch.length === 0) return;
    
    // Fetch in parallel but don't await - fire and forget for prefetching.
    idsToFetch.forEach(async (id) => {
      try {
        const item = await window.clipboardAPI?.getItem?.(id);
        if (item?.imageData) {
          imageCache.current.set(id, item.imageData);
        }
      } catch {
        // Silently ignore prefetch errors
      }
    });
  }, []);
  
  // Build the preview sequence for a stack: [image1, image2, ..., combinedText].
  // Uses cached images if available, or returns items that need loading.
  const getStackPreviewItems = useCallback((items: ClipboardItem[]): PreviewContent[] => {
    const previewItems: PreviewContent[] = [];

    // Add each image as a separate preview item with its ID and stackId.
    // Use cached data if available, otherwise use thumbnail/placeholder.
    for (const item of items) {
      if (item.imageData || item.thumbnailData) {
        // Check cache for full image, otherwise use what we have.
        const cachedFullImage = imageCache.current.get(item.id);
        previewItems.push({
          type: 'image',
          data: cachedFullImage || item.imageData || item.thumbnailData || '',
          width: item.imageWidth || 0,
          height: item.imageHeight || 0,
          itemId: item.id,
          stackId: item.stackId,
          figureLabel: item.figureLabel ?? undefined,
        });
      }
    }

    // Combine all text into one preview item at the end.
    const combinedText = items
      .filter(i => i.content)
      .map(i => i.content)
      .join('\n\n');
    if (combinedText) {
      previewItems.push({ type: 'text', content: combinedText });
    }

    return previewItems;
  }, []);
  
  const clearPreview = useCallback(() => {
    setPreview(null);
    setPreviewClosing(false);
    setStackPreviewIndex(0);
    setStackPreviewItems([]);
  }, []);

  const dismissPreview = () => {
    if (!preview || previewClosing) return;
    setPreviewClosing(true);
    setTimeout(clearPreview, 150);
  };
  
  // Get preview for a row, using cache if available.
  const getPreviewForRow = useCallback((row: ListRow): PreviewContent | null => {
    if (row.type === 'item') {
      const item = row.item;
      if (item.imageData || item.thumbnailData) {
        // Use cached full image if available.
        const cachedFullImage = imageCache.current.get(item.id);
        return {
          type: 'image',
          data: cachedFullImage || item.imageData || item.thumbnailData || '',
          width: item.imageWidth || 0,
          height: item.imageHeight || 0,
          itemId: item.id,
          stackId: item.stackId,
          figureLabel: item.figureLabel ?? undefined,
        };
      } else if (item.content) {
        return { type: 'text', content: item.content };
      }
    } else if (row.type === 'stack') {
      const imageItem = row.items.find(i => i.imageData || i.thumbnailData);
      if (imageItem) {
        const cachedFullImage = imageCache.current.get(imageItem.id);
        return {
          type: 'image',
          data: cachedFullImage || imageItem.imageData || imageItem.thumbnailData || '',
          width: imageItem.imageWidth || 0,
          height: imageItem.imageHeight || 0,
          itemId: imageItem.id,
          stackId: imageItem.stackId,
          figureLabel: imageItem.figureLabel ?? undefined,
        };
      } else {
        const combinedText = row.items
          .filter(i => i.content)
          .map(i => i.content)
          .join('\n\n');
        if (combinedText) {
          return { type: 'text', content: combinedText };
        }
      }
    }
    return null;
  }, []);
  
  // Load full image and update preview if it's the currently displayed one.
  const loadFullImageForPreview = useCallback(async (itemId: number, currentPreview: PreviewContent | null) => {
    const fullImageData = await getFullImageData(itemId);
    if (fullImageData && currentPreview?.type === 'image' && currentPreview.itemId === itemId) {
      // Update preview with full image if still viewing this item.
      setPreview(prev => {
        if (prev?.type === 'image' && prev.itemId === itemId) {
          return { ...prev, data: fullImageData };
        }
        return prev;
      });
    }
  }, [getFullImageData]);
  
  // Helper: Update preview for a row during navigation.
  // Shows preview immediately (with thumbnail/cached data), then loads full image.
  // Also prefetches adjacent images for smooth navigation.
  const updatePreviewForRow = useCallback((row: ListRow) => {
    if (row.type === 'stack') {
      const previewItems = getStackPreviewItems(row.items);
      if (previewItems.length > 0) {
        setStackPreviewItems(previewItems);
        setStackPreviewIndex(0);
        setPreview(previewItems[0]);
        // Load full image for the first item if needed.
        const firstImageItem = row.items.find(i => i.imageData || i.thumbnailData);
        if (firstImageItem && !imageCache.current.has(firstImageItem.id) && !firstImageItem.imageData) {
          loadFullImageForPreview(firstImageItem.id, previewItems[0]);
        }
        // Prefetch all images in the stack.
        const imageItemIds = row.items
          .filter(i => i.imageData || i.thumbnailData)
          .map(i => i.id);
        prefetchImages(imageItemIds);
      }
    } else {
      setStackPreviewItems([]);
      setStackPreviewIndex(0);
      const newContent = getPreviewForRow(row);
      if (newContent) {
        setPreview(newContent);
        // Load full image if needed.
        if (newContent.type === 'image' && !imageCache.current.has(newContent.itemId) && !row.item.imageData) {
          loadFullImageForPreview(newContent.itemId, newContent);
        }
      }
    }
  }, [getStackPreviewItems, getPreviewForRow, loadFullImageForPreview, prefetchImages]);
  
  const [isRecording, setIsRecording] = useState(false);
  const [transcriptionStatus, setTranscriptionStatus] = useState<'idle' | 'recording' | 'transcribing'>('idle');
  
  // Audio state for Priority Mic dropdown.
  type AudioDevice = { id: string; name: string; isInput: boolean };
  const [audioDevices, setAudioDevices] = useState<AudioDevice[]>([]);
  const [priorityDeviceId, setPriorityDeviceId] = useState<string | null>(null);
  const [showMicDropdown, setShowMicDropdown] = useState(false);

  const [hasUnreadFeedback, setHasUnreadFeedback] = useState(false);
  const [sketchHasChanges, setSketchHasChanges] = useState(false);
  const [lastSeenItemId, setLastSeenItemId] = useState<number | string | null>(() => {
    try {
      const stored = localStorage.getItem('lastSeenItemId');
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });
  
  // Update notification state.
  type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'installing' | 'error' | 'uptodate';
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>('idle');
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [showUpdateErrorModal, setShowUpdateErrorModal] = useState(false);

  // Network status for update checks.
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // App version for footer display.
  const [appVersion] = useState(() => window.updaterAPI?.getVersion?.() || '0.0.0');
  const [updaterEnabled] = useState(() => window.updaterAPI?.isEnabled?.() ?? true);
  
  // Release notes popup - shows once automatically after update, or manually via toggle button.
  const [showReleaseNotes, setShowReleaseNotes] = useState(false);
  // Whether the popup is showing in "Latest" mode (user clicked while up-to-date) vs "What's new" mode.
  const [releaseNotesLatestMode, setReleaseNotesLatestMode] = useState(false);
  const [versionHovered, setVersionHovered] = useState(false);
  
  const [allTimeStats, setAllTimeStats] = useState<{
    stacks: number;
    transcriptions: number;
    screenshots: number;
    improved: number;
    words: number;
    voiceCommands: number;
    commandsUsed: number;
    autoStacks: number;
  }>({
    stacks: 0, transcriptions: 0, screenshots: 0, improved: 0, words: 0, voiceCommands: 0, commandsUsed: 0, autoStacks: 0,
  });
  
  const [cachedTier, setCachedTier] = useState<'free' | 'pro'>('free');
  const [priorityMicQuotaExhausted, setPriorityMicQuotaExhausted] = useState(false);

  // Narration playback state for footer controls
  const [narrationPlayback, setNarrationPlayback] = useState<{
    status: 'idle' | 'generating' | 'playing' | 'paused';
    readingPath: string | null;
    duration: number;
  }>({ status: 'idle', readingPath: null, duration: 0 });
  const [narrationProgress, setNarrationProgress] = useState(0); // percentage 0-100
  
  // Show in Dock - affects header padding for stoplight buttons.
  const [showInDock, setShowInDock] = useState(false);
  const appTitlebarOffsetPx = showInDock ? FIELD_THEORY_APP_TITLEBAR_HEIGHT_PX : 0;
  const chromeTabsTopPx = FIELD_THEORY_CHROME_TABS_TOP_PX - appTitlebarOffsetPx;
  const focusChromeIconTop = bookmarksCanvasToolbarTop === null
    ? FOCUS_CHROME_ICON_TOP_PX
    : Math.max(8, Math.round(bookmarksCanvasToolbarTop / 2 - FOCUS_CHROME_ICON_SIZE_PX / 2));

  // Center footer logo visibility follows the old fieldtheory.dev footer setting.
  const [showFieldTheoryLink, setShowFieldTheoryLink] = useState(true);

  // In-app performance HUD visibility.
  const [performanceHudEnabled, setPerformanceHudEnabled] = useState(false);

  // Show release notes once after app update (not on fresh install)
  useEffect(() => {
    const lastSeenVersion = localStorage.getItem('lastSeenReleaseNotesVersion');

    // If versions differ and we have release notes for current version, show popup once
    if (lastSeenVersion !== appVersion && hasReleaseNotes(appVersion)) {
      // Only auto-show if this isn't a fresh install (lastSeenVersion exists)
      if (lastSeenVersion !== null) {
        setShowReleaseNotes(true);
        setReleaseNotesLatestMode(false); // "What's new" mode, not "Latest" mode
      }
      // Save immediately so we don't show again (even if user quits before dismissing)
      localStorage.setItem('lastSeenReleaseNotesVersion', appVersion);
    }
  }, [appVersion]);

  useEffect(() => {
    if (!isVisible) return;

    // Sync from Supabase first, then load metrics (ensures we have latest data).
    const loadMetrics = () => {
      window.metricsAPI?.getMetrics?.().then(metrics => {
        setAllTimeStats({
          stacks: metrics.stacks_created || 0,
          transcriptions: metrics.transcriptions || 0,
          screenshots: metrics.screenshots_taken || 0,
          improved: metrics.words_improved || 0,
          words: metrics.words_transcribed || 0,
          voiceCommands: metrics.verbal_commands || 0,
          commandsUsed: metrics.command_launcher_uses || 0,
          autoStacks: metrics.autostacks_created || 0,
        });
      }).catch(err => {
        console.error('[ClipboardHistory] Failed to load metrics:', err);
      });
    };

    // Fetch from server first (merges with local), then read
    window.metricsAPI?.fetchFromSupabase?.().finally(loadMetrics);
  }, [isVisible, authSession?.user?.id]); // Refresh stats when user changes
  
  // Load show in dock setting (affects header layout for stoplight buttons).
  useEffect(() => {
    window.clipboardAPI?.getShowInDock?.().then(show => {
      setShowInDock(show);
    });
  }, [isVisible]);

  // Load show fieldtheory.dev link setting.
  useEffect(() => {
    window.clipboardAPI?.getShowFieldTheoryLink?.().then(show => {
      setShowFieldTheoryLink(show);
    });
  }, [isVisible]);

  // Load in-app performance HUD setting.
  useEffect(() => {
    window.clipboardAPI?.getPerformanceHudEnabled?.().then(enabled => {
      setPerformanceHudEnabled(enabled);
    });
  }, [isVisible]);
  
  // Fetch release access state on mount and when visibility changes.
  useEffect(() => {
    if (!isVisible || !window.quotaAPI) return;
    
    const fetchQuotas = async () => {
      try {
        const quotas = await window.quotaAPI?.getQuotas();
        if (quotas) {
          const isPro = quotas.tier === 'pro';
          setCachedTier(isPro ? 'pro' : 'free');
          setPriorityMicQuotaExhausted(!quotas.priorityMic.allowed);
        }
      } catch (err) {
        console.error('[ClipboardHistory] Failed to load release access state:', err);
      }
    };
    
    fetchQuotas();
    
    // Re-fetch quotas when tier changes (e.g., after Stripe subscription).
    const unsubscribeTier = window.quotaAPI?.onTierChanged?.(() => {
      fetchQuotas();
    });
    
    return () => {
      unsubscribeTier?.();
    };
  }, [isVisible]);
  
  // Local-first release access is usage-only; quota changes should not block tools.
  
  // Listen for quota changes in case the cached tier changes after a server refresh.
  useEffect(() => {
    if (!window.quotaAPI?.onQuotaChanged) return;

    const cleanup = window.quotaAPI.onQuotaChanged(async () => {
      const quotas = await window.quotaAPI?.getQuotas();
      if (quotas) {
        setCachedTier(quotas.tier === 'pro' ? 'pro' : 'free');
        setPriorityMicQuotaExhausted(!quotas.priorityMic.allowed);
      }
    });

    return cleanup;
  }, []);

  // Subscribe to narration playback events for footer controls (feature flagged)
  useEffect(() => {
    if (!FEATURE_NARRATION_ENABLED || !window.narrationAPI) return;

    const unsubGenerating = window.narrationAPI.onGenerationStarted?.((readingPath) => {
      setNarrationPlayback({ status: 'generating', readingPath, duration: 0 });
    });

    const unsubStarted = window.narrationAPI.onPlaybackStarted((readingPath, duration) => {
      setNarrationPlayback({ status: 'playing', readingPath, duration: duration || 0 });
    });

    const unsubPaused = window.narrationAPI.onPlaybackPaused?.(() => {
      setNarrationPlayback(prev => ({ ...prev, status: 'paused' }));
    });

    const unsubResumed = window.narrationAPI.onPlaybackResumed?.(() => {
      setNarrationPlayback(prev => ({ ...prev, status: 'playing' }));
    });

    const unsubStopped = window.narrationAPI.onPlaybackStopped(() => {
      setNarrationPlayback({ status: 'idle', readingPath: null, duration: 0 });
      setNarrationProgress(0);
    });

    const unsubError = window.narrationAPI.onPlaybackError(() => {
      setNarrationPlayback({ status: 'idle', readingPath: null, duration: 0 });
      setNarrationProgress(0);
    });

    return () => {
      unsubGenerating?.();
      unsubStarted?.();
      unsubPaused?.();
      unsubResumed?.();
      unsubStopped?.();
      unsubError?.();
    };
  }, []);

  // Poll for playback progress while playing (feature flagged)
  useEffect(() => {
    if (!FEATURE_NARRATION_ENABLED) return;
    if (narrationPlayback.status !== 'playing' && narrationPlayback.status !== 'paused') {
      return;
    }

    const pollProgress = async () => {
      const progress = await window.narrationAPI?.getPlaybackProgress?.();
      if (progress) {
        setNarrationProgress(progress.percentage);
      }
    };

    // Poll every 500ms for smooth progress updates
    pollProgress();
    const interval = setInterval(pollProgress, 500);

    return () => clearInterval(interval);
  }, [narrationPlayback.status]);

  useEffect(() => {
    if (!window.transcribeAPI?.onStatusChanged) return;
    
    const cleanup = window.transcribeAPI.onStatusChanged((status) => {
      setIsRecording(status === 'recording');
      setTranscriptionStatus(status);
      
      // When transcription starts, set a flag so the next window open shows Fields.
      // This ensures the user sees their new transcript in Fields, not Shared Fields.
      if (status === 'recording') {
        localStorage.setItem(SHOULD_SHOW_FIELDS_ON_OPEN_STORAGE_KEY, 'true');
      }
    });
    
    return cleanup;
  }, []);

  // Fetch and subscribe to audio state for Priority Mic dropdown.
  useEffect(() => {
    if (!window.audioAPI) return;
    
    const fetchAudioState = async () => {
      try {
        const state = await window.audioAPI!.getState();
        setAudioDevices(state.devices.filter((d: AudioDevice) => d.isInput));
        setPriorityDeviceId(state.priorityDeviceId);
      } catch (err) {
        console.error('[ClipboardHistory] Failed to load audio state:', err);
      }
    };
    
    fetchAudioState();
    
    const cleanup = window.audioAPI.onStateChanged((state) => {
      setAudioDevices(state.devices.filter((d: AudioDevice) => d.isInput));
      setPriorityDeviceId(state.priorityDeviceId);
    });
    
    return cleanup;
  }, []);
  
  // Check for unread feedback and listen for incoming messages.
  useEffect(() => {
    if (!window.socialAPI || !authSession?.user?.id) {
      setHasUnreadFeedback(false);
      return;
    }

    const social = window.socialAPI;
    let cancelled = false;

    // Check current view to avoid race condition where async query overwrites cleared state.
    const checkUnread = () => {
      social.hasUnreadFeedback?.().then(hasUnread => {
        if (cancelled) return;
        const currentView = localStorage.getItem(FIELD_THEORY_VIEW_STORAGE_KEY);
        if (hasUnread && currentView !== 'feedback') {
          setHasUnreadFeedback(true);
        } else {
          setHasUnreadFeedback(false);
        }
      });
    };

    checkUnread();

    // Re-poll periodically and on window focus so the dot still catches up if
    // the realtime IPC event is missed while the window is hidden or suspended.
    const pollId = window.setInterval(checkUnread, 300_000);
    const onFocus = () => checkUnread();
    window.addEventListener('focus', onFocus);

    // Listen for incoming feedback messages (defensive — currently unused).
    const unsubscribe = social.onMessageReceived(async (message) => {
      if (cancelled) return;
      const currentView = localStorage.getItem(FIELD_THEORY_VIEW_STORAGE_KEY);
      if (message.type === 'feedback' && currentView !== 'feedback') {
        setHasUnreadFeedback(true);
      }
    });

    return () => {
      cancelled = true;
      window.clearInterval(pollId);
      window.removeEventListener('focus', onFocus);
      unsubscribe();
    };
  }, [authSession?.user?.id]);

  // Close mic dropdown when clicking outside.
  useEffect(() => {
    if (!showMicDropdown) return;
    
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-mic-dropdown]')) {
        setShowMicDropdown(false);
      }
    };
    
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [showMicDropdown]);
  
  // Subscribe to update events for in-app notification.
  useEffect(() => {
    if (!window.updaterAPI) return;
    if (!updaterEnabled) return;
    
    // Query current update status on mount (in case we missed the IPC event).
    window.updaterAPI.getStatus().then((info) => {
      if (info) {
        setUpdateStatus(info.status);
        setUpdateVersion(info.version);
      }
    });
    
    const cleanups = [
      window.updaterAPI.onCheckingForUpdate(() => {
        setUpdateStatus('checking');
        setUpdateError(null);
      }),
      window.updaterAPI.onUpdateAvailable((info) => {
        setUpdateStatus('available');
        setUpdateVersion(info.version);
        setUpdateError(null);
      }),
      window.updaterAPI.onDownloadProgress(() => {
        setUpdateStatus('downloading');
      }),
      window.updaterAPI.onUpdateDownloaded((info) => {
        setUpdateStatus('ready');
        setUpdateVersion(info.version);
        setUpdateError(null);
      }),
      window.updaterAPI.onInstalling(() => {
        setUpdateStatus('installing');
        setUpdateError(null);
      }),
      window.updaterAPI.onUpdateNotAvailable(() => {
        setUpdateStatus('uptodate');
        setUpdateError(null);
        // Don't auto-show release notes - only show when user explicitly requests via hover or button.
        // Reset to idle after 3 seconds so the version number returns.
        setTimeout(() => setUpdateStatus('idle'), 3000);
      }),
      window.updaterAPI.onError((error) => {
        console.error('[Updater] Error:', error);
        // Silently ignore network errors - button is disabled when offline anyway
        if (error?.includes('ERR_INTERNET_DISCONNECTED') || error?.includes('ERR_NETWORK') || error?.includes('ENOTFOUND')) {
          setUpdateStatus('idle');
          return;
        }
        setUpdateError(error);
        setUpdateStatus('error');
        setShowUpdateErrorModal(false);
      }),
    ];
    
    return () => cleanups.forEach(cleanup => cleanup());
  }, [updaterEnabled]);

  const [currentStatIndex, setCurrentStatIndex] = useState(0);
  const [statFading, setStatFading] = useState(false);
  const timeIntervals = ['all time', 'last 30 days', 'last 15 days', 'last 7 days', 'last 24 hours'] as const;
  const [currentIntervalIndex, setCurrentIntervalIndex] = useState(0);
  const nextInterval = useCallback(() => {
    setCurrentIntervalIndex(prev => (prev + 1) % timeIntervals.length);
  }, []);
  
  const [showRecordingTooltip, setShowRecordingTooltip] = useState(false);
  const [keyboardNavActive, setKeyboardNavActive] = useState(false);
  const [hoveredRowIndex, setHoveredRowIndex] = useState<number | null>(null);
  const [recentlyStackedId, setRecentlyStackedId] = useState<string | null>(null);
  const [separatorHovered, setSeparatorHovered] = useState(false);
  const [pendingStackSelection, setPendingStackSelection] = useState<string | null>(null);
  const [pendingItemSelection, setPendingItemSelection] = useState<number | null>(null);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [feedbackModalFocus, setFeedbackModalFocus] = useState<'share' | 'cancel'>('share');
  const [showAgentImproveDialog, setShowAgentImproveDialog] = useState(false);
  const [agentImproveContext, setAgentImproveContext] = useState<AgentImproveContext | null>(null);
  const [agentImproveInstruction, setAgentImproveInstruction] = useState('');
  const [agentImproveTool, setAgentImproveTool] = useState<'codex' | 'claude'>('codex');
  const [agentImproveLaunching, setAgentImproveLaunching] = useState(false);
  const [agentImproveStatus, setAgentImproveStatus] = useState<string | null>(null);
  const [localCommandStatus, setLocalCommandStatus] = useState<FooterLocalCommandStatus | null>(null);
  const [localCommandActivityFrameIndex, setLocalCommandActivityFrameIndex] = useState(0);
  const [maxwellHistoryOpen, setMaxwellHistoryOpen] = useState(false);
  const footerRef = useRef<HTMLDivElement | null>(null);

  // DM modal state - for sending DMs to contacts.
  const [showDMModal, setShowDMModal] = useState(false);
  const [dmRecipientQuery, setDmRecipientQuery] = useState('');
  const [dmContacts, setDmContacts] = useState<{ id: string; userId: string | null; email: string; name: string | null }[]>([]);
  const [selectedDmContactIndex, setSelectedDmContactIndex] = useState(0);

  // dnd-kit drag state - tracks what's being dragged.
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [overDropId, setOverDropId] = useState<string | null>(null);

  // Pointer sensor with distance activation - must move 5px before drag starts.
  // This distinguishes clicks from drags.
  // Memoize sensor config to prevent DndContext re-renders.
  const pointerSensorOptions = useMemo(() => ({
    activationConstraint: { distance: 5 },
  }), []);
  const sensors = useSensors(useSensor(PointerSensor, pointerSensorOptions));

  // Format numbers with commas (e.g., 16,000)
  const formatNumber = (num: number | undefined | null): string => (num ?? 0).toLocaleString();

  // Pro user stats - cycle through these on click
  const statItems = useMemo(() => [
    { label: 'Words', value: allTimeStats.words ?? 0, singular: 'word transcribed', plural: 'words transcribed' },
    { label: 'Improved', value: allTimeStats.improved ?? 0, singular: 'word auto-improved', plural: 'words auto-improved' },
    { label: 'Voice', value: allTimeStats.voiceCommands ?? 0, singular: 'voice command', plural: 'voice commands' },
    { label: 'Commands', value: allTimeStats.commandsUsed ?? 0, singular: 'command used', plural: 'commands used' },
    { label: 'AutoStacks', value: allTimeStats.autoStacks ?? 0, singular: 'auto-stack', plural: 'auto-stacks' },
  ], [allTimeStats]);

  const nextStat = useCallback(() => {
    if (statItems.length <= 1) return;
    setStatFading(true);
    setTimeout(() => {
      setCurrentStatIndex(prev => (prev + 1) % statItems.length);
      setStatFading(false);
    }, 150);
  }, [statItems.length]);

  useEffect(() => {
    if (currentStatIndex >= statItems.length) {
      setCurrentStatIndex(0);
    }
  }, [statItems.length, currentStatIndex]);

  // Toggle narration playback (pause/resume)
  const handleNarrationToggle = useCallback(async () => {
    await window.narrationAPI?.togglePause?.();
  }, []);

  // Stop narration playback
  const handleNarrationStop = useCallback(async () => {
    await window.narrationAPI?.stop();
  }, []);
  
  const [targetAppInfo, setTargetAppInfo] = useState<{
    previousApp: RunningApp | null;  // Default paste destination (click)
    targetApp: RunningApp | null;    // Option+click destination
    runningApps: RunningApp[];
    targetAppIndex: number;
  }>({
    previousApp: null,
    targetApp: null,
    runningApps: [],
    targetAppIndex: 0,
  });
  
  // Track when Option key is held for UI feedback
  const [optionHeld, setOptionHeld] = useState(false);
  
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const sketchViewRef = useRef<SketchViewHandle>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const searchDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const feedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [containerWidth, setContainerWidth] = useState<number | null>(null);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const [hasItemsAbove, setHasItemsAbove] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const ITEMS_PER_PAGE = 50;

  const isMacOS = typeof window !== 'undefined' && window.platform?.isMacOS;

  useLayoutEffect(() => {
    if (!showSettings && isTopNavMode(viewMode)) {
      applyTopNavVisualMode(viewMode);
    }

    const trace = topNavPaintTraceRef.current;
    if (!trace || showSettings || viewMode !== trace.to) return;

    const commitAt = performance.now();
    const selectedButton = tabsRef.current?.querySelector<HTMLElement>(
      `[data-top-nav-mode="${trace.to}"]`
    );
    const selectedStyle = selectedButton ? window.getComputedStyle(selectedButton) : null;
    const transitionMs = selectedStyle ? maxTransitionMs(selectedStyle) : null;
    const timingDetails = {
      source: trace.source,
      from: trace.from,
      to: trace.to,
      highlightMs: trace.highlightAppliedAt === undefined ? null : Number((trace.highlightAppliedAt - trace.startedAt).toFixed(1)),
      commitMs: Number((commitAt - trace.startedAt).toFixed(1)),
      cssTransitionMs: transitionMs === null ? null : Number(transitionMs.toFixed(0)),
    };
    traceTopNav('top-nav-switch-commit', timingDetails);

    requestAnimationFrame(() => {
      const frameAt = performance.now();
      const frameDetails = {
        ...timingDetails,
        nextFrameMs: Number((frameAt - trace.startedAt).toFixed(1)),
      };
      traceTopNav('top-nav-switch-frame', frameDetails);
    });

    topNavPaintTraceRef.current = null;
  }, [applyTopNavVisualMode, showSettings, viewMode]);

  const pushUndo = useCallback((action: UndoAction) => {
    setUndoStack(prev => [...prev.slice(-(MAX_UNDO - 1)), action]);
    setRedoStack([]);
  }, []);

  const showFeedback = useCallback((message: string) => {
    if (feedbackTimeoutRef.current) clearTimeout(feedbackTimeoutRef.current);
    setActionFeedback(message);
    feedbackTimeoutRef.current = setTimeout(() => setActionFeedback(null), 3000);
  }, []);

  const handleCreateMarkdownFromItems = useCallback(async (
    sourceItems: ClipboardItem[],
    options: { stackId?: string; contentVersion?: 'stored' | 'original' | 'improved' } = {},
  ) => {
    try {
      const resolvedItems = options.stackId && window.clipboardAPI?.queryItemsByStackId
        ? await window.clipboardAPI.queryItemsByStackId(options.stackId)
        : sourceItems;

      if (resolvedItems.length === 0) {
        showFeedback('no items to export');
        return;
      }

      const markdownItems = resolvedItems.map((item) => {
        if (options.contentVersion === 'original') return { ...item, useImprovedVersion: false };
        if (options.contentVersion === 'improved') return { ...item, useImprovedVersion: true };
        return item;
      });

      const imagePaths: Record<number, string | null> = {};
      for (const item of markdownItems) {
        if (item.type === 'image' || item.type === 'screenshot') {
          imagePaths[item.id] = await window.clipboardAPI?.exportItemImagePath?.(item.id) ?? null;
        }
      }

      const title = getClipboardItemsMarkdownTitle(markdownItems);
      const markdown = buildClipboardItemsMarkdown(markdownItems, imagePaths, title);
      const page = await window.wikiAPI?.createFile('scratchpad', title) ?? await window.wikiAPI?.createScratchpadDefault();
      if (!page) {
        showFeedback('could not create markdown');
        return;
      }

      const portableMarkdown = (await window.markdownImagesAPI?.makeImagesPortable(page.absPath, markdown))?.content ?? markdown;
      const saved = await window.wikiAPI?.save(page.relPath, portableMarkdown);
      if (!isDocumentSaveOk(saved)) {
        showFeedback('could not save markdown');
        return;
      }

      showFeedback(`saved to ${page.relPath}.md`);
      setPendingLibraryOpenTarget({
        kind: 'wiki',
        path: page.relPath,
        contentMode: 'markdown',
        selectionStart: portableMarkdown.length,
        selectionEnd: portableMarkdown.length,
      });
      setShowSettings(false);
      setLibraryKeepsCurrentSizeKey(false);
      setViewMode('librarian');
    } catch (error) {
      console.error('Failed to create clipboard markdown:', error);
      showFeedback('could not create markdown');
    }
  }, [showFeedback]);

  useEffect(() => {
    return () => {
      if (feedbackTimeoutRef.current) clearTimeout(feedbackTimeoutRef.current);
    };
  }, []);
  
  // Track scroll position for "scroll to top" indicator.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    
    const handleScroll = () => setHasItemsAbove(list.scrollTop > 20);
    list.addEventListener('scroll', handleScroll, { passive: true });
    return () => list.removeEventListener('scroll', handleScroll);
  }, []);

  // Delay showing scroll-to-top button by 500ms.
  useEffect(() => {
    if (hasItemsAbove) {
      const timer = setTimeout(() => setShowScrollTop(true), 500);
      return () => clearTimeout(timer);
    }
    setShowScrollTop(false);
  }, [hasItemsAbove]);

  // Load items from clipboard history plus stack info.
  // Use refs to avoid dependency cycles - offset and stacks don't need to recreate this function.
  const offsetRef = useRef(offset);
  const stacksRef = useRef(stacks);

  // Keep refs in sync with state
  useEffect(() => {
    offsetRef.current = offset;
  }, [offset]);

  useEffect(() => {
    stacksRef.current = stacks;
  }, [stacks]);

  const fetchStackItemsById = useCallback(async (stackIds: string[]): Promise<Record<string, ClipboardItem[]>> => {
    const queryItemsByStackId = window.clipboardAPI?.queryItemsByStackId;
    if (!queryItemsByStackId || stackIds.length === 0) {
      return {};
    }

    const entries = await Promise.all(
      stackIds.map(async (stackId) => [stackId, await queryItemsByStackId(stackId)] as const)
    );
    const fetchedStacks = Object.fromEntries(entries) as Record<string, ClipboardItem[]>;

    setHydratedStackItemsById((prev) => {
      let changed = false;
      const next = { ...prev };

      for (const [stackId, stackItems] of Object.entries(fetchedStacks)) {
        if (getStackItemsSignature(prev[stackId] ?? []) !== getStackItemsSignature(stackItems)) {
          next[stackId] = stackItems;
          changed = true;
        }
      }

      return changed ? next : prev;
    });

    return fetchedStacks;
  }, []);

  const loadItems = useCallback(async (
    reset: boolean = false,
    options: { requireActiveSurface?: boolean } = {}
  ) => {
    if (!isMacOS || !window.clipboardAPI) {
      return;
    }
    if (options.requireActiveSurface && !clipboardSurfaceActiveRef.current) {
      return;
    }

    const currentOffset = offsetRef.current;

    setLoading(true);
    try {
      const queryOptions: ClipboardQueryOptions = {
        limit: ITEMS_PER_PAGE,
        offset: reset ? 0 : currentOffset,
      };

      if (filter === 'transcript') {
        queryOptions.type = 'transcript';
      }

      if (sourceFilter !== 'all') {
        queryOptions.source = sourceFilter;
      }

      if (debouncedSearchQuery.trim()) {
        queryOptions.search = debouncedSearchQuery.trim();
      }

      const [newItems, stacksData] = await Promise.all([
        window.clipboardAPI.queryItems(queryOptions),
        reset ? window.clipboardAPI.getUniqueStacks?.() : Promise.resolve(stacksRef.current),
      ]);

      if (options.requireActiveSurface && !clipboardSurfaceActiveRef.current) {
        return;
      }

      if (reset) {
        setHydratedStackItemsById({});
        setItems(newItems as ClipboardItem[]);
        setStacks(stacksData || []);
        setOffset(newItems.length);
      } else {
        setItems(prev => [...prev, ...(newItems as ClipboardItem[])]);
        setOffset(prev => prev + newItems.length);
      }

      setHasMore(newItems.length === ITEMS_PER_PAGE);
    } catch (error) {
      console.error('Failed to load clipboard items:', error);
    } finally {
      setLoading(false);
    }
  }, [isMacOS, debouncedSearchQuery, sourceFilter, filter]);

  useEffect(() => {
    if (!clipboardSurfaceActive) return;

    const stackIdsToHydrate = getStackHydrationIds(items, stacks, hydratedStackItemsById);
    if (stackIdsToHydrate.length === 0) return;

    void fetchStackItemsById(stackIdsToHydrate).catch((error) => {
      console.error('Failed to hydrate stack items:', error);
    });
  }, [clipboardSurfaceActive, items, stacks, hydratedStackItemsById, fetchStackItemsById]);

  // Clipboard items must never sync or upload from Field Theory.
  const canShare = false;

  // Share an item to the shared clipboard.
  const shareToTeam = useCallback(async (localItemId: number) => {
    void localItemId;
  }, []);

  // Share a stack to the shared clipboard.
  const shareStackToTeam = useCallback(async (itemIds: number[]) => {
    void itemIds;
  }, []);

  // Copy item to system clipboard and show flash.
  const copyItem = useCallback(async (itemId: number, rowKey: string, useImproved?: boolean) => {
    if (!window.clipboardAPI?.copyItem) return;
    await window.clipboardAPI.copyItem(itemId, useImproved);
    setCopiedItemId(rowKey);
    setTimeout(() => setCopiedItemId(null), 1500);
  }, []);

  // Copy stack: concatenate text (oldest first) or copy first image.
  const copyStack = useCallback(async (stackItems: ClipboardItem[], rowKey: string) => {
    if (!window.clipboardAPI) return;
    
    const sorted = [...stackItems].sort((a, b) => a.createdAt - b.createdAt);
    const textParts: string[] = [];
    let imageItem: ClipboardItem | null = null;
    
    for (const item of sorted) {
      if ((item.type === 'text' || item.type === 'transcript') && item.content) {
        textParts.push(item.content);
      } else if ((item.type === 'image' || item.type === 'screenshot') && item.imageData && !imageItem) {
        imageItem = item;
      }
    }
    
    if (textParts.length > 0) {
      await navigator.clipboard.writeText(textParts.join('\n\n'));
    } else if (imageItem) {
      await window.clipboardAPI.copyItem(imageItem.id);
    }
    
    setCopiedItemId(rowKey);
    setTimeout(() => setCopiedItemId(null), 1500);
  }, []);

  const handleSketchSave = useCallback(async (imageData: { dataUrl: string; width: number; height: number }, andCopy?: boolean) => {
    localStorage.removeItem('pendingSketch');

    const api = window.clipboardAPI;
    if (!api?.restoreItem) return;

    const base64Data = imageData.dataUrl.replace(/^data:image\/\w+;base64,/, '');
    const createdAt = Date.now();
    
    const newId = await api.restoreItem({
      type: 'image',
      content: null,
      imageData: base64Data,
      imageWidth: imageData.width,
      imageHeight: imageData.height,
      imageSize: Math.round((base64Data.length * 3) / 4),
      sourceApp: 'com.fieldtheory.draw',
      sourceAppName: 'Drawing',
      wordCount: null,
      charCount: null,
      createdAt,
      contentHash: `drawing-${createdAt}`,
      source: 'mac',
    } as any);
    
    // If recording is active, add drawing to the transcription stack (like screenshots).
    if (newId && transcriptionStatus === 'recording') {
      await window.transcribeAPI?.addToStack(newId);
    }
    
    // Copy to system clipboard (without pasting) when "save & copy" is clicked.
    if (andCopy && newId) {
      await api.copyItem(newId);
    }
    
    setEditingSketchItem(null);
    setViewMode('clipboard');
    loadItems(true);
  }, [loadItems, transcriptionStatus]);

  const handleSketchClose = useCallback(() => {
    localStorage.removeItem('pendingSketch');
    setEditingSketchItem(null);
    setSketchAssociatedTranscripts([]);
    if (!navigateAppHistory(-1)) {
      setViewMode('clipboard');
    }
  }, [navigateAppHistory]);

  const openSketchForEditing = useCallback(async (item: ClipboardItem) => {
    setEditingSketchItem(item);
    setSketchBackgroundImage(null);
    setViewMode('sketch');
    
    // Query associated transcripts if this item is part of a stack.
    if (item.stackId && window.clipboardAPI?.queryItemsByStackId) {
      const stackItems = await window.clipboardAPI.queryItemsByStackId(item.stackId);
      const transcripts = stackItems.filter(i => i.type === 'transcript' && i.id !== item.id);
      setSketchAssociatedTranscripts(transcripts);
    } else {
      setSketchAssociatedTranscripts([]);
    }
  }, []);

  const handleUnstackTranscript = useCallback(async (transcriptId: number) => {
    if (!window.clipboardAPI?.updateStackId) return;
    const item = await window.clipboardAPI.getItem?.(transcriptId);
    const previousStackId = item?.stackId;
    await window.clipboardAPI.updateStackId([transcriptId], null);
    if (previousStackId) {
      pushUndo({ type: 'unstack', itemIds: [transcriptId], previousStackId });
      showFeedback('item unstacked');
    }
    setSketchAssociatedTranscripts(prev => prev.filter(t => t.id !== transcriptId));
  }, [pushUndo, showFeedback]);

  useEffect(() => {
    persistClipboardSurface(localStorage, { viewMode, showSettings });

    // Close settings when entering sketch mode (sketch needs full screen).
    if (viewMode === 'sketch') {
      setShowSettings(false);
    }
    // Clear unread indicator when entering feedback view.
    if (viewMode === 'feedback') {
      setHasUnreadFeedback(false);
    }
    // Notify main process of sketch mode changes so it can skip auto-paste into Excalidraw.
    window.clipboardAPI?.setSketchMode?.(viewMode === 'sketch');

    // Push the active size-key to main so window bounds match the view.
    // Librarian is delegated: LibrarianView/BookmarksPane push their own key.
    if (showSettings) {
      window.librarianAPI?.setSizeKey?.('fields');
    } else if (viewMode === 'sketch') {
      window.librarianAPI?.setSizeKey?.('draw');
    } else if (viewMode !== 'librarian' && previousSizeViewModeRef.current === 'sketch') {
      window.librarianAPI?.setSizeKey?.('fields');
    }
    previousSizeViewModeRef.current = viewMode;
  }, [showSettings, viewMode]);

  useEffect(() => {
    localStorage.setItem(LIBRARIAN_IMMERSIVE_STORAGE_KEY, librarianImmersive ? 'true' : 'false');
    window.librarianAPI?.setImmersiveMode(viewMode === 'librarian' && !showSettings && librarianImmersive && !focusChromeOverlayActive);
  }, [focusChromeOverlayActive, librarianImmersive, showSettings, viewMode]);

  useEffect(() => {
    if ((showSettings || viewMode !== 'librarian') && librarianImmersive) {
      setLibrarianImmersive(false);
    }
  }, [librarianImmersive, showSettings, viewMode]);

  useEffect(() => {
    if (!isFocusChromeSurface) {
      handleFocusChromeActiveChange(false);
    }
  }, [handleFocusChromeActiveChange, isFocusChromeSurface]);

  // Clear section override when settings closes.
  useEffect(() => {
    if (!showSettings) {
      setSettingsSection(undefined);  // Clear section override when settings closes
    }
  }, [showSettings]);

  // Persist librarianEnabled state when it changes
  useEffect(() => {
    localStorage.setItem('librarianEnabled', librarianEnabled ? 'true' : 'false');
  }, [librarianEnabled]);

  // Fetch user's callsign when auth session changes
  useEffect(() => {
    if (!authSession?.user?.id || !supabase) {
      setUserCallsign(null);
      return;
    }
    supabase
      .from('profiles')
      .select('callsign')
      .eq('id', authSession.user.id)
      .single()
      .then(({ data }) => {
        setUserCallsign(data?.callsign || null);
      });
  }, [authSession?.user?.id]);

  // Check screen recording permission on mount and window focus.
  // Shows banner if permission is missing and user hasn't dismissed it.
  useEffect(() => {
    const checkPermission = async () => {
      const status = await window.onboardingAPI?.getPermissionStatus();
      if (status) setScreenRecordingGranted(status.screenRecording);
      
      const hideBanner = await window.clipboardAPI?.getHideScreenRecordingBanner?.();
      setHideScreenRecordingBanner(hideBanner ?? false);
    };
    
    window.addEventListener('focus', checkPermission);
    checkPermission();
    
    return () => window.removeEventListener('focus', checkPermission);
  }, []);

  useEffect(() => {
    if (searchDebounceTimerRef.current) {
      clearTimeout(searchDebounceTimerRef.current);
    }
    
    searchDebounceTimerRef.current = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 150);
    
    return () => {
      if (searchDebounceTimerRef.current) {
        clearTimeout(searchDebounceTimerRef.current);
      }
    };
  }, [searchQuery]);

  // Initial load and search/filter changes.
  useEffect(() => {
    if (!clipboardSurfaceActive) return;
    setOffset(0);
    loadItems(true, { requireActiveSurface: true });
  }, [clipboardSurfaceActive, loadItems]);

  useEffect(() => {
    if (!isMacOS || !window.clipboardAPI) {
      return;
    }

    setIsVisible(true);
    setSelectedIndex(0);
    setSelectedIds(new Set());
    setIsMultiSelect(false);

    const unsubscribeShowHistory = window.clipboardAPI.onShowHistory(() => {
      const pendingSketch = localStorage.getItem('pendingSketch');

      setSearchQuery('');
      setDebouncedSearchQuery('');
      setSelectedIndex(0);
      setSelectedIds(new Set());
      setIsMultiSelect(false);
      setFilter('all');

      // Check for pending sketch to restore (user was drawing and accidentally closed)
      try {
        if (pendingSketch) {
          const restored = JSON.parse(pendingSketch);
          if (restored.elements?.length > 0 && Date.now() - restored.timestamp < 24 * 60 * 60 * 1000) {
            setShowSettings(false);
            setViewMode('sketch');
            setEditingSketchItem(null);
            setSketchBackgroundImage(null);
            return;
          } else {
            localStorage.removeItem('pendingSketch');
          }
        }
      } catch (e) {
        localStorage.removeItem('pendingSketch');
      }

      const restoreState = resolveClipboardRestoreState(localStorage);
      setViewMode(restoreState.viewMode);
      setShowSettings(restoreState.showSettings);
      setLibrarianImmersive(
        restoreState.viewMode === 'librarian' &&
        !restoreState.showSettings &&
        shouldRestoreLibrarianImmersive(localStorage)
      );
    });

    const unsubscribeShowLibrary = window.clipboardAPI.onShowLibrary?.(() => {
      setSearchQuery('');
      setDebouncedSearchQuery('');
      setSelectedIndex(0);
      setSelectedIds(new Set());
      setIsMultiSelect(false);
      setFilter('all');
      setShowSettings(false);
      setPendingReadingPath(null);
      setLibraryKeepsCurrentSizeKey(false);
      setViewMode('librarian');
      setLibrarianImmersive(shouldRestoreLibrarianImmersive(localStorage));
    });

    const unsubscribeShowTranscriptHistory = window.clipboardAPI.onShowTranscriptHistory?.(() => {
      setSearchQuery('');
      setDebouncedSearchQuery('');
      setSelectedIndex(0);
      setSelectedIds(new Set());
      setIsMultiSelect(false);
      setShowSettings(false);
      setViewMode('clipboard');
      setFilter('transcript');
      setPendingReadingPath(null);
    });

    const unsubscribeShowSettings = window.clipboardAPI.onShowSettings?.(() => {
      setShowSettings(true);
    });

    // Listen for collapse-immersive event (triggered by hotkey when in immersive mode)
    const unsubscribeCollapseImmersive = window.clipboardAPI.onCollapseImmersive?.(() => {
      setLibrarianImmersive(false);
    });

    // Preload sounds for instant playback via Web Audio API.
    // This bypasses the main process entirely for minimal latency.
    rendererSoundManager.preload();

    // Listen for sound events from main process.
    const unsubscribePlaySound = window.clipboardAPI.onPlaySound?.((soundId) => {
      // Cast to 'any' - renderer gracefully handles unknown sound IDs
      rendererSoundManager.play(soundId as 'windowOpen' | 'windowClose' | 'artifactDiscovery');
    });

    const syncStatusPromise = window.fieldTheorySyncAPI?.getStatus?.();
    if (syncStatusPromise) {
      syncStatusPromise.then(status => {
        setFieldTheorySyncEnabled(status.enabled);
        if (!status.enabled) {
          setViewMode(prev => prev === 'todo' ? 'clipboard' : prev);
        }
      }).catch(() => setFieldTheorySyncEnabled(false));
    }

    // Listen for todo view switch event (triggered when Cmd+Shift+T enables Tasks tab).
    const unsubscribeShowTodos = window.todoAPI?.onShowTodos?.(() => {
      void (async () => {
        const status = await window.fieldTheorySyncAPI?.getStatus?.();
        if (!status?.enabled) return;
        setFieldTheorySyncEnabled(true);
        setShowSettings(false);
        setViewMode('todo');
      })();
    });

    // Load initial Tasks tab visibility and subscribe to changes.
    window.clipboardAPI.getTasksTabEnabled?.().then(enabled => {
      setTasksTabEnabled(enabled);
    });
    const unsubscribeTasksTabToggled = window.clipboardAPI.onTasksTabToggled?.((enabled) => {
      setTasksTabEnabled(enabled);
      // If Tasks tab was disabled while viewing it, switch to clipboard
      if (!enabled) {
        setViewMode(prev => prev === 'todo' ? 'clipboard' : prev);
      }
    });

    const unsubscribeTargetAppInfo = window.clipboardAPI.onTargetAppInfo?.((info) => {
      let targetAppIndex = 0;
      if (info.targetApp && info.runningApps.length > 0) {
        const idx = info.runningApps.findIndex(
          app => app.bundleId === info.targetApp?.bundleId
        );
        targetAppIndex = idx >= 0 ? idx : 0;
      }
      
      setTargetAppInfo({
        previousApp: info.previousApp ?? null,
        targetApp: info.targetApp,
        runningApps: info.runningApps,
        targetAppIndex,
      });
    });

    const unsubscribeAdded = window.clipboardAPI.onItemAdded(async (id) => {
      if (!clipboardSurfaceActiveRef.current) {
        return;
      }

      // Preserve scroll position and loaded items count when adding new items
      const scrollContainer = listRef.current?.parentElement;
      const savedScrollTop = scrollContainer?.scrollTop ?? 0;
      const currentOffset = offsetRef.current;

      // Reload with reset, but then restore the loaded count if user had loaded more
      await loadItems(true, { requireActiveSurface: true });

      // If user had loaded more items, keep loading until we match or exceed the previous offset
      let attempts = 0;
      const maxAttempts = 20; // Safety limit to prevent infinite loops
      while (clipboardSurfaceActiveRef.current && offsetRef.current < currentOffset && attempts < maxAttempts) {
        const offsetBefore = offsetRef.current;
        await loadItems(false, { requireActiveSurface: true });
        const offsetAfter = offsetRef.current;

        // Break if offset didn't increase (no more items to load)
        if (offsetAfter <= offsetBefore) break;
        attempts++;
      }

      // Restore scroll position after all items are loaded
      requestAnimationFrame(() => {
        if (clipboardSurfaceActiveRef.current && scrollContainer) {
          scrollContainer.scrollTop = savedScrollTop;
        }
      });
    });

    const unsubscribeDeleted = window.clipboardAPI.onItemDeleted((id) => {
      setItems(prev => prev.filter(item => item.id !== id));
      setSelectedIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      // Recheck scroll position after deletion - list may have shrunk
      requestAnimationFrame(() => {
        if (listRef.current && listRef.current.scrollTop <= 20) {
          setHasItemsAbove(false);
        }
      });
    });

    return () => {
      unsubscribeShowHistory();
      unsubscribeShowLibrary?.();
      unsubscribeShowTranscriptHistory?.();
      unsubscribeShowSettings?.();
      unsubscribeCollapseImmersive?.();
      unsubscribePlaySound?.();
      unsubscribeShowTodos?.();
      unsubscribeTasksTabToggled?.();
      unsubscribeTargetAppInfo?.();
      unsubscribeAdded();
      unsubscribeDeleted();
    };
  }, [isMacOS, loadItems]);

  // Keep the user's current surface stable when a new artifact appears.
  // Auto-open flows use pendingReadingPath; visible-window flows only show
  // the Library indicator.
  useEffect(() => {
    const unsubscribe = window.librarianAPI?.onReadingAdded(() => {
      if (viewMode !== 'librarian') setHasNewReading(true);
    });

    return () => unsubscribe?.();
  }, [viewMode]);

  useEffect(() => {
    const unsubscribe = window.commandsAPI?.onOpenMarkdownFromLauncher?.((target) => {
      setShowSettings(false);
      if (target.kind === 'command') {
        openCommandPathInLibrary(target.path);
        return;
      }
      if (target.kind === 'commands') {
        setPendingLibraryOpenTarget(null);
        setLibraryKeepsCurrentSizeKey(false);
        setViewMode('librarian');
        return;
      }
      if (target.kind === 'clipboard') {
        const clipboardSearch = target.clipboardSearch ?? '';
        setSearchQuery(clipboardSearch);
        setDebouncedSearchQuery(clipboardSearch);
        setSelectedIds(new Set());
        setIsMultiSelect(false);
        setFilter('all');
        setSourceFilter('all');
        if (target.clipboardStackId) {
          setPendingStackSelection(target.clipboardStackId);
        } else if (typeof target.clipboardItemId === 'number') {
          setPendingItemSelection(target.clipboardItemId);
        }
        setViewMode('clipboard');
        return;
      }
      if (target.kind === 'library') {
        setLibraryKeepsCurrentSizeKey(false);
        setViewMode('librarian');
        return;
      }
      if (target.kind === 'bookmarks') {
        setPendingLibraryOpenTarget(target);
        setLibraryKeepsCurrentSizeKey(false);
        setViewMode('librarian');
        return;
      }
      setPendingLibraryOpenTarget(target);
      setLibraryKeepsCurrentSizeKey(false);
      setViewMode('librarian');
    });

    return () => unsubscribe?.();
  }, [openCommandPathInLibrary]);

  // Hotkey-driven scratchpad create → jump straight into Library and preserve
  // the target in case LibrarianView mounts after the one-shot IPC event.
  useEffect(() => {
    const unsubscribe = window.wikiAPI?.onOpenScratchpad((relPath) => {
      clearPreview();
      setShowSettings(false);
      void (async () => {
        const page = await window.wikiAPI?.getPage(relPath);
        if (page) dispatchLocalWikiAdded(page);
      })();
      setPendingLibraryOpenTarget({
        kind: 'wiki',
        path: relPath,
        contentMode: 'rendered',
      });
      setLibraryKeepsCurrentSizeKey(false);
      setNavSidebarCollapsed(true);
      setViewMode('librarian');
    });
    return () => unsubscribe?.();
  }, [clearPreview]);

  // Poll for pending readings and handle Library auto-open handoff.
  useEffect(() => {
    if (!isWindowVisible) return;

    const pollLibrarianStatus = async () => {
      const status = await window.librarianAPI?.pollStatus?.();
      if (!status) return;

      // If there's a pending reading, show it in Library without changing the window size.
      if (status.pendingPath) {
        setPendingReadingPath(status.pendingPath);
        setAutoPopArtifactPath(status.pendingPath);
        setShowSettings(false);
        setLibraryKeepsCurrentSizeKey(false);
        setViewMode('librarian');
        setLibrarianImmersive(false);
      }

    };

    // Check immediately on mount
    pollLibrarianStatus();

    // Then poll every 500ms
    const interval = setInterval(pollLibrarianStatus, 500);
    return () => clearInterval(interval);
  }, [isWindowVisible]);

  // Handle new reading available (when window already visible, shows indicator)
  useEffect(() => {
    const unsubscribe = window.librarianAPI?.onNewReadingAvailable(() => {
      // Don't switch views - just show indicator
      if (viewMode !== 'librarian') setHasNewReading(true);
    });

    return () => unsubscribe?.();
  }, [viewMode]);

  // Handle new reading to show immediately when Library is already active.
  useEffect(() => {
    const unsubscribe = window.librarianAPI?.onShowNewReading((readingPath: string) => {
      // Update the reading being displayed without changing the window size.
      setPendingReadingPath(readingPath);
      setShowSettings(false);
      setLibraryKeepsCurrentSizeKey(false);
      setViewMode('librarian');
      setLibrarianImmersive(false);
    });

    return () => unsubscribe?.();
  }, []);

  // Clear new reading indicator when user switches to Librarian tab
  useEffect(() => {
    if (viewMode === 'librarian') {
      setHasNewReading(false);
    }
  }, [viewMode]);

  // Measure container width for text truncation (updates on resize)
  useEffect(() => {
    if (!listRef.current) return;
    
    const updateWidth = () => {
      if (listRef.current) {
        setContainerWidth(listRef.current.getBoundingClientRect().width);
      }
    };
    
    // Initial measurement
    updateWidth();
    
    // Update on resize
    const resizeObserver = new ResizeObserver(updateWidth);
    resizeObserver.observe(listRef.current);
    
    return () => resizeObserver.disconnect();
  }, [isVisible]);

  // Track Option key held state for UI feedback.
  // When Option is held, show targetApp as paste destination; otherwise show previousApp.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && !optionHeld) {
        setOptionHeld(true);
      }
    };
    
    const handleKeyUp = (e: KeyboardEvent) => {
      if (!e.altKey && optionHeld) {
        setOptionHeld(false);
      }
    };
    
    // Also reset when window loses focus
    const handleBlur = () => {
      setOptionHeld(false);
    };
    
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, [optionHeld]);

  // Space bar hotkey for narration play/pause (feature flagged)
  useEffect(() => {
    if (!FEATURE_NARRATION_ENABLED) return;

    const handleSpaceBar = (e: KeyboardEvent) => {
      // Only handle space bar when narration is active and not in a text input
      if (
        e.code === 'Space' &&
        narrationPlayback.status !== 'idle' &&
        narrationPlayback.status !== 'generating' &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        handleNarrationToggle();
      }
    };

    window.addEventListener('keydown', handleSpaceBar);
    return () => window.removeEventListener('keydown', handleSpaceBar);
  }, [narrationPlayback.status, handleNarrationToggle]);

  // Build list rows with stack grouping.
  // Stacked items are grouped together, non-stacked items appear individually.
  // Memoized to avoid recreating on every render.
  const listRows = useMemo((): ListRow[] => {
    return buildClipboardListRows(items, stacks, expandedStacks, hydratedStackItemsById);
  }, [items, stacks, expandedStacks, hydratedStackItemsById]);

  // Stack all items above the "context collected" separator.
  const stackItemsAboveSeparator = useCallback(async (separatorIndex: number) => {
    if (!window.clipboardAPI?.updateStackId) return;
    
    const itemIdsAbove: number[] = [];
    for (let i = 0; i < separatorIndex; i++) {
      const row = listRows[i];
      if (row.type === 'item') {
        itemIdsAbove.push(row.item.id);
      } else if (row.type === 'stack') {
        row.items.forEach(item => itemIdsAbove.push(item.id));
      }
    }
    
    if (itemIdsAbove.length < 2) return;
    
    const newStackId = crypto.randomUUID();
    await window.clipboardAPI.updateStackId(itemIdsAbove, newStackId);
    
    setLastSeenItemId(null);
    localStorage.removeItem('lastSeenItemId');
    
    showFeedback(`stacked ${itemIdsAbove.length} items`);
    loadItems(true);
  }, [listRows, loadItems, showFeedback]);

  // Track last seen item for "new items" separator
  useEffect(() => {
    if (!isVisible || viewMode !== 'clipboard' || listRows.length === 0) return;
    
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && listRows.length > 0) {
        const topRow = listRows[0];
        const topId = topRow.type === 'stack' ? topRow.stack.stackId : topRow.item.id;
        setLastSeenItemId(topId);
        localStorage.setItem('lastSeenItemId', JSON.stringify(topId));
      }
    };
    
    window.addEventListener('focus', handleVisibilityChange);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      window.removeEventListener('focus', handleVisibilityChange);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isVisible, viewMode, listRows]);

  // ---------------------------------------------------------------------------
  // dnd-kit drag handlers.
  // Uses pointer events internally, works with NSPanel (type: 'panel').
  // ---------------------------------------------------------------------------

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveDragId(event.active.id as string);
  }, []);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    setOverDropId(event.over?.id as string ?? null);
  }, []);

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDragId(null);
    setOverDropId(null);

    if (!over || active.id === over.id) return;

    // Parse drag IDs: "stack:uuid" or "item:123"
    const [activeType, activeId] = (active.id as string).split(':');
    const [overType, overId] = (over.id as string).split(':');

    if (activeType === 'item') {
      const draggedItemId = parseInt(activeId, 10);
      if (overType === 'stack') {
        // Item dropped on stack -> add to stack.
        await window.clipboardAPI?.updateStackId?.([draggedItemId], overId);
      } else if (overType === 'item') {
        const targetItemId = parseInt(overId, 10);
        if (draggedItemId !== targetItemId) {
          // Item dropped on item -> create new stack.
          const newStackId = crypto.randomUUID();
          await window.clipboardAPI?.updateStackId?.([draggedItemId, targetItemId], newStackId);
        }
      }
    } else if (activeType === 'stack') {
      const draggedStackId = activeId;
      if (overType === 'stack' && draggedStackId !== overId) {
        // Stack dropped on stack -> merge stacks.
        const otherItems = await window.clipboardAPI?.queryItemsByStackId?.(draggedStackId);
        if (otherItems?.length) {
          const itemIds = otherItems.map((i: ClipboardItem) => i.id);
          await window.clipboardAPI?.updateStackId?.(itemIds, overId);
        }
      } else if (overType === 'item') {
        // Stack dropped on item -> add item to the dragged stack.
        const targetItemId = parseInt(overId, 10);
        await window.clipboardAPI?.updateStackId?.([targetItemId], draggedStackId);
      }
    }

    loadItems(true);
  }, [loadItems]);

  // Handle pending selection after stack/unstack operations
  useEffect(() => {
    if (pendingStackSelection) {
      const stackIndex = listRows.findIndex(
        row => row.type === 'stack' && row.stack.stackId === pendingStackSelection
      );
      if (stackIndex !== -1) {
        setSelectedIndex(stackIndex);
        setPendingStackSelection(null);
      }
    }
    if (pendingItemSelection) {
      const itemIndex = listRows.findIndex(
        row => row.type === 'item' && row.item.id === pendingItemSelection
      );
      if (itemIndex !== -1) {
        setSelectedIndex(itemIndex);
        setPendingItemSelection(null);
      }
    }
  }, [listRows, pendingStackSelection, pendingItemSelection]);

  // Helper function to check if an element is fully visible in the container
  const isElementFullyVisible = useCallback((element: HTMLElement, container: HTMLElement): boolean => {
    const containerRect = container.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    return elementRect.top >= containerRect.top && elementRect.bottom <= containerRect.bottom;
  }, []);

  // Reset keyboard nav state when mouse moves (re-enables hover selection)
  useEffect(() => {
    if (!isVisible) return;

    const handleMouseMove = () => {
      if (keyboardNavActive) {
        setKeyboardNavActive(false);
      }
    };
    
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [isVisible, keyboardNavActive]);

  useEffect(() => {
    if (!agentImproveStatus) return;
    const timeout = window.setTimeout(() => setAgentImproveStatus(null), 90000);
    return () => window.clearTimeout(timeout);
  }, [agentImproveStatus]);

  useEffect(() => {
    return window.commandsAPI?.onLocalCommandStatus?.((status) => {
      setLocalCommandStatus(status);
    });
  }, []);

  useEffect(() => {
    return window.agentKickoffAPI?.onStatus?.((event) => {
      setLocalCommandStatus(getAgentKickoffFooterStatus(event));
    });
  }, []);

  useEffect(() => {
    if (localCommandStatus?.status !== 'running') {
      setLocalCommandActivityFrameIndex(0);
      return undefined;
    }
    const interval = window.setInterval(() => {
      setLocalCommandActivityFrameIndex((index) => (index + 1) % LOCAL_COMMAND_ACTIVITY_FRAMES.length);
    }, 180);
    return () => window.clearInterval(interval);
  }, [localCommandStatus?.status]);

  useEffect(() => {
    if (!localCommandStatus) return;
    const timeoutMs = localCommandStatus.status === 'running'
      ? 300000
      : localCommandStatus.status === 'error'
        ? 9000
        : 3500;
    const timeout = window.setTimeout(() => setLocalCommandStatus(null), timeoutMs);
    return () => window.clearTimeout(timeout);
  }, [localCommandStatus]);

  const runLocalImproveSelection = useCallback(async () => {
    if (viewMode !== 'librarian' || showSettings) {
      setLocalCommandStatus({
        status: 'error',
        message: 'Open a Field Theory document to improve text',
        commandName: 'improve',
        mode: 'selection',
        error: 'Open a Field Theory document to improve text',
        updatedAt: Date.now(),
      });
      return;
    }
    if (!window.commandsAPI?.runLocalCommand) {
      setLocalCommandStatus({
        status: 'error',
        message: 'Local commands are unavailable',
        commandName: 'improve',
        mode: 'selection',
        error: 'Local commands are unavailable',
        updatedAt: Date.now(),
      });
      return;
    }
    const context = getAgentImproveContext();
    const selectedText = context?.kind === 'selection' ? context.content : '';
    try {
      const activeContext = await window.commandsAPI.getActiveLibraryFileContext?.();
      if (!activeContext && context?.filePath) {
        const normalizedPath = context.filePath.replace(/\\/g, '/');
        const slashIndex = normalizedPath.lastIndexOf('/');
        const rootPath = slashIndex > 0 ? normalizedPath.slice(0, slashIndex) : normalizedPath;
        const relPath = slashIndex >= 0 ? normalizedPath.slice(slashIndex + 1) : normalizedPath;
        await window.commandsAPI.setActiveLibraryFileContext?.({
          type: 'external',
          rootPath,
          relPath,
          filePath: context.filePath,
          title: context.title ?? context.filePath.split('/').pop() ?? 'Document',
        });
      }
      const selection = typeof context?.selectionStart === 'number' && typeof context.selectionEnd === 'number'
        ? { start: context.selectionStart, end: context.selectionEnd }
        : selectedText.trim()
          ? { text: selectedText }
          : null;
      await window.commandsAPI.runLocalCommand({
        commandName: 'improve',
        mode: 'selection',
        selection,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Local improve failed';
      setLocalCommandStatus({
        status: 'error',
        message,
        commandName: 'improve',
        mode: 'selection',
        error: message,
        updatedAt: Date.now(),
      });
    }
  }, [showSettings, viewMode]);

  const openAgentImproveDialog = useCallback(() => {
    const context = getAgentImproveContext();
    if (!context) {
      setAgentImproveStatus('Select text or open a markdown file');
      return;
    }

    setAgentImproveContext(context);
    setAgentImproveInstruction('');
    setShowAgentImproveDialog(true);
  }, []);

  const closeAgentImproveDialog = useCallback(() => {
    if (agentImproveLaunching) return;
    setShowAgentImproveDialog(false);
    setAgentImproveContext(null);
    setAgentImproveInstruction('');
  }, [agentImproveLaunching]);

  const launchAgentImprove = useCallback(async () => {
    if (!agentImproveContext || agentImproveLaunching) return;

    if (!window.agentImproveAPI?.launch) {
      setAgentImproveStatus('Agent improve is unavailable');
      return;
    }

    const tool = agentImproveTool;
    const toolLabel = tool === 'claude' ? 'Claude' : 'Codex';
    const instruction = agentImproveInstruction.trim() || 'Improve this content.';

    setAgentImproveLaunching(true);
    try {
      await window.agentImproveAPI.launch({
        tool,
        instruction,
        content: agentImproveContext.content,
        contextKind: agentImproveContext.kind,
        filePath: agentImproveContext.filePath,
        title: agentImproveContext.title,
      });
      setShowAgentImproveDialog(false);
      setAgentImproveContext(null);
      setAgentImproveInstruction('');
      setAgentImproveStatus(`${toolLabel} running in Terminal`);
    } catch (error) {
      console.error('Failed to launch agent improve:', error);
      setAgentImproveStatus(`Could not start ${toolLabel}`);
    } finally {
      setAgentImproveLaunching(false);
    }
  }, [agentImproveContext, agentImproveInstruction, agentImproveLaunching, agentImproveTool]);

  // Handle keyboard input via standard DOM events (window is focusable).
  useEffect(() => {
    if (!isVisible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const hasShift = e.shiftKey;
      const hasMeta = e.metaKey;
      const hasCtrl = e.ctrlKey;
      const hasAlt = e.altKey;
      const key = e.key;
      const activeElement = document.activeElement;
      const isTypingInTextEntry = isTextEntryElement(activeElement);

      // Cmd+Shift+I: improve selected text with the local model.
      if (key === 'i' && hasMeta && hasShift && !hasCtrl && !hasAlt) {
        e.preventDefault();
        void runLocalImproveSelection();
        return;
      }

      // Shift+Cmd+L to toggle light/dark mode.
      if (isThemeToggleShortcut(e)) {
        e.preventDefault();
        toggleDarkMode();
        return;
      }

      // If typing in the input, let it handle normal characters and Tab
      if (activeElement === inputRef.current &&
          key.length === 1 &&
          !hasMeta && !hasCtrl && !hasAlt &&
          key !== 'ArrowUp' && key !== 'ArrowDown' && key !== 'Enter' && key !== 'Escape') {
        return; // Let input handle it naturally
      }

      // Let Cmd+H pass through to menu for app hiding.
      if (key === 'h' && hasMeta) return;

      const appNavigationDirection = getAppBracketNavigationDirection(e);
      if (appNavigationDirection !== null && navigateAppHistory(appNavigationDirection)) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      
      // Prevent default for navigation keys.
      if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Enter' || key === 'Escape' || 
          key === 'j' || key === 'k' || key === 'u' || key === 'h' || key === '?') {
        if (!isTypingInTextEntry) {
          e.preventDefault();
        }
      }

      const numberTabSurface = getAppNumberTabSurface(e);
      if (numberTabSurface) {
        e.preventDefault();
        setShowSettings(false);
        selectTopNavView(numberTabSurface);
        return;
      }

      // When not in clipboard view, let other views handle their own navigation.
      if (viewMode !== 'clipboard') {
        // In sketch mode, let SketchView handle Escape (returns to the previous surface).
        // Don't close the window - SketchView's handler calls handleSketchClose.
        if (viewMode === 'sketch' && key === 'Escape') {
          return;
        }
        // All other keys: let the active view handle them.
        return;
      }
      
      // Shift+? - Toggle shortcuts modal
      if (key === '?' && hasShift) {
        e.preventDefault();
        setShowShortcutsModal(prev => !prev);
        return;
      }
      
      // / - Focus search input (like Gmail, Google)
      if (key === '/' && !hasMeta && !hasCtrl && !hasAlt && !hasShift) {
        // Skip if already typing in input
        if (isTypingInTextEntry) return;
        e.preventDefault();
        inputRef.current?.focus();
        return;
      }
      
      // Cmd+D - Open blank draw canvas
      if (key === 'd' && hasMeta && !hasCtrl && !hasAlt && !hasShift) {
        e.preventDefault();
        setEditingSketchItem(null);
        setSketchBackgroundImage(null);
        setViewMode('sketch');
        return;
      }
      
      // D - Draw on image (open sketch editor on hovered/selected image OR preview image)
      if (key === 'd' && !hasMeta && !hasCtrl && !hasAlt && !hasShift) {
        if (isTypingInTextEntry) return;
        
        // If preview is open with an image, draw on that
        if (preview && preview.type === 'image') {
          e.preventDefault();
          setSketchBackgroundImage({
            dataUrl: `data:image/png;base64,${preview.data}`,
            width: preview.width || 800,
            height: preview.height || 600,
          });
          setEditingSketchItem(null);
          dismissPreview();
          setViewMode('sketch');
          return;
        }
        
        if (viewMode === 'clipboard' && !showSettings) {
          // Priority: hovered image > selected image
          const hoveredItem = hoveredImageId ? items.find(i => i.id === hoveredImageId) : null;
          const selectedRow = listRows[selectedIndex];
          const selectedItem = selectedRow?.type === 'item' ? selectedRow.item : null;
          // Check for imageData OR thumbnailData (thumbnail indicates it's an image item)
          const imageItem = hoveredItem || (selectedItem?.imageData || selectedItem?.thumbnailData ? selectedItem : null);

          // Only open draw if there's an image item
          if (imageItem && (imageItem.imageData || imageItem.thumbnailData)) {
            e.preventDefault();
            // Load full image data if not already available
            (async () => {
              const fullImageData = await getFullImageData(imageItem.id, imageItem.imageData);
              if (fullImageData) {
                setEditingSketchItem(null);
                setSketchBackgroundImage({
                  dataUrl: `data:image/png;base64,${fullImageData}`,
                  width: imageItem.imageWidth || 800,
                  height: imageItem.imageHeight || 600,
                });
                setViewMode('sketch');
              }
            })();
          }
        }
        return;
      }
      
      // S - Stack selected items (when multiple items are selected)
      if (key === 's' && !hasMeta && !hasCtrl && !hasAlt && !hasShift) {
        // Skip if typing in input
        if (isTypingInTextEntry) return;
        
        if (selectedIds.size > 1) {
          e.preventDefault();
          (async () => {
            // Capture previous stackIds for undo
            const itemIds = Array.from(selectedIds);
            const previousStackIds: (string | null)[] = [];
            for (const id of itemIds) {
              const item = await window.clipboardAPI?.getItem(id);
              previousStackIds.push(item?.stackId ?? null);
            }
            
            // Create a new stack from selected items
            const newStackId = crypto.randomUUID();
            await window.clipboardAPI?.updateStackId?.(itemIds, newStackId);
            
            // Push to undo stack
            pushUndo({ type: 'stack', itemIds, previousStackIds, newStackId });
            showFeedback(`${itemIds.length} items stacked`);
            
            setSelectedIds(new Set());
            setIsMultiSelect(false);
            // Flash the newly created stack and select it
            setRecentlyStackedId(newStackId);
            setPendingStackSelection(newStackId);
            setTimeout(() => setRecentlyStackedId(null), 1500);
            loadItems(true);
          })();
        }
        return;
      }

      // M - Create markdown in Library from the selected row or selected items.
      if (key.toLowerCase() === 'm' && !hasMeta && !hasCtrl && !hasAlt) {
        if (isTypingInTextEntry) return;

        if (selectedIds.size > 0) {
          const selectedItems = items.filter(item => selectedIds.has(item.id));
          if (selectedItems.length > 0) {
            e.preventDefault();
            void handleCreateMarkdownFromItems(selectedItems);
            return;
          }
        }

        const selectedRow = listRows[selectedIndex];
        if (selectedRow?.type === 'stack') {
          e.preventDefault();
          const hasImprovedContent = stackHasImprovedContent(selectedRow.items);
          const showImproved = hasImprovedContent && !viewOriginalIds.has(selectedRow.stack.stackId);
          void handleCreateMarkdownFromItems(selectedRow.items, {
            stackId: selectedRow.stack.stackId,
            contentVersion: showImproved ? 'improved' : 'original',
          });
          return;
        } else if (selectedRow?.type === 'item') {
          e.preventDefault();
          void handleCreateMarkdownFromItems([selectedRow.item]);
          return;
        }
      }

      // M - Open DM modal to send selected item to a contact (disabled by feature flag).
      if (FEATURE_MESSAGE_SHORTCUT_ENABLED && key === 'm' && !hasMeta && !hasCtrl && !hasAlt && !hasShift) {
        // Skip if typing in input
        if (isTypingInTextEntry) return;
        e.preventDefault();
        
        // Load contacts for the modal.
        (async () => {
          if (!window.socialAPI) return;
          const contacts = await window.socialAPI.getContacts();
          setDmContacts(contacts.filter(c => c.contactUserId).map(c => ({
            id: c.id,
            userId: c.contactUserId,
            email: c.contactEmail,
            name: c.contactName,
          })));
          setDmRecipientQuery('');
          setSelectedDmContactIndex(0);
          setShowDMModal(true);
        })();
        return;
      }

      // F - Show feedback confirmation modal (in clipboard view), or open feedback view.
      if (key === 'f' && !hasMeta && !hasCtrl && !hasAlt && !hasShift) {
        // Skip if typing in input.
        if (isTypingInTextEntry) return;
        e.preventDefault();

        // In clipboard view with a selected item, show confirmation modal.
        if (viewMode === 'clipboard' && listRows.length > 0) {
          const selectedRow = listRows[selectedIndex];
          if (selectedRow) {
            const itemId = selectedRow.type === 'item'
              ? selectedRow.item.id
              : selectedRow.items[0]?.id;

            if (itemId) {
              setFeedbackModalFocus('share');
              setShowFeedbackModal(true);
              return;
            }
          }
        }

        // Otherwise, open feedback view.
        setViewMode('feedback');
        return;
      }

      // X - Toggle selection on current item (Gmail-style)
      if (key === 'x' && !hasMeta && !hasCtrl && !hasAlt && !hasShift) {
        // Skip if typing in input
        if (isTypingInTextEntry) return;
        e.preventDefault();
        
        const selectedRow = listRows[selectedIndex];
        if (!selectedRow) return;
        
        // Get item IDs to toggle (single item or all items in stack)
        const itemIdsToToggle: number[] = [];
        if (selectedRow.type === 'item') {
          itemIdsToToggle.push(selectedRow.item.id);
        } else if (selectedRow.type === 'stack') {
          selectedRow.items.forEach(i => itemIdsToToggle.push(i.id));
        }
        
        // Toggle selection on current item
        setSelectedIds(prev => {
          const next = new Set(prev);
          const allSelected = itemIdsToToggle.every(id => next.has(id));
          if (allSelected) {
            // Deselect
            itemIdsToToggle.forEach(id => next.delete(id));
          } else {
            // Select
            itemIdsToToggle.forEach(id => next.add(id));
          }
          return next;
        });
        setLastClickedIndex(selectedIndex);
        setIsMultiSelect(true);
        return;
      }

      // Debug: Cmd+Shift+U to simulate update notification states
      if (key === 'u' && hasMeta && e.shiftKey) {
        e.preventDefault();
        if (updateStatus === 'idle') {
          setUpdateStatus('available');
          setUpdateVersion('2.0.0');
        } else if (updateStatus === 'available') {
          setUpdateStatus('downloading');
          // Simulate download completing after 1.5s
          setTimeout(() => setUpdateStatus('ready'), 1500);
        } else {
          setUpdateStatus('idle');
          setUpdateVersion(null);
        }
        return;
      }
      
      // Feedback modal keyboard navigation
      if (showFeedbackModal) {
        if (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'Tab') {
          e.preventDefault();
          setFeedbackModalFocus(prev => prev === 'share' ? 'cancel' : 'share');
          return;
        }
        if (key === 'Enter') {
          e.preventDefault();
          if (feedbackModalFocus === 'cancel') {
            setShowFeedbackModal(false);
          } else {
            // Submit feedback
            const selectedRow = listRows[selectedIndex];
            if (selectedRow) {
              const itemId = selectedRow.type === 'item'
                ? selectedRow.item.id
                : selectedRow.items[0]?.id;

              if (itemId) {
                (async () => {
                  if (!window.socialAPI) return;
                  const result = await window.socialAPI.submitFeedback(itemId);
                  if (result) {
                    showFeedback('sent as feedback');
                  }
                })();
              }
            }
            setShowFeedbackModal(false);
          }
          return;
        }
      }

      if (key === 'Escape') {
        // If in settings, return to the previous Field Theory surface.
        if (showSettings) {
          e.preventDefault();
          setShowSettings(false);
          return;
        }
        // If dragging, cancel the drag first
        if (activeDragId) {
          e.preventDefault();
          setActiveDragId(null);
          setOverDropId(null);
          return;
        }
        // If preview is open, dismiss it first
        if (preview) {
          e.preventDefault();
          dismissPreview();
          return;
        }
        // If shortcuts modal is open, close it (don't close window)
        if (showShortcutsModal) {
          e.preventDefault();
          setShowShortcutsModal(false);
          return;
        }
        // If feedback modal is open, close it (don't close window)
        if (showFeedbackModal) {
          e.preventDefault();
          setShowFeedbackModal(false);
          return;
        }
        // If agent improve dialog is open, close it (don't close window)
        if (showAgentImproveDialog) {
          e.preventDefault();
          closeAgentImproveDialog();
          return;
        }
        // If search input is focused, blur it and select first item instead of closing
        if (activeElement === inputRef.current) {
          e.preventDefault();
          inputRef.current?.blur();
          setSelectedIndex(0);
          return;
        }
        // If items are X-selected, clear selection first (before closing window)
        if (selectedIds.size > 0) {
          e.preventDefault();
          setSelectedIds(new Set());
          setIsMultiSelect(false);
          return;
        }
        window.clipboardAPI?.closeWindow();
        return;
      }

      // J/ArrowDown - Move selection down (Gmail-style)
      if (key === 'ArrowDown' || (key === 'j' && !hasMeta && !hasCtrl && !hasAlt)) {
        // If search input is focused, blur it and focus first list item (Alfred-style).
        if (document.activeElement === inputRef.current) {
          e.preventDefault();
          inputRef.current?.blur();
          setSelectedIndex(0);
          setKeyboardNavActive(true);
          // Scroll first item into view.
          const element = listRef.current?.children[0] as HTMLElement;
          element?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          return;
        }
        // Skip if typing in other inputs (not the search input).
        if (isTypingInTextEntry) return;
        
        e.preventDefault();
        setKeyboardNavActive(true);
        const newIndex = Math.min(selectedIndex + 1, listRows.length - 1);
        
        // If preview is open, update preview for new row and reset stack index.
        if (preview && newIndex !== selectedIndex) {
          const newRow = listRows[newIndex];
          if (newRow) updatePreviewForRow(newRow);
        }
        
        const element = listRef.current?.children[newIndex] as HTMLElement;
        const container = listRef.current;
        if (element && container) {
          element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          requestAnimationFrame(() => {
            setSelectedIndex(newIndex);
          });
        } else {
          setSelectedIndex(newIndex);
        }
        return;
      }

      // K/ArrowUp - Move selection up (Gmail-style)
      if (key === 'ArrowUp' || (key === 'k' && !hasMeta && !hasCtrl && !hasAlt)) {
        // Skip if typing in input.
        if (isTypingInTextEntry) return;
        
        e.preventDefault();
        
        // If at first item, focus search input - but only for ArrowUp, not 'k'.
        // This lets users stay in the list with vim keys while arrows can exit.
        if (selectedIndex === 0) {
          if (key === 'ArrowUp') {
            inputRef.current?.focus();
          }
          return;
        }
        
        setKeyboardNavActive(true);
        const newIndex = Math.max(selectedIndex - 1, 0);
        
        // If preview is open, update preview for new row and reset stack index.
        if (preview && newIndex !== selectedIndex) {
          const newRow = listRows[newIndex];
          if (newRow) updatePreviewForRow(newRow);
        }
        
        const element = listRef.current?.children[newIndex] as HTMLElement;
        const container = listRef.current;
        if (element && container) {
          element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          requestAnimationFrame(() => {
            setSelectedIndex(newIndex);
          });
        } else {
          setSelectedIndex(newIndex);
        }
        return;
      }
      
      // U - Unstack the selected stack, or unstack hovered image
      if (key === 'u' && !hasMeta && !hasCtrl && !hasAlt && !hasShift) {
        // Skip if typing in input
        if (isTypingInTextEntry) return;
        
        // If hovering over an image in a stack, unstack just that image
        if (hoveredImageId !== null) {
          const hoveredItem = items.find(i => i.id === hoveredImageId);
          if (hoveredItem?.stackId) {
            e.preventDefault();
            const previousStackId = hoveredItem.stackId;
            (async () => {
              await window.clipboardAPI?.updateStackId?.([hoveredImageId], null);
              pushUndo({ type: 'unstack', itemIds: [hoveredImageId], previousStackId });
              showFeedback('item unstacked');
              setPendingItemSelection(hoveredImageId);
              loadItems(true);
            })();
            return;
          }
        }
        
        const selectedRow = listRows[selectedIndex];
        if (selectedRow?.type === 'stack' && selectedRow.items.length > 1) {
          e.preventDefault();
          const itemIds = selectedRow.items.map(i => i.id);
          const previousStackId = selectedRow.stack.stackId;
          // After unstack, select the first (most recent) item from the stack
          const firstItemId = selectedRow.items[0]?.id;
          (async () => {
            await window.clipboardAPI?.updateStackId?.(itemIds, null);
            pushUndo({ type: 'unstack', itemIds, previousStackId });
            showFeedback('stack unstacked');
            if (firstItemId) {
              setPendingItemSelection(firstItemId);
            }
            loadItems(true);
          })();
        }
        return;
      }
      
      // E or H - Toggle "Show more" / "Hide" expansion on selected row(s)
      if ((key === 'e' || key === 'h') && !hasMeta && !hasCtrl && !hasAlt && !hasShift) {
        // Skip if typing in input
        if (isTypingInTextEntry) return;
        
        e.preventDefault();
        
        // If multi-select is active, expand all selected items.
        if (selectedIds.size > 0) {
          selectedIds.forEach(itemId => {
            toggleItemExpanded(itemId);
          });
          return;
        }
        
        // Otherwise expand the currently selected row.
        const selectedRow = listRows[selectedIndex];
        if (!selectedRow) return;
        
        if (selectedRow.type === 'stack') {
          toggleStackExpanded(selectedRow.stack.stackId);
        } else if (selectedRow.type === 'item') {
          toggleItemExpanded(selectedRow.item.id);
        }
        return;
      }
      
      // Delete / Backspace - Delete selected item.
      if (key === 'Delete' || key === 'Backspace') {
        // Skip if typing in input.
        if (isTypingInTextEntry) return;
        
        e.preventDefault();
        const selectedRow = listRows[selectedIndex];
        (async () => {
          if (selectedRow?.type === 'item') {
            const item = await window.clipboardAPI?.getItem(selectedRow.item.id);
            await window.clipboardAPI?.deleteItem(selectedRow.item.id);
            if (item) {
              pushUndo({ type: 'delete', items: [item] });
              showFeedback('item deleted');
            }
            loadItems(true);
          } else if (selectedRow?.type === 'stack') {
            const itemsToDelete: ClipboardItem[] = [];
            for (const stackItem of selectedRow.items) {
              const item = await window.clipboardAPI?.getItem(stackItem.id);
              if (item) {
                itemsToDelete.push(item);
              }
            }
            for (const item of selectedRow.items) {
              await window.clipboardAPI?.deleteItem(item.id);
            }
            if (itemsToDelete.length > 0) {
              pushUndo({ type: 'delete', items: itemsToDelete });
              showFeedback(itemsToDelete.length === 1 ? 'item deleted' : `${itemsToDelete.length} items deleted`);
            }
            loadItems(true);
          }
        })();
        return;
      }

      // t: Share to Team - disabled because clipboard items never sync.
      if (canShare && key === 't' && !hasMeta && !hasCtrl && !hasShift) {
        // Skip if typing in input.
        if (isTypingInTextEntry) return;

        e.preventDefault();
        (async () => {
          // If items are multi-selected, share them.
          if (selectedIds.size > 0) {
            if (selectedIds.size === 1) {
              const itemId = Array.from(selectedIds)[0];
              await shareToTeam(itemId);
            } else {
              await shareStackToTeam(Array.from(selectedIds));
            }
            setSelectedIds(new Set());
            setIsMultiSelect(false);
            return;
          }

          // Otherwise share the J/K selected row.
          const selectedRow = listRows[selectedIndex];
          if (!selectedRow) return;

          if (selectedRow.type === 'item') {
            await shareToTeam(selectedRow.item.id);
          } else if (selectedRow.type === 'stack') {
            const itemIds = selectedRow.items.map(i => i.id);
            await shareStackToTeam(itemIds);
          }
        })();
        return;
      }

      if (key === 'Enter' && !hasShift && !hasMeta) {
        // Skip if user is typing in an input field - let Enter submit forms naturally.
        if (isTypingInTextEntry) {
          return;
        }
        
        // Default paste goes to previousApp (the app you were just in).
        // Option+Enter goes to targetApp when one is already known.
        // Fallback to previousApp if targetApp is not set.
        const pasteBundleId = hasAlt
          ? (targetAppInfo.targetApp?.bundleId ?? targetAppInfo.previousApp?.bundleId)
          : targetAppInfo.previousApp?.bundleId;
        
        if (selectedIds.size > 0) {
          // Paste multi-selected items
          window.clipboardAPI?.pasteStack(Array.from(selectedIds), pasteBundleId);
          setSelectedIds(new Set());
          setIsMultiSelect(false);
        } else {
          // Check what type of row is selected
          const selectedRow = listRows[selectedIndex];
          if (selectedRow?.type === 'stack') {
            // Paste all items in the stack
            const itemIds = selectedRow.items.map(i => i.id);
            window.clipboardAPI?.pasteStack(itemIds, pasteBundleId);
          } else if (selectedRow?.type === 'item') {
            // Paste single item to target app
            window.clipboardAPI?.pasteItem(selectedRow.item.id, pasteBundleId, selectedRow.item.useImprovedVersion);
          }
        }
        return;
      }

      // Cmd+C: Copy selected/hovered item to clipboard
      if (key === 'c' && hasMeta && !hasShift) {
        if (shouldDeferCopyShortcutToNative()) {
          return;
        }

        const selectedRow = listRows[selectedIndex];
        if (selectedRow?.type === 'item') {
          e.preventDefault();
          copyItem(selectedRow.item.id, `item-${selectedRow.item.id}`, selectedRow.item.useImprovedVersion);
        } else if (selectedRow?.type === 'stack' && selectedRow.items.length > 0) {
          e.preventDefault();
          copyStack(selectedRow.items, `stack-${selectedRow.items.map(i => i.id).join(',')}`);
        }
        return;
      }

      // Cmd+Z: Undo last action
      if (key === 'z' && hasMeta && !hasShift && undoStack.length > 0) {
        e.preventDefault();
        (async () => {
          const action = undoStack[undoStack.length - 1];
          setUndoStack(prev => prev.slice(0, -1));
          
          if (action.type === 'delete') {
            // Restore deleted items
            for (const item of action.items) {
              if (window.clipboardAPI?.restoreItem) {
                await window.clipboardAPI.restoreItem(item);
              }
            }
            // Push to redo stack (redo will re-delete)
            setRedoStack(prev => [...prev, action]);
          } else if (action.type === 'stack') {
            // Restore previous stackIds
            for (let i = 0; i < action.itemIds.length; i++) {
              const itemId = action.itemIds[i];
              const prevStackId = action.previousStackIds[i];
              await window.clipboardAPI?.updateStackId?.([itemId], prevStackId);
            }
            setRedoStack(prev => [...prev, action]);
          } else if (action.type === 'unstack') {
            // Re-stack items back to their previous stack
            await window.clipboardAPI?.updateStackId?.(action.itemIds, action.previousStackId);
            setRedoStack(prev => [...prev, action]);
          }
          
          showFeedback('undone');
          loadItems(true);
        })();
        return;
      }
      
      // Cmd+Shift+Z: Redo last undone action
      if (key === 'z' && hasMeta && hasShift && redoStack.length > 0) {
        e.preventDefault();
        (async () => {
          const action = redoStack[redoStack.length - 1];
          setRedoStack(prev => prev.slice(0, -1));
          
          if (action.type === 'delete') {
            // Re-delete items
            for (const item of action.items) {
              await window.clipboardAPI?.deleteItem(item.id);
            }
            setUndoStack(prev => [...prev, action]);
          } else if (action.type === 'stack') {
            // Re-stack items with the new stackId
            await window.clipboardAPI?.updateStackId?.(action.itemIds, action.newStackId);
            setUndoStack(prev => [...prev, action]);
          } else if (action.type === 'unstack') {
            // Re-unstack items (set stackId to null)
            await window.clipboardAPI?.updateStackId?.(action.itemIds, null);
            setUndoStack(prev => [...prev, action]);
          }
          
          showFeedback('redone');
          loadItems(true);
        })();
        return;
      }

      // Escape key - close preview modal if open
      if (e.key === 'Escape' && preview) {
        e.preventDefault();
        dismissPreview();
        return;
      }
      
      // Arrow keys when preview is open: L/R navigates within stack, U/D changes rows
      if (preview && stackPreviewItems.length > 1) {
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          if (stackPreviewIndex < stackPreviewItems.length - 1) {
            const newIndex = stackPreviewIndex + 1;
            const nextItem = stackPreviewItems[newIndex];
            setStackPreviewIndex(newIndex);
            setPreview(nextItem);
            // Load full image if needed
            if (nextItem.type === 'image' && !imageCache.current.has(nextItem.itemId)) {
              loadFullImageForPreview(nextItem.itemId, nextItem);
            }
          }
          return;
        }
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          if (stackPreviewIndex > 0) {
            const newIndex = stackPreviewIndex - 1;
            const prevItem = stackPreviewItems[newIndex];
            setStackPreviewIndex(newIndex);
            setPreview(prevItem);
            // Load full image if needed
            if (prevItem.type === 'image' && !imageCache.current.has(prevItem.itemId)) {
              loadFullImageForPreview(prevItem.itemId, prevItem);
            }
          }
          return;
        }
        
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          const nextRowIndex = Math.min(selectedIndex + 1, listRows.length - 1);
          if (nextRowIndex !== selectedIndex) {
            setSelectedIndex(nextRowIndex);
            const nextRow = listRows[nextRowIndex];
            if (nextRow) updatePreviewForRow(nextRow);
          }
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          const prevRowIndex = Math.max(selectedIndex - 1, 0);
          if (prevRowIndex !== selectedIndex) {
            setSelectedIndex(prevRowIndex);
            const prevRow = listRows[prevRowIndex];
            if (prevRow) updatePreviewForRow(prevRow);
          }
          return;
        }
      }
      
      // Spacebar - Quick Look style preview (images or text)
      if (e.key === ' ') {
        // If typing in an input, let spacebar work normally.
        if (isTypingInTextEntry) {
          return;
        }
        
        // If preview is open, dismiss it (spacebar toggles preview on/off).
        // Arrow keys are used to navigate within stack items.
        if (preview) {
          e.preventDefault();
          dismissPreview();
          return;
        }
        
        // If hovering over an image, open preview for it (single item, no stack nav).
        if (hoveredImageId !== null) {
          e.preventDefault();
          const hoveredItem = items.find(item => item.id === hoveredImageId);
          if (hoveredItem?.imageData || hoveredItem?.thumbnailData) {
            setStackPreviewItems([]);
            setStackPreviewIndex(0);
            // Use cached full image if available, otherwise show what we have.
            const cachedFullImage = imageCache.current.get(hoveredItem.id);
            const displayData = cachedFullImage || hoveredItem.imageData || hoveredItem.thumbnailData || '';
            const previewContent: PreviewContent = {
              type: 'image',
              data: displayData,
              width: hoveredItem.imageWidth || 0,
              height: hoveredItem.imageHeight || 0,
              itemId: hoveredItem.id,
              stackId: hoveredItem.stackId,
              figureLabel: hoveredItem.figureLabel ?? undefined,
            };
            setPreview(previewContent);
            // Load full image in background if we only have thumbnail.
            if (!cachedFullImage && !hoveredItem.imageData) {
              loadFullImageForPreview(hoveredItem.id, previewContent);
            }
          }
          return;
        }
        
        // Preview J/K selected row (image or text).
        const selectedRow = listRows[selectedIndex];
        if (selectedRow) {
          e.preventDefault();
          
          if (selectedRow.type === 'item') {
            // Single item - no stack navigation needed.
            setStackPreviewItems([]);
            setStackPreviewIndex(0);
            const item = selectedRow.item;
            if (item.imageData || item.thumbnailData) {
              const cachedFullImage = imageCache.current.get(item.id);
              const displayData = cachedFullImage || item.imageData || item.thumbnailData || '';
              const previewContent: PreviewContent = {
                type: 'image',
                data: displayData,
                width: item.imageWidth || 0,
                height: item.imageHeight || 0,
                itemId: item.id,
                stackId: item.stackId,
                figureLabel: item.figureLabel ?? undefined,
              };
              setPreview(previewContent);
              // Load full image in background if we only have thumbnail.
              if (!cachedFullImage && !item.imageData) {
                loadFullImageForPreview(item.id, previewContent);
              }
            } else if (item.content) {
              setPreview({ type: 'text', content: item.content });
            }
          } else if (selectedRow.type === 'stack') {
            // Stack - build preview sequence and start at first item.
            const previewItems = getStackPreviewItems(selectedRow.items);
            if (previewItems.length > 0) {
              setStackPreviewItems(previewItems);
              setStackPreviewIndex(0);
              setPreview(previewItems[0]);
              // Load full image for the first item if needed.
              const firstImageItem = selectedRow.items.find(i => i.imageData || i.thumbnailData);
              if (firstImageItem && !imageCache.current.has(firstImageItem.id) && !firstImageItem.imageData) {
                loadFullImageForPreview(firstImageItem.id, previewItems[0]);
              }
              // Prefetch all images in the stack for smooth navigation.
              const imageItemIds = selectedRow.items
                .filter(i => i.imageData || i.thumbnailData)
                .map(i => i.id);
              prefetchImages(imageItemIds);
            }
          }
          return;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isVisible, items, selectedIndex, selectedIds, targetAppInfo, listRows, preview, hoveredImageId, dismissPreview, shareToTeam, shareStackToTeam, viewMode, canShare, librarianEnabled, setViewMode, updatePreviewForRow, loadFullImageForPreview, getFullImageData, getStackPreviewItems, stackPreviewIndex, stackPreviewItems, prefetchImages, toggleDarkMode, runLocalImproveSelection, showAgentImproveDialog, closeAgentImproveDialog, handleCreateMarkdownFromItems, viewOriginalIds]);

  // No automatic scrolling - user manually scrolls, keyboard only navigates visible items
  
  // Prefetch images for selected and adjacent rows for instant preview.
  useEffect(() => {
    const rowsToCheck = [
      listRows[selectedIndex - 1],
      listRows[selectedIndex],
      listRows[selectedIndex + 1],
    ].filter(Boolean) as ListRow[];
    
    const imageItemIds: number[] = [];
    for (const row of rowsToCheck) {
      if (row.type === 'stack') {
        row.items.forEach(item => {
          if ((item.imageData || item.thumbnailData) && !imageCache.current.has(item.id)) {
            imageItemIds.push(item.id);
          }
        });
      } else if (row.item.imageData || row.item.thumbnailData) {
        if (!imageCache.current.has(row.item.id)) {
          imageItemIds.push(row.item.id);
        }
      }
    }
    
    if (imageItemIds.length > 0) {
      prefetchImages(imageItemIds);
    }
  }, [selectedIndex, listRows, prefetchImages]);

  // Handle item click with modifier key support for multi-select
  const handleItemClick = (item: ClipboardItem, index: number, e?: React.MouseEvent) => {
    const hasShift = e?.shiftKey;
    const hasMeta = e?.metaKey || e?.ctrlKey; // Cmd on Mac, Ctrl on Windows
    
    // Shift+click (with or without Cmd): range selection
    // Use lastClickedIndex as anchor, or selectedIndex if no previous click
    if (hasShift) {
      const anchorIndex = lastClickedIndex ?? selectedIndex;
      const start = Math.min(anchorIndex, index);
      const end = Math.max(anchorIndex, index);
      
      // If Cmd is also held, add to existing selection; otherwise replace
      const newSelectedIds = hasMeta ? new Set(selectedIds) : new Set<number>();
      
      // Add all items in range
      for (let i = start; i <= end; i++) {
        const row = listRows[i];
        if (row?.type === 'item') {
          newSelectedIds.add(row.item.id);
        } else if (row?.type === 'stack') {
          // For stacks, add all items in the stack
          row.items.forEach(stackItem => newSelectedIds.add(stackItem.id));
        }
      }
      
      setSelectedIds(newSelectedIds);
      setSelectedIndex(index);
      setIsMultiSelect(true);
      // Don't update lastClickedIndex on Shift+click - keep the anchor
      return;
    }
    
    // Cmd/Ctrl+click: toggle individual selection
    if (hasMeta) {
      setSelectedIds(prev => {
        const next = new Set(prev);
        if (next.has(item.id)) {
          next.delete(item.id);
        } else {
          next.add(item.id);
        }
        return next;
      });
      setSelectedIndex(index);
      setLastClickedIndex(index);
      setIsMultiSelect(true);
      return;
    }
    
    // Already in multi-select mode: toggle selection
    if (isMultiSelect || selectedIds.size > 0) {
      setSelectedIds(prev => {
        const next = new Set(prev);
        if (next.has(item.id)) {
          next.delete(item.id);
        } else {
          next.add(item.id);
        }
        return next;
      });
      setSelectedIndex(index);
      setLastClickedIndex(index);
    } else {
      // Normal click: paste to previousApp (the app you were just in).
      // Option+click: paste to targetApp when one is already known.
      const hasAlt = e?.altKey;
      // Fallback to previousApp if targetApp is not set.
      const pasteBundleId = hasAlt
        ? (targetAppInfo.targetApp?.bundleId ?? targetAppInfo.previousApp?.bundleId)
        : targetAppInfo.previousApp?.bundleId;
      
      window.clipboardAPI?.pasteItem(item.id, pasteBundleId, item.useImprovedVersion);
    }
  };

  // Handle load more.
  const handleLoadMore = () => {
    if (!loading && hasMore) {
      loadItems(false);
    }
  };

  // Handle delete selected items
  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) return;
    
    // Store items for undo before deleting
    const itemsToDelete: ClipboardItem[] = [];
    for (const id of selectedIds) {
      const item = await window.clipboardAPI?.getItem(id);
      if (item) {
        itemsToDelete.push(item);
      }
    }
    
    // Delete all selected items
    for (const id of selectedIds) {
      await window.clipboardAPI?.deleteItem(id);
    }
    
    // Push to undo stack and show feedback
    if (itemsToDelete.length > 0) {
      pushUndo({ type: 'delete', items: itemsToDelete });
      showFeedback(itemsToDelete.length === 1 ? 'item deleted' : `${itemsToDelete.length} items deleted`);
    }
    
    // Clear selection and reload
    setSelectedIds(new Set());
    setIsMultiSelect(false);
    setLastClickedIndex(null);
    loadItems(true);
  };

  const handleWindowBoundaryMouseLeave = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!isClientPointOutsideBounds(event.clientX, event.clientY, bounds)) return;
    setFocusChromeGroupOpacity(0);
    setThemeToggleProximityVisible(false);
  }, []);

  const cancelLocalCommandRun = useCallback(async () => {
    const status = localCommandStatus;
    const runId = status?.runId;
    if (!runId || !window.commandsAPI?.cancelMaxwellRun) return;
    const showCancelError = (message: string) => {
      setLocalCommandStatus({
        status: 'error',
        message,
        commandName: status.commandName,
        filePath: status.filePath,
        mode: status.mode,
        runId,
        error: message,
        updatedAt: Date.now(),
      });
    };
    try {
      const result = await window.commandsAPI.cancelMaxwellRun(runId);
      if (!result.success) {
        showCancelError(result.error ?? 'Could not cancel Maxwell run');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not cancel Maxwell run';
      showCancelError(message);
    }
  }, [localCommandStatus]);

  if (!isVisible) {
    return null;
  }

  // All items are shown (no filtering).
  const filteredItems = items;

  // Toggle stack expansion.
  const toggleStackExpanded = (stackId: string) => {
    setExpandedStacks(prev => {
      const next = new Set(prev);
      if (next.has(stackId)) {
        next.delete(stackId);
      } else {
        next.add(stackId);
      }
      return next;
    });
  };

  // Toggle individual item expansion.
  const toggleItemExpanded = (itemId: number) => {
    setExpandedItems(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  };
  
  const checkTextOverflow = (id: string) => (el: HTMLElement | null) => {
    if (!el) return;
    requestAnimationFrame(() => {
      const isOverflowing = el.scrollHeight > el.clientHeight;
      setOverflowingTexts(prev => {
        const hadOverflow = prev.has(id);
        if (isOverflowing && !hadOverflow) {
          const next = new Set(prev);
          next.add(id);
          return next;
        } else if (!isOverflowing && hadOverflow) {
          const next = new Set(prev);
          next.delete(id);
          return next;
        }
        return prev;
      });
    });
  };

  const renderThemeToggleButton = () => (
    <button
      onClick={toggleDarkMode}
      title={`${theme.isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'} (⇧⌘L)`}
      aria-label={theme.isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
      style={{
        width: '18px',
        height: '18px',
        padding: 0,
        backgroundColor: 'transparent',
        border: `1px solid ${theme.border}`,
        borderRadius: '4px',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'all 0.15s ease',
      }}
    >
      {theme.isDark ? (
        <svg width="10" height="10" viewBox="0 0 24 24" fill={theme.textSecondary} stroke="none">
          <circle cx="12" cy="12" r="4" />
          <rect x="11" y="1" width="2" height="4" rx="1" />
          <rect x="11" y="19" width="2" height="4" rx="1" />
          <rect x="19" y="11" width="4" height="2" rx="1" />
          <rect x="1" y="11" width="4" height="2" rx="1" />
          <rect x="17.5" y="4.1" width="2" height="4" rx="1" transform="rotate(45 18.5 6.1)" />
          <rect x="4.5" y="15.9" width="2" height="4" rx="1" transform="rotate(45 5.5 17.9)" />
          <rect x="15.9" y="17.5" width="4" height="2" rx="1" transform="rotate(45 17.9 18.5)" />
          <rect x="4.1" y="4.5" width="4" height="2" rx="1" transform="rotate(45 6.1 5.5)" />
        </svg>
      ) : (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={theme.textSecondary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
    </button>
  );

  const renderMaxwellHistoryButton = (extraStyle: React.CSSProperties = {}) => (
    <button
      onClick={() => setMaxwellHistoryOpen((open) => !open)}
      title="Maxwell history"
      aria-label="Maxwell history"
      style={{
        width: '18px',
        height: '18px',
        padding: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: maxwellHistoryOpen ? theme.accent : 'transparent',
        border: `1px solid ${theme.border}`,
        borderRadius: '4px',
        cursor: 'pointer',
        transition: 'background-color 0.15s ease',
        flexShrink: 0,
        ...extraStyle,
      }}
    >
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={maxwellHistoryOpen ? '#fff' : theme.textSecondary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 12a9 9 0 1 0 3-6.7" />
        <path d="M3 3v6h6" />
        <path d="M12 7v5l3 2" />
      </svg>
    </button>
  );

  const renderMaxwellCancelButton = () => (
    <button
      onClick={() => void cancelLocalCommandRun()}
      title="Cancel Maxwell run"
      aria-label="Cancel Maxwell run"
      style={{
        width: '18px',
        height: '18px',
        padding: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'transparent',
        border: `1px solid ${theme.border}`,
        borderRadius: '4px',
        color: theme.textSecondary,
        cursor: 'pointer',
        flexShrink: 0,
      }}
    >
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M18 6 6 18" />
        <path d="m6 6 12 12" />
      </svg>
    </button>
  );

  const renderPriorityMicControl = () => {
    if (audioDevices.length === 0) return null;
    return (
      <div
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          ...FIELD_THEORY_TOP_CHROME_NO_DRAG_STYLE,
        }}
        data-mic-dropdown
      >
        <button
          onClick={() => setShowMicDropdown(!showMicDropdown)}
          title="Priority Mic"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '3px',
            padding: '5px 6px',
            fontSize: '9px',
            color: theme.textSecondary,
            backgroundColor: 'transparent',
            border: 'none',
            borderRadius: '3px',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            maxWidth: '112px',
            overflow: 'hidden',
          }}
        >
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
            <line x1="12" y1="19" x2="12" y2="23"/>
            <line x1="8" y1="23" x2="16" y2="23"/>
          </svg>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {priorityDeviceId
              ? audioDevices.find(d => d.id === priorityDeviceId)?.name?.replace(/^(Built-in |MacBook )/, '') || 'Mic'
              : 'None'}
          </span>
          <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>

        {showMicDropdown && (
          <>
            <div
              onClick={() => setShowMicDropdown(false)}
              style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                zIndex: 199,
              }}
            />
            <div
              style={{
                position: 'absolute',
                top: '100%',
                right: 0,
                marginTop: '4px',
                backgroundColor: theme.isDark ? '#2a2a2a' : '#fff',
                border: `1px solid ${theme.border}`,
                borderRadius: '6px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                zIndex: 200,
                minWidth: '180px',
                maxWidth: '240px',
                padding: '4px 0',
              }}
            >
              <button
                onClick={() => {
                  window.audioAPI?.setPriorityDevice(null);
                  setShowMicDropdown(false);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  width: '100%',
                  padding: '6px 10px',
                  fontSize: '11px',
                  color: !priorityDeviceId ? theme.accent : theme.text,
                  backgroundColor: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                {!priorityDeviceId && <span style={{ color: theme.accent }}>✓</span>}
                <span style={{ marginLeft: !priorityDeviceId ? 0 : '16px' }}>None</span>
              </button>

              <div style={{ height: '1px', backgroundColor: theme.border, margin: '4px 0' }} />

              {audioDevices.map(device => (
                <button
                  key={device.id}
                  onClick={() => {
                    if (!priorityMicQuotaExhausted) {
                      window.audioAPI?.setPriorityDevice(device.id);
                      setShowMicDropdown(false);
                    }
                  }}
                  disabled={priorityMicQuotaExhausted}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    width: '100%',
                    padding: '6px 10px',
                    fontSize: '11px',
                    color: priorityMicQuotaExhausted
                      ? theme.textSecondary
                      : priorityDeviceId === device.id
                        ? theme.accent
                        : theme.text,
                    backgroundColor: 'transparent',
                    border: 'none',
                    cursor: priorityMicQuotaExhausted ? 'not-allowed' : 'pointer',
                    textAlign: 'left',
                    overflow: 'hidden',
                    opacity: priorityMicQuotaExhausted ? 0.5 : 1,
                  }}
                >
                  {priorityDeviceId === device.id && <span style={{ color: theme.accent }}>✓</span>}
                  <span style={{
                    marginLeft: priorityDeviceId === device.id ? 0 : '16px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {device.name}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    );
  };

  const localCommandActivityFrame = LOCAL_COMMAND_ACTIVITY_FRAMES[localCommandActivityFrameIndex] ?? LOCAL_COMMAND_ACTIVITY_FRAMES[0];
  const footerStatusLabel = localCommandStatus
    ? formatFooterLocalCommandStatus(
      localCommandStatus,
      localCommandStatus.status === 'running' ? localCommandActivityFrame : undefined,
    )
    : agentImproveStatus;
  const showFocusStatusOverlay = focusChromeOverlayActive && !footerChromeInteractive && !!footerStatusLabel;
  const focusStatusOverlayColor = localCommandStatus?.status === 'error' ? theme.error : theme.textSecondary;

  // Window fills the entire BrowserWindow now (no overlay).
  // Native macOS vibrancy handles the blur effect at the window level.
  return (
    <>
      {/* CSS keyframes for animations */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.1); }
        }
        @keyframes previewFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes previewFadeOut {
          from { opacity: 1; }
          to { opacity: 0; }
        }
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes focusLogoFadeIn {
          from { opacity: 0; }
          to { opacity: 0.62; }
        }
        @keyframes localStatusFadeOut {
          0%, 68% { opacity: 0.9; }
          100% { opacity: 0; }
        }
      `}</style>


      <div
        ref={dialogRef}
        onMouseLeave={handleWindowBoundaryMouseLeave}
        style={{
          width: '100%',
          height: '100%',
          boxSizing: 'border-box',
          backgroundColor: theme.bg,  // Use theme background color.
          color: theme.text,  // Use theme text color for all descendants.
          // Native window roundedCorners handles the border radius.
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          position: 'relative',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          cursor: 'default',
          opacity: windowStyleTransition === 'idle' ? 1 : 0,
          filter: windowStyleTransition === 'idle' ? 'none' : 'blur(6px)',
          transition: 'opacity 140ms ease, filter 140ms ease',
        }}
      >
      <div
        data-field-theory-top-chrome-drag-layer
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: `${FIELD_THEORY_CHROME_TABS_TOP_PX}px`,
          zIndex: 1,
          cursor: 'grab',
          ...FIELD_THEORY_TOP_CHROME_DRAG_STYLE,
        }}
      />
      {/* Thin draggable region at very top of window for frameless window drag (NSPanel fix) */}
      {!showInDock && librarianImmersive && viewMode === 'librarian' && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '8px',
            zIndex: 30,
            // @ts-ignore - webkit vendor prefix for Electron draggable region
            WebkitAppRegion: 'drag',
            cursor: 'grab',
          }}
        />
      )}
      {/* Titlebar area for stoplight buttons when in Dock mode */}
      {showInDock && (
        <div
          style={{
            height: `${FIELD_THEORY_APP_TITLEBAR_HEIGHT_PX}px`,
            minHeight: `${FIELD_THEORY_APP_TITLEBAR_HEIGHT_PX}px`,
            // @ts-ignore - webkit vendor prefix for Electron draggable region
            WebkitAppRegion: 'drag',
            cursor: 'grab',
          }}
        />
      )}
      
      {/* Draggable header area - collapses in Librarian immersive mode */}
      <div
        style={{
          height: 0,
          minHeight: 0,
          overflow: 'visible',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'center',
          position: 'relative',
          paddingTop: 0,
          paddingLeft: '16px',
          paddingRight: '16px',
          zIndex: 10,
          // @ts-ignore - webkit vendor prefix for Electron draggable region
          WebkitAppRegion: 'drag',
          cursor: 'grab',
          borderBottom: 'none',
          opacity: appChromeOpacity,
          pointerEvents: appChromeInteractive ? 'auto' : 'none',
          transition: 'height 0.3s ease, min-height 0.3s ease, padding-top 0.3s ease, opacity 90ms linear',
        }}
      >
      </div>

      {showFocusChromeIcon && (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: focusChromeIconTop,
            left: focusChromeContentCenterX === null ? '50%' : `${focusChromeContentCenterX}px`,
            transform: 'translateX(-50%)',
            zIndex: 20,
            height: `${FOCUS_CHROME_ICON_SIZE_PX}px`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
            opacity: focusChromeIconOpacity,
          }}
        >
          <img
            src={theme.isDark ? 'fieldtheory-icon.png' : 'field-theory-icon-black.png'}
            alt=""
            style={{
              height: `${FOCUS_CHROME_ICON_SIZE_PX}px`,
              width: 'auto',
              display: 'block',
            }}
          />
        </div>
      )}

      {/* View mode tabs - collapses in Librarian immersive mode */}
      {viewMode !== 'sketch' && (
        <div
          ref={tabsRef}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: `${chromeTabsTopPx}px 28px 0 20px`,
            marginTop: 0,
            marginBottom: `${FIELD_THEORY_CHROME_TABS_BOTTOM_PX}px`,
            height: 'auto',
            minHeight: '32px',
            overflow: 'visible',
            opacity: appChromeOpacity,
            pointerEvents: appChromeInteractive ? 'auto' : 'none',
            transition: 'height 0.3s ease, min-height 0.3s ease, margin-top 0.3s ease, margin-bottom 0.3s ease, opacity 90ms linear',
            cursor: 'grab',
            ...FIELD_THEORY_TOP_CHROME_DRAG_STYLE,
          }}>
          {([
            ['librarian', 'Library', 'Personal wiki'],
            ['clipboard', TAB_LABELS.clipboard, undefined],
          ] as const).map(([mode, label, title]) => {
            const isSelected = viewMode === mode && !showSettings;
            const bgColor = isSelected ? theme.accent : 'transparent';

            return (
              <button
                key={mode}
                onClick={() => {
                  selectTopNavView(mode as TopNavMode);
                }}
                data-top-nav-mode={mode}
                tabIndex={0}
                style={{
                  position: 'relative',
                  padding: '6px 8px',
                  fontSize: '11px',
                  fontWeight: 400,
                  backgroundColor: bgColor,
                  color: isSelected ? '#fff' : theme.textSecondary,
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  transition: 'none',
                  outline: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  ...FIELD_THEORY_TOP_CHROME_NO_DRAG_STYLE,
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.backgroundColor = theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }
                }}
                title={title}
              >
                {label}
                {/* New reading indicator for Librarian tab */}
                {mode === 'librarian' && hasNewReading && viewMode !== 'librarian' && (
                  <span style={{
                    position: 'absolute',
                    top: '-2px',
                    right: '-2px',
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    backgroundColor: theme.info,
                  }} />
                )}
              </button>
            );
          })}

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
            {actionFeedback && (
              <span 
                style={{ 
                  fontSize: '9px', 
                  fontWeight: 500,
                  color: theme.textSecondary,
                }}
              >
                {actionFeedback}
              </span>
            )}
            
            {(transcriptionStatus === 'recording' || transcriptionStatus === 'transcribing') && (
              <div 
                style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '4px',
                  position: 'relative',
                  ...FIELD_THEORY_TOP_CHROME_NO_DRAG_STYLE,
                }}
                onMouseEnter={() => transcriptionStatus === 'recording' && setShowRecordingTooltip(true)}
                onMouseLeave={() => setShowRecordingTooltip(false)}
              >
              <span
                style={{
                  width: '6px',
                  height: '6px',
                  backgroundColor: transcriptionStatus === 'recording' ? theme.error : '#af52de',
                  borderRadius: '50%',
                  animation: 'pulse 1.5s ease-in-out infinite',
                }}
              />
              <span style={{ 
                fontSize: '9px', 
                fontWeight: 500, 
                color: transcriptionStatus === 'recording' ? theme.error : '#af52de',
                cursor: 'help',
              }}>
                {transcriptionStatus === 'recording' ? 'Recording' : 'Transcribing'}
              </span>
              {/* Tooltip explaining escape behavior */}
              {transcriptionStatus === 'recording' && showRecordingTooltip && (
                <div
                  style={{
                    position: 'absolute',
                    top: '100%',
                    right: 0,
                    marginTop: '8px',
                    backgroundColor: '#1a1a1a',
                    color: '#fff',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    fontSize: '11px',
                    lineHeight: 1.4,
                    whiteSpace: 'nowrap',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                    zIndex: 100,
                    maxWidth: '280px',
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: '4px' }}>Escape key behavior:</div>
                  <div style={{ opacity: 0.9 }}>• Window open: closes window, keeps recording</div>
                  <div style={{ opacity: 0.9 }}>• Window closed: abandons recording</div>
                  {/* Tooltip caret */}
                  <div
                    style={{
                      position: 'absolute',
                      bottom: '100%',
                      right: '12px',
                      width: 0,
                      height: 0,
                      borderLeft: '6px solid transparent',
                      borderRight: '6px solid transparent',
                      borderBottom: '6px solid #1a1a1a',
                    }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Draw button — this button only renders when viewMode !== 'sketch'
              (outer guard), so no active-state styling is needed. */}
          <button
            onClick={() => {
              setEditingSketchItem(null);
              setSketchBackgroundImage(null);
              setViewMode('sketch');
              setShowSettings(false);
            }}
            tabIndex={0}
            style={{
              padding: '5px 6px',
              fontSize: '9px',
              fontWeight: 500,
              backgroundColor: 'transparent',
              color: theme.textSecondary,
              border: 'none',
              borderRadius: '3px',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              outline: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: '3px',
              ...FIELD_THEORY_TOP_CHROME_NO_DRAG_STYLE,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
            title="Create a new drawing"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 19l7-7 3 3-7 7-3-3z" />
              <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
              <path d="M2 2l7.586 7.586" />
            </svg>
            Draw
          </button>

          {renderPriorityMicControl()}

          {/* Feedback button */}
          <button
            onClick={() => {
              setViewMode('feedback');
              setShowSettings(false);
            }}
            tabIndex={0}
            style={{
              padding: '5px',
              width: '22px',
              height: '22px',
              fontSize: '9px',
              fontWeight: 500,
              backgroundColor: viewMode === 'feedback' && !showSettings ? theme.accent : 'transparent',
              color: viewMode === 'feedback' && !showSettings ? '#fff' : theme.textSecondary,
              border: `1px solid ${viewMode === 'feedback' && !showSettings ? theme.accent : theme.border}`,
              borderRadius: '3px',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              outline: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative',
              ...FIELD_THEORY_TOP_CHROME_NO_DRAG_STYLE,
            }}
            onMouseEnter={(e) => {
              if (viewMode !== 'feedback' || showSettings) {
                e.currentTarget.style.backgroundColor = theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)';
              }
            }}
            onMouseLeave={(e) => {
              if (viewMode !== 'feedback' || showSettings) {
                e.currentTarget.style.backgroundColor = 'transparent';
              }
            }}
            title="Send feedback (F)"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            {/* Notification dot for new feedback - only when authenticated */}
            {hasUnreadFeedback && viewMode !== 'feedback' && authSession?.user?.email && (
              <span style={{
                position: 'absolute',
                top: '-2px',
                right: '-2px',
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                backgroundColor: theme.info,
              }} />
            )}
          </button>

          {/* Settings button */}
          <button
            onClick={() => { if (!showSettings) setShowSettings(true); }}
            tabIndex={0}
            style={{
              padding: '5px',
              width: '22px',
              height: '22px',
              fontSize: '9px',
              fontWeight: 500,
              backgroundColor: showSettings ? theme.accent : 'transparent',
              color: showSettings ? '#fff' : theme.textSecondary,
              border: `1px solid ${showSettings ? theme.accent : theme.border}`,
              borderRadius: '3px',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              outline: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              ...FIELD_THEORY_TOP_CHROME_NO_DRAG_STYLE,
            }}
            onMouseEnter={(e) => {
              if (!showSettings) {
                e.currentTarget.style.backgroundColor = theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)';
              }
            }}
            onMouseLeave={(e) => {
              if (!showSettings) {
                e.currentTarget.style.backgroundColor = 'transparent';
              }
            }}
            title="Settings"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>

          </div>
        </div>
      )}

      {/* Draw mode navigation - show when in sketch mode */}
      {!showSettings && viewMode === 'sketch' && (
        <div 
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: `${showInDock ? 22 : 14}px 16px 8px 16px`,
            marginBottom: '8px',
            position: 'relative',
            cursor: 'grab',
            ...FIELD_THEORY_TOP_CHROME_DRAG_STYLE,
          }}>
          {/* Left: Back button */}
          <button
            onClick={() => {
              if (sketchHasChanges) {
                if (window.confirm('You have unsaved changes. Discard drawing?')) {
                  handleSketchClose();
                }
              } else {
                handleSketchClose();
              }
            }}
            tabIndex={0}
            style={{
              padding: '6px 12px',
              fontSize: '10px',
              fontWeight: 500,
              backgroundColor: 'transparent',
              color: theme.textSecondary,
              border: `1px solid ${theme.border}`,
              borderRadius: '4px',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              outline: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              ...FIELD_THEORY_TOP_CHROME_NO_DRAG_STYLE,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)';
              e.currentTarget.style.borderColor = theme.text;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.borderColor = theme.border;
            }}
          >
            Back
          </button>
          
          {/* Right: Recording indicator + Save buttons */}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
            {/* Recording indicator in Draw mode - left of save buttons */}
            {(transcriptionStatus === 'recording' || transcriptionStatus === 'transcribing') && (
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '4px',
                marginRight: '4px',
              }}>
                <span
                  style={{
                    width: '6px',
                    height: '6px',
                    backgroundColor: transcriptionStatus === 'recording' ? theme.error : '#af52de',
                    borderRadius: '50%',
                    animation: 'pulse 1.5s ease-in-out infinite',
                  }}
                />
                <span style={{ 
                  fontSize: '9px', 
                  fontWeight: 500, 
                  color: transcriptionStatus === 'recording' ? theme.error : '#af52de',
                }}>
                  {transcriptionStatus === 'recording' ? 'Recording' : 'Transcribing'}
                </span>
              </div>
            )}
            <button
              onClick={() => {
                sketchViewRef.current?.save(false);
              }}
              disabled={!sketchHasChanges}
              tabIndex={0}
              style={{
                padding: '6px 8px',
                fontSize: '10px',
                fontWeight: 500,
                backgroundColor: 'transparent',
                color: theme.textSecondary,
                opacity: sketchHasChanges ? 1 : 0.5,
                border: `1px solid ${theme.border}`,
                borderRadius: '4px',
                cursor: sketchHasChanges ? 'pointer' : 'default',
                transition: 'all 0.15s ease',
                outline: 'none',
                ...FIELD_THEORY_TOP_CHROME_NO_DRAG_STYLE,
              }}
              onMouseEnter={(e) => {
                if (sketchHasChanges) {
                  e.currentTarget.style.backgroundColor = theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)';
                  e.currentTarget.style.borderColor = theme.text;
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.borderColor = theme.border;
              }}
            >
              save
            </button>
            <button
              onClick={() => {
                sketchViewRef.current?.save(true);
              }}
              disabled={!sketchHasChanges}
              tabIndex={0}
              style={{
                padding: '6px 8px',
                fontSize: '10px',
                fontWeight: 500,
                backgroundColor: 'transparent',
                color: theme.textSecondary,
                opacity: sketchHasChanges ? 1 : 0.5,
                border: `1px solid ${theme.border}`,
                borderRadius: '4px',
                cursor: sketchHasChanges ? 'pointer' : 'default',
                transition: 'all 0.15s ease',
                outline: 'none',
                ...FIELD_THEORY_TOP_CHROME_NO_DRAG_STYLE,
              }}
              onMouseEnter={(e) => {
                if (sketchHasChanges) {
                  e.currentTarget.style.backgroundColor = theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)';
                  e.currentTarget.style.borderColor = theme.text;
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.borderColor = theme.border;
              }}
            >
              save & copy
            </button>
          </div>
        </div>
      )}

      {keepLibrarianMounted && (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: librarianSurfaceVisible ? 'flex' : 'none',
            flexDirection: 'column',
            borderTop: focusChromeOverlayActive ? 'none' : `1px solid ${getSettingsDividerColor(theme)}`,
          }}
        >
          <LibrarianView
            active={librarianSurfaceVisible}
            onSwitchToClipboard={handleLibrarianSwitchToClipboard}
            onSwitchToSettings={handleLibrarianSwitchToSettings}
            onFullScreenChange={setLibrarianImmersive}
            onFocusChromeActiveChange={handleFocusChromeActiveChange}
            onBookmarksCanvasActiveChange={setBookmarksCanvasChromeActive}
            onBookmarksCanvasToolbarTopChange={setBookmarksCanvasToolbarTop}
            focusChromeGroupOpacity={focusChromeGroupOpacity}
            focusChromeEnabled={focusChromeGlobalEnabled}
            onFocusChromeEnabledChange={handleGlobalFocusChromeChange}
            initialReadingPath={pendingReadingPath}
            initialOpenTarget={pendingLibraryOpenTarget}
            initialFullScreen={librarianImmersive}
            onInitialReadingConsumed={handleLibrarianReadingConsumed}
            onInitialOpenTargetConsumed={handleLibrarianOpenTargetConsumed}
            autoPopArtifactPath={autoPopArtifactPath}
            onAutoPopArtifactSuperseded={handleAutoPopArtifactSuperseded}
            onOpenCommandPath={handleLibrarianOpenCommandPath}
            onFocusChromeShortcut={enableGlobalFocusChrome}
            onFocusChromeContentCenterChange={setFocusChromeContentCenterX}
            preserveCurrentSizeKey={libraryKeepsCurrentSizeKey}
            sidebarCollapsed={navSidebarCollapsed}
            sidebarToggleRequestKey={librarySidebarToggleRequestKey}
          />
        </div>
      )}

      {/* Conditionally show Settings, Todo View, Feedback View, or Clipboard History */}
      {showSettings ? (
        <SettingsPanel
          onNavigateToSignIn={() => {
            // Show onboarding window at account/sign-in step
            window.onboardingAPI?.showSignIn();
          }}
          onNavigateToFeedback={() => {
            setShowSettings(false);
            setViewMode('feedback');
          }}
          librarianEnabled={librarianEnabled}
          onLibrarianEnabledChange={setLibrarianEnabled}
          onPerformanceHudEnabledChange={setPerformanceHudEnabled}
          initialSection={settingsSection as any}
        />
      ) : viewMode === 'todo' && fieldTheorySyncEnabled ? (
        <TodoView onSwitchToClipboard={() => setViewMode('clipboard')} />
      ) : viewMode === 'librarian' ? (
        null
      ) : viewMode === 'feedback' ? (
        // Feedback view - rendered inline for authenticated users, sign-in prompt for others
        sessionInitialized && authSession?.user?.email ? (
          <DMsView feedbackOnly onSwitchToClipboard={() => setViewMode('clipboard')} />
        ) : sessionInitialized ? (
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '40px',
            textAlign: 'center',
          }}>
            <div style={{
              fontSize: '32px',
              marginBottom: '16px',
              opacity: 0.5,
            }}>💬</div>
            <h3 style={{ margin: '0 0 8px 0', fontSize: '14px', color: theme.text }}>
              Sign in to send feedback
            </h3>
            <p style={{ margin: '0 0 16px 0', fontSize: '12px', color: theme.textSecondary }}>
              Share ideas, report issues, or ask questions.
            </p>
            <button
              onClick={() => {
                setSettingsSection('account');
                setShowSettings(true);
              }}
              style={{
                padding: '8px 16px',
                fontSize: '12px',
                fontWeight: 500,
                color: '#fff',
                backgroundColor: theme.accent,
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
              }}
            >
              Sign In
            </button>
          </div>
        ) : (
          <div style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: theme.textSecondary,
            fontSize: '12px',
          }}>
            Loading...
          </div>
        )
      ) : viewMode === 'possible' ? (
        <PossibleGraphView onSwitchToClipboard={() => setViewMode('clipboard')} />
      ) : viewMode === 'sketch' ? (
        <Suspense fallback={<div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Loading...</div>}>
          <SketchView
            ref={sketchViewRef}
            onSave={handleSketchSave}
            onClose={handleSketchClose}
            existingSketch={editingSketchItem ? {
              id: editingSketchItem.id,
              imageData: editingSketchItem.imageData || '',
              width: editingSketchItem.imageWidth || undefined,
              height: editingSketchItem.imageHeight || undefined,
            } : null}
            backgroundImage={sketchBackgroundImage}
            hideHeader={true}
            onHasChangesChange={setSketchHasChanges}
            associatedTranscripts={sketchAssociatedTranscripts}
            onUnstackTranscript={handleUnstackTranscript}
          />
        </Suspense>
      ) : (
        <div 
          style={{ 
            flex: 1, 
            display: 'flex', 
            flexDirection: 'column', 
            overflow: 'hidden', 
            padding: '12px 10px 16px',
            borderTop: `1px solid ${getSettingsDividerColor(theme)}`,
          }}
        >
          {/* Screen Recording Permission Banner */}
          {!screenRecordingGranted && !hideScreenRecordingBanner && (
            <div 
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 12px',
                marginBottom: '8px',
                backgroundColor: theme.isDark ? 'rgba(245, 158, 11, 0.15)' : 'rgba(245, 158, 11, 0.1)',
                border: `1px solid ${theme.isDark ? 'rgba(245, 158, 11, 0.3)' : 'rgba(245, 158, 11, 0.2)'}`,
                borderRadius: '8px',
                fontSize: '12px',
                color: theme.text,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>📸</span>
                <span>Screen Recording permission needed for screenshots</span>
              </div>
              <button
                onClick={() => window.onboardingAPI?.openScreenRecordingSettings()}
                style={{
                  padding: '4px 10px',
                  fontSize: '11px',
                  fontWeight: 500,
                  backgroundColor: theme.isDark ? 'rgba(245, 158, 11, 0.3)' : 'rgba(245, 158, 11, 0.2)',
                  border: 'none',
                  borderRadius: '4px',
                  color: theme.text,
                  cursor: 'pointer',
                }}
              >
                Enable
              </button>
            </div>
          )}

          {/* Search input */}
          <div style={{ 
            position: 'relative',
            marginBottom: selectedIds.size > 0 ? '0' : '8px',
            transition: 'margin-bottom 0.15s ease',
          }}>
            <input
              ref={inputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search clipboard (/)"
              data-fieldtheory-top-nav-search="true"
              style={{
                width: '100%',
                height: '30px',
                padding: '0 10px',
                border: `1px solid ${theme.border}`,
                borderRadius: '6px',
                fontSize: '11px',
                outline: 'none',
                boxSizing: 'border-box',
                backgroundColor: theme.isDark ? 'rgba(255,255,255,0.055)' : 'rgba(255,255,255,0.55)',
                color: theme.text,
                // @ts-ignore - prevent drag on input
                WebkitAppRegion: 'no-drag',
              }}
            />
          </div>
          
          {/* Selection actions bar - slides in when active */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              padding: '0 8px',
              height: selectedIds.size > 0 ? '24px' : '0',
              marginBottom: selectedIds.size > 0 ? '4px' : '0',
              transition: 'height 0.15s ease, margin-bottom 0.15s ease',
              overflow: 'hidden',
            }}
          >
            {selectedIds.size > 0 && (
              <div
                style={{
                  fontSize: '11px',
                  color: theme.textSecondary,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <span style={{ fontWeight: 500 }}>{selectedIds.size} selected</span>
                <span style={{ color: theme.border }}>•</span>
                <button
                  tabIndex={-1}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={handleDeleteSelected}
                  style={{
                    padding: '2px 6px',
                    fontSize: '10px',
                    backgroundColor: 'transparent',
                    color: theme.textSecondary,
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  delete <KeyCap small>⌫</KeyCap>
                </button>
                {/* Share to Team button - hidden when sharing feature is disabled */}
                {canShare && (
                  <button
                    tabIndex={-1}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={async () => {
                      // Share selected items to team
                      if (selectedIds.size === 1) {
                        // Single item - share directly
                        const itemId = Array.from(selectedIds)[0];
                        await shareToTeam(itemId);
                      } else {
                        // Multiple items - share as a stack
                        await shareStackToTeam(Array.from(selectedIds));
                      }
                      setSelectedIds(new Set());
                      setIsMultiSelect(false);
                      setLastClickedIndex(null);
                    }}
                    disabled={sharingToTeam !== null}
                    style={{
                      padding: '2px 6px',
                      fontSize: '10px',
                      backgroundColor: 'transparent',
                      color: sharingToTeam !== null ? theme.border : theme.textSecondary,
                      border: 'none',
                      borderRadius: '4px',
                      cursor: sharingToTeam !== null ? 'default' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                  >
                    {sharingToTeam !== null ? 'Sharing...' : 'share'} <KeyCap>t</KeyCap>
                  </button>
                )}
                {selectedIds.size > 1 && (
                  <button
                    tabIndex={-1}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={async () => {
                      const newStackId = crypto.randomUUID();
                      await window.clipboardAPI?.updateStackId?.(Array.from(selectedIds), newStackId);
                      setSelectedIds(new Set());
                      setIsMultiSelect(false);
                      setLastClickedIndex(null);
                      setRecentlyStackedId(newStackId);
                      setPendingStackSelection(newStackId);
                      setTimeout(() => setRecentlyStackedId(null), 1500);
                      loadItems(true);
                    }}
                    style={{
                      padding: '2px 6px',
                      fontSize: '10px',
                      backgroundColor: 'transparent',
                      color: theme.textSecondary,
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                  >
                    stack <KeyCap small>s</KeyCap>
                  </button>
                )}
                <button
                  tabIndex={-1}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setSelectedIds(new Set());
                    setIsMultiSelect(false);
                    setLastClickedIndex(null);
                  }}
                  style={{
                    padding: '2px 6px',
                    fontSize: '10px',
                    backgroundColor: 'transparent',
                    color: theme.textSecondary,
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  clear <KeyCap small>esc</KeyCap>
                </button>
              </div>
            )}
          </div>

          {/* Items list */}
          <DndContext
            sensors={sensors}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
          >
          <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            {/* Scroll indicator: more items above */}
            <div
              onClick={() => listRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: 28,
                background: `linear-gradient(to bottom, ${theme.bg}ee, ${theme.bg}00)`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 10,
                cursor: showScrollTop ? 'pointer' : 'default',
                pointerEvents: showScrollTop ? 'auto' : 'none',
                opacity: showScrollTop ? 1 : 0,
                transition: 'opacity 0.2s ease',
              }}
            >
              <span style={{
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  backgroundColor: theme.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                  color: theme.textSecondary,
                }}>↑</span>
            </div>
          <div
            ref={listRef}
            style={{
              flex: 1,
              overflowY: 'auto',
              overflowX: 'hidden',
              minHeight: 0,
              borderRadius: '8px',
              border: `1px solid ${theme.border}`,
              marginTop: '8px',
            }}
          >
        {listRows.length === 0 && loading ? (
          <div
            style={{
              padding: '40px',
              textAlign: 'center',
              color: theme.textSecondary,
            }}
          >
            Loading...
          </div>
        ) : listRows.length === 0 ? (
          <div
            style={{
              padding: '40px 24px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '20px',
              color: theme.textSecondary,
            }}
          >
            <span style={{ fontSize: '13px' }}>No items yet</span>
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              fontSize: '11px',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '24px' }}>
                <span style={{ opacity: 0.7 }}>Open Field Theory</span>
                <span style={{ fontFamily: 'monospace', opacity: 0.5 }}>⌥ Space</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '24px' }}>
                <span style={{ opacity: 0.7 }}>Record transcription</span>
                <span style={{ fontFamily: 'monospace', opacity: 0.5 }}>⌘ \</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '24px' }}>
                <span style={{ opacity: 0.7 }}>Take screenshot</span>
                <span style={{ fontFamily: 'monospace', opacity: 0.5 }}>⌥ 4</span>
              </div>
            </div>
          </div>
        ) : (
          listRows.map((row, index) => {
            if (row.type === 'stack') {
              // Render a prompt stack row
              const { stack, items: stackItems, expanded } = row;

              // Get images and text separately for rendering
              // Check for thumbnailData too - large images only have thumbnails in list queries.
              const stackImages = stackItems.filter(i => (i.type === 'image' || i.type === 'screenshot') && (i.imageData || i.thumbnailData));
              // Check if stack has improved content for toggle UI
              const hasImprovedContent = stackHasImprovedContent(stackItems);
              // Show improved content unless user toggled to view original
              const showImproved = hasImprovedContent && !viewOriginalIds.has(stack.stackId);
              const combinedText = combineStackText(stackItems, showImproved);
              const hasText = combinedText.length > 0;
              const hasPartialStackItems = stack.itemCount > stackItems.length;
              // Show previousApp by default, targetApp when Option is held.
              // Fall back to previousApp name if targetApp isn't set.
              const displayAppName = optionHeld
                ? (targetAppInfo.targetApp?.name || targetAppInfo.previousApp?.name || 'most recent app')
                : (targetAppInfo.previousApp?.name || 'most recent app');
              // "Show more" is controlled by actual overflow detection, not character count.
              const textIsOverflowing = overflowingTexts.has(stack.stackId);

              const stackDragId = `stack:${stack.stackId}`;
              const isStackDragging = activeDragId === stackDragId;
              const isStackOver = overDropId === stackDragId;

              return (
                <div key={`stack-${stack.stackId}`}>
                  {/* Stack row - dnd-kit handles drag */}
                  <DraggableDroppableRow
                    id={stackDragId}
                    isDragging={isStackDragging}
                    isOver={isStackOver && !isStackDragging}
                    onMouseEnter={(e) => {
                      // Always track hover for button visibility
                      setHoveredRowIndex(index);
                      // Skip selection update if keyboard nav is active
                      if (keyboardNavActive) return;
                      // Skip if already selected (prevents render cascade)
                      if (selectedIndex === index) return;
                      // Only highlight if the item is fully visible (prevents jumping)
                      const element = e.currentTarget;
                      const container = listRef.current;
                      if (container && isElementFullyVisible(element, container)) {
                        setSelectedIndex(index);
                      }
                    }}
                    onMouseLeave={() => setHoveredRowIndex(null)}
                    onClick={async (e) => {
                      const hasShift = e.shiftKey;
                      const hasMeta = e.metaKey || e.ctrlKey; // Cmd on Mac, Ctrl on Windows
                      
                      // Shift+click (with or without Cmd): range selection
                      if (hasShift) {
                        const anchorIndex = lastClickedIndex ?? selectedIndex;
                        const start = Math.min(anchorIndex, index);
                        const end = Math.max(anchorIndex, index);
                        
                        // If Cmd is also held, add to existing selection; otherwise replace
                        const newSelectedIds = hasMeta ? new Set(selectedIds) : new Set<number>();
                        
                        // Add all items in range
                        for (let i = start; i <= end; i++) {
                          const row = listRows[i];
                          if (row?.type === 'item') {
                            newSelectedIds.add(row.item.id);
                          } else if (row?.type === 'stack') {
                            // For stacks, add all items in the stack
                            row.items.forEach(stackItem => newSelectedIds.add(stackItem.id));
                          }
                        }
                        
                        setSelectedIds(newSelectedIds);
                        setSelectedIndex(index);
                        setIsMultiSelect(true);
                        return;
                      }
                      
                      // Cmd/Ctrl+click: toggle individual selection
                      if (hasMeta) {
                        setSelectedIds(prev => {
                          const next = new Set(prev);
                          // Toggle all items in the stack
                          const stackItemIds = stackItems.map(i => i.id);
                          const allSelected = stackItemIds.every(id => next.has(id));
                          if (allSelected) {
                            // Deselect all items in stack
                            stackItemIds.forEach(id => next.delete(id));
                          } else {
                            // Select all items in stack
                            stackItemIds.forEach(id => next.add(id));
                          }
                          return next;
                        });
                        setSelectedIndex(index);
                        setLastClickedIndex(index);
                        setIsMultiSelect(true);
                        return;
                      }
                      
                      // Already in multi-select mode: toggle selection
                      if (isMultiSelect || selectedIds.size > 0) {
                        setSelectedIds(prev => {
                          const next = new Set(prev);
                          const stackItemIds = stackItems.map(i => i.id);
                          const allSelected = stackItemIds.every(id => next.has(id));
                          if (allSelected) {
                            // Deselect all items in stack
                            stackItemIds.forEach(id => next.delete(id));
                          } else {
                            // Select all items in stack
                            stackItemIds.forEach(id => next.add(id));
                          }
                          return next;
                        });
                        setSelectedIndex(index);
                        setLastClickedIndex(index);
                        return;
                      }
                      
                      // Normal click: paste to previousApp (the app you were just in).
                      // Option+click: paste to targetApp when one is already known.
                      const hasAlt = e.altKey;
                      // Fallback to previousApp if targetApp is not set.
                      const pasteBundleId = hasAlt
                        ? (targetAppInfo.targetApp?.bundleId ?? targetAppInfo.previousApp?.bundleId)
                        : targetAppInfo.previousApp?.bundleId;
                      
                      // Paste all items in the stack
                      const resolvedStackItems = hasPartialStackItems
                        ? (await fetchStackItemsById([stack.stackId]))[stack.stackId] ?? stackItems
                        : stackItems;
                      const itemIds = resolvedStackItems.map(i => i.id);
                      window.clipboardAPI?.pasteStack(itemIds, pasteBundleId);
                    }}
                    style={{
                      padding: '10px 16px 6px 16px',
                      backgroundColor: recentlyStackedId === stack.stackId
                        ? theme.isDark ? 'rgba(45, 212, 191, 0.2)' : 'rgba(20, 184, 166, 0.15)'
                        : stackItems.some(item => selectedIds.has(item.id))
                          ? theme.selectedBg
                          : selectedIndex === index
                            ? theme.hoverBg
                            : hoveredRowIndex === index
                              ? theme.hoverBg
                              : theme.listItemBg,
                      // J/K highlight gets darker gray borders for definition
                      borderTop: selectedIndex === index ? `1px solid ${theme.isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)'}` : '1px solid transparent',
                      borderBottom: selectedIndex === index ? `1px solid ${theme.isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)'}` : `1px solid ${theme.border}`,
                      borderRight: selectedIndex === index ? `1px solid ${theme.isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)'}` : '1px solid transparent',
                      // Left indicator is now an inner element to avoid corner radius bending.
                      borderLeft: '2px solid transparent',
                      boxShadow: selectedIndex === index
                        ? theme.isDark 
                          ? '0 2px 8px rgba(0,0,0,0.3)' 
                          : '0 2px 8px rgba(0,0,0,0.08)'
                        : 'none',
                      transition: 'background-color 0.3s ease, box-shadow 0.3s ease',
                      cursor: activeDragId ? 'grabbing' : 'grab',
                      userSelect: 'none',
                      position: 'relative',
                    }}
                  >
                    {/* Left selection indicator - inset to avoid corner radius bending */}
                    {(recentlyStackedId === stack.stackId || selectedIndex === index || stackItems.some(item => selectedIds.has(item.id))) && (
                      <div style={{
                        position: 'absolute',
                        left: 0,
                        top: 4,
                        bottom: 4,
                        width: (recentlyStackedId === stack.stackId || selectedIndex === index) 
                          ? (stackItems.some(item => selectedIds.has(item.id)) ? '4px' : '2px') 
                          : '2px',
                        backgroundColor: (recentlyStackedId === stack.stackId || selectedIndex === index)
                          ? (theme.isDark ? '#2dd4bf' : '#14b8a6')
                          : theme.selectedBorder,
                        borderRadius: '1px',
                        transition: 'width 0.1s ease, background-color 0.1s ease',
                      }} />
                    )}
                    {/* Content section with icon column */}
                    <div style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '16px',
                    }}>
                      {/* Content type icons in 2x2 quad grid on left - all 4 always visible, dimmed when inactive */}
                      {/* Order: transcript (top-left), image (top-right), path/URL (bottom-left), text (bottom-right) */}
                      {(() => {
                        const hasTranscripts = stackItems.some(i => i.type === 'transcript');
                        const hasImages = stack.imageCount > 0 || stackItems.some(i => i.type === 'image' || i.type === 'screenshot');
                        const hasPathsOrUrls = stackItems.some(i => (i.type === 'text') && i.content && (
                          i.content.startsWith('/') || i.content.startsWith('~') || i.content.startsWith('file://') ||
                          i.content.startsWith('http://') || i.content.startsWith('https://')
                        ));
                        const hasPlainText = stackItems.some(i => (i.type === 'text') && i.content && !(
                          i.content.startsWith('/') || i.content.startsWith('~') || i.content.startsWith('file://') ||
                          i.content.startsWith('http://') || i.content.startsWith('https://')
                        ));
                        // Colors for each content type (gray when disabled)
                        const disabledColor = theme.isDark ? '#4b5563' : '#d1d5db'; // gray
                        const transcriptColor = hasTranscripts ? '#8b5cf6' : disabledColor; // violet
                        const imageColor = hasImages ? '#10b981' : disabledColor; // emerald
                        const pathUrlColor = hasPathsOrUrls ? '#3b82f6' : disabledColor; // blue for paths/URLs
                        const textColor = hasPlainText ? '#f59e0b' : disabledColor; // amber for plain text
                        return (
                          <div style={{
                            width: '36px',
                            height: '36px',
                            flexShrink: 0,
                            display: 'grid',
                            gridTemplateColumns: '12px 12px',
                            gridTemplateRows: '12px 12px',
                            gap: '6px',
                            alignContent: 'center',
                            justifyContent: 'center',
                          }}>
                            {/* Transcript - violet (top-left) */}
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={transcriptColor} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
                              <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                              <line x1="12" x2="12" y1="19" y2="22"/>
                            </svg>
                            {/* Image - emerald (top-right) */}
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={imageColor} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>
                              <circle cx="9" cy="9" r="2"/>
                              <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>
                            </svg>
                            {/* Path/URL - blue (bottom-left) - folder with link */}
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={pathUrlColor} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>
                              <path d="M10 14a2 2 0 0 0 3 .2l1-1a2 2 0 0 0-2.8-2.8l-.6.6"/>
                              <path d="M14 12a2 2 0 0 0-3-.2l-1 1a2 2 0 0 0 2.8 2.8l.6-.6"/>
                            </svg>
                            {/* Plain text - amber (bottom-right) - T icon */}
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={textColor} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="4 7 4 4 20 4 20 7"/>
                              <line x1="12" x2="12" y1="4" y2="20"/>
                              <line x1="8" x2="16" y1="20" y2="20"/>
                            </svg>
                          </div>
                        );
                      })()}

                      {/* Main content area */}
                      <div style={{ flex: 1 }}>
                      {/* Inline image thumbnails - horizontal row (oldest first) */}
                      {stackImages.length > 0 && (
                        <div style={{
                          display: 'flex',
                          gap: '8px',
                          marginBottom: combinedText ? '4px' : '0px',
                          flexWrap: 'wrap',
                        }}>
                          {[...stackImages].reverse().map((item, thumbIndex) => (
                            <StackImageThumbnail
                              key={item.id}
                              item={item}
                              onHover={setHoveredImageId}
                              onPreview={(previewContent) => {
                                // Set up full stack preview sequence for arrow key navigation
                                const previewItems = getStackPreviewItems(stackItems);
                                if (previewItems.length > 0) {
                                  setStackPreviewItems(previewItems);
                                  // Find the index of clicked image in preview items
                                  // Images are reversed for display, so calculate correct index
                                  const reversedIndex = stackImages.length - 1 - thumbIndex;
                                  const previewIndex = previewItems.findIndex(
                                    p => p.type === 'image' && p.itemId === stackImages[reversedIndex]?.id
                                  );
                                  setStackPreviewIndex(previewIndex >= 0 ? previewIndex : 0);
                                  setPreview(previewContent);
                                  // Prefetch all images in the stack
                                  const imageItemIds = stackItems
                                    .filter((i: ClipboardItem) => i.imageData || i.thumbnailData)
                                    .map((i: ClipboardItem) => i.id);
                                  prefetchImages(imageItemIds);
                                } else {
                                  setPreview(previewContent);
                                }
                              }}
                            />
                          ))}
                        </div>
                      )}

                      {/* Combined text */}
                      {combinedText && (() => {
                        // Use smart truncation to show beginning and end of text.
                        const truncated = smartTruncateText(combinedText, 8, containerWidth);
                        const showSmartTruncation = !expanded && truncated.needsTruncation;
                        
                        if (expanded) {
                          // Expanded state: show full text.
                          return (
                            <div
                              style={{
                                ...stableClipboardTextStyle,
                                fontSize: '12px',
                                fontWeight: '400',
                                color: theme.text,
                                lineHeight: '1.5',
                                marginBottom: '0px',
                                whiteSpace: 'pre-wrap',
                                overflow: 'visible',
                              }}
                            >
                              {combinedText}
                            </div>
                          );
                        }

                        if (showSmartTruncation) {
                          // Smart truncation: show first words ... [expand] ... last words inline.
                          return (
                            <div style={{ marginBottom: '0px' }}>
                              <div
                                style={{
                                  ...stableClipboardTextStyle,
                                  fontSize: '12px',
                                  fontWeight: '400',
                                  color: theme.text,
                                  lineHeight: '1.5',
                                  display: 'inline',
                                }}
                              >
                                {truncated.firstPart}...{' '}
                                <button
                                  tabIndex={-1}
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleStackExpanded(stack.stackId);
                                  }}
                                  style={{
                                    background: 'transparent',
                                    border: 'none',
                                    padding: '0 4px',
                                    fontSize: '10px',
                                    fontWeight: 500,
                                    color: theme.textSecondary,
                                    cursor: 'pointer',
                                    display: 'inline',
                                    textDecoration: 'underline',
                                  }}
                                >
                                  ...expand...
                                </button>
                                {' '}{truncated.lastPart}
                              </div>
                            </div>
                          );
                        }
                        
                        // Short text that doesn't need truncation: show full text.
                        return (
                          <div
                            ref={checkTextOverflow(stack.stackId)}
                            style={{
                              ...stableClipboardTextStyle,
                              fontSize: '12px',
                              fontWeight: '400',
                              color: theme.text,
                              lineHeight: '1.5',
                              marginBottom: '4px',
                              display: '-webkit-box',
                              WebkitLineClamp: 3,
                              WebkitBoxOrient: 'vertical' as const,
                              overflow: 'hidden',
                            }}
                          >
                            {combinedText}
                          </div>
                        );
                      })()}

                      {/* Show less button - only when expanded */}
                      {combinedText && expanded && (
                        <button
                          tabIndex={-1}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleStackExpanded(stack.stackId);
                          }}
                          style={{
                            background: 'none',
                            border: 'none',
                            padding: 0,
                            marginTop: '2px',
                            fontSize: '10px',
                            color: theme.textSecondary,
                            cursor: 'pointer',
                          }}
                        >
                          Show less
                        </button>
                      )}
                      </div>
                    </div>

                    {/* Footer row - metadata left, buttons right (buttons always reserve space) */}
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginTop: '2px',
                      // B8: indent to align with content after icon grid (36px grid + 16px gap)
                      marginLeft: '52px',
                    }}>
                      {/* Metadata - left side */}
                      <div style={{ fontSize: '10px', color: theme.textSecondary, display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span>
                          {stack.itemCount} items stacked {formatTimeAgo(stack.createdAt)}
                        </span>
                        {/* Improved/Original toggle for stacks with improved content */}
                        {hasImprovedContent && (
                          <div style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            backgroundColor: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
                            borderRadius: '4px',
                            padding: '2px',
                          }}>
                            <button
                              tabIndex={-1}
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={(e) => {
                                e.stopPropagation();
                                // Toggle to original (add to viewOriginalIds)
                                if (!viewOriginalIds.has(stack.stackId)) {
                                  setViewOriginalIds(prev => new Set([...prev, stack.stackId]));
                                }
                              }}
                              style={{
                                background: viewOriginalIds.has(stack.stackId) ? theme.accent : 'transparent',
                                border: 'none',
                                padding: '2px 6px',
                                fontSize: '9px',
                                fontWeight: 500,
                                color: viewOriginalIds.has(stack.stackId) ? '#fff' : theme.textSecondary,
                                cursor: 'pointer',
                                borderRadius: '3px',
                                transition: 'all 0.15s ease',
                              }}
                            >
                              Original
                            </button>
                            <button
                              tabIndex={-1}
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={(e) => {
                                e.stopPropagation();
                                // Toggle to improved (remove from viewOriginalIds)
                                if (viewOriginalIds.has(stack.stackId)) {
                                  setViewOriginalIds(prev => {
                                    const next = new Set(prev);
                                    next.delete(stack.stackId);
                                    return next;
                                  });
                                }
                              }}
                              style={{
                                background: !viewOriginalIds.has(stack.stackId) ? theme.accent : 'transparent',
                                border: 'none',
                                padding: '2px 6px',
                                fontSize: '9px',
                                fontWeight: 500,
                                color: !viewOriginalIds.has(stack.stackId) ? '#fff' : theme.textSecondary,
                                cursor: 'pointer',
                                borderRadius: '3px',
                                transition: 'all 0.15s ease',
                              }}
                            >
                              Improved
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Right side: buttons + optional time for B3 variant */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {/* Buttons - show on J/K focus or mouse hover */}
                        <div style={{
                          display: 'flex',
                          gap: '2px',
                          flexWrap: 'nowrap',
                          visibility: selectedIndex === index || hoveredRowIndex === index ? 'visible' : 'hidden',
                        }}>
                        {/* Unstack button - leftmost, only for multi-item stacks */}
                        {stackItems.length > 1 && (
                          <button
                            tabIndex={-1}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={async (e) => {
                              e.stopPropagation();
                              const itemIds = stackItems.map(i => i.id);
                              const firstItemId = stackItems[0]?.id;
                              await window.clipboardAPI?.updateStackId?.(itemIds, null);
                              if (firstItemId) {
                                setPendingItemSelection(firstItemId);
                              }
                              loadItems(true);
                            }}
                            style={{
                              padding: '4px 6px',
                              fontSize: '10px',
                              fontWeight: 500,
                              backgroundColor: 'transparent',
                              color: theme.textSecondary,
                              border: 'none',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              transition: 'background-color 0.15s ease',
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = theme.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)'}
                            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                          >
                            unstack <KeyCap>u</KeyCap>
                          </button>
                        )}
                        {/* Share to Team button - hidden when sharing feature is disabled */}
                        {canShare && (
                          <button
                            tabIndex={-1}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={(e) => {
                              e.stopPropagation();
                              const itemIds = stackItems.map(i => i.id);
                              shareStackToTeam(itemIds);
                            }}
                            style={{
                              padding: '4px 6px',
                              fontSize: '10px',
                              fontWeight: 500,
                              backgroundColor: sharedToTeamId === `stack-${stackItems.map(i => i.id).join(',')}`
                                ? (theme.isDark ? 'rgba(16, 185, 129, 0.2)' : 'rgba(16, 185, 129, 0.15)')
                                : 'transparent',
                              color: sharedToTeamId === `stack-${stackItems.map(i => i.id).join(',')}`
                                ? theme.success : theme.textSecondary,
                              border: 'none',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              transition: 'background-color 0.3s ease, color 0.3s ease',
                            }}
                            onMouseEnter={(e) => {
                              if (sharedToTeamId !== `stack-${stackItems.map(i => i.id).join(',')}`) {
                                e.currentTarget.style.backgroundColor = theme.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)';
                              }
                            }}
                            onMouseLeave={(e) => {
                              if (sharedToTeamId !== `stack-${stackItems.map(i => i.id).join(',')}`) {
                                e.currentTarget.style.backgroundColor = 'transparent';
                              }
                            }}
                          >
                            {sharedToTeamId === `stack-${stackItems.map(i => i.id).join(',')}` ? (
                              <>✓ shared</>
                            ) : (
                              <>share <KeyCap>t</KeyCap></>
                            )}
                          </button>
                        )}
                        {/* DM button - hidden by feature flag */}
                        {FEATURE_MESSAGE_SHORTCUT_ENABLED && (
                          <button
                            tabIndex={-1}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedIndex(index);
                              setDmRecipientQuery('');
                              setSelectedDmContactIndex(0);
                              setShowDMModal(true);
                            }}
                            style={{
                              padding: '4px 6px',
                              fontSize: '10px',
                              fontWeight: 500,
                              backgroundColor: 'transparent',
                              color: theme.textSecondary,
                              border: 'none',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              transition: 'background-color 0.15s ease',
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = theme.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)'}
                            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                          >
                            message <KeyCap>m</KeyCap>
                          </button>
                        )}
                        {/* Delete button - display removed, functionality preserved via keyboard shortcut */}
                        {/* Preview button for stacks */}
                        <button
                          tabIndex={-1}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={(e) => {
                            e.stopPropagation();
                            const previewData = getPreviewForRow(row);
                            if (previewData) {
                              setPreview(previewData);
                            }
                          }}
                          style={{
                            padding: '4px 6px',
                            fontSize: '10px',
                            fontWeight: 500,
                            backgroundColor: 'transparent',
                            color: theme.textSecondary,
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            transition: 'background-color 0.15s ease',
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = theme.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)'}
                          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                        >
                          preview <KeyCap>␣</KeyCap>
                        </button>
                        <button
                          tabIndex={-1}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleCreateMarkdownFromItems(stackItems, {
                              stackId: stack.stackId,
                              contentVersion: showImproved ? 'improved' : 'original',
                            });
                          }}
                          title="create markdown in library (m)"
                          style={{
                            padding: '4px 6px',
                            fontSize: '10px',
                            fontWeight: 500,
                            backgroundColor: 'transparent',
                            color: theme.textSecondary,
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            transition: 'background-color 0.15s ease',
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = theme.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)'}
                          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                        >
                          markdown <KeyCap>m</KeyCap>
                        </button>
                        {/* Paste hint button - rightmost */}
                        <button
                          tabIndex={-1}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={(e) => {
                            e.stopPropagation();
                            // Normal click: paste to previousApp.
                            // Option+click: paste to targetApp.
                            const hasAlt = e.altKey;
                            // Fallback to previousApp if targetApp is not set.
                            const pasteBundleId = hasAlt
                              ? (targetAppInfo.targetApp?.bundleId ?? targetAppInfo.previousApp?.bundleId)
                              : targetAppInfo.previousApp?.bundleId;
                            
                            // Paste stack content
                            const itemIds = stackItems.map(i => i.id);
                            window.clipboardAPI?.pasteStack(itemIds, pasteBundleId);
                          }}
                          style={{
                            padding: '4px 6px',
                            fontSize: '10px',
                            fontWeight: 500,
                            backgroundColor: 'transparent',
                            color: theme.textSecondary,
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            transition: 'background-color 0.15s ease',
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = theme.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)'}
                          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                        >
                          paste ({displayAppName}) <KeyCap>↵</KeyCap>
                        </button>
                        </div>
                      </div>
                    </div>
                  </DraggableDroppableRow>

                  {/* New items separator - show below last seen item if there are newer items above */}
                  {lastSeenItemId === stack.stackId && index > 0 && (
                    <div
                      onMouseEnter={() => setSeparatorHovered(true)}
                      onMouseLeave={() => setSeparatorHovered(false)}
                      onClick={() => stackItemsAboveSeparator(index)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        margin: '8px 16px',
                        cursor: 'pointer',
                        transition: 'opacity 0.15s ease',
                      }}
                    >
                      <div style={{ flex: 1, height: '1px', backgroundColor: separatorHovered ? theme.accent : theme.border, opacity: separatorHovered ? 0.8 : 0.4, transition: 'all 0.15s ease' }} />
                      <span style={{
                        fontSize: '9px',
                        color: separatorHovered ? theme.accent : theme.textSecondary,
                        opacity: separatorHovered ? 1 : 0.6,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        transition: 'all 0.15s ease',
                      }}>
                        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="18 15 12 9 6 15" />
                        </svg>
                        {separatorHovered ? 'stack all context above?' : 'context collected since last paste'}
                      </span>
                      <div style={{ flex: 1, height: '1px', backgroundColor: separatorHovered ? theme.accent : theme.border, opacity: separatorHovered ? 0.8 : 0.4, transition: 'all 0.15s ease' }} />
                    </div>
                  )}
                </div>
              );
            } else {
              // Render individual item (same as before)
              const { item } = row;
              const isSelected = selectedIndex === index;
              const isInStack = selectedIds.has(item.id);

              const hasText = (item.type === 'text' || item.type === 'transcript') && item.content;
              const isRowSelected = selectedIndex === index;
              const itemExpanded = expandedItems.has(item.id);
              // "Show more" is controlled by actual overflow detection, not character count.
              const itemTextId = `item-${item.id}`;
              const itemTextIsOverflowing = overflowingTexts.has(itemTextId);

              const itemDragId = `item:${item.id}`;
              const isItemDragging = activeDragId === itemDragId;
              const isItemOver = overDropId === itemDragId;
              
              return (
                <div key={item.id}>
                  <DraggableDroppableRow
                    id={itemDragId}
                    isDragging={isItemDragging}
                    isOver={isItemOver && !isItemDragging}
                    onMouseEnter={(e) => {
                      // Always track hover for button visibility
                      setHoveredRowIndex(index);
                      // Skip selection update if keyboard nav is active
                      if (keyboardNavActive) return;
                      // Skip if already selected (prevents render cascade)
                      if (selectedIndex === index) return;
                      // Only highlight if the item is fully visible (prevents jumping)
                      const element = e.currentTarget;
                      const container = listRef.current;
                      if (container && isElementFullyVisible(element, container)) {
                        setSelectedIndex(index);
                      }
                    }}
                    onMouseLeave={() => setHoveredRowIndex(null)}
                    onClick={(e) => handleItemClick(item, index, e)}
                    style={{
                      padding: '10px 16px 6px 16px',
                      backgroundColor: isInStack
                        ? theme.selectedBg
                        : isRowSelected
                          ? theme.hoverBg
                          : hoveredRowIndex === index
                            ? theme.hoverBg
                            : theme.listItemBg,
                      // J/K highlight gets darker gray borders for definition
                      borderTop: isRowSelected ? `1px solid ${theme.isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)'}` : '1px solid transparent',
                      borderBottom: isRowSelected ? `1px solid ${theme.isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)'}` : `1px solid ${theme.border}`,
                      borderRight: isRowSelected ? `1px solid ${theme.isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)'}` : '1px solid transparent',
                      // Left indicator is now an inner element to avoid corner radius bending.
                      borderLeft: '2px solid transparent',
                      boxShadow: isRowSelected
                        ? theme.isDark 
                          ? '0 2px 8px rgba(0,0,0,0.3)' 
                          : '0 2px 8px rgba(0,0,0,0.08)'
                        : 'none',
                      transition: 'background-color 0.1s ease, border-left 0.1s ease, box-shadow 0.1s ease',
                      cursor: activeDragId ? 'grabbing' : 'grab',
                      display: 'flex',
                      flexDirection: 'column',
                      userSelect: 'none',
                      position: 'relative',
                    }}
                  >
                  {/* Left selection indicator - inset to avoid corner radius bending */}
                  {(isRowSelected || isInStack) && (
                    <div style={{
                      position: 'absolute',
                      left: 0,
                      top: 4,
                      bottom: 4,
                      width: isRowSelected ? (isInStack ? '4px' : '2px') : '2px',
                      backgroundColor: isRowSelected 
                        ? (theme.isDark ? '#2dd4bf' : '#14b8a6')
                        : theme.selectedBorder,
                      borderRadius: '1px',
                      transition: 'width 0.1s ease, background-color 0.1s ease',
                    }} />
                  )}
                  {/* Copy icon - top right */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      copyItem(item.id, `item-${item.id}`, item.useImprovedVersion);
                    }}
                    style={{
                      position: 'absolute',
                      top: 6,
                      right: 6,
                      padding: '2px 4px',
                      backgroundColor: 'transparent',
                      border: 'none',
                      borderRadius: 4,
                      cursor: 'pointer',
                      opacity: copiedItemId === `item-${item.id}` ? 1 : (isRowSelected || hoveredRowIndex === index ? 0.5 : 0),
                      transition: 'opacity 0.15s ease',
                      fontSize: copiedItemId === `item-${item.id}` ? 8 : 11,
                      color: copiedItemId === `item-${item.id}` ? theme.text : theme.textSecondary,
                      display: 'flex',
                      alignItems: 'center',
                    }}
                    onMouseEnter={(e) => { if (copiedItemId !== `item-${item.id}`) e.currentTarget.style.opacity = '1'; }}
                    onMouseLeave={(e) => { if (copiedItemId !== `item-${item.id}`) e.currentTarget.style.opacity = isRowSelected || hoveredRowIndex === index ? '0.5' : '0'; }}
                  >
                    {copiedItemId === `item-${item.id}` ? 'copied' : '⧉'}
                  </button>
                  {/* Content section - structure varies by layout variant */}
                  <div style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '10px',
                  }}>
                    {/* Content type icons in 2x2 quad grid on left - all 4 always visible, dimmed when inactive */}
                    {/* Order: transcript (top-left), image (top-right), path/URL (bottom-left), text (bottom-right) */}
                    {(() => {
                      const isTranscript = item.type === 'transcript';
                      const isImage = item.type === 'image' || item.type === 'screenshot';
                      const isPathOrUrl = (item.type === 'text') && item.content && (
                        item.content.startsWith('/') || item.content.startsWith('~') || item.content.startsWith('file://') ||
                        item.content.startsWith('http://') || item.content.startsWith('https://')
                      );
                      const isPlainText = (item.type === 'text') && item.content && !(
                        item.content.startsWith('/') || item.content.startsWith('~') || item.content.startsWith('file://') ||
                        item.content.startsWith('http://') || item.content.startsWith('https://')
                      );
                      // Colors for each content type (gray when disabled)
                      const disabledColor = theme.isDark ? '#4b5563' : '#d1d5db'; // gray
                      const transcriptColor = isTranscript ? '#8b5cf6' : disabledColor; // violet
                      const imageColor = isImage ? '#10b981' : disabledColor; // emerald
                      const pathUrlColor = isPathOrUrl ? '#3b82f6' : disabledColor; // blue for paths/URLs
                      const textColor = isPlainText ? '#f59e0b' : disabledColor; // amber for plain text
                      return (
                        <div style={{
                          width: '30px',
                          height: '30px',
                          flexShrink: 0,
                          display: 'grid',
                          gridTemplateColumns: '12px 12px',
                          gridTemplateRows: '12px 12px',
                          gap: '6px',
                          alignContent: 'center',
                          justifyContent: 'center',
                        }}>
                          {/* Transcript - violet (top-left) */}
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={transcriptColor} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
                            <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                            <line x1="12" x2="12" y1="19" y2="22"/>
                          </svg>
                          {/* Image - emerald (top-right) */}
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={imageColor} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>
                            <circle cx="9" cy="9" r="2"/>
                            <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>
                          </svg>
                          {/* Path/URL - blue (bottom-left) - folder with link */}
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={pathUrlColor} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>
                            <path d="M10 14a2 2 0 0 0 3 .2l1-1a2 2 0 0 0-2.8-2.8l-.6.6"/>
                            <path d="M14 12a2 2 0 0 0-3-.2l-1 1a2 2 0 0 0 2.8 2.8l.6-.6"/>
                          </svg>
                          {/* Plain text - amber (bottom-right) - T icon */}
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={textColor} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="4 7 4 4 20 4 20 7"/>
                            <line x1="12" x2="12" y1="4" y2="20"/>
                            <line x1="8" x2="16" y1="20" y2="20"/>
                          </svg>
                        </div>
                      );
                    })()}

                    {/* Main content area */}
                    <div style={{ flex: 1 }}>
                    {item.type === 'text' || item.type === 'transcript' ? (
                      <>
                        {(() => {
                          // Determine which content to show based on toggle state.
                          const shouldShowImproved = item.improvedContent && item.useImprovedVersion;
                          const displayText = (shouldShowImproved && item.improvedContent) || item.content || 'Empty';
                          const truncated = smartTruncateText(displayText, 8, containerWidth);
                          const showSmartTruncation = !itemExpanded && truncated.needsTruncation;
                          const colorValue = detectColor(item.content);
                          // Detect if content is a path or URL for type indicators
                          const isPath = displayText.startsWith('/') || displayText.startsWith('~');
                          const isUrl = displayText.startsWith('http');
                          
                          if (itemExpanded) {
                            // Expanded state: show full text with color preview.
                            return (
                              <div
                                style={{
                                  ...stableClipboardTextStyle,
                                  fontSize: '12px',
                                  fontWeight: '400',
                                  marginBottom: '0px',
                                  display: 'flex',
                                  alignItems: 'flex-start',
                                  gap: '8px',
                                }}
                              >
                                {colorValue && (
                                  <div
                                    style={{
                                      width: '20px',
                                      height: '20px',
                                      borderRadius: '4px',
                                      backgroundColor: colorValue,
                                      border: `1px solid ${theme.border}`,
                                      flexShrink: 0,
                                      marginTop: '1px',
                                    }}
                                    title={colorValue}
                                  />
                                )}
                                <span style={{
                                  ...stableClipboardTextStyle,
                                  flex: 1,
                                  wordBreak: 'break-word',
                                  whiteSpace: 'pre-wrap',
                                  fontSize: '12px',
                                }}>
                                  {displayText}
                                </span>
                              </div>
                            );
                          }
                          
                          if (showSmartTruncation) {
                            // Smart truncation: show first words ... [expand] ... last words inline.
                            return (
                              <div style={{ marginBottom: '0px', display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                                {/* Color swatch if present */}
                                {colorValue && (
                                  <div
                                    style={{
                                      width: '20px',
                                      height: '20px',
                                      borderRadius: '4px',
                                      backgroundColor: colorValue,
                                      border: `1px solid ${theme.border}`,
                                      flexShrink: 0,
                                      marginTop: '1px',
                                    }}
                                    title={colorValue}
                                  />
                                )}
                                <div
                                  style={{
                                    ...stableClipboardTextStyle,
                                    fontSize: '12px',
                                    fontWeight: '400',
                                    color: theme.text,
                                    lineHeight: '1.5',
                                    flex: 1,
                                    display: 'inline',
                                  }}
                                >
                                  {truncated.firstPart}...{' '}
                                  <button
                                    tabIndex={-1}
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      toggleItemExpanded(item.id);
                                    }}
                                    style={{
                                      background: 'transparent',
                                      border: 'none',
                                      padding: '0 4px',
                                      fontSize: '10px',
                                      fontWeight: 500,
                                      color: theme.textSecondary,
                                      cursor: 'pointer',
                                      display: 'inline',
                                      textDecoration: 'underline',
                                    }}
                                  >
                                    ...expand...
                                  </button>
                                  {' '}{truncated.lastPart}
                                </div>
                              </div>
                            );
                          }
                          
                          // Short text that doesn't need truncation: show full text with line clamp.
                          return (
                            <div
                              style={{
                                ...stableClipboardTextStyle,
                                fontSize: '12px',
                                fontWeight: '400',
                                marginBottom: '0',
                                display: 'flex',
                                alignItems: 'flex-start',
                                gap: '8px',
                              }}
                            >
                              {colorValue && (
                                <div
                                  style={{
                                    width: '20px',
                                    height: '20px',
                                    borderRadius: '4px',
                                    backgroundColor: colorValue,
                                    border: `1px solid ${theme.border}`,
                                    flexShrink: 0,
                                    marginTop: '1px',
                                  }}
                                  title={detectColor(item.content) || ''}
                                />
                              )}
                              <span
                                ref={itemExpanded ? undefined : checkTextOverflow(itemTextId)}
                                style={{
                                  ...stableClipboardTextStyle,
                                  flex: 1,
                                  wordBreak: 'break-word',
                                  ...(itemExpanded ? {
                                    whiteSpace: 'pre-wrap',
                                  } : {
                                    // 3-line clamp for collapsed state
                                    display: '-webkit-box',
                                    WebkitLineClamp: 3,
                                    WebkitBoxOrient: 'vertical' as const,
                                    overflow: 'hidden',
                                  }),
                                }}
                              >
                                {/* Show improved or original content based on useImprovedVersion toggle. */}
                                {(() => {
                                  const shouldShowImproved = item.improvedContent && item.useImprovedVersion;
                                  return shouldShowImproved ? item.improvedContent : (item.content || 'Empty');
                                })()}
                              </span>
                            </div>
                          );
                        })()}
                        
                        {/* Controls row: Improved/Original toggle OR Show more/less (not both) */}
                        {item.improvedContent ? (
                          <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'flex-end',
                            marginTop: '2px',
                            marginBottom: '0px',
                          }}>
                            <div style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              backgroundColor: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
                              borderRadius: '4px',
                              padding: '2px',
                            }}>
                              <button
                                tabIndex={-1}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  if (item.useImprovedVersion) {
                                    await window.clipboardAPI?.setUseImprovedVersion?.(item.id, false);
                                    setItems(prev => prev.map(i =>
                                      i.id === item.id ? { ...i, useImprovedVersion: false } : i
                                    ));
                                  }
                                }}
                                style={{
                                  background: !item.useImprovedVersion ? theme.accent : 'transparent',
                                  border: 'none',
                                  padding: '3px 8px',
                                  fontSize: '9px',
                                  fontWeight: 500,
                                  color: !item.useImprovedVersion ? '#fff' : theme.textSecondary,
                                  cursor: 'pointer',
                                  borderRadius: '3px',
                                  transition: 'all 0.15s ease',
                                }}
                              >
                                Original
                              </button>
                              <button
                                tabIndex={-1}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  if (!item.useImprovedVersion) {
                                    await window.clipboardAPI?.setUseImprovedVersion?.(item.id, true);
                                    setItems(prev => prev.map(i =>
                                      i.id === item.id ? { ...i, useImprovedVersion: true } : i
                                    ));
                                  }
                                }}
                                style={{
                                  background: item.useImprovedVersion ? theme.accent : 'transparent',
                                  border: 'none',
                                  padding: '3px 8px',
                                  fontSize: '9px',
                                  fontWeight: 500,
                                  color: item.useImprovedVersion ? '#fff' : theme.textSecondary,
                                  cursor: 'pointer',
                                  borderRadius: '3px',
                                  transition: 'all 0.15s ease',
                                }}
                              >
                                Improved
                              </button>
                            </div>
                          </div>
                        ) : (itemTextIsOverflowing || itemExpanded) && (
                          <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'flex-end',
                            marginTop: '4px',
                            marginBottom: '4px',
                          }}>
                            <button
                              tabIndex={-1}
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleItemExpanded(item.id);
                              }}
                              style={{
                                background: 'none',
                                border: 'none',
                                padding: 0,
                                fontSize: '10px',
                                color: theme.textSecondary,
                                cursor: 'pointer',
                              }}
                            >
                              {itemExpanded ? 'Show less' : 'Show more'}
                            </button>
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        {/* Screenshot thumbnail with preview */}
                        <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                          {(item.thumbnailData || item.imageData) && (
                            <div
                              style={{ position: 'relative', flexShrink: 0 }}
                              onMouseEnter={() => setHoveredImageId(item.id)}
                              onMouseLeave={() => setHoveredImageId(null)}
                              onClick={async (e) => {
                                e.stopPropagation();
                                // If we have full imageData, show preview directly.
                                // Otherwise fetch it on demand.
                                if (item.imageData) {
                                  setPreview({
                                    type: 'image',
                                    data: item.imageData,
                                    width: item.imageWidth || 0,
                                    height: item.imageHeight || 0,
                                    itemId: item.id,
                                    stackId: item.stackId,
                                    figureLabel: item.figureLabel ?? undefined,
                                  });
                                } else {
                                  // Fetch full image on demand.
                                  const fullItem = await window.clipboardAPI?.getItem?.(item.id);
                                  if (fullItem?.imageData) {
                                    setPreview({
                                      type: 'image',
                                      data: fullItem.imageData,
                                      width: fullItem.imageWidth || 0,
                                      height: fullItem.imageHeight || 0,
                                      itemId: fullItem.id,
                                      stackId: fullItem.stackId,
                                      figureLabel: fullItem.figureLabel ?? undefined,
                                    });
                                  }
                                }
                              }}
                            >
                              <img
                                src={`data:image/png;base64,${item.thumbnailData || item.imageData}`}
                                alt="Screenshot preview"
                                style={{
                                  height: '50px',
                                  width: 'auto',
                                  borderRadius: '4px',
                                  border: `1px solid ${theme.border}`,
                                  cursor: 'pointer',
                                }}
                              />
                              {/* Figure label badge */}
                              {item.figureLabel && (
                                <div style={{
                                  position: 'absolute',
                                  bottom: '2px',
                                  left: '2px',
                                  backgroundColor: 'rgba(0, 0, 0, 0.7)',
                                  color: '#fff',
                                  fontSize: '9px',
                                  fontWeight: 600,
                                  padding: '1px 4px',
                                  borderRadius: '3px',
                                  letterSpacing: '0.5px',
                                }}>
                                  {item.figureLabel}
                                </div>
                              )}
                            </div>
                          )}
                          <div style={{ flex: 1 }}>
                            <div
                              style={{
                                fontSize: '12px',
                                fontWeight: '400',
                                color: theme.text,
                              }}
                            >
                              {item.sourceAppName ? `${item.sourceAppName} screenshot` : 'Screenshot'}
                            </div>
                          </div>
                        </div>
                      </>
                    )}
                    </div>
                  </div>

                  {/* Footer row - metadata left, buttons right */}
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginTop: '2px',
                    marginLeft: '52px',
                  }}>
                    {/* Metadata - left side */}
                    <div
                      style={{
                        fontSize: '10px',
                        color: theme.textSecondary,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                    >
                      {/* iOS source badge */}
                      {item.source === 'ios' && (
                        <span
                          style={{
                            fontSize: '9px',
                            backgroundColor: theme.accent,
                            color: '#fff',
                            padding: '1px 4px',
                            borderRadius: '3px',
                            fontWeight: 500,
                          }}
                        >
                          📱 iOS
                        </span>
                      )}
                      <span>
                        {item.type === 'text' || item.type === 'transcript' ? (
                          <>
                            {item.wordCount ? `${item.wordCount} words ` : ''}
                            {item.type === 'transcript' || (item.wordCount && item.wordCount >= 20) ? 'transcribed' : 'created'}{item.sourceAppName ? ` in ${item.sourceAppName}` : ''} {formatTimeAgo(item.createdAt)}
                          </>
                        ) : (
                          <>
                            {item.sourceAppName ? `${item.sourceAppName} screenshot` : 'Screenshot'}{item.imageWidth && item.imageHeight ? ` (${item.imageWidth}×${item.imageHeight})` : ''} taken {formatTimeAgo(item.createdAt)}
                          </>
                        )}
                      </span>
                    </div>

                    {/* Right side: buttons + optional time for B3 variant */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {/* Buttons - show on J/K focus or mouse hover */}
                      <div style={{
                        display: 'flex',
                        gap: '2px',
                        flexWrap: 'nowrap',
                        visibility: isRowSelected || hoveredRowIndex === index ? 'visible' : 'hidden',
                      }}>
                      {/* Edit Sketch button - only for sketch items */}
                      {item.sourceApp === 'com.fieldtheory.sketch' && (
                        <button
                          tabIndex={-1}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={(e) => {
                            e.stopPropagation();
                            openSketchForEditing(item);
                          }}
                          style={{
                            padding: '4px 6px',
                            fontSize: '10px',
                            fontWeight: 500,
                            backgroundColor: 'transparent',
                            color: theme.textSecondary,
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            transition: 'background-color 0.15s ease',
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = theme.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)'}
                          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                        >
                          edit <KeyCap>e</KeyCap>
                        </button>
                      )}
                      {/* Share to Team button - hidden when sharing feature is disabled */}
                      {canShare && (
                        <button
                          tabIndex={-1}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={(e) => {
                            e.stopPropagation();
                            shareToTeam(item.id);
                          }}
                          disabled={sharingToTeam === item.id}
                          style={{
                            padding: '3px 4px',
                            fontSize: '9px',
                            whiteSpace: 'nowrap',
                            fontWeight: 500,
                            backgroundColor: sharedToTeamId === `item-${item.id}` 
                              ? (theme.isDark ? 'rgba(16, 185, 129, 0.2)' : 'rgba(16, 185, 129, 0.15)')
                              : 'transparent',
                            color: sharedToTeamId === `item-${item.id}` ? theme.success : theme.textSecondary,
                            border: 'none',
                            borderRadius: '4px',
                            cursor: sharingToTeam === item.id ? 'wait' : 'pointer',
                            transition: 'background-color 0.3s ease, color 0.3s ease',
                          }}
                          onMouseEnter={(e) => {
                            if (sharedToTeamId !== `item-${item.id}`) {
                              e.currentTarget.style.backgroundColor = theme.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)';
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (sharedToTeamId !== `item-${item.id}`) {
                              e.currentTarget.style.backgroundColor = 'transparent';
                            }
                          }}
                        >
                          {sharedToTeamId === `item-${item.id}` ? (
                            <>✓ shared</>
                          ) : (
                            <>{sharingToTeam === item.id ? 'sharing...' : 'share'} <KeyCap>t</KeyCap></>
                          )}
                        </button>
                      )}
                      {/* DM button - hidden by feature flag */}
                      {FEATURE_MESSAGE_SHORTCUT_ENABLED && (
                        <button
                          tabIndex={-1}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedIndex(index);
                            setDmRecipientQuery('');
                            setSelectedDmContactIndex(0);
                            setShowDMModal(true);
                          }}
                          style={{
                            padding: '3px 4px',
                            fontSize: '9px',
                            whiteSpace: 'nowrap',
                            fontWeight: 500,
                            backgroundColor: 'transparent',
                            color: theme.textSecondary,
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            transition: 'background-color 0.15s ease',
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = theme.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)'}
                          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                        >
                          message <KeyCap>m</KeyCap>
                        </button>
                      )}
                      {/* Delete button - display removed, functionality preserved via keyboard shortcut */}
                      {/* Preview button - only for images */}
                      {(item.imageData || item.thumbnailData) && (
                        <button
                          tabIndex={-1}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (item.imageData) {
                              setPreview({
                                type: 'image',
                                data: item.imageData,
                                width: item.imageWidth || 0,
                                height: item.imageHeight || 0,
                                itemId: item.id,
                                stackId: item.stackId,
                                figureLabel: item.figureLabel ?? undefined,
                              });
                            } else {
                              // Fetch full image on demand
                              const fullItem = await window.clipboardAPI?.getItem?.(item.id);
                              if (fullItem?.imageData) {
                                setPreview({
                                  type: 'image',
                                  data: fullItem.imageData,
                                  width: fullItem.imageWidth || 0,
                                  height: fullItem.imageHeight || 0,
                                  itemId: fullItem.id,
                                  stackId: fullItem.stackId,
                                  figureLabel: fullItem.figureLabel ?? undefined,
                                });
                              }
                            }
                          }}
                          style={{
                            padding: '4px 6px',
                            fontSize: '10px',
                            fontWeight: 500,
                            backgroundColor: 'transparent',
                            color: theme.textSecondary,
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            transition: 'background-color 0.15s ease',
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = theme.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)'}
                          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                        >
                          preview <KeyCap>␣</KeyCap>
                        </button>
                      )}
                      {/* Annotate button - only for images */}
                      {(item.imageData || item.thumbnailData) && (
                        <button
                          tabIndex={-1}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={async (e) => {
                            e.stopPropagation();
                            let imageDataToUse = item.imageData;
                            let widthToUse = item.imageWidth || 800;
                            let heightToUse = item.imageHeight || 600;
                            
                            // Fetch full image on demand if we only have thumbnail
                            if (!imageDataToUse) {
                              const fullItem = await window.clipboardAPI?.getItem?.(item.id);
                              if (fullItem?.imageData) {
                                imageDataToUse = fullItem.imageData;
                                widthToUse = fullItem.imageWidth || 800;
                                heightToUse = fullItem.imageHeight || 600;
                              }
                            }
                            
                            if (imageDataToUse) {
                              setEditingSketchItem(null);
                              setSketchBackgroundImage({
                                dataUrl: `data:image/png;base64,${imageDataToUse}`,
                                width: widthToUse,
                                height: heightToUse,
                              });
                              setViewMode('sketch');
                            }
                          }}
                          style={{
                            padding: '4px 6px',
                            fontSize: '10px',
                            fontWeight: 500,
                            backgroundColor: 'transparent',
                            color: theme.textSecondary,
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            transition: 'background-color 0.15s ease',
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = theme.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)'}
                          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                        >
                          draw <KeyCap>d</KeyCap>
                        </button>
                      )}
                      <button
                        tabIndex={-1}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleCreateMarkdownFromItems([item]);
                        }}
                        title="create markdown in library (m)"
                        style={{
                          padding: '3px 4px',
                          fontSize: '9px',
                          whiteSpace: 'nowrap',
                          fontWeight: 500,
                          backgroundColor: 'transparent',
                          color: theme.textSecondary,
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          transition: 'background-color 0.15s ease',
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = theme.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)'}
                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                      >
                        markdown <KeyCap>m</KeyCap>
                      </button>
                      {/* Paste hint button with target app - rightmost */}
                      <button
                        tabIndex={-1}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleItemClick(item, index, e as unknown as React.MouseEvent);
                        }}
                        style={{
                          padding: '3px 4px',
                          fontSize: '9px',
                          whiteSpace: 'nowrap',
                          fontWeight: 500,
                          backgroundColor: 'transparent',
                          color: theme.textSecondary,
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          transition: 'background-color 0.15s ease',
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = theme.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)'}
                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                      >
                        paste ({optionHeld ? (targetAppInfo.targetApp?.name || targetAppInfo.previousApp?.name || 'most recent app') : (targetAppInfo.previousApp?.name || 'most recent app')}) <KeyCap>↵</KeyCap>
                      </button>
                      </div>
                    </div>
                  </div>
                  </DraggableDroppableRow>
                  
                  {/* New items separator - show below last seen item if there are newer items above */}
                  {lastSeenItemId === item.id && index > 0 && (
                    <div
                      onMouseEnter={() => setSeparatorHovered(true)}
                      onMouseLeave={() => setSeparatorHovered(false)}
                      onClick={() => stackItemsAboveSeparator(index)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        margin: '8px 16px',
                        cursor: 'pointer',
                        transition: 'opacity 0.15s ease',
                      }}
                    >
                      <div style={{ flex: 1, height: '1px', backgroundColor: separatorHovered ? theme.accent : theme.border, opacity: separatorHovered ? 0.8 : 0.4, transition: 'all 0.15s ease' }} />
                      <span style={{
                        fontSize: '9px',
                        color: separatorHovered ? theme.accent : theme.textSecondary,
                        opacity: separatorHovered ? 1 : 0.6,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        transition: 'all 0.15s ease',
                      }}>
                        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="18 15 12 9 6 15" />
                        </svg>
                        {separatorHovered ? 'stack all context above?' : 'context collected since last paste'}
                      </span>
                      <div style={{ flex: 1, height: '1px', backgroundColor: separatorHovered ? theme.accent : theme.border, opacity: separatorHovered ? 0.8 : 0.4, transition: 'all 0.15s ease' }} />
                    </div>
                  )}
                </div>
              );
            }
          })
        )}
        
        {/* Load more - gated for free users */}
        {hasMore && listRows.length > 0 && (
          cachedTier === 'pro' ? (
            <button
              onClick={handleLoadMore}
              disabled={loading}
              style={{
                width: '100%',
                padding: '12px',
                border: 'none',
                borderTop: `1px solid ${theme.border}`,
                backgroundColor: theme.bgSecondary,
                color: theme.text,
                cursor: loading ? 'wait' : 'pointer',
                fontSize: '12px',
              }}
            >
              {loading ? 'Loading...' : 'Load More'}
            </button>
          ) : (
            <div
              style={{
                width: '100%',
                padding: '12px',
                border: 'none',
                borderTop: `1px solid ${theme.border}`,
                backgroundColor: theme.bgSecondary,
                color: theme.textSecondary,
                fontSize: '12px',
                textAlign: 'center',
              }}
            >
              Load More <span style={{ opacity: 0.7 }}>(Full history available with Pro plan)</span>
            </div>
          )
        )}
        </div>
        </div>

        {/* Drag overlay - shows ghost element centered on cursor */}
        <DragOverlay 
          dropAnimation={null}
          modifiers={[
            // Lock drag to vertical axis and center ghost on cursor Y
            ({ activatorEvent, draggingNodeRect, transform }) => {
              if (!activatorEvent || !draggingNodeRect) return transform;
              const offsetY = (activatorEvent as PointerEvent).offsetY ?? draggingNodeRect.height / 2;
              return {
                ...transform,
                x: 0,
                y: transform.y + offsetY - draggingNodeRect.height / 2,
              };
            },
          ]}
        >
          {activeDragId ? (() => {
            // Find the dragged item/stack to show a content preview.
            const [type, id] = activeDragId.split(':');
            const row = listRows.find(r => 
              type === 'stack' 
                ? r.type === 'stack' && r.stack.stackId === id
                : r.type === 'item' && r.item.id === parseInt(id, 10)
            );
            
            // Build preview text from the row content.
            let previewText = type === 'stack' ? 'Stack' : 'Item';
            if (row?.type === 'stack') {
              previewText = combineStackText(row.items).slice(0, 80) || 'Stack';
            } else if (row?.type === 'item') {
              previewText = row.item.content?.slice(0, 80) || 'Item';
            }
            
            return (
              <div
                style={{
                  width: '320px',
                  padding: '12px 16px',
                  backgroundColor: theme.bgSecondary,
                  border: `1px solid ${theme.border}`,
                  borderRadius: '6px',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                  fontSize: '12px',
                  color: theme.text,
                  opacity: 0.9,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {previewText}
              </div>
            );
          })() : null}
        </DragOverlay>
        </DndContext>
        
        </div>
      )}

      <MaxwellHistoryPopover
        open={maxwellHistoryOpen && !bookmarksCanvasChromeActive}
        onClose={() => setMaxwellHistoryOpen(false)}
        footerRef={footerRef}
      />

      {showFocusStatusOverlay && (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            bottom: '14px',
            transform: 'translateX(-50%)',
            zIndex: 24,
            maxWidth: 'min(620px, calc(100% - 48px))',
            padding: '4px 8px',
            borderRadius: '4px',
            backgroundColor: theme.isDark ? 'rgba(20, 23, 29, 0.76)' : 'rgba(255, 255, 255, 0.86)',
            border: `1px solid ${theme.border}`,
            color: focusStatusOverlayColor,
            fontSize: '10px',
            lineHeight: 1.35,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            pointerEvents: 'none',
            opacity: 0.9,
            transition: 'opacity 160ms ease',
            animation: localCommandStatus && localCommandStatus.status !== 'running'
              ? `localStatusFadeOut ${localCommandStatus.status === 'error' ? 9 : 3.5}s ease forwards`
              : undefined,
          }}
        >
          {footerStatusLabel}
        </div>
      )}

      {/* Footer - three-column layout: left=stats, center=recording, right=controls */}
      {/* Fades in focus mode; the theme toggle floats separately. */}
      <div
        ref={footerRef}
        style={{
          position: focusChromeOverlayActive ? 'absolute' : 'relative',
          left: focusChromeOverlayActive ? 0 : undefined,
          right: focusChromeOverlayActive ? 0 : undefined,
          bottom: focusChromeOverlayActive ? 0 : undefined,
          zIndex: focusChromeOverlayActive ? 20 : undefined,
          boxSizing: 'border-box',
          padding: '8px 16px',
          height: 'auto',
          overflow: 'hidden',
          borderTop: `1px solid ${theme.border}`,
          backgroundColor: theme.bgSecondary,
          backdropFilter: theme.isDark && theme.glassEnabled ? 'blur(10px)' : 'none',
          display: bookmarksCanvasChromeActive ? 'none' : 'flex',
          opacity: footerChromeOpacity,
          pointerEvents: footerChromeInteractive ? 'auto' : 'none',
          transition: 'opacity 90ms linear',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '11px',
          color: theme.textSecondary,
          userSelect: 'none',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        }}
      >
        {/* Left side: sidebar toggle + plan and stats */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '9px',
            color: theme.textSecondary,
            userSelect: 'none',
            flex: 1,
            minWidth: 0,
          }}
        >
          {/* Sidebar collapse toggle — actionable in Library (non-immersive)
              and Commands views. In other views it stays visible but disabled
              so the footer layout doesn't jump. */}
          {(() => {
            const collapseEnabled = navSidebarToggleEnabled;
            const collapseTitle = collapseEnabled
              ? `${navSidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'} (⌘.)`
              : 'Sidebar toggle';
            return (
              <button
                onClick={toggleNavSidebarCollapsed}
                disabled={!collapseEnabled}
                title={collapseTitle}
                aria-label="Toggle sidebar"
                style={{
                  width: '20px',
                  height: '20px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 0,
                  background: 'transparent',
                  color: theme.textSecondary,
                  border: `1px solid ${theme.border}`,
                  borderRadius: '4px',
                  cursor: collapseEnabled ? 'pointer' : 'default',
                  opacity: collapseEnabled ? 1 : 0.5,
                  transition: 'background 0.15s ease, opacity 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  if (!collapseEnabled) return;
                  e.currentTarget.style.backgroundColor = theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)';
                }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
              >
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{
                    transform: collapseEnabled && navSidebarCollapsed ? 'rotate(180deg)' : 'none',
                    transition: 'transform 0.15s ease',
                  }}
                >
                  <path d="M10 4L6 8l4 4" />
                </svg>
              </button>
            );
          })()}
          {renderMaxwellHistoryButton()}
          {/* Plan info - always show for logged in users */}
          {localCommandStatus ? (
                <>
                  <span style={{ fontWeight: 500 }}>Local model:</span>
                  <span
                    style={{
                      color: localCommandStatus.status === 'error' ? theme.error : theme.textSecondary,
                      opacity: 0.85,
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {footerStatusLabel}
                  </span>
                  {localCommandStatus.status === 'running' && localCommandStatus.runId ? renderMaxwellCancelButton() : null}
                </>
              ) : authSession && cachedTier === 'pro' ? (
                // Pro Plan: show cycling stats on click
                <>
                  <span style={{ fontWeight: 500 }}>Pro:</span>
                  <span
                    style={{
                      opacity: statFading ? 0 : 1,
                      transition: 'opacity 0.15s ease',
                      cursor: 'pointer',
                    }}
                    onClick={nextStat}
                  >
                    {formatNumber(statItems[currentStatIndex]?.value ?? 0)} {statItems[currentStatIndex]?.value === 1
                      ? statItems[currentStatIndex]?.singular
                      : statItems[currentStatIndex]?.plural}
                  </span>
                </>
              ) : authSession ? (
                <>
                  <span style={{ fontWeight: 500 }}>Basic:</span>
                  <span>{formatNumber(allTimeStats.words)} words transcribed</span>
                </>
              ) : null}
        </div>

        {agentImproveStatus && !localCommandStatus && (
          <div style={{ flex: 1, display: 'flex', justifyContent: 'center', minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, maxWidth: 'min(620px, 54vw)' }}>
              <span
                style={{
                  fontSize: '9px',
                  color: theme.textSecondary,
                  opacity: 0.85,
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {footerStatusLabel}
              </span>
            </div>
          </div>
        )}

        {/* Center: Field Theory logo */}
        {(() => {
          const showFooterLogo = !localCommandStatus && !agentImproveStatus && showFieldTheoryLink &&
            (!FEATURE_NARRATION_ENABLED || narrationPlayback.status === 'idle');

          return showFooterLogo ? (
            <div
              style={{ flex: 1, display: 'flex', justifyContent: 'center', minWidth: 0 }}
            >
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center', minWidth: 0 }}>
                <img
                  src={theme.isDark ? 'fieldtheory-logo-white.png' : 'fieldtheory-logo-black.png'}
                  alt="Field Theory"
                  style={{
                    height: '14px',
                    width: 'auto',
                    maxWidth: '112px',
                    objectFit: 'contain',
                    opacity: 0.72,
                    display: 'block',
                  }}
                />
              </div>
            </div>
          ) : null;
        })()}

        {/* Center: Librarian narration playback controls (feature flagged) */}
        {FEATURE_NARRATION_ENABLED && narrationPlayback.status !== 'idle' && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '0 12px',
          }}>
            <span style={{
              fontSize: '9px',
              color: theme.textSecondary,
              fontWeight: 500,
            }}>
              Librarian:
            </span>

            {/* Play/Pause toggle */}
            <button
              onClick={handleNarrationToggle}
              disabled={narrationPlayback.status === 'generating'}
              style={{
                background: 'transparent',
                border: 'none',
                cursor: narrationPlayback.status === 'generating' ? 'default' : 'pointer',
                padding: '2px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: narrationPlayback.status === 'generating' ? 0.5 : 1,
              }}
              title={narrationPlayback.status === 'playing' ? 'Pause' : narrationPlayback.status === 'paused' ? 'Resume' : 'Generating...'}
            >
              {narrationPlayback.status === 'generating' ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={theme.textSecondary} strokeWidth="2">
                  <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="10" style={{ animation: 'spin 1s linear infinite' }} />
                </svg>
              ) : narrationPlayback.status === 'playing' ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill={theme.text}>
                  <rect x="6" y="4" width="4" height="16" />
                  <rect x="14" y="4" width="4" height="16" />
                </svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 24 24" fill={theme.text}>
                  <polygon points="5,3 19,12 5,21" />
                </svg>
              )}
            </button>

            {/* Progress bar */}
            <div
              style={{
                width: '80px',
                height: '4px',
                backgroundColor: theme.isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.1)',
                borderRadius: '2px',
                cursor: 'pointer',
                position: 'relative',
              }}
              onClick={() => {
                if (narrationPlayback.status === 'generating') return;
                // TODO: Implement seek functionality when available
              }}
            >
              <div
                style={{
                  width: `${narrationProgress}%`,
                  height: '100%',
                  backgroundColor: theme.text,
                  borderRadius: '2px',
                  transition: 'width 0.3s ease',
                }}
              />
            </div>

            {/* Stop button */}
            <button
              onClick={handleNarrationStop}
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: '2px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: 0.7,
              }}
              title="Stop"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill={theme.textSecondary}>
                <rect x="4" y="4" width="16" height="16" />
              </svg>
            </button>
          </div>
        )}

        {/* Right side: update notification OR version + settings button */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px', fontSize: '9px', flex: 1, minHeight: '18px' }}>
          {/* Update notification (when active) or version number */}
          {updateStatus !== 'idle' && updateStatus !== 'uptodate' && updateStatus !== 'error' ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              {/* Gift icon + text with shimmer overlay */}
              <div style={{
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                overflow: 'hidden',
              }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={theme.textSecondary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 12 20 22 4 22 4 12"/>
                  <rect x="2" y="7" width="20" height="5"/>
                  <line x1="12" y1="22" x2="12" y2="7"/>
                  <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/>
                  <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/>
                </svg>
                <span style={{ fontSize: '9px', color: theme.text }}>
                  {updateStatus === 'checking' ? 'Checking...' : updateStatus === 'downloading' ? 'Downloading...' : updateStatus === 'ready' ? 'Update ready' : updateStatus === 'installing' ? 'Installing...' : 'Update available'}
                </span>
                {/* Shimmer overlay */}
                <div style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  background: `linear-gradient(90deg, transparent 0%, ${theme.isDark ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.6)'} 50%, transparent 100%)`,
                  animation: 'shimmer 3.7s ease-in-out infinite',
                  pointerEvents: 'none',
                }} />
              </div>
              {updateStatus !== 'checking' && updateStatus !== 'downloading' && updateStatus !== 'installing' && (
                <>
                  <button
                    onClick={() => {
                      window.updaterAPI?.dismissUpdate();
                      setUpdateStatus('idle');
                    }}
                    style={{
                      padding: '2px 5px',
                      fontSize: '9px',
                      color: theme.textSecondary,
                      backgroundColor: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      opacity: 0.6,
                    }}
                  >
                    Later
                  </button>
                  <button
                    onClick={() => {
                      if (updateStatus === 'ready') {
                        setUpdateStatus('installing');
                        window.updaterAPI?.installUpdate();
                      } else {
                        setUpdateStatus('downloading');
                        window.updaterAPI?.downloadUpdate();
                      }
                    }}
                    style={{
                      padding: '2px 6px',
                      fontSize: '9px',
                      color: '#fff',
                      backgroundColor: theme.accent,
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      transition: 'all 0.1s ease',
                    }}
                    onMouseDown={(e) => {
                      e.currentTarget.style.transform = 'scale(0.95)';
                      e.currentTarget.style.opacity = '0.8';
                    }}
                    onMouseUp={(e) => {
                      e.currentTarget.style.transform = 'scale(1)';
                      e.currentTarget.style.opacity = '1';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = 'scale(1)';
                      e.currentTarget.style.opacity = '1';
                    }}
                  >
                    {updateStatus === 'ready' ? 'Install' : 'Update'}
                  </button>
                </>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              {/* Version/update text - hover triggers check for updates */}
              <div
                onMouseEnter={() => setVersionHovered(true)}
                onMouseLeave={() => setVersionHovered(false)}
                style={{ display: 'flex', gap: '6px', alignItems: 'center' }}
              >
                {versionHovered && updaterEnabled ? (
                  updateStatus === 'uptodate' ? (
                    <span style={{ color: theme.success, fontSize: '9px' }}>
                      Up to date ✓
                    </span>
                  ) : (
                    <button
                      onClick={() => isOnline && window.updaterAPI?.checkForUpdates?.()}
                      disabled={!isOnline}
                      title={!isOnline ? 'No internet connection' : undefined}
                      style={{
                        cursor: isOnline ? 'pointer' : 'not-allowed',
                        color: theme.textSecondary,
                        fontSize: '9px',
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        opacity: isOnline ? 1 : 0.5,
                      }}
                    >
                      Check for updates
                    </button>
                  )
                ) : (
                  <>
                    <FooterFpsCounter active={isWindowVisible && !footerChromeHidden} color={theme.textSecondary} />
                    {userCallsign && (
                      <span style={{ color: theme.textSecondary, fontSize: '9px', fontFamily: 'ui-monospace, SFMono-Regular, monospace', letterSpacing: '0.5px' }}>
                        {userCallsign}
                      </span>
                    )}
                    <span style={{ color: updateStatus === 'uptodate' ? theme.success : theme.textSecondary, fontSize: '9px', fontStyle: 'italic' }}>
                      {updateStatus === 'uptodate' ? 'Up to date ✓' : `v${appVersion}`}
                    </span>
                    {updateError && updateStatus === 'error' && (
                      <button
                        onClick={() => setShowUpdateErrorModal(true)}
                        title="Update check failed"
                        style={{
                          width: '16px',
                          height: '16px',
                          padding: 0,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: 'transparent',
                          border: 'none',
                          cursor: 'pointer',
                          opacity: 0.65,
                        }}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={theme.textSecondary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                          <line x1="12" y1="9" x2="12" y2="13" />
                          <line x1="12" y1="17" x2="12.01" y2="17" />
                        </svg>
                      </button>
                    )}
                  </>
                )}
              </div>
              {/* Release notes toggle button - always visible, styled like dark mode toggle */}
              <button
                onClick={() => {
                  if (!hasReleaseNotes(appVersion)) return;
                  if (showReleaseNotes) {
                    setShowReleaseNotes(false);
                    setReleaseNotesLatestMode(false);
                  } else {
                    setShowReleaseNotes(true);
                    setReleaseNotesLatestMode(true);
                  }
                }}
                disabled={!hasReleaseNotes(appVersion)}
                title="Release notes"
                style={{
                  width: '18px',
                  height: '18px',
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: showReleaseNotes ? theme.accent : 'transparent',
                  border: `1px solid ${theme.border}`,
                  borderRadius: '4px',
                  cursor: hasReleaseNotes(appVersion) ? 'pointer' : 'default',
                  transition: 'all 0.15s ease',
                  opacity: hasReleaseNotes(appVersion) ? 1 : 0.3,
                }}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={showReleaseNotes ? '#fff' : theme.textSecondary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <line x1="3" y1="9" x2="21" y2="9" />
                </svg>
              </button>
              {/* Dark/Light mode toggle */}
              {renderThemeToggleButton()}
            </div>
          )}
        </div>
      </div>

      {footerChromeHidden && (
        <div
          onMouseEnter={() => setThemeToggleProximityVisible(true)}
          onMouseLeave={() => setThemeToggleProximityVisible(false)}
          style={{
            position: 'absolute',
            right: '16px',
            ...(bookmarksCanvasChromeActive
              ? { top: `${FIELD_THEORY_CHROME_OVERLAY_TOP_PX + appTitlebarOffsetPx}px` }
              : { bottom: '8px' }),
            zIndex: 20,
            pointerEvents: focusChromeOverlayActive ? 'none' : 'auto',
            width: '34px',
            height: '34px',
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'flex-end',
            opacity: focusChromeOverlayActive || (appChromeHidden && !themeToggleProximityVisible) ? 0 : 1,
            transition: 'opacity 180ms ease',
          }}
        >
          {renderThemeToggleButton()}
        </div>
      )}

      {/* Quota exhausted modal removed for local-first release access. */}

      {showAgentImproveDialog && agentImproveContext && (
        <div
          onClick={closeAgentImproveDialog}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.45)',
            backdropFilter: 'blur(4px)',
            WebkitBackdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10002,
          }}
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              void launchAgentImprove();
            }}
            style={{
              backgroundColor: theme.bg,
              borderRadius: '8px',
              padding: '20px',
              maxWidth: '420px',
              width: '90%',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
              border: `1px solid ${theme.border}`,
            }}
          >
            <h3 style={{ margin: '0 0 8px 0', fontSize: '15px', color: theme.text, fontWeight: 600 }}>
              Improve with agent
            </h3>
            <div
              style={{
                marginBottom: '12px',
                fontSize: '11px',
                color: theme.textSecondary,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={agentImproveContext.filePath || undefined}
            >
              {agentImproveContext.kind === 'markdown-file' ? 'Whole file' : 'Selection'}
              {agentImproveContext.title ? `: ${agentImproveContext.title}` : ''}
            </div>
            <textarea
              autoFocus
              value={agentImproveInstruction}
              onChange={(e) => setAgentImproveInstruction(e.currentTarget.value)}
              placeholder="What should the agent do?"
              rows={4}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '10px',
                marginBottom: '12px',
                fontSize: '13px',
                lineHeight: 1.4,
                color: theme.text,
                backgroundColor: theme.bgSecondary,
                border: `1px solid ${theme.border}`,
                borderRadius: '6px',
                resize: 'vertical',
                outline: 'none',
                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
              }}
            />
            <div style={{ display: 'flex', gap: '6px', marginBottom: '14px' }}>
              {(['codex', 'claude'] as const).map((tool) => {
                const selected = agentImproveTool === tool;
                return (
                  <button
                    key={tool}
                    type="button"
                    onClick={() => setAgentImproveTool(tool)}
                    style={{
                      padding: '6px 10px',
                      fontSize: '12px',
                      backgroundColor: selected ? theme.accent : 'transparent',
                      border: `1px solid ${selected ? theme.accent : theme.border}`,
                      borderRadius: '6px',
                      color: selected ? '#fff' : theme.textSecondary,
                      cursor: 'pointer',
                    }}
                  >
                    {tool === 'codex' ? 'Codex' : 'Claude'}
                  </button>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={closeAgentImproveDialog}
                disabled={agentImproveLaunching}
                style={{
                  padding: '8px 14px',
                  fontSize: '12px',
                  backgroundColor: 'transparent',
                  border: `1px solid ${theme.border}`,
                  borderRadius: '6px',
                  color: theme.textSecondary,
                  cursor: agentImproveLaunching ? 'default' : 'pointer',
                  opacity: agentImproveLaunching ? 0.6 : 1,
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={agentImproveLaunching}
                style={{
                  padding: '8px 14px',
                  fontSize: '12px',
                  backgroundColor: theme.accent,
                  border: 'none',
                  borderRadius: '6px',
                  color: '#fff',
                  cursor: agentImproveLaunching ? 'default' : 'pointer',
                  fontWeight: 500,
                  opacity: agentImproveLaunching ? 0.7 : 1,
                }}
              >
                {agentImproveLaunching ? 'Starting...' : 'Start'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Sign-in prompt modal - shown when user tries to share without being logged in */}
      {showSignInPrompt && (
        <div
          onClick={() => setShowSignInPrompt(false)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            backdropFilter: 'blur(4px)',
            WebkitBackdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10002,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: theme.bg,
              borderRadius: '12px',
              padding: '24px',
              maxWidth: '360px',
              width: '90%',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
              border: `1px solid ${theme.border}`,
            }}
          >
            <h3 style={{ margin: '0 0 12px 0', fontSize: '16px', color: theme.text, fontWeight: '600' }}>
              Sign In to Share
            </h3>
            <p style={{ margin: '0 0 20px 0', fontSize: '13px', color: theme.textSecondary, lineHeight: '1.5' }}>
              Sign in or create an account to share items with your team.
            </p>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowSignInPrompt(false)}
                style={{
                  padding: '8px 16px',
                  fontSize: '12px',
                  backgroundColor: 'transparent',
                  border: `1px solid ${theme.border}`,
                  borderRadius: '6px',
                  color: theme.textSecondary,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowSignInPrompt(false);
                  setSettingsSection('account');
                  setShowSettings(true);
                }}
                style={{
                  padding: '8px 16px',
                  fontSize: '12px',
                  backgroundColor: theme.accent,
                  border: 'none',
                  borderRadius: '6px',
                  color: '#fff',
                  cursor: 'pointer',
                  fontWeight: '500',
                }}
              >
                Sign In
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Keyboard shortcuts modal - compact 2-column design */}
      {showShortcutsModal && (
        <div
          onClick={() => setShowShortcutsModal(false)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.4)',
            backdropFilter: 'blur(4px)',
            WebkitBackdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10001,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: theme.bg,
              borderRadius: '10px',
              padding: '16px 20px',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
            }}
          >
            <div style={{ 
              fontSize: '12px', 
              fontWeight: 600, 
              color: theme.textSecondary, 
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              marginBottom: '14px',
            }}>
              Shortcuts
            </div>
            {/* Two column grid of shortcuts - alphabetized, column-first flow */}
            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: 'auto auto', 
              gridTemplateRows: 'repeat(13, auto)',
              gridAutoFlow: 'column',
              gap: '10px 32px',
              fontSize: '13px',
              color: theme.textSecondary,
            }}>
              {/* Left column (A-N) */}
              <span>change view <KeyCap>⌥</KeyCap><KeyCap>tab</KeyCap></span>
              <span>close <KeyCap>esc</KeyCap></span>
              <span>copy <KeyCap>⌘</KeyCap><KeyCap>c</KeyCap></span>
              <span>delete <KeyCap>⌫</KeyCap></span>
              <span>DM <KeyCap>m</KeyCap></span>
              <span>down <KeyCap>↓</KeyCap> <span style={{ opacity: 0.5, fontSize: '0.85em' }}>(or</span> <KeyCap>j</KeyCap><span style={{ opacity: 0.5, fontSize: '0.85em' }}>)</span></span>
              <span>draw on image <KeyCap>d</KeyCap></span>
              <span>expand/collapse <KeyCap>e</KeyCap></span>
              <span>feedback <KeyCap>f</KeyCap></span>
              <span>focus mode <KeyCap>⌘</KeyCap><KeyCap>/</KeyCap></span>
              <span>help <KeyCap>shift</KeyCap><KeyCap>?</KeyCap></span>
              <span>hot mic <KeyCap>h</KeyCap></span>
              {/* Right column (N-U) */}
              <span>markdown/rendered <KeyCap>⌘</KeyCap><KeyCap>.</KeyCap></span>
              <span>new draw <KeyCap>⌘</KeyCap><KeyCap>d</KeyCap></span>
              <span>paste <KeyCap>↵</KeyCap></span>
              <span>preview <KeyCap>␣</KeyCap> <span style={{ opacity: 0.5, fontSize: '0.85em' }}>(space)</span></span>
              <span>redo <KeyCap>⌘</KeyCap><KeyCap>⇧</KeyCap><KeyCap>z</KeyCap></span>
              <span>search <KeyCap>/</KeyCap></span>
              <span>select <KeyCap>x</KeyCap></span>
              <span>sidebar <KeyCap>⌘</KeyCap><KeyCap>,</KeyCap></span>
              <span>stack <KeyCap>s</KeyCap></span>
              <span>team share <KeyCap>t</KeyCap></span>
              <span>undo <KeyCap>⌘</KeyCap><KeyCap>z</KeyCap></span>
              <span>unstack <KeyCap>u</KeyCap></span>
              <span>up <KeyCap>↑</KeyCap> <span style={{ opacity: 0.5, fontSize: '0.85em' }}>(or</span> <KeyCap>k</KeyCap><span style={{ opacity: 0.5, fontSize: '0.85em' }}>)</span></span>
            </div>
          </div>
        </div>
      )}

      {/* Feedback Confirmation Modal */}
      {showFeedbackModal && (
        <div
          onClick={() => setShowFeedbackModal(false)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            backdropFilter: 'blur(4px)',
            WebkitBackdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10001,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: theme.bg,
              borderRadius: '12px',
              padding: '20px',
              maxWidth: '360px',
              width: '90%',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
              border: `1px solid ${theme.border}`,
            }}
          >
            <h3 style={{ margin: '0 0 8px 0', fontSize: '15px', fontWeight: 600, color: theme.text }}>
              Share Feedback?
            </h3>
            <p style={{ margin: '0 0 12px 0', fontSize: '13px', color: theme.textSecondary, lineHeight: 1.5 }}>
              This will share the selected item(s) with Field Theory as feedback.
            </p>
            <p style={{ margin: '0 0 16px 0', fontSize: '12px', color: theme.textSecondary, opacity: 0.8, lineHeight: 1.4 }}>
              Add context, see replies, and track progress in the Feedback tab.
            </p>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', alignItems: 'center' }}>
              <button
                onClick={() => setShowFeedbackModal(false)}
                style={{
                  padding: '6px 12px',
                  fontSize: '13px',
                  fontWeight: 500,
                  color: feedbackModalFocus === 'cancel' ? '#fff' : theme.text,
                  backgroundColor: feedbackModalFocus === 'cancel' ? theme.accent : 'transparent',
                  border: `1px solid ${feedbackModalFocus === 'cancel' ? theme.accent : theme.border}`,
                  borderRadius: '6px',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const selectedRow = listRows[selectedIndex];
                  if (selectedRow) {
                    const itemId = selectedRow.type === 'item'
                      ? selectedRow.item.id
                      : selectedRow.items[0]?.id;

                    if (itemId) {
                      (async () => {
                        if (!window.socialAPI) return;
                        const result = await window.socialAPI.submitFeedback(itemId);
                        if (result) {
                          showFeedback('sent as feedback');
                        }
                      })();
                    }
                  }
                  setShowFeedbackModal(false);
                }}
                style={{
                  padding: '6px 12px',
                  fontSize: '13px',
                  fontWeight: 500,
                  color: feedbackModalFocus === 'share' ? '#fff' : theme.text,
                  backgroundColor: feedbackModalFocus === 'share' ? theme.accent : 'transparent',
                  border: `1px solid ${feedbackModalFocus === 'share' ? theme.accent : theme.border}`,
                  borderRadius: '6px',
                  cursor: 'pointer',
                }}
              >
                Share
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DM Modal - Send selected item as DM */}
      {showDMModal && (
        <div
          onClick={() => setShowDMModal(false)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.4)',
            backdropFilter: 'blur(4px)',
            WebkitBackdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10002,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: theme.bg,
              borderRadius: '10px',
              padding: '16px 20px',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
              width: '300px',
            }}
          >
            <div style={{ 
              fontSize: '12px', 
              fontWeight: 600, 
              color: theme.textSecondary, 
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              marginBottom: '14px',
            }}>
              Send DM
            </div>
            <input
              autoFocus
              type="text"
              placeholder="Search contacts..."
              value={dmRecipientQuery}
              onChange={(e) => {
                setDmRecipientQuery(e.target.value);
                setSelectedDmContactIndex(0);
              }}
              onKeyDown={(e) => {
                const filteredContacts = dmContacts.filter(c => 
                  c.email.toLowerCase().includes(dmRecipientQuery.toLowerCase()) ||
                  c.name?.toLowerCase().includes(dmRecipientQuery.toLowerCase())
                );
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setSelectedDmContactIndex(prev => Math.min(prev + 1, filteredContacts.length - 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setSelectedDmContactIndex(prev => Math.max(prev - 1, 0));
                } else if (e.key === 'Enter' && filteredContacts.length > 0) {
                  e.preventDefault();
                  const contact = filteredContacts[selectedDmContactIndex];
                  if (contact?.userId) {
                    // Get selected item ID and send DM.
                    const selectedRow = listRows[selectedIndex];
                    const itemId = selectedRow?.type === 'item' 
                      ? selectedRow.item.id 
                      : selectedRow?.items?.[0]?.id;
                    if (itemId) {
                      void window.socialAPI?.sendDM(contact.userId, itemId);
                    }
                    setShowDMModal(false);
                  }
                } else if (e.key === 'Escape') {
                  setShowDMModal(false);
                }
              }}
              style={{
                width: '100%',
                padding: '8px',
                fontSize: '12px',
                border: `1px solid ${theme.inputBorder}`,
                borderRadius: '6px',
                backgroundColor: theme.inputBg,
                color: theme.text,
                marginBottom: '8px',
                boxSizing: 'border-box',
                outline: 'none',
              }}
            />
            <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
              {dmContacts
                .filter(c => 
                  c.email.toLowerCase().includes(dmRecipientQuery.toLowerCase()) ||
                  c.name?.toLowerCase().includes(dmRecipientQuery.toLowerCase())
                )
                .map((contact, idx) => (
                  <div
                    key={contact.id}
                    onClick={() => {
                      if (contact.userId) {
                        const selectedRow = listRows[selectedIndex];
                        const itemId = selectedRow?.type === 'item' 
                          ? selectedRow.item.id 
                          : selectedRow?.items?.[0]?.id;
                        if (itemId) {
                          window.socialAPI?.sendDM(contact.userId, itemId);
                        }
                        setShowDMModal(false);
                      }
                    }}
                    style={{
                      padding: '8px',
                      borderRadius: '4px',
                      backgroundColor: idx === selectedDmContactIndex ? theme.bgSecondary : 'transparent',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ fontSize: '12px', color: theme.text }}>
                      {contact.name || contact.email}
                    </div>
                    {contact.name && (
                      <div style={{ fontSize: '10px', color: theme.textSecondary }}>
                        {contact.email}
                      </div>
                    )}
                  </div>
                ))}
              {dmContacts.filter(c => 
                c.email.toLowerCase().includes(dmRecipientQuery.toLowerCase()) ||
                c.name?.toLowerCase().includes(dmRecipientQuery.toLowerCase())
              ).length === 0 && (
                <div style={{ fontSize: '11px', color: theme.textSecondary, padding: '8px' }}>
                  No contacts found. Add friends in the DMs tab.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Preview modal - Quick Look style for images and text */}
      {preview && (
        <div
          onClick={dismissPreview}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.4)',
            backdropFilter: 'blur(4px)',
            WebkitBackdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
            cursor: 'pointer',
            animation: previewClosing ? 'previewFadeOut 0.15s ease-in forwards' : 'previewFadeIn 0.15s ease-out',
          }}
        >
          {preview.type === 'image' ? (
            <ImagePreviewFrame
              src={`data:image/png;base64,${preview.data}`}
              alt="Preview"
              label={preview.figureLabel ? `figure ${preview.figureLabel}` : null}
              labelStyle={{
                color: theme.text,
                backgroundColor: theme.isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)',
              }}
            >
              {/* Action bar - compact buttons with no background */}
              <div style={{
                display: 'flex',
                gap: '4px',
                flexWrap: 'wrap',
                justifyContent: 'center',
              }}>
                {[
                  { label: 'paste', key: '↵', action: async () => {
                    const selectedRow = listRows[selectedIndex];
                    if (selectedRow?.type === 'item' && window.clipboardAPI) {
                      const bundleId = targetAppInfo?.previousApp?.bundleId;
                      await window.clipboardAPI.pasteItem(selectedRow.item.id, bundleId, selectedRow.item.useImprovedVersion);
                    }
                  }},
                  { label: 'copy', key: 'c', action: async () => {
                    if (preview.type === 'image' && window.clipboardAPI) {
                      // Images don't have improved content
                      await window.clipboardAPI.copyItem(preview.itemId);
                      showFeedback('copied to clipboard');
                    }
                  }},
                  { label: 'draw', key: 'd', action: () => {
                    setSketchBackgroundImage({
                      dataUrl: `data:image/png;base64,${preview.data}`,
                      width: preview.width || 800,
                      height: preview.height || 600,
                    });
                    setEditingSketchItem(null);
                    dismissPreview();
                    setViewMode('sketch');
                  }},
                  ...(canShare ? [{ label: 'share', key: 's', action: async () => {
                    const selectedRow = listRows[selectedIndex];
                    const itemId = selectedRow?.type === 'item'
                      ? selectedRow.item.id
                      : selectedRow?.items?.[0]?.id;
                    if (itemId) await shareToTeam(itemId);
                    dismissPreview();
                  }}] : []),
                  { label: 'feedback', key: 'f', action: async () => {
                    const selectedRow = listRows[selectedIndex];
                    const itemId = selectedRow?.type === 'item' 
                      ? selectedRow.item.id 
                      : selectedRow?.items?.[0]?.id;
                    if (itemId && window.socialAPI) {
                      const result = await window.socialAPI.submitFeedback(itemId);
                      if (result) {
                        showFeedback('sent as feedback');
                      }
                    }
                    dismissPreview();
                  }},
                  // Unstack button - only show when image is part of a stack.
                  ...(preview.type === 'image' && preview.stackId ? [{
                    label: 'unstack', key: 'u', action: async () => {
                      if (preview.type === 'image' && preview.stackId && window.clipboardAPI) {
                        await window.clipboardAPI.updateStackId?.([preview.itemId], null);
                        pushUndo({ type: 'unstack', itemIds: [preview.itemId], previousStackId: preview.stackId });
                        showFeedback('image unstacked');
                        dismissPreview();
                        loadItems(true);
                      }
                    }
                  }] : []),
                  { label: 'delete', key: '⌫', action: async () => {
                    const selectedRow = listRows[selectedIndex];
                    if (selectedRow?.type === 'item' && window.clipboardAPI) {
                      const item = await window.clipboardAPI.getItem(selectedRow.item.id);
                      await window.clipboardAPI.deleteItem(selectedRow.item.id);
                      if (item) {
                        pushUndo({ type: 'delete', items: [item] });
                        showFeedback('item deleted');
                      }
                      dismissPreview();
                      loadItems(true);
                    }
                  }},
                ].map((action) => (
                  <button
                    key={action.label}
                    onClick={action.action}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '3px',
                      padding: '3px 6px',
                      fontSize: '10px',
                      fontWeight: 500,
                      backgroundColor: 'rgba(0, 0, 0, 0.5)',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                    }}
                  >
                    {action.label}
                    <span style={{
                      fontSize: '8px',
                      opacity: 0.6,
                    }}>
                      {action.key}
                    </span>
                  </button>
                ))}
              </div>
            </ImagePreviewFrame>
          ) : (
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                maxWidth: '80vw',
                maxHeight: '80vh',
                backgroundColor: theme.bg,
                borderRadius: '12px',
                padding: '24px',
                boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
                cursor: 'default',
                overflow: 'auto',
              }}
            >
              <pre style={{
                margin: 0,
                fontSize: '14px',
                lineHeight: 1.6,
                color: theme.text,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
              }}>
                {preview.content}
              </pre>
            </div>
          )}
          
          {/* Stack position indicator - shows 1/4 style when viewing a stack with multiple items */}
          {stackPreviewItems.length > 1 && (
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                position: 'absolute',
                bottom: '24px',
                left: '50%',
                transform: 'translateX(-50%)',
                backgroundColor: 'rgba(0, 0, 0, 0.6)',
                backdropFilter: 'blur(8px)',
                WebkitBackdropFilter: 'blur(8px)',
                borderRadius: '12px',
                padding: '6px 12px',
                color: '#fff',
                fontSize: '13px',
                fontWeight: 500,
                cursor: 'default',
              }}
            >
              {stackPreviewIndex + 1} / {stackPreviewItems.length}
            </div>
          )}
        </div>
      )}

    </div>

    <PerformanceHud enabled={performanceHudEnabled} />

    {showUpdateErrorModal && updateError && (
      <div
        onClick={() => setShowUpdateErrorModal(false)}
        style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: theme.isDark ? 'rgba(0,0,0,0.42)' : 'rgba(255,255,255,0.58)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          zIndex: 10000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
        }}
      >
        <div
          onClick={(event) => event.stopPropagation()}
          style={{
            width: 'min(420px, 100%)',
            backgroundColor: theme.bg,
            border: `1px solid ${theme.border}`,
            borderRadius: '8px',
            boxShadow: theme.isDark ? '0 18px 48px rgba(0,0,0,0.45)' : '0 18px 48px rgba(0,0,0,0.14)',
            padding: '18px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={theme.textSecondary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <div style={{ color: theme.text, fontSize: '14px', fontWeight: 600 }}>
              Update check failed
            </div>
          </div>
          <div style={{ color: theme.textSecondary, fontSize: '13px', lineHeight: 1.45, marginBottom: '16px', wordBreak: 'break-word' }}>
            {updateError}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <button
              onClick={() => {
                setUpdateError(null);
                setUpdateStatus('idle');
                setShowUpdateErrorModal(false);
              }}
              style={{
                padding: '6px 10px',
                color: theme.textSecondary,
                backgroundColor: 'transparent',
                border: `1px solid ${theme.border}`,
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '12px',
              }}
            >
              Dismiss
            </button>
            <button
              onClick={() => {
                setShowUpdateErrorModal(false);
                setUpdateError(null);
                window.updaterAPI?.checkForUpdates?.();
              }}
              style={{
                padding: '6px 10px',
                color: '#fff',
                backgroundColor: theme.accent,
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '12px',
              }}
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    )}

    {/* Release notes popup - shows after app update, on first install, or on version hover */}
    {showReleaseNotes && (
      <ReleaseNotesPopup
        currentVersion={appVersion}
        onDismiss={() => {
          setShowReleaseNotes(false);
          setReleaseNotesLatestMode(false);
        }}
        isLatestMode={releaseNotesLatestMode}
      />
    )}

    {/* Debug console sidebar - toggle with Cmd+Shift+D */}
    <DebugConsole />
    </>
  );
}
