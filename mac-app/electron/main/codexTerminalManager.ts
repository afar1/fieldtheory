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

interface CodexTerminalSession extends CodexTerminalSessionSummary {
  process: pty.IPty | null;
  outputBuffer: string;
}

interface CodexTerminalManagerOptions {
  defaultCwd: string;
  maxBufferBytes?: number;
  spawnPty?: typeof pty.spawn;
  provenanceFilePath?: string;
  contextDirPath?: string;
  sessionStateFilePath?: string;
  transcriptDirPath?: string;
}

const DEFAULT_MAX_BUFFER_BYTES = 512 * 1024;
const MAX_PERSISTED_SESSIONS = 24;
const CODEX_COMMAND = 'codex';

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

export class CodexTerminalManager {
  private readonly sessions = new Map<string, CodexTerminalSession>();
  private readonly defaultCwd: string;
  private readonly maxBufferBytes: number;
  private readonly spawnPty: typeof pty.spawn;
  private readonly provenanceFilePath: string;
  private readonly contextDirPath: string;
  private readonly sessionStateFilePath: string;
  private readonly transcriptDirPath: string;

  constructor(options: CodexTerminalManagerOptions) {
    this.defaultCwd = options.defaultCwd;
    this.maxBufferBytes = options.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES;
    this.spawnPty = options.spawnPty ?? pty.spawn;
    this.contextDirPath = options.contextDirPath ?? defaultContextDirPath();
    this.provenanceFilePath = options.provenanceFilePath ?? path.join(this.contextDirPath, 'session-provenance.json');
    this.sessionStateFilePath = options.sessionStateFilePath ?? path.join(this.contextDirPath, 'session-state.json');
    this.transcriptDirPath = options.transcriptDirPath ?? path.join(this.contextDirPath, 'transcripts');
    this.loadPersistedSessions();
  }

  createSession(input: { cwd?: string; title?: string; cols?: number; rows?: number; auto?: boolean } = {}): CodexTerminalSessionSummary {
    if (input.auto) {
      const existing = Array.from(this.sessions.values()).find((session) => !session.exitedAt && session.process);
      if (existing) return this.toSummary(existing);
    }
    const id = crypto.randomUUID();
    const cwd = input.cwd && isDirectory(input.cwd) ? input.cwd : this.defaultCwd;
    const title = input.title?.trim() || `Codex ${this.sessions.size + 1}`;
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
    };
    this.sessions.set(id, session);
    fs.mkdirSync(this.transcriptDirPath, { recursive: true });
    fs.writeFileSync(transcriptPath, '', 'utf8');
    this.persistSessionState();

    child.onData((data) => {
      session.outputBuffer = this.appendToBuffer(session.outputBuffer, data);
      try {
        fs.appendFileSync(transcriptPath, data, 'utf8');
      } catch {
        // Terminal output should keep flowing even if transcript persistence fails.
      }
      broadcast(CodexTerminalIPCChannels.DATA, { id, data });
    });
    child.onExit(({ exitCode }) => {
      session.exitedAt = new Date().toISOString();
      session.exitCode = exitCode;
      this.persistSessionState();
      broadcast(CodexTerminalIPCChannels.EXIT, this.toSummary(session));
    });
    child.write(`${CODEX_COMMAND}\r`);

    return this.toSummary(session);
  }

  listSessions(): CodexTerminalSessionSummary[] {
    return Array.from(this.sessions.values()).map((session) => this.toSummary(session));
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
