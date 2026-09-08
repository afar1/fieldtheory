import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RiverTeamsSettings, { type RiverTeamsSettingsProps } from '../RiverTeamsSettings';
import type { RiverTeam, RiverTeamsState } from '../../../electron/shared/riverTeams';

vi.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => ({ theme: {
    accent: '#0f766e', bg: '#ffffff', border: '#d1d5db', error: '#dc2626', isDark: false,
    selectedBg: '#f3f4f6', surface1: '#ffffff', surface2: '#f9fafb', text: '#111111',
    textSecondary: '#666666', warning: '#d97706', info: '#2563eb',
  } }),
}));

afterEach(cleanup);

const work: RiverTeam = {
  id: 'work', name: 'Work', role: 'owner', members: [
    { userId: 'me', email: 'me@example.com', role: 'owner' },
    { userId: 'admin', email: 'admin@example.com', role: 'admin' },
    { userId: 'member', email: 'member@example.com', role: 'member' },
  ],
  pendingInvites: [{ id: 'outgoing', teamId: 'work', teamName: 'Work', email: 'new@example.com', createdAt: '2026-09-07T12:00:00Z' }],
};

const friends: RiverTeam = {
  id: 'friends', name: 'Friends', role: 'member', members: [
    { userId: 'friend', email: 'friend@example.com', role: 'owner' },
    { userId: 'me', email: 'me@example.com', role: 'member' },
  ], pendingInvites: [],
};

const startingState: RiverTeamsState = { teams: [work, friends], incomingInvites: [] };

async function setup(overrides: Partial<RiverTeamsSettingsProps> = {}) {
  const props = {
    loadTeams: vi.fn(async () => startingState),
    mutateTeam: vi.fn(async () => ({ ok: true })),
    currentUserId: 'me',
    ...overrides,
  };
  const view = render(<RiverTeamsSettings {...props} />);
  await waitFor(() => expect(screen.queryByText('Loading teams…')).toBeNull());
  return { ...view, props };
}

describe('RiverTeamsSettings', () => {
  it('switches between simultaneous team memberships and always allows creation', async () => {
    await setup();
    expect(screen.getByText('admin@example.com')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete team' })).toBeTruthy();

    fireEvent.change(screen.getByRole('combobox', { name: 'Selected team' }), { target: { value: 'friends' } });
    expect(screen.getByText('friend@example.com')).toBeTruthy();
    expect(screen.queryByText('admin@example.com')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete team' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Rename team' })).toBeNull();
    expect(screen.queryByLabelText('Teammate email')).toBeNull();
    expect(screen.getByRole('button', { name: 'Leave team' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'New team' }));
    expect(screen.getByRole('textbox', { name: 'New team name' })).toBeTruthy();
  });

  it('creates another team and selects it without replacing existing memberships', async () => {
    const created: RiverTeam = { ...work, id: 'new-team', name: 'Book club', pendingInvites: [], members: [work.members[0]] };
    const loadTeams = vi.fn().mockResolvedValueOnce(startingState).mockResolvedValue({ teams: [...startingState.teams, created], incomingInvites: [] });
    const mutateTeam = vi.fn(async () => ({ ok: true, teamId: 'new-team' }));
    await setup({ loadTeams, mutateTeam });
    fireEvent.click(screen.getByRole('button', { name: 'New team' }));
    fireEvent.change(screen.getByLabelText('New team name'), { target: { value: ' Book club ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create team' }));

    await waitFor(() => expect(mutateTeam).toHaveBeenCalledWith({ kind: 'create', name: 'Book club' }));
    await waitFor(() => expect((screen.getByRole('combobox', { name: 'Selected team' }) as HTMLSelectElement).value).toBe('new-team'));
    expect(within(screen.getByRole('combobox', { name: 'Selected team' })).getAllByRole('option')).toHaveLength(3);
    expect(screen.queryByLabelText('New team name')).toBeNull();
  });

  it('invites an email with no existing account and keeps the email when rejected', async () => {
    const mutateTeam = vi.fn().mockResolvedValueOnce({ ok: false, error: 'Could not send the invitation.' }).mockResolvedValueOnce({ ok: true });
    await setup({ mutateTeam });
    expect(screen.getByText(/even before they have an account/)).toBeTruthy();
    const input = screen.getByLabelText('Teammate email') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'brandnew@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Invite' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Could not send the invitation.'));
    expect(input.value).toBe('brandnew@example.com');
    expect(mutateTeam).toHaveBeenCalledWith({ kind: 'invite', teamId: 'work', email: 'brandnew@example.com' });
    await waitFor(() => expect((screen.getByRole('button', { name: 'Invite' }) as HTMLButtonElement).disabled).toBe(false));

    fireEvent.click(screen.getByRole('button', { name: 'Invite' }));
    await waitFor(() => expect(input.value).toBe(''));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('lets the owner promote and demote admins and confirms ownership transfer', async () => {
    const { props } = await setup();
    fireEvent.change(screen.getByLabelText('Manage member@example.com'), { target: { value: 'admin' } });
    await waitFor(() => expect(props.mutateTeam).toHaveBeenCalledWith({ kind: 'role', teamId: 'work', userId: 'member', role: 'admin' }));
    await waitFor(() => expect((screen.getByLabelText('Manage admin@example.com') as HTMLSelectElement).disabled).toBe(false));
    fireEvent.change(screen.getByLabelText('Manage admin@example.com'), { target: { value: 'member' } });
    await waitFor(() => expect(props.mutateTeam).toHaveBeenCalledWith({ kind: 'role', teamId: 'work', userId: 'admin', role: 'member' }));
    await waitFor(() => expect((screen.getByLabelText('Manage member@example.com') as HTMLSelectElement).disabled).toBe(false));

    fireEvent.change(screen.getByLabelText('Manage member@example.com'), { target: { value: 'transfer' } });
    expect(props.mutateTeam).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/You’ll become an admin/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Transfer ownership' }));
    await waitFor(() => expect(props.mutateTeam).toHaveBeenCalledWith({ kind: 'transfer', teamId: 'work', userId: 'member' }));
    expect(screen.queryByRole('button', { name: 'Leave team' })).toBeNull();
  });

  it('allows admins to manage ordinary members and invitations without owner powers', async () => {
    const adminTeam: RiverTeam = { ...work, role: 'admin' };
    const { props } = await setup({ currentUserId: 'admin', loadTeams: vi.fn(async () => ({ teams: [adminTeam], incomingInvites: [] })) });
    expect(screen.getByRole('button', { name: 'Rename team' })).toBeTruthy();
    expect(screen.getByLabelText('Teammate email')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel invitation for new@example.com' })).toBeTruthy();
    expect(screen.queryByLabelText('Manage member@example.com')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove me@example.com' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove admin@example.com' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete team' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Remove member@example.com' }));
    expect(props.mutateTeam).not.toHaveBeenCalled();
    expect(screen.getByText(/Any private copies they saved will remain/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove member' }));
    await waitFor(() => expect(props.mutateTeam).toHaveBeenCalledWith({ kind: 'remove', teamId: 'work', userId: 'member' }));
  });

  it('accepts another team invitation while keeping current teams', async () => {
    const invite = { id: 'incoming', teamId: 'book-club', teamName: 'Book club', email: 'me@example.com', createdAt: '2026-09-07T12:00:00Z' };
    const joined: RiverTeam = { ...friends, id: 'book-club', name: 'Book club' };
    const loadTeams = vi.fn().mockResolvedValueOnce({ ...startingState, incomingInvites: [invite] }).mockResolvedValue({ teams: [...startingState.teams, joined], incomingInvites: [] });
    const mutateTeam = vi.fn(async () => ({ ok: true, teamId: 'book-club' }));
    const onChanged = vi.fn();
    await setup({ loadTeams, mutateTeam, onChanged });
    expect(screen.getByText(/Joining includes this team’s past River posts/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Decline invitation to Book club' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Accept invitation to Book club' }));

    await waitFor(() => expect(mutateTeam).toHaveBeenCalledWith({ kind: 'respond', inviteId: 'incoming', accept: true }));
    await waitFor(() => expect((screen.getByLabelText('Selected team') as HTMLSelectElement).value).toBe('book-club'));
    expect(within(screen.getByLabelText('Selected team')).getAllByRole('option')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: 'Accept invitation to Book club' })).toBeNull();
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it('preserves the team and confirmation after a failed removal', async () => {
    const mutateTeam = vi.fn(async () => ({ ok: false, error: 'Your team role changed. Refresh and try again.' }));
    await setup({ mutateTeam });
    fireEvent.change(screen.getByLabelText('Manage member@example.com'), { target: { value: 'remove' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove member' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Your team role changed.'));
    expect(screen.getByText('member@example.com')).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Remove member@example.com?' })).toBeTruthy();
    expect((screen.getByLabelText('Selected team') as HTMLSelectElement).value).toBe('work');
  });

  it('requires confirmation before leaving and preserves privately saved copies', async () => {
    const { props } = await setup({ loadTeams: vi.fn(async () => ({ teams: [friends], incomingInvites: [] })) });
    fireEvent.click(screen.getByRole('button', { name: 'Leave team' }));
    expect(props.mutateTeam).not.toHaveBeenCalled();
    expect(screen.getByText(/Your saved private copies will remain/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Leave team' }));
    await waitFor(() => expect(props.mutateTeam).toHaveBeenCalledWith({ kind: 'leave', teamId: 'friends' }));
  });

  it('refreshes on subscription events without applying another account’s stale response', async () => {
    let receiveChange: (() => void) | undefined;
    const unsubscribe = vi.fn();
    const subscribe = vi.fn((callback: () => void) => { receiveChange = callback; return unsubscribe; });
    let completeOldLoad!: (value: RiverTeamsState) => void;
    const loadTeams = vi.fn().mockResolvedValueOnce(startingState).mockImplementationOnce(() => new Promise<RiverTeamsState>(resolve => { completeOldLoad = resolve; })).mockResolvedValue({ teams: [], incomingInvites: [] });
    const { rerender, props } = await setup({ loadTeams, subscribe });
    act(() => receiveChange?.());
    expect(loadTeams).toHaveBeenCalledTimes(2);
    rerender(<RiverTeamsSettings {...props} currentUserId="other-account" />);
    await waitFor(() => expect(screen.getByText(/You haven’t joined a team yet/)).toBeTruthy());
    await act(async () => completeOldLoad(startingState));
    expect(screen.queryByLabelText('Selected team')).toBeNull();
    expect(screen.queryByText('admin@example.com')).toBeNull();
    expect(unsubscribe).toHaveBeenCalled();
  });
});
