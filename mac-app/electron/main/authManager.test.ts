import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '@supabase/supabase-js';

import { AuthManager } from './authManager';

describe('AuthManager renderer session state', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('stays unauthenticated when Supabase public config is unavailable', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('FIELD_THEORY_SUPABASE_PUBLISHABLE_KEY', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');

    const manager = new AuthManager();

    await expect(manager.init()).resolves.toBeUndefined();
    expect(manager.getSessionState()).toBeNull();
    expect(manager.getSupabaseClient()).toBeNull();
  });

  it('omits access and refresh tokens from the public session state', () => {
    const manager = new AuthManager();
    const session = {
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      expires_in: 3600,
      expires_at: 4102444800,
      token_type: 'bearer',
      user: {
        id: 'user-1',
        email: 'river@example.com',
        aud: 'authenticated',
        created_at: '2024-01-01T00:00:00.000Z',
        user_metadata: { callsign: 'river', full_name: 'River User' },
        app_metadata: { provider: 'email' },
      },
    } as Session;

    (manager as unknown as { session: Session }).session = session;

    const state = manager.getSessionState();

    expect(state).toEqual({
      authenticated: true,
      expires_at: 4102444800,
      expiresAt: 4102444800,
      tier: 'free',
      callsign: 'river',
      displayName: 'River User',
      user: {
        id: 'user-1',
        email: 'river@example.com',
        user_metadata: { callsign: 'river', full_name: 'River User' },
        app_metadata: { provider: 'email' },
      },
    });
    expect(JSON.stringify(state)).not.toContain('access-token');
    expect(JSON.stringify(state)).not.toContain('refresh-token');
  });
});
