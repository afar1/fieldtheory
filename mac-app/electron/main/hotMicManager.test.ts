import { afterEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => {
  const createServer = vi.fn(() => ({
    on: vi.fn(),
    listen: vi.fn((_port: number, _host: string, callback?: () => void) => callback?.()),
    close: vi.fn(),
  }));

  const exec = vi.fn((_cmd: string, callback?: (...args: any[]) => void) => {
    callback?.(null, '', '');
    return {} as any;
  });

  const spawn = vi.fn(() => ({
    unref: vi.fn(),
  }));

  return { createServer, exec, spawn };
});

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp') },
  globalShortcut: {
    register: vi.fn(),
    unregister: vi.fn(),
    unregisterAll: vi.fn(),
    isRegistered: vi.fn(() => false),
  },
}));

vi.mock('http', () => ({
  default: { createServer: testState.createServer },
  createServer: testState.createServer,
}));

vi.mock('child_process', () => ({
  default: {
    exec: testState.exec,
    spawn: testState.spawn,
  },
  exec: testState.exec,
  spawn: testState.spawn,
}));

vi.mock('./modelManager', () => ({
  ModelManager: class {
    setSelectedModel = vi.fn();
  },
}));

vi.mock('./hotkeyManager', () => ({
  getHotkeyManager: () => ({
    register: vi.fn(() => ({ success: true })),
    unregister: vi.fn(),
  }),
}));

vi.mock('./logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { HotMicManager } from './hotMicManager';

function createManager(preferences: Record<string, unknown> = {}) {
  const nativeHelper = {
    getFrontmostApp: vi.fn(() => ({ bundleId: 'com.mitchellh.ghostty', name: 'Ghostty' })),
    typeIntoApp: vi.fn(async () => ({ success: true })),
    setHarvestMode: vi.fn(),
    startRecording: vi.fn(async () => undefined),
    cancelRecording: vi.fn(async () => undefined),
    isRecordingActive: vi.fn(() => false),
    on: vi.fn(),
    removeListener: vi.fn(),
  };

  const prefs = {
    getPreference: vi.fn((key: string) => preferences[key]),
    save: vi.fn(async () => undefined),
  };

  const soundManager = {
    play: vi.fn(),
  } as any;
  const manager = new HotMicManager(nativeHelper as any, prefs as any, soundManager);
  const clipboardManager = {
    storeText: vi.fn(async () => 1),
    setClipboardHashFromText: vi.fn(),
    syncClipboardHash: vi.fn(),
  };
  manager.setClipboardManager(clipboardManager as any);
  return { manager, nativeHelper, prefs, clipboardManager };
}

describe('HotMicManager run-command phrases', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('documents that saying "start codex" uses the same submit mechanic and types "codex"', async () => {
    const { manager, nativeHelper } = createManager();

    const tailMatch = await (manager as any).matchTailCommand('start codex');
    expect(tailMatch?.commandName).toBe('start codex');

    await tailMatch?.action?.();
    expect(nativeHelper.typeIntoApp).toHaveBeenCalledWith('com.mitchellh.ghostty', 'codex', true);

    manager.destroy();
  });

  it('documents that custom Codex phrases from preferences are honored', async () => {
    const { manager, nativeHelper } = createManager({
      hotMicRunCodexWords: 'launch codex, run codex now',
    });

    const tailMatch = await (manager as any).matchTailCommand('launch codex');
    expect(tailMatch?.commandName).toBe('start codex');

    await tailMatch?.action?.();
    expect(nativeHelper.typeIntoApp).toHaveBeenCalledWith('com.mitchellh.ghostty', 'codex', true);

    manager.destroy();
  });
});

describe('HotMicManager clipboard hash sync', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('resyncs clipboard hash when helper injection fails after pre-sync', async () => {
    const { manager, nativeHelper, clipboardManager } = createManager();
    nativeHelper.typeIntoApp.mockResolvedValueOnce({ success: false });

    const result = await (manager as any).typeIntoAppWithClipboardSync(
      'com.mitchellh.ghostty',
      'hello world',
      false
    );

    expect(result.success).toBe(false);
    expect(clipboardManager.setClipboardHashFromText).toHaveBeenCalledWith('hello world');
    expect(clipboardManager.syncClipboardHash).toHaveBeenCalledTimes(1);

    manager.destroy();
  });
});

describe('HotMicManager app hide by name', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('supports "hide <app>" using running app and alias matching', async () => {
    const { manager } = createManager();
    manager.setAppSwitcher({
      getRunningApps: vi.fn(async () => [
        { bundleId: 'com.tinyspeck.slackmacgap', name: 'Slack' },
      ]),
      activateApp: vi.fn(async () => true),
    } as any);

    const tailMatch = await (manager as any).matchTailCommand('hide slack');
    expect(tailMatch?.commandName).toBe('hide-app:Slack');

    await tailMatch?.action?.();
    expect(testState.exec).toHaveBeenCalledWith(
      expect.stringContaining('bundle identifier is "com.tinyspeck.slackmacgap"'),
      expect.any(Function)
    );

    manager.destroy();
  });
});

describe('HotMicManager transcript history persistence', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('documents that submitted Hot Mic transcripts with more than five words are saved to transcript history', async () => {
    const { manager, clipboardManager } = createManager();

    await (manager as any).processListeningChunk('alpha beta gamma delta epsilon zeta go ahead');
    await Promise.resolve();

    expect(clipboardManager.storeText).toHaveBeenCalledWith(
      'alpha beta gamma delta epsilon zeta',
      'transcript'
    );

    manager.destroy();
  });

  it('documents that Hot Mic transcript fragments of five words or fewer are excluded from transcript history', async () => {
    const { manager, clipboardManager } = createManager();

    await (manager as any).processListeningChunk('alpha beta gamma delta epsilon go ahead');
    await Promise.resolve();

    expect(clipboardManager.storeText).not.toHaveBeenCalled();

    manager.destroy();
  });

  it('counts short Hot Mic transcript fragments toward cumulative transcribed words even when history is skipped', async () => {
    const { manager, clipboardManager } = createManager();
    const recordWords = vi.fn();
    manager.setMetricsWordsRecorder(recordWords);

    await (manager as any).processListeningChunk('alpha beta gamma delta epsilon go ahead');
    await Promise.resolve();

    expect(recordWords).toHaveBeenCalledWith(5);
    expect(clipboardManager.storeText).not.toHaveBeenCalled();

    manager.destroy();
  });

  it('documents that spoken buffers above five words are saved on silence timeout even without submit words', async () => {
    vi.useFakeTimers();
    try {
      const { manager, clipboardManager } = createManager();
      (manager as any).state = 'listening';
      (manager as any).transcriptBuffer = ['alpha beta gamma delta epsilon zeta'];

      (manager as any).resetBufferDiscardTimer();
      vi.advanceTimersByTime(4000);
      await Promise.resolve();

      expect(clipboardManager.storeText).toHaveBeenCalledWith(
        'alpha beta gamma delta epsilon zeta',
        'transcript'
      );

      manager.destroy();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('HotMicManager drawer preview threshold', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('only shows drawer transcript after at least 3 buffered words', async () => {
    const { manager } = createManager();
    const dynamicIslandManager = {
      updateDrawerTranscript: vi.fn(),
      updateHotMicBackgroundFilterMeter: vi.fn(),
    };
    manager.setDynamicIslandManager(dynamicIslandManager as any);

    await (manager as any).processListeningChunk('hello');
    expect(dynamicIslandManager.updateDrawerTranscript).toHaveBeenLastCalledWith('');

    await (manager as any).processListeningChunk('world');
    expect(dynamicIslandManager.updateDrawerTranscript).toHaveBeenLastCalledWith('');

    await (manager as any).processListeningChunk('again');
    expect(dynamicIslandManager.updateDrawerTranscript).toHaveBeenLastCalledWith('hello world again');

    manager.destroy();
  });
});

describe('HotMicManager transcript dismissal', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('clears the live buffer while keeping hot mic active when dismiss is requested', () => {
    const { manager, nativeHelper } = createManager();
    const dynamicIslandManager = {
      updateDrawerTranscript: vi.fn(),
      updateHotMic: vi.fn(),
      updateHotMicBackgroundFilterMeter: vi.fn(),
    };
    manager.setDynamicIslandManager(dynamicIslandManager as any);

    (manager as any).state = 'listening';
    (manager as any).muted = false;
    (manager as any).transcriptBuffer = ['alpha beta gamma'];

    manager.dismissCurrentTranscript();

    expect((manager as any).transcriptBuffer).toEqual([]);
    expect(dynamicIslandManager.updateDrawerTranscript).toHaveBeenCalledWith('');
    expect(dynamicIslandManager.updateHotMic).toHaveBeenCalledWith(true, 0, '');
    expect(nativeHelper.setHarvestMode).toHaveBeenCalledWith('command');

    manager.destroy();
  });
});

describe('HotMicManager background voice filter', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('keeps chunks when background filter is disabled', () => {
    const { manager } = createManager({
      hotMicBackgroundFilterEnabled: false,
      hotMicBackgroundFilterStrength: 100,
    });

    const result = (manager as any).evaluateChunkBackgroundFilter({
      sampleCount: 20,
      speechSamples: 2,
      speechRatio: 0.1,
      rawAverage: 0.012,
      speechAverage: 0.01,
      rawPeak: 0.03,
      speechPeak: 0.02,
    });

    expect(result.suppressed).toBe(false);
    manager.destroy();
  });

  it('suppresses low-energy chunks when background filter is enabled and strict', () => {
    const { manager } = createManager({
      hotMicBackgroundFilterEnabled: true,
      hotMicBackgroundFilterStrength: 90,
    });

    const result = (manager as any).evaluateChunkBackgroundFilter({
      sampleCount: 24,
      speechSamples: 3,
      speechRatio: 0.125,
      rawAverage: 0.018,
      speechAverage: 0.015,
      rawPeak: 0.03,
      speechPeak: 0.029,
    });

    expect(result.suppressed).toBe(true);
    manager.destroy();
  });

  it('keeps sustained near-field speech when background filter is enabled', () => {
    const { manager } = createManager({
      hotMicBackgroundFilterEnabled: true,
      hotMicBackgroundFilterStrength: 70,
    });

    const result = (manager as any).evaluateChunkBackgroundFilter({
      sampleCount: 30,
      speechSamples: 17,
      speechRatio: 0.56,
      rawAverage: 0.12,
      speechAverage: 0.16,
      rawPeak: 0.32,
      speechPeak: 0.32,
    });

    expect(result.suppressed).toBe(false);
    manager.destroy();
  });

  it('emits live background-filter meter payloads to Dynamic Island', () => {
    const { manager } = createManager({
      hotMicBackgroundFilterEnabled: true,
      hotMicBackgroundFilterStrength: 50,
    });

    const updateHotMicBackgroundFilterMeter = vi.fn();
    manager.setDynamicIslandManager({
      updateHotMicBackgroundFilterMeter,
      updateDrawerTranscript: vi.fn(),
    } as any);

    (manager as any).trackChunkAudioLevel(0.2, true);

    expect(updateHotMicBackgroundFilterMeter).toHaveBeenCalledTimes(1);
    const payload = updateHotMicBackgroundFilterMeter.mock.calls[0]?.[0];
    expect(payload.enabled).toBe(true);
    expect(payload.strength).toBe(50);
    expect(payload.rawLevel).toBeGreaterThan(0);
    manager.destroy();
  });
});

describe('HotMicManager transcriber handoff', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('does not restart recording on idle transitions unless hot mic previously yielded', async () => {
    const { manager, nativeHelper } = createManager();
    (manager as any).state = 'listening';

    await manager.resumeAfterTranscriber();

    expect(nativeHelper.startRecording).not.toHaveBeenCalled();
    manager.destroy();
  });

  it('yields and resumes recording exactly once for normal transcriber handoff', async () => {
    const { manager, nativeHelper } = createManager();
    (manager as any).state = 'listening';
    nativeHelper.isRecordingActive
      .mockReturnValueOnce(true)   // yield path
      .mockReturnValueOnce(false); // resume path

    await manager.yieldToTranscriber();
    await manager.resumeAfterTranscriber();

    expect(nativeHelper.cancelRecording).toHaveBeenCalledTimes(1);
    expect(nativeHelper.startRecording).toHaveBeenCalledTimes(1);
    manager.destroy();
  });

  it('skips restart when helper is already recording during resume', async () => {
    const { manager, nativeHelper } = createManager();
    (manager as any).state = 'listening';
    nativeHelper.isRecordingActive.mockReturnValue(true);

    await manager.yieldToTranscriber();
    await manager.resumeAfterTranscriber();

    expect(nativeHelper.startRecording).not.toHaveBeenCalled();
    manager.destroy();
  });
});

// ===========================================================================
// Runtime condition tracking
// ===========================================================================

describe('HotMicManager runtime condition', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('starts with null condition when idle', () => {
    const { manager } = createManager();
    expect(manager.getCondition()).toBe(null);
    manager.destroy();
  });

  it('transitions to warming then ready when warmup function is provided', async () => {
    const { manager } = createManager();
    const conditions: (string | null)[] = [];
    manager.on('runtimeStatusChanged', (status: any) => {
      conditions.push(status.condition);
    });

    let resolveWarmup!: () => void;
    const warmupPromise = new Promise<void>(r => { resolveWarmup = r; });
    manager.setWarmupFunction(() => warmupPromise);

    (manager as any).targetBundleId = 'com.test.app';
    await (manager as any).startListening();

    expect(manager.getCondition()).toBe('warming');

    resolveWarmup();
    await warmupPromise;
    await Promise.resolve();

    expect(manager.getCondition()).toBe('ready');
    expect(conditions).toContain('warming');
    expect(conditions).toContain('ready');

    manager.destroy();
  });

  it('transitions to degraded when warmup fails', async () => {
    const { manager } = createManager();
    manager.setWarmupFunction(() => Promise.reject(new Error('warmup failed')));

    (manager as any).targetBundleId = 'com.test.app';
    await (manager as any).startListening();
    await Promise.resolve();
    await Promise.resolve();

    expect(manager.getCondition()).toBe('degraded');
    manager.destroy();
  });

  it('sets condition to ready immediately when no warmup function', async () => {
    const { manager } = createManager();
    (manager as any).targetBundleId = 'com.test.app';
    await (manager as any).startListening();

    expect(manager.getCondition()).toBe('ready');
    manager.destroy();
  });

  it('sets condition to yielded during transcriber handoff', async () => {
    const { manager, nativeHelper } = createManager();
    (manager as any).state = 'listening';
    nativeHelper.isRecordingActive.mockReturnValueOnce(true);

    await manager.yieldToTranscriber();
    expect(manager.getCondition()).toBe('yielded');
    manager.destroy();
  });

  it('restores condition to ready after resume from yield', async () => {
    const { manager, nativeHelper } = createManager();
    (manager as any).state = 'listening';
    nativeHelper.isRecordingActive
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);

    await manager.yieldToTranscriber();
    expect(manager.getCondition()).toBe('yielded');

    await manager.resumeAfterTranscriber();
    expect(manager.getCondition()).toBe('ready');
    manager.destroy();
  });

  it('sets condition to muted on mute and back to ready on unmute', async () => {
    const { manager, nativeHelper } = createManager();
    (manager as any).state = 'listening';
    nativeHelper.isRecordingActive.mockReturnValue(false);

    const dynamicIslandManager = {
      sendMuteState: vi.fn(),
      updateHotMic: vi.fn(),
      updateHotMicBackgroundFilterMeter: vi.fn(),
      updateDrawerTranscript: vi.fn(),
    };
    manager.setDynamicIslandManager(dynamicIslandManager as any);

    await manager.toggleMute();
    expect(manager.getCondition()).toBe('muted');

    await manager.toggleMute();
    expect(manager.getCondition()).toBe('ready');
    manager.destroy();
  });

  it('clears condition to null when state returns to idle', () => {
    const { manager } = createManager();
    (manager as any).state = 'listening';
    (manager as any).setCondition('ready');
    expect(manager.getCondition()).toBe('ready');

    (manager as any).setState('idle');
    expect(manager.getCondition()).toBe(null);
    manager.destroy();
  });
});

// ===========================================================================
// Runtime status
// ===========================================================================

describe('HotMicManager runtime status', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns a complete runtime status object', () => {
    const { manager } = createManager();
    const status = manager.getRuntimeStatus();

    expect(status).toMatchObject({
      state: 'idle',
      condition: null,
      engineReady: false,
      whisperFallbackActive: false,
      queueDepth: 0,
      chunksReceived: 0,
      micHealthy: true,
    });
    expect(status.lastChunkAgeMs).toBe(null);
    manager.destroy();
  });

  it('emits runtimeStatusChanged on condition transitions', () => {
    const { manager } = createManager();
    const statuses: any[] = [];
    manager.on('runtimeStatusChanged', (s: any) => statuses.push(s));

    (manager as any).setCondition('warming');
    (manager as any).setCondition('ready');

    expect(statuses).toHaveLength(2);
    expect(statuses[0].condition).toBe('warming');
    expect(statuses[1].condition).toBe('ready');
    manager.destroy();
  });

  it('reports mic as unhealthy when last chunk is stale', () => {
    const { manager } = createManager();
    (manager as any).state = 'listening';
    (manager as any).condition = 'ready';
    (manager as any).lastChunkReadyMs = Date.now() - 15_000;

    const status = manager.getRuntimeStatus();
    expect(status.micHealthy).toBe(false);
    manager.destroy();
  });

  it('reports mic as healthy when last chunk is recent', () => {
    const { manager } = createManager();
    (manager as any).state = 'listening';
    (manager as any).condition = 'ready';
    (manager as any).lastChunkReadyMs = Date.now() - 2_000;

    const status = manager.getRuntimeStatus();
    expect(status.micHealthy).toBe(true);
    manager.destroy();
  });

  it('always reports mic as healthy when idle', () => {
    const { manager } = createManager();
    (manager as any).lastChunkReadyMs = Date.now() - 999_999;

    const status = manager.getRuntimeStatus();
    expect(status.micHealthy).toBe(true);
    manager.destroy();
  });

  it('always reports mic as healthy when yielded', () => {
    const { manager } = createManager();
    (manager as any).state = 'listening';
    (manager as any).condition = 'yielded';
    (manager as any).lastChunkReadyMs = Date.now() - 999_999;

    const status = manager.getRuntimeStatus();
    expect(status.micHealthy).toBe(true);
    manager.destroy();
  });

  it('tracks chunks received count', () => {
    const { manager } = createManager();
    (manager as any).chunksReceivedCount = 42;

    const status = manager.getRuntimeStatus();
    expect(status.chunksReceived).toBe(42);
    manager.destroy();
  });
});

// ===========================================================================
// Chunk queue backpressure
// ===========================================================================

describe('HotMicManager chunk queue backpressure', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('drops oldest chunks when queue exceeds MAX_CHUNK_QUEUE_DEPTH', () => {
    const { manager } = createManager();
    const queue = (manager as any).pendingChunkQueue;
    const maxDepth = (HotMicManager as any).MAX_CHUNK_QUEUE_DEPTH ?? 8;

    for (let i = 0; i < maxDepth; i++) {
      queue.push({ filePath: `/tmp/chunk-${i}.wav`, audioStats: {} });
    }
    expect(queue.length).toBe(maxDepth);

    (manager as any).enqueueChunkForTranscription(`/tmp/chunk-overflow.wav`, {
      sampleCount: 10, speechSamples: 5, speechRatio: 0.5,
      rawAverage: 0.1, speechAverage: 0.1, rawPeak: 0.2, speechPeak: 0.2,
    });

    expect(queue.length).toBeLessThanOrEqual(maxDepth);
    const paths = queue.map((c: any) => c.filePath);
    expect(paths).not.toContain('/tmp/chunk-0.wav');
    expect(paths).toContain('/tmp/chunk-overflow.wav');
    manager.destroy();
  });

  it('increments chunksReceivedCount on every enqueue', () => {
    const { manager } = createManager();
    expect((manager as any).chunksReceivedCount).toBe(0);

    (manager as any).enqueueChunkForTranscription('/tmp/c1.wav', {
      sampleCount: 10, speechSamples: 5, speechRatio: 0.5,
      rawAverage: 0.1, speechAverage: 0.1, rawPeak: 0.2, speechPeak: 0.2,
    });

    expect((manager as any).chunksReceivedCount).toBe(1);
    manager.destroy();
  });

  it('reports queue depth in runtime status', () => {
    const { manager } = createManager();
    const queue = (manager as any).pendingChunkQueue;
    queue.push({ filePath: '/tmp/a.wav', audioStats: {} });
    queue.push({ filePath: '/tmp/b.wav', audioStats: {} });

    const status = manager.getRuntimeStatus();
    expect(status.queueDepth).toBe(2);
    manager.destroy();
  });
});

// ===========================================================================
// Whisper fallback tracking
// ===========================================================================

describe('HotMicManager whisper fallback detection', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('sets condition to degraded when fallback check returns true after transcription', async () => {
    const { manager } = createManager();
    (manager as any).state = 'listening';
    (manager as any).condition = 'ready';

    manager.setFallbackCheckFunction(() => true);
    manager.setTranscribeFunction(async () => 'hello world');

    await (manager as any).onChunkReady({
      filePath: '/tmp/test.wav',
      audioStats: {
        sampleCount: 20, speechSamples: 10, speechRatio: 0.5,
        rawAverage: 0.1, speechAverage: 0.1, rawPeak: 0.3, speechPeak: 0.3,
      },
    });

    expect(manager.getCondition()).toBe('degraded');
    expect((manager as any).whisperFallbackActive).toBe(true);
    manager.destroy();
  });

  it('stays ready when fallback check returns false', async () => {
    const { manager } = createManager();
    (manager as any).state = 'listening';
    (manager as any).condition = 'ready';

    manager.setFallbackCheckFunction(() => false);
    manager.setTranscribeFunction(async () => 'hello world');

    await (manager as any).onChunkReady({
      filePath: '/tmp/test.wav',
      audioStats: {
        sampleCount: 20, speechSamples: 10, speechRatio: 0.5,
        rawAverage: 0.1, speechAverage: 0.1, rawPeak: 0.3, speechPeak: 0.3,
      },
    });

    expect(manager.getCondition()).toBe('ready');
    expect((manager as any).whisperFallbackActive).toBe(false);
    manager.destroy();
  });

  it('reflects whisperFallbackActive in runtime status', () => {
    const { manager } = createManager();
    (manager as any).whisperFallbackActive = true;

    const status = manager.getRuntimeStatus();
    expect(status.whisperFallbackActive).toBe(true);
    manager.destroy();
  });

  it('resets whisperFallbackActive on cleanup', () => {
    const { manager } = createManager();
    (manager as any).whisperFallbackActive = true;
    (manager as any).cleanup();

    expect((manager as any).whisperFallbackActive).toBe(false);
    manager.destroy();
  });
});
