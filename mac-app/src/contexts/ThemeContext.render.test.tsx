import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider, useTheme } from './ThemeContext';

function ThemeProbe() {
  const { theme, accentPreset, darkModeIntensity } = useTheme();
  return (
    <div>
      <span data-testid="is-dark">{String(theme.isDark)}</span>
      <span data-testid="glass-enabled">{String(theme.glassEnabled)}</span>
      <span data-testid="accent-preset">{accentPreset}</span>
      <span data-testid="dark-mode-intensity">{darkModeIntensity}</span>
    </div>
  );
}

describe('ThemeProvider native renderer-storage sync', () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: vi.fn((key: string) => storage.get(key) ?? null),
        setItem: vi.fn((key: string, value: string) => {
          storage.set(key, value);
        }),
        removeItem: vi.fn((key: string) => {
          storage.delete(key);
        }),
      },
    });
    Object.defineProperty(window, 'themeAPI', {
      configurable: true,
      value: {
        onThemeChanged: vi.fn(() => vi.fn()),
        getTheme: vi.fn(async () => false),
        setTheme: vi.fn(async () => undefined),
      },
    });
  });

  afterEach(() => {
    delete window.themeAPI;
    vi.restoreAllMocks();
  });

  it('updates a mounted provider when native renderer preferences change', async () => {
    window.localStorage.setItem('darkMode', 'false');
    window.localStorage.setItem('glassEffect', 'true');
    window.localStorage.setItem('accentPreset', 'forest');
    window.localStorage.setItem('darkModeIntensity', '50');

    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>
    );

    expect(screen.getByTestId('is-dark').textContent).toBe('false');
    expect(screen.getByTestId('glass-enabled').textContent).toBe('true');
    expect(screen.getByTestId('accent-preset').textContent).toBe('forest');
    expect(screen.getByTestId('dark-mode-intensity').textContent).toBe('50');

    act(() => {
      window.localStorage.setItem('darkMode', 'true');
      window.dispatchEvent(new CustomEvent('fieldtheory:renderer-storage-changed', {
        detail: { key: 'darkMode', value: 'true' },
      }));
      window.localStorage.setItem('glassEffect', 'false');
      window.dispatchEvent(new CustomEvent('fieldtheory:renderer-storage-changed', {
        detail: { key: 'glassEffect', value: 'false' },
      }));
      window.localStorage.setItem('accentPreset', 'ocean');
      window.dispatchEvent(new CustomEvent('fieldtheory:renderer-storage-changed', {
        detail: { key: 'accentPreset', value: 'ocean' },
      }));
      window.localStorage.setItem('darkModeIntensity', '75');
      window.dispatchEvent(new CustomEvent('fieldtheory:renderer-storage-changed', {
        detail: { key: 'darkModeIntensity', value: '75' },
      }));
    });

    await waitFor(() => expect(screen.getByTestId('is-dark').textContent).toBe('true'));
    expect(screen.getByTestId('glass-enabled').textContent).toBe('false');
    expect(screen.getByTestId('accent-preset').textContent).toBe('ocean');
    expect(screen.getByTestId('dark-mode-intensity').textContent).toBe('75');
  });

  it('ignores unrelated and invalid native renderer preference changes', async () => {
    window.localStorage.setItem('accentPreset', 'forest');
    window.localStorage.setItem('darkModeIntensity', '50');

    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>
    );

    act(() => {
      window.localStorage.setItem('accentPreset', 'invalid');
      window.dispatchEvent(new CustomEvent('fieldtheory:renderer-storage-changed', {
        detail: { key: 'accentPreset', value: 'invalid' },
      }));
      window.localStorage.setItem('darkModeIntensity', '500');
      window.dispatchEvent(new CustomEvent('fieldtheory:renderer-storage-changed', {
        detail: { key: 'darkModeIntensity', value: '500' },
      }));
      window.localStorage.setItem('bookmarks-view-mode', 'list');
      window.dispatchEvent(new CustomEvent('fieldtheory:renderer-storage-changed', {
        detail: { key: 'bookmarks-view-mode', value: 'list' },
      }));
    });

    await waitFor(() => expect(screen.getByTestId('accent-preset').textContent).toBe('forest'));
    expect(screen.getByTestId('dark-mode-intensity').textContent).toBe('50');
  });
});
