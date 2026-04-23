# Auth Is Identity, Licenses Are Entitlements

**Created**: Apr 2026
**Version**: v1
**Context**: Simplifying Field Theory account access from quota gating to trial or paid access

## The Problem We Almost Framed Wrong

It is tempting to look at a messy billing and access system and say "replace it with license codes." That sounds simpler, but it often just moves the complexity into a worse place.

The real problem is usually that four different concerns have been blended together:

- Authentication: who the user is.
- Billing: whether Stripe says they should have paid access.
- Claiming access: how a purchase gets attached to an account.
- Product access: whether the app should work right now.

If a license code tries to do all four jobs, it becomes a second auth system, a second billing system, and a second source of truth.

## The Insight

**The simplification is not "use license codes everywhere." The simplification is "separate identity from entitlement."**

For this product, the clean split is:

- Supabase OTP proves identity.
- Stripe remains the billing source of truth.
- A license code is only a claim token that attaches paid access to an account.
- The app reads one computed account state and behaves from that.

That account state can stay small and understandable:

- `trial_active`
- `trial_cooling_off`
- `paid_active`
- `grandfathered_active`
- `payment_grace`
- `inactive`

## Why This Is Better

Once access is modeled as one state machine, the UI gets much easier to reason about.

Instead of showing plan names, quotas, upgrade nudges, and special-case gating logic in different places, the app can show one plain status in one place:

- "Trial active. 9 days left."
- "Trial ended. Next free window starts May 23."
- "Pro active."
- "Payment issue. Fix billing by May 3."

The backend also gets cleaner. The app stops asking four different systems whether a feature is allowed and instead asks one question: "What is this account's current access state?"

## Practical Rules

1. Do not use a license code as a bearer credential on every launch.
2. Redeem the code once, then store the account-to-license relationship on the server.
3. Store only hashed license codes, never plaintext codes.
4. Keep recurring validity tied to Stripe subscription status, not to the code itself.
5. If a purchase starts from a signed-in app session, auto-claim it and email the code as a backup. Do not force unnecessary manual entry.
6. Give paid users an offline grace window so temporary network issues do not feel like account lockouts.

## Field Theory-Specific Implication

The current complexity is not mainly in login. It is in quota-based entitlement spread across webhook logic, edge functions, renderer UI, tray UI, and main-process gating.

The right migration path is:

- keep OTP login,
- keep Stripe,
- add redeemable license records,
- replace quota checks with one account-access service,
- and move the whole app to a single plain-English account state.
