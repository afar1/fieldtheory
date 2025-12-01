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
 * The transcription API exposed by the preload script.
 */
interface TranscribeAPI {
  getStatus: () => Promise<TranscriptionStatus>;
  getModelStatus: () => Promise<ModelStatus>;
  downloadModel: (modelSize?: string) => Promise<void>;
  getAvailableModels: () => Promise<Record<string, ModelInfo>>;
  getModelDownloadStatus: () => Promise<Record<string, boolean>>;
  getSelectedModel: () => Promise<string>;
  setSelectedModel: (modelSize: string) => Promise<void>;
  getHotkey: () => Promise<string>;
  setHotkey: (hotkey: string) => Promise<boolean>;
  getOverlayStyle: () => Promise<'rectangle' | 'top-emerging'>;
  setOverlayStyle: (style: 'rectangle' | 'top-emerging') => Promise<void>;
  getStackCount: () => Promise<number>;
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
 * Clipboard item.
 */
interface ClipboardItem {
  id: number;
  type: ClipboardItemType;
  content: string | null;
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
}

/**
 * Clipboard query options.
 */
interface ClipboardQueryOptions {
  type?: ClipboardItemType;
  search?: string;
  limit?: number;
  offset?: number;
}

/**
 * Clipboard hotkeys.
 */
interface ClipboardHotkeys {
  screenshot?: string;
  history?: string;
}

/**
 * The clipboard API exposed by the preload script.
 */
interface ClipboardAPI {
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
  onItemAdded: (callback: (id: number) => void) => () => void;
  onItemDeleted: (callback: (id: number) => void) => () => void;
  onShowHistory: (callback: () => void) => () => void;
  onKeyEvent: (callback: (event: { characters: string; keyCode: number; modifiers: string[] }) => void) => () => void;
  closeWindow: () => Promise<void>;
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
 * Extend the Window interface with our custom APIs.
 */
declare global {
  interface Window {
    audioAPI?: AudioAPI;
    transcribeAPI?: TranscribeAPI;
    clipboardAPI?: ClipboardAPI;
    permissionsAPI?: PermissionsAPI;
    electronAPI?: ElectronAPI;
    platform?: PlatformInfo;
  }
}

export {};
