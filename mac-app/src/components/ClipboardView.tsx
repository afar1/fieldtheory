/**
 * ClipboardView - Wrapper for local clipboard items.
 * 
 * This component handles:
 * - Fetching data from clipboardAPI (local SQLite)
 * - Source filtering (mac/ios)
 * - Undo/redo for delete and stack operations
 * - Local-specific actions (share to team, paste)
 * 
 * Uses ClipboardList for all rendering and interaction.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import ClipboardList from './ClipboardList';
import { useTheme } from '../contexts/ThemeContext';
import type { BaseClipboardItem, StackInfo } from './ClipboardList/types';
import { KeyCap } from './ClipboardList/components';

// =============================================================================
// Types
// =============================================================================

type ClipboardItemType = 'text' | 'image' | 'transcript' | 'screenshot';
type ClipboardSource = 'mac' | 'ios';
type SourceFilterType = 'all' | 'mac' | 'ios';

// Local clipboard item matches the API shape
interface LocalClipboardItem extends BaseClipboardItem<number> {
  id: number;
  type: ClipboardItemType;
  content: string | null;
  improvedContent: string | null;
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
}

type UndoAction =
  | { type: 'delete'; items: LocalClipboardItem[] }
  | { type: 'stack'; itemIds: number[]; previousStackIds: (string | null)[]; newStackId: string }
  | { type: 'unstack'; itemIds: number[]; previousStackId: string };

interface ClipboardQueryOptions {
  search?: string;
  limit?: number;
  offset?: number;
  source?: ClipboardSource;
}

// =============================================================================
// Props
// =============================================================================

interface ClipboardViewProps {
  onFeedback?: (message: string) => void;
}

// =============================================================================
// Component
// =============================================================================

const ITEMS_PER_PAGE = 50;
const MAX_UNDO = 20;

export default function ClipboardView({ onFeedback }: ClipboardViewProps) {
  const { theme } = useTheme();
  const isMacOS = typeof window !== 'undefined' && window.platform?.isMacOS;

  // Data state
  const [items, setItems] = useState<LocalClipboardItem[]>([]);
  const [stacks, setStacks] = useState<StackInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [offset, setOffset] = useState(0);

  // Search and filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState<SourceFilterType>('all');
  const searchDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Undo/redo state
  const [undoStack, setUndoStack] = useState<UndoAction[]>([]);
  const [redoStack, setRedoStack] = useState<UndoAction[]>([]);

  // Share to team state
  const [sharingToTeam, setSharingToTeam] = useState<number | null>(null);

  // Target app info for paste context
  const [targetAppInfo, setTargetAppInfo] = useState<{
    previousApp: { bundleId: string; name: string } | null;
    runningApps: { bundleId: string; name: string }[];
  }>({ previousApp: null, runningApps: [] });

  // ==========================================================================
  // Debounce search
  // ==========================================================================

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

  // ==========================================================================
  // Data Loading
  // ==========================================================================

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
        setItems(newItems as LocalClipboardItem[]);
        setStacks(stacksData || []);
        setOffset(newItems.length);
      } else {
        setItems(prev => [...prev, ...(newItems as LocalClipboardItem[])]);
        setOffset(prev => prev + newItems.length);
      }

      setHasMore(newItems.length === ITEMS_PER_PAGE);
    } catch (error) {
      console.error('Failed to load clipboard items:', error);
    } finally {
      setLoading(false);
    }
  }, [isMacOS, debouncedSearchQuery, offset, stacks, sourceFilter]);

  // Initial load and search/filter changes
  useEffect(() => {
    setOffset(0);
    loadItems(true);
  }, [debouncedSearchQuery, sourceFilter]);

  // Listen for clipboard events
  useEffect(() => {
    if (!isMacOS || !window.clipboardAPI) return;

    const unsubscribeAdded = window.clipboardAPI.onItemAdded(() => {
      loadItems(true);
    });

    const unsubscribeDeleted = window.clipboardAPI.onItemDeleted((id) => {
      setItems(prev => prev.filter(item => item.id !== id));
    });

    const unsubscribeTargetAppInfo = window.clipboardAPI.onTargetAppInfo?.((info) => {
      setTargetAppInfo({
        previousApp: info.previousApp || null,
        runningApps: info.runningApps || [],
      });
    });

    return () => {
      unsubscribeAdded();
      unsubscribeDeleted();
      unsubscribeTargetAppInfo?.();
    };
  }, [isMacOS, loadItems]);

  // ==========================================================================
  // Undo/Redo
  // ==========================================================================

  const pushUndo = useCallback((action: UndoAction) => {
    setUndoStack(prev => [...prev.slice(-(MAX_UNDO - 1)), action]);
    setRedoStack([]);
  }, []);

  // ==========================================================================
  // Action Handlers
  // ==========================================================================

  const handlePaste = useCallback(async (item: LocalClipboardItem) => {
    if (!window.clipboardAPI) return;
    const bundleId = targetAppInfo?.previousApp?.bundleId;
    await window.clipboardAPI.pasteItem(item.id, bundleId);
    window.clipboardAPI.closeWindow();
  }, [targetAppInfo]);

  const handlePasteStack = useCallback(async (stackItems: LocalClipboardItem[]) => {
    if (!window.clipboardAPI?.pasteStack) return;
    const ids = stackItems.map(i => i.id);
    await window.clipboardAPI.pasteStack(ids);
    await window.clipboardAPI.closeWindow();
  }, []);

  const handleDelete = useCallback(async (ids: (string | number)[]) => {
    if (!window.clipboardAPI) return;

    // Store items for undo
    const itemsToDelete: LocalClipboardItem[] = [];
    for (const id of ids) {
      const item = await window.clipboardAPI.getItem?.(id as number);
      if (item) {
        itemsToDelete.push(item as LocalClipboardItem);
      }
    }

    // Delete items
    for (const id of ids) {
      await window.clipboardAPI.deleteItem(id as number);
    }

    if (itemsToDelete.length > 0) {
      pushUndo({ type: 'delete', items: itemsToDelete });
    }

    loadItems(true);
  }, [loadItems, pushUndo]);

  const handleStack = useCallback(async (ids: (string | number)[], newStackId: string) => {
    if (!window.clipboardAPI?.updateStackId) return;

    // Store previous stack IDs for undo
    const previousStackIds: (string | null)[] = [];
    for (const id of ids) {
      const item = await window.clipboardAPI.getItem?.(id as number);
      previousStackIds.push(item?.stackId ?? null);
    }

    await window.clipboardAPI.updateStackId(ids as number[], newStackId);
    pushUndo({ type: 'stack', itemIds: ids as number[], previousStackIds, newStackId });
    loadItems(true);
  }, [loadItems, pushUndo]);

  const handleUnstack = useCallback(async (stackId: string) => {
    if (!window.clipboardAPI?.queryItemsByStackId || !window.clipboardAPI?.updateStackId) return;

    const stackItems = await window.clipboardAPI.queryItemsByStackId(stackId);
    if (!stackItems?.length) return;

    const itemIds = stackItems.map((i: LocalClipboardItem) => i.id);
    await window.clipboardAPI.updateStackId(itemIds, null);
    pushUndo({ type: 'unstack', itemIds, previousStackId: stackId });
    loadItems(true);
  }, [loadItems, pushUndo]);

  const handleShareToTeam = useCallback(async (item: LocalClipboardItem) => {
    if (!window.sharedClipboardAPI) return;
    setSharingToTeam(item.id);
    await window.sharedClipboardAPI.shareToTeam(item.id);
    setSharingToTeam(null);
    onFeedback?.('Shared to team');
  }, [onFeedback]);

  const handleLoadMore = useCallback(() => {
    if (!loading && hasMore) {
      loadItems(false);
    }
  }, [loading, hasMore, loadItems]);

  // ==========================================================================
  // Render row actions (share to team button)
  // ==========================================================================

  const renderRowActions = useCallback((item: LocalClipboardItem, isHovered: boolean, isSelected: boolean) => {
    if (!isHovered && !isSelected) return null;

    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          handleShareToTeam(item);
        }}
        disabled={sharingToTeam === item.id}
        style={{
          padding: '4px 8px',
          fontSize: '10px',
          backgroundColor: 'transparent',
          color: theme.textSecondary,
          border: `1px solid ${theme.border}`,
          borderRadius: '4px',
          cursor: sharingToTeam === item.id ? 'wait' : 'pointer',
          opacity: sharingToTeam === item.id ? 0.5 : 1,
        }}
      >
        {sharingToTeam === item.id ? 'Sharing...' : 'Share'}
      </button>
    );
  }, [handleShareToTeam, sharingToTeam, theme]);

  // ==========================================================================
  // Filter controls
  // ==========================================================================

  const filterControls = (
    <div style={{
      display: 'flex',
      gap: '8px',
      marginBottom: '8px',
      fontSize: '10px',
    }}>
      {(['all', 'mac', 'ios'] as const).map((filter) => (
        <button
          key={filter}
          onClick={() => setSourceFilter(filter)}
          style={{
            padding: '4px 8px',
            backgroundColor: sourceFilter === filter ? theme.accent : 'transparent',
            color: sourceFilter === filter ? '#fff' : theme.textSecondary,
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '10px',
          }}
        >
          {filter === 'all' ? 'All' : filter === 'mac' ? 'Mac' : 'iOS'}
        </button>
      ))}
    </div>
  );

  // ==========================================================================
  // Render
  // ==========================================================================

  return (
    <ClipboardList
      items={items}
      stacks={stacks}
      loading={loading}
      hasMore={hasMore}
      source="local"
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      onPaste={handlePaste}
      onPasteStack={handlePasteStack}
      onDelete={handleDelete}
      onStack={handleStack}
      onUnstack={handleUnstack}
      onLoadMore={handleLoadMore}
      onFeedback={onFeedback}
      renderRowActions={renderRowActions}
      filterControls={filterControls}
    />
  );
}
