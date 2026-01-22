/**
 * Narration Manager
 *
 * Main orchestrator for the Narration Capability.
 * Handles synthesis, playback, caching, and device gating.
 *
 * The Librarian voice: Male, ever-so-slightly British,
 * flat but not robotic, deliberate pacing.
 */

// Feature flag for narration - disabled by default
export const FEATURE_NARRATION_ENABLED = false;

import { EventEmitter } from 'events';
import { ChildProcess, spawn } from 'child_process';
import { app } from 'electron';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
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
  CHUNK_MIN_LENGTH,
  CHUNK_MAX_LENGTH,
  CHUNK_THRESHOLD,
  ElevenLabsVoice,
  ELEVENLABS_LIBRARIAN_VOICES,
} from './types';
import { NarrationCache } from './cache';
import { getMacOSSayEngine, MacOSSayEngine } from './engines/macos-say';
import {
  getChatterboxSidecarEngine,
  ChatterboxSidecarEngine,
  ChatterboxInstallStatus,
} from './engines/chatterbox-sidecar';
import {
  getElevenLabsEngine,
  ElevenLabsEngine,
  ElevenLabsVoiceInfo,
} from './engines/elevenlabs';
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
  private elevenlabsEngine: ElevenLabsEngine;
  private deviceDetector: OutputDeviceDetector;

  private installStatus: NarrationInstallStatus = 'installed'; // macOS say always available
  private playbackStatus: NarrationPlaybackStatus = 'idle';
  private currentReadingPath: string | null = null;
  private currentPlayProcess: ChildProcess | null = null;
  private narrationPrefs: NarrationPreferences;
  private preferredEngine: NarrationEngine = 'macos_say';

  // Chunking state for long content
  private pendingChunks: string[] = [];
  private currentChunkIndex = 0;
  private chunkCancelled = false;
  private pendingSynthesis: Promise<NarrateResult> | null = null;

  // Active generation tracking - prevents duplicate requests
  private generatingPaths: Set<string> = new Set();

  // Playback progress tracking
  private currentAudioPath: string | null = null;
  private currentAudioDuration: number = 0; // in seconds
  private playbackStartTime: number = 0; // timestamp when playback started
  private pausedAtPosition: number = 0; // position in seconds when paused

  constructor(preferences: PreferencesManager) {
    super();
    this.preferences = preferences;
    this.cache = new NarrationCache();
    this.macosEngine = getMacOSSayEngine();
    this.chatterboxEngine = getChatterboxSidecarEngine();
    this.elevenlabsEngine = getElevenLabsEngine();
    this.deviceDetector = getOutputDeviceDetector();

    // Load narration preferences from stored preferences
    this.narrationPrefs = this.loadNarrationPrefs();

    // Configure ElevenLabs from stored key or environment variable
    const elevenlabsApiKey = this.narrationPrefs.elevenlabsApiKey || process.env.ELEVENLABS_API_KEY;
    if (elevenlabsApiKey) {
      this.elevenlabsEngine.configure(
        elevenlabsApiKey,
        this.narrationPrefs.elevenlabsVoiceId,
        this.narrationPrefs.elevenlabsModelId
      );
      // If using env var and not stored, save it to prefs for status display
      if (!this.narrationPrefs.elevenlabsApiKey && process.env.ELEVENLABS_API_KEY) {
        this.narrationPrefs.elevenlabsApiKey = process.env.ELEVENLABS_API_KEY;
      }
    }

    // Set preferred engine - default to ElevenLabs if configured, otherwise use stored preference
    if (elevenlabsApiKey && !this.narrationPrefs.preferredEngine) {
      this.preferredEngine = 'elevenlabs';
    } else {
      this.preferredEngine = this.narrationPrefs.preferredEngine || 'macos_say';
    }
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

    // Check ElevenLabs configuration
    const elevenlabsConfigured = this.elevenlabsEngine.isConfigured();
    console.log(`[NarrationManager] ElevenLabs configured: ${elevenlabsConfigured}, env var present: ${!!process.env.ELEVENLABS_API_KEY}`);
    if (elevenlabsConfigured) {
      console.log('[NarrationManager] ElevenLabs engine configured - setting as preferred');
      // Always prefer ElevenLabs when it's configured
      this.preferredEngine = 'elevenlabs';
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
      elevenlabsConfigured: this.elevenlabsEngine.isConfigured(),
      elevenlabsVoiceId: this.elevenlabsEngine.getVoiceId(),
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
   * Check if a reading is currently being generated.
   */
  isGenerating(readingPath: string): boolean {
    return this.generatingPaths.has(readingPath);
  }

  /**
   * Pre-generate audio for a reading without playing it.
   * Returns the audio path when ready. Uses cache if available.
   * Prevents duplicate generation requests.
   */
  async preGenerateAudio(
    readingPath: string,
    readingContent: string,
    options: NarrateOptions = {}
  ): Promise<{ audioPath: string; fromCache: boolean } | null> {
    const profile: NarrationProfile = options.profile || 'librarian_v1';

    // Check if already generating this path
    if (this.generatingPaths.has(readingPath)) {
      console.log(`[NarrationManager] Already generating: ${readingPath}`);
      return null;
    }

    console.log(`[NarrationManager] Pre-generating audio: ${readingPath}`);

    // Mark as generating and emit event immediately
    this.generatingPaths.add(readingPath);
    this.playbackStatus = 'generating';
    this.currentReadingPath = readingPath;
    this.emit('generationStarted', readingPath);

    try {
      // Generate content hash for the preferred engine
      const contentHash = this.cache.generateContentHash(
        readingContent,
        profile,
        LIBRARIAN_V1_PARAMS,
        this.preferredEngine
      );

      // Check cache first (unless force regenerate)
      if (!options.forceRegenerate) {
        const cached = await this.cache.get(contentHash);
        if (cached) {
          console.log(`[NarrationManager] Using cached audio: ${cached.audioPath}`);
          await this.cache.updateReadingHash(readingPath, contentHash);
          this.generatingPaths.delete(readingPath);
          this.playbackStatus = 'idle';
          this.currentReadingPath = null;
          return { audioPath: cached.audioPath, fromCache: true };
        }
      }

      // Generate new audio
      const result = await this.synthesize(readingContent, contentHash, profile);
      await this.cache.updateReadingHash(readingPath, contentHash);

      this.generatingPaths.delete(readingPath);
      this.playbackStatus = 'idle';
      this.currentReadingPath = null;

      console.log(`[NarrationManager] Pre-generation complete: ${result.audioPath}`);
      return { audioPath: result.audioPath, fromCache: false };
    } catch (error) {
      console.error('[NarrationManager] Pre-generation failed:', error);
      this.generatingPaths.delete(readingPath);
      this.playbackStatus = 'idle';
      this.currentReadingPath = null;
      const message = error instanceof Error ? error.message : String(error);
      this.emit('playbackError', message, readingPath);
      throw error;
    }
  }

  /**
   * Narrate a reading by path.
   * Generates audio if not cached, then plays.
   * Uses chunked synthesis for long texts with Chatterbox.
   */
  async playReading(
    readingPath: string,
    readingContent: string,
    options: NarrateOptions = {}
  ): Promise<void> {
    const profile: NarrationProfile = options.profile || 'librarian_v1';

    // Check if already generating this path
    if (this.generatingPaths.has(readingPath)) {
      console.log(`[NarrationManager] Already generating, skipping duplicate request: ${readingPath}`);
      return;
    }

    console.log(`[NarrationManager] Playing reading: ${readingPath}`);

    // Stop any current playback
    this.stop();

    // Mark as generating immediately
    this.generatingPaths.add(readingPath);
    this.currentReadingPath = readingPath;
    this.playbackStatus = 'generating';

    // Emit event immediately so UI updates
    this.emit('generationStarted', readingPath);

    try {
      // Generate content hash for the preferred engine
      const contentHash = this.cache.generateContentHash(
        readingContent,
        profile,
        LIBRARIAN_V1_PARAMS,
        this.preferredEngine
      );

      // Check cache first (unless force regenerate)
      if (!options.forceRegenerate) {
        const cached = await this.cache.get(contentHash);
        if (cached) {
          console.log(`[NarrationManager] Using cached audio: ${cached.audioPath}`);

          // Update reading hash mapping
          await this.cache.updateReadingHash(readingPath, contentHash);

          // Clear generation tracking before playback
          this.generatingPaths.delete(readingPath);

          // Deliberate pause before playback (part of Librarian character)
          await this.delay(PLAYBACK_DELAY_MS);

          // Play cached audio
          await this.playAudio(cached.audioPath);
          return;
        }
      }

      // Clear generation tracking before playback (generation complete)
      this.generatingPaths.delete(readingPath);

      // Check if we should use chunked synthesis
      // Only for Chatterbox + long text
      const shouldChunk =
        this.preferredEngine === 'chatterbox' &&
        readingContent.length > CHUNK_THRESHOLD &&
        await this.chatterboxEngine.isInstalled();

      if (shouldChunk) {
        // Use chunked synthesis for long Chatterbox content
        const chunks = this.splitIntoChunks(readingContent);
        console.log(`[NarrationManager] Using chunked synthesis: ${chunks.length} chunks`);

        // Deliberate pause before playback (part of Librarian character)
        await this.delay(PLAYBACK_DELAY_MS);

        // Synthesize and play chunks with lookahead
        await this.synthesizeAndPlayChunked(chunks, profile);
      } else {
        // Standard synthesis for short text or macOS Say
        const result = await this.synthesize(readingContent, contentHash, profile);

        // Update reading hash mapping
        await this.cache.updateReadingHash(readingPath, contentHash);

        // Deliberate pause before playback (part of Librarian character)
        await this.delay(PLAYBACK_DELAY_MS);

        // Play audio
        await this.playAudio(result.audioPath);
      }
    } catch (error) {
      console.error('[NarrationManager] Playback failed:', error);
      this.generatingPaths.delete(readingPath);
      this.playbackStatus = 'idle';
      this.currentReadingPath = null;
      const message = error instanceof Error ? error.message : String(error);
      this.emit('playbackError', message, readingPath);
      throw error;
    }
  }

  /**
   * Play a pre-generated audio file directly.
   * Used after preGenerateAudio() completes.
   */
  async playAudioFile(
    readingPath: string,
    audioPath: string
  ): Promise<void> {
    console.log(`[NarrationManager] Playing pre-generated audio: ${audioPath}`);

    // Stop any current playback
    this.stop();

    this.currentReadingPath = readingPath;

    // Deliberate pause before playback (part of Librarian character)
    await this.delay(PLAYBACK_DELAY_MS);

    // Play audio
    await this.playAudio(audioPath);
  }

  /**
   * Stop current playback.
   */
  stop(): void {
    const wasPlaying = this.currentReadingPath;

    // Cancel chunked playback if in progress
    this.chunkCancelled = true;
    this.pendingChunks = [];
    this.pendingSynthesis = null;

    // Clear all generation tracking
    this.generatingPaths.clear();

    if (this.currentPlayProcess) {
      this.currentPlayProcess.kill('SIGTERM');
      this.currentPlayProcess = null;
    }

    this.macosEngine.stop();
    this.playbackStatus = 'stopped';
    this.currentReadingPath = null;

    if (wasPlaying) {
      this.emit('playbackStopped', wasPlaying);
    }

    // Reset to idle after a tick (allows chunked loop to see 'stopped' state)
    setTimeout(() => {
      if (this.playbackStatus === 'stopped') {
        this.playbackStatus = 'idle';
      }
    }, 100);

    // Reset progress tracking
    this.currentAudioPath = null;
    this.currentAudioDuration = 0;
    this.playbackStartTime = 0;
    this.pausedAtPosition = 0;
  }

  /**
   * Pause current playback.
   * Uses SIGSTOP to pause the afplay process.
   */
  pause(): boolean {
    if (this.playbackStatus !== 'playing' || !this.currentPlayProcess) {
      return false;
    }

    try {
      // Calculate position when pausing
      const elapsed = (Date.now() - this.playbackStartTime) / 1000;
      this.pausedAtPosition += elapsed;

      // Send SIGSTOP to pause the process
      this.currentPlayProcess.kill('SIGSTOP');
      this.playbackStatus = 'paused';
      this.emit('playbackPaused', this.currentReadingPath);
      console.log(`[NarrationManager] Paused at ${this.pausedAtPosition.toFixed(1)}s`);
      return true;
    } catch (error) {
      console.error('[NarrationManager] Pause failed:', error);
      return false;
    }
  }

  /**
   * Resume paused playback.
   * Uses SIGCONT to resume the afplay process.
   */
  resume(): boolean {
    if (this.playbackStatus !== 'paused' || !this.currentPlayProcess) {
      return false;
    }

    try {
      // Send SIGCONT to resume the process
      this.currentPlayProcess.kill('SIGCONT');
      this.playbackStatus = 'playing';
      this.playbackStartTime = Date.now(); // Reset start time for tracking
      this.emit('playbackResumed', this.currentReadingPath);
      console.log(`[NarrationManager] Resumed from ${this.pausedAtPosition.toFixed(1)}s`);
      return true;
    } catch (error) {
      console.error('[NarrationManager] Resume failed:', error);
      return false;
    }
  }

  /**
   * Toggle pause/play state.
   */
  togglePause(): boolean {
    if (this.playbackStatus === 'playing') {
      return this.pause();
    } else if (this.playbackStatus === 'paused') {
      return this.resume();
    }
    return false;
  }

  /**
   * Get current playback progress.
   * Returns position in seconds and total duration.
   */
  getPlaybackProgress(): { position: number; duration: number; percentage: number } | null {
    if (!this.currentAudioPath || this.currentAudioDuration === 0) {
      return null;
    }

    let position = this.pausedAtPosition;
    if (this.playbackStatus === 'playing') {
      position += (Date.now() - this.playbackStartTime) / 1000;
    }

    // Clamp position to duration
    position = Math.min(position, this.currentAudioDuration);
    const percentage = (position / this.currentAudioDuration) * 100;

    return { position, duration: this.currentAudioDuration, percentage };
  }

  /**
   * Get audio file duration using afinfo.
   */
  private async getAudioDuration(audioPath: string): Promise<number> {
    return new Promise((resolve) => {
      const process = spawn('afinfo', ['-b', audioPath]);
      let output = '';

      process.stdout.on('data', (data: Buffer) => {
        output += data.toString();
      });

      process.on('close', () => {
        // afinfo -b outputs: duration, format, channels, bits, sample rate
        // First value is duration in seconds
        const parts = output.trim().split(/\s+/);
        const duration = parseFloat(parts[0]) || 0;
        resolve(duration);
      });

      process.on('error', () => {
        resolve(0);
      });
    });
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
    } else if (engine === 'elevenlabs') {
      if (!this.elevenlabsEngine.isConfigured()) {
        throw new Error('ElevenLabs API key not configured');
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

  // ===========================================================================
  // ElevenLabs Methods
  // ===========================================================================

  /**
   * Set ElevenLabs API key.
   */
  async setElevenlabsApiKey(apiKey: string): Promise<void> {
    this.elevenlabsEngine.configure(
      apiKey,
      this.narrationPrefs.elevenlabsVoiceId,
      this.narrationPrefs.elevenlabsModelId
    );
    this.narrationPrefs.elevenlabsApiKey = apiKey;
    await this.saveNarrationPrefs();
    console.log('[NarrationManager] ElevenLabs API key configured');
  }

  /**
   * Set ElevenLabs voice.
   */
  async setElevenlabsVoice(voiceId: string): Promise<void> {
    this.elevenlabsEngine.setVoiceId(voiceId);
    this.narrationPrefs.elevenlabsVoiceId = voiceId;
    await this.saveNarrationPrefs();
    console.log(`[NarrationManager] ElevenLabs voice set to: ${voiceId}`);
  }

  /**
   * Test ElevenLabs voice.
   */
  async testElevenlabsVoice(): Promise<void> {
    console.log('[NarrationManager] Testing ElevenLabs voice...');

    if (!this.elevenlabsEngine.isConfigured()) {
      throw new Error('ElevenLabs API key not configured');
    }

    // Stop any current playback
    this.stop();

    try {
      const cacheDir = this.cache.getCacheDir();
      const result = await this.elevenlabsEngine.testVoice(cacheDir);
      console.log(`[NarrationManager] Test audio generated: ${result.audioPath}`);

      // Play the test audio
      this.playbackStatus = 'playing';
      await this.playAudio(result.audioPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[NarrationManager] ElevenLabs test failed:', message);
      throw error;
    }
  }

  /**
   * Get available ElevenLabs voices.
   */
  async getElevenlabsVoices(): Promise<ElevenLabsVoiceInfo[]> {
    if (!this.elevenlabsEngine.isConfigured()) {
      throw new Error('ElevenLabs API key not configured');
    }
    return this.elevenlabsEngine.getVoices();
  }

  /**
   * Check ElevenLabs connection.
   */
  async checkElevenlabsConnection(): Promise<{ connected: boolean; error?: string }> {
    return this.elevenlabsEngine.checkConnection();
  }

  /**
   * Get predefined Librarian voices for ElevenLabs.
   * These are curated voices with optimized speed settings.
   */
  getLibrarianVoices(): ElevenLabsVoice[] {
    return ELEVENLABS_LIBRARIAN_VOICES;
  }

  /**
   * Get the currently selected ElevenLabs voice ID.
   */
  getCurrentVoiceId(): string {
    return this.narrationPrefs.elevenlabsVoiceId || this.elevenlabsEngine.getVoiceId();
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

    // Try ElevenLabs if it's preferred
    if (this.preferredEngine === 'elevenlabs') {
      try {
        if (this.elevenlabsEngine.isConfigured()) {
          const outputPath = this.cache.generateAudioPath(contentHash, 'elevenlabs');
          result = await this.elevenlabsEngine.synthesize(text, outputPath, profile);
          engine = 'elevenlabs';
        } else {
          console.warn('[NarrationManager] ElevenLabs not configured, falling back to macOS say');
          actualContentHash = this.cache.generateContentHash(text, profile, LIBRARIAN_V1_PARAMS, 'macos_say');
          const outputPath = this.cache.generateAudioPath(actualContentHash, 'macos_say');
          result = await this.macosEngine.synthesize(text, outputPath, profile);
          engine = 'macos_say';
        }
      } catch (error) {
        // Silent fallback to macOS say on ElevenLabs failure
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[NarrationManager] ElevenLabs failed (${message}), falling back to macOS say`);
        actualContentHash = this.cache.generateContentHash(text, profile, LIBRARIAN_V1_PARAMS, 'macos_say');
        const outputPath = this.cache.generateAudioPath(actualContentHash, 'macos_say');
        result = await this.macosEngine.synthesize(text, outputPath, profile);
        engine = 'macos_say';
      }
    }
    // Try Chatterbox if it's preferred
    else if (this.preferredEngine === 'chatterbox') {
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

    // Get audio duration for progress tracking
    this.currentAudioPath = audioPath;
    this.currentAudioDuration = await this.getAudioDuration(audioPath);
    this.playbackStartTime = Date.now();
    this.pausedAtPosition = 0;

    console.log(`[NarrationManager] Playing audio (${this.currentAudioDuration.toFixed(1)}s): ${audioPath}`);

    this.playbackStatus = 'playing';
    this.emit('playbackStarted', this.currentReadingPath!, this.currentAudioDuration);

    return new Promise((resolve, reject) => {
      this.macosEngine.play(audioPath).then((process) => {
        this.currentPlayProcess = process;

        process.on('close', (code) => {
          this.currentPlayProcess = null;
          this.playbackStatus = 'idle';
          const readingPath = this.currentReadingPath;
          this.currentReadingPath = null;

          // Reset progress tracking
          this.currentAudioPath = null;
          this.currentAudioDuration = 0;
          this.playbackStartTime = 0;
          this.pausedAtPosition = 0;

          if (code === 0) {
            this.emit('playbackStopped', readingPath);
            resolve();
          } else if (code === null) {
            // Killed intentionally (stop or pause)
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

  // ===========================================================================
  // Text Chunking for Long Content
  // ===========================================================================

  /**
   * Split text into chunks for sequential synthesis.
   * Splits on paragraph breaks, with fallback to sentences for single long paragraphs.
   */
  private splitIntoChunks(text: string): string[] {
    // Split on double newlines (paragraphs)
    let chunks = text.split(/\n\n+/).map(p => p.trim()).filter(p => p.length > 0);

    // If only one chunk and it's very long, split on sentences
    if (chunks.length === 1 && chunks[0].length > CHUNK_MAX_LENGTH) {
      chunks = this.splitOnSentences(chunks[0]);
    }

    // Merge very short chunks with the next one
    chunks = this.mergeTinyChunks(chunks);

    return chunks;
  }

  /**
   * Split text on sentence boundaries for very long paragraphs.
   */
  private splitOnSentences(text: string): string[] {
    // Split on sentence-ending punctuation followed by space
    const sentences = text.split(/(?<=[.!?])\s+/);
    const chunks: string[] = [];
    let currentChunk = '';

    for (const sentence of sentences) {
      if (currentChunk.length + sentence.length > CHUNK_MAX_LENGTH && currentChunk.length > 0) {
        chunks.push(currentChunk.trim());
        currentChunk = sentence;
      } else {
        currentChunk += (currentChunk ? ' ' : '') + sentence;
      }
    }

    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }

    return chunks;
  }

  /**
   * Merge very short chunks with the following chunk.
   */
  private mergeTinyChunks(chunks: string[]): string[] {
    const merged: string[] = [];
    let carry = '';

    for (const chunk of chunks) {
      if (carry) {
        merged.push(carry + '\n\n' + chunk);
        carry = '';
      } else if (chunk.length < CHUNK_MIN_LENGTH && merged.length > 0) {
        // Merge with previous if possible
        merged[merged.length - 1] += '\n\n' + chunk;
      } else if (chunk.length < CHUNK_MIN_LENGTH) {
        // Carry forward to merge with next
        carry = chunk;
      } else {
        merged.push(chunk);
      }
    }

    // Don't lose any carried text
    if (carry) {
      if (merged.length > 0) {
        merged[merged.length - 1] += '\n\n' + carry;
      } else {
        merged.push(carry);
      }
    }

    return merged;
  }

  /**
   * Synthesize a single chunk to a temp file.
   */
  private async synthesizeChunk(
    text: string,
    chunkIndex: number,
    profile: NarrationProfile
  ): Promise<NarrateResult> {
    // Generate temp path for this chunk
    const chunkPath = path.join(
      os.tmpdir(),
      `chatterbox-chunk-${chunkIndex}-${Date.now()}.wav`
    );

    console.log(`[NarrationManager] Synthesizing chunk ${chunkIndex + 1} (${text.length} chars)...`);

    // Use Chatterbox directly for chunks (no fallback mid-reading)
    const result = await this.chatterboxEngine.synthesize(
      text,
      chunkPath,
      profile,
      LIBRARIAN_V1_PARAMS
    );

    return result;
  }

  /**
   * Synthesize and play text in chunks with lookahead.
   * Starts synthesizing next chunk while current one plays for continuous audio.
   */
  private async synthesizeAndPlayChunked(
    chunks: string[],
    profile: NarrationProfile
  ): Promise<void> {
    this.pendingChunks = [...chunks];
    this.currentChunkIndex = 0;
    this.chunkCancelled = false;

    console.log(`[NarrationManager] Starting chunked playback: ${chunks.length} chunks`);

    try {
      // Synthesize first chunk upfront
      let nextAudio = await this.synthesizeChunk(chunks[0], 0, profile);

      for (let i = 0; i < chunks.length; i++) {
        // Check if cancelled
        if (this.chunkCancelled || this.playbackStatus === 'stopped') {
          console.log('[NarrationManager] Chunked playback cancelled');
          break;
        }

        this.currentChunkIndex = i;
        const currentAudio = nextAudio;

        // Start synthesizing next chunk in background (if there is one)
        this.pendingSynthesis = null;
        if (i + 1 < chunks.length) {
          this.pendingSynthesis = this.synthesizeChunk(chunks[i + 1], i + 1, profile);
        }

        // Play current chunk
        console.log(`[NarrationManager] Playing chunk ${i + 1}/${chunks.length}`);
        this.playbackStatus = 'playing';
        await this.playAudio(currentAudio.audioPath);

        // Clean up temp file
        try {
          await fs.unlink(currentAudio.audioPath);
        } catch {
          // Ignore cleanup errors
        }

        // Wait for next chunk to be ready (should already be done if synthesis < playback)
        if (this.pendingSynthesis && !this.chunkCancelled) {
          nextAudio = await this.pendingSynthesis;
        }
      }

      console.log('[NarrationManager] Chunked playback complete');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[NarrationManager] Chunked synthesis error:', message);
      await this.handleSynthesisError(new Error(message));
      throw error;
    } finally {
      this.pendingChunks = [];
      this.pendingSynthesis = null;
    }
  }

  /**
   * Handle synthesis error by playing error audio.
   * Maintains Librarian immersion even during errors.
   */
  private async handleSynthesisError(error: Error): Promise<void> {
    console.error('[NarrationManager] Synthesis error:', error.message);

    // Try to play error audio to maintain immersion
    try {
      const errorAudioPath = app.isPackaged
        ? path.join(process.resourcesPath, 'sounds', 'librarian-error.wav')
        : path.join(__dirname, '..', '..', 'public', 'sounds', 'librarian-error.wav');

      // Check if error audio exists
      await fs.access(errorAudioPath);
      await this.playAudio(errorAudioPath);
    } catch {
      // Silent fail if error audio not available
      console.warn('[NarrationManager] Error audio not available');
    }

    this.emit('playbackError', error.message, this.currentReadingPath);
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
