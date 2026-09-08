import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import type { VoiceInboxService } from './voiceInboxService';
import type { VoiceInboxCursor, VoiceInboxCursorKind, VoiceInboxTranscript } from './voiceInboxTypes';

interface VoiceInboxAuth {
  getSession(): { user: { id: string } } | null;
  getSupabaseClient(): SupabaseClient | null;
}
export interface VoiceInboxSyncOptions {
  auth: VoiceInboxAuth;
  store: VoiceInboxService;
  onError?: (message: string) => void;
  pageSize?: number;
  joinTimeoutMs?: number;
}
type Row = Record<string, unknown>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const fields = {
  transcripts: 'id,user_id,client_id,text,client_created_at_ms,client_updated_at_ms,updated_at,deleted_at',
  jobs: 'job_id,user_id,transcript_id,thread_id,status,turn_id:result->>turn_id,dispatch_started_at,updated_at',
};

/** History materialization is independent of whether Voice execution is enabled. */
export class VoiceInboxSync {
  private owner: string | null = null;
  private client: SupabaseClient | null = null;
  private channel: RealtimeChannel | null = null;
  private epoch = 0;
  private syncPromise: Promise<void> | null = null;
  private requested = false;
  private reconcileRequested = false;
  private subscribed = false;
  private rejectJoin: ((error: Error) => void) | null = null;
  private readonly pageSize: number;

  constructor(private readonly options: VoiceInboxSyncOptions) {
    this.pageSize = Number.isFinite(options.pageSize)
      ? Math.max(1, Math.min(250, Math.floor(options.pageSize!))) : 100;
  }

  getFolder(): string | null { return this.owner ? this.options.store.getFolder(this.owner) : null; }
  ensureFolder(existingChoice?: string | null): string { return this.options.store.ensureFolder(this.requireOwner(), existingChoice); }
  selectFolder(folderPath: string): string { return this.options.store.selectFolder(this.requireOwner(), folderPath); }

  async authChanged(existingChoice?: string | null): Promise<void> {
    const owner = this.options.auth.getSession()?.user.id ?? null;
    if (owner && owner === this.owner && this.channel) { await this.refresh(); return; }
    this.stop();
    if (!owner) return;
    const client = this.options.auth.getSupabaseClient();
    if (!client || !uuid.test(owner)) throw new Error('Sign in to Field Theory to sync Voice Inbox.');
    this.owner = owner;
    this.client = client;
    const epoch = this.epoch;
    this.ensureFolder(existingChoice);
    let resolveJoin!: () => void;
    let rejectJoin!: (error: Error) => void;
    let joinedOnce = false;
    const joined = new Promise<void>((resolve, reject) => { resolveJoin = resolve; rejectJoin = reject; });
    this.rejectJoin = rejectJoin;
    const timeout = setTimeout(() => rejectJoin(new Error('Voice Inbox subscription timed out.')), this.options.joinTimeoutMs ?? 15_000);
    timeout.unref?.();
    // Postgres Changes is authenticated and protected by transcript row RLS;
    // this channel neither sends nor receives client Broadcast messages.
    const channel = client.channel(`voice-inbox:${owner}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transcripts', filter: `user_id=eq.${owner}` }, (payload) => {
        if (!this.current(epoch, owner)) return;
        try {
          const row = payload.new as Row;
          // Apply the event itself as well as ordered catch-up: a transaction
          // may commit with an updated_at older than the durable high-water mark.
          if (row?.user_id === owner && typeof row.client_id === 'string') {
            this.options.store.materialize(owner, [this.transcript(row, owner)]);
          }
          void this.refresh().catch(() => this.report(epoch, owner));
        } catch { this.report(epoch, owner); }
      });
    this.channel = channel;
    channel.subscribe((status) => {
      if (!this.current(epoch, owner)) { rejectJoin(new Error('Voice Inbox account changed.')); return; }
      if (status === 'SUBSCRIBED') {
        this.subscribed = true;
        if (!joinedOnce) { joinedOnce = true; resolveJoin(); }
        else void this.requestSync(true).catch(() => this.report(epoch, owner));
      } else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) {
        this.subscribed = false;
        rejectJoin(new Error('Voice Inbox connection is unavailable.'));
        this.report(epoch, owner);
      }
    });
    try {
      await joined;
      if (this.current(epoch, owner)) await this.requestSync(true);
    } catch (error) {
      if (this.current(epoch, owner)) {
        this.report(epoch, owner);
        if (!joinedOnce && this.channel === channel) {
          this.channel = null;
          void client.removeChannel(channel).catch(() => {});
        }
        throw error;
      }
    } finally {
      clearTimeout(timeout);
      if (this.rejectJoin === rejectJoin) this.rejectJoin = null;
    }
  }

  async resume(): Promise<void> { this.stop(); await this.authChanged(); }

  stop(): void {
    this.epoch++;
    this.rejectJoin?.(new Error('Voice Inbox stopped.'));
    this.rejectJoin = null;
    const channel = this.channel;
    const client = this.client;
    this.channel = null;
    this.client = null;
    this.owner = null;
    this.syncPromise = null;
    this.requested = false;
    this.reconcileRequested = false;
    this.subscribed = false;
    if (channel && client) void client.removeChannel(channel).catch(() => {});
  }

  /** Call on an existing Voice job wake too, to import another Mac's confirmed destination. */
  refresh(): Promise<void> {
    return this.requestSync(false);
  }

  private requestSync(reconcile: boolean): Promise<void> {
    if (!this.owner || !this.client) return Promise.resolve();
    this.requested = true;
    this.reconcileRequested ||= reconcile;
    if (!this.subscribed) return Promise.resolve();
    if (this.syncPromise) return this.syncPromise;
    const owner = this.owner;
    const client = this.client;
    const epoch = this.epoch;
    const work = (async () => {
      do {
        this.requested = false;
        const full = this.reconcileRequested;
        this.reconcileRequested = false;
        try {
          await this.catchUp('transcripts', owner, client, epoch, full);
          if (!this.current(epoch, owner)) return;
          await this.catchUp('jobs', owner, client, epoch, full);
        } catch (error) {
          if (full && this.current(epoch, owner)) this.reconcileRequested = true;
          throw error;
        }
      } while (this.current(epoch, owner) && this.requested);
    })();
    this.syncPromise = work;
    void work.then(() => { if (this.syncPromise === work) this.syncPromise = null; },
      () => { if (this.syncPromise === work) this.syncPromise = null; });
    return work;
  }

  private async catchUp(kind: VoiceInboxCursorKind, owner: string, client: SupabaseClient, epoch: number, reconcile: boolean): Promise<void> {
    const table = kind === 'transcripts' ? 'transcripts' : 'voice_jobs';
    const idColumn = kind === 'transcripts' ? 'id' : 'job_id';
    // updated_at is assigned before commit, so offline recovery must also see
    // transactions that committed later with an older timestamp. Reconcile on
    // every subscription; ordinary event wakes can use the durable cursor.
    let cursor = reconcile ? null : this.options.store.getCursor(owner, kind);
    let boundaryPage = true;
    while (this.current(epoch, owner)) {
      let query = client.from(table).select(fields[kind]).eq('user_id', owner)
        .order('updated_at', { ascending: true }).order(idColumn, { ascending: true }).limit(this.pageSize);
      if (cursor) {
        this.validateCursor(cursor);
        // Re-read the saved timestamp boundary on each reconnect/refresh, then
        // keyset-page its ties. A late equal-timestamp row with a lower ID is
        // not skipped, and idempotent materialization prevents duplicate notes.
        query = boundaryPage ? query.gte('updated_at', cursor.updatedAt)
          : query.or(`updated_at.gt.${cursor.updatedAt},and(updated_at.eq.${cursor.updatedAt},${idColumn}.gt.${cursor.id})`);
      }
      boundaryPage = false;
      const { data, error } = await query;
      if (!this.current(epoch, owner)) return;
      if (error || !Array.isArray(data)) throw new Error('Voice Inbox history is unavailable.');
      const rows = data as unknown as Row[];
      for (const [index, row] of rows.entries()) {
        if (!this.current(epoch, owner)) return;
        if (row.user_id !== owner) throw new Error('Voice Inbox history belongs to another account.');
        const next = { updatedAt: String(row.updated_at), id: String(row[idColumn]) };
        this.validateCursor(next);
        if (kind === 'transcripts') this.options.store.materialize(owner, [this.transcript(row, owner)]);
        else if (typeof row.thread_id === 'string' && uuid.test(row.thread_id)
          && (row.status === 'completed' || (typeof row.turn_id === 'string' && row.turn_id.trim()))) {
          this.options.store.recordDispatch(owner, {
            transcriptId: String(row.transcript_id), threadId: row.thread_id,
            turnId: typeof row.turn_id === 'string' ? row.turn_id : undefined,
            completed: row.status === 'completed',
            dispatchedAt: typeof row.dispatch_started_at === 'string' ? row.dispatch_started_at : next.updatedAt,
          });
        }
        cursor = next;
        if ((index + 1) % 20 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
      }
      if (cursor && this.current(epoch, owner)) this.options.store.setCursor(owner, kind, cursor);
      if (rows.length < this.pageSize) return;
      // Bound each read and yield between pages so sign-out cancels promptly.
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }

  private transcript(row: Row, owner: string): VoiceInboxTranscript {
    if (typeof row.client_id !== 'string' || typeof row.text !== 'string') throw new Error('Invalid synced transcript.');
    return { userId: owner, transcriptId: row.client_id, text: row.text,
      createdAtMs: Number(row.client_created_at_ms),
      updatedAtMs: Number(row.client_updated_at_ms ?? Date.parse(String(row.updated_at))),
      deletedAt: typeof row.deleted_at === 'string' ? row.deleted_at : null };
  }

  private validateCursor(cursor: VoiceInboxCursor): void {
    if (!uuid.test(cursor.id) || !timestamp.test(cursor.updatedAt) || !Number.isFinite(Date.parse(cursor.updatedAt))) {
      throw new Error('Invalid Voice Inbox history cursor.');
    }
  }

  private current(epoch: number, owner: string): boolean {
    return epoch === this.epoch && owner === this.owner && this.options.auth.getSession()?.user.id === owner;
  }

  private requireOwner(): string {
    if (!this.owner || this.options.auth.getSession()?.user.id !== this.owner) throw new Error('Sign in to Field Theory first.');
    return this.owner;
  }

  private report(epoch: number, owner: string): void {
    if (this.current(epoch, owner)) this.options.onError?.('Voice Inbox sync is unavailable. Saved notes are preserved; reconnect to catch up.');
  }
}
