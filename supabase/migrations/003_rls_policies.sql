-- Lock everything down so each user only sees their own rows.
alter table public.profiles enable row level security;
alter table public.todos enable row level security;
alter table public.observations enable row level security;
alter table public.transcripts enable row level security;

-- Profiles owner policies (select + update only by the logged-in user).
drop policy if exists "profiles owner select" on public.profiles;
create policy "profiles owner select" on public.profiles
for select using (auth.uid() = id);

drop policy if exists "profiles owner update" on public.profiles;
create policy "profiles owner update" on public.profiles
for update using (auth.uid() = id) with check (auth.uid() = id);

-- Todos owner-only policy covering select/insert/update/delete.
drop policy if exists "todos owner" on public.todos;
create policy "todos owner" on public.todos
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Observations owner-only policy.
drop policy if exists "observations owner" on public.observations;
create policy "observations owner" on public.observations
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Transcripts owner-only policy.
drop policy if exists "transcripts owner" on public.transcripts;
create policy "transcripts owner" on public.transcripts
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
