-- =============================================================================
-- Team Image Storage - Use Supabase Storage buckets instead of bytea columns.
-- 
-- This migration:
-- 1. Creates a storage bucket for team clipboard images.
-- 2. Sets up RLS policies so users can upload their own images and 
--    teammates can read them.
-- 3. Adds an image_path column to team_clipboard_items to reference storage.
-- 4. Drops the image_data bytea column to avoid duplication.
-- =============================================================================

-- =============================================================================
-- Step 1: Create the storage bucket.
-- Bucket is private (not public) - requires auth to access.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'team-clipboard-images',
  'team-clipboard-images',
  false,  -- Private bucket, access controlled via RLS.
  10485760,  -- 10MB max file size.
  array['image/png', 'image/jpeg', 'image/gif', 'image/webp']
)
on conflict (id) do nothing;

-- =============================================================================
-- Step 2: Storage RLS policies.
-- 
-- File path convention: {user_id}/{item_id}.png
-- This allows ownership verification and teammate-based access.
-- =============================================================================

-- Policy: Users can upload to their own folder.
create policy "Users can upload to their own folder"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'team-clipboard-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Policy: Users can update/delete their own files.
create policy "Users can manage their own files"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'team-clipboard-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can delete their own files"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'team-clipboard-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Policy: Teammates can read each other's files.
-- Uses the existing get_teammate_user_ids() function from 007_team_clipboard.sql.
create policy "Teammates can read team images"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'team-clipboard-images'
    and (storage.foldername(name))[1]::uuid in (select public.get_teammate_user_ids())
  );

-- =============================================================================
-- Step 3: Add image_path column to team_clipboard_items.
-- This stores the path in storage (e.g., "{user_id}/{item_id}.png").
-- =============================================================================

alter table public.team_clipboard_items
  add column if not exists image_path text;

-- Index for quick lookups by image_path.
create index if not exists idx_team_clipboard_image_path 
  on public.team_clipboard_items(image_path);

-- =============================================================================
-- Step 4: Drop the bytea column.
-- 
-- NOTE: Run this AFTER deploying the new code that uses image_path.
-- Uncomment when ready to clean up:
-- 
-- alter table public.team_clipboard_items drop column if exists image_data;
-- =============================================================================

-- For now, we keep image_data as a fallback during transition.
-- The code will prefer image_path when available, fall back to image_data.
