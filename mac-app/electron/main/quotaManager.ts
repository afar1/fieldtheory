import { EventEmitter } from 'events';
import { PreferencesManager, LocalQuotas } from './preferences';

// =============================================================================
// QuotaManager - Local quota tracking for anonymous and free users.
// Tracks priority mic minutes and auto-stack sessions per calendar month.
// =============================================================================

// User tier type.
type UserTier = 'free' | 'pro';

// Feature limits by tier (inlined from types/tiers.ts to avoid cross-directory import).
const TIER_LIMITS = {
  free: {
    priorityMicMinutes: 500,
    autoStackSessions: 50,
  },
  pro: {
    priorityMicMinutes: Infinity,
    autoStackSessions: Infinity,
  },
} as const;

// Check if a limit value is effectively unlimited.
function isUnlimited(value: number): boolean {
  return value === Infinity || value >= Number.MAX_SAFE_INTEGER;
}

export interface QuotaStatus {
  used: number;
  limit: number;
  remaining: number;
  allowed: boolean;
  percentUsed: number;
}

export interface QuotaCheckResult {
  allowed: boolean;
  used: number;
  limit: number;
  feature: 'priorityMic' | 'autoStack';
}

/**
 * QuotaManager tracks local usage for quota-limited features.
 * Quotas reset on calendar month boundary (YYYY-MM format).
 * Tier is cached locally for offline access.
 */
export class QuotaManager extends EventEmitter {
  private preferencesManager: PreferencesManager;
  private quotas: LocalQuotas;

  constructor(preferencesManager: PreferencesManager) {
    super();
    this.preferencesManager = preferencesManager;
    this.quotas = this.loadQuotas();
  }

  // ---------------------------------------------------------------------------
  // Initialization and persistence
  // ---------------------------------------------------------------------------

  /**
   * Load quotas from preferences, resetting if month has changed.
   */
  private loadQuotas(): LocalQuotas {
    const stored = this.preferencesManager.getPreference('localQuotas');
    const currentPeriod = this.getCurrentPeriod();

    // If no stored quotas or month changed, reset counters.
    if (!stored || stored.period !== currentPeriod) {
      const fresh: LocalQuotas = {
        period: currentPeriod,
        priorityMicSecondsUsed: 0,
        autoStackSessionsUsed: 0,
        cachedTier: stored?.cachedTier || 'free',
        cachedTierUpdatedAt: stored?.cachedTierUpdatedAt || new Date().toISOString(),
      };
      this.saveQuotas(fresh);
      return fresh;
    }

    return stored;
  }

  /**
   * Persist quotas to preferences.
   */
  private async saveQuotas(quotas: LocalQuotas): Promise<void> {
    this.quotas = quotas;
    await this.preferencesManager.save({ localQuotas: quotas });
  }

  /**
   * Get current period in YYYY-MM format.
   */
  private getCurrentPeriod(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }

  // ---------------------------------------------------------------------------
  // Tier management
  // ---------------------------------------------------------------------------

  /**
   * Get the cached tier for offline use.
   */
  getCachedTier(): UserTier {
    return this.quotas.cachedTier;
  }

  /**
   * Update cached tier when fetched from server.
   */
  async setCachedTier(tier: UserTier): Promise<void> {
    await this.saveQuotas({
      ...this.quotas,
      cachedTier: tier,
      cachedTierUpdatedAt: new Date().toISOString(),
    });
    this.emit('tierChanged', tier);
  }

  // ---------------------------------------------------------------------------
  // Priority mic quota
  // ---------------------------------------------------------------------------

  /**
   * Increment priority mic usage by the given number of seconds.
   * Only call this when priority device is selected (not "none").
   */
  async incrementPriorityMic(seconds: number): Promise<void> {
    // Pro users don't consume quota.
    if (this.quotas.cachedTier === 'pro') return;

    // Check for month rollover before incrementing.
    this.checkAndResetIfNeeded();

    await this.saveQuotas({
      ...this.quotas,
      priorityMicSecondsUsed: this.quotas.priorityMicSecondsUsed + seconds,
    });

    this.emit('quotaChanged', this.getQuotas());
  }

  /**
   * Get priority mic quota status.
   */
  getPriorityMicStatus(): QuotaStatus {
    const tier = this.quotas.cachedTier;
    const limitMinutes = TIER_LIMITS[tier].priorityMicMinutes;
    const limitSeconds = isUnlimited(limitMinutes) ? Infinity : limitMinutes * 60;
    const used = this.quotas.priorityMicSecondsUsed;
    const remaining = isUnlimited(limitSeconds) ? Infinity : Math.max(0, limitSeconds - used);

    return {
      used,
      limit: limitSeconds,
      remaining,
      allowed: isUnlimited(limitSeconds) || used < limitSeconds,
      percentUsed: isUnlimited(limitSeconds) ? 0 : Math.min(100, (used / limitSeconds) * 100),
    };
  }

  // ---------------------------------------------------------------------------
  // Auto-stack quota
  // ---------------------------------------------------------------------------

  /**
   * Increment auto-stack sessions count.
   * Call once per recording session that creates an auto-stack.
   */
  async incrementAutoStack(): Promise<void> {
    // Pro users don't consume quota.
    if (this.quotas.cachedTier === 'pro') return;

    // Check for month rollover before incrementing.
    this.checkAndResetIfNeeded();

    await this.saveQuotas({
      ...this.quotas,
      autoStackSessionsUsed: this.quotas.autoStackSessionsUsed + 1,
    });

    this.emit('quotaChanged', this.getQuotas());
  }

  /**
   * Get auto-stack quota status.
   */
  getAutoStackStatus(): QuotaStatus {
    const tier = this.quotas.cachedTier;
    const limit = TIER_LIMITS[tier].autoStackSessions;
    const used = this.quotas.autoStackSessionsUsed;
    const remaining = isUnlimited(limit) ? Infinity : Math.max(0, limit - used);

    return {
      used,
      limit,
      remaining,
      allowed: isUnlimited(limit) || used < limit,
      percentUsed: isUnlimited(limit) ? 0 : Math.min(100, (used / limit) * 100),
    };
  }

  // ---------------------------------------------------------------------------
  // Combined quota access
  // ---------------------------------------------------------------------------

  /**
   * Get both quotas at once.
   */
  getQuotas(): { priorityMic: QuotaStatus; autoStack: QuotaStatus } {
    return {
      priorityMic: this.getPriorityMicStatus(),
      autoStack: this.getAutoStackStatus(),
    };
  }

  /**
   * Check if a specific quota is exhausted.
   */
  checkQuota(feature: 'priorityMic' | 'autoStack'): QuotaCheckResult {
    const status = feature === 'priorityMic' 
      ? this.getPriorityMicStatus() 
      : this.getAutoStackStatus();

    return {
      allowed: status.allowed,
      used: status.used,
      limit: status.limit,
      feature,
    };
  }

  /**
   * Check for month rollover and reset if needed.
   */
  private checkAndResetIfNeeded(): void {
    const currentPeriod = this.getCurrentPeriod();
    if (this.quotas.period !== currentPeriod) {
      this.quotas = {
        ...this.quotas,
        period: currentPeriod,
        priorityMicSecondsUsed: 0,
        autoStackSessionsUsed: 0,
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Display helpers
  // ---------------------------------------------------------------------------

  /**
   * Format priority mic usage for display.
   * Returns "0 of 500 min priority mic" or "0 of ∞ min priority mic".
   */
  formatPriorityMicUsage(): string {
    const status = this.getPriorityMicStatus();
    const usedMinutes = Math.floor(status.used / 60);
    if (isUnlimited(status.limit)) {
      return `${usedMinutes} of ∞ min priority mic`;
    }
    const limitMinutes = Math.floor(status.limit / 60);
    return `${usedMinutes} of ${limitMinutes} min priority mic`;
  }

  /**
   * Format auto-stack usage for display.
   * Returns "7 of 50 auto-stacks" or "7 of ∞ auto-stacks".
   */
  formatAutoStackUsage(): string {
    const status = this.getAutoStackStatus();
    if (isUnlimited(status.limit)) {
      return `${status.used} of ∞ auto-stacks`;
    }
    return `${status.used} of ${status.limit} auto-stacks`;
  }

  /**
   * Get the reset date (first of next month).
   */
  getResetDate(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + 1, 1);
  }
}
