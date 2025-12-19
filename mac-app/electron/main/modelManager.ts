import { app } from 'electron';
import fs from 'fs/promises';
import { createWriteStream } from 'fs';
import path from 'path';
import https from 'https';

/**
 * Available Whisper model sizes.
 * Larger models provide better accuracy but require more disk space and processing time.
 */
export type ModelSize = 'base' | 'small' | 'medium' | 'large';

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
  base: {
    name: 'ggml-base.en.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin',
    sizeBytes: 142 * 1024 * 1024, // ~142MB
    description: 'Base (142MB) - Fast, good accuracy',
  },
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
  large: {
    name: 'ggml-large-v3.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin',
    sizeBytes: 2900 * 1024 * 1024, // ~2.9GB
    description: 'Large (2.9GB) - Best accuracy (multilingual)',
  },
};

/**
 * Manages Whisper model downloads and storage.
 * Models are stored in ~/Library/Application Support/field-theory/models/
 */
export class ModelManager {
  private modelsDir: string;
  private selectedModel: ModelSize = 'base';

  constructor(selectedModel?: ModelSize) {
    const appDataPath = app.getPath('userData');
    this.modelsDir = path.join(appDataPath, 'models');
    if (selectedModel) {
      this.selectedModel = selectedModel;
    }
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
   * Get download status for all models.
   * Returns a record mapping model sizes to whether they are downloaded.
   */
  async getDownloadStatus(): Promise<Record<ModelSize, boolean>> {
    const status: Record<ModelSize, boolean> = {} as Record<ModelSize, boolean>;
    const modelSizes: ModelSize[] = ['base', 'small', 'medium', 'large'];
    
    await Promise.all(
      modelSizes.map(async (size) => {
        status[size] = await this.isModelAvailableForSize(size);
      })
    );
    
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
    console.log(`[ModelManager] Checking model availability for ${size} at: ${modelPath}`);
    
    try {
      const stats = await fs.stat(modelPath);
      const modelInfo = MODELS[size];
      
      // Check if file size is within reasonable range (80% to 120% of expected)
      const expectedSize = modelInfo.sizeBytes;
      const minSize = expectedSize * 0.8;
      const maxSize = expectedSize * 1.2;
      
      console.log(`[ModelManager] Model ${size} found, size: ${(stats.size / 1024 / 1024).toFixed(2)}MB (expected ~${(expectedSize / 1024 / 1024).toFixed(0)}MB)`);
      
      if (stats.size < minSize || stats.size > maxSize) {
        console.warn(`[ModelManager] Model ${size} size suspicious - outside 80-120% range`);
        return false;
      }
      
      return true;
    } catch (err) {
      console.log(`[ModelManager] Model ${size} not found at ${modelPath}:`, err instanceof Error ? err.message : err);
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
    
    // Download with redirect handling
    await this.downloadWithRedirects(modelInfo.url, modelPath, onProgress);
    
    // Verify download
    if (await this.isModelAvailableForSize(size)) {
      console.log(`[ModelManager] Model ${size} downloaded successfully`);
    } else {
      throw new Error(`Downloaded file validation failed for ${size} model`);
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

