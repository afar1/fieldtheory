import { app } from 'electron';
import path from 'path';
import { exec } from 'child_process';
import { PreferencesManager } from './preferences';

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
 * Uses afplay on macOS for async sound playback.
 */
export class SoundManager {
  private preferences: PreferencesManager;
  
  constructor(preferences: PreferencesManager) {
    this.preferences = preferences;
  }
  
  /**
   * Play a sound file by name.
   * Looks in the public/sounds directory (or resources in packaged app).
   */
  private playFile(soundFile: string): void {
    if (!soundFile) return;
    
    const soundPath = app.isPackaged
      ? path.join(process.resourcesPath, 'sounds', soundFile)
      : path.join(__dirname, '../../public/sounds', soundFile);
    
    // Use afplay on macOS to play the sound asynchronously.
    exec(`afplay "${soundPath}"`, (error) => {
      if (error) {
        console.warn(`[SoundManager] Failed to play sound ${soundFile}:`, error.message);
      }
    });
  }
  
  /**
   * Play a sound for a given event type, if sounds are enabled.
   */
  play(event: SoundEvent): void {
    const soundsEnabled = this.preferences.getPreference('soundsEnabled') ?? true;
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
      case 'artifactDiscovery':
        soundFile = this.preferences.getPreference('artifactDiscoverySound') ?? 'ArtifactDiscovery.wav';
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
    recordingStart: string | undefined;
    recordingStop: string | undefined;
    recordingCancel: string | undefined;
    windowOpen: string | undefined;
    windowClose: string | undefined;
    paste: string | undefined;
    transcribing: string | undefined;
  } {
    return {
      enabled: this.preferences.getPreference('soundsEnabled') ?? true,
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
    console.log('[SoundManager] Sound settings updated:', updates);
  }
  
  /**
   * Preview a sound without affecting settings.
   */
  preview(soundFile: string): void {
    this.playFile(soundFile);
  }
}
