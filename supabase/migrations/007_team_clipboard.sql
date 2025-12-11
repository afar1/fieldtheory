-- =============================================================================
-- Team Clipboard - Shared clipboard items for team collaboration.
-- Users signed into the same account can share clipboard items with their team.
-- =============================================================================

-- Team clipboard items table.
-- Stores items shared with the team. Similar structure to local clipboard_items
-- but lives in Supabase for cross-device/cross-user access.
create table if not exists public.team_clipboard_items (
  id uuid primary key default gen_random_uuid(),
  
  -- Owner info - who originally shared this item.
  user_id uuid not null references auth.users (id) on delete cascade,
  shared_by_email text, -- Display name of who shared it.
  
  -- Item content - matches local clipboard structure.
  type text not null check (type in ('text', 'image', 'transcript', 'screenshot')),
  content text, -- Text content for text/transcript items.
  image_data bytea, -- Binary image data for image/screenshot items.
  image_width integer,
  image_height integer,
  image_size integer,
  
  -- Improved content from Engineer feature (if improved before sharing).
  improved_content text,
  
  -- Stack grouping - items with same stack_id form a stack.
  -- Stacks in team clipboard work the same as personal stacks.
  stack_id uuid,
  
  -- Metadata.
  source_app text, -- App that created the content (e.g., 'com.apple.Safari').
  source_app_name text, -- Display name (e.g., 'Safari').
  word_count integer,
  char_count integer,
  
  -- Client-generated ID for deduplication when copying to personal.
  -- Also used to track which items a user has already copied.
  client_id text not null,
  
  -- Timestamps.
  client_created_at_ms bigint not null, -- Original creation time on client.
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  
  -- Unique constraint: one client_id per user (prevents duplicate shares).
  constraint team_clipboard_unique_client_per_user unique (user_id, client_id)
);

-- Indexes for efficient querying.
create index if not exists idx_team_clipboard_user_id on public.team_clipboard_items(user_id);
create index if not exists idx_team_clipboard_created_at on public.team_clipboard_items(created_at desc);
create index if not exists idx_team_clipboard_stack_id on public.team_clipboard_items(stack_id);
create index if not exists idx_team_clipboard_type on public.team_clipboard_items(type);
create index if not exists idx_team_clipboard_client_created on public.team_clipboard_items(client_created_at_ms desc);

-- Enable RLS (Row Level Security).
alter table public.team_clipboard_items enable row level security;

-- RLS policies: All authenticated users can read team items.
-- Only the owner can insert/update/delete their own items.
create policy "Users can read all team clipboard items"
  on public.team_clipboard_items
  for select
  to authenticated
  using (true);

create policy "Users can insert their own team clipboard items"
  on public.team_clipboard_items
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update their own team clipboard items"
  on public.team_clipboard_items
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their own team clipboard items"
  on public.team_clipboard_items
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- Updated_at trigger (reuse pattern from existing triggers).
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger set_team_clipboard_updated_at
  before update on public.team_clipboard_items
  for each row
  execute function public.handle_updated_at();

-- =============================================================================
-- Team clipboard stacks - metadata for stacks.
-- Tracks who created/modified stacks and provides stack-level info.
-- =============================================================================

create table if not exists public.team_clipboard_stacks (
  id uuid primary key default gen_random_uuid(),
  
  -- The stack_id used in team_clipboard_items.
  stack_id uuid not null unique,
  
  -- Who created this stack.
  created_by_user_id uuid not null references auth.users (id) on delete cascade,
  created_by_email text,
  
  -- Stack name (optional, for user-friendly display).
  name text,
  
  -- Timestamps.
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes.
create index if not exists idx_team_stacks_stack_id on public.team_clipboard_stacks(stack_id);
create index if not exists idx_team_stacks_created_by on public.team_clipboard_stacks(created_by_user_id);

-- Enable RLS.
alter table public.team_clipboard_stacks enable row level security;

-- RLS policies: All authenticated users can read/modify stacks (collaborative).
create policy "Users can read all team stacks"
  on public.team_clipboard_stacks
  for select
  to authenticated
  using (true);

create policy "Users can insert team stacks"
  on public.team_clipboard_stacks
  for insert
  to authenticated
  with check (auth.uid() = created_by_user_id);

-- Anyone can update stacks (collaborative editing).
create policy "Users can update any team stack"
  on public.team_clipboard_stacks
  for update
  to authenticated
  using (true);

-- Only creator can delete stacks.
create policy "Creators can delete their team stacks"
  on public.team_clipboard_stacks
  for delete
  to authenticated
  using (auth.uid() = created_by_user_id);

-- Updated_at trigger for stacks.
create trigger set_team_stacks_updated_at
  before update on public.team_clipboard_stacks
  for each row
  execute function public.handle_updated_at();
