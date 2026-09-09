-- Additive observability only. Does not enable delivery or replay existing work.
create table public.voice_delivery_events (
  event_id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.voice_jobs(job_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  transcript_id text not null,
  revision text not null,
  time_source text not null default 'server' check(time_source in ('server','codex','observed')),
  stage text not null check (stage in ('uploaded','received_by_mac','queued','started',
    'completed','context','needs_user','failed','cancelled','superseded')),
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default clock_timestamp(),
  worker_id text,
  thread_id text,
  turn_id text,
  unique(job_id, stage)
);
create index voice_delivery_events_recording on public.voice_delivery_events(user_id, transcript_id, revision, occurred_at);

create table public.voice_runner_presence (
  user_id uuid not null references auth.users(id) on delete cascade,
  worker_id text not null,
  last_seen_at timestamptz not null,
  observed_at timestamptz not null,
  locked boolean,
  sleeping boolean,
  online boolean,
  primary key(user_id, worker_id)
);
create table public.voice_runner_events (
  event_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  worker_id text not null,
  event text not null check(event in ('heartbeat','lock','unlock','sleep','wake','network','connected','disconnected')),
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default clock_timestamp(),
  locked boolean,
  sleeping boolean,
  online boolean
);
create index voice_runner_events_owner_time on public.voice_runner_events(user_id, occurred_at desc);

alter table public.voice_delivery_events enable row level security;
alter table public.voice_runner_presence enable row level security;
alter table public.voice_runner_events enable row level security;
revoke all on public.voice_delivery_events, public.voice_runner_presence, public.voice_runner_events from public, anon, authenticated;
grant select on public.voice_delivery_events, public.voice_runner_presence, public.voice_runner_events to authenticated;
create policy voice_delivery_events_owner_read on public.voice_delivery_events for select to authenticated using(user_id = (select auth.uid()));
create policy voice_runner_presence_owner_read on public.voice_runner_presence for select to authenticated using(user_id = (select auth.uid()));
create policy voice_runner_events_owner_read on public.voice_runner_events for select to authenticated using(user_id = (select auth.uid()));

-- This separate hint is best effort: an observability transport outage must not
-- roll back an actual task receipt. Owner reads remain the durable source.
create function public._voice_timeline_wake(p_owner uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform realtime.send(jsonb_build_object('schema_version', 1),
    'voice_delivery_changed', 'voice-jobs:' || p_owner::text, true);
exception when others then
  raise warning 'Voice timeline wake unavailable';
end;
$$;

create function public._voice_delivery_event_from_job()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_stage text; v_time timestamptz; v_backfill_stage text; v_backfill_time timestamptz; v_value text;
begin
  if TG_OP = 'INSERT' then v_stage := 'uploaded'; v_time := NEW.received_at;
  elsif NEW.status in ('claimed','running') and NEW.worker_id is not null and OLD.worker_id is null then
    v_stage := 'received_by_mac'; v_time := clock_timestamp();
  elsif NEW.status in ('completed','context','needs_user','failed','cancelled','superseded') and NEW.status is distinct from OLD.status then
    v_stage := NEW.status; v_time := NEW.updated_at;
  else return null;
  end if;
  -- A completion receipt can recover observations whose progress RPC was offline.
  -- Only explicit callback timestamps count; dispatch authorization is not start.
  if v_stage in ('completed','context','needs_user','failed') and NEW.thread_id is not null then
    foreach v_backfill_stage in array array['queued','started'] loop
      v_value := NEW.result->>case when v_backfill_stage = 'queued' then 'queuedAt' else 'startedAt' end;
      v_backfill_time := null;
      if v_value is not null and (v_backfill_stage <> 'started' or nullif(NEW.result->>'turn_id','') is not null) then
        begin
          if jsonb_typeof(NEW.result->case when v_backfill_stage = 'queued' then 'queuedAt' else 'startedAt' end) = 'string'
            and v_value ~ '^\d{4}-\d{2}-\d{2}T' then
            v_backfill_time := v_value::timestamptz;
          end if;
        exception when invalid_datetime_format or datetime_field_overflow then
          v_backfill_time := null;
        end;
        if isfinite(v_backfill_time) and v_backfill_time >= NEW.received_at - interval '5 minutes'
          and v_backfill_time <= clock_timestamp() + interval '5 minutes' then
          insert into public.voice_delivery_events(job_id,user_id,transcript_id,revision,stage,occurred_at,worker_id,thread_id,turn_id,time_source)
            values(NEW.job_id,NEW.user_id,NEW.transcript_id,NEW.revision,v_backfill_stage,v_backfill_time,NEW.worker_id,NEW.thread_id,
              case when v_backfill_stage = 'started' then NEW.result->>'turn_id' else null end,
              case when v_backfill_stage = 'started' and NEW.result->>'startedAtSource' = 'codex' then 'codex' else 'observed' end)
            on conflict(job_id,stage) do nothing;
        end if;
      end if;
    end loop;
  end if;
  insert into public.voice_delivery_events(job_id,user_id,transcript_id,revision,stage,occurred_at,worker_id,thread_id,turn_id)
    values(NEW.job_id,NEW.user_id,NEW.transcript_id,NEW.revision,v_stage,v_time,NEW.worker_id,NEW.thread_id,
      case when v_stage in ('completed','needs_user','failed') then nullif(NEW.result->>'turn_id','') else null end)
    on conflict(job_id,stage) do nothing;
  if FOUND then perform public._voice_timeline_wake(NEW.user_id); end if;
  return null;
end;
$$;
create trigger voice_delivery_timeline after insert or update on public.voice_jobs
  for each row execute function public._voice_delivery_event_from_job();

create function public.voice_jobs_record_progress(p_job_id uuid, p_lease_token uuid, p_stage text,
  p_thread_id text default null, p_turn_id text default null, p_occurred_at timestamptz default null,
  p_time_source text default 'observed')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_owner uuid := public._voice_delivery_lock(); v_job public.voice_jobs;
  v_event public.voice_delivery_events; v_time timestamptz := coalesce(p_occurred_at, clock_timestamp());
begin
  if p_time_source is null or p_time_source not in ('codex','observed')
    or p_stage is null or p_stage not in ('queued','started')
    or p_thread_id is null or length(btrim(p_thread_id)) not between 1 and 256
    or (p_turn_id is not null and length(btrim(p_turn_id)) not between 1 and 256)
    or (p_stage = 'started' and p_turn_id is null)
    or not isfinite(v_time) or v_time > clock_timestamp() + interval '5 minutes' then
    raise exception 'Invalid progress event' using errcode = '22023';
  end if;
  select * into v_event from public.voice_delivery_events where job_id = p_job_id and user_id = v_owner and stage = p_stage;
  if FOUND then
    return jsonb_build_object('ok', v_event.thread_id = p_thread_id and v_event.turn_id is not distinct from p_turn_id, 'event', to_jsonb(v_event));
  end if;
  v_job := public._voice_job_owned(p_job_id, p_lease_token);
  if v_job.job_id is null or v_job.thread_id is distinct from p_thread_id or v_job.dispatch_started_at is null then
    return jsonb_build_object('ok', false, 'event', null);
  end if;
  if v_time < v_job.received_at - interval '5 minutes' then
    raise exception 'Progress predates recording' using errcode = '22023';
  end if;
  insert into public.voice_delivery_events(job_id,user_id,transcript_id,revision,stage,occurred_at,worker_id,thread_id,turn_id,time_source)
    values(v_job.job_id,v_owner,v_job.transcript_id,v_job.revision,p_stage,v_time,v_job.worker_id,p_thread_id,p_turn_id,p_time_source)
    returning * into v_event;
  perform public._voice_timeline_wake(v_owner);
  return jsonb_build_object('ok', true, 'event', to_jsonb(v_event));
end;
$$;

create function public.voice_runner_report(p_worker_id text, p_event text,
  p_locked boolean default null, p_sleeping boolean default null, p_online boolean default null,
  p_occurred_at timestamptz default null, p_event_id uuid default null, p_expected_owner uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_owner uuid := public._voice_delivery_lock(); v_time timestamptz := coalesce(p_occurred_at, clock_timestamp());
  v_id uuid := coalesce(p_event_id, gen_random_uuid()); v_existing public.voice_runner_events;
begin
  if p_expected_owner is not null and p_expected_owner <> v_owner then
    raise exception 'Runner account changed' using errcode = '42501';
  end if;
  if p_worker_id is null or length(btrim(p_worker_id)) not between 1 and 128
    or p_event is null or p_event not in ('heartbeat','lock','unlock','sleep','wake','network','connected','disconnected')
    or not isfinite(v_time) or v_time > clock_timestamp() + interval '5 minutes' then
    raise exception 'Invalid runner observation' using errcode = '22023';
  end if;
  select * into v_existing from public.voice_runner_events where event_id = v_id;
  if FOUND then
    return jsonb_build_object('ok', v_existing.user_id = v_owner and v_existing.worker_id = p_worker_id
      and v_existing.event = p_event, 'event_id', v_id);
  end if;
  insert into public.voice_runner_events(event_id,user_id,worker_id,event,occurred_at,locked,sleeping,online)
    values(v_id,v_owner,p_worker_id,p_event,v_time,p_locked,p_sleeping,p_online);
  -- Delayed outbox events remain in the history but cannot overwrite newer state.
  insert into public.voice_runner_presence(user_id,worker_id,last_seen_at,observed_at,locked,sleeping,online)
    values(v_owner,p_worker_id,clock_timestamp(),v_time,p_locked,p_sleeping,p_online)
    on conflict(user_id,worker_id) do update set last_seen_at = clock_timestamp(),
      observed_at = greatest(voice_runner_presence.observed_at, excluded.observed_at),
      locked = case when excluded.observed_at >= voice_runner_presence.observed_at then coalesce(excluded.locked,voice_runner_presence.locked) else voice_runner_presence.locked end,
      sleeping = case when excluded.observed_at >= voice_runner_presence.observed_at then coalesce(excluded.sleeping,voice_runner_presence.sleeping) else voice_runner_presence.sleeping end,
      online = case when excluded.observed_at >= voice_runner_presence.observed_at then coalesce(excluded.online,voice_runner_presence.online) else voice_runner_presence.online end;
  -- Keep diagnostic history bounded per owner; delivery events follow job lifetime.
  delete from public.voice_runner_events where user_id = v_owner and recorded_at < clock_timestamp() - interval '30 days';
  perform public._voice_timeline_wake(v_owner);
  return jsonb_build_object('ok', true, 'event_id', v_id);
end;
$$;

revoke all on function public._voice_timeline_wake(uuid), public._voice_delivery_event_from_job(),
  public.voice_jobs_record_progress(uuid,uuid,text,text,text,timestamptz,text),
  public.voice_runner_report(text,text,boolean,boolean,boolean,timestamptz,uuid,uuid) from public, anon, authenticated;
grant execute on function public.voice_jobs_record_progress(uuid,uuid,text,text,text,timestamptz,text),
  public.voice_runner_report(text,text,boolean,boolean,boolean,timestamptz,uuid,uuid) to authenticated;
