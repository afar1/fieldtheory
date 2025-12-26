/**
 * SketchStorage - Local storage service for sketch images.
 * 
 * Handles:
 * - Saving PNG files to the app's documents directory
 * - Loading sketches from local storage
 * - Managing sketch metadata in AsyncStorage
 * - File cleanup when sketches are deleted
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import { SketchEntry } from '../types';

// Storage keys and directories.
const SKETCHES_KEY = '@littleai/sketches';
const SKETCHES_DIR = `${FileSystem.documentDirectory}sketches/`;

// Generate a unique ID for a new sketch.
const generateId = (): string => {
  return `sketch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
};

// Compute a simple hash for deduplication.
// In production, you'd use a proper SHA256 implementation.
const computeSimpleHash = async (uri: string): Promise<string> => {
  try {
    const fileInfo = await FileSystem.getInfoAsync(uri);
    if (!fileInfo.exists) return '';
    
    // Use file size and modification time as a simple hash.
    // For true deduplication, read file content and compute SHA256.
    const size = 'size' in fileInfo ? fileInfo.size : 0;
    const modTime = 'modificationTime' in fileInfo ? fileInfo.modificationTime : Date.now();
    return `${size}-${modTime}`;
  } catch (error) {
    console.error('Failed to compute hash:', error);
    return '';
  }
};

/**
 * Ensure the sketches directory exists.
 */
async function ensureSketchesDir(): Promise<void> {
  const dirInfo = await FileSystem.getInfoAsync(SKETCHES_DIR);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(SKETCHES_DIR, { intermediates: true });
  }
}

/**
 * Storage service for managing sketches locally.
 */
export class SketchStorageService {
  /**
   * Load all sketches from storage.
   * Returns sketches sorted by createdAt (newest first).
   */
  static async getSketches(): Promise<SketchEntry[]> {
    try {
      const data = await AsyncStorage.getItem(SKETCHES_KEY);
      const sketches: SketchEntry[] = data ? JSON.parse(data) : [];
      
      // Filter out sketches whose files no longer exist.
      const validSketches: SketchEntry[] = [];
      for (const sketch of sketches) {
        const fileInfo = await FileSystem.getInfoAsync(sketch.localUri);
        if (fileInfo.exists) {
          validSketches.push(sketch);
        }
      }
      
      // If we filtered any out, save the cleaned list.
      if (validSketches.length !== sketches.length) {
        await AsyncStorage.setItem(SKETCHES_KEY, JSON.stringify(validSketches));
      }
      
      return validSketches.sort((a, b) => b.createdAt - a.createdAt);
    } catch (error) {
      console.error('Failed to load sketches:', error);
      return [];
    }
  }

  /**
   * Save a new sketch from a temporary file URI.
   * Copies the file to the sketches directory and creates metadata.
   * 
   * @param tempUri - Temporary file URI from ViewShot capture
   * @param width - Image width in pixels
   * @param height - Image height in pixels
   * @param title - Optional title for the sketch
   * @returns The created SketchEntry
   */
  static async saveSketch(
    tempUri: string,
    width: number,
    height: number,
    title?: string
  ): Promise<SketchEntry> {
    try {
      await ensureSketchesDir();
      
      const id = generateId();
      const fileName = `${id}.png`;
      const localUri = `${SKETCHES_DIR}${fileName}`;
      
      // Copy from temp location to our sketches directory.
      await FileSystem.copyAsync({
        from: tempUri,
        to: localUri,
      });
      
      // Get file size.
      const fileInfo = await FileSystem.getInfoAsync(localUri);
      const bytes = 'size' in fileInfo ? fileInfo.size || 0 : 0;
      
      // Compute hash for deduplication.
      const sha256 = await computeSimpleHash(localUri);
      
      const now = Date.now();
      const sketch: SketchEntry = {
        id,
        localUri,
        width,
        height,
        bytes,
        sha256,
        title,
        createdAt: now,
        updatedAt: now,
        syncStatus: 'pending',
      };
      
      // Add to the beginning of the list (newest first).
      const sketches = await this.getSketches();
      sketches.unshift(sketch);
      await AsyncStorage.setItem(SKETCHES_KEY, JSON.stringify(sketches));
      
      console.log(`[SketchStorage] Saved sketch: ${id} (${bytes} bytes)`);
      return sketch;
    } catch (error) {
      console.error('Failed to save sketch:', error);
      throw error;
    }
  }

  /**
   * Delete a sketch and its file.
   */
  static async deleteSketch(id: string): Promise<void> {
    try {
      const sketches = await this.getSketches();
      const sketch = sketches.find((s) => s.id === id);
      
      if (sketch) {
        // Delete the file.
        try {
          await FileSystem.deleteAsync(sketch.localUri, { idempotent: true });
        } catch (fileError) {
          console.warn('Failed to delete sketch file:', fileError);
        }
      }
      
      // Remove from list.
      const filtered = sketches.filter((s) => s.id !== id);
      await AsyncStorage.setItem(SKETCHES_KEY, JSON.stringify(filtered));
      
      console.log(`[SketchStorage] Deleted sketch: ${id}`);
    } catch (error) {
      console.error('Failed to delete sketch:', error);
      throw error;
    }
  }

  /**
   * Update a sketch's metadata (e.g., sync status, title).
   */
  static async updateSketch(
    id: string,
    updates: Partial<Pick<SketchEntry, 'title' | 'syncStatus' | 'remoteUrl'>>
  ): Promise<SketchEntry | null> {
    try {
      const sketches = await this.getSketches();
      const index = sketches.findIndex((s) => s.id === id);
      
      if (index === -1) {
        return null;
      }
      
      sketches[index] = {
        ...sketches[index],
        ...updates,
        updatedAt: Date.now(),
      };
      
      await AsyncStorage.setItem(SKETCHES_KEY, JSON.stringify(sketches));
      return sketches[index];
    } catch (error) {
      console.error('Failed to update sketch:', error);
      throw error;
    }
  }

  /**
   * Get sketches that need to be synced (status is 'pending' or 'failed').
   */
  static async getPendingSketches(): Promise<SketchEntry[]> {
    const sketches = await this.getSketches();
    return sketches.filter(
      (s) => s.syncStatus === 'pending' || s.syncStatus === 'failed'
    );
  }

  /**
   * Read a sketch file as base64 for uploading.
   */
  static async getSketchBase64(id: string): Promise<string | null> {
    try {
      const sketches = await this.getSketches();
      const sketch = sketches.find((s) => s.id === id);
      
      if (!sketch) return null;
      
      const base64 = await FileSystem.readAsStringAsync(sketch.localUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      
      return base64;
    } catch (error) {
      console.error('Failed to read sketch as base64:', error);
      return null;
    }
  }

  /**
   * Get total storage used by sketches.
   */
  static async getStorageUsed(): Promise<number> {
    const sketches = await this.getSketches();
    return sketches.reduce((total, s) => total + s.bytes, 0);
  }

  /**
   * Clear all sketches (for testing/debugging).
   */
  static async clearAll(): Promise<void> {
    try {
      const sketches = await this.getSketches();
      
      // Delete all files.
      for (const sketch of sketches) {
        try {
          await FileSystem.deleteAsync(sketch.localUri, { idempotent: true });
        } catch {
          // Ignore individual file deletion errors.
        }
      }
      
      // Clear metadata.
      await AsyncStorage.removeItem(SKETCHES_KEY);
      
      console.log('[SketchStorage] Cleared all sketches');
    } catch (error) {
      console.error('Failed to clear sketches:', error);
      throw error;
    }
  }
}
