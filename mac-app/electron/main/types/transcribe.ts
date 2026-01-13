/**
 * IPC channels for transcription functionality.
 */
export const TranscribeIPCChannels = {
  // Renderer -> Main (invoke/handle pattern)
  GET_STATUS: 'transcribe:getStatus',
  GET_MODEL_STATUS: 'transcribe:getModelStatus',
  DOWNLOAD_MODEL: 'transcribe:downloadModel',
  DELETE_MODEL: 'transcribe:deleteModel',
  GET_AVAILABLE_MODELS: 'transcribe:getAvailableModels',
  GET_MODEL_DOWNLOAD_STATUS: 'transcribe:getModelDownloadStatus',
  GET_DOWNLOADING_MODELS: 'transcribe:getDownloadingModels',
  GET_SELECTED_MODEL: 'transcribe:getSelectedModel',
  SET_SELECTED_MODEL: 'transcribe:setSelectedModel',
  GET_HOTKEY: 'transcribe:getHotkey',
  SET_HOTKEY: 'transcribe:setHotkey',
  GET_SECONDARY_HOTKEY: 'transcribe:getSecondaryHotkey',
  SET_SECONDARY_HOTKEY: 'transcribe:setSecondaryHotkey',
  GET_OVERLAY_STYLE: 'transcribe:getOverlayStyle',
  SET_OVERLAY_STYLE: 'transcribe:setOverlayStyle',
  GET_ABANDON_HOTKEY: 'transcribe:getAbandonHotkey',
  SET_ABANDON_HOTKEY: 'transcribe:setAbandonHotkey',
  GET_ABANDON_CONFIRMATION: 'transcribe:getAbandonConfirmation',
  SET_ABANDON_CONFIRMATION: 'transcribe:setAbandonConfirmation',
  TOGGLE_RECORDING: 'transcribe:toggleRecording',
  GET_AUTO_IMPROVE: 'transcribe:getAutoImprove',
  SET_AUTO_IMPROVE: 'transcribe:setAutoImprove',

  // Sound settings
  GET_SOUND_CONFIG: 'transcribe:getSoundConfig',
  SET_SOUND_CONFIG: 'transcribe:setSoundConfig',
  GET_AVAILABLE_SOUNDS: 'transcribe:getAvailableSounds',
  PREVIEW_SOUND: 'transcribe:previewSound',
  PLAY_PASTE_SOUND: 'transcribe:playPasteSound',

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
 * Sound configuration for recording actions.
 */
export interface SoundConfig {
  enabled: boolean;
  recordingStart: string | undefined;
  recordingStop: string | undefined;
  recordingCancel: string | undefined;
  windowOpen: string | undefined;
  windowClose: string | undefined;
  paste: string | undefined;
  transcribing: string | undefined;
}

/**
 * Sound option for UI display.
 */
export interface SoundOption {
  id: string;
  name: string;
  category: string;
}

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
  deleteModel: (modelSize: string) => Promise<boolean>;
  getAvailableModels: () => Promise<Record<string, ModelInfo>>;
  getModelDownloadStatus: () => Promise<Record<string, boolean>>;
  getDownloadingModels: () => Promise<string[]>;
  getSelectedModel: () => Promise<string>;
  setSelectedModel: (modelSize: string) => Promise<void>;
  getHotkey: () => Promise<string>;
  setHotkey: (hotkey: string) => Promise<boolean>;
  getSecondaryHotkey: () => Promise<string | null>;
  setSecondaryHotkey: (hotkey: string | null) => Promise<boolean>;
  getOverlayStyle: () => Promise<'rectangle' | 'top-emerging'>;
  setOverlayStyle: (style: 'rectangle' | 'top-emerging') => Promise<void>;
  getAbandonHotkey: () => Promise<string>;
  setAbandonHotkey: (hotkey: string) => Promise<boolean>;
  getAbandonConfirmation: () => Promise<boolean>;
  setAbandonConfirmation: (enabled: boolean) => Promise<void>;
  toggleRecording: () => Promise<void>;
  getAutoImprove: () => Promise<boolean>;
  setAutoImprove: (enabled: boolean) => Promise<void>;
  getSoundConfig: () => Promise<SoundConfig>;
  setSoundConfig: (config: Partial<SoundConfig>) => Promise<void>;
  getAvailableSounds: () => Promise<SoundOption[]>;
  previewSound: (soundId: string) => Promise<void>;
  onStatusChanged: (callback: (status: TranscriptionStatus) => void) => () => void;
  onResult: (callback: (text: string) => void) => () => void;
  onError: (callback: (error: string) => void) => () => void;
  onModelDownloadProgress: (callback: (downloaded: number, total: number) => void) => () => void;
  onHotkeyChanged: (callback: (hotkey: string) => void) => () => void;
}

