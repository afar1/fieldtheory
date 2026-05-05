import { EventEmitter } from 'events';
import { app, globalShortcut } from 'electron';
import { spawn, ChildProcess, exec, execFile } from 'child_process';
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
import { DynamicIslandManager, type HotMicBackgroundFilterMeter } from './dynamicIslandManager';
import { ClipboardItem, isTerminalApp } from './clipboardManager';
import { HOT_MIC_DEFAULTS, HOT_MIC_DEFAULT_SYSTEM_COMMANDS } from './hotMicDefaults';
import { getHotkeyManager } from './hotkeyManager';
import {
  isParakeetEngine,
  isTranscriptionEngine,
  type TranscriptionEngine,
} from './types/transcribe';
import type { HotMicEngineStatus } from './types/hotMic';
import { createLogger } from './logger';
import { stripFigureReferences, insertFigureReferencesInline } from './figureUtils';

const log = createLogger('HotMic');
const LOG_TRANSCRIPT_PAYLOADS = process.env.LOG_TRANSCRIPT_PAYLOADS === 'true';

function logTranscriptPayload(label: string, text: string): void {
  if (LOG_TRANSCRIPT_PAYLOADS) {
    log.debug('%s: "%s"', label, text);
    return;
  }
  log.debug('%s (%d chars, payload redacted)', label, text.length);
}

interface ChunkAudioStats {
  sampleCount: number;
  speechSamples: number;
  speechRatio: number;
  rawAverage: number;
  speechAverage: number;
  rawPeak: number;
  speechPeak: number;
}

interface PendingChunk {
  filePath: string;
  audioStats: ChunkAudioStats;
  readyAtMs: number;
  enqueuedAtMs: number;
}

interface HotMicBufferSegment {
  text: string;
  endMs: number;
}

interface HotMicScreenshotMeta {
  itemId: number;
  figureLabel: string;
  figureId: string;
  capturedAtMs: number;
}

interface BackgroundFilterGate {
  threshold: number;
  ratioThreshold: number;
  minSpeechSamples: number;
  peakThreshold: number;
  nearFieldPeakThreshold: number;
}

type HarvestMode = 'command' | 'dictation';

type HotMicClipboardBridge = {
  storeText: (...args: any[]) => Promise<number>;
  setClipboardHashFromText?: (text: string) => void;
  syncClipboardHash?: () => void;
  getItem?: (id: number) => ClipboardItem | null;
  updateFigureLabel?: (itemId: number, figureLabel: string, figureId?: string) => void;
  generateFigureId?: () => string;
  exportImageToCache?: (item: ClipboardItem) => Promise<string | null>;
};

type FieldTheoryMarkdownInsertionTarget = {
  isAvailable: () => boolean;
  insertText: (text: string) => boolean;
};

type HotMicTextTarget =
  | { kind: 'app'; bundleId: string }
  | { kind: 'field-theory-markdown' }
  | { kind: 'none' };

/**
 * Hot Mic states:
 * - idle: Not active
 * - armed: Activated via hook, brief delay before recording
 * - listening: Always-on mode, transcribing chunks into a buffer
 * - recording: Legacy direct-paste mode
 */
export type HotMicState = 'idle' | 'armed' | 'listening' | 'recording';

/**
 * Fine-grained operational condition overlaid on the base state.
 * Tells the UI/IPC exactly what's happening inside the hot mic session:
 * - warming: transcription engine is starting up
 * - ready: engine warm, processing chunks normally
 * - degraded: primary engine failed, fell back to Whisper
 * - yielded: temporarily paused while the standard transcriber records
 * - muted: user-muted, mic paused but session alive
 */
export type HotMicCondition = 'warming' | 'ready' | 'degraded' | 'yielded' | 'muted';

/**
 * Observable runtime status exposed to UI/IPC. This is the full picture
 * of hot mic operational health beyond the coarse state enum.
 */
export interface HotMicRuntimeStatus {
  state: HotMicState;
  condition: HotMicCondition | null;
  engineReady: boolean;
  whisperFallbackActive: boolean;
  queueDepth: number;
  lastChunkAgeMs: number | null;
  chunksReceived: number;
  micHealthy: boolean;
  engine: HotMicEngineStatus | null;
  timing: {
    chunkIntervalMs: number | null;
    queueWaitMs: number | null;
    transcribeMs: number | null;
    postProcessMs: number | null;
    totalPipelineMs: number | null;
    avgTranscribeMs: number | null;
    avgTotalPipelineMs: number | null;
  };
}

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
  'first option': '1',
  'second option': '2',
  'third option': '3',
  'fourth option': '4',
};

/**
 * Permission word → key mapping for voice shortcuts.
 */
const PERMISSION_MAP: Record<string, string> = {
  'allow': 'y',
  'approve': 'y',
  'always': 'a',
  'deny': 'n',
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
    defaultPhrases: HOT_MIC_DEFAULT_SYSTEM_COMMANDS['play-pause'],
    prefKey: 'hotMicPlayPausePhrases',
  },
  'next-track': {
    script: `osascript -e 'if application "Music" is running then' -e 'tell application "Music" to next track' -e 'else if application "Spotify" is running then' -e 'tell application "Spotify" to next track' -e 'end if'`,
    defaultPhrases: HOT_MIC_DEFAULT_SYSTEM_COMMANDS['next-track'],
    prefKey: 'hotMicNextTrackPhrases',
  },
  'previous-track': {
    script: `osascript -e 'if application "Music" is running then' -e 'tell application "Music" to previous track' -e 'else if application "Spotify" is running then' -e 'tell application "Spotify" to previous track' -e 'end if'`,
    defaultPhrases: HOT_MIC_DEFAULT_SYSTEM_COMMANDS['previous-track'],
    prefKey: 'hotMicPrevTrackPhrases',
  },
  'volume-up': {
    script: `osascript -e 'set volume output volume ((output volume of (get volume settings)) + 10)'`,
    defaultPhrases: HOT_MIC_DEFAULT_SYSTEM_COMMANDS['volume-up'],
    prefKey: 'hotMicVolumeUpPhrases',
  },
  'volume-down': {
    script: `osascript -e 'set volume output volume ((output volume of (get volume settings)) - 10)'`,
    defaultPhrases: HOT_MIC_DEFAULT_SYSTEM_COMMANDS['volume-down'],
    prefKey: 'hotMicVolumeDownPhrases',
  },
  'mute': {
    script: `osascript -e 'set volume with output muted'`,
    defaultPhrases: HOT_MIC_DEFAULT_SYSTEM_COMMANDS.mute,
    prefKey: 'hotMicMutePhrases',
  },
  'unmute': {
    script: `osascript -e 'set volume without output muted'`,
    defaultPhrases: HOT_MIC_DEFAULT_SYSTEM_COMMANDS.unmute,
    prefKey: 'hotMicUnmutePhrases',
  },
  'sleep': {
    script: `osascript -e 'tell application "System Events" to sleep'`,
    defaultPhrases: HOT_MIC_DEFAULT_SYSTEM_COMMANDS.sleep,
    prefKey: 'hotMicSleepPhrases',
  },
  'lock': {
    script: `osascript -e 'tell application "System Events" to keystroke "q" using {command down, control down}'`,
    defaultPhrases: HOT_MIC_DEFAULT_SYSTEM_COMMANDS.lock,
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
  private clipboardManager: HotMicClipboardBridge | null = null;
  private cursorStatusManager: CursorStatusManager | null = null;
  private commandsManager: CommandsManager | null = null;
  private audioManager: AudioManager | null = null;
  private dynamicIslandManager: DynamicIslandManager | null = null;
  private metricsWordsRecorder: ((wordCount: number) => void) | null = null;
  private fieldTheoryMarkdownInsertionTarget: FieldTheoryMarkdownInsertionTarget | null = null;

  private state: HotMicState = 'idle';
  private condition: HotMicCondition | null = null;
  private muted: boolean = false;
  private targetBundleId: string | null = null;
  private whisperProcess: ChildProcess | null = null;

  // Audio level monitoring for orange dot UI (silence detection moved to Swift)
  private audioLevelListener: ((level: number, isSpeech: boolean) => void) | null = null;
  private chunkReadyListener: ((filePath: string) => void) | null = null;
  private chunkProcessingInFlight: boolean = false;
  private shortPressInFlight: boolean = false;
  private shortPressPending: boolean = false;
  private pendingChunkQueue: PendingChunk[] = [];
  private forcedSnapshotTimer: NodeJS.Timeout | null = null;
  private forcedSnapshotInFlight: boolean = false;
  private lastChunkReadyMs: number = 0;
  private lastChunkIntervalMs: number | null = null;
  private hasSpeechSinceLastHarvest: boolean = false;
  private resumeInFlight: boolean = false;
  private yieldedToTranscriber: boolean = false;

  // Runtime health tracking — exposed via getRuntimeStatus()
  private engineReady: boolean = false;
  private whisperFallbackActive: boolean = false;
  private chunksReceivedCount: number = 0;
  private lastQueueWaitMs: number | null = null;
  private lastTranscribeMs: number | null = null;
  private lastPostProcessMs: number | null = null;
  private lastTotalPipelineMs: number | null = null;
  private avgTranscribeMs: number | null = null;
  private avgTotalPipelineMs: number | null = null;
  private static readonly TIMING_EMA_ALPHA = 0.22;
  private static readonly MAX_CHUNK_QUEUE_DEPTH = 8;
  private drawerSpeaking: boolean = false;
  private drawerSpeakingTimeout: NodeJS.Timeout | null = null;
  private static readonly DRAWER_SPEAKING_HOLD_MS = 320;
  // Quality-critical: native helper must be the single chunk boundary source.
  // Re-enabling this fallback reintroduces duplicate micro-chunks and noticeably
  // degrades transcription continuity/accuracy in real dictation.
  private static readonly ENABLE_FORCED_SNAPSHOT_FALLBACK = false;
  private static readonly FORCE_SNAPSHOT_CHECK_MS = 120;
  private static readonly FORCE_SNAPSHOT_SPEECH_GRACE_MS = 220;
  private static readonly FORCE_SNAPSHOT_COMMAND_MS = 700;
  private static readonly FORCE_SNAPSHOT_MLX_MS = 1000;
  private static readonly FORCE_SNAPSHOT_BACKPRESSURE_MS = 1400;
  private static readonly HARVEST_BACKPRESSURE_QUEUE_THRESHOLD = 2;
  private static readonly SCREENSHOT_SESSION_SKEW_GRACE_MS = 100;
  private static readonly FILTER_METER_UPDATE_MS = 90;
  private static readonly AUDIO_DIAG_WINDOW_MS = 2200;
  private static readonly AUDIO_DIAG_NO_EVENT_WARN_MS = 3200;
  private static readonly AUDIO_DIAG_WARN_COOLDOWN_MS = 5000;
  private static readonly FAILURE_ALERT_COOLDOWN_MS = 15000;
  private static readonly BACKGROUND_FILTER_THRESHOLD_BASE = 0.004;
  private static readonly BACKGROUND_FILTER_THRESHOLD_SPAN = 0.085;
  private static readonly BACKGROUND_FILTER_RATIO_BASE = 0.04;
  private static readonly BACKGROUND_FILTER_RATIO_SPAN = 0.28;
  private static readonly BACKGROUND_FILTER_MIN_SPEECH_BASE = 2;
  private static readonly BACKGROUND_FILTER_MIN_SPEECH_SPAN = 6;
  private static readonly BACKGROUND_FILTER_PEAK_MULTIPLIER_BASE = 1.05;
  private static readonly BACKGROUND_FILTER_PEAK_MULTIPLIER_SPAN = 0.4;
  private static readonly BACKGROUND_FILTER_NEAR_FIELD_MULTIPLIER = 1.65;
  private static readonly REPETITION_COLLAPSED_MIN_CHARS = 30;
  private static readonly REPETITION_SINGLE_CHAR_MIN_RUN = 25;
  private static readonly REPETITION_UNIT_MIN = 2;
  private static readonly REPETITION_UNIT_MAX = 8;
  private static readonly REPETITION_UNIT_MIN_REPEATS = 8;
  private static readonly REPETITION_SHORT_BURST_MIN_WORDS = 2;
  private static readonly REPETITION_SHORT_BURST_ALWAYS_MIN_WORDS = 4;
  private static readonly REPETITION_SHORT_BURST_LONG_WORD_LEN = 8;
  private static readonly REPETITION_ANALYSIS_MIN_WORDS = 8;
  private static readonly REPETITION_CONSECUTIVE_RUN_MIN = 8;
  private static readonly REPETITION_UNIQUE_RATIO_MAX = 0.25;
  private static readonly REPETITION_DOMINANT_RATIO_MIN = 0.7;
  private static readonly BOUNDARY_STITCH_MIN_WORDS = 2;
  private static readonly BOUNDARY_STITCH_MAX_WORDS = 6;

  // Warmup promise — awaited before first transcription to avoid racing the runtime startup
  private warmupPromise: Promise<void> | null = null;

  // Transcript buffer — accumulates chunks until submit word or silence discard
  private transcriptBuffer: string[] = [];
  private hotMicBufferSegments: HotMicBufferSegment[] = [];
  private hotMicSessionStartMs: number = 0;
  private hotMicSessionItemIds: number[] = [];
  private hotMicScreenshotMetadata: HotMicScreenshotMeta[] = [];
  private bufferDiscardTimer: NodeJS.Timeout | null = null;
  private lastTimerResetMs: number = 0;
  private lastSpeechDetectedMs: number = 0;
  private readonly DEFAULT_BUFFER_DISCARD_MS = 4_000;
  private readonly MIN_HISTORY_WORDS = 6;
  private static readonly FIELD_THEORY_BUNDLE_IDS = new Set([
    'com.fieldtheory.app',
    'com.fieldtheory.experimental',
    'com.github.electron',
  ]);

  private escapeDismissHotkeyRegistered: boolean = false;
  private pendingEscapeDismiss: boolean = false;

  // Local HTTP server for hook triggers
  private server: http.Server | null = null;
  private static readonly HTTP_PORT = 19847;

  // Speech level threshold for orange dot (silence detection thresholds moved to Swift)
  private readonly SPEECH_LEVEL_THRESHOLD = 0.02;

  // Background voice filtering metrics (tracked per chunk).
  private chunkSampleCount: number = 0;
  private chunkSpeechSampleCount: number = 0;
  private chunkRawLevelSum: number = 0;
  private chunkSpeechLevelSum: number = 0;
  private chunkRawPeakLevel: number = 0;
  private chunkSpeechPeakLevel: number = 0;
  private lastFilterMeterEmitMs: number = 0;
  private readonly audioDiagnosticsVerbose: boolean = process.env.HOTMIC_AUDIO_DEBUG === 'true';
  private audioDiagWindowStartMs: number = 0;
  private audioDiagSampleCount: number = 0;
  private audioDiagSpeechCount: number = 0;
  private audioDiagLevelSum: number = 0;
  private audioDiagPeakLevel: number = 0;
  private lastAudioLevelEventMs: number = 0;
  private lastAudioNoEventWarnMs: number = 0;
  private lastSpeechMissWarnMs: number = 0;
  private lastFailureAlertAtMs: number = 0;
  private lastFailureAlertKey: string | null = null;
  private audioDiagnosticsTimer: NodeJS.Timeout | null = null;
  private currentHarvestMode: HarvestMode | null = null;

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
  private externalFallbackCheck: (() => boolean) | null = null;
  private engineStatusGetter: (() => HotMicEngineStatus) | null = null;

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
    this.muted = this.preferences.getPreference('hotMicMuted') ?? false;
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
      this.handleHotkeyToggle();
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
      await this.preferences.save({ hotMicHotkey: null });
      return true;
    }

    const result = hotkeyManager.register('hotMic', hotkey, () => {
      this.handleHotkeyToggle();
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

  private handleHotkeyToggle(): void {
    if (this.listenerCount('toggleInputModeRequested') > 0) {
      log.info('Hot Mic: hotkey pressed, requesting input mode toggle');
      this.emit('toggleInputModeRequested');
      return;
    }

    // Fallback when no input-mode delegate is wired.
    log.info('Hot Mic: hotkey pressed, toggling hot mic directly');
    if (this.isActive) {
      this.deactivate();
    } else {
      this.activate();
    }
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

  setClipboardManager(manager: HotMicClipboardBridge): void {
    this.clipboardManager = manager;
  }

  setFieldTheoryMarkdownInsertionTarget(target: FieldTheoryMarkdownInsertionTarget | null): void {
    this.fieldTheoryMarkdownInsertionTarget = target;
  }

  setCommandsManager(manager: CommandsManager): void {
    this.commandsManager = manager;
  }

  setDynamicIslandManager(manager: DynamicIslandManager): void {
    this.dynamicIslandManager = manager;
    this.syncDynamicIslandHotMicState();
  }

  setMetricsWordsRecorder(recorder: (wordCount: number) => void): void {
    this.metricsWordsRecorder = recorder;
  }

  setAudioManager(manager: AudioManager): void {
    this.audioManager = manager;
    manager.on('deviceEnforced', () => this.handleDeviceEnforced());
    manager.on('priorityDeviceUnavailable', () => this.handlePriorityDeviceUnavailable());
    log.info('Hot Mic: AudioManager wired for priority mic enforcement');
  }

  private async handleDeviceEnforced(): Promise<void> {
    if (this.state === 'idle' || !this.nativeHelper.isRecordingActive()) return;
    log.info('Hot Mic: restarting recording after device enforcement');
    try {
      await this.nativeHelper.stopRecording();
      await this.nativeHelper.startRecording();
    } catch (error) {
      log.error('Hot Mic: failed to restart recording after device enforcement:', error);
    }
  }

  private async handlePriorityDeviceUnavailable(): Promise<void> {
    if (this.state === 'idle' || this.muted || !this.nativeHelper.isRecordingActive()) return;

    const defaultInputId = this.audioManager?.getState().defaultInputId ?? null;
    log.warn('Hot Mic: priority input disappeared; restarting recording on current default input');

    try {
      await this.nativeHelper.stopRecording();
      if (!defaultInputId) {
        log.warn('Hot Mic: priority input disappeared and no fallback input is available; recording stopped');
        return;
      }
      await this.nativeHelper.startRecording();
    } catch (error) {
      log.error('Hot Mic: failed to recover after priority input disappeared:', error);
    }
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

  setFallbackCheckFunction(fn: () => boolean): void {
    this.externalFallbackCheck = fn;
  }

  setEngineStatusGetter(fn: () => HotMicEngineStatus): void {
    this.engineStatusGetter = fn;
    this.emitRuntimeStatus();
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

  addScreenshotToSession(itemId: number): void {
    if (!this.isActive || itemId <= 0) return;
    if (this.hotMicSessionItemIds.includes(itemId)) return;

    const item = this.getClipboardItem(itemId);
    if (!item || (item.type !== 'screenshot' && item.type !== 'image')) return;
    const itemCreatedAt = typeof item.createdAt === 'number' ? item.createdAt : null;
    // Ignore delayed screenshot callbacks from a prior draft that already
    // submitted/cleared. This prevents stale figures from leaking forward.
    if (
      itemCreatedAt !== null
      && itemCreatedAt < (this.hotMicSessionStartMs - HotMicManager.SCREENSHOT_SESSION_SKEW_GRACE_MS)
    ) {
      log.debug(
        'Hot Mic: ignoring stale screenshot callback item=%d createdAt=%d sessionStart=%d',
        itemId,
        itemCreatedAt,
        this.hotMicSessionStartMs
      );
      return;
    }
    this.hotMicSessionItemIds.push(itemId);

    const figureLabel = String(this.hotMicScreenshotMetadata.length + 1);
    const figureId = this.clipboardManager?.generateFigureId?.() ?? this.generateFallbackFigureId();
    const capturedAtMs = this.hotMicSessionStartMs > 0
      ? Math.max(0, Date.now() - this.hotMicSessionStartMs)
      : 0;

    this.hotMicScreenshotMetadata.push({
      itemId,
      figureLabel,
      figureId,
      capturedAtMs,
    });

    this.clipboardManager?.updateFigureLabel?.(itemId, figureLabel, figureId);
    // Screenshots join the same draft lifecycle as transcript text:
    // they should expire on the same inactivity timeout if not submitted.
    this.resetBufferDiscardTimer();
    this.emit('screenshotStackChanged', this.hotMicScreenshotMetadata.length);
  }

  getState(): HotMicState {
    return this.state;
  }

  getCondition(): HotMicCondition | null {
    return this.condition;
  }

  /**
   * Full observable runtime status. Gives the UI everything it needs
   * to show operational health beyond the coarse state enum.
   */
  getRuntimeStatus(): HotMicRuntimeStatus {
    const now = Date.now();
    const lastChunkAgeMs = this.lastChunkReadyMs > 0 ? now - this.lastChunkReadyMs : null;
    let engine: HotMicEngineStatus | null = null;
    if (this.engineStatusGetter) {
      try {
        engine = this.engineStatusGetter();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        engine = {
          selectedEngine: this.getConfiguredTranscriptionEngineForLogs(),
          source: 'global',
          whisperModel: null,
          readiness: 'disabled',
          detail: `Engine status unavailable: ${message}`,
          fallbackAvailable: false,
        };
      }
    }

    // Mic is healthy if we've received a chunk within the last 10 seconds
    // while in an active state — stale chunks suggest routing or VAD problems.
    const micHealthy = this.state === 'idle' || this.condition === 'yielded' || this.condition === 'muted'
      ? true
      : lastChunkAgeMs === null || lastChunkAgeMs < 10_000;

    return {
      state: this.state,
      condition: this.condition,
      engineReady: this.engineReady,
      whisperFallbackActive: this.whisperFallbackActive,
      queueDepth: this.pendingChunkQueue.length,
      lastChunkAgeMs,
      chunksReceived: this.chunksReceivedCount,
      micHealthy,
      engine,
      timing: {
        chunkIntervalMs: this.lastChunkIntervalMs === null ? null : Math.round(this.lastChunkIntervalMs),
        queueWaitMs: this.lastQueueWaitMs === null ? null : Math.round(this.lastQueueWaitMs),
        transcribeMs: this.lastTranscribeMs === null ? null : Math.round(this.lastTranscribeMs),
        postProcessMs: this.lastPostProcessMs === null ? null : Math.round(this.lastPostProcessMs),
        totalPipelineMs: this.lastTotalPipelineMs === null ? null : Math.round(this.lastTotalPipelineMs),
        avgTranscribeMs: this.avgTranscribeMs === null ? null : Math.round(this.avgTranscribeMs),
        avgTotalPipelineMs: this.avgTotalPipelineMs === null ? null : Math.round(this.avgTotalPipelineMs),
      },
    };
  }

  getStatus(): { state: HotMicState; muted: boolean } {
    return { state: this.state, muted: this.muted };
  }

  getMuted(): boolean {
    return this.muted;
  }

  get isActive(): boolean {
    return this.state !== 'idle';
  }

  getTargetBundleId(): string | null {
    return this.targetBundleId;
  }

  private getConfiguredTranscriptionEngineForLogs(): TranscriptionEngine {
    if (this.engineStatusGetter) {
      try {
        const selectedEngine = this.engineStatusGetter()?.selectedEngine;
        if (isTranscriptionEngine(selectedEngine)) {
          return selectedEngine;
        }
      } catch {
        // Fall through to raw preference lookup for logs only.
      }
    }

    const configured = this.preferences.getPreference('transcriptionEngine') as string | undefined;
    if (isTranscriptionEngine(configured)) {
      return configured;
    }
    return 'whisper';
  }

  /**
   * Resolve which app to type into. In always-on mode, uses the frontmost app.
   * In queue mode, uses the pre-set target bundle ID.
   */
  private getTypeTarget(): string | null {
    // Use whatever app is currently focused
    const frontmost = this.nativeHelper.getFrontmostApp();
    if (frontmost?.bundleId && !this.isFieldTheoryBundleId(frontmost.bundleId)) {
      log.debug('Hot Mic: typing into frontmost app: %s (%s)', frontmost.name, frontmost.bundleId);
      return frontmost.bundleId;
    }

    // Fall back to configured target
    log.debug('Hot Mic: falling back to configured target: %s', this.targetBundleId);
    return this.targetBundleId;
  }

  private isFieldTheoryBundleId(bundleId: string | null | undefined): boolean {
    return !!bundleId && HotMicManager.FIELD_THEORY_BUNDLE_IDS.has(bundleId.toLowerCase());
  }

  private getTextTarget(): HotMicTextTarget {
    const frontmost = this.nativeHelper.getFrontmostApp();
    if (frontmost?.bundleId && !this.isFieldTheoryBundleId(frontmost.bundleId)) {
      log.debug('Hot Mic: typing into frontmost app: %s (%s)', frontmost.name, frontmost.bundleId);
      return { kind: 'app', bundleId: frontmost.bundleId };
    }

    if (this.fieldTheoryMarkdownInsertionTarget?.isAvailable()) {
      log.debug('Hot Mic: typing into focused Field Theory markdown editor');
      return { kind: 'field-theory-markdown' };
    }

    if (this.targetBundleId) {
      log.debug('Hot Mic: falling back to configured target: %s', this.targetBundleId);
      return { kind: 'app', bundleId: this.targetBundleId };
    }

    log.debug('Hot Mic: no text target available');
    return { kind: 'none' };
  }

  private getBundleIdForTextTarget(target: HotMicTextTarget): string | null {
    return target.kind === 'app' ? target.bundleId : null;
  }

  private async insertTextIntoTarget(target: HotMicTextTarget, text: string, pressEnter: boolean): Promise<boolean> {
    if (target.kind === 'field-theory-markdown') {
      const textToInsert = pressEnter ? `${text}\n` : text;
      return this.fieldTheoryMarkdownInsertionTarget?.insertText(textToInsert) ?? false;
    }

    if (target.kind !== 'app') {
      return false;
    }

    const result = await this.typeIntoAppWithClipboardSync(target.bundleId, text, pressEnter);
    if (!result.success) {
      log.error('Hot Mic: typeIntoApp failed:', result.error);
      return false;
    }
    return true;
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
      // Restore hash state from real clipboard content if helper injection failed.
      clipboardManager?.syncClipboardHash?.();
    }
    return result;
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

    this.unregisterEscapeDismissHotkey();
    this.stopAudioMonitoring();
    this.stopBufferDiscardTimer();
    this.resumeInFlight = false;
    this.yieldedToTranscriber = false;

    if (!this.nativeHelper.isRecordingActive()) {
      log.info('Hot Mic: yield skipped (helper was not recording)');
      return;
    }

    await this.nativeHelper.cancelRecording().then(() => {
      this.yieldedToTranscriber = true;
      this.setCondition('yielded');
    }).catch((error) => {
      log.warn('Hot Mic: cancel during yield failed:', error);
    });

    this.updateOrangeDot();

    // Don't change state to idle — keep as listening so we know to resume.
    // The transcriber status getter will prevent us from restarting until it's done.
  }

  /**
   * Resume listening after the regular transcriber finishes.
   */
  async resumeAfterTranscriber(): Promise<void> {
    if (this.state !== 'listening') return;
    if (this.muted) return;
    if (this.resumeInFlight) return;
    if (!this.yieldedToTranscriber) return;

    // Verify the transcriber is actually done
    if (this.transcriberStatusGetter && this.transcriberStatusGetter() !== 'idle') {
      return;
    }

    this.resumeInFlight = true;
    log.info('Hot Mic: resuming after transcriber finished');

    // Retry with backoff — the audio device may not be immediately available
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (this.state !== 'listening' || this.muted) return;
        try {
          if (attempt > 0) {
            await new Promise(resolve => setTimeout(resolve, 300 * attempt));
            log.info('Hot Mic: resume attempt %d', attempt + 1);
          }
          if (this.nativeHelper.isRecordingActive()) {
            log.info('Hot Mic: resume skipped (helper already recording)');
            this.yieldedToTranscriber = false;
            this.setCondition(this.whisperFallbackActive ? 'degraded' : 'ready');
            this.startAudioMonitoring();
            this.registerEscapeDismissHotkey();
            return;
          }
          if (this.audioManager) {
            await this.audioManager.ensurePriorityEnforced();
          }
          this.setRealtimeHarvestMode();
          await this.nativeHelper.startRecording();
          this.yieldedToTranscriber = false;
          this.setCondition(this.whisperFallbackActive ? 'degraded' : 'ready');
          this.startAudioMonitoring();
          this.updateOrangeDot();
          this.registerEscapeDismissHotkey();
          return;
        } catch (error) {
          log.error('Hot Mic: failed to resume recording (attempt %d):', attempt + 1, error);
          if (this.nativeHelper.isRecordingActive()) {
            log.info('Hot Mic: resume recovered (helper already recording)');
            this.yieldedToTranscriber = false;
            this.setCondition(this.whisperFallbackActive ? 'degraded' : 'ready');
            this.startAudioMonitoring();
            this.registerEscapeDismissHotkey();
            return;
          }
          // Clear stale helper state if the previous stream never fully released.
          await this.nativeHelper.cancelRecording().catch(() => {});
        }
      }
      log.error('Hot Mic: giving up on resume after 3 attempts');
    } finally {
      this.resumeInFlight = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Mute/unmute — pause mic without deactivating
  // ---------------------------------------------------------------------------

  get isMuted(): boolean {
    return this.muted;
  }

  private async persistMutedPreference(): Promise<void> {
    await this.preferences.save({ hotMicMuted: this.muted } as any);
  }

  async toggleMute(): Promise<boolean> {
    if (!this.isActive) return false;

    if (this.muted) {
      // Unmute — resume recording.
      this.muted = false;
      this.setCondition(this.whisperFallbackActive ? 'degraded' : 'ready');
      await this.persistMutedPreference();
      log.info('Hot Mic: unmuted');
      try {
        if (this.audioManager) {
          await this.audioManager.ensurePriorityEnforced();
        }
        this.setRealtimeHarvestMode();
        await this.nativeHelper.startRecording();
        this.startAudioMonitoring();
      } catch (error) {
        log.error('Hot Mic: failed to unmute:', error);
      }
      this.syncDynamicIslandHotMicState();
      this.emit('statusChanged', this.getStatus());
      return false;
    } else {
      // Mute — stop recording but stay in listening state.
      this.muted = true;
      this.setCondition('muted');
      await this.persistMutedPreference();
      log.info('Hot Mic: muted');
      this.stopAudioMonitoring();
      this.stopBufferDiscardTimer();
      await this.nativeHelper.cancelRecording().catch(() => {});
      this.dynamicIslandManager?.updateDrawerTranscript('');
      this.clearDrawerSpeakingSignal();
      this.syncDynamicIslandHotMicState();
      this.emit('statusChanged', this.getStatus());
      return true;
    }
  }

  /**
   * Dismiss the current live transcript buffer without deactivating Hot Mic.
   * Triggered from Dynamic Island explicit "x" control.
   */
  dismissCurrentTranscript(): void {
    if (!this.isActive) return;

    if (this.transcriptBuffer.length > 0) {
      log.info('Hot Mic: dismissed live transcript buffer (%d chunks)', this.transcriptBuffer.length);
    }

    this.clearHotMicDraftContext(true);
    this.stopBufferDiscardTimer();
    this.lastTimerResetMs = 0;
    this.lastSpeechDetectedMs = 0;
    this.clearDrawerSpeakingSignal();
    this.dynamicIslandManager?.updateDrawerTranscript('');

    if (!this.muted) {
      this.setRealtimeHarvestMode();
    }
    this.updateOrangeDot();
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
    this.resetHotMicFigureSession();
    this.resumeInFlight = false;
    this.yieldedToTranscriber = false;
    this.whisperFallbackActive = false;
    this.chunksReceivedCount = 0;
    this.clearDrawerSpeakingSignal();
    this.setState('listening');
    this.syncDynamicIslandHotMicState();

    // Warm up transcription engine in parallel with recording start.
    // Store the promise so onChunkReady can await it before the first transcription,
    // preventing a race where a chunk arrives before the server is ready.
    const hasWarmup = !!this.externalWarmup;
    if (hasWarmup) {
      this.setCondition('warming');
      this.engineReady = false;
    }

    this.warmupPromise = this.externalWarmup
      ? this.externalWarmup().then(() => {
          this.engineReady = true;
          if (this.condition === 'warming') {
            this.setCondition('ready');
          }
        }).catch((err) => {
          // Keep chunk processing alive so engine-level fallback can still run.
          log.error('Hot Mic: warmup failed:', err);
          this.maybeShowTranscriptionFailure(err, 'warmup');
          this.engineReady = false;
          this.setCondition('degraded');
        })
      : null;

    if (!hasWarmup) {
      this.engineReady = true;
      this.setCondition('ready');
    }

    if (this.muted) {
      this.setCondition('muted');
      log.warn('Hot Mic: listening started while muted; audio capture is paused until unmuted');
      this.dynamicIslandManager?.updateDrawerTranscript('');
      return;
    }

    try {
      if (this.audioManager) {
        await this.audioManager.ensurePriorityEnforced();
      }
      this.setRealtimeHarvestMode();
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
    if (frontmost?.bundleId && !this.isFieldTheoryBundleId(frontmost.bundleId)) {
      this.targetBundleId = frontmost.bundleId;
    } else {
      this.targetBundleId = this.preferences.getPreference('hotMicTargetBundleId') || null;
    }

    const hasFieldTheoryMarkdownTarget = this.isFieldTheoryBundleId(frontmost?.bundleId)
      && (this.fieldTheoryMarkdownInsertionTarget?.isAvailable() ?? false);

    if (!this.targetBundleId && !hasFieldTheoryMarkdownTarget) {
      log.error('No target app for Hot Mic');
      this.cursorStatusManager?.showCriticalMessage('Hot Mic: No target app');
      return;
    }

    log.info('Hot Mic activated, target: %s', this.targetBundleId ?? 'field-theory-markdown');
    this.playSound('recordingStart');
    this.emit('activated', this.targetBundleId ?? 'field-theory-markdown');

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
    if (!this.isActive) return;
    if (this.shortPressInFlight) {
      // A flush is already running — queue one more so it fires after.
      this.shortPressPending = true;
      return;
    }
    this.shortPressInFlight = true;

    try {
      // Stop new chunks from arriving while we drain.
      this.stopForcedSnapshotLoop();
      if (this.chunkReadyListener) {
        this.nativeHelper.removeListener('recordingChunkReady', this.chunkReadyListener);
        this.chunkReadyListener = null;
      }

      // Snapshot the current recording — captures any buffered audio in Swift
      // without stopping the audio engine.
      try {
        const finalWav = await this.nativeHelper.snapshotRecording();
        if (finalWav) {
          this.enqueueChunkForTranscription(finalWav, this.captureChunkAudioStats(), Date.now());
        }
      } catch {
        // No active recording or very short audio — proceed with existing buffer.
      }

      // Wait for all pending transcriptions (including the snapshot) to complete
      // so their results land in transcriptBuffer before we flush.
      await this.waitForQueueDrain();

      if (this.transcriptBuffer.length > 0) {
        log.info('Hot Mic: flushing buffer via short press (%d chunks)', this.transcriptBuffer.length);
        const target = this.getTextTarget();
        let mappedText = await this.consumeBufferedHotMicPayload(this.getBundleIdForTextTarget(target));
        if (mappedText) {
          void this.storeHotMicTranscript(mappedText);
          if (target.kind !== 'none') {
            // Trailing space so the next dictation flows naturally.
            mappedText = mappedText + ' ';
            if (await this.insertTextIntoTarget(target, mappedText, false)) {
              this.playSound('paste');
            }
          }
        }
      }

      // Re-attach audio monitoring — engine is still recording, just
      // need to restore the chunk listener and forced snapshot loop.
      this.startAudioMonitoring();
    } finally {
      this.shortPressInFlight = false;
      if (this.shortPressPending && this.isActive) {
        this.shortPressPending = false;
        void this.handleShortPress();
      }
    }
  }

  handleLongPress(): void {
    this.deactivate();
    this.emit('inputModeResetRequested');
  }

  private registerEscapeDismissHotkey(): void {
    if (this.escapeDismissHotkeyRegistered) {
      return;
    }

    const registered = globalShortcut.register('Escape', () => {
      this.handleEscapeDismiss();
    });

    if (registered) {
      this.escapeDismissHotkeyRegistered = true;
    } else {
      log.warn('Hot Mic: failed to register Escape dismiss hotkey');
    }
  }

  private unregisterEscapeDismissHotkey(): void {
    if (!this.escapeDismissHotkeyRegistered) {
      this.pendingEscapeDismiss = false;
      return;
    }

    globalShortcut.unregister('Escape');
    this.escapeDismissHotkeyRegistered = false;
    this.pendingEscapeDismiss = false;
  }

  private handleEscapeDismiss(): void {
    if (!this.isActive || this.yieldedToTranscriber) {
      return;
    }

    if (!this.pendingEscapeDismiss) {
      this.pendingEscapeDismiss = true;
      this.cursorStatusManager?.showRecordingNote('Press Esc again to stop Hot Mic');
      return;
    }

    this.pendingEscapeDismiss = false;
    this.handleLongPress();
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
      this.setRealtimeHarvestMode();
      await this.nativeHelper.startRecording();
    } catch (error) {
      log.error('Failed to start recording for Hot Mic:', error);
      this.deactivate();
      return;
    }

    this.startAudioMonitoring();
  }

  private getBackgroundFilterEnabled(): boolean {
    return this.preferences.getPreference('hotMicBackgroundFilterEnabled') === true;
  }

  private getBackgroundFilterStrength(): number {
    const value = this.preferences.getPreference('hotMicBackgroundFilterStrength');
    if (typeof value !== 'number' || Number.isNaN(value)) return 4;
    return Math.max(0, Math.min(100, Math.round(value)));
  }

  private getBackgroundFilterThreshold(strength: number): number {
    const normalized = Math.max(0, Math.min(100, strength)) / 100;
    // Keep low strictness permissive for near-field voices, while allowing
    // high strictness to clamp far-field noise.
    return HotMicManager.BACKGROUND_FILTER_THRESHOLD_BASE
      + normalized * HotMicManager.BACKGROUND_FILTER_THRESHOLD_SPAN;
  }

  private getBackgroundFilterGate(strength: number): BackgroundFilterGate {
    const normalized = Math.max(0, Math.min(100, strength)) / 100;
    const threshold = this.getBackgroundFilterThreshold(strength);
    return {
      threshold,
      ratioThreshold:
        HotMicManager.BACKGROUND_FILTER_RATIO_BASE
        + (normalized * HotMicManager.BACKGROUND_FILTER_RATIO_SPAN),
      minSpeechSamples:
        HotMicManager.BACKGROUND_FILTER_MIN_SPEECH_BASE
        + Math.round(normalized * HotMicManager.BACKGROUND_FILTER_MIN_SPEECH_SPAN),
      peakThreshold:
        threshold
        * (
          HotMicManager.BACKGROUND_FILTER_PEAK_MULTIPLIER_BASE
          + normalized * HotMicManager.BACKGROUND_FILTER_PEAK_MULTIPLIER_SPAN
        ),
      nearFieldPeakThreshold:
        threshold * HotMicManager.BACKGROUND_FILTER_NEAR_FIELD_MULTIPLIER,
    };
  }

  private getEngineSilenceMs(): number | undefined {
    const engine = this.getConfiguredTranscriptionEngineForLogs();
    if (isParakeetEngine(engine)) return 0;
    return undefined;
  }

  private setRealtimeHarvestMode(): void {
    const nextMode = this.getPreferredHarvestMode();
    const silenceMs = this.getEngineSilenceMs();
    if (this.currentHarvestMode === nextMode) {
      return;
    }
    this.currentHarvestMode = nextMode;
    this.nativeHelper.setHarvestMode(nextMode, silenceMs);
    log.debug(
      'Hot Mic: harvest mode -> %s (engine=%s, queue=%d)',
      nextMode,
      this.getConfiguredTranscriptionEngineForLogs(),
      this.getTranscriptionPressureDepth()
    );
  }

  private getPreferredHarvestMode(): HarvestMode {
    const queueDepth = this.getTranscriptionPressureDepth();
    // Fast path: keep chunks short for responsiveness while healthy.
    // Backpressure path: switch to longer chunks to reduce producer rate.
    if (queueDepth === 0) {
      return 'dictation';
    }

    const engine = this.getConfiguredTranscriptionEngineForLogs();
    if (engine === 'mlx-whisper' && queueDepth > 0) {
      return 'command';
    }

    if (queueDepth >= HotMicManager.HARVEST_BACKPRESSURE_QUEUE_THRESHOLD) {
      return 'command';
    }

    return 'dictation';
  }

  private getTranscriptionPressureDepth(): number {
    return this.pendingChunkQueue.length + (this.chunkProcessingInFlight ? 1 : 0);
  }

  private updateTimingEma(previous: number | null, sample: number): number {
    if (!Number.isFinite(sample)) {
      return previous ?? 0;
    }
    if (previous === null) {
      return sample;
    }
    const alpha = HotMicManager.TIMING_EMA_ALPHA;
    return (previous * (1 - alpha)) + (sample * alpha);
  }

  private recordChunkTiming(timing: {
    queueWaitMs: number | null;
    transcribeMs: number | null;
    postProcessMs: number | null;
    totalPipelineMs: number | null;
  }): void {
    this.lastQueueWaitMs = timing.queueWaitMs;
    this.lastTranscribeMs = timing.transcribeMs;
    this.lastPostProcessMs = timing.postProcessMs;
    this.lastTotalPipelineMs = timing.totalPipelineMs;

    if (typeof timing.transcribeMs === 'number' && Number.isFinite(timing.transcribeMs)) {
      this.avgTranscribeMs = this.updateTimingEma(this.avgTranscribeMs, timing.transcribeMs);
    }
    if (typeof timing.totalPipelineMs === 'number' && Number.isFinite(timing.totalPipelineMs)) {
      this.avgTotalPipelineMs = this.updateTimingEma(this.avgTotalPipelineMs, timing.totalPipelineMs);
    }
  }

  private formatTimingMs(value: number | null): string {
    if (value === null || !Number.isFinite(value)) return '--';
    return `${Math.max(0, Math.round(value))}`;
  }

  private registerChunkReadyAt(nowMs: number): void {
    if (this.lastChunkReadyMs > 0) {
      this.lastChunkIntervalMs = Math.max(0, nowMs - this.lastChunkReadyMs);
    } else {
      this.lastChunkIntervalMs = null;
    }
    this.lastChunkReadyMs = nowMs;
  }

  private resetChunkAudioStats(): void {
    this.chunkSampleCount = 0;
    this.chunkSpeechSampleCount = 0;
    this.chunkRawLevelSum = 0;
    this.chunkSpeechLevelSum = 0;
    this.chunkRawPeakLevel = 0;
    this.chunkSpeechPeakLevel = 0;
  }

  private captureChunkAudioStats(): ChunkAudioStats {
    const sampleCount = this.chunkSampleCount;
    const speechSamples = this.chunkSpeechSampleCount;
    const stats: ChunkAudioStats = {
      sampleCount,
      speechSamples,
      speechRatio: sampleCount > 0 ? speechSamples / sampleCount : 0,
      rawAverage: sampleCount > 0 ? this.chunkRawLevelSum / sampleCount : 0,
      speechAverage: speechSamples > 0 ? this.chunkSpeechLevelSum / speechSamples : 0,
      rawPeak: this.chunkRawPeakLevel,
      speechPeak: this.chunkSpeechPeakLevel,
    };
    this.resetChunkAudioStats();
    return stats;
  }

  private publishBackgroundFilterMeter(
    rawLevel: number,
    acceptedLevel: number,
    speechRatio: number,
    chunkSuppressed: boolean,
  ): void {
    const strength = this.getBackgroundFilterStrength();
    const payload: HotMicBackgroundFilterMeter = {
      enabled: this.getBackgroundFilterEnabled(),
      strength,
      rawLevel: Math.max(0, Math.min(1, rawLevel)),
      acceptedLevel: Math.max(0, Math.min(1, acceptedLevel)),
      threshold: this.getBackgroundFilterThreshold(strength),
      speechRatio: Math.max(0, Math.min(1, speechRatio)),
      chunkSuppressed,
    };
    this.dynamicIslandManager?.updateHotMicBackgroundFilterMeter?.(payload);
  }

  private maybePublishLiveBackgroundFilterMeter(level: number, isSpeech: boolean): void {
    const now = Date.now();
    if (now - this.lastFilterMeterEmitMs < HotMicManager.FILTER_METER_UPDATE_MS) return;
    this.lastFilterMeterEmitMs = now;

    const strength = this.getBackgroundFilterStrength();
    const threshold = this.getBackgroundFilterThreshold(strength);
    const acceptedLevel = isSpeech && level >= threshold
      ? (level - threshold) / Math.max(1e-6, (1 - threshold))
      : 0;
    this.publishBackgroundFilterMeter(level, acceptedLevel, isSpeech ? 1 : 0, false);
  }

  private shouldWarnForSpeechMiss(peakLevel: number, avgLevel: number, speechRatio: number): boolean {
    return peakLevel >= 0.018 && avgLevel >= 0.006 && speechRatio < 0.03;
  }

  private resetAudioDiagnosticsWindow(now: number = Date.now()): void {
    this.audioDiagWindowStartMs = now;
    this.audioDiagSampleCount = 0;
    this.audioDiagSpeechCount = 0;
    this.audioDiagLevelSum = 0;
    this.audioDiagPeakLevel = 0;
  }

  private trackAudioDiagnostics(level: number, isSpeech: boolean): void {
    const now = Date.now();
    if (this.audioDiagWindowStartMs <= 0) {
      this.resetAudioDiagnosticsWindow(now);
    }

    this.lastAudioLevelEventMs = now;
    this.audioDiagSampleCount += 1;
    if (isSpeech) this.audioDiagSpeechCount += 1;
    this.audioDiagLevelSum += level;
    if (level > this.audioDiagPeakLevel) {
      this.audioDiagPeakLevel = level;
    }

    const elapsed = now - this.audioDiagWindowStartMs;
    if (elapsed < HotMicManager.AUDIO_DIAG_WINDOW_MS) return;

    const avgLevel = this.audioDiagSampleCount > 0
      ? this.audioDiagLevelSum / this.audioDiagSampleCount
      : 0;
    const speechRatio = this.audioDiagSampleCount > 0
      ? this.audioDiagSpeechCount / this.audioDiagSampleCount
      : 0;
    const shouldWarn = this.shouldWarnForSpeechMiss(this.audioDiagPeakLevel, avgLevel, speechRatio);

    if (shouldWarn && (now - this.lastSpeechMissWarnMs) >= HotMicManager.AUDIO_DIAG_WARN_COOLDOWN_MS) {
      this.lastSpeechMissWarnMs = now;
      log.warn(
        'Hot Mic: mic energy seen but speech detection stayed low (avg=%.3f peak=%.3f speechRatio=%.2f). Check mic routing or VAD sensitivity.',
        avgLevel,
        this.audioDiagPeakLevel,
        speechRatio,
      );
      this.logAudioRouteSnapshot();
    } else if (this.audioDiagnosticsVerbose) {
      log.info(
        'Hot Mic: audio window stats (avg=%.3f peak=%.3f speechRatio=%.2f samples=%d)',
        avgLevel,
        this.audioDiagPeakLevel,
        speechRatio,
        this.audioDiagSampleCount,
      );
    }

    this.resetAudioDiagnosticsWindow(now);
  }

  private startAudioDiagnosticsTimer(): void {
    this.stopAudioDiagnosticsTimer();
    this.lastAudioNoEventWarnMs = 0;
    this.audioDiagnosticsTimer = setInterval(() => {
      if (this.state !== 'recording' && this.state !== 'listening') return;
      if (this.muted) return;
      if (!this.nativeHelper.isRecordingActive()) return;

      const now = Date.now();
      if (this.lastAudioLevelEventMs <= 0) return;
      if ((now - this.lastAudioLevelEventMs) < HotMicManager.AUDIO_DIAG_NO_EVENT_WARN_MS) return;
      if ((now - this.lastAudioNoEventWarnMs) < HotMicManager.AUDIO_DIAG_WARN_COOLDOWN_MS) return;

      this.lastAudioNoEventWarnMs = now;
      log.warn(
        'Hot Mic: no audioLevel events for %dms while recording is active. Check helper stream and selected input.',
        now - this.lastAudioLevelEventMs,
      );
      this.logAudioRouteSnapshot();
    }, 1000);
  }

  private stopAudioDiagnosticsTimer(): void {
    if (this.audioDiagnosticsTimer) {
      clearInterval(this.audioDiagnosticsTimer);
      this.audioDiagnosticsTimer = null;
    }
  }

  private logAudioRouteSnapshot(): void {
    if (!this.audioManager) return;

    const state = this.audioManager.getState();
    const devices = Array.isArray(state.devices) ? state.devices : [];
    const defaultDevice = devices.find((device) => device.id === state.defaultInputId);
    const priorityDevice = devices.find((device) => device.id === state.priorityDeviceId);
    const defaultLabel = defaultDevice?.name ?? state.defaultInputId ?? 'none';
    const priorityLabel = priorityDevice?.name ?? state.priorityDeviceId ?? 'none';

    if (!state.defaultInputId) {
      log.warn(
        'Hot Mic: no default input device reported (priorityMode=%s priority=%s)',
        state.priorityMode,
        priorityLabel,
      );
      return;
    }

    if (state.priorityMode && state.priorityDeviceId && state.defaultInputId !== state.priorityDeviceId) {
      log.warn(
        'Hot Mic: default input differs from priority device (default=%s priority=%s)',
        defaultLabel,
        priorityLabel,
      );
      return;
    }

    if (this.audioDiagnosticsVerbose) {
      log.info(
        'Hot Mic: audio route snapshot (default=%s priorityMode=%s priority=%s)',
        defaultLabel,
        state.priorityMode,
        priorityLabel,
      );
    }
  }

  private maybeShowTranscriptionFailure(
    error: unknown,
    context: 'warmup' | 'chunk' = 'chunk'
  ): void {
    const rawMessage = error instanceof Error ? error.message : String(error);
    const normalized = rawMessage.replace(/\s+/g, ' ').trim();
    if (!normalized) return;

    const now = Date.now();
    const alertKey = `${context}:${normalized}`;
    if (
      this.lastFailureAlertKey === alertKey &&
      (now - this.lastFailureAlertAtMs) < HotMicManager.FAILURE_ALERT_COOLDOWN_MS
    ) {
      return;
    }

    this.lastFailureAlertAtMs = now;
    this.lastFailureAlertKey = alertKey;

    let userMessage = 'Hot Mic: transcription failed';
    if (/startup timed out/i.test(normalized)) {
      userMessage = 'Hot Mic: transcription engine startup timed out';
    } else if (context === 'warmup') {
      userMessage = 'Hot Mic: primary transcription engine failed to start';
    } else if (/timed out/i.test(normalized)) {
      userMessage = 'Hot Mic: transcription timed out';
    }

    this.cursorStatusManager?.showCriticalMessage(userMessage);
  }

  private evaluateChunkBackgroundFilter(stats: ChunkAudioStats): {
    suppressed: boolean;
    acceptedLevel: number;
    speechRatio: number;
  } {
    const enabled = this.getBackgroundFilterEnabled();
    if (!enabled) {
      return {
        suppressed: false,
        acceptedLevel: stats.rawAverage,
        speechRatio: stats.speechRatio,
      };
    }

    if (stats.sampleCount === 0) {
      return {
        suppressed: true,
        acceptedLevel: 0,
        speechRatio: 0,
      };
    }

    const strength = this.getBackgroundFilterStrength();
    const gate = this.getBackgroundFilterGate(strength);

    const hasEnoughSpeechFrames = stats.speechSamples >= gate.minSpeechSamples;
    const hasSustainedSpeech = stats.speechRatio >= gate.ratioThreshold;
    const hasEnergy = stats.speechAverage >= gate.threshold || stats.speechPeak >= gate.peakThreshold;
    const hasNearFieldPeak = stats.speechPeak >= gate.nearFieldPeakThreshold;
    const accepted = hasEnergy && (hasSustainedSpeech || (hasEnoughSpeechFrames && hasNearFieldPeak));
    const normalizedAcceptedLevel = accepted
      ? Math.max(0, (stats.speechAverage - gate.threshold) / Math.max(1e-6, (1 - gate.threshold)))
      : 0;

    return {
      suppressed: !accepted,
      acceptedLevel: normalizedAcceptedLevel,
      speechRatio: stats.speechRatio,
    };
  }

  private trackChunkAudioLevel(level: number, isSpeech: boolean): void {
    const boundedLevel = Math.max(0, Math.min(1, level));

    this.chunkSampleCount += 1;
    this.chunkRawLevelSum += boundedLevel;
    if (boundedLevel > this.chunkRawPeakLevel) {
      this.chunkRawPeakLevel = boundedLevel;
    }

    if (isSpeech) {
      this.chunkSpeechSampleCount += 1;
      this.chunkSpeechLevelSum += boundedLevel;
      if (boundedLevel > this.chunkSpeechPeakLevel) {
        this.chunkSpeechPeakLevel = boundedLevel;
      }
    }

    this.maybePublishLiveBackgroundFilterMeter(boundedLevel, isSpeech);
  }

  private startAudioMonitoring(): void {
    this.stopAudioMonitoring();
    this.registerChunkReadyAt(Date.now());
    this.lastFilterMeterEmitMs = 0;
    this.lastAudioLevelEventMs = 0;
    this.resetAudioDiagnosticsWindow(this.lastChunkReadyMs);
    this.lastQueueWaitMs = null;
    this.lastTranscribeMs = null;
    this.lastPostProcessMs = null;
    this.lastTotalPipelineMs = null;
    this.avgTranscribeMs = null;
    this.avgTotalPipelineMs = null;
    this.logAudioRouteSnapshot();
    this.resetChunkAudioStats();
    this.publishBackgroundFilterMeter(0, 0, 0, false);

    // Audio level listener — UI (orange dot) and buffer discard timer.
    // Timer resets on continued speech (throttled) and on transcription chunks.
    this.audioLevelListener = (level: number, isSpeech: boolean) => {
      if (this.state !== 'recording' && this.state !== 'listening') return;
      this.trackChunkAudioLevel(level, isSpeech);
      this.trackAudioDiagnostics(level, isSpeech);

      if (isSpeech) {
        this.bumpDrawerSpeakingSignal();
        // Show orange dot immediately on speech detection (don't wait for transcription).
        // Also start a one-shot discard timer so the dot has a guaranteed minimum
        // lifespan — hallucination chunks won't cut it short.
        if (!this.hasSpeechSinceLastHarvest && this.state === 'listening') {
          log.debug(`Hot Mic: [dot] preemptive show (speech detected, level=${level.toFixed(3)})`);
          this.dynamicIslandManager?.updateHotMic(true, 0, '');
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
      const now = Date.now();
      this.registerChunkReadyAt(now);
      this.enqueueChunkForTranscription(filePath, this.captureChunkAudioStats(), now);
    };

    this.nativeHelper.on('audioLevel', this.audioLevelListener);
    this.nativeHelper.on('recordingChunkReady', this.chunkReadyListener);
    this.startAudioDiagnosticsTimer();
    this.startForcedSnapshotLoop();
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
    this.stopAudioDiagnosticsTimer();
    this.stopForcedSnapshotLoop();
    this.forcedSnapshotInFlight = false;
    this.currentHarvestMode = null;
    this.resetChunkAudioStats();
    this.publishBackgroundFilterMeter(0, 0, 0, false);
  }

  private setDrawerSpeakingSignal(speaking: boolean): void {
    if (this.drawerSpeaking === speaking) return;
    this.drawerSpeaking = speaking;
    this.dynamicIslandManager?.updateDrawerSpeaking(speaking);
  }

  private bumpDrawerSpeakingSignal(): void {
    this.setDrawerSpeakingSignal(true);

    if (this.drawerSpeakingTimeout) {
      clearTimeout(this.drawerSpeakingTimeout);
    }

    this.drawerSpeakingTimeout = setTimeout(() => {
      this.drawerSpeakingTimeout = null;
      this.setDrawerSpeakingSignal(false);
    }, HotMicManager.DRAWER_SPEAKING_HOLD_MS);
  }

  private clearDrawerSpeakingSignal(): void {
    if (this.drawerSpeakingTimeout) {
      clearTimeout(this.drawerSpeakingTimeout);
      this.drawerSpeakingTimeout = null;
    }
    this.setDrawerSpeakingSignal(false);
  }

  private enqueueChunkForTranscription(filePath: string, audioStats: ChunkAudioStats, readyAtMs: number = Date.now()): void {
    this.chunksReceivedCount++;

    // Backpressure: if the queue is at capacity, drop the oldest chunk
    // to prevent unbounded growth when transcription stalls.
    while (this.pendingChunkQueue.length >= HotMicManager.MAX_CHUNK_QUEUE_DEPTH) {
      const dropped = this.pendingChunkQueue.shift();
      if (dropped) {
        log.warn(
          'Hot Mic: chunk queue full (%d), dropping oldest chunk: %s (engine=%s ready=%s lastQueue=%sms avgAsr=%sms avgTotal=%sms)',
          HotMicManager.MAX_CHUNK_QUEUE_DEPTH,
          dropped.filePath,
          this.getConfiguredTranscriptionEngineForLogs(),
          this.engineReady,
          this.formatTimingMs(this.lastQueueWaitMs),
          this.formatTimingMs(this.avgTranscribeMs),
          this.formatTimingMs(this.avgTotalPipelineMs),
        );
        void fs.promises.unlink(dropped.filePath).catch(() => {});
      }
    }

    this.pendingChunkQueue.push({
      filePath,
      audioStats,
      readyAtMs,
      enqueuedAtMs: Date.now(),
    });
    this.setRealtimeHarvestMode();
    this.emitRuntimeStatus();
    void this.drainChunkQueue();
  }

  private async drainChunkQueue(): Promise<void> {
    if (this.chunkProcessingInFlight) return;
    this.chunkProcessingInFlight = true;

    try {
      while (this.pendingChunkQueue.length > 0) {
        const chunk = this.pendingChunkQueue.shift();
        if (!chunk) continue;
        await this.onChunkReady(chunk);
      }
    } finally {
      this.chunkProcessingInFlight = false;
      this.setRealtimeHarvestMode();
    }
  }

  private waitForQueueDrain(timeoutMs: number = 10000): Promise<void> {
    if (!this.chunkProcessingInFlight && this.pendingChunkQueue.length === 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const start = Date.now();
      const check = () => {
        if (!this.chunkProcessingInFlight && this.pendingChunkQueue.length === 0) {
          resolve();
          return;
        }
        if (Date.now() - start > timeoutMs) {
          log.warn('Hot Mic: queue drain timed out after %dms', timeoutMs);
          resolve();
          return;
        }
        setTimeout(check, 50);
      };
      setTimeout(check, 50);
    });
  }

  private startForcedSnapshotLoop(): void {
    this.stopForcedSnapshotLoop();
    if (!HotMicManager.ENABLE_FORCED_SNAPSHOT_FALLBACK) return;

    this.forcedSnapshotTimer = setInterval(() => {
      void this.maybeForceSnapshotForContinuousSpeech();
    }, HotMicManager.FORCE_SNAPSHOT_CHECK_MS);
  }

  private stopForcedSnapshotLoop(): void {
    if (this.forcedSnapshotTimer) {
      clearInterval(this.forcedSnapshotTimer);
      this.forcedSnapshotTimer = null;
    }
  }

  private getForcedSnapshotMaxMs(): number {
    const pressureDepth = this.getTranscriptionPressureDepth();
    if (pressureDepth > 0) {
      return HotMicManager.FORCE_SNAPSHOT_BACKPRESSURE_MS;
    }

    const engine = this.getConfiguredTranscriptionEngineForLogs();
    if (engine === 'mlx-whisper') {
      return HotMicManager.FORCE_SNAPSHOT_MLX_MS;
    }

    return HotMicManager.FORCE_SNAPSHOT_COMMAND_MS;
  }

  private async maybeForceSnapshotForContinuousSpeech(): Promise<void> {
    if (!HotMicManager.ENABLE_FORCED_SNAPSHOT_FALLBACK) return;
    if (this.forcedSnapshotInFlight) return;
    if (this.state !== 'recording' && this.state !== 'listening') return;
    if (this.muted) return;
    if (!this.hasSpeechSinceLastHarvest) return;
    if (this.chunkProcessingInFlight || this.pendingChunkQueue.length > 0) return;
    if (this.lastSpeechDetectedMs <= 0) return;

    const now = Date.now();
    const sinceSpeechMs = now - this.lastSpeechDetectedMs;
    if (sinceSpeechMs > HotMicManager.FORCE_SNAPSHOT_SPEECH_GRACE_MS) return;

    const maxChunkMs = this.getForcedSnapshotMaxMs();
    const sinceChunkMs = now - this.lastChunkReadyMs;
    if (sinceChunkMs < maxChunkMs) return;

    this.forcedSnapshotInFlight = true;
    try {
      const wavPath = await this.nativeHelper.snapshotRecording();
      const readyAtMs = Date.now();
      this.registerChunkReadyAt(readyAtMs);
      log.debug('Hot Mic: forced snapshot during continuous speech (%dms since last chunk)', sinceChunkMs);
      this.enqueueChunkForTranscription(wavPath, this.captureChunkAudioStats(), readyAtMs);
    } catch (error) {
      log.debug('Hot Mic: forced snapshot skipped/failed:', error);
    } finally {
      this.forcedSnapshotInFlight = false;
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
          const hadScreenshots = this.hotMicScreenshotMetadata.length > 0;
          if (hadContent) {
            const discardedText = this.transcriptBuffer.join(' ');
            void this.storeHotMicTranscript(discardedText);
            log.info('Hot Mic: silence timeout, discarding buffer (%d chunks)', this.transcriptBuffer.length);
          }
          if (hadContent || hadScreenshots) {
            if (!hadContent && hadScreenshots) {
              log.info(
                'Hot Mic: silence timeout, discarding draft screenshots (%d items)',
                this.hotMicScreenshotMetadata.length
              );
            }
            this.clearHotMicDraftContext(true);
          }
          this.clearDrawerSpeakingSignal();
          this.dynamicIslandManager?.updateDrawerTranscript('');
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
  // Chunk ready — Swift detected silence and auto-snapshotted
  // ---------------------------------------------------------------------------

  private async onChunkReady(chunk: PendingChunk): Promise<void> {
    const wavPath = chunk.filePath;

    if (!this.isActive) {
      await fs.promises.unlink(wavPath).catch(() => {});
      return;
    }

    const processingStartedAt = performance.now();
    const enqueuedAtMs = Number.isFinite(chunk.enqueuedAtMs) ? chunk.enqueuedAtMs : Date.now();
    const readyAtMs = Number.isFinite(chunk.readyAtMs) ? chunk.readyAtMs : enqueuedAtMs;
    const queueWaitMs = Math.max(0, Date.now() - enqueuedAtMs);
    let transcribeMs: number | null = null;
    let postProcessStartedAt: number | null = null;

    try {
      const filterResult = this.evaluateChunkBackgroundFilter(chunk.audioStats);
      this.publishBackgroundFilterMeter(
        chunk.audioStats.rawAverage,
        filterResult.acceptedLevel,
        filterResult.speechRatio,
        filterResult.suppressed,
      );

      if (filterResult.suppressed) {
        log.info(
          'Hot Mic: suppressed background chunk (speechRatio=%.3f, speechAvg=%.3f, speechPeak=%.3f)',
          chunk.audioStats.speechRatio,
          chunk.audioStats.speechAverage,
          chunk.audioStats.speechPeak,
        );
        await fs.promises.unlink(wavPath).catch(() => {});
        this.setRealtimeHarvestMode();
        return;
      }

      log.info('Hot Mic: chunk ready from Swift, transcribing');
      this.hasSpeechSinceLastHarvest = false;
      this.lastTimerResetMs = 0;
      // Don't reset lastSpeechDetectedMs — it tracks real audio activity
      // and is used by the timer callback to survive natural pauses.

      // Wait for warmup to complete before first transcription so the first
      // chunk does not outrun the runtime startup sequence.
      if (this.warmupPromise) {
        await this.warmupPromise;
        this.warmupPromise = null;
      }

      // Transcribe the completed chunk — audio monitoring stays active
      const transcribeStartedAt = performance.now();
      const rawTranscript = (await this.transcribe(wavPath)).trim();
      transcribeMs = Math.max(0, performance.now() - transcribeStartedAt);

      // Check if this transcription used Whisper fallback and update condition.
      const usedFallback = this.externalFallbackCheck?.() ?? false;
      if (usedFallback && !this.whisperFallbackActive) {
        this.whisperFallbackActive = true;
        this.setCondition('degraded');
      }

      logTranscriptPayload('Hot Mic: raw transcript', rawTranscript);
      // Detect snap gesture before stripping parentheticals
      const hasSnap = /\(snap\)/i.test(rawTranscript);
      const transcript = this.sanitizeTranscriptText(rawTranscript);
      log.info(
        'Hot Mic: [timing] transcribe: %dms (engine=%s)',
        Math.round(transcribeMs),
        this.getConfiguredTranscriptionEngineForLogs()
      );

      // Clean up WAV file
      await fs.promises.unlink(wavPath).catch(() => {});

      if (!this.isActive) return;

      postProcessStartedAt = performance.now();

      // Handle snap gesture — toggle hide/show all apps
      if (hasSnap) {
        log.info('Hot Mic: snap detected, toggling app visibility');
        await this.toggleAppVisibility();
        this.playSound('paste');
        this.updateOrangeDot();
        this.setRealtimeHarvestMode();
        // If the snap was the only content, skip normal processing
        if (!transcript || this.getHallucinationReason(transcript)) return;
      }

      const hallucinationReason = this.getHallucinationReason(transcript);
      if (hallucinationReason) {
        log.info('Hot Mic: skipping hallucinated/empty chunk (%s)', hallucinationReason);
        // Don't call updateOrangeDot() here — the dot may have been shown
        // preemptively on speech detection, and the buffer discard timer
        // (started on first audio detection) guarantees it will be cleaned up.
        // Hiding immediately would make the island disappear before the 4s window.
        this.setRealtimeHarvestMode();
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
      this.setRealtimeHarvestMode();
    } catch (error) {
      log.error('Hot Mic chunk error:', error);
      this.maybeShowTranscriptionFailure(error, 'chunk');
      // A transcription failure that wasn't caught by fallback means degraded state.
      if (!this.whisperFallbackActive) {
        this.setCondition('degraded');
      }
      // Sync orange dot — a failed transcription should not leave the dot lingering
      this.updateOrangeDot();
    } finally {
      const processingDurationMs = Math.max(0, performance.now() - processingStartedAt);
      const totalPipelineMs = queueWaitMs + processingDurationMs;
      const postProcessMs = postProcessStartedAt === null
        ? null
        : Math.max(0, performance.now() - postProcessStartedAt);
      const totalAgeMs = Math.max(0, Date.now() - readyAtMs);
      this.recordChunkTiming({
        queueWaitMs,
        transcribeMs,
        postProcessMs,
        totalPipelineMs,
      });
      log.info(
        'Hot Mic: [timing] pipeline: cad=%sms queue=%sms asr=%sms post=%sms total=%sms age=%sms q=%d',
        this.formatTimingMs(this.lastChunkIntervalMs),
        this.formatTimingMs(queueWaitMs),
        this.formatTimingMs(transcribeMs),
        this.formatTimingMs(postProcessMs),
        this.formatTimingMs(totalPipelineMs),
        this.formatTimingMs(totalAgeMs),
        this.getTranscriptionPressureDepth(),
      );
      this.emitRuntimeStatus();
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
    const sanitizedTranscript = this.sanitizeTranscriptText(transcript);
    if (!sanitizedTranscript) {
      return;
    }
    const trimmed = this.applyWordSubstitutions(sanitizedTranscript.trim());
    const hallucinationReason = this.getHallucinationReason(trimmed);
    if (hallucinationReason) {
      log.info('Hot Mic: skipping hallucinated/empty chunk (%s)', hallucinationReason);
      return;
    }
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
          this.clearHotMicDraftUi(true);
        }
        this.dynamicIslandManager?.updateDrawerTranscript('');
        log.info('Hot Mic: auto-submitting shortcut "%s" → "%s"', lower, mapped);
        const result = await this.typeIntoAppWithClipboardSync(target, mapped, true);
        if (result.success) {
          this.playSound('paste');
        }
      }
      return;
    }

    // Unified tail-match: navigation, system, squares, app switch, start claude/codex, restart server
    const cmdStart = performance.now();
    const tailMatch = await this.matchTailCommand(lower);
    const cmdMs = Math.round(performance.now() - cmdStart);
    if (tailMatch) {
      if (tailMatch.remainingText.trim()) {
        const normalizedRemaining = this.pushNormalizedTextToBuffer(tailMatch.remainingText);
        if (normalizedRemaining) {
          logTranscriptPayload('Hot Mic: buffered text before command', normalizedRemaining);
        }
      }

      // If there's buffered text, flush it before executing the command.
      // Without this, text dictated before a mid-dictation command (e.g. "leave full screen")
      // would sit in the buffer and eventually be discarded by the silence timeout.
      // Cancel-type commands discard the buffer instead (user intent is to abort).
      const isCancel = tailMatch.commandName === 'cancel';
      const isScrap = tailMatch.commandName === 'scrap';
      if (this.transcriptBuffer.length > 0) {
        if (isCancel || isScrap) {
          log.info(
            'Hot Mic: discarding buffer (%d chunks) for %s command',
            this.transcriptBuffer.length,
            isScrap ? 'scrap' : 'cancel'
          );
          this.clearHotMicDraftUi(true);
        } else {
          const target = this.getTextTarget();
          const mappedText = await this.consumeBufferedHotMicPayload(this.getBundleIdForTextTarget(target));
          if (mappedText) {
            void this.storeHotMicTranscript(mappedText);
            if (target.kind !== 'none') {
              log.info('Hot Mic: flushing buffer before command (%d chars)', mappedText.length);
              if (LOG_TRANSCRIPT_PAYLOADS) {
                log.debug('Hot Mic: flushing buffer payload: "%s"', mappedText);
              }
              await this.insertTextIntoTarget(target, mappedText, false);
            }
          }
        }
      }

      const execStart = performance.now();
      if (tailMatch.script) {
        exec(tailMatch.script);
      }
      if (tailMatch.action) {
        await tailMatch.action();
      }
      const execMs = Math.round(performance.now() - execStart);
      this.playSound('paste');
      log.info(
        'Hot Mic: [timing] command: detect=%dms exec=%dms name=%s',
        cmdMs, execMs, tailMatch.commandName
      );
      this.resetBufferDiscardTimer();
      return;
    }

    // Check for paste word (flush buffer without submitting)
    const { shouldPaste, cleanedText: pasteCleanedText } = this.checkPastePhrases(trimmed);

    if (shouldPaste) {
      log.info('Hot Mic: paste phrase matched in chunk');
      if (LOG_TRANSCRIPT_PAYLOADS) {
        log.debug('Hot Mic: paste phrase chunk: "%s"', trimmed);
      }
      if (pasteCleanedText.trim()) {
        this.pushNormalizedTextToBuffer(pasteCleanedText);
      }

      const target = this.getTextTarget();
      let mappedText = await this.consumeBufferedHotMicPayload(this.getBundleIdForTextTarget(target));

      if (mappedText) {
        void this.storeHotMicTranscript(mappedText);
        // Trailing space so the next dictation flows naturally
        if (target.kind !== 'none') {
          mappedText = mappedText + ' ';
          log.info('Hot Mic: pasting buffer (%d chars, no submit) to %s', mappedText.length, target.kind === 'app' ? target.bundleId : 'field-theory-markdown');
          if (LOG_TRANSCRIPT_PAYLOADS) {
            log.debug('Hot Mic: pasting buffer payload: "%s"', mappedText);
          }
          if (await this.insertTextIntoTarget(target, mappedText, false)) {
            this.playSound('paste');
          }
        }
      }

      this.resetBufferDiscardTimer();
      return;
    }

    // Check for submit word
    const submitEval = this.checkSubmitPhrasesWithContext(trimmed);
    const { shouldSubmit, cleanedText, bufferOverrideText } = submitEval;

    if (shouldSubmit) {
      log.info('Hot Mic: submit phrase matched in chunk');
      if (LOG_TRANSCRIPT_PAYLOADS) {
        log.debug('Hot Mic: submit phrase chunk: "%s"', trimmed);
      }
      if (bufferOverrideText !== null) {
        this.replaceBufferWithText(bufferOverrideText);
      }
      // Add any remaining text before the submit word to buffer
      if (cleanedText.trim()) {
        this.pushNormalizedTextToBuffer(cleanedText);
      }

      // Flush the entire buffer
      const target = this.getTextTarget();
      const mappedText = await this.consumeBufferedHotMicPayload(this.getBundleIdForTextTarget(target));

      if (mappedText) {
        void this.storeHotMicTranscript(mappedText);
        if (target.kind !== 'none') {
          log.info('Hot Mic: submitting buffer (%d chars) to %s', mappedText.length, target.kind === 'app' ? target.bundleId : 'field-theory-markdown');
          if (LOG_TRANSCRIPT_PAYLOADS) {
            log.debug('Hot Mic: submitting buffer payload: "%s"', mappedText);
          }
          if (await this.insertTextIntoTarget(target, mappedText, true)) {
            this.playSound('paste');
          }
        }
      } else {
        const target = this.getTextTarget();
        if (target.kind === 'none') {
          this.resetBufferDiscardTimer();
          return;
        }
        // Submit word alone — just hit Enter
        await this.insertTextIntoTarget(target, '', true);
      }

      // Keep listening — user navigates on their own
      this.resetBufferDiscardTimer();
      return;
    }

    // No submit word — add to buffer
    // Normalize for natural dictation: lowercase and strip trailing periods
    // (Some engines treat each chunk as a standalone utterance, adding false sentence-ending
    // periods at chunk boundaries). Internal periods and ?/! are preserved.
    const normalized = this.pushNormalizedTextToBuffer(trimmed);
    if (LOG_TRANSCRIPT_PAYLOADS) {
      log.debug('Hot Mic: buffered (%d total): "%s"', this.transcriptBuffer.length, normalized);
    } else {
      log.debug('Hot Mic: buffered (%d total, %d chars)', this.transcriptBuffer.length, normalized.length);
    }
    this.syncDrawerPreview();
    // Orange dot update is handled by onChunkReady after this method returns
    this.resetBufferDiscardTimer();
  }

  private static readonly DEFAULT_SUBMIT_PHRASES = HOT_MIC_DEFAULTS.submitPhrases;
  private static readonly DEFAULT_PASTE_PHRASES = HOT_MIC_DEFAULTS.pastePhrases;
  private static readonly DEFAULT_CANCEL_PHRASES = HOT_MIC_DEFAULTS.cancelPhrases;
  private static readonly DEFAULT_SCRAP_PHRASES = HOT_MIC_DEFAULTS.scrapPhrases;
  private static readonly DEFAULT_NEW_WINDOW_PHRASES = HOT_MIC_DEFAULTS.newWindowPhrases;
  private static readonly DEFAULT_CLOSE_WINDOW_PHRASES = HOT_MIC_DEFAULTS.closeWindowPhrases;
  private static readonly DEFAULT_MINIMIZE_PHRASES = HOT_MIC_DEFAULTS.minimizePhrases;
  private static readonly DEFAULT_HIDE_PHRASES = HOT_MIC_DEFAULTS.hidePhrases;
  private static readonly DEFAULT_QUIT_PHRASES = HOT_MIC_DEFAULTS.quitPhrases;
  private static readonly DEFAULT_SWITCH_WORDS = HOT_MIC_DEFAULTS.switchWindowPhrases;
  private static readonly DEFAULT_PREV_WINDOW_WORDS = HOT_MIC_DEFAULTS.prevWindowPhrases;
  private static readonly DEFAULT_OPEN_APP_PREFIXES = HOT_MIC_DEFAULTS.appOpenPrefixes;
  private static readonly DEFAULT_QUIT_APP_PREFIXES = HOT_MIC_DEFAULTS.appQuitPrefixes;
  private static readonly DEFAULT_RUN_CLAUDE_PHRASES = HOT_MIC_DEFAULTS.runClaudePhrases;
  private static readonly DEFAULT_RUN_CODEX_PHRASES = HOT_MIC_DEFAULTS.runCodexPhrases;
  private static readonly DEFAULT_RESTART_SERVER_PHRASES = HOT_MIC_DEFAULTS.restartServerPhrases;
  // Easy rollback switch for split-across-chunk submit phrase handling.
  private static readonly ENABLE_SPLIT_CHUNK_SUBMIT_DETECTION = true;
  private static readonly SUBMIT_TRAILING_NOISE_MAX_WORDS = 3;
  private static readonly TRAILING_NOISE_FILLERS = new Set([
    'uh',
    'um',
    'uhh',
    'umm',
    'ah',
    'oh',
    'mm',
    'hmm',
    'huh',
    'er',
  ]);
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
    const exactMatch = this.checkTrailingPhrase(transcript, this.getSubmitPhrases());
    if (exactMatch.matched) {
      return { shouldSubmit: true, cleanedText: exactMatch.cleanedText };
    }

    const tolerantMatch = this.checkTrailingPhraseWithNoiseSuffix(
      transcript,
      this.getSubmitPhrases(),
      HotMicManager.SUBMIT_TRAILING_NOISE_MAX_WORDS
    );
    return { shouldSubmit: tolerantMatch.matched, cleanedText: tolerantMatch.cleanedText };
  }

  private checkSubmitPhrasesWithContext(transcript: string): {
    shouldSubmit: boolean;
    cleanedText: string;
    bufferOverrideText: string | null;
  } {
    const directMatch = this.checkSubmitPhrases(transcript);
    if (directMatch.shouldSubmit || !HotMicManager.ENABLE_SPLIT_CHUNK_SUBMIT_DETECTION) {
      return {
        shouldSubmit: directMatch.shouldSubmit,
        cleanedText: directMatch.cleanedText,
        bufferOverrideText: null,
      };
    }

    if (this.transcriptBuffer.length === 0) {
      return { shouldSubmit: false, cleanedText: transcript, bufferOverrideText: null };
    }

    const bufferedText = this.transcriptBuffer.join(' ').trim();
    if (!bufferedText) {
      return { shouldSubmit: false, cleanedText: transcript, bufferOverrideText: null };
    }

    const combined = `${bufferedText} ${transcript}`.trim();
    const combinedMatch = this.checkSubmitPhrases(combined);
    if (!combinedMatch.shouldSubmit) {
      return { shouldSubmit: false, cleanedText: transcript, bufferOverrideText: null };
    }

    return {
      shouldSubmit: true,
      cleanedText: '',
      bufferOverrideText: combinedMatch.cleanedText,
    };
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

  private replaceBufferWithText(text: string): void {
    this.transcriptBuffer = [];
    this.hotMicBufferSegments = [];
    const normalized = this.normalizeBufferText(text);
    if (!normalized) return;
    this.transcriptBuffer.push(normalized);
    this.appendHotMicBufferSegment(normalized);
  }

  private checkTrailingPhraseWithNoiseSuffix(
    text: string,
    phrases: string[][],
    maxSuffixWords: number
  ): { matched: boolean; cleanedText: string } {
    const stripped = text.trim().replace(/[.,!?;:]+$/, '').trim();
    if (!stripped) {
      return { matched: false, cleanedText: '' };
    }

    const words = stripped.split(/\s+/);
    if (words.length === 0) {
      return { matched: false, cleanedText: stripped };
    }

    for (const phraseWords of phrases) {
      const phraseLen = phraseWords.length;
      if (words.length <= phraseLen) continue;

      const minStart = Math.max(0, words.length - phraseLen - maxSuffixWords);
      for (let start = words.length - phraseLen; start >= minStart; start--) {
        const candidate = words.slice(start, start + phraseLen).map((word) => word.toLowerCase());
        const phraseMatches = candidate.every((word, idx) => word === phraseWords[idx]);
        if (!phraseMatches) continue;

        const suffix = words.slice(start + phraseLen);
        if (suffix.length === 0 || suffix.length > maxSuffixWords) continue;
        if (!suffix.every((word) => this.isLikelyTrailingNoiseWord(word))) continue;

        return {
          matched: true,
          cleanedText: words.slice(0, start).join(' '),
        };
      }
    }

    return { matched: false, cleanedText: stripped };
  }

  private isLikelyTrailingNoiseWord(word: string): boolean {
    const raw = word.trim().toLowerCase();
    if (!raw) return true;

    if (/^[a-z](?:\.[a-z])+\.?$/.test(raw)) {
      // Dotted acronym artifacts, e.g. "p.a.c.t"
      return true;
    }

    const cleaned = raw.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
    if (!cleaned) return true;
    if (HotMicManager.TRAILING_NOISE_FILLERS.has(cleaned)) return true;
    if (cleaned.length <= 2) return true;

    // Short vowelless fragments often show up as ASR tail junk.
    if (cleaned.length <= 4 && /^[^aeiouy]+$/.test(cleaned)) {
      return true;
    }

    return false;
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
      { name: 'scrap', phrases: this.getPhraseList('hotMicScrapWords', HotMicManager.DEFAULT_SCRAP_PHRASES) },
      { name: 'start claude', phrases: this.getPhraseList('hotMicRunClaudeWords', HotMicManager.DEFAULT_RUN_CLAUDE_PHRASES),
        action: async () => {
          const target = this.getTypeTarget();
          if (target) {
            await this.typeIntoAppWithClipboardSync(target, 'claude', true);
          }
        },
      },
      { name: 'start codex', phrases: this.getPhraseList('hotMicRunCodexWords', HotMicManager.DEFAULT_RUN_CODEX_PHRASES),
        action: async () => {
          const target = this.getTypeTarget();
          if (target) {
            await this.typeIntoAppWithClipboardSync(target, 'codex', true);
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

    log.debug(
      'Hot Mic: tail-match input="%s" (%d commands)',
      this.summarizeForLog(text),
      commandSets.length
    );

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

    // Dynamic: App switching — only query running apps if text contains a trigger prefix.
    const openPrefixes = this.getAppOpenPrefixes();
    if (this.appSwitcher && this.textContainsAnyPrefix(stripped, openPrefixes)) {
      const appTailMatch = await this.parseAppCommandFromTail(text, openPrefixes);
      if (appTailMatch) {
        return {
          commandName: 'app-switch:' + appTailMatch.appName,
          action: async () => { await this.activateAppByName(appTailMatch); },
          remainingText: appTailMatch.remainingText,
        };
      }
    }

    // Dynamic: Hide specific app by name ("hide slack", "hide the browser")
    const hidePrefixes = this.getAppHidePrefixes();
    if (this.textContainsAnyPrefix(stripped, hidePrefixes)) {
      const hideMatch = await this.parseAppCommandFromTail(text, hidePrefixes);
      if (hideMatch) {
        return {
          commandName: 'hide-app:' + hideMatch.appName,
          action: async () => { await this.hideAppByName(hideMatch); },
          remainingText: hideMatch.remainingText,
        };
      }
    }

    // Dynamic: Quit specific app by name ("quit slack", "quit the browser")
    const quitPrefixes = this.getAppQuitPrefixes();
    if (this.textContainsAnyPrefix(stripped, quitPrefixes)) {
      const quitMatch = await this.parseAppCommandFromTail(text, quitPrefixes);
      if (quitMatch) {
        return {
          commandName: 'quit-app:' + quitMatch.appName,
          action: async () => { await this.quitAppByName(quitMatch); },
          remainingText: quitMatch.remainingText,
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

  /** Fast check: does the text contain any of the given prefix words (assumes prefixes are lowercase)? */
  private textContainsAnyPrefix(text: string, prefixes: string[]): boolean {
    const lower = text.toLowerCase();
    return prefixes.some(p => lower.includes(p));
  }

  private getAppOpenPrefixes(): string[] {
    return this.getPhraseList('hotMicOpenAppPrefixes', HotMicManager.DEFAULT_OPEN_APP_PREFIXES);
  }

  private getAppQuitPrefixes(): string[] {
    return this.getPhraseList('hotMicQuitAppPrefixes', HotMicManager.DEFAULT_QUIT_APP_PREFIXES);
  }

  private getAppHidePrefixes(): string[] {
    // Reuse hide phrases so custom vocabulary ("conceal", etc.) can opt in.
    // Keep "hide" always available for natural commands like "hide slack".
    const hidePhrases = this.getPhraseList('hotMicHidePhrases', HotMicManager.DEFAULT_HIDE_PHRASES);
    const prefixes = new Set<string>(['hide']);
    for (const phrase of hidePhrases) {
      if (phrase === 'hide this app' || phrase === 'hide the app') continue;
      prefixes.add(phrase);
    }
    return Array.from(prefixes);
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
   * Match text ending with "<prefix> [the/a/an] <app name>" for any set of prefixes.
   * Builds app phrases from user aliases, built-in aliases, and running apps.
   * Used by open/switch, hide, and quit commands.
   */
  private async parseAppCommandFromTail(text: string, prefixes: string[]): Promise<{ appName: string; bundleId: string | null; remainingText: string } | null> {
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
      const prefixWithSpace = `${prefix} `;
      for (const { phrase, canonical } of phrases) {
        const triggers = [prefixWithSpace + phrase];
        for (const article of articles) {
          triggers.push(prefixWithSpace + article + phrase);
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
        await new Promise<void>((resolve) => {
          execFile('open', ['-a', match.appName], () => resolve());
        });
      }
    } catch {
      // App may not respond
    }
  }


  /**
   * Quit an app by name. Uses AppleScript to gracefully quit.
   */
  private async quitAppByName(match: { bundleId: string | null; appName: string }): Promise<void> {
    try {
      const safeName = match.appName.replace(/"/g, '');
      const script = `tell application "${safeName}" to quit`;
      await new Promise<void>((resolve) => {
        execFile('osascript', ['-e', script], () => resolve());
      });
      log.info('Hot Mic: quit app "%s"', match.appName);
    } catch {
      // App may not respond to quit
    }
  }

  /**
   * Hide an app by name without quitting it.
   */
  private async hideAppByName(match: { bundleId: string | null; appName: string }): Promise<void> {
    try {
      if (match.bundleId) {
        const safeBundleId = match.bundleId.replace(/"/g, '');
        const script = `tell application "System Events" to set visible of (first process whose bundle identifier is "${safeBundleId}") to false`;
        await new Promise<void>((resolve) => {
          execFile('osascript', ['-e', script], () => resolve());
        });
      } else {
        const safeName = match.appName.replace(/"/g, '');
        const script = `tell application "System Events" to set visible of process "${safeName}" to false`;
        await new Promise<void>((resolve) => {
          execFile('osascript', ['-e', script], () => resolve());
        });
      }
      log.info('Hot Mic: hide app "%s"', match.appName);
    } catch {
      // App may not respond to hide
    }
  }

  /**
   * Remove transcription metadata-like artifacts while preserving figure refs.
   */
  private sanitizeTranscriptText(text: string): string {
    const trimmedText = text ? text.trim() : '';
    if (!trimmedText) return '';

    const startedWithArtifact = /^\[(?!figure\s+[A-Za-z0-9]+\])[^\]]+\]\s*/i.test(trimmedText);

    let cleanedText = trimmedText
      .replace(/\s*\[(?!figure\s+[A-Za-z0-9]+\])[^\]]+\]\s*/gi, ' ')
      .replace(/\([^)]*\)/g, ' ')
      .replace(/[<>]{2,}/g, ' ')
      .replace(/\b(mm[-\s]?hmm|mm+|hmm+)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // When a chunk starts with a metadata artifact (e.g. "[take vo] vo ..."),
    // drop a leading short orphan fragment that often survives bracket stripping.
    if (startedWithArtifact && cleanedText) {
      const words = cleanedText.split(/\s+/).filter(Boolean);
      if (
        words.length > 0
        && words[0].length <= 2
        && !['a', 'i'].includes(words[0].toLowerCase())
      ) {
        words.shift();
        cleanedText = words.join(' ').trim();
      }
    }

    return cleanedText;
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
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    // Append command references in the terminal-friendly format
    for (const cmd of detection.matchedCommands) {
      const ref = `\n[run this command: ${cmd.name}.md]\n${cmd.filePath}`;
      cleaned += ref;
    }

    return cleaned;
  }

  private resetHotMicFigureSession(): void {
    this.clearScreenshotState();
    this.hotMicBufferSegments = [];
  }

  private clearHotMicDraftUi(clearScreenshots: boolean): void {
    this.clearHotMicDraftContext(clearScreenshots);
    this.dynamicIslandManager?.updateDrawerTranscript('');
    this.updateOrangeDot();
  }

  private getClipboardItem(itemId: number): ClipboardItem | null {
    return this.clipboardManager?.getItem?.(itemId) ?? null;
  }

  private async exportClipboardItemToCache(item: ClipboardItem): Promise<string | null> {
    if (!this.clipboardManager?.exportImageToCache) return null;
    return this.clipboardManager.exportImageToCache(item);
  }

  private normalizeBufferText(text: string): string {
    return text.trim().toLowerCase().replace(/\.+$/, '').trim();
  }

  private normalizeBoundaryToken(token: string): string {
    return token
      .toLowerCase()
      .replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, '');
  }

  private stitchChunkBoundaryOverlap(normalizedChunk: string): string {
    if (this.transcriptBuffer.length === 0) return normalizedChunk;

    const chunkTokens = normalizedChunk.split(/\s+/).filter(Boolean);
    if (chunkTokens.length === 0) return '';

    // Look at recent buffered tail, not just the last chunk.
    const bufferedTail = this.transcriptBuffer.slice(-3).join(' ');
    const tailTokens = bufferedTail.split(/\s+/).filter(Boolean);
    if (tailTokens.length === 0) return normalizedChunk;

    const maxOverlap = Math.min(
      HotMicManager.BOUNDARY_STITCH_MAX_WORDS,
      tailTokens.length,
      chunkTokens.length
    );

    let overlapWords = 0;
    for (let overlap = maxOverlap; overlap >= HotMicManager.BOUNDARY_STITCH_MIN_WORDS; overlap--) {
      let matched = true;
      for (let i = 0; i < overlap; i++) {
        const tailWord = this.normalizeBoundaryToken(tailTokens[tailTokens.length - overlap + i] ?? '');
        const chunkWord = this.normalizeBoundaryToken(chunkTokens[i] ?? '');
        if (!tailWord || !chunkWord || tailWord !== chunkWord) {
          matched = false;
          break;
        }
      }
      if (matched) {
        overlapWords = overlap;
        break;
      }
    }

    if (overlapWords === 0) return normalizedChunk;
    if (overlapWords >= chunkTokens.length) {
      log.debug(
        'Hot Mic: boundary stitch dropped duplicate chunk (%d overlap words): "%s"',
        overlapWords,
        this.summarizeForLog(normalizedChunk, 100)
      );
      return '';
    }

    const stitched = chunkTokens.slice(overlapWords).join(' ');
    log.debug(
      'Hot Mic: boundary stitch overlap=%d "%s" -> "%s"',
      overlapWords,
      this.summarizeForLog(normalizedChunk, 100),
      this.summarizeForLog(stitched, 100)
    );
    return stitched;
  }

  private summarizeForLog(text: string, maxChars: number = 180): string {
    if (!text) return '';
    if (text.length <= maxChars) return text;
    return `${text.slice(0, maxChars)}…(${text.length} chars)`;
  }

  private pushNormalizedTextToBuffer(text: string): string {
    const normalized = this.normalizeBufferText(text);
    if (!normalized) return '';
    const stitched = this.stitchChunkBoundaryOverlap(normalized);
    if (!stitched) return '';
    this.transcriptBuffer.push(stitched);
    this.appendHotMicBufferSegment(stitched);
    return stitched;
  }

  private async consumeBufferedHotMicPayload(targetBundleId: string | null): Promise<string> {
    const fullText = this.transcriptBuffer.join(' ');
    let payload = '';
    if (fullText || this.hotMicScreenshotMetadata.length > 0) {
      payload = await this.buildFigureAwareHotMicPayload(fullText, targetBundleId);
    }
    this.clearHotMicDraftUi(true);
    return payload;
  }

  private clearHotMicDraftContext(clearScreenshots: boolean): void {
    this.transcriptBuffer = [];
    this.hotMicBufferSegments = [];
    if (clearScreenshots) {
      this.clearScreenshotState();
    }
  }

  private clearScreenshotState(): void {
    const hadScreenshots = this.hotMicScreenshotMetadata.length > 0;
    this.hotMicSessionItemIds = [];
    this.hotMicScreenshotMetadata = [];
    this.hotMicSessionStartMs = Date.now();
    if (hadScreenshots) {
      this.emit('screenshotStackChanged', 0);
    }
  }

  private appendHotMicBufferSegment(text: string): void {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (!normalized) return;
    const endMs = this.hotMicSessionStartMs > 0
      ? Math.max(0, Date.now() - this.hotMicSessionStartMs)
      : 0;
    this.hotMicBufferSegments.push({ text: normalized, endMs });
  }

  private stripFigureReferences(text: string): string {
    return stripFigureReferences(text);
  }

  private insertFigureReferencesIntoHotMicText(text: string): string {
    return insertFigureReferencesInline(text, this.hotMicBufferSegments, this.hotMicScreenshotMetadata);
  }

  private async appendFigurePathsForTerminal(text: string, targetBundleId: string | null): Promise<string> {
    if (!isTerminalApp(targetBundleId)) return text;
    if (this.hotMicScreenshotMetadata.length === 0) return text;

    const sortedScreenshots = [...this.hotMicScreenshotMetadata].sort(
      (a, b) => a.capturedAtMs - b.capturedAtMs
    );

    const lines: string[] = [];
    for (const screenshot of sortedScreenshots) {
      const item = this.getClipboardItem(screenshot.itemId);
      if (!item || !item.imageData) continue;
      const imagePath = await this.exportClipboardItemToCache(item);
      if (imagePath) {
        lines.push(`figure ${screenshot.figureLabel}: \`${imagePath.replace(os.homedir(), '~')}\``);
      }
    }

    if (lines.length === 0) return text;
    if (!text.trim()) {
      return `${lines.join('\n')}\n\n`;
    }
    return `${text}\n\n${lines.join('\n')}\n\n`;
  }

  private async buildFigureAwareHotMicPayload(text: string, targetBundleId: string | null): Promise<string> {
    let payload = this.applyMappings(text);
    payload = this.insertFigureReferencesIntoHotMicText(payload);
    payload = await this.appendFigurePathsForTerminal(payload, targetBundleId);
    payload = this.applyCommandDetection(payload);
    return payload.trim();
  }

  private generateFallbackFigureId(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let id = '';
    for (let i = 0; i < 5; i++) {
      id += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return id;
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

  private syncDrawerPreview(): void {
    // Drawer is suppressed for hot-mic — the waveform in the pill is sufficient.
    // Transcript is still buffered for paste/submit, just not shown in the drawer.
  }

  /**
   * Keep Dynamic Island in sync with both hot-mic activity and mute state.
   */
  private syncDynamicIslandHotMicState(): void {
    this.dynamicIslandManager?.sendMuteState(this.muted);
    this.updateOrangeDot();
  }

  private updateOrangeDot(): void {
    // Hide while yielded to standard recording so the red standard dot is the only source of truth.
    const isActive = (this.state === 'listening' || this.state === 'recording') && !this.muted && !this.yieldedToTranscriber;

    if (isActive) {
      this.dynamicIslandManager?.updateHotMic(true, this.getBufferWordCount(), this.getLastBufferWord());
    } else {
      this.dynamicIslandManager?.updateHotMic(false, 0, '');
    }
  }

  // ---------------------------------------------------------------------------
  // Legacy direct-paste mode (non-queue, recording state)
  // ---------------------------------------------------------------------------

  private async processTranscriptDirectPaste(transcript: string): Promise<void> {
    const sanitizedTranscript = this.sanitizeTranscriptText(transcript);
    if (!sanitizedTranscript) {
      return;
    }
    const trimmed = this.applyWordSubstitutions(sanitizedTranscript.trim());
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

    if (textToInject) {
      void this.storeHotMicTranscript(textToInject);
    }

    const target = this.getTextTarget();
    if (textToInject && target.kind !== 'none') {
      if (!shouldSubmit) {
        textToInject = textToInject + ' ';
      }
      log.info('Hot Mic: pasting chunk (%d chars, enter=%s)', textToInject.length, shouldSubmit);
      if (LOG_TRANSCRIPT_PAYLOADS) {
        log.debug('Hot Mic: pasting chunk payload: "%s"', textToInject);
      }
      if (!(await this.insertTextIntoTarget(target, textToInject, shouldSubmit))) {
        this.cursorStatusManager?.showCriticalMessage('Hot Mic: Injection failed');
        this.deactivate();
        return;
      }
      this.playSound('paste');
    } else if (shouldSubmit && target.kind !== 'none') {
      await this.insertTextIntoTarget(target, '', true);
    }

    if (shouldSubmit) {
      this.deactivate();
    }
  }

  private async storeHotMicTranscript(text: string): Promise<void> {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (!normalized) return;

    const wordCount = normalized.split(/\s+/).filter((word) => word.length > 0).length;
    if (wordCount > 0) {
      this.metricsWordsRecorder?.(wordCount);
    }
    if (!this.clipboardManager) return;
    if (wordCount < this.MIN_HISTORY_WORDS) return;

    try {
      await this.clipboardManager.storeText(normalized, 'transcript');
    } catch (error) {
      log.error('Hot Mic: failed to store transcript in history:', error);
    }
  }

  // ---------------------------------------------------------------------------
  // Transcription
  // ---------------------------------------------------------------------------

  private async transcribe(wavPath: string): Promise<string> {
    // Use the user's configured engine via TranscriberManager when available.
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
    return this.getHallucinationReason(text) !== null;
  }

  private getHallucinationReason(text: string): string | null {
    const trimmed = text?.trim() ?? '';
    if (!trimmed) return 'empty';

    for (const pattern of this.HALLUCINATION_PATTERNS) {
      if (pattern.test(trimmed)) return 'pattern';
    }

    if (this.isRepetitionArtifact(trimmed)) {
      return 'repetition-artifact';
    }

    return null;
  }

  private isRepetitionArtifact(text: string): boolean {
    const normalized = this.normalizeForRepetition(text);
    if (!normalized) return false;

    const collapsed = normalized.replace(/\s+/g, '');
    if (this.isCollapsedRepetitionArtifact(collapsed)) {
      return true;
    }

    const words = normalized.split(' ').filter(Boolean);
    if (this.isShortSingleTokenBurst(words)) {
      return true;
    }

    if (words.length < HotMicManager.REPETITION_ANALYSIS_MIN_WORDS) {
      return false;
    }

    if (this.hasConsecutiveWordRun(words, HotMicManager.REPETITION_CONSECUTIVE_RUN_MIN)) {
      return true;
    }

    return this.hasDominantWordDistribution(words);
  }

  private normalizeForRepetition(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^\w\s']/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private isCollapsedRepetitionArtifact(collapsed: string): boolean {
    if (collapsed.length < HotMicManager.REPETITION_COLLAPSED_MIN_CHARS) {
      return false;
    }

    const singleCharPattern = new RegExp(`^(.)\\1{${HotMicManager.REPETITION_SINGLE_CHAR_MIN_RUN - 1},}$`);
    if (singleCharPattern.test(collapsed)) {
      return true;
    }

    for (let unit = HotMicManager.REPETITION_UNIT_MIN; unit <= HotMicManager.REPETITION_UNIT_MAX; unit++) {
      if (this.matchesRepeatedUnit(collapsed, unit, HotMicManager.REPETITION_UNIT_MIN_REPEATS)) {
        return true;
      }
    }

    return false;
  }

  private matchesRepeatedUnit(collapsed: string, unitSize: number, minRepeats: number): boolean {
    const repeats = Math.floor(collapsed.length / unitSize);
    if (repeats < minRepeats) return false;

    const pattern = collapsed.slice(0, unitSize);
    for (let i = 1; i < repeats; i++) {
      if (collapsed.slice(i * unitSize, (i + 1) * unitSize) !== pattern) {
        return false;
      }
    }

    const remainder = collapsed.length % unitSize;
    if (remainder === 0) return true;

    const remainderChunk = collapsed.slice(repeats * unitSize);
    return pattern.startsWith(remainderChunk);
  }

  private isShortSingleTokenBurst(words: string[]): boolean {
    if (words.length < HotMicManager.REPETITION_SHORT_BURST_MIN_WORDS) {
      return false;
    }

    const uniqueWords = new Set(words);
    if (uniqueWords.size !== 1) {
      return false;
    }

    const onlyWord = words[0] ?? '';
    return words.length >= HotMicManager.REPETITION_SHORT_BURST_ALWAYS_MIN_WORDS
      || onlyWord.length >= HotMicManager.REPETITION_SHORT_BURST_LONG_WORD_LEN;
  }

  private hasConsecutiveWordRun(words: string[], minRun: number): boolean {
    let maxRun = 1;
    let run = 1;
    for (let i = 1; i < words.length; i++) {
      if (words[i] === words[i - 1]) {
        run += 1;
        if (run > maxRun) {
          maxRun = run;
        }
      } else {
        run = 1;
      }
    }
    return maxRun >= minRun;
  }

  private hasDominantWordDistribution(words: string[]): boolean {
    const freq = new Map<string, number>();
    for (const word of words) {
      freq.set(word, (freq.get(word) ?? 0) + 1);
    }

    let maxFreq = 0;
    for (const count of freq.values()) {
      if (count > maxFreq) {
        maxFreq = count;
      }
    }

    const uniqueRatio = freq.size / words.length;
    const dominantRatio = maxFreq / words.length;
    return uniqueRatio <= HotMicManager.REPETITION_UNIQUE_RATIO_MAX
      && dominantRatio >= HotMicManager.REPETITION_DOMINANT_RATIO_MIN;
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

    if (state === 'idle' || this.yieldedToTranscriber) {
      this.unregisterEscapeDismissHotkey();
    } else {
      this.registerEscapeDismissHotkey();
    }

    this.emit('stateChanged', state);
    this.emit('statusChanged', this.getStatus());

    // Auto-derive condition from state transitions.
    if (state === 'idle') {
      this.setCondition(null);
    }

    this.updateOrangeDot();
  }

  private setCondition(cond: HotMicCondition | null): void {
    if (this.condition === cond) return;
    const prev = this.condition;
    this.condition = cond;
    log.info('Hot Mic condition: %s → %s', prev ?? 'none', cond ?? 'none');
    this.emitRuntimeStatus();
  }

  private emitRuntimeStatus(): void {
    const status = this.getRuntimeStatus();
    this.emit('runtimeStatusChanged', status);
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  private cleanup(): void {
    this.unregisterEscapeDismissHotkey();
    this.stopAudioMonitoring();
    this.stopBufferDiscardTimer();
    this.clearDrawerSpeakingSignal();
    this.resumeInFlight = false;
    this.yieldedToTranscriber = false;
    this.targetBundleId = null;
    this.clearHotMicDraftContext(true);
    this.engineReady = false;
    this.whisperFallbackActive = false;
    this.lastChunkIntervalMs = null;
    this.lastQueueWaitMs = null;
    this.lastTranscribeMs = null;
    this.lastPostProcessMs = null;
    this.lastTotalPipelineMs = null;
    this.avgTranscribeMs = null;
    this.avgTotalPipelineMs = null;
    if (this.pendingChunkQueue.length > 0) {
      for (const chunk of this.pendingChunkQueue) {
        void fs.promises.unlink(chunk.filePath).catch(() => {});
      }
    }
    this.pendingChunkQueue = [];
    this.chunkProcessingInFlight = false;
    this.dynamicIslandManager?.updateDrawerTranscript('');
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
