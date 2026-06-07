// =============================================================================
// Design Tokens - Unified design system for Field Theory
// Shared palette values for the Field Theory app surfaces.
// =============================================================================

// -----------------------------------------------------------------------------
// Accent Color Presets
// User-selectable accent colors for personalization.
// -----------------------------------------------------------------------------

export type AccentPreset = 'forest' | 'ocean' | 'purple' | 'rose' | 'coral' | 'gold';

export const accentPresets: Record<AccentPreset, { light: string; dark: string; name: string }> = {
  forest: { light: '#14372A', dark: '#3d8b6a', name: 'Forest' },
  ocean:  { light: '#1e3a5f', dark: '#4a90d9', name: 'Ocean' },
  purple: { light: '#4a2c6a', dark: '#9b6dca', name: 'Purple' },
  rose:   { light: '#6a2c4a', dark: '#ca6d9b', name: 'Rose' },
  coral:  { light: '#c45844', dark: '#e8836e', name: 'Coral' },
  gold:   { light: '#8a6914', dark: '#d4a934', name: 'Gold' },
};

// Helper to generate accent hover colors (slightly darker/lighter)
export function getAccentHover(accent: string, isDark: boolean): string {
  // Simple approach: adjust brightness
  if (isDark) {
    // Lighten for dark mode hover
    return adjustBrightness(accent, 20);
  } else {
    // Darken for light mode hover
    return adjustBrightness(accent, -15);
  }
}

// Helper to adjust hex color brightness
function adjustBrightness(hex: string, percent: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, Math.max(0, (num >> 16) + Math.round(255 * percent / 100)));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0x00FF) + Math.round(255 * percent / 100)));
  const b = Math.min(255, Math.max(0, (num & 0x0000FF) + Math.round(255 * percent / 100)));
  return `#${(1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1)}`;
}

// Helper to generate selected background from accent color
export function getSelectedBg(accent: string, isDark: boolean): string {
  // Parse hex and create rgba with low opacity
  const num = parseInt(accent.replace('#', ''), 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${isDark ? 0.15 : 0.08})`;
}

// -----------------------------------------------------------------------------
// Color Palette
// Warm paper/ink aesthetic inspired by sketchpad design.
// -----------------------------------------------------------------------------

export const colors = {
  light: {
    bg: '#faf9f7',           // Warm paper background
    bgAlt: '#f5f4f2',        // Slightly darker for cards/boxes
    text: '#1a1a1a',         // Dark ink for primary text
    textMuted: '#6b6b6b',    // Softer text for secondary content
    accent: '#14372A',       // Deep forest green accent (default)
    border: '#e0e0e0',       // Light border
    dots: '#d4d4d4',         // Dotted separator color
  },
  dark: {
    bg: '#15181e',           // Darker background matching iTerm (R:21 G:24 B:30)
    bgAlt: '#1c1f26',        // Slightly lighter for cards
    text: '#e8e8e8',         // Light text
    textMuted: '#a8a8a8',    // Muted secondary text (brighter for contrast)
    accent: '#3d8b6a',       // Brighter green for dark mode visibility (default)
    border: '#2a2d35',       // Dark border
    dots: '#3a3d45',         // Dotted separator in dark mode
  },
} as const;

// -----------------------------------------------------------------------------
// Surface Elevation (Dark Mode)
// In dark mode, elevation = lighter colors (opposite of light mode shadows)
// -----------------------------------------------------------------------------

export const surfaces = {
  light: {
    0: '#faf9f7',  // Base - window background
    1: '#f5f4f2',  // Elevated - cards, panels
    2: '#ffffff',  // Higher - inputs, dialogs
    3: '#ffffff',  // Highest - tooltips, dropdowns
  },
  dark: {
    0: '#15181e',  // Base - window background (matching iTerm)
    1: '#1c1f26',  // Elevated - cards, panels
    2: '#22262e',  // Higher - inputs, dialogs
    3: '#2a2e38',  // Highest - tooltips, dropdowns
  },
} as const;

// -----------------------------------------------------------------------------
// Semantic Colors
// Status and feedback colors with dark mode desaturated variants
// -----------------------------------------------------------------------------

export const semantic = {
  light: {
    error: '#dc2626',
    errorBg: '#fef2f2',
    success: '#16a34a',
    successBg: '#f0fdf4',
    warning: '#d97706',
    warningBg: '#fffbeb',
    info: '#2563eb',
    infoBg: '#eff6ff',
  },
  dark: {
    // Lighter/desaturated for dark backgrounds
    error: '#f87171',
    errorBg: 'rgba(248, 113, 113, 0.15)',
    success: '#4ade80',
    successBg: 'rgba(74, 222, 128, 0.15)',
    warning: '#fbbf24',
    warningBg: 'rgba(251, 191, 36, 0.15)',
    info: '#60a5fa',
    infoBg: 'rgba(96, 165, 250, 0.15)',
  },
} as const;

// -----------------------------------------------------------------------------
// Spacing Scale
// Consistent spacing throughout the app.
// -----------------------------------------------------------------------------

export const spacing = {
  xs: '0.5rem',   // 8px
  sm: '1rem',     // 16px
  md: '1.5rem',   // 24px
  lg: '3rem',     // 48px
  xl: '5rem',     // 80px
} as const;

// Numeric versions for inline styles (in pixels).
export const spacingPx = {
  xs: 8,
  sm: 16,
  md: 24,
  lg: 48,
  xl: 80,
} as const;

// -----------------------------------------------------------------------------
// Typography
// System fonts with monospace for code/technical content.
// -----------------------------------------------------------------------------

export const fonts = {
  sans: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  mono: "'SF Mono', Monaco, 'Cascadia Code', monospace",
} as const;

export const fontSizes = {
  xs: '0.75rem',   // 12px
  sm: '0.875rem',  // 14px
  base: '1rem',    // 16px
  lg: '1.125rem',  // 18px
  xl: '1.25rem',   // 20px
  '2xl': '1.5rem', // 24px
} as const;

// -----------------------------------------------------------------------------
// Border Radius
// Subtle rounding for a friendly feel.
// -----------------------------------------------------------------------------

export const borderRadius = {
  sm: '2px',
  base: '4px',
  md: '6px',
  lg: '8px',
  full: '9999px',
} as const;

// -----------------------------------------------------------------------------
// Shadows
// Light mode uses shadows for depth, dark mode uses lighter surfaces instead
// -----------------------------------------------------------------------------

export const shadows = {
  light: {
    sm: '0 1px 2px rgba(0, 0, 0, 0.05)',
    base: '0 1px 3px rgba(0, 0, 0, 0.1)',
    md: '0 4px 6px rgba(0, 0, 0, 0.1)',
    lg: '0 8px 16px rgba(0, 0, 0, 0.1)',
  },
  dark: {
    // Softer shadows in dark mode - elevation is shown via lighter surfaces
    sm: '0 1px 2px rgba(0, 0, 0, 0.3)',
    base: '0 1px 3px rgba(0, 0, 0, 0.4)',
    md: '0 4px 6px rgba(0, 0, 0, 0.4)',
    lg: '0 8px 16px rgba(0, 0, 0, 0.5)',
  },
} as const;

// -----------------------------------------------------------------------------
// Theme Type
// For use in ThemeContext and components.
// -----------------------------------------------------------------------------

export type ColorScheme = 'light' | 'dark';

export interface Theme {
  isDark: boolean;
  glassEnabled: boolean;
  // Core colors
  bg: string;
  background: string; // Alias for bg
  bgSecondary: string;
  bgTertiary: string;
  text: string;
  textSecondary: string;
  border: string;
  accent: string;
  accentHover: string;
  // Surface elevation (for dark mode depth)
  surface0: string;
  surface1: string;
  surface2: string;
  surface3: string;
  // List/item states
  listItemBg: string;      // Background for list items (elevated from bg)
  hoverBg: string;         // Hover state for list items
  // Selection
  selectedBg: string;
  selectedBorder: string;
  // Inputs
  inputBg: string;
  inputBorder: string;
  // Misc
  dots: string;
  // Semantic colors
  error: string;
  errorBg: string;
  success: string;
  successBg: string;
  warning: string;
  warningBg: string;
  info: string;
  infoBg: string;
  // Shadows
  shadow: string;
  shadowMd: string;
}

// -----------------------------------------------------------------------------
// Pre-built Themes
// Ready to use in ThemeContext.
// -----------------------------------------------------------------------------

export const lightTheme: Omit<Theme, 'isDark' | 'glassEnabled'> = {
  bg: colors.light.bg,
  background: colors.light.bg,
  bgSecondary: colors.light.bgAlt,
  bgTertiary: surfaces.light[2],
  text: colors.light.text,
  textSecondary: colors.light.textMuted,
  border: colors.light.border,
  accent: colors.light.accent,
  accentHover: '#0f2a1f',
  // Surface elevation
  surface0: surfaces.light[0],
  surface1: surfaces.light[1],
  surface2: surfaces.light[2],
  surface3: surfaces.light[3],
  // List/item states
  listItemBg: colors.light.bgAlt,      // Slightly elevated from bg
  hoverBg: '#eae9e7',                   // Hover state (darker than listItemBg)
  selectedBg: 'rgba(20, 55, 42, 0.08)',
  selectedBorder: colors.light.accent,
  inputBg: '#ffffff',
  inputBorder: colors.light.border,
  dots: colors.light.dots,
  // Semantic
  error: semantic.light.error,
  errorBg: semantic.light.errorBg,
  success: semantic.light.success,
  successBg: semantic.light.successBg,
  warning: semantic.light.warning,
  warningBg: semantic.light.warningBg,
  info: semantic.light.info,
  infoBg: semantic.light.infoBg,
  // Shadows
  shadow: shadows.light.base,
  shadowMd: shadows.light.md,
};

export const darkThemeSolid: Omit<Theme, 'isDark' | 'glassEnabled'> = {
  bg: colors.dark.bg,
  background: colors.dark.bg,
  bgSecondary: surfaces.dark[1],
  bgTertiary: surfaces.dark[2],
  text: colors.dark.text,
  textSecondary: colors.dark.textMuted,
  border: colors.dark.border,
  accent: colors.dark.accent,
  accentHover: '#4da87d',
  // Surface elevation
  surface0: surfaces.dark[0],
  surface1: surfaces.dark[1],
  surface2: surfaces.dark[2],
  surface3: surfaces.dark[3],
  // List/item states
  listItemBg: surfaces.dark[1],        // Elevated from bg
  hoverBg: '#262a32',                   // Hover state (lighter than listItemBg)
  selectedBg: 'rgba(61, 139, 106, 0.15)',
  selectedBorder: colors.dark.accent,
  inputBg: surfaces.dark[2],
  inputBorder: 'rgba(255, 255, 255, 0.15)',
  dots: colors.dark.dots,
  // Semantic
  error: semantic.dark.error,
  errorBg: semantic.dark.errorBg,
  success: semantic.dark.success,
  successBg: semantic.dark.successBg,
  warning: semantic.dark.warning,
  warningBg: semantic.dark.warningBg,
  info: semantic.dark.info,
  infoBg: semantic.dark.infoBg,
  // Shadows
  shadow: shadows.dark.base,
  shadowMd: shadows.dark.md,
};

export const darkThemeGlass: Omit<Theme, 'isDark' | 'glassEnabled'> = {
  bg: 'rgba(21, 24, 30, 0.85)',
  background: 'rgba(21, 24, 30, 0.85)',
  bgSecondary: 'rgba(28, 31, 38, 0.9)',
  bgTertiary: 'rgba(34, 38, 46, 0.95)',
  text: colors.dark.text,
  textSecondary: colors.dark.textMuted,
  border: colors.dark.border,
  accent: colors.dark.accent,
  accentHover: '#4da87d',
  // Surface elevation (glass versions)
  surface0: 'rgba(21, 24, 30, 0.85)',
  surface1: 'rgba(28, 31, 38, 0.9)',
  surface2: 'rgba(34, 38, 46, 0.95)',
  surface3: 'rgba(42, 46, 56, 0.95)',
  // List/item states
  listItemBg: 'rgba(28, 31, 38, 0.9)',  // Elevated from bg
  hoverBg: 'rgba(38, 42, 50, 0.95)',    // Hover state
  selectedBg: 'rgba(61, 139, 106, 0.15)',
  selectedBorder: colors.dark.accent,
  inputBg: 'rgba(34, 38, 46, 0.9)',
  inputBorder: 'rgba(255, 255, 255, 0.15)',
  dots: colors.dark.dots,
  // Semantic
  error: semantic.dark.error,
  errorBg: semantic.dark.errorBg,
  success: semantic.dark.success,
  successBg: semantic.dark.successBg,
  warning: semantic.dark.warning,
  warningBg: semantic.dark.warningBg,
  info: semantic.dark.info,
  infoBg: semantic.dark.infoBg,
  // Shadows
  shadow: shadows.dark.base,
  shadowMd: shadows.dark.md,
};
