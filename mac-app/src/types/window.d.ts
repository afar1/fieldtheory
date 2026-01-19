// =============================================================================
// Window Type Declarations - Extend the Window interface with our APIs.
// =============================================================================

/**
 * Audio device transport type.
 */
type TransportType = 'usb' | 'bluetooth' | 'built-in' | 'other';

/**
 * Represents an audio device.
 */
interface AudioDevice {
  id: string;
  name: string;
  isInput: boolean;
  isOutput: boolean;
  manufacturer?: string;
  transportType?: TransportType;
}

/**
 * Complete audio state.
 */
interface AudioState {
  devices: AudioDevice[];
  defaultInputId: string | null;
  priorityMode: boolean;
  priorityDeviceId: string | null;
  userOverrideId: string | null;
}

/**
 * The audio API exposed by the preload script.
 */
interface AudioAPI {
  getState: () => Promise<AudioState>;
  setPriorityMode: (enabled: boolean) => Promise<void>;
  setPriorityDevice: (deviceId: string | null) => Promise<void>;
  resetOverride: () => Promise<void>;
  onStateChanged: (callback: (state: AudioState) => void) => () => void;
}

/**
 * Transcription status.
 */
type TranscriptionStatus = 'idle' | 'recording' | 'transcribing';

/**
 * Model download status.
 */
type ModelStatus = 'downloaded' | 'downloading' | 'missing';

/**
 * Sound configuration for recording actions.
 */
interface SoundConfig {
  enabled: boolean;
  recordingStart: string | undefined;
  recordingStop: string | undefined;
  recordingCancel: string | undefined;
  windowOpen: string | undefined;
  windowClose: string | undefined;
  transcribing: string | undefined;
  paste: string | undefined;
}

/**
 * Sound option for UI display.
 */
interface SoundOption {
  id: string;
  name: string;
  category: string;
}

/**
 * The transcription API exposed by the preload script.
 */
interface TranscribeAPI {
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
  getSecondaryHotkey?: () => Promise<string | null>;
  setSecondaryHotkey?: (hotkey: string | null) => Promise<boolean>;
  getOverlayStyle: () => Promise<'rectangle' | 'top-emerging'>;
  setOverlayStyle: (style: 'rectangle' | 'top-emerging') => Promise<void>;
  getAbandonHotkey?: () => Promise<string>;
  setAbandonHotkey?: (hotkey: string) => Promise<boolean>;
  getAbandonConfirmation?: () => Promise<boolean>;
  setAbandonConfirmation?: (enabled: boolean) => Promise<void>;
  getAutoImprove?: () => Promise<boolean>;
  setAutoImprove?: (enabled: boolean) => Promise<void>;
  getAutoImproveMinWords?: () => Promise<number>;
  setAutoImproveMinWords?: (minWords: number) => Promise<void>;
  getAutoImproveStats?: () => Promise<{ wordsImproved: number; apiCalls: number; inputTokens: number; outputTokens: number }>;
  resetAutoImproveStats?: () => Promise<void>;
  getDownloadingModels?: () => Promise<string[]>;
  toggleRecording?: () => Promise<void>;
  getSoundConfig?: () => Promise<SoundConfig>;
  setSoundConfig?: (config: Partial<SoundConfig>) => Promise<void>;
  getAvailableSounds?: () => Promise<SoundOption[]>;
  previewSound?: (soundId: string) => Promise<void>;
  getStackCount: () => Promise<number>;
  addToStack: (itemId: number) => Promise<void>;
  onStatusChanged: (callback: (status: TranscriptionStatus) => void) => () => void;
  onResult: (callback: (text: string) => void) => () => void;
  onError: (callback: (error: string) => void) => () => void;
  onModelDownloadProgress: (callback: (downloaded: number, total: number) => void) => () => void;
  onHotkeyChanged: (callback: (hotkey: string) => void) => () => void;
  onStackChanged: (callback: (count: number) => void) => () => void;
}

/**
 * Clipboard item type.
 */
type ClipboardItemType = 'text' | 'image' | 'transcript' | 'screenshot';

/**
 * Source device for clipboard items.
 */
type ClipboardSource = 'mac' | 'ios';

/**
 * Clipboard item.
 */
interface ClipboardItem {
  id: number;
  type: ClipboardItemType;
  content: string | null;
  improvedContent: string | null; // Improved version from Engineer feature
  useImprovedVersion: boolean; // Toggle between improved and original text
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
}

/**
 * Summary info for a stack of items.
 */
interface StackInfo {
  stackId: string;
  itemCount: number;
  imageCount: number;
  textCount: number;
  createdAt: number;
  firstTextPreview: string | null;
}

/**
 * Continuous Context mode state.
 */
interface ContinuousContextState {
  active: boolean;
  stackId: string | null;
  screenshotCount: number;
}

/**
 * Clipboard query options.
 */
interface ClipboardQueryOptions {
  type?: ClipboardItemType;
  search?: string;
  limit?: number;
  offset?: number;
  source?: ClipboardSource;
}

/**
 * Clipboard hotkeys.
 */
interface ClipboardHotkeys {
  screenshot?: string;
  fullScreen?: string;
  activeWindow?: string;
  history?: string;
  continuousContext?: string;
}

/**
 * Represents a running application with its bundle ID and display name.
 */
interface RunningApp {
  bundleId: string;
  name: string;
}

/**
 * Target app info sent when clipboard history window is shown.
 */
interface TargetAppInfo {
  previousApp?: RunningApp | null;
  targetApp: RunningApp | null;
  runningApps: RunningApp[];
}

/**
 * The clipboard API exposed by the preload script.
 */
interface ClipboardAPI {
  queryItems: (options?: ClipboardQueryOptions) => Promise<ClipboardItem[]>;
  getItem: (id: number) => Promise<ClipboardItem | null>;
  deleteItem: (id: number) => Promise<void>;
  restoreItem?: (item: ClipboardItem) => Promise<number>;
  pasteText?: (text: string, targetBundleId?: string) => Promise<void>;

  // All-time stats for footer display
  getAllTimeStats?: () => Promise<{ stacks: number; transcriptions: number; screenshots: number; improved: number; words: number }>;
  incrementImprovedCount?: () => Promise<number>;
  
  clearAll: () => Promise<void>;
  captureScreenshot: (region?: boolean) => Promise<number>;
  getHotkeys: () => Promise<ClipboardHotkeys>;
  setHotkeys: (hotkeys: ClipboardHotkeys) => Promise<boolean>;
  pasteItem: (id: number, targetBundleId?: string) => Promise<void>;
  copyItem: (id: number) => Promise<void>;
  pasteStack: (ids: number[], targetBundleId?: string) => Promise<void>;
  separateIntoTasks: (id: number) => Promise<void>;
  // Target app management.
  getTargetApp: () => Promise<RunningApp | null>;
  setTargetApp: (app: RunningApp | null) => Promise<void>;
  getRunningApps: () => Promise<RunningApp[]>;
  pasteToApp: (bundleId: string) => Promise<boolean>;
  onItemAdded: (callback: (id: number) => void) => () => void;
  onItemDeleted: (callback: (id: number) => void) => () => void;
  onShowHistory: (callback: () => void) => () => void;
  onShowSettings?: (callback: () => void) => () => void;
  onDialogPosition: (callback: (position: { left: number; top: number }) => void) => () => void;
  onDialogBounds: (callback: (bounds: { x: number; y: number; width: number; height: number; overlayWidth: number; overlayHeight: number }) => void) => () => void;
  onTargetAppInfo: (callback: (info: TargetAppInfo) => void) => () => void;
  saveBounds: (bounds: { x: number; y: number; width: number; height: number }) => Promise<void>;
  onKeyEvent: (callback: (event: { characters: string; keyCode: number; modifiers: string[] }) => void) => () => void;
  closeWindow: () => Promise<void>;
  showNoTargetError?: (message?: string) => void;
  setSketchMode?: (active: boolean) => void;
  
  // Stack operations for prompt stacking feature
  queryItemsByStackId?: (stackId: string) => Promise<ClipboardItem[]>;
  getUniqueStacks?: () => Promise<StackInfo[]>;
  updateStackId?: (itemIds: number[], stackId: string | null) => Promise<void>;
  startDrag?: (stackId: string) => Promise<void>;
  
  // API key management (stored securely via OS keychain)
  getApiKeyStatus?: () => Promise<{ hasKey: boolean }>;
  getApiKeyInfo?: () => Promise<{ hasKey: boolean; maskedKey: string | null; provider: string }>;
  testApiKey?: () => Promise<{ success: boolean; error?: string; provider?: string; warning?: string }>;
  setApiKey?: (apiKey: string) => Promise<{ success: boolean; error?: string }>;
  clearApiKey?: () => Promise<{ success: boolean; error?: string }>;

  // Local LLM model management
  getLocalLLMModels?: () => Promise<Record<string, { name: string; filename: string; sizeBytes: number; description: string }>>;
  getLocalLLMStatus?: () => Promise<Record<string, boolean>>;
  getLocalLLMSelected?: () => Promise<string>;
  setLocalLLMSelected?: (model: string) => Promise<{ success: boolean; error?: string }>;
  downloadLocalLLM?: (model: string) => Promise<{ success: boolean; error?: string }>;
  deleteLocalLLM?: (model: string) => Promise<{ success: boolean; error?: string }>;
  getUseLocalLLM?: () => Promise<boolean>;
  setUseLocalLLM?: (useLocal: boolean) => Promise<{ success: boolean; error?: string }>;
  onLocalLLMDownloadProgress?: (callback: (data: { model: string; downloaded: number; total: number }) => void) => () => void;

  // Improved content management - store/clear improved versions of transcriptions
  saveImprovedContent?: (itemId: number, improvedContent: string) => Promise<{ success: boolean; error?: string }>;
  clearImprovedContent?: (itemId: number) => Promise<{ success: boolean; error?: string }>;
  setUseImprovedVersion?: (itemId: number, useImproved: boolean) => Promise<{ success: boolean; error?: string }>;
  
  // Mobile sync operations - sync iOS transcriptions to clipboard history
  setSyncSession?: (accessToken: string, refreshToken: string) => Promise<boolean>;
  clearSyncSession?: () => Promise<boolean>;
  syncMobileTranscripts?: () => Promise<number>;
  forceSyncAll?: () => Promise<number>;
  getSyncEnabled?: () => Promise<boolean>;
  setSyncEnabled?: (enabled: boolean) => Promise<boolean>;
  
  // Continuous Context mode - multi-screenshot capture sessions
  getContinuousContextState?: () => Promise<ContinuousContextState>;
  getContinuousContextEnabled?: () => Promise<boolean>;
  setContinuousContextEnabled?: (enabled: boolean) => Promise<boolean>;
  getContinuousContextHotkey?: () => Promise<string>;
  setContinuousContextHotkey?: (hotkey: string) => Promise<boolean>;
  startContinuousContext?: () => Promise<void>;
  stopContinuousContext?: () => Promise<void>;
  onContinuousContextChanged?: (callback: (state: ContinuousContextState) => void) => () => void;

  // Permission banner settings
  getHideScreenRecordingBanner?: () => Promise<boolean>;
  setHideScreenRecordingBanner?: (hide: boolean) => Promise<boolean>;
  
  // Cursor status indicator settings
  getCursorStatusEnabled?: () => Promise<boolean>;
  setCursorStatusEnabled?: (enabled: boolean) => Promise<boolean>;
  getHideStatusLabels?: () => Promise<boolean>;
  setHideStatusLabels?: (hide: boolean) => Promise<boolean>;

  getSoundsEnabled?: () => Promise<boolean>;
  setSoundsEnabled?: (enabled: boolean) => Promise<boolean>;
  getTasksTabEnabled?: () => Promise<boolean>;
  setTasksTabEnabled?: (enabled: boolean) => Promise<boolean>;
  
  // Show in Dock and Cmd+Tab
  getShowInDock?: () => Promise<boolean>;
  setShowInDock?: (show: boolean) => Promise<boolean>;
  onTasksTabToggled?: (callback: (enabled: boolean) => void) => () => void;

  // Launch at login
  getLaunchAtLogin?: () => Promise<boolean>;
  setLaunchAtLogin?: (enabled: boolean) => Promise<{ success: boolean; enabled: boolean }>;
}

/**
 * Permissions status.
 */
interface PermissionsStatus {
  accessibilityGranted: boolean;
}

/**
 * The permissions API exposed by the preload script.
 */
interface PermissionsAPI {
  check: () => Promise<PermissionsStatus>;
  onStatusChanged: (callback: (status: PermissionsStatus) => void) => () => void;
  onRevoked: (callback: () => void) => () => void;
}

/**
 * Electron API for app control.
 */
interface ElectronAPI {
  relaunch: () => void;
  toggleDevTools: () => void;
}

/**
 * Platform information exposed by the preload script.
 */
interface PlatformInfo {
  isMacOS: boolean;
  isWindows: boolean;
  isLinux: boolean;
}

/**
 * Model information.
 */
interface ModelInfo {
  name: string;
  url: string;
  sizeBytes: number;
  description: string;
}

/**
 * Update information.
 */
interface UpdateInfo {
  version: string;
  releaseNotes?: string;
}

/**
 * Permission status for onboarding.
 */
interface OnboardingPermissionStatus {
  microphone: 'granted' | 'denied' | 'not-determined';
  accessibility: boolean;
  screenRecording: boolean;
}

/**
 * Onboarding state.
 */
interface OnboardingState {
  isComplete: boolean;
  currentStep: number;
  permissions: OnboardingPermissionStatus;
  modelDownloaded: boolean;
}

/**
 * The onboarding API for first-run wizard.
 */
interface OnboardingAPI {
  getPermissionStatus: () => Promise<OnboardingPermissionStatus>;
  requestMicrophone: () => Promise<boolean>;
  openAccessibilitySettings: () => Promise<boolean>;
  openScreenRecordingSettings: () => Promise<boolean>;
  triggerScreenRecordingPrompt: () => Promise<boolean>;
  getState: () => Promise<OnboardingState>;
  setStep: (step: number) => Promise<boolean>;
  complete: () => Promise<boolean>;
  skip: () => Promise<boolean>;
  reset: () => Promise<boolean>;
  checkModelStatus: () => Promise<{ downloaded: boolean }>;
  expandWindow?: () => Promise<void>;
  onFieldTheoryOpened?: (callback: () => void) => () => void;
  setTutorialHint?: (hint: string | null) => void;
}

/**
 * The updater API for in-app update notifications.
 */
interface UpdaterAPI {
  getVersion: () => string;
  getStatus: () => Promise<{ status: 'available' | 'downloading' | 'ready'; version: string } | null>;
  checkForUpdates: () => Promise<void>;
  downloadUpdate: () => Promise<void>;
  installUpdate: () => Promise<void>;
  dismissUpdate: () => Promise<void>;
  onCheckingForUpdate: (callback: () => void) => () => void;
  onUpdateAvailable: (callback: (info: UpdateInfo) => void) => () => void;
  onUpdateNotAvailable: (callback: () => void) => () => void;
  onDownloadProgress: (callback: (percent: number) => void) => () => void;
  onUpdateDownloaded: (callback: (info: UpdateInfo) => void) => () => void;
  onError: (callback: (error: string) => void) => () => void;
}

/**
 * Todo item synced from Supabase.
 */
interface Todo {
  id: string;
  clientId: string;
  text: string;
  completed: boolean;
  createdAt: number;
  updatedAt: number;
}

/**
 * The todo API for bidirectional sync with Supabase.
 */
interface TodoAPI {
  isAuthenticated: () => Promise<boolean>;
  getTodos: () => Promise<Todo[]>;
  syncTodos: () => Promise<Todo[]>;
  createTodo: (text: string) => Promise<Todo | null>;
  updateTodo: (id: string, text: string) => Promise<Todo | null>;
  toggleTodo: (id: string) => Promise<Todo | null>;
  deleteTodo: (id: string) => Promise<boolean>;
  deleteTodos: (ids: string[]) => Promise<boolean>;
  completeTodos: (ids: string[]) => Promise<boolean>;
  getHotkey: () => Promise<string>;
  setHotkey: (hotkey: string) => Promise<boolean>;
  onTodosChanged: (callback: (todos: Todo[]) => void) => () => void;
  onShowTodos: (callback: () => void) => () => void;
  onTodoAdded?: (callback: (todo: Todo) => void) => () => void;
  onTodoUpdated?: (callback: (todo: Todo) => void) => () => void;
  onTodoDeleted?: (callback: (id: string) => void) => () => void;
}

/**
 * Auth API for OTP authentication via main process (avoids CORS).
 */
interface AuthAPI {
  requestOtp: (email: string) => Promise<{ error: string | null }>;
  verifyOtp: (email: string, token: string) => Promise<{ error: string | null; session: any | null }>;
  signOut: () => Promise<{ error: string | null }>;
  getSession: () => Promise<any | null>;
  // Password authentication methods
  signUp?: (email: string, password: string) => Promise<{ error: string | null }>;
  signInWithPassword?: (email: string, password: string) => Promise<{ error: string | null; session: any | null }>;
  resetPasswordForEmail?: (email: string) => Promise<{ error: string | null }>;
  updatePassword?: (newPassword: string) => Promise<{ error: string | null }>;
  setSessionFromUrl?: (accessToken: string, refreshToken: string) => Promise<{ error: string | null; session: any | null }>;
  deleteAccount?: () => Promise<{ error: string | null }>;
}

/**
 * Shared clipboard item from Supabase.
 */
interface SharedClipboardItem {
  id: string;
  userId: string;
  sharedByEmail: string | null;
  type: ClipboardItemType;
  content: string | null;
  imageData: string | null;    // Legacy: base64 from bytea column.
  imagePath: string | null;    // New: path in Supabase Storage bucket.
  imageUrl: string | null;     // New: signed URL for storage bucket access.
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
}

/**
 * Team stack info.
 */
interface SharedStackInfo {
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
 * Team clipboard query options.
 */
interface SharedClipboardQueryOptions {
  type?: ClipboardItemType;
  search?: string;
  limit?: number;
  offset?: number;
  stackId?: string;
}

/**
 * Team member info for UI display.
 */
interface TeamMember {
  id: string;
  email: string;
  addedByMe: boolean;
  createdAt: number;
}

/**
 * Shared Clipboard API for shared clipboard.
 */
interface SharedClipboardAPI {
  queryItems: (options?: SharedClipboardQueryOptions) => Promise<SharedClipboardItem[]>;
  getItem: (id: string) => Promise<SharedClipboardItem | null>;
  shareToTeam: (localItemId: number) => Promise<SharedClipboardItem | null>;
  shareStackToTeam: (localItemIds: number[]) => Promise<string | null>;
  deleteItem: (id: string) => Promise<boolean>;
  updateStackId: (itemIds: string[], stackId: string | null) => Promise<boolean>;
  copyToPersonal: (teamItemId: string) => Promise<number | null>;
  copyStackToPersonal: (teamStackId: string) => Promise<number[]>;
  getStacks: () => Promise<SharedStackInfo[]>;
  onTeamItemAdded?: (callback: (item: SharedClipboardItem) => void) => () => void;
  onTeamItemDeleted?: (callback: (id: string) => void) => () => void;
  onTeamItemUpdated?: (callback: (item: SharedClipboardItem) => void) => () => void;
  // Team membership.
  getTeamMembers: () => Promise<TeamMember[]>;
  addTeamMember: (email: string) => Promise<{ success: boolean; error?: string }>;
  removeTeamMember: (membershipId: string) => Promise<{ success: boolean; error?: string }>;
  hasTeammates: () => Promise<boolean>;
}

// =============================================================================
// Social/DM Types - DMs, Feedback, and Contacts
// =============================================================================

/**
 * Message from the unified messages table.
 */
interface SocialMessage {
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
  isHotMic: boolean;
  createdAt: number;
  updatedAt: number;
}

/**
 * Contact from the contacts table.
 */
interface SocialContact {
  id: string;
  ownerUserId: string;
  contactEmail: string;
  contactUserId: string | null;
  contactName: string | null;
  relationshipType: 'team' | 'friend' | null;
  status: 'pending' | 'accepted';
  createdAt: number;
}

/**
 * DM conversation summary for list view.
 */
interface DMConversation {
  otherUserId: string;
  otherUserEmail: string;
  otherUserName: string | null;
  relationshipType: 'team' | 'friend' | null;
  lastMessage: SocialMessage | null;
  unreadCount: number;
}

/**
 * Activity log entry for feedback.
 */
interface ActivityLogEntry {
  id: string;
  messageId: string;
  userId: string;
  userEmail: string | null;
  action: 'created' | 'status_changed' | 'replied';
  oldStatus: string | null;
  newStatus: string | null;
  createdAt: number;
}

/**
 * Social API for DMs, Feedback, Contacts, and Hot Mic.
 */
interface SocialAPI {
  // DM operations
  sendDM: (recipientUserId: string, localItemId: number) => Promise<SocialMessage | null>;
  sendTextDM: (recipientUserId: string, text: string, parentMessageId?: string, isHotMic?: boolean) => Promise<SocialMessage | null>;
  sendImageReply: (recipientUserId: string, imageBase64: string, text?: string, parentMessageId?: string, isHotMic?: boolean) => Promise<SocialMessage | null>;
  getConversations: () => Promise<DMConversation[]>;
  getDMsWithUser: (otherUserId: string) => Promise<SocialMessage[]>;
  markAsRead: (messageId: string) => Promise<boolean>;
  markAsReadBatch: (messageIds: string[]) => Promise<boolean>;
  hasUnread: () => Promise<boolean>;
  hasUnreadFeedback: () => Promise<boolean>;
  
  // Feedback operations
  submitFeedback: (localItemId: number) => Promise<SocialMessage | null>;
  submitTextFeedback: (text: string) => Promise<SocialMessage | null>;
  submitImageFeedback: (imageBase64: string, caption?: string, sourceAppName?: string) => Promise<SocialMessage | null>;
  getMyFeedback: () => Promise<SocialMessage[]>;
  getAllFeedback: () => Promise<SocialMessage[]>;
  getFeedbackReplies: (feedbackId: string) => Promise<SocialMessage[]>;
  updateFeedbackStatus: (feedbackId: string, status: 'open' | 'resolved' | 'archived') => Promise<boolean>;
  getActivityLog: (feedbackId: string) => Promise<ActivityLogEntry[]>;
  
  // Contact operations
  getContacts: () => Promise<SocialContact[]>;
  addFriend: (email: string) => Promise<{ success: boolean; error?: string }>;
  searchContacts: (query: string) => Promise<SocialContact[]>;
  getPendingInvites: () => Promise<SocialContact[]>;
  respondToInvite: (contactId: string, accept: boolean) => Promise<boolean>;
  removeFriend: (contactId: string) => Promise<boolean>;
  
  // Hot mic
  getHotMic: () => Promise<boolean>;
  setHotMic: (enabled: boolean) => Promise<boolean>;
  
  // Admin check
  isAdmin: () => Promise<boolean>;
  
  // Events
  onMessageReceived: (callback: (message: SocialMessage) => void) => () => void;
}

/**
 * Cursor status indicator state.
 */
type CursorStatusState = 'idle' | 'recording' | 'transcribing' | 'done' | 'confirmation' | 'paste-failed';

/**
 * Label visibility state for progressive hiding.
 * After thresholds are reached, labels auto-hide to show only colored dots.
 */
interface LabelVisibility {
  showTranscribingLabel: boolean;  // Show "Transcribing..." for first 3 uses
  showSayAnythingLabel: boolean;   // Show "Say anything" for first 2 uses
}

/**
 * API for the cursor status indicator overlay.
 * Used by the cursor-status.html overlay window.
 */
interface CursorStatusAPI {
  onStateChange: (callback: (state: CursorStatusState) => void) => void;
  onIdleChange: (callback: (isIdle: boolean) => void) => void;
  onDataChange?: (callback: (data: { transcription?: string; pasteFailed?: boolean }) => void) => void;
  onStackChange?: (callback: (count: number) => void) => void;
  onHideLabelsChange?: (callback: (hide: boolean) => void) => void;
  onLabelVisibilityChange?: (callback: (visibility: LabelVisibility) => void) => void;
  onScreenshotModeChange?: (callback: (active: boolean) => void) => void;
  onTutorialHint?: (callback: (hint: string | null) => void) => void;
  onRecordingNote?: (callback: (note: string | null) => void) => void;
  sendConfirmationResponse?: (abandon: boolean) => void;
  dismiss?: () => void;
  removeAllListeners: (channel: string) => void;
}

// =============================================================================
// Quota API - Local usage tracking for quota-limited features
// =============================================================================

/**
 * Quota status for a single feature.
 */
interface QuotaStatus {
  used: number;
  limit: number;
  remaining: number;
  allowed: boolean;
  percentUsed: number;
}

/**
 * Result of checking a specific quota.
 */
interface QuotaCheckResult {
  allowed: boolean;
  used: number;
  limit: number;
  feature: 'priorityMic' | 'autoStack' | 'textImprove';
}

/**
 * Data sent when a quota is exhausted.
 */
interface QuotaExhaustedData {
  feature: 'priorityMic' | 'autoStack' | 'textImprove';
  used: number;
  limit: number;
  featureName: string;
  limitDisplay: string;
}

/**
 * Quota limits for the current tier.
 */
interface QuotaLimits {
  priorityMicMinutes: number;
  autoStackSessions: number;
  textImprovementWords: number;
}

/**
 * API for tracking and displaying quota usage.
 * Free users have monthly limits on priority mic, auto-stacking, and text improvements.
 */
interface QuotaAPI {
  getQuotas: () => Promise<{ priorityMic: QuotaStatus; autoStack: QuotaStatus; textImprove: QuotaStatus; tier: 'free' | 'pro' } | null>;
  checkQuota: (feature: 'priorityMic' | 'autoStack' | 'textImprove') => Promise<QuotaCheckResult>;
  getFormattedUsage: () => Promise<{ priorityMic: string; autoStack: string; textImprove: string }>;
  getResetDate: () => Promise<Date>;
  getDaysUntilReset: () => Promise<number>;
  getLimits: () => Promise<QuotaLimits>;
  refreshTier: () => Promise<{ tier: 'free' | 'pro'; error: string | null }>;
  onTierChanged: (callback: (tier: 'free' | 'pro') => void) => () => void;
  onQuotaExhausted: (callback: (data: QuotaExhaustedData) => void) => () => void;
  onQuotaChanged: (callback: (data: { priorityMic: string; autoStack: string; textImprove: string }) => void) => () => void;
}

/**
 * Shell API for opening external URLs and revealing files.
 */
interface ShellAPI {
  openExternal: (url: string) => Promise<void>;
  showItemInFolder: (fullPath: string) => Promise<void>;
}

/**
 * Diagnostics API for system diagnostics.
 */
interface DiagnosticsAPI {
  getDiagnostics: () => Promise<unknown>;
  getDiagnosticsMarkdown: () => Promise<string>;
}

/**
 * Stripe configuration - URLs switch between test and live based on environment.
 */
interface StripeConfig {
  paymentLink: string;
  portalLink: string;
}

// =============================================================================
// Portable Commands Types
// =============================================================================

/**
 * Represents a portable command (markdown file) for display in the UI.
 */
interface PortableCommandInfo {
  name: string;           // Command name (filename without extension)
  displayName: string;    // Human-readable name
  filePath: string;       // Full path to the markdown file
}

/**
 * Command with full content loaded.
 */
interface CommandWithContent extends PortableCommandInfo {
  lastModified: number;
  content: string;
}

/**
 * Watched directory for commands.
 */
interface CommandsWatchedDir {
  path: string;
  enabled: boolean;
}

/**
 * Commands API for managing portable commands (markdown files).
 * Allows users to bring their commands from other tools like Claude, Cursor, etc.
 * Now supports multiple directories and full CRUD operations.
 */
interface CommandsAPI {
  // Legacy single-directory support
  getDirectory: () => Promise<string | null>;
  setDirectory: (directoryPath: string | null) => Promise<{ success: boolean; error?: string }>;
  browseDirectory: () => Promise<string | null>;
  getCommands: () => Promise<PortableCommandInfo[]>;
  refreshCommands: () => Promise<PortableCommandInfo[]>;
  getCommandContent: (commandName: string) => Promise<{ content: string; filePath: string } | null>;
  onCommandsChanged: (callback: (commands: PortableCommandInfo[]) => void) => () => void;
  onDirectoryChanged: (callback: (directoryPath: string | null) => void) => () => void;

  // Multi-directory management
  initialize: () => Promise<void>;
  getWatchedDirs: () => Promise<CommandsWatchedDir[]>;
  addWatchedDir: (dirPath: string) => Promise<CommandsWatchedDir | null>;
  removeWatchedDir: (dirPath: string) => Promise<boolean>;
  getDefaultDirectory: () => Promise<string>;
  createDefaultDirectory: () => Promise<string | null>;

  // CRUD operations
  getCommandByPath: (filePath: string) => Promise<CommandWithContent | null>;
  saveCommand: (filePath: string, content: string) => Promise<boolean>;
  createCommand: (directoryPath: string, name: string, content?: string) => Promise<{ path: string; name: string } | null>;
  deleteCommand: (filePath: string) => Promise<boolean>;

  // Command launcher (Cmd+Shift+K)
  invokeCommand?: (commandName: string) => Promise<{ success: boolean; error?: string }>;
  launcherResize?: (height: number) => void;
  launcherClose?: () => void;
  onLauncherReset?: (callback: () => void) => () => void;
}

/**
 * Valid hotkey IDs that can be get/set via the hotkeyAPI.
 */
type HotkeyId = 'superPaste' | 'commandLauncher' | 'improveText' | 'autoImprove';

/**
 * Generic hotkey management API for UI-configurable hotkeys.
 */
interface HotkeyAPI {
  getHotkey: (id: HotkeyId) => Promise<string | null>;
  setHotkey: (id: HotkeyId, key: string) => Promise<{ success: boolean; error?: string }>;
  getAllHotkeys: () => Promise<Record<HotkeyId, string | null>>;
}

/**
 * Extend the Window interface with our custom APIs.
 */
/**
 * Theme API for dark mode synchronization across windows.
 */
interface ThemeAPI {
  getTheme: () => Promise<boolean>;
  setTheme: (isDark: boolean) => Promise<void>;
  onThemeChanged: (callback: (isDark: boolean) => void) => () => void;
}

/**
 * Librarian API for collecting and displaying readings.
 * File-only architecture: .librarian/ directories are the single source of truth.
 * Named after the AI assistant in Snow Crash.
 */
interface LibrarianAPI {
  getReadings: () => Promise<ReadingMeta[]>;
  getReading: (path: string) => Promise<Reading | null>;
  saveReading: (path: string, content: string) => Promise<boolean>;
  getWatchedDirs: () => Promise<WatchedDir[]>;
  addWatchedDir: (dirPath: string) => Promise<WatchedDir | null>;
  removeWatchedDir: (path: string) => Promise<boolean>;
  browseDirectory: () => Promise<string | null>;
  onReadingAdded: (callback: (reading: Reading) => void) => () => void;
  onReadingUpdated: (callback: (reading: ReadingMeta) => void) => () => void;
  onReadingRemoved: (callback: (path: string) => void) => () => void;
  onSetFullscreen: (callback: (fullscreen: boolean) => void) => () => void;
  onShowReading: (callback: (readingPath: string) => void) => () => void;
  getAutoRunFrequency: () => Promise<string>;
  setAutoRunFrequency: (frequency: string) => Promise<boolean>;
  getCursorInstructions: () => Promise<string>;
  getAutoShowEnabled: () => Promise<boolean>;
  setAutoShowEnabled: (enabled: boolean) => Promise<void>;
  getClaudeCodeStatus: () => Promise<'installed' | 'directory-only' | 'not-installed'>;
  getClaudeConfigPath: () => Promise<string>;
  resyncClaudeMd: () => Promise<boolean>;
  // Hook management
  installClaudeCodeHook: () => Promise<boolean>;
  uninstallClaudeCodeHook: () => Promise<boolean>;
  isClaudeCodeHookInstalled: () => Promise<boolean>;
  initializeProjectStatus: (projectPath: string) => Promise<void>;
  onNewReadingAvailable: (callback: (readingPath: string) => void) => () => void;
  setImmersiveMode: (immersive: boolean) => void;
  // Content guidance customization
  getDefaultContentGuidance: () => Promise<string>;
  getContentGuidance: () => Promise<string>;
  getCustomContentGuidance: () => Promise<string | undefined>;
  setCustomContentGuidance: (guidance: string | undefined) => Promise<boolean>;
  resetContentGuidance: () => Promise<boolean>;
  // Auto-discovery
  discoverLibrarianDirs: () => Promise<string[]>;
  // Debug/testing
  resetAllCounters: () => Promise<boolean>;
  getEditStatus: () => Promise<{ edits: number; threshold: number } | null>;
  // Custom threshold
  getCustomThreshold: () => Promise<number | undefined>;
  setCustomThreshold: (threshold: number | undefined) => Promise<boolean>;
  // Public sharing
  shareReading: (filePath: string) => Promise<{ slug: string; url: string } | null>;
  unshareReading: (filePath: string) => Promise<boolean>;
  getShareStatus: (filePath: string) => Promise<{ shared: boolean; slug?: string; url?: string } | null>;
  updateSharedReading: (filePath: string, content: string, title: string) => Promise<boolean>;
}

declare global {
  /**
   * Reading metadata for sidebar display.
   * Path is the identity - no numeric IDs.
   */
  interface ReadingMeta {
    path: string;
    title: string;
    context: string | null;
    readingTime: string | null;
    createdAt: number;
    mtime: number;
  }

  /**
   * Full reading with content (loaded on demand).
   */
  interface Reading extends ReadingMeta {
    content: string;
  }

  /**
   * Watched directory for Librarian.
   * Path is the identity - no numeric IDs.
   */
  interface WatchedDir {
    path: string;
    enabled: boolean;
  }

  interface Window {
    audioAPI?: AudioAPI;
    hotkeyAPI?: HotkeyAPI;
    transcribeAPI?: TranscribeAPI;
    clipboardAPI?: ClipboardAPI;
    permissionsAPI?: PermissionsAPI;
    electronAPI?: ElectronAPI;
    updaterAPI?: UpdaterAPI;
    onboardingAPI?: OnboardingAPI;
    todoAPI?: TodoAPI;
    authAPI?: AuthAPI;
    sharedClipboardAPI?: SharedClipboardAPI;
    socialAPI?: SocialAPI;
    cursorStatusAPI?: CursorStatusAPI;
    quotaAPI?: QuotaAPI;
    shellAPI?: ShellAPI;
    commandsAPI?: CommandsAPI;
    themeAPI?: ThemeAPI;
    librarianAPI?: LibrarianAPI;
    diagnosticsAPI?: DiagnosticsAPI;
    stripeConfig?: StripeConfig;
    platform?: PlatformInfo;
  }
}

export {};
