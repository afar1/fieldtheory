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
    verbal_commands: 50,            // 50 commands/month
    portable_commands: 100,         // 100 commands/month
  },
  pro: {
    text_improve_words: 50000,      // 50k words/month (soft limit for analytics)
    priority_mic_seconds: Infinity,
    auto_stack_sessions: Infinity,
    verbal_commands: Infinity,
    portable_commands: Infinity,
  },
};

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

  // Get user's tier from profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('tier')
    .eq('id', user.id)
    .single();

  const tier = (profile?.tier as 'free' | 'pro') || 'free';
  const limits = QUOTA_LIMITS[tier];

  // Get current month in YYYY-MM format
  const monthYear = new Date().toISOString().slice(0, 7);

  // Get current usage for all features
  const { data: usage } = await supabase
    .from('user_usage')
    .select('text_improve_words, priority_mic_seconds, auto_stack_sessions, verbal_commands, portable_commands')
    .eq('user_id', user.id)
    .eq('month_year', monthYear)
    .single();

  // Build response with all usage data and limits
  return new Response(JSON.stringify({
    tier: tier,
    monthYear: monthYear,
    usage: {
      text_improve_words: usage?.text_improve_words || 0,
      priority_mic_seconds: usage?.priority_mic_seconds || 0,
      auto_stack_sessions: usage?.auto_stack_sessions || 0,
      verbal_commands: usage?.verbal_commands || 0,
      portable_commands: usage?.portable_commands || 0,
    },
    limits: {
      text_improve_words: limits.text_improve_words,
      priority_mic_seconds: limits.priority_mic_seconds,
      auto_stack_sessions: limits.auto_stack_sessions,
      verbal_commands: limits.verbal_commands,
      portable_commands: limits.portable_commands,
    },
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
