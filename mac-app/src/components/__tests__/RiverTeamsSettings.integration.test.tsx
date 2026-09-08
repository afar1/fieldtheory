import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '@supabase/supabase-js';
import type { RiverTeamAction, RiverTeamsState } from '../../../electron/shared/riverTeams';
import SettingsPanel from '../SettingsPanel';

vi.mock('../../supabaseClient', () => ({ supabase: null }));
vi.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => ({ theme: {
    accent: '#0f766e', bg: '#ffffff', border: '#d1d5db', error: '#dc2626', isDark: false,
    selectedBg: '#f3f4f6', surface1: '#ffffff', surface2: '#f9fafb', text: '#111111',
    textSecondary: '#666666', warning: '#d97706', info: '#2563eb', success: '#16a34a',
  } }),
}));

const invitation = { id: 'incoming', teamId: 'garden', teamName: 'Garden crew', email: 'me@example.com', createdAt: '2026-09-07T12:00:00Z' };
const joinedTeam: RiverTeamsState['teams'][number] = {
  id: 'garden', name: 'Garden crew', role: 'member',
  members: [{ userId: 'me', email: 'me@example.com', role: 'member' }, { userId: 'owner', email: 'owner@example.com', role: 'owner' }],
  pendingInvites: [],
};

function sessionFor(id: string): Session {
  return {
    access_token: `access-${id}`, refresh_token: `refresh-${id}`, token_type: 'bearer', expires_in: 3600,
    user: { id, email: `${id}@example.com`, aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-09-07' },
  };
}

describe('RiverTeamsSettings within SettingsPanel', () => {
  let currentSession: Session | null;
  let publishSession: (value: Session | null) => void;
  let currentTeams: RiverTeamsState;
  let listeners: Set<() => void>;
  const listTeams = vi.fn<() => Promise<RiverTeamsState>>();
  const mutateTeam = vi.fn<(action: RiverTeamAction) => Promise<{ ok: boolean; teamId?: string }>>();
  const getEntitlement = vi.fn();

  beforeEach(() => {
    currentSession = sessionFor('me');
    currentTeams = { teams: [], incomingInvites: [invitation] };
    listeners = new Set();
    listTeams.mockReset().mockImplementation(async () => structuredClone(currentTeams));
    mutateTeam.mockReset().mockResolvedValue({ ok: true });
    getEntitlement.mockReset().mockImplementation(async () => ({ allowed: currentTeams.teams.length > 0, publicAllowed: false, userId: currentSession?.user.id, reason: 'not_entitled' }));
    window.authAPI = {
      getSession: vi.fn(async () => currentSession),
      onSessionChanged: (callback: (value: Session | null) => void) => {
        publishSession = value => { currentSession = value; callback(value); };
        return () => {};
      },
    } as unknown as NonNullable<Window['authAPI']>;
    window.teamAPI = {
      listTeams, mutateTeam, getEntitlement,
      onTeamChanged: (callback: () => void) => { listeners.add(callback); return () => listeners.delete(callback); },
    } as unknown as NonNullable<Window['teamAPI']>;
  });

  afterEach(() => {
    cleanup();
    delete window.authAPI;
    delete window.teamAPI;
    localStorage.clear();
  });

  async function openTeams() {
    render(<SettingsPanel initialSection="account" />);
    const navigation = await screen.findByRole('button', { name: /Teams?$/ });
    fireEvent.click(navigation);
    await waitFor(() => expect(screen.queryByText('Loading teams…')).toBeNull());
  }

  it('lets a signed-in nonmember open Teams and accept or decline invitations without beta access', async () => {
    await openTeams();
    expect(getEntitlement).toHaveBeenCalled();
    expect(currentTeams.teams).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Accept invitation to Garden crew' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Decline invitation to Garden crew' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New team' })).toBeTruthy();
    expect(screen.queryByLabelText('Selected team')).toBeNull();
  });

  it('refreshes teams and entitlement after accepting through Settings', async () => {
    mutateTeam.mockImplementation(async action => {
      expect(action).toEqual({ kind: 'respond', inviteId: 'incoming', accept: true });
      currentTeams = { teams: [joinedTeam], incomingInvites: [] };
      for (const listener of listeners) listener();
      return { ok: true, teamId: 'garden' };
    });
    await openTeams();
    const entitlementReads = getEntitlement.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Accept invitation to Garden crew' }));
    await screen.findByRole('combobox', { name: 'Selected team' });
    await waitFor(() => expect((screen.getByLabelText('Selected team') as HTMLSelectElement).value).toBe('garden'));
    expect(screen.queryByRole('button', { name: 'Accept invitation to Garden crew' })).toBeNull();
    expect(listTeams.mock.calls.length).toBeGreaterThan(1);
    await waitFor(() => expect(getEntitlement.mock.calls.length).toBeGreaterThan(entitlementReads));
    expect(screen.getByRole('button', { name: 'Leave team' })).toBeTruthy();
  });

  it('remounts on account switch and ignores a pending old-account team refresh', async () => {
    currentTeams = { teams: [joinedTeam], incomingInvites: [] };
    await openTeams();
    expect(screen.getByText('owner@example.com')).toBeTruthy();
    let completeOldRequest!: (value: RiverTeamsState) => void;
    listTeams.mockImplementationOnce(() => new Promise(resolve => { completeOldRequest = resolve; }));
    act(() => { for (const listener of listeners) listener(); });

    currentTeams = { teams: [], incomingInvites: [] };
    act(() => publishSession(sessionFor('other')));
    await screen.findByText(/You haven’t joined a team yet/);
    await act(async () => completeOldRequest({ teams: [joinedTeam], incomingInvites: [] }));
    expect(screen.queryByText('owner@example.com')).toBeNull();
    expect(screen.queryByLabelText('Selected team')).toBeNull();
    expect(screen.getByRole('button', { name: 'New team' })).toBeTruthy();

    act(() => publishSession(null));
    await waitFor(() => expect(screen.queryByRole('button', { name: /Teams?$/ })).toBeNull());
    expect(screen.queryByRole('button', { name: 'New team' })).toBeNull();
  });
});
