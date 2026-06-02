import { describe, expect, it } from 'vitest';
import { isThemeRendererStoragePreferenceKey, resolveStartupThemePreference } from './ThemeContext';

describe('resolveStartupThemePreference', () => {
  it('keeps explicit renderer dark mode and asks main to catch up', () => {
    expect(resolveStartupThemePreference({
      localSaved: 'true',
      mainIsDark: false,
      currentIsDark: true,
    })).toEqual({
      nextIsDark: true,
      syncMainToDark: true,
      writeLocalStorage: false,
    });
  });

  it('keeps explicit renderer light mode and asks main to catch up', () => {
    expect(resolveStartupThemePreference({
      localSaved: 'false',
      mainIsDark: true,
      currentIsDark: false,
    })).toEqual({
      nextIsDark: false,
      syncMainToDark: false,
      writeLocalStorage: false,
    });
  });

  it('uses main theme when the renderer has no saved preference', () => {
    expect(resolveStartupThemePreference({
      localSaved: null,
      mainIsDark: true,
      currentIsDark: false,
    })).toEqual({
      nextIsDark: true,
      syncMainToDark: null,
      writeLocalStorage: true,
    });
  });
});

describe('isThemeRendererStoragePreferenceKey', () => {
  it('accepts native renderer-storage theme preference keys only', () => {
    expect(isThemeRendererStoragePreferenceKey('darkMode')).toBe(true);
    expect(isThemeRendererStoragePreferenceKey('glassEffect')).toBe(true);
    expect(isThemeRendererStoragePreferenceKey('accentPreset')).toBe(true);
    expect(isThemeRendererStoragePreferenceKey('darkModeIntensity')).toBe(true);
    expect(isThemeRendererStoragePreferenceKey('bookmarks-view-mode')).toBe(false);
    expect(isThemeRendererStoragePreferenceKey(null)).toBe(false);
  });
});
