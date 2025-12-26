-- =============================================================================
-- Sketch Items - Store sketches drawn on iOS for sync to Mac clipboard history.
--
-- Sketches are one-shot drawings captured on iOS and synced to Mac.
-- The PNG image is stored in Supabase Storage, metadata here.
-- =============================================================================

-- =============================================================================
-- Step 1: Create the storage bucket for sketch images.
-- Bucket is private (not public) - requires auth to access.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'sketch-images',
  'sketch-images',
  false,  -- Private bucket, access controlled via RLS.
  5242880,  -- 5MB max file size (sketches are typically small).
  array['image/png']
)
on conflict (id) do nothing;

-- =============================================================================
-- Step 2: Storage RLS policies for sketch images.
-- 
-- File path convention: {user_id}/{sketch_id}.png
-- Users can only access their own sketches.
-- =============================================================================

-- Policy: Users can upload to their own folder.
create policy "Users can upload sketches to their own folder"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'sketch-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Policy: Users can read their own files.
create policy "Users can read their own sketches"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'sketch-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Policy: Users can delete their own files.
create policy "Users can delete their own sketches"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'sketch-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- =============================================================================
-- Step 3: Create the sketch_items table for metadata.
-- =============================================================================

create table if not exists public.sketch_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  
  -- Client-generated ID for deduplication across devices.
  client_id text not null,
  
  -- Storage path in Supabase Storage (e.g., "{user_id}/{sketch_id}.png").
  image_path text not null,
  
  -- Image dimensions for proper display.
  width integer not null,
  height integer not null,
  
  -- File size in bytes.
  bytes integer not null,
  
  -- SHA256 hash for integrity and deduplication.
  sha256 text,
  
  -- Optional user-provided title/caption.
  title text,
  
  -- Original creation timestamp from the client (milliseconds since epoch).
  client_created_at_ms bigint not null,
  
  -- Server timestamps.
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes for efficient queries.
create index if not exists idx_sketch_items_user_id on public.sketch_items(user_id);
create index if not exists idx_sketch_items_client_id on public.sketch_items(client_id);
create index if not exists idx_sketch_items_created_at on public.sketch_items(client_created_at_ms desc);

-- Unique constraint to prevent duplicate syncs.
create unique index if not exists idx_sketch_items_user_client_id 
  on public.sketch_items(user_id, client_id);

-- =============================================================================
-- Step 4: RLS policies for sketch_items table.
-- Users can only see and modify their own sketches.
-- =============================================================================

alter table public.sketch_items enable row level security;

-- Users can view their own sketches.
create policy "Users can view own sketches"
  on public.sketch_items
  for select
  to authenticated
  using (auth.uid() = user_id);

-- Users can insert their own sketches.
create policy "Users can insert own sketches"
  on public.sketch_items
  for insert
  to authenticated
  with check (auth.uid() = user_id);

-- Users can update their own sketches.
create policy "Users can update own sketches"
  on public.sketch_items
  for update
  to authenticated
  using (auth.uid() = user_id);

-- Users can delete their own sketches.
create policy "Users can delete own sketches"
  on public.sketch_items
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- =============================================================================
-- Step 5: Trigger to update updated_at on changes.
-- =============================================================================

create trigger set_sketch_items_updated_at
  before update on public.sketch_items
  for each row
  execute function public.set_updated_at();
