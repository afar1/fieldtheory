# River multiple-team database verification

Run the isolated PostgreSQL tests:

```sh
cd supabase/tests/river-teams
npm ci --ignore-scripts
npm test
```

The tests execute migrations 019, 020, and
`20260908120000_river_multiple_teams.sql` in PGlite's PostgreSQL engine. Auth
identity, the older contacts-backed policy helpers, and hosted transport are
fixtures. The suite verifies real SQL, function grants, RLS, role transitions,
history access, revocation, migration preservation, and Public River isolation.
It does not establish hosted email delivery, Realtime WebSocket delivery, or
simultaneous independent PostgreSQL-session behavior. Team mutation functions
lock the team row before re-reading invitations and authorizing changes; replay
and cancellation ordering are covered by executable tests.

## API

- `river_team_state()` returns the shared `RiverTeamsState` camelCase JSON.
- `river_team_mutate(action jsonb)` accepts the shared `RiverTeamAction` union
  and returns `{ok, teamId?, error?}`.
- `river_team_access()` permits owners and accepted members of active teams;
  pending invitations alone do not grant River access.
- `river_private_document_ids()` returns current readable document UUIDs from
  ownership, direct/person grants, and active team targets. Public-only grants
  are excluded. Authors retain their independent ownership of public posts.

Invitations are normalized by trimming and lowercasing the email address. New
accounts see their invitation after authenticating with that confirmed email.
The database checks `auth.users.email_confirmed_at` and the actual account email,
not a supplied JWT email claim. A previously bound account ID must also match.
Invitations do not send an email; they appear in Field Theory after sign-in.

## Migration and rollout

The migration requires the River tables from 019/020, legacy `team_documents`,
`team_document_pins`, and `contacts`, plus `shared_team_beta_users.enabled` and
`auth.users.email_confirmed_at`. The read-only production preflight
confirmed these prerequisites and both older and newer permissive legacy River
policies. No hosted migration is applied by these tests.

Each legacy owner scope becomes a separate named team. The mapping is retained
in `river_share_groups.legacy_owner_user_id`; group targets, defaults, and source
preferences move to the actual team UUID. Existing named groups remain separate.
Legacy posts missing from the canonical River table are backfilled, including
posts created by old clients after 019. Existing canonical content is preserved.
Accepted contacts become accepted members. Pending contacts and old pending
member rows become explicit invitations. Accepting a migrated contact invitation
updates that original pending contact; declining/cancelling removes only that
pending contact, matching the old invitation response behavior. Later removal
from a team leaves accepted personal contacts and independent direct grants intact.

An owner is authoritative through `river_share_groups.owner_user_id`. Each team
also retains an owner membership row so all clients can observe deletion through
their own membership subscription. Membership rows use `admin` or `member`; the
state RPC derives the owner's displayed `owner` role. Every role and membership
mutation locks the team row. Ownership transfer makes the prior owner an admin.
Team names are display labels, so duplicate names do not block a transfer.

Deploy the migration before enabling the new Mac build's team controls. Treat
this as a forward migration: restoring the old broad policies would reopen
revoked access. If a client rollback is needed, retain the new server policies
and RPCs. Older clients cannot manage named teams through direct table writes.

After authorized hosted activation, verify:

1. Existing owner/member accounts still see their separate migrated teams and
   historical River posts; the beta allowlist rows are unchanged.
2. A new invitation reaches the intended account, including an account created
   after the invitation. Joining loads team history without materialized grants.
3. Removing the member causes their own membership Realtime event to refresh
   permissions; canonical and legacy server reads fail while an independently
   copied local file remains available.
4. A membership-only account cannot read or publish Public River. Enabled beta
   access still works; disabled allowlist rows do not grant access.

Groups and invitations are added to `supabase_realtime` when that publication
exists. Migration 020 already registers membership rows. Removed/left membership
rows remain selectable by their own user, permitting revocation notifications
after they lose visibility of the team.
