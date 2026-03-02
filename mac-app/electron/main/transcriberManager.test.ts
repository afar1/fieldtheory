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

import { clipboard } from 'electron';
import { TranscriberManager } from './transcriberManager';

// Command queue tests for Qwen/MLX Whisper are now covered by stdioJsonServer.test.ts,
// since both engines use the shared StdioJsonServer class.

function createWarmupHarness(prefValues: Record<string, unknown>) {
  const startQwenServer = vi.fn(async () => {});
  const startMlxWhisperServer = vi.fn(async () => {});
  const startWhisperServer = vi.fn(async () => {});
  const manager: any = {
    preferences: {
      getPreference: (key: string) => prefValues[key],
    },
    startQwenServer,
    startMlxWhisperServer,
    startWhisperServer,
    isMlxWhisperInstalled: () => true,
    isWhisperServerAvailable: () => true,
  };
  Object.setPrototypeOf(manager, TranscriberManager.prototype);
  return { manager, startQwenServer, startMlxWhisperServer, startWhisperServer };
}

function createRestartHarness(prefValues: Record<string, unknown>) {
  const stopQwenServer = vi.fn();
  const stopMlxWhisperServer = vi.fn();
  const stopWhisperServer = vi.fn();
  const startQwenServer = vi.fn(async () => {});
  const startMlxWhisperServer = vi.fn(async () => {});
  const startWhisperServer = vi.fn(async () => {});
  const manager: any = {
    preferences: {
      getPreference: (key: string) => prefValues[key],
    },
    stopQwenServer,
    stopMlxWhisperServer,
    stopWhisperServer,
    startQwenServer,
    startMlxWhisperServer,
    startWhisperServer,
    isMlxWhisperInstalled: () => true,
    isWhisperServerAvailable: () => true,
  };
  Object.setPrototypeOf(manager, TranscriberManager.prototype);
  return { manager, stopQwenServer, stopMlxWhisperServer, stopWhisperServer, startQwenServer, startMlxWhisperServer, startWhisperServer };
}

function createHotMicWarmupHarness(prefValues: Record<string, unknown>) {
  const startQwenServer = vi.fn(async () => {});
  const startMlxWhisperServer = vi.fn(async () => {});
  const startWhisperServer = vi.fn(async () => {});
  const manager: any = {
    preferences: {
      getPreference: (key: string) => prefValues[key],
    },
    modelManager: {
      getSelectedModel: () => 'small',
    },
    startQwenServer,
    startMlxWhisperServer,
    startWhisperServer,
    isMlxWhisperInstalled: () => true,
    isWhisperServerAvailable: () => true,
  };
  Object.setPrototypeOf(manager, TranscriberManager.prototype);
  return { manager, startQwenServer, startMlxWhisperServer, startWhisperServer };
}

describe('TranscriberManager warmup', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('warms Qwen when primary transcription engine is qwen', async () => {
    const { manager, startQwenServer, startMlxWhisperServer } = createWarmupHarness({
      transcriptionEngine: 'qwen',
      hotMicTranscriptionEngine: 'default',
    });

    await manager.warmup();

    expect(startQwenServer).toHaveBeenCalledTimes(1);
    expect(startMlxWhisperServer).not.toHaveBeenCalled();
  });

  it('ignores Hot Mic override and warms only the global engine', async () => {
    const { manager, startQwenServer, startWhisperServer } = createWarmupHarness({
      transcriptionEngine: 'whisper',
      hotMicTranscriptionEngine: 'qwen',
    });

    await manager.warmup();

    expect(startQwenServer).not.toHaveBeenCalled();
    expect(startWhisperServer).toHaveBeenCalledTimes(1);
  });

  it('warms MLX Whisper when primary engine is mlx-whisper', async () => {
    const { manager, startQwenServer, startMlxWhisperServer } = createWarmupHarness({
      transcriptionEngine: 'mlx-whisper',
      hotMicTranscriptionEngine: 'default',
    });

    await manager.warmup();

    expect(startMlxWhisperServer).toHaveBeenCalledTimes(1);
    expect(startQwenServer).not.toHaveBeenCalled();
  });

  it('ignores Hot Mic MLX override and uses global whisper warmup path', async () => {
    const { manager, startMlxWhisperServer, startWhisperServer } = createWarmupHarness({
      transcriptionEngine: 'whisper',
      hotMicTranscriptionEngine: 'mlx-whisper',
    });

    await manager.warmup();

    expect(startMlxWhisperServer).not.toHaveBeenCalled();
    expect(startWhisperServer).toHaveBeenCalledTimes(1);
  });

  it('skips all server warmups when engine is whisper and no server binary', async () => {
    const { manager, startQwenServer, startMlxWhisperServer } = createWarmupHarness({
      transcriptionEngine: 'whisper',
      hotMicTranscriptionEngine: 'whisper',
    });
    manager.isWhisperServerAvailable = () => false;
    manager.isMlxWhisperInstalled = () => false;

    await manager.warmup();

    expect(startQwenServer).not.toHaveBeenCalled();
    expect(startMlxWhisperServer).not.toHaveBeenCalled();
  });
});

describe('TranscriberManager fallback tracking', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('exposes isQwenDisabledForSession as false by default', () => {
    const manager: any = {
      qwenServer: null,
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);
    expect(manager.isQwenDisabledForSession()).toBe(false);
  });

  it('reports qwen as disabled when server disabledReason is set', () => {
    const manager: any = {
      qwenServer: { disabledReason: 'MLX runtime crashed' },
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

describe('TranscriberManager hot mic warmup', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('awaits MLX Whisper startup before resolving', async () => {
    let releaseStart!: () => void;
    const { manager, startMlxWhisperServer } = createHotMicWarmupHarness({
      transcriptionEngine: 'mlx-whisper',
    });

    startMlxWhisperServer.mockImplementationOnce(
      () => new Promise<void>((resolve) => { releaseStart = () => resolve(); })
    );

    let settled = false;
    const warmupPromise = manager.warmupForHotMic().then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);
    expect(startMlxWhisperServer).toHaveBeenCalledTimes(1);

    releaseStart();
    await warmupPromise;
    expect(settled).toBe(true);
  });

  it('awaits Whisper server startup before resolving', async () => {
    let releaseStart!: () => void;
    const { manager, startWhisperServer } = createHotMicWarmupHarness({
      transcriptionEngine: 'whisper',
    });

    startWhisperServer.mockImplementationOnce(
      () => new Promise<void>((resolve) => { releaseStart = () => resolve(); })
    );

    let settled = false;
    const warmupPromise = manager.warmupForHotMic().then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);
    expect(startWhisperServer).toHaveBeenCalledWith('small');

    releaseStart();
    await warmupPromise;
    expect(settled).toBe(true);
  });
});

describe('TranscriberManager runtime restart', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('restarts only the global engine and ignores Hot Mic override', async () => {
    const h = createRestartHarness({
      transcriptionEngine: 'whisper',
      hotMicTranscriptionEngine: 'qwen',
    });

    await h.manager.restartTranscriptionRuntime();

    // All servers should be stopped on restart.
    expect(h.stopQwenServer).toHaveBeenCalledTimes(1);
    expect(h.stopMlxWhisperServer).toHaveBeenCalledTimes(1);
    expect(h.stopWhisperServer).toHaveBeenCalledTimes(1);

    // Only the active engines should be re-started.
    expect(h.startQwenServer).not.toHaveBeenCalled();
    expect(h.startWhisperServer).toHaveBeenCalledTimes(1);
    expect(h.startMlxWhisperServer).not.toHaveBeenCalled();
  });

  it('stops all servers without restarting when both engines are whisper and no server binary', async () => {
    const h = createRestartHarness({
      transcriptionEngine: 'whisper',
      hotMicTranscriptionEngine: 'whisper',
    });
    h.manager.isWhisperServerAvailable = () => false;

    await h.manager.restartTranscriptionRuntime();

    expect(h.stopQwenServer).toHaveBeenCalledTimes(1);
    expect(h.stopMlxWhisperServer).toHaveBeenCalledTimes(1);
    expect(h.startQwenServer).not.toHaveBeenCalled();
    expect(h.startMlxWhisperServer).not.toHaveBeenCalled();
  });

  it('restarts mlx-whisper when it is the active engine', async () => {
    const h = createRestartHarness({
      transcriptionEngine: 'mlx-whisper',
      hotMicTranscriptionEngine: 'default',
    });

    await h.manager.restartTranscriptionRuntime();

    expect(h.startMlxWhisperServer).toHaveBeenCalledTimes(1);
    expect(h.startQwenServer).not.toHaveBeenCalled();
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

  it('uses the global engine for Hot Mic even when override is set', async () => {
    const transcribeWithEngineFallback = vi.fn(async () => 'ok');
    const manager: any = {
      preferences: {
        getPreference: (key: string) => {
          if (key === 'transcriptionEngine') return 'whisper';
          if (key === 'hotMicTranscriptionEngine') return 'qwen';
          return undefined;
        },
      },
      modelManager: {
        getSelectedModel: () => 'small',
      },
      transcribeWithEngineFallback,
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    await manager.transcribeAudioForHotMic('/tmp/test.wav');

    expect(transcribeWithEngineFallback).toHaveBeenCalledWith('/tmp/test.wav', 'whisper', {
      allowWhisperFallback: true,
      whisperModelOverride: 'small',
    });
  });
});

describe('TranscriberManager Hot Mic engine status', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('reports not-downloaded when global Whisper model is missing', () => {
    const manager: any = {
      preferences: {
        getPreference: (key: string) => key === 'transcriptionEngine' ? 'whisper' : undefined,
      },
      modelManager: {
        getSelectedModel: () => 'small',
        getModelHealthForSizeSync: () => ({ status: 'missing' }),
      },
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    const status = manager.getHotMicEngineStatus();
    expect(status.selectedEngine).toBe('whisper');
    expect(status.readiness).toBe('not-downloaded');
  });

  it('reports corrupt when global Whisper model is incomplete', () => {
    const manager: any = {
      preferences: {
        getPreference: (key: string) => key === 'transcriptionEngine' ? 'whisper' : undefined,
      },
      modelManager: {
        getSelectedModel: () => 'small',
        getModelHealthForSizeSync: () => ({ status: 'corrupt' }),
      },
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    const status = manager.getHotMicEngineStatus();
    expect(status.selectedEngine).toBe('whisper');
    expect(status.readiness).toBe('corrupt');
  });

  it('reports unsupported-arch for qwen on non-Apple Silicon', () => {
    const manager: any = {
      preferences: {
        getPreference: (key: string) => key === 'transcriptionEngine' ? 'qwen' : undefined,
      },
      modelManager: {
        getSelectedModel: () => 'small',
        getModelHealthForSizeSync: () => ({ status: 'ready' }),
      },
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    const archSpy = vi.spyOn(process, 'arch', 'get').mockReturnValue('x64');
    const status = manager.getHotMicEngineStatus();
    archSpy.mockRestore();

    expect(status.selectedEngine).toBe('qwen');
    expect(status.readiness).toBe('unsupported-arch');
    expect(status.fallbackAvailable).toBe(true);
  });

  it('reports warming when qwen server is starting', () => {
    const manager: any = {
      preferences: {
        getPreference: (key: string) => key === 'transcriptionEngine' ? 'qwen' : undefined,
      },
      modelManager: {
        getSelectedModel: () => 'small',
        getModelHealthForSizeSync: () => ({ status: 'ready' }),
      },
      isQwenInstalledSync: () => true,
      qwenServer: { isStarting: true, isReady: false },
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    const archSpy = vi.spyOn(process, 'arch', 'get').mockReturnValue('arm64');
    const status = manager.getHotMicEngineStatus();
    archSpy.mockRestore();

    expect(status.selectedEngine).toBe('qwen');
    expect(status.readiness).toBe('warming');
  });

  it('reports disabled when mlx-whisper runtime has fatal session disable reason', () => {
    const manager: any = {
      preferences: {
        getPreference: (key: string) => key === 'transcriptionEngine' ? 'mlx-whisper' : undefined,
      },
      modelManager: {
        getSelectedModel: () => 'small',
        getModelHealthForSizeSync: () => ({ status: 'ready' }),
      },
      isMlxWhisperInstalled: () => true,
      mlxWhisperServer: { disabledReason: 'ImportError: mlx_whisper not installed' },
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    const archSpy = vi.spyOn(process, 'arch', 'get').mockReturnValue('arm64');
    const status = manager.getHotMicEngineStatus();
    archSpy.mockRestore();

    expect(status.selectedEngine).toBe('mlx-whisper');
    expect(status.readiness).toBe('disabled');
    expect(status.detail).toContain('ImportError');
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

describe('TranscriberManager standard paste target fallback', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('pastes into last external target when Field Theory is frontmost', async () => {
    const typeIntoApp = vi.fn(async () => ({ success: true }));
    const manager: any = {
      sketchModeChecker: null,
      clipboardManager: {
        getItem: vi.fn((id: number) => (id === 1 ? { id: 1, type: 'transcript', content: 'hello world' } : null)),
        setClipboardHashFromText: vi.fn(),
        syncClipboardHash: vi.fn(),
      },
      currentStack: [1],
      detectedCommands: [],
      getFrontmostAppBundleId: vi.fn(async () => 'com.fieldtheory.app'),
      nativeHelper: {
        getFrontmostApp: vi.fn(() => ({ bundleId: 'com.mitchellh.ghostty' })),
        typeIntoApp,
      },
      lastExternalPasteTargetBundleId: null,
      lastTranscription: 'hello world',
      emit: vi.fn(),
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    await manager.pasteStack(false);

    expect(typeIntoApp).toHaveBeenCalledWith('com.mitchellh.ghostty', 'hello world', false);
    expect(manager.emit).not.toHaveBeenCalledWith(
      'paste-failed',
      'Field Theory has focus - press Cmd+V in your target app',
      expect.any(String),
    );
  });

  it('treats dev Electron bundle as Field Theory and falls back to external target', async () => {
    const typeIntoApp = vi.fn(async () => ({ success: true }));
    const manager: any = {
      sketchModeChecker: null,
      clipboardManager: {
        getItem: vi.fn((id: number) => (id === 1 ? { id: 1, type: 'transcript', content: 'hello world' } : null)),
        setClipboardHashFromText: vi.fn(),
        syncClipboardHash: vi.fn(),
      },
      currentStack: [1],
      detectedCommands: [],
      getFrontmostAppBundleId: vi.fn(async () => 'com.github.Electron'),
      nativeHelper: {
        getFrontmostApp: vi.fn(() => ({ bundleId: 'com.mitchellh.ghostty' })),
        typeIntoApp,
      },
      lastExternalPasteTargetBundleId: null,
      lastTranscription: 'hello world',
      emit: vi.fn(),
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    await manager.pasteStack(false);

    expect(typeIntoApp).toHaveBeenCalledWith('com.mitchellh.ghostty', 'hello world', false);
  });

  it('emits paste-failed when Field Theory is frontmost and no external app is known', async () => {
    const typeIntoApp = vi.fn(async () => ({ success: true }));
    const manager: any = {
      sketchModeChecker: null,
      clipboardManager: {
        getItem: vi.fn(() => ({ id: 1, type: 'transcript', content: 'hello world' })),
      },
      currentStack: [1],
      detectedCommands: [],
      getFrontmostAppBundleId: vi.fn(async () => 'com.fieldtheory.app'),
      nativeHelper: {
        getFrontmostApp: vi.fn(() => null),
        typeIntoApp,
      },
      lastExternalPasteTargetBundleId: null,
      lastTranscription: 'hello world',
      emit: vi.fn(),
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    await manager.pasteStack(false);

    expect(typeIntoApp).not.toHaveBeenCalled();
    expect(manager.emit).toHaveBeenCalledWith(
      'paste-failed',
      'Field Theory has focus - press Cmd+V in your target app',
      'hello world',
    );
  });

  it('falls back to clipboard paste when forced target injection fails', async () => {
    const typeIntoApp = vi.fn(async () => ({ success: false, error: 'injection failed' }));
    const clearStack = vi.fn();
    const pasteText = vi.fn(async () => undefined);
    const manager: any = {
      sketchModeChecker: null,
      clipboardManager: {
        getItem: vi.fn(() => ({ id: 1, type: 'transcript', content: 'hello world' })),
        syncClipboardHash: vi.fn(),
      },
      currentStack: [1],
      detectedCommands: [],
      getFrontmostAppBundleId: vi.fn(async () => 'com.fieldtheory.app'),
      nativeHelper: {
        getFrontmostApp: vi.fn(() => ({ bundleId: 'com.mitchellh.ghostty' })),
        typeIntoApp,
      },
      clearStack,
      pasteText,
      lastExternalPasteTargetBundleId: null,
      lastTranscription: 'hello world',
      emit: vi.fn(),
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    await manager.pasteStack(false);

    expect(typeIntoApp).toHaveBeenCalledWith('com.mitchellh.ghostty', 'hello world', false);
    expect(clipboard.writeText).toHaveBeenCalledWith('hello world');
    expect(pasteText).toHaveBeenCalledWith('com.mitchellh.ghostty');
    expect(clearStack).not.toHaveBeenCalled();
  });
});

describe('TranscriberManager standard real-time chunking', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('runs full-file transcription even when real-time transcript text exists', async () => {
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
      modelManager: {
        getSelectedModel: vi.fn(() => 'small'),
        isModelAvailable: vi.fn(async () => true),
      },
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

    expect(transcribeWithEngineFallback).toHaveBeenCalledWith('/tmp/full.wav', 'whisper');
    expect(manager.processStandardChunkQueue).toHaveBeenCalledTimes(1);
    expect(manager.pasteStack).toHaveBeenCalledWith(false);
    expect(manager.emit).toHaveBeenCalledWith('result', 'full file text');
    expect(manager.emit).not.toHaveBeenCalledWith('improvingStarted');
  });

  it('falls back to live transcript when full-file transcription is empty', async () => {
    const transcribeWithEngineFallback = vi.fn(async () => '');
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
      modelManager: {
        getSelectedModel: vi.fn(() => 'small'),
        isModelAvailable: vi.fn(async () => true),
      },
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

    expect(transcribeWithEngineFallback).toHaveBeenCalledWith('/tmp/full.wav', 'whisper');
    expect(manager.pasteStack).toHaveBeenCalledWith(false);
    expect(manager.emit).toHaveBeenCalledWith('result', 'chunked transcript text');
  });

  it('stops recording immediately when a tail Squares command is detected in a chunk', async () => {
    const stopRecordingAndTranscribe = vi.fn(async () => {});
    const manager: any = {
      status: 'recording',
      pendingImmediateSquaresAction: null,
      pendingImmediateSquaresText: '',
      standardLiveTranscript: '',
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

  it('keeps standard finalization on full-file transcription even when figure metadata exists', async () => {
    const transcribeWithEngineFallback = vi.fn(async () => 'full file transcript [Figure 1]');
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
      modelManager: {
        getSelectedModel: vi.fn(() => 'small'),
        isModelAvailable: vi.fn(async () => true),
      },
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

    expect(transcribeWithEngineFallback).toHaveBeenCalledWith('/tmp/full.wav', 'whisper');
    expect(manager.emit).toHaveBeenCalledWith('result', 'full file transcript [Figure 1]');
  });

  it('uses full-file output for final standard transcript even when live chunks exist', async () => {
    const transcribeWithEngineFallback = vi.fn(async () => 'authoritative full transcript');
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
      modelManager: {
        getSelectedModel: vi.fn(() => 'small'),
        isModelAvailable: vi.fn(async () => true),
      },
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

    expect(transcribeWithEngineFallback).toHaveBeenCalledWith('/tmp/full.wav', 'whisper');
    expect(manager.emit).toHaveBeenCalledWith('result', 'authoritative full transcript');
  });

  it('uses immediate tail command text and skips full-file transcription', async () => {
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
      pendingImmediateSquaresAction: 'grid',
      pendingImmediateSquaresText: 'draft layout',
      standardPendingChunkQueue: [],
      trackPriorityMicUsage: vi.fn(async () => {}),
      setStatus: vi.fn(),
      overlay: { showTranscribing: vi.fn() },
      standardLiveTranscript: 'ignored live text',
      sanitizeTranscriptText: vi.fn((text: string) => text.trim()),
      clearStandardLiveTranscript: vi.fn(),
      modelManager: {
        getSelectedModel: vi.fn(() => 'small'),
        isModelAvailable: vi.fn(async () => true),
      },
      squaresManager: {
        executeAction: vi.fn(async () => {}),
      },
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
      screenshotMetadata: [],
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    await manager.stopRecordingAndTranscribe();

    expect(transcribeWithEngineFallback).not.toHaveBeenCalled();
    expect(manager.squaresManager.executeAction).toHaveBeenCalledWith('grid');
    expect(manager.emit).toHaveBeenCalledWith('result', 'draft layout');
  });
});
