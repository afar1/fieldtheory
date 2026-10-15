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

import { clipboard, globalShortcut } from 'electron';
import { MeetingCapturePipeline } from './meetingCapturePipeline';
import { formatWhisperSpeakerTurnTranscript, TranscriberManager } from './transcriberManager';

function writePcmWav(filePath: string, durationMs = 100): void {
  const sampleRate = 16_000;
  const dataSize = Math.round(sampleRate * (durationMs / 1_000)) * 2;
  const wav = Buffer.alloc(44 + dataSize);
  wav.write('RIFF', 0, 'ascii');
  wav.writeUInt32LE(36 + dataSize, 4);
  wav.write('WAVEfmt ', 8, 'ascii');
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36, 'ascii');
  wav.writeUInt32LE(dataSize, 40);
  writeFileSync(filePath, wav);
}

// Command queue tests for MLX Whisper/Parakeet are covered by stdioJsonServer.test.ts,
// since both engines use the shared StdioJsonServer class.

describe('TranscriberManager shutdown', () => {
  it.each([false, true])('waits for Parakeet exit and blocks recreation when overlay cleanup fails=%s', async failOverlay => {
    let finish!: () => void;
    const shutdown = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const manager = Object.assign(Object.create(TranscriberManager.prototype), {
      parakeetServer: { shutdown },
      unregisterAbandonHotkey: vi.fn(),
      detachStandardChunkListener: vi.fn(),
      clearStandardLiveTranscript: vi.fn(),
      overlay: { destroy: vi.fn(() => { if (failOverlay) throw new Error('window destroyed'); }) },
    });
    const pending = manager.destroy();
    expect(manager.destroy()).toBe(pending);
    expect(() => manager.getOrCreateParakeetServer('parakeet')).toThrow('shutting down');
    const settled = vi.fn();
    void pending.then(settled, settled);
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    finish();
    if (failOverlay) await expect(pending).rejects.toThrow('Transcription cleanup failed');
    else await pending;
    expect(shutdown).toHaveBeenCalledOnce();
  });
});

describe('formatWhisperSpeakerTurnTranscript', () => {
  it('removes whisper.cpp tinydiarize markers without inventing speakers', () => {
    const text = formatWhisperSpeakerTurnTranscript([
      '[00:00:00.000 --> 00:00:03.800] Hello there. [SPEAKER_TURN]',
      '[00:00:03.800 --> 00:00:06.200] Hi, can you hear me? [SPEAKER_TURN]',
      '[00:00:06.200 --> 00:00:08.260] Third voice joining. [SPEAKER_TURN]',
      '[00:00:08.260 --> 00:00:10.120] Yes, sounds good.',
    ].join('\n'));

    expect(text).toBe([
      'Hello there.',
      'Hi, can you hear me?',
      'Third voice joining.',
      'Yes, sounds good.',
    ].join('\n\n'));
  });
});

describe('TranscriberManager Parakeet meeting timestamps', () => {
  it('requests structured segments only for meeting chunks', async () => {
    const sendParakeetCommand = vi.fn()
      .mockResolvedValueOnce({ ok: true, text: 'Normal dictation.' })
      .mockResolvedValueOnce({
        ok: true,
        text: 'First. Second.',
        segments: [
          { startSeconds: 0.1, endSeconds: 0.4, text: 'First.' },
          { startSeconds: 0.5, endSeconds: 0.9, text: 'Second.' },
        ],
      });
    const manager: any = {
      screenshotMetadata: [],
      startParakeetServer: vi.fn(async () => {}),
      sendParakeetCommand,
      stopParakeetServer: vi.fn(),
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    await expect(manager.transcribeWithParakeet('/tmp/dictation.wav', 'parakeet'))
      .resolves.toBe('Normal dictation.');
    await expect(manager.transcribeMeetingChunk('/tmp/meeting.wav', 'parakeet')).resolves.toEqual({
      text: 'First. Second.',
      segments: [
        { startMs: 100, endMs: 400, text: 'First.' },
        { startMs: 500, endMs: 900, text: 'Second.' },
      ],
    });

    expect(sendParakeetCommand).toHaveBeenNthCalledWith(1, 'parakeet', {
      cmd: 'transcribe',
      audio: '/tmp/dictation.wav',
      timestamps: false,
    });
    expect(sendParakeetCommand).toHaveBeenNthCalledWith(2, 'parakeet', {
      cmd: 'transcribe',
      audio: '/tmp/meeting.wav',
      structuredSegments: true,
    });
  });
});

function createWarmupHarness(prefValues: Record<string, unknown>) {
  const startParakeetServer = vi.fn(async () => {});
  const manager: any = {
    preferences: {
      getPreference: (key: string) => prefValues[key],
    },
    startParakeetServer,
    isParakeetInstalled: () => true,
  };
  Object.setPrototypeOf(manager, TranscriberManager.prototype);
  return { manager, startParakeetServer };
}

function createRestartHarness(prefValues: Record<string, unknown>) {
  const stopParakeetServer = vi.fn();
  const startParakeetServer = vi.fn(async () => {});
  const manager: any = {
    preferences: {
      getPreference: (key: string) => prefValues[key],
    },
    stopParakeetServer,
    startParakeetServer,
    isParakeetInstalled: () => true,
  };
  Object.setPrototypeOf(manager, TranscriberManager.prototype);
  return {
    manager,
    stopParakeetServer,
    startParakeetServer,
  };
}

function createHotMicWarmupHarness(prefValues: Record<string, unknown>) {
  const startParakeetServer = vi.fn(async () => {});
  const manager: any = {
    preferences: {
      getPreference: (key: string) => prefValues[key],
    },
    modelManager: {
      getSelectedModel: () => 'small',
    },
    startParakeetServer,
    isParakeetInstalled: () => true,
  };
  Object.setPrototypeOf(manager, TranscriberManager.prototype);
  return { manager, startParakeetServer };
}

describe('TranscriberManager warmup', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('normalizes legacy MLX Whisper and warms Parakeet', async () => {
    const { manager, startParakeetServer } = createWarmupHarness({
      transcriptionEngine: 'mlx-whisper',
      hotMicTranscriptionEngine: 'default',
    });

    await manager.warmup();

    expect(startParakeetServer).toHaveBeenCalledWith('parakeet');
  });

  it('ignores legacy Hot Mic override values and warms only Parakeet', async () => {
    const { manager, startParakeetServer } = createWarmupHarness({
      transcriptionEngine: 'whisper',
      hotMicTranscriptionEngine: 'qwen',
    });

    await manager.warmup();

    expect(startParakeetServer).toHaveBeenCalledWith('parakeet');
  });

  it('ignores Hot Mic MLX override and uses Parakeet warmup path', async () => {
    const { manager, startParakeetServer } = createWarmupHarness({
      transcriptionEngine: 'whisper',
      hotMicTranscriptionEngine: 'mlx-whisper',
    });

    await manager.warmup();

    expect(startParakeetServer).toHaveBeenCalledWith('parakeet');
  });

  it('skips warmup when Parakeet is not installed', async () => {
    const { manager, startParakeetServer } = createWarmupHarness({
      transcriptionEngine: 'parakeet',
    });
    manager.isParakeetInstalled = () => false;

    await manager.warmup();

    expect(startParakeetServer).not.toHaveBeenCalled();
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

  it('awaits Parakeet startup before resolving', async () => {
    let releaseStart!: () => void;
    const { manager, startParakeetServer } = createHotMicWarmupHarness({
      transcriptionEngine: 'parakeet',
    });

    startParakeetServer.mockImplementationOnce(
      () => new Promise<void>((resolve) => { releaseStart = () => resolve(); })
    );

    let settled = false;
    const warmupPromise = manager.warmupForHotMic().then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);
    expect(startParakeetServer).toHaveBeenCalledWith('parakeet');

    releaseStart();
    await warmupPromise;
    expect(settled).toBe(true);
  });

  it('defaults Hot Mic warmup to Parakeet when no engine is saved and Parakeet is installed', async () => {
    const { manager, startParakeetServer } = createHotMicWarmupHarness({});

    await manager.warmupForHotMic();

    expect(startParakeetServer).toHaveBeenCalledWith('parakeet');
  });
});

describe('TranscriberManager runtime restart', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('restarts only Parakeet and ignores legacy Hot Mic override', async () => {
    const h = createRestartHarness({
      transcriptionEngine: 'whisper',
      hotMicTranscriptionEngine: 'qwen',
    });

    await h.manager.restartTranscriptionRuntime();

    expect(h.stopParakeetServer).toHaveBeenCalledTimes(1);
    expect(h.startParakeetServer).toHaveBeenCalledWith('parakeet');
  });

  it('stops Parakeet without restarting when Parakeet is not installed', async () => {
    const h = createRestartHarness({
      transcriptionEngine: 'parakeet',
    });
    h.manager.isParakeetInstalled = () => false;

    await h.manager.restartTranscriptionRuntime();

    expect(h.stopParakeetServer).toHaveBeenCalledTimes(1);
    expect(h.startParakeetServer).not.toHaveBeenCalled();
  });

  it('normalizes legacy MLX Whisper to Parakeet on restart', async () => {
    const h = createRestartHarness({
      transcriptionEngine: 'mlx-whisper',
      hotMicTranscriptionEngine: 'default',
    });

    await h.manager.restartTranscriptionRuntime();

    expect(h.startParakeetServer).toHaveBeenCalledWith('parakeet');
  });
});

describe('TranscriberManager hot mic fallback behavior', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('normalizes legacy MLX Whisper to Parakeet for Hot Mic transcriptions', async () => {
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

    expect(transcribeWithEngineFallback).toHaveBeenCalledWith('/tmp/test.wav', 'parakeet');
  });

  it('uses Parakeet by default for Hot Mic', async () => {
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

    expect(transcribeWithEngineFallback).toHaveBeenCalledWith('/tmp/test.wav', 'parakeet');
  });

  it('uses the global engine for Hot Mic even when override is set', async () => {
    const transcribeWithEngineFallback = vi.fn(async () => 'ok');
    const manager: any = {
      preferences: {
        getPreference: (key: string) => {
          if (key === 'transcriptionEngine') return 'parakeet';
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

    expect(transcribeWithEngineFallback).toHaveBeenCalledWith('/tmp/test.wav', 'parakeet');
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

    expect(transcribeWithEngineFallback).toHaveBeenCalledWith('/tmp/test.wav', 'parakeet');
  });
});

describe('TranscriberManager Hot Mic engine status', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('reports not-installed when Parakeet runtime is missing', () => {
    const manager: any = {
      preferences: {
        getPreference: (key: string) => key === 'transcriptionEngine' ? 'parakeet' : undefined,
      },
      modelManager: {
        getSelectedModel: () => 'small',
      },
      getParakeetStatus: () => ({ engines: [] }),
      isParakeetInstalled: () => false,
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    const status = manager.getHotMicEngineStatus();
    expect(status.selectedEngine).toBe('parakeet');
    expect(status.readiness).toBe('not-installed');
  });

  it('reports ready when Parakeet server is ready', () => {
    const manager: any = {
      preferences: {
        getPreference: (key: string) => key === 'transcriptionEngine' ? 'parakeet' : undefined,
      },
      modelManager: {
        getSelectedModel: () => 'small',
      },
      getParakeetStatus: () => ({ engines: [{ engine: 'parakeet' }] }),
      isParakeetInstalled: () => true,
      parakeetServer: { isReady: true },
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    const status = manager.getHotMicEngineStatus();
    expect(status.selectedEngine).toBe('parakeet');
    expect(status.readiness).toBe('ready');
  });

  it('normalizes legacy MLX Whisper status to Parakeet', () => {
    const manager: any = {
      preferences: {
        getPreference: (key: string) => key === 'transcriptionEngine' ? 'mlx-whisper' : undefined,
      },
      modelManager: {
        getSelectedModel: () => 'small',
      },
      getParakeetStatus: () => ({ engines: [] }),
      isParakeetInstalled: () => false,
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    const status = manager.getHotMicEngineStatus();

    expect(status.selectedEngine).toBe('parakeet');
    expect(status.readiness).toBe('not-installed');
  });
});

describe('TranscriberManager auto-improve toggle', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('persists auto-improve when setAutoImprove(true) is requested', async () => {
    const save = vi.fn(async () => undefined);
    const prefs: Record<string, unknown> = {};
    const manager: any = {
      preferences: {
        save,
        getPreference: (key: string) => prefs[key],
      },
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    await manager.setAutoImprove(true);
    prefs.autoImproveTranscripts = true;

    expect(manager.getAutoImprove()).toBe(true);
    expect(save).toHaveBeenCalledWith({ autoImproveTranscripts: true });
  });

  it('defaults auto-improve to local provider and persists valid providers', async () => {
    const save = vi.fn(async () => undefined);
    const manager: any = {
      preferences: {
        save,
        getPreference: (key: string) => key === 'autoImproveProvider' ? 'unexpected' : undefined,
      },
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    expect(manager.getAutoImproveProvider()).toBe('local');
    await manager.setAutoImproveProvider('codex');

    expect(save).toHaveBeenCalledWith({ autoImproveProvider: 'codex' });
  });

  it('runs the transcript improve runner only when enabled and above the word threshold', async () => {
    const runner = vi.fn(async () => 'cleaned transcript');
    const manager: any = {
      preferences: {
        getPreference: (key: string) => {
          if (key === 'autoImproveTranscripts') return true;
          if (key === 'autoImproveMinWords') return 3;
          if (key === 'autoImproveProvider') return 'local';
          return undefined;
        },
      },
      transcriptImproveRunner: runner,
      cursorStatusManager: { showRecordingNote: vi.fn() },
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    await expect(manager.improveTranscriptForPaste('too short')).resolves.toBeNull();
    await expect(manager.improveTranscriptForPaste('this is long enough')).resolves.toBe('cleaned transcript');

    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner).toHaveBeenCalledWith({ text: 'this is long enough', provider: 'local' });
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

  it('inserts recording text into a focused Field Theory terminal when Field Theory is frontmost', async () => {
    const typeIntoApp = vi.fn(async () => ({ success: true }));
    const insertText = vi.fn(() => true);
    const manager: any = {
      sketchModeChecker: null,
      clipboardManager: {
        getItem: vi.fn(() => ({ id: 1, type: 'transcript', content: 'ask cursor this' })),
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
        insertText: vi.fn(() => true),
      },
      fieldTheoryTerminalInsertionTarget: {
        isAvailable: vi.fn(() => true),
        insertText,
      },
      lastExternalPasteTargetBundleId: null,
      lastTranscription: 'ask cursor this',
      skipNextPasteFailedNotification: false,
      emit: vi.fn(),
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    await manager.pasteStack(false);

    expect(insertText).toHaveBeenCalledWith('ask cursor this ');
    expect(typeIntoApp).not.toHaveBeenCalled();
    expect(manager.fieldTheoryMarkdownInsertionTarget.insertText).not.toHaveBeenCalled();
    expect(manager.skipNextPasteFailedNotification).toBe(true);
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

  it('cancels standard recording without taking the normal transcribe-and-paste path', async () => {
    const pasteStack = vi.fn(async () => {});
    const manager: any = {
      status: 'recording',
      nativeHelper: {
        cancelRecording: vi.fn(async () => undefined),
      },
      detachStandardChunkListener: vi.fn(),
      clearStandardLiveTranscript: vi.fn(),
      setStatus: vi.fn((status: string) => {
        manager.status = status;
      }),
      overlay: {
        showStatus: vi.fn(),
      },
      unregisterAbandonHotkey: vi.fn(),
      currentStack: [1],
      screenshotMetadata: [{ itemId: 1 }],
      detectedCommands: [{ name: 'debug', filePath: '/tmp/debug.md' }],
      pasteStack,
      emit: vi.fn(),
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    await manager.cancelActiveSession();

    expect(manager.nativeHelper.cancelRecording).toHaveBeenCalledTimes(1);
    expect(pasteStack).not.toHaveBeenCalled();
    expect(manager.status).toBe('idle');
    expect(manager.currentStack).toEqual([]);
    expect(manager.screenshotMetadata).toEqual([]);
    expect(manager.detectedCommands).toEqual([]);
    expect(manager.emit).toHaveBeenCalledWith('stackChanged', 0);
  });

  it('discard-cancels an in-flight transcription before it stores or pastes text', async () => {
    let resolveTranscribe: (text: string) => void = () => {};
    const transcribePromise = new Promise<string>((resolve) => {
      resolveTranscribe = resolve;
    });
    const storeText = vi.fn(async () => 1);
    const pasteStack = vi.fn(async () => {});
    const manager: any = {
      status: 'recording',
      unregisterAbandonHotkey: vi.fn(),
      soundManager: { play: vi.fn() },
      nativeHelper: {
        isRecordingActive: vi.fn(() => true),
        snapshotRecording: vi.fn(async () => '/tmp/chunk.wav'),
        stopRecording: vi.fn(async () => '/tmp/full.wav'),
        cancelRecording: vi.fn(async () => undefined),
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
      setStatus: vi.fn((status: string) => {
        manager.status = status;
      }),
      overlay: {
        showTranscribing: vi.fn(),
        dismiss: vi.fn(),
        showStatus: vi.fn(),
      },
      standardLiveTranscript: '',
      standardLiveSegments: [],
      sanitizeTranscriptText: vi.fn((text: string) => text.trim()),
      clearStandardLiveTranscript: vi.fn(() => {
        manager.standardLiveTranscript = '';
      }),
      modelManager: {
        getSelectedModel: vi.fn(() => 'small'),
        isModelAvailable: vi.fn(async () => true),
        isModelAvailableForSize: vi.fn(async () => true),
        getModelHealthForSizeSync: vi.fn(() => ({ status: 'missing' })),
      },
      squaresManager: null,
      commandsManager: null,
      clipboardManager: {
        getContinuousContextState: vi.fn(() => ({ active: false })),
        storeText,
      },
      detectedCommands: [],
      screenshotMetadata: [],
      currentStack: [],
      lastTranscription: '',
      pasteStack,
      emit: vi.fn(),
      skipNextPasteFailedNotification: false,
      handleOverlayAfterTranscription: vi.fn(),
      transcribeWithEngineFallback: vi.fn(() => transcribePromise),
      getConfiguredTranscriptionEngine: vi.fn(() => 'whisper'),
      insertFigureReferences: vi.fn((text: string) => text),
      preferences: {
        getPreference: vi.fn((key: string) => key === 'transcriptionEngine' ? 'parakeet' : undefined),
      },
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    const finishPromise = manager.stopRecordingAndTranscribe();
    for (let i = 0; i < 10 && manager.transcribeWithEngineFallback.mock.calls.length === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(manager.transcribeWithEngineFallback).toHaveBeenCalled();

    await manager.cancelActiveSession();
    resolveTranscribe('finished text');
    await finishPromise;

    expect(storeText).not.toHaveBeenCalled();
    expect(pasteStack).not.toHaveBeenCalled();
    expect(manager.status).toBe('idle');
  });

  it('keeps Escape on the recording session before the Field Theory window can dismiss', () => {
    const manager: any = {
      abandonHotkeyRegistered: false,
      registeredAbandonHotkey: 'Escape',
      pendingAbandonConfirmation: false,
      preferences: {
        getPreference: vi.fn((key: string) => (
          key === 'abandonRecordingConfirmation' ? true : undefined
        )),
      },
      hasAudioContent: true,
      overlay: {
        hideConfirmation: vi.fn(),
        showConfirmation: vi.fn(),
      },
      emit: vi.fn(),
      cancelRecording: vi.fn(),
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    vi.mocked(globalShortcut.register).mockClear().mockReturnValue(true);

    (manager as any).registerAbandonHotkey();
    const escapeHandler = vi.mocked(globalShortcut.register).mock.calls[0]?.[1] as () => void;

    escapeHandler();
    expect(manager.emit).toHaveBeenCalledWith('confirmation-show');
    expect(manager.emit).not.toHaveBeenCalledWith('dismiss-clipboard-history');
    expect(manager.overlay.showConfirmation).toHaveBeenCalledTimes(1);
    expect(manager.cancelRecording).not.toHaveBeenCalled();

    escapeHandler();
    expect(manager.overlay.hideConfirmation).toHaveBeenCalledTimes(1);
    expect(manager.cancelRecording).toHaveBeenCalledTimes(1);
  });

  it('captures meeting audio without clipboard storage or paste', async () => {
    const storeText = vi.fn(async () => 1);
    const pasteStack = vi.fn(async () => {});
    const pasteText = vi.fn(async () => {});
    const transcribeWithEngineFallback = vi.fn(async () => 'Alice: Hello.\nBob: Hi.');
    const manager: any = new EventEmitter();
    Object.assign(manager, {
      status: 'idle',
      hotMicDelegate: null,
      nativeHelper: {
        startRecording: vi.fn(async () => undefined),
        stopRecording: vi.fn(async () => '/tmp/meeting.wav'),
        cancelRecording: vi.fn(async () => undefined),
        setHarvestMode: vi.fn(),
      },
      preferences: {
        getPreference: vi.fn((key: string) => {
          if (key === 'onboardingComplete') return true;
          if (key === 'transcriptionEngine') return 'whisper';
          return undefined;
        }),
      },
      modelManager: {
        getSelectedModel: vi.fn(() => 'small'),
        isModelAvailable: vi.fn(async () => true),
        isModelAvailableForSize: vi.fn(async () => true),
        getModelHealthForSizeSync: vi.fn(() => ({ status: 'missing' })),
      },
      overlay: {
        showRecording: vi.fn(),
        showTranscribing: vi.fn(),
        dismiss: vi.fn(),
        showStatus: vi.fn(),
      },
      soundManager: { play: vi.fn() },
      clipboardManager: {
        getContinuousContextState: vi.fn(() => ({ active: false })),
        storeText,
      },
      currentStack: [],
      screenshotMetadata: [],
      detectedCommands: [],
      standardLiveTranscript: '',
      standardLiveSegments: [],
      standardChunkReadyListener: null,
      standardPendingChunkQueue: [],
      standardChunkProcessingInFlight: false,
      currentStandardHarvestMode: 'off',
      transcribeWithEngineFallback,
      pasteStack,
      pasteText,
    });
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    vi.mocked(clipboard.writeText).mockClear();
    vi.mocked(clipboard.writeImage).mockClear();

    const session = await manager.startMeetingCapture();
    const result = await manager.stopMeetingCapture();

    expect(session).toMatchObject({
      source: 'microphone',
      transcriptionEngine: 'parakeet',
      speakerDiarizationSupported: false,
    });
    expect(manager.nativeHelper.startRecording).toHaveBeenCalledWith('microphone');
    expect(manager.nativeHelper.stopRecording).toHaveBeenCalledTimes(1);
    expect(transcribeWithEngineFallback).toHaveBeenCalledWith('/tmp/meeting.wav', 'parakeet');
    expect(result).toMatchObject({
      transcriptText: 'Alice: Hello.\nBob: Hi.',
      audioPath: '/tmp/meeting.wav',
      source: 'microphone',
      transcriptionEngine: 'parakeet',
      speakerDiarizationSupported: false,
    });
    expect(storeText).not.toHaveBeenCalled();
    expect(pasteStack).not.toHaveBeenCalled();
    expect(pasteText).not.toHaveBeenCalled();
    expect(clipboard.writeText).not.toHaveBeenCalled();
    expect(clipboard.writeImage).not.toHaveBeenCalled();
    expect(manager.status).toBe('idle');
  });

  it('keeps meeting capture on Parakeet without speaker diarization', async () => {
    const transcribeWithEngineFallback = vi.fn(async () => 'Speaker 1: Hello.\nSpeaker 2: Hi.');
    const manager: any = new EventEmitter();
    Object.assign(manager, {
      status: 'idle',
      hotMicDelegate: null,
      nativeHelper: {
        startRecording: vi.fn(async () => undefined),
        stopRecording: vi.fn(async () => '/tmp/meeting.wav'),
        cancelRecording: vi.fn(async () => undefined),
        setHarvestMode: vi.fn(),
      },
      preferences: {
        getPreference: vi.fn((key: string) => {
          if (key === 'onboardingComplete') return true;
          if (key === 'transcriptionEngine') return 'parakeet';
          return undefined;
        }),
      },
      modelManager: {
        getSelectedModel: vi.fn(() => 'small'),
        isModelAvailable: vi.fn(async () => true),
        isModelAvailableForSize: vi.fn(async () => true),
        getModelHealthForSizeSync: vi.fn((size: string) => ({ status: size === 'small-tdrz' ? 'ready' : 'missing' })),
      },
      overlay: {
        showRecording: vi.fn(),
        showTranscribing: vi.fn(),
        dismiss: vi.fn(),
        showStatus: vi.fn(),
      },
      soundManager: { play: vi.fn() },
      clipboardManager: {
        getContinuousContextState: vi.fn(() => ({ active: false })),
        storeText: vi.fn(),
      },
      currentStack: [],
      screenshotMetadata: [],
      detectedCommands: [],
      standardLiveTranscript: '',
      standardLiveSegments: [],
      standardChunkReadyListener: null,
      standardPendingChunkQueue: [],
      standardChunkProcessingInFlight: false,
      currentStandardHarvestMode: 'off',
      transcribeWithEngineFallback,
      pasteStack: vi.fn(),
      pasteText: vi.fn(),
    });
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    const session = await manager.startMeetingCapture();
    const result = await manager.stopMeetingCapture();

    expect(session).toMatchObject({
      transcriptionEngine: 'parakeet',
      whisperModelOverride: null,
      speakerDiarizationSupported: false,
    });
    expect(transcribeWithEngineFallback).toHaveBeenCalledWith('/tmp/meeting.wav', 'parakeet');
    expect(result).toMatchObject({
      transcriptText: 'Speaker 1: Hello.\nSpeaker 2: Hi.',
      speakerDiarizationSupported: false,
    });
  });

  it('journals rotating meeting chunks and returns timestamped Parakeet entries', async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'fieldtheory-ambient-capture-'));
    const sidecarDir = path.join(tempDir, '.meetings', 'meeting-1');
    const firstChunk = path.join(tempDir, 'first.wav');
    const finalChunk = path.join(tempDir, 'final.wav');
    writePcmWav(firstChunk, 100);
    writePcmWav(finalChunk, 150);
    const nativeHelper = new EventEmitter() as EventEmitter & Record<string, unknown>;
    Object.assign(nativeHelper, {
      startRecording: vi.fn(async () => undefined),
      stopRecording: vi.fn(async () => finalChunk),
      cancelRecording: vi.fn(async () => undefined),
      setHarvestMode: vi.fn(),
    });
    const onTranscript = vi.fn();
    const transcribeMeetingChunk = vi.fn()
      .mockResolvedValueOnce({
        text: 'First durable chunk.',
        segments: [
          { startMs: 0, endMs: 40, text: 'First durable' },
          { startMs: 50, endMs: 90, text: 'chunk.' },
        ],
      })
      .mockResolvedValueOnce({
        text: 'Final durable chunk.',
        segments: [{ startMs: 10, endMs: 130, text: 'Final durable chunk.' }],
      });
    const manager: any = new EventEmitter();
    Object.assign(manager, {
      status: 'idle',
      hotMicDelegate: null,
      nativeHelper,
      preferences: {
        getPreference: vi.fn((key: string) => {
          if (key === 'onboardingComplete') return true;
          if (key === 'transcriptionEngine') return 'parakeet';
          return undefined;
        }),
      },
      overlay: {
        showRecording: vi.fn(),
        showTranscribing: vi.fn(),
        dismiss: vi.fn(),
        showStatus: vi.fn(),
      },
      soundManager: { play: vi.fn() },
      currentStack: [],
      screenshotMetadata: [],
      detectedCommands: [],
      standardLiveTranscript: '',
      standardLiveSegments: [],
      standardChunkReadyListener: null,
      standardPendingChunkQueue: [],
      standardChunkProcessingInFlight: false,
      currentStandardHarvestMode: 'off',
      meetingCapturePipeline: null,
      meetingChunkReadyListener: null,
      transcribeMeetingChunk,
    });
    Object.setPrototypeOf(manager, TranscriberManager.prototype);
    const resume = vi.spyOn(MeetingCapturePipeline.prototype, 'resume');

    try {
      await manager.startMeetingCapture({ meetingId: 'meeting-1', sidecarDir, onTranscript });
      expect(resume).toHaveBeenCalledOnce();
      nativeHelper.emit('recordingChunkReady', firstChunk);
      const result = await manager.stopMeetingCapture();

      expect(nativeHelper.setHarvestMode).toHaveBeenCalledWith('meeting');
      expect(result.transcriptEntries).toEqual([
        { sequence: 1, startMs: 0, endMs: 40, text: 'First durable' },
        { sequence: 2, startMs: 50, endMs: 90, text: 'chunk.' },
        { sequence: 3, startMs: 110, endMs: 230, text: 'Final durable chunk.' },
      ]);
      expect(result.transcriptText).toBe('First durable chunk. Final durable chunk.');
      expect(result.audioPath).toBe(path.join(sidecarDir, 'audio.wav'));
      expect(existsSync(path.join(sidecarDir, 'capture.json'))).toBe(true);
      expect(existsSync(result.audioPath)).toBe(true);
      expect(onTranscript).toHaveBeenCalledTimes(3);
    } finally {
      resume.mockRestore();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('uses the normal dictation hotkey to stop active meeting capture', async () => {
    const pasteStack = vi.fn(async () => {});
    const stopRecordingAndTranscribe = vi.fn(async () => {});
    const meetingCaptureHotkeyHandler = vi.fn(async () => {});
    const manager: any = {
      activeMeetingCapture: {
        startedAt: '2026-05-14T00:00:00.000Z',
        source: 'microphone',
        transcriptionEngine: 'parakeet',
        speakerDiarizationSupported: false,
      },
      status: 'recording',
      meetingCaptureHotkeyHandler,
      meetingCaptureHotkeyStopInFlight: false,
      pasteStack,
      stopRecordingAndTranscribe,
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    await manager.toggleRecording();

    expect(meetingCaptureHotkeyHandler).toHaveBeenCalledOnce();
    expect(manager.meetingCaptureHotkeyStopInFlight).toBe(false);
    expect(stopRecordingAndTranscribe).not.toHaveBeenCalled();
    expect(pasteStack).not.toHaveBeenCalled();
  });

  it('runs the pre-toggle cleanup before handling the dictation hotkey', async () => {
    const order: string[] = [];
    const beforeRecordingToggleHandler = vi.fn(async () => {
      order.push('cleanup');
    });
    const meetingCaptureHotkeyHandler = vi.fn(async () => {
      order.push('meeting-stop');
    });
    const manager: any = {
      activeMeetingCapture: {
        startedAt: '2026-05-14T00:00:00.000Z',
        source: 'microphone',
        transcriptionEngine: 'parakeet',
        speakerDiarizationSupported: false,
      },
      status: 'recording',
      beforeRecordingToggleHandler,
      meetingCaptureHotkeyHandler,
      meetingCaptureHotkeyStopInFlight: false,
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    await manager.toggleRecording();

    expect(beforeRecordingToggleHandler).toHaveBeenCalledOnce();
    expect(meetingCaptureHotkeyHandler).toHaveBeenCalledOnce();
    expect(order).toEqual(['cleanup', 'meeting-stop']);
  });

  it('ignores duplicate meeting stop hotkeys while a stop is already running', async () => {
    const meetingCaptureHotkeyHandler = vi.fn(async () => {});
    const manager: any = {
      activeMeetingCapture: {
        startedAt: '2026-05-14T00:00:00.000Z',
        source: 'microphone',
        transcriptionEngine: 'parakeet',
        speakerDiarizationSupported: false,
      },
      status: 'recording',
      meetingCaptureHotkeyHandler,
      meetingCaptureHotkeyStopInFlight: true,
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    await manager.toggleRecording();

    expect(meetingCaptureHotkeyHandler).not.toHaveBeenCalled();
  });

  it('keeps normal dictation on the store-and-paste path', async () => {
    const storeText = vi.fn(async () => 42);
    const pasteStack = vi.fn(async () => {});
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
      trackPriorityMicUsage: vi.fn(async () => {}),
      setStatus: vi.fn((status: string) => {
        manager.status = status;
      }),
      overlay: {
        showTranscribing: vi.fn(),
        dismiss: vi.fn(),
      },
      standardLiveTranscript: '',
      standardLiveSegments: [],
      sanitizeTranscriptText: vi.fn((text: string) => text.trim()),
      clearStandardLiveTranscript: vi.fn(),
      modelManager: {
        getSelectedModel: vi.fn(() => 'small'),
        isModelAvailable: vi.fn(async () => true),
      },
      squaresManager: null,
      commandsManager: null,
      clipboardManager: {
        getContinuousContextState: vi.fn(() => ({ active: false })),
        storeText,
      },
      detectedCommands: [],
      screenshotMetadata: [],
      currentStack: [],
      lastTranscription: '',
      pasteStack,
      emit: vi.fn(),
      skipNextPasteFailedNotification: false,
      handleOverlayAfterTranscription: vi.fn(),
      transcribeWithEngineFallback: vi.fn(async () => 'dictated text'),
      getConfiguredTranscriptionEngine: vi.fn(() => 'whisper'),
      insertFigureReferences: vi.fn((text: string) => text),
      preferences: { getPreference: vi.fn(() => 'parakeet') },
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    await manager.stopRecordingAndTranscribe();

    expect(storeText).toHaveBeenCalledWith('dictated text', 'transcript', undefined, undefined);
    expect(manager.currentStack).toContain(42);
    expect(pasteStack).toHaveBeenCalledWith(false);
    expect(manager.emit).toHaveBeenCalledWith('transcriptRecorded', { wordCount: 2 });
    expect(manager.emit).toHaveBeenCalledWith('result', 'dictated text');
  });

  it('does not run auto-improve after a standard session is cancelled post-store', async () => {
    const improveRunner = vi.fn(async () => 'cleaned text');
    const pasteStack = vi.fn(async () => {});
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
      trackPriorityMicUsage: vi.fn(async () => {}),
      setStatus: vi.fn((status: string) => {
        manager.status = status;
      }),
      overlay: {
        showTranscribing: vi.fn(),
        dismiss: vi.fn(),
        showStatus: vi.fn(),
      },
      standardLiveTranscript: '',
      standardLiveSegments: [],
      sanitizeTranscriptText: vi.fn((text: string) => text.trim()),
      clearStandardLiveTranscript: vi.fn(),
      modelManager: {
        getSelectedModel: vi.fn(() => 'small'),
        isModelAvailable: vi.fn(async () => true),
      },
      squaresManager: null,
      commandsManager: null,
      clipboardManager: {
        getContinuousContextState: vi.fn(() => ({ active: false })),
        storeText: vi.fn(async () => {
          manager.standardSessionCancelRequested = true;
          return 42;
        }),
      },
      detectedCommands: [],
      screenshotMetadata: [],
      currentStack: [],
      lastTranscription: '',
      pasteStack,
      emit: vi.fn(),
      skipNextPasteFailedNotification: false,
      handleOverlayAfterTranscription: vi.fn(),
      transcribeWithEngineFallback: vi.fn(async () => 'dictated text with enough words'),
      getConfiguredTranscriptionEngine: vi.fn(() => 'whisper'),
      insertFigureReferences: vi.fn((text: string) => text),
      transcriptImproveRunner: improveRunner,
      preferences: {
        getPreference: vi.fn((key: string) => {
          if (key === 'autoImproveTranscripts') return true;
          if (key === 'autoImproveMinWords') return 3;
          if (key === 'autoImproveProvider') return 'local';
          return undefined;
        }),
      },
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    await manager.stopRecordingAndTranscribe();

    expect(improveRunner).not.toHaveBeenCalled();
    expect(pasteStack).not.toHaveBeenCalled();
    expect(manager.emit).not.toHaveBeenCalledWith('transcriptRecorded', { wordCount: 5 });
    expect(manager.emit).not.toHaveBeenCalledWith('result', expect.any(String));
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
      preferences: { getPreference: vi.fn(() => 'parakeet') },
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    await manager.stopRecordingAndTranscribe();

    expect(transcribeWithEngineFallback).toHaveBeenCalledWith('/tmp/full.wav', 'parakeet');
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
      preferences: { getPreference: vi.fn(() => 'parakeet') },
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

  it('keeps the full recording file when no live transcript exists yet', async () => {
    const transcribeWithEngineFallback = vi.fn(async () => 'full recording text');
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
      trackPriorityMicUsage: vi.fn(async () => {}),
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
      preferences: { getPreference: vi.fn(() => 'parakeet') },
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    await manager.stopRecordingAndTranscribe();

    expect(manager.nativeHelper.snapshotRecording).not.toHaveBeenCalled();
    expect(manager.nativeHelper.stopRecording).toHaveBeenCalled();
    expect(transcribeWithEngineFallback).toHaveBeenCalledWith('/tmp/full.wav', 'parakeet');
    expect(manager.emit).toHaveBeenCalledWith('result', 'full recording text');
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
      preferences: { getPreference: vi.fn(() => 'parakeet') },
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    await manager.stopRecordingAndTranscribe();

    expect(manager.trackPriorityMicUsage).toHaveBeenCalled();
    expect(manager.pasteStack).toHaveBeenCalledWith(false);

    resolveUsage();
    await Promise.resolve();
  });

  it('waits for paste-starting listeners before pasting', async () => {
    const order: string[] = [];
    const transcribeWithEngineFallback = vi.fn(async () => 'finished text');
    const manager: any = new EventEmitter();
    Object.assign(manager, {
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
      trackPriorityMicUsage: vi.fn(async () => {}),
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
      pasteStack: vi.fn(async () => {
        order.push('paste');
      }),
      skipNextPasteFailedNotification: false,
      handleOverlayAfterTranscription: vi.fn(),
      transcribeWithEngineFallback,
      preferences: { getPreference: vi.fn(() => 'parakeet') },
    });
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    manager.on('paste-starting', async () => {
      order.push('fade-start');
      await Promise.resolve();
      order.push('fade-done');
    });

    await manager.stopRecordingAndTranscribe();

    expect(order).toEqual(['fade-start', 'fade-done', 'paste']);
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
      preferences: { getPreference: vi.fn(() => 'parakeet') },
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    await manager.stopRecordingAndTranscribe();

    expect(transcribeWithEngineFallback).toHaveBeenCalledWith('/tmp/full.wav', 'parakeet');
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
      preferences: { getPreference: vi.fn(() => 'parakeet') },
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
      preferences: { getPreference: vi.fn(() => 'parakeet') },
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

  it('allows live typing to target Field Theory when a Field Theory document is frontmost', async () => {
    const insertTextSegment = vi.fn(async () => ({ success: true }));
    const manager: any = {
      preferences: { getPreference: vi.fn((key: string) => key === 'liveTypingEnabled') },
      nativeHelper: {
        getFrontmostApp: vi.fn(() => ({ bundleId: 'com.fieldtheory.app' })),
        insertTextSegment,
      },
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    manager.startLiveTypingSessionIfEligible('microphone');
    manager.liveTypingCoordinator.enqueueSegment('hello field theory');
    await manager.liveTypingCoordinator.finish();

    expect(manager.liveTypingTargetBundleId).toBe('com.fieldtheory.app');
    expect(insertTextSegment).toHaveBeenCalledWith('com.fieldtheory.app', 'hello field theory ');
  });

  it('enqueues finalized chunks for live typing and skips Squares tail parsing', async () => {
    const enqueueSegment = vi.fn();
    const parseVoiceCommandFromTail = vi.fn(() => ({ action: 'grid', remainingText: 'draft' }));
    const manager: any = {
      status: 'recording',
      pendingImmediateSquaresAction: null,
      standardLiveTranscript: '',
      standardLiveSegments: [],
      standardChunkCommandTriggered: false,
      preferences: { getPreference: vi.fn(() => 'parakeet') },
      transcribeWithEngineFallback: vi.fn(async () => 'draft tile'),
      sanitizeTranscriptText: vi.fn((text: string) => text.trim()),
      squaresManager: { parseVoiceCommandFromTail },
      liveTypingCoordinator: { enqueueSegment },
      nativeHelper: { setHarvestMode: vi.fn() },
      emit: vi.fn(),
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    await manager.onStandardChunkReady('/tmp/fake-chunk.wav');

    expect(enqueueSegment).toHaveBeenCalledWith('draft tile');
    expect(parseVoiceCommandFromTail).not.toHaveBeenCalled();
    expect(manager.pendingImmediateSquaresAction).toBeNull();
  });

  it('submits the live typing target when a Hot Mic submit phrase is spoken', async () => {
    const enqueueSegment = vi.fn();
    const drain = vi.fn(async () => ({ typedSegmentCount: 1, bufferedSegmentCount: 0 }));
    const submitTextTarget = vi.fn(async () => ({ success: true }));
    const manager: any = {
      status: 'recording',
      pendingImmediateSquaresAction: null,
      standardLiveTranscript: '',
      standardLiveSegments: [],
      standardChunkCommandTriggered: false,
      liveTypingPendingCommandText: '',
      liveTypingOutputSegments: [],
      liveTypingTargetBundleId: 'com.mitchellh.ghostty',
      preferences: {
        getPreference: vi.fn((key: string) => key === 'transcriptionEngine' ? 'parakeet' : undefined),
      },
      transcribeWithEngineFallback: vi.fn(async () => 'draft the response go ahead'),
      sanitizeTranscriptText: vi.fn((text: string) => text.trim()),
      squaresManager: null,
      liveTypingCoordinator: { enqueueSegment, drain },
      nativeHelper: { setHarvestMode: vi.fn(), submitTextTarget },
      emit: vi.fn(),
      clipboardManager: null,
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    await manager.onStandardChunkReady('/tmp/fake-chunk.wav');

    expect(enqueueSegment).toHaveBeenCalledWith('draft the response');
    expect(drain).toHaveBeenCalled();
    expect(submitTextTarget).toHaveBeenCalledWith('com.mitchellh.ghostty', 'enter');
    expect(manager.liveTypingOutputSegments).toEqual(['draft the response']);
  });

  it('does not run Hot Mic submit phrases during non-live standard transcription', async () => {
    const typeIntoApp = vi.fn(async () => ({ success: true }));
    const manager: any = {
      status: 'recording',
      pendingImmediateSquaresAction: null,
      standardLiveTranscript: '',
      standardLiveSegments: [],
      standardChunkCommandTriggered: false,
      preferences: {
        getPreference: vi.fn((key: string) => key === 'transcriptionEngine' ? 'parakeet' : undefined),
      },
      transcribeWithEngineFallback: vi.fn(async () => 'draft the response go ahead'),
      sanitizeTranscriptText: vi.fn((text: string) => text.trim()),
      squaresManager: null,
      nativeHelper: { setHarvestMode: vi.fn(), typeIntoApp },
      emit: vi.fn(),
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    await manager.onStandardChunkReady('/tmp/fake-chunk.wav');

    expect(typeIntoApp).not.toHaveBeenCalled();
    expect(manager.standardLiveTranscript).toBe('draft the response go ahead');
  });

  it('holds a possible live submit prefix until the next chunk completes it', async () => {
    const enqueueSegment = vi.fn();
    const drain = vi.fn(async () => ({ typedSegmentCount: 1, bufferedSegmentCount: 0 }));
    const submitTextTarget = vi.fn(async () => ({ success: true }));
    const manager: any = {
      status: 'recording',
      pendingImmediateSquaresAction: null,
      standardLiveTranscript: '',
      standardLiveSegments: [],
      standardChunkCommandTriggered: false,
      liveTypingPendingCommandText: '',
      liveTypingOutputSegments: [],
      liveTypingTargetBundleId: 'com.mitchellh.ghostty',
      preferences: {
        getPreference: vi.fn((key: string) => key === 'transcriptionEngine' ? 'parakeet' : undefined),
      },
      transcribeWithEngineFallback: vi
        .fn()
        .mockResolvedValueOnce('draft go')
        .mockResolvedValueOnce('ahead'),
      sanitizeTranscriptText: vi.fn((text: string) => text.trim()),
      squaresManager: null,
      liveTypingCoordinator: { enqueueSegment, drain },
      nativeHelper: { setHarvestMode: vi.fn(), submitTextTarget },
      emit: vi.fn(),
      clipboardManager: null,
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    await manager.onStandardChunkReady('/tmp/chunk-1.wav');
    await manager.onStandardChunkReady('/tmp/chunk-2.wav');

    expect(enqueueSegment).toHaveBeenCalledTimes(1);
    expect(enqueueSegment).toHaveBeenCalledWith('draft');
    expect(manager.liveTypingPendingCommandText).toBe('');
    expect(submitTextTarget).toHaveBeenCalledWith('com.mitchellh.ghostty', 'enter');
  });

  it('flushes a held live command prefix as text when it never becomes a command', async () => {
    const enqueueSegment = vi.fn();
    const manager: any = {
      liveTypingPendingCommandText: '',
      liveTypingOutputSegments: [],
      liveTypingCoordinator: { enqueueSegment },
      preferences: { getPreference: vi.fn(() => undefined) },
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    await manager.handleLiveTypingChunk('ready go');
    manager.flushLiveTypingPendingCommandText();

    expect(enqueueSegment).toHaveBeenCalledWith('ready');
    expect(enqueueSegment).toHaveBeenCalledWith('go');
    expect(manager.liveTypingOutputSegments).toEqual(['ready', 'go']);
  });

  it('pastes only the live typing remainder and avoids pasteStack when no screenshots exist', async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'fieldtheory-live-typing-'));
    const wavPath = path.join(tempDir, 'tail.wav');
    writeFileSync(wavPath, 'tiny');

    const typeIntoApp = vi.fn(async () => ({ success: true }));
    const handleVoiceCommand = vi.fn(async () => false);
    const detectCommands = vi.fn(() => ({ detected: false }));
    const pasteStack = vi.fn(async () => {});
    const manager: any = {
      status: 'recording',
      activeRecordingSource: 'microphone',
      unregisterAbandonHotkey: vi.fn(),
      soundManager: { play: vi.fn() },
      nativeHelper: {
        isRecordingActive: vi.fn(() => true),
        snapshotRecording: vi.fn(async () => path.join(tempDir, 'chunk.wav')),
        stopRecording: vi.fn(async () => wavPath),
        checkFocusedTextInput: vi.fn(async () => true),
        typeIntoApp,
        setHarvestMode: vi.fn(),
      },
      processStandardChunkQueue: vi.fn(async () => {}),
      waitForStandardChunkDrain: vi.fn(async () => {}),
      detachStandardChunkListener: vi.fn(),
      pendingImmediateSquaresAction: null,
      pendingImmediateSquaresText: '',
      standardPendingChunkQueue: [],
      standardLiveTranscript: 'hello later',
      standardLiveSegments: [
        { text: 'hello', endMs: 500 },
        { text: 'later', endMs: 1000 },
      ],
      liveTypingCoordinator: {
        finish: vi.fn(async () => ({ typedSegmentCount: 1 })),
        cancel: vi.fn(),
      },
      liveTypingTargetBundleId: 'com.apple.TextEdit',
      trackPriorityMicUsage: vi.fn(async () => {}),
      setStatus: vi.fn((status: string) => {
        manager.status = status;
      }),
      overlay: { showTranscribing: vi.fn() },
      sanitizeTranscriptText: vi.fn((text: string) => text.trim()),
      clearStandardLiveTranscript: vi.fn(() => {
        manager.standardLiveTranscript = '';
        manager.standardLiveSegments = [];
      }),
      modelManager: {
        getSelectedModel: vi.fn(() => 'small'),
        isModelAvailable: vi.fn(async () => true),
      },
      squaresManager: { handleVoiceCommand },
      commandsManager: { detectCommands },
      clipboardManager: null,
      detectedCommands: [],
      screenshotMetadata: [],
      currentStack: [],
      lastTranscription: '',
      pasteStack,
      emit: vi.fn(),
      skipNextPasteFailedNotification: false,
      handleOverlayAfterTranscription: vi.fn(),
      transcribeWithEngineFallback: vi.fn(async () => 'full text'),
      preferences: { getPreference: vi.fn(() => 'parakeet') },
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    try {
      await manager.stopRecordingAndTranscribe();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }

    expect(typeIntoApp).toHaveBeenCalledWith('com.apple.TextEdit', 'later ', false);
    expect(pasteStack).not.toHaveBeenCalled();
    expect(handleVoiceCommand).not.toHaveBeenCalled();
    expect(detectCommands).not.toHaveBeenCalled();
    expect(clipboard.writeText).not.toHaveBeenCalledWith('later ');
    expect(manager.emit).toHaveBeenCalledWith('result', 'hello later');
  });

  it('pastes stop-time ASR tail when all live segments were already typed', async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'fieldtheory-live-typing-tail-'));
    const wavPath = path.join(tempDir, 'tail.wav');
    writeFileSync(wavPath, Buffer.alloc(100_000));

    const typeIntoApp = vi.fn(async () => ({ success: true }));
    const pasteStack = vi.fn(async () => {});
    const manager: any = {
      status: 'recording',
      activeRecordingSource: 'microphone',
      unregisterAbandonHotkey: vi.fn(),
      soundManager: { play: vi.fn() },
      nativeHelper: {
        isRecordingActive: vi.fn(() => true),
        snapshotRecording: vi.fn(async () => path.join(tempDir, 'chunk.wav')),
        stopRecording: vi.fn(async () => wavPath),
        checkFocusedTextInput: vi.fn(async () => true),
        typeIntoApp,
        setHarvestMode: vi.fn(),
      },
      processStandardChunkQueue: vi.fn(async () => {}),
      waitForStandardChunkDrain: vi.fn(async () => {}),
      detachStandardChunkListener: vi.fn(),
      pendingImmediateSquaresAction: null,
      pendingImmediateSquaresText: '',
      standardPendingChunkQueue: [],
      standardLiveTranscript: 'hello',
      standardLiveSegments: [{ text: 'hello', endMs: 500 }],
      liveTypingCoordinator: {
        finish: vi.fn(async () => ({ typedSegmentCount: 1 })),
        cancel: vi.fn(),
      },
      liveTypingTargetBundleId: 'com.apple.TextEdit',
      trackPriorityMicUsage: vi.fn(async () => {}),
      setStatus: vi.fn((status: string) => {
        manager.status = status;
      }),
      overlay: { showTranscribing: vi.fn() },
      sanitizeTranscriptText: vi.fn((text: string) => text.trim()),
      clearStandardLiveTranscript: vi.fn(() => {
        manager.standardLiveTranscript = '';
        manager.standardLiveSegments = [];
      }),
      modelManager: {
        getSelectedModel: vi.fn(() => 'small'),
        isModelAvailable: vi.fn(async () => true),
      },
      squaresManager: { handleVoiceCommand: vi.fn(async () => false) },
      commandsManager: { detectCommands: vi.fn(() => ({ detected: false })) },
      clipboardManager: null,
      detectedCommands: [],
      screenshotMetadata: [],
      currentStack: [],
      lastTranscription: '',
      pasteStack,
      emit: vi.fn(),
      skipNextPasteFailedNotification: false,
      handleOverlayAfterTranscription: vi.fn(),
      transcribeWithEngineFallback: vi.fn(async () => 'tail words'),
      preferences: { getPreference: vi.fn(() => 'parakeet') },
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    try {
      await manager.stopRecordingAndTranscribe();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }

    expect(typeIntoApp).toHaveBeenCalledWith('com.apple.TextEdit', 'tail words ', false);
    expect(pasteStack).not.toHaveBeenCalled();
    expect(manager.emit).toHaveBeenCalledWith('result', 'tail words');
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
      preferences: { getPreference: vi.fn(() => 'parakeet') },
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    await manager.stopRecordingAndTranscribe();

    expect(transcribeWithEngineFallback).toHaveBeenCalledWith('/tmp/full.wav', 'parakeet');
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
      preferences: { getPreference: vi.fn(() => 'parakeet') },
    };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);

    await manager.stopRecordingAndTranscribe();

    expect(transcribeWithEngineFallback).toHaveBeenCalledWith('/tmp/full.wav', 'parakeet');
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
      preferences: { getPreference: vi.fn(() => 'parakeet') },
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

  it('reverts qwen engine to parakeet even when parakeet is not installed', async () => {
    const { manager, save } = createInitHarness({
      transcriptionEngine: 'qwen',
      selectedModel: 'small',
    }, { parakeetInstalled: false });
    await manager.init();
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ transcriptionEngine: 'parakeet' })
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

  it('reverts mlx-whisper engine to parakeet even when parakeet is not installed', async () => {
    const { manager, save } = createInitHarness({
      transcriptionEngine: 'mlx-whisper',
      selectedModel: 'small',
    }, { parakeetInstalled: false });
    await manager.init();
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ transcriptionEngine: 'parakeet' })
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

  it('reverts whisper engine to parakeet even when parakeet is not installed', async () => {
    const { manager, save } = createInitHarness({
      transcriptionEngine: 'whisper',
      selectedModel: 'small',
    }, { parakeetInstalled: false });
    await manager.init();
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ transcriptionEngine: 'parakeet' })
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
  it('keeps engine on parakeet when uninstalling Parakeet', async () => {
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
      expect.objectContaining({ transcriptionEngine: 'parakeet' })
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

  it('shows the model-load cause and automatic cache recovery guidance after startup exits', () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'ft-parakeet-status-'));
    const manager: any = { getParakeetBasePath: () => tempDir };
    Object.setPrototypeOf(manager, TranscriberManager.prototype);
    try {
      const cause = 'Failed to load nemo-parakeet-tdt-0.6b-v2: External data path escapes model directory';
      const error = Object.assign(new Error('Parakeet English server exited during startup with code 1'), {
        stderr: 'HF_TOKEN warning\n' + cause,
      });
      const failure = manager.markParakeetEngineFailure('parakeet', error);
      expect(failure.summary).toBe(cause);
      expect(failure.detail).toContain(cause);
      expect(failure.moreInfo).toContain('repaired automatically');
      expect(failure.moreInfo).not.toContain('install it again');
      expect(manager.readPersistedParakeetState().engines.parakeet.lastError).toBe(cause);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
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
    expect(manager.installParakeetRuntime).toHaveBeenCalledWith(
      '/tmp/build-parakeet/venv',
      expect.any(String),
      expect.any(Function)
    );
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

describe('standard recording cold model startup', () => {
  it('starts capture without awaiting model warmup', async () => {
    let release!: () => void;
    const warmup = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
    const capture = vi.fn(async () => undefined);
    const manager: any = Object.create(TranscriberManager.prototype);
    Object.assign(manager, {
      status: 'idle', getRecordingSource: () => 'microphone',
      preferences: { getPreference: (key: string) => key === 'onboardingComplete' },
      setStatus: vi.fn(), overlay: { showRecording: vi.fn() },
      registerAbandonHotkey: vi.fn(), soundManager: { play: vi.fn() },
      resetStandardRealtimeSession: vi.fn(), startLiveTypingSessionIfEligible: vi.fn(),
      attachStandardChunkListener: vi.fn(), setStandardRealtimeHarvestMode: vi.fn(),
      warmup, nativeHelper: { startRecording: capture },
    });
    await manager.startRecording();
    expect(warmup).toHaveBeenCalledOnce();
    expect(capture).toHaveBeenCalledWith('microphone');
    release();
  });
});
