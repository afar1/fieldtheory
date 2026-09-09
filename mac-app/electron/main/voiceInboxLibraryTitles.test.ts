// @vitest-environment node
import { expect, it } from 'vitest';
import { applyVoiceInboxTitles } from './voiceInboxLibraryTitles';
import type { LibraryRoot } from './librarianManager';
it('gives launcher/library roots the same Voice titles without mutating cached roots or unrelated notes', () => {
  const voice = { kind: 'file' as const, absPath: '/library/Inbox/Voice.md', relPath: 'Inbox/Voice.md', name: 'Voice', title: 'Voice', lastUpdated: 1 };
  const other = { ...voice, absPath: '/library/Other.md', title: 'My title' };
  const roots: LibraryRoot[] = [{ path: '/library', label: 'Library', builtin: true, tree: [{ kind: 'dir', name: 'Inbox', relPath: 'Inbox', children: [voice] }, other] }];
  const result = applyVoiceInboxTitles(roots, { folderPath: '/library/Inbox', truncated: false, notes: [{ notePath: voice.absPath, transcriptId: 'recording', createdAtMs: 1, title: 'Personal - Tea set', wordCount: 12 }] });
  expect(JSON.stringify(result)).toContain('Personal - Tea set');
  expect(JSON.stringify(roots)).not.toContain('Personal - Tea set');
  expect(result[0].tree[1]).toBe(other);
  const folder = result[0].tree[0];
  expect(folder.kind === 'dir' && folder.children[0]).toMatchObject({ absPath: voice.absPath, title: 'Personal - Tea set' });
  expect(applyVoiceInboxTitles(roots, null)).toBe(roots);
});
