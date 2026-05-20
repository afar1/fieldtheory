import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  getSettingsBadgeStyle,
  SettingsBadge,
  SettingsDisabledBlock,
  SettingsRow,
} from '../SettingsPrimitives';

const theme = {
  text: '#111111',
  textSecondary: '#666666',
  border: '#d1d5db',
  accent: '#0f766e',
  isDark: false,
  bgSecondary: '#f9fafb',
  surface2: '#eff6ff',
  selectedBg: 'rgba(15, 118, 110, 0.08)',
  success: '#16a34a',
  warning: '#d97706',
  info: '#2563eb',
} as any;

describe('SettingsDisabledBlock', () => {
  it('disables nested form controls when disabled', () => {
    const { container } = render(
      <SettingsDisabledBlock disabled>
        <label>
          Example
          <input type="checkbox" defaultChecked />
        </label>
        <button type="button">Save</button>
      </SettingsDisabledBlock>,
    );

    const fieldset = container.querySelector('fieldset');
    expect(fieldset?.disabled).toBe(true);
    expect(fieldset?.style.pointerEvents).toBe('none');
    expect(fieldset?.style.opacity).toBe('0.55');
    expect(screen.getByRole('checkbox')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
  });

  it('leaves nested controls active when enabled', () => {
    const { container } = render(
      <SettingsDisabledBlock disabled={false}>
        <label>
          Example
          <input type="checkbox" defaultChecked />
        </label>
        <button type="button">Save</button>
      </SettingsDisabledBlock>,
    );

    const fieldset = container.querySelector('fieldset');
    expect(fieldset?.disabled).toBe(false);
    expect(fieldset?.style.pointerEvents).toBe('');
    expect(fieldset?.style.opacity).toBe('1');
    expect(screen.getByRole('checkbox')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
  });
});

describe('SettingsBadge', () => {
  it('uses the shared neutral badge styles', () => {
    render(<SettingsBadge theme={theme}>Idle</SettingsBadge>);

    const badge = screen.getByText('Idle');
    expect(badge.style.borderRadius).toBe('999px');
    expect(badge.style.backgroundColor).toBe(theme.selectedBg);
    expect(badge.style.color).toBe(theme.textSecondary);
  });

  it('exposes warning badge styles through the shared helper', () => {
    const styles = getSettingsBadgeStyle(theme, 'warning');
    expect(styles.color).toBe(theme.warning);
    expect(styles.borderRadius).toBe('999px');
    expect(styles.padding).toBe('2px 6px');
  });
});

describe('SettingsRow', () => {
  it('can omit its trailing divider for the last row in a card', () => {
    const { container } = render(<SettingsRow theme={theme} label="Final row" last />);

    const row = container.firstElementChild as HTMLElement;
    expect(row.style.borderBottom).toBe('0px');
  });
});
