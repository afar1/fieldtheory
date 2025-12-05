// =============================================================================
// ClipboardHistory - Alfred-style clipboard history popup.
// Shows local clipboard history with fuzzy search and multi-select.
// =============================================================================

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import SettingsPanel from './SettingsPanel';

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
  const [isVisible, setIsVisible] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [items, setItems] = useState<ClipboardItem[]>([]);
  const [stacks, setStacks] = useState<StackInfo[]>([]);
  const [expandedStacks, setExpandedStacks] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');
  const [sourceFilter, setSourceFilter] = useState<SourceFilterType>('all');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [isMultiSelect, setIsMultiSelect] = useState(false);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [dialogBounds, setDialogBounds] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [resizeStart, setResizeStart] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  
  // Engineer feature - track loading state and result per stack
  const [engineeringStackId, setEngineeringStackId] = useState<string | null>(null);
  const [engineerResult, setEngineerResult] = useState<{
    stackId: string;
    refinedPrompt: string;
  } | null>(null);
  
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
        setSelectedIndex(prev => Math.min(prev + 1, listRows.length - 1));
        return;
      }

      if (key === 'ArrowUp') {
        setSelectedIndex(prev => Math.max(prev - 1, 0));
        return;
      }

      if (key === 'Enter' && !hasShift) {
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
            // Paste all items in the stack
            const itemIds = selectedRow.items.map(i => i.id);
            window.clipboardAPI?.pasteStack(itemIds);
            window.clipboardAPI?.closeWindow();
          } else if (selectedRow?.type === 'item') {
            // Paste single item to target app
            window.clipboardAPI?.pasteItem(selectedRow.item.id, targetBundleId);
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

      if (key === 'Backspace' && (hasMeta || hasCtrl)) {
        // Delete selected item or stack
        const selectedRow = listRows[selectedIndex];
        if (selectedRow?.type === 'item') {
          window.clipboardAPI?.deleteItem(selectedRow.item.id);
        } else if (selectedRow?.type === 'stack') {
          // Delete all items in the stack
          selectedRow.items.forEach(item => {
            window.clipboardAPI?.deleteItem(item.id);
          });
        }
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
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isVisible, items, selectedIndex, selectedIds, targetAppInfo, listRows]);

  // Scroll selected item into view.
  useEffect(() => {
    if (listRef.current && selectedIndex >= 0) {
      const selectedElement = listRef.current.children[selectedIndex] as HTMLElement;
      if (selectedElement) {
        selectedElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }, [selectedIndex]);

  // Handle item click.
  const handleItemClick = (item: ClipboardItem, index: number) => {
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
    } else {
      // Paste to target app.
      const targetBundleId = targetAppInfo.targetApp?.bundleId;
      window.clipboardAPI?.pasteItem(item.id, targetBundleId);
      window.clipboardAPI?.closeWindow();
    }
  };

  // Handle load more.
  const handleLoadMore = () => {
    if (!loading && hasMore) {
      loadItems(false);
    }
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
          backgroundColor: '#ffffff',
          borderRadius: '12px',
          boxShadow: '0 20px 45px rgba(0, 0, 0, 0.25)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          cursor: 'default',
          position: 'relative',
        }}
      >
        {/* Draggable header */}
        <div
          onMouseDown={handleDragStart}
          style={{
            height: '32px',
            padding: '0 16px',
            display: 'flex',
            alignItems: 'center',
            cursor: isDragging ? 'grabbing' : 'grab',
            userSelect: 'none',
            borderBottom: '1px solid #e0e0e0',
            backgroundColor: '#f9f9f9',
            borderRadius: '12px 12px 0 0',
          }}
        >
          <div
            style={{
              display: 'flex',
              gap: '6px',
              alignItems: 'center',
            }}
          >
            <div
              style={{
                width: '12px',
                height: '12px',
                borderRadius: '50%',
                backgroundColor: '#ff5f57',
              }}
            />
            <div
              style={{
                width: '12px',
                height: '12px',
                borderRadius: '50%',
                backgroundColor: '#ffbd2e',
              }}
            />
            <div
              style={{
                width: '12px',
                height: '12px',
                borderRadius: '50%',
                backgroundColor: '#28ca42',
              }}
            />
          </div>
        </div>
        
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
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '16px' }}>
          {/* Search input - standard input element with autoFocus */}
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search clipboard history..."
            autoFocus
            style={{
              width: '100%',
              padding: '10px 14px',
              border: '1px solid #e0e0e0',
              borderRadius: '8px',
              fontSize: '13px',
              outline: 'none',
              boxSizing: 'border-box',
              backgroundColor: '#ffffff',
            }}
          />

          {/* Filter tabs */}
          <div
            style={{
              display: 'flex',
              borderBottom: '1px solid #e0e0e0',
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
                  color: '#666',
                }}
              >
                {selectedIds.size} selected
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

              // Handle drag-out to external apps (OS-level drag via dedicated handle)
              const handleDragOutStart = (e: React.DragEvent) => {
                e.stopPropagation(); // Don't trigger row drag
                e.dataTransfer.setData('text/plain', stack.stackId);
                e.dataTransfer.effectAllowed = 'copy';
                // Trigger native OS drag via IPC
                window.clipboardAPI?.startDrag?.(stack.stackId);
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

              return (
                <div key={`stack-${stack.stackId}`}>
                  {/* Stack header row - draggable and droppable */}
                  <div
                    draggable
                    onDragStart={handleStackDragStart}
                    onDrop={handleStackDrop}
                    onDragOver={handleStackDragOver}
                    onClick={() => {
                      // Paste all items in the stack
                      const itemIds = stackItems.map(i => i.id);
                      window.clipboardAPI?.pasteStack(itemIds);
                      window.clipboardAPI?.closeWindow();
                    }}
                    style={{
                      padding: '12px 16px',
                      backgroundColor: selectedIndex === index ? '#f0f0f0' : '#fafafa',
                      borderBottom: '1px solid #f0f0f0',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                    }}
                  >
                    {/* Expand/collapse chevron */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleStackExpanded(stack.stackId);
                      }}
                      style={{
                        width: '20px',
                        height: '20px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        cursor: 'pointer',
                        flexShrink: 0,
                        transition: 'transform 0.15s ease',
                        transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
                      }}
                      title={expanded ? 'Collapse' : 'Expand'}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="2.5">
                        <path d="M9 18l6-6-6-6" />
                      </svg>
                    </button>

                    {/* Stack icon */}
                    <div
                      style={{
                        width: '24px',
                        height: '24px',
                        position: 'relative',
                        flexShrink: 0,
                      }}
                    >
                      <div style={{
                        position: 'absolute',
                        width: '18px',
                        height: '14px',
                        border: '2px solid #666',
                        borderRadius: '3px',
                        top: '0',
                        left: '0',
                        background: '#fff',
                      }} />
                      <div style={{
                        position: 'absolute',
                        width: '18px',
                        height: '14px',
                        border: '2px solid #888',
                        borderRadius: '3px',
                        top: '5px',
                        left: '3px',
                        background: '#fff',
                      }} />
                    </div>

                    {/* Stack info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: '12px',
                          fontWeight: '600',
                          marginBottom: '4px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                        }}
                      >
                        <span>Prompt Stack</span>
                        {stack.imageCount > 0 && (
                          <span style={{
                            fontSize: '10px',
                            background: '#e0e0e0',
                            padding: '2px 6px',
                            borderRadius: '10px',
                            color: '#555',
                          }}>
                            📷 {stack.imageCount}
                          </span>
                        )}
                        {stack.textCount > 0 && (
                          <span style={{
                            fontSize: '10px',
                            background: '#e0e0e0',
                            padding: '2px 6px',
                            borderRadius: '10px',
                            color: '#555',
                          }}>
                            📝 {stack.textCount}
                          </span>
                        )}
                      </div>
                      <div
                        style={{
                          fontSize: '11px',
                          color: '#666',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {stack.firstTextPreview || 'No text content'}
                      </div>
                      <div style={{ fontSize: '10px', color: '#999', marginTop: '2px' }}>
                        {formatRelativeTime(stack.createdAt)} • click to paste
                      </div>
                    </div>

                    {/* Drag-out handle for external apps */}
                    <div
                      draggable
                      onDragStart={handleDragOutStart}
                      onClick={(e) => e.stopPropagation()}
                      title="Drag to external apps"
                      style={{
                        width: '24px',
                        height: '24px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'grab',
                        borderRadius: '4px',
                        backgroundColor: '#f0f0f0',
                        flexShrink: 0,
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="2">
                        <path d="M7 17L17 7M17 7H8M17 7V16" />
                      </svg>
                    </div>
                  </div>

                  {/* Expanded stack actions and items */}
                  {expanded && (
                    <>
                      {/* Stack actions */}
                      <div
                        style={{
                          padding: '8px 16px 8px 48px',
                          backgroundColor: '#f5f5f5',
                          borderBottom: '1px solid #f0f0f0',
                          display: 'flex',
                          gap: '8px',
                          fontSize: '11px',
                        }}
                      >
                        {/* Engineer button - refine prompt using AI */}
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            setEngineeringStackId(stack.stackId);
                            setEngineerResult(null);
                            try {
                              const result = await window.clipboardAPI?.engineerStack?.(stack.stackId);
                              if (result?.success && result.refinedPrompt) {
                                setEngineerResult({
                                  stackId: stack.stackId,
                                  refinedPrompt: result.refinedPrompt,
                                });
                              } else {
                                // Show error briefly
                                console.error('[Engineer] Failed:', result?.error || 'Unknown error');
                              }
                            } catch (err) {
                              console.error('[Engineer] Error:', err);
                            } finally {
                              setEngineeringStackId(null);
                            }
                          }}
                          disabled={engineeringStackId === stack.stackId}
                          style={{
                            padding: '4px 12px',
                            fontSize: '10px',
                            fontWeight: 600,
                            backgroundColor: engineeringStackId === stack.stackId ? '#e0e0e0' : '#007AFF',
                            color: engineeringStackId === stack.stackId ? '#888' : '#fff',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: engineeringStackId === stack.stackId ? 'wait' : 'pointer',
                          }}
                        >
                          {engineeringStackId === stack.stackId ? 'Engineering...' : '✨ Engineer'}
                        </button>
                        
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            const itemIds = stackItems.map(i => i.id);
                            await window.clipboardAPI?.updateStackId?.(itemIds, null);
                            loadItems(true);
                          }}
                          style={{
                            padding: '4px 8px',
                            fontSize: '10px',
                            backgroundColor: '#fff',
                            color: '#666',
                            border: '1px solid #ddd',
                            borderRadius: '4px',
                            cursor: 'pointer',
                          }}
                        >
                          unstack all
                        </button>
                        {stack.imageCount > 0 && (
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              const imageIds = stackItems
                                .filter(i => i.type === 'image' || i.type === 'screenshot')
                                .map(i => i.id);
                              await window.clipboardAPI?.updateStackId?.(imageIds, null);
                              loadItems(true);
                            }}
                            style={{
                              padding: '4px 8px',
                              fontSize: '10px',
                              backgroundColor: '#fff',
                              color: '#666',
                              border: '1px solid #ddd',
                              borderRadius: '4px',
                              cursor: 'pointer',
                            }}
                          >
                            unstack screenshots
                          </button>
                        )}
                        {stack.textCount > 0 && (
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              const textIds = stackItems
                                .filter(i => i.type === 'text' || i.type === 'transcript')
                                .map(i => i.id);
                              await window.clipboardAPI?.updateStackId?.(textIds, null);
                              loadItems(true);
                            }}
                            style={{
                              padding: '4px 8px',
                              fontSize: '10px',
                              backgroundColor: '#fff',
                              color: '#666',
                              border: '1px solid #ddd',
                              borderRadius: '4px',
                              cursor: 'pointer',
                            }}
                          >
                            unstack text
                          </button>
                        )}
                      </div>
                      
                      {/* Engineered result display */}
                      {engineerResult?.stackId === stack.stackId && (
                        <div
                          style={{
                            padding: '12px 16px 12px 48px',
                            backgroundColor: '#f0f8ff',
                            borderBottom: '1px solid #007AFF',
                            borderLeft: '3px solid #007AFF',
                          }}
                        >
                          <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginBottom: '8px',
                          }}>
                            <span style={{
                              fontSize: '11px',
                              fontWeight: 600,
                              color: '#007AFF',
                            }}>
                              ✨ Engineered Prompt
                            </span>
                            <div style={{ display: 'flex', gap: '8px' }}>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  // Copy to clipboard
                                  navigator.clipboard.writeText(engineerResult.refinedPrompt);
                                }}
                                style={{
                                  padding: '3px 8px',
                                  fontSize: '10px',
                                  backgroundColor: '#007AFF',
                                  color: '#fff',
                                  border: 'none',
                                  borderRadius: '4px',
                                  cursor: 'pointer',
                                }}
                              >
                                Copy
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEngineerResult(null);
                                }}
                                style={{
                                  padding: '3px 8px',
                                  fontSize: '10px',
                                  backgroundColor: '#fff',
                                  color: '#666',
                                  border: '1px solid #ddd',
                                  borderRadius: '4px',
                                  cursor: 'pointer',
                                }}
                              >
                                Dismiss
                              </button>
                            </div>
                          </div>
                          <pre
                            style={{
                              fontSize: '11px',
                              color: '#333',
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-word',
                              margin: 0,
                              fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
                              maxHeight: '300px',
                              overflowY: 'auto',
                              backgroundColor: '#fff',
                              padding: '12px',
                              borderRadius: '6px',
                              border: '1px solid #e0e0e0',
                            }}
                          >
                            {engineerResult.refinedPrompt}
                          </pre>
                        </div>
                      )}
                    </>
                  )}

                  {/* Expanded stack items */}
                  {expanded && stackItems.map((item, itemIdx) => (
                    <div
                      key={item.id}
                      onClick={() => handleItemClick(item, index)}
                      style={{
                        padding: '10px 16px 10px 48px',
                        backgroundColor: '#fefefe',
                        borderBottom: '1px solid #f0f0f0',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        borderLeft: '3px solid #007AFF',
                      }}
                    >
                      {/* Item content */}
                      {(item.type === 'screenshot' || item.type === 'image') && item.imageData && (
                        <img
                          src={`data:image/png;base64,${item.imageData}`}
                          alt="Screenshot preview"
                          style={{
                            width: '40px',
                            height: 'auto',
                            borderRadius: '4px',
                            border: '1px solid #e0e0e0',
                            flexShrink: 0,
                          }}
                        />
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: '11px',
                          color: '#333',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                        }}>
                          {item.type === 'text' || item.type === 'transcript' ? (
                            <>
                              {/* Color preview square */}
                              {detectColor(item.content) && (
                                <div
                                  style={{
                                    width: '16px',
                                    height: '16px',
                                    borderRadius: '3px',
                                    backgroundColor: detectColor(item.content) || '#000',
                                    border: '1px solid #e0e0e0',
                                    flexShrink: 0,
                                  }}
                                  title={detectColor(item.content) || ''}
                                />
                              )}
                              <span style={{ flex: 1 }}>
                                {truncateText(item.content || 'Empty', 80)}
                              </span>
                            </>
                          ) : (
                            `Screenshot ${item.imageWidth}×${item.imageHeight}`
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
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

              return (
                <div
                  key={item.id}
                  draggable
                  onDragStart={handleItemDragStart}
                  onDrop={handleItemDrop}
                  onDragOver={handleItemDragOver}
                  onClick={() => handleItemClick(item, index)}
                  style={{
                    padding: '12px 16px',
                    backgroundColor: isSelected ? '#f0f0f0' : 'transparent',
                    borderBottom: '1px solid #f0f0f0',
                    cursor: 'grab',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                  }}
                >
                  {/* Selection indicator */}
                  {isInStack && (
                    <div
                      style={{
                        width: '20px',
                        height: '20px',
                        borderRadius: '4px',
                        backgroundColor: '#007AFF',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'white',
                        fontSize: '12px',
                        flexShrink: 0,
                      }}
                    >
                      ✓
                    </div>
                  )}

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
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              display: '-webkit-box',
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: 'vertical' as const,
                              wordBreak: 'break-word',
                              whiteSpace: 'normal',
                            }}
                          >
                            {item.content || 'Empty'}
                          </span>
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
                            {item.wordCount && item.charCount
                              ? `${item.wordCount} words, ${item.charCount} chars`
                              : ''}
                            {item.sourceAppName && ` • ${item.sourceAppName}`}
                            {' • '}
                            {formatRelativeTime(item.createdAt)}
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

                </div>
              );
            }
          })
        )}

          {/* Load more */}
          {hasMore && (
            <button
              onClick={handleLoadMore}
              disabled={loading}
              style={{
                width: '100%',
                padding: '12px',
                border: 'none',
                borderTop: '1px solid #e0e0e0',
                backgroundColor: '#f9f9f9',
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
      
      {/* Footer with source filter, target app info, and settings toggle */}
      <div
        style={{
          padding: '10px 16px',
          borderTop: '1px solid #e0e0e0',
          backgroundColor: '#fafafa',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '12px',
          color: '#555',
          userSelect: 'none',
        }}
      >
        {/* Left side: source filter toggle (only in clipboard mode) */}
        {!showSettings ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '2px',
              backgroundColor: '#e8e8e8',
              borderRadius: '6px',
              padding: '2px',
            }}
          >
            {(['all', 'mac', 'ios'] as SourceFilterType[]).map((filterOption) => (
              <button
                key={filterOption}
                onClick={() => setSourceFilter(filterOption)}
                style={{
                  padding: '4px 10px',
                  fontSize: '11px',
                  fontWeight: sourceFilter === filterOption ? 600 : 400,
                  color: sourceFilter === filterOption ? '#fff' : '#555',
                  backgroundColor: sourceFilter === filterOption ? '#007AFF' : 'transparent',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                {filterOption === 'all' ? 'All' : filterOption === 'mac' ? '💻 Mac' : '📱 iOS'}
              </button>
            ))}
          </div>
        ) : (
          <div style={{ flex: 1 }} />
        )}

        {/* Right side: target app info, tab hint, and settings toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {!showSettings && (
            <>
              <span style={{ color: '#888' }}>Paste into:</span>
              <span
                style={{
                  fontWeight: 500,
                  color: '#333',
                  backgroundColor: '#e8e8e8',
                  padding: '3px 8px',
                  borderRadius: '4px',
                }}
              >
                {targetAppInfo.targetApp?.name || 'Select app'}
              </span>
              {targetAppInfo.runningApps.length > 1 && (
                <span style={{ color: '#999', fontSize: '10px' }}>
                  Tab ↹
                </span>
              )}
            </>
          )}
          
          {/* Settings toggle button */}
          <button
            onClick={() => setShowSettings(!showSettings)}
            title={showSettings ? 'Back to Clipboard' : 'Settings'}
            style={{
              width: '28px',
              height: '28px',
              padding: 0,
              backgroundColor: showSettings ? '#007AFF' : 'transparent',
              border: showSettings ? 'none' : '1px solid #d0d0d0',
              borderRadius: '6px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.15s ease',
            }}
          >
            {showSettings ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round">
                <path d="M18 6L6 18" />
                <path d="M6 6l12 12" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
    </div>
  );
}

