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
  ThemeStylePreset,
  accentPresets,
  themeStylePresets,
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
  themeStylePreset: ThemeStylePreset;
  setThemeStylePreset: (preset: ThemeStylePreset) => void;
  darkModeIntensity: number;
  setDarkModeIntensity: (intensity: number) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);
const RENDERER_STORAGE_CHANGED_EVENT = 'fieldtheory:renderer-storage-changed';
const DARK_MODE_KEY = 'darkMode';
const GLASS_EFFECT_KEY = 'glassEffect';
const ACCENT_PRESET_KEY = 'accentPreset';
const THEME_STYLE_PRESET_KEY = 'themeStylePreset';
const DARK_MODE_INTENSITY_KEY = 'darkModeIntensity';

export function isThemeRendererStoragePreferenceKey(key: string | null | undefined): boolean {
  return key === DARK_MODE_KEY ||
    key === GLASS_EFFECT_KEY ||
    key === ACCENT_PRESET_KEY ||
    key === THEME_STYLE_PRESET_KEY ||
    key === DARK_MODE_INTENSITY_KEY;
}

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

export function applyThemeStylePreset(
  baseTheme: Omit<Theme, 'isDark' | 'glassEnabled'>,
  preset: ThemeStylePreset,
  isDark: boolean
): Omit<Theme, 'isDark' | 'glassEnabled'> {
  if (preset === 'default') return baseTheme;

  const overrides: Record<Exclude<ThemeStylePreset, 'default'>, {
    light: Partial<Omit<Theme, 'isDark' | 'glassEnabled'>>;
    dark: Partial<Omit<Theme, 'isDark' | 'glassEnabled'>>;
  }> = {
    soft: {
      light: {
        bg: '#f6f2ec',
        background: '#f6f2ec',
        bgSecondary: '#f1ece4',
        bgTertiary: '#ebe5db',
        surface0: '#f6f2ec',
        surface1: '#f1ece4',
        surface2: '#ebe5db',
        surface3: '#e4ddd1',
        listItemBg: '#f1ece4',
        hoverBg: '#ece5da',
        inputBg: '#fbf8f3',
        border: '#e2d9cc',
        inputBorder: '#d8cdbd',
        dots: '#d6cbba',
        text: '#3a342c',
        textSecondary: '#857b6c',
      },
      dark: {
        bg: '#1d1b18',
        background: '#1d1b18',
        bgSecondary: '#232120',
        bgTertiary: '#2a2724',
        surface0: '#1d1b18',
        surface1: '#232120',
        surface2: '#2a2724',
        surface3: '#322e2a',
        listItemBg: '#232120',
        hoverBg: '#2c2925',
        inputBg: '#232120',
        border: '#37322c',
        inputBorder: '#433d36',
        dots: '#403a33',
        text: '#e6e0d6',
        textSecondary: '#a89e8f',
      },
    },
    cool: {
      light: {
        bg: '#f6f7f9',
        background: '#f6f7f9',
        bgSecondary: '#eef0f3',
        bgTertiary: '#e6e9ee',
        surface0: '#f6f7f9',
        surface1: '#eef0f3',
        surface2: '#e6e9ee',
        surface3: '#dde1e8',
        listItemBg: '#eef0f3',
        hoverBg: '#e6eaf0',
        inputBg: '#ffffff',
        border: '#dadfe6',
        inputBorder: '#cad1da',
        dots: '#c9d0d9',
        text: '#1b2530',
        textSecondary: '#5f6b78',
      },
      dark: {
        bg: '#11151b',
        background: '#11151b',
        bgSecondary: '#171c24',
        bgTertiary: '#1d232c',
        surface0: '#11151b',
        surface1: '#171c24',
        surface2: '#1d232c',
        surface3: '#242c37',
        listItemBg: '#171c24',
        hoverBg: '#202733',
        inputBg: '#171c24',
        border: '#283038',
        inputBorder: '#343e49',
        dots: '#303a45',
        text: '#dde6ef',
        textSecondary: '#94a3b3',
      },
    },
    contrast: {
      light: {
        bg: '#ffffff',
        background: '#ffffff',
        bgSecondary: '#f2f3f5',
        bgTertiary: '#e7e9ec',
        surface0: '#ffffff',
        surface1: '#f2f3f5',
        surface2: '#e7e9ec',
        surface3: '#d9dce1',
        listItemBg: '#f2f3f5',
        hoverBg: '#e4e7ec',
        inputBg: '#ffffff',
        border: '#c4c9d0',
        inputBorder: '#aab1bb',
        dots: '#b4bac2',
        text: '#0a0c10',
        textSecondary: '#4a525d',
      },
      dark: {
        bg: '#0a0c10',
        background: '#0a0c10',
        bgSecondary: '#14171d',
        bgTertiary: '#1e222a',
        surface0: '#0a0c10',
        surface1: '#14171d',
        surface2: '#1e222a',
        surface3: '#2a2f3a',
        listItemBg: '#14171d',
        hoverBg: '#252b35',
        inputBg: '#14171d',
        border: '#3a414d',
        inputBorder: '#4e5765',
        dots: '#454d5a',
        text: '#ffffff',
        textSecondary: '#b3bcc8',
      },
    },
  };

  return {
    ...baseTheme,
    ...(isDark ? overrides[preset].dark : overrides[preset].light),
  };
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [isDark, setIsDark] = useState(() => {
    // Default to light mode, check localStorage for saved preference
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(DARK_MODE_KEY);
      if (saved !== null) {
        return saved === 'true';
      }
    }
    return false;
  });

  const [glassEnabled, setGlassEnabled] = useState(() => {
    // Default to enabled, check localStorage for saved preference.
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(GLASS_EFFECT_KEY);
      if (saved !== null) {
        return saved === 'true';
      }
    }
    return true;
  });

  const [accentPreset, setAccentPresetState] = useState<AccentPreset>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(ACCENT_PRESET_KEY);
      if (saved && saved in accentPresets) {
        return saved as AccentPreset;
      }
    }
    return 'forest';
  });

  const [themeStylePreset, setThemeStylePresetState] = useState<ThemeStylePreset>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(THEME_STYLE_PRESET_KEY);
      if (saved && saved in themeStylePresets) {
        return saved as ThemeStylePreset;
      }
    }
    return 'default';
  });

  const [darkModeIntensity, setDarkModeIntensityState] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(DARK_MODE_INTENSITY_KEY);
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
      localStorage.setItem(DARK_MODE_KEY, String(newIsDark));
    });

    // Prefer renderer localStorage on startup. The main-process preference can
    // lag behind during dev restarts, so sync main to the renderer when the
    // renderer already has an explicit choice.
    window.themeAPI.getTheme?.().then((savedIsDark: boolean) => {
      const resolved = resolveStartupThemePreference({
        localSaved: localStorage.getItem(DARK_MODE_KEY),
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
        localStorage.setItem(DARK_MODE_KEY, String(resolved.nextIsDark));
      }
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const applyStoredThemePreferences = (key: string | null | undefined) => {
      if (key !== null && key !== undefined && !isThemeRendererStoragePreferenceKey(key)) return;
      const syncAll = key === null || key === undefined;

      if (syncAll || key === DARK_MODE_KEY) {
        const saved = localStorage.getItem(DARK_MODE_KEY);
        if (saved !== null) setIsDark(saved === 'true');
      }

      if (syncAll || key === GLASS_EFFECT_KEY) {
        const saved = localStorage.getItem(GLASS_EFFECT_KEY);
        if (saved !== null) setGlassEnabled(saved === 'true');
      }

      if (syncAll || key === ACCENT_PRESET_KEY) {
        const saved = localStorage.getItem(ACCENT_PRESET_KEY);
        if (saved && saved in accentPresets) setAccentPresetState(saved as AccentPreset);
      }

      if (syncAll || key === THEME_STYLE_PRESET_KEY) {
        const saved = localStorage.getItem(THEME_STYLE_PRESET_KEY);
        if (saved && saved in themeStylePresets) setThemeStylePresetState(saved as ThemeStylePreset);
      }

      if (syncAll || key === DARK_MODE_INTENSITY_KEY) {
        const saved = localStorage.getItem(DARK_MODE_INTENSITY_KEY);
        if (saved === null) return;
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed >= 0 && parsed <= 100) setDarkModeIntensityState(parsed);
      }
    };

    const handleRendererStorageChanged = (event: Event) => {
      const key = (event as CustomEvent<{ key?: string | null }>).detail?.key;
      applyStoredThemePreferences(key);
    };
    const handleStorage = (event: Event) => {
      const key = (event as StorageEvent).key;
      if (key === undefined || key === null || isThemeRendererStoragePreferenceKey(key)) {
        applyStoredThemePreferences(key);
      }
    };

    window.addEventListener(RENDERER_STORAGE_CHANGED_EVENT, handleRendererStorageChanged);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(RENDERER_STORAGE_CHANGED_EVENT, handleRendererStorageChanged);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  const toggleDarkMode = () => {
    const newValue = !isDark;
    setIsDark(newValue);
    localStorage.setItem(DARK_MODE_KEY, String(newValue));

    // Notify main process to sync to other windows
    window.themeAPI?.setTheme?.(newValue);
  };

  const toggleGlass = () => {
    const newValue = !glassEnabled;
    setGlassEnabled(newValue);
    localStorage.setItem(GLASS_EFFECT_KEY, String(newValue));
  };

  const setAccentPreset = (preset: AccentPreset) => {
    setAccentPresetState(preset);
    localStorage.setItem(ACCENT_PRESET_KEY, preset);
  };

  const setThemeStylePreset = (preset: ThemeStylePreset) => {
    setThemeStylePresetState(preset);
    localStorage.setItem(THEME_STYLE_PRESET_KEY, preset);
  };

  const setDarkModeIntensity = (intensity: number) => {
    const clamped = Math.max(0, Math.min(100, intensity));
    setDarkModeIntensityState(clamped);
    localStorage.setItem(DARK_MODE_INTENSITY_KEY, String(clamped));
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

    const baseTheme = applyThemeStylePreset(isDark ? darkTheme : lightTheme, themeStylePreset, isDark);

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
  }, [isDark, glassEnabled, accentPreset, themeStylePreset, darkModeIntensity]);

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
      themeStylePreset,
      setThemeStylePreset,
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
