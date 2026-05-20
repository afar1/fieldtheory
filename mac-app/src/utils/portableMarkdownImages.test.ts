import { describe, expect, it } from 'vitest';
import { normalizeMarkdownImageUrl, resolveRelativeMarkdownImageUrl } from './portableMarkdownImages';

describe('portable markdown images', () => {
  it('resolves relative image links from the markdown document folder', () => {
    expect(resolveRelativeMarkdownImageUrl(
      './Team%20Notes.assets/Screenshot%201.png',
      '/Users/afar/Google Drive/Team Notes.md',
    )).toBe('ftlocalfile:///Users/afar/Google%20Drive/Team%20Notes.assets/Screenshot%201.png');
  });

  it('preserves existing absolute local image rendering', () => {
    expect(normalizeMarkdownImageUrl(
      'file:///Users/afar/Library/Application%20Support/fieldtheory-mac/users/u/figures/Screenshot%201.png',
      '/Users/afar/Google Drive/Team Notes.md',
    )).toBe('ftlocalfile:///Users/afar/Library/Application%20Support/fieldtheory-mac/users/u/figures/Screenshot%201.png');
  });

  it('does not resolve relative non-image links', () => {
    expect(resolveRelativeMarkdownImageUrl('./notes.md', '/Users/afar/Notes/Team.md')).toBeNull();
  });
});
