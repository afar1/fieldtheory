/**
 * IPC channels for clipboard functionality.
 */
export const ClipboardIPCChannels = {
  // Renderer -> Main (invoke/handle pattern)
  QUERY_ITEMS: 'clipboard:queryItems',
  GET_ITEM: 'clipboard:getItem',
  DELETE_ITEM: 'clipboard:deleteItem',
  CLEAR_ALL: 'clipboard:clearAll',
  CAPTURE_SCREENSHOT: 'clipboard:captureScreenshot',
  GET_HOTKEYS: 'clipboard:getHotkeys',
  SET_HOTKEYS: 'clipboard:setHotkeys',
  PASTE_ITEM: 'clipboard:pasteItem',
  PASTE_STACK: 'clipboard:pasteStack',
  SEPARATE_INTO_TASKS: 'clipboard:separateIntoTasks',
  SAVE_BOUNDS: 'clipboard:saveBounds',
  
  // Target app management.
  GET_TARGET_APP: 'clipboard:getTargetApp',
  SET_TARGET_APP: 'clipboard:setTargetApp',
  GET_RUNNING_APPS: 'clipboard:getRunningApps',
  PASTE_TO_APP: 'clipboard:pasteToApp',
  
  // Stack operations for prompt stacking feature
  QUERY_ITEMS_BY_STACK: 'clipboard:queryItemsByStack',
  GET_UNIQUE_STACKS: 'clipboard:getUniqueStacks',
  UPDATE_STACK_ID: 'clipboard:updateStackId',
  START_DRAG: 'clipboard:startDrag',

  // Mobile sync operations
  SET_SYNC_SESSION: 'clipboard:setSyncSession',
  CLEAR_SYNC_SESSION: 'clipboard:clearSyncSession',
  SYNC_MOBILE_TRANSCRIPTS: 'clipboard:syncMobileTranscripts',
  GET_SYNC_ENABLED: 'clipboard:getSyncEnabled',
  SET_SYNC_ENABLED: 'clipboard:setSyncEnabled',

  // Main -> Renderer (send pattern)
  ITEM_ADDED: 'clipboard:itemAdded',
  ITEM_DELETED: 'clipboard:itemDeleted',
  DIALOG_POSITION: 'clipboard:dialogPosition',
  DIALOG_BOUNDS: 'clipboard:dialogBounds',
  TARGET_APP_INFO: 'clipboard:targetAppInfo',
} as const;

/**
 * Represents a running application with its bundle ID and display name.
 */
export interface RunningApp {
  bundleId: string;
  name: string;
}

/**
 * Clipboard item type.
 */
export type ClipboardItemType = 'text' | 'image' | 'transcript' | 'screenshot';

/**
 * Source device for clipboard items.
 */
export type ClipboardSource = 'mac' | 'ios';

/**
 * Clipboard item (serialized for IPC).
 */
export interface ClipboardItem {
  id: number;
  type: ClipboardItemType;
  content: string | null;
  imageData: string | null; // base64 encoded
  imageWidth: number | null;
  imageHeight: number | null;
  imageSize: number | null;
  sourceApp: string | null;
  sourceAppName: string | null;
  wordCount: number | null;
  charCount: number | null;
  createdAt: number;
  contentHash: string;
  stackId: string | null; // Groups items into a prompt stack for batch paste
  source: ClipboardSource; // Device source: 'mac' for local, 'ios' for mobile synced
}

/**
 * Summary info for a stack of items.
 */
export interface StackInfo {
  stackId: string;
  itemCount: number;
  imageCount: number;
  textCount: number;
  createdAt: number;
  firstTextPreview: string | null;
}

/**
 * Options for querying clipboard history.
 */
export interface ClipboardQueryOptions {
  type?: ClipboardItemType;
  search?: string;
  limit?: number;
  offset?: number;
  source?: ClipboardSource; // Filter by device source: 'mac', 'ios', or undefined for all
}

/**
 * Hotkey configuration.
 */
export interface ClipboardHotkeys {
  screenshot?: string;
  history?: string;
}

/**
 * Clipboard API exposed to renderer.
 */
export interface ClipboardAPI {
  queryItems: (options?: ClipboardQueryOptions) => Promise<ClipboardItem[]>;
  getItem: (id: number) => Promise<ClipboardItem | null>;
  deleteItem: (id: number) => Promise<void>;
  clearAll: () => Promise<void>;
  captureScreenshot: (region?: boolean) => Promise<number>;
  getHotkeys: () => Promise<ClipboardHotkeys>;
  setHotkeys: (hotkeys: ClipboardHotkeys) => Promise<boolean>;
  pasteItem: (id: number) => Promise<void>;
  pasteStack: (ids: number[]) => Promise<void>;
  separateIntoTasks: (id: number) => Promise<void>;
  onItemAdded: (callback: (item: ClipboardItem) => void) => () => void;
  onItemDeleted: (callback: (id: number) => void) => () => void;
  
  // Stack operations for prompt stacking feature
  queryItemsByStackId: (stackId: string) => Promise<ClipboardItem[]>;
  getUniqueStacks: () => Promise<StackInfo[]>;
  updateStackId: (itemIds: number[], stackId: string | null) => Promise<void>;
  startDrag: (stackId: string) => Promise<void>;
}

