import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import {
  ambientClientUserMessageId,
  CodexAppServerClient,
  type AmbientTranscriptDelivery,
} from './codexAppServerClient';
import { writeTextFileAtomically } from './documentSaveGuard';

export interface AmbientStartArgs {
  meetingId: string;
  title: string;
  workingDirectory: string;
}

export interface AmbientTranscriptDelta {
  sequence: number;
  startMs: number;
  endMs: number;
  text: string;
}

export interface AmbientOutboxEntry extends AmbientTranscriptDelta {
  attempts: number;
  lastAttemptAt?: string;
}

export interface AmbientState {
  version: 1;
  meetingId: string;
  title: string;
  workingDirectory: string;
  threadId: string | null;
  status: 'starting' | 'active' | 'stopping' | 'completed' | 'cancelled';
  outbox: AmbientOutboxEntry[];
  pendingDelivery: AmbientPendingDelivery | null;
  lastDeliveredSequence: number | null;
  lastError: { message: string; at: string } | null;
  updatedAt: string;
}

export interface AmbientPendingDelivery {
  firstSequence: number;
  lastSequence: number;
  clientUserMessageId: string;
  final: boolean;
}

export interface AmbientClient {
  createAmbientTask(
    meetingTitle: string,
    onThreadStarted?: (threadId: string) => void | Promise<void>,
  ): Promise<{ threadId: string; title: string }>;
  prepareAmbientTask(threadId: string, meetingTitle: string): Promise<{ threadId: string; title: string }>;
  deliverTranscript(delivery: AmbientTranscriptDelivery): Promise<void>;
  close?(): void;
}

export interface AmbientManagerOptions {
  clientFactory?: (workingDirectory: string) => AmbientClient;
  openTask?: (threadId: string) => Promise<void>;
  now?: () => Date;
  autoFlush?: boolean;
  stateFileName?: string;
}

interface ActiveMeeting {
  meetingId: string;
  title: string;
  workingDirectory: string;
  statePath: string;
  client: AmbientClient;
}

/** Durable bridge between stable meeting transcript deltas and one Codex task. */
export class AmbientManager extends EventEmitter {
  private readonly clientFactory: (workingDirectory: string) => AmbientClient;
  private readonly openTask: (threadId: string) => Promise<void>;
  private readonly now: () => Date;
  private readonly autoFlush: boolean;
  private readonly stateFileName: string;

  private active: ActiveMeeting | null = null;
  private state: AmbientState | null = null;
  private stateChain: Promise<void> = Promise.resolve();
  private startPromise: Promise<AmbientState> | null = null;
  private flushPromise: Promise<void> | null = null;
  private taskReady = false;

  constructor(options: AmbientManagerOptions = {}) {
    super();
    this.clientFactory = options.clientFactory
      ?? ((workingDirectory) => new CodexAppServerClient({ workspacePath: workingDirectory }));
    this.openTask = options.openTask ?? (async () => {});
    this.now = options.now ?? (() => new Date());
    this.autoFlush = options.autoFlush ?? false;
    this.stateFileName = options.stateFileName ?? 'ambient.json';
  }

  start(args: AmbientStartArgs): Promise<AmbientState> {
    const normalized = validateStartArgs(args);
    if (this.active && !sameMeeting(this.active, normalized)) {
      throw new Error(`Ambient is already running for meeting ${this.active.meetingId}`);
    }
    if (!this.active) {
      this.active = {
        ...normalized,
        statePath: path.join(normalized.workingDirectory, this.stateFileName),
        client: this.clientFactory(normalized.workingDirectory),
      };
    }
    if (!this.startPromise) {
      const starting = this.startInternal();
      const tracked = starting.finally(() => {
        if (this.startPromise === tracked) this.startPromise = null;
      });
      this.startPromise = tracked;
    }
    return this.startPromise;
  }

  async enqueueTranscript(delta: AmbientTranscriptDelta): Promise<void> {
    const active = this.requireActive();
    validateDelta(delta);
    await this.mutate((state) => {
      if (state.status === 'completed' || state.status === 'cancelled') {
        throw new Error(`Ambient meeting is already ${state.status}`);
      }
      if (state.lastDeliveredSequence !== null && delta.sequence <= state.lastDeliveredSequence) return;
      const duplicate = state.outbox.find((entry) => entry.sequence === delta.sequence);
      if (duplicate) {
        if (!sameDelta(duplicate, delta)) {
          throw new Error(`Transcript sequence ${delta.sequence} already has different content`);
        }
        return;
      }
      const highestPending = state.outbox.at(-1)?.sequence;
      if (highestPending !== undefined && delta.sequence < highestPending) {
        throw new Error('Transcript deltas must be enqueued in sequence order');
      }
      state.outbox.push({ ...delta, text: delta.text.trim(), attempts: 0 });
      state.lastError = null;
    });
    this.emit('queued', { meetingId: active.meetingId, sequence: delta.sequence });
    if (this.autoFlush) void this.flush().catch(() => {});
  }

  flush(final = false): Promise<void> {
    this.requireActive();
    if (this.flushPromise) {
      return final ? this.flushPromise.then(() => this.flush(true)) : this.flushPromise;
    }
    const flushing = this.flushInternal(final);
    const tracked = flushing.finally(() => {
      if (this.flushPromise === tracked) this.flushPromise = null;
    });
    this.flushPromise = tracked;
    return tracked;
  }

  /** Close the transport. Durable pending work remains recoverable. */
  stop(): void {
    this.active?.client.close?.();
    this.clearActiveMeeting();
  }

  /** Cancel without deleting transcript data or the Codex task. */
  async cancel(): Promise<void> {
    const active = this.requireActive();
    await this.mutate((state) => {
      state.status = 'cancelled';
      state.lastError = null;
    });
    active.client.close?.();
    this.clearActiveMeeting();
  }

  getState(): AmbientState | null {
    return this.state ? structuredClone(this.state) : null;
  }

  private async startInternal(): Promise<AmbientState> {
    await this.ensureState();
    const active = this.requireActive();
    const current = this.requireState();
    if (current.status === 'cancelled') throw new Error('Ambient meeting was cancelled');
    try {
      if (current.threadId) {
        await active.client.prepareAmbientTask(current.threadId, active.title);
      } else {
        await active.client.createAmbientTask(active.title, async (threadId) => {
          await this.mutate((state) => {
            if (state.threadId && state.threadId !== threadId) {
              throw new Error('Ambient task was created more than once');
            }
            state.threadId = threadId;
          });
        });
      }
      const threadId = this.requireState().threadId;
      if (!threadId) throw new Error('Ambient task has no Codex thread id');
      await this.openTask(threadId);
      this.taskReady = true;
      await this.mutate((state) => {
        if (state.status === 'starting') state.status = 'active';
        state.lastError = null;
      });
      if (this.autoFlush && this.requireState().outbox.length > 0) {
        queueMicrotask(() => { void this.flush().catch(() => {}); });
      }
      return structuredClone(this.requireState());
    } catch (error) {
      await this.recordError(error);
      throw error;
    }
  }

  private async flushInternal(final: boolean): Promise<void> {
    const active = this.requireActive();
    if (!this.taskReady) {
      await this.start({
        meetingId: active.meetingId,
        title: active.title,
        workingDirectory: active.workingDirectory,
      });
    }
    if (final) {
      await this.mutate((state) => { state.status = 'stopping'; });
    }

    // Snapshot the current range once. Deltas queued during delivery remain for
    // the next cadence, while a final flush is chained after any active flush.
    do {
      const batch = await this.selectBatch(final);
      if (batch.length === 0) break;
      await this.deliverBatch(active, batch);
    } while (final);

    if (final) {
      await this.mutate((state) => {
        if (state.outbox.length > 0) throw new Error('Ambient transcript delivery is still pending');
        state.status = 'completed';
        state.lastError = null;
      });
    }
  }

  private async deliverBatch(
    active: ActiveMeeting,
    batch: AmbientOutboxEntry[],
  ): Promise<void> {
    const first = batch[0];
    const last = batch[batch.length - 1];
    const pendingDelivery = this.requireState().pendingDelivery;
    if (!pendingDelivery) throw new Error('Ambient delivery batch is not initialized');
    await this.mutate((state) => {
      const sequences = new Set(batch.map((entry) => entry.sequence));
      for (const entry of state.outbox) {
        if (!sequences.has(entry.sequence)) continue;
        entry.attempts += 1;
        entry.lastAttemptAt = this.now().toISOString();
      }
    });

    const threadId = this.requireState().threadId;
    if (!threadId) throw new Error('Ambient task has no Codex thread id');
    try {
      await active.client.deliverTranscript({
        threadId,
        meetingId: active.meetingId,
        meetingTitle: active.title,
        firstSequence: first.sequence,
        lastSequence: last.sequence,
        transcript: formatTranscriptBatch(batch),
        clientUserMessageId: pendingDelivery.clientUserMessageId,
        startMs: first.startMs,
        endMs: last.endMs,
        final: pendingDelivery.final,
      });
    } catch (error) {
      await this.recordError(error);
      this.emit('delivery-error', {
        meetingId: active.meetingId,
        firstSequence: first.sequence,
        lastSequence: last.sequence,
        error: errorMessage(error),
      });
      throw error;
    }

    const deliveredSequences = new Set(batch.map((entry) => entry.sequence));
    await this.mutate((state) => {
      state.outbox = state.outbox.filter((entry) => !deliveredSequences.has(entry.sequence));
      state.lastDeliveredSequence = last.sequence;
      state.pendingDelivery = null;
      state.lastError = null;
    });
    this.emit('delivered', {
      meetingId: active.meetingId,
      firstSequence: first.sequence,
      lastSequence: last.sequence,
    });
  }

  private async selectBatch(final: boolean): Promise<AmbientOutboxEntry[]> {
    await this.mutate((state) => {
      if (state.pendingDelivery || state.outbox.length === 0) return;
      const first = state.outbox[0];
      const last = state.outbox[state.outbox.length - 1];
      state.pendingDelivery = {
        firstSequence: first.sequence,
        lastSequence: last.sequence,
        clientUserMessageId: ambientClientUserMessageId(state.meetingId, first.sequence, last.sequence),
        final,
      };
    });
    const state = this.requireState();
    if (!state.pendingDelivery) return [];
    return structuredClone(state.outbox.filter((entry) => (
      entry.sequence >= state.pendingDelivery!.firstSequence
      && entry.sequence <= state.pendingDelivery!.lastSequence
    )));
  }

  private async ensureState(): Promise<void> {
    if (this.state) return;
    const active = this.requireActive();
    await this.enqueueStateOperation(() => {
      if (this.state) return;
      fs.mkdirSync(active.workingDirectory, { recursive: true, mode: 0o700 });
      if (fs.existsSync(active.statePath)) {
        this.state = parseState(fs.readFileSync(active.statePath, 'utf-8'));
        if (!sameMeeting(this.state, active)) throw new Error('Ambient state belongs to a different meeting');
        return;
      }
      this.state = {
        version: 1,
        meetingId: active.meetingId,
        title: active.title,
        workingDirectory: active.workingDirectory,
        threadId: null,
        status: 'starting',
        outbox: [],
        pendingDelivery: null,
        lastDeliveredSequence: null,
        lastError: null,
        updatedAt: this.now().toISOString(),
      };
      this.persistState();
    });
  }

  private async mutate(change: (state: AmbientState) => void): Promise<void> {
    await this.ensureState();
    await this.enqueueStateOperation(() => {
      change(this.requireState());
      this.requireState().updatedAt = this.now().toISOString();
      this.persistState();
    });
  }

  private enqueueStateOperation(operation: () => void): Promise<void> {
    const queued = this.stateChain.then(operation, operation);
    this.stateChain = queued.then(() => undefined, () => undefined);
    return queued;
  }

  private persistState(): void {
    const active = this.requireActive();
    writeTextFileAtomically(active.statePath, `${JSON.stringify(this.requireState(), null, 2)}\n`);
    try { fs.chmodSync(active.statePath, 0o600); } catch { /* best effort */ }
  }

  private async recordError(error: unknown): Promise<void> {
    await this.mutate((state) => {
      state.lastError = { message: errorMessage(error), at: this.now().toISOString() };
    });
  }

  private requireActive(): ActiveMeeting {
    if (!this.active) throw new Error('Ambient has no active meeting');
    return this.active;
  }

  private requireState(): AmbientState {
    if (!this.state) throw new Error('Ambient state is not initialized');
    return this.state;
  }

  private clearActiveMeeting(): void {
    this.active = null;
    this.state = null;
    this.taskReady = false;
    this.startPromise = null;
    this.flushPromise = null;
    this.stateChain = Promise.resolve();
  }
}

function validateStartArgs(args: AmbientStartArgs): Omit<ActiveMeeting, 'statePath' | 'client'> {
  if (!args.meetingId.trim()) throw new Error('Meeting id is required');
  if (!args.title.trim()) throw new Error('Meeting title is required');
  if (!path.isAbsolute(args.workingDirectory)) throw new Error('Ambient working directory must be absolute');
  return {
    meetingId: args.meetingId,
    title: args.title.trim(),
    workingDirectory: path.normalize(args.workingDirectory),
  };
}

function validateDelta(delta: AmbientTranscriptDelta): void {
  if (!Number.isSafeInteger(delta.sequence) || delta.sequence < 0) {
    throw new Error('Transcript sequence must be a non-negative integer');
  }
  if (!Number.isFinite(delta.startMs) || !Number.isFinite(delta.endMs)
    || delta.startMs < 0 || delta.endMs < delta.startMs) {
    throw new Error('Transcript time range is invalid');
  }
  if (!delta.text.trim()) throw new Error('Transcript delta is empty');
}

function sameDelta(left: AmbientTranscriptDelta, right: AmbientTranscriptDelta): boolean {
  return left.sequence === right.sequence
    && left.startMs === right.startMs
    && left.endMs === right.endMs
    && left.text === right.text.trim();
}

function sameMeeting(
  left: Pick<AmbientState, 'meetingId' | 'title' | 'workingDirectory'>,
  right: Pick<ActiveMeeting, 'meetingId' | 'title' | 'workingDirectory'>,
): boolean {
  return left.meetingId === right.meetingId
    && left.title === right.title
    && left.workingDirectory === right.workingDirectory;
}

function formatTranscriptBatch(entries: AmbientOutboxEntry[]): string {
  return entries.map((entry) => (
    `[delta ${entry.sequence}; ${entry.startMs}-${entry.endMs} ms]\n${entry.text}`
  )).join('\n\n');
}

function parseState(raw: string): AmbientState {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('Ambient state file is not valid JSON');
  }
  if (!value || typeof value !== 'object') throw new Error('Ambient state file is invalid');
  const state = value as Partial<AmbientState>;
  if (state.version !== 1
    || typeof state.meetingId !== 'string'
    || typeof state.title !== 'string'
    || typeof state.workingDirectory !== 'string'
    || !(typeof state.threadId === 'string' || state.threadId === null)
    || !['starting', 'active', 'stopping', 'completed', 'cancelled'].includes(String(state.status))
    || !Array.isArray(state.outbox)
    || !(state.pendingDelivery === null || isPendingDelivery(state.pendingDelivery))
    || !(typeof state.lastDeliveredSequence === 'number' || state.lastDeliveredSequence === null)) {
    throw new Error('Ambient state file is invalid');
  }
  for (const entry of state.outbox) {
    if (!entry || typeof entry !== 'object') throw new Error('Ambient state outbox is invalid');
    const item = entry as Partial<AmbientOutboxEntry>;
    if (!Number.isSafeInteger(item.sequence)
      || !Number.isFinite(item.startMs)
      || !Number.isFinite(item.endMs)
      || typeof item.text !== 'string'
      || !Number.isSafeInteger(item.attempts)) {
      throw new Error('Ambient state outbox is invalid');
    }
  }
  return state as AmbientState;
}

function isPendingDelivery(value: unknown): value is AmbientPendingDelivery {
  if (!value || typeof value !== 'object') return false;
  const pending = value as Partial<AmbientPendingDelivery>;
  return typeof pending.firstSequence === 'number'
    && Number.isSafeInteger(pending.firstSequence)
    && typeof pending.lastSequence === 'number'
    && Number.isSafeInteger(pending.lastSequence)
    && pending.lastSequence >= pending.firstSequence
    && typeof pending.clientUserMessageId === 'string'
    && typeof pending.final === 'boolean';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
