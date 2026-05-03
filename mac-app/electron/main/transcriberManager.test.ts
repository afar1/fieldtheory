import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { EventEmitter } from 'events';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: vi.fn(() => '/tmp'),
    getPath: vi.fn(() => '/tmp'),
    on: vi.fn(),
  },
  systemPreferences: {
    getMediaAccessStatus: vi.fn(() => 'granted'),
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

vi.mock('./transcriberTrace', () => ({
  appendTranscriberTrace: vi.fn(),
  getTranscriberTracePath: vi.fn(() => '/tmp/recording-trace.log'),
}));

import { clipboard } from 'electron';
import { TranscriberManager } from './transcriberManager';

// Command queue tests for MLX Whisper/Parakeet are covered by stdioJsonServer.test.ts,
// since both engines use the shared StdioJsonServer class.

function createWarmupHarness(prefValues: Record<string, unknown>) {
  const startMlxWhisperServer = vi.fn(async () => {});
  const startParakeetServer = vi.fn(async () => {});
  const startWhisperServer = vi.fn(async () => {});
  const manager: any = {
    preferences: {
      getPreference: (key: string) => prefValues[key],
    },
    startParakeetServer,
    startMlxWhisperServer,
    startWhisperServer,
    isParakeetInstalled: () => true,
    isMlxWhisperInstalled: () => true,
    isWhisperServerAvailable: () => true,
  };
  Object.setPrototypeOf(manager, TranscriberManager.prototype);
  return { manager, startMlxWhisperServer, startParakeetServer, startWhisperServer };
}

function createRestartHarness(prefValues: Record<string, unknown>) {
  const stopMlxWhisperServer = vi.fn();
  const stopParakeetServer = vi.fn();
  const stopWhisperServer = vi.fn();
  const startMlxWhisperServer = vi.fn(async () => {});
  const startParakeetServer = vi.fn(async () => {});
  const startWhisperServer = vi.fn(async () => {});
  const manager: any = {
    preferences: {
      getPreference: (key: string) => prefValues[key],
    },
    stopParakeetServer,
    stopMlxWhisperServer,
    stopWhisperServer,
    startParakeetServer,
    startMlxWhisperServer,
    startWhisperServer,
    isParakeetInstalled: () => true,
    isMlxWhisperInstalled: () => true,
    isWhisperServerAvailable: () => true,
  };
  Object.setPrototypeOf(manager, TranscriberManager.prototype);
  return {
    manager,
    stopMlxWhisperServer,
    stopParakeetServer,
    stopWhisperServer,
    startMlxWhisperServer,
    startParakeetServer,
    startWhisperServer,
  };
}

function createHotMicWarmupHarness(prefValues: Record<string, unknown>) {
  const startMlxWhisperServer = vi.fn(async () => {});
  const startParakeetServer = vi.fn(async () => {});
  const startWhisperServer = vi.fn(async () => {});
  const manager: any = {
    preferences: {
      getPreference: (key: string) => prefValues[key],
    },
    modelManager: {
      getSelectedModel: () => 'small',
    },
    startParakeetServer,
    startMlxWhisperServer,
    startWhisperServer,
    isParakeetInstalled: () => true,
    isMlxWhisperInstalled: () => true,
    isWhisperServerAvailable: () => true,
  };
  Object.setPrototypeOf(manager, TranscriberManager.prototype);
  return { manager, startMlxWhisperServer, startParakeetServer, startWhisperServer };
}

describe('TranscriberManager warmup', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('warms MLX Whisper when primary transcription engine is mlx-whisper', async () => {
    const { manager, startMlxWhisperServer } = createWarmupHarness({
      transcriptionEngine: 'mlx-whisper',
      hotMicTranscriptionEngine: 'default',
    });

    await manager.warmup();

    expect(startMlxWhisperServer).toHaveBeenCalledTimes(1);
  });

  it('ignores legacy Hot Mic override values and warms only the global engine', async () => {
    const { manager, startMlxWhisperServer, startWhisperServer } = createWarmupHarness({
      transcriptionEngine: 'whisper',
      hotMicTranscriptionEngine: 'qwen',
    });

    await manager.warmup();

    expect(startMlxWhisperServer).not.toHaveBeenCalled();
    expect(startWhisperServer).toHaveBeenCalledTimes(1);
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
    const { manager, startMlxWhisperServer } = createWarmupHarness({
      transcriptionEngine: 'whisper',
      hotMicTranscriptionEngine: 'whisper',
    });
    manager.isWhisperServerAvailable = () => false;
    manager.isMlxWhisperInstalled = () => false;

    await manager.warmup();

    expect(startMlxWhisperServer).not.toHaveBeenCalled();
  });
});

describe('TranscriberManager whisper-server shutdown', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('waits for the tracked process to exit before clearing the reference', async () => {
    const proc = new EventEmitter() as any;
    proc.exitCode = null;
    proc.signalCode = null;
    proc.kill = vi.fn(() => true);

    const manager: any = {
      whisperServerProcess: proc,
      whisperServerReady: true,
      whisperServerReadyPromise: Promise.resolve(),
      whisperServerShutdownPromise: null,
      whisperServerLifecycleGeneration: 0,
      whisperServerPort: 1234,
      whisperServerModelPath: '/tmp/model.bin',
      terminateTrackedWhisperServer: TranscriberManager.prototype['terminateTrackedWhisperServer'],
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    const stopPromise = manager.stopWhisperServer();

    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    expect(manager.whisperServerProcess).toBe(proc);
    expect(manager.whisperServerReady).toBe(false);

    proc.exitCode = 0;
    proc.emit('close', 0);
    await stopPromise;

    expect(manager.whisperServerProcess).toBeNull();
    expect(manager.whisperServerShutdownPromise).toBeNull();
    expect(manager.whisperServerPort).toBe(0);
    expect(manager.whisperServerModelPath).toBeNull();
  });

  it('escalates to SIGKILL when the tracked process ignores SIGTERM', async () => {
    vi.useFakeTimers();

    const proc = new EventEmitter() as any;
    proc.exitCode = null;
    proc.signalCode = null;
    proc.kill = vi.fn((signal: string) => {
      if (signal === 'SIGKILL') {
        proc.signalCode = 'SIGKILL';
      }
      return true;
    });

    const manager: any = {
      whisperServerProcess: proc,
      whisperServerReady: true,
      whisperServerReadyPromise: Promise.resolve(),
      whisperServerShutdownPromise: null,
      whisperServerLifecycleGeneration: 0,
      whisperServerPort: 1234,
      whisperServerModelPath: '/tmp/model.bin',
      terminateTrackedWhisperServer: TranscriberManager.prototype['terminateTrackedWhisperServer'],
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    const stopPromise = manager.stopWhisperServer();
    await vi.advanceTimersByTimeAsync(TranscriberManager['WHISPER_SERVER_STOP_TIMEOUT_MS']);

    expect(proc.kill).toHaveBeenNthCalledWith(1, 'SIGTERM');
    expect(proc.kill).toHaveBeenNthCalledWith(2, 'SIGKILL');

    proc.emit('close', null);
    await stopPromise;
  });
});

describe('TranscriberManager fallback tracking', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('initializes lastHotMicUsedWhisperFallback to false', () => {
    const manager: any = {
      lastHotMicUsedWhisperFallback: false,
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);
    expect(manager.lastHotMicUsedWhisperFallback).toBe(false);
  });
});

describe('TranscriberManager recording source selection', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('defaults recording source to microphone', () => {
    const manager: any = {
      preferences: {
        getPreference: () => undefined,
      },
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    expect(manager.getRecordingSource()).toBe('microphone');
  });

  it('returns a saved system-audio recording source', () => {
    const manager: any = {
      preferences: {
        getPreference: (key: string) => key === 'transcriptionInputSource' ? 'system-audio' : undefined,
      },
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    expect(manager.getRecordingSource()).toBe('system-audio');
  });

  it('persists recording source changes to preferences', async () => {
    const save = vi.fn(async () => undefined);
    const manager: any = {
      preferences: {
        save,
      },
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    await manager.setRecordingSource('system-audio');

    expect(save).toHaveBeenCalledWith({ transcriptionInputSource: 'system-audio' });
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

  it('defaults Hot Mic warmup to Parakeet when no engine is saved and Parakeet is installed', async () => {
    const { manager, startParakeetServer, startWhisperServer } = createHotMicWarmupHarness({});

    await manager.warmupForHotMic();

    expect(startParakeetServer).toHaveBeenCalledWith('parakeet');
    expect(startWhisperServer).not.toHaveBeenCalled();
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
    expect(h.stopMlxWhisperServer).toHaveBeenCalledTimes(1);
    expect(h.stopWhisperServer).toHaveBeenCalledTimes(1);

    // Only the active engines should be re-started.
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

    expect(h.stopMlxWhisperServer).toHaveBeenCalledTimes(1);
    expect(h.startMlxWhisperServer).not.toHaveBeenCalled();
  });

  it('restarts mlx-whisper when it is the active engine', async () => {
    const h = createRestartHarness({
      transcriptionEngine: 'mlx-whisper',
      hotMicTranscriptionEngine: 'default',
    });

    await h.manager.restartTranscriptionRuntime();

    expect(h.startMlxWhisperServer).toHaveBeenCalledTimes(1);
  });

  it('waits for whisper shutdown before starting a replacement runtime', async () => {
    let releaseStop!: () => void;
    const h = createRestartHarness({
      transcriptionEngine: 'whisper',
      hotMicTranscriptionEngine: 'default',
    });
    h.stopWhisperServer.mockImplementationOnce(
      () => new Promise<void>((resolve) => { releaseStop = resolve; })
    );

    let settled = false;
    const restartPromise = h.manager.restartTranscriptionRuntime().then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(h.startWhisperServer).not.toHaveBeenCalled();
    expect(settled).toBe(false);

    releaseStop();
    await restartPromise;

    expect(h.startWhisperServer).toHaveBeenCalledTimes(1);
    expect(settled).toBe(true);
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
          if (key === 'transcriptionEngine') return 'mlx-whisper';
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

    expect(transcribeWithEngineFallback).toHaveBeenCalledWith('/tmp/test.wav', 'mlx-whisper', {
      allowWhisperFallback: false,
      whisperModelOverride: 'small',
    });
  });

  it('disables whisper fallback by default for Hot Mic', async () => {
    const transcribeWithEngineFallback = vi.fn(async () => 'ok');
    const manager: any = {
      preferences: {
        getPreference: (key: string) => {
          if (key === 'transcriptionEngine') return 'mlx-whisper';
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

    expect(transcribeWithEngineFallback).toHaveBeenCalledWith('/tmp/test.wav', 'mlx-whisper', {
      allowWhisperFallback: false,
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
      allowWhisperFallback: false,
      whisperModelOverride: 'small',
    });
  });

  it('defaults Hot Mic transcription to Parakeet when no engine is saved and Parakeet is installed', async () => {
    const transcribeWithEngineFallback = vi.fn(async () => 'ok');
    const manager: any = {
      preferences: {
        getPreference: () => undefined,
      },
      modelManager: {
        getSelectedModel: () => 'small',
      },
      isParakeetInstalled: () => true,
      transcribeWithEngineFallback,
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    await manager.transcribeAudioForHotMic('/tmp/test.wav');

    expect(transcribeWithEngineFallback).toHaveBeenCalledWith('/tmp/test.wav', 'parakeet', {
      allowWhisperFallback: false,
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

  it('reports unsupported-arch for mlx-whisper on non-Apple Silicon', () => {
    const manager: any = {
      preferences: {
        getPreference: (key: string) => key === 'transcriptionEngine' ? 'mlx-whisper' : undefined,
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

    expect(status.selectedEngine).toBe('mlx-whisper');
    expect(status.readiness).toBe('unsupported-arch');
    expect(status.fallbackAvailable).toBe(true);
  });

  it('reports warming when mlx-whisper server is starting', () => {
    const manager: any = {
      preferences: {
        getPreference: (key: string) => key === 'transcriptionEngine' ? 'mlx-whisper' : undefined,
      },
      modelManager: {
        getSelectedModel: () => 'small',
        getModelHealthForSizeSync: () => ({ status: 'ready' }),
      },
      isMlxWhisperInstalled: () => true,
      mlxWhisperServer: { isStarting: true, isReady: false },
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    const archSpy = vi.spyOn(process, 'arch', 'get').mockReturnValue('arm64');
    const status = manager.getHotMicEngineStatus();
    archSpy.mockRestore();

    expect(status.selectedEngine).toBe('mlx-whisper');
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

describe('TranscriberManager transcript sanitization', () => {
  const createManager = () => {
    const manager: any = {
      preferences: {
        getPreference: () => [],
      },
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);
    return manager;
  };

  it('removes obvious hallucinated filler endings after real content', () => {
    const manager = createManager();

    expect(manager.sanitizeTranscriptText('The build finished cleanly. okay. yeah.')).toBe('the build finished cleanly');
    expect(manager.sanitizeTranscriptText('The build finished cleanly yeah yeah.')).toBe('the build finished cleanly');
  });

  it('keeps short or semantic uses of okay', () => {
    const manager = createManager();

    expect(manager.sanitizeTranscriptText('yeah')).toBe('yeah');
    expect(manager.sanitizeTranscriptText('The current state is okay')).toBe('the current state is okay');
    expect(manager.sanitizeTranscriptText('I said yeah yeah')).toBe('i said yeah yeah');
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
      screenshotMetadata: [],
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

    expect(typeIntoApp).toHaveBeenCalledWith('com.mitchellh.ghostty', 'hello world ', false);
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
      screenshotMetadata: [],
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

    expect(typeIntoApp).toHaveBeenCalledWith('com.mitchellh.ghostty', 'hello world ', false);
  });

  it('inserts into a focused Field Theory markdown editor when Field Theory is frontmost', async () => {
    const typeIntoApp = vi.fn(async () => ({ success: true }));
    const insertText = vi.fn(() => true);
    const manager: any = {
      sketchModeChecker: null,
      clipboardManager: {
        getItem: vi.fn(() => ({ id: 1, type: 'transcript', content: 'hello world' })),
      },
      currentStack: [1],
      detectedCommands: [],
      screenshotMetadata: [],
      getFrontmostAppBundleId: vi.fn(async () => 'com.fieldtheory.app'),
      nativeHelper: {
        getFrontmostApp: vi.fn(() => null),
        typeIntoApp,
      },
      fieldTheoryMarkdownInsertionTarget: {
        isAvailable: vi.fn(() => true),
        insertText,
      },
      lastExternalPasteTargetBundleId: null,
      lastTranscription: 'hello world',
      emit: vi.fn(),
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    await manager.pasteStack(false);

    expect(insertText).toHaveBeenCalledWith('hello world ');
    expect(typeIntoApp).not.toHaveBeenCalled();
    expect(manager.emit).not.toHaveBeenCalledWith(
      'paste-failed',
      'Field Theory has focus - press Cmd+V in your target app',
      expect.any(String),
    );
  });

  it('inserts text and screenshot stacks as markdown into a focused Field Theory editor', async () => {
    const typeIntoApp = vi.fn(async () => ({ success: true }));
    const insertText = vi.fn(() => true);
    const manager: any = {
      sketchModeChecker: null,
      clipboardManager: {
        getItem: vi.fn((id: number) => {
          if (id === 1) return { id: 1, type: 'transcript', content: 'compare these' };
          if (id === 2) return {
            id: 2,
            type: 'screenshot',
            content: null,
            imageData: Buffer.from([1, 2, 3]),
            figureLabel: 'A',
          };
          return null;
        }),
        exportImageToCache: vi.fn(async () => '/tmp/shot 2.png'),
      },
      currentStack: [1, 2],
      detectedCommands: [],
      screenshotMetadata: [],
      getFrontmostAppBundleId: vi.fn(async () => 'com.fieldtheory.app'),
      nativeHelper: {
        getFrontmostApp: vi.fn(() => null),
        typeIntoApp,
      },
      fieldTheoryMarkdownInsertionTarget: {
        isAvailable: vi.fn(() => true),
        insertText,
      },
      lastExternalPasteTargetBundleId: null,
      lastTranscription: 'compare these',
      emit: vi.fn(),
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    await manager.pasteStack(false);

    expect(insertText).toHaveBeenCalledTimes(1);
    expect(insertText).toHaveBeenCalledWith([
      'compare these',
      '![figure A](<file:///tmp/shot%202.png>) ',
    ].join('\n\n'));
    expect(typeIntoApp).not.toHaveBeenCalled();
  });

  it('keeps Field Theory markdown insertion text before images even when the image is first in the stack', async () => {
    const typeIntoApp = vi.fn(async () => ({ success: true }));
    const insertText = vi.fn(() => true);
    const manager: any = {
      sketchModeChecker: null,
      clipboardManager: {
        getItem: vi.fn((id: number) => {
          if (id === 1) return {
            id: 1,
            type: 'screenshot',
            content: null,
            imageData: Buffer.from([1, 2, 3]),
            figureLabel: 'A',
          };
          if (id === 2) return { id: 2, type: 'transcript', content: 'later transcript' };
          return null;
        }),
        exportImageToCache: vi.fn(async () => '/tmp/shot 1.png'),
      },
      currentStack: [1, 2],
      detectedCommands: [],
      screenshotMetadata: [],
      getFrontmostAppBundleId: vi.fn(async () => 'com.fieldtheory.app'),
      nativeHelper: {
        getFrontmostApp: vi.fn(() => null),
        typeIntoApp,
      },
      fieldTheoryMarkdownInsertionTarget: {
        isAvailable: vi.fn(() => true),
        insertText,
      },
      lastExternalPasteTargetBundleId: null,
      lastTranscription: 'later transcript',
      emit: vi.fn(),
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    await manager.pasteStack(false);

    expect(insertText).toHaveBeenCalledWith([
      'later transcript',
      '![figure A](<file:///tmp/shot%201.png>) ',
    ].join('\n\n'));
    expect(typeIntoApp).not.toHaveBeenCalled();
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
      screenshotMetadata: [],
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
      screenshotMetadata: [],
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

    expect(typeIntoApp).toHaveBeenCalledWith('com.mitchellh.ghostty', 'hello world ', false);
    expect(clipboard.writeText).toHaveBeenCalledWith('hello world ');
    expect(pasteText).toHaveBeenCalledWith('com.mitchellh.ghostty');
    expect(clearStack).not.toHaveBeenCalled();
  });

  it('pastes mixed multimodal stacks as images first and text last for composer targets', async () => {
    const pasteText = vi.fn(async () => undefined);
    const manager: any = {
      sketchModeChecker: null,
      clipboardManager: {
        getItem: vi.fn((id: number) => {
          if (id === 1) return { id: 1, type: 'text', content: 'compare these screenshots', imageData: null };
          if (id === 2) return { id: 2, type: 'screenshot', content: null, imageData: Buffer.from([1, 2, 3]) };
          return null;
        }),
        setClipboardHashFromBuffer: vi.fn(),
        syncClipboardHash: vi.fn(),
      },
      currentStack: [1, 2],
      detectedCommands: [],
      screenshotMetadata: [],
      getFrontmostAppBundleId: vi.fn(async () => 'com.openai.chat'),
      pasteText,
      emit: vi.fn(),
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    await manager.pasteStack(false);

    expect(clipboard.writeImage).toHaveBeenCalledTimes(1);
    expect(clipboard.writeText).toHaveBeenCalledWith('compare these screenshots ');
    expect(clipboard.writeText).not.toHaveBeenCalledWith('\n');

    const imagePasteOrder = vi.mocked(clipboard.writeImage).mock.invocationCallOrder[0];
    const textPasteOrder = vi
      .mocked(clipboard.writeText)
      .mock.invocationCallOrder[
        vi.mocked(clipboard.writeText).mock.calls.findIndex(([value]) => value === 'compare these screenshots ')
      ];

    expect(imagePasteOrder).toBeLessThan(textPasteOrder);
    expect(pasteText).toHaveBeenCalledTimes(2);
  });

  it('pastes Claude Code image stacks as file paths', async () => {
    const pasteText = vi.fn(async () => undefined);
    const manager: any = {
      sketchModeChecker: null,
      clipboardManager: {
        getItem: vi.fn((id: number) => ({
          id,
          type: 'screenshot',
          content: null,
          imageData: Buffer.from([id]),
        })),
        exportImageToCache: vi.fn(async (item: { id: number }) => `/tmp/shot-${item.id}.png`),
        syncClipboardHash: vi.fn(),
      },
      currentStack: [1, 2],
      detectedCommands: [],
      screenshotMetadata: [],
      getFrontmostAppBundleId: vi.fn(async () => 'com.anthropic.claudefordesktop'),
      pasteText,
      emit: vi.fn(),
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    await manager.pasteStack(false);

    expect(clipboard.writeImage).not.toHaveBeenCalled();
    expect(clipboard.writeText).toHaveBeenCalledWith('/tmp/shot-1.png ');
    expect(clipboard.writeText).toHaveBeenCalledWith('\n');
    expect(clipboard.writeText).toHaveBeenCalledWith('/tmp/shot-2.png ');
    expect(pasteText).toHaveBeenCalledTimes(3);
  });

  it('pastes Claude Code silent image stacks as file paths', async () => {
    const pasteText = vi.fn(async () => undefined);
    const manager: any = {
      clipboardManager: {
        getItem: vi.fn((id: number) => ({
          id,
          type: 'screenshot',
          content: null,
          imageData: Buffer.from([id]),
        })),
        exportImageToCache: vi.fn(async (item: { id: number }) => `/tmp/shot-${item.id}.png`),
        syncClipboardHash: vi.fn(),
      },
      getFrontmostAppBundleId: vi.fn(async () => 'com.anthropic.claudefordesktop'),
      pasteText,
      emit: vi.fn(),
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    await (manager as any).pasteSilentStack([1, 2]);

    expect(clipboard.writeImage).not.toHaveBeenCalled();
    expect(clipboard.writeText).toHaveBeenCalledWith('figure 1\n`/tmp/shot-1.png` ');
    expect(clipboard.writeText).toHaveBeenCalledWith('\n');
    expect(clipboard.writeText).toHaveBeenCalledWith('figure 2\n`/tmp/shot-2.png` ');
    expect(pasteText).toHaveBeenCalledTimes(3);
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
      screenshotMetadata: [],
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

  it('switches out of recording before final snapshot and native stop resolve', async () => {
    let resolveSnapshot: (path: string) => void = () => {};
    let resolveStop: (path: string) => void = () => {};
    const snapshotPromise = new Promise<string>((resolve) => {
      resolveSnapshot = resolve;
    });
    const stopPromise = new Promise<string>((resolve) => {
      resolveStop = resolve;
    });
    const transcribeWithEngineFallback = vi.fn(async () => 'finished text');
    const manager: any = {
      status: 'recording',
      unregisterAbandonHotkey: vi.fn(),
      soundManager: { play: vi.fn() },
      nativeHelper: {
        isRecordingActive: vi.fn(() => true),
        snapshotRecording: vi.fn(() => snapshotPromise),
        stopRecording: vi.fn(() => stopPromise),
        checkFocusedTextInput: vi.fn(async () => true),
        setHarvestMode: vi.fn(),
      },
      processStandardChunkQueue: vi.fn(async () => {}),
      waitForStandardChunkDrain: vi.fn(async () => {}),
      detachStandardChunkListener: vi.fn(),
      pendingImmediateSquaresAction: null,
      pendingImmediateSquaresText: '',
      standardPendingChunkQueue: [],
      standardChunkProcessingInFlight: false,
      currentStandardHarvestMode: 'dictation',
      trackPriorityMicUsage: vi.fn(async () => {}),
      setStatus: vi.fn(),
      overlay: { showTranscribing: vi.fn() },
      standardLiveTranscript: 'finished text',
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
      screenshotMetadata: [],
      lastTranscription: '',
      pasteStack: vi.fn(async () => {}),
      emit: vi.fn(),
      skipNextPasteFailedNotification: false,
      handleOverlayAfterTranscription: vi.fn(),
      transcribeWithEngineFallback,
      preferences: { getPreference: vi.fn(() => 'whisper') },
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    const finishPromise = manager.stopRecordingAndTranscribe();
    await Promise.resolve();

    expect(manager.setStatus).toHaveBeenCalledWith('transcribing');
    expect(manager.overlay.showTranscribing).toHaveBeenCalled();
    expect(manager.nativeHelper.snapshotRecording).toHaveBeenCalled();
    expect(manager.nativeHelper.stopRecording).not.toHaveBeenCalled();

    resolveSnapshot('/tmp/chunk.wav');
    await Promise.resolve();

    expect(manager.processStandardChunkQueue).toHaveBeenCalled();
    expect(manager.nativeHelper.stopRecording).toHaveBeenCalled();
    expect(manager.pasteStack).not.toHaveBeenCalled();

    resolveStop('/tmp/full.wav');
    await finishPromise;

    expect(manager.pasteStack).toHaveBeenCalledWith(false);
  });

  it('does not wait for priority mic usage tracking before pasting', async () => {
    let resolveUsage: () => void = () => {};
    const usagePromise = new Promise<void>((resolve) => {
      resolveUsage = resolve;
    });
    const transcribeWithEngineFallback = vi.fn(async () => 'finished text');
    const manager: any = {
      status: 'recording',
      unregisterAbandonHotkey: vi.fn(),
      soundManager: { play: vi.fn() },
      nativeHelper: {
        isRecordingActive: vi.fn(() => true),
        snapshotRecording: vi.fn(async () => '/tmp/chunk.wav'),
        stopRecording: vi.fn(async () => '/tmp/full.wav'),
        checkFocusedTextInput: vi.fn(async () => true),
        setHarvestMode: vi.fn(),
      },
      processStandardChunkQueue: vi.fn(async () => {}),
      waitForStandardChunkDrain: vi.fn(async () => {}),
      detachStandardChunkListener: vi.fn(),
      pendingImmediateSquaresAction: null,
      pendingImmediateSquaresText: '',
      standardPendingChunkQueue: [],
      standardChunkProcessingInFlight: false,
      currentStandardHarvestMode: 'dictation',
      trackPriorityMicUsage: vi.fn(() => usagePromise),
      setStatus: vi.fn(),
      overlay: { showTranscribing: vi.fn() },
      standardLiveTranscript: '',
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
      screenshotMetadata: [],
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

    expect(manager.trackPriorityMicUsage).toHaveBeenCalled();
    expect(manager.pasteStack).toHaveBeenCalledWith(false);

    resolveUsage();
    await Promise.resolve();
  });

  it('resets quietly when the helper has no active recording to stop', async () => {
    const manager: any = {
      status: 'recording',
      unregisterAbandonHotkey: vi.fn(),
      soundManager: { play: vi.fn() },
      nativeHelper: {
        snapshotRecording: vi.fn(async () => { throw new Error('No recording in progress'); }),
        stopRecording: vi.fn(async () => { throw new Error('No recording in progress'); }),
      },
      detachStandardChunkListener: vi.fn(),
      clearStandardLiveTranscript: vi.fn(),
      pendingImmediateSquaresAction: null,
      activeRecordingSource: 'microphone',
      setStatus: vi.fn(),
      overlay: { showTranscribing: vi.fn() },
      handleOverlayAfterTranscription: vi.fn(),
      emit: vi.fn(),
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    await manager.stopRecordingAndTranscribe();

    expect(manager.setStatus).toHaveBeenCalledWith('idle');
    expect(manager.emit).not.toHaveBeenCalledWith('error', expect.any(Error));
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
      screenshotMetadata: [],
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

  it('uses live transcript instead of Parakeet ASR for a small final tail', async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'ft-parakeet-tail-'));
    const tailPath = path.join(tempDir, 'tail.wav');
    writeFileSync(tailPath, Buffer.alloc(64000));

    try {
      const transcribeWithEngineFallback = vi.fn(async () => 'hallucinated tail');
      const manager: any = {
        status: 'recording',
        unregisterAbandonHotkey: vi.fn(),
        soundManager: { play: vi.fn() },
        nativeHelper: {
          snapshotRecording: vi.fn(async () => '/tmp/chunk.wav'),
          stopRecording: vi.fn(async () => tailPath),
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
        screenshotMetadata: [],
        accessTokenGetter: null,
        lastTranscription: '',
        pasteStack: vi.fn(async () => {}),
        emit: vi.fn(),
        skipNextPasteFailedNotification: false,
        handleOverlayAfterTranscription: vi.fn(),
        transcribeWithEngineFallback,
        preferences: { getPreference: vi.fn((key: string) => key === 'transcriptionEngine' ? 'parakeet' : undefined) },
      };
      Object.setPrototypeOf(manager, TranscriberManager.prototype);

      await manager.stopRecordingAndTranscribe();

      expect(transcribeWithEngineFallback).not.toHaveBeenCalled();
      expect(manager.pasteStack).toHaveBeenCalledWith(false);
      expect(manager.emit).toHaveBeenCalledWith('result', 'chunked transcript text');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('stops recording immediately when a tail Squares command is detected in a chunk', async () => {
    const stopRecordingAndTranscribe = vi.fn(async () => {});
    const manager: any = {
      status: 'recording',
      pendingImmediateSquaresAction: null,
      pendingImmediateSquaresText: '',
      standardLiveTranscript: '',
      standardLiveSegments: [],
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

  it('strips << >> hallucination noise from transcript chunks', () => {
    const manager: any = {
      applyWordSubstitutions: vi.fn((text: string) => text),
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    expect(manager.sanitizeTranscriptText('hello << goodbye')).toBe('hello goodbye');
    expect(manager.sanitizeTranscriptText('<<>>')).toBe('');
    expect(manager.sanitizeTranscriptText('hello >> world')).toBe('hello world');
  });

  it('drops narrow silence hallucination artifacts from standard chunks', () => {
    const manager: any = {
      applyWordSubstitutions: vi.fn((text: string) => text),
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    expect(manager.sanitizeTranscriptText('thanks')).toBe('');
    expect(manager.sanitizeTranscriptText('thank you.')).toBe('');
    expect(manager.sanitizeTranscriptText('you')).toBe('');
    expect(manager.sanitizeTranscriptText('okay okay')).toBe('');
    expect(manager.sanitizeTranscriptText('testing testing testing testing')).toBe('');
    expect(manager.sanitizeTranscriptText('okay this works')).toBe('okay this works');
  });

  it('strips mm-hmm and filler sounds from transcript chunks', () => {
    const manager: any = {
      applyWordSubstitutions: vi.fn((text: string) => text),
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    expect(manager.sanitizeTranscriptText('mm-hmm')).toBe('');
    expect(manager.sanitizeTranscriptText('mm hmm')).toBe('');
    expect(manager.sanitizeTranscriptText('hello mm-hmm world')).toBe('hello world');
    expect(manager.sanitizeTranscriptText('hmm that is interesting')).toBe('that is interesting');
    expect(manager.sanitizeTranscriptText('mm mm-hmm mm')).toBe('');
  });

  it('strips figure references from live chunk accumulation to avoid dynamic island spam', async () => {
    const manager: any = {
      status: 'recording',
      pendingImmediateSquaresAction: null,
      standardLiveTranscript: '',
      standardLiveSegments: [],
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
      standardLiveSegments: [],
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
      screenshotMetadata: [{ capturedAtMs: 1000, figureLabel: '1', figureId: 'fig01' }],
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
    expect(manager.emit).toHaveBeenCalledWith('result', 'full file transcript [figure 1]');
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
      standardLiveSegments: [
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
      screenshotMetadata: [
        { capturedAtMs: 500, figureLabel: '1', figureId: 'fig01' },
        { capturedAtMs: 1600, figureLabel: '2', figureId: 'fig02' },
        { capturedAtMs: 2500, figureLabel: '3', figureId: 'fig03' },
      ],
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
    expect(manager.emit).toHaveBeenCalledWith('result', 'authoritative full transcript [figure 1] [figure 2] [figure 3]');
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
      screenshotMetadata: [],
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
    expect(manager.squaresManager.executeAction).toHaveBeenCalledWith('grid');
    expect(manager.emit).toHaveBeenCalledWith('result', 'draft layout');
  });
});

describe('TranscriberManager idle screenshot stacking', () => {
  it('addToStack emits currentStack.length when idle', () => {
    const emit = vi.fn();
    const manager: any = {
      status: 'idle',
      currentStack: [],
      screenshotMetadata: [],
      clipboardManager: null,
      quotaManager: null,
      emit,
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    manager.addToStack(100);
    expect(emit).toHaveBeenCalledWith('stackChanged', 1);

    manager.addToStack(101);
    expect(emit).toHaveBeenCalledWith('stackChanged', 2);
  });

  it('addToStack emits screenshotMetadata.length when recording', () => {
    const emit = vi.fn();
    const clipboardManager = {
      getItem: vi.fn((id: number) => ({ id, type: 'screenshot', imageData: Buffer.from([1]) })),
      updateFigureLabel: vi.fn(),
      generateFigureId: vi.fn(() => 'fig01'),
    };
    const manager: any = {
      status: 'recording',
      currentStack: [],
      screenshotMetadata: [],
      clipboardManager,
      quotaManager: null,
      recordingStartTime: Date.now(),
      cursorStatusManager: null,
      autoStackLimitShownThisSession: false,
      emit,
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    manager.addToStack(200);
    // screenshotMetadata gets one entry; currentStack also has one entry
    expect(emit).toHaveBeenCalledWith('stackChanged', 1);
    expect(manager.screenshotMetadata).toHaveLength(1);
  });

  it('skips duplicate item IDs', () => {
    const emit = vi.fn();
    const manager: any = {
      status: 'idle',
      currentStack: [50],
      screenshotMetadata: [],
      clipboardManager: null,
      quotaManager: null,
      emit,
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    manager.addToStack(50);
    expect(emit).not.toHaveBeenCalled();
  });

  it('getStackLength returns currentStack length', () => {
    const manager: any = {
      currentStack: [1, 2, 3],
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    expect(manager.getStackLength()).toBe(3);
  });

  it('clearStack while idle clears items and emits stackChanged(0)', () => {
    const emit = vi.fn();
    const manager: any = {
      status: 'idle',
      currentStack: [10, 20],
      screenshotMetadata: [{ itemId: 10 }, { itemId: 20 }],
      detectedCommands: ['cmd1'],
      emit,
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    manager.clearStack();

    expect(manager.currentStack).toEqual([]);
    expect(manager.screenshotMetadata).toEqual([]);
    expect(manager.detectedCommands).toEqual([]);
    expect(emit).toHaveBeenCalledWith('stackChanged', 0);
    // Status stays idle — clearStack doesn't change status
    expect(manager.status).toBe('idle');
  });
});

describe('TranscriberManager silent stacking', () => {
  function createSilentStackHarness() {
    const emit = vi.fn();
    const play = vi.fn();
    const pasteSilentStack = vi.fn(async () => {});
    const startRecording = vi.fn(async () => {});
    const updateStackId = vi.fn();
    const generateFigureId = vi.fn(() => 'fig01');
    const manager: any = {
      status: 'silentStacking',
      currentStack: [10, 20, 30],
      screenshotMetadata: [
        { itemId: 10, figureLabel: 'A', figureId: 'aaa', capturedAtMs: 0 },
        { itemId: 20, figureLabel: 'B', figureId: 'bbb', capturedAtMs: 100 },
        { itemId: 30, figureLabel: 'C', figureId: 'ccc', capturedAtMs: 200 },
      ],
      detectedCommands: [],
      clipboardManager: { updateStackId, generateFigureId },
      soundManager: { play },
      emit,
      pasteSilentStack,
      startRecording,
      setStatus(s: string) { this.status = s; this.emit('statusChanged', s); },
      clearStack() {
        this.currentStack = [];
        this.screenshotMetadata = [];
        this.detectedCommands = [];
        this.emit('stackChanged', 0);
      },
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);
    return { manager, emit, play, pasteSilentStack, startRecording, updateStackId };
  }

  it('cancelSilentStacking resets to idle, clears stack, plays stop sound', () => {
    const { manager, emit, play } = createSilentStackHarness();

    (manager as any).cancelSilentStacking();

    expect(manager.status).toBe('idle');
    expect(manager.currentStack).toEqual([]);
    expect(manager.screenshotMetadata).toEqual([]);
    expect(manager.detectedCommands).toEqual([]);
    expect(play).toHaveBeenCalledWith('recordingStop');
    expect(emit).toHaveBeenCalledWith('statusChanged', 'idle');
    expect(emit).toHaveBeenCalledWith('stackChanged', 0);
  });

  it('cancelSilentStacking is a no-op when not in silentStacking', () => {
    const { manager, play } = createSilentStackHarness();
    manager.status = 'recording';

    (manager as any).cancelSilentStacking();

    expect(manager.status).toBe('recording');
    expect(play).not.toHaveBeenCalled();
  });

  it('finishSilentStacking pastes stack and returns to idle', async () => {
    const { manager, pasteSilentStack, updateStackId, emit } = createSilentStackHarness();

    await manager.finishSilentStacking();

    expect(manager.status).toBe('idle');
    expect(updateStackId).toHaveBeenCalledWith([10, 20, 30], expect.any(String));
    expect(emit).toHaveBeenCalledWith('autostackCreated');
    expect(pasteSilentStack).toHaveBeenCalledWith([10, 20, 30]);
    expect(manager.currentStack).toEqual([]);
  });

  it('finishSilentStacking with empty stack just returns to idle', async () => {
    const { manager, pasteSilentStack } = createSilentStackHarness();
    manager.currentStack = [];

    await manager.finishSilentStacking();

    expect(manager.status).toBe('idle');
    expect(pasteSilentStack).not.toHaveBeenCalled();
  });

  it('finishSilentStacking is a no-op when not in silentStacking', async () => {
    const { manager, pasteSilentStack } = createSilentStackHarness();
    manager.status = 'idle';

    await manager.finishSilentStacking();

    expect(pasteSilentStack).not.toHaveBeenCalled();
  });

  it('startRecordingFromSilentStack sets idle before paste, then starts recording', async () => {
    const { manager, pasteSilentStack, startRecording, updateStackId, emit } = createSilentStackHarness();

    await (manager as any).startRecordingFromSilentStack();

    // Should transition to idle before pasting (prevents re-stacking during paste)
    const statusCalls = emit.mock.calls.filter((args) => args[0] === 'statusChanged');
    expect(statusCalls[0]).toEqual(['statusChanged', 'idle']);
    // Should have pasted the stack
    expect(updateStackId).toHaveBeenCalled();
    expect(pasteSilentStack).toHaveBeenCalledWith([10, 20, 30]);
    // Should have started fresh recording
    expect(startRecording).toHaveBeenCalled();
  });

  it('startRecordingFromSilentStack with empty stack still starts recording', async () => {
    const { manager, pasteSilentStack, startRecording } = createSilentStackHarness();
    manager.currentStack = [];

    await (manager as any).startRecordingFromSilentStack();

    expect(pasteSilentStack).not.toHaveBeenCalled();
    expect(startRecording).toHaveBeenCalled();
  });
});

describe('TranscriberManager engine revert on init', () => {
  function createInitHarness(prefValues: Record<string, unknown>, opts?: { parakeetInstalled?: boolean }) {
    const save = vi.fn(async () => {});
    const manager: any = {
      preferences: {
        load: vi.fn(async () => {}),
        getPreference: (key: string) => prefValues[key],
        save,
      },
      modelManager: { setSelectedModel: vi.fn() },
      overlay: { setOverlayStyle: vi.fn() },
      registerPrimaryHotkeyWithFallback: vi.fn(async () => {}),
      registerSecondaryHotkey: vi.fn(async () => {}),
      isParakeetInstalled: () => opts?.parakeetInstalled ?? false,
      hotkey: null,
      secondaryHotkey: null,
      registeredHotkey: null,
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);
    return { manager, save };
  }

  it('reverts qwen engine to parakeet when parakeet is installed', async () => {
    const { manager, save } = createInitHarness({
      transcriptionEngine: 'qwen',
      selectedModel: 'small',
    }, { parakeetInstalled: true });
    await manager.init();
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ transcriptionEngine: 'parakeet' })
    );
  });

  it('reverts qwen engine to whisper when parakeet is not installed', async () => {
    const { manager, save } = createInitHarness({
      transcriptionEngine: 'qwen',
      selectedModel: 'small',
    }, { parakeetInstalled: false });
    await manager.init();
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ transcriptionEngine: 'whisper' })
    );
  });

  it('reverts mlx-whisper engine to parakeet when parakeet is installed', async () => {
    const { manager, save } = createInitHarness({
      transcriptionEngine: 'mlx-whisper',
      selectedModel: 'small',
    }, { parakeetInstalled: true });
    await manager.init();
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ transcriptionEngine: 'parakeet' })
    );
  });

  it('reverts mlx-whisper engine to whisper when parakeet is not installed', async () => {
    const { manager, save } = createInitHarness({
      transcriptionEngine: 'mlx-whisper',
      selectedModel: 'small',
    }, { parakeetInstalled: false });
    await manager.init();
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ transcriptionEngine: 'whisper' })
    );
  });

  it('does not revert parakeet engine on init', async () => {
    const { manager, save } = createInitHarness({
      transcriptionEngine: 'parakeet',
      selectedModel: 'small',
    });
    await manager.init();
    expect(save).not.toHaveBeenCalledWith(
      expect.objectContaining({ transcriptionEngine: expect.anything() })
    );
  });

  it('does not revert parakeet multilingual engine on init', async () => {
    const { manager, save } = createInitHarness({
      transcriptionEngine: 'parakeet-multilingual',
      selectedModel: 'small',
    });
    await manager.init();
    expect(save).not.toHaveBeenCalledWith(
      expect.objectContaining({ transcriptionEngine: expect.anything() })
    );
  });

  it('does not revert whisper engine when parakeet is not installed', async () => {
    const { manager, save } = createInitHarness({
      transcriptionEngine: 'whisper',
      selectedModel: 'small',
    }, { parakeetInstalled: false });
    await manager.init();
    expect(save).not.toHaveBeenCalledWith(
      expect.objectContaining({ transcriptionEngine: expect.anything() })
    );
  });

  it('auto-migrates whisper to parakeet when parakeet is installed', async () => {
    const { manager, save } = createInitHarness({
      transcriptionEngine: 'whisper',
      selectedModel: 'small',
    }, { parakeetInstalled: true });
    await manager.init();
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ transcriptionEngine: 'parakeet' })
    );
  });

  it('does not revert when no engine is configured', async () => {
    const { manager, save } = createInitHarness({
      selectedModel: 'small',
    });
    await manager.init();
    expect(save).not.toHaveBeenCalledWith(
      expect.objectContaining({ transcriptionEngine: expect.anything() })
    );
  });
});

describe('TranscriberManager hotkey fallback', () => {
  it('does not persist fallback hotkey to preferences when primary fails', async () => {
    const save = vi.fn();
    const emit = vi.fn();
    const manager: any = {
      hotkey: 'Alt+K',
      registeredHotkey: null,
      preferences: { save },
      emit,
      // Mock registerHotkey: first call (user's hotkey) fails, second (fallback) succeeds
      registerHotkey: vi.fn()
        .mockResolvedValueOnce(false)   // user's hotkey fails
        .mockResolvedValueOnce(true),   // fallback succeeds
      normalizeHotkey: vi.fn((h: string) => h),
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    await (manager as any).registerPrimaryHotkeyWithFallback('Alt+K');

    expect(save).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith('hotkeyChanged', 'Option+Shift+Space');
  });

  it('does not fall back when user hotkey registers successfully', async () => {
    const save = vi.fn();
    const emit = vi.fn();
    const manager: any = {
      hotkey: 'Alt+K',
      registeredHotkey: null,
      preferences: { save },
      emit,
      registerHotkey: vi.fn().mockResolvedValueOnce(true),
      normalizeHotkey: vi.fn((h: string) => h),
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    await (manager as any).registerPrimaryHotkeyWithFallback('Alt+K');

    expect(save).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalledWith('hotkeyChanged', expect.anything());
  });
});

describe('TranscriberManager hotkey clearing', () => {
  it('clears primary hotkey when setHotkey receives null', async () => {
    const save = vi.fn(async () => {});
    const emit = vi.fn();
    const manager: any = {
      hotkey: 'Alt+K',
      registeredHotkey: 'Alt+K',
      preferences: { save },
      emit,
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    const result = await manager.setHotkey(null);

    expect(result).toBe(true);
    expect(save).toHaveBeenCalledWith({ transcriptionHotkey: '' });
    expect(emit).toHaveBeenCalledWith('hotkeyChanged', '');
    expect(manager.hotkey).toBe('');
    expect(manager.registeredHotkey).toBeNull();
  });

  it('clears primary hotkey when setHotkey receives empty string', async () => {
    const save = vi.fn(async () => {});
    const emit = vi.fn();
    const manager: any = {
      hotkey: 'Alt+K',
      registeredHotkey: 'Alt+K',
      preferences: { save },
      emit,
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    const result = await manager.setHotkey('');

    expect(result).toBe(true);
    expect(save).toHaveBeenCalledWith({ transcriptionHotkey: '' });
    expect(emit).toHaveBeenCalledWith('hotkeyChanged', '');
  });
});

describe('TranscriberManager parakeet uninstall', () => {
  it('reverts engine to whisper when using parakeet and venv does not exist', async () => {
    const save = vi.fn(async () => {});
    const manager: any = {
      stopParakeetServer: vi.fn(),
      getParakeetBasePath: () => '/tmp/nonexistent-parakeet-runtime',
      preferences: {
        getPreference: (key: string) => key === 'transcriptionEngine' ? 'parakeet' : undefined,
        save,
      },
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    const result = await manager.uninstallParakeet();

    expect(result).toEqual({ success: true });
    expect(manager.stopParakeetServer).toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ transcriptionEngine: 'whisper' })
    );
  });

  it('does not revert engine when not using parakeet', async () => {
    const save = vi.fn(async () => {});
    const manager: any = {
      stopParakeetServer: vi.fn(),
      getParakeetBasePath: () => '/tmp/nonexistent-parakeet-runtime',
      preferences: {
        getPreference: (key: string) => key === 'transcriptionEngine' ? 'whisper' : undefined,
        save,
      },
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    const result = await manager.uninstallParakeet();

    expect(result).toEqual({ success: true });
    expect(save).not.toHaveBeenCalled();
  });

  it('returns error when stopParakeetServer throws', async () => {
    const manager: any = {
      stopParakeetServer: vi.fn(() => { throw new Error('server busy'); }),
      getParakeetBasePath: () => '/tmp/nonexistent-parakeet-runtime',
      preferences: {
        getPreference: () => 'parakeet',
        save: vi.fn(async () => {}),
      },
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    const result = await manager.uninstallParakeet();

    expect(result.success).toBe(false);
    expect(result.error).toContain('server busy');
  });

  it('reports reinstall-needed status after a failed Parakeet startup', () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'ft-parakeet-status-'));
    const manager: any = {
      getParakeetBasePath: () => tempDir,
      getParakeetPythonPath: () => path.join(tempDir, 'venv', 'bin', 'python'),
      getParakeetScriptPath: () => path.join(tempDir, 'parakeet-transcribe.py'),
      isParakeetInstalled: () => true,
      parakeetServer: null,
      parakeetServerEngine: null,
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    manager.markParakeetEngineFailure('parakeet', new Error('server exited during startup with code 1'));

    const status = manager.getParakeetStatus();
    const english = status.engines.find((engine: any) => engine.engine === 'parakeet');

    expect(english).toEqual(expect.objectContaining({
      verified: false,
      needsReinstall: true,
    }));
    expect(english?.lastError).toContain('server exited during startup');
    expect(english?.lastErrorDetail).toContain('server exited during startup');

    rmSync(tempDir, { recursive: true, force: true });
  });

  it('treats a newer Parakeet failure as overriding an older verification', () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'ft-parakeet-status-'));
    const manager: any = {
      getParakeetBasePath: () => tempDir,
      getParakeetPythonPath: () => path.join(tempDir, 'venv', 'bin', 'python'),
      getParakeetScriptPath: () => path.join(tempDir, 'parakeet-transcribe.py'),
      isParakeetInstalled: () => true,
      parakeetServer: null,
      parakeetServerEngine: null,
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    manager.updatePersistedParakeetEngineState('parakeet', {
      verifiedAt: '2026-04-08T00:00:00.000Z',
      lastError: 'server startup timed out (60s)',
      lastErrorAt: '2026-04-09T00:00:00.000Z',
    });

    const status = manager.getParakeetStatus();
    const english = status.engines.find((engine: any) => engine.engine === 'parakeet');

    expect(english).toEqual(expect.objectContaining({
      verified: false,
      needsReinstall: true,
      lastError: 'server startup timed out (60s)',
    }));

    rmSync(tempDir, { recursive: true, force: true });
  });

  it('persists detailed Parakeet failure output for diagnostics and UI copy actions', () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'ft-parakeet-status-'));
    const manager: any = {
      getParakeetBasePath: () => tempDir,
      getParakeetPythonPath: () => path.join(tempDir, 'venv', 'bin', 'python'),
      getParakeetScriptPath: () => path.join(tempDir, 'parakeet-transcribe.py'),
      isParakeetInstalled: () => true,
      parakeetServer: null,
      parakeetServerEngine: null,
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    const error: any = new Error('Parakeet English server startup timed out (60s)');
    error.stderr = 'Loading nemo-parakeet-tdt-0.6b-v2...\nFetching 4 files: 42%';
    error.stdout = '{"ok": false}';
    error.detail = 'Loading nemo-parakeet-tdt-0.6b-v2...\nFetching 4 files: 42%\n{"ok": false}';

    manager.markParakeetEngineFailure('parakeet', error);

    const status = manager.getParakeetStatus();
    const english = status.engines.find((engine: any) => engine.engine === 'parakeet');

    expect(english?.lastErrorDetail).toContain('Fetching 4 files: 42%');
    expect(english?.lastErrorDetail).toContain('{"ok": false}');

    rmSync(tempDir, { recursive: true, force: true });
  });

  it('classifies missing Parakeet model shards as repairable cache errors', () => {
    const manager: any = {};
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    expect(manager.isParakeetRepairableCacheError(
      new Error('filesystem error: in file_size: No such file or directory ["/tmp/models--istupakov--parakeet-tdt-0.6b-v2-onnx/snapshots/abc/encoder-model.onnx.data"]')
    )).toBe(true);
    expect(manager.isParakeetRepairableCacheError(
      new Error('Parakeet English server startup timed out (60s)')
    )).toBe(false);
  });

  it('repairs only the affected Parakeet model cache', () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'ft-parakeet-cache-'));
    const hubDir = path.join(tempDir, 'cache', 'huggingface', 'hub');
    const englishRepo = path.join(hubDir, 'models--istupakov--parakeet-tdt-0.6b-v2-onnx');
    const multilingualRepo = path.join(hubDir, 'models--istupakov--parakeet-tdt-0.6b-v3-onnx');
    mkdirSync(path.join(englishRepo, 'snapshots', 'abc'), { recursive: true });
    mkdirSync(path.join(multilingualRepo, 'snapshots', 'def'), { recursive: true });

    const manager: any = {
      getParakeetBasePath: () => tempDir,
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    const missingShard = path.join(englishRepo, 'snapshots', 'abc', 'encoder-model.onnx.data');
    const error: any = new Error(`No such file or directory ["${missingShard}"]`);
    error.detail = `Loading nemo-parakeet-tdt-0.6b-v2...\nFailed to load nemo-parakeet-tdt-0.6b-v2: No such file or directory ["${missingShard}"]`;

    const repairedRepos = manager.repairParakeetModelCache('parakeet', error);

    expect(repairedRepos).toEqual([englishRepo]);
    expect(existsSync(englishRepo)).toBe(false);
    expect(existsSync(multilingualRepo)).toBe(true);

    rmSync(tempDir, { recursive: true, force: true });
  });

  it('prefetches the selected Parakeet model before starting the server during setup', async () => {
    const manager: any = {
      getParakeetBasePath: () => '/tmp/build-parakeet',
      installParakeetRuntime: vi.fn(async () => {}),
      prefetchParakeetModel: vi.fn(async () => {}),
      startParakeetServer: vi.fn(async () => {}),
      stopParakeetServer: vi.fn(),
      markParakeetEngineFailure: TranscriberManager.prototype['markParakeetEngineFailure'],
      normalizeParakeetErrorMessage: TranscriberManager.prototype['normalizeParakeetErrorMessage'],
      readPersistedParakeetState: () => ({}),
      writePersistedParakeetState: vi.fn(),
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    const result = await manager.setupParakeet('parakeet-multilingual');

    expect(result).toEqual({ success: true });
    expect(manager.installParakeetRuntime).toHaveBeenCalledWith('/tmp/build-parakeet/venv', expect.any(Function));
    expect(manager.prefetchParakeetModel).toHaveBeenCalledWith(
      'parakeet-multilingual',
      900000,
      expect.any(Function)
    );
    expect(manager.startParakeetServer).toHaveBeenCalledWith('parakeet-multilingual');
    expect(manager.stopParakeetServer).toHaveBeenCalledTimes(1);
  });

  it('repairs a broken Parakeet model cache once during setup and retries verification', async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'ft-parakeet-setup-'));
    const englishRepo = path.join(
      tempDir,
      'cache',
      'huggingface',
      'hub',
      'models--istupakov--parakeet-tdt-0.6b-v2-onnx'
    );
    mkdirSync(path.join(englishRepo, 'snapshots', 'abc'), { recursive: true });

    const missingShard = path.join(englishRepo, 'snapshots', 'abc', 'encoder-model.onnx.data');
    const repairError: any = new Error(`No such file or directory ["${missingShard}"]`);
    repairError.detail = `Loading nemo-parakeet-tdt-0.6b-v2...\nFailed to load nemo-parakeet-tdt-0.6b-v2: No such file or directory ["${missingShard}"]`;

    let attempts = 0;
    const manager: any = {
      getParakeetBasePath: () => tempDir,
      installParakeetRuntime: vi.fn(async () => {}),
      prefetchParakeetModel: vi.fn(async () => {
        attempts += 1;
        if (attempts === 1) {
          throw repairError;
        }
      }),
      startParakeetServer: vi.fn(async () => {}),
      stopParakeetServer: vi.fn(),
      markParakeetEngineFailure: TranscriberManager.prototype['markParakeetEngineFailure'],
      normalizeParakeetErrorMessage: TranscriberManager.prototype['normalizeParakeetErrorMessage'],
      normalizeParakeetErrorDetail: TranscriberManager.prototype['normalizeParakeetErrorDetail'],
      readPersistedParakeetState: () => ({}),
      writePersistedParakeetState: vi.fn(),
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    const result = await manager.setupParakeet('parakeet');

    expect(result).toEqual({ success: true });
    expect(manager.installParakeetRuntime).toHaveBeenCalledTimes(1);
    expect(manager.prefetchParakeetModel).toHaveBeenCalledTimes(2);
    expect(manager.startParakeetServer).toHaveBeenCalledTimes(1);
    expect(manager.stopParakeetServer).toHaveBeenCalledTimes(2);
    expect(existsSync(englishRepo)).toBe(false);

    rmSync(tempDir, { recursive: true, force: true });
  });
});
