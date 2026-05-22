import type { TeamMemberRole, TeamMemberView, TeamPendingInviteView, TeamSettingsState } from '../components/TeamSettings';

export interface TeamServiceMemberLike {
  contactId: string;
  email: string;
  role: TeamMemberRole;
}

export interface TeamServiceInviteLike {
  contactId: string;
  email: string;
}

export interface TeamServiceStateLike {
  available: boolean;
  reason?: string;
  isOwner: boolean;
  members: TeamServiceMemberLike[];
  pendingIncoming: TeamServiceInviteLike[];
  pendingOutgoing: TeamServiceInviteLike[];
}

export interface CurrentTeamUser {
  id?: string | null;
  email?: string | null;
  displayName?: string | null;
  initials?: string | null;
}

export function initialsFromText(value: string | null | undefined): string {
  const source = (value ?? '').includes('@') ? (value ?? '').split('@')[0] : value;
  const words = (source ?? '').split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (words.length >= 2) return `${words[0][0]}${words[1][0]}`.toUpperCase();
  return (words[0]?.slice(0, 2) || 'FT').toUpperCase();
}

function currentUserMember(currentUser: CurrentTeamUser, role: TeamMemberRole): TeamMemberView {
  const email = currentUser.email ?? '';
  const displayName = currentUser.displayName || 'You';
  return {
    contactId: currentUser.id ?? 'current-user',
    email,
    displayName,
    initials: initialsFromText(currentUser.initials || displayName || email),
    role,
    isCurrentUser: true,
  };
}

function buildMembers(teamState: TeamServiceStateLike | null, currentUser: CurrentTeamUser): TeamMemberView[] {
  if (!teamState?.available) return [];

  if (teamState.isOwner) {
    return [
      currentUserMember(currentUser, 'owner'),
      ...teamState.members.map((member) => ({
        contactId: member.contactId,
        email: member.email,
        initials: initialsFromText(member.email),
        role: member.role,
      })),
    ];
  }

  return [
    ...teamState.members.map((member) => ({
      contactId: member.contactId,
      email: member.email || 'Team owner',
      displayName: member.role === 'owner' ? 'Team owner' : undefined,
      initials: initialsFromText(member.email || 'Team owner'),
      role: member.role,
    })),
    currentUserMember(currentUser, 'member'),
  ];
}

function buildPendingInvites(teamState: TeamServiceStateLike | null): TeamPendingInviteView[] {
  return [
    ...(teamState?.pendingIncoming ?? []).map((invite) => ({
      contactId: invite.contactId,
      email: invite.email,
      direction: 'incoming' as const,
      invitedByName: 'Team owner',
      initials: initialsFromText(invite.email),
    })),
    ...(teamState?.pendingOutgoing ?? []).map((invite) => ({
      contactId: invite.contactId,
      email: invite.email,
      direction: 'outgoing' as const,
      initials: initialsFromText(invite.email),
    })),
  ];
}

export function buildTeamSettingsState(input: {
  teamState: TeamServiceStateLike | null;
  currentUser: CurrentTeamUser;
  loading: boolean;
  error: string | null;
}): TeamSettingsState {
  const { teamState, currentUser, loading, error } = input;

  return {
    loading,
    error: error ?? (teamState?.reason === 'ambiguous_team_scope'
      ? 'Multiple teams are connected. River supports one team for v1.'
      : null),
    currentUserRole: teamState?.available ? (teamState.isOwner ? 'owner' : 'member') : null,
    members: buildMembers(teamState, currentUser),
    pendingInvites: buildPendingInvites(teamState),
  };
}
