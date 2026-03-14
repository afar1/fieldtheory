/**
 * Transcription engine identifiers. Defined once, used everywhere.
 * 'whisper': whisper.cpp (local binary, CPU/Metal)
 * 'qwen': Qwen3-ASR-0.6B via mlx-audio (Apple Silicon)
 * 'mlx-whisper': Whisper large-v3-turbo via mlx-whisper (Apple Silicon)
 * 'parakeet': NVIDIA Parakeet TDT 0.6B v2 (English) via onnx-asr (CPU/ONNX Runtime)
 * 'parakeet-multilingual': NVIDIA Parakeet TDT 0.6B v3 (multilingual) via onnx-asr (CPU/ONNX Runtime)
 */
export type TranscriptionEngine =
  | 'whisper'
  | 'qwen'
  | 'mlx-whisper'
  | 'parakeet'
  | 'parakeet-multilingual';
export type HotMicEngine = 'default' | TranscriptionEngine;
export type ParakeetEngine = Extract<TranscriptionEngine, 'parakeet' | 'parakeet-multilingual'>;

export const PARAKEET_ENGINE_MODEL_IDS: Record<ParakeetEngine, string> = {
  parakeet: 'nemo-parakeet-tdt-0.6b-v2',
  'parakeet-multilingual': 'nemo-parakeet-tdt-0.6b-v3',
};

export const PARAKEET_ENGINE_LABELS: Record<ParakeetEngine, string> = {
  parakeet: 'Parakeet English',
  'parakeet-multilingual': 'Parakeet Multilingual',
};

export function isParakeetEngine(
  engine: string | null | undefined
): engine is ParakeetEngine {
  return engine === 'parakeet' || engine === 'parakeet-multilingual';
}

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
  GET_AUTO_IMPROVE_MIN_WORDS: 'transcribe:getAutoImproveMinWords',
  SET_AUTO_IMPROVE_MIN_WORDS: 'transcribe:setAutoImproveMinWords',
  GET_AUTO_IMPROVE_STATS: 'transcribe:getAutoImproveStats',
  RESET_AUTO_IMPROVE_STATS: 'transcribe:resetAutoImproveStats',
  GET_TRANSCRIPTION_ENGINE: 'transcribe:getTranscriptionEngine',
  SET_TRANSCRIPTION_ENGINE: 'transcribe:setTranscriptionEngine',

  // Sound settings
  GET_SOUND_CONFIG: 'transcribe:getSoundConfig',
  SET_SOUND_CONFIG: 'transcribe:setSoundConfig',
  GET_AVAILABLE_SOUNDS: 'transcribe:getAvailableSounds',
  PREVIEW_SOUND: 'transcribe:previewSound',
  PLAY_PASTE_SOUND: 'transcribe:playPasteSound',

  // Engine installation and setup
  IS_QWEN_INSTALLED: 'transcribe:isQwenInstalled',
  IS_MLX_WHISPER_INSTALLED: 'transcribe:isMlxWhisperInstalled',
  IS_PARAKEET_INSTALLED: 'transcribe:isParakeetInstalled',
  IS_APPLE_SILICON: 'transcribe:isAppleSilicon',
  SETUP_QWEN: 'transcribe:setupQwen',
  SETUP_MLX_WHISPER: 'transcribe:setupMlxWhisper',
  SETUP_PARAKEET: 'transcribe:setupParakeet',
  UNINSTALL_PARAKEET: 'transcribe:uninstallParakeet',

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
 * Auto-improve usage statistics.
 */
export interface AutoImproveStats {
  wordsImproved: number;
  apiCalls: number;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Sound configuration for recording actions.
 */
export interface SoundConfig {
  enabled: boolean;
  librarianEnabled: boolean;
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
  getAutoImproveMinWords: () => Promise<number>;
  setAutoImproveMinWords: (minWords: number) => Promise<void>;
  getAutoImproveStats: () => Promise<AutoImproveStats>;
  resetAutoImproveStats: () => Promise<void>;
  getTranscriptionEngine: () => Promise<'whisper' | 'qwen' | 'mlx-whisper' | 'parakeet' | 'parakeet-multilingual'>;
  setTranscriptionEngine: (engine: 'whisper' | 'qwen' | 'mlx-whisper' | 'parakeet' | 'parakeet-multilingual') => Promise<void>;
  isQwenInstalled: () => Promise<boolean>;
  isMlxWhisperInstalled: () => Promise<boolean>;
  isParakeetInstalled: () => Promise<boolean>;
  isAppleSilicon: () => Promise<boolean>;
  setupQwen: () => Promise<{ success: boolean; error?: string }>;
  setupMlxWhisper: () => Promise<{ success: boolean; error?: string }>;
  setupParakeet: () => Promise<{ success: boolean; error?: string }>;
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
