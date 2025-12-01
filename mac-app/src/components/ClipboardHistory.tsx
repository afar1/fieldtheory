// =============================================================================
// ClipboardHistory - Alfred-style clipboard history popup.
// Shows local clipboard history with fuzzy search and multi-select.
// =============================================================================

import { useEffect, useState, useRef, useCallback } from 'react';

type ClipboardItemType = 'text' | 'image' | 'transcript' | 'screenshot';

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
};

type FilterType = 'all' | 'transcript' | 'screenshot';

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
 * ClipboardHistory component - Alfred-style popup for clipboard history.
 */
export default function ClipboardHistory() {
  const [isVisible, setIsVisible] = useState(false);
  const [items, setItems] = useState<ClipboardItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [isMultiSelect, setIsMultiSelect] = useState(false);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [focusedTabIndex, setFocusedTabIndex] = useState(0);
  
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const ITEMS_PER_PAGE = 50;

  const isMacOS = typeof window !== 'undefined' && window.platform?.isMacOS;

  // Load items from clipboard history.
  const loadItems = useCallback(async (reset: boolean = false) => {
    if (!isMacOS || !window.clipboardAPI) {
      return;
    }

    setLoading(true);
    try {
      const queryOptions: any = {
        limit: ITEMS_PER_PAGE,
        offset: reset ? 0 : offset,
      };

      if (filter === 'transcript') {
        queryOptions.type = 'transcript';
      } else if (filter === 'screenshot') {
        queryOptions.type = 'screenshot';
      }

      if (searchQuery.trim()) {
        queryOptions.search = searchQuery.trim();
      }

      const newItems = await window.clipboardAPI.queryItems(queryOptions);
      
      if (reset) {
        setItems(newItems);
        setOffset(newItems.length);
      } else {
        setItems(prev => [...prev, ...newItems]);
        setOffset(prev => prev + newItems.length);
      }

      setHasMore(newItems.length === ITEMS_PER_PAGE);
    } catch (error) {
      console.error('Failed to load clipboard items:', error);
    } finally {
      setLoading(false);
    }
  }, [isMacOS, filter, searchQuery, offset]);

  // Initial load and filter/search changes.
  useEffect(() => {
    if (isVisible) {
      setOffset(0);
      loadItems(true);
    }
  }, [isVisible, filter, searchQuery]);

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
    setTimeout(() => {
      inputRef.current?.focus();
    }, 100);

    // Listen for item additions
    const unsubscribeAdded = window.clipboardAPI.onItemAdded((id) => {
      if (isVisible) {
        loadItems(true);
      }
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
      unsubscribeAdded();
      unsubscribeDeleted();
    };
  }, [isMacOS, isVisible, loadItems]);

  // Handle keyboard navigation.
  useEffect(() => {
    if (!isVisible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Close the window (in standalone mode)
        window.clipboardAPI?.closeWindow();
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(prev => Math.min(prev + 1, items.length - 1));
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(prev => Math.max(prev - 1, 0));
        return;
      }

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (selectedIds.size > 0) {
          // Paste stack
          window.clipboardAPI?.pasteStack(Array.from(selectedIds));
          window.clipboardAPI?.closeWindow();
          setSelectedIds(new Set());
          setIsMultiSelect(false);
        } else if (items[selectedIndex]) {
          // Paste single item
          window.clipboardAPI?.pasteItem(items[selectedIndex].id);
          window.clipboardAPI?.closeWindow();
        }
        return;
      }

      if (e.key === 'Enter' && e.shiftKey) {
        e.preventDefault();
        // Toggle multi-select mode
        setIsMultiSelect(true);
        if (items[selectedIndex]) {
          setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(items[selectedIndex].id)) {
              next.delete(items[selectedIndex].id);
            } else {
              next.add(items[selectedIndex].id);
            }
            return next;
          });
        }
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (e.metaKey || e.ctrlKey) {
          e.preventDefault();
          // Delete selected item
          if (items[selectedIndex]) {
            window.clipboardAPI?.deleteItem(items[selectedIndex].id);
          }
        }
      }

      // Tab navigation between filter tabs
      if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Only handle Tab if not in input field and not with modifiers
        if (document.activeElement !== inputRef.current) {
          e.preventDefault();
          const tabs: FilterType[] = ['all', 'transcript', 'screenshot'];
          const nextIndex = (focusedTabIndex + 1) % tabs.length;
          setFocusedTabIndex(nextIndex);
          setFilter(tabs[nextIndex]);
          setSelectedIndex(0);
          // Focus the tab button
          setTimeout(() => {
            tabRefs.current[nextIndex]?.focus();
          }, 0);
        }
      }

      if (e.key === 'Tab' && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Shift+Tab - go backwards through tabs
        if (document.activeElement !== inputRef.current) {
          e.preventDefault();
          const tabs: FilterType[] = ['all', 'transcript', 'screenshot'];
          const prevIndex = (focusedTabIndex - 1 + tabs.length) % tabs.length;
          setFocusedTabIndex(prevIndex);
          setFilter(tabs[prevIndex]);
          setSelectedIndex(0);
          // Focus the tab button
          setTimeout(() => {
            tabRefs.current[prevIndex]?.focus();
          }, 0);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isVisible, items, selectedIndex, selectedIds, focusedTabIndex, filter]);

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
      window.clipboardAPI?.pasteItem(item.id);
      window.clipboardAPI?.closeWindow();
    }
  };

  // Handle load more.
  const handleLoadMore = () => {
    if (!loading && hasMore) {
      loadItems(false);
    }
  };

  // Handle click outside to close
  useEffect(() => {
    if (!isVisible) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (dialogRef.current && !dialogRef.current.contains(event.target as Node)) {
        // Close the window (in standalone mode)
        window.clipboardAPI?.closeWindow();
      }
    };

    // Use mousedown to catch clicks outside
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isVisible]);

  if (!isVisible) {
    return null;
  }

  const filteredItems = items.filter(item => {
    if (filter === 'transcript' && item.type !== 'transcript') return false;
    if (filter === 'screenshot' && item.type !== 'screenshot') return false;
    return true;
  });

  return (
    <div
      ref={dialogRef}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        padding: '16px',
        backgroundColor: '#ffffff',
        borderRadius: '12px',
        boxShadow: '0 20px 45px rgba(0, 0, 0, 0.25)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      {/* Search input */}
      <input
        ref={inputRef}
        type="text"
        value={searchQuery}
        onChange={(e) => {
          setSearchQuery(e.target.value);
          setSelectedIndex(0);
        }}
        placeholder="Search clipboard history..."
        style={{
          width: '100%',
          padding: '10px 14px',
          border: '1px solid #e0e0e0',
          borderRadius: '8px',
          fontSize: '16px',
          outline: 'none',
          boxSizing: 'border-box',
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
        {(['all', 'transcript', 'screenshot'] as FilterType[]).map((tab, index) => (
          <button
            key={tab}
            ref={(el) => { tabRefs.current[index] = el; }}
            onClick={() => {
              setFilter(tab);
              setSelectedIndex(0);
              setFocusedTabIndex(index);
            }}
            onFocus={() => setFocusedTabIndex(index)}
            style={{
              padding: '8px 16px',
              border: 'none',
              backgroundColor: filter === tab ? '#f0f0f0' : 'transparent',
              cursor: 'pointer',
              textTransform: 'capitalize',
              fontSize: '14px',
              fontWeight: filter === tab ? '600' : '400',
              outline: 'none',
              borderRadius: '8px 8px 0 0',
            }}
          >
            {tab}
          </button>
        ))}
        {selectedIds.size > 0 && (
          <div
            style={{
              marginLeft: 'auto',
              padding: '8px 16px',
              fontSize: '14px',
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
        {filteredItems.length === 0 && !loading ? (
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
          filteredItems.map((item, index) => {
            const isSelected = selectedIndex === index;
            const isInStack = selectedIds.has(item.id);

            return (
              <div
                key={item.id}
                onClick={() => handleItemClick(item, index)}
                style={{
                  padding: '12px 16px',
                  backgroundColor: isSelected ? '#f0f0f0' : 'transparent',
                  borderBottom: '1px solid #f0f0f0',
                  cursor: 'pointer',
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

                {/* Item preview */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  {item.type === 'text' || item.type === 'transcript' ? (
                    <>
                      <div
                        style={{
                          fontSize: '14px',
                          fontWeight: '500',
                          marginBottom: '4px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {item.content ? truncateText(item.content, 80) : 'Empty'}
                      </div>
                      <div
                        style={{
                          fontSize: '12px',
                          color: '#666',
                        }}
                      >
                        {item.wordCount && item.charCount
                          ? `${item.wordCount} words, ${item.charCount} chars`
                          : ''}
                        {item.sourceAppName && ` • ${item.sourceAppName}`}
                        {' • '}
                        {formatRelativeTime(item.createdAt)}
                      </div>
                    </>
                  ) : (
                    <>
                      <div
                        style={{
                          fontSize: '14px',
                          fontWeight: '500',
                          marginBottom: '4px',
                        }}
                      >
                        Screenshot
                      </div>
                      <div
                        style={{
                          fontSize: '12px',
                          color: '#666',
                        }}
                      >
                        {item.imageWidth && item.imageHeight
                          ? `${item.imageWidth}×${item.imageHeight}`
                          : ''}
                        {item.imageSize && ` • ${formatFileSize(item.imageSize)}`}
                        {item.sourceAppName && ` • ${item.sourceAppName}`}
                        {' • '}
                        {formatRelativeTime(item.createdAt)}
                      </div>
                    </>
                  )}
                </div>

                {/* Actions */}
                {item.type === 'transcript' && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      window.clipboardAPI?.separateIntoTasks(item.id);
                      window.clipboardAPI?.closeWindow();
                    }}
                    style={{
                      padding: '4px 8px',
                      fontSize: '12px',
                      backgroundColor: '#007AFF',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                    }}
                  >
                    Tasks
                  </button>
                )}
              </div>
            );
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
              fontSize: '14px',
            }}
          >
            {loading ? 'Loading...' : 'Load More'}
          </button>
        )}
      </div>
    </div>
  );
}

