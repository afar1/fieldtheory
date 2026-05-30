import assert from 'node:assert/strict';
import test from 'node:test';

import {
  filterLibraryDocumentsDeletedRemotely,
  mergeLibraryDocumentsByIdentity,
  normalizeLibrarySourcePath,
  parseLibrarySourcePath,
  sourcePathForLibraryDocument,
} from '../services/librarySync.ts';

const doc = (id, title, content, updatedAt = 1, patch = {}) => ({
  id,
  title,
  content,
  createdAt: updatedAt,
  updatedAt,
  ...patch,
});

test('normalizes Library source paths like the Mac app sync model', () => {
  assert.equal(normalizeLibrarySourcePath('entries\\Daily Note', 'Daily Note'), 'entries/Daily Note.md');
  assert.equal(normalizeLibrarySourcePath(null, 'Unsafe:Title'), 'scratchpad/Unsafe-Title.md');
  assert.equal(normalizeLibrarySourcePath('/absolute/path.md', 'Nope'), null);
  assert.equal(normalizeLibrarySourcePath('../escape.md', 'Nope'), null);
});

test('parses normalized Library source paths into mobile folder and file fields', () => {
  assert.deepEqual(parseLibrarySourcePath('entries/Daily Note', 'Daily Note'), {
    folderPath: 'entries',
    fileName: 'Daily Note.md',
  });
  assert.deepEqual(parseLibrarySourcePath(null, 'Daily Note'), {
    folderPath: 'scratchpad',
    fileName: 'Daily Note.md',
  });
});

test('derives stable source paths from mobile Library documents', () => {
  assert.equal(
    sourcePathForLibraryDocument(doc('a', 'Daily Note', '# Daily Note', 1, { folderPath: 'entries', fileName: 'Daily Note' })),
    'entries/Daily Note.md',
  );
});

test('merges Mac and iOS Library documents by source path as well as client id', () => {
  const local = doc('ios-random', 'Today', 'local edit', 500, {
    folderPath: 'scratchpad',
    fileName: 'today.md',
  });
  const remote = doc('library-mac-id', 'Today', 'older remote', 100, {
    folderPath: 'scratchpad',
    fileName: 'today.md',
    sourceKind: 'laptop',
  });

  assert.deepEqual(mergeLibraryDocumentsByIdentity([local], [remote]), [
    {
      ...local,
      id: 'library-mac-id',
      createdAt: 100,
    },
  ]);
});

test('keeps the newest remote Library version when source paths match', () => {
  const local = doc('ios-random', 'Today', 'local old', 100, {
    folderPath: 'scratchpad',
    fileName: 'today.md',
  });
  const remote = doc('library-mac-id', 'Today', 'remote new', 500, {
    folderPath: 'scratchpad',
    fileName: 'today.md',
    sourceKind: 'laptop',
  });

  assert.deepEqual(mergeLibraryDocumentsByIdentity([local], [remote]), [remote]);
});

test('applies remote Library tombstones by source path when client ids differ', () => {
  const localNewer = doc('ios-newer', 'Today', 'new local edit', 500, {
    folderPath: 'scratchpad',
    fileName: 'today.md',
  });
  const localOlder = doc('ios-older', 'Plan', 'old local edit', 100, {
    folderPath: 'entries',
    fileName: 'plan.md',
  });

  assert.deepEqual(
    filterLibraryDocumentsDeletedRemotely([localNewer, localOlder], [
      { id: 'remote-today', sourcePath: 'scratchpad/today.md', deletedAt: 400 },
      { id: 'remote-plan', sourcePath: 'entries/plan.md', deletedAt: 400 },
    ]).map((item) => item.id),
    ['ios-newer'],
  );
});
