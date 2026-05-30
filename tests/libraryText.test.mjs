import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyRichBlockFormat,
  applyRichEditorInputChange,
  applyRichTitleInputChange,
  buildRichContent,
  buildLibrarySearchRows,
  applyRichInlineFormat,
  applyRichWikiLink,
  bodySelectionForMarkdownLine,
  buildLibraryFolderGroups,
  documentDraftFromWikiTarget,
  findDocumentForWikiDraft,
  findDocumentByWikiTitle,
  fileNameForLibraryTitle,
  formatMarkdownListMarker,
  getBacklinkDocuments,
  getLibrarySyncStatus,
  getRecentDocuments,
  getSwitcherDocuments,
  nextRecentIds,
  nextNavigationBackIds,
  parseMarkdownInlineSegments,
  parseMarkdownReaderBlocks,
  parseWikiLinkTarget,
  previewMarkdownReaderContent,
  reconcileLibraryViewState,
  resolveNavigationBackTarget,
  searchLibraryDocuments,
  shouldRetitleMobileFileName,
  splitRichContent,
  toggleMarkdownTaskAtLine,
  wikiTargetForDocument,
  wikiTargetForDocumentDraft,
  wikiLinksFromContent,
  wikiLinkTitlesFromContent,
} from '../services/libraryText.ts';

const doc = (id, title, content, updatedAt = 1, patch = {}) => ({
  id,
  title,
  content,
  createdAt: updatedAt,
  updatedAt,
  ...patch,
});

test('splits a markdown heading into rich title and body fields', () => {
  assert.deepEqual(
    splitRichContent(doc('a', 'Fallback', '# Field Theory\n\nCapture text')),
    { title: 'Field Theory', body: 'Capture text' },
  );
});

test('builds markdown from rich title and body without leading body noise', () => {
  assert.equal(buildRichContent(' Daily Note ', '\n\nFirst line'), '# Daily Note\n\nFirst line');
  assert.equal(buildRichContent('', 'Body'), '# Untitled\n\nBody');
});

test('moves pasted title overflow into the rich editor body', () => {
  assert.deepEqual(
    applyRichTitleInputChange('Daily Note\nFirst line\nSecond line', ''),
    {
      title: 'Daily Note',
      body: 'First line\nSecond line',
      bodySelection: { start: 'First line\nSecond line'.length, end: 'First line\nSecond line'.length },
    },
  );
  assert.deepEqual(
    applyRichTitleInputChange('Daily Note\nNew opening', 'Existing body'),
    {
      title: 'Daily Note',
      body: 'New opening\nExisting body',
      bodySelection: { start: 'New opening'.length, end: 'New opening'.length },
    },
  );
});

test('continues rich editor list markers when return is pressed', () => {
  assert.deepEqual(
    applyRichEditorInputChange('- First', '- First\n'),
    { body: '- First\n- ', selection: { start: '- First\n- '.length, end: '- First\n- '.length } },
  );
  assert.deepEqual(
    applyRichEditorInputChange('- [x] Done', '- [x] Done\n'),
    { body: '- [x] Done\n- [ ] ', selection: { start: '- [x] Done\n- [ ] '.length, end: '- [x] Done\n- [ ] '.length } },
  );
  assert.deepEqual(
    applyRichEditorInputChange('3. Third', '3. Third\n'),
    { body: '3. Third\n4. ', selection: { start: '3. Third\n4. '.length, end: '3. Third\n4. '.length } },
  );
  assert.deepEqual(
    applyRichEditorInputChange('> Thought', '> Thought\n'),
    { body: '> Thought\n> ', selection: { start: '> Thought\n> '.length, end: '> Thought\n> '.length } },
  );
});

test('exits empty rich editor list markers when return is pressed', () => {
  assert.deepEqual(
    applyRichEditorInputChange('- ', '- \n'),
    { body: '\n', selection: { start: 1, end: 1 } },
  );
  assert.deepEqual(
    applyRichEditorInputChange('  - [ ] ', '  - [ ] \n'),
    { body: '  \n', selection: { start: 3, end: 3 } },
  );
});

test('retitles only mobile untitled markdown filenames', () => {
  assert.equal(fileNameForLibraryTitle('Daily Note!'), 'daily-note.md');
  assert.equal(
    shouldRetitleMobileFileName(doc('a', 'Untitled', '# Daily Note', 1, {
      sourceKind: 'mobile',
      fileName: 'untitled.md',
    }), 'Daily Note'),
    true,
  );
  assert.equal(
    shouldRetitleMobileFileName(doc('b', 'Daily Note', '# Renamed', 1, {
      sourceKind: 'mobile',
      fileName: 'daily-note.md',
    }), 'Renamed'),
    false,
  );
  assert.equal(
    shouldRetitleMobileFileName(doc('c', 'Untitled', '# Daily Note', 1, {
      sourceKind: 'laptop',
      fileName: 'untitled.md',
    }), 'Daily Note'),
    false,
  );
});

test('maps markdown source lines to rich editor body cursor offsets', () => {
  assert.deepEqual(
    bodySelectionForMarkdownLine('# Title\n\nFirst line\n## Heading\nBody', 4),
    { start: 'First line\n'.length, end: 'First line\n'.length },
  );
  assert.deepEqual(
    bodySelectionForMarkdownLine('# Title\nSecond line', 2),
    { start: 0, end: 0 },
  );
  assert.deepEqual(
    bodySelectionForMarkdownLine('First line\nSecond line', 2),
    { start: 'First line\n'.length, end: 'First line\n'.length },
  );
});

test('extracts wiki link titles and ignores empty links', () => {
  assert.deepEqual(wikiLinkTitlesFromContent('See [[River]] and [[ Daily Note ]] plus [[]].'), [
    'River',
    'Daily Note',
  ]);
});

test('parses labeled wiki links into stable targets and reader labels', () => {
  assert.deepEqual(parseWikiLinkTarget('entries/Field Theory.md|Field Theory'), {
    target: 'entries/Field Theory.md',
    label: 'Field Theory',
  });
  assert.deepEqual(parseWikiLinkTarget('entries/Field Theory.md'), {
    target: 'entries/Field Theory.md',
    label: 'Field Theory.md',
  });
  assert.deepEqual(wikiLinkTitlesFromContent('See [[entries/Field Theory.md|Field Theory]].'), [
    'entries/Field Theory.md',
  ]);
  assert.deepEqual(wikiLinksFromContent('See [[entries/Field Theory.md|Field Theory]].'), [
    { target: 'entries/Field Theory.md', label: 'Field Theory' },
  ]);
});

test('derives sensible new-note location from missing wiki path targets', () => {
  assert.deepEqual(documentDraftFromWikiTarget('entries/Field Theory.md', 'scratchpad'), {
    title: 'Field Theory',
    folderPath: 'entries',
    fileName: 'Field Theory.md',
  });
  assert.deepEqual(documentDraftFromWikiTarget('entries/Field Theory.md|Field Theory', 'scratchpad'), {
    title: 'Field Theory',
    folderPath: 'entries',
    fileName: 'Field Theory.md',
  });
  assert.deepEqual(documentDraftFromWikiTarget('Field Theory', 'scratchpad'), {
    title: 'Field Theory',
    folderPath: 'scratchpad',
    fileName: undefined,
  });
});

test('parses common inline markdown for reader rendering', () => {
  assert.deepEqual(parseMarkdownInlineSegments('Read **bold**, *quiet*, `code`, ~~old~~, [[River|the river]], and [site](https://example.com).'), [
    { type: 'text', text: 'Read ' },
    { type: 'strong', text: 'bold' },
    { type: 'text', text: ', ' },
    { type: 'emphasis', text: 'quiet' },
    { type: 'text', text: ', ' },
    { type: 'code', text: 'code' },
    { type: 'text', text: ', ' },
    { type: 'strike', text: 'old' },
    { type: 'text', text: ', ' },
    { type: 'wiki', text: 'the river', target: 'River' },
    { type: 'text', text: ', and ' },
    { type: 'url', text: 'site', url: 'https://example.com' },
    { type: 'text', text: '.' },
  ]);
});

test('parses bare web links without swallowing trailing punctuation', () => {
  assert.deepEqual(parseMarkdownInlineSegments('Open https://example.com/field.'), [
    { type: 'text', text: 'Open ' },
    { type: 'url', text: 'https://example.com/field', url: 'https://example.com/field' },
    { type: 'text', text: '.' },
  ]);
});

test('parses markdown angle autolinks without showing brackets', () => {
  assert.deepEqual(parseMarkdownInlineSegments('Open <https://example.com/field> now'), [
    { type: 'text', text: 'Open ' },
    { type: 'url', text: 'https://example.com/field', url: 'https://example.com/field' },
    { type: 'text', text: ' now' },
  ]);
});

test('precomputes markdown reader blocks with inline segments and list markers', () => {
  assert.deepEqual(parseMarkdownReaderBlocks('# [[Home]]\n\n- Task with **bold**\n1. Numbered step\n- [x] Checked task\n> Quote to [[River]]\nPlain `code`'), [
    {
      type: 'heading',
      key: 'line-0',
      lineNumber: 1,
      level: 1,
      segments: [{ type: 'wiki', text: 'Home', target: 'Home' }],
    },
    { type: 'blank', key: 'line-1', lineNumber: 2 },
    {
      type: 'list',
      key: 'line-2',
      lineNumber: 3,
      indent: 0,
      marker: '-',
      segments: [
        { type: 'text', text: 'Task with ' },
        { type: 'strong', text: 'bold' },
      ],
    },
    {
      type: 'list',
      key: 'line-3',
      lineNumber: 4,
      indent: 0,
      marker: '1.',
      segments: [{ type: 'text', text: 'Numbered step' }],
    },
    {
      type: 'list',
      key: 'line-4',
      lineNumber: 5,
      indent: 0,
      marker: '- [x]',
      segments: [{ type: 'text', text: 'Checked task' }],
    },
    {
      type: 'quote',
      key: 'line-5',
      lineNumber: 6,
      segments: [
        { type: 'text', text: 'Quote to ' },
        { type: 'wiki', text: 'River', target: 'River' },
      ],
    },
    {
      type: 'paragraph',
      key: 'line-6',
      lineNumber: 7,
      segments: [
        { type: 'text', text: 'Plain ' },
        { type: 'code', text: 'code' },
      ],
    },
  ]);
});

test('coalesces consecutive markdown paragraph lines for reader flow', () => {
  assert.deepEqual(parseMarkdownReaderBlocks('First wrapped\nparagraph with [[River]]\n## Next\nPlain after heading\nstill same paragraph'), [
    {
      type: 'paragraph',
      key: 'line-0',
      lineNumber: 1,
      segments: [
        { type: 'text', text: 'First wrapped paragraph with ' },
        { type: 'wiki', text: 'River', target: 'River' },
      ],
    },
    {
      type: 'heading',
      key: 'line-2',
      lineNumber: 3,
      level: 2,
      segments: [{ type: 'text', text: 'Next' }],
    },
    {
      type: 'paragraph',
      key: 'line-3',
      lineNumber: 4,
      segments: [{ type: 'text', text: 'Plain after heading still same paragraph' }],
    },
  ]);
});

test('precomputes all markdown heading levels for reader rendering', () => {
  assert.deepEqual(parseMarkdownReaderBlocks('#### Detail\n##### Fine point\n###### Small point'), [
    {
      type: 'heading',
      key: 'line-0',
      lineNumber: 1,
      level: 4,
      segments: [{ type: 'text', text: 'Detail' }],
    },
    {
      type: 'heading',
      key: 'line-1',
      lineNumber: 2,
      level: 5,
      segments: [{ type: 'text', text: 'Fine point' }],
    },
    {
      type: 'heading',
      key: 'line-2',
      lineNumber: 3,
      level: 6,
      segments: [{ type: 'text', text: 'Small point' }],
    },
  ]);
});

test('precomputes markdown horizontal rules for reader rendering', () => {
  assert.deepEqual(parseMarkdownReaderBlocks('Before\n---\nAfter\n* * *'), [
    {
      type: 'paragraph',
      key: 'line-0',
      lineNumber: 1,
      segments: [{ type: 'text', text: 'Before' }],
    },
    {
      type: 'rule',
      key: 'line-1',
      lineNumber: 2,
    },
    {
      type: 'paragraph',
      key: 'line-2',
      lineNumber: 3,
      segments: [{ type: 'text', text: 'After' }],
    },
    {
      type: 'rule',
      key: 'line-3',
      lineNumber: 4,
    },
  ]);
});

test('precomputes standalone markdown images for reader rendering', () => {
  assert.deepEqual(parseMarkdownReaderBlocks('Before\n![Diagram](https://example.com/diagram.png)\nAfter'), [
    {
      type: 'paragraph',
      key: 'line-0',
      lineNumber: 1,
      segments: [{ type: 'text', text: 'Before' }],
    },
    {
      type: 'image',
      key: 'line-1',
      lineNumber: 2,
      alt: 'Diagram',
      url: 'https://example.com/diagram.png',
    },
    {
      type: 'paragraph',
      key: 'line-2',
      lineNumber: 3,
      segments: [{ type: 'text', text: 'After' }],
    },
  ]);
});

test('precomputes simple markdown tables for reader rendering', () => {
  assert.deepEqual(parseMarkdownReaderBlocks('Before\n| Term | Meaning |\n| --- | --- |\n| [[River]] | [Recent reading flow](https://example.com/river) |\n| Wiki | Linked note |\nAfter'), [
    {
      type: 'paragraph',
      key: 'line-0',
      lineNumber: 1,
      segments: [{ type: 'text', text: 'Before' }],
    },
    {
      type: 'table',
      key: 'line-1',
      lineNumber: 2,
      headers: ['Term', 'Meaning'],
      headerSegments: [
        [{ type: 'text', text: 'Term' }],
        [{ type: 'text', text: 'Meaning' }],
      ],
      rows: [
        ['[[River]]', '[Recent reading flow](https://example.com/river)'],
        ['Wiki', 'Linked note'],
      ],
      rowSegments: [
        [
          [{ type: 'wiki', text: 'River', target: 'River' }],
          [{ type: 'url', text: 'Recent reading flow', url: 'https://example.com/river' }],
        ],
        [
          [{ type: 'text', text: 'Wiki' }],
          [{ type: 'text', text: 'Linked note' }],
        ],
      ],
    },
    {
      type: 'paragraph',
      key: 'line-5',
      lineNumber: 6,
      segments: [{ type: 'text', text: 'After' }],
    },
  ]);
});

test('formats markdown list markers for reader display without losing task state', () => {
  assert.equal(formatMarkdownListMarker('-'), '•');
  assert.equal(formatMarkdownListMarker('*'), '•');
  assert.equal(formatMarkdownListMarker('12.'), '12.');
  assert.equal(formatMarkdownListMarker('- [ ]'), '[ ]');
  assert.equal(formatMarkdownListMarker('- [x]'), '[x]');
  assert.equal(formatMarkdownListMarker('- [X]'), '[x]');
});

test('preserves markdown list indentation for reader layout', () => {
  assert.deepEqual(parseMarkdownReaderBlocks('- Parent\n  - Child\n\t- [ ] Tabbed task'), [
    {
      type: 'list',
      key: 'line-0',
      lineNumber: 1,
      indent: 0,
      marker: '-',
      segments: [{ type: 'text', text: 'Parent' }],
    },
    {
      type: 'list',
      key: 'line-1',
      lineNumber: 2,
      indent: 2,
      marker: '-',
      segments: [{ type: 'text', text: 'Child' }],
    },
    {
      type: 'list',
      key: 'line-2',
      lineNumber: 3,
      indent: 4,
      marker: '- [ ]',
      segments: [{ type: 'text', text: 'Tabbed task' }],
    },
  ]);
});

test('toggles markdown task lines without touching normal list items', () => {
  assert.equal(
    toggleMarkdownTaskAtLine('Intro\n- [ ] Draft reader\nDone', 2),
    'Intro\n- [x] Draft reader\nDone',
  );
  assert.equal(
    toggleMarkdownTaskAtLine('Intro\n  - [X] Draft reader\nDone', 2),
    'Intro\n  - [ ] Draft reader\nDone',
  );
  assert.equal(toggleMarkdownTaskAtLine('Intro\n- Draft reader\nDone', 2), null);
  assert.equal(toggleMarkdownTaskAtLine('Intro', 3), null);
});

test('precomputes fenced code blocks as stable reader blocks', () => {
  assert.deepEqual(parseMarkdownReaderBlocks('Before\n```ts\nconst value = 1;\n```\nAfter'), [
    {
      type: 'paragraph',
      key: 'line-0',
      lineNumber: 1,
      segments: [{ type: 'text', text: 'Before' }],
    },
    {
      type: 'codeBlock',
      key: 'line-1',
      lineNumber: 2,
      language: 'ts',
      text: 'const value = 1;',
    },
    {
      type: 'paragraph',
      key: 'line-4',
      lineNumber: 5,
      segments: [{ type: 'text', text: 'After' }],
    },
  ]);

  assert.deepEqual(parseMarkdownReaderBlocks('```swift\nlet name = \"Field Theory\"'), [
    {
      type: 'codeBlock',
      key: 'line-0',
      lineNumber: 1,
      language: 'swift',
      text: 'let name = "Field Theory"',
    },
  ]);
});

test('builds bounded reader previews without scanning past the requested line window', () => {
  assert.equal(previewMarkdownReaderContent('one\ntwo\nthree', 2), 'one\ntwo');
  assert.equal(previewMarkdownReaderContent('one\ntwo', 2), 'one\ntwo');
  assert.equal(previewMarkdownReaderContent('one\ntwo', 0), '');
});

test('applies rich editor inline formats around selected text', () => {
  assert.deepEqual(
    applyRichInlineFormat('Make this link', { start: 10, end: 14 }, 'wiki'),
    { body: 'Make this [[link]]', selection: { start: 18, end: 18 } },
  );
  assert.deepEqual(
    applyRichInlineFormat('Make this loud', { start: 10, end: 14 }, 'strong'),
    { body: 'Make this **loud**', selection: { start: 18, end: 18 } },
  );
});

test('applies rich editor inline formats with selectable placeholders', () => {
  assert.deepEqual(
    applyRichInlineFormat('Start ', { start: 6, end: 6 }, 'wiki'),
    { body: 'Start [[Link]]', selection: { start: 8, end: 12 } },
  );
  assert.deepEqual(
    applyRichInlineFormat('Start ', { start: 6, end: 6 }, 'emphasis'),
    { body: 'Start *italic*', selection: { start: 7, end: 13 } },
  );
});

test('applies rich wiki links from picker selections without exposing syntax choices', () => {
  assert.deepEqual(
    applyRichWikiLink('Read this later', { start: 5, end: 9 }, 'entries/Field Theory', 'Field Theory'),
    {
      body: 'Read [[entries/Field Theory|this]] later',
      selection: { start: 34, end: 34 },
    },
  );

  assert.deepEqual(
    applyRichWikiLink('Read ', { start: 5, end: 5 }, 'Field Theory', 'Field Theory'),
    {
      body: 'Read [[Field Theory]]',
      selection: { start: 21, end: 21 },
    },
  );

  assert.deepEqual(
    applyRichWikiLink('Readlater', { start: 4, end: 4 }, 'Field Theory', 'Field Theory'),
    {
      body: 'Read [[Field Theory]] later',
      selection: { start: 22, end: 22 },
    },
  );
});

test('uses source paths as stable wiki targets for Library documents', () => {
  assert.equal(
    wikiTargetForDocument(doc('a', 'Field Theory', '# Field Theory', 1, {
      folderPath: 'entries',
      fileName: 'Field Theory.md',
    })),
    'entries/Field Theory',
  );
});

test('resolves typed wiki drafts to existing documents before creating duplicates', () => {
  const documents = [
    doc('a', 'Reader Flow', '# Reader Flow', 1, {
      folderPath: 'scratchpad',
      fileName: 'reader-flow.md',
    }),
    doc('b', 'Other', '# Other'),
  ];

  assert.equal(
    findDocumentForWikiDraft(documents, documentDraftFromWikiTarget('Reader Flow', 'scratchpad'))?.id,
    'a',
  );
  assert.equal(
    findDocumentForWikiDraft(documents, documentDraftFromWikiTarget('scratchpad/reader-flow', 'scratchpad'))?.id,
    'a',
  );
  assert.equal(
    wikiTargetForDocumentDraft(documentDraftFromWikiTarget('entries/New Idea.md', 'scratchpad')),
    'entries/New Idea',
  );
});

test('applies rich editor block formats to the active line', () => {
  assert.deepEqual(
    applyRichBlockFormat('Intro\nMake this a heading\nDone', { start: 8, end: 8 }, 'heading2'),
    {
      body: 'Intro\n## Make this a heading\nDone',
      selection: { start: 28, end: 28 },
    },
  );

  assert.deepEqual(
    applyRichBlockFormat('Intro\nWrite task\nDone', { start: 8, end: 8 }, 'task'),
    {
      body: 'Intro\n- [ ] Write task\nDone',
      selection: { start: 22, end: 22 },
    },
  );

  assert.deepEqual(
    applyRichBlockFormat('First\nSecond', { start: 0, end: 'First\nSecond'.length }, 'numbered'),
    {
      body: '1. First\n2. Second',
      selection: { start: '1. First\n2. Second'.length, end: '1. First\n2. Second'.length },
    },
  );
});

test('toggles rich editor block formats without stacking markdown markers', () => {
  assert.deepEqual(
    applyRichBlockFormat('## Heading', { start: 4, end: 4 }, 'heading2'),
    {
      body: 'Heading',
      selection: { start: 7, end: 7 },
    },
  );

  assert.deepEqual(
    applyRichBlockFormat('- [ ] Task', { start: 6, end: 6 }, 'bullet'),
    {
      body: '- Task',
      selection: { start: 6, end: 6 },
    },
  );

  assert.deepEqual(
    applyRichBlockFormat('2. Step', { start: 3, end: 3 }, 'numbered'),
    {
      body: 'Step',
      selection: { start: 4, end: 4 },
    },
  );
});

test('describes Library sync status without hiding local-first state', () => {
  assert.deepEqual(
    getLibrarySyncStatus({
      isSyncing: true,
      isSignedIn: true,
      unsyncedCount: 2,
      lastSyncedAt: 100,
    }),
    {
      tone: 'syncing',
      label: 'Syncing Library',
      detail: 'Reading and typing stay local while sync runs.',
    },
  );

  assert.deepEqual(
    getLibrarySyncStatus({
      isSyncing: true,
      isSignedIn: true,
      hasPendingDraft: true,
      unsyncedCount: 2,
      lastSyncedAt: 100,
    }),
    {
      tone: 'saving',
      label: 'Saving locally',
      detail: 'Your edit is being written on this device.',
    },
  );

  assert.deepEqual(
    getLibrarySyncStatus({
      isSignedIn: false,
      hasSavedDraft: true,
      unsyncedCount: 1,
    }),
    {
      tone: 'offline',
      label: 'Saved locally',
      detail: 'Sign in to sync this Library with your other devices.',
    },
  );

  assert.deepEqual(
    getLibrarySyncStatus({
      isSignedIn: false,
      unsyncedCount: 3,
    }),
    {
      tone: 'offline',
      label: '3 local changes on device',
      detail: 'Sign in to sync this Library with your other devices.',
    },
  );

  assert.deepEqual(
    getLibrarySyncStatus({
      isSignedIn: true,
      unsyncedCount: 0,
      lastSyncedAt: 1_000,
      now: 30_000,
    }),
    {
      tone: 'synced',
      label: 'Synced just now',
      detail: 'This device has the latest synced Library state.',
    },
  );
});

test('surfaces sync failures before normal saved states', () => {
  assert.deepEqual(
    getLibrarySyncStatus({
      isSignedIn: true,
      syncError: 'Network request failed',
      unsyncedCount: 1,
    }),
    {
      tone: 'error',
      label: 'Sync needs attention',
      detail: 'Network request failed',
    },
  );
});

test('shows last sync context when local changes are waiting to sync', () => {
  assert.deepEqual(
    getLibrarySyncStatus({
      isSignedIn: true,
      unsyncedCount: 2,
      lastSyncedAt: 1_000,
      now: 30_000,
    }),
    {
      tone: 'local',
      label: '2 local changes',
      detail: 'Last synced just now. Will sync in the background.',
    },
  );

  assert.deepEqual(
    getLibrarySyncStatus({
      isSignedIn: true,
      unsyncedCount: 2,
      lastSyncedAt: null,
    }),
    {
      tone: 'local',
      label: '2 local changes',
      detail: 'Not synced yet. Will sync in the background.',
    },
  );
});

test('reports synced after saved local draft has already caught up', () => {
  assert.deepEqual(
    getLibrarySyncStatus({
      isSignedIn: true,
      hasSavedDraft: true,
      unsyncedCount: 1,
      lastSyncedAt: 1_000,
      now: 30_000,
    }),
    {
      tone: 'local',
      label: 'Saved locally',
      detail: 'Last synced just now. Will sync in the background.',
    },
  );

  assert.deepEqual(
    getLibrarySyncStatus({
      isSignedIn: true,
      hasSavedDraft: true,
      unsyncedCount: 0,
      lastSyncedAt: 1_000,
      now: 30_000,
    }),
    {
      tone: 'synced',
      label: 'Synced just now',
      detail: 'This device has the latest synced Library state.',
    },
  );
});

test('matches wiki titles case-insensitively and accent-insensitively', () => {
  const documents = [
    doc('a', 'Cafe Notes', '# Cafe Notes'),
    doc('b', 'Other', '# Other'),
  ];

  assert.equal(findDocumentByWikiTitle(documents, 'CAFÉ NOTES')?.id, 'a');
  assert.equal(findDocumentByWikiTitle(documents, 'Missing'), null);
});

test('matches wiki targets against source paths and markdown filenames', () => {
  const documents = [
    doc('a', 'Raw transcript', '# Raw transcript', 1, {
      folderPath: '.meetings/meeting_123',
      fileName: 'transcript.md',
    }),
    doc('b', 'Scratch', '# Scratch', 1, {
      folderPath: 'scratchpad',
      fileName: 'scratch.md',
    }),
  ];

  assert.equal(findDocumentByWikiTitle(documents, '.meetings/meeting_123/transcript')?.id, 'a');
  assert.equal(findDocumentByWikiTitle(documents, '.meetings/meeting_123/transcript.md')?.id, 'a');
  assert.equal(findDocumentByWikiTitle(documents, 'scratch')?.id, 'b');
});

test('searches precomputed library rows with title priority before body matches', () => {
  const documents = [
    doc('body-newer', 'Scratch', 'mentions river only in body', 500),
    doc('title-older', 'River Flow', 'plain body', 100),
    doc('folder', 'Folder Match', 'plain body', 400, { folderPath: 'river-work' }),
  ];

  assert.deepEqual(
    searchLibraryDocuments(buildLibrarySearchRows(documents), 'river').map((item) => item.id),
    ['title-older', 'folder', 'body-newer'],
  );
});

test('searches library rows by markdown filename and source path before body text', () => {
  const documents = [
    doc('body', 'Body Match', 'mentions transcript in body', 500),
    doc('file', 'Raw notes', 'plain body', 100, {
      folderPath: '.meetings/meeting_123',
      fileName: 'transcript.md',
    }),
    doc('folder', 'Folder Match', 'plain body', 400, { folderPath: 'transcript-work' }),
  ];

  assert.deepEqual(
    searchLibraryDocuments(buildLibrarySearchRows(documents), 'transcript').map((item) => item.id),
    ['file', 'folder', 'body'],
  );
  assert.deepEqual(
    searchLibraryDocuments(buildLibrarySearchRows(documents), '.meetings/meeting_123/transcript').map((item) => item.id),
    ['file'],
  );
});

test('search returns the already-sorted documents when query is blank and respects limit', () => {
  const documents = [
    doc('a', 'A', '# A'),
    doc('b', 'B', '# B'),
    doc('c', 'C', '# C'),
  ];

  assert.deepEqual(searchLibraryDocuments(buildLibrarySearchRows(documents), ' ', 2).map((item) => item.id), ['a', 'b']);
});

test('switcher searches cheap title and folder fields while full-content index warms up', () => {
  const documents = [
    doc('a', 'River Flow', '# A'),
    doc('b', 'B', '# B mentions river'),
    doc('c', 'C', '# C', 1, { folderPath: 'river-work' }),
    doc('d', 'D', '# D', 1, { folderPath: '.meetings/river', fileName: 'transcript.md' }),
  ];
  const rows = buildLibrarySearchRows(documents);

  assert.deepEqual(
    getSwitcherDocuments({ documents, rows: [], query: '', indexReady: false, limit: 2 }).map((item) => item.id),
    ['a', 'b'],
  );
  assert.deepEqual(
    getSwitcherDocuments({ documents, rows: [], query: 'river', indexReady: false }).map((item) => item.id),
    ['a', 'd', 'c'],
  );
  assert.deepEqual(
    getSwitcherDocuments({ documents, rows, query: 'river', indexReady: true }).map((item) => item.id),
    ['a', 'd', 'c', 'b'],
  );
});

test('groups library folders in one pass with seeded folders and default folder first', () => {
  const documents = [
    doc('a', 'A', '# A', 1, { folderPath: 'entries' }),
    doc('b', 'B', '# B', 1, { folderPath: 'scratchpad' }),
    doc('c', 'C', '# C', 1, { folderPath: 'debates' }),
    doc('d', 'D', '# D', 1, { folderPath: 'entries' }),
  ];

  assert.deepEqual(
    buildLibraryFolderGroups(documents, ['scratchpad', 'artifacts', 'entries']).map(([folder, docs]) => [
      folder,
      docs.map((item) => item.id),
    ]),
    [
      ['scratchpad', ['b']],
      ['artifacts', []],
      ['debates', ['c']],
      ['entries', ['a', 'd']],
    ],
  );
});

test('finds backlink documents for the selected note', () => {
  const selected = doc('target', 'River', '# River');
  const documents = [
    doc('source-a', 'A', 'Go to [[river]].'),
    selected,
    doc('source-b', 'B', 'Also [[ River ]] here.'),
    doc('source-c', 'C', 'Not [[Rivers]].'),
  ];

  assert.deepEqual(getBacklinkDocuments(documents, selected).map((item) => item.id), ['source-a', 'source-b']);
});

test('finds backlinks that point to the selected note source path', () => {
  const selected = doc('target', 'Raw transcript', '# Raw transcript', 1, {
    folderPath: '.meetings/meeting_123',
    fileName: 'transcript.md',
  });
  const documents = [
    doc('source-a', 'A', 'Go to [[.meetings/meeting_123/transcript]].'),
    doc('source-b', 'B', 'Also [[.meetings/meeting_123/transcript.md|the transcript]].'),
    selected,
    doc('source-c', 'C', 'Not [[Raw transcripts]].'),
  ];

  assert.deepEqual(getBacklinkDocuments(documents, selected).map((item) => item.id), ['source-a', 'source-b']);
});

test('returns recent docs in visit order while omitting the selected note', () => {
  const documents = [
    doc('a', 'A', '# A'),
    doc('b', 'B', '# B'),
    doc('c', 'C', '# C'),
  ];

  assert.deepEqual(getRecentDocuments(documents, ['c', 'a', 'b'], 'a').map((item) => item.id), ['c', 'b']);
});

test('moves opened documents to the front of recent ids without duplicates', () => {
  assert.deepEqual(nextRecentIds(['a', 'b', 'c'], 'b'), ['b', 'a', 'c']);
  assert.deepEqual(nextRecentIds(['a', 'b', 'c'], 'd', 3), ['d', 'a', 'b']);
});

test('reconciles saved reader state against currently available documents', () => {
  const documents = [
    doc('a', 'A', '# A'),
    doc('b', 'B', '# B'),
    doc('c', 'C', '# C'),
  ];

  assert.deepEqual(
    reconcileLibraryViewState(documents, {
      selectedDocumentId: 'b',
      recentDocumentIds: ['missing', 'c', 'b', 'c'],
      readerScrollOffsets: { a: 120, missing: 400, c: -10 },
      updatedAt: 100,
    }),
    { selectedId: 'b', recentIds: ['b', 'c'], readerScrollOffsets: { a: 120 } },
  );
});

test('falls back to the first document when saved reader state points at a deleted note', () => {
  const documents = [
    doc('a', 'A', '# A'),
    doc('b', 'B', '# B'),
  ];

  assert.deepEqual(
    reconcileLibraryViewState(documents, {
      selectedDocumentId: 'deleted',
      recentDocumentIds: ['deleted', 'b'],
      readerScrollOffsets: { deleted: 200, b: 80 },
      updatedAt: 100,
    }),
    { selectedId: 'a', recentIds: ['a', 'b'], readerScrollOffsets: { b: 80 } },
  );
});

test('records navigation history when moving between different notes', () => {
  assert.deepEqual(nextNavigationBackIds([], 'a', 'b'), ['a']);
  assert.deepEqual(nextNavigationBackIds(['a', 'c'], 'b', 'a'), ['b', 'c']);
  assert.deepEqual(nextNavigationBackIds(['a'], 'a', 'a'), ['a']);
});

test('resolves the next navigation back target and drops missing notes', () => {
  const documents = [
    doc('a', 'A', '# A'),
    doc('b', 'B', '# B'),
  ];

  assert.deepEqual(resolveNavigationBackTarget(documents, ['missing', 'a', 'b']), {
    previousDoc: documents[0],
    remainingIds: ['b'],
  });

  assert.deepEqual(resolveNavigationBackTarget(documents, ['missing']), {
    previousDoc: null,
    remainingIds: [],
  });
});
