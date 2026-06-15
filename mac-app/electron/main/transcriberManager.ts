import { EventEmitter } from 'events';
import { app, globalShortcut, clipboard, nativeImage, Notification, systemPreferences } from 'electron';
import { getHotkeyManager } from './hotkeyManager';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import crypto from 'crypto';
import { NativeHelper } from './nativeHelper';
import {
  DEFAULT_MODEL_SIZE,
  isModelSize,
  MEETING_DIARIZATION_MODEL_SIZE,
  ModelManager,
  ModelSize,
} from './modelManager';
import { PreferencesManager } from './preferences';
import { RecordingOverlay } from './recordingOverlay';
import {
  ClipboardManager,
  ClipboardItem,
  isTerminalApp,
  isIDEWithTerminal,
  orderStackItemsForPaste,
  shouldPasteMixedStackImagesFirst,
} from './clipboardManager';
import { SoundManager } from './soundManager';
import { QuotaManager } from './quotaManager';
import { AudioManager } from './audioManager';
import { CursorStatusManager } from './cursorStatusManager';
import { CommandsManager } from './commandsManager';
import { MESSAGES } from './messages';
import { StdioJsonServer } from './stdioJsonServer';
import { appendTranscriberTrace } from './transcriberTrace';
import {
  PARAKEET_ENGINE_LABELS,
  PARAKEET_ENGINE_MODEL_IDS,
  isParakeetEngine,
  isTranscriptionEngine,
  type ParakeetSetupError,
  type ParakeetSetupProgress,
  type ParakeetSetupStage,
  type ParakeetStatus,
  type RecordingInputSource,
  type TranscriptionEngine,
  type HotMicEngine,
  type ParakeetEngine,
} from './types/transcribe';
import { runParakeetPythonPreflight } from './parakeetPythonPreflight';
import type { HotMicEngineReadiness, HotMicEngineStatus } from './types/hotMic';
import * as plist from 'plist';
import { createLogger } from './logger';
import { stripFigureReferences, insertFigureReferencesInline } from './figureUtils';

const log = createLogger('Transcriber');
const LOG_TRANSCRIPT_PAYLOADS = process.env.LOG_TRANSCRIPT_PAYLOADS === 'true';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const SAFE_FALLBACK_TRANSCRIPTION_HOTKEY = 'Option+Shift+Space';
const WHISPER_TIMESTAMP_PATTERN = /\[\d{2}:\d{2}:\d{2}(?:\.\d{3})?\s*-->\s*\d{2}:\d{2}:\d{2}(?:\.\d{3})?\]/g;
const WHISPER_METADATA_PATTERN = /\[(?:id:\s*\d+|start:|end:)[^\]]*\]/gi;
const WHISPER_SPEAKER_TURN_PATTERN = /\[SPEAKER_TURN\]/gi;

export function formatWhisperSpeakerTurnTranscript(stdout: string): string {
  const ansiEscapeRegex = /\u001b\[[0-9;]*m/g;
  const lines: string[] = [];

  for (const rawLine of stdout.replace(ansiEscapeRegex, '').split(/\r?\n/)) {
    const text = rawLine
      .replace(WHISPER_SPEAKER_TURN_PATTERN, '')
      .replace(WHISPER_METADATA_PATTERN, '')
      .replace(WHISPER_TIMESTAMP_PATTERN, '')
      .trim();

    if (
      text
      && !text.match(/^\[.*-->\s*\]/)
      && !text.match(/^\[\d+:\d+:\d+/)
      && !text.match(/^(###|Transcription|END|BEGIN|Running whisper\.cpp inference)/i)
    ) {
      lines.push(text);
    }
  }

  return lines.join('\n\n').trim();
}

interface PersistedParakeetEngineState {
  verifiedAt?: string;
  lastError?: string | null;
  lastErrorDetail?: string | null;
  lastErrorAt?: string | null;
  setupError?: ParakeetSetupError | null;
}

interface PersistedParakeetState {
  engines?: Partial<Record<ParakeetEngine, PersistedParakeetEngineState>>;
}

const PARAKEET_MODEL_VERIFY_TIMEOUT_MS = 15 * 60_000;

type ParakeetSetupReporter = (progress: Omit<ParakeetSetupProgress, 'engine'>) => void;
type ParakeetProcessError = Error & {
  stdout?: string;
  stderr?: string;
  detail?: string | null;
  killed?: boolean;
  setupError?: ParakeetSetupError;
};

/**
 * Transcription status states.
 */
export type TranscriptionStatus = 'idle' | 'silentStacking' | 'recording' | 'transcribing';

export interface StandardRecordingDiagnostics {
  status: TranscriptionStatus;
  source: RecordingInputSource;
  activeSource: RecordingInputSource | null;
  recordingAgeMs: number | null;
  helperRecordingActive: boolean | null;
  liveTranscriptChars: number;
  queueDepth: number;
  chunkProcessingInFlight: boolean;
}

export interface MeetingCaptureSession {
  startedAt: string;
  source: RecordingInputSource;
  transcriptionEngine: TranscriptionEngine;
  whisperModelOverride?: ModelSize | null;
  speakerDiarizationSupported: boolean;
}

export interface MeetingCaptureResult extends MeetingCaptureSession {
  stoppedAt: string;
  transcriptText: string;
  audioPath: string | null;
}

type FieldTheoryMarkdownInsertionTarget = {
  isAvailable: () => boolean;
  insertText: (text: string) => boolean;
};

type FieldTheoryTerminalInsertionTarget = {
  isAvailable: () => boolean;
  insertText: (text: string) => boolean;
};

type MeetingCaptureHotkeyHandler = () => Promise<void>;
type BeforeRecordingToggleHandler = () => void | Promise<void>;

export type { HotMicEngineReadiness, HotMicEngineStatus };

/**
 * Events emitted by TranscriberManager.
 */
export interface TranscriberEvents {
  statusChanged: (status: TranscriptionStatus) => void;
  result: (text: string) => void;
  'paste-starting': () => void | Promise<void>;
  error: (error: Error) => void;
  parakeetSetupProgress: (progress: ParakeetSetupProgress) => void;
  stackChanged: (count: number) => void;
  stackingDisabled: (data: { itemId: number; message: string }) => void;
}

/**
 * Manages push-to-talk transcription using the local Parakeet runtime.
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
  // Persistent JSON server for Parakeet engines.
  // All use the same stdin/stdout JSON protocol via StdioJsonServer.
  private parakeetServer: StdioJsonServer | null = null;
  private parakeetServerEngine: ParakeetEngine | null = null;

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
  private fieldTheoryMarkdownInsertionTarget: FieldTheoryMarkdownInsertionTarget | null = null;
  private fieldTheoryTerminalInsertionTarget: FieldTheoryTerminalInsertionTarget | null = null;
  private activeRecordingSource: RecordingInputSource | null = null;
  private activeMeetingCapture: MeetingCaptureSession | null = null;
  private meetingCaptureHotkeyHandler: MeetingCaptureHotkeyHandler | null = null;
  private beforeRecordingToggleHandler: BeforeRecordingToggleHandler | null = null;
  private meetingCaptureHotkeyStopInFlight: boolean = false;
  private standardSessionCancelRequested: boolean = false;
  private static readonly FIELD_THEORY_BUNDLE_IDS = new Set([
    'com.fieldtheory.app',
    'com.fieldtheory.experimental',
    'com.github.electron',
  ]);
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
   * @param abandon - true to abandon recording, false to continue
   */
  handleConfirmationResponse(abandon: boolean): void {
    if (!this.pendingAbandonConfirmation) return;

    this.pendingAbandonConfirmation = false;
    this.overlay.hideConfirmation();
    this.emit('confirmation-hide');

    if (abandon) {
      this.cancelRecording();
    } else {
      // Not abandoning - restore cursor indicator to current state.
      if (this.status === 'recording') {
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

  setSketchModeChecker(checker: () => boolean): void {
    this.sketchModeChecker = checker;
  }

  setFieldTheoryMarkdownInsertionTarget(target: FieldTheoryMarkdownInsertionTarget | null): void {
    this.fieldTheoryMarkdownInsertionTarget = target;
  }

  setFieldTheoryTerminalInsertionTarget(target: FieldTheoryTerminalInsertionTarget | null): void {
    this.fieldTheoryTerminalInsertionTarget = target;
  }

  setMeetingCaptureHotkeyHandler(handler: MeetingCaptureHotkeyHandler | null): void {
    this.meetingCaptureHotkeyHandler = handler;
  }

  setBeforeRecordingToggleHandler(handler: BeforeRecordingToggleHandler | null): void {
    this.beforeRecordingToggleHandler = handler;
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
    const configuredEngine = this.preferences.getPreference('transcriptionEngine') as string | undefined;
    if (configuredEngine && !isParakeetEngine(configuredEngine)) {
      log.info(
        'Transcription engine "%s" is no longer supported; reverting to parakeet',
        configuredEngine
      );
      await this.preferences.save({
        transcriptionEngine: 'parakeet',
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
    await this.registerPrimaryHotkeyWithFallback(this.hotkey);

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

    void this.registerPrimaryHotkeyWithFallback(this.hotkey);
    if (this.secondaryHotkey) {
      void this.registerSecondaryHotkey(this.secondaryHotkey);
    }
  }

  private async registerPrimaryHotkeyWithFallback(hotkey: string): Promise<void> {
    const success = await this.registerHotkey(hotkey);
    if (success || !hotkey) {
      return;
    }

    if (hotkey === SAFE_FALLBACK_TRANSCRIPTION_HOTKEY) {
      return;
    }

    // Use the fallback for this session only — never overwrite the user's saved preference.
    // The user's hotkey may be temporarily unavailable (another app holds it, permissions timing).
    log.warn(
      'Primary hotkey "%s" is unavailable; using %s for this session (user pref preserved)',
      hotkey,
      SAFE_FALLBACK_TRANSCRIPTION_HOTKEY
    );

    const fallbackRegistered = await this.registerHotkey(SAFE_FALLBACK_TRANSCRIPTION_HOTKEY);
    if (!fallbackRegistered) {
      return;
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

      let errorMessage = `Failed to register hotkey: ${hotkey}`;
      if (result.conflictWith) {
        errorMessage += `. Conflicts with ${result.conflictWith}. Please choose a different hotkey.`;
      } else if (result.error) {
        errorMessage += `. ${result.error}`;
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
   * Pass null or empty string to clear the hotkey.
   */
  async setHotkey(hotkey: string | null): Promise<boolean> {
    if (!hotkey) {
      const hotkeyManager = getHotkeyManager();
      hotkeyManager.unregister('transcription');
      this.hotkey = '';
      this.registeredHotkey = null;
      await this.preferences.save({ transcriptionHotkey: '' });
      this.emit('hotkeyChanged', '');
      return true;
    }

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
      await this.preferences.save({ transcriptionSecondaryHotkey: null });
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

  async cancelActiveSession(): Promise<void> {
    if (this.activeMeetingCapture) {
      await this.cancelMeetingCapture();
      return;
    }

    if (this.status === 'silentStacking') {
      this.cancelSilentStacking();
      return;
    }

    if (this.status === 'recording') {
      this.standardSessionCancelRequested = true;
      await this.cancelRecording();
      return;
    }

    if (this.status === 'transcribing') {
      this.standardSessionCancelRequested = true;
      this.discardCancelledStandardSession('transcribing-cancel-requested');
    }
  }

  /**
   * Handle hotkey press - toggle recording with double-tap detection.
   * Double-tap in idle → silentStacking mode
   * Single-tap in idle → recording mode (after 300ms delay)
   * Double-tap in silentStacking → cancel (discard stack)
   * Single-tap in silentStacking → paste stack, then start recording fresh
   * @param isSecondary - True if triggered by secondary hotkey, false for primary
   */
  private async handleHotkeyPress(_isSecondary: boolean): Promise<void> {
    if (this.beforeRecordingToggleHandler) {
      try {
        await this.beforeRecordingToggleHandler();
      } catch (error) {
        log.warn('Before recording toggle handler failed:', error);
      }
    }

    if (this.activeMeetingCapture) {
      if (!this.meetingCaptureHotkeyHandler || this.meetingCaptureHotkeyStopInFlight) {
        return;
      }
      this.meetingCaptureHotkeyStopInFlight = true;
      try {
        await this.meetingCaptureHotkeyHandler();
      } finally {
        this.meetingCaptureHotkeyStopInFlight = false;
      }
      return;
    }

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
        // Double-tap from silentStacking → cancel immediately (no confirmation)
        clearTimeout(this.pendingHotkeyTimer);
        this.pendingHotkeyTimer = null;
        this.cancelSilentStacking();
      } else {
        // First tap in silentStacking → wait to distinguish single vs double
        this.pendingHotkeyTimer = setTimeout(async () => {
          this.pendingHotkeyTimer = null;
          // Single-tap → paste stack, then start recording fresh
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
    if (this.status !== 'recording') return;
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

    const recordingSource = this.getRecordingSource();

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

    if (recordingSource === 'system-audio' && systemPreferences.getMediaAccessStatus('screen') !== 'granted') {
      const errorMsg = 'System audio capture requires Screen Recording permission. Open Settings → Privacy & Security → Screen Recording.';
      this.emit('error', new Error(errorMsg));
      this.cursorStatusManager?.showRecordingNote(errorMsg);
      if (yieldedHotMic) {
        this.hotMicDelegate?.resumeAfterTranscriber().catch(() => {});
      }
      return;
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
      this.standardSessionCancelRequested = false;
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
      this.activeRecordingSource = recordingSource;
      if (recordingSource === 'microphone') {
        this.attachStandardChunkListener();
        this.setStandardRealtimeHarvestMode();
      } else {
        this.nativeHelper.setHarvestMode('off');
      }
      await this.nativeHelper.startRecording(recordingSource);
      log.info('Recording started');
    } catch (error) {
      log.error('Failed to start recording:', error);
      this.activeRecordingSource = null;
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

      // No abandon hotkey for silentStacking — double-tap hotkey cancels instead.

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

  /** Paste and clear the current silent stack. No-op if empty. */
  private async commitSilentStack(): Promise<void> {
    if (this.currentStack.length === 0 || !this.clipboardManager) return;

    const stackId = crypto.randomUUID();
    this.clipboardManager.updateStackId(this.currentStack, stackId);
    this.emit('autostackCreated');

    const itemsToPaste = [...this.currentStack];
    this.clearStack();
    log.info('[SilentStack] Committing %d items', itemsToPaste.length);
    await this.pasteSilentStack(itemsToPaste);
  }

  /**
   * Transition from silent stacking to recording mode.
   * Pastes the collected stack first, clears it, then starts a fresh recording.
   */
  private async startRecordingFromSilentStack(): Promise<void> {
    if (this.status !== 'silentStacking') {
      return;
    }

    // Set idle BEFORE committing so clipboard changes during paste don't get re-stacked.
    this.setStatus('idle');
    await this.commitSilentStack();
    await this.startRecording();
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

    if (queueDepth >= TranscriberManager.STANDARD_HARVEST_BACKPRESSURE_QUEUE_THRESHOLD) {
      return 'command';
    }

    return 'dictation';
  }

  private getEngineSilenceMs(): number | undefined {
    const engine = this.getConfiguredTranscriptionEngine();
    if (isParakeetEngine(engine)) return 0;
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
      if (this.status !== 'recording' && this.status !== 'transcribing') return;
      if (this.pendingImmediateSquaresAction) return;

      const engine = this.getConfiguredTranscriptionEngine();
      const asrStart = performance.now();
      const rawChunkText = await this.transcribeWithEngineFallback(wavPath, engine);
      const asrMs = Math.round(performance.now() - asrStart);
      if (this.standardSessionCancelRequested || (this.status !== 'recording' && this.status !== 'transcribing')) return;
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
    let cleanedText = trimmedText.replace(/\s*\[(?!figure\s+[A-Za-z0-9]+\])[^\]]+\]\s*/gi, ' ').trim();
    cleanedText = cleanedText.replace(/\([^)]*\)/g, ' ').trim();
    cleanedText = cleanedText.replace(/[<>]{2,}/g, ' ').trim();
    cleanedText = cleanedText.replace(/\b(mm[-\s]?hmm|mm+|hmm+)\b/gi, ' ').trim();
    cleanedText = this.applyWordSubstitutions(cleanedText);
    cleanedText = cleanedText.replace(/\s+/g, ' ').trim();
    cleanedText = this.removeTrailingFillerHallucination(cleanedText);
    const normalizedText = cleanedText.toLowerCase().replace(/\.+$/, '').trim();
    return this.isLikelySilenceHallucination(normalizedText) ? '' : normalizedText;
  }

  private isLikelySilenceHallucination(text: string): boolean {
    const trimmedText = text ? text.trim() : '';
    if (!trimmedText) return true;

    const normalized = trimmedText
      .toLowerCase()
      .replace(/[.,!?;:]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!normalized) return true;

    if (/^(thanks?|thank you|you|okay|ok)$/.test(normalized)) {
      return true;
    }

    const words = normalized
      .replace(/[^\w\s']/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
    if (words.length < 2) return false;

    const uniqueWords = new Set(words);
    if (uniqueWords.size !== 1) return false;

    const repeatedWord = words[0] ?? '';
    const repeatedFillers = new Set(['ok', 'okay', 'yeah', 'yep', 'uh', 'um', 'hmm', 'you', 'thanks']);
    return words.length >= 4 || repeatedFillers.has(repeatedWord);
  }

  private removeTrailingFillerHallucination(text: string): string {
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    if (wordCount <= 4) return text;

    const filler = String.raw`(?:ok(?:ay)?|yeah|yep|uh[-\s]?huh|mm[-\s]?hmm|alright|all right)`;
    const repeatedTrailingFiller = new RegExp(String.raw`(?:\s+${filler}[.!?,]*){2,}$`, 'i');
    const singleTrailingFillerAfterSentence = new RegExp(String.raw`([.!?])\s+${filler}[.!?]*$`, 'i');

    return text
      .replace(repeatedTrailingFiller, '')
      .replace(singleTrailingFillerAfterSentence, '$1')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private stripFigureReferences(text: string): string {
    return stripFigureReferences(text);
  }

  /**
   * Finish silent stacking mode - paste collected screenshots and return to idle.
   * Called by super paste (Shift+Cmd+V) while in silentStacking mode.
   */
  async finishSilentStacking(): Promise<void> {
    if (this.status !== 'silentStacking') {
      return;
    }

    this.soundManager.play('recordingStop');

    // Set to idle BEFORE pasting so clipboard changes during paste don't get re-added.
    this.setStatus('idle');
    await this.commitSilentStack();
  }

  /**
   * Paste all items collected during silent stacking.
   * For terminal-like targets: pastes "Figure N" label + path with blank lines between.
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

    const pasteImagesAsPaths = isTerminalApp(frontmostBundleId) || isIDEWithTerminal(frontmostBundleId);

    // Get ALL items from captured IDs (text and images).
    log.info('[SilentStack] itemIds to paste:', itemIds);
    const items = itemIds
      .map(id => this.clipboardManager!.getItem(id))
      .filter((item): item is ClipboardItem => item !== null);

    log.info('[SilentStack] Pasting %d items, pasteImagesAsPaths: %s', items.length, pasteImagesAsPaths);
    items.forEach((item, i) => {
      log.info('[SilentStack] Item %d: id=%d, type=%s, hasImage=%s, contentPreview=%s',
        i, item.id, item.type, !!item.imageData, item.content?.substring(0, 30));
    });

    if (items.length === 0) {
      return;
    }

    const mixedMultimodalPaste = shouldPasteMixedStackImagesFirst(frontmostBundleId, items);
    const orderedItems = orderStackItemsForPaste(items, frontmostBundleId);

    for (let i = 0; i < orderedItems.length; i++) {
      const item = orderedItems[i];
      log.info('[SilentStack] Pasting item %d/%d: id=%d', i + 1, items.length, item.id);

      if (item.imageData) {
        // Image item
        if (pasteImagesAsPaths) {
          // Terminal-like target: paste "figure N" label + newline + path.
          const figureLabel = item.figureLabel || String(i + 1);
          const imagePath = await this.clipboardManager!.exportImageToCache(item);
          if (imagePath) {
            clipboard.writeText(this.addFollowupTypingSpace(`figure ${figureLabel}\n\`${imagePath.replace(os.homedir(), '~')}\``));
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
      if (!mixedMultimodalPaste && i < orderedItems.length - 1) {
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

    const activeRecordingSource = this.activeRecordingSource ?? this.getRecordingSource();
    const finishStart = performance.now();
    const startingQueueDepth = this.getStandardRealtimePressureDepth();
    const liveCharsAtFinish = (this.standardLiveTranscript ?? '').trim().length;
    const helperRecordingActive = typeof this.nativeHelper.isRecordingActive === 'function'
      ? this.nativeHelper.isRecordingActive()
      : null;
    const recordingAgeMs = this.recordingStartTime > 0
      ? Math.max(0, Date.now() - this.recordingStartTime)
      : null;

    try {
      // Unregister abandon hotkey.
      this.unregisterAbandonHotkey();
      
      // Play stop recording sound (user-configurable).
      this.soundManager.play('recordingStop');

      // Leave the visible recording state immediately. Native stop/drain can take
      // a moment, but the user's finish action has already been accepted.
      this.setStatus('transcribing');
      this.overlay.showTranscribing();
      appendTranscriberTrace('finish.accepted', {
        source: activeRecordingSource,
        recordingAgeMs,
        liveChars: liveCharsAtFinish,
        queueDepth: startingQueueDepth,
        helperActive: helperRecordingActive,
      });

      let snapshotMs = 0;
      let snapshotStatus = 'skipped';
      const shouldSnapshotTail =
        activeRecordingSource === 'microphone' &&
        !this.pendingImmediateSquaresAction &&
        liveCharsAtFinish > 0;
      if (shouldSnapshotTail) {
        const snapshotStart = performance.now();
        try {
          const tailChunkPath = await this.nativeHelper.snapshotRecording();
          snapshotMs = Math.round(performance.now() - snapshotStart);
          snapshotStatus = 'ok';
          const readyAtMs = this.recordingStartTime > 0
            ? Math.max(0, Date.now() - this.recordingStartTime)
            : 0;
          this.standardPendingChunkQueue.push({ filePath: tailChunkPath, readyAtMs });
          void this.processStandardChunkQueue();
        } catch {
          snapshotMs = Math.round(performance.now() - snapshotStart);
          snapshotStatus = 'failed';
          // Snapshot can fail when no audio has accumulated yet; continue with normal stop.
        }
      } else if (activeRecordingSource === 'microphone' && !this.pendingImmediateSquaresAction) {
        snapshotStatus = 'skipped-no-live-transcript';
      }

      if (this.standardSessionCancelRequested) {
        await this.nativeHelper.cancelRecording().catch(() => {});
        this.discardCancelledStandardSession('cancel-before-stop');
        return;
      }
      
      // Stop recording and get WAV file path
      const stopStart = performance.now();
      const wavPath = await this.nativeHelper.stopRecording();
      const stopMs = Math.round(performance.now() - stopStart);
      let drainMs = 0;
      if (activeRecordingSource === 'microphone') {
        const drainStart = performance.now();
        await this.waitForStandardChunkDrain();
        drainMs = Math.round(performance.now() - drainStart);
        this.detachStandardChunkListener();
      }
      this.activeRecordingSource = null;

      const finishPrepMs = Math.round(performance.now() - finishStart);
      const timingMessage = '[timing] finish recording prep: snapshot=%dms snapshotStatus=%s stop=%dms drain=%dms total=%dms source=%s liveChars=%d queueDepth=%d helperActive=%s';
      if (finishPrepMs > 400) {
        log.warn(timingMessage, snapshotMs, snapshotStatus, stopMs, drainMs, finishPrepMs, activeRecordingSource, liveCharsAtFinish, startingQueueDepth, helperRecordingActive);
      } else {
        log.info(timingMessage, snapshotMs, snapshotStatus, stopMs, drainMs, finishPrepMs, activeRecordingSource, liveCharsAtFinish, startingQueueDepth, helperRecordingActive);
      }
      const wavBytes = await fs.promises.stat(wavPath).then(s => s.size).catch(() => null);
      appendTranscriberTrace('finish.prep', {
        source: activeRecordingSource,
        snapshotMs,
        snapshotStatus,
        stopMs,
        drainMs,
        totalMs: finishPrepMs,
        liveChars: liveCharsAtFinish,
        queueDepth: startingQueueDepth,
        helperActive: helperRecordingActive,
        wavBytes,
      });

      if (this.standardSessionCancelRequested) {
        this.discardCancelledStandardSession('cancel-after-stop', wavPath);
        return;
      }

      const immediateSquaresAction = this.pendingImmediateSquaresAction;
      this.pendingImmediateSquaresAction = null;
      const immediateSquaresText = this.pendingImmediateSquaresText;
      this.pendingImmediateSquaresText = '';

      // Usage sync can hit the network; do not block transcription/paste on it.
      void this.trackPriorityMicUsage().catch((error) => {
        log.warn('Priority mic usage tracking failed:', error);
        appendTranscriberTrace('finish.usage-track.error', { feature: 'priority_mic_seconds', error });
      });

      const finalPassStart = performance.now();
      let cleanedText = '';
      const liveTranscriptFallback = this.standardLiveTranscript.trim();
      let finalAsrMs = 0;
      let finalTextSource = 'asr';
      let tailFileSize: number | null = null;

      if (immediateSquaresAction) {
        // Immediate Squares actions are finalized from the detected tail text so we can
        // execute the command deterministically even if recording is stopped mid-phrase.
        cleanedText = this.sanitizeTranscriptText(immediateSquaresText);
        finalTextSource = 'immediate-squares';
      } else {
        const engine = this.getConfiguredTranscriptionEngine();

        // With realtime chunking, the tail file from stopRecording() only contains audio
        // after the last snapshot — often just silence. If live chunks already produced a
        // transcript, skip the final-pass ASR on the tiny tail and use it directly.
        tailFileSize = wavBytes ?? Infinity;
        const hasLiveTranscript = liveTranscriptFallback.length > 0;
        // 32000 bytes ≈ 0.5s of 16kHz float32 mono — minimum for a recognizable word.
        const tailTooSmall = tailFileSize < 32000;
        const parakeetTailLikelySilence = isParakeetEngine(engine) && tailFileSize < 96000;

        if (hasLiveTranscript && (tailTooSmall || parakeetTailLikelySilence)) {
          // Tail is just silence/header — use the live transcript directly.
          cleanedText = this.sanitizeTranscriptText(liveTranscriptFallback);
          finalTextSource = parakeetTailLikelySilence ? 'live-tail-silence' : 'live-tail-small';
          void fs.promises.unlink(wavPath).catch(() => {});
          log.debug('Final-pass: using live transcript (%d chars, tail=%d bytes)', cleanedText.length, tailFileSize);
        } else {
          // Full-file pass is used when there are no live chunks or the tail has
          // enough speech to benefit from complete context.

          const asrStart = performance.now();
          const text = await this.transcribeWithEngineFallback(wavPath, engine);
          finalAsrMs = Math.round(performance.now() - asrStart);
          if (this.standardSessionCancelRequested) {
            this.discardCancelledStandardSession('cancel-after-asr', wavPath);
            return;
          }
          cleanedText = this.sanitizeTranscriptText(text);

          // If full-file ASR returned empty but live chunks had content, use them.
          if (cleanedText.length === 0 && hasLiveTranscript) {
            cleanedText = this.sanitizeTranscriptText(liveTranscriptFallback);
            finalTextSource = 'live-fallback';
            log.debug('Final-pass ASR empty; using live transcript (%d chars)', cleanedText.length);
          }
        }
      }

      if (this.standardSessionCancelRequested) {
        this.discardCancelledStandardSession('cancel-after-final-text', wavPath);
        return;
      }

      // Check for Squares voice commands (e.g., "grid", "focus", "horizontal").
      // If the transcription is a window management command, execute it and skip pasting.
      let deferredSquaresAction = immediateSquaresAction;
      if (cleanedText.length === 0) {
        this.clearStandardLiveTranscript();
        appendTranscriberTrace('finish.no-audio', {
          source: activeRecordingSource,
          totalMs: Math.round(performance.now() - finalPassStart),
          textSource: finalTextSource,
          tailBytes: tailFileSize,
        });
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
          this.clearStandardLiveTranscript();
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
      // IMPORTANT: must happen before clearStandardLiveTranscript() which clears
      // standardLiveSegments needed for inline placement based on timing.
      const figureSegments = finalTextSource === 'asr' ? [] : this.standardLiveSegments;
      cleanedText = this.insertFigureReferences(cleanedText, figureSegments);
      this.clearStandardLiveTranscript();

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

              // Usage sync can hit the network; do not block paste on it.
              void this.trackAutoStackUsage().catch((error) => {
                log.warn('Auto-stack usage tracking failed:', error);
                appendTranscriberTrace('finish.usage-track.error', { feature: 'auto_stack_sessions', error });
              });
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
      if (this.standardSessionCancelRequested) {
        this.discardCancelledStandardSession('cancel-before-paste', wavPath);
        return;
      }
      const pasteStart = performance.now();
      const accessibilityCheckPromise = this.nativeHelper.checkFocusedTextInput();
      await this.notifyPasteStarting();
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
      appendTranscriberTrace('finish.done', {
        source: activeRecordingSource,
        textSource: finalTextSource,
        textChars: finalText.length,
        asrMs: finalAsrMs,
        cmdMs: cmdDetectMs,
        pasteMs,
        totalMs: finalTotalMs,
        tailBytes: tailFileSize,
        commands: this.detectedCommands.map(c => c.name),
      });

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
      const noRecordingInProgress =
        error instanceof Error && /no recording in progress/i.test(error.message);
      if (noRecordingInProgress) {
        log.warn('Recording stop requested after helper had already stopped; resetting state');
      } else {
        log.error('Transcription failed:', error);
      }
      appendTranscriberTrace('finish.error', {
        source: activeRecordingSource,
        noRecordingInProgress,
        totalMs: Math.round(performance.now() - finishStart),
        error,
      });
      this.activeRecordingSource = null;
      this.detachStandardChunkListener();
      this.clearStandardLiveTranscript();
      this.setStatus('idle');
      this.handleOverlayAfterTranscription();
      if (!noRecordingInProgress) {
        this.emit('error', error as Error);
      }
    }
  }

  /**
   * Handle overlay state after transcription completes.
   * Dismiss the overlay.
   */
  private handleOverlayAfterTranscription(): void {
    this.overlay.dismiss();
  }

  private async notifyPasteStarting(): Promise<void> {
    const listeners = this.listeners('paste-starting');
    if (listeners.length === 0) return;

    for (const listener of listeners) {
      try {
        await Promise.resolve((listener as () => void | Promise<void>)());
      } catch (error) {
        log.warn('Paste-starting listener failed:', error);
      }
    }
  }

  private discardCancelledStandardSession(reason: string, wavPath?: string): void {
    appendTranscriberTrace('finish.cancelled', { reason });
    if (wavPath) {
      void fs.promises.unlink(wavPath).catch(() => {});
    }
    this.pendingImmediateSquaresAction = null;
    this.pendingImmediateSquaresText = '';
    this.activeRecordingSource = null;
    this.detachStandardChunkListener();
    this.clearStandardLiveTranscript();
    this.clearStack();
    this.setStatus('idle');
    this.handleOverlayAfterTranscription();
    this.overlay.showStatus(MESSAGES.overlay.cancelled);
  }
  
  /**
   * Cancel recording (called by abandon hotkey).
   */
  private async cancelRecording(): Promise<void> {
    if (this.status !== 'recording') {
      return;
    }

    try {
      this.standardSessionCancelRequested = true;
      // Note: Cancel sound removed to avoid audio feedback on abandoned recordings.
      await this.nativeHelper.cancelRecording();
      this.activeRecordingSource = null;
      this.detachStandardChunkListener();
      this.clearStandardLiveTranscript();
      this.setStatus('idle');
      this.hasAudioContent = false;
      this.clearStack();
      this.overlay.showStatus(MESSAGES.overlay.cancelled);
      this.unregisterAbandonHotkey();
    } catch (error) {
      log.error('Failed to cancel recording:', error);
      this.activeRecordingSource = null;
      this.detachStandardChunkListener();
      this.clearStandardLiveTranscript();
      this.setStatus('idle');
      this.hasAudioContent = false;
      this.clearStack();
      this.overlay.showStatus(MESSAGES.overlay.cancelled);
      this.unregisterAbandonHotkey();
    }
  }

  /**
   * Cancel silent stacking (called by double-tap hotkey in silentStacking mode).
   * No confirmation — items are already saved in Field Theory clipboard.
   */
  cancelSilentStacking(): void {
    if (this.status !== 'silentStacking') {
      return;
    }

    this.soundManager.play('recordingStop');
    this.setStatus('idle');
    this.clearStack();
    log.info('Silent stacking cancelled');
  }

  /**
   * Register abandon recording hotkey (configurable, default: Escape).
   * While recording is active, Escape belongs to the recording session.
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
        this.cancelRecording();
        return;
      }

      const confirmationEnabled = this.preferences.getPreference('abandonRecordingConfirmation') ?? true;

      // Handle recording mode.
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
    if (this.status !== 'recording') {
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
    
    // Re-register if we're currently recording.
    if (this.status === 'recording') {
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
   * Transcribe with the configured Parakeet engine.
   */
  private async transcribeWithEngineFallback(
    wavPath: string,
    engine: TranscriptionEngine
  ): Promise<string> {
    if (isParakeetEngine(engine)) {
      return this.transcribeWithParakeet(wavPath, engine);
    }

    log.info('Transcription engine "%s" is no longer supported; using parakeet', engine);
    await this.preferences.save({
      transcriptionEngine: 'parakeet',
      hotMicTranscriptionEngine: 'default',
    });
    return this.transcribeWithParakeet(wavPath, 'parakeet');
  }

  // ---------------------------------------------------------------------------
  // Parakeet (NVIDIA Parakeet TDT 0.6B v2 via onnx-asr)
  // ---------------------------------------------------------------------------

  private getParakeetBasePath(): string {
    if (app.isPackaged) {
      return path.join(app.getPath('userData'), 'build-parakeet');
    }
    const macAppRoot = path.resolve(__dirname, '../..');
    return path.join(macAppRoot, 'build-parakeet');
  }

  private getParakeetPythonPath(): string {
    return path.join(this.getParakeetBasePath(), 'venv', 'bin', 'python');
  }

  private getParakeetScriptPath(): string {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'scripts', 'parakeet-transcribe.py');
    }
    const macAppRoot = path.resolve(__dirname, '../..');
    return path.join(macAppRoot, 'scripts', 'parakeet-transcribe.py');
  }

  private getParakeetCacheDir(): string {
    return path.join(this.getParakeetBasePath(), 'cache');
  }

  private getParakeetStatusPath(): string {
    return path.join(this.getParakeetBasePath(), 'status.json');
  }

  private getParakeetProcessEnv(): NodeJS.ProcessEnv {
    const cacheDir = this.getParakeetCacheDir();
    const huggingFaceHome = path.join(cacheDir, 'huggingface');
    return {
      FIELD_THEORY_PARAKEET_CACHE_DIR: cacheDir,
      HF_HOME: huggingFaceHome,
      HUGGINGFACE_HUB_CACHE: path.join(huggingFaceHome, 'hub'),
      XDG_CACHE_HOME: path.join(cacheDir, 'xdg'),
    };
  }

  private readPersistedParakeetState(): PersistedParakeetState {
    try {
      const raw = fs.readFileSync(this.getParakeetStatusPath(), 'utf-8');
      return JSON.parse(raw) as PersistedParakeetState;
    } catch {
      return {};
    }
  }

  private writePersistedParakeetState(state: PersistedParakeetState): void {
    fs.mkdirSync(this.getParakeetBasePath(), { recursive: true });
    fs.writeFileSync(this.getParakeetStatusPath(), JSON.stringify(state, null, 2), 'utf-8');
  }

  private hasParakeetFailureSinceLastVerification(state: PersistedParakeetEngineState | undefined): boolean {
    if (!state?.lastError) return false;
    if (!state.lastErrorAt) return !state.verifiedAt;
    if (!state.verifiedAt) return true;
    return Date.parse(state.lastErrorAt) >= Date.parse(state.verifiedAt);
  }

  private normalizeParakeetErrorMessage(error: unknown): string {
    const raw = error instanceof Error ? error.message : String(error);
    return raw.replace(/\s+/g, ' ').trim().slice(0, 400);
  }

  private normalizeParakeetErrorDetail(error: unknown): string | null {
    const setupDetail = (error as ParakeetProcessError | null | undefined)?.setupError?.detail;
    if (typeof setupDetail === 'string' && setupDetail.trim()) {
      return setupDetail.trim().slice(0, 8000);
    }

    const detail = (error as ParakeetProcessError | null | undefined)?.detail;
    if (typeof detail === 'string' && detail.trim()) {
      return detail.trim().slice(0, 8000);
    }

    const stderr = typeof (error as ParakeetProcessError | null | undefined)?.stderr === 'string'
      ? (error as ParakeetProcessError).stderr!.trim()
      : '';
    const stdout = typeof (error as ParakeetProcessError | null | undefined)?.stdout === 'string'
      ? (error as ParakeetProcessError).stdout!.trim()
      : '';
    const message = error instanceof Error ? error.message.trim() : String(error).trim();
    const combined = [stderr, stdout, message].filter(Boolean).join('\n\n').trim();
    return combined ? combined.slice(0, 8000) : null;
  }

  private buildParakeetSetupError(error: unknown): ParakeetSetupError {
    const existing = (error as ParakeetProcessError | null | undefined)?.setupError;
    if (existing) return existing;

    const summary = this.normalizeParakeetErrorMessage(error) || 'Parakeet setup failed.';
    const detail = this.normalizeParakeetErrorDetail(error) ?? this.normalizeParakeetErrorMessage(error);
    const normalized = `${summary}\n${detail}`.toLowerCase();
    let moreInfo = 'Retry Parakeet setup once. If it fails again, open Diagnostics so support can inspect the setup log.';
    if (normalized.includes('timed out')) {
      moreInfo = 'The runtime installed, but the model did not finish downloading or loading in time. Retry on a stable internet connection. If it repeats, open Diagnostics so support can inspect the setup log.';
    } else if (this.isParakeetRepairableCacheError(error)) {
      moreInfo = 'Field Theory found a broken Parakeet model download. Repair the model to clear the cached snapshot and download it again.';
    } else if (
      normalized.includes('failed to load') ||
      normalized.includes('exited during startup') ||
      normalized.includes('onnx-asr is not installed') ||
      normalized.includes('no such file or directory')
    ) {
      moreInfo = 'Field Theory could not start the Parakeet runtime cleanly. Remove Parakeet and install it again. If it repeats, open Diagnostics so support can inspect the setup log.';
    }

    return {
      code: 'setup-failed',
      summary,
      detail,
      recoveryCommand: '',
      moreInfo,
    };
  }

  private createParakeetSetupError(error: ParakeetSetupError): ParakeetProcessError {
    const processError = new Error(error.summary) as ParakeetProcessError;
    processError.detail = error.detail;
    processError.setupError = error;
    return processError;
  }

  private getParakeetHubCacheDir(): string {
    return path.join(this.getParakeetCacheDir(), 'huggingface', 'hub');
  }

  private isParakeetRepairableCacheError(error: unknown): boolean {
    const detail = (this.normalizeParakeetErrorDetail(error) ?? this.normalizeParakeetErrorMessage(error)).toLowerCase();
    const missingFile =
      detail.includes('no such file or directory') ||
      detail.includes('filesystem error: in file_size');
    if (!missingFile) return false;

    return detail.includes('.onnx.data') ||
      detail.includes('huggingface') ||
      detail.includes('/snapshots/') ||
      detail.includes('models--');
  }

  private extractParakeetCachePathCandidates(detail: string): string[] {
    const candidates = new Set<string>();
    for (const match of detail.matchAll(/["'](\/[^"']+)["']/g)) {
      const candidate = match[1]?.trim();
      if (candidate) {
        candidates.add(candidate);
      }
    }
    for (const match of detail.matchAll(/\[(\/[^\]]+)\]/g)) {
      const candidate = match[1]?.trim();
      if (candidate) {
        candidates.add(candidate);
      }
    }
    return [...candidates];
  }

  private isParakeetHubCachePath(candidate: string): boolean {
    const relative = path.relative(this.getParakeetHubCacheDir(), candidate);
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
  }

  private findParakeetModelCacheRepos(engine: ParakeetEngine, error: unknown): string[] {
    const detail = this.normalizeParakeetErrorDetail(error) ?? this.normalizeParakeetErrorMessage(error);
    const repoDirs = new Set<string>();

    for (const candidate of this.extractParakeetCachePathCandidates(detail)) {
      let current = path.normalize(candidate);
      while (current !== path.dirname(current)) {
        if (path.basename(current).startsWith('models--')) {
          if (this.isParakeetHubCachePath(current)) {
            repoDirs.add(current);
          }
          break;
        }
        current = path.dirname(current);
      }
    }

    if (repoDirs.size > 0) {
      return [...repoDirs];
    }

    const hubCacheDir = this.getParakeetHubCacheDir();
    if (!fs.existsSync(hubCacheDir)) {
      return [];
    }

    const engineToken = PARAKEET_ENGINE_MODEL_IDS[engine].replace(/^nemo-/, '').toLowerCase();
    for (const entry of fs.readdirSync(hubCacheDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (!entry.name.startsWith('models--')) continue;
      if (!entry.name.toLowerCase().includes(engineToken)) continue;
      repoDirs.add(path.join(hubCacheDir, entry.name));
    }

    return [...repoDirs];
  }

  private repairParakeetModelCache(engine: ParakeetEngine, error: unknown): string[] {
    const repoDirs = this.findParakeetModelCacheRepos(engine, error);
    for (const repoDir of repoDirs) {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
    return repoDirs;
  }

  private emitParakeetSetupProgress(
    engine: ParakeetEngine,
    progress: Omit<ParakeetSetupProgress, 'engine'>
  ): void {
    this.emit('parakeetSetupProgress', {
      engine,
      ...progress,
    });
  }

  private getParakeetLatestProcessDetail(chunk: string): string | null {
    const lines = chunk
      .replace(/\r/g, '\n')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    return lines.at(-1) ?? null;
  }

  private getParakeetDownloadPercent(detail: string | null): number | null {
    if (!detail) return null;
    const matches = [...detail.matchAll(/(\d{1,3})%/g)];
    if (matches.length === 0) return null;
    const percent = Number.parseInt(matches.at(-1)?.[1] ?? '', 10);
    if (!Number.isFinite(percent)) return null;
    return Math.max(0, Math.min(100, percent));
  }

  private buildParakeetProcessError(
    message: string,
    stdout: string,
    stderr: string,
    killed: boolean = false
  ): ParakeetProcessError {
    const error = new Error(message) as ParakeetProcessError;
    error.stdout = stdout;
    error.stderr = stderr;
    error.killed = killed;
    error.detail = [stderr.trim(), stdout.trim(), message.trim()].filter(Boolean).join('\n\n').trim();
    return error;
  }

  private updatePersistedParakeetEngineState(
    engine: ParakeetEngine,
    updates: Partial<PersistedParakeetEngineState>
  ): PersistedParakeetEngineState {
    const state = this.readPersistedParakeetState();
    const engines = { ...(state.engines ?? {}) };
    const nextState = {
      ...(engines[engine] ?? {}),
      ...updates,
    };
    engines[engine] = nextState;
    this.writePersistedParakeetState({ engines });
    return nextState;
  }

  private markParakeetEngineVerified(engine: ParakeetEngine): void {
    this.updatePersistedParakeetEngineState(engine, {
      verifiedAt: new Date().toISOString(),
      lastError: null,
      lastErrorDetail: null,
      lastErrorAt: null,
      setupError: null,
    });
  }

  private markParakeetEngineFailure(engine: ParakeetEngine, error: unknown): ParakeetSetupError {
    const setupError = this.buildParakeetSetupError(error);
    this.updatePersistedParakeetEngineState(engine, {
      lastError: setupError.summary,
      lastErrorDetail: setupError.detail,
      lastErrorAt: new Date().toISOString(),
      setupError,
    });
    return setupError;
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

  private async installParakeetRuntime(
    venvDir: string,
    pythonCommand: string,
    reportProgress?: ParakeetSetupReporter
  ): Promise<void> {
    const setupScript = this.getParakeetSetupScriptPath();
    if (!fs.existsSync(setupScript)) {
      throw new Error(`Setup script not found: ${setupScript}`);
    }

    await new Promise<void>((resolve, reject) => {
      const child = spawn('bash', [setupScript, venvDir], {
        env: {
          ...process.env,
          ...this.getParakeetProcessEnv(),
          FT_PARAKEET_PYTHON: pythonCommand,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill('SIGKILL');
        reject(this.buildParakeetProcessError('Parakeet runtime installation timed out after 5m', stdout, stderr, true));
      }, 300_000);

      const handleChunk = (chunk: Buffer, source: 'stdout' | 'stderr') => {
        const text = chunk.toString();
        if (source === 'stdout') {
          stdout += text;
        } else {
          stderr += text;
        }

        const detail = this.getParakeetLatestProcessDetail(text);
        if (detail) {
          reportProgress?.({
            stage: 'installing-runtime',
            message: 'Installing the Parakeet runtime…',
            percent: null,
            detail,
          });
        }
      };

      child.stdout?.on('data', (chunk: Buffer) => handleChunk(chunk, 'stdout'));
      child.stderr?.on('data', (chunk: Buffer) => handleChunk(chunk, 'stderr'));

      child.on('error', (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        const processError = error as ParakeetProcessError;
        processError.stdout = stdout;
        processError.stderr = stderr;
        processError.detail = [stderr.trim(), stdout.trim(), error.message.trim()].filter(Boolean).join('\n\n').trim();
        reject(processError);
      });

      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        log.info('Parakeet setup stdout: %s', stdout);
        if (stderr) log.info('Parakeet setup stderr: %s', stderr);

        if (code === 0) {
          resolve();
          return;
        }

        reject(this.buildParakeetProcessError(`Parakeet runtime installation exited with code ${code ?? 'unknown'}`, stdout, stderr));
      });
    });
  }

  private buildParakeetCommandError(
    engine: ParakeetEngine,
    stage: string,
    error: any,
    timeoutMs?: number
  ): ParakeetProcessError {
    const label = PARAKEET_ENGINE_LABELS[engine];
    const stderr = typeof error?.stderr === 'string' ? error.stderr.trim() : '';
    const stdout = typeof error?.stdout === 'string' ? error.stdout.trim() : '';
    const detail = [stderr, stdout, error?.message || String(error)]
      .filter((value): value is string => Boolean(value && value.trim()))
      .join('\n\n')
      .trim();

    if (error?.killed && timeoutMs) {
      const timeoutError = new Error(
        `${label} ${stage} timed out (${Math.round(timeoutMs / 60_000)}m) while downloading or loading the model`
      ) as ParakeetProcessError;
      timeoutError.stdout = stdout;
      timeoutError.stderr = stderr;
      timeoutError.killed = true;
      timeoutError.detail = detail || timeoutError.message;
      return timeoutError;
    }

    const message = detail
      ? detail.replace(/\s+/g, ' ').trim()
      : `${label} ${stage} failed`;
    const commandError = new Error(message) as ParakeetProcessError;
    commandError.stdout = stdout;
    commandError.stderr = stderr;
    commandError.detail = detail || message;
    return commandError;
  }

  private async prefetchParakeetModel(
    engine: ParakeetEngine,
    timeoutMs: number = PARAKEET_MODEL_VERIFY_TIMEOUT_MS,
    reportProgress?: ParakeetSetupReporter
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        this.getParakeetPythonPath(),
        [this.getParakeetScriptPath(), '--server', '--model', PARAKEET_ENGINE_MODEL_IDS[engine]],
        {
          env: {
            ...process.env,
            ...this.getParakeetProcessEnv(),
          },
          stdio: ['pipe', 'pipe', 'pipe'],
        }
      );

      child.stdin?.end();

      let stdout = '';
      let stderr = '';
      let settled = false;

      const finish = (error?: ParakeetProcessError) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (error) {
          reject(this.buildParakeetCommandError(engine, 'model verification', error, timeoutMs));
          return;
        }
        resolve();
      };

      const updateProgress = (stage: ParakeetSetupStage, message: string, percent: number | null, detail: string | null) => {
        reportProgress?.({ stage, message, percent, detail });
      };

      const timeout = setTimeout(() => {
        child.kill('SIGKILL');
        finish(this.buildParakeetProcessError(
          `${PARAKEET_ENGINE_LABELS[engine]} model verification timed out`,
          stdout,
          stderr,
          true
        ));
      }, timeoutMs);

      child.stdout?.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stdout += text;
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stderr += text;
        const detail = this.getParakeetLatestProcessDetail(text);
        if (!detail) return;

        const normalized = detail.toLowerCase();
        const percent = this.getParakeetDownloadPercent(detail);
        if (percent !== null && percent < 100) {
          updateProgress('downloading-model', 'Downloading the Parakeet model…', percent, detail);
          return;
        }
        if (normalized.includes('model loaded')) {
          updateProgress('loading-model', 'Loading the model into memory…', 100, detail);
          return;
        }
        if (normalized.includes('loading')) {
          updateProgress('loading-model', 'Loading the model into memory…', percent, detail);
          return;
        }

        updateProgress('verifying-model', 'Preparing the Parakeet model…', percent, detail);
      });

      child.on('error', (error) => {
        const processError = error as ParakeetProcessError;
        processError.stdout = stdout;
        processError.stderr = stderr;
        processError.detail = [stderr.trim(), stdout.trim(), error.message.trim()].filter(Boolean).join('\n\n').trim();
        finish(processError);
      });

      child.on('close', (code) => {
        if (stderr) log.info('%s verify stderr: %s', PARAKEET_ENGINE_LABELS[engine], stderr);
        if (stdout) log.info('%s verify stdout: %s', PARAKEET_ENGINE_LABELS[engine], stdout);

        if (code === 0 && stdout.includes('"ready": true')) {
          finish();
          return;
        }

        finish(this.buildParakeetProcessError(
          code === 0
            ? `${PARAKEET_ENGINE_LABELS[engine]} verification exited without a ready signal`
            : `${PARAKEET_ENGINE_LABELS[engine]} verification exited with code ${code ?? 'unknown'}`,
          stdout,
          stderr
        ));
      });
    });
  }

  getParakeetStatus(): ParakeetStatus {
    const persisted = this.readPersistedParakeetState();
    const runtimeInstalled = this.isParakeetInstalled();
    const cacheDir = this.getParakeetCacheDir();

    return {
      runtimeInstalled,
      pythonPath: this.getParakeetPythonPath(),
      scriptPath: this.getParakeetScriptPath(),
      cacheDir,
      cacheExists: fs.existsSync(cacheDir),
      serverState: this.parakeetServer?.isReady
        ? 'ready'
        : this.parakeetServer?.isStarting
          ? 'warming'
          : 'idle',
      activeEngine: this.parakeetServerEngine,
      engines: (Object.keys(PARAKEET_ENGINE_LABELS) as ParakeetEngine[]).map((engine) => {
        const state = persisted.engines?.[engine];
        const verified = runtimeInstalled && Boolean(state?.verifiedAt) && !this.hasParakeetFailureSinceLastVerification(state);
        const lastError = state?.lastError ?? null;
        return {
          engine,
          label: PARAKEET_ENGINE_LABELS[engine],
          verified,
          needsReinstall: runtimeInstalled && this.hasParakeetFailureSinceLastVerification(state),
          lastError,
          lastErrorDetail: state?.lastErrorDetail ?? null,
          lastErrorAt: state?.lastErrorAt ?? null,
          setupError: state?.setupError ?? null,
        };
      }),
    };
  }

  async setupParakeet(engine: ParakeetEngine = 'parakeet'): Promise<{ success: boolean; error?: string; setupError?: ParakeetSetupError }> {
    const venvDir = path.join(this.getParakeetBasePath(), 'venv');
    const reportProgress: ParakeetSetupReporter = (progress) => {
      this.emitParakeetSetupProgress(engine, progress);
    };
    const verifyAndStart = async () => {
      reportProgress({
        stage: 'verifying-model',
        message: 'Preparing the Parakeet model…',
        percent: null,
        detail: null,
      });
      await this.prefetchParakeetModel(engine, PARAKEET_MODEL_VERIFY_TIMEOUT_MS, reportProgress);
      reportProgress({
        stage: 'starting-server',
        message: 'Starting the Parakeet server…',
        percent: 100,
        detail: null,
      });
      await this.startParakeetServer(engine);
    };

    try {
      const preflight = await runParakeetPythonPreflight();
      if (!preflight.ok) {
        throw this.createParakeetSetupError(preflight.setupError);
      }

      reportProgress({
        stage: 'installing-runtime',
        message: 'Installing the Parakeet runtime…',
        percent: null,
        detail: `${preflight.detail}\nvenv: ${venvDir}`,
      });
      await this.installParakeetRuntime(venvDir, preflight.pythonCommand, reportProgress);

      let repairedCorruptCache = false;
      while (true) {
        try {
          await verifyAndStart();
          break;
        } catch (error) {
          if (repairedCorruptCache || !this.isParakeetRepairableCacheError(error)) {
            throw error;
          }

          const repairedRepos = this.repairParakeetModelCache(engine, error);
          if (repairedRepos.length === 0) {
            throw error;
          }

          repairedCorruptCache = true;
          this.stopParakeetServer();
          reportProgress({
            stage: 'verifying-model',
            message: 'Repairing the Parakeet model cache…',
            percent: null,
            detail: 'Cleared the cached model snapshot and retrying download…',
          });
        }
      }

      reportProgress({
        stage: 'completed',
        message: `${PARAKEET_ENGINE_LABELS[engine]} is ready.`,
        percent: 100,
        detail: null,
      });
      this.stopParakeetServer();
      return { success: true };
    } catch (error: any) {
      this.stopParakeetServer();
      const setupError = this.markParakeetEngineFailure(engine, error);
      reportProgress({
        stage: 'failed',
        message: setupError.summary,
        percent: null,
        detail: setupError.detail,
      });
      log.error('Parakeet setup failed: %s', setupError.summary);
      return { success: false, error: setupError.summary, setupError };
    }
  }

  private async warmupParakeetServer(engine: ParakeetEngine): Promise<void> {
    try {
      await this.startParakeetServer(engine);
    } catch (error) {
      log.warn('%s warmup failed: %s', PARAKEET_ENGINE_LABELS[engine], (error as Error).message);
      this.stopParakeetServer();
    }
  }

  async uninstallParakeet(): Promise<{ success: boolean; error?: string }> {
    try {
      // Stop running server first
      this.stopParakeetServer();

      const basePath = this.getParakeetBasePath();
      if (fs.existsSync(basePath)) {
        fs.rmSync(basePath, { recursive: true, force: true });
        log.info('Parakeet uninstalled: deleted %s', basePath);
      }

      // Keep the selected engine Parakeet-only even after uninstall. The user can
      // reinstall the runtime from Settings.
      const currentEngine = this.preferences.getPreference('transcriptionEngine');
      if (isParakeetEngine(currentEngine)) {
        await this.preferences.save({
          transcriptionEngine: 'parakeet',
          hotMicTranscriptionEngine: 'default',
        });
      }

      return { success: true };
    } catch (error: any) {
      const message = error?.message || String(error);
      log.error('Parakeet uninstall failed: %s', message);
      return { success: false, error: message };
    }
  }

  private getOrCreateParakeetServer(engine: ParakeetEngine): StdioJsonServer {
    if (!this.parakeetServer || this.parakeetServerEngine !== engine) {
      this.parakeetServer?.stop();
      this.parakeetServer = new StdioJsonServer({
        name: PARAKEET_ENGINE_LABELS[engine],
        command: this.getParakeetPythonPath(),
        args: [this.getParakeetScriptPath(), '--server', '--model', PARAKEET_ENGINE_MODEL_IDS[engine]],
        timeoutMs: 300_000,
        env: this.getParakeetProcessEnv(),
      });
      this.parakeetServerEngine = engine;
    }
    return this.parakeetServer;
  }

  private async startParakeetServer(engine: ParakeetEngine): Promise<void> {
    try {
      await this.getOrCreateParakeetServer(engine).start();
      this.markParakeetEngineVerified(engine);
    } catch (error) {
      const setupError = this.markParakeetEngineFailure(engine, error);
      throw new Error(setupError.summary);
    }
  }

  stopParakeetServer(): void {
    this.parakeetServer?.stop();
    this.parakeetServer = null;
    this.parakeetServerEngine = null;
  }

  private sendParakeetCommand(engine: ParakeetEngine, cmd: Record<string, unknown>) {
    return this.getOrCreateParakeetServer(engine).send(cmd);
  }

  /**
   * Transcribe audio using NVIDIA Parakeet TDT 0.6B v2.
   * Starts the server on first use, auto-restarts on crash (one retry).
   */
  private async transcribeWithParakeet(wavPath: string, engine: ParakeetEngine): Promise<string> {
    const needTimestamps = this.screenshotMetadata.length > 0;
    const engineLabel = PARAKEET_ENGINE_LABELS[engine];

    const doTranscribe = async (): Promise<string> => {
      await this.startParakeetServer(engine);

      const response = await this.sendParakeetCommand(engine, {
        cmd: 'transcribe',
        audio: wavPath,
        timestamps: needTimestamps,
      });

      if (!response.ok) {
        throw new Error(`${engineLabel} transcription failed: ${response.error}`);
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
      log.warn('%s transcription failed, restarting server: %s', engineLabel, message);
      this.stopParakeetServer();
      return await doTranscribe();
    }
  }

  /**
   * Paste text into the active application using AppleScript.
   */
  private async pasteText(targetBundleId: string | null = null): Promise<void> {
    try {
      if (targetBundleId) {
        const safeBundleId = targetBundleId.replace(/"/g, '');
        const activateScript = `tell application id "${safeBundleId}" to activate`;
        await execFileAsync('osascript', ['-e', activateScript], { timeout: 1000 });
        await new Promise((resolve) => setTimeout(resolve, 80));
      }
      // Use AppleScript to send Command+V
      await execFileAsync('osascript', ['-e', 'tell application "System Events" to keystroke "v" using command down'], { timeout: 2000 });
    } catch (error) {
      // If paste fails (e.g., no input field selected), text is still in clipboard.
      this.emit('paste-failed', 'No active input field found - copied to clipboard', this.lastTranscription);
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

  getStandardRecordingDiagnostics(): StandardRecordingDiagnostics {
    return {
      status: this.status,
      source: this.getRecordingSource(),
      activeSource: this.activeRecordingSource,
      recordingAgeMs: this.recordingStartTime > 0
        ? Math.max(0, Date.now() - this.recordingStartTime)
        : null,
      helperRecordingActive: typeof this.nativeHelper.isRecordingActive === 'function'
        ? this.nativeHelper.isRecordingActive()
        : null,
      liveTranscriptChars: this.standardLiveTranscript.trim().length,
      queueDepth: this.getStandardRealtimePressureDepth(),
      chunkProcessingInFlight: this.standardChunkProcessingInFlight,
    };
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
   * Pre-start the selected Parakeet transcription engine so the first
   * transcription is fast.
   */
  async warmup(): Promise<void> {
    const primaryEngine = this.getConfiguredTranscriptionEngine();
    const hotMicEngine = this.resolveHotMicTranscriptionEngine();
    const engines = Array.from(new Set<TranscriptionEngine>([primaryEngine, hotMicEngine]));

    const parakeetEngine = engines.find(isParakeetEngine);
    if (parakeetEngine && this.isParakeetInstalled()) {
      await this.warmupParakeetServer(parakeetEngine);
    }
  }

  /**
   * Restart runtime after engine/model settings change to avoid stale worker state.
   */
  async restartTranscriptionRuntime(): Promise<void> {
    this.stopParakeetServer();

    const primaryEngine = this.getConfiguredTranscriptionEngine();
    const hotMicEngine = this.resolveHotMicTranscriptionEngine();
    const engines = Array.from(new Set<TranscriptionEngine>([primaryEngine, hotMicEngine]));

    const parakeetEngine = engines.find(isParakeetEngine);
    if (parakeetEngine && this.isParakeetInstalled()) {
      await this.warmupParakeetServer(parakeetEngine);
    }
  }

  getConfiguredTranscriptionEngine(): TranscriptionEngine {
    const configured = this.preferences.getPreference('transcriptionEngine') as string | undefined;
    if (isParakeetEngine(configured)) {
      return configured;
    }
    return 'parakeet';
  }

  private resolveHotMicTranscriptionEngine(): TranscriptionEngine {
    // Hot Mic now always uses the global transcription engine.
    return this.getConfiguredTranscriptionEngine();
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
    const fallbackAvailable = false;

    // Parakeet runs on any architecture (ONNX Runtime CPU), no Apple Silicon needed.
    if (isParakeetEngine(selectedEngine)) {
      const engineLabel = PARAKEET_ENGINE_LABELS[selectedEngine];
      const parakeetStatus = this.getParakeetStatus();
      const engineStatus = parakeetStatus.engines.find((engine) => engine.engine === selectedEngine);
      if (!this.isParakeetInstalled()) {
        return this.buildHotMicEngineStatus(
          selectedEngine,
          whisperModel,
          fallbackAvailable,
          'not-installed',
          `${engineLabel} runtime is not installed`
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
      if (engineStatus?.needsReinstall && engineStatus.lastError) {
        return this.buildHotMicEngineStatus(
          selectedEngine,
          whisperModel,
          fallbackAvailable,
          'disabled',
          `${engineLabel} needs reinstall: ${engineStatus.lastError}`
        );
      }
      if (this.parakeetServer?.isReady) {
        return this.buildHotMicEngineStatus(
          selectedEngine,
          whisperModel,
          fallbackAvailable,
          'ready',
          `${engineLabel} server is ready`
        );
      }
      if (this.parakeetServer?.isStarting) {
        return this.buildHotMicEngineStatus(
          selectedEngine,
          whisperModel,
          fallbackAvailable,
          'warming',
          `${engineLabel} server is warming up`
        );
      }
      return this.buildHotMicEngineStatus(
        selectedEngine,
        whisperModel,
        fallbackAvailable,
        'cold',
        `${engineLabel} server is idle (starts on first chunk)`
      );
    }

    return this.buildHotMicEngineStatus(
      selectedEngine,
      whisperModel,
      fallbackAvailable,
      'not-installed',
      'Parakeet runtime is not installed'
    );
  }

  /**
   * Pre-start transcription runtime for Hot Mic using the global engine selection.
   */
  async warmupForHotMic(): Promise<void> {
    const engine = this.resolveHotMicTranscriptionEngine();
    if (isParakeetEngine(engine)) {
      if (!this.isParakeetInstalled()) {
        return;
      }
      await this.warmupParakeetServer(engine);
      return;
    }

  }

  /**
   * Transcribe for Hot Mic using the global Parakeet engine.
   */
  async transcribeAudioForHotMic(wavPath: string): Promise<string> {
    this.lastHotMicUsedWhisperFallback = false;
    const engine = this.resolveHotMicTranscriptionEngine();
    return this.transcribeWithEngineFallback(wavPath, engine);
  }

  lastHotMicUsedWhisperFallback: boolean = false;

  /**
   * Transcribe an audio file using the user's configured engine.
   * Exposed for HotMicManager so it can share the active runtime.
   */
  async transcribeAudio(wavPath: string): Promise<string> {
    const engine = this.getConfiguredTranscriptionEngine();
    return this.transcribeWithEngineFallback(wavPath, engine);
  }

  async startMeetingCapture(): Promise<MeetingCaptureSession> {
    if (this.activeMeetingCapture) {
      throw new Error('Meeting capture is already active.');
    }

    if (this.status !== 'idle') {
      throw new Error(`Cannot start meeting capture while transcription is ${this.status}.`);
    }

    const onboardingComplete = this.preferences.getPreference('onboardingComplete');
    if (!onboardingComplete) {
      throw new Error('Complete onboarding before starting meeting capture.');
    }

    const source = this.getRecordingSource();
    if (source === 'system-audio' && systemPreferences.getMediaAccessStatus('screen') !== 'granted') {
      throw new Error('System audio capture requires Screen Recording permission. Open Settings → Privacy & Security → Screen Recording.');
    }

    const configuredEngine = this.getConfiguredTranscriptionEngine();
    const transcriptionEngine = isParakeetEngine(configuredEngine) ? configuredEngine : 'parakeet';

    this.activeMeetingCapture = {
      startedAt: new Date().toISOString(),
      source,
      transcriptionEngine,
      whisperModelOverride: null,
      speakerDiarizationSupported: false,
    };

    try {
      this.standardSessionCancelRequested = false;
      this.activeRecordingSource = source;
      this.recordingStartTime = Date.now();
      this.hasAudioContent = false;
      this.pendingAbandonConfirmation = false;
      this.currentStack = [];
      this.screenshotMetadata = [];
      this.detectedCommands = [];
      this.detachStandardChunkListener();
      this.clearStandardLiveTranscript();
      this.nativeHelper.setHarvestMode('off');
      this.setStatus('recording');
      this.overlay.showRecording();
      this.soundManager.play('recordingStart');
      await this.nativeHelper.startRecording(source);
      return this.activeMeetingCapture;
    } catch (error) {
      this.activeMeetingCapture = null;
      this.activeRecordingSource = null;
      this.clearStack();
      this.setStatus('idle');
      this.handleOverlayAfterTranscription();
      this.emit('error', error as Error);
      throw error;
    }
  }

  async stopMeetingCapture(): Promise<MeetingCaptureResult> {
    const capture = this.activeMeetingCapture;
    if (!capture) {
      throw new Error('No meeting capture is active.');
    }

    let audioPath: string | null = null;

    try {
      this.soundManager.play('recordingStop');
      this.setStatus('transcribing');
      this.overlay.showTranscribing();
      this.detachStandardChunkListener();
      this.nativeHelper.setHarvestMode('off');
      audioPath = await this.nativeHelper.stopRecording();
      this.activeRecordingSource = null;
      const transcript = await this.transcribeMeetingCapture(audioPath, capture);
      const result: MeetingCaptureResult = {
        ...capture,
        speakerDiarizationSupported: transcript.speakerDiarizationSupported,
        stoppedAt: new Date().toISOString(),
        transcriptText: transcript.text.trim(),
        audioPath,
      };
      this.activeMeetingCapture = null;
      this.clearStandardLiveTranscript();
      this.clearStack();
      this.setStatus('idle');
      this.handleOverlayAfterTranscription();
      return result;
    } catch (error) {
      this.activeMeetingCapture = null;
      this.activeRecordingSource = null;
      this.clearStandardLiveTranscript();
      this.clearStack();
      this.setStatus('idle');
      this.handleOverlayAfterTranscription();
      this.emit('error', error as Error);
      throw error;
    }
  }

  private async transcribeMeetingCapture(
    audioPath: string,
    capture: MeetingCaptureSession,
  ): Promise<{ text: string; speakerDiarizationSupported: boolean }> {
    const text = await this.transcribeWithEngineFallback(audioPath, capture.transcriptionEngine);
    return { text, speakerDiarizationSupported: false };
  }

  async cancelMeetingCapture(): Promise<void> {
    if (!this.activeMeetingCapture) {
      return;
    }

    try {
      await this.nativeHelper.cancelRecording();
    } finally {
      this.activeMeetingCapture = null;
      this.activeRecordingSource = null;
      this.clearStandardLiveTranscript();
      this.clearStack();
      this.setStatus('idle');
      this.overlay.showStatus(MESSAGES.overlay.cancelled);
    }
  }

  /**
   * Get the currently selected model size.
   */
  getSelectedModel(): string {
    return this.modelManager.getSelectedModel();
  }

  getRecordingSource(): RecordingInputSource {
    const configured = this.preferences.getPreference('transcriptionInputSource');
    return configured === 'system-audio' ? 'system-audio' : 'microphone';
  }

  async setRecordingSource(source: RecordingInputSource): Promise<void> {
    await this.preferences.save({ transcriptionInputSource: source });
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
   * Get the number of items currently in the stack.
   */
  getStackLength(): number {
    return this.currentStack.length;
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
          // Quota exhausted - don't stack, emit temporary status.
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

    // Emit the screenshot count: use screenshotMetadata during recording (precise),
    // or currentStack length when idle (only screenshots are added when idle).
    const count = (this.status === 'recording' || this.status === 'silentStacking')
      ? this.screenshotMetadata.length
      : this.currentStack.length;
    this.emit('stackChanged', count);
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
        const figureRefs = figures.map(f => `[figure ${f}]`).join(' ');
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
  
  private insertFigureReferences(text: string, segments = this.standardLiveSegments): string {
    return insertFigureReferencesInline(text, segments, this.screenshotMetadata);
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
      const { stdout } = await execFileAsync('osascript', ['-e', script], { timeout: 1000 });
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
   * The text should already have inline [figure X] references inserted.
   * This adds a figure path section at the end.
   */
  private async addImagePathsToText(text: string, items: ClipboardItem[]): Promise<string> {
    const figurePaths: string[] = [];

    // Find all image items and export them
    for (const item of items) {
      if (item.imageData && item.figureLabel) {
        const imagePath = await this.clipboardManager!.exportImageToCache(item);
        if (imagePath) {
          // Use real path for terminal compatibility
          figurePaths.push(`figure ${item.figureLabel}: \`${imagePath.replace(os.homedir(), '~')}\``);
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

  private formatMarkdownImageDestination(filePath: string): string {
    const expandedPath = filePath === '~' || filePath.startsWith('~/')
      ? `${os.homedir()}${filePath.slice(1)}`
      : filePath;
    const url = /^file:\/\//i.test(expandedPath)
      ? expandedPath
      : `file://${expandedPath.split('/').map((part, index) => (
        index === 0 ? '' : encodeURIComponent(part)
      )).join('/')}`;
    return `<${url.replace(/>/g, '%3E')}>`;
  }

  private async buildFieldTheoryMarkdownStackPayload(items: ClipboardItem[]): Promise<string> {
    const textBlocks: string[] = [];
    const imageBlocks: string[] = [];
    let imageIndex = 1;

    for (const item of items) {
      if (item.type === 'text' || item.type === 'transcript') {
        const textContent = (item.useImprovedVersion && item.improvedContent)
          ? item.improvedContent
          : (item.content || '');
        if (textContent.trim()) textBlocks.push(textContent.trimEnd());
      }
    }

    for (const item of items) {
      if (!item.imageData && item.type !== 'image' && item.type !== 'screenshot') continue;

      const imagePath = await this.clipboardManager?.exportImageToCache(item);
      if (!imagePath) {
        imageBlocks.push(`> Image ${imageIndex} was unavailable when this note was created.`);
        imageIndex += 1;
        continue;
      }

      const alt = item.figureLabel
        ? `figure ${item.figureLabel}`
        : item.sourceAppName
          ? `${item.sourceAppName} image`
          : `Image ${imageIndex}`;
      imageBlocks.push(`![${alt.replace(/\]/g, '\\]')}](${this.formatMarkdownImageDestination(imagePath)})`);
      imageIndex += 1;
    }

    const blocks = [...textBlocks, ...imageBlocks];
    return blocks.join('\n\n');
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

  private canInsertIntoFieldTheoryMarkdown(frontmostBundleId: string | null): boolean {
    return this.isFieldTheoryBundleId(frontmostBundleId)
      && (this.fieldTheoryMarkdownInsertionTarget?.isAvailable() ?? false);
  }

  private canInsertIntoFieldTheoryTerminal(frontmostBundleId: string | null): boolean {
    return this.isFieldTheoryBundleId(frontmostBundleId)
      && (this.fieldTheoryTerminalInsertionTarget?.isAvailable() ?? false);
  }

  private insertTextIntoFieldTheoryMarkdown(text: string): boolean {
    if (!text) return false;
    return this.fieldTheoryMarkdownInsertionTarget?.insertText(text) ?? false;
  }

  private insertTextIntoFieldTheoryTerminal(text: string): boolean {
    if (!text) return false;
    return this.fieldTheoryTerminalInsertionTarget?.insertText(text) ?? false;
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
    clearAfter: boolean,
    useFieldTheoryTerminalTarget = false
  ): Promise<boolean> {
    if (useFieldTheoryTerminalTarget) {
      if (this.insertTextIntoFieldTheoryTerminal(text)) {
        this.skipNextPasteFailedNotification = true;
        return true;
      }
      clipboard.writeText(text);
      this.clipboardManager?.syncClipboardHash();
      this.emitPasteFailureAndMaybeClear(
        'Field Theory terminal paste failed - copied to clipboard',
        clearAfter
      );
      return false;
    }

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
    const useFieldTheoryTerminalTarget = this.canInsertIntoFieldTheoryTerminal(frontmostBundleId);
    const useFieldTheoryMarkdownTarget = !useFieldTheoryTerminalTarget
      && this.canInsertIntoFieldTheoryMarkdown(frontmostBundleId);
    const forcedTargetBundleId = useFieldTheoryMarkdownTarget
      ? null
      : this.resolveStandardPasteTargetBundleId(frontmostBundleId);
    if (this.isFieldTheoryBundleId(frontmostBundleId) && !useFieldTheoryTerminalTarget && !useFieldTheoryMarkdownTarget && !forcedTargetBundleId) {
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

    if (useFieldTheoryMarkdownTarget) {
      const markdownPayload = await this.buildFieldTheoryMarkdownStackPayload(items);
      if (this.insertTextIntoFieldTheoryMarkdown(this.addFollowupTypingSpace(markdownPayload))) {
        this.skipNextPasteFailedNotification = true;
        if (clearAfter) {
          this.clearStack();
        }
        return;
      }
    }

    // Detect app capabilities from the effective paste target.
    const effectiveTargetBundleId = forcedTargetBundleId ?? frontmostBundleId;
    const isTerminal = useFieldTheoryTerminalTarget || isTerminalApp(effectiveTargetBundleId);
    const isIDE = !useFieldTheoryTerminalTarget && isIDEWithTerminal(effectiveTargetBundleId);
    const pasteImagesAsPaths = isTerminal || isIDE;
    const mixedMultimodalPaste = shouldPasteMixedStackImagesFirst(effectiveTargetBundleId, items);
    const orderedItems = orderStackItemsForPaste(items, effectiveTargetBundleId);

    // Check if we have a transcript with figures
    const hasTranscriptWithFigures =
      items.some(i => i.type === 'text' || i.type === 'transcript') &&
      items.some(i => i.imageData && i.figureLabel);

    // Find the last text/transcript item for appending figure paths.
    const lastTextItemIndex = items.reduce((lastIdx, item, idx) =>
      (item.type === 'text' || item.type === 'transcript') ? idx : lastIdx, -1);

    // For mixed multimodal stacks, paste images before text so composer-style
    // apps keep the attachments instead of dropping them after draft text exists.
    for (let itemIdx = 0; itemIdx < orderedItems.length; itemIdx++) {
      const item = orderedItems[itemIdx];
      if (item.type === 'text' || item.type === 'transcript') {
        // Use improved content if available and toggle is set.
        let textContent = (item.useImprovedVersion && item.improvedContent)
          ? item.improvedContent
          : (item.content || '');

        // Append figure paths at the end for terminal-like targets, but only on the LAST text item.
        // Other apps get inline [figure X] refs without the file path list.
        if (this.currentStack.length > 1 && pasteImagesAsPaths && itemIdx === lastTextItemIndex) {
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
        if (!(await this.pasteTextIntoResolvedTarget(payload, forcedTargetBundleId, clearAfter, useFieldTheoryTerminalTarget))) {
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
        if (pasteImagesAsPaths) {
          // For terminal-like targets, skip individual images if they're already
          // represented in the transcript's figure list.
          if (hasTranscriptWithFigures) {
            continue;
          }
          // For terminal-like targets without transcript, export image to file and paste path.
          const imagePath = await this.clipboardManager!.exportImageToCache(item);
          if (imagePath) {
            // Use real path for terminal compatibility
            const imagePathText = `${imagePath} `;
            if (useFieldTheoryTerminalTarget) {
              if (!this.insertTextIntoFieldTheoryTerminal(imagePathText)) {
                clipboard.writeText(imagePathText);
                this.clipboardManager?.syncClipboardHash();
                this.emitPasteFailureAndMaybeClear(
                  'Field Theory terminal paste failed - copied to clipboard',
                  clearAfter
                );
                return;
              }
              this.skipNextPasteFailedNotification = true;
            } else {
              clipboard.writeText(imagePathText);
              this.clipboardManager?.syncClipboardHash();
              await this.pasteText(forcedTargetBundleId);
            }
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
      if (!mixedMultimodalPaste && itemIdx < orderedItems.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
        if (!(await this.pasteTextIntoResolvedTarget('\n', forcedTargetBundleId, clearAfter, useFieldTheoryTerminalTarget))) {
          return;
        }
      }

      if (itemIdx < orderedItems.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    if (clearAfter) {
      this.clearStack();
    }
  }

  async runRecordingDeliveryQualityBenchmark(input: {
    benchmarkId: string;
    text: string;
  }): Promise<{
    success: boolean;
    pasteMs: number;
    totalMs: number;
    textChars: number;
    error?: string;
  }> {
    const traceContext = {
      benchmark: true,
      benchmarkId: input.benchmarkId,
      delivery: 'recording-textedit',
      qualityScenario: 'synthetic-recording-textedit',
      source: 'quality-benchmark',
    };
    const startedAt = performance.now();
    const previousStack = [...this.currentStack];
    const previousDetectedCommands = [...this.detectedCommands];
    const previousLastTranscription = this.lastTranscription;

    if (this.status !== 'idle') {
      appendTranscriberTrace('benchmark.error', {
        ...traceContext,
        error: `Transcriber status is ${this.status}`,
      });
      return {
        success: false,
        pasteMs: 0,
        totalMs: Math.round(performance.now() - startedAt),
        textChars: input.text.length,
        error: `Transcriber status is ${this.status}`,
      };
    }

    if (!this.clipboardManager) {
      appendTranscriberTrace('benchmark.error', {
        ...traceContext,
        error: 'Clipboard manager unavailable',
      });
      return {
        success: false,
        pasteMs: 0,
        totalMs: Math.round(performance.now() - startedAt),
        textChars: input.text.length,
        error: 'Clipboard manager unavailable',
      };
    }

    try {
      appendTranscriberTrace('finish.accepted', {
        ...traceContext,
        recordingAgeMs: 0,
        liveChars: input.text.length,
        queueDepth: 0,
        helperActive: false,
      });
      this.setStatus('transcribing');
      const prepMs = Math.round(performance.now() - startedAt);
      appendTranscriberTrace('finish.prep', {
        ...traceContext,
        snapshotMs: 0,
        snapshotStatus: 'benchmark-skipped',
        stopMs: 0,
        drainMs: 0,
        totalMs: prepMs,
        liveChars: input.text.length,
        queueDepth: 0,
        helperActive: false,
        wavBytes: 0,
      });

      appendTranscriberTrace('benchmark.delivery-phase', {
        ...traceContext,
        phase: 'store-transcript-start',
        totalMs: Math.round(performance.now() - startedAt),
      });
      const itemId = await this.clipboardManager.storeText(input.text, 'transcript');
      if (itemId <= 0) {
        throw new Error('Could not store benchmark transcript');
      }
      appendTranscriberTrace('benchmark.delivery-phase', {
        ...traceContext,
        phase: 'store-transcript-done',
        totalMs: Math.round(performance.now() - startedAt),
        itemId,
      });
      this.currentStack = [itemId];
      this.detectedCommands = [];
      this.lastTranscription = input.text;

      const pasteStart = performance.now();
      appendTranscriberTrace('benchmark.delivery-phase', {
        ...traceContext,
        phase: 'paste-stack-start',
        totalMs: Math.round(performance.now() - startedAt),
      });
      await this.notifyPasteStarting();
      await this.pasteStack(false);
      const pasteMs = Math.round(performance.now() - pasteStart);
      appendTranscriberTrace('benchmark.delivery-phase', {
        ...traceContext,
        phase: 'paste-stack-done',
        pasteMs,
        totalMs: Math.round(performance.now() - startedAt),
      });
      const totalMs = Math.round(performance.now() - startedAt);
      appendTranscriberTrace('finish.done', {
        ...traceContext,
        textSource: 'benchmark',
        textChars: input.text.length,
        asrMs: 0,
        cmdMs: 0,
        pasteMs,
        totalMs,
        tailBytes: 0,
        commands: [],
      });
      this.emit('result', input.text);
      return {
        success: true,
        pasteMs,
        totalMs,
        textChars: input.text.length,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Recording benchmark failed';
      appendTranscriberTrace('benchmark.error', {
        ...traceContext,
        totalMs: Math.round(performance.now() - startedAt),
        error,
      });
      return {
        success: false,
        pasteMs: 0,
        totalMs: Math.round(performance.now() - startedAt),
        textChars: input.text.length,
        error: message,
      };
    } finally {
      this.currentStack = previousStack;
      this.detectedCommands = previousDetectedCommands;
      this.lastTranscription = previousLastTranscription;
      this.setStatus('idle');
      this.handleOverlayAfterTranscription();
    }
  }

  async runRecordingAsrQualityBenchmark(input: {
    benchmarkId: string;
    wavPath: string;
  }): Promise<{
    success: boolean;
    asrMs: number;
    totalMs: number;
    textChars: number;
    wavBytes: number | null;
    error?: string;
  }> {
    const traceContext = {
      benchmark: true,
      benchmarkId: input.benchmarkId,
      delivery: 'recording-asr-fixture',
      qualityScenario: 'fixture-audio',
      source: 'quality-benchmark',
    };
    const startedAt = performance.now();

    if (this.status !== 'idle') {
      const totalMs = Math.round(performance.now() - startedAt);
      const error = `Transcriber status is ${this.status}`;
      appendTranscriberTrace('benchmark.asr-error', {
        ...traceContext,
        totalMs,
        error,
      });
      return {
        success: false,
        asrMs: 0,
        totalMs,
        textChars: 0,
        wavBytes: null,
        error,
      };
    }

    let wavBytes: number | null = null;
    try {
      wavBytes = await fs.promises.stat(input.wavPath).then(stat => stat.size).catch(() => null);
      appendTranscriberTrace('benchmark.asr-start', {
        ...traceContext,
        wavBytes,
      });
      this.setStatus('transcribing');
      const asrStart = performance.now();
      const text = await this.transcribeAudio(input.wavPath);
      const asrMs = Math.round(performance.now() - asrStart);
      const totalMs = Math.round(performance.now() - startedAt);
      appendTranscriberTrace('benchmark.asr-success', {
        ...traceContext,
        asrMs,
        totalMs,
        textChars: text.length,
        wavBytes,
      });
      return {
        success: true,
        asrMs,
        totalMs,
        textChars: text.length,
        wavBytes,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Recording ASR benchmark failed';
      const totalMs = Math.round(performance.now() - startedAt);
      appendTranscriberTrace('benchmark.asr-error', {
        ...traceContext,
        totalMs,
        wavBytes,
        error: message,
      });
      return {
        success: false,
        asrMs: 0,
        totalMs,
        textChars: 0,
        wavBytes,
        error: message,
      };
    } finally {
      this.setStatus('idle');
      this.handleOverlayAfterTranscription();
    }
  }

  async runRecordingAsrDeliveryQualityBenchmark(input: {
    benchmarkId: string;
    wavPath: string;
  }): Promise<{
    success: boolean;
    asrMs: number;
    pasteMs: number;
    totalMs: number;
    textChars: number;
    text: string;
    wavBytes: number | null;
    error?: string;
  }> {
    const traceContext = {
      benchmark: true,
      benchmarkId: input.benchmarkId,
      delivery: 'recording-asr-textedit',
      qualityScenario: 'fixture-audio-textedit',
      source: 'quality-benchmark',
    };
    const startedAt = performance.now();
    const previousStack = [...this.currentStack];
    const previousDetectedCommands = [...this.detectedCommands];
    const previousLastTranscription = this.lastTranscription;

    if (this.status !== 'idle') {
      const totalMs = Math.round(performance.now() - startedAt);
      const error = `Transcriber status is ${this.status}`;
      appendTranscriberTrace('benchmark.asr-delivery-error', {
        ...traceContext,
        totalMs,
        error,
      });
      return { success: false, asrMs: 0, pasteMs: 0, totalMs, textChars: 0, text: '', wavBytes: null, error };
    }

    if (!this.clipboardManager) {
      const totalMs = Math.round(performance.now() - startedAt);
      const error = 'Clipboard manager unavailable';
      appendTranscriberTrace('benchmark.asr-delivery-error', {
        ...traceContext,
        totalMs,
        error,
      });
      return { success: false, asrMs: 0, pasteMs: 0, totalMs, textChars: 0, text: '', wavBytes: null, error };
    }

    let wavBytes: number | null = null;
    let text = '';
    try {
      wavBytes = await fs.promises.stat(input.wavPath).then(stat => stat.size).catch(() => null);
      appendTranscriberTrace('finish.accepted', {
        ...traceContext,
        recordingAgeMs: 0,
        liveChars: 0,
        queueDepth: 0,
        helperActive: false,
        wavBytes,
      });
      this.setStatus('transcribing');
      const asrStart = performance.now();
      text = await this.transcribeAudio(input.wavPath);
      const asrMs = Math.round(performance.now() - asrStart);
      if (!text.trim()) {
        throw new Error('Recording ASR delivery benchmark produced empty transcript');
      }

      appendTranscriberTrace('finish.prep', {
        ...traceContext,
        snapshotMs: 0,
        snapshotStatus: 'benchmark-fixture',
        stopMs: 0,
        drainMs: 0,
        totalMs: Math.round(performance.now() - startedAt),
        asrMs,
        liveChars: text.length,
        queueDepth: 0,
        helperActive: false,
        wavBytes,
      });

      const itemId = await this.clipboardManager.storeText(text, 'transcript');
      if (itemId <= 0) {
        throw new Error('Could not store benchmark ASR transcript');
      }
      this.currentStack = [itemId];
      this.detectedCommands = [];
      this.lastTranscription = text;

      const pasteStart = performance.now();
      await this.notifyPasteStarting();
      await this.pasteStack(false);
      const pasteMs = Math.round(performance.now() - pasteStart);
      const totalMs = Math.round(performance.now() - startedAt);
      appendTranscriberTrace('finish.done', {
        ...traceContext,
        textSource: 'asr-fixture',
        textChars: text.length,
        asrMs,
        cmdMs: 0,
        pasteMs,
        totalMs,
        tailBytes: 0,
        commands: [],
        wavBytes,
      });
      this.emit('result', text);
      return {
        success: true,
        asrMs,
        pasteMs,
        totalMs,
        textChars: text.length,
        text,
        wavBytes,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Recording ASR delivery benchmark failed';
      const totalMs = Math.round(performance.now() - startedAt);
      appendTranscriberTrace('benchmark.asr-delivery-error', {
        ...traceContext,
        totalMs,
        wavBytes,
        textChars: text.length,
        error: message,
      });
      return {
        success: false,
        asrMs: 0,
        pasteMs: 0,
        totalMs,
        textChars: text.length,
        text,
        wavBytes,
        error: message,
      };
    } finally {
      this.currentStack = previousStack;
      this.detectedCommands = previousDetectedCommands;
      this.lastTranscription = previousLastTranscription;
      this.setStatus('idle');
      this.handleOverlayAfterTranscription();
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

    this.overlay.destroy();
  }
}
