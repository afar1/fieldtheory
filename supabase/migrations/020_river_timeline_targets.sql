-- River timeline targets
-- Adds editable audience targets, user defaults, and source preferences while
-- preserving the materialized recipient-grant model introduced in 019.

create table if not exists public.river_document_targets (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.river_documents(id) on delete cascade,
  target_kind text not null check (target_kind = any (array['person'::text, 'group'::text, 'public'::text])),
  target_id text not null,
  created_by uuid not null references auth.users(id) on delete cascade,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (target_kind <> 'public' or target_id = 'public')
);

create unique index if not exists river_document_targets_active_unique
  on public.river_document_targets (document_id, target_kind, target_id)
;

create index if not exists river_document_targets_document_idx
  on public.river_document_targets (document_id)
  where revoked_at is null;

create index if not exists river_document_targets_target_idx
  on public.river_document_targets (target_kind, target_id)
  where revoked_at is null;

create table if not exists public.river_default_destinations (
  user_id uuid not null references auth.users(id) on delete cascade,
  target_kind text not null check (target_kind = any (array['person'::text, 'group'::text, 'public'::text])),
  target_id text not null,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, target_kind, target_id),
  check (target_kind <> 'public' or target_id = 'public')
);

create table if not exists public.river_source_preferences (
  user_id uuid not null references auth.users(id) on delete cascade,
  source_kind text not null check (source_kind = any (array['mine'::text, 'person'::text, 'group'::text, 'public'::text])),
  source_id text not null,
  preference text not null default 'include' check (preference = any (array['include'::text, 'mute'::text, 'hide'::text])),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, source_kind, source_id),
  check (source_kind <> 'public' or source_id = 'public')
);

create table if not exists public.river_invite_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  auto_accept_contacts boolean not null default false,
  auto_accept_groups boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.river_share_group_invites (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.river_share_groups(id) on delete cascade,
  invited_email text not null,
  invited_user_id uuid references auth.users(id) on delete set null,
  invited_by_user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status = any (array['pending'::text, 'accepted'::text, 'declined'::text, 'revoked'::text])),
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists river_share_group_invites_pending_unique
  on public.river_share_group_invites (group_id, lower(invited_email))
  where status = 'pending';

alter table public.river_share_group_members
  add column if not exists invited_email text,
  add column if not exists invited_by_user_id uuid references auth.users(id) on delete set null,
  add column if not exists responded_at timestamptz;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'river_share_group_members_status_check'
      and conrelid = 'public.river_share_group_members'::regclass
  ) then
    alter table public.river_share_group_members
      drop constraint river_share_group_members_status_check;
  end if;

  alter table public.river_share_group_members
    add constraint river_share_group_members_status_check
    check (status = any (array['pending'::text, 'accepted'::text, 'declined'::text, 'revoked'::text, 'left'::text]));
exception
  when duplicate_object then null;
end $$;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'river_document_audience_source_type_check'
      and conrelid = 'public.river_document_audience'::regclass
  ) then
    alter table public.river_document_audience
      drop constraint river_document_audience_source_type_check;
  end if;

  alter table public.river_document_audience
    add constraint river_document_audience_source_type_check
    check (source_type = any (array['direct'::text, 'person'::text, 'group'::text, 'public'::text, 'legacy_team'::text, 'team'::text]));
exception
  when duplicate_object then null;
end $$;

update public.river_document_audience
set source_type = 'legacy_team',
    updated_at = now()
where source_type = 'team';

alter table public.river_document_targets enable row level security;
alter table public.river_default_destinations enable row level security;
alter table public.river_source_preferences enable row level security;
alter table public.river_invite_preferences enable row level security;
alter table public.river_share_group_invites enable row level security;

create or replace function public.is_shared_team_beta_user(check_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.shared_team_beta_users beta
    where beta.user_id = check_user_id
  );
$$;

create or replace function public.river_group_owned_by_user(check_group_id uuid, check_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.river_share_groups g
    where g.id = check_group_id
      and g.owner_user_id = check_user_id
      and g.deleted_at is null
  );
$$;

create or replace function public.river_group_member_can_respond(check_group_id uuid, check_user_id uuid, check_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.river_share_group_members m
    where m.group_id = check_group_id
      and m.status = 'pending'
      and (
        m.member_user_id = check_user_id
        or lower(m.invited_email) = lower(check_email)
      )
    union all
    select 1
    from public.river_share_group_invites i
    where i.group_id = check_group_id
      and i.status = 'pending'
      and (
        i.invited_user_id = check_user_id
        or lower(i.invited_email) = lower(check_email)
      )
  );
$$;

create or replace function public.river_document_visible_to_user(check_document_id uuid, check_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.river_documents d
    where d.id = check_document_id
      and d.deleted_at is null
      and (
        d.created_by = check_user_id
        or exists (
          select 1
          from public.river_document_targets t
          where t.document_id = d.id
            and t.target_kind = 'public'
            and t.target_id = 'public'
            and t.revoked_at is null
            and public.is_shared_team_beta_user(check_user_id)
        )
        or exists (
          select 1
          from public.river_document_audience a
          where a.document_id = d.id
            and a.recipient_user_id = check_user_id
            and a.revoked_at is null
            and (
              a.source_type = 'direct'
              or a.source_type = 'legacy_team'
              or exists (
                select 1
                from public.river_document_targets t
                where t.document_id = a.document_id
                  and a.source_id = t.id::text
                  and t.revoked_at is null
                  and (
                    (a.source_type = 'person' and t.target_kind = 'person')
                    or (a.source_type = 'group' and t.target_kind = 'group')
                  )
              )
            )
        )
      )
  );
$$;

create or replace function public.river_target_visible_to_user(check_target_id uuid, check_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.river_document_targets t
    where t.id = check_target_id
      and public.river_document_visible_to_user(t.document_id, check_user_id)
  );
$$;

drop policy if exists "river documents visible to owner or active recipient" on public.river_documents;
create policy "river documents visible through River visibility helper"
  on public.river_documents
  for select
  using (public.river_document_visible_to_user(river_documents.id, auth.uid()));

drop policy if exists "river documents updated by visible users" on public.river_documents;
create policy "river documents updated by owner"
  on public.river_documents
  for update
  using (created_by = auth.uid())
  with check (created_by = auth.uid() and updated_by = auth.uid());

drop policy if exists "river audience visible to grantor or recipient" on public.river_document_audience;
create policy "river audience visible to grantor recipient or target viewer"
  on public.river_document_audience
  for select
  using (
    granted_by_user_id = auth.uid()
    or recipient_user_id = auth.uid()
    or public.river_document_visible_to_user(river_document_audience.document_id, auth.uid())
  );

create policy "river targets visible to authorized viewers"
  on public.river_document_targets
  for select
  using (public.river_target_visible_to_user(river_document_targets.id, auth.uid()));

create policy "river targets managed by document owner"
  on public.river_document_targets
  for all
  using (
    exists (
      select 1
      from public.river_documents d
      where d.id = river_document_targets.document_id
        and d.created_by = auth.uid()
    )
  )
  with check (
    created_by = auth.uid()
    and exists (
      select 1
      from public.river_documents d
      where d.id = river_document_targets.document_id
        and d.created_by = auth.uid()
    )
  );

create policy "river defaults are per user"
  on public.river_default_destinations
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "river source preferences are per user"
  on public.river_source_preferences
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "river invite preferences are per user"
  on public.river_invite_preferences
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "river group invites visible to owner or invitee"
  on public.river_share_group_invites
  for select
  using (
    public.river_group_owned_by_user(group_id, auth.uid())
    or invited_user_id = auth.uid()
    or lower(invited_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

create policy "river group invites managed by group owner"
  on public.river_share_group_invites
  for all
  using (public.river_group_owned_by_user(group_id, auth.uid()))
  with check (
    invited_by_user_id = auth.uid()
    and public.river_group_owned_by_user(group_id, auth.uid())
  );

create policy "river group invitees can respond"
  on public.river_share_group_invites
  for update
  using (
    status = 'pending'
    and (
      invited_user_id = auth.uid()
      or lower(invited_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
  )
  with check (
    status = any (array['accepted'::text, 'declined'::text])
  );

drop policy if exists "river group members visible to group participants" on public.river_share_group_members;
create policy "river group members visible to group participants"
  on public.river_share_group_members
  for select
  using (
    member_user_id = auth.uid()
    or public.river_group_owned_by_user(group_id, auth.uid())
  );

drop policy if exists "river group members managed by group owner" on public.river_share_group_members;
create policy "river group members managed by group owner"
  on public.river_share_group_members
  for all
  using (public.river_group_owned_by_user(group_id, auth.uid()))
  with check (public.river_group_owned_by_user(group_id, auth.uid()));

create policy "river group members can respond to own invites"
  on public.river_share_group_members
  for update
  using (
    public.river_group_member_can_respond(
      group_id,
      auth.uid(),
      coalesce(auth.jwt() ->> 'email', '')
    )
  )
  with check (
    member_user_id = auth.uid()
    and status = any (array['accepted'::text, 'declined'::text])
  );

insert into public.river_document_targets (
  document_id,
  target_kind,
  target_id,
  created_by,
  revoked_at,
  created_at,
  updated_at
)
select distinct
  a.document_id,
  'group' as target_kind,
  a.source_id as target_id,
  d.created_by,
  a.revoked_at,
  min(a.created_at),
  max(a.updated_at)
from public.river_document_audience a
join public.river_documents d on d.id = a.document_id
where a.source_type = 'legacy_team'
group by a.document_id, a.source_id, d.created_by, a.revoked_at
on conflict do nothing;

do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'river_document_targets'
    ) then
      alter publication supabase_realtime add table public.river_document_targets;
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'river_share_group_members'
    ) then
      alter publication supabase_realtime add table public.river_share_group_members;
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'river_default_destinations'
    ) then
      alter publication supabase_realtime add table public.river_default_destinations;
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'river_source_preferences'
    ) then
      alter publication supabase_realtime add table public.river_source_preferences;
    end if;
  end if;
end $$;
