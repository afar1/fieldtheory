-- Handy indexes when listing recents in descending order per user.
create index if not exists idx_todos_user_updated_at on public.todos (user_id, updated_at desc);
create index if not exists idx_observations_user_updated_at on public.observations (user_id, updated_at desc);
create index if not exists idx_transcripts_user_updated_at on public.transcripts (user_id, updated_at desc);
