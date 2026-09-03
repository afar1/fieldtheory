import { EventEmitter } from 'events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: vi.fn(() => '/app'),
  },
}));

import { DiarizationManager } from './diarizationManager';

function createFakeProcess() {
  const stdin = {
    writable: true,
    write: vi.fn((_line: string, callback?: (error?: Error | null) => void) => {
      callback?.(null);
      return true;
    }),
  };
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const child = new EventEmitter() as any;
  child.stdin = stdin;
  child.stdout = stdout;
  child.stderr = stderr;
  child.kill = vi.fn();
  return child;
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('DiarizationManager', () => {
  let child: ReturnType<typeof createFakeProcess>;
  let spawnFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    child = createFakeProcess();
    spawnFn = vi.fn(() => child);
  });

  function createManager(overrides: Record<string, unknown> = {}): DiarizationManager {
    return new DiarizationManager({
      appPath: '/app',
      cwd: '/app',
      resourcesPath: '/resources',
      binaryPath: '/bin/FieldTheoryDiarizer',
      existsSync: () => true,
      spawnFn: spawnFn as any,
      ...overrides,
    });
  }

  it('locates the packaged resource binary', () => {
    const manager = createManager({ binaryPath: undefined, isPackaged: true });

    expect(manager.getBinaryPathCandidates()).toEqual(['/resources/FieldTheoryDiarizer']);
  });

  it('locates release and debug development binaries', () => {
    const manager = createManager({ binaryPath: undefined, isPackaged: false });

    expect(manager.getBinaryPathCandidates()).toEqual([
      '/app/electron/diarization/.build/release/FieldTheoryDiarizer',
      '/app/electron/diarization/.build/debug/FieldTheoryDiarizer',
    ]);
  });

  it('returns model-produced speaker intervals', async () => {
    const manager = createManager();
    const resultPromise = manager.diarize('/tmp/meeting.wav');
    await flushMicrotasks();

    child.stdout.emit('data', Buffer.from('{"ok":true,"protocolVersion":1,"ready":true}\n'));
    await flushMicrotasks();

    expect(JSON.parse(child.stdin.write.mock.calls[0][0])).toEqual({
      type: 'diarize',
      audioPath: '/tmp/meeting.wav',
    });

    child.stdout.emit('data', Buffer.from(JSON.stringify({
      ok: true,
      protocolVersion: 1,
      speakerCount: 2,
      segments: [
        { speakerId: 'S1', startTimeSeconds: 0.4, endTimeSeconds: 2.2, qualityScore: 0.91 },
        { speakerId: 'S2', startTimeSeconds: 1.9, endTimeSeconds: 3.1, qualityScore: 0.87 },
      ],
    }) + '\n'));

    await expect(resultPromise).resolves.toEqual({
      speakerCount: 2,
      segments: [
        { speakerId: 'S1', startMs: 400, endMs: 2200, confidence: 0.91 },
        { speakerId: 'S2', startMs: 1900, endMs: 3100, confidence: 0.87 },
      ],
    });
  });

  it('serializes concurrent requests through one process', async () => {
    const manager = createManager();
    const first = manager.diarize('/tmp/one.wav');
    const second = manager.diarize('/tmp/two.wav');
    await flushMicrotasks();

    child.stdout.emit('data', Buffer.from('{"ok":true,"protocolVersion":1,"ready":true}\n'));
    await flushMicrotasks();
    expect(child.stdin.write).toHaveBeenCalledTimes(1);

    child.stdout.emit('data', Buffer.from('{"ok":true,"speakerCount":0,"segments":[]}\n'));
    await expect(first).resolves.toEqual({ speakerCount: 0, segments: [] });
    await flushMicrotasks();

    expect(child.stdin.write).toHaveBeenCalledTimes(2);
    expect(JSON.parse(child.stdin.write.mock.calls[1][0]).audioPath).toBe('/tmp/two.wav');

    child.stdout.emit('data', Buffer.from('{"ok":true,"speakerCount":0,"segments":[]}\n'));
    await expect(second).resolves.toEqual({ speakerCount: 0, segments: [] });
    expect(spawnFn).toHaveBeenCalledTimes(1);
  });

  it('rejects the sidecar error without inventing a result', async () => {
    const manager = createManager();
    const resultPromise = manager.diarize('/tmp/silent.wav');
    await flushMicrotasks();
    child.stdout.emit('data', Buffer.from('{"ok":true,"protocolVersion":1,"ready":true}\n'));
    await flushMicrotasks();
    child.stdout.emit('data', Buffer.from('{"ok":false,"error":"No speech detected in audio"}\n'));

    await expect(resultPromise).rejects.toThrow('Diarization failed: No speech detected in audio');
  });

  it('rejects malformed successful output', async () => {
    const manager = createManager();
    const resultPromise = manager.diarize('/tmp/meeting.wav');
    await flushMicrotasks();
    child.stdout.emit('data', Buffer.from('{"ok":true,"protocolVersion":1,"ready":true}\n'));
    await flushMicrotasks();
    child.stdout.emit('data', Buffer.from(JSON.stringify({
      ok: true,
      speakerCount: 1,
      segments: [
        { speakerId: '', startTimeSeconds: 0, endTimeSeconds: 1, qualityScore: 1 },
      ],
    }) + '\n'));

    await expect(resultPromise).rejects.toThrow('invalid segment 0');
  });

  it('fails immediately when the binary is unavailable', async () => {
    const manager = createManager({ binaryPath: undefined, existsSync: () => false });

    await expect(manager.diarize('/tmp/meeting.wav')).rejects.toThrow(
      'Diarization is unavailable because FieldTheoryDiarizer was not found'
    );
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it('rejects an in-flight request when the sidecar exits', async () => {
    const manager = createManager();
    const resultPromise = manager.diarize('/tmp/meeting.wav');
    await flushMicrotasks();
    child.stdout.emit('data', Buffer.from('{"ok":true,"protocolVersion":1,"ready":true}\n'));
    await flushMicrotasks();

    child.stderr.emit('data', Buffer.from('model load failed'));
    child.emit('close', 1);

    await expect(resultPromise).rejects.toThrow('exited with code 1: model load failed');
  });

  it('stops the process and rejects active work', async () => {
    const manager = createManager();
    const resultPromise = manager.diarize('/tmp/meeting.wav');
    await flushMicrotasks();
    child.stdout.emit('data', Buffer.from('{"ok":true,"protocolVersion":1,"ready":true}\n'));
    await flushMicrotasks();

    manager.stop();

    await expect(resultPromise).rejects.toThrow('Diarization sidecar stopped');
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });
});
