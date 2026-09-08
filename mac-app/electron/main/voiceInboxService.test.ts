import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as saveGuard from './documentSaveGuard';
import { VoiceInboxService } from './voiceInboxService';
import type { VoiceInboxTranscript } from './voiceInboxTypes';
import { formatVoiceInboxTime, summarizeVoiceInboxTranscript } from '../shared/voiceInboxPresentation';

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
const sha = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

function legacyFixture(input: { editedText?: string; prefix?: string; suffix?: string; footer?: string; filename?: string } = {}) {
  const folder = store.ensureFolder(owner);
  const key = sha(JSON.stringify([owner, row().transcriptId]));
  const notePath = path.join(folder, input.filename ?? 'Voice 2026-01-02 03.04.05.md');
  const receipt = `\nSent to [Codex conversation](codex://threads/${thread}).\n`;
  const content = `${input.prefix ?? ''}<!-- field-theory-voice:${key} -->\n\n${input.editedText ?? row().text}\n\n<!-- field-theory-voice-sent:${key} -->${input.footer ?? receipt}<!-- /field-theory-voice-sent:${key} -->\n${input.suffix ?? ''}`;
  fs.writeFileSync(notePath, content);
  const stat = fs.statSync(notePath);
  const ledgerPath = path.join(root, 'state', `${sha(owner)}.json`);
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  ledger.entries[key] = { transcriptId: row().transcriptId, notePath, identity: { dev: stat.dev, ino: stat.ino },
    textHash: sha(`\n\n${row().text}\n\n`), receiptHash: sha(receipt), updatedAtMs: row().updatedAtMs,
    dispatch: { transcriptId: row().transcriptId, threadId: thread, turnId: 'confirmed-legacy-turn' } };
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger));
  store = new VoiceInboxService(options());
  return { notePath, ledgerPath, key, content, receipt };
}

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
    expect(sent.status).toBe('unchanged');
    const content = fs.readFileSync(note.notePath!, 'utf8');
    expect(content).toBe(row().text);
    expect(store.getPresentation(owner).notes[0].threadId).toBe(thread);
    expect(content).not.toContain('real-turn');
    expect(content).toContain(row().text);
    expect(store.recordDispatch(owner, { transcriptId: row().transcriptId, threadId: thread, turnId: 'real-turn' }).status).toBe('unchanged');
  });

  it('keeps a confirmed receipt that arrives before its transcript snapshot', () => {
    expect(store.recordDispatch(owner, { transcriptId: row().transcriptId, threadId: thread, completed: true }).status).toBe('pending');
    expect(fs.existsSync(library)).toBe(false);
    const restarted = new VoiceInboxService(options());
    const note = restarted.materialize(owner, [row()])[0];
    expect(fs.readFileSync(note.notePath!, 'utf8')).toBe(row().text);
    expect(restarted.getPresentation(owner).notes[0].threadId).toBe(thread);
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
    expect(updated).not.toContain('codex://');
    expect(store.getPresentation(owner).notes[0].threadId).toBe(thread);
  });

  it('does not overwrite a note changed between the read and guarded save', () => {
    const note = store.materialize(owner, [row()])[0];
    const original = saveGuard.writeTextFileWithConflictGuard;
    vi.spyOn(saveGuard, 'writeTextFileWithConflictGuard').mockImplementationOnce((file, content, version) => {
      fs.writeFileSync(file, 'A newer edit from the editor.');
      return original(file, content, version);
    });
    expect(store.materialize(owner, [row({ text: 'A synced correction.', updatedAtMs: 2000 })])[0].status).toBe('preserved');
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

  it('writes only exact transcript text and changes confirmed metadata without touching note bytes', () => {
    const onChanged = vi.fn(); store = new VoiceInboxService({ ...options(), onChanged });
    const note = store.materialize(owner, [row()])[0];
    expect(fs.readFileSync(note.notePath!, 'utf8')).toBe(row().text);
    const before = fs.statSync(note.notePath!); onChanged.mockClear();
    store.recordDispatch(owner, { transcriptId: row().transcriptId, threadId: thread, turnId: 'real-turn' });
    expect(fs.statSync(note.notePath!).mtimeMs).toBe(before.mtimeMs);
    expect(onChanged).toHaveBeenCalledWith(note.notePath);
    const presentation = store.getPresentation(owner);
    expect(presentation.notes[0]).toMatchObject({ notePath: note.notePath, transcriptId: row().transcriptId,
      createdAtMs: row().createdAtMs, threadId: thread, wordCount: 7 });
    expect(Object.keys(presentation.notes[0]).sort()).toEqual(['createdAtMs', 'notePath', 'threadId', 'title', 'transcriptId', 'wordCount']);
    expect(store.canOpenTask(owner, thread)).toBe(true);
    expect(store.canOpenTask(other, thread)).toBe(false);
    expect(store.canOpenTask(owner, 'file:///secret')).toBe(false);
  });

  it('reads legacy presentation without writes and migrates its wrappers while keeping identity and confirmation', () => {
    const legacy = legacyFixture();
    const ledgerBefore = fs.readFileSync(legacy.ledgerPath, 'utf8');
    expect(store.getPresentation(owner).notes[0]).toMatchObject({ createdAtMs: row().createdAtMs, threadId: thread });
    expect(fs.readFileSync(legacy.notePath, 'utf8')).toBe(legacy.content);
    expect(fs.readFileSync(legacy.ledgerPath, 'utf8')).toBe(ledgerBefore);
    expect(store.migrateLegacyNotes(owner)).toEqual({ migrated: 1, preserved: 0, remaining: 0 });
    expect(fs.readFileSync(legacy.notePath, 'utf8')).toBe(row().text);
    const restarted = new VoiceInboxService(options());
    expect(restarted.canOpenTask(owner, thread)).toBe(true);
    expect(restarted.materialize(owner, [row()])[0].notePath).toBe(legacy.notePath);
    expect(restarted.materialize(owner, [row({ text: 'A genuine newer correction.', updatedAtMs: 2000 })])[0].status).toBe('updated');
    expect(fs.readdirSync(path.dirname(legacy.notePath))).toHaveLength(1);
  });

  it('preserves edited legacy transcript, additions, and footer notes while removing generated wrappers', () => {
    const legacy = legacyFixture({ editedText: 'My edited transcript.', prefix: 'My introduction.\n\n',
      suffix: '\nMy appended note.', footer: `\nSent to [Codex conversation](codex://threads/${thread}).\nMy footer note.` });
    store.migrateLegacyNotes(owner);
    const content = fs.readFileSync(legacy.notePath, 'utf8');
    for (const text of ['My edited transcript.', 'My introduction.', 'My appended note.', 'My footer note.']) expect(content).toContain(text);
    expect(content).not.toContain('<!--'); expect(content).not.toContain('codex://');
    expect(store.materialize(owner, [row({ text: 'Remote correction.', updatedAtMs: 2000 })])[0].status).toBe('preserved');
    expect(fs.readFileSync(legacy.notePath, 'utf8')).toBe(content);
  });

  it('does not strip a legacy note changed during migration and retries safely later', () => {
    const legacy = legacyFixture();
    const guarded = saveGuard.writeTextFileWithConflictGuard;
    const raced = legacy.content.replace(row().text, 'A just-saved user correction.');
    vi.spyOn(saveGuard, 'writeTextFileWithConflictGuard').mockImplementationOnce((file, content, version) => {
      fs.writeFileSync(file, raced); return guarded(file, content, version);
    });
    expect(store.migrateLegacyNotes(owner)).toMatchObject({ migrated: 0, preserved: 1 });
    expect(fs.readFileSync(legacy.notePath, 'utf8')).toBe(raced);
    expect(store.migrateLegacyNotes(owner)).toMatchObject({ migrated: 1 });
    expect(fs.readFileSync(legacy.notePath, 'utf8')).toBe('A just-saved user correction.');
  });

  it('infers only valid legacy UTC filenames and never fabricates an unknown creation time', () => {
    legacyFixture({ filename: 'My renamed transcript.md' });
    expect(store.getPresentation(owner).notes[0].createdAtMs).toBeNull();
    store.migrateLegacyNotes(owner);
    expect(store.getPresentation(owner).notes[0].createdAtMs).toBeNull();
    store.materialize(owner, [row()]);
    expect(store.getPresentation(owner).notes[0].createdAtMs).toBe(row().createdAtMs);
  });

  it('restricts presentation to the selected folder, tracks file renames read-only, and bounds lists', () => {
    const note = store.materialize(owner, [row()])[0];
    const renamed = path.join(path.dirname(note.notePath!), 'My transcript.md'); fs.renameSync(note.notePath!, renamed);
    const ledgerBefore = fs.readFileSync(path.join(root, 'state', `${sha(owner)}.json`), 'utf8');
    expect(store.getPresentation(owner).notes[0].notePath).toBe(renamed);
    expect(fs.readFileSync(path.join(root, 'state', `${sha(owner)}.json`), 'utf8')).toBe(ledgerBefore);
    store.materialize(owner, [row({ transcriptId: 'second', createdAtMs: row().createdAtMs + 1000 })]);
    expect(store.getPresentation(owner, 1)).toMatchObject({ notes: [expect.objectContaining({ transcriptId: 'second' })], truncated: true });
    const alternate = path.join(library, 'Other'); fs.mkdirSync(alternate); store.selectFolder(owner, alternate);
    expect(store.getPresentation(owner)).toEqual({ folderPath: alternate, notes: [], truncated: false });
    expect(store.getPresentation(other)).toEqual({ folderPath: null, notes: [], truncated: false });
  });

  it('preserves a plain note published just before a crash without creating a duplicate on restart', () => {
    const link = fs.linkSync;
    vi.spyOn(fs, 'linkSync').mockImplementationOnce((source, target) => {
      link(source, target); throw new Error('Simulated crash after publication.');
    });
    expect(() => store.materialize(owner, [row()])).toThrow(/Simulated crash/);
    const restarted = new VoiceInboxService(options());
    const note = restarted.materialize(owner, [row()])[0];
    expect(fs.readFileSync(note.notePath!, 'utf8')).toBe(row().text);
    expect(fs.readdirSync(path.dirname(note.notePath!))).toHaveLength(1);
    expect(restarted.materialize(owner, [row()])[0].status).toBe('unchanged');
  });

  it('summarizes edited text with bounded first/last words and formats local-style capture times without seconds', () => {
    expect(summarizeVoiceInboxTranscript('one two three four five six seven eight nine ten'))
      .toEqual({ title: 'one two three four … seven eight nine ten', wordCount: 10 });
    expect(summarizeVoiceInboxTranscript('  first\n second\tthird  ')).toEqual({ title: 'first second third', wordCount: 3 });
    expect(Array.from(summarizeVoiceInboxTranscript('😀'.repeat(300)).title).length).toBeLessThanOrEqual(180);
    expect(formatVoiceInboxTime(Date.parse('2026-01-02T00:04:59Z'), 'UTC')).toBe('12:04 a.m.');
    expect(formatVoiceInboxTime(Date.parse('2026-01-02T13:05:59Z'), 'UTC')).toBe('1:05 p.m.');
    expect(formatVoiceInboxTime(null, 'UTC')).toBe('');
    const note = store.materialize(owner, [row()])[0]; fs.writeFileSync(note.notePath!, 'An edited voice transcript with four more words today.');
    expect(store.getPresentation(owner).notes[0]).toMatchObject({ title: 'An edited voice transcript … four more words today.', wordCount: 9 });
  });

  it('recovers migration after the plain write but before its ledger save without replay or lost edits', () => {
    const legacy = legacyFixture();
    const guarded = saveGuard.writeTextFileWithConflictGuard;
    vi.spyOn(saveGuard, 'writeTextFileWithConflictGuard').mockImplementationOnce((file, content, version) => {
      guarded(file, content, version); throw new Error('Simulated migration crash.');
    });
    store.migrateLegacyNotes(owner);
    expect(fs.readFileSync(legacy.notePath, 'utf8')).toBe(row().text);
    const restarted = new VoiceInboxService(options());
    expect(restarted.migrateLegacyNotes(owner)).toMatchObject({ migrated: 1 });
    expect(restarted.materialize(owner, [row({ text: 'A later correction.', updatedAtMs: 2000 })])[0].status).toBe('updated');
    expect(restarted.canOpenTask(owner, thread)).toBe(true);
    expect(fs.readdirSync(path.dirname(legacy.notePath))).toHaveLength(1);
  });

  it('skips oversized notes and symlink redirects without exposing or changing their contents', () => {
    const note = store.materialize(owner, [row()])[0];
    fs.writeFileSync(note.notePath!, 'x'.repeat(1024 * 1024 + 1));
    expect(store.getPresentation(owner)).toMatchObject({ notes: [], truncated: true });
    fs.unlinkSync(note.notePath!);
    const outside = path.join(root, 'private.md'); fs.writeFileSync(outside, 'Private unrelated note.');
    fs.symlinkSync(outside, note.notePath!);
    expect(store.getPresentation(owner).notes).toEqual([]);
    expect(() => store.materialize(owner, [row({ text: 'A correction.', updatedAtMs: 2000 })])).toThrow(/regular file/);
    expect(fs.readFileSync(outside, 'utf8')).toBe('Private unrelated note.');
  });

  it('rejects a parent symlink redirect during bulk legacy migration', () => {
    const legacy = legacyFixture();
    const child = path.join(path.dirname(legacy.notePath), 'Nested'); fs.mkdirSync(child);
    const nested = path.join(child, path.basename(legacy.notePath)); fs.renameSync(legacy.notePath, nested);
    const ledger = JSON.parse(fs.readFileSync(legacy.ledgerPath, 'utf8'));
    ledger.entries[legacy.key].notePath = nested; fs.writeFileSync(legacy.ledgerPath, JSON.stringify(ledger));
    const outside = path.join(root, 'Outside'); fs.renameSync(child, outside); fs.symlinkSync(outside, child);
    store = new VoiceInboxService(options());
    expect(store.migrateLegacyNotes(owner)).toEqual({ migrated: 0, preserved: 1, remaining: 0 });
    expect(fs.readFileSync(path.join(outside, path.basename(nested)), 'utf8')).toBe(legacy.content);
    expect(store.getPresentation(owner).notes).toEqual([]);
  });

  it('continues bounded local migration batches past preserved notes without looping on them', () => {
    const first = legacyFixture();
    const ledger = JSON.parse(fs.readFileSync(first.ledgerPath, 'utf8'));
    fs.writeFileSync(first.notePath, 'A user replaced this legacy body completely.');
    for (let i = 1; i <= 3; i++) {
      const key = sha(JSON.stringify([owner, `legacy-${i}`]));
      const file = path.join(path.dirname(first.notePath), `Legacy ${i}.md`);
      fs.writeFileSync(file, first.content.replaceAll(first.key, key));
      const stat = fs.statSync(file);
      ledger.entries[key] = { ...ledger.entries[first.key], transcriptId: `legacy-${i}`, notePath: file,
        identity: { dev: stat.dev, ino: stat.ino } };
    }
    fs.writeFileSync(first.ledgerPath, JSON.stringify(ledger)); store = new VoiceInboxService(options());
    expect(store.migrateLegacyNotes(owner, 1)).toEqual({ migrated: 0, preserved: 1, remaining: 3 });
    expect(store.migrateLegacyNotes(owner, 1)).toEqual({ migrated: 1, preserved: 0, remaining: 2 });
    expect(store.migrateLegacyNotes(owner, 1)).toEqual({ migrated: 1, preserved: 0, remaining: 1 });
    expect(store.migrateLegacyNotes(owner, 1)).toEqual({ migrated: 1, preserved: 0, remaining: 0 });
    expect(fs.readFileSync(first.notePath, 'utf8')).toBe('A user replaced this legacy body completely.');
  });
});
