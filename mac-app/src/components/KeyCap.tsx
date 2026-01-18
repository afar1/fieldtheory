/**
 * KeyCap component - renders a keyboard key with clean styling.
 * Used for displaying keyboard shortcuts with a visual key appearance.
 */
import React from 'react';
import { useTheme } from '../contexts/ThemeContext';

interface KeyCapProps {
  children: React.ReactNode;
  small?: boolean;
  style?: React.CSSProperties;
}

export function KeyCap({ children, small = false, style }: KeyCapProps) {
  const { theme } = useTheme();
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: small ? '1px 4px' : '2px 5px',
        fontSize: small ? '9px' : '10px',
        fontWeight: 500,
        color: theme.isDark ? theme.text : '#555',
        backgroundColor: theme.isDark ? theme.surface2 : '#e8e8e8',
        borderRadius: '3px',
        ...style,
      }}
    >
      {children}
    </span>
  );
}

export default KeyCap;
