import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AuthManager } from './authManager';
import { createLogger } from './logger';

const log = createLogger('SharedTeamEntitlement');

export type SharedTeamEntitlementReason =
  | 'not_authenticated'
  | 'not_entitled'
  | 'lookup_failed';

export interface SharedTeamEntitlementState {
  allowed: boolean;
  publicAllowed?: boolean;
  reason?: SharedTeamEntitlementReason;
  stale: boolean;
  userId: string | null;
  checkedAt: string | null;
}

interface SharedTeamEntitlementCache {
  userId: string;
  allowed: true;
  publicAllowed: boolean;
  checkedAt: string;
}

interface SharedTeamEntitlementServiceOptions {
  cachePath?: string;
}

function defaultCachePath(): string {
  const home = os.homedir() || process.cwd();
  return process.env.FT_SHARED_TEAM_ENTITLEMENT_CACHE_PATH
    || path.join(home, '.fieldtheory', 'shared-team-entitlement-cache.json');
}

function notAuthenticated(): SharedTeamEntitlementState {
  return {
    allowed: false,
    publicAllowed: false,
    reason: 'not_authenticated',
    stale: false,
    userId: null,
    checkedAt: null,
  };
}

function notEntitled(userId: string | null): SharedTeamEntitlementState {
  return {
    allowed: false,
    publicAllowed: false,
    reason: 'not_entitled',
    stale: false,
    userId,
    checkedAt: new Date().toISOString(),
  };
}

function lookupFailed(userId: string | null): SharedTeamEntitlementState {
  return {
    allowed: false,
    publicAllowed: false,
    reason: 'lookup_failed',
    stale: false,
    userId,
    checkedAt: new Date().toISOString(),
  };
}

function allowedState(userId: string, checkedAt: string, stale: boolean, publicAllowed: boolean): SharedTeamEntitlementState {
  return {
    allowed: true,
    publicAllowed,
    stale,
    userId,
    checkedAt,
  };
}

function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error && 'message' in error) {
    return String((error as { message?: unknown }).message ?? '');
  }
  return String(error ?? '');
}

function errorCode(error: unknown): string {
  if (typeof error === 'object' && error && 'code' in error) {
    return String((error as { code?: unknown }).code ?? '');
  }
  return '';
}

function isOfflineError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();
  return message.includes('network')
    || message.includes('offline')
    || message.includes('fetch failed')
    || message.includes('failed to fetch')
    || message.includes('timeout')
    || message.includes('timed out')
    || message.includes('econnreset')
    || message.includes('enotfound')
    || message.includes('eai_again');
}

function isContractDeniedError(error: unknown): boolean {
  const code = errorCode(error);
  const message = errorMessage(error).toLowerCase();
  return code === '42501'
    || code === '42P01'
    || code === '42703'
    || message.includes('permission denied')
    || message.includes('row-level security')
    || message.includes('does not exist')
    || message.includes('schema cache');
}

export class SharedTeamEntitlementService {
  private readonly cachePath: string;
  private generation = 0;
  private cachedState: SharedTeamEntitlementState | null = null;

  constructor(
    private readonly authManager: AuthManager,
    options: SharedTeamEntitlementServiceOptions = {},
  ) {
    this.cachePath = options.cachePath ?? defaultCachePath();
  }

  getCachedState(): SharedTeamEntitlementState {
    const userId = this.authManager.getSession()?.user?.id ?? null;
    if (!userId) return notAuthenticated();
    if (this.cachedState?.userId === userId) return this.cachedState;
    return lookupFailed(userId);
  }

  async getState(): Promise<SharedTeamEntitlementState> {
    const supabase = this.authManager.getSupabaseClient();
    const session = this.authManager.getSession();
    const userId = session?.user?.id ?? null;

    if (!supabase || !userId) {
      this.cachedState = notAuthenticated();
      return this.cachedState;
    }

    const generation = ++this.generation;
    const current = () => generation === this.generation
      && this.authManager.getSession()?.user.id === userId
      && this.authManager.getSession()?.access_token === session?.access_token;
    const results = await Promise.allSettled([
      Promise.resolve().then(() => supabase.from('shared_team_beta_users').select('enabled').eq('user_id', userId).maybeSingle()),
      Promise.resolve().then(() => supabase.rpc('river_team_access')),
    ]);
    if (!current()) return this.getCachedState();
    const beta = results[0].status === 'fulfilled' ? results[0].value : { data: null, error: results[0].reason };
    const team = results[1].status === 'fulfilled' ? results[1].value : { data: null, error: results[1].reason };
    const publicAllowed = !beta.error && beta.data?.enabled === true;
    if (publicAllowed || (!team.error && team.data === true)) {
      const checkedAt = new Date().toISOString();
      this.writeAllowedCache({ userId, allowed: true, publicAllowed, checkedAt });
      this.cachedState = allowedState(userId, checkedAt, false, publicAllowed);
      return this.cachedState;
    }
    const errors = [beta.error, team.error].filter(Boolean);
    if (errors.length) {
      const error = errors.find(isContractDeniedError) ?? errors[0];
      let state = this.handleLookupError(userId, error);
      // Persist an online beta denial so a later offline lookup cannot revive it.
      if (!beta.error && state.publicAllowed) {
        state = { ...state, publicAllowed: false };
        if (state.checkedAt) this.writeAllowedCache({ userId, allowed: true, publicAllowed: false, checkedAt: state.checkedAt });
      }
      // A verified membership removal also overrides a membership-only offline grant.
      if (state.allowed && !team.error && team.data !== true && !state.publicAllowed) {
        this.clearAllowedCache(userId);
        state = notEntitled(userId);
      }
      this.cachedState = state;
      return state;
    }
    this.clearAllowedCache(userId);
    this.cachedState = notEntitled(userId);
    return this.cachedState;
  }

  clear(): void {
    this.generation++;
    this.cachedState = null;
  }

  private handleLookupError(userId: string, error: unknown): SharedTeamEntitlementState {
    if (isOfflineError(error)) {
      const cached = this.readAllowedCache(userId);
      if (cached) {
        this.cachedState = allowedState(userId, cached.checkedAt, true, cached.publicAllowed);
        return this.cachedState;
      }
      this.cachedState = lookupFailed(userId);
      return this.cachedState;
    }

    if (isContractDeniedError(error)) {
      this.clearAllowedCache(userId);
      this.cachedState = notEntitled(userId);
      return this.cachedState;
    }

    log.warn('Shared team entitlement lookup failed:', error);
    this.cachedState = lookupFailed(userId);
    return this.cachedState;
  }

  private readAllowedCache(userId: string): SharedTeamEntitlementCache | null {
    try {
      if (!fs.existsSync(this.cachePath)) return null;
      const parsed = JSON.parse(fs.readFileSync(this.cachePath, 'utf-8')) as Partial<SharedTeamEntitlementCache>;
      if (parsed.userId === userId && parsed.allowed === true && typeof parsed.checkedAt === 'string') {
        return { userId, allowed: true, publicAllowed: parsed.publicAllowed === true, checkedAt: parsed.checkedAt };
      }
    } catch (error) {
      log.warn('Failed to read shared team entitlement cache:', error);
    }
    return null;
  }

  private writeAllowedCache(cache: SharedTeamEntitlementCache): void {
    try {
      fs.mkdirSync(path.dirname(this.cachePath), { recursive: true });
      const tempPath = `${this.cachePath}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(cache));
      fs.chmodSync(tempPath, 0o600);
      fs.renameSync(tempPath, this.cachePath);
    } catch (error) {
      log.warn('Failed to write shared team entitlement cache:', error);
    }
  }

  private clearAllowedCache(userId: string): void {
    try {
      const cached = this.readAllowedCache(userId);
      if (cached) fs.rmSync(this.cachePath, { force: true });
    } catch (error) {
      log.warn('Failed to clear shared team entitlement cache:', error);
    }
  }
}
