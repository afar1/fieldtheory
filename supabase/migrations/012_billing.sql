-- =============================================================================
-- Billing columns for subscription management.
-- Adds tier (free/pro) and Stripe identifiers to profiles table.
-- =============================================================================

-- Add tier column with check constraint.
-- 'free' is the default tier for all users.
-- 'pro' is set via Stripe webhook when checkout completes.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS tier text NOT NULL DEFAULT 'free'
    CHECK (tier IN ('free', 'pro'));

-- Stripe customer and subscription identifiers.
-- Set by Stripe webhook during checkout.session.completed event.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text;

-- Index for looking up profiles by Stripe customer ID (webhook efficiency).
CREATE INDEX IF NOT EXISTS idx_profiles_stripe_customer_id
  ON public.profiles (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

-- RLS policy: users can read their own tier but not update it directly.
-- Tier updates are handled by the Stripe webhook Edge Function (service role).
CREATE POLICY "Users can read own tier"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

-- Note: Tier updates are done via service_role key in Edge Function,
-- which bypasses RLS. No user-facing update policy is needed.
