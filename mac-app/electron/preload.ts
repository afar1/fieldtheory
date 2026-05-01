import { contextBridge, ipcRenderer } from 'electron';

// Define IPC channels locally to avoid import issues

function readInitialDarkModeArgument(): boolean | undefined {
  const prefix = '--field-theory-dark-mode=';
  const argument = process.argv.find((value) => value.startsWith(prefix));
  if (!argument) return undefined;
  return argument.slice(prefix.length) === 'true';
}

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
  GET_FAVORITE_DEVICE_NAME: 'audio:getFavoriteDeviceName',
  SET_FAVORITE_DEVICE: 'audio:setFavoriteDevice',
  CLEAR_FAVORITE_DEVICE: 'audio:clearFavoriteDevice',
  STATE_CHANGED: 'audio:stateChanged',
} as const;

const GazeIPCChannels = {
  GET_STATUS: 'gaze:getStatus',
  SET_ENABLED: 'gaze:setEnabled',
  GET_LATEST_SAMPLE: 'gaze:getLatestSample',
  GET_CALIBRATION_STATE: 'gaze:getCalibrationState',
  START_CALIBRATION: 'gaze:startCalibration',
  CANCEL_CALIBRATION: 'gaze:cancelCalibration',
  RESET_EYE_TRACKING_DATA: 'gaze:resetEyeTrackingData',
  APPLY_MANUAL_CORRECTION: 'gaze:applyManualCorrection',
  GET_FOCUS_CONFIG: 'gaze:getFocusConfig',
  SET_FOCUS_CONFIG: 'gaze:setFocusConfig',
  GET_DEBUG_OVERLAY_STATE: 'gaze:getDebugOverlayState',
  SET_DEBUG_OVERLAY_ENABLED: 'gaze:setDebugOverlayEnabled',
  GET_SCREEN_OVERLAY_STATE: 'gaze:getScreenOverlayState',
  SET_SCREEN_OVERLAY_ENABLED: 'gaze:setScreenOverlayEnabled',
  STATUS_CHANGED: 'gaze:statusChanged',
  SAMPLE: 'gaze:sample',
  CALIBRATION_CHANGED: 'gaze:calibrationChanged',
  DWELL_TRIGGERED: 'gaze:dwellTriggered',
  HIGHLIGHT_WINDOW: 'gaze:highlightWindow',
  DEBUG_OVERLAY_STATE_CHANGED: 'gaze:debugOverlayStateChanged',
  SCREEN_OVERLAY_STATE_CHANGED: 'gaze:screenOverlayStateChanged',
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
  GET_RECORDING_SOURCE: 'transcribe:getRecordingSource',
  SET_RECORDING_SOURCE: 'transcribe:setRecordingSource',
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
  PARAKEET_SETUP_PROGRESS: 'transcribe:parakeetSetupProgress',
  HOTKEY_CHANGED: 'transcribe:hotkeyChanged',
  ADD_TO_STACK: 'transcribe:addToStack',
  GET_TRANSCRIPTION_ENGINE: 'transcribe:getTranscriptionEngine',
  SET_TRANSCRIPTION_ENGINE: 'transcribe:setTranscriptionEngine',
  IS_MLX_WHISPER_INSTALLED: 'transcribe:isMlxWhisperInstalled',
  IS_PARAKEET_INSTALLED: 'transcribe:isParakeetInstalled',
  GET_PARAKEET_STATUS: 'transcribe:getParakeetStatus',
  IS_APPLE_SILICON: 'transcribe:isAppleSilicon',
  SETUP_MLX_WHISPER: 'transcribe:setupMlxWhisper',
  SETUP_PARAKEET: 'transcribe:setupParakeet',
  UNINSTALL_PARAKEET: 'transcribe:uninstallParakeet',
} as const;

const ClipboardIPCChannels = {
  QUERY_ITEMS: 'clipboard:queryItems',
  GET_ITEM: 'clipboard:getItem',
  DELETE_ITEM: 'clipboard:deleteItem',
  RESTORE_ITEM: 'clipboard:restoreItem',
  CLEAR_ALL: 'clipboard:clearAll',
  CAPTURE_SCREENSHOT: 'clipboard:captureScreenshot',
  GET_CLIPBOARD_IMAGE_PATH: 'clipboard:getClipboardImagePath',
  EXPORT_ITEM_IMAGE_PATH: 'clipboard:exportItemImagePath',
  SAVE_SKETCH: 'clipboard:saveSketch',
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
  GET_HIDE_SCREEN_RECORDING_BANNER: 'clipboard:getHideScreenRecordingBanner',
  SET_HIDE_SCREEN_RECORDING_BANNER: 'clipboard:setHideScreenRecordingBanner',
  GET_CURSOR_STATUS_ENABLED: 'clipboard:getCursorStatusEnabled',
  SET_CURSOR_STATUS_ENABLED: 'clipboard:setCursorStatusEnabled',
  GET_PERFORMANCE_HUD_ENABLED: 'clipboard:getPerformanceHudEnabled',
  SET_PERFORMANCE_HUD_ENABLED: 'clipboard:setPerformanceHudEnabled',
  GET_PERFORMANCE_SNAPSHOT: 'clipboard:getPerformanceSnapshot',
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
  SHOW_SIGN_IN: 'onboarding:showSignIn',
  // AI integration detection and configuration
  GET_AI_INTEGRATION_STATUS: 'onboarding:getAIIntegrationStatus',
  INSTALL_CLAUDE_HOOK: 'onboarding:installClaudeHook',
  INSTALL_CURSOR_HOOK: 'onboarding:installCursorHook',
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

const TaggedDocsIPCChannels = {
  LIST: 'taggedDocs:list',
  MARK_READ: 'taggedDocs:markRead',
  MARK_ALL_READ: 'taggedDocs:markAllRead',
  RESCAN: 'taggedDocs:rescan',
  UPDATED: 'taggedDocs:updated',
  SCAN_PROGRESS: 'taggedDocs:scanProgress',
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

type GazeTrackingStatus = {
  enabled: boolean;
  running: boolean;
  cameraAuthorized: boolean;
  targetFps: number;
  reason: string | null;
  lastSampleAtMs: number | null;
};

type GazeSample = {
  timestampMs: number;
  confidence: number;
  leftEye: { x: number; y: number };
  rightEye: { x: number; y: number };
  combinedEye: { x: number; y: number };
  calibratedCombinedEye: { x: number; y: number };
  calibrationApplied: boolean;
  headPose: { yaw: number; pitch: number; roll: number };
  gazeVector: { x: number; y: number; z: number };
  faceBounds: { x: number; y: number; width: number; height: number };
  faceSize: number;
  distanceScale: number;
  activeDisplayId?: number | null;
  mappedScreenPoint?: { x: number; y: number } | null;
  landmarks?: {
    leftEye: {
      medialCanthus: { x: number; y: number };
      lateralCanthus: { x: number; y: number };
      irisCenter: { x: number; y: number };
    };
    rightEye: {
      medialCanthus: { x: number; y: number };
      lateralCanthus: { x: number; y: number };
      irisCenter: { x: number; y: number };
    };
  } | null;
};

type GazeCalibrationPointId =
  | 'center'
  | 'topLeft'
  | 'topRight'
  | 'bottomLeft'
  | 'bottomRight';

type GazeCalibrationState = {
  active: boolean;
  currentPointId: GazeCalibrationPointId | null;
  currentPointIndex: number;
  totalPoints: number;
  stableForMs: number;
  currentVariance: number;
  samplesCollected: number;
  manualCorrectionCount: number;
  collectedPoints: Array<{
    pointId: GazeCalibrationPointId;
    target: { x: number; y: number };
    observedCombined: { x: number; y: number };
    observedLeft: { x: number; y: number };
    observedRight: { x: number; y: number };
    variance: number;
  }>;
  personalOffsets: {
    version: 1;
    horizontalOffset: number;
    verticalOffset: number;
    eyeDominance: number;
    referenceFaceSize: number;
    updatedAtMs: number;
  } | null;
  lastCalibratedAtMs: number | null;
  accuracy: {
    label: 'good' | 'fair' | 'poor';
    meanError: number;
    estimatedErrorPx: number;
    message: string;
  } | null;
  needsRecalibrationPrompt: boolean;
  recalibrationReason: string | null;
};

type GazeDwellAction = 'highlightBorder' | 'bringToFront' | 'eventOnly';

type GazeWindowFocusConfig = {
  dwellDurationMs: number;
  confidenceThreshold: number;
  deadZonePx: number;
  cooldownMs: number;
  dwellAction: GazeDwellAction;
};

type GazeWindowSnapshot = {
  windowId: number;
  ownerName: string;
  ownerBundleId: string;
  ownerPID: number;
  title: string;
  bounds: { x: number; y: number; width: number; height: number };
  layer: number;
};

type GazeDwellEvent = {
  timestampMs: number;
  confidence: number;
  stability: number;
  gazePoint: { x: number; y: number };
  activeDisplayId: number;
  window: GazeWindowSnapshot;
  action: GazeDwellAction;
};

type GazeDebugOverlayState = {
  enabled: boolean;
  visible: boolean;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
};

type GazeScreenOverlayState = {
  enabled: boolean;
  visible: boolean;
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
  senderCallsign: string | null;
  senderName: string | null;
  recipientUserId: string;
  recipientEmail: string | null;
  recipientCallsign: string | null;
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

type TaggedDoc = {
  ulid: string;
  path: string;
  title: string;
  taggedBy: string | null;
  taggedAt: number | null;
  frontmatterUpdatedAt: number;
  fileHash: string;
  readAt: number | null;
  lastReadHash: string | null;
  unread: boolean;
};

type TaggedDocsScanProgress = {
  phase: 'idle' | 'scanning' | 'done' | 'error';
  scanned: number;
  matched: number;
  roots: string[];
  currentPath?: string;
  error?: string;
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
  getFavoriteDeviceName: () => Promise<string | null>;
  setFavoriteDevice: (deviceId: string) => Promise<boolean>;
  clearFavoriteDevice: () => Promise<void>;
}

export interface GazeAPI {
  getStatus: () => Promise<GazeTrackingStatus>;
  setEnabled: (enabled: boolean) => Promise<GazeTrackingStatus>;
  getLatestSample: () => Promise<GazeSample | null>;
  getCalibrationState: () => Promise<GazeCalibrationState>;
  startCalibration: () => Promise<GazeCalibrationState>;
  cancelCalibration: () => Promise<GazeCalibrationState>;
  resetEyeTrackingData: () => Promise<GazeCalibrationState>;
  applyManualCorrection: (target: { x: number; y: number }) => Promise<GazeCalibrationState>;
  getFocusConfig: () => Promise<GazeWindowFocusConfig>;
  setFocusConfig: (config: Partial<GazeWindowFocusConfig>) => Promise<GazeWindowFocusConfig>;
  getDebugOverlayState: () => Promise<GazeDebugOverlayState>;
  setDebugOverlayEnabled: (enabled: boolean) => Promise<GazeDebugOverlayState>;
  getScreenOverlayState: () => Promise<GazeScreenOverlayState>;
  setScreenOverlayEnabled: (enabled: boolean) => Promise<GazeScreenOverlayState>;
  onStatusChanged: (callback: (status: GazeTrackingStatus) => void) => () => void;
  onSample: (callback: (sample: GazeSample) => void) => () => void;
  onCalibrationChanged: (callback: (state: GazeCalibrationState) => void) => () => void;
  onDwellTriggered: (callback: (event: GazeDwellEvent) => void) => () => void;
  onHighlightWindow: (callback: (window: GazeWindowSnapshot) => void) => () => void;
  onDebugOverlayStateChanged: (callback: (state: GazeDebugOverlayState) => void) => () => void;
  onScreenOverlayStateChanged: (callback: (state: GazeScreenOverlayState) => void) => () => void;
}

// Valid hotkey IDs that can be get/set via the hotkeyAPI
export type HotkeyId = 'superPaste' | 'commandLauncher' | 'scratchpad';

export interface HotkeyTestResult {
  key: string;
  status: 'working' | 'conflict' | 'error';
  callbackFired: boolean;
  conflictApp?: string;
  error?: string;
}

export interface HotkeyAPI {
  getHotkey: (id: HotkeyId) => Promise<string | null>;
  setHotkey: (id: HotkeyId, key: string) => Promise<{ success: boolean; error?: string }>;
  getAllHotkeys: () => Promise<Record<HotkeyId, string | null>>;
  testHotkey: (key: string, timeoutMs?: number) => Promise<HotkeyTestResult>;
  getRunningConflictApps: () => Promise<string[]>;
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
  getRecordingSource: () => Promise<'microphone' | 'system-audio'>;
  setRecordingSource: (source: 'microphone' | 'system-audio') => Promise<void>;
  getHotkey: () => Promise<string>;
  setHotkey: (hotkey: string | null) => Promise<boolean>;
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
  getTranscriptionEngine: () => Promise<'whisper' | 'mlx-whisper' | 'parakeet' | 'parakeet-multilingual'>;
  setTranscriptionEngine: (engine: 'whisper' | 'mlx-whisper' | 'parakeet' | 'parakeet-multilingual') => Promise<void>;
  isMlxWhisperInstalled: () => Promise<boolean>;
  isParakeetInstalled: () => Promise<boolean>;
  getParakeetStatus: () => Promise<import('./main/types/transcribe').ParakeetStatus | null>;
  isAppleSilicon: () => Promise<boolean>;
  setupMlxWhisper: () => Promise<{ success: boolean; error?: string }>;
  setupParakeet: (engine?: 'parakeet' | 'parakeet-multilingual') => Promise<{ success: boolean; error?: string }>;
  uninstallParakeet: () => Promise<{ success: boolean; error?: string }>;
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
  onParakeetSetupProgress: (callback: (progress: import('./main/types/transcribe').ParakeetSetupProgress) => void) => () => void;
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
  getClipboardImagePath: () => Promise<string | null>;
  exportItemImagePath: (id: number) => Promise<string | null>;
  saveSketch: (imageData: string, width: number, height: number) => Promise<number>;
  getHotkeys: () => Promise<ClipboardHotkeys>;
  setHotkeys: (hotkeys: ClipboardHotkeys) => Promise<boolean>;
  pasteItem: (id: number, targetBundleId?: string, useImproved?: boolean) => Promise<void>;
  copyItem: (id: number, useImproved?: boolean) => Promise<void>;
  pasteStack: (ids: number[], targetBundleId?: string) => Promise<void>;
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
  onShowTranscriptHistory: (callback: () => void) => () => void;
  onShowSettings: (callback: () => void) => () => void;
  onCollapseImmersive: (callback: () => void) => () => void;
  onResetToClipboardView: (callback: () => void) => () => void;
  onWindowStyleTransitionOut: (callback: () => void) => () => void;
  windowStyleTransitionReady: () => void;
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

  // Performance HUD settings and process telemetry
  getPerformanceHudEnabled?: () => Promise<boolean>;
  setPerformanceHudEnabled?: (enabled: boolean) => Promise<boolean>;
  getPerformanceSnapshot?: () => Promise<{
    timestampMs: number;
    cpuPercent: number;
    cpuCoresUsed: number;
    cpuSystemPercent: number;
    totalCores: number;
    memoryUsedMb: number;
    memorySystemPercent: number;
    totalMemoryGb: number;
  }>;
  
  // Hide status labels (show only colored dots)
  getHideStatusLabels?: () => Promise<boolean>;
  setHideStatusLabels?: (hide: boolean) => Promise<boolean>;

  // Cursor status debug mode (shows blue background to prove we control the overlay)
  getCursorStatusDebugMode?: () => Promise<boolean>;
  setCursorStatusDebugMode?: (enabled: boolean) => Promise<boolean>;

  // Cursor status window color debug (shows magenta BrowserWindow background)
  getCursorStatusWindowColorDebug?: () => Promise<boolean>;
  setCursorStatusWindowColorDebug?: (enabled: boolean) => Promise<boolean>;

  // Show in Dock and Cmd+Tab
  getShowInDock?: () => Promise<boolean>;
  setShowInDock?: (show: boolean) => Promise<boolean>;

  // Field Theory window behavior
  getFieldTheoryWindowMode?: () => Promise<'panel' | 'app'>;
  setFieldTheoryWindowMode?: (mode: 'panel' | 'app') => Promise<boolean>;

  // Click-away dismissal
  getClickAwayToDismiss?: () => Promise<boolean>;
  setClickAwayToDismiss?: (enabled: boolean) => Promise<boolean>;

  // Show fieldtheory.dev link in footer
  getShowFieldTheoryLink?: () => Promise<boolean>;
  setShowFieldTheoryLink?: (show: boolean) => Promise<boolean>;

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

  // App voice aliases - custom voice trigger words for app switching
  getAppVoiceAliases?: () => Promise<Array<{ appName: string; aliases: string }>>;
  setAppVoiceAliases?: (aliases: Array<{ appName: string; aliases: string }>) => Promise<boolean>;
  browseForApp?: () => Promise<string | null>;

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

  getFavoriteDeviceName: async (): Promise<string | null> => {
    return ipcRenderer.invoke(AudioIPCChannels.GET_FAVORITE_DEVICE_NAME);
  },

  setFavoriteDevice: async (deviceId: string): Promise<boolean> => {
    return ipcRenderer.invoke(AudioIPCChannels.SET_FAVORITE_DEVICE, deviceId);
  },

  clearFavoriteDevice: async (): Promise<void> => {
    return ipcRenderer.invoke(AudioIPCChannels.CLEAR_FAVORITE_DEVICE);
  },
};

const gazeAPI: GazeAPI = {
  getStatus: async (): Promise<GazeTrackingStatus> => {
    return ipcRenderer.invoke(GazeIPCChannels.GET_STATUS);
  },

  setEnabled: async (enabled: boolean): Promise<GazeTrackingStatus> => {
    return ipcRenderer.invoke(GazeIPCChannels.SET_ENABLED, enabled);
  },

  getLatestSample: async (): Promise<GazeSample | null> => {
    return ipcRenderer.invoke(GazeIPCChannels.GET_LATEST_SAMPLE);
  },

  getCalibrationState: async (): Promise<GazeCalibrationState> => {
    return ipcRenderer.invoke(GazeIPCChannels.GET_CALIBRATION_STATE);
  },

  startCalibration: async (): Promise<GazeCalibrationState> => {
    return ipcRenderer.invoke(GazeIPCChannels.START_CALIBRATION);
  },

  cancelCalibration: async (): Promise<GazeCalibrationState> => {
    return ipcRenderer.invoke(GazeIPCChannels.CANCEL_CALIBRATION);
  },

  resetEyeTrackingData: async (): Promise<GazeCalibrationState> => {
    return ipcRenderer.invoke(GazeIPCChannels.RESET_EYE_TRACKING_DATA);
  },

  applyManualCorrection: async (target: { x: number; y: number }): Promise<GazeCalibrationState> => {
    return ipcRenderer.invoke(GazeIPCChannels.APPLY_MANUAL_CORRECTION, target);
  },

  getFocusConfig: async (): Promise<GazeWindowFocusConfig> => {
    return ipcRenderer.invoke(GazeIPCChannels.GET_FOCUS_CONFIG);
  },

  setFocusConfig: async (config: Partial<GazeWindowFocusConfig>): Promise<GazeWindowFocusConfig> => {
    return ipcRenderer.invoke(GazeIPCChannels.SET_FOCUS_CONFIG, config);
  },

  getDebugOverlayState: async (): Promise<GazeDebugOverlayState> => {
    return ipcRenderer.invoke(GazeIPCChannels.GET_DEBUG_OVERLAY_STATE);
  },

  setDebugOverlayEnabled: async (enabled: boolean): Promise<GazeDebugOverlayState> => {
    return ipcRenderer.invoke(GazeIPCChannels.SET_DEBUG_OVERLAY_ENABLED, enabled);
  },

  getScreenOverlayState: async (): Promise<GazeScreenOverlayState> => {
    return ipcRenderer.invoke(GazeIPCChannels.GET_SCREEN_OVERLAY_STATE);
  },

  setScreenOverlayEnabled: async (enabled: boolean): Promise<GazeScreenOverlayState> => {
    return ipcRenderer.invoke(GazeIPCChannels.SET_SCREEN_OVERLAY_ENABLED, enabled);
  },

  onStatusChanged: (callback: (status: GazeTrackingStatus) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: GazeTrackingStatus) => {
      callback(status);
    };

    ipcRenderer.on(GazeIPCChannels.STATUS_CHANGED, handler);

    return () => {
      ipcRenderer.removeListener(GazeIPCChannels.STATUS_CHANGED, handler);
    };
  },

  onSample: (callback: (sample: GazeSample) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, sample: GazeSample) => {
      callback(sample);
    };

    ipcRenderer.on(GazeIPCChannels.SAMPLE, handler);

    return () => {
      ipcRenderer.removeListener(GazeIPCChannels.SAMPLE, handler);
    };
  },

  onCalibrationChanged: (callback: (state: GazeCalibrationState) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: GazeCalibrationState) => {
      callback(state);
    };

    ipcRenderer.on(GazeIPCChannels.CALIBRATION_CHANGED, handler);

    return () => {
      ipcRenderer.removeListener(GazeIPCChannels.CALIBRATION_CHANGED, handler);
    };
  },

  onDwellTriggered: (callback: (event: GazeDwellEvent) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, event: GazeDwellEvent) => {
      callback(event);
    };

    ipcRenderer.on(GazeIPCChannels.DWELL_TRIGGERED, handler);

    return () => {
      ipcRenderer.removeListener(GazeIPCChannels.DWELL_TRIGGERED, handler);
    };
  },

  onHighlightWindow: (callback: (window: GazeWindowSnapshot) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, window: GazeWindowSnapshot) => {
      callback(window);
    };

    ipcRenderer.on(GazeIPCChannels.HIGHLIGHT_WINDOW, handler);

    return () => {
      ipcRenderer.removeListener(GazeIPCChannels.HIGHLIGHT_WINDOW, handler);
    };
  },

  onDebugOverlayStateChanged: (callback: (state: GazeDebugOverlayState) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: GazeDebugOverlayState) => {
      callback(state);
    };

    ipcRenderer.on(GazeIPCChannels.DEBUG_OVERLAY_STATE_CHANGED, handler);

    return () => {
      ipcRenderer.removeListener(GazeIPCChannels.DEBUG_OVERLAY_STATE_CHANGED, handler);
    };
  },

  onScreenOverlayStateChanged: (callback: (state: GazeScreenOverlayState) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: GazeScreenOverlayState) => {
      callback(state);
    };

    ipcRenderer.on(GazeIPCChannels.SCREEN_OVERLAY_STATE_CHANGED, handler);

    return () => {
      ipcRenderer.removeListener(GazeIPCChannels.SCREEN_OVERLAY_STATE_CHANGED, handler);
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

  testHotkey: async (key: string, timeoutMs?: number): Promise<HotkeyTestResult> => {
    return ipcRenderer.invoke('hotkey:test', key, timeoutMs);
  },

  getRunningConflictApps: async (): Promise<string[]> => {
    return ipcRenderer.invoke('hotkey:getRunningConflictApps');
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

  getRecordingSource: async (): Promise<'microphone' | 'system-audio'> => {
    return ipcRenderer.invoke(TranscribeIPCChannels.GET_RECORDING_SOURCE);
  },

  setRecordingSource: async (source: 'microphone' | 'system-audio'): Promise<void> => {
    return ipcRenderer.invoke(TranscribeIPCChannels.SET_RECORDING_SOURCE, source);
  },

  getHotkey: async (): Promise<string> => {
    return ipcRenderer.invoke(TranscribeIPCChannels.GET_HOTKEY);
  },

  setHotkey: async (hotkey: string | null): Promise<boolean> => {
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

  getTranscriptionEngine: async (): Promise<'whisper' | 'mlx-whisper' | 'parakeet' | 'parakeet-multilingual'> => {
    return ipcRenderer.invoke(TranscribeIPCChannels.GET_TRANSCRIPTION_ENGINE);
  },

  setTranscriptionEngine: async (engine: 'whisper' | 'mlx-whisper' | 'parakeet' | 'parakeet-multilingual'): Promise<void> => {
    return ipcRenderer.invoke(TranscribeIPCChannels.SET_TRANSCRIPTION_ENGINE, engine);
  },

  isMlxWhisperInstalled: async (): Promise<boolean> => {
    return ipcRenderer.invoke(TranscribeIPCChannels.IS_MLX_WHISPER_INSTALLED);
  },
  isParakeetInstalled: async (): Promise<boolean> => {
    return ipcRenderer.invoke(TranscribeIPCChannels.IS_PARAKEET_INSTALLED);
  },
  getParakeetStatus: async () => {
    return ipcRenderer.invoke(TranscribeIPCChannels.GET_PARAKEET_STATUS);
  },

  isAppleSilicon: async (): Promise<boolean> => {
    return ipcRenderer.invoke(TranscribeIPCChannels.IS_APPLE_SILICON);
  },

  setupMlxWhisper: async (): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke(TranscribeIPCChannels.SETUP_MLX_WHISPER);
  },
  setupParakeet: async (engine?: 'parakeet' | 'parakeet-multilingual'): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke(TranscribeIPCChannels.SETUP_PARAKEET, engine);
  },
  uninstallParakeet: async (): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke(TranscribeIPCChannels.UNINSTALL_PARAKEET);
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

  onParakeetSetupProgress: (callback: (progress: import('./main/types/transcribe').ParakeetSetupProgress) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: import('./main/types/transcribe').ParakeetSetupProgress) => {
      callback(progress);
    };

    ipcRenderer.on(TranscribeIPCChannels.PARAKEET_SETUP_PROGRESS, handler);

    return () => {
      ipcRenderer.removeListener(TranscribeIPCChannels.PARAKEET_SETUP_PROGRESS, handler);
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

  getClipboardImagePath: async (): Promise<string | null> => {
    return ipcRenderer.invoke(ClipboardIPCChannels.GET_CLIPBOARD_IMAGE_PATH);
  },

  exportItemImagePath: async (id: number): Promise<string | null> => {
    return ipcRenderer.invoke(ClipboardIPCChannels.EXPORT_ITEM_IMAGE_PATH, id);
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

  pasteStack: async (ids: number[], targetBundleId?: string): Promise<void> => {
    return ipcRenderer.invoke(ClipboardIPCChannels.PASTE_STACK, ids, targetBundleId);
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

  onShowTranscriptHistory: (callback: () => void): (() => void) => {
    const handler = () => {
      callback();
    };
    ipcRenderer.on('clipboard:showTranscriptHistory', handler);
    return () => {
      ipcRenderer.removeListener('clipboard:showTranscriptHistory', handler);
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

  onWindowStyleTransitionOut: (callback: () => void): (() => void) => {
    const handler = () => {
      callback();
    };
    ipcRenderer.on('clipboard:windowStyleTransitionOut', handler);
    return () => {
      ipcRenderer.removeListener('clipboard:windowStyleTransitionOut', handler);
    };
  },

  windowStyleTransitionReady: (): void => {
    ipcRenderer.send('clipboard:windowStyleTransitionReady');
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

  // Performance HUD settings and process telemetry.
  getPerformanceHudEnabled: async (): Promise<boolean> => {
    return ipcRenderer.invoke(ClipboardIPCChannels.GET_PERFORMANCE_HUD_ENABLED);
  },

  setPerformanceHudEnabled: async (enabled: boolean): Promise<boolean> => {
    return ipcRenderer.invoke(ClipboardIPCChannels.SET_PERFORMANCE_HUD_ENABLED, enabled);
  },

  getPerformanceSnapshot: async (): Promise<{
    timestampMs: number;
    cpuPercent: number;
    cpuCoresUsed: number;
    cpuSystemPercent: number;
    totalCores: number;
    memoryUsedMb: number;
    memorySystemPercent: number;
    totalMemoryGb: number;
  }> => {
    return ipcRenderer.invoke(ClipboardIPCChannels.GET_PERFORMANCE_SNAPSHOT);
  },

  // Hide status labels (show only colored dots).
  getHideStatusLabels: async (): Promise<boolean> => {
    return ipcRenderer.invoke('clipboard:getHideStatusLabels');
  },

  setHideStatusLabels: async (hide: boolean): Promise<boolean> => {
    return ipcRenderer.invoke('clipboard:setHideStatusLabels', hide);
  },

  // Cursor status debug mode (shows blue background to prove we control the overlay).
  getCursorStatusDebugMode: async (): Promise<boolean> => {
    return ipcRenderer.invoke('clipboard:getCursorStatusDebugMode');
  },

  setCursorStatusDebugMode: async (enabled: boolean): Promise<boolean> => {
    return ipcRenderer.invoke('clipboard:setCursorStatusDebugMode', enabled);
  },

  // Cursor status window color debug (shows magenta BrowserWindow background).
  getCursorStatusWindowColorDebug: async (): Promise<boolean> => {
    return ipcRenderer.invoke('clipboard:getCursorStatusWindowColorDebug');
  },

  setCursorStatusWindowColorDebug: async (enabled: boolean): Promise<boolean> => {
    return ipcRenderer.invoke('clipboard:setCursorStatusWindowColorDebug', enabled);
  },

  // Show in Dock and Cmd+Tab.
  getShowInDock: async (): Promise<boolean> => {
    return ipcRenderer.invoke('clipboard:getShowInDock');
  },
  
  setShowInDock: async (show: boolean): Promise<boolean> => {
    return ipcRenderer.invoke('clipboard:setShowInDock', show);
  },

  // Field Theory window behavior.
  getFieldTheoryWindowMode: async (): Promise<'panel' | 'app'> => {
    return ipcRenderer.invoke('clipboard:getFieldTheoryWindowMode');
  },

  setFieldTheoryWindowMode: async (mode: 'panel' | 'app'): Promise<boolean> => {
    return ipcRenderer.invoke('clipboard:setFieldTheoryWindowMode', mode);
  },

  // Click-away dismissal.
  getClickAwayToDismiss: async (): Promise<boolean> => {
    return ipcRenderer.invoke('clipboard:getClickAwayToDismiss');
  },

  setClickAwayToDismiss: async (enabled: boolean): Promise<boolean> => {
    return ipcRenderer.invoke('clipboard:setClickAwayToDismiss', enabled);
  },

  // Show fieldtheory.dev link in footer.
  getShowFieldTheoryLink: async (): Promise<boolean> => {
    return ipcRenderer.invoke('clipboard:getShowFieldTheoryLink');
  },

  setShowFieldTheoryLink: async (show: boolean): Promise<boolean> => {
    return ipcRenderer.invoke('clipboard:setShowFieldTheoryLink', show);
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

  // App voice aliases - custom voice trigger words for app switching.
  getAppVoiceAliases: async (): Promise<Array<{ appName: string; aliases: string }>> => {
    return ipcRenderer.invoke('clipboard:getAppVoiceAliases');
  },

  setAppVoiceAliases: async (aliases: Array<{ appName: string; aliases: string }>): Promise<boolean> => {
    return ipcRenderer.invoke('clipboard:setAppVoiceAliases', aliases);
  },

  browseForApp: async (): Promise<string | null> => {
    return ipcRenderer.invoke('clipboard:browseForApp');
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

  // Get AI integration status - checks if Claude Code and Cursor are available
  // and whether hooks are already installed.
  getAIIntegrationStatus: async (): Promise<{
    claudeCode: { available: boolean; connected: boolean };
    cursor: { available: boolean; connected: boolean };
  }> => {
    return ipcRenderer.invoke(OnboardingIPCChannels.GET_AI_INTEGRATION_STATUS);
  },

  // Install Claude Code read permission hook for screenshot access.
  installClaudeHook: async (): Promise<{ success: boolean; message: string }> => {
    return ipcRenderer.invoke(OnboardingIPCChannels.INSTALL_CLAUDE_HOOK);
  },

  // Install Cursor read permission hook for screenshot access.
  installCursorHook: async (): Promise<{ success: boolean; message: string }> => {
    return ipcRenderer.invoke(OnboardingIPCChannels.INSTALL_CURSOR_HOOK);
  },

  // Show the sign-in screen (onboarding at account step).
  // Used when user clicks "Sign in" from settings while logged out.
  showSignIn: async (): Promise<boolean> => {
    return ipcRenderer.invoke(OnboardingIPCChannels.SHOW_SIGN_IN);
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

const taggedDocsAPI = {
  list: async (): Promise<TaggedDoc[]> => {
    return ipcRenderer.invoke(TaggedDocsIPCChannels.LIST);
  },

  markRead: async (ulid: string): Promise<TaggedDoc | null> => {
    return ipcRenderer.invoke(TaggedDocsIPCChannels.MARK_READ, ulid);
  },

  markAllRead: async (): Promise<TaggedDoc[]> => {
    return ipcRenderer.invoke(TaggedDocsIPCChannels.MARK_ALL_READ);
  },

  rescan: async (): Promise<TaggedDoc[]> => {
    return ipcRenderer.invoke(TaggedDocsIPCChannels.RESCAN);
  },

  onUpdated: (callback: (docs: TaggedDoc[]) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, docs: TaggedDoc[]) => {
      callback(docs);
    };
    ipcRenderer.on(TaggedDocsIPCChannels.UPDATED, handler);
    return () => {
      ipcRenderer.removeListener(TaggedDocsIPCChannels.UPDATED, handler);
    };
  },

  onScanProgress: (callback: (progress: TaggedDocsScanProgress) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: TaggedDocsScanProgress) => {
      callback(progress);
    };
    ipcRenderer.on(TaggedDocsIPCChannels.SCAN_PROGRESS, handler);
    return () => {
      ipcRenderer.removeListener(TaggedDocsIPCChannels.SCAN_PROGRESS, handler);
    };
  },
};

type TaggedDocsAPI = typeof taggedDocsAPI;

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

  // Listen for main-process auth session changes.
  onSessionChanged: (callback: (session: unknown | null) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, session: unknown | null) => callback(session);
    ipcRenderer.on('session-changed', handler);
    return () => ipcRenderer.removeListener('session-changed', handler);
  },

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

  // Subscribe to auth debug events (callback only - console logging handled by auto-subscribe below)
  onDebug: (callback: (event: {
    timestamp: string;
    event: string;
    details: Record<string, unknown>;
    level: 'info' | 'warn' | 'error' | 'recovery';
  }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, debugEvent: {
      timestamp: string;
      event: string;
      details: Record<string, unknown>;
      level: 'info' | 'warn' | 'error' | 'recovery';
    }) => callback(debugEvent);
    ipcRenderer.on('auth:debug', handler);
    return () => ipcRenderer.removeListener('auth:debug', handler);
  },
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
  checkQuota: (feature: 'priorityMic' | 'autoStack' | 'textImprove' | 'portableCommands') =>
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
    portableCommands: number;
  }>,

  // Manually refresh tier from server (debugging and edge cases).
  refreshTier: () => ipcRenderer.invoke('quota:refreshTier') as Promise<{ tier: 'free' | 'pro'; error: string | null }>,

  // Listen for trial-state changes (pro / trial / expired).
  // Fires whenever the server-computed state changes. Also immediately emits the
  // current state on registration (BehaviorSubject pattern).
  onStateChanged: (callback: (state: 'pro' | 'trial' | 'expired') => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: 'pro' | 'trial' | 'expired') => {
      callback(state);
    };
    ipcRenderer.on('state:changed', handler);

    ipcRenderer.invoke('quota:getQuotas').then((quotas) => {
      if (quotas?.state) callback(quotas.state);
    }).catch(() => { /* ignore */ });

    return () => {
      ipcRenderer.removeListener('state:changed', handler);
    };
  },

  // Listen for tier changes (e.g., after Stripe checkout upgrades user to pro).
  // Also immediately emits the current tier on registration (BehaviorSubject pattern).
  onTierChanged: (callback: (tier: 'free' | 'pro') => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, tier: 'free' | 'pro') => {
      callback(tier);
    };
    ipcRenderer.on('tier:changed', handler);

    // Immediately emit current tier so subscriber has the current state
    ipcRenderer.invoke('quota:getQuotas').then((quotas) => {
      if (quotas?.tier) {
        callback(quotas.tier);
      }
    }).catch(() => {
      // Ignore errors - subscriber will get tier on next change
    });

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
  onQuotaChanged: (callback: (data: { priorityMic: string; autoStack: string; textImprove: string; portableCommands: string }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { priorityMic: string; autoStack: string; textImprove: string; portableCommands: string }) => {
      callback(data);
    };
    ipcRenderer.on('quota:changed', handler);
    return () => {
      ipcRenderer.removeListener('quota:changed', handler);
    };
  },
};

type QuotaAPI = typeof quotaAPI;

const accountAPI = {
  getStatus: () => ipcRenderer.invoke('account:getStatus'),
  checkNow: () => ipcRenderer.invoke('account:checkNow'),
  onStatusChanged: (callback: (status: unknown) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: unknown) => callback(status);
    ipcRenderer.on('account:statusChanged', handler);
    return () => {
      ipcRenderer.removeListener('account:statusChanged', handler);
    };
  },
  onBlockedWrite: (callback: (payload: { reason: string }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: { reason: string }) => callback(payload);
    ipcRenderer.on('account:blockedWrite', handler);
    return () => {
      ipcRenderer.removeListener('account:blockedWrite', handler);
    };
  },
};
type AccountAPI = typeof accountAPI;

// =============================================================================
// Shell API - Open external URLs in default browser
// =============================================================================

const shellAPI = {
  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke('shell:openExternal', url),
  showItemInFolder: (fullPath: string): Promise<void> =>
    ipcRenderer.invoke('shell:showItemInFolder', fullPath),
  /** macOS proxy-icon + Cmd-click-title menu for the current window. Pass
   *  "" to clear. */
  setRepresentedFilename: (fullPath: string): Promise<void> =>
    ipcRenderer.invoke('shell:setRepresentedFilename', fullPath),
};

type ShellAPI = typeof shellAPI;

type AgentImproveLaunchRequest = {
  tool: 'codex' | 'claude';
  instruction: string;
  content: string;
  contextKind: 'selection' | 'markdown-file';
  filePath?: string | null;
  title?: string | null;
  cwd?: string | null;
};

const agentImproveAPI = {
  launch: (request: AgentImproveLaunchRequest): Promise<{ promptPath: string; command: string }> =>
    ipcRenderer.invoke('agent-improve:launch', request),
};

type AgentImproveAPI = typeof agentImproveAPI;

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
  // Handoffs - global session handoff files
  GET_HANDOFFS: 'commands:getHandoffs',
  GET_HANDOFF_CONTENT: 'commands:getHandoffContent',
  GET_MARKDOWN_PREVIEW: 'commands:getMarkdownPreview',
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
  documentVersion: DocumentVersion;
};

type DocumentVersion = {
  mtimeMs: number;
  size: number;
  sha256: string;
};

type DocumentSaveResult =
  | { ok: true; version: DocumentVersion }
  | { ok: false; reason: 'blocked' | 'conflict' | 'error' | 'not-found'; currentContent?: string; currentVersion?: DocumentVersion };

type HandoffInfo = {
  name: string;
  displayName: string;
  filePath: string;
  lastModified: number;
};

type MarkdownPreview = {
  title: string;
  filePath: string;
  content: string;
};

type FieldTheoryMarkdownTarget = {
  kind: 'wiki' | 'artifact' | 'command';
  path: string;
};

type LauncherPreviewPayload =
  | { kind: 'bookmark'; bookmark: Bookmark }
  | { kind: 'markdown'; title: string; filePath: string; content: string };

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

  getMarkdownPreview: async (filePath: string): Promise<MarkdownPreview | null> => {
    return ipcRenderer.invoke(CommandsIPCChannels.GET_MARKDOWN_PREVIEW, filePath);
  },

  // Save/update a command's content.
  saveCommand: async (filePath: string, content: string, expectedVersion?: DocumentVersion | null): Promise<DocumentSaveResult> => {
    return ipcRenderer.invoke(CommandsIPCChannels.SAVE_COMMAND, filePath, content, expectedVersion);
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
  launcherClose: (options?: { skipActivation?: boolean }): void => {
    ipcRenderer.send('command-launcher:close', options);
  },

  // Write diagnostic breadcrumbs to the command launcher trace log.
  launcherTrace: (event: string, details: Record<string, unknown> = {}): void => {
    ipcRenderer.send('command-launcher:trace', event, details);
  },

  // Show or hide the detached command launcher preview window.
  launcherPreviewShow: (preview: LauncherPreviewPayload): void => {
    ipcRenderer.send('command-launcher:preview-show', preview);
  },

  launcherPreviewHide: (): void => {
    ipcRenderer.send('command-launcher:preview-hide');
  },

  launcherPreviewResize: (height: number): void => {
    ipcRenderer.send('command-launcher:preview-resize', height);
  },

  onLauncherPreviewBookmark: (callback: (bookmark: Bookmark) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, bookmark: Bookmark) => callback(bookmark);
    ipcRenderer.on('command-launcher-preview:bookmark', handler);
    return () => {
      ipcRenderer.removeListener('command-launcher-preview:bookmark', handler);
    };
  },

  onLauncherPreview: (callback: (preview: LauncherPreviewPayload) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, preview: LauncherPreviewPayload) => callback(preview);
    ipcRenderer.on('command-launcher-preview:payload', handler);
    return () => {
      ipcRenderer.removeListener('command-launcher-preview:payload', handler);
    };
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

  // Share a command to the shared pool (routes through main process for auth).
  shareCommand: async (command: { name: string; content: string }): Promise<{ data?: any; error?: string }> => {
    return ipcRenderer.invoke('commands:share', command);
  },

  // Unshare a command from the shared pool.
  unshareCommand: async (commandId: string): Promise<{ success?: boolean; error?: string }> => {
    return ipcRenderer.invoke('commands:unshare', commandId);
  },

  // ==========================================================================
  // Handoffs - Global session handoff files
  // ==========================================================================

  // Get the most recent handoff files.
  getHandoffs: async (limit: number = 10): Promise<HandoffInfo[]> => {
    return ipcRenderer.invoke(CommandsIPCChannels.GET_HANDOFFS, limit);
  },

  // Get the content of a specific handoff by file path.
  getHandoffContent: async (filePath: string): Promise<{ name: string; content: string; filePath: string } | null> => {
    return ipcRenderer.invoke(CommandsIPCChannels.GET_HANDOFF_CONTENT, filePath);
  },

  // Invoke a handoff (same behavior as commands - paste file reference).
  invokeHandoff: async (filePath: string): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('commands:invokeHandoff', filePath);
  },

  getLauncherContext: async (): Promise<{ fieldTheoryActive: boolean }> => {
    return ipcRenderer.invoke('commands:getLauncherContext');
  },

  openFieldTheoryMarkdown: async (target: FieldTheoryMarkdownTarget): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('commands:openFieldTheoryMarkdown', target);
  },

  insertMarkdownText: async (text: string): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('commands:insertMarkdownText', text);
  },

  onOpenMarkdownFromLauncher: (callback: (target: FieldTheoryMarkdownTarget) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, target: FieldTheoryMarkdownTarget) => callback(target);
    ipcRenderer.on('commands:openMarkdownFromLauncher', handler);
    return () => ipcRenderer.removeListener('commands:openMarkdownFromLauncher', handler);
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
  initialTheme: readInitialDarkModeArgument(),
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
type MarkdownTodoState = 'open' | 'done';

interface ReadingMeta {
  path: string;
  title: string;
  context: string | null;
  readingTime: string | null;
  createdAt: number;
  mtime: number;
  todoState?: MarkdownTodoState;
}

// Full reading with content (loaded on demand)
interface Reading extends ReadingMeta {
  content: string;
  documentVersion: DocumentVersion;
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
  saveReading: (filePath: string, content: string, expectedVersion?: DocumentVersion | null): Promise<DocumentSaveResult> =>
    ipcRenderer.invoke('librarian:saveReading', filePath, content, expectedVersion),

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

  onReadingRenamed: (callback: (event: { oldPath: string; reading: ReadingMeta }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: { oldPath: string; reading: ReadingMeta }) => callback(payload);
    ipcRenderer.on('librarian:readingRenamed', handler);
    return () => ipcRenderer.removeListener('librarian:readingRenamed', handler);
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

  setMarkdownEditorFocused: (focused: boolean): void => {
    ipcRenderer.send('librarian:setMarkdownEditorFocused', focused);
  },

  onInsertMarkdownText: (callback: (text: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, text: string) => callback(text);
    ipcRenderer.on('librarian:insertMarkdownText', handler);
    return () => ipcRenderer.removeListener('librarian:insertMarkdownText', handler);
  },

  // Notify main process of immersive mode changes (affects blur-to-hide behavior)
  setImmersiveDismissable: (dismissable: boolean): void => {
    ipcRenderer.send('clipboard-history:setImmersiveDismissable', dismissable);
  },
  setSizeKey: (key: 'fields' | 'library' | 'canvas' | 'draw'): void => {
    ipcRenderer.send('clipboard-history:setSizeKey', key);
  },
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

  // Codex hook management
  getCodexStatus: (): Promise<string> => ipcRenderer.invoke('librarian:getCodexStatus'),
  isCodexHookInstalled: (): Promise<boolean> => ipcRenderer.invoke('librarian:isCodexHookInstalled'),
  installCodexHook: (): Promise<boolean> => ipcRenderer.invoke('librarian:installCodexHook'),
  uninstallCodexHook: (): Promise<boolean> => ipcRenderer.invoke('librarian:uninstallCodexHook'),
  isCodexStopOnPendingEnabled: (): Promise<boolean> => ipcRenderer.invoke('librarian:isCodexStopOnPendingEnabled'),
  setCodexStopOnPendingEnabled: (enabled: boolean): Promise<boolean> => ipcRenderer.invoke('librarian:setCodexStopOnPendingEnabled', enabled),

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
  getAutoShowStealsFocus: (): Promise<boolean> => ipcRenderer.invoke('librarian:getAutoShowStealsFocus'),
  setAutoShowStealsFocus: (enabled: boolean): Promise<void> => ipcRenderer.invoke('librarian:setAutoShowStealsFocus', enabled),

  // Resume after close settings (return to last artifact vs clipboard)
  getResumeAfterClose: (): Promise<boolean> => ipcRenderer.invoke('librarian:getResumeAfterClose'),
  setResumeAfterClose: (enabled: boolean): Promise<void> => ipcRenderer.invoke('librarian:setResumeAfterClose', enabled),
  getImmersiveHeightPercent: (): Promise<number> => ipcRenderer.invoke('librarian:getImmersiveHeightPercent'),
  setImmersiveHeightPercent: (percent: number): Promise<void> => ipcRenderer.invoke('librarian:setImmersiveHeightPercent', percent),

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

  needsReadPermissionUpdate: (): Promise<boolean> =>
    ipcRenderer.invoke('claude:needsReadPermissionUpdate'),

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
// Codex API - Codex CLI integration settings
// =============================================================================

const codexReadPermissionAPI = {
  // Read permission hooks (auto-approve Field Theory file reads)
  isReadPermissionHookInstalled: (): Promise<boolean> =>
    ipcRenderer.invoke('codex:isReadPermissionHookInstalled'),

  installReadPermissionHook: (): Promise<{ success: boolean; message: string }> =>
    ipcRenderer.invoke('codex:installReadPermissionHook'),

  uninstallReadPermissionHook: (): Promise<{ success: boolean; message: string }> =>
    ipcRenderer.invoke('codex:uninstallReadPermissionHook'),
};

type CodexReadPermissionAPI = typeof codexReadPermissionAPI;

// =============================================================================
// Squares API - Window Management (Rectangle-inspired instant snap)
// =============================================================================

const SquaresIPCChannels = {
  EXECUTE_ACTION: 'squares:executeAction',
  GET_WINDOWS: 'squares:getWindows',
  GET_SCREENS: 'squares:getScreens',
  GET_CONFIG: 'squares:getConfig',
  SET_CONFIG: 'squares:setConfig',
  GET_HOTKEYS: 'squares:getHotkeys',
  SET_HOTKEYS: 'squares:setHotkeys',
  RESET_HOTKEYS: 'squares:resetHotkeys',
  GET_HISTORY_COUNT: 'squares:getHistoryCount',
  CLEAR_HISTORY: 'squares:clearHistory',
  ACTION_EXECUTED: 'squares:actionExecuted',
  CONFIG_CHANGED: 'squares:configChanged',
} as const;

const squaresAPI = {
  // Execute a window management action (e.g., leftHalf, grid, focus)
  executeAction: (action: string, source?: 'default' | 'command-launcher'): Promise<boolean> =>
    ipcRenderer.invoke(SquaresIPCChannels.EXECUTE_ACTION, action, source),

  // Get all visible windows
  getWindows: (): Promise<any[]> =>
    ipcRenderer.invoke(SquaresIPCChannels.GET_WINDOWS),

  // Get display/screen info
  getScreens: (): Promise<any[]> =>
    ipcRenderer.invoke(SquaresIPCChannels.GET_SCREENS),

  // Configuration
  getConfig: (): Promise<any> =>
    ipcRenderer.invoke(SquaresIPCChannels.GET_CONFIG),
  setConfig: (config: Record<string, any>): Promise<void> =>
    ipcRenderer.invoke(SquaresIPCChannels.SET_CONFIG, config),
  getHotkeys: (): Promise<any> =>
    ipcRenderer.invoke(SquaresIPCChannels.GET_HOTKEYS),
  setHotkeys: (hotkeys: Record<string, any>): Promise<void> =>
    ipcRenderer.invoke(SquaresIPCChannels.SET_HOTKEYS, hotkeys),
  resetHotkeys: (): Promise<void> =>
    ipcRenderer.invoke(SquaresIPCChannels.RESET_HOTKEYS),

  // History / undo
  getHistoryCount: (): Promise<number> =>
    ipcRenderer.invoke(SquaresIPCChannels.GET_HISTORY_COUNT),
  clearHistory: (): Promise<void> =>
    ipcRenderer.invoke(SquaresIPCChannels.CLEAR_HISTORY),

  // Events
  onActionExecuted: (callback: (action: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, action: string) => callback(action);
    ipcRenderer.on(SquaresIPCChannels.ACTION_EXECUTED, handler);
    return () => ipcRenderer.removeListener(SquaresIPCChannels.ACTION_EXECUTED, handler);
  },
  onConfigChanged: (callback: (config: any) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, config: any) => callback(config);
    ipcRenderer.on(SquaresIPCChannels.CONFIG_CHANGED, handler);
    return () => ipcRenderer.removeListener(SquaresIPCChannels.CONFIG_CHANGED, handler);
  },
};

type SquaresAPIType = typeof squaresAPI;

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

interface WikiPageMeta {
  relPath: string;
  absPath: string;
  name: string;
  title: string;
  lastUpdated: number;
  todoState?: MarkdownTodoState;
}
interface WikiPage extends WikiPageMeta {
  content: string;
  documentVersion: DocumentVersion;
}
interface WikiFolder {
  name: string;
  files: WikiPageMeta[];
}
type WikiNode =
  | { kind: 'file'; relPath: string; absPath: string; name: string; title: string; lastUpdated: number; todoState?: MarkdownTodoState }
  | { kind: 'dir'; name: string; relPath: string; children: WikiNode[] };
interface LibraryRoot {
  path: string;
  label: string;
  builtin: boolean;
  writable?: boolean;
  tree: WikiNode[];
}
interface LibraryRenameEvent {
  rootPath: string;
  oldRelPath: string;
  newRelPath: string;
  oldAbsPath: string;
  newAbsPath: string;
  builtin: boolean;
}
interface LibraryMigrationFile {
  relPath: string;
  sourcePath: string;
  targetPath: string;
}
interface LibraryMigrationConflict extends LibraryMigrationFile {
  conflictCopyPath: string;
}
interface LibraryMigrationPlan {
  sourceDir: string;
  targetDir: string;
  backupDir: string;
  timestamp: string;
  sourceState: string;
  targetState: string;
  filesToCopy: LibraryMigrationFile[];
  identicalFiles: LibraryMigrationFile[];
  conflicts: LibraryMigrationConflict[];
  targetOnlyFiles: string[];
  missingFolders: string[];
  symlinksToCreate: Array<{ linkPath: string; targetPath: string }>;
  blockingIssues: string[];
  canExecute: boolean;
}
interface LibraryMigrationExecutionResult {
  success: boolean;
  copiedFiles: string[];
  skippedIdenticalFiles: string[];
  conflictCopies: Array<{ relPath: string; copiedTo: string }>;
  backupDir: string | null;
  symlinkCreated: boolean;
  errors: string[];
}

const libraryAPI = {
  getRoots: (): Promise<LibraryRoot[]> => ipcRenderer.invoke('library:getRoots'),
  previewMigration: (): Promise<LibraryMigrationPlan> => ipcRenderer.invoke('library:previewMigration'),
  executeMigration: (): Promise<LibraryMigrationExecutionResult> => ipcRenderer.invoke('library:executeMigration'),
  getHiddenFolders: (): Promise<string[]> => ipcRenderer.invoke('library:getHiddenFolders'),
  setFolderHidden: (folderId: string, hidden: boolean): Promise<string[]> =>
    ipcRenderer.invoke('library:setFolderHidden', folderId, hidden),
  addRoot: (dirPath: string): Promise<LibraryRoot | null> => ipcRenderer.invoke('library:addRoot', dirPath),
  removeRoot: (dirPath: string): Promise<boolean> => ipcRenderer.invoke('library:removeRoot', dirPath),
  createFile: (rootPath: string, folderRelPath: string, fileName: string): Promise<WikiPage | null> =>
    ipcRenderer.invoke('library:createFile', rootPath, folderRelPath, fileName),
  createDir: (rootPath: string, dirRelPath: string): Promise<boolean> =>
    ipcRenderer.invoke('library:createDir', rootPath, dirRelPath),
  deleteDir: (rootPath: string, dirRelPath: string): Promise<boolean> =>
    ipcRenderer.invoke('library:deleteDir', rootPath, dirRelPath),
  moveItem: (rootPath: string, kind: 'file' | 'dir', sourceRelPath: string, targetDirRelPath: string): Promise<string | null> =>
    ipcRenderer.invoke('library:moveItem', rootPath, kind, sourceRelPath, targetDirRelPath),
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('library:pickFolder'),
  onRootsChanged: (callback: () => void): (() => void) => {
    const handler = () => callback();
    ipcRenderer.on('library:changed', handler);
    return () => ipcRenderer.removeListener('library:changed', handler);
  },
  onItemRenamed: (callback: (event: LibraryRenameEvent) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: LibraryRenameEvent) => callback(payload);
    ipcRenderer.on('library:renamed', handler);
    return () => ipcRenderer.removeListener('library:renamed', handler);
  },
};

const wikiAPI = {
  getTree: (): Promise<WikiFolder[]> => ipcRenderer.invoke('wiki:getTree'),
  getPage: (relPath: string): Promise<WikiPage | null> => ipcRenderer.invoke('wiki:getPage', relPath),
  findPageByDocumentVersion: (version: DocumentVersion, previousRelPath?: string): Promise<WikiPage | null> =>
    ipcRenderer.invoke('wiki:findPageByDocumentVersion', version, previousRelPath),
  save: (relPath: string, content: string, expectedVersion?: DocumentVersion | null): Promise<DocumentSaveResult> =>
    ipcRenderer.invoke('wiki:save', relPath, content, expectedVersion),
  createFile: (folderName: string, fileName: string): Promise<WikiPage | null> => ipcRenderer.invoke('wiki:createFile', folderName, fileName),
  createFileWithDefaultTitle: (folderName: string): Promise<WikiPage | null> => ipcRenderer.invoke('wiki:createFileWithDefaultTitle', folderName),
  deletePage: (relPath: string): Promise<boolean> => ipcRenderer.invoke('wiki:deletePage', relPath),
  createScratchpadDefault: (): Promise<WikiPage | null> => ipcRenderer.invoke('wiki:createScratchpadDefault'),
  openScratchpadDefault: (): Promise<WikiPage | null> => ipcRenderer.invoke('wiki:openScratchpadDefault'),
  createDir: (dirName: string): Promise<boolean> => ipcRenderer.invoke('wiki:createDir', dirName),
  rename: (relPath: string, newName: string): Promise<string | null> =>
    ipcRenderer.invoke('wiki:rename', relPath, newName),
  onPageChanged: (callback: () => void): (() => void) => {
    const handler = () => callback();
    ipcRenderer.on('wiki:changed', handler);
    return () => ipcRenderer.removeListener('wiki:changed', handler);
  },
  onPageDeleted: (callback: (relPath: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, relPath: string) => callback(relPath);
    ipcRenderer.on('wiki:deleted', handler);
    return () => ipcRenderer.removeListener('wiki:deleted', handler);
  },
  onPageRenamed: (callback: (event: LibraryRenameEvent) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: LibraryRenameEvent) => callback(payload);
    ipcRenderer.on('wiki:renamed', handler);
    return () => ipcRenderer.removeListener('wiki:renamed', handler);
  },
  onOpenWikiPage: (callback: (relPath: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, relPath: string) => callback(relPath);
    ipcRenderer.on('wiki:openPage', handler);
    return () => ipcRenderer.removeListener('wiki:openPage', handler);
  },
  // Hotkey-driven "new scratchpad" flow — main process has already created
  // the file and wants us to switch to Library, open it, and start editing.
  onOpenScratchpad: (callback: (relPath: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: string | { relPath: string }) => {
      if (typeof payload === 'string') {
        callback(payload);
        return;
      }
      callback(payload.relPath);
    };
    ipcRenderer.on('wiki:openScratchpad', handler);
    return () => ipcRenderer.removeListener('wiki:openScratchpad', handler);
  },
};
contextBridge.exposeInMainWorld('libraryAPI', libraryAPI);
contextBridge.exposeInMainWorld('wikiAPI', wikiAPI);

// Local agent kickoff — invoke `claude` or `codex` CLI on a markdown file.
type AgentKickoffModel = 'claude' | 'codex';
interface AgentKickoffArgs {
  absPath: string;
  instruction: string;
  model: AgentKickoffModel;
}
interface AgentKickoffStartResult {
  ok: boolean;
  runId: string;
  absPath?: string;
  model?: AgentKickoffModel;
  error?: string;
}
interface AgentKickoffProgressEvent {
  runId: string;
  absPath: string;
  model: AgentKickoffModel;
  kind: 'stdout' | 'stderr';
  chunk: string;
}
interface AgentKickoffStatusEvent {
  runId: string;
  absPath: string;
  model: AgentKickoffModel;
  status: 'started' | 'done' | 'error';
  message: string;
  error?: string;
}
const agentKickoffAPI = {
  kickoff: (args: AgentKickoffArgs): Promise<AgentKickoffStartResult> =>
    ipcRenderer.invoke('agent:kickoff', args),
  cancel: (runId: string): Promise<boolean> =>
    ipcRenderer.invoke('agent:cancelKickoff', runId),
  onProgress: (callback: (event: AgentKickoffProgressEvent) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: AgentKickoffProgressEvent) =>
      callback(payload);
    ipcRenderer.on('agent:kickoffProgress', handler);
    return () => ipcRenderer.removeListener('agent:kickoffProgress', handler);
  },
  onStatus: (callback: (event: AgentKickoffStatusEvent) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: AgentKickoffStatusEvent) =>
      callback(payload);
    ipcRenderer.on('agent:kickoffStatus', handler);
    return () => ipcRenderer.removeListener('agent:kickoffStatus', handler);
  },
};
contextBridge.exposeInMainWorld('agentKickoffAPI', agentKickoffAPI);

interface ExternalMarkdownFile {
  path: string;
  name: string;
  content: string;
  mtime: number;
  documentVersion: DocumentVersion;
}

const externalAPI = {
  open: (absPath: string): Promise<ExternalMarkdownFile | null> =>
    ipcRenderer.invoke('external:open', absPath),
  save: (absPath: string, content: string, expectedVersion?: DocumentVersion | null): Promise<DocumentSaveResult> =>
    ipcRenderer.invoke('external:save', absPath, content, expectedVersion),
  findLibraryFileByDocumentVersion: (version: DocumentVersion, previousAbsPath?: string): Promise<ExternalMarkdownFile | null> =>
    ipcRenderer.invoke('external:findLibraryFileByDocumentVersion', version, previousAbsPath),
  rename: (absPath: string, newName: string): Promise<ExternalMarkdownFile | null> =>
    ipcRenderer.invoke('external:rename', absPath, newName),
  onOpenExternal: (callback: (absPath: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, absPath: string) => callback(absPath);
    ipcRenderer.on('external:openPage', handler);
    return () => ipcRenderer.removeListener('external:openPage', handler);
  },
};
contextBridge.exposeInMainWorld('externalAPI', externalAPI);

interface RecentEntry {
  kind: 'wiki' | 'external';
  path: string;
  title: string;
  lastOpenedAt: number;
}

const recentAPI = {
  list: (): Promise<RecentEntry[]> => ipcRenderer.invoke('recent:list'),
  visit: (entry: RecentEntry): Promise<RecentEntry[]> => ipcRenderer.invoke('recent:visit', entry),
  remove: (kind: 'wiki' | 'external', entryPath: string): Promise<RecentEntry[]> =>
    ipcRenderer.invoke('recent:remove', kind, entryPath),
  onChanged: (callback: () => void): (() => void) => {
    const handler = () => callback();
    ipcRenderer.on('recent:changed', handler);
    return () => ipcRenderer.removeListener('recent:changed', handler);
  },
};
contextBridge.exposeInMainWorld('recentAPI', recentAPI);

interface BookmarkImage {
  url: string;
  width: number;
  height: number;
  type: string;
  videoUrl?: string;
  localFilename?: string;
  localVideoFilename?: string;
}
interface QuotedTweet {
  id: string;
  text: string;
  authorHandle: string;
  authorName: string;
  authorAvatar: string;
  localAvatarFilename?: string;
  postedAt: string;
  url: string;
  images: BookmarkImage[];
}
interface Bookmark {
  id: string;
  sourceType: 'x' | 'web';
  text: string;
  url: string;
  authorHandle: string;
  authorName: string;
  authorAvatar: string;
  localAvatarFilename?: string;
  postedAt: string;
  images: BookmarkImage[];
  mediaCount: number;
  likeCount: number;
  repostCount: number;
  bookmarkCount: number;
  folders: string[];
  quotedTweet?: QuotedTweet;
  title?: string;
  domain?: string;
  excerpt?: string;
  savedAt?: string;
  markdownPath?: string;
}
interface BookmarkFolder { name: string; id?: string }
interface BookmarksSnapshot { bookmarks: Bookmark[]; folders: BookmarkFolder[] }
interface ActiveWebPage {
  url: string;
  title: string;
  bundleId: string;
  appName: string;
}
interface BookmarkAuthorSummary {
  handle: string;
  name: string;
  count: number;
  firstPostedAt: string;
  lastPostedAt: string;
}

const bookmarksAPI = {
  getAll: (): Promise<BookmarksSnapshot> => ipcRenderer.invoke('bookmarks:getAll'),
  syncIfStale: (): Promise<{ status: string; error?: string }> => ipcRenderer.invoke('bookmarks:syncIfStale'),
  getAuthors: (): Promise<BookmarkAuthorSummary[]> => ipcRenderer.invoke('bookmarks:getAuthors'),
  getAuthorBookmarks: (handle: string): Promise<Bookmark[]> =>
    ipcRenderer.invoke('bookmarks:getAuthorBookmarks', handle),
  getTaxonomyBookmarks: (filePaths: string[]): Promise<Bookmark[]> =>
    ipcRenderer.invoke('bookmarks:getTaxonomyBookmarks', filePaths),
  search: (query: string): Promise<Bookmark[]> => ipcRenderer.invoke('bookmarks:search', query),
  saveWebUrl: (url: string): Promise<{ success: boolean; bookmark?: Bookmark; markdownPath?: string; created?: boolean; error?: string }> =>
    ipcRenderer.invoke('bookmarks:saveWebUrl', url),
  getActiveWebPage: (): Promise<{ success: boolean; page?: ActiveWebPage; error?: string }> =>
    ipcRenderer.invoke('bookmarks:getActiveWebPage'),
  saveActiveWebPage: (): Promise<{ success: boolean; page?: ActiveWebPage; bookmark?: Bookmark; markdownPath?: string; created?: boolean; error?: string }> =>
    ipcRenderer.invoke('bookmarks:saveActiveWebPage'),
  invokeBookmark: (id: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('bookmarks:invokeBookmark', id),
  copyForAgent: (id: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('bookmarks:copyForAgent', id),
  invokeAuthorTimeline: (handle: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('bookmarks:invokeAuthorTimeline', handle),
  onChanged: (callback: () => void): (() => void) => {
    const handler = () => callback();
    ipcRenderer.on('bookmarks:changed', handler);
    return () => ipcRenderer.removeListener('bookmarks:changed', handler);
  },
};
contextBridge.exposeInMainWorld('bookmarksAPI', bookmarksAPI);

interface AgentHookTargets { claude?: boolean; codex?: boolean }
interface AgentHookStatus { claude: boolean; codex: boolean }
interface AgentHookResult { success: boolean; message: string; claude: boolean; codex: boolean }

const agentHooksAPI = {
  install: (targets: AgentHookTargets): Promise<AgentHookResult> =>
    ipcRenderer.invoke('agent-hooks:install', targets),
  uninstall: (targets: AgentHookTargets): Promise<AgentHookResult> =>
    ipcRenderer.invoke('agent-hooks:uninstall', targets),
  getStatus: (): Promise<AgentHookStatus> =>
    ipcRenderer.invoke('agent-hooks:status'),
};
contextBridge.exposeInMainWorld('agentHooksAPI', agentHooksAPI);

contextBridge.exposeInMainWorld('agentImproveAPI', agentImproveAPI);
contextBridge.exposeInMainWorld('shellAPI', shellAPI);
contextBridge.exposeInMainWorld('diagnosticsAPI', diagnosticsAPI);
contextBridge.exposeInMainWorld('quotaAPI', quotaAPI);
contextBridge.exposeInMainWorld('accountAPI', accountAPI);
contextBridge.exposeInMainWorld('audioAPI', audioAPI);
contextBridge.exposeInMainWorld('gazeAPI', gazeAPI);
contextBridge.exposeInMainWorld('hotkeyAPI', hotkeyAPI);
contextBridge.exposeInMainWorld('transcribeAPI', transcribeAPI);
contextBridge.exposeInMainWorld('clipboardAPI', clipboardAPI);
contextBridge.exposeInMainWorld('permissionsAPI', permissionsAPI);
contextBridge.exposeInMainWorld('onboardingAPI', onboardingAPI);
contextBridge.exposeInMainWorld('updaterAPI', updaterAPI);
contextBridge.exposeInMainWorld('todoAPI', todoAPI);
contextBridge.exposeInMainWorld('taggedDocsAPI', taggedDocsAPI);
contextBridge.exposeInMainWorld('authAPI', authAPI);
contextBridge.exposeInMainWorld('sharedClipboardAPI', sharedClipboardAPI);
contextBridge.exposeInMainWorld('socialAPI', socialAPI);
contextBridge.exposeInMainWorld('commandsAPI', commandsAPI);
contextBridge.exposeInMainWorld('metricsAPI', metricsAPI);
contextBridge.exposeInMainWorld('claudeAPI', claudeAPI);
contextBridge.exposeInMainWorld('cursorAPI', cursorAPI);
contextBridge.exposeInMainWorld('codexReadPermissionAPI', codexReadPermissionAPI);
contextBridge.exposeInMainWorld('squaresAPI', squaresAPI);

// Hot Mic API - continuous voice input for Claude Code terminals
const hotMicAPI = {
  getInputMode: async (): Promise<'hot-mic' | 'standard'> => {
    return ipcRenderer.invoke('hotmic:getInputMode');
  },
  setInputMode: async (mode: 'hot-mic' | 'standard'): Promise<'hot-mic' | 'standard'> => {
    return ipcRenderer.invoke('hotmic:setInputMode', mode);
  },
  getStatus: async (): Promise<{ state: string; muted: boolean }> => {
    return ipcRenderer.invoke('hotmic:getStatus');
  },
  getState: async (): Promise<string> => {
    return ipcRenderer.invoke('hotmic:getState');
  },
  getMuted: async (): Promise<boolean> => {
    return ipcRenderer.invoke('hotmic:getMuted');
  },
  getEnabled: async (): Promise<boolean> => {
    return ipcRenderer.invoke('hotmic:getEnabled');
  },
  getTranscriptionEngineMode: async (): Promise<'default' | 'whisper' | 'mlx-whisper' | 'parakeet' | 'parakeet-multilingual'> => {
    return ipcRenderer.invoke('hotmic:getTranscriptionEngineMode');
  },
  setTranscriptionEngineMode: async (mode: 'default' | 'whisper' | 'mlx-whisper' | 'parakeet' | 'parakeet-multilingual'): Promise<'default' | 'whisper' | 'mlx-whisper' | 'parakeet' | 'parakeet-multilingual'> => {
    return ipcRenderer.invoke('hotmic:setTranscriptionEngineMode', mode);
  },
  getWhisperModel: async (): Promise<string> => {
    return ipcRenderer.invoke('hotmic:getWhisperModel');
  },
  setWhisperModel: async (model: string): Promise<string> => {
    return ipcRenderer.invoke('hotmic:setWhisperModel', model);
  },
  setEnabled: async (enabled: boolean): Promise<boolean> => {
    return ipcRenderer.invoke('hotmic:setEnabled', enabled);
  },
  getTargetApp: async (): Promise<string | null> => {
    return ipcRenderer.invoke('hotmic:getTargetApp');
  },
  setTargetApp: async (bundleId: string | null): Promise<string | null> => {
    return ipcRenderer.invoke('hotmic:setTargetApp', bundleId);
  },
  getSoundsEnabled: async (): Promise<boolean> => {
    return ipcRenderer.invoke('hotmic:getSoundsEnabled');
  },
  setSoundsEnabled: async (enabled: boolean): Promise<boolean> => {
    return ipcRenderer.invoke('hotmic:setSoundsEnabled', enabled);
  },
  getBackgroundFilterEnabled: async (): Promise<boolean> => {
    return ipcRenderer.invoke('hotmic:getBackgroundFilterEnabled');
  },
  setBackgroundFilterEnabled: async (enabled: boolean): Promise<boolean> => {
    return ipcRenderer.invoke('hotmic:setBackgroundFilterEnabled', enabled);
  },
  getBackgroundFilterStrength: async (): Promise<number> => {
    return ipcRenderer.invoke('hotmic:getBackgroundFilterStrength');
  },
  setBackgroundFilterStrength: async (strength: number): Promise<number> => {
    return ipcRenderer.invoke('hotmic:setBackgroundFilterStrength', strength);
  },
  getDrawerTextSize: async (): Promise<number> => {
    return ipcRenderer.invoke('hotmic:getDrawerTextSize');
  },
  setDrawerTextSize: async (size: number): Promise<number> => {
    return ipcRenderer.invoke('hotmic:setDrawerTextSize', size);
  },
  getIslandGeometry: async (): Promise<{
    notchWidthOverride: number;
    pillWidth: number;
    pillHeight: number;
    offsetX: number;
    offsetY: number;
  }> => {
    return ipcRenderer.invoke('hotmic:getIslandGeometry');
  },
  setIslandGeometry: async (geometry: Partial<{
    notchWidthOverride: number;
    pillWidth: number;
    pillHeight: number;
    offsetX: number;
    offsetY: number;
  }>): Promise<{
    notchWidthOverride: number;
    pillWidth: number;
    pillHeight: number;
    offsetX: number;
    offsetY: number;
  }> => {
    return ipcRenderer.invoke('hotmic:setIslandGeometry', geometry);
  },
  resetIslandGeometry: async (): Promise<{
    notchWidthOverride: number;
    pillWidth: number;
    pillHeight: number;
    offsetX: number;
    offsetY: number;
  }> => {
    return ipcRenderer.invoke('hotmic:resetIslandGeometry');
  },
  getResolvedIslandGeometry: async (): Promise<{
    notchWidthOverride: number;
    pillWidth: number;
    pillHeight: number;
    offsetX: number;
    offsetY: number;
  } | null> => {
    return ipcRenderer.invoke('hotmic:getResolvedIslandGeometry');
  },
  getIslandStayOnLaptop: async (): Promise<boolean> => {
    return ipcRenderer.invoke('hotmic:getIslandStayOnLaptop');
  },
  setIslandStayOnLaptop: async (value: boolean): Promise<boolean> => {
    return ipcRenderer.invoke('hotmic:setIslandStayOnLaptop', value);
  },
  getIslandAutoHide: async (): Promise<boolean> => {
    return ipcRenderer.invoke('hotmic:getIslandAutoHide');
  },
  setIslandAutoHide: async (value: boolean): Promise<boolean> => {
    return ipcRenderer.invoke('hotmic:setIslandAutoHide', value);
  },
  getSubmitWord: async (): Promise<string> => {
    return ipcRenderer.invoke('hotmic:getSubmitWord');
  },
  setSubmitWord: async (word: string): Promise<string> => {
    return ipcRenderer.invoke('hotmic:setSubmitWord', word);
  },
  getHotkey: async (): Promise<string | null> => {
    return ipcRenderer.invoke('hotmic:getHotkey');
  },
  setHotkey: async (hotkey: string | null): Promise<boolean> => {
    return ipcRenderer.invoke('hotmic:setHotkey', hotkey);
  },
  getPasteWords: async (): Promise<string> => {
    return ipcRenderer.invoke('hotmic:getPasteWords');
  },
  setPasteWords: async (words: string): Promise<string> => {
    return ipcRenderer.invoke('hotmic:setPasteWords', words);
  },
  getShowWordCount: async (): Promise<boolean> => {
    return ipcRenderer.invoke('hotmic:getShowWordCount');
  },
  setShowWordCount: async (enabled: boolean): Promise<boolean> => {
    return ipcRenderer.invoke('hotmic:setShowWordCount', enabled);
  },
  getCancelWords: async (): Promise<string> => {
    return ipcRenderer.invoke('hotmic:getCancelWords');
  },
  setCancelWords: async (words: string): Promise<string> => {
    return ipcRenderer.invoke('hotmic:setCancelWords', words);
  },
  getScrapWords: async (): Promise<string> => {
    return ipcRenderer.invoke('hotmic:getScrapWords');
  },
  setScrapWords: async (words: string): Promise<string> => {
    return ipcRenderer.invoke('hotmic:setScrapWords', words);
  },
  getPrevWindowWords: async (): Promise<string> => {
    return ipcRenderer.invoke('hotmic:getPrevWindowWords');
  },
  setPrevWindowWords: async (words: string): Promise<string> => {
    return ipcRenderer.invoke('hotmic:setPrevWindowWords', words);
  },
  getNewWindowWords: async (): Promise<string> => {
    return ipcRenderer.invoke('hotmic:getNewWindowWords');
  },
  setNewWindowWords: async (words: string): Promise<string> => {
    return ipcRenderer.invoke('hotmic:setNewWindowWords', words);
  },
  getCloseWindowWords: async (): Promise<string> => {
    return ipcRenderer.invoke('hotmic:getCloseWindowWords');
  },
  setCloseWindowWords: async (words: string): Promise<string> => {
    return ipcRenderer.invoke('hotmic:setCloseWindowWords', words);
  },
  getMinimizePhrases: async (): Promise<string> => {
    return ipcRenderer.invoke('hotmic:getMinimizePhrases');
  },
  setMinimizePhrases: async (words: string): Promise<string> => {
    return ipcRenderer.invoke('hotmic:setMinimizePhrases', words);
  },
  getHidePhrases: async (): Promise<string> => {
    return ipcRenderer.invoke('hotmic:getHidePhrases');
  },
  setHidePhrases: async (words: string): Promise<string> => {
    return ipcRenderer.invoke('hotmic:setHidePhrases', words);
  },
  getQuitPhrases: async (): Promise<string> => {
    return ipcRenderer.invoke('hotmic:getQuitPhrases');
  },
  setQuitPhrases: async (words: string): Promise<string> => {
    return ipcRenderer.invoke('hotmic:setQuitPhrases', words);
  },
  getSwitchWords: async (): Promise<string> => {
    return ipcRenderer.invoke('hotmic:getSwitchWords');
  },
  setSwitchWords: async (words: string): Promise<string> => {
    return ipcRenderer.invoke('hotmic:setSwitchWords', words);
  },
  getOpenAppPrefixes: async (): Promise<string> => {
    return ipcRenderer.invoke('hotmic:getOpenAppPrefixes');
  },
  setOpenAppPrefixes: async (words: string): Promise<string> => {
    return ipcRenderer.invoke('hotmic:setOpenAppPrefixes', words);
  },
  getQuitAppPrefixes: async (): Promise<string> => {
    return ipcRenderer.invoke('hotmic:getQuitAppPrefixes');
  },
  setQuitAppPrefixes: async (words: string): Promise<string> => {
    return ipcRenderer.invoke('hotmic:setQuitAppPrefixes', words);
  },
  getRunClaudeWords: async (): Promise<string> => {
    return ipcRenderer.invoke('hotmic:getRunClaudeWords');
  },
  setRunClaudeWords: async (words: string): Promise<string> => {
    return ipcRenderer.invoke('hotmic:setRunClaudeWords', words);
  },
  getRunCodexWords: async (): Promise<string> => {
    return ipcRenderer.invoke('hotmic:getRunCodexWords');
  },
  setRunCodexWords: async (words: string): Promise<string> => {
    return ipcRenderer.invoke('hotmic:setRunCodexWords', words);
  },
  getRestartServerWords: async (): Promise<string> => {
    return ipcRenderer.invoke('hotmic:getRestartServerWords');
  },
  setRestartServerWords: async (words: string): Promise<string> => {
    return ipcRenderer.invoke('hotmic:setRestartServerWords', words);
  },
  getRestartServerCommand: async (): Promise<string> => {
    return ipcRenderer.invoke('hotmic:getRestartServerCommand');
  },
  setRestartServerCommand: async (command: string): Promise<string> => {
    return ipcRenderer.invoke('hotmic:setRestartServerCommand', command);
  },
  getFocusPhrases: async (): Promise<string> => {
    return ipcRenderer.invoke('hotmic:getFocusPhrases');
  },
  setFocusPhrases: async (words: string): Promise<string> => {
    return ipcRenderer.invoke('hotmic:setFocusPhrases', words);
  },
  getCascadePhrases: async (): Promise<string> => {
    return ipcRenderer.invoke('hotmic:getCascadePhrases');
  },
  setCascadePhrases: async (words: string): Promise<string> => {
    return ipcRenderer.invoke('hotmic:setCascadePhrases', words);
  },
  getRectangleCommands: async (): Promise<Record<string, string>> => {
    return ipcRenderer.invoke('hotmic:getRectangleCommands');
  },
  setRectangleCommands: async (commands: Record<string, string>): Promise<Record<string, string>> => {
    return ipcRenderer.invoke('hotmic:setRectangleCommands', commands);
  },
  getSystemCommands: async (): Promise<Record<string, string>> => {
    return ipcRenderer.invoke('hotmic:getSystemCommands');
  },
  setSystemCommand: async (action: string, phrases: string): Promise<boolean> => {
    return ipcRenderer.invoke('hotmic:setSystemCommand', action, phrases);
  },
  getKnownTerminals: async (): Promise<Array<{ name: string; bundleId: string }>> => {
    return ipcRenderer.invoke('hotmic:getKnownTerminals');
  },
  start: async (): Promise<void> => {
    return ipcRenderer.invoke('hotmic:start');
  },
  stop: async (): Promise<void> => {
    return ipcRenderer.invoke('hotmic:stop');
  },
  isHookInstalled: async (): Promise<boolean> => {
    return ipcRenderer.invoke('hotmic:isHookInstalled');
  },
  installHook: async (): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('hotmic:installHook');
  },
  uninstallHook: async (): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('hotmic:uninstallHook');
  },
  resetCommandDefaults: async (): Promise<boolean> => {
    return ipcRenderer.invoke('hotmic:resetCommandDefaults');
  },
  onStateChanged: (callback: (state: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: string) => {
      callback(state);
    };
    ipcRenderer.on('hotmic:stateChanged', handler);
    return () => {
      ipcRenderer.removeListener('hotmic:stateChanged', handler);
    };
  },
  getRuntimeStatus: async () => {
    return ipcRenderer.invoke('hotmic:getRuntimeStatus');
  },
  onRuntimeStatusChanged: (callback: (status: any) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: any) => {
      callback(status);
    };
    ipcRenderer.on('hotmic:runtimeStatusChanged', handler);
    return () => {
      ipcRenderer.removeListener('hotmic:runtimeStatusChanged', handler);
    };
  },
  onStatusChanged: (callback: (status: { state: string; muted: boolean }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: { state: string; muted: boolean }) => {
      callback(status);
    };
    ipcRenderer.on('hotmic:statusChanged', handler);
    return () => {
      ipcRenderer.removeListener('hotmic:statusChanged', handler);
    };
  },
  onInputModeChanged: (callback: (mode: 'hot-mic' | 'standard') => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, mode: 'hot-mic' | 'standard') => {
      callback(mode);
    };
    ipcRenderer.on('hotmic:inputModeChanged', handler);
    return () => {
      ipcRenderer.removeListener('hotmic:inputModeChanged', handler);
    };
  },
};
contextBridge.exposeInMainWorld('hotMicAPI', hotMicAPI);

// =============================================================================
// Auto-subscribe to auth debug events for DevTools visibility
// =============================================================================
// This ensures auth events are always logged to the DevTools console without
// requiring any code in the renderer to subscribe.
ipcRenderer.on('auth:debug', (_event, debugEvent: {
  timestamp: string;
  event: string;
  details: Record<string, unknown>;
  level: 'info' | 'warn' | 'error' | 'recovery';
}) => {
  const levelStyles: Record<string, string> = {
    info: 'background: #3b82f6; color: white; padding: 2px 6px; border-radius: 3px;',
    warn: 'background: #f59e0b; color: white; padding: 2px 6px; border-radius: 3px;',
    error: 'background: #ef4444; color: white; padding: 2px 6px; border-radius: 3px;',
    recovery: 'background: #10b981; color: white; padding: 2px 6px; border-radius: 3px;',
  };
  const style = levelStyles[debugEvent.level] || levelStyles.info;
  const time = debugEvent.timestamp.split('T')[1]?.split('.')[0] || debugEvent.timestamp;

  console.log(
    `%c AUTH ${debugEvent.level.toUpperCase()} %c ${debugEvent.event}`,
    style,
    'color: inherit; font-weight: bold;',
    debugEvent.details,
    `[${time}]`
  );
});
contextBridge.exposeInMainWorld('scenarioAPI', scenarioAPI);

contextBridge.exposeInMainWorld('platform', {
  isMacOS: process.platform === 'darwin',
  isWindows: process.platform === 'win32',
  isLinux: process.platform === 'linux',
});

// Stripe configuration - always use live links.
contextBridge.exposeInMainWorld('stripeConfig', {
  // Payment link for upgrading to Pro
  paymentLink: 'https://buy.stripe.com/cNi28rg5odGtbvjdUy3Ru01',
  // Customer portal for managing subscription
  portalLink: 'https://billing.stripe.com/p/login/14A00j3iCbyl6aZ3fU3Ru00',
});

declare global {
  interface Window {
    audioAPI: AudioAPI;
    gazeAPI: GazeAPI;
    transcribeAPI: TranscribeAPI;
    clipboardAPI: ClipboardAPI;
    permissionsAPI: PermissionsAPI;
    onboardingAPI: OnboardingAPI;
    updaterAPI: UpdaterAPI;
    todoAPI: TodoAPI;
    taggedDocsAPI: TaggedDocsAPI;
    authAPI: AuthAPI;
    sharedClipboardAPI: SharedClipboardAPI;
    socialAPI: SocialAPI;
    quotaAPI: QuotaAPI;
    accountAPI: AccountAPI;
    shellAPI: ShellAPI;
    agentImproveAPI: AgentImproveAPI;
    diagnosticsAPI: DiagnosticsAPI;
    commandsAPI: CommandsAPI;
    librarianAPI: LibrarianAPI;
    metricsAPI: MetricsAPI;
    squaresAPI: SquaresAPIType;
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
