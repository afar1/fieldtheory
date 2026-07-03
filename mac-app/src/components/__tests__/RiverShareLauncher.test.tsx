import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RiverShareLauncher from '../RiverShareLauncher';

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

afterEach(() => {
  delete (window as Partial<Window>).sharedFilesAPI;
});

describe('RiverShareLauncher', () => {
  it('shares the selected file to the default River target with Enter', async () => {
    const share = vi.fn(async () => ({ shared: true, sharedId: 'shared-1' }));
    const onShared = vi.fn();
    const loadContent = vi.fn(async () => ({ title: 'Plan.md', content: '# Plan\n' }));
    Object.defineProperty(window, 'sharedFilesAPI', {
      configurable: true,
      value: {
        getTargets: vi.fn(async () => [{
          id: 'group:design',
          kind: 'group',
          targetId: 'design',
          label: 'Design',
          detail: '2 members',
          status: 'accepted',
          committable: true,
          isDefault: true,
          recipientUserIds: ['user-2'],
        }]),
        setDefaultDestinations: vi.fn(async () => ({ ok: true })),
        share,
      },
    });

    render(
      <RiverShareLauncher
        file={{ filePath: '/Users/afar/.fieldtheory/library/scratchpad/Plan.md', title: 'Plan' }}
        loadContent={loadContent}
        onCancel={vi.fn()}
        onShared={onShared}
      />
    );

    const input = await screen.findByRole('searchbox', { name: 'Search River targets' });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(share).toHaveBeenCalledWith({
        filePath: '/Users/afar/.fieldtheory/library/scratchpad/Plan.md',
        title: 'Plan.md',
        content: '# Plan\n',
        type: 'document',
        targets: [{ id: 'group:design', kind: 'group' }],
      });
    });
    expect(loadContent).toHaveBeenCalledWith('/Users/afar/.fieldtheory/library/scratchpad/Plan.md');
    expect(onShared).toHaveBeenCalledWith('Shared Plan to River');
  });
});
