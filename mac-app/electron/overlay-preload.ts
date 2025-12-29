import { contextBridge, ipcRenderer } from 'electron';

/**
 * Preload script for the recording overlay window.
 * Exposes IPC methods to the overlay React component.
 */
contextBridge.exposeInMainWorld('overlayAPI', {
  // State changes: recording, transcribing, dismiss, confirmation, or status.
  onStateChange: (callback: (state: 'recording' | 'transcribing' | 'dismiss' | 'confirmation' | 'status') => void) => {
    ipcRenderer.on('overlay-state', (_event, state) => callback(state));
  },
  
  // Audio level updates during recording
  onAudioLevel: (callback: (level: number) => void) => {
    ipcRenderer.on('audio-level', (_event, level) => callback(level));
  },
  
  // Overlay style changes (rectangle vs top-emerging)
  onStyleChange: (callback: (style: 'rectangle' | 'top-emerging') => void) => {
    ipcRenderer.on('overlay-style', (_event, style) => callback(style));
  },
  
  // Status message for brief feedback (e.g., "No audio found", "Cancelled")
  onStatusMessage: (callback: (message: string) => void) => {
    ipcRenderer.on('overlay-status-message', (_event, message) => callback(message));
  },
  
  // Send confirmation response (user confirmed abandoning recording).
  confirmAbandon: () => {
    ipcRenderer.send('overlay-abandon-confirmed');
  },
  
  // Send cancellation response (user cancelled the abandon confirmation).
  cancelAbandon: () => {
    ipcRenderer.send('overlay-abandon-cancelled');
  },
  
  removeAllListeners: (channel: string) => {
    ipcRenderer.removeAllListeners(channel);
  },
});
