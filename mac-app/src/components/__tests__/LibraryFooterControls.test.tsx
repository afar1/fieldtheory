import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LibraryFooterLogo } from '../LibraryFooterControls';

const lightTheme = {
  accent: '#0f766e',
  bgSecondary: '#f5f4f2',
  border: '#d1d5db',
  error: '#dc2626',
  textSecondary: '#666666',
  isDark: false,
};

describe('LibraryFooterLogo', () => {
  it('renders the Field Theory footer logo in light mode', () => {
    render(<LibraryFooterLogo theme={lightTheme} />);

    const logo = document.querySelector('img[aria-label="Field Theory"]') as HTMLImageElement | null;
    if (!logo) throw new Error('Field Theory logo missing');
    expect(logo.getAttribute('src')).toBe('/field-theory-icon-black.png');
    expect(logo.style.display).toBe('block');
  });

  it('renders the Field Theory footer logo in dark mode', () => {
    render(<LibraryFooterLogo theme={{ ...lightTheme, isDark: true }} />);

    const logo = document.querySelector('img[aria-label="Field Theory"]') as HTMLImageElement | null;
    if (!logo) throw new Error('Field Theory logo missing');
    expect(logo.getAttribute('src')).toBe('/fieldtheory-icon.png');
  });
});
