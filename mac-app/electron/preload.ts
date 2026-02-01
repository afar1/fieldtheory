import { contextBridge, ipcRenderer } from 'electron';

// Define IPC channels locally to avoid import issues

// Generic hotkey management channels
const HotkeyIPCChannels = {
  GET_HOTKEY: 'hotkey:get',
  SET_HOTKEY: 'hotkey:set',
  GET_ALL_HOTKEYS: 'hotkey:getAll',
} as const;

const AudioIPCChannels = {
  GET_STATE: 'audio:getState',
  SET_PRIORITY_MODE: 'audio:setPriorityMode',
  SET_PRIORITY_DEVICE: 'audio:setPriorityDevice',
  RESET_OVERRIDE: 'audio:resetOverride',
  STATE_CHANGED: 'audio:stateChanged',
} as const;

const TranscribeIPCChannels = {
  GET_STATUS: 'transcribe:getStatus',
  GET_MODEL_STATUS: 'transcribe:getModelStatus',
  DOWNLOAD_MODEL: 'transcribe:downloadModel',
  DELETE_MODEL: 'transcribe:deleteModel',
  GET_AVAILABLE_MODELS: 'transcribe:getAvailableModels',
  GET_MODEL_DOWNLOAD_STATUS: 'transcribe:getModelDownloadStatus',
  GET_DOWNLOADING_MODELS: 'transcribe:getDownloadingModels',
  GET_SELECTED_MODEL: 'transcribe:getSelectedModel',
  SET_SELECTED_MODEL: 'transcribe:setSelectedModel',
  GET_HOTKEY: 'transcribe:getHotkey',
  SET_HOTKEY: 'transcribe:setHotkey',
  GET_SECONDARY_HOTKEY: 'transcribe:getSecondaryHotkey',
  SET_SECONDARY_HOTKEY: 'transcribe:setSecondaryHotkey',
  GET_OVERLAY_STYLE: 'transcribe:getOverlayStyle',
  SET_OVERLAY_STYLE: 'transcribe:setOverlayStyle',
  GET_ABANDON_HOTKEY: 'transcribe:getAbandonHotkey',
  SET_ABANDON_HOTKEY: 'transcribe:setAbandonHotkey',
  GET_ABANDON_CONFIRMATION: 'transcribe:getAbandonConfirmation',
  SET_ABANDON_CONFIRMATION: 'transcribe:setAbandonConfirmation',
  GET_AUTO_IMPROVE: 'transcribe:getAutoImprove',
  SET_AUTO_IMPROVE: 'transcribe:setAutoImprove',
  GET_AUTO_IMPROVE_MIN_WORDS: 'transcribe:getAutoImproveMinWords',
  SET_AUTO_IMPROVE_MIN_WORDS: 'transcribe:setAutoImproveMinWords',
  GET_AUTO_IMPROVE_STATS: 'transcribe:getAutoImproveStats',
  RESET_AUTO_IMPROVE_STATS: 'transcribe:resetAutoImproveStats',
  TOGGLE_RECORDING: 'transcribe:toggleRecording',
  GET_SOUND_CONFIG: 'transcribe:getSoundConfig',
  SET_SOUND_CONFIG: 'transcribe:setSoundConfig',
  GET_AVAILABLE_SOUNDS: 'transcribe:getAvailableSounds',
  PREVIEW_SOUND: 'transcribe:previewSound',
  STATUS_CHANGED: 'transcribe:statusChanged',
  RESULT: 'transcribe:result',
  ERROR: 'transcribe:error',
  MODEL_DOWNLOAD_PROGRESS: 'transcribe:modelDownloadProgress',
  HOTKEY_CHANGED: 'transcribe:hotkeyChanged',
  ADD_TO_STACK: 'transcribe:addToStack',
} as const;

const ClipboardIPCChannels = {
  QUERY_ITEMS: 'clipboard:queryItems',
  GET_ITEM: 'clipboard:getItem',
  DELETE_ITEM: 'clipboard:deleteItem',
  RESTORE_ITEM: 'clipboard:restoreItem',
  CLEAR_ALL: 'clipboard:clearAll',
  CAPTURE_SCREENSHOT: 'clipboard:captureScreenshot',
  GET_HOTKEYS: 'clipboard:getHotkeys',
  SET_HOTKEYS: 'clipboard:setHotkeys',
  PASTE_ITEM: 'clipboard:pasteItem',
  COPY_ITEM: 'clipboard:copyItem',
  PASTE_STACK: 'clipboard:pasteStack',
  PASTE_TEXT: 'clipboard:pasteText',
  SEPARATE_INTO_TASKS: 'clipboard:separateIntoTasks',
  SAVE_BOUNDS: 'clipboard:saveBounds',
  GET_TARGET_APP: 'clipboard:getTargetApp',
  SET_TARGET_APP: 'clipboard:setTargetApp',
  GET_RUNNING_APPS: 'clipboard:getRunningApps',
  PASTE_TO_APP: 'clipboard:pasteToApp',
  ITEM_ADDED: 'clipboard:itemAdded',
  ITEM_DELETED: 'clipboard:itemDeleted',
  DIALOG_POSITION: 'clipboard:dialogPosition',
  DIALOG_BOUNDS: 'clipboard:dialogBounds',
  TARGET_APP_INFO: 'clipboard:targetAppInfo',

  // Local LLM model management
  GET_LOCAL_LLM_MODELS: 'clipboard:getLocalLLMModels',
  GET_LOCAL_LLM_STATUS: 'clipboard:getLocalLLMStatus',
  GET_LOCAL_LLM_SELECTED: 'clipboard:getLocalLLMSelected',
  SET_LOCAL_LLM_SELECTED: 'clipboard:setLocalLLMSelected',
  DOWNLOAD_LOCAL_LLM: 'clipboard:downloadLocalLLM',
  DELETE_LOCAL_LLM: 'clipboard:deleteLocalLLM',
  GET_USE_LOCAL_LLM: 'clipboard:getUseLocalLLM',
  SET_USE_LOCAL_LLM: 'clipboard:setUseLocalLLM',

  // Improved content management
  SAVE_IMPROVED_CONTENT: 'clipboard:saveImprovedContent',
  CLEAR_IMPROVED_CONTENT: 'clipboard:clearImprovedContent',
  SET_USE_IMPROVED_VERSION: 'clipboard:setUseImprovedVersion',
  
  // Continuous Context mode
  GET_CONTINUOUS_CONTEXT_STATE: 'clipboard:getContinuousContextState',
  SET_CONTINUOUS_CONTEXT_ENABLED: 'clipboard:setContinuousContextEnabled',
  GET_CONTINUOUS_CONTEXT_ENABLED: 'clipboard:getContinuousContextEnabled',
  SET_CONTINUOUS_CONTEXT_HOTKEY: 'clipboard:setContinuousContextHotkey',
  GET_CONTINUOUS_CONTEXT_HOTKEY: 'clipboard:getContinuousContextHotkey',
  START_CONTINUOUS_CONTEXT: 'clipboard:startContinuousContext',
  STOP_CONTINUOUS_CONTEXT: 'clipboard:stopContinuousContext',
  CONTINUOUS_CONTEXT_CHANGED: 'clipboard:continuousContextChanged',
  SAVE_SKETCH: 'clipboard:saveSketch',
  GET_HIDE_SCREEN_RECORDING_BANNER: 'clipboard:getHideScreenRecordingBanner',
  SET_HIDE_SCREEN_RECORDING_BANNER: 'clipboard:setHideScreenRecordingBanner',
  GET_CURSOR_STATUS_ENABLED: 'clipboard:getCursorStatusEnabled',
  SET_CURSOR_STATUS_ENABLED: 'clipboard:setCursorStatusEnabled',
} as const;

const OnboardingIPCChannels = {
  GET_PERMISSION_STATUS: 'onboarding:getPermissionStatus',
  REQUEST_MICROPHONE: 'onboarding:requestMicrophone',
  OPEN_ACCESSIBILITY_SETTINGS: 'onboarding:openAccessibilitySettings',
  OPEN_SCREEN_RECORDING_SETTINGS: 'onboarding:openScreenRecordingSettings',
  TRIGGER_SCREEN_RECORDING_PROMPT: 'onboarding:triggerScreenRecordingPrompt',
  GET_ONBOARDING_STATE: 'onboarding:getState',
  SET_ONBOARDING_STEP: 'onboarding:setStep',
  COMPLETE_ONBOARDING: 'onboarding:complete',
  SKIP_ONBOARDING: 'onboarding:skip',
  RESET_ONBOARDING: 'onboarding:reset',
  CHECK_MODEL_STATUS: 'onboarding:checkModelStatus',
  EXPAND_WINDOW: 'onboarding:expandWindow',
} as const;

// Todo IPC channels for bidirectional sync with Supabase.
const TodoIPCChannels = {
  GET_TODOS: 'todo:getTodos',
  SYNC_TODOS: 'todo:syncTodos',
  CREATE_TODO: 'todo:createTodo',
  UPDATE_TODO: 'todo:updateTodo',
  TOGGLE_TODO: 'todo:toggleTodo',
  DELETE_TODO: 'todo:deleteTodo',
  DELETE_TODOS: 'todo:deleteTodos',
  COMPLETE_TODOS: 'todo:completeTodos',
  TODOS_CHANGED: 'todo:todosChanged',
  SHOW_TODOS: 'todo:showTodos',
  GET_TODO_HOTKEY: 'todo:getHotkey',
  SET_TODO_HOTKEY: 'todo:setHotkey',
  // Realtime events (granular updates from Supabase subscription).
  TODO_ADDED: 'todo:todoAdded',
  TODO_UPDATED: 'todo:todoUpdated',
  TODO_DELETED: 'todo:todoDeleted',
} as const;

const UpdaterIPCChannels = {
  CHECK_FOR_UPDATES: 'updater:checkForUpdates',
  DOWNLOAD_UPDATE: 'updater:downloadUpdate',
  INSTALL_UPDATE: 'updater:installUpdate',
  DISMISS_UPDATE: 'updater:dismissUpdate',
  CHECKING_FOR_UPDATE: 'updater:checkingForUpdate',
  UPDATE_AVAILABLE: 'updater:updateAvailable',
  UPDATE_NOT_AVAILABLE: 'updater:updateNotAvailable',
  DOWNLOAD_PROGRESS: 'updater:downloadProgress',
  UPDATE_DOWNLOADED: 'updater:updateDownloaded',
  UPDATE_ERROR: 'updater:error',
} as const;

const DiagnosticsIPCChannels = {
  GET_DIAGNOSTICS: 'diagnostics:get',
  GET_DIAGNOSTICS_MARKDOWN: 'diagnostics:getMarkdown',
} as const;

// Types (only for TypeScript checking, not runtime)
type AudioState = {
  devices: Array<{
    id: string;
    name: string;
    isInput: boolean;
    isOutput: boolean;
    manufacturer?: string;
    transportType?: string;
  }>;
  defaultInputId: string | null;
  priorityMode: boolean;
  priorityDeviceId: string | null;
  userOverrideId: string | null;
};

type TranscriptionStatus = 'idle' | 'recording' | 'transcribing';
type ModelStatus = 'downloaded' | 'downloading' | 'missing';

// Auto-improve usage statistics.
type AutoImproveStats = {
  wordsImproved: number;
  apiCalls: number;
  inputTokens: number;
  outputTokens: number;
};

// Sound configuration for recording actions.
type SoundConfig = {
  enabled: boolean;
  recordingStart: string | undefined;
  recordingStop: string | undefined;
  recordingCancel: string | undefined;
};

// Sound option for UI display.
type SoundOption = {
  id: string;
  name: string;
  category: string;
};

type ModelInfo = {
  name: string;
  url: string;
  sizeBytes: number;
  description: string;
};

type ClipboardItemType = 'text' | 'image' | 'transcript' | 'screenshot';
type ClipboardSource = 'mac' | 'ios';

type ClipboardItem = {
  id: number;
  type: ClipboardItemType;
  content: string | null;
  improvedContent: string | null; // Improved version from Engineer feature
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
  figureLabel: string | null; // Figure label for screenshots in stacks (e.g., "A", "B", "C")
  figureId: string | null; // Unique 5-char alphanumeric ID for searchability (e.g., "k7xm2")
};

type StackInfo = {
  stackId: string;
  itemCount: number;
  imageCount: number;
  textCount: number;
  createdAt: number;
  firstTextPreview: string | null;
};

type EngineerResult = {
  success: boolean;
  refinedPrompt?: string;
  error?: string;
};

type ClipboardQueryOptions = {
  type?: ClipboardItemType;
  search?: string;
  limit?: number;
  offset?: number;
  source?: ClipboardSource;
};

type ClipboardHotkeys = {
  screenshot?: string;
  history?: string;
  continuousContext?: string;
};

type ContinuousContextState = {
  active: boolean;
  stackId: string | null;
  screenshotCount: number;
};

// =============================================================================
// Shared Clipboard Types - Shared clipboard for collaboration
// =============================================================================

type SharedClipboardItem = {
  id: string;
  userId: string;
  sharedByEmail: string | null;
  type: ClipboardItemType;
  content: string | null;
  imageData: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  imageSize: number | null;
  improvedContent: string | null;
  stackId: string | null;
  sourceApp: string | null;
  sourceAppName: string | null;
  wordCount: number | null;
  charCount: number | null;
  clientId: string;
  clientCreatedAtMs: number;
  createdAt: number;
  updatedAt: number;
};

type SharedStackInfo = {
  stackId: string;
  name: string | null;
  itemCount: number;
  imageCount: number;
  textCount: number;
  createdByEmail: string | null;
  createdAt: number;
  firstTextPreview: string | null;
};

type SharedClipboardQueryOptions = {
  type?: ClipboardItemType;
  search?: string;
  limit?: number;
  offset?: number;
  stackId?: string;
};

const SharedClipboardIPCChannels = {
  QUERY_TEAM_ITEMS: 'teamClipboard:queryItems',
  GET_TEAM_ITEM: 'teamClipboard:getItem',
  SHARE_TO_TEAM: 'teamClipboard:shareItem',
  SHARE_STACK_TO_TEAM: 'teamClipboard:shareStack',
  DELETE_TEAM_ITEM: 'teamClipboard:deleteItem',
  UPDATE_TEAM_STACK_ID: 'teamClipboard:updateStackId',
  COPY_TO_PERSONAL: 'teamClipboard:copyToPersonal',
  COPY_STACK_TO_PERSONAL: 'teamClipboard:copyStackToPersonal',
  GET_TEAM_STACKS: 'teamClipboard:getStacks',
  CREATE_TEAM_STACK: 'teamClipboard:createStack',
  TEAM_ITEM_ADDED: 'teamClipboard:itemAdded',
  TEAM_ITEM_DELETED: 'teamClipboard:itemDeleted',
  TEAM_ITEM_UPDATED: 'teamClipboard:itemUpdated',
  // Team membership.
  GET_TEAM_MEMBERS: 'teamClipboard:getTeamMembers',
  ADD_TEAM_MEMBER: 'teamClipboard:addTeamMember',
  REMOVE_TEAM_MEMBER: 'teamClipboard:removeTeamMember',
  HAS_TEAMMATES: 'teamClipboard:hasTeammates',
} as const;

// Team member type for UI display.
type TeamMember = {
  id: string;
  email: string;
  addedByMe: boolean;
  createdAt: number;
};

// =============================================================================
// Social/DM Types - DMs, Feedback, and Contacts
// =============================================================================

// Message from the unified messages table.
type SocialMessage = {
  id: string;
  type: 'dm' | 'feedback';
  senderUserId: string;
  senderEmail: string | null;
  senderName: string | null;
  recipientUserId: string;
  recipientEmail: string | null;
  recipientName: string | null;
  contentType: 'text' | 'image' | 'stack';
  contentText: string | null;
  imagePath: string | null;
  imageUrl: string | null;
  stackId: string | null;
  sourceItemId: string | null;
  readAt: number | null;
  feedbackStatus: 'open' | 'resolved' | 'archived' | null;
  parentMessageId: string | null;
  createdAt: number;
  updatedAt: number;
};

// Contact from the contacts table.
type SocialContact = {
  id: string;
  ownerUserId: string;
  contactEmail: string;
  contactUserId: string | null;
  contactName: string | null;
  relationshipType: 'team' | 'friend' | null;
  status: 'pending' | 'accepted';
  createdAt: number;
};

// DM conversation summary for list view.
type DMConversation = {
  otherUserId: string;
  otherUserEmail: string;
  otherUserName: string | null;
  relationshipType: 'team' | 'friend' | null;
  lastMessage: SocialMessage | null;
  unreadCount: number;
};

// Activity log entry for feedback.
type ActivityLogEntry = {
  id: string;
  messageId: string;
  userId: string;
  userEmail: string | null;
  action: 'created' | 'status_changed' | 'replied';
  oldStatus: string | null;
  newStatus: string | null;
  createdAt: number;
};

const SocialIPCChannels = {
  // DM operations
  SEND_DM: 'social:sendDM',
  SEND_TEXT_DM: 'social:sendTextDM',
  SEND_IMAGE_REPLY: 'social:sendImageReply',
  GET_CONVERSATIONS: 'social:getConversations',
  GET_DMS_WITH_USER: 'social:getDMsWithUser',
  MARK_AS_READ: 'social:markAsRead',
  MARK_AS_READ_BATCH: 'social:markAsReadBatch',
  HAS_UNREAD: 'social:hasUnread',
  HAS_UNREAD_FEEDBACK: 'social:hasUnreadFeedback',
  MARK_ALL_FEEDBACK_AS_READ: 'social:markAllFeedbackAsRead',

  // Feedback operations
  SUBMIT_FEEDBACK: 'social:submitFeedback',
  SUBMIT_TEXT_FEEDBACK: 'social:submitTextFeedback',
  SUBMIT_IMAGE_FEEDBACK: 'social:submitImageFeedback',
  GET_MY_FEEDBACK: 'social:getMyFeedback',
  GET_ALL_FEEDBACK: 'social:getAllFeedback',
  GET_FEEDBACK_REPLIES: 'social:getFeedbackReplies',
  UPDATE_FEEDBACK_STATUS: 'social:updateFeedbackStatus',
  GET_ACTIVITY_LOG: 'social:getActivityLog',
  
  // Contact operations
  GET_CONTACTS: 'social:getContacts',
  ADD_FRIEND: 'social:addFriend',
  SEARCH_CONTACTS: 'social:searchContacts',
  GET_PENDING_INVITES: 'social:getPendingInvites',
  RESPOND_TO_INVITE: 'social:respondToInvite',
  REMOVE_FRIEND: 'social:removeFriend',
  
  // Hot mic
  GET_HOT_MIC: 'social:getHotMic',
  SET_HOT_MIC: 'social:setHotMic',
  
  // Admin check
  IS_ADMIN: 'social:isAdmin',
  
  // Events
  MESSAGE_RECEIVED: 'social:messageReceived',
} as const;

// Todo type for bidirectional sync with Supabase.
type Todo = {
  id: string;           // Supabase UUID
  clientId: string;     // Client-generated ID for deduplication
  text: string;
  completed: boolean;
  createdAt: number;    // client_created_at_ms
  updatedAt: number;    // Parsed from updated_at
};

type PermissionStatus = {
  microphone: 'granted' | 'denied' | 'not-determined';
  accessibility: boolean;
  screenRecording: boolean;
};

type OnboardingState = {
  isComplete: boolean;
  currentStep: number;
  permissions: PermissionStatus;
  modelDownloaded: boolean;
};

type RunningApp = {
  bundleId: string;
  name: string;
};

type TargetAppInfo = {
  targetApp: RunningApp | null;
  runningApps: RunningApp[];
};

export interface AudioAPI {
  getState: () => Promise<AudioState>;
  setPriorityMode: (enabled: boolean) => Promise<void>;
  setPriorityDevice: (deviceId: string | null) => Promise<void>;
  resetOverride: () => Promise<void>;
  onStateChanged: (callback: (state: AudioState) => void) => () => void;
}

// Valid hotkey IDs that can be get/set via the hotkeyAPI
export type HotkeyId = 'superPaste' | 'commandLauncher' | 'improveText' | 'autoImprove';

export interface HotkeyAPI {
  getHotkey: (id: HotkeyId) => Promise<string | null>;
  setHotkey: (id: HotkeyId, key: string) => Promise<{ success: boolean; error?: string }>;
  getAllHotkeys: () => Promise<Record<HotkeyId, string | null>>;
}

export interface TranscribeAPI {
  getStatus: () => Promise<TranscriptionStatus>;
  getModelStatus: () => Promise<ModelStatus>;
  downloadModel: (modelSize?: string) => Promise<void>;
  deleteModel: (modelSize: string) => Promise<boolean>;
  getAvailableModels: () => Promise<Record<string, ModelInfo>>;
  getModelDownloadStatus: () => Promise<Record<string, boolean>>;
  getDownloadingModels: () => Promise<string[]>;
  getSelectedModel: () => Promise<string>;
  setSelectedModel: (modelSize: string) => Promise<void>;
  getHotkey: () => Promise<string>;
  setHotkey: (hotkey: string) => Promise<boolean>;
  getSecondaryHotkey: () => Promise<string | null>;
  setSecondaryHotkey: (hotkey: string | null) => Promise<boolean>;
  getOverlayStyle: () => Promise<'rectangle' | 'top-emerging'>;
  setOverlayStyle: (style: 'rectangle' | 'top-emerging') => Promise<void>;
  getAbandonHotkey: () => Promise<string>;
  setAbandonHotkey: (hotkey: string) => Promise<boolean>;
  getAbandonConfirmation: () => Promise<boolean>;
  setAbandonConfirmation: (enabled: boolean) => Promise<void>;
  getAutoImprove: () => Promise<boolean>;
  setAutoImprove: (enabled: boolean) => Promise<void>;
  getAutoImproveMinWords: () => Promise<number>;
  setAutoImproveMinWords: (minWords: number) => Promise<void>;
  getAutoImproveStats: () => Promise<AutoImproveStats>;
  resetAutoImproveStats: () => Promise<void>;
  toggleRecording: () => Promise<void>;
  getSoundConfig: () => Promise<SoundConfig>;
  setSoundConfig: (config: Partial<SoundConfig>) => Promise<void>;
  getAvailableSounds: () => Promise<SoundOption[]>;
  previewSound: (soundId: string) => Promise<void>;
  getStackCount: () => Promise<number>;
  addToStack: (itemId: number) => Promise<void>;
  onStatusChanged: (callback: (status: TranscriptionStatus) => void) => () => void;
  onResult: (callback: (text: string) => void) => () => void;
  onError: (callback: (error: string) => void) => () => void;
  onModelDownloadProgress: (callback: (downloaded: number, total: number) => void) => () => void;
  onHotkeyChanged: (callback: (hotkey: string) => void) => () => void;
  onStackChanged: (callback: (count: number) => void) => () => void;
}

export interface ClipboardAPI {
  queryItems: (options?: ClipboardQueryOptions) => Promise<ClipboardItem[]>;
  getItem: (id: number) => Promise<ClipboardItem | null>;
  deleteItem: (id: number) => Promise<void>;
  restoreItem: (item: ClipboardItem) => Promise<number>;
  clearAll: () => Promise<void>;
  captureScreenshot: (region?: boolean) => Promise<number>;
  saveSketch: (imageData: string, width: number, height: number) => Promise<number>;
  getHotkeys: () => Promise<ClipboardHotkeys>;
  setHotkeys: (hotkeys: ClipboardHotkeys) => Promise<boolean>;
  pasteItem: (id: number, targetBundleId?: string, useImproved?: boolean) => Promise<void>;
  copyItem: (id: number, useImproved?: boolean) => Promise<void>;
  pasteStack: (ids: number[]) => Promise<void>;
  pasteText: (text: string, targetBundleId?: string) => Promise<void>;
  separateIntoTasks: (id: number) => Promise<void>;
  // Target app management.
  getTargetApp: () => Promise<RunningApp | null>;
  setTargetApp: (app: RunningApp | null) => Promise<void>;
  getRunningApps: () => Promise<RunningApp[]>;
  pasteToApp: (bundleId: string) => Promise<boolean>;
  onItemAdded: (callback: (id: number) => void) => () => void;
  onItemDeleted: (callback: (id: number) => void) => () => void;
  onShowHistory: (callback: () => void) => () => void;
  onShowSettings: (callback: () => void) => () => void;
  onCollapseImmersive: (callback: () => void) => () => void;
  onResetToClipboardView: (callback: () => void) => () => void;
  onPlaySound: (callback: (soundId: 'windowOpen' | 'windowClose' | 'artifactDiscovery') => void) => () => void;
  onDialogPosition: (callback: (position: { left: number; top: number }) => void) => () => void;
  onDialogBounds: (callback: (bounds: { x: number; y: number; width: number; height: number }) => void) => () => void;
  onTargetAppInfo: (callback: (info: TargetAppInfo) => void) => () => void;
  saveBounds: (bounds: { x: number; y: number; width: number; height: number }) => Promise<void>;
  closeWindow: () => Promise<void>;
  showNoTargetError: (message?: string) => void;
  setSketchMode: (active: boolean) => void;
  
  // Stack operations for prompt stacking feature
  queryItemsByStackId: (stackId: string) => Promise<ClipboardItem[]>;
  getUniqueStacks: () => Promise<StackInfo[]>;
  updateStackId: (itemIds: number[], stackId: string | null) => Promise<void>;
  startDrag: (stackId: string) => Promise<void>;

  // All-time stats for footer display
  getAllTimeStats: () => Promise<{ stacks: number; transcriptions: number; screenshots: number; improved: number; words: number }>;
  incrementImprovedCount: () => Promise<number>;

  // Local LLM model management
  getLocalLLMModels: () => Promise<Record<string, { name: string; filename: string; sizeBytes: number; description: string }>>;
  getLocalLLMStatus: () => Promise<Record<string, boolean>>;
  getLocalLLMSelected: () => Promise<string>;
  setLocalLLMSelected: (model: string) => Promise<{ success: boolean; error?: string }>;
  downloadLocalLLM: (model: string) => Promise<{ success: boolean; error?: string }>;
  deleteLocalLLM: (model: string) => Promise<{ success: boolean; error?: string }>;
  getUseLocalLLM: () => Promise<boolean>;
  setUseLocalLLM: (useLocal: boolean) => Promise<{ success: boolean; error?: string }>;
  onLocalLLMDownloadProgress: (callback: (data: { model: string; downloaded: number; total: number }) => void) => () => void;

  // Improved content management - store/clear improved versions of transcriptions
  saveImprovedContent: (itemId: number, improvedContent: string) => Promise<{ success: boolean; error?: string }>;
  clearImprovedContent: (itemId: number) => Promise<{ success: boolean; error?: string }>;
  setUseImprovedVersion: (itemId: number, useImproved: boolean) => Promise<{ success: boolean; error?: string }>;
  
  // Mobile sync operations - sync iOS transcriptions to clipboard history
  setSyncSession: (accessToken: string, refreshToken: string) => Promise<boolean>;
  clearSyncSession: () => Promise<boolean>;
  getSyncSession: () => Promise<{ accessToken: string; refreshToken: string; expiresAt: number; user: { id: string; email: string } | null } | null>;
  syncMobileTranscripts: () => Promise<number>;
  forceSyncAll: () => Promise<number>;
  getSyncEnabled: () => Promise<boolean>;
  setSyncEnabled: (enabled: boolean) => Promise<boolean>;
  
  // Continuous Context mode - multi-screenshot capture sessions
  getContinuousContextState: () => Promise<ContinuousContextState>;
  getContinuousContextEnabled: () => Promise<boolean>;
  setContinuousContextEnabled: (enabled: boolean) => Promise<boolean>;
  getContinuousContextHotkey: () => Promise<string>;
  setContinuousContextHotkey: (hotkey: string) => Promise<boolean>;
  startContinuousContext: () => Promise<void>;
  stopContinuousContext: () => Promise<void>;
  onContinuousContextChanged: (callback: (state: ContinuousContextState) => void) => () => void;
  
  // Permission banner settings
  getHideScreenRecordingBanner: () => Promise<boolean>;
  setHideScreenRecordingBanner: (hide: boolean) => Promise<boolean>;
  
  // Cursor status indicator settings
  getCursorStatusEnabled: () => Promise<boolean>;
  setCursorStatusEnabled: (enabled: boolean) => Promise<boolean>;
  
  // Hide status labels (show only colored dots)
  getHideStatusLabels?: () => Promise<boolean>;
  setHideStatusLabels?: (hide: boolean) => Promise<boolean>;
  
  // Show in Dock and Cmd+Tab
  getShowInDock?: () => Promise<boolean>;
  setShowInDock?: (show: boolean) => Promise<boolean>;

  // Launch at login
  getLaunchAtLogin?: () => Promise<boolean>;
  setLaunchAtLogin?: (enabled: boolean) => Promise<{ success: boolean; enabled: boolean }>;

  // Sounds enabled (master toggle)
  getSoundsEnabled?: () => Promise<boolean>;
  setSoundsEnabled?: (enabled: boolean) => Promise<boolean>;
  
  // Tasks tab (experimental feature)
  getTasksTabEnabled?: () => Promise<boolean>;
  setTasksTabEnabled?: (enabled: boolean) => Promise<boolean>;
  onTasksTabToggled?: (callback: (enabled: boolean) => void) => () => void;

  // Word substitutions - correction pairs for transcription
  getWordSubstitutions?: () => Promise<Array<{ from: string; to: string }>>;
  setWordSubstitutions?: (substitutions: Array<{ from: string; to: string }>) => Promise<boolean>;

  // Data retention - how long to keep clipboard history
  getDataRetentionDays?: () => Promise<number>;
  setDataRetentionDays?: (days: number) => Promise<boolean>;
}

export interface PermissionsAPI {
  check: () => Promise<{ accessibilityGranted: boolean }>;
  onStatusChanged: (callback: (status: { accessibilityGranted: boolean }) => void) => () => void;
  onRevoked: (callback: () => void) => () => void;
}

export interface DiagnosticsAPI {
  getDiagnostics: () => Promise<unknown>;
  getDiagnosticsMarkdown: () => Promise<string>;
}

const audioAPI: AudioAPI = {
  getState: async (): Promise<AudioState> => {
    return ipcRenderer.invoke(AudioIPCChannels.GET_STATE);
  },

  setPriorityMode: async (enabled: boolean): Promise<void> => {
    return ipcRenderer.invoke(AudioIPCChannels.SET_PRIORITY_MODE, { enabled });
  },

  setPriorityDevice: async (deviceId: string | null): Promise<void> => {
    return ipcRenderer.invoke(AudioIPCChannels.SET_PRIORITY_DEVICE, { deviceId });
  },

  resetOverride: async (): Promise<void> => {
    return ipcRenderer.invoke(AudioIPCChannels.RESET_OVERRIDE);
  },

  onStateChanged: (callback: (state: AudioState) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: AudioState) => {
      callback(state);
    };

    ipcRenderer.on(AudioIPCChannels.STATE_CHANGED, handler);

    return () => {
      ipcRenderer.removeListener(AudioIPCChannels.STATE_CHANGED, handler);
    };
  },
};

const hotkeyAPI: HotkeyAPI = {
  getHotkey: async (id: HotkeyId): Promise<string | null> => {
    return ipcRenderer.invoke(HotkeyIPCChannels.GET_HOTKEY, id);
  },

  setHotkey: async (id: HotkeyId, key: string): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke(HotkeyIPCChannels.SET_HOTKEY, id, key);
  },

  getAllHotkeys: async (): Promise<Record<HotkeyId, string | null>> => {
    return ipcRenderer.invoke(HotkeyIPCChannels.GET_ALL_HOTKEYS);
  },
};

const transcribeAPI: TranscribeAPI = {
  getStatus: async (): Promise<TranscriptionStatus> => {
    return ipcRenderer.invoke(TranscribeIPCChannels.GET_STATUS);
  },

  getModelStatus: async (): Promise<ModelStatus> => {
    return ipcRenderer.invoke(TranscribeIPCChannels.GET_MODEL_STATUS);
  },

  downloadModel: async (modelSize?: string): Promise<void> => {
    return ipcRenderer.invoke(TranscribeIPCChannels.DOWNLOAD_MODEL, modelSize);
  },

  deleteModel: async (modelSize: string): Promise<boolean> => {
    return ipcRenderer.invoke(TranscribeIPCChannels.DELETE_MODEL, modelSize);
  },

  getAvailableModels: async (): Promise<Record<string, ModelInfo>> => {
    return ipcRenderer.invoke(TranscribeIPCChannels.GET_AVAILABLE_MODELS);
  },

  getModelDownloadStatus: async (): Promise<Record<string, boolean>> => {
    return ipcRenderer.invoke(TranscribeIPCChannels.GET_MODEL_DOWNLOAD_STATUS);
  },

  getDownloadingModels: async (): Promise<string[]> => {
    return ipcRenderer.invoke(TranscribeIPCChannels.GET_DOWNLOADING_MODELS);
  },

  getSelectedModel: async (): Promise<string> => {
    return ipcRenderer.invoke(TranscribeIPCChannels.GET_SELECTED_MODEL);
  },

  setSelectedModel: async (modelSize: string): Promise<void> => {
    return ipcRenderer.invoke(TranscribeIPCChannels.SET_SELECTED_MODEL, modelSize);
  },

  getHotkey: async (): Promise<string> => {
    return ipcRenderer.invoke(TranscribeIPCChannels.GET_HOTKEY);
  },

  setHotkey: async (hotkey: string): Promise<boolean> => {
    return ipcRenderer.invoke(TranscribeIPCChannels.SET_HOTKEY, hotkey);
  },

  getSecondaryHotkey: async (): Promise<string | null> => {
    return ipcRenderer.invoke(TranscribeIPCChannels.GET_SECONDARY_HOTKEY);
  },

  setSecondaryHotkey: async (hotkey: string | null): Promise<boolean> => {
    return ipcRenderer.invoke(TranscribeIPCChannels.SET_SECONDARY_HOTKEY, hotkey);
  },

  getOverlayStyle: async (): Promise<'rectangle' | 'top-emerging'> => {
    return ipcRenderer.invoke(TranscribeIPCChannels.GET_OVERLAY_STYLE);
  },

  setOverlayStyle: async (style: 'rectangle' | 'top-emerging'): Promise<void> => {
    return ipcRenderer.invoke(TranscribeIPCChannels.SET_OVERLAY_STYLE, style);
  },

  getAbandonHotkey: async (): Promise<string> => {
    return ipcRenderer.invoke(TranscribeIPCChannels.GET_ABANDON_HOTKEY);
  },

  setAbandonHotkey: async (hotkey: string): Promise<boolean> => {
    return ipcRenderer.invoke(TranscribeIPCChannels.SET_ABANDON_HOTKEY, hotkey);
  },

  getAbandonConfirmation: async (): Promise<boolean> => {
    return ipcRenderer.invoke(TranscribeIPCChannels.GET_ABANDON_CONFIRMATION);
  },

  setAbandonConfirmation: async (enabled: boolean): Promise<void> => {
    return ipcRenderer.invoke(TranscribeIPCChannels.SET_ABANDON_CONFIRMATION, enabled);
  },

  getAutoImprove: async (): Promise<boolean> => {
    return ipcRenderer.invoke(TranscribeIPCChannels.GET_AUTO_IMPROVE);
  },

  setAutoImprove: async (enabled: boolean): Promise<void> => {
    return ipcRenderer.invoke(TranscribeIPCChannels.SET_AUTO_IMPROVE, enabled);
  },

  getAutoImproveMinWords: async (): Promise<number> => {
    return ipcRenderer.invoke(TranscribeIPCChannels.GET_AUTO_IMPROVE_MIN_WORDS);
  },

  setAutoImproveMinWords: async (minWords: number): Promise<void> => {
    return ipcRenderer.invoke(TranscribeIPCChannels.SET_AUTO_IMPROVE_MIN_WORDS, minWords);
  },

  getAutoImproveStats: async (): Promise<AutoImproveStats> => {
    return ipcRenderer.invoke(TranscribeIPCChannels.GET_AUTO_IMPROVE_STATS);
  },

  resetAutoImproveStats: async (): Promise<void> => {
    return ipcRenderer.invoke(TranscribeIPCChannels.RESET_AUTO_IMPROVE_STATS);
  },

  toggleRecording: async (): Promise<void> => {
    return ipcRenderer.invoke(TranscribeIPCChannels.TOGGLE_RECORDING);
  },

  getSoundConfig: async (): Promise<SoundConfig> => {
    return ipcRenderer.invoke(TranscribeIPCChannels.GET_SOUND_CONFIG);
  },

  setSoundConfig: async (config: Partial<SoundConfig>): Promise<void> => {
    return ipcRenderer.invoke(TranscribeIPCChannels.SET_SOUND_CONFIG, config);
  },

  getAvailableSounds: async (): Promise<SoundOption[]> => {
    return ipcRenderer.invoke(TranscribeIPCChannels.GET_AVAILABLE_SOUNDS);
  },

  previewSound: async (soundId: string): Promise<void> => {
    return ipcRenderer.invoke(TranscribeIPCChannels.PREVIEW_SOUND, soundId);
  },

  onStatusChanged: (callback: (status: TranscriptionStatus) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: TranscriptionStatus) => {
      callback(status);
    };

    ipcRenderer.on(TranscribeIPCChannels.STATUS_CHANGED, handler);

    return () => {
      ipcRenderer.removeListener(TranscribeIPCChannels.STATUS_CHANGED, handler);
    };
  },

  onResult: (callback: (text: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, text: string) => {
      callback(text);
    };

    ipcRenderer.on(TranscribeIPCChannels.RESULT, handler);

    return () => {
      ipcRenderer.removeListener(TranscribeIPCChannels.RESULT, handler);
    };
  },

  onError: (callback: (error: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, error: string) => {
      callback(error);
    };

    ipcRenderer.on(TranscribeIPCChannels.ERROR, handler);

    return () => {
      ipcRenderer.removeListener(TranscribeIPCChannels.ERROR, handler);
    };
  },

  onModelDownloadProgress: (callback: (downloaded: number, total: number) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, downloaded: number, total: number) => {
      callback(downloaded, total);
    };

    ipcRenderer.on(TranscribeIPCChannels.MODEL_DOWNLOAD_PROGRESS, handler);

    return () => {
      ipcRenderer.removeListener(TranscribeIPCChannels.MODEL_DOWNLOAD_PROGRESS, handler);
    };
  },

  onHotkeyChanged: (callback: (hotkey: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, hotkey: string) => {
      callback(hotkey);
    };

    ipcRenderer.on(TranscribeIPCChannels.HOTKEY_CHANGED, handler);

    return () => {
      ipcRenderer.removeListener(TranscribeIPCChannels.HOTKEY_CHANGED, handler);
    };
  },

  getStackCount: async (): Promise<number> => {
    return ipcRenderer.invoke('transcribe:getStackCount');
  },
  
  addToStack: async (itemId: number): Promise<void> => {
    return ipcRenderer.invoke(TranscribeIPCChannels.ADD_TO_STACK, itemId);
  },

  onStackChanged: (callback: (count: number) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, count: number) => {
      callback(count);
    };

    ipcRenderer.on('transcribe:stackChanged', handler);

    return () => {
      ipcRenderer.removeListener('transcribe:stackChanged', handler);
    };
  },
};

const clipboardAPI: ClipboardAPI = {
  queryItems: async (options?: ClipboardQueryOptions): Promise<ClipboardItem[]> => {
    return ipcRenderer.invoke(ClipboardIPCChannels.QUERY_ITEMS, options);
  },

  getItem: async (id: number): Promise<ClipboardItem | null> => {
    return ipcRenderer.invoke(ClipboardIPCChannels.GET_ITEM, id);
  },

  deleteItem: async (id: number): Promise<void> => {
    return ipcRenderer.invoke(ClipboardIPCChannels.DELETE_ITEM, id);
  },

  restoreItem: async (item: ClipboardItem): Promise<number> => {
    return ipcRenderer.invoke(ClipboardIPCChannels.RESTORE_ITEM, item);
  },

  clearAll: async (): Promise<void> => {
    return ipcRenderer.invoke(ClipboardIPCChannels.CLEAR_ALL);
  },

  captureScreenshot: async (region?: boolean): Promise<number> => {
    return ipcRenderer.invoke(ClipboardIPCChannels.CAPTURE_SCREENSHOT, region);
  },

  saveSketch: async (imageData: string, width: number, height: number): Promise<number> => {
    return ipcRenderer.invoke(ClipboardIPCChannels.SAVE_SKETCH, imageData, width, height);
  },

  getHotkeys: async (): Promise<ClipboardHotkeys> => {
    return ipcRenderer.invoke(ClipboardIPCChannels.GET_HOTKEYS);
  },

  setHotkeys: async (hotkeys: ClipboardHotkeys): Promise<boolean> => {
    return ipcRenderer.invoke(ClipboardIPCChannels.SET_HOTKEYS, hotkeys);
  },

  pasteItem: async (id: number, targetBundleId?: string, useImproved?: boolean): Promise<void> => {
    return ipcRenderer.invoke(ClipboardIPCChannels.PASTE_ITEM, id, targetBundleId, useImproved);
  },

  copyItem: async (id: number, useImproved?: boolean): Promise<void> => {
    return ipcRenderer.invoke(ClipboardIPCChannels.COPY_ITEM, id, useImproved);
  },

  pasteStack: async (ids: number[]): Promise<void> => {
    return ipcRenderer.invoke(ClipboardIPCChannels.PASTE_STACK, ids);
  },

  pasteText: async (text: string, targetBundleId?: string): Promise<void> => {
    return ipcRenderer.invoke(ClipboardIPCChannels.PASTE_TEXT, text, targetBundleId);
  },

  separateIntoTasks: async (id: number): Promise<void> => {
    return ipcRenderer.invoke(ClipboardIPCChannels.SEPARATE_INTO_TASKS, id);
  },

  // Target app management.
  getTargetApp: async (): Promise<RunningApp | null> => {
    return ipcRenderer.invoke(ClipboardIPCChannels.GET_TARGET_APP);
  },

  setTargetApp: async (app: RunningApp | null): Promise<void> => {
    return ipcRenderer.invoke(ClipboardIPCChannels.SET_TARGET_APP, app);
  },

  getRunningApps: async (): Promise<RunningApp[]> => {
    return ipcRenderer.invoke(ClipboardIPCChannels.GET_RUNNING_APPS);
  },

  pasteToApp: async (bundleId: string): Promise<boolean> => {
    return ipcRenderer.invoke(ClipboardIPCChannels.PASTE_TO_APP, bundleId);
  },

  onItemAdded: (callback: (id: number) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, id: number) => {
      callback(id);
    };
    ipcRenderer.on(ClipboardIPCChannels.ITEM_ADDED, handler);
    return () => {
      ipcRenderer.removeListener(ClipboardIPCChannels.ITEM_ADDED, handler);
    };
  },

  onItemDeleted: (callback: (id: number) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, id: number) => {
      callback(id);
    };
    ipcRenderer.on(ClipboardIPCChannels.ITEM_DELETED, handler);
    return () => {
      ipcRenderer.removeListener(ClipboardIPCChannels.ITEM_DELETED, handler);
    };
  },

  onShowHistory: (callback: () => void): (() => void) => {
    const handler = () => {
      callback();
    };
    ipcRenderer.on('clipboard:showHistory', handler);
    return () => {
      ipcRenderer.removeListener('clipboard:showHistory', handler);
    };
  },

  onShowSettings: (callback: () => void): (() => void) => {
    const handler = () => {
      callback();
    };
    ipcRenderer.on('clipboard:showSettings', handler);
    return () => {
      ipcRenderer.removeListener('clipboard:showSettings', handler);
    };
  },

  onCollapseImmersive: (callback: () => void): (() => void) => {
    const handler = () => {
      callback();
    };
    ipcRenderer.on('collapse-immersive', handler);
    return () => {
      ipcRenderer.removeListener('collapse-immersive', handler);
    };
  },

  onResetToClipboardView: (callback: () => void): (() => void) => {
    const handler = () => {
      callback();
    };
    ipcRenderer.on('clipboard:resetToClipboardView', handler);
    return () => {
      ipcRenderer.removeListener('clipboard:resetToClipboardView', handler);
    };
  },

  onPlaySound: (callback: (soundId: 'windowOpen' | 'windowClose' | 'artifactDiscovery') => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, soundId: 'windowOpen' | 'windowClose' | 'artifactDiscovery') => {
      callback(soundId);
    };
    ipcRenderer.on('clipboard:playSound', handler);
    return () => {
      ipcRenderer.removeListener('clipboard:playSound', handler);
    };
  },

  onDialogPosition: (callback: (position: { left: number; top: number }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, position: { left: number; top: number }) => {
      callback(position);
    };
    ipcRenderer.on(ClipboardIPCChannels.DIALOG_POSITION, handler);
    return () => {
      ipcRenderer.removeListener(ClipboardIPCChannels.DIALOG_POSITION, handler);
    };
  },

  onDialogBounds: (callback: (bounds: { x: number; y: number; width: number; height: number; overlayWidth: number; overlayHeight: number }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, bounds: { x: number; y: number; width: number; height: number; overlayWidth: number; overlayHeight: number }) => {
      callback(bounds);
    };
    ipcRenderer.on(ClipboardIPCChannels.DIALOG_BOUNDS, handler);
    return () => {
      ipcRenderer.removeListener(ClipboardIPCChannels.DIALOG_BOUNDS, handler);
    };
  },

  onTargetAppInfo: (callback: (info: TargetAppInfo) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, info: TargetAppInfo) => {
      callback(info);
    };
    ipcRenderer.on(ClipboardIPCChannels.TARGET_APP_INFO, handler);
    return () => {
      ipcRenderer.removeListener(ClipboardIPCChannels.TARGET_APP_INFO, handler);
    };
  },

  saveBounds: async (bounds: { x: number; y: number; width: number; height: number }): Promise<void> => {
    return ipcRenderer.invoke(ClipboardIPCChannels.SAVE_BOUNDS, bounds);
  },

  closeWindow: async (): Promise<void> => {
    // Send IPC to main process to close the current window
    ipcRenderer.send('clipboard:closeWindow');
  },
  
  showNoTargetError: (message?: string): void => {
    ipcRenderer.send('clipboard:showNoTargetError', message);
  },
  
  setSketchMode: (active: boolean): void => {
    ipcRenderer.send('clipboard:setSketchMode', active);
  },

  // Stack operations for prompt stacking feature
  queryItemsByStackId: async (stackId: string): Promise<ClipboardItem[]> => {
    return ipcRenderer.invoke('clipboard:queryItemsByStack', stackId);
  },

  getUniqueStacks: async (): Promise<StackInfo[]> => {
    return ipcRenderer.invoke('clipboard:getUniqueStacks');
  },

  updateStackId: async (itemIds: number[], stackId: string | null): Promise<void> => {
    return ipcRenderer.invoke('clipboard:updateStackId', itemIds, stackId);
  },

  startDrag: async (stackId: string): Promise<void> => {
    return ipcRenderer.invoke('clipboard:startDrag', stackId);
  },

  // All-time stats for footer display
  getAllTimeStats: async (): Promise<{ stacks: number; transcriptions: number; screenshots: number; improved: number; words: number }> => {
    return ipcRenderer.invoke('clipboard:getAllTimeStats');
  },

  incrementImprovedCount: async (): Promise<number> => {
    return ipcRenderer.invoke('clipboard:incrementImprovedCount');
  },

  // Local LLM model management
  getLocalLLMModels: async () => {
    return ipcRenderer.invoke(ClipboardIPCChannels.GET_LOCAL_LLM_MODELS);
  },

  getLocalLLMStatus: async () => {
    return ipcRenderer.invoke(ClipboardIPCChannels.GET_LOCAL_LLM_STATUS);
  },

  getLocalLLMSelected: async () => {
    return ipcRenderer.invoke(ClipboardIPCChannels.GET_LOCAL_LLM_SELECTED);
  },

  setLocalLLMSelected: async (model: string) => {
    return ipcRenderer.invoke(ClipboardIPCChannels.SET_LOCAL_LLM_SELECTED, model);
  },

  downloadLocalLLM: async (model: string) => {
    return ipcRenderer.invoke(ClipboardIPCChannels.DOWNLOAD_LOCAL_LLM, model);
  },

  deleteLocalLLM: async (model: string) => {
    return ipcRenderer.invoke(ClipboardIPCChannels.DELETE_LOCAL_LLM, model);
  },

  getUseLocalLLM: async () => {
    return ipcRenderer.invoke(ClipboardIPCChannels.GET_USE_LOCAL_LLM);
  },

  setUseLocalLLM: async (useLocal: boolean) => {
    return ipcRenderer.invoke(ClipboardIPCChannels.SET_USE_LOCAL_LLM, useLocal);
  },

  onLocalLLMDownloadProgress: (callback: (data: { model: string; downloaded: number; total: number }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { model: string; downloaded: number; total: number }) => {
      callback(data);
    };
    ipcRenderer.on('local-llm:download-progress', handler);
    return () => {
      ipcRenderer.removeListener('local-llm:download-progress', handler);
    };
  },

  // Improved content management - store/clear improved versions of transcriptions
  saveImprovedContent: async (itemId: number, improvedContent: string): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke(ClipboardIPCChannels.SAVE_IMPROVED_CONTENT, itemId, improvedContent);
  },

  clearImprovedContent: async (itemId: number): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke(ClipboardIPCChannels.CLEAR_IMPROVED_CONTENT, itemId);
  },

  setUseImprovedVersion: async (itemId: number, useImproved: boolean): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke(ClipboardIPCChannels.SET_USE_IMPROVED_VERSION, itemId, useImproved);
  },

  // Mobile sync operations - sync iOS transcriptions to clipboard history
  setSyncSession: async (accessToken: string, refreshToken: string): Promise<boolean> => {
    return ipcRenderer.invoke('clipboard:setSyncSession', accessToken, refreshToken);
  },

  clearSyncSession: async (): Promise<boolean> => {
    return ipcRenderer.invoke('clipboard:clearSyncSession');
  },

  getSyncSession: async (): Promise<{ accessToken: string; refreshToken: string; expiresAt: number; user: { id: string; email: string } | null } | null> => {
    return ipcRenderer.invoke('clipboard:getSyncSession');
  },

  syncMobileTranscripts: async (): Promise<number> => {
    return ipcRenderer.invoke('clipboard:syncMobileTranscripts');
  },

  forceSyncAll: async (): Promise<number> => {
    return ipcRenderer.invoke('clipboard:forceSyncAll');
  },

  getSyncEnabled: async (): Promise<boolean> => {
    return ipcRenderer.invoke('clipboard:getSyncEnabled');
  },

  setSyncEnabled: async (enabled: boolean): Promise<boolean> => {
    return ipcRenderer.invoke('clipboard:setSyncEnabled', enabled);
  },

  // Continuous Context mode - multi-screenshot capture sessions
  getContinuousContextState: async (): Promise<ContinuousContextState> => {
    return ipcRenderer.invoke(ClipboardIPCChannels.GET_CONTINUOUS_CONTEXT_STATE);
  },

  getContinuousContextEnabled: async (): Promise<boolean> => {
    return ipcRenderer.invoke(ClipboardIPCChannels.GET_CONTINUOUS_CONTEXT_ENABLED);
  },

  setContinuousContextEnabled: async (enabled: boolean): Promise<boolean> => {
    return ipcRenderer.invoke(ClipboardIPCChannels.SET_CONTINUOUS_CONTEXT_ENABLED, enabled);
  },

  getContinuousContextHotkey: async (): Promise<string> => {
    return ipcRenderer.invoke(ClipboardIPCChannels.GET_CONTINUOUS_CONTEXT_HOTKEY);
  },

  setContinuousContextHotkey: async (hotkey: string): Promise<boolean> => {
    return ipcRenderer.invoke(ClipboardIPCChannels.SET_CONTINUOUS_CONTEXT_HOTKEY, hotkey);
  },

  startContinuousContext: async (): Promise<void> => {
    return ipcRenderer.invoke(ClipboardIPCChannels.START_CONTINUOUS_CONTEXT);
  },

  stopContinuousContext: async (): Promise<void> => {
    return ipcRenderer.invoke(ClipboardIPCChannels.STOP_CONTINUOUS_CONTEXT);
  },

  onContinuousContextChanged: (callback: (state: ContinuousContextState) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: ContinuousContextState) => {
      callback(state);
    };
    ipcRenderer.on(ClipboardIPCChannels.CONTINUOUS_CONTEXT_CHANGED, handler);
    return () => {
      ipcRenderer.removeListener(ClipboardIPCChannels.CONTINUOUS_CONTEXT_CHANGED, handler);
    };
  },

  // Permission banner settings - get/set whether to hide the screen recording banner.
  getHideScreenRecordingBanner: async (): Promise<boolean> => {
    return ipcRenderer.invoke(ClipboardIPCChannels.GET_HIDE_SCREEN_RECORDING_BANNER);
  },

  setHideScreenRecordingBanner: async (hide: boolean): Promise<boolean> => {
    return ipcRenderer.invoke(ClipboardIPCChannels.SET_HIDE_SCREEN_RECORDING_BANNER, hide);
  },

  // Cursor status indicator - shows dot next to cursor during recording/transcribing.
  getCursorStatusEnabled: async (): Promise<boolean> => {
    return ipcRenderer.invoke(ClipboardIPCChannels.GET_CURSOR_STATUS_ENABLED);
  },

  setCursorStatusEnabled: async (enabled: boolean): Promise<boolean> => {
    return ipcRenderer.invoke(ClipboardIPCChannels.SET_CURSOR_STATUS_ENABLED, enabled);
  },

  // Hide status labels (show only colored dots).
  getHideStatusLabels: async (): Promise<boolean> => {
    return ipcRenderer.invoke('clipboard:getHideStatusLabels');
  },

  setHideStatusLabels: async (hide: boolean): Promise<boolean> => {
    return ipcRenderer.invoke('clipboard:setHideStatusLabels', hide);
  },
  
  // Show in Dock and Cmd+Tab.
  getShowInDock: async (): Promise<boolean> => {
    return ipcRenderer.invoke('clipboard:getShowInDock');
  },
  
  setShowInDock: async (show: boolean): Promise<boolean> => {
    return ipcRenderer.invoke('clipboard:setShowInDock', show);
  },

  // Launch at login.
  getLaunchAtLogin: async (): Promise<boolean> => {
    return ipcRenderer.invoke('clipboard:getLaunchAtLogin');
  },

  setLaunchAtLogin: async (enabled: boolean): Promise<{ success: boolean; enabled: boolean }> => {
    return ipcRenderer.invoke('clipboard:setLaunchAtLogin', enabled);
  },

  // Sounds enabled (master toggle for all sounds).
  getSoundsEnabled: async (): Promise<boolean> => {
    return ipcRenderer.invoke('clipboard:getSoundsEnabled');
  },

  setSoundsEnabled: async (enabled: boolean): Promise<boolean> => {
    return ipcRenderer.invoke('clipboard:setSoundsEnabled', enabled);
  },

  // Tasks tab (experimental feature).
  getTasksTabEnabled: async (): Promise<boolean> => {
    return ipcRenderer.invoke('clipboard:getTasksTabEnabled');
  },

  setTasksTabEnabled: async (enabled: boolean): Promise<boolean> => {
    return ipcRenderer.invoke('clipboard:setTasksTabEnabled', enabled);
  },

  onTasksTabToggled: (callback: (enabled: boolean) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, enabled: boolean) => {
      callback(enabled);
    };
    ipcRenderer.on('clipboard:tasksTabToggled', handler);
    return () => {
      ipcRenderer.removeListener('clipboard:tasksTabToggled', handler);
    };
  },

  // Word substitutions - correction pairs for transcription.
  getWordSubstitutions: async (): Promise<Array<{ from: string; to: string }>> => {
    return ipcRenderer.invoke('clipboard:getWordSubstitutions');
  },

  setWordSubstitutions: async (substitutions: Array<{ from: string; to: string }>): Promise<boolean> => {
    return ipcRenderer.invoke('clipboard:setWordSubstitutions', substitutions);
  },

  // Data retention - how long to keep clipboard history.
  getDataRetentionDays: async (): Promise<number> => {
    return ipcRenderer.invoke('clipboard:getDataRetentionDays');
  },

  setDataRetentionDays: async (days: number): Promise<boolean> => {
    return ipcRenderer.invoke('clipboard:setDataRetentionDays', days);
  },
};

const permissionsAPI: PermissionsAPI = {
  check: async (): Promise<{ accessibilityGranted: boolean }> => {
    return ipcRenderer.invoke('permissions:check');
  },

  onStatusChanged: (callback: (status: { accessibilityGranted: boolean }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: { accessibilityGranted: boolean }) => {
      callback(status);
    };
    ipcRenderer.on('permissions-status', handler);
    return () => {
      ipcRenderer.removeListener('permissions-status', handler);
    };
  },

  onRevoked: (callback: () => void): (() => void) => {
    const handler = () => {
      callback();
    };
    ipcRenderer.on('permissions-revoked', handler);
    return () => {
      ipcRenderer.removeListener('permissions-revoked', handler);
    };
  },
};

// ==========================================================================
// Onboarding API - First-run wizard functionality
// ==========================================================================

const onboardingAPI = {
  // Get current permission status for all required permissions.
  getPermissionStatus: async (): Promise<PermissionStatus> => {
    return ipcRenderer.invoke(OnboardingIPCChannels.GET_PERMISSION_STATUS);
  },

  // Request microphone permission - shows system dialog if not determined.
  requestMicrophone: async (): Promise<boolean> => {
    return ipcRenderer.invoke(OnboardingIPCChannels.REQUEST_MICROPHONE);
  },

  // Open System Settings to Accessibility pane.
  openAccessibilitySettings: async (): Promise<boolean> => {
    return ipcRenderer.invoke(OnboardingIPCChannels.OPEN_ACCESSIBILITY_SETTINGS);
  },

  // Open System Settings to Screen Recording pane.
  openScreenRecordingSettings: async (): Promise<boolean> => {
    return ipcRenderer.invoke(OnboardingIPCChannels.OPEN_SCREEN_RECORDING_SETTINGS);
  },

  // Trigger screen capture to add app to permissions list (saves user from clicking "+").
  triggerScreenRecordingPrompt: async (): Promise<boolean> => {
    return ipcRenderer.invoke(OnboardingIPCChannels.TRIGGER_SCREEN_RECORDING_PROMPT);
  },

  // Get current onboarding state (complete, step, permissions, model).
  getState: async (): Promise<OnboardingState> => {
    return ipcRenderer.invoke(OnboardingIPCChannels.GET_ONBOARDING_STATE);
  },

  // Update current onboarding step (for resume capability).
  setStep: async (step: number): Promise<boolean> => {
    return ipcRenderer.invoke(OnboardingIPCChannels.SET_ONBOARDING_STEP, step);
  },

  // Mark onboarding as complete and open main window.
  complete: async (): Promise<boolean> => {
    return ipcRenderer.invoke(OnboardingIPCChannels.COMPLETE_ONBOARDING);
  },

  // Skip onboarding (set up later).
  skip: async (): Promise<boolean> => {
    return ipcRenderer.invoke(OnboardingIPCChannels.SKIP_ONBOARDING);
  },

  // Reset onboarding state - clears completion and shows wizard from start.
  // Useful for testing and development.
  reset: async (): Promise<boolean> => {
    return ipcRenderer.invoke(OnboardingIPCChannels.RESET_ONBOARDING);
  },

  // Check if model is downloaded.
  checkModelStatus: async (): Promise<{ downloaded: boolean }> => {
    return ipcRenderer.invoke(OnboardingIPCChannels.CHECK_MODEL_STATUS);
  },

  // Expand the window for the tutorial phase.
  expandWindow: async (): Promise<void> => {
    return ipcRenderer.invoke(OnboardingIPCChannels.EXPAND_WINDOW);
  },

  // Set a tutorial hint to display next to the cursor dot.
  // Used during onboarding to guide users through the tutorial.
  setTutorialHint: (hint: string | null): void => {
    ipcRenderer.send('onboarding:set-tutorial-hint', hint);
  },
};

type OnboardingAPI = typeof onboardingAPI;

// ==========================================================================
// Updater API - In-app update notifications (Cursor-style)
// ==========================================================================

type UpdateInfo = { version: string; releaseNotes?: string };

const updaterAPI = {
  getVersion: (): string => {
    return ipcRenderer.sendSync('app:getVersion');
  },

  getStatus: async (): Promise<{ status: 'available' | 'downloading' | 'ready'; version: string } | null> => {
    return ipcRenderer.invoke('updater:getStatus');
  },

  checkForUpdates: async (): Promise<void> => {
    return ipcRenderer.invoke(UpdaterIPCChannels.CHECK_FOR_UPDATES);
  },

  downloadUpdate: async (): Promise<void> => {
    return ipcRenderer.invoke(UpdaterIPCChannels.DOWNLOAD_UPDATE);
  },

  installUpdate: async (): Promise<void> => {
    return ipcRenderer.invoke(UpdaterIPCChannels.INSTALL_UPDATE);
  },

  dismissUpdate: async (): Promise<void> => {
    return ipcRenderer.invoke(UpdaterIPCChannels.DISMISS_UPDATE);
  },

  onCheckingForUpdate: (callback: () => void): (() => void) => {
    const handler = () => callback();
    ipcRenderer.on(UpdaterIPCChannels.CHECKING_FOR_UPDATE, handler);
    return () => ipcRenderer.removeListener(UpdaterIPCChannels.CHECKING_FOR_UPDATE, handler);
  },

  onUpdateAvailable: (callback: (info: UpdateInfo) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, info: UpdateInfo) => callback(info);
    ipcRenderer.on(UpdaterIPCChannels.UPDATE_AVAILABLE, handler);
    return () => ipcRenderer.removeListener(UpdaterIPCChannels.UPDATE_AVAILABLE, handler);
  },

  onUpdateNotAvailable: (callback: () => void): (() => void) => {
    const handler = () => callback();
    ipcRenderer.on(UpdaterIPCChannels.UPDATE_NOT_AVAILABLE, handler);
    return () => ipcRenderer.removeListener(UpdaterIPCChannels.UPDATE_NOT_AVAILABLE, handler);
  },

  onDownloadProgress: (callback: (percent: number) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, percent: number) => callback(percent);
    ipcRenderer.on(UpdaterIPCChannels.DOWNLOAD_PROGRESS, handler);
    return () => ipcRenderer.removeListener(UpdaterIPCChannels.DOWNLOAD_PROGRESS, handler);
  },

  onUpdateDownloaded: (callback: (info: UpdateInfo) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, info: UpdateInfo) => callback(info);
    ipcRenderer.on(UpdaterIPCChannels.UPDATE_DOWNLOADED, handler);
    return () => ipcRenderer.removeListener(UpdaterIPCChannels.UPDATE_DOWNLOADED, handler);
  },

  onError: (callback: (error: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, error: string) => callback(error);
    ipcRenderer.on(UpdaterIPCChannels.UPDATE_ERROR, handler);
    return () => ipcRenderer.removeListener(UpdaterIPCChannels.UPDATE_ERROR, handler);
  },
};

type UpdaterAPI = typeof updaterAPI;

// ==========================================================================
// Todo API - Bidirectional sync with Supabase for iOS todos
// ==========================================================================

const todoAPI = {
  // Check if user is authenticated for sync.
  isAuthenticated: async (): Promise<boolean> => {
    return ipcRenderer.invoke('todo:isAuthenticated');
  },

  // Get all cached todos (call syncTodos first for fresh data).
  getTodos: async (): Promise<Todo[]> => {
    return ipcRenderer.invoke(TodoIPCChannels.GET_TODOS);
  },

  // Fetch todos from Supabase and update cache.
  syncTodos: async (): Promise<Todo[]> => {
    return ipcRenderer.invoke(TodoIPCChannels.SYNC_TODOS);
  },

  // Create a new todo.
  createTodo: async (text: string): Promise<Todo | null> => {
    return ipcRenderer.invoke(TodoIPCChannels.CREATE_TODO, text);
  },

  // Update a todo's text.
  updateTodo: async (id: string, text: string): Promise<Todo | null> => {
    return ipcRenderer.invoke(TodoIPCChannels.UPDATE_TODO, id, text);
  },

  // Toggle a todo's completed status.
  toggleTodo: async (id: string): Promise<Todo | null> => {
    return ipcRenderer.invoke(TodoIPCChannels.TOGGLE_TODO, id);
  },

  // Delete a single todo.
  deleteTodo: async (id: string): Promise<boolean> => {
    return ipcRenderer.invoke(TodoIPCChannels.DELETE_TODO, id);
  },

  // Delete multiple todos.
  deleteTodos: async (ids: string[]): Promise<boolean> => {
    return ipcRenderer.invoke(TodoIPCChannels.DELETE_TODOS, ids);
  },

  // Mark multiple todos as complete.
  completeTodos: async (ids: string[]): Promise<boolean> => {
    return ipcRenderer.invoke(TodoIPCChannels.COMPLETE_TODOS, ids);
  },

  // Get the todo hotkey.
  getHotkey: async (): Promise<string> => {
    return ipcRenderer.invoke(TodoIPCChannels.GET_TODO_HOTKEY);
  },

  // Set the todo hotkey.
  setHotkey: async (hotkey: string): Promise<boolean> => {
    return ipcRenderer.invoke(TodoIPCChannels.SET_TODO_HOTKEY, hotkey);
  },

  // Listen for todos changed events (from sync or other windows).
  onTodosChanged: (callback: (todos: Todo[]) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, todos: Todo[]) => {
      callback(todos);
    };
    ipcRenderer.on(TodoIPCChannels.TODOS_CHANGED, handler);
    return () => {
      ipcRenderer.removeListener(TodoIPCChannels.TODOS_CHANGED, handler);
    };
  },

  // Listen for show todos event (triggered by hotkey).
  onShowTodos: (callback: () => void): (() => void) => {
    const handler = () => {
      callback();
    };
    ipcRenderer.on(TodoIPCChannels.SHOW_TODOS, handler);
    return () => {
      ipcRenderer.removeListener(TodoIPCChannels.SHOW_TODOS, handler);
    };
  },

  onTodoAdded: (callback: (todo: Todo) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, todo: Todo) => {
      callback(todo);
    };
    ipcRenderer.on(TodoIPCChannels.TODO_ADDED, handler);
    return () => {
      ipcRenderer.removeListener(TodoIPCChannels.TODO_ADDED, handler);
    };
  },

  onTodoUpdated: (callback: (todo: Todo) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, todo: Todo) => {
      callback(todo);
    };
    ipcRenderer.on(TodoIPCChannels.TODO_UPDATED, handler);
    return () => {
      ipcRenderer.removeListener(TodoIPCChannels.TODO_UPDATED, handler);
    };
  },

  onTodoDeleted: (callback: (id: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, id: string) => {
      callback(id);
    };
    ipcRenderer.on(TodoIPCChannels.TODO_DELETED, handler);
    return () => {
      ipcRenderer.removeListener(TodoIPCChannels.TODO_DELETED, handler);
    };
  },
};

type TodoAPI = typeof todoAPI;

// =============================================================================
// Auth API - Password authentication via main process
// =============================================================================

const authAPI = {
  // Sign up with email and password.
  signUp: (email: string, password: string) =>
    ipcRenderer.invoke('auth:signUp', email, password),

  // Sign in with email and password.
  signInWithPassword: (email: string, password: string) => 
    ipcRenderer.invoke('auth:signInWithPassword', email, password),
  
  // Clear session storage before new login (prevents session bleed from aliases).
  prepareForNewLogin: () =>
    ipcRenderer.invoke('auth:prepareForNewLogin'),

  // Request OTP code via email.
  requestOtp: (email: string) =>
    ipcRenderer.invoke('auth:requestOtp', email),
  
  // Verify OTP code and sign in.
  verifyOtp: (email: string, token: string) => 
    ipcRenderer.invoke('auth:verifyOtp', email, token),
  
  // Send password reset email.
  resetPasswordForEmail: (email: string) => 
    ipcRenderer.invoke('auth:resetPasswordForEmail', email),
  
  // Update password (after clicking reset link).
  updatePassword: (newPassword: string) =>
    ipcRenderer.invoke('auth:updatePassword', newPassword),

  // Update user's full name.
  updateFullName: (fullName: string) =>
    ipcRenderer.invoke('auth:updateFullName', fullName),

  // Set session from recovery token in URL.
  setSessionFromUrl: (accessToken: string, refreshToken: string) =>
    ipcRenderer.invoke('auth:setSessionFromUrl', accessToken, refreshToken),
  
  // Sign out.
  signOut: () => ipcRenderer.invoke('auth:signOut'),
  
  // Get current session.
  getSession: () => ipcRenderer.invoke('auth:getSession'),

  // Check if user is super admin.
  isSuperAdmin: (): Promise<boolean> => ipcRenderer.invoke('auth:isSuperAdmin'),

  // Delete account permanently.
  deleteAccount: () => ipcRenderer.invoke('auth:deleteAccount'),

  // Auth state simulator (dev only) - for testing different auth states
  simulateState: (
    state: 'NEW_USER' | 'RETURNING_VALID' | 'RETURNING_EXPIRED' | 'OFFLINE_MODE' | 'TOKEN_REVOKED' | 'SIGNED_OUT',
    options?: { tier?: 'free' | 'pro' }
  ): Promise<{ success: boolean; message: string }> =>
    ipcRenderer.invoke('auth:simulateState', state, options),

  resetSimulator: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('auth:resetSimulator'),

  getSimulatorState: (): Promise<{ offline: boolean; revoked: boolean }> =>
    ipcRenderer.invoke('auth:getSimulatorState'),
};

type AuthAPI = typeof authAPI;

// =============================================================================
// Shared Clipboard API - Shared clipboard for team collaboration
// =============================================================================

const sharedClipboardAPI = {
  // Query team items with optional filters.
  queryItems: async (options?: SharedClipboardQueryOptions): Promise<SharedClipboardItem[]> => {
    return ipcRenderer.invoke(SharedClipboardIPCChannels.QUERY_TEAM_ITEMS, options);
  },

  // Get a single team item by ID.
  getItem: async (id: string): Promise<SharedClipboardItem | null> => {
    return ipcRenderer.invoke(SharedClipboardIPCChannels.GET_TEAM_ITEM, id);
  },

  // Share a local clipboard item to the team.
  shareToTeam: async (localItemId: number): Promise<SharedClipboardItem | null> => {
    return ipcRenderer.invoke(SharedClipboardIPCChannels.SHARE_TO_TEAM, localItemId);
  },

  // Share a stack of local items to the team.
  shareStackToTeam: async (localItemIds: number[]): Promise<string | null> => {
    return ipcRenderer.invoke(SharedClipboardIPCChannels.SHARE_STACK_TO_TEAM, localItemIds);
  },

  // Delete a team item (only owner can delete).
  deleteItem: async (id: string): Promise<boolean> => {
    return ipcRenderer.invoke(SharedClipboardIPCChannels.DELETE_TEAM_ITEM, id);
  },

  // Update stack ID for team items (move between stacks).
  updateStackId: async (itemIds: string[], stackId: string | null): Promise<boolean> => {
    return ipcRenderer.invoke(SharedClipboardIPCChannels.UPDATE_TEAM_STACK_ID, itemIds, stackId);
  },

  // Copy a team item to personal clipboard.
  copyToPersonal: async (teamItemId: string): Promise<number | null> => {
    return ipcRenderer.invoke(SharedClipboardIPCChannels.COPY_TO_PERSONAL, teamItemId);
  },

  // Copy a team stack to personal clipboard.
  copyStackToPersonal: async (teamStackId: string): Promise<number[]> => {
    return ipcRenderer.invoke(SharedClipboardIPCChannels.COPY_STACK_TO_PERSONAL, teamStackId);
  },

  // Get all team stacks with summary info.
  getStacks: async (): Promise<SharedStackInfo[]> => {
    return ipcRenderer.invoke(SharedClipboardIPCChannels.GET_TEAM_STACKS);
  },

  // Listen for team item added events.
  onTeamItemAdded: (callback: (item: SharedClipboardItem) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, item: SharedClipboardItem) => {
      callback(item);
    };
    ipcRenderer.on(SharedClipboardIPCChannels.TEAM_ITEM_ADDED, handler);
    return () => {
      ipcRenderer.removeListener(SharedClipboardIPCChannels.TEAM_ITEM_ADDED, handler);
    };
  },

  // Listen for team item deleted events.
  onTeamItemDeleted: (callback: (id: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, id: string) => {
      callback(id);
    };
    ipcRenderer.on(SharedClipboardIPCChannels.TEAM_ITEM_DELETED, handler);
    return () => {
      ipcRenderer.removeListener(SharedClipboardIPCChannels.TEAM_ITEM_DELETED, handler);
    };
  },

  // Listen for team item updated events (e.g., stack changes).
  onTeamItemUpdated: (callback: (item: SharedClipboardItem) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, item: SharedClipboardItem) => {
      callback(item);
    };
    ipcRenderer.on(SharedClipboardIPCChannels.TEAM_ITEM_UPDATED, handler);
    return () => {
      ipcRenderer.removeListener(SharedClipboardIPCChannels.TEAM_ITEM_UPDATED, handler);
    };
  },

  // =========================================================================
  // Team Membership
  // =========================================================================

  // Get all team members (people you added + people who added you).
  getTeamMembers: async (): Promise<TeamMember[]> => {
    return ipcRenderer.invoke(SharedClipboardIPCChannels.GET_TEAM_MEMBERS);
  },

  // Add a team member by email.
  addTeamMember: async (email: string): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke(SharedClipboardIPCChannels.ADD_TEAM_MEMBER, email);
  },

  // Remove a team member (can remove someone you added, or remove yourself).
  removeTeamMember: async (membershipId: string): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke(SharedClipboardIPCChannels.REMOVE_TEAM_MEMBER, membershipId);
  },

  // Check if the user has any teammates.
  hasTeammates: async (): Promise<boolean> => {
    return ipcRenderer.invoke(SharedClipboardIPCChannels.HAS_TEAMMATES);
  },
};

type SharedClipboardAPI = typeof sharedClipboardAPI;

// =============================================================================
// Social API - DMs, Feedback, Contacts, and Hot Mic
// =============================================================================

const socialAPI = {
  // =========================================================================
  // DM Operations
  // =========================================================================
  
  // Send a DM with a clipboard item.
  sendDM: async (recipientUserId: string, localItemId: number): Promise<SocialMessage | null> => {
    return ipcRenderer.invoke(SocialIPCChannels.SEND_DM, recipientUserId, localItemId);
  },
  
  // Send a text-only DM (for replies).
  sendTextDM: async (recipientUserId: string, text: string, parentMessageId?: string): Promise<SocialMessage | null> => {
    return ipcRenderer.invoke(SocialIPCChannels.SEND_TEXT_DM, recipientUserId, text, parentMessageId);
  },
  
  // Send an image reply (for feedback with pasted images).
  sendImageReply: async (recipientUserId: string, imageBase64: string, text?: string, parentMessageId?: string): Promise<SocialMessage | null> => {
    return ipcRenderer.invoke(SocialIPCChannels.SEND_IMAGE_REPLY, recipientUserId, imageBase64, text, parentMessageId);
  },
  
  // Get all DM conversations.
  getConversations: async (): Promise<DMConversation[]> => {
    return ipcRenderer.invoke(SocialIPCChannels.GET_CONVERSATIONS);
  },
  
  // Get all DMs with a specific user.
  getDMsWithUser: async (otherUserId: string): Promise<SocialMessage[]> => {
    return ipcRenderer.invoke(SocialIPCChannels.GET_DMS_WITH_USER, otherUserId);
  },
  
  // Mark a message as read.
  markAsRead: async (messageId: string): Promise<boolean> => {
    return ipcRenderer.invoke(SocialIPCChannels.MARK_AS_READ, messageId);
  },

  // Mark multiple messages as read in a single batch.
  markAsReadBatch: async (messageIds: string[]): Promise<boolean> => {
    return ipcRenderer.invoke(SocialIPCChannels.MARK_AS_READ_BATCH, messageIds);
  },

  // Check if there are unread messages.
  hasUnread: async (): Promise<boolean> => {
    return ipcRenderer.invoke(SocialIPCChannels.HAS_UNREAD);
  },
  
  // Check if there are unread feedback messages.
  hasUnreadFeedback: async (): Promise<boolean> => {
    return ipcRenderer.invoke(SocialIPCChannels.HAS_UNREAD_FEEDBACK);
  },

  // Mark all feedback messages as read.
  markAllFeedbackAsRead: async (): Promise<boolean> => {
    return ipcRenderer.invoke(SocialIPCChannels.MARK_ALL_FEEDBACK_AS_READ);
  },

  // =========================================================================
  // Feedback Operations
  // =========================================================================
  
  // Submit feedback (send to admin).
  submitFeedback: async (localItemId: number): Promise<SocialMessage | null> => {
    return ipcRenderer.invoke(SocialIPCChannels.SUBMIT_FEEDBACK, localItemId);
  },
  
  // Submit text feedback (for diagnostics, etc.).
  submitTextFeedback: async (text: string): Promise<SocialMessage | null> => {
    return ipcRenderer.invoke(SocialIPCChannels.SUBMIT_TEXT_FEEDBACK, text);
  },
  
  // Submit image feedback with optional caption and source app name.
  submitImageFeedback: async (imageBase64: string, caption?: string, sourceAppName?: string): Promise<SocialMessage | null> => {
    return ipcRenderer.invoke(SocialIPCChannels.SUBMIT_IMAGE_FEEDBACK, imageBase64, caption, sourceAppName);
  },
  
  // Get current user's submitted feedback.
  getMyFeedback: async (): Promise<SocialMessage[]> => {
    return ipcRenderer.invoke(SocialIPCChannels.GET_MY_FEEDBACK);
  },
  
  // Get all feedback (admin only).
  getAllFeedback: async (): Promise<SocialMessage[]> => {
    return ipcRenderer.invoke(SocialIPCChannels.GET_ALL_FEEDBACK);
  },
  
  // Get replies to a feedback item.
  getFeedbackReplies: async (feedbackId: string): Promise<SocialMessage[]> => {
    return ipcRenderer.invoke(SocialIPCChannels.GET_FEEDBACK_REPLIES, feedbackId);
  },
  
  // Update feedback status.
  updateFeedbackStatus: async (feedbackId: string, status: 'open' | 'resolved' | 'archived'): Promise<boolean> => {
    return ipcRenderer.invoke(SocialIPCChannels.UPDATE_FEEDBACK_STATUS, feedbackId, status);
  },
  
  // Get activity log for a feedback item.
  getActivityLog: async (feedbackId: string): Promise<ActivityLogEntry[]> => {
    return ipcRenderer.invoke(SocialIPCChannels.GET_ACTIVITY_LOG, feedbackId);
  },
  
  // =========================================================================
  // Contact Operations
  // =========================================================================
  
  // Get all contacts.
  getContacts: async (): Promise<SocialContact[]> => {
    return ipcRenderer.invoke(SocialIPCChannels.GET_CONTACTS);
  },
  
  // Add a friend by email.
  addFriend: async (email: string): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke(SocialIPCChannels.ADD_FRIEND, email);
  },
  
  // Search contacts by name or email.
  searchContacts: async (query: string): Promise<SocialContact[]> => {
    return ipcRenderer.invoke(SocialIPCChannels.SEARCH_CONTACTS, query);
  },
  
  // Get pending invites (friend requests sent to me).
  getPendingInvites: async (): Promise<SocialContact[]> => {
    return ipcRenderer.invoke(SocialIPCChannels.GET_PENDING_INVITES);
  },
  
  // Respond to a pending invite (accept or reject).
  respondToInvite: async (contactId: string, accept: boolean): Promise<boolean> => {
    return ipcRenderer.invoke(SocialIPCChannels.RESPOND_TO_INVITE, contactId, accept);
  },
  
  // Remove a friend (unfriend/leave).
  removeFriend: async (contactId: string): Promise<boolean> => {
    return ipcRenderer.invoke(SocialIPCChannels.REMOVE_FRIEND, contactId);
  },
  
  // =========================================================================
  // Hot Mic
  // =========================================================================
  
  // Get hot mic enabled status.
  getHotMic: async (): Promise<boolean> => {
    return ipcRenderer.invoke(SocialIPCChannels.GET_HOT_MIC);
  },
  
  // Set hot mic enabled status.
  setHotMic: async (enabled: boolean): Promise<boolean> => {
    return ipcRenderer.invoke(SocialIPCChannels.SET_HOT_MIC, enabled);
  },
  
  // =========================================================================
  // Admin Check
  // =========================================================================
  
  // Check if current user is admin.
  isAdmin: async (): Promise<boolean> => {
    return ipcRenderer.invoke(SocialIPCChannels.IS_ADMIN);
  },
  
  // =========================================================================
  // Events
  // =========================================================================
  
  // Listen for new message received (for hot mic).
  onMessageReceived: (callback: (message: SocialMessage) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, message: SocialMessage) => {
      callback(message);
    };
    ipcRenderer.on(SocialIPCChannels.MESSAGE_RECEIVED, handler);
    return () => {
      ipcRenderer.removeListener(SocialIPCChannels.MESSAGE_RECEIVED, handler);
    };
  },
};

type SocialAPI = typeof socialAPI;

// =============================================================================
// Quota API - Local usage tracking for free users
// =============================================================================

const quotaAPI = {
  // Get current quota status for all features.
  getQuotas: () => ipcRenderer.invoke('quota:getQuotas'),

  // Check if a specific quota is exhausted.
  checkQuota: (feature: 'priorityMic' | 'autoStack' | 'textImprove') =>
    ipcRenderer.invoke('quota:checkQuota', feature),

  // Get formatted usage strings for display.
  getFormattedUsage: () => ipcRenderer.invoke('quota:getFormattedUsage'),

  // Get the quota reset date (first of next month).
  getResetDate: () => ipcRenderer.invoke('quota:getResetDate'),

  // Get days until quota reset.
  getDaysUntilReset: () => ipcRenderer.invoke('quota:getDaysUntilReset') as Promise<number>,

  // Get quota limits for the current tier.
  getLimits: () => ipcRenderer.invoke('quota:getLimits') as Promise<{
    priorityMicMinutes: number;
    autoStackSessions: number;
    textImprovementWords: number;
    verbalCommands: number;
  }>,

  // Manually refresh tier from server (debugging and edge cases).
  refreshTier: () => ipcRenderer.invoke('quota:refreshTier') as Promise<{ tier: 'free' | 'pro'; error: string | null }>,

  // Listen for tier changes (e.g., after Stripe checkout upgrades user to pro).
  onTierChanged: (callback: (tier: 'free' | 'pro') => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, tier: 'free' | 'pro') => {
      callback(tier);
    };
    ipcRenderer.on('tier:changed', handler);
    return () => {
      ipcRenderer.removeListener('tier:changed', handler);
    };
  },

  // Listen for quota exhausted events.
  onQuotaExhausted: (callback: (data: { feature: 'priorityMic' | 'autoStack' | 'textImprove'; used: number; limit: number; featureName: string; limitDisplay: string }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { feature: 'priorityMic' | 'autoStack' | 'textImprove'; used: number; limit: number; featureName: string; limitDisplay: string }) => {
      callback(data);
    };
    ipcRenderer.on('quota:exhausted', handler);
    return () => {
      ipcRenderer.removeListener('quota:exhausted', handler);
    };
  },

  // Listen for quota changes (updates in real-time after usage).
  onQuotaChanged: (callback: (data: { priorityMic: string; autoStack: string; textImprove: string; verbalCommands: string }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { priorityMic: string; autoStack: string; textImprove: string; verbalCommands: string }) => {
      callback(data);
    };
    ipcRenderer.on('quota:changed', handler);
    return () => {
      ipcRenderer.removeListener('quota:changed', handler);
    };
  },
};

type QuotaAPI = typeof quotaAPI;

// =============================================================================
// Shell API - Open external URLs in default browser
// =============================================================================

const shellAPI = {
  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke('shell:openExternal', url),
  showItemInFolder: (fullPath: string): Promise<void> =>
    ipcRenderer.invoke('shell:showItemInFolder', fullPath),
};

type ShellAPI = typeof shellAPI;

const diagnosticsAPI: DiagnosticsAPI = {
  getDiagnostics: async (): Promise<unknown> => {
    return ipcRenderer.invoke(DiagnosticsIPCChannels.GET_DIAGNOSTICS);
  },
  getDiagnosticsMarkdown: async (): Promise<string> => {
    return ipcRenderer.invoke(DiagnosticsIPCChannels.GET_DIAGNOSTICS_MARKDOWN);
  },
};

// =============================================================================
// Commands API - Portable commands management
// =============================================================================

const CommandsIPCChannels = {
  // Legacy single-directory support
  GET_DIRECTORY: 'commands:getDirectory',
  SET_DIRECTORY: 'commands:setDirectory',
  BROWSE_DIRECTORY: 'commands:browseDirectory',
  GET_COMMANDS: 'commands:getCommands',
  REFRESH_COMMANDS: 'commands:refreshCommands',
  GET_COMMAND_CONTENT: 'commands:getCommandContent',
  COMMANDS_CHANGED: 'commands:commandsChanged',
  DIRECTORY_CHANGED: 'commands:directoryChanged',
  // Multi-directory management
  INITIALIZE: 'commands:initialize',
  GET_WATCHED_DIRS: 'commands:getWatchedDirs',
  ADD_WATCHED_DIR: 'commands:addWatchedDir',
  REMOVE_WATCHED_DIR: 'commands:removeWatchedDir',
  GET_DEFAULT_DIRECTORY: 'commands:getDefaultDirectory',
  CREATE_DEFAULT_DIRECTORY: 'commands:createDefaultDirectory',
  // CRUD operations
  GET_COMMAND_BY_PATH: 'commands:getCommandByPath',
  SAVE_COMMAND: 'commands:saveCommand',
  CREATE_COMMAND: 'commands:createCommand',
  DELETE_COMMAND: 'commands:deleteCommand',
  RENAME_COMMAND: 'commands:renameCommand',
  // Mobile sync operations
  SET_MOBILE_SYNC: 'commands:setMobileSync',
  GET_MOBILE_SYNC_STATUS: 'commands:getMobileSyncStatus',
  SYNC_TO_MOBILE: 'commands:syncToMobile',
  GET_REMOTE_COMMAND_COUNT: 'commands:getRemoteCommandCount',
} as const;

type PortableCommandInfo = {
  name: string;
  displayName: string;
  filePath: string;
};

type CommandsWatchedDir = {
  path: string;
  enabled: boolean;
  mobileSyncEnabled: boolean;
};

type CommandSyncResult = {
  success: boolean;
  uploaded: number;
  updated: number;
  deleted: number;
  errors: string[];
};

type MobileSyncStatus = {
  ready: boolean;
  lastSyncAt: number | null;
};

type CommandWithContent = {
  name: string;
  displayName: string;
  filePath: string;
  lastModified: number;
  content: string;
};

const commandsAPI = {
  // Get the currently configured commands directory.
  getDirectory: async (): Promise<string | null> => {
    return ipcRenderer.invoke(CommandsIPCChannels.GET_DIRECTORY);
  },

  // Set the commands directory path.
  setDirectory: async (directoryPath: string | null): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke(CommandsIPCChannels.SET_DIRECTORY, directoryPath);
  },

  // Open a file dialog to select a commands directory.
  browseDirectory: async (): Promise<string | null> => {
    return ipcRenderer.invoke(CommandsIPCChannels.BROWSE_DIRECTORY);
  },

  // Get all available commands.
  getCommands: async (): Promise<PortableCommandInfo[]> => {
    return ipcRenderer.invoke(CommandsIPCChannels.GET_COMMANDS);
  },

  // Refresh the commands list by rescanning the directory.
  refreshCommands: async (): Promise<PortableCommandInfo[]> => {
    return ipcRenderer.invoke(CommandsIPCChannels.REFRESH_COMMANDS);
  },

  // Get the content of a specific command.
  getCommandContent: async (commandName: string): Promise<{ content: string; filePath: string } | null> => {
    return ipcRenderer.invoke(CommandsIPCChannels.GET_COMMAND_CONTENT, commandName);
  },

  // Listen for commands changed events.
  onCommandsChanged: (callback: (commands: PortableCommandInfo[]) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, commands: PortableCommandInfo[]) => {
      callback(commands);
    };
    ipcRenderer.on(CommandsIPCChannels.COMMANDS_CHANGED, handler);
    return () => {
      ipcRenderer.removeListener(CommandsIPCChannels.COMMANDS_CHANGED, handler);
    };
  },

  // Listen for directory changed events.
  onDirectoryChanged: (callback: (directoryPath: string | null) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, directoryPath: string | null) => {
      callback(directoryPath);
    };
    ipcRenderer.on(CommandsIPCChannels.DIRECTORY_CHANGED, handler);
    return () => {
      ipcRenderer.removeListener(CommandsIPCChannels.DIRECTORY_CHANGED, handler);
    };
  },

  // ==========================================================================
  // Multi-Directory Management
  // ==========================================================================

  // Initialize the commands manager (scan all watched directories).
  initialize: async (): Promise<void> => {
    return ipcRenderer.invoke(CommandsIPCChannels.INITIALIZE);
  },

  // Get all watched directories.
  getWatchedDirs: async (): Promise<CommandsWatchedDir[]> => {
    return ipcRenderer.invoke(CommandsIPCChannels.GET_WATCHED_DIRS);
  },

  // Add a directory to watch.
  addWatchedDir: async (dirPath: string): Promise<CommandsWatchedDir | null> => {
    return ipcRenderer.invoke(CommandsIPCChannels.ADD_WATCHED_DIR, dirPath);
  },

  // Remove a watched directory.
  removeWatchedDir: async (dirPath: string): Promise<boolean> => {
    return ipcRenderer.invoke(CommandsIPCChannels.REMOVE_WATCHED_DIR, dirPath);
  },

  // Get the default commands directory path.
  getDefaultDirectory: async (): Promise<string> => {
    return ipcRenderer.invoke(CommandsIPCChannels.GET_DEFAULT_DIRECTORY);
  },

  // Create and add the default commands directory.
  createDefaultDirectory: async (): Promise<string | null> => {
    return ipcRenderer.invoke(CommandsIPCChannels.CREATE_DEFAULT_DIRECTORY);
  },

  // ==========================================================================
  // CRUD Operations
  // ==========================================================================

  // Get a command by file path with full content.
  getCommandByPath: async (filePath: string): Promise<CommandWithContent | null> => {
    return ipcRenderer.invoke(CommandsIPCChannels.GET_COMMAND_BY_PATH, filePath);
  },

  // Save/update a command's content.
  saveCommand: async (filePath: string, content: string): Promise<boolean> => {
    return ipcRenderer.invoke(CommandsIPCChannels.SAVE_COMMAND, filePath, content);
  },

  // Create a new command file.
  createCommand: async (directoryPath: string, name: string, content?: string): Promise<{ path: string; name: string } | null> => {
    return ipcRenderer.invoke(CommandsIPCChannels.CREATE_COMMAND, directoryPath, name, content || '');
  },

  // Delete a command file.
  deleteCommand: async (filePath: string): Promise<boolean> => {
    return ipcRenderer.invoke(CommandsIPCChannels.DELETE_COMMAND, filePath);
  },

  // Rename a command file.
  renameCommand: async (oldFilePath: string, newName: string): Promise<string | null> => {
    return ipcRenderer.invoke(CommandsIPCChannels.RENAME_COMMAND, oldFilePath, newName);
  },

  // ==========================================================================
  // Command Launcher specific methods (Cmd+Shift+K popup)
  // ==========================================================================

  // Invoke a command by name (paste file or reference to target app).
  invokeCommand: async (commandName: string): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('commands:invoke', commandName);
  },

  // Resize the command launcher window.
  launcherResize: (height: number): void => {
    ipcRenderer.send('command-launcher:resize', height);
  },

  // Close the command launcher window.
  launcherClose: (): void => {
    ipcRenderer.send('command-launcher:close');
  },

  // Listen for reset events (when launcher is shown).
  onLauncherReset: (callback: () => void): (() => void) => {
    const handler = () => callback();
    ipcRenderer.on('command-launcher:reset', handler);
    return () => {
      ipcRenderer.removeListener('command-launcher:reset', handler);
    };
  },

  // ==========================================================================
  // Mobile Sync methods
  // ==========================================================================

  // Enable or disable mobile sync for a watched directory.
  setMobileSync: async (dirPath: string, enabled: boolean): Promise<boolean> => {
    return ipcRenderer.invoke(CommandsIPCChannels.SET_MOBILE_SYNC, dirPath, enabled);
  },

  // Get mobile sync status (ready state and last sync time).
  getMobileSyncStatus: async (): Promise<MobileSyncStatus> => {
    return ipcRenderer.invoke(CommandsIPCChannels.GET_MOBILE_SYNC_STATUS);
  },

  // Manually trigger sync to Supabase.
  syncToMobile: async (): Promise<CommandSyncResult> => {
    return ipcRenderer.invoke(CommandsIPCChannels.SYNC_TO_MOBILE);
  },

  // Get count of commands currently synced to Supabase.
  getRemoteCommandCount: async (): Promise<number> => {
    return ipcRenderer.invoke(CommandsIPCChannels.GET_REMOTE_COMMAND_COUNT);
  },
};

type CommandsAPI = typeof commandsAPI;

// Electron API for app control and debugging
const electronAPI = {
  relaunch: () => {
    ipcRenderer.send('electron:relaunch');
  },
  toggleDevTools: () => {
    ipcRenderer.send('electron:toggleDevTools');
  },
};

// Theme API for dark mode synchronization
const themeAPI = {
  getTheme: (): Promise<boolean> => ipcRenderer.invoke('theme:get'),
  setTheme: (isDark: boolean): Promise<void> => ipcRenderer.invoke('theme:set', isDark),
  onThemeChanged: (callback: (isDark: boolean) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, isDark: boolean) => callback(isDark);
    ipcRenderer.on('theme:changed', handler);
    return () => ipcRenderer.removeListener('theme:changed', handler);
  },
};

// Reading metadata (without full content)
// Path is the identity - no numeric IDs
interface ReadingMeta {
  path: string;
  title: string;
  context: string | null;
  readingTime: string | null;
  createdAt: number;
  mtime: number;
}

// Full reading with content (loaded on demand)
interface Reading extends ReadingMeta {
  content: string;
}

// Watched directory configuration
// Path is the identity - no numeric IDs
interface WatchedDir {
  path: string;
  enabled: boolean;
}

// Concepts index for story/lesson deduplication
interface ConceptsIndex {
  schema_version: number;
  description?: string;
  indexed_at: string | null;
  artifacts: Record<string, { title: string; stories: string[]; lessons: string[] }>;
  stories_used: string[];
  lessons_used: string[];
}

// Librarian API for reading collection
// File-only architecture: .librarian/ directories are the single source of truth
const librarianAPI = {
  // Get all readings (metadata only, for sidebar list)
  getReadings: (): Promise<ReadingMeta[]> => ipcRenderer.invoke('librarian:getReadings'),

  // Get a single reading with full content (by path)
  getReading: (filePath: string): Promise<Reading | null> => ipcRenderer.invoke('librarian:getReading', filePath),

  // Save reading content to disk
  saveReading: (filePath: string, content: string): Promise<boolean> => ipcRenderer.invoke('librarian:saveReading', filePath, content),

  // Delete a reading file
  deleteReading: (filePath: string): Promise<boolean> => ipcRenderer.invoke('librarian:deleteReading', filePath),

  // Get all watched directories
  getWatchedDirs: (): Promise<WatchedDir[]> => ipcRenderer.invoke('librarian:getWatchedDirs'),

  // Add a directory to watch
  addWatchedDir: (dirPath: string): Promise<WatchedDir | null> => ipcRenderer.invoke('librarian:addWatchedDir', dirPath),

  // Remove a watched directory (by path)
  removeWatchedDir: (dirPath: string): Promise<boolean> => ipcRenderer.invoke('librarian:removeWatchedDir', dirPath),

  // Browse for a directory (open folder picker)
  browseDirectory: (): Promise<string | null> => ipcRenderer.invoke('librarian:browseDirectory'),

  // Listen for new readings
  onReadingAdded: (callback: (reading: Reading) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, reading: Reading) => callback(reading);
    ipcRenderer.on('librarian:readingAdded', handler);
    return () => ipcRenderer.removeListener('librarian:readingAdded', handler);
  },

  // Listen for reading updates (content changed)
  onReadingUpdated: (callback: (reading: ReadingMeta) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, reading: ReadingMeta) => callback(reading);
    ipcRenderer.on('librarian:readingUpdated', handler);
    return () => ipcRenderer.removeListener('librarian:readingUpdated', handler);
  },

  // Listen for reading removals (file deleted)
  onReadingRemoved: (callback: (filePath: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, filePath: string) => callback(filePath);
    ipcRenderer.on('librarian:readingRemoved', handler);
    return () => ipcRenderer.removeListener('librarian:readingRemoved', handler);
  },

  // Listen for fullscreen mode requests (from URL scheme)
  onSetFullscreen: (callback: (fullscreen: boolean) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, fullscreen: boolean) => callback(fullscreen);
    ipcRenderer.on('librarian:setFullscreen', handler);
    return () => ipcRenderer.removeListener('librarian:setFullscreen', handler);
  },

  // Listen for show reading requests (auto-show on new reading, now uses path)
  onShowReading: (callback: (readingPath: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, readingPath: string) => callback(readingPath);
    ipcRenderer.on('librarian:showReading', handler);
    return () => ipcRenderer.removeListener('librarian:showReading', handler);
  },

  // Poll for pending reading AND counter state (single source of truth for resets)
  // Returns pending path, current counter, and whether a reset just happened
  pollStatus: (): Promise<{
    pendingPath: string | null;
    edits: number;
    threshold: number;
    didReset: boolean;
  }> => ipcRenderer.invoke('librarian:pollStatus'),

  // Listen for new reading available (when window already visible, shows indicator)
  onNewReadingAvailable: (callback: (readingPath: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, readingPath: string) => callback(readingPath);
    ipcRenderer.on('librarian:newReadingAvailable', handler);
    return () => ipcRenderer.removeListener('librarian:newReadingAvailable', handler);
  },

  // Listen for new reading to show immediately (when already in immersive mode)
  onShowNewReading: (callback: (readingPath: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, readingPath: string) => callback(readingPath);
    ipcRenderer.on('librarian:showNewReading', handler);
    return () => ipcRenderer.removeListener('librarian:showNewReading', handler);
  },

  // Notify main process of immersive mode changes (affects blur-to-hide behavior)
  setImmersiveMode: (immersive: boolean): void => {
    ipcRenderer.send('clipboard-history:setImmersiveMode', immersive);
  },

  // ===========================================================================
  // New Settings API (v2)
  // ===========================================================================

  // Master enable/disable toggle
  isEnabled: (): Promise<boolean> => ipcRenderer.invoke('librarian:isEnabled'),
  setEnabled: (enabled: boolean): Promise<boolean> => ipcRenderer.invoke('librarian:setEnabled', enabled),

  // Setup wizard completion
  isSetupComplete: (): Promise<boolean> => ipcRenderer.invoke('librarian:isSetupComplete'),
  setSetupComplete: (complete: boolean): Promise<void> => ipcRenderer.invoke('librarian:setSetupComplete', complete),
  createWelcomeArtifact: (dirPath: string): Promise<boolean> => ipcRenderer.invoke('librarian:createWelcomeArtifact', dirPath),

  // ===========================================================================
  // State-Enforced Mode API
  // ===========================================================================

  // State-enforced mode threshold
  getStateEnforcedThreshold: (): Promise<number> => ipcRenderer.invoke('librarian:getStateEnforcedThreshold'),
  setStateEnforcedThreshold: (threshold: number): Promise<boolean> => ipcRenderer.invoke('librarian:setStateEnforcedThreshold', threshold),

  // Rule content (job language)
  getDefaultRuleContent: (): Promise<string> => ipcRenderer.invoke('librarian:getDefaultRuleContent'),
  getCustomRuleContent: (): Promise<string | undefined> => ipcRenderer.invoke('librarian:getCustomRuleContent'),
  setCustomRuleContent: (content: string | undefined): Promise<boolean> => ipcRenderer.invoke('librarian:setCustomRuleContent', content),

  // Global state-enforced hook management
  installStateEnforcedHook: (): Promise<boolean> => ipcRenderer.invoke('librarian:installStateEnforcedHook'),
  uninstallStateEnforcedHook: (): Promise<boolean> => ipcRenderer.invoke('librarian:uninstallStateEnforcedHook'),
  isStateEnforcedHookInstalled: (): Promise<boolean> => ipcRenderer.invoke('librarian:isStateEnforcedHookInstalled'),

  // Job management
  getPendingJobCount: (): Promise<number> => ipcRenderer.invoke('librarian:getPendingJobCount'),

  // Cursor hook management
  isCursorHookInstalled: (): Promise<boolean> => ipcRenderer.invoke('librarian:isCursorHookInstalled'),
  installCursorHook: (): Promise<boolean> => ipcRenderer.invoke('librarian:installCursorHook'),
  uninstallCursorHook: (): Promise<boolean> => ipcRenderer.invoke('librarian:uninstallCursorHook'),

  // ===========================================================================
  // Discovery Frequency API
  // ===========================================================================

  // Discovery frequency (often/sometimes/rarely)
  getDiscoveryFrequency: (): Promise<string> => ipcRenderer.invoke('librarian:getDiscoveryFrequency'),
  setDiscoveryFrequency: (frequency: string): Promise<boolean> => ipcRenderer.invoke('librarian:setDiscoveryFrequency', frequency),

  // ===========================================================================
  // User Expertise API
  // ===========================================================================

  // User expertise context
  getUserExpertiseContext: (): Promise<string | undefined> => ipcRenderer.invoke('librarian:getUserExpertiseContext'),
  setUserExpertiseContext: (context: string | undefined): Promise<boolean> => ipcRenderer.invoke('librarian:setUserExpertiseContext', context),

  // ===========================================================================
  // Legacy Settings API (kept for backward compatibility)
  // ===========================================================================

  // Auto-run frequency settings (deprecated - use isEnabled/setEnabled + triggerMode)
  getAutoRunFrequency: (): Promise<string> => ipcRenderer.invoke('librarian:getAutoRunFrequency'),
  setAutoRunFrequency: (frequency: string): Promise<boolean> => ipcRenderer.invoke('librarian:setAutoRunFrequency', frequency),

  // Force re-sync CLAUDE.md with current settings (if user deleted it manually)
  resyncClaudeMd: (): Promise<boolean> => ipcRenderer.invoke('librarian:resyncClaudeMd'),

  // Get Claude Code installation status
  getClaudeCodeStatus: (): Promise<string> => ipcRenderer.invoke('librarian:getClaudeCodeStatus'),

  // Claude Code hook management
  installClaudeCodeHook: (): Promise<boolean> => ipcRenderer.invoke('librarian:installClaudeCodeHook'),
  uninstallClaudeCodeHook: (): Promise<boolean> => ipcRenderer.invoke('librarian:uninstallClaudeCodeHook'),
  isClaudeCodeHookInstalled: (): Promise<boolean> => ipcRenderer.invoke('librarian:isClaudeCodeHookInstalled'),
  initializeProjectStatus: (projectPath: string): Promise<void> => ipcRenderer.invoke('librarian:initializeProjectStatus', projectPath),

  // Get Cursor instructions text for manual copy
  getCursorInstructions: (): Promise<string> => ipcRenderer.invoke('librarian:getCursorInstructions'),

  // Configuration file management
  getConfigPaths: (): Promise<{ claudeMd: string; librarianCommand: string }> => ipcRenderer.invoke('librarian:getConfigPaths'),
  openInEditor: (filePath: string): Promise<boolean> => ipcRenderer.invoke('librarian:openInEditor', filePath),
  readConfigFile: (filePath: string): Promise<string | null> => ipcRenderer.invoke('librarian:readConfigFile', filePath),
  writeConfigFile: (filePath: string, content: string): Promise<boolean> => ipcRenderer.invoke('librarian:writeConfigFile', filePath, content),

  // Auto-show on new reading settings
  getAutoShowEnabled: (): Promise<boolean> => ipcRenderer.invoke('librarian:getAutoShowEnabled'),
  setAutoShowEnabled: (enabled: boolean): Promise<void> => ipcRenderer.invoke('librarian:setAutoShowEnabled', enabled),

  // Resume after close settings (return to last artifact vs clipboard)
  getResumeAfterClose: (): Promise<boolean> => ipcRenderer.invoke('librarian:getResumeAfterClose'),
  setResumeAfterClose: (enabled: boolean): Promise<void> => ipcRenderer.invoke('librarian:setResumeAfterClose', enabled),

  // Get Claude config file path
  getClaudeConfigPath: (): Promise<string> => ipcRenderer.invoke('librarian:getClaudeConfigPath'),

  // Content guidance customization
  getDefaultContentGuidance: (): Promise<string> => ipcRenderer.invoke('librarian:getDefaultContentGuidance'),
  getContentGuidance: (): Promise<string> => ipcRenderer.invoke('librarian:getContentGuidance'),
  getCustomContentGuidance: (): Promise<string | undefined> => ipcRenderer.invoke('librarian:getCustomContentGuidance'),
  setCustomContentGuidance: (guidance: string | undefined): Promise<boolean> => ipcRenderer.invoke('librarian:setCustomContentGuidance', guidance),
  resetContentGuidance: (): Promise<boolean> => ipcRenderer.invoke('librarian:resetContentGuidance'),

  // Auto-discovery of existing .librarian directories
  discoverLibrarianDirs: (): Promise<string[]> => ipcRenderer.invoke('librarian:discoverLibrarianDirs'),

  // Reset edit counters for all projects (for debugging/testing)
  resetAllCounters: (): Promise<boolean> => ipcRenderer.invoke('librarian:resetAllCounters'),

  // Get edit status for debugging (returns first project's status)
  getEditStatus: (): Promise<{ edits: number; threshold: number; frequency: string } | null> => ipcRenderer.invoke('librarian:getEditStatus'),

  // Custom threshold control (undefined means frequency-based)
  getCustomThreshold: (): Promise<number | undefined> => ipcRenderer.invoke('librarian:getCustomThreshold'),
  setCustomThreshold: (threshold: number | undefined): Promise<boolean> => ipcRenderer.invoke('librarian:setCustomThreshold', threshold),

  // Public sharing
  shareReading: (filePath: string): Promise<{ slug: string; url: string } | null> =>
    ipcRenderer.invoke('librarian:shareReading', filePath),
  unshareReading: (filePath: string): Promise<boolean> =>
    ipcRenderer.invoke('librarian:unshareReading', filePath),
  getShareStatus: (filePath: string): Promise<{ shared: boolean; slug?: string; url?: string } | null> =>
    ipcRenderer.invoke('librarian:getShareStatus', filePath),
  updateSharedReading: (filePath: string, content: string, title: string): Promise<boolean> =>
    ipcRenderer.invoke('librarian:updateSharedReading', filePath, content, title),
  // Mute for today
  muteForToday: (): Promise<boolean> =>
    ipcRenderer.invoke('librarian:muteForToday'),
  isMutedForToday: (): Promise<boolean> =>
    ipcRenderer.invoke('librarian:isMutedForToday'),
  unmute: (): Promise<boolean> =>
    ipcRenderer.invoke('librarian:unmute'),
  // Concepts index for story/lesson graph visualization
  getConceptsIndex: (): Promise<ConceptsIndex | null> =>
    ipcRenderer.invoke('librarian:getConceptsIndex'),
};

type LibrarianAPI = typeof librarianAPI;

// =============================================================================
// Metrics API - User-visible usage stats
// "The metrics you see are the metrics we see."
// =============================================================================

interface UserMetrics {
  transcriptions: number;
  words_transcribed: number;
  priority_mic_minutes: number;
  verbal_commands: number;
  command_launcher_uses: number;
  clipboard_items: number;
  pastes_used: number;
  stacks_created: number;
  autostacks_created: number;
  stacks_pasted: number;
  items_added_to_context: number;
  sketches_created: number;
  screenshots_taken: number;
  librarian_artifacts_created: number;
  librarian_artifacts_shared: number;
  commands_executed: number;
  commands_contributed: number;
  feedback_given: number;
}

const metricsAPI = {
  // Get current metrics for display in Settings
  getMetrics: (): Promise<UserMetrics> => ipcRenderer.invoke('metrics:getMetrics'),

  // Get metrics with sync status
  getMetricsWithStatus: (): Promise<{
    metrics: UserMetrics;
    lastSyncedAt: string | null;
    pendingSync: boolean;
  }> => ipcRenderer.invoke('metrics:getMetricsWithStatus'),

  // Force sync to Supabase
  syncToSupabase: (): Promise<boolean> => ipcRenderer.invoke('metrics:syncToSupabase'),

  // Fetch from Supabase (merge with local)
  fetchFromSupabase: (): Promise<boolean> => ipcRenderer.invoke('metrics:fetchFromSupabase'),
};

type MetricsAPI = typeof metricsAPI;

// =============================================================================
// Claude API - Claude Code integration settings
// =============================================================================

const claudeAPI = {
  // Check if screenshot permission is enabled
  isScreenshotPermissionEnabled: (): Promise<boolean> =>
    ipcRenderer.invoke('claude:isScreenshotPermissionEnabled'),

  // Enable screenshot permission
  enableScreenshotPermission: (): Promise<boolean> =>
    ipcRenderer.invoke('claude:enableScreenshotPermission'),

  // Get figures directory path for permissions
  getFiguresPath: (): Promise<string> =>
    ipcRenderer.invoke('claude:getFiguresPath'),

  // Get available permission profiles
  getAvailableProfiles: (): Promise<Array<{ id: string; name: string; description: string; permissionCount: number }>> =>
    ipcRenderer.invoke('claude:getAvailableProfiles'),

  // Get current permission status
  getPermissionStatus: (): Promise<{ currentProfile: string | null; managedPermissions: string[]; allClaudePermissions: string[] }> =>
    ipcRenderer.invoke('claude:getPermissionStatus'),

  // Apply a permission profile
  applyPermissionProfile: (profileId: string): Promise<boolean> =>
    ipcRenderer.invoke('claude:applyPermissionProfile', profileId),

  // Add individual permissions
  addPermissions: (permissions: string[]): Promise<boolean> =>
    ipcRenderer.invoke('claude:addPermissions', permissions),

  // Remove individual permissions
  removePermissions: (permissions: string[]): Promise<boolean> =>
    ipcRenderer.invoke('claude:removePermissions', permissions),

  // Clear all managed permissions
  clearManagedPermissions: (): Promise<boolean> =>
    ipcRenderer.invoke('claude:clearManagedPermissions'),

  // Read permission hooks (auto-approve Field Theory file reads)
  isReadPermissionHookInstalled: (): Promise<boolean> =>
    ipcRenderer.invoke('claude:isReadPermissionHookInstalled'),

  installReadPermissionHook: (): Promise<{ success: boolean; message: string }> =>
    ipcRenderer.invoke('claude:installReadPermissionHook'),

  uninstallReadPermissionHook: (): Promise<{ success: boolean; message: string }> =>
    ipcRenderer.invoke('claude:uninstallReadPermissionHook'),
};

type ClaudeAPI = typeof claudeAPI;

// =============================================================================
// Cursor API - Cursor IDE integration settings
// =============================================================================

const cursorAPI = {
  // Read permission hooks (auto-approve Field Theory file reads)
  isReadPermissionHookInstalled: (): Promise<boolean> =>
    ipcRenderer.invoke('cursor:isReadPermissionHookInstalled'),

  installReadPermissionHook: (): Promise<{ success: boolean; message: string }> =>
    ipcRenderer.invoke('cursor:installReadPermissionHook'),

  uninstallReadPermissionHook: (): Promise<{ success: boolean; message: string }> =>
    ipcRenderer.invoke('cursor:uninstallReadPermissionHook'),
};

type CursorAPI = typeof cursorAPI;

// =============================================================================
// Scenario Testing API - Superadmin-only testing panel
// =============================================================================

interface DevOverrides {
  tier?: 'free' | 'pro';
  quotaPercentages?: {
    priorityMic?: number;
    autoStack?: number;
    textImprove?: number;
  };
  authState?: 'logged_out' | 'offline';
}

const scenarioAPI = {
  // Check if current user is superadmin (uses REAL auth, not simulated)
  isSuperAdmin: (): Promise<boolean> =>
    ipcRenderer.invoke('scenario:isSuperAdmin'),

  // Show/hide the scenario testing panel
  showPanel: (): Promise<boolean> =>
    ipcRenderer.invoke('scenario:showPanel'),
  hidePanel: (): Promise<void> =>
    ipcRenderer.invoke('scenario:hidePanel'),

  // Get current overrides
  getOverrides: (): Promise<DevOverrides | null> =>
    ipcRenderer.invoke('scenario:getOverrides'),

  // Set individual overrides
  setTierOverride: (tier: 'free' | 'pro' | null): Promise<boolean> =>
    ipcRenderer.invoke('scenario:setTierOverride', tier),
  setQuotaOverride: (feature: 'priorityMic' | 'autoStack' | 'textImprove', percentage: number | null): Promise<boolean> =>
    ipcRenderer.invoke('scenario:setQuotaOverride', feature, percentage),
  setAuthStateOverride: (state: 'logged_out' | 'offline' | null): Promise<boolean> =>
    ipcRenderer.invoke('scenario:setAuthStateOverride', state),

  // Reset all overrides
  resetAll: (): Promise<boolean> =>
    ipcRenderer.invoke('scenario:resetAll'),

  // Check if any overrides are active
  hasActiveOverrides: (): Promise<boolean> =>
    ipcRenderer.invoke('scenario:hasActiveOverrides'),

  // Listen for override changes
  onOverridesChanged: (callback: (overrides: DevOverrides | null) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, overrides: DevOverrides | null) => callback(overrides);
    ipcRenderer.on('scenario:overridesChanged', handler);
    return () => ipcRenderer.removeListener('scenario:overridesChanged', handler);
  },
};

type ScenarioAPI = typeof scenarioAPI;

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
contextBridge.exposeInMainWorld('themeAPI', themeAPI);
contextBridge.exposeInMainWorld('librarianAPI', librarianAPI);
contextBridge.exposeInMainWorld('shellAPI', shellAPI);
contextBridge.exposeInMainWorld('diagnosticsAPI', diagnosticsAPI);
contextBridge.exposeInMainWorld('quotaAPI', quotaAPI);
contextBridge.exposeInMainWorld('audioAPI', audioAPI);
contextBridge.exposeInMainWorld('hotkeyAPI', hotkeyAPI);
contextBridge.exposeInMainWorld('transcribeAPI', transcribeAPI);
contextBridge.exposeInMainWorld('clipboardAPI', clipboardAPI);
contextBridge.exposeInMainWorld('permissionsAPI', permissionsAPI);
contextBridge.exposeInMainWorld('onboardingAPI', onboardingAPI);
contextBridge.exposeInMainWorld('updaterAPI', updaterAPI);
contextBridge.exposeInMainWorld('todoAPI', todoAPI);
contextBridge.exposeInMainWorld('authAPI', authAPI);
contextBridge.exposeInMainWorld('sharedClipboardAPI', sharedClipboardAPI);
contextBridge.exposeInMainWorld('socialAPI', socialAPI);
contextBridge.exposeInMainWorld('commandsAPI', commandsAPI);
contextBridge.exposeInMainWorld('metricsAPI', metricsAPI);
contextBridge.exposeInMainWorld('claudeAPI', claudeAPI);
contextBridge.exposeInMainWorld('cursorAPI', cursorAPI);
contextBridge.exposeInMainWorld('scenarioAPI', scenarioAPI);

contextBridge.exposeInMainWorld('platform', {
  isMacOS: process.platform === 'darwin',
  isWindows: process.platform === 'win32',
  isLinux: process.platform === 'linux',
});

// Stripe configuration - always use live links.
contextBridge.exposeInMainWorld('stripeConfig', {
  // Payment link for upgrading to Pro
  paymentLink: 'https://buy.stripe.com/14A00j3iCbyl6aZ3fU3Ru00',
  // Customer portal for managing subscription
  portalLink: 'https://billing.stripe.com/p/login/14A00j3iCbyl6aZ3fU3Ru00',
});

declare global {
  interface Window {
    audioAPI: AudioAPI;
    transcribeAPI: TranscribeAPI;
    clipboardAPI: ClipboardAPI;
    permissionsAPI: PermissionsAPI;
    onboardingAPI: OnboardingAPI;
    updaterAPI: UpdaterAPI;
    todoAPI: TodoAPI;
    authAPI: AuthAPI;
    sharedClipboardAPI: SharedClipboardAPI;
    socialAPI: SocialAPI;
    quotaAPI: QuotaAPI;
    shellAPI: ShellAPI;
    diagnosticsAPI: DiagnosticsAPI;
    commandsAPI: CommandsAPI;
    librarianAPI: LibrarianAPI;
    metricsAPI: MetricsAPI;
    scenarioAPI: ScenarioAPI;
    stripeConfig: {
      paymentLink: string;
      portalLink: string;
    };
    platform: {
      isMacOS: boolean;
      isWindows: boolean;
      isLinux: boolean;
    };
  }
}
