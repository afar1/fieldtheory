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
  beforeLibrarySync?: () => Promise<void>;
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
  beforeLibrarySync,
}: UseSyncCoordinatorOptions) {
  const [isSyncingData, setIsSyncingData] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);
  const [isLibrarySyncing, setIsLibrarySyncing] = useState(false);
  const [librarySyncError, setLibrarySyncError] = useState<string | null>(null);
  const librarySyncInFlightRef = useRef(false);
  const librarySyncPendingRef = useRef(false);

  useEffect(() => {
    if (!session) {
      setLibrarySyncError(null);
    }
  }, [session]);

  const handleLibrarySyncQuiet = useCallback(async () => {
    if (!session) return;
    if (librarySyncInFlightRef.current) {
      librarySyncPendingRef.current = true;
      return;
    }

    librarySyncInFlightRef.current = true;
    setIsLibrarySyncing(true);
    try {
      do {
        librarySyncPendingRef.current = false;
        await beforeLibrarySync?.();
        const result = await syncLibraryDocuments();
        const nextLibraryDocuments = await StorageService.getLibraryDocuments();
        setLibraryDocuments(nextLibraryDocuments);
        setLibrarySyncedAt(result.syncedAt);
        setLibrarySyncError(null);
      } while (librarySyncPendingRef.current);
    } catch (error) {
      console.error('Library background sync failed:', error);
      setLibrarySyncError(error instanceof Error ? error.message : 'Unable to sync Library right now.');
    } finally {
      librarySyncPendingRef.current = false;
      librarySyncInFlightRef.current = false;
      setIsLibrarySyncing(false);
    }
  }, [beforeLibrarySync, session, setLibraryDocuments, setLibrarySyncedAt]);

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
      await beforeLibrarySync?.();
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
      setLibrarySyncError(null);
      setSyncNotice('Synced with Supabase.');
    } catch (err: unknown) {
      console.error('Sync failed:', err);
      const message = err instanceof Error
        ? err.message
        : (err as { message?: string })?.message || 'Unable to sync right now.';
      setLibrarySyncError(message);
      Alert.alert('Sync failed', message);
    } finally {
      setIsSyncingData(false);
    }
  }, [
    beforeLibrarySync,
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
      await beforeLibrarySync?.();
      await seedRemoteFromLocal();
      setLibrarySyncError(null);
      setSyncNotice('Seeded current device data to Supabase.');
    } catch (err: unknown) {
      console.error('Seed failed:', err);
      const message = err instanceof Error
        ? err.message
        : (err as { message?: string })?.message || 'Unable to seed right now.';
      setLibrarySyncError(message);
      Alert.alert('Seed failed', message);
    } finally {
      setIsSeeding(false);
    }
  }, [beforeLibrarySync, setSyncNotice]);

  return {
    isSyncingData,
    isSeeding,
    isLibrarySyncing,
    librarySyncError,
    handleLibrarySyncQuiet,
    handleSyncNow,
    handleSeedNow,
  };
}
