# Quotas, Billing, and UI Polish

## Pricing Model

```
Free (no account needed):
├─ Priority mic: 500 min/month (only when priority device selected)
├─ Auto-stacking: 50 sessions/month (unlimited screenshots per session)
├─ Local transcription, clipboard, sketches
├─ View popular commands
└─ Fields (local)

Pro ($15/month via Stripe):
├─ Unlimited priority mic
├─ Unlimited auto-stacking
├─ All-time stats visible (e.g., "71,713 words transcribed")
└─ Everything in free

Requires sign-in (free):
├─ Shared Fields
├─ Messages
├─ Mobile sync
└─ Post to popular commands

Teams (defer complex billing for now):
├─ 1-3 members: free tier limits
├─ 4+ members: team owner pays $15/person/month for all
└─ Billing overlap (individual pro + team) - figure out later
```

---

## Phase 1: Naming Changes

### Context → Fields

Rename throughout codebase and UI:

- **Context** → **Fields**
- **Shared Context** → **Shared Fields**

Files: `SharedContextView.tsx`, `ClipboardHistory.tsx`, menu items, preload files, docs

### Priority Device → Priority Microphone

In menu bar and settings:

- **"Priority Device"** → **"Priority Microphone"**
- **"Lock to priority device"** → simplified text
- New helper text: **"Your microphone will not auto-switch while enabled."**

Files: `trayManager.ts`, `AudioSettingsPanel.tsx`, `SettingsPanel.tsx`

---

## Phase 2: Local Quota Tracking

**Storage** (in preferences or separate local file):

```typescript
interface LocalQuotas {
  period: string;  // "YYYY-MM" format (e.g., "2026-01") - handles year boundaries
  priorityMicSecondsUsed: number;  // Only counts when priority device selected
  autoStackSessionsUsed: number;   // One per recording session with screenshots
  cachedTier: 'free' | 'pro';      // Cached tier for offline access
  cachedTierUpdatedAt: string;     // ISO timestamp of last tier sync
}
```

**New file**: `mac-app/electron/main/quotaManager.ts`

```typescript
import { TIER_LIMITS } from '../../../types/tiers';  // Single source of truth

// Core API
incrementPriorityMic(seconds: number): void  // Called while recording with priority device
incrementAutoStack(): void                    // Called once per recording session that has screenshots
getQuotas(): { priorityMic: QuotaStatus, autoStack: QuotaStatus }
checkQuota(feature: 'priorityMic' | 'autoStack'): { allowed: boolean, used: number, limit: number }
setCachedTier(tier: 'free' | 'pro'): void    // Called when tier is fetched from server
getCachedTier(): 'free' | 'pro'               // Returns cached tier for offline use
```

**Limits from `types/tiers.ts`** (update existing file, don't duplicate):

Changes needed in `types/tiers.ts`:

```typescript
// In TIER_LIMITS.free - update existing and add new
priorityMicMinutes: 500,    // Change from 100 to 500
autoStackSessions: 50,      // Add new field

// In TIER_LIMITS.pro - add new field
autoStackSessions: Infinity,

// In MonthlyUsage interface - add new field
autoStackSessions: number;
```

**Integration points**:

- Priority mic: increment in `transcriberManager.ts` only when `audioManager.getPriorityDevice() !== null`
- Auto-stacking: increment once when `stopRecordingAndTranscribe()` completes AND screenshots were taken
- Tier caching: update `cachedTier` whenever user signs in or tier changes

**Reset logic**: Compare `storedPeriod !== getCurrentPeriod()` where `getCurrentPeriod()` returns `"YYYY-MM"` format.

---

## Phase 3: Quota UI

### Footer in All Main Views

Display quota usage at bottom of all main views (consistent footer):

**Free users see**:

```
23 of 500 min  ·  12 of 50 fields
```

**Pro users see**:

```
71,713 words transcribed (all time)
```

- Count UP toward limit (not down)
- Update in real-time during recording

Files: `ClipboardHistory.tsx`, `SharedContextView.tsx`, `TeamView.tsx` (shared footer component)

---

## Phase 4: Quota Exhausted States

When quota hit, show modal:

```
You've used all your [priority mic minutes / auto-stacks] for this month.
Resets on the 1st.

To continue with unlimited access, subscribe for $15/month.

[Subscribe]  →  opens Stripe checkout in browser
```

Trigger points:

- Priority mic: when trying to start recording with priority device and quota exhausted
- Auto-stacking: after recording completes, if screenshots were taken and quota exhausted (still save, but show prompt)

---

## Phase 5: Stripe Integration

### Products

| Product | Price | Description |
|---------|-------|-------------|
| Pro Monthly | $15/month | Unlimited priority mic + auto-stacking |
| Team Member | $15/month | Per person for teams of 4+ (team owner pays) |

### Implementation

1. **Stripe Checkout** (hosted page) - opens in default browser, avoids Apple 30% tax
2. **Supabase Edge Function** (`supabase/functions/stripe-webhook/index.ts`):

   - **Verify Stripe signature** before processing (prevent spoofing)
   - `checkout.session.completed` → set `profiles.tier = 'pro'`
   - `customer.subscription.deleted` → set `profiles.tier = 'free'`
   - Let Stripe handle payment retries automatically

3. **Stripe Customer Portal** - link in Settings for subscription management

**Security**: Webhook MUST verify `Stripe-Signature` header using webhook secret. Reject requests with invalid signatures.

### Database Changes

New migration: `supabase/migrations/012_billing.sql`

```sql
ALTER TABLE public.profiles
  ADD COLUMN tier text NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'pro')),
  ADD COLUMN stripe_customer_id text,
  ADD COLUMN stripe_subscription_id text;
```

### UI Integration

- Settings panel: "Manage Subscription" link → opens Stripe Customer Portal in browser
- After successful checkout: poll or use realtime to detect tier change, update UI

---

## Phase 6: Auth Gates

Features requiring sign-in (show sign-in prompt if not authenticated):

| Feature | Read | Write | Status |
|---------|------|-------|--------|
| Shared Fields | Requires sign-in | Requires sign-in | Already implemented |
| Messages (TeamView) | Requires sign-in | Requires sign-in | Already implemented |
| Mobile sync | Requires sign-in | Requires sign-in | Already implemented |
| Popular commands | Free (no sign-in) | Requires sign-in | Needs implementation |

**Note**: `SharedContextView.tsx` and `TeamView.tsx` already check `!session` and show sign-in forms. Only popular commands write-gate needs to be added.

---

## Phase 7: Recording Overlay Polish

### 1. Screenshot Pipe Indicator

Show stacked cursor pipes to indicate screenshots taken during recording:

```
[red dot] [| | |] [fielding theories...]
          └─ 3 pipes = 3 screenshots

[red dot] [| | | +2] [fielding theories...]
          └─ 3 pipes + overflow = 5 screenshots
```

- Cap at 3 visible pipes, then show `+N`
- Animation: each pipe fades in when screenshot taken
- Position: between dot and status text
- Style: thin vertical line (like text cursor/caret)

### 2. Dot Position Fix

Move recording dot right by ~1px to avoid overlap with measurement UI during screen recording.

### 3. Green Done State

When transitioning from transcribing to done:

- Dot changes from purple to green
- Text stays as "transcribing" briefly before dismissing
- Creates continuity in the visual feedback

### 4. Hide Labels Toggle

New setting: "Show status labels"

- ON (default): Show "fielding theories...", "transcribing...", etc.
- OFF: Show only colored dots (red/purple/green)

Files: `CursorStatus.tsx`, `RecordingOverlay.tsx`, `cursorStatusManager.ts`, `preferences.ts`

---

## Phase 8: Settings Cleanup

### 1. Remove Clipboard Tab from Tasks

The tasks page has a vestigial "clipboard" tab indicator. Remove it.

### 2. Experimental Section

Move "Tasks" toggle to a new "Experimental" section in Settings.

### 3. Master Sounds Toggle

Ensure `soundsEnabled` toggle is prominent and clearly labeled as a master switch that disables all sounds.

---

## File Change Summary

| File | Changes |
|------|---------|
| `mac-app/electron/main/quotaManager.ts` | **New**: local quota tracking |
| `mac-app/electron/main/preferences.ts` | Add quota storage, hideLabels setting |
| `mac-app/electron/main/transcriberManager.ts` | Integrate quota tracking |
| `mac-app/electron/main/audioManager.ts` | Expose priority device check |
| `mac-app/electron/main/trayManager.ts` | Rename to Priority Microphone |
| `mac-app/src/components/ClipboardHistory.tsx` | Quota footer, rename to Fields |
| `mac-app/src/components/SharedContextView.tsx` | Rename, auth gate, quota footer |
| `mac-app/src/components/TeamView.tsx` | Quota footer |
| `mac-app/src/components/CursorStatus.tsx` | Pipe indicator, hideLabels, green state text |
| `mac-app/src/components/RecordingOverlay.tsx` | Pipe indicator, dot position |
| `mac-app/src/components/SettingsPanel.tsx` | Experimental section, sounds toggle, hideLabels, subscription link |
| `mac-app/src/components/AudioSettingsPanel.tsx` | Rename Priority Microphone |
| `supabase/migrations/012_billing.sql` | **New**: tier and Stripe columns |
| `supabase/functions/stripe-webhook/` | **New**: handle Stripe events |
| `types/tiers.ts` | Update limits (500 min, 50 sessions) |

---

## Anti-Patterns (What We Won't Do)

- No App Store in-app purchase (Stripe web only to avoid Apple 30%)
- No complex credit pooling or cumulative quotas
- No proration v1 (keep billing simple)
- No admin dashboard v1 (manual DB updates if needed)
- No usage analytics dashboard v1
- No team billing overlap logic v1 (defer)
- Quotas don't roll over month-to-month

---

## Estimated Effort

| Phase | Time |
|-------|------|
| Naming changes (Fields, Priority Microphone) | 1-2 hrs |
| Local quota tracking | 2-3 hrs |
| Quota UI footer | 1-2 hrs |
| Quota exhausted states | 1 hr |
| Stripe integration (webhook, checkout, portal) | 3-4 hrs |
| Auth gates | 1-2 hrs |
| Pipe indicator + animation | 2-3 hrs |
| Recording overlay polish | 1-2 hrs |
| Settings cleanup | 1 hr |

**Total: ~2-3 days of focused work**

---

## Implementation Order (Two Phases)

### Phase A: Core Billing (Ship First) ✅ COMPLETED

1. ✅ **Local quota tracking** - `quotaManager.ts` with YYYY-MM reset
2. ✅ **Quota UI footer** - shows usage in ClipboardHistory footer
3. ✅ **Auth gates** - sign-in required to share popular commands
4. ✅ **Stripe integration** - checkout, webhook edge function, portal links
5. ✅ **Quota exhausted states** - modal with subscribe link

**Goal**: Users can hit limits and pay to upgrade. Ship this first.

### Phase B: Polish (Can Ship Later) ✅ COMPLETED

6. ✅ **Naming changes** - Already done: "Fields" and "Shared Fields" labels
7. ✅ **Priority Microphone** - Renamed from "Priority Device" with helper text
8. ✅ **Pipe indicator** - Stacked pipes with fade-in animation in both overlays
9. ✅ **Recording overlay polish** - Dot position fixed, green state shows "transcribing...", hide labels toggle
10. ✅ **Settings cleanup** - Clipboard tab already removed, Tasks in Experimental, sounds toggle exists

**Goal**: UX improvements. Can ship independently after Phase A.
