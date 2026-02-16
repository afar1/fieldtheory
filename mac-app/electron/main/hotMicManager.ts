import { EventEmitter } from 'events';
import { app, globalShortcut } from 'electron';
import { spawn, ChildProcess } from 'child_process';
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

  // Audio level monitoring for silence detection
  private audioLevelListener: ((level: number) => void) | null = null;
  private silenceTimer: NodeJS.Timeout | null = null;
  private hasSpeechSinceLastHarvest: boolean = false;

  // Transcript buffer — accumulates chunks until submit word or silence discard
  private transcriptBuffer: string[] = [];
  private bufferDiscardTimer: NodeJS.Timeout | null = null;
  private readonly DEFAULT_BUFFER_DISCARD_MS = 15_000;

  // Local HTTP server for hook triggers
  private server: http.Server | null = null;
  private static readonly HTTP_PORT = 19847;

  // Thresholds
  private readonly SPEECH_LEVEL_THRESHOLD = 0.02;
  private readonly SILENCE_LEVEL_THRESHOLD = 0.008;
  private readonly SILENCE_DURATION_MS = 500;

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
    try {
      await this.nativeHelper.startRecording();
      this.startAudioMonitoring();
    } catch (error) {
      log.error('Hot Mic: failed to resume recording:', error);
    }
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

    this.audioLevelListener = (level: number) => {
      if (this.state !== 'recording' && this.state !== 'listening') return;

      if (level > this.SPEECH_LEVEL_THRESHOLD) {
        // Show orange dot immediately on speech detection (don't wait for transcription)
        if (!this.hasSpeechSinceLastHarvest && this.state === 'listening') {
          this.cursorStatusManager?.showHotMic();
        }
        this.hasSpeechSinceLastHarvest = true;
        this.resetBufferDiscardTimer();
        if (this.silenceTimer) {
          clearTimeout(this.silenceTimer);
          this.silenceTimer = null;
        }
      } else if (level > this.SILENCE_LEVEL_THRESHOLD) {
        if (this.silenceTimer) {
          clearTimeout(this.silenceTimer);
          this.silenceTimer = null;
        }
      } else {
        if (this.hasSpeechSinceLastHarvest && !this.silenceTimer) {
          this.silenceTimer = setTimeout(() => {
            this.silenceTimer = null;
            if (this.state === 'recording' || this.state === 'listening') {
              this.onSilenceDetected();
            }
          }, this.SILENCE_DURATION_MS);
        }
      }
    };

    this.nativeHelper.on('audioLevel', this.audioLevelListener);
  }

  private stopAudioMonitoring(): void {
    if (this.audioLevelListener) {
      this.nativeHelper.removeListener('audioLevel', this.audioLevelListener);
      this.audioLevelListener = null;
    }
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
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
        if (this.state === 'listening' && this.transcriptBuffer.length > 0) {
          log.info('Hot Mic: silence timeout, discarding buffer (%d chunks)', this.transcriptBuffer.length);
          this.transcriptBuffer = [];
          this.updateOrangeDot();
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
  // Silence → harvest chunk
  // ---------------------------------------------------------------------------

  private async onSilenceDetected(): Promise<void> {
    log.info('Hot Mic: silence detected, harvesting chunk');
    this.hasSpeechSinceLastHarvest = false;
    this.stopAudioMonitoring();

    try {
      const wavPath = await this.nativeHelper.stopRecording();

      // Immediately restart recording (minimal gap)
      if (this.isActive) {
        try {
          await this.nativeHelper.startRecording();
          this.startAudioMonitoring();
        } catch (error) {
          log.error('Hot Mic: failed to restart recording:', error);
          this.deactivate();
          return;
        }
      }

      const transcript = await this.transcribe(wavPath);

      // Clean up WAV file
      try {
        const fsPromises = await import('fs/promises');
        await fsPromises.unlink(wavPath);
      } catch { /* ignore */ }

      if (!this.isActive) return;

      if (this.isHallucination(transcript)) {
        log.info('Hot Mic: skipping hallucinated/empty chunk');
        return;
      }

      if (this.state === 'listening') {
        this.processListeningChunk(transcript);
      } else if (this.state === 'recording') {
        // Legacy direct-paste mode
        this.processTranscriptDirectPaste(transcript);
      }
    } catch (error) {
      log.error('Hot Mic chunk error:', error);
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

    // Check for submit word
    const submitWord = this.getSubmitWord();
    const { shouldSubmit, cleanedText } = this.checkSubmitWord(transcript, submitWord);

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

  private getSubmitWord(): string {
    const pref = this.preferences.getPreference('hotMicSubmitWord');
    return (typeof pref === 'string' && pref.trim() ? pref.trim() : 'go').toLowerCase();
  }

  /**
   * Check if the transcript ends with the submit word.
   */
  private checkSubmitWord(transcript: string, submitWord: string): { shouldSubmit: boolean; cleanedText: string } {
    const trimmed = transcript.trim();
    const stripped = trimmed.replace(/[.,!?;:]+$/, '').trim();
    const words = stripped.split(/\s+/);
    const lastWord = words[words.length - 1]?.toLowerCase();

    if (lastWord === submitWord) {
      words.pop();
      return { shouldSubmit: true, cleanedText: words.join(' ') };
    }

    return { shouldSubmit: false, cleanedText: trimmed };
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
   * e.g. "use the review command" → inserts [cmd:review.md] inline.
   */
  private applyCommandDetection(text: string): string {
    if (!this.commandsManager) return text;
    const detection = this.commandsManager.detectCommands(text);
    if (detection.detected) {
      log.info('Hot Mic: detected commands: %s', detection.commandNames.join(', '));
      return this.commandsManager.insertCommandReferences(
        detection.textWithoutCommandRefs,
        detection.matchedCommands,
      );
    }
    return text;
  }

  // ---------------------------------------------------------------------------
  // Orange dot — shows when buffer has content
  // ---------------------------------------------------------------------------

  private updateOrangeDot(): void {
    if (!this.cursorStatusManager) return;

    if (this.state === 'listening' && this.transcriptBuffer.length > 0) {
      this.cursorStatusManager.showHotMic();
    } else if (this.state === 'recording') {
      this.cursorStatusManager.showHotMic();
    } else {
      this.cursorStatusManager.setState('idle');
    }
  }

  // ---------------------------------------------------------------------------
  // Legacy direct-paste mode (non-queue, recording state)
  // ---------------------------------------------------------------------------

  private async processTranscriptDirectPaste(transcript: string): Promise<void> {
    const trimmed = transcript.trim();
    const stripped = trimmed.replace(/[.,!?;:]+$/, '').trim();
    const lower = stripped.toLowerCase();

    const { shouldSubmit, cleanedText } = this.checkSubmitWord(transcript, this.getSubmitWord());

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
  // Transcription (whisper-cli)
  // ---------------------------------------------------------------------------

  private async transcribe(wavPath: string): Promise<string> {
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

    // Register/unregister Escape to exit hot mic
    if (state !== 'idle') {
      try {
        if (!globalShortcut.isRegistered('Escape')) {
          globalShortcut.register('Escape', () => {
            log.info('Hot Mic: Escape pressed, deactivating');
            this.deactivate();
          });
        }
      } catch (error) {
        log.error('Failed to register Escape shortcut:', error);
      }
    } else {
      try {
        globalShortcut.unregister('Escape');
      } catch { /* ignore */ }
    }
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  private cleanup(): void {
    this.stopAudioMonitoring();
    this.stopBufferDiscardTimer();
    this.targetBundleId = null;
    this.transcriptBuffer = [];

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
        h.hooks?.some(hh => hh.command === HotMicManager.HOOK_COMMAND)
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
          !h.hooks?.some(hh => hh.command === HotMicManager.HOOK_COMMAND)
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
