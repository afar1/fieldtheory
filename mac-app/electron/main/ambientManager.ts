import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import {
  ambientClientUserMessageId,
  CodexAppServerClient,
  type AmbientTranscriptDelivery,
} from './codexAppServerClient';
import { writeTextFileAtomically } from './documentSaveGuard';
import {
  DEFAULT_AMBIENT_SETTINGS,
  normalizeAmbientSettings,
  type AmbientSettings,
} from '../shared/ambientSettings';

const AMBIENT_CONTEXT_DIRECTORY = '.ambient-context';
const AMBIENT_INSTRUCTIONS_FILE = 'ambient-instructions.txt';
const MAX_BATCH_EVENTS = 100;
const MAX_BATCH_TRANSCRIPT_CHARACTERS = 24_000;

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
  nextCharacterOffset?: number;
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
  firstCharacterOffset?: number;
  lastCharacterOffset?: number;
}

interface AmbientBatchEntry extends AmbientTranscriptDelta {
  characterStart: number;
  characterEnd: number;
  totalCharacters: number;
}

export interface AmbientClient {
  createAmbientTask(
    meetingTitle: string,
    onThreadStarted?: (threadId: string) => void | Promise<void>,
    settings?: AmbientSettings,
  ): Promise<{ threadId: string; title: string }>;
  prepareAmbientTask(threadId: string, meetingTitle: string): Promise<{ threadId: string; title: string }>;
  deliverAmbientSettings(threadId: string, settingsFilePath: string): Promise<void>;
  deliverTranscript(delivery: AmbientTranscriptDelivery): Promise<void>;
  close?(): void;
}

export interface AmbientManagerOptions {
  clientFactory?: (workingDirectory: string) => AmbientClient;
  openTask?: (threadId: string) => Promise<void>;
  now?: () => Date;
  autoFlush?: boolean;
  stateFileName?: string;
  getSettings?: () => AmbientSettings;
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
  private readonly getSettings: () => AmbientSettings;

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
    this.getSettings = options.getSettings ?? (() => DEFAULT_AMBIENT_SETTINGS);
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
    const active = this.active;
    if (!active) return;
    const close = () => {
      if (this.active !== active) return;
      active.client.close?.();
      this.clearActiveMeeting();
    };
    if (this.flushPromise) {
      void this.flushPromise.catch(() => {}).then(close);
      return;
    }
    close();
  }

  /** Cancel without deleting transcript data or the Codex task. */
  async cancel(): Promise<void> {
    const active = this.requireActive();
    await this.flushPromise?.catch(() => {});
    if (this.active !== active) return;
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

  async applySettings(rawSettings: AmbientSettings): Promise<boolean> {
    const active = this.active;
    const state = this.state;
    if (!active || !state?.threadId) return false;
    const settings = normalizeAmbientSettings(rawSettings);
    const settingsFilePath = this.writeSettingsFile(active, settings);
    await active.client.deliverAmbientSettings(state.threadId, settingsFilePath);
    return true;
  }

  private async startInternal(): Promise<AmbientState> {
    await this.ensureState();
    const active = this.requireActive();
    const current = this.requireState();
    if (current.status === 'cancelled') throw new Error('Ambient meeting was cancelled');
    const settings = normalizeAmbientSettings(this.getSettings());
    const settingsFilePath = this.writeSettingsFile(active, settings);
    try {
      if (current.threadId) {
        await active.client.prepareAmbientTask(current.threadId, active.title);
        await active.client.deliverAmbientSettings(current.threadId, settingsFilePath);
      } else {
        await active.client.createAmbientTask(active.title, async (threadId) => {
          await this.mutate((state) => {
            if (state.threadId && state.threadId !== threadId) {
              throw new Error('Ambient task was created more than once');
            }
            state.threadId = threadId;
          });
        }, settings);
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
    batch: AmbientBatchEntry[],
  ): Promise<void> {
    const first = batch[0];
    const last = batch[batch.length - 1];
    const pendingDelivery = this.requireState().pendingDelivery;
    if (!pendingDelivery) throw new Error('Ambient delivery batch is not initialized');
    const threadId = this.requireState().threadId;
    if (!threadId) throw new Error('Ambient task has no Codex thread id');
    try {
      const contextFilePath = this.ensureContextFile(active, batch, pendingDelivery);
      await this.mutate((state) => {
        const sequences = new Set(batch.map((entry) => entry.sequence));
        for (const entry of state.outbox) {
          if (!sequences.has(entry.sequence)) continue;
          entry.attempts += 1;
          entry.lastAttemptAt = this.now().toISOString();
        }
      });
      await active.client.deliverTranscript({
        threadId,
        meetingId: active.meetingId,
        firstSequence: first.sequence,
        lastSequence: last.sequence,
        contextFilePath,
        clientUserMessageId: pendingDelivery.clientUserMessageId,
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

    await this.mutate((state) => {
      const lastEntry = state.outbox.find((entry) => entry.sequence === pendingDelivery.lastSequence);
      const lastCharacterOffset = pendingDelivery.lastCharacterOffset ?? lastEntry?.text.length ?? 0;
      const fullyDeliveredSequences: number[] = [];
      state.outbox = state.outbox.filter((entry) => {
        if (entry.sequence < pendingDelivery.firstSequence || entry.sequence > pendingDelivery.lastSequence) {
          return true;
        }
        if (entry.sequence === pendingDelivery.lastSequence && lastCharacterOffset < entry.text.length) {
          entry.nextCharacterOffset = lastCharacterOffset;
          return true;
        }
        fullyDeliveredSequences.push(entry.sequence);
        return false;
      });
      const lastFullyDeliveredSequence = fullyDeliveredSequences.at(-1);
      if (lastFullyDeliveredSequence !== undefined) state.lastDeliveredSequence = lastFullyDeliveredSequence;
      state.pendingDelivery = null;
      state.lastError = null;
    });
    this.emit('delivered', {
      meetingId: active.meetingId,
      firstSequence: first.sequence,
      lastSequence: last.sequence,
    });
  }

  private async selectBatch(final: boolean): Promise<AmbientBatchEntry[]> {
    await this.mutate((state) => {
      if (state.pendingDelivery || state.outbox.length === 0) return;
      const batch = selectBoundedBatch(state.outbox);
      const first = batch[0];
      const last = batch[batch.length - 1];
      const needsCharacterDiscriminator = first.characterStart > 0 || last.characterEnd < last.totalCharacters;
      const lastOutboxEntry = state.outbox.at(-1);
      const isLastBatch = last.sequence === lastOutboxEntry?.sequence
        && last.characterEnd === last.totalCharacters;
      state.pendingDelivery = {
        firstSequence: first.sequence,
        lastSequence: last.sequence,
        clientUserMessageId: ambientClientUserMessageId(
          state.meetingId,
          first.sequence,
          last.sequence,
          needsCharacterDiscriminator
            ? `${first.sequence}:${first.characterStart}-${last.sequence}:${last.characterEnd}`
            : '',
        ),
        final: final && isLastBatch,
        firstCharacterOffset: first.characterStart,
        lastCharacterOffset: last.characterEnd,
      };
    });
    const state = this.requireState();
    if (!state.pendingDelivery) return [];
    return structuredClone(materializePendingBatch(state.outbox, state.pendingDelivery));
  }

  private ensureContextFile(
    active: ActiveMeeting,
    batch: AmbientBatchEntry[],
    pendingDelivery: AmbientPendingDelivery,
  ): string {
    const directoryPath = path.join(active.workingDirectory, AMBIENT_CONTEXT_DIRECTORY);
    fs.mkdirSync(directoryPath, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(directoryPath, 0o700); } catch { /* best effort */ }
    const relativePath = path.join(
      AMBIENT_CONTEXT_DIRECTORY,
      `${pendingDelivery.clientUserMessageId}.json`,
    );
    const filePath = path.join(active.workingDirectory, relativePath);
    const content = `${JSON.stringify({
      version: 1,
      kind: 'field-theory-ambient-context',
      trust: 'untrusted',
      meeting: {
        id: active.meetingId,
        title: active.title,
      },
      batch: {
        id: pendingDelivery.clientUserMessageId,
        firstSequence: pendingDelivery.firstSequence,
        lastSequence: pendingDelivery.lastSequence,
        final: pendingDelivery.final,
      },
      events: batch.map(({
        sequence,
        startMs,
        endMs,
        text,
        characterStart,
        characterEnd,
        totalCharacters,
      }) => ({ sequence, startMs, endMs, characterStart, characterEnd, totalCharacters, text })),
    }, null, 2)}\n`;

    if (fs.existsSync(filePath)) {
      if (fs.readFileSync(filePath, 'utf-8') !== content) {
        throw new Error(`Ambient context file conflicts with durable batch ${pendingDelivery.clientUserMessageId}`);
      }
    } else {
      writeTextFileAtomically(filePath, content);
    }
    try { fs.chmodSync(filePath, 0o600); } catch { /* best effort */ }
    return relativePath;
  }

  private writeSettingsFile(active: ActiveMeeting, settings: AmbientSettings): string {
    const directoryPath = path.join(active.workingDirectory, AMBIENT_CONTEXT_DIRECTORY);
    fs.mkdirSync(directoryPath, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(directoryPath, 0o700); } catch { /* best effort */ }
    const relativePath = path.join(AMBIENT_CONTEXT_DIRECTORY, AMBIENT_INSTRUCTIONS_FILE);
    const filePath = path.join(active.workingDirectory, relativePath);
    writeTextFileAtomically(filePath, settings.instructions);
    try { fs.chmodSync(filePath, 0o600); } catch { /* best effort */ }
    return relativePath;
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

function selectBoundedBatch(entries: AmbientOutboxEntry[]): AmbientBatchEntry[] {
  const batch: AmbientBatchEntry[] = [];
  let transcriptCharacters = 0;
  for (const entry of entries) {
    if (batch.length >= MAX_BATCH_EVENTS) break;
    const characterStart = entry.nextCharacterOffset ?? 0;
    const availableCharacters = MAX_BATCH_TRANSCRIPT_CHARACTERS - transcriptCharacters;
    const characterEnd = boundedCharacterEnd(entry.text, characterStart, availableCharacters);
    if (characterEnd <= characterStart) break;
    batch.push({
      sequence: entry.sequence,
      startMs: entry.startMs,
      endMs: entry.endMs,
      text: entry.text.slice(characterStart, characterEnd),
      characterStart,
      characterEnd,
      totalCharacters: entry.text.length,
    });
    transcriptCharacters += characterEnd - characterStart;
    if (characterEnd < entry.text.length) break;
  }
  return batch;
}

function boundedCharacterEnd(text: string, start: number, availableCharacters: number): number {
  let end = Math.min(text.length, start + availableCharacters);
  if (end < text.length
    && end > start
    && isHighSurrogate(text.charCodeAt(end - 1))
    && isLowSurrogate(text.charCodeAt(end))) {
    end -= 1;
  }
  return end;
}

function isHighSurrogate(value: number): boolean {
  return value >= 0xD800 && value <= 0xDBFF;
}

function isLowSurrogate(value: number): boolean {
  return value >= 0xDC00 && value <= 0xDFFF;
}

function materializePendingBatch(
  entries: AmbientOutboxEntry[],
  pending: AmbientPendingDelivery,
): AmbientBatchEntry[] {
  return entries
    .filter((entry) => entry.sequence >= pending.firstSequence && entry.sequence <= pending.lastSequence)
    .map((entry) => {
      const characterStart = entry.sequence === pending.firstSequence
        ? pending.firstCharacterOffset ?? entry.nextCharacterOffset ?? 0
        : entry.nextCharacterOffset ?? 0;
      const characterEnd = entry.sequence === pending.lastSequence
        ? pending.lastCharacterOffset ?? entry.text.length
        : entry.text.length;
      return {
        sequence: entry.sequence,
        startMs: entry.startMs,
        endMs: entry.endMs,
        text: entry.text.slice(characterStart, characterEnd),
        characterStart,
        characterEnd,
        totalCharacters: entry.text.length,
      };
    });
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
      || !Number.isSafeInteger(item.attempts)
      || !(item.nextCharacterOffset === undefined
        || (Number.isSafeInteger(item.nextCharacterOffset)
          && item.nextCharacterOffset >= 0
          && item.nextCharacterOffset < item.text.length))) {
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
    && /^field-theory-ambient-[a-f0-9]{32}$/.test(pending.clientUserMessageId)
    && typeof pending.final === 'boolean'
    && (pending.firstCharacterOffset === undefined
      || (Number.isSafeInteger(pending.firstCharacterOffset) && pending.firstCharacterOffset >= 0))
    && (pending.lastCharacterOffset === undefined
      || (Number.isSafeInteger(pending.lastCharacterOffset) && pending.lastCharacterOffset >= 0));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
