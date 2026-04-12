import { useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';

interface UseAuthSessionBridgeOptions {
  supabase: SupabaseClient | null;
  syncRendererSessionToMain?: boolean;
  onSignedOut?: () => void;
}

interface UseAuthSessionBridgeResult {
  session: Session | null;
  setSession: Dispatch<SetStateAction<Session | null>>;
  initialized: boolean;
}

export function useAuthSessionBridge({
  supabase,
  syncRendererSessionToMain = false,
  onSignedOut,
}: UseAuthSessionBridgeOptions): UseAuthSessionBridgeResult {
  const [session, setSession] = useState<Session | null>(null);
  const [initialized, setInitialized] = useState(false);
  const onSignedOutRef = useRef(onSignedOut);

  useEffect(() => {
    onSignedOutRef.current = onSignedOut;
  }, [onSignedOut]);

  useEffect(() => {
    let disposed = false;

    const syncSessionToMain = (nextSession: Session | null): void => {
      if (!syncRendererSessionToMain || !nextSession) return;

      void window.clipboardAPI?.setSyncSession?.(
        nextSession.access_token,
        nextSession.refresh_token
      );
    };

    const handleSignedOut = (): void => {
      if (disposed) return;
      setSession(null);
      setInitialized(true);
      onSignedOutRef.current?.();
    };

    const initializeSession = async (): Promise<void> => {
      try {
        const mainProcessSession = await window.authAPI?.getSession?.() as Session | null | undefined;
        if (disposed) return;

        if (mainProcessSession) {
          setSession(mainProcessSession);
          return;
        }

        if (!supabase) {
          return;
        }

        const { data: { session: rendererSession } } = await supabase.auth.getSession();
        if (disposed) return;

        if (rendererSession) {
          setSession(rendererSession);
          syncSessionToMain(rendererSession);
        }
      } catch (error) {
        console.error('[useAuthSessionBridge] Failed to initialize auth session:', error);
      } finally {
        if (!disposed) {
          setInitialized(true);
        }
      }
    };

    void initializeSession();

    const unsubscribeMainProcess = window.authAPI?.onSessionChanged?.((nextSession) => {
      if (nextSession) {
        setSession(nextSession as Session);
        setInitialized(true);
        return;
      }

      handleSignedOut();
    }) ?? (() => {});

    const rendererSubscription = supabase?.auth.onAuthStateChange((event, nextSession) => {
      if (disposed) return;

      if (nextSession) {
        setSession(nextSession);
        setInitialized(true);
        syncSessionToMain(nextSession);
        return;
      }

      if (event === 'SIGNED_OUT') {
        handleSignedOut();
      }
    });

    return () => {
      disposed = true;
      unsubscribeMainProcess();
      rendererSubscription?.data.subscription.unsubscribe();
    };
  }, [supabase, syncRendererSessionToMain]);

  return { session, setSession, initialized };
}
