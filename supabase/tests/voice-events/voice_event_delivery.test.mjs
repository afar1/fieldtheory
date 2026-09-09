import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, test } from 'node:test';

// Uses the real Postgres engine in WASM. Auth identity and Realtime transport
// are local fixtures; these tests do not assert hosted WebSocket delivery.
const { PGlite } = await import(process.env.VOICE_PGLITE_MODULE || '@electric-sql/pglite');
const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
let db;
let sequence = 0;

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users(id uuid primary key);
    insert into auth.users values ('${owner}'), ('${other}');
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    create schema realtime;
    create table realtime.messages (
      id uuid not null default gen_random_uuid(),
      inserted_at timestamp not null default now(),
      updated_at timestamp not null default now(),
      topic text not null, event text, payload jsonb,
      extension text not null, private boolean default false,
      primary key(id, inserted_at)
    );
    alter table realtime.messages enable row level security;
    grant usage on schema realtime to anon, authenticated;
    grant select, insert on realtime.messages to anon, authenticated;
    create function realtime.topic() returns text language sql stable as
      $$select nullif(current_setting('realtime.topic', true), '')$$;
    create function realtime.send(payload jsonb, event text, topic text, private boolean default true)
    returns void language plpgsql as $$declare generated_id uuid := gen_random_uuid(); begin
      if current_setting('test.broadcast_failure', true) = 'true' then
        raise exception 'Simulated broadcast failure';
      end if;
      -- Model the official Supabase send function's id, local topic, and
      -- warning-only exception handler; WebSocket transport remains a fixture.
      begin
        if not payload ? 'id' then payload := jsonb_set(payload, '{id}', to_jsonb(generated_id)); end if;
        perform set_config('realtime.topic', topic, true);
        if current_setting('test.broadcast_failure', true) = 'silent' then
          raise exception 'Simulated missing Realtime partition';
        end if;
        insert into realtime.messages(id,payload,event,topic,private,extension)
          values(generated_id,payload,event,topic,private,'broadcast');
      exception when others then
        raise warning 'WarnSendingBroadcastMessage: %', SQLERRM;
      end;
    end$$;
    create table public.transcripts (
      id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
      client_id text not null, text text not null, client_created_at_ms bigint not null,
      client_updated_at_ms bigint not null, metadata jsonb, deleted_at timestamptz,
      created_at timestamptz not null default clock_timestamp(),
      updated_at timestamptz not null default clock_timestamp(), unique(user_id,client_id)
    );
    alter table public.transcripts enable row level security;
    create policy transcript_owner on public.transcripts for all to authenticated
      using(user_id=auth.uid()) with check(user_id=auth.uid());
    grant select, insert, update, delete on public.transcripts to authenticated;
  `);
  const migration = await readFile(new URL('../../migrations/20260907233700_voice_event_delivery.sql', import.meta.url), 'utf8');
  await db.exec(migration);
  await db.exec(await readFile(new URL('../../migrations/20260910001000_voice_delivery_timeline.sql', import.meta.url), 'utf8'));
});

after(async () => { await db?.close(); });

async function identity(id = owner, role = 'authenticated') {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id || '']);
  await db.exec(`set role ${role}`);
}

beforeEach(async () => {
  await db.exec('reset role');
  await db.exec(`truncate public.voice_jobs, public.voice_event_sources, public.voice_event_settings,
    public.voice_event_config_cursors, public.transcripts, public.voice_delivery_events,
    public.voice_runner_presence, public.voice_runner_events, realtime.messages restart identity;
    select set_config('test.broadcast_failure', 'false', false);
    select set_config('realtime.topic', '', false);`);
  await identity();
});

async function rpc(name, args = []) {
  const placeholders = args.map((_, index) => `$${index + 1}`).join(',');
  return (await db.query(`select public.${name}(${placeholders}) as value`, args)).rows[0].value;
}

async function enable() { return rpc('voice_delivery_configure', [true]); }
async function claim(worker = 'mac-one', limit = 1) { return rpc('voice_jobs_claim', [worker, limit]); }

async function insert(text = 'Investigate this problem', options = {}) {
  const id = options.id || `note-${++sequence}`;
  const created = options.created ?? Date.now() + 100;
  await db.query(`insert into public.transcripts(user_id,client_id,text,client_created_at_ms,client_updated_at_ms,metadata)
    values($1,$2,$3,$4,$4,$5)`, [options.owner || owner, id, text, created, { source: 'ios' }]);
  return id;
}

async function expire(job) {
  await db.exec('reset role');
  await db.query("update public.voice_jobs set lease_expires_at = clock_timestamp() - interval '1 second' where job_id=$1", [job.job_id]);
  await identity();
}

async function recordAndBegin(job, thread = 'actual-thread') {
  const mapped = await rpc('voice_jobs_record_dispatch', [job.job_id, job.lease_token, thread]);
  assert.equal(mapped.ok, true);
  assert.equal(mapped.job.status, 'claimed');
  const begun = await rpc('voice_jobs_begin_dispatch', [job.job_id, job.lease_token]);
  assert.equal(begun.ok, true);
  assert.equal(begun.job.status, 'running');
  return begun.job;
}

test('installation is disabled and inserts cannot execute before explicit opt-in', async () => {
  const state = await rpc('voice_delivery_status');
  assert.equal(state.enabled, false);
  assert.equal(state.generation, 0);
  await insert();
  assert.equal((await claim()).jobs.length, 0);
  assert.equal((await db.query('select count(*)::int as n from public.voice_jobs')).rows[0].n, 0);
});

test('configuration sequences fence a delayed enable after a later pause, including an initially disabled account', async () => {
  const paused = await rpc('voice_delivery_configure', [false, 'mac-one', 2]);
  assert.equal(paused.enabled, false);
  assert.equal(paused.applied, true);
  assert.equal(paused.generation, 0);
  const delayed = await rpc('voice_delivery_configure', [true, 'mac-one', 1]);
  assert.equal(delayed.enabled, false);
  assert.equal(delayed.applied, false);
  assert.equal((await rpc('voice_delivery_configure', [true, 'mac-one', 2])).applied, false);
  const enabled = await rpc('voice_delivery_configure', [true, 'mac-one', 3]);
  assert.equal(enabled.enabled, true);
  assert.equal(enabled.applied, true);
  assert.equal(enabled.generation, 1);
  assert.equal((await rpc('voice_delivery_configure', [true, 'mac-one', 3])).applied, false);
  assert.equal((await rpc('voice_delivery_configure', [false, 'mac-one', 4])).generation, 2);
  assert.equal((await rpc('voice_delivery_configure', [true, 'mac-one', 3])).enabled, false);
});

test('configuration cursors are owner-bound, private, and validate paired parameters', async () => {
  await rpc('voice_delivery_configure', [false, 'shared-device-name', 10]);
  await assert.rejects(db.query('select * from voice_event_config_cursors'), /permission denied/);
  for (const args of [[true, 'mac-one', null], [true, null, 1], [true, ' ', 1],
    [true, 'mac-one', 0], [true, 'mac-one', '9007199254740992']]) {
    await assert.rejects(rpc('voice_delivery_configure', args), /sequence are required together/);
  }
  await identity(other);
  const independent = await rpc('voice_delivery_configure', [true, 'shared-device-name', 1]);
  assert.equal(independent.applied, true);
  assert.equal(independent.enabled, true);
  await identity();
  assert.equal((await rpc('voice_delivery_status')).enabled, false);
});

test('enable baselines existing IDs; edits, later timestamps, and deleted/reinserted IDs do not replay backlog', async () => {
  const id = await insert('Old backlog');
  const settings = await enable();
  assert.equal(settings.enabled, true);
  assert.equal(settings.generation, 1);
  await db.query('update transcripts set text=$1, client_created_at_ms=$2 where client_id=$3', ['Edited old backlog', Date.now() + 100, id]);
  await db.query('delete from transcripts where client_id=$1', [id]);
  await insert('Resurrected backlog', { id });
  assert.equal((await claim()).jobs.length, 0);
  assert.equal((await enable()).generation, 1, 'idempotent enable must not reset the baseline');
});

test('strict client transcript-time and server enable boundaries reject late backlog and implausible future dates', async () => {
  const settings = await enable();
  const cutoff = Date.parse(settings.enabled_at);
  await insert('Old uploaded late', { created: cutoff - 5000 });
  await insert('At boundary', { created: cutoff });
  await insert('Future clock', { created: Date.now() + 600000 });
  const accepted = await insert('New transcript', { created: cutoff + 1 });
  const jobs = (await claim('mac-one', 10)).jobs;
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].transcript_id, accepted);
  assert.equal(jobs[0].text, 'New transcript');
  assert.equal(jobs[0].dispatch_key, `voice:${jobs[0].job_id}`);
  assert.ok(Date.parse(jobs[0].received_at) >= cutoff);
});

test('text revision delivery is immutable and timestamp-only sync duplicates do not create work', async () => {
  await enable();
  const id = await insert('Original request');
  await db.query('update transcripts set updated_at=clock_timestamp(), client_updated_at_ms=client_updated_at_ms+1 where client_id=$1', [id]);
  const original = (await claim()).jobs[0];
  assert.equal(original.text, 'Original request');
  await db.query('update transcripts set text=$1 where client_id=$2', ['Correction: just context', id]);
  const correction = (await claim()).jobs[0];
  assert.equal(correction.previous_text, 'Original request');
  assert.equal(correction.text, 'Correction: just context');
  assert.notEqual(correction.revision, original.revision);
  assert.equal((await rpc('voice_jobs_begin_dispatch', [original.job_id, original.lease_token])).ok, false);
  const stored = (await db.query('select text,status from voice_jobs where job_id=$1', [original.job_id])).rows[0];
  assert.deepEqual(stored, { text: 'Original request', status: 'superseded' });
  await db.query('update transcripts set text=$1 where client_id=$2', ['Original request', id]);
  assert.equal((await db.query('select count(*)::int as n from voice_jobs')).rows[0].n, 2);
  assert.equal((await rpc('voice_jobs_renew', [correction.job_id, correction.lease_token])).ok, false,
    'returning to an already-seen text must fence its obsolete correction');
  assert.deepEqual((await claim()).jobs, [], 'neither an obsolete correction nor an old hash may replay');
});

test('two workers cannot claim the same live lease; expired pre-dispatch lease is fenced and reclaimable', async () => {
  await enable();
  await insert();
  const first = (await claim('mac-one')).jobs[0];
  const standby = await claim('mac-two');
  assert.deepEqual(standby.jobs, []);
  assert.ok(standby.next_wake_at);
  await expire(first);
  const second = (await claim('mac-two')).jobs[0];
  assert.equal(second.job_id, first.job_id);
  assert.notEqual(second.lease_token, first.lease_token);
  assert.equal(second.attempts, 2);
  assert.equal((await rpc('voice_jobs_renew', [first.job_id, first.lease_token])).ok, false);
  assert.equal((await rpc('voice_jobs_renew', [second.job_id, second.lease_token])).ok, true);
});

test('record actual owner before starting a turn; expired dispatched work can only be reconciled, never begun again', async () => {
  await enable();
  await insert();
  const job = (await claim()).jobs[0];
  assert.equal((await rpc('voice_jobs_begin_dispatch', [job.job_id, job.lease_token])).ok, false);
  const running = await recordAndBegin(job);
  assert.ok(running.dispatch_started_at);
  assert.equal((await rpc('voice_jobs_begin_dispatch', [job.job_id, job.lease_token])).ok, false);
  await expire(job);
  const recovered = (await claim('mac-two')).jobs[0];
  assert.equal(recovered.status, 'running');
  assert.equal(recovered.thread_id, 'actual-thread');
  assert.equal(recovered.dispatch_started_at, running.dispatch_started_at);
  assert.equal((await rpc('voice_jobs_begin_dispatch', [recovered.job_id, recovered.lease_token])).ok, false);
  const stopped = await rpc('voice_jobs_retry', [recovered.job_id, recovered.lease_token, 'Unknown task outcome', 15]);
  assert.equal(stopped.job.status, 'needs_user');
  assert.equal((await claim()).jobs.length, 0);
});

test('edits wait for the existing task, then claim the latest durable owner', async () => {
  await enable();
  const id = await insert('Original');
  const first = (await claim('mac-one')).jobs[0];
  await recordAndBegin(first, 'owner-thread');
  await db.query('update transcripts set text=$1 where client_id=$2', ['Follow up', id]);
  assert.equal((await claim('mac-two')).jobs.length, 0);
  const completed = await rpc('voice_jobs_complete', [first.job_id, first.lease_token, 'completed', 'Verified result', { answer: 'Done' }]);
  assert.equal(completed.ok, true);
  const followup = (await claim('mac-two')).jobs[0];
  assert.equal(followup.previous_thread_id, 'owner-thread');
  assert.equal(followup.previous_text, 'Original');
});

test('uncertain execution holds later corrections, while a completed clarification can receive a follow-up', async () => {
  await enable();
  const uncertainId = await insert('Uncertain execution');
  const uncertain = (await claim()).jobs[0];
  await recordAndBegin(uncertain, 'uncertain-thread');
  await rpc('voice_jobs_complete', [uncertain.job_id, uncertain.lease_token, 'needs_user',
    'The existing turn may still be active', { recovery_uncertain: true, error_code: 'dispatch_outcome_unknown' }]);
  await db.query('update transcripts set text=$1 where client_id=$2', ['Correction during uncertainty', uncertainId]);
  assert.deepEqual((await claim()).jobs, []);

  const clarificationId = await insert('Clarification needed');
  const clarification = (await claim()).jobs[0];
  assert.equal(clarification.transcript_id, clarificationId);
  await recordAndBegin(clarification, 'clarification-thread');
  await rpc('voice_jobs_complete', [clarification.job_id, clarification.lease_token, 'needs_user',
    'Which project should I use?', {}]);
  await db.query('update transcripts set text=$1 where client_id=$2', ['Use this project', clarificationId]);
  const followup = (await claim()).jobs[0];
  assert.equal(followup.transcript_id, clarificationId);
  assert.equal(followup.previous_thread_id, 'clarification-thread');
});

test('retry after the dispatch boundary persists uncertainty and holds corrections', async () => {
  await enable();
  const id = await insert();
  const first = (await claim()).jobs[0];
  await recordAndBegin(first);
  const retry = await rpc('voice_jobs_retry', [first.job_id, first.lease_token, 'Connection disappeared', 15]);
  assert.equal(retry.job.status, 'needs_user');
  assert.equal(retry.job.result.recovery_uncertain, true);
  await db.query('update transcripts set text=$1 where client_id=$2', ['Follow up', id]);
  assert.deepEqual((await claim()).jobs, []);
});

test('a durable retry returns a one-shot deadline and is not claimable before it', async () => {
  await enable();
  await insert();
  const job = (await claim()).jobs[0];
  assert.equal((await rpc('voice_jobs_retry', [job.job_id, job.lease_token, 'Codex unavailable', 60])).job.status, 'retry');
  const waiting = await claim('mac-two');
  assert.deepEqual(waiting.jobs, []);
  assert.ok(Date.parse(waiting.next_wake_at) > Date.parse(waiting.server_now));
  await db.exec('reset role');
  await db.query("update voice_jobs set available_at=clock_timestamp()-interval '1 second' where job_id=$1", [job.job_id]);
  await identity();
  assert.equal((await claim('mac-two')).jobs[0].job_id, job.job_id);
});

test('pause fences in-flight workers and broadcasts a newer generation; re-enable cannot replay prior work', async () => {
  await enable();
  const id = await insert();
  const job = (await claim()).jobs[0];
  await recordAndBegin(job);
  const paused = await rpc('voice_delivery_configure', [false]);
  assert.equal(paused.enabled, false);
  assert.equal(paused.generation, 2);
  assert.equal((await rpc('voice_jobs_renew', [job.job_id, job.lease_token])).ok, false);
  assert.equal((await rpc('voice_jobs_complete', [job.job_id, job.lease_token, 'completed', 'Stale result', {}])).ok, false);
  assert.deepEqual((await claim()).jobs, []);
  assert.equal((await enable()).generation, 3);
  await db.query('update transcripts set text=$1 where client_id=$2', ['Edited after reenabling', id]);
  assert.deepEqual((await claim()).jobs, []);
  await insert('A genuinely new transcript');
  assert.equal((await claim()).jobs.length, 1);
  await db.exec('reset role');
  const wake = (await db.query("select payload from realtime.messages where payload->>'generation'='2' order by id desc limit 1")).rows[0];
  assert.equal(wake.payload.generation, 2);
});

test('context is terminal without creating a task and cannot be completed as executed work', async () => {
  await enable();
  await insert('Just context, do not act');
  const job = (await claim()).jobs[0];
  await assert.rejects(rpc('voice_jobs_complete', [job.job_id, job.lease_token, 'completed', 'No execution', {}]), /dispatch is required/);
  const result = await rpc('voice_jobs_complete', [job.job_id, job.lease_token, 'context', 'Saved as context', {}]);
  assert.equal(result.job.status, 'context');
  assert.deepEqual((await claim()).jobs, []);
});

test('remote soft and hard deletion fence pending work without claiming to undo external effects', async () => {
  await enable();
  const soft = await insert('Delete me');
  const job = (await claim()).jobs[0];
  await recordAndBegin(job);
  await db.query('update transcripts set deleted_at=clock_timestamp() where client_id=$1', [soft]);
  assert.equal((await rpc('voice_jobs_renew', [job.job_id, job.lease_token])).ok, false);
  assert.equal((await db.query('select status from voice_jobs where job_id=$1', [job.job_id])).rows[0].status, 'cancelled');
  const hard = await insert('Also delete me');
  await db.query('delete from transcripts where client_id=$1', [hard]);
  assert.deepEqual((await claim()).jobs, []);
});

test('owner RLS, RPCs, and generation fences resist a different account and direct status tampering', async () => {
  await enable();
  await insert();
  const job = (await claim()).jobs[0];
  await assert.rejects(db.query("update voice_jobs set status='completed'"), /permission denied/);
  await assert.rejects(rpc('_voice_jobs_wake', [owner, 1, job.job_id]), /permission denied/);
  await identity(other);
  assert.deepEqual((await db.query('select * from voice_jobs')).rows, []);
  assert.equal((await rpc('voice_jobs_renew', [job.job_id, job.lease_token])).ok, false);
  assert.equal((await rpc('voice_jobs_record_dispatch', [job.job_id, job.lease_token, 'wrong-owner'])).ok, false);
  assert.equal((await rpc('voice_delivery_status')).enabled, false);
  await identity(null);
  await assert.rejects(rpc('voice_delivery_status'), /Authentication required/);
  await identity(null, 'anon');
  await assert.rejects(rpc('voice_jobs_claim', ['attacker', 1]), /permission denied/);
});

test('private wake signals contain no transcript text and restrictive RLS resists broad existing policies', async () => {
  await enable();
  await insert('Sensitive request that must stay out of the wake payload');
  await db.exec('reset role');
  const messages = (await db.query('select * from realtime.messages')).rows;
  assert.ok(messages.length >= 2);
  for (const message of messages) {
    assert.equal(message.topic, `voice-jobs:${owner}`);
    assert.equal(message.private, true);
    assert.ok(['voice_jobs_changed','voice_delivery_changed'].includes(message.event));
    assert.equal(message.payload.id, message.id, 'Supabase supplies its own transport message ID');
    assert.deepEqual(Object.keys(message.payload).sort(), message.event === 'voice_delivery_changed'
      ? ['id','schema_version'] : message.payload.job_id
      ? ['generation', 'id', 'job_id', 'schema_version', 'wake_id'] : ['generation', 'id', 'schema_version', 'wake_id']);
  }
  await db.exec(`create policy test_broad_read on realtime.messages for select to anon, authenticated using(true);
    create policy test_broad_send on realtime.messages for insert to anon, authenticated with check(true);`);
  try {
    await identity(null, 'anon');
    await db.query("select set_config('realtime.topic',$1,false)", [`voice-jobs:${owner}`]);
    assert.deepEqual((await db.query('select * from realtime.messages')).rows, []);
    await assert.rejects(db.query("insert into realtime.messages(topic,event,payload,extension) values($1,'voice_jobs_changed','{}','broadcast')", [`voice-jobs:${owner}`]), /row-level security/);
    await identity(other);
    await db.query("select set_config('realtime.topic',$1,false)", [`voice-jobs:${owner}`]);
    assert.deepEqual((await db.query('select * from realtime.messages')).rows, []);
    await identity();
    await db.query("select set_config('realtime.topic',$1,false)", [`voice-jobs:${owner}`]);
    assert.ok((await db.query('select * from realtime.messages')).rows.length > 0);
    await assert.rejects(db.query("insert into realtime.messages(topic,event,payload,extension) values($1,'voice_jobs_changed','{}','broadcast')", [`voice-jobs:${owner}`]), /row-level security/);
    await db.query("select set_config('realtime.topic','unrelated-topic',false)");
    await db.query("insert into realtime.messages(topic,event,payload,extension) values('unrelated-topic','existing_event','{}','broadcast')");
    const unrelated = (await db.query('select topic from realtime.messages')).rows;
    assert.deepEqual(unrelated, [{ topic: 'unrelated-topic' }], 'guards preserve unrelated topic policies');
  } finally {
    await db.exec('reset role; drop policy test_broad_read on realtime.messages; drop policy test_broad_send on realtime.messages;');
  }
});

test('a wake failure rolls back transcript and job together, preserving retry instead of losing work', async () => {
  await enable();
  await db.query("select set_config('test.broadcast_failure','true',false)");
  await assert.rejects(insert('Retry this upload', { id: 'failed-wake' }), /Simulated broadcast failure/);
  await db.query("select set_config('test.broadcast_failure','false',false)");
  assert.equal((await db.query('select count(*)::int as n from transcripts')).rows[0].n, 0);
  assert.equal((await db.query('select count(*)::int as n from voice_jobs')).rows[0].n, 0);
  await insert('Retry this upload', { id: 'failed-wake' });
  assert.equal((await claim()).jobs.length, 1);
});

test('the hosted warning-only realtime.send failure also rolls back safely', async () => {
  await enable();
  await db.query("select set_config('test.broadcast_failure','silent',false)");
  await assert.rejects(insert('Silently missed wake'), /Voice notification unavailable/);
  await db.query("select set_config('test.broadcast_failure','false',false)");
  assert.equal((await db.query('select count(*)::int as n from transcripts')).rows[0].n, 0);
  assert.equal((await db.query('select count(*)::int as n from voice_jobs')).rows[0].n, 0);
});

test('failed configuration wakes roll back the cursor so the same command sequence can be retried', async () => {
  await db.query("select set_config('test.broadcast_failure','silent',false)");
  await assert.rejects(rpc('voice_delivery_configure', [true, 'mac-one', 1]), /Voice notification unavailable/);
  assert.equal((await rpc('voice_delivery_status')).enabled, false);
  await db.query("select set_config('test.broadcast_failure','false',false)");
  const retried = await rpc('voice_delivery_configure', [true, 'mac-one', 1]);
  assert.equal(retried.applied, true);
  assert.equal(retried.enabled, true);
});

test('timeline distinguishes claim, dispatch authorization, queue acceptance, and actual start', async () => {
  await enable();
  const id = await insert();
  const stages = async () => (await db.query(`select stage from voice_delivery_events where transcript_id=$1 order by recorded_at, case stage when 'uploaded' then 0 when 'received_by_mac' then 1 when 'queued' then 2 when 'started' then 3 else 4 end`, [id])).rows.map(row => row.stage);
  assert.deepEqual(await stages(), ['uploaded']);
  const job = (await claim()).jobs[0];
  assert.deepEqual(await stages(), ['uploaded', 'received_by_mac']);
  await recordAndBegin(job);
  assert.deepEqual(await stages(), ['uploaded', 'received_by_mac']);
  assert.equal((await rpc('voice_jobs_record_progress', [job.job_id,job.lease_token,'queued','actual-thread'])).ok, true);
  assert.deepEqual(await stages(), ['uploaded', 'received_by_mac', 'queued']);
  await assert.rejects(rpc('voice_jobs_record_progress', [job.job_id,job.lease_token,'started','actual-thread']), /Invalid progress/);
  assert.equal((await rpc('voice_jobs_record_progress', [job.job_id,job.lease_token,'started','actual-thread','turn-one'])).ok, true);
  await rpc('voice_jobs_complete', [job.job_id,job.lease_token,'completed','Done',{turn_id:'turn-one'}]);
  assert.deepEqual(await stages(), ['uploaded','received_by_mac','queued','started','completed']);
  assert.equal((await rpc('voice_jobs_record_progress', [job.job_id,job.lease_token,'started','actual-thread','turn-one'])).ok, true);
  assert.equal((await rpc('voice_jobs_record_progress', [job.job_id,job.lease_token,'started','actual-thread','different-turn'])).ok, false);
  assert.equal((await stages()).length, 5);
});

test('timeline rejects stale leases, different threads, cross-account reads and direct writes', async () => {
  await enable(); await insert();
  const job = (await claim()).jobs[0]; await recordAndBegin(job);
  assert.equal((await rpc('voice_jobs_record_progress', [job.job_id,job.lease_token,'queued','wrong-thread'])).ok, false);
  await identity(other);
  assert.deepEqual((await db.query('select * from voice_delivery_events')).rows, []);
  assert.equal((await rpc('voice_jobs_record_progress', [job.job_id,job.lease_token,'queued','actual-thread'])).ok, false);
  await assert.rejects(db.query("insert into voice_delivery_events(job_id,user_id,transcript_id,revision,stage,occurred_at) values($1,$2,'x','x','started',now())",[job.job_id,other]), /permission denied/);
  await identity(); await expire(job);
  assert.equal((await rpc('voice_jobs_record_progress', [job.job_id,job.lease_token,'queued','actual-thread'])).ok, false);
});

test('completion backfills only explicit observed timestamps, never dispatch authorization', async () => {
  await enable(); await insert();
  const job = (await claim()).jobs[0]; await recordAndBegin(job);
  const observed = new Date().toISOString();
  await rpc('voice_jobs_complete',[job.job_id,job.lease_token,'completed','Done',{turn_id:'real-turn',queuedAt:observed,startedAt:observed}]);
  const rows = (await db.query("select stage,turn_id,occurred_at from voice_delivery_events where stage in ('queued','started') order by stage")).rows;
  assert.deepEqual(rows.map(r => [r.stage,r.turn_id]), [['queued',null],['started','real-turn']]);
  assert.equal(new Date(rows[1].occurred_at).toISOString(), observed);
});

test('malformed completion observations do not reject results or invent start', async () => {
  await enable(); await insert();
  const job = (await claim()).jobs[0]; await recordAndBegin(job);
  await rpc('voice_jobs_complete',[job.job_id,job.lease_token,'completed','Done',{turn_id:'real-turn',queuedAt:'2026-99-99T99:99:99Z',startedAt:12}]);
  assert.deepEqual((await db.query("select stage from voice_delivery_events where stage in ('queued','started')")).rows, []);
});

test('runner state handles delayed observations and isolates owners without exposing content in wakes', async () => {
  const latest = new Date().toISOString();
  const older = new Date(Date.now()-10000).toISOString();
  const id = '33333333-3333-4333-8333-333333333333';
  assert.equal((await rpc('voice_runner_report',['mac-one','unlock',false,false,true,latest,id])).ok,true);
  assert.equal((await rpc('voice_runner_report',['mac-one','unlock',false,false,true,latest,id])).ok,true);
  await rpc('voice_runner_report',['mac-one','lock',true,false,true,older]);
  assert.equal((await db.query('select locked from voice_runner_presence')).rows[0].locked,false);
  assert.equal((await db.query('select * from voice_runner_events')).rows.length,2);
  await identity(other);
  assert.deepEqual((await db.query('select * from voice_runner_presence')).rows,[]);
  assert.deepEqual((await db.query('select * from voice_runner_events')).rows,[]);
  assert.equal((await rpc('voice_runner_report',['mac-one','unlock',false,false,true,latest,id])).ok,false);
  await db.exec('reset role');
  const messages = (await db.query("select payload from realtime.messages where event='voice_delivery_changed'")).rows;
  assert.ok(messages.length > 0);
  assert.ok(messages.every(({payload}) => Object.keys(payload).every(key => ['schema_version','id'].includes(key))));
});

test('completion cannot infer an actual start from a timestamp without a turn or from invalid dates', async () => {
  await enable();
  const samples = [
    { startedAt: new Date().toISOString() },
    { turn_id:'turn', startedAt:'infinity' },
    { turn_id:'turn', startedAt:'2000-01-01T00:00:00Z' },
    { turn_id:'turn', startedAt:'2099-01-01T00:00:00Z' },
    { turn_id:'turn', startedAt:'2026-02-30T00:00:00Z' },
  ];
  for (const result of samples) {
    await insert();
    const job = (await claim()).jobs[0]; await recordAndBegin(job);
    assert.equal((await rpc('voice_jobs_complete',[job.job_id,job.lease_token,'completed','Done',result])).ok,true);
  }
  assert.deepEqual((await db.query("select * from voice_delivery_events where stage='started'")).rows,[]);
});

test('reclaim retains the first Mac receipt and a telemetry wake outage does not undo accepted progress', async () => {
  await enable(); await insert();
  const first = (await claim()).jobs[0];
  const firstEvent = (await db.query("select * from voice_delivery_events where stage='received_by_mac'")).rows[0];
  await expire(first);
  const next = (await claim('mac-two')).jobs[0]; await recordAndBegin(next);
  await db.query("select set_config('test.broadcast_failure','true',false)");
  assert.equal((await rpc('voice_jobs_record_progress',[next.job_id,next.lease_token,'started','actual-thread','turn'])).ok,true);
  const events = (await db.query("select * from voice_delivery_events where stage='received_by_mac'")).rows;
  assert.equal(events.length,1);
  assert.equal(events[0].event_id,firstEvent.event_id);
  assert.equal(events[0].worker_id,'mac-one');
});

test('runner input and grants restrict writable surface to authenticated structured observations', async () => {
  await assert.rejects(rpc('voice_runner_report',['','lock']), /Invalid runner observation/);
  await assert.rejects(rpc('voice_runner_report',['mac','freeform secret content']), /Invalid runner observation/);
  await assert.rejects(rpc('voice_runner_report',['mac','lock',true,null,null,'infinity']), /Invalid runner observation/);
  await assert.rejects(db.query("insert into voice_runner_presence(user_id,worker_id,last_seen_at,observed_at) values($1,'mac',now(),now())",[owner]), /permission denied/);
  await identity(null,'anon');
  await assert.rejects(rpc('voice_runner_report',['mac','heartbeat']), /permission denied/);
  await assert.rejects(db.query('select * from voice_runner_events'), /permission denied/);
});

test('runner expected owner fences an authentication change before transport', async () => {
  await identity(other);
  await assert.rejects(rpc('voice_runner_report',['mac','lock',true,false,true,null,null,owner]), /Runner account changed/);
  assert.deepEqual((await db.query('select * from voice_runner_events')).rows,[]);
  assert.deepEqual((await db.query('select * from voice_runner_presence')).rows,[]);
  assert.equal((await rpc('voice_runner_report',['mac','heartbeat',null,null,true,null,null,other])).ok,true);
});

test('timeline distinguishes server events, actual Codex time, and observation fallback', async () => {
  await enable(); await insert();
  const job = (await claim()).jobs[0]; await recordAndBegin(job);
  const queued = await rpc('voice_jobs_record_progress',[job.job_id,job.lease_token,'queued','actual-thread']);
  assert.equal(queued.event.time_source,'observed');
  await assert.rejects(rpc('voice_jobs_record_progress',[job.job_id,job.lease_token,'started','actual-thread','turn',null,'invented']), /Invalid progress/);
  const started = await rpc('voice_jobs_record_progress',[job.job_id,job.lease_token,'started','actual-thread','turn',new Date().toISOString(),'codex']);
  assert.equal(started.event.time_source,'codex');
  const uploaded = (await db.query("select time_source from voice_delivery_events where stage='uploaded'")).rows;
  assert.deepEqual(uploaded,[{time_source:'server'}]);
});
