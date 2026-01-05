// =============================================================================
// Delete Account Edge Function
// Permanently deletes a user's account and all associated data.
//
// Flow:
// 1. Verify JWT from Authorization header
// 2. Cancel Stripe subscription if active
// 3. Delete storage files (team-clipboard-images, sketch-images)
// 4. Delete auth user (cascades to all database tables)
//
// Security: Only the authenticated user can delete their own account.
// =============================================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14.14.0?target=deno';

// Stripe setup.
const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') || '', {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
});

// Supabase client with service role for admin operations.
const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

// CORS headers for browser requests (though we call from Electron main process).
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  // Handle CORS preflight.
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Only accept POST requests.
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  // Get JWT from Authorization header.
  const authHeader = req.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return new Response(
      JSON.stringify({ error: 'Missing or invalid authorization header' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const jwt = authHeader.replace('Bearer ', '');

  // Create Supabase client with the user's JWT to verify identity.
  const supabaseUser = createClient(supabaseUrl, supabaseServiceKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });

  // Verify the JWT and get the user.
  const { data: { user }, error: userError } = await supabaseUser.auth.getUser(jwt);
  if (userError || !user) {
    console.error('JWT verification failed:', userError);
    return new Response(
      JSON.stringify({ error: 'Invalid or expired token' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const userId = user.id;
  console.log(`[delete-account] Starting deletion for user: ${userId}`);

  // Create admin client for privileged operations.
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('stripe_subscription_id, stripe_customer_id')
      .eq('id', userId)
      .single();

    if (profile?.stripe_subscription_id) {
      try {
        await stripe.subscriptions.cancel(profile.stripe_subscription_id);
        console.log(`[delete-account] Cancelled Stripe subscription: ${profile.stripe_subscription_id}`);
      } catch (stripeErr) {
        // Log but don't fail - subscription might already be cancelled or invalid.
        console.warn('[delete-account] Stripe cancellation failed (non-fatal):', stripeErr);
      }
    }

    // Delete storage files.
    const storageBuckets = ['team-clipboard-images', 'sketch-images'];
    
    for (const bucket of storageBuckets) {
      try {
        // List all files in the user's folder.
        const { data: files } = await supabaseAdmin.storage
          .from(bucket)
          .list(userId);

        if (files && files.length > 0) {
          // Delete all files in the folder.
          const filePaths = files.map(f => `${userId}/${f.name}`);
          await supabaseAdmin.storage.from(bucket).remove(filePaths);
          console.log(`[delete-account] Deleted ${files.length} files from ${bucket}`);
        }
      } catch (storageErr) {
        // Log but don't fail - bucket might not exist or be empty.
        console.warn(`[delete-account] Storage cleanup for ${bucket} failed (non-fatal):`, storageErr);
      }
    }

    // Delete auth user (cascades to all tables).
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);

    if (deleteError) {
      console.error('[delete-account] Failed to delete auth user:', deleteError);
      return new Response(
        JSON.stringify({ error: 'Failed to delete account' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[delete-account] Successfully deleted user: ${userId}`);

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('[delete-account] Unexpected error:', err);
    return new Response(
      JSON.stringify({ error: 'An unexpected error occurred' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
