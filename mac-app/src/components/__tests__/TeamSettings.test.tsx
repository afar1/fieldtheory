import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import TeamSettings, { type TeamSettingsState } from '../TeamSettings';

vi.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => ({
    theme: {
      accent: '#0f766e',
      bg: '#ffffff',
      border: '#d1d5db',
      error: '#dc2626',
      isDark: false,
      selectedBg: '#f3f4f6',
      surface1: '#ffffff',
      surface2: '#f9fafb',
      text: '#111111',
      textSecondary: '#666666',
      warning: '#d97706',
    },
  }),
}));

const ownerMember = {
  contactId: 'owner',
  email: 'andrew@example.com',
  displayName: 'Andrew',
  initials: 'AF',
  role: 'owner' as const,
  isCurrentUser: true,
};

const teammate = {
  contactId: 'jamie',
  email: 'jamie@example.com',
  displayName: 'Jamie',
  initials: 'JS',
  role: 'member' as const,
};

function renderTeamSettings(state: TeamSettingsState, overrides = {}) {
  return render(
    <TeamSettings
      state={state}
      onInviteMember={vi.fn()}
      onRespondToInvite={vi.fn()}
      onRemoveMember={vi.fn()}
      onLeaveTeam={vi.fn()}
      {...overrides}
    />
  );
}

describe('TeamSettings', () => {
  it('shows a solo invite state', () => {
    renderTeamSettings({
      currentUserRole: null,
      members: [],
      pendingInvites: [],
    });

    expect(screen.getByText('You do not have a team yet.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Invite teammate' })).toBeTruthy();
  });

  it('submits teammate invites by email', async () => {
    const onInviteMember = vi.fn();
    renderTeamSettings({
      currentUserRole: null,
      members: [],
      pendingInvites: [],
    }, { onInviteMember });

    fireEvent.change(screen.getByLabelText('Teammate email'), { target: { value: 'jamie@example.com' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Invite teammate' }));
    });

    expect(onInviteMember).toHaveBeenCalledWith('jamie@example.com');
  });

  it('keeps the invite email when inviting fails', async () => {
    const onInviteMember = vi.fn(async () => false);
    renderTeamSettings({
      currentUserRole: null,
      members: [],
      pendingInvites: [],
    }, { onInviteMember });

    const input = screen.getByLabelText('Teammate email') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'jamie@example.com' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Invite teammate' }));
    });

    expect(input.value).toBe('jamie@example.com');
  });

  it('shows outgoing pending invites as invited', () => {
    renderTeamSettings({
      currentUserRole: null,
      members: [],
      pendingInvites: [{
        contactId: 'pending-jamie',
        email: 'jamie@example.com',
        direction: 'outgoing',
      }],
    });

    expect(screen.getByText('jamie@example.com')).toBeTruthy();
    expect(screen.getByText('Invited')).toBeTruthy();
  });

  it('lets incoming invitees accept or decline', async () => {
    const onRespondToInvite = vi.fn();
    renderTeamSettings({
      currentUserRole: null,
      members: [],
      pendingInvites: [{
        contactId: 'incoming-andrew',
        email: 'andrew@example.com',
        direction: 'incoming',
        invitedByName: 'Andrew',
      }],
    }, { onRespondToInvite });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    });
    expect(onRespondToInvite).toHaveBeenCalledWith('incoming-andrew', true);

    await waitFor(() => {
      expect((screen.getByRole('button', { name: 'Decline' }) as HTMLButtonElement).disabled).toBe(false);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    });
    expect(onRespondToInvite).toHaveBeenCalledWith('incoming-andrew', false);
  });

  it('shows accepted owner controls', async () => {
    const onRemoveMember = vi.fn();
    renderTeamSettings({
      currentUserRole: 'owner',
      members: [ownerMember, teammate],
      pendingInvites: [],
    }, { onRemoveMember });

    expect(screen.getByText('Andrew')).toBeTruthy();
    expect(screen.getByText('Jamie')).toBeTruthy();
    expect(screen.getByText('Owner')).toBeTruthy();
    expect(screen.getByText('Member')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    });
    expect(onRemoveMember).toHaveBeenCalledWith('jamie');
  });

  it('shows member leave control without owner remove controls', async () => {
    const onLeaveTeam = vi.fn();
    renderTeamSettings({
      currentUserRole: 'member',
      members: [
        { ...ownerMember, isCurrentUser: false },
        { ...teammate, isCurrentUser: true },
      ],
      pendingInvites: [],
    }, { onLeaveTeam });

    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Leave Andrew' }));
    });
    expect(onLeaveTeam).toHaveBeenCalledTimes(1);
  });

  it('locks all team actions when disabled', async () => {
    const onInviteMember = vi.fn();
    const onRespondToInvite = vi.fn();
    const onRemoveMember = vi.fn();
    const onLeaveTeam = vi.fn();

    const { unmount } = renderTeamSettings({
      currentUserRole: 'owner',
      members: [ownerMember, teammate],
      pendingInvites: [{
        contactId: 'incoming-andrew',
        email: 'andrew@example.com',
        direction: 'incoming',
        invitedByName: 'Andrew',
      }],
    }, {
      disabled: true,
      onInviteMember,
      onRespondToInvite,
      onRemoveMember,
      onLeaveTeam,
    });

    expect(screen.getByText('Team is temporarily locked.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Accept' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Decline' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Remove' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('textbox', { name: 'Teammate email' }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Invite teammate' }) as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
      fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
      fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
      fireEvent.click(screen.getByRole('button', { name: 'Invite teammate' }));
    });

    expect(onInviteMember).not.toHaveBeenCalled();
    expect(onRespondToInvite).not.toHaveBeenCalled();
    expect(onRemoveMember).not.toHaveBeenCalled();

    unmount();

    renderTeamSettings({
      currentUserRole: 'member',
      members: [
        { ...ownerMember, isCurrentUser: false },
        { ...teammate, isCurrentUser: true },
      ],
      pendingInvites: [],
    }, {
      disabled: true,
      onLeaveTeam,
    });

    expect((screen.getByRole('button', { name: 'Leave Andrew' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Leave Andrew' }));
    });

    expect(onLeaveTeam).not.toHaveBeenCalled();
  });
});
