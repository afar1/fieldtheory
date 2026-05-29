import { describe, expect, it } from 'vitest';
import { resolveStartupThemePreference } from './ThemeContext';

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
