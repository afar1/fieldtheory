// =============================================================================
// ThemeContext - Provides theme (light/dark) based on system preference
// with glass effect toggle for performance
// =============================================================================

import { createContext, useContext, useState, ReactNode } from 'react';

type Theme = {
  isDark: boolean;
  glassEnabled: boolean;
  bg: string;
  bgSecondary: string;
  text: string;
  textSecondary: string;
  border: string;
  accent: string;
  accentHover: string;
  selectedBg: string;
  selectedBorder: string;
  inputBg: string;
  inputBorder: string;
};

const lightTheme: Omit<Theme, 'isDark' | 'glassEnabled'> = {
  bg: '#ffffff',
  bgSecondary: '#fafafa',
  text: '#333333',
  textSecondary: '#666666',
  border: '#e0e0e0',
  accent: '#007AFF',
  accentHover: '#0051D5',
  selectedBg: 'rgba(20, 184, 166, 0.08)',  // Light teal for X-selected items
  selectedBorder: '#5eead4',  // Muted teal border (less bright than J/K)
  inputBg: '#ffffff',
  inputBorder: '#e0e0e0',
};

const darkThemeSolid: Omit<Theme, 'isDark' | 'glassEnabled'> = {
  bg: '#1e1e1e',
  bgSecondary: '#2d2d2d',
  text: '#ffffff',
  textSecondary: '#aaaaaa',
  border: 'rgba(255, 255, 255, 0.1)',
  accent: '#0A84FF',
  accentHover: '#409CFF',
  selectedBg: 'rgba(45, 212, 191, 0.12)',  // Light teal for X-selected items
  selectedBorder: '#5eead4',  // Muted teal border (less bright than J/K)
  inputBg: '#2d2d2d',
  inputBorder: 'rgba(255, 255, 255, 0.15)',
};

const darkThemeGlass: Omit<Theme, 'isDark' | 'glassEnabled'> = {
  bg: 'rgba(30, 30, 30, 0.85)',
  bgSecondary: 'rgba(45, 45, 45, 0.9)',
  text: '#ffffff',
  textSecondary: '#aaaaaa',
  border: 'rgba(255, 255, 255, 0.1)',
  accent: '#0A84FF',
  accentHover: '#409CFF',
  selectedBg: 'rgba(45, 212, 191, 0.12)',  // Light teal for X-selected items
  selectedBorder: '#5eead4',  // Muted teal border (less bright than J/K)
  inputBg: 'rgba(45, 45, 45, 0.9)',
  inputBorder: 'rgba(255, 255, 255, 0.15)',
};

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

