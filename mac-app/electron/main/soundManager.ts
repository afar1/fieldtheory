import { app } from 'electron';
import path from 'path';
import { exec } from 'child_process';
import { PreferencesManager } from './preferences';
import { NativeHelper } from './nativeHelper';
import { createLogger } from './logger';

const log = createLogger('Sound');

/**
 * Available sound options that users can choose from.
 * Each category has different sounds suited for that action type.
 */
export const AVAILABLE_SOUNDS = {
  // Click sounds - good for start/stop recording
  clicks: [
    { id: 'ButtonClickDown.mp3', name: 'Button Click Down' },
    { id: 'ButtonClickUp.mp3', name: 'Button Click Up' },
    { id: 'Click.mp3', name: 'Click' },
    { id: 'click.wav', name: 'Click (Original)' },
    { id: 'PhotoShutter.mp3', name: 'Photo Shutter' },
    { id: 'Beep.mp3', name: 'Beep' },
    { id: 'Thump.mp3', name: 'Thump' },
  ],
  
  // UI sounds - good for window/menu actions
  ui: [
    { id: 'MenuOpen.mp3', name: 'Menu Open' },
    { id: 'MenuClose.mp3', name: 'Menu Close' },
    { id: 'WindowOpen.mp3', name: 'Window Open' },
    { id: 'WindowClose.mp3', name: 'Window Close' },
    { id: 'tab.wav', name: 'Tab (Original)' },
  ],
  
  // Alert sounds - good for errors/cancellations
  alerts: [
    { id: 'AlertBonk.mp3', name: 'Bonk' },
    { id: 'AlertIndigo.mp3', name: 'Indigo' },
    { id: 'AlertQuack.mp3', name: 'Quack' },
    { id: 'AlertSosumi.mp3', name: 'Sosumi' },
    { id: 'error.wav', name: 'Error (Original)' },
  ],
  
  // Success sounds - good for completion
  success: [
    { id: 'EmailMailSent.mp3', name: 'Mail Sent' },
  ],

  // Discovery sounds - for artifacts/readings
  discovery: [
    { id: 'ArtifactDiscovery.wav', name: 'Artifact Discovery' },
  ],
} as const;

/**
 * Get all available sounds as a flat list with categories.
 */
export function getAllSounds(): Array<{ id: string; name: string; category: string }> {
  const result: Array<{ id: string; name: string; category: string }> = [];
  
  for (const [category, sounds] of Object.entries(AVAILABLE_SOUNDS)) {
    for (const sound of sounds) {
      result.push({ ...sound, category });
    }
  }
  
  return result;
}

/**
 * Sound event types that the app can trigger.
 */
export type SoundEvent = 'recordingStart' | 'recordingStop' | 'recordingCancel' | 'windowOpen' | 'windowClose' | 'paste' | 'transcribing' | 'artifactDiscovery';

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
   * Preload all available sounds for instant playback.
   * Call once at app startup after NativeHelper is ready.
   */
  async preloadAllSounds(): Promise<void> {
    if (!this.nativeHelper) {
      return;
    }

    const allSounds = getAllSounds();
    const soundPaths = allSounds.map(s => path.join(this.soundsDir, s.id));

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
      exec(`afplay "${soundPath}"`, () => {
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
      const soundFile = this.preferences.getPreference('artifactDiscoverySound') ?? 'ArtifactDiscovery.wav';
      if (soundFile) this.playFile(soundFile);
      return;
    }

    // Other sounds use soundsEnabled toggle
    const soundsEnabled = this.preferences.getPreference('soundsEnabled') ?? false;
    if (!soundsEnabled) return;

    let soundFile: string | undefined;

    switch (event) {
      case 'recordingStart':
        soundFile = this.preferences.getPreference('recordingStartSound');
        break;
      case 'recordingStop':
        soundFile = this.preferences.getPreference('recordingStopSound');
        break;
      case 'recordingCancel':
        soundFile = this.preferences.getPreference('recordingCancelSound');
        break;
      case 'windowOpen':
        soundFile = this.preferences.getPreference('windowOpenSound');
        break;
      case 'windowClose':
        soundFile = this.preferences.getPreference('windowCloseSound');
        break;
      case 'paste':
        soundFile = this.preferences.getPreference('pasteSound');
        break;
      case 'transcribing':
        soundFile = this.preferences.getPreference('transcribingSound');
        break;
    }

    if (soundFile) {
      this.playFile(soundFile);
    }
  }
  
  /**
   * Check if sounds are currently enabled.
   */
  isEnabled(): boolean {
    return this.preferences.getPreference('soundsEnabled') ?? true;
  }
  
  /**
   * Get the current sound configuration.
   */
  getConfig(): {
    enabled: boolean;
    librarianEnabled: boolean;
    recordingStart: string | undefined;
    recordingStop: string | undefined;
    recordingCancel: string | undefined;
    windowOpen: string | undefined;
    windowClose: string | undefined;
    paste: string | undefined;
    transcribing: string | undefined;
  } {
    return {
      enabled: this.preferences.getPreference('soundsEnabled') ?? false,
      librarianEnabled: this.preferences.getPreference('librarianSoundEnabled') ?? true,
      recordingStart: this.preferences.getPreference('recordingStartSound'),
      recordingStop: this.preferences.getPreference('recordingStopSound'),
      recordingCancel: this.preferences.getPreference('recordingCancelSound'),
      windowOpen: this.preferences.getPreference('windowOpenSound'),
      windowClose: this.preferences.getPreference('windowCloseSound'),
      paste: this.preferences.getPreference('pasteSound'),
      transcribing: this.preferences.getPreference('transcribingSound'),
    };
  }
  
  /**
   * Update sound settings.
   */
  async setConfig(config: {
    enabled?: boolean;
    librarianEnabled?: boolean;
    recordingStart?: string;
    recordingStop?: string;
    recordingCancel?: string;
    windowOpen?: string;
    windowClose?: string;
    paste?: string;
    transcribing?: string;
  }): Promise<void> {
    const updates: Record<string, unknown> = {};

    if (config.enabled !== undefined) {
      updates.soundsEnabled = config.enabled;
    }
    if (config.librarianEnabled !== undefined) {
      updates.librarianSoundEnabled = config.librarianEnabled;
    }
    if (config.recordingStart !== undefined) {
      updates.recordingStartSound = config.recordingStart;
    }
    if (config.recordingStop !== undefined) {
      updates.recordingStopSound = config.recordingStop;
    }
    if (config.recordingCancel !== undefined) {
      updates.recordingCancelSound = config.recordingCancel;
    }
    if (config.windowOpen !== undefined) {
      updates.windowOpenSound = config.windowOpen;
    }
    if (config.windowClose !== undefined) {
      updates.windowCloseSound = config.windowClose;
    }
    if (config.paste !== undefined) {
      updates.pasteSound = config.paste;
    }
    if (config.transcribing !== undefined) {
      updates.transcribingSound = config.transcribing;
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
