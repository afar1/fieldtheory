import { EventEmitter } from 'events';
import { app, globalShortcut } from 'electron';
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
import { AudioManager } from './audioManager';
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
 * Built-in voice aliases for common apps.
 * Maps canonical app name → array of spoken variants (all lowercase).
 * Speech-to-text often mangles app names, so we cover common variants.
 */
const APP_VOICE_ALIASES: Record<string, string[]> = {
  'Google Chrome': ['chrome', 'google chrome'],
  'Visual Studio Code': ['vs code', 'vscode', 'v s code', 'visual studio code', 'visual studio'],
  'Cursor': ['cursor'],
  'ChatGPT': ['chat gpt', 'chatgpt', 'chat g p t'],
  'iTerm2': ['iterm', 'i term', 'iterm2'],
  'Ghostty': ['ghostty', 'ghost tea', 'ghosty'],
  'Terminal': ['terminal'],
  'Finder': ['finder'],
  'Safari': ['safari'],
  'Firefox': ['firefox', 'fire fox'],
  'Slack': ['slack'],
  'Discord': ['discord'],
  'Spotify': ['spotify'],
  'Messages': ['messages', 'imessage', 'i message'],
  'Mail': ['mail', 'apple mail'],
  'Notes': ['notes', 'apple notes'],
  'Arc': ['arc', 'arc browser'],
  'Notion': ['notion'],
  'Obsidian': ['obsidian'],
  'Warp': ['warp'],
  'Xcode': ['xcode', 'x code'],
  'Activity Monitor': ['activity monitor'],
  'System Settings': ['system settings', 'system preferences'],
  'Preview': ['preview'],
  'Calendar': ['calendar'],
  'Reminders': ['reminders'],
  'Photos': ['photos'],
  'Music': ['music', 'apple music'],
  'Maps': ['maps', 'apple maps'],
  'Figma': ['figma'],
  'Linear': ['linear'],
  'Telegram': ['telegram'],
  'WhatsApp': ['whatsapp', 'whats app'],
  'Zoom': ['zoom'],
  'Claude': ['claude'],
};

/**
 * App names that are common English words — require "open" prefix to avoid false triggers.
 * Without the prefix, saying "notes" or "mail" in conversation would switch apps.
 */
const AMBIGUOUS_APP_NAMES = new Set([
  'notes', 'mail', 'music', 'news', 'pages', 'numbers',
  'maps', 'books', 'weather', 'stocks', 'home', 'contacts',
  'reminders', 'calendar', 'photos', 'preview', 'clips',
  'zoom', 'linear', 'slack', 'warp', 'arc',
]);

/**
 * System voice commands — maps action names to their osascript implementation
 * and default trigger phrases. Each action sends a media key or system event.
 */
type SystemCommand = {
  script: string;
  defaultPhrases: string;
  prefKey: string;
};

const SYSTEM_COMMANDS: Record<string, SystemCommand> = {
  'play-pause': {
    // Use osascript with Music (if running), else Spotify (if running), else fail silently.
    // The "is running" check prevents launching the app.
    script: `osascript -e 'if application "Music" is running then' -e 'tell application "Music" to playpause' -e 'else if application "Spotify" is running then' -e 'tell application "Spotify" to playpause' -e 'end if'`,
    defaultPhrases: 'play, pause, play pause, play music, pause music',
    prefKey: 'hotMicPlayPausePhrases',
  },
  'next-track': {
    script: `osascript -e 'if application "Music" is running then' -e 'tell application "Music" to next track' -e 'else if application "Spotify" is running then' -e 'tell application "Spotify" to next track' -e 'end if'`,
    defaultPhrases: 'next track, next song, skip, skip song',
    prefKey: 'hotMicNextTrackPhrases',
  },
  'previous-track': {
    script: `osascript -e 'if application "Music" is running then' -e 'tell application "Music" to previous track' -e 'else if application "Spotify" is running then' -e 'tell application "Spotify" to previous track' -e 'end if'`,
    defaultPhrases: 'previous track, previous song, go back a song, last song',
    prefKey: 'hotMicPrevTrackPhrases',
  },
  'volume-up': {
    script: `osascript -e 'set volume output volume ((output volume of (get volume settings)) + 10)'`,
    defaultPhrases: 'louder, volume up, turn it up',
    prefKey: 'hotMicVolumeUpPhrases',
  },
  'volume-down': {
    script: `osascript -e 'set volume output volume ((output volume of (get volume settings)) - 10)'`,
    defaultPhrases: 'softer, quieter, volume down, turn it down',
    prefKey: 'hotMicVolumeDownPhrases',
  },
  'mute': {
    script: `osascript -e 'set volume with output muted'`,
    defaultPhrases: 'mute, mute audio, silence',
    prefKey: 'hotMicMutePhrases',
  },
  'unmute': {
    script: `osascript -e 'set volume without output muted'`,
    defaultPhrases: 'unmute, unmute audio',
    prefKey: 'hotMicUnmutePhrases',
  },
  'sleep': {
    script: `osascript -e 'tell application "System Events" to sleep'`,
    defaultPhrases: 'sleep, go to sleep, sleep computer',
    prefKey: 'hotMicSleepPhrases',
  },
  'lock': {
    script: `osascript -e 'tell application "System Events" to keystroke "q" using {command down, control down}'`,
    defaultPhrases: 'lock, lock screen, lock computer',
    prefKey: 'hotMicLockPhrases',
  },
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
  private audioManager: AudioManager | null = null;

  private state: HotMicState = 'idle';
  private targetBundleId: string | null = null;
  private whisperProcess: ChildProcess | null = null;

  // Audio level monitoring for orange dot UI (silence detection moved to Swift)
  private audioLevelListener: ((level: number, isSpeech: boolean) => void) | null = null;
  private chunkReadyListener: ((filePath: string) => void) | null = null;
  private hasSpeechSinceLastHarvest: boolean = false;

  // Warmup promise — awaited before first transcription to avoid race with Qwen startup
  private warmupPromise: Promise<void> | null = null;

  // Transcript buffer — accumulates chunks until submit word or silence discard
  private transcriptBuffer: string[] = [];
  private bufferDiscardTimer: NodeJS.Timeout | null = null;
  private lastTimerResetMs: number = 0;
  private lastSpeechDetectedMs: number = 0;
  private readonly DEFAULT_BUFFER_DISCARD_MS = 4_000;

  // Escape key — reserved for future double-tap implementation

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
    /^(okay|ok|the|a|so|yeah|oh|well|right|uh|um|hmm|huh|ah|bye|hey|hi|it)\.?\s*$/i,
  ];

  // Snap-to-toggle: track whether apps are currently hidden
  private appsHidden = false;

  // Conflict resolution
  private transcriberStatusGetter: (() => string) | null = null;

  // External transcription function (uses user's configured engine via TranscriberManager)
  private externalTranscribe: ((wavPath: string) => Promise<string>) | null = null;
  private externalWarmup: (() => Promise<void>) | null = null;

  // Squares window management (voice-triggered snapping)
  private squaresManager: {
    parseVoiceCommandFromTail(text: string): { action: string; remainingText: string } | null;
    executeAction(action: string): Promise<boolean>;
  } | null = null;

  // App switching (voice-triggered app activation)
  private appSwitcher: {
    getRunningApps(): Promise<Array<{ bundleId: string; name: string }>>;
    activateApp(bundleId: string): Promise<boolean>;
  } | null = null;

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

  setAudioManager(manager: AudioManager): void {
    this.audioManager = manager;
    log.info('Hot Mic: AudioManager wired for priority mic enforcement');
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

  setSquaresManager(manager: {
    parseVoiceCommandFromTail(text: string): { action: string; remainingText: string } | null;
    executeAction(action: string): Promise<boolean>;
  }): void {
    this.squaresManager = manager;
  }

  setAppSwitcher(switcher: {
    getRunningApps(): Promise<Array<{ bundleId: string; name: string }>>;
    activateApp(bundleId: string): Promise<boolean>;
  }): void {
    this.appSwitcher = switcher;
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
      log.debug('Hot Mic: typing into frontmost app: %s (%s)', frontmost.name, frontmost.bundleId);
      return frontmost.bundleId;
    }

    // Fall back to configured target
    log.debug('Hot Mic: falling back to configured target: %s', this.targetBundleId);
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
        if (this.audioManager) {
          await this.audioManager.ensurePriorityEnforced();
        }
        this.nativeHelper.setHarvestMode('command');
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
      if (this.audioManager) {
        await this.audioManager.ensurePriorityEnforced();
      }
      this.nativeHelper.setHarvestMode('command');
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
    this.appsHidden = false;
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
      if (this.audioManager) {
        await this.audioManager.ensurePriorityEnforced();
      }
      this.nativeHelper.setHarvestMode('command');
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

    // Audio level listener — UI (orange dot) and buffer discard timer.
    // Timer resets on continued speech (throttled) and on transcription chunks.
    this.audioLevelListener = (level: number, isSpeech: boolean) => {
      if (this.state !== 'recording' && this.state !== 'listening') return;

      if (isSpeech) {
        // Show orange dot immediately on speech detection (don't wait for transcription).
        // Also start a one-shot discard timer so the dot has a guaranteed minimum
        // lifespan — hallucination chunks won't cut it short.
        if (!this.hasSpeechSinceLastHarvest && this.state === 'listening') {
          log.debug(`Hot Mic: [dot] preemptive show (speech detected, level=${level.toFixed(3)})`);
          this.cursorStatusManager?.showHotMic();
        }
        this.hasSpeechSinceLastHarvest = true;
        this.lastSpeechDetectedMs = Date.now();

        // Keep resetting the discard timer while speech is detected (throttled to 1/s).
        const now = this.lastSpeechDetectedMs;
        if (now - this.lastTimerResetMs >= 1000) {
          this.lastTimerResetMs = now;
          this.resetBufferDiscardTimer();
        }
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
    const wasRunning = !!this.bufferDiscardTimer;
    this.stopBufferDiscardTimer();
    if (this.state === 'listening') {
      const timeout = this.getBufferDiscardTimeout();
      log.debug('Hot Mic: [timer] reset discard timer (%dms, wasRunning=%s, buf=%d)', timeout, wasRunning, this.transcriptBuffer.length);
      this.bufferDiscardTimer = setTimeout(() => {
        this.bufferDiscardTimer = null;
        if (this.state === 'listening') {
          // If speech was detected recently, restart the timer instead of discarding.
          // This covers natural micro-pauses where RMS dips below threshold briefly.
          const silenceMs = Date.now() - this.lastSpeechDetectedMs;
          if (this.lastSpeechDetectedMs > 0 && silenceMs < timeout) {
            log.debug('Hot Mic: [timer] speech detected %dms ago, restarting timer', silenceMs);
            this.resetBufferDiscardTimer();
            return;
          }

          const hadContent = this.transcriptBuffer.length > 0;
          if (hadContent) {
            log.info('Hot Mic: silence timeout, discarding buffer (%d chunks)', this.transcriptBuffer.length);
            this.transcriptBuffer = [];
          }
          // Always blink-then-hide — even if buffer was empty, the user saw
          // the island appear so they deserve the visual warning before it goes.
          this.cursorStatusManager?.blinkThenHideHotMic();
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
    this.lastTimerResetMs = 0;
    // Don't reset lastSpeechDetectedMs — it tracks real audio activity
    // and is used by the timer callback to survive natural pauses.

    try {
      // Wait for warmup to complete before first transcription — prevents race
      // where a chunk arrives before the Qwen server finishes loading
      if (this.warmupPromise) {
        await this.warmupPromise;
        this.warmupPromise = null;
      }

      // Transcribe the completed chunk — audio monitoring stays active
      const rawTranscript = (await this.transcribe(wavPath)).trim();
      log.info('Hot Mic: raw transcript: "%s"', rawTranscript);
      // Detect snap gesture before stripping parentheticals
      const hasSnap = /\(snap\)/i.test(rawTranscript);
      const transcript = rawTranscript.replace(/\([^)]*\)/g, '').trim();
      const tPost = performance.now();
      log.info('Hot Mic: [timing] transcribe: %dms', Math.round(tPost - t0));

      // Clean up WAV file
      try {
        const fsPromises = await import('fs/promises');
        await fsPromises.unlink(wavPath);
      } catch { /* ignore */ }

      if (!this.isActive) return;

      // Handle snap gesture — toggle hide/show all apps
      if (hasSnap) {
        log.info('Hot Mic: snap detected, toggling app visibility');
        await this.toggleAppVisibility();
        this.playSound('paste');
        this.updateOrangeDot();
        this.nativeHelper.setHarvestMode(this.transcriptBuffer.length === 0 ? 'command' : 'dictation');
        // If the snap was the only content, skip normal processing
        if (!transcript || this.isHallucination(transcript)) return;
      }

      if (this.isHallucination(transcript)) {
        log.info('Hot Mic: skipping hallucinated/empty chunk');
        // Don't call updateOrangeDot() here — the dot may have been shown
        // preemptively on speech detection, and the buffer discard timer
        // (started on first audio detection) guarantees it will be cleaned up.
        // Hiding immediately would make the island disappear before the 4s window.
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
    const trimmed = this.applyWordSubstitutions(transcript.trim());
    const stripped = trimmed.replace(/[.,!?;:]+$/, '').trim();
    const lower = stripped.toLowerCase();

    // Auto-submit: if chunk is a bare number/permission word, submit immediately.
    // Discards any buffered text — a standalone "two" clearly means "select option 2",
    // not a continuation of whatever was buffered before.
    const mappedNumber = NUMBER_MAP[lower];
    const mappedPermission = PERMISSION_MAP[lower];
    if (mappedNumber || mappedPermission) {
      const mapped = mappedNumber || mappedPermission;
      const target = this.getTypeTarget();
      if (target) {
        if (this.transcriptBuffer.length > 0) {
          log.info('Hot Mic: discarding buffer (%d chunks) for shortcut "%s"', this.transcriptBuffer.length, lower);
          this.transcriptBuffer = [];
        }
        log.info('Hot Mic: auto-submitting shortcut "%s" → "%s"', lower, mapped);
        const result = await this.nativeHelper.typeIntoApp(target, mapped, true);
        if (result.success) {
          this.playSound('paste');
        }
      }
      return;
    }

    // Unified tail-match: navigation, system, squares, app switch, start claude, restart server
    const tailMatch = await this.matchTailCommand(lower);
    if (tailMatch) {
      if (tailMatch.remainingText.trim()) {
        const norm = tailMatch.remainingText.trim().replace(/\.+$/, '').trim();
        this.transcriptBuffer.push(norm);
        log.info('Hot Mic: buffered text before command: "%s"', norm);
      }

      // If there's buffered text, flush it before executing the command.
      // Without this, text dictated before a mid-dictation command (e.g. "leave full screen")
      // would sit in the buffer and eventually be discarded by the silence timeout.
      // Cancel-type commands discard the buffer instead (user intent is to abort).
      const isCancel = tailMatch.commandName === 'cancel';
      if (this.transcriptBuffer.length > 0) {
        if (isCancel) {
          log.info('Hot Mic: discarding buffer (%d chunks) for cancel command', this.transcriptBuffer.length);
          this.transcriptBuffer = [];
          this.updateOrangeDot();
        } else {
          const fullText = this.transcriptBuffer.join(' ');
          this.transcriptBuffer = [];
          this.updateOrangeDot();
          const target = this.getTypeTarget();
          if (fullText && target) {
            let mappedText = this.applyMappings(fullText);
            mappedText = this.applyCommandDetection(mappedText);
            log.info('Hot Mic: flushing buffer before command (%d chars): "%s"', mappedText.length, mappedText);
            await this.nativeHelper.typeIntoApp(target, mappedText, false);
          }
        }
      }

      log.info('Hot Mic: tail-match command "%s" → %s', lower, tailMatch.commandName);
      if (tailMatch.script) {
        exec(tailMatch.script);
      }
      if (tailMatch.action) {
        await tailMatch.action();
      }
      this.playSound('paste');
      this.resetBufferDiscardTimer();
      return;
    }

    // Check for paste word (flush buffer without submitting)
    const { shouldPaste, cleanedText: pasteCleanedText } = this.checkPastePhrases(trimmed);

    if (shouldPaste) {
      log.info('Hot Mic: paste phrase matched in chunk: "%s"', trimmed);
      if (pasteCleanedText.trim()) {
        this.transcriptBuffer.push(pasteCleanedText.trim().toLowerCase().replace(/\.+$/, '').trim());
      }

      const fullText = this.transcriptBuffer.join(' ');
      this.transcriptBuffer = [];
      this.updateOrangeDot();

      const target = this.getTypeTarget();
      if (fullText && target) {
        let mappedText = this.applyMappings(fullText);
        mappedText = this.applyCommandDetection(mappedText);
        // Trailing space so the next dictation flows naturally
        mappedText = mappedText + ' ';
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
    const { shouldSubmit, cleanedText } = this.checkSubmitPhrases(trimmed);

    if (shouldSubmit) {
      log.info('Hot Mic: submit phrase matched in chunk: "%s"', trimmed);
      // Add any remaining text before the submit word to buffer
      if (cleanedText.trim()) {
        this.transcriptBuffer.push(cleanedText.trim().toLowerCase().replace(/\.+$/, '').trim());
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
    // Normalize for natural dictation: lowercase and strip trailing periods
    // (Qwen treats each chunk as a standalone utterance, adding false sentence-ending
    // periods at chunk boundaries). Internal periods and ?/! are preserved.
    const normalized = trimmed.toLowerCase().replace(/\.+$/, '').trim();
    this.transcriptBuffer.push(normalized);
    log.info('Hot Mic: buffered (%d total): "%s"', this.transcriptBuffer.length, normalized);
    // Orange dot update is handled by onChunkReady after this method returns
    this.resetBufferDiscardTimer();
  }

  private static readonly DEFAULT_SUBMIT_PHRASES = 'over, go ahead, send it, submit, do it';
  private static readonly DEFAULT_PASTE_PHRASES = 'paste, paste it, transcribe';
  private static readonly DEFAULT_CANCEL_PHRASES = 'cancel, stop, abort';
  private static readonly DEFAULT_NEW_WINDOW_PHRASES = 'new window';
  private static readonly DEFAULT_CLOSE_WINDOW_PHRASES = 'close window, close the window, close this window';
  private static readonly DEFAULT_MINIMIZE_PHRASES = 'minimize, minimize window, minimize the window';
  private static readonly DEFAULT_HIDE_PHRASES = 'hide, hide app, hide this app, hide the app';
  private static readonly DEFAULT_QUIT_PHRASES = 'quit, quit app, quit this app';
  private static readonly DEFAULT_SWITCH_WORDS = 'next, switch';
  private static readonly DEFAULT_PREV_WINDOW_WORDS = 'back, previous';
  private static readonly DEFAULT_RUN_CLAUDE_PHRASES = 'start claude, start cloud, run claude';
  private static readonly DEFAULT_RESTART_SERVER_PHRASES = 'restart server, restart dev, restart dev server';
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
   * Check if a command phrase appears at the end of the transcript.
   * 1. Peel trailing sentences that are entirely a command phrase
   *    ("blah. Go ahead. Submit." → strip "Submit.", strip "Go ahead.")
   * 2. Strip command phrase from the tail of the last remaining sentence
   *    ("we're going to transcribe." → strip "transcribe" → "we're going to")
   * 3. Fallback: check tail of entire text when there's no punctuation
   */
  private checkTrailingPhrase(text: string, phrases: string[][]): { matched: boolean; cleanedText: string } {
    const trimmed = text.trim();

    // Step 1: peel trailing sentences that are entirely a command phrase
    const sentences = trimmed.split(/(?<=[.!?])\s+/);
    let end = sentences.length;

    while (end > 0) {
      const sent = sentences[end - 1].replace(/[.,!?;:]+$/, '').trim();
      const sentWords = sent.split(/\s+/);
      let peeled = false;

      for (const phraseWords of phrases) {
        if (sentWords.length === phraseWords.length &&
            sentWords.every((w, j) => w.toLowerCase() === phraseWords[j])) {
          end--;
          peeled = true;
          break;
        }
      }

      if (!peeled) break;
    }

    if (end < sentences.length) {
      // Step 2: also strip command phrase from the tail of the last remaining sentence
      let cleanedText = sentences.slice(0, end).join(' ').trim();
      if (cleanedText) {
        const lastStripped = cleanedText.replace(/[.,!?;:]+$/, '').trim();
        const lastWords = lastStripped.split(/\s+/);
        for (const phraseWords of phrases) {
          const phraseLen = phraseWords.length;
          if (lastWords.length >= phraseLen) {
            const tail = lastWords.slice(-phraseLen).map(w => w.toLowerCase());
            if (tail.every((w, j) => w === phraseWords[j])) {
              cleanedText = lastWords.slice(0, -phraseLen).join(' ').trim();
              break;
            }
          }
        }
      }
      return { matched: true, cleanedText };
    }

    // Step 3: fallback — check tail of entire text (no punctuation)
    const stripped = trimmed.replace(/[.,!?;:]+$/, '').trim();
    const words = stripped.split(/\s+/);
    for (const phraseWords of phrases) {
      const phraseLen = phraseWords.length;
      if (words.length >= phraseLen) {
        const tail = words.slice(-phraseLen).map(w => w.toLowerCase());
        if (tail.every((w, i) => w === phraseWords[i])) {
          const remaining = words.slice(0, -phraseLen);
          return { matched: true, cleanedText: remaining.join(' ') };
        }
      }
    }

    return { matched: false, cleanedText: trimmed };
  }

  private checkSubmitPhrases(transcript: string): { shouldSubmit: boolean; cleanedText: string } {
    const { matched, cleanedText } = this.checkTrailingPhrase(transcript, this.getSubmitPhrases());
    return { shouldSubmit: matched, cleanedText };
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
    const { matched, cleanedText } = this.checkTrailingPhrase(transcript, this.getPastePhrases());
    return { shouldPaste: matched, cleanedText };
  }

  /**
   * Unified tail-match for all voice commands.
   * Checks static phrase sets first, then dynamic sources (squares, app switching).
   * Returns the command to execute and remaining text, or null.
   */
  private async matchTailCommand(text: string): Promise<{ commandName: string; script?: string; action?: () => Promise<void>; remainingText: string } | null> {
    const commandSets: Array<{
      name: string;
      phrases: string[];
      script?: string;
      action?: () => Promise<void>;
    }> = [
      { name: 'switch window', phrases: this.getPhraseList('hotMicSwitchWords', HotMicManager.DEFAULT_SWITCH_WORDS),
        script: 'osascript -e \'tell application "System Events" to keystroke "`" using command down\'' },
      { name: 'prev window', phrases: this.getPhraseList('hotMicPrevWindowWords', HotMicManager.DEFAULT_PREV_WINDOW_WORDS),
        script: 'osascript -e \'tell application "System Events" to keystroke "`" using {command down, shift down}\'' },
      { name: 'new window', phrases: this.getPhraseList('hotMicNewWindowWords', HotMicManager.DEFAULT_NEW_WINDOW_PHRASES),
        script: 'osascript -e \'tell application "System Events" to keystroke "n" using command down\'' },
      { name: 'close window', phrases: this.getPhraseList('hotMicCloseWindowWords', HotMicManager.DEFAULT_CLOSE_WINDOW_PHRASES),
        script: 'osascript -e \'tell application "System Events" to keystroke "w" using command down\'' },
      { name: 'minimize', phrases: this.getPhraseList('hotMicMinimizePhrases', HotMicManager.DEFAULT_MINIMIZE_PHRASES),
        action: async () => {
          if (this.squaresManager) {
            await this.squaresManager.executeAction('minimize');
          } else {
            exec('osascript -e \'tell application "System Events" to keystroke "m" using command down\'');
          }
        },
      },
      { name: 'hide', phrases: this.getPhraseList('hotMicHidePhrases', HotMicManager.DEFAULT_HIDE_PHRASES),
        action: async () => {
          if (this.squaresManager) {
            await this.squaresManager.executeAction('hide');
          } else {
            exec('osascript -e \'tell application "System Events" to keystroke "h" using command down\'');
          }
        },
      },
      { name: 'quit', phrases: this.getPhraseList('hotMicQuitPhrases', HotMicManager.DEFAULT_QUIT_PHRASES),
        script: 'osascript -e \'tell application "System Events" to keystroke "q" using command down\'' },
      { name: 'cancel', phrases: this.getPhraseList('hotMicCancelWords', HotMicManager.DEFAULT_CANCEL_PHRASES),
        script: 'osascript -e \'tell application "System Events" to keystroke "c" using control down\'' },
      { name: 'start claude', phrases: this.getPhraseList('hotMicRunClaudeWords', HotMicManager.DEFAULT_RUN_CLAUDE_PHRASES),
        action: async () => {
          const target = this.getTypeTarget();
          if (target) {
            await this.nativeHelper.typeIntoApp(target, 'claude', true);
          }
        },
      },
      { name: 'restart server', phrases: this.getPhraseList('hotMicRestartServerWords', HotMicManager.DEFAULT_RESTART_SERVER_PHRASES),
        action: async () => {
          const command = this.preferences.getPreference('hotMicRestartServerCommand');
          const cmd = typeof command === 'string' && command.trim() ? command.trim() : '';
          if (cmd) {
            const target = this.getTypeTarget();
            if (target) {
              log.info('Hot Mic: restart server — Ctrl+C then "%s" (target: %s)', cmd, target);
              const safeCmd = cmd.replace(/'/g, "'\\''");
              const script = [
                `osascript -e 'tell application "System Events" to keystroke "c" using control down'`,
                `sleep 3`,
                `osascript -e 'tell application "System Events"' -e 'delay 0.1' -e 'keystroke "${safeCmd}"' -e 'keystroke return' -e 'end tell'`,
              ].join(' && ');
              const child = spawn('bash', ['-c', script], {
                detached: true,
                stdio: 'ignore',
              });
              child.unref();
            }
          } else {
            log.info('Hot Mic: restart server — no command configured, ignoring');
          }
        },
      },
    ];

    // Add system commands (media, volume, etc.)
    for (const [key, cmd] of Object.entries(SYSTEM_COMMANDS)) {
      const pref = this.preferences.getPreference(cmd.prefKey as any);
      const raw = typeof pref === 'string' && pref.trim() ? pref : cmd.defaultPhrases;
      const phrases = raw.split(',').map(w => w.trim().toLowerCase()).filter(w => w.length > 0);
      commandSets.push({ name: key, phrases, script: cmd.script });
    }

    // Static phrase tail-matching
    const stripped = text.replace(/[.,!?;:]+$/, '').trim();
    const words = stripped.split(/\s+/);

    log.debug('Hot Mic: tail-match input="%s" (%d commands)', text, commandSets.length);

    for (const cmd of commandSets) {
      for (const phrase of cmd.phrases) {
        const phraseWords = phrase.split(/\s+/);
        if (words.length >= phraseWords.length) {
          const tail = words.slice(-phraseWords.length).map(w => w.toLowerCase());
          if (tail.every((w, i) => w === phraseWords[i])) {
            const remaining = words.slice(0, -phraseWords.length).join(' ');
            return { commandName: cmd.name, script: cmd.script, action: cmd.action, remainingText: remaining };
          }
        }
      }
    }

    // Dynamic: Squares window management commands
    if (this.squaresManager) {
      const tailMatch = this.squaresManager.parseVoiceCommandFromTail(text);
      if (tailMatch) {
        return {
          commandName: 'squares:' + tailMatch.action,
          action: async () => { this.squaresManager!.executeAction(tailMatch.action); },
          remainingText: tailMatch.remainingText,
        };
      }
    }

    // Dynamic: App switching
    if (this.appSwitcher) {
      const appTailMatch = await this.parseAppSwitchFromTail(text);
      if (appTailMatch) {
        return {
          commandName: 'app-switch:' + appTailMatch.appName,
          action: async () => { await this.activateAppByName(appTailMatch); },
          remainingText: appTailMatch.remainingText,
        };
      }
    }

    // Dynamic: Quit specific app by name ("quit slack", "quit the browser")
    const quitMatch = await this.parseQuitAppFromTail(text);
    if (quitMatch) {
      return {
        commandName: 'quit-app:' + quitMatch.appName,
        action: async () => { await this.quitAppByName(quitMatch); },
        remainingText: quitMatch.remainingText,
      };
    }

    // Dynamic: Bare app name without prefix ("browser", "chrome", "terminal")
    // Only matches non-ambiguous names to avoid false triggers
    if (this.appSwitcher) {
      const bareMatch = await this.parseBareAppFromTail(text);
      if (bareMatch) {
        return {
          commandName: 'app-switch:' + bareMatch.appName,
          action: async () => { await this.activateAppByName(bareMatch); },
          remainingText: bareMatch.remainingText,
        };
      }
    }

    return null;
  }

  /**
   * Get a phrase list from preferences with a fallback default.
   */
  private getPhraseList(prefKey: string, defaultValue: string): string[] {
    const pref = this.preferences.getPreference(prefKey as any);
    const raw = typeof pref === 'string' && pref.trim() ? pref : defaultValue;
    return raw.split(',').map(w => w.trim().toLowerCase()).filter(w => w.length > 0);
  }

  // ── App switching (voice-triggered) ─────────────────────────────────

  /**
   * Normalize a name for fuzzy comparison: lowercase, strip non-alphanumeric, collapse spaces.
   */
  private normalizeAppName(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  /**
   * Fetch running apps once (cached by clipboardHistoryWindow for 5s).
   */
  private async getRunningApps(): Promise<Array<{ bundleId: string; name: string }>> {
    if (!this.appSwitcher) return [];
    return this.appSwitcher.getRunningApps();
  }

  /**
   * Match spoken text against known app aliases and running apps.
   * Returns { bundleId, appName } or null.
   */
  private matchAppName(
    spoken: string,
    runningApps: Array<{ bundleId: string; name: string }>,
  ): { bundleId: string | null; appName: string } | null {
    const cleaned = spoken.replace(/[.,!?;:]+$/, '').trim().toLowerCase();
    if (!cleaned) return null;

    // 1. Check user-configured aliases first (highest priority)
    const userAliases = this.preferences.getPreference('hotMicAppAliases') ?? [];
    for (const { appName, aliases } of userAliases) {
      const aliasList = aliases.split(',').map(a => a.trim().toLowerCase()).filter(a => a.length > 0);
      if (aliasList.includes(cleaned)) {
        const bundleId = this.findBundleId(appName, runningApps);
        return { bundleId, appName };
      }
    }

    // 2. Check built-in alias map
    for (const [canonical, aliases] of Object.entries(APP_VOICE_ALIASES)) {
      if (aliases.includes(cleaned)) {
        // Found alias — look up in running apps
        const bundleId = this.findBundleId(canonical, runningApps);
        return { bundleId, appName: canonical };
      }
    }

    // 3. Check running apps by normalized name
    const normalizedSpoken = this.normalizeAppName(cleaned);
    for (const app of runningApps) {
      if (this.normalizeAppName(app.name) === normalizedSpoken) {
        return { bundleId: app.bundleId, appName: app.name };
      }
    }

    return null;
  }

  /**
   * Look up a canonical app name in a running apps list and return its bundle ID.
   */
  private findBundleId(
    canonicalName: string,
    runningApps: Array<{ bundleId: string; name: string }>,
  ): string | null {
    const normalized = this.normalizeAppName(canonicalName);
    for (const app of runningApps) {
      if (this.normalizeAppName(app.name) === normalized) {
        return app.bundleId;
      }
    }
    return null;
  }

  /**
   * Check if text ends with "open X" / "switch to X" / "go to X".
   * Returns matched app info + remaining text, or null.
   */
  private async parseAppSwitchFromTail(text: string): Promise<{ appName: string; bundleId: string | null; remainingText: string } | null> {
    const prefixes = ['open ', 'switch to ', 'go to '];
    const runningApps = await this.getRunningApps();

    // Build all possible app phrases (user aliases + built-in aliases + running app names)
    const phrases: Array<{ phrase: string; canonical: string }> = [];

    // From user-configured aliases (highest priority)
    const userAliases = this.preferences.getPreference('hotMicAppAliases') ?? [];
    for (const { appName, aliases } of userAliases) {
      const aliasList = aliases.split(',').map(a => a.trim().toLowerCase()).filter(a => a.length > 0);
      for (const alias of aliasList) {
        phrases.push({ phrase: alias, canonical: appName });
      }
    }

    // From built-in alias map
    for (const [canonical, aliases] of Object.entries(APP_VOICE_ALIASES)) {
      for (const alias of aliases) {
        phrases.push({ phrase: alias, canonical });
      }
    }

    // From running apps (normalized names)
    for (const app of runningApps) {
      phrases.push({ phrase: app.name.toLowerCase(), canonical: app.name });
    }

    // Sort longest first to match "visual studio code" before "visual studio"
    phrases.sort((a, b) => b.phrase.length - a.phrase.length);

    // Match with optional articles ("the", "a", "an") between prefix and app name.
    // Handles natural speech: "go to the terminal", "open the chrome", etc.
    const articles = ['the ', 'a ', 'an '];
    for (const prefix of prefixes) {
      for (const { phrase, canonical } of phrases) {
        const triggers = [prefix + phrase];
        for (const article of articles) {
          triggers.push(prefix + article + phrase);
        }
        for (const trigger of triggers) {
          if (text === trigger) {
            const bundleId = this.findBundleId(canonical, runningApps);
            return { appName: canonical, bundleId, remainingText: '' };
          }
          if (text.endsWith(' ' + trigger)) {
            const remaining = text.slice(0, -(trigger.length + 1)).trim();
            const bundleId = this.findBundleId(canonical, runningApps);
            return { appName: canonical, bundleId, remainingText: remaining };
          }
        }
      }
    }

    return null;
  }

  /**
   * Activate an app by bundle ID (preferred) or by name (fallback, also launches).
   * Fails silently if app doesn't exist.
   */
  private async activateAppByName(match: { bundleId: string | null; appName: string }): Promise<void> {
    try {
      if (match.bundleId && this.appSwitcher) {
        await this.appSwitcher.activateApp(match.bundleId);
      } else {
        // Fallback: open by name (launches if not running, fails silently if app doesn't exist)
        const safeName = match.appName.replace(/"/g, '\\"');
        await new Promise<void>((resolve) => {
          exec(`open -a "${safeName}"`, () => resolve());
        });
      }
    } catch {
      // App may not respond
    }
  }

  /**
   * Check if text ends with "quit X" / "close X" / "kill X" (app-level quit).
   * Reuses the same app name matching as parseAppSwitchFromTail.
   */
  private async parseQuitAppFromTail(text: string): Promise<{ appName: string; bundleId: string | null; remainingText: string } | null> {
    const prefixes = ['quit ', 'close ', 'kill '];
    const runningApps = await this.getRunningApps();

    // Build all possible app phrases (same logic as parseAppSwitchFromTail)
    const phrases: Array<{ phrase: string; canonical: string }> = [];

    const userAliases = this.preferences.getPreference('hotMicAppAliases') ?? [];
    for (const { appName, aliases } of userAliases) {
      const aliasList = aliases.split(',').map(a => a.trim().toLowerCase()).filter(a => a.length > 0);
      for (const alias of aliasList) {
        phrases.push({ phrase: alias, canonical: appName });
      }
    }

    for (const [canonical, aliases] of Object.entries(APP_VOICE_ALIASES)) {
      for (const alias of aliases) {
        phrases.push({ phrase: alias, canonical });
      }
    }

    for (const app of runningApps) {
      phrases.push({ phrase: app.name.toLowerCase(), canonical: app.name });
    }

    phrases.sort((a, b) => b.phrase.length - a.phrase.length);

    const articles = ['the ', 'a ', 'an '];
    for (const prefix of prefixes) {
      for (const { phrase, canonical } of phrases) {
        const triggers = [prefix + phrase];
        for (const article of articles) {
          triggers.push(prefix + article + phrase);
        }
        for (const trigger of triggers) {
          if (text === trigger) {
            const bundleId = this.findBundleId(canonical, runningApps);
            return { appName: canonical, bundleId, remainingText: '' };
          }
          if (text.endsWith(' ' + trigger)) {
            const remaining = text.slice(0, -(trigger.length + 1)).trim();
            const bundleId = this.findBundleId(canonical, runningApps);
            return { appName: canonical, bundleId, remainingText: remaining };
          }
        }
      }
    }

    return null;
  }

  /**
   * Check if text ends with a bare app name (no "open"/"switch to" prefix).
   * Only matches non-ambiguous names to avoid false triggers in conversation.
   * User-configured aliases always match (user explicitly chose those words).
   */
  private async parseBareAppFromTail(text: string): Promise<{ appName: string; bundleId: string | null; remainingText: string } | null> {
    const runningApps = await this.getRunningApps();
    const stripped = text.replace(/[.,!?;:]+$/, '').trim().toLowerCase();
    if (!stripped) return null;

    // Build candidate phrases: user aliases + built-in aliases + running app names
    // Sort longest first so "arc browser" matches before "arc"
    const candidates: Array<{ phrase: string; resolve: () => { appName: string; bundleId: string | null } | null }> = [];

    // User-configured aliases — always trusted (user explicitly chose these words)
    const userAliases = this.preferences.getPreference('hotMicAppAliases') ?? [];
    for (const { appName, aliases } of userAliases) {
      const aliasList = aliases.split(',').map(a => a.trim().toLowerCase()).filter(a => a.length > 0);
      for (const alias of aliasList) {
        candidates.push({
          phrase: alias,
          resolve: () => ({ appName, bundleId: this.findBundleId(appName, runningApps) }),
        });
      }
    }

    // Built-in aliases (skip ambiguous ones)
    for (const [canonical, aliases] of Object.entries(APP_VOICE_ALIASES)) {
      for (const alias of aliases) {
        if (AMBIGUOUS_APP_NAMES.has(alias)) continue;
        candidates.push({
          phrase: alias,
          resolve: () => ({ appName: canonical, bundleId: this.findBundleId(canonical, runningApps) }),
        });
      }
    }

    // Running apps by name (skip ambiguous)
    for (const app of runningApps) {
      const lower = app.name.toLowerCase();
      if (AMBIGUOUS_APP_NAMES.has(lower)) continue;
      candidates.push({
        phrase: lower,
        resolve: () => ({ appName: app.name, bundleId: app.bundleId }),
      });
    }

    // Sort longest first
    candidates.sort((a, b) => b.phrase.length - a.phrase.length);

    // Match against tail of text
    for (const { phrase, resolve } of candidates) {
      if (stripped === phrase) {
        const result = resolve();
        if (result) return { ...result, remainingText: '' };
      }
      if (stripped.endsWith(' ' + phrase)) {
        const result = resolve();
        if (result) {
          const remaining = stripped.slice(0, -(phrase.length + 1)).trim();
          return { ...result, remainingText: remaining };
        }
      }
    }

    return null;
  }

  /**
   * Quit an app by name. Uses AppleScript to gracefully quit.
   */
  private async quitAppByName(match: { bundleId: string | null; appName: string }): Promise<void> {
    try {
      const safeName = match.appName.replace(/'/g, "'\\''");
      await new Promise<void>((resolve) => {
        exec(`osascript -e 'tell application "${safeName}" to quit'`, () => resolve());
      });
      log.info('Hot Mic: quit app "%s"', match.appName);
    } catch {
      // App may not respond to quit
    }
  }

  /**
   * Apply user-configured word substitutions (e.g., "clod" → "claude").
   * Uses word boundaries to avoid partial matches.
   */
  private applyWordSubstitutions(text: string): string {
    const substitutions = this.preferences.getPreference('wordSubstitutions') ?? [];
    if (!substitutions || substitutions.length === 0) return text;

    let result = text;
    for (const { from, to } of substitutions) {
      if (!from || from === to) continue;
      const regex = new RegExp(`\\b${this.escapeRegex(from)}\\b`, 'gi');
      result = result.replace(regex, to);
    }
    return result;
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

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

  private getLastBufferWord(): string {
    const all = this.transcriptBuffer.join(' ').trim();
    if (!all) return '';
    const words = all.split(/\s+/);
    return words[words.length - 1] || '';
  }

  private updateOrangeDot(): void {
    if (!this.cursorStatusManager) return;

    if ((this.state === 'listening' && this.transcriptBuffer.length > 0) || this.state === 'recording') {
      this.cursorStatusManager.showHotMic();
      const showCount = this.preferences.getPreference('hotMicShowWordCount') === true;
      this.cursorStatusManager.setHotMicWordCount(
        showCount ? this.getBufferWordCount() : 0,
        this.getLastBufferWord()
      );
    } else {
      this.cursorStatusManager.setHotMicWordCount(0);
      this.cursorStatusManager.hideHotMic();
    }
  }

  // ---------------------------------------------------------------------------
  // Legacy direct-paste mode (non-queue, recording state)
  // ---------------------------------------------------------------------------

  private async processTranscriptDirectPaste(transcript: string): Promise<void> {
    const trimmed = this.applyWordSubstitutions(transcript.trim());
    const stripped = trimmed.replace(/[.,!?;:]+$/, '').trim();
    const lower = stripped.toLowerCase();

    const { shouldSubmit, cleanedText } = this.checkSubmitPhrases(trimmed);

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
  // Snap gesture — toggle hide/show all apps
  // ---------------------------------------------------------------------------

  private async toggleAppVisibility(): Promise<void> {
    if (this.appsHidden) {
      // Show all apps
      if (this.squaresManager) {
        await this.squaresManager.executeAction('showAll');
      } else {
        exec(`osascript -e 'tell application "System Events" to set visible of every process whose visible is false to true'`);
      }
      this.appsHidden = false;
      log.info('Hot Mic: snap → showing all apps');
    } else {
      // Hide all apps except frontmost
      if (this.squaresManager) {
        await this.squaresManager.executeAction('focus');
      } else {
        exec(`osascript -e 'tell application "System Events" to keystroke "h" using {command down, option down}'`);
      }
      this.appsHidden = true;
      log.info('Hot Mic: snap → hiding all other apps');
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
