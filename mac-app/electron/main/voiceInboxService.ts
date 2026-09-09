import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { writeTextFileAtomically, writeTextFileWithConflictGuard, type DocumentVersion } from './documentSaveGuard';
import { isPathInside } from './pathSafety';
import { summarizeVoiceInboxTranscript, type VoiceInboxPresentation } from '../shared/voiceInboxPresentation';
import type {
  VoiceInboxCursor, VoiceInboxCursorKind, VoiceInboxDispatch, VoiceInboxTranscript, VoiceInboxWriteResult,
} from './voiceInboxTypes';

interface FileIdentity { dev: number; ino: number }
interface Folder extends FileIdentity { path: string; legacy: boolean }
interface ReceiptEntry {
  transcriptId: string;
  notePath?: string;
  identity?: FileIdentity;
  textHash?: string;
  receiptHash?: string;
  sourceHash?: string;
  updatedAtMs?: number;
  createdAtMs?: number;
  format?: 'plain';
  creationPending?: boolean;
  migrationPending?: { hash: string; managed: boolean };
  dispatch?: VoiceInboxDispatch;
}
interface InboxState {
  version: 1;
  owner: string;
  folder?: Folder;
  pendingFolderChoice?: string;
  entries: Record<string, ReceiptEntry>;
  cursors: Partial<Record<VoiceInboxCursorKind, VoiceInboxCursor>>;
}
export interface VoiceInboxServiceOptions {
  stateDirectory: string;
  libraryRoot: string;
  getLibraryRoots?: () => string[];
  getTaskTitles?: (owner: string) => ReadonlyMap<string, string>;
  onChanged?: (notePath: string) => void;
}

const hash = (value: string | Buffer): string => crypto.createHash('sha256').update(value).digest('hex');
const sameFile = (left: FileIdentity, right: FileIdentity): boolean => left.dev === right.dev && left.ino === right.ino;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_NOTE_BYTES = 1024 * 1024;
const MAX_PRESENTATION_BYTES = 8 * 1024 * 1024;
const sourceKey = (owner: string, transcriptId: string): string => hash(JSON.stringify([owner, transcriptId]));
const textMarker = (key: string): string => `<!-- field-theory-voice:${key} -->`;
const sentStart = (key: string): string => `<!-- field-theory-voice-sent:${key} -->`;
const sentEnd = (key: string): string => `<!-- /field-theory-voice-sent:${key} -->`;
const dispatchText = (dispatch?: VoiceInboxDispatch): string => dispatch
  ? `\nSent to [Codex conversation](codex://threads/${encodeURIComponent(dispatch.threadId)}).\n`
  : '\n';

function readFile(filePath: string): { content: string; version: DocumentVersion; identity: FileIdentity } {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Voice Inbox note is not a regular file.');
  if (fs.realpathSync(filePath) !== path.resolve(filePath)) throw new Error('Voice Inbox note path was redirected.');
  if (stat.size > MAX_NOTE_BYTES) throw new Error('Voice Inbox note is too large to update automatically.');
  const bytes = fs.readFileSync(filePath);
  return { content: bytes.toString('utf8'), version: { mtimeMs: stat.mtimeMs, size: bytes.length, sha256: hash(bytes) },
    identity: { dev: stat.dev, ino: stat.ino } };
}

function sections(content: string, key: string): { prefix: string; text: string; receipt: string; suffix: string } | null {
  const begin = textMarker(key);
  const start = sentStart(key);
  const end = sentEnd(key);
  const a = content.indexOf(begin);
  const b = content.indexOf(start);
  const c = content.indexOf(end);
  if (a < 0 || b < a + begin.length || c < b + start.length
    || content.indexOf(begin, a + begin.length) >= 0 || content.indexOf(start, b + start.length) >= 0
    || content.indexOf(end, c + end.length) >= 0) return null;
  return { prefix: content.slice(0, a), text: content.slice(a + begin.length, b),
    receipt: content.slice(b + start.length, c), suffix: content.slice(c + end.length) };
}

function confirmedDispatch(dispatch?: VoiceInboxDispatch): dispatch is VoiceInboxDispatch {
  return !!dispatch && uuid.test(dispatch.threadId)
    && (dispatch.completed === true || (typeof dispatch.turnId === 'string' && !!dispatch.turnId.trim()));
}

function legacyContent(content: string, key: string, entry: ReceiptEntry): { content: string; managed: boolean } | null {
  const parts = sections(content, key);
  if (!parts) return null;
  const text = parts.text.replace(/^\n\n/, '').replace(/\n\n$/, '');
  const ownedReceipt = hash(parts.receipt) === entry.receiptHash || parts.receipt === '\n'
    || parts.receipt === dispatchText(entry.dispatch);
  // Remove only the known generated receipt. Any added or edited footer text
  // stays with the user's note, after removing the internal wrapper comments.
  const receipt = ownedReceipt ? '' : parts.receipt.replace(dispatchText(entry.dispatch), '');
  const suffix = parts.suffix.replace(/^\n/, '');
  const additions = [receipt, suffix].filter((value) => value.length > 0);
  return { content: `${parts.prefix}${text}${additions.length ? `\n\n${additions.join('\n')}` : ''}`,
    managed: hash(parts.text) === entry.textHash && !parts.prefix && ownedReceipt && !suffix };
}

function legacyCreatedAt(notePath?: string): number | null {
  const match = notePath && /^Voice (\d{4}-\d{2}-\d{2}) (\d{2})\.(\d{2})\.(\d{2})(?: \(\d+\))?\.md$/.exec(path.basename(notePath));
  if (!match) return null;
  const iso = `${match[1]}T${match[2]}:${match[3]}:${match[4]}.000Z`;
  const value = Date.parse(iso);
  return Number.isFinite(value) && new Date(value).toISOString() === iso ? value : null;
}

/** Local Library records only. This service never queries, claims, or executes Voice work. */
export class VoiceInboxService {
  private states = new Map<string, InboxState>();
  private migrationNext = new Map<string, string>();

  constructor(private readonly options: VoiceInboxServiceOptions) {}

  getFolder(ownerId: string): string | null {
    return this.state(ownerId).folder?.path ?? null;
  }

  /** Bounded local metadata only; this never creates, migrates, or saves a note. */
  getPresentation(ownerId: string, limit = 500): VoiceInboxPresentation {
    const state = this.state(ownerId);
    const output: VoiceInboxPresentation = { folderPath: null, notes: [], truncated: false };
    if (!state.folder) return output;
    let folder: string | null = null;
    try {
      const current = this.folder(state.folder.path, state.folder.legacy);
      if (sameFile(current, state.folder)) folder = current.path;
    } catch { /* Resolve a renamed folder without saving anything. */ }
    folder ??= this.findIdentity(state.folder, this.roots(state.folder.legacy ? path.dirname(state.folder.path) : undefined), true);
    output.folderPath = folder ?? state.folder.path;
    if (!folder) return output;
    const maximum = Number.isFinite(limit) ? Math.max(1, Math.min(1000, Math.floor(limit))) : 500;
    const taskTitles = this.options.getTaskTitles?.(ownerId);
    let remainingBytes = MAX_PRESENTATION_BYTES;
    let identities: Map<string, string> | undefined;
    const entries = Object.entries(state.entries).filter(([, entry]) => entry.notePath && isPathInside(state.folder!.path, entry.notePath))
      .sort(([, left], [, right]) => (right.createdAtMs ?? legacyCreatedAt(right.notePath) ?? 0)
        - (left.createdAtMs ?? legacyCreatedAt(left.notePath) ?? 0));
    for (const [index, [key, entry]] of entries.entries()) {
      if (index >= 10_000 || output.notes.length >= maximum || remainingBytes <= 0) { output.truncated = true; break; }
      let notePath = path.join(folder, path.relative(state.folder.path, entry.notePath!));
      if (!fs.existsSync(notePath) && entry.identity) {
        identities ??= this.noteIdentities(folder);
        notePath = identities.get(`${entry.identity.dev}:${entry.identity.ino}`) ?? notePath;
      }
      try {
        // A replaced parent symlink must not redirect metadata reads outside the selected folder.
        if (!isPathInside(folder, fs.realpathSync(notePath))) continue;
        const stat = fs.lstatSync(notePath);
        if (stat.size > MAX_NOTE_BYTES || stat.size > remainingBytes) { output.truncated = true; continue; }
        remainingBytes -= stat.size;
        const current = readFile(notePath);
        if (entry.creationPending && (!entry.identity || !sameFile(entry.identity, current.identity))) continue;
        const text = entry.format === 'plain' ? current.content : legacyContent(current.content, key, entry)?.content ?? current.content;
        output.notes.push({ notePath, transcriptId: entry.transcriptId,
          createdAtMs: entry.createdAtMs !== undefined && Number.isFinite(new Date(entry.createdAtMs).getTime())
            ? entry.createdAtMs : legacyCreatedAt(entry.notePath),
          ...(confirmedDispatch(entry.dispatch) ? { threadId: entry.dispatch.threadId } : {}),
          ...summarizeVoiceInboxTranscript(text),
          ...(confirmedDispatch(entry.dispatch) && taskTitles?.get(entry.dispatch.threadId)?.trim()
            ? { title: taskTitles.get(entry.dispatch.threadId)! } : {}),
        });
      } catch { /* Deleted, moved, or unreadable notes do not become fabricated records. */ }
    }
    return output;
  }

  canOpenTask(ownerId: string, threadId: string): boolean {
    if (!uuid.test(threadId)) return false;
    return Object.values(this.state(ownerId).entries).some((entry) => confirmedDispatch(entry.dispatch)
      && entry.dispatch.threadId.toLowerCase() === threadId.toLowerCase());
  }

  /** Explicit startup migration; reading the presentation does not perform writes. */
  migrateLegacyNotes(ownerId: string, limit = 500): { migrated: number; preserved: number; remaining: number } {
    const state = this.state(ownerId);
    if (!state.folder) return { migrated: 0, preserved: 0, remaining: 0 };
    const folder = this.ensureFolder(ownerId);
    const entries = Object.entries(state.entries).filter(([, entry]) => entry.format !== 'plain'
      && entry.notePath && isPathInside(folder, entry.notePath));
    const maximum = Number.isFinite(limit) ? Math.max(1, Math.min(1000, Math.floor(limit))) : 500;
    const nextKey = this.migrationNext.get(ownerId);
    const start = Math.max(0, nextKey ? entries.findIndex(([key]) => key === nextKey) : 0);
    const startedAt = performance.now();
    let bytes = 0;
    let index = start;
    const result = { migrated: 0, preserved: 0, remaining: 0 };
    for (; index < entries.length && index - start < maximum; index++) {
      if (index > start && (performance.now() - startedAt >= 250 || bytes >= MAX_PRESENTATION_BYTES)) break;
      const [key, entry] = entries[index];
      try {
        // Metadata sizing does not follow a redirected parent into a file read.
        // readFile independently rejects the canonical-path redirect before any write.
        const stat = fs.lstatSync(entry.notePath!);
        if (stat.size > MAX_NOTE_BYTES) { result.preserved++; continue; }
        if (bytes + stat.size > MAX_PRESENTATION_BYTES) break;
        bytes += stat.size;
        this.write(state, key, entry, folder);
        if (entry.format === 'plain') result.migrated++;
        else result.preserved++;
        this.save(state);
      } catch { result.preserved++; }
    }
    result.remaining = entries.length - index;
    if (result.remaining) this.migrationNext.set(ownerId, entries[index][0]);
    else this.migrationNext.delete(ownerId);
    return result;
  }

  /** Existing choices are preserved, including a previously authorized folder outside Library. */
  ensureFolder(ownerId: string, existingChoice?: string | null): string {
    const state = this.state(ownerId);
    const savedChoice = state.pendingFolderChoice ?? existingChoice;
    if (!state.folder && savedChoice) {
      if (!path.isAbsolute(savedChoice)) throw new Error('Choose an absolute Voice Inbox folder.');
      // Remember an unavailable legacy choice too: another startup callback or
      // system resume must not silently replace it with the default Inbox.
      state.pendingFolderChoice = savedChoice;
      this.save(state);
      try { state.folder = this.folder(savedChoice, true); }
      catch { throw new Error('The saved Voice Inbox folder is unavailable. Choose its destination again.'); }
      delete state.pendingFolderChoice;
      this.save(state);
    }
    if (state.folder) {
      if (fs.existsSync(state.folder.path)) {
        const current = this.folder(state.folder.path, state.folder.legacy);
        if (!sameFile(current, state.folder)) throw new Error('The saved Voice Inbox folder was replaced. Choose its destination again.');
        return current.path;
      }
      const moved = this.findIdentity(state.folder, this.roots(state.folder.legacy ? path.dirname(state.folder.path) : undefined), true);
      if (!moved) throw new Error('The saved Voice Inbox folder is unavailable. Choose its destination again.');
      const previous = state.folder.path;
      state.folder.path = moved;
      for (const entry of Object.values(state.entries)) {
        if (entry.notePath && isPathInside(previous, entry.notePath)) entry.notePath = path.join(moved, path.relative(previous, entry.notePath));
      }
      this.save(state);
      return moved;
    }
    fs.mkdirSync(this.options.libraryRoot, { recursive: true });
    const root = fs.realpathSync(this.options.libraryRoot);
    const candidates = fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.toLocaleLowerCase() === 'inbox')
      .sort((a, b) => (a.name === 'Inbox' ? -1 : b.name === 'Inbox' ? 1 : a.name.localeCompare(b.name)));
    const target = path.join(root, candidates[0]?.name ?? 'Inbox');
    fs.mkdirSync(target, { recursive: true });
    state.folder = this.folder(target, false);
    this.save(state);
    return state.folder.path;
  }

  /** New choices must be existing folders in the user's registered Library roots. */
  selectFolder(ownerId: string, folderPath: string): string {
    const state = this.state(ownerId);
    state.folder = this.folder(folderPath, false);
    delete state.pendingFolderChoice;
    this.save(state);
    return state.folder.path;
  }

  materialize(ownerId: string, transcripts: VoiceInboxTranscript[]): VoiceInboxWriteResult[] {
    const state = this.state(ownerId);
    const folder = this.ensureFolder(ownerId);
    const results: VoiceInboxWriteResult[] = [];
    for (const transcript of transcripts) {
      if (transcript.userId !== ownerId) throw new Error('Voice Inbox transcript belongs to another account.');
      if (!transcript.transcriptId || transcript.transcriptId.length > 1024 || typeof transcript.text !== 'string'
        || Buffer.byteLength(transcript.text, 'utf8') > MAX_NOTE_BYTES
        || !Number.isFinite(new Date(transcript.createdAtMs).getTime()) || !Number.isFinite(transcript.updatedAtMs)) {
        throw new Error('Invalid Voice Inbox transcript.');
      }
      const key = sourceKey(ownerId, transcript.transcriptId);
      const entry = state.entries[key] ?? { transcriptId: transcript.transcriptId };
      if (transcript.deletedAt || !transcript.text.trim()) {
        results.push({ transcriptId: transcript.transcriptId, status: 'skipped', notePath: entry.notePath ?? null });
        continue;
      }
      state.entries[key] = entry;
      const isStale = entry.updatedAtMs !== undefined && transcript.updatedAtMs < entry.updatedAtMs;
      entry.createdAtMs = transcript.createdAtMs;
      const text = transcript.text;
      const result = this.write(state, key, entry, folder, isStale ? undefined : text, transcript.createdAtMs);
      if (!isStale) {
        entry.sourceHash = hash(transcript.text);
        entry.updatedAtMs = transcript.updatedAtMs;
      }
      this.save(state);
      results.push(result);
    }
    return results;
  }

  recordDispatch(ownerId: string, dispatch: VoiceInboxDispatch): VoiceInboxWriteResult {
    if (!dispatch.transcriptId || dispatch.transcriptId.length > 1024 || !uuid.test(dispatch.threadId)
      || (dispatch.dispatchedAt !== undefined && !Number.isFinite(Date.parse(dispatch.dispatchedAt)))
      || (!dispatch.completed && (typeof dispatch.turnId !== 'string' || !dispatch.turnId.trim()))) {
      throw new Error('A confirmed Voice turn and actual conversation ID are required.');
    }
    const state = this.state(ownerId);
    const key = sourceKey(ownerId, dispatch.transcriptId);
    const entry = state.entries[key] ?? { transcriptId: dispatch.transcriptId };
    if (entry.dispatch?.dispatchedAt && dispatch.dispatchedAt
      && Date.parse(dispatch.dispatchedAt) < Date.parse(entry.dispatch.dispatchedAt)) {
      return { transcriptId: dispatch.transcriptId, status: 'unchanged', notePath: entry.notePath ?? null };
    }
    const changed = JSON.stringify(entry.dispatch) !== JSON.stringify(dispatch);
    entry.dispatch = { ...dispatch };
    state.entries[key] = entry;
    const result = entry.notePath
      ? this.write(state, key, entry, this.ensureFolder(ownerId))
      : { transcriptId: dispatch.transcriptId, status: 'pending' as const, notePath: null };
    this.save(state);
    if (changed && result.notePath) this.options.onChanged?.(result.notePath);
    return result;
  }

  getCursor(ownerId: string, kind: VoiceInboxCursorKind): VoiceInboxCursor | null {
    const cursor = this.state(ownerId).cursors[kind];
    return cursor ? { ...cursor } : null;
  }

  setCursor(ownerId: string, kind: VoiceInboxCursorKind, cursor: VoiceInboxCursor): void {
    if (!uuid.test(cursor.id) || !Number.isFinite(Date.parse(cursor.updatedAt))) throw new Error('Invalid Voice Inbox cursor.');
    const state = this.state(ownerId);
    state.cursors[kind] = { ...cursor };
    this.save(state);
  }

  private write(state: InboxState, key: string, entry: ReceiptEntry, folder: string,
    nextText?: string, createdAtMs?: number): VoiceInboxWriteResult {
    if (entry.notePath && !fs.existsSync(entry.notePath)) {
      const moved = entry.identity && this.findIdentity(entry.identity, [...new Set([folder, path.dirname(entry.notePath), ...this.roots()])], false);
      if (moved) entry.notePath = moved;
      else if (!entry.creationPending) return { transcriptId: entry.transcriptId, status: 'preserved', notePath: entry.notePath };
      else if (nextText === undefined) return { transcriptId: entry.transcriptId, status: 'pending', notePath: entry.notePath };
      else {
        // A durable allocation with no published file may resume creation. A
        // completed allocation whose note was deleted is never recreated.
        this.publishNew(state, entry, entry.notePath, nextText);
        return { transcriptId: entry.transcriptId, status: 'created', notePath: entry.notePath };
      }
    }
    if (!entry.notePath) {
      if (nextText === undefined || createdAtMs === undefined) return { transcriptId: entry.transcriptId, status: 'pending', notePath: null };
      const stamp = new Date(createdAtMs).toISOString().slice(0, 19).replace('T', ' ').replaceAll(':', '.');
      for (let suffix = 0; suffix < 1000; suffix++) {
        const target = path.join(folder, `Voice ${stamp}${suffix ? ` (${suffix + 1})` : ''}.md`);
        if (fs.existsSync(target)) {
          let existing: ReturnType<typeof readFile>;
          try { existing = readFile(target); } catch { continue; }
          const legacy = sections(existing.content, key);
          if (!legacy) continue;
          entry.notePath = target;
          entry.identity = existing.identity;
          // A legacy marker can recover a pre-ledger crash. Plain notes rely on
          // the allocation persisted before publication, never content equality.
          if (legacy.text === `\n\n${nextText}\n\n`) entry.textHash = hash(legacy.text);
          if (legacy.receipt === dispatchText(entry.dispatch)) entry.receiptHash = hash(legacy.receipt);
          return this.write(state, key, entry, folder, nextText, createdAtMs);
        }
        try { this.publishNew(state, entry, target, nextText); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
          delete entry.notePath; delete entry.identity; delete entry.creationPending;
          this.save(state);
          continue;
        }
        return { transcriptId: entry.transcriptId, status: 'created', notePath: target };
      }
      throw new Error('Voice Inbox could not allocate a note name.');
    }
    const current = readFile(entry.notePath);
    if (entry.creationPending) {
      // If another file took this reserved name, it is not our transcript.
      if (!entry.identity || !sameFile(entry.identity, current.identity)) return { transcriptId: entry.transcriptId, status: 'preserved', notePath: entry.notePath };
      delete entry.creationPending;
    }
    entry.createdAtMs ??= legacyCreatedAt(entry.notePath) ?? undefined;
    const legacy = entry.format === 'plain' ? null : legacyContent(current.content, key, entry);
    if (!legacy && entry.migrationPending && entry.format !== 'plain') {
      // A successful guarded migration may precede its final ledger save. If
      // the user edited afterward, adopt plain format but preserve their edit.
      entry.format = 'plain';
      entry.textHash = entry.migrationPending.managed && hash(current.content) === entry.migrationPending.hash
        ? entry.migrationPending.hash : undefined;
      delete entry.migrationPending;
      delete entry.receiptHash;
    }
    if (entry.format !== 'plain' && !legacy) return { transcriptId: entry.transcriptId, status: 'preserved', notePath: entry.notePath };
    const managed = legacy ? legacy.managed : hash(current.content) === entry.textHash;
    const plain = legacy?.content ?? current.content;
    const updated = nextText !== undefined && managed ? nextText : plain;
    if (updated === current.content) {
      entry.identity = current.identity;
      if (legacy) { entry.format = 'plain'; entry.textHash = managed ? hash(updated) : undefined; delete entry.receiptHash; }
      return { transcriptId: entry.transcriptId, status: nextText !== undefined && !managed ? 'preserved' : 'unchanged', notePath: entry.notePath };
    }
    if (legacy) {
      entry.migrationPending = { hash: hash(updated), managed };
      this.save(state);
    }
    const saved = writeTextFileWithConflictGuard(entry.notePath, updated, current.version);
    if (!saved.ok) {
      if (saved.reason === 'conflict' || saved.reason === 'not-found') return { transcriptId: entry.transcriptId, status: 'preserved', notePath: entry.notePath };
      throw new Error('Voice Inbox note could not be saved.');
    }
    entry.format = 'plain';
    delete entry.migrationPending;
    entry.textHash = managed ? hash(updated) : undefined;
    delete entry.receiptHash;
    entry.identity = readFile(entry.notePath).identity;
    this.options.onChanged?.(entry.notePath);
    return { transcriptId: entry.transcriptId, status: 'updated', notePath: entry.notePath };
  }

  private publishNew(state: InboxState, entry: ReceiptEntry, target: string, text: string): void {
    this.writeNew(target, text, (identity) => {
      entry.notePath = target;
      entry.identity = identity;
      entry.format = 'plain';
      entry.creationPending = true;
      entry.textHash = hash(text);
      // The stable path and file identity survive a crash immediately after the
      // hard-link publication, without embedding internal markers in the note.
      this.save(state);
    });
    delete entry.creationPending;
    this.options.onChanged?.(target);
  }

  private writeNew(target: string, content: string, beforePublish: (identity: FileIdentity) => void): void {
    const temporary = path.join(path.dirname(target), `.voice-inbox-${crypto.randomUUID()}.tmp`);
    let fd: number | null = null;
    try {
      fd = fs.openSync(temporary, 'wx', 0o600);
      fs.writeFileSync(fd, content, 'utf8');
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = null;
      const identity = fs.statSync(temporary);
      beforePublish({ dev: identity.dev, ino: identity.ino });
      fs.linkSync(temporary, target); // Atomic publication without replacing an existing note.
      // Persist the note before committing a ledger that remembers its identity.
      let directoryFd: number | null = null;
      try { directoryFd = fs.openSync(path.dirname(target), 'r'); fs.fsyncSync(directoryFd); }
      catch { /* Directory fsync is not supported by every Library filesystem. */ }
      finally { if (directoryFd !== null) fs.closeSync(directoryFd); }
    } finally {
      if (fd !== null) fs.closeSync(fd);
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }

  private folder(folderPath: string, legacy: boolean): Folder {
    if (!path.isAbsolute(folderPath)) throw new Error('Choose an absolute Voice Inbox folder.');
    const real = fs.realpathSync(folderPath);
    const stat = fs.statSync(real);
    if (!stat.isDirectory()) throw new Error('Choose an existing Voice Inbox folder.');
    if (!legacy && !this.roots().some((root) => isPathInside(root, real))) throw new Error('Choose a folder in your Library.');
    return { path: real, dev: stat.dev, ino: stat.ino, legacy };
  }

  private roots(extra?: string): string[] {
    return [...new Set([this.options.libraryRoot, ...(this.options.getLibraryRoots?.() ?? []), ...(extra ? [extra] : [])])]
      .flatMap((root) => { try { return [fs.realpathSync(root)]; } catch { return []; } });
  }

  /** Only used when a known path disappears; bounded lookup preserves Library renames. */
  private findIdentity(identity: FileIdentity, roots: string[], directory: boolean): string | null {
    const queue = roots.map((root) => ({ root, depth: 0 }));
    let examined = 0;
    while (queue.length && examined < 10_000) {
      const next = queue.shift()!;
      if (directory) {
        try { if (sameFile(identity, fs.statSync(next.root))) return next.root; } catch { continue; }
      }
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(next.root, { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        if (++examined > 10_000) break;
        if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
        const target = path.join(next.root, entry.name);
        if ((directory && entry.isDirectory()) || (!directory && entry.isFile() && entry.name.endsWith('.md'))) {
          try { if (sameFile(identity, fs.statSync(target))) return target; } catch { /* A concurrent rename may remove it. */ }
        }
        if (entry.isDirectory() && next.depth < 8) queue.push({ root: target, depth: next.depth + 1 });
      }
    }
    return null;
  }

  private noteIdentities(folder: string): Map<string, string> {
    const found = new Map<string, string>();
    const queue = [{ root: folder, depth: 0 }];
    let count = 0;
    while (queue.length && count < 10_000) {
      const next = queue.shift()!;
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(next.root, { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        if (++count > 10_000) break;
        if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
        const target = path.join(next.root, entry.name);
        if (entry.isFile() && entry.name.endsWith('.md')) {
          try { const stat = fs.statSync(target); found.set(`${stat.dev}:${stat.ino}`, target); } catch { /* Concurrent move. */ }
        } else if (entry.isDirectory() && next.depth < 8) queue.push({ root: target, depth: next.depth + 1 });
      }
    }
    return found;
  }

  private state(ownerId: string): InboxState {
    if (!ownerId || ownerId.length > 128) throw new Error('A Voice Inbox account is required.');
    const cached = this.states.get(ownerId);
    if (cached) return cached;
    const target = path.join(this.options.stateDirectory, `${hash(ownerId)}.json`);
    const state: InboxState = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8'))
      : { version: 1, owner: ownerId, entries: {}, cursors: {} };
    if (state.version !== 1 || state.owner !== ownerId || !state.entries || Array.isArray(state.entries) || !state.cursors) {
      throw new Error('Voice Inbox state is invalid.');
    }
    this.states.set(ownerId, state);
    return state;
  }

  private save(state: InboxState): void {
    fs.mkdirSync(this.options.stateDirectory, { recursive: true, mode: 0o700 });
    writeTextFileAtomically(path.join(this.options.stateDirectory, `${hash(state.owner)}.json`), JSON.stringify(state));
  }
}
