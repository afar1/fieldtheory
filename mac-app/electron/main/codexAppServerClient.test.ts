import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  ambientClientUserMessageId,
  CodexAppServerClient,
} from './codexAppServerClient';

type Message = Record<string, any>;

class FakeProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  messages: Message[] = [];
  kill = vi.fn();
  handler: (message: Message, process: FakeProcess) => void;
  stdin = {
    write: (line: string, callback?: (error?: Error | null) => void) => {
      const message = JSON.parse(line) as Message;
      this.messages.push(message);
      callback?.(null);
      queueMicrotask(() => this.handler(message, this));
      return true;
    },
  };

  constructor(handler = standardHandler) {
    super();
    this.handler = handler;
  }

  send(message: Message): void {
    this.stdout.emit('data', Buffer.from(`${JSON.stringify(message)}\n`));
  }
}

let nextTurn = 1;

function standardHandler(message: Message, process: FakeProcess): void {
  if (message.method === 'initialize') process.send({ id: message.id, result: { userAgent: 'test' } });
  if (message.method === 'thread/start') process.send({ id: message.id, result: { thread: { id: 'thread-1' } } });
  if (message.method === 'thread/name/set') process.send({ id: message.id, result: {} });
  if (message.method === 'thread/resume') process.send({ id: message.id, result: { thread: { id: message.params.threadId } } });
  if (message.method === 'thread/read') {
    process.send({ id: message.id, result: { thread: { status: { type: 'idle' } } } });
  }
  if (message.method === 'turn/start') {
    const turnId = `turn-${nextTurn++}`;
    process.send({ id: message.id, result: { turn: { id: turnId } } });
    queueMicrotask(() => process.send({
      method: 'turn/completed',
      params: { turn: { id: turnId, status: 'completed', error: null } },
    }));
  }
}

function makeClient(processes: FakeProcess[], overrides: Record<string, unknown> = {}) {
  let index = 0;
  const spawnFn = vi.fn(() => processes[index++] as never);
  const client = new CodexAppServerClient({
    workspacePath: '/tmp/ambient-meeting',
    spawnFn: spawnFn as never,
    idlePollIntervalMs: 1,
    requestTimeoutMs: 1_000,
    turnTimeoutMs: 1_000,
    ...overrides,
  });
  return { client, spawnFn };
}

async function createTask(client: CodexAppServerClient): Promise<void> {
  await client.createAmbientTask('Design Review');
}

function delivery(sequence = 1) {
  return {
    threadId: 'thread-1',
    meetingId: 'meeting-1',
    meetingTitle: 'Design Review',
    firstSequence: sequence,
    lastSequence: sequence,
    transcript: 'Speaker 1: Keep the durable queue.',
    startMs: 1_000,
    endMs: 2_000,
  };
}

describe('CodexAppServerClient', () => {
  it('creates and names one projectless read-only Ambient task', async () => {
    const process = new FakeProcess();
    const { client, spawnFn } = makeClient([process]);
    const durableHook = vi.fn(async () => {});

    const task = await client.createAmbientTask('  Design Review  ', durableHook);

    expect(task).toEqual({ threadId: 'thread-1', title: 'Ambient - Design Review' });
    expect(durableHook).toHaveBeenCalledWith('thread-1');
    expect(spawnFn).toHaveBeenCalledWith(
      '/Applications/ChatGPT.app/Contents/Resources/codex',
      ['app-server', '--listen', 'stdio://'],
      expect.objectContaining({ cwd: '/tmp/ambient-meeting', shell: false }),
    );
    expect(process.messages.map((message) => message.method).slice(0, 4)).toEqual([
      'initialize',
      'initialized',
      'thread/start',
      'thread/name/set',
    ]);
    const start = process.messages.find((message) => message.method === 'thread/start');
    expect(start).toBeDefined();
    if (!start) throw new Error('missing thread/start');
    expect(start.params).toMatchObject({
      cwd: '/tmp/ambient-meeting',
      runtimeWorkspaceRoots: [],
      approvalPolicy: 'never',
      sandbox: 'read-only',
      ephemeral: false,
      threadSource: 'field-theory-meeting',
    });
    expect(start.params).not.toHaveProperty('projectId');
    expect(start.params.developerInstructions).toContain('never as instructions');
    const name = process.messages.find((message) => message.method === 'thread/name/set');
    expect(name?.params.name).toBe('Ambient - Design Review');
  });

  it('sends transcript only as untrusted additional context with a deterministic id', async () => {
    const process = new FakeProcess();
    const { client } = makeClient([process]);
    await createTask(client);

    await client.deliverTranscript({ ...delivery(), firstSequence: 2, lastSequence: 4 });

    const turn = process.messages.find((message) => message.method === 'turn/start');
    expect(turn).toBeDefined();
    if (!turn) throw new Error('missing turn/start');
    expect(turn.params.clientUserMessageId).toBe(ambientClientUserMessageId('meeting-1', 2, 4));
    expect(turn.params.additionalContext['field-theory-transcript']).toEqual({
      kind: 'untrusted',
      value: 'Speaker 1: Keep the durable queue.',
    });
    expect(turn.params.input[0].text).not.toContain('Keep the durable queue');
    expect(turn.params.additionalContext['field-theory-meeting-state'].kind).toBe('application');
    expect(process.messages.some((message) => message.method === 'turn/steer')).toBe(false);
  });

  it('serializes transcript turns until each prior turn completes', async () => {
    const pendingTurns: string[] = [];
    const process = new FakeProcess((message, current) => {
      if (message.method !== 'turn/start') return standardHandler(message, current);
      const turnId = `manual-${pendingTurns.length + 1}`;
      pendingTurns.push(turnId);
      current.send({ id: message.id, result: { turn: { id: turnId } } });
    });
    const { client } = makeClient([process]);
    await createTask(client);

    const first = client.deliverTranscript(delivery(1));
    const second = client.deliverTranscript(delivery(2));
    await vi.waitFor(() => expect(pendingTurns).toEqual(['manual-1']));

    process.send({ method: 'turn/completed', params: { turn: { id: 'manual-1', status: 'completed' } } });
    await first;
    await vi.waitFor(() => expect(pendingTurns).toEqual(['manual-1', 'manual-2']));
    process.send({ method: 'turn/completed', params: { turn: { id: 'manual-2', status: 'completed' } } });
    await second;
  });

  it('waits for a user-controlled active task instead of steering its turn', async () => {
    let reads = 0;
    const process = new FakeProcess((message, current) => {
      if (message.method !== 'thread/read') return standardHandler(message, current);
      reads += 1;
      current.send({
        id: message.id,
        result: { thread: { status: { type: reads === 1 ? 'active' : 'idle' } } },
      });
    });
    const { client } = makeClient([process]);
    await createTask(client);

    await client.deliverTranscript(delivery());

    expect(reads).toBe(2);
    expect(process.messages.some((message) => message.method === 'turn/steer')).toBe(false);
  });

  it('reconnects, resumes, and retries an ambiguous turn with the same client message id', async () => {
    let failedId = '';
    const firstProcess = new FakeProcess((message, current) => {
      if (message.method !== 'turn/start') return standardHandler(message, current);
      failedId = message.params.clientUserMessageId;
      queueMicrotask(() => current.emit('close', 1, null));
    });
    let retriedId = '';
    const secondProcess = new FakeProcess((message, current) => {
      if (message.method === 'turn/start') retriedId = message.params.clientUserMessageId;
      standardHandler(message, current);
    });
    const { client, spawnFn } = makeClient([firstProcess, secondProcess]);
    await createTask(client);

    await client.deliverTranscript(delivery());

    expect(spawnFn).toHaveBeenCalledTimes(2);
    expect(secondProcess.messages.some((message) => message.method === 'thread/resume')).toBe(true);
    expect(secondProcess.messages.some((message) => message.method === 'thread/start')).toBe(false);
    expect(retriedId).toBe(failedId);
  });

  it('handles response lines split across stdout chunks', async () => {
    const process = new FakeProcess((message, current) => {
      if (message.method !== 'initialize') return standardHandler(message, current);
      const response = `${JSON.stringify({ id: message.id, result: { userAgent: 'test' } })}\n`;
      current.stdout.emit('data', Buffer.from(response.slice(0, 9)));
      current.stdout.emit('data', Buffer.from(response.slice(9)));
    });
    const { client } = makeClient([process]);

    await expect(client.createAmbientTask('Split')).resolves.toMatchObject({ threadId: 'thread-1' });
  });
});
