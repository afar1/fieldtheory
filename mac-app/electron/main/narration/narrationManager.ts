/**
 * Narration Manager
 *
 * Main orchestrator for the Narration Capability.
 * Handles synthesis, playback, caching, and device gating.
 *
 * The Librarian voice: Male, ever-so-slightly British,
 * flat but not robotic, deliberate pacing.
 */

import { EventEmitter } from 'events';
import { ChildProcess } from 'child_process';
import fs from 'fs/promises';
import {
  NarrationStatus,
  NarrationProfile,
  NarrationEngine,
  NarrationInstallStatus,
  NarrationPlaybackStatus,
  NarrateOptions,
  NarrateResult,
  NarrationPreferences,
  DEFAULT_NARRATION_PREFS,
  LIBRARIAN_V1_PARAMS,
  PLAYBACK_DELAY_MS,
} from './types';
import { NarrationCache } from './cache';
import { getMacOSSayEngine, MacOSSayEngine } from './engines/macos-say';
import {
  getChatterboxSidecarEngine,
  ChatterboxSidecarEngine,
  ChatterboxInstallStatus,
} from './engines/chatterbox-sidecar';
import { getOutputDeviceDetector, OutputDeviceDetector } from './deviceDetector';
import { PreferencesManager } from '../preferences';

/**
 * Events emitted by NarrationManager.
 */
export interface NarrationManagerEvents {
  'playbackStarted': (readingPath: string) => void;
  'playbackStopped': (readingPath: string | null) => void;
  'playbackError': (error: string, readingPath: string | null) => void;
  'installProgress': (progress: number, message: string) => void;
}

/**
 * NarrationManager - Main process orchestrator for narration.
 */
export class NarrationManager extends EventEmitter {
  private preferences: PreferencesManager;
  private cache: NarrationCache;
  private macosEngine: MacOSSayEngine;
  private chatterboxEngine: ChatterboxSidecarEngine;
  private deviceDetector: OutputDeviceDetector;

  private installStatus: NarrationInstallStatus = 'installed'; // macOS say always available
  private playbackStatus: NarrationPlaybackStatus = 'idle';
  private currentReadingPath: string | null = null;
  private currentPlayProcess: ChildProcess | null = null;
  private narrationPrefs: NarrationPreferences;
  private preferredEngine: NarrationEngine = 'macos_say';

  constructor(preferences: PreferencesManager) {
    super();
    this.preferences = preferences;
    this.cache = new NarrationCache();
    this.macosEngine = getMacOSSayEngine();
    this.chatterboxEngine = getChatterboxSidecarEngine();
    this.deviceDetector = getOutputDeviceDetector();

    // Load narration preferences from stored preferences
    this.narrationPrefs = this.loadNarrationPrefs();

    // Set preferred engine based on Chatterbox availability
    this.preferredEngine = this.narrationPrefs.preferredEngine || 'macos_say';
  }

  /**
   * Initialize the narration manager.
   */
  async init(): Promise<void> {
    console.log('[NarrationManager] Initializing...');

    // Initialize cache
    await this.cache.init();

    // Initialize macOS engine
    await this.macosEngine.init();

    // Check if macOS say is available
    const macosAvailable = await this.macosEngine.isAvailable();
    if (macosAvailable) {
      this.installStatus = 'installed';
      console.log('[NarrationManager] macOS Say engine available');
    } else {
      this.installStatus = 'not_installed';
      console.warn('[NarrationManager] macOS Say not available');
    }

    // Check if Chatterbox is installed
    const chatterboxInstalled = await this.chatterboxEngine.isInstalled();
    if (chatterboxInstalled) {
      console.log('[NarrationManager] Chatterbox engine available');
      // If user previously set Chatterbox as preferred and it's installed, use it
      if (this.narrationPrefs.preferredEngine === 'chatterbox') {
        this.preferredEngine = 'chatterbox';
      }
    }

    // Refresh device detection on init
    await this.deviceDetector.refresh();

    console.log(`[NarrationManager] Initialized (preferred engine: ${this.preferredEngine})`);
  }

  /**
   * Get current status.
   */
  getStatus(): NarrationStatus {
    const chatterboxStatus = this.chatterboxEngine.getInstallStatus();
    return {
      installStatus: this.installStatus,
      playbackStatus: this.playbackStatus,
      engine: this.preferredEngine,
      currentReadingPath: this.currentReadingPath,
      cacheSizeBytes: this.cache.getTotalSize(),
      cachedItemCount: this.cache.getItemCount(),
      chatterboxInstalled: chatterboxStatus.installed,
      chatterboxInstalling: chatterboxStatus.installing,
      preferredEngine: this.preferredEngine,
    };
  }

  /**
   * Get narration preferences.
   */
  getPrefs(): NarrationPreferences {
    return { ...this.narrationPrefs };
  }

  /**
   * Check if narration should auto-speak for a new reading.
   */
  async shouldSpeakNow(): Promise<{
    shouldSpeak: boolean;
    reason?: string;
  }> {
    // Check if speak-on-open is enabled
    if (!this.narrationPrefs.speakOnOpen) {
      return { shouldSpeak: false, reason: 'Speak on open disabled' };
    }

    // Check device gating
    const deviceCheck = await this.deviceDetector.shouldAllowNarration(
      this.narrationPrefs.blockedDevices
    );

    if (!deviceCheck.allowed) {
      return { shouldSpeak: false, reason: deviceCheck.reason };
    }

    return { shouldSpeak: true };
  }

  /**
   * Narrate a reading by path.
   * Generates audio if not cached, then plays.
   */
  async playReading(
    readingPath: string,
    readingContent: string,
    options: NarrateOptions = {}
  ): Promise<void> {
    const profile: NarrationProfile = options.profile || 'librarian_v1';

    console.log(`[NarrationManager] Playing reading: ${readingPath}`);

    // Stop any current playback
    this.stop();

    this.currentReadingPath = readingPath;
    this.playbackStatus = 'generating';

    try {
      // Generate content hash for the preferred engine
      const contentHash = this.cache.generateContentHash(
        readingContent,
        profile,
        LIBRARIAN_V1_PARAMS,
        this.preferredEngine
      );

      let result: NarrateResult;

      // Check cache (unless force regenerate)
      if (!options.forceRegenerate) {
        const cached = await this.cache.get(contentHash);
        if (cached) {
          console.log(`[NarrationManager] Using cached audio: ${cached.audioPath}`);
          result = {
            audioPath: cached.audioPath,
            fromCache: true,
            engine: cached.engine,
          };
        } else {
          result = await this.synthesize(readingContent, contentHash, profile);
        }
      } else {
        result = await this.synthesize(readingContent, contentHash, profile);
      }

      // Update reading hash mapping
      await this.cache.updateReadingHash(readingPath, contentHash);

      // Deliberate pause before playback (part of Librarian character)
      await this.delay(PLAYBACK_DELAY_MS);

      // Play audio
      await this.playAudio(result.audioPath);
    } catch (error) {
      console.error('[NarrationManager] Playback failed:', error);
      this.playbackStatus = 'idle';
      this.currentReadingPath = null;
      const message = error instanceof Error ? error.message : String(error);
      this.emit('playbackError', message, readingPath);
      throw error;
    }
  }

  /**
   * Stop current playback.
   */
  stop(): void {
    const wasPlaying = this.currentReadingPath;

    if (this.currentPlayProcess) {
      this.currentPlayProcess.kill('SIGTERM');
      this.currentPlayProcess = null;
    }

    this.macosEngine.stop();
    this.playbackStatus = 'idle';
    this.currentReadingPath = null;

    if (wasPlaying) {
      this.emit('playbackStopped', wasPlaying);
    }
  }

  /**
   * Set speak-on-open preference.
   */
  async setSpeakOnOpen(enabled: boolean): Promise<void> {
    this.narrationPrefs.speakOnOpen = enabled;
    await this.saveNarrationPrefs();
    console.log(`[NarrationManager] Speak on open: ${enabled}`);
  }

  /**
   * Add a blocked device pattern.
   */
  async addBlockedDevice(pattern: string): Promise<void> {
    if (!this.narrationPrefs.blockedDevices.includes(pattern)) {
      this.narrationPrefs.blockedDevices.push(pattern);
      await this.saveNarrationPrefs();
      console.log(`[NarrationManager] Added blocked device: ${pattern}`);
    }
  }

  /**
   * Remove a blocked device pattern.
   */
  async removeBlockedDevice(pattern: string): Promise<void> {
    const index = this.narrationPrefs.blockedDevices.indexOf(pattern);
    if (index !== -1) {
      this.narrationPrefs.blockedDevices.splice(index, 1);
      await this.saveNarrationPrefs();
      console.log(`[NarrationManager] Removed blocked device: ${pattern}`);
    }
  }

  /**
   * Get current output device.
   */
  async getCurrentOutputDevice() {
    return this.deviceDetector.getCurrentDevice();
  }

  /**
   * Refresh device detection.
   */
  async refreshDevices() {
    return this.deviceDetector.refresh();
  }

  /**
   * Clear narration cache.
   */
  async clearCache(): Promise<void> {
    await this.cache.clear();
    console.log('[NarrationManager] Cache cleared');
  }

  /**
   * Get Chatterbox installation status.
   */
  getChatterboxStatus(): ChatterboxInstallStatus {
    return this.chatterboxEngine.getInstallStatus();
  }

  /**
   * Install Chatterbox TTS engine.
   * Emits 'installProgress' events during installation.
   */
  async installChatterbox(): Promise<boolean> {
    console.log('[NarrationManager] Installing Chatterbox...');

    const success = await this.chatterboxEngine.install((progress, message) => {
      this.emit('installProgress', progress, message);
    });

    if (success) {
      // Automatically set Chatterbox as preferred engine after install
      this.preferredEngine = 'chatterbox';
      this.narrationPrefs.preferredEngine = 'chatterbox';
      await this.saveNarrationPrefs();
      console.log('[NarrationManager] Chatterbox installed and set as preferred');
    }

    return success;
  }

  /**
   * Test Chatterbox voice with a sample phrase.
   */
  async testChatterboxVoice(): Promise<void> {
    console.log('[NarrationManager] Testing Chatterbox voice...');

    // Stop any current playback
    this.stop();

    try {
      const result = await this.chatterboxEngine.testVoice();
      console.log(`[NarrationManager] Test audio generated: ${result.audioPath}`);

      // Play the test audio
      this.playbackStatus = 'playing';
      await this.playAudio(result.audioPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[NarrationManager] Chatterbox test failed:', message);
      throw error;
    }
  }

  /**
   * Test macOS Say voice with a sample phrase.
   */
  async testMacOSVoice(): Promise<void> {
    console.log('[NarrationManager] Testing macOS Say voice...');

    // Stop any current playback
    this.stop();

    try {
      const result = await this.macosEngine.testVoice();
      console.log(`[NarrationManager] Test audio generated: ${result.audioPath}`);

      // Play the test audio
      this.playbackStatus = 'playing';
      await this.playAudio(result.audioPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[NarrationManager] macOS Say test failed:', message);
      throw error;
    }
  }

  /**
   * Set preferred narration engine.
   */
  async setPreferredEngine(engine: NarrationEngine): Promise<void> {
    // Validate engine is available
    if (engine === 'chatterbox') {
      const installed = await this.chatterboxEngine.isInstalled();
      if (!installed) {
        throw new Error('Chatterbox is not installed');
      }
    }

    this.preferredEngine = engine;
    this.narrationPrefs.preferredEngine = engine;
    await this.saveNarrationPrefs();
    console.log(`[NarrationManager] Preferred engine set to: ${engine}`);
  }

  /**
   * Stop Chatterbox sidecar (for app shutdown).
   */
  async stopChatterbox(): Promise<void> {
    await this.chatterboxEngine.stop();
  }

  /**
   * Ensure narration is installed.
   * For v1, macOS say is the engine and is always available.
   */
  async ensureInstalled(): Promise<boolean> {
    // macOS say is built-in, always available
    const available = await this.macosEngine.isAvailable();
    if (available) {
      this.installStatus = 'installed';
      this.narrationPrefs.installed = true;
      await this.saveNarrationPrefs();
      return true;
    }
    return false;
  }

  /**
   * Install narration capability.
   * For v1, this just verifies macOS say is available.
   * Future: Download Chatterbox model.
   */
  async install(): Promise<boolean> {
    this.installStatus = 'installing';
    this.emit('installProgress', 0, 'Checking system...');

    try {
      // Check macOS say availability
      const available = await this.macosEngine.isAvailable();

      if (available) {
        await this.macosEngine.init();
        this.emit('installProgress', 100, 'Ready');
        this.installStatus = 'installed';
        this.narrationPrefs.installed = true;
        this.narrationPrefs.installedVersion = '1.0.0';
        await this.saveNarrationPrefs();
        console.log('[NarrationManager] Installation complete');
        return true;
      } else {
        throw new Error('macOS Say command not available');
      }
    } catch (error) {
      this.installStatus = 'install_failed';
      console.error('[NarrationManager] Installation failed:', error);
      return false;
    }
  }

  /**
   * Synthesize text to audio.
   * Uses preferred engine with fallback to macOS say.
   */
  private async synthesize(
    text: string,
    contentHash: string,
    profile: NarrationProfile
  ): Promise<NarrateResult> {
    console.log(`[NarrationManager] Synthesizing ${text.length} chars with ${this.preferredEngine}...`);

    let result: NarrateResult;
    let engine: NarrationEngine = this.preferredEngine;
    let actualContentHash = contentHash;

    // Try Chatterbox first if it's preferred
    if (this.preferredEngine === 'chatterbox') {
      try {
        const chatterboxInstalled = await this.chatterboxEngine.isInstalled();
        if (chatterboxInstalled) {
          const outputPath = this.cache.generateAudioPath(contentHash, 'chatterbox');
          result = await this.chatterboxEngine.synthesize(
            text,
            outputPath,
            profile,
            LIBRARIAN_V1_PARAMS
          );
          engine = 'chatterbox';
        } else {
          console.warn('[NarrationManager] Chatterbox not installed, falling back to macOS say');
          // Generate new hash for fallback engine
          actualContentHash = this.cache.generateContentHash(text, profile, LIBRARIAN_V1_PARAMS, 'macos_say');
          const outputPath = this.cache.generateAudioPath(actualContentHash, 'macos_say');
          result = await this.macosEngine.synthesize(text, outputPath, profile);
          engine = 'macos_say';
        }
      } catch (error) {
        // Silent fallback to macOS say on Chatterbox failure
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[NarrationManager] Chatterbox failed (${message}), falling back to macOS say`);
        // Generate new hash for fallback engine
        actualContentHash = this.cache.generateContentHash(text, profile, LIBRARIAN_V1_PARAMS, 'macos_say');
        const outputPath = this.cache.generateAudioPath(actualContentHash, 'macos_say');
        result = await this.macosEngine.synthesize(text, outputPath, profile);
        engine = 'macos_say';
      }
    } else {
      // Use macOS say engine
      const outputPath = this.cache.generateAudioPath(contentHash, 'macos_say');
      result = await this.macosEngine.synthesize(text, outputPath, profile);
      engine = 'macos_say';
    }

    // Store in cache with the actual hash and engine used
    await this.cache.set(
      actualContentHash,
      result.audioPath,
      profile,
      engine,
      this.currentReadingPath || undefined
    );

    console.log(`[NarrationManager] Synthesis complete (${engine}): ${result.audioPath}`);
    return result;
  }

  /**
   * Play audio file.
   */
  private async playAudio(audioPath: string): Promise<void> {
    // Verify file exists
    await fs.access(audioPath);

    this.playbackStatus = 'playing';
    this.emit('playbackStarted', this.currentReadingPath!);

    return new Promise((resolve, reject) => {
      this.macosEngine.play(audioPath).then((process) => {
        this.currentPlayProcess = process;

        process.on('close', (code) => {
          this.currentPlayProcess = null;
          this.playbackStatus = 'idle';
          const readingPath = this.currentReadingPath;
          this.currentReadingPath = null;

          if (code === 0) {
            this.emit('playbackStopped', readingPath);
            resolve();
          } else if (code === null) {
            // Killed intentionally
            this.emit('playbackStopped', readingPath);
            resolve();
          } else {
            const error = `Playback exited with code ${code}`;
            this.emit('playbackError', error, readingPath);
            reject(new Error(error));
          }
        });

        process.on('error', (error) => {
          this.currentPlayProcess = null;
          this.playbackStatus = 'idle';
          const readingPath = this.currentReadingPath;
          this.currentReadingPath = null;
          this.emit('playbackError', error.message, readingPath);
          reject(error);
        });
      }).catch(reject);
    });
  }

  /**
   * Load narration preferences from stored preferences.
   */
  private loadNarrationPrefs(): NarrationPreferences {
    const stored = this.preferences.getPreference('narrationPrefs' as never);
    if (stored && typeof stored === 'object') {
      return { ...DEFAULT_NARRATION_PREFS, ...(stored as Partial<NarrationPreferences>) };
    }
    return { ...DEFAULT_NARRATION_PREFS };
  }

  /**
   * Save narration preferences to stored preferences.
   */
  private async saveNarrationPrefs(): Promise<void> {
    await this.preferences.save({ narrationPrefs: this.narrationPrefs } as never);
  }

  /**
   * Utility: delay for given ms.
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Singleton instance
let instance: NarrationManager | null = null;

export function getNarrationManager(preferences: PreferencesManager): NarrationManager {
  if (!instance) {
    instance = new NarrationManager(preferences);
  }
  return instance;
}

export function getNarrationManagerInstance(): NarrationManager | null {
  return instance;
}
