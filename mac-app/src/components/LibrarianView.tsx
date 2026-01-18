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
  const [readings, setReadings] = useState<ReadingMeta[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedReading, setSelectedReading] = useState<Reading | null>(null);
  const [loading, setLoading] = useState(true);
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
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
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

  // Load readings on mount
  useEffect(() => {
    async function loadReadings() {
      const result = await window.librarianAPI?.getReadings();
      if (result) {
        setReadings(result);
        // Select first reading if any
        if (result.length > 0 && selectedId === null) {
          setSelectedId(result[0].id);
        }
      }
      setLoading(false);
    }
    loadReadings();
  }, []);

  // Load selected reading content
  useEffect(() => {
    async function loadReading() {
      if (selectedId === null) {
        setSelectedReading(null);
        return;
      }
      const result = await window.librarianAPI?.getReading(selectedId);
      setSelectedReading(result || null);
    }
    loadReading();
  }, [selectedId]);

  // Listen for new readings
  useEffect(() => {
    const unsubscribe = window.librarianAPI?.onReadingAdded((reading) => {
      setReadings((prev) => [
        {
          id: reading.id,
          title: reading.title,
          context: reading.context,
          readingTime: reading.readingTime,
          createdAt: reading.createdAt,
        },
        ...prev,
      ]);
      // Auto-select the new reading
      setSelectedId(reading.id);
    });

    return () => unsubscribe?.();
  }, []);

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

      // Cmd + Delete/Backspace - show delete confirmation
      if ((e.key === 'Backspace' || e.key === 'Delete') && e.metaKey && selectedId !== null) {
        e.preventDefault();
        setShowDeleteConfirm(true);
        return;
      }

      // Toggle immersive/fullscreen mode with 'f'
      if (e.key === 'f' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setIsFullScreen((prev) => !prev);
        return;
      }

      // Escape: exit fullscreen first, then switch to clipboard
      if (e.key === 'Escape') {
        if (isFullScreen) {
          setIsFullScreen(false);
        } else {
          onSwitchToClipboard();
        }
        return;
      }

      if (readings.length === 0) return;

      const currentIndex = readings.findIndex((r) => r.id === selectedId);

      if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        const newIndex = Math.max(0, currentIndex - 1);
        setSelectedId(readings[newIndex].id);
      } else if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        const newIndex = Math.min(readings.length - 1, currentIndex + 1);
        setSelectedId(readings[newIndex].id);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [readings, selectedId, isFullScreen, onSwitchToClipboard]);

  // Focus container on mount
  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  // Delete the selected reading
  const handleDeleteReading = async () => {
    if (selectedId === null) return;

    const success = await window.librarianAPI?.deleteReading(selectedId);
    if (success) {
      // Remove from local state
      const currentIndex = readings.findIndex((r) => r.id === selectedId);
      const newReadings = readings.filter((r) => r.id !== selectedId);
      setReadings(newReadings);

      // Select next reading or previous if at end
      if (newReadings.length > 0) {
        const newIndex = Math.min(currentIndex, newReadings.length - 1);
        setSelectedId(newReadings[newIndex].id);
      } else {
        setSelectedId(null);
      }
    }
    setShowDeleteConfirm(false);
  };

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
            <div
              style={{
                padding: '8px 12px 4px',
                fontSize: '10px',
                fontWeight: 600,
                color: theme.textSecondary,
              }}
            >
              {date}
            </div>
            {items.map((reading) => (
              <div
                key={reading.id}
                onClick={() => setSelectedId(reading.id)}
                style={{
                  padding: '8px 12px',
                  cursor: 'pointer',
                  backgroundColor:
                    reading.id === selectedId
                      ? theme.isDark
                        ? 'rgba(255,255,255,0.08)'
                        : 'rgba(0,0,0,0.05)'
                      : 'transparent',
                  borderLeft:
                    reading.id === selectedId
                      ? `2px solid ${theme.accent}`
                      : '2px solid transparent',
                  transition: 'all 0.1s ease',
                }}
              >
                <div
                  style={{
                    fontSize: '12px',
                    fontWeight: 500,
                    color: theme.text,
                    lineHeight: 1.3,
                  }}
                >
                  {reading.title}
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
              padding: '8px 16px',
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

            {/* Text size controls */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
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
            }}
          >
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

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && selectedReading && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => setShowDeleteConfirm(false)}
        >
          <div
            style={{
              backgroundColor: theme.bg,
              borderRadius: '12px',
              padding: '20px',
              maxWidth: '360px',
              width: '90%',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
              border: `1px solid ${theme.border}`,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 8px 0', fontSize: '15px', fontWeight: 600, color: theme.text }}>
              Delete Reading?
            </h3>
            <p style={{ margin: '0 0 16px 0', fontSize: '13px', color: theme.textSecondary, lineHeight: 1.5 }}>
              "{selectedReading.title}" will be permanently deleted.
            </p>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                style={{
                  padding: '6px 12px',
                  fontSize: '13px',
                  fontWeight: 500,
                  color: theme.text,
                  backgroundColor: 'transparent',
                  border: `1px solid ${theme.border}`,
                  borderRadius: '6px',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteReading}
                style={{
                  padding: '6px 12px',
                  fontSize: '13px',
                  fontWeight: 500,
                  color: '#fff',
                  backgroundColor: theme.error,
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
