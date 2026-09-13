-- Serialize submission to each destination; clients release only when a durable
-- execution owner guarantees queue draining, otherwise hold until completion.
-- Registration order is authoritative; unknown destinations cannot be ordered.
-- Legacy running jobs have no acceptance marker and conservatively hold the gate.
create sequence public.voice_submission_order;
revoke all on sequence public.voice_submission_order from public, anon, authenticated;
alter table public.voice_jobs add column submission_order bigint,
  add column submission_accepted_at timestamptz;
create index voice_jobs_submission on public.voice_jobs(user_id, generation, thread_id, submission_order)
  where submission_accepted_at is null;

create or replace function public.voice_jobs_record_dispatch(p_job_id uuid, p_lease_token uuid, p_thread_id text)
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
  update public.voice_jobs set thread_id = p_thread_id,
    submission_order = coalesce(submission_order, nextval('public.voice_submission_order')), updated_at = clock_timestamp()
    where job_id = v_job.job_id returning * into v_job;
  perform public._voice_jobs_wake(v_job.user_id, v_job.generation, v_job.job_id);
  return jsonb_build_object('ok', true, 'job', public._voice_job_json(v_job));
end;
$$;

-- Internal predicate: caller already holds the authenticated owner lock.
create function public._voice_submission_blocked(p_job public.voice_jobs)
returns boolean language sql stable set search_path = '' as $$
  select exists(select 1 from public.voice_jobs earlier
    where earlier.user_id = p_job.user_id and earlier.generation = p_job.generation
      and earlier.thread_id = p_job.thread_id and earlier.job_id <> p_job.job_id
      and earlier.submission_accepted_at is null
      and (earlier.status in ('queued', 'retry', 'claimed', 'dispatching', 'running')
        or (earlier.status = 'needs_user' and earlier.result @> '{"recovery_uncertain":true}'::jsonb))
      and ((earlier.submission_order is null and (p_job.submission_order is not null
          or (earlier.received_at, earlier.job_id) < (p_job.received_at, p_job.job_id)))
        or earlier.submission_order < p_job.submission_order));
$$;
revoke all on function public._voice_submission_blocked(public.voice_jobs) from public, anon, authenticated;

create function public.voice_jobs_submission_ready(p_job_id uuid, p_lease_token uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_job public.voice_jobs := public._voice_job_owned(p_job_id, p_lease_token);
begin
  if v_job.job_id is null or v_job.status <> 'claimed' or v_job.dispatch_started_at is not null or v_job.thread_id is null then
    return jsonb_build_object('ok', false, 'job', null);
  end if;
  if public._voice_submission_blocked(v_job) then
    return jsonb_build_object('ok', false, 'blocked', true, 'job', public._voice_job_json(v_job));
  end if;
  -- Preflight before thread/resume. begin_dispatch still rechecks at the actual
  -- dispatch boundary; this observation never authorizes execution by itself.
  return jsonb_build_object('ok', true, 'job', public._voice_job_json(v_job));
end;
$$;
revoke all on function public.voice_jobs_submission_ready(uuid, uuid) from public, anon, authenticated;
grant execute on function public.voice_jobs_submission_ready(uuid, uuid) to authenticated;

create or replace function public.voice_jobs_begin_dispatch(p_job_id uuid, p_lease_token uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_job public.voice_jobs := public._voice_job_owned(p_job_id, p_lease_token);
begin
  if v_job.job_id is null or v_job.status <> 'claimed' or v_job.dispatch_started_at is not null or v_job.thread_id is null then
    return jsonb_build_object('ok', false, 'job', null);
  end if;
  -- Owner lock serializes this check and dispatch authorization across Macs.
  -- Accepted jobs retain observation leases but no longer hold submission order.
  if public._voice_submission_blocked(v_job) then
    return jsonb_build_object('ok', false, 'blocked', true, 'job', public._voice_job_json(v_job));
  end if;
  -- A concrete empty/existing thread was recorded before this authorization.
  -- Persist the ambiguity boundary immediately before the caller starts a turn.
  update public.voice_jobs set status = 'running', dispatch_started_at = clock_timestamp(), updated_at = clock_timestamp()
    where job_id = v_job.job_id returning * into v_job;
  return jsonb_build_object('ok', true, 'job', public._voice_job_json(v_job));
end;
$$;

create function public.voice_jobs_accept_submission(p_job_id uuid, p_lease_token uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_job public.voice_jobs := public._voice_job_owned(p_job_id, p_lease_token);
begin
  if v_job.job_id is null or v_job.status <> 'running' or v_job.thread_id is null
    or v_job.dispatch_started_at is null then
    return jsonb_build_object('ok', false, 'job', null);
  end if;
  -- Caller has an exact turn/start or queue/add acknowledgement (or exact
  -- recovery evidence). This does not assert that a queued turn has started.
  update public.voice_jobs set submission_accepted_at = coalesce(submission_accepted_at, clock_timestamp()),
    updated_at = clock_timestamp() where job_id = v_job.job_id returning * into v_job;
  perform public._voice_jobs_wake(v_job.user_id, v_job.generation, v_job.job_id);
  return jsonb_build_object('ok', true, 'job', public._voice_job_json(v_job));
end;
$$;
revoke all on function public.voice_jobs_accept_submission(uuid, uuid) from public, anon, authenticated;
grant execute on function public.voice_jobs_accept_submission(uuid, uuid) to authenticated;
