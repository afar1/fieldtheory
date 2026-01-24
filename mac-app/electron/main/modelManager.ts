import { app } from 'electron';
import fs from 'fs/promises';
import { createWriteStream } from 'fs';
import path from 'path';
import https from 'https';

/**
 * Available Whisper model sizes.
 * Larger models provide better accuracy but require more disk space and processing time.
 */
export type ModelSize = 'small' | 'medium';

/**
 * Model metadata including name, URL, and expected size.
 */
interface ModelInfo {
  name: string;
  url: string;
  sizeBytes: number;
  description: string;
}

/**
 * Available models configuration.
 */
const MODELS: Record<ModelSize, ModelInfo> = {
  small: {
    name: 'ggml-small.en.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin',
    sizeBytes: 466 * 1024 * 1024, // ~466MB
    description: 'Small (466MB) - Better accuracy',
  },
  medium: {
    name: 'ggml-medium.en.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.en.bin',
    sizeBytes: 1420 * 1024 * 1024, // ~1.4GB
    description: 'Medium (1.4GB) - High accuracy',
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
    const modelSizes: ModelSize[] = ['small', 'medium'];

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
    const modelPath = this.getModelPathForSize(size);
    const modelInfo = MODELS[size];
    
    try {
      const stats = await fs.stat(modelPath);
      const fileSizeMB = stats.size / 1024 / 1024;
      
      // Minimum size sanity check - file should be at least 50% of expected size.
      // This catches incomplete downloads while being lenient with size variations.
      const minSize = modelInfo.sizeBytes * 0.5;
      
      if (stats.size < minSize) {
        console.warn(`[ModelManager] Model ${size} too small: ${fileSizeMB.toFixed(2)}MB (min ${(minSize / 1024 / 1024).toFixed(0)}MB)`);
        return false;
      }

      // Only log model found once per size
      if (!this.loggedModelStatus.has(size)) {
        console.log(`[ModelManager] Model ${size} found: ${fileSizeMB.toFixed(2)}MB at ${modelPath}`);
        this.loggedModelStatus.add(size);
      }
      return true;
    } catch (error: any) {
      // Only log model not found once per size
      if (!this.loggedModelStatus.has(size)) {
        if (error.code === 'ENOENT') {
          console.log(`[ModelManager] Model ${size} not found at: ${modelPath}`);
        } else {
          console.warn(`[ModelManager] Model ${size} check failed:`, error.message);
        }
        this.loggedModelStatus.add(size);
      }
      return false;
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
      console.log(`[ModelManager] Model ${size} download already in progress, skipping`);
      return;
    }

    const modelInfo = MODELS[size];
    const modelPath = this.getModelPathForSize(size);
    
    // Ensure models directory exists
    await fs.mkdir(this.modelsDir, { recursive: true });
    
    // Check if already downloaded
    if (await this.isModelAvailableForSize(size)) {
      console.log(`[ModelManager] Model ${size} already downloaded`);
      return;
    }

    console.log(`[ModelManager] Starting download of ${size} model...`);
    this.downloadingModels.add(size);
    
    try {
      // Download with redirect handling
      await this.downloadWithRedirects(modelInfo.url, modelPath, onProgress);
      
      // Verify download
      if (await this.isModelAvailableForSize(size)) {
        console.log(`[ModelManager] Model ${size} downloaded successfully`);
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
          console.log(`[ModelManager] Following redirect to: ${redirectUrl}`);
          
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
      console.log(`[ModelManager] Deleted model ${size}`);
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

