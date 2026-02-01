-- =============================================================================
-- User Commands: Synced portable commands for mobile voice invocation
-- =============================================================================
-- Commands (markdown files) from watched directories can be synced to Supabase
-- so they're accessible on mobile. When a user says "use the review command"
-- on mobile, we detect the invocation and inline the full command content.

-- Table to store synced commands
CREATE TABLE IF NOT EXISTS public.user_commands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Command identification
  name TEXT NOT NULL,                    -- Lowercase command name (e.g., "review")
  display_name TEXT NOT NULL,            -- Original casing (e.g., "Review")

  -- Command content
  content TEXT NOT NULL,                 -- Full markdown content of the command

  -- Source tracking (for sync)
  source_path TEXT,                      -- Original file path on Mac (for reference)
  content_hash TEXT,                     -- SHA256 of content for change detection

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Unique constraint: one command per name per user
  UNIQUE(user_id, name)
);

-- Index for efficient lookups by user
CREATE INDEX IF NOT EXISTS idx_user_commands_user_id ON public.user_commands(user_id);

-- Index for name lookups within a user's commands
CREATE INDEX IF NOT EXISTS idx_user_commands_user_name ON public.user_commands(user_id, name);

-- Trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION public.update_user_commands_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_user_commands_updated_at ON public.user_commands;
CREATE TRIGGER trigger_user_commands_updated_at
  BEFORE UPDATE ON public.user_commands
  FOR EACH ROW
  EXECUTE FUNCTION public.update_user_commands_updated_at();

-- RLS policies
ALTER TABLE public.user_commands ENABLE ROW LEVEL SECURITY;

-- Users can only see their own commands
CREATE POLICY "Users can view own commands"
  ON public.user_commands
  FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert their own commands
CREATE POLICY "Users can insert own commands"
  ON public.user_commands
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own commands
CREATE POLICY "Users can update own commands"
  ON public.user_commands
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Users can delete their own commands
CREATE POLICY "Users can delete own commands"
  ON public.user_commands
  FOR DELETE
  USING (auth.uid() = user_id);
