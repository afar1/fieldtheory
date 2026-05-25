import { EventEmitter } from 'events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it, vi } from 'vitest';
import { CodexTerminalManager } from './codexTerminalManager';

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
    spawnPty: spawnPty as any,
  });
  return { manager, ptys, spawnPty };
}

describe('CodexTerminalManager', () => {
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

  it('loads persisted sessions as replay-only sessions with transcript buffer', () => {
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
      expect(manager.listSessions()).toMatchObject([
        { id: 'saved', title: 'Saved Codex', restored: true, exitedAt: '2026-05-25T00:01:00.000Z' },
      ]);
      expect(manager.getBuffer('saved')).toBe('old output');
      expect(manager.writeInput('saved', 'nope')).toBe(false);
    } finally {
      rmSync(libraryDir, { recursive: true, force: true });
    }
  });

  it('creates native Ghostty sessions as durable metadata without spawning a PTY', () => {
    const libraryDir = mkdtempSync(join(tmpdir(), 'codex-terminal-library-'));
    const sessionStateFilePath = join(libraryDir, 'Codex Context', 'session-state.json');
    const { manager, spawnPty } = createManager(1024, {
      contextDirPath: join(libraryDir, 'Codex Context'),
      sessionStateFilePath,
    });

    try {
      const session = manager.createSession({ nativeGhostty: true, title: 'Native Ghostty' });

      expect(spawnPty).not.toHaveBeenCalled();
      expect(session).toMatchObject({
        title: 'Native Ghostty',
        engine: 'nativeGhostty',
        restored: false,
        exitedAt: null,
      });
      expect(manager.writeInput(session.id, 'no pty')).toBe(false);
      expect(JSON.parse(readFileSync(sessionStateFilePath, 'utf8'))[0]).toMatchObject({
        id: session.id,
        engine: 'nativeGhostty',
      });
    } finally {
      rmSync(libraryDir, { recursive: true, force: true });
    }
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
      expect(ptys[0].written.at(-1)).toContain(`live Field Theory context at: ${result.filePath}`);
      expect(ptys[0].written.at(-1)).toContain('current document, selection, recent changes, and included pages');

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
    const session = manager.createSession({ nativeGhostty: true });

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

  it('attaches page context to native Ghostty sessions without requiring a PTY', () => {
    const libraryDir = mkdtempSync(join(tmpdir(), 'codex-terminal-library-'));
    const provenanceFilePath = join(libraryDir, 'Codex Context', 'session-provenance.json');
    const { manager, ptys } = createManager(1024, {
      provenanceFilePath,
      contextDirPath: join(libraryDir, 'Codex Context'),
    });
    const session = manager.createSession({ nativeGhostty: true, title: 'Native Context' });

    try {
      const result = manager.attachPageContext(session.id, {
        title: 'Native note',
        path: 'wiki://native-note',
        kind: 'wiki',
        contentMode: 'markdown',
        content: 'Use this with native Ghostty.',
      });

      expect(ptys).toHaveLength(0);
      expect(result.ok).toBe(true);
      expect(result.filePath).toBe(join(libraryDir, 'Codex Context', 'sessions', session.id, 'context.json'));
      expect(result.prompt).toContain(`live Field Theory context at: ${result.filePath}`);
      expect(manager.listSessions()[0].attachedContexts).toHaveLength(1);
      expect(JSON.parse(readFileSync(provenanceFilePath, 'utf8'))[0]).toMatchObject({
        sessionId: session.id,
        sessionTitle: 'Native Context',
        launchedCommand: 'codex',
        filePath: result.filePath,
        sourcePath: 'wiki://native-note',
      });
    } finally {
      rmSync(libraryDir, { recursive: true, force: true });
    }
  });

  it('persists native Ghostty text snapshots to the transcript path', () => {
    const libraryDir = mkdtempSync(join(tmpdir(), 'codex-terminal-library-'));
    const { manager } = createManager(1024, {
      contextDirPath: join(libraryDir, 'Codex Context'),
      transcriptDirPath: join(libraryDir, 'Codex Context', 'transcripts'),
      sessionStateFilePath: join(libraryDir, 'Codex Context', 'session-state.json'),
    });
    const session = manager.createSession({ nativeGhostty: true });

    try {
      expect(manager.persistNativeSnapshot(session.id, 'native ghostty screen\n')).toBe(true);
      expect(readFileSync(session.transcriptPath, 'utf8')).toBe('native ghostty screen\n');
      expect(manager.getBuffer(session.id)).toBe('native ghostty screen');
    } finally {
      rmSync(libraryDir, { recursive: true, force: true });
    }
  });

  it('does not persist native snapshots onto PTY sessions', () => {
    const { manager } = createManager();
    const session = manager.createSession();

    expect(manager.persistNativeSnapshot(session.id, 'wrong engine')).toBe(false);
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
    const session = manager.createSession({ title: 'Planning Codex' });

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
          sessionTitle: 'Planning Codex',
          sessionCwd: repoDir,
          launchedCommand: 'codex',
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
});
