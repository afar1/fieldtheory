import { supabase } from './supabase';
import { StorageService } from './storage';
import { getSession } from './auth';
import { sha256Hex } from './libraryHash';
import {
  filterLibraryDocumentsDeletedRemotely,
  mergeLibraryDocumentsByIdentity,
  normalizeLibrarySourcePath,
  parseLibrarySourcePath,
  sourcePathForLibraryDocument as sourcePathForLibraryDocumentFromSync,
} from './librarySync';
import {
  LibraryDocument,
  Observation,
  SyncTombstone,
  SyncTombstoneCollection,
  Todo,
  TranscriptEntry,
  TranscriptSegment,
} from '../types';
import {
  filterPendingDeletesByCollection,
  filterRecordsDeletedRemotely,
  mergeByLastWriteWins,
  timestampFromIso,
} from './syncUtils';

// Remote table column adapters -------------------------------------------------
type TodoRow = {
  id: string;
  user_id: string;
  text: string;
  completed: boolean;
  client_id: string;
  client_created_at_ms: number;
  client_updated_at_ms: number | null;
  deleted_at: string | null;
  updated_at: string;
};

type ObservationRow = {
  id: string;
  user_id: string;
  text: string;
  client_id: string;
  client_created_at_ms: number;
  client_updated_at_ms: number | null;
  deleted_at: string | null;
  updated_at: string;
};

type TranscriptRow = {
  id: string;
  user_id: string;
  text: string;
  client_id: string;
  client_created_at_ms: number;
  client_updated_at_ms: number | null;
  deleted_at: string | null;
  updated_at: string;
  metadata: {
    stackSegments?: TranscriptSegment[];
  } | null;
};

type LibraryDocumentRow = {
  id: string;
  user_id: string;
  title: string;
  content: string;
  tags: string[];
  source_path: string | null;
  source_kind: 'mobile' | 'laptop';
  content_hash: string | null;
  client_id: string;
  client_created_at_ms: number;
  deleted_at: string | null;
  updated_at: string;
};

type RowSyncTable = 'todos' | 'observations' | 'transcripts';

type RemoteClockRow = {
  client_id: string;
  client_updated_at_ms: number | null;
  deleted_at: string | null;
  updated_at: string;
};

type ActiveRowPayload = {
  client_id: string;
  client_updated_at_ms: number;
  deleted_at: null;
  [key: string]: unknown;
};

const rowEditTimestamp = (row: { client_updated_at_ms?: number | null; updated_at: string }) =>
  row.client_updated_at_ms ?? timestampFromIso(row.updated_at);

const remoteClockTimestamp = (row: RemoteClockRow) =>
  Math.max(rowEditTimestamp(row), timestampFromIso(row.deleted_at));

const toLocalTodo = (row: TodoRow): Todo => ({
  id: row.client_id,
  text: row.text,
  completed: row.completed,
  createdAt: row.client_created_at_ms,
  updatedAt: rowEditTimestamp(row),
});

const toLocalObservation = (row: ObservationRow): Observation => ({
  id: row.client_id,
  text: row.text,
  createdAt: row.client_created_at_ms,
  updatedAt: rowEditTimestamp(row),
});

const toLocalTranscript = (row: TranscriptRow): TranscriptEntry => ({
  id: row.client_id,
  text: row.text,
  createdAt: row.client_created_at_ms,
  updatedAt: rowEditTimestamp(row),
  stackSegments: row.metadata?.stackSegments,
});

export const sourcePathForLibraryDocument = sourcePathForLibraryDocumentFromSync;

const toLocalLibraryDocument = (row: LibraryDocumentRow): LibraryDocument => {
  const pathParts = parseLibrarySourcePath(row.source_path, row.title);
  return {
    id: row.client_id,
    title: row.title,
    content: row.content,
    tags: row.tags ?? [],
    folderPath: pathParts.folderPath,
    fileName: pathParts.fileName,
    sourceKind: row.source_kind,
    isPinned: false,
    createdAt: row.client_created_at_ms,
    updatedAt: new Date(row.updated_at).getTime(),
  };
};

const now = () => Date.now();

const requireSession = async () => {
  const session = await getSession();
  if (!session) {
    throw new Error('Please sign in to sync with Supabase.');
  }
  return session;
};

const upsertRows = async (table: string, rows: object[]) => {
  if (rows.length === 0) {
    return;
  }

  const { error } = await supabase
    .from(table)
    .upsert(rows, { onConflict: 'user_id,client_id' });

  if (error) {
    throw error;
  }
};

const filterActiveRowsNewerThanRemote = async <T extends ActiveRowPayload>(
  table: RowSyncTable,
  userId: string,
  rows: T[],
) => {
  if (rows.length === 0) return rows;

  const { data, error } = await supabase
    .from(table)
    .select('client_id, client_updated_at_ms, deleted_at, updated_at')
    .eq('user_id', userId)
    .in('client_id', rows.map((row) => row.client_id));

  if (error) throw error;

  const remoteRows = new Map(
    ((data ?? []) as RemoteClockRow[]).map((row) => [row.client_id, row]),
  );

  return rows.filter((row) => {
    const remoteRow = remoteRows.get(row.client_id);
    if (!remoteRow) return true;

    const remoteDeletedAt = timestampFromIso(remoteRow.deleted_at);
    if (remoteDeletedAt >= row.client_updated_at_ms) return false;

    return row.client_updated_at_ms >= remoteClockTimestamp(remoteRow);
  });
};

const upsertActiveRows = async <T extends ActiveRowPayload>(
  table: RowSyncTable,
  userId: string,
  rows: T[],
) => {
  const freshRows = await filterActiveRowsNewerThanRemote(table, userId, rows);
  await upsertRows(table, freshRows);
};

const tableForSyncTombstoneCollection: Record<SyncTombstoneCollection, RowSyncTable> = {
  todos: 'todos',
  observations: 'observations',
  transcripts: 'transcripts',
};

const filterPendingRowDeletes = (
  todos: Todo[],
  observations: Observation[],
  transcripts: TranscriptEntry[],
  tombstones: SyncTombstone[],
) => {
  return {
    todos: filterPendingDeletesByCollection(todos, tombstones, 'todos'),
    observations: filterPendingDeletesByCollection(observations, tombstones, 'observations'),
    transcripts: filterPendingDeletesByCollection(transcripts, tombstones, 'transcripts'),
  };
};

const syncRowTombstonesUpForUser = async (userId: string, pendingTombstones?: SyncTombstone[]) => {
  const tombstones = pendingTombstones ?? await StorageService.getSyncTombstones();
  if (tombstones.length === 0) return;

  for (const collection of Object.keys(tableForSyncTombstoneCollection) as SyncTombstoneCollection[]) {
    const table = tableForSyncTombstoneCollection[collection];
    const collectionTombstones = tombstones.filter((tombstone) => tombstone.collection === collection);

    for (const tombstone of collectionTombstones) {
      const { error } = await supabase
        .from(table)
        .update({
          client_updated_at_ms: tombstone.deletedAt,
          deleted_at: new Date(tombstone.deletedAt).toISOString(),
        })
        .eq('user_id', userId)
        .eq('client_id', tombstone.id)
        .or(`client_updated_at_ms.is.null,client_updated_at_ms.lte.${tombstone.deletedAt}`);

      if (error) {
        throw error;
      }
    }
  }

  await StorageService.saveSyncTombstones([]);
};

const syncLibraryTombstonesUpForUser = async (userId: string) => {
  const tombstones = await StorageService.getLibraryTombstones();
  if (tombstones.length === 0) return;

  await upsertRows('library_documents', tombstones.map((tombstone) => ({
    user_id: userId,
    title: '',
    content: '',
    tags: [],
    source_path: tombstone.sourcePath,
    source_kind: 'mobile',
    content_hash: '',
    client_id: tombstone.id,
    client_created_at_ms: tombstone.createdAt,
    deleted_at: new Date(tombstone.deletedAt).toISOString(),
  })));
  await StorageService.saveLibraryTombstones([]);
};

const syncLibraryUpForUser = async (userId: string) => {
  const libraryDocuments = await StorageService.getLibraryDocuments();
  const rows = await Promise.all(libraryDocuments.map(async (doc) => ({
    user_id: userId,
    title: doc.title,
    content: doc.content,
    tags: doc.tags ?? [],
    source_path: sourcePathForLibraryDocument(doc),
    source_kind: doc.sourceKind ?? 'mobile',
    content_hash: await sha256Hex(doc.content),
    client_id: doc.id,
    client_created_at_ms: doc.createdAt,
    deleted_at: null,
  })));
  await upsertRows('library_documents', rows);
};

const syncLibraryDownOnly = async () => {
  const localLibraryDocuments = await StorageService.getLibraryDocuments();
  const { data, error } = await supabase
    .from('library_documents')
    .select('*')
    .order('updated_at', { ascending: false });

  if (error) throw error;

  const remoteRows = (data ?? []) as LibraryDocumentRow[];
  const activeRows = remoteRows.filter((row) => !row.deleted_at);
  const deletedRows = remoteRows.filter((row) => row.deleted_at);
  let mergedLibraryDocuments = mergeLibraryDocumentsByIdentity(localLibraryDocuments, activeRows.map(toLocalLibraryDocument));

  mergedLibraryDocuments = filterLibraryDocumentsDeletedRemotely(
    mergedLibraryDocuments,
    deletedRows
      .map((row) => ({
        id: row.client_id,
        sourcePath: normalizeLibrarySourcePath(row.source_path, row.title),
        deletedAt: row.deleted_at ? new Date(row.deleted_at).getTime() : 0,
      }))
      .filter((row) => Number.isFinite(row.deletedAt)),
  );

  await StorageService.saveLibraryDocuments(mergedLibraryDocuments);
  return mergedLibraryDocuments;
};

const syncLibraryRemoteFirstForUser = async (userId: string) => {
  await syncLibraryTombstonesUpForUser(userId);
  const mergedLibraryDocuments = await syncLibraryDownOnly();
  await syncLibraryUpForUser(userId);
  return mergedLibraryDocuments;
};

export async function syncUp() {
  const session = await requireSession();
  const userId = session.user.id;
  const [storedTodos, storedObservations, storedTranscripts, tombstones] = await Promise.all([
    StorageService.getTodos(),
    StorageService.getObservations(),
    StorageService.getTranscripts(),
    StorageService.getSyncTombstones(),
  ]);
  const { todos, observations, transcripts } = filterPendingRowDeletes(
    storedTodos,
    storedObservations,
    storedTranscripts,
    tombstones,
  );

  await syncRowTombstonesUpForUser(userId, tombstones);

  await Promise.all([
    upsertActiveRows('todos', userId, todos.map((todo) => ({
      user_id: userId,
      text: todo.text,
      completed: todo.completed,
      client_id: todo.id,
      client_created_at_ms: todo.createdAt,
      client_updated_at_ms: todo.updatedAt ?? todo.createdAt,
      deleted_at: null,
    }))),
    upsertActiveRows('observations', userId, observations.map((observation) => ({
      user_id: userId,
      text: observation.text,
      client_id: observation.id,
      client_created_at_ms: observation.createdAt,
      client_updated_at_ms: observation.updatedAt ?? observation.createdAt,
      deleted_at: null,
    }))),
    upsertActiveRows('transcripts', userId, transcripts.map((transcript) => ({
      user_id: userId,
      text: transcript.text,
      client_id: transcript.id,
      client_created_at_ms: transcript.createdAt,
      client_updated_at_ms: transcript.updatedAt ?? transcript.createdAt,
      deleted_at: null,
      metadata: transcript.stackSegments ? { stackSegments: transcript.stackSegments } : {},
    }))),
    syncLibraryRemoteFirstForUser(userId),
  ]);
}

export async function syncDown(pendingTombstones: SyncTombstone[] = []) {
  const session = await requireSession();
  const [storedTodos, storedObservations, storedTranscripts] = await Promise.all([
    StorageService.getTodos(),
    StorageService.getObservations(),
    StorageService.getTranscripts(),
  ]);
  const {
    todos: localTodos,
    observations: localObservations,
    transcripts: localTranscripts,
  } = filterPendingRowDeletes(storedTodos, storedObservations, storedTranscripts, pendingTombstones);

  const [
    { data: todosData, error: todosError },
    { data: obsData, error: obsError },
    { data: transcriptsData, error: transcriptsError },
    mergedLibraryDocuments,
  ] =
    await Promise.all([
      supabase.from('todos').select('*').order('updated_at', { ascending: false }),
      supabase.from('observations').select('*').order('updated_at', { ascending: false }),
      supabase.from('transcripts').select('*').order('updated_at', { ascending: false }),
      syncLibraryDownOnly(),
    ]);

  if (todosError) throw todosError;
  if (obsError) throw obsError;
  if (transcriptsError) throw transcriptsError;

  const activeTodoRows = ((todosData ?? []) as TodoRow[]).filter((row) => !row.deleted_at);
  const activeObservationRows = ((obsData ?? []) as ObservationRow[]).filter((row) => !row.deleted_at);
  const activeTranscriptRows = ((transcriptsData ?? []) as TranscriptRow[]).filter((row) => !row.deleted_at);
  const deletedTodoRows = ((todosData ?? []) as TodoRow[]).filter((row) => row.deleted_at);
  const deletedObservationRows = ((obsData ?? []) as ObservationRow[]).filter((row) => row.deleted_at);
  const deletedTranscriptRows = ((transcriptsData ?? []) as TranscriptRow[]).filter((row) => row.deleted_at);

  let mergedTodos = mergeByLastWriteWins(localTodos, activeTodoRows.map(toLocalTodo));
  let mergedObservations = mergeByLastWriteWins(localObservations, activeObservationRows.map(toLocalObservation));
  let mergedTranscripts = mergeByLastWriteWins(localTranscripts, activeTranscriptRows.map(toLocalTranscript));

  mergedTodos = filterRecordsDeletedRemotely(mergedTodos, deletedTodoRows);
  mergedObservations = filterRecordsDeletedRemotely(mergedObservations, deletedObservationRows);
  mergedTranscripts = filterRecordsDeletedRemotely(mergedTranscripts, deletedTranscriptRows);

  await Promise.all([
    StorageService.saveTodos(mergedTodos),
    StorageService.saveObservations(mergedObservations),
    StorageService.saveTranscripts(mergedTranscripts),
  ]);

  return {
    todos: mergedTodos.length,
    observations: mergedObservations.length,
    transcripts: mergedTranscripts.length,
    libraryDocuments: mergedLibraryDocuments.length,
    syncedAt: now(),
  };
}

export async function syncAll() {
  const session = await requireSession();
  const userId = session.user.id;
  const rowTombstones = await StorageService.getSyncTombstones();

  await Promise.all([
    syncRowTombstonesUpForUser(userId, rowTombstones),
    syncLibraryTombstonesUpForUser(userId),
  ]);

  const result = await syncDown(rowTombstones);
  await syncUp();
  return result;
}

export async function syncLibraryDocuments() {
  const session = await requireSession();
  const mergedLibraryDocuments = await syncLibraryRemoteFirstForUser(session.user.id);
  return {
    libraryDocuments: mergedLibraryDocuments.length,
    syncedAt: now(),
  };
}

export async function seedRemoteFromLocal() {
  await syncUp();
}
