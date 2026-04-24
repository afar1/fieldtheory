// =============================================================================
// CommandsView - Unified Commands View for portable commands management.
// Based on LibrarianView pattern - two-pane layout with sidebar and detail pane.
// Supports multi-directory watching, full CRUD, and Shared commands discovery.
// =============================================================================

import { forwardRef, useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { useDeleteConfirmation } from '../hooks/useDeleteConfirmation';
import ReactMarkdown from 'react-markdown';
import { fonts } from '../design/tokens';
import { supabase } from '../supabaseClient';
import ContentToolbar from './ContentToolbar';
import { isImmersiveToggleShortcut, isMarkdownModeToggleShortcut, isSearchFocusShortcut, shouldEnterEditOnClick } from '../utils/editorShortcuts';

/** Inline text input used for both "new command" and "rename command" flows.
 *  Both commit handlers treat empty input as a cancel, so blur just calls
 *  onCommit unconditionally. */
const InlineNameInput = forwardRef<HTMLInputElement, {
  value: string;
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  error?: string | null;
  placeholder?: string;
  stopClickPropagation?: boolean;
}>(function InlineNameInput({ value, onChange, onCommit, onCancel, error, placeholder, stopClickPropagation }, ref) {
  const { theme } = useTheme();
  return (
    <div>
      <input
        ref={ref}
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); onCommit(); }
          else if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
        }}
        onBlur={() => onCommit()}
        onMouseDown={stopClickPropagation ? (e) => e.stopPropagation() : undefined}
        onClick={stopClickPropagation ? (e) => e.stopPropagation() : undefined}
        aria-invalid={!!error}
        aria-describedby={error ? 'command-name-error' : undefined}
        style={{
          width: '100%',
          padding: '4px 8px',
          fontSize: '12px',
          backgroundColor: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
          border: `1px solid ${error ? '#dc2626' : theme.accent}`,
          borderRadius: '4px',
          color: theme.text,
          outline: 'none',
        }}
      />
      {error && (
        <div
          id="command-name-error"
          role="alert"
          style={{
            marginTop: '4px',
            fontSize: '11px',
            lineHeight: 1.3,
            color: '#dc2626',
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
});

interface CommandsViewProps {
  onSwitchToClipboard: () => void;
  sidebarCollapsed?: boolean;
  onFocusChromeActiveChange?: (active: boolean) => void;
  initialCommandPath?: string | null;
  onInitialCommandConsumed?: () => void;
  onFocusChromeShortcut?: () => void;
}

/**
 * Popular command from Supabase.
 */
interface PopularCommand {
  id: string;
  name: string;
  content: string;
  copy_count: number;
  contributed_by: string | null;
  created_at: string;
}

/**
 * Command item for sidebar display.
 */
interface CommandItem {
  name: string;
  displayName: string;
  filePath: string;
}

/**
 * Command with content for detail pane.
 */
interface CommandWithContent extends CommandItem {
  lastModified: number;
  content: string;
}

/**
 * Watched directory.
 */
interface WatchedDir {
  path: string;
  enabled: boolean;
}

export default function CommandsView({ onSwitchToClipboard, sidebarCollapsed = false, onFocusChromeActiveChange, initialCommandPath, onInitialCommandConsumed, onFocusChromeShortcut }: CommandsViewProps) {
  const { theme } = useTheme();
  const { confirmDelete, deleteConfirmationDialog } = useDeleteConfirmation();

  // View mode: 'mine' or 'popular'
  const [viewMode, setViewMode] = useState<'mine' | 'popular'>('mine');

  // Watched directories
  const [watchedDirs, setWatchedDirs] = useState<WatchedDir[]>([]);

  // Commands state
  const [commands, setCommands] = useState<CommandItem[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedCommand, setSelectedCommand] = useState<CommandWithContent | null>(null);
  const [loading, setLoading] = useState(true);

  // Popular commands state
  const [popularCommands, setPopularCommands] = useState<PopularCommand[]>([]);
  const [selectedPopularId, setSelectedPopularId] = useState<string | null>(null);
  const [popularLoading, setPopularLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  // Search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const sidebarKeyboardActiveRef = useRef(false);

  // Edit mode
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Inline new command input
  const [creatingInDir, setCreatingInDir] = useState<string | null>(null);
  const [newCommandName, setNewCommandName] = useState('');
  const [newCommandError, setNewCommandError] = useState<string | null>(null);
  const newCommandInputRef = useRef<HTMLInputElement>(null);

  // Inline rename input — replaces window.prompt(), which Electron silently
  // disables. `renamingPath` is the filePath currently being renamed.
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  // Text size
  const [textSize, setTextSize] = useState<'small' | 'normal' | 'large'>(() => {
    const saved = localStorage.getItem('commands-text-size');
    return (saved === 'small' || saved === 'normal' || saved === 'large') ? saved : 'normal';
  });

  // Layout
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('commands-sidebar-width');
    return saved ? parseInt(saved, 10) : 180;
  });
  const sidebarWidthRef = useRef(sidebarWidth);
  const [isResizing, setIsResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const sidebarPaneRef = useRef<HTMLDivElement | null>(null);
  const sidebarInnerRef = useRef<HTMLDivElement | null>(null);

  // Hover states for toolbar buttons
  const [hoveredButton, setHoveredButton] = useState<string | null>(null);

  // Sharing state
  const [shareStatus, setShareStatus] = useState<{ shared: boolean; id?: string } | null>(null);
  const [isSharing, setIsSharing] = useState(false);

  const [focusImmersive, setFocusImmersive] = useState(false);
  const focusToolbarControlsVisible = !focusImmersive;

  // Context menu
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; filePath: string; name: string } | null>(null);

  // Text size values (smaller than Librarian for compact commands)
  const textSizes = {
    small: { base: '12px', h1: '18px', h2: '14px', h3: '13px' },
    normal: { base: '14px', h1: '22px', h2: '17px', h3: '15px' },
    large: { base: '16px', h1: '26px', h2: '20px', h3: '17px' },
  };

  const applySidebarWidth = useCallback((width: number) => {
    const nextWidth = `${width}px`;
    if (sidebarPaneRef.current) {
      sidebarPaneRef.current.style.width = nextWidth;
      sidebarPaneRef.current.style.minWidth = nextWidth;
    }
    if (sidebarInnerRef.current) {
      sidebarInnerRef.current.style.width = nextWidth;
    }
  }, []);

  // Persist sidebar width
  useEffect(() => {
    sidebarWidthRef.current = sidebarWidth;
    if (isResizing) return;
    localStorage.setItem('commands-sidebar-width', String(sidebarWidth));
  }, [isResizing, sidebarWidth]);

  // Persist text size preference
  useEffect(() => {
    localStorage.setItem('commands-text-size', textSize);
  }, [textSize]);

  useEffect(() => {
    onFocusChromeActiveChange?.(focusImmersive);
    return () => onFocusChromeActiveChange?.(false);
  }, [focusImmersive, onFocusChromeActiveChange]);

  // Mock popular commands (fallback if Supabase unavailable)
  const getMockCommands = useCallback((): PopularCommand[] => [
    {
      id: 'mock-1',
      name: 'learn',
      content: 'Periodically you will learn something from talking to me. Document your learnings in a markdown file in the learnings/ directory.',
      copy_count: 42,
      contributed_by: null,
      created_at: new Date().toISOString(),
    },
    {
      id: 'mock-2',
      name: 'refactor',
      content: 'Refactor the selected code to be more readable, maintainable, and follow best practices. Explain what changes you made and why.',
      copy_count: 38,
      contributed_by: null,
      created_at: new Date().toISOString(),
    },
    {
      id: 'mock-3',
      name: 'review',
      content: 'Review this code for bugs, security issues, and opportunities for improvement. Be thorough and specific.',
      copy_count: 35,
      contributed_by: null,
      created_at: new Date().toISOString(),
    },
    {
      id: 'mock-4',
      name: 'commit',
      content: 'Create a git commit with a clear, concise message following conventional commit standards.',
      copy_count: 31,
      contributed_by: null,
      created_at: new Date().toISOString(),
    },
    {
      id: 'mock-5',
      name: 'pr',
      content: 'Create a pull request with a clear description of changes, testing done, and any relevant context.',
      copy_count: 28,
      contributed_by: null,
      created_at: new Date().toISOString(),
    },
  ], []);

  // Fetch popular commands when switching to popular view
  useEffect(() => {
    if (viewMode !== 'popular') return;
    if (popularCommands.length > 0) return; // Already loaded

    const fetchPopular = async () => {
      setPopularLoading(true);
      try {
        if (supabase) {
          const { data, error } = await supabase
            .from('popular_commands')
            .select('*')
            .order('copy_count', { ascending: false })
            .order('created_at', { ascending: false });

          if (error) throw error;
          setPopularCommands(data || getMockCommands());
        } else {
          setPopularCommands(getMockCommands());
        }
      } catch (err) {
        console.error('Failed to fetch popular commands:', err);
        setPopularCommands(getMockCommands());
      } finally {
        setPopularLoading(false);
      }
    };

    fetchPopular();
  }, [viewMode, popularCommands.length, getMockCommands]);

  // Filter popular commands
  const filteredPopularCommands = useMemo(() => {
    if (!searchQuery.trim()) return popularCommands;
    const query = searchQuery.toLowerCase();
    return popularCommands.filter(cmd =>
      cmd.name.toLowerCase().includes(query) ||
      cmd.content.toLowerCase().includes(query)
    );
  }, [popularCommands, searchQuery]);

  // Get selected popular command
  const selectedPopularCommand = useMemo(() => {
    if (!selectedPopularId) return null;
    return popularCommands.find(cmd => cmd.id === selectedPopularId) || null;
  }, [popularCommands, selectedPopularId]);

  // Strip leading h1 from markdown to avoid duplicate heading (we render h1 from filename)
  const displayContent = useMemo(() => {
    const raw = viewMode === 'mine' ? selectedCommand?.content || '' : selectedPopularCommand?.content || '';
    return raw.replace(/^#\s+.+\n?/, '');
  }, [viewMode, selectedCommand?.content, selectedPopularCommand?.content]);

  // Copy command content to clipboard
  const handleCopyContent = useCallback(async (content: string, id?: string) => {
    try {
      await navigator.clipboard.writeText(content);
      // Show feedback for all copies
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      // Increment copy count in database for popular commands
      if (supabase && id) {
        try {
          await supabase.rpc('increment_command_copy_count', { command_id: id });
        } catch {
          // Silent fail - copy still worked
        }
      }
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, []);

  // Add popular command to user's commands
  const handleAddToMine = useCallback(async (command: PopularCommand) => {
    if (watchedDirs.length === 0) {
      // Create default directory first
      const defaultDir = await window.commandsAPI?.createDefaultDirectory();
      if (!defaultDir) {
        window.alert('Please configure a commands directory first.');
        return;
      }
      const dirs = await window.commandsAPI?.getWatchedDirs();
      if (dirs) setWatchedDirs(dirs);
    }

    const targetDir = watchedDirs.length > 0 ? watchedDirs[0].path : await window.commandsAPI?.getDefaultDirectory();
    if (!targetDir) return;

    const result = await window.commandsAPI?.createCommand(targetDir, command.name, command.content);
    if (result) {
      // Refresh commands and switch to Mine view
      const updatedCommands = await window.commandsAPI?.getCommands();
      if (updatedCommands) setCommands(updatedCommands);
      setViewMode('mine');
      setSelectedPath(result.path);
    }
  }, [watchedDirs]);

  // Handle resize drag
  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    sidebarWidthRef.current = sidebarWidth;
    setIsResizing(true);
  }, [sidebarWidth]);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const containerRect = containerRef.current?.getBoundingClientRect();
      if (!containerRect) return;

      const newWidth = e.clientX - containerRect.left;
      const clampedWidth = Math.max(120, Math.min(400, newWidth));
      sidebarWidthRef.current = clampedWidth;
      applySidebarWidth(clampedWidth);
    };

    const handleMouseUp = () => {
      setSidebarWidth(sidebarWidthRef.current);
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [applySidebarWidth, isResizing]);

  // Check if content has been modified
  const isDirty = isEditing && editContent !== (selectedCommand?.content ?? '');

  // Enter edit mode
  const enterEditMode = useCallback(() => {
    if (selectedCommand) {
      setEditContent(selectedCommand.content);
      setIsEditing(true);
    }
  }, [selectedCommand]);

  // Exit edit mode (discard changes)
  const exitEditMode = useCallback(() => {
    setIsEditing(false);
    setEditContent('');
  }, []);

  // Save changes
  const saveChanges = useCallback(async () => {
    if (!selectedCommand || !isDirty) return;

    setIsSaving(true);
    try {
      const success = await window.commandsAPI?.saveCommand(selectedCommand.filePath, editContent);
      if (success) {
        setIsEditing(false);
        setEditContent('');
        // Reload the command to get updated content
        const updated = await window.commandsAPI?.getCommandByPath(selectedCommand.filePath);
        if (updated) {
          setSelectedCommand(updated);
        }
      }
    } finally {
      setIsSaving(false);
    }
  }, [selectedCommand, editContent, isDirty]);

  // Handle navigation with unsaved changes
  const handleSelectCommand = useCallback((path: string) => {
    if (isDirty) {
      const confirmed = window.confirm('You have unsaved changes. Discard them?');
      if (!confirmed) return;
      exitEditMode();
    }
    setSelectedPath(path);
  }, [isDirty, exitEditMode]);

  // Load commands and watched dirs on mount
  useEffect(() => {
    async function loadData() {
      // Initialize the commands manager
      await window.commandsAPI?.initialize();

      // Load watched directories — auto-create default if none exist
      let dirs = await window.commandsAPI?.getWatchedDirs();
      if (!dirs || dirs.length === 0) {
        await window.commandsAPI?.createDefaultDirectory();
        dirs = await window.commandsAPI?.getWatchedDirs();
      }
      if (dirs) {
        setWatchedDirs(dirs);
      }

      // Load commands
      const result = await window.commandsAPI?.getCommands();
      if (result) {
        setCommands(result);
        if (result.length > 0 && selectedPath === null) {
          setSelectedPath(result[0].filePath);
        }
        // Default to Shared tab if no user commands yet
        if (result.length === 0) {
          setViewMode('popular');
        }
      }
      setLoading(false);
    }
    loadData();
  }, []);

  // Load selected command content
  useEffect(() => {
    async function loadCommand() {
      if (selectedPath === null) {
        setSelectedCommand(null);
        return;
      }
      const result = await window.commandsAPI?.getCommandByPath(selectedPath);
      setSelectedCommand(result || null);
    }
    loadCommand();
  }, [selectedPath]);

  useEffect(() => {
    if (!initialCommandPath) return;
    setViewMode('mine');
    setSelectedPath(initialCommandPath);
    onInitialCommandConsumed?.();
  }, [initialCommandPath, onInitialCommandConsumed]);

  // Listen for commands changes. Also refresh on window focus as a safety
  // net — fs.watch with recursive:true is flaky on macOS for renames, so
  // external filename changes can be missed until the user comes back.
  useEffect(() => {
    const unsubscribe = window.commandsAPI?.onCommandsChanged((updatedCommands) => {
      setCommands(updatedCommands);
    });
    const onFocus = async () => {
      const fresh = await window.commandsAPI?.getCommands();
      if (fresh) setCommands(fresh);
    };
    window.addEventListener('focus', onFocus);
    return () => {
      unsubscribe?.();
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  // Check if selected command is already shared
  useEffect(() => {
    async function checkShareStatus() {
      if (!selectedCommand || !supabase) {
        setShareStatus(null);
        return;
      }

      try {
        // Check if command with same name exists in popular_commands
        const { data, error } = await supabase
          .from('popular_commands')
          .select('id, name')
          .eq('name', selectedCommand.name)
          .limit(1);

        if (error) throw error;

        if (data && data.length > 0) {
          setShareStatus({ shared: true, id: data[0].id });
        } else {
          setShareStatus({ shared: false });
        }
      } catch (err) {
        console.error('Failed to check share status:', err);
        setShareStatus({ shared: false });
      }
    }

    checkShareStatus();
  }, [selectedCommand]);

  // Toggle share status - routes through main process for proper auth
  const handleShareToggle = useCallback(async () => {
    if (!selectedCommand || isSharing) return;

    setIsSharing(true);
    try {
      if (shareStatus?.shared && shareStatus.id) {
        // Unshare via IPC
        const result = await window.commandsAPI?.unshareCommand(shareStatus.id);
        if (result?.error) {
          window.alert(`Failed to unshare: ${result.error}`);
          throw new Error(result.error);
        }
        setShareStatus({ shared: false });
        setPopularCommands(prev => prev.filter(cmd => cmd.id !== shareStatus.id));
      } else {
        // Share via IPC
        const result = await window.commandsAPI?.shareCommand({
          name: selectedCommand.name,
          content: selectedCommand.content,
        });
        if (result?.error) {
          window.alert(`Failed to share: ${result.error}`);
          throw new Error(result.error);
        }
        if (result?.data) {
          setShareStatus({ shared: true, id: result.data.id });
          setPopularCommands(prev => [result.data, ...prev]);
        }
      }
    } catch (err) {
      console.error('Failed to toggle share:', err);
    } finally {
      setIsSharing(false);
    }
  }, [selectedCommand, shareStatus, isSharing]);

  // Keyboard navigation
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (isImmersiveToggleShortcut(e)) {
        e.preventDefault();
        if (!focusImmersive) {
          onFocusChromeShortcut?.();
        }
        setFocusImmersive((prev) => !prev);
        return;
      }

      // Cmd+, - toggle edit mode
      if (isMarkdownModeToggleShortcut(e)) {
        e.preventDefault();
        if (isEditing) {
          if (isDirty) {
            const confirmed = window.confirm('You have unsaved changes. Discard them?');
            if (!confirmed) return;
          }
          exitEditMode();
        } else if (selectedCommand) {
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

      // Escape: exit edit mode, then exit to clipboard
      if (e.key === 'Escape') {
        if (isEditing) {
          if (isDirty) {
            const confirmed = window.confirm('You have unsaved changes. Discard them?');
            if (!confirmed) return;
          }
          exitEditMode();
        } else if (focusImmersive) {
          setFocusImmersive(false);
        } else {
          onSwitchToClipboard();
        }
        return;
      }

      // Cmd+F or / — focus sidebar search. Gated on active element so `/`
      // still works while the editor is on screen, just not when it's focused.
      if (isSearchFocusShortcut(e)) {
        e.preventDefault();
        sidebarKeyboardActiveRef.current = false;
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }

      // Don't handle navigation keys when typing in any input
      const isSidebarNavigationKey = e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'j' || e.key === 'k';
      const activeEl = document.activeElement;
      const inInput = activeEl instanceof HTMLInputElement
        || activeEl instanceof HTMLTextAreaElement
        || activeEl instanceof HTMLSelectElement
        || (activeEl instanceof HTMLElement && activeEl.isContentEditable);
      if (inInput) return;
      if (isEditing && (!sidebarKeyboardActiveRef.current || !isSidebarNavigationKey)) return;
      if (!isSidebarNavigationKey) return;

      const navigationCommands = viewMode === 'mine' && selectedPath
        ? Array.from(groupedCommands.values()).find((items) => items.some((command) => command.filePath === selectedPath)) ?? filteredCommands
        : filteredCommands;
      if (navigationCommands.length === 0) return;

      const currentIndex = navigationCommands.findIndex((c) => c.filePath === selectedPath);
      if (currentIndex < 0) return;

      if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        const newIndex = Math.max(0, currentIndex - 1);
        handleSelectCommand(navigationCommands[newIndex].filePath);
      } else if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        const newIndex = Math.min(navigationCommands.length - 1, currentIndex + 1);
        handleSelectCommand(navigationCommands[newIndex].filePath);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [commands, selectedPath, searchQuery, watchedDirs, isEditing, isDirty, focusImmersive, selectedCommand, viewMode, onSwitchToClipboard, enterEditMode, exitEditMode, saveChanges, handleSelectCommand, onFocusChromeShortcut]);

  // Focus container on mount
  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  // Format directory path for display
  // Shows enough context to distinguish between directories
  const formatDirPath = useCallback((dirPath: string): string => {
    const parts = dirPath.split('/').filter(Boolean);
    if (parts.length === 0) return dirPath;

    // If the last folder is a common name like "commands", show more context
    const lastPart = parts[parts.length - 1];
    const commonNames = ['commands', 'rules', 'skills', 'prompts'];

    if (commonNames.includes(lastPart.toLowerCase()) && parts.length >= 2) {
      // Show parent/folder (e.g., ".cursor/commands")
      const parentPart = parts[parts.length - 2];
      return `${parentPart}/${lastPart}`;
    }

    // For unique folder names, just show the folder name
    return lastPart;
  }, []);

  // Filter commands by search
  const filteredCommands = commands
    .filter((cmd) =>
      searchQuery === '' ||
      cmd.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      cmd.displayName.toLowerCase().includes(searchQuery.toLowerCase())
    )
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  // Group filtered commands by directory
  const groupedCommands = useMemo(() => {
    const groups = new Map<string, CommandItem[]>();

    for (const cmd of filteredCommands) {
      // Find which watched directory this command belongs to
      const dir = watchedDirs.find(d => cmd.filePath.startsWith(d.path));
      const dirPath = dir ? dir.path : 'Other';

      if (!groups.has(dirPath)) {
        groups.set(dirPath, []);
      }
      groups.get(dirPath)!.push(cmd);
    }

    return groups;
  }, [filteredCommands, watchedDirs]);

  // Add directory handler (from path input)
  const handleAddDirectory = useCallback(async (dirPath: string) => {
    const trimmed = dirPath.trim();
    if (!trimmed) return;

    const result = await window.commandsAPI?.addWatchedDir(trimmed);
    if (result) {
      setWatchedDirs((prev) => [...prev, result]);
    } else {
      // Check if the path (expanded) matches an existing watched dir
      // The backend expands ~ to the full home path
      const dirs = await window.commandsAPI?.getWatchedDirs();
      const alreadyWatched = dirs?.some((d) => {
        // Check if the new path resolves to an existing watched path
        const inputPath = trimmed.replace(/^~/, '');
        return d.path.endsWith(inputPath) || d.path === trimmed;
      });

      if (alreadyWatched) {
        window.alert('This directory is already being watched.');
      } else {
        window.alert('Directory not found. Please check the path and try again.');
      }
    }
  }, []);

  // Remove directory handler
  const handleRemoveDirectory = useCallback(async (dirPath: string) => {
    const success = await window.commandsAPI?.removeWatchedDir(dirPath);
    if (success) {
      setWatchedDirs((prev) => prev.filter((d) => d.path !== dirPath));
    }
  }, []);

  // Create new command handler — routes to the inline input per directory
  // since Electron silently disables window.prompt(). If no directory is
  // configured yet, auto-create the default and open its inline input.
  const handleCreateCommand = useCallback(async () => {
    let targetDir: string | null = null;
    if (watchedDirs.length === 0) {
      const defaultDir = await window.commandsAPI?.createDefaultDirectory();
      if (!defaultDir) return;
      targetDir = defaultDir;
      const dirs = await window.commandsAPI?.getWatchedDirs();
      if (dirs) setWatchedDirs(dirs);
    } else {
      // Default to the first watched directory. Users with multiple can
      // still click the "+" on a specific folder header.
      targetDir = watchedDirs[0].path;
    }
    if (!targetDir) return;
    setCreatingInDir(targetDir);
    setNewCommandName('');
    setNewCommandError(null);
    setTimeout(() => newCommandInputRef.current?.focus(), 50);
  }, [watchedDirs]);

  // Create new command in a specific directory
  // Start inline input for new command
  const startCreatingCommand = useCallback((dirPath: string) => {
    setCreatingInDir(dirPath);
    setNewCommandName('');
    setNewCommandError(null);
    // Focus the input after render
    setTimeout(() => newCommandInputRef.current?.focus(), 50);
  }, []);

  // Cancel inline input
  const cancelCreatingCommand = useCallback(() => {
    setCreatingInDir(null);
    setNewCommandName('');
    setNewCommandError(null);
  }, []);

  // Actually create the command with the given name
  const handleCreateCommandInDir = useCallback(async (targetDir: string, name: string) => {
    if (!name.trim()) {
      cancelCreatingCommand();
      return;
    }

    setNewCommandError(null);
    const initialContent = `# ${name}\n\n`;
    const result = await window.commandsAPI?.createCommand(targetDir, name.trim(), initialContent);
    if (result) {
      // Refresh and select the new command
      const updatedCommands = await window.commandsAPI?.getCommands();
      if (updatedCommands) {
        setCommands(updatedCommands);
        setSelectedPath(result.path);
        // Enter edit mode directly with the content we already know
        setEditContent(initialContent);
        setIsEditing(true);
      }
      cancelCreatingCommand();
    } else {
      setNewCommandError('A command with that name already exists.');
      setTimeout(() => {
        newCommandInputRef.current?.focus();
        newCommandInputRef.current?.select();
      }, 0);
    }
  }, [cancelCreatingCommand]);

  // Delete command handler
  const handleDeleteCommand = useCallback((filePath: string) => {
    confirmDelete({
      title: 'Delete command?',
      message: 'Delete this command? This cannot be undone.',
      onConfirm: async () => {
        const success = await window.commandsAPI?.deleteCommand(filePath);
        if (success) {
          // Refresh commands
          const updatedCommands = await window.commandsAPI?.getCommands();
          if (updatedCommands) {
            setCommands(updatedCommands);
            // Select next command or clear selection
            if (selectedPath === filePath) {
              if (updatedCommands.length > 0) {
                setSelectedPath(updatedCommands[0].filePath);
              } else {
                setSelectedPath(null);
              }
            }
          }
        }
      },
    });
  }, [confirmDelete, selectedPath]);

  // Rename command handler — kicks off the inline input in the sidebar.
  // Actual rename happens in commitRename() when the user confirms.
  const handleRenameCommand = useCallback((filePath: string, currentName: string) => {
    setRenamingPath(filePath);
    setRenameDraft(currentName);
    setRenameError(null);
  }, []);

  const cancelRename = useCallback(() => {
    setRenamingPath(null);
    setRenameDraft('');
    setRenameError(null);
  }, []);

  const commitRename = useCallback(async () => {
    if (!renamingPath) return;
    const trimmed = renameDraft.trim();
    const cmd = commands.find((c) => c.filePath === renamingPath);
    if (!trimmed || !cmd || trimmed === cmd.displayName) {
      cancelRename();
      return;
    }
    setRenameError(null);
    const newFilePath = await window.commandsAPI?.renameCommand(renamingPath, trimmed);
    if (newFilePath) {
      const updated = await window.commandsAPI?.getCommands();
      if (updated) {
        setCommands(updated);
        setSelectedPath(newFilePath);
      }
      cancelRename();
    } else {
      setRenameError('A command with that name already exists.');
      setTimeout(() => {
        renameInputRef.current?.focus();
        renameInputRef.current?.select();
      }, 0);
    }
  }, [renamingPath, renameDraft, commands, cancelRename]);

  // Autofocus the rename input when it appears.
  useEffect(() => {
    if (renamingPath) renameInputRef.current?.focus();
  }, [renamingPath]);

  // Close context menu on click-outside or Escape
  useEffect(() => {
    if (!contextMenu) return;
    const handleClose = () => setContextMenu(null);
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setContextMenu(null); };
    window.addEventListener('click', handleClose);
    window.addEventListener('keydown', handleKey);
    window.addEventListener('scroll', handleClose, true);
    return () => {
      window.removeEventListener('click', handleClose);
      window.removeEventListener('keydown', handleKey);
      window.removeEventListener('scroll', handleClose, true);
    };
  }, [contextMenu]);

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
      {/* Sidebar - kept in DOM when collapsed for instant transition */}
      <div
        ref={sidebarPaneRef}
        style={{
          width: sidebarCollapsed ? '0px' : `${sidebarWidth}px`,
          minWidth: sidebarCollapsed ? '0px' : `${sidebarWidth}px`,
          overflow: 'hidden',
          userSelect: isResizing ? 'none' : 'auto',
          display: 'block',
          flexShrink: 0,
          transition: isResizing ? undefined : 'width 0.18s ease, min-width 0.18s ease',
        }}
      >
        <div
          ref={sidebarInnerRef}
          style={{
            width: `${sidebarWidth}px`,
            height: '100%',
            overflowX: 'hidden',
            overflowY: 'auto',
            padding: '12px 0',
            display: 'flex',
            flexDirection: 'column',
            pointerEvents: sidebarCollapsed ? 'none' : 'auto',
          }}
        >
        {/* Header - Librarian style */}
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
          <span
            onClick={() => setViewMode('mine')}
            style={{
              fontSize: '11px',
              fontWeight: 600,
              color: viewMode === 'mine' ? theme.textSecondary : theme.isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.25)',
              cursor: 'pointer',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}
          >
            Internal
          </span>
          <span style={{ color: theme.isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)' }}>|</span>
          <span
            onClick={() => setViewMode('popular')}
            style={{
              fontSize: '11px',
              fontWeight: 600,
              color: viewMode === 'popular' ? theme.textSecondary : theme.isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.25)',
              cursor: 'pointer',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}
          >
            Shared
          </span>
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

        {/* Hotkey hint */}
        <div style={{ padding: '0 12px 6px', fontSize: '10px', color: theme.isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)' }}>
          <kbd style={{ fontFamily: fonts.mono, fontSize: '10px' }}>&#8679;&#8984;K</kbd> to invoke
        </div>

        {/* Collapsible search input */}
        {searchOpen && (
          <div style={{ padding: '0 8px 8px' }}>
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search..."
              value={searchQuery}
              onFocus={() => { sidebarKeyboardActiveRef.current = false; }}
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

        {/* Commands list */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {viewMode === 'mine' ? (
            // Internal view - grouped by directory (Librarian style)
            Array.from(groupedCommands.entries()).map(([dirPath, items]) => (
              <div key={dirPath}>
                {/* Directory header with horizontal rule - always show like Librarian */}
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
                    title={dirPath}
                  >
                    {formatDirPath(dirPath)}
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
                  {/* Plus button to create new command in this directory */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      startCreatingCommand(dirPath);
                    }}
                    style={{
                      padding: '2px',
                      backgroundColor: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      color: theme.textSecondary,
                      display: 'flex',
                      alignItems: 'center',
                      flexShrink: 0,
                      opacity: 0.6,
                    }}
                    title="Create new command"
                    onMouseEnter={(e) => {
                      e.currentTarget.style.opacity = '1';
                      e.currentTarget.style.color = theme.accent;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.opacity = '0.6';
                      e.currentTarget.style.color = theme.textSecondary;
                    }}
                  >
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M8 2a.5.5 0 0 1 .5.5v5h5a.5.5 0 0 1 0 1h-5v5a.5.5 0 0 1-1 0v-5h-5a.5.5 0 0 1 0-1h5v-5A.5.5 0 0 1 8 2z"/>
                    </svg>
                  </button>
                </div>
                {/* Inline input for new command name */}
                {creatingInDir === dirPath && (
                  <div style={{ padding: '4px 8px 4px 16px' }}>
                    <InlineNameInput
                      ref={newCommandInputRef}
                      value={newCommandName}
                      onChange={(value) => {
                        setNewCommandName(value);
                        setNewCommandError(null);
                      }}
                      onCommit={() => handleCreateCommandInDir(dirPath, newCommandName)}
                      onCancel={cancelCreatingCommand}
                      error={newCommandError}
                      placeholder="command name..."
                    />
                  </div>
                )}
                {/* Command items - indented under directory like Librarian */}
                {items.map((cmd) => (
                  <div
                    key={cmd.filePath}
                    tabIndex={-1}
                    onMouseDown={(e) => {
                      if (renamingPath === cmd.filePath) return;
                      sidebarKeyboardActiveRef.current = true;
                      e.currentTarget.focus({ preventScroll: true });
                    }}
                    onClick={() => renamingPath !== cmd.filePath && handleSelectCommand(cmd.filePath)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setContextMenu({ x: e.clientX, y: e.clientY, filePath: cmd.filePath, name: cmd.displayName });
                    }}
                    style={{
                      padding: '8px 8px 8px 16px',
                      cursor: 'pointer',
                      backgroundColor:
                        cmd.filePath === selectedPath
                          ? theme.isDark
                            ? 'rgba(255,255,255,0.08)'
                            : 'rgba(0,0,0,0.05)'
                          : 'transparent',
                      borderLeft:
                        cmd.filePath === selectedPath
                          ? `2px solid ${theme.accent}`
                          : '2px solid transparent',
                      transition: 'background-color 0.1s ease',
                      outline: 'none',
                    }}
                  >
                    {renamingPath === cmd.filePath ? (
                      <InlineNameInput
                        ref={renameInputRef}
                        value={renameDraft}
                        onChange={(value) => {
                          setRenameDraft(value);
                          setRenameError(null);
                        }}
                        onCommit={() => { void commitRename(); }}
                        onCancel={cancelRename}
                        error={renameError}
                        stopClickPropagation
                      />
                    ) : (
                      <div
                        style={{
                          fontSize: '12px',
                          fontWeight: 500,
                          color: theme.text,
                          lineHeight: 1.3,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {cmd.displayName}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))
          ) : (
            // Shared view - identical styling to Internal
            popularLoading ? (
              <div style={{ padding: '16px', textAlign: 'center', color: theme.textSecondary, fontSize: '12px' }}>
                Loading...
              </div>
            ) : (
              filteredPopularCommands.map((cmd) => (
                <div
                  key={cmd.id}
                  tabIndex={-1}
                  onMouseDown={(e) => {
                    sidebarKeyboardActiveRef.current = true;
                    e.currentTarget.focus({ preventScroll: true });
                  }}
                  onClick={() => setSelectedPopularId(cmd.id)}
                  style={{
                    padding: '8px 8px 8px 16px',
                    cursor: 'pointer',
                    backgroundColor:
                      cmd.id === selectedPopularId
                        ? theme.isDark
                          ? 'rgba(255,255,255,0.08)'
                          : 'rgba(0,0,0,0.05)'
                        : 'transparent',
                    borderLeft:
                      cmd.id === selectedPopularId
                        ? `2px solid ${theme.accent}`
                        : '2px solid transparent',
                    transition: 'background-color 0.1s ease',
                    outline: 'none',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <div
                      style={{
                        fontSize: '12px',
                        fontWeight: 500,
                        color: theme.text,
                        lineHeight: 1.3,
                        flex: 1,
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {cmd.name}
                    </div>
                    <span style={{ fontSize: '10px', color: theme.textSecondary }}>
                      {cmd.copy_count}×
                    </span>
                  </div>
                </div>
              ))
            )
          )}
        </div>

        </div>
      </div>

      {/* Resize handle */}
      <div
        onMouseDown={handleResizeMouseDown}
        style={{
          width: sidebarCollapsed ? '0px' : '4px',
          minWidth: sidebarCollapsed ? '0px' : '4px',
          cursor: 'col-resize',
          backgroundColor: isResizing ? theme.accent : 'transparent',
          borderRight: sidebarCollapsed ? '0 solid transparent' : `1px solid ${theme.border}`,
          transition: 'width 0.18s ease, min-width 0.18s ease, background-color 0.15s ease',
          flexShrink: 0,
          display: 'block',
          pointerEvents: sidebarCollapsed ? 'none' : 'auto',
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

      {/* Detail pane */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          minHeight: 0,
        }}
      >
        {/* Top draggable region - matches Librarian structure */}
        <div
          style={{
            height: '0px',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            // @ts-ignore - webkit vendor prefix for Electron draggable region
            WebkitAppRegion: 'drag',
            cursor: 'grab',
          }}
        />

        {/* Toolbar - matches Librarian structure */}
        {(selectedCommand || selectedPopularCommand) && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '8px 20px',
              backgroundColor: theme.bg,
              flexShrink: 0,
            }}
          >
            {/* Inner container - matches content width (600px centered) */}
            <div
              style={{
                maxWidth: '600px',
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <ContentToolbar
                filePath={selectedCommand?.filePath}
                isFullScreen={focusImmersive}
                onToggleFullScreen={() => setFocusImmersive((prev) => !prev)}
                textSize={textSize}
                onTextSizeChange={setTextSize}
                showTextSize={focusToolbarControlsVisible}
                isEditing={isEditing}
                isDirty={isDirty}
                isSaving={isSaving}
                onEdit={focusToolbarControlsVisible && viewMode === 'mine' && selectedCommand ? enterEditMode : undefined}
                onSave={saveChanges}
                onCancel={() => {
                  if (isDirty) {
                    const confirmed = window.confirm('Discard changes?');
                    if (!confirmed) return;
                  }
                  exitEditMode();
                }}
                onDelete={focusToolbarControlsVisible && viewMode === 'mine' && selectedCommand && selectedPath ? () => handleDeleteCommand(selectedPath) : undefined}
                showDelete={focusToolbarControlsVisible && viewMode === 'mine' && !!selectedCommand}
                showRename={false}
                onShowInFolder={focusToolbarControlsVisible && viewMode === 'mine' && selectedCommand ? () => window.shellAPI?.showItemInFolder(selectedCommand.filePath) : undefined}
                showFolder={focusToolbarControlsVisible && viewMode === 'mine' && !!selectedCommand}
                onCopy={focusToolbarControlsVisible ? () => {
                  const content = viewMode === 'mine' ? selectedCommand?.content : selectedPopularCommand?.content;
                  const id = viewMode === 'popular' ? selectedPopularCommand?.id : undefined;
                  handleCopyContent(content || '', id);
                } : undefined}
                showCopy={focusToolbarControlsVisible}
                shareStatus={viewMode === 'mine' ? shareStatus : null}
                isSharing={isSharing}
                onToggleShare={focusToolbarControlsVisible && viewMode === 'mine' ? handleShareToggle : undefined}
                showShare={focusToolbarControlsVisible && viewMode === 'mine' && !!selectedCommand}
              />

              {/* Add to Mine button for popular commands */}
              {viewMode === 'popular' && selectedPopularCommand && (
                <button
                  onClick={() => handleAddToMine(selectedPopularCommand)}
                  style={{
                    padding: '4px 10px',
                    fontSize: '12px',
                    color: '#fff',
                    backgroundColor: theme.accent,
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                  }}
                  title="Add to your commands"
                >
                  Add to Mine
                </button>
              )}
            </div>
          </div>
        )}

        {/* Content area */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            padding: '24px 20px',
            display: 'flex',
            justifyContent: 'center',
          }}
        >
          {(viewMode === 'mine' && selectedCommand) || (viewMode === 'popular' && selectedPopularCommand) ? (
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
              {isEditing && selectedCommand ? (
                <textarea
                  value={editContent}
                  onFocus={() => { sidebarKeyboardActiveRef.current = false; }}
                  onChange={(e) => setEditContent(e.target.value)}
                  onBlur={() => {
                    if (isDirty) void saveChanges();
                    else exitEditMode();
                  }}
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
                  placeholder="Write your command markdown here..."
                  autoFocus
                />
              ) : (
                <>
                  {/* Title - show command name as heading */}
                  <h1 style={{
                    fontSize: textSizes[textSize].h1,
                    fontWeight: 600,
                    marginTop: 0,
                    marginBottom: '10px',
                    lineHeight: 1.2,
                    color: theme.text,
                    fontFamily: fonts.sans,
                  }}>
                    {viewMode === 'mine' ? selectedCommand?.name : selectedPopularCommand?.name}
                  </h1>
                  <div
                    className="command-content"
                    // Click into the rendered body to enter edit mode — mirrors
                    // LibrarianView so users can click straight into writing. Clicks on links,
                    // buttons, form controls, or while a text selection is
                    // active still do their normal thing.
                    onClick={(e) => {
                      if (viewMode !== 'mine' || !selectedCommand) return;
                      if (!shouldEnterEditOnClick(e)) return;
                      enterEditMode();
                    }}
                    style={{
                      fontSize: textSizes[textSize].base,
                      lineHeight: 1.5,
                      color: theme.text,
                      fontFamily: fonts.sans,
                      cursor: viewMode === 'mine' && selectedCommand ? 'text' : 'default',
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
                          <p style={{ marginBottom: '8px' }}>{children}</p>
                        ),
                        strong: ({ children }) => (
                          <strong style={{ fontWeight: 600, color: theme.text }}>
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
                                    ? 'rgba(255,255,255,0.08)'
                                    : 'rgba(0,0,0,0.04)',
                                  padding: '1px 4px',
                                  borderRadius: '3px',
                                  fontSize: '0.9em',
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
                          <ul style={{ marginBottom: '16px', paddingLeft: '24px' }}>
                            {children}
                          </ul>
                        ),
                        ol: ({ children }) => (
                          <ol style={{ marginBottom: '16px', paddingLeft: '24px' }}>
                            {children}
                          </ol>
                        ),
                        li: ({ children }) => (
                          <li style={{ marginBottom: '4px' }}>{children}</li>
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
                      {displayContent}
                    </ReactMarkdown>
                  </div>
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
                fontSize: '13px',
              }}
            >
              {loading || popularLoading ? 'Loading...' : 'Select a command'}
            </div>
          )}
        </div>
      </div>

      {/* Context menu for command items */}
      {contextMenu && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            top: contextMenu.y,
            left: contextMenu.x,
            zIndex: 9999,
            backgroundColor: theme.isDark ? '#2a2a2a' : '#fff',
            border: `1px solid ${theme.border}`,
            borderRadius: '6px',
            boxShadow: theme.isDark
              ? '0 4px 12px rgba(0,0,0,0.5)'
              : '0 4px 12px rgba(0,0,0,0.15)',
            padding: '4px 0',
            minWidth: '140px',
          }}
        >
          <button
            onClick={() => {
              handleRenameCommand(contextMenu.filePath, contextMenu.name);
              setContextMenu(null);
            }}
            style={{
              display: 'block',
              width: '100%',
              padding: '6px 12px',
              fontSize: '12px',
              color: theme.text,
              backgroundColor: 'transparent',
              border: 'none',
              cursor: 'pointer',
              textAlign: 'left',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            Rename
          </button>
          <button
            onClick={() => {
              handleDeleteCommand(contextMenu.filePath);
              setContextMenu(null);
            }}
            style={{
              display: 'block',
              width: '100%',
              padding: '6px 12px',
              fontSize: '12px',
              color: '#ef4444',
              backgroundColor: 'transparent',
              border: 'none',
              cursor: 'pointer',
              textAlign: 'left',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            Delete
          </button>
        </div>
      )}
      {deleteConfirmationDialog}
    </div>
  );
}
