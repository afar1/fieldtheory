/**
 * Shared types for clipboard history components.
 */

export type ViewMode = 'clipboard' | 'todo' | 'feedback' | 'commands' | 'sketch' | 'librarian';

export type ClipboardItemType = 'text' | 'image' | 'transcript' | 'screenshot';
export type ClipboardSource = 'mac' | 'ios';

export type ClipboardItem = {
  id: number;
  type: ClipboardItemType;
  content: string | null;
  improvedContent: string | null;
  useImprovedVersion: boolean;
  imageData: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  imageSize: number | null;
  sourceApp: string | null;
  sourceAppName: string | null;
  wordCount: number | null;
  charCount: number | null;
  createdAt: number;
  contentHash: string;
  stackId: string | null;
  source: ClipboardSource;
  figureLabel: string | null;
  figureId: string | null;
  thumbnailData?: string | null;
  needsLazyLoad?: boolean;
};

export type StackInfo = {
  stackId: string;
  itemCount: number;
  imageCount: number;
  textCount: number;
  createdAt: number;
  firstTextPreview: string | null;
};

export type ListRow =
  | { type: 'item'; item: ClipboardItem }
  | { type: 'stack'; stack: StackInfo; items: ClipboardItem[]; expanded: boolean };

export type UndoAction =
  | { type: 'delete'; items: ClipboardItem[] }
  | { type: 'stack'; itemIds: number[]; previousStackIds: (string | null)[]; newStackId: string }
  | { type: 'unstack'; itemIds: number[]; previousStackId: string };

export type FilterType = 'all' | 'transcript' | 'screenshot';
export type SourceFilterType = 'all' | 'mac' | 'ios';

export type ClipboardQueryOptions = {
  type?: ClipboardItemType;
  search?: string;
  limit?: number;
  offset?: number;
  source?: ClipboardSource;
};

export type RunningApp = {
  bundleId: string;
  name: string;
};

export const TAB_LABELS: Record<ViewMode, string> = {
  clipboard: 'Clipboard',
  librarian: 'Librarian',
  todo: 'Tasks',
  feedback: 'Feedback',
  commands: 'Commands',
  sketch: 'Sketch',
};

/** The left-group top-nav tabs that Tab / Shift+Tab cycles between. */
export function nextTopNavViewMode(
  prev: ViewMode,
  direction: 1 | -1,
  _librarianEnabled: boolean,
): ViewMode {
  const tabs: ViewMode[] = ['clipboard', 'librarian', 'commands'];
  const idx = tabs.indexOf(prev);
  const nextIdx = idx === -1 ? 0 : (idx + direction + tabs.length) % tabs.length;
  return tabs[nextIdx];
}

export function shouldCycleTopNavWithTab(activeTagName?: string | null): boolean {
  return !activeTagName?.match(/^(INPUT|TEXTAREA)$/i);
}

export const MAX_UNDO = 20;
