import { describe, expect, it } from 'vitest';
import { buildTeamSettingsState, initialsFromText, type TeamServiceStateLike } from '../utils/teamSettingsState';

const currentUser = {
  id: 'user-1',
  email: 'af@example.com',
  displayName: 'Andrew Field',
  initials: 'AF',
};

function baseTeamState(overrides: Partial<TeamServiceStateLike> = {}): TeamServiceStateLike {
  return {
    available: false,
    isOwner: false,
    members: [],
    pendingIncoming: [],
    pendingOutgoing: [],
    ...overrides,
  };
}

describe('teamSettingsState', () => {
  it('builds a solo Team settings state', () => {
    expect(buildTeamSettingsState({
      teamState: baseTeamState({ reason: 'no_team_members' }),
      currentUser,
      loading: false,
      error: null,
    })).toEqual({
      loading: false,
      error: null,
      currentUserRole: null,
      members: [],
      pendingInvites: [],
    });
  });

  it('maps owner teams with the current user first', () => {
    const state = buildTeamSettingsState({
      teamState: baseTeamState({
        available: true,
        isOwner: true,
        members: [{
          contactId: 'contact-1',
          email: 'jamie@example.com',
          role: 'member',
        }],
      }),
      currentUser,
      loading: false,
      error: null,
    });

    expect(state.currentUserRole).toBe('owner');
    expect(state.members).toMatchObject([
      { contactId: 'user-1', email: 'af@example.com', initials: 'AF', role: 'owner', isCurrentUser: true },
      { contactId: 'contact-1', email: 'jamie@example.com', initials: 'JA', role: 'member' },
    ]);
  });

  it('maps member teams with the owner plus current user', () => {
    const state = buildTeamSettingsState({
      teamState: baseTeamState({
        available: true,
        isOwner: false,
        members: [{
          contactId: 'contact-1',
          email: '',
          role: 'owner',
        }],
      }),
      currentUser,
      loading: false,
      error: null,
    });

    expect(state.currentUserRole).toBe('member');
    expect(state.members).toMatchObject([
      { contactId: 'contact-1', email: 'Team owner', displayName: 'Team owner', initials: 'TO', role: 'owner' },
      { contactId: 'user-1', email: 'af@example.com', initials: 'AF', role: 'member', isCurrentUser: true },
    ]);
  });

  it('keeps pending incoming and outgoing invites visible', () => {
    const state = buildTeamSettingsState({
      teamState: baseTeamState({
        pendingIncoming: [{ contactId: 'incoming-1', email: 'owner@example.com' }],
        pendingOutgoing: [{ contactId: 'outgoing-1', email: 'sam@example.com' }],
      }),
      currentUser,
      loading: false,
      error: null,
    });

    expect(state.pendingInvites).toEqual([
      { contactId: 'incoming-1', email: 'owner@example.com', direction: 'incoming', invitedByName: 'Team owner', initials: 'OW' },
      { contactId: 'outgoing-1', email: 'sam@example.com', direction: 'outgoing', initials: 'SA' },
    ]);
  });

  it('surfaces ambiguous team scope as an actionable v1 message', () => {
    expect(buildTeamSettingsState({
      teamState: baseTeamState({ reason: 'ambiguous_team_scope' }),
      currentUser,
      loading: false,
      error: null,
    }).error).toBe('Multiple teams are connected. River supports one team for v1.');
  });

  it('derives stable initials from names and emails', () => {
    expect(initialsFromText('Andrew Field')).toBe('AF');
    expect(initialsFromText('jamie@example.com')).toBe('JA');
    expect(initialsFromText('')).toBe('FT');
  });
});
