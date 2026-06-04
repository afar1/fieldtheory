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
  getFavoriteDeviceName: () => Promise<string | null>;
  setFavoriteDevice: (deviceId: string) => Promise<boolean>;
  clearFavoriteDevice: () => Promise<void>;
}

interface GazeTrackingStatus {
  enabled: boolean;
  running: boolean;
  cameraAuthorized: boolean;
  targetFps: number;
  reason: string | null;
  lastSampleAtMs: number | null;
}

interface GazeSample {
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
}

type GazeCalibrationPointId =
  | 'center'
  | 'topLeft'
  | 'topRight'
  | 'bottomLeft'
  | 'bottomRight';

interface GazeCalibrationState {
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
}

type GazeDwellAction = 'highlightBorder' | 'bringToFront' | 'eventOnly';

interface GazeWindowFocusConfig {
  dwellDurationMs: number;
  confidenceThreshold: number;
  deadZonePx: number;
  cooldownMs: number;
  dwellAction: GazeDwellAction;
}

interface GazeWindowSnapshot {
  windowId: number;
  ownerName: string;
  ownerBundleId: string;
  ownerPID: number;
  title: string;
  bounds: { x: number; y: number; width: number; height: number };
  layer: number;
}

interface GazeDwellEvent {
  timestampMs: number;
  confidence: number;
  stability: number;
  gazePoint: { x: number; y: number };
  activeDisplayId: number;
  window: GazeWindowSnapshot;
  action: GazeDwellAction;
}

interface GazeDebugOverlayState {
  enabled: boolean;
  visible: boolean;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
}

interface GazeScreenOverlayState {
  enabled: boolean;
  visible: boolean;
}

interface GazeAPI {
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
  librarianEnabled: boolean;
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

export type ParakeetSetupErrorCode =
  | 'missing-python'
  | 'unsupported-python'
  | 'python-venv-failed'
  | 'setup-failed';

export interface ParakeetSetupError {
  code: ParakeetSetupErrorCode;
  summary: string;
  detail: string;
  recoveryCommand: string;
  moreInfo: string;
}

export interface ParakeetEngineStatus {
  engine: 'parakeet' | 'parakeet-multilingual';
  label: string;
  verified: boolean;
  needsReinstall: boolean;
  lastError: string | null;
  lastErrorDetail?: string | null;
  lastErrorAt: string | null;
  setupError?: ParakeetSetupError | null;
}

export type ParakeetSetupStage =
  | 'installing-runtime'
  | 'verifying-model'
  | 'downloading-model'
  | 'loading-model'
  | 'starting-server'
  | 'completed'
  | 'failed';

export interface ParakeetSetupProgress {
  engine: 'parakeet' | 'parakeet-multilingual';
  stage: ParakeetSetupStage;
  message: string;
  percent: number | null;
  detail: string | null;
}

export interface ParakeetStatus {
  runtimeInstalled: boolean;
  pythonPath: string;
  scriptPath: string;
  cacheDir: string;
  cacheExists: boolean;
  serverState: 'idle' | 'warming' | 'ready';
  activeEngine: 'parakeet' | 'parakeet-multilingual' | null;
  engines: ParakeetEngineStatus[];
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
  getRecordingSource?: () => Promise<'microphone' | 'system-audio'>;
  setRecordingSource?: (source: 'microphone' | 'system-audio') => Promise<void>;
  getHotkey: () => Promise<string>;
  setHotkey: (hotkey: string | null) => Promise<boolean>;
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
  getTranscriptionEngine?: () => Promise<'whisper' | 'mlx-whisper' | 'parakeet' | 'parakeet-multilingual'>;
  setTranscriptionEngine?: (engine: 'whisper' | 'mlx-whisper' | 'parakeet' | 'parakeet-multilingual') => Promise<void>;
  isMlxWhisperInstalled?: () => Promise<boolean>;
  isParakeetInstalled?: () => Promise<boolean>;
  getParakeetStatus?: () => Promise<ParakeetStatus | null>;
  isAppleSilicon?: () => Promise<boolean>;
  setupMlxWhisper?: () => Promise<{ success: boolean; error?: string }>;
  setupParakeet?: (engine?: 'parakeet' | 'parakeet-multilingual') => Promise<{ success: boolean; error?: string; setupError?: ParakeetSetupError }>;
  uninstallParakeet?: () => Promise<{ success: boolean; error?: string }>;
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
  onParakeetSetupProgress?: (callback: (progress: ParakeetSetupProgress) => void) => () => void;
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
 * Lightweight process performance snapshot for the in-app HUD.
 */
interface ProcessPerformanceSnapshot {
  timestampMs: number;
  cpuPercent: number;
  cpuCoresUsed: number;
  cpuSystemPercent: number;
  totalCores: number;
  memoryUsedMb: number;
  memorySystemPercent: number;
  totalMemoryGb: number;
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

interface LocalLlmModelInfo {
  name: string;
  filename: string;
  sizeBytes: number;
  description: string;
  license: string;
  sourceUrl: string;
  baseModelUrl: string;
  ollamaTag?: string;
}

interface LocalLlmHealth {
  status: 'ready' | 'missing' | 'corrupt';
  modelPath: string;
  fileSizeBytes: number | null;
  expectedSizeBytes: number;
  minValidSizeBytes: number;
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
  writeText?: (text: string) => Promise<{ success?: boolean; error?: string }>;

  clearAll: () => Promise<void>;
  captureScreenshot: (region?: boolean) => Promise<number>;
  getClipboardImagePath?: () => Promise<string | null>;
  savePastedImageFile?: (file: { name?: string | null; type?: string | null; data: Uint8Array }) => Promise<string | null>;
  exportItemImagePath?: (id: number) => Promise<string | null>;
  getHotkeys: () => Promise<ClipboardHotkeys>;
  setHotkeys: (hotkeys: ClipboardHotkeys) => Promise<boolean>;
  pasteItem: (id: number, targetBundleId?: string, useImproved?: boolean) => Promise<void>;
  copyItem: (id: number, useImproved?: boolean) => Promise<void>;
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
  onShowLibrary?: (callback: () => void) => () => void;
  onShowTranscriptHistory?: (callback: () => void) => () => void;
  onShowSettings?: (callback: () => void) => () => void;
  onCollapseImmersive?: (callback: () => void) => () => void;
  onResetToClipboardView?: (callback: () => void) => () => void;
  onWindowStyleTransitionOut?: (callback: () => void) => () => void;
  windowStyleTransitionReady?: () => void;
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

  // Local LLM model management
  getLocalLLMModels?: () => Promise<Record<string, LocalLlmModelInfo>>;
  getLocalLLMStatus?: () => Promise<Record<string, boolean>>;
  getLocalLLMHealth?: () => Promise<Record<string, LocalLlmHealth>>;
  getLocalLLMSelected?: () => Promise<string>;
  setLocalLLMSelected?: (model: string) => Promise<{ success: boolean; error?: string }>;
  downloadLocalLLM?: (model: string) => Promise<{ success: boolean; error?: string; modelPath?: string; reusedExisting?: boolean }>;
  deleteLocalLLM?: (model: string) => Promise<{ success: boolean; error?: string }>;
  getUseLocalLLM?: () => Promise<boolean>;
  setUseLocalLLM?: (useLocal: boolean) => Promise<{ success: boolean; error?: string }>;
  getMeetingSummaryPrompt?: () => Promise<string>;
  saveMeetingSummaryPrompt?: (prompt: string) => Promise<{ success: boolean; prompt?: string; error?: string }>;
  resetMeetingSummaryPrompt?: () => Promise<{ success: boolean; prompt: string; error?: string }>;
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
  
  // Performance HUD settings and process telemetry
  getPerformanceHudEnabled?: () => Promise<boolean>;
  setPerformanceHudEnabled?: (enabled: boolean) => Promise<boolean>;
  getPerformanceSnapshot?: () => Promise<ProcessPerformanceSnapshot>;
  getHideStatusLabels?: () => Promise<boolean>;
  setHideStatusLabels?: (hide: boolean) => Promise<boolean>;
  getCursorStatusDebugMode?: () => Promise<boolean>;
  setCursorStatusDebugMode?: (enabled: boolean) => Promise<boolean>;
  getCursorStatusWindowColorDebug?: () => Promise<boolean>;
  setCursorStatusWindowColorDebug?: (enabled: boolean) => Promise<boolean>;

  getSoundsEnabled?: () => Promise<boolean>;
  setSoundsEnabled?: (enabled: boolean) => Promise<boolean>;
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

  // Tasks tab (experimental feature)
  getTasksTabEnabled?: () => Promise<boolean>;
  setTasksTabEnabled?: (enabled: boolean) => Promise<boolean>;
  onTasksTabToggled?: (callback: (enabled: boolean) => void) => () => void;

  // Launch at login
  getLaunchAtLogin?: () => Promise<boolean>;
  setLaunchAtLogin?: (enabled: boolean) => Promise<{ success: boolean; enabled: boolean }>;

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

  // Sound playback events (internal use)
  onPlaySound?: (callback: (soundId: string) => void) => () => void;
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
  supportsSpeakerDiarization?: boolean;
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
/**
 * AI integration status for Claude Code and Cursor.
 */
interface AIIntegrationStatus {
  claudeCode: { available: boolean; connected: boolean };
  cursor: { available: boolean; connected: boolean };
}

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
  // AI integration - detect and configure Claude Code and Cursor
  getAIIntegrationStatus?: () => Promise<AIIntegrationStatus>;
  installClaudeHook?: () => Promise<{ success: boolean; message: string }>;
  installCursorHook?: () => Promise<{ success: boolean; message: string }>;
  showSignIn: () => Promise<boolean>;
}

/**
 * The updater API for in-app update notifications.
 */
interface UpdaterAPI {
  getVersion: () => string;
  isEnabled: () => boolean;
  getStatus: () => Promise<{ status: 'available' | 'downloading' | 'ready' | 'installing'; version: string } | null>;
  checkForUpdates: () => Promise<void>;
  downloadUpdate: () => Promise<void>;
  installUpdate: () => Promise<void>;
  dismissUpdate: () => Promise<void>;
  onCheckingForUpdate: (callback: () => void) => () => void;
  onUpdateAvailable: (callback: (info: UpdateInfo) => void) => () => void;
  onUpdateNotAvailable: (callback: () => void) => () => void;
  onDownloadProgress: (callback: (percent: number) => void) => () => void;
  onUpdateDownloaded: (callback: (info: UpdateInfo) => void) => () => void;
  onInstalling: (callback: () => void) => () => void;
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
  onTodosChanged: (callback: (todos: Todo[]) => void) => () => void;
  onShowTodos: (callback: () => void) => () => void;
  onTodoAdded?: (callback: (todo: Todo) => void) => () => void;
  onTodoUpdated?: (callback: (todo: Todo) => void) => () => void;
  onTodoDeleted?: (callback: (id: string) => void) => () => void;
}

interface TaggedDoc {
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
}

interface TaggedDocsScanProgress {
  phase: 'idle' | 'scanning' | 'done' | 'error';
  scanned: number;
  matched: number;
  roots: string[];
  currentPath?: string;
  error?: string;
}

interface TaggedDocsAPI {
  list: () => Promise<TaggedDoc[]>;
  markRead: (ulid: string) => Promise<TaggedDoc | null>;
  markAllRead: () => Promise<TaggedDoc[]>;
  rescan: () => Promise<TaggedDoc[]>;
  onUpdated: (callback: (docs: TaggedDoc[]) => void) => () => void;
  onScanProgress: (callback: (progress: TaggedDocsScanProgress) => void) => () => void;
}

/**
 * Auth API for OTP authentication via main process (avoids CORS).
 */
type AuthTestState = 'NEW_USER' | 'RETURNING_VALID' | 'RETURNING_EXPIRED' | 'OFFLINE_MODE' | 'TOKEN_REVOKED' | 'SIGNED_OUT';

interface AuthSessionState {
  authenticated: boolean;
  expires_at: number | null;
  expiresAt: number | null;
  tier: 'free' | 'pro';
  callsign: string | null;
  displayName?: string;
  user: {
    id: string;
    email?: string;
    user_metadata?: Record<string, unknown>;
    app_metadata?: Record<string, unknown>;
  } | null;
}

interface AuthAPI {
  prepareForNewLogin: () => Promise<void>;
  requestOtp: (email: string) => Promise<{ error: string | null }>;
  verifyOtp: (email: string, token: string) => Promise<{ error: string | null; session: AuthSessionState | null }>;
  signOut: () => Promise<{ error: string | null }>;
  getSession: () => Promise<AuthSessionState | null>;
  getCallsign?: () => Promise<string | null>;
  onSessionChanged?: (callback: (session: AuthSessionState | null) => void) => () => void;
  // Password authentication methods
  signUp?: (email: string, password: string) => Promise<{ error: string | null }>;
  signInWithPassword?: (email: string, password: string) => Promise<{ error: string | null; session: AuthSessionState | null }>;
  resetPasswordForEmail?: (email: string) => Promise<{ error: string | null }>;
  updatePassword?: (newPassword: string) => Promise<{ error: string | null }>;
  updateFullName?: (fullName: string) => Promise<{ error: string | null }>;
  setSessionFromUrl?: (accessToken: string, refreshToken: string) => Promise<{ error: string | null; session: AuthSessionState | null }>;
  deleteAccount?: () => Promise<{ error: string | null }>;
  // Auth state simulator (dev only)
  simulateState?: (state: AuthTestState, options?: { tier?: 'free' | 'pro' }) => Promise<{ success: boolean; message: string }>;
  resetSimulator?: () => Promise<{ success: boolean }>;
  getSimulatorState?: () => Promise<{ offline: boolean; revoked: boolean }>;
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
  imagePath: string | null;    // Stored path; may be legacy path or "bucket::path".
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
  markAllFeedbackAsRead: () => Promise<boolean>;

  // Feedback operations
  submitFeedback: (localItemId: number) => Promise<SocialMessage | null>;
  submitTextFeedback: (text: string) => Promise<SocialMessage | null>;
  submitImageFeedback: (imageBase64: string, caption?: string, sourceAppName?: string) => Promise<SocialMessage | null>;
  getMyFeedback: () => Promise<SocialMessage[]>;
  getAllFeedback: () => Promise<SocialMessage[]>;
  getFeedbackReplies: (feedbackId: string) => Promise<SocialMessage[]>;
  updateFeedbackStatus: (feedbackId: string, status: 'open' | 'resolved' | 'archived') => Promise<boolean>;
  getActivityLog: (feedbackId: string) => Promise<ActivityLogEntry[]>;
  setFeedbackRealtimeActive: (active: boolean) => Promise<boolean>;
  
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
type CursorStatusState = 'idle' | 'silentStacking' | 'recording' | 'transcribing' | 'improving' | 'done' | 'confirmation' | 'paste-failed' | 'hot-mic';

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
  onHotMicWordCount?: (callback: (count: number, lastWord: string) => void) => void;
  onWarnDiscard?: (callback: () => void) => void;
  onSlideOut?: (callback: () => void) => void;
  onDebugModeChange?: (callback: (enabled: boolean) => void) => void;
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
  portableCommands: number;
}

/**
 * API for tracking and displaying quota usage.
 * Free users have monthly limits on priority mic, auto-stacking, and text improvements.
 */
type TrialState = 'pro' | 'trial' | 'expired';

interface QuotaAPI {
  getQuotas: () => Promise<{
    priorityMic: QuotaStatus;
    autoStack: QuotaStatus;
    textImprove: QuotaStatus;
    portableCommands: QuotaStatus;
    tier: 'free' | 'pro';
    state: TrialState;
    trialEndsAt: string | null;
    nextTrialResetAt: string | null;
  } | null>;
  checkQuota: (feature: 'priorityMic' | 'autoStack' | 'textImprove' | 'portableCommands') => Promise<QuotaCheckResult>;
  getFormattedUsage: () => Promise<{ priorityMic: string; autoStack: string; textImprove: string; portableCommands: string }>;
  getResetDate: () => Promise<Date>;
  getDaysUntilReset: () => Promise<number>;
  getLimits: () => Promise<QuotaLimits>;
  refreshTier: () => Promise<{ tier: 'free' | 'pro'; error: string | null }>;
  onTierChanged: (callback: (tier: 'free' | 'pro') => void) => () => void;
  onStateChanged: (callback: (state: TrialState) => void) => () => void;
  onQuotaExhausted: (callback: (data: QuotaExhaustedData) => void) => () => void;
  onQuotaChanged: (callback: (data: { priorityMic: string; autoStack: string; textImprove: string; portableCommands: string }) => void) => () => void;
}

/**
 * Shell API for opening external URLs and revealing files.
 */
interface ShellAPI {
  openExternal: (url: string) => Promise<void>;
  showItemInFolder: (fullPath: string) => Promise<void>;
  setRepresentedFilename: (fullPath: string) => Promise<void>;
  pasteIntoCodexInput?: (text: string) => Promise<{ success: boolean; error?: string; delivery?: string }>;
  openFieldTheoryMarkdown?: (target: FieldTheoryMarkdownTarget) => Promise<{ success: boolean; error?: string }>;
}

type AgentImproveTool = 'codex' | 'claude';
type AgentImproveContextKind = 'selection' | 'markdown-file';

interface AgentImproveLaunchRequest {
  tool: AgentImproveTool;
  instruction: string;
  content: string;
  contextKind: AgentImproveContextKind;
  filePath?: string | null;
  title?: string | null;
  cwd?: string | null;
}

interface AgentImproveLaunchResult {
  promptPath: string;
  command: string;
}

interface AgentImproveAPI {
  launch: (request: AgentImproveLaunchRequest) => Promise<AgentImproveLaunchResult>;
}

type LocalCommandRunMode = 'document' | 'selection';

interface LocalCommandRunRequest {
  commandName?: string;
  customInstruction?: string;
  mode?: LocalCommandRunMode;
  selection?: {
    start?: number;
    end?: number;
    text?: string;
  } | null;
  useMemory?: boolean;
}

interface LocalCommandRunResult {
  success: boolean;
  error?: string;
  filePath?: string;
  commandName?: string;
  mode?: LocalCommandRunMode;
  runId?: string;
}

interface LocalCommandStatus {
  status: 'running' | 'success' | 'error' | 'notice';
  message: string;
  detail?: string;
  eventKind?: 'status' | 'model_output' | 'tool_call' | 'file_change' | 'error';
  commandName?: string;
  filePath?: string;
  mode?: LocalCommandRunMode;
  runId?: string;
  phase?: string;
  selectionStart?: number;
  selectionEnd?: number;
  changedLines?: number;
  changedBytes?: number;
  error?: string;
  updatedAt: number;
}

interface ReplaceSelectedMarkdownTextRequest {
  requestId: string;
  expectedText: string;
  replacementText: string;
}

type MaxwellRunStatus =
  | 'pending'
  | 'generated'
  | 'success'
  | 'generation_error'
  | 'selection_error'
  | 'save_conflict'
  | 'save_error'
  | 'cancelled'
  | 'reverted';

type MaxwellRunMode = 'document' | 'selection';
type MaxwellTargetType = 'wiki' | 'reading';

interface MaxwellRunSummary {
  runId: string;
  createdAt: number;
  updatedAt: number;
  status: MaxwellRunStatus;
  commandName: string;
  targetPath: string;
  targetRelPath: string | null;
  targetType: MaxwellTargetType;
  mode: MaxwellRunMode;
  summary: string | null;
  errorMessage: string | null;
  model: string | null;
  harness: string | null;
  memoryUsed: boolean;
  canUndo: boolean;
  canRedo: boolean;
}

type MaxwellUndoFailureReason =
  | 'not-ready'
  | 'not-found'
  | 'not-applied'
  | 'not-reverted'
  | 'conflict'
  | 'blocked'
  | 'save-error'
  | 'error';

type MaxwellRedoFailureReason = MaxwellUndoFailureReason;

type MaxwellUndoResult =
  | { success: true; run: MaxwellRunSummary; filePath: string; commandName: string }
  | { success: false; reason: MaxwellUndoFailureReason; error: string; run?: MaxwellRunSummary };

type MaxwellRedoResult =
  | { success: true; run: MaxwellRunSummary; filePath: string; commandName: string }
  | { success: false; reason: MaxwellRedoFailureReason; error: string; run?: MaxwellRunSummary };

type MaxwellCancelResult = {
  success: boolean;
  error?: string;
  run?: MaxwellRunSummary;
};

type MaxwellMemoryState = {
  enabled: boolean;
  content: string;
  path: string;
  updatedAt: number | null;
  maxChars: number;
};

type MaxwellMemorySaveRequest = {
  enabled: boolean;
  content: string;
};

type MaxwellMemorySaveResult = {
  success: boolean;
  error?: string;
  memory?: MaxwellMemoryState;
};

/**
 * Diagnostics API for system diagnostics.
 */
interface DiagnosticsAPI {
  getDiagnostics: () => Promise<unknown>;
  getDiagnosticsMarkdown: () => Promise<string>;
  appendRenderedEditorDebug: (entry: unknown) => Promise<{ ok: boolean; path: string; error?: string }>;
  appendScrollDiagnostics: (entry: unknown) => Promise<{ ok: boolean; path: string; error?: string }>;
  getRenderedEditorDebugLogPath: () => Promise<string>;
  getScrollDiagnosticsLogPath: () => Promise<string>;
  clearRenderedEditorDebugLog: () => Promise<{ ok: boolean; path: string; error?: string }>;
  clearScrollDiagnosticsLog: () => Promise<{ ok: boolean; path: string; error?: string }>;
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
  lastModified: number;   // File modification time
  source?: 'private' | 'shared';
  sourceLabel?: string;
  sharedAuthorCallsign?: string;
  sourceRootPath?: string;
  sourceRelPath?: string;
}

/**
 * Command with full content loaded.
 */
interface CommandWithContent extends PortableCommandInfo {
  lastModified: number;
  content: string;
  documentVersion: DocumentVersion;
}

declare global {
  interface DocumentVersion {
    mtimeMs: number;
    size: number;
    sha256: string;
  }

  type DocumentSaveResult =
    | { ok: true; version: DocumentVersion }
    | { ok: false; reason: 'conflict'; currentContent: string; currentVersion: DocumentVersion }
    | { ok: false; reason: 'blocked' | 'error' | 'not-found'; currentContent?: string; currentVersion?: DocumentVersion };
}

/**
 * Watched directory for commands.
 */
interface CommandsWatchedDir {
  path: string;
  enabled: boolean;
  mobileSyncEnabled: boolean;
}

/**
 * Result of a mobile sync operation.
 */
interface CommandSyncResult {
  success: boolean;
  uploaded: number;
  updated: number;
  deleted: number;
  errors: string[];
}

/**
 * Mobile sync status.
 */
interface MobileSyncStatus {
  ready: boolean;
  lastSyncAt: number | null;
}

/**
 * Handoff file info for the command launcher.
 */
interface HandoffInfo {
  name: string;
  displayName: string;
  filePath: string;
  lastModified: number;
}

interface FieldTheoryMarkdownTarget {
  kind: 'wiki' | 'artifact' | 'command' | 'external' | 'bookmarks' | 'ember' | 'library' | 'commands' | 'clipboard';
  path: string;
  contentMode?: 'rendered' | 'markdown' | 'typedown';
  selectionStart?: number;
  selectionEnd?: number;
  clipboardItemId?: number;
  clipboardStackId?: string;
  clipboardSearch?: string;
}

interface ActiveLibraryFileContext {
  type: 'wiki' | 'external';
  rootPath: string;
  relPath: string;
  filePath: string;
  title: string;
  selectionStart?: number;
  selectionEnd?: number;
  selectionText?: string;
}

type MeetingStatus = 'idle' | 'starting' | 'recording' | 'transcribing' | 'summarizing' | 'done' | 'cancelled' | 'error';

interface MeetingSession {
  meetingId: string;
  title: string;
  type: 'wiki' | 'external';
  filePath: string;
  relPath: string | null;
  startedAt: string;
  endedAt: string | null;
  status: MeetingStatus;
  audioPath: string | null;
  transcriptPath: string | null;
  rawTranscriptPath: string | null;
  speakerDiarizationSupported: boolean;
  summaryRunId?: string;
  summaryError?: string;
}

interface MeetingActionResult {
  success: boolean;
  error?: string;
  session?: MeetingSession;
  openTarget?: FieldTheoryMarkdownTarget;
  summaryRunId?: string;
  summaryError?: string;
}

interface LauncherFileInfo {
  name: string;
  displayName: string;
  filePath: string;
  isDirectory: boolean;
  lastModified: number;
}

interface LauncherFileSearchResult {
  files: LauncherFileInfo[];
  indexing: boolean;
  indexedAt: number | null;
}

interface LauncherFileIconResult {
  success: boolean;
  iconDataUrl?: string;
  error?: string;
}

interface LauncherSettings {
  rootSearchEnabledKinds: Record<string, boolean>;
}

interface MarkdownPreview {
  title: string;
  filePath: string;
  content: string;
}

interface PortableCommandDirectoryInfo {
  name: string;
  displayName: string;
  rootPath: string;
  directoryPath: string;
  directoryRelPath: string;
  lastModified: number;
}

type LauncherPreviewPayload =
  | { kind: 'bookmark'; bookmark: Bookmark }
  | { kind: 'markdown'; title: string; filePath: string; content: string };

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
  getCommandDirectories: () => Promise<PortableCommandDirectoryInfo[]>;
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
  getMarkdownPreview: (filePath: string) => Promise<MarkdownPreview | null>;
  saveCommand: (filePath: string, content: string, expectedVersion?: DocumentVersion | null) => Promise<DocumentSaveResult>;
  createCommand: (directoryPath: string, name: string, content?: string) => Promise<{ path: string; name: string } | null>;
  deleteCommand: (filePath: string) => Promise<boolean>;
  renameCommand: (oldFilePath: string, newName: string) => Promise<string | null>;

  // Command launcher (Cmd+Shift+K)
  invokeCommand?: (commandName: string, traceContext?: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>;
  getLauncherFileIcon?: (filePath: string) => Promise<LauncherFileIconResult>;
  searchLauncherFiles?: (query: string) => Promise<LauncherFileSearchResult>;
  openLauncherFile?: (filePath: string) => Promise<{ success: boolean; error?: string }>;
  warmLauncherFileIndex?: () => Promise<{ started: boolean }>;
  getLauncherSettings?: () => Promise<LauncherSettings>;
  setLauncherSettings?: (settings: LauncherSettings) => Promise<LauncherSettings>;
  runLocalCommand?: (request: string | LocalCommandRunRequest) => Promise<LocalCommandRunResult>;
  listMaxwellRuns?: (limit?: number) => Promise<MaxwellRunSummary[]>;
  getMaxwellMemory?: () => Promise<MaxwellMemoryState>;
  saveMaxwellMemory?: (request: MaxwellMemorySaveRequest) => Promise<MaxwellMemorySaveResult>;
  cancelMaxwellRun?: (runId: string) => Promise<MaxwellCancelResult>;
  undoMaxwellRun?: (runId: string) => Promise<MaxwellUndoResult>;
  redoMaxwellRun?: (runId: string) => Promise<MaxwellRedoResult>;
  onLocalCommandStatus?: (callback: (status: LocalCommandStatus) => void) => () => void;
  launcherResize?: (height: number) => void;
  launcherClose?: (options?: { skipActivation?: boolean; generation?: number }) => void;
  launcherTrace?: (event: string, details?: Record<string, unknown>) => void;
  launcherPreviewShow?: (preview: LauncherPreviewPayload) => void;
  launcherPreviewHide?: () => void;
  launcherPreviewResize?: (height: number) => void;
  onLauncherPreviewBookmark?: (callback: (bookmark: Bookmark) => void) => () => void;
  onLauncherPreview?: (callback: (preview: LauncherPreviewPayload) => void) => () => void;
  onLauncherReset?: (callback: (payload?: { isDarkMode?: boolean; generation?: number; launcherSessionId?: string }) => void) => () => void;
  onLauncherFocusInput?: (callback: (payload?: { generation?: number; launcherSessionId?: string; qualityScenario?: string | null }) => void) => () => void;
  getLauncherContext?: () => Promise<{ fieldTheoryActive: boolean; targetApp?: RunningApp | null }>;
  getActiveLibraryFileContext?: () => Promise<ActiveLibraryFileContext | null>;
  setActiveLibraryFileContext?: (context: ActiveLibraryFileContext | null) => Promise<boolean>;
  archiveActiveLibraryFile?: () => Promise<{ success: boolean; error?: string }>;
  toggleActiveLibraryLineNumbers?: () => Promise<{ success: boolean; error?: string }>;
  createMeetingNote?: (title?: string) => Promise<MeetingActionResult>;
  startMeetingHere?: () => Promise<MeetingActionResult>;
  stopMeeting?: () => Promise<MeetingActionResult>;
  cancelMeeting?: () => Promise<MeetingActionResult>;
  summarizeCurrentMeeting?: () => Promise<MeetingActionResult>;
  getActiveMeeting?: () => Promise<MeetingSession | null>;
  onMeetingStatus?: (callback: (session: MeetingSession) => void) => () => void;
  openFieldTheoryMarkdown?: (target: FieldTheoryMarkdownTarget) => Promise<{ success: boolean; error?: string }>;
  insertMarkdownText?: (text: string) => Promise<{ success: boolean; error?: string }>;
  insertClipboardItemsAsMarkdown?: (ids: number[]) => Promise<{ success: boolean; error?: string }>;
  onOpenMarkdownFromLauncher?: (callback: (target: FieldTheoryMarkdownTarget) => void) => () => void;
  onToggleLineNumbersFromLauncher?: (callback: () => void) => () => void;

  // Mobile sync operations
  setMobileSync: (dirPath: string, enabled: boolean) => Promise<boolean>;
  getMobileSyncStatus: () => Promise<MobileSyncStatus>;
  syncToMobile: () => Promise<CommandSyncResult>;
  getRemoteCommandCount: () => Promise<number>;

  // Shared commands (routes through main process for auth)
  shareCommand: (command: { name: string; content: string }) => Promise<{ data?: any; error?: string }>;
  unshareCommand: (commandId: string) => Promise<{ success?: boolean; error?: string }>;

  // Handoffs - global session handoff files
  getHandoffs?: (limit?: number) => Promise<HandoffInfo[]>;
  getHandoffContent?: (filePath: string) => Promise<{ name: string; content: string; filePath: string } | null>;
  invokeHandoff?: (filePath: string) => Promise<{ success: boolean; error?: string }>;
}

/**
 * Fine-grained operational condition for hot mic, overlaid on the base state.
 */
type HotMicCondition = 'warming' | 'ready' | 'degraded' | 'yielded' | 'muted';

/**
 * Full observable runtime status for hot mic operational health.
 */
interface HotMicRuntimeStatus {
  state: string;
  condition: HotMicCondition | null;
  engineReady: boolean;
  whisperFallbackActive: boolean;
  queueDepth: number;
  lastChunkAgeMs: number | null;
  chunksReceived: number;
  micHealthy: boolean;
  engine: {
    selectedEngine: 'whisper' | 'mlx-whisper' | 'parakeet' | 'parakeet-multilingual';
    source: 'global';
    whisperModel: string | null;
    readiness:
      | 'ready'
      | 'warming'
      | 'cold'
      | 'not-installed'
      | 'not-downloaded'
      | 'corrupt'
      | 'unsupported-arch'
      | 'disabled';
    detail: string | null;
    fallbackAvailable: boolean;
  } | null;
}

/**
 * Hot Mic API for continuous voice input to Claude Code terminals.
 */
interface HotMicAPI {
  getInputMode: () => Promise<'hot-mic' | 'standard'>;
  setInputMode: (mode: 'hot-mic' | 'standard') => Promise<'hot-mic' | 'standard'>;
  getStatus: () => Promise<{ state: string; muted: boolean }>;
  getState: () => Promise<string>;
  getRuntimeStatus: () => Promise<HotMicRuntimeStatus>;
  onRuntimeStatusChanged: (handler: (status: HotMicRuntimeStatus) => void) => () => void;
  getMuted: () => Promise<boolean>;
  getEnabled: () => Promise<boolean>;
  getTranscriptionEngineMode: () => Promise<'default' | 'whisper' | 'mlx-whisper' | 'parakeet' | 'parakeet-multilingual'>;
  setTranscriptionEngineMode: (mode: 'default' | 'whisper' | 'mlx-whisper' | 'parakeet' | 'parakeet-multilingual') => Promise<'default' | 'whisper' | 'mlx-whisper' | 'parakeet' | 'parakeet-multilingual'>;
  getWhisperModel: () => Promise<string>;
  setWhisperModel: (model: string) => Promise<string>;
  setEnabled: (enabled: boolean) => Promise<boolean>;
  getTargetApp: () => Promise<string | null>;
  setTargetApp: (bundleId: string | null) => Promise<string | null>;
  getSoundsEnabled: () => Promise<boolean>;
  setSoundsEnabled: (enabled: boolean) => Promise<boolean>;
  getBackgroundFilterEnabled: () => Promise<boolean>;
  setBackgroundFilterEnabled: (enabled: boolean) => Promise<boolean>;
  getBackgroundFilterStrength: () => Promise<number>;
  setBackgroundFilterStrength: (strength: number) => Promise<number>;
  getDrawerTextSize: () => Promise<number>;
  setDrawerTextSize: (size: number) => Promise<number>;
  getIslandGeometry: () => Promise<{
    notchWidthOverride: number;
    pillWidth: number;
    pillHeight: number;
    offsetX: number;
    offsetY: number;
  }>;
  setIslandGeometry: (geometry: Partial<{
    notchWidthOverride: number;
    pillWidth: number;
    pillHeight: number;
    offsetX: number;
    offsetY: number;
  }>) => Promise<{
    notchWidthOverride: number;
    pillWidth: number;
    pillHeight: number;
    offsetX: number;
    offsetY: number;
  }>;
  resetIslandGeometry: () => Promise<{
    notchWidthOverride: number;
    pillWidth: number;
    pillHeight: number;
    offsetX: number;
    offsetY: number;
  }>;
  getResolvedIslandGeometry: () => Promise<{
    notchWidthOverride: number;
    pillWidth: number;
    pillHeight: number;
    offsetX: number;
    offsetY: number;
  } | null>;
  getIslandStayOnLaptop: () => Promise<boolean>;
  setIslandStayOnLaptop: (value: boolean) => Promise<boolean>;
  getRecordingIndicatorMode: () => Promise<'auto' | 'notch' | 'floating'>;
  setRecordingIndicatorMode: (mode: 'auto' | 'notch' | 'floating') => Promise<'auto' | 'notch' | 'floating'>;
  getResolvedRecordingIndicatorMode: () => Promise<'notch' | 'floating'>;
  getFloatingIndicatorPosition: () => Promise<{ x: number; y: number } | null>;
  setFloatingIndicatorPosition: (position: { x: number; y: number } | null) => Promise<{ x: number; y: number } | null>;
  getIslandAutoHide: () => Promise<boolean>;
  setIslandAutoHide: (value: boolean) => Promise<boolean>;
  getSubmitWord: () => Promise<string>;
  setSubmitWord: (word: string) => Promise<string>;
  getHotkey: () => Promise<string | null>;
  setHotkey: (hotkey: string | null) => Promise<boolean>;
  getPasteWords: () => Promise<string>;
  setPasteWords: (words: string) => Promise<string>;
  getShowWordCount: () => Promise<boolean>;
  setShowWordCount: (enabled: boolean) => Promise<boolean>;
  getCancelWords: () => Promise<string>;
  setCancelWords: (words: string) => Promise<string>;
  getScrapWords: () => Promise<string>;
  setScrapWords: (words: string) => Promise<string>;
  getPrevWindowWords: () => Promise<string>;
  setPrevWindowWords: (words: string) => Promise<string>;
  getNewWindowWords: () => Promise<string>;
  setNewWindowWords: (words: string) => Promise<string>;
  getCloseWindowWords: () => Promise<string>;
  setCloseWindowWords: (words: string) => Promise<string>;
  getMinimizePhrases: () => Promise<string>;
  setMinimizePhrases: (words: string) => Promise<string>;
  getHidePhrases: () => Promise<string>;
  setHidePhrases: (words: string) => Promise<string>;
  getQuitPhrases: () => Promise<string>;
  setQuitPhrases: (words: string) => Promise<string>;
  getSwitchWords: () => Promise<string>;
  setSwitchWords: (words: string) => Promise<string>;
  getOpenAppPrefixes: () => Promise<string>;
  setOpenAppPrefixes: (words: string) => Promise<string>;
  getQuitAppPrefixes: () => Promise<string>;
  setQuitAppPrefixes: (words: string) => Promise<string>;
  getRunClaudeWords: () => Promise<string>;
  setRunClaudeWords: (words: string) => Promise<string>;
  getRunCodexWords: () => Promise<string>;
  setRunCodexWords: (words: string) => Promise<string>;
  getRestartServerWords: () => Promise<string>;
  setRestartServerWords: (words: string) => Promise<string>;
  getRestartServerCommand: () => Promise<string>;
  setRestartServerCommand: (command: string) => Promise<string>;
  getFocusPhrases: () => Promise<string>;
  setFocusPhrases: (words: string) => Promise<string>;
  getCascadePhrases: () => Promise<string>;
  setCascadePhrases: (words: string) => Promise<string>;
  getRectangleCommands: () => Promise<Record<string, string>>;
  setRectangleCommands: (commands: Record<string, string>) => Promise<Record<string, string>>;
  getSystemCommands: () => Promise<Record<string, string>>;
  setSystemCommand: (action: string, phrases: string) => Promise<boolean>;
  getKnownTerminals: () => Promise<Array<{ name: string; bundleId: string }>>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  isHookInstalled: () => Promise<boolean>;
  installHook: () => Promise<{ success: boolean; error?: string }>;
  uninstallHook: () => Promise<{ success: boolean; error?: string }>;
  resetCommandDefaults: () => Promise<boolean>;
  onStateChanged: (callback: (state: string) => void) => () => void;
  onStatusChanged: (callback: (status: { state: string; muted: boolean }) => void) => () => void;
  onInputModeChanged: (callback: (mode: 'hot-mic' | 'standard') => void) => () => void;
}

/**
 * Valid hotkey IDs that can be get/set via the hotkeyAPI.
 */
type HotkeyId = 'superPaste' | 'commandLauncher' | 'scratchpad';

/**
 * Generic hotkey management API for UI-configurable hotkeys.
 */
interface HotkeyAPI {
  getHotkey: (id: HotkeyId) => Promise<string | null>;
  setHotkey: (id: HotkeyId, key: string) => Promise<{ success: boolean; error?: string }>;
  getAllHotkeys: () => Promise<Record<HotkeyId, string | null>>;
  /** Test if a hotkey is working (not captured by another app) */
  testHotkey: (key: string, timeoutMs?: number) => Promise<HotkeyTestResult>;
  /** Get list of running apps known to capture hotkeys */
  getRunningConflictApps: () => Promise<string[]>;
}

/**
 * Extend the Window interface with our custom APIs.
 */
/**
 * Theme API for dark mode synchronization across windows.
 */
interface ThemeAPI {
  initialTheme?: boolean;
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
  saveReading: (path: string, content: string, expectedVersion?: DocumentVersion | null) => Promise<DocumentSaveResult>;
  deleteReading: (path: string) => Promise<boolean>;
  getWatchedDirs: () => Promise<WatchedDir[]>;
  addWatchedDir: (dirPath: string) => Promise<WatchedDir | null>;
  removeWatchedDir: (path: string) => Promise<boolean>;
  browseDirectory: () => Promise<string | null>;
  onReadingAdded: (callback: (reading: Reading) => void) => () => void;
  onReadingUpdated: (callback: (reading: ReadingMeta) => void) => () => void;
  onReadingRemoved: (callback: (path: string) => void) => () => void;
  onReadingRenamed: (callback: (event: { oldPath: string; reading: ReadingMeta; traceId?: string; detectedAt?: number; emittedAt?: number }) => void) => () => void;
  onSetFullscreen: (callback: (fullscreen: boolean) => void) => () => void;
  onShowReading: (callback: (readingPath: string) => void) => () => void;
  // Settings API
  isEnabled: () => Promise<boolean>;
  setEnabled: (enabled: boolean) => Promise<boolean>;
  isSetupComplete: () => Promise<boolean>;
  setSetupComplete: (complete: boolean) => Promise<void>;
  createWelcomeArtifact: (dirPath: string) => Promise<boolean>;
  // State-Enforced Mode API
  getStateEnforcedThreshold: () => Promise<number>;
  setStateEnforcedThreshold: (threshold: number) => Promise<boolean>;
  getDefaultRuleContent: () => Promise<string>;
  getCustomRuleContent: () => Promise<string | undefined>;
  setCustomRuleContent: (content: string | undefined) => Promise<boolean>;
  installStateEnforcedHook: () => Promise<boolean>;
  uninstallStateEnforcedHook: () => Promise<boolean>;
  isStateEnforcedHookInstalled: () => Promise<boolean>;
  getPendingJobCount: () => Promise<number>;
  // Cursor Hook API
  isCursorHookInstalled: () => Promise<boolean>;
  installCursorHook: () => Promise<boolean>;
  uninstallCursorHook: () => Promise<boolean>;
  // Codex Hook API
  getCodexStatus: () => Promise<'installed' | 'not-installed'>;
  isCodexHookInstalled: () => Promise<boolean>;
  installCodexHook: () => Promise<boolean>;
  uninstallCodexHook: () => Promise<boolean>;
  isCodexStopOnPendingEnabled: () => Promise<boolean>;
  setCodexStopOnPendingEnabled: (enabled: boolean) => Promise<boolean>;
  // Discovery Frequency API
  getDiscoveryFrequency: () => Promise<string>;
  setDiscoveryFrequency: (frequency: string) => Promise<boolean>;
  // User Expertise API
  getUserExpertiseContext: () => Promise<string | undefined>;
  setUserExpertiseContext: (context: string | undefined) => Promise<boolean>;
  // Legacy Settings API (deprecated)
  getAutoRunFrequency: () => Promise<string>;
  setAutoRunFrequency: (frequency: string) => Promise<boolean>;
  getCursorInstructions: () => Promise<string>;
  // Configuration file management
  getConfigPaths: () => Promise<{ claudeMd: string; librarianCommand: string }>;
  openInEditor: (filePath: string) => Promise<boolean>;
  readConfigFile: (filePath: string) => Promise<string | null>;
  writeConfigFile: (filePath: string, content: string) => Promise<boolean>;
  getAutoShowEnabled: () => Promise<boolean>;
  setAutoShowEnabled: (enabled: boolean) => Promise<void>;
  getAutoShowStealsFocus: () => Promise<boolean>;
  setAutoShowStealsFocus: (enabled: boolean) => Promise<void>;
  getResumeAfterClose: () => Promise<boolean>;
  setResumeAfterClose: (enabled: boolean) => Promise<void>;
  getImmersiveHeightPercent: () => Promise<number>;
  setImmersiveHeightPercent: (percent: number) => Promise<void>;
  getClaudeCodeStatus: () => Promise<'installed' | 'directory-only' | 'not-installed'>;
  getClaudeConfigPath: () => Promise<string>;
  resyncClaudeMd: () => Promise<boolean>;
  // Hook management
  installClaudeCodeHook: () => Promise<boolean>;
  uninstallClaudeCodeHook: () => Promise<boolean>;
  isClaudeCodeHookInstalled: () => Promise<boolean>;
  initializeProjectStatus: (projectPath: string) => Promise<void>;
  onNewReadingAvailable: (callback: (readingPath: string) => void) => () => void;
  onShowNewReading: (callback: (readingPath: string) => void) => () => void;
  setMarkdownEditorFocused: (focused: boolean) => void;
  onInsertMarkdownText: (callback: (text: string) => void) => () => void;
  onInsertPlainMarkdownText?: (callback: (text: string) => void) => () => void;
  onReplaceSelectedMarkdownText?: (callback: (request: ReplaceSelectedMarkdownTextRequest) => boolean | Promise<boolean>) => () => void;
  setImmersiveMode: (immersive: boolean) => void;
  setImmersiveDismissable: (dismissable: boolean) => void;
  setSizeKey: (key: 'fields' | 'library' | 'canvas' | 'draw') => void;
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
  getEditStatus: () => Promise<{ edits: number; threshold: number; frequency: string } | null>;
  // Custom threshold
  getCustomThreshold: () => Promise<number | undefined>;
  setCustomThreshold: (threshold: number | undefined) => Promise<boolean>;
  // Public sharing
  shareReading: (filePath: string) => Promise<{ slug: string; url: string } | null>;
  unshareReading: (filePath: string) => Promise<boolean>;
  getShareStatus: (filePath: string) => Promise<{ shared: boolean; slug?: string; url?: string } | null>;
  updateSharedReading: (filePath: string, content: string, title: string) => Promise<boolean>;
  // Poll status (used in ClipboardHistory)
  pollStatus?: () => Promise<{ pending: number; completed: number; pendingPath?: string } | null>;
  // Mute for today
  muteForToday: () => Promise<boolean>;
  isMutedForToday: () => Promise<boolean>;
  unmute: () => Promise<boolean>;
  // Concepts index for story/lesson deduplication graph
  getConceptsIndex: () => Promise<ConceptsIndex | null>;
}

type SharedFileType = 'document' | 'command' | 'plan';

interface SharedFileStatus {
  shared: boolean;
  sharedId?: string;
  revision?: number;
  cachePath?: string;
  error?: string;
}

interface SharedFileShareInput {
  filePath: string;
  title?: string;
  content: string;
  type?: SharedFileType;
}

interface SharedFileUpdateResult {
  ok: boolean;
  revision?: number;
  cachePath?: string;
  conflictPath?: string;
  remoteContent?: string;
  error?: string;
}

interface SharedFilePresenceUser {
  userId: string;
  email: string | null;
  initials: string;
}

interface SharedFilesAvailability {
  available: boolean;
  canWrite: boolean;
  hasTeamMembers: boolean;
  reason?: 'not_authenticated' | 'no_team_members' | 'pending_only' | 'ambiguous_team_scope' | 'lookup_failed';
  currentTeamScopeUserId?: string | null;
}

interface SharedFilePinResult {
  ok: boolean;
  pinned?: boolean;
  reason?: 'not_authenticated' | 'not_shared' | 'not_available' | 'read_only' | 'request_failed';
  error?: string;
}

interface SharedFilesAPI {
  getAvailability: () => Promise<SharedFilesAvailability>;
  getStatus: (filePath: string) => Promise<SharedFileStatus>;
  share: (input: SharedFileShareInput) => Promise<SharedFileStatus>;
  unshare: (filePath: string) => Promise<boolean>;
  sync: () => Promise<{ written: number; removed: number; created: number; errors: string[] }>;
  updateContent: (sharedId: string, content: string, expectedRevision: number, documentPath?: string | null) => Promise<SharedFileUpdateResult>;
  setActivePresence: (sharedId: string | null) => Promise<SharedFilePresenceUser[]>;
  getPinnedItemIds: () => Promise<string[]>;
  setPinned: (filePath: string, pinned: boolean) => Promise<SharedFilePinResult>;
  onPresenceChanged: (callback: (payload: { sharedId: string; users: SharedFilePresenceUser[] }) => void) => () => void;
  onPinsChanged: (callback: () => void) => () => void;
}

type SharedTeamUnavailableReason =
  | 'not_authenticated'
  | 'no_team_members'
  | 'pending_only'
  | 'ambiguous_team_scope'
  | 'lookup_failed';

interface SharedTeamMember {
  contactId: string;
  userId: string | null;
  email: string;
  role: 'owner' | 'member';
  teamScopeUserId: string;
}

interface SharedTeamInvite {
  contactId: string;
  ownerUserId: string;
  contactUserId: string | null;
  email: string;
  direction: 'incoming' | 'outgoing';
  createdAt: string | null;
}

interface SharedTeamState {
  available: boolean;
  currentTeamScopeUserId: string | null;
  reason?: SharedTeamUnavailableReason;
  isOwner: boolean;
  members: SharedTeamMember[];
  pendingIncoming: SharedTeamInvite[];
  pendingOutgoing: SharedTeamInvite[];
}

interface SharedTeamMutationResult {
  ok: boolean;
  error?: string;
}

interface TeamAPI {
  getState: () => Promise<SharedTeamState>;
  inviteMember: (email: string) => Promise<SharedTeamMutationResult>;
  respondToInvite: (contactId: string, accept: boolean) => Promise<SharedTeamMutationResult>;
  removeMember: (contactId: string) => Promise<SharedTeamMutationResult>;
  leaveTeam: () => Promise<SharedTeamMutationResult>;
  onTeamChanged: (callback: () => void) => () => void;
}

declare global {
  /**
   * Result of testing a hotkey for conflicts.
   */
  interface HotkeyTestResult {
    key: string;
    status: 'working' | 'conflict' | 'error';
    callbackFired: boolean;
    conflictApp?: string;
    error?: string;
  }

  /**
   * Reading metadata for sidebar display.
   * Path is the identity - no numeric IDs.
   */
  interface ReadingMeta {
    path: string;
    title: string;
    context: string | null;
    readingTime: string | null;
    modelSignature: string | null;
    createdAt: number;
    mtime: number;
    todoState?: MarkdownTodoState;
    sharedOriginalSourcePath?: string;
    sharedAuthorCallsign?: string;
    editActor?: MarkdownEditActor;
  }

  /**
   * Full reading with content (loaded on demand).
   */
  interface Reading extends ReadingMeta {
    content: string;
    documentVersion: DocumentVersion;
  }

  /**
   * Watched directory for Librarian.
   * Path is the identity - no numeric IDs.
   */
  interface WatchedDir {
    path: string;
    enabled: boolean;
  }

  // ── Wiki viewer types ──────────────────────────────────────────────────

  type MarkdownTodoState = 'open' | 'done';
  type MarkdownEditActor = {
    type: 'human' | 'model' | 'system';
    name: string;
    detail?: string;
  };

  interface WikiPageMeta {
    relPath: string;     // e.g. 'entries/2026-04-15-foo' (no .md)
    absPath: string;     // full filesystem path
    name: string;        // filename slug without date/ext
    title: string;       // filename without extension
    lastUpdated: number; // mtime
    documentKind?: 'markdown' | 'html' | 'css';
    todoState?: MarkdownTodoState;
    archived?: boolean;
    sharedOriginalSourcePath?: string;
    sharedAuthorCallsign?: string;
    editActor?: MarkdownEditActor;
  }

  interface WikiPage extends WikiPageMeta {
    content: string;
    documentVersion: DocumentVersion;
  }

  interface WikiFolder {
    name: string;           // 'categories', 'domains', 'entries', 'entities'
    files: WikiPageMeta[];  // alphabetically sorted
  }

  type WikiNode =
    | { kind: 'file'; relPath: string; absPath: string; name: string; title: string; lastUpdated: number; documentKind?: 'markdown' | 'html' | 'css'; todoState?: MarkdownTodoState; archived?: boolean; sharedOriginalSourcePath?: string; sharedAuthorCallsign?: string; editActor?: MarkdownEditActor }
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
    traceId?: string;
    source?: 'app' | 'watcher' | 'external';
    detectedAt?: number;
    emittedAt?: number;
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

  interface LibraryAPI {
    getRoots: () => Promise<LibraryRoot[]>;
    previewMigration: () => Promise<LibraryMigrationPlan>;
    executeMigration: () => Promise<LibraryMigrationExecutionResult>;
    getHiddenFolders: () => Promise<string[]>;
    setFolderHidden: (folderId: string, hidden: boolean) => Promise<string[]>;
    addRoot: (dirPath: string) => Promise<LibraryRoot | null>;
    removeRoot: (dirPath: string) => Promise<boolean>;
    createFile: (rootPath: string, folderRelPath: string, fileName: string) => Promise<WikiPage | null>;
    createDir: (rootPath: string, dirRelPath: string) => Promise<boolean>;
    deleteDir: (rootPath: string, dirRelPath: string) => Promise<boolean>;
    moveItem: (rootPath: string, kind: 'file' | 'dir', sourceRelPath: string, targetDirRelPath: string, targetRootPath?: string) => Promise<string | null>;
    pickFolder: () => Promise<string | null>;
    openDocumentWindow: (target: LibraryDocumentWindowTarget) => Promise<{ success: boolean; error?: string }>;
    onRootsChanged: (callback: () => void) => () => void;
    onItemRenamed: (callback: (event: LibraryRenameEvent) => void) => () => void;
  }

  interface PossibleIdeaFrame {
    id: string;
    name: string;
    axisA?: { label?: string; rubricSentence?: string };
    axisB?: { label?: string; rubricSentence?: string };
    quadrantLabels?: {
      highHigh?: string;
      highLow?: string;
      lowHigh?: string;
      lowLow?: string;
    };
  }

  interface PossibleIdeaBatchSummary {
    id: string;
    batchPath: string;
    createdAt: string;
    seedId: string;
    seedArtifactIds: string[];
    frameId: string;
    frameName: string;
    depth: string;
    model: string;
    nodeTarget: number;
    totalDotCount: number;
    considerationIds: string[];
    repos: string[];
  }

  interface PossibleIdeaLibraryLink {
    title: string;
    relPath: string;
    path: string;
  }

  interface PossibleIdeaBookmarkSource {
    artifactId: string;
    bookmarkId: string;
    authorHandle: string;
    url: string;
    postedAt: string;
    bookmarkedAt: string;
    category: string;
    domain: string;
    title: string;
    excerpt: string;
    artifactPath: string;
  }

  interface PossibleIdeaNode {
    id: string;
    title: string;
    summary: string;
    essay: string;
    rationale: string;
    repoSurface: string;
    effortEstimate: string;
    axisAScore: number;
    axisAJustification: string;
    axisBScore: number;
    axisBJustification: string;
    exportablePrompt: string;
    implementationPrompt: string;
    repo: string;
    repoName: string;
    runId: string;
    artifactPath: string;
    rank: number;
    libraryLinks: PossibleIdeaLibraryLink[];
  }

  interface PossibleIdeaBatch extends PossibleIdeaBatchSummary {
    axisA: string;
    axisB: string;
    frame: PossibleIdeaFrame | null;
    seedTitle: string;
    seedNotes: string;
    bookmarkSources: PossibleIdeaBookmarkSource[];
    nodes: PossibleIdeaNode[];
  }

  interface PossibleAPI {
    listBatches: () => Promise<PossibleIdeaBatchSummary[]>;
    getBatch: (batchId?: string) => Promise<PossibleIdeaBatch | null>;
  }

  type LibraryDocumentWindowTarget = {
    kind: 'wiki' | 'artifact' | 'external';
    path: string;
    contentMode?: 'rendered' | 'markdown' | 'typedown';
    sidebarCollapsed?: boolean;
  };

  interface WikiAPI {
    getTree: () => Promise<WikiFolder[]>;
    getPage: (relPath: string) => Promise<WikiPage | null>;
    findPageByDocumentVersion: (version: DocumentVersion, previousRelPath?: string) => Promise<WikiPage | null>;
    save: (relPath: string, content: string, expectedVersion?: DocumentVersion | null) => Promise<DocumentSaveResult>;
    createFile: (folderName: string, fileName: string) => Promise<WikiPage | null>;
    createFileWithDefaultTitle: (folderName: string) => Promise<WikiPage | null>;
    createScratchpadDefault: () => Promise<WikiPage | null>;
    openScratchpadDefault: () => Promise<WikiPage | null>;
    createDir: (dirName: string) => Promise<boolean>;
    rename: (relPath: string, newName: string) => Promise<string | null>;
    deletePage: (relPath: string) => Promise<boolean>;
    onPageChanged: (callback: () => void) => () => void;
    onPageDeleted: (callback: (relPath: string) => void) => () => void;
    onPageRenamed: (callback: (event: LibraryRenameEvent) => void) => () => void;
    onOpenWikiPage: (callback: (relPath: string) => void) => () => void;
    onOpenScratchpad: (callback: (relPath: string) => void) => () => void;
  }

  // External markdown files opened via macOS `open-file` for paths that fall
  // outside the wiki root. Read/write happens in place — no copy.
  interface ExternalMarkdownFile {
    path: string;    // canonical absolute path
    name: string;    // basename (e.g. "README.md")
    content: string;
    mtime: number;
    documentVersion: DocumentVersion;
  }

  interface ExternalAPI {
    open: (absPath: string) => Promise<ExternalMarkdownFile | null>;
    save: (absPath: string, content: string, expectedVersion?: DocumentVersion | null) => Promise<DocumentSaveResult>;
    findLibraryFileByDocumentVersion: (version: DocumentVersion, previousAbsPath?: string) => Promise<ExternalMarkdownFile | null>;
    rename: (absPath: string, newName: string) => Promise<ExternalMarkdownFile | null>;
    delete: (absPath: string) => Promise<boolean>;
    onOpenExternal: (callback: (absPath: string) => void) => () => void;
  }

  interface MarkdownImagesAPI {
    copyImageForDocument: (
      documentPath: string,
      imagePath: string,
      alt?: string,
    ) => Promise<{ markdown: string; destination: string; copiedPath: string } | null>;
    copyImageDataUrlForDocument: (
      documentPath: string,
      dataUrl: string,
      alt?: string,
    ) => Promise<{ markdown: string; destination: string; copiedPath: string } | null>;
    makeImagesPortable: (
      documentPath: string,
      content: string,
    ) => Promise<{ content: string; copied: number; rewritten: number; missing: number }>;
    deleteUnusedCopiedImages: (
      documentPath: string,
      removedMarkdown: string,
      remainingContent: string,
    ) => Promise<{ deleted: number; skipped: number; missing: number }>;
  }

  interface RecentEntry {
    kind: 'wiki' | 'external';
    path: string;
    title: string;
    lastOpenedAt: number;
  }

  interface RecentAPI {
    list: () => Promise<RecentEntry[]>;
    visit: (entry: RecentEntry) => Promise<RecentEntry[]>;
    remove: (kind: 'wiki' | 'external', entryPath: string) => Promise<RecentEntry[]>;
    onChanged: (callback: () => void) => () => void;
  }

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
  interface BookmarkFolder {
    name: string;
    id?: string;
  }
  interface BookmarksSnapshot {
    bookmarks: Bookmark[];
    folders: BookmarkFolder[];
    xLastSyncedAt: string | null;
  }
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
  interface BookmarksAPI {
    getAll: () => Promise<BookmarksSnapshot>;
    getDataSource?: () => Promise<unknown>;
    syncIfStale: () => Promise<{ status: string; error?: string }>;
    getAuthors: () => Promise<BookmarkAuthorSummary[]>;
    getAuthorBookmarks: (handle: string) => Promise<Bookmark[]>;
    getTaxonomyBookmarks: (filePaths: string[]) => Promise<Bookmark[]>;
    search: (query: string) => Promise<Bookmark[]>;
    saveWebUrl: (url: string) => Promise<{ success: boolean; bookmark?: Bookmark; markdownPath?: string; created?: boolean; error?: string }>;
    getActiveWebPage: () => Promise<{ success: boolean; page?: ActiveWebPage; error?: string }>;
    saveActiveWebPage: () => Promise<{ success: boolean; page?: ActiveWebPage; bookmark?: Bookmark; markdownPath?: string; created?: boolean; error?: string }>;
    invokeBookmark: (id: string) => Promise<{ success: boolean; error?: string }>;
    sendToCodex?: (id: string) => Promise<{ success: boolean; error?: string; delivery?: string }>;
    copyForAgent: (id: string) => Promise<{ success: boolean; error?: string }>;
    invokeAuthorTimeline: (handle: string) => Promise<{ success: boolean; error?: string }>;
    onChanged: (callback: () => void) => () => void;
  }
  interface FieldTheoryBookmarkMediaAPI {
    mediaUrl: (filename: string) => string;
  }
  interface FieldTheoryLocalImageAPI {
    localImageUrl: (url: string) => string;
  }

  /**
   * Concepts index for story/lesson deduplication.
   * Tracks which historical examples and lessons have been used in artifacts.
   */
  interface ConceptsIndex {
    schema_version: number;
    description?: string;
    indexed_at: string | null;
    artifacts: Record<string, {
      title: string;
      stories: string[];
      lessons: string[];
    }>;
    stories_used: string[];
    lessons_used: string[];
  }

  /**
   * Permission profile info
   */
  interface PermissionProfile {
    id: string;
    name: string;
    description: string;
    permissionCount: number;
    permissions: string[];
  }

  /**
   * Permission status info
   */
  interface PermissionStatus {
    currentProfile: string | null;
    managedPermissions: string[];
    allClaudePermissions: string[];
  }

  /**
   * Claude API - Claude Code integration settings
   */
  interface ClaudeAPI {
    isScreenshotPermissionEnabled: () => Promise<boolean>;
    enableScreenshotPermission: () => Promise<boolean>;
    getFiguresPath?: () => Promise<string>;
    getAvailableProfiles: () => Promise<PermissionProfile[]>;
    getPermissionStatus: () => Promise<PermissionStatus>;
    applyPermissionProfile: (profileId: string) => Promise<boolean>;
    addPermissions: (permissions: string[]) => Promise<boolean>;
    removePermissions: (permissions: string[]) => Promise<boolean>;
    clearManagedPermissions: () => Promise<boolean>;
    // Read permission hooks (auto-approve Field Theory file reads)
    isReadPermissionHookInstalled: () => Promise<boolean>;
    needsReadPermissionUpdate: () => Promise<boolean>;
    installReadPermissionHook: () => Promise<{ success: boolean; message: string }>;
    uninstallReadPermissionHook: () => Promise<{ success: boolean; message: string }>;
  }

  /**
   * Cursor API - Cursor IDE integration settings
   */
  interface CursorAPI {
    // Read permission hooks (auto-approve Field Theory file reads)
    isReadPermissionHookInstalled: () => Promise<boolean>;
    installReadPermissionHook: () => Promise<{ success: boolean; message: string }>;
    uninstallReadPermissionHook: () => Promise<{ success: boolean; message: string }>;
  }

  /**
   * Codex Read Permission API - Auto-approve Field Theory file reads in Codex CLI.
   */
  interface CodexReadPermissionAPI {
    isReadPermissionHookInstalled: () => Promise<boolean>;
    installReadPermissionHook: () => Promise<{ success: boolean; message: string }>;
    uninstallReadPermissionHook: () => Promise<{ success: boolean; message: string }>;
  }

  /**
   * Metrics API - User-visible usage stats
   * "The metrics you see are the metrics we see."
   */
  interface UserMetrics {
    transcriptions: number;
    words_transcribed: number;
    words_improved: number;
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

  interface MetricsAPI {
    getMetrics: () => Promise<UserMetrics>;
    getMetricsWithStatus: () => Promise<{
      metrics: UserMetrics;
      lastSyncedAt: string | null;
      pendingSync: boolean;
    }>;
    syncToSupabase: () => Promise<boolean>;
    fetchFromSupabase: () => Promise<boolean>;
  }

  // =============================================================================
  // Narration API - STUB TYPES (feature disabled via FEATURE_NARRATION_ENABLED)
  // These types exist only to satisfy TypeScript for feature-flagged code
  // =============================================================================

  /**
   * Narration status stub.
   */
  interface NarrationStatus {
    state: 'idle' | 'loading' | 'playing' | 'paused' | 'error';
    readingPath: string | null;
    progress: number;
    duration: number;
    error: string | null;
    playbackStatus: 'idle' | 'playing' | 'paused' | 'generating' | 'stopped';
    currentReadingPath: string | null;
    installStatus: 'installed' | 'not_installed' | 'installing' | 'install_failed';
    cacheSizeBytes: number;
    cachedItemCount: number;
  }

  /**
   * Narration voice stub.
   */
  interface NarrationVoice {
    voiceId: string;
    name: string;
    speed?: number;
  }

  /**
   * Narration preferences stub.
   */
  interface NarrationPreferences {
    autoPlay: boolean;
    selectedVoice: string | null;
    speakOnOpen: boolean;
    blockedDevices: string[];
  }

  /**
   * Narration API stub - feature disabled, types for compile-time only.
   */
  interface NarrationAPI {
    getStatus: () => Promise<NarrationStatus>;
    getVoices: () => Promise<NarrationVoice[]>;
    getSelectedVoice: () => Promise<string | null>;
    setSelectedVoice: (voiceId: string) => Promise<boolean>;
    getPreferences: () => Promise<NarrationPreferences>;
    setPreferences: (prefs: Partial<NarrationPreferences>) => Promise<boolean>;
    getPrefs: () => Promise<NarrationPreferences>;
    playReading: (readingPath: string) => Promise<boolean>;
    play: () => Promise<boolean>;
    pause: () => Promise<boolean>;
    stop: () => Promise<boolean>;
    togglePause: () => Promise<boolean>;
    getPlaybackProgress: () => Promise<{ progress: number; duration: number; percentage: number } | null>;
    getLibrarianVoices: () => Promise<NarrationVoice[]>;
    getCurrentVoiceId: () => Promise<string | null>;
    setElevenlabsVoice: (voiceId: string) => Promise<boolean>;
    clearCache: () => Promise<boolean>;
    onStatusChange: (callback: (status: NarrationStatus) => void) => () => void;
    onLoadingProgress: (callback: (readingPath: string, progress: number) => void) => () => void;
    onPlaybackProgress: (callback: (readingPath: string, progress: number, duration: number) => void) => () => void;
    onError: (callback: (readingPath: string, error: string) => void) => () => void;
    onGenerationStarted: (callback: (readingPath: string) => void) => () => void;
    onPlaybackStarted: (callback: (readingPath: string, duration: number) => void) => () => void;
    onPlaybackPaused: (callback: () => void) => () => void;
    onPlaybackResumed: (callback: () => void) => () => void;
    onPlaybackStopped: (callback: () => void) => () => void;
    onPlaybackError: (callback: (error: string) => void) => () => void;
    removeAllListeners: (event: string) => void;
  }

  // =========================================================================
  // Squares API - Window Management (instant snap)
  // =========================================================================

  /**
   * Window frame: position and size in screen coordinates.
   */
  interface SquaresWindowFrame {
    x: number;
    y: number;
    width: number;
    height: number;
  }

  /**
   * Info about a macOS window.
   */
  interface SquaresWindowInfo {
    windowId: number;
    ownerName: string;
    ownerPID: number;
    ownerBundleId: string;
    title: string;
    frame: SquaresWindowFrame;
    isOnScreen: boolean;
  }

  /**
   * Display/screen info.
   */
  interface SquaresScreenInfo {
    id: number;
    frame: SquaresWindowFrame;
    visibleFrame: SquaresWindowFrame;
    isPrimary: boolean;
  }

  /**
   * Squares configuration.
   */
  interface SquaresConfig {
    enabled: boolean;
    showInCommandLauncher: boolean;
    gapSize: number;
    maxHistorySize: number;
    focusHeightPercent: number;
    focusKeepHeight: boolean;
    focusWidthPercent: number;
    horizontalHeightPercent: number;
    horizontalKeepHeight: boolean;
    horizontalHideOthers: boolean;
  }

  /**
   * Squares hotkey assignments.
   */
  interface SquaresHotkeys {
    leftHalf: string;
    rightHalf: string;
    topHalf: string;
    bottomHalf: string;
    topLeft: string;
    topRight: string;
    bottomLeft: string;
    bottomRight: string;
    firstThird: string;
    centerThird: string;
    lastThird: string;
    firstTwoThirds: string;
    lastTwoThirds: string;
    maximize: string;
    almostMaximize: string;
    center: string;
    restore: string;
    grid: string;
    focus: string;
    horizontalSpread: string;
    verticalSpread: string;
    cascade: string;
  }

  /**
   * All possible Squares actions.
   */
  type SquaresAction =
    | 'leftHalf' | 'rightHalf' | 'topHalf' | 'bottomHalf'
    | 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight'
    | 'firstThird' | 'centerThird' | 'lastThird' | 'firstTwoThirds' | 'lastTwoThirds'
    | 'maximize' | 'almostMaximize' | 'center' | 'restore'
    | 'grid' | 'focus' | 'horizontalSpread' | 'verticalSpread' | 'cascade';

  /**
   * Squares API for window management.
   * Controls window snapping with instant snap.
   */
  interface SquaresAPI {
    // Execute a layout action (e.g., leftHalf, grid, focus)
    executeAction: (action: SquaresAction, source?: 'default' | 'command-launcher') => Promise<boolean>;

    // Window and screen discovery
    getWindows: () => Promise<SquaresWindowInfo[]>;
    getScreens: () => Promise<SquaresScreenInfo[]>;

    // Configuration
    getConfig: () => Promise<SquaresConfig>;
    setConfig: (config: Partial<SquaresConfig>) => Promise<void>;
    getHotkeys: () => Promise<SquaresHotkeys>;
    setHotkeys: (hotkeys: Partial<SquaresHotkeys>) => Promise<void>;
    resetHotkeys: () => Promise<void>;

    // History / undo
    getHistoryCount: () => Promise<number>;
    clearHistory: () => Promise<void>;

    // Events
    onActionExecuted: (callback: (action: SquaresAction) => void) => () => void;
    onConfigChanged: (callback: (config: SquaresConfig) => void) => () => void;
  }

  interface FieldTheorySyncStatus {
    localEnabled: boolean;
    authenticated: boolean;
    serverEnforced: boolean;
    enabled: boolean;
    reason: 'enabled' | 'local_disabled' | 'not_authenticated';
  }

  interface FieldTheorySyncAPI {
    getStatus: () => Promise<FieldTheorySyncStatus>;
    setLocalEnabled: (enabled: boolean) => Promise<FieldTheorySyncStatus>;
  }

  interface CodexTerminalHistoryEntry {
    filePath: string;
    fileName: string;
    threadId: string | null;
    title: string;
    cwd: string | null;
    startedAt: string | null;
    updatedAt: string;
    sizeBytes: number;
    preview: string;
  }

  interface CodexTerminalHistoryPreview {
    filePath: string;
    threadId: string | null;
    title: string;
    cwd: string | null;
    startedAt: string | null;
    updatedAt: string;
    preview: string;
    truncated: boolean;
  }

  interface Window {
    audioAPI?: AudioAPI;
    gazeAPI?: GazeAPI;
    hotkeyAPI?: HotkeyAPI;
    transcribeAPI?: TranscribeAPI;
    clipboardAPI?: ClipboardAPI;
    permissionsAPI?: PermissionsAPI;
    electronAPI?: ElectronAPI;
    updaterAPI?: UpdaterAPI;
    onboardingAPI?: OnboardingAPI;
    todoAPI?: TodoAPI;
    taggedDocsAPI?: TaggedDocsAPI;
    authAPI?: AuthAPI;
    sharedClipboardAPI?: SharedClipboardAPI;
    socialAPI?: SocialAPI;
    cursorStatusAPI?: CursorStatusAPI;
    quotaAPI?: QuotaAPI;
    fieldTheorySyncAPI?: FieldTheorySyncAPI;
    shellAPI?: ShellAPI;
    agentImproveAPI?: AgentImproveAPI;
    commandsAPI?: CommandsAPI;
    themeAPI?: ThemeAPI;
    librarianAPI?: LibrarianAPI;
    sharedFilesAPI?: SharedFilesAPI;
    teamAPI?: TeamAPI;
    libraryAPI?: LibraryAPI;
    wikiAPI?: WikiAPI;
    markdownImagesAPI?: MarkdownImagesAPI;
    possibleAPI?: PossibleAPI;
    externalAPI?: ExternalAPI;
    recentAPI?: RecentAPI;
    bookmarksAPI?: BookmarksAPI;
    fieldTheoryBookmarkMediaAPI?: FieldTheoryBookmarkMediaAPI;
    fieldTheoryLocalImageAPI?: FieldTheoryLocalImageAPI;
    claudeAPI?: ClaudeAPI;
    cursorAPI?: CursorAPI;
    codexReadPermissionAPI?: CodexReadPermissionAPI;
    metricsAPI?: MetricsAPI;
    diagnosticsAPI?: DiagnosticsAPI;
    narrationAPI?: NarrationAPI;  // Stub - feature disabled
    hotMicAPI?: HotMicAPI;
    squaresAPI?: SquaresAPI;
    agentHooksAPI?: AgentHooksAPI;
    agentKickoffAPI?: AgentKickoffAPI;
    codexTerminalAPI?: CodexTerminalAPI;

    stripeConfig?: StripeConfig;
    platform?: PlatformInfo;
  }
}

interface AgentHookTargets { claude?: boolean; codex?: boolean }
interface AgentHookStatus { claude: boolean; codex: boolean }
interface AgentHookResult { success: boolean; message: string; claude: boolean; codex: boolean }

interface AgentHooksAPI {
  install: (targets: AgentHookTargets) => Promise<AgentHookResult>;
  uninstall: (targets: AgentHookTargets) => Promise<AgentHookResult>;
  getStatus: () => Promise<AgentHookStatus>;
}

interface CodexTerminalSessionSummary {
  id: string;
  title: string;
  cwd: string;
  engine: 'pty';
  createdAt: string;
  exitedAt: string | null;
  exitCode: number | null;
  restored: boolean;
  modelRunActive: boolean;
  transcriptPath: string;
  attachedContexts: CodexTerminalAttachedContext[];
}

interface CodexTerminalPageContext {
  title: string;
  path: string;
  kind: 'wiki' | 'artifact' | 'external' | 'unknown';
  contentMode: string;
  content: string;
  selectionText?: string;
}

interface CodexTerminalAttachResult {
  ok: boolean;
  filePath?: string;
  prompt?: string;
  error?: string;
}

interface CodexTerminalHistoryEntry {
  filePath: string;
  fileName: string;
  threadId: string | null;
  title: string;
  cwd: string | null;
  startedAt: string | null;
  updatedAt: string;
  sizeBytes: number;
  preview: string;
}

interface CodexTerminalHistoryPreview {
  filePath: string;
  threadId: string | null;
  title: string;
  cwd: string | null;
  startedAt: string | null;
  updatedAt: string;
  preview: string;
  truncated: boolean;
}

interface CodexTerminalAttachedContext {
  sessionId: string;
  sessionTitle: string;
  sessionCwd: string;
  launchedCommand: string;
  repoPath: string | null;
  gitBranch: string | null;
  filePath: string;
  title: string;
  sourcePath: string;
  kind: CodexTerminalPageContext['kind'];
  attachedAt: string;
}

interface CodexTerminalAPI {
  create: (input?: { cwd?: string; title?: string; cols?: number; rows?: number; auto?: boolean; launchCommand?: string }) => Promise<CodexTerminalSessionSummary>;
  list: () => Promise<CodexTerminalSessionSummary[]>;
  listHistory: (input?: { query?: string; limit?: number }) => Promise<CodexTerminalHistoryEntry[]>;
  readHistoryPreview: (filePath: string, input?: { maxBytes?: number }) => Promise<CodexTerminalHistoryPreview | null>;
  getBuffer: (id: string) => Promise<string | null>;
  input: (id: string, data: string) => Promise<boolean>;
  setLauncherTargetSession: (id: string | null) => Promise<boolean>;
  resize: (id: string, cols: number, rows: number) => Promise<boolean>;
  kill: (id: string) => Promise<boolean>;
  rename: (id: string, title: string) => Promise<boolean>;
  readClipboardText: () => Promise<string>;
  readTerminalPasteText: () => Promise<string>;
  writeClipboardText: (text: string) => Promise<boolean>;
  attachPageContext: (id: string, context: CodexTerminalPageContext, options?: { notifyTerminal?: boolean }) => Promise<CodexTerminalAttachResult>;
  onData: (callback: (event: { id: string; data: string }) => void) => () => void;
  onExit: (callback: (session: CodexTerminalSessionSummary) => void) => () => void;
  onSessionsChanged: (callback: (sessions: CodexTerminalSessionSummary[]) => void) => () => void;
}

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
interface AgentKickoffAPI {
  kickoff: (args: AgentKickoffArgs) => Promise<AgentKickoffStartResult>;
  cancel: (runId: string) => Promise<boolean>;
  onProgress: (callback: (event: AgentKickoffProgressEvent) => void) => () => void;
  onStatus: (callback: (event: AgentKickoffStatusEvent) => void) => () => void;
}

export {};
