import { useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';

type MainProcessAuthSession = Awaited<ReturnType<NonNullable<Window['authAPI']>['getSession']>>;
type RendererAuthSession = Session | NonNullable<MainProcessAuthSession>;

interface UseAuthSessionBridgeOptions {
  supabase: SupabaseClient | null;
  onSignedOut?: () => void;
}

interface UseAuthSessionBridgeResult {
  session: RendererAuthSession | null;
  setSession: Dispatch<SetStateAction<RendererAuthSession | null>>;
  initialized: boolean;
}

export function useAuthSessionBridge({
  supabase,
  onSignedOut,
}: UseAuthSessionBridgeOptions): UseAuthSessionBridgeResult {
  const [session, setSession] = useState<RendererAuthSession | null>(null);
  const [initialized, setInitialized] = useState(false);
  const onSignedOutRef = useRef(onSignedOut);

  useEffect(() => {
    onSignedOutRef.current = onSignedOut;
  }, [onSignedOut]);

  useEffect(() => {
    let disposed = false;

    const handleSignedOut = (): void => {
      if (disposed) return;
      setSession(null);
      setInitialized(true);
      onSignedOutRef.current?.();
    };

    const initializeSession = async (): Promise<void> => {
      try {
        const mainProcessSession = await window.authAPI?.getSession?.() as RendererAuthSession | null | undefined;
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
        setSession(nextSession as RendererAuthSession);
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
  }, [supabase]);

  return { session, setSession, initialized };
}
