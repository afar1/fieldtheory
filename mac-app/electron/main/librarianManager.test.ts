import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const electronMocks = vi.hoisted(() => ({
  trashItem: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => name === 'home' ? (process.env.HOME ?? '/tmp') : '/tmp',
  },
  shell: {
    trashItem: electronMocks.trashItem,
  },
}));

import { shell } from 'electron';
import {
  buildEffectiveArtifactRuleContent,
  defaultScratchpadName,
  defaultScratchpadNameWithTime,
  extractArtifactModelSignature,
  hasArtifactStructureInstruction,
  hasArtifactTitleInstruction,
  hasArtifactModelSignatureInstruction,
  isHiddenWikiFileName,
  isHiddenWikiFolderName,
  LibrarianManager,
  parseMarkdownHeader,
  type WikiNode,
} from './librarianManager';

const tempDirs: string[] = [];

afterEach(() => {
  vi.clearAllMocks();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('defaultScratchpadName', () => {
  it('formats as "<Day> <Mon> <Nth>" with correct ordinal suffix', () => {
    // Monday, April 20th, 2026 — "th" suffix (regular case)
    expect(defaultScratchpadName(new Date(2026, 3, 20))).toBe('Monday Apr 20th');
    // 1st / 2nd / 3rd special cases
    expect(defaultScratchpadName(new Date(2026, 0, 1))).toBe('Thursday Jan 1st');
    expect(defaultScratchpadName(new Date(2026, 0, 2))).toBe('Friday Jan 2nd');
    expect(defaultScratchpadName(new Date(2026, 0, 3))).toBe('Saturday Jan 3rd');
    // 11th / 12th / 13th stay "th" — don't incorrectly map to st/nd/rd.
    expect(defaultScratchpadName(new Date(2026, 0, 11))).toBe('Sunday Jan 11th');
    expect(defaultScratchpadName(new Date(2026, 0, 12))).toBe('Monday Jan 12th');
    expect(defaultScratchpadName(new Date(2026, 0, 13))).toBe('Tuesday Jan 13th');
    // 21st, 22nd, 23rd go back to st/nd/rd.
    expect(defaultScratchpadName(new Date(2026, 0, 21))).toBe('Wednesday Jan 21st');
    expect(defaultScratchpadName(new Date(2026, 0, 22))).toBe('Thursday Jan 22nd');
    expect(defaultScratchpadName(new Date(2026, 0, 23))).toBe('Friday Jan 23rd');
  });
});

describe('defaultScratchpadNameWithTime', () => {
  it('appends 12-hour clock time as a collision fallback', () => {
    expect(defaultScratchpadNameWithTime(new Date(2026, 3, 20, 9, 5))).toBe('Monday Apr 20th at 9:05am');
    expect(defaultScratchpadNameWithTime(new Date(2026, 3, 20, 13, 45))).toBe('Monday Apr 20th at 1:45pm');
    // Noon and midnight edge cases — both render as 12.
    expect(defaultScratchpadNameWithTime(new Date(2026, 3, 20, 0, 0))).toBe('Monday Apr 20th at 12:00am');
    expect(defaultScratchpadNameWithTime(new Date(2026, 3, 20, 12, 0))).toBe('Monday Apr 20th at 12:00pm');
  });
});

describe('parseMarkdownHeader', () => {
  it('extracts H1 title', () => {
    const content = '# The Adversarial Collaborator\n\nSome body text.';
    expect(parseMarkdownHeader(content).title).toBe('The Adversarial Collaborator');
  });

  it('extracts H2 title', () => {
    const content = "## Lamarck's Revenge\n\nBody text here.";
    expect(parseMarkdownHeader(content).title).toBe("Lamarck's Revenge");
  });

  it('extracts H3 title', () => {
    const content = '### A Smaller Heading\n\nBody.';
    expect(parseMarkdownHeader(content).title).toBe('A Smaller Heading');
  });

  it('ignores H4+ headings', () => {
    const content = '#### Too Deep\n\nBody.';
    expect(parseMarkdownHeader(content).title).toBe('Untitled Reading');
  });

  it('returns Untitled Reading when no heading exists', () => {
    const content = 'In 1962, John Glenn orbited Earth three times.\n\nNo heading here.';
    expect(parseMarkdownHeader(content).title).toBe('Untitled Reading');
  });

  it('uses first heading only', () => {
    const content = '# First Title\n\n## Second Title\n\nBody.';
    expect(parseMarkdownHeader(content).title).toBe('First Title');
  });

  it('skips blank lines before heading', () => {
    const content = '\n\n# After Blanks\n\nBody.';
    expect(parseMarkdownHeader(content).title).toBe('After Blanks');
  });

  it('extracts reading time', () => {
    const content = '# Title\n\n*Reading time: ~4 minutes*';
    const result = parseMarkdownHeader(content);
    expect(result.title).toBe('Title');
    expect(result.readingTime).toBe('~4 minutes');
  });

  it('extracts context', () => {
    const content = '# Title\n\n*Context: Auth architecture refactoring*';
    const result = parseMarkdownHeader(content);
    expect(result.context).toBe('Auth architecture refactoring');
  });

  it('extracts model signature', () => {
    const content = '# Title\n\n*Model: GPT-5 Codex*';
    const result = parseMarkdownHeader(content);
    expect(result.modelSignature).toBe('GPT-5 Codex');
  });

  it('extracts signed-by signature alias', () => {
    const content = '# Title\n\n*Signed by: Claude Sonnet*';
    const result = parseMarkdownHeader(content);
    expect(result.modelSignature).toBe('Claude Sonnet');
  });

  it('finds metadata after a braille art block', () => {
    const art = Array.from({ length: 15 }, () => '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀').join('\n');
    const content = `# Title\n\n${art}\n\n*Model: GPT-5 Codex*\n*Context: Artifact signing*\n*Reading time: ~2 minutes*\n\nBody.`;
    const result = parseMarkdownHeader(content);
    expect(result.modelSignature).toBe('GPT-5 Codex');
    expect(result.context).toBe('Artifact signing');
    expect(result.readingTime).toBe('~2 minutes');
  });

  it('does not match hashtags without space', () => {
    const content = '#not-a-heading\n\nBody.';
    expect(parseMarkdownHeader(content).title).toBe('Untitled Reading');
  });
});

describe('artifact signature helpers', () => {
  it('extracts signature metadata from supported header lines', () => {
    expect(extractArtifactModelSignature('*Model: GPT-5 Codex*')).toBe('GPT-5 Codex');
    expect(extractArtifactModelSignature('*Signed by: Claude Sonnet*')).toBe('Claude Sonnet');
  });

  it('detects when rule content already includes signature instructions', () => {
    expect(hasArtifactModelSignatureInstruction('Required metadata: *Model: GPT-5 Codex*')).toBe(true);
    expect(hasArtifactModelSignatureInstruction('Write a short reflective story.')).toBe(false);
  });

  it('detects when rule content includes artifact title/structure instructions', () => {
    expect(hasArtifactTitleInstruction('Structure:\n1. Title (# heading)\n2. Signature metadata line: *Model: GPT-5 Codex*')).toBe(true);
    expect(hasArtifactStructureInstruction('Structure:\n1. Title (# heading)\n2. Signature metadata line: *Model: GPT-5 Codex*')).toBe(true);
    expect(hasArtifactStructureInstruction('Write a short reflective story.')).toBe(false);
  });

  it('appends artifact structure requirements when the rule only asks for prose', () => {
    const result = buildEffectiveArtifactRuleContent('Write a short reflective story.');
    expect(result).toContain('Title (# heading)');
    expect(result).toContain('Signature metadata line');
    expect(result).toContain('*Model: <the exact model or assistant name that wrote this artifact>*');
  });

  it('preserves explicit title instructions while still appending signature metadata when needed', () => {
    const result = buildEffectiveArtifactRuleContent('Start with a markdown H1 title, then write the story body.');
    expect(result).toContain('Required artifact format:');
    expect(result).toContain('Signature metadata line');
    expect(result).toContain('*Model: <the exact model or assistant name that wrote this artifact>*');
  });
});

describe('wiki tree visibility helpers', () => {
  it('hides underscore transcript sidecars from the visible wiki tree', () => {
    expect(isHiddenWikiFileName('_2026-04-15-wiki-entries-initial-debate-transcript.md')).toBe(true);
    expect(isHiddenWikiFileName('2026-04-15-wiki-entries-initial-debate.md')).toBe(false);
  });

  it('hides dot and underscore prefixed folders from the visible wiki tree', () => {
    expect(isHiddenWikiFolderName('_transcripts')).toBe(true);
    expect(isHiddenWikiFolderName('.system')).toBe(true);
    expect(isHiddenWikiFolderName('debates')).toBe(false);
  });
});

describe('recursive wiki tree scan', () => {
  function makeTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fieldtheory-wiki-tree-'));
    tempDirs.push(dir);
    return dir;
  }

  function scan(rootPath: string): WikiNode[] {
    const manager = Object.create(LibrarianManager.prototype) as {
      scanMarkdownTree: (rootPath: string) => WikiNode[];
    };
    return manager.scanMarkdownTree(rootPath);
  }

  function flatten(nodes: WikiNode[]): string[] {
    return nodes.flatMap((node) => node.kind === 'file' ? [node.relPath] : flatten(node.children));
  }

  it('recurses through nested folders, keeps empty dirs, sorts siblings, and filters hidden/system files', () => {
    const root = makeTempDir();
    fs.mkdirSync(path.join(root, 'entries', 'nested'), { recursive: true });
    fs.mkdirSync(path.join(root, 'empty'), { recursive: true });
    fs.mkdirSync(path.join(root, '_drafts'), { recursive: true });
    fs.writeFileSync(path.join(root, 'entries', 'zeta.md'), '# Zeta\n');
    fs.writeFileSync(path.join(root, 'entries', 'alpha.md'), '# Alpha\n');
    fs.writeFileSync(path.join(root, 'entries', 'nested', 'beta.md'), '# Beta\n');
    fs.writeFileSync(path.join(root, 'entries', 'index.md'), '# Index\n');
    fs.writeFileSync(path.join(root, 'entries', '_secret.md'), '# Secret\n');
    fs.writeFileSync(path.join(root, '_drafts', 'hidden.md'), '# Hidden\n');

    const tree = scan(root);
    expect(tree.map((node) => node.name)).toEqual(['empty', 'entries']);

    const entries = tree.find((node) => node.kind === 'dir' && node.name === 'entries');
    expect(entries?.kind).toBe('dir');
    if (entries?.kind !== 'dir') return;
    expect(entries.children.map((node) => node.name)).toEqual(['alpha', 'nested', 'zeta']);
    expect(flatten(tree)).toEqual(['entries/alpha', 'entries/nested/beta', 'entries/zeta']);
  });

  it('emits wiki:changed immediately after saving a wiki page', () => {
    const root = makeTempDir();
    fs.mkdirSync(path.join(root, 'entries'), { recursive: true });
    const filePath = path.join(root, 'entries', 'note.md');
    fs.writeFileSync(filePath, '# Old title\n');

    const emit = vi.fn();
    const manager = Object.create(LibrarianManager.prototype) as {
      saveWikiPage: (relPath: string, content: string) => boolean;
      emit: typeof emit;
    };
    Object.defineProperty(manager, 'wikiDir', { value: root });
    manager.emit = emit;

    expect(manager.saveWikiPage('entries/note', '# New title\n')).toBe(true);
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('# New title\n');
    expect(emit).toHaveBeenCalledWith('wiki:changed');
  });

  it('renames root-level wiki pages now that library roots can create them', () => {
    const root = makeTempDir();
    fs.writeFileSync(path.join(root, 'note.md'), '# Note\n');

    const emit = vi.fn();
    const manager = Object.create(LibrarianManager.prototype) as {
      renameWikiPage: (relPath: string, newName: string) => string | null;
      emit: typeof emit;
    };
    Object.defineProperty(manager, 'wikiDir', { value: root });
    manager.emit = emit;

    expect(manager.renameWikiPage('note', 'Better Note')).toBe('better-note');
    expect(fs.existsSync(path.join(root, 'note.md'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'better-note.md'))).toBe(true);
    expect(emit).toHaveBeenCalledWith('wiki:changed');
    expect(emit).toHaveBeenCalledWith('wiki:deleted', 'note');
  });

  it('creates markdown files inside external library roots', () => {
    const root = makeTempDir();
    fs.mkdirSync(path.join(root, 'Team Notes'), { recursive: true });

    const emit = vi.fn();
    const manager = Object.create(LibrarianManager.prototype) as {
      settings: { libraryRoots: string[] };
      createLibraryFile: (rootPath: string, folderRelPath: string, fileName: string) => { relPath: string; absPath: string; content: string } | null;
      emit: typeof emit;
    };
    Object.defineProperty(manager, 'wikiDir', { value: path.join(root, 'wiki') });
    manager.settings = { libraryRoots: [root] };
    manager.emit = emit;

    const page = manager.createLibraryFile(root, 'Team Notes', 'Meeting Notes');

    expect(page?.relPath).toBe('Team Notes/meeting-notes');
    expect(page?.absPath).toBe(path.join(root, 'Team Notes', 'meeting-notes.md'));
    expect(page?.content).toBe('# Meeting Notes\n');
    expect(fs.readFileSync(path.join(root, 'Team Notes', 'meeting-notes.md'), 'utf-8')).toBe('# Meeting Notes\n');
    expect(emit).toHaveBeenCalledWith('library:changed', root);
  });

  it('creates wiki files inside the requested folder without slugging the folder path', () => {
    const root = makeTempDir();
    fs.mkdirSync(path.join(root, 'Shared Markdown'), { recursive: true });

    const emit = vi.fn();
    const manager = Object.create(LibrarianManager.prototype) as {
      createWikiFile: (folderName: string, fileName: string) => { relPath: string; absPath: string } | null;
      emit: typeof emit;
    };
    Object.defineProperty(manager, 'wikiDir', { value: root });
    manager.emit = emit;

    const page = manager.createWikiFile('Shared Markdown', 'Testing');

    expect(page?.relPath).toBe('Shared Markdown/testing');
    expect(page?.absPath).toBe(path.join(root, 'Shared Markdown', 'testing.md'));
    expect(fs.existsSync(path.join(root, 'shared-markdown', 'testing.md'))).toBe(false);
    expect(emit).toHaveBeenCalledWith('wiki:changed');
  });

  it('creates wiki folders without slugging the requested folder path', () => {
    const root = makeTempDir();

    const emit = vi.fn();
    const manager = Object.create(LibrarianManager.prototype) as {
      createWikiDir: (dirName: string) => boolean;
      emit: typeof emit;
    };
    Object.defineProperty(manager, 'wikiDir', { value: root });
    manager.emit = emit;

    expect(manager.createWikiDir('Shared Markdown')).toBe(true);
    expect(fs.statSync(path.join(root, 'Shared Markdown')).isDirectory()).toBe(true);
    expect(fs.existsSync(path.join(root, 'shared-markdown'))).toBe(false);
    expect(emit).toHaveBeenCalledWith('wiki:changed');
  });

  it('rejects external library file paths that leave the selected root', () => {
    const root = makeTempDir();

    const emit = vi.fn();
    const manager = Object.create(LibrarianManager.prototype) as {
      settings: { libraryRoots: string[] };
      createLibraryFile: (rootPath: string, folderRelPath: string, fileName: string) => unknown;
      emit: typeof emit;
    };
    Object.defineProperty(manager, 'wikiDir', { value: path.join(root, 'wiki') });
    manager.settings = { libraryRoots: [root] };
    manager.emit = emit;

    expect(manager.createLibraryFile(root, '../outside', 'Escape')).toBeNull();
    expect(fs.existsSync(path.join(root, 'outside', 'escape.md'))).toBe(false);
    expect(emit).not.toHaveBeenCalled();
  });

  it('creates external library folders without slugging their names', () => {
    const root = makeTempDir();

    const emit = vi.fn();
    const manager = Object.create(LibrarianManager.prototype) as {
      settings: { libraryRoots: string[] };
      createLibraryDir: (rootPath: string, dirRelPath: string) => boolean;
      emit: typeof emit;
    };
    Object.defineProperty(manager, 'wikiDir', { value: path.join(root, 'wiki') });
    manager.settings = { libraryRoots: [root] };
    manager.emit = emit;

    expect(manager.createLibraryDir(root, 'Client Notes')).toBe(true);
    expect(fs.statSync(path.join(root, 'Client Notes')).isDirectory()).toBe(true);
    expect(emit).toHaveBeenCalledWith('library:changed', root);
  });

  it('moves wiki folders to Trash and emits deleted page relPaths', async () => {
    const root = makeTempDir();
    fs.mkdirSync(path.join(root, 'Shared Markdown'), { recursive: true });
    fs.writeFileSync(path.join(root, 'Shared Markdown', 'note.md'), '# Note\n');
    const trashItem = vi.mocked(shell.trashItem).mockResolvedValue(undefined);

    const emit = vi.fn();
    const manager = Object.create(LibrarianManager.prototype) as {
      deleteLibraryDir: (rootPath: string, dirRelPath: string) => Promise<boolean>;
      emit: typeof emit;
    };
    Object.defineProperty(manager, 'wikiDir', { value: root });
    manager.emit = emit;

    expect(await manager.deleteLibraryDir(root, 'Shared Markdown')).toBe(true);
    expect(trashItem).toHaveBeenCalledWith(path.join(root, 'Shared Markdown'));
    expect(emit).toHaveBeenCalledWith('wiki:changed');
    expect(emit).toHaveBeenCalledWith('wiki:deleted', 'Shared Markdown/note');
  });

  it('moves external library folders to Trash and emits a library change', async () => {
    const root = makeTempDir();
    fs.mkdirSync(path.join(root, 'Client Notes'), { recursive: true });
    const trashItem = vi.mocked(shell.trashItem).mockResolvedValue(undefined);

    const emit = vi.fn();
    const manager = Object.create(LibrarianManager.prototype) as {
      settings: { libraryRoots: string[] };
      deleteLibraryDir: (rootPath: string, dirRelPath: string) => Promise<boolean>;
      emit: typeof emit;
    };
    Object.defineProperty(manager, 'wikiDir', { value: path.join(root, 'wiki') });
    manager.settings = { libraryRoots: [root] };
    manager.emit = emit;

    expect(await manager.deleteLibraryDir(root, 'Client Notes')).toBe(true);
    expect(trashItem).toHaveBeenCalledWith(path.join(root, 'Client Notes'));
    expect(emit).toHaveBeenCalledWith('library:changed', root);
    expect(emit).not.toHaveBeenCalledWith('wiki:changed');
  });

  it('does not delete a library root as a folder', async () => {
    const root = makeTempDir();
    const trashItem = vi.mocked(shell.trashItem).mockResolvedValue(undefined);

    const manager = Object.create(LibrarianManager.prototype) as {
      deleteLibraryDir: (rootPath: string, dirRelPath: string) => Promise<boolean>;
    };
    Object.defineProperty(manager, 'wikiDir', { value: root });

    expect(await manager.deleteLibraryDir(root, '')).toBe(false);
    expect(trashItem).not.toHaveBeenCalled();
  });
});

describe('librarian watcher cleanup', () => {
  it('closes both reading watchers and library root watchers on destroy', () => {
    const readingClose = vi.fn();
    const libraryClose = vi.fn();
    const manager = Object.create(LibrarianManager.prototype) as {
      watchers: Map<string, { close: () => void }>;
      libraryRootWatchers: Map<string, { close: () => void }>;
      destroy: () => void;
    };
    manager.watchers = new Map([['/readings', { close: readingClose }]]);
    manager.libraryRootWatchers = new Map([['/library', { close: libraryClose }]]);

    manager.destroy();

    expect(readingClose).toHaveBeenCalledTimes(1);
    expect(libraryClose).toHaveBeenCalledTimes(1);
    expect(manager.watchers.size).toBe(0);
    expect(manager.libraryRootWatchers.size).toBe(0);
  });
});
