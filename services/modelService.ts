import * as FileSystem from 'expo-file-system';

// Model file configuration
const MODEL_NAME = 'ggml-base.en.bin';
// Pinned to Hugging Face commit 5359861c739e955e79d9a303bcbc70fb988958b1.
// Upstream LFS SHA-256: a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002.
const MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-base.en.bin';
const EXPECTED_SIZE = 147964211;
const EXPECTED_MD5 = '4279db3d7b18d9f6e4d5817a16af4f09';

/**
 * Get the local path where the model file should be stored.
 * Uses the app's document directory for persistent storage.
 */
function getModelPath(): string {
  return `${FileSystem.documentDirectory}${MODEL_NAME}`;
}

/**
 * Check if the model file exists and is valid.
 * Validates file size and checksum to ensure it's not corrupted.
 */
async function modelExists(): Promise<boolean> {
  try {
    const path = getModelPath();
    const fileInfo = await FileSystem.getInfoAsync(path, { md5: true });
    
    if (!fileInfo.exists || !fileInfo.size || !fileInfo.md5) {
      return false;
    }
    
    return fileInfo.size === EXPECTED_SIZE && fileInfo.md5 === EXPECTED_MD5;
  } catch (error) {
    console.error('Error checking model file:', error);
    return false;
  }
}

async function validateModelFile(uri: string): Promise<void> {
  const fileInfo = await FileSystem.getInfoAsync(uri, { md5: true });
  if (!fileInfo.exists || !fileInfo.size || !fileInfo.md5) {
    throw new Error('Downloaded speech model is invalid.');
  }

  if (fileInfo.size !== EXPECTED_SIZE || fileInfo.md5 !== EXPECTED_MD5) {
    throw new Error('Downloaded speech model did not match the expected checksum.');
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
    onProgress?.(0);
    // Create download callback for progress tracking
    const downloadResumable = FileSystem.createDownloadResumable(
      MODEL_URL,
      path,
      {},
      (downloadProgress) => {
        if (downloadProgress.totalBytesExpectedToWrite > 0) {
          const progress = downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite;
          onProgress?.(Math.min(1, Math.max(0, progress)));
        }
      }
    );
    
    const result = await downloadResumable.downloadAsync();
    
    if (!result) {
      throw new Error('Download failed - no result returned');
    }
    
    await validateModelFile(result.uri);
    onProgress?.(1);
    
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
    if (error instanceof Error) {
      throw new Error(`Unable to download speech model. Check your connection and try again. ${error.message}`);
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
  
  await FileSystem.deleteAsync(getModelPath(), { idempotent: true });

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
