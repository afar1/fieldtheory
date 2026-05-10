-- Add client edit clocks and soft deletes for mobile row sync.
--
-- `updated_at` is a server write time. It is not enough to resolve offline
-- edits from multiple devices because the device that syncs later would look
-- newer even when its edit happened earlier.

alter table public.todos
  add column if not exists client_updated_at_ms bigint;

update public.todos
set client_updated_at_ms = floor(extract(epoch from updated_at) * 1000)::bigint
where client_updated_at_ms is null;

alter table public.todos
  alter column client_updated_at_ms set not null,
  add column if not exists deleted_at timestamptz;

create index if not exists idx_todos_user_deleted_client_updated
  on public.todos (user_id, deleted_at, client_updated_at_ms desc);

alter table public.observations
  add column if not exists client_updated_at_ms bigint;

update public.observations
set client_updated_at_ms = floor(extract(epoch from updated_at) * 1000)::bigint
where client_updated_at_ms is null;

alter table public.observations
  alter column client_updated_at_ms set not null,
  add column if not exists deleted_at timestamptz;

create index if not exists idx_observations_user_deleted_client_updated
  on public.observations (user_id, deleted_at, client_updated_at_ms desc);

alter table public.transcripts
  add column if not exists client_updated_at_ms bigint;

update public.transcripts
set client_updated_at_ms = floor(extract(epoch from updated_at) * 1000)::bigint
where client_updated_at_ms is null;

alter table public.transcripts
  alter column client_updated_at_ms set not null,
  add column if not exists deleted_at timestamptz;

create index if not exists idx_transcripts_user_deleted_client_updated
  on public.transcripts (user_id, deleted_at, client_updated_at_ms desc);
