-- =============================================================================
-- Popular Commands - Community-shared cursor commands with copy tracking.
-- Users can browse, copy, search, and share commands. Copy count determines
-- popularity ranking.
-- =============================================================================

create table if not exists public.popular_commands (
  id uuid primary key default gen_random_uuid(),
  
  -- Command name (short identifier, like the markdown filename).
  name text not null,
  
  -- Full command content that users copy.
  content text not null,
  
  -- Number of times this command has been copied. Used for ranking.
  copy_count integer not null default 0,
  
  -- User who contributed this command (null for seed/admin-added commands).
  contributed_by uuid references auth.users (id) on delete set null,
  
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  
  -- Ensure unique command names to avoid duplicates.
  constraint popular_commands_unique_name unique (name)
);

-- Index for efficient ordering by popularity.
create index if not exists idx_popular_commands_copy_count 
  on public.popular_commands(copy_count desc);

-- Full-text search index on name and content for search functionality.
create index if not exists idx_popular_commands_search 
  on public.popular_commands using gin(to_tsvector('english', name || ' ' || content));

-- Enable RLS.
alter table public.popular_commands enable row level security;

-- Anyone can read all commands (even unauthenticated for public browsing).
create policy "Anyone can read popular commands"
  on public.popular_commands
  for select
  using (true);

-- Authenticated users can contribute new commands.
create policy "Authenticated users can contribute commands"
  on public.popular_commands
  for insert
  to authenticated
  with check (contributed_by = auth.uid() or contributed_by is null);

-- Anyone can update copy_count (for incrementing on copy).
-- We restrict updates to only the copy_count field via RPC function.
create policy "Anyone can increment copy count"
  on public.popular_commands
  for update
  using (true)
  with check (true);

-- Only the contributor or admins can delete their own commands.
create policy "Contributors can delete own commands"
  on public.popular_commands
  for delete
  to authenticated
  using (
    contributed_by = auth.uid() 
    or exists (
      select 1 from public.profiles p 
      where p.id = auth.uid() and p.is_admin = true
    )
  );

-- Updated_at trigger for popular_commands.
create trigger set_popular_commands_updated_at
  before update on public.popular_commands
  for each row
  execute function public.handle_updated_at();

-- =============================================================================
-- RPC function to atomically increment copy count.
-- This is the safe way to track copies without race conditions.
-- =============================================================================

create or replace function public.increment_command_copy_count(command_id uuid)
returns integer as $$
declare
  new_count integer;
begin
  update public.popular_commands
  set copy_count = copy_count + 1
  where id = command_id
  returning copy_count into new_count;
  
  return coalesce(new_count, 0);
end;
$$ language plpgsql security definer;

-- =============================================================================
-- RPC function for full-text search on commands.
-- Returns commands matching the search query, ordered by relevance then popularity.
-- =============================================================================

create or replace function public.search_popular_commands(search_query text)
returns setof public.popular_commands as $$
begin
  if search_query is null or trim(search_query) = '' then
    -- Return all commands ordered by popularity if no search query.
    return query
      select * from public.popular_commands
      order by copy_count desc, created_at desc;
  else
    -- Full-text search with relevance ranking.
    return query
      select pc.* from public.popular_commands pc
      where to_tsvector('english', pc.name || ' ' || pc.content) 
            @@ plainto_tsquery('english', search_query)
      order by 
        ts_rank(to_tsvector('english', pc.name || ' ' || pc.content), 
                plainto_tsquery('english', search_query)) desc,
        pc.copy_count desc;
  end if;
end;
$$ language plpgsql security definer stable;

-- =============================================================================
-- Enable Realtime for popular_commands table (optional - for live updates).
-- =============================================================================

alter publication supabase_realtime add table public.popular_commands;
