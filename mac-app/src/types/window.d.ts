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
 * Vision model download status.
 */
type VisionModelStatus = 'downloaded' | 'downloading' | 'missing';

/**
 * Vision model information.
 */
interface VisionModelInfo {
  name: string;
  repo: string;
  sizeBytes: number;
  description: string;
}

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
  getOverlayStyle: () => Promise<'rectangle' | 'top-emerging'>;
  setOverlayStyle: (style: 'rectangle' | 'top-emerging') => Promise<void>;
  getAbandonHotkey?: () => Promise<string>;
  setAbandonHotkey?: (hotkey: string) => Promise<boolean>;
  getAbandonConfirmation?: () => Promise<boolean>;
  setAbandonConfirmation?: (enabled: boolean) => Promise<void>;
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
 * The vision API exposed by the preload script.
 */
interface VisionAPI {
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
  desktopScreenshot?: string;
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
 * Stack info for prompt stacking feature.
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
 * The clipboard API exposed by the preload script.
 */
interface ClipboardAPI {
  queryItems: (options?: ClipboardQueryOptions) => Promise<ClipboardItem[]>;
  getItem: (id: number) => Promise<ClipboardItem | null>;
  deleteItem: (id: number) => Promise<void>;
  restoreItem?: (item: ClipboardItem) => Promise<number>;
  pasteText?: (text: string, targetBundleId?: string) => Promise<void>;
  engineerStack?: (stackId: string) => Promise<{ success: boolean; refinedPrompt?: string; error?: string }>;
  
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
  showToast?: (message: string) => Promise<void>;
  setSketchMode?: (active: boolean) => void;
  
  // Stack operations for prompt stacking feature
  queryItemsByStackId?: (stackId: string) => Promise<ClipboardItem[]>;
  getUniqueStacks?: () => Promise<StackInfo[]>;
  updateStackId?: (itemIds: number[], stackId: string | null) => Promise<void>;
  startDrag?: (stackId: string) => Promise<void>;
  
  // API key management (stored securely via OS keychain)
  getApiKeyStatus?: () => Promise<{ hasKey: boolean }>;
  setApiKey?: (apiKey: string) => Promise<{ success: boolean; error?: string }>;
  clearApiKey?: () => Promise<{ success: boolean; error?: string }>;
  
  // System prompt customization for Engineer feature
  getSystemPrompt?: () => Promise<{ prompt: string; isCustom: boolean }>;
  setSystemPrompt?: (prompt: string) => Promise<{ success: boolean; error?: string }>;
  resetSystemPrompt?: () => Promise<{ success: boolean; error?: string }>;
  getDefaultSystemPrompt?: () => Promise<{ prompt: string }>;
  
  // Improved content management - store/clear improved versions of transcriptions
  saveImprovedContent?: (itemId: number, improvedContent: string) => Promise<{ success: boolean; error?: string }>;
  clearImprovedContent?: (itemId: number) => Promise<{ success: boolean; error?: string }>;
  
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
  sendTextDM: (recipientUserId: string, text: string, parentMessageId?: string) => Promise<SocialMessage | null>;
  getConversations: () => Promise<DMConversation[]>;
  getDMsWithUser: (otherUserId: string) => Promise<SocialMessage[]>;
  markAsRead: (messageId: string) => Promise<boolean>;
  hasUnread: () => Promise<boolean>;
  
  // Feedback operations
  submitFeedback: (localItemId: number) => Promise<SocialMessage | null>;
  getMyFeedback: () => Promise<SocialMessage[]>;
  getAllFeedback: () => Promise<SocialMessage[]>;
  getFeedbackReplies: (feedbackId: string) => Promise<SocialMessage[]>;
  updateFeedbackStatus: (feedbackId: string, status: 'open' | 'resolved' | 'archived') => Promise<boolean>;
  getActivityLog: (feedbackId: string) => Promise<ActivityLogEntry[]>;
  
  // Contact operations
  getContacts: () => Promise<SocialContact[]>;
  addFriend: (email: string) => Promise<{ success: boolean; error?: string }>;
  searchContacts: (query: string) => Promise<SocialContact[]>;
  
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
 * API for the cursor status indicator overlay.
 * Used by the cursor-status.html overlay window.
 */
interface CursorStatusAPI {
  onStateChange: (callback: (state: CursorStatusState) => void) => void;
  onIdleChange: (callback: (isIdle: boolean) => void) => void;
  onDataChange?: (callback: (data: { transcription?: string; pasteFailed?: boolean }) => void) => void;
  sendConfirmationResponse?: (abandon: boolean) => void;
  dismiss?: () => void;
  removeAllListeners: (channel: string) => void;
}

/**
 * Extend the Window interface with our custom APIs.
 */
declare global {
  interface Window {
    audioAPI?: AudioAPI;
    transcribeAPI?: TranscribeAPI;
    clipboardAPI?: ClipboardAPI;
    visionAPI?: VisionAPI;
    permissionsAPI?: PermissionsAPI;
    electronAPI?: ElectronAPI;
    updaterAPI?: UpdaterAPI;
    onboardingAPI?: OnboardingAPI;
    todoAPI?: TodoAPI;
    authAPI?: AuthAPI;
    sharedClipboardAPI?: SharedClipboardAPI;
    socialAPI?: SocialAPI;
    cursorStatusAPI?: CursorStatusAPI;
    platform?: PlatformInfo;
  }
}

export {};
