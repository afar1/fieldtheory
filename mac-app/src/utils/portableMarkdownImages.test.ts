import { afterEach, describe, expect, it } from 'vitest';
import { normalizeMarkdownImageUrl, resolveRelativeMarkdownImageUrl } from './portableMarkdownImages';

describe('portable markdown images', () => {
  afterEach(() => {
    delete window.fieldTheoryLocalImageAPI;
  });

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

  it('renders raw absolute local image paths from paste flows', () => {
    expect(normalizeMarkdownImageUrl(
      '/Users/afar/Library/Application Support/fieldtheory-mac/users/u/figures/Screenshot 1.png',
      '/Users/afar/Google Drive/Team Notes.md',
    )).toBe('ftlocalfile:///Users/afar/Library/Application%20Support/fieldtheory-mac/users/u/figures/Screenshot%201.png');
  });

  it('routes local image URLs through the browser helper when available', () => {
    window.fieldTheoryLocalImageAPI = {
      localImageUrl: (url) => `/native/local-image?url=${encodeURIComponent(url)}`,
    };

    expect(normalizeMarkdownImageUrl(
      'file:///Users/afar/Library/Application%20Support/fieldtheory-mac/users/u/figures/Screenshot%201.png',
      '/Users/afar/Google Drive/Team Notes.md',
    )).toBe('/native/local-image?url=ftlocalfile%3A%2F%2F%2FUsers%2Fafar%2FLibrary%2FApplication%2520Support%2Ffieldtheory-mac%2Fusers%2Fu%2Ffigures%2FScreenshot%25201.png');
  });

  it('does not resolve relative non-image links', () => {
    expect(resolveRelativeMarkdownImageUrl('./notes.md', '/Users/afar/Notes/Team.md')).toBeNull();
  });
});
