import { contextBridge, ipcRenderer } from 'electron';

// =============================================================================
// Preload for the Dynamic Island overlay window.
// Exposes IPC channels for transcript streaming, history, and state management.
// =============================================================================

contextBridge.exposeInMainWorld('dynamicIslandAPI', {
  // Recording/transcription state changes.
  onStateChange: (callback: (state: string) => void) => {
    ipcRenderer.on('dynamic-island-state', (_event, state) => callback(state));
  },

  // Streaming transcript text as it becomes available.
  onTranscriptUpdate: (callback: (data: { text: string; isFinal: boolean }) => void) => {
    ipcRenderer.on('dynamic-island-transcript', (_event, data) => callback(data));
  },

  // Command words/phrases detected in the transcript.
  onCommandDetected: (callback: (data: { phrase: string; startIndex: number; endIndex: number }) => void) => {
    ipcRenderer.on('dynamic-island-command', (_event, data) => callback(data));
  },

  // Transcript history (last N transcripts).
  onHistoryUpdate: (callback: (history: Array<{ id: number; text: string; createdAt: number; wordCount: number }>) => void) => {
    ipcRenderer.on('dynamic-island-history', (_event, history) => callback(history));
  },

  // Request transcript history from main process.
  requestHistory: () => {
    ipcRenderer.send('dynamic-island-request-history');
  },

  // Copy a transcript to clipboard and paste into last focused field.
  copyAndPaste: (text: string) => {
    ipcRenderer.send('dynamic-island-copy-paste', text);
  },

  // Copy text to clipboard only (no paste).
  copyToClipboard: (text: string) => {
    ipcRenderer.send('dynamic-island-copy', text);
  },

  // Toggle history panel visibility.
  toggleHistory: () => {
    ipcRenderer.send('dynamic-island-toggle-history');
  },

  // Tell main process to resize window for history panel.
  setHistoryVisible: (visible: boolean) => {
    ipcRenderer.send('dynamic-island-history-visible', visible);
  },

  // Listen for forced history hide (e.g., when window loses focus).
  onHideHistory: (callback: () => void) => {
    ipcRenderer.on('dynamic-island-hide-history', () => callback());
  },

  removeAllListeners: (channel: string) => {
    ipcRenderer.removeAllListeners(channel);
  },
});
