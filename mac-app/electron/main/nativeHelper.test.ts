import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: vi.fn(() => '/tmp'),
  },
}));

vi.mock('./logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { NativeHelper } from './nativeHelper';

async function flushMicrotasks(rounds: number = 4): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await Promise.resolve();
  }
}

function createHelperHarness() {
  const stdin = {
    writable: true,
    write: vi.fn(() => true),
    once: vi.fn(),
  };

  const helper = new NativeHelper() as any;
  helper.child = {
    stdin,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    on: vi.fn(),
  };
  helper.isReady = true;
  helper.isRunning = true;
  helper.waitForReady = vi.fn(async () => undefined);

  return {
    helper,
    stdin,
    sentCommands: () =>
      (stdin.write.mock.calls as unknown[][]).map(([line]) => JSON.parse(String(line).trim())),
  };
}

describe('NativeHelper recording command sequencing', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('waits for cancel completion before restarting recording', async () => {
    vi.useFakeTimers();
    const { helper, stdin, sentCommands } = createHelperHarness();

    helper.recordingActive = true;

    const cancelPromise = helper.cancelRecording();
    await flushMicrotasks();

    expect(sentCommands()).toEqual([{ type: 'cancelRecording' }]);

    const startPromise = helper.startRecording();
    await flushMicrotasks();

    expect(stdin.write).toHaveBeenCalledTimes(1);

    helper.handleMessage({ type: 'recordingCancelled' });
    await flushMicrotasks();

    expect(stdin.write).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(174);
    expect(stdin.write).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(sentCommands()).toEqual([
      { type: 'cancelRecording' },
      { type: 'startRecording', recordingSource: 'microphone' },
    ]);

    helper.handleMessage({ type: 'recordingStarted' });

    await expect(cancelPromise).resolves.toBeUndefined();
    await expect(startPromise).resolves.toBeUndefined();
  });

  it('retries transient start failures after a short backoff', async () => {
    vi.useFakeTimers();
    const { helper, sentCommands } = createHelperHarness();

    const startPromise = helper.startRecording();
    await flushMicrotasks();

    expect(sentCommands()).toEqual([{ type: 'startRecording', recordingSource: 'microphone' }]);

    helper.handleMessage({ type: 'error', message: 'Failed to start recording' });
    await flushMicrotasks();

    expect(sentCommands()).toEqual([{ type: 'startRecording', recordingSource: 'microphone' }]);

    await vi.advanceTimersByTimeAsync(120);
    expect(sentCommands()).toEqual([
      { type: 'startRecording', recordingSource: 'microphone' },
      { type: 'startRecording', recordingSource: 'microphone' },
    ]);

    helper.handleMessage({ type: 'recordingStarted' });

    await expect(startPromise).resolves.toBeUndefined();
  });

  it('passes through a system-audio recording source override', async () => {
    const { helper, sentCommands } = createHelperHarness();

    const startPromise = helper.startRecording('system-audio');
    await flushMicrotasks();

    expect(sentCommands()).toEqual([{ type: 'startRecording', recordingSource: 'system-audio' }]);

    helper.handleMessage({ type: 'recordingStarted' });
    await expect(startPromise).resolves.toBeUndefined();
  });

  it('does not ask the helper to snapshot when no recording is active', async () => {
    const { helper, stdin } = createHelperHarness();

    await expect(helper.snapshotRecording()).rejects.toThrow('No recording in progress');

    expect(stdin.write).not.toHaveBeenCalled();
  });

  it('does not ask the helper to stop when no recording is active', async () => {
    const { helper, stdin } = createHelperHarness();

    await expect(helper.stopRecording()).rejects.toThrow('No recording in progress');

    expect(stdin.write).not.toHaveBeenCalled();
  });

  it('honors the requested frontmost window bounds timeout', async () => {
    vi.useFakeTimers();
    const { helper, sentCommands } = createHelperHarness();
    const settled = vi.fn();

    const boundsPromise = helper.getFrontmostWindowBounds(35).then(settled);
    await flushMicrotasks();

    expect(sentCommands()).toEqual([{ type: 'getFrontmostWindowBounds' }]);
    await vi.advanceTimersByTimeAsync(34);
    expect(settled).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await boundsPromise;

    expect(settled).toHaveBeenCalledWith(null);
  });

  it('passes native paste diagnostics back to command launcher callers', async () => {
    const { helper, sentCommands } = createHelperHarness();

    const typePromise = helper.typeIntoApp('com.mitchellh.ghostty', '[pr.md]\n/commands/pr.md ', false);
    await flushMicrotasks();

    expect(sentCommands()).toEqual([{
      type: 'typeIntoApp',
      bundleId: 'com.mitchellh.ghostty',
      text: '[pr.md]\n/commands/pr.md ',
      pressEnter: false,
    }]);

    helper.handleMessage({
      type: 'typeIntoAppResult',
      success: true,
      accessibilityTrusted: true,
      targetFrontmost: true,
      focusedTextInput: true,
      pasteboardWritten: true,
      eventTarget: 'pid',
    });

    await expect(typePromise).resolves.toEqual({
      success: true,
      error: undefined,
      accessibilityTrusted: true,
      targetFrontmost: true,
      focusedTextInput: true,
      pasteboardWritten: true,
      eventTarget: 'pid',
    });
  });

  it('passes command-enter submit mode to the native helper', async () => {
    const { helper, sentCommands } = createHelperHarness();

    const typePromise = helper.typeIntoApp('com.mitchellh.ghostty', 'alpha beta', true, 'command-enter');
    await flushMicrotasks();

    expect(sentCommands()).toEqual([{
      type: 'typeIntoApp',
      bundleId: 'com.mitchellh.ghostty',
      text: 'alpha beta',
      pressEnter: true,
      submitMode: 'command-enter',
    }]);

    helper.handleMessage({
      type: 'typeIntoAppResult',
      success: true,
    });

    await expect(typePromise).resolves.toMatchObject({ success: true });
  });
});
