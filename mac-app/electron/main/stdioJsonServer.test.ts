import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

vi.mock('./logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const mockSpawn = vi.fn();

import { StdioJsonServer, type ServerResponse } from './stdioJsonServer';

// Fake ChildProcess that lets tests simulate stdout/stderr/close events.
function createFakeProcess() {
  const stdin = {
    write: vi.fn((_line: string, callback?: (err?: Error | null) => void) => {
      callback?.(null);
      return true;
    }),
  };
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const proc = new EventEmitter() as any;
  proc.stdin = stdin;
  proc.stdout = stdout;
  proc.stderr = stderr;
  proc.kill = vi.fn();
  return proc;
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('StdioJsonServer', () => {
  let proc: ReturnType<typeof createFakeProcess>;

  beforeEach(() => {
    proc = createFakeProcess();
    mockSpawn.mockReturnValue(proc);
  });

  function createServer(overrides: Record<string, unknown> = {}) {
    return new StdioJsonServer({
      name: 'Test',
      command: '/bin/test',
      args: ['--server'],
      spawnFn: mockSpawn as any,
      ...overrides,
    } as any);
  }

  afterEach(() => {
    vi.clearAllMocks();
  });

  // -- start / ready --

  it('resolves start() when server emits ready JSON', async () => {
    const server = createServer();
    const startPromise = server.start();

    // Simulate the server printing ready signal.
    proc.stdout.emit('data', Buffer.from('{"ok":true,"ready":true}\n'));

    await startPromise;
    expect(server.isReady).toBe(true);
  });

  it('rejects start() when process exits during startup', async () => {
    const server = createServer();
    const startPromise = server.start();

    proc.emit('close', 1);

    await expect(startPromise).rejects.toThrow('Test server exited during startup with code 1');
    expect(server.isReady).toBe(false);
  });

  it('rejects start() when process emits error event', async () => {
    const server = createServer();
    const startPromise = server.start();

    proc.emit('error', new Error('ENOENT'));

    await expect(startPromise).rejects.toThrow('Failed to start Test server: ENOENT');
    expect(server.isReady).toBe(false);
  });

  it('rejects start() when ready signal never arrives', async () => {
    vi.useFakeTimers();
    try {
      const server = createServer({ startupTimeoutMs: 500 });
      const startPromise = server.start();
      void startPromise.catch(() => {});
      await flushMicrotasks();

      await vi.advanceTimersByTimeAsync(500);

      await expect(startPromise).rejects.toThrow('Test server startup timed out (0.5s)');
      expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
      expect(server.isReady).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('runs preStart validation before spawning', async () => {
    const preStart = vi.fn(async () => {});
    const server = createServer({ preStart });
    const startPromise = server.start();
    await flushMicrotasks();

    expect(preStart).toHaveBeenCalledTimes(1);

    proc.stdout.emit('data', Buffer.from('{"ready":true}\n'));
    await startPromise;
  });

  it('rejects start() if preStart throws', async () => {
    const preStart = vi.fn(async () => { throw new Error('bad python'); });
    const server = createServer({ preStart });

    await expect(server.start()).rejects.toThrow('bad python');
    expect(server.isReady).toBe(false);
  });

  it('returns immediately if already running', async () => {
    const server = createServer();

    const p1 = server.start();
    proc.stdout.emit('data', Buffer.from('{"ready":true}\n'));
    await p1;

    await server.start();
    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent start() calls', async () => {
    const server = createServer();

    const p1 = server.start();
    const p2 = server.start();

    proc.stdout.emit('data', Buffer.from('{"ready":true}\n'));

    await Promise.all([p1, p2]);
    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });

  // -- stop --

  it('stop() kills the process and resets state', async () => {
    const server = createServer();

    const startPromise = server.start();
    proc.stdout.emit('data', Buffer.from('{"ready":true}\n'));
    await startPromise;

    server.stop();
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    expect(server.isReady).toBe(false);
  });

  it('stop() is safe to call when not running', () => {
    const server = createServer();
    expect(() => server.stop()).not.toThrow();
  });

  // -- send --

  it('sends JSON command and resolves with response', async () => {
    const server = createServer();

    const startPromise = server.start();
    proc.stdout.emit('data', Buffer.from('{"ready":true}\n'));
    await startPromise;

    const sendPromise = server.send({ cmd: 'transcribe', audio: '/tmp/test.wav' });
    await flushMicrotasks();

    expect(proc.stdin.write).toHaveBeenCalledTimes(1);
    const writtenLine = proc.stdin.write.mock.calls[0][0];
    expect(JSON.parse(writtenLine.trim())).toEqual({ cmd: 'transcribe', audio: '/tmp/test.wav' });

    // Simulate server response.
    proc.stdout.emit('data', Buffer.from('{"ok":true,"text":"hello world"}\n'));

    await expect(sendPromise).resolves.toEqual({ ok: true, text: 'hello world' });
  });

  it('emits progress events without resolving the pending response', async () => {
    const events: Record<string, unknown>[] = [];
    const server = createServer();

    const startPromise = server.start();
    proc.stdout.emit('data', Buffer.from('{"ready":true}\n'));
    await startPromise;

    const sendPromise = server.send({ cmd: 'generate' }, {
      onEvent: (event) => events.push(event),
    });
    const responseSpy = vi.fn();
    void sendPromise.then(responseSpy);
    await flushMicrotasks();

    proc.stdout.emit('data', Buffer.from('{"event":"progress","kind":"status","message":"warming"}\n'));
    await flushMicrotasks();

    expect(events).toEqual([{ event: 'progress', kind: 'status', message: 'warming' }]);
    expect(responseSpy).not.toHaveBeenCalled();

    proc.stdout.emit('data', Buffer.from('{"ok":true,"text":"done"}\n'));

    await expect(sendPromise).resolves.toEqual({ ok: true, text: 'done' });
  });

  it('rejects send() when server is not running', async () => {
    const server = createServer();

    await expect(server.send({ cmd: 'ping' })).rejects.toThrow('Test server not running');
  });

  it('serializes concurrent send() calls', async () => {
    const server = createServer();

    const startPromise = server.start();
    proc.stdout.emit('data', Buffer.from('{"ready":true}\n'));
    await startPromise;

    const p1 = server.send({ cmd: 'first' });
    const p2 = server.send({ cmd: 'second' });

    await flushMicrotasks();
    // Only first command should have been written.
    expect(proc.stdin.write).toHaveBeenCalledTimes(1);

    // Respond to first.
    proc.stdout.emit('data', Buffer.from('{"ok":true,"text":"first-result"}\n'));
    await expect(p1).resolves.toEqual({ ok: true, text: 'first-result' });

    await flushMicrotasks();
    // Now second should be written.
    expect(proc.stdin.write).toHaveBeenCalledTimes(2);

    proc.stdout.emit('data', Buffer.from('{"ok":true,"text":"second-result"}\n'));
    await expect(p2).resolves.toEqual({ ok: true, text: 'second-result' });
  });

  it('rejects send() on write error and continues queue', async () => {
    let writeCount = 0;
    proc.stdin.write = vi.fn((_line: string, callback?: (err?: Error | null) => void) => {
      writeCount++;
      if (writeCount === 1) {
        callback?.(new Error('pipe broken'));
      } else {
        callback?.(null);
      }
      return true;
    });

    const server = createServer();
    const startPromise = server.start();
    proc.stdout.emit('data', Buffer.from('{"ready":true}\n'));
    await startPromise;

    const p1 = server.send({ cmd: 'first' });
    const p2 = server.send({ cmd: 'second' });

    await expect(p1).rejects.toThrow('Failed to write to Test server: pipe broken');

    await flushMicrotasks();
    proc.stdout.emit('data', Buffer.from('{"ok":true,"text":"second-ok"}\n'));
    await expect(p2).resolves.toEqual({ ok: true, text: 'second-ok' });
  });

  // -- disable --

  it('disabled server rejects start()', async () => {
    const server = createServer();
    server.disable('fatal crash');

    await expect(server.start()).rejects.toThrow('fatal crash');
    expect(server.disabledReason).toBe('fatal crash');
  });

  // -- lifecycle generation (cancel on stop during start) --

  it('cancels in-progress start when stop() is called', async () => {
    const server = createServer();
    const startPromise = server.start();

    server.stop();

    // The ready signal arrives after stop — should be ignored.
    proc.stdout.emit('data', Buffer.from('{"ready":true}\n'));

    await expect(startPromise).rejects.toThrow('Test startup cancelled');
    expect(server.isReady).toBe(false);
  });

  // -- handles buffered/partial JSON lines --

  it('handles ready signal split across multiple data events', async () => {
    const server = createServer();
    const startPromise = server.start();

    // Partial line first, then the rest.
    proc.stdout.emit('data', Buffer.from('{"ready"'));
    proc.stdout.emit('data', Buffer.from(':true}\n'));

    await startPromise;
    expect(server.isReady).toBe(true);
  });

  // -- configure --

  it('configure() updates command and args for next start', async () => {
    const server = createServer({ command: '/bin/old', args: ['--old'] });
    server.configure('/bin/new', ['--new']);

    server.start();
    expect(mockSpawn).toHaveBeenCalledWith('/bin/new', ['--new'], expect.anything());
    server.stop();
  });
});
