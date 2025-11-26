/**
 * IPC channels for transcription functionality.
 */
export const TranscribeIPCChannels = {
  // Renderer -> Main (invoke/handle pattern)
  GET_STATUS: 'transcribe:getStatus',
  GET_MODEL_STATUS: 'transcribe:getModelStatus',
  DOWNLOAD_MODEL: 'transcribe:downloadModel',
  GET_HOTKEY: 'transcribe:getHotkey',
  SET_HOTKEY: 'transcribe:setHotkey',

  // Main -> Renderer (send pattern)
  STATUS_CHANGED: 'transcribe:statusChanged',
  RESULT: 'transcribe:result',
  ERROR: 'transcribe:error',
  MODEL_DOWNLOAD_PROGRESS: 'transcribe:modelDownloadProgress',
  HOTKEY_CHANGED: 'transcribe:hotkeyChanged',
} as const;

/**
 * Transcription status.
 */
export type TranscriptionStatus = 'idle' | 'recording' | 'transcribing';

/**
 * Model download status.
 */
export type ModelStatus = 'downloaded' | 'downloading' | 'missing';

/**
 * Transcription API exposed to renderer.
 */
export interface TranscribeAPI {
  getStatus: () => Promise<TranscriptionStatus>;
  getModelStatus: () => Promise<ModelStatus>;
  downloadModel: () => Promise<void>;
  getHotkey: () => Promise<string>;
  setHotkey: (hotkey: string) => Promise<boolean>;
  onStatusChanged: (callback: (status: TranscriptionStatus) => void) => () => void;
  onResult: (callback: (text: string) => void) => () => void;
  onError: (callback: (error: string) => void) => () => void;
  onModelDownloadProgress: (callback: (downloaded: number, total: number) => void) => () => void;
  onHotkeyChanged: (callback: (hotkey: string) => void) => () => void;
}

