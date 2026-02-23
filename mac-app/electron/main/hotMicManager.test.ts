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
