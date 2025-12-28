// User tier definitions and feature limits.
// This is the single source of truth for all tier-related limits across the app.

export type UserTier = 'free' | 'pro';
export type AccountStatus = 'none' | 'free' | 'pro';

// Pricing in USD.
export const PRICING = {
  proMonthly: 15,
  additionalTeamMember: 15, // Per user/month beyond included 3
  includedTeamMembers: 3,
} as const;

// Feature limits by tier.
// Use Infinity for unlimited features.
export const TIER_LIMITS = {
  free: {
    priorityMicMinutes: 100,
    sharedClipboardPeople: 3,
    promptImprovementsPerMonth: 10,
    tasksAndObservationsPerMonth: 25,
    searchableStacks: 20,
    // Unlimited features (no limit).
    transcripts: Infinity,
    stacks: Infinity,
    drawings: Infinity,
    dms: Infinity,
    invites: Infinity,
  },
  pro: {
    priorityMicMinutes: Infinity,
    sharedClipboardPeople: Infinity, // Each beyond 3 incurs extra cost
    promptImprovementsPerMonth: 100,
    tasksAndObservationsPerMonth: Infinity,
    searchableStacks: Infinity,
    transcripts: Infinity,
    stacks: Infinity,
    drawings: Infinity,
    dms: Infinity,
    invites: Infinity,
  },
} as const;

// Features available without an account.
// These work locally with no sign-in required.
export const NO_ACCOUNT_LIMITS = {
  searchableItems: 25, // Last 25 individual items (not stacks)
  // These are unlimited without account.
  transcripts: Infinity,
  stacks: Infinity,
  drawings: Infinity,
  popularCommands: Infinity,
} as const;

// Features that require an account (any tier).
export const ACCOUNT_REQUIRED_FEATURES = [
  'priorityMic',
  'sharedClipboard',
  'promptImprovements',
  'dms',
  'tasksAndObservations',
  'mobileSync',
  'fullSearch',
] as const;

// Features that work without an account.
export const NO_ACCOUNT_FEATURES = [
  'transcripts',
  'stacks',
  'drawings',
  'popularCommands',
  'limitedSearch', // Last 25 items
] as const;

export type AccountRequiredFeature = (typeof ACCOUNT_REQUIRED_FEATURES)[number];
export type NoAccountFeature = (typeof NO_ACCOUNT_FEATURES)[number];

// Monthly usage tracking for quota enforcement.
export interface MonthlyUsage {
  periodStart: string; // ISO date string (first day of billing month)
  priorityMicSeconds: number;
  promptImprovements: number;
  tasksCreated: number;
  observationsCreated: number;
}

// Quota check result - what to show the user.
export interface QuotaCheckResult {
  allowed: boolean;
  used: number;
  limit: number;
  remaining: number;
  resetDate: Date;
  percentUsed: number;
}

// Helper to check if a limit is effectively unlimited.
export function isUnlimited(value: number): boolean {
  return value === Infinity || value >= Number.MAX_SAFE_INTEGER;
}

// Get the limit for a specific feature based on tier.
export function getLimit(
  tier: UserTier,
  feature: keyof (typeof TIER_LIMITS)['free']
): number {
  return TIER_LIMITS[tier][feature];
}

// Check if user is approaching their limit (80% threshold).
export function isApproachingLimit(used: number, limit: number): boolean {
  if (isUnlimited(limit)) return false;
  return used >= limit * 0.8;
}

// Check if user has exceeded their limit.
export function hasExceededLimit(used: number, limit: number): boolean {
  if (isUnlimited(limit)) return false;
  return used >= limit;
}

// Format a limit for display (handles Infinity → "Unlimited").
export function formatLimit(value: number): string {
  return isUnlimited(value) ? 'Unlimited' : value.toLocaleString();
}

// Format remaining quota for display.
export function formatRemaining(used: number, limit: number): string {
  if (isUnlimited(limit)) return 'Unlimited';
  const remaining = Math.max(0, limit - used);
  return `${remaining}/${limit}`;
}
