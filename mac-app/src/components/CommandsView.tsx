// =============================================================================
// CommandsView - Unified Commands View for portable commands management.
// Based on LibrarianView pattern - two-pane layout with sidebar and detail pane.
// Supports multi-directory watching, full CRUD, and Shared commands discovery.
// =============================================================================

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import ReactMarkdown from 'react-markdown';
import { fonts } from '../design/tokens';
import { supabase } from '../supabaseClient';
import ContentToolbar from './ContentToolbar';

interface CommandsViewProps {
  onSwitchToClipboard: () => void;
  onSwitchToSettings?: () => void;
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

export default function CommandsView({ onSwitchToClipboard, onSwitchToSettings }: CommandsViewProps) {
  const { theme } = useTheme();

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

  // Path input for empty state
  const [pathInput, setPathInput] = useState('');

  // Edit mode
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Inline new command input
  const [creatingInDir, setCreatingInDir] = useState<string | null>(null);
  const [newCommandName, setNewCommandName] = useState('');
  const newCommandInputRef = useRef<HTMLInputElement>(null);

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
  const [isResizing, setIsResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Hover states for toolbar buttons
  const [hoveredButton, setHoveredButton] = useState<string | null>(null);

  // Sharing state
  const [shareStatus, setShareStatus] = useState<{ shared: boolean; id?: string } | null>(null);
  const [isSharing, setIsSharing] = useState(false);

  // Fullscreen/focus mode
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [headerHovered, setHeaderHovered] = useState(true);

  // Context menu
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; filePath: string; name: string } | null>(null);

  // Text size values (smaller than Librarian for compact commands)
  const textSizes = {
    small: { base: '12px', h1: '18px', h2: '14px', h3: '13px' },
    normal: { base: '14px', h1: '22px', h2: '17px', h3: '15px' },
    large: { base: '16px', h1: '26px', h2: '20px', h3: '17px' },
  };

  // Persist sidebar width
  useEffect(() => {
    localStorage.setItem('commands-sidebar-width', String(sidebarWidth));
  }, [sidebarWidth]);

  // Persist text size preference
  useEffect(() => {
    localStorage.setItem('commands-text-size', textSize);
  }, [textSize]);

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
    setIsResizing(true);
  }, []);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const containerRect = containerRef.current?.getBoundingClientRect();
      if (!containerRect) return;

      const newWidth = e.clientX - containerRect.left;
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

      // Load watched directories
      const dirs = await window.commandsAPI?.getWatchedDirs();
      if (dirs) {
        setWatchedDirs(dirs);
      }

      // Load commands
      const result = await window.commandsAPI?.getCommands();
      if (result) {
        setCommands(result);
        // Select first command if any
        if (result.length > 0 && selectedPath === null) {
          setSelectedPath(result[0].filePath);
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

  // Listen for commands changes
  useEffect(() => {
    const unsubscribe = window.commandsAPI?.onCommandsChanged((updatedCommands) => {
      setCommands(updatedCommands);
    });

    return () => unsubscribe?.();
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
      // Cmd+E - toggle edit mode
      if (e.key === 'e' && e.metaKey && !e.shiftKey) {
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
        } else {
          onSwitchToClipboard();
        }
        return;
      }

      // Don't handle navigation keys in edit mode
      if (isEditing) return;

      if (filteredCommands.length === 0) return;

      const currentIndex = filteredCommands.findIndex((c) => c.filePath === selectedPath);

      if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        const newIndex = Math.max(0, currentIndex - 1);
        handleSelectCommand(filteredCommands[newIndex].filePath);
      } else if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        const newIndex = Math.min(filteredCommands.length - 1, currentIndex + 1);
        handleSelectCommand(filteredCommands[newIndex].filePath);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [commands, selectedPath, isEditing, isDirty, selectedCommand, onSwitchToClipboard, enterEditMode, exitEditMode, saveChanges, handleSelectCommand]);

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
      setPathInput('');
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

  // Create new command handler
  const handleCreateCommand = useCallback(async () => {
    const name = window.prompt('Enter command name (without .md extension):');
    if (!name) return;

    // Auto-create default directory if no directories configured
    let targetDir: string;
    if (watchedDirs.length === 0) {
      const defaultDir = await window.commandsAPI?.createDefaultDirectory();
      if (!defaultDir) return;
      targetDir = defaultDir;
      // Refresh watched dirs
      const dirs = await window.commandsAPI?.getWatchedDirs();
      if (dirs) {
        setWatchedDirs(dirs);
      }
    } else if (watchedDirs.length === 1) {
      targetDir = watchedDirs[0].path;
    } else {
      // Multiple directories - prompt which one
      const dirIndex = window.prompt(
        `Select directory (1-${watchedDirs.length}):\n${watchedDirs.map((d, i) => `${i + 1}. ${d.path}`).join('\n')}`
      );
      const idx = parseInt(dirIndex || '1', 10) - 1;
      if (idx >= 0 && idx < watchedDirs.length) {
        targetDir = watchedDirs[idx].path;
      } else {
        targetDir = watchedDirs[0].path;
      }
    }

    const initialContent = `# ${name}\n\n`;
    const result = await window.commandsAPI?.createCommand(targetDir, name, initialContent);
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
    }
  }, [watchedDirs]);

  // Create new command in a specific directory
  // Start inline input for new command
  const startCreatingCommand = useCallback((dirPath: string) => {
    setCreatingInDir(dirPath);
    setNewCommandName('');
    // Focus the input after render
    setTimeout(() => newCommandInputRef.current?.focus(), 50);
  }, []);

  // Cancel inline input
  const cancelCreatingCommand = useCallback(() => {
    setCreatingInDir(null);
    setNewCommandName('');
  }, []);

  // Actually create the command with the given name
  const handleCreateCommandInDir = useCallback(async (targetDir: string, name: string) => {
    if (!name.trim()) {
      cancelCreatingCommand();
      return;
    }

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
      alert('Failed to create command. A file with that name may already exist.');
    }
  }, [cancelCreatingCommand]);

  // Delete command handler
  const handleDeleteCommand = useCallback(async (filePath: string) => {
    const confirmed = window.confirm('Delete this command? This cannot be undone.');
    if (!confirmed) return;

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
  }, [selectedPath]);

  // Rename command handler
  const handleRenameCommand = useCallback(async (filePath: string, currentName: string) => {
    const newName = window.prompt('Enter new command name (without .md extension):', currentName);
    if (!newName || newName === currentName) return;

    const newFilePath = await window.commandsAPI?.renameCommand(filePath, newName);
    if (newFilePath) {
      // Refresh commands
      const updatedCommands = await window.commandsAPI?.getCommands();
      if (updatedCommands) {
        setCommands(updatedCommands);
        // Update selected path to the new file path
        setSelectedPath(newFilePath);
      }
    } else {
      window.alert('Failed to rename command. A file with that name may already exist.');
    }
  }, []);

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

  // Common command directory paths
  const examplePaths = [
    { label: '~/.cursor/commands', path: '~/.cursor/commands' },
    { label: '~/.claude/commands', path: '~/.claude/commands' },
  ];

  // Empty state - no directories configured
  if (!loading && watchedDirs.length === 0) {
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
          outline: 'none',
        }}
      >
        <div style={{ width: '100%', maxWidth: '380px' }}>
          <div style={{ fontSize: '15px', fontWeight: 500, marginBottom: '16px', color: theme.text }}>
            Make existing commands portable
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="text"
              value={pathInput}
              onChange={(e) => setPathInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleAddDirectory(pathInput);
                }
              }}
              placeholder="Enter path to commands directory"
              style={{
                flex: 1,
                padding: '10px 12px',
                fontSize: '13px',
                backgroundColor: theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
                border: `1px solid ${theme.border}`,
                borderRadius: '6px',
                color: theme.text,
                outline: 'none',
              }}
              autoFocus
            />
            <button
              onClick={() => handleAddDirectory(pathInput)}
              disabled={!pathInput.trim()}
              style={{
                padding: '10px 16px',
                fontSize: '13px',
                fontWeight: 500,
                color: pathInput.trim() ? 'white' : theme.textSecondary,
                backgroundColor: pathInput.trim() ? theme.accent : 'transparent',
                border: pathInput.trim() ? 'none' : `1px solid ${theme.border}`,
                borderRadius: '6px',
                cursor: pathInput.trim() ? 'pointer' : 'default',
                opacity: pathInput.trim() ? 1 : 0.5,
              }}
            >
              Add
            </button>
          </div>
          <div style={{ marginTop: '12px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            {examplePaths.map((ex, i) => (
              <span key={ex.path} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {i > 0 && <span style={{ color: theme.textSecondary }}>·</span>}
                <button
                  onClick={() => setPathInput(ex.path)}
                  style={{
                    padding: '4px 8px',
                    fontSize: '12px',
                    fontFamily: "'SF Mono', Monaco, monospace",
                    color: theme.accent,
                    backgroundColor: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    textDecoration: 'underline',
                    textUnderlineOffset: '2px',
                  }}
                  title={`Click to fill: ${ex.path}`}
                >
                  {ex.label}
                </button>
              </span>
            ))}
          </div>
        </div>
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
      {/* Sidebar */}
      <div
        style={{
          width: `${sidebarWidth}px`,
          minWidth: `${sidebarWidth}px`,
          overflowY: 'auto',
          padding: '12px 0',
          userSelect: isResizing ? 'none' : 'auto',
          display: isFullScreen ? 'none' : 'flex',
          flexDirection: 'column',
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
                  <div
                    style={{
                      padding: '4px 8px 4px 16px',
                    }}
                  >
                    <input
                      ref={newCommandInputRef}
                      type="text"
                      value={newCommandName}
                      onChange={(e) => setNewCommandName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleCreateCommandInDir(dirPath, newCommandName);
                        } else if (e.key === 'Escape') {
                          cancelCreatingCommand();
                        }
                      }}
                      onBlur={() => {
                        // Create on blur if there's a name, otherwise cancel
                        if (newCommandName.trim()) {
                          handleCreateCommandInDir(dirPath, newCommandName);
                        } else {
                          cancelCreatingCommand();
                        }
                      }}
                      placeholder="command name..."
                      style={{
                        width: '100%',
                        padding: '4px 8px',
                        fontSize: '12px',
                        backgroundColor: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
                        border: `1px solid ${theme.accent}`,
                        borderRadius: '4px',
                        color: theme.text,
                        outline: 'none',
                      }}
                    />
                  </div>
                )}
                {/* Command items - indented under directory like Librarian */}
                {items.map((cmd) => (
                  <div
                    key={cmd.filePath}
                    onClick={() => handleSelectCommand(cmd.filePath)}
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
                    }}
                  >
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
            Command Settings
          </button>
        </div>
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
          onMouseEnter={() => isFullScreen && setHeaderHovered(true)}
          onMouseLeave={() => isFullScreen && setHeaderHovered(false)}
          style={{
            height: isFullScreen ? '20px' : '0px',
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
            onMouseEnter={() => isFullScreen && setHeaderHovered(true)}
            onMouseLeave={() => isFullScreen && setHeaderHovered(false)}
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
                isFullScreen={isFullScreen}
                onToggleFullScreen={() => setIsFullScreen(!isFullScreen)}
                textSize={textSize}
                onTextSizeChange={setTextSize}
                showTextSize={true}
                isEditing={isEditing}
                isDirty={isDirty}
                isSaving={isSaving}
                onEdit={viewMode === 'mine' && selectedCommand ? enterEditMode : undefined}
                onSave={saveChanges}
                onCancel={() => {
                  if (isDirty) {
                    const confirmed = window.confirm('Discard changes?');
                    if (!confirmed) return;
                  }
                  exitEditMode();
                }}
                onDelete={viewMode === 'mine' && selectedCommand && selectedPath ? () => handleDeleteCommand(selectedPath) : undefined}
                showDelete={viewMode === 'mine' && !!selectedCommand}
                showRename={false}
                onShowInFolder={viewMode === 'mine' && selectedCommand ? () => window.shellAPI?.showItemInFolder(selectedCommand.filePath) : undefined}
                showFolder={viewMode === 'mine' && !!selectedCommand}
                onCopy={() => {
                  const content = viewMode === 'mine' ? selectedCommand?.content : selectedPopularCommand?.content;
                  const id = viewMode === 'popular' ? selectedPopularCommand?.id : undefined;
                  handleCopyContent(content || '', id);
                }}
                showCopy={true}
                shareStatus={viewMode === 'mine' ? shareStatus : null}
                isSharing={isSharing}
                onToggleShare={viewMode === 'mine' ? handleShareToggle : undefined}
                showShare={viewMode === 'mine' && !!selectedCommand}
                headerHovered={headerHovered}
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
                    style={{
                      fontSize: textSizes[textSize].base,
                      lineHeight: 1.5,
                      color: theme.text,
                      fontFamily: fonts.sans,
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
    </div>
  );
}
