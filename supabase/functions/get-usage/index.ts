// =============================================================================
// Get Usage Edge Function
// Returns the user's current text improvement usage for the billing period.
// =============================================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Environment variables
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

// Quota limits by tier
const QUOTA_LIMITS = {
  free: 5000,   // 5,000 words/month for free users
  pro: 50000,   // 50,000 words/month for pro users
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
  const limit = QUOTA_LIMITS[tier];

  // Get current month in YYYY-MM format
  const monthYear = new Date().toISOString().slice(0, 7);

  // Get current usage
  const { data: usage } = await supabase
    .from('user_usage')
    .select('text_improve_words, quota_message_shown')
    .eq('user_id', user.id)
    .eq('month_year', monthYear)
    .single();

  return new Response(JSON.stringify({
    used: usage?.text_improve_words || 0,
    limit: limit,
    tier: tier,
    monthYear: monthYear,
    quotaMessageShown: usage?.quota_message_shown || false,
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
