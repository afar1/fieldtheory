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

  // Delete a transcript history item by id.
  deleteHistoryItem: (id: number) => {
    ipcRenderer.send('dynamic-island-delete-history-item', id);
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

  // Stack count updates (screenshots captured during standard recording).
  onStackChanged: (callback: (count: number) => void) => {
    ipcRenderer.on('dynamic-island-stack-changed', (_event, count) => callback(count));
  },

  // Input mode (standard vs hot mic) updates.
  onInputMode: (callback: (mode: 'hot-mic' | 'standard') => void) => {
    ipcRenderer.on('dynamic-island-input-mode', (_event, mode) => callback(mode));
  },

  // Hot-mic status updates (right pill).
  onHotMicUpdate: (callback: (data: { active: boolean; wordCount: number; lastWord: string; muted?: boolean }) => void) => {
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

  // Live background-filter meter updates for tuning UI in the history drawer.
  onHotMicFilterMeter: (callback: (data: {
    enabled: boolean;
    strength: number;
    rawLevel: number;
    acceptedLevel: number;
    threshold: number;
    speechRatio: number;
    chunkSuppressed: boolean;
  }) => void) => {
    ipcRenderer.on('dynamic-island-hotmic-filter-meter', (_event, data) => callback(data));
  },

  // Hot-mic runtime status updates (queue/latency/engine health).
  onHotMicRuntimeStatus: (callback: (status: {
    state: string;
    condition: string | null;
    engineReady: boolean;
    whisperFallbackActive: boolean;
    queueDepth: number;
    lastChunkAgeMs: number | null;
    chunksReceived: number;
    micHealthy: boolean;
    engine: {
      selectedEngine: 'whisper' | 'qwen' | 'mlx-whisper' | 'parakeet';
      readiness:
        | 'ready'
        | 'warming'
        | 'cold'
        | 'not-installed'
        | 'not-downloaded'
        | 'corrupt'
        | 'unsupported-arch'
        | 'disabled';
      detail: string | null;
    } | null;
    timing: {
      chunkIntervalMs: number | null;
      queueWaitMs: number | null;
      transcribeMs: number | null;
      postProcessMs: number | null;
      totalPipelineMs: number | null;
      avgTranscribeMs: number | null;
      avgTotalPipelineMs: number | null;
    };
  }) => void) => {
    ipcRenderer.on('dynamic-island-hotmic-runtime', (_event, status) => callback(status));
  },

  // Toggle hot-mic mute (right pill → main).
  toggleMute: () => {
    ipcRenderer.send('dynamic-island-toggle-mute');
  },

  // Dismiss current live transcript buffer (right pill → main).
  dismissTranscript: () => {
    ipcRenderer.send('dynamic-island-dismiss-transcript');
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

  // Drawer transcript text size updates.
  onDrawerTextSize: (callback: (size: number) => void) => {
    ipcRenderer.on('dynamic-island-drawer-text-size', (_event, size) => callback(size));
  },

  // Hot-mic background filter controls.
  getHotMicBackgroundFilterEnabled: () => ipcRenderer.invoke('hotmic:getBackgroundFilterEnabled'),
  setHotMicBackgroundFilterEnabled: (enabled: boolean) => ipcRenderer.invoke('hotmic:setBackgroundFilterEnabled', enabled),
  getHotMicBackgroundFilterStrength: () => ipcRenderer.invoke('hotmic:getBackgroundFilterStrength'),
  setHotMicBackgroundFilterStrength: (strength: number) => ipcRenderer.invoke('hotmic:setBackgroundFilterStrength', strength),
  getHotMicDrawerTextSize: () => ipcRenderer.invoke('hotmic:getDrawerTextSize'),
  getInputMode: () => ipcRenderer.invoke('hotmic:getInputMode'),
  setInputMode: (mode: 'hot-mic' | 'standard') => ipcRenderer.invoke('hotmic:setInputMode', mode),

  removeAllListeners: (channel: string) => {
    ipcRenderer.removeAllListeners(channel);
  },
});
