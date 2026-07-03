import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LibraryFocusChromeIcon } from '../LibrarySurfaceTopTabs';

describe('LibraryFocusChromeIcon', () => {
  it('uses root-relative icon paths for browser-hosted immersive chrome', () => {
    const { container, rerender } = render(
      <LibraryFocusChromeIcon
        isDark={false}
        top={32}
        contentCenterX={null}
        opacity={0.62}
      />
    );

    expect(container.querySelector('img')?.getAttribute('src')).toBe('/field-theory-icon-black.png');

    rerender(
      <LibraryFocusChromeIcon
        isDark
        top={32}
        contentCenterX={null}
        opacity={0.62}
      />
    );

    expect(container.querySelector('img')?.getAttribute('src')).toBe('/fieldtheory-icon.png');
  });
});
