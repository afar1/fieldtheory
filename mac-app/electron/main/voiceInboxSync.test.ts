import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceInboxService } from './voiceInboxService';
import { VoiceInboxSync } from './voiceInboxSync';

const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const thread = '33333333-3333-4333-8333-333333333333';
const id = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;
const time = '2026-09-07T10:00:00.000Z';
type Row = Record<string, unknown>;
type Request = { table: string; fields: string; owner: string; limit: number; lower?: string; after?: string; order: string[] };
function transcript(n: number, extra: Row = {}): Row {
  return { id: id(n), user_id: owner, client_id: `phone-${n}`, text: `Original transcript ${n}.`,
    client_created_at_ms: 1000 + n, client_updated_at_ms: 2000 + n, updated_at: time, deleted_at: null, ...extra };
}
function job(n: number, extra: Row = {}): Row {
  return { job_id: id(n), user_id: owner, transcript_id: `phone-${n}`, thread_id: thread, status: 'running',
    turn_id: null, dispatch_started_at: time, updated_at: time, ...extra };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

class FakeChannel {
  name: string;
  filter: unknown;
  event?: (payload: { new: Row }) => void;
  status?: (status: string) => void;
  constructor(name: string) { this.name = name; }
  on(type: string, filter: unknown, callback: (payload: { new: Row }) => void) {
    expect(type).toBe('postgres_changes'); this.filter = filter; this.event = callback; return this;
  }
  subscribe(callback: (status: string) => void) { this.status = callback; return this; }
}

function harness() {
  const data: Record<string, Row[]> = { transcripts: [], voice_jobs: [] };
  const requests: Request[] = [];
  const channels: FakeChannel[] = [];
  let gate: Promise<void> | null = null;
  let fail = false;
  const removeChannel = vi.fn(async () => 'ok');
  const client = {
    channel: (name: string) => { const channel = new FakeChannel(name); channels.push(channel); return channel; },
    removeChannel,
    from: (table: string) => {
      const request: Request = { table, fields: '', owner: '', limit: 0, order: [] };
      const query = {
        select: (fields: string) => { request.fields = fields; return query; },
        eq: (column: string, value: string) => { expect(column).toBe('user_id'); request.owner = value; return query; },
        order: (column: string) => { request.order.push(column); return query; },
        limit: (limit: number) => { request.limit = limit; return query; },
        gte: (column: string, value: string) => { expect(column).toBe('updated_at'); request.lower = value; return query; },
        or: (value: string) => { request.after = value; return query; },
        then: async (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => {
          requests.push(request);
          const blocked = gate;
          const snapshot = [...data[table]];
          try {
            if (blocked) await blocked;
            if (fail) return resolve({ data: null, error: { message: 'offline' } });
            const key = table === 'transcripts' ? 'id' : 'job_id';
            let rows = snapshot.filter((row) => row.user_id === request.owner);
            if (request.lower) rows = rows.filter((row) => String(row.updated_at) >= request.lower!);
            if (request.after) {
              const match = /^updated_at\.gt\.(.+),and\(updated_at\.eq\.(.+),(?:id|job_id)\.gt\.([a-f0-9-]+)\)$/.exec(request.after)!;
              expect(match).not.toBeNull();
              rows = rows.filter((row) => String(row.updated_at) > match[1]
                || (String(row.updated_at) === match[2] && String(row[key]) > match[3]));
            }
            rows.sort((a, b) => String(a.updated_at).localeCompare(String(b.updated_at)) || String(a[key]).localeCompare(String(b[key])));
            return resolve({ data: rows.slice(0, request.limit), error: null });
          } catch (error) { return reject(error); }
        },
      };
      return query;
    },
  };
  return { client: client as unknown as SupabaseClient, data, requests, channels, removeChannel,
    block: (value: Promise<void> | null) => { gate = value; }, fail: (value: boolean) => { fail = value; } };
}

let root: string;
let store: VoiceInboxService;
let h: ReturnType<typeof harness>;
let sync: VoiceInboxSync;
let activeOwner: string | null;
let onError = vi.fn<(message: string) => void>();
const notes = () => {
  const folder = store.getFolder(owner)!;
  return fs.existsSync(folder) ? fs.readdirSync(folder).filter((name) => name.endsWith('.md')).map((name) => fs.readFileSync(path.join(folder, name), 'utf8')) : [];
};
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
async function start() { const pending = sync.authChanged(); h.channels.at(-1)!.status!('SUBSCRIBED'); await pending; }
beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'voice-inbox-sync-')));
  store = new VoiceInboxService({ stateDirectory: path.join(root, 'state'), libraryRoot: path.join(root, 'Library') });
  h = harness(); activeOwner = owner; onError = vi.fn();
  sync = new VoiceInboxSync({ auth: { getSession: () => activeOwner ? { user: { id: activeOwner } } : null,
    getSupabaseClient: () => h.client }, store, pageSize: 2, onError });
});
afterEach(() => { sync.stop(); fs.rmSync(root, { recursive: true, force: true }); vi.restoreAllMocks(); });

describe('Voice Inbox authenticated history and push sync', () => {
  it('subscribes before history, uses owner filters, and backfills only confirmed destinations', async () => {
    h.data.transcripts = [transcript(1), transcript(2), transcript(3), transcript(4, { user_id: other })];
    h.data.voice_jobs = [job(1), job(2, { turn_id: 'actual-turn' }), job(3, { status: 'completed' })];
    const pending = sync.authChanged();
    expect(h.requests).toHaveLength(0);
    expect(h.channels[0].name).toBe(`voice-inbox:${owner}`);
    expect(h.channels[0].filter).toEqual({ event: '*', schema: 'public', table: 'transcripts', filter: `user_id=eq.${owner}` });
    h.channels[0].status!('SUBSCRIBED'); await pending;
    expect(notes()).toHaveLength(3);
    expect(notes().find((body) => body.includes('transcript 1.'))).not.toContain('Sent to');
    expect(notes().filter((body) => body.includes(`codex://threads/${thread}`))).toHaveLength(2);
    for (const request of h.requests) {
      expect(request.owner).toBe(owner); expect(request.limit).toBe(2);
      expect(request.fields).not.toContain('final_response');
      expect(request.fields).not.toContain('result,');
    }
    expect(h.requests.find((request) => request.table === 'voice_jobs')!.fields).toContain('turn_id:result->>turn_id');
  });

  it('pages tied timestamps, rereads the durable boundary on wakes, and never duplicates notes', async () => {
    h.data.transcripts = [transcript(2), transcript(4), transcript(6), transcript(8), transcript(10)];
    await start();
    expect(notes()).toHaveLength(5);
    expect(store.getCursor(owner, 'transcripts')).toEqual({ updatedAt: time, id: id(10) });
    h.data.transcripts.push(transcript(1));
    h.requests.length = 0;
    await sync.refresh();
    expect(h.requests[0].lower).toBe(time);
    expect(notes()).toHaveLength(6);
    await sync.refresh();
    expect(notes()).toHaveLength(6);
  });

  it('fully reconciles on reconnect and startup so older late commits survive offline gaps', async () => {
    h.data.transcripts = [transcript(5)]; await start();
    h.channels[0].status!('CHANNEL_ERROR');
    const earlier = '2026-09-06T09:00:00.000Z';
    h.data.transcripts.push(transcript(1, { updated_at: earlier }));
    h.data.voice_jobs.push(job(1, { updated_at: earlier, turn_id: 'confirmed-before-reconnect' }));
    h.requests.length = 0;
    h.channels[0].status!('SUBSCRIBED'); await sync.refresh();
    expect(h.requests[0].lower).toBeUndefined();
    expect(notes().find((body) => body.includes('transcript 1.'))).toContain(`codex://threads/${thread}`);
    sync.stop();
    h.data.transcripts.push(transcript(2, { updated_at: earlier }));
    store = new VoiceInboxService({ stateDirectory: path.join(root, 'state'), libraryRoot: path.join(root, 'Library') });
    sync = new VoiceInboxSync({ auth: { getSession: () => ({ user: { id: owner } }), getSupabaseClient: () => h.client },
      store, pageSize: 2, onError });
    // A fresh subscription always scans from the start even with a persisted cursor.
    h.requests.length = 0; await start();
    expect(h.requests[0].lower).toBeUndefined();
    expect(notes()).toHaveLength(3);
  });

  it('applies a live transaction older than the cursor and ignores another account event', async () => {
    h.data.transcripts = [transcript(5)]; await start();
    const older = transcript(1, { updated_at: '2026-09-01T00:00:00.000Z' });
    h.channels[0].event!({ new: older }); await sync.refresh();
    expect(notes()).toHaveLength(2);
    h.channels[0].event!({ new: transcript(2, { user_id: other }) }); await sync.refresh();
    expect(notes()).toHaveLength(2);
  });

  it('fences in-flight old-account writes and cursors when accounts change', async () => {
    const blocked = deferred<void>(); h.block(blocked.promise);
    h.data.transcripts = [transcript(1), transcript(2, { user_id: other })];
    const first = sync.authChanged(); h.channels[0].status!('SUBSCRIBED'); await tick();
    activeOwner = other;
    const second = sync.authChanged(); h.channels[1].status!('SUBSCRIBED');
    blocked.resolve(); await Promise.all([first, second]);
    expect(store.getCursor(owner, 'transcripts')).toBeNull();
    expect(store.getCursor(other, 'transcripts')!.id).toBe(id(2));
    expect(notes()).toHaveLength(1);
    expect(notes()[0]).toContain('transcript 2.');
    expect(h.removeChannel).toHaveBeenCalledWith(h.channels[0]);
    h.channels[0].event!({ new: transcript(3) }); await tick();
    expect(notes()).toHaveLength(1);
  });

  it('stops without writing a pending snapshot or cursor', async () => {
    const blocked = deferred<void>(); h.block(blocked.promise); h.data.transcripts = [transcript(1)];
    const pending = sync.authChanged(); h.channels[0].status!('SUBSCRIBED'); await tick();
    sync.stop(); blocked.resolve(); await pending;
    expect(store.getCursor(owner, 'transcripts')).toBeNull(); expect(notes()).toHaveLength(0);
  });

  it('reports a failed read without advancing the cursor or retrying continuously', async () => {
    store.setCursor(owner, 'transcripts', { updatedAt: time, id: id(5) });
    h.fail(true);
    const pending = sync.authChanged(); h.channels[0].status!('SUBSCRIBED');
    await expect(pending).rejects.toThrow(/history/);
    expect(store.getCursor(owner, 'transcripts')).toEqual({ updatedAt: time, id: id(5) });
    const count = h.requests.length; await tick(); await tick();
    expect(h.requests).toHaveLength(count); expect(onError).toHaveBeenCalled();
    h.fail(false); h.data.transcripts = [transcript(1, { updated_at: '2026-09-06T00:00:00.000Z' })]; await sync.refresh();
    expect(notes()).toHaveLength(1);
    expect(h.requests[1].lower).toBeUndefined();
  });

  it('coalesces wake bursts while a read is pending and does no polling after completion', async () => {
    await start();
    const blocked = deferred<void>(); h.block(blocked.promise); h.requests.length = 0;
    const pending = sync.refresh(); await tick();
    const others = Array.from({ length: 20 }, () => sync.refresh());
    blocked.resolve(); await Promise.all([pending, ...others]);
    expect(h.requests.filter((request) => request.table === 'transcripts')).toHaveLength(2);
    const count = h.requests.length; await tick(); await tick(); expect(h.requests).toHaveLength(count);
  });
});
