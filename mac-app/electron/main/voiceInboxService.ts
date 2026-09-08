import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { writeTextFileAtomically, writeTextFileWithConflictGuard, type DocumentVersion } from './documentSaveGuard';
import { isPathInside } from './pathSafety';
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
  onChanged?: (notePath: string) => void;
}

const hash = (value: string | Buffer): string => crypto.createHash('sha256').update(value).digest('hex');
const sameFile = (left: FileIdentity, right: FileIdentity): boolean => left.dev === right.dev && left.ino === right.ino;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
  return { prefix: content.slice(0, a + begin.length), text: content.slice(a + begin.length, b),
    receipt: content.slice(b + start.length, c), suffix: content.slice(c) };
}

/** Local Library records only. This service never queries, claims, or executes Voice work. */
export class VoiceInboxService {
  private states = new Map<string, InboxState>();

  constructor(private readonly options: VoiceInboxServiceOptions) {}

  getFolder(ownerId: string): string | null {
    return this.state(ownerId).folder?.path ?? null;
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
      const text = `\n\n${transcript.text}\n\n`;
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
    entry.dispatch = { ...dispatch };
    state.entries[key] = entry;
    const result = entry.notePath
      ? this.write(state, key, entry, this.ensureFolder(ownerId))
      : { transcriptId: dispatch.transcriptId, status: 'pending' as const, notePath: null };
    this.save(state);
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
      if (!moved) return { transcriptId: entry.transcriptId, status: 'preserved', notePath: entry.notePath };
      entry.notePath = moved;
    }
    if (!entry.notePath) {
      if (nextText === undefined || createdAtMs === undefined) return { transcriptId: entry.transcriptId, status: 'pending', notePath: null };
      const stamp = new Date(createdAtMs).toISOString().slice(0, 19).replace('T', ' ').replaceAll(':', '.');
      const body = `${textMarker(key)}${nextText}${sentStart(key)}${dispatchText(entry.dispatch)}${sentEnd(key)}\n`;
      for (let suffix = 0; suffix < 1000; suffix++) {
        const target = path.join(folder, `Voice ${stamp}${suffix ? ` (${suffix + 1})` : ''}.md`);
        if (fs.existsSync(target)) {
          const existing = readFile(target);
          if (!sections(existing.content, key)) continue;
          entry.notePath = target;
          entry.identity = existing.identity;
          // Recover a note created before a ledger save without claiming user edits.
          if (existing.content === body) { entry.textHash = hash(nextText); entry.receiptHash = hash(dispatchText(entry.dispatch)); }
          return { transcriptId: entry.transcriptId, status: 'preserved', notePath: target };
        }
        this.writeNew(target, body);
        entry.notePath = target;
        entry.identity = readFile(target).identity;
        entry.textHash = hash(nextText);
        entry.receiptHash = hash(dispatchText(entry.dispatch));
        this.options.onChanged?.(target);
        return { transcriptId: entry.transcriptId, status: 'created', notePath: target };
      }
      throw new Error('Voice Inbox could not allocate a note name.');
    }
    const current = readFile(entry.notePath);
    const parts = sections(current.content, key);
    if (!parts) return { transcriptId: entry.transcriptId, status: 'preserved', notePath: entry.notePath };
    const textIsOurs = hash(parts.text) === entry.textHash;
    const receiptIsOurs = hash(parts.receipt) === entry.receiptHash;
    const text = nextText !== undefined && textIsOurs ? nextText : parts.text;
    const receipt = receiptIsOurs ? dispatchText(entry.dispatch) : parts.receipt;
    const updated = `${parts.prefix}${text}${sentStart(key)}${receipt}${parts.suffix}`;
    if (updated === current.content) return { transcriptId: entry.transcriptId,
      status: nextText !== undefined && !textIsOurs ? 'preserved' : 'unchanged', notePath: entry.notePath };
    const saved = writeTextFileWithConflictGuard(entry.notePath, updated, current.version);
    if (!saved.ok) {
      if (saved.reason === 'conflict' || saved.reason === 'not-found') return { transcriptId: entry.transcriptId, status: 'preserved', notePath: entry.notePath };
      throw new Error('Voice Inbox note could not be saved.');
    }
    if (textIsOurs) entry.textHash = hash(text);
    if (receiptIsOurs) entry.receiptHash = hash(receipt);
    entry.identity = readFile(entry.notePath).identity;
    this.options.onChanged?.(entry.notePath);
    return { transcriptId: entry.transcriptId, status: 'updated', notePath: entry.notePath };
  }

  private writeNew(target: string, content: string): void {
    const temporary = path.join(path.dirname(target), `.voice-inbox-${crypto.randomUUID()}.tmp`);
    let fd: number | null = null;
    try {
      fd = fs.openSync(temporary, 'wx', 0o600);
      fs.writeFileSync(fd, content, 'utf8');
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = null;
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
