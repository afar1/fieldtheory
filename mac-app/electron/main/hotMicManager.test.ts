import { afterEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => {
  const createServer = vi.fn(() => ({
    on: vi.fn(),
    listen: vi.fn((_port: number, _host: string, callback?: () => void) => callback?.()),
    close: vi.fn(),
  }));

  return { createServer };
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

describe('HotMicManager transcript history persistence', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('documents that submitted Hot Mic transcripts with more than five words are saved to transcript history', async () => {
    const { manager, clipboardManager } = createManager();

    await (manager as any).processListeningChunk('alpha beta gamma delta epsilon zeta over');
    await Promise.resolve();

    expect(clipboardManager.storeText).toHaveBeenCalledWith(
      'alpha beta gamma delta epsilon zeta',
      'transcript'
    );

    manager.destroy();
  });

  it('documents that Hot Mic transcript fragments of five words or fewer are excluded from transcript history', async () => {
    const { manager, clipboardManager } = createManager();

    await (manager as any).processListeningChunk('alpha beta gamma delta epsilon over');
    await Promise.resolve();

    expect(clipboardManager.storeText).not.toHaveBeenCalled();

    manager.destroy();
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
