import type { CSSProperties, ReactNode } from 'react';
import type { Theme } from '../../contexts/ThemeContext';

interface SettingsRowProps {
  theme: Theme;
  label: ReactNode;
  hint?: ReactNode;
  control?: ReactNode;
  children?: ReactNode;
  align?: 'center' | 'flex-start';
  divider?: boolean;
  last?: boolean;
}

interface SettingsToggleProps {
  theme: Theme;
  checked: boolean;
  onClick: () => void;
  disabled?: boolean;
  activeColor?: string;
  title?: string;
}

interface SettingsSectionHeadingProps {
  theme: Theme;
  title: string;
  description?: ReactNode;
}

interface SettingsNoticeProps {
  theme: Theme;
  tone?: 'info' | 'success' | 'warning';
  children: ReactNode;
}

interface SettingsDisabledBlockProps {
  disabled: boolean;
  children: ReactNode;
}

export type SettingsBadgeTone = 'neutral' | 'success' | 'warning' | 'info';

export const SETTINGS_CARD_GAP = '16px';

interface SettingsBadgeProps {
  theme: Theme;
  tone?: SettingsBadgeTone;
  children: ReactNode;
}

export function getSettingsSurfaceStyle(theme: Theme, variant: 'surface' | 'inset' = 'surface'): CSSProperties {
  if (variant === 'inset') {
    return {
      padding: '14px 16px',
      borderRadius: '6px',
      backgroundColor: theme.isDark ? theme.surface2 : '#faf9f7',
      border: `1px solid ${theme.isDark ? theme.border : '#ece8e0'}`,
      boxShadow: 'none',
    };
  }

  return {
    padding: '18px 22px',
    borderRadius: '6px',
    backgroundColor: theme.isDark ? theme.surface1 : '#ffffff',
    border: `1px solid ${theme.isDark ? theme.border : '#ece8e0'}`,
    boxShadow: theme.isDark ? 'none' : '0 1px 0 rgba(60, 40, 20, 0.02)',
  };
}

export function getSettingsDividerColor(theme: Theme): string {
  return theme.isDark ? theme.border : '#ece8e0';
}

export function getSettingsBadgeStyle(theme: Theme, tone: SettingsBadgeTone = 'neutral'): CSSProperties {
  const toneStyles = {
    neutral: {
      color: theme.textSecondary,
      backgroundColor: theme.selectedBg,
    },
    success: {
      color: theme.success,
      backgroundColor: theme.isDark ? 'rgba(34, 197, 94, 0.15)' : 'rgba(34, 197, 94, 0.1)',
    },
    warning: {
      color: theme.warning,
      backgroundColor: theme.isDark ? 'rgba(217, 119, 6, 0.18)' : 'rgba(217, 119, 6, 0.1)',
    },
    info: {
      color: theme.info,
      backgroundColor: theme.isDark ? 'rgba(96, 165, 250, 0.16)' : 'rgba(37, 99, 235, 0.1)',
    },
  }[tone];

  return {
    fontFamily: '"SF Mono", Menlo, Monaco, Consolas, monospace',
    fontSize: '9.5px',
    lineHeight: 1.3,
    fontWeight: 500,
    color: toneStyles.color,
    padding: '2px 6px',
    borderRadius: '999px',
    backgroundColor: toneStyles.backgroundColor,
    letterSpacing: '0.5px',
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
  };
}

export function SettingsSectionHeading({ theme, title, description }: SettingsSectionHeadingProps) {
  return (
    <div style={{ marginBottom: '14px' }}>
      <div
        style={{
          fontFamily: '"Newsreader", "Iowan Old Style", Georgia, serif',
          fontSize: '16px',
          fontWeight: 500,
          letterSpacing: 0,
          color: theme.text,
          margin: 0,
        }}
      >
        {title}
      </div>
      {description && (
        <p
          style={{
            fontSize: '12px',
            color: theme.textSecondary,
            margin: '4px 0 0 0',
            lineHeight: 1.5,
          }}
        >
          {description}
        </p>
      )}
    </div>
  );
}

export function SettingsRow({
  theme,
  label,
  hint,
  control,
  children,
  align = 'center',
  divider = true,
  last = false,
}: SettingsRowProps) {
  const labelBlock = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: hint ? '3px' : 0, flex: 1, minWidth: 0 }}>
      <span
        style={{
          fontSize: '13px',
          color: theme.text,
          fontWeight: 500,
          lineHeight: 1.35,
        }}
      >
        {label}
      </span>
      {hint && (
        <span
          style={{
            fontSize: '11.5px',
            color: theme.textSecondary,
            lineHeight: 1.5,
            maxWidth: '460px',
          }}
        >
          {hint}
        </span>
      )}
    </div>
  );

  return (
    <div
      style={{
        display: 'flex',
        alignItems: align,
        justifyContent: 'space-between',
        gap: '16px',
        padding: '12px 0',
        borderBottom: divider && !last ? `1px solid ${getSettingsDividerColor(theme)}` : 0,
      }}
    >
      {labelBlock}
      {control && <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>{control}</div>}
      {children}
    </div>
  );
}

export function SettingsToggle({
  theme,
  checked,
  onClick,
  disabled = false,
  activeColor,
  title,
}: SettingsToggleProps) {
  const onColor = activeColor ?? theme.accent;

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        position: 'relative',
        width: '32px',
        minWidth: '32px',
        height: '18px',
        minHeight: '18px',
        borderRadius: '999px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        border: 'none',
        padding: 0,
        flexShrink: 0,
        transition: 'background-color 0.2s ease, opacity 0.2s ease',
        backgroundColor: checked ? onColor : (theme.isDark ? '#3a3d45' : '#d4cfc4'),
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: '2px',
          left: 0,
          width: '14px',
          height: '14px',
          borderRadius: '999px',
          backgroundColor: '#fff',
          boxShadow: '0 1px 2px rgba(0,0,0,0.18)',
          transition: 'transform 0.2s ease',
          transform: checked ? 'translateX(16px)' : 'translateX(2px)',
        }}
      />
    </button>
  );
}

export function SettingsDivider({ theme, margin = '16px 0' }: { theme: Theme; margin?: CSSProperties['margin'] }) {
  return (
    <div
      style={{
        height: '1px',
        backgroundColor: getSettingsDividerColor(theme),
        margin,
      }}
    />
  );
}

export function SettingsCard({
  theme,
  children,
  variant = 'surface',
}: {
  theme: Theme;
  children: ReactNode;
  variant?: 'surface' | 'inset';
}) {
  return (
    <div style={getSettingsSurfaceStyle(theme, variant)}>
      {children}
    </div>
  );
}

export function SettingsInsetGroup({ theme, children }: { theme: Theme; children: ReactNode }) {
  return (
    <div style={getSettingsSurfaceStyle(theme, 'inset')}>
      {children}
    </div>
  );
}

export function SettingsBadge({ theme, tone = 'neutral', children }: SettingsBadgeProps) {
  return <span style={getSettingsBadgeStyle(theme, tone)}>{children}</span>;
}

export function SettingsNotice({ theme, tone = 'info', children }: SettingsNoticeProps) {
  const toneStyles = {
    info: {
      backgroundColor: theme.isDark ? theme.surface2 : '#f0f9ff',
      borderColor: theme.isDark ? theme.border : '#bfdbfe',
      color: theme.isDark ? theme.textSecondary : '#1e40af',
    },
    success: {
      backgroundColor: theme.isDark ? 'rgba(16, 185, 129, 0.1)' : '#ecfdf5',
      borderColor: theme.isDark ? 'rgba(16, 185, 129, 0.3)' : '#a7f3d0',
      color: theme.isDark ? '#34d399' : '#059669',
    },
    warning: {
      backgroundColor: theme.isDark ? 'rgba(245, 158, 11, 0.1)' : '#fffbeb',
      borderColor: theme.isDark ? 'rgba(245, 158, 11, 0.3)' : '#fcd34d',
      color: theme.isDark ? '#fbbf24' : '#b45309',
    },
  }[tone];

  return (
    <div
      style={{
        marginTop: '12px',
        padding: '12px',
        borderRadius: '10px',
        border: `1px solid ${toneStyles.borderColor}`,
        backgroundColor: toneStyles.backgroundColor,
      }}
    >
      <div
        style={{
          fontSize: '12px',
          color: toneStyles.color,
          lineHeight: 1.5,
        }}
      >
        {children}
      </div>
    </div>
  );
}

export function SettingsDisabledBlock({ disabled, children }: SettingsDisabledBlockProps) {
  return (
    <fieldset
      disabled={disabled}
      aria-disabled={disabled}
      style={{
        margin: 0,
        padding: 0,
        border: 'none',
        minInlineSize: 0,
        opacity: disabled ? 0.55 : 1,
        pointerEvents: disabled ? 'none' : undefined,
        transition: 'opacity 0.2s ease',
      }}
    >
      {children}
    </fieldset>
  );
}
