import { describe, expect, it } from 'vitest';
import { getLocalImageContentType, isAllowedLocalImagePath, localImagePathFromProtocolUrl } from './localImageProtocol';

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
});
