"use strict";
// User tier definitions and feature limits.
// This is the single source of truth for all tier-related limits across the app.
Object.defineProperty(exports, "__esModule", { value: true });
exports.NO_ACCOUNT_FEATURES = exports.ACCOUNT_REQUIRED_FEATURES = exports.NO_ACCOUNT_LIMITS = exports.TIER_LIMITS = exports.PRICING = void 0;
exports.isUnlimited = isUnlimited;
exports.getLimit = getLimit;
exports.isApproachingLimit = isApproachingLimit;
exports.hasExceededLimit = hasExceededLimit;
exports.formatLimit = formatLimit;
exports.formatRemaining = formatRemaining;
// Pricing in USD.
exports.PRICING = {
    proMonthly: 15,
    additionalTeamMember: 15, // Per user/month beyond included 3
    includedTeamMembers: 3,
};
// Feature limits by tier.
// Use Infinity for unlimited features.
exports.TIER_LIMITS = {
    free: {
        priorityMicMinutes: 500,
        autoStackSessions: 50,
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
        autoStackSessions: Infinity,
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
};
// Features available without an account.
// These work locally with no sign-in required.
exports.NO_ACCOUNT_LIMITS = {
    searchableItems: 25, // Last 25 individual items (not stacks)
    // These are unlimited without account.
    transcripts: Infinity,
    stacks: Infinity,
    drawings: Infinity,
    popularCommands: Infinity,
};
// Features that require an account (any tier).
exports.ACCOUNT_REQUIRED_FEATURES = [
    'priorityMic',
    'sharedClipboard',
    'promptImprovements',
    'dms',
    'tasksAndObservations',
    'mobileSync',
    'fullSearch',
];
// Features that work without an account.
exports.NO_ACCOUNT_FEATURES = [
    'transcripts',
    'stacks',
    'drawings',
    'popularCommands',
    'limitedSearch', // Last 25 items
];
// Helper to check if a limit is effectively unlimited.
function isUnlimited(value) {
    return value === Infinity || value >= Number.MAX_SAFE_INTEGER;
}
// Get the limit for a specific feature based on tier.
function getLimit(tier, feature) {
    return exports.TIER_LIMITS[tier][feature];
}
// Check if user is approaching their limit (80% threshold).
function isApproachingLimit(used, limit) {
    if (isUnlimited(limit))
        return false;
    return used >= limit * 0.8;
}
// Check if user has exceeded their limit.
function hasExceededLimit(used, limit) {
    if (isUnlimited(limit))
        return false;
    return used >= limit;
}
// Format a limit for display (handles Infinity → "Unlimited").
function formatLimit(value) {
    return isUnlimited(value) ? 'Unlimited' : value.toLocaleString();
}
// Format remaining quota for display.
function formatRemaining(used, limit) {
    if (isUnlimited(limit))
        return 'Unlimited';
    const remaining = Math.max(0, limit - used);
    return `${remaining}/${limit}`;
}
//# sourceMappingURL=tiers.js.map