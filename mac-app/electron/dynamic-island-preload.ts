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

  onShowHistory: (callback: () => void) => {
    ipcRenderer.on('dynamic-island-show-history', () => callback());
  },

  // Hot-mic status updates (right pill).
  onHotMicUpdate: (callback: (data: { active: boolean; wordCount: number; lastWord: string }) => void) => {
    ipcRenderer.on('dynamic-island-hotmic', (_event, data) => callback(data));
  },

  // Hot-mic warn-discard blink (right pill).
  onHotMicWarnDiscard: (callback: () => void) => {
    ipcRenderer.on('dynamic-island-hotmic-warn-discard', () => callback());
  },

  // Hot-mic slide out (right pill).
  onHotMicSlideOut: (callback: () => void) => {
    ipcRenderer.on('dynamic-island-hotmic-slide-out', () => callback());
  },

  // Hot-mic mute state change (right pill).
  onHotMicMute: (callback: (muted: boolean) => void) => {
    ipcRenderer.on('dynamic-island-hotmic-mute', (_event, muted) => callback(muted));
  },

  // Toggle hot-mic mute (right pill → main).
  toggleMute: () => {
    ipcRenderer.send('dynamic-island-toggle-mute');
  },

  // Open the main Field Theory clipboard/history window.
  openFieldTheory: () => {
    ipcRenderer.send('dynamic-island-open-field-theory');
  },

  // Drawer transcript updates (drawer pill).
  onDrawerTranscript: (callback: (text: string) => void) => {
    ipcRenderer.on('dynamic-island-drawer-transcript', (_event, text) => callback(text));
  },

  // Drawer live-speaking updates (for shimmer feedback).
  onDrawerSpeaking: (callback: (speaking: boolean) => void) => {
    ipcRenderer.on('dynamic-island-drawer-speaking', (_event, speaking) => callback(speaking));
  },

  removeAllListeners: (channel: string) => {
    ipcRenderer.removeAllListeners(channel);
  },
});
