-- Named River teams. Membership, invitations, and roles mutate only through the
-- RPC below, which locks the team row before making an authorization decision.
-- This migration does not add anyone to the Public River beta allowlist.

alter table public.river_share_groups
  add column legacy_owner_user_id uuid references auth.users(id) on delete set null;
create unique index river_share_groups_legacy_owner_unique
  on public.river_share_groups(legacy_owner_user_id) where legacy_owner_user_id is not null;
alter table public.river_share_group_members
  add column role text not null default 'member' check (role in ('admin', 'member'));
alter table public.river_share_group_invites
  add column legacy_contact_id uuid references public.contacts(id) on delete set null;
-- Team identity is its UUID. Duplicate names must not block an ownership
-- transfer to someone who already owns a similarly named team.
drop index if exists public.river_share_groups_owner_name_unique;

-- Every old owner-scoped team becomes a distinct named team, including teams
-- with only pending contacts or only historical posts. Existing named groups
-- remain separate. A stable mapping also lets clients retire synthetic teams.
insert into public.river_share_groups(owner_user_id, name, legacy_owner_user_id)
select u.id,
  case when exists (select 1 from public.river_share_groups g
                    where g.owner_user_id = u.id and lower(g.name) = 'my team' and g.deleted_at is null)
       then 'My Team (migrated ' || left(u.id::text, 8) || ')' else 'My Team' end,
  u.id
from auth.users u
where exists (select 1 from public.contacts c where c.owner_user_id = u.id and c.relationship_type = 'team' and c.status in ('pending', 'accepted'))
   or exists (select 1 from public.team_documents d where d.team_scope_user_id = u.id)
   or exists (select 1 from public.river_document_audience a where a.source_type in ('legacy_team', 'team') and a.source_id = u.id::text)
   or exists (select 1 from public.river_document_targets t where t.target_kind = 'group' and t.target_id = u.id::text);

insert into public.river_share_group_members(group_id, member_user_id, contact_id, status, invited_email, invited_by_user_id, responded_at)
select distinct on (g.id, c.contact_user_id)
  g.id, c.contact_user_id, c.id, 'accepted', lower(btrim(c.contact_email)), c.owner_user_id, now()
from public.contacts c join public.river_share_groups g on g.legacy_owner_user_id = c.owner_user_id
where c.relationship_type = 'team' and c.status = 'accepted'
  and c.contact_user_id is not null and c.contact_user_id <> g.owner_user_id
order by g.id, c.contact_user_id, c.created_at
on conflict (group_id, member_user_id) do nothing;

-- Keep an owner membership row too, so deletion/revocation reaches every
-- participant's own-row Realtime subscription. owner_user_id remains the one
-- authoritative owner; the membership role applies only after a transfer.
insert into public.river_share_group_members(group_id, member_user_id, status, role, responded_at)
select id, owner_user_id, 'accepted', 'member', now() from public.river_share_groups where deleted_at is null
on conflict (group_id, member_user_id) do update set status = 'accepted', role = 'member', updated_at = now();

-- Normalize and deduplicate legacy pending invitations before enforcing one
-- pending invitation per normalized email. Acceptance never trusts JWT email.
with duplicates as (
  select id, row_number() over (partition by group_id, lower(btrim(invited_email)) order by created_at, id) as n
  from public.river_share_group_invites where status = 'pending'
)
update public.river_share_group_invites i set status = 'revoked', updated_at = now()
from duplicates d where i.id = d.id and d.n > 1;
update public.river_share_group_invites set invited_email = lower(btrim(invited_email));

insert into public.river_share_group_invites(group_id, invited_email, invited_user_id, invited_by_user_id, created_at, legacy_contact_id)
select distinct on (g.id, lower(btrim(c.contact_email)))
  g.id, lower(btrim(c.contact_email)), c.contact_user_id, c.owner_user_id, c.created_at, c.id
from public.contacts c join public.river_share_groups g on g.legacy_owner_user_id = c.owner_user_id
where c.relationship_type = 'team' and (c.status = 'pending' or (c.status = 'accepted' and c.contact_user_id is null))
order by g.id, lower(btrim(c.contact_email)), c.created_at
on conflict do nothing;

insert into public.river_share_group_invites(group_id, invited_email, invited_user_id, invited_by_user_id, created_at)
select m.group_id, lower(btrim(coalesce(m.invited_email, u.email))), m.member_user_id,
  coalesce(m.invited_by_user_id, g.owner_user_id), m.created_at
from public.river_share_group_members m
join public.river_share_groups g on g.id = m.group_id
join auth.users u on u.id = m.member_user_id
where m.status = 'pending' and nullif(btrim(coalesce(m.invited_email, u.email)), '') is not null
on conflict do nothing;

-- Preserve history even when the legacy team had no materialized recipients.
-- Older clients may have continued adding legacy posts after migration 019.
-- Existing canonical documents remain authoritative; missing ones are copied.
insert into public.river_documents(id, kind, path, title, content, content_hash, client_id, client_created_at_ms,
  created_by, updated_by, deleted_at, created_at, updated_at, original_source_path, shared_name, author_initials, revision, author_callsign)
select id, kind, path, title, content, content_hash, client_id, client_created_at_ms,
  created_by, updated_by, deleted_at, created_at, updated_at, original_source_path, shared_name, author_initials, revision, author_callsign
from public.team_documents
on conflict (id) do nothing;

insert into public.river_document_targets(document_id, target_kind, target_id, created_by, revoked_at, created_at, updated_at)
select d.id, 'group', g.legacy_owner_user_id::text, d.created_by, d.deleted_at, d.created_at, d.updated_at
from public.team_documents d
join public.river_documents rd on rd.id = d.id
join public.river_share_groups g on g.legacy_owner_user_id = d.team_scope_user_id
on conflict do nothing;

update public.river_document_targets t set target_id = g.id::text, updated_at = now()
from public.river_share_groups g
where t.target_kind = 'group' and t.target_id = g.legacy_owner_user_id::text;

insert into public.river_document_audience(document_id, recipient_user_id, granted_by_user_id, source_type, source_id, revoked_at, created_at, updated_at)
select a.document_id, a.recipient_user_id, a.granted_by_user_id, 'group', t.id::text,
  a.revoked_at, a.created_at, now()
from public.river_document_audience a
join public.river_share_groups g on g.legacy_owner_user_id::text = a.source_id
join public.river_document_targets t on t.document_id = a.document_id and t.target_kind = 'group' and t.target_id = g.id::text
where a.source_type in ('legacy_team', 'team')
on conflict do nothing;
delete from public.river_document_audience a using public.river_share_groups g
where a.source_type in ('legacy_team', 'team') and a.source_id = g.legacy_owner_user_id::text;

insert into public.river_default_destinations(user_id, target_kind, target_id, position, created_at, updated_at)
select d.user_id, 'group', g.id::text, d.position, d.created_at, now()
from public.river_default_destinations d join public.river_share_groups g on d.target_kind = 'group' and d.target_id = g.legacy_owner_user_id::text
on conflict do nothing;
delete from public.river_default_destinations d using public.river_share_groups g
where d.target_kind = 'group' and d.target_id = g.legacy_owner_user_id::text;
insert into public.river_source_preferences(user_id, source_kind, source_id, preference, position, created_at, updated_at)
select p.user_id, 'group', g.id::text, p.preference, p.position, p.created_at, now()
from public.river_source_preferences p join public.river_share_groups g on p.source_kind = 'group' and p.source_id = g.legacy_owner_user_id::text
on conflict do nothing;
delete from public.river_source_preferences p using public.river_share_groups g
where p.source_kind = 'group' and p.source_id = g.legacy_owner_user_id::text;

create or replace function public.river_team_role(check_group_id uuid, check_user_id uuid)
returns text language sql stable security definer set search_path = pg_catalog, public as $$
  select case when g.owner_user_id = check_user_id then 'owner' else m.role end
  from public.river_share_groups g
  left join public.river_share_group_members m on m.group_id = g.id and m.member_user_id = check_user_id and m.status = 'accepted'
  where g.id = check_group_id and g.deleted_at is null and check_user_id = auth.uid()
    and (g.owner_user_id = check_user_id or m.member_user_id is not null);
$$;

create or replace function public.river_team_invite_matches(check_email text, check_user_id uuid)
returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (select 1 from auth.users u where u.id = auth.uid()
    and u.email_confirmed_at is not null and lower(btrim(u.email)) = lower(btrim(check_email))
    and (check_user_id is null or check_user_id = u.id));
$$;

create or replace function public.river_team_access()
returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (select 1 from public.river_share_groups g where public.river_team_role(g.id, auth.uid()) is not null);
$$;

-- Match the existing app entitlement's enabled flag. Team membership never
-- changes this allowlist or grants permission to publish/read Public River.
create or replace function public.is_shared_team_beta_user(check_user_id uuid)
returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select check_user_id = auth.uid() and exists (
    select 1 from public.shared_team_beta_users b where b.user_id = check_user_id and b.enabled = true);
$$;

create or replace function public.river_private_document_visible_to_user(check_document_id uuid, check_user_id uuid)
returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select check_user_id = auth.uid() and exists (
    select 1 from public.river_documents d where d.id = check_document_id and d.deleted_at is null and (
      d.created_by = check_user_id
      or exists (select 1 from public.river_document_targets t
        join public.river_share_groups g on t.target_kind = 'group' and t.target_id = g.id::text
        where t.document_id = d.id and t.revoked_at is null and public.river_team_role(g.id, check_user_id) is not null)
      or exists (select 1 from public.river_document_audience a
        where a.document_id = d.id and a.recipient_user_id = check_user_id and a.revoked_at is null
          and (a.source_type = 'direct'
            or (a.source_type = 'person' and exists (select 1 from public.river_document_targets t
              where t.id::text = a.source_id and t.document_id = d.id and t.target_kind = 'person'
                and t.target_id = check_user_id::text and t.revoked_at is null))
            or (a.source_type in ('legacy_team', 'team') and exists (select 1 from public.river_share_groups g
              where g.legacy_owner_user_id::text = a.source_id and public.river_team_role(g.id, check_user_id) is not null))))
    ));
$$;

create or replace function public.river_private_document_ids()
returns uuid[] language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(array_agg(d.id order by d.id), array[]::uuid[]) from public.river_documents d
  where public.river_private_document_visible_to_user(d.id, auth.uid());
$$;

create or replace function public.river_document_visible_to_user(check_document_id uuid, check_user_id uuid)
returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select check_user_id = auth.uid() and (
    public.river_private_document_visible_to_user(check_document_id, check_user_id)
    or exists (select 1 from public.river_documents d join public.river_document_targets t on t.document_id = d.id
      where d.id = check_document_id and d.deleted_at is null and t.target_kind = 'public'
        and t.target_id = 'public' and t.revoked_at is null and public.is_shared_team_beta_user(check_user_id))
  );
$$;

-- The row-local owner branch also permits INSERT ... RETURNING: a stable
-- helper's snapshot cannot see a document inserted by the same command.
drop policy if exists "river documents visible through River visibility helper" on public.river_documents;
create policy "river documents visible through River visibility helper" on public.river_documents for select to authenticated
  using (created_by = auth.uid() or public.river_document_visible_to_user(id, auth.uid()));
drop policy if exists "river targets visible to authorized viewers" on public.river_document_targets;
create policy "river targets visible to authorized viewers" on public.river_document_targets for select to authenticated
  using (created_by = auth.uid() or public.river_target_visible_to_user(id, auth.uid()));

-- Remove all legacy write paths. An invitee must not be able to rewrite an
-- invitation's group or identity, or turn their membership into an admin row.
drop policy if exists "river groups managed by owner" on public.river_share_groups;
drop policy if exists "river groups visible to owner or members" on public.river_share_groups;
drop policy if exists "river group members managed by group owner" on public.river_share_group_members;
drop policy if exists "river group members can respond to own invites" on public.river_share_group_members;
drop policy if exists "river group members visible to group participants" on public.river_share_group_members;
drop policy if exists "river group invites managed by group owner" on public.river_share_group_invites;
drop policy if exists "river group invitees can respond" on public.river_share_group_invites;
drop policy if exists "river group invites visible to owner or invitee" on public.river_share_group_invites;
revoke insert, update, delete on public.river_share_groups, public.river_share_group_members, public.river_share_group_invites from anon, authenticated;
grant select on public.river_share_groups, public.river_share_group_members, public.river_share_group_invites to authenticated;
create policy "river teams visible to participants" on public.river_share_groups for select to authenticated
  using (public.river_team_role(id, auth.uid()) is not null);
create policy "river team membership visible to participants or self" on public.river_share_group_members for select to authenticated
  using (member_user_id = auth.uid() or public.river_team_role(group_id, auth.uid()) is not null);
create policy "river team invitations visible to managers or intended invitee" on public.river_share_group_invites for select to authenticated
  using (public.river_team_role(group_id, auth.uid()) in ('owner', 'admin') or public.river_team_invite_matches(invited_email, invited_user_id));

drop policy if exists "river targets managed by document owner" on public.river_document_targets;
create policy "river targets managed by document owner" on public.river_document_targets for all to authenticated
  using (exists (select 1 from public.river_documents d where d.id = document_id and d.created_by = auth.uid()))
  with check (created_by = auth.uid()
    and exists (select 1 from public.river_documents d where d.id = document_id and d.created_by = auth.uid())
    and (target_kind <> 'group' or revoked_at is not null or exists (
      select 1 from public.river_share_groups g where g.id::text = target_id and public.river_team_role(g.id, auth.uid()) is not null))
    and (target_kind <> 'public' or revoked_at is not null or public.is_shared_team_beta_user(auth.uid())));

-- Pins use the same live grant check as document reads. A stale audience row
-- cannot keep a removed member's server-side access alive.
drop policy if exists "river pins are per user" on public.river_document_pins;
create policy "river pins are per user" on public.river_document_pins for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and pinned_by = auth.uid() and public.river_document_visible_to_user(document_id, auth.uid()));

-- Older clients still query team_documents through contact-backed policies.
-- A restrictive policy closes that read/write route after migration without
-- deleting contacts or independent personal grants/copies. Existing policies
-- continue to decide who may edit within an active team.
alter table public.team_documents enable row level security;
create policy "legacy River requires current named team access" on public.team_documents as restrictive for all to authenticated
  using (created_by = auth.uid() or exists (
    select 1 from public.river_share_groups g where g.legacy_owner_user_id = team_scope_user_id
      and public.river_team_role(g.id, auth.uid()) is not null))
  with check (exists (select 1 from public.river_share_groups g where g.legacy_owner_user_id = team_scope_user_id
    and public.river_team_role(g.id, auth.uid()) is not null));
alter table public.team_document_pins enable row level security;
create policy "legacy River pins require current document access" on public.team_document_pins as restrictive for all to authenticated
  using (exists (select 1 from public.team_documents d where d.id = document_id))
  with check (exists (select 1 from public.team_documents d where d.id = document_id));

create or replace function public.river_team_state()
returns jsonb language sql stable security definer set search_path = pg_catalog, public as $$
  select jsonb_build_object(
    'teams', coalesce((select jsonb_agg(jsonb_build_object(
      'id', g.id, 'name', g.name, 'role', public.river_team_role(g.id, auth.uid()),
      'members', (select coalesce(jsonb_agg(jsonb_build_object('userId', member_id, 'email', email, 'role', role) order by rank, lower(email)), '[]'::jsonb)
        from (select u.id as member_id, coalesce(u.email, '') as email, 'owner' as role, 0 as rank
              from auth.users u where u.id = g.owner_user_id
              union all
              select u.id, coalesce(u.email, ''), m.role, case when m.role = 'admin' then 1 else 2 end
              from public.river_share_group_members m join auth.users u on u.id = m.member_user_id
              where m.group_id = g.id and m.status = 'accepted' and m.member_user_id <> g.owner_user_id) members),
      'pendingInvites', case when public.river_team_role(g.id, auth.uid()) in ('owner', 'admin') then
        (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'teamId', g.id, 'teamName', g.name, 'email', i.invited_email, 'createdAt', i.created_at) order by i.created_at), '[]'::jsonb)
         from public.river_share_group_invites i where i.group_id = g.id and i.status = 'pending') else '[]'::jsonb end
    ) order by lower(g.name), g.id) from public.river_share_groups g where public.river_team_role(g.id, auth.uid()) is not null), '[]'::jsonb),
    'incomingInvites', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'teamId', g.id, 'teamName', g.name, 'email', i.invited_email, 'createdAt', i.created_at) order by i.created_at)
      from public.river_share_group_invites i join public.river_share_groups g on g.id = i.group_id
      where i.status = 'pending' and g.deleted_at is null and public.river_team_invite_matches(i.invited_email, i.invited_user_id)), '[]'::jsonb));
$$;

create or replace function public.river_team_mutate(action jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  actor uuid := auth.uid();
  operation text := action ->> 'kind';
  team_id uuid;
  team public.river_share_groups%rowtype;
  invitation public.river_share_group_invites%rowtype;
  actor_role text;
  subject uuid;
  subject_role text;
  team_name text;
  email_address text;
begin
  if actor is null then raise exception 'Sign in to manage teams'; end if;
  if operation = 'create' then
    team_name := btrim(coalesce(action ->> 'name', ''));
    if length(team_name) < 1 or length(team_name) > 80 then raise exception 'Team names must be between 1 and 80 characters'; end if;
    insert into public.river_share_groups(owner_user_id, name) values(actor, team_name) returning id into team_id;
    insert into public.river_share_group_members(group_id, member_user_id, status, role, responded_at)
      values(team_id, actor, 'accepted', 'member', now());
    return jsonb_build_object('ok', true, 'teamId', team_id);
  end if;
  if operation in ('respond', 'cancelInvite') then
    select * into invitation from public.river_share_group_invites where id = (action ->> 'inviteId')::uuid;
    team_id := invitation.group_id;
  else
    team_id := (action ->> 'teamId')::uuid;
  end if;
  select * into team from public.river_share_groups where id = team_id for update;
  if not found or team.deleted_at is not null then raise exception 'Team is unavailable'; end if;
  actor_role := public.river_team_role(team_id, actor);

  if operation in ('respond', 'cancelInvite') then
    -- Re-read after the team lock: cancellation and acceptance serialize on it.
    select * into invitation from public.river_share_group_invites where id = (action ->> 'inviteId')::uuid for update;
    if not found or invitation.group_id <> team_id or invitation.status <> 'pending' then raise exception 'Invitation is no longer pending'; end if;
    if operation = 'respond' then
      if not public.river_team_invite_matches(invitation.invited_email, invitation.invited_user_id) then raise exception 'This invitation is for another verified email address'; end if;
      if jsonb_typeof(action -> 'accept') is distinct from 'boolean' then raise exception 'Choose accept or decline'; end if;
      update public.river_share_group_invites set status = case when (action ->> 'accept')::boolean then 'accepted' else 'declined' end,
        invited_user_id = actor, responded_at = now(), updated_at = now() where id = invitation.id;
      -- Preserve the existing contact invitation's acceptance semantics, so a
      -- migrated invite does not remain Pending in direct-person destinations.
      -- Later team removal does not delete the accepted personal contact.
      if (action ->> 'accept')::boolean then
        update public.contacts set status = 'accepted', contact_user_id = actor
          where id = invitation.legacy_contact_id and owner_user_id = team.legacy_owner_user_id
            and relationship_type = 'team' and status = 'pending'
            and lower(btrim(contact_email)) = invitation.invited_email;
      else
        delete from public.contacts where id = invitation.legacy_contact_id and owner_user_id = team.legacy_owner_user_id
          and relationship_type = 'team' and status = 'pending' and lower(btrim(contact_email)) = invitation.invited_email;
      end if;
      if (action ->> 'accept')::boolean and actor <> team.owner_user_id then
        insert into public.river_share_group_members(group_id, member_user_id, status, role, invited_email, invited_by_user_id, responded_at)
          values(team_id, actor, 'accepted', 'member', invitation.invited_email, invitation.invited_by_user_id, now())
        on conflict (group_id, member_user_id) do update set status = 'accepted',
          role = case when river_share_group_members.status = 'accepted' then river_share_group_members.role else 'member' end,
          invited_email = excluded.invited_email, invited_by_user_id = excluded.invited_by_user_id, responded_at = now(), updated_at = now();
      end if;
    else
      if actor_role is null or actor_role not in ('owner', 'admin') then raise exception 'Only team owners and admins can cancel invitations'; end if;
      update public.river_share_group_invites set status = 'revoked', updated_at = now() where id = invitation.id;
      delete from public.contacts where id = invitation.legacy_contact_id and owner_user_id = team.legacy_owner_user_id
        and relationship_type = 'team' and status = 'pending' and lower(btrim(contact_email)) = invitation.invited_email;
    end if;
    return jsonb_build_object('ok', true, 'teamId', team_id);
  end if;

  if actor_role is null then raise exception 'You are not a member of this team'; end if;
  if operation = 'leave' then
    if actor_role = 'owner' then raise exception 'Transfer ownership or delete the team before leaving'; end if;
    subject := actor;
  elsif operation in ('remove', 'role', 'transfer') then
    subject := (action ->> 'userId')::uuid;
    select case when team.owner_user_id = subject then 'owner' else m.role end into subject_role
      from (select 1) seed left join public.river_share_group_members m
        on m.group_id = team_id and m.member_user_id = subject and m.status = 'accepted';
    if subject is null or subject_role is null then raise exception 'Choose a current team member'; end if;
    if operation in ('role', 'transfer') and actor_role <> 'owner' then raise exception 'Only the owner can change team roles'; end if;
    if operation = 'remove' and (subject_role = 'owner' or actor_role not in ('owner', 'admin') or (actor_role = 'admin' and subject_role <> 'member')) then
      raise exception 'You cannot remove this team member';
    end if;
  end if;

  if operation in ('leave', 'remove') then
    update public.river_share_group_members set status = case when operation = 'leave' then 'left' else 'revoked' end,
      role = 'member', updated_at = now() where group_id = team_id and member_user_id = subject;
    update public.river_share_group_invites set status = 'revoked', updated_at = now()
      where group_id = team_id and status = 'pending' and (invited_user_id = subject
        or invited_email = (select lower(btrim(email)) from auth.users where id = subject));
    update public.river_document_audience a set revoked_at = now(), updated_at = now()
      where a.recipient_user_id = subject and a.revoked_at is null and (
        (a.source_type = 'group' and exists (select 1 from public.river_document_targets t where t.id::text = a.source_id and t.target_kind = 'group' and t.target_id = team_id::text))
        or (a.source_type in ('team', 'legacy_team') and a.source_id = team.legacy_owner_user_id::text));
  elsif operation = 'role' then
    if subject_role = 'owner' or action ->> 'role' not in ('admin', 'member') or action ->> 'role' is null then raise exception 'Choose admin or member for a non-owner'; end if;
    update public.river_share_group_members set role = action ->> 'role', updated_at = now() where group_id = team_id and member_user_id = subject;
  elsif operation = 'transfer' then
    if subject = actor then raise exception 'Choose another member as owner'; end if;
    insert into public.river_share_group_members(group_id, member_user_id, status, role, responded_at)
      values(team_id, actor, 'accepted', 'admin', now())
      on conflict (group_id, member_user_id) do update set status = 'accepted', role = 'admin', updated_at = now();
    update public.river_share_group_members set role = 'member', updated_at = now() where group_id = team_id and member_user_id = subject;
    update public.river_share_groups set owner_user_id = subject, updated_at = now() where id = team_id;
  elsif operation = 'rename' then
    if actor_role not in ('owner', 'admin') then raise exception 'Only team owners and admins can rename teams'; end if;
    team_name := btrim(coalesce(action ->> 'name', ''));
    if length(team_name) < 1 or length(team_name) > 80 then raise exception 'Team names must be between 1 and 80 characters'; end if;
    update public.river_share_groups set name = team_name, updated_at = now() where id = team_id;
  elsif operation = 'invite' then
    if actor_role not in ('owner', 'admin') then raise exception 'Only team owners and admins can invite people'; end if;
    email_address := lower(btrim(coalesce(action ->> 'email', '')));
    if length(email_address) > 254 or email_address !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Enter a valid email address'; end if;
    select id into subject from auth.users where lower(btrim(email)) = email_address and email_confirmed_at is not null order by created_at limit 1;
    if subject = team.owner_user_id or exists (select 1 from public.river_share_group_members where group_id = team_id and member_user_id = subject and status = 'accepted') then
      raise exception 'This person is already on the team';
    end if;
    insert into public.river_share_group_invites(group_id, invited_email, invited_user_id, invited_by_user_id)
      values(team_id, email_address, subject, actor) on conflict do nothing;
  elsif operation = 'delete' then
    if actor_role <> 'owner' then raise exception 'Only the owner can delete this team'; end if;
    update public.river_share_groups set deleted_at = now(), updated_at = now() where id = team_id;
    update public.river_share_group_members set status = 'revoked', role = 'member', updated_at = now() where group_id = team_id;
    update public.river_share_group_invites set status = 'revoked', updated_at = now() where group_id = team_id and status = 'pending';
    update public.river_document_audience a set revoked_at = now(), updated_at = now()
      where a.source_type = 'group' and a.revoked_at is null and exists (
        select 1 from public.river_document_targets t where t.id::text = a.source_id and t.target_kind = 'group' and t.target_id = team_id::text);
  else
    raise exception 'Unknown team action';
  end if;
  return jsonb_build_object('ok', true, 'teamId', team_id);
exception
  when raise_exception then return jsonb_build_object('ok', false, 'error', sqlerrm);
  when invalid_text_representation then return jsonb_build_object('ok', false, 'error', 'Invalid team request');
end;
$$;

revoke all on function public.river_team_role(uuid, uuid), public.river_team_invite_matches(text, uuid),
  public.is_shared_team_beta_user(uuid),
  public.river_team_access(), public.river_private_document_visible_to_user(uuid, uuid),
  public.river_private_document_ids(), public.river_document_visible_to_user(uuid, uuid),
  public.river_team_state(), public.river_team_mutate(jsonb) from public, anon;
grant execute on function public.river_team_role(uuid, uuid), public.river_team_invite_matches(text, uuid),
  public.is_shared_team_beta_user(uuid),
  public.river_team_access(), public.river_private_document_ids(), public.river_document_visible_to_user(uuid, uuid),
  public.river_team_state(), public.river_team_mutate(jsonb) to authenticated;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'river_share_groups') then
      alter publication supabase_realtime add table public.river_share_groups;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'river_share_group_invites') then
      alter publication supabase_realtime add table public.river_share_group_invites;
    end if;
  end if;
end $$;
