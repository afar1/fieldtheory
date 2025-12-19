// =============================================================================
// ThemeContext - Provides theme (light/dark) based on system preference
// with glass effect toggle for performance.
// Uses unified design tokens from www/styles.css for consistency.
// =============================================================================

import { createContext, useContext, useState, ReactNode } from 'react';
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

  const toggleDarkMode = () => {
    const newValue = !isDark;
    setIsDark(newValue);
    localStorage.setItem('darkMode', String(newValue));
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

