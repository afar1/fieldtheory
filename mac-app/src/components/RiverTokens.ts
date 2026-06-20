import type { Theme } from '../contexts/ThemeContext';

export interface RiverPickerTokens {
  accent: string;
  accentSoft: string;
  accentText: string;
  badgeBackground: string;
  border: string;
  checkboxBorder: string;
  danger: string;
  dangerBackground: string;
  disabledBackground: string;
  groupBackground: string;
  mutedText: string;
  shadow: string;
  softBackground: string;
  subtleBorder: string;
  successBackground: string;
  surface: string;
  text: string;
  keyText: string;
}

export function getRiverPickerTokens(theme: Theme): RiverPickerTokens {
  return {
    accent: theme.accent,
    accentSoft: theme.isDark ? 'rgba(15,124,137,0.22)' : 'rgba(15,124,137,0.10)',
    accentText: '#fff',
    badgeBackground: theme.isDark ? 'rgba(255,255,255,0.10)' : '#ece9e2',
    border: theme.border,
    checkboxBorder: theme.isDark ? 'rgba(255,255,255,0.24)' : '#b6b2a8',
    danger: theme.error,
    dangerBackground: theme.errorBg,
    disabledBackground: theme.surface2,
    groupBackground: theme.isDark ? 'rgba(96,165,250,0.18)' : 'rgba(37,99,235,0.1)',
    mutedText: theme.textSecondary,
    shadow: theme.isDark ? '0 18px 50px rgba(0,0,0,0.32)' : '0 18px 50px rgba(40,36,28,0.20)',
    softBackground: theme.isDark ? 'rgba(255,255,255,0.06)' : '#faf9f6',
    subtleBorder: theme.isDark ? 'rgba(255,255,255,0.10)' : '#eceae3',
    successBackground: theme.successBg,
    surface: theme.surface1,
    text: theme.text,
    keyText: theme.isDark ? 'rgba(255,255,255,0.72)' : '#7a7770',
  };
}
