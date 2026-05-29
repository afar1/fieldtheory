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
  buildFieldTheoryMarkdownCommandContent,
  defaultScratchpadName,
  defaultScratchpadNameWithTime,
  extractArtifactModelSignature,
  hasArtifactStructureInstruction,
  hasArtifactTitleInstruction,
  hasArtifactModelSignatureInstruction,
  isHiddenWikiFileName,
  isHiddenWikiFolderName,
  LibrarianManager,
  normalizeHiddenDefaultFolders,
  normalizeSeededReadmes,
  parseMarkdownHeader,
  parseMarkdownTodoState,
  type ReadingMeta,
  type WikiNode,
} from './librarianManager';
import { hasExistingLibraryContent, inferLibrarianSetupComplete } from './librarianSetupState';
import { readDocumentVersion } from './documentSaveGuard';
import { parseMarkdownContentEditedAt, parseMarkdownFrontmatter } from '../shared/markdownFrontmatter';

const tempDirs: string[] = [];

afterEach(() => {
  vi.clearAllMocks();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fieldtheory-wiki-tree-'));
  tempDirs.push(dir);
  return dir;
}

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

describe('parseMarkdownTodoState', () => {
  it('reads open and done states from todo frontmatter', () => {
    expect(parseMarkdownTodoState('---\ntodo: true\ntodo_state: open\n---\n# Task')).toBe('open');
    expect(parseMarkdownTodoState('---\ntodo: done\n---\n# Task')).toBe('done');
  });

  it('supports task aliases and non-task notes', () => {
    expect(parseMarkdownTodoState('---\ntask: true\ntask_state: done\n---\n# Task')).toBe('done');
    expect(parseMarkdownTodoState('---\ntodo: false\n---\n# Note')).toBeNull();
    expect(parseMarkdownTodoState('# Note')).toBeNull();
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

describe('Field Theory Markdown command content', () => {
  it('codifies the plain, tidy writing conventions for Field Theory notes', () => {
    const content = buildFieldTheoryMarkdownCommandContent();

    expect(content).toContain('plain, practical English');
    expect(content).toContain('It does not apply to Librarian artifacts');
    expect(content).toContain('prefer bold section labels instead of more heading levels');
    expect(content).toContain('Keep most text at the same visual size');
    expect(content).toContain('Prefer prose');
    expect(content).toContain('Use ordered lists only for real sequence, priority, or steps');
    expect(content).toContain('- [ ] One action per line');
    expect(content).toContain('[[Page Name]]');
    expect(content).toContain('**Sources**');
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
    expect(isHiddenWikiFolderName('.assets')).toBe(true);
    expect(isHiddenWikiFolderName('Brief.assets')).toBe(true);
    expect(isHiddenWikiFolderName('Codex Context')).toBe(true);
    expect(isHiddenWikiFolderName('debates')).toBe(false);
  });
});

describe('recursive wiki tree scan', () => {
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
    fs.mkdirSync(path.join(root, 'Field theory fn.assets'), { recursive: true });
    fs.mkdirSync(path.join(root, 'entries', 'Teams in Field theory.assets'), { recursive: true });
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

  it('sorts README before sibling pages', () => {
    const root = makeTempDir();
    fs.mkdirSync(path.join(root, 'entries'), { recursive: true });
    fs.writeFileSync(path.join(root, 'entries', 'zeta.md'), '# Zeta\n');
    fs.writeFileSync(path.join(root, 'entries', 'README.md'), '# Entries\n');
    fs.writeFileSync(path.join(root, 'entries', 'alpha.md'), '# Alpha\n');

    const tree = scan(root);
    const entries = tree.find((node) => node.kind === 'dir' && node.name === 'entries');
    expect(entries?.kind).toBe('dir');
    if (entries?.kind !== 'dir') return;
    expect(entries.children.map((node) => node.name)).toEqual(['README', 'alpha', 'zeta']);
  });

  it('adds todo and archive metadata to markdown file nodes', () => {
    const root = makeTempDir();
    fs.mkdirSync(path.join(root, 'scratchpad'), { recursive: true });
    fs.writeFileSync(path.join(root, 'scratchpad', 'open.md'), '---\ntodo: true\ntodo_state: open\n---\n# Open Task\n');
    fs.writeFileSync(path.join(root, 'scratchpad', 'done.md'), '---\ntask: done\n---\n# Done Task\n');
    fs.writeFileSync(path.join(root, 'scratchpad', 'note.md'), '---\narchived: true\n---\n# Note\n');

    const tree = scan(root);
    const scratchpad = tree.find((node) => node.kind === 'dir' && node.name === 'scratchpad');
    expect(scratchpad?.kind).toBe('dir');
    if (scratchpad?.kind !== 'dir') return;
    const files = scratchpad.children.filter((node): node is Extract<WikiNode, { kind: 'file' }> => node.kind === 'file');
    expect(files.map((file) => [file.name, file.todoState, file.archived])).toEqual([
      ['done', 'done', undefined],
      ['note', undefined, true],
      ['open', 'open', undefined],
    ]);
  });

  it('uses content edit metadata for wiki file sort timestamps', () => {
    const root = makeTempDir();
    fs.mkdirSync(path.join(root, 'scratchpad'), { recursive: true });
    fs.writeFileSync(path.join(root, 'scratchpad', 'note.md'), '---\ncontent_edited_at: 1234\narchived: true\n---\n# Note\n');

    const tree = scan(root);
    const scratchpad = tree.find((node) => node.kind === 'dir' && node.name === 'scratchpad');
    expect(scratchpad?.kind).toBe('dir');
    if (scratchpad?.kind !== 'dir') return;
    const note = scratchpad.children[0];
    expect(note.kind).toBe('file');
    if (note.kind !== 'file') return;
    expect(note.lastUpdated).toBe(1234);
    expect(note.archived).toBe(true);
  });

  it('uses shared frontmatter title and full callsign for River cache nodes', () => {
    const root = makeTempDir();
    fs.mkdirSync(path.join(root, 'River (shared)'), { recursive: true });
    const updatedAt = '2026-05-28T12:00:00.000Z';
    fs.writeFileSync(path.join(root, 'River (shared)', 'plain AM.md'), [
      '---',
      'title: plain',
      'shared: true',
      'shared_id: shared-1',
      'shared_type: command',
      'shared_original_source_path: Commands/plain.md',
      'shared_author_initials: AM',
      'shared_author_callsign: afar',
      `shared_updated_at: "${updatedAt}"`,
      '---',
      '',
      'Body',
    ].join('\n'));

    const tree = scan(root);
    const river = tree.find((node) => node.kind === 'dir' && node.name === 'River (shared)');
    expect(river?.kind).toBe('dir');
    if (river?.kind !== 'dir') return;
    const shared = river.children[0];
    expect(shared.kind).toBe('file');
    if (shared.kind !== 'file') return;
    expect(shared.name).toBe('plain AM');
    expect(shared.title).toBe('plain');
    expect(shared.lastUpdated).toBe(Date.parse(updatedAt));
    expect(shared.sharedOriginalSourcePath).toBe('Commands/plain.md');
    expect(shared.sharedAuthorCallsign).toBe('afar');
  });

  it('uses shared updated metadata when opening a River cache page', () => {
    const root = makeTempDir();
    fs.mkdirSync(path.join(root, 'River (shared)'), { recursive: true });
    const updatedAt = '2026-05-28T12:00:00.000Z';
    fs.writeFileSync(path.join(root, 'River (shared)', 'plain AM.md'), [
      '---',
      'title: plain',
      'shared: true',
      'shared_id: shared-1',
      'shared_type: command',
      'shared_original_source_path: Commands/plain.md',
      'shared_author_callsign: afar',
      `shared_updated_at: "${updatedAt}"`,
      '---',
      '',
      'Body',
    ].join('\n'));

    const manager = Object.create(LibrarianManager.prototype) as {
      getWikiPage: (relPath: string) => {
        lastUpdated: number;
        sharedOriginalSourcePath?: string;
        sharedAuthorCallsign?: string;
      } | null;
    };
    Object.defineProperty(manager, 'wikiDir', { value: root });

    expect(manager.getWikiPage('River (shared)/plain AM')).toEqual(expect.objectContaining({
      lastUpdated: Date.parse(updatedAt),
      sharedOriginalSourcePath: 'Commands/plain.md',
      sharedAuthorCallsign: 'afar',
    }));
  });

  it('does not derive River cache titles from initials-suffixed filenames', () => {
    const root = makeTempDir();
    fs.mkdirSync(path.join(root, 'River (shared)'), { recursive: true });
    fs.writeFileSync(path.join(root, 'River (shared)', 'field theory fnc AM.md'), [
      '---',
      'shared: true',
      'shared_id: shared-1',
      'shared_type: document',
      'shared_original_source_path: scratchpad/field theory fnc.md',
      'shared_author_callsign: AMB-MAC',
      '---',
      '',
      'Body',
    ].join('\n'));

    const tree = scan(root);
    const river = tree.find((node) => node.kind === 'dir' && node.name === 'River (shared)');
    expect(river?.kind).toBe('dir');
    if (river?.kind !== 'dir') return;
    const shared = river.children[0];
    expect(shared.kind).toBe('file');
    if (shared.kind !== 'file') return;
    expect(shared.name).toBe('field theory fnc AM');
    expect(shared.title).toBe('Untitled');
    expect(shared.sharedAuthorCallsign).toBe('AMB-MAC');
  });

  it('includes .markdown files in the library tree', () => {
    const root = makeTempDir();
    fs.mkdirSync(path.join(root, 'entries'), { recursive: true });
    fs.writeFileSync(path.join(root, 'entries', 'alpha.markdown'), '# Alpha\n');
    fs.writeFileSync(path.join(root, 'entries', 'index.markdown'), '# Index\n');

    const tree = scan(root);
    const entries = tree.find((node) => node.kind === 'dir' && node.name === 'entries');
    expect(entries?.kind).toBe('dir');
    if (entries?.kind !== 'dir') return;
    expect(entries.children.map((node) => node.name)).toEqual(['alpha']);
    expect(flatten(tree)).toEqual(['entries/alpha']);
  });

  it('keeps wiki scans markdown-only but includes html and css in library roots', () => {
    const root = makeTempDir();
    fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
    fs.writeFileSync(path.join(root, 'reports', 'alpha.md'), '# Alpha\n');
    fs.writeFileSync(path.join(root, 'reports', 'summary.html'), '<h1>Summary</h1>\n');
    fs.writeFileSync(path.join(root, 'reports', 'styles.css'), 'h1 { color: red; }\n');

    const manager = Object.create(LibrarianManager.prototype) as {
      scanMarkdownTree: (rootPath: string, currentDir?: string, seenRealPaths?: Set<string>, includeLibraryTextDocuments?: boolean) => WikiNode[];
    };

    expect(flatten(manager.scanMarkdownTree(root))).toEqual(['reports/alpha']);
    expect(flatten(manager.scanMarkdownTree(root, root, new Set<string>(), true))).toEqual([
      'reports/alpha',
      'reports/styles.css',
      'reports/summary.html',
    ]);
  });

  it('keeps portable command files out of the wiki tree', () => {
    const root = makeTempDir();
    fs.mkdirSync(path.join(root, 'Commands'), { recursive: true });
    fs.mkdirSync(path.join(root, 'entries'), { recursive: true });
    fs.writeFileSync(path.join(root, 'Commands', 'workflow.md'), '# Workflow\n');
    fs.writeFileSync(path.join(root, 'entries', 'note.md'), '# Note\n');

    const manager = Object.create(LibrarianManager.prototype) as {
      getWikiTree: () => Array<{ name: string; files: Array<{ relPath: string }> }>;
      getWikiPage: (relPath: string) => unknown;
      startWikiWatcher: () => void;
    };
    Object.defineProperty(manager, 'wikiDir', { value: root });
    manager.startWikiWatcher = vi.fn();

    expect(manager.getWikiTree().map((folder) => folder.name)).toEqual(['entries']);
    expect(manager.getWikiTree()[0]?.files.map((page) => page.relPath)).toEqual(['entries/note']);
    expect(manager.getWikiPage('Commands/workflow')).toBeNull();
  });

  it('reuses the wiki tree until a wiki change invalidates it', () => {
    const root = makeTempDir();
    fs.mkdirSync(path.join(root, 'entries'), { recursive: true });
    fs.writeFileSync(path.join(root, 'entries', 'alpha.md'), '# Alpha\n');

    const manager = Object.create(LibrarianManager.prototype) as {
      getWikiTree: () => Array<{ name: string; files: Array<{ relPath: string }> }>;
      startWikiWatcher: () => void;
      emit: (eventName: string) => boolean;
    };
    Object.defineProperty(manager, 'wikiDir', { value: root });
    manager.startWikiWatcher = vi.fn();

    expect(manager.getWikiTree()[0]?.files.map((page) => page.relPath)).toEqual(['entries/alpha']);

    fs.writeFileSync(path.join(root, 'entries', 'beta.md'), '# Beta\n');
    expect(manager.getWikiTree()[0]?.files.map((page) => page.relPath)).toEqual(['entries/alpha']);

    manager.emit('wiki:changed');
    expect(manager.getWikiTree()[0]?.files.map((page) => page.relPath)).toEqual(['entries/alpha', 'entries/beta']);
  });

  it('reuses library roots until a library change invalidates them', () => {
    const tempDir = makeTempDir();
    const wikiRoot = path.join(tempDir, 'wiki');
    const externalRoot = path.join(tempDir, 'external');
    fs.mkdirSync(wikiRoot, { recursive: true });
    fs.mkdirSync(externalRoot, { recursive: true });
    fs.writeFileSync(path.join(externalRoot, 'alpha.md'), '# Alpha\n');
    fs.writeFileSync(path.join(externalRoot, 'report.html'), '<h1>Report</h1>\n');
    fs.writeFileSync(path.join(externalRoot, 'styles.css'), 'body { color: red; }\n');

    const manager = Object.create(LibrarianManager.prototype) as {
      settings: { libraryRoots: string[] };
      getLibraryRoots: () => Array<{ path: string; tree: WikiNode[] }>;
      startWikiWatcher: () => void;
      emit: (eventName: string, rootPath?: string) => boolean;
    };
    Object.defineProperty(manager, 'wikiDir', { value: wikiRoot });
    manager.settings = { libraryRoots: [externalRoot] };
    manager.startWikiWatcher = vi.fn();

    const externalPages = () => flatten(manager.getLibraryRoots().find((root) => root.path === externalRoot)?.tree ?? []);
    expect(externalPages()).toEqual(['alpha', 'report.html', 'styles.css']);

    fs.writeFileSync(path.join(externalRoot, 'beta.md'), '# Beta\n');
    expect(externalPages()).toEqual(['alpha', 'report.html', 'styles.css']);

    manager.emit('library:changed', externalRoot);
    expect(externalPages()).toEqual(['alpha', 'beta', 'report.html', 'styles.css']);
  });

  it('returns library root paths without scanning root trees', () => {
    const tempDir = makeTempDir();
    const wikiRoot = path.join(tempDir, 'wiki');
    const externalRoot = path.join(tempDir, 'external');
    fs.mkdirSync(path.join(wikiRoot, 'entries'), { recursive: true });
    fs.mkdirSync(path.join(externalRoot, 'reports'), { recursive: true });
    fs.writeFileSync(path.join(wikiRoot, 'entries', 'alpha.md'), '# Alpha\n');
    fs.writeFileSync(path.join(externalRoot, 'reports', 'beta.md'), '# Beta\n');

    const manager = Object.create(LibrarianManager.prototype) as {
      settings: { libraryRoots: string[] };
      getLibraryRootPaths: () => string[];
      scanMarkdownTree: () => WikiNode[];
    };
    Object.defineProperty(manager, 'wikiDir', { value: wikiRoot });
    manager.settings = { libraryRoots: [externalRoot, wikiRoot] };
    manager.scanMarkdownTree = vi.fn();

    expect(manager.getLibraryRootPaths()).toEqual([wikiRoot, externalRoot]);
    expect(manager.scanMarkdownTree).not.toHaveBeenCalled();
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

    expect(manager.saveWikiPage('entries/note', '# New title\n')).toEqual(expect.objectContaining({ ok: true }));
    const saved = fs.readFileSync(filePath, 'utf-8');
    expect(parseMarkdownFrontmatter(saved).body).toBe('# New title\n');
    expect(parseMarkdownContentEditedAt(saved)).toBeGreaterThan(0);
    expect(emit).toHaveBeenCalledWith('wiki:changed');
  });

  it('saves existing .markdown wiki pages without creating a duplicate .md file', () => {
    const root = makeTempDir();
    fs.mkdirSync(path.join(root, 'entries'), { recursive: true });
    const filePath = path.join(root, 'entries', 'note.markdown');
    fs.writeFileSync(filePath, '# Old title\n');

    const emit = vi.fn();
    const manager = Object.create(LibrarianManager.prototype) as {
      saveWikiPage: (relPath: string, content: string) => boolean;
      emit: typeof emit;
    };
    Object.defineProperty(manager, 'wikiDir', { value: root });
    manager.emit = emit;

    expect(manager.saveWikiPage('entries/note', '# New title\n')).toEqual(expect.objectContaining({ ok: true }));
    const saved = fs.readFileSync(filePath, 'utf-8');
    expect(parseMarkdownFrontmatter(saved).body).toBe('# New title\n');
    expect(parseMarkdownContentEditedAt(saved)).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(root, 'entries', 'note.md'))).toBe(false);
    expect(emit).toHaveBeenCalledWith('wiki:changed');
  });

  it('reports a conflict when a wiki page changed since it was opened', () => {
    const root = makeTempDir();
    fs.mkdirSync(path.join(root, 'entries'), { recursive: true });
    const filePath = path.join(root, 'entries', 'note.md');
    fs.writeFileSync(filePath, '# Original\n');

    const emit = vi.fn();
    const manager = Object.create(LibrarianManager.prototype) as {
      saveWikiPage: (relPath: string, content: string, expectedVersion?: ReturnType<typeof readDocumentVersion>) => unknown;
      emit: typeof emit;
    };
    Object.defineProperty(manager, 'wikiDir', { value: root });
    manager.emit = emit;
    const expectedVersion = readDocumentVersion(filePath);
    fs.writeFileSync(filePath, '# External\n');

    expect(manager.saveWikiPage('entries/note', '# Mine\n', expectedVersion)).toEqual(expect.objectContaining({
      ok: false,
      reason: 'conflict',
      currentContent: '# External\n',
    }));
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('# External\n');
    expect(emit).not.toHaveBeenCalled();
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

    expect(manager.renameWikiPage('note', 'Better Note')).toBe('Better Note');
    expect(fs.existsSync(path.join(root, 'note.md'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'Better Note.md'))).toBe(true);
    expect(emit).toHaveBeenCalledWith('wiki:renamed', expect.objectContaining({
      oldRelPath: 'note',
      newRelPath: 'Better Note',
      oldAbsPath: path.join(root, 'note.md'),
      newAbsPath: path.join(root, 'Better Note.md'),
      builtin: true,
    }));
    expect(emit).not.toHaveBeenCalledWith('wiki:changed', root);
    expect(emit).toHaveBeenCalledWith('wiki:deleted', 'note');
  });

  it('patches the cached wiki tree when a wiki page is renamed', () => {
    const root = makeTempDir();
    fs.mkdirSync(path.join(root, 'entries'), { recursive: true });
    fs.writeFileSync(path.join(root, 'entries', 'note.md'), '# Note\n');

    const manager = Object.create(LibrarianManager.prototype) as {
      getWikiTree: () => Array<{ name: string; files: Array<{ relPath: string }> }>;
      renameWikiPage: (relPath: string, newName: string) => string | null;
      startWikiWatcher: () => void;
      emit: ReturnType<typeof vi.fn>;
    };
    Object.defineProperty(manager, 'wikiDir', { value: root });
    manager.startWikiWatcher = vi.fn();
    manager.emit = vi.fn();

    expect(manager.getWikiTree()[0]?.files.map((page) => page.relPath)).toEqual(['entries/note']);
    expect(manager.renameWikiPage('entries/note', 'Better Note')).toBe('entries/Better Note');
    expect(manager.getWikiTree()[0]?.files.map((page) => page.relPath)).toEqual(['entries/Better Note']);
  });

  it('keeps the old wiki relPath selectable briefly after a rename', () => {
    const root = makeTempDir();
    fs.mkdirSync(path.join(root, 'entries'), { recursive: true });
    fs.writeFileSync(path.join(root, 'entries', 'note.md'), '# Note\n');

    const manager = Object.create(LibrarianManager.prototype) as {
      renameWikiPage: (relPath: string, newName: string) => string | null;
      getWikiPage: (relPath: string) => { relPath: string; title: string } | null;
      emit: ReturnType<typeof vi.fn>;
    };
    Object.defineProperty(manager, 'wikiDir', { value: root });
    manager.emit = vi.fn();

    expect(manager.renameWikiPage('entries/note', 'Better Note')).toBe('entries/Better Note');
    expect(manager.getWikiPage('entries/note')).toEqual(expect.objectContaining({
      relPath: 'entries/Better Note',
      title: 'Better Note',
    }));
  });

  it('renames .markdown wiki pages without changing their extension', () => {
    const root = makeTempDir();
    fs.writeFileSync(path.join(root, 'note.markdown'), '# Note\n');

    const emit = vi.fn();
    const manager = Object.create(LibrarianManager.prototype) as {
      renameWikiPage: (relPath: string, newName: string) => string | null;
      emit: typeof emit;
    };
    Object.defineProperty(manager, 'wikiDir', { value: root });
    manager.emit = emit;

    expect(manager.renameWikiPage('note', 'Better Note')).toBe('Better Note');
    expect(fs.existsSync(path.join(root, 'note.markdown'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'Better Note.markdown'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'Better Note.md'))).toBe(false);
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

    expect(page?.relPath).toBe('Team Notes/Meeting Notes');
    expect(page?.absPath).toBe(path.join(root, 'Team Notes', 'Meeting Notes.md'));
    expect(page?.content).toBe('');
    expect(fs.readFileSync(path.join(root, 'Team Notes', 'Meeting Notes.md'), 'utf-8')).toBe('');
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

    expect(page?.relPath).toBe('Shared Markdown/Testing');
    expect(page?.absPath).toBe(path.join(root, 'Shared Markdown', 'Testing.md'));
    expect(fs.existsSync(path.join(root, 'shared-markdown', 'Testing.md'))).toBe(false);
    expect(emit).toHaveBeenCalledWith('wiki:changed');
  });

  it('rejects hidden or path-like wiki file names before slugging', () => {
    const root = makeTempDir();

    const emit = vi.fn();
    const manager = Object.create(LibrarianManager.prototype) as {
      createWikiFile: (folderName: string, fileName: string) => unknown;
      emit: typeof emit;
    };
    Object.defineProperty(manager, 'wikiDir', { value: root });
    manager.emit = emit;

    expect(manager.createWikiFile('', '../escape')).toBeNull();
    expect(manager.createWikiFile('', '.hidden')).toBeNull();
    expect(manager.createWikiFile('', '_draft')).toBeNull();
    expect(fs.existsSync(path.join(root, 'escape.md'))).toBe(false);
    expect(fs.existsSync(path.join(root, '-hidden.md'))).toBe(false);
    expect(fs.existsSync(path.join(root, '-draft.md'))).toBe(false);
    expect(emit).not.toHaveBeenCalled();
  });

  it('creates default-title wiki files with an empty body and filename title', () => {
    const root = makeTempDir();
    fs.mkdirSync(path.join(root, 'scratchpad'), { recursive: true });

    const emit = vi.fn();
    const manager = Object.create(LibrarianManager.prototype) as {
      createWikiFileWithTitle: (folderName: string, title: string) => { relPath: string; title: string; content: string } | null;
      emit: typeof emit;
    };
    Object.defineProperty(manager, 'wikiDir', { value: root });
    manager.emit = emit;

    const page = manager.createWikiFileWithTitle('scratchpad', 'Wednesday Apr 29th');

    expect(page?.relPath).toBe('scratchpad/Wednesday Apr 29th');
    expect(page?.title).toBe('Wednesday Apr 29th');
    expect(page?.content).toBe('');
    expect(fs.readFileSync(path.join(root, 'scratchpad', 'Wednesday Apr 29th.md'), 'utf-8')).toBe('');
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

  it('rejects hidden or path-like library file names before slugging', () => {
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

    expect(manager.createLibraryFile(root, '', '../escape')).toBeNull();
    expect(manager.createLibraryFile(root, '', '.hidden')).toBeNull();
    expect(manager.createLibraryFile(root, '', '_draft')).toBeNull();
    expect(fs.existsSync(path.join(root, 'escape.md'))).toBe(false);
    expect(fs.existsSync(path.join(root, '-hidden.md'))).toBe(false);
    expect(fs.existsSync(path.join(root, '-draft.md'))).toBe(false);
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

  it('rejects hidden library folders because they would not display', () => {
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

    expect(manager.createLibraryDir(root, '.hidden')).toBe(false);
    expect(manager.createLibraryDir(root, '_drafts')).toBe(false);
    expect(fs.existsSync(path.join(root, '.hidden'))).toBe(false);
    expect(fs.existsSync(path.join(root, '_drafts'))).toBe(false);
    expect(emit).not.toHaveBeenCalled();
  });

  it('moves user-created wiki folders to Trash and emits deleted page relPaths', async () => {
    const root = makeTempDir();
    fs.mkdirSync(path.join(root, 'Client Notes'), { recursive: true });
    fs.writeFileSync(path.join(root, 'Client Notes', 'note.md'), '# Note\n');
    const trashItem = vi.mocked(shell.trashItem).mockResolvedValue(undefined);

    const emit = vi.fn();
    const manager = Object.create(LibrarianManager.prototype) as {
      deleteLibraryDir: (rootPath: string, dirRelPath: string) => Promise<boolean>;
      emit: typeof emit;
    };
    Object.defineProperty(manager, 'wikiDir', { value: root });
    manager.emit = emit;

    expect(await manager.deleteLibraryDir(root, 'Client Notes')).toBe(true);
    expect(trashItem).toHaveBeenCalledWith(path.join(root, 'Client Notes'));
    expect(emit).toHaveBeenCalledWith('wiki:changed');
    expect(emit).toHaveBeenCalledWith('wiki:deleted', 'Client Notes/note');
  });

  it('moves FT-created wiki folders to Trash', async () => {
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

  it('moves external library files to Trash and emits a library change', async () => {
    const root = makeTempDir();
    const filePath = path.join(root, 'hello-yolo-.txt');
    fs.writeFileSync(filePath, '# Hello\n');
    const trashItem = vi.mocked(shell.trashItem).mockResolvedValue(undefined);

    const emit = vi.fn();
    const manager = Object.create(LibrarianManager.prototype) as {
      settings: { libraryRoots: string[] };
      deleteExternalLibraryFile: (filePath: string) => Promise<boolean>;
      emit: typeof emit;
    };
    Object.defineProperty(manager, 'wikiDir', { value: path.join(root, 'wiki') });
    manager.settings = { libraryRoots: [root] };
    manager.emit = emit;

    expect(await manager.deleteExternalLibraryFile(filePath)).toBe(true);
    expect(trashItem).toHaveBeenCalledWith(fs.realpathSync(filePath));
    expect(emit).toHaveBeenCalledWith('library:changed', root);
    expect(emit).not.toHaveBeenCalledWith('wiki:changed');
  });

  it('does not delete external files outside registered library roots', async () => {
    const root = makeTempDir();
    const outside = makeTempDir();
    const filePath = path.join(outside, 'outside.md');
    fs.writeFileSync(filePath, '# Outside\n');
    const trashItem = vi.mocked(shell.trashItem).mockResolvedValue(undefined);

    const emit = vi.fn();
    const manager = Object.create(LibrarianManager.prototype) as {
      settings: { libraryRoots: string[] };
      deleteExternalLibraryFile: (filePath: string) => Promise<boolean>;
      emit: typeof emit;
    };
    Object.defineProperty(manager, 'wikiDir', { value: path.join(root, 'wiki') });
    manager.settings = { libraryRoots: [root] };
    manager.emit = emit;

    expect(await manager.deleteExternalLibraryFile(filePath)).toBe(false);
    expect(trashItem).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
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

  it('only saves existing readings inside watched reading folders', () => {
    const root = makeTempDir();
    const outside = makeTempDir();
    const readingPath = path.join(root, 'reading.markdown');
    const outsidePath = path.join(outside, 'outside.md');
    fs.writeFileSync(readingPath, '# Reading\n');
    fs.writeFileSync(outsidePath, '# Outside\n');

    const emit = vi.fn();
    const manager = Object.create(LibrarianManager.prototype) as {
      settings: { watchedDirs: string[] };
      cache: Map<string, unknown>;
      saveIndex: () => void;
      saveReading: (filePath: string, content: string) => boolean;
      emit: typeof emit;
    };
    manager.settings = { watchedDirs: [root] };
    manager.cache = new Map();
    manager.saveIndex = vi.fn();
    manager.emit = emit;

    expect(manager.saveReading(outsidePath, '# Changed\n')).toEqual({ ok: false, reason: 'not-found' });
    expect(fs.readFileSync(outsidePath, 'utf-8')).toBe('# Outside\n');

    expect(manager.saveReading(readingPath, '# Changed\n')).toEqual(expect.objectContaining({ ok: true }));
    const saved = fs.readFileSync(readingPath, 'utf-8');
    expect(parseMarkdownFrontmatter(saved).body).toBe('# Changed\n');
    expect(parseMarkdownContentEditedAt(saved)).toBeGreaterThan(0);
    expect(manager.cache.has(readingPath)).toBe(true);
    expect(emit).toHaveBeenCalledWith('reading-updated', expect.objectContaining({ path: readingPath, title: 'Changed' }));
  });

  it('reports a conflict when a watched reading changed since it was opened', () => {
    const root = makeTempDir();
    const readingPath = path.join(root, 'reading.md');
    fs.writeFileSync(readingPath, '# Reading\n');

    const emit = vi.fn();
    const manager = Object.create(LibrarianManager.prototype) as {
      settings: { watchedDirs: string[] };
      cache: Map<string, unknown>;
      saveIndex: () => void;
      saveReading: (filePath: string, content: string, expectedVersion?: ReturnType<typeof readDocumentVersion>) => unknown;
      emit: typeof emit;
    };
    manager.settings = { watchedDirs: [root] };
    manager.cache = new Map();
    manager.saveIndex = vi.fn();
    manager.emit = emit;
    const expectedVersion = readDocumentVersion(readingPath);
    fs.writeFileSync(readingPath, '# External\n');

    expect(manager.saveReading(readingPath, '# Mine\n', expectedVersion)).toEqual(expect.objectContaining({
      ok: false,
      reason: 'conflict',
      currentContent: '# External\n',
    }));
    expect(fs.readFileSync(readingPath, 'utf-8')).toBe('# External\n');
    expect(emit).not.toHaveBeenCalled();
  });

  it('moves existing readings inside watched folders to Trash', async () => {
    const root = makeTempDir();
    const outside = makeTempDir();
    const readingPath = path.join(root, 'reading.markdown');
    const outsidePath = path.join(outside, 'outside.md');
    fs.writeFileSync(readingPath, '# Reading\n');
    fs.writeFileSync(outsidePath, '# Outside\n');
    const trashItem = vi.mocked(shell.trashItem).mockResolvedValue(undefined);

    const emit = vi.fn();
    const manager = Object.create(LibrarianManager.prototype) as {
      settings: { watchedDirs: string[] };
      cache: Map<string, unknown>;
      saveIndex: () => void;
      deleteReading: (filePath: string) => Promise<boolean>;
      emit: typeof emit;
    };
    manager.settings = { watchedDirs: [root] };
    manager.cache = new Map();
    manager.saveIndex = vi.fn();
    manager.emit = emit;

    expect(await manager.deleteReading(outsidePath)).toBe(false);
    expect(trashItem).not.toHaveBeenCalledWith(outsidePath);

    expect(await manager.deleteReading(readingPath)).toBe(true);
    expect(trashItem).toHaveBeenCalledWith(readingPath);
    expect(manager.cache.has(readingPath)).toBe(false);
    expect(emit).toHaveBeenCalledWith('reading-removed', readingPath);
  });

  it('updates the watched reading cache when a reading is renamed', () => {
    const root = makeTempDir();
    const oldPath = path.join(root, 'reading.md');
    const newPath = path.join(root, 'renamed.md');
    fs.writeFileSync(oldPath, '# Reading\n');
    fs.renameSync(oldPath, newPath);

    const emit = vi.fn();
    const manager = Object.create(LibrarianManager.prototype) as {
      settings: { watchedDirs: string[] };
      cache: Map<string, ReadingMeta>;
      saveIndex: () => void;
      emit: typeof emit;
      recordWatchedReadingRename: (oldAbsPath: string, newAbsPath: string) => ReadingMeta | null;
    };
    manager.settings = { watchedDirs: [root] };
    manager.cache = new Map([[oldPath, {
      path: oldPath,
      title: 'Reading',
      context: null,
      readingTime: null,
      modelSignature: null,
      createdAt: Date.now(),
      mtime: Date.now(),
    }]]);
    manager.saveIndex = vi.fn();
    manager.emit = emit;

    const meta = manager.recordWatchedReadingRename(oldPath, newPath);

    expect(meta?.path).toBe(newPath);
    expect(manager.cache.has(oldPath)).toBe(false);
    expect(manager.cache.has(newPath)).toBe(true);
    expect(emit).toHaveBeenCalledWith('reading-renamed', expect.objectContaining({
      oldPath,
      reading: expect.objectContaining({ path: newPath, title: 'Reading' }),
    }));
  });

  it('moves wiki pages into another folder and emits stale relPath deletion', () => {
    const root = makeTempDir();
    fs.mkdirSync(path.join(root, 'entries'), { recursive: true });
    fs.mkdirSync(path.join(root, 'scratchpad'), { recursive: true });
    fs.writeFileSync(path.join(root, 'entries', 'note.md'), '# Note\n');

    const emit = vi.fn();
    const manager = Object.create(LibrarianManager.prototype) as {
      moveLibraryItem: (rootPath: string, kind: 'file' | 'dir', sourceRelPath: string, targetDirRelPath: string) => string | null;
      emit: typeof emit;
    };
    Object.defineProperty(manager, 'wikiDir', { value: root });
    manager.emit = emit;

    expect(manager.moveLibraryItem(root, 'file', 'entries/note', 'scratchpad')).toBe('scratchpad/note');
    expect(fs.existsSync(path.join(root, 'entries', 'note.md'))).toBe(false);
    expect(fs.readFileSync(path.join(root, 'scratchpad', 'note.md'), 'utf-8')).toBe('# Note\n');
    expect(emit).toHaveBeenCalledWith('wiki:changed');
    expect(emit).toHaveBeenCalledWith('wiki:deleted', 'entries/note');
  });

  it('moves wiki files into registered external library roots', () => {
    const wikiRoot = makeTempDir();
    const externalRoot = makeTempDir();
    fs.mkdirSync(path.join(wikiRoot, 'scratchpad'), { recursive: true });
    fs.writeFileSync(path.join(wikiRoot, 'scratchpad', 'note.md'), '# Note\n');

    const emit = vi.fn();
    const manager = Object.create(LibrarianManager.prototype) as {
      moveLibraryItem: (rootPath: string, kind: 'file' | 'dir', sourceRelPath: string, targetDirRelPath: string, targetRootPath?: string) => string | null;
      emit: typeof emit;
    };
    Object.defineProperty(manager, 'wikiDir', { value: wikiRoot });
    Object.defineProperty(manager, 'settings', { value: { libraryRoots: [externalRoot] } });
    manager.emit = emit;

    expect(manager.moveLibraryItem(wikiRoot, 'file', 'scratchpad/note', '', externalRoot)).toBe('note');
    expect(fs.existsSync(path.join(wikiRoot, 'scratchpad', 'note.md'))).toBe(false);
    expect(fs.readFileSync(path.join(externalRoot, 'note.md'), 'utf-8')).toBe('# Note\n');
    expect(emit).toHaveBeenCalledWith('wiki:changed');
    expect(emit).toHaveBeenCalledWith('wiki:deleted', 'scratchpad/note');
    expect(emit).toHaveBeenCalledWith('library:changed', externalRoot);
  });

  it('keeps cross-root moves scoped to files', () => {
    const wikiRoot = makeTempDir();
    const externalRoot = makeTempDir();
    fs.mkdirSync(path.join(wikiRoot, 'scratchpad'), { recursive: true });

    const emit = vi.fn();
    const manager = Object.create(LibrarianManager.prototype) as {
      moveLibraryItem: (rootPath: string, kind: 'file' | 'dir', sourceRelPath: string, targetDirRelPath: string, targetRootPath?: string) => string | null;
      emit: typeof emit;
    };
    Object.defineProperty(manager, 'wikiDir', { value: wikiRoot });
    Object.defineProperty(manager, 'settings', { value: { libraryRoots: [externalRoot] } });
    manager.emit = emit;

    expect(manager.moveLibraryItem(wikiRoot, 'dir', 'scratchpad', '', externalRoot)).toBeNull();
    expect(fs.existsSync(path.join(wikiRoot, 'scratchpad'))).toBe(true);
    expect(emit).not.toHaveBeenCalled();
  });

  it('rejects moving a folder into itself or a descendant', () => {
    const root = makeTempDir();
    fs.mkdirSync(path.join(root, 'Client Notes', 'Nested'), { recursive: true });

    const emit = vi.fn();
    const manager = Object.create(LibrarianManager.prototype) as {
      moveLibraryItem: (rootPath: string, kind: 'file' | 'dir', sourceRelPath: string, targetDirRelPath: string) => string | null;
      emit: typeof emit;
    };
    Object.defineProperty(manager, 'wikiDir', { value: root });
    manager.emit = emit;

    expect(manager.moveLibraryItem(root, 'dir', 'Client Notes', 'Client Notes/Nested')).toBeNull();
    expect(fs.existsSync(path.join(root, 'Client Notes', 'Nested'))).toBe(true);
    expect(emit).not.toHaveBeenCalled();
  });

  it('rejects moving default wiki folders', () => {
    const root = makeTempDir();
    fs.mkdirSync(path.join(root, 'entries'), { recursive: true });
    fs.mkdirSync(path.join(root, 'scratchpad'), { recursive: true });

    const emit = vi.fn();
    const manager = Object.create(LibrarianManager.prototype) as {
      moveLibraryItem: (rootPath: string, kind: 'file' | 'dir', sourceRelPath: string, targetDirRelPath: string) => string | null;
      emit: typeof emit;
    };
    Object.defineProperty(manager, 'wikiDir', { value: root });
    manager.emit = emit;

    expect(manager.moveLibraryItem(root, 'dir', 'entries', 'scratchpad')).toBeNull();
    expect(fs.existsSync(path.join(root, 'entries'))).toBe(true);
    expect(emit).not.toHaveBeenCalled();
  });
});

describe('hidden default library folders', () => {
  it('normalizes persisted folder ids to FT folders first, then custom folders', () => {
    expect(normalizeHiddenDefaultFolders(['Client Notes', 'entries', '../bad', 'entries', 'bookmarks-shortcut', 'artifacts', 'Shared Markdown'])).toEqual([
      'artifacts',
      'bookmarks-shortcut',
      'entries',
      'Client Notes',
      'Shared Markdown',
    ]);
    expect(normalizeHiddenDefaultFolders('entries')).toEqual([]);
  });

  it('persists only validated folder ids', () => {
    const saveSettings = vi.fn();
    const emit = vi.fn();
    const manager = Object.create(LibrarianManager.prototype) as {
      settings: { hiddenDefaultFolders?: string[] };
      getHiddenDefaultFolders: () => string[];
      setDefaultFolderHidden: (folderId: string, hidden: boolean) => string[];
      saveSettings: typeof saveSettings;
      emit: typeof emit;
      wikiDir: string;
    };
    manager.settings = { hiddenDefaultFolders: ['entries', '../bad'] };
    manager.saveSettings = saveSettings;
    manager.emit = emit;
    Object.defineProperty(manager, 'wikiDir', { value: '/wiki' });

    expect(manager.setDefaultFolderHidden('scratchpad', true)).toEqual(['scratchpad', 'entries']);
    expect(manager.settings.hiddenDefaultFolders).toEqual(['scratchpad', 'entries']);
    expect(saveSettings).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('library:changed', '/wiki');

    expect(manager.setDefaultFolderHidden('Client Notes', true)).toEqual(['scratchpad', 'entries', 'Client Notes']);
    expect(saveSettings).toHaveBeenCalledTimes(2);

    expect(manager.setDefaultFolderHidden('../bad', true)).toEqual(['scratchpad', 'entries', 'Client Notes']);
    expect(saveSettings).toHaveBeenCalledTimes(2);
  });
});

describe('default folder readmes', () => {
  it('normalizes seeded README ids to the supported defaults in canonical order', () => {
    expect(normalizeSeededReadmes(['entities', 'unknown', 'scratchpad', 'artifacts', 'entities'])).toEqual([
      'scratchpad',
      'entities',
    ]);
    expect(normalizeSeededReadmes(null)).toEqual([]);
  });

  it('seeds READMEs for real wiki folders only and saves once', () => {
    const root = makeTempDir();
    const saveSettings = vi.fn();
    const manager = Object.create(LibrarianManager.prototype) as {
      settings: { readmesSeeded?: string[] };
      ensureDefaultFolderReadmes: () => void;
      saveSettings: typeof saveSettings;
      wikiDir: string;
    };
    manager.settings = { readmesSeeded: [] };
    manager.saveSettings = saveSettings;
    Object.defineProperty(manager, 'wikiDir', { value: root });

    manager.ensureDefaultFolderReadmes();

    for (const folder of ['scratchpad', 'debates', 'Plans', 'entries', 'categories', 'domains', 'entities']) {
      const readmePath = path.join(root, folder, 'README.md');
      expect(fs.existsSync(readmePath)).toBe(true);
      const readme = fs.readFileSync(readmePath, 'utf-8');
      expect(readme).toMatch(/^# README: /);
      expect(readme).toContain('Command+Shift+K');
      expect(readme).toContain('Control+Option+Command+Space');
      expect(readme).toContain('Command+N');
      expect(readme).toContain('watched commands folder');
    }
    expect(fs.existsSync(path.join(root, 'artifacts', 'README.md'))).toBe(false);
    expect(fs.readFileSync(path.join(root, 'scratchpad', 'README.md'), 'utf-8')).toContain('Create a Scratchpad note from anywhere');
    expect(fs.readFileSync(path.join(root, 'debates', 'README.md'), 'utf-8')).toContain('~/.fieldtheory/library/Commands/debate.md');
    expect(fs.readFileSync(path.join(root, 'Plans', 'README.md'), 'utf-8')).toContain('~/.fieldtheory/library/Commands/plan.md');
    expect(fs.existsSync(path.join(root, 'bookmarks', 'README.md'))).toBe(false);
    expect(manager.settings.readmesSeeded).toEqual([
      'scratchpad',
      'debates',
      'Plans',
      'entries',
      'categories',
      'domains',
      'entities',
    ]);
    expect(saveSettings).toHaveBeenCalledTimes(1);
  });

  it('seeds the central artifacts README outside the wiki directory', () => {
    const artifactsDir = makeTempDir();
    const manager = Object.create(LibrarianManager.prototype) as {
      ensureCentralArtifactsReadme: (artifactsDir: string) => void;
    };

    manager.ensureCentralArtifactsReadme(artifactsDir);

    const readme = fs.readFileSync(path.join(artifactsDir, 'README.md'), 'utf-8');
    expect(readme).toContain('~/.fieldtheory/librarian/artifacts/');
    expect(readme).toContain('Show in Finder');
  });

  it('does not overwrite an existing README and still marks the folder handled', () => {
    const root = makeTempDir();
    const entriesDir = path.join(root, 'entries');
    fs.mkdirSync(entriesDir, { recursive: true });
    fs.writeFileSync(path.join(entriesDir, 'README.md'), '# Custom\n');

    const manager = Object.create(LibrarianManager.prototype) as {
      settings: { readmesSeeded?: string[] };
      ensureFolderReadme: (folderId: string, absDir: string, content: string) => boolean;
    };
    manager.settings = { readmesSeeded: [] };

    expect(manager.ensureFolderReadme('entries', entriesDir, '# Default\n')).toBe(true);
    expect(fs.readFileSync(path.join(entriesDir, 'README.md'), 'utf-8')).toBe('# Custom\n');
    expect(manager.settings.readmesSeeded).toEqual(['entries']);
  });

  it('updates an existing legacy default README without touching custom README content', () => {
    const root = makeTempDir();
    const entriesDir = path.join(root, 'entries');
    fs.mkdirSync(entriesDir, { recursive: true });
    const readmePath = path.join(entriesDir, 'README.md');
    fs.writeFileSync(readmePath, '# Old Default\n');

    const manager = Object.create(LibrarianManager.prototype) as {
      settings: { readmesSeeded?: string[] };
      ensureFolderReadme: (folderId: string, absDir: string, content: string, legacyContents?: string[]) => boolean;
    };
    manager.settings = { readmesSeeded: ['entries'] };

    expect(manager.ensureFolderReadme('entries', entriesDir, '# New Default\n', ['# Old Default\n'])).toBe(true);
    expect(fs.readFileSync(readmePath, 'utf-8')).toBe('# New Default\n');

    fs.writeFileSync(readmePath, '# Custom\n');
    expect(manager.ensureFolderReadme('entries', entriesDir, '# Newer Default\n', ['# Old Default\n'])).toBe(false);
    expect(fs.readFileSync(readmePath, 'utf-8')).toBe('# Custom\n');
  });

  it('does not resurrect a deleted README after the folder is marked handled', () => {
    const root = makeTempDir();
    const scratchpadDir = path.join(root, 'scratchpad');

    const manager = Object.create(LibrarianManager.prototype) as {
      settings: { readmesSeeded?: string[] };
      ensureFolderReadme: (folderId: string, absDir: string, content: string) => boolean;
    };
    manager.settings = { readmesSeeded: ['scratchpad'] };

    expect(manager.ensureFolderReadme('scratchpad', scratchpadDir, '# Scratchpad\n')).toBe(false);
    expect(fs.existsSync(path.join(scratchpadDir, 'README.md'))).toBe(false);
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

describe('librarian user data', () => {
  it('answers setup status from per-user settings as soon as a logged-in user data manager is attached', () => {
    const rootDir = makeTempDir();
    const userDir = path.join(rootDir, 'users', 'current-user');
    fs.mkdirSync(userDir, { recursive: true });
    fs.writeFileSync(
      path.join(rootDir, 'librarian-settings.json'),
      JSON.stringify({ librarianSetupComplete: false }),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(userDir, 'librarian-settings.json'),
      JSON.stringify({ librarianSetupComplete: true }),
      'utf-8',
    );

    const loadIndex = vi.fn();
    const invalidateWikiTreeCache = vi.fn();
    const invalidateLibraryRootsCache = vi.fn();
    const manager = Object.create(LibrarianManager.prototype) as {
      userDataManager: unknown;
      settingsPath: string;
      indexPath: string;
      settings: unknown;
      setUserDataManager: LibrarianManager['setUserDataManager'];
      isSetupComplete: LibrarianManager['isSetupComplete'];
      loadIndex: typeof loadIndex;
      invalidateWikiTreeCache: typeof invalidateWikiTreeCache;
      invalidateLibraryRootsCache: typeof invalidateLibraryRootsCache;
    };
    manager.settingsPath = path.join(rootDir, 'librarian-settings.json');
    manager.indexPath = path.join(rootDir, 'librarian-index.json');
    manager.settings = { librarianSetupComplete: false };
    manager.loadIndex = loadIndex;
    manager.invalidateWikiTreeCache = invalidateWikiTreeCache;
    manager.invalidateLibraryRootsCache = invalidateLibraryRootsCache;

    manager.setUserDataManager({
      isLoggedIn: () => true,
      getUserDataPath: (subpath?: string) => subpath ? path.join(userDir, subpath) : userDir,
    } as any);

    expect(loadIndex).toHaveBeenCalledTimes(1);
    expect(manager.isSetupComplete()).toBe(true);
    expect(manager.settingsPath).toBe(path.join(userDir, 'librarian-settings.json'));
    expect(invalidateWikiTreeCache).toHaveBeenCalledTimes(1);
    expect(invalidateLibraryRootsCache).toHaveBeenCalledTimes(1);
  });

  it('repairs stale root settings before answering setup status', () => {
    const rootDir = makeTempDir();
    const userDir = path.join(rootDir, 'users', 'current-user');
    fs.mkdirSync(userDir, { recursive: true });
    fs.writeFileSync(
      path.join(userDir, 'librarian-settings.json'),
      JSON.stringify({ librarianSetupComplete: true }),
      'utf-8',
    );

    const loadIndex = vi.fn();
    const invalidateWikiTreeCache = vi.fn();
    const invalidateLibraryRootsCache = vi.fn();
    const manager = Object.create(LibrarianManager.prototype) as {
      userDataManager: unknown;
      settingsPath: string;
      indexPath: string;
      settings: unknown;
      isSetupComplete: LibrarianManager['isSetupComplete'];
      loadIndex: typeof loadIndex;
      invalidateWikiTreeCache: typeof invalidateWikiTreeCache;
      invalidateLibraryRootsCache: typeof invalidateLibraryRootsCache;
    };
    manager.userDataManager = {
      isLoggedIn: () => true,
      getUserDataPath: (subpath?: string) => subpath ? path.join(userDir, subpath) : userDir,
    };
    manager.settingsPath = path.join(rootDir, 'librarian-settings.json');
    manager.indexPath = path.join(rootDir, 'librarian-index.json');
    manager.settings = { librarianSetupComplete: false };
    manager.loadIndex = loadIndex;
    manager.invalidateWikiTreeCache = invalidateWikiTreeCache;
    manager.invalidateLibraryRootsCache = invalidateLibraryRootsCache;

    expect(manager.isSetupComplete()).toBe(true);
    expect(manager.settingsPath).toBe(path.join(userDir, 'librarian-settings.json'));
    expect(loadIndex).toHaveBeenCalledTimes(1);
    expect(invalidateWikiTreeCache).toHaveBeenCalledTimes(1);
    expect(invalidateLibraryRootsCache).toHaveBeenCalledTimes(1);
  });
});

describe('librarian setup inference', () => {
  it('treats saved setup completion as complete without scanning content', () => {
    const rootDir = makeTempDir();
    const settingsPath = path.join(rootDir, 'librarian-settings.json');
    const libraryPath = path.join(rootDir, 'Library');
    fs.writeFileSync(settingsPath, JSON.stringify({ librarianSetupComplete: true }), 'utf-8');

    expect(inferLibrarianSetupComplete({ settingsPath, libraryPath })).toBe(true);
  });

  it('treats existing visible library documents as setup completion', () => {
    const rootDir = makeTempDir();
    const libraryPath = path.join(rootDir, 'Library');
    fs.mkdirSync(path.join(libraryPath, 'Plans'), { recursive: true });
    fs.writeFileSync(path.join(libraryPath, 'Plans', 'launch-plan.md'), '# Launch plan\n', 'utf-8');

    expect(hasExistingLibraryContent(libraryPath)).toBe(true);
    expect(inferLibrarianSetupComplete({ libraryPath })).toBe(true);
  });

  it('does not count app-seeded readmes or hidden asset folders as setup content', () => {
    const rootDir = makeTempDir();
    const libraryPath = path.join(rootDir, 'Library');
    fs.mkdirSync(path.join(libraryPath, 'scratchpad'), { recursive: true });
    fs.mkdirSync(path.join(libraryPath, '.assets'), { recursive: true });
    fs.writeFileSync(path.join(libraryPath, 'scratchpad', 'README.md'), '# Scratchpad\n', 'utf-8');
    fs.writeFileSync(path.join(libraryPath, '.assets', 'hidden.md'), '# Hidden\n', 'utf-8');

    expect(hasExistingLibraryContent(libraryPath)).toBe(false);
    expect(inferLibrarianSetupComplete({ libraryPath })).toBe(false);
  });
});

describe('library roots', () => {
  it('rejects adding the whole home folder as a library root', () => {
    const manager = Object.create(LibrarianManager.prototype) as LibrarianManager;

    expect(() => manager.addLibraryRoot(process.env.HOME ?? os.homedir())).toThrow(/whole home folder/);
  });

  it('prunes an unsafe persisted home-folder library root', () => {
    const saveSettings = vi.fn();
    const manager = Object.create(LibrarianManager.prototype) as {
      settings: { libraryRoots: string[] };
      saveSettings: typeof saveSettings;
      getSafeLibraryRootPaths: () => string[];
    };
    manager.settings = { libraryRoots: [process.env.HOME ?? os.homedir()] };
    manager.saveSettings = saveSettings;

    expect(manager.getSafeLibraryRootPaths()).toEqual([]);
    expect(manager.settings.libraryRoots).toEqual([]);
    expect(saveSettings).toHaveBeenCalledTimes(1);
  });
});

describe('wiki rename', () => {
  it('renames a wiki page without changing its markdown body', () => {
    const root = makeTempDir();
    fs.mkdirSync(path.join(root, 'entries'), { recursive: true });
    fs.writeFileSync(path.join(root, 'entries', 'untitled.md'), '# Untitled\n\nBody\n', 'utf-8');

    const manager = Object.create(LibrarianManager.prototype) as LibrarianManager;
    Object.defineProperty(manager, 'wikiDir', { value: root });

    expect(manager.renameWikiPage('entries/untitled', 'New Title')).toBe('entries/New Title');
    expect(fs.existsSync(path.join(root, 'entries', 'untitled.md'))).toBe(false);
    expect(fs.readFileSync(path.join(root, 'entries', 'New Title.md'), 'utf-8')).toBe('# Untitled\n\nBody\n');
  });

  it('finds a wiki page after an external filename rename', () => {
    const root = makeTempDir();
    fs.mkdirSync(path.join(root, 'scratchpad'), { recursive: true });
    const oldPath = path.join(root, 'scratchpad', 'Old Name.md');
    const newPath = path.join(root, 'scratchpad', 'New Name.md');
    fs.writeFileSync(oldPath, 'Body\n', 'utf-8');
    const version = readDocumentVersion(oldPath);
    fs.renameSync(oldPath, newPath);

    const manager = Object.create(LibrarianManager.prototype) as LibrarianManager;
    Object.defineProperty(manager, 'wikiDir', { value: root });

    const page = manager.findWikiPageByDocumentVersion(version, 'scratchpad/Old Name');

    expect(page?.relPath).toBe('scratchpad/New Name');
    expect(page?.title).toBe('New Name');
    expect(page?.content).toBe('Body\n');
  });
});
