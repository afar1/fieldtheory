import { app } from 'electron';
import fs from 'fs/promises';
import { createWriteStream } from 'fs';
import path from 'path';
import https from 'https';

/**
 * Dynamic import helper that bypasses TypeScript's transformation.
 * TypeScript converts `await import()` to `require()` in CommonJS mode,
 * but node-llama-cpp is an ESM-only package and needs true dynamic import.
 */
async function dynamicImport(modulePath: string): Promise<any> {
  // Use Function constructor to create a dynamic import that TypeScript won't transform
  const importFn = new Function('modulePath', 'return import(modulePath)');
  return importFn(modulePath);
}

/**
 * Available local LLM model sizes.
 * Smaller models are faster but less capable.
 */
export type LLMModelSize = 'llama-3.2-1b';

/**
 * Model metadata including name, URL, and expected size.
 */
interface LLMModelInfo {
  name: string;
  filename: string;
  url: string;
  sizeBytes: number;
  description: string;
}

/**
 * Available models configuration.
 * Using Q4_K_M quantization for good balance of quality and speed.
 */
const LLM_MODELS: Record<LLMModelSize, LLMModelInfo> = {
  'llama-3.2-1b': {
    name: 'Llama 3.2 1B',
    filename: 'Llama-3.2-1B-Instruct-Q4_K_M.gguf',
    url: 'https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf',
    sizeBytes: 900 * 1024 * 1024, // ~900MB
    description: '1B (900MB) - Fast, good for simple tasks',
  },
};

/**
 * Manages local LLM model downloads, storage, and inference.
 * Models are stored in ~/Library/Application Support/Field Theory/llm-models/
 */
// Auto-unload model after this many minutes of idle time to save memory/battery
const IDLE_UNLOAD_MINUTES = 5;

export class LocalLLMManager {
  private modelsDir: string;
  private selectedModel: LLMModelSize = 'llama-3.2-1b';
  private downloadingModels: Set<LLMModelSize> = new Set();
  private llama: any = null;
  private model: any = null;
  private context: any = null;
  private contextSequence: any = null; // Reuse the same sequence to avoid "No sequences left" errors
  private isGenerating: boolean = false; // Guard against concurrent generation
  private isInitializing: boolean = false;
  private lastUsedAt: number = 0;
  private idleTimer: NodeJS.Timeout | null = null;
  private statusCache: { status: Record<LLMModelSize, boolean>; timestamp: number } | null = null;
  private static STATUS_CACHE_TTL = 5000; // 5 second cache

  constructor(selectedModel?: LLMModelSize) {
    const appDataPath = app.getPath('userData');
    this.modelsDir = path.join(appDataPath, 'llm-models');
    if (selectedModel) {
      this.selectedModel = selectedModel;
    }
  }

  /**
   * Reset the idle timer. Called after each model use.
   */
  private resetIdleTimer(): void {
    this.lastUsedAt = Date.now();

    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }

    this.idleTimer = setTimeout(() => {
      if (this.isModelLoaded()) {
        console.log(`[LocalLLMManager] Unloading model after ${IDLE_UNLOAD_MINUTES} minutes of idle time`);
        this.unloadModel();
      }
    }, IDLE_UNLOAD_MINUTES * 60 * 1000);
  }

  /**
   * Get which models are currently being downloaded.
   */
  getDownloadingModels(): LLMModelSize[] {
    return Array.from(this.downloadingModels);
  }

  /**
   * Check if a specific model is currently being downloaded.
   */
  isDownloading(size: LLMModelSize): boolean {
    return this.downloadingModels.has(size);
  }

  /**
   * Get the currently selected model size.
   */
  getSelectedModel(): LLMModelSize {
    return this.selectedModel;
  }

  /**
   * Set the selected model size.
   * Unloads the current model if a different one is selected.
   */
  async setSelectedModel(size: LLMModelSize): Promise<void> {
    if (this.selectedModel !== size) {
      await this.unloadModel();
      this.selectedModel = size;
    }
  }

  /**
   * Get information about all available models.
   */
  getAvailableModels(): Record<LLMModelSize, LLMModelInfo> {
    return LLM_MODELS;
  }

  /**
   * Invalidate the status cache. Called after downloads/deletes.
   */
  invalidateCache(): void {
    this.statusCache = null;
  }

  /**
   * Get download status for all models.
   * Results are cached for 5 seconds to avoid repeated filesystem checks.
   */
  async getDownloadStatus(): Promise<Record<LLMModelSize, boolean>> {
    // Return cached status if valid
    if (this.statusCache && Date.now() - this.statusCache.timestamp < LocalLLMManager.STATUS_CACHE_TTL) {
      return this.statusCache.status;
    }

    const status: Record<LLMModelSize, boolean> = {} as Record<LLMModelSize, boolean>;
    const modelSizes: LLMModelSize[] = ['llama-3.2-1b'];

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
  getModelInfo(size: LLMModelSize): LLMModelInfo {
    return LLM_MODELS[size];
  }

  /**
   * Get the path to a specific model file.
   */
  getModelPathForSize(size: LLMModelSize): string {
    const modelInfo = LLM_MODELS[size];
    return path.join(this.modelsDir, modelInfo.filename);
  }

  /**
   * Check if a specific model size is downloaded and valid.
   */
  async isModelAvailableForSize(size: LLMModelSize): Promise<boolean> {
    const modelPath = this.getModelPathForSize(size);
    const modelInfo = LLM_MODELS[size];

    try {
      const stats = await fs.stat(modelPath);
      const fileSizeMB = stats.size / 1024 / 1024;

      // Minimum size sanity check - file should be at least 50% of expected size.
      const minSize = modelInfo.sizeBytes * 0.5;

      if (stats.size < minSize) {
        console.warn(`[LocalLLMManager] Model ${size} too small: ${fileSizeMB.toFixed(2)}MB`);
        return false;
      }

      console.log(`[LocalLLMManager] Model ${size} found: ${fileSizeMB.toFixed(2)}MB`);
      return true;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        console.log(`[LocalLLMManager] Model ${size} not found at: ${modelPath}`);
      }
      return false;
    }
  }

  /**
   * Download a specific model size with progress tracking.
   */
  async downloadModelForSize(
    size: LLMModelSize,
    onProgress?: (bytesDownloaded: number, totalBytes: number) => void
  ): Promise<void> {
    if (this.downloadingModels.has(size)) {
      console.log(`[LocalLLMManager] Model ${size} download already in progress`);
      return;
    }

    const modelInfo = LLM_MODELS[size];
    const modelPath = this.getModelPathForSize(size);

    await fs.mkdir(this.modelsDir, { recursive: true });

    if (await this.isModelAvailableForSize(size)) {
      console.log(`[LocalLLMManager] Model ${size} already downloaded`);
      return;
    }

    console.log(`[LocalLLMManager] Starting download of ${size} model...`);
    this.downloadingModels.add(size);

    try {
      await this.downloadWithRedirects(modelInfo.url, modelPath, onProgress);

      if (await this.isModelAvailableForSize(size)) {
        console.log(`[LocalLLMManager] Model ${size} downloaded successfully`);
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
        const statusCode = response.statusCode || 0;
        if (statusCode >= 300 && statusCode < 400 && response.headers.location) {
          const redirectUrl = response.headers.location;
          console.log(`[LocalLLMManager] Following redirect to: ${redirectUrl}`);
          response.destroy();
          this.downloadWithRedirects(redirectUrl, filePath, onProgress, maxRedirects - 1)
            .then(resolve)
            .catch(reject);
          return;
        }

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
   * Delete a specific model file.
   */
  async deleteModelForSize(size: LLMModelSize): Promise<boolean> {
    try {
      // Unload if this is the currently loaded model
      if (size === this.selectedModel) {
        await this.unloadModel();
      }

      const modelPath = this.getModelPathForSize(size);
      await fs.unlink(modelPath);
      console.log(`[LocalLLMManager] Deleted model ${size}`);
      this.invalidateCache();
      return true;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return false;
      }
      throw error;
    }
  }

  /**
   * Initialize the LLM engine and load the selected model.
   */
  async loadModel(): Promise<boolean> {
    if (this.model) {
      return true; // Already loaded
    }

    if (this.isInitializing) {
      console.log('[LocalLLMManager] Model initialization already in progress');
      return false;
    }

    const modelPath = this.getModelPathForSize(this.selectedModel);
    if (!(await this.isModelAvailableForSize(this.selectedModel))) {
      console.error(`[LocalLLMManager] Model ${this.selectedModel} not available`);
      return false;
    }

    this.isInitializing = true;

    try {
      console.log(`[LocalLLMManager] Loading model ${this.selectedModel}...`);

      // Use dynamicImport to bypass TypeScript's CommonJS transformation
      // node-llama-cpp is ESM-only and needs true dynamic import
      const nodeLlamaCpp = await dynamicImport('node-llama-cpp');
      const { getLlama } = nodeLlamaCpp;

      this.llama = await getLlama();
      this.model = await this.llama.loadModel({ modelPath });
      // Use larger context size (16K) to handle long transcripts (5000+ words)
      // Default context is often 2K-4K which truncates long inputs
      this.context = await this.model.createContext({ contextSize: 16384 });
      this.contextSequence = this.context.getSequence();

      console.log(`[LocalLLMManager] Model ${this.selectedModel} loaded successfully`);
      return true;
    } catch (error) {
      console.error('[LocalLLMManager] Failed to load model:', error);
      this.llama = null;
      this.model = null;
      this.context = null;
      this.contextSequence = null;
      return false;
    } finally {
      this.isInitializing = false;
    }
  }

  /**
   * Unload the current model to free memory.
   */
  async unloadModel(): Promise<void> {
    if (this.contextSequence) {
      await this.contextSequence.dispose?.();
      this.contextSequence = null;
    }
    if (this.context) {
      await this.context.dispose?.();
      this.context = null;
    }
    if (this.model) {
      await this.model.dispose?.();
      this.model = null;
    }
    console.log('[LocalLLMManager] Model unloaded');
  }

  /**
   * Check if a model is currently loaded.
   */
  isModelLoaded(): boolean {
    return this.model !== null && this.context !== null && this.contextSequence !== null;
  }

  /**
   * Generate a response from the local LLM.
   * Automatically loads the model if not already loaded.
   * Reuses the same context sequence across generations to avoid "No sequences left" errors.
   */
  async generateResponse(
    systemPrompt: string,
    userMessage: string,
    maxTokens: number = 1024
  ): Promise<{ success: boolean; response?: string; error?: string }> {
    // Guard against concurrent generation - the sequence can only handle one at a time
    if (this.isGenerating) {
      console.log('[LocalLLMManager] Generation already in progress, waiting...');
      return { success: false, error: 'Generation already in progress. Please wait.' };
    }

    this.isGenerating = true;

    try {
      // Load model if not already loaded
      if (!this.isModelLoaded()) {
        console.log('[LocalLLMManager] Model not loaded, loading now...');
        const loaded = await this.loadModel();
        if (!loaded) {
          return { success: false, error: 'Failed to load local model. Check console for details.' };
        }
      }

      const nodeLlamaCpp = await dynamicImport('node-llama-cpp');
      const { LlamaChatSession } = nodeLlamaCpp;

      const session = new LlamaChatSession({
        contextSequence: this.contextSequence,
        systemPrompt,
      });

      console.log('[LocalLLMManager] Generating response...');
      const startTime = Date.now();
      const response = await session.prompt(userMessage, {
        maxTokens,
      });
      const elapsed = Date.now() - startTime;

      console.log(`[LocalLLMManager] Response generated in ${elapsed}ms`);

      // Reset idle timer after successful use
      this.resetIdleTimer();

      return { success: true, response };
    } catch (error) {
      console.error('[LocalLLMManager] Generation failed:', error);

      // Provide more specific error messages
      const errorMessage = error instanceof Error ? error.message : 'Generation failed';
      let userFriendlyError = errorMessage;

      if (errorMessage.includes('CUDA') || errorMessage.includes('GPU')) {
        userFriendlyError = 'GPU error - try restarting the app';
      } else if (errorMessage.includes('memory') || errorMessage.includes('OOM')) {
        userFriendlyError = 'Out of memory - close other apps and try again';
      } else if (errorMessage.includes('context') || errorMessage.includes('sequence')) {
        userFriendlyError = 'Model context error - restarting model...';
        // Try to recover by unloading and reloading
        await this.unloadModel();
      }

      return {
        success: false,
        error: userFriendlyError,
      };
    } finally {
      this.isGenerating = false;
    }
  }
}
