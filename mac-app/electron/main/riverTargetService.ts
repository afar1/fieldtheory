import type { AuthManager } from './authManager';
import { createLogger } from './logger';

const log = createLogger('RiverTargets');

export type RiverTargetKind = 'person' | 'group' | 'public';
export type RiverTargetStatus = 'accepted' | 'pending' | 'unavailable';
export type RiverSourcePreferenceValue = 'include' | 'mute' | 'hide';

export interface RiverShareTarget {
  id: string;
  kind: RiverTargetKind;
}

export interface RiverTarget {
  id: string;
  kind: RiverTargetKind;
  targetId: string;
  label: string;
  detail?: string;
  callsign?: string | null;
  initials?: string | null;
  avatarUrl?: string | null;
  tint?: string | null;
  status: RiverTargetStatus;
  committable: boolean;
  isDefault?: boolean;
  sourcePreference?: RiverSourcePreferenceValue | null;
  recipientUserIds: string[];
  memberCount?: number;
  legacyTeam?: boolean;
}

export interface RiverResolvedAudience {
  targets: RiverTarget[];
  recipients: string[];
  error?: string;
}

export interface RiverDefaultDestination {
  kind: RiverTargetKind;
  targetId: string;
  position?: number;
}

export interface RiverSourcePreference {
  sourceKind: 'mine' | RiverTargetKind;
  sourceId: string;
  preference: RiverSourcePreferenceValue;
  position?: number;
}

export interface RiverMutationResult {
  ok: boolean;
  error?: string;
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

interface GroupMemberRow {
  member_user_id?: string | null;
  status?: string | null;
}

interface GroupRow {
  id: string;
  owner_user_id: string;
  name: string | null;
  deleted_at?: string | null;
  river_share_group_members?: GroupMemberRow[] | null;
}

interface DefaultDestinationRow {
  target_kind: RiverTargetKind;
  target_id: string;
  position?: number | null;
}

interface SourcePreferenceRow {
  source_kind: RiverSourcePreference['sourceKind'];
  source_id: string;
  preference: RiverSourcePreferenceValue;
  position?: number | null;
}

function normalizeEmail(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase();
}

function targetKey(kind: RiverTargetKind, targetId: string): string {
  return `${kind}:${targetId}`;
}

function isMissingContactUserIdError(error: unknown): boolean {
  const message = (typeof error === 'object' && error && 'message' in error
    ? String((error as { message?: unknown }).message ?? '')
    : String(error ?? '')).toLowerCase();
  return message.includes('contact_user_id')
    && (message.includes('does not exist') || message.includes('schema cache'));
}

export class RiverTargetService {
  constructor(private readonly authManager: AuthManager) {}

  async listTargets(query = ''): Promise<RiverTarget[]> {
    const session = this.authManager.getSession();
    const userId = session?.user?.id;
    if (!userId) return [];

    const [contactTargets, groupTargets, defaults, preferences] = await Promise.all([
      this.contactTargets(),
      this.groupTargets(),
      this.defaultDestinationKeys(),
      this.sourcePreferenceMap(),
    ]);

    const targets = [
      ...groupTargets,
      ...contactTargets,
      this.publicTarget(),
    ].map((target) => ({
      ...target,
      isDefault: defaults.has(targetKey(target.kind, target.targetId)),
      sourcePreference: preferences.get(targetKey(target.kind, target.targetId)) ?? null,
    }));

    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return targets;
    return targets.filter((target) => (
      target.label.toLowerCase().includes(normalizedQuery)
      || target.detail?.toLowerCase().includes(normalizedQuery)
      || target.callsign?.toLowerCase().includes(normalizedQuery)
    ));
  }

  async resolveShareTargets(targets: RiverShareTarget[] | undefined): Promise<RiverResolvedAudience> {
    const availableTargets = await this.listTargets();
    const accepted = availableTargets.filter((target) => target.committable);
    const selected = targets?.length
      ? targets
      : accepted.filter((target) => target.isDefault);
    const fallbackSelection = selected.length ? selected : accepted.slice(0, 1);
    if (!fallbackSelection.length) {
      return { targets: [], recipients: [], error: 'Add an approved contact before sharing to River' };
    }

    const byId = new Map(accepted.map((target) => [target.id, target]));
    const resolvedTargets: RiverTarget[] = [];
    const recipients = new Set<string>();
    for (const requested of fallbackSelection) {
      const target = byId.get(requested.id);
      if (!target || target.kind !== requested.kind) {
        return { targets: [], recipients: [], error: 'Choose an approved River destination' };
      }
      resolvedTargets.push(target);
      for (const recipient of target.recipientUserIds) recipients.add(recipient);
    }

    return { targets: resolvedTargets, recipients: [...recipients] };
  }

  async setDefaultDestinations(destinations: RiverDefaultDestination[]): Promise<RiverMutationResult> {
    const supabase = this.authManager.getSupabaseClient() as any;
    const userId = this.authManager.getSession()?.user?.id;
    if (!supabase?.from || !userId) return { ok: false, error: 'Not authenticated' };

    const deleteResult = await supabase
      .from('river_default_destinations')
      .delete()
      .eq('user_id', userId);
    if (deleteResult.error) return { ok: false, error: deleteResult.error.message ?? 'Defaults update failed' };
    if (!destinations.length) return { ok: true };

    const rows = destinations.map((destination, index) => ({
      user_id: userId,
      target_kind: destination.kind,
      target_id: destination.targetId,
      position: destination.position ?? index,
    }));
    const { error } = await supabase.from('river_default_destinations').insert(rows);
    return error ? { ok: false, error: error.message ?? 'Defaults update failed' } : { ok: true };
  }

  async getSourcePreferences(): Promise<RiverSourcePreference[]> {
    const supabase = this.authManager.getSupabaseClient() as any;
    const userId = this.authManager.getSession()?.user?.id;
    if (!supabase?.from || !userId) return [];
    try {
      const preferencesQuery = supabase.from('river_source_preferences');
      if (!preferencesQuery?.select) return [];
      const { data, error } = await preferencesQuery
        .select('source_kind, source_id, preference, position')
        .eq('user_id', userId)
        .order('position', { ascending: true });
      if (error) return [];
      return ((data ?? []) as SourcePreferenceRow[]).map((row) => ({
        sourceKind: row.source_kind,
        sourceId: row.source_id,
        preference: row.preference,
        position: row.position ?? 0,
      }));
    } catch {
      return [];
    }
  }

  async updateSourcePreferences(preferences: RiverSourcePreference[]): Promise<RiverMutationResult> {
    const supabase = this.authManager.getSupabaseClient() as any;
    const userId = this.authManager.getSession()?.user?.id;
    if (!supabase?.from || !userId) return { ok: false, error: 'Not authenticated' };

    const rows = preferences.map((preference, index) => ({
      user_id: userId,
      source_kind: preference.sourceKind,
      source_id: preference.sourceId,
      preference: preference.preference,
      position: preference.position ?? index,
    }));
    const { error } = await supabase
      .from('river_source_preferences')
      .upsert(rows, { onConflict: 'user_id,source_kind,source_id' });
    return error ? { ok: false, error: error.message ?? 'Source preferences update failed' } : { ok: true };
  }

  private async contactTargets(): Promise<RiverTarget[]> {
    const supabase = this.authManager.getSupabaseClient() as any;
    const session = this.authManager.getSession();
    const userId = session?.user?.id;
    const userEmail = normalizeEmail(session?.user?.email);
    if (!supabase?.from || !userId) return [];

    let rows: ContactRow[] = [];
    try {
      const contactQuery = supabase.from('contacts');
      if (!contactQuery?.select) return [];
      let { data, error } = await contactQuery
        .select('*')
        .eq('relationship_type', 'team')
        .or(this.contactLookupFilter(userId, userEmail, true))
        .order('created_at', { ascending: false });

      if (error && isMissingContactUserIdError(error)) {
        const fallbackQuery = supabase.from('contacts');
        if (!fallbackQuery?.select) return [];
        const fallback = await fallbackQuery
          .select('*')
          .eq('relationship_type', 'team')
          .or(this.contactLookupFilter(userId, userEmail, false))
          .order('created_at', { ascending: false });
        data = fallback.data;
        error = fallback.error;
      }

      if (error) {
        log.warn('River contact target lookup failed:', error);
        return [];
      }
      rows = (data ?? []) as ContactRow[];
    } catch (err) {
      log.warn('River contact target lookup failed:', err);
      return [];
    }

    const people = new Map<string, RiverTarget>();
    const pendingPeople = new Map<string, RiverTarget>();
    const ownedTeamRecipients = new Map<string, string>();

    for (const row of rows) {
      const isOwner: boolean = row.owner_user_id === userId;
      const isContact: boolean = row.contact_user_id === userId || normalizeEmail(row.contact_email) === userEmail;
      const recipientUserId: string | null = isOwner ? row.contact_user_id ?? null : isContact ? row.owner_user_id : null;
      if (!recipientUserId || recipientUserId === userId) continue;

      const accepted = row.status === 'accepted';
      const email = normalizeEmail(row.contact_email);
      const target: RiverTarget = {
        id: targetKey('person', recipientUserId),
        kind: 'person',
        targetId: recipientUserId,
        label: email || (isOwner ? 'Team contact' : 'Team owner'),
        detail: email || undefined,
        status: accepted ? 'accepted' : 'pending',
        committable: accepted,
        recipientUserIds: accepted ? [recipientUserId] : [],
      };

      if (accepted) {
        people.set(recipientUserId, target);
        if (isOwner) ownedTeamRecipients.set(recipientUserId, email);
      } else if (!people.has(recipientUserId)) {
        pendingPeople.set(recipientUserId, target);
      }
    }

    const targets: RiverTarget[] = [];
    if (ownedTeamRecipients.size > 0) {
      targets.push({
        id: targetKey('group', userId),
        kind: 'group',
        targetId: userId,
        label: 'My Team',
        detail: `${ownedTeamRecipients.size} ${ownedTeamRecipients.size === 1 ? 'contact' : 'contacts'}`,
        status: 'accepted',
        committable: true,
        recipientUserIds: [...ownedTeamRecipients.keys()],
        memberCount: ownedTeamRecipients.size,
        legacyTeam: true,
      });
    }
    targets.push(...people.values());
    targets.push(...pendingPeople.values());
    return targets;
  }

  private async groupTargets(): Promise<RiverTarget[]> {
    const supabase = this.authManager.getSupabaseClient() as any;
    const userId = this.authManager.getSession()?.user?.id;
    if (!supabase?.from || !userId) return [];

    try {
      const groupQuery = supabase.from('river_share_groups');
      if (!groupQuery?.select) return [];
      const selectedGroups = groupQuery
        .select('id, owner_user_id, name, deleted_at, river_share_group_members(member_user_id, status)');
      if (!selectedGroups?.is) return [];
      const { data, error } = await selectedGroups
        .is('deleted_at', null)
        .order('created_at', { ascending: false });
      if (error) return [];
      return ((data ?? []) as GroupRow[]).map((group) => {
        const acceptedMembers = (group.river_share_group_members ?? [])
          .filter((member) => member.status === 'accepted' && member.member_user_id)
          .map((member) => member.member_user_id as string);
        const recipients = acceptedMembers.filter((memberUserId) => memberUserId !== userId);
        return {
          id: targetKey('group', group.id),
          kind: 'group',
          targetId: group.id,
          label: group.name?.trim() || 'Group',
          detail: `${acceptedMembers.length} ${acceptedMembers.length === 1 ? 'member' : 'members'}`,
          status: recipients.length > 0 || group.owner_user_id === userId ? 'accepted' : 'unavailable',
          committable: recipients.length > 0,
          recipientUserIds: recipients,
          memberCount: acceptedMembers.length,
        };
      });
    } catch (err) {
      log.warn('River group target lookup failed:', err);
      return [];
    }
  }

  private async defaultDestinationKeys(): Promise<Set<string>> {
    const supabase = this.authManager.getSupabaseClient() as any;
    const userId = this.authManager.getSession()?.user?.id;
    if (!supabase?.from || !userId) return new Set();

    try {
      const defaultsQuery = supabase.from('river_default_destinations');
      if (!defaultsQuery?.select) return new Set();
      const { data, error } = await defaultsQuery
        .select('target_kind, target_id, position')
        .eq('user_id', userId)
        .order('position', { ascending: true });
      if (error) return new Set();
      return new Set(((data ?? []) as DefaultDestinationRow[]).map((row) => targetKey(row.target_kind, row.target_id)));
    } catch {
      return new Set();
    }
  }

  private async sourcePreferenceMap(): Promise<Map<string, RiverSourcePreferenceValue>> {
    const preferences = await this.getSourcePreferences();
    return new Map(preferences.map((preference) => [
      targetKey(preference.sourceKind === 'mine' ? 'person' : preference.sourceKind, preference.sourceId),
      preference.preference,
    ]));
  }

  private publicTarget(): RiverTarget {
    return {
      id: targetKey('public', 'public'),
      kind: 'public',
      targetId: 'public',
      label: 'Public River',
      detail: 'Visible to entitled Field Theory users',
      status: 'accepted',
      committable: true,
      recipientUserIds: [],
    };
  }

  private contactLookupFilter(userId: string, userEmail: string, includeContactUserId: boolean): string {
    const filters = [`owner_user_id.eq.${userId}`];
    if (includeContactUserId) filters.push(`contact_user_id.eq.${userId}`);
    if (userEmail) filters.push(`contact_email.ilike.${userEmail}`);
    return filters.join(',');
  }
}
