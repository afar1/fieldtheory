import { createClient, SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Instead of throwing, we create a nullable client. Components that use Supabase
// should check if supabase is null before using it. This prevents the app from
// crashing entirely if credentials are missing (e.g., in certain build scenarios).
let supabaseInstance: SupabaseClient | null = null;

if (url && anonKey) {
  // Configure Supabase client with full auth options to match iOS app behavior.
  // This ensures proper session handling and token persistence.
  supabaseInstance = createClient(url, anonKey, {
    auth: {
      storage: localStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });
} else {
  console.warn(
    'Supabase credentials not found. VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY is missing. ' +
    'Team clipboard and mobile sync features will be unavailable.'
  );
}

export const supabase = supabaseInstance;
