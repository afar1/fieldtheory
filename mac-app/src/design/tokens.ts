// =============================================================================
// Design Tokens - Unified design system for Field Theory
// Extracted from www/styles.css to ensure consistency across platforms.
// =============================================================================

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
    accent: '#4a7c23',       // Forest green accent
    border: '#e0e0e0',       // Light border
    dots: '#d4d4d4',         // Dotted separator color
  },
  dark: {
    bg: '#1e1e1e',           // Medium dark, not too harsh
    bgAlt: '#2a2a2a',        // Slightly lighter for cards
    text: '#e8e8e8',         // Light text
    textMuted: '#999999',    // Muted secondary text
    accent: '#7cb342',       // Lighter green for dark mode
    border: '#3a3a3a',       // Dark border
    dots: '#4a4a4a',         // Dotted separator in dark mode
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
// Minimal shadows to keep the flat, paper-like aesthetic.
// -----------------------------------------------------------------------------

export const shadows = {
  sm: '0 1px 2px rgba(0, 0, 0, 0.05)',
  base: '0 1px 3px rgba(0, 0, 0, 0.1)',
  md: '0 4px 6px rgba(0, 0, 0, 0.1)',
} as const;

// -----------------------------------------------------------------------------
// Theme Type
// For use in ThemeContext and components.
// -----------------------------------------------------------------------------

export type ColorScheme = 'light' | 'dark';

export interface Theme {
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
  dots: string;
}

// -----------------------------------------------------------------------------
// Pre-built Themes
// Ready to use in ThemeContext.
// -----------------------------------------------------------------------------

export const lightTheme: Omit<Theme, 'isDark' | 'glassEnabled'> = {
  bg: colors.light.bg,
  bgSecondary: colors.light.bgAlt,
  text: colors.light.text,
  textSecondary: colors.light.textMuted,
  border: colors.light.border,
  accent: colors.light.accent,
  accentHover: '#3d6a1c',  // Darker green on hover
  selectedBg: 'rgba(74, 124, 35, 0.08)',  // Light green tint
  selectedBorder: colors.light.accent,
  inputBg: '#ffffff',
  inputBorder: colors.light.border,
  dots: colors.light.dots,
};

export const darkThemeSolid: Omit<Theme, 'isDark' | 'glassEnabled'> = {
  bg: colors.dark.bg,
  bgSecondary: colors.dark.bgAlt,
  text: colors.dark.text,
  textSecondary: colors.dark.textMuted,
  border: colors.dark.border,
  accent: colors.dark.accent,
  accentHover: '#8bc34a',  // Lighter green on hover
  selectedBg: 'rgba(124, 179, 66, 0.12)',  // Light green tint
  selectedBorder: colors.dark.accent,
  inputBg: colors.dark.bgAlt,
  inputBorder: 'rgba(255, 255, 255, 0.15)',
  dots: colors.dark.dots,
};

export const darkThemeGlass: Omit<Theme, 'isDark' | 'glassEnabled'> = {
  bg: 'rgba(30, 30, 30, 0.85)',
  bgSecondary: 'rgba(42, 42, 42, 0.9)',
  text: colors.dark.text,
  textSecondary: colors.dark.textMuted,
  border: colors.dark.border,
  accent: colors.dark.accent,
  accentHover: '#8bc34a',
  selectedBg: 'rgba(124, 179, 66, 0.12)',
  selectedBorder: colors.dark.accent,
  inputBg: 'rgba(42, 42, 42, 0.9)',
  inputBorder: 'rgba(255, 255, 255, 0.15)',
  dots: colors.dark.dots,
};
