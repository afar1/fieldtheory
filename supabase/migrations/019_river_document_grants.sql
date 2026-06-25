-- River document grants
-- Replaces the one-team-scope River pool with canonical documents and explicit recipients.

create table if not exists public.river_documents (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind = any (array['document'::text, 'command'::text])),
  path text not null check (
    path <> ''
    and left(path, 1) <> '/'
    and path !~ '(^|/)\.\.(/|$)'
    and path !~ '(^|/)\.(/|$)'
    and path ~* '\.(md|markdown)$'
  ),
  title text not null default '',
  content text not null default '',
  content_hash text,
  client_id text not null,
  client_created_at_ms bigint not null,
  created_by uuid not null references auth.users(id) on delete cascade,
  updated_by uuid not null references auth.users(id) on delete cascade,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  original_source_path text check (
    original_source_path is null
    or (
      original_source_path <> ''
      and left(original_source_path, 1) <> '/'
      and original_source_path !~ '(^|/)\.\.(/|$)'
      and original_source_path !~ '(^|/)\.(/|$)'
    )
  ),
  shared_name text,
  author_initials text,
  revision bigint not null default 0,
  author_callsign text,
  constraint river_documents_created_client_unique unique (created_by, client_id)
);

create table if not exists public.river_document_audience (
  document_id uuid not null references public.river_documents(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  granted_by_user_id uuid not null references auth.users(id) on delete cascade,
  source_type text not null check (source_type = any (array['direct'::text, 'team'::text])),
  source_id text not null default 'direct',
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (document_id, recipient_user_id, source_type, source_id)
);

create table if not exists public.river_document_pins (
  user_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid not null references public.river_documents(id) on delete cascade,
  pinned_by uuid not null references auth.users(id) on delete cascade,
  updated_at timestamptz not null default now(),
  primary key (user_id, document_id)
);

create table if not exists public.river_share_groups (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists river_share_groups_owner_name_unique
  on public.river_share_groups (owner_user_id, lower(name))
  where deleted_at is null;

create table if not exists public.river_share_group_members (
  group_id uuid not null references public.river_share_groups(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  member_user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'accepted' check (status = any (array['pending'::text, 'accepted'::text])),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (group_id, member_user_id)
);

create index if not exists river_document_audience_recipient_idx
  on public.river_document_audience (recipient_user_id)
  where revoked_at is null;

create index if not exists river_document_audience_document_idx
  on public.river_document_audience (document_id)
  where revoked_at is null;

create index if not exists river_documents_created_by_idx
  on public.river_documents (created_by)
  where deleted_at is null;

create index if not exists river_share_group_members_member_idx
  on public.river_share_group_members (member_user_id)
  where status = 'accepted';

alter table public.river_documents enable row level security;
alter table public.river_document_audience enable row level security;
alter table public.river_document_pins enable row level security;
alter table public.river_share_groups enable row level security;
alter table public.river_share_group_members enable row level security;

create policy "river documents visible to owner or active recipient"
  on public.river_documents
  for select
  using (
    created_by = auth.uid()
    or exists (
      select 1
      from public.river_document_audience a
      where a.document_id = river_documents.id
        and a.recipient_user_id = auth.uid()
        and a.revoked_at is null
    )
  );

create policy "river documents inserted by owner"
  on public.river_documents
  for insert
  with check (created_by = auth.uid() and updated_by = auth.uid());

create policy "river documents updated by visible users"
  on public.river_documents
  for update
  using (
    created_by = auth.uid()
    or exists (
      select 1
      from public.river_document_audience a
      where a.document_id = river_documents.id
        and a.recipient_user_id = auth.uid()
        and a.revoked_at is null
    )
  )
  with check (
    updated_by = auth.uid()
    and (
      created_by = auth.uid()
      or exists (
        select 1
        from public.river_document_audience a
        where a.document_id = river_documents.id
          and a.recipient_user_id = auth.uid()
          and a.revoked_at is null
      )
    )
  );

create policy "river audience visible to grantor or recipient"
  on public.river_document_audience
  for select
  using (granted_by_user_id = auth.uid() or recipient_user_id = auth.uid());

create policy "river audience managed by document owner"
  on public.river_document_audience
  for all
  using (
    exists (
      select 1
      from public.river_documents d
      where d.id = river_document_audience.document_id
        and d.created_by = auth.uid()
    )
  )
  with check (
    granted_by_user_id = auth.uid()
    and exists (
      select 1
      from public.river_documents d
      where d.id = river_document_audience.document_id
        and d.created_by = auth.uid()
    )
  );

create policy "river pins are per user"
  on public.river_document_pins
  for all
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and pinned_by = auth.uid()
    and exists (
      select 1
      from public.river_documents d
      where d.id = river_document_pins.document_id
        and d.deleted_at is null
        and (
          d.created_by = auth.uid()
          or exists (
            select 1
            from public.river_document_audience a
            where a.document_id = d.id
              and a.recipient_user_id = auth.uid()
              and a.revoked_at is null
          )
        )
    )
  );

create policy "river groups visible to owner or members"
  on public.river_share_groups
  for select
  using (
    owner_user_id = auth.uid()
    or exists (
      select 1
      from public.river_share_group_members m
      where m.group_id = river_share_groups.id
        and m.member_user_id = auth.uid()
        and m.status = 'accepted'
    )
  );

create policy "river groups managed by owner"
  on public.river_share_groups
  for all
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

create policy "river group members visible to group participants"
  on public.river_share_group_members
  for select
  using (
    member_user_id = auth.uid()
    or exists (
      select 1
      from public.river_share_groups g
      where g.id = river_share_group_members.group_id
        and g.owner_user_id = auth.uid()
    )
  );

create policy "river group members managed by group owner"
  on public.river_share_group_members
  for all
  using (
    exists (
      select 1
      from public.river_share_groups g
      where g.id = river_share_group_members.group_id
        and g.owner_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.river_share_groups g
      where g.id = river_share_group_members.group_id
        and g.owner_user_id = auth.uid()
    )
  );

insert into public.river_documents (
  id,
  kind,
  path,
  title,
  content,
  content_hash,
  client_id,
  client_created_at_ms,
  created_by,
  updated_by,
  deleted_at,
  created_at,
  updated_at,
  original_source_path,
  shared_name,
  author_initials,
  revision,
  author_callsign
)
select
  td.id,
  td.kind,
  td.path,
  td.title,
  td.content,
  td.content_hash,
  td.client_id,
  td.client_created_at_ms,
  td.created_by,
  td.updated_by,
  td.deleted_at,
  td.created_at,
  td.updated_at,
  td.original_source_path,
  td.shared_name,
  td.author_initials,
  td.revision,
  td.author_callsign
from public.team_documents td
on conflict (id) do nothing;

insert into public.river_document_audience (
  document_id,
  recipient_user_id,
  granted_by_user_id,
  source_type,
  source_id,
  revoked_at,
  created_at,
  updated_at
)
select distinct
  td.id,
  recipient.recipient_user_id,
  td.created_by,
  'team',
  td.team_scope_user_id::text,
  td.deleted_at,
  td.created_at,
  td.updated_at
from public.team_documents td
cross join lateral (
  select td.team_scope_user_id as recipient_user_id
  union
  select c.contact_user_id
  from public.contacts c
  where c.owner_user_id = td.team_scope_user_id
    and c.relationship_type = 'team'
    and c.status = 'accepted'
    and c.contact_user_id is not null
) recipient
where recipient.recipient_user_id is not null
  and recipient.recipient_user_id <> td.created_by
on conflict (document_id, recipient_user_id, source_type, source_id) do update
  set revoked_at = excluded.revoked_at,
      updated_at = excluded.updated_at;

insert into public.river_document_pins (user_id, document_id, pinned_by, updated_at)
select distinct
  pinned_by,
  document_id,
  pinned_by,
  updated_at
from public.team_document_pins
on conflict (user_id, document_id) do update
  set pinned_by = excluded.pinned_by,
      updated_at = excluded.updated_at;

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
        and tablename = 'river_documents'
    ) then
      alter publication supabase_realtime add table public.river_documents;
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'river_document_audience'
    ) then
      alter publication supabase_realtime add table public.river_document_audience;
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'river_document_pins'
    ) then
      alter publication supabase_realtime add table public.river_document_pins;
    end if;
  end if;
end $$;
