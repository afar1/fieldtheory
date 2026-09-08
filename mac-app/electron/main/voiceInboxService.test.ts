import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as saveGuard from './documentSaveGuard';
import { VoiceInboxService } from './voiceInboxService';
import type { VoiceInboxTranscript } from './voiceInboxTypes';

const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const thread = '33333333-3333-4333-8333-333333333333';
let root: string;
let library: string;
let store: VoiceInboxService;
const row = (overrides: Partial<VoiceInboxTranscript> = {}): VoiceInboxTranscript => ({
  userId: owner, transcriptId: 'phone-recording', text: 'Just context: the mountain route looked beautiful.',
  createdAtMs: Date.parse('2026-01-02T03:04:05Z'), updatedAtMs: 1000, ...overrides,
});
const options = () => ({ stateDirectory: path.join(root, 'state'), libraryRoot: library });

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'voice-inbox-service-')));
  library = path.join(root, 'Library');
  store = new VoiceInboxService(options());
});
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true }); });

describe('Voice Inbox Library records', () => {
  it('creates Inbox once for a new account and reuses the intended existing folder', () => {
    fs.mkdirSync(path.join(library, 'inbox'), { recursive: true });
    expect(store.ensureFolder(owner)).toBe(path.join(library, 'inbox'));
    expect(store.ensureFolder(owner)).toBe(path.join(library, 'inbox'));
    expect(fs.readdirSync(library)).toEqual(['inbox']);
    expect(new VoiceInboxService(options()).getFolder(owner)).toBe(path.join(library, 'inbox'));
  });

  it('preserves an existing legacy choice, but new choices must belong to Library', () => {
    const legacy = path.join(root, 'existing-project');
    fs.mkdirSync(legacy);
    expect(store.ensureFolder(owner, legacy)).toBe(legacy);
    expect(() => store.selectFolder(other, legacy)).toThrow(/Library/);
    const alternate = path.join(library, 'Recordings');
    fs.mkdirSync(alternate, { recursive: true });
    expect(store.selectFolder(owner, alternate)).toBe(alternate);
    expect(store.ensureFolder(owner, legacy)).toBe(alternate);
    expect(new VoiceInboxService(options()).ensureFolder(owner, legacy)).toBe(alternate);
  });

  it('supports an alternate registered Library root and rejects symlink escapes', () => {
    const alternate = path.join(root, 'Notes');
    const outside = path.join(root, 'Private');
    fs.mkdirSync(alternate); fs.mkdirSync(outside); fs.mkdirSync(library);
    const registered = new VoiceInboxService({ ...options(), getLibraryRoots: () => [alternate] });
    expect(registered.selectFolder(owner, alternate)).toBe(alternate);
    fs.symlinkSync(outside, path.join(library, 'Escape'));
    expect(() => registered.selectFolder(owner, path.join(library, 'Escape'))).toThrow(/Library/);
  });

  it('preserves a missing legacy choice across startup callbacks and restart until explicitly reselected', () => {
    const missing = path.join(root, 'old-project');
    expect(() => store.ensureFolder(owner, missing)).toThrow(/unavailable/);
    expect(() => store.ensureFolder(owner)).toThrow(/unavailable/);
    const restarted = new VoiceInboxService(options());
    expect(() => restarted.ensureFolder(owner)).toThrow(/unavailable/);
    expect(fs.existsSync(path.join(library, 'Inbox'))).toBe(false);
    const chosen = path.join(library, 'Phone'); fs.mkdirSync(chosen, { recursive: true });
    expect(restarted.selectFolder(owner, chosen)).toBe(chosen);
    expect(restarted.ensureFolder(owner)).toBe(chosen);
  });

  it('keeps folder renames and existing notes without creating a second Inbox', () => {
    const first = store.materialize(owner, [row()])[0];
    const renamed = path.join(library, 'Phone Notes');
    fs.renameSync(path.dirname(first.notePath!), renamed);
    expect(store.ensureFolder(owner)).toBe(renamed);
    const updated = store.materialize(owner, [row({ text: 'The corrected route.', updatedAtMs: 2000 })])[0];
    expect(updated.notePath).toBe(path.join(renamed, path.basename(first.notePath!)));
    expect(fs.readdirSync(library)).toEqual(['Phone Notes']);
    expect(fs.readFileSync(updated.notePath!, 'utf8')).toContain('The corrected route.');
  });

  it('materializes old and context transcripts without sent claims, generated answers, or execution', () => {
    const result = store.materialize(owner, [row()])[0];
    const content = fs.readFileSync(result.notePath!, 'utf8');
    expect(result.status).toBe('created');
    expect(content).toContain(row().text);
    expect(content).not.toContain('Sent to');
    expect(content).not.toContain('codex://');
    expect(content).not.toContain('status:');
    expect(path.dirname(result.notePath!)).toBe(path.join(library, 'Inbox'));
  });

  it('deduplicates by owner and transcript identity while updating newer core text in place', () => {
    const original = store.materialize(owner, [row()])[0];
    expect(store.materialize(owner, [row({ updatedAtMs: 1001 })])[0].status).toBe('unchanged');
    const changed = store.materialize(owner, [row({ text: 'A corrected transcript.', updatedAtMs: 2000 })])[0];
    expect(changed.notePath).toBe(original.notePath);
    expect(changed.status).toBe('updated');
    expect(store.materialize(owner, [row({ text: 'An older version.', updatedAtMs: 1000 })])[0].status).toBe('unchanged');
    expect(fs.readFileSync(original.notePath!, 'utf8')).toContain('A corrected transcript.');
    const second = store.materialize(owner, [row({ transcriptId: 'different-recording' })])[0];
    expect(second.notePath).not.toBe(original.notePath);
    const otherNote = store.materialize(other, [row({ userId: other })])[0];
    expect(otherNote.notePath).not.toBe(original.notePath);
    expect(() => store.materialize(owner, [row({ userId: other })])).toThrow(/another account/);
  });

  it('requires actual dispatch evidence, and adds only the conversation link after confirmation', () => {
    const note = store.materialize(owner, [row()])[0];
    expect(() => store.recordDispatch(owner, { transcriptId: row().transcriptId, threadId: thread })).toThrow(/confirmed/);
    expect(() => store.recordDispatch(owner, { transcriptId: row().transcriptId, threadId: 'https://evil', turnId: 'real-turn' })).toThrow(/actual/);
    const sent = store.recordDispatch(owner, { transcriptId: row().transcriptId, threadId: thread, turnId: 'real-turn' });
    expect(sent.status).toBe('updated');
    const content = fs.readFileSync(note.notePath!, 'utf8');
    expect(content).toContain(`Sent to [Codex conversation](codex://threads/${thread}).`);
    expect(content).not.toContain('real-turn');
    expect(content).toContain(row().text);
    expect(store.recordDispatch(owner, { transcriptId: row().transcriptId, threadId: thread, turnId: 'real-turn' }).status).toBe('unchanged');
  });

  it('keeps a confirmed receipt that arrives before its transcript snapshot', () => {
    expect(store.recordDispatch(owner, { transcriptId: row().transcriptId, threadId: thread, completed: true }).status).toBe('pending');
    expect(fs.existsSync(library)).toBe(false);
    const restarted = new VoiceInboxService(options());
    const note = restarted.materialize(owner, [row()])[0];
    expect(fs.readFileSync(note.notePath!, 'utf8')).toContain(`codex://threads/${thread}`);
  });

  it('preserves user edits and additions while adding the truthful sent receipt', () => {
    const note = store.materialize(owner, [row()])[0];
    let body = fs.readFileSync(note.notePath!, 'utf8');
    body = `My introduction.\n\n${body.replace(row().text, 'My hand-edited transcript.')}\nMy notes.\n`;
    fs.writeFileSync(note.notePath!, body);
    expect(store.materialize(owner, [row({ text: 'A later synced correction.', updatedAtMs: 2000 })])[0].status).toBe('preserved');
    store.recordDispatch(owner, { transcriptId: row().transcriptId, threadId: thread, turnId: 'real-turn' });
    const updated = fs.readFileSync(note.notePath!, 'utf8');
    expect(updated).toContain('My introduction.');
    expect(updated).toContain('My hand-edited transcript.');
    expect(updated).toContain('My notes.');
    expect(updated).not.toContain('A later synced correction.');
    expect(updated).toContain(`codex://threads/${thread}`);
  });

  it('does not overwrite a note changed between the read and guarded save', () => {
    const note = store.materialize(owner, [row()])[0];
    const original = saveGuard.writeTextFileWithConflictGuard;
    vi.spyOn(saveGuard, 'writeTextFileWithConflictGuard').mockImplementationOnce((file, content, version) => {
      fs.writeFileSync(file, 'A newer edit from the editor.');
      return original(file, content, version);
    });
    expect(store.recordDispatch(owner, { transcriptId: row().transcriptId, threadId: thread, turnId: 'real-turn' }).status).toBe('preserved');
    expect(fs.readFileSync(note.notePath!, 'utf8')).toBe('A newer edit from the editor.');
  });

  it('follows renamed notes and never recreates a note the user deleted', () => {
    const note = store.materialize(owner, [row()])[0];
    const renamed = path.join(path.dirname(note.notePath!), 'Mountain route.md');
    fs.renameSync(note.notePath!, renamed);
    expect(store.recordDispatch(owner, { transcriptId: row().transcriptId, threadId: thread, turnId: 'real-turn' }).notePath).toBe(renamed);
    fs.unlinkSync(renamed);
    expect(store.materialize(owner, [row({ text: 'New correction.', updatedAtMs: 2000 })])[0].status).toBe('preserved');
    expect(fs.readdirSync(path.dirname(renamed))).toEqual([]);
  });

  it('skips remote deletions and blank rows without deleting existing user notes', () => {
    const note = store.materialize(owner, [row()])[0];
    expect(store.materialize(owner, [row({ deletedAt: '2026-09-07T00:00:00Z' })])[0].status).toBe('skipped');
    expect(fs.existsSync(note.notePath!)).toBe(true);
    expect(store.materialize(owner, [row({ transcriptId: 'blank', text: ' ' })])[0].status).toBe('skipped');
    expect(fs.readdirSync(path.dirname(note.notePath!))).toHaveLength(1);
  });

  it('persists modified cursors independently per account and collection', () => {
    const cursor = { updatedAt: '2026-09-07T00:00:00.123456+00:00', id: thread };
    store.setCursor(owner, 'transcripts', cursor);
    const restarted = new VoiceInboxService(options());
    expect(restarted.getCursor(owner, 'transcripts')).toEqual(cursor);
    expect(restarted.getCursor(owner, 'jobs')).toBeNull();
    expect(restarted.getCursor(other, 'transcripts')).toBeNull();
  });
});
