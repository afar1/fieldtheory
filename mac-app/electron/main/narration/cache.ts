/**
 * Narration Cache Manager
 *
 * Caches audio by content hash (not reading ID).
 * Implements LRU eviction with configurable size limit.
 */

import { app } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import {
  NarrationCacheEntry,
  NarrationCacheManifest,
  NarrationProfile,
  NarrationEngine,
  SynthesisParameters,
  LIBRARIAN_V1_PARAMS,
} from './types';

const CACHE_VERSION = 1;
const MANIFEST_FILE = 'cache-manifest.json';

/**
 * Manages the narration audio cache.
 * Cache key = hash(text + profile + synthesis params)
 */
export class NarrationCache {
  private cacheDir: string;
  private manifest: NarrationCacheManifest;
  private loaded = false;
  private sizeLimitBytes: number;

  constructor(sizeLimitBytes: number = 2 * 1024 * 1024 * 1024) {
    // ~/Library/Application Support/Field Theory/Narration/cache/
    this.cacheDir = path.join(
      app.getPath('userData'),
      'Narration',
      'cache'
    );
    this.sizeLimitBytes = sizeLimitBytes;
    this.manifest = {
      version: CACHE_VERSION,
      entries: {},
      readingHashes: {},
    };
  }

  /**
   * Initialize cache directory and load manifest.
   */
  async init(): Promise<void> {
    if (this.loaded) return;

    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
      await this.loadManifest();
      this.loaded = true;
      console.log(`[NarrationCache] Initialized with ${Object.keys(this.manifest.entries).length} cached items`);
    } catch (error) {
      console.error('[NarrationCache] Init failed:', error);
      throw error;
    }
  }

  /**
   * Generate content hash for cache key.
   */
  generateContentHash(
    text: string,
    profile: NarrationProfile,
    params: SynthesisParameters = LIBRARIAN_V1_PARAMS,
    engine: NarrationEngine = 'macos_say'
  ): string {
    // Include engine in hash so different engines produce different cache entries
    const data = JSON.stringify({ text, profile, params, engine });
    return crypto.createHash('sha256').update(data).digest('hex').slice(0, 32);
  }

  /**
   * Check if content is cached and get the entry.
   */
  async get(contentHash: string): Promise<NarrationCacheEntry | null> {
    await this.init();

    const entry = this.manifest.entries[contentHash];
    if (!entry) return null;

    // Verify file still exists
    try {
      await fs.access(entry.audioPath);
      // Update last accessed for LRU
      entry.lastAccessedAt = Date.now();
      await this.saveManifest();
      return entry;
    } catch {
      // File missing, remove from manifest
      delete this.manifest.entries[contentHash];
      await this.saveManifest();
      return null;
    }
  }

  /**
   * Get cached audio for a reading by its path (uses stored content hash).
   */
  async getByReadingPath(readingPath: string): Promise<NarrationCacheEntry | null> {
    await this.init();

    const contentHash = this.manifest.readingHashes[readingPath];
    if (!contentHash) return null;

    return this.get(contentHash);
  }

  /**
   * Store a new cache entry.
   */
  async set(
    contentHash: string,
    audioPath: string,
    profile: NarrationProfile,
    engine: NarrationEngine,
    readingPath?: string
  ): Promise<void> {
    await this.init();

    // Get file size
    const stats = await fs.stat(audioPath);

    const entry: NarrationCacheEntry = {
      contentHash,
      audioPath,
      profile,
      engine,
      sizeBytes: stats.size,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
    };

    this.manifest.entries[contentHash] = entry;

    // Update reading hash mapping
    if (readingPath) {
      this.manifest.readingHashes[readingPath] = contentHash;
    }

    await this.saveManifest();
    await this.enforceLimit();
  }

  /**
   * Update reading path to content hash mapping.
   */
  async updateReadingHash(readingPath: string, contentHash: string): Promise<void> {
    await this.init();
    this.manifest.readingHashes[readingPath] = contentHash;
    await this.saveManifest();
  }

  /**
   * Remove a cache entry.
   */
  async remove(contentHash: string): Promise<void> {
    await this.init();

    const entry = this.manifest.entries[contentHash];
    if (!entry) return;

    // Delete audio file
    try {
      await fs.unlink(entry.audioPath);
    } catch {
      // File already gone, that's fine
    }

    delete this.manifest.entries[contentHash];
    await this.saveManifest();
  }

  /**
   * Clear entire cache.
   */
  async clear(): Promise<void> {
    await this.init();

    // Delete all audio files
    for (const entry of Object.values(this.manifest.entries)) {
      try {
        await fs.unlink(entry.audioPath);
      } catch {
        // File already gone
      }
    }

    this.manifest.entries = {};
    this.manifest.readingHashes = {};
    await this.saveManifest();
    console.log('[NarrationCache] Cache cleared');
  }

  /**
   * Get total cache size in bytes.
   */
  getTotalSize(): number {
    return Object.values(this.manifest.entries).reduce(
      (sum, entry) => sum + entry.sizeBytes,
      0
    );
  }

  /**
   * Get count of cached items.
   */
  getItemCount(): number {
    return Object.keys(this.manifest.entries).length;
  }

  /**
   * Enforce cache size limit using LRU eviction.
   */
  private async enforceLimit(): Promise<void> {
    let totalSize = this.getTotalSize();
    if (totalSize <= this.sizeLimitBytes) return;

    // Sort by last accessed, oldest first
    const entries = Object.values(this.manifest.entries).sort(
      (a, b) => a.lastAccessedAt - b.lastAccessedAt
    );

    // Remove oldest until under limit
    for (const entry of entries) {
      if (totalSize <= this.sizeLimitBytes) break;

      await this.remove(entry.contentHash);
      totalSize -= entry.sizeBytes;
      console.log(`[NarrationCache] Evicted ${entry.contentHash} (LRU)`);
    }
  }

  /**
   * Generate a unique audio file path for new synthesis.
   */
  generateAudioPath(contentHash: string, engine: NarrationEngine = 'macos_say'): string {
    // Chatterbox outputs WAV, macOS say outputs AIFF
    // afplay handles both formats for playback
    const ext = engine === 'chatterbox' ? 'wav' : 'aiff';
    return path.join(this.cacheDir, `${contentHash}.${ext}`);
  }

  /**
   * Load manifest from disk.
   */
  private async loadManifest(): Promise<void> {
    const manifestPath = path.join(this.cacheDir, MANIFEST_FILE);
    try {
      const data = await fs.readFile(manifestPath, 'utf-8');
      const loaded = JSON.parse(data) as NarrationCacheManifest;

      // Handle version migrations if needed
      if (loaded.version !== CACHE_VERSION) {
        console.log('[NarrationCache] Manifest version mismatch, resetting');
        return;
      }

      this.manifest = loaded;
    } catch {
      // No manifest yet or corrupted, start fresh
      console.log('[NarrationCache] No existing manifest, starting fresh');
    }
  }

  /**
   * Save manifest to disk.
   */
  private async saveManifest(): Promise<void> {
    const manifestPath = path.join(this.cacheDir, MANIFEST_FILE);
    await fs.writeFile(manifestPath, JSON.stringify(this.manifest, null, 2), 'utf-8');
  }
}
