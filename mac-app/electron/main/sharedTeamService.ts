import type { AuthManager } from './authManager';
import { createLogger } from './logger';

const log = createLogger('SharedTeam');

export type SharedTeamUnavailableReason =
  | 'not_authenticated'
  | 'no_team_members'
  | 'pending_only'
  | 'ambiguous_team_scope'
  | 'lookup_failed';

export interface SharedTeamMember {
  contactId: string;
  userId: string | null;
  email: string;
  role: 'owner' | 'member';
  teamScopeUserId: string;
}

export interface SharedTeamInvite {
  contactId: string;
  ownerUserId: string;
  contactUserId: string | null;
  email: string;
  direction: 'incoming' | 'outgoing';
  createdAt: string | null;
}

export interface SharedTeamState {
  available: boolean;
  currentTeamScopeUserId: string | null;
  reason?: SharedTeamUnavailableReason;
  isOwner: boolean;
  members: SharedTeamMember[];
  pendingIncoming: SharedTeamInvite[];
  pendingOutgoing: SharedTeamInvite[];
}

export interface SharedTeamMutationResult {
  ok: boolean;
  error?: string;
  alreadyExists?: boolean;
}

interface ContactRow {
  id: string;
  owner_user_id: string;
  contact_email: string | null;
  contact_user_id?: string | null;
  relationship_type: string | null;
  status: string | null;
  created_at?: string | null;
}

function normalizeEmail(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase();
}

function emptyState(reason: SharedTeamUnavailableReason): SharedTeamState {
  return {
    available: false,
    currentTeamScopeUserId: null,
    reason,
    isOwner: false,
    members: [],
    pendingIncoming: [],
    pendingOutgoing: [],
  };
}

function isMissingContactUserIdError(error: unknown): boolean {
  const message = (typeof error === 'object' && error && 'message' in error
    ? String((error as { message?: unknown }).message ?? '')
    : String(error ?? '')).toLowerCase();
  return message.includes('contact_user_id')
    && (message.includes('does not exist') || message.includes('schema cache'));
}

export class SharedTeamService {
  constructor(private readonly authManager: AuthManager) {}

  async getTeamState(): Promise<SharedTeamState> {
    const supabase = this.authManager.getSupabaseClient();
    const session = this.authManager.getSession();
    const userId = session?.user?.id;
    const userEmail = normalizeEmail(session?.user?.email);

    if (!supabase || !userId) return emptyState('not_authenticated');

    try {
      let { data, error } = await supabase
        .from('contacts')
        .select('*')
        .eq('relationship_type', 'team')
        .or(this.teamLookupFilter(userId, userEmail, true))
        .order('created_at', { ascending: false });

      if (error && isMissingContactUserIdError(error)) {
        const fallback = await supabase
          .from('contacts')
          .select('*')
          .eq('relationship_type', 'team')
          .or(this.teamLookupFilter(userId, userEmail, false))
          .order('created_at', { ascending: false });
        data = fallback.data;
        error = fallback.error;
      }

      if (error) {
        log.warn('Team state lookup failed:', error);
        return emptyState('lookup_failed');
      }

      return this.stateFromRows((data ?? []) as ContactRow[], userId, userEmail);
    } catch (err) {
      log.warn('Team state lookup failed:', err);
      return emptyState('lookup_failed');
    }
  }

  async inviteMember(email: string): Promise<SharedTeamMutationResult> {
    const supabase = this.authManager.getSupabaseClient();
    const session = this.authManager.getSession();
    const userId = session?.user?.id;
    const normalizedEmail = normalizeEmail(email);

    if (!supabase || !userId) return { ok: false, error: 'Not authenticated' };
    if (!normalizedEmail) return { ok: false, error: 'Email is required' };
    if (normalizedEmail === normalizeEmail(session.user.email)) {
      return { ok: false, error: 'Cannot invite yourself' };
    }

    try {
      const { data: existingUser } = await supabase
        .from('profiles')
        .select('id')
        .ilike('email', normalizedEmail)
        .maybeSingle();

      const { data: existingContact, error: existingContactError } = await supabase
        .from('contacts')
        .select('id, relationship_type, status')
        .eq('owner_user_id', userId)
        .ilike('contact_email', normalizedEmail)
        .maybeSingle();

      if (existingContactError) {
        return { ok: false, error: existingContactError.message ?? 'Invite failed' };
      }

      const existing = existingContact as Pick<ContactRow, 'id' | 'relationship_type' | 'status'> | null;
      if (existing?.relationship_type === 'team') {
        return { ok: true, alreadyExists: true };
      }

      if (existing?.id) {
        const { data, error } = await supabase
          .from('contacts')
          .update({
            contact_user_id: existingUser?.id ?? null,
            relationship_type: 'team',
            status: 'pending',
          })
          .eq('id', existing.id)
          .eq('owner_user_id', userId)
          .select('id')
          .maybeSingle();

        if (error) return { ok: false, error: error.message ?? 'Invite failed' };
        if (!data) return { ok: false, error: 'Invite failed because no contact row was updated' };
        return { ok: true };
      }

      const { error } = await supabase
        .from('contacts')
        .insert({
          owner_user_id: userId,
          contact_email: normalizedEmail,
          contact_user_id: existingUser?.id ?? null,
          relationship_type: 'team',
          status: 'pending',
        });

      if (error) return { ok: false, error: error.message ?? 'Invite failed' };
      return { ok: true };
    } catch (err) {
      log.warn('Team invite failed:', err);
      return { ok: false, error: 'Invite failed' };
    }
  }

  async respondToInvite(contactId: string, accept: boolean): Promise<SharedTeamMutationResult> {
    const supabase = this.authManager.getSupabaseClient();
    const session = this.authManager.getSession();
    const userId = session?.user?.id;
    const userEmail = normalizeEmail(session?.user?.email);

    if (!supabase || !userId) return { ok: false, error: 'Not authenticated' };
    if (!contactId) return { ok: false, error: 'Invite is required' };

    try {
      const query = accept
        ? supabase
          .from('contacts')
          .update({ status: 'accepted', contact_user_id: userId })
          .eq('id', contactId)
          .eq('relationship_type', 'team')
          .eq('status', 'pending')
          .or(this.inviteTargetFilter(userId, userEmail, true))
        : supabase
          .from('contacts')
          .delete()
          .eq('id', contactId)
          .eq('relationship_type', 'team')
          .eq('status', 'pending')
          .or(this.inviteTargetFilter(userId, userEmail, true));

      let { data, error } = await query.select('id').maybeSingle();
      if (error && userEmail && isMissingContactUserIdError(error)) {
        const fallbackQuery = accept
          ? supabase
            .from('contacts')
            .update({ status: 'accepted' })
            .eq('id', contactId)
            .eq('relationship_type', 'team')
            .eq('status', 'pending')
            .or(this.inviteTargetFilter(userId, userEmail, false))
          : supabase
            .from('contacts')
            .delete()
            .eq('id', contactId)
            .eq('relationship_type', 'team')
            .eq('status', 'pending')
            .or(this.inviteTargetFilter(userId, userEmail, false));
        const fallback = await fallbackQuery.select('id').maybeSingle();
        data = fallback.data;
        error = fallback.error;
      }

      if (error) return { ok: false, error: error.message ?? 'Invite response failed' };
      if (!data) return { ok: false, error: 'Invite response failed because no invite row was updated' };
      return { ok: true };
    } catch (err) {
      log.warn('Team invite response failed:', err);
      return { ok: false, error: 'Invite response failed' };
    }
  }

  async removeMember(contactId: string): Promise<SharedTeamMutationResult> {
    const supabase = this.authManager.getSupabaseClient();
    const session = this.authManager.getSession();
    const userId = session?.user?.id;

    if (!supabase || !userId) return { ok: false, error: 'Not authenticated' };
    if (!contactId) return { ok: false, error: 'Member is required' };

    try {
      const { data, error } = await supabase
        .from('contacts')
        .delete()
        .eq('id', contactId)
        .eq('relationship_type', 'team')
        .eq('owner_user_id', userId)
        .select('id')
        .maybeSingle();

      if (error) return { ok: false, error: error.message ?? 'Remove member failed' };
      if (!data) return { ok: false, error: 'Remove member failed because no team row was removed' };
      return { ok: true };
    } catch (err) {
      log.warn('Remove team member failed:', err);
      return { ok: false, error: 'Remove member failed' };
    }
  }

  async leaveTeam(): Promise<SharedTeamMutationResult> {
    const supabase = this.authManager.getSupabaseClient();
    const session = this.authManager.getSession();
    const userId = session?.user?.id;
    const userEmail = normalizeEmail(session?.user?.email);

    if (!supabase || !userId) return { ok: false, error: 'Not authenticated' };

    try {
      let { data, error } = await supabase
        .from('contacts')
        .delete()
        .eq('relationship_type', 'team')
        .eq('status', 'accepted')
        .or(this.inviteTargetFilter(userId, userEmail, true))
        .select('id')
        .maybeSingle();

      if (error && userEmail && isMissingContactUserIdError(error)) {
        const fallback = await supabase
          .from('contacts')
          .delete()
          .eq('relationship_type', 'team')
          .eq('status', 'accepted')
          .or(this.inviteTargetFilter(userId, userEmail, false))
          .select('id')
          .maybeSingle();
        data = fallback.data;
        error = fallback.error;
      }

      if (error) return { ok: false, error: error.message ?? 'Leave team failed' };
      if (!data) return { ok: false, error: 'Leave team failed because no team row was removed' };
      return { ok: true };
    } catch (err) {
      log.warn('Leave team failed:', err);
      return { ok: false, error: 'Leave team failed' };
    }
  }

  private teamLookupFilter(userId: string, userEmail: string, includeContactUserId: boolean): string {
    const filters = [`owner_user_id.eq.${userId}`];
    if (includeContactUserId) filters.push(`contact_user_id.eq.${userId}`);
    if (userEmail) filters.push(`contact_email.ilike.${userEmail}`);
    return filters.join(',');
  }

  private inviteTargetFilter(userId: string, userEmail: string, includeContactUserId: boolean): string {
    const filters = includeContactUserId ? [`contact_user_id.eq.${userId}`] : [];
    if (userEmail) filters.push(`contact_email.ilike.${userEmail}`);
    return filters.join(',');
  }

  private stateFromRows(rows: ContactRow[], userId: string, userEmail: string): SharedTeamState {
    const pendingIncoming: SharedTeamInvite[] = [];
    const pendingOutgoing: SharedTeamInvite[] = [];
    const members: SharedTeamMember[] = [];
    const teamScopeUserIds = new Set<string>();
    const pendingIncomingTeamScopeUserIds = new Set<string>();

    for (const row of rows) {
      const isOwner = row.owner_user_id === userId;
      const isContact = row.contact_user_id === userId || normalizeEmail(row.contact_email) === userEmail;

      if (row.status === 'pending') {
        const invite = this.inviteFromRow(row, isOwner ? 'outgoing' : 'incoming');
        if (isOwner) pendingOutgoing.push(invite);
        else if (isContact) {
          pendingIncoming.push(invite);
          pendingIncomingTeamScopeUserIds.add(row.owner_user_id);
        }
        continue;
      }

      if (row.status !== 'accepted') continue;

      if (isOwner) {
        teamScopeUserIds.add(userId);
        members.push({
          contactId: row.id,
          userId: row.contact_user_id ?? null,
          email: normalizeEmail(row.contact_email),
          role: 'member',
          teamScopeUserId: userId,
        });
      } else if (isContact) {
        teamScopeUserIds.add(row.owner_user_id);
        members.push({
          contactId: row.id,
          userId: row.owner_user_id,
          email: '',
          role: 'owner',
          teamScopeUserId: row.owner_user_id,
        });
      }
    }

    if (teamScopeUserIds.size > 1) {
      return {
        available: false,
        currentTeamScopeUserId: null,
        reason: 'ambiguous_team_scope',
        isOwner: false,
        members,
        pendingIncoming,
        pendingOutgoing,
      };
    }

    const [currentTeamScopeUserId] = Array.from(teamScopeUserIds);
    if (!currentTeamScopeUserId) {
      if (pendingIncomingTeamScopeUserIds.size > 1) {
        return {
          available: false,
          currentTeamScopeUserId: null,
          reason: 'ambiguous_team_scope',
          isOwner: false,
          members,
          pendingIncoming,
          pendingOutgoing,
        };
      }
      const [pendingIncomingTeamScopeUserId] = Array.from(pendingIncomingTeamScopeUserIds);
      if (pendingIncomingTeamScopeUserId) {
        return {
          available: true,
          currentTeamScopeUserId: pendingIncomingTeamScopeUserId,
          isOwner: false,
          members: [{
            contactId: pendingIncoming[0]?.contactId ?? pendingIncomingTeamScopeUserId,
            userId: pendingIncomingTeamScopeUserId,
            email: '',
            role: 'owner',
            teamScopeUserId: pendingIncomingTeamScopeUserId,
          }],
          pendingIncoming,
          pendingOutgoing,
        };
      }
      if (pendingOutgoing.length) {
        return {
          available: true,
          currentTeamScopeUserId: userId,
          isOwner: true,
          members,
          pendingIncoming,
          pendingOutgoing,
        };
      }
      return {
        available: false,
        currentTeamScopeUserId: null,
        reason: pendingIncoming.length || pendingOutgoing.length ? 'pending_only' : 'no_team_members',
        isOwner: false,
        members,
        pendingIncoming,
        pendingOutgoing,
      };
    }

    return {
      available: true,
      currentTeamScopeUserId,
      isOwner: currentTeamScopeUserId === userId,
      members,
      pendingIncoming,
      pendingOutgoing,
    };
  }

  private inviteFromRow(row: ContactRow, direction: 'incoming' | 'outgoing'): SharedTeamInvite {
    return {
      contactId: row.id,
      ownerUserId: row.owner_user_id,
      contactUserId: row.contact_user_id ?? null,
      email: normalizeEmail(row.contact_email),
      direction,
      createdAt: row.created_at ?? null,
    };
  }
}
