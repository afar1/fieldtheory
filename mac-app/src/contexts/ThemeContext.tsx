// =============================================================================
// ThemeContext - Provides theme (light/dark) with manual toggle.
// Uses unified design tokens for consistency across all windows.
// Syncs theme preference via IPC for multi-window support.
// =============================================================================

import { createContext, useContext, useState, useEffect, ReactNode, useMemo } from 'react';
import {
  Theme,
  lightTheme,
  darkThemeSolid,
  darkThemeGlass,
  AccentPreset,
  accentPresets,
  getAccentHover,
  getSelectedBg,
} from '../design/tokens';

// Re-export Theme for convenience
export type { Theme };

interface ThemeContextType {
  theme: Theme;
  toggleGlass: () => void;
  toggleDarkMode: () => void;
  accentPreset: AccentPreset;
  setAccentPreset: (preset: AccentPreset) => void;
  darkModeIntensity: number;
  setDarkModeIntensity: (intensity: number) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function resolveStartupThemePreference(input: {
  localSaved: string | null;
  mainIsDark: boolean;
  currentIsDark: boolean;
}): { nextIsDark: boolean; syncMainToDark: boolean | null; writeLocalStorage: boolean } {
  if (input.localSaved !== null) {
    const localIsDark = input.localSaved === 'true';
    return {
      nextIsDark: localIsDark,
      syncMainToDark: input.mainIsDark === localIsDark ? null : localIsDark,
      writeLocalStorage: false,
    };
  }

  return {
    nextIsDark: input.mainIsDark,
    syncMainToDark: null,
    writeLocalStorage: input.mainIsDark !== input.currentIsDark,
  };
}

// Helper to interpolate between two colors based on intensity
function interpolateColor(color1: string, color2: string, factor: number): string {
  const c1 = parseInt(color1.replace('#', ''), 16);
  const c2 = parseInt(color2.replace('#', ''), 16);

  const r1 = (c1 >> 16) & 255, g1 = (c1 >> 8) & 255, b1 = c1 & 255;
  const r2 = (c2 >> 16) & 255, g2 = (c2 >> 8) & 255, b2 = c2 & 255;

  const r = Math.round(r1 + (r2 - r1) * factor);
  const g = Math.round(g1 + (g2 - g1) * factor);
  const b = Math.round(b1 + (b2 - b1) * factor);

  return `#${(1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1)}`;
}

// Lighten a hex color by a fixed amount (for creating surface hierarchy)
function lightenColor(hex: string, amount: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, ((num >> 16) & 255) + amount);
  const g = Math.min(255, ((num >> 8) & 255) + amount);
  const b = Math.min(255, (num & 255) + amount);
  return `#${(1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1)}`;
}

// Adjust dark theme colors based on intensity (0 = lighter, 100 = darker)
// Creates a proper surface hierarchy with consistent contrast between levels
function adjustDarkThemeIntensity(baseTheme: typeof darkThemeSolid, intensity: number): typeof darkThemeSolid {
  // Intensity 50 = default, 0 = much lighter, 100 = much darker
  const factor = (intensity - 50) / 50; // -1 to 1

  // Define the base background at different intensity extremes
  const lighterBase = '#2a2d35';  // intensity = 0
  const defaultBase = '#15181e';  // intensity = 50
  const darkerBase = '#08090c';   // intensity = 100

  // Calculate the base background color
  let baseBg: string;
  if (factor < 0) {
    baseBg = interpolateColor(defaultBase, lighterBase, -factor);
  } else {
    baseBg = interpolateColor(defaultBase, darkerBase, factor);
  }

  // Create surface hierarchy with consistent steps (each level ~10-12 units lighter)
  // This ensures list items are always visible against the background
  const surfaceStep = 10; // RGB units between each surface level

  const surface0 = baseBg;                              // Window background
  const surface1 = lightenColor(baseBg, surfaceStep);   // List items, cards
  const surface2 = lightenColor(baseBg, surfaceStep * 2); // Inputs, elevated cards
  const surface3 = lightenColor(baseBg, surfaceStep * 3); // Tooltips, dropdowns

  // List item and hover states
  const listItemBg = surface1;                          // Same as surface1
  const hoverBg = lightenColor(baseBg, surfaceStep + 6); // Between surface1 and surface2

  // Input backgrounds need slightly more contrast
  const inputBg = lightenColor(baseBg, surfaceStep * 2 + 4);

  // Borders need to be visible against the list item background
  // Use a color that's noticeably different from listItemBg
  const border = lightenColor(baseBg, surfaceStep * 2 + 8); // Stronger border

  return {
    ...baseTheme,
    bg: surface0,
    background: surface0,
    bgSecondary: surface1,
    bgTertiary: surface2,
    surface0,
    surface1,
    surface2,
    surface3,
    listItemBg,
    hoverBg,
    inputBg,
    inputBorder: lightenColor(surface2, 15),
    border,
  };
}

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

  const [accentPreset, setAccentPresetState] = useState<AccentPreset>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('accentPreset');
      if (saved && saved in accentPresets) {
        return saved as AccentPreset;
      }
    }
    return 'forest';
  });

  const [darkModeIntensity, setDarkModeIntensityState] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('darkModeIntensity');
      if (saved !== null) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed >= 0 && parsed <= 100) {
          return parsed;
        }
      }
    }
    return 50; // Default to middle (unchanged from original)
  });

  // Listen for theme changes from other windows via IPC
  useEffect(() => {
    if (typeof window === 'undefined' || !window.themeAPI) return;

    const unsubscribe = window.themeAPI.onThemeChanged((newIsDark: boolean) => {
      setIsDark(newIsDark);
      localStorage.setItem('darkMode', String(newIsDark));
    });

    // Prefer renderer localStorage on startup. The main-process preference can
    // lag behind during dev restarts, so sync main to the renderer when the
    // renderer already has an explicit choice.
    window.themeAPI.getTheme?.().then((savedIsDark: boolean) => {
      const resolved = resolveStartupThemePreference({
        localSaved: localStorage.getItem('darkMode'),
        mainIsDark: savedIsDark,
        currentIsDark: isDark,
      });
      if (resolved.syncMainToDark !== null) {
        void window.themeAPI?.setTheme?.(resolved.syncMainToDark);
      }
      if (resolved.nextIsDark !== isDark) {
        setIsDark(resolved.nextIsDark);
      }
      if (resolved.writeLocalStorage) {
        localStorage.setItem('darkMode', String(resolved.nextIsDark));
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

  const setAccentPreset = (preset: AccentPreset) => {
    setAccentPresetState(preset);
    localStorage.setItem('accentPreset', preset);
  };

  const setDarkModeIntensity = (intensity: number) => {
    const clamped = Math.max(0, Math.min(100, intensity));
    setDarkModeIntensityState(clamped);
    localStorage.setItem('darkModeIntensity', String(clamped));
  };

  // Build the theme with accent color and intensity applied
  const theme = useMemo(() => {
    const preset = accentPresets[accentPreset];
    const accentColor = isDark ? preset.dark : preset.light;

    // Get base dark theme and adjust intensity
    let darkTheme = glassEnabled ? darkThemeGlass : darkThemeSolid;
    if (isDark) {
      darkTheme = adjustDarkThemeIntensity(darkTheme, darkModeIntensity);
    }

    const baseTheme = isDark ? darkTheme : lightTheme;

    return {
      isDark,
      glassEnabled,
      ...baseTheme,
      // Override accent-related colors
      accent: accentColor,
      accentHover: getAccentHover(accentColor, isDark),
      selectedBg: getSelectedBg(accentColor, isDark),
      selectedBorder: accentColor,
    } as Theme;
  }, [isDark, glassEnabled, accentPreset, darkModeIntensity]);

  // Sync theme to :root/body so overflow spill can't fall through to the prefers-color-scheme fallback in styles.css.
  useEffect(() => {
    document.documentElement.style.backgroundColor = theme.background;
    document.body.style.backgroundColor = theme.background;
  }, [theme.background]);

  return (
    <ThemeContext.Provider value={{
      theme,
      toggleGlass,
      toggleDarkMode,
      accentPreset,
      setAccentPreset,
      darkModeIntensity,
      setDarkModeIntensity,
    }}>
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
