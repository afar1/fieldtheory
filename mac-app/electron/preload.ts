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
  GET_HOTKEY: 'transcribe:getHotkey',
  SET_HOTKEY: 'transcribe:setHotkey',
  STATUS_CHANGED: 'transcribe:statusChanged',
  RESULT: 'transcribe:result',
  ERROR: 'transcribe:error',
  MODEL_DOWNLOAD_PROGRESS: 'transcribe:modelDownloadProgress',
  HOTKEY_CHANGED: 'transcribe:hotkeyChanged',
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
  downloadModel: () => Promise<void>;
  getHotkey: () => Promise<string>;
  setHotkey: (hotkey: string) => Promise<boolean>;
  onStatusChanged: (callback: (status: TranscriptionStatus) => void) => () => void;
  onResult: (callback: (text: string) => void) => () => void;
  onError: (callback: (error: string) => void) => () => void;
  onModelDownloadProgress: (callback: (downloaded: number, total: number) => void) => () => void;
  onHotkeyChanged: (callback: (hotkey: string) => void) => () => void;
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

  downloadModel: async (): Promise<void> => {
    return ipcRenderer.invoke(TranscribeIPCChannels.DOWNLOAD_MODEL);
  },

  getHotkey: async (): Promise<string> => {
    return ipcRenderer.invoke(TranscribeIPCChannels.GET_HOTKEY);
  },

  setHotkey: async (hotkey: string): Promise<boolean> => {
    return ipcRenderer.invoke(TranscribeIPCChannels.SET_HOTKEY, hotkey);
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
};

contextBridge.exposeInMainWorld('audioAPI', audioAPI);
contextBridge.exposeInMainWorld('transcribeAPI', transcribeAPI);

contextBridge.exposeInMainWorld('platform', {
  isMacOS: process.platform === 'darwin',
  isWindows: process.platform === 'win32',
  isLinux: process.platform === 'linux',
});

declare global {
  interface Window {
    audioAPI: AudioAPI;
    transcribeAPI: TranscribeAPI;
    platform: {
      isMacOS: boolean;
      isWindows: boolean;
      isLinux: boolean;
    };
  }
}
