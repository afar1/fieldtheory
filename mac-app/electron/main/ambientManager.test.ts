import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AmbientManager,
  type AmbientClient,
  type AmbientState,
} from './ambientManager';
import { ambientClientUserMessageId } from './codexAppServerClient';

function makeClient(overrides: Partial<AmbientClient> = {}): AmbientClient {
  return {
    createAmbientTask: vi.fn(async (title, onThreadStarted) => {
      await onThreadStarted?.('thread-1');
      return { threadId: 'thread-1', title: `Ambient - ${title}` };
    }),
    prepareAmbientTask: vi.fn(async (threadId, title) => ({ threadId, title: `Ambient - ${title}` })),
    deliverAmbientSettings: vi.fn(async () => {}),
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
    expect(client.createAmbientTask).toHaveBeenCalledWith(
      'Design Review',
      expect.any(Function),
      expect.objectContaining({ accessMode: 'codex-defaults' }),
    );
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

  it('applies changed settings to the active Codex task without restarting the meeting', async () => {
    const client = makeClient();
    const manager = new AmbientManager({ clientFactory: () => client });
    await manager.start(startArgs());

    await expect(manager.applySettings({
      instructions: 'Investigate technical uncertainty before responding.',
      accessMode: 'codex-defaults',
    })).resolves.toBe(true);

    expect(client.deliverAmbientSettings).toHaveBeenCalledWith(
      'thread-1',
      '.ambient-context/ambient-instructions.txt',
    );
    const instructionsPath = path.join(workingDirectory, '.ambient-context', 'ambient-instructions.txt');
    expect(fs.readFileSync(instructionsPath, 'utf-8'))
      .toBe('Investigate technical uncertainty before responding.');
    expect(fs.statSync(instructionsPath).mode & 0o777).toBe(0o600);
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
    }));
    const delivery = (client.deliverTranscript as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(delivery).not.toHaveProperty('transcript');
    expect(delivery.contextFilePath).toMatch(/^\.ambient-context\/field-theory-ambient-[a-f0-9]{32}\.json$/);
    const contextPath = path.join(workingDirectory, delivery.contextFilePath);
    expect(fs.statSync(contextPath).mode & 0o777).toBe(0o600);
    expect(JSON.parse(fs.readFileSync(contextPath, 'utf-8'))).toMatchObject({
      version: 1,
      kind: 'field-theory-ambient-context',
      trust: 'untrusted',
      meeting: { id: 'meeting-1', title: 'Design Review' },
      batch: { firstSequence: 1, lastSequence: 3, final: false },
      events: [
        { sequence: 1, startMs: 1_000, endMs: 1_900, text: 'Speaker 1: Delta 1' },
        { sequence: 2, startMs: 2_000, endMs: 2_900, text: 'Speaker 1: Delta 2' },
        { sequence: 3, startMs: 3_000, endMs: 3_900, text: 'Speaker 1: Delta 3' },
      ],
    });
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
    expect(recoveredClient.prepareAmbientTask).toHaveBeenCalledWith(
      'thread-1',
      'Design Review',
    );
    expect(recoveredClient.deliverAmbientSettings).toHaveBeenCalledWith(
      'thread-1',
      '.ambient-context/ambient-instructions.txt',
    );
    expect(recoveredClient.createAmbientTask).not.toHaveBeenCalled();
    expect(openTask).toHaveBeenCalledTimes(1);
    expect(openTask).toHaveBeenCalledWith('thread-1');
    expect(recoveredClient.deliverTranscript).toHaveBeenCalledWith(expect.objectContaining({
      firstSequence: 1,
      lastSequence: 2,
    }));
    expect(recovered.getState()).toMatchObject({ outbox: [], lastDeliveredSequence: 2 });
  });

  it('recovers a version-1 pending batch that has no character offsets', async () => {
    const pendingId = ambientClientUserMessageId('meeting-1', 1, 2);
    const savedState: AmbientState = {
      version: 1,
      meetingId: 'meeting-1',
      title: 'Design Review',
      workingDirectory,
      threadId: 'thread-1',
      status: 'active',
      outbox: [
        { ...delta(1), attempts: 1 },
        { ...delta(2), attempts: 1 },
      ],
      pendingDelivery: {
        firstSequence: 1,
        lastSequence: 2,
        clientUserMessageId: pendingId,
        final: false,
      },
      lastDeliveredSequence: null,
      lastError: null,
      updatedAt: '2026-09-03T00:00:00.000Z',
    };
    fs.writeFileSync(path.join(workingDirectory, 'ambient.json'), `${JSON.stringify(savedState)}\n`, { mode: 0o600 });
    const client = makeClient();
    const manager = new AmbientManager({ clientFactory: () => client });

    await manager.start(startArgs());
    await manager.flush();

    expect(client.deliverTranscript).toHaveBeenCalledWith(expect.objectContaining({
      firstSequence: 1,
      lastSequence: 2,
      clientUserMessageId: pendingId,
    }));
    const delivery = (client.deliverTranscript as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const context = JSON.parse(fs.readFileSync(path.join(workingDirectory, delivery.contextFilePath), 'utf-8'));
    expect(context.events.map((entry: { text: string }) => entry.text)).toEqual([
      'Speaker 1: Delta 1',
      'Speaker 1: Delta 2',
    ]);
    expect(manager.getState()).toMatchObject({ outbox: [], lastDeliveredSequence: 2 });
  });

  it('uses the same deterministic batch id across a failed retry', async () => {
    const ids: string[] = [];
    const contextPaths: string[] = [];
    let attempts = 0;
    const client = makeClient({
      deliverTranscript: vi.fn(async (delivery) => {
        ids.push(delivery.clientUserMessageId ?? '');
        contextPaths.push(delivery.contextFilePath);
        attempts += 1;
        if (attempts === 1) throw new Error('try again');
      }),
    });
    const manager = new AmbientManager({ clientFactory: () => client });
    await manager.start(startArgs());
    await manager.enqueueTranscript(delta(4));
    await manager.enqueueTranscript(delta(5));

    await expect(manager.flush()).rejects.toThrow('try again');
    const contextPath = path.join(workingDirectory, contextPaths[0]);
    const firstContent = fs.readFileSync(contextPath, 'utf-8');
    const firstInode = fs.statSync(contextPath).ino;
    await manager.flush();

    expect(ids).toHaveLength(2);
    expect(ids[1]).toBe(ids[0]);
    expect(contextPaths[1]).toBe(contextPaths[0]);
    expect(fs.readFileSync(contextPath, 'utf-8')).toBe(firstContent);
    expect(fs.statSync(contextPath).ino).toBe(firstInode);
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

    const delivery = (client.deliverTranscript as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const context = JSON.parse(fs.readFileSync(path.join(workingDirectory, delivery.contextFilePath), 'utf-8'));
    expect(context.batch.final).toBe(true);
    expect(manager.getState()).toMatchObject({ status: 'completed', outbox: [] });
    await expect(manager.enqueueTranscript(delta(2))).rejects.toThrow('already completed');
  });

  it('marks only the last bounded batch final', async () => {
    const contextPaths: string[] = [];
    const client = makeClient({
      deliverTranscript: vi.fn(async (delivery) => { contextPaths.push(delivery.contextFilePath); }),
    });
    const manager = new AmbientManager({ clientFactory: () => client });
    await manager.start(startArgs());
    for (let sequence = 1; sequence <= 101; sequence += 1) {
      await manager.enqueueTranscript(delta(sequence));
    }

    await manager.flush(true);

    const finalFlags = contextPaths.map((contextPath) => (
      JSON.parse(fs.readFileSync(path.join(workingDirectory, contextPath), 'utf-8')).batch.final
    ));
    expect(finalFlags).toEqual([false, true]);
    expect(manager.getState()).toMatchObject({ status: 'completed', outbox: [] });
  });

  it('waits for an active delivery before cancelling and closing the client', async () => {
    let releaseDelivery: (() => void) | undefined;
    const deliveryPending = new Promise<void>((resolve) => { releaseDelivery = resolve; });
    const client = makeClient({
      deliverTranscript: vi.fn(async () => deliveryPending),
    });
    const manager = new AmbientManager({ clientFactory: () => client });
    await manager.start(startArgs());
    await manager.enqueueTranscript(delta(1));

    const flush = manager.flush();
    await vi.waitFor(() => expect(client.deliverTranscript).toHaveBeenCalledOnce());
    const cancel = manager.cancel();
    expect(client.close).not.toHaveBeenCalled();
    releaseDelivery?.();
    await Promise.all([flush, cancel]);

    expect(client.close).toHaveBeenCalledOnce();
    expect(JSON.parse(fs.readFileSync(path.join(workingDirectory, 'ambient.json'), 'utf-8')).status)
      .toBe('cancelled');
  });

  it('limits one batch to 100 transcript events', async () => {
    const client = makeClient();
    const manager = new AmbientManager({ clientFactory: () => client });
    await manager.start(startArgs());
    for (let sequence = 1; sequence <= 101; sequence += 1) {
      await manager.enqueueTranscript(delta(sequence));
    }

    await manager.flush();

    expect(client.deliverTranscript).toHaveBeenCalledTimes(1);
    const delivery = (client.deliverTranscript as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(delivery).toMatchObject({ firstSequence: 1, lastSequence: 100 });
    const context = JSON.parse(fs.readFileSync(path.join(workingDirectory, delivery.contextFilePath), 'utf-8'));
    expect(context.events).toHaveLength(100);
    expect(manager.getState()?.outbox.map((entry) => entry.sequence)).toEqual([101]);
  });

  it('limits one batch to 24,000 transcript characters', async () => {
    const client = makeClient();
    const manager = new AmbientManager({ clientFactory: () => client });
    await manager.start(startArgs());
    await manager.enqueueTranscript(delta(1, 'a'.repeat(12_000)));
    await manager.enqueueTranscript(delta(2, 'b'.repeat(12_000)));
    await manager.enqueueTranscript(delta(3, 'c'));

    await manager.flush();

    const delivery = (client.deliverTranscript as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(delivery).toMatchObject({ firstSequence: 1, lastSequence: 2 });
    const context = JSON.parse(fs.readFileSync(path.join(workingDirectory, delivery.contextFilePath), 'utf-8'));
    expect(context.events.map((entry: { text: string }) => entry.text).join('')).toHaveLength(24_000);
    expect(manager.getState()?.outbox.map((entry) => entry.sequence)).toEqual([3]);
  });

  it('splits one oversized event without losing its durable sequence', async () => {
    const contextPaths: string[] = [];
    const client = makeClient({
      deliverTranscript: vi.fn(async (delivery) => { contextPaths.push(delivery.contextFilePath); }),
    });
    const manager = new AmbientManager({ clientFactory: () => client });
    await manager.start(startArgs());
    await manager.enqueueTranscript(delta(1, 'x'.repeat(24_001)));

    await manager.flush();

    const firstContext = JSON.parse(fs.readFileSync(path.join(workingDirectory, contextPaths[0]), 'utf-8'));
    expect(firstContext.events).toMatchObject([{
      sequence: 1,
      characterStart: 0,
      characterEnd: 24_000,
      totalCharacters: 24_001,
    }]);
    expect(firstContext.events[0].text).toHaveLength(24_000);
    expect(manager.getState()).toMatchObject({
      outbox: [{ sequence: 1, nextCharacterOffset: 24_000 }],
      lastDeliveredSequence: null,
    });

    await manager.flush();

    const secondContext = JSON.parse(fs.readFileSync(path.join(workingDirectory, contextPaths[1]), 'utf-8'));
    expect(secondContext.events).toMatchObject([{
      sequence: 1,
      characterStart: 24_000,
      characterEnd: 24_001,
      totalCharacters: 24_001,
      text: 'x',
    }]);
    expect(contextPaths[1]).not.toBe(contextPaths[0]);
    expect(manager.getState()).toMatchObject({ outbox: [], lastDeliveredSequence: 1 });
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
