-- =============================================================================
-- Fix popular_commands insert policy to properly allow authenticated users.
-- The previous policy was too restrictive.
-- =============================================================================

-- Drop the old insert policy
drop policy if exists "Authenticated users can contribute commands" on public.popular_commands;

-- Create a simpler insert policy: authenticated users can insert,
-- and we automatically set contributed_by to their ID via the insert itself.
create policy "Authenticated users can contribute commands"
  on public.popular_commands
  for insert
  to authenticated
  with check (true);
