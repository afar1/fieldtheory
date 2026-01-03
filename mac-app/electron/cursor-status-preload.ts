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
  onDataChange: (callback: (data: { transcription?: string; pasteFailed?: boolean }) => void) => {
    ipcRenderer.on('cursor-status-data', (_event, data) => callback(data));
  },
  
  // Stack count changes (for pipe indicator showing screenshots during recording).
  onStackChange: (callback: (count: number) => void) => {
    ipcRenderer.on('cursor-status-stack', (_event, count) => callback(count));
  },
  
  // Hide labels setting changes (show only colored dots without text).
  onHideLabelsChange: (callback: (hide: boolean) => void) => {
    ipcRenderer.on('cursor-status-hide-labels', (_event, hide) => callback(hide));
  },
  
  // Screenshot mode changes (shifts indicator right to avoid overlap).
  onScreenshotModeChange: (callback: (active: boolean) => void) => {
    ipcRenderer.on('cursor-status-screenshot-mode', (_event, active) => callback(active));
  },

  // Tutorial hint changes (onboarding prompts shown next to cursor dot).
  onTutorialHint: (callback: (hint: string | null) => void) => {
    ipcRenderer.on('cursor-status-tutorial-hint', (_event, hint) => callback(hint));
  },
  
  // Send confirmation response (true = abandon, false = continue)
  sendConfirmationResponse: (abandon: boolean) => {
    ipcRenderer.send('cursor-status-confirmation-response', abandon);
  },
  
  // Dismiss the indicator (click to dismiss for paste-failed/done states)
  dismiss: () => {
    ipcRenderer.send('cursor-status-dismiss');
  },
  
  removeAllListeners: (channel: string) => {
    ipcRenderer.removeAllListeners(channel);
  },
});
