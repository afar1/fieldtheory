import { EventEmitter } from 'node:events';
import os from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import {
  discoverVoiceCodexBinary,
  voiceTurnStartedAt,
  inspectVoiceCodexRuntime,
  recoverVoiceRequest,
  runVoiceInternalTurn,
  runVoiceRequest,
  withVoiceCodexClient,
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
  classifierResponse: Message = RESPONSE;
  internalHandler: (message: Message, process: FakeProcess) => void = internal;
  kill = vi.fn(() => { queueMicrotask(() => this.emit('close', 0)); return true; });
  stdin = { write: (line: string, callback?: (error?: Error | null) => void) => {
    const message = JSON.parse(line) as Message;
    this.messages.push(message);
    callback?.(null);
    queueMicrotask(() => {
      if (message.params?.ephemeral === true || message.params?.threadId === 'internal-thread') this.internalHandler(message, this);
      else this.handler(message, this);
    });
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
    this.classifierResponse = response;
    this.send({ method: 'item/completed', params: { threadId: 'thread-1', turnId: 'turn-1', item: { type: 'agentMessage', id: 'result-1', phase: 'final_answer', text: response.finalResponse ?? JSON.stringify(response) } } });
    this.send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status, items: [] } } });
  }
}

function internal(message: Message, process: FakeProcess): void {
  if (message.method === 'thread/start') process.reply(message, { ...threadResult(process), thread: { id: 'internal-thread', ephemeral: true, status: { type: 'idle' } } });
  if (message.method === 'turn/start') {
    process.send({ method: 'turn/started', params: { threadId: 'internal-thread', turn: { id: 'internal-turn', status: 'inProgress' } } });
    process.reply(message, { turn: { id: 'internal-turn', status: 'inProgress' } });
    const { finalResponse: _finalResponse, ...metadata } = process.classifierResponse;
    process.send({ method: 'turn/completed', params: { threadId: 'internal-thread', turn: { id: 'internal-turn', status: 'completed', items: [
      { type: 'agentMessage', phase: 'final_answer', text: JSON.stringify(metadata) },
    ] } } });
  }
  if (message.method === 'turn/interrupt') process.reply(message, {});
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
    expect(process.messages.find(m => m.method === 'turn/start')?.params.outputSchema).toBeUndefined();
    expect(process.messages.find(m => m.method === 'turn/start' && m.params.threadId === 'internal-thread')?.params.outputSchema.required).toContain('status');
  });

  it('keeps the visible request and answer readable while classifying privately', async () => {
    const answer = 'Here is the result.\n\n![Mountain](/tmp/mountain.png)';
    const { input, options, process } = setup((message, p) => {
      if (message.method === 'turn/start') { p.start(message); p.complete({ ...RESPONSE, finalResponse: answer }); }
      else standard(message, p);
    });
    const onStarted = vi.fn();
    const onThreadStarted = vi.fn();
    const result = await runVoiceRequest({ ...input, text: 'Draw a mountain.', previousText: 'Draw a fountain.', onStarted, onThreadStarted }, options);
    expect(result.finalResponse).toBe(answer);
    expect(result.status).toBe('completed');
    const main = process.messages.find(m => m.method === 'turn/start' && m.params.threadId === 'thread-1')!.params;
    expect(main.input).toEqual([{ type: 'text', text: 'Draw a mountain.' }]);
    expect(main.outputSchema).toBeUndefined();
    expect(main.clientUserMessageId).toBe('receipt-1');
    expect(onStarted).toHaveBeenCalledExactlyOnceWith({ threadId: 'thread-1', turnId: 'turn-1' });
    expect(onThreadStarted).toHaveBeenCalledExactlyOnceWith('thread-1');
    const privateStart = process.messages.find(m => m.method === 'thread/start' && m.params.ephemeral)!.params;
    expect(privateStart).toMatchObject({ ephemeral: true, dynamicTools: [], selectedCapabilityRoots: [], environments: [] });
    const privateTurn = process.messages.find(m => m.method === 'turn/start' && m.params.threadId === 'internal-thread')!.params;
    expect(privateTurn.clientUserMessageId).toBeUndefined();
    expect(JSON.parse(privateTurn.input[0].text)).toMatchObject({ recording: 'Draw a mountain.', response: answer });
    expect(privateTurn.outputSchema.properties.finalResponse).toBeUndefined();
  });

  it('assigns a registered project only when creating the durable task', async () => {
    const created = setup();
    await runVoiceRequest({ ...created.input, projectId: 'registered-project' }, created.options);
    expect(created.process.messages.find(m => m.method === 'thread/start' && !m.params.ephemeral)?.params.projectId).toBe('registered-project');
    expect(created.process.messages.find(m => m.method === 'thread/start' && m.params.ephemeral)?.params.projectId).toBeUndefined();
    const resumed = setup();
    await runVoiceRequest({ ...resumed.input, projectId: 'registered-project', threadId: 'thread-1' }, resumed.options);
    expect(resumed.process.messages.find(m => m.method === 'thread/resume')?.params.projectId).toBeUndefined();
  });

  it('keeps a required routing question in developer guidance and reports the completed clarification', async () => {
    const { input, options, process } = setup((message, p) => {
      if (message.method === 'turn/start') { p.start(message); p.complete({ ...RESPONSE, status: 'needs_user', question: 'Which project?', finalResponse: 'Which project?' }); }
      else standard(message, p);
    });
    const result = await runVoiceRequest({ ...input, routingQuestion: 'Which project?' }, options);
    expect(result).toMatchObject({ status: 'needs_user', question: 'Which project?', finalResponse: 'Which project?' });
    expect(result.recoveryUncertain).toBeUndefined();
    expect(process.messages.find(m => m.method === 'thread/start')?.params.developerInstructions).toContain('Do no work or tool calls yet');
    expect(process.messages.find(m => m.method === 'turn/start')?.params.input).toEqual([{ type: 'text', text: input.text }]);
  });

  it('classifies native image completion without copying image bytes or tool payloads', async () => {
    const { input, options, process } = setup((message, p) => {
      if (message.method === 'turn/start') {
        p.start(message);
        p.send({ method: 'item/completed', params: { threadId: 'thread-1', turnId: 'turn-1', item: { type: 'imageGeneration', id: 'image-1', status: 'completed', savedPath: '/tmp/image.png', result: 'private-image-bytes' } } });
        p.complete({ ...RESPONSE, finalResponse: '' });
      } else standard(message, p);
    });
    expect(await runVoiceRequest(input, options)).toMatchObject({ status: 'completed', finalResponse: '' });
    const evidence = JSON.parse(process.messages.find(m => m.method === 'turn/start' && m.params.threadId === 'internal-thread')?.params.input[0].text);
    expect(evidence.activity).toEqual([{ type: 'imageGeneration', id: 'image-1', status: 'completed', savedPath: '/tmp/image.png' }]);
    expect(JSON.stringify(process.messages)).not.toContain('private-image-bytes');
  });

  it('rejects an empty claimed completion without losing the original task identity', async () => {
    const { input, options } = setup((message, p) => {
      if (message.method === 'turn/start') { p.start(message); p.complete({ ...RESPONSE, finalResponse: '' }); }
      else standard(message, p);
    });
    expect(await runVoiceRequest(input, options)).toMatchObject({ status: 'failed', errorCode: 'invalid_outcome', threadId: 'thread-1', turnId: 'turn-1' });
  });

  it('preserves the readable answer when metadata is malformed, without retrying the work', async () => {
    const { input, options, process } = setup();
    process.internalHandler = (message, p) => {
      if (message.method === 'turn/start') p.classifierResponse = { status: 'completed', summary: 'Pretend success' };
      internal(message, p);
    };
    const result = await runVoiceRequest(input, options);
    expect(result).toMatchObject({ status: 'failed', errorCode: 'invalid_outcome', finalResponse: RESPONSE.finalResponse, threadId: 'thread-1', turnId: 'turn-1' });
    expect(result.recoveryUncertain).toBeUndefined();
    expect(process.messages.filter(m => m.method === 'turn/start' && m.params.threadId === 'thread-1')).toHaveLength(1);
  });

  it('distinguishes a finished turn from finished work', async () => {
    const answer = 'I could not read the unavailable project, so the review is incomplete.';
    const { input, options } = setup((message, p) => {
      if (message.method === 'turn/start') { p.start(message); p.complete({ ...RESPONSE, status: 'failed', summary: 'The project was unavailable.', finalResponse: answer }); }
      else standard(message, p);
    });
    const result = await runVoiceRequest(input, options);
    expect(result).toMatchObject({ status: 'failed', finalResponse: answer, summary: 'The project was unavailable.' });
    expect(result.recoveryUncertain).toBeUndefined();
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
    expect(process.messages.filter(m => m.method === 'thread/start' && !m.params.ephemeral)).toHaveLength(0);
    expect(process.messages.find(m => m.method === 'thread/resume')?.params).toMatchObject({ threadId: 'thread-1', excludeTurns: true });
    expect(process.messages.find(m => m.method === 'turn/start')?.params.input).toEqual([{ type: 'text', text: input.text }]);
    expect(process.messages.find(m => m.method === 'thread/resume')?.params.developerInstructions).toContain('Earlier wording.');
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
      const packet = Buffer.from(`${JSON.stringify({ method: 'item/completed', params: { threadId: 'thread-1', turnId: 'turn-1', item: { type: 'agentMessage', phase: 'final_answer', text: response.finalResponse } } })}\n`);
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

describe('private Voice decisions', () => {
  const decision = { workspacePath: os.tmpdir(), instructions: 'Classify only; do not use tools.', input: 'Supplied evidence', outputSchema: { type: 'object' } };

  it('uses the signed-in account and restores client handlers after a private decision', async () => {
    const { options, process } = setup();
    const previousNotification = vi.fn();
    const result = await withVoiceCodexClient(os.tmpdir(), async client => {
      client.onNotification = previousNotification;
      const value = await runVoiceInternalTurn(client, decision);
      expect(client.onNotification).toBe(previousNotification);
      return value;
    }, options);
    expect(result).toMatchObject({ status: 'completed' });
    expect(process.messages.findIndex(m => m.method === 'account/read')).toBeLessThan(process.messages.findIndex(m => m.method === 'thread/start'));
    expect(process.kill).toHaveBeenCalledOnce();
    expect(process.messages.every(m => m.method !== 'thread/resume')).toBe(true);
  });

  it('disables work capabilities and configured MCP servers while retaining stricter permissions', async () => {
    const { options, process } = setup((message, p) => message.method === 'config/read'
      ? p.reply(message, { config: { sandbox_mode: 'read-only', approval_policy: 'untrusted', mcp_servers: { 'server.with.dot': { url: 'private-endpoint', token: 'private-token' }, ordinary: { command: '/some/tool' } } } }) : standard(message, p));
    await withVoiceCodexClient(os.tmpdir(), client => runVoiceInternalTurn(client, decision), options);
    const params = process.messages.find(m => m.method === 'thread/start')!.params;
    expect(params.config).toMatchObject({ web_search: 'disabled', features: { shell_tool: false, unified_exec: false, image_generation: false, plugins: false, apps: false, code_mode: false },
      mcp_servers: { 'server.with.dot': { enabled: false }, ordinary: { enabled: false } } });
    expect(Object.values(params.config.features).every(value => value === false)).toBe(true);
    expect(JSON.stringify(process.messages)).not.toContain('private-token');
    expect(JSON.stringify(process.messages)).not.toContain('private-endpoint');
    expect(process.messages.find(m => m.method === 'turn/start')?.params).toMatchObject({ sandboxPolicy: { type: 'readOnly', networkAccess: false }, approvalPolicy: 'untrusted', environments: [] });
  });

  it.each([false, undefined])('does not send structured input unless the task is confirmed ephemeral: %s', async ephemeral => {
    const { options, process } = setup();
    process.internalHandler = (message, p) => message.method === 'thread/start'
      ? p.reply(message, { ...threadResult(p), thread: { id: 'internal-thread', ephemeral, status: { type: 'idle' } } }) : internal(message, p);
    await expect(withVoiceCodexClient(os.tmpdir(), client => runVoiceInternalTurn(client, decision), options)).rejects.toMatchObject({ code: 'protocol_error' });
    expect(process.messages.some(m => m.method === 'turn/start')).toBe(false);
  });

  it.each(['item/tool/call', 'item/permissions/requestApproval'])('denies internal %s without granting access', async method => {
    const { options, process } = setup();
    process.internalHandler = (message, p) => {
      if (message.method === 'turn/start') {
        p.send({ method: 'turn/started', params: { threadId: 'internal-thread', turn: { id: 'internal-turn', status: 'inProgress' } } });
        p.reply(message, { turn: { id: 'internal-turn', status: 'inProgress' } });
        p.send({ id: 'internal-request', method, params: { threadId: 'internal-thread', turnId: 'internal-turn' } });
      } else internal(message, p);
    };
    await expect(withVoiceCodexClient(os.tmpdir(), client => runVoiceInternalTurn(client, decision), options)).rejects.toMatchObject({ code: 'internal_tool_request' });
    const reply = process.messages.find(m => m.id === 'internal-request');
    expect(reply?.result ?? reply?.error).toBeDefined();
    expect(JSON.stringify(reply)).not.toContain('accept');
    expect(process.messages.find(m => m.method === 'turn/interrupt')?.params).toEqual({ threadId: 'internal-thread', turnId: 'internal-turn' });
  });

  it('rejects unexpected tool activity in a completed internal turn', async () => {
    const { options, process } = setup();
    process.internalHandler = (message, p) => {
      if (message.method === 'turn/start') {
        p.send({ method: 'turn/started', params: { threadId: 'internal-thread', turn: { id: 'internal-turn', status: 'inProgress' } } });
        p.reply(message, { turn: { id: 'internal-turn', status: 'inProgress' } });
        p.send({ method: 'turn/completed', params: { threadId: 'internal-thread', turn: { id: 'internal-turn', status: 'completed', items: [{ type: 'commandExecution', status: 'completed' }] } } });
      } else internal(message, p);
    };
    await expect(withVoiceCodexClient(os.tmpdir(), client => runVoiceInternalTurn(client, decision), options)).rejects.toMatchObject({ code: 'internal_tool_request' });
  });

  it('times out a private turn without dispatching again', async () => {
    const { options, process } = setup();
    process.internalHandler = (message, p) => {
      if (message.method === 'turn/start') {
        p.send({ method: 'turn/started', params: { threadId: 'internal-thread', turn: { id: 'internal-turn', status: 'inProgress' } } });
        p.reply(message, { turn: { id: 'internal-turn', status: 'inProgress' } });
      } else internal(message, p);
    };
    await expect(withVoiceCodexClient(os.tmpdir(), client => runVoiceInternalTurn(client, { ...decision, timeoutMs: 20 }), options)).rejects.toMatchObject({ code: 'classification_timeout' });
    expect(process.messages.filter(m => m.method === 'turn/start')).toHaveLength(1);
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

  it('classifies a recovered readable turn privately without appending to the original task', async () => {
    const readable = { ...recordedTurn, items: [
      { type: 'userMessage', clientId: 'receipt-1', content: [{ type: 'text', text: 'What is 2 + 2?' }] },
      { type: 'agentMessage', phase: 'final_answer', text: RESPONSE.finalResponse },
    ] };
    const { input, options, process } = setup((message, p) => message.method === 'thread/read'
      ? p.reply(message, { thread: { id: 'thread-1', turns: [readable] } }) : standard(message, p));
    const result = await recoverVoiceRequest({ ...input, threadId: 'thread-1', turnId: 'turn-1' }, options);
    expect(result).toMatchObject({ status: 'completed', finalResponse: RESPONSE.finalResponse, threadId: 'thread-1', turnId: 'turn-1' });
    expect(result.recoveryUncertain).toBeUndefined();
    expect(process.messages.filter(m => m.method === 'turn/start').map(m => m.params.threadId)).toEqual(['internal-thread']);
    expect(process.messages.some(m => m.method === 'thread/resume')).toBe(false);
    expect(process.messages.filter(m => m.method === 'thread/start').every(m => m.params.ephemeral === true)).toBe(true);
  });
});

describe('persistent Voice inbox turns', () => {
  function inboxSetup(history: Message[] = []) {
    return setup((message, process) => {
      if (message.method === 'thread/start' || message.method === 'thread/resume') {
        process.reply(message, { ...threadResult(process), thread: { id: 'thread-1', ephemeral: false, status: { type: 'idle' }, section: history.length ? { id: 'pinned-section', name: 'Pinned' } : null } });
      } else if (message.method === 'threadSection/list') process.reply(message, { data: [{ id: 'pinned-section', name: 'Pinned' }] });
      else if (message.method === 'thread/section/move') process.reply(message, {});
      else if (message.method === 'thread/read') process.reply(message, { thread: { id: 'thread-1', turns: history } });
      else standard(message, process);
    });
  }
  const receipt = { workspacePath: os.tmpdir(), input: 'Just context: I prefer watercolor penguins.', instructions: 'Acknowledge context only.' };

  it('creates one visible pinned inbox with a plain answer and no execution capabilities', async () => {
    const { process, options } = inboxSetup();
    const onThread = vi.fn();
    const result = await withVoiceCodexClient(os.tmpdir(), client => runVoiceInternalTurn(client, {
      ...receipt, inbox: { onThread, receiptKey: 'receipt-intake' },
    }), options);
    expect(result).toEqual({ threadId: 'thread-1', text: 'The answer is 4.' });
    expect(onThread).toHaveBeenCalledWith('thread-1');
    expect(process.messages.find(m => m.method === 'thread/start')?.params).toMatchObject({ ephemeral: false, threadSource: 'field-theory-voice-inbox', config: { features: { shell_tool: false, apps: false } } });
    expect(process.messages.find(m => m.method === 'thread/section/move')?.params).toEqual({ threadId: 'thread-1', sectionId: 'pinned-section' });
    const turn = process.messages.find(m => m.method === 'turn/start')?.params;
    expect(turn.clientUserMessageId).toBe('receipt-intake');
    expect(turn.outputSchema).toBeUndefined();
    expect(turn.sandboxPolicy.type).toBe('readOnly');
  });

  it('resumes the saved inbox and recovers a completed receipt without a duplicate turn', async () => {
    const { process, options } = inboxSetup([{ status: 'completed', items: [
      { type: 'userMessage', clientId: 'receipt-intake' }, { type: 'agentMessage', phase: 'final_answer', text: 'Saved as context.' },
    ] }]);
    const result = await withVoiceCodexClient(os.tmpdir(), client => runVoiceInternalTurn(client, {
      ...receipt, inbox: { threadId: 'thread-1', onThread: () => {}, receiptKey: 'receipt-intake' },
    }), options);
    expect(result.text).toBe('Saved as context.');
    expect(process.messages.some(m => m.method === 'thread/section/move')).toBe(false);
    expect(process.messages.some(m => m.method === 'thread/resume')).toBe(true);
    expect(process.messages.some(m => m.method === 'thread/start' || m.method === 'turn/start')).toBe(false);
  });

  it('preserves an interrupted receipt for review instead of replaying it', async () => {
    const { process, options } = inboxSetup([{ status: 'interrupted', items: [{ type: 'userMessage', clientId: 'receipt-intake' }] }]);
    await expect(withVoiceCodexClient(os.tmpdir(), client => runVoiceInternalTurn(client, {
      ...receipt, inbox: { threadId: 'thread-1', onThread: () => {}, receiptKey: 'receipt-intake' },
    }), options)).rejects.toThrow(/still needs review/);
    expect(process.messages.some(m => m.method === 'turn/start')).toBe(false);
  });
});

describe('owner-managed continuation queue', () => {
  const queued = { id: 'queue-1', clientUserMessageId: 'receipt-1', input: [] };
  const completed = { id: 'owner-turn', status: 'completed', items: [
    { type: 'userMessage', clientId: 'receipt-1', content: [{ type: 'text', text: 'What is 2+2?' }] },
    { type: 'agentMessage', text: JSON.stringify(RESPONSE) },
  ] };
  function fixture() {
    const state = { queue: [] as Message[], turns: [completed] as Message[] };
    const h = setup((m, p) => {
      if (m.method === 'thread/resume') p.send({ id: m.id, error: { code: -32600, message: 'thread thread-1 already has an active writer secret' } });
      else if (m.method === 'thread/read') p.reply(m, { thread: { id: 'thread-1', cwd: os.tmpdir() } });
      else if (m.method === 'thread/queue/add') p.reply(m, { queuedSubmission: queued });
      else if (m.method === 'thread/queue/list') p.reply(m, { data: state.queue, nextCursor: null });
      else if (m.method === 'thread/turns/list') p.reply(m, { data: state.turns, nextCursor: null });
      else standard(m, p);
    });
    const onThreadStarted = vi.fn(), onBeforeQueue = vi.fn(), onQueued = vi.fn(), onStarted = vi.fn();
    return { ...h, state, input: { ...h.input, threadId: 'thread-1', onThreadStarted, onBeforeQueue, onQueued, onStarted },
      options: { ...h.options, turnTimeoutMs: 30, queuePollMs: 1 } };
  }

  it('persists before the single enqueue, then reports only a correlated actual turn', async () => {
    const h = fixture();
    h.input.onBeforeQueue.mockImplementation(() => expect(h.process.messages.some(m => m.method === 'thread/queue/add')).toBe(false));
    h.input.onQueued.mockImplementation(() => expect(h.input.onStarted).not.toHaveBeenCalled());
    const result = await runVoiceRequest(h.input, h.options);
    expect(result).toMatchObject({ status: 'completed', turnId: 'owner-turn', finalResponse: RESPONSE.finalResponse });
    expect(h.input.onThreadStarted).toHaveBeenCalledWith('thread-1');
    expect(h.input.onQueued).toHaveBeenCalledWith({ threadId: 'thread-1', queuedSubmissionId: 'queue-1' });
    expect(h.input.onStarted).toHaveBeenCalledWith({ threadId: 'thread-1', turnId: 'owner-turn' });
    expect(h.process.messages.filter(m => m.method === 'thread/queue/add')).toHaveLength(1);
    expect(h.process.messages.some(m => ['thread/queue/start', 'thread/settings/update', 'turn/start'].includes(m.method))).toBe(false);
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('never sends an approval decision or interrupts the owner if an interaction reaches the observer', async () => {
    const h = fixture(); const original = h.process.handler;
    h.process.handler = (m, p) => {
      if (m.method === 'thread/queue/add') p.send({ id: 'owner-approval', method: 'item/commandExecution/requestApproval', params: { threadId: 'thread-1', turnId: 'owner-turn' } });
      original(m, p);
    };
    const result = await runVoiceRequest(h.input, h.options);
    expect(result.status).toBe('completed');
    const response = h.process.messages.find(m => m.id === 'owner-approval');
    expect(response).toMatchObject({ error: { code: -32601 } });
    expect(response).not.toHaveProperty('result');
    expect(h.process.messages.some(m => m.method === 'turn/interrupt')).toBe(false);
  });

  it('keeps queue acceptance pending when the owning writer has not started', async () => {
    const h = fixture(); h.state.queue = [queued]; h.state.turns = [];
    const result = await runVoiceRequest(h.input, h.options);
    expect(result).toMatchObject({ deliveryPending: true });
    expect(h.input.onStarted).not.toHaveBeenCalled();
    expect(h.process.messages.filter(m => m.method === 'thread/queue/add')).toHaveLength(1);
  });

  it('does not enqueue after cancellation during the durable pre-send callback', async () => {
    const h = fixture(); const controller = new AbortController();
    h.input.onBeforeQueue.mockImplementation(() => controller.abort());
    const result = await runVoiceRequest({ ...h.input, signal: controller.signal }, h.options);
    expect(result.recoveryUncertain).toBe(true);
    expect(h.process.messages.some(m => m.method === 'thread/queue/add')).toBe(false);
  });

  it.each(['onBeforeQueue', 'onQueued'] as const)('requires %s durability before entering the queue path', async missing => {
    const h = fixture();
    const result = await runVoiceRequest({ ...h.input, [missing]: undefined }, h.options);
    expect(result.status).toBe('needs_user');
    expect(h.process.messages.some(m => m.method === 'thread/queue/add')).toBe(false);
  });

  it('does not queue a clarification that requires the separate no-work contract', async () => {
    const h = fixture();
    const result = await runVoiceRequest({ ...h.input, routingQuestion: 'Which folder?' }, h.options);
    expect(result.status).toBe('needs_user');
    expect(h.process.messages.some(m => m.method === 'thread/queue/add')).toBe(false);
  });

  it('does not treat arbitrary protocol rejection as an owner conflict', async () => {
    const h = fixture(); const original = h.process.handler;
    h.process.handler = (m, p) => m.method === 'thread/resume'
      ? p.send({ id: m.id, error: { code: -32600, message: 'invalid permission secret' } }) : original(m, p);
    const result = await runVoiceRequest(h.input, h.options);
    expect(result.errorCode).toBe('request_rejected');
    expect(h.process.messages.some(m => m.method === 'thread/queue/add')).toBe(false);
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('keeps an unacknowledged enqueue pending without retrying the mutation', async () => {
    const h = fixture(); const original = h.process.handler;
    h.process.handler = (m, p) => m.method === 'thread/queue/add' ? p.emit('close', 1) : original(m, p);
    const result = await runVoiceRequest(h.input, h.options);
    expect(result.deliveryPending).toBe(true);
    expect(h.process.messages.filter(m => m.method === 'thread/queue/add')).toHaveLength(1);
  });

  it.each(['submitting', 'accepted'] as const)('recovers a %s queue receipt without another enqueue or resume', async state => {
    const h = fixture(); const onStarted = vi.fn();
    const result = await recoverVoiceRequest({ threadId: 'thread-1', workspacePath: os.tmpdir(), dispatchKey: 'receipt-1',
      queueSubmission: { state, ...(state === 'accepted' ? { queuedSubmissionId: 'queue-1' } : {}) }, onStarted }, h.options);
    expect(result).toMatchObject({ status: 'completed', turnId: 'owner-turn' });
    expect(onStarted).toHaveBeenCalledWith({ threadId: 'thread-1', turnId: 'owner-turn' });
    expect(h.process.messages.some(m => ['thread/resume', 'thread/queue/add', 'turn/start'].includes(m.method))).toBe(false);
  });

  it.each(['duplicate-queue', 'duplicate-turn', 'wrong-ack', 'missing'] as const)('does not resend ambiguous %s evidence', async kind => {
    const h = fixture();
    if (kind === 'duplicate-queue') { h.state.queue = [queued, { ...queued, id: 'queue-2' }]; h.state.turns = []; }
    if (kind === 'duplicate-turn') h.state.turns = [completed, { ...completed, id: 'other-turn' }];
    if (kind === 'wrong-ack') { h.state.queue = [{ ...queued, id: 'wrong-queue' }]; h.state.turns = []; }
    if (kind === 'missing') h.state.turns = [];
    const result = await recoverVoiceRequest({ threadId: 'thread-1', workspacePath: os.tmpdir(), dispatchKey: 'receipt-1',
      queueSubmission: { state: 'accepted', queuedSubmissionId: 'queue-1' } }, h.options);
    expect(result.recoveryUncertain).toBe(true);
    expect(h.process.messages.some(m => m.method === 'thread/queue/add')).toBe(false);
  });

  it('rereads the queue across the pending-to-turn snapshot race', async () => {
    const h = fixture(); h.state.queue = [queued]; const original = h.process.handler;
    h.process.handler = (m, p) => { original(m, p); if (m.method === 'thread/turns/list') h.state.queue = []; };
    const result = await runVoiceRequest(h.input, h.options);
    expect(result.status).toBe('completed');
    expect(h.process.messages.filter(m => m.method === 'thread/queue/list')).toHaveLength(2);
  });

  it('waits through a live owner rollout projected as interrupted without completion evidence', async () => {
    const h = fixture(); h.state.turns = [{ ...completed, status: 'interrupted', completedAt: null, items: [completed.items[0]] }];
    const original = h.process.handler; let reads = 0;
    h.process.handler = (m, p) => {
      original(m, p);
      if (m.method === 'thread/turns/list' && ++reads === 2) h.state.turns = [completed];
    };
    const result = await runVoiceRequest(h.input, { ...h.options, turnTimeoutMs: 100 });
    expect(result.status).toBe('completed');
    expect(h.input.onStarted).toHaveBeenCalledTimes(1);
    expect(reads).toBe(3);
  });

  it('follows paginated receipt history to the exact client ID', async () => {
    const h = fixture(); const original = h.process.handler;
    h.process.handler = (m, p) => m.method === 'thread/turns/list' && !m.params.cursor
      ? p.reply(m, { data: [{ id: 'unrelated', items: [] }], nextCursor: 'next' }) : original(m, p);
    const result = await runVoiceRequest(h.input, h.options);
    expect(result.status).toBe('completed');
    expect(h.process.messages.some(m => m.method === 'thread/turns/list' && m.params.cursor === 'next')).toBe(true);
  });
});

it('normalizes actual Codex start timestamps and rejects absent or invalid evidence', () => {
  const iso = '2026-09-09T20:00:00.000Z';
  expect(voiceTurnStartedAt(Date.parse(iso) / 1000)).toBe(iso);
  expect(voiceTurnStartedAt(Date.parse(iso))).toBe(iso);
  expect(voiceTurnStartedAt(iso)).toBe(iso);
  for (const value of [undefined, null, 'invalid', 0, -1, Infinity, Date.now() + 600_000]) {
    expect(voiceTurnStartedAt(value)).toBeUndefined();
  }
});
