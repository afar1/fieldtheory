export type RiverTeamRole = 'owner' | 'admin' | 'member';

export interface RiverTeamMember {
  userId: string;
  email: string;
  role: RiverTeamRole;
}

export interface RiverTeamInvite {
  id: string;
  teamId: string;
  teamName: string;
  email: string;
  createdAt: string;
}

export interface RiverTeam {
  id: string;
  name: string;
  role: RiverTeamRole;
  members: RiverTeamMember[];
  pendingInvites: RiverTeamInvite[];
}

export interface RiverTeamsState {
  teams: RiverTeam[];
  incomingInvites: RiverTeamInvite[];
  error?: string;
}

export type RiverTeamAction =
  | { kind: 'create'; name: string }
  | { kind: 'rename'; teamId: string; name: string }
  | { kind: 'invite'; teamId: string; email: string }
  | { kind: 'respond'; inviteId: string; accept: boolean }
  | { kind: 'cancelInvite'; inviteId: string }
  | { kind: 'remove'; teamId: string; userId: string }
  | { kind: 'role'; teamId: string; userId: string; role: 'admin' | 'member' }
  | { kind: 'transfer'; teamId: string; userId: string }
  | { kind: 'leave'; teamId: string }
  | { kind: 'delete'; teamId: string };

export interface RiverTeamResult {
  ok: boolean;
  teamId?: string;
  error?: string;
}
