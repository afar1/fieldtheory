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
  STATUS_CHANGED: 'transcribe:statusChanged',
  RESULT: 'transcribe:result',
  ERROR: 'transcribe:error',
  MODEL_DOWNLOAD_PROGRESS: 'transcribe:modelDownloadProgress',
  HOTKEY_CHANGED: 'transcribe:hotkeyChanged',
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
  CLEAR_ALL: 'clipboard:clearAll',
  CAPTURE_SCREENSHOT: 'clipboard:captureScreenshot',
  GET_HOTKEYS: 'clipboard:getHotkeys',
  SET_HOTKEYS: 'clipboard:setHotkeys',
  PASTE_ITEM: 'clipboard:pasteItem',
  PASTE_STACK: 'clipboard:pasteStack',
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

type StackingModeState = {
  active: boolean;
  stackId: string | null;
  targetApp: string | null;
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
  getStackCount: () => Promise<number>;
  getStackingMode: () => Promise<StackingModeState>;
  onStatusChanged: (callback: (status: TranscriptionStatus) => void) => () => void;
  onResult: (callback: (text: string) => void) => () => void;
  onError: (callback: (error: string) => void) => () => void;
  onModelDownloadProgress: (callback: (downloaded: number, total: number) => void) => () => void;
  onHotkeyChanged: (callback: (hotkey: string) => void) => () => void;
  onStackChanged: (callback: (count: number) => void) => () => void;
  onStackingModeChanged: (callback: (active: boolean, stackId: string | null) => void) => () => void;
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
  onDialogPosition: (callback: (position: { left: number; top: number }) => void) => () => void;
  onDialogBounds: (callback: (bounds: { x: number; y: number; width: number; height: number }) => void) => () => void;
  onTargetAppInfo: (callback: (info: TargetAppInfo) => void) => () => void;
  saveBounds: (bounds: { x: number; y: number; width: number; height: number }) => Promise<void>;
  closeWindow: () => Promise<void>;
  
  // Stack operations for prompt stacking feature
  queryItemsByStackId: (stackId: string) => Promise<ClipboardItem[]>;
  getUniqueStacks: () => Promise<StackInfo[]>;
  updateStackId: (itemIds: number[], stackId: string | null) => Promise<void>;
  startDrag: (stackId: string) => Promise<void>;
  
  // Mobile sync operations - sync iOS transcriptions to clipboard history
  setSyncSession: (accessToken: string, refreshToken: string) => Promise<boolean>;
  clearSyncSession: () => Promise<boolean>;
  syncMobileTranscripts: () => Promise<number>;
  getSyncEnabled: () => Promise<boolean>;
  setSyncEnabled: (enabled: boolean) => Promise<boolean>;
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

  getStackingMode: async (): Promise<StackingModeState> => {
    return ipcRenderer.invoke('transcribe:getStackingMode');
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

  onStackingModeChanged: (callback: (active: boolean, stackId: string | null) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, active: boolean, stackId: string | null) => {
      callback(active, stackId);
    };

    ipcRenderer.on('transcribe:stackingModeChanged', handler);

    return () => {
      ipcRenderer.removeListener('transcribe:stackingModeChanged', handler);
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

  clearAll: async (): Promise<void> => {
    return ipcRenderer.invoke(ClipboardIPCChannels.CLEAR_ALL);
  },

  captureScreenshot: async (region?: boolean): Promise<number> => {
    return ipcRenderer.invoke(ClipboardIPCChannels.CAPTURE_SCREENSHOT, region);
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

  pasteStack: async (ids: number[]): Promise<void> => {
    return ipcRenderer.invoke(ClipboardIPCChannels.PASTE_STACK, ids);
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

  onDialogPosition: (callback: (position: { left: number; top: number }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, position: { left: number; top: number }) => {
      callback(position);
    };
    ipcRenderer.on(ClipboardIPCChannels.DIALOG_POSITION, handler);
    return () => {
      ipcRenderer.removeListener(ClipboardIPCChannels.DIALOG_POSITION, handler);
    };
  },

  onDialogBounds: (callback: (bounds: { x: number; y: number; width: number; height: number }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, bounds: { x: number; y: number; width: number; height: number }) => {
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

  getSyncEnabled: async (): Promise<boolean> => {
    return ipcRenderer.invoke('clipboard:getSyncEnabled');
  },

  setSyncEnabled: async (enabled: boolean): Promise<boolean> => {
    return ipcRenderer.invoke('clipboard:setSyncEnabled', enabled);
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

contextBridge.exposeInMainWorld('audioAPI', audioAPI);
contextBridge.exposeInMainWorld('transcribeAPI', transcribeAPI);
contextBridge.exposeInMainWorld('clipboardAPI', clipboardAPI);
contextBridge.exposeInMainWorld('permissionsAPI', permissionsAPI);

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
    platform: {
      isMacOS: boolean;
      isWindows: boolean;
      isLinux: boolean;
    };
  }
}
