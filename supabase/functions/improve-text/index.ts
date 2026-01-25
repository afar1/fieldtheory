// =============================================================================
// Text Improvement Edge Function
// Proxies transcript improvement requests to Anthropic API with quota management.
//
// Security: API key stored as Supabase secret, not exposed to client.
// Quota: Server-side tracking prevents client-side bypass.
// =============================================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Environment variables (set via supabase secrets)
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') || '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

// Quota limits by tier
const QUOTA_LIMITS = {
  free: 5000,   // 5,000 words/month for free users
  pro: 50000,   // 50,000 words/month for pro users
};

// System prompt for transcript improvement (matches client-side prompt)
const SYSTEM_PROMPT = `Rewrite this spoken feedback as clear prose. Same meaning with less ambiguity. If a portion of the transcript's intent is not obvious, don't attempt to rephrase that portion just include the full sentence. Questions from a user are crtically important and should always be presented as questions. If the transcript contains a question mark, always maintain the same meaning but feel free to rephrase to be more clear and concise. If intent of question is not obvious, include the full original question. Replace vague references with specific names. Remove filler words. Keep it as one paragraph. Do not add structure, bullets, or headers.

IMPORTANT: Preserve any [Figure X] references and [cmd:name.md] references exactly as written. These reference images and commands that must remain in the output in their original positions relative to the surrounding text.`;

// CORS headers for Electron app
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Only accept POST requests
  if (req.method !== 'POST') {
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
    console.error('[improve-text] Auth error:', authError);
    return new Response(JSON.stringify({ error: 'Invalid token' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Parse request body
  let text: string;
  try {
    const body = await req.json();
    text = body.text;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return new Response(JSON.stringify({ error: 'Invalid text' }), {
      status: 400,
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

  // Check current usage
  const { data: usage } = await supabase
    .from('user_usage')
    .select('text_improve_words, quota_message_shown')
    .eq('user_id', user.id)
    .eq('month_year', monthYear)
    .single();

  const currentUsage = usage?.text_improve_words || 0;
  const wordCount = text.trim().split(/\s+/).length;

  // Check quota
  if (currentUsage + wordCount > limit) {
    const needsMessage = !usage?.quota_message_shown;

    // Mark that we've shown the quota message for this period
    if (needsMessage) {
      await supabase
        .from('user_usage')
        .upsert({
          user_id: user.id,
          month_year: monthYear,
          text_improve_words: currentUsage,
          quota_message_shown: true,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id,month_year' });
    }

    return new Response(JSON.stringify({
      error: 'quota_exceeded',
      used: currentUsage,
      limit: limit,
      showMessage: needsMessage,
    }), {
      status: 429,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Check API key is configured
  if (!ANTHROPIC_API_KEY) {
    console.error('[improve-text] ANTHROPIC_API_KEY not configured');
    return new Response(JSON.stringify({ error: 'Service not configured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Call Anthropic API
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8192,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: text.trim() }],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[improve-text] Anthropic error:', response.status, errorText);
      return new Response(JSON.stringify({ error: 'API error' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const result = await response.json();
    const improvedText = result.content?.[0]?.text || text;

    // Increment usage after successful improvement
    await supabase
      .from('user_usage')
      .upsert({
        user_id: user.id,
        month_year: monthYear,
        text_improve_words: currentUsage + wordCount,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,month_year' });

    return new Response(JSON.stringify({
      improvedText,
      inputTokens: result.usage?.input_tokens,
      outputTokens: result.usage?.output_tokens,
      wordCount,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[improve-text] Network error:', error);
    return new Response(JSON.stringify({ error: 'Network error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
