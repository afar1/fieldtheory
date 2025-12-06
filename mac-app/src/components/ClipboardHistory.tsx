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
  const [dialogBounds, setDialogBounds] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [resizeStart, setResizeStart] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  
  // Improve feature - track loading state and result per stack
  const [improvingStackId, setImprovingStackId] = useState<string | null>(null);
  const [improveResult, setImproveResult] = useState<{
    stackId: string;
    refinedPrompt: string;
  } | null>(null);
  const [improvedIds, setImprovedIds] = useState<Set<string>>(new Set()); // Track which items have been improved
  const [showImproveResult, setShowImproveResult] = useState<string | null>(null); // Which result to show
  
  // Hover states for UI interactions
  const [hoveredImageId, setHoveredImageId] = useState<number | null>(null);
  const [previewImage, setPreviewImage] = useState<{data: string, width: number, height: number} | null>(null);
  
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

  // Rotating stats display - click to cycle through stats
  const [currentStatIndex, setCurrentStatIndex] = useState(0);
  const [statFading, setStatFading] = useState(false);
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
  
  const MIN_WIDTH = 400;
  const MIN_HEIGHT = 300;

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

  // When component mounts in standalone window, show immediately
  useEffect(() => {
    if (!isMacOS || !window.clipboardAPI) {
      return;
    }

    // In standalone window mode, show immediately when mounted
    setIsVisible(true);
    setSelectedIndex(0);
    setSelectedIds(new Set());
    setIsMultiSelect(false);
    // Search will be reset via onShowHistory event from main process

    // Listen for dialog bounds from Electron
    const unsubscribeBounds = window.clipboardAPI.onDialogBounds?.((bounds) => {
      setDialogBounds(bounds);
    });
    
    // Also listen for old position format for backward compatibility
    const unsubscribePosition = window.clipboardAPI.onDialogPosition((position) => {
      // Convert old position format to bounds (use default size)
      if (!dialogBounds) {
        setDialogBounds({
          x: position.left,
          y: position.top,
          width: 900,
          height: 600,
        });
      }
    });

    // Listen for window show event to reset search and focus input
    const unsubscribeShowHistory = window.clipboardAPI.onShowHistory(() => {
      setSearchQuery('');
      setDebouncedSearchQuery(''); // Also reset debounced value immediately
      setSelectedIndex(0);
      setSelectedIds(new Set());
      setIsMultiSelect(false);
      setShowSettings(false); // Reset to clipboard view when window is shown via hotkey
      // Focus input directly - this fires on every window show
      inputRef.current?.focus();
    });

    // Listen for show settings event (from menu bar "Settings" item)
    const unsubscribeShowSettings = window.clipboardAPI.onShowSettings?.(() => {
      setShowSettings(true);
    });

    // Listen for target app info (sent when window is shown).
    // Batched into single state update to reduce re-renders.
    const unsubscribeTargetAppInfo = window.clipboardAPI.onTargetAppInfo?.((info) => {
      // Find index of target app in running apps list.
      let targetAppIndex = 0;
      if (info.targetApp && info.runningApps.length > 0) {
        const idx = info.runningApps.findIndex(
          app => app.bundleId === info.targetApp?.bundleId
        );
        targetAppIndex = idx >= 0 ? idx : 0;
      }
      
      // Single state update batches all changes together
      setTargetAppInfo({
        targetApp: info.targetApp,
        runningApps: info.runningApps,
        targetAppIndex,
      });
    });

    // Listen for item additions
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
      unsubscribeBounds?.();
      unsubscribePosition();
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

  // Helper function to check if an element is fully visible in the container
  const isElementFullyVisible = useCallback((element: HTMLElement, container: HTMLElement): boolean => {
    const containerRect = container.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    return elementRect.top >= containerRect.top && elementRect.bottom <= containerRect.bottom;
  }, []);

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
      if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Enter' || key === 'Escape') {
        e.preventDefault();
      }

      if (key === 'Escape') {
        window.clipboardAPI?.closeWindow();
        return;
      }

      if (key === 'ArrowDown') {
        const newIndex = Math.min(selectedIndex + 1, listRows.length - 1);
        const element = listRef.current?.children[newIndex] as HTMLElement;
        const container = listRef.current;
        if (element && container) {
          // Scroll item into view if needed, then highlight it
          element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          // Use requestAnimationFrame to ensure scroll happens before highlighting
          requestAnimationFrame(() => {
            setSelectedIndex(newIndex);
          });
        } else {
          setSelectedIndex(newIndex);
        }
        return;
      }

      if (key === 'ArrowUp') {
        const newIndex = Math.max(selectedIndex - 1, 0);
        const element = listRef.current?.children[newIndex] as HTMLElement;
        const container = listRef.current;
        if (element && container) {
          // Scroll item into view if needed, then highlight it
          element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          // Use requestAnimationFrame to ensure scroll happens before highlighting
          requestAnimationFrame(() => {
            setSelectedIndex(newIndex);
          });
        } else {
          setSelectedIndex(newIndex);
        }
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

      if (key === 'Backspace' && (hasMeta || hasCtrl)) {
        // Delete selected item or stack
        const selectedRow = listRows[selectedIndex];
        (async () => {
          if (selectedRow?.type === 'item') {
            // Store for undo
            const item = await window.clipboardAPI?.getItem(selectedRow.item.id);
            if (item) {
              setDeletedItems([item]);
            }
            await window.clipboardAPI?.deleteItem(selectedRow.item.id);
            loadItems(true);
          } else if (selectedRow?.type === 'stack') {
            // Store all items for undo
            const itemsToDelete: ClipboardItem[] = [];
            for (const stackItem of selectedRow.items) {
              const item = await window.clipboardAPI?.getItem(stackItem.id);
              if (item) {
                itemsToDelete.push(item);
              }
            }
            setDeletedItems(itemsToDelete);
            // Delete all items in the stack
            for (const item of selectedRow.items) {
              await window.clipboardAPI?.deleteItem(item.id);
            }
            loadItems(true);
          }
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
        setPreviewImage(null);
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isVisible, items, selectedIndex, selectedIds, targetAppInfo, listRows, previewImage]);

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

  // Handle click anywhere to close (Alfred-like behavior)
  const handleOverlayClick = () => {
    window.clipboardAPI?.closeWindow();
  };

  // Prevent clicks inside dialog from closing the window
  const handleDialogClick = (event: React.MouseEvent) => {
    event.stopPropagation();
  };

  // Handle drag start
  const handleDragStart = (e: React.MouseEvent) => {
    if (!dialogBounds) return;
    setIsDragging(true);
    setDragStart({
      x: e.clientX - dialogBounds.x,
      y: e.clientY - dialogBounds.y,
    });
    e.preventDefault();
  };

  // Handle resize start
  const handleResizeStart = (e: React.MouseEvent) => {
    if (!dialogBounds) return;
    setIsResizing(true);
    setResizeStart({
      x: e.clientX,
      y: e.clientY,
      width: dialogBounds.width,
      height: dialogBounds.height,
    });
    e.preventDefault();
    e.stopPropagation();
  };

  // Handle mouse move for drag/resize
  useEffect(() => {
    if (!isDragging && !isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging && dragStart && dialogBounds) {
        const newX = e.clientX - dragStart.x;
        const newY = e.clientY - dragStart.y;
        
        // Clamp to viewport bounds
        const clampedX = Math.max(0, Math.min(newX, window.innerWidth - dialogBounds.width));
        const clampedY = Math.max(0, Math.min(newY, window.innerHeight - dialogBounds.height));
        
        setDialogBounds({
          ...dialogBounds,
          x: clampedX,
          y: clampedY,
        });
      } else if (isResizing && resizeStart && dialogBounds) {
        const deltaX = e.clientX - resizeStart.x;
        const deltaY = e.clientY - resizeStart.y;
        
        let newWidth = resizeStart.width + deltaX;
        let newHeight = resizeStart.height + deltaY;
        
        // Enforce minimum size
        newWidth = Math.max(MIN_WIDTH, newWidth);
        newHeight = Math.max(MIN_HEIGHT, newHeight);
        
        // Clamp to viewport bounds
        const maxWidth = window.innerWidth - dialogBounds.x;
        const maxHeight = window.innerHeight - dialogBounds.y;
        newWidth = Math.min(newWidth, maxWidth);
        newHeight = Math.min(newHeight, maxHeight);
        
        setDialogBounds({
          ...dialogBounds,
          width: newWidth,
          height: newHeight,
        });
      }
    };

    const handleMouseUp = () => {
      if (isDragging || isResizing) {
        // Save bounds when drag/resize ends
        if (dialogBounds && window.clipboardAPI?.saveBounds) {
          // Convert overlay-relative coordinates to screen coordinates
          // We need to get the overlay window's position
          // For now, we'll save the overlay-relative coordinates and let main process handle conversion
          window.clipboardAPI.saveBounds(dialogBounds).catch((err) => {
            console.error('Failed to save bounds:', err);
          });
        }
      }
      setIsDragging(false);
      setIsResizing(false);
      setDragStart(null);
      setResizeStart(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, isResizing, dragStart, resizeStart, dialogBounds]);

  if (!isVisible) {
    return null;
  }

  // All items are shown (no filtering)
  const filteredItems = items;

  // Toggle stack expansion
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

  // Toggle individual item expansion
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

  // Calculate dialog bounds: use received bounds or fallback to centered
  const dialogStyle: React.CSSProperties = dialogBounds
    ? {
        position: 'absolute',
        left: `${dialogBounds.x}px`,
        top: `${dialogBounds.y}px`,
        width: `${dialogBounds.width}px`,
        height: `${dialogBounds.height}px`,
      }
    : {
        position: 'absolute',
        left: '50%',
        top: '80px',
        transform: 'translateX(-50%)',
        width: '900px',
        height: '600px',
      };

  return (
    <div
      onClick={handleOverlayClick}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: '100%',
        height: '100%',
        backgroundColor: 'rgba(0, 0, 0, 0.1)',
        cursor: 'default',
      }}
    >
      <div
        ref={dialogRef}
        onClick={handleDialogClick}
        style={{
          ...dialogStyle,
          maxWidth: '90vw',
          maxHeight: '80vh',
          boxSizing: 'border-box',
          backgroundColor: theme.bg,
          backdropFilter: theme.isDark && theme.glassEnabled ? 'blur(20px)' : 'none',
          borderRadius: '12px',
          boxShadow: theme.isDark 
            ? '0 20px 45px rgba(0, 0, 0, 0.5)' 
            : '0 20px 45px rgba(0, 0, 0, 0.25)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          cursor: 'default',
          position: 'relative',
        }}
      >
        {/* Content area */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
      {/* Conditionally show Settings or Clipboard History */}
      {showSettings ? (
        <SettingsPanel />
      ) : (
        <div 
          onMouseDown={handleDragStart}
          style={{ 
            flex: 1, 
            display: 'flex', 
            flexDirection: 'column', 
            overflow: 'hidden', 
            padding: '16px',
            cursor: isDragging ? 'grabbing' : 'default',
          }}
        >
          {/* Search input - standard input element with autoFocus */}
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search clipboard history..."
            autoFocus
            onMouseDown={(e) => e.stopPropagation()}
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
            }}
          />

            {/* Filter tabs */}
          <div
            onMouseDown={(e) => e.stopPropagation()}
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
                      backgroundColor: stackItems.some(item => selectedIds.has(item.id)) 
                        ? theme.selectedBg 
                        : selectedIndex === index 
                          ? theme.bgSecondary 
                          : 'transparent',
                      borderBottom: `1px solid ${theme.border}`,
                      borderLeft: stackItems.some(item => selectedIds.has(item.id)) 
                        ? `3px solid ${theme.selectedBorder}` 
                        : 'none',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                      {/* Content area */}
                      <div style={{ flex: 1, minWidth: 0 }}>
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
                                {/* Preview button overlay on hover */}
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
                                    Preview
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
                              whiteSpace: expanded ? 'pre-wrap' : 'nowrap',
                              overflow: expanded ? 'visible' : 'hidden',
                              textOverflow: expanded ? 'clip' : 'ellipsis',
                              marginBottom: '4px',
                            }}
                          >
                            {expanded && improveResult?.stackId === stack.stackId 
                              ? improveResult.refinedPrompt 
                              : expanded 
                                ? combinedText 
                                : truncateText(combinedText, 100)}
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

                        {/* Footer */}
                        <div style={{ fontSize: '10px', color: improveResult?.stackId === stack.stackId ? '#34C759' : '#999' }}>
                          {formatRelativeTime(stack.createdAt)} • {improveResult?.stackId === stack.stackId ? '✨ improved • ' : ''}click to paste into {targetAppName}
                        </div>
                      </div>

                      {/* Button area - dedicated space so content doesn't shift */}
                      <div style={{ 
                        width: '160px', 
                        display: 'flex', 
                        gap: '8px', 
                        justifyContent: 'flex-end',
                        flexShrink: 0,
                        alignItems: 'flex-start',
                        paddingTop: stackImages.length > 0 ? '2px' : '0',
                      }}>
                        {/* Buttons shown when row is selected (via keyboard or mouse) */}
                        {selectedIndex === index && (
                          <>
                            {/* Unstack button - only for multi-item stacks */}
                            {stackItems.length > 1 && (
                              <button
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  const itemIds = stackItems.map(i => i.id);
                                  await window.clipboardAPI?.updateStackId?.(itemIds, null);
                                  loadItems(true);
                                }}
                                style={{
                                  padding: '4px 12px',
                                  fontSize: '10px',
                                  fontWeight: 600,
                                  backgroundColor: 'transparent',
                                  color: theme.textSecondary,
                                  border: `1px solid ${theme.border}`,
                                  borderRadius: '4px',
                                  cursor: 'pointer',
                                }}
                              >
                                Unstack
                              </button>
                            )}
                            {/* Improve button - only if stack has text */}
                            {hasText && (
                              <button
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  setImprovingStackId(stack.stackId);
                                  setImproveResult(null);
                                  try {
                                    // Only send text items for improvement, ignore images
                                    const textItems = stackItems.filter(i => 
                                      (i.type === 'text' || i.type === 'transcript') && i.content
                                    );
                                    if (textItems.length === 0) {
                                      console.error('[Improve] No text items to improve');
                                      return;
                                    }
                                    
                                    // Create a temporary stack ID for just the text items
                                    const tempStackId = crypto.randomUUID();
                                    const textItemIds = textItems.map(i => i.id);
                                    await window.clipboardAPI?.updateStackId?.(textItemIds, tempStackId);
                                    
                                    const result = await window.clipboardAPI?.engineerStack?.(tempStackId);
                                    
                                    // Restore original stack IDs
                                    await window.clipboardAPI?.updateStackId?.(textItemIds, stack.stackId);
                                    
                                    if (result?.success && result.refinedPrompt) {
                                      setImproveResult({
                                        stackId: stack.stackId,
                                        refinedPrompt: result.refinedPrompt,
                                      });
                                      window.clipboardAPI?.incrementImprovedCount?.().then(count => {
                                        setAllTimeStats(prev => ({ ...prev, improved: count }));
                                      });
                                    } else {
                                      console.error('[Improve] Failed:', result?.error || 'Unknown error');
                                    }
                                  } catch (err) {
                                    console.error('[Improve] Error:', err);
                                  } finally {
                                    setImprovingStackId(null);
                                  }
                                }}
                                disabled={improvingStackId === stack.stackId}
                                style={{
                                  padding: '4px 12px',
                                  fontSize: '10px',
                                  fontWeight: 600,
                                  backgroundColor: improvingStackId === stack.stackId ? '#34C759' : theme.accent,
                                  color: '#fff',
                                  border: 'none',
                                  borderRadius: '4px',
                                  cursor: improvingStackId === stack.stackId ? 'wait' : 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                }}
                              >
                                {improvingStackId === stack.stackId ? 'Improving...' : (
                                  <>Improve <span style={{ opacity: 0.7, fontSize: '9px' }}>⌘↵</span></>
                                )}
                              </button>
                            )}
                          </>
                        )}
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
                      backgroundColor: isInStack ? theme.selectedBg : isSelected ? theme.bgSecondary : 'transparent',
                      borderBottom: `1px solid ${theme.border}`,
                      borderLeft: isInStack ? `3px solid ${theme.selectedBorder}` : 'none',
                      cursor: 'grab',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                    }}
                  >
                  {/* Screenshot thumbnail */}
                  {(item.type === 'screenshot' || item.type === 'image') && item.imageData && (
                    <img
                      src={`data:image/png;base64,${item.imageData}`}
                      alt="Screenshot preview"
                      style={{
                        width: '48px',
                        height: 'auto',
                        borderRadius: '4px',
                        border: '1px solid #e0e0e0',
                        flexShrink: 0,
                        objectFit: 'cover',
                      }}
                    />
                  )}

                  {/* Item preview */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {item.type === 'text' || item.type === 'transcript' ? (
                      <>
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
                              overflow: itemExpanded ? 'visible' : 'hidden',
                              textOverflow: itemExpanded ? 'clip' : 'ellipsis',
                              display: itemExpanded ? 'block' : '-webkit-box',
                              WebkitLineClamp: itemExpanded ? undefined : 2,
                              WebkitBoxOrient: 'vertical' as const,
                              wordBreak: 'break-word',
                              whiteSpace: itemExpanded ? 'pre-wrap' : 'normal',
                            }}
                          >
                            {itemExpanded && improveResult?.stackId === `item-${item.id}`
                              ? improveResult.refinedPrompt
                              : item.content || 'Empty'}
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
                            {item.wordCount && item.charCount
                              ? `${item.wordCount} words, ${item.charCount} chars`
                              : ''}
                            {item.sourceAppName && ` • ${item.sourceAppName}`}
                            {' • '}
                            {formatRelativeTime(item.createdAt)}
                            {improveResult?.stackId === `item-${item.id}` && (
                              <span style={{ color: '#34C759', marginLeft: '4px' }}>• ✨ improved</span>
                            )}
                          </span>
                        </div>
                      </>
                    ) : (
                      <>
                        <div
                          style={{
                            fontSize: '12px',
                            fontWeight: '500',
                            marginBottom: '4px',
                          }}
                        >
                          Screenshot
                        </div>
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
                            {item.imageWidth && item.imageHeight
                              ? `${item.imageWidth}×${item.imageHeight}`
                              : ''}
                            {item.imageSize && ` • ${formatFileSize(item.imageSize)}`}
                            {item.sourceAppName && ` • ${item.sourceAppName}`}
                            {' • '}
                            {formatRelativeTime(item.createdAt)}
                          </span>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Button area - dedicated space so content doesn't shift */}
                  <div style={{ 
                    width: '80px', 
                    display: 'flex', 
                    gap: '8px', 
                    justifyContent: 'flex-end',
                    flexShrink: 0,
                    alignItems: 'center',
                  }}>
                    {/* Improve button - shown when selected, only if item has text and not in multi-select mode */}
                    {isRowSelected && hasText && selectedIds.size === 0 && (
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          // Create a temporary stack with just this item for improvement
                          const tempStackId = crypto.randomUUID();
                          await window.clipboardAPI?.updateStackId?.([item.id], tempStackId);
                          
                          setImprovingStackId(`item-${item.id}`);
                          setImproveResult(null);
                          try {
                            const result = await window.clipboardAPI?.engineerStack?.(tempStackId);
                            
                            // Restore original stack ID (might be null if it was a single item)
                            await window.clipboardAPI?.updateStackId?.([item.id], item.stackId || null);
                            
                            if (result?.success && result.refinedPrompt) {
                              setImproveResult({
                                stackId: `item-${item.id}`,
                                refinedPrompt: result.refinedPrompt,
                              });
                              window.clipboardAPI?.incrementImprovedCount?.().then(count => {
                                setAllTimeStats(prev => ({ ...prev, improved: count }));
                              });
                            } else {
                              console.error('[Improve] Failed:', result?.error || 'Unknown error');
                            }
                          } catch (err) {
                            console.error('[Improve] Error:', err);
                            // Restore original stack ID on error
                            await window.clipboardAPI?.updateStackId?.([item.id], item.stackId || null);
                          } finally {
                            setImprovingStackId(null);
                          }
                        }}
                        disabled={improvingStackId === `item-${item.id}`}
                        style={{
                          padding: '4px 12px',
                          fontSize: '10px',
                          fontWeight: 600,
                                  backgroundColor: improvingStackId === `item-${item.id}` ? '#34C759' : theme.accent,
                          color: '#fff',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: improvingStackId === `item-${item.id}` ? 'wait' : 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                        }}
                      >
                        {improvingStackId === `item-${item.id}` ? 'Improving...' : (
                          <>Improve <span style={{ opacity: 0.7, fontSize: '9px' }}>⌘↵</span></>
                        )}
                      </button>
                    )}
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
      
      {/* Footer - simplified, dense, consistent styling */}
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
        {/* Left side: Rotating all-time stats (click to cycle) */}
        {!showSettings && statItems.length > 0 ? (
          <div
            onClick={nextStat}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '11px',
              color: theme.textSecondary,
              cursor: statItems.length > 1 ? 'pointer' : 'default',
              userSelect: 'none',
            }}
            title={statItems.length > 1 ? 'Click to see more stats' : undefined}
          >
            <span style={{ opacity: 0.7 }}>all time:</span>
            <span
              style={{
                opacity: statFading ? 0 : 1,
                transition: 'opacity 0.15s ease',
              }}
            >
              {formatNumber(statItems[currentStatIndex]?.value ?? 0)} {statItems[currentStatIndex]?.value === 1 
                ? statItems[currentStatIndex]?.singular 
                : statItems[currentStatIndex]?.plural}
            </span>
          </div>
        ) : (
          <div style={{ flex: 1 }} />
        )}

        {/* Right side: target app info and controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '11px' }}>
          {!showSettings && (
            <>
              <span style={{ color: theme.textSecondary, opacity: 0.7 }}>Switch paste target (tab):</span>
              <span
                style={{
                  fontWeight: 500,
                  color: theme.text,
                }}
              >
                {targetAppInfo.targetApp?.name || 'Select app'}
              </span>
            </>
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
        </div>
        
        {/* Resize handle */}
        <div
          onMouseDown={handleResizeStart}
          style={{
            position: 'absolute',
            bottom: 0,
            right: 0,
            width: '16px',
            height: '16px',
            cursor: 'nwse-resize',
            background: 'linear-gradient(135deg, transparent 0%, transparent 40%, #ccc 40%, #ccc 45%, transparent 45%, transparent 55%, #ccc 55%, #ccc 60%, transparent 60%)',
            borderRadius: '0 0 12px 0',
          }}
        />
      </div>
      
      {/* Image preview modal - Quick Look style */}
      {previewImage && (
        <div
          onClick={() => setPreviewImage(null)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.9)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
            cursor: 'pointer',
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
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
            }}
          />
        </div>
      )}
    </div>
  );
}

