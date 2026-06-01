/**
 * ContentToolbar - Shared toolbar component for content views (Librarian, Commands).
 * Provides consistent UI for editing, sharing, and navigation controls.
 */

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { SidebarMarkdownIcon, SidebarRiverIcon } from './SidebarIcons';

// Icon sizes - 22% larger than the original 13px base
const ICON_SIZE = 16; // ~22% larger than 13px
const ICON_SIZE_SMALL = 13; // Standard size for less prominent icons
const COPY_PATH_FEEDBACK_MS = 1600;
const FIELD_THEORY_ICON_URL = `${import.meta.env.BASE_URL}field-theory-icon-black.png`;
const CONTENT_TOOLBAR_PINNED_ACTIONS_STORAGE_KEY = 'fieldtheory.contentToolbar.pinnedActions.v2';

type ToolbarActionId = 'textstyle' | 'contentmode' | 'htmllayout' | 'copypath' | 'copy' | 'share' | 'fieldtheory' | 'agent' | 'terminal' | 'meeting' | 'newwindow' | 'folder' | 'rename' | 'edit' | 'immersive';

const PINNED_TOOLBAR_ACTION_ORDER: ToolbarActionId[] = ['textstyle', 'copypath', 'terminal', 'meeting', 'fieldtheory', 'agent', 'share', 'newwindow', 'contentmode', 'htmllayout', 'immersive', 'copy', 'folder', 'rename', 'edit'];
const DEFAULT_PINNED_TOOLBAR_ACTIONS: ToolbarActionId[] = PINNED_TOOLBAR_ACTION_ORDER;
const TOOLBAR_ACTION_GROUPS: Array<{ id: string; label: string; actions: ToolbarActionId[] }> = [
  { id: 'format', label: 'Format', actions: ['textstyle', 'contentmode', 'htmllayout'] },
  { id: 'copy', label: 'Copy', actions: ['copypath', 'copy', 'share'] },
  { id: 'field', label: 'Field Theory', actions: ['fieldtheory', 'agent'] },
  { id: 'tools', label: 'Tools', actions: ['terminal', 'meeting'] },
  { id: 'view', label: 'View', actions: ['newwindow', 'immersive'] },
  { id: 'file', label: 'File', actions: ['folder', 'rename', 'edit'] },
];

const TEXT_SIZE_OPTIONS: Array<{
  id: 'small' | 'normal' | 'large';
  label: string;
  title: string;
}> = [
  { id: 'small', label: 'Small', title: 'Small text' },
  { id: 'normal', label: 'Normal', title: 'Normal text' },
  { id: 'large', label: 'Large', title: 'Large text' },
];

interface ContentToolbarProps {
  // Content info
  filePath?: string;
  title?: string;

  // View state
  isFullScreen?: boolean;
  onToggleFullScreen?: () => void;
  dragSpacer?: boolean;
  canNavigateBack?: boolean;
  canNavigateForward?: boolean;
  onNavigateBack?: () => void;
  onNavigateForward?: () => void;

  // Text size (for reading views)
  textSize?: 'small' | 'normal' | 'large';
  onTextSizeChange?: (size: 'small' | 'normal' | 'large') => void;
  showTextSize?: boolean;

  // Curated typography presets (for reading/writing views)
  typographyPreset?: string;
  typographyPresetOptions?: Array<{
    id: string;
    label: string;
    title: string;
    fontFamily: string;
  }>;
  onTypographyPresetChange?: (preset: string) => void;

  lineHeight?: string;
  lineHeightOptions?: Array<{
    id: string;
    label: string;
    title: string;
  }>;
  onLineHeightChange?: (lineHeight: string) => void;

  unorderedListMarker?: 'dash' | 'carrot';
  onUnorderedListMarkerChange?: (marker: 'dash' | 'carrot') => void;

  todoMarker?: 'circle' | 'square';
  onTodoMarkerChange?: (marker: 'circle' | 'square') => void;

  onTypographyMenuOpenChange?: (open: boolean) => void;

  // Edit state
  isEditing?: boolean;
  isDirty?: boolean;
  isSaving?: boolean;
  onEdit?: () => void;
  onSave?: () => void;
  onCancel?: () => void;

  // Delete
  onDelete?: () => void;
  showDelete?: boolean;

  // Rename
  onRename?: () => void;
  showRename?: boolean;

  // Folder (show in Finder)
  onShowInFolder?: () => void | Promise<void>;
  showFolder?: boolean;

  // Copy
  onCopy?: () => void;
  showCopy?: boolean;
  copyLabel?: string; // e.g., "Copy" or "Copy Link"

  // Sharing (for Librarian)
  shareStatus?: { shared: boolean; slug?: string; url?: string } | null;
  isSharing?: boolean;
  onToggleShare?: () => void;
  showShare?: boolean;
  shareLabel?: string;
  sharedLabel?: string;
  shareTitle?: string;
  sharedTitle?: string;

  onCopyPath?: () => void | Promise<void>;
  copyPathCopied?: boolean;
  copyPathTitle?: string;

  onOpenInNewWindow?: () => void;
  onSwitchContentMode?: () => void | Promise<void>;
  contentModeTitle?: string;
  contentModeDisabled?: boolean;
  onToggleHtmlLayout?: () => void;
  htmlLayoutTitle?: string;
  htmlLayoutActive?: boolean;
  onToggleTerminal?: () => void;
  terminalVisible?: boolean;
  meetingTitle?: string;
  meetingRecording?: boolean;
  meetingDisabled?: boolean;
  onMeetingClick?: () => void | Promise<void>;
  maxwellItems?: ContentToolbarMaxwellItem[];
  maxwellCanAddCurrent?: boolean;
  maxwellCurrentItemId?: string | null;
  onMaxwellAddCurrent?: () => void;
  onMaxwellVisitItem?: (id: string) => void;
  onMaxwellRunItem?: (id: string) => void;
  onMaxwellRemoveItem?: (id: string) => void;
  onOpenAgent?: () => void;
}

export type ContentToolbarMaxwellItem = {
  id: string;
  title: string;
  subtitle: string;
};

export function ContentToolbarFolderButton({
  onShowInFolder,
  style,
}: {
  onShowInFolder: () => void | Promise<void>;
  style?: CSSProperties;
}) {
  const { theme } = useTheme();
  const iconHoverBackground = theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)';

  return (
    <button
      type="button"
      onClick={onShowInFolder}
      onMouseEnter={(event) => {
        event.currentTarget.style.backgroundColor = iconHoverBackground;
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.backgroundColor = 'transparent';
      }}
      style={{
        padding: '4px 6px',
        color: theme.textSecondary,
        backgroundColor: 'transparent',
        border: 'none',
        borderRadius: '4px',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '24px',
        transition: 'background-color 0.15s ease, color 0.15s ease',
        // @ts-ignore - toolbar buttons should receive clicks.
        WebkitAppRegion: 'no-drag',
        ...style,
      }}
      title="Show in Finder"
      aria-label="Show in Finder"
    >
      <svg width={ICON_SIZE_SMALL} height={ICON_SIZE_SMALL} viewBox="0 0 16 16" fill="currentColor">
        <path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h2.764c.958 0 1.76.56 2.311 1.184C7.985 3.648 8.48 4 9 4h4.5A1.5 1.5 0 0 1 15 5.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12.5v-9zM2.5 3a.5.5 0 0 0-.5.5V6h12v-.5a.5.5 0 0 0-.5-.5H9c-.964 0-1.71-.629-2.174-1.154C6.374 3.334 5.82 3 5.264 3H2.5zM14 7H2v5.5a.5.5 0 0 0 .5.5h11a.5.5 0 0 0 .5-.5V7z" />
      </svg>
    </button>
  );
}

export function ContentToolbarMaxwellButton({
  items,
  canAddCurrent,
  currentItemId,
  onAddCurrent,
  onVisitItem,
  onRunItem,
  onRemoveItem,
}: {
  items: ContentToolbarMaxwellItem[];
  canAddCurrent: boolean;
  currentItemId?: string | null;
  onAddCurrent?: () => void;
  onVisitItem?: (id: string) => void;
  onRunItem?: (id: string) => void;
  onRemoveItem?: (id: string) => void;
}) {
  const { theme } = useTheme();
  const [maxwellMenuOpen, setMaxwellMenuOpen] = useState(false);
  const maxwellMenuRef = useRef<HTMLDivElement | null>(null);
  const iconHoverBackground = theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)';
  const iconActiveBackground = theme.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)';
  const sortedItems = [...items].sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
  const currentItemSaved = Boolean(currentItemId && items.some((item) => item.id === currentItemId));

  useEffect(() => {
    if (!maxwellMenuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && maxwellMenuRef.current?.contains(target)) return;
      setMaxwellMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMaxwellMenuOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [maxwellMenuOpen]);

  return (
    <div
      ref={maxwellMenuRef}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        marginLeft: '2px',
        // @ts-ignore - toolbar buttons should receive clicks.
        WebkitAppRegion: 'no-drag',
      }}
    >
      <button
        type="button"
        onClick={() => setMaxwellMenuOpen((open) => !open)}
        onMouseEnter={(event) => {
          if (!maxwellMenuOpen) event.currentTarget.style.backgroundColor = iconHoverBackground;
        }}
        onMouseLeave={(event) => {
          if (!maxwellMenuOpen) event.currentTarget.style.backgroundColor = 'transparent';
        }}
        title="Field Theory"
        aria-label="Field Theory"
        style={{
          width: '24px',
          height: '24px',
          padding: 0,
          color: maxwellMenuOpen ? (theme.isDark ? '#fff' : '#000') : theme.textSecondary,
          backgroundColor: maxwellMenuOpen ? iconActiveBackground : 'transparent',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          lineHeight: 1,
          transition: 'background-color 0.15s ease, color 0.15s ease',
        }}
      >
        <img
          src={FIELD_THEORY_ICON_URL}
          alt=""
          aria-hidden="true"
          draggable={false}
          style={{
            width: '14px',
            height: '14px',
            display: 'block',
            objectFit: 'contain',
            opacity: maxwellMenuOpen ? 0.94 : 0.72,
            filter: theme.isDark ? 'invert(1)' : 'none',
          }}
        />
      </button>

      {maxwellMenuOpen && (
        <div
          style={{
            position: 'absolute',
            top: '28px',
            right: 0,
            zIndex: 21,
            width: 'max-content',
            minWidth: '176px',
            maxWidth: 'min(260px, calc(100vw - 24px))',
            padding: '5px',
            borderRadius: '8px',
            border: `1px solid ${theme.border}`,
            backgroundColor: theme.isDark ? 'rgba(24,24,24,0.96)' : 'rgba(255,255,255,0.98)',
            boxShadow: theme.isDark ? '0 12px 30px rgba(0,0,0,0.32)' : '0 12px 30px rgba(0,0,0,0.14)',
            backdropFilter: 'blur(14px)',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
          }}
        >
          <div
            style={{
              padding: '1px 5px 3px',
              color: theme.textSecondary,
              fontSize: '10px',
              fontWeight: 600,
              textAlign: 'left',
            }}
          >
            Run a local command
          </div>
          {sortedItems.map((item) => (
            <div
              key={item.id}
              style={{
                display: 'grid',
                gridTemplateColumns: 'auto minmax(72px, max-content) auto auto',
                gap: '4px',
                alignItems: 'center',
                padding: '2px',
                borderRadius: '6px',
              }}
            >
              <button
                type="button"
                onClick={() => {
                  onVisitItem?.(item.id);
                  setMaxwellMenuOpen(false);
                }}
                title="Open saved Field Theory page"
                aria-label={`Open ${item.title}`}
                style={{
                  width: '18px',
                  height: '20px',
                  padding: 0,
                  color: theme.textSecondary,
                  backgroundColor: 'transparent',
                  border: 'none',
                  borderRadius: '5px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <SidebarMarkdownIcon color={theme.textSecondary} />
              </button>
              <div
                title={item.subtitle}
                style={{
                  minWidth: 0,
                  padding: '1px 2px',
                  textAlign: 'left',
                }}
              >
                <div style={{ fontSize: '11px', lineHeight: 1.25, color: theme.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.title}
                </div>
              </div>
              <button
                type="button"
                title="Run this Field Theory page locally"
                onClick={() => {
                  onRunItem?.(item.id);
                  setMaxwellMenuOpen(false);
                }}
                style={{
                  height: '20px',
                  padding: '0 6px',
                  color: theme.textSecondary,
                  backgroundColor: theme.isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)',
                  border: 'none',
                  borderRadius: '5px',
                  cursor: 'pointer',
                  fontSize: '10px',
                  fontWeight: 600,
                }}
              >
                Run
              </button>
              <button
                type="button"
                title="Remove from Field Theory"
                aria-label={`Remove ${item.title} from Field Theory`}
                onClick={() => {
                  onRemoveItem?.(item.id);
                }}
                style={{
                  width: '20px',
                  height: '20px',
                  padding: 0,
                  color: theme.textSecondary,
                  backgroundColor: 'transparent',
                  border: 'none',
                  borderRadius: '5px',
                  cursor: 'pointer',
                  fontSize: '13px',
                  lineHeight: 1,
                  opacity: 0.42,
                }}
              >
                ×
              </button>
            </div>
          ))}
          {items.length === 0 && (
            <div style={{ padding: '4px 8px 6px', color: theme.textSecondary, fontSize: '10px', fontStyle: 'italic', lineHeight: 1.35, textAlign: 'right' }}>
              No saved Field Theory pages yet.
            </div>
          )}
          <button
            type="button"
            disabled={!canAddCurrent}
            onClick={() => {
              if (currentItemSaved && currentItemId) {
                onRemoveItem?.(currentItemId);
              } else {
                onAddCurrent?.();
              }
            }}
            style={{
              height: '24px',
              alignSelf: 'flex-end',
              padding: '0 9px',
              color: canAddCurrent ? theme.textSecondary : theme.textSecondary,
              backgroundColor: theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
              border: `1px solid ${theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}`,
              borderRadius: '5px',
              cursor: canAddCurrent ? 'pointer' : 'default',
              opacity: canAddCurrent ? 1 : 0.5,
              fontSize: '10px',
              textAlign: 'right',
            }}
          >
            {currentItemSaved ? 'remove current page from Field Theory' : 'add current page'}
          </button>
        </div>
      )}
    </div>
  );
}

export default function ContentToolbar({
  filePath,
  isFullScreen = false,
  onToggleFullScreen,
  dragSpacer = true,
  canNavigateBack = false,
  canNavigateForward = false,
  onNavigateBack,
  onNavigateForward,
  textSize,
  onTextSizeChange,
  showTextSize = false,
  typographyPreset,
  typographyPresetOptions,
  onTypographyPresetChange,
  lineHeight,
  lineHeightOptions,
  onLineHeightChange,
  unorderedListMarker,
  onUnorderedListMarkerChange,
  todoMarker,
  onTodoMarkerChange,
  onTypographyMenuOpenChange,
  isEditing = false,
  isDirty = false,
  isSaving = false,
  onEdit,
  onSave,
  onCancel,
  onDelete,
  showDelete = true,
  onRename,
  showRename = false,
  onShowInFolder,
  showFolder = true,
  onCopy,
  showCopy = true,
  copyLabel,
  shareStatus,
  isSharing = false,
  onToggleShare,
  showShare = false,
  shareTitle = 'Add to Shared',
  sharedTitle = 'Remove from Shared',
  onCopyPath,
  copyPathCopied = false,
  copyPathTitle = 'Copy file path (⌘C)',
  onOpenInNewWindow,
  onSwitchContentMode,
  contentModeTitle = 'Switch content mode',
  contentModeDisabled = false,
  onToggleHtmlLayout,
  htmlLayoutTitle = 'Full-width HTML layout',
  htmlLayoutActive = false,
  onToggleTerminal,
  terminalVisible = false,
  meetingTitle = 'Record meeting',
  meetingRecording = false,
  meetingDisabled = false,
  onMeetingClick,
  maxwellItems = [],
  maxwellCanAddCurrent = false,
  maxwellCurrentItemId = null,
  onMaxwellAddCurrent,
  onMaxwellVisitItem,
  onMaxwellRunItem,
  onMaxwellRemoveItem,
  onOpenAgent,
}: ContentToolbarProps) {
  const { theme } = useTheme();
  const [copied, setCopied] = useState(false);
  const [copyPathLocalCopied, setCopyPathLocalCopied] = useState(false);
  const [copyPathHovered, setCopyPathHovered] = useState(false);
  const [typographyMenuOpen, setTypographyMenuOpen] = useState(false);
  const [customizeMenuOpen, setCustomizeMenuOpen] = useState(false);
  const [pinnedActions, setPinnedActions] = useState<ToolbarActionId[]>(() => {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(CONTENT_TOOLBAR_PINNED_ACTIONS_STORAGE_KEY) ?? 'null');
      if (!Array.isArray(parsed)) return DEFAULT_PINNED_TOOLBAR_ACTIONS;
      const known = new Set(TOOLBAR_ACTION_GROUPS.flatMap((group) => group.actions));
      return parsed.filter((id): id is ToolbarActionId => known.has(id as ToolbarActionId));
    } catch {
      return DEFAULT_PINNED_TOOLBAR_ACTIONS;
    }
  });
  const typographyMenuRef = useRef<HTMLDivElement | null>(null);
  const customizeMenuRef = useRef<HTMLDivElement | null>(null);
  const copyPathLocalTimerRef = useRef<number | null>(null);
  const riverShareActive = shareStatus?.shared === true;
  const riverShareColor = riverShareActive ? '#2563eb' : theme.textSecondary;

  // Handle copy with feedback
  const handleCopy = () => {
    if (onCopy) {
      onCopy();
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleCopyPath = async () => {
    if (!onCopyPath) return;
    try {
      await onCopyPath();
      setCopyPathLocalCopied(true);
      if (copyPathLocalTimerRef.current !== null) {
        window.clearTimeout(copyPathLocalTimerRef.current);
      }
      copyPathLocalTimerRef.current = window.setTimeout(() => {
        setCopyPathLocalCopied(false);
        copyPathLocalTimerRef.current = null;
      }, COPY_PATH_FEEDBACK_MS);
    } catch {
      // The caller owns copy failure reporting.
    }
  };

  const copyPathActive = copyPathCopied || copyPathLocalCopied;

  const hasTypographyMenu = Boolean(
    (typographyPresetOptions?.length && onTypographyPresetChange) ||
    (showTextSize && onTextSizeChange) ||
    (lineHeightOptions?.length && onLineHeightChange) ||
    onUnorderedListMarkerChange ||
    onTodoMarkerChange
  );
  const iconHoverBackground = theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)';
  const iconActiveBackground = theme.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)';

  useEffect(() => {
    onTypographyMenuOpenChange?.(typographyMenuOpen);
    return () => {
      if (typographyMenuOpen) onTypographyMenuOpenChange?.(false);
    };
  }, [onTypographyMenuOpenChange, typographyMenuOpen]);

  useEffect(() => {
    return () => {
      if (copyPathLocalTimerRef.current !== null) {
        window.clearTimeout(copyPathLocalTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!typographyMenuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && typographyMenuRef.current?.contains(target)) return;
      setTypographyMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setTypographyMenuOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [typographyMenuOpen]);

  useEffect(() => {
    try {
      window.localStorage.setItem(CONTENT_TOOLBAR_PINNED_ACTIONS_STORAGE_KEY, JSON.stringify(pinnedActions));
    } catch {
      // Non-critical preference persistence.
    }
  }, [pinnedActions]);

  useEffect(() => {
    if (!customizeMenuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && customizeMenuRef.current?.contains(target)) return;
      setCustomizeMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setCustomizeMenuOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [customizeMenuOpen]);

  const canUseToolbarAction = (id: ToolbarActionId) => {
    if (id === 'textstyle') return hasTypographyMenu;
    if (id === 'contentmode') return Boolean(onSwitchContentMode);
    if (id === 'htmllayout') return Boolean(onToggleHtmlLayout);
    if (id === 'copypath') return Boolean(onCopyPath);
    if (id === 'copy') return Boolean(showCopy && onCopy);
    if (id === 'share') return Boolean(showShare && onToggleShare && !isEditing);
    if (id === 'fieldtheory') return Boolean(maxwellItems.length || maxwellCanAddCurrent);
    if (id === 'agent') return Boolean(onOpenAgent);
    if (id === 'terminal') return Boolean(onToggleTerminal);
    if (id === 'meeting') return Boolean(onMeetingClick);
    if (id === 'newwindow') return Boolean(onOpenInNewWindow);
    if (id === 'folder') return Boolean(showFolder && onShowInFolder && !isEditing);
    if (id === 'rename') return Boolean(showRename && onRename && !isEditing);
    if (id === 'edit') return Boolean(onEdit && !isEditing);
    if (id === 'immersive') return Boolean(onToggleFullScreen);
    return false;
  };

  const toolbarActionLabel = (id: ToolbarActionId) => {
    if (id === 'textstyle') return 'Text style';
    if (id === 'contentmode') return contentModeDisabled ? 'Source only' : contentModeTitle;
    if (id === 'htmllayout') return htmlLayoutTitle;
    if (id === 'copypath') return copyPathActive ? 'Copied' : copyPathTitle;
    if (id === 'copy') return copied ? 'Copied' : (copyLabel ?? 'Copy');
    if (id === 'share') return shareStatus?.shared ? sharedTitle : shareTitle;
    if (id === 'fieldtheory') return 'Field Theory';
    if (id === 'agent') return 'Run a local agent';
    if (id === 'terminal') return terminalVisible ? 'Close Terminal' : 'Open Terminal';
    if (id === 'meeting') return meetingTitle;
    if (id === 'newwindow') return 'Open in New Window';
    if (id === 'folder') return 'Show in Finder';
    if (id === 'rename') return 'Rename';
    if (id === 'edit') return 'Edit';
    return isFullScreen ? 'Exit immersive view' : 'Enter immersive view';
  };

  const runToolbarAction = (id: ToolbarActionId) => {
    if (id === 'textstyle') setTypographyMenuOpen((open) => !open);
    if (id === 'contentmode' && !contentModeDisabled) void onSwitchContentMode?.();
    if (id === 'htmllayout') onToggleHtmlLayout?.();
    if (id === 'copypath') void handleCopyPath();
    if (id === 'copy') handleCopy();
    if (id === 'share' && !isSharing) onToggleShare?.();
    if (id === 'agent') onOpenAgent?.();
    if (id === 'terminal') onToggleTerminal?.();
    if (id === 'meeting' && !meetingDisabled) void onMeetingClick?.();
    if (id === 'newwindow') onOpenInNewWindow?.();
    if (id === 'folder') void onShowInFolder?.();
    if (id === 'rename') onRename?.();
    if (id === 'edit') onEdit?.();
    if (id === 'immersive') onToggleFullScreen?.();
  };

  const togglePinnedAction = (id: ToolbarActionId) => {
    setPinnedActions((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const availableToolbarActions = PINNED_TOOLBAR_ACTION_ORDER.filter(canUseToolbarAction);
  const visiblePinnedActions = availableToolbarActions.filter((id) => pinnedActions.includes(id));
  const pillBackground = theme.isDark ? '#27272b' : '#f1eee8';
  const pillBorder = theme.isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.08)';
  const toolbarIconMuted = theme.isDark ? 'rgba(234,234,242,0.42)' : 'rgba(20,20,24,0.44)';
  const toolbarIconPrimary = theme.isDark ? 'rgba(245,245,251,0.84)' : 'rgba(20,20,24,0.72)';
  const toolbarIconStrong = theme.isDark ? 'rgba(245,245,251,0.92)' : 'rgba(14,14,18,0.9)';
  const toolbarHover = theme.isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)';

  const toolbarDivider = (
    <span aria-hidden="true" style={{ width: '1px', height: '16px', margin: '0 4px', backgroundColor: pillBorder, flexShrink: 0 }} />
  );

  const toolbarButtonStyle = (active = false, primary = false, text = false): CSSProperties => ({
    width: text ? 'auto' : '28px',
    minWidth: '28px',
    height: '28px',
    padding: text ? '0 11px' : 0,
    color: active ? toolbarIconStrong : primary ? toolbarIconPrimary : toolbarIconMuted,
    backgroundColor: active ? (theme.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)') : 'transparent',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    fontSize: '12px',
    fontWeight: 500,
    transition: 'background-color 0.14s ease, color 0.14s ease, transform 0.1s ease',
  });

  const renderToolbarIcon = (id: ToolbarActionId) => {
    if (id === 'textstyle') return <span style={{ fontFamily: 'Georgia, serif', fontSize: '14px', fontWeight: 500 }}>A</span>;
    if (id === 'contentmode') {
      return (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="5 4 2 8 5 12" />
          <polyline points="11 4 14 8 11 12" />
        </svg>
      );
    }
    if (id === 'htmllayout') {
      return (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect x="2.5" y="3" width="11" height="10" rx="1.25" stroke="currentColor" strokeWidth="1.35" />
          <path d={htmlLayoutActive ? 'M5 6h6M5 8h6M5 10h6' : 'M6 6h4M6 8h4M6 10h4'} stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      );
    }
    if (id === 'copypath') {
      return (
        <svg width={ICON_SIZE_SMALL} height={ICON_SIZE_SMALL} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          {copyPathActive ? <path d="M3.5 8.3l2.8 2.8 6.2-6.2" /> : (
            <>
              <path d="M6.5 9.5l3-3" />
              <path d="M7.5 4.5l1-1a3 3 0 0 1 4.2 4.2l-1 1" />
              <path d="M8.5 11.5l-1 1a3 3 0 0 1-4.2-4.2l1-1" />
            </>
          )}
        </svg>
      );
    }
    if (id === 'copy') return copied ? 'Copied' : (copyLabel ?? 'Copy');
    if (id === 'share') return <SidebarRiverIcon color={riverShareColor} style={{ opacity: isSharing ? 0.35 : riverShareActive ? 1 : 0.48 }} />;
    if (id === 'fieldtheory') {
      return (
        <ContentToolbarMaxwellButton
          items={maxwellItems}
          canAddCurrent={maxwellCanAddCurrent}
          currentItemId={maxwellCurrentItemId}
          onAddCurrent={onMaxwellAddCurrent}
          onVisitItem={onMaxwellVisitItem}
          onRunItem={onMaxwellRunItem}
          onRemoveItem={onMaxwellRemoveItem}
        />
      );
    }
    if (id === 'agent') {
      return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2v4" /><path d="m6.41 6.41-2.83-2.83" /><path d="M2 12h4" /><path d="m6.41 17.59-2.83 2.83" /><path d="M12 18v4" /><path d="m17.59 17.59 2.83 2.83" /><path d="M18 12h4" /><path d="m17.59 6.41 2.83-2.83" /><circle cx="12" cy="12" r="4" />
        </svg>
      );
    }
    if (id === 'terminal') {
      return (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M2.75 4.25c0-.83.67-1.5 1.5-1.5h7.5c.83 0 1.5.67 1.5 1.5v7.5c0 .83-.67 1.5-1.5 1.5h-7.5c-.83 0-1.5-.67-1.5-1.5v-7.5Z" stroke="currentColor" strokeWidth="1.35" />
          <path d="m5.25 6 2 2-2 2M8.25 10.25h2.5" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    }
    if (id === 'meeting') {
      return meetingRecording ? (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="4" y="4" width="8" height="8" rx="1.5" /></svg>
      ) : (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="5.25" stroke="currentColor" strokeWidth="1.5" /><circle cx="8" cy="8" r="2.25" fill="currentColor" /></svg>
      );
    }
    if (id === 'newwindow') {
      return (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M6 3H3.75C3.06 3 2.5 3.56 2.5 4.25v8C2.5 12.94 3.06 13.5 3.75 13.5h8c.69 0 1.25-.56 1.25-1.25V10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M9 2.5h4.5V7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M8.5 7.5 13.25 2.75" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    }
    if (id === 'folder') {
      return (
        <svg width={ICON_SIZE_SMALL} height={ICON_SIZE_SMALL} viewBox="0 0 16 16" fill="currentColor">
          <path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h2.764c.958 0 1.76.56 2.311 1.184C7.985 3.648 8.48 4 9 4h4.5A1.5 1.5 0 0 1 15 5.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12.5v-9zM2.5 3a.5.5 0 0 0-.5.5V6h12v-.5a.5.5 0 0 0-.5-.5H9c-.964 0-1.71-.629-2.174-1.154C6.374 3.334 5.82 3 5.264 3H2.5zM14 7H2v5.5a.5.5 0 0 0 .5.5h11a.5.5 0 0 0 .5-.5V7z" />
        </svg>
      );
    }
    if (id === 'rename') return <span style={{ fontSize: '13px' }}>✎</span>;
    if (id === 'edit') return 'Edit';
    return (
      <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 4H4v4" /><path d="M16 4h4v4" /><path d="M16 20h4v-4" /><path d="M8 20H4v-4" />
      </svg>
    );
  };

  const renderToolbarAction = (id: ToolbarActionId) => {
    if (id === 'fieldtheory') {
      return (
        <span key={id} title={toolbarActionLabel(id)} aria-label={toolbarActionLabel(id)} style={{ display: 'inline-flex', alignItems: 'center' }}>
          {renderToolbarIcon(id)}
        </span>
      );
    }
    const active = (id === 'textstyle' && typographyMenuOpen) || (id === 'contentmode' && !contentModeDisabled) || (id === 'htmllayout' && htmlLayoutActive) || (id === 'copypath' && copyPathActive) || (id === 'copy' && copied) || (id === 'share' && riverShareActive) || (id === 'terminal' && terminalVisible) || (id === 'meeting' && meetingRecording) || (id === 'immersive' && isFullScreen);
    const textButton = id === 'copy' || id === 'edit';
    const primary = DEFAULT_PINNED_TOOLBAR_ACTIONS.includes(id);
    const disabled = (id === 'contentmode' && contentModeDisabled) || (id === 'meeting' && meetingDisabled);
    return (
      <button
        key={id}
        type="button"
        disabled={disabled}
        onMouseDown={(event) => { if (id === 'copypath') event.preventDefault(); }}
        onClick={() => runToolbarAction(id)}
        title={toolbarActionLabel(id)}
        aria-label={toolbarActionLabel(id)}
        style={{
          ...toolbarButtonStyle(active, primary, textButton),
          cursor: disabled ? 'default' : 'pointer',
          opacity: disabled ? 0.45 : 1,
          color: id === 'share' ? riverShareColor : id === 'meeting' && meetingRecording ? '#dc2626' : id === 'terminal' && terminalVisible ? '#10b981' : id === 'copy' && copied ? (theme.success ?? '#16a34a') : id === 'copypath' && copyPathActive ? (theme.success ?? '#16a34a') : toolbarButtonStyle(active, primary, textButton).color,
        }}
        onMouseEnter={(event) => {
          if (disabled) return;
          event.currentTarget.style.backgroundColor = toolbarHover;
          event.currentTarget.style.color = toolbarIconStrong;
        }}
        onMouseLeave={(event) => {
          const base = toolbarButtonStyle(active, primary, textButton);
          event.currentTarget.style.backgroundColor = String(base.backgroundColor ?? 'transparent');
          event.currentTarget.style.color = String(id === 'share' ? riverShareColor : id === 'meeting' && meetingRecording ? '#dc2626' : id === 'terminal' && terminalVisible ? '#10b981' : base.color);
        }}
      >
        {renderToolbarIcon(id)}
      </button>
    );
  };

  const renderPinnedToolbarGroups = () => visiblePinnedActions.map(renderToolbarAction);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '2px',
        flex: 1,
        borderRadius: '6px',
        margin: '0 -4px',
        padding: '0 4px',
        position: 'relative',
        // @ts-ignore - toolbar controls should be clickable/focusable; the spacer below owns dragging.
        WebkitAppRegion: 'no-drag',
      }}
    >
      {(onNavigateBack || onNavigateForward) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '1px', marginRight: '6px' }}>
          <button type="button" onClick={onNavigateBack} disabled={!canNavigateBack} title="Back" aria-label="Back" style={{ ...toolbarButtonStyle(false), opacity: canNavigateBack ? 1 : 0.32 }}>
            <svg width={ICON_SIZE_SMALL} height={ICON_SIZE_SMALL} viewBox="0 0 16 16" fill="currentColor"><path d="M10.354 3.146a.5.5 0 0 1 0 .708L6.207 8l4.147 4.146a.5.5 0 0 1-.708.708l-4.5-4.5a.5.5 0 0 1 0-.708l4.5-4.5a.5.5 0 0 1 .708 0z" /></svg>
          </button>
          <button type="button" onClick={onNavigateForward} disabled={!canNavigateForward} title="Forward" aria-label="Forward" style={{ ...toolbarButtonStyle(false), opacity: canNavigateForward ? 1 : 0.32 }}>
            <svg width={ICON_SIZE_SMALL} height={ICON_SIZE_SMALL} viewBox="0 0 16 16" fill="currentColor"><path d="M5.646 3.146a.5.5 0 0 0 0 .708L9.793 8l-4.147 4.146a.5.5 0 0 0 .708.708l4.5-4.5a.5.5 0 0 0 0-.708l-4.5-4.5a.5.5 0 0 0-.708 0z" /></svg>
          </button>
        </div>
      )}

      <div
        data-content-toolbar-spacer
        style={{
          flex: 1,
          height: '24px',
          // @ts-ignore - webkit vendor prefix for Electron draggable region
          WebkitAppRegion: dragSpacer ? 'drag' : 'no-drag',
          cursor: dragSpacer ? 'grab' : 'default',
        }}
      />

      {isEditing ? (
        <>
          {isDirty && <span style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: theme.accent, marginRight: '4px' }} title="Unsaved changes" />}
          {onSave && <button type="button" onClick={onSave} disabled={!isDirty || isSaving} style={{ ...toolbarButtonStyle(false, true, true), color: isDirty ? '#fff' : theme.textSecondary, backgroundColor: isDirty ? theme.accent : 'transparent', opacity: isSaving ? 0.6 : 1 }}>Save</button>}
          {onCancel && <button type="button" onClick={onCancel} style={toolbarButtonStyle(false, false, true)}>Cancel</button>}
        </>
      ) : (
        <div
          style={{
            position: 'relative',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '2px',
            padding: '4px',
            borderRadius: '11px',
            backgroundColor: pillBackground,
            border: `1px solid ${pillBorder}`,
            boxShadow: theme.isDark
              ? '0 10px 28px -14px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.04)'
              : '0 10px 28px -16px rgba(0,0,0,0.24), inset 0 1px 0 rgba(255,255,255,0.65)',
            flexShrink: 0,
            // @ts-ignore - opt out of the drag region so the click lands.
            WebkitAppRegion: 'no-drag',
          }}
        >
          {visiblePinnedActions.length > 0 ? renderPinnedToolbarGroups() : (
            <span style={{ fontSize: '12px', color: toolbarIconMuted, padding: '0 8px', whiteSpace: 'nowrap' }}>No actions yet</span>
          )}
          {availableToolbarActions.length > 0 && (
            <>
              {visiblePinnedActions.length > 0 && toolbarDivider}
              <div ref={customizeMenuRef} style={{ position: 'relative', display: 'inline-flex' }}>
                <button type="button" onClick={() => setCustomizeMenuOpen((open) => !open)} title="Customize toolbar" aria-label="Customize toolbar" style={toolbarButtonStyle(customizeMenuOpen)}>
                  <svg width={ICON_SIZE_SMALL} height={ICON_SIZE_SMALL} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="3.5" cy="8" r="1.25" /><circle cx="8" cy="8" r="1.25" /><circle cx="12.5" cy="8" r="1.25" /></svg>
                </button>
                {customizeMenuOpen && (
                  <div style={{ position: 'absolute', top: 'calc(100% + 10px)', right: 0, zIndex: 30, width: '252px', maxHeight: 'min(940px, calc(100vh - 92px))', overflowY: 'auto', padding: '5px', borderRadius: '11px', border: `1px solid ${pillBorder}`, backgroundColor: theme.isDark ? '#161619' : '#fffaf2', boxShadow: theme.isDark ? '0 22px 48px -18px rgba(0,0,0,0.85)' : '0 18px 42px -20px rgba(0,0,0,0.28)', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px', padding: '6px 9px 7px', color: theme.textSecondary, fontSize: '10px', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
                      <span>Toolbar</span>
                      <span style={{ fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: '9px', letterSpacing: '0.04em', textTransform: 'none', opacity: 0.68 }}>+ / -</span>
                    </div>
                    {TOOLBAR_ACTION_GROUPS.map((group, groupIndex) => {
                      const actions = group.actions.filter(canUseToolbarAction);
                      if (!actions.length) return null;
                      return (
                        <div key={group.id}>
                          {groupIndex > 0 && <div style={{ height: '1px', backgroundColor: pillBorder, margin: '5px 4px' }} />}
                          <div style={{ padding: '4px 9px', color: theme.textSecondary, fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: '9px', letterSpacing: '0.14em', textTransform: 'uppercase', opacity: 0.72 }}>{group.label}</div>
                          {actions.map((id) => {
                            const pinned = pinnedActions.includes(id);
                            return (
                              <button key={id} type="button" onClick={() => togglePinnedAction(id)} aria-label={`${pinned ? 'Remove' : 'Add'} ${toolbarActionLabel(id)}`} title={pinned ? 'Remove from toolbar' : 'Add to toolbar'} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '10px', padding: '7px 9px', border: 'none', borderRadius: '7px', backgroundColor: 'transparent', color: pinned ? toolbarIconStrong : theme.textSecondary, cursor: 'pointer', textAlign: 'left', fontSize: '13px', fontFamily: 'inherit' }}>
                                <span style={{ width: '18px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{renderToolbarIcon(id)}</span>
                                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{toolbarActionLabel(id)}</span>
                                <span style={{ width: '18px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', opacity: 0.58 }}>{pinned ? '−' : '+'}</span>
                              </button>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
          {showDelete && onDelete && (
            <>
              {toolbarDivider}
              <button type="button" onClick={onDelete} title="Delete" aria-label="Delete" style={toolbarButtonStyle(false)}>
                <svg width={ICON_SIZE_SMALL} height={ICON_SIZE_SMALL} viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/><path fillRule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/></svg>
              </button>
            </>
          )}
        </div>
      )}

      {typographyMenuOpen && hasTypographyMenu && (
        <div ref={typographyMenuRef} style={{ position: 'absolute', top: '38px', right: '42px', zIndex: 30, width: '214px', padding: '7px', borderRadius: '11px', border: `1px solid ${pillBorder}`, backgroundColor: theme.isDark ? '#161619' : '#fffaf2', boxShadow: theme.isDark ? '0 22px 48px -18px rgba(0,0,0,0.85)' : '0 18px 42px -20px rgba(0,0,0,0.28)', display: 'flex', flexDirection: 'column', gap: '5px' }}>
          {typographyPresetOptions && typographyPresetOptions.length > 0 && onTypographyPresetChange && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '4px 5px' }}>
              <span style={{ width: '50px', flex: 'none', fontSize: '12px', color: theme.textSecondary }}>Font</span>
              <div style={{ display: 'inline-flex', gap: '2px', padding: '2px', borderRadius: '8px', border: `1px solid ${pillBorder}`, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)' }}>
                {typographyPresetOptions.map((option) => (
                  <button key={option.id} type="button" onClick={() => onTypographyPresetChange(option.id)} title={option.title} style={{ minWidth: '24px', padding: '3px 9px', border: 'none', borderRadius: '6px', backgroundColor: option.id === typographyPreset ? (theme.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)') : 'transparent', color: option.id === typographyPreset ? toolbarIconStrong : theme.textSecondary, cursor: 'pointer', fontSize: '12px', fontFamily: option.fontFamily }}>{option.label}</button>
                ))}
              </div>
            </div>
          )}
          {showTextSize && onTextSizeChange && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '4px 5px' }}>
              <span style={{ width: '50px', flex: 'none', fontSize: '12px', color: theme.textSecondary }}>Size</span>
              <div style={{ display: 'inline-flex', gap: '2px', padding: '2px', borderRadius: '8px', border: `1px solid ${pillBorder}`, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)' }}>
                {TEXT_SIZE_OPTIONS.map((option) => (
                  <button key={option.id} type="button" onClick={() => onTextSizeChange(option.id)} title={option.title} style={{ minWidth: '24px', padding: '3px 9px', border: 'none', borderRadius: '6px', backgroundColor: option.id === textSize ? (theme.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)') : 'transparent', color: option.id === textSize ? toolbarIconStrong : theme.textSecondary, cursor: 'pointer', fontSize: '12px' }}>{option.label}</button>
                ))}
              </div>
            </div>
          )}
          {lineHeightOptions && lineHeightOptions.length > 0 && onLineHeightChange && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '4px 5px' }}>
              <span style={{ width: '50px', flex: 'none', fontSize: '12px', color: theme.textSecondary }}>Lines</span>
              <div style={{ display: 'inline-flex', gap: '2px', padding: '2px', borderRadius: '8px', border: `1px solid ${pillBorder}`, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)' }}>
                {lineHeightOptions.map((option) => (
                  <button key={option.id} type="button" onClick={() => onLineHeightChange(option.id)} title={option.title} style={{ minWidth: '24px', padding: '3px 9px', border: 'none', borderRadius: '6px', backgroundColor: option.id === lineHeight ? (theme.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)') : 'transparent', color: option.id === lineHeight ? toolbarIconStrong : theme.textSecondary, cursor: 'pointer', fontSize: '12px' }}>{option.label}</button>
                ))}
              </div>
            </div>
          )}
          {onUnorderedListMarkerChange && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '4px 5px' }}>
              <span style={{ width: '50px', flex: 'none', fontSize: '12px', color: theme.textSecondary }}>Bullets</span>
              <div style={{ display: 'inline-flex', gap: '2px', padding: '2px', borderRadius: '8px', border: `1px solid ${pillBorder}`, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)' }}>
                {[{ id: 'dash' as const, label: '-', title: 'Dash unordered lists' }, { id: 'carrot' as const, label: '›', title: 'Carrot unordered lists' }].map((option) => (
                  <button key={option.id} type="button" onClick={() => onUnorderedListMarkerChange(option.id)} title={option.title} style={{ minWidth: '32px', padding: '3px 9px', border: 'none', borderRadius: '6px', backgroundColor: option.id === unorderedListMarker ? (theme.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)') : 'transparent', color: option.id === unorderedListMarker ? toolbarIconStrong : theme.textSecondary, cursor: 'pointer', fontSize: option.id === 'carrot' ? '15px' : '12px' }}>{option.label}</button>
                ))}
              </div>
            </div>
          )}
          {onTodoMarkerChange && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '4px 5px' }}>
              <span style={{ width: '50px', flex: 'none', fontSize: '12px', color: theme.textSecondary }}>Todos</span>
              <div style={{ display: 'inline-flex', gap: '2px', padding: '2px', borderRadius: '8px', border: `1px solid ${pillBorder}`, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)' }}>
                {[{ id: 'circle' as const, label: '○', title: 'Circle todo checkboxes' }, { id: 'square' as const, label: '□', title: 'Square todo checkboxes' }].map((option) => (
                  <button key={option.id} type="button" onClick={() => onTodoMarkerChange(option.id)} title={option.title} style={{ minWidth: '32px', padding: '3px 9px', border: 'none', borderRadius: '6px', backgroundColor: option.id === todoMarker ? (theme.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)') : 'transparent', color: option.id === todoMarker ? toolbarIconStrong : theme.textSecondary, cursor: 'pointer', fontSize: '15px' }}>{option.label}</button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );

}
