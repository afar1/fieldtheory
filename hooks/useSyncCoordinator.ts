import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, InteractionManager } from 'react-native';
import type { Session } from '@supabase/supabase-js';
import type { Dispatch, SetStateAction } from 'react';

import { StorageService } from '../services/storage';
import { seedRemoteFromLocal, syncAll, syncLibraryDocuments } from '../services/sync';
import { LibraryDocument, Observation, Todo, TranscriptEntry } from '../types';

type UseSyncCoordinatorOptions = {
  session: Session | null;
  setTodos: Dispatch<SetStateAction<Todo[]>>;
  setObservations: Dispatch<SetStateAction<Observation[]>>;
  setTranscripts: Dispatch<SetStateAction<TranscriptEntry[]>>;
  setLibraryDocuments: Dispatch<SetStateAction<LibraryDocument[]>>;
  setSyncedAt: Dispatch<SetStateAction<number | null>>;
  setLibrarySyncedAt: Dispatch<SetStateAction<number | null>>;
  setSyncNotice: Dispatch<SetStateAction<string | null>>;
};

export function useSyncCoordinator({
  session,
  setTodos,
  setObservations,
  setTranscripts,
  setLibraryDocuments,
  setSyncedAt,
  setLibrarySyncedAt,
  setSyncNotice,
}: UseSyncCoordinatorOptions) {
  const [isSyncingData, setIsSyncingData] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);
  const [isLibrarySyncing, setIsLibrarySyncing] = useState(false);
  const librarySyncInFlightRef = useRef(false);

  const handleLibrarySyncQuiet = useCallback(async () => {
    if (!session || librarySyncInFlightRef.current) return;

    librarySyncInFlightRef.current = true;
    setIsLibrarySyncing(true);
    try {
      const result = await syncLibraryDocuments();
      const nextLibraryDocuments = await StorageService.getLibraryDocuments();
      setLibraryDocuments(nextLibraryDocuments);
      setLibrarySyncedAt(result.syncedAt);
    } catch (error) {
      console.error('Library background sync failed:', error);
    } finally {
      librarySyncInFlightRef.current = false;
      setIsLibrarySyncing(false);
    }
  }, [session, setLibraryDocuments, setLibrarySyncedAt]);

  useEffect(() => {
    if (!session) return;

    let firstSyncTimer: ReturnType<typeof setTimeout> | null = null;
    const interactionTask = InteractionManager.runAfterInteractions(() => {
      firstSyncTimer = setTimeout(handleLibrarySyncQuiet, 1_000);
    });
    const interval = setInterval(handleLibrarySyncQuiet, 90_000);
    return () => {
      interactionTask.cancel?.();
      if (firstSyncTimer) {
        clearTimeout(firstSyncTimer);
      }
      clearInterval(interval);
    };
  }, [handleLibrarySyncQuiet, session]);

  const handleSyncNow = useCallback(async () => {
    setIsSyncingData(true);
    setSyncNotice(null);

    try {
      const result = await syncAll();
      const [nextTodos, nextObservations, nextTranscripts, nextLibraryDocuments] = await Promise.all([
        StorageService.getTodos(),
        StorageService.getObservations(),
        StorageService.getTranscripts(),
        StorageService.getLibraryDocuments(),
      ]);

      setTodos(nextTodos);
      setObservations(nextObservations);
      setTranscripts(nextTranscripts);
      setLibraryDocuments(nextLibraryDocuments);
      setSyncedAt(result.syncedAt);
      setLibrarySyncedAt(result.syncedAt);
      setSyncNotice('Synced with Supabase.');
    } catch (err: unknown) {
      console.error('Sync failed:', err);
      const message = err instanceof Error
        ? err.message
        : (err as { message?: string })?.message || 'Unable to sync right now.';
      Alert.alert('Sync failed', message);
    } finally {
      setIsSyncingData(false);
    }
  }, [
    setLibraryDocuments,
    setLibrarySyncedAt,
    setObservations,
    setSyncNotice,
    setSyncedAt,
    setTodos,
    setTranscripts,
  ]);

  const handleSeedNow = useCallback(async () => {
    setIsSeeding(true);
    setSyncNotice(null);

    try {
      await seedRemoteFromLocal();
      setSyncNotice('Seeded current device data to Supabase.');
    } catch (err: unknown) {
      console.error('Seed failed:', err);
      const message = err instanceof Error
        ? err.message
        : (err as { message?: string })?.message || 'Unable to seed right now.';
      Alert.alert('Seed failed', message);
    } finally {
      setIsSeeding(false);
    }
  }, [setSyncNotice]);

  return {
    isSyncingData,
    isSeeding,
    isLibrarySyncing,
    handleLibrarySyncQuiet,
    handleSyncNow,
    handleSeedNow,
  };
}
