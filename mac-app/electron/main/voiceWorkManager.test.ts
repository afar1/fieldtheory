// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { VoiceWorkManager, type VoiceJob, type VoiceWorkManagerOptions } from './voiceWorkManager';
import type { VoiceCodexRequest, VoiceCodexOutcome } from './voiceCodexRunner';
import type { VoiceRoute, VoiceRouteRequest } from './voiceCodexRouter';

const directories: string[] = [];
const managers: VoiceWorkManager[] = [];
afterEach(() => {
  managers.splice(0).forEach((manager) => manager.stop());
  directories.splice(0).forEach((directory) => fs.rmSync(directory, { recursive: true, force: true }));
  vi.useRealTimers();
});

async function settle() {
  for (let i = 0; i < 80; i++) await Promise.resolve();
}

function harness(existingDirectory?: string, folderOptions: Pick<VoiceWorkManagerOptions, 'ensureInboxFolder' | 'selectInboxFolder'> = {}) {
  const directory = existingDirectory ?? fs.mkdtempSync(path.join(os.tmpdir(), 'voice-worker-test-'));
  if (!existingDirectory) directories.push(directory);
  let owner: string | null = 'account-a';
  let push: (() => void) | undefined;
  let subscription: ((status: string) => void) | undefined;
  let enabled = false;
  let generation = 0;
  let failComplete = false;
  const jobs: VoiceJob[] = [];
  const settings = () => ({ schema_version: 1, enabled, generation, enabled_at: new Date().toISOString(), server_now: new Date().toISOString() });
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    let data: unknown = { ok: true };
    if (name === 'voice_delivery_configure') {
      if (enabled !== args.p_enabled) generation++;
      enabled = args.p_enabled as boolean;
      data = settings();
    } else if (name === 'voice_delivery_status') data = settings();
    else if (name === 'voice_jobs_claim') data = {
      settings: settings(), jobs: jobs.splice(0, 1), next_wake_at: null, server_now: new Date().toISOString(),
    };
    if (name === 'voice_jobs_complete' && failComplete) return { data: null, error: { code: 'network' } };
    return { data, error: null };
  });
  const channel = {
    on: vi.fn((_kind: string, _filter: unknown, callback: () => void) => { push = callback; return channel; }),
    subscribe: vi.fn((callback: (status: string) => void) => { subscription = callback; queueMicrotask(() => callback('SUBSCRIBED')); return channel; }),
  };
  const client = {
    rpc, channel: vi.fn(() => channel), removeChannel: vi.fn(async () => 'ok'),
  };
  const outcome: VoiceCodexOutcome = {
    threadId: 'thread-1', turnId: 'turn-1', status: 'completed', summary: 'Done.', finalResponse: 'Verified result.',
  };
  const runRequest = vi.fn(async (request: VoiceCodexRequest) => {
    await request.onThreadStarted?.('thread-1');
    await request.onBeforeDispatch?.({ threadId: 'thread-1', dispatchKey: request.dispatchKey });
    await request.onStarted?.({ threadId: 'thread-1', turnId: 'turn-1' });
    return outcome;
  });
  const recoverRequest = vi.fn(async () => outcome);
  const inspectRuntime = vi.fn(async () => ({ status: 'ready' as const, message: 'Codex is ready.' }));
  const routeRequest = vi.fn(async (input: VoiceRouteRequest): Promise<VoiceRoute> => ({ decision: 'new', workspacePath: input.inboxPath }));
  const onTranscript = vi.fn();
  const onDispatched = vi.fn();
  const manager = new VoiceWorkManager({
    auth: {
      getSession: () => owner ? { user: { id: owner } } : null,
      getSupabaseClient: () => client as unknown as SupabaseClient,
    },
    stateDirectory: directory, runRequest, recoverRequest, inspectRuntime, routeRequest, onTranscript, onDispatched,
    ...folderOptions,
  });
  managers.push(manager);
  const job = (id = 'job-1'): VoiceJob => ({
    job_id: id, user_id: 'account-a', generation: 1, transcript_id: 'transcript-1', text: 'Write a short poem.',
    previous_text: null, previous_thread_id: null, thread_id: null, dispatch_started_at: null, dispatch_key: `voice:${id}`,
    lease_token: 'lease-1', lease_expires_at: new Date(Date.now() + 90_000).toISOString(),
  });
  return {
    manager, directory, client, rpc, jobs, runRequest, recoverRequest, inspectRuntime, routeRequest, onTranscript, onDispatched, job,
    push: () => push?.(), subscribed: () => subscription?.('SUBSCRIBED'), connectionError: () => subscription?.('CHANNEL_ERROR'),
    setOwner: (next: string | null) => { owner = next; },
    setServer: (value: boolean, nextGeneration: number) => { enabled = value; generation = nextGeneration; },
    setFailComplete: (value: boolean) => { failComplete = value; },
    async enable() {
      await manager.authChanged();
      await manager.updateSettings({ workspacePath: directory });
      await manager.updateSettings({ enabled: true });
      await settle();
    },
  };
}

describe('bundled Voice push worker', () => {
  it('does not subscribe or fetch jobs until explicitly enabled', async () => {
    const h = harness();
    await h.manager.authChanged();
    expect(h.client.channel).not.toHaveBeenCalled();
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.manager.getState().settings.enabled).toBe(false);
  });

  it('subscribes privately, catches up once, then remains idle without periodic discovery', async () => {
    vi.useFakeTimers();
    const h = harness();
    await h.enable();
    await vi.runAllTicks(); await settle();
    expect(h.client.channel).toHaveBeenCalledWith('voice-jobs:account-a', { config: { private: true } });
    const claims = h.rpc.mock.calls.filter(([name]) => name === 'voice_jobs_claim').length;
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(h.rpc.mock.calls.filter(([name]) => name === 'voice_jobs_claim')).toHaveLength(claims);
    expect(h.manager.getState().status).toBe('ready');
  });

  it('persists thread ownership before dispatch and records verified completion', async () => {
    const h = harness(); await h.enable();
    h.jobs.push(h.job()); h.push(); await settle();
    expect(h.runRequest).toHaveBeenCalledTimes(1);
    const names = h.rpc.mock.calls.map(([name]) => name);
    expect(names.indexOf('voice_jobs_record_dispatch')).toBeLessThan(names.indexOf('voice_jobs_begin_dispatch'));
    expect(names.indexOf('voice_jobs_begin_dispatch')).toBeLessThan(names.indexOf('voice_jobs_complete'));
    const persisted = JSON.parse(fs.readFileSync(path.join(h.directory, 'account-a.json'), 'utf8'));
    expect(persisted.attempts['job-1']).toMatchObject({ threadId: 'thread-1', turnId: 'turn-1', published: true });
    expect(h.manager.getState().lastTask).toMatchObject({ threadId: 'thread-1', status: 'completed' });
  });

  it('does not repeat work for a duplicate delivered job', async () => {
    const h = harness(); await h.enable();
    h.jobs.push(h.job()); h.push(); await settle();
    h.jobs.push(h.job()); h.push(); await settle();
    expect(h.runRequest).toHaveBeenCalledTimes(1);
  });

  it('saves context without dispatching a task or inventing a sent receipt', async () => {
    const h = harness(); await h.enable();
    h.routeRequest.mockResolvedValueOnce({ decision: 'context', workspacePath: h.directory });
    h.jobs.push({ ...h.job(), text: 'Just context. Do not do anything yet.' }); h.push(); await settle();
    expect(h.onTranscript).toHaveBeenCalledTimes(1);
    expect(h.runRequest).not.toHaveBeenCalled();
    expect(h.onDispatched).not.toHaveBeenCalled();
    expect(h.manager.getState().lastTask).toBeUndefined();
    expect(h.rpc).toHaveBeenCalledWith('voice_jobs_complete', expect.objectContaining({ p_status: 'context' }));
  });

  it('persists the chosen project before dispatch instead of using the Inbox for every request', async () => {
    const h = harness(); await h.enable();
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-project-')); directories.push(projectPath);
    const route: VoiceRoute = { decision: 'new', workspacePath: projectPath, projectId: 'project-1', title: 'Field Theory - Improve Voice' };
    h.routeRequest.mockResolvedValueOnce(route);
    h.runRequest.mockImplementationOnce(async (request) => {
      const saved = JSON.parse(fs.readFileSync(path.join(h.directory, 'account-a.json'), 'utf8'));
      expect(saved.attempts['job-1'].route).toEqual(route);
      expect(request).toMatchObject({ workspacePath: projectPath, projectId: 'project-1', title: route.title });
      return { status: 'completed', summary: 'Done.', finalResponse: 'Done.' };
    });
    h.jobs.push(h.job()); h.push(); await settle();
    expect(h.runRequest).toHaveBeenCalledTimes(1);
    expect(h.manager.getState().settings.workspacePath).toBe(h.directory);
  });

  it('asks an ambiguous routing question in a read-only task', async () => {
    const h = harness(); await h.enable();
    h.routeRequest.mockResolvedValueOnce({ decision: 'ask', workspacePath: h.directory, question: 'Which project should I update?' });
    h.jobs.push(h.job()); h.push(); await settle();
    expect(h.runRequest).toHaveBeenCalledWith(expect.objectContaining({
      sandboxMode: 'read-only', routingQuestion: 'Which project should I update?',
    }));
  });

  it('records a link only after the actual turn starts and exposes it immediately', async () => {
    const h = harness(); await h.enable();
    const threadId = '01a07e3f-8d87-7a43-a7a5-f90f1b67d4d3';
    let finish!: (outcome: VoiceCodexOutcome) => void;
    h.runRequest.mockImplementationOnce(async (request) => {
      await request.onThreadStarted?.(threadId);
      await request.onBeforeDispatch?.({ threadId, dispatchKey: request.dispatchKey });
      expect(h.onDispatched).not.toHaveBeenCalled();
      expect(h.manager.canOpenTask(threadId)).toBe(false);
      await request.onStarted?.({ threadId, turnId: 'turn-1' });
      return new Promise((resolve) => { finish = resolve; });
    });
    h.jobs.push(h.job()); h.push(); await settle();
    expect(h.onDispatched).toHaveBeenCalledWith(expect.objectContaining({ job_id: 'job-1', transcript_id: 'transcript-1' }), { threadId, turnId: 'turn-1' });
    expect(h.manager.canOpenTask(threadId)).toBe(true);
    expect(h.manager.getState().status).toBe('working');
    finish({ threadId, turnId: 'turn-1', status: 'completed', summary: 'Done.', finalResponse: 'Done.' }); await settle();
  });

  it('does not dispatch a routing answer that arrives after an account switch', async () => {
    const h = harness(); await h.enable();
    let routed!: (route: VoiceRoute) => void;
    h.routeRequest.mockImplementationOnce(() => new Promise((resolve) => { routed = resolve; }));
    h.jobs.push(h.job()); h.push(); await settle();
    h.setOwner('account-b'); await h.manager.authChanged();
    routed({ decision: 'new', workspacePath: h.directory }); await settle();
    expect(h.runRequest).not.toHaveBeenCalled();
    expect(h.onDispatched).not.toHaveBeenCalled();
    expect(h.manager.getState().lastTask).toBeUndefined();
  });

  it('recovers in the persisted destination without choosing or dispatching again', async () => {
    const h = harness(); await h.enable(); h.manager.stop();
    const file = path.join(h.directory, 'account-a.json');
    const snapshot = JSON.parse(fs.readFileSync(file, 'utf8'));
    snapshot.attempts['job-1'] = {
      leaseToken: 'old-lease', threadId: 'existing-thread', dispatchStarted: true,
      route: { decision: 'continue', workspacePath: os.tmpdir(), threadId: 'existing-thread' },
    };
    fs.writeFileSync(file, JSON.stringify(snapshot));
    const restarted = harness(h.directory); restarted.setServer(true, 1);
    restarted.jobs.push(h.job()); await restarted.manager.authChanged(); await settle();
    expect(restarted.routeRequest).not.toHaveBeenCalled();
    expect(restarted.runRequest).not.toHaveBeenCalled();
    expect(restarted.recoverRequest).toHaveBeenCalledWith(expect.objectContaining({ workspacePath: os.tmpdir(), threadId: 'existing-thread' }));
  });

  it('follows a renamed Inbox before routing a newly pushed request', async () => {
    let resolved: string | undefined;
    const ensureInboxFolder = vi.fn((_owner: string, saved: string | null) => resolved ?? saved ?? os.tmpdir());
    const h = harness(undefined, { ensureInboxFolder }); await h.enable();
    resolved = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-renamed-')); directories.push(resolved);
    h.jobs.push(h.job()); h.push(); await settle();
    expect(h.routeRequest).toHaveBeenCalledWith(expect.objectContaining({ inboxPath: resolved }));
    expect(h.manager.getState().settings.workspacePath).toBe(resolved);
    expect(h.manager.getState().settings.enabled).toBe(true);
  });

  it('keeps a missing saved folder visible and starts no work until the user replaces it', async () => {
    const h = harness(); await h.enable(); h.manager.stop();
    const restarted = harness(h.directory, { ensureInboxFolder: () => { throw new Error('Selected folder is unavailable.'); } });
    await restarted.manager.authChanged();
    expect(restarted.manager.getState()).toMatchObject({ status: 'error', settings: { workspacePath: h.directory } });
    expect(restarted.runRequest).not.toHaveBeenCalled();
    expect(restarted.client.channel).not.toHaveBeenCalled();
  });

  it('reconciles a prior thread without sending the request again', async () => {
    const h = harness(); await h.enable();
    h.jobs.push({ ...h.job(), thread_id: 'existing-thread', dispatch_started_at: new Date().toISOString() }); h.push(); await settle();
    expect(h.runRequest).not.toHaveBeenCalled();
    expect(h.recoverRequest).toHaveBeenCalledWith(expect.objectContaining({ threadId: 'existing-thread', dispatchKey: 'voice:job-1' }));
  });

  it('keeps Working truthful until the runtime emits turn started', async () => {
    const h = harness(); await h.enable();
    let finish: ((value: VoiceCodexOutcome) => void) | undefined;
    h.runRequest.mockImplementationOnce(async (request) => {
      await request.onThreadStarted?.('thread-1');
      await request.onBeforeDispatch?.({ threadId: 'thread-1', dispatchKey: request.dispatchKey });
      return await new Promise((resolve) => { finish = resolve; });
    });
    h.jobs.push(h.job()); h.push(); await settle();
    expect(h.manager.getState().status).not.toBe('working');
    finish?.({ threadId: 'thread-1', status: 'completed', summary: 'Done.', finalResponse: 'Done.' });
    await settle();
  });

  it('fences late callbacks after an account switch and hides the previous account result', async () => {
    const h = harness(); await h.enable();
    let request: VoiceCodexRequest | undefined;
    let finish: ((value: VoiceCodexOutcome) => void) | undefined;
    h.runRequest.mockImplementationOnce(async (input) => {
      request = input;
      return await new Promise((resolve) => { finish = resolve; });
    });
    h.jobs.push(h.job()); h.push(); await settle();
    h.setOwner('account-b'); await h.manager.authChanged();
    await expect(request!.onThreadStarted!('late-thread')).rejects.toThrow('session changed');
    expect(request!.signal?.aborted).toBe(true);
    finish?.({ threadId: 'late-thread', status: 'completed', summary: 'Private.', finalResponse: 'Private.' });
    await settle();
    expect(h.manager.getState().lastTask).toBeUndefined();
    expect(h.rpc.mock.calls.some(([name]) => name === 'voice_jobs_record_dispatch')).toBe(false);
  });

  it('stops active work when another Mac changes the server generation', async () => {
    const h = harness(); await h.enable();
    let input: VoiceCodexRequest | undefined;
    let finish: ((value: VoiceCodexOutcome) => void) | undefined;
    h.runRequest.mockImplementationOnce(async (request) => {
      input = request;
      return await new Promise((resolve) => { finish = resolve; });
    });
    h.jobs.push(h.job()); h.push(); await settle();
    h.setServer(false, 2); h.push(); await settle();
    expect(input!.signal?.aborted).toBe(true);
    expect(h.manager.getState().settings.enabled).toBe(false);
    finish?.({ status: 'interrupted', summary: 'Stopped.', finalResponse: '' }); await settle();
  });

  it('requires pausing before the granted folder can change', async () => {
    const h = harness(); await h.enable();
    await expect(h.manager.updateSettings({ workspacePath: os.tmpdir() })).rejects.toThrow('Pause');
    expect(h.manager.getState().settings.workspacePath).toBe(h.directory);
  });

  it('retains a completed result through a failed receipt write and restart without rerunning it', async () => {
    const h = harness(); await h.enable();
    h.setFailComplete(true); h.jobs.push(h.job()); h.push(); await settle();
    expect(h.manager.getState().lastTask?.status).toBe('completed');
    h.manager.stop();
    const restarted = harness(h.directory); restarted.setServer(true, 1);
    await restarted.manager.authChanged(); await settle();
    expect(restarted.runRequest).not.toHaveBeenCalled();
    expect(restarted.rpc.mock.calls.some(([name]) => name === 'voice_jobs_complete')).toBe(true);
    const persisted = JSON.parse(fs.readFileSync(path.join(h.directory, 'account-a.json'), 'utf8'));
    expect(persisted.attempts['job-1'].published).toBe(true);
  });

  it('keeps a rejected disable locally paused and persists the pending remote pause', async () => {
    const h = harness(); await h.enable();
    h.rpc.mockImplementationOnce(async () => ({ data: null, error: { code: 'offline' } }));
    await h.manager.updateSettings({ enabled: false });
    expect(h.manager.getState().settings.enabled).toBe(false);
    const saved = JSON.parse(fs.readFileSync(path.join(h.directory, 'account-a.json'), 'utf8'));
    expect(saved.pendingDisable).toBe(true);
    expect(h.manager.getState().message).toContain('other Macs');
  });

  it('retries a lost pause response idempotently from Check again', async () => {
    const h = harness(); await h.enable();
    h.rpc.mockImplementationOnce(async () => ({ data: null, error: { code: 'offline' } }));
    await h.manager.updateSettings({ enabled: false });
    h.rpc.mockImplementationOnce(async () => ({ data: { enabled: false, generation: 2, applied: false }, error: null }));
    await h.manager.refreshStatus();
    expect(JSON.parse(fs.readFileSync(path.join(h.directory, 'account-a.json'), 'utf8')).pendingDisable).toBe(false);
    expect(h.manager.getState().settings.enabled).toBe(false);
  });

  it('waits for private subscription before enabling on the server', async () => {
    const h = harness();
    await h.manager.authChanged();
    await h.manager.updateSettings({ workspacePath: h.directory });
    let joined!: (status: string) => void;
    const channel = h.client.channel();
    channel.subscribe.mockImplementationOnce((callback) => { joined = callback; return channel; });
    const enabling = h.manager.updateSettings({ enabled: true });
    await settle();
    expect(h.rpc).not.toHaveBeenCalled();
    joined('SUBSCRIBED'); await enabling; await settle();
    expect(h.rpc.mock.calls[0]).toEqual(['voice_delivery_configure', expect.objectContaining({ p_enabled: true, p_sequence: 1 })]);
  });

  it('keeps a newer pause authoritative while an enable response is delayed', async () => {
    const h = harness();
    await h.manager.authChanged(); await h.manager.updateSettings({ workspacePath: h.directory });
    let resolveEnable!: (response: { data: unknown; error: null }) => void;
    h.rpc.mockImplementationOnce(async () => new Promise((resolve) => { resolveEnable = resolve; }));
    const enabling = h.manager.updateSettings({ enabled: true }).catch((error: Error) => error);
    await settle();
    const pausing = h.manager.updateSettings({ enabled: false });
    expect(h.manager.getState().settings.enabled).toBe(false);
    resolveEnable({ data: { enabled: true, generation: 1 }, error: null });
    await enabling; await pausing;
    expect(h.rpc.mock.calls.filter(([name]) => name === 'voice_delivery_configure').map(([, args]) => [args.p_enabled, args.p_sequence])).toEqual([[true, 1], [false, 2]]);
    expect(h.manager.getState().settings.enabled).toBe(false);
  });

  it('reconnects a failed subscription through Check again and catches up', async () => {
    const h = harness(); await h.enable();
    h.connectionError(); h.jobs.push(h.job());
    await h.manager.refreshStatus(); await settle();
    expect(h.client.channel).toHaveBeenCalledTimes(2);
    expect(h.runRequest).toHaveBeenCalledTimes(1);
  });

  it('resumes a recorded thread safely if the dispatch boundary was never crossed', async () => {
    const h = harness(); await h.enable();
    h.jobs.push({ ...h.job(), thread_id: 'recorded-thread' }); h.push(); await settle();
    expect(h.recoverRequest).not.toHaveBeenCalled();
    expect(h.runRequest).toHaveBeenCalledWith(expect.objectContaining({ threadId: 'recorded-thread' }));
  });

  it('publishes uncertain recovery as needing attention and preserves the actual question', async () => {
    const h = harness(); await h.enable();
    h.recoverRequest.mockResolvedValueOnce({ threadId: 'existing-thread', status: 'failed', summary: 'Could not recover.', finalResponse: '', question: 'Has this task already finished?', recoveryUncertain: true });
    h.jobs.push({ ...h.job(), thread_id: 'existing-thread', dispatch_started_at: new Date().toISOString() }); h.push(); await settle();
    expect(h.rpc).toHaveBeenCalledWith('voice_jobs_complete', expect.objectContaining({ p_status: 'needs_user', p_result: expect.objectContaining({ recovery_uncertain: true }) }));
    expect(h.manager.getState().lastTask?.question).toBe('Has this task already finished?');
  });

  it('bounds a large server receipt while retaining the full response locally', async () => {
    const h = harness(); await h.enable();
    const answer = '\u0000🙂'.repeat(30_000);
    h.runRequest.mockResolvedValueOnce({ threadId: 'thread-1', status: 'completed', summary: 'x'.repeat(9_000), finalResponse: answer });
    h.jobs.push(h.job()); h.push(); await settle();
    const receipt = h.rpc.mock.calls.find(([name]) => name === 'voice_jobs_complete')![1];
    expect(Buffer.byteLength(JSON.stringify(receipt.p_result), 'utf8')).toBeLessThan(65_536);
    expect(receipt.p_result).toMatchObject({ response_truncated: true });
    expect(JSON.stringify(receipt.p_result)).not.toContain('\\u0000');
    expect(JSON.stringify(receipt.p_result)).not.toMatch(/\\ud[89ab][0-9a-f]{2}(?!\\ud[cdef][0-9a-f]{2})/i);
    expect((receipt.p_summary as string).length).toBeLessThanOrEqual(8_000);
    expect(h.manager.getState().lastTask?.finalResponse).toBe(answer);
  });

  it('stops draining on expired Codex sign-in until a readiness check', async () => {
    const h = harness(); await h.enable();
    h.runRequest.mockResolvedValueOnce({ status: 'failed', summary: 'Sign in.', finalResponse: '', errorCode: 'sign_in_required' });
    h.jobs.push(h.job(), h.job('job-2')); h.push(); await settle();
    expect(h.runRequest).toHaveBeenCalledTimes(1);
    expect(h.manager.getState()).toMatchObject({ status: 'needs_setup', codex: { signedIn: false } });
    expect(h.jobs).toHaveLength(1);
  });
});
