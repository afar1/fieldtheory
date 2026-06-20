import type { Theme } from '../contexts/ThemeContext';

export interface RiverPickerTokens {
  accent: string;
  accentText: string;
  background: string;
  border: string;
  chipBackground: string;
  chipBorder: string;
  danger: string;
  dangerBackground: string;
  disabledBackground: string;
  focusBackground: string;
  groupBackground: string;
  inputBackground: string;
  mutedText: string;
  pendingBackground: string;
  pendingText: string;
  selectedBackground: string;
  successBackground: string;
  surface: string;
  text: string;
}

export function getRiverPickerTokens(theme: Theme): RiverPickerTokens {
  return {
    accent: theme.accent,
    accentText: '#fff',
    background: theme.bg,
    border: theme.border,
    chipBackground: theme.isDark ? 'rgba(255,255,255,0.07)' : 'rgba(15,23,42,0.04)',
    chipBorder: theme.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(15,23,42,0.1)',
    danger: theme.error,
    dangerBackground: theme.errorBg,
    disabledBackground: theme.surface2,
    focusBackground: theme.hoverBg,
    groupBackground: theme.isDark ? 'rgba(96,165,250,0.18)' : 'rgba(37,99,235,0.1)',
    inputBackground: theme.inputBg,
    mutedText: theme.textSecondary,
    pendingBackground: theme.warningBg,
    pendingText: theme.warning,
    selectedBackground: theme.selectedBg,
    successBackground: theme.successBg,
    surface: theme.surface1,
    text: theme.text,
  };
}
