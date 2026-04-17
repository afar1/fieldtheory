import { describe, expect, it } from 'vitest';
import {
  persistLibrarianSelection,
  resolveWikiCreateFolder,
  restoreLibrarianSelection,
  splitFrontmatter,
} from '../components/LibrarianView';
import { filterUnifiedFolders } from '../components/WikiSidebar';

describe('splitFrontmatter', () => {
  it('strips YAML frontmatter and returns body + metadata', () => {
    const content = `---
tags: [ft/entry, ai]
source_type: authored
---

# My Entry

Body text here.`;
    const result = splitFrontmatter(content);
    expect(result.body).toBe('# My Entry\n\nBody text here.');
    expect(result.meta.tags).toBe('[ft/entry, ai]');
    expect(result.meta.source_type).toBe('authored');
  });

  it('returns raw content when no frontmatter present', () => {
    const content = '# Just a heading\n\nNo frontmatter.';
    const result = splitFrontmatter(content);
    expect(result.body).toBe(content);
    expect(result.meta).toEqual({});
  });

  it('passes through content with empty frontmatter delimiters', () => {
    const content = '---\n---\n\nBody only.';
    const result = splitFrontmatter(content);
    // Empty frontmatter doesn't match the regex (needs at least one line)
    expect(result.body).toBe(content);
    expect(result.meta).toEqual({});
  });

  it('strips leading newlines from body', () => {
    const content = '---\ntags: [test]\n---\n\n\n\nContent after gaps.';
    const result = splitFrontmatter(content);
    expect(result.body).toBe('Content after gaps.');
  });

  it('ignores malformed frontmatter lines', () => {
    const content = '---\ntags: [test]\nno-colon-here\nlast_updated: 2026-04-15\n---\n\nBody.';
    const result = splitFrontmatter(content);
    expect(result.meta.tags).toBe('[test]');
    expect(result.meta.last_updated).toBe('2026-04-15');
    expect(Object.keys(result.meta)).toHaveLength(2);
  });
});

describe('filterUnifiedFolders', () => {
  const folders = [
    {
      name: 'debates',
      label: 'Debates',
      items: [
        {
          id: 'wiki:debates/2026-04-15-wiki-entries-karpathy-refinement',
          title: 'Wiki entries — Karpathy refinement',
          type: 'wiki' as const,
          absPath: '/tmp/debates/2026-04-15-wiki-entries-karpathy-refinement.md',
          relPath: 'debates/2026-04-15-wiki-entries-karpathy-refinement',
          timestamp: 1,
        },
      ],
    },
    {
      name: 'artifacts',
      label: 'Artifacts',
      items: [
        {
          id: 'artifact:/tmp/2026-04-16-consensus-first-debate-artifacts.md',
          title: 'Debate outputs should be consensus-first',
          type: 'artifact' as const,
          absPath: '/tmp/2026-04-16-consensus-first-debate-artifacts.md',
          timestamp: 2,
        },
      ],
    },
  ];

  it('matches by title and keeps only folders with visible results', () => {
    const result = filterUnifiedFolders(folders, 'karpathy');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('debates');
    expect(result[0].items).toHaveLength(1);
  });

  it('matches by path metadata for wiki pages and artifacts', () => {
    const debateResult = filterUnifiedFolders(folders, 'debates/2026-04-15');
    expect(debateResult).toHaveLength(1);
    expect(debateResult[0].name).toBe('debates');

    const artifactResult = filterUnifiedFolders(folders, 'consensus-first-debate-artifacts');
    expect(artifactResult).toHaveLength(1);
    expect(artifactResult[0].name).toBe('artifacts');
  });
});

describe('librarian selection persistence', () => {
  it('restores a stored wiki page selection', () => {
    const storage = {
      getItem: () => JSON.stringify({ type: 'wiki', relPath: '/debates/test-case.md' }),
    };

    expect(restoreLibrarianSelection(storage)).toEqual({
      type: 'wiki',
      relPath: 'debates/test-case',
    });
  });

  it('restores a stored artifact selection', () => {
    const storage = {
      getItem: () => JSON.stringify({ type: 'artifact', path: '/tmp/example.md' }),
    };

    expect(restoreLibrarianSelection(storage)).toEqual({
      type: 'artifact',
      path: '/tmp/example.md',
    });
  });

  it('ignores malformed stored selection payloads', () => {
    const storage = {
      getItem: () => '{"type":"wiki"}',
    };

    expect(restoreLibrarianSelection(storage)).toBeNull();
  });

  it('persists and clears a selection payload', () => {
    const state: Record<string, string> = {};
    const storage = {
      setItem(key: string, value: string) {
        state[key] = value;
      },
      removeItem(key: string) {
        delete state[key];
      },
    };

    persistLibrarianSelection(storage, { type: 'artifact', path: '/tmp/example.md' });
    expect(JSON.parse(state['librarian-last-selection'])).toEqual({
      type: 'artifact',
      path: '/tmp/example.md',
    });

    persistLibrarianSelection(storage, null);
    expect(state['librarian-last-selection']).toBeUndefined();
  });
});

describe('resolveWikiCreateFolder', () => {
  it('keeps explicit wiki folders unchanged', () => {
    expect(resolveWikiCreateFolder('debates', 'wiki', 'debates/example')).toBe('debates');
  });

  it('routes artifact-folder create requests to the selected wiki folder', () => {
    expect(resolveWikiCreateFolder('artifacts', 'wiki', 'debates/example')).toBe('debates');
  });

  it('falls back to entries when no wiki folder is selected', () => {
    expect(resolveWikiCreateFolder('artifacts', 'artifact', '/tmp/example.md')).toBe('entries');
    expect(resolveWikiCreateFolder('', null, null)).toBe('entries');
  });
});
