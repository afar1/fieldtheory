import { app } from 'electron';
import fs from 'fs/promises';
import { createWriteStream, existsSync, statSync } from 'fs';
import path from 'path';
import https from 'https';
import { createLogger } from './logger';

const log = createLogger('Model');

/**
 * Available Whisper model sizes.
 * The small English model provides fast, reliable transcription.
 */
export type ModelSize = 'small';

/**
 * Model metadata including name, URL, and expected size.
 */
interface ModelInfo {
  name: string;
  url: string;
  sizeBytes: number;
  description: string;
}

export type ModelHealthStatus = 'ready' | 'missing' | 'corrupt';

export interface ModelHealth {
  status: ModelHealthStatus;
  modelPath: string;
  fileSizeBytes: number | null;
  expectedSizeBytes: number;
  minValidSizeBytes: number;
}

/**
 * Available models configuration.
 */
const MODELS: Record<ModelSize, ModelInfo> = {
  small: {
    name: 'ggml-small.en.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin',
    sizeBytes: 466 * 1024 * 1024, // ~466MB
    description: 'English transcription model',
  },
};

/**
 * Manages Whisper model downloads and storage.
 * Models are stored in ~/Library/Application Support/Field Theory/models/
 */
export class ModelManager {
  private modelsDir: string;
  private selectedModel: ModelSize = 'small';
  private downloadingModels: Set<ModelSize> = new Set();
  private statusCache: { status: Record<ModelSize, boolean>; timestamp: number } | null = null;
  private static STATUS_CACHE_TTL = 5000; // 5 second cache
  private loggedModelStatus: Set<ModelSize> = new Set(); // Only log model status once

  constructor(selectedModel?: ModelSize) {
    const appDataPath = app.getPath('userData');
    this.modelsDir = path.join(appDataPath, 'models');
    if (selectedModel) {
      this.selectedModel = selectedModel;
    }
  }

  /**
   * Get which models are currently being downloaded.
   */
  getDownloadingModels(): ModelSize[] {
    return Array.from(this.downloadingModels);
  }

  /**
   * Check if a specific model is currently being downloaded.
   */
  isDownloading(size: ModelSize): boolean {
    return this.downloadingModels.has(size);
  }

  /**
   * Get the currently selected model size.
   */
  getSelectedModel(): ModelSize {
    return this.selectedModel;
  }

  /**
   * Set the selected model size.
   */
  setSelectedModel(size: ModelSize): void {
    this.selectedModel = size;
  }

  /**
   * Get information about all available models.
   */
  getAvailableModels(): Record<ModelSize, ModelInfo> {
    return MODELS;
  }

  /**
   * Invalidate the status cache. Called after downloads/deletes.
   */
  invalidateCache(): void {
    this.statusCache = null;
    this.loggedModelStatus.clear();  // Re-log status after changes
  }

  /**
   * Get download status for all models.
   * Returns a record mapping model sizes to whether they are downloaded.
   * Results are cached for 5 seconds to avoid repeated filesystem checks.
   */
  async getDownloadStatus(): Promise<Record<ModelSize, boolean>> {
    // Return cached status if valid
    if (this.statusCache && Date.now() - this.statusCache.timestamp < ModelManager.STATUS_CACHE_TTL) {
      return this.statusCache.status;
    }

    const status: Record<ModelSize, boolean> = {} as Record<ModelSize, boolean>;
    const modelSizes: ModelSize[] = ['small'];

    await Promise.all(
      modelSizes.map(async (size) => {
        status[size] = await this.isModelAvailableForSize(size);
      })
    );

    // Cache the result
    this.statusCache = { status, timestamp: Date.now() };

    return status;
  }

  /**
   * Get information about a specific model size.
   */
  getModelInfo(size: ModelSize): ModelInfo {
    return MODELS[size];
  }

  /**
   * Get the path to the currently selected model file.
   */
  getModelPath(): string {
    const modelInfo = MODELS[this.selectedModel];
    return path.join(this.modelsDir, modelInfo.name);
  }

  /**
   * Get the path to a specific model file.
   */
  getModelPathForSize(size: ModelSize): string {
    const modelInfo = MODELS[size];
    return path.join(this.modelsDir, modelInfo.name);
  }

  /**
   * Check if the currently selected model is downloaded and valid.
   */
  async isModelAvailable(): Promise<boolean> {
    return this.isModelAvailableForSize(this.selectedModel);
  }

  /**
   * Check if a specific model size is downloaded and valid.
   */
  async isModelAvailableForSize(size: ModelSize): Promise<boolean> {
    const health = this.getModelHealthForSizeSync(size);
    this.loggedModelStatus.add(size);
    return health.status === 'ready';
  }

  getModelHealthForSizeSync(size: ModelSize): ModelHealth {
    const modelPath = this.getModelPathForSize(size);
    const modelInfo = MODELS[size];
    const minValidSizeBytes = Math.floor(modelInfo.sizeBytes * 0.5);

    if (!existsSync(modelPath)) {
      return {
        status: 'missing',
        modelPath,
        fileSizeBytes: null,
        expectedSizeBytes: modelInfo.sizeBytes,
        minValidSizeBytes,
      };
    }

    try {
      const stats = statSync(modelPath);
      if (stats.size < minValidSizeBytes) {
        return {
          status: 'corrupt',
          modelPath,
          fileSizeBytes: stats.size,
          expectedSizeBytes: modelInfo.sizeBytes,
          minValidSizeBytes,
        };
      }
      return {
        status: 'ready',
        modelPath,
        fileSizeBytes: stats.size,
        expectedSizeBytes: modelInfo.sizeBytes,
        minValidSizeBytes,
      };
    } catch {
      return {
        status: 'missing',
        modelPath,
        fileSizeBytes: null,
        expectedSizeBytes: modelInfo.sizeBytes,
        minValidSizeBytes,
      };
    }
  }

  /**
   * Download the currently selected model with progress tracking.
   * Returns a promise that resolves when download completes.
   * Handles redirects automatically.
   */
  async downloadModel(
    onProgress?: (bytesDownloaded: number, totalBytes: number) => void
  ): Promise<void> {
    return this.downloadModelForSize(this.selectedModel, onProgress);
  }

  /**
   * Download a specific model size with progress tracking.
   * Returns a promise that resolves when download completes.
   * Handles redirects automatically.
   */
  async downloadModelForSize(
    size: ModelSize,
    onProgress?: (bytesDownloaded: number, totalBytes: number) => void
  ): Promise<void> {
    // Prevent duplicate downloads of the same model.
    if (this.downloadingModels.has(size)) {
      return;
    }

    const modelInfo = MODELS[size];
    const modelPath = this.getModelPathForSize(size);
    
    // Ensure models directory exists
    await fs.mkdir(this.modelsDir, { recursive: true });
    
    // Check if already downloaded
    if (await this.isModelAvailableForSize(size)) {
      return;
    }

    this.downloadingModels.add(size);
    
    try {
      // Download with redirect handling
      await this.downloadWithRedirects(modelInfo.url, modelPath, onProgress);

      // Verify download
      if (await this.isModelAvailableForSize(size)) {
        this.invalidateCache();
      } else {
        throw new Error(`Downloaded file validation failed for ${size} model`);
      }
    } finally {
      this.downloadingModels.delete(size);
    }
  }

  /**
   * Download a file following redirects.
   */
  private async downloadWithRedirects(
    url: string,
    filePath: string,
    onProgress?: (bytesDownloaded: number, totalBytes: number) => void,
    maxRedirects: number = 10
  ): Promise<void> {
    if (maxRedirects <= 0) {
      throw new Error('Too many redirects');
    }

    return new Promise((resolve, reject) => {
      https.get(url, (response) => {
        // Handle redirects (301, 302, 303, 307, 308)
        const statusCode = response.statusCode || 0;
        if (statusCode >= 300 && statusCode < 400 && response.headers.location) {
          const redirectUrl = response.headers.location;

          // Clean up current response
          response.destroy();
          
          // Follow redirect
          this.downloadWithRedirects(redirectUrl, filePath, onProgress, maxRedirects - 1)
            .then(resolve)
            .catch(reject);
          return;
        }

        // Handle successful response
        if (statusCode !== 200) {
          reject(new Error(`Download failed with status ${statusCode}`));
          return;
        }

        const totalBytes = parseInt(response.headers['content-length'] || '0', 10);
        let downloadedBytes = 0;

        const writeStream = createWriteStream(filePath);
        
        response.on('data', (chunk: Buffer) => {
          downloadedBytes += chunk.length;
          if (onProgress) {
            onProgress(downloadedBytes, totalBytes || downloadedBytes);
          }
        });

        response.on('end', () => {
          writeStream.end();
          resolve();
        });

        response.on('error', (error) => {
          writeStream.destroy();
          reject(error);
        });

        response.pipe(writeStream);
      }).on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Get download progress information for the currently selected model.
   */
  async getDownloadProgress(): Promise<{ downloaded: number; total: number } | null> {
    return this.getDownloadProgressForSize(this.selectedModel);
  }

  /**
   * Get download progress information for a specific model size.
   */
  async getDownloadProgressForSize(size: ModelSize): Promise<{ downloaded: number; total: number } | null> {
    try {
      const modelPath = this.getModelPathForSize(size);
      const stats = await fs.stat(modelPath);
      const modelInfo = MODELS[size];
      return {
        downloaded: stats.size,
        total: modelInfo.sizeBytes,
      };
    } catch {
      return null;
    }
  }

  /**
   * Delete a specific model file.
   * Returns true if the file was deleted, false if it didn't exist.
   */
  async deleteModelForSize(size: ModelSize): Promise<boolean> {
    try {
      const modelPath = this.getModelPathForSize(size);
      await fs.unlink(modelPath);
      this.invalidateCache();
      return true;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // File doesn't exist, that's fine
        return false;
      }
      throw error;
    }
  }
}
