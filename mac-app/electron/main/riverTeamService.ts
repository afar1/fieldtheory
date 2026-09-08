import { createLogger } from './logger';
import type { AuthManager } from './authManager';
import type { RiverTeamAction, RiverTeamResult, RiverTeamsState } from '../shared/riverTeams';

const log = createLogger('RiverTeams');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function failureMessage(error: unknown): string {
  const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error ?? '');
  if (/schema cache|does not exist|could not find.*function/i.test(message)) {
    return 'Team management is not available on the server yet. Please try again after the team service is activated.';
  }
  return message || 'Team request failed. Please try again.';
}

function normalizedAction(value: unknown): RiverTeamAction | null {
  if (!value || typeof value !== 'object' || !('kind' in value)) return null;
  const action = value as Record<string, unknown>;
  const id = (key: string) => typeof action[key] === 'string' && UUID.test(action[key]);
  const name = typeof action.name === 'string' ? action.name.trim() : '';
  const teamId = typeof action.teamId === 'string' ? action.teamId : '';
  const userId = typeof action.userId === 'string' ? action.userId : '';
  const inviteId = typeof action.inviteId === 'string' ? action.inviteId : '';
  switch (action.kind) {
    case 'create': return name && name.length <= 80 ? { kind: 'create', name } : null;
    case 'rename': return id('teamId') && name && name.length <= 80 ? { kind: 'rename', teamId, name } : null;
    case 'invite': {
      const email = typeof action.email === 'string' ? action.email.trim().toLowerCase() : '';
      return id('teamId') && email.length <= 254 && EMAIL.test(email) ? { kind: 'invite', teamId, email } : null;
    }
    case 'respond': return id('inviteId') && typeof action.accept === 'boolean'
      ? { kind: 'respond', inviteId, accept: action.accept } : null;
    case 'cancelInvite': return id('inviteId') ? { kind: 'cancelInvite', inviteId } : null;
    case 'remove': case 'transfer': return id('teamId') && id('userId') ? { kind: action.kind, teamId, userId } : null;
    case 'role': return id('teamId') && id('userId') && (action.role === 'admin' || action.role === 'member')
      ? { kind: 'role', teamId, userId, role: action.role } : null;
    case 'leave': case 'delete': return id('teamId') ? { kind: action.kind, teamId } : null;
    default: return null;
  }
}

export class RiverTeamService {
  constructor(private readonly authManager: AuthManager) {}

  subscribe(onChange: () => void | Promise<void>): () => void {
    const supabase = this.authManager.getSupabaseClient();
    const session = this.authManager.getSession();
    if (!supabase || !session?.user.id) return () => {};
    let active = true;
    const changed = () => {
      if (!active || this.authManager.getSession()?.user.id !== session.user.id) return;
      void Promise.resolve().then(() => {
        if (active && this.authManager.getSession()?.user.id === session.user.id) return onChange();
      }).catch((error) => log.warn('Team refresh failed:', error));
    };
    const channel = supabase.channel(`river-teams:${session.user.id}`);
    // RLS exposes the caller's memberships (including revocations), visible team
    // rosters, and invitations addressed to them or managed by them.
    for (const table of ['river_share_groups', 'river_share_group_members', 'river_share_group_invites']) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, changed);
    }
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') changed();
    });
    return () => {
      active = false;
      void supabase.removeChannel(channel).catch((error) => log.warn('Team subscription cleanup failed:', error));
    };
  }

  async listTeams(): Promise<RiverTeamsState> {
    const supabase = this.authManager.getSupabaseClient();
    const session = this.authManager.getSession();
    const empty = (error: string): RiverTeamsState => ({ teams: [], incomingInvites: [], error });
    if (!supabase || !session?.user.id) return empty('Sign in to manage teams.');
    try {
      const { data, error } = await supabase.rpc('river_team_state');
      if (!this.isCurrentSession(session)) return empty('Your account changed. Please try again.');
      if (error) return empty(failureMessage(error));
      if (!data || !Array.isArray(data.teams) || !Array.isArray(data.incomingInvites)) {
        return empty('The team service returned an invalid response.');
      }
      return data as RiverTeamsState;
    } catch (error) {
      return empty(failureMessage(error));
    }
  }

  async mutateTeam(input: unknown): Promise<RiverTeamResult> {
    const supabase = this.authManager.getSupabaseClient();
    const session = this.authManager.getSession();
    if (!supabase || !session?.user.id) return { ok: false, error: 'Sign in to manage teams.' };
    const action = normalizedAction(input);
    if (!action) return { ok: false, error: 'Please check the team details and try again.' };
    try {
      const { data, error } = await supabase.rpc('river_team_mutate', { action });
      if (!this.isCurrentSession(session)) return { ok: false, error: 'Your account changed. Please try again.' };
      if (error) return { ok: false, error: failureMessage(error) };
      if (!data || typeof data.ok !== 'boolean') return { ok: false, error: 'The team service returned an invalid response.' };
      return data as RiverTeamResult;
    } catch (error) {
      return { ok: false, error: failureMessage(error) };
    }
  }

  private isCurrentSession(session: NonNullable<ReturnType<AuthManager['getSession']>>): boolean {
    const current = this.authManager.getSession();
    return current?.user.id === session.user.id && current?.access_token === session.access_token;
  }
}
