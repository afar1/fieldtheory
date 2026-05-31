import type { LibraryDocument } from '../types';

const safeFileName = (value: string) =>
  (value.trim() || 'Untitled')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 120);

export const normalizeLibrarySourcePath = (sourcePath: string | null | undefined, title = 'Untitled') => {
  const fallback = `scratchpad/${safeFileName(title)}.md`;
  const rawPath = (sourcePath?.trim() || fallback).replace(/\\/g, '/');
  if (rawPath.startsWith('/')) return null;

  const parts = rawPath.split('/').filter(Boolean);
  if (parts.length === 0) return fallback;
  if (parts.some((part) => part === '.' || part === '..')) return null;

  const lastIndex = parts.length - 1;
  if (!parts[lastIndex].toLowerCase().endsWith('.md')) {
    parts[lastIndex] = `${parts[lastIndex]}.md`;
  }

  return parts.join('/');
};

export const parseLibrarySourcePath = (sourcePath: string | null | undefined, title = 'Untitled') => {
  const normalized = normalizeLibrarySourcePath(sourcePath, title) ?? `scratchpad/${safeFileName(title)}.md`;
  const parts = normalized.split('/').filter(Boolean);
  const fileName = parts.pop() ?? `${safeFileName(title)}.md`;
  return {
    folderPath: parts.join('/') || 'scratchpad',
    fileName,
  };
};

export const sourcePathForLibraryDocument = (doc: LibraryDocument) => {
  const folderPath = doc.folderPath?.trim() || 'scratchpad';
  const fileName = doc.fileName?.trim() || `${safeFileName(doc.title)}.md`;
  return normalizeLibrarySourcePath(`${folderPath}/${fileName}`, doc.title) ?? `scratchpad/${safeFileName(doc.title)}.md`;
};

const libraryDocumentTimestamp = (doc: LibraryDocument) => doc.updatedAt ?? doc.createdAt;

export const mergeLibraryDocumentsByIdentity = (
  localDocuments: LibraryDocument[],
  remoteDocuments: LibraryDocument[],
) => {
  const merged: LibraryDocument[] = [];

  const findIdentityIndex = (doc: LibraryDocument) => {
    const sourcePath = sourcePathForLibraryDocument(doc);
    return merged.findIndex((existing) =>
      existing.id === doc.id || sourcePathForLibraryDocument(existing) === sourcePath,
    );
  };

  localDocuments.forEach((doc) => {
    const index = findIdentityIndex(doc);
    if (index === -1 || libraryDocumentTimestamp(doc) >= libraryDocumentTimestamp(merged[index])) {
      if (index === -1) {
        merged.push(doc);
      } else {
        merged[index] = doc;
      }
    }
  });

  remoteDocuments.forEach((remoteDoc) => {
    const index = findIdentityIndex(remoteDoc);
    if (index === -1) {
      merged.push(remoteDoc);
      return;
    }

    const localDoc = merged[index];
    if (libraryDocumentTimestamp(remoteDoc) >= libraryDocumentTimestamp(localDoc)) {
      merged[index] = remoteDoc;
      return;
    }

    if (localDoc.id !== remoteDoc.id && sourcePathForLibraryDocument(localDoc) === sourcePathForLibraryDocument(remoteDoc)) {
      merged[index] = {
        ...localDoc,
        id: remoteDoc.id,
        createdAt: Math.min(localDoc.createdAt, remoteDoc.createdAt),
      };
    }
  });

  return merged.sort((a, b) => libraryDocumentTimestamp(b) - libraryDocumentTimestamp(a));
};

export type LibraryDeleteIdentity = {
  id: string;
  sourcePath: string | null;
  deletedAt: number;
};

export const filterLibraryDocumentsDeletedRemotely = (
  documents: LibraryDocument[],
  deletedRows: LibraryDeleteIdentity[],
) => {
  const deletedAtById = new Map<string, number>();
  const deletedAtBySourcePath = new Map<string, number>();

  deletedRows.forEach((row) => {
    deletedAtById.set(row.id, Math.max(deletedAtById.get(row.id) ?? -Infinity, row.deletedAt));
    if (row.sourcePath) {
      deletedAtBySourcePath.set(row.sourcePath, Math.max(deletedAtBySourcePath.get(row.sourcePath) ?? -Infinity, row.deletedAt));
    }
  });

  return documents.filter((doc) => {
    const docTimestamp = libraryDocumentTimestamp(doc);
    const deletedAt = Math.max(
      deletedAtById.get(doc.id) ?? -Infinity,
      deletedAtBySourcePath.get(sourcePathForLibraryDocument(doc)) ?? -Infinity,
    );
    return docTimestamp > deletedAt;
  });
};
