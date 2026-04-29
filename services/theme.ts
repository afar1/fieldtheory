import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
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

export type ThemeMode = 'system' | 'light' | 'dark';

const THEME_MODE_KEY = '@littleai/theme-mode';
const listeners = new Set<() => void>();
let themeMode: ThemeMode = 'system';
let loaded = false;

const notify = () => {
  listeners.forEach((listener) => listener());
};

export async function loadThemeMode(): Promise<ThemeMode> {
  if (loaded) return themeMode;
  try {
    const stored = await AsyncStorage.getItem(THEME_MODE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      themeMode = stored;
    }
  } catch (error) {
    console.error('Failed to load theme mode:', error);
  } finally {
    loaded = true;
  }
  notify();
  return themeMode;
}

export async function setThemeMode(nextMode: ThemeMode): Promise<void> {
  themeMode = nextMode;
  loaded = true;
  notify();
  try {
    await AsyncStorage.setItem(THEME_MODE_KEY, nextMode);
  } catch (error) {
    console.error('Failed to save theme mode:', error);
  }
}

export function useThemeMode(): [ThemeMode, (nextMode: ThemeMode) => void] {
  const [mode, setMode] = useState(themeMode);

  useEffect(() => {
    let mounted = true;
    const listener = () => {
      if (mounted) setMode(themeMode);
    };
    listeners.add(listener);
    loadThemeMode().catch(console.error);
    return () => {
      mounted = false;
      listeners.delete(listener);
    };
  }, []);

  return [mode, (nextMode: ThemeMode) => setThemeMode(nextMode).catch(console.error)];
}

export function useIsDark(): boolean {
  const scheme = useColorScheme();
  const [mode] = useThemeMode();
  return mode === 'system' ? scheme === 'dark' : mode === 'dark';
}

export function useThemeColors(): ThemeColors {
  return useIsDark() ? dark : light;
}
