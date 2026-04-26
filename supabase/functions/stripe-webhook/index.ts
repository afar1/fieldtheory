// =============================================================================
// Stripe Webhook Edge Function
// Handles Stripe events for subscription management.
// 
// Events handled:
// - checkout.session.completed: User completed checkout, set tier to 'pro'
// - customer.subscription.deleted: Subscription cancelled, set tier to 'free'
//
// Security: Verifies Stripe webhook signature before processing.
// =============================================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14.14.0?target=deno';

// Stripe setup using Deno's environment variables.
const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') || '', {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
});

const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET') || '';

// Supabase client with service role for bypassing RLS.
const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

serve(async (req: Request) => {
  // Only accept POST requests.
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // Get the Stripe signature header.
  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    console.error('Missing Stripe signature');
    return new Response('Missing signature', { status: 400 });
  }

  // Get the raw body for signature verification.
  const body = await req.text();

  // Verify webhook signature.
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err);
    return new Response('Invalid signature', { status: 400 });
  }

  // Create Supabase client with service role.
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Handle the event.
  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        await handleCheckoutCompleted(supabase, session);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionDeleted(supabase, subscription);
        break;
      }

      default:
        // Log but don't fail for unhandled events.
        console.log(`Unhandled event type: ${event.type}`);
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Error processing webhook:', err);
    return new Response('Webhook processing failed', { status: 500 });
  }
});

/**
 * Handle successful checkout - upgrade user to pro tier.
 */
async function handleCheckoutCompleted(
  supabase: ReturnType<typeof createClient>,
  session: Stripe.Checkout.Session
) {
  // Get user ID from client_reference_id.
  // This is passed via query param when opening the payment link:
  // https://buy.stripe.com/xxx?client_reference_id=USER_ID
  const userId = session.client_reference_id;
  if (!userId) {
    console.error('No client_reference_id in checkout session');
    return;
  }

  const customerId = session.customer as string;
  const subscriptionId = session.subscription as string;

  // Update user's profile to pro tier.
  const { error } = await supabase
    .from('profiles')
    .update({
      tier: 'pro',                   // legacy field — kept for old mac-app clients
      is_paid_subscriber: true,      // new field — source of truth for paid status
      stripe_customer_id: customerId,
      stripe_subscription_id: subscriptionId,
    })
    .eq('id', userId);

  if (error) {
    console.error('Failed to update profile:', error);
    throw error;
  }

  console.log(`User ${userId} upgraded to pro tier`);
}

/**
 * Handle subscription cancellation - downgrade user to free tier.
 */
async function handleSubscriptionDeleted(
  supabase: ReturnType<typeof createClient>,
  subscription: Stripe.Subscription
) {
  const customerId = subscription.customer as string;

  // Find user by Stripe customer ID and downgrade. Reset the trial clock so they
  // re-enter the cycle from now (gives them another 14 days of full access).
  const { error } = await supabase
    .from('profiles')
    .update({
      tier: 'free',                  // legacy field
      is_paid_subscriber: false,
      trial_started_at: new Date().toISOString(),
    })
    .eq('stripe_customer_id', customerId);

  if (error) {
    console.error('Failed to downgrade profile:', error);
    throw error;
  }

  console.log(`Customer ${customerId} downgraded to free tier`);
}
