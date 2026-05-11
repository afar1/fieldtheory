import { LibraryDocument } from '../types';

export const sortLibraryDocuments = (documents: LibraryDocument[]) =>
  [...documents].sort((a, b) => {
    const pinScore = Number(Boolean(b.isPinned)) - Number(Boolean(a.isPinned));
    if (pinScore !== 0) return pinScore;
    return b.updatedAt - a.updatedAt;
  });

export function mergeLibraryDocument(
  documents: LibraryDocument[],
  document: LibraryDocument,
): LibraryDocument[] {
  return sortLibraryDocuments([
    document,
    ...documents.filter((existing) => existing.id !== document.id),
  ]);
}

export function deleteLibraryDocument(
  documents: LibraryDocument[],
  documentId: string,
): LibraryDocument[] {
  return documents.filter((existing) => existing.id !== documentId);
}
