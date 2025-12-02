import { EventEmitter } from 'events';
import { app, globalShortcut, clipboard } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { NativeHelper } from './nativeHelper';
import { ModelManager } from './modelManager';
import { PreferencesManager } from './preferences';
import { RecordingOverlay } from './recordingOverlay';
import { ClipboardManager } from './clipboardManager';

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
  private overlay: RecordingOverlay;
  private clipboardManager: ClipboardManager | null = null;
  private status: TranscriptionStatus = 'idle';
  private hotkey: string = 'Alt+Space'; // Option+Space on macOS
  private registeredHotkey: string | null = null; // Track currently registered transcription hotkey
  private whisperProcess: ChildProcess | null = null;
  private escapeKeyRegistered: boolean = false;
  
  // Current stack of items (transcriptions + screenshots) for prompt stacking
  private currentStack: number[] = [];

  constructor(nativeHelper: NativeHelper, preferences: PreferencesManager, clipboardManager?: ClipboardManager) {
    super();
    this.nativeHelper = nativeHelper;
    this.preferences = preferences;
    this.clipboardManager = clipboardManager || null;
    // ModelManager will be initialized with selected model in init()
    this.modelManager = new ModelManager();
    this.overlay = new RecordingOverlay();
    
    // Listen for audio levels from native helper
    this.nativeHelper.on('audioLevel', (level: number) => {
      if (this.status === 'recording') {
        this.overlay.updateAudioLevel(level);
      }
    });
  }

  /**
   * Initialize the transcriber manager.
   * Loads preferences and registers the global hotkey.
   */
  async init(): Promise<void> {
    console.log('[TranscriberManager] Initializing...');

    // Load preferences
    await this.preferences.load();
    this.hotkey = this.preferences.getPreference('transcriptionHotkey');
    
    // Set the selected model from preferences
    const selectedModel = this.preferences.getPreference('selectedModel');
    this.modelManager.setSelectedModel(selectedModel);
    console.log(`[TranscriberManager] Using model: ${selectedModel}`);

    // Set overlay style from preferences
    const overlayStyle = this.preferences.getPreference('overlayStyle');
    this.overlay.setOverlayStyle(overlayStyle);
    console.log(`[TranscriberManager] Using overlay style: ${overlayStyle}`);

    // Register global hotkey
    await this.registerHotkey(this.hotkey);

    // Handle app quit - only unregister transcription hotkey
    app.on('will-quit', () => {
      if (this.registeredHotkey) {
        globalShortcut.unregister(this.registeredHotkey);
        this.registeredHotkey = null;
      }
    });
  }

  /**
   * Register a global hotkey. Unregisters the previous transcription hotkey if it exists.
   * Attempts to take precedence over other apps by checking if already registered.
   */
  private async registerHotkey(hotkey: string): Promise<boolean> {
    // Unregister existing transcription hotkey only (not all hotkeys)
    if (this.registeredHotkey && this.registeredHotkey !== hotkey) {
      globalShortcut.unregister(this.registeredHotkey);
      this.registeredHotkey = null;
    }

    // Check if the hotkey is already registered by another app
    // Note: This doesn't guarantee we can steal it, but we try
    const alreadyRegistered = globalShortcut.isRegistered(hotkey);
    if (alreadyRegistered) {
      console.warn(`[TranscriberManager] Hotkey ${hotkey} is already registered, attempting to override...`);
      // Try to unregister it (may not work if another app has it)
      globalShortcut.unregister(hotkey);
    }

    // Register new hotkey
    const registered = globalShortcut.register(hotkey, () => {
      this.handleHotkeyPress();
    });

    if (!registered) {
      console.error(`[TranscriberManager] Failed to register hotkey: ${hotkey}`);
      
      // Provide helpful error message
      let errorMessage = `Failed to register hotkey: ${hotkey}`;
      if (alreadyRegistered) {
        errorMessage += '. Another application may be using this hotkey. Please close that app or choose a different hotkey.';
      } else {
        // Check if it's a single key that Electron might not support
        if (!hotkey.includes('+')) {
          errorMessage += '. Single keys may not be supported. Try using a modifier key combination (e.g., Alt+Space, Command+K).';
        } else {
          errorMessage += '. The hotkey format may be invalid or not supported.';
        }
      }
      
      this.emit('error', new Error(errorMessage));
      return false;
    }

    this.hotkey = hotkey;
    this.registeredHotkey = hotkey; // Track the registered hotkey
    console.log(`[TranscriberManager] Registered transcription hotkey: ${hotkey}`);
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
   * Handle hotkey press - toggle recording.
   */
  private async handleHotkeyPress(): Promise<void> {
    if (this.status === 'idle') {
      await this.startRecording();
    } else if (this.status === 'recording') {
      await this.stopRecordingAndTranscribe();
    }
    // Ignore if transcribing
  }

  /**
   * Start recording audio.
   */
  private async startRecording(): Promise<void> {
    if (this.status !== 'idle') {
      console.warn('[TranscriberManager] Cannot start recording - not idle');
      return;
    }

    try {
      this.setStatus('recording');
      
      // Show overlay
      this.overlay.showRecording();
      
      // Register escape key to cancel recording
      this.registerEscapeKey();
      
      await this.nativeHelper.startRecording();
      console.log('[TranscriberManager] Recording started');
    } catch (error) {
      console.error('[TranscriberManager] Failed to start recording:', error);
      this.setStatus('idle');
      this.overlay.dismiss();
      this.unregisterEscapeKey();
      this.emit('error', error as Error);
    }
  }

  /**
   * Stop recording and transcribe the audio.
   */
  private async stopRecordingAndTranscribe(): Promise<void> {
    if (this.status !== 'recording') {
      console.warn('[TranscriberManager] Cannot stop recording - not recording');
      return;
    }

    try {
      // Unregister escape key
      this.unregisterEscapeKey();
      
      // Stop recording and get WAV file path
      const wavPath = await this.nativeHelper.stopRecording();
      console.log('[TranscriberManager] Recording stopped, file:', wavPath);

      // Check if model is available
      const modelAvailable = await this.modelManager.isModelAvailable();
      if (!modelAvailable) {
        this.setStatus('idle');
        this.overlay.dismiss();
        this.emit('error', new Error('Model not available. Please download the model first.'));
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
        // Silence detected - dismiss overlay without pasting (same as escape)
        console.log('[TranscriberManager] Silence detected - dismissing without paste');
        this.setStatus('idle');
        this.overlay.dismiss();
        return;
      }
      
      // Store transcription in clipboard history
      if (this.clipboardManager) {
        const itemId = await this.clipboardManager.storeText(trimmedText, 'transcript');
        if (itemId > 0) {
          this.currentStack.push(itemId);
        }
      }
      
      // Speech detected - paste text
      clipboard.writeText(trimmedText);
      await this.pasteText();
      this.emit('result', trimmedText);
      
      // Dismiss overlay
      this.setStatus('idle');
      this.overlay.dismiss();
    } catch (error) {
      console.error('[TranscriberManager] Transcription failed:', error);
      this.setStatus('idle');
      this.overlay.dismiss();
      this.emit('error', error as Error);
    }
  }
  
  /**
   * Cancel recording (called by escape key).
   */
  private async cancelRecording(): Promise<void> {
    if (this.status !== 'recording') {
      return;
    }

    try {
      console.log('[TranscriberManager] Cancelling recording (escape pressed)');
      await this.nativeHelper.cancelRecording();
      this.setStatus('idle');
      this.overlay.dismiss();
      this.unregisterEscapeKey();
    } catch (error) {
      console.error('[TranscriberManager] Failed to cancel recording:', error);
      this.setStatus('idle');
      this.overlay.dismiss();
      this.unregisterEscapeKey();
    }
  }
  
  /**
   * Register escape key to cancel recording.
   */
  private registerEscapeKey(): void {
    if (this.escapeKeyRegistered) {
      return;
    }
    
    const registered = globalShortcut.register('Escape', () => {
      this.cancelRecording();
    });
    
    if (registered) {
      this.escapeKeyRegistered = true;
      console.log('[TranscriberManager] Escape key registered for cancel');
    } else {
      console.warn('[TranscriberManager] Failed to register escape key');
    }
  }
  
  /**
   * Unregister escape key.
   */
  private unregisterEscapeKey(): void {
    if (!this.escapeKeyRegistered) {
      return;
    }
    
    globalShortcut.unregister('Escape');
    this.escapeKeyRegistered = false;
    console.log('[TranscriberManager] Escape key unregistered');
  }

  /**
   * Transcribe audio file using whisper-cli.
   */
  private async transcribe(wavPath: string): Promise<string> {
    const modelPath = this.modelManager.getModelPath();
    const whisperPath = this.getWhisperPath();

    return new Promise((resolve, reject) => {
      // Spawn whisper-cli process
      // whisper-cli -m model.bin -f audio.wav --no-timestamps --print-colors false
      const args = [
        '-m', modelPath,
        '-f', wavPath,
        '--no-timestamps',
        '--print-colors', 'false',
        '--language', 'en',
      ];

      console.log('[TranscriberManager] Running:', whisperPath, args.join(' '));

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

        // Strip ANSI escape codes (color codes) from output as a fallback
        // Pattern matches ANSI escape sequences like [38;5;227m, [0m, etc.
        const ansiEscapeRegex = /\u001b\[[0-9;]*m/g;
        let cleanedStdout = stdout.replace(ansiEscapeRegex, '');

        // Remove timestamp patterns like [00:00:00.000 --> 00:00:05.000] or [00:00:00 --> 00:00:05]
        // Also remove standalone timestamp lines
        cleanedStdout = cleanedStdout.replace(/\[\d{2}:\d{2}:\d{2}(?:\.\d{3})?\s*-->\s*\d{2}:\d{2}:\d{2}(?:\.\d{3})?\]/g, '');
        
        // Remove any remaining bracketed content that looks like metadata (e.g., [SPEAKER_TURN], [id: 0], etc.)
        // But be careful not to remove actual text in brackets - only remove if it looks like metadata
        cleanedStdout = cleanedStdout.replace(/\[(?:SPEAKER_TURN|id:\s*\d+|start:|end:)[^\]]*\]/gi, '');

        // Extract text from output
        // whisper-cli outputs the transcription text, possibly with some metadata
        // We want just the text content
        const lines = cleanedStdout.trim().split('\n');
        const text = lines
          .filter(line => {
            const trimmed = line.trim();
            // Skip empty lines
            if (trimmed.length === 0) return false;
            // Skip lines that are only timestamps or metadata (start with [ and contain --> or are just numbers/timestamps)
            if (trimmed.match(/^\[.*-->\s*\]/)) return false;
            if (trimmed.match(/^\[\d+:\d+:\d+/)) return false;
            // Skip lines that look like metadata markers
            if (trimmed.match(/^(###|Transcription|END|BEGIN)/i)) return false;
            return true;
          })
          .map(line => line.trim())
          .join(' ')
          .trim();

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
      console.log('[TranscriberManager] Text pasted successfully');
    } catch (error) {
      // If paste fails (e.g., accessibility denied), text is still in clipboard
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.warn('[TranscriberManager] Failed to paste text (accessibility may be denied):', errorMsg);
      // Emit a warning but don't throw - clipboard fallback is acceptable
      this.emit('error', new Error(`Failed to paste text. Text is in clipboard. Error: ${errorMsg}`));
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
   * Get the currently selected model size.
   */
  getSelectedModel(): string {
    return this.modelManager.getSelectedModel();
  }

  /**
   * Set the selected model size and save to preferences.
   */
  async setSelectedModel(size: string): Promise<void> {
    this.modelManager.setSelectedModel(size as any);
    await this.preferences.save({ selectedModel: size as any });
    console.log(`[TranscriberManager] Model changed to: ${size}`);
  }

  /**
   * Set the overlay style and save to preferences.
   */
  async setOverlayStyle(style: 'rectangle' | 'top-emerging'): Promise<void> {
    this.overlay.setOverlayStyle(style);
    await this.preferences.save({ overlayStyle: style });
    console.log(`[TranscriberManager] Overlay style changed to: ${style}`);
  }

  /**
   * Get the current overlay style.
   */
  getOverlayStyle(): 'rectangle' | 'top-emerging' {
    return this.preferences.getPreference('overlayStyle');
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
    // Emit stack changed event
    this.emit('stackChanged', 0);
  }

  /**
   * Add an item to the current stack (e.g., screenshot).
   */
  addToStack(itemId: number): void {
    if (!this.currentStack.includes(itemId)) {
      this.currentStack.push(itemId);
      // Emit stack changed event
      this.emit('stackChanged', this.currentStack.length);
    }
  }

  /**
   * Paste all items in the current stack.
   * Combines text items and images for multimodal paste.
   */
  async pasteStack(): Promise<void> {
    if (!this.clipboardManager || this.currentStack.length === 0) {
      return;
    }

    const items = this.currentStack
      .map(id => this.clipboardManager!.getItem(id))
      .filter(item => item !== null) as any[];

    if (items.length === 0) {
      return;
    }

    // Separate text and images
    const textItems = items.filter(item => item.type === 'text' || item.type === 'transcript');
    const imageItems = items.filter(item => item.type === 'image' || item.type === 'screenshot');

    // Combine text items
    if (textItems.length > 0) {
      const combinedText = textItems
        .map(item => item.content)
        .filter(Boolean)
        .join('\n\n');
      
      clipboard.writeText(combinedText);
      await this.pasteText();
    }

    // For images, we'd need to handle multimodal paste differently
    // For now, just paste the text. Images can be pasted individually from clipboard history.
    
    // Clear stack after paste
    this.clearStack();
  }

  /**
   * Separate a transcript into tasks and observations using LLM.
   * This bridges from workhorse to structured data.
   */
  async separateIntoTasks(transcriptId: number): Promise<void> {
    if (!this.clipboardManager) {
      throw new Error('ClipboardManager not available');
    }

    const item = this.clipboardManager.getItem(transcriptId);
    if (!item || !item.content) {
      throw new Error('Transcript not found or has no content');
    }

    // Import processTranscription from services/llm.ts
    // Note: This requires the main process to have access to environment variables
    // and Supabase client. For now, we'll emit an event that the renderer can handle.
    this.emit('separateIntoTasks', {
      transcriptId,
      text: item.content,
    });
  }

  /**
   * Cleanup resources.
   */
  destroy(): void {
    this.unregisterEscapeKey();
    // Only unregister transcription hotkey (not all hotkeys)
    if (this.registeredHotkey) {
      globalShortcut.unregister(this.registeredHotkey);
      this.registeredHotkey = null;
    }
    if (this.whisperProcess) {
      this.whisperProcess.kill();
      this.whisperProcess = null;
    }
    this.overlay.destroy();
  }
}

