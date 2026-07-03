import { describe, expect, it } from 'vitest';
import {
  removeWikiIndexPages,
  renameWikiIndexPages,
  upsertWikiIndexPages,
  wikiIndexPagesFromTree,
  wikiTargetPartsFromUnresolvedTitle,
} from '../utils/wikiIndexPages';

describe('wikiIndexPages helpers', () => {
  it('upserts wiki index pages by relPath', () => {
    const initial = [{ relPath: 'briefs/a', title: 'A' }];
    expect(upsertWikiIndexPages(initial, { relPath: 'briefs/b', title: 'B' })).toEqual([
      { relPath: 'briefs/a', title: 'A' },
      { relPath: 'briefs/b', title: 'B' },
    ]);
    expect(upsertWikiIndexPages(initial, { relPath: 'briefs/a', title: 'A2', absPath: '/tmp/a.md' })).toEqual([
      { relPath: 'briefs/a', title: 'A2', absPath: '/tmp/a.md' },
    ]);
  });

  it('removes and renames wiki index pages', () => {
    const initial = [
      { relPath: 'briefs/a', title: 'A' },
      { relPath: 'briefs/b', title: 'B' },
    ];
    expect(removeWikiIndexPages(initial, ['briefs/a'])).toEqual([
      { relPath: 'briefs/b', title: 'B' },
    ]);
    expect(renameWikiIndexPages(initial, 'briefs/b', 'briefs/c', { title: 'C' })).toEqual([
      { relPath: 'briefs/a', title: 'A' },
      { relPath: 'briefs/c', title: 'C' },
    ]);
  });

  it('flattens wiki tree folders into index pages', () => {
    expect(wikiIndexPagesFromTree([
      {
        files: [
          { relPath: 'briefs/one', title: 'One', absPath: '/wiki/briefs/one.md' },
        ],
      },
      {
        files: [
          { relPath: 'scratchpad/two', title: 'Two', absPath: '/wiki/scratchpad/two.md' },
        ],
      },
    ])).toEqual([
      { relPath: 'briefs/one', title: 'One', absPath: '/wiki/briefs/one.md' },
      { relPath: 'scratchpad/two', title: 'Two', absPath: '/wiki/scratchpad/two.md' },
    ]);
  });

  it('splits unresolved path-style wiki targets into folder and file name', () => {
    expect(wikiTargetPartsFromUnresolvedTitle('briefs/Field Theory FT Improvements Brief')).toEqual({
      folder: 'briefs',
      fileName: 'Field Theory FT Improvements Brief',
      relPath: 'briefs/Field Theory FT Improvements Brief',
    });
    expect(wikiTargetPartsFromUnresolvedTitle('Field Theory')).toEqual({
      folder: 'scratchpad',
      fileName: 'Field Theory',
      relPath: 'scratchpad/Field Theory',
    });
  });
});
