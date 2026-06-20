import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RiverReader from '../RiverReader';

vi.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => ({
    theme: {
      accent: '#0f766e',
      bg: '#ffffff',
      border: '#d1d5db',
      hoverBg: '#f3f4f6',
      isDark: false,
      surface1: '#ffffff',
      surface2: '#f9fafb',
      text: '#111111',
      textSecondary: '#666666',
    },
  }),
}));

const timelineItems = [{
  documentId: 'doc-1',
  cachePath: '/Users/afar/.fieldtheory/library/River (shared)/Brief AF.md',
  title: 'Launch Brief',
  excerpt: 'Useful context for the launch.',
  authorCallsign: 'AF',
  authorInitials: 'AF',
  sourceLabel: 'Design',
  sourceKind: 'group' as const,
  sharedAt: new Date().toISOString(),
  pinned: false,
  public: false,
}];

const targets = [{
  id: 'group:design',
  kind: 'group' as const,
  targetId: 'design',
  label: 'Design',
  detail: '2 members',
  status: 'accepted' as const,
  committable: true,
  recipientUserIds: ['user-2'],
}];

afterEach(() => {
  delete (window as Partial<Window>).sharedFilesAPI;
});

describe('RiverReader', () => {
  it('loads the private timeline and opens cached cards', async () => {
    const getTimeline = vi.fn(async () => timelineItems);
    const onOpenItem = vi.fn();
    Object.defineProperty(window, 'sharedFilesAPI', {
      configurable: true,
      value: {
        getTimeline,
        getTargets: vi.fn(async () => targets),
      },
    });

    render(<RiverReader onOpenItem={onOpenItem} />);

    expect(await screen.findByText('Launch Brief')).toBeTruthy();
    expect(getTimeline).toHaveBeenCalledWith({ scope: 'private', sourceIds: [], limit: 50 });

    fireEvent.click(screen.getByText('Launch Brief'));

    expect(onOpenItem).toHaveBeenCalledWith(expect.objectContaining({ documentId: 'doc-1' }));
  });

  it('switches public tab and sends selected source filters', async () => {
    const getTimeline = vi.fn(async () => timelineItems);
    Object.defineProperty(window, 'sharedFilesAPI', {
      configurable: true,
      value: {
        getTimeline,
        getTargets: vi.fn(async () => targets),
      },
    });

    render(<RiverReader />);

    fireEvent.click(await screen.findByRole('button', { name: 'Edit River sources' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Design' }));
    await waitFor(() => {
      expect(getTimeline).toHaveBeenLastCalledWith({ scope: 'private', sourceIds: ['group:design'], limit: 50 });
    });

    fireEvent.click(screen.getByRole('tab', { name: 'Public' }));
    await waitFor(() => {
      expect(getTimeline).toHaveBeenLastCalledWith({ scope: 'public', sourceIds: ['group:design'], limit: 50 });
    });
  });
});
