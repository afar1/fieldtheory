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
  content: [
    'Useful context for the launch.',
    '',
    'The complete launch plan lives here.',
    '',
    'This longer body makes sure River expands beyond the compact preview and renders the full document text instead of another short excerpt.',
    'It also keeps the test close to the product behavior, where shared briefs are usually long enough to need expansion.',
  ].join('\n'),
  authorUserId: 'user-2',
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
}, {
  id: 'person:andrew',
  kind: 'person' as const,
  targetId: 'andrew',
  label: 'Andrew Farah',
  callsign: 'AMB-MAC',
  initials: 'AF',
  detail: 'AMB-MAC',
  status: 'accepted' as const,
  committable: true,
  recipientUserIds: ['user-3'],
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

  it('shows a sign-in prompt when private River sync is not authenticated', async () => {
    const onNavigateToSignIn = vi.fn();
    Object.defineProperty(window, 'sharedFilesAPI', {
      configurable: true,
      value: {
        getTimeline: vi.fn(async () => []),
        getTargets: vi.fn(async () => []),
        getAvailability: vi.fn(async () => ({
          available: false,
          canWrite: false,
          hasTeamMembers: false,
          reason: 'not_authenticated',
        })),
      },
    });

    render(<RiverReader onNavigateToSignIn={onNavigateToSignIn} />);

    expect(await screen.findByText('Sign in to sync River')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(onNavigateToSignIn).toHaveBeenCalledTimes(1);
  });

  it('renders page navigation controls for the River page', () => {
    const onNavigateBack = vi.fn();
    const onNavigateForward = vi.fn();

    render(
      <RiverReader
        active={false}
        canNavigateBack
        canNavigateForward
        onNavigateBack={onNavigateBack}
        onNavigateForward={onNavigateForward}
      />
    );

    fireEvent.click(screen.getByLabelText('Back'));
    fireEvent.click(screen.getByLabelText('Forward'));

    expect(onNavigateBack).toHaveBeenCalledTimes(1);
    expect(onNavigateForward).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('River location').textContent).toContain('River');
  });

  it('expands River cards to the full document body', async () => {
    Object.defineProperty(window, 'sharedFilesAPI', {
      configurable: true,
      value: {
        getTimeline: vi.fn(async () => timelineItems),
        getTargets: vi.fn(async () => targets),
      },
    });

    render(<RiverReader />);

    fireEvent.click(await screen.findByText('Show more ▾'));

    expect(screen.getByText(/The complete launch plan lives here/)).toBeTruthy();
  });

  it('switches public tab and sends private source filters', async () => {
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
    expect(screen.getByRole('button', { name: /Old River/ })).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: /Design/ }));
    await waitFor(() => {
      expect(getTimeline).toHaveBeenLastCalledWith({ scope: 'private', sourceIds: ['person:andrew', 'legacy:old-river'], limit: 50 });
    });
    expect(screen.queryByText('Launch Brief')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Public' }));
    await waitFor(() => {
      expect(getTimeline).toHaveBeenLastCalledWith({ scope: 'public', sourceIds: [], limit: 50 });
    });
  });
});
