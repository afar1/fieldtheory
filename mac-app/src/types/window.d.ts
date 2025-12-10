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
  getStackCount: () => Promise<number>;
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
  pasteStack: (ids: number[]) => Promise<void>;
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
}

/**
 * Auth API for OTP authentication via main process (avoids CORS).
 */
interface AuthAPI {
  requestOtp: (email: string) => Promise<{ error: string | null }>;
  verifyOtp: (email: string, token: string) => Promise<{ error: string | null; session: any | null }>;
  signOut: () => Promise<{ error: string | null }>;
  getSession: () => Promise<any | null>;
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
    platform?: PlatformInfo;
  }
}

export {};
