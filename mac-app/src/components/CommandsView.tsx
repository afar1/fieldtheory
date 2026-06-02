// =============================================================================
// CommandsView - Unified Commands View for portable commands management.
// Based on LibrarianView pattern - two-pane layout with sidebar and detail pane.
// Supports multi-directory watching, full CRUD, and internally gated Shared commands discovery.
// =============================================================================

import { forwardRef, useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { useDeleteConfirmation } from '../hooks/useDeleteConfirmation';
import { fonts } from '../design/tokens';
import { supabase } from '../supabaseClient';
import { useCollapsedSidebarHoverReveal } from '../hooks/useCollapsedSidebarHoverReveal';
import ContentToolbar, { ContentToolbarFolderButton } from './ContentToolbar';
import ContentModeToggleButton from './ContentModeToggleButton';
import FieldTheoryProse from './FieldTheoryProse';
import ImmersiveToggle from './ImmersiveToggle';
import LinkedDocumentsSection from './LinkedDocumentsSection';
import {
  SIDEBAR_DARK_ICON_COLOR,
  SIDEBAR_DARK_TEXT_COLOR,
  SIDEBAR_ICON_TEXT_GAP,
  SIDEBAR_LIGHT_ICON_COLOR,
  SIDEBAR_LIGHT_TEXT_COLOR,
  SidebarFolderIcon,
  SidebarMarkdownIcon,
} from './SidebarIcons';
import { RENDERED_EDIT_CLICK_MODE_CHANGED_EVENT, getMarkdownFormattingShortcut, isImmersiveToggleShortcut, isMarkdownModeToggleShortcut, isMarkdownTaskShortcut, isMarkdownTaskToggleShortcut, isSearchFocusShortcut, restoreRenderedEditClickMode, shouldEnterEditOnClick } from '../utils/editorShortcuts';
import { getDocumentSaveVersion, isDocumentSaveConflict, isDocumentSaveOk } from '../utils/documentSaveConflicts';
import { getMarkdownFormattingEdit } from '../utils/markdownFormatting';
import { getMarkdownTaskShortcutEdit, getMarkdownTaskToggleEdit } from '../utils/markdownTasks';
import {
  buildWikiIndex,
  classifyLinkHref,
  getMarkdownEditorLinkHits,
  getMarkdownLinkedDocuments,
  isUnresolvedWikiHref,
  transformWikiLinks,
  type LinkAction,
  type MarkdownLinkedDocument,
  type MarkdownLinkRelationDocument,
  type WikiIndex,
  type WikiIndexInput,
  type WikiLinkTarget,
  upsertMarkdownLinkRelationDocument,
} from '../utils/wikiLinks';
import { wikiTargetPartsFromUnresolvedTitle } from '../utils/wikiIndexPages';

const COPY_PATH_FEEDBACK_MS = 1600;
const COMMANDS_DOCUMENT_TOOLBAR_ROW_HEIGHT_PX = 42;
const COMMANDS_MARKDOWN_CONTENT_TOP_PADDING_PX = 8;
const COMMANDS_MARKDOWN_CONTENT_BOTTOM_SCROLL_SPACE_PX = 22.2;
const COMMANDS_RENDERED_CONTENT_TOP_PADDING_PX = 28;
const COMMANDS_RENDERED_CONTENT_BOTTOM_SCROLL_SPACE_PX = 44.4;
const COMMANDS_TEXT_SIZE_STORAGE_KEY = 'commands-text-size';
const COMMANDS_SIDEBAR_WIDTH_STORAGE_KEY = 'commands-sidebar-width';
const COMMANDS_RENDERER_STORAGE_CHANGED_EVENT = 'fieldtheory:renderer-storage-changed';
const BROWSER_HELPER_EVENT_STREAM_OPEN_EVENT = 'fieldtheory:browser-helper-event-stream-open';
type CommandsTextSize = 'small' | 'normal' | 'large';

function loadCommandsTextSize(): CommandsTextSize {
  const saved = localStorage.getItem(COMMANDS_TEXT_SIZE_STORAGE_KEY);
  return (saved === 'small' || saved === 'normal' || saved === 'large') ? saved : 'normal';
}

function loadCommandsSidebarWidth(): number {
  const saved = localStorage.getItem(COMMANDS_SIDEBAR_WIDTH_STORAGE_KEY);
  const parsed = saved ? parseInt(saved, 10) : NaN;
  return Number.isFinite(parsed) ? parsed : 180;
}

function isCommandsStorageKey(key: string | null | undefined): boolean {
  return key === COMMANDS_TEXT_SIZE_STORAGE_KEY || key === COMMANDS_SIDEBAR_WIDTH_STORAGE_KEY;
}

export function getCommandsContentTopPadding(input: {
  isEditing: boolean;
  focusChromeActive: boolean;
}): number {
  const normalTopPadding = input.isEditing
    ? COMMANDS_MARKDOWN_CONTENT_TOP_PADDING_PX
    : COMMANDS_RENDERED_CONTENT_TOP_PADDING_PX;

  return input.focusChromeActive
    ? normalTopPadding + COMMANDS_DOCUMENT_TOOLBAR_ROW_HEIGHT_PX
    : normalTopPadding;
}

export function getCommandsContentBottomScrollSpace(input: {
  isEditing: boolean;
  focusChromeActive: boolean;
}): number {
  return input.isEditing ? 0 : COMMANDS_RENDERED_CONTENT_BOTTOM_SCROLL_SPACE_PX;
}

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
  onFocusChromeActiveChange?: (active: boolean, visualVisible?: boolean, visualOpacity?: number) => void;
  initialCommandPath?: string | null;
  onInitialCommandConsumed?: () => void;
  onFocusChromeShortcut?: () => void;
  focusChromeEnabled?: boolean;
  onFocusChromeEnabledChange?: (enabled: boolean) => void;
  focusChromeGroupOpacity?: number;
  canNavigateBack?: boolean;
  canNavigateForward?: boolean;
  onNavigateBack?: () => void;
  onNavigateForward?: () => void;
  onSelectedCommandPathChange?: (path: string | null) => void;
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
  documentVersion: DocumentVersion;
}

type DeletedCommandUndo = {
  command: CommandWithContent;
  directoryPath: string;
  restoreName: string;
  previousSelectedPath: string | null;
};

function commandNameFromFilePath(filePath: string): string {
  const fileName = filePath.split(/[\\/]+/).filter(Boolean).at(-1) ?? filePath;
  return fileName.replace(/\.md$/i, '');
}

function commandDirectoryFromFilePath(filePath: string): string {
  const match = filePath.match(/^(.*)[\\/][^\\/]+$/);
  return match?.[1] ?? '';
}

function commandFileNameFromFilePath(filePath: string): string {
  return filePath.split(/[\\/]+/).filter(Boolean).at(-1) ?? commandNameFromFilePath(filePath);
}

function commandsToWikiIndexPages(commands: Array<{ name: string; displayName: string; filePath: string }>): WikiIndexInput[] {
  return commands.flatMap((command) => {
    const displayTitle = command.displayName || command.name;
    const base = {
      relPath: command.filePath,
      commandPath: command.filePath,
    };
    return displayTitle === command.name
      ? [{ ...base, title: command.name }]
      : [{ ...base, title: displayTitle }, { ...base, title: command.name }];
  });
}

function upsertCommandItem(commands: CommandItem[], command: CommandItem): CommandItem[] {
  const existingIndex = commands.findIndex((item) => item.filePath === command.filePath);
  if (existingIndex >= 0) {
    return commands.map((item, index) => index === existingIndex ? command : item);
  }
  return [...commands, command];
}

/**
 * Watched directory.
 */
interface WatchedDir {
  path: string;
  enabled: boolean;
}

type CommandsContextMenu =
  | { x: number; y: number; kind: 'command'; filePath: string; name: string }
  | { x: number; y: number; kind: 'directory'; dirPath: string }
  | { x: number; y: number; kind: 'sidebar' };

export default function CommandsView({
  onSwitchToClipboard,
  sidebarCollapsed = false,
  onFocusChromeActiveChange,
  initialCommandPath,
  onInitialCommandConsumed,
  onFocusChromeShortcut,
  focusChromeEnabled,
  onFocusChromeEnabledChange,
  focusChromeGroupOpacity = 0,
  canNavigateBack = false,
  canNavigateForward = false,
  onNavigateBack,
  onNavigateForward,
  onSelectedCommandPathChange,
}: CommandsViewProps) {
  const { theme } = useTheme();
  const { confirmDelete, deleteConfirmationDialog } = useDeleteConfirmation();

  // View mode: 'mine' or 'popular'
  const [viewMode, setViewMode] = useState<'mine' | 'popular'>('mine');
  const [fieldTheorySyncEnabled, setFieldTheorySyncEnabled] = useState(false);

  // Watched directories
  const [watchedDirs, setWatchedDirs] = useState<WatchedDir[]>([]);

  // Commands state
  const [commands, setCommands] = useState<CommandItem[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedCommand, setSelectedCommand] = useState<CommandWithContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [readings, setReadings] = useState<ReadingMeta[]>([]);
  const [wikiIndexPages, setWikiIndexPages] = useState<WikiIndexInput[]>([]);
  const [markdownLinkRelationDocuments, setMarkdownLinkRelationDocuments] = useState<MarkdownLinkRelationDocument[]>([]);

  // Popular commands state
  const [popularCommands, setPopularCommands] = useState<PopularCommand[]>([]);
  const [selectedPopularId, setSelectedPopularId] = useState<string | null>(null);
  const [popularLoading, setPopularLoading] = useState(false);

  // Search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const sidebarKeyboardActiveRef = useRef(false);

  // Edit mode
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const flushSaveRef = useRef<(() => Promise<boolean>) | null>(null);
  const lastSavedContentRef = useRef<string | null>(null);
  const lastSavedVersionRef = useRef<DocumentVersion | null>(null);
  const lastSeededPathRef = useRef<string | null>(null);
  const deletedCommandUndoRef = useRef<DeletedCommandUndo | null>(null);

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
  const [textSize, setTextSize] = useState<CommandsTextSize>(loadCommandsTextSize);
  const [renderedEditClickMode, setRenderedEditClickMode] = useState(() => restoreRenderedEditClickMode(localStorage));

  // Layout
  const [sidebarWidth, setSidebarWidth] = useState(loadCommandsSidebarWidth);
  const [sidebarHoverExpanded, setSidebarHoverExpanded] = useState(false);
  const sidebarWidthRef = useRef(sidebarWidth);
  const [isResizing, setIsResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const sidebarPaneRef = useRef<HTMLDivElement | null>(null);
  const sidebarInnerRef = useRef<HTMLDivElement | null>(null);
  const editTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const editTextareaFocusedRef = useRef(false);
  const commandContentRef = useRef<HTMLDivElement | null>(null);
  const wikiIndexRef = useRef<WikiIndex | null>(null);
  const collapsedSidebarHoverReveal = useCollapsedSidebarHoverReveal(setSidebarHoverExpanded);

  // Sharing state
  const [shareStatus, setShareStatus] = useState<{ shared: boolean; id?: string } | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const [copyFeedbackLabel, setCopyFeedbackLabel] = useState<string | null>(null);
  const copyPathFeedbackTimerRef = useRef<number | null>(null);

  const [uncontrolledFocusImmersive, setUncontrolledFocusImmersive] = useState(false);
  const focusImmersive = focusChromeEnabled ?? uncontrolledFocusImmersive;
  const setFocusImmersive = useCallback((next: boolean | ((prev: boolean) => boolean)) => {
    const nextValue = typeof next === 'function' ? next(focusImmersive) : next;
    if (focusChromeEnabled === undefined) {
      setUncontrolledFocusImmersive(nextValue);
    }
    onFocusChromeEnabledChange?.(nextValue);
  }, [focusChromeEnabled, focusImmersive, onFocusChromeEnabledChange]);
  const focusChromeActive = focusImmersive && sidebarCollapsed;
  const focusChromeVisualOpacity = focusChromeActive ? focusChromeGroupOpacity : 1;
  const focusChromeVisualVisible = focusChromeVisualOpacity > 0;
  const focusToolbarControlsVisible = !focusChromeActive || focusChromeVisualVisible;
  const commandContentTopPadding = getCommandsContentTopPadding({ isEditing, focusChromeActive });
  const commandContentBottomScrollSpace = getCommandsContentBottomScrollSpace({ isEditing, focusChromeActive });
  const toggleFocusImmersive = useCallback(() => {
    if (!focusImmersive) {
      onFocusChromeShortcut?.();
    }
    setFocusImmersive((prev) => !prev);
  }, [focusImmersive, onFocusChromeShortcut, setFocusImmersive]);
  const handleEditTextareaKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (isImmersiveToggleShortcut(e)) {
      e.preventDefault();
      e.stopPropagation();
      e.nativeEvent.stopImmediatePropagation?.();
      toggleFocusImmersive();
      return;
    }

    const formattingKind = getMarkdownFormattingShortcut(e);
    if (formattingKind) {
      e.preventDefault();
      const formattingEdit = getMarkdownFormattingEdit(
        e.currentTarget.value,
        e.currentTarget.selectionStart,
        e.currentTarget.selectionEnd,
        formattingKind,
      );
      const scrollTop = e.currentTarget.scrollTop;
      setEditContent(formattingEdit.nextValue);
      requestAnimationFrame(() => {
        const editor = editTextareaRef.current;
        if (!editor || editor.value !== formattingEdit.nextValue) return;
        editor.setSelectionRange(formattingEdit.selectionStart, formattingEdit.selectionEnd);
        editor.scrollTop = scrollTop;
      });
      return;
    }

    const isTaskToggle = isMarkdownTaskToggleShortcut(e);
    const isTaskCreate = isMarkdownTaskShortcut(e);
    const taskEdit = isTaskToggle
      ? getMarkdownTaskToggleEdit(
        e.currentTarget.value,
        e.currentTarget.selectionStart,
        e.currentTarget.selectionEnd,
      )
      : isTaskCreate
        ? getMarkdownTaskShortcutEdit(
          e.currentTarget.value,
          e.currentTarget.selectionStart,
          e.currentTarget.selectionEnd,
        )
        : null;
    if (isTaskToggle || isTaskCreate) {
      e.preventDefault();
      if (!taskEdit) return;
      const scrollTop = e.currentTarget.scrollTop;
      setEditContent(taskEdit.nextValue);
      requestAnimationFrame(() => {
        const editor = editTextareaRef.current;
        if (!editor || editor.value !== taskEdit.nextValue) return;
        editor.setSelectionRange(taskEdit.selectionStart, taskEdit.selectionEnd);
        editor.scrollTop = scrollTop;
      });
      return;
    }
  }, [toggleFocusImmersive]);

  // Context menu
  const [contextMenu, setContextMenu] = useState<CommandsContextMenu | null>(null);

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
    localStorage.setItem(COMMANDS_SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidth));
  }, [isResizing, sidebarWidth]);

  // Persist text size preference
  useEffect(() => {
    localStorage.setItem(COMMANDS_TEXT_SIZE_STORAGE_KEY, textSize);
  }, [textSize]);

  useEffect(() => {
    const applyStoredCommandPreferences = () => {
      const nextTextSize = loadCommandsTextSize();
      const nextSidebarWidth = loadCommandsSidebarWidth();
      setTextSize((current) => current === nextTextSize ? current : nextTextSize);
      setSidebarWidth((current) => current === nextSidebarWidth ? current : nextSidebarWidth);
      sidebarWidthRef.current = nextSidebarWidth;
      if (!isResizing) applySidebarWidth(nextSidebarWidth);
    };
    const handleRendererStorageChanged = (event: Event) => {
      const key = (event as CustomEvent<{ key?: string | null }>).detail?.key;
      if (isCommandsStorageKey(key)) applyStoredCommandPreferences();
    };
    const handleStorage = (event: Event) => {
      const key = (event as StorageEvent).key;
      if (key === undefined || key === null || isCommandsStorageKey(key)) applyStoredCommandPreferences();
    };
    window.addEventListener(COMMANDS_RENDERER_STORAGE_CHANGED_EVENT, handleRendererStorageChanged);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(COMMANDS_RENDERER_STORAGE_CHANGED_EVENT, handleRendererStorageChanged);
      window.removeEventListener('storage', handleStorage);
    };
  }, [applySidebarWidth, isResizing]);

  useEffect(() => {
    const syncRenderedEditClickMode = () => setRenderedEditClickMode(restoreRenderedEditClickMode(localStorage));
    window.addEventListener('storage', syncRenderedEditClickMode);
    window.addEventListener(RENDERED_EDIT_CLICK_MODE_CHANGED_EVENT, syncRenderedEditClickMode);
    return () => {
      window.removeEventListener('storage', syncRenderedEditClickMode);
      window.removeEventListener(RENDERED_EDIT_CLICK_MODE_CHANGED_EVENT, syncRenderedEditClickMode);
    };
  }, []);

  useEffect(() => {
    onFocusChromeActiveChange?.(focusChromeActive, focusChromeActive && focusChromeVisualVisible, focusChromeActive ? focusChromeVisualOpacity : 0);
  }, [focusChromeActive, focusChromeVisualOpacity, focusChromeVisualVisible, onFocusChromeActiveChange]);

  useEffect(() => {
    return () => onFocusChromeActiveChange?.(false);
  }, [onFocusChromeActiveChange]);

  useEffect(() => {
    let alive = true;
    const syncStatusPromise = window.fieldTheorySyncAPI?.getStatus?.();
    if (!syncStatusPromise) {
      setFieldTheorySyncEnabled(false);
      return () => {
        alive = false;
      };
    }
    syncStatusPromise.then((status) => {
      if (!alive) return;
      setFieldTheorySyncEnabled(status.enabled);
      if (!status.enabled) {
        setViewMode((current) => current === 'popular' ? 'mine' : current);
      }
    }).catch(() => {
      if (alive) setFieldTheorySyncEnabled(false);
    });
    return () => {
      alive = false;
    };
  }, [viewMode]);

  // Fetch popular commands when switching to popular view
  useEffect(() => {
    if (viewMode !== 'popular') return;
    if (!fieldTheorySyncEnabled) return;
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
          setPopularCommands(data ?? []);
        } else {
          setPopularCommands([]);
        }
      } catch (err) {
        console.error('Failed to fetch popular commands:', err);
        setPopularCommands([]);
      } finally {
        setPopularLoading(false);
      }
    };

    fetchPopular();
  }, [viewMode, fieldTheorySyncEnabled, popularCommands.length]);

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

  const commandToolbarContext = useMemo(() => {
    if (viewMode === 'mine' && selectedCommand) {
      const parts = selectedCommand.filePath.split(/[\\/]+/).filter(Boolean);
      const fileName = parts.at(-1) ?? selectedCommand.name;
      const folderName = parts.at(-2) ?? 'Internal';
      return `${folderName} / ${fileName}`;
    }
    if (fieldTheorySyncEnabled && viewMode === 'popular' && selectedPopularCommand) {
      return `Shared / ${selectedPopularCommand.name}`;
    }
    return '';
  }, [fieldTheorySyncEnabled, selectedCommand, selectedPopularCommand, viewMode]);
  const commandToolbarContextHasFolder = focusToolbarControlsVisible
    && viewMode === 'mine'
    && Boolean(selectedCommand)
    && Boolean(commandToolbarContext);
  const showSelectedCommandInFolder = () => {
    if (selectedCommand?.filePath) {
      window.shellAPI?.showItemInFolder(selectedCommand.filePath);
    }
  };

  const commandIndexKey = useMemo(
    () => JSON.stringify(commands.map(({ name, displayName, filePath }) => [name, displayName, filePath])),
    [commands],
  );
  const commandIndexPages = useMemo(() => commandsToWikiIndexPages(commands), [commandIndexKey]);
  const commandTitleByPath = useMemo(() => new Map(
    commands.map((command) => [command.filePath, command.displayName || command.name]),
  ), [commandIndexKey]);
  const wikiIndex = useMemo(() => buildWikiIndex([
    ...wikiIndexPages,
    ...readings.map((reading) => ({
      relPath: reading.path,
      title: reading.title,
      artifactPath: reading.path,
    })),
    ...commandIndexPages,
  ]), [commandIndexPages, readings, wikiIndexPages]);
  wikiIndexRef.current = wikiIndex;

  const upsertCommandRelationDocument = useCallback((filePath: string, title: string | undefined, content: string) => {
    const currentWikiIndex = wikiIndexRef.current;
    if (!currentWikiIndex) return;
    const commandTitle = title || commandTitleByPath.get(filePath) || filePath;
    setMarkdownLinkRelationDocuments((prev) => upsertMarkdownLinkRelationDocument(prev, {
      target: { kind: 'command', path: filePath },
      title: commandTitle,
      content,
      linkHits: getMarkdownEditorLinkHits(content, currentWikiIndex),
    }));
  }, [commandTitleByPath]);

  // Strip leading h1 from markdown to avoid duplicate heading (we render h1 from filename)
  const displayContent = useMemo(() => {
    const raw = fieldTheorySyncEnabled && viewMode === 'popular'
      ? selectedPopularCommand?.content || ''
      : selectedCommand?.content || '';
    return transformWikiLinks(raw.replace(/^#\s+.+\n?/, ''), wikiIndex);
  }, [fieldTheorySyncEnabled, viewMode, selectedCommand?.content, selectedPopularCommand?.content, wikiIndex]);

  const activeLinkTarget = useMemo<WikiLinkTarget | null>(() => {
    if (viewMode === 'mine' && selectedCommand) {
      return { kind: 'command', path: selectedCommand.filePath };
    }
    return null;
  }, [selectedCommand, viewMode]);
  const hasSelectedCommand = Boolean(selectedCommand);

  const linkedDocuments = useMemo<MarkdownLinkedDocument[]>(() => {
    if (!selectedCommand) return [];
    return getMarkdownLinkedDocuments(
      activeLinkTarget,
      selectedCommand.content,
      markdownLinkRelationDocuments,
      wikiIndex,
    );
  }, [activeLinkTarget, markdownLinkRelationDocuments, selectedCommand, wikiIndex]);

  const flashCopyFeedback = useCallback((label: string) => {
    setCopyFeedbackLabel(label);
    if (copyPathFeedbackTimerRef.current !== null) {
      window.clearTimeout(copyPathFeedbackTimerRef.current);
    }
    copyPathFeedbackTimerRef.current = window.setTimeout(() => {
      setCopyFeedbackLabel(null);
      copyPathFeedbackTimerRef.current = null;
    }, COPY_PATH_FEEDBACK_MS);
  }, []);

  const getRenderedSelectionText = useCallback((): string => {
    const root = commandContentRef.current;
    const selection = window.getSelection();
    if (!root || !selection || selection.isCollapsed || selection.rangeCount === 0) return '';

    for (let i = 0; i < selection.rangeCount; i += 1) {
      const range = selection.getRangeAt(i);
      const container = range.commonAncestorContainer;
      const node = container.nodeType === Node.TEXT_NODE ? container.parentNode : container;
      if (node && root.contains(node)) return selection.toString();
    }
    return '';
  }, []);

  const getSelectedCommandTextOrPath = useCallback((): string => {
    if (!selectedCommand?.filePath) return '';
    const editor = editTextareaRef.current;
    if (editor && editor.selectionStart !== editor.selectionEnd) {
      return editor.value.slice(editor.selectionStart, editor.selectionEnd);
    }
    const renderedSelection = getRenderedSelectionText();
    if (renderedSelection) return renderedSelection;
    return selectedCommand.filePath;
  }, [getRenderedSelectionText, selectedCommand?.filePath]);

  const getSelectedCommandCopyPayload = useCallback((): { text: string; label: string } | null => {
    const text = getSelectedCommandTextOrPath();
    if (!text) return null;
    return {
      text,
      label: text === selectedCommand?.filePath ? 'Copied file path' : 'Copied segment',
    };
  }, [getSelectedCommandTextOrPath, selectedCommand?.filePath]);

  const copySelectedCommandTextOrPath = useCallback(async () => {
    const payload = getSelectedCommandCopyPayload();
    if (!payload) return;
    try {
      await navigator.clipboard.writeText(payload.text);
      flashCopyFeedback(payload.label);
    } catch (err) {
      console.error('Failed to copy command text or path:', err);
    }
  }, [flashCopyFeedback, getSelectedCommandCopyPayload]);

  const copySelectedCommandPath = useCallback(async () => {
    if (!selectedCommand?.filePath) return;
    try {
      await navigator.clipboard.writeText(selectedCommand.filePath);
      flashCopyFeedback('Copied file path');
    } catch (err) {
      console.error('Failed to copy command path:', err);
    }
  }, [flashCopyFeedback, selectedCommand?.filePath]);

  const openFieldTheoryMarkdownTarget = useCallback((target: WikiLinkTarget) => {
    void window.commandsAPI?.openFieldTheoryMarkdown?.({
      kind: target.kind,
      path: target.kind === 'wiki' ? target.relPath : target.path,
    });
  }, []);

  const createUnresolvedWikiLink = useCallback(async (title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;

    const { folder, fileName, relPath } = wikiTargetPartsFromUnresolvedTitle(trimmed);
    const existing = relPath ? await window.wikiAPI?.getPage(relPath) : null;
    if (existing?.relPath) {
      void window.commandsAPI?.openFieldTheoryMarkdown?.({ kind: 'wiki', path: existing.relPath });
      return;
    }

    const page = await window.wikiAPI?.createFile(folder, fileName);
    if (page?.relPath) {
      void window.commandsAPI?.openFieldTheoryMarkdown?.({ kind: 'wiki', path: page.relPath });
    }
  }, []);

  const openLinkAction = useCallback((action: LinkAction) => {
    switch (action.kind) {
      case 'create':
        void createUnresolvedWikiLink(action.title);
        return;
      case 'wiki':
        void window.commandsAPI?.openFieldTheoryMarkdown?.({ kind: 'wiki', path: action.relPath });
        return;
      case 'artifact':
        void window.commandsAPI?.openFieldTheoryMarkdown?.({ kind: 'artifact', path: action.path });
        return;
      case 'command':
        void window.commandsAPI?.openFieldTheoryMarkdown?.({ kind: 'command', path: action.path });
        return;
      case 'external':
        window.shellAPI?.openExternal(action.href);
        return;
      case 'noop':
        return;
    }
  }, [createUnresolvedWikiLink]);

  useEffect(() => {
    return () => {
      if (copyPathFeedbackTimerRef.current !== null) {
        window.clearTimeout(copyPathFeedbackTimerRef.current);
      }
    };
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

  // Check against the content last written to disk; selectedCommand.content is
  // intentionally not round-tripped on every auto-save.
  const isDirty = isEditing && editContent !== (lastSavedContentRef.current ?? selectedCommand?.content ?? '');

  // Enter edit mode
  const enterEditMode = useCallback(() => {
    if (selectedCommand) {
      setIsEditing(true);
    }
  }, [selectedCommand]);

  const insertMarkdownText = useCallback((text: string) => {
    if (!selectedCommand || !text) return;

    const baseContent = isEditing ? editContent : selectedCommand.content;
    const editor = editTextareaRef.current;
    const start = editor ? editor.selectionStart : baseContent.length;
    const end = editor ? editor.selectionEnd : start;
    const nextContent = `${baseContent.slice(0, start)}${text}${baseContent.slice(end)}`;
    const nextSelection = start + text.length;

    if (!isEditing) {
      lastSavedContentRef.current = selectedCommand.content;
      lastSavedVersionRef.current = selectedCommand.documentVersion;
      lastSeededPathRef.current = selectedCommand.filePath;
      setIsEditing(true);
    }

    setEditContent(nextContent);
    requestAnimationFrame(() => {
      const nextEditor = editTextareaRef.current;
      if (!nextEditor || nextEditor.value !== nextContent) return;
      nextEditor.focus({ preventScroll: true });
      nextEditor.setSelectionRange(nextSelection, nextSelection);
    });
  }, [editContent, isEditing, selectedCommand]);

  const saveCommandContent = useCallback(async (filePath: string, content: string, title?: string) => {
    try {
      const expectedVersion = lastSavedVersionRef.current;
      const result = expectedVersion
        ? await window.commandsAPI?.saveCommand(filePath, content, expectedVersion)
        : await window.commandsAPI?.saveCommand(filePath, content);
      if (isDocumentSaveConflict(result)) {
        const reload = window.confirm('This command changed on disk outside Field Theory. Press OK to reload the disk version, or Cancel to overwrite it with your current edit.');
        if (reload && result.currentContent !== undefined && result.currentVersion) {
          setSelectedCommand((prev) => prev && prev.filePath === filePath
            ? { ...prev, content: result.currentContent, documentVersion: result.currentVersion }
            : prev
          );
          upsertCommandRelationDocument(filePath, title, result.currentContent);
          setEditContent(result.currentContent);
          lastSavedContentRef.current = result.currentContent;
          lastSavedVersionRef.current = result.currentVersion;
          return true;
        }
        if (result.currentVersion) {
          const overwrite = await window.commandsAPI?.saveCommand(filePath, content, result.currentVersion);
          if (!isDocumentSaveOk(overwrite)) return false;
          const nextVersion = getDocumentSaveVersion(overwrite);
          setSelectedCommand((prev) => prev && prev.filePath === filePath
            ? { ...prev, content, ...(nextVersion ? { documentVersion: nextVersion } : {}) }
            : prev
          );
          upsertCommandRelationDocument(filePath, title, content);
          lastSavedContentRef.current = content;
          lastSavedVersionRef.current = nextVersion ?? result.currentVersion;
          return true;
        }
        return false;
      }
      if (isDocumentSaveOk(result)) {
        const nextVersion = getDocumentSaveVersion(result);
        setSelectedCommand((prev) => prev && prev.filePath === filePath
          ? { ...prev, content, ...(nextVersion ? { documentVersion: nextVersion } : {}) }
          : prev
        );
        upsertCommandRelationDocument(filePath, title, content);
        lastSavedContentRef.current = content;
        if (nextVersion) lastSavedVersionRef.current = nextVersion;
        return true;
      }
    } catch (err) {
      console.error('Failed to save command:', err);
    }
    return false;
  }, [upsertCommandRelationDocument]);

  const flushCurrentEdit = useCallback(async () => {
    const pendingSave = flushSaveRef.current;
    if (pendingSave) return pendingSave();
    if (!selectedCommand || !isDirty) return true;
    return saveCommandContent(selectedCommand.filePath, editContent, selectedCommand.displayName || selectedCommand.name);
  }, [editContent, isDirty, saveCommandContent, selectedCommand]);

  const exitEditMode = useCallback(async () => {
    const saved = await flushCurrentEdit();
    if (!saved) return false;
    setIsEditing(false);
    setEditContent('');
    lastSeededPathRef.current = null;
    return true;
  }, [flushCurrentEdit]);

  const switchToRenderedMode = useCallback(() => {
    if (!isEditing) return;
    void exitEditMode();
  }, [exitEditMode, isEditing]);

  // Save any command edit before switching files, matching Library behavior.
  const handleSelectCommand = useCallback(async (path: string) => {
    if (isEditing) {
      const saved = await flushCurrentEdit();
      if (!saved) return;
    }
    setSelectedPath(path);
  }, [flushCurrentEdit, isEditing]);

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
        if (result.length > 0) {
          setSelectedPath((currentPath) => currentPath ?? result[0].filePath);
        }
        // Default to Shared tab for internal sync users if no local commands exist.
        if (result.length === 0 && fieldTheorySyncEnabled) {
          setViewMode('popular');
        }
      }
      setLoading(false);
    }
    loadData();
  }, [fieldTheorySyncEnabled]);

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

  // Seed editContent when entering markdown mode or switching files while
  // editing. Guard by path so our own save updates do not reset the textarea.
  useEffect(() => {
    if (!isEditing || !selectedCommand) {
      lastSeededPathRef.current = null;
      return;
    }
    if (lastSeededPathRef.current === selectedCommand.filePath) return;
    setEditContent(selectedCommand.content);
    lastSavedContentRef.current = selectedCommand.content;
    lastSavedVersionRef.current = selectedCommand.documentVersion;
    lastSeededPathRef.current = selectedCommand.filePath;
  }, [isEditing, selectedCommand]);

  // Debounced auto-save, matching Library's markdown editor behavior.
  useEffect(() => {
    flushSaveRef.current = null;
    if (!isEditing || !selectedCommand) return;
    if (editContent === lastSavedContentRef.current) return;

    const targetPath = selectedCommand.filePath;
    const targetTitle = selectedCommand.displayName || selectedCommand.name;
    const targetContent = editContent;
    let done = false;
    const doSave = async () => {
      if (done) return true;
      done = true;
      const saved = await saveCommandContent(targetPath, targetContent, targetTitle);
      if (flushSaveRef.current === doSave) flushSaveRef.current = null;
      return saved;
    };

    flushSaveRef.current = doSave;
    const timer = setTimeout(() => { void doSave(); }, 400);
    return () => clearTimeout(timer);
  }, [editContent, isEditing, saveCommandContent, selectedCommand]);

  useEffect(() => {
    if (!initialCommandPath) return;
    setViewMode('mine');
    setSelectedPath(initialCommandPath);
    onInitialCommandConsumed?.();
  }, [initialCommandPath, onInitialCommandConsumed]);

  useEffect(() => {
    onSelectedCommandPathChange?.(selectedPath);
  }, [onSelectedCommandPathChange, selectedPath]);

  useEffect(() => {
    const unsubscribe = window.librarianAPI?.onInsertMarkdownText(insertMarkdownText);
    return () => unsubscribe?.();
  }, [insertMarkdownText]);

  useEffect(() => {
    return () => window.librarianAPI?.setMarkdownEditorFocused?.(false);
  }, []);

  const reportCurrentMarkdownEditorFocus = useCallback(() => {
    window.librarianAPI?.setMarkdownEditorFocused?.(editTextareaFocusedRef.current);
  }, []);

  useEffect(() => {
    window.addEventListener(BROWSER_HELPER_EVENT_STREAM_OPEN_EVENT, reportCurrentMarkdownEditorFocus);
    return () => {
      window.removeEventListener(BROWSER_HELPER_EVENT_STREAM_OPEN_EVENT, reportCurrentMarkdownEditorFocus);
    };
  }, [reportCurrentMarkdownEditorFocus]);

  // Listen for commands changes. Also refresh on window focus as a safety
  // net — fs.watch with recursive:true is flaky on macOS for renames, so
  // external filename changes can be missed until the user comes back.
  useEffect(() => {
    const unsubscribe = window.commandsAPI?.onCommandsChanged((updatedCommands) => {
      setCommands(updatedCommands);
    });
    const reloadCommands = async () => {
      const fresh = await window.commandsAPI?.getCommands();
      if (fresh) setCommands(fresh);
    };
    window.addEventListener('focus', reloadCommands);
    window.addEventListener(BROWSER_HELPER_EVENT_STREAM_OPEN_EVENT, reloadCommands);
    return () => {
      unsubscribe?.();
      window.removeEventListener('focus', reloadCommands);
      window.removeEventListener(BROWSER_HELPER_EVENT_STREAM_OPEN_EVENT, reloadCommands);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const result = await window.librarianAPI?.getReadings?.();
      if (!cancelled && result) setReadings(result);
    };
    void load();
    window.addEventListener(BROWSER_HELPER_EVENT_STREAM_OPEN_EVENT, load);
    return () => {
      cancelled = true;
      window.removeEventListener(BROWSER_HELPER_EVENT_STREAM_OPEN_EVENT, load);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const folders = await window.wikiAPI?.getTree?.();
      if (!cancelled && folders) {
        setWikiIndexPages(
          folders.flatMap((folder) => folder.files.map((page) => ({ relPath: page.relPath, title: page.title }))),
        );
      }
    };
    void load();
    const unsubscribe = window.wikiAPI?.onPageChanged?.(() => { void load(); });
    window.addEventListener(BROWSER_HELPER_EVENT_STREAM_OPEN_EVENT, load);
    return () => {
      cancelled = true;
      unsubscribe?.();
      window.removeEventListener(BROWSER_HELPER_EVENT_STREAM_OPEN_EVENT, load);
    };
  }, []);

  useEffect(() => {
    if (!hasSelectedCommand) {
      setMarkdownLinkRelationDocuments([]);
      return;
    }

    let cancelled = false;
    const load = async () => {
      const wikiDocuments: Array<MarkdownLinkRelationDocument | null> = await Promise.all(
        wikiIndexPages.map(async (page) => {
          const fullPage = await window.wikiAPI?.getPage?.(page.relPath);
          return fullPage
            ? {
              target: { kind: 'wiki' as const, relPath: fullPage.relPath },
              title: fullPage.title,
              content: fullPage.content,
              linkHits: getMarkdownEditorLinkHits(fullPage.content, wikiIndex),
            }
            : null;
        }),
      );
      const artifactDocuments: Array<MarkdownLinkRelationDocument | null> = await Promise.all(
        readings.map(async (reading) => {
          const fullReading = await window.librarianAPI?.getReading?.(reading.path);
          return fullReading
            ? {
              target: { kind: 'artifact' as const, path: fullReading.path },
              title: fullReading.title,
              content: fullReading.content,
              linkHits: getMarkdownEditorLinkHits(fullReading.content, wikiIndex),
            }
            : null;
        }),
      );
      const commandPagesByPath = new Map<string, WikiIndexInput>();
      for (const command of commandIndexPages) {
        const commandPath = command.commandPath;
        if (commandPath && !commandPagesByPath.has(commandPath)) commandPagesByPath.set(commandPath, command);
      }
      const commandDocuments: Array<MarkdownLinkRelationDocument | null> = await Promise.all(
        Array.from(commandPagesByPath.entries()).map(async ([commandPath, command]) => {
          const fullCommand = await window.commandsAPI?.getCommandByPath?.(commandPath);
          return fullCommand
            ? {
              target: { kind: 'command' as const, path: fullCommand.filePath },
              title: fullCommand.displayName || command.title,
              content: fullCommand.content,
              linkHits: getMarkdownEditorLinkHits(fullCommand.content, wikiIndex),
            }
            : null;
        }),
      );
      if (cancelled) return;
      setMarkdownLinkRelationDocuments(
        [...wikiDocuments, ...artifactDocuments, ...commandDocuments]
          .filter((document): document is MarkdownLinkRelationDocument => document !== null),
      );
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [commandIndexPages, hasSelectedCommand, readings, wikiIndex, wikiIndexPages]);

  // Check if selected command is already shared
  useEffect(() => {
    async function checkShareStatus() {
      if (!fieldTheorySyncEnabled || !selectedCommand || !supabase) {
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
  }, [fieldTheorySyncEnabled, selectedCommand]);

  // Toggle share status - routes through main process for proper auth
  const handleShareToggle = useCallback(async () => {
    if (!fieldTheorySyncEnabled || !selectedCommand || isSharing) return;

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
  }, [fieldTheorySyncEnabled, selectedCommand, shareStatus, isSharing]);

  const undoDeletedCommand = useCallback(async (): Promise<boolean> => {
    const undo = deletedCommandUndoRef.current;
    if (!undo || !undo.directoryPath || !window.commandsAPI?.createCommand) return false;

    const result = await window.commandsAPI.createCommand(undo.directoryPath, undo.restoreName, undo.command.content);
    if (!result) return false;

    const restoredCommand = await window.commandsAPI.getCommandByPath(result.path);
    const nextCommand = restoredCommand ?? {
      ...undo.command,
      filePath: result.path,
      name: result.name,
      displayName: result.name,
    };
    setCommands((current) => upsertCommandItem(current, {
      name: nextCommand.name,
      displayName: nextCommand.displayName,
      filePath: nextCommand.filePath,
    }));
    setSelectedPath(undo.previousSelectedPath === undo.command.filePath ? nextCommand.filePath : undo.previousSelectedPath);
    if (undo.previousSelectedPath === undo.command.filePath) {
      setSelectedCommand(nextCommand);
      setEditContent(nextCommand.content);
      lastSavedContentRef.current = nextCommand.content;
      lastSavedVersionRef.current = nextCommand.documentVersion;
      lastSeededPathRef.current = nextCommand.filePath;
    }
    deletedCommandUndoRef.current = null;
    return true;
  }, []);

  // Keyboard navigation
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (isImmersiveToggleShortcut(e)) {
        e.preventDefault();
        toggleFocusImmersive();
        return;
      }

      // Cmd+. - toggle edit mode
      if (isMarkdownModeToggleShortcut(e)) {
        e.preventDefault();
        if (isEditing) {
          void exitEditMode();
        } else if (selectedCommand) {
          enterEditMode();
        }
        return;
      }

      // Cmd+S - save while editing and return to rendered mode.
      if (e.key === 's' && e.metaKey && isEditing) {
        e.preventDefault();
        void exitEditMode();
        return;
      }

      // Escape: exit edit mode, then exit to clipboard
      if (e.key === 'Escape') {
        if (isEditing) {
          void exitEditMode();
        } else if (focusImmersive) {
          setFocusImmersive(false);
        } else {
          onSwitchToClipboard();
        }
        return;
      }

      if (e.metaKey && !e.shiftKey && !e.altKey && !e.ctrlKey) {
        if (e.key === '[' && canNavigateBack && onNavigateBack) {
          e.preventDefault();
          onNavigateBack();
          return;
        }
        if (e.key === ']' && canNavigateForward && onNavigateForward) {
          e.preventDefault();
          onNavigateForward();
          return;
        }
      }

      // / focuses sidebar search. Cmd+F is reserved for in-file find.
      if (isSearchFocusShortcut(e)) {
        e.preventDefault();
        sidebarKeyboardActiveRef.current = false;
        setSearchOpen(true);
        window.requestAnimationFrame(() => {
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
        });
        return;
      }

      // Cmd+C copies selected command text first, then falls back to the file path.
      const activeElement = document.activeElement;
      const isFormField = activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement;
      const isCommandEditor = activeElement === editTextareaRef.current;
      if (e.key === 'c' && e.metaKey && e.shiftKey && viewMode === 'mine' && selectedCommand?.filePath && (!isFormField || isCommandEditor)) {
        e.preventDefault();
        void copySelectedCommandPath();
        return;
      }

      if (e.key === 'c' && e.metaKey && !e.shiftKey && viewMode === 'mine' && selectedCommand?.filePath && (!isFormField || isCommandEditor)) {
        e.preventDefault();
        void copySelectedCommandTextOrPath();
        return;
      }

      if (e.key.toLowerCase() === 'z' && e.metaKey && !e.shiftKey && !e.altKey && !e.ctrlKey) {
        const inEditableField = activeElement instanceof HTMLInputElement
          || activeElement instanceof HTMLTextAreaElement
          || (activeElement instanceof HTMLElement && activeElement.isContentEditable);
        if (!inEditableField && deletedCommandUndoRef.current) {
          e.preventDefault();
          void undoDeletedCommand();
          return;
        }
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
  }, [commands, selectedPath, searchQuery, watchedDirs, isEditing, focusImmersive, selectedCommand, viewMode, onSwitchToClipboard, enterEditMode, exitEditMode, handleSelectCommand, toggleFocusImmersive, copySelectedCommandTextOrPath, copySelectedCommandPath, undoDeletedCommand, canNavigateBack, canNavigateForward, onNavigateBack, onNavigateForward]);

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
  const sidebarIconColor = theme.isDark ? SIDEBAR_DARK_ICON_COLOR : SIDEBAR_LIGHT_ICON_COLOR;
  const sidebarTextColor = theme.isDark ? SIDEBAR_DARK_TEXT_COLOR : SIDEBAR_LIGHT_TEXT_COLOR;

  // Add directory handler (from path input)
  const handleAddDirectory = useCallback(async (dirPath: string) => {
    const trimmed = dirPath.trim();
    if (!trimmed) return;

    const result = await window.commandsAPI?.addWatchedDir(trimmed);
    if (result) {
      const [dirs, cmds] = await Promise.all([
        window.commandsAPI?.getWatchedDirs(),
        window.commandsAPI?.getCommands(),
      ]);
      if (dirs) setWatchedDirs(dirs);
      if (cmds) setCommands(cmds);
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

  const handleBrowseAndAddDirectory = useCallback(async () => {
    setContextMenu(null);
    const dirPath = await window.commandsAPI?.browseDirectory();
    if (!dirPath) return;
    await handleAddDirectory(dirPath);
  }, [handleAddDirectory]);

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
      const command = {
        name: result.name,
        displayName: result.name,
        filePath: result.path,
      };
      setCommands((current) => upsertCommandItem(current, command));
      setSelectedPath(result.path);
      const loaded = await window.commandsAPI?.getCommandByPath(result.path);
      if (loaded) {
        setSelectedCommand(loaded);
        setEditContent(loaded.content);
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
      message: 'Delete this command? Press Command+Z to undo.',
      onConfirm: async () => {
        const commandBeforeDelete = selectedCommand?.filePath === filePath
          ? selectedCommand
          : await window.commandsAPI?.getCommandByPath(filePath) ?? null;
        const success = await window.commandsAPI?.deleteCommand(filePath);
        if (success) {
          if (commandBeforeDelete) {
            deletedCommandUndoRef.current = {
              command: commandBeforeDelete,
              directoryPath: commandDirectoryFromFilePath(filePath),
              restoreName: commandFileNameFromFilePath(filePath),
              previousSelectedPath: selectedPath,
            };
          }
          const updatedCommands = commands.filter((command) => command.filePath !== filePath);
          setCommands(updatedCommands);
          if (selectedPath === filePath) {
            setSelectedPath(updatedCommands[0]?.filePath ?? null);
            setSelectedCommand(null);
          }
        }
      },
    });
  }, [commands, confirmDelete, selectedCommand, selectedPath]);

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
      const displayName = commandNameFromFilePath(newFilePath);
      setCommands((current) => current.map((command) => command.filePath === renamingPath
        ? { ...command, name: displayName, displayName, filePath: newFilePath }
        : command
      ));
      setSelectedPath(newFilePath);
      setSelectedCommand((current) => current?.filePath === renamingPath
        ? { ...current, name: displayName, displayName, filePath: newFilePath }
        : current
      );
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

  const sidebarTemporarilyExpanded = sidebarCollapsed && sidebarHoverExpanded;
  const sidebarVisible = !sidebarCollapsed || sidebarTemporarilyExpanded;
  const handleCollapsedSidebarSurfaceMouseDownCapture = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!sidebarTemporarilyExpanded) return;
    const target = event.target;
    if (target instanceof Node && sidebarPaneRef.current?.contains(target)) return;
    setSidebarHoverExpanded(false);
  }, [sidebarTemporarilyExpanded]);

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onMouseDownCapture={handleCollapsedSidebarSurfaceMouseDownCapture}
      onMouseMove={collapsedSidebarHoverReveal.handleSurfaceMouseMove}
      onMouseLeave={collapsedSidebarHoverReveal.handleSurfaceMouseLeave}
      style={{
        display: 'flex',
        flex: 1,
        minHeight: 0,
        outline: 'none',
        backgroundColor: theme.bg,
        position: 'relative',
      }}
    >
      {sidebarCollapsed && !sidebarTemporarilyExpanded && (
        <div
          aria-hidden="true"
          data-fieldtheory-collapsed-sidebar-hover-strip="true"
          onMouseOver={collapsedSidebarHoverReveal.handleHoverStripMouseOver}
          onClick={collapsedSidebarHoverReveal.handleHoverStripClick}
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: 0,
            width: `${collapsedSidebarHoverReveal.hoverStripWidth}px`,
            zIndex: 25,
            cursor: 'pointer',
            opacity: collapsedSidebarHoverReveal.affordanceOpacity,
            backgroundColor: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
            boxShadow: theme.isDark ? 'inset 1px 0 rgba(255,255,255,0.16)' : 'inset 1px 0 rgba(0,0,0,0.14)',
            transition: 'opacity 120ms ease',
          }}
        />
      )}
      {/* Sidebar - kept in DOM when collapsed for instant transition */}
      <div
        ref={sidebarPaneRef}
        data-fieldtheory-collapsed-sidebar-pane="true"
        style={{
          width: sidebarVisible ? `${sidebarWidth}px` : '0px',
          minWidth: sidebarVisible ? `${sidebarWidth}px` : '0px',
          overflow: 'hidden',
          userSelect: isResizing ? 'none' : 'auto',
          display: 'block',
          flexShrink: 0,
          zIndex: sidebarTemporarilyExpanded ? 30 : undefined,
          boxShadow: sidebarTemporarilyExpanded ? (theme.isDark ? '12px 0 24px rgba(0,0,0,0.36)' : '12px 0 24px rgba(0,0,0,0.12)') : undefined,
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
            pointerEvents: sidebarVisible ? 'auto' : 'none',
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
          {fieldTheorySyncEnabled && (
            <>
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
            </>
          )}
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
              placeholder="Search commands (/)"
              data-fieldtheory-top-nav-search="true"
              onBlur={(e) => {
                if (!e.currentTarget.value.trim()) setSearchOpen(false);
              }}
              value={searchQuery}
              onFocus={() => { sidebarKeyboardActiveRef.current = false; }}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Tab' && e.ctrlKey && !e.altKey && !e.metaKey) {
                  setSearchOpen(false);
                  setSearchQuery('');
                  e.currentTarget.blur();
                  return;
                }
                if (e.key === 'Escape') {
                  e.stopPropagation();
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
        <div
          onContextMenu={(e) => {
            if (viewMode !== 'mine') return;
            e.preventDefault();
            setContextMenu({ x: e.clientX, y: e.clientY, kind: 'sidebar' });
          }}
          style={{ flex: 1, overflowY: 'auto' }}
        >
          {viewMode === 'mine' || !fieldTheorySyncEnabled ? (
            // Internal view - grouped by directory (Librarian style)
            Array.from(groupedCommands.entries()).map(([dirPath, items]) => (
              <div key={dirPath}>
                {/* Directory header with horizontal rule - always show like Librarian */}
                <div
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setContextMenu({ x: e.clientX, y: e.clientY, kind: 'directory', dirPath });
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: SIDEBAR_ICON_TEXT_GAP,
                    padding: '12px 12px 6px',
                  }}
                >
                  <SidebarFolderIcon color={sidebarIconColor} />
                  <span
                    style={{
                      fontSize: '10px',
                      fontWeight: 600,
                      color: sidebarTextColor,
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
                      e.stopPropagation();
                      setContextMenu({ x: e.clientX, y: e.clientY, kind: 'command', filePath: cmd.filePath, name: cmd.displayName });
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
                          display: 'flex',
                          alignItems: 'center',
                          gap: SIDEBAR_ICON_TEXT_GAP,
                          minWidth: 0,
                        }}
                      >
                        <SidebarMarkdownIcon color={sidebarIconColor} />
                        <div
                          style={{
                            fontSize: '12px',
                            fontWeight: 500,
                            color: sidebarTextColor,
                            lineHeight: 1.3,
                            flex: 1,
                            minWidth: 0,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {cmd.displayName}
                        </div>
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: SIDEBAR_ICON_TEXT_GAP }}>
                    <SidebarMarkdownIcon color={sidebarIconColor} />
                    <div
                      style={{
                        fontSize: '12px',
                        fontWeight: 500,
                        color: sidebarTextColor,
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
          width: sidebarVisible ? '4px' : '0px',
          minWidth: sidebarVisible ? '4px' : '0px',
          cursor: 'col-resize',
          backgroundColor: isResizing ? theme.accent : 'transparent',
          borderRight: sidebarVisible && !sidebarTemporarilyExpanded ? `1px solid ${theme.border}` : '0 solid transparent',
          transition: 'width 0.18s ease, min-width 0.18s ease, background-color 0.15s ease',
          flexShrink: 0,
          display: 'block',
          pointerEvents: sidebarVisible ? 'auto' : 'none',
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
              position: focusChromeActive ? 'absolute' : 'relative',
              top: focusChromeActive ? 0 : undefined,
              left: focusChromeActive ? 0 : undefined,
              right: focusChromeActive ? 0 : undefined,
              zIndex: focusChromeActive ? 20 : undefined,
              boxSizing: 'border-box',
              opacity: focusChromeVisualOpacity,
              pointerEvents: focusChromeVisualVisible ? 'auto' : 'none',
              transition: 'opacity 90ms linear',
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
              {commandToolbarContextHasFolder && (
                <ContentToolbarFolderButton onShowInFolder={showSelectedCommandInFolder} />
              )}
              {focusToolbarControlsVisible && commandToolbarContext && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    minWidth: 0,
                    flexShrink: 1,
                    // @ts-ignore - keep context text selectable/clickable outside the drag region.
                    WebkitAppRegion: 'no-drag',
                  }}
                  title={fieldTheorySyncEnabled && viewMode === 'popular' ? selectedPopularCommand?.name : selectedCommand?.filePath}
                >
                  <span
                    style={{
                      fontSize: '11px',
                      color: theme.textSecondary,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      fontFamily: 'system-ui, sans-serif',
                    }}
                  >
                    {commandToolbarContext}
                  </span>
                </div>
              )}
              <ContentToolbar
                filePath={selectedCommand?.filePath}
                isFullScreen={focusImmersive}
                dragSpacer={!focusChromeActive}
                canNavigateBack={canNavigateBack}
                canNavigateForward={canNavigateForward}
                onNavigateBack={onNavigateBack}
                onNavigateForward={onNavigateForward}
                textSize={textSize}
                onTextSizeChange={setTextSize}
                showTextSize={focusToolbarControlsVisible}
                onDelete={focusToolbarControlsVisible && viewMode === 'mine' && selectedCommand && selectedPath ? () => handleDeleteCommand(selectedPath) : undefined}
                showDelete={focusToolbarControlsVisible && viewMode === 'mine' && !!selectedCommand}
                showRename={false}
                onShowInFolder={focusToolbarControlsVisible && viewMode === 'mine' && selectedCommand ? showSelectedCommandInFolder : undefined}
                showFolder={focusToolbarControlsVisible && viewMode === 'mine' && !!selectedCommand && !commandToolbarContextHasFolder}
                onCopyPath={focusToolbarControlsVisible && viewMode === 'mine' && selectedCommand?.filePath ? copySelectedCommandTextOrPath : undefined}
                copyPathCopied={copyFeedbackLabel !== null}
                copyPathTitle="Copy selected text or command path (⌘C)"
              />

              {/* Command-specific trailing actions. */}
              {fieldTheorySyncEnabled && focusToolbarControlsVisible && viewMode === 'mine' && selectedCommand && (
                <button
                  type="button"
                  onClick={handleShareToggle}
                  disabled={isSharing}
                  style={{
                    height: '24px',
                    padding: '3px 8px',
                    fontSize: '11px',
                    color: shareStatus?.shared ? theme.accent : theme.textSecondary,
                    backgroundColor: 'transparent',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: isSharing ? 'default' : 'pointer',
                    opacity: isSharing ? 0.6 : 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    // @ts-ignore - toolbar buttons should receive clicks.
                    WebkitAppRegion: 'no-drag',
                  }}
                  title={shareStatus?.shared ? 'Remove from Shared' : 'Add to Shared'}
                >
                  {isSharing ? 'Sharing...' : shareStatus?.shared ? 'Shared' : 'Share'}
                </button>
              )}
              {focusToolbarControlsVisible && viewMode === 'mine' && selectedCommand && (
                <ContentModeToggleButton
                  mode={isEditing ? 'markdown' : 'rendered'}
                  onSwitchToSource={enterEditMode}
                  onSwitchToRendered={switchToRenderedMode}
                />
              )}
              {fieldTheorySyncEnabled && focusToolbarControlsVisible && viewMode === 'popular' && selectedPopularCommand && (
                <button
                  type="button"
                  onClick={() => handleAddToMine(selectedPopularCommand)}
                  style={{
                    height: '24px',
                    padding: '3px 8px',
                    fontSize: '11px',
                    color: '#fff',
                    backgroundColor: theme.accent,
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    // @ts-ignore - toolbar buttons should receive clicks.
                    WebkitAppRegion: 'no-drag',
                  }}
                  title="Add to your commands"
                >
                  Add to Mine
                </button>
              )}
              <ImmersiveToggle isFullScreen={focusImmersive} onToggle={toggleFocusImmersive} />
            </div>
          </div>
        )}

        {/* Content area */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            padding: `${commandContentTopPadding}px 20px 0 20px`,
            scrollPaddingBottom: `${commandContentBottomScrollSpace}px`,
            display: 'flex',
            justifyContent: 'center',
          }}
        >
          {((viewMode === 'mine' || !fieldTheorySyncEnabled) && selectedCommand) || (fieldTheorySyncEnabled && viewMode === 'popular' && selectedPopularCommand) ? (
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
                  ref={editTextareaRef}
                  data-ft-agent-context="markdown"
                  data-ft-agent-file-path={selectedCommand.filePath}
                  data-ft-agent-title={selectedCommand.displayName}
                  value={editContent}
                  onFocus={() => {
                    sidebarKeyboardActiveRef.current = false;
                    editTextareaFocusedRef.current = true;
                    window.librarianAPI?.setMarkdownEditorFocused?.(true);
                  }}
                  onBlur={() => {
                    editTextareaFocusedRef.current = false;
                    window.librarianAPI?.setMarkdownEditorFocused?.(false);
                  }}
                  onChange={(e) => setEditContent(e.target.value)}
                  onKeyDown={handleEditTextareaKeyDown}
                  style={{
                    flex: 1,
                    minHeight: 0,
                    padding: 0,
                    scrollPaddingBottom: `${COMMANDS_MARKDOWN_CONTENT_BOTTOM_SCROLL_SPACE_PX}px`,
                    fontSize: textSizes[textSize].base,
                    lineHeight: 1.5,
                    fontFamily: fonts.sans,
                    backgroundColor: 'transparent',
                    border: 'none',
                    borderRadius: 0,
                    color: theme.text,
                    resize: 'none',
                    outline: 'none',
                    boxShadow: 'none',
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
                    {fieldTheorySyncEnabled && viewMode === 'popular' ? selectedPopularCommand?.name : selectedCommand?.name}
                  </h1>
                  <FieldTheoryProse
                    ref={commandContentRef}
                    className="command-content"
                    onClick={(e) => {
                      if (viewMode !== 'mine' || !selectedCommand) return;
                      if (!shouldEnterEditOnClick(e, renderedEditClickMode)) return;
                      enterEditMode();
                    }}
                    color={theme.text}
                    fontFamily={fonts.sans}
                    fontSize={textSizes[textSize].base}
                    h1Size={textSizes[textSize].h1}
                    h2Size={textSizes[textSize].h2}
                    h3Size={textSizes[textSize].h3}
                    linkColor={theme.accent}
                    mutedColor={theme.textSecondary}
                    size="compact"
                    surface={theme.isDark ? 'dark' : 'light'}
                    style={{
                      cursor: viewMode === 'mine' && selectedCommand ? 'text' : 'default',
                    }}
                    components={{
                      li: ({ children, node }) => {
                        const className = (node as { properties?: { className?: unknown } }).properties?.className;
                        const isTaskListItem = Array.isArray(className)
                          ? className.includes('task-list-item')
                          : className === 'task-list-item';
                        return (
                          <li
                            style={{
                              marginBottom: '4px',
                              listStyle: isTaskListItem ? 'none' : undefined,
                            }}
                          >
                            {children}
                          </li>
                        );
                      },
                      a: ({ href, children }) => {
                        const unresolved = isUnresolvedWikiHref(href);
                        const openAnchorLink = (target: HTMLAnchorElement) => {
                          const effectiveHref = href && href.trim()
                            ? href
                            : (target.textContent?.trim() ?? '');
                          openLinkAction(classifyLinkHref(effectiveHref, wikiIndex));
                        };
                        return (
                          <a
                            href={href}
                            style={{
                              color: unresolved ? '#ef4444' : theme.accent,
                              textDecoration: 'underline',
                              textDecorationColor: unresolved ? '#ef4444' : `${theme.accent}66`,
                              textUnderlineOffset: '2px',
                              cursor: 'pointer',
                            }}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              openAnchorLink(e.currentTarget);
                            }}
                          >
                            {children}
                          </a>
                        );
                      },
                    }}
                  >
                    {displayContent}
                  </FieldTheoryProse>
                  {viewMode === 'mine' && (
                    <LinkedDocumentsSection links={linkedDocuments} onOpen={openFieldTheoryMarkdownTarget} />
                  )}
                  {commandContentBottomScrollSpace > 0 && (
                    <div
                      aria-hidden="true"
                      data-testid="command-rendered-bottom-scroll-space"
                      data-ft-rendered-bottom-scroll-space="commands"
                      style={{ height: `${commandContentBottomScrollSpace}px`, flexShrink: 0 }}
                    />
                  )}
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

      {/* Context menu for command sidebar */}
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
          {contextMenu.kind === 'command' && (
            <>
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
            </>
          )}
          {contextMenu.kind === 'directory' && (
            <button
              onClick={() => {
                startCreatingCommand(contextMenu.dirPath);
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
              New Command
            </button>
          )}
          {(contextMenu.kind === 'directory' || contextMenu.kind === 'sidebar') && (
            <button
              onClick={() => { void handleBrowseAndAddDirectory(); }}
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
              Add Commands Folder...
            </button>
          )}
        </div>
      )}
      {deleteConfirmationDialog}

      {copyFeedbackLabel && (
        <div
          role="status"
          style={{
            position: 'absolute',
            left: '50%',
            bottom: '14px',
            transform: 'translateX(-50%)',
            padding: '4px 8px',
            borderRadius: '5px',
            fontSize: '11px',
            color: theme.isDark ? '#d1fae5' : '#065f46',
            backgroundColor: theme.isDark ? 'rgba(6, 95, 70, 0.7)' : 'rgba(209, 250, 229, 0.95)',
            border: `1px solid ${theme.isDark ? 'rgba(110, 231, 183, 0.28)' : 'rgba(5, 150, 105, 0.2)'}`,
            pointerEvents: 'none',
            zIndex: 6,
          }}
        >
          {copyFeedbackLabel}
        </div>
      )}
    </div>
  );
}
