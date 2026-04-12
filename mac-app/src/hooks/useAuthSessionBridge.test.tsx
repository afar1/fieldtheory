import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { Session, SupabaseClient } from '@supabase/supabase-js';

import { useAuthSessionBridge } from './useAuthSessionBridge';

function makeSession(email: string): Session {
  return {
    access_token: `access-${email}`,
    refresh_token: `refresh-${email}`,
    expires_in: 3600,
    expires_at: 4102444800,
    token_type: 'bearer',
    user: {
      id: `user-${email}`,
      email,
      aud: 'authenticated',
      app_metadata: {},
      user_metadata: {},
      created_at: '2024-01-01T00:00:00.000Z',
    },
  } as Session;
}

function createSupabaseMock(initialSession: Session | null = null) {
  let authStateListener: ((event: string, session: Session | null) => void) | null = null;
  const unsubscribe = vi.fn();

  const supabase = {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: initialSession } }),
      onAuthStateChange: vi.fn((callback: (event: string, session: Session | null) => void) => {
        authStateListener = callback;
        return {
          data: {
            subscription: { unsubscribe },
          },
        };
      }),
    },
  } as unknown as SupabaseClient;

  return {
    supabase,
    emitRendererAuthState(event: string, session: Session | null) {
      authStateListener?.(event, session);
    },
    unsubscribe,
  };
}

describe('useAuthSessionBridge', () => {
  let emitMainProcessSession: ((session: Session | null) => void) | null;
  let authApiMock: {
    getSession: ReturnType<typeof vi.fn>;
    onSessionChanged: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    emitMainProcessSession = null;

    authApiMock = {
      getSession: vi.fn().mockResolvedValue(null),
      onSessionChanged: vi.fn((callback: (session: Session | null) => void) => {
        emitMainProcessSession = callback;
        return () => {
          emitMainProcessSession = null;
        };
      }),
    };

    window.authAPI = authApiMock as unknown as NonNullable<Window['authAPI']>;

    window.clipboardAPI = {
      setSyncSession: vi.fn(),
    } as unknown as NonNullable<Window['clipboardAPI']>;
  });

  it('prefers the main-process session over the renderer session', async () => {
    const mainProcessSession = makeSession('main@example.com');
    const rendererSession = makeSession('renderer@example.com');
    const { supabase } = createSupabaseMock(rendererSession);

    vi.mocked(authApiMock.getSession).mockResolvedValue(mainProcessSession);

    const { result } = renderHook(() =>
      useAuthSessionBridge({ supabase, syncRendererSessionToMain: true })
    );

    await waitFor(() => {
      expect(result.current.initialized).toBe(true);
    });

    expect(result.current.session?.user.email).toBe('main@example.com');
    expect(window.clipboardAPI?.setSyncSession).not.toHaveBeenCalled();
  });

  it('updates mounted renderers when the main process session changes', async () => {
    const { supabase } = createSupabaseMock();
    const nextSession = makeSession('live-update@example.com');

    const { result } = renderHook(() =>
      useAuthSessionBridge({ supabase, syncRendererSessionToMain: true })
    );

    await waitFor(() => {
      expect(result.current.initialized).toBe(true);
    });

    act(() => {
      emitMainProcessSession?.(nextSession);
    });

    await waitFor(() => {
      expect(result.current.session?.user.email).toBe('live-update@example.com');
    });
  });

  it('falls back to the renderer session and syncs it back to the main process', async () => {
    const rendererSession = makeSession('renderer-fallback@example.com');
    const { supabase } = createSupabaseMock(rendererSession);

    const { result } = renderHook(() =>
      useAuthSessionBridge({ supabase, syncRendererSessionToMain: true })
    );

    await waitFor(() => {
      expect(result.current.session?.user.email).toBe('renderer-fallback@example.com');
    });

    expect(window.clipboardAPI?.setSyncSession).toHaveBeenCalledWith(
      rendererSession.access_token,
      rendererSession.refresh_token
    );
  });

  it('calls the signed-out callback only for live sign-out events', async () => {
    const { supabase } = createSupabaseMock();
    const onSignedOut = vi.fn();

    renderHook(() =>
      useAuthSessionBridge({ supabase, syncRendererSessionToMain: true, onSignedOut })
    );

    await waitFor(() => {
      expect(authApiMock.onSessionChanged).toHaveBeenCalled();
    });

    expect(onSignedOut).not.toHaveBeenCalled();

    act(() => {
      emitMainProcessSession?.(null);
    });

    await waitFor(() => {
      expect(onSignedOut).toHaveBeenCalledTimes(1);
    });
  });

  it('still initializes when session restoration throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { supabase } = createSupabaseMock();
    authApiMock.getSession.mockRejectedValueOnce(new Error('boom'));

    const { result } = renderHook(() =>
      useAuthSessionBridge({ supabase, syncRendererSessionToMain: true })
    );

    await waitFor(() => {
      expect(result.current.initialized).toBe(true);
    });

    expect(result.current.session).toBeNull();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
