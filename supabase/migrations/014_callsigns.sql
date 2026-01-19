-- =============================================================================
-- Callsigns: Unique sci-fi inspired identifiers for all users (XXX-XXX format)
-- =============================================================================

-- Blocklist of offensive 3-letter combinations to avoid
CREATE OR REPLACE FUNCTION public.is_blocked_combo(combo text)
RETURNS boolean AS $$
BEGIN
  RETURN combo IN (
    'ASS', 'FAG', 'FUK', 'FUC', 'COK', 'DIK', 'DIE', 'CUM', 'NIG', 'JEW',
    'GAY', 'SEX', 'TIT', 'VAG', 'PUS', 'SHT', 'FCK', 'CNT', 'KKK', 'WTF',
    'STD', 'HIV', 'AID', 'PMS', 'BRA', 'BRO'
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Generate a random 3-letter combo
CREATE OR REPLACE FUNCTION public.random_letters(len int)
RETURNS text AS $$
DECLARE
  chars text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  result text := '';
  i int;
BEGIN
  FOR i IN 1..len LOOP
    result := result || substr(chars, floor(random() * 26 + 1)::int, 1);
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql VOLATILE;

-- Generate a unique callsign (XXX-XXX format)
CREATE OR REPLACE FUNCTION public.generate_callsign()
RETURNS text AS $$
DECLARE
  part1 text;
  part2 text;
  callsign text;
  attempts int := 0;
BEGIN
  LOOP
    part1 := public.random_letters(3);
    part2 := public.random_letters(3);

    -- Skip blocked combinations
    IF public.is_blocked_combo(part1) OR public.is_blocked_combo(part2) THEN
      CONTINUE;
    END IF;

    callsign := part1 || '-' || part2;

    -- Check if already exists
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE profiles.callsign = callsign) THEN
      RETURN callsign;
    END IF;

    attempts := attempts + 1;
    IF attempts > 100 THEN
      RAISE EXCEPTION 'Could not generate unique callsign after 100 attempts';
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql VOLATILE;

-- Add callsign column to profiles
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS callsign text UNIQUE;

-- Backfill existing users with callsigns
DO $$
DECLARE
  profile_record RECORD;
BEGIN
  FOR profile_record IN SELECT id FROM public.profiles WHERE callsign IS NULL LOOP
    UPDATE public.profiles
    SET callsign = public.generate_callsign()
    WHERE id = profile_record.id;
  END LOOP;
END $$;

-- Make callsign NOT NULL after backfill
ALTER TABLE public.profiles
ALTER COLUMN callsign SET NOT NULL;

-- Update the handle_new_user function to include callsign
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email, callsign)
  VALUES (new.id, new.email, public.generate_callsign())
  ON CONFLICT (id) DO UPDATE SET
    callsign = COALESCE(public.profiles.callsign, public.generate_callsign());
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
