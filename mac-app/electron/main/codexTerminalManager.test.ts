import { EventEmitter } from 'events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { basename, join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CodexTerminalManager, isCodexTerminalModelRunActive, isCodexTerminalPromptReady, stripCodexInputPlaceholders, stripPendingLaunchCommandEcho, type PendingLaunchEcho } from './codexTerminalManager';

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [],
  },
}));

class FakePty extends EventEmitter {
  written: string[] = [];
  killed = false;
  cols = 80;
  rows = 24;

  onData(callback: (data: string) => void): void {
    this.on('data', callback);
  }

  onExit(callback: (event: { exitCode: number }) => void): void {
    this.on('exit', callback);
  }

  write(data: string): void {
    this.written.push(data);
  }

  resize(cols: number, rows: number): void {
    this.cols = cols;
    this.rows = rows;
  }

  kill(): void {
    this.killed = true;
  }
}

function createManager(maxBufferBytes = 1024, input?: {
  defaultCwd?: string;
  provenanceFilePath?: string;
  contextDirPath?: string;
  sessionStateFilePath?: string;
  transcriptDirPath?: string;
  codexSessionsDirPath?: string;
}) {
  const ptys: FakePty[] = [];
  const spawnPty = vi.fn(() => {
    const fake = new FakePty();
    ptys.push(fake);
    return fake as any;
  });
  const manager = new CodexTerminalManager({
    defaultCwd: input?.defaultCwd ?? process.cwd(),
    maxBufferBytes,
    provenanceFilePath: input?.provenanceFilePath,
    contextDirPath: input?.contextDirPath,
    sessionStateFilePath: input?.sessionStateFilePath,
    transcriptDirPath: input?.transcriptDirPath,
    codexSessionsDirPath: input?.codexSessionsDirPath,
    spawnPty: spawnPty as any,
  });
  return { manager, ptys, spawnPty };
}

function promptFor(cwd: string): string {
  return `\r\n${basename(cwd)} › `;
}

describe('CodexTerminalManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('buffers PTY output so a renderer can replay scrollback after remount', () => {
    const { manager, ptys } = createManager();
    const session = manager.createSession();

    ptys[0].emit('data', 'hello ');
    ptys[0].emit('data', 'codex');

    expect(manager.getBuffer(session.id)).toBe('hello codex');
  });

  it('persists PTY output to a transcript file', () => {
    const libraryDir = mkdtempSync(join(tmpdir(), 'codex-terminal-library-'));
    const { manager, ptys } = createManager(1024, {
      contextDirPath: join(libraryDir, 'Codex Context'),
      transcriptDirPath: join(libraryDir, 'Codex Context', 'transcripts'),
      sessionStateFilePath: join(libraryDir, 'Codex Context', 'session-state.json'),
    });
    const session = manager.createSession();

    try {
      ptys[0].emit('data', 'persist me');

      expect(existsSync(session.transcriptPath)).toBe(true);
      expect(readFileSync(session.transcriptPath, 'utf8')).toBe('persist me');
    } finally {
      rmSync(libraryDir, { recursive: true, force: true });
    }
  });

  it('removes Codex empty-input placeholders from displayed terminal output', () => {
    expect(stripCodexInputPlaceholders('\x1b[1m›\x1b[22m \x1b[2mWrite tests for @filename')).toBe(`\x1b[1m›\x1b[22m \x1b[2m${' '.repeat('Write tests for @filename'.length)}`);
    expect(stripCodexInputPlaceholders('\x1b[1m›\x1b[22m \x1b[2mRun /review on my current changes')).toBe(`\x1b[1m›\x1b[22m \x1b[2m${' '.repeat('Run /review on my current changes'.length)}`);
  });

  it('buffers sanitized terminal output so placeholder text does not replay after remount', () => {
    const { manager, ptys } = createManager();
    const session = manager.createSession();

    ptys[0].emit('data', '\x1b[1m›\x1b[22m \x1b[2mRun /review on my current changes');

    expect(manager.getBuffer(session.id)).toBe(`\x1b[1m›\x1b[22m \x1b[2m${' '.repeat('Run /review on my current changes'.length)}`);
  });

  it('prunes persisted sessions on startup so old terminal tabs do not reopen', () => {
    const libraryDir = mkdtempSync(join(tmpdir(), 'codex-terminal-library-'));
    const contextDirPath = join(libraryDir, 'Codex Context');
    const transcriptDirPath = join(contextDirPath, 'transcripts');
    const sessionStateFilePath = join(contextDirPath, 'session-state.json');
    mkdirSync(transcriptDirPath, { recursive: true });
    const transcriptPath = join(transcriptDirPath, 'saved.ansi');
    writeFileSync(transcriptPath, 'old output', 'utf8');
    writeFileSync(sessionStateFilePath, JSON.stringify([
      {
        id: 'saved',
        title: 'Saved Codex',
        cwd: process.cwd(),
        engine: 'pty',
        createdAt: '2026-05-25T00:00:00.000Z',
        exitedAt: '2026-05-25T00:01:00.000Z',
        exitCode: null,
        restored: false,
        transcriptPath,
        attachedContexts: [],
      },
    ]), 'utf8');

    try {
      const { manager, spawnPty } = createManager(1024, {
        contextDirPath,
        transcriptDirPath,
        sessionStateFilePath,
      });

      expect(spawnPty).not.toHaveBeenCalled();
      expect(manager.listSessions()).toEqual([]);
      expect(JSON.parse(readFileSync(sessionStateFilePath, 'utf8'))).toEqual([]);
      expect(manager.writeInput('saved', 'nope')).toBe(false);
    } finally {
      rmSync(libraryDir, { recursive: true, force: true });
    }
  });

  it('prunes persisted native terminal sessions on startup', () => {
    const libraryDir = mkdtempSync(join(tmpdir(), 'codex-terminal-library-'));
    const contextDirPath = join(libraryDir, 'Codex Context');
    const transcriptDirPath = join(contextDirPath, 'transcripts');
    const sessionStateFilePath = join(contextDirPath, 'session-state.json');
    mkdirSync(transcriptDirPath, { recursive: true });
    const transcriptPath = join(transcriptDirPath, 'native.ansi');
    writeFileSync(transcriptPath, 'old native output', 'utf8');
    writeFileSync(sessionStateFilePath, JSON.stringify([
      {
        id: 'old-native',
        title: 'Old Native',
        cwd: process.cwd(),
        engine: 'nativeGhostty',
        createdAt: '2026-05-25T00:00:00.000Z',
        exitedAt: null,
        exitCode: null,
        restored: false,
        transcriptPath,
        attachedContexts: [],
      },
    ]), 'utf8');

    try {
      const { manager, spawnPty } = createManager(1024, {
        contextDirPath,
        transcriptDirPath,
        sessionStateFilePath,
      });

      expect(spawnPty).not.toHaveBeenCalled();
      expect(manager.listSessions()).toEqual([]);
      expect(JSON.parse(readFileSync(sessionStateFilePath, 'utf8'))).toEqual([]);
    } finally {
      rmSync(libraryDir, { recursive: true, force: true });
    }
  });

  it('reuses an active session for automatic startup creation', () => {
    const { manager, spawnPty } = createManager();
    const first = manager.createSession({ auto: true });
    const second = manager.createSession({ auto: true });

    expect(second.id).toBe(first.id);
    expect(spawnPty).toHaveBeenCalledTimes(1);
    expect(manager.listSessions()).toHaveLength(1);
  });

  it('starts a plain login shell by default', () => {
    const { manager, ptys, spawnPty } = createManager();
    manager.createSession();

    expect((spawnPty as any).mock.calls[0]?.[1]).toEqual(['-l']);
    expect(ptys[0].written).toEqual([]);
    ptys[0].emit('data', promptFor(process.cwd()));
    expect(ptys[0].written).toEqual([]);
  });

  it('starts Codex inside a login shell when a launch command is provided', () => {
    const { manager, ptys, spawnPty } = createManager();
    manager.createSession({ launchCommand: 'codex' });

    expect((spawnPty as any).mock.calls[0]?.[1]).toEqual(['-l']);
    expect(ptys[0].written).toEqual([]);
    ptys[0].emit('data', promptFor(process.cwd()));
    expect(ptys[0].written[0]).toBe('codex\r');
  });

  it('removes the automatically written Codex command echo from displayed output', () => {
    let pendingEcho: PendingLaunchEcho | null = { commandRemaining: 'codex', stripLineEnding: true };
    const first = stripPendingLaunchCommandEcho('co', pendingEcho);
    expect(first.value).toBe('');
    pendingEcho = first.pendingEcho;

    const second = stripPendingLaunchCommandEcho('dex\r\n\x1b[?1049hOpenAI Codex', pendingEcho);
    expect(second.value).toBe('\x1b[?1049hOpenAI Codex');
    expect(second.pendingEcho).toBeNull();
  });

  it('keeps real output if the pending launch echo does not finish matching', () => {
    const result = stripPendingLaunchCommandEcho('config loaded', { commandRemaining: 'codex', stripLineEnding: true });
    expect(result.value).toBe('config loaded');
    expect(result.pendingEcho).toBeNull();
  });

  it('does not keep the requested Codex launch echo in terminal scrollback', () => {
    const { manager, ptys } = createManager();
    const session = manager.createSession({ launchCommand: 'codex' });

    ptys[0].emit('data', promptFor(process.cwd()));
    ptys[0].emit('data', 'co');
    ptys[0].emit('data', 'dex\r\nOpenAI Codex');

    expect(manager.getBuffer(session.id)).toContain('OpenAI Codex');
    expect(manager.getBuffer(session.id)).not.toContain('codex\r\n');
  });

  it('can launch a Codex resume command for a new terminal session', () => {
    const { manager, ptys } = createManager();
    manager.createSession({ launchCommand: 'codex resume thread-1' });

    ptys[0].emit('data', promptFor(process.cwd()));

    expect(ptys[0].written[0]).toBe('codex resume thread-1\r');
  });

  it('falls back to plain Codex for unsafe launch commands', () => {
    const { manager, ptys } = createManager();
    manager.createSession({ launchCommand: 'codex resume thread-1; echo no' });

    ptys[0].emit('data', promptFor(process.cwd()));

    expect(ptys[0].written[0]).toBe('codex\r');
  });

  it('does not start Codex on the fallback timer for plain shell sessions', () => {
    const { manager, ptys } = createManager();
    manager.createSession();

    vi.advanceTimersByTime(1200);
    expect(ptys[0].written).toEqual([]);
  });

  it('falls back to starting Codex if a requested launch command waits on an undetected prompt', () => {
    const { manager, ptys } = createManager();
    manager.createSession({ launchCommand: 'codex' });

    vi.advanceTimersByTime(1199);
    expect(ptys[0].written).toEqual([]);

    vi.advanceTimersByTime(1);
    expect(ptys[0].written).toEqual(['codex\r']);
  });

  it('detects prompt readiness from the visible cwd prompt text', () => {
    expect(isCodexTerminalPromptReady(`\x1b[0m${basename(process.cwd())} › `, process.cwd())).toBe(true);
    expect(isCodexTerminalPromptReady('codex\r\ncodex\r\n', process.cwd())).toBe(false);
  });

  it('detects Codex model work from the latest terminal status', () => {
    expect(isCodexTerminalModelRunActive('› Fix this experimental · Working · 5h 99%')).toBe(true);
    expect(isCodexTerminalModelRunActive('⠠⠛ Running  3.11k tokens')).toBe(true);
    expect(isCodexTerminalModelRunActive('› Fix this experimental · Ready · 5h 99%')).toBe(false);
  });

  it('exposes active model work without treating an idle terminal as running work', () => {
    const { manager, ptys } = createManager();
    const session = manager.createSession();

    expect(manager.listSessions()[0]?.modelRunActive).toBe(false);
    ptys[0].emit('data', '› Fix this experimental · Working · 5h 99%');
    expect(manager.listSessions()[0]?.modelRunActive).toBe(true);
    ptys[0].emit('data', '› Fix this experimental · Ready · 5h 99%');
    expect(manager.listSessions()[0]?.modelRunActive).toBe(false);
    expect(manager.listSessions()[0]?.id).toBe(session.id);
  });

  it('keeps only the bounded tail of terminal output', () => {
    const { manager, ptys } = createManager(6);
    const session = manager.createSession();

    ptys[0].emit('data', 'abcdef');
    ptys[0].emit('data', 'ghij');

    expect(manager.getBuffer(session.id)).toBe('efghij');
  });

  it('writes page context prompts into the active PTY', () => {
    const previousLibraryDir = process.env.FT_LIBRARY_DIR;
    const libraryDir = mkdtempSync(join(tmpdir(), 'codex-terminal-library-'));
    process.env.FT_LIBRARY_DIR = libraryDir;
    const { manager, ptys } = createManager();
    const session = manager.createSession();

    try {
      const result = manager.attachPageContext(session.id, {
        title: 'Panel idea',
        path: '/tmp/panel.md',
        kind: 'external',
        contentMode: 'rendered',
        content: 'Use Codex here.',
      });

      expect(result.ok).toBe(true);
      expect(result.filePath).toBe(join(libraryDir, 'Codex Context', 'sessions', session.id, 'context.json'));
      expect(readFileSync(join(libraryDir, 'Codex Context', 'sessions', session.id, 'active.md'), 'utf8')).toBe('Use Codex here.');
      expect(readFileSync(join(libraryDir, 'Codex Context', 'sessions', session.id, 'recent.md'), 'utf8')).toBe('');
      expect(JSON.parse(readFileSync(result.filePath!, 'utf8'))).toMatchObject({
        activeDocument: {
          title: 'Panel idea',
          path: '/tmp/panel.md',
          kind: 'external',
          contentMode: 'rendered',
          contentPath: join(libraryDir, 'Codex Context', 'sessions', session.id, 'active.md'),
        },
        selection: null,
        recent: [],
        includedPages: [],
      });
      expect(manager.listSessions()[0].attachedContexts).toHaveLength(1);
      expect(manager.listSessions()[0].attachedContexts[0].sessionCwd).toBe(process.cwd());
      expect(manager.listSessions()[0].attachedContexts[0].filePath).toBe(result.filePath);
      expect(manager.listSessions()[0].restored).toBe(false);
      expect(ptys[0].written.at(-1)).toContain('Field Theory attached live document context for: Panel idea');
      expect(ptys[0].written.at(-1)).toContain(`Manifest: ${result.filePath}`);
      expect(ptys[0].written.at(-1)).toContain('Do not summarize or explain the attached context just because it exists.');
      expect(ptys[0].written.at(-1)).toContain('Read the manifest or content files only when the user asks something that needs document details.');

      const updatedResult = manager.attachPageContext(session.id, {
        title: 'Panel idea',
        path: '/tmp/panel.md',
        kind: 'external',
        contentMode: 'rendered',
        content: 'Updated live context.',
      });

      expect(updatedResult.filePath).toBe(result.filePath);
      expect(updatedResult.prompt).toBeUndefined();
      expect(readFileSync(join(libraryDir, 'Codex Context', 'sessions', session.id, 'active.md'), 'utf8')).toBe('Updated live context.');
      expect(manager.listSessions()[0].attachedContexts).toHaveLength(1);
      expect(ptys[0].written).toHaveLength(1);
    } finally {
      if (previousLibraryDir === undefined) {
        delete process.env.FT_LIBRARY_DIR;
      } else {
        process.env.FT_LIBRARY_DIR = previousLibraryDir;
      }
      rmSync(libraryDir, { recursive: true, force: true });
    }
  });

  it('writes selected page text beside the session context manifest', () => {
    const libraryDir = mkdtempSync(join(tmpdir(), 'codex-terminal-library-'));
    const contextDirPath = join(libraryDir, 'Codex Context');
    const { manager } = createManager(1024, {
      contextDirPath,
    });
    const session = manager.createSession();

    try {
      const result = manager.attachPageContext(session.id, {
        title: 'Selection note',
        path: 'wiki://selection-note',
        kind: 'wiki',
        contentMode: 'markdown',
        content: 'Full page text.',
        selectionText: 'Selected paragraph.',
      });
      const selectionPath = join(contextDirPath, 'sessions', session.id, 'selection.md');
      const manifest = JSON.parse(readFileSync(result.filePath!, 'utf8'));

      expect(result.ok).toBe(true);
      expect(readFileSync(selectionPath, 'utf8')).toBe('Selected paragraph.');
      expect(manifest.selection).toMatchObject({
        textPath: selectionPath,
        preview: 'Selected paragraph.',
      });

      const updatedResult = manager.attachPageContext(session.id, {
        title: 'Selection note',
        path: 'wiki://selection-note',
        kind: 'wiki',
        contentMode: 'markdown',
        content: 'Updated full page text.',
      });

      expect(updatedResult.filePath).toBe(result.filePath);
      expect(readFileSync(join(contextDirPath, 'sessions', session.id, 'active.md'), 'utf8')).toBe('Updated full page text.');
      expect(existsSync(selectionPath)).toBe(false);
    } finally {
      rmSync(libraryDir, { recursive: true, force: true });
    }
  });

  it('updates page context silently when terminal notification is disabled', () => {
    const libraryDir = mkdtempSync(join(tmpdir(), 'codex-terminal-library-'));
    const contextDirPath = join(libraryDir, 'Codex Context');
    const { manager, ptys } = createManager(1024, {
      contextDirPath,
    });
    const session = manager.createSession();

    try {
      const result = manager.attachPageContext(session.id, {
        title: 'Silent note',
        path: 'wiki://silent-note',
        kind: 'wiki',
        contentMode: 'markdown',
        content: 'Quiet context.',
      }, { notifyTerminal: false });

      expect(result.ok).toBe(true);
      expect(result.prompt).toBeUndefined();
      expect(readFileSync(join(contextDirPath, 'sessions', session.id, 'active.md'), 'utf8')).toBe('Quiet context.');
      expect(ptys[0].written).toEqual([]);
    } finally {
      rmSync(libraryDir, { recursive: true, force: true });
    }
  });

  it('persists attached context provenance to the Field Theory Library', () => {
    const libraryDir = mkdtempSync(join(tmpdir(), 'codex-terminal-library-'));
    const repoDir = mkdtempSync(join(tmpdir(), 'codex-terminal-repo-'));
    const provenanceFilePath = join(libraryDir, 'Codex Context', 'session-provenance.json');
    mkdirSync(join(repoDir, '.git'));
    writeFileSync(join(repoDir, '.git', 'HEAD'), 'ref: refs/heads/codex-panel\n');
    const { manager } = createManager(1024, {
      defaultCwd: repoDir,
      provenanceFilePath,
      contextDirPath: join(libraryDir, 'Codex Context'),
    });
    const session = manager.createSession({ title: 'Planning shell' });

    try {
      manager.attachPageContext(session.id, {
        title: 'Durable note',
        path: 'wiki://durable-note',
        kind: 'wiki',
        contentMode: 'markdown',
        content: 'Remember this attachment.',
      });

      const provenance = JSON.parse(readFileSync(provenanceFilePath, 'utf8'));
      expect(provenance).toMatchObject([
        {
          sessionId: session.id,
          sessionTitle: 'Planning shell',
          sessionCwd: repoDir,
          launchedCommand: 'shell',
          repoPath: repoDir,
          gitBranch: 'codex-panel',
          filePath: join(libraryDir, 'Codex Context', 'sessions', session.id, 'context.json'),
          sourcePath: 'wiki://durable-note',
          title: 'Durable note',
        },
      ]);
    } finally {
      rmSync(libraryDir, { recursive: true, force: true });
      rmSync(repoDir, { recursive: true, force: true });
    }
  });

  it('renames sessions and persists the new title', () => {
    const libraryDir = mkdtempSync(join(tmpdir(), 'codex-terminal-library-'));
    const sessionStateFilePath = join(libraryDir, 'Codex Context', 'session-state.json');
    const { manager } = createManager(1024, {
      contextDirPath: join(libraryDir, 'Codex Context'),
      sessionStateFilePath,
    });
    const session = manager.createSession();

    try {
      expect(manager.rename(session.id, 'Planning')).toBe(true);
      expect(manager.listSessions()[0].title).toBe('Planning');
      expect(JSON.parse(readFileSync(sessionStateFilePath, 'utf8'))[0].title).toBe('Planning');
    } finally {
      rmSync(libraryDir, { recursive: true, force: true });
    }
  });

  it('falls back to the default cwd when a requested cwd is not a directory', () => {
    const libraryDir = mkdtempSync(join(tmpdir(), 'codex-terminal-library-'));
    const defaultCwd = mkdtempSync(join(tmpdir(), 'codex-terminal-default-'));
    const filePath = join(libraryDir, 'not-a-directory');
    writeFileSync(filePath, 'plain file', 'utf8');
    const { manager } = createManager(1024, {
      defaultCwd,
      contextDirPath: join(libraryDir, 'Codex Context'),
    });

    try {
      const session = manager.createSession({ cwd: filePath });

      expect(session.cwd).toBe(defaultCwd);
    } finally {
      rmSync(libraryDir, { recursive: true, force: true });
      rmSync(defaultCwd, { recursive: true, force: true });
    }
  });

  it('lists and searches Codex JSONL history without importing it into the library', () => {
    const libraryDir = mkdtempSync(join(tmpdir(), 'codex-terminal-library-'));
    const sessionsDir = mkdtempSync(join(tmpdir(), 'codex-sessions-'));
    const sessionDayDir = join(sessionsDir, '2026', '05', '26');
    mkdirSync(sessionDayDir, { recursive: true });
    const historyPath = join(sessionDayDir, 'rollout-2026-05-26T10-00-00-thread.jsonl');
    writeFileSync(historyPath, [
      JSON.stringify({
        type: 'session_meta',
        payload: {
          id: 'thread-1',
          timestamp: '2026-05-26T10:00:00.000Z',
          cwd: '/Users/afar/dev/fieldtheory',
        },
      }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'build terminal history overlay' } }),
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'wire a read-only preview API' }],
        },
      }),
    ].join('\n'), 'utf8');

    try {
      const { manager } = createManager(1024, {
        contextDirPath: join(libraryDir, 'Codex Context'),
        codexSessionsDirPath: sessionsDir,
      });

      const entries = manager.listHistory({ query: 'preview API' });

      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        filePath: realpathSync(historyPath),
        fileName: 'rollout-2026-05-26T10-00-00-thread.jsonl',
        threadId: 'thread-1',
        title: 'build terminal history overlay',
        cwd: '/Users/afar/dev/fieldtheory',
        startedAt: '2026-05-26T10:00:00.000Z',
      });
      expect(entries[0].preview).toContain('user: build terminal history overlay');
      expect(entries[0].preview).toContain('assistant: wire a read-only preview API');
      expect(existsSync(join(libraryDir, 'Codex Context', 'sessions'))).toBe(false);
    } finally {
      rmSync(libraryDir, { recursive: true, force: true });
      rmSync(sessionsDir, { recursive: true, force: true });
    }
  });

  it('uses the first user message for history titles instead of later repeated turns', () => {
    const sessionsDir = mkdtempSync(join(tmpdir(), 'codex-sessions-'));
    const sessionDayDir = join(sessionsDir, '2026', '05', '26');
    mkdirSync(sessionDayDir, { recursive: true });
    const historyPath = join(sessionDayDir, 'rollout-2026-05-26T19-01-02-thread.jsonl');
    writeFileSync(historyPath, [
      JSON.stringify({
        type: 'session_meta',
        payload: {
          id: 'thread-3',
          timestamp: '2026-05-26T19:01:02.000Z',
          cwd: '/Users/afar/dev/fieldtheory',
        },
      }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'first visual typing lag request' } }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message', message: 'I will inspect the renderer path.' } }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'be a good engineer here. find the most elegant solution.' } }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'be a good engineer here. find the most elegant solution.' } }),
    ].join('\n'), 'utf8');

    try {
      const { manager } = createManager(1024, {
        codexSessionsDirPath: sessionsDir,
      });

      const entries = manager.listHistory();

      expect(entries[0]).toMatchObject({
        filePath: realpathSync(historyPath),
        title: 'first visual typing lag request',
      });
      expect(entries[0].preview).toContain('user: first visual typing lag request');
    } finally {
      rmSync(sessionsDir, { recursive: true, force: true });
    }
  });

  it('reads previews only for Codex history files inside the sessions directory', () => {
    const sessionsDir = mkdtempSync(join(tmpdir(), 'codex-sessions-'));
    const sessionDayDir = join(sessionsDir, '2026', '05', '26');
    mkdirSync(sessionDayDir, { recursive: true });
    const historyPath = join(sessionDayDir, 'rollout-2026-05-26T11-00-00-thread.jsonl');
    const outsidePath = join(tmpdir(), 'rollout-outside.jsonl');
    const symlinkPath = join(sessionDayDir, 'rollout-symlink.jsonl');
    writeFileSync(historyPath, [
      JSON.stringify({
        type: 'session_meta',
        payload: {
          id: 'thread-2',
          timestamp: '2026-05-26T11:00:00.000Z',
          cwd: '/tmp/project',
        },
      }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'show recent transcript' } }),
    ].join('\n'), 'utf8');
    writeFileSync(outsidePath, '{}\n', 'utf8');
    symlinkSync(outsidePath, symlinkPath);

    try {
      const { manager } = createManager(1024, {
        codexSessionsDirPath: sessionsDir,
      });

      expect(manager.readHistoryPreview(outsidePath)).toBeNull();
      expect(manager.readHistoryPreview(symlinkPath)).toBeNull();
      expect(manager.readHistoryPreview(join(sessionDayDir, 'not-rollout.jsonl'))).toBeNull();
      expect(manager.readHistoryPreview(historyPath)).toMatchObject({
        filePath: realpathSync(historyPath),
        threadId: 'thread-2',
        cwd: '/tmp/project',
        startedAt: '2026-05-26T11:00:00.000Z',
        preview: 'user: show recent transcript',
        truncated: false,
      });
    } finally {
      rmSync(sessionsDir, { recursive: true, force: true });
      rmSync(outsidePath, { force: true });
    }
  });
});
