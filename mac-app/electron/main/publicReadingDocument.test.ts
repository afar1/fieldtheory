import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  hasStrongUnlistedReadingSlug,
  publicReadingSlug,
  resolvePublicReadingDocument,
  resolvePublicReadingSourcePath,
} from './publicReadingDocument';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'field-theory-public-reading-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('resolvePublicReadingDocument', () => {
  it('preserves an indexed Librarian reading', () => {
    const cached = {
      path: '/tmp/indexed.md',
      title: 'Indexed title',
      content: '# Indexed title\n',
    };

    expect(resolvePublicReadingDocument('/tmp/indexed.md', cached, [])).toEqual(cached);
  });

  it('loads a canonical Library markdown file that is not in the reading cache', () => {
    const root = makeTempDir();
    const filePath = path.join(root, 'briefs', 'morning-edition.md');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, '![Cover](../.assets/cover.png)\n\n# Morning Edition\n\nNews.\n');

    expect(resolvePublicReadingDocument(filePath, null, [root])).toEqual({
      path: fs.realpathSync(filePath),
      title: 'Morning Edition',
      content: '![Cover](../.assets/cover.png)\n\n# Morning Edition\n\nNews.\n',
    });
  });

  it('uses the filename when a Library document has no H1', () => {
    const root = makeTempDir();
    const filePath = path.join(root, 'Field Notes.md');
    fs.writeFileSync(filePath, 'Notes without a title.\n');

    expect(resolvePublicReadingDocument(filePath, null, [root])?.title).toBe('Field Notes');
  });

  it('rejects non-Markdown files and paths outside the Library roots', () => {
    const root = makeTempDir();
    const outside = makeTempDir();
    const textPath = path.join(root, 'notes.txt');
    const outsidePath = path.join(outside, 'outside.md');
    fs.writeFileSync(textPath, 'text');
    fs.writeFileSync(outsidePath, '# Outside\n');

    expect(resolvePublicReadingDocument(textPath, null, [root])).toBeNull();
    expect(resolvePublicReadingDocument(outsidePath, null, [root])).toBeNull();
  });

  it('rejects a Library symlink whose target is outside the Library roots', () => {
    const root = makeTempDir();
    const outside = makeTempDir();
    const outsidePath = path.join(outside, 'outside.md');
    const linkPath = path.join(root, 'linked.md');
    fs.writeFileSync(outsidePath, '# Outside\n');
    fs.symlinkSync(outsidePath, linkPath);

    expect(resolvePublicReadingDocument(linkPath, null, [root])).toBeNull();
    expect(resolvePublicReadingSourcePath(linkPath, {
      path: linkPath,
      title: 'Outside',
      content: '# Outside\n',
    }, [root])).toBeNull();
  });

  it('preserves a cached reading from the existing watched-directory contract', () => {
    const watchedRoot = makeTempDir();
    const filePath = path.join(watchedRoot, 'Watched.md');
    const cached = { path: filePath, title: 'Watched', content: '# Watched\n' };
    fs.writeFileSync(filePath, cached.content);

    expect(resolvePublicReadingSourcePath(filePath, cached, [])).toBe(filePath);
  });
});

describe('publicReadingSlug', () => {
  const randomHex = (bytes: number) => 'a'.repeat(bytes * 2);

  it('uses 128 bits of random suffix for a new unlisted reading', () => {
    const slug = publicReadingSlug('Morning Edition', 'unlisted', undefined, randomHex);
    expect(slug).toBe(`morning-edition-${'a'.repeat(32)}`);
    expect(hasStrongUnlistedReadingSlug(slug)).toBe(true);
  });

  it('rotates a listed slug when the reading becomes unlisted', () => {
    const slug = publicReadingSlug(
      'Morning Edition',
      'unlisted',
      { slug: 'morning-edition-abcdef', visibility: 'listed' },
      randomHex,
    );
    expect(slug).toBe(`morning-edition-${'a'.repeat(32)}`);
  });

  it('keeps an existing strong unlisted slug stable', () => {
    const existing = `morning-edition-${'b'.repeat(32)}`;
    expect(publicReadingSlug(
      'Renamed Morning Edition',
      'unlisted',
      { slug: existing, visibility: 'unlisted' },
      randomHex,
    )).toBe(existing);
  });
});
