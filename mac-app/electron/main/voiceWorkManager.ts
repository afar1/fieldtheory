import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import type { VoiceWorkSettings, VoiceWorkState } from '../shared/voiceWork';
import { codexTaskUrl } from '../shared/taskLinks';
import { routeVoiceRequest, writeVoiceInboxReceipt, type VoiceInboxReceipt, type VoiceRoute } from './voiceCodexRouter';
import {
  inspectVoiceCodexRuntime, runVoiceRequest, recoverVoiceRequest,
  type VoiceCodexOutcome,
} from './voiceCodexRunner';

interface VoiceAuth {
  getSession(): { user: { id: string } } | null;
  getSupabaseClient(): SupabaseClient | null;
}

interface DeliverySettings {
  schema_version: number;
  enabled: boolean;
  generation: number;
  enabled_at: string | null;
  server_now: string;
}

export interface VoiceJob {
  job_id: string;
  user_id: string;
  generation: number;
  transcript_id: string;
  text: string;
  previous_text: string | null;
  previous_thread_id: string | null;
  dispatch_key: string;
  thread_id: string | null;
  dispatch_started_at: string | null;
  lease_token: string;
  lease_expires_at: string;
  client_created_at_ms?: number;
}

interface ClaimResult {
  settings: DeliverySettings;
  jobs: VoiceJob[];
  next_wake_at: string | null;
  server_now: string;
}

interface LocalAttempt {
  threadId?: string;
  turnId?: string;
  dispatchStarted?: boolean;
  outcome?: VoiceCodexOutcome;
  leaseToken: string;
  published?: boolean;
  needsReconciliation?: boolean;
  route?: VoiceRoute;
  inboxReceipts?: Array<{ input: VoiceInboxReceipt; delivered?: boolean }>;
}

interface WorkerSnapshot {
  version: 1;
  owner: string;
  workerId: string;
  settings: VoiceWorkSettings;
  inboxThreadId?: string;
  pendingDisable?: boolean;
  configureSequence?: number;
  lastTask?: VoiceWorkState['lastTask'];
  attempts: Record<string, LocalAttempt>;
}

export interface VoiceWorkManagerOptions {
  auth: VoiceAuth;
  stateDirectory: string;
  inspectRuntime?: typeof inspectVoiceCodexRuntime;
  runRequest?: typeof runVoiceRequest;
  recoverRequest?: typeof recoverVoiceRequest;
  now?: () => number;
  rpcTimeoutMs?: number;
  routeRequest?: typeof routeVoiceRequest;
  writeInboxReceipt?: typeof writeVoiceInboxReceipt;
  ensureInboxFolder?: (owner: string, existingChoice: string | null) => string;
  selectInboxFolder?: (owner: string, folderPath: string) => string;
  onInboxFolderChanged?: (owner: string, previousPath: string, nextPath: string) => void;
  onTranscript?: (job: VoiceJob) => void | Promise<void>;
  onDispatched?: (job: VoiceJob, event: { threadId: string; turnId: string }) => void | Promise<void>;
  onDeliveryWake?: () => void;
}

const DEFAULT_SETTINGS: VoiceWorkSettings = { enabled: false, workspacePath: null };
const receiptText = (value: string, limit = value.length): string => {
  // JSONB rejects NUL and lone UTF-16 surrogates. Preserve the original locally.
  const normalized = Buffer.from(value, 'utf8').toString('utf8').replace(/\u0000/g, '\uFFFD');
  return normalized.slice(0, limit).replace(/[\uD800-\uDBFF]$/, '');
};
const SIGNED_OUT: VoiceWorkState = {
  settings: DEFAULT_SETTINGS, status: 'signed_out',
  message: 'Sign in to Field Theory to use voice requests.',
  codex: { available: false, signedIn: null },
};

/** Main-process worker. Input discovery is push-driven, with one catch-up on subscription. */
export class VoiceWorkManager extends EventEmitter {
  private owner: string | null = null;
  private epoch = 0;
  private state: VoiceWorkState = structuredClone(SIGNED_OUT);
  private snapshot: WorkerSnapshot | null = null;
  private channel: RealtimeChannel | null = null;
  private channelClient: SupabaseClient | null = null;
  private joinPromise: Promise<void> | null = null;
  private subscribed = false;
  private connectionVersion = 0;
  private wakeTimer: ReturnType<typeof setTimeout> | null = null;
  private renewTimer: ReturnType<typeof setTimeout> | null = null;
  private controller: AbortController | null = null;
  private pumping = false;
  private wakePending = false;
  private refreshPromise: Promise<VoiceWorkState> | null = null;
  private generation: number | null = null;
  private configureChain: Promise<unknown> = Promise.resolve();
  private enabling = false;
  private readonly now: () => number;

  constructor(private readonly options: VoiceWorkManagerOptions) {
    super();
    this.now = options.now ?? Date.now;
  }

  getState(): VoiceWorkState { return structuredClone(this.state); }

  getRecordedTaskTitles(owner: string): ReadonlyMap<string, string> {
    const titles = new Map<string, string>();
    if (owner !== this.owner || !this.current() || !this.snapshot) return titles;
    for (const attempt of Object.values(this.snapshot.attempts)) {
      const title = attempt.route?.title;
      if (attempt.threadId && attempt.turnId && attempt.dispatchStarted && title?.trim()) titles.set(attempt.threadId, title);
    }
    return titles;
  }

  /** The auth manager remains the sole owner of credentials and token refresh. */
  async authChanged(): Promise<void> {
    const nextOwner = this.options.auth.getSession()?.user.id ?? null;
    if (nextOwner === this.owner) {
      if (nextOwner && this.snapshot?.pendingDisable) await this.finishDisable();
      if (nextOwner && this.state.settings.enabled && (!this.channel || this.state.status === 'error')) await this.refreshStatus();
      return;
    }
    this.disconnect();
    this.owner = nextOwner;
    const epoch = this.epoch;
    this.snapshot = null;
    this.state = structuredClone(SIGNED_OUT);
    if (!nextOwner) { this.publish(); return; }
    try {
      this.snapshot = this.load(nextOwner);
      if (this.snapshot.lastTask && codexTaskUrl(this.snapshot.lastTask.threadId)) this.snapshot.lastTask.canOpen = true;
      this.state = {
        settings: { ...this.snapshot.settings }, status: 'disabled',
        codex: { available: false, signedIn: null }, lastTask: this.snapshot.lastTask, inboxThreadId: this.snapshot.inboxThreadId,
      };
      this.refreshInboxFolder();
      this.publish();
      if (this.snapshot.pendingDisable) await this.finishDisable();
      await this.refreshStatus();
    } catch {
      if (this.current(epoch)) this.setStatus('error', 'Voice request settings could not be loaded. No work has been started.');
    }
  }

  refreshStatus(): Promise<VoiceWorkState> {
    if (this.refreshPromise) return this.refreshPromise;
    const pending = (async () => {
      if (this.snapshot?.pendingDisable) {
        await this.finishDisable();
        if (this.snapshot?.pendingDisable) return this.getState();
      }
      return this.inspectAndConnect();
    })();
    this.refreshPromise = pending;
    void pending.finally(() => { if (this.refreshPromise === pending) this.refreshPromise = null; });
    return pending;
  }

  async updateSettings(changes: Partial<VoiceWorkSettings>): Promise<VoiceWorkState> {
    if (!this.current() || !this.snapshot) throw new Error('Sign in to Field Theory first.');
    if (changes.enabled !== undefined && typeof changes.enabled !== 'boolean') throw new Error('Invalid voice request setting.');
    if (changes.inboxInstructions !== undefined) {
      if (typeof changes.inboxInstructions !== 'string' || !changes.inboxInstructions.trim() || changes.inboxInstructions.length > 20000) throw new Error('Voice inbox instructions must contain 1–20,000 characters.');
      this.snapshot.settings.inboxInstructions = changes.inboxInstructions;
      this.persist();
    }
    if (changes.workspacePath !== undefined) {
      if ((this.snapshot.settings.enabled || this.enabling) && changes.workspacePath !== this.snapshot.settings.workspacePath) {
        throw new Error('Pause voice requests before changing the folder.');
      }
      if (changes.workspacePath !== null) this.validateWorkspace(changes.workspacePath);
      this.snapshot.settings.workspacePath = changes.workspacePath !== null && this.options.selectInboxFolder
        ? this.options.selectInboxFolder(this.owner!, changes.workspacePath) : changes.workspacePath;
      this.persist();
    }
    if (changes.enabled === false) {
      this.disconnect();
      this.snapshot.settings.enabled = false;
      this.snapshot.pendingDisable = true;
      this.enabling = false;
      this.snapshot.configureSequence = (this.snapshot.configureSequence ?? 0) + 1;
      this.persist();
      this.setStatus('disabled', 'Voice requests are paused on this Mac.');
      await this.finishDisable();
      return this.getState();
    }
    if (changes.enabled === true && !this.snapshot.settings.enabled) {
      if (this.enabling) throw new Error('Voice requests are already being enabled.');
      this.enabling = true;
      const before = this.epoch;
      let sequence: number | undefined;
      try {
        const status = await this.refreshStatus();
        this.ensureCurrent(before);
        if (this.snapshot.pendingDisable) throw new Error('Reconnect to finish pausing voice requests first.');
        if (!status.codex.available || status.codex.signedIn !== true) {
          throw new Error(status.message ?? 'Open Codex and sign in first.');
        }
        this.validateWorkspace(this.snapshot.settings.workspacePath);
        sequence = (this.snapshot.configureSequence ?? 0) + 1;
        this.snapshot.configureSequence = sequence;
        this.persist();
        // A private join also initializes Realtime's partitions on a fresh project.
        await this.connect(true);
        const settings = await this.configureServer(true, sequence, before);
        this.ensureCurrent(before);
        if (!settings.enabled || settings.applied === false) throw new Error('Voice request settings changed. Check again before enabling.');
        this.generation = settings.generation;
        this.snapshot.settings.enabled = true;
        this.snapshot.pendingDisable = false;
        this.persist();
        this.wake();
      } finally {
        if (this.current(before) && (sequence === undefined || this.snapshot?.configureSequence === sequence)) this.enabling = false;
      }
    } else if (!this.snapshot.settings.enabled) {
      this.setStatus('disabled', 'Enable voice requests to act on new synced recordings.');
    }
    return this.getState();
  }

  /** Called on system resume; reconnect/catch-up is an event, never a periodic scan. */
  async resume(): Promise<void> {
    if (!this.current()) return;
    this.disconnect();
    await this.refreshStatus();
  }

  stop(): void { this.disconnect(); }

  refreshInboxFolder(): void {
    if (!this.current() || !this.snapshot || !this.options.ensureInboxFolder) return;
    const folderPath = this.options.ensureInboxFolder(this.owner!, this.snapshot.settings.workspacePath);
    if (folderPath !== this.snapshot.settings.workspacePath) {
      const previousPath = this.snapshot.settings.workspacePath;
      this.snapshot.settings.workspacePath = folderPath;
      this.persist();
      if (previousPath) this.options.onInboxFolderChanged?.(this.owner!, previousPath, folderPath);
    }
  }

  canOpenTask(threadId: string): boolean {
    return this.current() && !!codexTaskUrl(threadId) && (this.snapshot?.inboxThreadId === threadId
      || this.state.lastTask?.threadId === threadId && this.state.lastTask.canOpen === true);
  }

  private async inspectAndConnect(): Promise<VoiceWorkState> {
    if (!this.current() || !this.snapshot) return this.getState();
    const epoch = this.epoch;
    try {
      this.refreshInboxFolder();
      const runtime = await (this.options.inspectRuntime ?? inspectVoiceCodexRuntime)();
      if (!this.current(epoch)) return this.getState();
      this.state.codex = {
        available: runtime.status !== 'not_installed',
        signedIn: runtime.status === 'ready' ? true : runtime.status === 'sign_in_required' ? false : null,
      };
      if (runtime.status !== 'ready') {
        this.setStatus('needs_setup', runtime.message);
      } else if (!this.snapshot.settings.workspacePath) {
        this.setStatus('needs_setup', 'Choose the Library folder for your voice transcripts.');
      } else {
        this.validateWorkspace(this.snapshot.settings.workspacePath);
        if (this.snapshot.settings.enabled) {
          await this.connect();
          this.wake();
        }
        else this.setStatus('disabled', 'Ready to enable voice requests.');
      }
    } catch {
      if (this.current(epoch)) this.setStatus('needs_setup', 'Check Codex sign-in and the selected folder, then try again.');
    }
    return this.getState();
  }

  private async connect(preflight = false): Promise<void> {
    if (!this.current() || (!preflight && !this.snapshot?.settings.enabled)) return;
    if (this.joinPromise) return this.joinPromise;
    if (this.channel && this.subscribed) return;
    if (this.channel && this.channelClient) void this.channelClient.removeChannel(this.channel).catch(() => {});
    const client = this.options.auth.getSupabaseClient();
    if (!client) throw new Error('Sign in to Field Theory.');
    const epoch = this.epoch;
    const connectionVersion = ++this.connectionVersion;
    this.setStatus('connecting', 'Connecting voice requests…');
    this.channelClient = client;
    let resolveJoin!: () => void;
    let rejectJoin!: (error: Error) => void;
    const joined = new Promise<void>((resolve, reject) => { resolveJoin = resolve; rejectJoin = reject; });
    this.joinPromise = joined;
    const timeout = setTimeout(() => rejectJoin(new Error('Voice delivery connection timed out.')), 15_000);
    timeout.unref?.();
    this.channel = client.channel(`voice-jobs:${this.owner}`, { config: { private: true } })
      .on('broadcast', { event: 'voice_jobs_changed' }, () => {
        if (!this.current(epoch) || connectionVersion !== this.connectionVersion || !this.snapshot?.settings.enabled) return;
        this.state.lastEventAt = this.now();
        this.options.onDeliveryWake?.();
        void this.checkDeliveryState(epoch).then((enabled) => { if (enabled) this.wake(); })
          .catch(() => this.handleDeliveryFailure(epoch));
      })
      .subscribe((status) => {
        if (!this.current(epoch) || connectionVersion !== this.connectionVersion) { rejectJoin(new Error('Voice request session changed.')); return; }
        if (status === 'SUBSCRIBED') { this.subscribed = true; resolveJoin(); if (this.snapshot?.settings.enabled) this.wake(); }
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          this.subscribed = false;
          rejectJoin(new Error('Voice delivery connection is unavailable.'));
          this.setStatus('connecting', 'Connection interrupted. Saved requests will resume after reconnecting.');
        }
      });
    try { await joined; this.ensureCurrent(epoch); }
    catch (error) {
      if (this.current(epoch) && connectionVersion === this.connectionVersion) {
        if (this.channel) void client.removeChannel(this.channel).catch(() => {});
        this.channel = null; this.channelClient = null;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      if (this.joinPromise === joined) this.joinPromise = null;
    }
  }

  private async checkDeliveryState(epoch: number): Promise<boolean> {
    const settings = await this.rpc<DeliverySettings>('voice_delivery_status', {}, epoch);
    this.ensureCurrent(epoch);
    if (!settings.enabled || (this.generation !== null && settings.generation !== this.generation)) {
      this.disconnect();
      if (this.snapshot) {
        this.snapshot.settings.enabled = false;
        this.persist();
      }
      this.setStatus('disabled', 'Voice requests were paused. Enable them again to process new recordings.');
      return false;
    }
    this.generation = settings.generation;
    return true;
  }

  private wake(): void {
    if (!this.current() || !this.snapshot?.settings.enabled) return;
    if (this.wakeTimer) clearTimeout(this.wakeTimer);
    this.wakeTimer = null;
    if (this.pumping) { this.wakePending = true; return; }
    const epoch = this.epoch;
    this.pumping = true;
    void this.pump(epoch).catch(() => this.handleDeliveryFailure(epoch)).finally(() => {
      this.pumping = false;
      if (this.wakePending) { this.wakePending = false; this.wake(); }
    });
  }

  private async pump(epoch: number): Promise<void> {
    if (!await this.checkDeliveryState(epoch)) return;
    await this.flushOutcomes(epoch);
    while (this.current(epoch) && this.snapshot?.settings.enabled) {
      const claim = await this.rpc<ClaimResult>('voice_jobs_claim', {
        p_worker_id: this.snapshot.workerId, p_limit: 1,
      }, epoch);
      if (!claim.settings.enabled || claim.settings.generation !== this.generation) {
        await this.checkDeliveryState(epoch); return;
      }
      if (!claim.jobs.length) {
        this.setStatus('ready', 'Listening for new voice requests.');
        if (claim.next_wake_at) {
          const delay = Date.parse(claim.next_wake_at) - Date.parse(claim.server_now);
          if (Number.isFinite(delay)) this.scheduleWake(Math.max(1000, delay), epoch);
        }
        return;
      }
      const job = claim.jobs[0];
      if (job.user_id !== this.owner || job.generation !== this.generation
        || !job.job_id || !job.lease_token || typeof job.text !== 'string') {
        throw new Error('Invalid voice job.');
      }
      await this.execute(job, epoch);
    }
  }

  private async execute(job: VoiceJob, epoch: number): Promise<void> {
    this.ensureCurrent(epoch);
    this.refreshInboxFolder();
    const snapshot = this.snapshot!;
    const inboxPath = snapshot.settings.workspacePath;
    this.validateWorkspace(inboxPath);
    const saved = snapshot.attempts[job.job_id];
    const attempt = saved ?? { leaseToken: job.lease_token };
    attempt.leaseToken = job.lease_token;
    attempt.needsReconciliation = false;
    snapshot.attempts[job.job_id] = attempt;
    this.persist();
    this.controller = new AbortController();
    const controller = this.controller;
    this.scheduleRenew(job, epoch, controller);
    try {
      await this.options.onTranscript?.(job);
      this.ensureCurrent(epoch);
      if (!attempt.route && !attempt.outcome) {
        attempt.route = await (this.options.routeRequest ?? routeVoiceRequest)({
          text: job.text, inboxPath: inboxPath!, inboxInstructions: snapshot.settings.inboxInstructions,
          inbox: { threadId: snapshot.inboxThreadId, receiptKey: `${job.dispatch_key}:intake`, onThread: id => {
            this.ensureCurrent(epoch);
            if (snapshot.inboxThreadId && snapshot.inboxThreadId !== id) throw new Error('Voice inbox identity changed.');
            snapshot.inboxThreadId = id;
            this.persist();
          } },
          previousThreadId: attempt.threadId ?? job.thread_id ?? job.previous_thread_id ?? undefined,
          signal: controller.signal,
        });
        this.ensureCurrent(epoch);
        this.persist();
      }
      const route = attempt.route;
      const workspacePath = route?.workspacePath ?? inboxPath!;
      let outcome: VoiceCodexOutcome;
      if (attempt.outcome) {
        outcome = attempt.outcome;
      } else if (route?.decision === 'context') {
        outcome = { status: 'context', summary: 'Saved as a note.', finalResponse: '' };
      } else if (attempt.dispatchStarted || job.dispatch_started_at) {
        const threadId = attempt.threadId ?? job.thread_id;
        if (!threadId) throw new Error('A previous dispatch needs reconciliation.');
        outcome = await (this.options.recoverRequest ?? recoverVoiceRequest)({
          threadId, turnId: attempt.turnId, dispatchKey: job.dispatch_key,
          workspacePath: workspacePath!, signal: controller.signal,
        });
      } else {
        outcome = await (this.options.runRequest ?? runVoiceRequest)({
          text: job.text, previousText: job.previous_text ?? undefined,
          workspacePath, threadId: attempt.threadId ?? job.thread_id ?? route?.threadId ?? job.previous_thread_id ?? undefined,
          projectId: route?.projectId,
          dispatchKey: job.dispatch_key, title: route?.title ?? 'Field Theory - Voice request',
          routingQuestion: route?.decision === 'ask' ? route.question : undefined,
          signal: controller.signal, sandboxMode: route?.decision === 'ask' ? 'read-only' : 'workspace-write',
          onThreadStarted: async (threadId) => {
            this.ensureCurrent(epoch);
            attempt.threadId = threadId;
            this.persist();
            const result = await this.rpc<{ ok: boolean }>('voice_jobs_record_dispatch', {
              p_job_id: job.job_id, p_lease_token: job.lease_token, p_thread_id: threadId,
            }, epoch);
            if (!result.ok) throw new Error('Voice request ownership changed before dispatch.');
          },
          onBeforeDispatch: async () => {
            this.ensureCurrent(epoch);
            const result = await this.rpc<{ ok: boolean }>('voice_jobs_begin_dispatch', {
              p_job_id: job.job_id, p_lease_token: job.lease_token,
            }, epoch);
            if (!result.ok) throw new Error('Voice request was paused before dispatch.');
            attempt.dispatchStarted = true;
            this.persist();
          },
          onStarted: async ({ threadId, turnId }) => {
            this.ensureCurrent(epoch);
            attempt.threadId = threadId; attempt.turnId = turnId;
            snapshot.lastTask = { threadId, title: route?.title ?? 'Field Theory - Voice request', status: 'working', summary: 'Codex is working.', canOpen: !!codexTaskUrl(threadId) };
            this.persist();
            await this.options.onDispatched?.(job, { threadId, turnId });
            this.ensureCurrent(epoch);
            this.setStatus('working', 'Codex is working on your voice request.');
            this.queueInboxReceipt(attempt, `${job.dispatch_key}:started`, { title: route?.title ?? 'Voice request',
              status: 'working', summary: 'Codex confirmed that the task started.', threadId });
            await this.flushInboxReceipts(attempt, epoch);

          },
        });
      }
      this.ensureCurrent(epoch);
      attempt.outcome = outcome;
      const threadId = outcome.threadId ?? attempt.threadId;
      if (threadId) snapshot.lastTask = {
        threadId, title: outcome.title ?? 'Field Theory - Voice request', status: outcome.recoveryUncertain ? 'needs_user' : outcome.status,
        summary: outcome.summary, finalResponse: outcome.finalResponse, question: outcome.question, canOpen: !!codexTaskUrl(threadId),
      };
      this.persist();
      this.queueInboxReceipt(attempt, `${job.dispatch_key}:outcome`, { title: outcome.title ?? route?.title ?? 'Voice request',
        status: outcome.recoveryUncertain ? 'needs_user' : outcome.status, summary: outcome.summary, threadId });
      await this.publishOutcome(job.job_id, attempt, epoch);
      await this.flushInboxReceipts(attempt, epoch);
      if (outcome.errorCode === 'sign_in_required') {
        this.disconnect();
        this.state.codex.signedIn = false;
        this.setStatus('needs_setup', 'Sign in to Codex, then check again to resume voice requests.');
      }
    } finally {
      if (this.controller === controller) this.controller = null;
      if (this.renewTimer) clearTimeout(this.renewTimer);
      this.renewTimer = null;
    }
  }

  private queueInboxReceipt(attempt: LocalAttempt, receiptKey: string, event: Pick<VoiceInboxReceipt, 'title' | 'status' | 'summary' | 'threadId'>): void {
    const snapshot = this.snapshot;
    if (!snapshot?.inboxThreadId || !snapshot.settings.workspacePath) return;
    const receipts = attempt.inboxReceipts ??= [];
    if (receipts.some(receipt => receipt.input.receiptKey === receiptKey)) return;
    receipts.push({ input: { ...event, receiptKey, inboxThreadId: snapshot.inboxThreadId, inboxPath: snapshot.settings.workspacePath } });
    this.persist();
  }

  private async flushInboxReceipts(attempt: LocalAttempt, epoch: number): Promise<void> {
    const ownedController = this.controller ? undefined : new AbortController();
    const controller = this.controller ?? ownedController!;
    if (ownedController) this.controller = ownedController;
    try {
      for (const receipt of attempt.inboxReceipts ?? []) {
        this.ensureCurrent(epoch);
        if (receipt.delivered) continue;
        try {
          await (this.options.writeInboxReceipt ?? writeVoiceInboxReceipt)({ ...receipt.input, signal: controller.signal });
          this.ensureCurrent(epoch);
          receipt.delivered = true;
          this.persist();
        } catch {
          // Receipt retries use the same key and cannot replay substantive work.
          if (this.current(epoch)) this.scheduleWake(30_000, epoch);
          return;
        }
      }
    } finally {
      if (ownedController && this.controller === ownedController) this.controller = null;
    }
  }

  private async publishOutcome(jobId: string, attempt: LocalAttempt, epoch: number): Promise<void> {
    if (!attempt.outcome || attempt.published) return;
    const outcome = attempt.outcome;
    const result = await this.rpc<{ ok: boolean }>('voice_jobs_complete', {
      p_job_id: jobId, p_lease_token: attempt.leaseToken,
      p_status: outcome.status === 'interrupted' || outcome.recoveryUncertain ? 'needs_user' : outcome.status,
      p_summary: receiptText(outcome.summary, 8000),
      p_result: this.receiptResult(outcome, attempt),
    }, epoch);
    this.ensureCurrent(epoch);
    if (!result.ok) {
      // The lease may have expired. Let claim renew ownership before publishing,
      // while retaining the saved result so the request is never repeated.
      attempt.needsReconciliation = true;
      this.persist();
      return;
    }
    attempt.published = true;
    this.persist();
  }

  private async flushOutcomes(epoch: number): Promise<void> {
    if (!this.snapshot) return;
    for (const [jobId, attempt] of Object.entries(this.snapshot.attempts)) {
      if (attempt.outcome && !attempt.published && !attempt.needsReconciliation) await this.publishOutcome(jobId, attempt, epoch);
      await this.flushInboxReceipts(attempt, epoch);
    }
  }

  private receiptResult(outcome: VoiceCodexOutcome, attempt: LocalAttempt): Record<string, unknown> {
    const result = {
      thread_id: receiptText(outcome.threadId ?? attempt.threadId ?? '', 1024),
      turn_id: receiptText(outcome.turnId ?? attempt.turnId ?? '', 1024),
      final_response: receiptText(outcome.finalResponse),
      question: outcome.question ? receiptText(outcome.question) : undefined,
      error_code: outcome.errorCode ? receiptText(outcome.errorCode, 1024) : undefined,
      recovery_uncertain: outcome.recoveryUncertain === true,
      response_truncated: false,
    };
    // The database caps result JSON at 64 KiB. Keep the complete answer locally.
    while (Buffer.byteLength(JSON.stringify(result), 'utf8') > 62_000) {
      if ((result.final_response?.length ?? 0) >= (result.question?.length ?? 0)) {
        result.final_response = receiptText(result.final_response, Math.floor(result.final_response.length / 2));
      } else {
        result.question = receiptText(result.question!, Math.floor(result.question!.length / 2));
      }
      result.response_truncated = true;
    }
    return result;
  }

  private scheduleRenew(job: VoiceJob, epoch: number, controller: AbortController): void {
    this.renewTimer = setTimeout(() => {
      if (!this.current(epoch) || controller.signal.aborted) return;
      void this.rpc<{ ok: boolean }>('voice_jobs_renew', {
        p_job_id: job.job_id, p_lease_token: job.lease_token,
      }, epoch).then((result) => {
        if (this.controller !== controller || controller.signal.aborted) return;
        if (!result.ok) controller.abort();
        else if (this.current(epoch)) this.scheduleRenew(job, epoch, controller);
      }).catch(() => { if (this.controller === controller) controller.abort(); });
    }, 25_000);
    this.renewTimer.unref?.();
  }

  private scheduleWake(delay: number, epoch: number): void {
    if (this.wakeTimer) clearTimeout(this.wakeTimer);
    this.wakeTimer = setTimeout(() => {
      this.wakeTimer = null;
      if (this.current(epoch)) this.wake();
    }, Math.min(delay, 2_147_483_647));
    this.wakeTimer.unref?.();
  }

  private handleDeliveryFailure(epoch: number): void {
    if (!this.current(epoch)) return;
    this.setStatus('error', 'Voice delivery needs attention. Saved work has been retained; reconnect or check again to recover.');
    // No endless auth/network retry loop and no periodic transcript discovery.
  }

  private async finishDisable(): Promise<void> {
    if (!this.current() || !this.snapshot?.pendingDisable) return;
    const epoch = this.epoch;
    const sequence = this.snapshot.configureSequence ?? 1;
    this.snapshot.configureSequence = sequence;
    this.persist();
    try {
      const result = await this.configureServer(false, sequence, epoch);
      this.ensureCurrent(epoch);
      // A retry may find that this exact request already took effect.
      if (this.snapshot!.configureSequence !== sequence || result.enabled) return;
      this.snapshot!.pendingDisable = false;
      this.persist();
      this.setStatus('disabled', 'Voice requests are paused.');
    } catch {
      if (this.current(epoch)) this.setStatus('error', 'Paused on this Mac. Reconnect to pause delivery on your other Macs.');
    }
  }

  private configureServer(enabled: boolean, sequence: number, epoch: number): Promise<DeliverySettings & { applied?: boolean }> {
    const workerId = this.snapshot!.workerId;
    const send = () => this.rpc<DeliverySettings & { applied?: boolean }>('voice_delivery_configure', {
      p_enabled: enabled, p_worker_id: workerId, p_sequence: sequence,
    }, epoch);
    const request = this.configureChain.then(send, send);
    this.configureChain = request.catch(() => {});
    return request;
  }

  private async rpc<T>(name: string, args: Record<string, unknown>, epoch: number): Promise<T> {
    this.ensureCurrent(epoch);
    const client = this.options.auth.getSupabaseClient();
    if (!client) throw new Error('Field Theory is signed out.');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const response = client.rpc(name, args);
    const { data, error } = await Promise.race([
      response,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Voice delivery timed out.')), this.options.rpcTimeoutMs ?? 15_000);
        timer.unref?.();
      }),
    ]).finally(() => { if (timer) clearTimeout(timer); });
    this.ensureCurrent(epoch);
    if (error || data === null) throw new Error('Voice delivery is unavailable.');
    return data as T;
  }

  private current(epoch = this.epoch): boolean {
    return epoch === this.epoch && !!this.owner
      && this.options.auth.getSession()?.user.id === this.owner;
  }

  private ensureCurrent(epoch: number): void {
    if (!this.current(epoch)) throw new Error('Voice request session changed.');
  }

  private disconnect(): void {
    this.epoch++;
    this.connectionVersion++;
    this.joinPromise = null;
    this.subscribed = false;
    this.refreshPromise = null;
    this.generation = null;
    this.enabling = false;
    this.controller?.abort(); this.controller = null;
    if (this.wakeTimer) clearTimeout(this.wakeTimer);
    if (this.renewTimer) clearTimeout(this.renewTimer);
    this.wakeTimer = null; this.renewTimer = null;
    this.wakePending = false;
    if (this.channel && this.channelClient) void this.channelClient.removeChannel(this.channel).catch(() => {});
    this.channel = null; this.channelClient = null;
  }

  private validateWorkspace(value: unknown): void {
    if (typeof value !== 'string' || !path.isAbsolute(value) || !fs.statSync(value).isDirectory()) {
      throw new Error('Choose an existing folder for voice requests.');
    }
  }

  private snapshotPath(owner: string): string {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(owner)) throw new Error('Invalid account.');
    return path.join(this.options.stateDirectory, `${owner}.json`);
  }

  private load(owner: string): WorkerSnapshot {
    const file = this.snapshotPath(owner);
    if (!fs.existsSync(file)) return {
      version: 1, owner, workerId: randomUUID(), settings: { ...DEFAULT_SETTINGS }, attempts: {},
    };
    const value = JSON.parse(fs.readFileSync(file, 'utf8')) as WorkerSnapshot;
    if (value.version !== 1 || value.owner !== owner || typeof value.workerId !== 'string'
      || typeof value.settings?.enabled !== 'boolean' || !value.attempts || Array.isArray(value.attempts)) {
      throw new Error('Invalid voice worker state.');
    }
    // A local upgrade can adopt an existing inbox without editing a live snapshot.
    const adoptionFile = path.join(this.options.stateDirectory, `${owner}.inbox.json`);
    if (!value.inboxThreadId && fs.existsSync(adoptionFile)) {
      const adoption = JSON.parse(fs.readFileSync(adoptionFile, 'utf8')) as { owner?: string; threadId?: string };
      if (adoption.owner !== owner || typeof adoption.threadId !== 'string' || !codexTaskUrl(adoption.threadId)) {
        throw new Error('Invalid Voice inbox adoption settings.');
      }
      value.inboxThreadId = adoption.threadId;
    }
    return value;
  }

  private persist(): void {
    if (!this.snapshot || !this.current()) return;
    fs.mkdirSync(this.options.stateDirectory, { recursive: true, mode: 0o700 });
    const file = this.snapshotPath(this.snapshot.owner);
    const temporary = `${file}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(this.snapshot), { mode: 0o600 });
    fs.renameSync(temporary, file);
    this.state.settings = { ...this.snapshot.settings };
    this.state.lastTask = this.snapshot.lastTask;
    this.state.inboxThreadId = this.snapshot.inboxThreadId;
    this.publish();
  }

  private setStatus(status: VoiceWorkState['status'], message?: string): void {
    this.state.status = status; this.state.message = message; this.publish();
  }

  private publish(): void { this.emit('stateChanged', this.getState()); }
}
