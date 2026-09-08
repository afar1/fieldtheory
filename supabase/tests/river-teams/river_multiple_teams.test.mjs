import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

// Real PostgreSQL/RLS execution in WASM. The auth schema is a fixture; this does
// not assert hosted email delivery or Realtime WebSocket delivery.
const owner = '11111111-1111-4111-8111-111111111111';
const admin = '22222222-2222-4222-8222-222222222222';
const member = '33333333-3333-4333-8333-333333333333';
const outsider = '44444444-4444-4444-8444-444444444444';
const unverified = '55555555-5555-4555-8555-555555555555';
const future = '66666666-6666-4666-8666-666666666666';
const beta = '77777777-7777-4777-8777-777777777777';
const oldDoc = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherOldDoc = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const oldNamed = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const post019Doc = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
let db;
let sequence = 0;

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz, created_at timestamptz default now());
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as
      $$select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb$$;
    grant usage on schema public, auth to anon, authenticated;
    grant execute on function auth.uid(), auth.jwt() to anon, authenticated;
    create table public.contacts(id uuid primary key default gen_random_uuid(), owner_user_id uuid references auth.users,
      contact_email text not null, contact_user_id uuid references auth.users, relationship_type text, status text, created_at timestamptz default now());
    create table public.team_documents(id uuid primary key, team_scope_user_id uuid references auth.users,
      kind text default 'document', path text default 'History.md', title text default 'History', content text default 'Historical content',
      content_hash text, client_id text, client_created_at_ms bigint default 1, created_by uuid references auth.users,
      updated_by uuid references auth.users, deleted_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now(),
      original_source_path text, shared_name text, author_initials text, revision bigint default 0, author_callsign text);
    create table public.team_document_pins(team_scope_user_id uuid, pinned_by uuid, document_id uuid, updated_at timestamptz);
    create table public.shared_team_beta_users(user_id uuid primary key references auth.users, enabled boolean not null default true);
    insert into auth.users(id,email,email_confirmed_at) values
      ('${owner}','owner@example.com',now()), ('${admin}','admin@example.com',now()),
      ('${member}','member@example.com',now()), ('${outsider}','outsider@example.com',now()),
      ('${unverified}','unverified@example.com',null), ('${beta}','beta@example.com',now());
    insert into public.shared_team_beta_users(user_id) values ('${beta}');
    insert into public.contacts(owner_user_id,contact_email,contact_user_id,relationship_type,status) values
      ('${owner}','MEMBER@example.com','${member}','team','accepted'),
      ('${owner}','future@example.com',null,'team','pending'),
      ('${owner}','declined@example.com',null,'team','declined'),
      ('${owner}','revoked@example.com',null,'team','revoked'),
      ('${outsider}','admin@example.com','${admin}','team','accepted');
    insert into public.team_documents(id,team_scope_user_id,client_id,created_by,updated_by) values
      ('${oldDoc}','${owner}','old-one','${owner}','${owner}'),
      ('${otherOldDoc}','${outsider}','old-two','${outsider}','${outsider}');
  `);
  for (const file of ['019_river_document_grants.sql', '020_river_timeline_targets.sql']) {
    await db.exec(await readFile(new URL(`../../migrations/${file}`, import.meta.url), 'utf8'));
  }
  await db.exec(`insert into public.river_share_groups(id,owner_user_id,name) values ('${oldNamed}','${owner}','Other existing team');
    insert into public.team_documents(id,team_scope_user_id,client_id,created_by,updated_by,content)
      values ('${post019Doc}','${owner}','post-019','${owner}','${owner}','Posted from an old client after 019');
    insert into public.river_share_group_invites(group_id,invited_email,invited_by_user_id) values
      ('${oldNamed}',' normalized@example.com ','${owner}'), ('${oldNamed}','NORMALIZED@example.com','${owner}');
    insert into public.river_share_group_members(group_id,member_user_id,status,invited_email)
      values ('${oldNamed}','${unverified}','pending','unverified@example.com');
    insert into public.river_default_destinations(user_id,target_kind,target_id) values ('${owner}','group','${owner}');
    insert into public.river_source_preferences(user_id,source_kind,source_id,preference) values ('${owner}','group','${owner}','mute');
    alter table public.team_documents enable row level security;
    create function public.is_team_document_scope_participant(scope uuid) returns boolean language sql stable security definer as
      $$select scope=auth.uid() or exists (select 1 from public.contacts c
        where c.owner_user_id=scope and c.contact_user_id=auth.uid() and c.status='accepted')$$;
    create function public.is_team_document_scope_reader(scope uuid) returns boolean language sql stable security definer as
      $$select public.is_team_document_scope_participant(scope)$$;
    -- Model both permissive policy generations observed on the hosted schema.
    -- Restrictive checks must hold even though either generation may allow a row.
    create policy "Team participants can read River documents" on public.team_documents for select to authenticated
      using (public.is_team_document_scope_reader(team_scope_user_id));
    create policy "Team participants can create River documents" on public.team_documents for insert to authenticated
      with check (public.is_team_document_scope_participant(team_scope_user_id) and created_by=auth.uid() and updated_by=auth.uid());
    create policy "Team participants can update River documents" on public.team_documents for update to authenticated
      using (public.is_team_document_scope_participant(team_scope_user_id))
      with check (public.is_team_document_scope_participant(team_scope_user_id) and updated_by=auth.uid());
    create policy team_documents_select_team on public.team_documents for select
      using (public.is_shared_team_beta_user(auth.uid()) and public.is_team_document_scope_participant(team_scope_user_id));
    create policy team_documents_update_team on public.team_documents for update
      using (public.is_shared_team_beta_user(auth.uid()) and public.is_team_document_scope_participant(team_scope_user_id))
      with check (public.is_team_document_scope_participant(team_scope_user_id) and updated_by=auth.uid());
    alter table public.team_document_pins enable row level security;
    create policy legacy_pin_access on public.team_document_pins for all to authenticated using (pinned_by=auth.uid());
    grant select, insert, update, delete on all tables in schema public to authenticated;
  `);
  await db.exec(await readFile(new URL('../../migrations/20260908120000_river_multiple_teams.sql', import.meta.url), 'utf8'));
});
after(async () => { await db?.close(); });
beforeEach(async () => { await db.exec('begin'); await identity(owner); });
afterEach(async () => { await db.exec('rollback'); });

async function identity(id, role = 'authenticated', email = '') {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claims', $2, false)", [id || '', JSON.stringify({ sub: id, email })]);
  await db.exec(`set role ${role}`);
}
async function rpc(name, args = []) {
  return (await db.query(`select public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) as value`, args)).rows[0].value;
}
const mutate = (action) => rpc('river_team_mutate', [action]);
const state = () => rpc('river_team_state');
async function create(name = `Team ${++sequence}`) {
  const result = await mutate({ kind: 'create', name });
  assert.equal(result.ok, true, result.error);
  return result.teamId;
}
async function join(teamId, userId, email) {
  const invite = await mutate({ kind: 'invite', teamId, email });
  assert.equal(invite.ok, true, invite.error);
  await identity(userId);
  const incoming = (await state()).incomingInvites.find((i) => i.teamId === teamId);
  assert.ok(incoming);
  const result = await mutate({ kind: 'respond', inviteId: incoming.id, accept: true });
  assert.equal(result.ok, true, result.error);
  await identity(owner);
  return incoming.id;
}
async function document(targetKind, targetId) {
  const row = (await db.query(`insert into public.river_documents(kind,path,client_id,client_created_at_ms,created_by,updated_by)
    values('document','Document.md',$1,1,auth.uid(),auth.uid()) returning id`, [`doc-${++sequence}`])).rows[0];
  let target;
  if (targetKind) target = (await db.query(`insert into public.river_document_targets(document_id,target_kind,target_id,created_by)
    values($1,$2,$3,auth.uid()) returning id`, [row.id, targetKind, targetId])).rows[0].id;
  return { id: row.id, target };
}
async function visible(id) {
  return (await db.query('select id from public.river_documents where id=$1', [id])).rows.length === 1;
}

test('migration keeps legacy teams distinct, accepted contacts, pending pre-account invites, all history, and preferences', async () => {
  const current = await state();
  assert.equal(current.teams.length, 2);
  const legacy = current.teams.find((team) => team.id !== oldNamed);
  assert.equal(legacy.role, 'owner');
  assert.deepEqual(legacy.members.map((m) => m.userId).sort(), [owner, member].sort());
  assert.equal(legacy.pendingInvites[0].email, 'future@example.com');
  assert.equal(legacy.pendingInvites.length, 1, 'Declined/revoked contacts must not become new invitations');
  assert.deepEqual(current.teams.find((t) => t.id === oldNamed).pendingInvites.map((i) => i.email).sort(),
    ['normalized@example.com', 'unverified@example.com']);
  const target = (await db.query('select target_id from public.river_document_targets where document_id=$1', [oldDoc])).rows[0];
  assert.equal(target.target_id, legacy.id);
  assert.equal((await db.query('select target_id from public.river_default_destinations')).rows[0].target_id, legacy.id);
  assert.equal((await db.query('select source_id,preference from public.river_source_preferences')).rows[0].source_id, legacy.id);
  await identity(member);
  assert.equal(await visible(oldDoc), true);
  assert.equal(await visible(post019Doc), true);
  assert.equal((await db.query('select content from public.river_documents where id=$1', [post019Doc])).rows[0].content,
    'Posted from an old client after 019');
  assert.equal(await visible(otherOldDoc), false);
  assert.equal((await state()).teams.length, 1);
  await identity(admin);
  assert.equal(await visible(otherOldDoc), true);
  assert.equal(await visible(oldDoc), false);
});

test('accepting a migrated pre-account invitation also resolves its pending contact, and removal retains that accepted contact', async () => {
  const legacy = (await state()).teams.find((t) => t.id !== oldNamed);
  const invitation = legacy.pendingInvites[0];
  await db.exec('reset role');
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [future, invitation.email]);
  await identity(future);
  assert.equal((await mutate({ kind: 'respond', inviteId: invitation.id, accept: true })).ok, true);
  assert.equal(await visible(oldDoc), true);
  assert.equal(await visible(post019Doc), true);
  const contact = (await db.query('select id,status,contact_user_id from public.contacts where contact_email=$1', [invitation.email])).rows[0];
  assert.equal(contact.status, 'accepted');
  assert.equal(contact.contact_user_id, future);
  await identity(owner);
  assert.equal((await mutate({ kind: 'remove', teamId: legacy.id, userId: future })).ok, true);
  assert.equal((await db.query('select status from public.contacts where id=$1', [contact.id])).rows[0].status, 'accepted');
  await identity(future);
  assert.equal(await visible(oldDoc), false);
});

test('declining or cancelling migrated pending invitations removes only their original pending contact', async () => {
  const legacy = (await state()).teams.find((t) => t.id !== oldNamed);
  const invitation = legacy.pendingInvites[0];
  await db.exec('savepoint original');
  await db.exec('reset role');
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [future, invitation.email]);
  await identity(future);
  assert.equal((await mutate({ kind: 'respond', inviteId: invitation.id, accept: false })).ok, true);
  assert.equal((await db.query('select id from public.contacts where contact_email=$1', [invitation.email])).rows.length, 0);
  await db.exec('rollback to original');
  await identity(owner);
  assert.equal((await mutate({ kind: 'cancelInvite', inviteId: invitation.id })).ok, true);
  assert.equal((await db.query('select id from public.contacts where contact_email=$1', [invitation.email])).rows.length, 0);
  assert.equal((await db.query('select count(*)::int as n from public.contacts')).rows[0].n, 4);
});

test('any authenticated user can create and own multiple teams while outsiders cannot enumerate them', async () => {
  await identity(unverified);
  assert.equal(await rpc('river_team_access'), false);
  const first = await create('Design');
  const second = await create('Engineering');
  const result = await state();
  assert.deepEqual(result.teams.map((t) => t.id).sort(), [first, second].sort());
  assert.ok(result.teams.every((t) => t.role === 'owner' && t.members[0].userId === unverified));
  assert.equal(await rpc('river_team_access'), true);
  await identity(member);
  assert.equal((await db.query('select id from public.river_share_groups where id = any($1::uuid[])', [[first, second]])).rows.length, 0);
  assert.equal((await mutate({ kind: 'rename', teamId: first, name: 'Stolen' })).ok, false);
});

test('pre-account invitation needs explicit acceptance and a verified database email, never a claimed JWT email', async () => {
  const teamId = await create();
  assert.equal((await mutate({ kind: 'invite', teamId, email: '  FUTURE@example.com  ' })).ok, true);
  const inviteId = (await state()).teams.find((t) => t.id === teamId).pendingInvites[0].id;
  await identity(outsider, 'authenticated', 'future@example.com');
  assert.equal((await state()).incomingInvites.length, 0);
  assert.equal((await mutate({ kind: 'respond', inviteId, accept: true })).ok, false);
  await db.exec('reset role');
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,null)', [future, 'future@example.com']);
  await identity(future);
  assert.equal((await state()).incomingInvites.length, 0);
  assert.equal((await mutate({ kind: 'respond', inviteId, accept: true })).ok, false);
  assert.equal(await rpc('river_team_access'), false);
  await db.exec('reset role');
  await db.query('update auth.users set email_confirmed_at=now() where id=$1', [future]);
  await identity(future);
  assert.equal((await state()).incomingInvites.some((i) => i.id === inviteId), true);
  assert.equal(await rpc('river_team_access'), false);
  assert.equal((await mutate({ kind: 'respond', inviteId, accept: true })).ok, true);
  assert.equal(await rpc('river_team_access'), true);
  assert.equal((await state()).teams[0].role, 'member');
});

test('membership in several teams gives all targeted history without public entitlement', async () => {
  const first = await create();
  const second = await create();
  const firstDoc = await document('group', first);
  const secondDoc = await document('group', second);
  await identity(beta);
  const publicDoc = await document('public', 'public');
  await identity(owner);
  await join(first, member, 'member@example.com');
  await join(second, member, 'member@example.com');
  await identity(member);
  assert.equal(await visible(firstDoc.id), true);
  assert.equal(await visible(secondDoc.id), true);
  assert.equal(await visible(publicDoc.id), false);
  const ids = await rpc('river_private_document_ids');
  assert.ok(ids.includes(firstDoc.id) && ids.includes(secondDoc.id));
  assert.equal(ids.includes(publicDoc.id), false);
  await identity(beta);
  assert.equal(await visible(publicDoc.id), true);
  // The author has independent ownership; other beta users have only public access.
  assert.equal((await rpc('river_private_document_ids')).includes(publicDoc.id), true);
  assert.equal(await visible(firstDoc.id), false);
});

test('team membership cannot publish Public River and disabled beta rows neither read nor publish it', async () => {
  const privateDoc = await document();
  await db.exec('savepoint denied');
  await assert.rejects(db.query(`insert into public.river_document_targets(document_id,target_kind,target_id,created_by)
    values($1,'public','public',auth.uid())`, [privateDoc.id]), /row-level security/i);
  await db.exec('rollback to denied');
  await identity(beta);
  const publicDoc = await document('public', 'public');
  await db.exec('reset role');
  await db.query('insert into public.shared_team_beta_users(user_id,enabled) values($1,false)', [member]);
  await identity(member);
  assert.equal(await visible(publicDoc.id), false);
  assert.equal(await rpc('is_shared_team_beta_user', [member]), false);
  assert.equal(await rpc('is_shared_team_beta_user', [beta]), false);
  await db.exec('reset role');
  await db.query('update public.shared_team_beta_users set enabled=true where user_id=$1', [member]);
  await identity(member);
  assert.equal(await visible(publicDoc.id), true);
  assert.equal((await rpc('river_private_document_ids')).includes(publicDoc.id), false);
});

test('normal RBAC permits admin member management but reserves promotion, demotion, transfer, and deletion to owner', async () => {
  const teamId = await create();
  await join(teamId, admin, 'admin@example.com');
  await join(teamId, member, 'member@example.com');
  assert.equal((await mutate({ kind: 'role', teamId, userId: admin, role: 'admin' })).ok, true);
  await identity(admin);
  assert.equal((await mutate({ kind: 'rename', teamId, name: 'Renamed by admin' })).ok, true);
  assert.equal((await mutate({ kind: 'invite', teamId, email: 'new@example.com' })).ok, true);
  const inviteId = (await state()).teams.find((t) => t.id === teamId).pendingInvites[0].id;
  assert.equal((await mutate({ kind: 'cancelInvite', inviteId })).ok, true);
  for (const action of [
    { kind: 'role', userId: admin, role: 'member' }, { kind: 'role', userId: member, role: 'admin' },
    { kind: 'remove', userId: owner }, { kind: 'remove', userId: admin },
    { kind: 'transfer', userId: member }, { kind: 'delete' },
  ]) assert.equal((await mutate({ ...action, teamId })).ok, false, action.kind);
  assert.equal((await mutate({ kind: 'remove', teamId, userId: member })).ok, true);
  await identity(member);
  for (const kind of ['rename', 'invite', 'delete']) assert.equal((await mutate({ kind, teamId, name: 'No', email: 'no@example.com' })).ok, false);
});

test('ordinary accepted members cannot manage team or see pending invitations', async () => {
  const teamId = await create();
  await join(teamId, member, 'member@example.com');
  await mutate({ kind: 'invite', teamId, email: 'hidden@example.com' });
  await identity(member);
  const current = (await state()).teams.find((t) => t.id === teamId);
  assert.deepEqual(current.pendingInvites, []);
  assert.equal(current.members.length, 2);
  for (const action of [
    { kind: 'rename', name: 'No' }, { kind: 'invite', email: 'no@example.com' },
    { kind: 'role', userId: member, role: 'admin' }, { kind: 'remove', userId: owner }, { kind: 'delete' },
  ]) assert.equal((await mutate({ ...action, teamId })).ok, false, action.kind);
  assert.equal((await db.query('select id from public.river_share_group_invites where group_id=$1', [teamId])).rows.length, 1);
});

test('removal immediately revokes targeted history despite stale materialized grants, preserving direct grants and other teams', async () => {
  const teamId = await create();
  const otherTeam = await create();
  const teamOnly = await document('group', teamId);
  const withDirect = await document('group', teamId);
  const independentTeam = await document('group', otherTeam);
  await join(teamId, member, 'member@example.com');
  await join(otherTeam, member, 'member@example.com');
  for (const doc of [teamOnly, withDirect]) await db.query(`insert into public.river_document_audience(document_id,recipient_user_id,granted_by_user_id,source_type,source_id)
    values($1,$2,auth.uid(),'group',$3)`, [doc.id, member, doc.target]);
  await db.query(`insert into public.river_document_audience(document_id,recipient_user_id,granted_by_user_id,source_type,source_id)
    values($1,$2,auth.uid(),'direct','direct')`, [withDirect.id, member]);
  assert.equal((await mutate({ kind: 'remove', teamId, userId: member })).ok, true);
  // Even a stale/replayed materialized recipient write cannot reopen access.
  await db.query('update public.river_document_audience set revoked_at=null where document_id=$1', [teamOnly.id]);
  await identity(member);
  assert.equal(await visible(teamOnly.id), false);
  assert.equal(await visible(withDirect.id), true);
  assert.equal(await visible(independentTeam.id), true);
  assert.equal((await db.query('select status from public.river_share_group_members where group_id=$1 and member_user_id=auth.uid()', [teamId])).rows[0].status, 'revoked');
});

test('removal from a migrated team also closes old contact-backed document and pin reads without deleting contacts', async () => {
  const teamId = (await state()).teams.find((t) => t.id !== oldNamed).id;
  await identity(member);
  assert.equal((await db.query('select id from public.team_documents where id=$1', [oldDoc])).rows.length, 1);
  await db.query('insert into public.team_document_pins(team_scope_user_id,pinned_by,document_id,updated_at) values($1,auth.uid(),$2,now())', [owner, oldDoc]);
  const authored = (await db.query(`insert into public.team_documents(id,team_scope_user_id,client_id,created_by,updated_by)
    values(gen_random_uuid(),$1,'member-legacy',auth.uid(),auth.uid()) returning id`, [owner])).rows[0].id;
  await identity(owner);
  assert.equal((await mutate({ kind: 'remove', teamId, userId: member })).ok, true);
  await identity(member);
  assert.equal(await visible(oldDoc), false);
  assert.equal((await db.query('select id from public.team_documents where id=$1', [oldDoc])).rows.length, 0);
  assert.equal((await db.query('select document_id from public.team_document_pins where document_id=$1', [oldDoc])).rows.length, 0);
  assert.equal((await db.query('select id from public.contacts where owner_user_id=$1 and contact_user_id=auth.uid()', [owner])).rows.length, 1);
  assert.equal((await db.query('update public.team_documents set content=$1,updated_by=auth.uid() where id=$2 returning id', ['Forbidden edit', oldDoc])).rows.length, 0);
  await db.exec('savepoint denied');
  await assert.rejects(db.query(`insert into public.team_documents(id,team_scope_user_id,client_id,created_by,updated_by)
    values(gen_random_uuid(),$1,'removed-member-new',auth.uid(),auth.uid())`, [owner]), /row-level security/i);
  await db.exec('rollback to denied');
  await db.exec('savepoint denied');
  await assert.rejects(db.query('update public.team_documents set content=$1,updated_by=auth.uid() where id=$2', ['Forbidden edit', authored]), /row-level security/i);
  await db.exec('rollback to denied');
});

test('leave removes last team entitlement and deletion revokes members without deleting author documents', async () => {
  const teamId = await create();
  await join(teamId, beta, 'beta@example.com');
  const doc = await document('group', teamId);
  await identity(beta);
  assert.equal((await mutate({ kind: 'leave', teamId })).ok, true);
  assert.equal(await rpc('river_team_access'), false);
  assert.equal(await visible(doc.id), false);
  await identity(owner);
  assert.equal((await mutate({ kind: 'leave', teamId })).ok, false);
  await join(teamId, beta, 'beta@example.com');
  assert.equal((await mutate({ kind: 'delete', teamId })).ok, true);
  assert.equal(await visible(doc.id), true);
  await identity(beta);
  assert.equal(await visible(doc.id), false);
  assert.equal(await rpc('river_team_access'), false);
  assert.equal((await db.query('select status from public.river_share_group_members where group_id=$1', [teamId])).rows[0].status, 'revoked');
});

test('ownership transfers atomically, former owner becomes admin, and no member can remove the last owner', async () => {
  const teamId = await create('Same name');
  await join(teamId, member, 'member@example.com');
  await identity(member);
  await create('Same name');
  await identity(owner);
  assert.equal((await mutate({ kind: 'transfer', teamId, userId: member })).ok, true);
  assert.equal((await state()).teams.find((t) => t.id === teamId).role, 'admin');
  assert.equal((await mutate({ kind: 'remove', teamId, userId: member })).ok, false);
  await identity(member);
  assert.equal((await state()).teams.find((t) => t.id === teamId).role, 'owner');
  assert.equal((await mutate({ kind: 'role', teamId, userId: member, role: 'member' })).ok, false);
  assert.equal((await mutate({ kind: 'leave', teamId })).ok, false);
  assert.equal((await mutate({ kind: 'remove', teamId, userId: owner })).ok, true);
});

test('cancel, decline, and reinvite require the current invitation and cannot replay acceptance', async () => {
  const teamId = await create();
  await mutate({ kind: 'invite', teamId, email: 'member@example.com' });
  const first = (await state()).teams.find((t) => t.id === teamId).pendingInvites[0].id;
  await mutate({ kind: 'cancelInvite', inviteId: first });
  await identity(member);
  assert.equal((await mutate({ kind: 'respond', inviteId: first, accept: true })).ok, false);
  await identity(owner);
  await mutate({ kind: 'invite', teamId, email: 'member@example.com' });
  const second = (await state()).teams.find((t) => t.id === teamId).pendingInvites[0].id;
  assert.notEqual(first, second);
  await identity(member);
  assert.equal((await mutate({ kind: 'respond', inviteId: second, accept: false })).ok, true);
  assert.equal((await mutate({ kind: 'respond', inviteId: second, accept: true })).ok, false);
  await identity(owner);
  await join(teamId, member, 'member@example.com');
});

test('direct membership, group, and invite writes are denied rather than allowing self elevation or invite reassignment', async () => {
  const teamId = await create();
  await join(teamId, member, 'member@example.com');
  await identity(member);
  for (const query of [
    `update public.river_share_group_members set role='admin' where member_user_id=auth.uid()`,
    `update public.river_share_groups set owner_user_id=auth.uid() where id='${teamId}'`,
    `update public.river_share_group_invites set group_id='${oldNamed}'`,
    `insert into public.river_share_group_members(group_id,member_user_id) values('${oldNamed}',auth.uid())`,
  ]) {
    await db.exec('savepoint denied');
    await assert.rejects(db.exec(query), /permission denied/i);
    await db.exec('rollback to denied');
  }
});

test('document authors cannot post to a different team or forge group audiences to bypass membership', async () => {
  const teamId = await create();
  await identity(outsider);
  const doc = await document();
  await db.exec('savepoint denied');
  await assert.rejects(db.query(`insert into public.river_document_targets(document_id,target_kind,target_id,created_by)
    values($1,'group',$2,auth.uid())`, [doc.id, teamId]), /row-level security/i);
  await db.exec('rollback to denied');
  // Forged group grants have no authority without an active target/membership.
  await db.query(`insert into public.river_document_audience(document_id,recipient_user_id,granted_by_user_id,source_type,source_id)
    values($1,$2,auth.uid(),'group',$3)`, [doc.id, member, teamId]);
  await identity(member);
  assert.equal(await visible(doc.id), false);
});

test('RPCs reject anonymous callers and invalid requests without changing teams', async () => {
  const count = (await state()).teams.length;
  for (const action of [
    { kind: 'create', name: '' }, { kind: 'create', name: 'a'.repeat(81) },
    { kind: 'rename', teamId: 'not-a-uuid', name: 'No' }, { kind: 'unknown' },
  ]) assert.equal((await mutate(action)).ok, false);
  assert.equal((await state()).teams.length, count);
  await identity(null, 'anon');
  for (const call of ['river_team_access()', 'river_team_state()', 'river_private_document_ids()', `river_team_mutate('{"kind":"create","name":"No"}')`]) {
    await db.exec('savepoint denied');
    await assert.rejects(db.exec(`select public.${call}`), /permission denied/i);
    await db.exec('rollback to denied');
  }
});
