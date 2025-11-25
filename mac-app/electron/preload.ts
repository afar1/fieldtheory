import { contextBridge, ipcRenderer } from 'electron';
import {
  AudioState,
  AudioIPCChannels,
  SetPriorityModePayload,
  SetPriorityDevicePayload,
} from './main/types/audio';

export interface AudioAPI {
  getState: () => Promise<AudioState>;
  setPriorityMode: (enabled: boolean) => Promise<void>;
  setPriorityDevice: (deviceId: string | null) => Promise<void>;
  resetOverride: () => Promise<void>;
  onStateChanged: (callback: (state: AudioState) => void) => () => void;
}

const audioAPI: AudioAPI = {
  getState: async (): Promise<AudioState> => {
    return ipcRenderer.invoke(AudioIPCChannels.GET_STATE);
  },

  setPriorityMode: async (enabled: boolean): Promise<void> => {
    const payload: SetPriorityModePayload = { enabled };
    return ipcRenderer.invoke(AudioIPCChannels.SET_PRIORITY_MODE, payload);
  },

  setPriorityDevice: async (deviceId: string | null): Promise<void> => {
    const payload: SetPriorityDevicePayload = { deviceId };
    return ipcRenderer.invoke(AudioIPCChannels.SET_PRIORITY_DEVICE, payload);
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

contextBridge.exposeInMainWorld('audioAPI', audioAPI);

contextBridge.exposeInMainWorld('platform', {
  isMacOS: process.platform === 'darwin',
  isWindows: process.platform === 'win32',
  isLinux: process.platform === 'linux',
});

declare global {
  interface Window {
    audioAPI: AudioAPI;
    platform: {
      isMacOS: boolean;
      isWindows: boolean;
      isLinux: boolean;
    };
  }
}
