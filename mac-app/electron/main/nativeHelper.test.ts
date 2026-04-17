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
});
