import { EventEmitter } from 'events';
import { app, globalShortcut, clipboard, nativeImage, Notification } from 'electron';
import { getHotkeyManager } from './hotkeyManager';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import http from 'http';
import net from 'net';
import { exec } from 'child_process';
import { promisify } from 'util';
import crypto from 'crypto';
import { NativeHelper } from './nativeHelper';
import {
  DEFAULT_MODEL_SIZE,
  isModelSize,
  ModelManager,
  ModelSize,
} from './modelManager';
import { PreferencesManager } from './preferences';
import { RecordingOverlay } from './recordingOverlay';
import { ClipboardManager, ClipboardItem, isTerminalApp, isIDEWithTerminal } from './clipboardManager';
import { SoundManager } from './soundManager';
import { QuotaManager } from './quotaManager';
import { AudioManager } from './audioManager';
import { CursorStatusManager } from './cursorStatusManager';
import { CommandsManager } from './commandsManager';
import { MESSAGES } from './messages';
import { StdioJsonServer } from './stdioJsonServer';
import type { TranscriptionEngine, HotMicEngine } from './types/transcribe';
import type { HotMicEngineReadiness, HotMicEngineStatus } from './types/hotMic';
import * as plist from 'plist';
import { createLogger } from './logger';

const log = createLogger('Transcriber');
const LOG_TRANSCRIPT_PAYLOADS = process.env.LOG_TRANSCRIPT_PAYLOADS === 'true';

const execAsync = promisify(exec);
const SAFE_FALLBACK_TRANSCRIPTION_HOTKEY = 'Option+Shift+Space';

/**
 * Transcription status states.
 */
export type TranscriptionStatus = 'idle' | 'silentStacking' | 'recording' | 'transcribing';

type TranscribeWithEngineOptions = {
  allowWhisperFallback?: boolean;
  whisperModelOverride?: ModelSize;
};

export type { HotMicEngineReadiness, HotMicEngineStatus };

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
  private hotkey: string = 'Option+/'; // Option+Slash on macOS
  private registeredHotkey: string | null = null; // Track currently registered transcription hotkey
  private secondaryHotkey: string | null = null; // Optional secondary hotkey for transcription
  private registeredSecondaryHotkey: string | null = null; // Track currently registered secondary hotkey
  private whisperProcess: ChildProcess | null = null;

  // Persistent JSON server for Qwen, MLX Whisper, and Parakeet engines.
  // All use the same stdin/stdout JSON protocol via StdioJsonServer.
  private qwenServer: StdioJsonServer | null = null;
  private mlxWhisperServer: StdioJsonServer | null = null;
  private parakeetServer: StdioJsonServer | null = null;
  private qwenFallbackLoggedForDisabledReason: boolean = false;

  // Persistent whisper-server (HTTP) state for whisper.cpp.
  private whisperServerProcess: ChildProcess | null = null;
  private whisperServerPort: number = 0;
  private whisperServerReady: boolean = false;
  private whisperServerReadyPromise: Promise<void> | null = null;
  private whisperServerLifecycleGeneration: number = 0;
  private whisperServerDisabledReason: string | null = null;
  private whisperServerModelPath: string | null = null;

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
  private hasShownQuotaMessageThisPeriod: boolean = false;
  private recordingStartTime: number = 0;
  private skipNextPasteFailedNotification: boolean = false;
  private priorityMicSkippedForQuota: boolean = false; // True when quota exhausted, skip tracking
  private autoStackLimitShownThisSession: boolean = false; // Only show limit message once per session
  private lastExternalPasteTargetBundleId: string | null = null;
  private static readonly FIELD_THEORY_BUNDLE_IDS = new Set([
    'com.fieldtheory.app',
    'com.fieldtheory.experimental',
    'com.github.electron',
  ]);

  // GPU fallback: if whisper-cli crashes due to Metal shader compilation failure,
  // disable GPU and retry with CPU-only mode for the rest of the session.
  private gpuDisabled: boolean = false;
  
  // Double-tap detection for silent stacking mode.
  // When user double-taps the hotkey, enters silentStacking instead of recording.
  private doubleTapThresholdMs: number = 300;
  private pendingHotkeyTimer: NodeJS.Timeout | null = null;

  // Hot Mic delegation — when Hot Mic is active, hotkey presses are delegated to it.
  private hotMicDelegate: {
    isActive: boolean;
    handleShortPress: () => Promise<void>;
    yieldToTranscriber: () => Promise<void>;
    resumeAfterTranscriber: () => Promise<void>;
  } | null = null;

  // Standard (push-to-talk) real-time chunk transcription state.
  private standardLiveTranscript: string = '';
  private standardLiveSegments: Array<{ text: string; endMs: number }> = [];
  private standardChunkReadyListener: ((filePath: string) => void) | null = null;
  private standardPendingChunkQueue: Array<{ filePath: string; readyAtMs: number }> = [];
  private standardChunkProcessingInFlight: boolean = false;
  private currentStandardHarvestMode: 'command' | 'dictation' | 'off' = 'off';
  private standardChunkCommandTriggered: boolean = false;
  private pendingImmediateSquaresAction: string | null = null;
  private pendingImmediateSquaresText: string = '';
  private static readonly STANDARD_MAX_CHUNK_QUEUE_DEPTH = 8;
  private static readonly STANDARD_HARVEST_BACKPRESSURE_QUEUE_THRESHOLD = 2;

  constructor(nativeHelper: NativeHelper, preferences: PreferencesManager, clipboardManager?: ClipboardManager, quotaManager?: QuotaManager, audioManager?: AudioManager, cursorStatusManager?: CursorStatusManager, commandsManager?: CommandsManager) {
    super();
    this.nativeHelper = nativeHelper;
    this.preferences = preferences;
    this.clipboardManager = clipboardManager || null;
    this.quotaManager = quotaManager || null;
    this.audioManager = audioManager || null;
    this.audioManager?.on('deviceEnforced', () => this.handleDeviceEnforced());
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
    this.nativeHelper.on('audioLevel', (level: number, isSpeech: boolean) => {
      if (this.status === 'recording') {
        this.overlay.updateAudioLevel(level);
        this.emit('audioLevel', level);
        // Check if this level indicates actual audio content.
        if (isSpeech) {
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

    // Keep track of the latest non-Field-Theory app so standard recording can
    // still paste to the user's target app when recording is toggled from our UI.
    this.nativeHelper.on('frontmostAppChanged', (appInfo: { bundleId?: string | null }) => {
      const bundleId = appInfo?.bundleId ?? null;
      if (bundleId && !this.isFieldTheoryBundleId(bundleId)) {
        this.lastExternalPasteTargetBundleId = bundleId;
      }
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
   * Initialize the transcriber manager.
   * Loads preferences and registers the global hotkey.
   */
  async init(): Promise<void> {
    // Load preferences
    await this.preferences.load();
    const configuredEngine = this.preferences.getPreference('transcriptionEngine');
    if (configuredEngine && configuredEngine !== 'whisper') {
      log.info(
        'Transcription engine "%s" is no longer exposed in settings; reverting to whisper',
        configuredEngine
      );
      await this.preferences.save({
        transcriptionEngine: 'whisper',
        hotMicTranscriptionEngine: 'default',
      });
    }
    this.hotkey = this.preferences.getPreference('transcriptionHotkey');
    this.secondaryHotkey = this.preferences.getPreference('transcriptionSecondaryHotkey') || null;

    // Set the selected model from preferences.
    // Validate against currently supported whisper.cpp model sizes.
    let selectedModel = this.preferences.getPreference('selectedModel');
    if (!isModelSize(selectedModel)) {
      selectedModel = DEFAULT_MODEL_SIZE;
      await this.preferences.save({ selectedModel: DEFAULT_MODEL_SIZE });
    }
    this.modelManager.setSelectedModel(selectedModel);

    // Overlay style hardcoded to 'rectangle' (cursor status indicator is primary UI)
    this.overlay.setOverlayStyle('rectangle');

    // Register global hotkey for normal transcription with a safe fallback
    await this.registerPrimaryHotkeyWithFallback(this.hotkey, true);

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

    void this.registerPrimaryHotkeyWithFallback(this.hotkey, false);
    if (this.secondaryHotkey) {
      void this.registerSecondaryHotkey(this.secondaryHotkey);
    }
  }

  private async registerPrimaryHotkeyWithFallback(hotkey: string, persistFallback: boolean): Promise<void> {
    const success = await this.registerHotkey(hotkey);
    if (success || !hotkey) {
      return;
    }

    if (hotkey === SAFE_FALLBACK_TRANSCRIPTION_HOTKEY) {
      return;
    }

    log.warn(
      'Primary hotkey "%s" is unavailable; falling back to %s',
      hotkey,
      SAFE_FALLBACK_TRANSCRIPTION_HOTKEY
    );

    const fallbackRegistered = await this.registerHotkey(SAFE_FALLBACK_TRANSCRIPTION_HOTKEY);
    if (!fallbackRegistered) {
      return;
    }

    if (persistFallback) {
      await this.preferences.save({ transcriptionHotkey: SAFE_FALLBACK_TRANSCRIPTION_HOTKEY });
    }
    this.emit('hotkeyChanged', SAFE_FALLBACK_TRANSCRIPTION_HOTKEY);
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
  private async handleHotkeyPress(_isSecondary: boolean): Promise<void> {
    // Hot mic active — flush and paste its buffer instead of starting a new recording.
    if (this.status === 'idle' && this.hotMicDelegate?.isActive) {
      await this.hotMicDelegate.handleShortPress();
      return;
    }

    if (this.status === 'idle') {
      if (this.pendingHotkeyTimer) {
        // Second tap within threshold → double-tap confirmed → silentStacking
        clearTimeout(this.pendingHotkeyTimer);
        this.pendingHotkeyTimer = null;
        await this.startSilentStacking();
      } else {
        // First tap → wait to see if it's a double-tap
        this.pendingHotkeyTimer = setTimeout(async () => {
          this.pendingHotkeyTimer = null;
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
        this.pendingHotkeyTimer = setTimeout(async () => {
          this.pendingHotkeyTimer = null;
          // Single-tap → start recording (keep existing stack)
          await this.startRecordingFromSilentStack();
        }, this.doubleTapThresholdMs);
      }
    } else if (this.status === 'recording') {
      // No double-tap detection needed here - just stop recording
      await this.stopRecordingAndTranscribe();
    }
    // Ignore if transcribing
  }

  private async handleDeviceEnforced(): Promise<void> {
    if (this.status !== 'recording' && this.status !== 'silentStacking') return;
    if (!this.nativeHelper.isRecordingActive()) return;
    log.info('Standard recording: restarting after device enforcement');
    try {
      await this.nativeHelper.stopRecording();
      await this.nativeHelper.startRecording();
    } catch (error) {
      log.error('Standard recording: failed to restart after device enforcement:', error);
    }
  }

  /**
   * Start recording audio.
   */
  private async startRecording(): Promise<void> {
    if (this.status !== 'idle') {
      return;
    }

    // Yield Hot Mic's recording so we can use the audio device
    let yieldedHotMic = false;
    if (this.hotMicDelegate?.isActive) {
      await this.hotMicDelegate.yieldToTranscriber();
      yieldedHotMic = true;
    }

    // Block recording until onboarding is complete.
    const onboardingComplete = this.preferences.getPreference('onboardingComplete');
    if (!onboardingComplete) {
      if (yieldedHotMic) {
        this.hotMicDelegate?.resumeAfterTranscriber().catch(() => {});
      }
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
        if (yieldedHotMic) {
          this.hotMicDelegate?.resumeAfterTranscriber().catch(() => {});
        }
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

      this.resetStandardRealtimeSession();
      this.attachStandardChunkListener();
      this.setStandardRealtimeHarvestMode();
      await this.nativeHelper.startRecording();
      log.info('Recording started');
    } catch (error) {
      log.error('Failed to start recording:', error);
      this.detachStandardChunkListener();
      this.clearStandardLiveTranscript();
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

      this.resetStandardRealtimeSession();
      this.attachStandardChunkListener();
      this.setStandardRealtimeHarvestMode();
      await this.nativeHelper.startRecording();
      log.info('Recording started from silent stack (keeping %d existing figures)', this.screenshotMetadata.length);
    } catch (error) {
      log.error('Failed to start recording from silent stack:', error);
      this.detachStandardChunkListener();
      this.clearStandardLiveTranscript();
      this.setStatus('idle');
      this.overlay.dismiss();
      this.unregisterAbandonHotkey();
      this.emit('error', error as Error);
    }
  }

  private resetStandardRealtimeSession(): void {
    this.standardLiveTranscript = '';
    this.standardLiveSegments = [];
    this.standardPendingChunkQueue = [];
    this.standardChunkProcessingInFlight = false;
    this.standardChunkCommandTriggered = false;
    this.pendingImmediateSquaresAction = null;
    this.pendingImmediateSquaresText = '';
    this.emit('standardLiveTranscript', '');
  }

  private clearStandardLiveTranscript(): void {
    this.standardLiveTranscript = '';
    this.standardLiveSegments = [];
    this.emit('standardLiveTranscript', '');
  }

  private attachStandardChunkListener(): void {
    if (this.standardChunkReadyListener) {
      this.detachStandardChunkListener();
    }
    this.standardChunkReadyListener = (filePath: string) => {
      const readyAtMs = this.recordingStartTime > 0
        ? Math.max(0, Date.now() - this.recordingStartTime)
        : 0;
      while (this.standardPendingChunkQueue.length >= TranscriberManager.STANDARD_MAX_CHUNK_QUEUE_DEPTH) {
        const dropped = this.standardPendingChunkQueue.shift();
        if (!dropped) break;
        log.warn(
          'Standard recording chunk queue full (%d), dropping oldest chunk: %s',
          TranscriberManager.STANDARD_MAX_CHUNK_QUEUE_DEPTH,
          dropped.filePath
        );
        void fs.promises.unlink(dropped.filePath).catch(() => {});
      }
      this.standardPendingChunkQueue.push({ filePath, readyAtMs });
      this.setStandardRealtimeHarvestMode();
      void this.processStandardChunkQueue();
    };
    this.nativeHelper.on('recordingChunkReady', this.standardChunkReadyListener);
  }

  private detachStandardChunkListener(): void {
    if (!this.standardChunkReadyListener) return;
    this.nativeHelper.removeListener('recordingChunkReady', this.standardChunkReadyListener);
    this.standardChunkReadyListener = null;
    this.standardPendingChunkQueue = [];
    this.standardChunkProcessingInFlight = false;
    this.currentStandardHarvestMode = 'off';
    this.nativeHelper.setHarvestMode('off');
  }

  private getStandardRealtimePressureDepth(): number {
    const queueDepth = Array.isArray(this.standardPendingChunkQueue)
      ? this.standardPendingChunkQueue.length
      : 0;
    return queueDepth + (this.standardChunkProcessingInFlight ? 1 : 0);
  }

  private getStandardRealtimeHarvestMode(): 'command' | 'dictation' {
    const queueDepth = this.getStandardRealtimePressureDepth();
    if (queueDepth === 0) {
      return 'dictation';
    }

    const engine = this.preferences.getPreference('transcriptionEngine') || 'whisper';
    if (engine === 'mlx-whisper' && queueDepth > 0) {
      return 'command';
    }

    if (queueDepth >= TranscriberManager.STANDARD_HARVEST_BACKPRESSURE_QUEUE_THRESHOLD) {
      return 'command';
    }

    return 'dictation';
  }

  private getEngineSilenceMs(): number | undefined {
    const engine = this.preferences.getPreference('transcriptionEngine') || 'whisper';
    if (engine === 'parakeet') return 0;
    return undefined;
  }

  private setStandardRealtimeHarvestMode(): void {
    if (this.status !== 'recording') return;
    const mode = this.getStandardRealtimeHarvestMode();
    if (mode === this.currentStandardHarvestMode) return;
    this.currentStandardHarvestMode = mode;
    this.nativeHelper.setHarvestMode(mode, this.getEngineSilenceMs());
  }

  private async processStandardChunkQueue(): Promise<void> {
    if (this.standardChunkProcessingInFlight) return;
    this.standardChunkProcessingInFlight = true;
    try {
      while (this.standardPendingChunkQueue.length > 0) {
        const chunk = this.standardPendingChunkQueue.shift();
        if (!chunk) continue;
        await this.onStandardChunkReady(chunk.filePath, chunk.readyAtMs);
      }
    } finally {
      this.standardChunkProcessingInFlight = false;
      this.setStandardRealtimeHarvestMode();
    }
  }

  private async waitForStandardChunkDrain(timeoutMs = 1200): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (this.standardChunkProcessingInFlight || this.standardPendingChunkQueue.length > 0) {
      if (Date.now() >= deadline) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  private async onStandardChunkReady(wavPath: string, chunkReadyAtMs?: number): Promise<void> {
    const pipelineStart = performance.now();
    try {
      if (this.status !== 'recording') return;
      if (this.pendingImmediateSquaresAction) return;

      const engine = this.preferences.getPreference('transcriptionEngine') || 'whisper';
      const asrStart = performance.now();
      const rawChunkText = await this.transcribeWithEngineFallback(wavPath, engine);
      const asrMs = Math.round(performance.now() - asrStart);
      const chunkText = this.sanitizeTranscriptText(rawChunkText);
      const liveChunkText = this.stripFigureReferences(chunkText);
      if (!liveChunkText) return;

      this.standardLiveTranscript = [this.standardLiveTranscript, liveChunkText]
        .map((part) => part.trim())
        .filter(Boolean)
        .join(' ')
        .trim();

      this.standardLiveSegments.push({
        text: liveChunkText,
        endMs: chunkReadyAtMs ?? (this.recordingStartTime > 0 ? Date.now() - this.recordingStartTime : 0),
      });

      this.emit('standardLiveTranscript', this.standardLiveTranscript);

      if (this.squaresManager) {
        const cmdStart = performance.now();
        const tailMatch = this.squaresManager.parseVoiceCommandFromTail(this.standardLiveTranscript.toLowerCase());
        const cmdMs = Math.round(performance.now() - cmdStart);
        if (tailMatch) {
          const totalMs = Math.round(performance.now() - pipelineStart);
          log.info(
            '[timing] standard chunk: asr=%dms cmd=%dms total=%dms engine=%s command=%s',
            asrMs, cmdMs, totalMs, engine, tailMatch.action
          );
          this.pendingImmediateSquaresAction = tailMatch.action;
          this.pendingImmediateSquaresText = tailMatch.remainingText.trim();
          this.standardLiveTranscript = this.pendingImmediateSquaresText;
          this.emit('standardLiveTranscript', this.standardLiveTranscript);

          if (!this.standardChunkCommandTriggered) {
            this.standardChunkCommandTriggered = true;
            void this.stopRecordingAndTranscribe();
          }
          return;
        }
      }

      const totalMs = Math.round(performance.now() - pipelineStart);
      log.debug(
        '[timing] standard chunk: asr=%dms total=%dms engine=%s',
        asrMs, totalMs, engine
      );
    } catch (error) {
      log.error('Standard chunk transcription failed:', error);
    } finally {
      void fs.promises.unlink(wavPath).catch(() => {});
    }
  }

  private sanitizeTranscriptText(text: string): string {
    const trimmedText = text ? text.trim() : '';
    if (!trimmedText) return '';

    // Mirror Hot Mic chunk normalization for consistent standard-mode behavior:
    // remove metadata-like bracket artifacts, strip parentheticals, apply substitutions,
    // then normalize casing/chunk-ending periods.
    let cleanedText = trimmedText.replace(/\s*\[(?!Figure\s+[A-Za-z0-9]+\])[^\]]+\]\s*/g, ' ').trim();
    cleanedText = cleanedText.replace(/\([^)]*\)/g, ' ').trim();
    cleanedText = cleanedText.replace(/[<>]{2,}/g, ' ').trim();
    cleanedText = cleanedText.replace(/\b(mm[-\s]?hmm|mm+|hmm+)\b/gi, ' ').trim();
    cleanedText = this.applyWordSubstitutions(cleanedText);
    cleanedText = cleanedText.replace(/\s+/g, ' ').trim();
    return cleanedText.toLowerCase().replace(/\.+$/, '').trim();
  }

  private stripFigureReferences(text: string): string {
    if (!text) return '';
    return text
      .replace(/\s*\[Figure\s+[A-Za-z0-9]+\]\s*/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
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
    if (this.isFieldTheoryBundleId(frontmostBundleId)) {
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
            clipboard.writeText(this.addFollowupTypingSpace(`Figure ${figureLabel}\n\`${imagePath.replace(os.homedir(), '~')}\``));
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
   */
  private async stopRecordingAndTranscribe(): Promise<void> {
    if (this.status !== 'recording') {
      return;
    }

    try {
      // Unregister abandon hotkey.
      this.unregisterAbandonHotkey();
      
      // Play stop recording sound (user-configurable).
      this.soundManager.play('recordingStop');

      // Force one final harvest snapshot so trailing speech is captured even if
      // the user stops before Swift's silence detector emits a chunk.
      if (!this.pendingImmediateSquaresAction) {
        try {
          const tailChunkPath = await this.nativeHelper.snapshotRecording();
          const readyAtMs = this.recordingStartTime > 0
            ? Math.max(0, Date.now() - this.recordingStartTime)
            : 0;
          this.standardPendingChunkQueue.push({ filePath: tailChunkPath, readyAtMs });
          void this.processStandardChunkQueue();
        } catch {
          // Snapshot can fail when no audio has accumulated yet; continue with normal stop.
        }
      }
      
      // Stop recording and get WAV file path
      const wavPath = await this.nativeHelper.stopRecording();
      await this.waitForStandardChunkDrain();
      this.detachStandardChunkListener();

      const immediateSquaresAction = this.pendingImmediateSquaresAction;
      this.pendingImmediateSquaresAction = null;
      const immediateSquaresText = this.pendingImmediateSquaresText;
      this.pendingImmediateSquaresText = '';

      // Track priority mic usage if a priority device was selected during recording.
      await this.trackPriorityMicUsage();

      // Switch to transcribing state
      this.setStatus('transcribing');
      this.overlay.showTranscribing();

      const finalPassStart = performance.now();
      let cleanedText = '';
      const liveTranscriptFallback = this.standardLiveTranscript.trim();
      let finalAsrMs = 0;

      if (immediateSquaresAction) {
        // Immediate Squares actions are finalized from the detected tail text so we can
        // execute the command deterministically even if recording is stopped mid-phrase.
        cleanedText = this.sanitizeTranscriptText(immediateSquaresText);
      } else {
        const engine = this.preferences.getPreference('transcriptionEngine') || 'whisper';

        // With realtime chunking, the tail file from stopRecording() only contains audio
        // after the last snapshot — often just silence. If live chunks already produced a
        // transcript, skip the final-pass ASR on the tiny tail and use it directly.
        const tailFileSize = await fs.promises.stat(wavPath).then(s => s.size).catch(() => Infinity);
        const hasLiveTranscript = liveTranscriptFallback.length > 0;
        // 32000 bytes ≈ 0.5s of 16kHz float32 mono — minimum for a recognizable word.
        const tailTooSmall = tailFileSize < 32000;

        if (hasLiveTranscript && tailTooSmall) {
          // Tail is just silence/header — use the live transcript directly.
          cleanedText = this.sanitizeTranscriptText(liveTranscriptFallback);
          void fs.promises.unlink(wavPath).catch(() => {});
          log.debug('Final-pass: using live transcript (%d chars, tail=%d bytes)', cleanedText.length, tailFileSize);
        } else {
          // Full-file pass: Whisper benefits from full context; also used when there
          // are no live chunks (short recording with no harvest).
          if (engine === 'whisper') {
            const selectedModel = this.modelManager.getSelectedModel();
            const modelAvailable = await this.modelManager.isModelAvailable();
            if (!modelAvailable) {
              this.clearStandardLiveTranscript();
              this.setStatus('idle');
              this.handleOverlayAfterTranscription();
              this.emit('error', new Error(`Model "${selectedModel}" not available. Please download the model first.`));
              return;
            }
          }

          const asrStart = performance.now();
          const text = await this.transcribeWithEngineFallback(wavPath, engine);
          finalAsrMs = Math.round(performance.now() - asrStart);
          cleanedText = this.sanitizeTranscriptText(text);

          // If full-file ASR returned empty but live chunks had content, use them.
          if (cleanedText.length === 0 && hasLiveTranscript) {
            cleanedText = this.sanitizeTranscriptText(liveTranscriptFallback);
            log.debug('Final-pass ASR empty; using live transcript (%d chars)', cleanedText.length);
          }
        }
      }

      this.clearStandardLiveTranscript();

      // Check for Squares voice commands (e.g., "grid", "focus", "horizontal").
      // If the transcription is a window management command, execute it and skip pasting.
      let deferredSquaresAction = immediateSquaresAction;
      if (cleanedText.length === 0) {
        if (deferredSquaresAction && this.squaresManager) {
          await this.squaresManager.executeAction(deferredSquaresAction);
          this.setStatus('idle');
          this.handleOverlayAfterTranscription();
          return;
        }
        // Still stack screenshots if any were taken during recording (no audio).
        await this.stackScreenshotsIfAny();
        this.setStatus('idle');
        this.overlay.showStatus(MESSAGES.overlay.noAudioFound);
        return;
      }

      if (!deferredSquaresAction && this.squaresManager) {
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
      const cmdDetectStart = performance.now();
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
      const cmdDetectMs = Math.round(performance.now() - cmdDetectStart);

      // Insert inline [Figure N] references for screenshots taken during recording.
      cleanedText = this.insertFigureReferences(cleanedText);

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
          
          this.emit('stackChanged', this.screenshotMetadata.length);
        }
      }
      
      this.lastTranscription = cleanedText;

      // Transcript improvement is disabled in this release.
      const finalText = cleanedText;

      // Update lastTranscription with the final text.
      this.lastTranscription = finalText;

      // Paste, check accessibility in parallel for UI feedback.
      // Don't clear stack after auto-paste so Super Paste (Cmd+Shift+V) can re-paste if needed.
      // Stack is cleared when next recording starts.
      const pasteStart = performance.now();
      const accessibilityCheckPromise = this.nativeHelper.checkFocusedTextInput();
      await this.pasteStack(false);
      this.emit('stackChanged', 0);
      if (deferredSquaresAction && this.squaresManager) {
        await this.squaresManager.executeAction(deferredSquaresAction);
      }
      const pasteMs = Math.round(performance.now() - pasteStart);
      const finalTotalMs = Math.round(performance.now() - finalPassStart);
      this.emit('result', finalText);

      log.info(
        '[timing] final pass: asr=%dms cmd=%dms paste=%dms total=%dms%s',
        finalAsrMs, cmdDetectMs, pasteMs, finalTotalMs,
        this.detectedCommands.length > 0
          ? ` commands=${this.detectedCommands.map(c => c.name).join(',')}`
          : ''
      );

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
      this.detachStandardChunkListener();
      this.clearStandardLiveTranscript();
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
      this.detachStandardChunkListener();
      this.clearStandardLiveTranscript();
      this.setStatus('idle');
      this.hasAudioContent = false;
      this.currentStack = [];
      this.screenshotMetadata = [];
      this.overlay.showStatus(MESSAGES.overlay.cancelled);
      this.unregisterAbandonHotkey();
    } catch (error) {
      log.error('Failed to cancel recording:', error);
      this.detachStandardChunkListener();
      this.clearStandardLiveTranscript();
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
    await this.preferences.save({ autoImproveTranscripts: false });
  }

  /**
   * Get whether auto-improve is enabled for transcripts.
   * Default is false (disabled) for new users.
   */
  getAutoImprove(): boolean {
    return false;
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
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'scripts', 'qwen-transcribe.py');
    }
    // __dirname in compiled code is mac-app/electron-dist/main
    // So we need to go up 2 levels: main -> electron-dist -> mac-app
    const macAppRoot = path.resolve(__dirname, '../..');
    return path.join(macAppRoot, 'scripts', 'qwen-transcribe.py');
  }

  /**
   * Get the path to the Python interpreter in the Qwen venv.
   */
  private getQwenPythonPath(): string {
    if (app.isPackaged) {
      // In production the app bundle is read-only, so install the venv in userData.
      return path.join(app.getPath('userData'), 'build-qwen', 'venv', 'bin', 'python');
    }
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
      await this.ensureQwenPythonCompatible(pythonPath);
      return true;
    } catch {
      return false;
    }
  }

  private isQwenInstalledSync(): boolean {
    try {
      return fs.existsSync(this.getQwenPythonPath()) && fs.existsSync(this.getQwenScriptPath());
    } catch {
      return false;
    }
  }

  /**
   * Run a lightweight python probe to get major/minor version for Qwen runtime checks.
   * We intentionally avoid importing mlx here to prevent crash loops on bad environments.
   */
  private probeQwenPythonVersion(pythonPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(
        pythonPath,
        ['-c', 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}")'],
        { stdio: ['ignore', 'pipe', 'pipe'] }
      );

      let stdout = '';
      let stderr = '';
      let settled = false;

      const done = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        fn();
      };

      const timeout = setTimeout(() => {
        done(() => {
          proc.kill('SIGTERM');
          reject(new Error('Timed out while probing Qwen Python runtime'));
        });
      }, 5000);

      proc.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });
      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });
      proc.on('error', (error) => {
        done(() => {
          reject(new Error(`Failed to launch Qwen Python probe: ${error.message}`));
        });
      });
      proc.on('close', (code, signal) => {
        done(() => {
          if (code !== 0) {
            const details = stderr.trim() || stdout.trim() || `exit code ${code ?? 'unknown'}`;
            const signalSuffix = signal ? `, signal ${signal}` : '';
            reject(new Error(`Qwen Python probe failed (${details}${signalSuffix})`));
            return;
          }
          const version = stdout.trim();
          if (!version) {
            reject(new Error('Qwen Python probe returned an empty version string'));
            return;
          }
          resolve(version);
        });
      });
    });
  }

  private async ensureQwenPythonCompatible(pythonPath: string): Promise<void> {
    const version = await this.probeQwenPythonVersion(pythonPath);
    const match = version.match(/^(\d+)\.(\d+)\./);
    if (!match) {
      throw new Error(`Unable to parse Qwen Python version "${version}"`);
    }

    const major = Number(match[1]);
    const minor = Number(match[2]);
    if (major < 3 || (major === 3 && minor < 10)) {
      throw new Error(
        `Qwen requires Python 3.10+ in its virtual environment (found ${version}). ` +
        'Run Qwen setup from Settings > Transcription after installing Homebrew Python (brew install python).'
      );
    }

    if (major > 3 || (major === 3 && minor >= 14)) {
      throw new Error(
        `Qwen currently supports Python 3.10-3.13 in its virtual environment (found ${version}). ` +
        'Install Python 3.12 (brew install python@3.12), then rerun Qwen setup from Settings > Transcription.'
      );
    }
  }

  /**
   * Get or create the Qwen StdioJsonServer instance.
   * Lazily initialized because paths depend on runtime state.
   */
  private getOrCreateQwenServer(): StdioJsonServer {
    if (!this.qwenServer) {
      const pythonPath = this.getQwenPythonPath();
      this.qwenServer = new StdioJsonServer({
        name: 'Qwen',
        command: pythonPath,
        args: [this.getQwenScriptPath(), '--server'],
        preStart: () => this.ensureQwenPythonCompatible(pythonPath),
      });
    }
    return this.qwenServer;
  }

  private startQwenServer(): Promise<void> {
    return this.getOrCreateQwenServer().start();
  }

  stopQwenServer(): void {
    this.qwenServer?.stop();
  }

  private sendQwenCommand(cmd: Record<string, unknown>) {
    return this.getOrCreateQwenServer().send(cmd);
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
      const message = (error as Error)?.message || '';
      const isFatalQwenRuntimeError =
        message.includes('Qwen requires Python 3.10+') ||
        message.includes('Qwen currently supports Python 3.10-3.13') ||
        message.includes('Qwen server exited during startup with code 134') ||
        message.includes('Qwen server exited with code 134') ||
        message.includes('MLX runtime crashed');
      const shouldRetry = !isFatalQwenRuntimeError;
      if (!shouldRetry) {
        const server = this.getOrCreateQwenServer();
        if (!server.disabledReason) {
          server.disable(message || 'Qwen runtime is unavailable in this session');
        }
        throw error;
      }

      // One retry: restart server and try again
      log.warn('Qwen transcription failed, restarting server: %s', (error as Error).message);
      this.stopQwenServer();
      return await doTranscribe();
    }
  }

  /**
   * Transcribe with the configured engine, falling back to Whisper if Qwen fails
   * and a Whisper model is available locally.
   */
  private async transcribeWithEngineFallback(
    wavPath: string,
    engine: TranscriptionEngine,
    options: TranscribeWithEngineOptions = {}
  ): Promise<string> {
    const allowWhisperFallback = options.allowWhisperFallback ?? true;
    const whisperModelOverride = options.whisperModelOverride;

    // Whisper (whisper.cpp) — direct path, no fallback needed.
    if (engine === 'whisper') {
      return this.transcribe(wavPath, whisperModelOverride);
    }

    // Parakeet (NVIDIA Parakeet TDT 0.6B v2 via onnx-asr).
    // Falls back to whisper.cpp if server fails and a model is available.
    if (engine === 'parakeet') {
      try {
        return await this.transcribeWithParakeet(wavPath);
      } catch (parakeetError) {
        if (!allowWhisperFallback) throw parakeetError;

        const whisperAvailable = whisperModelOverride
          ? await this.modelManager.isModelAvailableForSize(whisperModelOverride)
          : await this.modelManager.isModelAvailable();
        if (!whisperAvailable) throw parakeetError;

        log.warn('Parakeet failed, falling back to whisper.cpp: %s', (parakeetError as Error).message);
        this.lastHotMicUsedWhisperFallback = true;

        try {
          return await this.transcribe(wavPath, whisperModelOverride);
        } catch (whisperError) {
          throw new Error(
            `Parakeet failed: ${(parakeetError as Error).message}; Whisper fallback failed: ${(whisperError as Error).message}`
          );
        }
      }
    }

    // MLX Whisper — use the mlx-whisper persistent server.
    // Falls back to whisper.cpp if server fails and a model is available.
    if (engine === 'mlx-whisper') {
      try {
        return await this.transcribeWithMlxWhisper(wavPath);
      } catch (mlxError) {
        if (!allowWhisperFallback) throw mlxError;

        const whisperAvailable = whisperModelOverride
          ? await this.modelManager.isModelAvailableForSize(whisperModelOverride)
          : await this.modelManager.isModelAvailable();
        if (!whisperAvailable) throw mlxError;

        log.warn('MLX Whisper failed, falling back to whisper.cpp: %s', (mlxError as Error).message);
        this.lastHotMicUsedWhisperFallback = true;

        try {
          return await this.transcribe(wavPath, whisperModelOverride);
        } catch (whisperError) {
          throw new Error(
            `MLX Whisper failed: ${(mlxError as Error).message}; Whisper fallback failed: ${(whisperError as Error).message}`
          );
        }
      }
    }

    // Qwen — falls back to whisper.cpp on failure.
    try {
      return await this.transcribeWithQwen(wavPath);
    } catch (qwenError) {
      if (!allowWhisperFallback) {
        throw qwenError;
      }

      const whisperAvailable = whisperModelOverride
        ? await this.modelManager.isModelAvailableForSize(whisperModelOverride)
        : await this.modelManager.isModelAvailable();
      if (!whisperAvailable) {
        throw qwenError;
      }

      const qwenMessage = (qwenError as Error).message;
      const qwenDisabled = this.qwenServer?.disabledReason ?? null;
      const isDisabledReason = qwenDisabled !== null && qwenMessage === qwenDisabled;
      if (!isDisabledReason || !this.qwenFallbackLoggedForDisabledReason) {
        log.warn(
          'Qwen transcription failed, falling back to Whisper: %s',
          qwenMessage
        );
        if (isDisabledReason) {
          this.qwenFallbackLoggedForDisabledReason = true;
        }
      }

      this.lastHotMicUsedWhisperFallback = true;

      try {
        return await this.transcribe(wavPath, whisperModelOverride);
      } catch (whisperError) {
        throw new Error(
          `Qwen failed: ${(qwenError as Error).message}; Whisper fallback failed: ${(whisperError as Error).message}`
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Persistent whisper-server management
  //
  // The whisper-server binary (from whisper.cpp) runs as a local HTTP server
  // that keeps the GGML model loaded in GPU/CPU memory. This eliminates the
  // ~500ms cold-start penalty of spawning whisper-cli per chunk, bringing
  // chunk transcription latency down to ~50-100ms for short audio.
  // ---------------------------------------------------------------------------

  /**
   * Find an available TCP port by briefly binding to port 0.
   */
  private findFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const srv = net.createServer();
      srv.listen(0, '127.0.0.1', () => {
        const addr = srv.address();
        if (!addr || typeof addr === 'string') {
          srv.close(() => reject(new Error('Could not determine port')));
          return;
        }
        const port = addr.port;
        srv.close(() => resolve(port));
      });
      srv.on('error', reject);
    });
  }

  /**
   * Get the path to the whisper-server binary.
   */
  private getWhisperServerPath(): string {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'whisper-server');
    } else {
      const repoRoot = path.resolve(__dirname, '../../..');
      return path.join(repoRoot, 'build-whisper', 'bin', 'whisper-server');
    }
  }

  /**
   * Check whether whisper-server binary exists on disk.
   */
  private isWhisperServerAvailable(): boolean {
    try {
      return fs.existsSync(this.getWhisperServerPath());
    } catch {
      return false;
    }
  }

  /**
   * Start the persistent whisper-server process.
   * Loads the model once and listens on a random localhost port.
   * Returns when the server reports healthy via GET /health.
   */
  private startWhisperServer(modelOverride?: ModelSize): Promise<void> {
    if (this.whisperServerDisabledReason) {
      return Promise.reject(new Error(this.whisperServerDisabledReason));
    }

    const modelPath = modelOverride
      ? this.modelManager.getModelPathForSize(modelOverride)
      : this.modelManager.getModelPath();

    // If the server is already running with the same model, reuse it.
    if (this.whisperServerReady && this.whisperServerProcess && this.whisperServerModelPath === modelPath) {
      return Promise.resolve();
    }

    // If currently starting with the same model, wait for it.
    if (this.whisperServerReadyPromise && this.whisperServerModelPath === modelPath) {
      return this.whisperServerReadyPromise;
    }

    // If a different model is requested, stop the old server first.
    if (this.whisperServerProcess && this.whisperServerModelPath !== modelPath) {
      this.stopWhisperServer();
    }

    this.whisperServerModelPath = modelPath;
    const startupGeneration = ++this.whisperServerLifecycleGeneration;

    this.whisperServerReadyPromise = (async () => {
      const startupInvalidated = (): boolean => startupGeneration !== this.whisperServerLifecycleGeneration;

      const serverPath = this.getWhisperServerPath();
      if (!fs.existsSync(serverPath)) {
        this.whisperServerReadyPromise = null;
        throw new Error('whisper-server binary not found. Run npm run build:whisper to build it.');
      }

      const port = await this.findFreePort();

      if (startupInvalidated()) {
        this.whisperServerReadyPromise = null;
        throw new Error('whisper-server startup cancelled');
      }

      const args = [
        '-m', modelPath,
        '--host', '127.0.0.1',
        '--port', String(port),
        '--language', 'en',
      ];

      if (this.gpuDisabled) {
        args.push('-ng');
      }

      const proc = spawn(serverPath, args, {
        env: { ...process.env, NO_COLOR: '1' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      if (startupInvalidated()) {
        proc.kill('SIGTERM');
        this.whisperServerReadyPromise = null;
        throw new Error('whisper-server startup cancelled');
      }

      this.whisperServerProcess = proc;
      this.whisperServerPort = port;

      // Wait for the server to become healthy via polling /health.
      // The server prints "whisper server listening at ..." to stdout when ready,
      // but polling /health is more robust.
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        let stderrBuffer = '';

        proc.stderr?.on('data', (data: Buffer) => {
          stderrBuffer += data.toString();
        });

        proc.on('error', (error) => {
          if (!settled) {
            settled = true;
            this.whisperServerProcess = null;
            this.whisperServerReady = false;
            this.whisperServerReadyPromise = null;
            reject(new Error(`Failed to start whisper-server: ${error.message}`));
          }
        });

        proc.on('close', (code) => {
          if (startupInvalidated()) {
            if (!settled) { settled = true; reject(new Error('whisper-server startup cancelled')); }
            return;
          }
          if (!settled) {
            settled = true;
            this.whisperServerProcess = null;
            this.whisperServerReady = false;
            this.whisperServerReadyPromise = null;
            const metalCrash = this.isMetalError(stderrBuffer);
            const hint = metalCrash ? ' (Metal GPU error — will fall back to whisper-cli)' : '';
            reject(new Error(`whisper-server exited during startup with code ${code}${hint}`));
          } else {
            this.whisperServerProcess = null;
            this.whisperServerReady = false;
            this.whisperServerReadyPromise = null;
            log.warn('whisper-server process exited (code %d), will restart on next transcription', code);
          }
        });

        // Poll /health every 200ms, give up after 30s.
        const maxWaitMs = 30_000;
        const pollIntervalMs = 200;
        const deadline = Date.now() + maxWaitMs;

        const poll = () => {
          if (settled || startupInvalidated()) return;
          if (Date.now() > deadline) {
            settled = true;
            proc.kill('SIGTERM');
            this.whisperServerProcess = null;
            this.whisperServerReadyPromise = null;
            reject(new Error('whisper-server startup timed out after 30s'));
            return;
          }

          const req = http.get(`http://127.0.0.1:${port}/health`, (res) => {
            let body = '';
            res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
            res.on('end', () => {
              if (settled || startupInvalidated()) return;
              try {
                const parsed = JSON.parse(body);
                if (parsed.status === 'ok') {
                  settled = true;
                  this.whisperServerReady = true;
                  log.info('whisper-server ready on port %d (model: %s)', port, path.basename(modelPath));
                  resolve();
                  return;
                }
              } catch { /* not ready yet */ }
              setTimeout(poll, pollIntervalMs);
            });
          });

          req.on('error', () => {
            if (!settled && !startupInvalidated()) {
              setTimeout(poll, pollIntervalMs);
            }
          });
          req.end();
        };

        setTimeout(poll, pollIntervalMs);
      });
    })();

    return this.whisperServerReadyPromise;
  }

  /**
   * Kill the persistent whisper-server. Called on suspend/sleep or model change.
   * The next transcription will restart it automatically.
   */
  stopWhisperServer(): void {
    this.whisperServerLifecycleGeneration += 1;
    if (this.whisperServerProcess) {
      this.whisperServerProcess.kill('SIGTERM');
      this.whisperServerProcess = null;
    }
    this.whisperServerReady = false;
    this.whisperServerReadyPromise = null;
  }

  /**
   * Transcribe a WAV file via the persistent whisper-server HTTP endpoint.
   * Sends the file as multipart/form-data to POST /inference.
   */
  private transcribeViaWhisperServer(wavPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const needTimestamps = this.screenshotMetadata.length > 0;
      const fileContent = fs.readFileSync(wavPath);
      const boundary = `----FieldTheory${crypto.randomBytes(8).toString('hex')}`;

      // Build multipart body with the audio file and response format.
      const parts: Buffer[] = [];

      // File part
      parts.push(Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${path.basename(wavPath)}"\r\n` +
        `Content-Type: audio/wav\r\n\r\n`
      ));
      parts.push(fileContent);
      parts.push(Buffer.from('\r\n'));

      // Response format — "text" gives us just the transcript text, no JSON wrapper.
      const format = needTimestamps ? 'verbose_json' : 'text';
      parts.push(Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="response_format"\r\n\r\n` +
        `${format}\r\n`
      ));

      // Temperature 0 for deterministic output (matching whisper-cli defaults).
      parts.push(Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="temperature"\r\n\r\n` +
        `0.0\r\n`
      ));

      parts.push(Buffer.from(`--${boundary}--\r\n`));

      const body = Buffer.concat(parts);

      const req = http.request({
        hostname: '127.0.0.1',
        port: this.whisperServerPort,
        path: '/inference',
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length,
        },
        timeout: 120_000,
      }, (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`whisper-server returned HTTP ${res.statusCode}: ${data}`));
            return;
          }

          try {
            if (needTimestamps) {
              // verbose_json includes segments with start/end times.
              const parsed = JSON.parse(data);
              if (parsed.segments && Array.isArray(parsed.segments)) {
                const timestampedLines = parsed.segments.map((seg: any) => {
                  const t0 = this.formatSecondsAsTimestamp(seg.start);
                  const t1 = this.formatSecondsAsTimestamp(seg.end);
                  return `[${t0} --> ${t1}]${seg.text}`;
                });
                resolve(this.parseTimestampedOutput(timestampedLines.join('\n')));
              } else {
                resolve((parsed.text || '').trim());
              }
            } else {
              // "text" format returns plain text directly.
              resolve(data.trim());
            }
          } catch {
            resolve(data.trim());
          }
        });
      });

      req.on('error', (err) => {
        reject(new Error(`whisper-server request failed: ${err.message}`));
      });
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('whisper-server request timed out (120s)'));
      });
      req.write(body);
      req.end();
    });
  }

  /**
   * Format seconds as HH:MM:SS.mmm for whisper-server verbose_json timestamps.
   */
  private formatSecondsAsTimestamp(seconds: number): string {
    const totalMs = Math.round(seconds * 1000);
    const ms = totalMs % 1000;
    const totalSec = Math.floor(totalMs / 1000);
    const s = totalSec % 60;
    const m = Math.floor(totalSec / 60) % 60;
    const h = Math.floor(totalSec / 3600);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
  }

  // ---------------------------------------------------------------------------
  // MLX Whisper server — uses StdioJsonServer (same as Qwen)
  // ---------------------------------------------------------------------------

  private getMlxWhisperPythonPath(): string {
    if (app.isPackaged) {
      return path.join(app.getPath('userData'), 'build-mlx-whisper', 'venv', 'bin', 'python');
    }
    // __dirname in compiled code is mac-app/electron-dist/main.
    // Use mac-app root so dev runtime matches setup-mlx-whisper.sh output.
    const macAppRoot = path.resolve(__dirname, '../..');
    return path.join(macAppRoot, 'build-mlx-whisper', 'venv', 'bin', 'python');
  }

  private getMlxWhisperScriptPath(): string {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'scripts', 'mlx-whisper-transcribe.py');
    }
    const macAppRoot = path.resolve(__dirname, '../..');
    return path.join(macAppRoot, 'scripts', 'mlx-whisper-transcribe.py');
  }

  isMlxWhisperInstalled(): boolean {
    try {
      return fs.existsSync(this.getMlxWhisperPythonPath()) &&
             fs.existsSync(this.getMlxWhisperScriptPath());
    } catch {
      return false;
    }
  }

  private getOrCreateMlxWhisperServer(): StdioJsonServer {
    if (!this.mlxWhisperServer) {
      this.mlxWhisperServer = new StdioJsonServer({
        name: 'MLX Whisper',
        command: this.getMlxWhisperPythonPath(),
        args: [this.getMlxWhisperScriptPath(), '--server'],
      });
    }
    return this.mlxWhisperServer;
  }

  private startMlxWhisperServer(): Promise<void> {
    return this.getOrCreateMlxWhisperServer().start();
  }

  stopMlxWhisperServer(): void {
    this.mlxWhisperServer?.stop();
  }

  private sendMlxWhisperCommand(cmd: Record<string, unknown>) {
    return this.getOrCreateMlxWhisperServer().send(cmd);
  }

  /**
   * Transcribe audio using MLX Whisper persistent server.
   * Starts the server on first use, auto-restarts on crash (one retry).
   */
  private async transcribeWithMlxWhisper(wavPath: string): Promise<string> {
    const needTimestamps = this.screenshotMetadata.length > 0;

    const doTranscribe = async (): Promise<string> => {
      await this.startMlxWhisperServer();

      const response = await this.sendMlxWhisperCommand({
        cmd: 'transcribe',
        audio: wavPath,
        timestamps: needTimestamps,
      });

      if (!response.ok) {
        throw new Error(`MLX Whisper transcription failed: ${response.error}`);
      }

      const rawText = response.text || '';
      if (needTimestamps) {
        return this.parseTimestampedOutput(rawText);
      }
      return rawText.trim();
    };

    try {
      return await doTranscribe();
    } catch (error) {
      const message = (error as Error)?.message || '';
      const isFatal = message.includes('not installed') || message.includes('ImportError');

      if (isFatal) {
        const server = this.getOrCreateMlxWhisperServer();
        if (!server.disabledReason) {
          server.disable(message);
        }
        throw error;
      }

      // One retry: restart server and try again.
      log.warn('MLX Whisper transcription failed, restarting server: %s', message);
      this.stopMlxWhisperServer();
      return await doTranscribe();
    }
  }

  // ---------------------------------------------------------------------------
  // Parakeet (NVIDIA Parakeet TDT 0.6B v2 via onnx-asr)
  // ---------------------------------------------------------------------------

  private getParakeetPythonPath(): string {
    if (app.isPackaged) {
      return path.join(app.getPath('userData'), 'build-parakeet', 'venv', 'bin', 'python');
    }
    const macAppRoot = path.resolve(__dirname, '../..');
    return path.join(macAppRoot, 'build-parakeet', 'venv', 'bin', 'python');
  }

  private getParakeetScriptPath(): string {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'scripts', 'parakeet-transcribe.py');
    }
    const macAppRoot = path.resolve(__dirname, '../..');
    return path.join(macAppRoot, 'scripts', 'parakeet-transcribe.py');
  }

  isParakeetInstalled(): boolean {
    try {
      return fs.existsSync(this.getParakeetPythonPath()) &&
             fs.existsSync(this.getParakeetScriptPath());
    } catch {
      return false;
    }
  }

  private getParakeetSetupScriptPath(): string {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'scripts', 'setup-parakeet.sh');
    }
    const macAppRoot = path.resolve(__dirname, '../..');
    return path.join(macAppRoot, 'scripts', 'setup-parakeet.sh');
  }

  async setupParakeet(): Promise<{ success: boolean; error?: string }> {
    const setupScript = this.getParakeetSetupScriptPath();
    if (!fs.existsSync(setupScript)) {
      return { success: false, error: `Setup script not found: ${setupScript}` };
    }

    const venvDir = path.dirname(this.getParakeetPythonPath());
    const venvBase = path.dirname(venvDir);

    try {
      const { stdout, stderr } = await execAsync(`bash "${setupScript}" "${venvBase}"`, {
        timeout: 300_000,
      });
      log.info('Parakeet setup stdout: %s', stdout);
      if (stderr) log.info('Parakeet setup stderr: %s', stderr);
      return { success: true };
    } catch (error: any) {
      const message = error?.message || String(error);
      log.error('Parakeet setup failed: %s', message);
      return { success: false, error: message };
    }
  }

  private getOrCreateParakeetServer(): StdioJsonServer {
    if (!this.parakeetServer) {
      this.parakeetServer = new StdioJsonServer({
        name: 'Parakeet',
        command: this.getParakeetPythonPath(),
        args: [this.getParakeetScriptPath(), '--server'],
      });
    }
    return this.parakeetServer;
  }

  private startParakeetServer(): Promise<void> {
    return this.getOrCreateParakeetServer().start();
  }

  stopParakeetServer(): void {
    this.parakeetServer?.stop();
  }

  private sendParakeetCommand(cmd: Record<string, unknown>) {
    return this.getOrCreateParakeetServer().send(cmd);
  }

  /**
   * Transcribe audio using NVIDIA Parakeet TDT 0.6B v2.
   * Starts the server on first use, auto-restarts on crash (one retry).
   */
  private async transcribeWithParakeet(wavPath: string): Promise<string> {
    const needTimestamps = this.screenshotMetadata.length > 0;

    const doTranscribe = async (): Promise<string> => {
      await this.startParakeetServer();

      const response = await this.sendParakeetCommand({
        cmd: 'transcribe',
        audio: wavPath,
        timestamps: needTimestamps,
      });

      if (!response.ok) {
        throw new Error(`Parakeet transcription failed: ${response.error}`);
      }

      return (response.text || '').trim();
    };

    try {
      return await doTranscribe();
    } catch (firstError: any) {
      const message = firstError?.message || '';
      if (message.includes('not running') || message.includes('timed out') || message.includes('startup cancelled')) {
        throw firstError;
      }
      log.warn('Parakeet transcription failed, restarting server: %s', message);
      this.stopParakeetServer();
      return await doTranscribe();
    }
  }

  /**
   * Transcribe audio file using Whisper.
   * Prefers the persistent whisper-server for lower latency. Falls back to
   * spawning whisper-cli per-invocation if the server is unavailable.
   */
  private async transcribe(wavPath: string, whisperModelOverride?: ModelSize): Promise<string> {
    // Try the persistent server first for low-latency transcription.
    if (this.isWhisperServerAvailable() && !this.whisperServerDisabledReason) {
      try {
        await this.startWhisperServer(whisperModelOverride);
        return await this.transcribeViaWhisperServer(wavPath);
      } catch (serverError: any) {
        const message = serverError?.message || '';
        const isFatal = this.isMetalError(message) || message.includes('binary not found');

        if (isFatal && !this.whisperServerDisabledReason) {
          this.whisperServerDisabledReason = message;
          log.warn('Disabling whisper-server for this session: %s', message);
        }

        log.warn('whisper-server failed, falling back to whisper-cli: %s', message);
        this.stopWhisperServer();
      }
    }

    // Fallback to the per-invocation whisper-cli.
    try {
      return await this.runWhisper(wavPath, whisperModelOverride);
    } catch (error: any) {
      if (!this.gpuDisabled && this.isMetalError(error?.message || '')) {
        log.warn('Metal GPU error detected, retrying with CPU-only mode');
        this.gpuDisabled = true;
        return await this.runWhisper(wavPath, whisperModelOverride);
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

  private runWhisper(wavPath: string, whisperModelOverride?: ModelSize): Promise<string> {
    const modelPath = whisperModelOverride
      ? this.modelManager.getModelPathForSize(whisperModelOverride)
      : this.modelManager.getModelPath();
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
  private async pasteText(targetBundleId: string | null = null): Promise<void> {
    try {
      if (targetBundleId) {
        const safeBundleId = targetBundleId.replace(/"/g, '');
        await execAsync(`osascript -e 'tell application id "${safeBundleId}" to activate'`);
        await new Promise((resolve) => setTimeout(resolve, 80));
      }
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
   * Pre-start transcription engines so the first transcription is fast.
   * Starts Qwen server if Qwen is selected, and pre-warms the persistent
   * whisper-server if Whisper is selected and the server binary is available.
   */
  async warmup(): Promise<void> {
    const primaryEngine = this.getConfiguredTranscriptionEngine();
    const hotMicEngine = this.resolveHotMicTranscriptionEngine();
    const engines = Array.from(new Set<TranscriptionEngine>([primaryEngine, hotMicEngine]));

    if (engines.includes('qwen')) {
      await this.startQwenServer();
    }
    if (engines.includes('mlx-whisper') && this.isMlxWhisperInstalled()) {
      await this.startMlxWhisperServer();
    }
    if (engines.includes('parakeet') && this.isParakeetInstalled()) {
      await this.startParakeetServer();
    }
    if (engines.includes('whisper') && this.isWhisperServerAvailable()) {
      await this.startWhisperServer();
    }
  }

  /**
   * Restart runtime after engine/model settings change to avoid stale worker state.
   */
  async restartTranscriptionRuntime(): Promise<void> {
    this.stopQwenServer();
    this.stopMlxWhisperServer();
    this.stopParakeetServer();
    this.stopWhisperServer();

    const primaryEngine = this.getConfiguredTranscriptionEngine();
    const hotMicEngine = this.resolveHotMicTranscriptionEngine();
    const engines = Array.from(new Set<TranscriptionEngine>([primaryEngine, hotMicEngine]));

    if (engines.includes('qwen')) {
      await this.startQwenServer();
    }
    if (engines.includes('mlx-whisper') && this.isMlxWhisperInstalled()) {
      await this.startMlxWhisperServer();
    }
    if (engines.includes('parakeet') && this.isParakeetInstalled()) {
      await this.startParakeetServer();
    }
    if (engines.includes('whisper') && this.isWhisperServerAvailable()) {
      await this.startWhisperServer();
    }
  }

  private getConfiguredTranscriptionEngine(): TranscriptionEngine {
    const configured = this.preferences.getPreference('transcriptionEngine');
    if (configured === 'qwen' || configured === 'mlx-whisper' || configured === 'parakeet') {
      return configured;
    }
    return 'whisper';
  }

  private resolveHotMicTranscriptionEngine(): TranscriptionEngine {
    // Hot Mic now always uses the global transcription engine.
    return this.getConfiguredTranscriptionEngine();
  }

  private resolveHotMicWhisperModel(): ModelSize {
    // Hot Mic now follows the global Whisper model selection.
    return this.modelManager.getSelectedModel();
  }

  private buildHotMicEngineStatus(
    selectedEngine: TranscriptionEngine,
    whisperModel: ModelSize,
    fallbackAvailable: boolean,
    readiness: HotMicEngineReadiness,
    detail: string | null
  ): HotMicEngineStatus {
    return {
      selectedEngine,
      source: 'global',
      whisperModel,
      readiness,
      detail,
      fallbackAvailable,
    };
  }

  getHotMicEngineStatus(): HotMicEngineStatus {
    const selectedEngine = this.resolveHotMicTranscriptionEngine();
    const whisperModel = this.modelManager.getSelectedModel();
    const whisperHealth = this.modelManager.getModelHealthForSizeSync(whisperModel);
    const fallbackAvailable = whisperHealth.status === 'ready';

    if (selectedEngine === 'whisper') {
      if (whisperHealth.status === 'missing') {
        return this.buildHotMicEngineStatus(
          selectedEngine,
          whisperModel,
          fallbackAvailable,
          'not-downloaded',
          `Whisper model "${whisperModel}" is not downloaded`
        );
      }
      if (whisperHealth.status === 'corrupt') {
        return this.buildHotMicEngineStatus(
          selectedEngine,
          whisperModel,
          fallbackAvailable,
          'corrupt',
          `Whisper model "${whisperModel}" appears incomplete or corrupted`
        );
      }
      if (this.whisperServerReady) {
        return this.buildHotMicEngineStatus(
          selectedEngine,
          whisperModel,
          fallbackAvailable,
          'ready',
          'Whisper server is ready'
        );
      }
      if (this.whisperServerReadyPromise) {
        return this.buildHotMicEngineStatus(
          selectedEngine,
          whisperModel,
          fallbackAvailable,
          'warming',
          'Whisper server is warming up'
        );
      }
      if (this.whisperServerDisabledReason) {
        return this.buildHotMicEngineStatus(
          selectedEngine,
          whisperModel,
          fallbackAvailable,
          'ready',
          `Whisper server disabled; using whisper-cli (${this.whisperServerDisabledReason})`
        );
      }
      if (this.isWhisperServerAvailable()) {
        return this.buildHotMicEngineStatus(
          selectedEngine,
          whisperModel,
          fallbackAvailable,
          'cold',
          'Whisper server is idle (starts on first chunk)'
        );
      }
      return this.buildHotMicEngineStatus(
        selectedEngine,
        whisperModel,
        fallbackAvailable,
        'ready',
        'Using whisper-cli (persistent server unavailable)'
      );
    }

    // Parakeet runs on any architecture (ONNX Runtime CPU), no Apple Silicon needed.
    if (selectedEngine === 'parakeet') {
      if (!this.isParakeetInstalled()) {
        return this.buildHotMicEngineStatus(
          selectedEngine,
          whisperModel,
          fallbackAvailable,
          'not-installed',
          'Parakeet runtime is not installed'
        );
      }
      if (this.parakeetServer?.disabledReason) {
        return this.buildHotMicEngineStatus(
          selectedEngine,
          whisperModel,
          fallbackAvailable,
          'disabled',
          this.parakeetServer.disabledReason
        );
      }
      if (this.parakeetServer?.isReady) {
        return this.buildHotMicEngineStatus(
          selectedEngine,
          whisperModel,
          fallbackAvailable,
          'ready',
          'Parakeet server is ready'
        );
      }
      if (this.parakeetServer?.isStarting) {
        return this.buildHotMicEngineStatus(
          selectedEngine,
          whisperModel,
          fallbackAvailable,
          'warming',
          'Parakeet server is warming up'
        );
      }
      return this.buildHotMicEngineStatus(
        selectedEngine,
        whisperModel,
        fallbackAvailable,
        'cold',
        'Parakeet server is idle (starts on first chunk)'
      );
    }

    if (process.arch !== 'arm64') {
      return this.buildHotMicEngineStatus(
        selectedEngine,
        whisperModel,
        fallbackAvailable,
        'unsupported-arch',
        `${selectedEngine} requires Apple Silicon`
      );
    }

    if (selectedEngine === 'qwen') {
      if (!this.isQwenInstalledSync()) {
        return this.buildHotMicEngineStatus(
          selectedEngine,
          whisperModel,
          fallbackAvailable,
          'not-installed',
          'Qwen runtime is not installed'
        );
      }
      if (this.qwenServer?.disabledReason) {
        return this.buildHotMicEngineStatus(
          selectedEngine,
          whisperModel,
          fallbackAvailable,
          'disabled',
          this.qwenServer.disabledReason
        );
      }
      if (this.qwenServer?.isReady) {
        return this.buildHotMicEngineStatus(
          selectedEngine,
          whisperModel,
          fallbackAvailable,
          'ready',
          'Qwen server is ready'
        );
      }
      if (this.qwenServer?.isStarting) {
        return this.buildHotMicEngineStatus(
          selectedEngine,
          whisperModel,
          fallbackAvailable,
          'warming',
          'Qwen server is warming up'
        );
      }
      return this.buildHotMicEngineStatus(
        selectedEngine,
        whisperModel,
        fallbackAvailable,
        'cold',
        'Qwen server is idle (starts on first chunk)'
      );
    }

    if (!this.isMlxWhisperInstalled()) {
      return this.buildHotMicEngineStatus(
        selectedEngine,
        whisperModel,
        fallbackAvailable,
        'not-installed',
        'MLX Whisper runtime is not installed'
      );
    }
    if (this.mlxWhisperServer?.disabledReason) {
      return this.buildHotMicEngineStatus(
        selectedEngine,
        whisperModel,
        fallbackAvailable,
        'disabled',
        this.mlxWhisperServer.disabledReason
      );
    }
    if (this.mlxWhisperServer?.isReady) {
      return this.buildHotMicEngineStatus(
        selectedEngine,
        whisperModel,
        fallbackAvailable,
        'ready',
        'MLX Whisper server is ready'
      );
    }
    if (this.mlxWhisperServer?.isStarting) {
      return this.buildHotMicEngineStatus(
        selectedEngine,
        whisperModel,
        fallbackAvailable,
        'warming',
        'MLX Whisper server is warming up'
      );
    }
    return this.buildHotMicEngineStatus(
      selectedEngine,
      whisperModel,
      fallbackAvailable,
      'cold',
      'MLX Whisper server is idle (starts on first chunk)'
    );
  }

  /**
   * Pre-start transcription runtime for Hot Mic using the global engine selection.
   */
  async warmupForHotMic(): Promise<void> {
    const engine = this.resolveHotMicTranscriptionEngine();
    if (engine === 'qwen') {
      await this.startQwenServer();
      return;
    }

    if (engine === 'mlx-whisper') {
      if (!this.isMlxWhisperInstalled()) {
        return;
      }
      await this.startMlxWhisperServer();
      return;
    }

    if (engine === 'parakeet') {
      if (!this.isParakeetInstalled()) {
        return;
      }
      await this.startParakeetServer();
      return;
    }

    if (engine === 'whisper' && this.isWhisperServerAvailable()) {
      const whisperModel = this.resolveHotMicWhisperModel();
      await this.startWhisperServer(whisperModel);
    }
  }

  /**
   * Transcribe for Hot Mic using the global engine and Whisper model settings.
   * After each call, check lastHotMicUsedWhisperFallback to know if fallback was triggered.
   */
  async transcribeAudioForHotMic(wavPath: string): Promise<string> {
    this.lastHotMicUsedWhisperFallback = false;
    const engine = this.resolveHotMicTranscriptionEngine();
    const whisperModel = this.resolveHotMicWhisperModel();
    const allowWhisperFallback = this.preferences.getPreference('hotMicAllowWhisperFallback') ?? true;

    if (engine !== 'qwen') {
      return this.transcribeWithEngineFallback(wavPath, engine, {
        allowWhisperFallback,
        whisperModelOverride: whisperModel,
      });
    }

    try {
      return await this.transcribeWithEngineFallback(wavPath, engine, {
        allowWhisperFallback,
        whisperModelOverride: whisperModel,
      });
      } catch (error) {
      // If Qwen failed and fallback was not allowed, we still want callers
      // to know this was a Qwen failure they may want to surface.
      throw error;
    }
  }

  /**
   * Whether Qwen is permanently disabled for this session (fatal runtime error).
   */
  isQwenDisabledForSession(): boolean {
    return this.qwenServer?.disabledReason !== null && this.qwenServer?.disabledReason !== undefined;
  }

  lastHotMicUsedWhisperFallback: boolean = false;

  /**
   * Transcribe an audio file using the user's configured engine (whisper or qwen).
   * Exposed for HotMicManager so it can share the persistent Qwen server.
   */
  async transcribeAudio(wavPath: string): Promise<string> {
    const engine = this.preferences.getPreference('transcriptionEngine') || 'whisper';
    return this.transcribeWithEngineFallback(wavPath, engine);
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
    await this.restartTranscriptionRuntime();
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
    
    this.emit('stackChanged', this.screenshotMetadata.length);
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

    this.emit('stackChanged', this.screenshotMetadata.length);
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

    const normalizedText = this.stripFigureReferences(text);
    const sortedScreenshots = [...this.screenshotMetadata].sort(
      (a, b) => a.capturedAtMs - b.capturedAtMs
    );

    const segments = this.standardLiveSegments
      .map((seg) => ({ text: this.stripFigureReferences(seg.text), endMs: Math.max(0, seg.endMs) }))
      .filter((seg) => seg.text.length > 0);

    // No segment timing — fall back to appending at the end.
    if (segments.length === 0) {
      const refs = sortedScreenshots.map(meta => `[Figure ${meta.figureLabel}]`).join(' ');
      return [normalizedText, refs].filter(Boolean).join(' ').trim();
    }

    // Map each screenshot to the segment whose endMs is >= the screenshot's capturedAtMs.
    const segmentFigures: Map<number, string[]> = new Map();
    for (const screenshot of sortedScreenshots) {
      let segmentIndex = segments.findIndex((seg) => screenshot.capturedAtMs <= seg.endMs);
      if (segmentIndex < 0) {
        segmentIndex = segments.length - 1;
      }
      const figures = segmentFigures.get(segmentIndex) ?? [];
      figures.push(screenshot.figureLabel);
      segmentFigures.set(segmentIndex, figures);
    }

    const result = segments.map((segment, index) => {
      const figures = segmentFigures.get(index);
      if (!figures || figures.length === 0) return segment.text;
      const refs = figures.map((label) => `[Figure ${label}]`).join(' ');
      return `${segment.text} ${refs}`;
    });

    return result.join(' ').trim();
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
   * Appends run-this-command references so terminal copilots invoke immediately.
   */
  private formatCommandsForTerminal(text: string): string {
    let formattedText = text.replace(/\s*\[cmd:[^\]]+\]/g, '').trim();
    if (this.detectedCommands.length === 0) {
      return formattedText;
    }

    const commandRefs = this.detectedCommands.map((cmd) => {
      return `[run this command: ${cmd.name}.md]\n${cmd.filePath}`;
    });

    if (commandRefs.length > 0) {
      formattedText += `\n${commandRefs.join('\n')}`;
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
          figurePaths.push(`Figure ${item.figureLabel}: \`${imagePath.replace(os.homedir(), '~')}\``);
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
   * Keep a trailing space so users can continue typing immediately after paste.
   */
  private addFollowupTypingSpace(text: string): string {
    const trimmed = text.replace(/\s+$/g, '');
    if (!trimmed) return text;
    return `${trimmed} `;
  }

  private isFieldTheoryBundleId(bundleId: string | null | undefined): boolean {
    return !!bundleId && TranscriberManager.FIELD_THEORY_BUNDLE_IDS.has(bundleId.toLowerCase());
  }

  /**
   * Match Hot Mic behavior: prefer current non-Field-Theory frontmost app.
   * If Field Theory is frontmost (user clicked our UI), fall back to the last
   * known external app so standard recording can still paste to the user's target.
   */
  private resolveStandardPasteTargetBundleId(frontmostBundleId: string | null): string | null {
    if (frontmostBundleId && !this.isFieldTheoryBundleId(frontmostBundleId)) {
      this.lastExternalPasteTargetBundleId = frontmostBundleId;
      return null;
    }

    const cachedFrontmost = this.nativeHelper.getFrontmostApp()?.bundleId ?? null;
    if (cachedFrontmost && !this.isFieldTheoryBundleId(cachedFrontmost)) {
      this.lastExternalPasteTargetBundleId = cachedFrontmost;
      return cachedFrontmost;
    }

    return this.lastExternalPasteTargetBundleId;
  }

  private async typeIntoAppWithClipboardSync(
    bundleId: string,
    text: string,
    pressEnter: boolean
  ): Promise<{ success: boolean; error?: string }> {
    const clipboardManager = this.clipboardManager;
    if (text) {
      clipboardManager?.setClipboardHashFromText?.(text);
    }
    const result = await this.nativeHelper.typeIntoApp(bundleId, text, pressEnter);
    if (!result.success && text) {
      clipboardManager?.syncClipboardHash?.();
    }
    return result;
  }

  private emitPasteFailureAndMaybeClear(message: string, clearAfter: boolean): void {
    this.emit('paste-failed', message, this.lastTranscription);
    if (clearAfter) {
      this.clearStack();
    }
  }

  private async pasteTextIntoResolvedTarget(
    text: string,
    forcedTargetBundleId: string | null,
    clearAfter: boolean
  ): Promise<boolean> {
    if (forcedTargetBundleId) {
      const result = await this.typeIntoAppWithClipboardSync(forcedTargetBundleId, text, false);
      if (!result.success) {
        // Fall back to legacy clipboard + Cmd+V path if direct injection fails.
        // This matches historical behavior and improves compatibility with apps
        // where typeIntoApp can fail transiently.
        clipboard.writeText(text);
        this.clipboardManager?.syncClipboardHash();
        await this.pasteText(forcedTargetBundleId);
        return true;
      }
      return true;
    }

    clipboard.writeText(text);
    this.clipboardManager?.syncClipboardHash();
    await this.pasteText();
    return true;
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

    // Match Hot Mic behavior:
    // - If a non-Field-Theory app is frontmost, paste there as usual.
    // - If Field Theory is frontmost (user clicked our UI), fall back to the
    //   last known external app and inject there.
    const frontmostBundleId = await this.getFrontmostAppBundleId();
    const forcedTargetBundleId = this.resolveStandardPasteTargetBundleId(frontmostBundleId);
    if (this.isFieldTheoryBundleId(frontmostBundleId) && !forcedTargetBundleId) {
      this.emitPasteFailureAndMaybeClear(
        'Field Theory has focus - press Cmd+V in your target app',
        clearAfter
      );
      return;
    }

    const items = this.currentStack
      .map(id => this.clipboardManager!.getItem(id))
      .filter((item): item is ClipboardItem => item !== null);

    if (items.length === 0) {
      return;
    }

    // Detect app capabilities from the effective paste target.
    const effectiveTargetBundleId = forcedTargetBundleId ?? frontmostBundleId;
    const isTerminal = isTerminalApp(effectiveTargetBundleId);
    const isIDE = isIDEWithTerminal(effectiveTargetBundleId);

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
          // For IDE terminals, match hot-mic command invocation format.
          textContent = this.formatCommandsForTerminal(textContent);
        } else if (this.detectedCommands.length > 0) {
          // For other multimodal apps, format command references as [cmd1: name]
          // Files will be pasted as attachments below
          if (LOG_TRANSCRIPT_PAYLOADS) {
            log.debug(`Before formatCommandReferences: "${textContent}"`);
          } else {
            log.debug('Formatting command references (%d chars, payload redacted)', textContent.length);
          }
          textContent = this.formatCommandReferences(textContent);
          if (LOG_TRANSCRIPT_PAYLOADS) {
            log.debug(`After formatCommandReferences: "${textContent}"`);
          } else {
            log.debug('Formatted command references (%d chars, payload redacted)', textContent.length);
          }
        }

        const payload = this.addFollowupTypingSpace(textContent);
        if (!(await this.pasteTextIntoResolvedTarget(payload, forcedTargetBundleId, clearAfter))) {
          return;
        }

        // For non-terminal, non-IDE apps, paste command files as actual file attachments
        // using NSFilenamesPboardType so apps can receive them like Finder-copied files
        if (!isTerminal && !isIDE && this.detectedCommands.length > 0) {
          await new Promise(resolve => setTimeout(resolve, 100));
          const filePaths = this.detectedCommands.map(cmd => cmd.filePath);
          const plistData = plist.build(filePaths);
          clipboard.writeBuffer('NSFilenamesPboardType', Buffer.from(plistData));
          this.clipboardManager?.syncClipboardHash();
          await this.pasteText(forcedTargetBundleId);
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
            clipboard.writeText(`${imagePath} `);
            this.clipboardManager?.syncClipboardHash();
            await this.pasteText(forcedTargetBundleId);
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
          await this.pasteText(forcedTargetBundleId);
        }
      }

      // Blank line between items for all apps.
      if (itemIdx < items.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
        if (!(await this.pasteTextIntoResolvedTarget('\n', forcedTargetBundleId, clearAfter))) {
          return;
        }
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
    this.detachStandardChunkListener();
    this.clearStandardLiveTranscript();

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
    this.stopMlxWhisperServer();
    this.stopWhisperServer();
    this.overlay.destroy();
  }
}
