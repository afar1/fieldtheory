-- Shared Readings - Public sharing for Librarian readings
-- URL: librarian.fieldtheory.dev/{slug}

CREATE TABLE IF NOT EXISTS public.shared_readings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  content text NOT NULL,
  author_name text,
  is_public boolean NOT NULL DEFAULT true,
  source_path text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Fast lookup by slug for public page
CREATE INDEX IF NOT EXISTS idx_shared_readings_slug
  ON public.shared_readings(slug)
  WHERE is_public = true;

-- User's shared readings list
CREATE INDEX IF NOT EXISTS idx_shared_readings_user
  ON public.shared_readings(user_id);

-- Lookup by source_path for checking share status
CREATE INDEX IF NOT EXISTS idx_shared_readings_source_path
  ON public.shared_readings(user_id, source_path);

-- Enable RLS
ALTER TABLE public.shared_readings ENABLE ROW LEVEL SECURITY;

-- Owner full control
CREATE POLICY "shared_readings_owner" ON public.shared_readings
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Public read for shared readings (edge function uses anon key)
CREATE POLICY "shared_readings_public_read" ON public.shared_readings
  FOR SELECT USING (is_public = true);

-- Auto-update updated_at
DROP TRIGGER IF EXISTS set_shared_readings_updated_at ON public.shared_readings;
CREATE TRIGGER set_shared_readings_updated_at
  BEFORE UPDATE ON public.shared_readings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
