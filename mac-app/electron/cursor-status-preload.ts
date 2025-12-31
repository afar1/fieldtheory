import { contextBridge, ipcRenderer } from 'electron';

/**
 * Preload script for the cursor status indicator overlay.
 * Exposes IPC methods for state and idle updates.
 */
contextBridge.exposeInMainWorld('cursorStatusAPI', {
  // State changes: idle, recording, transcribing, pasting
  onStateChange: (callback: (state: 'idle' | 'recording' | 'transcribing' | 'pasting') => void) => {
    ipcRenderer.on('cursor-status-state', (_event, state) => callback(state));
  },
  
  // Idle state changes (whether cursor is still)
  onIdleChange: (callback: (isIdle: boolean) => void) => {
    ipcRenderer.on('cursor-status-idle', (_event, isIdle) => callback(isIdle));
  },
  
  removeAllListeners: (channel: string) => {
    ipcRenderer.removeAllListeners(channel);
  },
});
