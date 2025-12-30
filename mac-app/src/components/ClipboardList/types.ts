/**
 * ClipboardList Types
 * 
 * Unified types for the ClipboardList component that work with both
 * local (clipboardAPI) and shared (sharedClipboardAPI) data sources.
 * 
 * Uses generics to preserve the original ID type (number for local, string for shared)
 * while sharing the core rendering logic.
 */

// The item types supported by both local and shared clipboard.
export type ClipboardItemType = 'text' | 'image' | 'transcript' | 'screenshot';

/**
 * Base item interface that both local and shared items conform to.
 * The ID type is generic to preserve type safety when calling back to APIs.
 */
export interface BaseClipboardItem<ID extends string | number = string | number> {
  id: ID;
  type: ClipboardItemType;
  content: string | null;
  improvedContent: string | null;
  imageData: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  imageSize: number | null;
  stackId: string | null;
  sourceApp: string | null;
  sourceAppName: string | null;
  createdAt: number;
  
  // Optional fields that only exist on one source.
  // Local-only:
  contentHash?: string;
  source?: 'mac' | 'ios';
  // Shared-only:
  imageUrl?: string | null;
  sharedByEmail?: string | null;
  userId?: string;
}

/**
 * Stack info for display in the list.
 * Used by both local and shared views.
 */
export interface StackInfo {
  stackId: string;
  itemCount: number;
  imageCount: number;
  textCount: number;
  createdAt: number;
  firstTextPreview: string | null;
  // Shared-only:
  name?: string | null;
  createdByEmail?: string | null;
}

/**
 * A row in the list can be either a single item or a grouped stack.
 * Generic over the item type to preserve ID typing.
 */
export type ListRow<T extends BaseClipboardItem = BaseClipboardItem> =
  | { type: 'item'; item: T }
  | { type: 'stack'; stack: StackInfo; items: T[]; expanded: boolean };

/**
 * Undo action types for local clipboard.
 * Shared clipboard doesn't support undo (items are in the cloud).
 */
export type UndoAction<ID extends string | number = number> =
  | { type: 'delete'; items: BaseClipboardItem<ID>[] }
  | { type: 'stack'; itemIds: ID[]; previousStackIds: (string | null)[]; newStackId: string }
  | { type: 'unstack'; itemIds: ID[]; previousStackId: string };

/**
 * Preview content for the spacebar preview modal.
 */
export type PreviewContent =
  | { type: 'image'; data: string; url?: string; width: number; height: number }
  | { type: 'text'; content: string };

/**
 * Data source identifier.
 * Used to conditionally render source-specific UI elements.
 */
export type DataSource = 'local' | 'shared';
