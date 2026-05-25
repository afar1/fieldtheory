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
  GHOSTTY_STATUS: 'codexTerminal:ghosttyStatus',
  NATIVE_GHOSTTY_HOST_STATUS: 'codexTerminal:nativeGhosttyHostStatus',
  NATIVE_GHOSTTY_ATTACH: 'codexTerminal:nativeGhosttyAttach',
  NATIVE_GHOSTTY_UPDATE_FRAME: 'codexTerminal:nativeGhosttyUpdateFrame',
  NATIVE_GHOSTTY_SEND_TEXT: 'codexTerminal:nativeGhosttySendText',
  NATIVE_GHOSTTY_SEND_KEY: 'codexTerminal:nativeGhosttySendKey',
  NATIVE_GHOSTTY_SNAPSHOT: 'codexTerminal:nativeGhosttySnapshot',
  NATIVE_GHOSTTY_DETACH: 'codexTerminal:nativeGhosttyDetach',
  ATTACH_PAGE_CONTEXT: 'codexTerminal:attachPageContext',
  DATA: 'codexTerminal:data',
  EXIT: 'codexTerminal:exit',
  SESSIONS_CHANGED: 'codexTerminal:sessionsChanged',
} as const;

export interface CodexTerminalSessionSummary {
  id: string;
  title: string;
  cwd: string;
  engine: 'pty' | 'nativeGhostty';
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

function writePageContextFile(contextDirPath: string, context: CodexTerminalPageContext): string {
  const dir = contextDirPath;
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeTitle = (context.title || 'Field Theory Page')
    .replace(/[^\w\s.-]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 80) || 'Field Theory Page';
  const filePath = path.join(dir, `${stamp} ${safeTitle}.md`);
  const selectionBlock = context.selectionText?.trim()
    ? `\n**Selected Text**\n\n${context.selectionText.trim()}\n`
    : '';
  const body = [
    `**${context.title || 'Field Theory Page'}**`,
    '',
    `*Captured for Codex: ${new Date().toISOString()}*`,
    '',
    `- Source path: \`${context.path || 'unknown'}\``,
    `- Source kind: \`${context.kind}\``,
    `- Content mode: \`${context.contentMode || 'unknown'}\``,
    selectionBlock,
    '**Page Content**',
    '',
    context.content || '',
    '',
  ].join('\n');
  fs.writeFileSync(filePath, body, 'utf8');
  return filePath;
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

  createSession(input: { cwd?: string; title?: string; cols?: number; rows?: number; nativeGhostty?: boolean } = {}): CodexTerminalSessionSummary {
    const id = crypto.randomUUID();
    const cwd = input.cwd && isDirectory(input.cwd) ? input.cwd : this.defaultCwd;
    const title = input.title?.trim() || `Codex ${this.sessions.size + 1}`;
    const createdAt = new Date().toISOString();
    const transcriptPath = path.join(this.transcriptDirPath, `${id}.ansi`);
    const child = input.nativeGhostty ? null : this.spawnPty(process.env.SHELL || '/bin/zsh', ['-l', '-c', CODEX_COMMAND], {
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
      engine: input.nativeGhostty ? 'nativeGhostty' : 'pty',
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

    if (!child) return this.toSummary(session);

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

  persistNativeSnapshot(id: string, text: string): boolean {
    const session = this.sessions.get(id);
    if (!session || session.engine !== 'nativeGhostty') return false;
    const snapshot = text.trimEnd();
    session.outputBuffer = this.appendToBuffer('', snapshot);
    fs.mkdirSync(this.transcriptDirPath, { recursive: true });
    fs.writeFileSync(session.transcriptPath, snapshot ? `${snapshot}\n` : '', 'utf8');
    this.persistSessionState();
    return true;
  }

  attachPageContext(id: string, context: CodexTerminalPageContext): { ok: boolean; filePath?: string; prompt?: string; error?: string } {
    const session = this.sessions.get(id);
    if (!session || session.exitedAt) return { ok: false, error: 'Codex terminal session is not running.' };
    if (!session.process && session.engine !== 'nativeGhostty') return { ok: false, error: 'Codex terminal session is not running.' };
    const filePath = writePageContextFile(this.contextDirPath, context);
    const gitInfo = resolveGitInfo(session.cwd);
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
      attachedAt: new Date().toISOString(),
    };
    session.attachedContexts = [
      ...session.attachedContexts,
      attachedContext,
    ];
    this.appendProvenance(attachedContext);
    this.persistSessionState();
    const prompt = `Please include this Field Theory page as context: ${filePath}\r`;
    session.process?.write(prompt);
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
      for (const summary of parsed.slice(-MAX_PERSISTED_SESSIONS)) {
        if (!summary.id || !summary.cwd || !summary.transcriptPath) continue;
        const outputBuffer = fs.existsSync(summary.transcriptPath)
          ? this.appendToBuffer('', fs.readFileSync(summary.transcriptPath, 'utf8'))
          : '';
        this.sessions.set(summary.id, {
          ...summary,
          engine: summary.engine ?? 'pty',
          exitedAt: summary.exitedAt ?? new Date().toISOString(),
          exitCode: summary.exitCode ?? null,
          restored: true,
          attachedContexts: Array.isArray(summary.attachedContexts) ? summary.attachedContexts : [],
          process: null,
          outputBuffer,
        });
      }
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
