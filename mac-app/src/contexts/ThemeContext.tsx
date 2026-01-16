// =============================================================================
// ThemeContext - Provides theme (light/dark) with manual toggle.
// Uses unified design tokens for consistency across all windows.
// Syncs theme preference via IPC for multi-window support.
// =============================================================================

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import {
  Theme,
  lightTheme,
  darkThemeSolid,
  darkThemeGlass,
} from '../design/tokens';

interface ThemeContextType {
  theme: Theme;
  toggleGlass: () => void;
  toggleDarkMode: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [isDark, setIsDark] = useState(() => {
    // Default to light mode, check localStorage for saved preference
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('darkMode');
      if (saved !== null) {
        return saved === 'true';
      }
    }
    return false;
  });

  const [glassEnabled, setGlassEnabled] = useState(() => {
    // Default to enabled, check localStorage for saved preference.
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('glassEffect');
      if (saved !== null) {
        return saved === 'true';
      }
    }
    return true;
  });

  // Listen for theme changes from other windows via IPC
  useEffect(() => {
    if (typeof window === 'undefined' || !window.themeAPI) return;

    const unsubscribe = window.themeAPI.onThemeChanged((newIsDark: boolean) => {
      setIsDark(newIsDark);
      localStorage.setItem('darkMode', String(newIsDark));
    });

    // Get initial theme from main process
    window.themeAPI.getTheme?.().then((savedIsDark: boolean) => {
      if (savedIsDark !== isDark) {
        setIsDark(savedIsDark);
        localStorage.setItem('darkMode', String(savedIsDark));
      }
    });

    return unsubscribe;
  }, []);

  const toggleDarkMode = () => {
    const newValue = !isDark;
    setIsDark(newValue);
    localStorage.setItem('darkMode', String(newValue));

    // Notify main process to sync to other windows
    window.themeAPI?.setTheme?.(newValue);
  };

  const toggleGlass = () => {
    const newValue = !glassEnabled;
    setGlassEnabled(newValue);
    localStorage.setItem('glassEffect', String(newValue));
  };

  const darkTheme = glassEnabled ? darkThemeGlass : darkThemeSolid;
  const theme: Theme = {
    isDark,
    glassEnabled,
    ...(isDark ? darkTheme : lightTheme),
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleGlass, toggleDarkMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
