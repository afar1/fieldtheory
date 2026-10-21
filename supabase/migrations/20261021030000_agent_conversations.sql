-- Durable authenticated mobile conversation relay. Deliberately not auto-enabled.
create table public.ft_agent_conversations (
 id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade,
 title text not null check(length(title) between 1 and 200), provider text not null check(length(provider) between 1 and 64),
 model text check(length(model) between 1 and 200),
 status text not null default 'queued' check(status in ('queued','running','completed','needs_user','failed')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(id,user_id)
);
create table public.ft_agent_commands (
 id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade,
 conversation_id uuid not null, text text not null check(length(btrim(text)) between 1 and 120000),
 status text not null default 'queued' check(status in ('queued','running','completed','needs_user','failed')),
 worker_id text, lease_token uuid, lease_expires_at timestamptz,
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 foreign key(conversation_id,user_id) references public.ft_agent_conversations(id,user_id) on delete cascade,
 unique(id,conversation_id,user_id)
);
create table public.ft_agent_events (
 seq bigint generated always as identity primary key, id uuid not null unique,
 user_id uuid not null references auth.users(id) on delete cascade, conversation_id uuid not null,
 command_id uuid, kind text not null check(kind in ('user','assistant','status','delegation','error')),
 text text not null check(length(text) <= 120000), payload jsonb not null default '{}',
 created_at timestamptz not null default clock_timestamp(),
 foreign key(conversation_id,user_id) references public.ft_agent_conversations(id,user_id) on delete cascade,
 foreign key(command_id,conversation_id,user_id) references public.ft_agent_commands(id,conversation_id,user_id) on delete cascade
);
create index ft_agent_events_cursor on public.ft_agent_events(user_id,conversation_id,seq);
create index ft_agent_commands_queue on public.ft_agent_commands(user_id,created_at) where status='queued';
create table public.ft_agent_runners (
 user_id uuid not null references auth.users(id) on delete cascade, id text not null,
 capabilities jsonb not null, updated_at timestamptz not null default now(), primary key(user_id,id)
);
alter table public.ft_agent_conversations enable row level security;
alter table public.ft_agent_commands enable row level security;
alter table public.ft_agent_events enable row level security;
alter table public.ft_agent_runners enable row level security;
revoke all on public.ft_agent_conversations,public.ft_agent_commands,public.ft_agent_events,public.ft_agent_runners from public,anon,authenticated;
grant select on public.ft_agent_conversations,public.ft_agent_commands,public.ft_agent_events,public.ft_agent_runners to authenticated;
grant insert(id,user_id,title,provider,model) on public.ft_agent_conversations to authenticated;
grant insert(id,user_id,conversation_id,text) on public.ft_agent_commands to authenticated;
grant insert,update on public.ft_agent_runners to authenticated;
create policy ft_conversation_read on public.ft_agent_conversations for select to authenticated using(user_id=(select auth.uid()));
create policy ft_conversation_insert on public.ft_agent_conversations for insert to authenticated with check(user_id=(select auth.uid()));
create policy ft_command_read on public.ft_agent_commands for select to authenticated using(user_id=(select auth.uid()));
create policy ft_command_insert on public.ft_agent_commands for insert to authenticated with check(user_id=(select auth.uid()));
create policy ft_event_read on public.ft_agent_events for select to authenticated using(user_id=(select auth.uid()));
create policy ft_runner_owner on public.ft_agent_runners for all to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));

create function public.ft_agent_command_inserted() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.ft_agent_events(id,user_id,conversation_id,command_id,kind,text)
 values(new.id,new.user_id,new.conversation_id,new.id,'user',new.text);
 update public.ft_agent_conversations set updated_at=clock_timestamp() where id=new.conversation_id;
 return new;
end $$;
create trigger ft_agent_command_inserted after insert on public.ft_agent_commands for each row execute function public.ft_agent_command_inserted();

create function public.ft_agent_claim(p_worker_id text) returns jsonb language plpgsql security definer set search_path='' as $$
declare owner uuid:=auth.uid(); job public.ft_agent_commands; conv public.ft_agent_conversations;
begin
 if owner is null then raise exception 'Authentication required'; end if;
 if length(btrim(p_worker_id)) not between 1 and 128 then raise exception 'Invalid worker'; end if;
 perform pg_advisory_xact_lock(hashtextextended('ft-agent:'||owner::text,0));
 -- An expired dispatch is ambiguous, never automatically repeat it.
 with expired as (
 update public.ft_agent_commands set status='needs_user',updated_at=clock_timestamp()
 where user_id=owner and status='running' and lease_expires_at<clock_timestamp() returning *
 ) insert into public.ft_agent_events(id,user_id,conversation_id,command_id,kind,text,payload)
 select gen_random_uuid(),user_id,conversation_id,id,'error','Runner interrupted. Review the provider conversation before continuing.',
 jsonb_build_object('status','needs_user','error_code','interrupted') from expired;
 update public.ft_agent_conversations c set status='needs_user',updated_at=clock_timestamp()
 where c.user_id=owner and exists(select 1 from public.ft_agent_commands q where q.conversation_id=c.id and q.status='needs_user');
 select q.* into job from public.ft_agent_commands q join public.ft_agent_conversations c on c.id=q.conversation_id
 where q.user_id=owner and q.status='queued'
 and not exists(select 1 from public.ft_agent_commands active where active.conversation_id=q.conversation_id and active.status='running')
 order by q.created_at,q.id limit 1 for update of q;
 if job.id is null then return null; end if;
 update public.ft_agent_commands set status='running',worker_id=p_worker_id,lease_token=gen_random_uuid(),lease_expires_at=clock_timestamp()+interval '90 seconds',updated_at=clock_timestamp()
 where id=job.id returning * into job;
 update public.ft_agent_conversations set status='running',updated_at=clock_timestamp() where id=job.conversation_id returning * into conv;
 return jsonb_build_object('command',to_jsonb(job),'conversation',to_jsonb(conv));
end $$;

-- Append idempotent events and optionally complete, in the same transaction.
create function public.ft_agent_publish(p_command_id uuid,p_lease_token uuid,p_events jsonb default '[]',p_status text default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare owner uuid:=auth.uid(); job public.ft_agent_commands; event jsonb;
begin
 if owner is null then raise exception 'Authentication required'; end if;
 select * into job from public.ft_agent_commands where id=p_command_id and user_id=owner and lease_token=p_lease_token for update;
 if job.id is null then raise exception 'Lease lost'; end if;
 if p_status is not null and p_status not in ('completed','needs_user','failed') then raise exception 'Invalid status'; end if;
 if jsonb_array_length(p_events)>20 then raise exception 'Event batch too large'; end if;
 for event in select * from jsonb_array_elements(p_events) loop
 insert into public.ft_agent_events(id,user_id,conversation_id,command_id,kind,text,payload)
 values((event->>'id')::uuid,owner,job.conversation_id,job.id,event->>'kind',event->>'text',coalesce(event->'payload','{}')) on conflict(id) do nothing;
 end loop;
 update public.ft_agent_commands set status=coalesce(p_status,status),lease_expires_at=clock_timestamp()+interval '90 seconds',updated_at=clock_timestamp() where id=job.id;
 update public.ft_agent_conversations c set status=coalesce(p_status,c.status),updated_at=clock_timestamp()
 where c.id=job.conversation_id and not exists(select 1 from public.ft_agent_commands active
 where active.conversation_id=c.id and active.id<>job.id and active.status='running');
 return true;
end $$;
revoke all on function public.ft_agent_command_inserted(),public.ft_agent_claim(text),public.ft_agent_publish(uuid,uuid,jsonb,text) from public,anon;
grant execute on function public.ft_agent_claim(text),public.ft_agent_publish(uuid,uuid,jsonb,text) to authenticated;
