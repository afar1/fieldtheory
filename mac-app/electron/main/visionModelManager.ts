import { app } from 'electron';
import fs from 'fs/promises';
import { createWriteStream } from 'fs';
import path from 'path';
import https from 'https';

/**
 * Available vision model sizes.
 * Starting with nanoLLaVA (smaller, faster).
 */
export type VisionModelSize = 'nano';

/**
 * Model metadata including name, URL, and expected size.
 * MLX models are stored as directories with multiple files.
 */
interface VisionModelInfo {
  name: string;
  repo: string; // Hugging Face repo name
  sizeBytes: number; // Approximate total size
  description: string;
}

/**
 * Available vision models configuration.
 * nanoLLaVA is ~1GB total when downloaded.
 */
const VISION_MODELS: Record<VisionModelSize, VisionModelInfo> = {
  nano: {
    name: 'nanoLLaVA',
    repo: 'mlx-community/nanoLLaVA',
    sizeBytes: 1000 * 1024 * 1024, // ~1GB
    description: 'nanoLLaVA (1GB) - Fast, good for brief descriptions',
  },
};

/**
 * Manages vision model downloads and storage.
 * Models are stored in ~/Library/Application Support/Oscar/models/vision/
 * MLX models are directories with multiple files (weights, tokenizer, config, etc.)
 */
export class VisionModelManager {
  private modelsDir: string;
  private selectedModel: VisionModelSize = 'nano';

  constructor(selectedModel?: VisionModelSize) {
    const appDataPath = app.getPath('userData');
    this.modelsDir = path.join(appDataPath, 'models', 'vision');
    if (selectedModel) {
      this.selectedModel = selectedModel;
    }
  }

  /**
   * Get the currently selected model size.
   */
  getSelectedModel(): VisionModelSize {
    return this.selectedModel;
  }

  /**
   * Set the selected model size.
   */
  setSelectedModel(size: VisionModelSize): void {
    this.selectedModel = size;
  }

  /**
   * Get information about all available models.
   */
  getAvailableModels(): Record<VisionModelSize, VisionModelInfo> {
    return VISION_MODELS;
  }

  /**
   * Get download status for all models.
   * Returns a record mapping model sizes to whether they are downloaded.
   */
  async getDownloadStatus(): Promise<Record<VisionModelSize, boolean>> {
    const status: Record<VisionModelSize, boolean> = {} as Record<VisionModelSize, boolean>;
    const modelSizes: VisionModelSize[] = ['nano'];
    
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
  getModelInfo(size: VisionModelSize): VisionModelInfo {
    return VISION_MODELS[size];
  }

  /**
   * Get the path to the currently selected model directory.
   */
  getModelPath(): string {
    const modelInfo = VISION_MODELS[this.selectedModel];
    return path.join(this.modelsDir, modelInfo.name);
  }

  /**
   * Get the path to a specific model directory.
   */
  getModelPathForSize(size: VisionModelSize): string {
    const modelInfo = VISION_MODELS[size];
    return path.join(this.modelsDir, modelInfo.name);
  }

  /**
   * Check if the currently selected model is downloaded and valid.
   * For MLX models, we check if the model directory exists and contains key files.
   */
  async isModelAvailable(): Promise<boolean> {
    return this.isModelAvailableForSize(this.selectedModel);
  }

  /**
   * Check if a specific model size is downloaded and valid.
   * MLX models need at least the model weights and tokenizer files.
   */
  async isModelAvailableForSize(size: VisionModelSize): Promise<boolean> {
    try {
      const modelPath = this.getModelPathForSize(size);
      
      // Check if directory exists
      const stats = await fs.stat(modelPath);
      if (!stats.isDirectory()) {
        return false;
      }

      // Check for key MLX model files
      // MLX models typically have: model.safetensors, tokenizer.json, config.json
      const requiredFiles = ['model.safetensors', 'tokenizer.json', 'config.json'];
      const files = await fs.readdir(modelPath);
      
      // Check if at least some key files exist
      const hasKeyFiles = requiredFiles.some(file => files.includes(file));
      if (!hasKeyFiles) {
        console.warn(`[VisionModelManager] Model ${size} directory exists but missing key files`);
        return false;
      }

      // Check directory size is reasonable (at least 50% of expected)
      const dirSize = await this.getDirectorySize(modelPath);
      const expectedSize = VISION_MODELS[size].sizeBytes;
      const minSize = expectedSize * 0.5;
      
      if (dirSize < minSize) {
        console.warn(`[VisionModelManager] Model ${size} size suspicious: ${(dirSize / 1024 / 1024).toFixed(2)}MB (expected ~${(expectedSize / 1024 / 1024).toFixed(0)}MB)`);
        return false;
      }
      
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Calculate total size of a directory recursively.
   */
  private async getDirectorySize(dirPath: string): Promise<number> {
    let totalSize = 0;
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          totalSize += await this.getDirectorySize(fullPath);
        } else {
          const stats = await fs.stat(fullPath);
          totalSize += stats.size;
        }
      }
    } catch (error) {
      console.error(`[VisionModelManager] Error calculating directory size: ${error}`);
    }
    return totalSize;
  }

  /**
   * Download the currently selected model with progress tracking.
   * MLX models are downloaded from Hugging Face using huggingface-cli or direct file downloads.
   * For now, we'll use a Python script to download via huggingface-hub.
   */
  async downloadModel(
    onProgress?: (bytesDownloaded: number, totalBytes: number) => void
  ): Promise<void> {
    return this.downloadModelForSize(this.selectedModel, onProgress);
  }

  /**
   * Download a specific model size with progress tracking.
   * Uses Python with huggingface-hub to download the model.
   */
  async downloadModelForSize(
    size: VisionModelSize,
    onProgress?: (bytesDownloaded: number, totalBytes: number) => void
  ): Promise<void> {
    const modelInfo = VISION_MODELS[size];
    const modelPath = this.getModelPathForSize(size);
    
    // Ensure models directory exists
    await fs.mkdir(modelPath, { recursive: true });
    
    // Check if already downloaded
    if (await this.isModelAvailableForSize(size)) {
      console.log(`[VisionModelManager] Model ${size} already downloaded`);
      return;
    }

    console.log(`[VisionModelManager] Starting download of ${size} model...`);
    
    // Use Python with huggingface-hub to download the model
    // This requires Python and huggingface-hub to be installed
    // We'll spawn a Python process to handle the download
    const { spawn } = await import('child_process');
    const { promisify } = await import('util');
    
    // Create a temporary Python script to download the model
    const scriptPath = path.join(app.getPath('temp'), 'download_vision_model.py');
    const scriptContent = `
import os
import sys
from huggingface_hub import snapshot_download

repo_id = "${modelInfo.repo}"
local_dir = "${modelPath}"

try:
    snapshot_download(
        repo_id=repo_id,
        local_dir=local_dir,
        local_dir_use_symlinks=False
    )
    print("DOWNLOAD_COMPLETE")
except Exception as e:
    print(f"DOWNLOAD_ERROR: {e}", file=sys.stderr)
    sys.exit(1)
`;

    await fs.writeFile(scriptPath, scriptContent);

    return new Promise((resolve, reject) => {
      // Try python3 first, then python
      const pythonCmd = process.platform === 'darwin' ? 'python3' : 'python';
      const pythonProcess = spawn(pythonCmd, [scriptPath], {
        env: { ...process.env, PYTHONUNBUFFERED: '1' }
      });

      let stdout = '';
      let stderr = '';

      pythonProcess.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
        // Parse progress if possible (huggingface-hub doesn't provide easy progress callbacks)
        // For now, we'll estimate based on time elapsed
      });

      pythonProcess.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      pythonProcess.on('close', async (code) => {
        try {
          await fs.unlink(scriptPath);
        } catch {
          // Ignore cleanup errors
        }

        if (code !== 0) {
          reject(new Error(`Model download failed: ${stderr || stdout}`));
          return;
        }

        if (stdout.includes('DOWNLOAD_ERROR')) {
          reject(new Error(`Model download error: ${stdout}`));
          return;
        }

        // Verify download
        if (await this.isModelAvailableForSize(size)) {
          console.log(`[VisionModelManager] Model ${size} downloaded successfully`);
          if (onProgress) {
            const modelInfo = VISION_MODELS[size];
            onProgress(modelInfo.sizeBytes, modelInfo.sizeBytes);
          }
          resolve();
        } else {
          reject(new Error(`Downloaded model validation failed for ${size} model`));
        }
      });

      pythonProcess.on('error', (error) => {
        reject(new Error(`Failed to start Python process: ${error.message}. Make sure Python and huggingface-hub are installed.`));
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
  async getDownloadProgressForSize(size: VisionModelSize): Promise<{ downloaded: number; total: number } | null> {
    try {
      const modelPath = this.getModelPathForSize(size);
      const dirSize = await this.getDirectorySize(modelPath);
      const modelInfo = VISION_MODELS[size];
      return {
        downloaded: dirSize,
        total: modelInfo.sizeBytes,
      };
    } catch {
      return null;
    }
  }

  /**
   * Delete a specific model directory.
   * Returns true if the directory was deleted, false if it didn't exist.
   */
  async deleteModelForSize(size: VisionModelSize): Promise<boolean> {
    try {
      const modelPath = this.getModelPathForSize(size);
      await fs.rm(modelPath, { recursive: true, force: true });
      console.log(`[VisionModelManager] Deleted model ${size}`);
      return true;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // Directory doesn't exist, that's fine
        return false;
      }
      throw error;
    }
  }
}

