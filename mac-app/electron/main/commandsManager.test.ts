import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
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

  it('uses the command basename for launcher labels when frontmatter title is stale', async () => {
    const defaultDir = join(tempRoot, '.fieldtheory', 'library', 'Commands');
    mkdirSync(defaultDir, { recursive: true });
    const filePath = join(defaultDir, 'entry.md');
    writeFileSync(filePath, '---\nkind: command\ntitle: "Wiki entry capture (Field Theory)"\nenabled: true\n---\n\nBody\n');
    await manager.addWatchedDir(defaultDir);

    expect(manager.getCommands()).toEqual([
      expect.objectContaining({
        name: 'entry',
        displayName: 'entry',
      }),
    ]);
    expect(readFileSync(filePath, 'utf8')).toContain('title: "Wiki entry capture (Field Theory)"');
  });

  it('keeps cached launcher command labels tied to the filename when a command title is saved', async () => {
    const defaultDir = join(tempRoot, '.fieldtheory', 'library', 'Commands');
    mkdirSync(defaultDir, { recursive: true });
    await manager.addWatchedDir(defaultDir);
    const command = manager.createCommand(defaultDir, 'rename-display', '---\ntitle: Old Name\n---\n\nBody\n');

    expect(command).not.toBeNull();
    const result = manager.saveCommand(command!.path, '---\ntitle: New Name\n---\n\nBody\n', readDocumentVersion(command!.path));

    expect(result.ok).toBe(true);
    expect(manager.getCommands()).toEqual([
      expect.objectContaining({
        name: 'rename-display',
        displayName: 'rename-display',
      }),
    ]);
  });

  it('lists command folders from watched directories including duplicate, empty, renamed, and missing folders', async () => {
    const defaultDir = join(tempRoot, '.fieldtheory', 'library', 'Commands');
    const emptyDir = join(defaultDir, 'Empty');
    const renamedDir = join(defaultDir, 'Renamed');
    const otherDir = join(tempRoot, 'Other Commands');
    const duplicateEmptyDir = join(otherDir, 'Empty');
    mkdirSync(emptyDir, { recursive: true });
    mkdirSync(duplicateEmptyDir, { recursive: true });
    await manager.addWatchedDir(defaultDir);
    await manager.addWatchedDir(otherDir);

    expect(manager.getCommandDirectories()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'Commands',
        displayName: 'Commands',
        directoryPath: defaultDir,
        directoryRelPath: '',
      }),
      expect.objectContaining({
        name: 'Empty',
        displayName: 'Empty',
        directoryPath: emptyDir,
        directoryRelPath: 'Empty',
      }),
      expect.objectContaining({
        name: 'Empty',
        displayName: 'Empty',
        directoryPath: duplicateEmptyDir,
        directoryRelPath: 'Empty',
      }),
    ]));

    renameSync(emptyDir, renamedDir);

    expect(manager.getCommandDirectories()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'Renamed',
        displayName: 'Renamed',
        directoryPath: renamedDir,
        directoryRelPath: 'Renamed',
      }),
    ]));
    expect(manager.getCommandDirectories().map(directory => directory.directoryPath)).not.toContain(emptyDir);

    rmSync(renamedDir, { recursive: true, force: true });
    expect(manager.getCommandDirectories().map(directory => directory.directoryPath)).not.toContain(renamedDir);
  });

  it('forces the command kind when created content has non-command frontmatter', async () => {
    const defaultDir = join(tempRoot, '.fieldtheory', 'library', 'Commands');
    mkdirSync(defaultDir, { recursive: true });
    await manager.addWatchedDir(defaultDir);

    const command = manager.createCommand(defaultDir, 'typed', '---\nkind: note\ntitle: Existing\n---\n\n# Typed\n');

    expect(command).not.toBeNull();
    expect(readFileSync(command!.path, 'utf8')).toBe(
      '---\nkind: command\ntitle: "typed"\nenabled: true\n---\n\n# Typed\n'
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

  it('updates command frontmatter title during app-driven renames', async () => {
    const defaultDir = join(tempRoot, '.fieldtheory', 'library', 'Commands');
    mkdirSync(defaultDir, { recursive: true });
    await manager.addWatchedDir(defaultDir);
    const command = manager.createCommand(defaultDir, 'wiki-entry-capture', '---\ntags: [capture]\ntitle: Old Title\n---\n\nBody\n');

    expect(command).not.toBeNull();
    const newPath = manager.renameCommand(command!.path, 'entry');

    expect(newPath).toBe(join(defaultDir, 'entry.md'));
    const renamedContent = readFileSync(newPath!, 'utf8');
    expect(renamedContent).toContain('tags: [capture]');
    expect(renamedContent).toContain('kind: command');
    expect(renamedContent).toContain('title: "entry"');
    expect(renamedContent).toContain('enabled: true');
    expect(renamedContent).not.toContain('Old Title');
    expect(manager.getCommands()).toEqual([
      expect.objectContaining({
        name: 'entry',
        displayName: 'entry',
        filePath: newPath,
      }),
    ]);
  });

  it('does not rewrite stale frontmatter titles from external command renames', async () => {
    const defaultDir = join(tempRoot, '.fieldtheory', 'library', 'Commands');
    mkdirSync(defaultDir, { recursive: true });
    const oldPath = join(defaultDir, 'Wiki entry capture (Field Theory).md');
    const newPath = join(defaultDir, 'entry.md');
    const content = '---\nkind: command\ntitle: "Wiki entry capture (Field Theory)"\nenabled: true\n---\n\nBody\n';
    writeFileSync(oldPath, content);
    await manager.addWatchedDir(defaultDir);

    renameSync(oldPath, newPath);
    await manager.refresh();

    expect(manager.getCommands()).toEqual([
      expect.objectContaining({
        name: 'entry',
        displayName: 'entry',
        filePath: newPath,
      }),
    ]);
    expect(readFileSync(newPath, 'utf8')).toBe(content);
  });
});
