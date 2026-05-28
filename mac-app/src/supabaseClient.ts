import { createClient, SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const publishableKey = import.meta.env.FIELD_THEORY_SUPABASE_PUBLISHABLE_KEY
  ?? import.meta.env.VITE_SUPABASE_ANON_KEY;

// Instead of throwing, we create a nullable client. Components that use Supabase
// should check if supabase is null before using it. This prevents the app from
// crashing entirely if credentials are missing (e.g., in certain build scenarios).
let supabaseInstance: SupabaseClient | null = null;

if (url && publishableKey) {
  // IMPORTANT: Auth is managed by main process (AuthManager).
  // Renderer Supabase client is used ONLY for realtime subscriptions.
  // - persistSession: false - no localStorage auth caching (prevents race conditions)
  // - autoRefreshToken: false - main process handles token refresh
  // The main process sends session tokens via IPC when components need realtime auth.
  supabaseInstance = createClient(url, publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
} else {
  console.warn(
    'Supabase public config not found. VITE_SUPABASE_URL or FIELD_THEORY_SUPABASE_PUBLISHABLE_KEY is missing. ' +
    'Supabase-backed features will be unavailable.'
  );
}

export const supabase = supabaseInstance;
