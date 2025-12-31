import { contextBridge, ipcRenderer } from 'electron';

// Define IPC channels locally to avoid import issues
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
  GET_SELECTED_MODEL: 'transcribe:getSelectedModel',
  SET_SELECTED_MODEL: 'transcribe:setSelectedModel',
  GET_HOTKEY: 'transcribe:getHotkey',
  SET_HOTKEY: 'transcribe:setHotkey',
  GET_OVERLAY_STYLE: 'transcribe:getOverlayStyle',
  SET_OVERLAY_STYLE: 'transcribe:setOverlayStyle',
  GET_ABANDON_HOTKEY: 'transcribe:getAbandonHotkey',
  SET_ABANDON_HOTKEY: 'transcribe:setAbandonHotkey',
  GET_ABANDON_CONFIRMATION: 'transcribe:getAbandonConfirmation',
  SET_ABANDON_CONFIRMATION: 'transcribe:setAbandonConfirmation',
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

const VisionIPCChannels = {
  GET_MODEL_STATUS: 'vision:getModelStatus',
  DOWNLOAD_MODEL: 'vision:downloadModel',
  DELETE_MODEL: 'vision:deleteModel',
  GET_AVAILABLE_MODELS: 'vision:getAvailableModels',
  GET_MODEL_DOWNLOAD_STATUS: 'vision:getModelDownloadStatus',
  GET_SELECTED_MODEL: 'vision:getSelectedModel',
  SET_SELECTED_MODEL: 'vision:setSelectedModel',
  MODEL_DOWNLOAD_PROGRESS: 'vision:modelDownloadProgress',
  DESCRIPTION_READY: 'vision:descriptionReady',
  ERROR: 'vision:error',
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
  UPDATE_AVAILABLE: 'updater:updateAvailable',
  UPDATE_NOT_AVAILABLE: 'updater:updateNotAvailable',
  DOWNLOAD_PROGRESS: 'updater:downloadProgress',
  UPDATE_DOWNLOADED: 'updater:updateDownloaded',
  UPDATE_ERROR: 'updater:error',
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

type VisionModelStatus = 'downloaded' | 'downloading' | 'missing';

type VisionModelInfo = {
  name: string;
  repo: string;
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
  GET_CONVERSATIONS: 'social:getConversations',
  GET_DMS_WITH_USER: 'social:getDMsWithUser',
  MARK_AS_READ: 'social:markAsRead',
  HAS_UNREAD: 'social:hasUnread',
  
  // Feedback operations
  SUBMIT_FEEDBACK: 'social:submitFeedback',
  GET_MY_FEEDBACK: 'social:getMyFeedback',
  GET_ALL_FEEDBACK: 'social:getAllFeedback',
  GET_FEEDBACK_REPLIES: 'social:getFeedbackReplies',
  UPDATE_FEEDBACK_STATUS: 'social:updateFeedbackStatus',
  GET_ACTIVITY_LOG: 'social:getActivityLog',
  
  // Contact operations
  GET_CONTACTS: 'social:getContacts',
  ADD_FRIEND: 'social:addFriend',
  SEARCH_CONTACTS: 'social:searchContacts',
  
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

export interface TranscribeAPI {
  getStatus: () => Promise<TranscriptionStatus>;
  getModelStatus: () => Promise<ModelStatus>;
  downloadModel: (modelSize?: string) => Promise<void>;
  deleteModel: (modelSize: string) => Promise<boolean>;
  getAvailableModels: () => Promise<Record<string, ModelInfo>>;
  getModelDownloadStatus: () => Promise<Record<string, boolean>>;
  getSelectedModel: () => Promise<string>;
  setSelectedModel: (modelSize: string) => Promise<void>;
  getHotkey: () => Promise<string>;
  setHotkey: (hotkey: string) => Promise<boolean>;
  getOverlayStyle: () => Promise<'rectangle' | 'top-emerging'>;
  setOverlayStyle: (style: 'rectangle' | 'top-emerging') => Promise<void>;
  getAbandonHotkey: () => Promise<string>;
  setAbandonHotkey: (hotkey: string) => Promise<boolean>;
  getAbandonConfirmation: () => Promise<boolean>;
  setAbandonConfirmation: (enabled: boolean) => Promise<void>;
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

export interface VisionAPI {
  getModelStatus: () => Promise<VisionModelStatus>;
  downloadModel: (modelSize?: string) => Promise<void>;
  deleteModel: (modelSize: string) => Promise<boolean>;
  getAvailableModels: () => Promise<Record<string, VisionModelInfo>>;
  getModelDownloadStatus: () => Promise<Record<string, boolean>>;
  getSelectedModel: () => Promise<string>;
  setSelectedModel: (modelSize: string) => Promise<void>;
  onModelDownloadProgress: (callback: (downloaded: number, total: number) => void) => () => void;
  onDescriptionReady: (callback: (itemId: number, description: string) => void) => () => void;
  onError: (callback: (itemId: number, error: string) => void) => () => void;
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
  pasteItem: (id: number, targetBundleId?: string) => Promise<void>;
  copyItem: (id: number) => Promise<void>;
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
  onDialogPosition: (callback: (position: { left: number; top: number }) => void) => () => void;
  onDialogBounds: (callback: (bounds: { x: number; y: number; width: number; height: number }) => void) => () => void;
  onTargetAppInfo: (callback: (info: TargetAppInfo) => void) => () => void;
  saveBounds: (bounds: { x: number; y: number; width: number; height: number }) => Promise<void>;
  closeWindow: () => Promise<void>;
  showToast: (message: string) => Promise<void>;
  setSketchMode: (active: boolean) => void;
  
  // Stack operations for prompt stacking feature
  queryItemsByStackId: (stackId: string) => Promise<ClipboardItem[]>;
  getUniqueStacks: () => Promise<StackInfo[]>;
  updateStackId: (itemIds: number[], stackId: string | null) => Promise<void>;
  startDrag: (stackId: string) => Promise<void>;
  
  // Engineer feature - refine prompts using AI
  engineerStack: (stackId: string) => Promise<EngineerResult>;
  
  // All-time stats for footer display
  getAllTimeStats: () => Promise<{ stacks: number; transcriptions: number; screenshots: number; improved: number; words: number }>;
  incrementImprovedCount: () => Promise<number>;
  
  // API key management (stored securely via OS keychain)
  getApiKeyStatus: () => Promise<{ hasKey: boolean }>;
  setApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>;
  clearApiKey: () => Promise<{ success: boolean; error?: string }>;
  
  // System prompt customization for Engineer feature
  getSystemPrompt: () => Promise<{ prompt: string; isCustom: boolean }>;
  setSystemPrompt: (prompt: string) => Promise<{ success: boolean; error?: string }>;
  resetSystemPrompt: () => Promise<{ success: boolean; error?: string }>;
  getDefaultSystemPrompt: () => Promise<{ prompt: string }>;
  
  // Improved content management - store/clear improved versions of transcriptions
  saveImprovedContent: (itemId: number, improvedContent: string) => Promise<{ success: boolean; error?: string }>;
  clearImprovedContent: (itemId: number) => Promise<{ success: boolean; error?: string }>;
  
  // Mobile sync operations - sync iOS transcriptions to clipboard history
  setSyncSession: (accessToken: string, refreshToken: string) => Promise<boolean>;
  clearSyncSession: () => Promise<boolean>;
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
}

export interface PermissionsAPI {
  check: () => Promise<{ accessibilityGranted: boolean; inputMonitoringGranted: boolean }>;
  onStatusChanged: (callback: (status: { accessibilityGranted: boolean; inputMonitoringGranted: boolean }) => void) => () => void;
  onRevoked: (callback: () => void) => () => void;
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

  pasteItem: async (id: number, targetBundleId?: string): Promise<void> => {
    return ipcRenderer.invoke(ClipboardIPCChannels.PASTE_ITEM, id, targetBundleId);
  },
  
  copyItem: async (id: number): Promise<void> => {
    return ipcRenderer.invoke(ClipboardIPCChannels.COPY_ITEM, id);
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
  
  showToast: async (message: string): Promise<void> => {
    ipcRenderer.send('clipboard:showToast', message);
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

  // Engineer feature - refine prompts using AI
  engineerStack: async (stackId: string): Promise<EngineerResult> => {
    return ipcRenderer.invoke('clipboard:engineerStack', stackId);
  },

  // All-time stats for footer display
  getAllTimeStats: async (): Promise<{ stacks: number; transcriptions: number; screenshots: number; improved: number; words: number }> => {
    return ipcRenderer.invoke('clipboard:getAllTimeStats');
  },

  incrementImprovedCount: async (): Promise<number> => {
    return ipcRenderer.invoke('clipboard:incrementImprovedCount');
  },

  // API key management (stored securely via OS keychain)
  getApiKeyStatus: async (): Promise<{ hasKey: boolean }> => {
    return ipcRenderer.invoke(ClipboardIPCChannels.GET_API_KEY_STATUS);
  },

  setApiKey: async (apiKey: string): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke(ClipboardIPCChannels.SET_API_KEY, apiKey);
  },

  clearApiKey: async (): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke(ClipboardIPCChannels.CLEAR_API_KEY);
  },

  // System prompt customization for Engineer feature
  getSystemPrompt: async (): Promise<{ prompt: string; isCustom: boolean }> => {
    return ipcRenderer.invoke(ClipboardIPCChannels.GET_SYSTEM_PROMPT);
  },

  setSystemPrompt: async (prompt: string): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke(ClipboardIPCChannels.SET_SYSTEM_PROMPT, prompt);
  },

  resetSystemPrompt: async (): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke(ClipboardIPCChannels.RESET_SYSTEM_PROMPT);
  },

  getDefaultSystemPrompt: async (): Promise<{ prompt: string }> => {
    return ipcRenderer.invoke(ClipboardIPCChannels.GET_DEFAULT_SYSTEM_PROMPT);
  },

  // Improved content management - store/clear improved versions of transcriptions
  saveImprovedContent: async (itemId: number, improvedContent: string): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke(ClipboardIPCChannels.SAVE_IMPROVED_CONTENT, itemId, improvedContent);
  },

  clearImprovedContent: async (itemId: number): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke(ClipboardIPCChannels.CLEAR_IMPROVED_CONTENT, itemId);
  },

  // Mobile sync operations - sync iOS transcriptions to clipboard history
  setSyncSession: async (accessToken: string, refreshToken: string): Promise<boolean> => {
    return ipcRenderer.invoke('clipboard:setSyncSession', accessToken, refreshToken);
  },

  clearSyncSession: async (): Promise<boolean> => {
    return ipcRenderer.invoke('clipboard:clearSyncSession');
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
};

const visionAPI: VisionAPI = {
  getModelStatus: async (): Promise<VisionModelStatus> => {
    return ipcRenderer.invoke(VisionIPCChannels.GET_MODEL_STATUS);
  },

  downloadModel: async (modelSize?: string): Promise<void> => {
    return ipcRenderer.invoke(VisionIPCChannels.DOWNLOAD_MODEL, modelSize);
  },

  deleteModel: async (modelSize: string): Promise<boolean> => {
    return ipcRenderer.invoke(VisionIPCChannels.DELETE_MODEL, modelSize);
  },

  getAvailableModels: async (): Promise<Record<string, VisionModelInfo>> => {
    return ipcRenderer.invoke(VisionIPCChannels.GET_AVAILABLE_MODELS);
  },

  getModelDownloadStatus: async (): Promise<Record<string, boolean>> => {
    return ipcRenderer.invoke(VisionIPCChannels.GET_MODEL_DOWNLOAD_STATUS);
  },

  getSelectedModel: async (): Promise<string> => {
    return ipcRenderer.invoke(VisionIPCChannels.GET_SELECTED_MODEL);
  },

  setSelectedModel: async (modelSize: string): Promise<void> => {
    return ipcRenderer.invoke(VisionIPCChannels.SET_SELECTED_MODEL, modelSize);
  },

  onModelDownloadProgress: (callback: (downloaded: number, total: number) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, downloaded: number, total: number) => {
      callback(downloaded, total);
    };

    ipcRenderer.on(VisionIPCChannels.MODEL_DOWNLOAD_PROGRESS, handler);

    return () => {
      ipcRenderer.removeListener(VisionIPCChannels.MODEL_DOWNLOAD_PROGRESS, handler);
    };
  },

  onDescriptionReady: (callback: (itemId: number, description: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, itemId: number, description: string) => {
      callback(itemId, description);
    };

    ipcRenderer.on(VisionIPCChannels.DESCRIPTION_READY, handler);

    return () => {
      ipcRenderer.removeListener(VisionIPCChannels.DESCRIPTION_READY, handler);
    };
  },

  onError: (callback: (itemId: number, error: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, itemId: number, error: string) => {
      callback(itemId, error);
    };

    ipcRenderer.on(VisionIPCChannels.ERROR, handler);

    return () => {
      ipcRenderer.removeListener(VisionIPCChannels.ERROR, handler);
    };
  },
};

const permissionsAPI: PermissionsAPI = {
  check: async (): Promise<{ accessibilityGranted: boolean; inputMonitoringGranted: boolean }> => {
    return ipcRenderer.invoke('permissions:check');
  },

  onStatusChanged: (callback: (status: { accessibilityGranted: boolean; inputMonitoringGranted: boolean }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: { accessibilityGranted: boolean; inputMonitoringGranted: boolean }) => {
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
  
  // Set session from recovery token in URL.
  setSessionFromUrl: (accessToken: string, refreshToken: string) =>
    ipcRenderer.invoke('auth:setSessionFromUrl', accessToken, refreshToken),
  
  // Sign out.
  signOut: () => ipcRenderer.invoke('auth:signOut'),
  
  // Get current session.
  getSession: () => ipcRenderer.invoke('auth:getSession'),
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
  
  // Check if there are unread messages.
  hasUnread: async (): Promise<boolean> => {
    return ipcRenderer.invoke(SocialIPCChannels.HAS_UNREAD);
  },
  
  // =========================================================================
  // Feedback Operations
  // =========================================================================
  
  // Submit feedback (send to admin).
  submitFeedback: async (localItemId: number): Promise<SocialMessage | null> => {
    return ipcRenderer.invoke(SocialIPCChannels.SUBMIT_FEEDBACK, localItemId);
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

contextBridge.exposeInMainWorld('audioAPI', audioAPI);
contextBridge.exposeInMainWorld('transcribeAPI', transcribeAPI);
contextBridge.exposeInMainWorld('clipboardAPI', clipboardAPI);
contextBridge.exposeInMainWorld('permissionsAPI', permissionsAPI);
contextBridge.exposeInMainWorld('onboardingAPI', onboardingAPI);
contextBridge.exposeInMainWorld('updaterAPI', updaterAPI);
contextBridge.exposeInMainWorld('todoAPI', todoAPI);
contextBridge.exposeInMainWorld('authAPI', authAPI);
contextBridge.exposeInMainWorld('sharedClipboardAPI', sharedClipboardAPI);
contextBridge.exposeInMainWorld('socialAPI', socialAPI);

contextBridge.exposeInMainWorld('platform', {
  isMacOS: process.platform === 'darwin',
  isWindows: process.platform === 'win32',
  isLinux: process.platform === 'linux',
});

declare global {
  interface Window {
    audioAPI: AudioAPI;
    transcribeAPI: TranscribeAPI;
    clipboardAPI: ClipboardAPI;
    visionAPI: VisionAPI;
    permissionsAPI: PermissionsAPI;
    onboardingAPI: OnboardingAPI;
    updaterAPI: UpdaterAPI;
    todoAPI: TodoAPI;
    authAPI: AuthAPI;
    sharedClipboardAPI: SharedClipboardAPI;
    socialAPI: SocialAPI;
    platform: {
      isMacOS: boolean;
      isWindows: boolean;
      isLinux: boolean;
    };
  }
}
