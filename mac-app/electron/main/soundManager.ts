import { app } from 'electron';
import path from 'path';
import { execFile } from 'child_process';
import { PreferencesManager } from './preferences';
import { NativeHelper } from './nativeHelper';

/**
 * Sound event types that the app can trigger.
 */
export type SoundEvent = 'recordingStart' | 'recordingStop' | 'recordingCancel' | 'windowOpen' | 'windowClose' | 'paste' | 'transcribing' | 'artifactDiscovery';

/**
 * Default sound files for each event type.
 */
const DEFAULT_SOUNDS: Record<SoundEvent, string> = {
  recordingStart: 'ButtonClickDown.mp3',
  recordingStop: 'ButtonClickUp.mp3',
  recordingCancel: 'AlertBonk.mp3',
  windowOpen: 'WindowOpen.mp3',
  windowClose: 'WindowClose.mp3',
  paste: 'Click.mp3',
  transcribing: 'Click.mp3',
  artifactDiscovery: 'ArtifactDiscovery.wav',
};

/**
 * SoundManager handles playing UI sounds based on user preferences.
 * Uses NSSound via native helper for instant playback (~1-5ms).
 * Falls back to afplay if native helper is unavailable.
 */
export class SoundManager {
  private preferences: PreferencesManager;
  private nativeHelper: NativeHelper | null = null;
  private soundsDir: string;

  constructor(preferences: PreferencesManager) {
    this.preferences = preferences;
    this.soundsDir = app.isPackaged
      ? path.join(process.resourcesPath, 'sounds')
      : path.join(__dirname, '../../public/sounds');
  }

  /**
   * Set the native helper for fast sound playback.
   * Must be called after NativeHelper is started.
   */
  setNativeHelper(helper: NativeHelper): void {
    this.nativeHelper = helper;
  }

  /**
   * Preload all default sounds for instant playback.
   * Call once at app startup after NativeHelper is ready.
   */
  async preloadAllSounds(): Promise<void> {
    if (!this.nativeHelper) {
      return;
    }

    const uniqueSounds = [...new Set(Object.values(DEFAULT_SOUNDS))];
    const soundPaths = uniqueSounds.map(s => path.join(this.soundsDir, s));

    await this.nativeHelper.preloadSounds(soundPaths);
  }

  /**
   * Play a sound file by name.
   * Uses native helper for instant playback if available.
   * Falls back to afplay if native helper is unavailable.
   */
  private playFile(soundFile: string): void {
    if (!soundFile) return;

    const soundPath = path.join(this.soundsDir, soundFile);

    if (this.nativeHelper) {
      // Fast path: native NSSound playback (~1-5ms)
      this.nativeHelper.playSound(soundPath);
    } else {
      // Fallback: exec afplay (slower, ~50-100ms)
      execFile('afplay', [soundPath], () => {
        // Ignore errors - sound playback is non-critical
      });
    }
  }

  /**
   * Play a sound for a given event type, if sounds are enabled.
   * Librarian sound (artifactDiscovery) has its own toggle, separate from other sounds.
   */
  play(event: SoundEvent): void {
    // Librarian sound has its own toggle
    if (event === 'artifactDiscovery') {
      const librarianSoundEnabled = this.preferences.getPreference('librarianSoundEnabled') ?? true;
      if (!librarianSoundEnabled) return;
      this.playFile(DEFAULT_SOUNDS.artifactDiscovery);
      return;
    }

    // Other sounds use soundsEnabled toggle
    const soundsEnabled = this.preferences.getPreference('soundsEnabled') ?? false;
    if (!soundsEnabled) return;

    const soundFile = DEFAULT_SOUNDS[event];
    if (soundFile) {
      this.playFile(soundFile);
    }
  }

  /**
   * Check if sounds are currently enabled.
   */
  isEnabled(): boolean {
    return this.preferences.getPreference('soundsEnabled') ?? false;
  }

  /**
   * Get the current sound configuration.
   */
  getConfig(): {
    enabled: boolean;
    librarianEnabled: boolean;
  } {
    return {
      enabled: this.preferences.getPreference('soundsEnabled') ?? false,
      librarianEnabled: this.preferences.getPreference('librarianSoundEnabled') ?? true,
    };
  }

  /**
   * Update sound settings.
   */
  async setConfig(config: {
    enabled?: boolean;
    librarianEnabled?: boolean;
  }): Promise<void> {
    const updates: Record<string, unknown> = {};

    if (config.enabled !== undefined) {
      updates.soundsEnabled = config.enabled;
    }
    if (config.librarianEnabled !== undefined) {
      updates.librarianSoundEnabled = config.librarianEnabled;
    }

    await this.preferences.save(updates);
  }

  /**
   * Preview a sound without affecting settings.
   */
  preview(soundFile: string): void {
    this.playFile(soundFile);
  }
}
