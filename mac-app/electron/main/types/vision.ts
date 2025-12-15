/**
 * IPC channels for vision model functionality.
 */
export const VisionIPCChannels = {
  // Renderer -> Main (invoke/handle pattern)
  GET_MODEL_STATUS: 'vision:getModelStatus',
  DOWNLOAD_MODEL: 'vision:downloadModel',
  DELETE_MODEL: 'vision:deleteModel',
  GET_AVAILABLE_MODELS: 'vision:getAvailableModels',
  GET_MODEL_DOWNLOAD_STATUS: 'vision:getModelDownloadStatus',
  GET_SELECTED_MODEL: 'vision:getSelectedModel',
  SET_SELECTED_MODEL: 'vision:setSelectedModel',

  // Main -> Renderer (send pattern)
  MODEL_DOWNLOAD_PROGRESS: 'vision:modelDownloadProgress',
  DESCRIPTION_READY: 'vision:descriptionReady',
  ERROR: 'vision:error',
} as const;

/**
 * Vision model download status.
 */
export type VisionModelStatus = 'downloaded' | 'downloading' | 'missing';

/**
 * Vision model information structure.
 */
export interface VisionModelInfo {
  name: string;
  repo: string;
  sizeBytes: number;
  description: string;
}

/**
 * Vision API exposed to renderer.
 */
export interface VisionAPI {
  getModelStatus: () => Promise<VisionModelStatus>;
  downloadModel: (modelSize?: string) => Promise<void>;
  deleteModel: (modelSize: string) => Promise<boolean>;
  getAvailableModels: () => Promise<Record<string, VisionModelInfo>>;
  getModelDownloadStatus: () => Promise<Record<string, boolean>>;
  getSelectedModel: () => Promise<string>;
  setSelectedModel: (modelSize: string) => Promise<void>;
  onModelDownloadProgress: (callback: (downloaded: number, total: number) => void) => () => void;
  onDescriptionReady: (callback: (itemId: number, description: string) => void) => () => void;
  onError: (callback: (itemId: number, error: string) => void) => () => void;
}












