import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mockApp = vi.hoisted(() => ({
  getPath: vi.fn(),
}));
const mockShell = vi.hoisted(() => ({
  trashItem: vi.fn(),
}));

vi.mock('electron', () => ({
  app: mockApp,
  shell: mockShell,
}));

vi.mock('./logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { CommandsManager } from './commandsManager';
import { readDocumentVersion } from './documentSaveGuard';
import { shell } from 'electron';

describe('CommandsManager default internal commands', () => {
  let tempRoot: string;
  let manager: CommandsManager;
  let originalCommandsDir: string | undefined;

  const mockUserDataManager = {
    isLoggedIn: () => true,
    getUserDataPath: (subpath?: string) => {
      const base = join(tempRoot, 'app-data', 'users', 'user-1');
      return subpath ? join(base, subpath) : base;
    },
  };

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'commands-manager-test-'));
    originalCommandsDir = process.env.FT_COMMANDS_DIR;
    process.env.FT_COMMANDS_DIR = join(tempRoot, '.fieldtheory', 'library', 'Commands');
    mockApp.getPath.mockImplementation((name: string) => {
      if (name === 'userData') return join(tempRoot, 'app-data');
      if (name === 'home') return tempRoot;
      return tempRoot;
    });

    manager = new CommandsManager();
    manager.setUserDataManager(mockUserDataManager as any);
  });

  afterEach(async () => {
    await manager.onUserLoggedOut();
    if (originalCommandsDir === undefined) delete process.env.FT_COMMANDS_DIR;
    else process.env.FT_COMMANDS_DIR = originalCommandsDir;
    rmSync(tempRoot, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('creates the Field Theory default directory and seeds the built-in commands on first reinitialize', async () => {
    await manager.reinitializeForUser();

    const defaultDir = join(tempRoot, '.fieldtheory', 'library', 'Commands');
    expect(manager.getDefaultDirectory()).toBe(defaultDir);
    expect(manager.getWatchedDirs().map(dir => dir.path)).toContain(defaultDir);

    expect(readFileSync(join(defaultDir, 'refactor.md'), 'utf8')).toContain('kind: command');
    expect(readFileSync(join(defaultDir, 'refactor.md'), 'utf8')).toContain('Refactor those.');
    expect(readFileSync(join(defaultDir, 'review.md'), 'utf8')).toContain('Feel free to use the questions command');
    expect(readFileSync(join(defaultDir, 'questions.md'), 'utf8')).toContain('Ask me as many questions');
    expect(readFileSync(join(defaultDir, 'improve.md'), 'utf8')).toContain('Improve the selected text');
    expect(readFileSync(join(defaultDir, 'commit.md'), 'utf8')).toContain('# Remove AI code slop');

    expect(manager.getCommands().map(command => command.name).sort()).toEqual([
      'commit',
      'improve',
      'questions',
      'refactor',
      'review',
    ]);
  });

  it('does not overwrite an existing default commands directory that already has markdown commands', async () => {
    const defaultDir = join(tempRoot, '.fieldtheory', 'library', 'Commands');
    mkdirSync(defaultDir, { recursive: true });
    writeFileSync(join(defaultDir, 'custom.md'), '# Custom\n');

    const created = await manager.createDefaultDirectory();

    expect(created).toBe(defaultDir);
    expect(readFileSync(join(defaultDir, 'custom.md'), 'utf8')).toBe('# Custom\n');
    expect(() => readFileSync(join(defaultDir, 'refactor.md'), 'utf8')).toThrow();
    expect(manager.getCommands().map(command => command.name)).toEqual(['custom']);
  });

  it('drops the legacy commands root when moving the default under Library', async () => {
    const defaultDir = join(tempRoot, '.fieldtheory', 'library', 'Commands');
    const legacyDir = join(tempRoot, '.fieldtheory', 'commands');
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(join(legacyDir, 'legacy-only.md'), '# Legacy\n');

    await manager.reinitializeForUser();

    expect(manager.getWatchedDirs().map(dir => dir.path)).toEqual([defaultDir]);
    expect(manager.getCommands().map(command => command.name)).not.toContain('legacy-only');
    expect(existsSync(join(defaultDir, 'legacy-only.md'))).toBe(false);
  });

  it('prefers Library commands over duplicate legacy commands', async () => {
    const defaultDir = join(tempRoot, '.fieldtheory', 'library', 'Commands');
    const legacyDir = join(tempRoot, '.fieldtheory', 'commands');
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(join(legacyDir, 'refactor.md'), '# Old Refactor\n');

    await manager.reinitializeForUser();

    expect(manager.getWatchedDirs().map(dir => dir.path)).toEqual([defaultDir]);
    expect(manager.getCommand('refactor')?.filePath).toBe(join(defaultDir, 'refactor.md'));
  });

  it('rejects manually adding the legacy commands root', async () => {
    const defaultDir = join(tempRoot, '.fieldtheory', 'library', 'Commands');
    const legacyDir = join(tempRoot, '.fieldtheory', 'commands');
    const legacySubdir = join(legacyDir, 'nested');
    mkdirSync(legacyDir, { recursive: true });
    mkdirSync(legacySubdir, { recursive: true });
    writeFileSync(join(legacyDir, 'legacy-only.md'), '# Legacy\n');
    writeFileSync(join(legacySubdir, 'nested.md'), '# Nested Legacy\n');

    await manager.reinitializeForUser();
    await expect(manager.addWatchedDir(legacyDir)).resolves.toBeNull();
    await expect(manager.addWatchedDir(legacySubdir)).resolves.toBeNull();

    expect(manager.getWatchedDirs().map(dir => dir.path)).toEqual([defaultDir]);
    expect(manager.getCommands().map(command => command.name)).not.toContain('legacy-only');
    expect(manager.getCommands().map(command => command.name)).not.toContain('nested');
  });

  it('removes configured legacy commands instead of keeping them active', async () => {
    await manager.onUserLoggedOut();

    const defaultDir = join(tempRoot, '.fieldtheory', 'library', 'Commands');
    const legacyDir = join(tempRoot, '.fieldtheory', 'commands');
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(join(legacyDir, 'legacy-only.md'), '# Legacy\n');
    mkdirSync(join(tempRoot, 'app-data', 'users', 'user-1'), { recursive: true });
    writeFileSync(join(tempRoot, 'app-data', 'users', 'user-1', 'commands-settings.json'), JSON.stringify({
      watchedDirs: [legacyDir],
      mobileSyncDirs: [legacyDir],
    }, null, 2));

    manager = new CommandsManager();
    manager.setUserDataManager(mockUserDataManager as any);

    await manager.reinitializeForUser();

    expect(manager.getWatchedDirs().map(dir => dir.path)).toEqual([defaultDir]);
    expect(manager.getMobileSyncDirs()).toEqual([]);
    expect(manager.getCommands().map(command => command.name)).not.toContain('legacy-only');
    expect(readFileSync(join(defaultDir, 'refactor.md'), 'utf8')).toContain('kind: command');
    expect(existsSync(join(defaultDir, 'legacy-only.md'))).toBe(false);
  });

  it('reseeds and rescans when the default directory is already watched but currently empty', async () => {
    const defaultDir = join(tempRoot, '.fieldtheory', 'library', 'Commands');
    mkdirSync(defaultDir, { recursive: true });

    await manager.addWatchedDir(defaultDir);
    expect(manager.getCommands()).toEqual([]);

    const created = await manager.createDefaultDirectory();

    expect(created).toBe(defaultDir);
    expect(manager.getCommands().map(command => command.name).sort()).toEqual([
      'commit',
      'improve',
      'questions',
      'refactor',
      'review',
    ]);
  });

  it('rejects command names that would write outside the selected directory', async () => {
    const defaultDir = join(tempRoot, '.fieldtheory', 'library', 'Commands');
    mkdirSync(defaultDir, { recursive: true });
    await manager.addWatchedDir(defaultDir);

    expect(manager.createCommand(defaultDir, '../escape', 'bad')).toBeNull();
    expect(manager.createCommand(defaultDir, 'nested/escape', 'bad')).toBeNull();
    expect(manager.createCommand(defaultDir, '.hidden', 'bad')).toBeNull();

    expect(existsSync(join(tempRoot, '.fieldtheory', 'escape.md'))).toBe(false);
    expect(existsSync(join(defaultDir, 'nested', 'escape.md'))).toBe(false);
    expect(existsSync(join(defaultDir, '.hidden.md'))).toBe(false);
  });

  it('adds command frontmatter to newly created commands', async () => {
    const defaultDir = join(tempRoot, '.fieldtheory', 'library', 'Commands');
    mkdirSync(defaultDir, { recursive: true });
    await manager.addWatchedDir(defaultDir);

    const command = manager.createCommand(defaultDir, 'fresh', '# Fresh\n\nBody\n');

    expect(command).not.toBeNull();
    expect(readFileSync(command!.path, 'utf8')).toBe(
      '---\nkind: command\ntitle: "fresh"\nenabled: true\n---\n\n# Fresh\n\nBody\n'
    );
  });

  it('forces the command kind when created content has non-command frontmatter', async () => {
    const defaultDir = join(tempRoot, '.fieldtheory', 'library', 'Commands');
    mkdirSync(defaultDir, { recursive: true });
    await manager.addWatchedDir(defaultDir);

    const command = manager.createCommand(defaultDir, 'typed', '---\nkind: note\ntitle: Existing\n---\n\n# Typed\n');

    expect(command).not.toBeNull();
    expect(readFileSync(command!.path, 'utf8')).toBe(
      '---\ntitle: Existing\nkind: command\nenabled: true\n---\n\n# Typed\n'
    );
  });

  it('only saves commands inside watched directories', async () => {
    const defaultDir = join(tempRoot, '.fieldtheory', 'library', 'Commands');
    const outsidePath = join(tempRoot, 'outside.md');
    mkdirSync(defaultDir, { recursive: true });
    writeFileSync(outsidePath, 'original\n');
    await manager.addWatchedDir(defaultDir);

    expect(manager.saveCommand(outsidePath, 'changed\n')).toEqual({ ok: false, reason: 'not-found' });

    expect(readFileSync(outsidePath, 'utf8')).toBe('original\n');
  });

  it('reports a conflict when a command changed since it was opened', async () => {
    const defaultDir = join(tempRoot, '.fieldtheory', 'library', 'Commands');
    mkdirSync(defaultDir, { recursive: true });
    await manager.addWatchedDir(defaultDir);
    const command = manager.createCommand(defaultDir, 'conflict', 'original\n');

    expect(command).not.toBeNull();
    const expectedVersion = readDocumentVersion(command!.path);
    writeFileSync(command!.path, 'external\n');

    const result = manager.saveCommand(command!.path, 'mine\n', expectedVersion);

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      reason: 'conflict',
      currentContent: 'external\n',
    }));
    expect(readFileSync(command!.path, 'utf8')).toBe('external\n');
  });

  it('moves deleted commands to Trash only when they are inside a watched directory', async () => {
    const defaultDir = join(tempRoot, '.fieldtheory', 'library', 'Commands');
    const outsidePath = join(tempRoot, 'outside.md');
    mkdirSync(defaultDir, { recursive: true });
    writeFileSync(outsidePath, 'outside\n');
    await manager.addWatchedDir(defaultDir);
    const command = manager.createCommand(defaultDir, 'delete-me', 'delete\n');
    const trashItem = vi.mocked(shell.trashItem).mockResolvedValue(undefined);

    expect(command).not.toBeNull();
    await expect(manager.deleteCommand(command!.path)).resolves.toBe(true);
    expect(trashItem).toHaveBeenCalledWith(command!.path);

    trashItem.mockClear();
    await expect(manager.deleteCommand(outsidePath)).resolves.toBe(false);
    expect(trashItem).not.toHaveBeenCalled();
  });

  it('rejects command renames that would leave the watched directory', async () => {
    const defaultDir = join(tempRoot, '.fieldtheory', 'library', 'Commands');
    mkdirSync(defaultDir, { recursive: true });
    await manager.addWatchedDir(defaultDir);
    const command = manager.createCommand(defaultDir, 'inside', 'body\n');

    expect(command).not.toBeNull();
    expect(manager.renameCommand(command!.path, '../outside')).toBeNull();
    expect(manager.renameCommand(command!.path, 'nested/outside')).toBeNull();
    expect(existsSync(join(tempRoot, '.fieldtheory', 'outside.md'))).toBe(false);
    expect(existsSync(join(defaultDir, 'nested', 'outside.md'))).toBe(false);
  });
});
