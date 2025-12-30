/**
 * ClipboardList - Unified list component for clipboard items.
 * 
 * This component handles the rendering and interaction logic for both
 * local (personal) and shared clipboard items. The data fetching and
 * source-specific actions are handled by wrapper components.
 * 
 * Features:
 * - Keyboard navigation (j/k, arrows)
 * - Multi-select (x key)
 * - Drag and drop (stacking)
 * - Preview modal (spacebar)
 * - Scroll-to-top indicator
 * - Search filtering
 */

import React, { 
  useState, 
  useEffect, 
  useRef, 
  useCallback, 
  useMemo,
  ReactNode,
} from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragOverEvent,
  DragEndEvent,
} from '@dnd-kit/core';
import { useTheme } from '../../contexts/ThemeContext';
import type { BaseClipboardItem, StackInfo, ListRow, PreviewContent, DataSource } from './types';
import { 
  formatRelativeTime, 
  formatFileSize, 
  smartTruncateText, 
  combineStackText,
  detectColor,
  getImageUrl,
} from './utils';
import { DraggableDroppableRow, KeyCap } from './components';

// =============================================================================
// Props Interface
// =============================================================================

export interface ClipboardListProps<T extends BaseClipboardItem = BaseClipboardItem> {
  // Data
  items: T[];
  stacks: StackInfo[];
  loading: boolean;
  syncing?: boolean;
  hasMore?: boolean;
  
  // Source identifier (for minor UI differences)
  source: DataSource;
  
  // Search
  searchQuery: string;
  onSearchChange: (query: string) => void;
  
  // Core action callbacks (provided by wrapper)
  onPaste: (item: T) => Promise<void>;
  onPasteStack: (items: T[]) => Promise<void>;
  onDelete: (ids: (string | number)[]) => Promise<void>;
  onStack: (ids: (string | number)[], newStackId: string) => Promise<void>;
  onUnstack: (stackId: string) => Promise<void>;
  onLoadMore?: () => void;
  
  // Feedback callback (wrapper shows toast/feedback)
  onFeedback?: (message: string) => void;
  
  // Source-specific buttons to render in rows
  // Receives item and returns buttons to show on hover
  renderRowActions?: (item: T, isHovered: boolean, isSelected: boolean) => ReactNode;
  
  // Source-specific buttons for the multi-select bar
  renderMultiSelectActions?: (selectedIds: Set<string | number>) => ReactNode;
  
  // Optional: filter controls for local clipboard
  filterControls?: ReactNode;
}

// =============================================================================
// Component
// =============================================================================

export default function ClipboardList<T extends BaseClipboardItem>({
  items,
  stacks,
  loading,
  syncing = false,
  hasMore = false,
  source,
  searchQuery,
  onSearchChange,
  onPaste,
  onPasteStack,
  onDelete,
  onStack,
  onUnstack,
  onLoadMore,
  onFeedback,
  renderRowActions,
  renderMultiSelectActions,
  filterControls,
}: ClipboardListProps<T>) {
  const { theme } = useTheme();
  
  // Refs
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // UI State
  const [containerWidth, setContainerWidth] = useState<number | null>(null);
  const [hasItemsAbove, setHasItemsAbove] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState(searchQuery);
  
  // Selection and navigation state
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string | number>>(new Set());
  const [isMultiSelect, setIsMultiSelect] = useState(false);
  const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null);
  const [keyboardNavActive, setKeyboardNavActive] = useState(false);
  const [hoveredRowIndex, setHoveredRowIndex] = useState<number | null>(null);
  
  // Expansion state
  const [expandedStacks, setExpandedStacks] = useState<Set<string>>(new Set());
  const [expandedItems, setExpandedItems] = useState<Set<string | number>>(new Set());
  
  // Preview state
  const [preview, setPreview] = useState<PreviewContent | null>(null);
  const [previewClosing, setPreviewClosing] = useState(false);
  const [stackPreviewIndex, setStackPreviewIndex] = useState(0);
  const [stackPreviewItems, setStackPreviewItems] = useState<PreviewContent[]>([]);
  
  // Hover state for images
  const [hoveredImageId, setHoveredImageId] = useState<string | number | null>(null);
  
  // Drag and drop state
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [overDropId, setOverDropId] = useState<string | null>(null);
  
  // Pointer sensor with distance activation - must move 5px before drag starts
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    })
  );

  // ==========================================================================
  // Build list rows from items and stacks
  // ==========================================================================
  
  const buildListRows = useCallback((): ListRow<T>[] => {
    const rows: ListRow<T>[] = [];
    const stackItemsMap = new Map<string, T[]>();
    const processedStacks = new Set<string>();

    // Group items by stackId
    for (const item of items) {
      if (item.stackId) {
        const existing = stackItemsMap.get(item.stackId) || [];
        existing.push(item);
        stackItemsMap.set(item.stackId, existing);
      }
    }

    // Build rows - stacks first at their first item's position, then ungrouped items
    for (const item of items) {
      if (item.stackId) {
        if (!processedStacks.has(item.stackId)) {
          const stackItems = stackItemsMap.get(item.stackId) || [];
          const stackInfo = stacks.find(s => s.stackId === item.stackId);
          
          if (stackInfo && stackItems.length > 1) {
            rows.push({
              type: 'stack',
              stack: stackInfo,
              items: stackItems,
              expanded: expandedStacks.has(item.stackId),
            });
          } else if (stackItems.length === 1) {
            // Single item in stack - show as individual item
            rows.push({ type: 'item', item: stackItems[0] });
          }
          processedStacks.add(item.stackId);
        }
        // Skip - already processed as part of stack
      } else {
        // Individual item (not in a stack)
        rows.push({ type: 'item', item });
      }
    }

    return rows;
  }, [items, stacks, expandedStacks]);

  const listRows = useMemo(() => buildListRows(), [buildListRows]);

  // ==========================================================================
  // Effects
  // ==========================================================================

  // Debounce search query
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

  // Track scroll position for "more items above" indicator
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    
    const handleScroll = () => {
      setHasItemsAbove(list.scrollTop > 20);
    };
    
    list.addEventListener('scroll', handleScroll, { passive: true });
    return () => list.removeEventListener('scroll', handleScroll);
  }, []);

  // Measure container width for text truncation
  useEffect(() => {
    if (!listRef.current) return;
    
    const resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    
    resizeObserver.observe(listRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  // Reset selection when list rows change
  useEffect(() => {
    if (selectedIndex >= listRows.length && listRows.length > 0) {
      setSelectedIndex(listRows.length - 1);
    } else if (listRows.length === 0) {
      setSelectedIndex(0);
    }
  }, [listRows.length, selectedIndex]);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current || !keyboardNavActive) return;
    const container = listRef.current;
    const selectedElement = container.children[selectedIndex] as HTMLElement;
    if (selectedElement) {
      selectedElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [selectedIndex, keyboardNavActive]);

  // ==========================================================================
  // Helpers
  // ==========================================================================

  const toggleStackExpanded = useCallback((stackId: string) => {
    setExpandedStacks(prev => {
      const next = new Set(prev);
      if (next.has(stackId)) {
        next.delete(stackId);
      } else {
        next.add(stackId);
      }
      return next;
    });
  }, []);

  const toggleItemExpanded = useCallback((itemId: string | number) => {
    setExpandedItems(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  }, []);

  const dismissPreview = useCallback(() => {
    setPreviewClosing(true);
    setTimeout(() => {
      setPreview(null);
      setPreviewClosing(false);
      setStackPreviewItems([]);
      setStackPreviewIndex(0);
    }, 150);
  }, []);

  const getPreviewForRow = useCallback((row: ListRow<T>): PreviewContent | null => {
    if (row.type === 'item') {
      const item = row.item;
      const imageUrl = getImageUrl(item);
      if (imageUrl) {
        return {
          type: 'image',
          data: item.imageData || '',
          url: imageUrl,
          width: item.imageWidth || 0,
          height: item.imageHeight || 0,
        };
      } else if (item.content) {
        return { type: 'text', content: item.content };
      }
    } else if (row.type === 'stack') {
      // For stacks, show first image or combined text
      const firstImage = row.items.find(i => i.imageData || i.imageUrl);
      if (firstImage) {
        const imageUrl = getImageUrl(firstImage);
        return {
          type: 'image',
          data: firstImage.imageData || '',
          url: imageUrl || undefined,
          width: firstImage.imageWidth || 0,
          height: firstImage.imageHeight || 0,
        };
      }
      const combined = combineStackText(row.items);
      if (combined) {
        return { type: 'text', content: combined };
      }
    }
    return null;
  }, []);

  const getStackPreviewItems = useCallback((stackItems: T[]): PreviewContent[] => {
    const previewItems: PreviewContent[] = [];
    
    // Add each image as a separate preview item
    for (const item of stackItems) {
      const imageUrl = getImageUrl(item);
      if (imageUrl) {
        previewItems.push({
          type: 'image',
          data: item.imageData || '',
          url: imageUrl,
          width: item.imageWidth || 0,
          height: item.imageHeight || 0,
        });
      }
    }
    
    // Add combined text as final item
    const combinedText = combineStackText(stackItems);
    if (combinedText) {
      previewItems.push({ type: 'text', content: combinedText });
    }
    
    return previewItems;
  }, []);

  // ==========================================================================
  // Drag and Drop Handlers
  // ==========================================================================

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

    // Parse drag IDs: "stack:uuid" or "item:id"
    const [activeType, activeId] = (active.id as string).split(':');
    const [overType, overId] = (over.id as string).split(':');

    if (activeType === 'item') {
      if (overType === 'stack') {
        // Item dropped on stack -> add to stack
        await onStack([activeId], overId);
      } else if (overType === 'item' && activeId !== overId) {
        // Item dropped on item -> create new stack
        const newStackId = crypto.randomUUID();
        await onStack([activeId, overId], newStackId);
      }
    } else if (activeType === 'stack') {
      if (overType === 'stack' && activeId !== overId) {
        // Stack dropped on stack -> merge
        const stackItems = items.filter(i => i.stackId === activeId);
        if (stackItems.length) {
          const itemIds = stackItems.map(i => i.id);
          await onStack(itemIds, overId);
        }
      } else if (overType === 'item') {
        // Stack dropped on item -> add item to stack
        await onStack([overId], activeId);
      }
    }
  }, [items, onStack]);

  // ==========================================================================
  // Keyboard Navigation
  // ==========================================================================

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key;
      const hasMeta = e.metaKey;
      const hasShift = e.shiftKey;
      const hasCtrl = e.ctrlKey;
      const hasAlt = e.altKey;

      // / - Focus search input (from anywhere)
      if (key === '/' && !hasMeta && !hasCtrl && !hasAlt && !hasShift) {
        if (document.activeElement?.tagName?.match(/INPUT|TEXTAREA/)) return;
        e.preventDefault();
        inputRef.current?.focus();
        return;
      }

      // Skip if typing in input (for all other shortcuts)
      if (document.activeElement?.tagName?.match(/INPUT|TEXTAREA/)) {
        // Escape blurs input
        if (key === 'Escape') {
          e.preventDefault();
          (document.activeElement as HTMLElement).blur();
          setSelectedIndex(0);
        }
        return;
      }

      // Escape - dismiss preview, clear selection, or signal close
      if (key === 'Escape') {
        if (preview) {
          e.preventDefault();
          dismissPreview();
          return;
        }
        if (selectedIds.size > 0) {
          e.preventDefault();
          setSelectedIds(new Set());
          setIsMultiSelect(false);
          return;
        }
        // Let parent handle window close
        return;
      }

      // Navigation requires items
      if (listRows.length === 0) return;

      const selectedRow = listRows[selectedIndex];

      // j/ArrowDown - Move selection down
      if (key === 'j' || key === 'ArrowDown') {
        e.preventDefault();
        setKeyboardNavActive(true);
        const newIndex = Math.min(selectedIndex + 1, listRows.length - 1);
        setSelectedIndex(newIndex);
        
        // Update preview if open
        if (preview && newIndex !== selectedIndex) {
          const newRow = listRows[newIndex];
          if (newRow) {
            if (newRow.type === 'stack') {
              const previewItems = getStackPreviewItems(newRow.items);
              if (previewItems.length > 0) {
                setStackPreviewItems(previewItems);
                setStackPreviewIndex(0);
                setPreview(previewItems[0]);
              }
            } else {
              setStackPreviewItems([]);
              setStackPreviewIndex(0);
              const newContent = getPreviewForRow(newRow);
              if (newContent) setPreview(newContent);
            }
          }
        }
        return;
      }

      // k/ArrowUp - Move selection up
      if (key === 'k' || key === 'ArrowUp') {
        e.preventDefault();
        setKeyboardNavActive(true);
        const newIndex = Math.max(selectedIndex - 1, 0);
        setSelectedIndex(newIndex);
        
        // Update preview if open
        if (preview && newIndex !== selectedIndex) {
          const newRow = listRows[newIndex];
          if (newRow) {
            if (newRow.type === 'stack') {
              const previewItems = getStackPreviewItems(newRow.items);
              if (previewItems.length > 0) {
                setStackPreviewItems(previewItems);
                setStackPreviewIndex(0);
                setPreview(previewItems[0]);
              }
            } else {
              setStackPreviewItems([]);
              setStackPreviewIndex(0);
              const newContent = getPreviewForRow(newRow);
              if (newContent) setPreview(newContent);
            }
          }
        }
        return;
      }

      // Enter - Paste selected item/stack
      if (key === 'Enter' && !hasMeta && !hasShift) {
        e.preventDefault();
        if (selectedRow?.type === 'item') {
          onPaste(selectedRow.item);
        } else if (selectedRow?.type === 'stack') {
          onPasteStack(selectedRow.items);
        }
        return;
      }

      // Spacebar - Toggle preview
      if (key === ' ' || key === 'Spacebar') {
        e.preventDefault();
        
        if (preview) {
          dismissPreview();
          return;
        }
        
        if (selectedRow) {
          if (selectedRow.type === 'stack') {
            const previewItems = getStackPreviewItems(selectedRow.items);
            if (previewItems.length > 0) {
              setStackPreviewItems(previewItems);
              setStackPreviewIndex(0);
              setPreview(previewItems[0]);
            }
          } else {
            setStackPreviewItems([]);
            setStackPreviewIndex(0);
            const previewContent = getPreviewForRow(selectedRow);
            if (previewContent) {
              setPreview(previewContent);
            }
          }
        }
        return;
      }

      // x - Toggle selection (Gmail-style multi-select)
      if (key === 'x' && !hasMeta && !hasCtrl && !hasAlt && !hasShift) {
        e.preventDefault();
        
        const idsToToggle: (string | number)[] = [];
        if (selectedRow?.type === 'item') {
          idsToToggle.push(selectedRow.item.id);
        } else if (selectedRow?.type === 'stack') {
          selectedRow.items.forEach(i => idsToToggle.push(i.id));
        }
        
        setSelectedIds(prev => {
          const next = new Set(prev);
          const allSelected = idsToToggle.every(id => next.has(id));
          if (allSelected) {
            idsToToggle.forEach(id => next.delete(id));
          } else {
            idsToToggle.forEach(id => next.add(id));
          }
          return next;
        });
        setLastClickedIndex(selectedIndex);
        setIsMultiSelect(true);
        return;
      }

      // s - Stack selected items
      if (key === 's' && !hasMeta && !hasCtrl && !hasAlt && !hasShift) {
        if (selectedIds.size > 1) {
          e.preventDefault();
          const newStackId = crypto.randomUUID();
          const itemIds = Array.from(selectedIds);
          onStack(itemIds, newStackId);
          setSelectedIds(new Set());
          setIsMultiSelect(false);
          onFeedback?.(`${itemIds.length} items stacked`);
        }
        return;
      }

      // u - Unstack selected stack
      if (key === 'u' && !hasMeta && !hasCtrl && !hasAlt && !hasShift) {
        if (selectedRow?.type === 'stack' && selectedRow.items.length > 1) {
          e.preventDefault();
          onUnstack(selectedRow.stack.stackId);
          onFeedback?.('Stack unstacked');
        }
        return;
      }

      // e/h - Toggle expand/collapse
      if ((key === 'e' || key === 'h') && !hasMeta && !hasCtrl && !hasAlt && !hasShift) {
        e.preventDefault();
        
        if (selectedIds.size > 0) {
          selectedIds.forEach(itemId => {
            toggleItemExpanded(itemId);
          });
          return;
        }
        
        if (selectedRow?.type === 'stack') {
          toggleStackExpanded(selectedRow.stack.stackId);
        } else if (selectedRow?.type === 'item') {
          toggleItemExpanded(selectedRow.item.id);
        }
        return;
      }

      // Delete/Backspace - Delete selected item(s)
      if (key === 'Delete' || key === 'Backspace') {
        e.preventDefault();
        
        if (selectedIds.size > 0) {
          onDelete(Array.from(selectedIds));
          setSelectedIds(new Set());
          setIsMultiSelect(false);
          onFeedback?.(`${selectedIds.size} items deleted`);
        } else if (selectedRow?.type === 'item') {
          onDelete([selectedRow.item.id]);
          onFeedback?.('Item deleted');
        } else if (selectedRow?.type === 'stack') {
          onDelete(selectedRow.items.map(i => i.id));
          onFeedback?.('Stack deleted');
        }
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    listRows, 
    selectedIndex, 
    selectedIds, 
    preview, 
    dismissPreview, 
    getPreviewForRow, 
    getStackPreviewItems,
    onPaste,
    onPasteStack,
    onDelete,
    onStack,
    onUnstack,
    onFeedback,
    toggleStackExpanded,
    toggleItemExpanded,
  ]);

  // ==========================================================================
  // Render
  // ==========================================================================

  return (
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
      <div style={{ 
        position: 'relative',
        marginBottom: selectedIds.size > 0 ? '0' : '8px',
        transition: 'margin-bottom 0.15s ease',
      }}>
        <input
          ref={inputRef}
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
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
          }}
        />
        {/* Custom placeholder */}
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

      {/* Filter controls (passed from wrapper) */}
      {filterControls}

      {/* Multi-select action bar */}
      {selectedIds.size > 0 && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '6px 0',
          fontSize: '11px',
          color: theme.textSecondary,
        }}>
          <span style={{ color: theme.text, fontWeight: 500 }}>
            {selectedIds.size} selected
          </span>
          
          <button
            onClick={() => {
              onDelete(Array.from(selectedIds));
              setSelectedIds(new Set());
              setIsMultiSelect(false);
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
            delete <KeyCap small>⌫</KeyCap>
          </button>
          
          {selectedIds.size > 1 && (
            <button
              onClick={async () => {
                const newStackId = crypto.randomUUID();
                const itemIds = Array.from(selectedIds);
                await onStack(itemIds, newStackId);
                setSelectedIds(new Set());
                setIsMultiSelect(false);
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
          
          {/* Source-specific multi-select actions */}
          {renderMultiSelectActions?.(selectedIds)}
          
          <button
            onClick={() => {
              setSelectedIds(new Set());
              setIsMultiSelect(false);
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

      {/* Items list */}
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {/* Scroll indicator: more items above */}
          {hasItemsAbove && (
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
                cursor: 'pointer',
                pointerEvents: 'auto',
              }}
            >
              <span style={{
                fontSize: 10,
                color: theme.textSecondary,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}>
                <span style={{ transform: 'rotate(180deg)', display: 'inline-block' }}>▼</span>
                scroll to top
              </span>
            </div>
          )}
          
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
              <div style={{ padding: '40px', textAlign: 'center', color: theme.textSecondary }}>
                {searchQuery ? 'No items match your search' : 'No items yet'}
              </div>
            ) : (
              <>
                {listRows.map((row, index) => {
                  const isRowSelected = selectedIndex === index;
                  const isHovered = hoveredRowIndex === index;
                  
                  // Check if this row's items are multi-selected
                  const isMultiSelected = row.type === 'stack'
                    ? row.items.some(item => selectedIds.has(item.id))
                    : selectedIds.has(row.item.id);

                  const rowStyle: React.CSSProperties = {
                    display: 'flex',
                    flexDirection: 'column',
                    padding: '12px 16px',
                    backgroundColor: isMultiSelected 
                      ? (theme.isDark ? 'rgba(45, 212, 191, 0.15)' : 'rgba(20, 184, 166, 0.1)')
                      : isRowSelected 
                        ? theme.bgSecondary 
                        : 'transparent',
                    borderTop: isRowSelected 
                      ? `1px solid ${theme.isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)'}` 
                      : '1px solid transparent',
                    borderBottom: isRowSelected 
                      ? `1px solid ${theme.isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)'}` 
                      : `1px solid ${theme.border}`,
                    borderRight: isRowSelected 
                      ? `1px solid ${theme.isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)'}` 
                      : '1px solid transparent',
                    borderLeft: isRowSelected && isMultiSelected
                      ? `4px solid ${theme.isDark ? '#2dd4bf' : '#14b8a6'}`
                      : isRowSelected
                        ? `2px solid ${theme.isDark ? '#2dd4bf' : '#14b8a6'}`
                        : isMultiSelected
                          ? `2px solid ${theme.isDark ? '#2dd4bf80' : '#14b8a680'}`
                          : '2px solid transparent',
                    boxShadow: isRowSelected
                      ? theme.isDark 
                        ? '0 2px 8px rgba(0,0,0,0.3)' 
                        : '0 2px 8px rgba(0,0,0,0.08)'
                      : 'none',
                    transition: 'background-color 0.1s ease, border-left 0.1s ease',
                    cursor: 'pointer',
                    userSelect: 'none',
                  };

                  if (row.type === 'stack') {
                    const { stack, items: stackItems, expanded } = row;
                    const stackImages = stackItems.filter(i => i.imageData || i.imageUrl);
                    const combinedText = combineStackText(stackItems);
                    const hasText = combinedText.length > 0;
                    const truncated = hasText ? smartTruncateText(combinedText, 15, containerWidth) : null;
                    const isStackExpanded = expandedStacks.has(stack.stackId);
                    
                    const stackDragId = `stack:${stack.stackId}`;
                    const isStackDragging = activeDragId === stackDragId;
                    const isStackOver = overDropId === stackDragId;

                    return (
                      <DraggableDroppableRow
                        key={`stack-${stack.stackId}`}
                        id={stackDragId}
                        isDragging={isStackDragging}
                        isOver={isStackOver && !isStackDragging}
                        style={rowStyle}
                        onMouseEnter={() => {
                          setHoveredRowIndex(index);
                          if (!keyboardNavActive) setSelectedIndex(index);
                        }}
                        onMouseLeave={() => setHoveredRowIndex(null)}
                        onClick={() => {
                          setKeyboardNavActive(false);
                          setSelectedIndex(index);
                        }}
                        onDoubleClick={() => {
                          onPasteStack(stackItems);
                        }}
                      >
                        {/* Stack header */}
                        <div style={{ 
                          display: 'flex', 
                          alignItems: 'center', 
                          gap: '8px',
                          marginBottom: (stackImages.length > 0 || hasText) ? '8px' : 0,
                        }}>
                          <span style={{ 
                            fontSize: '10px', 
                            color: theme.accent,
                            fontWeight: 500,
                          }}>
                            {stack.itemCount} items
                          </span>
                          <span style={{ fontSize: '10px', color: theme.textSecondary }}>
                            {formatRelativeTime(stack.createdAt)}
                          </span>
                          
                          {/* Row actions */}
                          {(isRowSelected || isHovered) && renderRowActions && (
                            <div style={{ marginLeft: 'auto', display: 'flex', gap: '4px' }}>
                              {renderRowActions(stackItems[0], isHovered, isRowSelected)}
                            </div>
                          )}
                        </div>

                        {/* Stack images */}
                        {stackImages.length > 0 && (
                          <div style={{ 
                            display: 'flex', 
                            gap: '6px', 
                            flexWrap: 'wrap',
                            marginBottom: hasText ? '8px' : 0,
                          }}>
                            {stackImages.slice(0, 4).map((img, imgIndex) => {
                              const imgUrl = getImageUrl(img);
                              return (
                                <div
                                  key={`${img.id}-${imgIndex}`}
                                  style={{
                                    width: '48px',
                                    height: '48px',
                                    borderRadius: '4px',
                                    overflow: 'hidden',
                                    border: `1px solid ${theme.border}`,
                                  }}
                                  onMouseEnter={() => setHoveredImageId(img.id)}
                                  onMouseLeave={() => setHoveredImageId(null)}
                                >
                                  {imgUrl && (
                                    <img
                                      src={imgUrl}
                                      alt=""
                                      style={{
                                        width: '100%',
                                        height: '100%',
                                        objectFit: 'cover',
                                      }}
                                    />
                                  )}
                                </div>
                              );
                            })}
                            {stackImages.length > 4 && (
                              <div style={{
                                width: '48px',
                                height: '48px',
                                borderRadius: '4px',
                                backgroundColor: theme.bgSecondary,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '10px',
                                color: theme.textSecondary,
                              }}>
                                +{stackImages.length - 4}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Stack text preview */}
                        {hasText && truncated && (
                          <div style={{ fontSize: '12px', color: theme.text, lineHeight: 1.4 }}>
                            {isStackExpanded ? (
                              <span style={{ whiteSpace: 'pre-wrap' }}>{truncated.fullText}</span>
                            ) : truncated.needsTruncation ? (
                              <>
                                <span>{truncated.firstPart}</span>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleStackExpanded(stack.stackId);
                                  }}
                                  style={{
                                    background: theme.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)',
                                    border: 'none',
                                    padding: '2px 8px',
                                    borderRadius: '4px',
                                    fontSize: '10px',
                                    color: theme.textSecondary,
                                    cursor: 'pointer',
                                    margin: '0 4px',
                                  }}
                                >
                                  Show more
                                </button>
                                <span style={{ color: theme.textSecondary }}>{truncated.lastPart}</span>
                              </>
                            ) : (
                              <span>{truncated.fullText}</span>
                            )}
                          </div>
                        )}
                      </DraggableDroppableRow>
                    );
                  } else {
                    // Single item row
                    const item = row.item;
                    const imageUrl = getImageUrl(item);
                    const hasImage = !!imageUrl;
                    const hasText = !!(item.content || item.improvedContent);
                    const displayText = item.improvedContent || item.content || '';
                    const truncated = hasText ? smartTruncateText(displayText, 15, containerWidth) : null;
                    const isItemExpanded = expandedItems.has(item.id);
                    const colorValue = detectColor(item.content);
                    
                    const itemDragId = `item:${item.id}`;
                    const isItemDragging = activeDragId === itemDragId;
                    const isItemOver = overDropId === itemDragId;

                    return (
                      <DraggableDroppableRow
                        key={`item-${item.id}`}
                        id={itemDragId}
                        isDragging={isItemDragging}
                        isOver={isItemOver && !isItemDragging}
                        style={rowStyle}
                        onMouseEnter={() => {
                          setHoveredRowIndex(index);
                          if (!keyboardNavActive) setSelectedIndex(index);
                        }}
                        onMouseLeave={() => setHoveredRowIndex(null)}
                        onClick={() => {
                          setKeyboardNavActive(false);
                          setSelectedIndex(index);
                        }}
                        onDoubleClick={() => {
                          onPaste(item);
                        }}
                      >
                        {/* Item header */}
                        <div style={{ 
                          display: 'flex', 
                          alignItems: 'center', 
                          gap: '8px',
                          marginBottom: (hasImage || hasText) ? '8px' : 0,
                        }}>
                          {/* Item type indicator */}
                          <span style={{ 
                            fontSize: '10px', 
                            color: theme.textSecondary,
                          }}>
                            {item.type === 'transcript' ? 'transcript' : 
                             item.type === 'screenshot' ? 'screenshot' : 
                             hasImage ? 'image' : 'text'}
                          </span>
                          
                          {/* Source app */}
                          {item.sourceAppName && (
                            <span style={{ fontSize: '10px', color: theme.textSecondary }}>
                              from {item.sourceAppName}
                            </span>
                          )}
                          
                          <span style={{ fontSize: '10px', color: theme.textSecondary }}>
                            {formatRelativeTime(item.createdAt)}
                          </span>

                          {/* Color swatch if detected */}
                          {colorValue && (
                            <div style={{
                              width: '14px',
                              height: '14px',
                              borderRadius: '3px',
                              backgroundColor: colorValue,
                              border: `1px solid ${theme.border}`,
                            }} />
                          )}
                          
                          {/* Row actions */}
                          {(isRowSelected || isHovered) && renderRowActions && (
                            <div style={{ marginLeft: 'auto', display: 'flex', gap: '4px' }}>
                              {renderRowActions(item, isHovered, isRowSelected)}
                            </div>
                          )}
                        </div>

                        {/* Image */}
                        {hasImage && (
                          <div
                            style={{
                              width: '80px',
                              height: '60px',
                              borderRadius: '4px',
                              overflow: 'hidden',
                              border: `1px solid ${theme.border}`,
                              marginBottom: hasText ? '8px' : 0,
                            }}
                            onMouseEnter={() => setHoveredImageId(item.id)}
                            onMouseLeave={() => setHoveredImageId(null)}
                          >
                            <img
                              src={imageUrl}
                              alt=""
                              style={{
                                width: '100%',
                                height: '100%',
                                objectFit: 'cover',
                              }}
                            />
                          </div>
                        )}

                        {/* Text content */}
                        {hasText && truncated && (
                          <div style={{ fontSize: '12px', color: theme.text, lineHeight: 1.4 }}>
                            {isItemExpanded ? (
                              <span style={{ whiteSpace: 'pre-wrap' }}>{truncated.fullText}</span>
                            ) : truncated.needsTruncation ? (
                              <>
                                <span>{truncated.firstPart}</span>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleItemExpanded(item.id);
                                  }}
                                  style={{
                                    background: theme.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)',
                                    border: 'none',
                                    padding: '2px 8px',
                                    borderRadius: '4px',
                                    fontSize: '10px',
                                    color: theme.textSecondary,
                                    cursor: 'pointer',
                                    margin: '0 4px',
                                  }}
                                >
                                  Show more
                                </button>
                                <span style={{ color: theme.textSecondary }}>{truncated.lastPart}</span>
                              </>
                            ) : (
                              <span>{truncated.fullText}</span>
                            )}
                          </div>
                        )}
                      </DraggableDroppableRow>
                    );
                  }
                })}
                
                {/* Load more button */}
                {hasMore && onLoadMore && (
                  <div style={{ padding: '16px', textAlign: 'center' }}>
                    <button
                      onClick={onLoadMore}
                      disabled={loading}
                      style={{
                        padding: '8px 16px',
                        fontSize: '12px',
                        backgroundColor: theme.bgSecondary,
                        color: theme.text,
                        border: `1px solid ${theme.border}`,
                        borderRadius: '6px',
                        cursor: loading ? 'wait' : 'pointer',
                      }}
                    >
                      {loading ? 'Loading...' : 'Load more'}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </DndContext>

      {/* Preview modal */}
      {preview && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            animation: previewClosing ? 'previewFadeOut 0.15s ease' : 'previewFadeIn 0.15s ease',
          }}
          onClick={dismissPreview}
        >
          <div
            style={{
              maxWidth: '90%',
              maxHeight: '90%',
              backgroundColor: theme.bg,
              borderRadius: '8px',
              overflow: 'hidden',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {preview.type === 'image' ? (
              <img
                src={preview.url || `data:image/png;base64,${preview.data}`}
                alt="Preview"
                style={{
                  maxWidth: '100%',
                  maxHeight: '80vh',
                  objectFit: 'contain',
                }}
              />
            ) : (
              <div style={{
                padding: '24px',
                maxHeight: '80vh',
                overflow: 'auto',
                fontSize: '14px',
                color: theme.text,
                whiteSpace: 'pre-wrap',
              }}>
                {preview.content}
              </div>
            )}
          </div>
          
          {/* Stack preview navigation indicator */}
          {stackPreviewItems.length > 1 && (
            <div style={{
              position: 'absolute',
              bottom: '24px',
              display: 'flex',
              gap: '4px',
            }}>
              {stackPreviewItems.map((_, i) => (
                <div
                  key={i}
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    backgroundColor: i === stackPreviewIndex ? theme.accent : 'rgba(255,255,255,0.3)',
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Re-export types for convenience
export * from './types';
export * from './utils';
