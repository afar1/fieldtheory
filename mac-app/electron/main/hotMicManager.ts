import { EventEmitter } from 'events';
import { app } from 'electron';
import { spawn, ChildProcess, exec } from 'child_process';
import http from 'http';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { NativeHelper } from './nativeHelper';
import { PreferencesManager } from './preferences';
import { ModelManager } from './modelManager';
import { SoundManager } from './soundManager';
import { CursorStatusManager } from './cursorStatusManager';
import { CommandsManager } from './commandsManager';
import { getHotkeyManager } from './hotkeyManager';
import { createLogger } from './logger';

const log = createLogger('HotMic');

/**
 * Hot Mic states:
 * - idle: Not active
 * - armed: Activated via hook, brief delay before recording
 * - listening: Always-on mode, transcribing chunks into a buffer
 * - recording: Legacy direct-paste mode
 */
export type HotMicState = 'idle' | 'armed' | 'listening' | 'recording';

/**
 * Known terminal apps with their bundle IDs.
 */
export const KNOWN_TERMINALS: Array<{ name: string; bundleId: string }> = [
  { name: 'Ghostty', bundleId: 'com.mitchellh.ghostty' },
  { name: 'iTerm2', bundleId: 'com.googlecode.iterm2' },
  { name: 'Terminal', bundleId: 'com.apple.Terminal' },
  { name: 'Warp', bundleId: 'dev.warp.Warp-Stable' },
  { name: 'Kitty', bundleId: 'net.kovidgoyal.kitty' },
  { name: 'Alacritty', bundleId: 'org.alacritty' },
  { name: 'WezTerm', bundleId: 'com.github.wez.wezterm' },
];

/**
 * Number word → digit mapping for voice shortcuts.
 */
const NUMBER_MAP: Record<string, string> = {
  'one': '1', 'first': '1', 'option one': '1',
  'two': '2', 'second': '2', 'option two': '2',
  'three': '3', 'third': '3', 'option three': '3',
  'four': '4', 'fourth': '4', 'option four': '4',
};

/**
 * Permission word → key mapping for voice shortcuts.
 */
const PERMISSION_MAP: Record<string, string> = {
  'yes': 'y', 'allow': 'y', 'approve': 'y',
  'always': 'a', 'always allow': 'a',
  'no': 'n', 'deny': 'n',
};

/**
 * HotMicManager provides always-on voice input.
 *
 * When enabled, it continuously listens and transcribes speech into a rolling buffer.
 * The submit word (default "go") flushes the buffer and types it into the frontmost app.
 * Number/permission shortcuts auto-submit without the submit word. Portable command
 * references ("use the review command") are detected and converted to [cmd:name.md] tags.
 * Prolonged silence discards the buffer but keeps listening.
 */
export class HotMicManager extends EventEmitter {
  private nativeHelper: NativeHelper;
  private preferences: PreferencesManager;
  private modelManager: ModelManager;
  private soundManager: SoundManager;
  private cursorStatusManager: CursorStatusManager | null = null;
  private commandsManager: CommandsManager | null = null;

  private state: HotMicState = 'idle';
  private targetBundleId: string | null = null;
  private whisperProcess: ChildProcess | null = null;

  // Audio level monitoring for orange dot UI (silence detection moved to Swift)
  private audioLevelListener: ((level: number) => void) | null = null;
  private chunkReadyListener: ((filePath: string) => void) | null = null;
  private hasSpeechSinceLastHarvest: boolean = false;

  // Warmup promise — awaited before first transcription to avoid race with Qwen startup
  private warmupPromise: Promise<void> | null = null;

  // Transcript buffer — accumulates chunks until submit word or silence discard
  private transcriptBuffer: string[] = [];
  private bufferDiscardTimer: NodeJS.Timeout | null = null;
  private readonly DEFAULT_BUFFER_DISCARD_MS = 5_000;

  // Local HTTP server for hook triggers
  private server: http.Server | null = null;
  private static readonly HTTP_PORT = 19847;

  // Speech level threshold for orange dot (silence detection thresholds moved to Swift)
  private readonly SPEECH_LEVEL_THRESHOLD = 0.02;

  // Known whisper hallucination patterns (empty/silence audio)
  private readonly HALLUCINATION_PATTERNS = [
    /^\s*\[.*\]\s*$/,
    /^(thanks?|thank you)\.?\s*$/i,
    /^\s*you\s*$/i,
    /^\s*\.+\s*$/,
    /^\s*$/,
    /^\s*\(.*\)\s*$/,
  ];

  // Conflict resolution
  private transcriberStatusGetter: (() => string) | null = null;

  // External transcription function (uses user's configured engine via TranscriberManager)
  private externalTranscribe: ((wavPath: string) => Promise<string>) | null = null;
  private externalWarmup: (() => Promise<void>) | null = null;

  constructor(
    nativeHelper: NativeHelper,
    preferences: PreferencesManager,
    soundManager: SoundManager,
  ) {
    super();
    this.nativeHelper = nativeHelper;
    this.preferences = preferences;
    this.soundManager = soundManager;
    this.modelManager = new ModelManager();
    this.modelManager.setSelectedModel('small');
    this.startServer();
  }

  /**
   * Start listening immediately if Hot Mic is enabled and a target app is configured.
   * Called after user preferences are loaded (post-auth).
   */
  autoStartIfEnabled(): void {
    const enabled = this.preferences.getPreference('hotMicEnabled');
    if (!enabled) return;
    if (this.isActive) return;

    // In always-on mode, target is resolved at submit time (frontmost app)
    this.targetBundleId = this.preferences.getPreference('hotMicTargetBundleId') || null;

    log.info('Hot Mic: auto-starting (always-on mode)');
    this.startListening();
  }

  // ---------------------------------------------------------------------------
  // Hotkey — toggle Hot Mic on/off
  // ---------------------------------------------------------------------------

  /**
   * Register the Hot Mic hotkey from preferences.
   * Called after preferences are loaded (post-auth).
   */
  registerHotkey(): void {
    const hotkey = this.preferences.getPreference('hotMicHotkey');
    if (!hotkey) return;

    const hotkeyManager = getHotkeyManager();
    const result = hotkeyManager.register('hotMic', hotkey, () => {
      log.info('Hot Mic: hotkey pressed, toggling');
      if (this.isActive) {
        this.deactivate();
      } else {
        this.activate();
      }
    });

    if (!result.success) {
      log.error('Hot Mic: failed to register hotkey "%s": %s', hotkey, result.error);
    } else {
      log.info('Hot Mic: registered hotkey "%s"', hotkey);
    }
  }

  /**
   * Set a new hotkey and save to preferences.
   */
  async setHotkey(hotkey: string | null): Promise<boolean> {
    const hotkeyManager = getHotkeyManager();

    // Unregister existing
    hotkeyManager.unregister('hotMic');

    if (!hotkey) {
      await this.preferences.save({ hotMicHotkey: undefined });
      return true;
    }

    const result = hotkeyManager.register('hotMic', hotkey, () => {
      log.info('Hot Mic: hotkey pressed, toggling');
      if (this.isActive) {
        this.deactivate();
      } else {
        this.activate();
      }
    });

    if (result.success) {
      await this.preferences.save({ hotMicHotkey: hotkey });
      log.info('Hot Mic: hotkey set to "%s"', hotkey);
      return true;
    }

    log.error('Hot Mic: failed to set hotkey "%s": %s', hotkey, result.error);
    return false;
  }

  getHotkey(): string | null {
    return this.preferences.getPreference('hotMicHotkey') || null;
  }

  // ---------------------------------------------------------------------------
  // Local HTTP server for hook triggers
  // ---------------------------------------------------------------------------

  private startServer(): void {
    this.server = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');

      const url = new URL(req.url!, `http://${req.headers.host}`);

      if (req.method === 'GET' && url.pathname === '/hotmic/start') {
        const pid = url.searchParams.get('pid');
        if (pid) {
          this.enqueue(pid);
        } else {
          this.start();
        }
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true }));
      } else if (req.method === 'GET' && url.pathname === '/hotmic/stop') {
        this.stop();
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true }));
      } else {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'not found' }));
      }
    });

    this.server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        log.error('Hot Mic HTTP server port %d already in use', HotMicManager.HTTP_PORT);
      } else {
        log.error('Hot Mic HTTP server error:', err);
      }
      this.server = null;
    });

    this.server.listen(HotMicManager.HTTP_PORT, '127.0.0.1', () => {
      log.info('Hot Mic HTTP server listening on 127.0.0.1:%d', HotMicManager.HTTP_PORT);
    });
  }

  private stopServer(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  setCursorStatusManager(manager: CursorStatusManager): void {
    this.cursorStatusManager = manager;
  }

  setCommandsManager(manager: CommandsManager): void {
    this.commandsManager = manager;
  }

  setTranscriberStatusGetter(getter: () => string): void {
    this.transcriberStatusGetter = getter;
  }

  setTranscribeFunction(fn: (wavPath: string) => Promise<string>): void {
    this.externalTranscribe = fn;
  }

  setWarmupFunction(fn: () => Promise<void>): void {
    this.externalWarmup = fn;
  }

  getState(): HotMicState {
    return this.state;
  }

  get isActive(): boolean {
    return this.state !== 'idle';
  }

  getTargetBundleId(): string | null {
    return this.targetBundleId;
  }

  /**
   * Resolve which app to type into. In always-on mode, uses the frontmost app.
   * In queue mode, uses the pre-set target bundle ID.
   */
  private getTypeTarget(): string | null {
    // Use whatever app is currently focused
    const frontmost = this.nativeHelper.getFrontmostApp();
    const ftBundleIds = ['com.fieldtheory.app', 'com.fieldtheory.experimental'];
    if (frontmost?.bundleId && !ftBundleIds.includes(frontmost.bundleId)) {
      log.info('Hot Mic: typing into frontmost app: %s (%s)', frontmost.name, frontmost.bundleId);
      return frontmost.bundleId;
    }

    // Fall back to configured target
    log.info('Hot Mic: falling back to configured target: %s', this.targetBundleId);
    return this.targetBundleId;
  }

  // ---------------------------------------------------------------------------
  // Yield to regular transcriber — release recording so manual record works
  // ---------------------------------------------------------------------------

  /**
   * Temporarily yield the audio device so the regular transcriber can record.
   * Called when the user presses the record hotkey while Hot Mic is listening.
   * Hot Mic will resume when the transcriber finishes.
   */
  async yieldToTranscriber(): Promise<void> {
    if (this.state !== 'listening' && this.state !== 'recording') return;
    log.info('Hot Mic: yielding to regular transcriber');

    this.stopAudioMonitoring();
    this.stopBufferDiscardTimer();
    await this.nativeHelper.cancelRecording().catch(() => {});

    // Give the native helper time to fully release the audio device
    await new Promise(resolve => setTimeout(resolve, 200));

    // Don't change state to idle — keep as listening so we know to resume
    // The transcriber status getter will prevent us from restarting until it's done
  }

  /**
   * Resume listening after the regular transcriber finishes.
   */
  async resumeAfterTranscriber(): Promise<void> {
    if (this.state !== 'listening') return;

    // Verify the transcriber is actually done
    if (this.transcriberStatusGetter && this.transcriberStatusGetter() !== 'idle') {
      return;
    }

    log.info('Hot Mic: resuming after transcriber finished');

    // Retry with backoff — the audio device may not be immediately available
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (attempt > 0) {
          await new Promise(resolve => setTimeout(resolve, 300 * attempt));
          log.info('Hot Mic: resume attempt %d', attempt + 1);
        }
        await this.nativeHelper.startRecording();
        this.startAudioMonitoring();
        return;
      } catch (error) {
        log.error('Hot Mic: failed to resume recording (attempt %d):', attempt + 1, error);
      }
    }
    log.error('Hot Mic: giving up on resume after 3 attempts');
  }

  // ---------------------------------------------------------------------------
  // Hook trigger enqueue — starts listening if not already active
  // ---------------------------------------------------------------------------

  private enqueue(pid: string): void {
    const enabled = this.preferences.getPreference('hotMicEnabled');
    if (!enabled) return;

    log.info('Hot Mic: hook trigger from PID %s', pid);

    // If already listening, nothing to do — user navigates on their own
    if (this.state === 'listening') return;

    // Start listening (always-on mode)
    this.targetBundleId = this.preferences.getPreference('hotMicTargetBundleId') || null;
    this.startListening();
  }

  /**
   * Enter the listening state — immediately start recording and transcribing
   * into the buffer. No wake word needed.
   */
  private async startListening(): Promise<void> {
    this.transcriptBuffer = [];
    this.setState('listening');

    // Warm up transcription engine in parallel with recording start.
    // Store the promise so onChunkReady can await it before the first transcription,
    // preventing a race where a chunk arrives before the server is ready.
    this.warmupPromise = this.externalWarmup?.() ?? null;
    this.warmupPromise?.catch((err) => {
      log.error('Hot Mic: warmup failed:', err);
    });

    try {
      await this.nativeHelper.startRecording();
    } catch (error) {
      log.error('Hot Mic: failed to start recording in listening:', error);
      this.setState('idle');
      return;
    }

    this.startAudioMonitoring();
  }

  // ---------------------------------------------------------------------------
  // Activation / Deactivation
  // ---------------------------------------------------------------------------

  activate(): void {
    if (this.isActive) {
      this.deactivate();
      return;
    }

    if (this.transcriberStatusGetter && this.transcriberStatusGetter() !== 'idle') {
      log.info('Cannot activate Hot Mic — transcription in progress');
      return;
    }

    const frontmost = this.nativeHelper.getFrontmostApp();
    const ftBundleIds = ['com.fieldtheory.app', 'com.fieldtheory.experimental'];
    if (frontmost?.bundleId && !ftBundleIds.includes(frontmost.bundleId)) {
      this.targetBundleId = frontmost.bundleId;
    } else {
      this.targetBundleId = this.preferences.getPreference('hotMicTargetBundleId') || null;
    }

    if (!this.targetBundleId) {
      log.error('No target app for Hot Mic');
      this.cursorStatusManager?.showCriticalMessage('Hot Mic: No target app');
      return;
    }

    log.info('Hot Mic activated, target: %s', this.targetBundleId);
    this.playSound('recordingStart');
    this.emit('activated', this.targetBundleId);

    // Go straight into listening (buffer mode) — no queue needed
    this.startListening();
  }

  deactivate(): void {
    log.info('Hot Mic deactivated');
    this.cleanup();
    this.setState('idle');
    this.playSound('recordingStop');
    this.emit('deactivated');
  }

  // ---------------------------------------------------------------------------
  // Hook trigger — called when Claude Code becomes idle (legacy non-queue path)
  // ---------------------------------------------------------------------------

  start(): void {
    if (this.state === 'idle') {
      const enabled = this.preferences.getPreference('hotMicEnabled');
      if (!enabled) return;

      this.targetBundleId = this.preferences.getPreference('hotMicTargetBundleId') || null;
      if (!this.targetBundleId) return;

      this.setState('armed');
      this.playSound('recordingStart');

      setTimeout(() => {
        if (this.state === 'armed') {
          this.startRecordingLoop();
        }
      }, 300);
      return;
    }

    if (this.state !== 'armed') return;
    this.startRecordingLoop();
  }

  stop(): void {
    this.deactivate();
  }

  // ---------------------------------------------------------------------------
  // Hotkey interactions during Hot Mic
  // ---------------------------------------------------------------------------

  async handleShortPress(): Promise<void> {
    if (this.isActive) {
      log.info('Hot Mic force-submit via short press');
      this.deactivate();
    }
  }

  handleLongPress(): void {
    this.deactivate();
  }

  // ---------------------------------------------------------------------------
  // Recording cycle — silence-based chunking
  // ---------------------------------------------------------------------------

  private async startRecordingLoop(): Promise<void> {
    if (this.transcriberStatusGetter && this.transcriberStatusGetter() !== 'idle') {
      log.info('Hot Mic paused — regular transcription active');
      return;
    }

    if (!this.isActive) return;

    this.setState('recording');

    try {
      await this.nativeHelper.startRecording();
    } catch (error) {
      log.error('Failed to start recording for Hot Mic:', error);
      this.deactivate();
      return;
    }

    this.startAudioMonitoring();
  }

  private startAudioMonitoring(): void {
    this.stopAudioMonitoring();

    // Audio level listener — only for orange dot UI (silence detection is in Swift)
    this.audioLevelListener = (level: number) => {
      if (this.state !== 'recording' && this.state !== 'listening') return;

      if (level > this.SPEECH_LEVEL_THRESHOLD) {
        // Show orange dot immediately on speech detection (don't wait for transcription)
        if (!this.hasSpeechSinceLastHarvest && this.state === 'listening') {
          log.info(`Hot Mic: [dot] preemptive show (speech detected, level=${level.toFixed(3)})`);
          this.cursorStatusManager?.showHotMic();
        }
        this.hasSpeechSinceLastHarvest = true;
        this.resetBufferDiscardTimer();
      }
    };

    // Chunk ready listener — Swift detected silence and auto-snapshotted
    this.chunkReadyListener = (filePath: string) => {
      if (this.state !== 'recording' && this.state !== 'listening') return;
      this.onChunkReady(filePath);
    };

    this.nativeHelper.on('audioLevel', this.audioLevelListener);
    this.nativeHelper.on('recordingChunkReady', this.chunkReadyListener);
  }

  private stopAudioMonitoring(): void {
    if (this.audioLevelListener) {
      this.nativeHelper.removeListener('audioLevel', this.audioLevelListener);
      this.audioLevelListener = null;
    }
    if (this.chunkReadyListener) {
      this.nativeHelper.removeListener('recordingChunkReady', this.chunkReadyListener);
      this.chunkReadyListener = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Buffer discard timer — prolonged silence clears buffer, keeps listening
  // ---------------------------------------------------------------------------

  private resetBufferDiscardTimer(): void {
    this.stopBufferDiscardTimer();
    if (this.state === 'listening') {
      const timeout = this.getBufferDiscardTimeout();
      this.bufferDiscardTimer = setTimeout(() => {
        this.bufferDiscardTimer = null;
        if (this.state === 'listening') {
          const hadContent = this.transcriptBuffer.length > 0;
          if (hadContent) {
            log.info('Hot Mic: silence timeout, discarding buffer (%d chunks)', this.transcriptBuffer.length);
            this.transcriptBuffer = [];
            // Fade out gracefully when discarding buffered speech
            log.info('Hot Mic: [dot] discard timer fired, fading out (had content)');
            this.cursorStatusManager?.fadeOutHotMic();
          } else {
            // No buffer content — dot was shown preemptively but nothing was
            // buffered (e.g. command executed, or hallucination already handled).
            // Hide instantly since there's nothing to visually "discard".
            log.info('Hot Mic: [dot] discard timer fired, hiding (empty buffer)');
            this.updateOrangeDot();
          }
        }
      }, timeout);
    }
  }

  private stopBufferDiscardTimer(): void {
    if (this.bufferDiscardTimer) {
      clearTimeout(this.bufferDiscardTimer);
      this.bufferDiscardTimer = null;
    }
  }

  private getBufferDiscardTimeout(): number {
    const pref = this.preferences.getPreference('hotMicBufferDiscardMs');
    return typeof pref === 'number' && pref > 0 ? pref : this.DEFAULT_BUFFER_DISCARD_MS;
  }

  // ---------------------------------------------------------------------------
  // Chunk ready — Swift detected silence and auto-snapshotted
  // ---------------------------------------------------------------------------

  private async onChunkReady(wavPath: string): Promise<void> {
    const t0 = performance.now();
    log.info('Hot Mic: chunk ready from Swift, transcribing');
    this.hasSpeechSinceLastHarvest = false;

    try {
      // Wait for warmup to complete before first transcription — prevents race
      // where a chunk arrives before the Qwen server finishes loading
      if (this.warmupPromise) {
        await this.warmupPromise;
        this.warmupPromise = null;
      }

      // Transcribe the completed chunk — audio monitoring stays active
      const transcript = (await this.transcribe(wavPath)).replace(/\([^)]*\)/g, '').trim();
      const tPost = performance.now();
      log.info('Hot Mic: [timing] transcribe: %dms', Math.round(tPost - t0));

      // Clean up WAV file
      try {
        const fsPromises = await import('fs/promises');
        await fsPromises.unlink(wavPath);
      } catch { /* ignore */ }

      if (!this.isActive) return;

      if (this.isHallucination(transcript)) {
        log.info('Hot Mic: skipping hallucinated/empty chunk');
        // Sync orange dot with buffer state — the dot may have been shown
        // preemptively on speech detection, but if the chunk was a hallucination
        // and the buffer is still empty, the dot needs to be hidden.
        this.updateOrangeDot();
        // Tell Swift to stay in current mode
        this.nativeHelper.setHarvestMode(this.transcriptBuffer.length === 0 ? 'command' : 'dictation');
        return;
      }

      if (this.state === 'listening') {
        await this.processListeningChunk(transcript);
      } else if (this.state === 'recording') {
        // Legacy direct-paste mode
        this.processTranscriptDirectPaste(transcript);
      }

      // After processing, always sync the orange dot — covers commands,
      // submit/paste, and normal buffering in a single place
      this.updateOrangeDot();

      // After processing, tell Swift which silence duration to use next
      this.nativeHelper.setHarvestMode(this.transcriptBuffer.length === 0 ? 'command' : 'dictation');
    } catch (error) {
      log.error('Hot Mic chunk error:', error);
      // Sync orange dot — a failed transcription should not leave the dot lingering
      this.updateOrangeDot();
    }
  }

  // ---------------------------------------------------------------------------
  // Buffer model — listening state processing
  // ---------------------------------------------------------------------------

  /**
   * Process a transcribed chunk in listening state.
   * Adds to buffer, checks for submit word and shortcut commands.
   */
  private async processListeningChunk(transcript: string): Promise<void> {
    const trimmed = transcript.trim();
    const stripped = trimmed.replace(/[.,!?;:]+$/, '').trim();
    const lower = stripped.toLowerCase();

    // Navigation command: cycle to the next window of the same app (Cmd+`)
    if (this.transcriptBuffer.length === 0 && this.isSwitchWord(lower)) {
      log.info('Hot Mic: switch command "%s" — cycling window (Cmd+`)', lower);
      exec('osascript -e \'tell application "System Events" to keystroke "`" using command down\'');
      return;
    }

    // Navigation command: cycle to the previous window (Cmd+Shift+`)
    if (this.transcriptBuffer.length === 0 && this.isPrevWindowWord(lower)) {
      log.info('Hot Mic: prev window command "%s" — cycling window back (Cmd+Shift+`)', lower);
      exec('osascript -e \'tell application "System Events" to keystroke "`" using {command down, shift down}\'');
      return;
    }

    // New window command: open a new terminal window (Cmd+N)
    if (this.transcriptBuffer.length === 0 && this.isNewWindowPhrase(lower)) {
      log.info('Hot Mic: new window command "%s" — sending Cmd+N', lower);
      exec('osascript -e \'tell application "System Events" to keystroke "n" using command down\'');
      return;
    }

    // Close window command: close the current window (Cmd+W)
    if (this.transcriptBuffer.length === 0 && this.isCloseWindowPhrase(lower)) {
      log.info('Hot Mic: close window command "%s" — sending Cmd+W', lower);
      exec('osascript -e \'tell application "System Events" to keystroke "w" using command down\'');
      return;
    }

    // Start Claude: type "claude" and submit
    const startClaude = lower.replace(/[.,!?;:]+/g, '').replace(/\s+/g, ' ').trim();
    if (this.transcriptBuffer.length === 0 && this.isRunClaudePhrase(startClaude)) {
      const target = this.getTypeTarget();
      if (target) {
        log.info('Hot Mic: start claude command — typing "claude" and submitting');
        const result = await this.nativeHelper.typeIntoApp(target, 'claude', true);
        if (result.success) this.playSound('paste');
      }
      return;
    }

    // Restart server: Ctrl+C then type the configured command
    if (this.transcriptBuffer.length === 0 && this.isRestartServerPhrase(startClaude)) {
      const command = this.preferences.getPreference('hotMicRestartServerCommand');
      const cmd = typeof command === 'string' && command.trim() ? command.trim() : '';
      if (cmd) {
        const target = this.getTypeTarget();
        if (target) {
          log.info('Hot Mic: restart server command — Ctrl+C then "%s"', cmd);
          exec('osascript -e \'tell application "System Events" to keystroke "c" using control down\'');
          // Wait for the process to terminate before typing the new command
          await new Promise(resolve => setTimeout(resolve, 1500));
          const result = await this.nativeHelper.typeIntoApp(target, cmd, true);
          if (result.success) this.playSound('paste');
        }
      } else {
        log.info('Hot Mic: restart server command — no command configured, ignoring');
      }
      return;
    }

    // Cancel command: send Ctrl+C to the terminal
    if (this.transcriptBuffer.length === 0 && this.isCancelPhrase(lower)) {
      log.info('Hot Mic: cancel command "%s" — sending Ctrl+C', lower);
      exec('osascript -e \'tell application "System Events" to keystroke "c" using control down\'');
      return;
    }

    // Focus command: move to next display, then center (compound Rectangle action)
    if (this.transcriptBuffer.length === 0 && this.isFocusPhrase(lower)) {
      log.info('Hot Mic: focus command "%s" — next-display then center', lower);
      exec('open "rectangle://execute-action?name=next-display"');
      setTimeout(() => {
        exec('open "rectangle://execute-action?name=center"');
      }, 300);
      return;
    }

    // Cascade command: cascade current app's windows, then center (compound Rectangle action)
    if (this.transcriptBuffer.length === 0 && this.isCascadePhrase(lower)) {
      log.info('Hot Mic: cascade command "%s" — cascade-active-app then center', lower);
      exec('open "rectangle://execute-action?name=cascade-active-app"');
      setTimeout(() => {
        exec('open "rectangle://execute-action?name=center"');
      }, 300);
      return;
    }

    // Rectangle window management commands
    if (this.transcriptBuffer.length === 0) {
      const rectAction = this.isRectangleCommand(lower);
      if (rectAction) {
        log.info('Hot Mic: rectangle command "%s" — triggering %s', lower, rectAction);
        exec(`open "rectangle://execute-action?name=${rectAction}"`);
        return;
      }
    }

    // Auto-submit: if buffer is empty and chunk is a bare number/permission word,
    // submit immediately without needing the submit word
    if (this.transcriptBuffer.length === 0) {
      const mappedNumber = NUMBER_MAP[lower];
      const mappedPermission = PERMISSION_MAP[lower];
      if (mappedNumber || mappedPermission) {
        const mapped = mappedNumber || mappedPermission;
        const target = this.getTypeTarget();
        if (target) {
          log.info('Hot Mic: auto-submitting shortcut "%s" → "%s"', lower, mapped);
          const result = await this.nativeHelper.typeIntoApp(target, mapped, true);
          if (result.success) {
            this.playSound('paste');
          }
        }
        return;
      }
    }

    // Check for paste word (flush buffer without submitting)
    const { shouldPaste, cleanedText: pasteCleanedText } = this.checkPastePhrases(transcript);

    if (shouldPaste) {
      if (pasteCleanedText.trim()) {
        this.transcriptBuffer.push(pasteCleanedText.trim());
      }

      const fullText = this.transcriptBuffer.join(' ');
      this.transcriptBuffer = [];
      this.updateOrangeDot();

      const target = this.getTypeTarget();
      if (fullText && target) {
        let mappedText = this.applyMappings(fullText);
        mappedText = this.applyCommandDetection(mappedText);
        log.info('Hot Mic: pasting buffer (%d chars, no submit) to %s: "%s"', mappedText.length, target, mappedText);
        const result = await this.nativeHelper.typeIntoApp(target, mappedText, false);
        if (!result.success) {
          log.error('Hot Mic: typeIntoApp failed:', result.error);
        } else {
          this.playSound('paste');
        }
      }

      this.resetBufferDiscardTimer();
      return;
    }

    // Check for submit word
    const { shouldSubmit, cleanedText } = this.checkSubmitPhrases(transcript);

    if (shouldSubmit) {
      // Add any remaining text before the submit word to buffer
      if (cleanedText.trim()) {
        this.transcriptBuffer.push(cleanedText.trim());
      }

      // Flush the entire buffer
      const fullText = this.transcriptBuffer.join(' ');
      this.transcriptBuffer = [];
      this.updateOrangeDot();

      const target = this.getTypeTarget();
      if (fullText && target) {
        let mappedText = this.applyMappings(fullText);
        mappedText = this.applyCommandDetection(mappedText);
        log.info('Hot Mic: submitting buffer (%d chars) to %s: "%s"', mappedText.length, target, mappedText);
        const result = await this.nativeHelper.typeIntoApp(target, mappedText, true);
        if (!result.success) {
          log.error('Hot Mic: typeIntoApp failed:', result.error);
        } else {
          this.playSound('paste');
        }
      } else if (target) {
        // Submit word alone — just hit Enter
        await this.nativeHelper.typeIntoApp(target, '', true);
      }

      // Keep listening — user navigates on their own
      this.resetBufferDiscardTimer();
      return;
    }

    // No submit word — add to buffer
    this.transcriptBuffer.push(trimmed);
    log.info('Hot Mic: buffered chunk (%d total): "%s"', this.transcriptBuffer.length, trimmed);
    this.updateOrangeDot();
    this.resetBufferDiscardTimer();
  }

  private static readonly DEFAULT_SUBMIT_PHRASES = 'over, go ahead, send it, submit, do it';
  private static readonly DEFAULT_PASTE_PHRASES = 'paste, paste it, transcribe';
  private static readonly DEFAULT_CANCEL_PHRASES = 'cancel, stop, abort';
  private static readonly DEFAULT_NEW_WINDOW_PHRASES = 'new window';
  private static readonly DEFAULT_CLOSE_WINDOW_PHRASES = 'close window, close the window, close this window';
  private static readonly DEFAULT_SWITCH_WORDS = 'next, switch';
  private static readonly DEFAULT_PREV_WINDOW_WORDS = 'back, previous';
  private static readonly DEFAULT_RUN_CLAUDE_PHRASES = 'start claude, start cloud, run claude';
  private static readonly DEFAULT_RESTART_SERVER_PHRASES = 'restart server, restart dev, restart dev server';
  private static readonly DEFAULT_FOCUS_PHRASES = 'focus';
  private static readonly DEFAULT_CASCADE_PHRASES = 'cascade, spread out';
  static readonly DEFAULT_RECTANGLE_COMMANDS: Record<string, string> = {
    'tile-all': 'grid, tile, tile all',
    'cascade-active-app': '',
    'center': 'center',
    'maximize': 'maximize, full screen',
    'restore': 'restore, undo',
    'left-half': 'left, snap left',
    'right-half': 'right, snap right',
    'larger': 'bigger, larger',
    'smaller': 'smaller, shrink',
    'next-display': 'other screen, next screen',
  };

  private getSubmitPhrases(): string[][] {
    const pref = this.preferences.getPreference('hotMicSubmitWord');
    const raw = typeof pref === 'string' && pref.trim() ? pref : HotMicManager.DEFAULT_SUBMIT_PHRASES;
    return raw
      .split(',')
      .map(p => p.trim().toLowerCase())
      .filter(p => p.length > 0)
      .map(p => p.split(/\s+/));
  }

  /**
   * Check if the transcript ends with any of the submit phrases.
   * Longer phrases are checked first to avoid partial matches.
   */
  private checkSubmitPhrases(transcript: string): { shouldSubmit: boolean; cleanedText: string } {
    const trimmed = transcript.trim();
    const stripped = trimmed.replace(/[.,!?;:]+$/, '').trim();
    const words = stripped.split(/\s+/);
    const phrases = this.getSubmitPhrases().sort((a, b) => b.length - a.length);

    for (const phraseWords of phrases) {
      const phraseLen = phraseWords.length;
      if (words.length >= phraseLen) {
        const tail = words.slice(-phraseLen).map(w => w.toLowerCase());
        if (tail.every((w, i) => w === phraseWords[i])) {
          const remaining = words.slice(0, -phraseLen);
          return { shouldSubmit: true, cleanedText: remaining.join(' ') };
        }
      }
    }

    return { shouldSubmit: false, cleanedText: trimmed };
  }

  private getPastePhrases(): string[][] {
    const pref = this.preferences.getPreference('hotMicPasteWords');
    const raw = typeof pref === 'string' && pref.trim() ? pref : HotMicManager.DEFAULT_PASTE_PHRASES;
    return raw
      .split(',')
      .map(p => p.trim().toLowerCase())
      .filter(p => p.length > 0)
      .map(p => p.split(/\s+/));
  }

  private checkPastePhrases(transcript: string): { shouldPaste: boolean; cleanedText: string } {
    const trimmed = transcript.trim();
    const stripped = trimmed.replace(/[.,!?;:]+$/, '').trim();
    const words = stripped.split(/\s+/);
    const phrases = this.getPastePhrases().sort((a, b) => b.length - a.length);

    for (const phraseWords of phrases) {
      const phraseLen = phraseWords.length;
      if (words.length >= phraseLen) {
        const tail = words.slice(-phraseLen).map(w => w.toLowerCase());
        if (tail.every((w, i) => w === phraseWords[i])) {
          const remaining = words.slice(0, -phraseLen);
          return { shouldPaste: true, cleanedText: remaining.join(' ') };
        }
      }
    }

    return { shouldPaste: false, cleanedText: trimmed };
  }

  /**
   * Check if a word is a configured switch/navigation word.
   */
  private isSwitchWord(word: string): boolean {
    const pref = this.preferences.getPreference('hotMicSwitchWords');
    const raw = typeof pref === 'string' && pref.trim() ? pref : HotMicManager.DEFAULT_SWITCH_WORDS;
    const words = raw.split(',').map(w => w.trim().toLowerCase()).filter(w => w.length > 0);
    return words.includes(word);
  }

  /**
   * Check if a word/phrase is a configured cancel phrase.
   */
  private isCancelPhrase(word: string): boolean {
    const pref = this.preferences.getPreference('hotMicCancelWords');
    const raw = typeof pref === 'string' && pref.trim() ? pref : HotMicManager.DEFAULT_CANCEL_PHRASES;
    const phrases = raw.split(',').map(w => w.trim().toLowerCase()).filter(w => w.length > 0);
    return phrases.includes(word);
  }

  private isPrevWindowWord(word: string): boolean {
    const pref = this.preferences.getPreference('hotMicPrevWindowWords');
    const raw = typeof pref === 'string' && pref.trim() ? pref : HotMicManager.DEFAULT_PREV_WINDOW_WORDS;
    const words = raw.split(',').map(w => w.trim().toLowerCase()).filter(w => w.length > 0);
    return words.includes(word);
  }

  private isNewWindowPhrase(word: string): boolean {
    const pref = this.preferences.getPreference('hotMicNewWindowWords');
    const raw = typeof pref === 'string' && pref.trim() ? pref : HotMicManager.DEFAULT_NEW_WINDOW_PHRASES;
    const phrases = raw.split(',').map(w => w.trim().toLowerCase()).filter(w => w.length > 0);
    return phrases.includes(word);
  }

  private isCloseWindowPhrase(word: string): boolean {
    const pref = this.preferences.getPreference('hotMicCloseWindowWords');
    const raw = typeof pref === 'string' && pref.trim() ? pref : HotMicManager.DEFAULT_CLOSE_WINDOW_PHRASES;
    const phrases = raw.split(',').map(w => w.trim().toLowerCase()).filter(w => w.length > 0);
    return phrases.includes(word);
  }

  private isRunClaudePhrase(word: string): boolean {
    const pref = this.preferences.getPreference('hotMicRunClaudeWords');
    const raw = typeof pref === 'string' && pref.trim() ? pref : HotMicManager.DEFAULT_RUN_CLAUDE_PHRASES;
    const phrases = raw.split(',').map(w => w.trim().toLowerCase()).filter(w => w.length > 0);
    return phrases.includes(word);
  }

  private isRestartServerPhrase(word: string): boolean {
    const pref = this.preferences.getPreference('hotMicRestartServerWords');
    const raw = typeof pref === 'string' && pref.trim() ? pref : HotMicManager.DEFAULT_RESTART_SERVER_PHRASES;
    const phrases = raw.split(',').map(w => w.trim().toLowerCase()).filter(w => w.length > 0);
    return phrases.includes(word);
  }

  private isFocusPhrase(word: string): boolean {
    const pref = this.preferences.getPreference('hotMicFocusPhrases');
    const raw = typeof pref === 'string' && pref.trim() ? pref : HotMicManager.DEFAULT_FOCUS_PHRASES;
    const phrases = raw.split(',').map(w => w.trim().toLowerCase()).filter(w => w.length > 0);
    return phrases.includes(word);
  }

  private isCascadePhrase(word: string): boolean {
    const pref = this.preferences.getPreference('hotMicCascadePhrases');
    const raw = typeof pref === 'string' && pref.trim() ? pref : HotMicManager.DEFAULT_CASCADE_PHRASES;
    const phrases = raw.split(',').map(w => w.trim().toLowerCase()).filter(w => w.length > 0);
    return phrases.includes(word);
  }

  getRectangleCommands(): Record<string, string> {
    const pref = this.preferences.getPreference('hotMicRectangleCommands');
    return pref && typeof pref === 'object' ? pref : { ...HotMicManager.DEFAULT_RECTANGLE_COMMANDS };
  }

  /**
   * Check if a phrase matches any configured Rectangle command.
   * Returns the Rectangle action name or null.
   */
  private isRectangleCommand(phrase: string): string | null {
    const commands = this.getRectangleCommands();
    for (const [action, phrasesStr] of Object.entries(commands)) {
      const phrases = phrasesStr.split(',').map(p => p.trim().toLowerCase()).filter(p => p.length > 0);
      if (phrases.includes(phrase)) return action;
    }
    return null;
  }

  /**
   * Apply number/permission mappings if the text is a single mapped word.
   */
  private applyMappings(text: string): string {
    const lower = text.trim().replace(/[.,!?;:]+$/, '').trim().toLowerCase();
    const mappedNumber = NUMBER_MAP[lower];
    if (mappedNumber) return mappedNumber;
    const mappedPermission = PERMISSION_MAP[lower];
    if (mappedPermission) return mappedPermission;
    return text;
  }

  /**
   * Detect portable command references in text.
   * e.g. "use the review command" → strips trigger phrase, appends
   * [run this command: review.md]\n/path/to/review.md
   */
  private applyCommandDetection(text: string): string {
    if (!this.commandsManager) return text;
    const detection = this.commandsManager.detectCommands(text);
    if (!detection.detected) return text;

    log.info('Hot Mic: detected commands: %s', detection.commandNames.join(', '));

    // Strip [cmd:name.md] refs from the text (they were inserted inline by detectCommands)
    let cleaned = detection.textWithoutCommandRefs
      .replace(/\s*\[cmd:[^\]]+\]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    // Append command references in the terminal-friendly format
    for (const cmd of detection.matchedCommands) {
      const ref = `\n[run this command: ${cmd.name}.md]\n${cmd.filePath}`;
      cleaned += ref;
    }

    return cleaned;
  }

  // ---------------------------------------------------------------------------
  // Orange dot — shows when buffer has content
  // ---------------------------------------------------------------------------

  private getBufferWordCount(): number {
    return this.transcriptBuffer.join(' ').split(/\s+/).filter(w => w.length > 0).length;
  }

  private updateOrangeDot(): void {
    if (!this.cursorStatusManager) return;

    if ((this.state === 'listening' && this.transcriptBuffer.length > 0) || this.state === 'recording') {
      log.info('Hot Mic: [dot] show (state=%s, buffer=%d)', this.state, this.transcriptBuffer.length);
      this.cursorStatusManager.showHotMic();
      const showCount = this.preferences.getPreference('hotMicShowWordCount') === true;
      this.cursorStatusManager.setHotMicWordCount(showCount ? this.getBufferWordCount() : 0);
    } else {
      log.info('Hot Mic: [dot] hide (state=%s, buffer=%d)', this.state, this.transcriptBuffer.length);
      this.cursorStatusManager.setHotMicWordCount(0);
      this.cursorStatusManager.hideHotMic();
    }
  }

  // ---------------------------------------------------------------------------
  // Legacy direct-paste mode (non-queue, recording state)
  // ---------------------------------------------------------------------------

  private async processTranscriptDirectPaste(transcript: string): Promise<void> {
    const trimmed = transcript.trim();
    const stripped = trimmed.replace(/[.,!?;:]+$/, '').trim();
    const lower = stripped.toLowerCase();

    const { shouldSubmit, cleanedText } = this.checkSubmitPhrases(transcript);

    let textToInject = cleanedText.trim();
    if (!shouldSubmit) {
      const mappedNumber = NUMBER_MAP[lower];
      const mappedPermission = PERMISSION_MAP[lower];
      if (mappedNumber) {
        textToInject = mappedNumber;
      } else if (mappedPermission) {
        textToInject = mappedPermission;
      }
    }

    const target = this.getTypeTarget();
    if (textToInject && target) {
      if (!shouldSubmit) {
        textToInject = textToInject + ' ';
      }
      log.info('Hot Mic: pasting chunk (%d chars, enter=%s): "%s"', textToInject.length, shouldSubmit, textToInject);
      const result = await this.nativeHelper.typeIntoApp(target, textToInject, shouldSubmit);
      if (!result.success) {
        log.error('Hot Mic: typeIntoApp failed:', result.error);
        this.cursorStatusManager?.showCriticalMessage(`Hot Mic: ${result.error || 'Injection failed'}`);
        this.deactivate();
        return;
      }
      this.playSound('paste');
    } else if (shouldSubmit && target) {
      const result = await this.nativeHelper.typeIntoApp(target, '', true);
      if (!result.success) {
        log.error('Hot Mic: typeIntoApp failed:', result.error);
      }
    }

    if (shouldSubmit) {
      this.deactivate();
    }
  }

  // ---------------------------------------------------------------------------
  // Transcription
  // ---------------------------------------------------------------------------

  private async transcribe(wavPath: string): Promise<string> {
    // Use the user's configured engine (Qwen/Whisper) via TranscriberManager when available
    if (this.externalTranscribe) {
      return this.externalTranscribe(wavPath);
    }

    // Fallback: cold-spawn whisper-cli directly
    return this.transcribeWithWhisper(wavPath);
  }

  private transcribeWithWhisper(wavPath: string): Promise<string> {
    const modelPath = this.modelManager.getModelPath();
    const whisperPath = this.getWhisperPath();

    return new Promise((resolve, reject) => {
      const args = [
        '-m', modelPath,
        '-f', wavPath,
        '--language', 'en',
        '--no-timestamps',
      ];

      this.whisperProcess = spawn(whisperPath, args, {
        env: { ...process.env, NO_COLOR: '1' },
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

        let cleaned = stdout.replace(/\u001b\[[0-9;]*m/g, '');
        cleaned = cleaned.replace(/\[(?:SPEAKER_TURN|id:\s*\d+|start:|end:)[^\]]*\]/gi, '');
        cleaned = cleaned.replace(/\[\d{2}:\d{2}:\d{2}(?:\.\d{3})?\s*-->\s*\d{2}:\d{2}:\d{2}(?:\.\d{3})?\]/g, '');

        const text = cleaned
          .trim()
          .split('\n')
          .filter(line => {
            const t = line.trim();
            if (!t) return false;
            if (t.match(/^\[.*-->\s*\]/)) return false;
            if (t.match(/^\[\d+:\d+:\d+/)) return false;
            if (t.match(/^(###|Transcription|END|BEGIN)/i)) return false;
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

  private getWhisperPath(): string {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'whisper-cli');
    } else {
      const repoRoot = path.resolve(__dirname, '../../..');
      return path.join(repoRoot, 'build-whisper', 'bin', 'whisper-cli');
    }
  }

  // ---------------------------------------------------------------------------
  // Hallucination detection
  // ---------------------------------------------------------------------------

  private isHallucination(text: string): boolean {
    if (!text || !text.trim()) return true;

    const words = text.trim().split(/\s+/);
    if (words.length < 1) return true;

    for (const pattern of this.HALLUCINATION_PATTERNS) {
      if (pattern.test(text.trim())) return true;
    }

    return false;
  }

  // ---------------------------------------------------------------------------
  // Sound playback
  // ---------------------------------------------------------------------------

  private playSound(event: 'recordingStart' | 'recordingStop' | 'paste'): void {
    const soundsEnabled = this.preferences.getPreference('hotMicSoundsEnabled') ?? true;
    if (!soundsEnabled) return;
    this.soundManager.play(event);
  }

  // ---------------------------------------------------------------------------
  // State management
  // ---------------------------------------------------------------------------

  private setState(state: HotMicState): void {
    if (this.state === state) return;
    const prev = this.state;
    this.state = state;
    log.info('Hot Mic state: %s → %s', prev, state);
    this.emit('stateChanged', state);

    this.updateOrangeDot();
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  private cleanup(): void {
    this.stopAudioMonitoring();
    this.stopBufferDiscardTimer();
    this.targetBundleId = null;
    this.transcriptBuffer = [];
    this.warmupPromise = null;

    if (this.whisperProcess) {
      this.whisperProcess.kill();
      this.whisperProcess = null;
    }

    if (this.state !== 'idle') {
      this.nativeHelper.cancelRecording().catch(() => {});
    }
  }

  // ---------------------------------------------------------------------------
  // Claude Code hook installation — Stop hook with OSC title tagging
  // ---------------------------------------------------------------------------

  private static readonly HOOK_COMMAND = 'printf \'\\033]0;claude:%s\\007\' "$$" > /dev/tty 2>/dev/null; curl -s "http://127.0.0.1:19847/hotmic/start?pid=$$" >> /tmp/hotmic-hook.log 2>&1';
  private static readonly LEGACY_NOTIFICATION_COMMAND = 'curl -s http://127.0.0.1:19847/hotmic/start >> /tmp/hotmic-hook.log 2>&1 || echo "CURL FAILED: $?" >> /tmp/hotmic-hook.log';
  private static readonly LEGACY_URL_SCHEME_COMMAND = 'open "fieldtheory://hotmic/start"';

  private getClaudeSettingsPath(): string {
    return path.join(os.homedir(), '.claude', 'settings.json');
  }

  isHookInstalled(): boolean {
    const settingsPath = this.getClaudeSettingsPath();
    try {
      if (!fs.existsSync(settingsPath)) return false;
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      const hooks = settings?.hooks;
      if (!hooks || !Array.isArray(hooks.Stop)) return false;

      type StopHookEntry = { hooks?: Array<{ type?: string; command?: string }> };
      return (hooks.Stop as StopHookEntry[]).some(h =>
        h.hooks?.some(hh =>
          hh.command === HotMicManager.HOOK_COMMAND ||
          (typeof hh.command === 'string' && hh.command.includes('127.0.0.1:19847/hotmic/'))
        )
      );
    } catch {
      return false;
    }
  }

  installHook(): { success: boolean; error?: string } {
    try {
      const settingsPath = this.getClaudeSettingsPath();

      const dir = path.dirname(settingsPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      let settings: Record<string, unknown> = {};
      if (fs.existsSync(settingsPath)) {
        try {
          settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        } catch {
          log.error('Failed to parse ~/.claude/settings.json, creating backup');
          fs.copyFileSync(settingsPath, settingsPath + '.bak');
          settings = {};
        }
      }

      if (!settings.hooks || typeof settings.hooks !== 'object') {
        settings.hooks = {};
      }
      const hooks = settings.hooks as Record<string, unknown>;

      // Remove legacy Notification entries
      if (Array.isArray(hooks.Notification)) {
        type NotifHookEntry = { matcher?: string; hooks?: Array<{ type?: string; command?: string }> };
        hooks.Notification = (hooks.Notification as NotifHookEntry[]).filter(h =>
          !(h.matcher === 'idle_prompt' && h.hooks?.some(hh =>
            hh.command === HotMicManager.LEGACY_NOTIFICATION_COMMAND ||
            hh.command === HotMicManager.LEGACY_URL_SCHEME_COMMAND
          ))
        );
        if ((hooks.Notification as unknown[]).length === 0) {
          delete hooks.Notification;
        }
      }

      // Install Stop hook
      if (!Array.isArray(hooks.Stop)) {
        hooks.Stop = [];
      }

      type StopHookEntry = { hooks?: Array<{ type?: string; command?: string }> };
      const exists = (hooks.Stop as StopHookEntry[]).some(h =>
        h.hooks?.some(hh => hh.command === HotMicManager.HOOK_COMMAND)
      );

      if (!exists) {
        (hooks.Stop as StopHookEntry[]).push({
          hooks: [{ type: 'command', command: HotMicManager.HOOK_COMMAND }],
        });
      }

      if (Object.keys(hooks).length === 0) {
        delete settings.hooks;
      }

      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      log.info('Hot Mic Stop hook installed');
      return { success: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log.error('Failed to install Hot Mic hook:', msg);
      return { success: false, error: msg };
    }
  }

  uninstallHook(): { success: boolean; error?: string } {
    try {
      const settingsPath = this.getClaudeSettingsPath();
      if (!fs.existsSync(settingsPath)) {
        return { success: true };
      }

      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      const hooks = settings?.hooks;
      if (!hooks) {
        return { success: true };
      }

      if (Array.isArray(hooks.Stop)) {
        type StopHookEntry = { hooks?: Array<{ type?: string; command?: string }> };
        hooks.Stop = (hooks.Stop as StopHookEntry[]).filter(h =>
          !h.hooks?.some(hh =>
            hh.command === HotMicManager.HOOK_COMMAND ||
            (typeof hh.command === 'string' && hh.command.includes('127.0.0.1:19847/hotmic/'))
          )
        );
        if (hooks.Stop.length === 0) {
          delete hooks.Stop;
        }
      }

      if (Array.isArray(hooks.Notification)) {
        type NotifHookEntry = { matcher?: string; hooks?: Array<{ type?: string; command?: string }> };
        hooks.Notification = (hooks.Notification as NotifHookEntry[]).filter(h =>
          !(h.matcher === 'idle_prompt' && h.hooks?.some(hh =>
            hh.command === HotMicManager.LEGACY_NOTIFICATION_COMMAND ||
            hh.command === HotMicManager.LEGACY_URL_SCHEME_COMMAND
          ))
        );
        if ((hooks.Notification as unknown[]).length === 0) {
          delete hooks.Notification;
        }
      }

      if (Object.keys(hooks).length === 0) {
        delete settings.hooks;
      }

      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      log.info('Hot Mic hook uninstalled');
      return { success: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log.error('Failed to uninstall Hot Mic hook:', msg);
      return { success: false, error: msg };
    }
  }

  destroy(): void {
    this.cleanup();
    this.stopServer();
    this.state = 'idle';
    this.removeAllListeners();
  }
}
