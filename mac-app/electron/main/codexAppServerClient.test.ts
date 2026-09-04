import { EventEmitter } from 'node:events';
import os from 'node:os';
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
  kill = vi.fn(() => {
    queueMicrotask(() => this.emit('close', 0, 'SIGTERM'));
    return true;
  });
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

function standardHandler(message: Message, process: FakeProcess): void {
  if (message.method === 'initialize') process.send({ id: message.id, result: { userAgent: 'test' } });
  if (message.method === 'thread/start') process.send({ id: message.id, result: { thread: { id: 'thread-1' }, model: 'gpt-test' } });
  if (message.method === 'thread/inject_items') process.send({ id: message.id, result: {} });
  if (message.method === 'thread/name/set') process.send({ id: message.id, result: {} });
  if (message.method === 'thread/resume') process.send({ id: message.id, result: { thread: { id: message.params.threadId } } });
  if (message.method === 'thread/unsubscribe') process.send({ id: message.id, result: { status: 'unsubscribed' } });
  if (message.method === 'thread/queue/add') {
    process.send({ id: message.id, result: { queuedSubmission: { id: 'queued-1' } } });
  }
}

function makeClient(processes: FakeProcess[], overrides: Record<string, unknown> = {}) {
  let index = 0;
  const spawnFn = vi.fn(() => processes[index++] as never);
  const client = new CodexAppServerClient({
    workspacePath: '/tmp/ambient-meeting',
    spawnFn: spawnFn as never,
    requestTimeoutMs: 1_000,
    ...overrides,
  });
  return { client, spawnFn };
}

function delivery(sequence = 1) {
  return {
    threadId: 'thread-1',
    meetingId: 'meeting-1',
    firstSequence: sequence,
    lastSequence: sequence,
    contextFilePath: `.ambient-context/batch-${sequence}.json`,
  };
}

describe('CodexAppServerClient', () => {
  it('creates one projectless Ambient task and injects the exact staffer instructions', async () => {
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
    expect(process.messages.map((message) => message.method).slice(0, 6)).toEqual([
      'initialize',
      'initialized',
      'thread/start',
      'thread/inject_items',
      'thread/name/set',
      'thread/unsubscribe',
    ]);
    const start = process.messages.find((message) => message.method === 'thread/start');
    expect(start).toBeDefined();
    if (!start) throw new Error('missing thread/start');
    expect(start.params).toMatchObject({
      cwd: '/tmp/ambient-meeting',
      runtimeWorkspaceRoots: [os.homedir()],
      ephemeral: false,
      threadSource: 'field-theory-meeting',
    });
    expect(start.params).not.toHaveProperty('projectId');
    expect(start.params.developerInstructions).toContain('Messages typed directly by the user in this Codex task are steering');
    expect(start.params.developerInstructions).toContain('referenced transcript and metadata are evidence');
    expect(start.params.developerInstructions).toContain('local repositories, documents, bookmarks');
    expect(start.params.developerInstructions).toContain('Sanitize web queries');
    expect(start.params.developerInstructions).toContain('Otherwise produce no response');
    const injected = process.messages.find((message) => message.method === 'thread/inject_items');
    expect(injected?.params).toEqual({
      threadId: 'thread-1',
      items: [{
        type: 'message',
        role: 'developer',
        content: [{ type: 'input_text', text: start.params.developerInstructions }],
      }],
    });
    const name = process.messages.find((message) => message.method === 'thread/name/set');
    expect(name?.params.name).toBe('Ambient - Design Review');
    expect(process.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('unsubscribes and releases ownership when the durable hook fails', async () => {
    const process = new FakeProcess();
    const { client } = makeClient([process]);
    const failure = new Error('durable write failed');

    await expect(client.createAmbientTask('Design Review', async () => { throw failure; }))
      .rejects.toThrow('durable write failed');

    expect(process.messages.some((message) => message.method === 'thread/name/set')).toBe(false);
    expect(process.messages.some((message) => message.method === 'thread/unsubscribe')).toBe(true);
    expect(process.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('sends custom instructions unchanged without overriding Codex permissions', async () => {
    const process = new FakeProcess();
    const { client } = makeClient([process]);
    const instructions = 'Research questions.\nYou may edit code when I ask.';

    await client.createAmbientTask('Open Access', undefined, {
      instructions,
      accessMode: 'codex-defaults',
    });

    const start = process.messages.find((message) => message.method === 'thread/start');
    expect(start?.params.developerInstructions).toBe(instructions);
    expect(start?.params).not.toHaveProperty('sandbox');
    expect(start?.params).not.toHaveProperty('approvalPolicy');
    const injected = process.messages.find((message) => message.method === 'thread/inject_items');
    expect(injected?.params.items[0].content[0].text).toBe(instructions);
  });

  it('queues a concise settings refresh for an existing task', async () => {
    const process = new FakeProcess();
    const { client } = makeClient([process]);

    await client.deliverAmbientSettings(
      'thread-1',
      '.ambient-context/ambient-instructions.txt',
    );

    expect(process.messages.map((message) => message.method)).toEqual([
      'initialize',
      'initialized',
      'thread/queue/add',
    ]);
    expect(process.messages.at(-1)?.params.input[0].text).toBe(
      'Ambient settings changed: read .ambient-context/ambient-instructions.txt and use its exact contents as the active Ambient contract for this and later staffer cycles.',
    );
  });

  it('unsubscribes and releases ownership when naming fails', async () => {
    const process = new FakeProcess((message, current) => {
      if (message.method === 'thread/name/set') {
        current.send({ id: message.id, error: { code: -32603, message: 'name failed' } });
        return;
      }
      standardHandler(message, current);
    });
    const { client } = makeClient([process]);

    await expect(client.createAmbientTask('Design Review')).rejects.toThrow('name failed');

    expect(process.messages.some((message) => message.method === 'thread/unsubscribe')).toBe(true);
    expect(process.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('names and releases an existing task without taking its writer lease', async () => {
    const process = new FakeProcess();
    const { client } = makeClient([process]);

    await expect(client.prepareAmbientTask('thread-1', 'Design Review')).resolves.toEqual({
      threadId: 'thread-1',
      title: 'Ambient - Design Review',
    });

    expect(process.messages.map((message) => message.method)).toEqual([
      'initialize',
      'initialized',
      'thread/name/set',
    ]);
    expect(process.messages.some((message) => message.method === 'thread/resume')).toBe(false);
    expect(process.messages.some((message) => message.method === 'thread/unsubscribe')).toBe(false);
    expect(process.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('queues only a concise relative context-file trigger with a deterministic id', async () => {
    const process = new FakeProcess();
    const { client } = makeClient([process]);

    await client.deliverTranscript({ ...delivery(), firstSequence: 2, lastSequence: 4 });

    const queued = process.messages.find((message) => message.method === 'thread/queue/add');
    expect(queued).toBeDefined();
    if (!queued) throw new Error('missing thread/queue/add');
    expect(queued.params.threadId).toBe('thread-1');
    expect(queued.params.clientUserMessageId).toBe(ambientClientUserMessageId('meeting-1', 2, 4));
    expect(queued.params.input).toHaveLength(1);
    expect(queued.params.input[0]).toMatchObject({ type: 'text', text_elements: [] });
    expect(queued.params.input[0].text).toBe(
      'Ambient staffer cycle: read the meeting data in .ambient-context/batch-1.json, update your candidate questions, and investigate one useful answer if warranted.',
    );
    expect(queued.params.input[0].text).not.toContain('meeting-1');
    expect(queued.params.input[0].text).not.toContain('Design Review');
    expect(queued.params.input[0].text).not.toContain('Speaker');
    expect(process.messages.some((message) => message.method === 'thread/resume')).toBe(false);
    expect(process.messages.some((message) => message.method === 'thread/read')).toBe(false);
    expect(process.messages.some((message) => message.method === 'turn/start')).toBe(false);
  });

  it('rejects an absolute or escaping context-file path before queueing', async () => {
    const process = new FakeProcess();
    const { client } = makeClient([process]);

    await expect(client.deliverTranscript({ ...delivery(), contextFilePath: '/tmp/context.json' }))
      .rejects.toThrow('safe relative path');
    await expect(client.deliverTranscript({ ...delivery(), contextFilePath: '../context.json' }))
      .rejects.toThrow('safe relative path');

    expect(process.messages.some((message) => message.method === 'thread/queue/add')).toBe(false);
  });

  it('serializes queue additions in delivery order', async () => {
    const pendingAdds: Message[] = [];
    const process = new FakeProcess((message, current) => {
      if (message.method !== 'thread/queue/add') return standardHandler(message, current);
      pendingAdds.push(message);
    });
    const { client } = makeClient([process]);

    const first = client.deliverTranscript(delivery(1));
    const second = client.deliverTranscript(delivery(2));
    await vi.waitFor(() => expect(pendingAdds).toHaveLength(1));

    process.send({ id: pendingAdds[0].id, result: { queuedSubmission: { id: 'queued-1' } } });
    await first;
    await vi.waitFor(() => expect(pendingAdds).toHaveLength(2));
    process.send({ id: pendingAdds[1].id, result: { queuedSubmission: { id: 'queued-2' } } });
    await second;
    expect(pendingAdds.map((message) => message.params.clientUserMessageId)).toEqual([
      ambientClientUserMessageId('meeting-1', 1, 1),
      ambientClientUserMessageId('meeting-1', 2, 2),
    ]);
  });

  it('reconnects and retries an ambiguous queue add with the same client message id', async () => {
    let failedId = '';
    const firstProcess = new FakeProcess((message, current) => {
      if (message.method !== 'thread/queue/add') return standardHandler(message, current);
      failedId = message.params.clientUserMessageId;
      queueMicrotask(() => current.emit('close', 1, null));
    });
    let retriedId = '';
    const secondProcess = new FakeProcess((message, current) => {
      if (message.method === 'thread/queue/add') retriedId = message.params.clientUserMessageId;
      standardHandler(message, current);
    });
    const { client, spawnFn } = makeClient([firstProcess, secondProcess]);

    await client.deliverTranscript(delivery());

    expect(spawnFn).toHaveBeenCalledTimes(2);
    expect(secondProcess.messages.some((message) => message.method === 'thread/resume')).toBe(false);
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
