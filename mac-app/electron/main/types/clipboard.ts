/**
 * IPC channels for clipboard functionality.
 */
export const ClipboardIPCChannels = {
  // Renderer -> Main (invoke/handle pattern)
  QUERY_ITEMS: 'clipboard:queryItems',
  GET_ITEM: 'clipboard:getItem',
  DELETE_ITEM: 'clipboard:deleteItem',
  RESTORE_ITEM: 'clipboard:restoreItem',
  CLEAR_ALL: 'clipboard:clearAll',
  CAPTURE_SCREENSHOT: 'clipboard:captureScreenshot',
  SAVE_SKETCH: 'clipboard:saveSketch',
  GET_HOTKEYS: 'clipboard:getHotkeys',
  SET_HOTKEYS: 'clipboard:setHotkeys',
  PASTE_ITEM: 'clipboard:pasteItem',
  COPY_ITEM: 'clipboard:copyItem',
  PASTE_STACK: 'clipboard:pasteStack',
  PASTE_TEXT: 'clipboard:pasteText',
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
  
// Engineer feature - refine prompts using AI
  ENGINEER_STACK: 'clipboard:engineerStack',
  
  // All-time stats for footer display
  GET_ALL_TIME_STATS: 'clipboard:getAllTimeStats',
  INCREMENT_IMPROVED_COUNT: 'clipboard:incrementImprovedCount',
  
  // API key management (stored securely via OS keychain)
  GET_API_KEY_STATUS: 'clipboard:getApiKeyStatus',
  SET_API_KEY: 'clipboard:setApiKey',
  CLEAR_API_KEY: 'clipboard:clearApiKey',
  
  // System prompt customization for Engineer feature
  GET_SYSTEM_PROMPT: 'clipboard:getSystemPrompt',
  SET_SYSTEM_PROMPT: 'clipboard:setSystemPrompt',
  RESET_SYSTEM_PROMPT: 'clipboard:resetSystemPrompt',
  GET_DEFAULT_SYSTEM_PROMPT: 'clipboard:getDefaultSystemPrompt',
  
  // Improved content management
  SAVE_IMPROVED_CONTENT: 'clipboard:saveImprovedContent',
  CLEAR_IMPROVED_CONTENT: 'clipboard:clearImprovedContent',
  SET_USE_IMPROVED_VERSION: 'clipboard:setUseImprovedVersion',
  
  // Continuous Context mode - allows multi-screenshot capture sessions
  GET_CONTINUOUS_CONTEXT_STATE: 'clipboard:getContinuousContextState',
  SET_CONTINUOUS_CONTEXT_ENABLED: 'clipboard:setContinuousContextEnabled',
  GET_CONTINUOUS_CONTEXT_ENABLED: 'clipboard:getContinuousContextEnabled',
  SET_CONTINUOUS_CONTEXT_HOTKEY: 'clipboard:setContinuousContextHotkey',
  GET_CONTINUOUS_CONTEXT_HOTKEY: 'clipboard:getContinuousContextHotkey',
  START_CONTINUOUS_CONTEXT: 'clipboard:startContinuousContext',
  STOP_CONTINUOUS_CONTEXT: 'clipboard:stopContinuousContext',
  CONTINUOUS_CONTEXT_CHANGED: 'clipboard:continuousContextChanged',

  // Permission banner settings
  GET_HIDE_SCREEN_RECORDING_BANNER: 'clipboard:getHideScreenRecordingBanner',
  SET_HIDE_SCREEN_RECORDING_BANNER: 'clipboard:setHideScreenRecordingBanner',

  // Cursor status indicator settings
  GET_CURSOR_STATUS_ENABLED: 'clipboard:getCursorStatusEnabled',
  SET_CURSOR_STATUS_ENABLED: 'clipboard:setCursorStatusEnabled',

  // Mobile sync operations
  SET_SYNC_SESSION: 'clipboard:setSyncSession',
  CLEAR_SYNC_SESSION: 'clipboard:clearSyncSession',
  SYNC_MOBILE_TRANSCRIPTS: 'clipboard:syncMobileTranscripts',
  FORCE_SYNC_ALL: 'clipboard:forceSyncAll',
  GET_SYNC_ENABLED: 'clipboard:getSyncEnabled',
  SET_SYNC_ENABLED: 'clipboard:setSyncEnabled',

  // Main -> Renderer (send pattern)
  ITEM_ADDED: 'clipboard:itemAdded',
  ITEM_DELETED: 'clipboard:itemDeleted',
  DIALOG_POSITION: 'clipboard:dialogPosition',
  DIALOG_BOUNDS: 'clipboard:dialogBounds',
  TARGET_APP_INFO: 'clipboard:targetAppInfo',
  RECORDING_STATE: 'clipboard:recordingState', // Broadcasts recording state to clipboard history
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
  improvedContent: string | null; // Improved version from Engineer feature
  useImprovedVersion: boolean; // Toggle between improved and original text
  imageData: string | null; // base64 encoded
  thumbnailData: string | null; // Small preview image (~10KB) for list view
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
  figureLabel: string | null; // Figure label for screenshots in stacks (e.g., "A", "B", "C")
  figureId: string | null; // Unique 5-char alphanumeric ID for searchability (e.g., "k7xm2")
  needsLazyLoad?: boolean; // PERF: True if imageData was excluded from query (>100KB), fetch via getItem()
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
 * Result from the engineer prompt operation.
 */
export interface EngineerResult {
  success: boolean;
  refinedPrompt?: string;
  error?: string;
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
  fullScreen?: string;
  activeWindow?: string;
  history?: string;
  continuousContext?: string;
}

/**
 * Continuous Context mode state.
 */
export interface ContinuousContextState {
  active: boolean;
  stackId: string | null;
  screenshotCount: number;
}

// =============================================================================
// Shared Clipboard Types - Shared clipboard items for collaboration.
// =============================================================================

/**
 * Shared clipboard item stored in Supabase.
 * Similar to ClipboardItem but with shared-specific fields.
 */
export interface SharedClipboardItem {
  id: string; // UUID from Supabase.
  userId: string; // Who shared this item.
  sharedByEmail: string | null; // Display name of who shared it.
  type: ClipboardItemType;
  content: string | null;
  imageData: string | null; // base64 encoded for IPC.
  imageWidth: number | null;
  imageHeight: number | null;
  imageSize: number | null;
  improvedContent: string | null;
  stackId: string | null;
  sourceApp: string | null;
  sourceAppName: string | null;
  wordCount: number | null;
  charCount: number | null;
  clientId: string; // For deduplication.
  clientCreatedAtMs: number; // Original creation timestamp.
  createdAt: number; // When shared to team.
  updatedAt: number;
}

/**
 * Summary info for a shared stack.
 */
export interface SharedStackInfo {
  stackId: string;
  name: string | null;
  itemCount: number;
  imageCount: number;
  textCount: number;
  createdByEmail: string | null;
  createdAt: number;
  firstTextPreview: string | null;
}

/**
 * Options for querying shared clipboard.
 */
export interface SharedClipboardQueryOptions {
  type?: ClipboardItemType;
  search?: string;
  limit?: number;
  offset?: number;
  stackId?: string; // Filter to items in a specific stack.
}

/**
 * IPC channels for shared clipboard functionality.
 */
export const SharedClipboardIPCChannels = {
  // Query team items.
  QUERY_TEAM_ITEMS: 'teamClipboard:queryItems',
  GET_TEAM_ITEM: 'teamClipboard:getItem',
  
  // Share to team.
  SHARE_TO_TEAM: 'teamClipboard:shareItem',
  SHARE_STACK_TO_TEAM: 'teamClipboard:shareStack',
  
  // Modify team items (collaborative).
  DELETE_TEAM_ITEM: 'teamClipboard:deleteItem',
  UPDATE_TEAM_STACK_ID: 'teamClipboard:updateStackId',
  
  // Copy to personal clipboard.
  COPY_TO_PERSONAL: 'teamClipboard:copyToPersonal',
  COPY_STACK_TO_PERSONAL: 'teamClipboard:copyStackToPersonal',
  
  // Stack operations.
  GET_TEAM_STACKS: 'teamClipboard:getStacks',
  CREATE_TEAM_STACK: 'teamClipboard:createStack',
  
  // Real-time events (future).
  TEAM_ITEM_ADDED: 'teamClipboard:itemAdded',
  TEAM_ITEM_DELETED: 'teamClipboard:itemDeleted',
  TEAM_ITEM_UPDATED: 'teamClipboard:itemUpdated',
  
  // Team membership.
  GET_TEAM_MEMBERS: 'teamClipboard:getTeamMembers',
  ADD_TEAM_MEMBER: 'teamClipboard:addTeamMember',
  REMOVE_TEAM_MEMBER: 'teamClipboard:removeTeamMember',
  HAS_TEAMMATES: 'teamClipboard:hasTeammates',
} as const;

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
  copyItem: (id: number) => Promise<void>;
  pasteStack: (ids: number[], targetBundleId?: string) => Promise<void>;
  separateIntoTasks: (id: number) => Promise<void>;
  onItemAdded: (callback: (item: ClipboardItem) => void) => () => void;
  onItemDeleted: (callback: (id: number) => void) => () => void;
  
  // Stack operations for prompt stacking feature
  queryItemsByStackId: (stackId: string) => Promise<ClipboardItem[]>;
  getUniqueStacks: () => Promise<StackInfo[]>;
  updateStackId: (itemIds: number[], stackId: string | null) => Promise<void>;
  startDrag: (stackId: string) => Promise<void>;
  
  // Engineer feature - refine prompts using AI
  engineerStack: (stackId: string) => Promise<EngineerResult>;
}

