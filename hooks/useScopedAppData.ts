import { useCallback, useEffect, useRef, useState } from 'react';
import { InteractionManager } from 'react-native';
import type { Session } from '@supabase/supabase-js';

import { getSession } from '../services/auth';
import { CommandsService } from '../services/commands';
import { StorageService } from '../services/storage';
import { supabase } from '../services/supabase';
import {
  LibraryDocument,
  Observation,
  Settings,
  SyncTombstoneCollection,
  Todo,
  TranscriptEntry,
} from '../types';

const defaultSettings: Settings = {
  autoStart: false,
  showTodos: true,
  showLibrary: true,
  autoSeparate: false,
};

export function useScopedAppData() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const [libraryDocuments, setLibraryDocuments] = useState<LibraryDocument[]>([]);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isLibraryHydrated, setIsLibraryHydrated] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const [librarySyncedAt, setLibrarySyncedAt] = useState<number | null>(null);
  const [callsign, setCallsign] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const storageScopeUserIdRef = useRef<string | null>(null);
  const hasLoadedStorageRef = useRef(false);
  const libraryHydrationGenerationRef = useRef(0);
  const libraryHydrationTaskRef = useRef<{ cancel?: () => void } | null>(null);
  const isMountedRef = useRef(true);

  const queueSyncDeletes = useCallback((collection: SyncTombstoneCollection, ids: string[]): Promise<void> => {
    if (ids.length === 0) return Promise.resolve();
    const deletedAt = Date.now();
    return StorageService.addSyncTombstones(ids.map((id) => ({ collection, id, deletedAt })));
  }, []);

  const loadPrimaryStoredData = useCallback(async () => {
    const [
      loadedTodos,
      loadedObservations,
      loadedSettings,
      loadedTranscripts,
    ] = await Promise.all([
      StorageService.getTodos(),
      StorageService.getObservations(),
      StorageService.getSettings(),
      StorageService.getTranscripts(),
    ]);

    setTodos(loadedTodos);
    setObservations(loadedObservations);
    setSettings(loadedSettings);
    setTranscripts(loadedTranscripts);
  }, []);

  const loadLibraryDocuments = useCallback(async (generation: number) => {
    const loadedLibraryDocuments = await StorageService.getLibraryDocuments();
    if (!isMountedRef.current || libraryHydrationGenerationRef.current !== generation) return;

    setLibraryDocuments(loadedLibraryDocuments);
    setIsLibraryHydrated(true);
  }, []);

  const scheduleLibraryHydration = useCallback((generation: number) => {
    libraryHydrationTaskRef.current?.cancel?.();
    libraryHydrationTaskRef.current = InteractionManager.runAfterInteractions(() => {
      loadLibraryDocuments(generation).catch((err) => {
        console.error('Failed to hydrate library documents:', err);
        if (isMountedRef.current && libraryHydrationGenerationRef.current === generation) {
          setIsLibraryHydrated(true);
        }
      });
    });
  }, [loadLibraryDocuments]);

  const activateSession = useCallback(async (nextSession: Session | null) => {
    const nextUserId = nextSession?.user.id ?? null;
    const previousUserId = storageScopeUserIdRef.current;
    const shouldReloadStorage = storageScopeUserIdRef.current !== nextUserId || !hasLoadedStorageRef.current;

    if (!shouldReloadStorage) {
      setSession(nextSession);
      return;
    }

    libraryHydrationGenerationRef.current += 1;
    const hydrationGeneration = libraryHydrationGenerationRef.current;
    libraryHydrationTaskRef.current?.cancel?.();
    setIsLibraryHydrated(false);
    setLibraryDocuments([]);

    if (nextSession) {
      const userId = nextSession.user.id;
      await StorageService.migrateLegacyDataToUserScope(userId);
      StorageService.setUserScope(userId);
    } else {
      await StorageService.migrateLegacyDataToLocalScope();
      StorageService.setUserScope(null);
      setSyncedAt(null);
      setLibrarySyncedAt(null);
      setCallsign(null);
      CommandsService.clearCache(previousUserId ?? undefined).catch(console.error);
      setTodos([]);
      setObservations([]);
      setTranscripts([]);
    }

    storageScopeUserIdRef.current = nextUserId;
    setSession(nextSession);
    await loadPrimaryStoredData();
    scheduleLibraryHydration(hydrationGeneration);
    hasLoadedStorageRef.current = true;
  }, [loadPrimaryStoredData, scheduleLibraryHydration]);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      libraryHydrationTaskRef.current?.cancel?.();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function initializeData() {
      try {
        const currentSession = await getSession();
        if (cancelled) return;
        await activateSession(currentSession);
      } catch (err) {
        console.error('Failed to initialize storage:', err);
      } finally {
        if (!cancelled) setIsInitialized(true);
      }
    }

    initializeData();

    return () => {
      cancelled = true;
    };
  }, [activateSession]);

  useEffect(() => {
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, newSession) => {
      activateSession(newSession).catch((err) => console.error('Failed to apply auth session:', err));
    });

    return () => {
      subscription.subscription.unsubscribe();
    };
  }, [activateSession]);

  useEffect(() => {
    if (!session) return;

    const metadata = session.user.user_metadata as { callsign?: string } | undefined;
    setCallsign(metadata?.callsign ?? null);

    supabase
      .from('profiles')
      .select('callsign')
      .eq('id', session.user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) {
          console.error('Failed to fetch callsign:', error);
          return;
        }
        setCallsign(data?.callsign ?? metadata?.callsign ?? null);
      });
  }, [session]);

  return {
    todos,
    setTodos,
    observations,
    setObservations,
    settings,
    setSettings,
    transcripts,
    setTranscripts,
    libraryDocuments,
    setLibraryDocuments,
    isInitialized,
    isLibraryHydrated,
    session,
    syncedAt,
    setSyncedAt,
    librarySyncedAt,
    setLibrarySyncedAt,
    callsign,
    authNotice,
    setAuthNotice,
    syncNotice,
    setSyncNotice,
    queueSyncDeletes,
    activateSession,
  };
}
