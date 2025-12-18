import { app } from 'electron';
import path from 'path';
import { exec } from 'child_process';
import { PreferencesManager } from './preferences';

export const AVAILABLE_SOUNDS = {
  clicks: [
    { id: 'ButtonClickDown.mp3', name: 'Button Click Down' },
    { id: 'ButtonClickUp.mp3', name: 'Button Click Up' },
    { id: 'Click.mp3', name: 'Click' },
    { id: 'Click.mp3', name: 'Click (Original)' },
    { id: 'PhotoShutter.mp3', name: 'Photo Shutter' },
    { id: 'Beep.mp3', name: 'Beep' },
    { id: 'Thump.mp3', name: 'Thump' },
  ],
  
  ui: [
    { id: 'MenuOpen.mp3', name: 'Menu Open' },
    { id: 'MenuClose.mp3', name: 'Menu Close' },
    { id: 'WindowOpen.mp3', name: 'Window Open' },
    { id: 'WindowClose.mp3', name: 'Window Close' },
    { id: 'Beep.mp3', name: 'Tab (Original)' },
  ],
  
  alerts: [
    { id: 'AlertBonk.mp3', name: 'Bonk' },
    { id: 'AlertIndigo.mp3', name: 'Indigo' },
    { id: 'AlertQuack.mp3', name: 'Quack' },
    { id: 'AlertSosumi.mp3', name: 'Sosumi' },
    { id: 'AlertBonk.mp3', name: 'Error (Original)' },
  ],
  
  success: [
    { id: 'EmailMailSent.mp3', name: 'Mail Sent' },
  ],
} as const;

export function getAllSounds(): Array<{ id: string; name: string; category: string }> {
  const result: Array<{ id: string; name: string; category: string }> = [];
  
  for (const [category, sounds] of Object.entries(AVAILABLE_SOUNDS)) {
    for (const sound of sounds) {
      result.push({ ...sound, category });
    }
  }
  
  return result;
}

export type SoundEvent = 'recordingStart' | 'recordingStop' | 'recordingCancel' | 'windowOpen' | 'windowClose' | 'transcribing' | 'paste';

export class SoundManager {
  private preferences: PreferencesManager;
  
  constructor(preferences: PreferencesManager) {
    this.preferences = preferences;
  }
  
  private playFile(soundFile: string): void {
    if (!soundFile) return;
    
    const soundPath = app.isPackaged
      ? path.join(process.resourcesPath, 'sounds', soundFile)
      : path.join(__dirname, '../../public/sounds', soundFile);
    
    exec(`afplay "${soundPath}"`, (error) => {
      if (error) {
        console.warn(`[SoundManager] Failed to play sound ${soundFile}:`, error.message);
      }
    });
  }
  
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
      case 'transcribing':
        soundFile = this.preferences.getPreference('transcribingSound');
        break;
      case 'paste':
        soundFile = this.preferences.getPreference('pasteSound');
        break;
    }
    
    if (soundFile) {
      this.playFile(soundFile);
    }
  }
  
  isEnabled(): boolean {
    return this.preferences.getPreference('soundsEnabled') ?? true;
  }
  
  getConfig(): {
    enabled: boolean;
    recordingStart: string | undefined;
    recordingStop: string | undefined;
    recordingCancel: string | undefined;
    windowOpen: string | undefined;
    windowClose: string | undefined;
    transcribing: string | undefined;
    paste: string | undefined;
  } {
    return {
      enabled: this.preferences.getPreference('soundsEnabled') ?? true,
      recordingStart: this.preferences.getPreference('recordingStartSound'),
      recordingStop: this.preferences.getPreference('recordingStopSound'),
      recordingCancel: this.preferences.getPreference('recordingCancelSound'),
      windowOpen: this.preferences.getPreference('windowOpenSound'),
      windowClose: this.preferences.getPreference('windowCloseSound'),
      transcribing: this.preferences.getPreference('transcribingSound'),
      paste: this.preferences.getPreference('pasteSound'),
    };
  }
  
  async setConfig(config: {
    enabled?: boolean;
    recordingStart?: string;
    recordingStop?: string;
    recordingCancel?: string;
    windowOpen?: string;
    windowClose?: string;
    transcribing?: string;
    paste?: string;
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
    if (config.transcribing !== undefined) {
      updates.transcribingSound = config.transcribing;
    }
    if (config.paste !== undefined) {
      updates.pasteSound = config.paste;
    }
    
    await this.preferences.save(updates);
  }
  
  preview(soundFile: string): void {
    this.playFile(soundFile);
  }
}
