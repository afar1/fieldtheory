/**
 * ContentToolbar - Shared toolbar component for content views (Librarian, Commands).
 * Provides consistent UI for editing, sharing, and navigation controls.
 */

import { useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import ImmersiveToggle from './ImmersiveToggle';

// Icon sizes - 22% larger than the original 13px base
const ICON_SIZE = 16; // ~22% larger than 13px
const ICON_SIZE_SMALL = 13; // Standard size for less prominent icons

interface ContentToolbarProps {
  // Content info
  filePath?: string;
  title?: string;

  // View state
  isFullScreen?: boolean;
  onToggleFullScreen?: () => void;

  // Text size (for reading views)
  textSize?: 'small' | 'normal' | 'large';
  onTextSizeChange?: (size: 'small' | 'normal' | 'large') => void;
  showTextSize?: boolean;

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
  onShowInFolder?: () => void;
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

  onCopyPath?: () => void;

  // Fullscreen hover state (for immersive mode opacity)
  headerHovered?: boolean;
}

export default function ContentToolbar({
  filePath,
  isFullScreen = false,
  onToggleFullScreen,
  textSize,
  onTextSizeChange,
  showTextSize = false,
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
  onCopyPath,
  headerHovered = true,
}: ContentToolbarProps) {
  const { theme } = useTheme();
  const [copied, setCopied] = useState(false);
  const [rowHovered, setRowHovered] = useState(false);

  // Handle copy with feedback
  const handleCopy = () => {
    if (onCopy) {
      onCopy();
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Row background when hovered
  const rowBg = rowHovered ? (theme.isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)') : 'transparent';

  return (
    <div
      onMouseEnter={() => setRowHovered(true)}
      onMouseLeave={() => setRowHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '2px',
        flex: 1,
        opacity: isFullScreen && !headerHovered ? 0 : 1,
        transition: 'opacity 0.2s ease, background-color 0.15s ease',
        backgroundColor: rowBg,
        borderRadius: '6px',
        margin: '0 -4px',
        padding: '0 4px',
      }}
    >
      {/* Text size controls */}
      {showTextSize && onTextSizeChange && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <button
            onClick={() => onTextSizeChange('small')}
            style={{
              padding: '4px 6px',
              fontSize: '11px',
              color: textSize === 'small' ? theme.accent : theme.textSecondary,
              backgroundColor: 'transparent',
              border: 'none',
              cursor: 'pointer',
              fontWeight: textSize === 'small' ? 600 : 400,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '24px',
            }}
          >
            A
          </button>
          <button
            onClick={() => onTextSizeChange('normal')}
            style={{
              padding: '4px 6px',
              fontSize: '13px',
              color: textSize === 'normal' ? theme.accent : theme.textSecondary,
              backgroundColor: 'transparent',
              border: 'none',
              cursor: 'pointer',
              fontWeight: textSize === 'normal' ? 600 : 400,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '24px',
            }}
          >
            A
          </button>
          <button
            onClick={() => onTextSizeChange('large')}
            style={{
              padding: '4px 6px',
              fontSize: '15px',
              color: textSize === 'large' ? theme.accent : theme.textSecondary,
              backgroundColor: 'transparent',
              border: 'none',
              cursor: 'pointer',
              fontWeight: textSize === 'large' ? 600 : 400,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '24px',
            }}
          >
            A
          </button>
        </div>
      )}

      {/* Spacer to push remaining controls to the right - also serves as drag region */}
      <div
        style={{
          flex: 1,
          height: '24px',
          // @ts-ignore - webkit vendor prefix for Electron draggable region
          WebkitAppRegion: 'drag',
          cursor: 'grab',
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
            <button
              onClick={onShowInFolder}
              style={{
                padding: '4px 6px',
                color: theme.textSecondary,
                backgroundColor: 'transparent',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '24px',
              }}
              title="Show in Finder"
            >
              <svg width={ICON_SIZE_SMALL} height={ICON_SIZE_SMALL} viewBox="0 0 16 16" fill="currentColor">
                <path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h2.764c.958 0 1.76.56 2.311 1.184C7.985 3.648 8.48 4 9 4h4.5A1.5 1.5 0 0 1 15 5.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12.5v-9zM2.5 3a.5.5 0 0 0-.5.5V6h12v-.5a.5.5 0 0 0-.5-.5H9c-.964 0-1.71-.629-2.174-1.154C6.374 3.334 5.82 3 5.264 3H2.5zM14 7H2v5.5a.5.5 0 0 0 .5.5h11a.5.5 0 0 0 .5-.5V7z" />
              </svg>
            </button>
          )}
          {showRename && onRename && (
            <button
              onClick={onRename}
              style={{
                padding: '4px 6px',
                color: theme.textSecondary,
                backgroundColor: 'transparent',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '24px',
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
              style={{
                padding: '4px 6px',
                color: theme.textSecondary,
                backgroundColor: 'transparent',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '24px',
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

      {/* Share button */}
      {showShare && onToggleShare && !isEditing && (
        <button
          onClick={onToggleShare}
          disabled={isSharing}
          style={{
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
            height: '24px',
          }}
          title={shareStatus?.shared ? 'Remove from Shared' : 'Add to Shared'}
        >
          {isSharing ? 'Sharing...' : shareStatus?.shared ? 'Shared' : 'Share'}
        </button>
      )}

      {/* Edit controls. Save/Cancel only render when their callbacks are
          provided — LibrarianView dropped them in favor of auto-save, but
          CommandsView still uses the manual save model. */}
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
              {isSaving ? 'Saving...' : 'Save'}
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

      {/* Copy-path link icon — sits to the right of the immersive toggle. */}
      {onCopyPath && (
        <button
          onClick={onCopyPath}
          title="Copy file path (⌘C)"
          aria-label="Copy file path"
          style={{
            padding: '4px 6px',
            marginLeft: '2px',
            color: theme.textSecondary,
            backgroundColor: 'transparent',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '24px',
            borderRadius: '4px',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)')}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
        >
          <svg width={ICON_SIZE_SMALL} height={ICON_SIZE_SMALL} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6.5 9.5l3-3" />
            <path d="M7.5 4.5l1-1a3 3 0 0 1 4.2 4.2l-1 1" />
            <path d="M8.5 11.5l-1 1a3 3 0 0 1-4.2-4.2l1-1" />
          </svg>
        </button>
      )}
    </div>
  );
}
