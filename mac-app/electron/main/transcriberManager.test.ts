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

type QwenResponse = { ok: boolean; text?: string; error?: string };

import { TranscriberManager } from './transcriberManager';

function createQwenHarness(
  writeImpl?: (line: string, callback?: (err?: Error | null) => void) => void
): { manager: any; write: ReturnType<typeof vi.fn> } {
  const write = vi.fn((line: string, callback?: (err?: Error | null) => void) => {
    if (writeImpl) {
      writeImpl(line, callback);
    } else {
      callback?.(null);
    }
    return true;
  });

  const manager: any = {
    qwenProcess: { stdin: { write } },
    qwenReady: true,
    qwenPendingResolve: null,
    qwenCommandChain: Promise.resolve(),
  };

  Object.setPrototypeOf(manager, TranscriberManager.prototype);
  return { manager, write };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('TranscriberManager Qwen command queue', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('serializes concurrent Qwen commands so only one is in-flight', async () => {
    const { manager, write } = createQwenHarness();

    const firstPromise = manager.sendQwenCommand({ cmd: 'first' });
    const secondPromise = manager.sendQwenCommand({ cmd: 'second' });

    await flushMicrotasks();
    expect(write).toHaveBeenCalledTimes(1);

    const resolveFirst = manager.qwenPendingResolve as ((response: QwenResponse) => void);
    expect(typeof resolveFirst).toBe('function');
    manager.qwenPendingResolve = null;
    resolveFirst({ ok: true, text: 'first-result' });

    await expect(firstPromise).resolves.toEqual({ ok: true, text: 'first-result' });
    await flushMicrotasks();
    expect(write).toHaveBeenCalledTimes(2);

    const resolveSecond = manager.qwenPendingResolve as ((response: QwenResponse) => void);
    expect(typeof resolveSecond).toBe('function');
    manager.qwenPendingResolve = null;
    resolveSecond({ ok: true, text: 'second-result' });

    await expect(secondPromise).resolves.toEqual({ ok: true, text: 'second-result' });
  });

  it('continues processing queued commands after a write failure', async () => {
    let writeCount = 0;
    const { manager, write } = createQwenHarness((_line, callback) => {
      writeCount += 1;
      if (writeCount === 1) {
        callback?.(new Error('write failed'));
      } else {
        callback?.(null);
      }
    });

    const firstPromise = manager.sendQwenCommand({ cmd: 'first' });
    const secondPromise = manager.sendQwenCommand({ cmd: 'second' });

    await expect(firstPromise).rejects.toThrow('Failed to write to Qwen server: write failed');

    await flushMicrotasks();
    expect(write).toHaveBeenCalledTimes(2);

    const resolveSecond = manager.qwenPendingResolve as ((response: QwenResponse) => void);
    expect(typeof resolveSecond).toBe('function');
    manager.qwenPendingResolve = null;
    resolveSecond({ ok: true, text: 'second-result' });

    await expect(secondPromise).resolves.toEqual({ ok: true, text: 'second-result' });
  });
});
