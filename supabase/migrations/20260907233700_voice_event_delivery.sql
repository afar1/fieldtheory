-- Opt-in Voice delivery. No historical transcript is executed by this migration.
-- Realtime is only a private wake signal; voice_jobs is the durable source of truth.

create table public.voice_event_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  generation bigint not null default 0,
  enabled_at timestamptz,
  updated_at timestamptz not null default clock_timestamp()
);

-- Baseline IDs survive deletion/reinsertion. A new enable generation excludes
-- everything already present, including earlier accepted/completed recordings.
create table public.voice_event_sources (
  user_id uuid not null references auth.users(id) on delete cascade,
  transcript_id text not null,
  first_received_at timestamptz not null default clock_timestamp(),
  eligible_generation bigint,
  primary key (user_id, transcript_id)
);

-- Each Mac persists its command sequence before sending configuration RPCs.
-- An older timed-out enable must not overtake that Mac's later pause.
create table public.voice_event_config_cursors (
  user_id uuid not null references auth.users(id) on delete cascade,
  worker_id text not null,
  sequence bigint not null,
  primary key (user_id, worker_id)
);

create table public.voice_jobs (
  job_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  generation bigint not null,
  transcript_id text not null,
  revision text not null,
  text text not null,
  metadata jsonb,
  previous_text text,
  previous_thread_id text,
  client_created_at_ms bigint not null,
  received_at timestamptz not null default clock_timestamp(),
  status text not null default 'queued' check (status in (
    'queued', 'claimed', 'dispatching', 'running', 'retry', 'completed',
    'context', 'needs_user', 'failed', 'cancelled', 'superseded'
  )),
  attempts integer not null default 0,
  available_at timestamptz not null default clock_timestamp(),
  worker_id text,
  lease_token uuid,
  lease_expires_at timestamptz,
  dispatch_started_at timestamptz,
  thread_id text,
  summary text,
  result jsonb,
  updated_at timestamptz not null default clock_timestamp(),
  unique (user_id, generation, transcript_id, revision)
);

create index voice_jobs_ready on public.voice_jobs(user_id, generation, available_at, received_at)
  where status in ('queued', 'retry', 'claimed', 'dispatching', 'running');
create index voice_jobs_transcript on public.voice_jobs(user_id, generation, transcript_id, received_at desc);

alter table public.voice_event_settings enable row level security;
alter table public.voice_event_sources enable row level security;
alter table public.voice_event_config_cursors enable row level security;
alter table public.voice_jobs enable row level security;
revoke all on public.voice_event_settings, public.voice_event_sources, public.voice_event_config_cursors,
  public.voice_jobs from public, anon, authenticated;
grant select on public.voice_event_settings, public.voice_jobs to authenticated;
create policy voice_settings_owner_read on public.voice_event_settings for select to authenticated
  using (user_id = (select auth.uid()));
create policy voice_jobs_owner_read on public.voice_jobs for select to authenticated
  using (user_id = (select auth.uid()));

-- Never expose transcript text, task output, or credentials in a wake signal.
create function public._voice_jobs_wake(p_owner uuid, p_generation bigint, p_job_id uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_wake_id uuid := gen_random_uuid();
begin
  perform realtime.send(
    jsonb_strip_nulls(jsonb_build_object(
      'schema_version', 1, 'generation', p_generation, 'job_id', p_job_id, 'wake_id', v_wake_id)),
    'voice_jobs_changed', 'voice-jobs:' || p_owner::text, true
  );
  -- realtime.send catches insert failures and raises only a WARNING. Confirm
  -- this exact hint reached its WAL-backed table before accepting the upload.
  if not exists(select 1 from realtime.messages
    where topic = 'voice-jobs:' || p_owner::text and event = 'voice_jobs_changed'
      and private and extension = 'broadcast' and payload->>'wake_id' = v_wake_id::text) then
    raise exception 'Voice notification unavailable; this change was not accepted. Retry when service recovers.'
      using errcode = '55000';
  end if;
end;
$$;

create function public._voice_delivery_lock()
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_owner uuid := auth.uid();
begin
  if v_owner is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('voice-events:' || v_owner::text, 0));
  return v_owner;
end;
$$;

create function public._voice_job_json(p_job public.voice_jobs)
returns jsonb language sql stable set search_path = '' as $$
  select case when p_job.job_id is null then null else
    to_jsonb(p_job) || jsonb_build_object('dispatch_key', 'voice:' || p_job.job_id::text) end;
$$;

create function public.voice_delivery_status()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_owner uuid := auth.uid(); v_settings public.voice_event_settings;
begin
  if v_owner is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into v_settings from public.voice_event_settings where user_id = v_owner;
  return jsonb_build_object('schema_version', 1,
    'enabled', coalesce(v_settings.enabled, false),
    'generation', coalesce(v_settings.generation, 0),
    'enabled_at', v_settings.enabled_at, 'server_now', clock_timestamp());
end;
$$;

create function public.voice_delivery_configure(p_enabled boolean, p_worker_id text default null, p_sequence bigint default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_owner uuid := public._voice_delivery_lock(); v_settings public.voice_event_settings; v_sequence bigint;
begin
  if p_enabled is null then raise exception 'enabled is required' using errcode = '22023'; end if;
  if (p_worker_id is null) <> (p_sequence is null)
    or (p_worker_id is not null and (length(btrim(p_worker_id)) not between 1 and 128
      or p_sequence not between 1 and 9007199254740991)) then
    raise exception 'A worker ID and positive safe-integer sequence are required together' using errcode = '22023';
  end if;
  if p_worker_id is not null then
    select sequence into v_sequence from public.voice_event_config_cursors
      where user_id = v_owner and worker_id = p_worker_id;
    if p_sequence <= v_sequence then
      return public.voice_delivery_status() || jsonb_build_object('applied', false);
    end if;
    insert into public.voice_event_config_cursors(user_id, worker_id, sequence)
      values(v_owner, p_worker_id, p_sequence)
      on conflict (user_id, worker_id) do update set sequence = excluded.sequence;
  end if;
  insert into public.voice_event_settings(user_id) values(v_owner) on conflict do nothing;
  select * into v_settings from public.voice_event_settings where user_id = v_owner for update;
  if v_settings.enabled = p_enabled then
    return public.voice_delivery_status() || jsonb_build_object('applied', true);
  end if;

  update public.voice_event_settings set enabled = p_enabled, generation = generation + 1,
    enabled_at = case when p_enabled then clock_timestamp() else enabled_at end,
    updated_at = clock_timestamp()
    where user_id = v_owner returning * into v_settings;

  -- Invalidate every old lease. Re-enabling never resumes old dispatches.
  update public.voice_jobs set status = 'cancelled', lease_token = null, lease_expires_at = null,
    summary = 'Voice delivery was paused. Existing effects are not undone.', updated_at = clock_timestamp()
    where user_id = v_owner and status in ('queued', 'retry', 'claimed', 'dispatching', 'running');

  if p_enabled then
    update public.voice_event_sources set eligible_generation = null where user_id = v_owner;
    insert into public.voice_event_sources(user_id, transcript_id)
      select user_id, client_id from public.transcripts where user_id = v_owner
      on conflict (user_id, transcript_id) do update set eligible_generation = null;
  end if;
  perform public._voice_jobs_wake(v_owner, v_settings.generation);
  return public.voice_delivery_status() || jsonb_build_object('applied', true);
end;
$$;

create function public._voice_transcript_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid; v_transcript_id text; v_settings public.voice_event_settings;
  v_source public.voice_event_sources; v_previous public.voice_jobs;
  v_revision text; v_job_id uuid; v_now timestamptz := clock_timestamp(); v_superseded boolean;
begin
  v_owner := case when TG_OP = 'DELETE' then OLD.user_id else NEW.user_id end;
  v_transcript_id := case when TG_OP = 'DELETE' then OLD.client_id else NEW.client_id end;
  perform pg_advisory_xact_lock(hashtextextended('voice-events:' || v_owner::text, 0));
  select * into v_settings from public.voice_event_settings where user_id = v_owner;

  if TG_OP = 'DELETE' or NEW.deleted_at is not null or btrim(NEW.text) = '' then
    update public.voice_jobs set status = 'cancelled', lease_token = null, lease_expires_at = null,
      summary = 'The source recording was removed. Existing effects are not undone.', updated_at = clock_timestamp()
      where user_id = v_owner and transcript_id = v_transcript_id
        and status in ('queued', 'retry', 'claimed', 'dispatching', 'running');
    if FOUND then perform public._voice_jobs_wake(v_owner, v_settings.generation); end if;
    return null;
  end if;

  if not coalesce(v_settings.enabled, false) then return null; end if;
  select * into v_source from public.voice_event_sources
    where user_id = v_owner and transcript_id = v_transcript_id;
  if not FOUND then
    -- Server observation plus a non-backdated client *transcript creation* clock.
    -- The current phone does not persist original microphone-start time here.
    -- An UPDATE to an unknown ID is baseline, even if its timestamps are changed.
    insert into public.voice_event_sources(user_id, transcript_id, first_received_at, eligible_generation)
      values(v_owner, v_transcript_id, clock_timestamp(),
        case when TG_OP = 'INSERT' and v_now >= v_settings.enabled_at
          and NEW.client_created_at_ms > floor(extract(epoch from v_settings.enabled_at) * 1000)::bigint
          and NEW.client_created_at_ms <= floor(extract(epoch from clock_timestamp()) * 1000)::bigint + 300000
          then v_settings.generation else null end)
      returning * into v_source;
  end if;
  if v_source.eligible_generation is distinct from v_settings.generation then return null; end if;

  v_revision := encode(sha256(convert_to(NEW.text, 'UTF8')), 'hex');
  select * into v_previous from public.voice_jobs
    where user_id = v_owner and generation = v_settings.generation and transcript_id = v_transcript_id
    order by received_at desc, job_id desc limit 1;

  -- An undispatched obsolete revision must not execute ahead of a correction.
  update public.voice_jobs set status = 'superseded', lease_token = null, lease_expires_at = null,
    summary = 'A newer transcript revision arrived before dispatch.', updated_at = clock_timestamp()
    where user_id = v_owner and generation = v_settings.generation and transcript_id = v_transcript_id
      and revision <> v_revision and status in ('queued', 'retry', 'claimed') and dispatch_started_at is null;
  v_superseded := FOUND;
  -- Reverting A -> B -> A does not replay A, but must stop undispatched B.
  if exists(select 1 from public.voice_jobs where user_id = v_owner and generation = v_settings.generation
      and transcript_id = v_transcript_id and revision = v_revision) then
    if v_superseded then perform public._voice_jobs_wake(v_owner, v_settings.generation); end if;
    return null;
  end if;

  insert into public.voice_jobs(user_id, generation, transcript_id, revision, text, metadata,
    previous_text, previous_thread_id, client_created_at_ms)
    values(v_owner, v_settings.generation, v_transcript_id, v_revision, NEW.text, NEW.metadata,
      v_previous.text, coalesce(v_previous.thread_id, v_previous.previous_thread_id), NEW.client_created_at_ms)
    returning job_id into v_job_id;
  perform public._voice_jobs_wake(v_owner, v_settings.generation, v_job_id);
  return null;
end;
$$;

create trigger voice_transcript_event_delivery
  after insert or update or delete on public.transcripts
  for each row execute function public._voice_transcript_changed();

create function public.voice_jobs_claim(p_worker_id text, p_limit integer default 1)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := public._voice_delivery_lock(); v_settings public.voice_event_settings;
  v_job public.voice_jobs; v_jobs jsonb := '[]'::jsonb; v_next timestamptz;
begin
  if p_worker_id is null or length(p_worker_id) not between 1 and 128 or p_limit is null or p_limit not between 1 and 10 then
    raise exception 'Invalid worker or claim limit' using errcode = '22023';
  end if;
  select * into v_settings from public.voice_event_settings where user_id = v_owner;
  if coalesce(v_settings.enabled, false) then
    -- Never blindly repeat a request which may already have reached Codex.
    update public.voice_jobs set status = 'needs_user', lease_token = null, lease_expires_at = null,
      summary = 'Dispatch outcome is uncertain. Reconcile the task using its dispatch key before retrying.',
      result = coalesce(result, '{}'::jsonb) || jsonb_build_object(
        'recovery_uncertain', true, 'error_code', 'dispatch_outcome_unknown'),
      updated_at = clock_timestamp()
      where user_id = v_owner and generation = v_settings.generation and status = 'dispatching'
        and lease_expires_at <= clock_timestamp() and thread_id is null;
    if FOUND then perform public._voice_jobs_wake(v_owner, v_settings.generation); end if;

    for v_job in
      select j.* from public.voice_jobs j
      where j.user_id = v_owner and j.generation = v_settings.generation
        and ((j.status in ('queued', 'retry') and j.available_at <= clock_timestamp())
          or (j.status in ('claimed', 'running') and j.lease_expires_at <= clock_timestamp()))
        and not exists(select 1 from public.voice_jobs earlier
          where earlier.user_id = j.user_id and earlier.generation = j.generation
            and earlier.transcript_id = j.transcript_id
            and (earlier.received_at, earlier.job_id) < (j.received_at, j.job_id)
            and (earlier.status in ('queued', 'retry', 'claimed', 'dispatching', 'running')
              or (earlier.status = 'needs_user' and earlier.result @> '{"recovery_uncertain":true}'::jsonb)))
      order by j.received_at, j.job_id for update skip locked limit p_limit
    loop
      update public.voice_jobs set
        status = case when status = 'running' then 'running' else 'claimed' end,
        attempts = attempts + 1, worker_id = p_worker_id, lease_token = gen_random_uuid(),
        lease_expires_at = clock_timestamp() + interval '90 seconds', updated_at = clock_timestamp(),
        previous_thread_id = coalesce((select coalesce(p.thread_id, p.previous_thread_id)
          from public.voice_jobs p where p.user_id = v_owner and p.generation = v_settings.generation
            and p.transcript_id = v_job.transcript_id
            and (p.received_at, p.job_id) < (v_job.received_at, v_job.job_id)
            and coalesce(p.thread_id, p.previous_thread_id) is not null
          order by p.received_at desc limit 1), previous_thread_id)
        where job_id = v_job.job_id returning * into v_job;
      v_jobs := v_jobs || jsonb_build_array(public._voice_job_json(v_job));
    end loop;

    -- Only deadlines already attached to durable work. No transcript polling.
    select min(case when status in ('claimed', 'dispatching', 'running') then lease_expires_at
      when available_at > clock_timestamp() then available_at else null end)
      into v_next from public.voice_jobs where user_id = v_owner and generation = v_settings.generation
        and status in ('queued', 'retry', 'claimed', 'dispatching', 'running');
  end if;
  return jsonb_build_object('settings', public.voice_delivery_status(), 'jobs', v_jobs,
    'next_wake_at', v_next, 'server_now', clock_timestamp());
end;
$$;

-- All mutation RPCs lock the owner and then validate the generation + live lease.
create function public._voice_job_owned(p_job_id uuid, p_lease_token uuid)
returns public.voice_jobs language plpgsql security definer set search_path = '' as $$
declare v_owner uuid := public._voice_delivery_lock(); v_job public.voice_jobs;
begin
  select j.* into v_job from public.voice_jobs j
    join public.voice_event_settings s on s.user_id = j.user_id
    where j.job_id = p_job_id and j.user_id = v_owner and s.enabled and s.generation = j.generation
      and j.lease_token = p_lease_token and j.lease_expires_at > clock_timestamp()
      and j.status in ('claimed', 'dispatching', 'running') for update of j;
  return v_job;
end;
$$;

create function public.voice_jobs_renew(p_job_id uuid, p_lease_token uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_job public.voice_jobs := public._voice_job_owned(p_job_id, p_lease_token);
begin
  if v_job.job_id is null then return jsonb_build_object('ok', false, 'job', null); end if;
  update public.voice_jobs set lease_expires_at = clock_timestamp() + interval '90 seconds', updated_at = clock_timestamp()
    where job_id = v_job.job_id returning * into v_job;
  return jsonb_build_object('ok', true, 'job', public._voice_job_json(v_job));
end;
$$;

create function public.voice_jobs_begin_dispatch(p_job_id uuid, p_lease_token uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_job public.voice_jobs := public._voice_job_owned(p_job_id, p_lease_token);
begin
  if v_job.job_id is null or v_job.status <> 'claimed' or v_job.dispatch_started_at is not null or v_job.thread_id is null then
    return jsonb_build_object('ok', false, 'job', null);
  end if;
  -- A concrete empty/existing thread was recorded before this authorization.
  -- Persist the ambiguity boundary immediately before the caller starts a turn.
  update public.voice_jobs set status = 'running', dispatch_started_at = clock_timestamp(), updated_at = clock_timestamp()
    where job_id = v_job.job_id returning * into v_job;
  return jsonb_build_object('ok', true, 'job', public._voice_job_json(v_job));
end;
$$;

create function public.voice_jobs_record_dispatch(p_job_id uuid, p_lease_token uuid, p_thread_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_job public.voice_jobs := public._voice_job_owned(p_job_id, p_lease_token);
begin
  if p_thread_id is null or length(btrim(p_thread_id)) not between 1 and 256 then
    raise exception 'Actual thread ID required' using errcode = '22023';
  end if;
  if v_job.job_id is null or v_job.status not in ('claimed', 'dispatching', 'running')
    or (v_job.thread_id is not null and v_job.thread_id <> p_thread_id) then
    return jsonb_build_object('ok', false, 'job', null);
  end if;
  update public.voice_jobs set thread_id = p_thread_id, updated_at = clock_timestamp()
    where job_id = v_job.job_id returning * into v_job;
  perform public._voice_jobs_wake(v_job.user_id, v_job.generation, v_job.job_id);
  return jsonb_build_object('ok', true, 'job', public._voice_job_json(v_job));
end;
$$;

create function public.voice_jobs_complete(p_job_id uuid, p_lease_token uuid, p_status text,
  p_summary text, p_result jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_job public.voice_jobs := public._voice_job_owned(p_job_id, p_lease_token);
begin
  if p_status is null or p_status not in ('completed', 'context', 'needs_user', 'failed')
    or p_summary is null or length(p_summary) > 8000 or p_result is null
    or jsonb_typeof(p_result) <> 'object' or octet_length(p_result::text) > 65536 then
    raise exception 'Invalid receipt status, summary, or result' using errcode = '22023';
  end if;
  if v_job.job_id is null then return jsonb_build_object('ok', false, 'job', null); end if;
  if p_status = 'completed' and (v_job.status <> 'running' or v_job.thread_id is null) then
    raise exception 'Task dispatch is required before completion' using errcode = '22023';
  end if;
  update public.voice_jobs set status = p_status, summary = p_summary, result = p_result,
    lease_token = null, lease_expires_at = null, updated_at = clock_timestamp()
    where job_id = v_job.job_id returning * into v_job;
  perform public._voice_jobs_wake(v_job.user_id, v_job.generation, v_job.job_id);
  return jsonb_build_object('ok', true, 'job', public._voice_job_json(v_job));
end;
$$;

create function public.voice_jobs_retry(p_job_id uuid, p_lease_token uuid, p_error text, p_delay_seconds integer default 15)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_job public.voice_jobs := public._voice_job_owned(p_job_id, p_lease_token);
begin
  if p_delay_seconds is null or p_delay_seconds not between 1 and 3600 or p_error is null then
    raise exception 'Invalid retry delay or error' using errcode = '22023';
  end if;
  if v_job.job_id is null then return jsonb_build_object('ok', false, 'job', null); end if;
  if v_job.dispatch_started_at is not null then
    update public.voice_jobs set status = 'needs_user', summary = 'Dispatch may have happened. Reconcile the existing task before retrying.',
      result = coalesce(result, '{}'::jsonb) || jsonb_build_object(
        'recovery_uncertain', true, 'error_code', 'dispatch_outcome_unknown'),
      lease_token = null, lease_expires_at = null, updated_at = clock_timestamp()
      where job_id = v_job.job_id returning * into v_job;
  else
    update public.voice_jobs set status = case when attempts >= 5 then 'needs_user' else 'retry' end,
      summary = left(p_error, 8000), available_at = clock_timestamp() + make_interval(secs => p_delay_seconds),
      lease_token = null, lease_expires_at = null, updated_at = clock_timestamp()
      where job_id = v_job.job_id returning * into v_job;
  end if;
  perform public._voice_jobs_wake(v_job.user_id, v_job.generation, v_job.job_id);
  return jsonb_build_object('ok', true, 'job', public._voice_job_json(v_job));
end;
$$;

-- Restrictive topic guard also protects against pre-existing broad permissive
-- Realtime policies. Clients can receive their topic but cannot publish wakeups.
create policy voice_jobs_receive on realtime.messages for select to authenticated
  using (extension = 'broadcast' and topic = 'voice-jobs:' || (select auth.uid())::text
    and (select realtime.topic()) = 'voice-jobs:' || (select auth.uid())::text);
create policy voice_jobs_receive_guard on realtime.messages as restrictive for select to anon, authenticated
  using ((topic not like 'voice-jobs:%' and coalesce((select realtime.topic()), '') not like 'voice-jobs:%')
    or (extension = 'broadcast' and topic = 'voice-jobs:' || (select auth.uid())::text
      and (select realtime.topic()) = 'voice-jobs:' || (select auth.uid())::text));
create policy voice_jobs_publish_guard on realtime.messages as restrictive for insert to anon, authenticated
  with check (topic not like 'voice-jobs:%' and coalesce((select realtime.topic()), '') not like 'voice-jobs:%');

-- PostgreSQL grants PUBLIC execute on new functions unless explicitly revoked.
revoke all on function public._voice_jobs_wake(uuid, bigint, uuid), public._voice_delivery_lock(),
  public._voice_job_json(public.voice_jobs), public._voice_transcript_changed(), public._voice_job_owned(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.voice_delivery_status(), public.voice_delivery_configure(boolean, text, bigint),
  public.voice_jobs_claim(text, integer), public.voice_jobs_renew(uuid, uuid), public.voice_jobs_begin_dispatch(uuid, uuid),
  public.voice_jobs_record_dispatch(uuid, uuid, text), public.voice_jobs_complete(uuid, uuid, text, text, jsonb),
  public.voice_jobs_retry(uuid, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.voice_delivery_status(), public.voice_delivery_configure(boolean, text, bigint),
  public.voice_jobs_claim(text, integer), public.voice_jobs_renew(uuid, uuid), public.voice_jobs_begin_dispatch(uuid, uuid),
  public.voice_jobs_record_dispatch(uuid, uuid, text), public.voice_jobs_complete(uuid, uuid, text, text, jsonb),
  public.voice_jobs_retry(uuid, uuid, text, integer) to authenticated;
