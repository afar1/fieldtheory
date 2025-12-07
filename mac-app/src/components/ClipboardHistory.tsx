// =============================================================================
// ClipboardHistory - Alfred-style clipboard history popup.
// Shows local clipboard history with fuzzy search and multi-select.
// =============================================================================

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import SettingsPanel from './SettingsPanel';
import { useTheme } from '../contexts/ThemeContext';

type ClipboardItemType = 'text' | 'image' | 'transcript' | 'screenshot';
type ClipboardSource = 'mac' | 'ios';

type ClipboardItem = {
  id: number;
  type: ClipboardItemType;
  content: string | null;
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
 * Truncate text preview.
 */
function truncateText(text: string, maxLength: number = 100): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
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
 * Get the last N words from a text string.
 * Used to show a preview of the ending when text is truncated.
 */
function getLastWords(text: string, wordCount: number = 8): string {
  const words = text.trim().split(/\s+/);
  if (words.length <= wordCount) return '';
  return words.slice(-wordCount).join(' ');
}

/**
 * Create a truncated preview with beginning and ending.
 * Format: "[first ~200 chars]... ...[last 8 words]"
 * Returns null if text doesn't need truncation.
 */
function createTruncatedPreview(text: string, maxChars: number = 200): string | null {
  if (!text || text.length <= maxChars) return null;
  
  const lastWords = getLastWords(text, 8);
  if (!lastWords) return null;
  
  // Calculate how much space we need for the ending
  const endingPart = `... ...${lastWords}`;
  const availableForStart = maxChars - endingPart.length;
  
  if (availableForStart < 50) {
    // Not enough room, just show truncated start
    return text.slice(0, maxChars) + '...';
  }
  
  // Find a good break point (word boundary) near the limit
  let breakPoint = availableForStart;
  while (breakPoint > 0 && text[breakPoint] !== ' ') {
    breakPoint--;
  }
  if (breakPoint < availableForStart * 0.7) {
    // Couldn't find a good break, just cut at limit
    breakPoint = availableForStart;
  }
  
  const startPart = text.slice(0, breakPoint).trim();
  return `${startPart}... ...${lastWords}`;
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
  const [items, setItems] = useState<ClipboardItem[]>([]);
  const [stacks, setStacks] = useState<StackInfo[]>([]);
  const [expandedStacks, setExpandedStacks] = useState<Set<string>>(new Set());
  const [expandedItems, setExpandedItems] = useState<Set<number>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
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
  
  // Hover states for UI interactions
  const [hoveredImageId, setHoveredImageId] = useState<number | null>(null);
  const [previewImage, setPreviewImage] = useState<{data: string, width: number, height: number} | null>(null);
  const [previewClosing, setPreviewClosing] = useState(false);
  
  // Helper to dismiss preview with scale-down animation
  const dismissPreview = () => {
    if (!previewImage || previewClosing) return;
    setPreviewClosing(true);
    // Wait for animation to complete before removing
    setTimeout(() => {
      setPreviewImage(null);
      setPreviewClosing(false);
    }, 150); // Match animation duration
  };
  
  // Recording state - shows indicator when recording is in progress
  const [isRecording, setIsRecording] = useState(false);
  
  // All-time stats from database
  const [allTimeStats, setAllTimeStats] = useState<{ stacks: number; transcriptions: number; screenshots: number; improved: number; words: number }>({
    stacks: 0, transcriptions: 0, screenshots: 0, improved: 0, words: 0,
  });

  // Load all-time stats when component mounts or window becomes visible
  useEffect(() => {
    if (!isVisible || !window.clipboardAPI?.getAllTimeStats) return;
    
    window.clipboardAPI.getAllTimeStats().then(stats => {
      setAllTimeStats(stats);
    }).catch(err => {
      console.error('[ClipboardHistory] Failed to load all-time stats:', err);
    });
  }, [isVisible]);

  // Listen for recording state changes to show indicator
  useEffect(() => {
    if (!window.transcribeAPI?.onStatusChanged) return;
    
    const cleanup = window.transcribeAPI.onStatusChanged((status) => {
      setIsRecording(status === 'recording');
    });
    
    return cleanup;
  }, []);

  // Rotating stats display - click to cycle through stats
  const [currentStatIndex, setCurrentStatIndex] = useState(0);
  const [statFading, setStatFading] = useState(false);
  
  // Time interval for stats - click "all time" to cycle through intervals
  const timeIntervals = ['all time', 'last 30 days', 'last 15 days', 'last 7 days', 'last 24 hours'] as const;
  const [currentIntervalIndex, setCurrentIntervalIndex] = useState(0);
  const nextInterval = useCallback(() => {
    setCurrentIntervalIndex(prev => (prev + 1) % timeIntervals.length);
  }, []);
  
  // Hover state for recording tooltip
  const [showRecordingTooltip, setShowRecordingTooltip] = useState(false);
  
  // Keyboard navigation state - disables hover selection when using arrow keys
  const [keyboardNavActive, setKeyboardNavActive] = useState(false);
  
  // Flash state for newly created stacks (shows brief highlight)
  const [recentlyStackedId, setRecentlyStackedId] = useState<string | null>(null);
  
  // Pending selection after stack/unstack operations
  const [pendingStackSelection, setPendingStackSelection] = useState<string | null>(null);
  const [pendingItemSelection, setPendingItemSelection] = useState<number | null>(null);
  
  // Shortcuts modal state
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  // Format numbers with commas (e.g., 16,000)
  const formatNumber = (num: number): string => num.toLocaleString();

  const statItems = useMemo(() => [
    { label: 'Words', value: allTimeStats.words, singular: 'word transcribed', plural: 'words transcribed' },
    { label: 'Stacks', value: allTimeStats.stacks, singular: 'stack', plural: 'stacks' },
    { label: 'Transcriptions', value: allTimeStats.transcriptions, singular: 'transcription', plural: 'transcriptions' },
    { label: 'Improved', value: allTimeStats.improved, singular: 'prompt improved', plural: 'prompts improved' },
    { label: 'Screenshots', value: allTimeStats.screenshots, singular: 'screenshot', plural: 'screenshots' },
  ].filter(item => item.value > 0), [allTimeStats]);

  // Click to rotate stats with fade transition
  const nextStat = useCallback(() => {
    if (statItems.length <= 1) return;
    setStatFading(true);
    setTimeout(() => {
      setCurrentStatIndex(prev => (prev + 1) % statItems.length);
      setStatFading(false);
    }, 150);
  }, [statItems.length]);

  // Reset stat index when items change
  useEffect(() => {
    if (currentStatIndex >= statItems.length) {
      setCurrentStatIndex(0);
    }
  }, [statItems.length, currentStatIndex]);
  
  // Target app for pasting - the app content will be pasted into.
  // Combined into single state object to batch updates and reduce re-renders.
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

      // Load items and stacks in parallel
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

  // Debounce search query to avoid querying database on every keystroke.
  useEffect(() => {
    // Clear existing timer
    if (searchDebounceTimerRef.current) {
      clearTimeout(searchDebounceTimerRef.current);
    }
    
    // Set new timer to update debounced value after 150ms of no typing
    searchDebounceTimerRef.current = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 150);
    
    // Cleanup on unmount or when searchQuery changes
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

  // When component mounts in standalone window, show immediately.
  useEffect(() => {
    if (!isMacOS || !window.clipboardAPI) {
      return;
    }

    // In standalone window mode, show immediately when mounted.
    setIsVisible(true);
    setSelectedIndex(0);
    setSelectedIds(new Set());
    setIsMultiSelect(false);

    // Listen for window show event to reset search and focus input.
    const unsubscribeShowHistory = window.clipboardAPI.onShowHistory(() => {
      setSearchQuery('');
      setDebouncedSearchQuery('');
      setSelectedIndex(0);
      setSelectedIds(new Set());
      setIsMultiSelect(false);
      setShowSettings(false);
      // Don't auto-focus search - let user navigate with J/K immediately
      // User can press / to focus search when needed
    });

    // Listen for show settings event (from menu bar "Settings" item).
    const unsubscribeShowSettings = window.clipboardAPI.onShowSettings?.(() => {
      setShowSettings(true);
    });

    // Listen for target app info (sent when window is shown).
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

    // Listen for item additions.
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
          key === 'j' || key === 'k' || key === 'u' || key === '?') {
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

      if (key === 'Escape') {
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
        window.clipboardAPI?.closeWindow();
        return;
      }

      // J/ArrowDown - Move selection down (Gmail-style)
      if (key === 'ArrowDown' || (key === 'j' && !hasMeta && !hasCtrl && !hasAlt)) {
        // Skip if typing in input
        if (document.activeElement?.tagName?.match(/INPUT|TEXTAREA/)) return;
        
        setKeyboardNavActive(true); // Disable hover selection
        const newIndex = Math.min(selectedIndex + 1, listRows.length - 1);
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
        // Skip if typing in input
        if (document.activeElement?.tagName?.match(/INPUT|TEXTAREA/)) return;
        
        setKeyboardNavActive(true); // Disable hover selection
        const newIndex = Math.max(selectedIndex - 1, 0);
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
                setImproveResult({ stackId: `item-${itemId}`, refinedPrompt: result.refinedPrompt });
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
      if (e.key === 'Escape' && previewImage) {
        e.preventDefault();
        dismissPreview();
        return;
      }
      
      // Spacebar - Quick Look style preview (only when hovering image or preview open)
      // Don't intercept if user is typing in an input field
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
        if (previewImage) {
          e.preventDefault();
          dismissPreview();
          return;
        }
        
        // If hovering over an image, open preview for it
        if (hoveredImageId !== null) {
          e.preventDefault();
          const hoveredItem = items.find(item => item.id === hoveredImageId);
          if (hoveredItem?.imageData) {
            setPreviewImage({
              data: hoveredItem.imageData,
              width: hoveredItem.imageWidth || 0,
              height: hoveredItem.imageHeight || 0,
            });
          }
          return;
        }
        // Otherwise, let spacebar work normally (scroll)
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isVisible, items, selectedIndex, selectedIds, targetAppInfo, listRows, previewImage, hoveredImageId, dismissPreview]);

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
        @keyframes previewScaleIn {
          from { transform: scale(0.9); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
        @keyframes previewScaleOut {
          from { transform: scale(1); opacity: 1; }
          to { transform: scale(0.9); opacity: 0; }
        }
      `}</style>
      <div
        ref={dialogRef}
        style={{
          width: '100%',
          height: '100%',
          boxSizing: 'border-box',
          backgroundColor: theme.bg,  // Use theme background color.
          borderRadius: '12px',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          cursor: 'default',
        }}
      >
      {/* Draggable header area - allows window to be moved */}
      <div
        style={{
          height: '28px',
          minHeight: '28px',
          // @ts-ignore - webkit vendor prefix for Electron draggable region
          WebkitAppRegion: 'drag',
          cursor: 'grab',
          borderRadius: '12px 12px 0 0',
        }}
      />
      
      {/* Conditionally show Settings or Clipboard History */}
      {showSettings ? (
        <SettingsPanel />
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
          {/* Search input */}
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search clipboard history... (press / to focus)"
            style={{
              width: '100%',
              padding: '10px 14px',
              border: `1px solid ${theme.inputBorder}`,
              borderRadius: '8px',
              fontSize: '13px',
              outline: 'none',
              boxSizing: 'border-box',
              backgroundColor: theme.inputBg,
              color: theme.text,
              // @ts-ignore - prevent drag on input
              WebkitAppRegion: 'no-drag',
            }}
          />

          {/* Selection actions bar */}
          <div
            style={{
              display: 'flex',
              padding: '8px 8px 0 8px',
              marginTop: '12px',
            }}
          >
            {selectedIds.size > 0 && (
              <div
                style={{
                  marginLeft: 'auto',
                  padding: '8px 16px',
                  fontSize: '12px',
                  color: theme.textSecondary,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                }}
              >
                <span>{selectedIds.size} selected</span>
                <button
                  tabIndex={-1}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={handleDeleteSelected}
                  style={{
                    padding: '4px 12px',
                    fontSize: '10px',
                    fontWeight: 600,
                    backgroundColor: '#ff3b30',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                  }}
                >
                  Delete
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
                      loadItems(true);
                    }}
                    style={{
                      padding: '4px 12px',
                      fontSize: '10px',
                      fontWeight: 600,
                      backgroundColor: theme.accent,
                      color: '#fff',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                    }}
                  >
                    Stack Selected
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
                    padding: '4px 8px',
                    fontSize: '10px',
                    backgroundColor: 'transparent',
                    color: theme.textSecondary,
                    border: `1px solid ${theme.border}`,
                    borderRadius: '4px',
                    cursor: 'pointer',
                  }}
                >
                  Clear
                </button>
              </div>
            )}
          </div>

          {/* Items list */}
          <div
            ref={listRef}
            style={{
              flex: 1,
              overflowY: 'auto',
              overflowX: 'hidden',
              minHeight: 0,
              marginTop: '8px',
              borderRadius: '8px',
              border: '1px solid #f0f0f0',
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
              
              // Handle drag start for stack (in-app combining only - no OS drag)
              const handleStackDragStart = (e: React.DragEvent) => {
                e.dataTransfer.setData('text/plain', stack.stackId);
                e.dataTransfer.effectAllowed = 'copy';
              };

              // Handle drop on stack (merge stacks or add item)
              const handleStackDrop = async (e: React.DragEvent) => {
                e.preventDefault();
                const data = e.dataTransfer.getData('text/plain');
                
                if (data.startsWith('item:')) {
                  // An item dropped on this stack - add to stack
                  const droppedItemId = parseInt(data.replace('item:', ''), 10);
                  await window.clipboardAPI?.updateStackId?.([droppedItemId], stack.stackId);
                  loadItems(true);
                } else if (data && data !== stack.stackId) {
                  // Another stack dropped on this stack - merge them
                  const otherStackId = data;
                  // Get items from other stack and add to this stack
                  const otherStackItems = await window.clipboardAPI?.queryItemsByStackId?.(otherStackId);
                  if (otherStackItems && otherStackItems.length > 0) {
                    const itemIds = otherStackItems.map((i: ClipboardItem) => i.id);
                    await window.clipboardAPI?.updateStackId?.(itemIds, stack.stackId);
                    loadItems(true);
                  }
                }
              };

              const handleStackDragOver = (e: React.DragEvent) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
              };

              // Get images and text separately for rendering
              const stackImages = stackItems.filter(i => (i.type === 'image' || i.type === 'screenshot') && i.imageData);
              const combinedText = combineStackText(stackItems);
              const hasText = combinedText.length > 0;
              const targetAppName = targetAppInfo.targetApp?.name || 'app';
              // Only show "Show more" if text is actually long enough to benefit from expansion (> 100 chars)
              const textNeedsExpansion = combinedText.length > 100;

              return (
                <div key={`stack-${stack.stackId}`}>
                  {/* Stack row - draggable and droppable */}
                  <div
                    draggable
                    onDragStart={handleStackDragStart}
                    onDrop={handleStackDrop}
                    onDragOver={handleStackDragOver}
                    onMouseEnter={(e) => {
                      // Skip if keyboard nav is active (prevents jumping back on hover)
                      if (keyboardNavActive) return;
                      // Only highlight if the item is fully visible (prevents jumping)
                      const element = e.currentTarget;
                      const container = listRef.current;
                      if (container && isElementFullyVisible(element, container)) {
                        setSelectedIndex(index);
                      }
                    }}
                    onClick={(e) => {
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
                      borderBottom: `1px solid ${theme.border}`,
                      borderLeft: recentlyStackedId === stack.stackId
                        ? `3px solid ${theme.isDark ? '#2dd4bf' : '#14b8a6'}`
                        : stackItems.some(item => selectedIds.has(item.id)) 
                          ? `3px solid ${theme.selectedBorder}` 
                          : selectedIndex === index
                            ? `2px solid ${theme.isDark ? '#2dd4bf' : '#14b8a6'}`
                            : '2px solid transparent',
                      boxShadow: selectedIndex === index && !stackItems.some(item => selectedIds.has(item.id))
                        ? theme.isDark 
                          ? 'inset 0 0 0 1px rgba(255,255,255,0.05), 0 1px 3px rgba(0,0,0,0.2)' 
                          : 'inset 0 0 0 1px rgba(0,0,0,0.02), 0 1px 3px rgba(0,0,0,0.05)'
                        : 'none',
                      transition: 'background-color 0.3s ease, border-left 0.3s ease, box-shadow 0.3s ease',
                      cursor: 'pointer',
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
                                  setPreviewImage({
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
                      {combinedText && (
                        <div
                          style={{
                            fontSize: '12px',
                            fontWeight: '500',
                            color: theme.text,
                            lineHeight: '1.5',
                            marginBottom: '4px',
                            ...(expanded ? {
                              whiteSpace: 'pre-wrap',
                              overflow: 'visible',
                            } : {
                              // 3-line clamp for collapsed state
                              display: '-webkit-box',
                              WebkitLineClamp: 3,
                              WebkitBoxOrient: 'vertical' as const,
                              overflow: 'hidden',
                            }),
                          }}
                        >
                          {expanded && improveResult?.stackId === stack.stackId 
                            ? improveResult.refinedPrompt 
                            : (textNeedsExpansion && createTruncatedPreview(combinedText)) || combinedText}
                        </div>
                      )}
                      
                      {/* Improved badge - shown when there's an improved version */}
                      {improveResult?.stackId === stack.stackId && !expanded && (
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
                      
                      {/* Show more/less button - only show if text would benefit from expansion OR if there's an improved result */}
                      {combinedText && (textNeedsExpansion || improveResult?.stackId === stack.stackId) && (
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
                          {expanded ? 'Show less' : (improveResult?.stackId === stack.stackId ? 'Show improved' : 'Show more')}
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
                      <div style={{ fontSize: '10px', color: improveResult?.stackId === stack.stackId ? '#34C759' : '#999', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        {/* Stack icon - layered rectangles */}
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="4" y="4" width="16" height="6" rx="1" />
                          <rect x="4" y="14" width="16" height="6" rx="1" />
                        </svg>
                        <span>{stackItems.length} items • {formatRelativeTime(stack.createdAt)}{improveResult?.stackId === stack.stackId ? ' • ✨ improved' : ''}</span>
                      </div>

                      {/* Buttons - right side (always reserve space with visibility) */}
                      <div style={{ 
                        display: 'flex', 
                        gap: '4px',
                        visibility: selectedIndex === index ? 'visible' : 'hidden',
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
                  </div>

                </div>
              );
            } else {
              // Render individual item (same as before)
              const { item } = row;
              const isSelected = selectedIndex === index;
              const isInStack = selectedIds.has(item.id);

              // Handle drag start for individual item
              const handleItemDragStart = (e: React.DragEvent) => {
                e.dataTransfer.setData('text/plain', `item:${item.id}`);
                e.dataTransfer.effectAllowed = 'copy';
              };

              // Handle drop on item (create/join stack)
              const handleItemDrop = async (e: React.DragEvent) => {
                e.preventDefault();
                const data = e.dataTransfer.getData('text/plain');
                
                if (data.startsWith('item:')) {
                  // Another item dropped on this item - create a new stack
                  const droppedItemId = parseInt(data.replace('item:', ''), 10);
                  if (droppedItemId !== item.id) {
                    // Generate a new stack ID and add both items
                    const newStackId = crypto.randomUUID();
                    await window.clipboardAPI?.updateStackId?.([droppedItemId, item.id], newStackId);
                    loadItems(true);
                  }
                } else if (data && !data.startsWith('item:')) {
                  // A stack dropped on this item - add item to stack
                  const stackId = data;
                  await window.clipboardAPI?.updateStackId?.([item.id], stackId);
                  loadItems(true);
                }
              };

              const handleItemDragOver = (e: React.DragEvent) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
              };

              const hasText = (item.type === 'text' || item.type === 'transcript') && item.content;
              const isRowSelected = selectedIndex === index;
              const itemExpanded = expandedItems.has(item.id);
              // Only show "Show more" if text is actually long enough to benefit from expansion (> 100 chars)
              const itemTextNeedsExpansion = hasText && item.content && item.content.length > 100;
              
              return (
                <div key={item.id}>
                  <div
                    draggable
                    onDragStart={handleItemDragStart}
                    onDrop={handleItemDrop}
                    onDragOver={handleItemDragOver}
                    onMouseEnter={(e) => {
                      // Skip if keyboard nav is active (prevents jumping back on hover)
                      if (keyboardNavActive) return;
                      // Only highlight if the item is fully visible (prevents jumping)
                      const element = e.currentTarget;
                      const container = listRef.current;
                      if (container && isElementFullyVisible(element, container)) {
                        setSelectedIndex(index);
                      }
                    }}
                    onClick={(e) => handleItemClick(item, index, e)}
                    style={{
                      padding: '12px 16px',
                      backgroundColor: isInStack ? theme.selectedBg : isRowSelected ? theme.bgSecondary : 'transparent',
                      borderBottom: `1px solid ${theme.border}`,
                      borderLeft: isInStack 
                        ? `3px solid ${theme.selectedBorder}` 
                        : isRowSelected 
                          ? `2px solid ${theme.isDark ? '#2dd4bf' : '#14b8a6'}` 
                          : '2px solid transparent',
                      boxShadow: isRowSelected && !isInStack
                        ? theme.isDark 
                          ? 'inset 0 0 0 1px rgba(255,255,255,0.05), 0 1px 3px rgba(0,0,0,0.2)' 
                          : 'inset 0 0 0 1px rgba(0,0,0,0.02), 0 1px 3px rgba(0,0,0,0.05)'
                        : 'none',
                      transition: 'background-color 0.1s ease, border-left 0.1s ease, box-shadow 0.1s ease',
                      cursor: 'grab',
                      display: 'flex',
                      flexDirection: 'column',
                    }}
                  >
                  {/* Content section - full width */}
                  <div>
                    {item.type === 'text' || item.type === 'transcript' ? (
                      <>
                        <div
                          style={{
                            fontSize: '12px',
                            fontWeight: '500',
                            marginBottom: itemExpanded ? '4px' : '0',
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: '8px',
                          }}
                        >
                          {/* Color preview square */}
                          {detectColor(item.content) && (
                            <div
                              style={{
                                width: '20px',
                                height: '20px',
                                borderRadius: '4px',
                                backgroundColor: detectColor(item.content) || '#000',
                                border: '1px solid #e0e0e0',
                                flexShrink: 0,
                                marginTop: '1px',
                              }}
                              title={detectColor(item.content) || ''}
                            />
                          )}
                          <span
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
                            {itemExpanded && improveResult?.stackId === `item-${item.id}`
                              ? improveResult.refinedPrompt
                              : (itemTextNeedsExpansion && item.content && createTruncatedPreview(item.content)) || item.content || 'Empty'}
                          </span>
                        </div>
                        {/* Improved badge - shown when there's an improved version */}
                        {improveResult?.stackId === `item-${item.id}` && !itemExpanded && (
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
                        {/* Show more/less button - only show if text would benefit from expansion OR if there's an improved result */}
                        {(itemTextNeedsExpansion || improveResult?.stackId === `item-${item.id}`) && (
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
                            {itemExpanded ? 'Show less' : (improveResult?.stackId === `item-${item.id}` ? 'Show improved' : 'Show more')}
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
                                setPreviewImage({
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

                    {/* Buttons - right side (always reserve space with visibility) */}
                    <div style={{ 
                      display: 'flex', 
                      gap: '4px',
                      visibility: isRowSelected && selectedIds.size === 0 ? 'visible' : 'hidden',
                    }}>
                      {/* Improve hint button - only if item has text */}
                      {hasText && (
                        <button
                          tabIndex={-1}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={async (e) => {
                            e.stopPropagation();
                            const tempStackId = crypto.randomUUID();
                            await window.clipboardAPI?.updateStackId?.([item.id], tempStackId);
                            setImprovingStackId(`item-${item.id}`);
                            setImproveResult(null);
                            try {
                              const result = await window.clipboardAPI?.engineerStack?.(tempStackId);
                              await window.clipboardAPI?.updateStackId?.([item.id], item.stackId || null);
                              if (result?.success && result.refinedPrompt) {
                                setImproveResult({
                                  stackId: `item-${item.id}`,
                                  refinedPrompt: result.refinedPrompt,
                                });
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
                          <KeyCap>⌘</KeyCap><KeyCap>↵</KeyCap> {improvingStackId === `item-${item.id}` ? 'improving...' : 'improve'}
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
                  </div>
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
        {/* Left side: Stats - icon + "X words transcribed (all time)" format */}
        {/* Click icon/stat to cycle stat type, click interval to cycle time range */}
        {!showSettings && statItems.length > 0 ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '9px',
              color: theme.textSecondary,
              userSelect: 'none',
              flex: 1,
            }}
            onClick={nextStat}
          >
            {/* Stats icon - line graph trending up */}
            <svg 
              width="14" 
              height="14" 
              viewBox="0 0 24 24" 
              fill="none" 
              stroke={theme.textSecondary} 
              strokeWidth="2" 
              strokeLinecap="round" 
              strokeLinejoin="round"
              style={{ cursor: 'pointer', flexShrink: 0 }}
            >
              <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
              <polyline points="17 6 23 6 23 12" />
            </svg>
            <span
              style={{
                opacity: statFading ? 0 : 1,
                transition: 'opacity 0.15s ease',
                cursor: 'pointer',
              }}
            >
              {formatNumber(statItems[currentStatIndex]?.value ?? 0)} {statItems[currentStatIndex]?.value === 1 
                ? statItems[currentStatIndex]?.singular 
                : statItems[currentStatIndex]?.plural}
            </span>
            <span 
              onClick={(e) => {
                e.stopPropagation();
                nextInterval();
              }}
              style={{ fontSize: '10px', cursor: 'pointer' }}
            >
              ({timeIntervals[currentIntervalIndex]})
            </span>
          </div>
        ) : (
          <div style={{ flex: 1 }} />
        )}

        {/* Center: Recording state indicator with tooltip */}
        <div 
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', position: 'relative' }}
          onMouseEnter={() => isRecording && setShowRecordingTooltip(true)}
          onMouseLeave={() => setShowRecordingTooltip(false)}
        >
          {isRecording && (
            <>
              <span
                style={{
                  width: '8px',
                  height: '8px',
                  backgroundColor: '#ef4444',
                  borderRadius: '50%',
                  animation: 'pulse 1.5s ease-in-out infinite',
                }}
              />
              <span style={{ fontWeight: 500, color: '#ef4444', cursor: 'help' }}>Recording</span>
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
      
      {/* Keyboard shortcuts modal */}
      {showShortcutsModal && (
        <div
          onClick={() => setShowShortcutsModal(false)}
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
            cursor: 'pointer',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: theme.bg,
              borderRadius: '12px',
              padding: '24px',
              maxWidth: '400px',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
              cursor: 'default',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: theme.text }}>Keyboard Shortcuts</h3>
              <button
                onClick={() => setShowShortcutsModal(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '4px',
                  color: theme.textSecondary,
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '13px' }}>
              {/* Navigation */}
              <div style={{ color: theme.textSecondary, fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', marginTop: '8px' }}>Navigation</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: theme.text }}>Move down</span>
                <div><KeyCap>↓</KeyCap> or <KeyCap>j</KeyCap></div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: theme.text }}>Move up</span>
                <div><KeyCap>↑</KeyCap> or <KeyCap>k</KeyCap></div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: theme.text }}>Search</span>
                <div><KeyCap>/</KeyCap></div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: theme.text }}>Switch paste target</span>
                <div><KeyCap>tab</KeyCap></div>
              </div>
              
              {/* Actions */}
              <div style={{ color: theme.textSecondary, fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', marginTop: '8px' }}>Actions</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: theme.text }}>Paste</span>
                <div><KeyCap>↵</KeyCap></div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: theme.text }}>Improve with AI</span>
                <div><KeyCap>⌘</KeyCap><KeyCap>↵</KeyCap></div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: theme.text }}>Unstack</span>
                <div><KeyCap>u</KeyCap></div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: theme.text }}>Delete</span>
                <div><KeyCap>delete</KeyCap> or <KeyCap>⌘</KeyCap><KeyCap>⌫</KeyCap></div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: theme.text }}>Undo delete</span>
                <div><KeyCap>⌘</KeyCap><KeyCap>z</KeyCap></div>
              </div>
              
              {/* Preview */}
              <div style={{ color: theme.textSecondary, fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', marginTop: '8px' }}>Preview</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: theme.text }}>Preview image</span>
                <div><KeyCap>⎵</KeyCap></div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: theme.text }}>Close preview / window</span>
                <div><KeyCap>esc</KeyCap></div>
              </div>
              
              {/* Multi-select */}
              <div style={{ color: theme.textSecondary, fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', marginTop: '8px' }}>Multi-select</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: theme.text }}>Toggle selection</span>
                <div><KeyCap>x</KeyCap></div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: theme.text }}>Stack selected items</span>
                <div><KeyCap>s</KeyCap></div>
              </div>
            </div>
            
            <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: `1px solid ${theme.border}`, textAlign: 'center' }}>
              <span style={{ color: theme.textSecondary, fontSize: '11px' }}>
                Press <KeyCap>?</KeyCap> anytime to show this help
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Image preview modal - Quick Look style with scale animation */}
      {previewImage && (
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
          <img
            src={`data:image/png;base64,${previewImage.data}`}
            alt="Preview"
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: '90vw',
              maxHeight: '90vh',
              objectFit: 'contain',
              borderRadius: '8px',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
              animation: previewClosing ? 'previewScaleOut 0.15s ease-in forwards' : 'previewScaleIn 0.15s ease-out',
              cursor: 'default',
            }}
          />
        </div>
      )}
    </div>
    </>
  );
}

