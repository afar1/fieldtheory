import { contextBridge, ipcRenderer } from 'electron';

/**
 * Preload script for the cursor status indicator overlay.
 * Exposes IPC methods for state, idle, and data updates.
 */
contextBridge.exposeInMainWorld('cursorStatusAPI', {
  // State changes: idle, recording, transcribing, done, confirmation, paste-failed
  onStateChange: (callback: (state: 'idle' | 'recording' | 'transcribing' | 'done' | 'confirmation' | 'paste-failed') => void) => {
    ipcRenderer.on('cursor-status-state', (_event, state) => callback(state));
  },
  
  // Idle state changes (whether cursor is still)
  onIdleChange: (callback: (isIdle: boolean) => void) => {
    ipcRenderer.on('cursor-status-idle', (_event, isIdle) => callback(isIdle));
  },
  
  // Data changes (e.g., transcription text for paste-failed state)
  onDataChange: (callback: (data: { transcription?: string }) => void) => {
    ipcRenderer.on('cursor-status-data', (_event, data) => callback(data));
  },
  
  // Send confirmation response (true = abandon, false = continue)
  sendConfirmationResponse: (abandon: boolean) => {
    ipcRenderer.send('cursor-status-confirmation-response', abandon);
  },
  
  removeAllListeners: (channel: string) => {
    ipcRenderer.removeAllListeners(channel);
  },
});
