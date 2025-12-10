// =============================================================================
// ClipboardHistory - Alfred-style clipboard history popup.
// Shows local clipboard history with fuzzy search and multi-select.
// Also supports todo view mode (switched via Cmd+Shift+T hotkey).
// =============================================================================

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import SettingsPanel from './SettingsPanel';
import TodoView from './TodoView';
import { useTheme } from '../contexts/ThemeContext';
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

// View mode: clipboard history or todo list.
type ViewMode = 'clipboard' | 'todo';

type ClipboardItemType = 'text' | 'image' | 'transcript' | 'screenshot';
type ClipboardSource = 'mac' | 'ios';

type ClipboardItem = {
  id: number;
  type: ClipboardItemType;
  content: string | null;
  improvedContent: string | null; // Improved version from Engineer feature
  imageData: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  imageSize: number | null;
  sourceApp: string | null;
  sourceAppName: string | null;
  wordCount: number | null;
  charCount: number | null;
  createdAt: number;
  contentHash: string;
  stackId: string | null;
  source: ClipboardSource;
};

type StackInfo = {
  stackId: string;
  itemCount: number;
  imageCount: number;
  textCount: number;
  createdAt: number;
  firstTextPreview: string | null;
};

// A row in the list can be either a single item or a grouped stack
type ListRow = 
  | { type: 'item'; item: ClipboardItem }
  | { type: 'stack'; stack: StackInfo; items: ClipboardItem[]; expanded: boolean };

type FilterType = 'all' | 'transcript' | 'screenshot';

// Source filter: which device's items to show
type SourceFilterType = 'all' | 'mac' | 'ios';

type RunningApp = {
  bundleId: string;
  name: string;
};

/**
 * Format timestamp to relative time (e.g., "2 minutes ago").
 */
function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  return 'just now';
}

/**
 * Format file size for images.
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Truncate text preview (legacy - simple truncation).
 */
function truncateText(text: string, maxLength: number = 100): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

/**
 * Smart truncation that shows beginning and end of text.
 * Returns an object with firstPart, lastPart, and whether truncation was needed.
 * When truncated, shows first ~5-10 words and last ~5-10 words.
 */
function smartTruncateText(text: string, targetWords: number = 8): { 
  firstPart: string; 
  lastPart: string; 
  needsTruncation: boolean;
  fullText: string;
} {
  const trimmed = text.trim();
  const words = trimmed.split(/\s+/).filter(w => w.length > 0);
  
  // If text is short enough (less than double the target words), no truncation needed.
  if (words.length <= targetWords * 2 + 2) {
    return { 
      firstPart: trimmed, 
      lastPart: '', 
      needsTruncation: false,
      fullText: trimmed,
    };
  }
  
  // Get first N words and last N words.
  const firstWords = words.slice(0, targetWords);
  const lastWords = words.slice(-targetWords);
  
  return {
    firstPart: firstWords.join(' '),
    lastPart: lastWords.join(' '),
    needsTruncation: true,
    fullText: trimmed,
  };
}

/**
 * Combine text content from stack items into a single paragraph.
 */
function combineStackText(items: ClipboardItem[]): string {
  const textParts: string[] = [];
  for (const item of items) {
    if ((item.type === 'text' || item.type === 'transcript') && item.content) {
      textParts.push(item.content.trim());
    }
  }
  return textParts.join('\n\n');
}


/**
 * DraggableDroppableRow - wrapper that makes a row both draggable and a drop target.
 * Uses dnd-kit's useDraggable and useDroppable hooks.
 */
function DraggableDroppableRow({
  id,
  children,
  style,
  isOver,
  isDragging,
  ...props
}: {
  id: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
  isOver?: boolean;
  isDragging?: boolean;
} & React.HTMLAttributes<HTMLDivElement>) {
  const { attributes, listeners, setNodeRef: setDragRef } = useDraggable({ id });
  const { setNodeRef: setDropRef } = useDroppable({ id });

  return (
    <div
      ref={(node) => {
        setDragRef(node);
        setDropRef(node);
      }}
      {...attributes}
      {...listeners}
      {...props}
      style={{
        ...style,
        opacity: isDragging ? 0.5 : 1,
        outline: isOver ? '2px solid #2dd4bf' : 'none',
        outlineOffset: '-2px',
      }}
    >
      {children}
    </div>
  );
}

/**
 * KeyCap component - renders a keyboard key with 3D styling.
 * Used for displaying keyboard shortcuts with a visual key appearance.
 */
function KeyCap({ children, small = false }: { children: React.ReactNode; small?: boolean }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: small ? '10px' : '12px',
        height: small ? '10px' : '12px',
        padding: '0 3px',
        fontSize: small ? '7px' : '8px',
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
        fontWeight: 500,
        color: '#666',
        backgroundColor: '#f0f0f0',
        border: '1px solid #ccc',
        borderRadius: '2px',
        boxShadow: '0 1px 0 #aaa',
        marginRight: '2px',
      }}
    >
      {children}
    </span>
  );
}

/**
 * Detect if text contains a valid color value (hex or RGB) and return the color string.
 * Returns null if no valid color is found.
 * Checks if the entire text is a color, or finds the first color value in the text.
 */
function detectColor(text: string | null): string | null {
  if (!text) return null;
  
  const trimmed = text.trim();
  
  // First check if the entire text is a hex color: #RGB, #RRGGBB, #RRGGBBAA
  const hexPattern = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/;
  if (hexPattern.test(trimmed)) {
    return trimmed;
  }
  
  // Check if the entire text is RGB/RGBA: rgb(255, 87, 51) or rgba(255, 87, 51, 0.5)
  const rgbPattern = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*[\d.]+)?\s*\)$/i;
  if (rgbPattern.test(trimmed)) {
    return trimmed;
  }
  
  // If not the entire text, search for hex colors within the text
  const hexInTextPattern = /#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})\b/;
  const hexMatch = trimmed.match(hexInTextPattern);
  if (hexMatch) {
    return hexMatch[0];
  }
  
  // Search for RGB/RGBA within the text
  const rgbInTextPattern = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*[\d.]+)?\s*\)/i;
  const rgbInTextMatch = trimmed.match(rgbInTextPattern);
  if (rgbInTextMatch) {
    return rgbInTextMatch[0];
  }
  
  return null;
}

/**
 * ClipboardHistory component - Alfred-style popup for clipboard history.
 */
export default function ClipboardHistory() {
  const { theme, toggleDarkMode } = useTheme();
  const [isVisible, setIsVisible] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('clipboard');
  const [items, setItems] = useState<ClipboardItem[]>([]);
  const [stacks, setStacks] = useState<StackInfo[]>([]);
  const [expandedStacks, setExpandedStacks] = useState<Set<string>>(new Set());
  const [expandedItems, setExpandedItems] = useState<Set<number>>(new Set());
  const [overflowingTexts, setOverflowingTexts] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');
  const [sourceFilter, setSourceFilter] = useState<SourceFilterType>('all');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [isMultiSelect, setIsMultiSelect] = useState(false);
  const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null);
  const [deletedItems, setDeletedItems] = useState<ClipboardItem[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  
  // Improve feature - track loading state and result per stack
  const [improvingStackId, setImprovingStackId] = useState<string | null>(null);
  const [improveResult, setImproveResult] = useState<{
    stackId: string;
    refinedPrompt: string;
  } | null>(null);
  const [improvedIds, setImprovedIds] = useState<Set<string>>(new Set());
  const [showImproveResult, setShowImproveResult] = useState<string | null>(null);
  
  // Track which items/stacks the user wants to view as original (toggle from improved).
  // Items in this set show original content even if improved content is available.
  const [viewOriginalIds, setViewOriginalIds] = useState<Set<string>>(new Set());
  
  // Confirmation modal for re-improving already improved content.
  const [confirmReimproveModal, setConfirmReimproveModal] = useState<{
    itemId: string;
    type: 'original' | 'improved'; // Which content will be sent for improvement
  } | null>(null);
  
  // Hover states for UI interactions
  const [hoveredImageId, setHoveredImageId] = useState<number | null>(null);
  
  type PreviewContent = 
    | { type: 'image'; data: string; width: number; height: number }
    | { type: 'text'; content: string };
  const [preview, setPreview] = useState<PreviewContent | null>(null);
  const [previewClosing, setPreviewClosing] = useState(false);
  
  const dismissPreview = () => {
    if (!preview || previewClosing) return;
    setPreviewClosing(true);
    setTimeout(() => {
      setPreview(null);
      setPreviewClosing(false);
    }, 150);
  };
  
  const getPreviewForRow = (row: ListRow): PreviewContent | null => {
    if (row.type === 'item') {
      if (row.item.imageData) {
        return {
          type: 'image',
          data: row.item.imageData,
          width: row.item.imageWidth || 0,
          height: row.item.imageHeight || 0,
        };
      } else if (row.item.content) {
        return { type: 'text', content: row.item.content };
      }
    } else if (row.type === 'stack') {
      const imageItem = row.items.find(i => i.imageData);
      if (imageItem?.imageData) {
        return {
          type: 'image',
          data: imageItem.imageData,
          width: imageItem.imageWidth || 0,
          height: imageItem.imageHeight || 0,
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
  };
  
  const [isRecording, setIsRecording] = useState(false);
  
  // Audio state for Priority Mic dropdown.
  type AudioDevice = { id: string; name: string; isInput: boolean };
  const [audioDevices, setAudioDevices] = useState<AudioDevice[]>([]);
  const [priorityDeviceId, setPriorityDeviceId] = useState<string | null>(null);
  const [showMicDropdown, setShowMicDropdown] = useState(false);
  
  // Update notification state.
  type UpdateStatus = 'idle' | 'available' | 'downloading' | 'ready';
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>('idle');
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  
  // App version for footer display.
  const [appVersion] = useState(() => window.updaterAPI?.getVersion?.() || '0.0.0');
  
  const [allTimeStats, setAllTimeStats] = useState<{ stacks: number; transcriptions: number; screenshots: number; improved: number; words: number }>({
    stacks: 0, transcriptions: 0, screenshots: 0, improved: 0, words: 0,
  });

  useEffect(() => {
    if (!isVisible || !window.clipboardAPI?.getAllTimeStats) return;
    
    window.clipboardAPI.getAllTimeStats().then(stats => {
      setAllTimeStats(stats);
    }).catch(err => {
      console.error('[ClipboardHistory] Failed to load all-time stats:', err);
    });
  }, [isVisible]);

  useEffect(() => {
    if (!window.transcribeAPI?.onStatusChanged) return;
    
    const cleanup = window.transcribeAPI.onStatusChanged((status) => {
      setIsRecording(status === 'recording');
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
    
    // Query current update status on mount (in case we missed the IPC event).
    window.updaterAPI.getStatus().then((info) => {
      if (info) {
        setUpdateStatus(info.status);
        setUpdateVersion(info.version);
      }
    });
    
    const cleanups = [
      window.updaterAPI.onUpdateAvailable((info) => {
        setUpdateStatus('available');
        setUpdateVersion(info.version);
      }),
      window.updaterAPI.onDownloadProgress(() => {
        setUpdateStatus('downloading');
      }),
      window.updaterAPI.onUpdateDownloaded((info) => {
        setUpdateStatus('ready');
        setUpdateVersion(info.version);
      }),
      window.updaterAPI.onUpdateNotAvailable(() => {
        setUpdateStatus('idle');
      }),
      window.updaterAPI.onError(() => {
        setUpdateStatus('idle');
      }),
    ];
    
    return () => cleanups.forEach(cleanup => cleanup());
  }, []);

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
  const [pendingStackSelection, setPendingStackSelection] = useState<string | null>(null);
  const [pendingItemSelection, setPendingItemSelection] = useState<number | null>(null);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);

  // dnd-kit drag state - tracks what's being dragged.
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [overDropId, setOverDropId] = useState<string | null>(null);

  // Pointer sensor with distance activation - must move 5px before drag starts.
  // This distinguishes clicks from drags.
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    })
  );

  // Format numbers with commas (e.g., 16,000)
  const formatNumber = (num: number): string => num.toLocaleString();

  const statItems = useMemo(() => [
    { label: 'Words', value: allTimeStats.words, singular: 'word transcribed', plural: 'words transcribed' },
    { label: 'Stacks', value: allTimeStats.stacks, singular: 'stack', plural: 'stacks' },
    { label: 'Transcriptions', value: allTimeStats.transcriptions, singular: 'transcription', plural: 'transcriptions' },
    { label: 'Improved', value: allTimeStats.improved, singular: 'prompt improved', plural: 'prompts improved' },
    { label: 'Screenshots', value: allTimeStats.screenshots, singular: 'screenshot', plural: 'screenshots' },
  ].filter(item => item.value > 0), [allTimeStats]);

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
  
  const [targetAppInfo, setTargetAppInfo] = useState<{
    targetApp: RunningApp | null;
    runningApps: RunningApp[];
    targetAppIndex: number;
  }>({
    targetApp: null,
    runningApps: [],
    targetAppIndex: 0,
  });
  
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const searchDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ITEMS_PER_PAGE = 50;

  const isMacOS = typeof window !== 'undefined' && window.platform?.isMacOS;

  // Load items from clipboard history plus stack info.
  const loadItems = useCallback(async (reset: boolean = false) => {
    if (!isMacOS || !window.clipboardAPI) {
      return;
    }

    setLoading(true);
    try {
      const queryOptions: ClipboardQueryOptions = {
        limit: ITEMS_PER_PAGE,
        offset: reset ? 0 : offset,
      };

      if (sourceFilter !== 'all') {
        queryOptions.source = sourceFilter;
      }

      if (debouncedSearchQuery.trim()) {
        queryOptions.search = debouncedSearchQuery.trim();
      }

      const [newItems, stacksData] = await Promise.all([
        window.clipboardAPI.queryItems(queryOptions),
        reset ? window.clipboardAPI.getUniqueStacks?.() : Promise.resolve(stacks),
      ]);
      
      if (reset) {
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
  }, [isMacOS, debouncedSearchQuery, offset, stacks, sourceFilter]);

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
    if (isVisible) {
      setOffset(0);
      loadItems(true);
    }
  }, [isVisible, debouncedSearchQuery, sourceFilter]);

  useEffect(() => {
    if (!isMacOS || !window.clipboardAPI) {
      return;
    }

    setIsVisible(true);
    setSelectedIndex(0);
    setSelectedIds(new Set());
    setIsMultiSelect(false);

    const unsubscribeShowHistory = window.clipboardAPI.onShowHistory(() => {
      setSearchQuery('');
      setDebouncedSearchQuery('');
      setSelectedIndex(0);
      setSelectedIds(new Set());
      setIsMultiSelect(false);
      setShowSettings(false);
      setViewMode('clipboard');
    });

    const unsubscribeShowSettings = window.clipboardAPI.onShowSettings?.(() => {
      setShowSettings(true);
    });

    // Listen for todo view hotkey (Cmd+Shift+T).
    // Toggles between todo and clipboard view.
    const unsubscribeShowTodos = window.todoAPI?.onShowTodos?.(() => {
      setShowSettings(false);
      setViewMode(prev => prev === 'todo' ? 'clipboard' : 'todo');
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
        targetApp: info.targetApp,
        runningApps: info.runningApps,
        targetAppIndex,
      });
    });

    const unsubscribeAdded = window.clipboardAPI.onItemAdded((id) => {
      loadItems(true);
    });

    const unsubscribeDeleted = window.clipboardAPI.onItemDeleted((id) => {
      setItems(prev => prev.filter(item => item.id !== id));
      setSelectedIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    });

    return () => {
      unsubscribeShowHistory();
      unsubscribeShowSettings?.();
      unsubscribeShowTodos?.();
      unsubscribeTargetAppInfo?.();
      unsubscribeAdded();
      unsubscribeDeleted();
    };
  }, [isMacOS, loadItems]);

  // Build list rows with stack grouping.
  // Stacked items are grouped together, non-stacked items appear individually.
  const buildListRows = useCallback((): ListRow[] => {
    const rows: ListRow[] = [];
    const seenStackIds = new Set<string>();
    
    // Process all items (no filtering)
    for (const item of items) {
      if (item.stackId) {
        // This item belongs to a stack
        if (!seenStackIds.has(item.stackId)) {
          seenStackIds.add(item.stackId);
          
          // Find the stack info
          const stackInfo = stacks.find(s => s.stackId === item.stackId);
          if (stackInfo) {
            // Get all items in this stack
            const stackItems = items.filter((i: ClipboardItem) => i.stackId === item.stackId);
            const isExpanded = expandedStacks.has(item.stackId);
            
            rows.push({
              type: 'stack',
              stack: stackInfo,
              items: stackItems,
              expanded: isExpanded,
            });
          } else {
            // Stack info not loaded, show as individual item
            rows.push({ type: 'item', item });
          }
        }
        // If we've already seen this stack, don't add another row
      } else {
        // Individual item (not in a stack)
        rows.push({ type: 'item', item });
      }
    }
    
    return rows;
  }, [items, stacks, expandedStacks]);
  
  // Memoize listRows so it's available in keyboard handler
  const listRows = useMemo(() => buildListRows(), [buildListRows]);

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

  // Handle keyboard input via standard DOM events (window is focusable).
  useEffect(() => {
    if (!isVisible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const hasShift = e.shiftKey;
      const hasMeta = e.metaKey;
      const hasCtrl = e.ctrlKey;
      const hasAlt = e.altKey;
      const key = e.key;

      // If typing in the input, let it handle normal characters and Tab
      if (document.activeElement === inputRef.current && 
          key.length === 1 && 
          !hasMeta && !hasCtrl && !hasAlt && 
          key !== 'ArrowUp' && key !== 'ArrowDown' && key !== 'Enter' && key !== 'Escape') {
        return; // Let input handle it naturally
      }

      // Prevent default for navigation keys (except Tab when input is focused)
      if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Enter' || key === 'Escape' || 
          key === 'j' || key === 'k' || key === 'u' || key === 'h' || key === '?') {
        if (!document.activeElement?.tagName?.match(/INPUT|TEXTAREA/)) {
          e.preventDefault();
        }
      }
      
      // Shift+? - Show shortcuts modal
      if (key === '?' && hasShift) {
        e.preventDefault();
        setShowShortcutsModal(true);
        return;
      }
      
      // / - Focus search input (like Gmail, Google)
      if (key === '/' && !hasMeta && !hasCtrl && !hasAlt && !hasShift) {
        // Skip if already typing in input
        if (document.activeElement?.tagName?.match(/INPUT|TEXTAREA/)) return;
        e.preventDefault();
        inputRef.current?.focus();
        return;
      }
      
      // S - Stack selected items (when multiple items are selected)
      if (key === 's' && !hasMeta && !hasCtrl && !hasAlt && !hasShift) {
        // Skip if typing in input
        if (document.activeElement?.tagName?.match(/INPUT|TEXTAREA/)) return;
        
        if (selectedIds.size > 1) {
          e.preventDefault();
          // Create a new stack from selected items
          const newStackId = crypto.randomUUID();
          window.clipboardAPI?.updateStackId?.(Array.from(selectedIds), newStackId).then(() => {
            setSelectedIds(new Set());
            setIsMultiSelect(false);
            // Flash the newly created stack and select it
            setRecentlyStackedId(newStackId);
            setPendingStackSelection(newStackId);
            setTimeout(() => setRecentlyStackedId(null), 1500);
            loadItems(true);
          });
        }
        return;
      }
      
      // X - Toggle selection on current item (Gmail-style)
      if (key === 'x' && !hasMeta && !hasCtrl && !hasAlt && !hasShift) {
        // Skip if typing in input
        if (document.activeElement?.tagName?.match(/INPUT|TEXTAREA/)) return;
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

      if (key === 'Escape') {
        // If preview is open, dismiss it first
        if (preview) {
          e.preventDefault();
          dismissPreview();
          return;
        }
        // If shortcuts modal is open, close it
        if (showShortcutsModal) {
          setShowShortcutsModal(false);
          return;
        }
        // If search input is focused, blur it and select first item instead of closing
        if (document.activeElement === inputRef.current) {
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
        if (document.activeElement?.tagName?.match(/INPUT|TEXTAREA/)) return;
        
        e.preventDefault();
        setKeyboardNavActive(true);
        const newIndex = Math.min(selectedIndex + 1, listRows.length - 1);
        
        // If preview is open, update preview for new item.
        if (preview && newIndex !== selectedIndex) {
          const newRow = listRows[newIndex];
          if (newRow) {
            const newContent = getPreviewForRow(newRow);
            if (newContent) setPreview(newContent);
          }
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
        if (document.activeElement?.tagName?.match(/INPUT|TEXTAREA/)) return;
        
        e.preventDefault();
        
        // If at first item, focus search input (Alfred-style cycle).
        if (selectedIndex === 0) {
          inputRef.current?.focus();
          return;
        }
        
        setKeyboardNavActive(true);
        const newIndex = Math.max(selectedIndex - 1, 0);
        
        // If preview is open, update preview for new item.
        if (preview && newIndex !== selectedIndex) {
          const newRow = listRows[newIndex];
          if (newRow) {
            const newContent = getPreviewForRow(newRow);
            if (newContent) setPreview(newContent);
          }
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
      
      // U - Unstack the selected stack
      if (key === 'u' && !hasMeta && !hasCtrl && !hasAlt && !hasShift) {
        // Skip if typing in input
        if (document.activeElement?.tagName?.match(/INPUT|TEXTAREA/)) return;
        
        const selectedRow = listRows[selectedIndex];
        if (selectedRow?.type === 'stack' && selectedRow.items.length > 1) {
          e.preventDefault();
          const itemIds = selectedRow.items.map(i => i.id);
          // After unstack, select the first (most recent) item from the stack
          const firstItemId = selectedRow.items[0]?.id;
          window.clipboardAPI?.updateStackId?.(itemIds, null).then(() => {
            if (firstItemId) {
              setPendingItemSelection(firstItemId);
            }
            loadItems(true);
          });
        }
        return;
      }
      
      // H - Toggle "Show more" / "Hide" expansion on selected row
      if (key === 'h' && !hasMeta && !hasCtrl && !hasAlt && !hasShift) {
        // Skip if typing in input
        if (document.activeElement?.tagName?.match(/INPUT|TEXTAREA/)) return;
        
        const selectedRow = listRows[selectedIndex];
        if (!selectedRow) return;
        
        e.preventDefault();
        if (selectedRow.type === 'stack') {
          toggleStackExpanded(selectedRow.stack.stackId);
        } else if (selectedRow.type === 'item') {
          toggleItemExpanded(selectedRow.item.id);
        }
        return;
      }
      
      // Delete key - Delete selected item (same as Cmd+Backspace)
      if (key === 'Delete' || key === 'Backspace') {
        // Skip if typing in input, unless Cmd/Ctrl is held
        if (document.activeElement?.tagName?.match(/INPUT|TEXTAREA/) && !hasMeta && !hasCtrl) return;
        
        // Only Delete key works without modifier, Backspace needs Cmd/Ctrl
        if (key === 'Backspace' && !hasMeta && !hasCtrl) return;
        
        e.preventDefault();
        const selectedRow = listRows[selectedIndex];
        (async () => {
          if (selectedRow?.type === 'item') {
            const item = await window.clipboardAPI?.getItem(selectedRow.item.id);
            if (item) {
              setDeletedItems([item]);
            }
            await window.clipboardAPI?.deleteItem(selectedRow.item.id);
            loadItems(true);
          } else if (selectedRow?.type === 'stack') {
            const itemsToDelete: ClipboardItem[] = [];
            for (const stackItem of selectedRow.items) {
              const item = await window.clipboardAPI?.getItem(stackItem.id);
              if (item) {
                itemsToDelete.push(item);
              }
            }
            setDeletedItems(itemsToDelete);
            for (const item of selectedRow.items) {
              await window.clipboardAPI?.deleteItem(item.id);
            }
            loadItems(true);
          }
        })();
        return;
      }

      // Cmd+Enter: Improve the selected item/stack
      if (key === 'Enter' && hasMeta && !hasShift && selectedIds.size === 0) {
        e.preventDefault();
        const selectedRow = listRows[selectedIndex];
        if (!selectedRow) return;
        
        // Check if item has text to improve
        let hasText = false;
        let stackId: string | null = null;
        let itemId: number | null = null;
        
        if (selectedRow.type === 'stack') {
          hasText = selectedRow.items.some(i => 
            (i.type === 'text' || i.type === 'transcript') && i.content
          );
          stackId = selectedRow.stack.stackId;
        } else if (selectedRow.type === 'item') {
          hasText = (selectedRow.item.type === 'text' || selectedRow.item.type === 'transcript') && !!selectedRow.item.content;
          itemId = selectedRow.item.id;
        }
        
        if (!hasText) return;
        
        // Trigger improve (simulate the button click logic)
        if (stackId) {
          // Improve stack - this is handled by the component, trigger via state
          setImprovingStackId(stackId);
          (async () => {
            try {
              const textItems = selectedRow.items.filter((i: ClipboardItem) => 
                (i.type === 'text' || i.type === 'transcript') && i.content
              );
              const tempStackId = crypto.randomUUID();
              const textItemIds = textItems.map((i: ClipboardItem) => i.id);
              await window.clipboardAPI?.updateStackId?.(textItemIds, tempStackId);
              const result = await window.clipboardAPI?.engineerStack?.(tempStackId);
              await window.clipboardAPI?.updateStackId?.(textItemIds, stackId);
              if (result?.success && result.refinedPrompt) {
                // Save improved content to the first text item in the stack for persistence.
                // The improved prompt is a combination of all items, so we store it on the first one.
                if (textItems.length > 0) {
                  await window.clipboardAPI?.saveImprovedContent?.(textItems[0].id, result.refinedPrompt);
                  // Update local state for immediate display.
                  setItems(prev => prev.map(i => 
                    i.id === textItems[0].id ? { ...i, improvedContent: result.refinedPrompt ?? null } : i
                  ));
                }
                setImproveResult({ stackId: stackId!, refinedPrompt: result.refinedPrompt });
                window.clipboardAPI?.incrementImprovedCount?.().then(count => {
                  setAllTimeStats(prev => ({ ...prev, improved: count }));
                });
              }
            } catch (err) {
              console.error('[Improve] Error:', err);
            } finally {
              setImprovingStackId(null);
            }
          })();
        } else if (itemId) {
          // Improve individual item
          setImprovingStackId(`item-${itemId}`);
          (async () => {
            try {
              const tempStackId = crypto.randomUUID();
              await window.clipboardAPI?.updateStackId?.([itemId!], tempStackId);
              const result = await window.clipboardAPI?.engineerStack?.(tempStackId);
              await window.clipboardAPI?.updateStackId?.([itemId!], selectedRow.item.stackId || null);
              if (result?.success && result.refinedPrompt) {
                // Save improved content to database for persistence.
                await window.clipboardAPI?.saveImprovedContent?.(itemId!, result.refinedPrompt);
                // Also update local state for immediate display.
                setImproveResult({ stackId: `item-${itemId}`, refinedPrompt: result.refinedPrompt });
                setItems(prev => prev.map(i => 
                  i.id === itemId ? { ...i, improvedContent: result.refinedPrompt ?? null } : i
                ));
                window.clipboardAPI?.incrementImprovedCount?.().then(count => {
                  setAllTimeStats(prev => ({ ...prev, improved: count }));
                });
              }
            } catch (err) {
              console.error('[Improve] Error:', err);
              await window.clipboardAPI?.updateStackId?.([itemId!], selectedRow.item.stackId || null);
            } finally {
              setImprovingStackId(null);
            }
          })();
        }
        return;
      }

      if (key === 'Enter' && !hasShift && !hasMeta) {
        // Get the target bundle ID if user selected a specific target.
        const targetBundleId = targetAppInfo.targetApp?.bundleId;
        
        if (selectedIds.size > 0) {
          // Paste multi-selected items
          window.clipboardAPI?.pasteStack(Array.from(selectedIds));
          window.clipboardAPI?.closeWindow();
          setSelectedIds(new Set());
          setIsMultiSelect(false);
        } else {
          // Check what type of row is selected
          const selectedRow = listRows[selectedIndex];
          if (selectedRow?.type === 'stack') {
            // If there's an improved version, paste that instead
            if (improveResult?.stackId === selectedRow.stack.stackId) {
              window.clipboardAPI?.pasteText?.(improveResult.refinedPrompt, targetBundleId);
            } else {
              // Paste all items in the stack
              const itemIds = selectedRow.items.map(i => i.id);
              window.clipboardAPI?.pasteStack(itemIds);
            }
            window.clipboardAPI?.closeWindow();
          } else if (selectedRow?.type === 'item') {
            // If there's an improved version, paste that instead
            if (improveResult?.stackId === `item-${selectedRow.item.id}`) {
              window.clipboardAPI?.pasteText?.(improveResult.refinedPrompt, targetBundleId);
            } else {
              // Paste single item to target app
              window.clipboardAPI?.pasteItem(selectedRow.item.id, targetBundleId);
            }
            window.clipboardAPI?.closeWindow();
          }
        }
        return;
      }

      if (key === 'Enter' && hasShift) {
        // Toggle multi-select mode
        setIsMultiSelect(true);
        const selectedRow = listRows[selectedIndex];
        if (selectedRow?.type === 'item') {
          setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(selectedRow.item.id)) {
              next.delete(selectedRow.item.id);
            } else {
              next.add(selectedRow.item.id);
            }
            return next;
          });
        } else if (selectedRow?.type === 'stack') {
          // For stacks, toggle all items in the stack
          const stackItemIds = selectedRow.items.map(i => i.id);
          setSelectedIds(prev => {
            const next = new Set(prev);
            const allSelected = stackItemIds.every(id => next.has(id));
            if (allSelected) {
              stackItemIds.forEach(id => next.delete(id));
            } else {
              stackItemIds.forEach(id => next.add(id));
            }
            return next;
          });
        }
        return;
      }

      // Cmd+Z: Undo deletion
      if (key === 'z' && hasMeta && !hasShift && deletedItems.length > 0) {
        e.preventDefault();
        // Restore deleted items
        (async () => {
          for (const item of deletedItems) {
            if (window.clipboardAPI?.restoreItem) {
            await window.clipboardAPI.restoreItem(item);
          }
          }
          // Clear undo buffer
          setDeletedItems([]);
          // Reload items to show restored items
          loadItems(true);
        })();
        return;
      }

      // Tab cycles through running apps (target app selection).
      // Works anywhere in the window.
      if (key === 'Tab' && !hasCtrl && !hasMeta && !hasAlt) {
        e.preventDefault();
        
        if (targetAppInfo.runningApps.length === 0) {
          return; // No apps to cycle through.
        }
        
        if (hasShift) {
          // Shift+Tab - go backwards through running apps.
          const prevIndex = (targetAppInfo.targetAppIndex - 1 + targetAppInfo.runningApps.length) % targetAppInfo.runningApps.length;
          const newApp = targetAppInfo.runningApps[prevIndex];
          setTargetAppInfo(prev => ({
            ...prev,
            targetApp: newApp,
            targetAppIndex: prevIndex,
          }));
          // Notify main process of the change.
          window.clipboardAPI?.setTargetApp(newApp);
        } else {
          // Tab - go forwards through running apps.
          const nextIndex = (targetAppInfo.targetAppIndex + 1) % targetAppInfo.runningApps.length;
          const newApp = targetAppInfo.runningApps[nextIndex];
          setTargetAppInfo(prev => ({
            ...prev,
            targetApp: newApp,
            targetAppIndex: nextIndex,
          }));
          // Notify main process of the change.
          window.clipboardAPI?.setTargetApp(newApp);
        }
        return;
      }
      
      // Escape key - close preview modal if open
      if (e.key === 'Escape' && preview) {
        e.preventDefault();
        dismissPreview();
        return;
      }
      
      // Spacebar - Quick Look style preview (images or text)
      if (e.key === ' ') {
        const activeElement = document.activeElement;
        const isTypingInInput = activeElement?.tagName === 'INPUT' || 
                                activeElement?.tagName === 'TEXTAREA' ||
                                (activeElement as HTMLElement)?.isContentEditable;
        
        // If typing in an input, let spacebar work normally
        if (isTypingInInput) {
          return;
        }
        
        // If preview is open, dismiss it
        if (preview) {
          e.preventDefault();
          dismissPreview();
          return;
        }
        
        // If hovering over an image, open preview for it
        if (hoveredImageId !== null) {
          e.preventDefault();
          const hoveredItem = items.find(item => item.id === hoveredImageId);
          if (hoveredItem?.imageData) {
            setPreview({
              type: 'image',
              data: hoveredItem.imageData,
              width: hoveredItem.imageWidth || 0,
              height: hoveredItem.imageHeight || 0,
            });
          }
          return;
        }
        
        // Preview J/K selected row (image or text)
        const selectedRow = listRows[selectedIndex];
        if (selectedRow) {
          e.preventDefault();
          
          if (selectedRow.type === 'item') {
            if (selectedRow.item.imageData) {
              setPreview({
                type: 'image',
                data: selectedRow.item.imageData,
                width: selectedRow.item.imageWidth || 0,
                height: selectedRow.item.imageHeight || 0,
              });
            } else if (selectedRow.item.content) {
              setPreview({ type: 'text', content: selectedRow.item.content });
            }
          } else if (selectedRow.type === 'stack') {
            // Check for image first, then text
            const imageItem = selectedRow.items.find(i => i.imageData);
            if (imageItem?.imageData) {
              setPreview({
                type: 'image',
                data: imageItem.imageData,
                width: imageItem.imageWidth || 0,
                height: imageItem.imageHeight || 0,
              });
            } else {
              // Combine text from stack
              const combinedText = selectedRow.items
                .filter(i => i.content)
                .map(i => i.content)
                .join('\n\n');
              if (combinedText) {
                setPreview({ type: 'text', content: combinedText });
              }
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
  }, [isVisible, items, selectedIndex, selectedIds, targetAppInfo, listRows, preview, hoveredImageId, dismissPreview]);

  // No automatic scrolling - user manually scrolls, keyboard only navigates visible items

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
      // Normal click: paste to target app
      const targetBundleId = targetAppInfo.targetApp?.bundleId;
      // If there's an improved version, paste that instead
      if (improveResult?.stackId === `item-${item.id}`) {
        window.clipboardAPI?.pasteText?.(improveResult.refinedPrompt, targetBundleId);
      } else {
        window.clipboardAPI?.pasteItem(item.id, targetBundleId);
      }
      window.clipboardAPI?.closeWindow();
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
    
    // Store in undo buffer
    setDeletedItems(itemsToDelete);
    
    // Delete all selected items
    for (const id of selectedIds) {
      await window.clipboardAPI?.deleteItem(id);
    }
    
    // Clear selection and reload
    setSelectedIds(new Set());
    setIsMultiSelect(false);
    setLastClickedIndex(null);
    loadItems(true);
  };

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
      `}</style>
      <div
        ref={dialogRef}
        style={{
          width: '100%',
          height: '100%',
          boxSizing: 'border-box',
          backgroundColor: theme.bg,  // Use theme background color.
          // Native window roundedCorners handles the border radius.
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          cursor: 'default',
        }}
      >
      {/* Draggable header area */}
      <div
        style={{
          height: '28px',
          minHeight: '28px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-start',
          paddingLeft: '72px', // Leave space for traffic lights
          paddingRight: '16px',
          // @ts-ignore - webkit vendor prefix for Electron draggable region
          WebkitAppRegion: 'drag',
          cursor: 'grab',
          // Native window roundedCorners handles the border radius.
        }}
      >
        <span style={{ 
          fontSize: '12px', 
          fontWeight: 600, 
          color: theme.textSecondary,
          letterSpacing: '0.5px',
          marginRight: 'auto',
        }}>
          Field Theory
        </span>
        
        {/* Mic Lock dropdown */}
        {!showSettings && audioDevices.length > 0 && (
          <div 
            style={{ 
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              // @ts-ignore - prevent drag on dropdown
              WebkitAppRegion: 'no-drag',
            }} 
            data-mic-dropdown
          >
            <span style={{ 
              fontSize: '10px', 
              color: theme.textSecondary,
              opacity: 0.7,
            }}>
              Mic Lock:
            </span>
            <button
              onClick={() => setShowMicDropdown(!showMicDropdown)}
              title="Priority Microphone"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '3px 8px',
                fontSize: '10px',
                color: theme.textSecondary,
                backgroundColor: 'transparent',
                border: `1px solid ${theme.border}`,
                borderRadius: '4px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                maxWidth: '140px',
                overflow: 'hidden',
              }}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                <line x1="12" y1="19" x2="12" y2="23"/>
                <line x1="8" y1="23" x2="16" y2="23"/>
              </svg>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {priorityDeviceId 
                  ? audioDevices.find(d => d.id === priorityDeviceId)?.name?.replace(/^(Built-in |MacBook )/, '') || 'Mic'
                  : 'System'}
              </span>
              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </button>
            
            {/* Dropdown menu */}
            {showMicDropdown && (
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
                {/* System Default option */}
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
                  <span style={{ marginLeft: !priorityDeviceId ? 0 : '16px' }}>System Default</span>
                </button>
                
                <div style={{ height: '1px', backgroundColor: theme.border, margin: '4px 0' }} />
                
                {/* Device list */}
                {audioDevices.map(device => (
                  <button
                    key={device.id}
                    onClick={() => {
                      window.audioAPI?.setPriorityDevice(device.id);
                      setShowMicDropdown(false);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      width: '100%',
                      padding: '6px 10px',
                      fontSize: '11px',
                      color: priorityDeviceId === device.id ? theme.accent : theme.text,
                      backgroundColor: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      textAlign: 'left',
                      overflow: 'hidden',
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
            )}
          </div>
        )}
      </div>
      
      {/* Conditionally show Settings, Todo View, or Clipboard History */}
      {showSettings ? (
        <SettingsPanel />
      ) : viewMode === 'todo' ? (
        <TodoView onSwitchToClipboard={() => setViewMode('clipboard')} />
      ) : (
        <div 
          style={{ 
            flex: 1, 
            display: 'flex', 
            flexDirection: 'column', 
            overflow: 'hidden', 
            padding: '0 16px 16px 16px',
          }}
        >
          {/* Search input with custom placeholder */}
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
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              placeholder=""
              style={{
                width: '100%',
                padding: `6px 10px 6px ${!searchQuery && !searchFocused ? '32px' : '10px'}`,
                border: `1px solid ${theme.inputBorder}`,
                borderRadius: '6px',
                fontSize: '11px',
                outline: 'none',
                boxSizing: 'border-box',
                backgroundColor: theme.inputBg,
                color: theme.text,
                transition: 'padding-left 0.1s ease',
                // @ts-ignore - prevent drag on input
                WebkitAppRegion: 'no-drag',
              }}
            />
            {/* Custom placeholder - hide when focused or has content */}
            {!searchQuery && !searchFocused && (
              <div style={{
                position: 'absolute',
                left: '10px',
                top: '50%',
                transform: 'translateY(-50%)',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                pointerEvents: 'none',
                color: theme.textSecondary,
                fontSize: '11px',
              }}>
                <span>search...</span>
              </div>
            )}
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
                  <KeyCap small>⌫</KeyCap> delete
                </button>
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
                    <KeyCap small>s</KeyCap> stack
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
                  <KeyCap small>esc</KeyCap> clear
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
          <div
            ref={listRef}
            style={{
              flex: 1,
              overflowY: 'auto',
              overflowX: 'hidden',
              minHeight: 0,
              borderRadius: '8px',
              border: `1px solid ${theme.border}`,
            }}
          >
        {listRows.length === 0 && !loading ? (
          <div
            style={{
              padding: '40px',
              textAlign: 'center',
              color: '#999',
            }}
          >
            No items found
          </div>
        ) : (
          listRows.map((row, index) => {
            if (row.type === 'stack') {
              // Render a prompt stack row
              const { stack, items: stackItems, expanded } = row;

              // Get images and text separately for rendering
              const stackImages = stackItems.filter(i => (i.type === 'image' || i.type === 'screenshot') && i.imageData);
              const combinedText = combineStackText(stackItems);
              const hasText = combinedText.length > 0;
              const targetAppName = targetAppInfo.targetApp?.name || 'app';
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
                      // Only highlight if the item is fully visible (prevents jumping)
                      const element = e.currentTarget;
                      const container = listRef.current;
                      if (container && isElementFullyVisible(element, container)) {
                        setSelectedIndex(index);
                      }
                    }}
                    onMouseLeave={() => setHoveredRowIndex(null)}
                    onClick={(e) => {
                      // dnd-kit handles drag vs click distinction via activation constraint.
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
                      
                      // Normal click: paste to target app
                      // If there's an improved version, paste that instead
                      if (improveResult?.stackId === stack.stackId) {
                        const targetBundleId = targetAppInfo.targetApp?.bundleId;
                        window.clipboardAPI?.pasteText?.(improveResult.refinedPrompt, targetBundleId);
                        window.clipboardAPI?.closeWindow();
                      } else {
                        // Paste all items in the stack
                        const itemIds = stackItems.map(i => i.id);
                        window.clipboardAPI?.pasteStack(itemIds);
                        window.clipboardAPI?.closeWindow();
                      }
                    }}
                    style={{
                      padding: '12px 16px',
                      backgroundColor: recentlyStackedId === stack.stackId
                        ? theme.isDark ? 'rgba(45, 212, 191, 0.2)' : 'rgba(20, 184, 166, 0.15)'
                        : stackItems.some(item => selectedIds.has(item.id)) 
                          ? theme.selectedBg 
                          : selectedIndex === index 
                            ? theme.bgSecondary 
                            : 'transparent',
                      // J/K highlight gets darker gray borders for definition
                      borderTop: selectedIndex === index ? `1px solid ${theme.isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)'}` : '1px solid transparent',
                      borderBottom: selectedIndex === index ? `1px solid ${theme.isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)'}` : `1px solid ${theme.border}`,
                      borderRight: selectedIndex === index ? `1px solid ${theme.isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)'}` : '1px solid transparent',
                      // J/K = bright teal (4px if over X-selected, else 2px), X-selection = muted teal 2px
                      borderLeft: recentlyStackedId === stack.stackId || selectedIndex === index
                        ? `${stackItems.some(item => selectedIds.has(item.id)) ? '4px' : '2px'} solid ${theme.isDark ? '#2dd4bf' : '#14b8a6'}`
                        : stackItems.some(item => selectedIds.has(item.id)) 
                          ? `2px solid ${theme.selectedBorder}` 
                          : '2px solid transparent',
                      boxShadow: selectedIndex === index
                        ? theme.isDark 
                          ? '0 2px 8px rgba(0,0,0,0.3)' 
                          : '0 2px 8px rgba(0,0,0,0.08)'
                        : 'none',
                      transition: 'background-color 0.3s ease, border-left 0.3s ease, box-shadow 0.3s ease',
                      cursor: activeDragId ? 'grabbing' : 'grab',
                      userSelect: 'none',
                    }}
                  >
                    {/* Content section - full width */}
                    <div>
                      {/* Inline image thumbnails - horizontal row */}
                      {stackImages.length > 0 && (
                        <div style={{ 
                          display: 'flex', 
                          gap: '8px', 
                          marginBottom: combinedText ? '8px' : '4px',
                          flexWrap: 'wrap',
                        }}>
                          {stackImages.map((item) => (
                            <div
                              key={item.id}
                              onMouseEnter={() => setHoveredImageId(item.id)}
                              onMouseLeave={() => setHoveredImageId(null)}
                              style={{ position: 'relative' }}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (item.imageData) {
                                  setPreview({
                                    type: 'image',
                                    data: item.imageData,
                                    width: item.imageWidth || 0,
                                    height: item.imageHeight || 0,
                                  });
                                }
                              }}
                            >
                              <img
                                src={`data:image/png;base64,${item.imageData}`}
                                alt="Screenshot preview"
                                style={{
                                  height: '50px',
                                  width: 'auto',
                                  borderRadius: '4px',
                                  border: '1px solid #e0e0e0',
                                  cursor: 'pointer',
                                }}
                              />
                              {/* Preview button overlay on hover - spacebar to open */}
                              {hoveredImageId === item.id && (
                                <div
                                  style={{
                                    position: 'absolute',
                                    top: '50%',
                                    left: '50%',
                                    transform: 'translate(-50%, -50%)',
                                    backgroundColor: 'rgba(0, 0, 0, 0.7)',
                                    color: '#fff',
                                    padding: '4px 8px',
                                    borderRadius: '4px',
                                    fontSize: '10px',
                                    fontWeight: 600,
                                    pointerEvents: 'none',
                                  }}
                                >
                                  Preview <KeyCap small>⎵</KeyCap>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Combined text - show improved if available and expanded */}
                      {combinedText && (() => {
                        // Use smart truncation to show beginning and end of text.
                        const displayText = expanded && improveResult?.stackId === stack.stackId 
                          ? improveResult.refinedPrompt 
                          : combinedText;
                        const truncated = smartTruncateText(displayText, 8);
                        const showSmartTruncation = !expanded && truncated.needsTruncation;
                        
                        if (expanded) {
                          // Expanded state: show full text.
                          return (
                            <div
                              style={{
                                fontSize: '12px',
                                fontWeight: '500',
                                color: theme.text,
                                lineHeight: '1.5',
                                marginBottom: '4px',
                                whiteSpace: 'pre-wrap',
                                overflow: 'visible',
                              }}
                            >
                              {displayText}
                            </div>
                          );
                        }
                        
                        if (showSmartTruncation) {
                          // Smart truncation: show first words ... [expand] ... last words.
                          return (
                            <div style={{ marginBottom: '4px' }}>
                              {/* First part */}
                              <span
                                style={{
                                  fontSize: '12px',
                                  fontWeight: '500',
                                  color: theme.text,
                                  lineHeight: '1.5',
                                }}
                              >
                                {truncated.firstPart}
                              </span>
                              <span style={{ color: theme.textSecondary, fontSize: '12px' }}> … </span>
                              
                              {/* Expand button in the middle */}
                              <button
                                tabIndex={-1}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleStackExpanded(stack.stackId);
                                }}
                                style={{
                                  background: theme.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)',
                                  border: 'none',
                                  padding: '2px 8px',
                                  fontSize: '10px',
                                  fontWeight: 500,
                                  color: theme.textSecondary,
                                  cursor: 'pointer',
                                  borderRadius: '4px',
                                  margin: '0 4px',
                                  verticalAlign: 'middle',
                                }}
                              >
                                {improveResult?.stackId === stack.stackId ? 'show improved' : 'expand'}
                              </button>
                              
                              <span style={{ color: theme.textSecondary, fontSize: '12px' }}> … </span>
                              {/* Last part */}
                              <span
                                style={{
                                  fontSize: '12px',
                                  fontWeight: '500',
                                  color: theme.text,
                                  lineHeight: '1.5',
                                }}
                              >
                                {truncated.lastPart}
                              </span>
                              
                              {/* Improved badge inline */}
                              {improveResult?.stackId === stack.stackId && (
                                <span style={{
                                  display: 'inline-block',
                                  fontSize: '9px',
                                  fontWeight: 600,
                                  color: '#34C759',
                                  backgroundColor: '#e8f5e9',
                                  padding: '2px 6px',
                                  borderRadius: '3px',
                                  marginLeft: '8px',
                                  verticalAlign: 'middle',
                                }}>
                                  ✨ improved
                                </span>
                              )}
                            </div>
                          );
                        }
                        
                        // Short text that doesn't need truncation: show full text.
                        return (
                          <div
                            ref={checkTextOverflow(stack.stackId)}
                            style={{
                              fontSize: '12px',
                              fontWeight: '500',
                              color: theme.text,
                              lineHeight: '1.5',
                              marginBottom: '4px',
                              display: '-webkit-box',
                              WebkitLineClamp: 3,
                              WebkitBoxOrient: 'vertical' as const,
                              overflow: 'hidden',
                            }}
                          >
                            {displayText}
                          </div>
                        );
                      })()}
                      
                      {/* Improved badge - shown for short text that doesn't use smart truncation */}
                      {combinedText && !smartTruncateText(combinedText, 8).needsTruncation && improveResult?.stackId === stack.stackId && !expanded && (
                        <span style={{
                          display: 'inline-block',
                          fontSize: '9px',
                          fontWeight: 600,
                          color: '#34C759',
                          backgroundColor: '#e8f5e9',
                          padding: '2px 6px',
                          borderRadius: '3px',
                          marginBottom: '4px',
                        }}>
                          ✨ Improved version available
                        </span>
                      )}
                      
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
                            marginTop: '4px',
                            fontSize: '10px',
                            color: '#888',
                            cursor: 'pointer',
                          }}
                        >
                          Show less
                        </button>
                      )}
                    </div>

                    {/* Footer row - metadata left, buttons right (buttons always reserve space) */}
                    <div style={{ 
                      display: 'flex', 
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginTop: '4px',
                    }}>
                      {/* Metadata - left side with stack icon */}
                      <div style={{ fontSize: '10px', color: improveResult?.stackId === stack.stackId ? '#34C759' : '#FBBF24', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        {/* Stack icon - layered rectangles */}
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="4" y="4" width="16" height="6" rx="1" />
                          <rect x="4" y="14" width="16" height="6" rx="1" />
                        </svg>
                        <span>{stackItems.length} items • {formatRelativeTime(stack.createdAt)}{improveResult?.stackId === stack.stackId ? ' • ✨ improved' : ''}</span>
                      </div>

                      {/* Buttons - right side (show on J/K focus or mouse hover) */}
                      <div style={{ 
                        display: 'flex', 
                        gap: '4px',
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
                            <KeyCap>u</KeyCap> unstack
                          </button>
                        )}
                        {/* Improve hint button - middle, only if stack has text */}
                        {hasText && (
                          <button
                            tabIndex={-1}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={async (e) => {
                              e.stopPropagation();
                              setImprovingStackId(stack.stackId);
                              setImproveResult(null);
                              try {
                                const textItems = stackItems.filter(i => 
                                  (i.type === 'text' || i.type === 'transcript') && i.content
                                );
                                if (textItems.length === 0) {
                                  return;
                                }
                                const tempStackId = crypto.randomUUID();
                                const textItemIds = textItems.map(i => i.id);
                                await window.clipboardAPI?.updateStackId?.(textItemIds, tempStackId);
                                const result = await window.clipboardAPI?.engineerStack?.(tempStackId);
                                await window.clipboardAPI?.updateStackId?.(textItemIds, stack.stackId);
                                if (result?.success && result.refinedPrompt) {
                                  // Save improved content to the first text item in the stack for persistence.
                                  // The improved prompt is a combination of all items, so we store it on the first one.
                                  if (textItems.length > 0) {
                                    await window.clipboardAPI?.saveImprovedContent?.(textItems[0].id, result.refinedPrompt);
                                    // Update local state for immediate display.
                                    setItems(prev => prev.map(i => 
                                      i.id === textItems[0].id ? { ...i, improvedContent: result.refinedPrompt ?? null } : i
                                    ));
                                  }
                                  setImproveResult({
                                    stackId: stack.stackId,
                                    refinedPrompt: result.refinedPrompt,
                                  });
                                  window.clipboardAPI?.incrementImprovedCount?.().then(count => {
                                    setAllTimeStats(prev => ({ ...prev, improved: count }));
                                  });
                                }
                              } catch (err) {
                                console.error('[Improve] Error:', err);
                              } finally {
                                setImprovingStackId(null);
                              }
                            }}
                            disabled={improvingStackId === stack.stackId}
                            style={{
                              padding: '4px 6px',
                              fontSize: '10px',
                              fontWeight: 500,
                              backgroundColor: 'transparent',
                              color: theme.textSecondary,
                              border: 'none',
                              borderRadius: '4px',
                              cursor: improvingStackId === stack.stackId ? 'wait' : 'pointer',
                              transition: 'background-color 0.15s ease',
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = theme.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)'}
                            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                          >
                            <KeyCap>⌘</KeyCap><KeyCap>↵</KeyCap> {improvingStackId === stack.stackId ? 'improving...' : 'improve'}
                          </button>
                        )}
                        {/* Paste hint button - rightmost */}
                        <button
                          tabIndex={-1}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={(e) => {
                            e.stopPropagation();
                            // Paste stack content
                            if (improveResult?.stackId === stack.stackId) {
                              const targetBundleId = targetAppInfo.targetApp?.bundleId;
                              window.clipboardAPI?.pasteText?.(improveResult.refinedPrompt, targetBundleId);
                              window.clipboardAPI?.closeWindow();
                            } else {
                              const itemIds = stackItems.map(i => i.id);
                              window.clipboardAPI?.pasteStack(itemIds);
                              window.clipboardAPI?.closeWindow();
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
                          <KeyCap>↵</KeyCap> paste ({targetAppName})
                        </button>
                      </div>
                    </div>
                  </DraggableDroppableRow>

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
                      // Only highlight if the item is fully visible (prevents jumping)
                      const element = e.currentTarget;
                      const container = listRef.current;
                      if (container && isElementFullyVisible(element, container)) {
                        setSelectedIndex(index);
                      }
                    }}
                    onMouseLeave={() => setHoveredRowIndex(null)}
                    onClick={(e) => {
                      // dnd-kit handles drag vs click distinction via activation constraint.
                      handleItemClick(item, index, e);
                    }}
                    style={{
                      padding: '12px 16px',
                      backgroundColor: isInStack ? theme.selectedBg : isRowSelected ? theme.bgSecondary : 'transparent',
                      // J/K highlight gets darker gray borders for definition
                      borderTop: isRowSelected ? `1px solid ${theme.isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)'}` : '1px solid transparent',
                      borderBottom: isRowSelected ? `1px solid ${theme.isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)'}` : `1px solid ${theme.border}`,
                      borderRight: isRowSelected ? `1px solid ${theme.isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)'}` : '1px solid transparent',
                      // J/K = bright teal (4px if over X-selected, else 2px), X-selection = muted teal 2px
                      borderLeft: isRowSelected
                        ? `${isInStack ? '4px' : '2px'} solid ${theme.isDark ? '#2dd4bf' : '#14b8a6'}`
                        : isInStack 
                          ? `2px solid ${theme.selectedBorder}` 
                          : '2px solid transparent',
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
                    }}
                  >
                  {/* Content section - full width */}
                  <div>
                    {item.type === 'text' || item.type === 'transcript' ? (
                      <>
                        {(() => {
                          // Use smart truncation to show beginning and end of text.
                          const displayText = itemExpanded && improveResult?.stackId === `item-${item.id}`
                            ? improveResult.refinedPrompt
                            : item.content || 'Empty';
                          const truncated = smartTruncateText(displayText, 8);
                          const showSmartTruncation = !itemExpanded && truncated.needsTruncation;
                          const colorValue = detectColor(item.content);
                          
                          if (itemExpanded) {
                            // Expanded state: show full text with color preview.
                            return (
                              <div
                                style={{
                                  fontSize: '12px',
                                  fontWeight: '500',
                                  marginBottom: '4px',
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
                                      border: '1px solid #e0e0e0',
                                      flexShrink: 0,
                                      marginTop: '1px',
                                    }}
                                    title={colorValue}
                                  />
                                )}
                                <span style={{ flex: 1, wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
                                  {displayText}
                                </span>
                              </div>
                            );
                          }
                          
                          if (showSmartTruncation) {
                            // Smart truncation: show first words ... [expand] ... last words.
                            return (
                              <div style={{ marginBottom: '4px' }}>
                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                                  {colorValue && (
                                    <div
                                      style={{
                                        width: '20px',
                                        height: '20px',
                                        borderRadius: '4px',
                                        backgroundColor: colorValue,
                                        border: '1px solid #e0e0e0',
                                        flexShrink: 0,
                                        marginTop: '1px',
                                      }}
                                      title={colorValue}
                                    />
                                  )}
                                  <span style={{ flex: 1 }}>
                                    {/* First part */}
                                    <span
                                      style={{
                                        fontSize: '12px',
                                        fontWeight: '500',
                                        color: theme.text,
                                        lineHeight: '1.5',
                                      }}
                                    >
                                      {truncated.firstPart}
                                    </span>
                                    <span style={{ color: theme.textSecondary, fontSize: '12px' }}> … </span>
                                    
                                    {/* Expand button in the middle */}
                                    <button
                                      tabIndex={-1}
                                      onMouseDown={(e) => e.preventDefault()}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        toggleItemExpanded(item.id);
                                      }}
                                      style={{
                                        background: theme.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)',
                                        border: 'none',
                                        padding: '2px 8px',
                                        fontSize: '10px',
                                        fontWeight: 500,
                                        color: theme.textSecondary,
                                        cursor: 'pointer',
                                        borderRadius: '4px',
                                        margin: '0 4px',
                                        verticalAlign: 'middle',
                                      }}
                                    >
                                      {improveResult?.stackId === `item-${item.id}` ? 'show improved' : 'expand'}
                                    </button>
                                    
                                    <span style={{ color: theme.textSecondary, fontSize: '12px' }}> … </span>
                                    {/* Last part */}
                                    <span
                                      style={{
                                        fontSize: '12px',
                                        fontWeight: '500',
                                        color: theme.text,
                                        lineHeight: '1.5',
                                      }}
                                    >
                                      {truncated.lastPart}
                                    </span>
                                    
                                    {/* Improved badge inline */}
                                    {improveResult?.stackId === `item-${item.id}` && (
                                      <span style={{
                                        display: 'inline-block',
                                        fontSize: '9px',
                                        fontWeight: 600,
                                        color: '#34C759',
                                        backgroundColor: '#e8f5e9',
                                        padding: '2px 6px',
                                        borderRadius: '3px',
                                        marginLeft: '8px',
                                        verticalAlign: 'middle',
                                      }}>
                                        ✨ improved
                                      </span>
                                    )}
                                  </span>
                                </div>
                              </div>
                            );
                          }
                          
                          // Short text that doesn't need truncation: show full text with line clamp.
                          return (
                            <div
                              style={{
                                fontSize: '12px',
                                fontWeight: '500',
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
                                    border: '1px solid #e0e0e0',
                                    flexShrink: 0,
                                    marginTop: '1px',
                                  }}
                                  title={detectColor(item.content) || ''}
                                />
                              )}
                              <span
                                ref={itemExpanded ? undefined : checkTextOverflow(itemTextId)}
                                style={{
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
                                {/* Show improved content by default if available and not viewing original.
                                    Priority: 1) viewOriginalIds override 2) transient improveResult 3) stored improvedContent 4) original content */}
                                {viewOriginalIds.has(`item-${item.id}`)
                                  ? item.content || 'Empty'
                                  : (improveResult?.stackId === `item-${item.id}` 
                                      ? improveResult.refinedPrompt 
                                      : (item.improvedContent || item.content || 'Empty'))}
                              </span>
                            </div>
                          );
                        })()}
                        
                        {/* Improved badge and toggle - shown when there's improved content */}
                        {(item.improvedContent || improveResult?.stackId === `item-${item.id}`) && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                            <span style={{
                              display: 'inline-block',
                              fontSize: '9px',
                              fontWeight: 600,
                              color: '#34C759',
                              backgroundColor: '#e8f5e9',
                              padding: '2px 6px',
                              borderRadius: '3px',
                            }}>
                              ✨ {viewOriginalIds.has(`item-${item.id}`) ? 'Viewing original' : 'Improved'}
                            </span>
                            <button
                              tabIndex={-1}
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={(e) => {
                                e.stopPropagation();
                                setViewOriginalIds(prev => {
                                  const next = new Set(prev);
                                  if (next.has(`item-${item.id}`)) {
                                    next.delete(`item-${item.id}`);
                                  } else {
                                    next.add(`item-${item.id}`);
                                  }
                                  return next;
                                });
                              }}
                              style={{
                                background: 'none',
                                border: 'none',
                                padding: 0,
                                fontSize: '9px',
                                color: '#3b82f6',
                                cursor: 'pointer',
                                textDecoration: 'underline',
                              }}
                            >
                              {viewOriginalIds.has(`item-${item.id}`) ? 'Show improved' : 'Show original'}
                            </button>
                          </div>
                        )}
                        
                        {/* Show more/less button - only when text is actually truncated or has improved result */}
                        {(itemTextIsOverflowing || itemExpanded || item.improvedContent || improveResult?.stackId === `item-${item.id}`) && (
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
                              marginTop: '4px',
                              marginBottom: '4px',
                              fontSize: '10px',
                              color: '#888',
                              cursor: 'pointer',
                            }}
                          >
                            {itemExpanded ? 'Show less' : 'Show more'}
                          </button>
                        )}
                      </>
                    ) : (
                      <>
                        {/* Screenshot thumbnail with preview */}
                        <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                          {item.imageData && (
                            <div
                              style={{ position: 'relative', flexShrink: 0 }}
                              onMouseEnter={() => setHoveredImageId(item.id)}
                              onMouseLeave={() => setHoveredImageId(null)}
                              onClick={(e) => {
                                e.stopPropagation();
                                setPreview({
                                  type: 'image',
                                  data: item.imageData!,
                                  width: item.imageWidth || 0,
                                  height: item.imageHeight || 0,
                                });
                              }}
                            >
                              <img
                                src={`data:image/png;base64,${item.imageData}`}
                                alt="Screenshot preview"
                                style={{
                                  height: '50px',
                                  width: 'auto',
                                  borderRadius: '4px',
                                  border: `1px solid ${theme.border}`,
                                  cursor: 'pointer',
                                }}
                              />
                              {/* Preview button overlay on hover - spacebar to open */}
                              {hoveredImageId === item.id && (
                                <div
                                  style={{
                                    position: 'absolute',
                                    inset: 0,
                                    backgroundColor: 'rgba(0,0,0,0.5)',
                                    borderRadius: '4px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    cursor: 'pointer',
                                  }}
                                >
                                  <span style={{ color: '#fff', fontSize: '10px', fontWeight: 500 }}>
                                    Preview <KeyCap small>⎵</KeyCap>
                                  </span>
                                </div>
                              )}
                            </div>
                          )}
                          <div style={{ flex: 1 }}>
                            <div
                              style={{
                                fontSize: '12px',
                                fontWeight: '500',
                              }}
                            >
                              Screenshot
                            </div>
                          </div>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Footer row - metadata left, buttons right (buttons always reserve space) */}
                  <div style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginTop: '4px',
                  }}>
                    {/* Metadata - left side */}
                    <div
                      style={{
                        fontSize: '10px',
                        color: '#666',
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
                            backgroundColor: '#007AFF',
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
                            {item.wordCount && item.charCount
                              ? `${item.wordCount} words, ${item.charCount} chars`
                              : ''}
                            {item.sourceAppName && ` • ${item.sourceAppName}`}
                            {' • '}
                            {formatRelativeTime(item.createdAt)}
                            {improveResult?.stackId === `item-${item.id}` && (
                              <span style={{ color: '#34C759', marginLeft: '4px' }}>• ✨ improved</span>
                            )}
                          </>
                        ) : (
                          <>
                            {item.imageWidth && item.imageHeight
                              ? `${item.imageWidth}×${item.imageHeight}`
                              : ''}
                            {item.imageSize && ` • ${formatFileSize(item.imageSize)}`}
                            {item.sourceAppName && ` • ${item.sourceAppName}`}
                            {' • '}
                            {formatRelativeTime(item.createdAt)}
                          </>
                        )}
                      </span>
                    </div>

                    {/* Buttons - right side (show on J/K focus or mouse hover) */}
                    <div style={{ 
                      display: 'flex', 
                      gap: '4px',
                      visibility: isRowSelected || hoveredRowIndex === index ? 'visible' : 'hidden',
                    }}>
                      {/* Improve hint button - only if item has text */}
                      {hasText && (
                        <button
                          tabIndex={-1}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={async (e) => {
                            e.stopPropagation();
                            
                            // Check if already improved and show confirmation.
                            const hasExistingImproved = item.improvedContent || improveResult?.stackId === `item-${item.id}`;
                            if (hasExistingImproved) {
                              setConfirmReimproveModal({
                                itemId: `item-${item.id}`,
                                type: viewOriginalIds.has(`item-${item.id}`) ? 'original' : 'improved'
                              });
                              return;
                            }
                            
                            const tempStackId = crypto.randomUUID();
                            await window.clipboardAPI?.updateStackId?.([item.id], tempStackId);
                            setImprovingStackId(`item-${item.id}`);
                            setImproveResult(null);
                            try {
                              const result = await window.clipboardAPI?.engineerStack?.(tempStackId);
                              await window.clipboardAPI?.updateStackId?.([item.id], item.stackId || null);
                              if (result?.success && result.refinedPrompt) {
                                // Save improved content to database for persistence.
                                await window.clipboardAPI?.saveImprovedContent?.(item.id, result.refinedPrompt);
                                // Also update local state for immediate display.
                                setImproveResult({
                                  stackId: `item-${item.id}`,
                                  refinedPrompt: result.refinedPrompt,
                                });
                                // Update the item in our local list to reflect the improvement.
                                setItems(prev => prev.map(i => 
                                  i.id === item.id ? { ...i, improvedContent: result.refinedPrompt ?? null } : i
                                ));
                                window.clipboardAPI?.incrementImprovedCount?.().then(count => {
                                  setAllTimeStats(prev => ({ ...prev, improved: count }));
                                });
                              }
                            } catch (err) {
                              await window.clipboardAPI?.updateStackId?.([item.id], item.stackId || null);
                            } finally {
                              setImprovingStackId(null);
                            }
                          }}
                          disabled={improvingStackId === `item-${item.id}`}
                          style={{
                            padding: '4px 6px',
                            fontSize: '10px',
                            fontWeight: 500,
                            backgroundColor: 'transparent',
                            color: theme.textSecondary,
                            border: 'none',
                            borderRadius: '4px',
                            cursor: improvingStackId === `item-${item.id}` ? 'wait' : 'pointer',
                            transition: 'background-color 0.15s ease',
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = theme.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)'}
                          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                        >
                          <KeyCap>⌘</KeyCap><KeyCap>↵</KeyCap> {improvingStackId === `item-${item.id}` ? 'improving...' : (item.improvedContent ? 're-improve' : 'improve')}
                        </button>
                      )}
                      {/* Paste hint button with target app - rightmost */}
                      <button
                        tabIndex={-1}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleItemClick(item, index, e as unknown as React.MouseEvent);
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
                        <KeyCap>↵</KeyCap> paste ({targetAppInfo.targetApp?.name || 'app'})
                      </button>
                    </div>
                  </div>
                  </DraggableDroppableRow>
                </div>
              );
            }
          })
        )}
        
        {/* Load more */}
        {hasMore && listRows.length > 0 && (
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
        )}
        </div>

        {/* Drag overlay - shows ghost element while dragging */}
        <DragOverlay>
          {activeDragId ? (
            <div
              style={{
                padding: '6px 10px',
                backgroundColor: theme.bgSecondary,
                border: `1px solid ${theme.border}`,
                borderRadius: '6px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                fontSize: '12px',
                color: theme.text,
                opacity: 0.9,
              }}
            >
              {activeDragId.startsWith('stack:') ? 'Stack' : 'Item'}
            </div>
          ) : null}
        </DragOverlay>
        </DndContext>
        </div>
      )}
      
      {/* Footer - three-column layout: left=stats, center=recording, right=controls */}
      <div
        style={{
          padding: '8px 16px',
          borderTop: `1px solid ${theme.border}`,
          backgroundColor: theme.bgSecondary,
          backdropFilter: theme.isDark && theme.glassEnabled ? 'blur(10px)' : 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '11px',
          color: theme.textSecondary,
          userSelect: 'none',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        }}
      >
        {/* Left side: Update notification OR Version + Stats */}
        {!showSettings ? (
          updateStatus !== 'idle' ? (
            // Update notification (replaces version + stats)
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1 }}>
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
                <span style={{ fontSize: '10px', color: theme.text }}>
                  {updateStatus === 'downloading' ? 'Downloading...' : updateStatus === 'ready' ? 'New update ready' : 'New update available'}
                </span>
                {/* Shimmer overlay - always show during update sequence */}
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
              {updateStatus !== 'downloading' && (
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
                        window.updaterAPI?.installUpdate();
                      } else {
                        window.updaterAPI?.downloadUpdate();
                      }
                    }}
                    style={{
                      padding: '2px 6px',
                      fontSize: '9px',
                      color: theme.text,
                      backgroundColor: theme.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)',
                      border: `1px solid ${theme.border}`,
                      borderRadius: '4px',
                      cursor: 'pointer',
                    }}
                  >
                    {updateStatus === 'ready' ? 'Install and restart' : 'Update'}
                  </button>
                </>
              )}
            </div>
          ) : (
            // Version + Stats (both visible when no update)
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '9px',
                color: theme.textSecondary,
                userSelect: 'none',
                flex: 1,
              }}
            >
              <span>v{appVersion}</span>
              {statItems.length > 0 && (
                <>
                  <span style={{ opacity: 0.4 }}>·</span>
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
                  <span 
                    onClick={nextInterval}
                    style={{ fontSize: '10px', cursor: 'pointer' }}
                  >
                    ({timeIntervals[currentIntervalIndex]})
                  </span>
                </>
              )}
            </div>
          )
        ) : (
          <div style={{ flex: 1 }} />
        )}

        {/* Center: Recording state indicator with tooltip */}
        <div 
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', position: 'relative' }}
          onMouseEnter={() => isRecording && setShowRecordingTooltip(true)}
          onMouseLeave={() => setShowRecordingTooltip(false)}
        >
          {isRecording && (
            <>
              <span
                style={{
                  width: '6px',
                  height: '6px',
                  backgroundColor: '#ef4444',
                  borderRadius: '50%',
                  animation: 'pulse 1.5s ease-in-out infinite',
                }}
              />
              <span style={{ fontSize: '9px', fontWeight: 500, color: '#ef4444', cursor: 'help' }}>Recording</span>
              {/* Tooltip explaining escape behavior */}
              {showRecordingTooltip && (
                <div
                  style={{
                    position: 'absolute',
                    bottom: '100%',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    marginBottom: '8px',
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
                      top: '100%',
                      left: '50%',
                      transform: 'translateX(-50%)',
                      width: 0,
                      height: 0,
                      borderLeft: '6px solid transparent',
                      borderRight: '6px solid transparent',
                      borderTop: '6px solid #1a1a1a',
                    }}
                  />
                </div>
              )}
            </>
          )}
        </div>

        {/* Right side: target app info and controls */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '10px', fontSize: '9px', flex: 1 }}>
          {!showSettings && (
            <span style={{ color: theme.textSecondary, opacity: 0.7, display: 'flex', alignItems: 'center', gap: '4px' }}>
              <KeyCap small>tab</KeyCap> to switch target ({targetAppInfo.targetApp?.name || 'app'})
            </span>
          )}
          
          {/* Dark mode toggle */}
          <button
            onClick={toggleDarkMode}
            title={theme.isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            style={{
              width: '20px',
              height: '20px',
              padding: 0,
              backgroundColor: 'transparent',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'opacity 0.15s ease',
            }}
            onMouseEnter={(e) => e.currentTarget.style.opacity = '0.7'}
            onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
          >
            {theme.isDark ? (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={theme.textSecondary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5"/>
                <line x1="12" y1="1" x2="12" y2="3"/>
                <line x1="12" y1="21" x2="12" y2="23"/>
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
                <line x1="1" y1="12" x2="3" y2="12"/>
                <line x1="21" y1="12" x2="23" y2="12"/>
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
              </svg>
            ) : (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={theme.textSecondary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
              </svg>
            )}
          </button>
          
          {/* Settings toggle button */}
          <button
            onClick={() => setShowSettings(!showSettings)}
            title={showSettings ? 'Back to Clipboard' : 'Settings'}
            style={{
              width: '20px',
              height: '20px',
              padding: 0,
              backgroundColor: showSettings ? theme.accent : 'transparent',
              border: showSettings ? 'none' : `1px solid ${theme.border}`,
              borderRadius: '4px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.15s ease',
            }}
          >
            {showSettings ? (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round">
                <path d="M18 6L6 18" />
                <path d="M6 6l12 12" />
              </svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={theme.textSecondary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            )}
          </button>
        </div>
      </div>
      
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
            {/* Two column grid of shortcuts */}
            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: 'auto auto', 
              gap: '10px 32px',
              fontSize: '13px',
              color: theme.textSecondary,
            }}>
              <span><KeyCap>esc</KeyCap> close</span>
              <span><KeyCap>⌫</KeyCap> delete</span>
              
              <span><KeyCap>↓</KeyCap><KeyCap>j</KeyCap> down</span>
              <span><KeyCap>?</KeyCap> help</span>
              
              <span><KeyCap>⌘</KeyCap><KeyCap>↵</KeyCap> improve</span>
              <span><KeyCap>↵</KeyCap> paste</span>
              
              <span><KeyCap>⎵</KeyCap> preview</span>
              <span><KeyCap>⌥</KeyCap><KeyCap>␣</KeyCap> record audio</span>
              
              <span><KeyCap>x</KeyCap> select</span>
              <span><KeyCap>⌥</KeyCap><KeyCap>1</KeyCap> screenshot</span>
              
              <span><KeyCap>/</KeyCap> search</span>
              <span><KeyCap>s</KeyCap> stack</span>
              
              <span><KeyCap>tab</KeyCap> target</span>
              <span><KeyCap>⌘</KeyCap><KeyCap>z</KeyCap> undo</span>
              
              <span><KeyCap>u</KeyCap> unstack</span>
              <span><KeyCap>↑</KeyCap><KeyCap>k</KeyCap> up</span>
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
            <img
              src={`data:image/png;base64,${preview.data}`}
              alt="Preview"
              onClick={(e) => e.stopPropagation()}
              style={{
                maxWidth: '90vw',
                maxHeight: '90vh',
                objectFit: 'contain',
                borderRadius: '8px',
                boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
                cursor: 'default',
              }}
            />
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
        </div>
      )}

      {/* Confirmation modal for re-improving already improved content */}
      {confirmReimproveModal && (
        <div
          onClick={() => setConfirmReimproveModal(null)}
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
              borderRadius: '12px',
              padding: '20px 24px',
              maxWidth: '400px',
              boxShadow: '0 20px 40px rgba(0, 0, 0, 0.3)',
              border: `1px solid ${theme.border}`,
            }}
          >
            <h3 style={{ 
              margin: '0 0 12px 0', 
              fontSize: '16px', 
              fontWeight: 600,
              color: theme.text,
            }}>
              Re-improve this content?
            </h3>
            <p style={{ 
              margin: '0 0 16px 0', 
              fontSize: '13px', 
              color: theme.textSecondary,
              lineHeight: 1.5,
            }}>
              This content has already been improved. Do you want to run improvement again?
              You can choose to improve the original transcription or the current improved version.
            </p>
            <div style={{ 
              display: 'flex', 
              gap: '8px',
              justifyContent: 'flex-end',
            }}>
              <button
                onClick={() => setConfirmReimproveModal(null)}
                style={{
                  padding: '8px 16px',
                  fontSize: '13px',
                  fontWeight: 500,
                  color: theme.textSecondary,
                  backgroundColor: theme.bgSecondary,
                  border: `1px solid ${theme.border}`,
                  borderRadius: '6px',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  // Get the item ID from the modal state
                  const itemIdMatch = confirmReimproveModal.itemId.match(/item-(\d+)/);
                  if (!itemIdMatch) {
                    setConfirmReimproveModal(null);
                    return;
                  }
                  const itemId = parseInt(itemIdMatch[1], 10);
                  const item = items.find(i => i.id === itemId);
                  if (!item) {
                    setConfirmReimproveModal(null);
                    return;
                  }
                  
                  setConfirmReimproveModal(null);
                  
                  // Proceed with improvement
                  const tempStackId = crypto.randomUUID();
                  await window.clipboardAPI?.updateStackId?.([itemId], tempStackId);
                  setImprovingStackId(`item-${itemId}`);
                  setImproveResult(null);
                  
                  try {
                    const result = await window.clipboardAPI?.engineerStack?.(tempStackId);
                    await window.clipboardAPI?.updateStackId?.([itemId], item.stackId || null);
                    if (result?.success && result.refinedPrompt) {
                      await window.clipboardAPI?.saveImprovedContent?.(itemId, result.refinedPrompt);
                      setImproveResult({
                        stackId: `item-${itemId}`,
                        refinedPrompt: result.refinedPrompt,
                      });
                      setItems(prev => prev.map(i => 
                        i.id === itemId ? { ...i, improvedContent: result.refinedPrompt ?? null } : i
                      ));
                      // Clear viewOriginalIds so the new improved version is shown
                      setViewOriginalIds(prev => {
                        const next = new Set(prev);
                        next.delete(`item-${itemId}`);
                        return next;
                      });
                      window.clipboardAPI?.incrementImprovedCount?.().then(count => {
                        setAllTimeStats(prev => ({ ...prev, improved: count }));
                      });
                    }
                  } catch (err) {
                    await window.clipboardAPI?.updateStackId?.([itemId], item.stackId || null);
                  } finally {
                    setImprovingStackId(null);
                  }
                }}
                style={{
                  padding: '8px 16px',
                  fontSize: '13px',
                  fontWeight: 500,
                  color: '#fff',
                  backgroundColor: '#3b82f6',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                }}
              >
                Re-improve
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </>
  );
}

