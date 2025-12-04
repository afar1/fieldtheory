-- Add metadata to transcripts so we can persist stacking info.
alter table if exists public.transcripts
add column if not exists metadata jsonb not null default '{}'::jsonb;

