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

  // Main -> Renderer (send pattern)
  ITEM_ADDED: 'clipboard:itemAdded',
  ITEM_DELETED: 'clipboard:itemDeleted',
  DIALOG_POSITION: 'clipboard:dialogPosition',
  DIALOG_BOUNDS: 'clipboard:dialogBounds',
} as const;

/**
 * Clipboard item type.
 */
export type ClipboardItemType = 'text' | 'image' | 'transcript' | 'screenshot';

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
}

/**
 * Options for querying clipboard history.
 */
export interface ClipboardQueryOptions {
  type?: ClipboardItemType;
  search?: string;
  limit?: number;
  offset?: number;
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
}

