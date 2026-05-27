import { BrowserWindow } from 'electron';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as pty from 'node-pty';
import { libraryDir } from './fieldTheoryPaths';

export const CodexTerminalIPCChannels = {
  CREATE: 'codexTerminal:create',
  LIST: 'codexTerminal:list',
  LIST_HISTORY: 'codexTerminal:listHistory',
  READ_HISTORY_PREVIEW: 'codexTerminal:readHistoryPreview',
  GET_BUFFER: 'codexTerminal:getBuffer',
  INPUT: 'codexTerminal:input',
  RESIZE: 'codexTerminal:resize',
  KILL: 'codexTerminal:kill',
  RENAME: 'codexTerminal:rename',
  READ_CLIPBOARD_TEXT: 'codexTerminal:readClipboardText',
  WRITE_CLIPBOARD_TEXT: 'codexTerminal:writeClipboardText',
  ATTACH_PAGE_CONTEXT: 'codexTerminal:attachPageContext',
  DATA: 'codexTerminal:data',
  EXIT: 'codexTerminal:exit',
  SESSIONS_CHANGED: 'codexTerminal:sessionsChanged',
} as const;

export interface CodexTerminalSessionSummary {
  id: string;
  title: string;
  cwd: string;
  engine: 'pty';
  createdAt: string;
  exitedAt: string | null;
  exitCode: number | null;
  restored: boolean;
  transcriptPath: string;
  attachedContexts: CodexTerminalAttachedContext[];
}

export interface CodexTerminalPageContext {
  title: string;
  path: string;
  kind: 'wiki' | 'artifact' | 'external' | 'unknown';
  contentMode: string;
  content: string;
  selectionText?: string;
}

export interface CodexTerminalAttachedContext {
  sessionId: string;
  sessionTitle: string;
  sessionCwd: string;
  launchedCommand: string;
  repoPath: string | null;
  gitBranch: string | null;
  filePath: string;
  title: string;
  sourcePath: string;
  kind: CodexTerminalPageContext['kind'];
  attachedAt: string;
}

export interface CodexTerminalHistoryListInput {
  query?: string;
  limit?: number;
}

export interface CodexTerminalHistoryEntry {
  filePath: string;
  fileName: string;
  threadId: string | null;
  title: string;
  cwd: string | null;
  startedAt: string | null;
  updatedAt: string;
  sizeBytes: number;
  preview: string;
}

export interface CodexTerminalHistoryPreviewInput {
  maxBytes?: number;
}

export interface CodexTerminalHistoryPreview {
  filePath: string;
  threadId: string | null;
  title: string;
  cwd: string | null;
  startedAt: string | null;
  updatedAt: string;
  preview: string;
  truncated: boolean;
}

interface CodexTerminalSession extends CodexTerminalSessionSummary {
  process: pty.IPty | null;
  outputBuffer: string;
  codexLaunchTimer: ReturnType<typeof setTimeout> | null;
}

type CodexHistoryFileEntry = { filePath: string; updatedAt: string; sizeBytes: number };

interface CodexTerminalManagerOptions {
  defaultCwd: string;
  maxBufferBytes?: number;
  spawnPty?: typeof pty.spawn;
  provenanceFilePath?: string;
  contextDirPath?: string;
  sessionStateFilePath?: string;
  transcriptDirPath?: string;
  codexSessionsDirPath?: string;
}

const DEFAULT_MAX_BUFFER_BYTES = 512 * 1024;
const MAX_PERSISTED_SESSIONS = 24;
const DEFAULT_HISTORY_LIMIT = 50;
const MAX_HISTORY_LIMIT = 200;
const HISTORY_SUMMARY_BYTES = 64 * 1024;
const DEFAULT_HISTORY_PREVIEW_BYTES = 128 * 1024;
const MAX_HISTORY_PREVIEW_BYTES = 512 * 1024;
const HISTORY_FILE_CACHE_MS = 2000;
const CODEX_COMMAND = 'codex';
const CODEX_LAUNCH_FALLBACK_MS = 1200;
const SAFE_CODEX_LAUNCH_COMMAND_PATTERN = /^codex(?: resume [A-Za-z0-9_-]+)?$/;
const ANSI_PATTERN = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07]*(?:\x07|\x1b\\)/g;
const CODEX_INPUT_PLACEHOLDERS = [
  'Run /review on my current changes',
  'Write tests for @filename',
] as const;

function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(channel, payload);
    }
  }
}

function commonInteractivePath(): string {
  const existing = process.env.PATH ?? '';
  const prefixes = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'];
  const parts = existing.split(path.delimiter).filter(Boolean);
  return [...prefixes, ...parts.filter((part) => !prefixes.includes(part))].join(path.delimiter);
}

function defaultContextDirPath(): string {
  return path.join(libraryDir(), 'Codex Context');
}

function defaultCodexSessionsDirPath(): string {
  return path.join(os.homedir(), '.codex', 'sessions');
}

function isDirectory(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function writePageContextBundle(contextDirPath: string, sessionId: string, context: CodexTerminalPageContext): string {
  const dir = path.join(contextDirPath, 'sessions', sessionId);
  const manifestPath = path.join(dir, 'context.json');
  const activePath = path.join(dir, 'active.md');
  const selectionPath = path.join(dir, 'selection.md');
  const recentPath = path.join(dir, 'recent.md');
  const updatedAt = new Date().toISOString();
  const selectionText = context.selectionText?.trim() ?? '';

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(activePath, context.content || '', 'utf8');
  if (!fs.existsSync(recentPath)) {
    fs.writeFileSync(recentPath, '', 'utf8');
  }
  if (selectionText) {
    fs.writeFileSync(selectionPath, selectionText, 'utf8');
  } else if (fs.existsSync(selectionPath)) {
    fs.rmSync(selectionPath);
  }

  const manifest = {
    version: 1,
    updatedAt,
    activeDocument: {
      title: context.title || 'Field Theory Page',
      path: context.path || 'unknown',
      kind: context.kind,
      contentMode: context.contentMode || 'unknown',
      contentHash: crypto.createHash('sha256').update(context.content || '').digest('hex'),
      contentPath: activePath,
    },
    selection: selectionText
      ? {
          textPath: selectionPath,
          preview: selectionText.slice(0, 240),
        }
      : null,
    recent: [],
    includedPages: [],
  };

  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifestPath;
}

function resolveGitInfo(cwd: string): { repoPath: string | null; gitBranch: string | null } {
  let current = cwd;
  while (current && current !== path.dirname(current)) {
    const gitPath = path.join(current, '.git');
    if (fs.existsSync(gitPath)) {
      const headPath = fs.statSync(gitPath).isDirectory()
        ? path.join(gitPath, 'HEAD')
        : null;
      if (!headPath || !fs.existsSync(headPath)) return { repoPath: current, gitBranch: null };
      const head = fs.readFileSync(headPath, 'utf8').trim();
      return {
        repoPath: current,
        gitBranch: head.startsWith('ref: refs/heads/') ? head.slice('ref: refs/heads/'.length) : null,
      };
    }
    current = path.dirname(current);
  }
  return { repoPath: null, gitBranch: null };
}

function stripTerminalControlSequences(value: string): string {
  return value.replace(ANSI_PATTERN, '');
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function parseJsonLine(line: string): unknown | null {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((item) => {
      if (!item || typeof item !== 'object') return '';
      const record = item as Record<string, unknown>;
      return typeof record.text === 'string'
        ? record.text
        : typeof record.input_text === 'string'
          ? record.input_text
          : '';
    })
    .filter(Boolean)
    .join('\n');
}

function extractHistoryRecordText(record: unknown): { role: string; text: string } | null {
  if (!record || typeof record !== 'object') return null;
  const top = record as Record<string, unknown>;
  const type = top.type;
  const payload = top.payload;
  if (!payload || typeof payload !== 'object') return null;
  const body = payload as Record<string, unknown>;

  if (type === 'event_msg' && typeof body.message === 'string') {
    const eventType = typeof body.type === 'string'
      ? body.type
      : typeof body.kind === 'string'
        ? body.kind
        : 'event';
    const role = eventType === 'user_message'
      ? 'user'
      : eventType === 'agent_message'
        ? 'assistant'
        : 'status';
    return { role, text: body.message };
  }

  if (type === 'event_msg' && typeof body.last_agent_message === 'string') {
    return { role: 'assistant', text: body.last_agent_message };
  }

  if (type === 'response_item' && body.type === 'message') {
    const role = typeof body.role === 'string' ? body.role : 'message';
    const text = contentText(body.content);
    return text ? { role, text } : null;
  }

  return null;
}

function normalizePreviewText(value: string): string {
  return stripTerminalControlSequences(value)
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

function sanitizeLaunchCommand(input: unknown): string {
  if (typeof input !== 'string') return CODEX_COMMAND;
  const trimmed = input.replace(/[\r\n]+/g, ' ').trim();
  return SAFE_CODEX_LAUNCH_COMMAND_PATTERN.test(trimmed) ? trimmed : CODEX_COMMAND;
}

function formatHistoryPreview(records: Array<{ role: string; text: string }>, maxChars: number): string {
  const lines = records
    .map((record) => {
      const text = normalizePreviewText(record.text);
      if (!text) return '';
      return `${record.role}: ${text}`;
    })
    .filter(Boolean);
  const preview = lines.join('\n\n');
  return preview.length > maxChars ? preview.slice(preview.length - maxChars).trimStart() : preview;
}

function formatHistoryTitle(records: Array<{ role: string; text: string }>): string {
  const userRecord = records.find((record) => record.role === 'user' && record.text.trim());
  const firstRecord = userRecord ?? records.find((record) => record.text.trim());
  const title = firstRecord ? normalizePreviewText(firstRecord.text).split('\n').find(Boolean) ?? '' : '';
  return title.length > 96 ? `${title.slice(0, 93)}...` : title;
}

export function stripCodexInputPlaceholders(value: string): string {
  return CODEX_INPUT_PLACEHOLDERS.reduce((current, placeholder) => (
    current.replaceAll(placeholder, ' '.repeat(placeholder.length))
  ), value);
}

export function isCodexTerminalPromptReady(output: string, cwd: string): boolean {
  const visible = stripTerminalControlSequences(output);
  const cwdName = path.basename(cwd) || cwd;
  if (!visible.includes(cwdName)) return false;
  const lines = visible.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const lastLine = lines.at(-1) ?? '';
  return /(?:[$%#❯➜›])\s*$/.test(lastLine);
}

export class CodexTerminalManager {
  private readonly sessions = new Map<string, CodexTerminalSession>();
  private readonly defaultCwd: string;
  private readonly maxBufferBytes: number;
  private readonly spawnPty: typeof pty.spawn;
  private readonly provenanceFilePath: string;
  private readonly contextDirPath: string;
  private readonly sessionStateFilePath: string;
  private readonly transcriptDirPath: string;
  private readonly codexSessionsDirPath: string;
  private historyFileCache: { scannedAt: number; files: CodexHistoryFileEntry[] } | null = null;

  constructor(options: CodexTerminalManagerOptions) {
    this.defaultCwd = options.defaultCwd;
    this.maxBufferBytes = options.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES;
    this.spawnPty = options.spawnPty ?? pty.spawn;
    this.contextDirPath = options.contextDirPath ?? defaultContextDirPath();
    this.provenanceFilePath = options.provenanceFilePath ?? path.join(this.contextDirPath, 'session-provenance.json');
    this.sessionStateFilePath = options.sessionStateFilePath ?? path.join(this.contextDirPath, 'session-state.json');
    this.transcriptDirPath = options.transcriptDirPath ?? path.join(this.contextDirPath, 'transcripts');
    this.codexSessionsDirPath = options.codexSessionsDirPath ?? defaultCodexSessionsDirPath();
    this.loadPersistedSessions();
  }

  createSession(input: { cwd?: string; title?: string; cols?: number; rows?: number; auto?: boolean; launchCommand?: string } = {}): CodexTerminalSessionSummary {
    if (input.auto) {
      const existing = Array.from(this.sessions.values()).find((session) => !session.exitedAt && session.process);
      if (existing) return this.toSummary(existing);
    }
    const id = crypto.randomUUID();
    const cwd = input.cwd && isDirectory(input.cwd) ? input.cwd : this.defaultCwd;
    const title = input.title?.trim() || `Codex ${this.sessions.size + 1}`;
    const launchCommand = sanitizeLaunchCommand(input.launchCommand);
    const createdAt = new Date().toISOString();
    const transcriptPath = path.join(this.transcriptDirPath, `${id}.ansi`);
    const child = this.spawnPty(process.env.SHELL || '/bin/zsh', ['-l'], {
      name: 'xterm-256color',
      cols: input.cols ?? 100,
      rows: input.rows ?? 28,
      cwd,
      env: {
          ...process.env,
          PATH: commonInteractivePath(),
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
      },
    });

    const session: CodexTerminalSession = {
      id,
      title,
      cwd,
      engine: 'pty',
      createdAt,
      exitedAt: null,
      exitCode: null,
      restored: false,
      transcriptPath,
      attachedContexts: [],
      process: child,
      outputBuffer: '',
      codexLaunchTimer: null,
    };
    this.sessions.set(id, session);
    fs.mkdirSync(this.transcriptDirPath, { recursive: true });
    fs.writeFileSync(transcriptPath, '', 'utf8');
    this.persistSessionState();

    let didLaunchCodex = false;
    const launchCodex = () => {
      if (didLaunchCodex || session.exitedAt || !session.process) return;
      didLaunchCodex = true;
      if (session.codexLaunchTimer) {
        clearTimeout(session.codexLaunchTimer);
        session.codexLaunchTimer = null;
      }
      session.process.write(`${launchCommand}\r`);
    };
    session.codexLaunchTimer = setTimeout(launchCodex, CODEX_LAUNCH_FALLBACK_MS);

    child.onData((data) => {
      const displayData = stripCodexInputPlaceholders(data);
      session.outputBuffer = this.appendToBuffer(session.outputBuffer, displayData);
      try {
        fs.appendFileSync(transcriptPath, displayData, 'utf8');
      } catch {
        // Terminal output should keep flowing even if transcript persistence fails.
      }
      broadcast(CodexTerminalIPCChannels.DATA, { id, data: displayData });
      if (isCodexTerminalPromptReady(session.outputBuffer, cwd)) {
        launchCodex();
      }
    });
    child.onExit(({ exitCode }) => {
      if (session.codexLaunchTimer) {
        clearTimeout(session.codexLaunchTimer);
        session.codexLaunchTimer = null;
      }
      session.exitedAt = new Date().toISOString();
      session.exitCode = exitCode;
      this.persistSessionState();
      broadcast(CodexTerminalIPCChannels.EXIT, this.toSummary(session));
    });

    return this.toSummary(session);
  }

  listSessions(): CodexTerminalSessionSummary[] {
    return Array.from(this.sessions.values()).map((session) => this.toSummary(session));
  }

  listHistory(input: CodexTerminalHistoryListInput = {}): CodexTerminalHistoryEntry[] {
    const limit = clampInteger(input.limit, DEFAULT_HISTORY_LIMIT, 1, MAX_HISTORY_LIMIT);
    const query = input.query?.trim().toLocaleLowerCase() ?? '';
    const files = this.findHistoryFiles()
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const entries: CodexTerminalHistoryEntry[] = [];

    for (const file of files) {
      const entry = this.readHistoryEntry(file.filePath, file.updatedAt, file.sizeBytes);
      if (!entry) continue;
      const haystack = [
        entry.filePath,
        entry.fileName,
        entry.threadId ?? '',
        entry.title,
        entry.cwd ?? '',
        entry.preview,
      ].join('\n').toLocaleLowerCase();
      if (query && !haystack.includes(query)) continue;
      entries.push(entry);
      if (entries.length >= limit) break;
    }

    return entries;
  }

  readHistoryPreview(filePath: string, input: CodexTerminalHistoryPreviewInput = {}): CodexTerminalHistoryPreview | null {
    const safePath = this.resolveHistoryFilePath(filePath);
    if (!safePath) return null;
    let stat: fs.Stats;
    try {
      stat = fs.statSync(safePath);
    } catch {
      return null;
    }
    if (!stat.isFile() || !path.basename(safePath).startsWith('rollout-') || !safePath.endsWith('.jsonl')) return null;

    const maxBytes = clampInteger(input.maxBytes, DEFAULT_HISTORY_PREVIEW_BYTES, 4096, MAX_HISTORY_PREVIEW_BYTES);
    const content = this.readFileTail(safePath, maxBytes);
    if (content === null) return null;
    const metadata = this.readHistoryMetadata(safePath, HISTORY_SUMMARY_BYTES);
    const records = this.extractHistoryRecords(content.text, 24);

    return {
      filePath: safePath,
      threadId: metadata.threadId,
      title: formatHistoryTitle(records),
      cwd: metadata.cwd,
      startedAt: metadata.startedAt,
      updatedAt: stat.mtime.toISOString(),
      preview: formatHistoryPreview(records, maxBytes),
      truncated: content.truncated,
    };
  }

  getBuffer(id: string): string | null {
    return this.sessions.get(id)?.outputBuffer ?? null;
  }

  writeInput(id: string, data: string): boolean {
    const session = this.sessions.get(id);
    if (!session || session.exitedAt) return false;
    if (!session.process) return false;
    session.process.write(data);
    return true;
  }

  resize(id: string, cols: number, rows: number): boolean {
    const session = this.sessions.get(id);
    if (!session || session.exitedAt) return false;
    if (!session.process) return false;
    session.process.resize(cols, rows);
    return true;
  }

  kill(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    if (session.codexLaunchTimer) {
      clearTimeout(session.codexLaunchTimer);
      session.codexLaunchTimer = null;
    }
    if (!session.exitedAt && session.process) session.process.kill();
    this.sessions.delete(id);
    this.persistSessionState();
    return true;
  }

  rename(id: string, title: string): boolean {
    const session = this.sessions.get(id);
    const nextTitle = title.trim();
    if (!session || !nextTitle) return false;
    session.title = nextTitle.slice(0, 80);
    this.persistSessionState();
    return true;
  }

  attachPageContext(id: string, context: CodexTerminalPageContext, options: { notifyTerminal?: boolean } = {}): { ok: boolean; filePath?: string; prompt?: string; error?: string } {
    const session = this.sessions.get(id);
    if (!session || session.exitedAt) return { ok: false, error: 'Codex terminal session is not running.' };
    if (!session.process) return { ok: false, error: 'Codex terminal session is not running.' };
    const filePath = writePageContextBundle(this.contextDirPath, session.id, context);
    const gitInfo = resolveGitInfo(session.cwd);
    const existingContextIndex = session.attachedContexts.findIndex((attached) => attached.sourcePath === (context.path || 'unknown'));
    const existingContext = existingContextIndex >= 0 ? session.attachedContexts[existingContextIndex] : null;
    const attachedContext = {
      sessionId: session.id,
      sessionTitle: session.title,
      sessionCwd: session.cwd,
      launchedCommand: CODEX_COMMAND,
      repoPath: gitInfo.repoPath,
      gitBranch: gitInfo.gitBranch,
      filePath,
      title: context.title || 'Field Theory Page',
      sourcePath: context.path || 'unknown',
      kind: context.kind,
      attachedAt: existingContext?.attachedAt ?? new Date().toISOString(),
    };
    if (existingContextIndex >= 0) {
      session.attachedContexts = session.attachedContexts.map((current, index) => (
        index === existingContextIndex ? attachedContext : current
      ));
    } else {
      session.attachedContexts = [
        ...session.attachedContexts,
        attachedContext,
      ];
      this.appendProvenance(attachedContext);
    }
    this.persistSessionState();
    const shouldNotifyTerminal = options.notifyTerminal !== false && !existingContext;
    const prompt = shouldNotifyTerminal ? [
      `Field Theory attached live document context for: ${context.title || 'Field Theory Page'}`,
      `Source: ${context.path || 'unknown'}`,
      `Manifest: ${filePath}`,
      'Do not summarize or explain the attached context just because it exists.',
      'A short acknowledgement like "I am aware of this file" is enough unless the user asks for details.',
      'Read the manifest or content files only when the user asks something that needs document details.',
      '',
    ].join('\n') + '\r' : undefined;
    if (prompt) session.process?.write(prompt);
    return { ok: true, filePath, prompt };
  }

  destroy(): void {
    for (const session of this.sessions.values()) {
      if (!session.exitedAt) {
        session.exitedAt = new Date().toISOString();
        session.exitCode = null;
      }
      if (session.codexLaunchTimer) {
        clearTimeout(session.codexLaunchTimer);
        session.codexLaunchTimer = null;
      }
      if (session.process) session.process.kill();
      session.process = null;
      session.restored = true;
    }
    this.persistSessionState();
    this.sessions.clear();
  }

  private toSummary(session: CodexTerminalSession): CodexTerminalSessionSummary {
    const { id, title, cwd, engine, createdAt, exitedAt, exitCode, restored, transcriptPath, attachedContexts } = session;
    return { id, title, cwd, engine, createdAt, exitedAt, exitCode, restored, transcriptPath, attachedContexts };
  }

  private appendToBuffer(existing: string, chunk: string): string {
    const next = `${existing}${chunk}`;
    if (next.length <= this.maxBufferBytes) return next;
    return next.slice(next.length - this.maxBufferBytes);
  }

  private findHistoryFiles(): CodexHistoryFileEntry[] {
    const now = Date.now();
    if (this.historyFileCache && now - this.historyFileCache.scannedAt < HISTORY_FILE_CACHE_MS) {
      return this.historyFileCache.files;
    }
    const root = this.codexSessionsDirPath;
    const files: CodexHistoryFileEntry[] = [];
    const visit = (dir: string) => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const candidate = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          visit(candidate);
          continue;
        }
        if (!entry.isFile() || !entry.name.startsWith('rollout-') || !entry.name.endsWith('.jsonl')) continue;
        try {
          const stat = fs.statSync(candidate);
          files.push({ filePath: candidate, updatedAt: stat.mtime.toISOString(), sizeBytes: stat.size });
        } catch {
          // A session file can disappear while Codex is writing or pruning it.
        }
      }
    };
    visit(root);
    this.historyFileCache = { scannedAt: now, files };
    return files;
  }

  private resolveHistoryFilePath(filePath: string): string | null {
    if (typeof filePath !== 'string' || !filePath) return null;
    let root: string;
    let resolved: string;
    try {
      root = fs.realpathSync(this.codexSessionsDirPath);
      resolved = fs.realpathSync(path.resolve(filePath));
    } catch {
      return null;
    }
    const relative = path.relative(root, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
    return resolved;
  }

  private readHistoryEntry(filePath: string, updatedAt: string, sizeBytes: number): CodexTerminalHistoryEntry | null {
    const safePath = this.resolveHistoryFilePath(filePath);
    if (!safePath) return null;
    const content = this.readFileHead(safePath, HISTORY_SUMMARY_BYTES);
    if (content === null) return null;
    const metadata = this.readHistoryMetadata(safePath, HISTORY_SUMMARY_BYTES, content);
    const records = this.extractHistoryRecords(content, 5, 'first');
    return {
      filePath: safePath,
      fileName: path.basename(safePath),
      threadId: metadata.threadId,
      title: formatHistoryTitle(records),
      cwd: metadata.cwd,
      startedAt: metadata.startedAt,
      updatedAt,
      sizeBytes,
      preview: formatHistoryPreview(records, 1200),
    };
  }

  private readHistoryMetadata(filePath: string, maxBytes: number, content = this.readFileHead(filePath, maxBytes)): { threadId: string | null; cwd: string | null; startedAt: string | null } {
    if (content === null) return { threadId: null, cwd: null, startedAt: null };
    for (const line of content.split('\n')) {
      const record = parseJsonLine(line);
      if (!record || typeof record !== 'object') continue;
      const top = record as Record<string, unknown>;
      if (top.type !== 'session_meta' || !top.payload || typeof top.payload !== 'object') continue;
      const payload = top.payload as Record<string, unknown>;
      return {
        threadId: typeof payload.id === 'string' ? payload.id : null,
        cwd: typeof payload.cwd === 'string' ? payload.cwd : null,
        startedAt: typeof payload.timestamp === 'string' ? payload.timestamp : null,
      };
    }
    return { threadId: null, cwd: null, startedAt: null };
  }

  private extractHistoryRecords(content: string, limit: number, mode: 'first' | 'last' = 'last'): Array<{ role: string; text: string }> {
    const records: Array<{ role: string; text: string }> = [];
    for (const line of content.split('\n')) {
      const record = extractHistoryRecordText(parseJsonLine(line));
      if (!record) continue;
      if (mode === 'first' && records.length >= limit) break;
      records.push(record);
      if (mode === 'last' && records.length > limit) records.shift();
    }
    return records;
  }

  private readFileHead(filePath: string, maxBytes: number): string | null {
    try {
      const fd = fs.openSync(filePath, 'r');
      try {
        const buffer = Buffer.alloc(maxBytes);
        const bytesRead = fs.readSync(fd, buffer, 0, maxBytes, 0);
        return buffer.subarray(0, bytesRead).toString('utf8');
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      return null;
    }
  }

  private readFileTail(filePath: string, maxBytes: number): { text: string; truncated: boolean } | null {
    try {
      const stat = fs.statSync(filePath);
      const start = Math.max(0, stat.size - maxBytes);
      const length = stat.size - start;
      const fd = fs.openSync(filePath, 'r');
      try {
        const buffer = Buffer.alloc(length);
        const bytesRead = fs.readSync(fd, buffer, 0, length, start);
        let text = buffer.subarray(0, bytesRead).toString('utf8');
        if (start > 0) {
          const firstNewline = text.indexOf('\n');
          text = firstNewline >= 0 ? text.slice(firstNewline + 1) : '';
        }
        return { text, truncated: start > 0 };
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      return null;
    }
  }

  private appendProvenance(attachedContext: CodexTerminalAttachedContext): void {
    fs.mkdirSync(path.dirname(this.provenanceFilePath), { recursive: true });
    let existing: CodexTerminalAttachedContext[] = [];
    try {
      const parsed = JSON.parse(fs.readFileSync(this.provenanceFilePath, 'utf8'));
      if (Array.isArray(parsed)) existing = parsed;
    } catch {
      existing = [];
    }
    fs.writeFileSync(
      this.provenanceFilePath,
      `${JSON.stringify([...existing, attachedContext], null, 2)}\n`,
      'utf8',
    );
  }

  private loadPersistedSessions(): void {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.sessionStateFilePath, 'utf8')) as CodexTerminalSessionSummary[];
      if (!Array.isArray(parsed)) return;
      if (parsed.length > 0) this.persistSessionState();
    } catch {
      // No previous Codex terminal session state.
    }
  }

  private persistSessionState(): void {
    fs.mkdirSync(path.dirname(this.sessionStateFilePath), { recursive: true });
    const summaries = this.listSessions().slice(-MAX_PERSISTED_SESSIONS);
    fs.writeFileSync(this.sessionStateFilePath, `${JSON.stringify(summaries, null, 2)}\n`, 'utf8');
  }
}
