import { EventEmitter } from 'events';
import { app, globalShortcut, clipboard, nativeImage, Notification } from 'electron';
import { getHotkeyManager } from './hotkeyManager';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import crypto from 'crypto';
import { NativeHelper } from './nativeHelper';
import { ModelManager, ModelSize } from './modelManager';
import { PreferencesManager } from './preferences';
import { RecordingOverlay } from './recordingOverlay';
import { ClipboardManager, ClipboardItem, isTerminalApp, isIDEWithTerminal } from './clipboardManager';
import { SoundManager } from './soundManager';
import { QuotaManager } from './quotaManager';
import { AudioManager } from './audioManager';
import { CursorStatusManager } from './cursorStatusManager';
import { improveTranscript } from './promptEngineer';
import { CommandsManager } from './commandsManager';
import { MESSAGES } from './messages';
import * as plist from 'plist';
import { createLogger } from './logger';

const log = createLogger('Transcriber');

// Feature flag for live transcript improvement.
// When enabled, users can trigger AI improvement by ending recording with a different hotkey than started.
const FEATURE_IMPROVE_ENABLED = true;

const execAsync = promisify(exec);

/**
 * Transcription status states.
 */
export type TranscriptionStatus = 'idle' | 'silentStacking' | 'recording' | 'transcribing';

/**
 * Events emitted by TranscriberManager.
 */
export interface TranscriberEvents {
  statusChanged: (status: TranscriptionStatus) => void;
  result: (text: string) => void;
  error: (error: Error) => void;
  stackChanged: (count: number) => void;
  stackingDisabled: (data: { itemId: number; message: string }) => void;
}

/**
 * Manages push-to-talk transcription using whisper-cli.
 * Handles hotkey registration, recording, transcription, and text insertion.
 * Integrates with clipboard history for prompt stacking.
 */
export class TranscriberManager extends EventEmitter {
  private nativeHelper: NativeHelper;
  private modelManager: ModelManager;
  private preferences: PreferencesManager;
  private soundManager: SoundManager;
  private overlay: RecordingOverlay;
  private clipboardManager: ClipboardManager | null = null;
  private status: TranscriptionStatus = 'idle';
  private hotkey: string = 'Command+\\'; // Command+Backslash on macOS
  private registeredHotkey: string | null = null; // Track currently registered transcription hotkey
  private secondaryHotkey: string | null = null; // Optional secondary hotkey for transcription
  private registeredSecondaryHotkey: string | null = null; // Track currently registered secondary hotkey
  private whisperProcess: ChildProcess | null = null;
  private qwenProcess: ChildProcess | null = null;
  private qwenReady: boolean = false;
  private qwenReadyPromise: Promise<void> | null = null;
  private qwenPendingResolve: ((response: { ok: boolean; text?: string; error?: string }) => void) | null = null;
  private qwenStarting: boolean = false;
  private abandonHotkeyRegistered: boolean = false;
  private registeredAbandonHotkey: string = 'Escape'; // Track currently registered abandon hotkey
  
  // Current stack of items (transcriptions + screenshots) during a recording session.
  // Used for auto-stacking: if screenshots are taken during recording, they get
  // grouped with the transcript into a stack when recording ends.
  private currentStack: number[] = [];
  private lastTranscription: string = '';
  
  // Screenshot metadata for figure labeling feature.
  // Tracks when each screenshot was captured relative to recording start,
  // and assigns figure labels (A, B, C...) for referencing in transcripts.
  // figureId is a unique 5-char alphanumeric ID for searchability across all recordings.
  private screenshotMetadata: Array<{
    itemId: number;
    figureLabel: string;
    figureId: string;
    capturedAtMs: number; // Timestamp relative to recording start
  }> = [];

  // Portable commands detected in the current transcription.
  // Tracks command names and file paths for terminal formatting.
  private detectedCommands: Array<{
    name: string;
    filePath: string;
  }> = [];
  
  // Clipboard history visibility checker - allows escape key to dismiss clipboard history first
  private clipboardHistoryVisibilityChecker: (() => boolean) | null = null;
  
  // Sketch mode checker - used to skip auto-paste when draw canvas is open
  private sketchModeChecker: (() => boolean) | null = null;
  
  // Track if audio content has been recorded (non-silence detected).
  // Used to determine whether to show confirmation on abandon.
  private hasAudioContent: boolean = false;
  private audioLevelThreshold: number = 0.02; // Minimum level to consider as "content"
  
  // Confirmation state for abandoning recording
  private pendingAbandonConfirmation: boolean = false;
  
  // Quota tracking for priority mic and auto-stacking.
  private quotaManager: QuotaManager | null = null;
  private audioManager: AudioManager | null = null;
  private cursorStatusManager: CursorStatusManager | null = null;
  private commandsManager: CommandsManager | null = null;
  private squaresManager: any | null = null;  // SquaresManager for voice-triggered window management
  private accessTokenGetter: (() => string | undefined) | null = null;
  private hasShownQuotaMessageThisPeriod: boolean = false;
  private recordingStartTime: number = 0;
  private skipNextPasteFailedNotification: boolean = false;
  private priorityMicSkippedForQuota: boolean = false; // True when quota exhausted, skip tracking
  private autoStackLimitShownThisSession: boolean = false; // Only show limit message once per session

  // GPU fallback: if whisper-cli crashes due to Metal shader compilation failure,
  // disable GPU and retry with CPU-only mode for the rest of the session.
  private gpuDisabled: boolean = false;
  
  // Track which hotkey started recording for cross-hotkey improvement trigger.
  // If user starts with primary and ends with secondary (or vice versa), trigger improvement.
  private startedWithSecondaryHotkey: boolean = false;

  // Double-tap detection for silent stacking mode.
  // When user double-taps the hotkey, enters silentStacking instead of recording.
  private doubleTapThresholdMs: number = 300;
  private pendingHotkeyTimer: NodeJS.Timeout | null = null;
  private pendingHotkeyIsSecondary: boolean = false;

  // Hot Mic delegation — when Hot Mic is active, hotkey presses are delegated to it.
  private hotMicDelegate: {
    isActive: boolean;
    handleShortPress: () => Promise<void>;
    yieldToTranscriber: () => Promise<void>;
    resumeAfterTranscriber: () => Promise<void>;
  } | null = null;

  constructor(nativeHelper: NativeHelper, preferences: PreferencesManager, clipboardManager?: ClipboardManager, quotaManager?: QuotaManager, audioManager?: AudioManager, cursorStatusManager?: CursorStatusManager, commandsManager?: CommandsManager) {
    super();
    this.nativeHelper = nativeHelper;
    this.preferences = preferences;
    this.clipboardManager = clipboardManager || null;
    this.quotaManager = quotaManager || null;
    this.audioManager = audioManager || null;
    this.cursorStatusManager = cursorStatusManager || null;
    this.commandsManager = commandsManager || null;
    // ModelManager will be initialized with selected model in init()
    this.modelManager = new ModelManager();
    this.overlay = new RecordingOverlay();
    this.soundManager = new SoundManager(preferences);
    
    // Listen for screenshot events to pause/resume abandon hotkey.
    // This allows Escape to cancel screenshot selection instead of recording.
    if (this.clipboardManager) {
      this.clipboardManager.on('screenshotStart', () => {
        this.pauseAbandonHotkey();
      });
      this.clipboardManager.on('screenshotEnd', () => {
        this.resumeAbandonHotkey();
      });
    }
    
    // Listen for audio levels from native helper.
    // Track if we've detected any significant audio content.
    this.nativeHelper.on('audioLevel', (level: number) => {
      if (this.status === 'recording') {
        this.overlay.updateAudioLevel(level);
        // Check if this level indicates actual audio content.
        if (level > this.audioLevelThreshold) {
          this.hasAudioContent = true;
        }
      }
    });
    
    // Listen for confirmation responses from overlay.
    this.overlay.on('abandon-confirmed', () => {
      this.handleConfirmationResponse(true);
    });
    
    this.overlay.on('abandon-cancelled', () => {
      this.handleConfirmationResponse(false);
    });
  }
  
  /**
   * Handle confirmation response (from overlay or cursorStatusManager).
   * @param abandon - true to abandon recording/silentStacking, false to continue
   */
  handleConfirmationResponse(abandon: boolean): void {
    if (!this.pendingAbandonConfirmation) return;

    this.pendingAbandonConfirmation = false;
    this.overlay.hideConfirmation();
    this.emit('confirmation-hide');

    if (abandon) {
      if (this.status === 'silentStacking') {
        this.cancelSilentStacking();
      } else {
        this.cancelRecording();
      }
    } else {
      // Not abandoning - restore cursor indicator to current state.
      if (this.status === 'silentStacking') {
        this.cursorStatusManager?.setState('silentStacking');
      } else if (this.status === 'recording') {
        this.cursorStatusManager?.setState('recording');
      }
    }
  }

  /**
   * Check if the recording overlay is currently visible.
   * Used to prevent hiding the overlay when closing other windows.
   */
  isRecordingOverlayVisible(): boolean {
    return this.overlay.isVisible();
  }

  /**
   * Set a callback to check if clipboard history window is visible.
   * Used for escape key priority: dismiss clipboard history before canceling recording.
   */
  setClipboardHistoryVisibilityChecker(checker: () => boolean): void {
    this.clipboardHistoryVisibilityChecker = checker;
  }

  setSketchModeChecker(checker: () => boolean): void {
    this.sketchModeChecker = checker;
  }

  /**
   * Set the Hot Mic delegate for hotkey delegation.
   * When Hot Mic is active, hotkey presses are forwarded to it instead of starting normal recording.
   */
  setHotMicDelegate(delegate: { isActive: boolean; handleShortPress: () => Promise<void>; yieldToTranscriber: () => Promise<void>; resumeAfterTranscriber: () => Promise<void> }): void {
    this.hotMicDelegate = delegate;
  }

  /**
   * Set the commands manager for portable commands feature.
   */
  setCommandsManager(manager: CommandsManager): void {
    this.commandsManager = manager;
  }

  /**
   * Set the Squares manager for voice-triggered window management.
   * When enabled, phrases like "grid", "focus", "horizontal" in transcriptions
   * trigger window management actions instead of being pasted as text.
   */
  setSquaresManager(manager: any): void {
    this.squaresManager = manager;
  }

  /**
   * Set a function to get the current access token for API calls.
   * Used for cloud-based transcript improvement.
   */
  setAccessTokenGetter(getter: () => string | undefined): void {
    this.accessTokenGetter = getter;
  }

  /**
   * Initialize the transcriber manager.
   * Loads preferences and registers the global hotkey.
   */
  async init(): Promise<void> {
    // Load preferences
    await this.preferences.load();
    this.hotkey = this.preferences.getPreference('transcriptionHotkey');
    this.secondaryHotkey = this.preferences.getPreference('transcriptionSecondaryHotkey') || null;

    // Set the selected model from preferences.
    // Validate that the model is still supported (base was removed in v0.1.29, medium in v0.1.54).
    const validModels: ModelSize[] = ['small'];
    let selectedModel = this.preferences.getPreference('selectedModel');
    if (!validModels.includes(selectedModel)) {
      selectedModel = 'small';
      await this.preferences.save({ selectedModel: 'small' });
    }
    this.modelManager.setSelectedModel(selectedModel);

    // Overlay style hardcoded to 'rectangle' (cursor status indicator is primary UI)
    this.overlay.setOverlayStyle('rectangle');

    // Register global hotkey for normal transcription
    await this.registerHotkey(this.hotkey);

    // Register secondary hotkey if configured
    if (this.secondaryHotkey) {
      await this.registerSecondaryHotkey(this.secondaryHotkey);
    }

    // Handle app quit - unregister hotkeys via HotkeyManager
    // Note: HotkeyManager.unregisterAll() is also called from index.ts on will-quit,
    // but we clear our local state here for consistency.
    app.on('will-quit', () => {
      this.registeredHotkey = null;
      this.registeredSecondaryHotkey = null;
    });
  }

  /**
   * Re-register hotkeys after they've been unregistered (e.g., during onboarding).
   * Called by index.ts after onboarding completes.
   * Re-reads hotkeys from preferences to pick up any changes (e.g., after user login).
   */
  reRegisterHotkeys(): void {
    // Re-read hotkeys from preferences to pick up changes after user login
    this.hotkey = this.preferences.getPreference('transcriptionHotkey');
    this.secondaryHotkey = this.preferences.getPreference('transcriptionSecondaryHotkey') || null;

    this.registerHotkey(this.hotkey);
    if (this.secondaryHotkey) {
      this.registerSecondaryHotkey(this.secondaryHotkey);
    }
  }

  /**
   * Normalize hotkey string for Electron's globalShortcut API.
   * Converts shifted characters (like ~, !, @) to their base key + Shift modifier.
   */
  private normalizeHotkey(hotkey: string): string {
    // Map of shifted characters to their base keys
    const shiftedChars: Record<string, string> = {
      '~': '`',
      '!': '1',
      '@': '2',
      '#': '3',
      '$': '4',
      '%': '5',
      '^': '6',
      '&': '7',
      '*': '8',
      '(': '9',
      ')': '0',
      '_': '-',
      '+': '=',
      '{': '[',
      '}': ']',
      '|': '\\',
      ':': ';',
      '"': "'",
      '<': ',',
      '>': '.',
      '?': '/',
    };

    // Split hotkey into parts (e.g., "Command+~" -> ["Command", "~"])
    const parts = hotkey.split('+');
    const lastPart = parts[parts.length - 1];

    // Check if the last part is a shifted character
    if (lastPart in shiftedChars) {
      const baseKey = shiftedChars[lastPart];
      // Remove the shifted char and add Shift + base key
      parts.pop();
      // Insert Shift before the base key (but after other modifiers like Command/Alt)
      if (!parts.includes('Shift')) {
        parts.push('Shift');
      }
      parts.push(baseKey);
      const normalized = parts.join('+');
      return normalized;
    }

    return hotkey;
  }

  /**
   * Register a global hotkey. Unregisters the previous transcription hotkey if it exists.
   * Uses HotkeyManager for centralized registration.
   */
  private async registerHotkey(hotkey: string): Promise<boolean> {
    // Normalize the hotkey to handle shifted characters
    const normalizedHotkey = this.normalizeHotkey(hotkey);

    const hotkeyManager = getHotkeyManager();
    const result = hotkeyManager.register('transcription', normalizedHotkey, () => {
      this.handleHotkeyPress(false);
    });

    if (!result.success) {
      log.error(`Failed to register hotkey: ${normalizedHotkey}`);

      // Provide helpful error message
      let errorMessage = `Failed to register hotkey: ${hotkey}`;
      if (result.conflictWith) {
        errorMessage += `. Conflicts with ${result.conflictWith}. Please choose a different hotkey.`;
      } else if (result.error) {
        errorMessage += `. ${result.error}`;
      } else if (!hotkey.includes('+')) {
        errorMessage += '. Single keys may not be supported. Try using a modifier key combination (e.g., Alt+Space, Command+K).';
      }

      log.warn('Hotkey registration skipped: %s', errorMessage);
      return false;
    }

    this.hotkey = hotkey;
    this.registeredHotkey = normalizedHotkey;
    return true;
  }

  /**
   * Set a new hotkey and save to preferences.
   */
  async setHotkey(hotkey: string): Promise<boolean> {
    const success = await this.registerHotkey(hotkey);
    if (success) {
      await this.preferences.save({ transcriptionHotkey: hotkey });
      this.emit('hotkeyChanged', hotkey);
    }
    return success;
  }

  /**
   * Get the current hotkey.
   */
  getHotkey(): string {
    return this.hotkey;
  }

  /**
   * Register the secondary transcription hotkey.
   * Both primary and secondary hotkeys trigger the same recording action.
   * Uses HotkeyManager for centralized registration.
   */
  private async registerSecondaryHotkey(hotkey: string): Promise<boolean> {
    // Normalize the hotkey to handle shifted characters
    const normalizedHotkey = this.normalizeHotkey(hotkey);

    const hotkeyManager = getHotkeyManager();
    const result = hotkeyManager.register('transcriptionSecondary', normalizedHotkey, () => {
      this.handleHotkeyPress(true);
    });

    if (!result.success) {
      log.error(`Failed to register secondary hotkey: ${normalizedHotkey}`);
      let errorMessage = `Failed to register secondary hotkey: ${hotkey}`;
      if (result.conflictWith) {
        errorMessage += `. Conflicts with ${result.conflictWith}. Please choose a different hotkey.`;
      } else if (result.error) {
        errorMessage += `. ${result.error}`;
      } else if (!hotkey.includes('+')) {
        errorMessage += '. Single keys may not be supported. Try using a modifier key combination (e.g., Alt+Space, Command+K).';
      }
      log.warn('Hotkey registration skipped: %s', errorMessage);
      return false;
    }

    this.secondaryHotkey = hotkey;
    this.registeredSecondaryHotkey = normalizedHotkey;
    return true;
  }

  /**
   * Set a new secondary hotkey and save to preferences.
   * Pass null to disable the secondary hotkey.
   */
  async setSecondaryHotkey(hotkey: string | null): Promise<boolean> {
    // If null, unregister and clear
    if (!hotkey) {
      const hotkeyManager = getHotkeyManager();
      hotkeyManager.unregister('transcriptionSecondary');
      this.registeredSecondaryHotkey = null;
      this.secondaryHotkey = null;
      await this.preferences.save({ transcriptionSecondaryHotkey: undefined });
      return true;
    }

    const success = await this.registerSecondaryHotkey(hotkey);
    if (success) {
      await this.preferences.save({ transcriptionSecondaryHotkey: hotkey });
      this.emit('secondaryHotkeyChanged', hotkey);
    }
    return success;
  }

  /**
   * Get the current secondary hotkey.
   */
  getSecondaryHotkey(): string | null {
    return this.secondaryHotkey;
  }

  /**
   * Public method to toggle recording.
   * Called from tray menu or other external triggers.
   */
  async toggleRecording(): Promise<void> {
    await this.handleHotkeyPress(false);
  }

  /**
   * Handle hotkey press - toggle recording with double-tap detection.
   * Double-tap in idle → silentStacking mode
   * Single-tap in idle → recording mode (after 300ms delay)
   * Double-tap in silentStacking → paste and exit
   * Single-tap in silentStacking → start recording (keep existing stack)
   * @param isSecondary - True if triggered by secondary hotkey, false for primary
   */
  private async handleHotkeyPress(isSecondary: boolean): Promise<void> {
    if (this.status === 'idle') {
      if (this.pendingHotkeyTimer) {
        // Second tap within threshold → double-tap confirmed → silentStacking
        clearTimeout(this.pendingHotkeyTimer);
        this.pendingHotkeyTimer = null;
        await this.startSilentStacking();
      } else {
        // First tap → wait to see if it's a double-tap
        this.pendingHotkeyIsSecondary = isSecondary;
        this.pendingHotkeyTimer = setTimeout(async () => {
          this.pendingHotkeyTimer = null;
          this.startedWithSecondaryHotkey = this.pendingHotkeyIsSecondary;
          await this.startRecording();
        }, this.doubleTapThresholdMs);
      }
    } else if (this.status === 'silentStacking') {
      if (this.pendingHotkeyTimer) {
        // Double-tap from silentStacking → paste and exit
        clearTimeout(this.pendingHotkeyTimer);
        this.pendingHotkeyTimer = null;
        await this.finishSilentStacking();
      } else {
        // First tap in silentStacking → wait to distinguish single vs double
        this.pendingHotkeyIsSecondary = isSecondary;
        this.pendingHotkeyTimer = setTimeout(async () => {
          this.pendingHotkeyTimer = null;
          // Single-tap → start recording (keep existing stack)
          this.startedWithSecondaryHotkey = this.pendingHotkeyIsSecondary;
          await this.startRecordingFromSilentStack();
        }, this.doubleTapThresholdMs);
      }
    } else if (this.status === 'recording') {
      // No double-tap detection needed here - just stop recording
      const shouldImprove = this.secondaryHotkey !== null && isSecondary !== this.startedWithSecondaryHotkey;
      await this.stopRecordingAndTranscribe(shouldImprove);
    }
    // Ignore if transcribing
  }

  /**
   * Start recording audio.
   */
  private async startRecording(): Promise<void> {
    if (this.status !== 'idle') {
      return;
    }

    // Yield Hot Mic's recording so we can use the audio device
    if (this.hotMicDelegate?.isActive) {
      await this.hotMicDelegate.yieldToTranscriber();
    }

    // Block recording until onboarding is complete.
    const onboardingComplete = this.preferences.getPreference('onboardingComplete');
    if (!onboardingComplete) {
      return;
    }

    // Block recording if no model is downloaded (whisper only - Qwen manages its own model).
    const engineForStart = this.preferences.getPreference('transcriptionEngine') || 'whisper';
    if (engineForStart === 'whisper') {
      const modelAvailable = await this.modelManager.isModelAvailable();
      if (!modelAvailable) {
        const errorMsg = 'You must download a voice model first. Go to Settings → Transcription to download one.';
        this.emit('error', new Error(errorMsg));
        // Also show a visible note to the user
        this.cursorStatusManager?.showRecordingNote(errorMsg);
        return;
      }
    }

    // Check priority mic quota if a priority device is selected.
    // If quota exhausted, recording still works but priority mic won't be tracked.
    this.priorityMicSkippedForQuota = false;
    this.autoStackLimitShownThisSession = false; // Reset limit message flag
    if (this.quotaManager && this.audioManager) {
      const state = this.audioManager.getState();
      if (state.priorityDeviceId) {
        if (!this.quotaManager.isAllowed('priority_mic_seconds')) {
          this.priorityMicSkippedForQuota = true;
          // Show note but don't block recording - graceful degradation
          this.cursorStatusManager?.showRecordingNote(
            MESSAGES.recordingNote.priorityMicLimitReached
          );
          this.emit('quotaExhausted', this.quotaManager.getFeatureStatus('priority_mic_seconds'));
        }
      }
    }

    try {
      this.setStatus('recording');
      
      // Track recording start time for quota calculation.
      this.recordingStartTime = Date.now();
      
      // Reset audio content tracking for new recording.
      this.hasAudioContent = false;
      this.pendingAbandonConfirmation = false;
      
      // Clear stack, screenshot metadata, and detected commands from previous recording session.
      this.currentStack = [];
      this.screenshotMetadata = [];
      this.detectedCommands = [];
      
      // Show overlay
      this.overlay.showRecording();
      
      // Register abandon hotkey (configurable, default: Escape) to cancel recording.
      this.registerAbandonHotkey();
      
      // Play start recording sound (user-configurable).
      this.soundManager.play('recordingStart');
      
      await this.nativeHelper.startRecording();
      log.info('Recording started');
    } catch (error) {
      log.error('Failed to start recording:', error);
      this.setStatus('idle');
      this.overlay.dismiss();
      this.unregisterAbandonHotkey();
      this.emit('error', error as Error);
    }
  }

  /**
   * Start silent stacking mode - collect screenshots without recording audio.
   * Activated by double-tapping the transcribe hotkey.
   */
  private async startSilentStacking(): Promise<void> {
    if (this.status !== 'idle') {
      return;
    }

    // Block until onboarding is complete.
    const onboardingComplete = this.preferences.getPreference('onboardingComplete');
    if (!onboardingComplete) {
      return;
    }

    try {
      this.setStatus('silentStacking');

      // Track start time for figure timestamp calculation.
      this.recordingStartTime = Date.now();

      // Reset tracking for new silent stacking session.
      this.pendingAbandonConfirmation = false;

      // Clear stack and screenshot metadata for fresh start.
      this.currentStack = [];
      this.screenshotMetadata = [];
      this.detectedCommands = [];

      // Register abandon hotkey (Escape) - with confirmation if items exist.
      this.registerAbandonHotkey();

      // Play start sound (same as recording start).
      this.soundManager.play('recordingStart');

      // Emit stack changed to reset UI.
      this.emit('stackChanged', 0);

      log.info('Silent stacking started');
    } catch (error) {
      log.error('Failed to start silent stacking:', error);
      this.setStatus('idle');
      this.unregisterAbandonHotkey();
      this.emit('error', error as Error);
    }
  }

  /**
   * Transition from silent stacking to recording mode.
   * Keeps existing stack and continues figure numbering.
   */
  private async startRecordingFromSilentStack(): Promise<void> {
    if (this.status !== 'silentStacking') {
      return;
    }

    // Block recording if no model is downloaded (whisper only - Qwen manages its own model).
    const engineForSilentStart = this.preferences.getPreference('transcriptionEngine') || 'whisper';
    if (engineForSilentStart === 'whisper') {
      const modelAvailable = await this.modelManager.isModelAvailable();
      if (!modelAvailable) {
        const errorMsg = 'You must download a voice model first. Go to Settings → Transcription to download one.';
        this.emit('error', new Error(errorMsg));
        this.cursorStatusManager?.showRecordingNote(errorMsg);
        return;
      }
    }

    // Check priority mic quota if a priority device is selected.
    this.priorityMicSkippedForQuota = false;
    if (this.quotaManager && this.audioManager) {
      const state = this.audioManager.getState();
      if (state.priorityDeviceId) {
        if (!this.quotaManager.isAllowed('priority_mic_seconds')) {
          this.priorityMicSkippedForQuota = true;
          this.cursorStatusManager?.showRecordingNote(
            MESSAGES.recordingNote.priorityMicLimitReached
          );
          this.emit('quotaExhausted', this.quotaManager.getFeatureStatus('priority_mic_seconds'));
        }
      }
    }

    try {
      this.setStatus('recording');

      // Track recording start time for quota calculation.
      this.recordingStartTime = Date.now();

      // Reset audio content tracking for recording portion.
      this.hasAudioContent = false;
      this.pendingAbandonConfirmation = false;

      // DON'T clear currentStack or screenshotMetadata - keep existing figures!
      // Figure numbering will continue from where silentStacking left off.

      // Show overlay
      this.overlay.showRecording();

      // Abandon hotkey should already be registered from silentStacking,
      // but ensure it's registered.
      if (!this.abandonHotkeyRegistered) {
        this.registerAbandonHotkey();
      }

      // Play start recording sound.
      this.soundManager.play('recordingStart');

      await this.nativeHelper.startRecording();
      log.info('Recording started from silent stack (keeping %d existing figures)', this.screenshotMetadata.length);
    } catch (error) {
      log.error('Failed to start recording from silent stack:', error);
      this.setStatus('idle');
      this.overlay.dismiss();
      this.unregisterAbandonHotkey();
      this.emit('error', error as Error);
    }
  }

  /**
   * Finish silent stacking mode - paste collected screenshots and return to idle.
   * Activated by double-tapping the transcribe hotkey while in silentStacking mode.
   */
  private async finishSilentStacking(): Promise<void> {
    if (this.status !== 'silentStacking') {
      return;
    }

    // Unregister abandon hotkey.
    this.unregisterAbandonHotkey();

    // Play stop sound.
    this.soundManager.play('recordingStop');

    // If stack is empty or no clipboard manager, just return to idle.
    if (this.currentStack.length === 0 || !this.clipboardManager) {
      this.setStatus('idle');
      log.info('Silent stacking finished (empty stack)');
      return;
    }

    // Assign stackId to group items together (same logic as voice-enabled stacking).
    const stackId = crypto.randomUUID();
    this.clipboardManager.updateStackId(this.currentStack, stackId);

    // Emit event for metrics tracking.
    this.emit('autostackCreated');

    // Capture items to paste before changing status (snapshot).
    const itemsToPaste = [...this.currentStack];
    log.info('[SilentStack] Captured %d items to paste, setting status to idle', itemsToPaste.length);

    // Set to idle BEFORE pasting so clipboard changes during paste don't get re-added.
    this.clearStack();
    this.setStatus('idle');
    log.info('[SilentStack] Status is now: %s, stack cleared', this.status);

    // Paste the captured items.
    await this.pasteSilentStack(itemsToPaste);
    log.info('[SilentStack] Paste complete');
  }

  /**
   * Paste all items collected during silent stacking.
   * For terminals: pastes "Figure N" label + path with blank lines between.
   * For multimodal apps: pastes actual images with blank lines between.
   * @param itemIds - Snapshot of item IDs to paste (captured before status change)
   */
  private async pasteSilentStack(itemIds: number[]): Promise<void> {
    if (!this.clipboardManager || itemIds.length === 0) {
      return;
    }

    const frontmostBundleId = await this.getFrontmostAppBundleId();

    // Skip paste if Field Theory itself is frontmost.
    if (frontmostBundleId === 'com.fieldtheory.app' || frontmostBundleId === 'com.fieldtheory.experimental') {
      this.emit('paste-failed', 'Field Theory has focus - press Cmd+V in your target app', '');
      return;
    }

    const isTerminal = isTerminalApp(frontmostBundleId);

    // Get ALL items from captured IDs (text and images).
    log.info('[SilentStack] itemIds to paste:', itemIds);
    const items = itemIds
      .map(id => this.clipboardManager!.getItem(id))
      .filter((item): item is ClipboardItem => item !== null);

    log.info('[SilentStack] Pasting %d items, isTerminal: %s', items.length, isTerminal);
    items.forEach((item, i) => {
      log.info('[SilentStack] Item %d: id=%d, type=%s, hasImage=%s, contentPreview=%s',
        i, item.id, item.type, !!item.imageData, item.content?.substring(0, 30));
    });

    if (items.length === 0) {
      return;
    }

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      log.info('[SilentStack] Pasting item %d/%d: id=%d', i + 1, items.length, item.id);

      if (item.imageData) {
        // Image item
        if (isTerminal) {
          // Terminal: paste "Figure N" label + newline + path.
          const figureLabel = item.figureLabel || String(i + 1);
          const imagePath = await this.clipboardManager!.exportImageToCache(item);
          if (imagePath) {
            clipboard.writeText(`Figure ${figureLabel}\n${imagePath}`);
            this.clipboardManager?.syncClipboardHash();
            await this.pasteText();
          }
        } else {
          // Multimodal: paste actual image.
          const imageBuffer = typeof item.imageData === 'string'
            ? Buffer.from(item.imageData, 'base64')
            : item.imageData;
          const image = nativeImage.createFromBuffer(imageBuffer);
          clipboard.writeImage(image);
          this.clipboardManager?.setClipboardHashFromBuffer(imageBuffer);
          await this.pasteText();
        }
      } else if (item.content) {
        // Text item - paste as text.
        clipboard.writeText(item.content);
        this.clipboardManager?.syncClipboardHash();
        await this.pasteText();
      }

      // Blank line between items for all apps.
      if (i < items.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
        clipboard.writeText('\n');
        this.clipboardManager?.syncClipboardHash();
        await this.pasteText();
      }

      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  /**
   * Stop recording and transcribe the audio.
   * @param shouldImprove - If true, run AI improvement on the transcript after transcription
   */
  private async stopRecordingAndTranscribe(shouldImprove: boolean = false): Promise<void> {
    if (this.status !== 'recording') {
      return;
    }

    try {
      // Unregister abandon hotkey.
      this.unregisterAbandonHotkey();
      
      // Play stop recording sound (user-configurable).
      this.soundManager.play('recordingStop');
      
      // Stop recording and get WAV file path
      const wavPath = await this.nativeHelper.stopRecording();

      // Track priority mic usage if a priority device was selected during recording.
      await this.trackPriorityMicUsage();

      // Check if whisper model is available (skip for Qwen - it manages its own model)
      const engineForModelCheck = this.preferences.getPreference('transcriptionEngine') || 'whisper';
      if (engineForModelCheck === 'whisper') {
        const selectedModel = this.modelManager.getSelectedModel();
        const modelAvailable = await this.modelManager.isModelAvailable();
        if (!modelAvailable) {
          this.setStatus('idle');
          this.handleOverlayAfterTranscription();
          this.emit('error', new Error(`Model "${selectedModel}" not available. Please download the model first.`));
          return;
        }
      }

      // Switch to transcribing state
      this.setStatus('transcribing');
      this.overlay.showTranscribing();

      // Transcribe using configured engine
      const engine = this.preferences.getPreference('transcriptionEngine') || 'whisper';
      const text = engine === 'qwen'
        ? await this.transcribeWithQwen(wavPath)
        : await this.transcribe(wavPath);
      
      // Check for silence (empty or whitespace-only text)
      const trimmedText = text ? text.trim() : '';
      if (trimmedText.length === 0) {
        // Still stack screenshots if any were taken during recording (no audio).
        await this.stackScreenshotsIfAny();
        this.setStatus('idle');
        this.overlay.showStatus(MESSAGES.overlay.noAudioFound);
        return;
      }

      // Strip bracketed content like [BLANK_AUDIO], [MUSIC], [SILENCE] from anywhere in the text.
      // These are whisper artifacts that shouldn't appear in final transcription.
      // Preserve [Figure X] references by using a negative lookahead (X can be number or letter).
      let cleanedText = trimmedText.replace(/\s*\[(?!Figure\s+[A-Za-z0-9]+\])[^\]]+\]\s*/g, ' ').trim();

      // Also strip all-caps parenthetical sound descriptions like (MUMBLING), (MUSIC), (LAUGHING).
      // These are Whisper artifacts. Preserve normal parenthetical comments.
      cleanedText = cleanedText.replace(/\s*\([A-Z\s]+\)\s*/g, ' ').trim();

      // Apply user-configured word substitutions.
      // This corrects common transcription mistakes like "main" -> "main" for the branch.
      cleanedText = this.applyWordSubstitutions(cleanedText);
      
      // If nothing remains after stripping brackets, treat as silence.
      if (cleanedText.length === 0) {
        // Still stack screenshots if any were taken during recording (no audio).
        await this.stackScreenshotsIfAny();
        this.setStatus('idle');
        this.overlay.showStatus(MESSAGES.overlay.noAudioFound);
        return;
      }
      
      // Figure references are now inserted inline during transcription parsing
      // (in parseTimestampedOutput) when screenshots were captured during recording.

      // Check for Squares voice commands (e.g., "grid", "focus", "horizontal").
      // If the transcription is a window management command, execute it and skip pasting.
      if (this.squaresManager) {
        const handled = await this.squaresManager.handleVoiceCommand(cleanedText);
        if (handled) {
          log.info(`Squares voice command executed: "${cleanedText}"`);
          this.setStatus('idle');
          this.handleOverlayAfterTranscription();
          return;
        }
      }

      // Detect portable commands in the transcription.
      // If user says "use the debug command", insert [cmd:debug.md] reference.
      this.detectedCommands = [];
      if (this.commandsManager) {
        const commandDetection = this.commandsManager.detectCommands(cleanedText);
        if (commandDetection.detected) {
          // Insert [cmd:name.md] references at the end of the cleaned text (trigger phrases removed)
          cleanedText = this.commandsManager.insertCommandReferences(
            commandDetection.textWithoutCommandRefs,
            commandDetection.matchedCommands
          );
          // Store detected commands for terminal formatting later
          this.detectedCommands = commandDetection.matchedCommands.map(cmd => ({
            name: cmd.name,
            filePath: cmd.filePath,
          }));
          // Emit event for each verbal command detected (for metrics tracking)
          this.detectedCommands.forEach(() => this.emit('verbalCommand'));

          // Emit command names for dynamic island highlighting.
          this.emit('commandsDetected', this.detectedCommands.map((cmd: { name: string }) => cmd.name));
        }
      }

      // Store transcription in clipboard history.
      if (this.clipboardManager) {
        // Check if continuous context mode is active - if so, use its stackId.
        const continuousContextState = this.clipboardManager.getContinuousContextState();
        const effectiveStackId = continuousContextState.active && continuousContextState.stackId
          ? continuousContextState.stackId
          : undefined;
        
        const itemId = await this.clipboardManager.storeText(
          cleanedText,
          'transcript',
          undefined, // sourceApp - let it auto-detect
          effectiveStackId
        );
        if (itemId > 0) {
          this.currentStack.push(itemId);
          
          // Auto-stack: if screenshots were taken during recording, group them with transcript.
          // Only auto-stack if we have more than one item (transcript + screenshots).
          // Check quota BEFORE stacking - if exhausted, items stay separate.
          if (this.currentStack.length > 1) {
            let canAutoStack = true;

            if (this.quotaManager) {
              if (!this.quotaManager.isAllowed('auto_stack_sessions')) {
                // Quota exhausted - don't auto-stack. Remove screenshots from stack so only
                // transcript is pasted. Screenshots are saved separately in Field Theory.
                canAutoStack = false;

                // Keep only the transcript (just added), remove all screenshots.
                this.currentStack = [itemId];
                this.screenshotMetadata = [];

                this.emit('quotaExhausted', this.quotaManager.getFeatureStatus('auto_stack_sessions'));
              }
            }
            
            if (canAutoStack) {
              const stackId = crypto.randomUUID();
              this.clipboardManager.updateStackId(this.currentStack, stackId);

              // Emit event for metrics tracking
              this.emit('autostackCreated');

              // Track auto-stack quota usage.
              await this.trackAutoStackUsage();
            }
          }
          
          this.emit('stackChanged', this.currentStack.length);
        }
      }
      
      this.lastTranscription = cleanedText;

      // If improvement was triggered (cross-hotkey) OR auto-improve is enabled, run AI improvement.
      let finalText = cleanedText;
      let improvedText: string | null = null;

      // Check if we should improve: explicit request OR auto-improve enabled
      const autoImproveEnabled = this.getAutoImprove();

      // Calculate word count for both threshold check and quota tracking (input words)
      const wordCount = cleanedText.trim().split(/\s+/).filter(w => w.length > 0).length;

      // For auto-improve, check word count meets minimum threshold
      // Explicit improvement requests (shouldImprove) always run regardless of word count
      let shouldTriggerImprovement = shouldImprove;
      if (!shouldImprove && autoImproveEnabled) {
        const minWords = this.getAutoImproveMinWords();
        if (wordCount >= minWords) {
          shouldTriggerImprovement = true;
        }
      }

      if (shouldTriggerImprovement && FEATURE_IMPROVE_ENABLED && this.clipboardManager) {
        // Check if we can improve: need an access token for cloud API.
        const accessToken = this.accessTokenGetter?.();

        if (accessToken) {
          // Bail silently if no text to improve
          if (!cleanedText || cleanedText.trim().length === 0) {
            // No text to improve - skip silently
          } else {
            // Show improving state.
            this.cursorStatusManager?.setState('improving');
            this.emit('improvingStarted');

            const result = await improveTranscript(cleanedText, accessToken);

            if (result.success && result.refinedPrompt) {
              improvedText = result.refinedPrompt;

              // Re-insert command references if they were stripped by the LLM.
              // The system prompt asks to preserve them, but LLMs sometimes drop them anyway.
              // We store detected commands separately, so we can ensure they're present.
              if (this.detectedCommands.length > 0) {
                for (const cmd of this.detectedCommands) {
                  const ref = `[cmd:${cmd.name}.md]`;
                  if (!improvedText.includes(ref)) {
                    improvedText += ` ${ref}`;
                  }
                }
              }

              finalText = improvedText;

              // Track auto-improve usage stats (always, using 0 for tokens if not available)
              const currentPrefs = this.preferences.get();
              const currentStats = currentPrefs.autoImproveStats || {
                wordsImproved: 0,
                apiCalls: 0,
                inputTokens: 0,
                outputTokens: 0,
              };
              await this.preferences.save({
                autoImproveStats: {
                  wordsImproved: currentStats.wordsImproved + (result.wordCount || wordCount),
                  apiCalls: currentStats.apiCalls + 1,
                  inputTokens: currentStats.inputTokens + (result.usage?.inputTokens || 0),
                  outputTokens: currentStats.outputTokens + (result.usage?.outputTokens || 0),
                },
              });

              // Emit event for metrics tracking (server tracks quota via improve-text edge function)
              const improvedWordCount = result.wordCount || wordCount;
              this.emit('wordsImproved', improvedWordCount);

              // Save improved content to the transcript item in the database.
              // The transcript item is the last one added to currentStack.
              const transcriptItemId = this.currentStack[this.currentStack.length - 1];
              if (transcriptItemId) {
                this.clipboardManager.saveImprovedContent(transcriptItemId, improvedText);
              }
            } else if (result.quotaExceeded) {
              // Quota exceeded - show message once per billing period, then fail silently
              if (result.showQuotaMessage && !this.hasShownQuotaMessageThisPeriod) {
                this.hasShownQuotaMessageThisPeriod = true;
                this.cursorStatusManager?.showCriticalMessage(MESSAGES.critical.improvementQuotaExhausted);
              }
              // Use raw transcript (already in finalText)
            } else {
              log.error('Improvement failed:', result.error);
              // Fail silently - don't show error message, just fall back to original transcript
            }
          }
        } else {
          this.cursorStatusManager?.showCriticalMessage(MESSAGES.critical.noLlmConfigured);
          // Skip paste-failed notification since we're showing the config message
          this.skipNextPasteFailedNotification = true;
        }
      }

      // Update lastTranscription with the final text (improved or original).
      this.lastTranscription = finalText;

      // Paste, check accessibility in parallel for UI feedback.
      // Don't clear stack after auto-paste so Super Paste (Cmd+Shift+V) can re-paste if needed.
      // Stack is cleared when next recording starts.
      const accessibilityCheckPromise = this.nativeHelper.checkFocusedTextInput();
      await this.pasteStack(false);
      this.emit('result', finalText);

      // Set status to idle BEFORE emitting paste events.
      // This prevents the idle transition from overriding paste-failed UI.
      this.setStatus('idle');
      this.handleOverlayAfterTranscription();

      // Use accessibility result to choose UI feedback (paste already happened)
      const hasTextInput = await accessibilityCheckPromise;
      if (hasTextInput) {
        this.emit('paste-success', cleanedText);
      } else if (!this.skipNextPasteFailedNotification) {
        this.emit('paste-failed', 'No text input focused', cleanedText);
      }
      // Reset the skip flag
      this.skipNextPasteFailedNotification = false;
    } catch (error) {
      log.error('Transcription failed:', error);
      this.setStatus('idle');
      this.handleOverlayAfterTranscription();
      this.emit('error', error as Error);
    }
  }

  /**
   * Handle overlay state after transcription completes.
   * Dismiss the overlay.
   */
  private handleOverlayAfterTranscription(): void {
    this.overlay.dismiss();
  }
  
  /**
   * Cancel recording (called by abandon hotkey).
   */
  private async cancelRecording(): Promise<void> {
    if (this.status !== 'recording') {
      return;
    }

    try {
      // Note: Cancel sound removed to avoid audio feedback on abandoned recordings.
      await this.nativeHelper.cancelRecording();
      this.setStatus('idle');
      this.hasAudioContent = false;
      this.currentStack = [];
      this.screenshotMetadata = [];
      this.overlay.showStatus(MESSAGES.overlay.cancelled);
      this.unregisterAbandonHotkey();
    } catch (error) {
      log.error('Failed to cancel recording:', error);
      this.setStatus('idle');
      this.hasAudioContent = false;
      this.currentStack = [];
      this.screenshotMetadata = [];
      this.overlay.showStatus(MESSAGES.overlay.cancelled);
      this.unregisterAbandonHotkey();
    }
  }

  /**
   * Cancel silent stacking (called by abandon hotkey in silentStacking mode).
   */
  private cancelSilentStacking(): void {
    if (this.status !== 'silentStacking') {
      return;
    }

    this.setStatus('idle');
    this.currentStack = [];
    this.screenshotMetadata = [];
    this.unregisterAbandonHotkey();
    log.info('Silent stacking cancelled');
  }

  /**
   * Register abandon recording hotkey (configurable, default: Escape).
   * If clipboard history is visible, dismiss it first instead of canceling recording.
   */
  private registerAbandonHotkey(): void {
    if (this.abandonHotkeyRegistered) {
      return;
    }
    
    const abandonHotkey = this.preferences.getPreference('abandonRecordingHotkey') || 'Escape';
    this.registeredAbandonHotkey = abandonHotkey;
    
    const registered = globalShortcut.register(abandonHotkey, () => {
      // Handle second Escape press during confirmation.
      if (this.pendingAbandonConfirmation) {
        this.pendingAbandonConfirmation = false;
        this.overlay.hideConfirmation();
        if (this.status === 'silentStacking') {
          this.cancelSilentStacking();
        } else {
          this.cancelRecording();
        }
        return;
      }

      // Let clipboard history handle Escape if it's visible.
      if (this.clipboardHistoryVisibilityChecker?.()) {
        this.emit('dismiss-clipboard-history');
        return;
      }

      const confirmationEnabled = this.preferences.getPreference('abandonRecordingConfirmation') ?? true;

      // Handle silentStacking mode.
      if (this.status === 'silentStacking') {
        if (confirmationEnabled && this.currentStack.length > 0) {
          // Has items - show "Esc again to discard" confirmation.
          this.pendingAbandonConfirmation = true;
          this.cursorStatusManager?.setState('confirmation');
          this.emit('confirmation-show');
          return;
        }
        // No items or confirmation disabled - cancel immediately.
        this.cancelSilentStacking();
        return;
      }

      // Handle recording mode (existing behavior).
      if (confirmationEnabled && this.hasAudioContent) {
        // Show confirmation dialog.
        this.pendingAbandonConfirmation = true;
        this.overlay.showConfirmation();
        this.emit('confirmation-show');
        return;
      }

      // No confirmation needed - cancel immediately.
      this.cancelRecording();
    });
    
    if (registered) {
      this.abandonHotkeyRegistered = true;
    } else {
      log.error(`Failed to register abandon hotkey: ${abandonHotkey}`);
    }
  }
  
  /**
   * Unregister abandon recording hotkey.
   */
  private unregisterAbandonHotkey(): void {
    if (!this.abandonHotkeyRegistered) {
      return;
    }
    
    globalShortcut.unregister(this.registeredAbandonHotkey);
    this.abandonHotkeyRegistered = false;
    this.pendingAbandonConfirmation = false;
  }
  
  /**
   * Temporarily pause the abandon hotkey (e.g., during screenshot selection).
   * This allows Escape to be handled by the system instead of our global shortcut.
   */
  pauseAbandonHotkey(): void {
    if (!this.abandonHotkeyRegistered) {
      return;
    }
    globalShortcut.unregister(this.registeredAbandonHotkey);
    this.abandonHotkeyRegistered = false;
  }
  
  /**
   * Resume the abandon hotkey after it was paused.
   */
  resumeAbandonHotkey(): void {
    if (this.status !== 'recording' && this.status !== 'silentStacking') {
      return;
    }
    if (this.abandonHotkeyRegistered) {
      return; // Already registered
    }
    this.registerAbandonHotkey();
  }
  
  /**
   * Set the abandon recording hotkey and save to preferences.
   */
  async setAbandonHotkey(hotkey: string): Promise<boolean> {
    // Unregister old hotkey if currently recording.
    if (this.abandonHotkeyRegistered) {
      this.unregisterAbandonHotkey();
    }
    
    await this.preferences.save({ abandonRecordingHotkey: hotkey });
    
    // Re-register if we're currently recording or silentStacking.
    if (this.status === 'recording' || this.status === 'silentStacking') {
      this.registerAbandonHotkey();
    }

    return true;
  }
  
  /**
   * Get the current abandon recording hotkey.
   */
  getAbandonHotkey(): string {
    return this.preferences.getPreference('abandonRecordingHotkey') || 'Escape';
  }
  
  /**
   * Set whether to show confirmation when abandoning a recording with content.
   */
  async setAbandonConfirmation(enabled: boolean): Promise<void> {
    await this.preferences.save({ abandonRecordingConfirmation: enabled });
  }
  
  /**
   * Get whether confirmation is enabled for abandoning recordings.
   */
  getAbandonConfirmation(): boolean {
    return this.preferences.getPreference('abandonRecordingConfirmation') ?? true;
  }

  /**
   * Set whether to automatically improve transcripts after completion.
   */
  async setAutoImprove(enabled: boolean): Promise<void> {
    await this.preferences.save({ autoImproveTranscripts: enabled });
  }

  /**
   * Get whether auto-improve is enabled for transcripts.
   * Default is true (enabled) for new users.
   */
  getAutoImprove(): boolean {
    return this.preferences.getPreference('autoImproveTranscripts') ?? true;
  }

  /**
   * Set the minimum word count for auto-improve to trigger.
   * Transcripts below this word count will skip auto-improve.
   */
  async setAutoImproveMinWords(minWords: number): Promise<void> {
    // Clamp to valid range: 30-500
    const clamped = Math.max(30, Math.min(500, minWords));
    await this.preferences.save({ autoImproveMinWords: clamped });
  }

  /**
   * Get the minimum word count for auto-improve.
   * Default is 70 words.
   */
  getAutoImproveMinWords(): number {
    return this.preferences.getPreference('autoImproveMinWords') ?? 70;
  }

  // ---------------------------------------------------------------------------
  // Quota Tracking
  // ---------------------------------------------------------------------------

  /**
   * Track priority mic usage if a priority device was selected during recording.
   * Only counts time when the user has explicitly chosen a priority device.
   * Skips tracking if quota was exhausted at recording start (graceful degradation).
   */
  private async trackPriorityMicUsage(): Promise<void> {
    if (!this.quotaManager || !this.audioManager) return;

    // Skip tracking if quota was exhausted at start of recording
    if (this.priorityMicSkippedForQuota) {
      return;
    }

    const state = this.audioManager.getState();
    if (!state.priorityDeviceId) return; // No priority device selected

    const recordingDurationSeconds = Math.floor((Date.now() - this.recordingStartTime) / 1000);
    if (recordingDurationSeconds > 0) {
      await this.quotaManager.updateUsage('priority_mic_seconds', recordingDurationSeconds);
    }
  }

  /**
   * Track auto-stack session usage for multi-image stacks.
   * Only counts against quota when stacking 2+ images with transcript.
   * Single image + transcript is always free.
   */
  private async trackAutoStackUsage(): Promise<void> {
    if (!this.quotaManager) return;

    // Only count as auto-stack session if there are 2+ screenshots
    // Single image + transcript is always free
    if (this.screenshotMetadata.length < 2) {
      return;
    }

    await this.quotaManager.updateUsage('auto_stack_sessions', 1);
  }

  /**
   * Get the path to the Qwen transcription Python script.
   */
  private getQwenScriptPath(): string {
    // __dirname in compiled code is mac-app/electron-dist/main
    // So we need to go up 2 levels: main -> electron-dist -> mac-app
    const macAppRoot = path.resolve(__dirname, '../..');
    return path.join(macAppRoot, 'scripts', 'qwen-transcribe.py');
  }

  /**
   * Get the path to the Python interpreter in the Qwen venv.
   */
  private getQwenPythonPath(): string {
    const macAppRoot = path.resolve(__dirname, '../..');
    return path.join(macAppRoot, 'build-qwen', 'venv', 'bin', 'python');
  }

  /**
   * Check if Qwen is installed by verifying the venv Python binary exists.
   */
  async isQwenInstalled(): Promise<boolean> {
    const pythonPath = this.getQwenPythonPath();
    try {
      await fs.promises.access(pythonPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Start the persistent Qwen server process.
   * Spawns the Python script with --server flag and waits for the ready signal.
   */
  private startQwenServer(): Promise<void> {
    if (this.qwenReady && this.qwenProcess) {
      return Promise.resolve();
    }
    if (this.qwenReadyPromise) {
      return this.qwenReadyPromise;
    }

    this.qwenStarting = true;
    const pythonPath = this.getQwenPythonPath();
    const scriptPath = this.getQwenScriptPath();

    this.qwenReadyPromise = new Promise<void>((resolve, reject) => {
      const proc = spawn(pythonPath, [scriptPath, '--server'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.qwenProcess = proc;
      let buffer = '';

      const onData = (data: Buffer) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.ready) {
              // Server is ready — model loaded
              this.qwenReady = true;
              this.qwenStarting = false;
              // Switch from startup handler to normal line handler
              proc.stdout?.removeListener('data', onData);
              this.setupQwenLineHandler(proc, buffer);
              buffer = '';
              log.info('Qwen server ready');
              resolve();
              return;
            }
          } catch {
            // Not JSON, ignore during startup
          }
        }
      };

      proc.stdout?.on('data', onData);

      proc.stderr?.on('data', (data: Buffer) => {
        log.info('[Qwen stderr] %s', data.toString().trim());
      });

      proc.on('error', (error) => {
        this.qwenProcess = null;
        this.qwenReady = false;
        this.qwenStarting = false;
        this.qwenReadyPromise = null;
        reject(new Error(`Failed to start qwen server: ${error.message}. Run: cd mac-app && bash scripts/setup-qwen.sh`));
      });

      proc.on('close', (code) => {
        const wasReady = this.qwenReady;
        this.qwenProcess = null;
        this.qwenReady = false;
        this.qwenStarting = false;
        this.qwenReadyPromise = null;

        // Reject any pending transcription request
        if (this.qwenPendingResolve) {
          this.qwenPendingResolve({ ok: false, error: `Qwen server exited with code ${code}` });
          this.qwenPendingResolve = null;
        }

        if (!wasReady) {
          reject(new Error(`Qwen server exited during startup with code ${code}`));
        } else {
          log.warn('Qwen server process exited (code %d), will restart on next transcription', code);
        }
      });
    });

    return this.qwenReadyPromise;
  }

  /**
   * Set up the stdout line handler for the Qwen server process after startup.
   * Parses JSON responses and resolves pending transcription requests.
   */
  private setupQwenLineHandler(proc: ChildProcess, initialBuffer: string): void {
    let buffer = initialBuffer;

    proc.stdout?.on('data', (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (this.qwenPendingResolve) {
            this.qwenPendingResolve(msg);
            this.qwenPendingResolve = null;
          }
        } catch {
          log.warn('[Qwen] Non-JSON stdout: %s', line);
        }
      }
    });
  }

  /**
   * Kill the Qwen server. Called on suspend/sleep so the process doesn't
   * freeze and hang for 120s on wake. The next transcription request will
   * restart it automatically.
   */
  stopQwenServer(): void {
    if (this.qwenProcess) {
      this.qwenProcess.kill('SIGTERM');
      this.qwenProcess = null;
    }
    this.qwenReady = false;
    this.qwenStarting = false;
    this.qwenReadyPromise = null;
    this.qwenPendingResolve = null;
  }

  /**
   * Send a command to the Qwen server and wait for the response.
   * Times out after 120 seconds to avoid hanging indefinitely on bad audio.
   */
  private sendQwenCommand(cmd: Record<string, unknown>): Promise<{ ok: boolean; text?: string; error?: string }> {
    return new Promise((resolve, reject) => {
      if (!this.qwenProcess || !this.qwenReady) {
        reject(new Error('Qwen server not running'));
        return;
      }

      const timeout = setTimeout(() => {
        this.qwenPendingResolve = null;
        reject(new Error('Qwen server timed out (120s)'));
      }, 120_000);

      this.qwenPendingResolve = (response) => {
        clearTimeout(timeout);
        resolve(response);
      };
      const line = JSON.stringify(cmd) + '\n';
      this.qwenProcess.stdin?.write(line, (err) => {
        if (err) {
          clearTimeout(timeout);
          this.qwenPendingResolve = null;
          reject(new Error(`Failed to write to Qwen server: ${err.message}`));
        }
      });
    });
  }

  /**
   * Transcribe audio file using Qwen3-ASR via persistent server.
   * Starts the server on first use, auto-restarts on crash (one retry).
   */
  private async transcribeWithQwen(wavPath: string): Promise<string> {
    const needTimestamps = this.screenshotMetadata.length > 0;

    const doTranscribe = async (): Promise<string> => {
      await this.startQwenServer();

      const response = await this.sendQwenCommand({
        cmd: 'transcribe',
        audio: wavPath,
        timestamps: needTimestamps,
      });

      if (!response.ok) {
        throw new Error(`Qwen transcription failed: ${response.error}`);
      }

      const rawText = response.text || '';

      if (needTimestamps) {
        return this.parseTimestampedOutput(rawText);
      } else {
        return rawText.trim();
      }
    };

    try {
      return await doTranscribe();
    } catch (error) {
      // One retry: restart server and try again
      log.warn('Qwen transcription failed, restarting server: %s', (error as Error).message);
      this.stopQwenServer();
      return await doTranscribe();
    }
  }

  /**
   * Transcribe audio file using whisper-cli.
   */
  private async transcribe(wavPath: string): Promise<string> {
    try {
      return await this.runWhisper(wavPath);
    } catch (error: any) {
      // If GPU mode crashed with a Metal error, retry with GPU disabled.
      if (!this.gpuDisabled && this.isMetalError(error?.message || '')) {
        log.warn('Metal GPU error detected, retrying with CPU-only mode');
        this.gpuDisabled = true;
        return await this.runWhisper(wavPath);
      }
      throw error;
    }
  }

  private isMetalError(message: string): boolean {
    return message.includes('MTLLibraryError') ||
      message.includes('MetalPerformancePrimitives') ||
      message.includes('metal_library_compile_pipeline') ||
      message.includes('ggml_metal');
  }

  private runWhisper(wavPath: string): Promise<string> {
    const modelPath = this.modelManager.getModelPath();
    const whisperPath = this.getWhisperPath();

    // If screenshots were captured, we need timestamps to insert figure refs inline.
    const needTimestamps = this.screenshotMetadata.length > 0;

    return new Promise((resolve, reject) => {
      // Spawn whisper-cli process
      // whisper-cli -m model.bin -f audio.wav [--no-timestamps] --language en
      const args = [
        '-m', modelPath,
        '-f', wavPath,
        '--language', 'en',
      ];

      // Only skip timestamps if we don't need them for figure placement.
      if (!needTimestamps) {
        args.push('--no-timestamps');
      }

      if (this.gpuDisabled) {
        args.push('-ng');
      }

      // Disable colors in whisper-cli output
      this.whisperProcess = spawn(whisperPath, args, {
        env: { ...process.env, NO_COLOR: '1' }
      });

      let stdout = '';
      let stderr = '';

      this.whisperProcess.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      this.whisperProcess.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      this.whisperProcess.on('close', (code) => {
        this.whisperProcess = null;

        if (code !== 0) {
          reject(new Error(`whisper-cli exited with code ${code}: ${stderr}`));
          return;
        }

        // Strip ANSI escape codes (color codes) from output as a fallback.
        const ansiEscapeRegex = /\u001b\[[0-9;]*m/g;
        let cleanedStdout = stdout.replace(ansiEscapeRegex, '');
        
        // Remove metadata-like bracketed content but preserve timestamp patterns for parsing.
        cleanedStdout = cleanedStdout.replace(/\[(?:SPEAKER_TURN|id:\s*\d+|start:|end:)[^\]]*\]/gi, '');

        let text: string;

        if (needTimestamps) {
          // Parse timestamped segments for inline figure placement.
          text = this.parseTimestampedOutput(cleanedStdout);
        } else {
          // No screenshots - strip all timestamps and join text.
          cleanedStdout = cleanedStdout.replace(/\[\d{2}:\d{2}:\d{2}(?:\.\d{3})?\s*-->\s*\d{2}:\d{2}:\d{2}(?:\.\d{3})?\]/g, '');
          
          const lines = cleanedStdout.trim().split('\n');
          text = lines
            .filter(line => {
              const trimmed = line.trim();
              if (trimmed.length === 0) return false;
              if (trimmed.match(/^\[.*-->\s*\]/)) return false;
              if (trimmed.match(/^\[\d+:\d+:\d+/)) return false;
              if (trimmed.match(/^(###|Transcription|END|BEGIN)/i)) return false;
              return true;
            })
            .map(line => line.trim())
            .join(' ')
            .trim();
        }

        resolve(text);
      });

      this.whisperProcess.on('error', (error) => {
        this.whisperProcess = null;
        reject(error);
      });
    });
  }

  /**
   * Paste text into the active application using AppleScript.
   */
  private async pasteText(): Promise<void> {
    try {
      // Use AppleScript to send Command+V
      await execAsync('osascript -e \'tell application "System Events" to keystroke "v" using command down\'');
    } catch (error) {
      // If paste fails (e.g., no input field selected), text is still in clipboard.
      this.emit('paste-failed', 'No active input field found - copied to clipboard', this.lastTranscription);
    }
  }

  /**
   * Get the path to the whisper-cli binary.
   */
  private getWhisperPath(): string {
    if (app.isPackaged) {
      // In packaged app, whisper-cli should be in resources
      return path.join(process.resourcesPath, 'whisper-cli');
    } else {
      // In development, use build-whisper from repo root
      // __dirname in compiled code is mac-app/electron-dist/main
      // So we need to go up 3 levels: main -> electron-dist -> mac-app -> repo root
      const repoRoot = path.resolve(__dirname, '../../..');
      return path.join(repoRoot, 'build-whisper', 'bin', 'whisper-cli');
    }
  }

  /**
   * Set the transcription status and emit event.
   */
  private setStatus(status: TranscriptionStatus): void {
    if (this.status !== status) {
      this.status = status;
      this.emit('statusChanged', status);

      // Resume Hot Mic listening when we return to idle
      if (status === 'idle' && this.hotMicDelegate?.isActive) {
        this.hotMicDelegate.resumeAfterTranscriber().catch(() => {});
      }
    }
  }

  /**
   * Get the current transcription status.
   */
  getStatus(): TranscriptionStatus {
    return this.status;
  }

  /**
   * Get the model manager instance.
   */
  getModelManager(): ModelManager {
    return this.modelManager;
  }

  /**
   * Get the sound manager instance.
   */
  getSoundManager(): SoundManager {
    return this.soundManager;
  }

  /**
   * Pre-start the Qwen server so the first transcription is fast.
   * No-op if already running or if engine is not qwen.
   */
  async warmup(): Promise<void> {
    const engine = this.preferences.getPreference('transcriptionEngine') || 'whisper';
    if (engine === 'qwen') {
      await this.startQwenServer();
    }
  }

  /**
   * Transcribe an audio file using the user's configured engine (whisper or qwen).
   * Exposed for HotMicManager so it can share the persistent Qwen server.
   */
  async transcribeAudio(wavPath: string): Promise<string> {
    const engine = this.preferences.getPreference('transcriptionEngine') || 'whisper';
    return engine === 'qwen'
      ? this.transcribeWithQwen(wavPath)
      : this.transcribe(wavPath);
  }

  /**
   * Get the currently selected model size.
   */
  getSelectedModel(): string {
    return this.modelManager.getSelectedModel();
  }

  /**
   * Set the selected model size and save to preferences.
   */
  async setSelectedModel(size: ModelSize): Promise<void> {
    this.modelManager.setSelectedModel(size);
    await this.preferences.save({ selectedModel: size });
  }

  /**
   * Get the current stack of items (for prompt stacking).
   */
  getCurrentStack(): number[] {
    return [...this.currentStack];
  }

  /**
   * Clear the current stack.
   */
  clearStack(): void {
    this.currentStack = [];
    this.screenshotMetadata = [];
    this.detectedCommands = [];
    this.emit('stackChanged', 0);
  }

  /**
   * Stack screenshots together even when no audio was detected.
   * Called when recording ends with silence but screenshots were taken.
   */
  private async stackScreenshotsIfAny(): Promise<void> {
    if (!this.clipboardManager || this.currentStack.length === 0) {
      return;
    }
    
    // Only stack if more than 1 screenshot and quota allows.
    if (this.currentStack.length > 1) {
      let canAutoStack = true;

      if (this.quotaManager) {
        if (!this.quotaManager.isAllowed('auto_stack_sessions')) {
          // Quota exhausted - don't stack, emit upgrade prompt.
          canAutoStack = false;
          this.emit('quotaExhausted', this.quotaManager.getFeatureStatus('auto_stack_sessions'));
        }
      }
      
      if (canAutoStack) {
        const stackId = crypto.randomUUID();
        this.clipboardManager.updateStackId(this.currentStack, stackId);

        // Emit event for metrics tracking
        this.emit('autostackCreated');

        // Track auto-stack quota usage.
        await this.trackAutoStackUsage();
      }
    }
    
    this.emit('stackChanged', this.currentStack.length);
  }

  /**
   * Add an item to the current stack (e.g., screenshot).
   * If recording is active and the item is a screenshot, assigns a figure label
   * and tracks the capture timestamp for later insertion into the transcript.
   * 
   * If auto-stack quota is exhausted, the screenshot is NOT added to the stack.
   * It's still saved to Field Theory but must be manually stacked by the user.
   */
  addToStack(itemId: number): void {
    log.info('[Stack] addToStack called: itemId=%d, status=%s, stackLen=%d', itemId, this.status, this.currentStack.length);
    if (this.currentStack.includes(itemId)) {
      log.info('[Stack] Skipping duplicate itemId=%d', itemId);
      return;
    }

    // Check auto-stack quota before adding screenshots to stack during recording or silentStacking.
    // Free tier: Allow first screenshot to stack (users can experience transcript + 1 figure)
    // Pro tier: Unlimited screenshots
    if ((this.status === 'recording' || this.status === 'silentStacking') && this.quotaManager) {
      // Count existing screenshots in stack (use screenshotMetadata length as proxy)
      const existingScreenshots = this.screenshotMetadata.length;

      // Only check quota if there's already 1+ screenshot (allow first one always)
      if (existingScreenshots >= 1) {
        const quotaStatus = this.quotaManager.getFeatureStatus('auto_stack_sessions');
        if (!quotaStatus.allowed) {
          // Show cursor message with limit info, but only once per session.
          if (this.cursorStatusManager && !this.autoStackLimitShownThisSession) {
            this.cursorStatusManager.showRecordingNote(
              MESSAGES.recordingNote.autoStackLimitReached(quotaStatus.used, quotaStatus.limit)
            );
            this.autoStackLimitShownThisSession = true;
          }
          this.emit('stackingDisabled', {
            itemId,
            message: 'Screenshot saved to Field Theory — open to stack manually',
          });
          return;
        }
      }
    }
    
    this.currentStack.push(itemId);
    
    // If we're currently recording or silentStacking, check if this is a screenshot and assign a figure label.
    if ((this.status === 'recording' || this.status === 'silentStacking') && this.clipboardManager) {
      const item = this.clipboardManager.getItem(itemId);
      if (item && (item.type === 'screenshot' || item.type === 'image')) {
        // Generate the next figure label (A, B, C... Z, AA, AB...).
        const figureLabel = this.generateFigureLabel(this.screenshotMetadata.length);
        
        // Generate a unique 5-char ID for searchability across all recordings.
        const figureId = this.clipboardManager.generateFigureId();
        
        // Calculate timestamp relative to recording start.
        const capturedAtMs = Date.now() - this.recordingStartTime;
        
        // Store metadata for later use when inserting references into transcript.
        this.screenshotMetadata.push({
          itemId,
          figureLabel,
          figureId,
          capturedAtMs,
        });

        // Update the item in the database with the figure label and unique ID.
        this.clipboardManager.updateFigureLabel(itemId, figureLabel, figureId);

        // Show warning when reaching 10 screenshots during recording.
        if (this.screenshotMetadata.length === 10 && this.cursorStatusManager) {
          this.cursorStatusManager.showRecordingNote(MESSAGES.recordingNote.tooManyImages);
        }
      }
    }

    this.emit('stackChanged', this.currentStack.length);
  }
  
  /**
   * Generate a figure label from an index (0 = 1, 1 = 2, 2 = 3, etc.)
   */
  private generateFigureLabel(index: number): string {
    return String(index + 1);
  }
  
  /**
   * Format a millisecond timestamp as MM:SS for display.
   */
  private formatTimestamp(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }
  
  /**
   * Parse timestamped whisper output and insert figure references inline.
   * Whisper outputs: [00:00:00.000 --> 00:00:05.000] This is the text.
   */
  private parseTimestampedOutput(output: string): string {
    // Parse segments: [HH:MM:SS.mmm --> HH:MM:SS.mmm] text
    const segmentRegex = /\[(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?\s*-->\s*(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?\]\s*(.+?)(?=\[\d{2}:\d{2}:\d{2}|$)/gs;
    
    const segments: Array<{ startMs: number; endMs: number; text: string }> = [];
    let match;
    
    while ((match = segmentRegex.exec(output)) !== null) {
      const startMs = this.parseTimestampToMs(match[1], match[2], match[3], match[4]);
      const endMs = this.parseTimestampToMs(match[5], match[6], match[7], match[8]);
      const text = match[9].trim();
      
      if (text.length > 0) {
        segments.push({ startMs, endMs, text });
      }
    }
    
    // Fallback: if no segments parsed, try line-by-line approach.
    if (segments.length === 0) {
      const lines = output.trim().split('\n');
      const lineRegex = /^\[(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?\s*-->\s*(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?\]\s*(.+)$/;
      
      for (const line of lines) {
        const lineMatch = line.match(lineRegex);
        if (lineMatch) {
          const startMs = this.parseTimestampToMs(lineMatch[1], lineMatch[2], lineMatch[3], lineMatch[4]);
          const endMs = this.parseTimestampToMs(lineMatch[5], lineMatch[6], lineMatch[7], lineMatch[8]);
          const text = lineMatch[9].trim();
          
          if (text.length > 0) {
            segments.push({ startMs, endMs, text });
          }
        }
      }
    }
    
    // If no segments parsed, fall back to appending figure references at the end.
    if (segments.length === 0) {
      const stripped = output.replace(/\[\d{2}:\d{2}:\d{2}(?:\.\d{3})?\s*-->\s*\d{2}:\d{2}:\d{2}(?:\.\d{3})?\]/g, '');
      return this.insertFigureReferences(stripped.trim());
    }
    
    // Sort screenshots by capture time.
    const sortedScreenshots = [...this.screenshotMetadata].sort(
      (a, b) => a.capturedAtMs - b.capturedAtMs
    );
    
    // For each segment, collect any screenshots captured during that segment.
    const segmentFigures: Map<number, string[]> = new Map();
    
    for (const screenshot of sortedScreenshots) {
      // Find the segment that was active when screenshot was captured.
      // A screenshot at time T belongs to the segment where startMs <= T <= endMs,
      // or the segment that ends closest before T if none contain it.
      let bestSegmentIndex = -1;
      let bestDistance = Infinity;
      
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        
        // Screenshot falls within this segment.
        if (screenshot.capturedAtMs >= seg.startMs && screenshot.capturedAtMs <= seg.endMs) {
          bestSegmentIndex = i;
          break;
        }
        
        // Screenshot is after segment end - track closest preceding segment.
        if (screenshot.capturedAtMs > seg.endMs) {
          const distance = screenshot.capturedAtMs - seg.endMs;
          if (distance < bestDistance) {
            bestDistance = distance;
            bestSegmentIndex = i;
          }
        }
      }
      
      // If screenshot is before all segments, attach to first segment.
      if (bestSegmentIndex === -1 && segments.length > 0) {
        bestSegmentIndex = 0;
      }
      
      if (bestSegmentIndex >= 0) {
        const existing = segmentFigures.get(bestSegmentIndex) || [];
        existing.push(screenshot.figureLabel);
        segmentFigures.set(bestSegmentIndex, existing);
      }
    }
    
    // Build final text with inline figure references.
    const resultParts: string[] = [];
    let totalFiguresAdded = 0;

    for (let i = 0; i < segments.length; i++) {
      let segmentText = segments[i].text;

      const figures = segmentFigures.get(i);
      if (figures && figures.length > 0) {
        // Insert figure refs at end of this segment.
        const figureRefs = figures.map(f => `[Figure ${f}]`).join(' ');
        segmentText = `${segmentText} ${figureRefs}`;
        totalFiguresAdded += figures.length;
      }

      resultParts.push(segmentText);
    }

    return resultParts.join(' ').trim();
  }
  
  /**
   * Parse timestamp components to milliseconds.
   */
  private parseTimestampToMs(hours: string, minutes: string, seconds: string, ms?: string): number {
    const h = parseInt(hours, 10) || 0;
    const m = parseInt(minutes, 10) || 0;
    const s = parseInt(seconds, 10) || 0;
    const milliseconds = parseInt(ms || '0', 10) || 0;
    
    return (h * 3600 + m * 60 + s) * 1000 + milliseconds;
  }
  
  /**
   * Insert figure references into the transcript text (fallback for non-timestamped output).
   * Appends all figure references at the end.
   */
  private insertFigureReferences(text: string): string {
    if (this.screenshotMetadata.length === 0) {
      return text;
    }
    
    // Sort by capture time.
    const sortedMetadata = [...this.screenshotMetadata].sort(
      (a, b) => a.capturedAtMs - b.capturedAtMs
    );
    
    // Append figure references at the end as a fallback.
    const figureRefs = sortedMetadata.map(meta => `[Figure ${meta.figureLabel}]`).join(' ');

    return `${text} ${figureRefs}`;
  }

  /**
   * Apply word substitutions to transcription text.
   * Replaces each "from" word with its "to" equivalent based on user preferences.
   * Uses word boundaries to avoid partial matches.
   */
  private applyWordSubstitutions(text: string): string {
    const substitutions = this.preferences.getPreference('wordSubstitutions') ?? [];
    
    if (substitutions.length === 0) {
      return text;
    }
    
    let result = text;
    let totalReplacements = 0;
    
    for (const { from, to } of substitutions) {
      if (!from || from === to) continue;
      
      // Use word boundaries to match whole words only (case-insensitive).
      // This prevents "main" from matching "maintain" or "mainly".
      const regex = new RegExp(`\\b${this.escapeRegex(from)}\\b`, 'gi');
      const matches = result.match(regex);
      
      if (matches) {
        result = result.replace(regex, to);
        totalReplacements += matches.length;
      }
    }

    return result;
  }

  /**
   * Escape special regex characters in a string.
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Get the bundle identifier of the frontmost application.
   */
  private async getFrontmostAppBundleId(): Promise<string | null> {
    try {
      const script = `
        tell application "System Events"
          set frontApp to first application process whose frontmost is true
          return (bundle identifier of frontApp)
        end tell
      `;
      const { stdout } = await execAsync(`osascript -e '${script}'`);
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  /**
   * Check if the frontmost application is a terminal/CLI.
   */
  private async isFrontmostAppTerminal(): Promise<boolean> {
    const bundleId = await this.getFrontmostAppBundleId();
    return isTerminalApp(bundleId);
  }

  /**
   * Format command references by converting [cmd:name.md] to [cmd1: name].
   * Used for multimodal apps where files are attached separately.
   */
  private formatCommandReferences(text: string): string {
    if (this.detectedCommands.length === 0) {
      return text;
    }

    let formattedText = text;
    this.detectedCommands.forEach((cmd, index) => {
      const cmdNum = index + 1;
      const refPattern = new RegExp(`\\[cmd:${cmd.name}\\.md\\]`, 'gi');
      formattedText = formattedText.replace(refPattern, `[cmd${cmdNum}: ${cmd.name}]`);
    });

    return formattedText;
  }

  /**
   * Format text for terminal output by converting [cmd:name.md] to numbered refs.
   * Adds a "Commands:" section at the end with file paths.
   */
  private formatCommandsForTerminal(text: string): string {
    // Use the common formatting
    let formattedText = this.formatCommandReferences(text);

    if (this.detectedCommands.length === 0) {
      return formattedText;
    }

    // Add the commands list at the end for terminals
    const commandPaths = this.detectedCommands.map((cmd, index) => {
      const cmdNum = index + 1;
      return `[cmd${cmdNum}: ${cmd.name}] ${cmd.filePath}`;
    });

    if (commandPaths.length > 0) {
      formattedText += '\n\nCommands:\n' + commandPaths.join('\n');
    }

    return formattedText;
  }

  /**
   * Append figure file paths at the end of text in scientific paper format.
   * The text should already have inline [Figure X] references inserted.
   * This adds a "Figures:" section at the end with the actual file paths.
   */
  private async addImagePathsToText(text: string, items: ClipboardItem[]): Promise<string> {
    const figurePaths: string[] = [];

    // Find all image items and export them
    for (const item of items) {
      if (item.imageData && item.figureLabel) {
        const imagePath = await this.clipboardManager!.exportImageToCache(item);
        if (imagePath) {
          // Use real path for terminal compatibility
          figurePaths.push(`Figure ${item.figureLabel}: ${imagePath}`);
        }
      }
    }

    // If we have figures, append them in scientific paper format
    if (figurePaths.length > 0) {
      return `${text}\n\n${figurePaths.join('\n')}\n\n`;
    }

    return text;
  }

  /**
   * Paste all items in the current stack.
   * Pastes text and images sequentially with delays between each.
   * Skips paste if sketch mode is active to avoid pasting into Excalidraw.
   * Skips paste if Field Theory itself is frontmost to avoid pasting into own UI.
   * @param clearAfter - Whether to clear the stack after pasting (default: true for auto-paste, false for manual)
   */
  async pasteStack(clearAfter: boolean = true): Promise<void> {
    const sketchModeActive = this.sketchModeChecker?.() ?? false;

    if (!this.clipboardManager || this.currentStack.length === 0) {
      return;
    }

    // Skip paste if draw canvas is open - user can manually Cmd+V if needed.
    if (sketchModeActive) {
      this.clearStack();
      return;
    }

    // Skip paste if Field Theory itself is frontmost - user may have clicked in our UI.
    // Content is still in clipboard, user can Cmd+V manually in their target app.
    const frontmostBundleId = await this.getFrontmostAppBundleId();
    if (frontmostBundleId === 'com.fieldtheory.app' || frontmostBundleId === 'com.fieldtheory.experimental') {
      this.emit('paste-failed', 'Field Theory has focus - press Cmd+V in your target app', this.lastTranscription);
      if (clearAfter) {
        this.clearStack();
      }
      return;
    }

    const items = this.currentStack
      .map(id => this.clipboardManager!.getItem(id))
      .filter((item): item is ClipboardItem => item !== null);

    if (items.length === 0) {
      return;
    }

    // Detect if frontmost app is a terminal/CLI or an IDE with terminal-like behavior
    const isTerminal = isTerminalApp(frontmostBundleId);
    const isIDE = isIDEWithTerminal(frontmostBundleId);

    // Check if we have a transcript with figures
    const hasTranscriptWithFigures =
      items.some(i => i.type === 'text' || i.type === 'transcript') &&
      items.some(i => i.imageData);

    // Find the last text/transcript item for appending figure paths (terminal only).
    const lastTextItemIndex = items.reduce((lastIdx, item, idx) =>
      (item.type === 'text' || item.type === 'transcript') ? idx : lastIdx, -1);

    // Paste in chronological order: oldest first (top), newest last (bottom).
    // This preserves the natural flow of conversation/context building.
    for (let itemIdx = 0; itemIdx < items.length; itemIdx++) {
      const item = items[itemIdx];
      if (item.type === 'text' || item.type === 'transcript') {
        // Use improved content if available and toggle is set.
        let textContent = (item.useImprovedVersion && item.improvedContent)
          ? item.improvedContent
          : (item.content || '');

        // Append figure paths at the end for terminals, but only on the LAST text item.
        // Non-terminals get inline [Figure X] refs without the file path list.
        if (this.currentStack.length > 1 && isTerminal && itemIdx === lastTextItemIndex) {
          textContent = await this.addImagePathsToText(textContent, items);
        }

        // Format command references based on target app type:
        // - Terminals: [cmd:name.md] -> [cmd1] with paths list
        // - IDEs (Cursor, VS Code, etc.): strip refs and append file paths as text
        // - Other apps: strip refs and paste files as attachments
        if (isTerminal && this.detectedCommands.length > 0) {
          textContent = this.formatCommandsForTerminal(textContent);
        } else if (isIDE && this.detectedCommands.length > 0) {
          // For IDEs like Cursor: strip command refs and append file paths as text
          // This allows the IDE to reference the command files directly
          textContent = textContent.replace(/\s*\[cmd:[^\]]+\]/g, '').trim();
          const pathList = this.detectedCommands.map(cmd => cmd.filePath).join('\n');
          textContent = textContent + '\n\n' + pathList;
        } else if (this.detectedCommands.length > 0) {
          // For other multimodal apps, format command references as [cmd1: name]
          // Files will be pasted as attachments below
          log.info(`Before formatCommandReferences: "${textContent}"`);
          textContent = this.formatCommandReferences(textContent);
          log.info(`After formatCommandReferences: "${textContent}"`);
        }

        clipboard.writeText(textContent);
        this.clipboardManager?.syncClipboardHash();
        await this.pasteText();

        // For non-terminal, non-IDE apps, paste command files as actual file attachments
        // using NSFilenamesPboardType so apps can receive them like Finder-copied files
        if (!isTerminal && !isIDE && this.detectedCommands.length > 0) {
          await new Promise(resolve => setTimeout(resolve, 100));
          const filePaths = this.detectedCommands.map(cmd => cmd.filePath);
          const plistData = plist.build(filePaths);
          clipboard.writeBuffer('NSFilenamesPboardType', Buffer.from(plistData));
          this.clipboardManager?.syncClipboardHash();
          await this.pasteText();
        }
      } else if (item.imageData) {
        if (isTerminal) {
          // For terminals, skip individual images if they're in the transcript's figure list.
          if (hasTranscriptWithFigures) {
            continue;
          }
          // For terminals without transcript, export image to file and paste path
          const imagePath = await this.clipboardManager!.exportImageToCache(item);
          if (imagePath) {
            // Use real path for terminal compatibility
            clipboard.writeText(imagePath);
            this.clipboardManager?.syncClipboardHash();
            await this.pasteText();
          }
        } else {
          // For non-terminals, paste the actual image so multimodal apps can see it.
          const imageBuffer = typeof item.imageData === 'string'
            ? Buffer.from(item.imageData, 'base64')
            : item.imageData;
          const image = nativeImage.createFromBuffer(imageBuffer);
          clipboard.writeImage(image);
          // Set hash directly from the buffer (avoids expensive toPNG() call)
          this.clipboardManager?.setClipboardHashFromBuffer(imageBuffer);
          await this.pasteText();
        }
      }

      // Blank line between items for all apps.
      if (itemIdx < items.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
        clipboard.writeText('\n');
        this.clipboardManager?.syncClipboardHash();
        await this.pasteText();
      }

      await new Promise(resolve => setTimeout(resolve, 100));
    }

    if (clearAfter) {
      this.clearStack();
    }
  }

  async separateIntoTasks(transcriptId: number): Promise<void> {
    if (!this.clipboardManager) {
      throw new Error('ClipboardManager not available');
    }

    const item = this.clipboardManager.getItem(transcriptId);
    if (!item || !item.content) {
      throw new Error('Transcript not found or has no content');
    }

    this.emit('separateIntoTasks', {
      transcriptId,
      text: item.content,
    });
  }

  /**
   * Cleanup resources.
   */
  destroy(): void {
    this.unregisterAbandonHotkey();

    // Unregister transcription hotkeys via HotkeyManager
    const hotkeyManager = getHotkeyManager();
    hotkeyManager.unregister('transcription');
    hotkeyManager.unregister('transcriptionSecondary');
    this.registeredHotkey = null;
    this.registeredSecondaryHotkey = null;

    if (this.whisperProcess) {
      this.whisperProcess.kill();
      this.whisperProcess = null;
    }
    this.stopQwenServer();
    this.overlay.destroy();
  }
}

