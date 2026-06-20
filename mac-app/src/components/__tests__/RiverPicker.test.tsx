import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import RiverPicker, { type RiverPickerTarget } from '../RiverPicker';

vi.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => ({
    theme: {
      accent: '#0f766e',
      accentHover: '#115e59',
      background: '#ffffff',
      bg: '#ffffff',
      bgSecondary: '#f7f7f7',
      bgTertiary: '#eeeeee',
      border: '#d1d5db',
      dots: '#999999',
      error: '#dc2626',
      errorBg: '#fef2f2',
      glassEnabled: false,
      hoverBg: '#f3f4f6',
      info: '#2563eb',
      infoBg: '#eff6ff',
      inputBg: '#ffffff',
      inputBorder: '#d1d5db',
      isDark: false,
      listItemBg: '#ffffff',
      selectedBg: '#e0f2f1',
      selectedBorder: '#0f766e',
      shadow: 'none',
      success: '#16a34a',
      successBg: '#f0fdf4',
      surface0: '#ffffff',
      surface1: '#ffffff',
      surface2: '#f9fafb',
      surface3: '#ffffff',
      text: '#111111',
      textSecondary: '#666666',
      warning: '#d97706',
      warningBg: '#fffbeb',
    },
  }),
}));

const targets: RiverPickerTarget[] = [
  {
    id: 'public',
    kind: 'public',
    label: 'Public River',
    detail: 'Visible to everyone',
    status: 'accepted',
  },
  {
    id: 'design',
    kind: 'group',
    label: 'Design Circle',
    detail: 'Group',
    callSign: 'DSN',
    initials: 'DC',
    status: 'accepted',
  },
  {
    id: 'mira',
    kind: 'person',
    label: 'Mira Chen',
    detail: 'mira@example.com',
    callSign: '@mira',
    initials: 'MC',
    status: 'accepted',
  },
  {
    id: 'pending-lee',
    kind: 'person',
    label: 'Lee Pending',
    detail: 'Invite pending',
    initials: 'LP',
    status: 'pending',
  },
];

function renderPicker(overrides = {}) {
  return render(
    <RiverPicker
      targets={targets}
      selectedIds={[]}
      defaultIds={[]}
      onToggleTarget={vi.fn()}
      onCommit={vi.fn()}
      onDefaultChange={vi.fn()}
      {...overrides}
    />
  );
}

describe('RiverPicker', () => {
  it('filters rows and arms the first visible match', () => {
    renderPicker();

    const input = screen.getByRole('searchbox', { name: 'Search River targets' });
    fireEvent.change(input, { target: { value: 'mira' } });

    expect(screen.getByRole('option', { name: /Mira Chen/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /Design Circle/ })).toBeNull();
    expect(input.getAttribute('aria-activedescendant')).toContain('mira');
  });

  it('moves the armed row with arrow keys', () => {
    renderPicker();

    const input = screen.getByRole('searchbox', { name: 'Search River targets' });
    expect(input.getAttribute('aria-activedescendant')).toContain('public');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.getAttribute('aria-activedescendant')).toContain('design');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.getAttribute('aria-activedescendant')).toContain('mira');

    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input.getAttribute('aria-activedescendant')).toContain('design');
  });

  it('does not toggle disabled pending rows', () => {
    const onToggleTarget = vi.fn();
    renderPicker({ onToggleTarget });

    const input = screen.getByRole('searchbox', { name: 'Search River targets' });
    fireEvent.change(input, { target: { value: 'lee' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    const pendingRow = screen.getByRole('option', { name: /Lee Pending/ });
    expect(pendingRow.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(pendingRow);

    expect(onToggleTarget).not.toHaveBeenCalled();
  });

  it('keeps default pills independent from selected state', () => {
    renderPicker({
      selectedIds: ['mira'],
      defaultIds: ['design'],
    });

    expect(screen.getByLabelText('River defaults').textContent).toContain('Design Circle');
    expect(screen.getByRole('option', { name: /Design Circle/ }).getAttribute('aria-selected')).toBe('false');
    expect(screen.getByRole('option', { name: /Mira Chen/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('commits selected defaults with Enter and toggles searched rows with Enter', () => {
    const onToggleTarget = vi.fn();
    const onCommit = vi.fn();
    renderPicker({
      selectedIds: ['design', 'pending-lee', 'missing-target'],
      onToggleTarget,
      onCommit,
    });

    const input = screen.getByRole('searchbox', { name: 'Search River targets' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith(['design']);

    fireEvent.change(input, { target: { value: 'mira' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onToggleTarget).toHaveBeenCalledWith('mira', expect.objectContaining({ label: 'Mira Chen' }));

    fireEvent.keyDown(input, { key: 'Enter', metaKey: true });
    expect(onCommit).toHaveBeenLastCalledWith(['design']);

    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
    expect(onCommit).toHaveBeenLastCalledWith(['design']);
  });

  it('renders stale defaults, offline, and error state messages', () => {
    const { rerender } = render(
      <RiverPicker
        targets={targets}
        selectedIds={[]}
        defaultIds={['stale-default']}
        staleDefaultIds={['deleted-default']}
        status="offline"
        onToggleTarget={vi.fn()}
        onCommit={vi.fn()}
      />
    );

    expect(screen.getByText('2 default River targets are stale.')).toBeTruthy();
    expect(screen.getByText(/Cached River content stays readable/)).toBeTruthy();

    rerender(
      <RiverPicker
        targets={targets}
        selectedIds={[]}
        status="error"
        errorMessage="River target service failed."
        commitError="Share failed."
        onToggleTarget={vi.fn()}
        onCommit={vi.fn()}
      />
    );

    expect(screen.getByText('River target service failed.')).toBeTruthy();
    expect(screen.getByText('Share failed.')).toBeTruthy();
  });
});
