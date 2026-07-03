import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LibraryFooterLogo, LibraryFooterSidebarToggle } from '../LibraryFooterControls';

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
    expect(logo.getAttribute('src')).toBe('/fieldtheory-logo-black.png');
    expect(logo.style.display).toBe('block');
    expect(logo.style.maxWidth).toBe('132px');
  });

  it('renders the Field Theory footer logo in dark mode', () => {
    render(<LibraryFooterLogo theme={{ ...lightTheme, isDark: true }} />);

    const logo = document.querySelector('img[aria-label="Field Theory"]') as HTMLImageElement | null;
    if (!logo) throw new Error('Field Theory logo missing');
    expect(logo.getAttribute('src')).toBe('/fieldtheory-logo-white.png');
  });
});

describe('LibraryFooterSidebarToggle', () => {
  it('contains pointer and click events inside the toggle button', () => {
    const onToggle = vi.fn();
    const onParentPointerDown = vi.fn();
    const onParentMouseDown = vi.fn();
    const onParentClick = vi.fn();

    render(
      <div
        onPointerDown={onParentPointerDown}
        onMouseDown={onParentMouseDown}
        onClick={onParentClick}
      >
        <LibraryFooterSidebarToggle
          theme={lightTheme}
          collapsed={false}
          enabled
          onToggle={onToggle}
        />
      </div>
    );

    const toggle = screen.getByLabelText('Toggle sidebar');
    fireEvent.pointerDown(toggle);
    fireEvent.mouseDown(toggle);
    fireEvent.click(toggle);

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onParentPointerDown).not.toHaveBeenCalled();
    expect(onParentMouseDown).not.toHaveBeenCalled();
    expect(onParentClick).not.toHaveBeenCalled();
  });
});
