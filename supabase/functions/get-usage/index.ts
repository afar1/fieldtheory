// =============================================================================
// Get Usage Edge Function
// Returns the user's current usage for all quota-tracked features.
// Server is the single source of truth for usage data.
// =============================================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Environment variables
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

// Quota limits by tier for each feature.
// Free users have monthly limits, Pro users are unlimited (Infinity).
const QUOTA_LIMITS = {
  free: {
    text_improve_words: 5000,       // 5k words/month
    priority_mic_seconds: 30000,    // 500 minutes/month
    auto_stack_sessions: 50,        // 50 sessions/month
    portable_commands: 100,         // 100 commands/month (includes verbal commands)
  },
  pro: {
    text_improve_words: 50000,      // 50k words/month (soft limit for analytics)
    priority_mic_seconds: Infinity,
    auto_stack_sessions: Infinity,
    portable_commands: Infinity,
  },
};

// Trial cycle: 14 active days, then 16 expired days, repeating forever.
const TRIAL_ACTIVE_MS = 14 * 24 * 60 * 60 * 1000;
const TRIAL_CYCLE_MS  = 30 * 24 * 60 * 60 * 1000;

type TrialState = 'pro' | 'trial' | 'expired';

function computeState(profile: { is_paid_subscriber: boolean; trial_started_at: string | null; app_access_mode?: 'active' | 'read_only' | 'disabled' | null }): {
  state: TrialState;
  trialEndsAt: string | null;
  nextTrialResetAt: string | null;
} {
  if (profile.app_access_mode === 'disabled') {
    return { state: 'expired', trialEndsAt: null, nextTrialResetAt: null };
  }
  if (profile.app_access_mode === 'read_only') {
    return { state: 'expired', trialEndsAt: null, nextTrialResetAt: null };
  }
  if (profile.is_paid_subscriber) {
    return { state: 'pro', trialEndsAt: null, nextTrialResetAt: null };
  }
  const startMs = profile.trial_started_at ? new Date(profile.trial_started_at).getTime() : Date.now();
  const elapsedMs = Date.now() - startMs;
  const cycleIndex = Math.floor(elapsedMs / TRIAL_CYCLE_MS);
  const cycleStartMs = startMs + cycleIndex * TRIAL_CYCLE_MS;
  const cyclePosMs = elapsedMs - cycleIndex * TRIAL_CYCLE_MS;
  const trialEndsAt = new Date(cycleStartMs + TRIAL_ACTIVE_MS).toISOString();
  const nextTrialResetAt = new Date(cycleStartMs + TRIAL_CYCLE_MS).toISOString();
  return {
    state: cyclePosMs < TRIAL_ACTIVE_MS ? 'trial' : 'expired',
    trialEndsAt,
    nextTrialResetAt,
  };
}

// CORS headers for Electron app
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Accept GET requests
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Validate auth token
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Create Supabase client with service role
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Verify user token
  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);

  if (authError || !user) {
    console.error('[get-usage] Auth error:', authError);
    return new Response(JSON.stringify({ error: 'Invalid token' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Get user's profile (state inputs).
  const { data: profile } = await supabase
    .from('profiles')
    .select('tier, is_paid_subscriber, trial_started_at, app_access_mode')
    .eq('id', user.id)
    .single();

  const { state, trialEndsAt, nextTrialResetAt } = computeState({
    is_paid_subscriber: profile?.is_paid_subscriber ?? false,
    trial_started_at: profile?.trial_started_at ?? null,
    app_access_mode: profile?.app_access_mode ?? 'active',
  });

  // Legacy `tier` field for old mac-app clients: trial users see pro, expired users see free.
  // New clients should read `state` instead.
  const tier: 'free' | 'pro' = state === 'expired' ? 'free' : 'pro';
  const limits = QUOTA_LIMITS[tier];

  // Get current month in YYYY-MM format
  const monthYear = new Date().toISOString().slice(0, 7);

  // Get current usage for all features
  const { data: usage } = await supabase
    .from('user_usage')
    .select('text_improve_words, priority_mic_seconds, auto_stack_sessions, portable_commands')
    .eq('user_id', user.id)
    .eq('month_year', monthYear)
    .single();

  // Build response with all usage data and limits
  return new Response(JSON.stringify({
    tier,
    state,
    app_access_mode: profile?.app_access_mode ?? 'active',
    trialEndsAt,
    nextTrialResetAt,
    monthYear,
    usage: {
      text_improve_words: usage?.text_improve_words || 0,
      priority_mic_seconds: usage?.priority_mic_seconds || 0,
      auto_stack_sessions: usage?.auto_stack_sessions || 0,
      portable_commands: usage?.portable_commands || 0,
    },
    limits: {
      text_improve_words: limits.text_improve_words,
      priority_mic_seconds: limits.priority_mic_seconds,
      auto_stack_sessions: limits.auto_stack_sessions,
      portable_commands: limits.portable_commands,
    },
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
