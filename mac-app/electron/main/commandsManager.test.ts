import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mockApp = vi.hoisted(() => ({
  getPath: vi.fn(),
}));

vi.mock('electron', () => ({
  app: mockApp,
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
    process.env.FT_COMMANDS_DIR = join(tempRoot, '.fieldtheory', 'commands');
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

    const defaultDir = join(tempRoot, '.fieldtheory', 'commands');
    expect(manager.getDefaultDirectory()).toBe(defaultDir);
    expect(manager.getWatchedDirs().map(dir => dir.path)).toContain(defaultDir);

    expect(readFileSync(join(defaultDir, 'refactor.md'), 'utf8')).toContain('Refactor those.');
    expect(readFileSync(join(defaultDir, 'review.md'), 'utf8')).toContain('Feel free to use the questions command');
    expect(readFileSync(join(defaultDir, 'questions.md'), 'utf8')).toContain('Ask me as many questions');
    expect(readFileSync(join(defaultDir, 'commit.md'), 'utf8')).toContain('# Remove AI code slop');

    expect(manager.getCommands().map(command => command.name).sort()).toEqual([
      'commit',
      'questions',
      'refactor',
      'review',
    ]);
  });

  it('does not overwrite an existing default commands directory that already has markdown commands', async () => {
    const defaultDir = join(tempRoot, '.fieldtheory', 'commands');
    mkdirSync(defaultDir, { recursive: true });
    writeFileSync(join(defaultDir, 'custom.md'), '# Custom\n');

    const created = await manager.createDefaultDirectory();

    expect(created).toBe(defaultDir);
    expect(readFileSync(join(defaultDir, 'custom.md'), 'utf8')).toBe('# Custom\n');
    expect(() => readFileSync(join(defaultDir, 'refactor.md'), 'utf8')).toThrow();
    expect(manager.getCommands().map(command => command.name)).toEqual(['custom']);
  });

  it('reseeds and rescans when the default directory is already watched but currently empty', async () => {
    const defaultDir = join(tempRoot, '.fieldtheory', 'commands');
    mkdirSync(defaultDir, { recursive: true });

    await manager.addWatchedDir(defaultDir);
    expect(manager.getCommands()).toEqual([]);

    const created = await manager.createDefaultDirectory();

    expect(created).toBe(defaultDir);
    expect(manager.getCommands().map(command => command.name).sort()).toEqual([
      'commit',
      'questions',
      'refactor',
      'review',
    ]);
  });
});
