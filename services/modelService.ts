import * as FileSystem from 'expo-file-system';

// Model file configuration
const MODEL_NAME = 'ggml-base.en.bin';
const MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin';
const EXPECTED_SIZE = 142 * 1024 * 1024; // 142 MB in bytes

/**
 * Get the local path where the model file should be stored.
 * Uses the app's document directory for persistent storage.
 */
function getModelPath(): string {
  return `${FileSystem.documentDirectory}${MODEL_NAME}`;
}

/**
 * Check if the model file exists and is valid.
 * Validates file size to ensure it's not corrupted.
 */
async function modelExists(): Promise<boolean> {
  try {
    const path = getModelPath();
    const fileInfo = await FileSystem.getInfoAsync(path);
    
    if (!fileInfo.exists || !fileInfo.size) {
      return false;
    }
    
    // Verify file size is approximately correct (allow 1MB variance)
    const sizeVariance = 1024 * 1024; // 1MB
    const isValidSize = Math.abs(fileInfo.size - EXPECTED_SIZE) < sizeVariance;
    
    return isValidSize;
  } catch (error) {
    console.error('Error checking model file:', error);
    return false;
  }
}

/**
 * Download the model file from HuggingFace.
 * Shows progress and handles errors.
 */
async function downloadModel(
  onProgress?: (progress: number) => void
): Promise<string> {
  const path = getModelPath();
  
  try {
    // Create download callback for progress tracking
    const downloadResumable = FileSystem.createDownloadResumable(
      MODEL_URL,
      path,
      {},
      (downloadProgress) => {
        const progress = downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite;
        onProgress?.(progress);
      }
    );
    
    const result = await downloadResumable.downloadAsync();
    
    if (!result) {
      throw new Error('Download failed - no result returned');
    }
    
    // Verify downloaded file size
    const fileInfo = await FileSystem.getInfoAsync(result.uri);
    if (!fileInfo.exists || !fileInfo.size) {
      throw new Error('Downloaded file is invalid');
    }
    
    const sizeVariance = 1024 * 1024; // 1MB
    if (Math.abs(fileInfo.size - EXPECTED_SIZE) > sizeVariance) {
      throw new Error(`Downloaded file size mismatch. Expected ~${EXPECTED_SIZE} bytes, got ${fileInfo.size}`);
    }
    
    return result.uri;
  } catch (error) {
    // Clean up partial download on error
    try {
      const fileInfo = await FileSystem.getInfoAsync(path);
      if (fileInfo.exists) {
        await FileSystem.deleteAsync(path, { idempotent: true });
      }
    } catch (cleanupError) {
      console.error('Error cleaning up failed download:', cleanupError);
    }
    
    throw error;
  }
}

/**
 * Ensure the model file is available locally.
 * Downloads it if it doesn't exist or is corrupted.
 * Returns the local file path for use with whisper.rn.
 */
export async function ensureModelAvailable(
  onProgress?: (progress: number) => void
): Promise<string> {
  // Check if model already exists and is valid
  if (await modelExists()) {
    return getModelPath();
  }
  
  // Download the model
  console.log('Model not found locally, downloading...');
  return await downloadModel(onProgress);
}

/**
 * Get the current model file path without downloading.
 * Returns null if the model doesn't exist.
 */
export async function getModelPathIfExists(): Promise<string | null> {
  if (await modelExists()) {
    return getModelPath();
  }
  return null;
}

