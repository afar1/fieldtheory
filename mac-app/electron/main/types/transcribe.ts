/**
 * IPC channels for transcription functionality.
 */
export const TranscribeIPCChannels = {
  // Renderer -> Main (invoke/handle pattern)
  GET_STATUS: 'transcribe:getStatus',
  GET_MODEL_STATUS: 'transcribe:getModelStatus',
  DOWNLOAD_MODEL: 'transcribe:downloadModel',
  GET_AVAILABLE_MODELS: 'transcribe:getAvailableModels',
  GET_MODEL_DOWNLOAD_STATUS: 'transcribe:getModelDownloadStatus',
  GET_SELECTED_MODEL: 'transcribe:getSelectedModel',
  SET_SELECTED_MODEL: 'transcribe:setSelectedModel',
  GET_HOTKEY: 'transcribe:getHotkey',
  SET_HOTKEY: 'transcribe:setHotkey',
  GET_OVERLAY_STYLE: 'transcribe:getOverlayStyle',
  SET_OVERLAY_STYLE: 'transcribe:setOverlayStyle',

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
 * Model information structure.
 */
export interface ModelInfo {
  name: string;
  url: string;
  sizeBytes: number;
  description: string;
}

/**
 * Transcription API exposed to renderer.
 */
export interface TranscribeAPI {
  getStatus: () => Promise<TranscriptionStatus>;
  getModelStatus: () => Promise<ModelStatus>;
  downloadModel: (modelSize?: string) => Promise<void>;
  getAvailableModels: () => Promise<Record<string, ModelInfo>>;
  getModelDownloadStatus: () => Promise<Record<string, boolean>>;
  getSelectedModel: () => Promise<string>;
  setSelectedModel: (modelSize: string) => Promise<void>;
  getHotkey: () => Promise<string>;
  setHotkey: (hotkey: string) => Promise<boolean>;
  getOverlayStyle: () => Promise<'rectangle' | 'top-emerging'>;
  setOverlayStyle: (style: 'rectangle' | 'top-emerging') => Promise<void>;
  onStatusChanged: (callback: (status: TranscriptionStatus) => void) => () => void;
  onResult: (callback: (text: string) => void) => () => void;
  onError: (callback: (error: string) => void) => () => void;
  onModelDownloadProgress: (callback: (downloaded: number, total: number) => void) => () => void;
  onHotkeyChanged: (callback: (hotkey: string) => void) => () => void;
}

