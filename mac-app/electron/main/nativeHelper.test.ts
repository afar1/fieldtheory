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
      { type: 'startRecording', recordingSource: 'microphone', requestId: expect.any(String) },
    ]);

    helper.handleMessage({ type: 'recordingStarted', requestId: sentCommands().at(-1)?.requestId });

    await expect(cancelPromise).resolves.toBeUndefined();
    await expect(startPromise).resolves.toBeUndefined();
  });

  it('retries transient start failures after a short backoff', async () => {
    vi.useFakeTimers();
    const { helper, sentCommands } = createHelperHarness();

    const startPromise = helper.startRecording();
    await flushMicrotasks();

    expect(sentCommands()).toEqual([{ type: 'startRecording', recordingSource: 'microphone', requestId: expect.any(String) }]);

    helper.handleMessage({ type: 'error', message: 'Failed to start recording' });
    await flushMicrotasks();

    expect(sentCommands()).toEqual([{ type: 'startRecording', recordingSource: 'microphone', requestId: expect.any(String) }]);

    await vi.advanceTimersByTimeAsync(120);
    expect(sentCommands()).toEqual([
      { type: 'startRecording', recordingSource: 'microphone', requestId: expect.any(String) },
      { type: 'startRecording', recordingSource: 'microphone', requestId: expect.any(String) },
    ]);

    helper.handleMessage({ type: 'recordingStarted', requestId: sentCommands().at(-1)?.requestId });

    await expect(startPromise).resolves.toBeUndefined();
  });

  it.each(['system-audio', 'microphone-and-system-audio'] as const)('passes through the %s recording source', async source => {
    const { helper, sentCommands } = createHelperHarness();

    const startPromise = helper.startRecording(source);
    await flushMicrotasks();

    expect(sentCommands()).toEqual([{ type: 'startRecording', recordingSource: source, requestId: expect.any(String) }]);

    helper.handleMessage({ type: 'recordingStarted', requestId: sentCommands().at(-1)?.requestId });
    await expect(startPromise).resolves.toBeUndefined();
  });

  it('reports system capture permission failures immediately without restarting audio', async () => {
    const { helper, sentCommands } = createHelperHarness();
    const startPromise = helper.startRecording('microphone-and-system-audio');
    const rejected = expect(startPromise).rejects.toThrow('Screen Recording permission required');
    await flushMicrotasks();
    helper.handleMessage({ type: 'recordingStartFailed', requestId: sentCommands()[0].requestId, message: 'Screen Recording permission required' });
    await rejected;
    expect(sentCommands()).toHaveLength(1);
    expect(helper.recordingActive).toBe(false);
  });

  it('ignores late startup replies from another request', async () => {
    const { helper, sentCommands } = createHelperHarness();
    const startPromise = helper.startRecording('microphone-and-system-audio');
    await flushMicrotasks();
    helper.handleMessage({ type: 'recordingStarted', requestId: 'previous-request' });
    expect(helper.recordingActive).toBe(false);
    helper.handleMessage({ type: 'recordingStarted', requestId: sentCommands()[0].requestId });
    await expect(startPromise).resolves.toBeUndefined();
    expect(helper.recordingActive).toBe(true);
  });

  it('releases recording state when the native stop operation fails', async () => {
    const { helper, sentCommands } = createHelperHarness();
    helper.recordingActive = true;
    const stopPromise = helper.stopRecording();
    const rejected = expect(stopPromise).rejects.toThrow('Audio file could not be closed');
    await flushMicrotasks();
    helper.handleMessage({ type: 'recordingStopFailed', requestId: sentCommands()[0].requestId, message: 'Audio file could not be closed' });
    await rejected;
    expect(helper.recordingActive).toBe(false);
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
      requestId: expect.any(String),
      bundleId: 'com.mitchellh.ghostty',
      text: '[pr.md]\n/commands/pr.md ',
      pressEnter: false,
    }]);

    helper.handleMessage({
      type: 'typeIntoAppResult',
      requestId: sentCommands().find(command => command.type === 'typeIntoApp')?.requestId,
      success: true,
      accessibilityTrusted: true,
      targetFrontmost: true,
      focusedTextInput: true,
      pasteboardWritten: true,
      eventTarget: 'pid',
    });

    await expect(typePromise).resolves.toEqual({
      requestId: expect.any(String),
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
      requestId: expect.any(String),
      bundleId: 'com.mitchellh.ghostty',
      text: 'alpha beta',
      pressEnter: true,
      submitMode: 'command-enter',
    }]);

    helper.handleMessage({
      type: 'typeIntoAppResult',
      requestId: sentCommands().find(command => command.type === 'typeIntoApp')?.requestId,
      success: true,
    });

    await expect(typePromise).resolves.toMatchObject({ success: true });
  });

  it('passes target window bounds to the native helper when provided', async () => {
    const { helper, sentCommands } = createHelperHarness();
    const targetWindowBounds = { x: 200, y: 160, width: 1200, height: 820 };

    const typePromise = helper.typeIntoApp('com.openai.codex', '[release.md]\\n', false, undefined, targetWindowBounds);
    await flushMicrotasks();

    expect(sentCommands()).toEqual([{
      type: 'typeIntoApp',
      requestId: expect.any(String),
      bundleId: 'com.openai.codex',
      text: '[release.md]\\n',
      pressEnter: false,
      targetWindowBounds,
    }]);

    helper.handleMessage({
      type: 'typeIntoAppResult',
      requestId: sentCommands().find(command => command.type === 'typeIntoApp')?.requestId,
      success: true,
    });

    await expect(typePromise).resolves.toMatchObject({ success: true });
  });

  it('correlates overlapping paste replies and ignores unrelated replies', async () => {
    const { helper, sentCommands } = createHelperHarness();
    const first = helper.typeIntoApp('com.openai.codex', 'first', false);
    const second = helper.typeIntoApp('com.openai.codex', 'second', false);
    let firstDone = false;
    let secondDone = false;
    void first.then(() => { firstDone = true; });
    void second.then(() => { secondDone = true; });
    await flushMicrotasks();
    const [a, b] = sentCommands();
    expect(a.requestId).not.toBe(b.requestId);
    helper.handleMessage({ type: 'typeIntoAppResult', requestId: 'expired-request', success: true });
    await flushMicrotasks();
    expect(firstDone || secondDone).toBe(false);
    helper.handleMessage({ type: 'typeIntoAppResult', requestId: b.requestId, success: false, error: 'second failed' });
    await flushMicrotasks();
    expect(firstDone).toBe(false);
    expect(secondDone).toBe(true);
    helper.handleMessage({ type: 'typeIntoAppResult', requestId: a.requestId, success: true });
    await expect(first).resolves.toMatchObject({ success: true });
    await expect(second).resolves.toMatchObject({ success: false, error: 'second failed' });
  });

  it('requests a process-targeted paste for long Codex composer input without changing the payload', async () => {
    const { helper, sentCommands } = createHelperHarness();
    const targetWindowBounds = { x: 200, y: 160, width: 1200, height: 820 };
    const longCommandInput = `[review.md] /Users/afar/.fieldtheory/library/Commands/review.md\n${'context '.repeat(5000)}`;

    const typePromise = helper.typeIntoApp(
      'com.openai.codex',
      longCommandInput,
      false,
      undefined,
      targetWindowBounds,
      'pid',
    );
    await flushMicrotasks();

    expect(sentCommands()).toEqual([{
      type: 'typeIntoApp',
      requestId: expect.any(String),
      bundleId: 'com.openai.codex',
      text: longCommandInput,
      pressEnter: false,
      targetWindowBounds,
      pasteEventTarget: 'pid',
    }]);

    helper.handleMessage({
      type: 'typeIntoAppResult',
      requestId: sentCommands().find(command => command.type === 'typeIntoApp')?.requestId,
      success: true,
      focusedTextInput: true,
      eventTarget: 'pid',
    });

    await expect(typePromise).resolves.toMatchObject({
      success: true,
      focusedTextInput: true,
      eventTarget: 'pid',
    });
  });

  it('passes live typing segments to the native helper and returns insert diagnostics', async () => {
    const { helper, sentCommands } = createHelperHarness();

    const insertPromise = helper.insertTextSegment('com.apple.TextEdit', 'hello');
    await flushMicrotasks();

    expect(sentCommands()).toEqual([{
      type: 'insertTextSegment',
      bundleId: 'com.apple.TextEdit',
      text: 'hello',
    }]);

    helper.handleMessage({
      type: 'insertTextSegmentResult',
      success: false,
      reason: 'not-frontmost',
      accessibilityTrusted: true,
    });

    await expect(insertPromise).resolves.toEqual({
      success: false,
      reason: 'not-frontmost',
      accessibilityTrusted: true,
    });
  });

  it('passes live typing submit commands to the native helper', async () => {
    const { helper, sentCommands } = createHelperHarness();

    const submitPromise = helper.submitTextTarget('com.mitchellh.ghostty', 'command-enter');
    await flushMicrotasks();

    expect(sentCommands()).toEqual([{
      type: 'submitTextTarget',
      bundleId: 'com.mitchellh.ghostty',
      submitMode: 'command-enter',
    }]);

    helper.handleMessage({
      type: 'submitTextTargetResult',
      success: true,
      accessibilityTrusted: true,
    });

    await expect(submitPromise).resolves.toEqual({
      success: true,
      reason: undefined,
      accessibilityTrusted: true,
    });
  });
});
