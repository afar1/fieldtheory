import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
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

  it('strips << >> hallucination noise from transcript chunks', () => {
    const manager: any = {
      applyWordSubstitutions: vi.fn((text: string) => text),
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    expect(manager.sanitizeTranscriptText('hello << goodbye')).toBe('hello goodbye');
    expect(manager.sanitizeTranscriptText('<<>>')).toBe('');
    expect(manager.sanitizeTranscriptText('hello >> world')).toBe('hello world');
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
    expect(manager.emit).toHaveBeenCalledWith('result', 'authoritative full transcript [Figure 1] [Figure 2] [Figure 3]');
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

    rmSync(tempDir, { recursive: true, force: true });
  });
});
