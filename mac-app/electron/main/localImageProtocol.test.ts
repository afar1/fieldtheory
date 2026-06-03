import { describe, expect, it } from 'vitest';
import {
  getLocalImageCacheHeaders,
  getLocalImageContentType,
  isAllowedLocalImagePath,
  localImagePathFromProtocolUrl,
  shouldReturnLocalImageNotModified,
} from './localImageProtocol';

describe('local image protocol helpers', () => {
  it('decodes ftlocalfile URLs into absolute paths', () => {
    expect(localImagePathFromProtocolUrl(
      'ftlocalfile:///Users/afar/Library/Application%20Support/fieldtheory-mac/users/u/figures/Screenshot%201.png',
    )).toBe('/Users/afar/Library/Application Support/fieldtheory-mac/users/u/figures/Screenshot 1.png');
  });

  it('keeps the host segment when Electron normalizes ftlocalfile URLs', () => {
    expect(localImagePathFromProtocolUrl(
      'ftlocalfile://users/afar/Library/Application%20Support/fieldtheory-mac/users/u/figures/Screenshot%201.png',
    )).toBe('/Users/afar/Library/Application Support/fieldtheory-mac/users/u/figures/Screenshot 1.png');
  });

  it('rejects unparseable protocol URLs', () => {
    expect(localImagePathFromProtocolUrl('http://[bad')).toBeNull();
  });

  it('allows only absolute image paths', () => {
    expect(isAllowedLocalImagePath('/tmp/Figure 1.png')).toBe(true);
    expect(isAllowedLocalImagePath('/tmp/Figure 1.txt')).toBe(false);
    expect(isAllowedLocalImagePath('Figure 1.png')).toBe(false);
  });

  it('returns image content types by extension', () => {
    expect(getLocalImageContentType('/tmp/photo.jpg')).toBe('image/jpeg');
    expect(getLocalImageContentType('/tmp/vector.svg')).toBe('image/svg+xml');
    expect(getLocalImageContentType('/tmp/screenshot.png')).toBe('image/png');
  });

  it('returns cache validators from image file metadata', () => {
    const headers = getLocalImageCacheHeaders({ mtimeMs: Date.UTC(2026, 0, 2, 3, 4, 5), size: 12345 });

    expect(headers['Cache-Control']).toBe('private, max-age=3600');
    expect(headers.ETag).toBe('"mjwaid1k-9ix"');
    expect(headers['Last-Modified']).toBe('Fri, 02 Jan 2026 03:04:05 GMT');
  });

  it('matches local image cache validators from request headers', () => {
    const stat = { mtimeMs: Date.UTC(2026, 0, 2, 3, 4, 5), size: 12345 };
    const cacheHeaders = getLocalImageCacheHeaders(stat);

    expect(shouldReturnLocalImageNotModified(stat, { ifNoneMatch: cacheHeaders.ETag })).toBe(true);
    expect(shouldReturnLocalImageNotModified(stat, { ifModifiedSince: cacheHeaders['Last-Modified'] })).toBe(true);
    expect(shouldReturnLocalImageNotModified(stat, { ifNoneMatch: '"different"' })).toBe(false);
  });
});
