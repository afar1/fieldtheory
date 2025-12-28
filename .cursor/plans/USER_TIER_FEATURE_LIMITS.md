# User Tier & Feature Limits Specification

> Defines the feature limits for free vs paid users, no-account access, and implementation implications.

---

## Pricing Overview

| Tier | Cost | Billing |
|------|------|---------|
| **No Account** | Free | — |
| **Free** | Free | Requires account |
| **Pro** | $15/user/month | Monthly subscription |

**Important**: Monthly quotas do **not** roll over. Each month resets to the full allocation.

---

## Feature Limits by Tier

### Legend
- `*` = No account needed (works without signing in)
- ✓ = Unlimited
- — = Not available

| Feature | No Account | Free | Pro |
|---------|------------|------|-----|
| **Priority Mic** | — | 100 min/month | ✓ Unlimited |
| **Shared Clipboard (Team)** | — | 3 people | ✓ Unlimited† |
| **Prompt Improvements** | — | 10/month | 100/month |
| **Transcripts*** | ✓ | ✓ | ✓ |
| **Stacks*** | ✓ | ✓ | ✓ |
| **Drawings/Sketches*** | ✓ | ✓ | ✓ |
| **DMs (Hot Mic)** | — | ✓ | ✓ |
| **Popular Commands*** | ✓ | ✓ | ✓ |
| **Tasks & Observations** | — | 25/month | ✓ Unlimited |
| **Mobile Sync** | — | ✓ | ✓ |
| **Search** | Last 25 items* | Last 20 stacks | ✓ Unlimited |
| **Invite People** | — | ✓ No limit | ✓ No limit |

**†** Pro tier includes 3 people in shared clipboard. Additional team members cost extra per user (see Team Pricing below).

### Features That Require an Account
- Priority Mic
- Shared Clipboard / Team features
- Prompt Improvements
- DMs (Hot Mic messaging)
- Tasks & Observations (auto-separation)
- Mobile Sync
- Full search history

### Features That Work Without an Account*
- Transcripts (unlimited)
- Stacks (unlimited)
- Drawings/Sketches (unlimited)
- Popular Commands
- Search (last 25 items)

---

## Team Pricing (Shared Clipboard)

| Team Size | Free Tier | Pro Tier |
|-----------|-----------|----------|
| 1-3 people | ✓ Included | ✓ Included |
| 4+ people | — Not available | +$15/user/month |

**Example**: A team of 5 on Pro costs $15 (primary) + $30 (2 additional users) = $45/month total.

---

## Implementation Implications

### 1. Database Schema Changes

Add tables/columns to track usage:

```sql
-- User tier and subscription status
ALTER TABLE profiles ADD COLUMN tier TEXT DEFAULT 'free' CHECK (tier IN ('free', 'pro'));
ALTER TABLE profiles ADD COLUMN subscription_id TEXT; -- Stripe subscription ID
ALTER TABLE profiles ADD COLUMN subscription_status TEXT; -- active, canceled, past_due
ALTER TABLE profiles ADD COLUMN current_period_end TIMESTAMPTZ; -- When billing period ends

-- Monthly usage tracking (resets each billing period)
CREATE TABLE user_monthly_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  period_start DATE NOT NULL, -- First day of the billing month
  
  -- Usage counters
  priority_mic_seconds INTEGER DEFAULT 0,
  prompt_improvements INTEGER DEFAULT 0,
  tasks_created INTEGER DEFAULT 0,
  observations_created INTEGER DEFAULT 0,
  
  UNIQUE(user_id, period_start)
);

-- Team member count tracking
CREATE VIEW team_member_counts AS
SELECT 
  team_id,
  COUNT(*) as member_count
FROM team_members
GROUP BY team_id;
```

### 2. Local Storage (No Account Mode)

For users without an account, track limits locally:

```typescript
interface LocalUsageLimits {
  // These persist locally and never sync
  searchableStackCount: number; // Max 25 stacks searchable
  
  // Local-only features are unlimited
  // Transcripts, stacks, drawings - no limits
}
```

Store in:
- **Mac**: `~/Library/Application Support/Field/local-limits.json`
- **iOS**: AsyncStorage with key `@field/local-limits`

### 3. Backend Enforcement

Create middleware/functions to check limits before actions:

```typescript
// Example: Check prompt improvement quota
async function canUsePromptImprovement(userId: string): Promise<{
  allowed: boolean;
  remaining: number;
  limit: number;
  resetDate: Date;
}> {
  const tier = await getUserTier(userId);
  const usage = await getMonthlyUsage(userId);
  
  const limit = tier === 'pro' ? 100 : 10;
  const remaining = Math.max(0, limit - usage.promptImprovements);
  
  return {
    allowed: remaining > 0,
    remaining,
    limit,
    resetDate: getNextMonthStart(usage.periodStart),
  };
}

// Example: Check priority mic time
async function canUsePriorityMic(userId: string, requestedSeconds: number): Promise<{
  allowed: boolean;
  remainingSeconds: number;
  limitSeconds: number;
}> {
  const tier = await getUserTier(userId);
  
  if (tier === 'pro') {
    return { allowed: true, remainingSeconds: Infinity, limitSeconds: Infinity };
  }
  
  const usage = await getMonthlyUsage(userId);
  const limitSeconds = 100 * 60; // 100 minutes
  const remainingSeconds = Math.max(0, limitSeconds - usage.priorityMicSeconds);
  
  return {
    allowed: remainingSeconds >= requestedSeconds,
    remainingSeconds,
    limitSeconds,
  };
}

// Example: Check team size
async function canAddTeamMember(teamId: string, addingUserId: string): Promise<{
  allowed: boolean;
  currentCount: number;
  freeLimit: number;
  requiresProUpgrade: boolean;
  additionalCostPerUser: number;
}> {
  const tier = await getUserTier(addingUserId);
  const currentCount = await getTeamMemberCount(teamId);
  
  if (tier === 'free' && currentCount >= 3) {
    return {
      allowed: false,
      currentCount,
      freeLimit: 3,
      requiresProUpgrade: true,
      additionalCostPerUser: 15,
    };
  }
  
  return {
    allowed: true,
    currentCount,
    freeLimit: 3,
    requiresProUpgrade: false,
    additionalCostPerUser: tier === 'pro' && currentCount >= 3 ? 15 : 0,
  };
}
```

### 4. Search Limitations

**No Account (Local)**:
- Only index/search the last 25 stacks locally
- When stack count exceeds 25, older stacks become unsearchable
- UI shows "Upgrade to search your full history"

**Free Tier**:
- Last 20 stacks are searchable (across all items within those stacks)
- Older content exists but won't appear in search results

**Pro Tier**:
- Full search across all history

Implementation approach:
```typescript
// In search query, add limit based on tier
function getSearchableStackIds(userId: string | null, tier: 'none' | 'free' | 'pro'): string[] | null {
  if (tier === 'pro') {
    return null; // No limit, search all
  }
  
  const stackLimit = tier === 'free' ? 20 : 25;
  
  // Return IDs of the most recent N stacks
  return getRecentStackIds(userId, stackLimit);
}
```

### 5. Stripe Integration

#### Webhook Events to Handle

```typescript
const STRIPE_EVENTS = [
  'checkout.session.completed',    // New subscription
  'customer.subscription.updated', // Plan change, renewal
  'customer.subscription.deleted', // Cancellation
  'invoice.payment_failed',        // Payment issue
  'invoice.paid',                  // Successful payment
];
```

#### Customer Portal Features
- View current plan and usage
- Upgrade/downgrade
- Update payment method
- Cancel subscription
- View invoices

#### Subscription Metadata

```typescript
interface StripeSubscriptionMetadata {
  userId: string;
  tier: 'pro';
  teamId?: string; // If this is a team subscription
  additionalSeats?: number; // Team members beyond the included 3
}
```

### 6. Settings UI Requirements

#### Account Status Section

```
┌─────────────────────────────────────────────────────────┐
│  Account                                                │
│  ─────────────────────────────────────────────────────  │
│                                                         │
│  Plan: Free                    [Upgrade to Pro - $15/mo]│
│                                                         │
│  This Month's Usage:                                    │
│  • Priority Mic: 47/100 minutes remaining               │
│  • Prompt Improvements: 3/10 remaining                  │
│  • Tasks & Observations: 18/25 remaining                │
│                                                         │
│  Resets: January 1, 2025                                │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

#### Pro User View

```
┌─────────────────────────────────────────────────────────┐
│  Account                                                │
│  ─────────────────────────────────────────────────────  │
│                                                         │
│  Plan: Pro ($15/month)              [Manage Subscription]│
│  Next billing: January 15, 2025                         │
│                                                         │
│  This Month's Usage:                                    │
│  • Priority Mic: Unlimited ✓                            │
│  • Prompt Improvements: 67/100 remaining                │
│  • Tasks & Observations: Unlimited ✓                    │
│  • Search: Full history ✓                               │
│                                                         │
│  Team: 4 members (3 included + 1 × $15)                │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 7. Upgrade Prompts (UX Patterns)

#### Soft Limit Warning (Approaching Limit)
Show when user reaches 80% of a quota:

```
"You've used 8 of 10 prompt improvements this month. 
Upgrade to Pro for 100/month → [Upgrade]"
```

#### Hard Limit Block (At Limit)
Show when user hits the limit:

```
"You've reached your monthly limit for prompt improvements.
Resets January 1 • Upgrade to Pro for 10× more → [Upgrade]"
```

#### Feature Gate (No Access)
Show when free user tries a Pro-only feature:

```
"Priority Mic requires an account.
[Sign Up Free] to get 100 minutes/month, or
[Go Pro] for unlimited"
```

#### Team Size Gate

```
"Free accounts can share with up to 3 people.
You have 3 team members. [Upgrade to Pro] to add more."
```

### 8. Mobile (iOS) Specific Limits

| Feature | No Account | Free | Pro |
|---------|------------|------|-----|
| Tasks & Observations | — | 25/month | ✓ |
| Mobile Sync | — | ✓ | ✓ |
| Search | Last 25 items | Last 20 stacks | ✓ |

#### Local Enforcement (iOS)
```typescript
// Track tasks/observations created this month locally
const MONTHLY_LIMIT_KEY = '@field/monthly-limits';

interface MonthlyLimits {
  periodStart: string; // ISO date of month start
  tasksCreated: number;
  observationsCreated: number;
}

async function canCreateTaskOrObservation(): Promise<boolean> {
  const session = await getSession();
  if (!session) return false; // Requires account
  
  const tier = await getUserTier(session.user.id);
  if (tier === 'pro') return true;
  
  const limits = await getMonthlyLimits();
  const total = limits.tasksCreated + limits.observationsCreated;
  
  return total < 25;
}
```

### 9. Website Display Format

The website pricing page should show the tier comparison with asterisk notation:

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                      │
│     FREE                              PRO                           │
│     $0/month                          $15/user/month                │
│                                                                      │
│     ─────────────────────────────     ─────────────────────────     │
│                                                                      │
│     100 min/mo Priority Mic           Unlimited Priority Mic        │
│     3 people Shared Clipboard         Unlimited Shared Clipboard†   │
│     10 Prompt Improvements/mo         100 Prompt Improvements/mo    │
│     Unlimited Transcripts*            Unlimited Transcripts*        │
│     Unlimited Stacks*                 Unlimited Stacks*             │
│     Unlimited Drawings*               Unlimited Drawings*           │
│     Unlimited DMs                     Unlimited DMs                 │
│     Popular Commands*                 Popular Commands*             │
│     25 Tasks & Observations/mo        Unlimited Tasks & Observations│
│     Mobile Sync                       Mobile Sync                   │
│     Search last 20 stacks             Unlimited Search              │
│     Unlimited invites                 Unlimited invites             │
│                                                                      │
│     [Sign Up Free]                    [Start Pro Trial]             │
│                                                                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  * No account needed                                                 │
│  † Additional team members beyond 3: +$15/user/month                │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Checklist

### Backend
- [ ] Add tier column to profiles table
- [ ] Create monthly usage tracking table
- [ ] Create quota check functions
- [ ] Add Stripe webhook handler
- [ ] Implement usage increment on each action
- [ ] Add monthly reset cron job (or check period on each request)

### Mac App
- [ ] Add tier/usage to user context
- [ ] Check limits before priority mic activation
- [ ] Check limits before prompt improvement
- [ ] Show usage in settings panel
- [ ] Add upgrade prompts at limit points
- [ ] Implement Stripe checkout flow (in-app or browser redirect)
- [ ] Handle team member limit for shared clipboard

### iOS App
- [ ] Track local usage for no-account mode
- [ ] Check task/observation limits
- [ ] Limit searchable stacks based on tier
- [ ] Show usage stats in settings
- [ ] Add upgrade prompts

### Website
- [ ] Create pricing page with tier comparison
- [ ] Integrate Stripe Checkout
- [ ] Build customer portal integration
- [ ] Add feature comparison table

---

## Constants Reference

```typescript
// Tier limits - single source of truth
export const TIER_LIMITS = {
  free: {
    priorityMicMinutes: 100,
    sharedClipboardPeople: 3,
    promptImprovementsPerMonth: 10,
    tasksAndObservationsPerMonth: 25,
    searchableStacks: 20,
  },
  pro: {
    priorityMicMinutes: Infinity,
    sharedClipboardPeople: Infinity, // But each beyond 3 costs extra
    promptImprovementsPerMonth: 100,
    tasksAndObservationsPerMonth: Infinity,
    searchableStacks: Infinity,
  },
  noAccount: {
    // Only local features available
    searchableItems: 25, // Individual items, not stacks
    // Unlimited: transcripts, stacks, drawings, popular commands
  },
} as const;

export const PRICING = {
  proMonthly: 15, // USD
  additionalTeamMember: 15, // USD per user/month beyond 3
  includedTeamMembers: 3,
} as const;
```

---

*Document created: December 2024*
*For implementation tracking, create issues in the project board.*
