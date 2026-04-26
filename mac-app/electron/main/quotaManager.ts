import { EventEmitter } from 'events';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from './logger';

const log = createLogger('Quota');

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') {
      return message;
    }
  }

  return String(error);
}

function isNetworkError(error: unknown): boolean {
  const cause = error && typeof error === 'object' && 'cause' in error
    ? (error as { cause?: unknown }).cause
    : null;
  const details = error && typeof error === 'object' && 'details' in error
    ? (error as { details?: unknown }).details
    : null;
  const code = error && typeof error === 'object' && 'code' in error
    ? (error as { code?: unknown }).code
    : null;
  const text = [
    getErrorMessage(error),
    details,
    code,
    cause ? getErrorMessage(cause) : '',
  ].join(' ').toLowerCase();

  return text.includes('fetch failed') ||
    text.includes('network') ||
    text.includes('timeout') ||
    text.includes('connecttimeouterror') ||
    text.includes('und_err_connect_timeout') ||
    text.includes('econnrefused') ||
    text.includes('etimedout') ||
    text.includes('enotfound') ||
    text.includes('enetunreach');
}

// =============================================================================
// QuotaManager - Server-backed usage tracking.
// Server (user_usage table) is the single source of truth.
// Local cache is for display and offline support.
// =============================================================================

// Feature names matching database columns.
export type QuotaFeature =
  | 'text_improve_words'
  | 'priority_mic_seconds'
  | 'auto_stack_sessions'
  | 'portable_commands';

// Trial lifecycle state — server-computed from is_paid_subscriber + trial_started_at.
// 'pro'     = paid subscriber (Stripe). Permanent.
// 'trial'   = inside the 14-day active window of the current 30-day cycle.
// 'expired' = inside the 16-day expired window. Reverts to 'trial' at the next cycle boundary.
export type TrialState = 'pro' | 'trial' | 'expired';

// Usage data synced from server.
interface ServerUsage {
  tier: 'free' | 'pro';
  state: TrialState;
  trialEndsAt: string | null;
  nextTrialResetAt: string | null;
  monthYear: string;
  usage: Record<QuotaFeature, number>;
  limits: Record<QuotaFeature, number>;
}

// Quota status for a single feature.
export interface QuotaStatus {
  used: number;
  limit: number;
  remaining: number;
  allowed: boolean;
  percentUsed: number;
}

// Background sync interval (30 minutes).
const SYNC_INTERVAL_MS = 30 * 60 * 1000;

/**
 * QuotaManager syncs usage data from server and writes updates directly.
 * Server is the single source of truth - local cache is for display only.
 */
export class QuotaManager extends EventEmitter {
  private cache: ServerUsage | null = null;
  private supabase: SupabaseClient | null = null;
  private supabaseUrl: string = '';
  private syncInterval: ReturnType<typeof setInterval> | null = null;
  private lastSyncAt: number = 0;

  // Session getter injected from main process (provides access token, refresh token, and user ID).
  private getSession: (() => { access_token: string; refresh_token: string; user: { id: string } } | null) | null = null;

  constructor() {
    super();
  }

  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------

  /**
   * Initialize with Supabase credentials and session getter.
   * Call this after auth is set up in main process.
   */
  init(supabaseUrl: string, supabaseAnonKey: string, getSession: () => { access_token: string; refresh_token: string; user: { id: string } } | null): void {
    this.supabaseUrl = supabaseUrl;
    this.supabase = createClient(supabaseUrl, supabaseAnonKey);
    this.getSession = getSession;

    // Start background sync loop.
    this.startBackgroundSync();
  }

  /**
   * Start background sync - syncs on init and every 30 minutes.
   */
  private startBackgroundSync(): void {
    // Initial sync.
    this.syncFromServer();

    // Periodic sync every 30 minutes.
    this.syncInterval = setInterval(() => {
      this.syncFromServer();
    }, SYNC_INTERVAL_MS);
  }

  /**
   * Stop background sync (call on app shutdown).
   */
  destroy(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Server sync
  // ---------------------------------------------------------------------------

  /**
   * Fetch current usage from server via get-usage edge function.
   * Updates local cache and emits 'quotaChanged' event.
   */
  async syncFromServer(): Promise<void> {
    const session = this.getSession?.();
    if (!session?.access_token) {
      // Don't log - this is expected during startup before login
      return;
    }

    try {
      const response = await fetch(`${this.supabaseUrl}/functions/v1/get-usage`, {
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        log.error('Sync failed:', response.status);
        return;
      }

      const data = await response.json() as ServerUsage;

      // Validate response has expected structure
      if (!data.tier || !data.usage || !data.limits) {
        log.error('Invalid response structure from get-usage:', data);
        return;
      }

      // Convert null limits back to Infinity (JSON can't serialize Infinity)
      for (const key of Object.keys(data.limits) as QuotaFeature[]) {
        if (data.limits[key] === null) {
          data.limits[key] = Infinity;
        }
      }

      // Defensive: if the server is on an older deploy and returns no `state`,
      // default permissively to 'pro' so we never lock a user out by accident.
      // The first sync against the new server overwrites this.
      if (!data.state) {
        data.state = 'pro';
      }

      this.cache = data;
      this.lastSyncAt = Date.now();

      log.debug('Synced from server:', this.cache.tier, this.cache.monthYear);

      this.emit('quotaChanged', this.getQuotas());
      this.emit('tierChanged', this.cache.tier);
      this.emit('stateChanged', this.cache.state);
    } catch (err) {
      if (isNetworkError(err)) {
        log.warn('Sync skipped; network unavailable:', getErrorMessage(err));
      } else {
        log.error('Sync error:', err);
      }
      // Keep using cached data if available.
    }
  }

  /**
   * Reload usage from server. Call after login/logout.
   */
  async reload(): Promise<void> {
    await this.syncFromServer();
  }

  /**
   * Clear cached usage data. Call on logout/delete account.
   * Resets to showing free tier defaults.
   */
  clearCache(): void {
    this.cache = null;
    this.emit('quotaChanged', this.getQuotas());
    this.emit('tierChanged', 'free');
    log.info('Cache cleared');
  }

  // ---------------------------------------------------------------------------
  // Usage checking
  // ---------------------------------------------------------------------------

  /**
   * Check if a feature is allowed (has remaining quota).
   * Returns true if: offline (no cache), pro tier, or under limit.
   * Grace-based: returns true if AT the limit (allows that action), false if OVER.
   */
  isAllowed(feature: QuotaFeature): boolean {
    // Offline or not synced yet: allow (permissive).
    if (!this.cache) return true;

    // Expired trial: deny every feature. Catches background/hotkey-triggered
    // paths that don't go through TrialGate (recording, screenshot stacking, etc.).
    if (this.cache.state === 'expired') return false;

    // Pro and active-trial users have no limits on most features
    // (except text_improve_words soft limit).
    if (this.cache.tier === 'pro' && feature !== 'text_improve_words') {
      return true;
    }

    const used = this.cache.usage[feature] || 0;
    const limit = this.cache.limits[feature];

    // Allow if under or AT the limit (grace for the action that hits limit).
    return used < limit;
  }

  /**
   * Get status for a specific feature.
   */
  getFeatureStatus(feature: QuotaFeature): QuotaStatus {
    if (!this.cache) {
      // No data yet - return permissive defaults.
      return {
        used: 0,
        limit: Infinity,
        remaining: Infinity,
        allowed: true,
        percentUsed: 0,
      };
    }

    const used = this.cache.usage[feature] || 0;
    const limit = this.cache.limits[feature];
    const isUnlimited = limit === Infinity || limit >= Number.MAX_SAFE_INTEGER;
    const remaining = isUnlimited ? Infinity : Math.max(0, limit - used);
    const percentUsed = isUnlimited ? 0 : Math.min(100, (used / limit) * 100);

    return {
      used,
      limit,
      remaining,
      allowed: this.isAllowed(feature),
      percentUsed,
    };
  }

  /**
   * Get all quota statuses at once.
   */
  getQuotas(): {
    textImprove: QuotaStatus;
    priorityMic: QuotaStatus;
    autoStack: QuotaStatus;
    portableCommands: QuotaStatus;
    tier: 'free' | 'pro';
    state: TrialState;
    trialEndsAt: string | null;
    nextTrialResetAt: string | null;
  } {
    return {
      textImprove: this.getFeatureStatus('text_improve_words'),
      priorityMic: this.getFeatureStatus('priority_mic_seconds'),
      autoStack: this.getFeatureStatus('auto_stack_sessions'),
      portableCommands: this.getFeatureStatus('portable_commands'),
      tier: this.cache?.tier || 'free',
      // Default to 'pro' when offline / not synced yet — permissive (matches isAllowed behaviour).
      state: this.cache?.state || 'pro',
      trialEndsAt: this.cache?.trialEndsAt ?? null,
      nextTrialResetAt: this.cache?.nextTrialResetAt ?? null,
    };
  }

  /**
   * Get cached tier.
   */
  getCachedTier(): 'free' | 'pro' {
    return this.cache?.tier || 'free';
  }

  /**
   * Set initial tier from preferences (for offline/startup).
   * This pre-populates the cache so Pro users don't get downgraded
   * before server sync completes.
   */
  setInitialTier(tier: 'free' | 'pro'): void {
    if (!this.cache) {
      // Create minimal cache with just tier - server will fill in rest.
      // State defaults to 'pro' (permissive) until the first server sync; the cached `tier`
      // alone can't tell us whether a non-paid user is currently trial or expired.
      const monthYear = new Date().toISOString().slice(0, 7);
      this.cache = {
        tier,
        state: 'pro',
        trialEndsAt: null,
        nextTrialResetAt: null,
        monthYear,
        usage: {
          text_improve_words: 0,
          priority_mic_seconds: 0,
          auto_stack_sessions: 0,
          portable_commands: 0,
        },
        limits: tier === 'pro' ? {
          text_improve_words: Infinity,
          priority_mic_seconds: Infinity,
          auto_stack_sessions: Infinity,
          portable_commands: Infinity,
        } : {
          text_improve_words: 5000,
          priority_mic_seconds: 30000,
          auto_stack_sessions: 50,
          portable_commands: 100,
        },
      };
      log.info('Set initial tier from preferences:', tier);
      this.emit('tierChanged', tier);
    }
  }

  // ---------------------------------------------------------------------------
  // Usage tracking
  // ---------------------------------------------------------------------------

  /**
   * Update usage for a feature.
   * 1. Optimistic local update (immediate UI feedback).
   * 2. Fire-and-forget write to server (background, will sync later if offline).
   */
  async updateUsage(feature: QuotaFeature, amount: number): Promise<void> {
    const session = this.getSession?.();
    if (!session?.user?.id) {
      // Don't log - this is expected when not logged in
      return;
    }

    const monthYear = new Date().toISOString().slice(0, 7);
    const userId = session.user.id;

    // 1. Optimistic local update for immediate UI feedback.
    if (this.cache) {
      this.cache.usage[feature] = (this.cache.usage[feature] || 0) + amount;
      this.emit('quotaChanged', this.getQuotas());
    }

    // 2. Write to server (fire and forget).
    if (!this.supabase) {
      log.error('Supabase not initialized');
      return;
    }

    try {
      // Set the user's session for RLS
      await this.supabase.auth.setSession({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      });

      // Get current usage to calculate new total.
      const currentValue = this.cache?.usage[feature] || amount;

      const { error } = await this.supabase
        .from('user_usage')
        .upsert({
          user_id: userId,
          month_year: monthYear,
          [feature]: currentValue,
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'user_id,month_year',
        });

      if (error) {
        if (isNetworkError(error)) {
          log.warn('Usage update skipped; network unavailable:', getErrorMessage(error));
        } else {
          log.error('Failed to update usage:', error);
        }
        // Will sync on next interval.
      } else {
        log.debug(`Updated ${feature}: +${amount} (total: ${currentValue})`);
      }
    } catch (err) {
      if (isNetworkError(err)) {
        log.warn('Usage update skipped; network unavailable:', getErrorMessage(err));
      } else {
        log.error('Usage update error:', err);
      }
      // Offline - will sync later.
    }
  }

  // ---------------------------------------------------------------------------
  // Display helpers
  // ---------------------------------------------------------------------------

  /**
   * Format usage for display (e.g., "2,340/5,000 words").
   */
  formatUsage(feature: QuotaFeature, unit: string): string {
    const status = this.getFeatureStatus(feature);

    if (status.limit === Infinity) {
      return `${status.used.toLocaleString()}/∞ ${unit}`;
    }

    // Cap displayed usage at limit (show "5,000/5,000" not "5,500/5,000").
    const displayedUsed = Math.min(status.used, status.limit);
    return `${displayedUsed.toLocaleString()}/${status.limit.toLocaleString()} ${unit}`;
  }

  /**
   * Format priority mic usage (converts seconds to minutes).
   */
  formatPriorityMicUsage(): string {
    const status = this.getFeatureStatus('priority_mic_seconds');

    if (status.limit === Infinity) {
      const usedMinutes = Math.floor(status.used / 60);
      return `${usedMinutes}/∞ priority mic mins`;
    }

    const usedMinutes = Math.floor(status.used / 60);
    const limitMinutes = Math.floor(status.limit / 60);
    const displayedMinutes = Math.min(usedMinutes, limitMinutes);
    return `${displayedMinutes}/${limitMinutes} priority mic mins`;
  }

  formatAutoStackUsage(): string {
    return this.formatUsage('auto_stack_sessions', 'auto-stacks');
  }

  formatTextImproveUsage(): string {
    return this.formatUsage('text_improve_words', 'words improved');
  }

  formatPortableCommandsUsage(): string {
    return this.formatUsage('portable_commands', 'portable command uses');
  }

  /**
   * Get days until next month (approximate reset date).
   */
  getDaysUntilReset(): number {
    const now = new Date();
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const diffMs = nextMonth.getTime() - now.getTime();
    return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
  }

  /**
   * Get the quota limits for the current tier.
   */
  getLimits(): Record<QuotaFeature, number> {
    if (!this.cache) {
      // Default to free tier limits.
      return {
        text_improve_words: 5000,
        priority_mic_seconds: 30000,
        auto_stack_sessions: 50,
        portable_commands: 100,
      };
    }
    return this.cache.limits;
  }
}
