import { supabase } from './supabase';
import { StorageService } from './storage';
import { getSession } from './auth';
import { LibraryDocument, Observation, Todo, TranscriptEntry, TranscriptSegment } from '../types';
import { mergeByLastWriteWins } from './syncUtils';

// Remote table column adapters -------------------------------------------------
type TodoRow = {
  id: string;
  user_id: string;
  text: string;
  completed: boolean;
  client_id: string;
  client_created_at_ms: number;
  updated_at: string;
};

type ObservationRow = {
  id: string;
  user_id: string;
  text: string;
  client_id: string;
  client_created_at_ms: number;
  updated_at: string;
};

type TranscriptRow = {
  id: string;
  user_id: string;
  text: string;
  client_id: string;
  client_created_at_ms: number;
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
  client_id: string;
  client_created_at_ms: number;
  deleted_at: string | null;
  updated_at: string;
};

const toLocalTodo = (row: TodoRow): Todo => ({
  id: row.client_id,
  text: row.text,
  completed: row.completed,
  createdAt: row.client_created_at_ms,
  updatedAt: new Date(row.updated_at).getTime(),
});

const toLocalObservation = (row: ObservationRow): Observation => ({
  id: row.client_id,
  text: row.text,
  createdAt: row.client_created_at_ms,
  updatedAt: new Date(row.updated_at).getTime(),
});

const toLocalTranscript = (row: TranscriptRow): TranscriptEntry => ({
  id: row.client_id,
  text: row.text,
  createdAt: row.client_created_at_ms,
  updatedAt: new Date(row.updated_at).getTime(),
  stackSegments: row.metadata?.stackSegments,
});

const parseSourcePath = (sourcePath: string | null, title: string) => {
  const fallbackFileName = `${(title.trim() || 'Untitled').replace(/[/:]/g, '-')}.md`;
  if (!sourcePath) {
    return { folderPath: 'scratchpad', fileName: fallbackFileName };
  }

  const parts = sourcePath.split('/').filter(Boolean);
  const fileName = parts.pop() || fallbackFileName;
  return {
    folderPath: parts.join('/') || 'scratchpad',
    fileName,
  };
};

const sourcePathForLibraryDocument = (doc: LibraryDocument) => {
  const folderPath = doc.folderPath?.trim() || 'scratchpad';
  const fileName = doc.fileName?.trim() || `${(doc.title.trim() || 'Untitled').replace(/[/:]/g, '-')}.md`;
  return `${folderPath}/${fileName}`;
};

const toLocalLibraryDocument = (row: LibraryDocumentRow): LibraryDocument => {
  const pathParts = parseSourcePath(row.source_path, row.title);
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

const syncLibraryUpForUser = async (userId: string) => {
  const libraryDocuments = await StorageService.getLibraryDocuments();
  await upsertRows('library_documents', libraryDocuments.map((doc) => ({
    user_id: userId,
    title: doc.title,
    content: doc.content,
    tags: doc.tags ?? [],
    source_path: sourcePathForLibraryDocument(doc),
    source_kind: doc.sourceKind ?? 'mobile',
    client_id: doc.id,
    client_created_at_ms: doc.createdAt,
    deleted_at: null,
  })));
};

const syncLibraryDownOnly = async () => {
  const localLibraryDocuments = await StorageService.getLibraryDocuments();
  const { data, error } = await supabase
    .from('library_documents')
    .select('*')
    .is('deleted_at', null)
    .order('updated_at', { ascending: false });

  if (error) throw error;

  const mergedLibraryDocuments = mergeByLastWriteWins(localLibraryDocuments, (data ?? []).map(toLocalLibraryDocument));
  await StorageService.saveLibraryDocuments(mergedLibraryDocuments);
  return mergedLibraryDocuments;
};

const syncLibraryRemoteFirstForUser = async (userId: string) => {
  const mergedLibraryDocuments = await syncLibraryDownOnly();
  await syncLibraryUpForUser(userId);
  return mergedLibraryDocuments;
};

export async function syncUp() {
  const session = await requireSession();
  const userId = session.user.id;
  const [todos, observations, transcripts] = await Promise.all([
    StorageService.getTodos(),
    StorageService.getObservations(),
    StorageService.getTranscripts(),
  ]);

  await Promise.all([
    upsertRows('todos', todos.map((todo) => ({
      user_id: userId,
      text: todo.text,
      completed: todo.completed,
      client_id: todo.id,
      client_created_at_ms: todo.createdAt,
    }))),
    upsertRows('observations', observations.map((observation) => ({
      user_id: userId,
      text: observation.text,
      client_id: observation.id,
      client_created_at_ms: observation.createdAt,
    }))),
    upsertRows('transcripts', transcripts.map((transcript) => ({
      user_id: userId,
      text: transcript.text,
      client_id: transcript.id,
      client_created_at_ms: transcript.createdAt,
      metadata: transcript.stackSegments ? { stackSegments: transcript.stackSegments } : {},
    }))),
    syncLibraryRemoteFirstForUser(userId),
  ]);
}

export async function syncDown() {
  const session = await requireSession();
  const [localTodos, localObservations, localTranscripts] = await Promise.all([
    StorageService.getTodos(),
    StorageService.getObservations(),
    StorageService.getTranscripts(),
  ]);

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

  const mergedTodos = mergeByLastWriteWins(localTodos, (todosData ?? []).map(toLocalTodo));
  const mergedObservations = mergeByLastWriteWins(localObservations, (obsData ?? []).map(toLocalObservation));
  const mergedTranscripts = mergeByLastWriteWins(localTranscripts, (transcriptsData ?? []).map(toLocalTranscript));

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
  await syncUp();
  return syncDown();
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
