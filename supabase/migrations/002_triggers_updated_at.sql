-- Keep updated_at accurate whenever a row changes.
create or replace function public.set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end; $$ language plpgsql;

-- Recreate triggers so the migration stays idempotent.
drop trigger if exists set_todos_updated_at on public.todos;
create trigger set_todos_updated_at
before update on public.todos
for each row execute function public.set_updated_at();

drop trigger if exists set_observations_updated_at on public.observations;
create trigger set_observations_updated_at
before update on public.observations
for each row execute function public.set_updated_at();

drop trigger if exists set_transcripts_updated_at on public.transcripts;
create trigger set_transcripts_updated_at
before update on public.transcripts
for each row execute function public.set_updated_at();
