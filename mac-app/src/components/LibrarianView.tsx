// =============================================================================
// LibrarianView - iA Writer-style reading experience for collected readings.
// Named after the AI assistant in Snow Crash that provides contextual intel.
// =============================================================================

import { useEffect, useState, useRef, useCallback } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import ReactMarkdown from 'react-markdown';
import { fonts } from '../design/tokens';

interface LibrarianViewProps {
  onSwitchToClipboard: () => void;
  onSwitchToSettings?: () => void;
  onFullScreenChange?: (isFullScreen: boolean) => void;
}

/**
 * Format timestamp to date grouping.
 */
function formatDateGroup(timestamp: number): string {
  const date = new Date(timestamp);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const itemDate = new Date(date);
  itemDate.setHours(0, 0, 0, 0);

  if (itemDate.getTime() === today.getTime()) {
    return 'Today';
  } else if (itemDate.getTime() === yesterday.getTime()) {
    return 'Yesterday';
  } else {
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  }
}

/**
 * Group readings by date.
 */
function groupByDate(readings: ReadingMeta[]): Map<string, ReadingMeta[]> {
  const groups = new Map<string, ReadingMeta[]>();

  for (const reading of readings) {
    const group = formatDateGroup(reading.createdAt);
    if (!groups.has(group)) {
      groups.set(group, []);
    }
    groups.get(group)!.push(reading);
  }

  return groups;
}

export default function LibrarianView({ onSwitchToClipboard, onSwitchToSettings, onFullScreenChange }: LibrarianViewProps) {
  const { theme } = useTheme();

  // State
  // Path is now the identity - no numeric IDs
  const [readings, setReadings] = useState<ReadingMeta[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedReading, setSelectedReading] = useState<Reading | null>(null);
  const [loading, setLoading] = useState(true);

  // Edit mode state
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [textSize, setTextSize] = useState<'small' | 'normal' | 'large'>(() => {
    const saved = localStorage.getItem('librarian-text-size');
    return (saved === 'small' || saved === 'normal' || saved === 'large') ? saved : 'normal';
  });
  const [isFullScreen, setIsFullScreen] = useState(() => {
    return localStorage.getItem('librarian-fullscreen') === 'true';
  });
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('librarian-sidebar-width');
    return saved ? parseInt(saved, 10) : 180;
  });
  const [isResizing, setIsResizing] = useState(false);
  const [hoveredPath, setHoveredPath] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Persist text size preference
  useEffect(() => {
    localStorage.setItem('librarian-text-size', textSize);
  }, [textSize]);

  // Persist full-screen preference
  useEffect(() => {
    localStorage.setItem('librarian-fullscreen', String(isFullScreen));
  }, [isFullScreen]);

  // Persist sidebar width
  useEffect(() => {
    localStorage.setItem('librarian-sidebar-width', String(sidebarWidth));
  }, [sidebarWidth]);

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

  // Text size values
  const textSizes = {
    small: { base: '14px', h1: '24px', h2: '18px', h3: '15px' },
    normal: { base: '16px', h1: '28px', h2: '20px', h3: '17px' },
    large: { base: '18px', h1: '32px', h2: '24px', h3: '20px' },
  };

  // Check if content has been modified
  const isDirty = isEditing && editContent !== (selectedReading?.content ?? '');

  // Enter edit mode
  const enterEditMode = useCallback(() => {
    if (selectedReading) {
      setEditContent(selectedReading.content);
      setIsEditing(true);
    }
  }, [selectedReading]);

  // Exit edit mode (discard changes)
  const exitEditMode = useCallback(() => {
    setIsEditing(false);
    setEditContent('');
  }, []);

  // Save changes
  const saveChanges = useCallback(async () => {
    if (!selectedReading || !isDirty) return;

    setIsSaving(true);
    try {
      const success = await window.librarianAPI?.saveReading(selectedReading.path, editContent);
      if (success) {
        setIsEditing(false);
        setEditContent('');
        // Reload the reading to get updated content
        const updated = await window.librarianAPI?.getReading(selectedReading.path);
        if (updated) {
          setSelectedReading(updated);
        }
      }
    } finally {
      setIsSaving(false);
    }
  }, [selectedReading, editContent, isDirty]);

  // Handle navigation with unsaved changes
  const handleSelectReading = useCallback((path: string) => {
    if (isDirty) {
      const confirmed = window.confirm('You have unsaved changes. Discard them?');
      if (!confirmed) return;
      exitEditMode();
    }
    setSelectedPath(path);
  }, [isDirty, exitEditMode]);

  // Load readings on mount
  useEffect(() => {
    async function loadReadings() {
      const result = await window.librarianAPI?.getReadings();
      if (result) {
        setReadings(result);
        // Select first reading if any
        if (result.length > 0 && selectedPath === null) {
          setSelectedPath(result[0].path);
        }
      }
      setLoading(false);
    }
    loadReadings();
  }, []);

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

  // Listen for new readings
  useEffect(() => {
    const unsubscribe = window.librarianAPI?.onReadingAdded((reading) => {
      setReadings((prev) => [
        {
          path: reading.path,
          title: reading.title,
          context: reading.context,
          readingTime: reading.readingTime,
          createdAt: reading.createdAt,
          mtime: reading.mtime,
        },
        ...prev,
      ]);
      // Auto-select the new reading
      setSelectedPath(reading.path);
    });

    return () => unsubscribe?.();
  }, []);

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
          setSelectedPath(newReadings[newIndex].path);
        } else if (selectedPath === filePath) {
          setSelectedPath(null);
        }
        return newReadings;
      });
    });

    return () => unsubscribe?.();
  }, [selectedPath]);

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
      // Cmd+E - toggle edit mode
      if (e.key === 'e' && e.metaKey && !e.shiftKey) {
        e.preventDefault();
        if (isEditing) {
          if (isDirty) {
            const confirmed = window.confirm('You have unsaved changes. Discard them?');
            if (!confirmed) return;
          }
          exitEditMode();
        } else if (selectedReading) {
          enterEditMode();
        }
        return;
      }

      // Cmd+S - save while editing
      if (e.key === 's' && e.metaKey && isEditing) {
        e.preventDefault();
        saveChanges();
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

      // Toggle immersive/fullscreen mode with 'f' (not in edit mode)
      if (e.key === 'f' && !e.metaKey && !e.ctrlKey && !isEditing) {
        e.preventDefault();
        setIsFullScreen((prev) => !prev);
        return;
      }

      // Escape: exit edit mode first, then fullscreen, then switch to clipboard
      if (e.key === 'Escape') {
        if (isEditing) {
          if (isDirty) {
            const confirmed = window.confirm('You have unsaved changes. Discard them?');
            if (!confirmed) return;
          }
          exitEditMode();
        } else if (isFullScreen) {
          setIsFullScreen(false);
        } else {
          onSwitchToClipboard();
        }
        return;
      }

      // Don't handle navigation keys in edit mode (textarea needs them)
      if (isEditing) return;

      if (readings.length === 0) return;

      const currentIndex = readings.findIndex((r) => r.path === selectedPath);

      if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        const newIndex = Math.max(0, currentIndex - 1);
        handleSelectReading(readings[newIndex].path);
      } else if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        const newIndex = Math.min(readings.length - 1, currentIndex + 1);
        handleSelectReading(readings[newIndex].path);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [readings, selectedPath, isFullScreen, isEditing, isDirty, selectedReading, onSwitchToClipboard, enterEditMode, exitEditMode, saveChanges, handleSelectReading]);

  // Focus container on mount
  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  // Listen for show reading requests (auto-show on new reading)
  useEffect(() => {
    const unsubscribe = window.librarianAPI?.onShowReading((readingPath) => {
      setSelectedPath(readingPath);
      setIsFullScreen(false);
    });

    return () => unsubscribe?.();
  }, []);

  // Group readings by date
  const groupedReadings = groupByDate(readings);

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
          No readings yet
        </div>
        <div style={{ fontSize: '13px', marginBottom: '24px', maxWidth: '280px' }}>
          Add a watched directory in Settings to start collecting readings from your coding sessions.
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
        backgroundColor: theme.bg,
      }}
    >
      {/* Sidebar - hidden in full-screen mode */}
      {!isFullScreen && (
      <>
      <div
        style={{
          width: `${sidebarWidth}px`,
          minWidth: `${sidebarWidth}px`,
          overflowY: 'auto',
          padding: '12px 0',
          userSelect: isResizing ? 'none' : 'auto',
        }}
      >
        <div
          style={{
            padding: '0 12px 8px',
            fontSize: '11px',
            fontWeight: 600,
            color: theme.textSecondary,
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          <button
            onClick={() => setIsFullScreen(true)}
            style={{
              padding: '2px 4px',
              fontSize: '12px',
              color: theme.textSecondary,
              backgroundColor: 'transparent',
              border: 'none',
              cursor: 'pointer',
              lineHeight: 1,
            }}
            title="Collapse sidebar"
          >
            ☰
          </button>
          <span>Readings</span>
        </div>

        {Array.from(groupedReadings.entries()).map(([date, items]) => (
          <div key={date}>
            {/* Date header with horizontal rule */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '12px 12px 6px',
              }}
            >
              <span
                style={{
                  fontSize: '10px',
                  fontWeight: 600,
                  color: theme.textSecondary,
                  flexShrink: 0,
                }}
              >
                {date}
              </span>
              <div
                style={{
                  flex: 1,
                  height: '1px',
                  backgroundColor: theme.isDark
                    ? 'rgba(255,255,255,0.08)'
                    : 'rgba(0,0,0,0.08)',
                }}
              />
            </div>
            {/* Reading items - indented under date */}
            {items.map((reading) => (
              <div
                key={reading.path}
                onClick={() => handleSelectReading(reading.path)}
                onMouseEnter={() => setHoveredPath(reading.path)}
                onMouseLeave={() => setHoveredPath(null)}
                style={{
                  padding: '8px 8px 8px 16px',
                  cursor: 'pointer',
                  backgroundColor:
                    reading.path === selectedPath
                      ? theme.isDark
                        ? 'rgba(255,255,255,0.08)'
                        : 'rgba(0,0,0,0.05)'
                      : 'transparent',
                  borderLeft:
                    reading.path === selectedPath
                      ? `2px solid ${theme.accent}`
                      : '2px solid transparent',
                  transition: 'background-color 0.1s ease',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '4px',
                  }}
                >
                  <div
                    style={{
                      fontSize: '12px',
                      fontWeight: 500,
                      color: theme.text,
                      lineHeight: 1.3,
                      flex: 1,
                      minWidth: 0,
                    }}
                  >
                    {reading.title}
                  </div>
                  {/* Always reserve space for folder icon to prevent text shift */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      window.shellAPI?.showItemInFolder(reading.path);
                    }}
                    style={{
                      padding: '0',
                      width: '16px',
                      height: '16px',
                      fontSize: '10px',
                      color: theme.textSecondary,
                      backgroundColor: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      flexShrink: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: '3px',
                      opacity: hoveredPath === reading.path ? 0.7 : 0,
                      transition: 'opacity 0.1s ease',
                      pointerEvents: hoveredPath === reading.path ? 'auto' : 'none',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.opacity = '1';
                      e.currentTarget.style.backgroundColor = theme.isDark
                        ? 'rgba(255,255,255,0.1)'
                        : 'rgba(0,0,0,0.05)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.opacity = '0.7';
                      e.currentTarget.style.backgroundColor = 'transparent';
                    }}
                    title="Show in Finder"
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 16 16"
                      fill="currentColor"
                    >
                      <path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h2.764c.958 0 1.76.56 2.311 1.184C7.985 3.648 8.48 4 9 4h4.5A1.5 1.5 0 0 1 15 5.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12.5v-9zM2.5 3a.5.5 0 0 0-.5.5V6h12v-.5a.5.5 0 0 0-.5-.5H9c-.964 0-1.71-.629-2.174-1.154C6.374 3.334 5.82 3 5.264 3H2.5zM14 7H2v5.5a.5.5 0 0 0 .5.5h11a.5.5 0 0 0 .5-.5V7z" />
                    </svg>
                  </button>
                </div>
                {reading.context && (
                  <div
                    style={{
                      fontSize: '10px',
                      color: theme.textSecondary,
                      marginTop: '2px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {reading.context}
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
      {/* Resize handle */}
      <div
        onMouseDown={handleResizeMouseDown}
        style={{
          width: '4px',
          cursor: 'col-resize',
          backgroundColor: isResizing ? theme.accent : 'transparent',
          borderRight: `1px solid ${theme.border}`,
          transition: 'background-color 0.15s ease',
          flexShrink: 0,
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
      </>
      )}

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
        {/* Toolbar - includes draggable region for window movement */}
        {selectedReading && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px',
              padding: isFullScreen ? '24px 16px 8px 16px' : '8px 16px',
              backgroundColor: theme.bg,
              flexShrink: 0,
            }}
          >
            {/* Left side - hamburger when in fullscreen */}
            <div style={{ display: 'flex', alignItems: 'center' }}>
              {isFullScreen && (
                <button
                  onClick={() => setIsFullScreen(false)}
                  style={{
                    padding: '4px 8px',
                    fontSize: '12px',
                    color: theme.textSecondary,
                    backgroundColor: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                  title="Show sidebar"
                >
                  ☰
                </button>
              )}
            </div>

            {/* Draggable spacer for window movement */}
            <div
              style={{
                flex: 1,
                height: '24px',
                // @ts-ignore - webkit vendor prefix for Electron draggable region
                WebkitAppRegion: 'drag',
                cursor: 'grab',
              }}
            />

            {/* Edit mode controls */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {isEditing ? (
                <>
                  {/* Dirty indicator */}
                  {isDirty && (
                    <span
                      style={{
                        width: '6px',
                        height: '6px',
                        borderRadius: '50%',
                        backgroundColor: theme.accent,
                      }}
                      title="Unsaved changes"
                    />
                  )}
                  <button
                    onClick={saveChanges}
                    disabled={!isDirty || isSaving}
                    style={{
                      padding: '4px 10px',
                      fontSize: '12px',
                      color: isDirty ? '#fff' : theme.textSecondary,
                      backgroundColor: isDirty ? theme.accent : 'transparent',
                      border: isDirty ? 'none' : `1px solid ${theme.border}`,
                      borderRadius: '4px',
                      cursor: isDirty ? 'pointer' : 'default',
                      opacity: isSaving ? 0.6 : 1,
                    }}
                  >
                    {isSaving ? 'Saving...' : 'Save'}
                  </button>
                  <button
                    onClick={() => {
                      if (isDirty) {
                        const confirmed = window.confirm('Discard changes?');
                        if (!confirmed) return;
                      }
                      exitEditMode();
                    }}
                    style={{
                      padding: '4px 10px',
                      fontSize: '12px',
                      color: theme.textSecondary,
                      backgroundColor: 'transparent',
                      border: `1px solid ${theme.border}`,
                      borderRadius: '4px',
                      cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  onClick={enterEditMode}
                  style={{
                    padding: '4px 10px',
                    fontSize: '12px',
                    color: theme.textSecondary,
                    backgroundColor: 'transparent',
                    border: `1px solid ${theme.border}`,
                    borderRadius: '4px',
                    cursor: 'pointer',
                  }}
                  title="Edit (⌘E)"
                >
                  Edit
                </button>
              )}

              {/* Separator */}
              <div
                style={{
                  width: '1px',
                  height: '16px',
                  backgroundColor: theme.border,
                  margin: '0 4px',
                }}
              />

              {/* Text size controls */}
              <button
                onClick={() => setTextSize('small')}
                style={{
                  padding: '4px 8px',
                  fontSize: '11px',
                  color: textSize === 'small' ? theme.accent : theme.textSecondary,
                  backgroundColor: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  fontWeight: textSize === 'small' ? 600 : 400,
                }}
              >
                A
              </button>
              <button
                onClick={() => setTextSize('normal')}
                style={{
                  padding: '4px 8px',
                  fontSize: '13px',
                  color: textSize === 'normal' ? theme.accent : theme.textSecondary,
                  backgroundColor: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  fontWeight: textSize === 'normal' ? 600 : 400,
                }}
              >
                A
              </button>
              <button
                onClick={() => setTextSize('large')}
                style={{
                  padding: '4px 8px',
                  fontSize: '15px',
                  color: textSize === 'large' ? theme.accent : theme.textSecondary,
                  backgroundColor: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  fontWeight: textSize === 'large' ? 600 : 400,
                }}
              >
                A
              </button>
            </div>
          </div>
        )}

        {/* Scrollable content area */}
        <div
          style={{
            flex: 1,
            minHeight: 0, // Required for flex child to shrink and enable scrolling
            overflowY: 'auto',
            padding: isFullScreen ? '16px' : '24px 20px',
            display: 'flex',
            justifyContent: 'center',
          }}
        >
        {selectedReading ? (
          <div
            style={{
              maxWidth: '600px',
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              flex: isEditing ? 1 : 'none',
              minHeight: isEditing ? 0 : 'auto',
            }}
          >
            {isEditing ? (
              /* Edit mode - textarea */
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
            {/* Content - markdown renders the title */}
            <div
              className="librarian-content"
              style={{
                fontSize: textSizes[textSize].base,
                lineHeight: 1.5,
                color: theme.text,
                fontFamily: fonts.serif,
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
                  p: ({ children }) => (
                    <p
                      style={{
                        marginBottom: '8px',
                      }}
                    >
                      {children}
                    </p>
                  ),
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
                            fontSize: '14px',
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
                        if (href) {
                          window.shellAPI?.openExternal(href);
                        }
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
                {selectedReading.content}
              </ReactMarkdown>
            </div>
            {/* Spacer for scroll breathing room - allows scrolling last content up */}
            <div style={{ height: '50vh', flexShrink: 0 }} />
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
            {loading ? 'Loading...' : 'Select a reading'}
          </div>
        )}
        </div>
      </div>

    </div>
  );
}
