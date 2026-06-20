import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { EventEmitter } from 'events';
import { AuthManager } from './authManager';
import { libraryDir } from './fieldTheoryPaths';
import { createLogger } from './logger';
import { SharedTeamService, type SharedTeamState } from './sharedTeamService';
import {
  RiverTargetService,
  type RiverDefaultDestination,
  type RiverMutationResult,
  type RiverResolvedAudience,
  type RiverSourcePreference,
  type RiverShareTarget,
  type RiverTarget,
} from './riverTargetService';
import {
  applySharedFileFrontmatter,
  buildSharedCacheFileName,
  buildSharedConflictFileName,
  inferSharedFileType,
  parseSharedFileFrontmatter,
  sharedFilesRoot,
  stripSharedFileFrontmatter,
  type SharedFileType,
} from './sharedFiles';
import { makeMarkdownImagesPortable, makeMarkdownImagesSharePortable } from './portableMarkdownImages';

const log = createLogger('SharedSync');
const EMPTY_ACTIVE_SET = new Set<string>();

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function isInsidePath(parentPath: string, childPath: string): boolean {
  const relativePath = path.relative(parentPath, childPath);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function isMarkdownFileName(fileName: string): boolean {
  return /\.(md|markdown)$/i.test(fileName);
}

function sidebarItemIdForSharedCacheFile(filePath: string): string {
  const resolvedPath = path.resolve(filePath);
  const root = libraryDir();
  if (!isInsidePath(root, resolvedPath)) return `external:${resolvedPath}`;
  const relPath = path.relative(root, resolvedPath).replace(/\\/g, '/');
  return `wiki:${relPath.replace(/\.(md|markdown)$/i, '')}`;
}

function contentForSharedTransport(filePath: string, content: string): string {
  const options = { libraryRoots: [libraryDir()] };
  const localPortable = makeMarkdownImagesPortable(filePath, stripSharedFileFrontmatter(content), options);
  return makeMarkdownImagesSharePortable(filePath, localPortable.content, options).content;
}

function safeTitleFromPath(filePath: string): string {
  return path.basename(filePath, path.extname(filePath)) || 'Untitled';
}

function sharedRowTitle(row: Pick<RiverDocumentLike, 'shared_name' | 'title'>): string {
  return row.shared_name?.trim() || row.title?.trim() || 'Untitled';
}

function authorInitialsFromSession(session: ReturnType<AuthManager['getSession']>): string {
  const metadata = session?.user?.user_metadata as Record<string, unknown> | undefined;
  const name = [metadata?.first_name, metadata?.last_name].filter((part) => typeof part === 'string' && part.trim()).join(' ');
  const source = name || session?.user?.email || 'FT';
  const words = source.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (words.length >= 2) return `${words[0][0]}${words[1][0]}`.toUpperCase();
  return (words[0]?.slice(0, 2) || 'FT').toUpperCase();
}

function authorCallsignFromSession(session: ReturnType<AuthManager['getSession']>): string | null {
  const metadata = session?.user?.user_metadata as Record<string, unknown> | undefined;
  const callsign = metadata?.callsign;
  return typeof callsign === 'string' && callsign.trim() ? callsign.trim() : null;
}

async function authorCallsignForSession(
  supabase: ReturnType<AuthManager['getSupabaseClient']>,
  session: ReturnType<AuthManager['getSession']>,
): Promise<string | null> {
  const metadataCallsign = authorCallsignFromSession(session);
  if (metadataCallsign) return metadataCallsign;
  if (!supabase || !session?.user?.id) return null;

  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('callsign')
      .eq('id', session.user.id)
      .maybeSingle();
    if (error || !data) return null;
    const callsign = (data as { callsign?: unknown }).callsign;
    return typeof callsign === 'string' && callsign.trim() ? callsign.trim() : null;
  } catch {
    return null;
  }
}

function sourceKeyForFilePath(filePath: string): string {
  const resolved = path.resolve(filePath);
  const root = libraryDir();
  if (isInsidePath(root, resolved)) {
    return path.relative(root, resolved).split(path.sep).join('/');
  }
  return `external/${sha256(resolved).slice(0, 16)}/${path.basename(resolved)}`;
}

export interface SharedFileStatus {
  shared: boolean;
  sharedId?: string;
  revision?: number;
  cachePath?: string;
  error?: string;
}

export interface SharedFileShareInput {
  filePath: string;
  title?: string;
  content: string;
  type?: SharedFileType;
  destinations?: SharedFileShareTarget[];
  targets?: RiverShareTarget[];
}

export interface SharedFileAudienceStatus {
  shared: boolean;
  sharedId?: string;
  targets: RiverTarget[];
  error?: string;
}

export interface SharedFileAudienceUpdateInput {
  filePath?: string;
  sharedId?: string;
  targets: RiverShareTarget[];
}

export interface SharedFileUpdateResult {
  ok: boolean;
  revision?: number;
  cachePath?: string;
  conflictPath?: string;
  remoteContent?: string;
  error?: string;
}

export interface SharedFilePresenceUser {
  userId: string;
  email: string | null;
  initials: string;
}

export interface SharedFilePinResult {
  ok: boolean;
  pinned?: boolean;
  reason?: 'not_authenticated' | 'not_entitled' | 'not_shared' | 'not_available' | 'read_only' | 'request_failed';
  error?: string;
}

export interface SharedFilesAvailability {
  available: boolean;
  canWrite: boolean;
  hasTeamMembers: boolean;
  reason?: 'not_authenticated' | 'not_entitled' | 'no_team_members' | 'pending_only' | 'ambiguous_team_scope' | 'lookup_failed';
  currentTeamScopeUserId?: string | null;
  stale?: boolean;
}

export type SharedFileDestinationKind = 'contact' | 'team';
export type SharedFileDestinationStatus = 'accepted' | 'pending';

export interface SharedFileShareTarget {
  id: string;
  kind: SharedFileDestinationKind;
}

export interface SharedFileDestination {
  id: string;
  kind: SharedFileDestinationKind;
  label: string;
  detail?: string;
  status: SharedFileDestinationStatus;
  recipientUserIds: string[];
  memberCount?: number;
  isDefault?: boolean;
}

interface TeamDocumentRow {
  id: string;
  team_scope_user_id: string;
  kind: 'document' | 'command';
  path: string;
  title: string;
  content: string;
  content_hash: string | null;
  client_id: string;
  client_created_at_ms: number;
  created_by: string;
  updated_by: string;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  original_source_path?: string | null;
  shared_name?: string | null;
  author_initials?: string | null;
  author_callsign?: string | null;
  revision?: number | null;
}

interface RiverDocumentRow {
  id: string;
  kind: 'document' | 'command';
  path: string;
  title: string;
  content: string;
  content_hash: string | null;
  client_id: string;
  client_created_at_ms: number;
  created_by: string;
  updated_by: string;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  original_source_path?: string | null;
  shared_name?: string | null;
  author_initials?: string | null;
  author_callsign?: string | null;
  revision?: number | null;
}

type RiverDocumentLike = RiverDocumentRow | TeamDocumentRow;

function sharedKindForType(type: SharedFileType): 'document' | 'command' {
  return type === 'command' ? 'command' : 'document';
}

function sharedPathForInput(input: SharedFileShareInput): string {
  const type = input.type ?? inferSharedFileType({ filePath: input.filePath, content: input.content });
  const sourceKey = sourceKeyForFilePath(input.filePath);
  const prefix = type === 'command' ? 'Commands' : type === 'plan' ? 'Plans' : 'Docs';
  return `${prefix}/${sourceKey.replace(/^external\//, '')}`;
}

function canWriteTeamDocuments(teamState: SharedTeamState): boolean {
  if (!teamState.available || !teamState.currentTeamScopeUserId) return false;
  return teamState.isOwner || teamState.pendingIncoming.length === 0;
}

export class SharedSyncService extends EventEmitter {
  private authManager: AuthManager;
  private sharedTeamService: SharedTeamService;
  private riverTargetService: RiverTargetService;
  private presenceChannel: any | null = null;
  private activePresenceSharedId: string | null = null;
  private riverDocumentsChannel: any | null = null;
  private remoteChangeSetupInFlight: Promise<void> | null = null;
  private remoteSyncInFlight = false;
  private remoteSyncQueued = false;
  private disposed = false;

  constructor(
    authManager: AuthManager,
    sharedTeamService = new SharedTeamService(authManager),
    riverTargetService = new RiverTargetService(authManager),
  ) {
    super();
    this.authManager = authManager;
    this.sharedTeamService = sharedTeamService;
    this.riverTargetService = riverTargetService;
  }

  async setActivePresence(sharedId: string | null): Promise<SharedFilePresenceUser[]> {
    await this.clearPresence();
    if (!sharedId) return [];

    const supabase = this.authManager.getSupabaseClient();
    const session = this.authManager.getSession();
    if (!supabase || !session?.user?.id) return [];

    this.activePresenceSharedId = sharedId;
    const channel = supabase.channel(`shared-file-presence:${sharedId}`, {
      config: { presence: { key: session.user.id } },
    });
    this.presenceChannel = channel;

    const emitPresence = () => {
      const users = this.presenceUsersFromState(channel.presenceState(), session.user.id);
      this.emit('presenceChanged', { sharedId, users });
    };

    try {
      channel.on('presence', { event: 'sync' }, emitPresence);
      channel.subscribe((status: string, err?: unknown) => {
        if (err) log.warn('River presence subscription error:', err);
        if (status !== 'SUBSCRIBED') return;
        void channel.track({
          userId: session.user.id,
          email: session.user.email ?? null,
          initials: authorInitialsFromSession(session),
          openedAt: Date.now(),
        }).then(() => {
          emitPresence();
        }).catch((trackError: unknown) => {
          log.warn('River presence track failed:', trackError);
        });
      });
    } catch (err) {
      log.warn('River presence subscription failed:', err);
      this.presenceChannel = null;
      this.activePresenceSharedId = null;
      try {
        await supabase.removeChannel(channel);
      } catch {
        // Presence setup failed; teardown is best-effort.
      }
      return [];
    }

    return [];
  }

  async clearPresence(): Promise<void> {
    const supabase = this.authManager.getSupabaseClient();
    const channel = this.presenceChannel;
    this.presenceChannel = null;
    this.activePresenceSharedId = null;
    if (!channel || !supabase) return;
    try {
      await channel.untrack();
      await supabase.removeChannel(channel);
    } catch {
      // Presence cleanup should never block navigation or app shutdown.
    }
  }

  async startRemoteChangeSync(): Promise<void> {
    if (this.disposed) return;
    if (this.remoteChangeSetupInFlight) return this.remoteChangeSetupInFlight;
    this.remoteChangeSetupInFlight = this.startRemoteChangeSyncNow().finally(() => {
      this.remoteChangeSetupInFlight = null;
    });
    return this.remoteChangeSetupInFlight;
  }

  private async startRemoteChangeSyncNow(): Promise<void> {
    const supabase = this.authManager.getSupabaseClient();
    const session = this.authManager.getSession();
    if (this.disposed || !supabase || !session?.user?.id) {
      await this.stopRemoteChangeSync();
      return;
    }

    if (this.riverDocumentsChannel) return;

    await this.stopRemoteChangeSync();
    if (this.disposed) return;
    this.riverDocumentsChannel = supabase
      .channel(`river-documents:${session.user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'river_documents',
        },
        () => {
          void this.syncFromRemoteChange();
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'river_document_audience',
          filter: `recipient_user_id=eq.${session.user.id}`,
        },
        () => {
          void this.syncFromRemoteChange();
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'river_document_pins',
          filter: `user_id=eq.${session.user.id}`,
        },
        () => {
          this.emit('pinsChanged');
        },
      )
      .subscribe((status: string, err?: unknown) => {
        if (err) log.warn('River realtime subscription error:', err);
        if (status === 'SUBSCRIBED') {
          void this.syncFromRemoteChange();
          this.emit('pinsChanged');
        }
      });
  }

  async stopRemoteChangeSync(): Promise<void> {
    const supabase = this.authManager.getSupabaseClient();
    const channel = this.riverDocumentsChannel;
    this.riverDocumentsChannel = null;
    if (!channel || !supabase) return;
    try {
      await supabase.removeChannel(channel);
    } catch (err) {
      log.warn('River realtime teardown failed:', err);
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await this.clearPresence();
    await this.stopRemoteChangeSync();
  }

  private async syncFromRemoteChange(): Promise<void> {
    if (this.disposed) return;
    if (this.remoteSyncInFlight) {
      this.remoteSyncQueued = true;
      return;
    }

    this.remoteSyncInFlight = true;
    try {
      const result = await this.syncOnce();
      if (result.written > 0 || result.removed > 0 || result.created > 0) {
        this.emit('cacheChanged', result);
        this.emit('pinsChanged');
      }
    } catch (err) {
      log.warn('River realtime sync failed:', err);
    } finally {
      this.remoteSyncInFlight = false;
      if (!this.disposed && this.remoteSyncQueued) {
        this.remoteSyncQueued = false;
        void this.syncFromRemoteChange();
      }
    }
  }

  private presenceUsersFromState(state: Record<string, Array<Record<string, unknown>>>, currentUserId?: string): SharedFilePresenceUser[] {
    return Object.values(state).flatMap((entries) => entries.map((entry) => ({
      userId: String(entry.userId ?? ''),
      email: typeof entry.email === 'string' ? entry.email : null,
      initials: typeof entry.initials === 'string' ? entry.initials : 'FT',
    }))).filter((user) => user.userId && user.userId !== currentUserId);
  }

  async getAvailability(): Promise<SharedFilesAvailability> {
    const session = this.authManager.getSession();
    if (!session?.user?.id) {
      return {
        available: false,
        canWrite: false,
        hasTeamMembers: false,
        reason: 'not_authenticated',
        currentTeamScopeUserId: null,
      };
    }
    const destinations = await this.getDestinations();
    const hasTeamMembers = destinations.some((destination) => destination.status === 'accepted');
    return {
      available: true,
      canWrite: true,
      hasTeamMembers,
      currentTeamScopeUserId: null,
    };
  }

  private async getActiveTeamState(): Promise<SharedTeamState | null> {
    const teamState = await this.sharedTeamService.getTeamState();
    return teamState.available && teamState.currentTeamScopeUserId ? teamState : null;
  }

  private getCachedTeamScopeUserIds(): string[] {
    const root = sharedFilesRoot();
    if (!fs.existsSync(root)) return [];
    const teamScopeUserIds = new Set<string>();
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isFile() || !isMarkdownFileName(entry.name)) continue;
      try {
        const parsed = parseSharedFileFrontmatter(fs.readFileSync(path.join(root, entry.name), 'utf-8'));
        if (parsed?.teamId) teamScopeUserIds.add(parsed.teamId);
      } catch {
        // Ignore unreadable cache files while inferring River team scope.
      }
    }
    return [...teamScopeUserIds];
  }

  private getCachedTeamScopeUserId(): string | null {
    const teamScopeUserIds = this.getCachedTeamScopeUserIds();
    return teamScopeUserIds.length === 1 ? teamScopeUserIds[0] ?? null : null;
  }

  private async getReadableTeamScopeUserId(): Promise<string | null> {
    const teamState = await this.getActiveTeamState();
    return teamState?.currentTeamScopeUserId ?? this.getCachedTeamScopeUserId();
  }

  private async getWritableTeamScopeUserId(): Promise<string | null> {
    const teamState = await this.sharedTeamService.getTeamState();
    if (teamState.available && teamState.currentTeamScopeUserId) {
      return canWriteTeamDocuments(teamState) ? teamState.currentTeamScopeUserId : null;
    }
    return null;
  }

  async getDestinations(query = ''): Promise<SharedFileDestination[]> {
    const targets = await this.riverTargetService.listTargets(query);
    const destinations = targets
      .filter((target) => target.kind !== 'public')
      .map((target): SharedFileDestination => ({
        id: target.kind === 'person' ? `contact:${target.targetId}` : `team:${target.targetId}`,
        kind: target.kind === 'person' ? 'contact' : 'team',
        label: target.label,
        detail: target.detail,
        status: target.status === 'accepted' ? 'accepted' : 'pending',
        recipientUserIds: target.committable ? target.recipientUserIds : [],
        memberCount: target.memberCount,
        isDefault: target.isDefault,
      }));
    if (!destinations.some((destination) => destination.isDefault)) {
      const firstAccepted = destinations.find((destination) => destination.status === 'accepted');
      if (firstAccepted) firstAccepted.isDefault = true;
    }
    return destinations;
  }

  async getRiverTargets(query = ''): Promise<RiverTarget[]> {
    return this.riverTargetService.listTargets(query);
  }

  async setRiverDefaultDestinations(destinations: RiverDefaultDestination[]): Promise<RiverMutationResult> {
    return this.riverTargetService.setDefaultDestinations(destinations);
  }

  async getRiverSourcePreferences(): Promise<RiverSourcePreference[]> {
    return this.riverTargetService.getSourcePreferences();
  }

  async updateRiverSourcePreferences(preferences: RiverSourcePreference[]): Promise<RiverMutationResult> {
    return this.riverTargetService.updateSourcePreferences(preferences);
  }

  private async resolveShareRecipients(targets: SharedFileShareTarget[] | undefined): Promise<{ recipients: string[]; error?: string }> {
    const destinations = await this.getDestinations();
    const accepted = destinations.filter((destination) => destination.status === 'accepted');
    const defaultDestination = accepted.find((destination) => destination.isDefault);
    const selectedTargets = targets?.length
      ? targets
      : defaultDestination
        ? [defaultDestination]
        : accepted.slice(0, 1);
    if (!selectedTargets.length) return this.resolveLegacyTeamRecipients();

    const byId = new Map(accepted.map((destination) => [destination.id, destination]));
    const recipientIds = new Set<string>();
    for (const target of selectedTargets) {
      const destination = byId.get(target.id);
      if (!destination || destination.kind !== target.kind) {
        return { recipients: [], error: 'Choose an approved River destination' };
      }
      for (const recipientUserId of destination.recipientUserIds) recipientIds.add(recipientUserId);
    }
    if (recipientIds.size > 0) return { recipients: [...recipientIds] };
    return this.resolveLegacyTeamRecipients();
  }

  private async resolveLegacyTeamRecipients(): Promise<{ recipients: string[]; error?: string }> {
    const teamState = await this.sharedTeamService.getTeamState();
    const recipientIds = new Set<string>();
    if (teamState.available && !canWriteTeamDocuments(teamState)) {
      return { recipients: [], error: 'Accept the team invite before sharing to River' };
    }
    if (teamState.available && canWriteTeamDocuments(teamState)) {
      for (const member of teamState.members) {
        if (member.userId) recipientIds.add(member.userId);
      }
      if (teamState.currentTeamScopeUserId && teamState.currentTeamScopeUserId !== this.authManager.getSession()?.user?.id) {
        recipientIds.add(teamState.currentTeamScopeUserId);
      }
    }
    return recipientIds.size > 0
      ? { recipients: [...recipientIds] }
      : { recipients: [], error: 'Add an approved contact before sharing to River' };
  }

  async getShareStatus(filePath: string): Promise<SharedFileStatus> {
    if (isInsidePath(sharedFilesRoot(), path.resolve(filePath)) && fs.existsSync(filePath)) {
      try {
        const parsed = parseSharedFileFrontmatter(fs.readFileSync(filePath, 'utf-8'));
        if (parsed?.sharedId) {
          return {
            shared: true,
            sharedId: parsed.sharedId,
            revision: parsed.revision ?? 0,
            cachePath: filePath,
          };
        }
      } catch {
        return { shared: false };
      }
    }

    const supabase = this.authManager.getSupabaseClient();
    const session = this.authManager.getSession();
    if (!supabase || !session?.user?.id) return { shared: false };
    const { data, error } = await supabase
      .from('river_documents')
      .select('id, revision, path, shared_name, author_initials, content, kind, created_by, original_source_path, title')
      .eq('created_by', session.user.id)
      .eq('original_source_path', sourceKeyForFilePath(filePath))
      .is('deleted_at', null)
      .maybeSingle();

    if (error || !data) return this.getLegacyShareStatus(filePath);
    const row = data as RiverDocumentRow;
    return {
      shared: true,
      sharedId: row.id,
      revision: row.revision ?? 0,
      cachePath: this.cachePathForRow(row),
    };
  }

  private async getLegacyShareStatus(filePath: string): Promise<SharedFileStatus> {
    const supabase = this.authManager.getSupabaseClient();
    const session = this.authManager.getSession();
    if (!supabase || !session?.user?.id) return { shared: false };
    const teamState = await this.getActiveTeamState();
    if (!teamState) return { shared: false };

    const { data, error } = await supabase
      .from('team_documents')
      .select('id, revision, path, shared_name, author_initials, content, kind, team_scope_user_id, created_by, original_source_path, title')
      .eq('team_scope_user_id', teamState.currentTeamScopeUserId)
      .eq('created_by', session.user.id)
      .eq('original_source_path', sourceKeyForFilePath(filePath))
      .is('deleted_at', null)
      .maybeSingle();

    if (error || !data) return { shared: false };
    const row = data as TeamDocumentRow;
    return {
      shared: true,
      sharedId: row.id,
      revision: row.revision ?? 0,
      cachePath: this.cachePathForRow(row),
    };
  }

  async getPinnedSidebarItemIds(): Promise<string[]> {
    const supabase = this.authManager.getSupabaseClient();
    const session = this.authManager.getSession();
    if (!supabase || !session?.user?.id) return [];

    const { data, error } = await supabase
      .from('river_document_pins')
      .select('document_id')
      .eq('user_id', session.user.id);

    if (error) {
      log.warn('River pinned items lookup failed:', error);
      return [];
    }

    const pinnedIds = new Set(
      ((data ?? []) as Array<{ document_id?: unknown }>)
        .map((row) => typeof row.document_id === 'string' ? row.document_id : null)
        .filter((id): id is string => Boolean(id)),
    );
    if (pinnedIds.size === 0) return [];

    const sidebarIds: string[] = [];
    const root = sharedFilesRoot();
    if (!fs.existsSync(root)) return [];
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isFile() || !isMarkdownFileName(entry.name)) continue;
      const filePath = path.join(root, entry.name);
      try {
        const parsed = parseSharedFileFrontmatter(fs.readFileSync(filePath, 'utf-8'));
        if (parsed?.sharedId && pinnedIds.has(parsed.sharedId)) {
          sidebarIds.push(sidebarItemIdForSharedCacheFile(filePath));
        }
      } catch {
        // Ignore unreadable cache files while building the shared pin set.
      }
    }
    return sidebarIds;
  }

  async setPinned(filePath: string, pinned: boolean): Promise<SharedFilePinResult> {
    const supabase = this.authManager.getSupabaseClient();
    const session = this.authManager.getSession();
    if (!supabase || !session?.user?.id) return { ok: false, reason: 'not_authenticated' };

    const resolvedPath = path.resolve(filePath);
    if (!isInsidePath(sharedFilesRoot(), resolvedPath) || !fs.existsSync(resolvedPath)) {
      return { ok: false, reason: 'not_shared' };
    }

    let sharedId: string | null = null;
    try {
      sharedId = parseSharedFileFrontmatter(fs.readFileSync(resolvedPath, 'utf-8'))?.sharedId ?? null;
    } catch {
      return { ok: false, reason: 'not_shared' };
    }
    if (!sharedId) return { ok: false, reason: 'not_shared' };

    if (pinned) {
      const { error } = await supabase
        .from('river_document_pins')
        .upsert({
          user_id: session.user.id,
          document_id: sharedId,
          pinned_by: session.user.id,
        }, { onConflict: 'user_id,document_id' });
      if (error) return { ok: false, reason: 'request_failed', error: error.message };
    } else {
      const { error } = await supabase
        .from('river_document_pins')
        .delete()
        .eq('user_id', session.user.id)
        .eq('document_id', sharedId);
      if (error) return { ok: false, reason: 'request_failed', error: error.message };
    }

    this.emit('pinsChanged');
    return { ok: true, pinned };
  }

  async shareFile(input: SharedFileShareInput): Promise<SharedFileStatus> {
    const supabase = this.authManager.getSupabaseClient();
    const session = this.authManager.getSession();
    if (!supabase || !session?.user?.id) return { shared: false };
    const resolvedTargets = input.targets?.length
      ? await this.riverTargetService.resolveShareTargets(input.targets)
      : null;
    if (resolvedTargets?.error) {
      return { shared: false, error: resolvedTargets.error };
    }
    const resolved = resolvedTargets
      ? { recipients: resolvedTargets.recipients, error: resolvedTargets.error }
      : await this.resolveShareRecipients(input.destinations);
    if (resolved.error || (resolvedTargets ? resolvedTargets.targets.length === 0 : resolved.recipients.length === 0)) {
      return { shared: false, error: resolved.error ?? 'Choose an approved River destination' };
    }

    const type = input.type ?? inferSharedFileType({ filePath: input.filePath, content: input.content });
    const sourceKey = sourceKeyForFilePath(input.filePath);
    const content = contentForSharedTransport(input.filePath, input.content);
    const now = Date.now();
    const title = input.title || safeTitleFromPath(input.filePath);
    const authorInitials = authorInitialsFromSession(session);
    const authorCallsign = await authorCallsignForSession(supabase, session);

    const row = {
      kind: sharedKindForType(type),
      path: sharedPathForInput({ ...input, type }),
      title,
      content,
      content_hash: sha256(content),
      client_id: `shared-${sha256(`${session.user.id}:${sourceKey}`).slice(0, 32)}`,
      client_created_at_ms: now,
      created_by: session.user.id,
      updated_by: session.user.id,
      deleted_at: null,
      original_source_path: sourceKey,
      shared_name: title,
      author_initials: authorInitials,
      author_callsign: authorCallsign,
      revision: 1,
    };

    const { data, error } = await supabase
      .from('river_documents')
      .upsert(row, { onConflict: 'created_by,client_id' })
      .select('id, kind, path, title, content_hash, client_id, client_created_at_ms, created_by, updated_by, deleted_at, created_at, updated_at, original_source_path, shared_name, author_initials, author_callsign, revision')
      .single();

    if (error || !data) {
      log.error('Share file failed:', error);
      return { shared: false, error: error?.message ?? 'Share file failed' };
    }

    const savedRow = { ...row, ...(data as Omit<RiverDocumentRow, 'content'>), content } as RiverDocumentRow;
    if (resolvedTargets) {
      const targetResult = await this.writeTargetAudience(savedRow.id, resolvedTargets);
      if (!targetResult.ok) return { shared: false, error: targetResult.error };
    } else {
      const audienceRows = resolved.recipients.map((recipientUserId) => ({
        document_id: savedRow.id,
        recipient_user_id: recipientUserId,
        granted_by_user_id: session.user.id,
        source_type: 'direct',
        source_id: 'direct',
        revoked_at: null,
      }));
      const { error: audienceError } = await supabase
        .from('river_document_audience')
        .upsert(audienceRows, { onConflict: 'document_id,recipient_user_id,source_type,source_id' });
      if (audienceError) {
        log.error('River audience grant failed:', audienceError);
        return { shared: false, error: audienceError.message ?? 'River audience grant failed' };
      }
    }
    const cachePath = this.writeRowToCache(savedRow);
    return { shared: true, sharedId: savedRow.id, revision: savedRow.revision ?? 1, cachePath };
  }

  private async writeTargetAudience(documentId: string, resolved: RiverResolvedAudience): Promise<RiverMutationResult> {
    const supabase = this.authManager.getSupabaseClient();
    const session = this.authManager.getSession();
    if (!supabase || !session?.user?.id) return { ok: false, error: 'Not authenticated' };

    const targetRows = resolved.targets.map((target) => ({
      document_id: documentId,
      target_kind: target.kind,
      target_id: target.targetId,
      created_by: session.user.id,
      revoked_at: null,
    }));
    const { data: savedTargets, error: targetError } = await supabase
      .from('river_document_targets')
      .upsert(targetRows, { onConflict: 'document_id,target_kind,target_id' })
      .select('id, target_kind, target_id');
    if (targetError) {
      log.error('River target write failed:', targetError);
      return { ok: false, error: targetError.message ?? 'River target write failed' };
    }

    const savedTargetIds = new Map(
      ((savedTargets ?? []) as Array<{ id: string; target_kind: string; target_id: string }>)
        .map((row) => [`${row.target_kind}:${row.target_id}`, row.id]),
    );
    const audienceRows = resolved.targets.flatMap((target) => {
      if (target.kind === 'public') return [];
      const savedTargetId = savedTargetIds.get(`${target.kind}:${target.targetId}`);
      if (!savedTargetId) return [];
      return target.recipientUserIds.map((recipientUserId) => ({
        document_id: documentId,
        recipient_user_id: recipientUserId,
        granted_by_user_id: session.user.id,
        source_type: target.kind,
        source_id: savedTargetId,
        revoked_at: null,
      }));
    });
    if (!audienceRows.length) return { ok: true };

    const { error: audienceError } = await supabase
      .from('river_document_audience')
      .upsert(audienceRows, { onConflict: 'document_id,recipient_user_id,source_type,source_id' });
    if (audienceError) {
      log.error('River audience grant failed:', audienceError);
      return { ok: false, error: audienceError.message ?? 'River audience grant failed' };
    }
    return { ok: true };
  }

  async getAudienceStatus(filePath: string): Promise<SharedFileAudienceStatus> {
    const status = await this.getShareStatus(filePath);
    if (!status.shared || !status.sharedId) return { shared: false, targets: [] };

    const supabase = this.authManager.getSupabaseClient();
    if (!supabase) return { shared: true, sharedId: status.sharedId, targets: [] };

    const { data, error } = await supabase
      .from('river_document_targets')
      .select('target_kind, target_id')
      .eq('document_id', status.sharedId)
      .is('revoked_at', null);
    if (error) return { shared: true, sharedId: status.sharedId, targets: [], error: error.message };

    const selectedKeys = new Set(((data ?? []) as Array<{ target_kind?: unknown; target_id?: unknown }>)
      .map((row) => `${String(row.target_kind)}:${String(row.target_id)}`));
    const targets = (await this.riverTargetService.listTargets())
      .filter((target) => selectedKeys.has(`${target.kind}:${target.targetId}`));
    return { shared: true, sharedId: status.sharedId, targets };
  }

  async updateAudience(input: SharedFileAudienceUpdateInput): Promise<SharedFileAudienceStatus> {
    const supabase = this.authManager.getSupabaseClient();
    const session = this.authManager.getSession();
    if (!supabase || !session?.user?.id) return { shared: false, targets: [], error: 'Not authenticated' };

    const sharedId = input.sharedId
      ?? (input.filePath ? (await this.getShareStatus(input.filePath)).sharedId : null);
    if (!sharedId) return { shared: false, targets: [], error: 'Shared file not found' };

    const resolved = await this.riverTargetService.resolveShareTargets(input.targets);
    if (resolved.error) return { shared: true, sharedId, targets: [], error: resolved.error };

    const targetResult = await this.writeTargetAudience(sharedId, resolved);
    if (!targetResult.ok) return { shared: true, sharedId, targets: [], error: targetResult.error };

    const selectedTargetIds = new Set(resolved.targets.map((target) => `${target.kind}:${target.targetId}`));
    const allRows = await supabase
      .from('river_document_targets')
      .select('id, target_kind, target_id')
      .eq('document_id', sharedId);
    if (!allRows.error) {
      for (const row of (allRows.data ?? []) as Array<{ id: string; target_kind: string; target_id: string }>) {
        if (selectedTargetIds.has(`${row.target_kind}:${row.target_id}`)) continue;
        await supabase
          .from('river_document_targets')
          .update({ revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq('id', row.id);
        await supabase
          .from('river_document_audience')
          .update({ revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq('document_id', sharedId)
          .eq('source_id', row.id);
      }
    }

    if (input.filePath) return this.getAudienceStatus(input.filePath);
    return { shared: true, sharedId, targets: resolved.targets };
  }

  async unshareFile(filePath: string): Promise<boolean> {
    const supabase = this.authManager.getSupabaseClient();
    const session = this.authManager.getSession();
    if (!supabase || !session?.user?.id) return false;

    const sharedId = this.sharedIdForCacheFile(filePath);
    const originalSourcePath = sharedId ? this.originalSourcePathForCacheFile(filePath) : sourceKeyForFilePath(filePath);
    const sharedIdsToUnpin = sharedId
      ? [sharedId]
      : this.sharedIdsForCacheReference({ originalSourcePath });
    let query = supabase
      .from('river_documents')
      .update({ deleted_at: new Date().toISOString(), updated_by: session.user.id })
      .eq('created_by', session.user.id);
    query = sharedId
      ? query.eq('id', sharedId)
      : query.eq('original_source_path', sourceKeyForFilePath(filePath));

    const { error } = await query.is('deleted_at', null);

    if (error) {
      log.error('Unshare file failed:', error);
      return false;
    }
    await this.removePinRowsForSharedIds(sharedIdsToUnpin);
    this.removeCacheFilesForSharedReference({ sharedId, originalSourcePath });
    return true;
  }

  async syncOnce(): Promise<{ written: number; removed: number; created: number; errors: string[] }> {
    const supabase = this.authManager.getSupabaseClient();
    const session = this.authManager.getSession();
    const result = { written: 0, removed: 0, created: 0, errors: [] as string[] };
    if (!supabase || !session?.user?.id) return result;
    const root = sharedFilesRoot();
    const createdRoot = !fs.existsSync(root);
    ensureDir(root);
    if (createdRoot) result.created = 1;

    let data: unknown[] | null = null;
    try {
      const response = await supabase
        .from('river_documents')
        .select('*')
        .is('deleted_at', null);
      data = response.data;
      if (response.error) return this.syncLegacyOnce(result);
    } catch {
      return this.syncLegacyOnce(result);
    }

    const activeIds = new Set<string>();
    let currentUserCallsign: Promise<string | null> | null = null;
    for (const row of (data ?? []) as RiverDocumentRow[]) {
      try {
        let cacheRow = row;
        if (!row.author_callsign && row.created_by === session.user.id) {
          currentUserCallsign ??= authorCallsignForSession(supabase, session);
          const callsign = await currentUserCallsign;
          if (callsign) cacheRow = { ...row, author_callsign: callsign };
        }
        this.writeRowToCache(cacheRow);
        activeIds.add(row.id);
        result.written++;
      } catch (err) {
        result.errors.push(err instanceof Error ? err.message : String(err));
      }
    }
    result.removed = this.removeStaleCacheFiles(activeIds);
    return result;
  }

  async updateSharedContent(sharedId: string, content: string, expectedRevision: number, documentPath?: string | null): Promise<SharedFileUpdateResult> {
    const supabase = this.authManager.getSupabaseClient();
    const session = this.authManager.getSession();
    if (!supabase || !session?.user?.id) return { ok: false, error: 'Not authenticated' };

    const { data: current, error: fetchError } = await supabase
      .from('river_documents')
      .select('*')
      .eq('id', sharedId)
      .is('deleted_at', null)
      .single();

    if (fetchError || !current) return { ok: false, error: fetchError?.message ?? 'Shared file not found' };
    const currentRow = current as RiverDocumentRow;
    const remoteRevision = currentRow.revision ?? 0;
    const cleanContent = documentPath
      ? contentForSharedTransport(documentPath, content)
      : stripSharedFileFrontmatter(content);
    const cleanRemoteContent = stripSharedFileFrontmatter(currentRow.content);

    if (remoteRevision > expectedRevision && cleanContent !== cleanRemoteContent) {
      const conflictPath = this.writePrivateConflictCopy(currentRow, cleanContent);
      const cachePath = this.writeRowToCache(currentRow);
      return {
        ok: false,
        revision: remoteRevision,
        cachePath,
        conflictPath,
        remoteContent: currentRow.content,
        error: 'Remote revision changed before this edit synced',
      };
    }

    const nextRevision = remoteRevision + 1;
    const { data, error } = await supabase
      .from('river_documents')
      .update({
        content: cleanContent,
        content_hash: sha256(cleanContent),
        revision: nextRevision,
        updated_by: session.user.id,
      })
      .eq('id', sharedId)
      .eq('revision', remoteRevision)
      .is('deleted_at', null)
      .select('*')
      .single();

    if (error || !data) return { ok: false, error: error?.message ?? 'Shared update failed' };
    const cachePath = this.writeRowToCache(data as RiverDocumentRow);
    return { ok: true, revision: nextRevision, cachePath };
  }

  private async syncLegacyOnce(result: { written: number; removed: number; created: number; errors: string[] }): Promise<{ written: number; removed: number; created: number; errors: string[] }> {
    const supabase = this.authManager.getSupabaseClient();
    const session = this.authManager.getSession();
    if (!supabase || !session?.user?.id) return result;
    const teamScopeUserId = await this.getReadableTeamScopeUserId();
    if (!teamScopeUserId) return result;

    const { data, error } = await supabase
      .from('team_documents')
      .select('*')
      .eq('team_scope_user_id', teamScopeUserId)
      .is('deleted_at', null);

    if (error) {
      result.errors.push(error.message);
      return result;
    }

    const activeIds = new Set<string>();
    for (const row of (data ?? []) as TeamDocumentRow[]) {
      try {
        this.writeRowToCache(row);
        activeIds.add(row.id);
        result.written++;
      } catch (err) {
        result.errors.push(err instanceof Error ? err.message : String(err));
      }
    }
    result.removed = this.removeStaleCacheFiles(activeIds);
    return result;
  }

  cachePathForRow(row: Pick<RiverDocumentLike, 'id' | 'title' | 'shared_name' | 'author_initials'>): string {
    const root = sharedFilesRoot();
    const existingPath = this.existingCachePathForRow(row.id);
    if (existingPath) return existingPath;

    const existing = fs.existsSync(root) ? fs.readdirSync(root) : [];
    const existingForOtherRows = existing.filter((fileName) => {
      const fullPath = path.join(root, fileName);
      if (!fs.statSync(fullPath).isFile()) return true;
      try {
        const parsed = parseSharedFileFrontmatter(fs.readFileSync(fullPath, 'utf-8'));
        return parsed?.sharedId !== row.id;
      } catch {
        return true;
      }
    });
    const fileName = buildSharedCacheFileName({
      title: row.shared_name || row.title,
      authorInitials: row.author_initials ?? undefined,
      existingFileNames: existingForOtherRows,
    });
    return path.join(root, fileName);
  }

  private sharedIdForCacheFile(filePath: string): string | null {
    const resolvedPath = path.resolve(filePath);
    if (!isInsidePath(sharedFilesRoot(), resolvedPath) || !fs.existsSync(resolvedPath)) return null;
    try {
      return parseSharedFileFrontmatter(fs.readFileSync(resolvedPath, 'utf-8'))?.sharedId ?? null;
    } catch {
      return null;
    }
  }

  private originalSourcePathForCacheFile(filePath: string): string | null {
    const resolvedPath = path.resolve(filePath);
    if (!isInsidePath(sharedFilesRoot(), resolvedPath) || !fs.existsSync(resolvedPath)) return null;
    try {
      return parseSharedFileFrontmatter(fs.readFileSync(resolvedPath, 'utf-8'))?.originalSourcePath ?? null;
    } catch {
      return null;
    }
  }

  private sharedIdsForCacheReference({ originalSourcePath }: { originalSourcePath?: string | null }): string[] {
    if (!originalSourcePath) return [];
    const root = sharedFilesRoot();
    if (!fs.existsSync(root)) return [];
    const sharedIds: string[] = [];
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isFile() || !isMarkdownFileName(entry.name)) continue;
      const filePath = path.join(root, entry.name);
      try {
        const parsed = parseSharedFileFrontmatter(fs.readFileSync(filePath, 'utf-8'));
        if (parsed?.sharedId && parsed.originalSourcePath === originalSourcePath) {
          sharedIds.push(parsed.sharedId);
        }
      } catch {
        // Ignore unreadable cache files while finding stale shared pins.
      }
    }
    return sharedIds;
  }

  private async removePinRowsForSharedIds(sharedIds: string[]): Promise<void> {
    const supabase = this.authManager.getSupabaseClient();
    if (!supabase || sharedIds.length === 0) return;
    for (const sharedId of sharedIds) {
      try {
        let removed = false;
        try {
          const { error } = await supabase
            .from('river_document_pins')
            .delete()
            .eq('document_id', sharedId);
          removed = !error;
        } catch {
          removed = false;
        }
        if (!removed) {
          const { error } = await supabase
            .from('team_document_pins')
            .delete()
            .eq('document_id', sharedId);
          if (error) log.warn('River pin cleanup failed:', error);
        }
      } catch (err) {
        log.warn('River pin cleanup failed:', err);
      }
    }
    this.emit('pinsChanged');
  }

  private removeCacheFilesForSharedReference({
    sharedId,
    originalSourcePath,
  }: {
    sharedId?: string | null;
    originalSourcePath?: string | null;
  }): number {
    const root = sharedFilesRoot();
    if (!fs.existsSync(root)) return 0;
    let removed = 0;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isFile() || !isMarkdownFileName(entry.name)) continue;
      const filePath = path.join(root, entry.name);
      try {
        const parsed = parseSharedFileFrontmatter(fs.readFileSync(filePath, 'utf-8'));
        if (
          (sharedId && parsed?.sharedId === sharedId)
          || (originalSourcePath && parsed?.originalSourcePath === originalSourcePath)
        ) {
          fs.rmSync(filePath, { force: true });
          removed++;
        }
      } catch {
        // Ignore unreadable cache files while removing a known share.
      }
    }
    return removed;
  }

  private existingCachePathForRow(sharedId: string): string | null {
    const root = sharedFilesRoot();
    if (!fs.existsSync(root)) return null;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isFile() || !isMarkdownFileName(entry.name)) continue;
      const filePath = path.join(root, entry.name);
      try {
        if (parseSharedFileFrontmatter(fs.readFileSync(filePath, 'utf-8'))?.sharedId === sharedId) {
          return filePath;
        }
      } catch {
        // Ignore unreadable cache files while choosing a path.
      }
    }
    return null;
  }

  private writeRowToCache(row: RiverDocumentLike): string {
    const root = sharedFilesRoot();
    ensureDir(root);
    const cachePath = this.cachePathForRow(row);
    const type: SharedFileType = row.kind === 'command' ? 'command' : row.path.startsWith('Plans/') ? 'plan' : 'document';
    const portableContent = makeMarkdownImagesPortable(
      path.join(sharedFilesRoot(), `${sharedRowTitle(row)}.md`),
      stripSharedFileFrontmatter(row.content),
      { libraryRoots: [libraryDir()] },
    ).content;
    const content = applySharedFileFrontmatter(portableContent, {
      sharedId: row.id,
      title: sharedRowTitle(row),
      teamId: 'team_scope_user_id' in row ? row.team_scope_user_id : undefined,
      teamName: 'team_scope_user_id' in row ? 'Field Theory Team' : 'River',
      authorId: row.created_by,
      authorInitials: row.author_initials ?? undefined,
      authorCallsign: row.author_callsign ?? undefined,
      type,
      originalSourcePath: row.original_source_path ?? undefined,
      revision: row.revision ?? 0,
      updatedAt: row.updated_at,
    });
    fs.writeFileSync(cachePath, content, 'utf-8');
    return cachePath;
  }

  private writePrivateConflictCopy(row: RiverDocumentLike, content: string): string {
    const conflictDir = path.join(libraryDir(), 'Conflicts');
    ensureDir(conflictDir);
    const fileName = buildSharedConflictFileName({
      fileName: `${sharedRowTitle(row)}.md`,
      authorInitials: row.author_initials ?? undefined,
      date: new Date(),
    });
    const conflictPath = path.join(conflictDir, fileName);
    fs.writeFileSync(conflictPath, stripSharedFileFrontmatter(content), 'utf-8');
    return conflictPath;
  }

  private removeStaleCacheFiles(activeIds: Set<string> = EMPTY_ACTIVE_SET): number {
    const root = sharedFilesRoot();
    if (!fs.existsSync(root)) return 0;
    let removed = 0;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isFile() || !isMarkdownFileName(entry.name)) continue;
      const filePath = path.join(root, entry.name);
      try {
        const parsed = parseSharedFileFrontmatter(fs.readFileSync(filePath, 'utf-8'));
        if (parsed?.sharedId && !activeIds.has(parsed.sharedId)) {
          fs.rmSync(filePath, { force: true });
          removed++;
        }
      } catch {
        // Leave unreadable files alone.
      }
    }
    return removed;
  }
}
