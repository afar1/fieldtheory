# Voice event delivery backend

Migration `supabase/migrations/20260907233700_voice_event_delivery.sql` prepares opt-in, authenticated Supabase Realtime delivery to the bundled Mac worker. Installation leaves every account disabled. This document is an operator runbook; users enable the feature in Field Theory Settings and do not run SQL, install a CLI, or configure a webhook.

## Delivery contract

- The private channel is `voice-jobs:<auth.uid()>`; the event is `voice_jobs_changed`. The application payload contains `schema_version`, `generation`, a unique `wake_id`, and an optional `job_id`; current Supabase also adds its generated transport `id`. It contains no transcript text, result, or credential.
- `voice_jobs` is the durable queue and receipt ledger. A wake means “reconcile your queue.” The Mac claims after a successful subscription/reconnection, on a wake, or at a one-shot deadline attached to an existing retry/lease. It does not poll transcripts.
- All mutating RPCs take an account advisory lock. Claims use a 90-second lease, a fresh lease token, and the currently enabled generation. Pause invalidates prior leases and cancels unfinished jobs; a stale worker cannot renew or complete them.
- `voice_delivery_configure(p_enabled, p_worker_id, p_sequence)` accepts a persisted, increasing sequence for each account/Mac pair. The app persists the sequence before the request. A sequence less than or equal to the last accepted sequence returns current settings with `applied: false`; a newly accepted request returns `applied: true`, including an idempotent request. This prevents a delayed enable from undoing that Mac's later pause. Sequences do not impose ordering between different Macs. The optional one-argument form is retained for controlled operator use and local tests; the app always supplies the cursor pair.
- The worker records the actual Codex thread using `voice_jobs_record_dispatch`, then calls `voice_jobs_begin_dispatch`, then starts a turn. The begin RPC atomically marks the job `running` and persists `dispatch_started_at`. Reclaimed running work must be reconciled in its recorded thread; it cannot begin again.
- Revisions of one transcript are serialized. A new text supersedes undispatched older text. A return to an already-seen text does not replay that hash and stops any undispatched nonmatching revision. `needs_user` with `result.recovery_uncertain: true` holds later revisions. A normal clarification from a completed turn does not hold them.
- Only the owner can read settings/jobs or call public RPCs. Clients cannot write those tables or read the baseline/cursor tables. Restrictive Realtime policies prevent `anon` and `authenticated` from publishing Voice wakes or receiving another account's Voice topic, even alongside broad permissive policies. Other topics keep their existing policies.

Enabling baselines existing transcript IDs. A newly inserted ID is eligible only when its `client_created_at_ms` is strictly after the server enable cutoff and at most five minutes ahead of the server. Edits or deletion/reinsertion of baselined IDs do not execute old material. This is a **transcript creation clock**, not a proven microphone-start clock: the current phone does not persist microphone-start time in this column. A recording started before enable but transcribed afterward may therefore qualify. Do not describe this as physical capture-time exclusion.

## What the wake check guarantees

`realtime.send()` catches insertion errors and can return after emitting a warning. `_voice_jobs_wake` verifies that its exact `wake_id` was inserted into `realtime.messages`. A missing row raises SQLSTATE `55000`, rolling back the transcript/job or configuration transaction together so the caller can retry. The Mac must successfully join its private channel before first enable: Realtime may not create daily message partitions until a WebSocket client connects. See [Supabase's warning guidance](https://supabase.com/docs/guides/troubleshooting/realtime-warn-sending-broadcast-message).

The persisted row proves database acceptance, not WebSocket receipt or Codex execution. Broadcast has no historical replay, so queue reconciliation on subscription/reconnection is required. A connected client and working replication consumer remain deployment prerequisites. Supabase describes database broadcasts as rows in its WAL-backed `realtime.messages` table, with temporary retention, in [Broadcast](https://supabase.com/docs/guides/realtime/broadcast). Permission checks occur when a private channel joins or refreshes its token, as described in [Realtime Authorization](https://supabase.com/docs/guides/realtime/authorization).

The local fixture mirrors the generated payload `id`, transaction-local topic setting, and warning handler in [Supabase's send implementation](https://github.com/supabase/realtime/blob/main/lib/realtime/tenants/repo/migrations/20260605120000_rename_broadcast_send_warning.ex). Recheck the deployed function when upgrading Realtime.

An unavailable Realtime insert causes enabled users' affected transcript writes and receipt writes to fail until service recovers. This is intentional transactional behavior; the phone's existing sync retry preserves the local transcript. Turning delivery off also needs its wake to persist. The operational rollback below can disable delivery if that transport is unavailable.

## Deployment prerequisites and manual application

Production activation was explicitly authorized and completed on September 7, 2026, for the Field Theory project `cighxaroptskntwbrctl`. See [the deployment receipt](VOICE_PRODUCTION_ACTIVATION.md) for the exact migration, target checks, installed-app canary, and remaining physical acceptance. For subsequent deployments, review and authorize the target first. Existing schema migrations, particularly `001_init_schema.sql`, `003_rls_policies.sql`, `006_transcripts_metadata.sql`, and `017_mobile_row_soft_delete_timestamps.sql`, must already be applied.

Use the project's approved database migration identity, with permission to create public objects, manage policies on `realtime.messages`, and execute/read the Realtime functions/table from the new security-definer functions. Keep database credentials in the operator's approved connection configuration. The commands below use a preconfigured `psql` service named `field_theory_staging`; replace that service name with the approved target. Do not put connection passwords or user tokens in a shell command or this document.

Read-only preflight:

```sql
select current_database(), current_user, version();
select to_regclass('public.transcripts') as transcripts,
       to_regprocedure('auth.uid()') as auth_uid,
       to_regclass('realtime.messages') as realtime_messages,
       to_regprocedure('realtime.send(jsonb,text,text,boolean)') as realtime_send,
       to_regprocedure('realtime.topic()') as realtime_topic;
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'transcripts'
  and column_name in ('user_id', 'client_id', 'text', 'metadata', 'client_created_at_ms',
                      'client_updated_at_ms', 'deleted_at')
order by column_name;
select relrowsecurity from pg_class where oid = 'realtime.messages'::regclass;
select policyname, permissive, roles, cmd
from pg_policies where schemaname = 'realtime' and tablename = 'messages';
```

Expect all five prerequisite objects, all seven transcript columns, and Realtime RLS enabled. Inspect existing policies for compatibility. Realtime must be running with private Broadcast support; the app must authenticate the WebSocket with its current Supabase user session and use `private: true`. The normal publishable/anon project key plus the user's session is sufficient; no service-role key belongs in the app. The migration uses Supabase's existing database Broadcast infrastructure; it does not require adding transcript text or `voice_jobs` to a Postgres Changes publication. Leave any pre-existing transcript sync publication alone.

From the repository root, after target review and deployment authorization:

```sh
psql 'service=field_theory_staging' -X --set=ON_ERROR_STOP=1 --single-transaction --file=supabase/migrations/20260907233700_voice_event_delivery.sql
```

This is a one-time migration with ordinary `create` statements. Do not rerun it against an installed schema or use a broad `db push` that also applies unrelated pending migrations. Record the migration in the project's established deployment ledger if this manual SQL path does not do that automatically.

The original candidate filename was `021_voice_event_delivery.sql`. Production already used version `021` for `newspaper_covers`, so Voice was renamed to `20260907233700_voice_event_delivery.sql` before application. Its SQL content was unchanged. The production application used the authenticated Supabase CLI in an isolated linked workspace, with an explicit transaction around the migration and its `supabase_migrations.schema_migrations` entry, followed by a PostgREST schema reload notification. No other migrations were applied.

Read-only installation verification:

```sql
select c.relname, c.relrowsecurity
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in
  ('voice_event_settings', 'voice_event_sources', 'voice_event_config_cursors', 'voice_jobs');
select tgname, tgenabled from pg_trigger
where tgrelid = 'public.transcripts'::regclass and tgname = 'voice_transcript_event_delivery';
select enabled, count(*) from public.voice_event_settings group by enabled;
select count(*) as jobs_before_opt_in from public.voice_jobs;
select proname, pg_get_function_identity_arguments(p.oid) as arguments,
       prosecdef, proconfig
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and (proname like 'voice_%' or proname like '_voice_%')
order by proname;
select has_function_privilege('authenticated',
         'public.voice_delivery_configure(boolean,text,bigint)', 'EXECUTE') as owner_configure,
       has_function_privilege('anon',
         'public.voice_delivery_configure(boolean,text,bigint)', 'EXECUTE') as anon_configure,
       has_function_privilege('authenticated',
         'public._voice_jobs_wake(uuid,bigint,uuid)', 'EXECUTE') as client_internal_wake,
       has_table_privilege('authenticated', 'public.voice_jobs', 'UPDATE') as client_job_update;
```

Expect four RLS-enabled tables, an enabled trigger (`O`), zero settings/jobs immediately after a fresh installation, empty function search paths, and privilege results `true, false, false, false`. Status RPCs from a signed-in user should return disabled/generation zero. Anonymous calls must fail. Do not use an admin session to claim that user RLS was verified.

## Required hosted and physical acceptance

Use an authorized test account and harmless requests in its selected scratch workspace. Record the app build, target project, account labels, job ID, thread ID, and observed states; omit tokens and transcript content from infrastructure logs.

1. Install/open the packaged Mac app, sign into Field Theory and Codex through their normal flows, select the workspace, and enable Voice requests. Confirm the private channel joined before configuration succeeded. No development server, terminal worker, webhook, or transcript polling should be required.
2. On the physical phone, verify an existing transcript and a late upload created before enable produce no jobs. Submit a new harmless request after enable and observe its durable job, private wake, actual Codex task, and visible final receipt. Separately submit “just context, do not act” and confirm a terminal context receipt without tool execution. The Codex task used to interpret that recording may still exist.
3. Observe the wake payload in a controlled subscriber and verify only the documented identifiers appear. Using a separate signed-in account and an anonymous client, try to join the first account's **private** Voice topic and publish a Voice wake; both operations must be denied. Reconnect after policy changes because existing channel authorization is cached.
4. Disconnect the Mac, create a new eligible transcript, then reconnect it. Confirm initial queue reconciliation finds the durable work despite Broadcast having no replay. Repeat a same-text sync update and verify no second task starts.
5. Edit an undispatched request, then revert its text; confirm the obsolete correction cannot execute. Edit while a task runs; confirm the next revision waits and continues the same recorded thread after a terminal result. An uncertain recovery must require reconciliation; an ordinary completed clarification must accept its follow-up.
6. Pause while work is claimed, then restore/restart the old worker. Confirm stale lease renewal/completion fails and a delayed older enable response cannot re-enable the account. Re-enable and verify that old IDs remain baseline. Test account switching and ensure no previous account's job runs.
7. Interrupt the worker after it records a thread, and again after the dispatch boundary. Confirm recovery inspects the recorded thread and never starts a duplicate turn blindly. An active/unknown result must remain `needs_user` with `recovery_uncertain: true`.

SQL counts, the local database tests, and a successful `realtime.messages` insert do not substitute for these observations. Measure phone request submission to the visible Mac result only during this real path.

## Operational rollback without deleting receipts

First pause/quit the Mac workers and stop new delivery canaries. Confirm the rollback target and obtain deployment authorization. This transaction disables the trigger and user mutation RPCs, fences generations/leases, and retains all transcript data, baseline IDs, cursors, and receipts. It cannot undo effects already started in Codex. Save this SQL to an operator-reviewed file and run it using the same `psql` flags above.

```sql
alter table public.transcripts disable trigger voice_transcript_event_delivery;
revoke execute on function
  public.voice_delivery_configure(boolean, text, bigint),
  public.voice_jobs_claim(text, integer),
  public.voice_jobs_renew(uuid, uuid),
  public.voice_jobs_begin_dispatch(uuid, uuid),
  public.voice_jobs_record_dispatch(uuid, uuid, text),
  public.voice_jobs_complete(uuid, uuid, text, text, jsonb),
  public.voice_jobs_retry(uuid, uuid, text, integer)
from public, anon, authenticated;
update public.voice_event_settings
set enabled = false, generation = generation + 1, updated_at = clock_timestamp();
update public.voice_jobs
set status = 'cancelled', lease_token = null, lease_expires_at = null,
    summary = 'Voice delivery was disabled by the operator. Existing effects are not undone.',
    updated_at = clock_timestamp()
where status in ('queued', 'retry', 'claimed', 'dispatching', 'running');
```

The rollback deliberately does not call Realtime, so it can operate during a Broadcast insertion outage. Read-only verification:

```sql
select tgname, tgenabled from pg_trigger
where tgrelid = 'public.transcripts'::regclass and tgname = 'voice_transcript_event_delivery';
select count(*) as enabled_accounts from public.voice_event_settings where enabled;
select count(*) as unfinished_jobs from public.voice_jobs
where status in ('queued', 'retry', 'claimed', 'dispatching', 'running');
select has_function_privilege('authenticated',
  'public.voice_jobs_claim(text,integer)', 'EXECUTE') as can_claim;
select to_regclass('public.transcripts') as transcripts,
       to_regclass('public.voice_jobs') as preserved_receipts;
```

Expect trigger `D`, zero enabled accounts, zero unfinished jobs, `can_claim = false`, and both tables present. Confirm the normal phone transcript sync still works and the Mac reports delivery unavailable instead of executing work. Retain any `needs_user` uncertainty receipt for reconciliation with its actual Codex task. Restoration requires a reviewed forward change to restore the trigger/grants and a fresh user enable; do not drop/recreate the receipt or baseline tables to reset the feature.

## Local verification

```sh
npm --prefix supabase/tests/voice-events ci --ignore-scripts
npm --prefix supabase/tests/voice-events test
```

The 20 tests run the migration and RPCs in PGlite's real PostgreSQL engine, including SQL transactions, roles/RLS, lease fencing, configuration ordering, baseline/revision behavior, ambiguity handling, and thrown/warning-only wake failures. Auth identity and the Realtime transport are fixtures. They do not test a hosted replication slot, actual WebSocket authorization/delivery, concurrent independent database connections, phone capture timing, or Codex execution.
