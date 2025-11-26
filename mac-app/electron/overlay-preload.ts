import { contextBridge, ipcRenderer } from 'electron';

/**
 * Preload script for the recording overlay window.
 * Exposes IPC methods to the overlay React component.
 */
contextBridge.exposeInMainWorld('overlayAPI', {
  onStateChange: (callback: (state: 'recording' | 'transcribing' | 'dismiss') => void) => {
    ipcRenderer.on('overlay-state', (_event, state) => callback(state));
  },
  onAudioLevel: (callback: (level: number) => void) => {
    ipcRenderer.on('audio-level', (_event, level) => callback(level));
  },
  removeAllListeners: (channel: string) => {
    ipcRenderer.removeAllListeners(channel);
  },
});

