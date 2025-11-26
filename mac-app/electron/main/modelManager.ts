import { app } from 'electron';
import fs from 'fs/promises';
import { createWriteStream } from 'fs';
import path from 'path';
import https from 'https';

/**
 * Manages Whisper model downloads and storage.
 * Models are stored in ~/Library/Application Support/Little One/models/
 */
export class ModelManager {
  private modelsDir: string;
  private readonly MODEL_NAME = 'ggml-base.en.bin';
  private readonly MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin';
  private readonly EXPECTED_SIZE = 142 * 1024 * 1024; // ~142MB

  constructor() {
    const appDataPath = app.getPath('userData');
    this.modelsDir = path.join(appDataPath, 'models');
  }

  /**
   * Get the path to the model file.
   */
  getModelPath(): string {
    return path.join(this.modelsDir, this.MODEL_NAME);
  }

  /**
   * Check if the model is downloaded and valid.
   */
  async isModelAvailable(): Promise<boolean> {
    try {
      const modelPath = this.getModelPath();
      const stats = await fs.stat(modelPath);
      
      // Basic size check - should be approximately 142MB
      const sizeMB = stats.size / (1024 * 1024);
      if (sizeMB < 100 || sizeMB > 200) {
        console.warn(`[ModelManager] Model size suspicious: ${sizeMB.toFixed(2)}MB`);
        return false;
      }
      
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Download the model with progress tracking.
   * Returns a promise that resolves when download completes.
   * Handles redirects automatically.
   */
  async downloadModel(
    onProgress?: (bytesDownloaded: number, totalBytes: number) => void
  ): Promise<void> {
    const modelPath = this.getModelPath();
    
    // Ensure models directory exists
    await fs.mkdir(this.modelsDir, { recursive: true });
    
    // Check if already downloaded
    if (await this.isModelAvailable()) {
      console.log('[ModelManager] Model already downloaded');
      return;
    }

    console.log('[ModelManager] Starting model download...');
    
    // Download with redirect handling
    await this.downloadWithRedirects(this.MODEL_URL, modelPath, onProgress);
    
    // Verify download
    if (await this.isModelAvailable()) {
      console.log('[ModelManager] Model downloaded successfully');
    } else {
      throw new Error('Downloaded file validation failed');
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
   * Get download progress information.
   */
  async getDownloadProgress(): Promise<{ downloaded: number; total: number } | null> {
    try {
      const modelPath = this.getModelPath();
      const stats = await fs.stat(modelPath);
      return {
        downloaded: stats.size,
        total: this.EXPECTED_SIZE,
      };
    } catch {
      return null;
    }
  }
}

