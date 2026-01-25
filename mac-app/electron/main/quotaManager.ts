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
    verbalCommands: 50,           // Voice commands (copy that, new line, etc.)
  },
  pro: {
    priorityMicMinutes: Infinity,
    autoStackSessions: Infinity,
    textImprovementWords: Infinity,
    verbalCommands: Infinity,
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
  feature: 'priorityMic' | 'autoStack' | 'textImprove' | 'verbalCommands';
}

/**
 * QuotaManager tracks local usage for quota-limited features.
 * Quotas reset on calendar month boundary (YYYY-MM format).
 * Tier is cached locally for offline access.
 */
export class QuotaManager extends EventEmitter {
  private preferencesManager: PreferencesManager;
  private quotas: LocalQuotas;

  // Per-user quota reset tracking
  private signupDay: number = 1;  // Day of month user signed up (1-31)
  private lastResetDate: Date | null = null;  // Date of last quota reset

  // Session checker function injected from main process.
  // Returns true if user has a valid (non-expired) session.
  // When not logged in, we enforce free tier limits regardless of cached tier.
  private sessionChecker: (() => boolean) | null = null;

  // Dev overrides for scenario testing (superadmin only).
  // When set, these values override the real tier/quota values.
  private devOverrides: {
    tier?: 'free' | 'pro';
    quotaPercentages?: {
      priorityMic?: number;
      autoStack?: number;
      textImprove?: number;
      verbalCommands?: number;
    };
  } | null = null;

  constructor(preferencesManager: PreferencesManager) {
    super();
    this.preferencesManager = preferencesManager;
    this.quotas = this.loadQuotas();

    // Load any persisted dev overrides
    const persistedOverrides = preferencesManager.getPreference('devOverrides');
    if (persistedOverrides && (persistedOverrides.tier || persistedOverrides.quotaPercentages)) {
      this.devOverrides = {
        tier: persistedOverrides.tier,
        quotaPercentages: persistedOverrides.quotaPercentages,
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Dev Overrides (Scenario Testing)
  // ---------------------------------------------------------------------------

  /**
   * Set dev overrides for scenario testing.
   * When set, these values override real tier and quota values.
   */
  setDevOverrides(overrides: typeof this.devOverrides): void {
    this.devOverrides = overrides;

    // Emit tier change if tier is being overridden
    if (overrides?.tier) {
      this.emit('tierChanged', overrides.tier);
    }

    // Always emit quota change so UI updates
    this.emit('quotaChanged', this.getQuotas());
  }

  /**
   * Clear all dev overrides and restore real values.
   */
  clearDevOverrides(): void {
    this.devOverrides = null;

    // Emit events to restore real state in UI
    this.emit('tierChanged', this.quotas.cachedTier);
    this.emit('quotaChanged', this.getQuotas());
  }

  /**
   * Check if any dev overrides are active.
   */
  hasDevOverrides(): boolean {
    if (!this.devOverrides) return false;
    return this.devOverrides.tier !== undefined ||
           (this.devOverrides.quotaPercentages !== undefined &&
            Object.keys(this.devOverrides.quotaPercentages).length > 0);
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
   * - Dev override → use override tier
   * - Not logged in → 'free' (all users must have accounts)
   * - Logged in + free → 'free'
   * - Logged in + pro → 'pro' (unlimited)
   */
  private getEffectiveTier(): UserTier {
    // Check for dev override first (scenario testing).
    if (this.devOverrides?.tier) {
      return this.devOverrides.tier;
    }

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
   * Load quotas from preferences, handling migration and per-user reset.
   */
  private loadQuotas(): LocalQuotas {
    const stored = this.preferencesManager.getPreference('localQuotas');
    const currentPeriod = this.getCurrentPeriod();

    // If no stored quotas, create fresh
    if (!stored) {
      const fresh: LocalQuotas = {
        period: currentPeriod,
        priorityMicSecondsUsed: 0,
        autoStackSessionsUsed: 0,
        textImprovementWordsUsed: 0,
        verbalCommandsUsed: 0,
        cachedTier: 'free',
        cachedTierUpdatedAt: new Date().toISOString(),
      };
      this.saveQuotas(fresh);
      return fresh;
    }

    // Load signup day and last reset date for per-user reset logic
    this.signupDay = stored.signupDay || 1;
    this.lastResetDate = stored.lastResetDate ? new Date(stored.lastResetDate) : null;

    // Migration: if old period exists but no lastResetDate, convert
    // Assume last reset was 1st of stored period month
    if (stored.period && !stored.lastResetDate) {
      const [year, month] = stored.period.split('-').map(Number);
      this.lastResetDate = new Date(year, month - 1, 1);
      stored.lastResetDate = this.lastResetDate.toISOString().split('T')[0];
    }

    // Handle migration from older quota format (count-based to word-based).
    if (stored.textImprovementWordsUsed === undefined) {
      stored.textImprovementWordsUsed = 0;
    }

    // Handle migration for verbal commands quota.
    if (stored.verbalCommandsUsed === undefined) {
      stored.verbalCommandsUsed = 0;
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
  // Per-user quota reset
  // ---------------------------------------------------------------------------

  /**
   * Set signup day. Called when user creates account or logs in.
   * Signup day determines when quotas reset each month.
   */
  async setSignupDay(day: number): Promise<void> {
    // Clamp to valid range (1-31)
    this.signupDay = Math.max(1, Math.min(31, day));
    this.quotas.signupDay = this.signupDay;

    // If no lastResetDate yet (new user), set it to today
    if (!this.quotas.lastResetDate) {
      const today = new Date();
      this.quotas.lastResetDate = today.toISOString().split('T')[0];
      this.lastResetDate = today;
    }

    await this.saveQuotas(this.quotas);
  }

  /**
   * Get the effective signup day for a given month (handles 31st in Feb, etc.)
   */
  private getEffectiveSignupDay(year: number, month: number): number {
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    return Math.min(this.signupDay, daysInMonth);
  }

  /**
   * Get the next reset date after a given date.
   */
  private getNextResetAfter(afterDate: Date): Date {
    const year = afterDate.getFullYear();
    const month = afterDate.getMonth();
    const day = afterDate.getDate();
    const effectiveDay = this.getEffectiveSignupDay(year, month);

    // If we haven't passed signup day this month, next reset is this month
    if (day < effectiveDay) {
      return new Date(year, month, effectiveDay);
    }

    // Otherwise, next reset is next month
    const nextMonth = month + 1;
    const nextYear = nextMonth > 11 ? year + 1 : year;
    const normalizedMonth = nextMonth % 12;
    const effectiveDayNextMonth = this.getEffectiveSignupDay(nextYear, normalizedMonth);
    return new Date(nextYear, normalizedMonth, effectiveDayNextMonth);
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

    // Check for percentage override (scenario testing).
    if (this.devOverrides?.quotaPercentages?.priorityMic !== undefined) {
      const overridePercent = this.devOverrides.quotaPercentages.priorityMic;
      const simulatedUsed = isUnlimited(limitSeconds)
        ? Math.floor(500 * 60 * overridePercent / 100)  // Use free tier limit for simulation
        : Math.floor(limitSeconds * overridePercent / 100);
      const simulatedLimit = isUnlimited(limitSeconds) ? 500 * 60 : limitSeconds;
      return {
        used: simulatedUsed,
        limit: simulatedLimit,
        remaining: Math.max(0, simulatedLimit - simulatedUsed),
        allowed: simulatedUsed < simulatedLimit,
        percentUsed: overridePercent,
      };
    }

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

    // Check for percentage override (scenario testing).
    if (this.devOverrides?.quotaPercentages?.autoStack !== undefined) {
      const overridePercent = this.devOverrides.quotaPercentages.autoStack;
      const freeLimit = TIER_LIMITS.free.autoStackSessions;
      const simulatedLimit = isUnlimited(limit) ? freeLimit : limit;
      const simulatedUsed = Math.floor(simulatedLimit * overridePercent / 100);
      return {
        used: simulatedUsed,
        limit: simulatedLimit,
        remaining: Math.max(0, simulatedLimit - simulatedUsed),
        allowed: simulatedUsed < simulatedLimit,
        percentUsed: overridePercent,
      };
    }

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

    // Check for percentage override (scenario testing).
    if (this.devOverrides?.quotaPercentages?.textImprove !== undefined) {
      const overridePercent = this.devOverrides.quotaPercentages.textImprove;
      const freeLimit = TIER_LIMITS.free.textImprovementWords;
      const simulatedLimit = isUnlimited(limit) ? freeLimit : limit;
      const simulatedUsed = Math.floor(simulatedLimit * overridePercent / 100);
      return {
        used: simulatedUsed,
        limit: simulatedLimit,
        remaining: Math.max(0, simulatedLimit - simulatedUsed),
        allowed: simulatedUsed < simulatedLimit,
        percentUsed: overridePercent,
      };
    }

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
  // Verbal commands quota
  // ---------------------------------------------------------------------------

  /**
   * Increment verbal commands count.
   * Call once per voice command executed (copy that, new line, etc.).
   */
  async incrementVerbalCommands(): Promise<void> {
    // Pro users don't consume quota.
    if (this.getEffectiveTier() === 'pro') return;

    // Check for month rollover before incrementing.
    this.checkAndResetIfNeeded();

    await this.saveQuotas({
      ...this.quotas,
      verbalCommandsUsed: (this.quotas.verbalCommandsUsed || 0) + 1,
    });

    this.emit('quotaChanged', this.getQuotas());
  }

  /**
   * Get verbal commands quota status.
   */
  getVerbalCommandsStatus(): QuotaStatus {
    const tier = this.getEffectiveTier();
    const limit = TIER_LIMITS[tier].verbalCommands;

    // Check for percentage override (scenario testing).
    if (this.devOverrides?.quotaPercentages?.verbalCommands !== undefined) {
      const overridePercent = this.devOverrides.quotaPercentages.verbalCommands;
      const freeLimit = TIER_LIMITS.free.verbalCommands;
      const simulatedLimit = isUnlimited(limit) ? freeLimit : limit;
      const simulatedUsed = Math.floor(simulatedLimit * overridePercent / 100);
      return {
        used: simulatedUsed,
        limit: simulatedLimit,
        remaining: Math.max(0, simulatedLimit - simulatedUsed),
        allowed: simulatedUsed < simulatedLimit,
        percentUsed: overridePercent,
      };
    }

    const used = this.quotas.verbalCommandsUsed || 0;
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
  getQuotas(): { priorityMic: QuotaStatus; autoStack: QuotaStatus; textImprove: QuotaStatus; verbalCommands: QuotaStatus; tier: UserTier } {
    return {
      priorityMic: this.getPriorityMicStatus(),
      autoStack: this.getAutoStackStatus(),
      textImprove: this.getTextImproveStatus(),
      verbalCommands: this.getVerbalCommandsStatus(),
      tier: this.getEffectiveTier(),
    };
  }

  /**
   * Check if a specific quota is exhausted.
   */
  checkQuota(feature: 'priorityMic' | 'autoStack' | 'textImprove' | 'verbalCommands'): QuotaCheckResult {
    let status: QuotaStatus;
    if (feature === 'priorityMic') {
      status = this.getPriorityMicStatus();
    } else if (feature === 'autoStack') {
      status = this.getAutoStackStatus();
    } else if (feature === 'verbalCommands') {
      status = this.getVerbalCommandsStatus();
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
   * Check if quotas should reset based on per-user anniversary date.
   */
  private checkAndResetIfNeeded(): void {
    // If no lastResetDate, this is a new user - quotas start fresh
    if (!this.lastResetDate) {
      return;
    }

    const now = new Date();
    const nextReset = this.getNextResetAfter(this.lastResetDate);

    if (now >= nextReset) {
      // Time to reset quotas
      const todayStr = now.toISOString().split('T')[0];
      this.quotas = {
        ...this.quotas,
        period: this.getCurrentPeriod(),  // Keep period updated for backwards compat
        lastResetDate: todayStr,
        priorityMicSecondsUsed: 0,
        autoStackSessionsUsed: 0,
        textImprovementWordsUsed: 0,
        verbalCommandsUsed: 0,
      };
      this.lastResetDate = now;
      this.saveQuotas(this.quotas);
      this.emit('quotaReset');
    }
  }

  // ---------------------------------------------------------------------------
  // Display helpers
  // ---------------------------------------------------------------------------

  /**
   * Format priority mic usage for display.
   * Returns "0/500 priority mic mins" or "0/∞ priority mic mins".
   * Caps displayed usage at limit (shows "30/30" not "35/30").
   */
  formatPriorityMicUsage(): string {
    const status = this.getPriorityMicStatus();
    const usedMinutes = Math.floor(status.used / 60);
    if (isUnlimited(status.limit)) {
      return `${usedMinutes}/∞ priority mic mins`;
    }
    const limitMinutes = Math.floor(status.limit / 60);
    const displayedMinutes = Math.min(usedMinutes, limitMinutes);
    return `${displayedMinutes}/${limitMinutes} priority mic mins`;
  }

  /**
   * Format auto-stack usage for display.
   * Returns "7/50 auto-stacks" or "7/∞ auto-stacks".
   * Caps displayed usage at limit (shows "30/30" not "35/30").
   */
  formatAutoStackUsage(): string {
    const status = this.getAutoStackStatus();
    if (isUnlimited(status.limit)) {
      return `${status.used}/∞ auto-stacks`;
    }
    const displayedUsed = Math.min(status.used, status.limit);
    return `${displayedUsed}/${status.limit} auto-stacks`;
  }

  /**
   * Format text improvement usage for display.
   * Returns "2,340/5,000 words" or "2,340/∞ words".
   * Caps displayed usage at limit (shows "5,000/5,000" not "5,500/5,000").
   */
  formatTextImproveUsage(): string {
    const status = this.getTextImproveStatus();
    if (isUnlimited(status.limit)) {
      return `${status.used.toLocaleString()}/∞ words`;
    }
    const displayedUsed = Math.min(status.used, status.limit);
    return `${displayedUsed.toLocaleString()}/${status.limit.toLocaleString()} words`;
  }

  /**
   * Format verbal commands usage for display.
   * Returns "25/50 voice commands" or "25/∞ voice commands".
   */
  formatVerbalCommandsUsage(): string {
    const status = this.getVerbalCommandsStatus();
    if (isUnlimited(status.limit)) {
      return `${status.used}/∞ voice commands`;
    }
    const displayedUsed = Math.min(status.used, status.limit);
    return `${displayedUsed}/${status.limit} voice commands`;
  }

  /**
   * Get the next reset date based on user's signup day.
   */
  getResetDate(): Date {
    if (!this.lastResetDate) {
      // Fallback: if no reset date yet, calculate from today
      return this.getNextResetAfter(new Date());
    }
    return this.getNextResetAfter(this.lastResetDate);
  }

  /**
   * Get days until quota reset (based on user's signup day).
   */
  getDaysUntilReset(): number {
    const now = new Date();
    const resetDate = this.getResetDate();
    const diffMs = resetDate.getTime() - now.getTime();
    return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
  }

  /**
   * Get the quota limits for the current tier.
   * Used to display "resets to X" in UI.
   */
  getLimits(): { priorityMicMinutes: number; autoStackSessions: number; textImprovementWords: number; verbalCommands: number } {
    const tier = this.getEffectiveTier();
    return {
      priorityMicMinutes: TIER_LIMITS[tier].priorityMicMinutes,
      autoStackSessions: TIER_LIMITS[tier].autoStackSessions,
      textImprovementWords: TIER_LIMITS[tier].textImprovementWords,
      verbalCommands: TIER_LIMITS[tier].verbalCommands,
    };
  }
}
