import { EventEmitter } from 'node:events';
import os from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import {
  discoverVoiceCodexBinary,
  inspectVoiceCodexRuntime,
  recoverVoiceRequest,
  runVoiceRequest,
  type VoiceCodexRequest,
  type VoiceCodexRunnerOptions,
} from './voiceCodexRunner';

type Message = Record<string, any>;
const RESPONSE = { title: 'Personal - Calculate two plus two', status: 'completed', summary: 'Calculated the answer.', finalResponse: 'The answer is 4.', question: null };
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));

class FakeProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  messages: Message[] = [];
  config: Message = {};
  kill = vi.fn(() => { queueMicrotask(() => this.emit('close', 0)); return true; });
  stdin = { write: (line: string, callback?: (error?: Error | null) => void) => {
    const message = JSON.parse(line) as Message;
    this.messages.push(message);
    callback?.(null);
    queueMicrotask(() => this.handler(message, this));
    return true;
  } };
  constructor(public handler: (message: Message, process: FakeProcess) => void = standard) { super(); }
  send(message: Message): void { this.stdout.emit('data', Buffer.from(`${JSON.stringify(message)}\n`)); }
  reply(message: Message, result: Message): void {
    if (message.method === 'config/read') this.config = result.config;
    this.send({ id: message.id, result });
  }
  start(message: Message): void {
    this.send({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'inProgress' } } });
    this.reply(message, { turn: { id: 'turn-1', status: 'inProgress', items: [] } });
  }
  complete(response: Message = RESPONSE, status = 'completed'): void {
    this.send({ method: 'item/completed', params: { threadId: 'thread-1', turnId: 'turn-1', item: { type: 'agentMessage', id: 'result-1', phase: 'final_answer', text: JSON.stringify(response) } } });
    this.send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status, items: [] } } });
  }
}

function threadResult(process: FakeProcess, thread = { id: 'thread-1', status: { type: 'idle' } }): Message {
  return {
    thread, activePermissionProfile: null, approvalPolicy: process.config.approval_policy ?? 'on-request',
    sandbox: process.config.sandbox_mode === 'read-only' ? { type: 'readOnly', networkAccess: false } : {
      type: 'workspaceWrite', writableRoots: [os.tmpdir()], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false,
    },
  };
}

function standard(message: Message, process: FakeProcess): void {
  switch (message.method) {
    case 'initialize': process.reply(message, { userAgent: 'test' }); break;
    case 'account/read': process.reply(message, { account: { type: 'chatgpt', email: 'private@example.invalid' }, requiresOpenaiAuth: true }); break;
    case 'config/read': process.reply(message, { config: { sandbox_mode: 'workspace-write', approval_policy: 'on-request' } }); break;
    case 'thread/start': process.reply(message, threadResult(process)); break;
    case 'thread/resume': process.reply(message, threadResult(process, { id: message.params.threadId, status: { type: 'idle' } })); break;
    case 'thread/name/set': process.reply(message, {}); break;
    case 'turn/start': process.start(message); process.complete(); break;
    case 'turn/interrupt': process.reply(message, {}); process.complete(RESPONSE, 'interrupted'); break;
  }
}

function setup(handler = standard) {
  const process = new FakeProcess(handler);
  const spawnFn = vi.fn(() => process as never);
  const options: VoiceCodexRunnerOptions = { binaryPath: '/Applications/Codex.app/Contents/Resources/codex', isExecutable: () => true, spawnFn, requestTimeoutMs: 300, turnTimeoutMs: 1_000 };
  const input: VoiceCodexRequest = { text: 'What is 2 + 2?', workspacePath: os.tmpdir(), dispatchKey: 'receipt-1' };
  return { process, options, input, spawnFn };
}

describe('bundled Codex discovery and account status', () => {
  it('prefers a user Applications install and ignores relative PATH entries', () => {
    const calls: string[] = [];
    const found = discoverVoiceCodexBinary({ homeDir: '/Users/test', pathEnv: '.:/bin', isExecutable: p => { calls.push(p); return p === '/Users/test/Applications/ChatGPT.app/Contents/Resources/codex'; } });
    expect(found).toBe('/Users/test/Applications/ChatGPT.app/Contents/Resources/codex');
    expect(calls).not.toContain('codex');
  });

  it('finds the system application before an optional CLI fallback', () => {
    const found = discoverVoiceCodexBinary({ homeDir: '/Users/test', pathEnv: '/usr/local/bin', isExecutable: p => p.startsWith('/Applications/ChatGPT.app/') || p === '/usr/local/bin/codex' });
    expect(found).toBe('/Applications/ChatGPT.app/Contents/Resources/codex');
    expect(discoverVoiceCodexBinary({ applicationDirs: [], pathEnv: '.:/usr/local/bin', isExecutable: p => p === '/usr/local/bin/codex' })).toBe('/usr/local/bin/codex');
  });

  it('reports a missing installation without starting a process', async () => {
    const spawnFn = vi.fn();
    expect(await inspectVoiceCodexRuntime({ isExecutable: () => false, spawnFn })).toEqual({ status: 'not_installed', message: expect.any(String) });
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it('uses account/read and does not expose identity or credentials', async () => {
    const { options, process } = setup();
    const status = await inspectVoiceCodexRuntime(options);
    expect(status.status).toBe('ready');
    expect(JSON.stringify(status)).not.toContain('private@example');
    expect(process.messages.map(m => m.method)).toEqual(['initialize', 'initialized', 'account/read']);
    expect(process.messages[0].params.capabilities).toEqual({ experimentalApi: true, requestAttestation: false });
    expect(process.kill).toHaveBeenCalledOnce();
  });

  it('reports sign-in requirements and startup failure', async () => {
    const { options } = setup((message, process) => message.method === 'account/read' ? process.reply(message, { account: null, requiresOpenaiAuth: true }) : standard(message, process));
    expect((await inspectVoiceCodexRuntime(options)).status).toBe('sign_in_required');
    expect((await inspectVoiceCodexRuntime({ ...options, spawnFn: () => { throw new Error('private diagnostic'); } })).status).toBe('unavailable');
  });

  it.each(['apiKey', 'amazonBedrock', 'unknown'])('requires ChatGPT sign-in instead of using a %s billing identity', async type => {
    const { input, options, process } = setup((message, p) => message.method === 'account/read'
      ? p.reply(message, { account: { type }, requiresOpenaiAuth: true }) : standard(message, p));
    expect(await runVoiceRequest(input, options)).toMatchObject({ status: 'failed', errorCode: 'sign_in_required' });
    expect(process.messages.some(m => m.method === 'thread/start')).toBe(false);
  });
});

describe('Voice Codex execution', () => {
  it('awaits durable thread and dispatch hooks, then returns an actual completed result', async () => {
    const { input, options, process, spawnFn } = setup();
    let release!: () => void;
    const persisted = new Promise<void>(resolve => { release = resolve; });
    const onThreadStarted = vi.fn(() => persisted);
    const onBeforeDispatch = vi.fn();
    const onStarted = vi.fn();
    const running = runVoiceRequest({ ...input, title: 'Personal - Arithmetic', onThreadStarted, onBeforeDispatch, onStarted }, options);
    await tick();
    expect(onThreadStarted).toHaveBeenCalledWith('thread-1');
    expect(process.messages.some(m => m.method === 'turn/start')).toBe(false);
    release();
    const result = await running;
    expect(result).toEqual({ ...RESPONSE, threadId: 'thread-1', turnId: 'turn-1', question: undefined });
    expect(onBeforeDispatch).toHaveBeenCalledWith({ threadId: 'thread-1', dispatchKey: 'receipt-1' });
    expect(onStarted).toHaveBeenCalledOnce();
    expect(spawnFn).toHaveBeenCalledWith(options.binaryPath, ['app-server', '--listen', 'stdio://'], expect.objectContaining({ shell: false, cwd: input.workspacePath }));
    expect(process.messages.some(m => m.method === 'thread/queue/add')).toBe(false);
  });

  it('does not report success when a turn has only started', async () => {
    const { input, options, process } = setup((message, p) => message.method === 'turn/start' ? p.start(message) : standard(message, p));
    const settled = vi.fn();
    const running = runVoiceRequest(input, options).then(result => { settled(); return result; });
    await tick();
    expect(settled).not.toHaveBeenCalled();
    process.complete();
    expect((await running).status).toBe('completed');
  });

  it('fires onStarted only for an actual notification, including one arriving after acceptance', async () => {
    const { input, options, process } = setup((message, p) => message.method === 'turn/start'
      ? p.reply(message, { turn: { id: 'turn-1', status: 'inProgress', items: [] } }) : standard(message, p));
    const onStarted = vi.fn();
    const running = runVoiceRequest({ ...input, onStarted }, options);
    await tick();
    expect(onStarted).not.toHaveBeenCalled();
    process.send({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'inProgress' } } });
    process.complete();
    expect((await running).status).toBe('completed');
    expect(onStarted).toHaveBeenCalledExactlyOnceWith({ threadId: 'thread-1', turnId: 'turn-1' });
  });

  it('replaces a generic new-task title with the specific outcome title', async () => {
    const { input, options, process } = setup();
    expect((await runVoiceRequest({ ...input, title: 'Field Theory - Voice request' }, options)).title).toBe(RESPONSE.title);
    expect(process.messages.filter(m => m.method === 'thread/name/set').map(m => m.params.name)).toEqual(['Field Theory - Voice request', RESPONSE.title]);
  });

  it('preserves an existing task title on continuation', async () => {
    const { input, options, process } = setup((message, p) => message.method === 'thread/resume'
      ? p.reply(message, { ...threadResult(p), thread: { id: 'thread-1', name: 'Personal - Existing calculation', status: { type: 'idle' } } }) : standard(message, p));
    expect((await runVoiceRequest({ ...input, threadId: 'thread-1' }, options)).title).toBe('Personal - Existing calculation');
    expect(process.messages.some(m => m.method === 'thread/name/set')).toBe(false);
  });

  it('defaults to read-only with no network and no automatic approval', async () => {
    const { input, options, process } = setup();
    await runVoiceRequest(input, options);
    expect(process.messages.find(m => m.method === 'thread/start')?.params).toMatchObject({ approvalsReviewer: 'user', ephemeral: false });
    expect(process.messages.find(m => m.method === 'thread/start')?.params.sandbox).toBeUndefined();
    expect(process.messages.find(m => m.method === 'turn/start')?.params).toMatchObject({ sandboxPolicy: { type: 'readOnly', networkAccess: false }, approvalsReviewer: 'user', clientUserMessageId: 'receipt-1' });
    expect(process.messages.find(m => m.method === 'turn/start')?.params.outputSchema.required).toContain('status');
  });

  it('preserves inherited read-only and untrusted settings despite an edit grant', async () => {
    const { input, options, process } = setup((message, p) => message.method === 'config/read'
      ? p.reply(message, { config: { sandbox_mode: 'read-only', approval_policy: 'untrusted', developer_instructions: 'Keep existing custom guidance.' } }) : standard(message, p));
    await runVoiceRequest({ ...input, sandboxMode: 'workspace-write' }, options);
    expect(process.messages.find(m => m.method === 'turn/start')?.params).toMatchObject({ sandboxPolicy: { type: 'readOnly' }, approvalPolicy: 'untrusted' });
    expect(process.messages.find(m => m.method === 'thread/start')?.params.developerInstructions).toContain('Keep existing custom guidance.');
  });

  it('bounds an explicit edit grant to the chosen workspace without network or temporary writable roots', async () => {
    const { input, options, process } = setup();
    await runVoiceRequest({ ...input, sandboxMode: 'workspace-write' }, options);
    expect(process.messages.find(m => m.method === 'turn/start')?.params.sandboxPolicy).toEqual({ type: 'workspaceWrite', writableRoots: [input.workspacePath], networkAccess: false, excludeTmpdirEnvVar: true, excludeSlashTmp: true });
  });

  it('preserves a continued task read-only policy even when the default and edit grant allow writes', async () => {
    const { input, options, process } = setup((message, p) => message.method === 'thread/resume'
      ? p.reply(message, { ...threadResult(p), sandbox: { type: 'readOnly', networkAccess: false }, approvalPolicy: 'untrusted' }) : standard(message, p));
    expect((await runVoiceRequest({ ...input, threadId: 'thread-1', sandboxMode: 'workspace-write' }, options)).status).toBe('completed');
    expect(process.messages.find(m => m.method === 'thread/resume')?.params.sandbox).toBeUndefined();
    expect(process.messages.find(m => m.method === 'thread/resume')?.params.approvalPolicy).toBeUndefined();
    expect(process.messages.find(m => m.method === 'turn/start')?.params).toMatchObject({ sandboxPolicy: { type: 'readOnly', networkAccess: false }, approvalPolicy: 'untrusted' });
  });

  it('keeps the current untrusted approval policy when a resumed task has an older on-request policy', async () => {
    const { input, options, process } = setup((message, p) => {
      if (message.method === 'config/read') p.reply(message, { config: { sandbox_mode: 'workspace-write', approval_policy: 'untrusted' } });
      else if (message.method === 'thread/resume') p.reply(message, { ...threadResult(p), approvalPolicy: 'on-request' });
      else standard(message, p);
    });
    await runVoiceRequest({ ...input, threadId: 'thread-1', sandboxMode: 'workspace-write' }, options);
    expect(process.messages.find(m => m.method === 'turn/start')?.params.approvalPolicy).toBe('untrusted');
  });

  it('preserves restricted read roots when reducing write access', async () => {
    const restricted = { type: 'restricted', includePlatformDefaults: true, readableRoots: [os.tmpdir()] };
    const { input, options, process } = setup((message, p) => message.method === 'thread/resume'
      ? p.reply(message, { ...threadResult(p), sandbox: { ...threadResult(p).sandbox, readOnlyAccess: restricted } }) : standard(message, p));
    await runVoiceRequest({ ...input, threadId: 'thread-1' }, options);
    expect(process.messages.find(m => m.method === 'turn/start')?.params.sandboxPolicy).toEqual({ type: 'readOnly', networkAccess: false, access: restricted });
  });

  it.each([{ activePermissionProfile: { id: 'private-project', extends: ':workspace' } }, { sandbox: {} }, { approvalPolicy: 'unknown' }])('does not flatten unsupported permissions into a broader sandbox: %j', async overrides => {
    const { input, options, process } = setup((message, p) => message.method === 'thread/start'
      ? p.reply(message, { ...threadResult(p), ...overrides }) : standard(message, p));
    expect(await runVoiceRequest({ ...input, sandboxMode: 'workspace-write' }, options)).toMatchObject({ status: 'failed', errorCode: 'permissions_unsupported' });
    expect(process.messages.some(m => m.method === 'turn/start')).toBe(false);
  });

  it('continues an explicitly identified task and marks the previous transcript as superseded', async () => {
    const { input, options, process } = setup();
    await runVoiceRequest({ ...input, threadId: 'thread-1', previousText: 'Earlier wording.' }, options);
    expect(process.messages.filter(m => m.method === 'thread/start')).toHaveLength(0);
    expect(process.messages.find(m => m.method === 'thread/resume')?.params).toMatchObject({ threadId: 'thread-1', excludeTurns: true });
    expect(JSON.parse(process.messages.find(m => m.method === 'turn/start')?.params.input[0].text)).toEqual({ currentRecording: input.text, supersededTranscriptRevision: 'Earlier wording.' });
  });

  it('refuses to steer a task that is already active', async () => {
    const { input, options, process } = setup((message, p) => message.method === 'thread/resume' ? p.reply(message, { thread: { id: 'thread-1', status: { type: 'active' } } }) : standard(message, p));
    const result = await runVoiceRequest({ ...input, threadId: 'thread-1' }, options);
    expect(result.status).toBe('needs_user');
    expect(process.messages.some(m => m.method === 'turn/start')).toBe(false);
  });

  it('returns context and requires whole-recording intent interpretation rather than keyword execution', async () => {
    const { input, options, process } = setup((message, p) => {
      if (message.method === 'turn/start') { p.start(message); p.complete({ title: 'Personal - Saved context', status: 'context', summary: 'Saved as context.', finalResponse: '', question: null }); }
      else standard(message, p);
    });
    expect((await runVoiceRequest({ ...input, text: 'Just context; hold off for now.' }, options)).status).toBe('context');
    const instructions = process.messages.find(m => m.method === 'thread/start')?.params.developerInstructions;
    expect(instructions).toContain('do no work and call no tools');
    expect(instructions).toContain('A question or review authorizes inspection only');
  });

  it.each(['item/commandExecution/requestApproval', 'item/fileChange/requestApproval', 'item/permissions/requestApproval', 'mcpServer/elicitation/request'])('never grants %s and returns needs_user', async method => {
    const { input, options, process } = setup((message, p) => {
      if (message.method === 'turn/start') { p.start(message); p.send({ id: 'approval-1', method, params: { threadId: 'thread-1', turnId: 'turn-1' } }); }
      else standard(message, p);
    });
    const result = await runVoiceRequest(input, options);
    expect(result.status).toBe('needs_user');
    const answer = process.messages.find(m => m.id === 'approval-1');
    expect(answer?.result).toBeDefined();
    expect(JSON.stringify(answer)).not.toContain('accept');
    expect(process.messages.some(m => m.method === 'turn/interrupt')).toBe(true);
  });

  it('returns the actual clarification and never fabricates a user answer', async () => {
    const { input, options, process } = setup((message, p) => {
      if (message.method === 'turn/start') {
        p.start(message);
        p.send({ id: 'question-1', method: 'item/tool/requestUserInput', params: { threadId: 'thread-1', turnId: 'turn-1', questions: [{ id: 'project', question: 'Which project should I inspect?' }] } });
      } else standard(message, p);
    });
    const result = await runVoiceRequest(input, options);
    expect(result).toMatchObject({ status: 'needs_user', question: 'Which project should I inspect?' });
    expect(process.messages.find(m => m.id === 'question-1')?.result).toEqual({ answers: {} });
  });

  it('fails closed for unsupported interactions', async () => {
    const { input, options, process } = setup((message, p) => {
      if (message.method === 'turn/start') { p.start(message); p.send({ id: 'unknown-1', method: 'item/tool/call', params: {} }); }
      else standard(message, p);
    });
    expect((await runVoiceRequest(input, options)).status).toBe('needs_user');
    expect(process.messages.find(m => m.id === 'unknown-1')?.error.code).toBe(-32601);
  });

  it('does not dispatch when a durability callback fails', async () => {
    const { input, options, process } = setup();
    const result = await runVoiceRequest({ ...input, onBeforeDispatch: () => { throw new Error('disk full'); } }, options);
    expect(result).toMatchObject({ threadId: 'thread-1', status: 'failed' });
    expect(process.messages.some(m => m.method === 'turn/start')).toBe(false);
  });

  it('reports the receipt failure even if the turn completed before its started hook rejected', async () => {
    const { input, options, process } = setup();
    expect(await runVoiceRequest({ ...input, onStarted: () => { throw new Error('disk full'); } }, options))
      .toMatchObject({ status: 'failed', errorCode: 'receipt_failed', threadId: 'thread-1', turnId: 'turn-1' });
    expect(process.messages.filter(m => m.method === 'turn/start')).toHaveLength(1);
  });

  it('ignores completion notifications belonging to another turn', async () => {
    const { input, options, process } = setup((message, p) => message.method === 'turn/start' ? p.start(message) : standard(message, p));
    const settled = vi.fn();
    const running = runVoiceRequest(input, options).then(result => { settled(); return result; });
    await tick();
    process.send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'old-turn', status: 'completed', items: [] } } });
    await tick();
    expect(settled).not.toHaveBeenCalled();
    process.complete();
    expect((await running).turnId).toBe('turn-1');
  });

  it('holds a contradictory turn/start response even when a streamed turn completed', async () => {
    const { input, options, process } = setup((message, p) => {
      if (message.method !== 'turn/start') return standard(message, p);
      p.send({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'inProgress' } } });
      p.complete();
      p.reply(message, { turn: { id: 'contradictory-turn', status: 'inProgress', items: [] } });
    });
    expect(await runVoiceRequest(input, options)).toMatchObject({ status: 'failed', errorCode: 'protocol_error', recoveryUncertain: true });
    expect(process.messages.filter(m => m.method === 'turn/start')).toHaveLength(1);
  });

  it('requires a valid outcome even when Codex reports the turn completed', async () => {
    const { input, options } = setup((message, p) => {
      if (message.method === 'turn/start') { p.start(message); p.complete({ answer: 'Done!' }); }
      else standard(message, p);
    });
    expect(await runVoiceRequest(input, options)).toMatchObject({ status: 'failed', errorCode: 'invalid_outcome' });
  });

  it.each(['unauthorized', { responseStreamConnectionFailed: { httpStatusCode: 401 } }])('reports expired authentication from terminal error info: %j', async codexErrorInfo => {
    const { input, options } = setup((message, p) => {
      if (message.method !== 'turn/start') return standard(message, p);
      p.start(message);
      p.send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'failed', items: [], error: { message: 'private server detail', codexErrorInfo } } } });
    });
    const result = await runVoiceRequest(input, options);
    expect(result).toMatchObject({ status: 'failed', errorCode: 'sign_in_required' });
    expect(result.recoveryUncertain).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('private server detail');
  });

  it('keeps the task id on protocol failure and does not repeat the prompt', async () => {
    const { input, options, process } = setup((message, p) => {
      if (message.method === 'turn/start') { p.start(message); p.stdout.emit('data', 'invalid JSON\n'); }
      else standard(message, p);
    });
    expect(await runVoiceRequest(input, options)).toMatchObject({ status: 'failed', threadId: 'thread-1', errorCode: 'protocol_error', recoveryUncertain: true });
    expect(process.messages.filter(m => m.method === 'turn/start')).toHaveLength(1);
  });

  it('decodes multi-byte text split across stdout chunks without corrupting the final answer', async () => {
    const response = { ...RESPONSE, finalResponse: 'Café ☕' };
    const { input, options } = setup((message, p) => {
      if (message.method !== 'turn/start') return standard(message, p);
      p.start(message);
      const packet = Buffer.from(`${JSON.stringify({ method: 'item/completed', params: { threadId: 'thread-1', turnId: 'turn-1', item: { type: 'agentMessage', phase: 'final_answer', text: JSON.stringify(response) } } })}\n`);
      const split = packet.indexOf(Buffer.from('☕')) + 1;
      p.stdout.emit('data', packet.subarray(0, split));
      p.stdout.emit('data', packet.subarray(split));
      p.send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed', items: [] } } });
    });
    expect((await runVoiceRequest(input, options)).finalResponse).toBe('Café ☕');
  });

  it('fails without dispatch when configuration inspection is rejected or times out', async () => {
    const rejected = setup((message, p) => message.method === 'config/read'
      ? p.send({ id: message.id, error: { code: -32601, message: 'private server diagnostic' } }) : standard(message, p));
    const result = await runVoiceRequest(rejected.input, rejected.options);
    expect(result).toMatchObject({ status: 'failed', errorCode: 'request_rejected' });
    expect(JSON.stringify(result)).not.toContain('private server diagnostic');
    expect(rejected.process.messages.some(m => m.method === 'turn/start')).toBe(false);
    const timedOut = setup((message, p) => { if (message.method !== 'config/read') standard(message, p); });
    expect(await runVoiceRequest(timedOut.input, { ...timedOut.options, requestTimeoutMs: 20 })).toMatchObject({ status: 'failed', errorCode: 'request_timeout' });
    expect(timedOut.process.messages.some(m => m.method === 'turn/start')).toBe(false);
  });

  it('stops timed-out runs with an interrupt instead of returning success', async () => {
    const { input, options, process } = setup((message, p) => message.method === 'turn/start' ? p.start(message) : standard(message, p));
    expect(await runVoiceRequest(input, { ...options, turnTimeoutMs: 20 })).toMatchObject({ status: 'failed', errorCode: 'turn_timeout' });
    expect(process.messages.some(m => m.method === 'turn/interrupt')).toBe(true);
  });

  it('honors cancellation before startup and during execution', async () => {
    const { input, options, process, spawnFn } = setup((message, p) => message.method === 'turn/start' ? p.start(message) : standard(message, p));
    expect((await runVoiceRequest({ ...input, signal: AbortSignal.abort() }, options)).status).toBe('interrupted');
    expect(spawnFn).not.toHaveBeenCalled();
    const controller = new AbortController();
    const running = runVoiceRequest({ ...input, signal: controller.signal }, options);
    await tick();
    controller.abort();
    expect((await running).status).toBe('interrupted');
    expect(process.messages.some(m => m.method === 'turn/interrupt')).toBe(true);
  });

  it('interrupts a turn that starts after cancellation and waits for its terminal event', async () => {
    let dispatch!: Message;
    const { input, options, process } = setup((message, p) => message.method === 'turn/start' ? (dispatch = message) : standard(message, p));
    const controller = new AbortController();
    const running = runVoiceRequest({ ...input, signal: controller.signal }, options);
    await tick();
    controller.abort();
    process.start(dispatch);
    expect(await running).toMatchObject({ status: 'interrupted', turnId: 'turn-1' });
    expect((await running).recoveryUncertain).toBeUndefined();
    expect(process.messages.filter(m => m.method === 'turn/interrupt')).toHaveLength(1);
  });

  it('marks cancellation uncertain when the server never confirms interruption', async () => {
    const { input, options, process } = setup((message, p) => {
      if (message.method === 'turn/start') p.start(message);
      else if (message.method === 'turn/interrupt') p.reply(message, {});
      else standard(message, p);
    });
    const controller = new AbortController();
    const running = runVoiceRequest({ ...input, signal: controller.signal }, { ...options, turnTimeoutMs: 5_000 });
    await tick();
    controller.abort();
    expect(await running).toMatchObject({ status: 'interrupted', turnId: 'turn-1', recoveryUncertain: true });
    expect(process.kill).toHaveBeenCalledOnce();
  });
});

describe('Voice recovery never dispatches again', () => {
  const recordedTurn = { id: 'turn-1', status: 'completed', items: [
    { type: 'userMessage', clientId: 'receipt-1' },
    { type: 'agentMessage', phase: 'final_answer', text: JSON.stringify(RESPONSE) },
  ] };
  it('returns the exact persisted receipt outcome without resuming or starting a turn', async () => {
    const { input, options, process } = setup((message, p) => message.method === 'thread/read'
      ? p.reply(message, { thread: { id: 'thread-1', turns: [recordedTurn, { id: 'different', status: 'completed', items: [] }] } }) : standard(message, p));
    const result = await recoverVoiceRequest({ ...input, threadId: 'thread-1' }, options);
    expect(result).toMatchObject({ status: 'completed', turnId: 'turn-1', finalResponse: 'The answer is 4.' });
    expect(process.messages.map(m => m.method)).toEqual(['initialize', 'initialized', 'account/read', 'thread/read']);
  });

  it.each(['inProgress', 'unmatched'])('requires reconciliation for %s instead of replaying', async state => {
    const { input, options, process } = setup((message, p) => message.method === 'thread/read'
      ? p.reply(message, { thread: { id: 'thread-1', turns: state === 'unmatched' ? [] : [{ ...recordedTurn, status: state }] } }) : standard(message, p));
    expect(await recoverVoiceRequest({ ...input, threadId: 'thread-1' }, options)).toMatchObject({ status: 'needs_user', threadId: 'thread-1', recoveryUncertain: true });
    expect(process.messages.some(m => ['thread/resume', 'thread/start', 'turn/start'].includes(m.method))).toBe(false);
  });

  it.each([
    { turns: [{ ...recordedTurn, id: 'another-turn' }] },
    { turns: [{ ...recordedTurn, items: [{ type: 'userMessage', clientId: 'another-receipt' }] }] },
    { turns: [recordedTurn, { ...recordedTurn, id: 'duplicate-turn' }] },
    { turns: [{ ...recordedTurn, items: [...recordedTurn.items, recordedTurn.items[0]] }] },
  ])('requires both receipt and persisted turn id to match without duplicates: %j', async ({ turns }) => {
    const { input, options, process } = setup((message, p) => message.method === 'thread/read'
      ? p.reply(message, { thread: { id: 'thread-1', turns } }) : standard(message, p));
    expect(await recoverVoiceRequest({ ...input, threadId: 'thread-1', turnId: 'turn-1' }, options)).toMatchObject({ status: 'needs_user', recoveryUncertain: true });
    expect(process.messages.some(m => ['thread/resume', 'thread/start', 'turn/start'].includes(m.method))).toBe(false);
  });

  it('does not hold a completed clarification as an uncertain dispatch', async () => {
    const clarification = { ...RESPONSE, status: 'needs_user', question: 'Which project?' };
    const { input, options } = setup((message, p) => message.method === 'thread/read'
      ? p.reply(message, { thread: { id: 'thread-1', turns: [{ ...recordedTurn, items: [recordedTurn.items[0], { type: 'agentMessage', phase: 'final_answer', text: JSON.stringify(clarification) }] }] } }) : standard(message, p));
    const result = await recoverVoiceRequest({ ...input, threadId: 'thread-1', turnId: 'turn-1' }, options);
    expect(result).toMatchObject({ status: 'needs_user', question: 'Which project?' });
    expect(result.recoveryUncertain).toBeUndefined();
  });
});
