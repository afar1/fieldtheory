import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AmbientManager,
  type AmbientClient,
  type AmbientState,
} from './ambientManager';

function makeClient(overrides: Partial<AmbientClient> = {}): AmbientClient {
  return {
    createAmbientTask: vi.fn(async (title, onThreadStarted) => {
      await onThreadStarted?.('thread-1');
      return { threadId: 'thread-1', title: `Ambient - ${title}` };
    }),
    prepareAmbientTask: vi.fn(async (threadId, title) => ({ threadId, title: `Ambient - ${title}` })),
    deliverTranscript: vi.fn(async () => {}),
    close: vi.fn(),
    ...overrides,
  };
}

function delta(sequence: number, text = `Speaker 1: Delta ${sequence}`) {
  return { sequence, startMs: sequence * 1_000, endMs: sequence * 1_000 + 900, text };
}

describe('AmbientManager', () => {
  let workingDirectory: string;

  beforeEach(() => {
    workingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ambient-manager-'));
  });

  afterEach(() => {
    fs.rmSync(workingDirectory, { recursive: true, force: true });
  });

  function startArgs() {
    return { meetingId: 'meeting-1', title: 'Design Review', workingDirectory };
  }

  it('creates one task under concurrent starts and durably saves its id', async () => {
    const client = makeClient();
    const openTask = vi.fn(async (threadId: string) => {
      expect(JSON.parse(fs.readFileSync(path.join(workingDirectory, 'ambient.json'), 'utf-8')).threadId)
        .toBe(threadId);
    });
    const manager = new AmbientManager({ clientFactory: () => client, openTask });

    const [first, second] = await Promise.all([manager.start(startArgs()), manager.start(startArgs())]);

    expect(client.createAmbientTask).toHaveBeenCalledTimes(1);
    expect(client.createAmbientTask).toHaveBeenCalledWith('Design Review', expect.any(Function));
    expect(first.threadId).toBe('thread-1');
    expect(second.threadId).toBe('thread-1');
    expect(openTask).toHaveBeenCalledTimes(1);
    expect(openTask).toHaveBeenCalledWith('thread-1');
    expect(JSON.parse(fs.readFileSync(path.join(workingDirectory, 'ambient.json'), 'utf-8')).threadId)
      .toBe('thread-1');
    expect(fs.statSync(path.join(workingDirectory, 'ambient.json')).mode & 0o777).toBe(0o600);
  });

  it('keeps individual deltas durable and does not auto-flush by default', async () => {
    const client = makeClient();
    const manager = new AmbientManager({ clientFactory: () => client });
    await manager.start(startArgs());

    await manager.enqueueTranscript(delta(1));

    expect(client.deliverTranscript).not.toHaveBeenCalled();
    const state = JSON.parse(fs.readFileSync(path.join(workingDirectory, 'ambient.json'), 'utf-8')) as AmbientState;
    expect(state.outbox).toMatchObject([{ sequence: 1, text: 'Speaker 1: Delta 1', attempts: 0 }]);
  });

  it('coalesces all pending entries into one delivery and acknowledges the range after success', async () => {
    const client = makeClient();
    const manager = new AmbientManager({ clientFactory: () => client });
    await manager.start(startArgs());
    await manager.enqueueTranscript(delta(1));
    await manager.enqueueTranscript(delta(2));
    await manager.enqueueTranscript(delta(3));

    await manager.flush();

    expect(client.deliverTranscript).toHaveBeenCalledTimes(1);
    expect(client.deliverTranscript).toHaveBeenCalledWith(expect.objectContaining({
      threadId: 'thread-1',
      firstSequence: 1,
      lastSequence: 3,
      startMs: 1_000,
      endMs: 3_900,
      final: false,
      transcript: expect.stringContaining('[delta 1; 1000-1900 ms]\nSpeaker 1: Delta 1'),
    }));
    expect((client.deliverTranscript as ReturnType<typeof vi.fn>).mock.calls[0][0].transcript)
      .toContain('[delta 3; 3000-3900 ms]\nSpeaker 1: Delta 3');
    expect(manager.getState()).toMatchObject({ outbox: [], lastDeliveredSequence: 3 });
  });

  it('retains the whole batch on failure and resumes it without creating another task', async () => {
    const firstClient = makeClient({
      deliverTranscript: vi.fn(async () => { throw new Error('app-server unavailable'); }),
    });
    const firstManager = new AmbientManager({ clientFactory: () => firstClient });
    await firstManager.start(startArgs());
    await firstManager.enqueueTranscript(delta(1));
    await firstManager.enqueueTranscript(delta(2));

    await expect(firstManager.flush()).rejects.toThrow('app-server unavailable');
    expect(firstManager.getState()).toMatchObject({
      outbox: [{ sequence: 1, attempts: 1 }, { sequence: 2, attempts: 1 }],
      lastError: { message: 'app-server unavailable' },
    });
    firstManager.stop();

    const recoveredClient = makeClient();
    const openTask = vi.fn(async () => {});
    const recovered = new AmbientManager({ clientFactory: () => recoveredClient, openTask });
    const state = await recovered.start(startArgs());
    await recovered.flush();

    expect(state.threadId).toBe('thread-1');
    expect(recoveredClient.prepareAmbientTask).toHaveBeenCalledWith('thread-1', 'Design Review');
    expect(recoveredClient.createAmbientTask).not.toHaveBeenCalled();
    expect(openTask).toHaveBeenCalledTimes(1);
    expect(openTask).toHaveBeenCalledWith('thread-1');
    expect(recoveredClient.deliverTranscript).toHaveBeenCalledWith(expect.objectContaining({
      firstSequence: 1,
      lastSequence: 2,
    }));
    expect(recovered.getState()).toMatchObject({ outbox: [], lastDeliveredSequence: 2 });
  });

  it('uses the same deterministic batch id across a failed retry', async () => {
    const ids: string[] = [];
    let attempts = 0;
    const client = makeClient({
      deliverTranscript: vi.fn(async (delivery) => {
        ids.push(delivery.clientUserMessageId ?? '');
        attempts += 1;
        if (attempts === 1) throw new Error('try again');
      }),
    });
    const manager = new AmbientManager({ clientFactory: () => client });
    await manager.start(startArgs());
    await manager.enqueueTranscript(delta(4));
    await manager.enqueueTranscript(delta(5));

    await expect(manager.flush()).rejects.toThrow('try again');
    await manager.flush();

    expect(ids).toHaveLength(2);
    expect(ids[1]).toBe(ids[0]);
  });

  it('persists an opening failure and does not mark the task active', async () => {
    const client = makeClient();
    const manager = new AmbientManager({
      clientFactory: () => client,
      openTask: vi.fn(async () => { throw new Error('Codex task could not be opened'); }),
    });

    await expect(manager.start(startArgs())).rejects.toThrow('Codex task could not be opened');
    expect(manager.getState()).toMatchObject({
      status: 'starting',
      threadId: 'thread-1',
      lastError: { message: 'Codex task could not be opened' },
    });
    expect(JSON.parse(fs.readFileSync(path.join(workingDirectory, 'ambient.json'), 'utf-8')).threadId)
      .toBe('thread-1');
  });

  it('keeps a failed batch boundary stable when a new delta arrives before retry', async () => {
    const deliveries: Array<{ first: number; last: number; id: string }> = [];
    let fail = true;
    const client = makeClient({
      deliverTranscript: vi.fn(async (delivery) => {
        deliveries.push({
          first: delivery.firstSequence,
          last: delivery.lastSequence,
          id: delivery.clientUserMessageId ?? '',
        });
        if (fail) {
          fail = false;
          throw new Error('ambiguous failure');
        }
      }),
    });
    const manager = new AmbientManager({ clientFactory: () => client });
    await manager.start(startArgs());
    await manager.enqueueTranscript(delta(1));
    await manager.enqueueTranscript(delta(2));
    await expect(manager.flush()).rejects.toThrow('ambiguous failure');
    await manager.enqueueTranscript(delta(3));

    await manager.flush();

    expect(deliveries.slice(0, 2)).toEqual([
      { first: 1, last: 2, id: deliveries[0].id },
      { first: 1, last: 2, id: deliveries[0].id },
    ]);
    expect(manager.getState()?.outbox.map((entry) => entry.sequence)).toEqual([3]);
    await manager.flush();
    expect(deliveries[2]).toMatchObject({ first: 3, last: 3 });
  });

  it('marks the last batch final and completes only after it is acknowledged', async () => {
    const client = makeClient();
    const manager = new AmbientManager({ clientFactory: () => client });
    await manager.start(startArgs());
    await manager.enqueueTranscript(delta(1));

    await manager.flush(true);

    expect(client.deliverTranscript).toHaveBeenCalledWith(expect.objectContaining({ final: true }));
    expect(manager.getState()).toMatchObject({ status: 'completed', outbox: [] });
    await expect(manager.enqueueTranscript(delta(2))).rejects.toThrow('already completed');
  });

  it('rejects another active meeting and treats duplicate sequence content idempotently', async () => {
    const client = makeClient();
    const manager = new AmbientManager({ clientFactory: () => client });
    await manager.start(startArgs());
    await manager.enqueueTranscript(delta(1));
    await manager.enqueueTranscript(delta(1));

    expect(manager.getState()?.outbox).toHaveLength(1);
    expect(() => manager.start({ ...startArgs(), meetingId: 'meeting-2' })).toThrow(/already running/);
    await expect(manager.enqueueTranscript(delta(1, 'different'))).rejects.toThrow(/different content/);
  });
});
