import { EventEmitter } from 'events';
import { app, globalShortcut, clipboard, nativeImage, Notification } from 'electron';
import { getHotkeyManager } from './hotkeyManager';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
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
export type TranscriptionStatus = 'idle' | 'recording' | 'transcribing';

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
  private accessTokenGetter: (() => string | undefined) | null = null;
  private hasShownQuotaMessageThisPeriod: boolean = false;
  private recordingStartTime: number = 0;
  private skipNextPasteFailedNotification: boolean = false;
  private priorityMicSkippedForQuota: boolean = false; // True when quota exhausted, skip tracking
  private autoStackLimitShownThisSession: boolean = false; // Only show limit message once per session
  
  // Track which hotkey started recording for cross-hotkey improvement trigger.
  // If user starts with primary and ends with secondary (or vice versa), trigger improvement.
  private startedWithSecondaryHotkey: boolean = false;

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
   * @param abandon - true to abandon recording, false to continue
   */
  handleConfirmationResponse(abandon: boolean): void {
    if (!this.pendingAbandonConfirmation) return;
    
    this.pendingAbandonConfirmation = false;
    this.overlay.hideConfirmation();
    this.emit('confirmation-hide');
    
    if (abandon) {
      this.cancelRecording();
    }
    // If not abandoning, recording continues (no action needed)
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
   * Set the commands manager for portable commands feature.
   */
  setCommandsManager(manager: CommandsManager): void {
    this.commandsManager = manager;
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

      this.emit('error', new Error(errorMessage));
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
      this.emit('error', new Error(errorMessage));
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
   * Handle hotkey press - toggle recording.
   * @param isSecondary - True if triggered by secondary hotkey, false for primary
   */
  private async handleHotkeyPress(isSecondary: boolean): Promise<void> {
    if (this.status === 'idle') {
      this.startedWithSecondaryHotkey = isSecondary;
      await this.startRecording();
    } else if (this.status === 'recording') {
      // Determine if improvement should be triggered.
      // Improvement triggers when: both hotkeys are configured AND ended with different hotkey than started.
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

    // Block recording until onboarding is complete.
    const onboardingComplete = this.preferences.getPreference('onboardingComplete');
    if (!onboardingComplete) {
      return;
    }

    // Block recording if no model is downloaded.
    const modelAvailable = await this.modelManager.isModelAvailable();
    if (!modelAvailable) {
      const errorMsg = 'You must download a voice model first. Go to Settings → Transcription to download one.';
      this.emit('error', new Error(errorMsg));
      // Also show a visible note to the user
      this.cursorStatusManager?.showRecordingNote(errorMsg);
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

      // Check if model is available
      const selectedModel = this.modelManager.getSelectedModel();
      const modelAvailable = await this.modelManager.isModelAvailable();
      if (!modelAvailable) {
        this.setStatus('idle');
        this.handleOverlayAfterTranscription();
        this.emit('error', new Error(`Model "${selectedModel}" not available. Please download the model first.`));
        return;
      }

      // Switch to transcribing state
      this.setStatus('transcribing');
      this.overlay.showTranscribing();

      // Transcribe
      const text = await this.transcribe(wavPath);
      
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
      if (this.pendingAbandonConfirmation) {
        this.pendingAbandonConfirmation = false;
        this.overlay.hideConfirmation();
        this.cancelRecording();
        return;
      }
      
      if (this.clipboardHistoryVisibilityChecker?.()) {
        this.emit('dismiss-clipboard-history');
        return;
      }
      const confirmationEnabled = this.preferences.getPreference('abandonRecordingConfirmation') ?? true;
      
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
    // Clamp to valid range: 0-500
    const clamped = Math.max(0, Math.min(500, minWords));
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
   * Transcribe audio file using whisper-cli.
   */
  private async transcribe(wavPath: string): Promise<string> {
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
    if (this.currentStack.includes(itemId)) return;

    // Check auto-stack quota before adding screenshots to stack during recording.
    // Free tier: Allow first screenshot to stack (users can experience transcript + 1 figure)
    // Pro tier: Unlimited screenshots
    if (this.status === 'recording' && this.quotaManager) {
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
    
    // If we're currently recording, check if this is a screenshot and assign a figure label.
    if (this.status === 'recording' && this.clipboardManager) {
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

    // Paste in chronological order: oldest first (top), newest last (bottom).
    // This preserves the natural flow of conversation/context building.
    for (const item of items) {
      if (item.type === 'text' || item.type === 'transcript') {
        // Use improved content if available and toggle is set.
        let textContent = (item.useImprovedVersion && item.improvedContent)
          ? item.improvedContent
          : (item.content || '');

        // Append figure paths at the end for terminals when there are multiple items.
        // Non-terminals get inline [Figure X] refs without the file path list.
        if (this.currentStack.length > 1 && isTerminal) {
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
    this.overlay.destroy();
  }
}

