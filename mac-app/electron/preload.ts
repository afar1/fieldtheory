// =============================================================================
// Preload Script - Secure IPC bridge between Electron main and renderer.
// Exposes a type-safe API for audio state management via contextBridge.
// =============================================================================

import { contextBridge, ipcRenderer } from 'electron';
import {
  AudioState,
  AudioIPCChannels,
  SetPriorityModePayload,
  SetPriorityDevicePayload,
} from './main/types/audio';

/**
 * The audio API exposed to the renderer process.
 * All methods are async and use IPC to communicate with the main process.
 */
export interface AudioAPI {
  // Get the current audio state snapshot.
  getState: () => Promise<AudioState>;

  // Enable or disable priority mode ("Lock to Priority Device").
  setPriorityMode: (enabled: boolean) => Promise<void>;

  // Set which device should be prioritized.
  setPriorityDevice: (deviceId: string | null) => Promise<void>;

  // Clear user override and re-enable priority enforcement.
  resetOverride: () => Promise<void>;

  // Subscribe to state changes. Returns an unsubscribe function.
  onStateChanged: (callback: (state: AudioState) => void) => () => void;
}

// Create the audio API implementation.
const audioAPI: AudioAPI = {
  /**
   * Get the current audio state from the main process.
   */
  getState: async (): Promise<AudioState> => {
    return ipcRenderer.invoke(AudioIPCChannels.GET_STATE);
  },

  /**
   * Set whether priority mode is enabled.
   */
  setPriorityMode: async (enabled: boolean): Promise<void> => {
    const payload: SetPriorityModePayload = { enabled };
    return ipcRenderer.invoke(AudioIPCChannels.SET_PRIORITY_MODE, payload);
  },

  /**
   * Set which device should be prioritized.
   */
  setPriorityDevice: async (deviceId: string | null): Promise<void> => {
    const payload: SetPriorityDevicePayload = { deviceId };
    return ipcRenderer.invoke(AudioIPCChannels.SET_PRIORITY_DEVICE, payload);
  },

  /**
   * Reset any user override and re-enforce priority if enabled.
   */
  resetOverride: async (): Promise<void> => {
    return ipcRenderer.invoke(AudioIPCChannels.RESET_OVERRIDE);
  },

  /**
   * Subscribe to audio state changes.
   * The callback will be called whenever the audio state updates.
   * Returns an unsubscribe function.
   */
  onStateChanged: (callback: (state: AudioState) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: AudioState) => {
      callback(state);
    };

    ipcRenderer.on(AudioIPCChannels.STATE_CHANGED, handler);

    // Return unsubscribe function.
    return () => {
      ipcRenderer.removeListener(AudioIPCChannels.STATE_CHANGED, handler);
    };
  },
};

// Expose the API to the renderer process via contextBridge.
// This makes `window.audioAPI` available in the renderer.
contextBridge.exposeInMainWorld('audioAPI', audioAPI);

// Also expose a minimal platform info object.
contextBridge.exposeInMainWorld('platform', {
  isMacOS: process.platform === 'darwin',
  isWindows: process.platform === 'win32',
  isLinux: process.platform === 'linux',
});

// Type declaration for TypeScript support in the renderer.
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
