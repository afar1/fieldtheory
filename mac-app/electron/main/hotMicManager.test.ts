import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';

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
  const execFile = vi.fn((_cmd: string, _args?: string[], callback?: (...args: any[]) => void) => {
    callback?.(null, '', '');
    return {} as any;
  });

  const spawn = vi.fn(() => ({
    unref: vi.fn(),
  }));

  return { createServer, exec, execFile, spawn };
});

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp') },
  globalShortcut: {
    register: vi.fn(() => true),
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
    execFile: testState.execFile,
    spawn: testState.spawn,
  },
  exec: testState.exec,
  execFile: testState.execFile,
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

import { globalShortcut } from 'electron';
import { HotMicManager } from './hotMicManager';

function createManager(preferences: Record<string, unknown> = {}) {
  const clipboardItems = new Map<number, any>();
  const nativeHelper = {
    getFrontmostApp: vi.fn(() => ({ bundleId: 'com.mitchellh.ghostty', name: 'Ghostty' })),
    typeIntoApp: vi.fn(async () => ({ success: true })),
    setHarvestMode: vi.fn(),
    startRecording: vi.fn(async () => undefined),
    stopRecording: vi.fn(async () => undefined),
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
    getItem: vi.fn((id: number) => clipboardItems.get(id) ?? null),
    updateFigureLabel: vi.fn(),
    generateFigureId: vi
      .fn()
      .mockReturnValueOnce('fig01')
      .mockReturnValueOnce('fig02')
      .mockReturnValue('fig03'),
    exportImageToCache: vi.fn(async (item: { id: number }) => `/tmp/figure-${item.id}.png`),
  };
  manager.setClipboardManager(clipboardManager as any);
  return { manager, nativeHelper, prefs, clipboardManager, clipboardItems };
}

async function flushAsyncWork() {
  await Promise.resolve();
  await Promise.resolve();
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

  it('matches scrap phrase as a dedicated draft-clear command', async () => {
    const { manager } = createManager();

    const tailMatch = await (manager as any).matchTailCommand('scrap');
    expect(tailMatch?.commandName).toBe('scrap');

    manager.destroy();
  });

  it('matches submit phrase when only short trailing ASR noise follows it', () => {
    const { manager } = createManager();

    const result = (manager as any).checkSubmitPhrases('go ahead p.a.c.t');
    expect(result.shouldSubmit).toBe(true);
    expect(result.cleanedText).toBe('');

    manager.destroy();
  });

  it('does not match submit phrase when meaningful trailing words follow it', () => {
    const { manager } = createManager();

    const result = (manager as any).checkSubmitPhrases('go ahead with this');
    expect(result.shouldSubmit).toBe(false);

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
    expect(testState.execFile).toHaveBeenCalledWith(
      'osascript',
      ['-e', expect.stringContaining('bundle identifier is "com.tinyspeck.slackmacgap"')],
      expect.any(Function)
    );

    manager.destroy();
  });
});

describe('HotMicManager matchTailCommand early-exit guards', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('skips running app queries when text has no trigger prefixes', async () => {
    const { manager } = createManager();
    const getRunningApps = vi.fn(async () => [
      { bundleId: 'com.tinyspeck.slackmacgap', name: 'Slack' },
    ]);
    manager.setAppSwitcher({
      getRunningApps,
      activateApp: vi.fn(async () => true),
    } as any);

    const result = await (manager as any).matchTailCommand('alright can you hear me okay');
    expect(result).toBeNull();
    expect(getRunningApps).not.toHaveBeenCalled();

    manager.destroy();
  });

  it('queries running apps when text contains an app switch prefix', async () => {
    const { manager } = createManager();
    const getRunningApps = vi.fn(async () => [
      { bundleId: 'com.tinyspeck.slackmacgap', name: 'Slack' },
    ]);
    manager.setAppSwitcher({
      getRunningApps,
      activateApp: vi.fn(async () => true),
    } as any);

    const result = await (manager as any).matchTailCommand('open slack');
    expect(result?.commandName).toBe('app-switch:Slack');
    expect(getRunningApps).toHaveBeenCalled();

    manager.destroy();
  });
});

describe('HotMicManager transcript history persistence', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('inserts paste-phrase buffers into a focused Field Theory markdown editor', async () => {
    const { manager, nativeHelper } = createManager();
    const insertText = vi.fn(() => true);
    nativeHelper.getFrontmostApp.mockReturnValue({ bundleId: 'com.fieldtheory.app', name: 'Field Theory' });
    manager.setFieldTheoryMarkdownInsertionTarget({
      isAvailable: () => true,
      insertText,
    });

    await (manager as any).processListeningChunk('alpha beta paste');

    expect(insertText).toHaveBeenCalledWith('alpha beta ');
    expect(nativeHelper.typeIntoApp).not.toHaveBeenCalled();

    manager.destroy();
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

  it('submits when submit phrase is split across chunk boundary', async () => {
    const { manager, nativeHelper } = createManager();
    (manager as any).state = 'listening';

    await (manager as any).processListeningChunk('alpha beta go');
    await (manager as any).processListeningChunk('ahead');

    expect(nativeHelper.typeIntoApp).toHaveBeenCalledWith(
      'com.mitchellh.ghostty',
      'alpha beta',
      true
    );
    expect((manager as any).transcriptBuffer).toEqual([]);

    manager.destroy();
  });

  it('dedupes overlapping boundary words across adjacent chunks', async () => {
    const { manager } = createManager();
    (manager as any).state = 'listening';

    await (manager as any).processListeningChunk('we are testing boundary stitching');
    await (manager as any).processListeningChunk('boundary stitching right now');

    expect((manager as any).transcriptBuffer.join(' ')).toBe(
      'we are testing boundary stitching right now'
    );

    manager.destroy();
  });

  it('drops a fully duplicated chunk after boundary stitching', async () => {
    const { manager } = createManager();
    (manager as any).state = 'listening';

    await (manager as any).processListeningChunk('this is a test');
    await (manager as any).processListeningChunk('this is a test');

    expect((manager as any).transcriptBuffer).toEqual(['this is a test']);

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

describe('HotMicManager screenshot figure integration', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('labels screenshots with sequential figure numbers during active hot mic', () => {
    const { manager, clipboardManager, clipboardItems } = createManager();
    (manager as any).state = 'listening';
    (manager as any).hotMicSessionStartMs = Date.now() - 1000;

    clipboardItems.set(101, { id: 101, type: 'screenshot', imageData: Buffer.from([1]), createdAt: Date.now() - 800 });
    clipboardItems.set(102, { id: 102, type: 'screenshot', imageData: Buffer.from([2]), createdAt: Date.now() - 500 });

    manager.addScreenshotToSession(101);
    manager.addScreenshotToSession(102);

    expect(clipboardManager.updateFigureLabel).toHaveBeenCalledWith(101, '1', 'fig01');
    expect(clipboardManager.updateFigureLabel).toHaveBeenCalledWith(102, '2', 'fig02');
    expect((manager as any).hotMicScreenshotMetadata).toHaveLength(2);
    expect((manager as any).hotMicScreenshotMetadata[0].figureLabel).toBe('1');
    expect((manager as any).hotMicScreenshotMetadata[1].figureLabel).toBe('2');

    manager.destroy();
  });

  it('ignores stale screenshot callbacks from a prior draft window', () => {
    const { manager, clipboardManager, clipboardItems } = createManager();
    (manager as any).state = 'listening';
    (manager as any).hotMicSessionStartMs = Date.now();

    clipboardItems.set(111, {
      id: 111,
      type: 'screenshot',
      imageData: Buffer.from([1]),
      createdAt: Date.now() - 5000,
    });

    manager.addScreenshotToSession(111);

    expect(clipboardManager.updateFigureLabel).not.toHaveBeenCalled();
    expect((manager as any).hotMicScreenshotMetadata).toHaveLength(0);
    expect((manager as any).hotMicSessionItemIds).toHaveLength(0);

    manager.destroy();
  });

  it('injects inline figure refs and terminal figure paths into submit payload', async () => {
    const { manager, clipboardItems } = createManager();

    clipboardItems.set(201, { id: 201, type: 'screenshot', imageData: Buffer.from([1]) });
    clipboardItems.set(202, { id: 202, type: 'screenshot', imageData: Buffer.from([2]) });

    (manager as any).hotMicBufferSegments = [
      { text: 'alpha segment', endMs: 900 },
      { text: 'beta segment', endMs: 1800 },
    ];
    (manager as any).hotMicScreenshotMetadata = [
      { itemId: 201, figureLabel: '1', figureId: 'fig01', capturedAtMs: 500 },
      { itemId: 202, figureLabel: '2', figureId: 'fig02', capturedAtMs: 1500 },
    ];

    const payload = await (manager as any).buildFigureAwareHotMicPayload(
      'alpha segment beta segment',
      'com.apple.Terminal'
    );

    expect(payload).toContain('alpha segment [figure 1] beta segment [figure 2]');
    expect(payload).toContain('figure 1: `/tmp/figure-201.png`');
    expect(payload).toContain('figure 2: `/tmp/figure-202.png`');

    manager.destroy();
  });

  it('clears buffered figure/session state after submit flush', async () => {
    const { manager, nativeHelper, clipboardItems } = createManager();
    (manager as any).state = 'listening';
    (manager as any).hotMicSessionStartMs = Date.now() - 2000;

    clipboardItems.set(301, { id: 301, type: 'screenshot', imageData: Buffer.from([1]) });
    manager.addScreenshotToSession(301);

    await (manager as any).processListeningChunk('alpha go ahead');

    expect(nativeHelper.typeIntoApp).toHaveBeenCalledWith(
      'com.mitchellh.ghostty',
      expect.stringContaining('[figure 1]'),
      true
    );
    expect((manager as any).transcriptBuffer).toEqual([]);
    expect((manager as any).hotMicBufferSegments).toEqual([]);
    expect((manager as any).hotMicScreenshotMetadata).toEqual([]);
    expect((manager as any).hotMicSessionItemIds).toEqual([]);

    manager.destroy();
  });

  it('keeps clipboard manager method context when reading/exporting figure items', async () => {
    const { manager } = createManager();
    (manager as any).state = 'listening';
    (manager as any).hotMicSessionStartMs = Date.now() - 500;

    const contextualClipboardManager = {
      db: new Map<number, any>([
        [401, { id: 401, type: 'screenshot', imageData: Buffer.from([1]) }],
      ]),
      storeText: vi.fn(async () => 1),
      setClipboardHashFromText: vi.fn(),
      syncClipboardHash: vi.fn(),
      getItem(this: any, id: number) {
        return this.db.get(id) ?? null;
      },
      updateFigureLabel: vi.fn(),
      generateFigureId: vi.fn(() => 'ctx01'),
      exportImageToCache: vi.fn(async function(this: any, item: { id: number }) {
        return this.db.has(item.id) ? `/tmp/ctx-${item.id}.png` : null;
      }),
    };
    manager.setClipboardManager(contextualClipboardManager as any);

    expect(() => manager.addScreenshotToSession(401)).not.toThrow();
    expect(contextualClipboardManager.updateFigureLabel).toHaveBeenCalledWith(401, '1', 'ctx01');

    (manager as any).hotMicBufferSegments = [{ text: 'ctx payload', endMs: 900 }];
    const payload = await (manager as any).buildFigureAwareHotMicPayload(
      'ctx payload',
      'com.apple.Terminal'
    );

    expect(payload).toContain('[figure 1]');
    expect(payload).toContain('figure 1: `/tmp/ctx-401.png`');

    manager.destroy();
  });

  it('emits screenshotStackChanged when screenshots are added', () => {
    const { manager, clipboardItems } = createManager();
    (manager as any).state = 'listening';
    (manager as any).hotMicSessionStartMs = Date.now() - 1000;

    const listener = vi.fn();
    manager.on('screenshotStackChanged', listener);

    clipboardItems.set(601, { id: 601, type: 'screenshot', imageData: Buffer.from([1]), createdAt: Date.now() - 800 });
    clipboardItems.set(602, { id: 602, type: 'screenshot', imageData: Buffer.from([2]), createdAt: Date.now() - 500 });

    manager.addScreenshotToSession(601);
    expect(listener).toHaveBeenCalledWith(1);

    manager.addScreenshotToSession(602);
    expect(listener).toHaveBeenCalledWith(2);

    manager.destroy();
  });

  it('emits screenshotStackChanged(0) when draft context is cleared', () => {
    const { manager, clipboardItems } = createManager();
    (manager as any).state = 'listening';
    (manager as any).hotMicSessionStartMs = Date.now() - 1000;

    clipboardItems.set(701, { id: 701, type: 'screenshot', imageData: Buffer.from([1]), createdAt: Date.now() - 800 });
    manager.addScreenshotToSession(701);

    const listener = vi.fn();
    manager.on('screenshotStackChanged', listener);

    (manager as any).clearHotMicDraftContext(true);
    expect(listener).toHaveBeenCalledWith(0);

    manager.destroy();
  });

  it('does not emit screenshotStackChanged(0) when no screenshots were present', () => {
    const { manager } = createManager();
    (manager as any).state = 'listening';

    const listener = vi.fn();
    manager.on('screenshotStackChanged', listener);

    (manager as any).clearHotMicDraftContext(true);
    expect(listener).not.toHaveBeenCalled();

    manager.destroy();
  });

  it('expires screenshot-only draft state on silence timeout', async () => {
    vi.useFakeTimers();
    try {
      const { manager, clipboardItems } = createManager();
      (manager as any).state = 'listening';
      (manager as any).hotMicSessionStartMs = Date.now() - 300;

      clipboardItems.set(501, {
        id: 501,
        type: 'screenshot',
        imageData: Buffer.from([1]),
        createdAt: Date.now() - 200,
      });

      manager.addScreenshotToSession(501);
      expect((manager as any).hotMicScreenshotMetadata).toHaveLength(1);

      vi.advanceTimersByTime(4500);
      await Promise.resolve();

      expect((manager as any).hotMicScreenshotMetadata).toEqual([]);
      expect((manager as any).hotMicSessionItemIds).toEqual([]);

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

  it('suppresses drawer transcript in hot-mic mode (waveform-only)', async () => {
    const { manager } = createManager();
    const dynamicIslandManager = {
      sendMuteState: vi.fn(),
      updateHotMic: vi.fn(),
      updateDrawerTranscript: vi.fn(),
      updateHotMicBackgroundFilterMeter: vi.fn(),
    };
    manager.setDynamicIslandManager(dynamicIslandManager as any);

    await (manager as any).processListeningChunk('hello');
    await (manager as any).processListeningChunk('world');

    // Drawer is suppressed — transcript still buffered but not sent to drawer.
    expect(dynamicIslandManager.updateDrawerTranscript).not.toHaveBeenCalled();
    expect((manager as any).transcriptBuffer).toEqual(['hello', 'world']);

    manager.destroy();
  });

  it('still buffers text correctly after sanitizing bracketed artifacts', async () => {
    const { manager } = createManager();
    const dynamicIslandManager = {
      sendMuteState: vi.fn(),
      updateHotMic: vi.fn(),
      updateDrawerTranscript: vi.fn(),
      updateHotMicBackgroundFilterMeter: vi.fn(),
    };
    manager.setDynamicIslandManager(dynamicIslandManager as any);

    await (manager as any).processListeningChunk('[take vo] vo this should render cleanly');

    expect(dynamicIslandManager.updateDrawerTranscript).not.toHaveBeenCalled();
    // Buffer should have sanitized text.
    expect((manager as any).transcriptBuffer.length).toBe(1);
    expect((manager as any).transcriptBuffer[0]).toContain('should render cleanly');

    manager.destroy();
  });

  it('strips angle-bracket hallucinations like << and >> from chunks', async () => {
    const { manager } = createManager();
    const dynamicIslandManager = {
      sendMuteState: vi.fn(),
      updateHotMic: vi.fn(),
      updateDrawerTranscript: vi.fn(),
      updateHotMicBackgroundFilterMeter: vi.fn(),
    };
    manager.setDynamicIslandManager(dynamicIslandManager as any);

    await (manager as any).processListeningChunk('<< hello world >>');

    expect((manager as any).transcriptBuffer.length).toBe(1);
    expect((manager as any).transcriptBuffer[0]).toBe('hello world');

    manager.destroy();
  });

  it('drops chunks that are only angle-bracket noise', async () => {
    const { manager } = createManager();
    const dynamicIslandManager = {
      sendMuteState: vi.fn(),
      updateHotMic: vi.fn(),
      updateDrawerTranscript: vi.fn(),
      updateHotMicBackgroundFilterMeter: vi.fn(),
    };
    manager.setDynamicIslandManager(dynamicIslandManager as any);

    await (manager as any).processListeningChunk('<<');

    expect((manager as any).transcriptBuffer).toEqual([]);

    manager.destroy();
  });

  it('strips mm-hmm filler sounds from chunks', async () => {
    const { manager } = createManager();
    const dynamicIslandManager = {
      sendMuteState: vi.fn(),
      updateHotMic: vi.fn(),
      updateDrawerTranscript: vi.fn(),
      updateHotMicBackgroundFilterMeter: vi.fn(),
    };
    manager.setDynamicIslandManager(dynamicIslandManager as any);

    await (manager as any).processListeningChunk('mm-hmm hello there mm-hmm');

    expect((manager as any).transcriptBuffer.length).toBe(1);
    expect((manager as any).transcriptBuffer[0]).toBe('hello there');

    manager.destroy();
  });

  it('drops chunks that are only mm-hmm filler', async () => {
    const { manager } = createManager();
    const dynamicIslandManager = {
      sendMuteState: vi.fn(),
      updateHotMic: vi.fn(),
      updateDrawerTranscript: vi.fn(),
      updateHotMicBackgroundFilterMeter: vi.fn(),
    };
    manager.setDynamicIslandManager(dynamicIslandManager as any);

    await (manager as any).processListeningChunk('mm-hmm');

    expect((manager as any).transcriptBuffer).toEqual([]);

    manager.destroy();
  });

  it('drops artifact-only chunks that become empty after sanitization', async () => {
    const { manager } = createManager();
    const dynamicIslandManager = {
      sendMuteState: vi.fn(),
      updateHotMic: vi.fn(),
      updateDrawerTranscript: vi.fn(),
      updateHotMicBackgroundFilterMeter: vi.fn(),
    };
    manager.setDynamicIslandManager(dynamicIslandManager as any);

    await (manager as any).processListeningChunk('[take vo] vo');

    expect(dynamicIslandManager.updateDrawerTranscript).not.toHaveBeenCalled();
    expect((manager as any).transcriptBuffer).toEqual([]);

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
      sendMuteState: vi.fn(),
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
    expect(nativeHelper.setHarvestMode).toHaveBeenCalledWith('dictation', 0);

    manager.destroy();
  });

  it('clears the live draft buffer on spoken scrap without sending Ctrl+C', async () => {
    const { manager } = createManager();
    const dynamicIslandManager = {
      sendMuteState: vi.fn(),
      updateDrawerTranscript: vi.fn(),
      updateHotMic: vi.fn(),
      updateHotMicBackgroundFilterMeter: vi.fn(),
    };
    manager.setDynamicIslandManager(dynamicIslandManager as any);
    (manager as any).state = 'listening';
    (manager as any).muted = false;
    (manager as any).transcriptBuffer = ['alpha beta gamma'];
    testState.exec.mockClear();

    await (manager as any).processListeningChunk('scrap');

    expect((manager as any).transcriptBuffer).toEqual([]);
    expect(dynamicIslandManager.updateDrawerTranscript).toHaveBeenCalledWith('');
    expect(testState.exec).not.toHaveBeenCalledWith(
      expect.stringContaining('keystroke "c" using control down'),
      expect.any(Function)
    );

    manager.destroy();
  });
});

describe('HotMicManager hallucination guards', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('classifies repeated short-unit gibberish as hallucination', () => {
    const { manager } = createManager();
    const repeated = 'dom'.repeat(160);

    expect((manager as any).isHallucination(repeated)).toBe(true);

    manager.destroy();
  });

  it('classifies repeated-word loops as hallucination', () => {
    const { manager } = createManager();
    const repeatedWords = Array(14).fill('dom').join(' ');

    expect((manager as any).isHallucination(repeatedWords)).toBe(true);

    manager.destroy();
  });

  it('classifies repeated long single-token bursts as hallucination', () => {
    const { manager } = createManager();

    expect((manager as any).isHallucination('millennium millennium')).toBe(true);

    manager.destroy();
  });

  it('keeps short conversational repeats and command repeats', () => {
    const { manager } = createManager();

    expect((manager as any).isHallucination('hello hello')).toBe(false);
    expect((manager as any).isHallucination('scrap scrap')).toBe(false);

    manager.destroy();
  });

  it('keeps normal dictation chunks', () => {
    const { manager } = createManager();
    const text = 'can you hear me we are testing normal dictation quality now';

    expect((manager as any).isHallucination(text)).toBe(false);

    manager.destroy();
  });

  it('drops repetition artifacts before buffering in listening mode', async () => {
    const { manager } = createManager();
    (manager as any).state = 'listening';
    const dynamicIslandManager = {
      sendMuteState: vi.fn(),
      updateHotMic: vi.fn(),
      updateDrawerTranscript: vi.fn(),
      updateHotMicBackgroundFilterMeter: vi.fn(),
    };
    manager.setDynamicIslandManager(dynamicIslandManager as any);

    await (manager as any).processListeningChunk('dom'.repeat(120));

    expect((manager as any).transcriptBuffer).toEqual([]);
    expect(dynamicIslandManager.updateDrawerTranscript).not.toHaveBeenCalled();

    manager.destroy();
  });

  it('drops long repeated-word bursts before buffering in listening mode', async () => {
    const { manager } = createManager();
    (manager as any).state = 'listening';
    const dynamicIslandManager = {
      sendMuteState: vi.fn(),
      updateHotMic: vi.fn(),
      updateDrawerTranscript: vi.fn(),
      updateHotMicBackgroundFilterMeter: vi.fn(),
    };
    manager.setDynamicIslandManager(dynamicIslandManager as any);

    await (manager as any).processListeningChunk('millennium millennium');

    expect((manager as any).transcriptBuffer).toEqual([]);
    expect(dynamicIslandManager.updateDrawerTranscript).not.toHaveBeenCalled();

    manager.destroy();
  });

  it('keeps repeated long words when they are part of a normal sentence', () => {
    const { manager } = createManager();

    expect((manager as any).isHallucination('millennium project hit a milestone this week')).toBe(false);

    manager.destroy();
  });
});

describe('HotMicManager background voice filter', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('keeps very low strictness threshold permissive', () => {
    const { manager } = createManager({
      hotMicBackgroundFilterEnabled: true,
      hotMicBackgroundFilterStrength: 0,
    });

    const threshold = (manager as any).getBackgroundFilterThreshold(0);
    expect(threshold).toBeCloseTo(0.004, 5);

    manager.destroy();
  });

  it('raises filter gate thresholds as strictness increases', () => {
    const { manager } = createManager({
      hotMicBackgroundFilterEnabled: true,
      hotMicBackgroundFilterStrength: 50,
    });

    const lowGate = (manager as any).getBackgroundFilterGate(0);
    const highGate = (manager as any).getBackgroundFilterGate(100);

    expect(highGate.threshold).toBeGreaterThan(lowGate.threshold);
    expect(highGate.ratioThreshold).toBeGreaterThan(lowGate.ratioThreshold);
    expect(highGate.minSpeechSamples).toBeGreaterThan(lowGate.minSpeechSamples);
    expect(highGate.peakThreshold).toBeGreaterThan(lowGate.peakThreshold);

    manager.destroy();
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

  it('does not over-suppress near-field speech at very low strictness', () => {
    const { manager } = createManager({
      hotMicBackgroundFilterEnabled: true,
      hotMicBackgroundFilterStrength: 2,
    });

    const result = (manager as any).evaluateChunkBackgroundFilter({
      sampleCount: 30,
      speechSamples: 24,
      speechRatio: 0.8,
      rawAverage: 0.006,
      speechAverage: 0.0062,
      rawPeak: 0.01,
      speechPeak: 0.0105,
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
      sendMuteState: vi.fn(),
      updateHotMic: vi.fn(),
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

describe('HotMicManager audio diagnostics', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('flags sustained audio energy with near-zero speech ratio as a likely speech miss', () => {
    const { manager } = createManager();

    const shouldWarn = (manager as any).shouldWarnForSpeechMiss(0.03, 0.01, 0.0);
    expect(shouldWarn).toBe(true);

    manager.destroy();
  });

  it('does not flag low-energy input as a speech miss', () => {
    const { manager } = createManager();

    const shouldWarn = (manager as any).shouldWarnForSpeechMiss(0.01, 0.003, 0.0);
    expect(shouldWarn).toBe(false);

    manager.destroy();
  });

  it('does not flag healthy speech ratios as a speech miss', () => {
    const { manager } = createManager();

    const shouldWarn = (manager as any).shouldWarnForSpeechMiss(0.05, 0.015, 0.24);
    expect(shouldWarn).toBe(false);

    manager.destroy();
  });
});

describe('HotMicManager audio device recovery', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('restarts active recording when the priority input disappears and a fallback input exists', async () => {
    const { manager, nativeHelper } = createManager();
    const audioManager = new EventEmitter() as EventEmitter & { getState: ReturnType<typeof vi.fn> };
    audioManager.getState = vi.fn(() => ({ defaultInputId: 'built-in-mic' }));

    manager.setAudioManager(audioManager as any);
    (manager as any).state = 'listening';
    nativeHelper.isRecordingActive.mockReturnValue(true);

    audioManager.emit('priorityDeviceUnavailable', 'priority-mic');
    await flushAsyncWork();

    expect(nativeHelper.stopRecording).toHaveBeenCalledTimes(1);
    expect(nativeHelper.startRecording).toHaveBeenCalledTimes(1);
    manager.destroy();
  });

  it('stops active recording when the priority input disappears and no fallback input exists', async () => {
    const { manager, nativeHelper } = createManager();
    const audioManager = new EventEmitter() as EventEmitter & { getState: ReturnType<typeof vi.fn> };
    audioManager.getState = vi.fn(() => ({ defaultInputId: null }));

    manager.setAudioManager(audioManager as any);
    (manager as any).state = 'listening';
    nativeHelper.isRecordingActive.mockReturnValue(true);

    audioManager.emit('priorityDeviceUnavailable', 'priority-mic');
    await flushAsyncWork();

    expect(nativeHelper.stopRecording).toHaveBeenCalledTimes(1);
    expect(nativeHelper.startRecording).not.toHaveBeenCalled();
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

  it('releases Escape to standard recording during handoff and restores it after resume', async () => {
    const { manager, nativeHelper } = createManager();
    vi.mocked(globalShortcut.register).mockClear().mockReturnValue(true);
    vi.mocked(globalShortcut.unregister).mockClear();

    (manager as any).setState('listening');
    nativeHelper.isRecordingActive
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);

    await manager.yieldToTranscriber();
    expect(globalShortcut.unregister).toHaveBeenCalledWith('Escape');

    await manager.resumeAfterTranscriber();
    expect(globalShortcut.register).toHaveBeenCalledWith('Escape', expect.any(Function));
    expect(globalShortcut.register).toHaveBeenCalledTimes(2);
    manager.destroy();
  });
});

describe('HotMicManager Escape dismissal', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('requires two Escape presses before dismissing Hot Mic and releasing Escape', () => {
    const { manager } = createManager();
    const cursorStatusManager = { showRecordingNote: vi.fn() };
    const dynamicIslandManager = {
      sendMuteState: vi.fn(),
      showEscapeHint: vi.fn(),
      updateDrawerTranscript: vi.fn(),
      updateHotMic: vi.fn(),
      updateStackCount: vi.fn(),
    };
    const deactivated = vi.fn();
    const inputModeResetRequested = vi.fn();

    manager.setCursorStatusManager(cursorStatusManager as any);
    manager.setDynamicIslandManager(dynamicIslandManager as any);
    manager.on('deactivated', deactivated);
    manager.on('inputModeResetRequested', inputModeResetRequested);
    vi.mocked(globalShortcut.register).mockClear().mockReturnValue(true);
    vi.mocked(globalShortcut.unregister).mockClear();

    (manager as any).setState('listening');
    const escapeHandler = vi.mocked(globalShortcut.register).mock.calls.find(
      ([accelerator]) => accelerator === 'Escape'
    )?.[1] as () => void;

    escapeHandler();
    expect(cursorStatusManager.showRecordingNote).toHaveBeenCalledWith(
      'Press Esc again to stop Hot Mic'
    );
    expect(dynamicIslandManager.showEscapeHint).toHaveBeenCalledTimes(1);
    expect(deactivated).not.toHaveBeenCalled();
    expect(inputModeResetRequested).not.toHaveBeenCalled();

    escapeHandler();
    expect(deactivated).toHaveBeenCalledTimes(1);
    expect(inputModeResetRequested).toHaveBeenCalledTimes(1);
    expect(dynamicIslandManager.updateStackCount).toHaveBeenCalledWith(0);
    expect(dynamicIslandManager.updateDrawerTranscript).toHaveBeenCalledWith('');
    expect(dynamicIslandManager.updateHotMic).toHaveBeenCalledWith(false, 0, '');
    expect(globalShortcut.unregister).toHaveBeenCalledWith('Escape');
    manager.destroy();
  });

  it('clears screenshot UI state when the second Escape dismisses Hot Mic', () => {
    const { manager, clipboardItems } = createManager();
    const dynamicIslandManager = {
      sendMuteState: vi.fn(),
      showEscapeHint: vi.fn(),
      updateDrawerTranscript: vi.fn(),
      updateHotMic: vi.fn(),
      updateStackCount: vi.fn(),
    };
    const screenshotStackChanged = vi.fn();

    manager.setDynamicIslandManager(dynamicIslandManager as any);
    manager.on('screenshotStackChanged', screenshotStackChanged);
    vi.mocked(globalShortcut.register).mockClear().mockReturnValue(true);

    (manager as any).setState('listening');
    (manager as any).hotMicSessionStartMs = Date.now() - 1000;
    clipboardItems.set(801, { id: 801, type: 'screenshot', imageData: Buffer.from([1]), createdAt: Date.now() - 500 });
    manager.addScreenshotToSession(801);
    const escapeHandler = vi.mocked(globalShortcut.register).mock.calls.find(
      ([accelerator]) => accelerator === 'Escape'
    )?.[1] as () => void;

    escapeHandler();
    escapeHandler();

    expect((manager as any).hotMicScreenshotMetadata).toEqual([]);
    expect((manager as any).hotMicSessionItemIds).toEqual([]);
    expect(screenshotStackChanged).toHaveBeenCalledWith(0);
    expect(dynamicIslandManager.updateStackCount).toHaveBeenCalledWith(0);
    expect(dynamicIslandManager.updateDrawerTranscript).toHaveBeenCalledWith('');
    expect(dynamicIslandManager.updateHotMic).toHaveBeenCalledWith(false, 0, '');
    manager.destroy();
  });

  it('lets the first Escape warning expire without dismissing Hot Mic', () => {
    vi.useFakeTimers();
    const { manager } = createManager();
    const cursorStatusManager = { showRecordingNote: vi.fn() };
    const dynamicIslandManager = {
      sendMuteState: vi.fn(),
      showEscapeHint: vi.fn(),
      updateDrawerTranscript: vi.fn(),
      updateHotMic: vi.fn(),
      updateStackCount: vi.fn(),
    };
    const deactivated = vi.fn();
    const inputModeResetRequested = vi.fn();

    manager.setCursorStatusManager(cursorStatusManager as any);
    manager.setDynamicIslandManager(dynamicIslandManager as any);
    manager.on('deactivated', deactivated);
    manager.on('inputModeResetRequested', inputModeResetRequested);
    vi.mocked(globalShortcut.register).mockClear().mockReturnValue(true);
    vi.mocked(globalShortcut.unregister).mockClear();

    (manager as any).setState('listening');
    const escapeHandler = vi.mocked(globalShortcut.register).mock.calls.find(
      ([accelerator]) => accelerator === 'Escape'
    )?.[1] as () => void;

    escapeHandler();
    vi.advanceTimersByTime(1_700);
    escapeHandler();

    expect(cursorStatusManager.showRecordingNote).toHaveBeenCalledTimes(2);
    expect(dynamicIslandManager.showEscapeHint).toHaveBeenCalledTimes(2);
    expect(deactivated).not.toHaveBeenCalled();
    expect(inputModeResetRequested).not.toHaveBeenCalled();

    escapeHandler();
    expect(deactivated).toHaveBeenCalledTimes(1);
    expect(inputModeResetRequested).toHaveBeenCalledTimes(1);
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

describe('HotMicManager mute persistence', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('loads muted preference at startup', () => {
    const { manager } = createManager({ hotMicMuted: true });
    expect(manager.isMuted).toBe(true);
    manager.destroy();
  });

  it('persists mute preference and emits unified status updates on toggle', async () => {
    const { manager, prefs } = createManager();
    const statusChanged = vi.fn();
    manager.on('statusChanged', statusChanged);

    (manager as any).state = 'listening';
    await manager.toggleMute();
    await manager.toggleMute();

    expect(prefs.save).toHaveBeenCalledWith({ hotMicMuted: true });
    expect(prefs.save).toHaveBeenCalledWith({ hotMicMuted: false });
    expect(statusChanged).toHaveBeenCalledWith({ state: 'listening', muted: true });
    expect(statusChanged).toHaveBeenCalledWith({ state: 'listening', muted: false });
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

  it('includes engine status from the injected getter', () => {
    const { manager } = createManager();
    const engineStatus = {
      selectedEngine: 'mlx-whisper',
      source: 'global',
      whisperModel: 'small',
      readiness: 'warming',
      detail: 'MLX Whisper server is warming up',
      fallbackAvailable: true,
    } as const;

    manager.setEngineStatusGetter(() => engineStatus);
    const status = manager.getRuntimeStatus();

    expect(status.engine).toEqual(engineStatus);
    manager.destroy();
  });

  it('reports a disabled engine status if the getter throws', () => {
    const { manager } = createManager({ transcriptionEngine: 'mlx-whisper' });
    manager.setEngineStatusGetter(() => {
      throw new Error('engine probe failed');
    });

    const status = manager.getRuntimeStatus();

    expect(status.engine).toMatchObject({
      selectedEngine: 'parakeet',
      source: 'global',
      readiness: 'disabled',
      fallbackAvailable: false,
    });
    expect(status.engine?.detail).toContain('engine probe failed');
    manager.destroy();
  });

  it('uses the injected engine status for log-facing engine resolution', () => {
    const { manager } = createManager({ transcriptionEngine: 'whisper' });
    manager.setEngineStatusGetter(() => ({
      selectedEngine: 'parakeet',
      source: 'global',
      whisperModel: 'small',
      readiness: 'ready',
      detail: null,
      fallbackAvailable: true,
    }));

    expect((manager as any).getConfiguredTranscriptionEngineForLogs()).toBe('parakeet');
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

  it('always reports mic as healthy when muted', () => {
    const { manager } = createManager();
    (manager as any).state = 'listening';
    (manager as any).condition = 'muted';
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

  it('switches harvest mode to command under queue pressure', () => {
    const { manager, nativeHelper } = createManager();
    const queue = (manager as any).pendingChunkQueue;
    queue.push({ filePath: '/tmp/a.wav', audioStats: {} });
    queue.push({ filePath: '/tmp/b.wav', audioStats: {} });

    (manager as any).setRealtimeHarvestMode();

    expect(nativeHelper.setHarvestMode).toHaveBeenCalledWith('command', 0);
    manager.destroy();
  });

  it('avoids duplicate harvest mode updates when mode does not change', () => {
    const { manager, nativeHelper } = createManager();

    (manager as any).setRealtimeHarvestMode();
    (manager as any).setRealtimeHarvestMode();

    expect(nativeHelper.setHarvestMode).toHaveBeenCalledTimes(1);
    expect(nativeHelper.setHarvestMode).toHaveBeenCalledWith('dictation', 0);
    manager.destroy();
  });

  it('returns harvest mode to dictation after queue pressure clears', () => {
    const { manager, nativeHelper } = createManager({ transcriptionEngine: 'mlx-whisper' });
    const queue = (manager as any).pendingChunkQueue;
    queue.push({ filePath: '/tmp/a.wav', audioStats: {} });
    queue.push({ filePath: '/tmp/b.wav', audioStats: {} });

    (manager as any).setRealtimeHarvestMode();
    queue.length = 0;
    (manager as any).chunkProcessingInFlight = false;
    (manager as any).setRealtimeHarvestMode();

    expect(nativeHelper.setHarvestMode).toHaveBeenNthCalledWith(1, 'command', 0);
    expect(nativeHelper.setHarvestMode).toHaveBeenNthCalledWith(2, 'dictation', 0);
    manager.destroy();
  });

  it('surfaces startup timeouts to the user instead of failing silently', () => {
    const { manager } = createManager();
    const cursorStatusManager = { showCriticalMessage: vi.fn() };
    manager.setCursorStatusManager(cursorStatusManager as any);

    (manager as any).maybeShowTranscriptionFailure(
      new Error('Transcription engine startup timed out (60s)'),
      'chunk'
    );

    expect(cursorStatusManager.showCriticalMessage).toHaveBeenCalledWith(
      'Hot Mic: transcription engine startup timed out'
    );
    manager.destroy();
  });

  it('passes silenceMs 0 for parakeet engine', () => {
    const { manager, nativeHelper } = createManager({ transcriptionEngine: 'parakeet' });

    (manager as any).setRealtimeHarvestMode();

    expect(nativeHelper.setHarvestMode).toHaveBeenCalledWith('dictation', 0);
    manager.destroy();
  });

  it('passes silenceMs 0 for parakeet multilingual engine', () => {
    const { manager, nativeHelper } = createManager({ transcriptionEngine: 'parakeet-multilingual' });

    (manager as any).setRealtimeHarvestMode();

    expect(nativeHelper.setHarvestMode).toHaveBeenCalledWith('dictation', 0);
    manager.destroy();
  });

  it('uses longer forced snapshot interval under queue pressure', () => {
    const { manager } = createManager({ transcriptionEngine: 'mlx-whisper' });
    const queue = (manager as any).pendingChunkQueue;

    expect((manager as any).getForcedSnapshotMaxMs()).toBe(700);

    queue.push({ filePath: '/tmp/a.wav', audioStats: {} });
    expect((manager as any).getForcedSnapshotMaxMs()).toBe(1400);

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

describe('HotMicManager dynamic island sync', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('syncs muted idle state when Dynamic Island attaches', () => {
    const { manager } = createManager({ hotMicMuted: true });
    const dynamicIslandManager = {
      sendMuteState: vi.fn(),
      updateHotMic: vi.fn(),
      updateDrawerTranscript: vi.fn(),
      updateHotMicBackgroundFilterMeter: vi.fn(),
    };

    manager.setDynamicIslandManager(dynamicIslandManager as any);

    expect(dynamicIslandManager.sendMuteState).toHaveBeenCalledWith(true);
    expect(dynamicIslandManager.updateHotMic).toHaveBeenCalledWith(false, 0, '');
    manager.destroy();
  });

  it('syncs active state with buffered words when Dynamic Island attaches', () => {
    const { manager } = createManager();
    const dynamicIslandManager = {
      sendMuteState: vi.fn(),
      updateHotMic: vi.fn(),
      updateDrawerTranscript: vi.fn(),
      updateHotMicBackgroundFilterMeter: vi.fn(),
    };

    (manager as any).state = 'listening';
    (manager as any).muted = false;
    (manager as any).transcriptBuffer = ['alpha beta'];

    manager.setDynamicIslandManager(dynamicIslandManager as any);

    expect(dynamicIslandManager.sendMuteState).toHaveBeenCalledWith(false);
    expect(dynamicIslandManager.updateHotMic).toHaveBeenCalledWith(true, 2, 'beta');
    manager.destroy();
  });

  it('hides the orange dot while yielded to standard transcription', () => {
    const { manager } = createManager();
    const dynamicIslandManager = {
      sendMuteState: vi.fn(),
      updateHotMic: vi.fn(),
      updateDrawerTranscript: vi.fn(),
      updateHotMicBackgroundFilterMeter: vi.fn(),
    };

    (manager as any).state = 'listening';
    (manager as any).muted = false;
    (manager as any).yieldedToTranscriber = true;
    manager.setDynamicIslandManager(dynamicIslandManager as any);

    expect(dynamicIslandManager.updateHotMic).toHaveBeenCalledWith(false, 0, '');
    manager.destroy();
  });
});
