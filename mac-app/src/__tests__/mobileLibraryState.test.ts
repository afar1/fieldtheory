import { describe, expect, it } from 'vitest';

import {
  deleteLibraryDocument,
  mergeLibraryDocument,
  sortLibraryDocuments,
} from '../../../services/libraryState';
import type { LibraryDocument } from '../../../types';

const doc = (
  id: string,
  updatedAt: number,
  patch: Partial<LibraryDocument> = {},
): LibraryDocument => ({
  id,
  title: id,
  content: `# ${id}`,
  folderPath: 'scratchpad',
  fileName: `${id}.md`,
  sourceKind: 'mobile',
  tags: [],
  isPinned: false,
  createdAt: 1000,
  updatedAt,
  ...patch,
});

describe('mobile Library state helpers', () => {
  it('merges one changed document without dropping unrelated parent documents', () => {
    const existing = [
      doc('edited', 1000, { content: 'old' }),
      doc('synced-while-editing', 3000),
    ];

    const result = mergeLibraryDocument(existing, doc('edited', 4000, { content: 'new' }));

    expect(result.map((item) => item.id).sort()).toEqual(['edited', 'synced-while-editing']);
    expect(result.find((item) => item.id === 'edited')?.content).toBe('new');
    expect(result.find((item) => item.id === 'synced-while-editing')?.updatedAt).toBe(3000);
  });

  it('adds a new document and keeps pinned documents first', () => {
    const result = mergeLibraryDocument([
      doc('old-pinned', 1000, { isPinned: true }),
      doc('old', 2000),
    ], doc('new', 5000));

    expect(result.map((item) => item.id)).toEqual(['old-pinned', 'new', 'old']);
  });

  it('sorts by pin and then newest update time', () => {
    const result = sortLibraryDocuments([
      doc('middle', 2000),
      doc('newest', 3000),
      doc('pinned-old', 1000, { isPinned: true }),
    ]);

    expect(result.map((item) => item.id)).toEqual(['pinned-old', 'newest', 'middle']);
  });

  it('deletes only the target document', () => {
    const result = deleteLibraryDocument([
      doc('keep-a', 1000),
      doc('delete-me', 2000),
      doc('keep-b', 3000),
    ], 'delete-me');

    expect(result.map((item) => item.id)).toEqual(['keep-a', 'keep-b']);
  });
});
