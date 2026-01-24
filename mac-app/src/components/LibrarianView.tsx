// =============================================================================
// LibrarianView - iA Writer-style reading experience for collected readings.
// Named after the AI assistant in Snow Crash that provides contextual intel.
// =============================================================================

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import ReactMarkdown from 'react-markdown';
import { fonts } from '../design/tokens';
import ContentToolbar from './ContentToolbar';
import LibrarianSetupWizard from './LibrarianSetupWizard';
import { FEATURE_NARRATION_ENABLED } from '../featureFlags';

interface LibrarianViewProps {
  onSwitchToClipboard: () => void;
  onSwitchToSettings?: () => void;
  onFullScreenChange?: (isFullScreen: boolean) => void;
  externalHeaderHover?: boolean; // Passed from parent when top edge is hovered
  initialReadingPath?: string | null; // Auto-select this reading on mount (for auto-open)
  initialFullScreen?: boolean; // Start in fullscreen/immersive mode (for auto-open)
  onInitialReadingConsumed?: () => void; // Called after initial reading is consumed
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

export default function LibrarianView({ onSwitchToClipboard, onSwitchToSettings, onFullScreenChange, externalHeaderHover, initialReadingPath, initialFullScreen, onInitialReadingConsumed }: LibrarianViewProps) {
  const { theme } = useTheme();

  // State
  // Path is now the identity - no numeric IDs
  const [readings, setReadings] = useState<ReadingMeta[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedReading, setSelectedReading] = useState<Reading | null>(null);
  const [loading, setLoading] = useState(true);
  const [setupComplete, setSetupComplete] = useState<boolean | null>(null); // null = loading

  // Edit mode state
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [textSize, setTextSize] = useState<'small' | 'normal' | 'large'>(() => {
    const saved = localStorage.getItem('librarian-text-size');
    return (saved === 'small' || saved === 'normal' || saved === 'large') ? saved : 'normal';
  });
  // Start in fullscreen if initialFullScreen prop is true (auto-open flow)
  const [isFullScreen, setIsFullScreen] = useState(initialFullScreen ?? false);
  const [headerHovered, setHeaderHovered] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('librarian-sidebar-width');
    return saved ? parseInt(saved, 10) : 180;
  });
  const [isResizing, setIsResizing] = useState(false);
  const [hoveredPath, setHoveredPath] = useState<string | null>(null);
  const [discoveredDirs, setDiscoveredDirs] = useState<string[]>([]);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [addingDir, setAddingDir] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Sharing state
  const [shareStatus, setShareStatus] = useState<{ shared: boolean; slug?: string; url?: string } | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  // Narration state
  const [narrationStatus, setNarrationStatus] = useState<{
    playbackStatus: 'idle' | 'generating' | 'playing' | 'paused' | 'stopped';
    currentReadingPath: string | null;
  }>({ playbackStatus: 'idle', currentReadingPath: null });
  const [narrationPrefs, setNarrationPrefs] = useState<{
    speakOnOpen: boolean;
    blockedDevices: string[];
  } | null>(null);

  // Handle initial reading path and fullscreen from parent (auto-open flow)
  useEffect(() => {
    if (initialReadingPath) {
      setSelectedPath(initialReadingPath);
      if (initialFullScreen) {
        setIsFullScreen(true);
      }
      onInitialReadingConsumed?.();
    }
  }, [initialReadingPath, initialFullScreen, onInitialReadingConsumed]);

  // Persist text size preference
  useEffect(() => {
    localStorage.setItem('librarian-text-size', textSize);
  }, [textSize]);


  // Notify main process of immersive mode changes (affects blur-to-hide behavior)
  useEffect(() => {
    window.librarianAPI?.setImmersiveMode(isFullScreen);
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

  // Initialize narration state and subscribe to events (feature flagged)
  useEffect(() => {
    if (!FEATURE_NARRATION_ENABLED) return;

    // Load initial narration status
    window.narrationAPI?.getStatus().then((status) => {
      if (status) {
        setNarrationStatus({
          playbackStatus: status.playbackStatus,
          currentReadingPath: status.currentReadingPath,
        });
      }
    });

    // Load narration preferences
    window.narrationAPI?.getPrefs().then((prefs) => {
      if (prefs) {
        setNarrationPrefs({
          speakOnOpen: prefs.speakOnOpen,
          blockedDevices: prefs.blockedDevices,
        });
      }
    });

    // Subscribe to playback events
    const unsubGenerating = window.narrationAPI?.onGenerationStarted?.((readingPath) => {
      setNarrationStatus({ playbackStatus: 'generating', currentReadingPath: readingPath });
    });

    const unsubStarted = window.narrationAPI?.onPlaybackStarted((readingPath) => {
      setNarrationStatus({ playbackStatus: 'playing', currentReadingPath: readingPath });
    });

    const unsubStopped = window.narrationAPI?.onPlaybackStopped(() => {
      setNarrationStatus({ playbackStatus: 'idle', currentReadingPath: null });
    });

    const unsubError = window.narrationAPI?.onPlaybackError(() => {
      setNarrationStatus({ playbackStatus: 'idle', currentReadingPath: null });
    });

    return () => {
      unsubGenerating?.();
      unsubStarted?.();
      unsubStopped?.();
      unsubError?.();
    };
  }, []);

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
          // If shared, sync the updated content
          if (shareStatus?.shared) {
            await window.librarianAPI?.updateSharedReading(
              selectedReading.path,
              editContent,
              updated.title
            );
          }
        }
      }
    } finally {
      setIsSaving(false);
    }
  }, [selectedReading, editContent, isDirty, shareStatus?.shared]);

  // Handle navigation with unsaved changes
  const handleSelectReading = useCallback((path: string) => {
    if (isDirty) {
      const confirmed = window.confirm('You have unsaved changes. Discard them?');
      if (!confirmed) return;
      exitEditMode();
    }
    setSelectedPath(path);
  }, [isDirty, exitEditMode]);

  // Handle share/unshare
  const handleShare = useCallback(async () => {
    if (!selectedPath || !selectedReading) return;

    setIsSharing(true);
    try {
      if (shareStatus?.shared) {
        // Unshare
        const success = await window.librarianAPI?.unshareReading(selectedPath);
        if (success) {
          setShareStatus({ shared: false });
        }
      } else {
        // Share
        const result = await window.librarianAPI?.shareReading(selectedPath);
        if (result) {
          setShareStatus({ shared: true, slug: result.slug, url: result.url });
        }
      }
    } finally {
      setIsSharing(false);
    }
  }, [selectedPath, selectedReading, shareStatus?.shared]);

  // Copy share link
  const copyShareLink = useCallback(async () => {
    if (!shareStatus?.url) return;
    await navigator.clipboard.writeText(shareStatus.url);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  }, [shareStatus?.url]);

  // Delete current artifact
  const handleDelete = useCallback(async () => {
    if (!selectedPath || !selectedReading) return;

    const confirmed = window.confirm(`Delete "${selectedReading.title}"? This cannot be undone.`);
    if (!confirmed) return;

    // If shared, unshare first
    if (shareStatus?.shared) {
      await window.librarianAPI?.unshareReading(selectedPath);
    }

    // Delete the file
    const success = await window.librarianAPI?.deleteReading(selectedPath);
    if (success) {
      // The onReadingRemoved listener will handle updating state and selecting next item
    }
  }, [selectedPath, selectedReading, shareStatus?.shared]);

  // Play narration for current reading
  const handlePlayNarration = useCallback(async () => {
    if (!selectedPath) return;
    await window.narrationAPI?.playReading(selectedPath);
  }, [selectedPath]);

  // Stop narration
  const handleStopNarration = useCallback(async () => {
    await window.narrationAPI?.stop();
  }, []);

  // Check if current reading is being narrated
  const isNarrating = selectedPath && narrationStatus.currentReadingPath === selectedPath;
  const isGenerating = narrationStatus.playbackStatus === 'generating' && isNarrating;
  const isPlaying = narrationStatus.playbackStatus === 'playing' && isNarrating;

  // Load readings on mount and check setup completion
  useEffect(() => {
    async function loadReadings() {
      // Check if setup wizard is complete
      const isComplete = await window.librarianAPI?.isSetupComplete();
      setSetupComplete(isComplete ?? true); // Default to true for backwards compatibility

      // Load readings
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

  // Handle setup wizard completion
  const handleSetupComplete = useCallback(async () => {
    setSetupComplete(true);
    // Reload readings to show the new welcome artifact
    const result = await window.librarianAPI?.getReadings();
    if (result) {
      setReadings(result);
      if (result.length > 0) {
        setSelectedPath(result[0].path);
      }
    }
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

  // Load share status when reading changes
  useEffect(() => {
    async function loadShareStatus() {
      if (!selectedPath) {
        setShareStatus(null);
        return;
      }
      const status = await window.librarianAPI?.getShareStatus(selectedPath);
      setShareStatus(status || null);
    }
    loadShareStatus();
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

      // Cmd+W - close window (same as red close button)
      if (e.key === 'w' && e.metaKey) {
        e.preventDefault();
        if (isEditing && isDirty) {
          const confirmed = window.confirm('You have unsaved changes. Discard them?');
          if (!confirmed) return;
        }
        window.clipboardAPI?.closeWindow();
        return;
      }

      // Escape: exit edit mode first, then close window (which will also reset view)
      if (e.key === 'Escape') {
        if (isEditing) {
          if (isDirty) {
            const confirmed = window.confirm('You have unsaved changes. Discard them?');
            if (!confirmed) return;
          }
          exitEditMode();
        } else {
          // Close the window - if in fullscreen/immersive mode, the window hide
          // handler will reset to clipboard view for next open
          window.clipboardAPI?.closeWindow();
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
  // Note: fullscreen state is controlled separately by onSetFullscreen, not here
  useEffect(() => {
    const unsubscribe = window.librarianAPI?.onShowReading((readingPath) => {
      setSelectedPath(readingPath);
    });

    return () => unsubscribe?.();
  }, []);

  // Filter readings by search query
  const filteredReadings = useMemo(() => {
    if (!searchQuery.trim()) return readings;
    const query = searchQuery.toLowerCase();
    return readings.filter(r =>
      r.title.toLowerCase().includes(query) ||
      (r.context?.toLowerCase().includes(query))
    );
  }, [readings, searchQuery]);

  // Group readings by date
  const groupedReadings = groupByDate(filteredReadings);

  // Discover existing .librarian directories on empty state
  useEffect(() => {
    if (!loading && readings.length === 0 && discoveredDirs.length === 0 && !isDiscovering) {
      setIsDiscovering(true);
      window.librarianAPI?.discoverLibrarianDirs().then((dirs) => {
        setDiscoveredDirs(dirs);
        setIsDiscovering(false);
      });
    }
  }, [loading, readings.length, discoveredDirs.length, isDiscovering]);

  // Helper to format path for display (show project name from path)
  const formatDirPath = (dirPath: string): { projectName: string; location: string } => {
    // Remove .librarian suffix and get parent (project) directory
    const projectPath = dirPath.replace(/\/.librarian$/, '');
    const parts = projectPath.split('/');
    const projectName = parts[parts.length - 1];
    // Show abbreviated parent path
    const parentPath = parts.slice(0, -1).join('/').replace(/^\/Users\/[^/]+/, '~');
    return { projectName, location: parentPath };
  };

  // Add a discovered directory
  const handleAddDiscoveredDir = async (dirPath: string) => {
    setAddingDir(dirPath);
    try {
      const result = await window.librarianAPI?.addWatchedDir(dirPath);
      if (result) {
        // Remove from discovered list and reload readings
        setDiscoveredDirs((prev) => prev.filter((d) => d !== dirPath));
        const newReadings = await window.librarianAPI?.getReadings();
        if (newReadings) {
          setReadings(newReadings);
          if (newReadings.length > 0) {
            setSelectedPath(newReadings[0].path);
          }
        }
      }
    } finally {
      setAddingDir(null);
    }
  };

  // Add all discovered directories
  const handleAddAllDiscoveredDirs = async () => {
    for (const dirPath of discoveredDirs) {
      await window.librarianAPI?.addWatchedDir(dirPath);
    }
    setDiscoveredDirs([]);
    const newReadings = await window.librarianAPI?.getReadings();
    if (newReadings) {
      setReadings(newReadings);
      if (newReadings.length > 0) {
        setSelectedPath(newReadings[0].path);
      }
    }
  };

  // Setup wizard - shown on first visit
  if (!loading && setupComplete === false) {
    return <LibrarianSetupWizard onComplete={handleSetupComplete} />;
  }

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
          No artifacts yet
        </div>

        {/* Show discovered directories if any */}
        {discoveredDirs.length > 0 ? (
          <>
            <div style={{ fontSize: '13px', marginBottom: '16px', maxWidth: '320px' }}>
              Found {discoveredDirs.length} existing reading{discoveredDirs.length === 1 ? '' : 's'} collection{discoveredDirs.length === 1 ? '' : 's'}:
            </div>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                marginBottom: '16px',
                maxWidth: '400px',
                width: '100%',
              }}
            >
              {discoveredDirs.map((dirPath) => {
                const { projectName, location } = formatDirPath(dirPath);
                const isAdding = addingDir === dirPath;
                return (
                  <div
                    key={dirPath}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      padding: '10px 14px',
                      backgroundColor: theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
                      borderRadius: '8px',
                      textAlign: 'left',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 500, color: theme.text, fontSize: '13px' }}>
                        {projectName}
                      </div>
                      <div
                        style={{
                          fontSize: '11px',
                          color: theme.textSecondary,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {location}
                      </div>
                    </div>
                    <button
                      onClick={() => handleAddDiscoveredDir(dirPath)}
                      disabled={isAdding}
                      style={{
                        padding: '4px 12px',
                        fontSize: '12px',
                        fontWeight: 500,
                        color: 'white',
                        backgroundColor: theme.accent,
                        border: 'none',
                        borderRadius: '4px',
                        cursor: isAdding ? 'default' : 'pointer',
                        opacity: isAdding ? 0.6 : 1,
                        flexShrink: 0,
                      }}
                    >
                      {isAdding ? 'Adding...' : 'Add'}
                    </button>
                  </div>
                );
              })}
            </div>
            {discoveredDirs.length > 1 && (
              <button
                onClick={handleAddAllDiscoveredDirs}
                style={{
                  padding: '8px 16px',
                  fontSize: '13px',
                  fontWeight: 500,
                  color: 'white',
                  backgroundColor: theme.accent,
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  marginBottom: '16px',
                }}
              >
                Add All
              </button>
            )}
            <div
              style={{
                fontSize: '11px',
                color: theme.textSecondary,
                marginTop: '8px',
              }}
            >
              Or{' '}
              <button
                onClick={onSwitchToSettings}
                style={{
                  background: 'none',
                  border: 'none',
                  color: theme.accent,
                  cursor: 'pointer',
                  fontSize: '11px',
                  textDecoration: 'underline',
                  padding: 0,
                }}
              >
                open Settings
              </button>{' '}
              to add a new directory
            </div>
          </>
        ) : isDiscovering ? (
          <div style={{ fontSize: '13px', marginBottom: '24px', color: theme.textSecondary }}>
            Searching for existing artifacts...
          </div>
        ) : (
          <>
          <div style={{ fontSize: '13px', marginBottom: '24px', maxWidth: '280px' }}>
              Add a watched directory in Settings to start collecting artifacts from your coding sessions.
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
          </>
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
      {/* Sidebar - hidden in full-screen mode but kept in DOM for instant collapse */}
      <div
        style={{
          width: `${sidebarWidth}px`,
          minWidth: `${sidebarWidth}px`,
          display: isFullScreen ? 'none' : 'flex',
          flexDirection: 'column',
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
            gap: '6px',
          }}
        >
          <span>Artifacts</span>
          {/* Spacer */}
          <div style={{ flex: 1 }} />
          {/* Search toggle */}
          <button
            onClick={() => {
              setSearchOpen(!searchOpen);
              if (!searchOpen) {
                setTimeout(() => searchInputRef.current?.focus(), 50);
              } else {
                setSearchQuery('');
              }
            }}
            style={{
              padding: '2px',
              color: searchOpen || searchQuery ? theme.text : theme.textSecondary,
              backgroundColor: 'transparent',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
            }}
            title="Search"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
              <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z"/>
            </svg>
          </button>
        </div>

        {/* Collapsible search input */}
        {searchOpen && (
          <div style={{ padding: '0 8px 8px' }}>
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setSearchOpen(false);
                  setSearchQuery('');
                }
              }}
              style={{
                width: '100%',
                padding: '6px 8px',
                fontSize: '11px',
                backgroundColor: theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
                border: `1px solid ${theme.border}`,
                borderRadius: '4px',
                color: theme.text,
                outline: 'none',
              }}
            />
          </div>
        )}

        {/* Readings list */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
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

        {/* Bottom button - link to settings */}
        <div style={{ padding: '8px 12px', borderTop: `1px solid ${theme.border}` }}>
          <button
            onClick={onSwitchToSettings}
            style={{
              width: '100%',
              padding: '6px',
              fontSize: '11px',
              color: theme.textSecondary,
              backgroundColor: 'transparent',
              border: `1px dashed ${theme.border}`,
              borderRadius: '4px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
            }}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 16 16"
              fill="currentColor"
            >
              <path d="M8 4.754a3.246 3.246 0 1 0 0 6.492 3.246 3.246 0 0 0 0-6.492zM5.754 8a2.246 2.246 0 1 1 4.492 0 2.246 2.246 0 0 1-4.492 0z"/>
              <path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 0 1-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 0 1-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 0 1 .52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 0 1 1.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 0 1 1.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 0 1 .52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 0 1-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 0 1-1.255-.52l-.094-.319zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 0 0 2.693 1.115l.291-.16c.764-.415 1.6.42 1.184 1.185l-.159.292a1.873 1.873 0 0 0 1.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 0 0-1.115 2.693l.16.291c.415.764-.42 1.6-1.185 1.184l-.291-.159a1.873 1.873 0 0 0-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 0 0-2.692-1.115l-.292.16c-.764.415-1.6-.42-1.184-1.185l.159-.291A1.873 1.873 0 0 0 1.945 8.93l-.319-.094c-.835-.246-.835-1.428 0-1.674l.319-.094A1.873 1.873 0 0 0 3.06 4.377l-.16-.292c-.415-.764.42-1.6 1.185-1.184l.292.159a1.873 1.873 0 0 0 2.692-1.115l.094-.319z"/>
            </svg>
            Librarian Settings
          </button>
        </div>
      </div>
      {/* Resize handle - hidden in full-screen mode but kept in DOM */}
      <div
        onMouseDown={handleResizeMouseDown}
        style={{
          width: '4px',
          cursor: 'col-resize',
          backgroundColor: isResizing ? theme.accent : 'transparent',
          borderRight: `1px solid ${theme.border}`,
          transition: 'background-color 0.15s ease',
          flexShrink: 0,
          display: isFullScreen ? 'none' : 'block',
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
        {/* Top draggable region - captures clicks at very top of frameless window */}
        <div
          onMouseEnter={() => isFullScreen && setHeaderHovered(true)}
          onMouseLeave={() => isFullScreen && setHeaderHovered(false)}
          style={{
            height: isFullScreen ? '20px' : '0px',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
            // @ts-ignore - webkit vendor prefix for Electron draggable region
            WebkitAppRegion: 'drag',
            cursor: 'grab',
          }}
        >
          {/* Stoplight close button - visible in fullscreen mode */}
          {isFullScreen && (
            <button
              onClick={() => window.clipboardAPI?.closeWindow()}
              style={{
                position: 'absolute',
                left: '6px',
                top: '50%',
                transform: 'translateY(-50%)',
                // Larger hit area (24x24) with visual circle centered inside
                width: '24px',
                height: '24px',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
                background: 'transparent',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                // @ts-ignore - make button clickable within drag region
                WebkitAppRegion: 'no-drag',
              }}
              title="Close window"
            >
              {/* Visual 12px circle */}
              <div
                style={{
                  width: '12px',
                  height: '12px',
                  borderRadius: '50%',
                  backgroundColor: (headerHovered || externalHeaderHover) ? '#ff5f57' : 'rgba(128, 128, 128, 0.5)',
                  transition: 'background-color 0.2s ease',
                  pointerEvents: 'none',
                }}
              />
            </button>
          )}
          {/* Drag handle indicator - only visible in immersive mode */}
          {isFullScreen && (
            <div
              style={{
                width: '36px',
                height: '4px',
                borderRadius: '2px',
                backgroundColor: theme.isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)',
              }}
            />
          )}
        </div>

        {/* Toolbar - includes draggable region for window movement */}
        {selectedReading && (
          <div
            onMouseEnter={() => isFullScreen && setHeaderHovered(true)}
            onMouseLeave={() => isFullScreen && setHeaderHovered(false)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: isFullScreen ? '8px 16px 4px 16px' : '8px 20px',
              backgroundColor: theme.bg,
              flexShrink: 0,
            }}
          >
            {/* Inner container - always matches reading content width (600px centered) */}
            <div
              style={{
                maxWidth: '600px',
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              {/* Toolbar controls - left aligned to content area */}
              <ContentToolbar
                filePath={selectedPath || undefined}
                isFullScreen={isFullScreen}
                onToggleFullScreen={() => setIsFullScreen(!isFullScreen)}
                textSize={textSize}
                onTextSizeChange={setTextSize}
                showTextSize={true}
                isEditing={isEditing}
                isDirty={isDirty}
                isSaving={isSaving}
                onEdit={enterEditMode}
                onSave={saveChanges}
                onCancel={() => {
                  if (isDirty) {
                    const confirmed = window.confirm('Discard changes?');
                    if (!confirmed) return;
                  }
                  exitEditMode();
                }}
                onDelete={handleDelete}
                showDelete={true}
                onShowInFolder={() => selectedPath && window.shellAPI?.showItemInFolder(selectedPath)}
                showFolder={true}
                onCopy={shareStatus?.shared ? copyShareLink : undefined}
                showCopy={!!shareStatus?.shared}
                shareStatus={shareStatus}
                isSharing={isSharing}
                onToggleShare={handleShare}
                showShare={true}
                headerHovered={headerHovered}
              />

              {/* Narration Play/Stop button (feature flagged) */}
              {FEATURE_NARRATION_ENABLED && selectedReading && !isEditing && (
                <button
                  onClick={isPlaying || isGenerating ? handleStopNarration : handlePlayNarration}
                  disabled={isGenerating}
                  style={{
                    padding: '4px 8px',
                    fontSize: '13px',
                    color: isPlaying ? '#8b5cf6' : theme.textSecondary,
                    backgroundColor: isPlaying
                      ? (theme.isDark ? 'rgba(139, 92, 246, 0.15)' : 'rgba(139, 92, 246, 0.1)')
                      : 'transparent',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: isGenerating ? 'wait' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    transition: 'background-color 0.15s ease, color 0.15s ease',
                    opacity: isFullScreen && !headerHovered ? 0 : 1,
                  }}
                  onMouseEnter={(e) => {
                    if (!isPlaying && !isGenerating) {
                      e.currentTarget.style.backgroundColor = theme.isDark
                        ? 'rgba(255,255,255,0.08)'
                        : 'rgba(0,0,0,0.05)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isPlaying) {
                      e.currentTarget.style.backgroundColor = 'transparent';
                    }
                  }}
                  title={isPlaying ? 'Stop narration' : isGenerating ? 'Generating...' : 'Listen to reading'}
                >
                  {/* Speaker icon or stop icon */}
                  {isPlaying ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                      <rect x="6" y="6" width="12" height="12" rx="1" />
                    </svg>
                  ) : isGenerating ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ animation: 'pulse 1s infinite' }}>
                      <circle cx="12" cy="12" r="3" />
                      <circle cx="12" cy="12" r="8" fillOpacity="0.3" />
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
                    </svg>
                  )}
                  <span style={{ fontSize: '12px' }}>
                    {isPlaying ? 'Stop' : isGenerating ? '...' : 'Listen'}
                  </span>
                </button>
              )}
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
                userSelect: 'text',
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
                  p: ({ children, node }) => {
                    // Check if this paragraph contains braille art (U+2800-U+28FF)
                    // Extract text from the AST node for reliable detection
                    const extractText = (n: typeof node): string => {
                      if (!n) return '';
                      if (n.type === 'text' && 'value' in n) return n.value as string;
                      if ('children' in n && Array.isArray(n.children)) {
                        return n.children.map(extractText).join('');
                      }
                      return '';
                    };
                    const textContent = extractText(node);
                    const hasBraille = /[\u2800-\u28FF]/.test(textContent);

                    if (hasBraille) {
                      return (
                        <p
                          style={{
                            marginBottom: '16px',
                            marginTop: '8px',
                            textAlign: 'center',
                            fontFamily: fonts.mono,
                            fontSize: '14px',
                            lineHeight: 1.15,
                            whiteSpace: 'pre',
                            letterSpacing: 0,
                          }}
                        >
                          {children}
                        </p>
                      );
                    }

                    return (
                      <p
                        style={{
                          marginBottom: '8px',
                        }}
                      >
                        {children}
                      </p>
                    );
                  },
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
                            fontSize: '0.875em', // Slightly smaller than body text since monospace appears larger
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
            {loading ? 'Loading...' : 'Select an artifact'}
          </div>
        )}
        </div>
      </div>

    </div>
  );
}
