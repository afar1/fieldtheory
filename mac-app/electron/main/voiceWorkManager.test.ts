// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { VoiceWorkManager, type VoiceJob } from './voiceWorkManager';
import type { VoiceCodexRequest, VoiceCodexOutcome } from './voiceCodexRunner';

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

function harness(existingDirectory?: string) {
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
  const manager = new VoiceWorkManager({
    auth: {
      getSession: () => owner ? { user: { id: owner } } : null,
      getSupabaseClient: () => client as unknown as SupabaseClient,
    },
    stateDirectory: directory, runRequest, recoverRequest, inspectRuntime,
  });
  managers.push(manager);
  const job = (id = 'job-1'): VoiceJob => ({
    job_id: id, user_id: 'account-a', generation: 1, transcript_id: 'transcript-1', text: 'Write a short poem.',
    previous_text: null, previous_thread_id: null, thread_id: null, dispatch_started_at: null, dispatch_key: `voice:${id}`,
    lease_token: 'lease-1', lease_expires_at: new Date(Date.now() + 90_000).toISOString(),
  });
  return {
    manager, directory, client, rpc, jobs, runRequest, recoverRequest, inspectRuntime, job,
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
