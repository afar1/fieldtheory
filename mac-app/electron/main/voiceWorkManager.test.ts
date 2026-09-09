// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { VoiceWorkManager, type VoiceJob, type VoiceWorkManagerOptions } from './voiceWorkManager';
import type { VoiceCodexRequest, VoiceCodexRecoveryRequest, VoiceCodexOutcome, VoiceCodexRuntimeStatus } from './voiceCodexRunner';
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

function harness(existingDirectory?: string, folderOptions: Pick<VoiceWorkManagerOptions, 'ensureInboxFolder' | 'selectInboxFolder' | 'refreshRouteWorkspace'> = {}) {
  const directory = existingDirectory ?? fs.mkdtempSync(path.join(os.tmpdir(), 'voice-worker-test-'));
  if (!existingDirectory) directories.push(directory);
  let owner: string | null = 'account-a';
  let push: (() => void) | undefined;
  let subscription: ((status: string) => void) | undefined;
  let enabled = false;
  let generation = 0;
  let failComplete = false;
  let failClaim = false;
  const jobs: VoiceJob[] = [];
  const settings = () => ({ schema_version: 1, enabled, generation, enabled_at: new Date().toISOString(), server_now: new Date().toISOString() });
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === 'voice_jobs_claim' && failClaim) return { data: null, error: { code: 'network' } };
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
  const recoverRequest = vi.fn(async (_request: VoiceCodexRecoveryRequest) => outcome);
  const inspectRuntime = vi.fn<() => Promise<VoiceCodexRuntimeStatus>>(async () => ({ status: 'ready', message: 'Codex is ready.' }));
  const routeRequest = vi.fn(async (input: VoiceRouteRequest): Promise<VoiceRoute> => ({ decision: 'new', workspacePath: input.inboxPath }));
  const writeInboxReceipt = vi.fn(async () => {});
  const onTranscript = vi.fn();
  const onDispatched = vi.fn();
  const manager = new VoiceWorkManager({
    auth: {
      getSession: () => owner ? { user: { id: owner } } : null,
      getSupabaseClient: () => client as unknown as SupabaseClient,
    },
    stateDirectory: directory, runRequest, recoverRequest, inspectRuntime, routeRequest, writeInboxReceipt, onTranscript, onDispatched,
    ...folderOptions,
  });
  managers.push(manager);
  const job = (id = 'job-1'): VoiceJob => ({
    job_id: id, user_id: 'account-a', generation: 1, transcript_id: 'transcript-1', text: 'Write a short poem.',
    previous_text: null, previous_thread_id: null, thread_id: null, dispatch_started_at: null, dispatch_key: `voice:${id}`,
    lease_token: 'lease-1', lease_expires_at: new Date(Date.now() + 90_000).toISOString(),
  });
  return {
    manager, directory, client, rpc, jobs, runRequest, recoverRequest, inspectRuntime, routeRequest, writeInboxReceipt, onTranscript, onDispatched, job,
    push: () => push?.(), subscribed: () => subscription?.('SUBSCRIBED'), connectionError: () => subscription?.('CHANNEL_ERROR'),
    setOwner: (next: string | null) => { owner = next; },
    setServer: (value: boolean, nextGeneration: number) => { enabled = value; generation = nextGeneration; },
    setFailComplete: (value: boolean) => { failComplete = value; },
    setFailClaim: (value: boolean) => { failClaim = value; },
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

  it('preserves repeated rename lineage only for confirmed same-account projectless Voice creations', async () => {
    const h = harness(); await h.enable(); h.manager.stop();
    const file = path.join(h.directory, 'account-a.json');
    const snapshot = JSON.parse(fs.readFileSync(file, 'utf8'));
    const proven = { leaseToken: 'old', threadId: 'proven-thread', turnId: 'proven-turn', dispatchStarted: true,
      route: { decision: 'new', workspacePath: path.join(h.directory, 'old-inbox') } };
    snapshot.attempts = {
      proven,
      firstRename: { ...proven, route: { decision: 'continue', threadId: 'proven-thread', workspacePath: path.join(h.directory, 'renamed-inbox') } },
      unstarted: { ...proven, threadId: 'unstarted', dispatchStarted: false },
      unconfirmed: { ...proven, threadId: 'unconfirmed', turnId: undefined },
      project: { ...proven, threadId: 'project', route: { ...proven.route, projectId: 'project-1' } },
      continued: { ...proven, threadId: 'continued', route: { ...proven.route, decision: 'continue' } },
      relative: { ...proven, threadId: 'relative', route: { ...proven.route, workspacePath: 'relative' } },
    };
    fs.writeFileSync(file, JSON.stringify(snapshot));
    fs.writeFileSync(path.join(h.directory, 'account-b.json'), JSON.stringify({ ...snapshot, owner: 'account-b',
      attempts: { other: { ...proven, threadId: 'other-account-thread' } } }));
    const restarted = harness(h.directory); restarted.setServer(true, 1);
    restarted.jobs.push(h.job('new-job')); await restarted.manager.authChanged(); await settle();
    expect(restarted.routeRequest).toHaveBeenCalledWith(expect.objectContaining({ projectlessVoiceTasks: [
      { threadId: 'proven-thread', workspacePath: path.join(h.directory, 'old-inbox') },
      { threadId: 'proven-thread', workspacePath: path.join(h.directory, 'renamed-inbox') },
    ] }));
  });

  it.each([false, true])('repairs a cached route after folder rename without rerouting (dispatched=%s)', async (dispatched) => {
    const h = harness(); await h.enable(); h.manager.stop();
    const file = path.join(h.directory, 'account-a.json');
    const snapshot = JSON.parse(fs.readFileSync(file, 'utf8'));
    const oldPath = path.join(h.directory, 'missing-old-inbox');
    snapshot.attempts['job-1'] = { leaseToken: 'old', threadId: 'existing-thread',
      ...(dispatched ? { dispatchStarted: true, turnId: 'old-turn' } : {}),
      route: { decision: 'new', workspacePath: oldPath } };
    fs.writeFileSync(file, JSON.stringify(snapshot));
    const refreshRouteWorkspace = vi.fn<NonNullable<VoiceWorkManagerOptions['refreshRouteWorkspace']>>(async route => ({ ...route, workspacePath: h.directory }));
    const restarted = harness(h.directory, { refreshRouteWorkspace }); restarted.setServer(true, 1);
    restarted.jobs.push(h.job()); await restarted.manager.authChanged(); await settle();
    expect(restarted.routeRequest).not.toHaveBeenCalled();
    expect(refreshRouteWorkspace).toHaveBeenCalledWith(expect.objectContaining({ workspacePath: oldPath }),
      expect.objectContaining({ threadId: 'existing-thread', inboxPath: h.directory }));
    if (dispatched) {
      expect(restarted.runRequest).not.toHaveBeenCalled();
      expect(restarted.recoverRequest).toHaveBeenCalledWith(expect.objectContaining({ threadId: 'existing-thread', workspacePath: h.directory }));
    } else {
      expect(restarted.recoverRequest).not.toHaveBeenCalled();
      expect(restarted.runRequest).toHaveBeenCalledWith(expect.objectContaining({ threadId: 'existing-thread', workspacePath: h.directory }));
    }
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).attempts['job-1'].route.workspacePath).toBe(h.directory);
  });

  it.each([{ decision: 'new', dispatched: false }, { decision: 'new', dispatched: true },
    { decision: 'ask', dispatched: false }, { decision: 'ask', dispatched: true }] as const)
  ('keeps original cwd evidence across two repairs before Codex updates cwd ($decision, dispatched=$dispatched)', async ({ decision, dispatched }) => {
    const h = harness(); await h.enable(); h.manager.stop();
    const file = path.join(h.directory, 'account-a.json');
    const original = path.join(h.directory, 'Inbox A');
    const second = path.join(h.directory, 'Inbox B');
    const third = path.join(h.directory, 'Inbox C');
    fs.mkdirSync(second);
    const snapshot = JSON.parse(fs.readFileSync(file, 'utf8'));
    snapshot.settings.workspacePath = second;
    snapshot.attempts['job-1'] = { leaseToken: 'old', threadId: 'existing-thread',
      ...(dispatched ? { dispatchStarted: true, turnId: 'old-turn' } : {}),
      route: { decision, workspacePath: original } };
    fs.writeFileSync(file, JSON.stringify(snapshot));
    const refreshRouteWorkspace = vi.fn<NonNullable<VoiceWorkManagerOptions['refreshRouteWorkspace']>>(async (route, input) => {
      // Codex still reports cwd A throughout both recoveries; B never reached thread/resume.
      expect(input.projectlessVoiceTasks).toContainEqual({ threadId: 'existing-thread', workspacePath: original });
      return { ...route, workspacePath: input.inboxPath };
    });
    const first = harness(h.directory, { refreshRouteWorkspace }); first.setServer(true, 1);
    first.runRequest.mockRejectedValueOnce(new Error('Stopped before thread resume'));
    first.recoverRequest.mockRejectedValueOnce(new Error('Recovery transport unavailable'));
    first.jobs.push(h.job()); await first.manager.authChanged(); await settle(); first.manager.stop();
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).attempts['job-1'].route.workspacePath).toBe(second);
    fs.renameSync(second, third);
    const next = harness(h.directory, { refreshRouteWorkspace, ensureInboxFolder: () => third }); next.setServer(true, 1);
    next.jobs.push(h.job()); await next.manager.authChanged(); await settle();
    expect(refreshRouteWorkspace).toHaveBeenCalledTimes(2);
    expect(next.routeRequest).not.toHaveBeenCalled();
    expect(dispatched ? next.recoverRequest : next.runRequest).toHaveBeenCalledWith(expect.objectContaining({ workspacePath: third }));
    if (dispatched) expect(next.runRequest).not.toHaveBeenCalled();
    const saved = JSON.parse(fs.readFileSync(file, 'utf8')).attempts['job-1'];
    expect(saved.workspaceHistory).toContainEqual({ threadId: 'existing-thread', workspacePath: original });
    expect(saved.workspaceHistory).toContainEqual({ threadId: 'existing-thread', workspacePath: second });
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

  it('automatically reconnects after a transport failure and catches up without periodic scans', async () => {
    vi.useFakeTimers();
    const h = harness(); await h.enable();
    h.connectionError(); h.jobs.push(h.job());
    await vi.advanceTimersByTimeAsync(1_000); await settle();
    expect(h.client.channel).toHaveBeenCalledTimes(2);
    expect(h.runRequest).toHaveBeenCalledTimes(1);
    const claims = h.rpc.mock.calls.filter(([name]) => name === 'voice_jobs_claim').length;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(h.rpc.mock.calls.filter(([name]) => name === 'voice_jobs_claim')).toHaveLength(claims);
  });

  it('backs off across a long outage, recovers automatically, and cancels recovery while suspended', async () => {
    vi.useFakeTimers();
    const h = harness(); await h.enable();
    const channel = h.client.channel.mock.results[0].value;
    channel.subscribe.mockImplementation((callback: (status: string) => void) => { queueMicrotask(() => callback('CHANNEL_ERROR')); return channel; });
    h.connectionError();
    await vi.advanceTimersByTimeAsync(300_000); await settle();
    expect(channel.subscribe).toHaveBeenCalledTimes(9);
    expect(h.manager.getState().status).toBe('connecting');
    channel.subscribe.mockImplementation((callback: (status: string) => void) => { queueMicrotask(() => callback('SUBSCRIBED')); return channel; });
    h.jobs.push(h.job());
    await vi.advanceTimersByTimeAsync(60_000); await settle();
    expect(channel.subscribe).toHaveBeenCalledTimes(10);
    expect(h.runRequest).toHaveBeenCalledTimes(1);
    h.connectionError(); h.manager.stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(channel.subscribe).toHaveBeenCalledTimes(10);
  });

  it.each(['internal_tool_request', 'secret-code-do-not-store'])('retains only sanitized routing diagnostics for %s', async (code) => {
    const h = harness(); await h.enable();
    h.routeRequest.mockRejectedValueOnce(Object.assign(new Error('secret transcript and credential'), { code }));
    h.jobs.push(h.job()); h.push(); await settle();
    const diagnostic = { stage: 'routing', code: code === 'internal_tool_request' ? code : 'routing_failed' };
    const serialized = fs.readFileSync(path.join(h.directory, 'account-a.json'), 'utf8');
    expect(JSON.parse(serialized).attempts['job-1'].failure).toEqual(diagnostic);
    expect(serialized).not.toContain('secret');
    expect(h.manager.getState().message).toBe('Voice could not find the destination for this request. Your request remains saved.');
    expect(JSON.stringify(h.manager.getState())).not.toContain('secret');
    expect(h.runRequest).not.toHaveBeenCalled();
    expect(h.rpc.mock.calls.some(([name]) => name === 'voice_jobs_complete')).toBe(false);
  });

  it('recovers an RPC outage without another broadcast and does not replay finished dispatch', async () => {
    vi.useFakeTimers();
    const h = harness(); await h.enable();
    h.jobs.push(h.job()); h.push(); await settle();
    expect(h.runRequest).toHaveBeenCalledTimes(1);
    h.setFailClaim(true); h.jobs.push(h.job()); h.push(); await settle();
    await vi.advanceTimersByTimeAsync(300_000); await settle();
    expect(h.manager.getState().status).toBe('error');
    expect(h.runRequest).toHaveBeenCalledTimes(1);
    h.setFailClaim(false);
    await vi.advanceTimersByTimeAsync(60_000); await settle();
    expect(h.manager.getState().status).toBe('ready');
    expect(h.runRequest).toHaveBeenCalledTimes(1);
    expect(h.recoverRequest).not.toHaveBeenCalled();
    const calls = h.rpc.mock.calls.length;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(h.rpc).toHaveBeenCalledTimes(calls);
  });

  it('retries a temporarily unavailable Codex runtime but waits for invalid sign-in setup', async () => {
    vi.useFakeTimers();
    const h = harness(); await h.enable();
    h.inspectRuntime.mockResolvedValueOnce({ status: 'unavailable', message: 'Temporarily unavailable.' });
    await h.manager.resume();
    expect(h.manager.getState().status).toBe('connecting');
    const inspections = h.inspectRuntime.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1_000); await settle();
    expect(h.inspectRuntime).toHaveBeenCalledTimes(inspections + 1);
    h.inspectRuntime.mockResolvedValue({ status: 'sign_in_required', message: 'Sign in.' });
    await h.manager.resume();
    const stoppedAt = h.inspectRuntime.mock.calls.length;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(h.inspectRuntime).toHaveBeenCalledTimes(stoppedAt);
    expect(h.manager.getState().status).toBe('needs_setup');
  });

  it('repairs an unsubscribed channel when the auth owner refreshes without changing accounts', async () => {
    const h = harness(); await h.enable();
    h.connectionError();
    await h.manager.authChanged(); await settle();
    expect(h.client.channel).toHaveBeenCalledTimes(2);
  });

  it('resumes a recorded thread safely if the dispatch boundary was never crossed', async () => {
    const h = harness(); await h.enable();
    h.jobs.push({ ...h.job(), thread_id: 'recorded-thread' }); h.push(); await settle();
    expect(h.recoverRequest).not.toHaveBeenCalled();
    expect(h.runRequest).toHaveBeenCalledWith(expect.objectContaining({ threadId: 'recorded-thread' }));
  });

  it('persists queue acceptance without completing or claiming a task has started, then recovers without resending', async () => {
    const h = harness(); await h.enable();
    const read = () => JSON.parse(fs.readFileSync(path.join(h.directory, 'account-a.json'), 'utf8')).attempts['job-1'];
    h.runRequest.mockImplementationOnce(async request => {
      await request.onThreadStarted?.('thread-1');
      await request.onBeforeQueue?.({ threadId: 'thread-1' });
      expect(read()).toMatchObject({ dispatchStarted: true, queueSubmission: { state: 'submitting' } });
      await request.onQueued?.({ threadId: 'thread-1', queuedSubmissionId: 'queue-1' });
      expect(read()).toMatchObject({ queueSubmission: { state: 'accepted', queuedSubmissionId: 'queue-1' } });
      return { status: 'interrupted', summary: 'Queued in Codex.', finalResponse: '', deliveryPending: true };
    });
    h.jobs.push(h.job()); h.push(); await settle();
    expect(read().outcome).toBeUndefined();
    expect(h.onDispatched).not.toHaveBeenCalled();
    expect(h.rpc.mock.calls.some(([name]) => name === 'voice_jobs_complete')).toBe(false);
    expect(h.manager.getState().lastTask?.status).toBe('queued');
    h.recoverRequest.mockImplementationOnce(async request => {
      expect(request.queueSubmission).toEqual({ state: 'accepted', queuedSubmissionId: 'queue-1' });
      await request.onStarted?.({ threadId: 'thread-1', turnId: 'turn-1' });
      await request.onStarted?.({ threadId: 'thread-1', turnId: 'turn-1' });
      return { threadId: 'thread-1', turnId: 'turn-1', status: 'completed', summary: 'Done.', finalResponse: 'Result.' };
    });
    h.jobs.push(h.job()); h.push(); await settle();
    expect(h.runRequest).toHaveBeenCalledTimes(1);
    expect(h.recoverRequest).toHaveBeenCalledTimes(1);
    expect(h.onDispatched).toHaveBeenCalledTimes(1);
    expect(read()).toMatchObject({ turnId: 'turn-1', published: true });
  });

  it('recovers an uncertain pre-acknowledgment queue submission after restart without another enqueue', async () => {
    const h = harness(); await h.enable();
    h.runRequest.mockImplementationOnce(async request => {
      await request.onThreadStarted?.('thread-1');
      await request.onBeforeQueue?.({ threadId: 'thread-1' });
      throw new Error('Connection lost before acknowledgment');
    });
    h.jobs.push(h.job()); h.push(); await settle(); h.manager.stop();
    const next = harness(h.directory); next.setServer(true, 1);
    next.recoverRequest.mockResolvedValueOnce({ threadId: 'thread-1', status: 'needs_user', summary: 'Delivery uncertain.', finalResponse: '', recoveryUncertain: true });
    next.jobs.push(next.job()); await next.manager.authChanged(); await settle();
    expect(next.runRequest).not.toHaveBeenCalled();
    expect(next.recoverRequest).toHaveBeenCalledWith(expect.objectContaining({ queueSubmission: { state: 'submitting' } }));
    expect(next.rpc).toHaveBeenCalledWith('voice_jobs_complete', expect.objectContaining({ p_status: 'needs_user' }));
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

describe('persistent inbox delivery receipts', () => {
  it('saves one inbox identity and retries receipts without repeating work', async () => {
    const h = harness();
    h.routeRequest.mockImplementation(async input => {
      await input.inbox?.onThread('inbox-thread');
      return { decision: 'new', workspacePath: input.inboxPath };
    });
    h.writeInboxReceipt.mockRejectedValueOnce(new Error('Inbox unavailable'));
    await h.enable();
    h.jobs.push(h.job()); h.push(); await settle();
    const snapshot = JSON.parse(fs.readFileSync(path.join(h.directory, 'account-a.json'), 'utf8'));
    expect(snapshot.inboxThreadId).toBe('inbox-thread');
    expect(snapshot.attempts['job-1'].outcome.status).toBe('completed');
    expect(h.runRequest).toHaveBeenCalledTimes(1);
    h.push(); await settle();
    expect(h.runRequest).toHaveBeenCalledTimes(1);
    expect(h.writeInboxReceipt).toHaveBeenCalledWith(expect.objectContaining({ inboxThreadId: 'inbox-thread', status: 'working' }));
    expect(h.writeInboxReceipt).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }));
    h.jobs.push(h.job('job-2')); h.push(); await settle();
    expect(h.routeRequest.mock.calls[1][0].inbox?.threadId).toBe('inbox-thread');
  });
});

describe('inbox account boundaries', () => {
  it('cancels an outstanding receipt and hides inbox access on sign-out', async () => {
    const h = harness();
    const inboxId = '01a0795a-a845-7ef2-a60b-91a2ff036a45';
    h.routeRequest.mockImplementation(async input => {
      await input.inbox?.onThread(inboxId);
      return { decision: 'new', workspacePath: input.inboxPath };
    });
    let signal: AbortSignal | undefined;
    let release!: () => void;
    h.writeInboxReceipt.mockImplementationOnce((...args: unknown[]) => {
      signal = (args[0] as { signal: AbortSignal }).signal;
      return new Promise<void>(resolve => { release = resolve; });
    });
    await h.enable(); h.jobs.push(h.job()); h.push(); await settle();
    expect(h.manager.canOpenTask(inboxId)).toBe(true);
    h.setOwner(null); await h.manager.authChanged();
    expect(signal?.aborted).toBe(true);
    expect(h.manager.canOpenTask(inboxId)).toBe(false);
    expect(h.manager.getState().inboxThreadId).toBeUndefined();
    release(); await settle();
    expect(h.rpc.mock.calls.filter(([name]) => name === 'voice_jobs_complete')).toHaveLength(0);
  });
});

describe('local inbox upgrade adoption', () => {
  it('adopts the verified existing inbox without changing delivery settings or saved attempts', async () => {
    const h = harness(); await h.enable(); h.manager.stop();
    const statePath = path.join(h.directory, 'account-a.json');
    const before = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    const threadId = '01a0795a-a845-7ef2-a60b-91a2ff036a45';
    fs.writeFileSync(path.join(h.directory, 'account-a.inbox.json'), JSON.stringify({ owner: 'account-a', threadId }));
    const next = harness(h.directory); next.setServer(true, 1); await next.manager.authChanged(); await settle();
    expect(next.manager.getState().inboxThreadId).toBe(threadId);
    expect(next.manager.canOpenTask(threadId)).toBe(true);
    const after = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    expect(after.attempts).toEqual(before.attempts);
    expect(after.settings).toEqual(before.settings);
    expect(next.rpc.mock.calls.some(([name]) => name === 'voice_delivery_configure')).toBe(false);
  });
});


describe('Voice inbox instruction settings', () => {
  it('persists exact text and supplies it to the next routing decision without starting work on save', async () => {
    const h = harness(); await h.enable();
    const text = '  Make a reasonable assumption.\nKeep my formatting.  ';
    await h.manager.updateSettings({ inboxInstructions: text });
    expect(h.routeRequest).not.toHaveBeenCalled();
    expect(h.manager.getState().settings.inboxInstructions).toBe(text);
    h.jobs.push(h.job()); h.push(); await settle();
    expect(h.routeRequest.mock.calls[0][0].inboxInstructions).toBe(text);
    h.manager.stop();
    const next = harness(h.directory); await next.manager.authChanged();
    expect(next.manager.getState().settings.inboxInstructions).toBe(text);
    await expect(next.manager.updateSettings({ inboxInstructions: '   ' })).rejects.toThrow();
    expect(next.manager.getState().settings.inboxInstructions).toBe(text);
  });
});


it('exposes recorded task titles only after execution starts and only to their owner', async () => {
  const h = harness(); await h.enable();
  h.routeRequest.mockResolvedValue({ decision: 'new', title: 'Personal - Tea set', workspacePath: h.directory });
  expect(h.manager.getRecordedTaskTitles('account-a').size).toBe(0);
  h.jobs.push(h.job()); h.push(); await settle();
  expect(h.manager.getRecordedTaskTitles('account-a').get('thread-1')).toBe('Personal - Tea set');
  expect(h.manager.getRecordedTaskTitles('account-b').size).toBe(0);
  h.setOwner(null); await h.manager.authChanged();
  expect(h.manager.getRecordedTaskTitles('account-a').size).toBe(0);
});

it('publishes queue and actual start independently before completion with durable timestamp backfill', async () => {
  const h = harness(); await h.enable();
  const actualStart = '2026-09-09T20:00:00.000Z';
  h.runRequest.mockImplementation(async request => {
    await request.onThreadStarted?.('thread-1');
    await request.onBeforeQueue?.({ threadId: 'thread-1' });
    await request.onQueued?.({ threadId: 'thread-1', queuedSubmissionId: 'queue-1' });
    await settle();
    expect(h.rpc.mock.calls.some(([name, args]) => name === 'voice_jobs_record_progress' && args.p_stage === 'queued')).toBe(true);
    expect(h.rpc.mock.calls.some(([name, args]) => name === 'voice_jobs_record_progress' && args.p_stage === 'started')).toBe(false);
    await request.onStarted?.({ threadId: 'thread-1', turnId: 'turn-1', startedAt: actualStart });
    await settle();
    expect(h.rpc.mock.calls.find(([name, args]) => name === 'voice_jobs_record_progress' && args.p_stage === 'started')?.[1])
      .toMatchObject({ p_occurred_at: actualStart, p_turn_id: 'turn-1' });
    return { threadId: 'thread-1', turnId: 'turn-1', status: 'completed', summary: 'Done', finalResponse: 'Done' };
  });
  h.jobs.push(h.job()); h.push(); await settle();
  await settle(); await settle();
  const result = h.rpc.mock.calls.find(([name]) => name === 'voice_jobs_complete')?.[1].p_result;
  expect(result).toMatchObject({ startedAt: actualStart, startedAtSource: 'codex', queuedAt: expect.any(String) });
});

it('completes delivery if optional progress RPC is unavailable, retaining timestamps for backfill', async () => {
  const h = harness(); await h.enable();
  const original = h.rpc.getMockImplementation()!;
  h.rpc.mockImplementation(async (name, args) => name === 'voice_jobs_record_progress'
    ? { data: null, error: { code: 'missing_rpc' } } : original(name, args));
  h.jobs.push(h.job()); h.push(); await settle();
  expect(h.runRequest).toHaveBeenCalledTimes(1);
  expect(h.rpc.mock.calls.find(([name]) => name === 'voice_jobs_complete')?.[1].p_result)
    .toMatchObject({ startedAt: expect.any(String), startedAtSource: 'observed' });
});
