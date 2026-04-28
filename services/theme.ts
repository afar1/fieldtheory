import { useColorScheme } from 'react-native';

export interface ThemeColors {
  bgPage: string;          // app/list page background
  bgSurface: string;       // cards, command tiles, search input fill
  bgElevated: string;      // bottom bar, modals
  border: string;          // card borders, dividers
  textPrimary: string;     // main text
  textSecondary: string;   // muted text, subtitles, time stamps
  textTertiary: string;    // placeholders, disabled
  accent: string;          // primary brand blue
  tabInactive: string;
  tabActive: string;
}

const light: ThemeColors = {
  bgPage: '#F4F5F7',
  bgSurface: '#FFFFFF',
  bgElevated: '#FFFFFF',
  border: '#E5E7EB',
  textPrimary: '#111827',
  textSecondary: '#6B7280',
  textTertiary: '#9CA3AF',
  accent: '#007AFF',
  tabInactive: '#9CA3AF',
  tabActive: '#007AFF',
};

const dark: ThemeColors = {
  bgPage: '#0B0F14',
  bgSurface: '#1A1F26',
  bgElevated: '#0F1217',
  border: '#2A3038',
  textPrimary: '#F3F4F6',
  textSecondary: '#9CA3AF',
  textTertiary: '#6B7280',
  accent: '#0A84FF',
  tabInactive: '#6B7280',
  tabActive: '#0A84FF',
};

export function useThemeColors(): ThemeColors {
  const scheme = useColorScheme();
  return scheme === 'dark' ? dark : light;
}

export function useIsDark(): boolean {
  return useColorScheme() === 'dark';
}
