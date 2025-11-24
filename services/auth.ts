import { supabase } from './supabase';

// Wrap Supabase email OTP helpers so the UI can stay lightweight.
export async function requestOtp(email: string) {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
    },
  });

  if (error) {
    throw error;
  }
}

export async function verifyOtp(email: string, token: string) {
  const { error } = await supabase.auth.verifyOtp({
    email,
    token,
    type: 'email',
  });

  if (error) {
    throw error;
  }
}

export async function getSession() {
  const { data, error } = await supabase.auth.getSession();

  if (error) {
    throw error;
  }

  return data.session;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();

  if (error) {
    throw error;
  }
}
