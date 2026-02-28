import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: vi.fn(() => '/tmp'),
  },
  globalShortcut: {
    register: vi.fn(() => true),
    unregister: vi.fn(),
    isRegistered: vi.fn(() => false),
  },
  clipboard: {
    writeText: vi.fn(),
    writeImage: vi.fn(),
  },
  nativeImage: {
    createFromBuffer: vi.fn(() => ({})),
  },
  Notification: vi.fn(),
}));

vi.mock('./logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

type QwenResponse = { ok: boolean; text?: string; error?: string };

import { TranscriberManager } from './transcriberManager';

function createQwenHarness(
  writeImpl?: (line: string, callback?: (err?: Error | null) => void) => void
): { manager: any; write: ReturnType<typeof vi.fn> } {
  const write = vi.fn((line: string, callback?: (err?: Error | null) => void) => {
    if (writeImpl) {
      writeImpl(line, callback);
    } else {
      callback?.(null);
    }
    return true;
  });

  const manager: any = {
    qwenProcess: { stdin: { write } },
    qwenReady: true,
    qwenPendingResolve: null,
    qwenCommandChain: Promise.resolve(),
  };

  Object.setPrototypeOf(manager, TranscriberManager.prototype);
  return { manager, write };
}

function createWarmupHarness(prefValues: Record<string, unknown>): { manager: any; startQwenServer: ReturnType<typeof vi.fn> } {
  const startQwenServer = vi.fn(async () => {});
  const manager: any = {
    preferences: {
      getPreference: (key: string) => prefValues[key],
    },
    startQwenServer,
  };
  Object.setPrototypeOf(manager, TranscriberManager.prototype);
  return { manager, startQwenServer };
}

function createRestartHarness(prefValues: Record<string, unknown>): {
  manager: any;
  stopQwenServer: ReturnType<typeof vi.fn>;
  startQwenServer: ReturnType<typeof vi.fn>;
} {
  const stopQwenServer = vi.fn();
  const startQwenServer = vi.fn(async () => {});
  const manager: any = {
    preferences: {
      getPreference: (key: string) => prefValues[key],
    },
    stopQwenServer,
    startQwenServer,
  };
  Object.setPrototypeOf(manager, TranscriberManager.prototype);
  return { manager, stopQwenServer, startQwenServer };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('TranscriberManager Qwen command queue', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('serializes concurrent Qwen commands so only one is in-flight', async () => {
    const { manager, write } = createQwenHarness();

    const firstPromise = manager.sendQwenCommand({ cmd: 'first' });
    const secondPromise = manager.sendQwenCommand({ cmd: 'second' });

    await flushMicrotasks();
    expect(write).toHaveBeenCalledTimes(1);

    const resolveFirst = manager.qwenPendingResolve as ((response: QwenResponse) => void);
    expect(typeof resolveFirst).toBe('function');
    manager.qwenPendingResolve = null;
    resolveFirst({ ok: true, text: 'first-result' });

    await expect(firstPromise).resolves.toEqual({ ok: true, text: 'first-result' });
    await flushMicrotasks();
    expect(write).toHaveBeenCalledTimes(2);

    const resolveSecond = manager.qwenPendingResolve as ((response: QwenResponse) => void);
    expect(typeof resolveSecond).toBe('function');
    manager.qwenPendingResolve = null;
    resolveSecond({ ok: true, text: 'second-result' });

    await expect(secondPromise).resolves.toEqual({ ok: true, text: 'second-result' });
  });

  it('continues processing queued commands after a write failure', async () => {
    let writeCount = 0;
    const { manager, write } = createQwenHarness((_line, callback) => {
      writeCount += 1;
      if (writeCount === 1) {
        callback?.(new Error('write failed'));
      } else {
        callback?.(null);
      }
    });

    const firstPromise = manager.sendQwenCommand({ cmd: 'first' });
    const secondPromise = manager.sendQwenCommand({ cmd: 'second' });

    await expect(firstPromise).rejects.toThrow('Failed to write to Qwen server: write failed');

    await flushMicrotasks();
    expect(write).toHaveBeenCalledTimes(2);

    const resolveSecond = manager.qwenPendingResolve as ((response: QwenResponse) => void);
    expect(typeof resolveSecond).toBe('function');
    manager.qwenPendingResolve = null;
    resolveSecond({ ok: true, text: 'second-result' });

    await expect(secondPromise).resolves.toEqual({ ok: true, text: 'second-result' });
  });
});

describe('TranscriberManager warmup', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('warms Qwen when primary transcription engine is qwen', async () => {
    const { manager, startQwenServer } = createWarmupHarness({
      transcriptionEngine: 'qwen',
      hotMicTranscriptionEngine: 'default',
    });

    await manager.warmup();

    expect(startQwenServer).toHaveBeenCalledTimes(1);
  });

  it('warms Qwen when Hot Mic override engine is qwen', async () => {
    const { manager, startQwenServer } = createWarmupHarness({
      transcriptionEngine: 'whisper',
      hotMicTranscriptionEngine: 'qwen',
    });

    await manager.warmup();

    expect(startQwenServer).toHaveBeenCalledTimes(1);
  });

  it('skips Qwen warmup when neither engine path uses qwen', async () => {
    const { manager, startQwenServer } = createWarmupHarness({
      transcriptionEngine: 'whisper',
      hotMicTranscriptionEngine: 'whisper',
    });

    await manager.warmup();

    expect(startQwenServer).not.toHaveBeenCalled();
  });
});

describe('TranscriberManager fallback tracking', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('exposes isQwenDisabledForSession as false by default', () => {
    const manager: any = {
      qwenDisabledReason: null,
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);
    expect(manager.isQwenDisabledForSession()).toBe(false);
  });

  it('reports qwen as disabled when qwenDisabledReason is set', () => {
    const manager: any = {
      qwenDisabledReason: 'MLX runtime crashed',
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);
    expect(manager.isQwenDisabledForSession()).toBe(true);
  });

  it('initializes lastHotMicUsedWhisperFallback to false', () => {
    const manager: any = {
      lastHotMicUsedWhisperFallback: false,
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);
    expect(manager.lastHotMicUsedWhisperFallback).toBe(false);
  });
});

describe('TranscriberManager runtime restart', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('restarts qwen runtime when either primary or hot mic engine uses qwen', async () => {
    const { manager, stopQwenServer, startQwenServer } = createRestartHarness({
      transcriptionEngine: 'whisper',
      hotMicTranscriptionEngine: 'qwen',
    });

    await manager.restartTranscriptionRuntime();

    expect(stopQwenServer).toHaveBeenCalledTimes(1);
    expect(startQwenServer).toHaveBeenCalledTimes(1);
  });

  it('stops qwen runtime without restarting when both engine paths are whisper', async () => {
    const { manager, stopQwenServer, startQwenServer } = createRestartHarness({
      transcriptionEngine: 'whisper',
      hotMicTranscriptionEngine: 'whisper',
    });

    await manager.restartTranscriptionRuntime();

    expect(stopQwenServer).toHaveBeenCalledTimes(1);
    expect(startQwenServer).not.toHaveBeenCalled();
  });
});

describe('TranscriberManager hot mic fallback behavior', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('respects disabled whisper fallback for hot mic transcriptions', async () => {
    const transcribeWithEngineFallback = vi.fn(async () => 'ok');
    const manager: any = {
      preferences: {
        getPreference: (key: string) => {
          if (key === 'transcriptionEngine') return 'qwen';
          if (key === 'hotMicTranscriptionEngine') return 'default';
          if (key === 'hotMicAllowWhisperFallback') return false;
          return undefined;
        },
      },
      modelManager: {
        getAvailableModels: () => ({ small: { name: 'small' } }),
        getSelectedModel: () => 'small',
      },
      transcribeWithEngineFallback,
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    await manager.transcribeAudioForHotMic('/tmp/test.wav');

    expect(transcribeWithEngineFallback).toHaveBeenCalledWith('/tmp/test.wav', 'qwen', {
      allowWhisperFallback: false,
      whisperModelOverride: 'small',
    });
  });

  it('defaults whisper fallback to enabled when preference is unset', async () => {
    const transcribeWithEngineFallback = vi.fn(async () => 'ok');
    const manager: any = {
      preferences: {
        getPreference: (key: string) => {
          if (key === 'transcriptionEngine') return 'qwen';
          if (key === 'hotMicTranscriptionEngine') return 'default';
          return undefined;
        },
      },
      modelManager: {
        getAvailableModels: () => ({ small: { name: 'small' } }),
        getSelectedModel: () => 'small',
      },
      transcribeWithEngineFallback,
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    await manager.transcribeAudioForHotMic('/tmp/test.wav');

    expect(transcribeWithEngineFallback).toHaveBeenCalledWith('/tmp/test.wav', 'qwen', {
      allowWhisperFallback: true,
      whisperModelOverride: 'small',
    });
  });
});

describe('TranscriberManager auto-improve toggle', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('keeps auto-improve disabled even when setAutoImprove(true) is requested', async () => {
    const save = vi.fn(async () => undefined);
    const manager: any = {
      preferences: {
        save,
      },
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    await manager.setAutoImprove(true);

    expect(manager.getAutoImprove()).toBe(false);
    expect(save).toHaveBeenCalledWith({ autoImproveTranscripts: false });
  });
});

describe('TranscriberManager command paste formatting', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('formats detected commands as run-this-command blocks for terminal paste', () => {
    const manager: any = {
      detectedCommands: [{ name: 'review', filePath: '/tmp/review.md' }],
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    const formatted = manager.formatCommandsForTerminal('please run this [cmd:review.md]');

    expect(formatted).toContain('[run this command: review.md]');
    expect(formatted).toContain('/tmp/review.md');
    expect(formatted).not.toContain('[cmd:review.md]');
  });
});

describe('TranscriberManager standard real-time chunking', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('uses accumulated real-time transcript text without running full-file transcription', async () => {
    const transcribeWithEngineFallback = vi.fn(async () => 'full file text');
    const manager: any = {
      status: 'recording',
      unregisterAbandonHotkey: vi.fn(),
      soundManager: { play: vi.fn() },
      nativeHelper: {
        snapshotRecording: vi.fn(async () => '/tmp/chunk.wav'),
        stopRecording: vi.fn(async () => '/tmp/full.wav'),
        checkFocusedTextInput: vi.fn(async () => true),
      },
      processStandardChunkQueue: vi.fn(async () => {}),
      waitForStandardChunkDrain: vi.fn(async () => {}),
      detachStandardChunkListener: vi.fn(),
      pendingImmediateSquaresAction: null,
      pendingImmediateSquaresText: '',
      standardPendingChunkQueue: [],
      trackPriorityMicUsage: vi.fn(async () => {}),
      setStatus: vi.fn(),
      overlay: { showTranscribing: vi.fn() },
      standardLiveTranscript: 'chunked transcript text',
      sanitizeTranscriptText: vi.fn((text: string) => text.trim()),
      clearStandardLiveTranscript: vi.fn(),
      squaresManager: null,
      commandsManager: null,
      clipboardManager: null,
      detectedCommands: [],
      accessTokenGetter: null,
      lastTranscription: '',
      pasteStack: vi.fn(async () => {}),
      emit: vi.fn(),
      skipNextPasteFailedNotification: false,
      handleOverlayAfterTranscription: vi.fn(),
      transcribeWithEngineFallback,
      preferences: { getPreference: vi.fn(() => 'whisper') },
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    await manager.stopRecordingAndTranscribe();

    expect(transcribeWithEngineFallback).not.toHaveBeenCalled();
    expect(manager.processStandardChunkQueue).toHaveBeenCalledTimes(1);
    expect(manager.pasteStack).toHaveBeenCalledWith(false);
    expect(manager.emit).toHaveBeenCalledWith('result', 'chunked transcript text');
    expect(manager.emit).not.toHaveBeenCalledWith('improvingStarted');
  });

  it('stops recording immediately when a tail Squares command is detected in a chunk', async () => {
    const stopRecordingAndTranscribe = vi.fn(async () => {});
    const manager: any = {
      status: 'recording',
      pendingImmediateSquaresAction: null,
      pendingImmediateSquaresText: '',
      standardLiveTranscript: '',
      standardRealtimeChunks: [],
      standardChunkCommandTriggered: false,
      preferences: { getPreference: vi.fn(() => 'whisper') },
      transcribeWithEngineFallback: vi.fn(async () => 'draft tile'),
      sanitizeTranscriptText: vi.fn((text: string) => text.trim()),
      squaresManager: {
        parseVoiceCommandFromTail: vi.fn(() => ({ action: 'grid', remainingText: 'draft' })),
      },
      nativeHelper: { setHarvestMode: vi.fn() },
      emit: vi.fn(),
      stopRecordingAndTranscribe,
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    await manager.onStandardChunkReady('/tmp/fake-chunk.wav');

    expect(manager.pendingImmediateSquaresAction).toBe('grid');
    expect(manager.pendingImmediateSquaresText).toBe('draft');
    expect(manager.emit).toHaveBeenCalledWith('standardLiveTranscript', 'draft');
    expect(stopRecordingAndTranscribe).toHaveBeenCalled();
  });

  it('normalizes standard transcript chunks like hot mic (lowercase, strip trailing periods)', () => {
    const manager: any = {
      applyWordSubstitutions: vi.fn((text: string) => text),
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    const normalized = manager.sanitizeTranscriptText('Hello There... (laughter)');

    expect(normalized).toBe('hello there');
  });

  it('strips figure references from live chunk accumulation to avoid dynamic island spam', async () => {
    const manager: any = {
      status: 'recording',
      pendingImmediateSquaresAction: null,
      standardLiveTranscript: '',
      standardRealtimeChunks: [],
      standardChunkCommandTriggered: false,
      preferences: { getPreference: vi.fn(() => 'whisper') },
      transcribeWithEngineFallback: vi
        .fn()
        .mockResolvedValueOnce('hello [Figure 1]')
        .mockResolvedValueOnce('again [Figure 1]'),
      applyWordSubstitutions: vi.fn((text: string) => text),
      squaresManager: null,
      nativeHelper: { setHarvestMode: vi.fn() },
      emit: vi.fn(),
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    await manager.onStandardChunkReady('/tmp/chunk-1.wav');
    await manager.onStandardChunkReady('/tmp/chunk-2.wav');

    expect(manager.standardLiveTranscript).toBe('hello again');
    expect(manager.emit).toHaveBeenCalledWith('standardLiveTranscript', 'hello');
    expect(manager.emit).toHaveBeenCalledWith('standardLiveTranscript', 'hello again');
  });

  it('adds figure references once at finalize when using realtime transcript', async () => {
    const transcribeWithEngineFallback = vi.fn(async () => 'full file text');
    const manager: any = {
      status: 'recording',
      unregisterAbandonHotkey: vi.fn(),
      soundManager: { play: vi.fn() },
      nativeHelper: {
        snapshotRecording: vi.fn(async () => '/tmp/chunk.wav'),
        stopRecording: vi.fn(async () => '/tmp/full.wav'),
        checkFocusedTextInput: vi.fn(async () => true),
      },
      processStandardChunkQueue: vi.fn(async () => {}),
      waitForStandardChunkDrain: vi.fn(async () => {}),
      detachStandardChunkListener: vi.fn(),
      pendingImmediateSquaresAction: null,
      pendingImmediateSquaresText: '',
      standardPendingChunkQueue: [],
      trackPriorityMicUsage: vi.fn(async () => {}),
      setStatus: vi.fn(),
      overlay: { showTranscribing: vi.fn() },
      standardLiveTranscript: 'chunked [Figure 1] transcript [Figure 1]',
      sanitizeTranscriptText: vi.fn((text: string) => text.trim()),
      clearStandardLiveTranscript: vi.fn(),
      squaresManager: null,
      commandsManager: null,
      clipboardManager: null,
      detectedCommands: [],
      lastTranscription: '',
      pasteStack: vi.fn(async () => {}),
      emit: vi.fn(),
      skipNextPasteFailedNotification: false,
      handleOverlayAfterTranscription: vi.fn(),
      transcribeWithEngineFallback,
      preferences: { getPreference: vi.fn(() => 'whisper') },
      screenshotMetadata: [{ capturedAtMs: 1000, figureLabel: '1', figureId: 'fig01' }],
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    await manager.stopRecordingAndTranscribe();

    expect(transcribeWithEngineFallback).not.toHaveBeenCalled();
    expect(manager.emit).toHaveBeenCalledWith('result', 'chunked transcript [Figure 1]');
  });

  it('inserts figure references inline by realtime chunk timing at finalize', async () => {
    const transcribeWithEngineFallback = vi.fn(async () => 'full file text');
    const manager: any = {
      status: 'recording',
      unregisterAbandonHotkey: vi.fn(),
      soundManager: { play: vi.fn() },
      nativeHelper: {
        snapshotRecording: vi.fn(async () => '/tmp/chunk.wav'),
        stopRecording: vi.fn(async () => '/tmp/full.wav'),
        checkFocusedTextInput: vi.fn(async () => true),
      },
      processStandardChunkQueue: vi.fn(async () => {}),
      waitForStandardChunkDrain: vi.fn(async () => {}),
      detachStandardChunkListener: vi.fn(),
      pendingImmediateSquaresAction: null,
      pendingImmediateSquaresText: '',
      standardPendingChunkQueue: [],
      standardRealtimeChunks: [
        { text: 'first chunk', endMs: 900 },
        { text: 'second chunk', endMs: 1800 },
        { text: 'third chunk', endMs: 2700 },
      ],
      trackPriorityMicUsage: vi.fn(async () => {}),
      setStatus: vi.fn(),
      overlay: { showTranscribing: vi.fn() },
      standardLiveTranscript: 'first chunk second chunk third chunk',
      sanitizeTranscriptText: vi.fn((text: string) => text.trim()),
      clearStandardLiveTranscript: vi.fn(),
      squaresManager: null,
      commandsManager: null,
      clipboardManager: null,
      detectedCommands: [],
      lastTranscription: '',
      pasteStack: vi.fn(async () => {}),
      emit: vi.fn(),
      skipNextPasteFailedNotification: false,
      handleOverlayAfterTranscription: vi.fn(),
      transcribeWithEngineFallback,
      preferences: { getPreference: vi.fn(() => 'whisper') },
      screenshotMetadata: [
        { capturedAtMs: 500, figureLabel: '1', figureId: 'fig01' },
        { capturedAtMs: 1600, figureLabel: '2', figureId: 'fig02' },
        { capturedAtMs: 2500, figureLabel: '3', figureId: 'fig03' },
      ],
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    await manager.stopRecordingAndTranscribe();

    expect(transcribeWithEngineFallback).not.toHaveBeenCalled();
    expect(manager.emit).toHaveBeenCalledWith(
      'result',
      'first chunk [Figure 1] second chunk [Figure 2] third chunk [Figure 3]'
    );
  });
});
