import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  delete (window as Partial<Window>).teamAPI;
  delete (window as Partial<Window>).authAPI;
});

describe('RiverReader', () => {
  it('shows pushed shares without waiting for metadata and keeps expanded cards open', async () => {
    let notify: (() => void) | undefined;
    const unsubscribe = vi.fn();
    let current = timelineItems;
    const getTimeline = vi.fn(async () => current);
    Object.defineProperty(window, 'sharedFilesAPI', {
      configurable: true,
      value: {
        getTimeline,
        getTargets: () => new Promise(() => {}),
        getAvailability: () => new Promise(() => {}),
        onTimelineChanged: (callback: () => void) => { notify = callback; return unsubscribe; },
      },
    });
    const { unmount } = render(<RiverReader />);
    expect(await screen.findByText('Launch Brief')).toBeTruthy();
    fireEvent.click(screen.getByText('Show more ▾'));
    const newItem = { ...timelineItems[0], documentId: 'doc-2', title: 'New shared brief' };
    current = [newItem, ...timelineItems];
    const started = performance.now();
    await act(async () => { notify?.(); });
    expect(await screen.findByText('New shared brief')).toBeTruthy();
    expect(screen.getAllByText('Launch Brief')).toHaveLength(1);
    expect(screen.getByText('Collapse ▴')).toBeTruthy();
    expect(performance.now() - started).toBeLessThan(2000);
    unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('reads again when a share arrives during an in-flight timeline read', async () => {
    let notify: (() => void) | undefined;
    let finish: ((items: typeof timelineItems) => void) | undefined;
    const getTimeline = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
      .mockResolvedValue([{ ...timelineItems[0], title: 'Arrived during read' }]);
    Object.defineProperty(window, 'sharedFilesAPI', {
      configurable: true,
      value: { getTimeline, onTimelineChanged: (callback: () => void) => { notify = callback; return () => {}; } },
    });
    render(<RiverReader />);
    await act(async () => { notify?.(); notify?.(); finish?.([]); });
    expect(await screen.findByText('Arrived during read')).toBeTruthy();
  });

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

  it('keeps Public River unavailable to a member without beta access', async () => {
    Object.defineProperty(window, 'sharedFilesAPI', {
      configurable: true,
      value: {
        getTimeline: vi.fn(async () => timelineItems),
        getTargets: vi.fn(async () => targets),
        getAvailability: vi.fn(async () => ({ available: true, publicAllowed: false })),
      },
    });
    render(<RiverReader />);
    await screen.findByText('Launch Brief');
    await waitFor(() => expect(screen.queryByRole('tab', { name: 'Public' })).toBeNull());
    expect(screen.getByRole('tab', { name: 'Private' })).toBeTruthy();
  });

  it('clears the prior account immediately and ignores an older timeline response after sign-out', async () => {
    let authChanged!: (session: unknown | null) => void;
    let finishOld!: (items: typeof timelineItems) => void;
    const getTimeline = vi.fn().mockResolvedValueOnce(timelineItems)
      .mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }))
      .mockResolvedValue([]);
    const unsubscribe = vi.fn();
    Object.defineProperty(window, 'authAPI', { configurable: true, value: { onSessionChanged: (callback: typeof authChanged) => { authChanged = callback; return unsubscribe; } } });
    Object.defineProperty(window, 'sharedFilesAPI', { configurable: true, value: {
      getTimeline, getTargets: async () => targets,
      getAvailability: vi.fn().mockResolvedValueOnce({ available: true, publicAllowed: true }).mockResolvedValue({ available: false, publicAllowed: false, reason: 'not_authenticated' }),
    } });
    const { unmount } = render(<RiverReader />);
    await screen.findByText('Launch Brief');
    fireEvent.click(screen.getByRole('tab', { name: 'Public' }));
    await waitFor(() => expect(getTimeline).toHaveBeenCalledTimes(2));
    act(() => { authChanged(null); finishOld(timelineItems); });
    expect(screen.queryByText('Launch Brief')).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Public' })).toBeNull();
    await screen.findByText('Sign in to sync River');
    expect(screen.queryByText('Launch Brief')).toBeNull();
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('resets obsolete source selections and discards in-flight results on membership changes', async () => {
    let teamChanged!: () => void;
    let finishOld!: (items: typeof timelineItems) => void;
    let finishNew!: (items: typeof timelineItems) => void;
    const getTimeline = vi.fn().mockResolvedValueOnce(timelineItems)
      .mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { finishNew = resolve; }));
    Object.defineProperty(window, 'teamAPI', { configurable: true, value: { onTeamChanged: (callback: () => void) => { teamChanged = callback; return () => {}; } } });
    Object.defineProperty(window, 'sharedFilesAPI', { configurable: true, value: {
      getTimeline, getTargets: vi.fn().mockResolvedValueOnce(targets).mockResolvedValue([targets[0]]),
      getAvailability: async () => ({ available: true, publicAllowed: false }),
    } });
    render(<RiverReader />);
    await screen.findByText('Launch Brief');
    fireEvent.click(screen.getByRole('button', { name: 'Edit River sources' }));
    fireEvent.click(screen.getByRole('button', { name: /Design/ }));
    await waitFor(() => expect(getTimeline).toHaveBeenCalledTimes(2));
    act(() => { teamChanged(); finishOld(timelineItems); });
    expect(screen.queryByText('Launch Brief')).toBeNull();
    await waitFor(() => expect(getTimeline).toHaveBeenLastCalledWith({ scope: 'private', sourceIds: [], limit: 50 }));
    await act(async () => { finishNew([]); });
    expect(screen.queryByText('Launch Brief')).toBeNull();
  });

  it('switches public tab and sends private source filters', async () => {
    const getTimeline = vi.fn(async () => timelineItems);
    Object.defineProperty(window, 'sharedFilesAPI', {
      configurable: true,
      value: {
        getTimeline,
        getTargets: vi.fn(async () => targets),
        getAvailability: vi.fn(async () => ({ available: true, publicAllowed: true })),
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
