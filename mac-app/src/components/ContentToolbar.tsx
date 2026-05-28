/**
 * ContentToolbar - Shared toolbar component for content views (Librarian, Commands).
 * Provides consistent UI for editing, sharing, and navigation controls.
 */

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import ImmersiveToggle from './ImmersiveToggle';
import { SidebarMarkdownIcon, SidebarRiverIcon } from './SidebarIcons';

// Icon sizes - 22% larger than the original 13px base
const ICON_SIZE = 16; // ~22% larger than 13px
const ICON_SIZE_SMALL = 13; // Standard size for less prominent icons
const COPY_PATH_FEEDBACK_MS = 1600;
const FIELD_THEORY_ICON_URL = `${import.meta.env.BASE_URL}field-theory-icon-black.png`;

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
}: ContentToolbarProps) {
  const { theme } = useTheme();
  const [copied, setCopied] = useState(false);
  const [copyPathLocalCopied, setCopyPathLocalCopied] = useState(false);
  const [copyPathHovered, setCopyPathHovered] = useState(false);
  const [typographyMenuOpen, setTypographyMenuOpen] = useState(false);
  const typographyMenuRef = useRef<HTMLDivElement | null>(null);
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
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '1px',
            marginRight: '6px',
          }}
        >
          <button
            type="button"
            onClick={onNavigateBack}
            disabled={!canNavigateBack}
            title="Back"
            aria-label="Back"
            style={{
              width: '24px',
              height: '24px',
              padding: 0,
              color: theme.textSecondary,
              backgroundColor: 'transparent',
              border: 'none',
              borderRadius: '4px',
              cursor: canNavigateBack ? 'pointer' : 'default',
              opacity: canNavigateBack ? 1 : 0.32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg width={ICON_SIZE_SMALL} height={ICON_SIZE_SMALL} viewBox="0 0 16 16" fill="currentColor">
              <path d="M10.354 3.146a.5.5 0 0 1 0 .708L6.207 8l4.147 4.146a.5.5 0 0 1-.708.708l-4.5-4.5a.5.5 0 0 1 0-.708l4.5-4.5a.5.5 0 0 1 .708 0z" />
            </svg>
          </button>
          <button
            type="button"
            onClick={onNavigateForward}
            disabled={!canNavigateForward}
            title="Forward"
            aria-label="Forward"
            style={{
              width: '24px',
              height: '24px',
              padding: 0,
              color: theme.textSecondary,
              backgroundColor: 'transparent',
              border: 'none',
              borderRadius: '4px',
              cursor: canNavigateForward ? 'pointer' : 'default',
              opacity: canNavigateForward ? 1 : 0.32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg width={ICON_SIZE_SMALL} height={ICON_SIZE_SMALL} viewBox="0 0 16 16" fill="currentColor">
              <path d="M5.646 3.146a.5.5 0 0 0 0 .708L9.793 8l-4.147 4.146a.5.5 0 0 0 .708.708l4.5-4.5a.5.5 0 0 0 0-.708l-4.5-4.5a.5.5 0 0 0-.708 0z" />
            </svg>
          </button>
        </div>
      )}

      {/* Spacer to push remaining controls to the right - also serves as drag region */}
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

      {/* Icon buttons group (folder, rename, delete) */}
      {(showFolder || showRename || showDelete) && !isEditing && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
          }}
        >
          {showFolder && onShowInFolder && (
            <ContentToolbarFolderButton onShowInFolder={onShowInFolder} />
          )}
          {showRename && onRename && (
            <button
              onClick={onRename}
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
              }}
              title="Rename"
            >
              <svg width={ICON_SIZE_SMALL} height={ICON_SIZE_SMALL} viewBox="0 0 16 16" fill="currentColor">
                <path d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168l10-10zM11.207 2.5 13.5 4.793 14.793 3.5 12.5 1.207 11.207 2.5zm1.586 3L10.5 3.207 4 9.707V10h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.293l6.5-6.5zm-9.761 5.175-.106.106-1.528 3.821 3.821-1.528.106-.106A.5.5 0 0 1 5 12.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.468-.325z"/>
              </svg>
            </button>
          )}
          {showDelete && onDelete && (
            <button
              onClick={onDelete}
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
              }}
              title="Delete"
            >
              <svg width={ICON_SIZE_SMALL} height={ICON_SIZE_SMALL} viewBox="0 0 16 16" fill="currentColor">
                <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/>
                <path fillRule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/>
              </svg>
            </button>
          )}
        </div>
      )}

      {/* Generic copy action — distinct from the file-path/link icon at the far right. */}
      {showCopy && onCopy && (
        <button
          type="button"
          onClick={handleCopy}
          title={copyLabel ?? 'Copy'}
          aria-label={copyLabel ?? 'Copy'}
          style={{
            padding: '3px 8px',
            fontSize: '11px',
            color: copied ? (theme.success ?? '#16a34a') : theme.textSecondary,
            backgroundColor: copied
              ? (theme.isDark ? 'rgba(34,197,94,0.16)' : 'rgba(22,163,74,0.12)')
              : 'transparent',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '24px',
          }}
          onMouseEnter={(e) => {
            if (!copied) e.currentTarget.style.backgroundColor = theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)';
          }}
          onMouseLeave={(e) => {
            if (!copied) e.currentTarget.style.backgroundColor = 'transparent';
          }}
        >
          {copied ? 'Copied' : (copyLabel ?? 'Copy')}
        </button>
      )}

      {/* Share button */}
      {showShare && onToggleShare && !isEditing && (
        <button
          onClick={onToggleShare}
          disabled={isSharing}
          style={{
            padding: '3px 6px',
            fontSize: '11px',
            color: riverShareColor,
            backgroundColor: riverShareActive
              ? (theme.isDark ? 'rgba(37,99,235,0.20)' : 'rgba(37,99,235,0.12)')
              : 'transparent',
            border: `1px solid ${riverShareActive
              ? (theme.isDark ? 'rgba(96,165,250,0.36)' : 'rgba(37,99,235,0.28)')
              : 'transparent'}`,
            borderRadius: '4px',
            cursor: isSharing ? 'default' : 'pointer',
            opacity: isSharing ? 0.6 : 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '24px',
            minWidth: '24px',
          }}
          title={shareStatus?.shared ? sharedTitle : shareTitle}
          aria-label={shareStatus?.shared ? sharedTitle : shareTitle}
        >
          <SidebarRiverIcon
            color={riverShareColor}
            style={{ opacity: isSharing ? 0.35 : riverShareActive ? 1 : 0.48 }}
          />
        </button>
      )}

      {/* Optional edit controls for callers that use a manual save model. */}
      {isEditing ? (
        <>
          {isDirty && (
            <span
              style={{
                width: '5px',
                height: '5px',
                borderRadius: '50%',
                backgroundColor: theme.accent,
                marginRight: '4px',
              }}
              title="Unsaved changes"
            />
          )}
          {onSave && (
            <button
              onClick={onSave}
              disabled={!isDirty || isSaving}
              style={{
                padding: '3px 8px',
                fontSize: '11px',
                color: isDirty ? '#fff' : theme.textSecondary,
                backgroundColor: isDirty ? theme.accent : 'transparent',
                border: 'none',
                borderRadius: '4px',
                cursor: isDirty ? 'pointer' : 'default',
                opacity: isSaving ? 0.6 : 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '24px',
              }}
            >
              Save
            </button>
          )}
          {onCancel && (
            <button
              onClick={onCancel}
              style={{
                padding: '3px 8px',
                fontSize: '11px',
                color: theme.textSecondary,
                backgroundColor: 'transparent',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '24px',
              }}
            >
              Cancel
            </button>
          )}
        </>
      ) : onEdit && (
        <button
          onClick={onEdit}
          style={{
            padding: '3px 8px',
            fontSize: '11px',
            color: theme.textSecondary,
            backgroundColor: 'transparent',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '24px',
          }}
          title="Edit (⌘E)"
        >
          Edit
        </button>
      )}

      {/* Immersive toggle — standardized top-right position across views. */}
      {onToggleFullScreen && (
        <ImmersiveToggle isFullScreen={isFullScreen} onToggle={onToggleFullScreen} />
      )}

      {hasTypographyMenu && (
        <div
          ref={typographyMenuRef}
          style={{
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            marginLeft: '2px',
          }}
        >
          <button
            type="button"
            onClick={() => setTypographyMenuOpen((open) => !open)}
            onMouseEnter={(event) => {
              if (!typographyMenuOpen) {
                event.currentTarget.style.backgroundColor = iconHoverBackground;
              }
            }}
            onMouseLeave={(event) => {
              if (!typographyMenuOpen) {
                event.currentTarget.style.backgroundColor = 'transparent';
              }
            }}
            title="Text style"
            aria-label="Text style"
            style={{
              width: '24px',
              height: '24px',
              padding: 0,
              color: typographyMenuOpen ? (theme.isDark ? '#fff' : '#000') : theme.textSecondary,
              backgroundColor: typographyMenuOpen
                ? iconActiveBackground
                : 'transparent',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '13px',
              fontWeight: 600,
              lineHeight: 1,
              transition: 'background-color 0.15s ease, color 0.15s ease',
            }}
          >
            A
          </button>

          {typographyMenuOpen && (
            <div
              style={{
                position: 'absolute',
                top: '28px',
                right: 0,
                zIndex: 20,
                width: '214px',
                padding: '8px',
                borderRadius: '8px',
                border: `1px solid ${theme.border}`,
                backgroundColor: theme.isDark ? 'rgba(24,24,24,0.96)' : 'rgba(255,255,255,0.98)',
                boxShadow: theme.isDark ? '0 12px 30px rgba(0,0,0,0.32)' : '0 12px 30px rgba(0,0,0,0.14)',
                backdropFilter: 'blur(14px)',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              {typographyPresetOptions && typographyPresetOptions.length > 0 && onTypographyPresetChange && (
                <div>
                  <div style={{ fontSize: '10px', color: theme.textSecondary, marginBottom: '5px' }}>
                    Font
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px' }}>
                    {typographyPresetOptions.map((option) => {
                      const isSelected = option.id === typographyPreset;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => onTypographyPresetChange(option.id)}
                          title={option.title}
                          style={{
                            height: '26px',
                            padding: '0 6px',
                            color: isSelected ? (theme.isDark ? '#fff' : '#000') : theme.textSecondary,
                            backgroundColor: isSelected
                              ? (theme.isDark ? 'rgba(255,255,255,0.13)' : 'rgba(0,0,0,0.08)')
                              : 'transparent',
                            border: 'none',
                            borderRadius: '5px',
                            cursor: 'pointer',
                            fontSize: '11px',
                            fontFamily: option.fontFamily,
                            fontWeight: isSelected ? 600 : 400,
                            lineHeight: 1,
                          }}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {showTextSize && onTextSizeChange && (
                <div>
                  <div style={{ fontSize: '10px', color: theme.textSecondary, marginBottom: '5px' }}>
                    Size
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px' }}>
                    {TEXT_SIZE_OPTIONS.map((option) => {
                      const isSelected = option.id === textSize;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => onTextSizeChange(option.id)}
                          title={option.title}
                          style={{
                            height: '26px',
                            padding: '0 6px',
                            color: isSelected ? (theme.isDark ? '#fff' : '#000') : theme.textSecondary,
                            backgroundColor: isSelected
                              ? (theme.isDark ? 'rgba(255,255,255,0.13)' : 'rgba(0,0,0,0.08)')
                              : 'transparent',
                            border: 'none',
                            borderRadius: '5px',
                            cursor: 'pointer',
                            fontSize: option.id === 'small' ? '10px' : option.id === 'large' ? '13px' : '11px',
                            fontWeight: isSelected ? 600 : 400,
                            lineHeight: 1,
                          }}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {lineHeightOptions && lineHeightOptions.length > 0 && onLineHeightChange && (
                <div>
                  <div style={{ fontSize: '10px', color: theme.textSecondary, marginBottom: '5px' }}>
                    Lines
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px' }}>
                    {lineHeightOptions.map((option) => {
                      const isSelected = option.id === lineHeight;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => onLineHeightChange(option.id)}
                          title={option.title}
                          style={{
                            height: '26px',
                            padding: '0 6px',
                            color: isSelected ? (theme.isDark ? '#fff' : '#000') : theme.textSecondary,
                            backgroundColor: isSelected
                              ? (theme.isDark ? 'rgba(255,255,255,0.13)' : 'rgba(0,0,0,0.08)')
                              : 'transparent',
                            border: 'none',
                            borderRadius: '5px',
                            cursor: 'pointer',
                            fontSize: '11px',
                            fontWeight: isSelected ? 600 : 400,
                            lineHeight: 1,
                          }}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {onUnorderedListMarkerChange && (
                <div>
                  <div style={{ fontSize: '10px', color: theme.textSecondary, marginBottom: '5px' }}>
                    Bullets
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '4px' }}>
                    {[
                      { id: 'dash' as const, label: '-', title: 'Dash unordered lists' },
                      { id: 'carrot' as const, label: '›', title: 'Carrot unordered lists' },
                    ].map((option) => {
                      const isSelected = option.id === unorderedListMarker;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => onUnorderedListMarkerChange(option.id)}
                          title={option.title}
                          style={{
                            height: '26px',
                            padding: '0 6px',
                            color: isSelected ? (theme.isDark ? '#fff' : '#000') : theme.textSecondary,
                            backgroundColor: isSelected
                              ? (theme.isDark ? 'rgba(255,255,255,0.13)' : 'rgba(0,0,0,0.08)')
                              : 'transparent',
                            border: 'none',
                            borderRadius: '5px',
                            cursor: 'pointer',
                            fontSize: option.id === 'carrot' ? '15px' : '12px',
                            fontWeight: isSelected ? 700 : 500,
                            lineHeight: 1,
                          }}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {onTodoMarkerChange && (
                <div>
                  <div style={{ fontSize: '10px', color: theme.textSecondary, marginBottom: '5px' }}>
                    Todos
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '4px' }}>
                    {[
                      { id: 'circle' as const, label: '○', title: 'Circle todo checkboxes' },
                      { id: 'square' as const, label: '□', title: 'Square todo checkboxes' },
                    ].map((option) => {
                      const isSelected = option.id === todoMarker;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => onTodoMarkerChange(option.id)}
                          title={option.title}
                          style={{
                            height: '26px',
                            padding: '0 6px',
                            color: isSelected ? (theme.isDark ? '#fff' : '#000') : theme.textSecondary,
                            backgroundColor: isSelected
                              ? (theme.isDark ? 'rgba(255,255,255,0.13)' : 'rgba(0,0,0,0.08)')
                              : 'transparent',
                            border: 'none',
                            borderRadius: '5px',
                            cursor: 'pointer',
                            fontSize: '15px',
                            fontWeight: isSelected ? 700 : 500,
                            lineHeight: 1,
                          }}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

            </div>
          )}
        </div>
      )}

      {/* Copy-path link icon — visually follows the text-style button. */}
      {onCopyPath && (
        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={handleCopyPath}
          title={copyPathActive ? 'Copied' : copyPathTitle}
          aria-label={copyPathActive ? 'Copied' : copyPathTitle}
          style={{
            padding: '4px 6px',
            marginLeft: '2px',
            color: copyPathActive ? (theme.success ?? '#16a34a') : theme.textSecondary,
            backgroundColor: copyPathActive
              ? (theme.isDark ? 'rgba(34,197,94,0.16)' : 'rgba(22,163,74,0.12)')
              : copyPathHovered
              ? iconHoverBackground
              : 'transparent',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '24px',
            borderRadius: '4px',
            transition: 'background-color 0.15s ease, color 0.15s ease',
          }}
          onMouseEnter={() => setCopyPathHovered(true)}
          onMouseLeave={() => setCopyPathHovered(false)}
        >
          <svg width={ICON_SIZE_SMALL} height={ICON_SIZE_SMALL} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            {copyPathActive ? (
              <path d="M3.5 8.3l2.8 2.8 6.2-6.2" />
            ) : (
              <>
                <path d="M6.5 9.5l3-3" />
                <path d="M7.5 4.5l1-1a3 3 0 0 1 4.2 4.2l-1 1" />
                <path d="M8.5 11.5l-1 1a3 3 0 0 1-4.2-4.2l1-1" />
              </>
            )}
          </svg>
        </button>
      )}
    </div>
  );
}
