import { EventEmitter } from 'events';
import { PreferencesManager, LocalQuotas } from './preferences';

// =============================================================================
// QuotaManager - Local quota tracking for free users.
// Tracks priority mic minutes, auto-stack sessions, and text improvement words
// per calendar month.
// =============================================================================

// User tier type. All users have accounts (no anonymous tier).
type UserTier = 'free' | 'pro';

// Feature limits by tier.
const TIER_LIMITS = {
  free: {
    priorityMicMinutes: 500,      // ~8 hours per month
    autoStackSessions: 50,        // Only counts 2+ image sessions
    textImprovementWords: 5000,   // Word-based (input words)
  },
  pro: {
    priorityMicMinutes: Infinity,
    autoStackSessions: Infinity,
    textImprovementWords: Infinity,
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
  feature: 'priorityMic' | 'autoStack' | 'textImprove';
}

/**
 * QuotaManager tracks local usage for quota-limited features.
 * Quotas reset on calendar month boundary (YYYY-MM format).
 * Tier is cached locally for offline access.
 */
export class QuotaManager extends EventEmitter {
  private preferencesManager: PreferencesManager;
  private quotas: LocalQuotas;
  
  // Session checker function injected from main process.
  // Returns true if user has a valid (non-expired) session.
  // When not logged in, we enforce free tier limits regardless of cached tier.
  private sessionChecker: (() => boolean) | null = null;

  constructor(preferencesManager: PreferencesManager) {
    super();
    this.preferencesManager = preferencesManager;
    this.quotas = this.loadQuotas();
  }
  
  /**
   * Set the session checker function. Called from main process after mobileSync is initialized.
   * This allows quota checks to use free limits when user is not logged in.
   */
  setSessionChecker(checker: () => boolean): void {
    this.sessionChecker = checker;
  }
  
  /**
   * Get the effective tier based on login state:
   * - Not logged in → 'free' (all users must have accounts)
   * - Logged in + free → 'free'
   * - Logged in + pro → 'pro' (unlimited)
   */
  private getEffectiveTier(): UserTier {
    // If no session checker set, fall back to cached tier.
    if (!this.sessionChecker) {
      return this.quotas.cachedTier;
    }

    // If not logged in, use free tier (all users have accounts via onboarding).
    const hasValidSession = this.sessionChecker();
    if (!hasValidSession) {
      return 'free';
    }

    // User is logged in - check if tier has been fetched from server yet.
    // If cached tier is 'free' but we haven't updated it recently (within 60 seconds of app start),
    // it's likely the default value and the real tier hasn't been fetched yet.
    // In this case, be optimistic and assume 'pro' to avoid blocking during initial load.
    if (this.quotas.cachedTier === 'free' && this.quotas.cachedTierUpdatedAt) {
      const updatedAt = new Date(this.quotas.cachedTierUpdatedAt).getTime();
      const now = Date.now();
      const msSinceUpdate = now - updatedAt;

      if (msSinceUpdate > 60000) {
        console.log('[QuotaManager] Using optimistic pro tier during initial fetch window');
        return 'pro';
      }
    }

    return this.quotas.cachedTier;
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
        textImprovementWordsUsed: 0,
        cachedTier: stored?.cachedTier || 'free',
        cachedTierUpdatedAt: stored?.cachedTierUpdatedAt || new Date().toISOString(),
      };
      this.saveQuotas(fresh);
      return fresh;
    }

    // Handle migration from older quota format (count-based to word-based).
    // If old textImprovementsUsed exists but new textImprovementWordsUsed doesn't,
    // reset to 0 (don't try to convert counts to words).
    if (stored.textImprovementWordsUsed === undefined) {
      stored.textImprovementWordsUsed = 0;
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
   * Only accepts 'free' or 'pro' since 'anonymous' is a runtime-only state.
   */
  async setCachedTier(tier: 'free' | 'pro'): Promise<void> {
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
    if (this.getEffectiveTier() === 'pro') return;

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
    const tier = this.getEffectiveTier();
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
    if (this.getEffectiveTier() === 'pro') return;

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
    const tier = this.getEffectiveTier();
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
  // Text improvement quota (word-based)
  // ---------------------------------------------------------------------------

  /**
   * Increment text improvement word count.
   * Call with the number of input words being improved.
   * Uses "grace" logic: if user has any quota remaining, allow the full request.
   */
  async incrementTextImprove(wordCount: number): Promise<void> {
    // Pro users don't consume quota.
    if (this.getEffectiveTier() === 'pro') return;

    // Check for month rollover before incrementing.
    this.checkAndResetIfNeeded();

    await this.saveQuotas({
      ...this.quotas,
      textImprovementWordsUsed: (this.quotas.textImprovementWordsUsed || 0) + wordCount,
    });

    this.emit('quotaChanged', this.getQuotas());
  }

  /**
   * Get text improvement quota status (word-based).
   */
  getTextImproveStatus(): QuotaStatus {
    const tier = this.getEffectiveTier();
    const limit = TIER_LIMITS[tier].textImprovementWords;
    const used = this.quotas.textImprovementWordsUsed || 0;
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
   * Get all quotas at once, plus the current tier.
   */
  getQuotas(): { priorityMic: QuotaStatus; autoStack: QuotaStatus; textImprove: QuotaStatus; tier: UserTier } {
    return {
      priorityMic: this.getPriorityMicStatus(),
      autoStack: this.getAutoStackStatus(),
      textImprove: this.getTextImproveStatus(),
      tier: this.getEffectiveTier(),
    };
  }

  /**
   * Check if a specific quota is exhausted.
   */
  checkQuota(feature: 'priorityMic' | 'autoStack' | 'textImprove'): QuotaCheckResult {
    let status: QuotaStatus;
    if (feature === 'priorityMic') {
      status = this.getPriorityMicStatus();
    } else if (feature === 'autoStack') {
      status = this.getAutoStackStatus();
    } else {
      status = this.getTextImproveStatus();
    }

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
        textImprovementWordsUsed: 0,
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Display helpers
  // ---------------------------------------------------------------------------

  /**
   * Format priority mic usage for display.
   * Returns "0 of 500 priority mic mins" or "0 of ∞ priority mic mins".
   * Caps displayed usage at limit (shows "30 of 30" not "35 of 30").
   */
  formatPriorityMicUsage(): string {
    const status = this.getPriorityMicStatus();
    const usedMinutes = Math.floor(status.used / 60);
    if (isUnlimited(status.limit)) {
      return `${usedMinutes} of ∞ priority mic mins`;
    }
    const limitMinutes = Math.floor(status.limit / 60);
    const displayedMinutes = Math.min(usedMinutes, limitMinutes);
    return `${displayedMinutes} of ${limitMinutes} priority mic mins`;
  }

  /**
   * Format auto-stack usage for display.
   * Returns "7 of 50 auto-stacks" or "7 of ∞ auto-stacks".
   * Caps displayed usage at limit (shows "30 of 30" not "35 of 30").
   */
  formatAutoStackUsage(): string {
    const status = this.getAutoStackStatus();
    if (isUnlimited(status.limit)) {
      return `${status.used} of ∞ auto-stacks`;
    }
    const displayedUsed = Math.min(status.used, status.limit);
    return `${displayedUsed} of ${status.limit} auto-stacks`;
  }

  /**
   * Format text improvement usage for display.
   * Returns "2,340 of 5,000 words" or "2,340 of ∞ words".
   * Caps displayed usage at limit (shows "5,000 of 5,000" not "5,500 of 5,000").
   */
  formatTextImproveUsage(): string {
    const status = this.getTextImproveStatus();
    if (isUnlimited(status.limit)) {
      return `${status.used.toLocaleString()} of ∞ words`;
    }
    const displayedUsed = Math.min(status.used, status.limit);
    return `${displayedUsed.toLocaleString()} of ${status.limit.toLocaleString()} words`;
  }

  /**
   * Get the reset date (first of next month).
   */
  getResetDate(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + 1, 1);
  }

  /**
   * Get days until quota reset (first of next month).
   */
  getDaysUntilReset(): number {
    const now = new Date();
    const resetDate = this.getResetDate();
    const diffMs = resetDate.getTime() - now.getTime();
    return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  }

  /**
   * Get the quota limits for the current tier.
   * Used to display "resets to X" in UI.
   */
  getLimits(): { priorityMicMinutes: number; autoStackSessions: number; textImprovementWords: number } {
    const tier = this.getEffectiveTier();
    return {
      priorityMicMinutes: TIER_LIMITS[tier].priorityMicMinutes,
      autoStackSessions: TIER_LIMITS[tier].autoStackSessions,
      textImprovementWords: TIER_LIMITS[tier].textImprovementWords,
    };
  }
}
